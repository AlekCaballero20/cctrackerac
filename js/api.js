// api.js â€” CC Tracker Â· Musicala (v2.0)
// Responsable de:
// - Resolver configuraciÃ³n de backend sin humo
// - Soportar backend real por proxy o Apps Script
// - Normalizar GET/POST con timeout y errores Ãºtiles
// - Mantener API estable para app.js: window.CC_API.get/post/isRealBackend
// - Exponer estado de backend para UI/diagnÃ³stico
//
// Requiere utils.js si existe (window.CC_UTILS), pero no depende de Ã©l.

(() => {
  "use strict";

  /* -------------------------------------------------------------------------- */
  /* Utils fallback                                                              */
  /* -------------------------------------------------------------------------- */
  const U = window.CC_UTILS || {};

  const safeNum = U.safeNum || ((value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  });

  const clamp = U.clamp || ((n, min, max) => Math.max(min, Math.min(max, n)));

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalDateParts(date = new Date()) {
    return {
      y: date.getFullYear(),
      m: date.getMonth() + 1,
      d: date.getDate()
    };
  }

  const todayISO = U.todayISO || (() => {
    const { y, m, d } = toLocalDateParts(new Date());
    return `${y}-${pad2(m)}-${pad2(d)}`;
  });

  const monthISO = U.monthISO || ((date = new Date()) => {
    const { y, m } = toLocalDateParts(date);
    return `${y}-${pad2(m)}`;
  });

  const parseMonth = U.parseMonth || ((value) => {
    if (!/^\d{4}-\d{2}$/.test(String(value || "").trim())) return null;
    const [y, m] = String(value).split("-").map(Number);
    return new Date(y, m - 1, 1);
  });

  const addMonths = U.addMonths || ((yyyyMm, delta) => {
    const base = parseMonth(yyyyMm) || new Date();
    const d = new Date(base.getFullYear(), base.getMonth(), 1);
    d.setMonth(d.getMonth() + Number(delta || 0));
    return monthISO(d);
  });

  function structuredCloneSafe(obj) {
    try {
      return structuredClone(obj);
    } catch (_) {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  function deepMerge(base, extra) {
    const out = { ...(base || {}) };
    for (const [key, value] of Object.entries(extra || {})) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        out[key] &&
        typeof out[key] === "object" &&
        !Array.isArray(out[key])
      ) {
        out[key] = deepMerge(out[key], value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /* -------------------------------------------------------------------------- */
  /* ConfiguraciÃ³n                                                               */
  /* -------------------------------------------------------------------------- */
  // Pueden sobreescribir esto ANTES de cargar api.js:
  // window.CC_RUNTIME_CONFIG = {
  //   backendMode: "proxy", // "auto" | "proxy" | "apps_script"
  //   proxyUrl: "https://su-proxy.com/api/cc-tracker",
  //   appsScriptUrl: "https://script.google.com/macros/s/.../exec",
  //   timeoutMs: 15000
  // };

  const DEFAULT_CONFIG = {
    backendMode: "auto",
    proxyUrl: "",
    // Completar en js/firebase.config.js o mediante window.CC_RUNTIME_CONFIG.
    appsScriptUrl: "https://script.google.com/macros/s/AKfycbysV7GraldQBWfa0OcBmz3k057AqbB6eeAxmUGJoN2Q0ux2gLIvyPBVrANoC87V-XREuA/exec",
    apiToken: "cctrackerac", // legado opcional; la seguridad real ahora es Firebase Auth validado en Apps Script.
    timeoutMs: 15000
  };

  const STORAGE_KEY = "CC_TRACKER_RUNTIME_CONFIG";

  function readStoredConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function writeStoredConfig(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config || {}));
    } catch (_) {
      // silencio elegante, porque el navegador ya bastante molesta
    }
  }

  function normalizeUrl(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) return "";

    // Si accidentalmente pegaron varias URLs juntas, toma la primera vÃ¡lida.
    const matches = raw.match(/https?:\/\/[^\s"]+/gi) || [];
    if (!matches.length) return "";

    let selected = matches[0];

    // Prefiere una que termine en /exec o /dev si existe.
    const preferred = matches.find((url) => /\/(exec|dev)(\?|$)/i.test(url));
    if (preferred) selected = preferred;

    // Limpia basura pegada despuÃ©s de /exec o /dev
    selected = selected.replace(/(\/exec|\/dev).*$/i, "$1");

    try {
      return new URL(selected).toString();
    } catch (_) {
      return "";
    }
  }

  function getRuntimeConfig() {
    const fromWindow = window.CC_RUNTIME_CONFIG || {};
    const fromStorage = readStoredConfig();
    const merged = deepMerge(DEFAULT_CONFIG, deepMerge(fromStorage, fromWindow));

    merged.proxyUrl = normalizeUrl(merged.proxyUrl);
    merged.appsScriptUrl = normalizeUrl(merged.appsScriptUrl);
    merged.backendMode = String(merged.backendMode || "auto").toLowerCase();

    if (!["auto", "proxy", "apps_script"].includes(merged.backendMode)) {
      merged.backendMode = "auto";
    }

    merged.timeoutMs = safeNum(merged.timeoutMs, DEFAULT_CONFIG.timeoutMs);

    return merged;
  }

  let RUNTIME_CONFIG = getRuntimeConfig();

  function setRuntimeConfig(partialConfig = {}, { persist = true } = {}) {
    RUNTIME_CONFIG = deepMerge(RUNTIME_CONFIG, partialConfig || {});
    RUNTIME_CONFIG.proxyUrl = normalizeUrl(RUNTIME_CONFIG.proxyUrl);
    RUNTIME_CONFIG.appsScriptUrl = normalizeUrl(RUNTIME_CONFIG.appsScriptUrl);

    if (persist) writeStoredConfig(RUNTIME_CONFIG);

    syncPublicState();
    return getRuntimeConfigSnapshot();
  }

  function getRuntimeConfigSnapshot() {
    return {
      backendMode: RUNTIME_CONFIG.backendMode,
      proxyUrl: RUNTIME_CONFIG.proxyUrl,
      appsScriptUrl: RUNTIME_CONFIG.appsScriptUrl,
      timeoutMs: RUNTIME_CONFIG.timeoutMs,
      hasFirebaseAuth: Boolean(window.CC_AUTH && typeof window.CC_AUTH.getIdToken === "function"),
      hasApiToken: Boolean(String(RUNTIME_CONFIG.apiToken || "").trim())
    };
  }

  function isLikelyLocalDev() {
    const host = window.location.hostname;
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "" ||
      host.endsWith(".local")
    );
  }

  function resolveBackendTarget() {
    const mode = RUNTIME_CONFIG.backendMode;
    const hasProxy = Boolean(RUNTIME_CONFIG.proxyUrl);
    const hasAppsScript = Boolean(RUNTIME_CONFIG.appsScriptUrl);

    if (mode === "proxy") {
      return hasProxy
        ? { type: "proxy", url: RUNTIME_CONFIG.proxyUrl, reason: "Modo proxy" }
        : { type: "not_configured", url: "", reason: "Modo proxy sin proxyUrl" };
    }

    if (mode === "apps_script") {
      return hasAppsScript
        ? { type: "apps_script", url: RUNTIME_CONFIG.appsScriptUrl, reason: "Modo Apps Script" }
        : { type: "not_configured", url: "", reason: "Modo Apps Script sin appsScriptUrl" };
    }

    // auto
    if (hasProxy) {
      return { type: "proxy", url: RUNTIME_CONFIG.proxyUrl, reason: "Auto â†’ proxy" };
    }

    if (hasAppsScript) {
      return { type: "apps_script", url: RUNTIME_CONFIG.appsScriptUrl, reason: "Auto â†’ Apps Script" };
    }

    return { type: "not_configured", url: "", reason: "Auto: backend sin configurar" };
  }

  function isRealBackend() {
    const target = resolveBackendTarget();
    return target.type === "proxy" || target.type === "apps_script";
  }

  /* -------------------------------------------------------------------------- */
  /* Estado pÃºblico                                                              */
  /* -------------------------------------------------------------------------- */
  const PUBLIC_STATE = {
    mode: "not_configured",
    reason: "",
    url: "",
    isLocalDev: isLikelyLocalDev(),
    hasRealBackend: false
  };

  function syncPublicState() {
    const target = resolveBackendTarget();
    PUBLIC_STATE.mode = target.type;
    PUBLIC_STATE.reason = target.reason;
    PUBLIC_STATE.url = target.url;
    PUBLIC_STATE.isLocalDev = isLikelyLocalDev();
    PUBLIC_STATE.hasRealBackend = isRealBackend();

    window.CC_CONST = {
      BACKEND_MODE: RUNTIME_CONFIG.backendMode,
      TARGET_MODE: PUBLIC_STATE.mode,
      TARGET_URL: PUBLIC_STATE.url
    };
  }

  syncPublicState();

  /* -------------------------------------------------------------------------- */
  /* Errores                                                                     */
  /* -------------------------------------------------------------------------- */
  function createApiError(message, extra = {}) {
    const err = new Error(message);
    Object.assign(err, extra);
    return err;
  }

  function normalizeThrownError(err, context = {}) {
    const rawMessage = err?.message ? String(err.message) : String(err || "Error desconocido");
    const target = resolveBackendTarget();

    if (err?.name === "AbortError" || /aborted/i.test(rawMessage)) {
      return createApiError("La peticiÃ³n tardÃ³ demasiado y fue cancelada.", {
        code: "TIMEOUT",
        cause: err,
        context
      });
    }

    if (/failed to fetch/i.test(rawMessage)) {
      if (target.type === "apps_script" && isLikelyLocalDev()) {
        return createApiError(
          "No se pudo conectar. EstÃ¡n intentando hablarle directo a Apps Script desde localhost/127.0.0.1 y eso suele estrellarse por CORS. Para desarrollo usen un proxy o publiquen la app desde un origen permitido.",
          { code: "CORS_LOCALHOST_APPS_SCRIPT", cause: err, context }
        );
      }

      return createApiError(
        "No se pudo conectar con el backend. Revisa la URL, la publicaciÃ³n del Web App/proxy y la configuraciÃ³n de acceso.",
        { code: "NETWORK_FETCH_FAILED", cause: err, context }
      );
    }

    return createApiError(rawMessage, {
      code: err?.code || "API_ERROR",
      cause: err,
      context
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Fetch helpers                                                               */
  /* -------------------------------------------------------------------------- */
  function withTimeout(signal, ms) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);

    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    return {
      signal: controller.signal,
      clear() {
        clearTimeout(timeoutId);
      }
    };
  }

  function appendQuery(urlString, params = {}) {
    const url = new URL(urlString);

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });

    return url;
  }

  async function resolveFirebaseIdToken() {
    if (!window.CC_AUTH || typeof window.CC_AUTH.getIdToken !== "function") {
      throw createApiError("Firebase Auth no estÃ¡ cargado. Revisa que js/auth.js se estÃ© cargando antes de usar la API.", {
        code: "FIREBASE_AUTH_MISSING"
      });
    }

    const token = await window.CC_AUTH.getIdToken();
    if (!token) {
      throw createApiError("No hay sesiÃ³n Firebase vÃ¡lida. Inicia sesiÃ³n otra vez.", {
        code: "FIREBASE_TOKEN_MISSING"
      });
    }

    return token;
  }

  async function buildRequestDescriptor(method, paramsOrAction, payload) {
    const target = resolveBackendTarget();
    const token = String(RUNTIME_CONFIG.apiToken || "").trim();

    if (!target.url) {
      throw createApiError("No hay URL de backend configurada.", { code: "BACKEND_URL_MISSING" });
    }

    if (target.type === "proxy") {
      if (method === "GET") {
        const url = appendQuery(target.url, paramsOrAction || {});
        return {
          target,
          url: url.toString(),
          options: {
            method: "GET",
            headers: {
              Accept: "application/json"
            }
          }
        };
      }

      return {
        target,
        url: target.url,
        options: {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=utf-8",
            Accept: "application/json"
          },
          body: JSON.stringify({
            action: paramsOrAction,
            ...(payload || {})
          })
        }
      };
    }

    // apps_script
    // Apps Script + GitHub Pages: evitamos headers personalizados y mandamos TODO por POST
    // con text/plain para no disparar preflight CORS. SÃ­, internet eligiÃ³ este carnaval.
    const firebaseIdToken = await resolveFirebaseIdToken();
    const legacyToken = String(RUNTIME_CONFIG.apiToken || "").trim();

    const body = method === "GET"
      ? { ...(paramsOrAction || {}), firebaseIdToken }
      : { action: paramsOrAction, ...(payload || {}), firebaseIdToken };

    if (legacyToken) {
      body.token = legacyToken;
    }

    return {
      target,
      url: target.url,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      }
    };
  }

  async function readResponsePayload(response) {
    const rawText = await response.text();

    if (!rawText) {
      return {
        ok: response.ok,
        data: null,
        error: response.ok ? null : `HTTP ${response.status}`
      };
    }

    try {
      return JSON.parse(rawText);
    } catch (_) {
      if (!response.ok) {
        throw createApiError(`HTTP ${response.status}: ${rawText.slice(0, 180)}`, {
          code: "HTTP_TEXT_ERROR"
        });
      }

      throw createApiError(
        `El backend respondiÃ³ algo que no es JSON: ${rawText.slice(0, 180)}`,
        { code: "INVALID_JSON_RESPONSE" }
      );
    }
  }

  function normalizeApiResponse(payload, fallback = {}) {
    if (payload && typeof payload === "object" && "ok" in payload) {
      return payload;
    }

    return {
      ok: true,
      data: payload ?? fallback.data ?? null
    };
  }

  async function performRequest(method, paramsOrAction, payload, opts = {}) {
    const timeoutMs = safeNum(opts.timeoutMs, RUNTIME_CONFIG.timeoutMs || DEFAULT_CONFIG.timeoutMs);

    const currentTarget = resolveBackendTarget();
    if (currentTarget.type === "not_configured") {
      throw createApiError("Backend sin configurar. Revisa appsScriptUrl en js/firebase.config.js.", {
        code: "BACKEND_NOT_CONFIGURED"
      });
    }

    let descriptor;
    try {
      descriptor = await buildRequestDescriptor(method, paramsOrAction, payload);
    } catch (err) {
      throw normalizeThrownError(err, { method, paramsOrAction });
    }

    const { signal, clear } = withTimeout(opts.signal, timeoutMs);

    try {
      const response = await fetch(descriptor.url, {
        ...descriptor.options,
        signal
      });

      const parsed = await readResponsePayload(response);

      if (!response.ok) {
        const message =
          parsed?.error ||
          parsed?.message ||
          `HTTP ${response.status}`;

        throw createApiError(message, {
          code: "HTTP_ERROR",
          status: response.status,
          responsePayload: parsed
        });
      }

      const normalized = normalizeApiResponse(parsed);

      if (!normalized.ok) {
        throw createApiError(
          normalized.error || normalized.message || "El backend respondiÃ³ ok:false",
          {
            code: "BACKEND_NOT_OK",
            responsePayload: normalized
          }
        );
      }

      return normalized;
    } catch (err) {
      throw normalizeThrownError(err, { method, paramsOrAction });
    } finally {
      clear();
    }
  }

  async function get(params = {}, opts = {}) {
    return performRequest("GET", params, null, opts);
  }

  async function post(action, payload = {}, opts = {}) {
    if (!action) {
      throw createApiError("post(action, payload) requiere action.", {
        code: "POST_ACTION_REQUIRED"
      });
    }

    return performRequest("POST", action, payload, opts);
  }

  /* -------------------------------------------------------------------------- */
  /* API pública                                                                 */
  /* -------------------------------------------------------------------------- */
  window.CC_API = {
    get,
    post,
    isRealBackend,

    getBackendState() {
      return structuredCloneSafe(PUBLIC_STATE);
    },

    getRuntimeConfig() {
      return getRuntimeConfigSnapshot();
    },

    setRuntimeConfig
  };
})();


