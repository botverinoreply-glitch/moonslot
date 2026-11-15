"""
Moonslot obfuscator backend, v2.

Levels:
  normal  : two-layer encrypted strings, masked integers, integrity check
  medium  : normal + opaque predicates with dead branches, decoy strings
  max     : medium, and the whole script is stored as a two-layer encrypted
            payload that is verified and loaded at runtime
  custom  : the caller chooses the features (strings, numbers, junk, integrity, payload)

Requires: pip install flask flask-cors
"""

import os
import random
import re

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# MOONSLOT_ORIGINS="*" accepts every origin (testing only).
# Production example: MOONSLOT_ORIGINS=https://moonveil.cc,https://www.moonveil.cc
_origins_env = os.environ.get("MOONSLOT_ORIGINS", "https://moonveil.cc").strip()
ALLOWED_ORIGINS = "*" if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]
CORS(app, origins=ALLOWED_ORIGINS)

MAX_CODE_BYTES = 200_000
MODES = {"custom", "normal", "medium", "max"}

PRESETS = {
    "normal": {"strings": True, "numbers": True, "junk": False, "integrity": True,
               "payload": False, "junk_density": 0.0},
    "medium": {"strings": True, "numbers": True, "junk": True, "integrity": True,
               "payload": False, "junk_density": 0.35},
    "max":    {"strings": True, "numbers": True, "junk": True, "integrity": True,
               "payload": True, "junk_density": 0.6},
}
CUSTOM_DEFAULTS = {"strings": True, "numbers": False, "junk": False, "integrity": False,
                   "payload": False, "junk_density": 0.35}

rng = random.SystemRandom()

