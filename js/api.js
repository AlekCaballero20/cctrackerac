// api.js — CC Tracker · Musicala (v2.0)
// Responsable de:
// - Resolver configuración de backend sin humo
// - Soportar 3 modos: proxy / apps_script / demo
// - Normalizar GET/POST con timeout y errores útiles
// - Mantener API estable para app.js: window.CC_API.get/post/isRealBackend
// - Exponer estado de backend para UI/diagnóstico
//
// Requiere utils.js si existe (window.CC_UTILS), pero no depende de él.

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
  /* Configuración                                                               */
  /* -------------------------------------------------------------------------- */
  // Pueden sobreescribir esto ANTES de cargar api.js:
  // window.CC_RUNTIME_CONFIG = {
  //   backendMode: "proxy", // "auto" | "proxy" | "apps_script" | "demo"
  //   proxyUrl: "https://su-proxy.com/api/cc-tracker",
  //   appsScriptUrl: "https://script.google.com/macros/s/.../exec",
  //   demoOnNetworkError: false,
  //   timeoutMs: 15000
  // };

  const DEFAULT_CONFIG = {
    backendMode: "auto",
    proxyUrl: "",
    // Completar en js/firebase.config.js o mediante window.CC_RUNTIME_CONFIG.
    appsScriptUrl: "",
    apiToken: "", // legado opcional; la seguridad real ahora es Firebase Auth validado en Apps Script.
    demoOnNetworkError: false,
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

    // Si accidentalmente pegaron varias URLs juntas, toma la primera válida.
    const matches = raw.match(/https?:\/\/[^\s"]+/gi) || [];
    if (!matches.length) return "";

    let selected = matches[0];

    // Prefiere una que termine en /exec o /dev si existe.
    const preferred = matches.find((url) => /\/(exec|dev)(\?|$)/i.test(url));
    if (preferred) selected = preferred;

    // Limpia basura pegada después de /exec o /dev
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

    if (!["auto", "proxy", "apps_script", "demo"].includes(merged.backendMode)) {
      merged.backendMode = "auto";
    }

    merged.timeoutMs = safeNum(merged.timeoutMs, DEFAULT_CONFIG.timeoutMs);
    merged.demoOnNetworkError = Boolean(merged.demoOnNetworkError);

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
      demoOnNetworkError: RUNTIME_CONFIG.demoOnNetworkError,
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

    if (mode === "demo") {
      return { type: "demo", url: "", reason: "Modo demo forzado" };
    }

    if (mode === "proxy") {
      return hasProxy
        ? { type: "proxy", url: RUNTIME_CONFIG.proxyUrl, reason: "Modo proxy" }
        : { type: "demo", url: "", reason: "Modo proxy sin proxyUrl" };
    }

    if (mode === "apps_script") {
      return hasAppsScript
        ? { type: "apps_script", url: RUNTIME_CONFIG.appsScriptUrl, reason: "Modo Apps Script" }
        : { type: "not_configured", url: "", reason: "Modo Apps Script sin appsScriptUrl" };
    }

    // auto
    if (hasProxy) {
      return { type: "proxy", url: RUNTIME_CONFIG.proxyUrl, reason: "Auto → proxy" };
    }

    if (hasAppsScript) {
      return { type: "apps_script", url: RUNTIME_CONFIG.appsScriptUrl, reason: "Auto → Apps Script" };
    }

    return { type: "not_configured", url: "", reason: "Auto: backend sin configurar" };
  }

  function isRealBackend() {
    const target = resolveBackendTarget();
    return target.type === "proxy" || target.type === "apps_script";
  }

  /* -------------------------------------------------------------------------- */
  /* Estado público                                                              */
  /* -------------------------------------------------------------------------- */
  const PUBLIC_STATE = {
    mode: "demo",
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
      return createApiError("La petición tardó demasiado y fue cancelada.", {
        code: "TIMEOUT",
        cause: err,
        context
      });
    }

    if (/failed to fetch/i.test(rawMessage)) {
      if (target.type === "apps_script" && isLikelyLocalDev()) {
        return createApiError(
          "No se pudo conectar. Están intentando hablarle directo a Apps Script desde localhost/127.0.0.1 y eso suele estrellarse por CORS. Para desarrollo usen un proxy o dejen la app en demo mientras montamos ese puente.",
          { code: "CORS_LOCALHOST_APPS_SCRIPT", cause: err, context }
        );
      }

      return createApiError(
        "No se pudo conectar con el backend. Revisa la URL, la publicación del Web App/proxy y la configuración de acceso.",
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
      throw createApiError("Firebase Auth no está cargado. Revisa que js/auth.js se esté cargando antes de usar la API.", {
        code: "FIREBASE_AUTH_MISSING"
      });
    }

    const token = await window.CC_AUTH.getIdToken();
    if (!token) {
      throw createApiError("No hay sesión Firebase válida. Inicia sesión otra vez.", {
        code: "FIREBASE_TOKEN_MISSING"
      });
    }

    return token;
  }

  async function buildRequestDescriptor(method, paramsOrAction, payload) {
    const target = resolveBackendTarget();
    const token = String(RUNTIME_CONFIG.apiToken || "").trim();

    if (target.type === "demo") {
      return { target, url: "", options: null };
    }

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
    // con text/plain para no disparar preflight CORS. Sí, internet eligió este carnaval.
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
        `El backend respondió algo que no es JSON: ${rawText.slice(0, 180)}`,
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

    if (currentTarget.type === "demo") {
      return method === "GET"
        ? demoGet(paramsOrAction)
        : demoPost(paramsOrAction, payload);
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
          normalized.error || normalized.message || "El backend respondió ok:false",
          {
            code: "BACKEND_NOT_OK",
            responsePayload: normalized
          }
        );
      }

      return normalized;
    } catch (err) {
      if (RUNTIME_CONFIG.demoOnNetworkError) {
        console.warn("[CC_API] Error de red. Se activa fallback DEMO.", err);
        return method === "GET"
          ? demoGet(paramsOrAction)
          : demoPost(paramsOrAction, payload);
      }

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
  /* DEMO                                                                        */
  /* -------------------------------------------------------------------------- */
  function calcInterestForInstallment(base, interesMensual, installmentIndex, totalInstallments) {
    const rate = safeNum(interesMensual, 0) / 100;
    if (!(rate > 0)) return 0;

    const total = Math.max(1, safeNum(totalInstallments, 1));
    const idx = Math.max(1, safeNum(installmentIndex, 1));
    const remaining = Math.max(1, total - idx + 1);
    const estimatedBalance = base * (remaining + 0.5);
    const interest = Math.round(estimatedBalance * rate);

    return clamp(interest, 0, Math.round(base * 0.65));
  }

  function buildDemoDb() {
    const tarjetas = [
      { idTarjeta: "t1", Nombre: "Visa", Banco: "Banco Demo", Ultimos4: "0000", interesMensual: 2.6, activa: true },
      { idTarjeta: "t2", Nombre: "Mastercard", Banco: "Banco Demo 2", Ultimos4: "1111", interesMensual: 2.1, activa: true },
      { idTarjeta: "t3", Nombre: "Amex", Banco: "Banco Demo 3", Ultimos4: "2222", interesMensual: 3.0, activa: true }
    ];

    const compras = [
      {
        idCompra: "c1",
        idTarjeta: "t1",
        FechaCompra: `${addMonths(monthISO(), -2)}-09`,
        Descripcion: "Mercado",
        Categoria: "Comida",
        Total: 120000,
        Cuotas: 3,
        MesInicio: addMonths(monthISO(), -2),
        interesMensual: 0,
        Nota: "Sin interés",
        createdAt: `${todayISO()}T00:00:00`,
        updatedAt: `${todayISO()}T00:00:00`
      },
      {
        idCompra: "c2",
        idTarjeta: "t1",
        FechaCompra: `${addMonths(monthISO(), -1)}-12`,
        Descripcion: "Gadget",
        Categoria: "Tech",
        Total: 300000,
        Cuotas: 6,
        MesInicio: addMonths(monthISO(), -1),
        interesMensual: 2.6,
        Nota: "Diferido con interés",
        createdAt: `${todayISO()}T00:00:00`,
        updatedAt: `${todayISO()}T00:00:00`
      },
      {
        idCompra: "c3",
        idTarjeta: "t2",
        FechaCompra: `${monthISO()}-02`,
        Descripcion: "Transporte",
        Categoria: "Movilidad",
        Total: 80000,
        Cuotas: 2,
        MesInicio: monthISO(),
        interesMensual: 0,
        Nota: "",
        createdAt: `${todayISO()}T00:00:00`,
        updatedAt: `${todayISO()}T00:00:00`
      }
    ];

    const cuotas = [];

    for (const compra of compras) {
      const cuotasCount = Math.max(1, safeNum(compra.Cuotas, 1));
      const base = Math.round(safeNum(compra.Total, 0) / cuotasCount);

      for (let i = 1; i <= cuotasCount; i += 1) {
        const interes = calcInterestForInstallment(base, compra.interesMensual, i, cuotasCount);

        cuotas.push({
          idCuota: `${compra.idCompra}-q${i}`,
          idCompra: compra.idCompra,
          idTarjeta: compra.idTarjeta,
          Mes: addMonths(compra.MesInicio, i - 1),
          NroCuota: i,
          _cuotasTotal: cuotasCount,
          BaseCuota: base,
          InteresCuota: interes,
          ValorCuota: base + interes,
          Estado: "Pendiente",
          FechaPago: "",
          updatedAt: `${todayISO()}T00:00:00`
        });
      }
    }

    const paidIds = new Set([
      `${compras[0].idCompra}-q1`,
      `${compras[1].idCompra}-q1`
    ]);

    for (const cuota of cuotas) {
      if (paidIds.has(cuota.idCuota)) {
        cuota.Estado = "Pagada";
        cuota.FechaPago = `${cuota.Mes}-08`;
      }
    }

    const movimientosGmail = [
      {
        idMovimiento: "mg_demo_1",
        gmailId: "gmail_demo_1",
        threadId: "thread_demo_1",
        fechaCorreo: `${todayISO()}T11:43:00`,
        remitente: "Notificaciones Demo <demo@example.com>",
        asunto: "Alerta Demo",
        banco: "Banco Demo",
        tipo: "compra",
        comercio: "TIENDA DEMO",
        valor: 123456,
        moneda: "COP",
        fechaMovimiento: todayISO(),
        horaMovimiento: "11:43",
        tarjetaUltimos4: "0000",
        idTarjetaDetectada: "t1",
        estado: "detectado",
        confianza: 0.95,
        idCompra: "",
        observaciones: "Demo importado desde Gmail",
        creadoEn: `${todayISO()}T11:43:00`,
        actualizadoEn: `${todayISO()}T11:43:00`
      }
    ];

    return { tarjetas, compras, cuotas, movimientosGmail };
  }

  const DEMO_DB = buildDemoDb();

  async function demoGet(params = {}) {
    const action = params?.action;

    if (action === "listarTarjetas") {
      return {
        ok: true,
        data: structuredCloneSafe(DEMO_DB.tarjetas.filter(t => t.activa !== false))
      };
    }

    if (action === "listarMovimientosGmail") {
      const estado = String(params?.estado || "").trim();
      const mes = String(params?.mes || "").trim();
      const idTarjeta = String(params?.idTarjeta || "").trim();

      let rows = structuredCloneSafe(DEMO_DB.movimientosGmail || []);
      if (estado) rows = rows.filter(m => String(m.estado || "") === estado);
      if (mes) rows = rows.filter(m => String(m.fechaMovimiento || "").slice(0, 7) === mes);
      if (idTarjeta) rows = rows.filter(m => String(m.idTarjetaDetectada || "") === idTarjeta);

      return {
        ok: true,
        data: rows
      };
    }

    if (action === "listarCuotas") {
      const mes = String(params?.mes || "").trim();
      const idTarjeta = String(params?.idTarjeta || "").trim();

      let cuotas = structuredCloneSafe(DEMO_DB.cuotas);
      let compras = structuredCloneSafe(DEMO_DB.compras);

      if (mes) cuotas = cuotas.filter(c => String(c.Mes || "").slice(0, 7) === mes);
      if (idTarjeta) cuotas = cuotas.filter(c => String(c.idTarjeta || "") === idTarjeta);

      const idsCompra = new Set(cuotas.map(c => String(c.idCompra || "")).filter(Boolean));

      if (idTarjeta) compras = compras.filter(c => String(c.idTarjeta || "") === idTarjeta);
      if (idsCompra.size) compras = compras.filter(c => idsCompra.has(String(c.idCompra || "")));

      return {
        ok: true,
        data: { cuotas, compras }
      };
    }

    return {
      ok: false,
      error: `Acción demo GET no soportada: ${action || "(vacía)"}`
    };
  }

  async function demoPost(action, payload = {}) {
    if (action === "marcarCuotaPagada") {
      const idCuota = String(payload?.idCuota || "").trim();
      const fechaPago = String(payload?.fechaPago || "").trim() || todayISO();

      if (!idCuota) {
        return { ok: false, error: "Falta idCuota" };
      }

      const cuota = DEMO_DB.cuotas.find(item => String(item.idCuota) === idCuota);

      if (!cuota) {
        return { ok: false, error: "Cuota no encontrada" };
      }

      cuota.Estado = "Pagada";
      cuota.FechaPago = fechaPago;
      cuota.updatedAt = new Date().toISOString();

      return {
        ok: true,
        data: { idCuota }
      };
    }

    if (action === "crearCompra") {
      const compra = {
        idCompra: `c${DEMO_DB.compras.length + 1}`,
        idTarjeta: String(payload?.idTarjeta || "").trim(),
        FechaCompra: String(payload?.fechaCompra || "").trim(),
        Descripcion: String(payload?.descripcion || "").trim(),
        Categoria: String(payload?.categoria || "").trim(),
        Total: safeNum(payload?.total, 0),
        Cuotas: Math.max(1, safeNum(payload?.cuotas, 1)),
        MesInicio: String(payload?.mesInicio || "").trim(),
        interesMensual: safeNum(payload?.interesMensual, 0),
        Nota: String(payload?.nota || "").trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (!compra.idTarjeta) return { ok: false, error: "Falta idTarjeta" };
      if (!compra.FechaCompra) return { ok: false, error: "Falta fechaCompra" };
      if (!compra.Descripcion) return { ok: false, error: "Falta descripcion" };
      if (!(compra.Total > 0)) return { ok: false, error: "Total debe ser > 0" };
      if (!/^\d{4}-\d{2}$/.test(compra.MesInicio)) return { ok: false, error: "MesInicio debe ser YYYY-MM" };

      DEMO_DB.compras.push(compra);

      const base = Math.round(compra.Total / compra.Cuotas);

      for (let i = 1; i <= compra.Cuotas; i += 1) {
        const interes = calcInterestForInstallment(base, compra.interesMensual, i, compra.Cuotas);

        DEMO_DB.cuotas.push({
          idCuota: `${compra.idCompra}-q${i}`,
          idCompra: compra.idCompra,
          idTarjeta: compra.idTarjeta,
          Mes: addMonths(compra.MesInicio, i - 1),
          NroCuota: i,
          _cuotasTotal: compra.Cuotas,
          BaseCuota: base,
          InteresCuota: interes,
          ValorCuota: base + interes,
          Estado: "Pendiente",
          FechaPago: "",
          updatedAt: new Date().toISOString()
        });
      }

      return {
        ok: true,
        data: { idCompra: compra.idCompra }
      };
    }



    if (action === "descartarMovimientoGmail") {
      const idMovimiento = String(payload?.idMovimiento || "").trim();
      const mov = DEMO_DB.movimientosGmail.find(item => String(item.idMovimiento) === idMovimiento);
      if (!mov) return { ok: false, error: "Movimiento no encontrado" };
      mov.estado = "descartado";
      mov.observaciones = String(payload?.observaciones || "Descartado desde demo");
      mov.actualizadoEn = new Date().toISOString();
      return { ok: true, data: { idMovimiento } };
    }

    if (action === "confirmarMovimientoComoCompra") {
      const idMovimiento = String(payload?.idMovimiento || "").trim();
      const mov = DEMO_DB.movimientosGmail.find(item => String(item.idMovimiento) === idMovimiento);
      if (!mov) return { ok: false, error: "Movimiento no encontrado" };
      if (mov.estado === "confirmado") return { ok: false, error: "Este movimiento ya fue confirmado" };

      const compraRes = await demoPost("crearCompra", {
        idTarjeta: String(payload?.idTarjeta || mov.idTarjetaDetectada || ""),
        fechaCompra: String(payload?.fechaCompra || mov.fechaMovimiento || todayISO()),
        descripcion: String(payload?.descripcion || mov.comercio || "Compra importada"),
        categoria: String(payload?.categoria || "Por clasificar"),
        total: safeNum(payload?.total ?? mov.valor, 0),
        cuotas: Math.max(1, safeNum(payload?.cuotas, 1)),
        mesInicio: String(payload?.mesInicio || String(mov.fechaMovimiento || todayISO()).slice(0, 7)),
        interesMensual: safeNum(payload?.interesMensual, 0),
        nota: String(payload?.nota || `Importado desde Gmail · ${mov.banco}`)
      });

      if (!compraRes.ok) return compraRes;

      mov.estado = "confirmado";
      mov.idCompra = compraRes.data.idCompra;
      mov.observaciones = "Confirmado como compra";
      mov.actualizadoEn = new Date().toISOString();

      return {
        ok: true,
        data: {
          idMovimiento,
          idCompra: compraRes.data.idCompra
        }
      };
    }

    return {
      ok: false,
      error: `Acción demo POST no soportada: ${action || "(vacía)"}`
    };
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
