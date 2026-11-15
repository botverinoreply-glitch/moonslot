import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 1. CONFIGURACIÓN DE FIREBASE (Tus datos reales)
const firebaseConfig = {
  apiKey: "AIzaSyB5IXV8ZDHYz1VzhJPH33hYQ6WHU8GFtyo",
  authDomain: "moonslot-d9f74.firebaseapp.com",
  projectId: "moonslot-d9f74",
  storageBucket: "moonslot-d9f74.firebasestorage.app",
  messagingSenderId: "1061318532737",
  appId: "1:1061318532737:web:5c3de74d16d1453dc73780",
  measurementId: "G-91F8QJVWGM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// 2. ELEMENTOS DEL DOM
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
const googleLoginBtn = document.getElementById('google-login');
const logoutBtn = document.getElementById('logout-btn');
const userEmail = document.getElementById('user-email');

const inputCode = document.getElementById('input-code');
const clearBtn = document.getElementById('clear-btn');
const customSignature = document.getElementById('custom-signature');
const modeSelect = document.getElementById('obfuscation-mode');
const obfuscateBtn = document.getElementById('obfuscate-btn');

const outputCode = document.getElementById('output-code');
const copyBtn = document.getElementById('copy-btn');
const copySuccess = document.getElementById('copy-success');

// ⚠️ AQUÍ ESTÁ LA MAGIA: Apuntamos a tu dominio de Fly.io
// Si tu backend está en tu dominio propio, usa esa URL. Si no, usa https://moonslot.fly.dev/api/obfuscate
const API_URL = 'https://moonslot.localhost.cc/api/obfuscate'; 

// 3. LÓGICA DE AUTENTICACIÓN
googleLoginBtn.addEventListener('click', () => {
    signInWithPopup(auth, provider).catch((error) => {
        console.error("Error al iniciar sesión:", error);
        alert("Error al iniciar sesión. Verifica que moonslot.localhost.cc esté en los dominios autorizados de Firebase.");
    });
});

logoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        loginSection.classList.add('hidden');
        appSection.classList.remove('hidden');
        userEmail.textContent = user.email;
    } else {
        loginSection.classList.remove('hidden');
        appSection.classList.add('hidden');
        outputCode.value = '';
    }
});

// 4. LÓGICA DEL OBFUSCADOR
obfuscateBtn.addEventListener('click', async () => {
    const code = inputCode.value.trim();
    const mode = modeSelect.value;
    const signature = customSignature.value.trim();

    if (!code) {
        alert("Por favor, ingresa código Lua para ofuscar.");
        return;
    }

    const originalBtnHTML = obfuscateBtn.innerHTML;
    obfuscateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Ofuscando...';
    obfuscateBtn.disabled = true;
    obfuscateBtn.classList.add('opacity-75', 'cursor-not-allowed');
    outputCode.value = '';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                code: code, 
                mode: mode,
                customString: signature || "[Moon]"
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Error desconocido en el servidor");
        }

        outputCode.value = data.obfuscated;

    } catch (error) {
        console.error(error);
        alert("Error de conexión con el motor de Python. Asegúrate de que Fly.io esté encendido.");
    } finally {
        obfuscateBtn.innerHTML = originalBtnHTML;
        obfuscateBtn.disabled = false;
        obfuscateBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
});

// Botones extras
clearBtn.addEventListener('click', () => {
    inputCode.value = '';
    inputCode.focus();
});

copyBtn.addEventListener('click', async () => {
    if (!outputCode.value) return;
    
    try {
        await navigator.clipboard.writeText(outputCode.value);
        copySuccess.classList.remove('opacity-0');
        
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fa-solid fa-check mr-2 text-green-400"></i> ¡Copiado!';
        
        setTimeout(() => {
            copySuccess.classList.add('opacity-0');
            copyBtn.innerHTML = originalHTML;
        }, 2000);
        
    } catch (err) {
        console.error('Error al copiar: ', err);
        alert("No se pudo copiar automáticamente.");
    }
});
