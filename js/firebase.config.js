// firebase.config.js — CC Tracker · Musicala
// La Firebase Web API Key puede vivir en frontend; NO reemplaza la validación del backend.
// La seguridad real ocurre en Apps Script validando el Firebase ID Token en cada petición.

window.CC_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDFGT37lD7-lUfUt-9_FE96YkdumV06Lm0",
  authDomain: "cc-tracker-29536.firebaseapp.com",
  projectId: "cc-tracker-29536",
  storageBucket: "cc-tracker-29536.firebasestorage.app",
  messagingSenderId: "443160720839",
  appId: "1:443160720839:web:670fe8df9b53477e4b15e2"
};

window.CC_ALLOWED_EMAILS = [
  "alekcaballeromusic@gmail.com"
];

window.CC_RUNTIME_CONFIG = {
  backendMode: "apps_script",
  // Si al desplegar Apps Script te entrega otra URL /exec, reemplázala aquí.
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbw6G9OZVal5QVg54tG2PCba6EaCVqfckkuzKA0mMvrqGvasj37rIQz2ca43zXr-Jz1lMw/exec",
  timeoutMs: 20000
};
