import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====== Firebase ======
const firebaseConfig = {
  apiKey: "AIzaSyB5IXV8ZDHYz1VzhJPH33hYQ6WHU8GFtyo",
  authDomain: "moonslot-d9f74.firebaseapp.com",
  projectId: "moonslot-d9f74",
  storageBucket: "moonslot-d9f74.firebasestorage.app",
  messagingSenderId: "1061318532737",
  appId: "1:1061318532737:web:5c3de74d16d1453dc73780",
  measurementId: "G-91F8QJVWGM"
};

// ====== Backend (Fly.io or your own domain) ======
const API_URL = "https://moonslot.fly.dev/api/obfuscate";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;

// ====== Auth bridge with index.html ======
window.addEventListener("moon:signin", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") return;

    const message = error.code === "auth/unauthorized-domain"
      ? "This domain is not authorized in Firebase. Add it under Authentication > Settings > Authorized domains."
      : "Sign in failed. Please try again.";

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
