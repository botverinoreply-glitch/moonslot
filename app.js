import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInWithRedirect,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====== Configuración de Firebase ======
const firebaseConfig = {
  apiKey: "AIzaSyB5IXV8ZDHYz1VzhJPH33hYQ6WHU8GFtyo",
  authDomain: "moonslot-d9f74.firebaseapp.com",
  projectId: "moonslot-d9f74",
  storageBucket: "moonslot-d9f74.firebasestorage.app",
  messagingSenderId: "1061318532737",
  appId: "1:1061318532737:web:5c3de74d16d1453dc73780",
  measurementId: "G-91F8QJVWGM"
};

// ====== URL del Backend (Fly.io) ======
const API_URL = "https://moonslot.fly.dev/api/obfuscate";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;

// ====== Manejo de Autenticación ======

// Atrapar el resultado cuando el usuario vuelve de la página de Google
getRedirectResult(auth)
  .then((result) => {
    if (result && result.user) {
      console.log("Sesión iniciada con éxito:", result.user.email);
    }
  })
  .catch((error) => {
    console.error("Error en redirect:", error);
    const message = error.code === "auth/unauthorized-domain"
      ? "Este dominio no está autorizado en Firebase. Agrégalo en Authentication > Settings > Authorized domains."
      : "Error al iniciar sesión. Inténtalo de nuevo.";
    window.dispatchEvent(new CustomEvent("moon:error", { detail: message }));
  });

// Escuchar cuando el usuario hace clic en "Login" desde el HTML
window.addEventListener("moon:signin", async () => {
  try {
    await signInWithRedirect(auth, provider);
  } catch (error) {
    const message = error.code === "auth/unauthorized-domain"
      ? "Este dominio no está autorizado en Firebase. Agrégalo en Authentication > Settings > Authorized domains."
      : "Error al iniciar sesión. Inténtalo de nuevo.";
    window.dispatchEvent(new CustomEvent("moon:error", { detail: message }));
  }
});

// Escuchar cuando el usuario cierra sesión
window.addEventListener("moon:signout", () => {
  signOut(auth);
});

// Mantener el HTML actualizado con el estado del usuario
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  window.dispatchEvent(new CustomEvent("moon:auth", {
    detail: user ? { email: user.email } : null
  }));
});

// ====== Lógica del Obfuscador ======

const $ = (id) => document.getElementById(id);
const inputCode = $("input-code");
const outputCode = $("output-code");
const customSignature = $("custom-signature");
const modeSelect = $("obfuscation-mode");

// Clonamos el botón para eliminar el evento falso que trae el index.html
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
    // Enviamos la petición a Fly.io
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
    
    // Si el error es de conexión, avisamos sobre CORS
    const message = error instanceof TypeError
      ? "No se pudo conectar al servidor. Revisa la URL y la configuración de CORS en Fly.io."
      : error.message;
    alert(message);
  } finally {
    button.innerHTML = idleHTML;
    button.disabled = false;
  }
});
