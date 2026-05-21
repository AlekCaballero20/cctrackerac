// auth.js — Firebase Authentication para CC Tracker · Musicala
// Controla pantalla de login, sesión, correo autorizado y entrega ID Token a api.js.

(() => {
  "use strict";

  const AUTH_EVENT = "cc-auth-state";
  const config = window.CC_FIREBASE_CONFIG || null;
  const allowedEmails = (window.CC_ALLOWED_EMAILS || [])
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(Boolean);

  let auth = null;
  let currentUser = null;
  let authorized = false;
  let initialized = false;
  let lastError = "";
  let blockedEmailError = "";
  let readySettled = false;
  let resolveReady;

  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function settleReady(value) {
    if (readySettled) return;
    readySettled = true;
    resolveReady(Boolean(value));
  }

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setAuthBodyState(state) {
    if (!document.body) return;
    document.body.classList.toggle("auth-pending", state === "pending");
    document.body.classList.toggle("auth-blocked", state === "blocked");
    document.body.classList.toggle("auth-ready", state === "ready");
  }

  function dispatchAuthState() {
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, {
      detail: {
        authorized,
        email: currentUser?.email || "",
        uid: currentUser?.uid || "",
        error: lastError
      }
    }));
  }

  function ensureAuthScreen() {
    if (!document.body) return null;

    let screen = $("#authScreen");
    if (screen) return screen;

    screen = document.createElement("section");
    screen.id = "authScreen";
    screen.className = "authScreen";
    screen.setAttribute("aria-live", "polite");
    screen.innerHTML = `
      <div class="authCard">
        <div class="authLogo" aria-hidden="true">💳</div>
        <div>
          <p class="eyebrow">CC Tracker · Musicala</p>
          <h1>Inicia sesión para continuar</h1>
          <p class="authText">
            Esta app solo permite el acceso al correo autorizado. Porque abrir datos financieros al público sería una forma creativa de perder la paz.
          </p>
        </div>
        <div class="authAllowed" id="authAllowed" hidden></div>
        <div class="authError" id="authError" hidden></div>
        <button type="button" class="btn authGoogleBtn" id="btnGoogleLogin">
          Entrar con Google
        </button>
      </div>
    `;

    document.body.appendChild(screen);

    const btn = $("#btnGoogleLogin", screen);
    if (btn) {
      btn.addEventListener("click", async () => {
        try {
          btn.disabled = true;
          btn.textContent = "Abriendo Google…";
          await signInWithGoogle();
        } catch (err) {
          lastError = err?.message || String(err || "Error iniciando sesión");
          renderAuthUI();
        } finally {
          btn.disabled = false;
          btn.textContent = "Entrar con Google";
        }
      });
    }

    return screen;
  }

  function ensureTopbarAuthUI() {
    const right = $(".topbar .right");
    if (!right || $("#authUserChip")) return;

    const chip = document.createElement("div");
    chip.className = "authUserChip";
    chip.id = "authUserChip";
    chip.hidden = true;
    right.appendChild(chip);

    const logout = document.createElement("button");
    logout.className = "btn ghost";
    logout.id = "btnLogout";
    logout.type = "button";
    logout.textContent = "Salir";
    logout.hidden = true;
    logout.addEventListener("click", () => signOut());
    right.appendChild(logout);
  }

  function renderTopbarAuthUI() {
    ensureTopbarAuthUI();

    const chip = $("#authUserChip");
    const logout = $("#btnLogout");

    if (chip) {
      chip.hidden = !authorized;
      chip.textContent = authorized ? (currentUser?.email || "Sesión activa") : "";
    }

    if (logout) {
      logout.hidden = !authorized;
    }
  }

  function renderAuthUI() {
    const screen = ensureAuthScreen();
    if (!screen) return;

    const allowed = $("#authAllowed", screen);
    const error = $("#authError", screen);

    if (allowed) {
      allowed.hidden = true;
      allowed.textContent = "";
    }

    if (error) {
      error.hidden = !lastError;
      error.textContent = lastError;
    }

    screen.hidden = authorized;
    renderTopbarAuthUI();
  }

  async function signInWithGoogle() {
    if (!auth) throw new Error("Firebase Auth todavía no está listo");
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return auth.signInWithPopup(provider);
  }

  async function signOut() {
    if (!auth) return;
    await auth.signOut();
  }

  async function initAuth() {
    setAuthBodyState("pending");

    try {
      if (!config || !config.apiKey || !config.authDomain || !config.projectId) {
        throw new Error("Falta window.CC_FIREBASE_CONFIG en js/firebase.config.js");
      }

      if (!allowedEmails.length) {
        throw new Error("Falta configurar window.CC_ALLOWED_EMAILS");
      }

      if (!window.firebase || !firebase.initializeApp || !firebase.auth) {
        throw new Error("No cargaron los scripts de Firebase Auth");
      }

      if (!firebase.apps.length) firebase.initializeApp(config);
      auth = firebase.auth();
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      initialized = true;

      auth.onAuthStateChanged(async (user) => {
        const email = String(user?.email || "").trim().toLowerCase();

        if (user && allowedEmails.includes(email)) {
          currentUser = user;
          authorized = true;
          lastError = "";
          blockedEmailError = "";
          setAuthBodyState("ready");
          renderAuthUI();
          settleReady(true);
          dispatchAuthState();
          return;
        }

        if (user && !allowedEmails.includes(email)) {
          blockedEmailError = `El correo ${email || "sin email"} no está autorizado para esta app.`;
          authorized = false;
          currentUser = null;
          await auth.signOut();
          return;
        }

        currentUser = null;
        authorized = false;
        lastError = blockedEmailError || "";
        blockedEmailError = "";
        setAuthBodyState("blocked");
        renderAuthUI();
        settleReady(false);
        dispatchAuthState();
      });
    } catch (err) {
      initialized = false;
      authorized = false;
      currentUser = null;
      lastError = err?.message || String(err || "Error iniciando Firebase Auth");
      setAuthBodyState("blocked");
      renderAuthUI();
      settleReady(false);
      dispatchAuthState();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    ensureAuthScreen();
    ensureTopbarAuthUI();
    renderAuthUI();
  });

  window.CC_AUTH = {
    waitUntilReady() {
      return readyPromise;
    },

    isInitialized() {
      return initialized;
    },

    isAuthorized() {
      return authorized;
    },

    getUser() {
      return currentUser;
    },

    async getIdToken(forceRefresh = false) {
      if (!authorized || !currentUser) {
        throw new Error("No hay sesión autorizada");
      }
      return currentUser.getIdToken(forceRefresh);
    },

    signInWithGoogle,
    signOut
  };

  initAuth();
})();
