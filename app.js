import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB5IXV8ZDHYz1VzhJPH33hYQ6WHU8GFtyo",
  authDomain: "moonslot-d9f74.firebaseapp.com", // Volvemos al original, es más seguro en móviles
  projectId: "moonslot-d9f74",
  storageBucket: "moonslot-d9f74.firebasestorage.app",
  messagingSenderId: "1061318532737",
  appId: "1:1061318532737:web:5c3de74d16d1453dc73780",
  measurementId: "G-91F8QJVWGM"
};

const API_URL = "https://moonslot.fly.dev/api/obfuscate"; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;

window.addEventListener("moon:signin", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    // 🚨 AQUÍ ESTÁ LA MAGIA: Esto te mostrará el error en pantalla
    alert("ERROR REAL DE FIREBASE:\n" + error.code + "\n\n" + error.message);
    
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") return;
    
    const message = error.code === "auth/unauthorized-domain"
      ? "Este dominio no está autorizado en Firebase."
      : "Error al iniciar sesión.";
      
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
  
  if (!code) return alert("Por favor, pega tu código Lua primero.");
  if (!currentUser) return alert("Debes iniciar sesión para usar el obfuscador.");

  button.disabled = true;
  button.innerHTML = spinnerHTML;
  outputCode.value = "Procesando en el servidor...";

  try {
    const response = await fetch(API_URL, {
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
    if (!response.ok || data.error) throw new Error(data.error || `Error del servidor (${response.status}).`);

    outputCode.value = data.obfuscated;
  } catch (error) {
    console.error(error);
    outputCode.value = "";
    alert(error instanceof TypeError ? "No se pudo conectar al servidor de Python." : error.message);
  } finally {
    button.innerHTML = idleHTML;
    button.disabled = false;
  }
});