KEYWORDS = {
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto",
    "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true",
    "until", "while", "continue",
}
STMT_START = {
    "local", "if", "for", "while", "do", "repeat", "return", "break", "function",
    "goto", "continue",
}
BLOCK_OPENERS = {"then", "do", "else", "repeat"}
OPS = ["...", "..", "==", "~=", "<=", ">=", "//", "::", "+=", "-=", "*=", "/=", "%=", "^=", "->"]
DIGITS = set("0123456789")
LONG_BRACKET = re.compile(r"\[(=*)\[")
NUMBER = re.compile(r"0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
SIMPLE_ESC = {
    "n": "\n", "t": "\t", "a": "\a", "b": "\b", "f": "\f", "v": "\v",
    "\\": "\\", '"': '"', "'": "'", "\n": "\n",
}

# The loader captures every library function it needs before any user code runs,
# so later changes to globals cannot affect decoding.
PRELUDE = ("local _sbyte, _schar, _tconcat, _tonumber, _ssub, _error, _floor, _tostring, _b32, _loadstr = "
           "string.byte, string.char, table.concat, tonumber, string.sub, error, math.floor, tostring, bit32, loadstring")


class LuaError(Exception):
    pass


# ---------------------------------------------------------------- lexer

def decode_escapes(raw):
    """Turn the inside of a quoted Lua string into raw bytes."""
    out = bytearray()
    i, n = 0, len(raw)
    while i < n:
        c = raw[i]
        if c != "\\":
            out += c.encode("utf-8")
            i += 1
            continue
        i += 1
        d = raw[i]
        if d == "\r":
            i += 1
            if i < n and raw[i] == "\n":
                i += 1
            out += b"\n"
        elif d in SIMPLE_ESC:
            out += SIMPLE_ESC[d].encode("utf-8")
            i += 1
        elif d == "x":
            out.append(int(raw[i + 1:i + 3], 16))
            i += 3
        elif d == "z":
            i += 1
            while i < n and raw[i].isspace():
                i += 1
        elif d in DIGITS:
            j = i
            while j < n and j < i + 3 and raw[j] in DIGITS:
                j += 1
            value = int(raw[i:j])
            if value > 255:
                raise LuaError("decimal escape too large")
            out.append(value)
            i = j
        elif d == "u" and raw[i + 1:i + 2] == "{":
            j = raw.index("}", i)
            out += chr(int(raw[i + 2:j], 16)).encode("utf-8")
            i = j + 1
        else:
            raise LuaError(f"invalid escape sequence \\{d}")
    return bytes(out)


def tokenize(src):
    """Returns a list of (kind, value). kind is str, num, name, kw or op.
    String values are bytes; comments are dropped."""
    toks = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in " \t\r\n\f\v":
            i += 1
            continue
        if src.startswith("--", i):
            m = LONG_BRACKET.match(src, i + 2)
            if m:
                close = "]" + m.group(1) + "]"
                end = src.find(close, m.end())
                if end < 0:
                    raise LuaError("unfinished long comment")
                i = end + len(close)
            else:
                j = src.find("\n", i)
                i = n if j < 0 else j
            continue
        m = LONG_BRACKET.match(src, i)
        if m:
            close = "]" + m.group(1) + "]"
            start = m.end()
            end = src.find(close, start)
            if end < 0:
                raise LuaError("unfinished long string")
            body = src[start:end]
            if body.startswith("\r\n"):
                body = body[2:]
            elif body.startswith("\n"):
                body = body[1:]
            toks.append(("str", body.encode("utf-8")))
            i = end + len(close)
            continue
        if c in "\"'":
            j = i + 1
            while True:
                if j >= n or src[j] == "\n":
                    raise LuaError("unfinished string")
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == c:
                    break
                j += 1
            try:
                toks.append(("str", decode_escapes(src[i + 1:j])))
            except (ValueError, IndexError):
                raise LuaError("invalid escape sequence in string")
            i = j + 1
            continue
        if c in DIGITS or (c == "." and i + 1 < n and src[i + 1] in DIGITS):
            m = NUMBER.match(src, i)
            toks.append(("num", m.group(0)))
            i = m.end()
            continue
        m = NAME.match(src, i)
        if m:
            word = m.group(0)
            toks.append(("kw" if word in KEYWORDS else "name", word))
            i = m.end()
            continue
        for op in OPS:
            if src.startswith(op, i):
                toks.append(("op", op))
                i += len(op)
                break
        else:
            toks.append(("op", c))
            i += 1
    return toks


# ---------------------------------------------------------------- encoding

def checksum31(data):
    h = 0
    for b in data:
        h = (h * 31 + b) % 4294967296
    return h


def checksum_pair(data):
    """Two independent checksums; the loader verifies both."""
    h, a, b = 0, 1, 0
    for x in data:
        h = (h * 31 + x) % 4294967296
        a = (a + x) % 65521
        b = (b + a) % 65521
    return h, b * 65536 + a


def hide(value):
    """Store a constant as an expression so it is not a plain literal."""
    r = rng.randint(1, 9999)
    return f"(({value} + {r}) - {r})"


def encode_layers(data, k1, k2):
    """Two layers per byte: XOR with a rolling key k1, then addition mod 256
    with a second rolling key k2. The Lua loader undoes them in reverse."""
    out = []
    a, s = k1, k2
    for b in data:
        x = b ^ a
        y = (x + s) % 256
        out.append(f"{y:02x}")
        a = (a * 5 + 17) % 256
        s = (s * 7 + 3) % 256
    return "".join(out)


def lua_quote(data):
    return '"' + "".join(f"\\{b:03d}" for b in data) + '"'


def mask_number(text):
    """Integers 0..2^31-1 become ((value + r) - r). Returns None if left alone."""
    try:
        if text[:2].lower() == "0x":
            value = int(text, 16)
        elif any(ch in text for ch in ".eE"):
            return None
        else:
            value = int(text)
    except ValueError:
        return None
    if not 0 <= value < 2 ** 31:
        return None
    r = rng.randint(1, 9999)
    return f"(({value + r})-{r})"


def junk_statement():
    a, b = rng.randint(2, 9999), rng.randint(2, 9999)
    name = f"_j{rng.randrange(16 ** 6):06x}"
    choice = rng.randrange(3)
    if choice == 0:
        return f"do local {name} = ({a} * {b}) - {a * b} end"
    if choice == 1:
        return f"if {a} > {a} + {b} then local {name} = {b} end"
    return f"do local {name} = (({a} + {b}) % {rng.randint(2, 97)}) end"


def predicates(enc):
    """Conditions that are always true at runtime, so the branches they guard
    never run. Some depend on loader state, so they are not plain constants."""
    n = rng.randint(2, 999)
    return [
        f"(#{enc} >= 0)",
        f"(({n} * ({n} + 1)) % 2 == 0)",
        f"(({n} % 2) == 0 or ({n} % 2) ~= 0)",
    ]


def clean_signature(value):
    cleaned = re.sub(r"[^A-Za-z0-9 _\-\[\]\.#]", "", str(value))[:40].strip()
    return cleaned or "Moonslot"


# ---------------------------------------------------------------- transform

def transpile(tokens, opts, dec, preds, strings):
    """Rebuilds the script as one line of Lua. Each string literal is added to
    `strings` and replaced by a placeholder @@n@@ (1-based), which build_chunk
    later turns into the string's shuffled slot."""
    out = []
    index = {}
    density = opts["junk_density"] if opts["junk"] else 0.0

    def decoy():
        if density and rng.random() < density:
            pred = rng.choice(preds)
            if rng.random() < 0.5:
                out.append(f"if {pred} then {junk_statement()} else {junk_statement()} end")
            else:
                out.append(f"if {pred} then {junk_statement()} end")

    decoy()
    for pos, (kind, val) in enumerate(tokens):
        nxt = tokens[pos + 1] if pos + 1 < len(tokens) else None

        if kind == "str":
            if opts["strings"]:
                if val not in index:
                    strings.append(val)
                    index[val] = len(strings)
                out.append(f"({dec}(@@{index[val]}@@))")
            else:
                out.append(lua_quote(val))
        elif kind == "num":
            masked = mask_number(val) if opts["numbers"] else None
            out.append(masked or val)
        else:
            out.append(val)

        if density:
            if kind == "kw" and val in BLOCK_OPENERS:
                decoy()
            elif kind == "kw" and val == "end":
                if nxt is None or nxt[0] == "name" or (nxt[0] == "kw" and nxt[1] in STMT_START):
                    decoy()
    return " ".join(out)


# ---------------------------------------------------------------- Lua output

def bitxor_lua(name):
    return (
        f"local {name} = (_b32 and _b32.bxor) or function(a, b)\n"
        "    local r, p = 0, 1\n"
        "    for _ = 1, 8 do\n"
        "        if (a % 2) ~= (b % 2) then r = r + p end\n"
        "        a, b, p = _floor(a / 2), _floor(b / 2), p * 2\n"
        "    end\n"
        "    return r\n"
        "end"
    )


def layers_lua(name, bx):
    return (
        f"local function {name}(h, a, s)\n"
        "    local out = {}\n"
        "    for p = 1, #h, 2 do\n"
        "        local y = _tonumber(_ssub(h, p, p + 1), 16)\n"
        f"        out[#out + 1] = _schar({bx}((y - s) % 256, a))\n"
        "        a = (a * 5 + 17) % 256\n"
        "        s = (s * 7 + 3) % 256\n"
        "    end\n"
        "    return _tconcat(out)\n"
        "end"
    )


def build_chunk(tokens, opts):
    sx = f"{rng.randrange(16 ** 6):06x}"
    names = {k: f"_{k}{sx}" for k in ("bx", "lay", "enc", "cache", "dec", "hsh")}
    preds = predicates(names["enc"])

    strings = []
    body = transpile(tokens, opts, names["dec"], preds, strings)

    # Shuffle the real strings among decoys so slot numbers reveal nothing.
    items = [("real", i) for i in range(len(strings))]
    if opts["junk"]:
        for _ in range(rng.randint(1, 4)):
            items.append(("decoy", bytes(rng.randrange(256) for _ in range(rng.randint(4, 12)))))
    rng.shuffle(items)

    position = {}
    entries, hexes = [], []
    for slot, (kind, value) in enumerate(items, start=1):
        if kind == "real":
            position[value + 1] = slot
            data = strings[value]
        else:
            data = value
        k1, k2 = rng.randrange(256), rng.randrange(256)
        h = encode_layers(data, k1, k2)
        hexes.append(h)
        entries.append(f'{{"{h}",{k1},{k2}}}')

    body = re.sub(r"@@(\d+)@@", lambda m: str(position[int(m.group(1))]), body)
    cs1, cs2 = checksum_pair("|".join(hexes).encode("ascii"))

    lines = [
        PRELUDE,
        bitxor_lua(names["bx"]),
        layers_lua(names["lay"], names["bx"]),
        f"local {names['enc']} = {{{','.join(entries)}}}",
        f"local {names['cache']} = {{}}",
        f"local function {names['dec']}(i)",
        f"    local c = {names['cache']}[i]",
        "    if c then return c end",
        f"    local e = {names['enc']}[i]",
        f"    c = {names['lay']}(e[1], e[2], e[3])",
        f"    {names['cache']}[i] = c",
        "    return c",
        "end",
    ]

    if opts["integrity"]:
        hn = names["hsh"]
        lines += [
            f"local function {hn}()",
            "    local parts = {}",
            f"    for i = 1, #{names['enc']} do parts[i] = {names['enc']}[i][1] end",
            '    local s = _tconcat(parts, "|")',
            "    local h, a, b = 0, 1, 0",
            "    for p = 1, #s do",
            "        local x = _sbyte(s, p)",
            "        h = (h * 31 + x) % 4294967296",
            "        a = (a + x) % 65521",
            "        b = (b + a) % 65521",
            "    end",
            "    return h, b * 65536 + a",
            "end",
            f"local {hn}_1, {hn}_2 = {hn}()",
            f'if {hn}_1 ~= {hide(cs1)} or {hn}_2 ~= {hide(cs2)} then _error("Moonslot: integrity check failed", 0) end',
        ]

    lines.append("return (function(...)")
    lines.append(body)
    lines.append("end)(...)")
    return "\n".join(lines)


def build_payload(inner):
    """Max level: the finished script is stored as a two-layer encrypted
    payload, verified against a checksum, then loaded at runtime."""
    k1, k2 = rng.randrange(256), rng.randrange(256)
    hexpayload = encode_layers(inner.encode("utf-8"), k1, k2)
    cs1, cs2 = checksum_pair(hexpayload.encode("ascii"))
    sx = f"{rng.randrange(16 ** 6):06x}"
    bx, lay = f"_bx{sx}", f"_lay{sx}"

    lines = [
        PRELUDE,
        "local _ld = _loadstr",
        bitxor_lua(bx),
        layers_lua(lay, bx),
        f'local _P = "{hexpayload}"',
        f"local _K1, _K2 = {k1}, {k2}",
        f"local _CS1, _CS2 = {hide(cs1)}, {hide(cs2)}",
        'if not _ld then _error("Moonslot: this environment cannot run protected payloads", 0) end',
        "local _h, _a, _b = 0, 1, 0",
        "for p = 1, #_P do local x = _sbyte(_P, p) _h = (_h * 31 + x) % 4294967296 _a = (_a + x) % 65521 _b = (_b + _a) % 65521 end",
        'if _h ~= _CS1 or _b * 65536 + _a ~= _CS2 then _error("Moonslot: integrity check failed", 0) end',
        f"local _fn, _err = _ld({lay}(_P, _K1, _K2))",
        'if not _fn then _error("Moonslot: failed to load payload: " .. _tostring(_err), 0) end',
        "return _fn(...)",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- entry points

def resolve(mode, options):
    if mode in PRESETS:
        return dict(PRESETS[mode])
    opts = dict(CUSTOM_DEFAULTS)
    for flag in ("strings", "numbers", "junk", "integrity", "payload"):
        if flag in options:
            opts[flag] = bool(options[flag])
    if "junk_density" in options:
        try:
            opts["junk_density"] = min(max(float(options["junk_density"]), 0.0), 1.0)
        except (TypeError, ValueError):
            raise LuaError("junk_density must be a number between 0 and 1.")
    return opts


def obfuscate(source, mode, signature, options):
    mode = str(mode).lower()
    if mode not in MODES:
        raise LuaError("Unknown protection level.")
    opts = resolve(mode, options)

    tokens = tokenize(source)
    if not tokens:
        raise LuaError("The script is empty.")

    header = f"-- Protected by {clean_signature(signature)} | level: {mode}\n"
    if opts["payload"]:
        inner = build_chunk(tokens, dict(opts, payload=False))
        return header + build_payload(inner)
    return header + build_chunk(tokens, opts)


@app.route("/api/obfuscate", methods=["POST"])
def obfuscate_route():
    data = request.get_json(silent=True) or {}
    code = data.get("code")
    if not isinstance(code, str) or not code.strip():
        return jsonify(error="No code was provided."), 400
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        return jsonify(error="The script is too large (max 200 KB)."), 413

    options = data.get("options") if isinstance(data.get("options"), dict) else {}
    try:
        result = obfuscate(code, data.get("mode", "medium"), data.get("customString", "[Moon]"), options)
    except LuaError as err:
        return jsonify(error=str(err)), 400
    except Exception:
        app.logger.exception("obfuscation failed")
        return jsonify(error="Internal error while protecting the script."), 500
    return jsonify(obfuscated=result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
