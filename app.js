import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====== 1. Configuración de Firebase (Plan B) ======
const firebaseConfig = {
  apiKey: "AIzaSyB5IXV8ZDHYz1VzhJPH33hYQ6WHU8GFtyo",
  authDomain: "auth.moonslot.localhost.cc", // ✅ Subdominio seguro para evitar bloqueos
  projectId: "moonslot-d9f74",
  storageBucket: "moonslot-d9f74.firebasestorage.app",
  messagingSenderId: "1061318532737",
  appId: "1:1061318532737:web:5c3de74d16d1453dc73780",
  measurementId: "G-91F8QJVWGM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// ====== 2. URLs del Backend ======
const API_OBFUSCATE = "https://moonslot.fly.dev/api/obfuscate"; 
const API_AUTH = "https://moonslot.fly.dev/api/auth"; 

let currentUser = null;

// ====== 3. Sistema de Notificaciones "Toast" (Estilo Reactivo) ======
// Esto inyecta CSS dinámicamente para que no tengas que tocar tu HTML
const toastStyle = document.createElement('style');
toastStyle.textContent = `
  .moon-toast {
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    padding: 12px 24px; border-radius: 8px; font-weight: 600;
    color: white; z-index: 9999; font-family: sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5); transition: opacity 0.3s;
    opacity: 0; pointer-events: none;
  }
  .moon-toast.show { opacity: 1; }
  .moon-toast.error { background: #ef4444; border: 1px solid #dc2626; }
  .moon-toast.success { background: #10b981; border: 1px solid #059669; }
  .moon-toast.info { background: #3b82f6; border: 1px solid #2563eb; }
`;
document.head.appendChild(toastStyle);

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `moon-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Animación de entrada
  setTimeout(() => toast.classList.add("show"), 10);
  
  // Desaparece después de 4 segundos
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ====== 4. Lógica de Autenticación ======
window.addEventListener("moon:signin", async (e) => {
  // Buscamos el botón para darle efecto de carga
  const loginBtn = document.getElementById("google-login");
  const originalHTML = loginBtn.innerHTML;
  
  loginBtn.innerHTML = `<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Conectando...`;
  loginBtn.disabled = true;

  try {
    await signInWithPopup(auth, provider);
    // El onAuthStateChanged se encargará de cambiar la pantalla
  } catch (error) {
    console.error("Error de login:", error);
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
      showToast("Inicio de sesión cancelado.", "info");
    } else if (error.code === "auth/unauthorized-domain") {
      showToast("Dominio no autorizado. Revisa Firebase.", "error");
    } else {
      showToast(`Error: ${error.code}`, "error");
    }
  } finally {
    loginBtn.innerHTML = originalHTML;
    loginBtn.disabled = false;
  }
});

window.addEventListener("moon:signout", () => {
  signOut(auth);
  showToast("Sesión cerrada correctamente.", "info");
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  window.dispatchEvent(new CustomEvent("moon:auth", {
    detail: user ? { email: user.email } : null
  }));

  // 🚨 GUARDAR EN SUPABASE: Enviamos el usuario a tu backend de Python
  if (user && user.email) {
    try {
      await fetch(API_AUTH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, uid: user.uid })
      });
      showToast(`Bienvenido, ${user.email.split('@')[0]}`, "success");
    } catch (err) {
      console.warn("No se pudo guardar el usuario en la BD.");
    }
  }
});

// ====== 5. Lógica del Obfuscador ======
const $ = (id) => document.getElementById(id);
const inputCode = $("input-code");
const outputCode = $("output-code");
const customSignature = $("custom-signature");
const modeSelect = $("obfuscation-mode");

const oldButton = $("obfuscate-btn");
const button = oldButton.cloneNode(true);
oldButton.replaceWith(button);
const idleHTML = button.innerHTML;

const spinnerHTML = `
  <svg class="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg> Protegiendo...`;

button.addEventListener("click", async () => {
  const code = inputCode.value.trim();
  
  if (!code) return showToast("Por favor, pega tu código Lua primero.", "error");
  if (!currentUser) return showToast("Debes iniciar sesión para usar el obfuscador.", "error");

  button.disabled = true;
  button.innerHTML = spinnerHTML;
  outputCode.value = "Procesando en el servidor...";

  try {
    const response = await fetch(API_OBFUSCATE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code,
        mode: modeSelect.value,
        customString: customSignature.value.trim() || "[Moon]",
        options: {}
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `Error (${response.status}).`);

    outputCode.value = data.obfuscated;
    showToast("¡Script protegido con éxito!", "success");
  } catch (error) {
    console.error(error);
    outputCode.value = "";
    showToast(error instanceof TypeError ? "Fallo de conexión con Python." : error.message, "error");
  } finally {
    button.innerHTML = idleHTML;
    button.disabled = false;
  }
});

// Animación para el botón de copiar
const copyBtn = $("copy-btn");
if (copyBtn) {
    copyBtn.addEventListener("click", () => {
        if(!outputCode.value) return showToast("No hay código para copiar.", "info");
        // La función de copiar real ya está en tu index.html, solo añadimos feedback visual
        showToast("Código copiado al portapapeles.", "success");
    });
}
