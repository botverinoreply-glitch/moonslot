import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====== 1. Configuración de Firebase ======
const firebaseConfig = {
  apiKey: "AIzaSyB5IXV8ZDHYz1VzhJPH33hYQ6WHU8GFtyo",
  authDomain: "moonslot.localhost.cc", // ✅ Clave para que funcione en tu dominio
  projectId: "moonslot-d9f74",
  storageBucket: "moonslot-d9f74.firebasestorage.app",
  messagingSenderId: "1061318532737",
  appId: "1:1061318532737:web:5c3de74d16d1453dc73780",
  measurementId: "G-91F8QJVWGM"
};

// ====== 2. URL de tu Motor Python ======
// ⚠️ Si creaste el proyecto de Python en Enzonic, cambia esta URL por la de Enzonic.
// Si sigue en Fly.io, déjala así.
const API_URL = "https://moonslot.fly.dev/api/obfuscate"; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;

// ====== 3. Lógica de Autenticación (POPUP) ======
window.addEventListener("moon:signin", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Error de login:", error);
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") return;
    
    const message = error.code === "auth/unauthorized-domain"
      ? "Este dominio no está autorizado en Firebase. Agrégalo en Authentication > Settings."
      : "Error al iniciar sesión. Inténtalo de nuevo.";
      
    window.dispatchEvent(new CustomEvent("moon:error", { detail: message }));
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

// ====== 4. Lógica del Obfuscador ======
const $ = (id) => document.getElementById(id);
const inputCode = $("input-code");
const outputCode = $("output-code");
const customSignature = $("custom-signature");
const modeSelect = $("obfuscation-mode");

// Clonamos el botón para eliminar cualquier evento falso que traiga el index.html
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
  
  if (!code) {
    alert("Por favor, pega tu código Lua primero.");
    return;
  }
  if (!currentUser) {
    alert("Debes iniciar sesión para usar el obfuscador.");
    return;
  }

  button.disabled = true;
  button.innerHTML = spinnerHTML;
  outputCode.value = "Procesando en el servidor...";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: code,
        mode: modeSelect.value,
        customString: customSignature.value.trim() || "[Moon]",
        options: {}
      })
    });

    const data = await response.json().catch(() => ({}));
    
    if (!response.ok || data.error) {
      throw new Error(data.error || `Error del servidor (${response.status}).`);
    }

    outputCode.value = data.obfuscated;
  } catch (error) {
    console.error(error);
    outputCode.value = "";
    const message = error instanceof TypeError
      ? "No se pudo conectar al servidor. Revisa la URL y el CORS en tu backend de Python."
      : error.message;
    alert(message);
  } finally {
    button.innerHTML = idleHTML;
    button.disabled = false;
  }
});
