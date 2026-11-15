import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====== Firebase (copied from Firebase Console > Project settings > Your apps) ======
const firebaseConfig = {
  apiKey: "AIzaSyBsIXV8ZDhYziVzHjP33H8yQW5HJ8GFtyo",
  authDomain: "moonslot-d9f74.firebaseapp.com",
  projectId: "moonslot-d9f74",
  storageBucket: "moonslot-d9f74.firebasestorage.app",
  messagingSenderId: "1061318532737",
  appId: "1:1061318532737:web:5c3de74d16d1453dc73780",
  measurementId: "G-91FBQJVVGM"
};

// ====== Backend (Fly.io or your own domain) ======
const API_URL = "https://moonslot.fly.dev/api/obfuscate";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const AUTH_ERRORS = {
  "auth/unauthorized-domain": "This domain is not authorized in Firebase. Add it under Authentication > Settings > Authorized domains.",
  "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase. Enable it under Authentication > Sign-in method.",
  "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/api-key-not-valid": "The Firebase API key is invalid. Copy the config again from Firebase Console.",
  "auth/requests-from-referer-blocked": "This site is blocked by the API key restrictions in Google Cloud Console."
};

let currentUser = null;

// ====== Returning from Google redirect (mobile) ======
getRedirectResult(auth).catch((error) => {
  console.error("Redirect login error:", error.code, error.message);
  window.dispatchEvent(new CustomEvent("moon:error", {
    detail: AUTH_ERRORS[error.code] || `Sign in failed (${error.code}).`
  }));
});

// ====== Auth bridge with index.html ======
window.addEventListener("moon:signin", async () => {
  try {
    if (isMobile) {
      await signInWithRedirect(auth, provider);
    } else {
      await signInWithPopup(auth, provider);
    }
  } catch (error) {
    console.error("Login error:", error.code, error.message);

    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") return;

    window.dispatchEvent(new CustomEvent("moon:error", {
      detail: AUTH_ERRORS[error.code] || `Sign in failed (${error.code}).`
    }));
  }
});

window.addEventListener("moon:signout", () => {
  signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  window.dispatchEvent(new CustomEvent("moon:auth", {
    detail: user ? { email: user.email } : null
  }));
});

// ====== Protection tool ======
const $ = (id) => document.getElementById(id);
const inputCode = $("input-code");
const outputCode = $("output-code");
const customSignature = $("custom-signature");
const modeSelect = $("obfuscation-mode");

// Replace the button to drop the placeholder listener from index.html.
const oldButton = $("obfuscate-btn");
const button = oldButton.cloneNode(true);
oldButton.replaceWith(button);
const idleHTML = button.innerHTML;

const spinnerHTML = `
  <svg class="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg> Protecting...`;

button.addEventListener("click", async () => {
  const code = inputCode.value.trim();
  if (!code) {
    alert("Paste your Lua code first.");
    return;
  }
  if (!currentUser) {
    alert("Please sign in first.");
    return;
  }

  button.disabled = true;
  button.innerHTML = spinnerHTML;
  outputCode.value = "Processing on the server...";

  try {
    const token = await currentUser.getIdToken();

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        code,
        mode: modeSelect.value,
        customString: customSignature.value.trim() || "[Moon]",
        options: {}
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || `Server error (${response.status}).`);
    }

    outputCode.value = data.obfuscated;
  } catch (error) {
    console.error(error);
    outputCode.value = "";
    const message = error instanceof TypeError
      ? "Could not reach the server. Check the API URL and CORS settings."
      : error.message;
    alert(message);
  } finally {
    button.innerHTML = idleHTML;
    button.disabled = false;
  }
});
