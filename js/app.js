// CC Tracker · Musicala (MVP) — app.js v2.0
// Orquestador UI + state + render + events
// Requiere:
//   <script src="./js/utils.js"></script>
//   <script src="./js/api.js"></script>
//   <script src="./js/app.js"></script>

(() => {
  "use strict";

  /* -------------------------------------------------------------------------- */
  /* Dependencias globales                                                      */
  /* -------------------------------------------------------------------------- */
  const U = window.CC_UTILS || {};
  const API = window.CC_API || {};

  if (!window.CC_UTILS || !window.CC_API) {
    console.error("Faltan utils.js o api.js. Este app.js no piensa hacer milagros solo.");
  }

  const $ = U.$ || ((sel, root = document) => root.querySelector(sel));
  const $$ = U.$$ || ((sel, root = document) => Array.from(root.querySelectorAll(sel)));
  const escapeHtml = U.escapeHtml || ((v) =>
    String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;"));

  const safeNum = U.safeNum || ((value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  });

  const clamp = U.clamp || ((n, min, max) => Math.max(min, Math.min(max, n)));

  const fmtCOP = U.fmtCOP || ((value) => {
    const n = safeNum(value, 0);
    try {
      return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0
      }).format(n);
    } catch (_) {
      return `$${Math.round(n).toLocaleString("es-CO")}`;
    }
  });

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  const todayISO = U.todayISO || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });

  const monthISO = U.monthISO || ((date = new Date()) => {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
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

  const debounce = U.debounce || ((fn, ms = 180) => {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  });

  const toCSV = U.toCSV || ((rows) => {
    if (!Array.isArray(rows) || !rows.length) return "";
    const headers = Object.keys(rows[0]);
    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => esc(row[h])).join(","))
    ].join("\n");
  });

  const CATEGORIAS_COMPRA = [
    "Mercado / Supermercado",
    "Restaurantes / Comida",
    "Transporte",
    "Gasolina / Moto / Carro",
    "Tecnología",
    "Hogar",
    "Salud",
    "Educación",
    "Entretenimiento",
    "Ropa",
    "Suscripciones",
    "Servicios",
    "Viajes",
    "Mascotas",
    "Impuestos / Trámites",
    "Otros",
    "Por clasificar"
  ];

  const CATEGORY_RULES = [
    ["Mercado / Supermercado", ["exito", "éxito", "d1", "ara", "jumbo", "olimpica", "olímpica", "carulla", "supermercado"]],
    ["Restaurantes / Comida", ["rappi", "ifood", "restaurante", "burger", "pizza", "cafe", "café", "dominos", "kfc", "mcdonalds"]],
    ["Transporte", ["uber", "didi", "cabify", "taxi", "transmilenio", "sitp"]],
    ["Gasolina / Moto / Carro", ["terpel", "primax", "texaco", "gasolina", "parqueadero"]],
    ["Tecnología", ["alkosto", "ktronix", "amazon", "mercadolibre", "mercado libre", "apple", "google", "microsoft"]],
    ["Suscripciones", ["netflix", "spotify", "disney", "prime", "hbo", "youtube"]],
    ["Salud", ["cruz verde", "drogueria", "droguería", "farmacia", "eps", "salud"]],
    ["Mascotas", ["veterinaria", "mascota", "pet", "animal"]]
  ];

  function normalizeSearchText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function detectCategoryFromText(text) {
    const haystack = normalizeSearchText(text);
    if (!haystack) return "Por clasificar";
    for (const [category, keywords] of CATEGORY_RULES) {
      if (keywords.some((keyword) => haystack.includes(normalizeSearchText(keyword)))) return category;
    }
    return "Por clasificar";
  }

  const downloadTextFile = U.downloadTextFile || ((content, filename, mime = "text/plain;charset=utf-8") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  /* -------------------------------------------------------------------------- */
  /* Estado global                                                              */
  /* -------------------------------------------------------------------------- */
  const state = {
    tarjetas: [],
    compras: [],
    cuotas: [],
    movimientosGmail: [],
    gmailSyncStatus: null,
    comprasIndex: new Map(),
    tarjetasIndex: new Map(),
    movimientoConfirmandoId: null,
    compraEditandoId: null,
    dailyGmailSyncChecked: false,

    mes: null,
    idTarjeta: null,
    q: "",

    loading: false,
    backend: {
      mode: "not_configured",
      reason: "",
      url: ""
    },

    syncSeq: 0,

    config: {
      schema: "cc-tracker-config@1",
      defaultInterestMensual: 0,
      interestByCard: {},
      updatedAt: ""
    }
  };

  /* -------------------------------------------------------------------------- */
  /* Config local                                                               */
  /* -------------------------------------------------------------------------- */
  const CONFIG_KEY = "ccTrackerConfig_v1";

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const next = {
        schema: "cc-tracker-config@1",
        defaultInterestMensual: safeNum(parsed.defaultInterestMensual, 0),
        interestByCard: (parsed.interestByCard && typeof parsed.interestByCard === "object")
          ? parsed.interestByCard
          : {},
        updatedAt: String(parsed.updatedAt || "")
      };

      for (const key of Object.keys(next.interestByCard)) {
        const value = safeNum(next.interestByCard[key], NaN);
        if (!Number.isFinite(value) || value < 0) delete next.interestByCard[key];
        else next.interestByCard[key] = value;
      }

      state.config = next;
    } catch (_) {
      // si se dañó el JSON, seguimos vivos y ya
    }
  }

  function saveConfig(partial) {
    state.config = {
      ...state.config,
      ...partial,
      updatedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
    } catch (_) {}
  }

  function getConfiguredInterestForCard(idTarjeta) {
    if (!idTarjeta) return null;
    const value = state.config?.interestByCard?.[idTarjeta];
    if (Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
    return null;
  }

  function getGlobalDefaultInterest() {
    const value = Number(state.config?.defaultInterestMensual ?? 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  /* -------------------------------------------------------------------------- */
  /* Backend status                                                             */
  /* -------------------------------------------------------------------------- */
  function readBackendState() {
    const backendState = typeof API.getBackendState === "function"
      ? API.getBackendState()
      : null;

    if (backendState && typeof backendState === "object") {
      state.backend = {
        mode: String(backendState.mode || "not_configured"),
        reason: String(backendState.reason || ""),
        url: String(backendState.url || "")
      };
      return;
    }

    const real = typeof API.isRealBackend === "function" ? API.isRealBackend() : false;
    state.backend = {
      mode: real ? "backend" : "not_configured",
      reason: real ? "Backend activo" : "Backend sin configurar",
      url: ""
    };
  }

  function renderBackendStatus() {
    readBackendState();

    const candidates = [
      $("#backendStatus"),
      $("#syncStatus"),
      $("#appStatus")
    ].filter(Boolean);

    if (!candidates.length) return;

    const mode = state.backend.mode;
    const text =
      mode === "proxy" ? "Conectado por proxy" :
      mode === "apps_script" ? "Conectado a Apps Script" :
      mode === "backend" ? "Backend activo" :
      mode === "not_configured" ? "Backend sin configurar" :
      "Backend sin configurar";

    const detail = state.backend.reason ? ` · ${state.backend.reason}` : "";

    for (const el of candidates) {
      el.textContent = `${text}${detail}`;
      el.dataset.mode = mode;
      el.classList.toggle("is-live", mode !== "not_configured");
      el.classList.toggle("is-bad", mode === "not_configured");
    }
  }

  async function waitForAuthorizedSession() {
    if (!window.CC_AUTH || typeof window.CC_AUTH.waitUntilReady !== "function") {
      toast("Firebase Auth no cargó. Revisa js/auth.js y los scripts de Firebase.", "⚠️");
      return false;
    }

    await window.CC_AUTH.waitUntilReady();

    if (!window.CC_AUTH.isAuthorized()) {
      setLoadingGlobal(false);
      return false;
    }

    return true;
  }

  function resetDataAfterLogout() {
    state.tarjetas = [];
    state.cuotas = [];
    state.compras = [];
    state.movimientosGmail = [];
    state.tarjetasIndex = new Map();
    state.comprasIndex = new Map();
    renderAll();
  }

  /* -------------------------------------------------------------------------- */
  /* UI helpers                                                                 */
  /* -------------------------------------------------------------------------- */
  function setLoadingGlobal(on) {
    state.loading = !!on;

    const loader = $("#loader");
    if (loader) {
      loader.style.display = on ? "flex" : "none";
      loader.setAttribute("aria-hidden", on ? "false" : "true");
    }

    const syncBtn = $("#btnSync");
    if (syncBtn) syncBtn.disabled = !!on;
  }

  function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.dataset._txt ||= btn.textContent;
    btn.textContent = loading ? "..." : btn.dataset._txt;
  }

  function toast(message, icon = "✅") {
    const wrap = $("#toast");
    const text = $("#toastText");
    const iconEl = $(".toastIcon");

    if (!wrap || !text) return;

    if (iconEl) iconEl.textContent = icon;
    text.textContent = message;
    wrap.style.display = "block";

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      wrap.style.display = "none";
    }, 2600);
  }

  function openModal() {
    const modal = $("#modalCompra");
    if (!modal) return;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    const modal = $("#modalCompra");
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function renderCategoryDatalist() {
    const datalist = $("#categoriasCompra");
    if (!datalist) return;
    datalist.innerHTML = CATEGORIAS_COMPRA
      .map((category) => `<option value="${escapeHtml(category)}"></option>`)
      .join("");
  }

  function suggestCategoryForCurrentForm(force = false) {
    const descripcion = $("#descripcion");
    const categoria = $("#categoria");
    if (!descripcion || !categoria) return;
    const current = String(categoria.value || "").trim();
    if (!force && current && current !== "Por clasificar") return;
    categoria.value = detectCategoryFromText(descripcion.value);
  }

  function openConfigModal() {
    const modal = $("#modalConfig");
    if (!modal) return;
    hydrateConfigUI();
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeConfigModal() {
    const modal = $("#modalConfig");
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function wireModalBackdrops() {
    const modalCompra = $("#modalCompra");
    const modalConfig = $("#modalConfig");

    if (modalCompra) {
      modalCompra.addEventListener("click", (e) => {
        if (e.target === modalCompra) closeModal();
      });
    }

    if (modalConfig) {
      modalConfig.addEventListener("click", (e) => {
        if (e.target === modalConfig) closeConfigModal();
      });
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Normalización backend                                                      */
  /* -------------------------------------------------------------------------- */
  function normalizeTarjeta(t) {
    return {
      idTarjeta: String(t?.idTarjeta ?? t?.IdTarjeta ?? t?.id ?? ""),
      Nombre: String(t?.Nombre ?? t?.nombre ?? "Tarjeta"),
      Banco: String(t?.Banco ?? t?.banco ?? ""),
      Ultimos4: String(t?.Ultimos4 ?? t?.ultimos4 ?? t?.last4 ?? "").replace(/\D/g, "").slice(-4),
      interesMensual: safeNum(t?.interesMensual ?? t?.InteresMensual ?? 0, 0),
      activa: t?.activa !== false
    };
  }

  function normalizeCompra(c) {
    return {
      idCompra: String(c?.idCompra ?? c?.ID ?? c?.IdCompra ?? c?.id ?? ""),
      idTarjeta: String(c?.idTarjeta ?? c?.TarjetaID ?? c?.IdTarjeta ?? ""),
      FechaCompra: String(c?.FechaCompra ?? c?.Fecha ?? c?.fechaCompra ?? ""),
      Descripcion: String(c?.Descripcion ?? c?.Comercio ?? c?.descripcion ?? ""),
      Categoria: String(c?.Categoria ?? c?.categoria ?? ""),
      Total: safeNum(c?.Total ?? c?.ValorTotal ?? c?.total ?? 0, 0),
      Cuotas: Math.max(1, safeNum(c?.Cuotas ?? c?.NumeroCuotas ?? c?.cuotas ?? 1, 1)),
      MesInicio: String(c?.MesInicio ?? c?.Mes ?? c?.mesInicio ?? ""),
      Estado: String(c?.Estado ?? c?.estado ?? "Activa") || "Activa",
      Origen: String(c?.Origen ?? c?.origen ?? "manual") || "manual",
      interesMensual: safeNum(c?.interesMensual ?? c?.InteresMensual ?? 0, 0),
      Nota: String(c?.Nota ?? c?.nota ?? ""),
      createdAt: String(c?.createdAt ?? c?.FechaCreacion ?? c?.CreatedAt ?? ""),
      updatedAt: String(c?.updatedAt ?? c?.FechaActualizacion ?? c?.UpdatedAt ?? "")
    };
  }

  function normalizeCuota(c) {
    return {
      idCuota: String(c?.idCuota ?? c?.ID ?? c?.IdCuota ?? c?.id ?? ""),
      idCompra: String(c?.idCompra ?? c?.CompraID ?? c?.IdCompra ?? ""),
      idTarjeta: String(c?.idTarjeta ?? c?.TarjetaID ?? c?.IdTarjeta ?? ""),
      Mes: String(c?.Mes ?? c?.MesCuota ?? c?.mes ?? ""),
      NroCuota: Math.max(1, safeNum(c?.NroCuota ?? c?.NumeroCuota ?? c?.nroCuota ?? 1, 1)),
      _cuotasTotal: Math.max(0, safeNum(c?._cuotasTotal ?? c?.TotalCuotas ?? c?.Cuotas ?? c?.cuotas ?? 0, 0)),
      BaseCuota: safeNum(c?.BaseCuota ?? c?.baseCuota ?? 0, 0),
      InteresCuota: safeNum(c?.InteresCuota ?? c?.interesCuota ?? 0, 0),
      ValorCuota: safeNum(c?.ValorCuota ?? c?.valorCuota ?? 0, 0),
      Estado: String(c?.Estado ?? c?.estado ?? "Pendiente") || "Pendiente",
      FechaPago: String(c?.FechaPago ?? c?.fechaPago ?? ""),
      updatedAt: String(c?.updatedAt ?? c?.UpdatedAt ?? "")
    };
  }

  function normalizeMovimientoGmail(m) {
    return {
      idMovimiento: String(m?.idMovimiento ?? m?.id ?? ""),
      gmailId: String(m?.gmailId ?? ""),
      threadId: String(m?.threadId ?? ""),
      fechaCorreo: String(m?.fechaCorreo ?? ""),
      remitente: String(m?.remitente ?? ""),
      asunto: String(m?.asunto ?? ""),
      banco: String(m?.banco ?? ""),
      tipo: String(m?.tipo ?? ""),
      comercio: String(m?.comercio ?? m?.descripcion ?? ""),
      valor: safeNum(m?.valor ?? 0, 0),
      moneda: String(m?.moneda ?? "COP") || "COP",
      fechaMovimiento: String(m?.fechaMovimiento ?? ""),
      horaMovimiento: String(m?.horaMovimiento ?? ""),
      tarjetaUltimos4: String(m?.tarjetaUltimos4 ?? "").replace(/\D/g, "").slice(-4),
      idTarjetaDetectada: String(m?.idTarjetaDetectada ?? ""),
      estado: String(m?.estado ?? "detectado") || "detectado",
      confianza: safeNum(m?.confianza ?? 0, 0),
      idCompra: String(m?.idCompra ?? ""),
      observaciones: String(m?.observaciones ?? ""),
      creadoEn: String(m?.creadoEn ?? ""),
      actualizadoEn: String(m?.actualizadoEn ?? "")
    };
  }


  /* -------------------------------------------------------------------------- */
  /* Helpers de negocio                                                         */
  /* -------------------------------------------------------------------------- */
  function getTarjetaById(idTarjeta) {
    return state.tarjetasIndex.get(idTarjeta) || null;
  }

  function getCompraById(idCompra) {
    return state.comprasIndex.get(idCompra) || null;
  }

  function resolveAutoInterestForSelectedCard(idTarjeta) {
    const override = getConfiguredInterestForCard(idTarjeta);
    if (override != null) return override;

    const tarjeta = getTarjetaById(idTarjeta);
    const cardRate = safeNum(tarjeta?.interesMensual, 0);
    if (cardRate > 0) return cardRate;

    return getGlobalDefaultInterest();
  }

  function calcInterestForInstallment(base, interesMensual, installmentIndex, totalInstallments = null) {
    const rate = Number(interesMensual || 0) / 100;
    if (!(rate > 0)) return 0;

    const total = Number(totalInstallments || 0);
    const remaining = total
      ? (total - installmentIndex + 1)
      : Math.max(1, 6 - installmentIndex + 1);

    const estimatedBalance = base * (remaining + 0.5);
    const interest = Math.round(estimatedBalance * rate);

    return clamp(interest, 0, Math.round(base * 0.65));
  }

  function hydrateComputedQuotaFields() {
    for (const cuota of state.cuotas) {
      const compra = getCompraById(cuota.idCompra);
      if (!compra) continue;

      if (!cuota._cuotasTotal) cuota._cuotasTotal = Math.max(1, safeNum(compra.Cuotas, 1));

      const base = cuota.BaseCuota > 0
        ? cuota.BaseCuota
        : Math.round(safeNum(compra.Total, 0) / Math.max(1, safeNum(compra.Cuotas, 1)));

      cuota.BaseCuota = base;

      let effectiveRate = safeNum(compra.interesMensual, 0);
      if (!(effectiveRate > 0)) {
        effectiveRate = resolveAutoInterestForSelectedCard(cuota.idTarjeta);
      }

      if (!(safeNum(cuota.InteresCuota, 0) > 0) && effectiveRate > 0) {
        cuota.InteresCuota = calcInterestForInstallment(
          base,
          effectiveRate,
          cuota.NroCuota,
          cuota._cuotasTotal || compra.Cuotas
        );
      }

      if (!(safeNum(cuota.ValorCuota, 0) > 0)) {
        cuota.ValorCuota = base + safeNum(cuota.InteresCuota, 0);
      } else {
        const currentValue = safeNum(cuota.ValorCuota, 0);
        const looksLikeBaseOnly = Math.abs(currentValue - base) < Math.max(2000, base * 0.05);
        if (looksLikeBaseOnly && safeNum(cuota.InteresCuota, 0) > 0) {
          cuota.ValorCuota = base + safeNum(cuota.InteresCuota, 0);
        }
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Selectores / vistas derivadas                                              */
  /* -------------------------------------------------------------------------- */
  function getVisibleMonthItems() {
    return state.cuotas
      .filter((c) => c.Mes === state.mes)
      .filter((c) => !state.idTarjeta || c.idTarjeta === state.idTarjeta)
      .filter(matchesSearch);
  }

  function getFilteredAllItems() {
    return state.cuotas
      .filter((c) => !state.idTarjeta || c.idTarjeta === state.idTarjeta)
      .filter(matchesSearch);
  }

  function matchesSearch(cuota) {
    if (!state.q) return true;

    const compra = getCompraById(cuota.idCompra) || {};
    const tarjeta = getTarjetaById(cuota.idTarjeta) || {};

    const haystack = [
      compra.Descripcion || "",
      compra.Categoria || "",
      tarjeta.Nombre || "",
      tarjeta.Banco || "",
      cuota.idTarjeta || "",
      cuota.Mes || ""
    ].join(" ").toLowerCase();

    return haystack.includes(state.q.toLowerCase());
  }

  /* -------------------------------------------------------------------------- */
  /* Render base UI                                                             */
  /* -------------------------------------------------------------------------- */
  function setDefaultsUI() {
    if (!state.mes) state.mes = monthISO();

    const mesSelect = $("#mesSelect");
    const fechaCompra = $("#fechaCompra");
    const mesInicio = $("#mesInicio");
    const cuotas = $("#cuotas");
    const interesMensual = $("#interesMensual");
    const aplicarInteres = $("#aplicarInteres");

    if (mesSelect) mesSelect.value = state.mes;
    if (fechaCompra) fechaCompra.value = todayISO();
    if (mesInicio) mesInicio.value = state.mes;
    if (cuotas) cuotas.value = 1;
    if (interesMensual) interesMensual.value = "";
    if (aplicarInteres) aplicarInteres.value = "auto";
  }

  function renderTarjetas() {
    const mainSelect = $("#tarjetaSelect");
    const formSelect = $("#formTarjeta");

    if (mainSelect) {
      const current = state.idTarjeta || "";
      mainSelect.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "Todas";
      mainSelect.appendChild(allOption);

      for (const t of state.tarjetas) {
        const option = document.createElement("option");
        option.value = t.idTarjeta;
        option.textContent = `${t.Nombre}${t.Banco ? ` (${t.Banco})` : ""}${t.Ultimos4 ? ` · *${t.Ultimos4}` : ""}`;
        mainSelect.appendChild(option);
      }

      mainSelect.value = current;
    }

    if (formSelect) {
      const currentForm = formSelect.value;
      formSelect.innerHTML = "";

      for (const t of state.tarjetas) {
        const option = document.createElement("option");
        option.value = t.idTarjeta;
        option.textContent = `${t.Nombre}${t.Banco ? ` (${t.Banco})` : ""}${t.Ultimos4 ? ` · *${t.Ultimos4}` : ""}`;
        formSelect.appendChild(option);
      }

      const shouldKeep = state.tarjetas.some((t) => t.idTarjeta === currentForm);
      formSelect.value = shouldKeep
        ? currentForm
        : (state.idTarjeta && state.tarjetas.some((t) => t.idTarjeta === state.idTarjeta)
          ? state.idTarjeta
          : (state.tarjetas[0]?.idTarjeta || ""));

      formSelect.onchange = () => applyAutoInterestToModal();
    }

    if ($("#cfgTarjetasList")) hydrateConfigUI();
  }

  function renderListHint(items) {
    const hint = $("#listHint");
    if (!hint) return;

    const chunks = [`${items.length} cuota(s) en ${state.mes}`];
    if (state.idTarjeta) chunks.push("tarjeta filtrada");
    if (state.q) chunks.push(`búsqueda: "${state.q}"`);

    hint.textContent = chunks.join(" · ");
  }

  /* -------------------------------------------------------------------------- */
  /* Config modal                                                               */
  /* -------------------------------------------------------------------------- */
  function hydrateConfigUI() {
    const globalInput = $("#cfgInteresGlobal");
    if (globalInput) globalInput.value = String(getGlobalDefaultInterest() || "");

    const list = $("#cfgTarjetasList");
    if (!list) return;

    list.innerHTML = "";

    for (const tarjeta of state.tarjetas) {
      const label = `${tarjeta.Nombre}${tarjeta.Banco ? ` (${tarjeta.Banco})` : ""}`;
      const override = getConfiguredInterestForCard(tarjeta.idTarjeta);
      const backendRate = safeNum(tarjeta.interesMensual, 0);

      const row = document.createElement("div");
      row.className = "cfgRow";
      row.innerHTML = `
        <div class="cfgName">
          <div class="cfgTitle">${escapeHtml(label)}</div>
          <div class="cfgSub">
            Tarjeta: ${escapeHtml(String(backendRate || 0))}% · Override: ${escapeHtml(override == null ? "—" : String(override))}%
          </div>
        </div>
        <div class="cfgInput">
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            data-cfg-card="${escapeHtml(tarjeta.idTarjeta)}"
            placeholder="(usar global/tarjeta)"
            value="${escapeHtml(override == null ? "" : String(override))}">
        </div>
      `;
      list.appendChild(row);
    }
  }

  function readConfigUIAndSave() {
    const globalInput = $("#cfgInteresGlobal");
    const defaultInterestMensual = globalInput
      ? safeNum(globalInput.value, 0)
      : getGlobalDefaultInterest();

    const interestByCard = { ...(state.config.interestByCard || {}) };

    $$("input[data-cfg-card]").forEach((input) => {
      const cardId = input.getAttribute("data-cfg-card");
      const raw = String(input.value || "").trim();

      if (!raw) {
        delete interestByCard[cardId];
        return;
      }

      const value = safeNum(raw, NaN);
      if (!Number.isFinite(value) || value < 0) {
        delete interestByCard[cardId];
        return;
      }

      interestByCard[cardId] = value;
    });

    saveConfig({ defaultInterestMensual, interestByCard });
    applyAutoInterestToModal();
    hydrateComputedQuotaFields();
  }

  function applyAutoInterestToModal() {
    const modeSelect = $("#aplicarInteres");
    const interestInput = $("#interesMensual");
    const formTarjeta = $("#formTarjeta");

    if (!modeSelect || !interestInput || !formTarjeta) return;

    const mode = modeSelect.value;

    if (mode === "no") {
      interestInput.value = "0";
      interestInput.disabled = true;
      return;
    }

    interestInput.disabled = false;

    if (mode === "si") {
      return;
    }

    const rate = resolveAutoInterestForSelectedCard(formTarjeta.value);
    interestInput.value = rate ? String(rate) : "";
  }

  /* -------------------------------------------------------------------------- */
  /* Stats                                                                      */
  /* -------------------------------------------------------------------------- */
  function renderStats() {
    const monthItems = getVisibleMonthItems();
    const allItems = getFilteredAllItems();

    const monthPending = monthItems.filter((c) => c.Estado !== "Pagada");
    const totalMonthPending = monthPending.reduce((acc, c) => acc + safeNum(c.ValorCuota, 0), 0);

    const pendingAll = allItems.filter((c) => c.Estado !== "Pagada");
    const totalPendingAll = pendingAll.reduce((acc, c) => acc + safeNum(c.ValorCuota, 0), 0);

    const paidThisMonth = allItems.filter((c) => {
      if (c.Estado !== "Pagada") return false;
      if (!c.FechaPago) return false;
      return String(c.FechaPago).slice(0, 7) === state.mes;
    });

    const paidThisMonthTotal = paidThisMonth.reduce((acc, c) => acc + safeNum(c.ValorCuota, 0), 0);
    const interestThisMonth = paidThisMonth.reduce((acc, c) => acc + safeNum(c.InteresCuota, 0), 0);

    const biggestPending = monthPending
      .slice()
      .sort((a, b) => safeNum(b.ValorCuota, 0) - safeNum(a.ValorCuota, 0))[0];

    const statMes = $("#statMes");
    const statTotal = $("#statTotal");
    const statCount = $("#statCount");
    const statBoughtMonth = $("#statBoughtMonth");
    const statPaidMonthTop = $("#statPaidMonthTop");
    const statPendingMonth = $("#statPendingMonth");
    const statGmailPendingTop = $("#statGmailPendingTop");
    const statPaidMonth = $("#statPaidMonth");
    const statInterestMonth = $("#statInterestMonth");
    const statNextHit = $("#statNextHit");
    const statPaidMonthHint = $("#statPaidMonthHint");
    const statNextHitHint = $("#statNextHitHint");

    if (statMes) statMes.textContent = fmtCOP(totalMonthPending);
    if (statTotal) statTotal.textContent = fmtCOP(totalPendingAll);
    if (statCount) statCount.textContent = String(pendingAll.length);
    if (statPendingMonth) statPendingMonth.textContent = fmtCOP(totalMonthPending);
    if (statPaidMonthTop) statPaidMonthTop.textContent = fmtCOP(paidThisMonthTotal);
    if (statGmailPendingTop) {
      statGmailPendingTop.textContent = String(state.movimientosGmail.filter((m) => ["detectado", "revisar"].includes(m.estado)).length);
    }
    if (statBoughtMonth) {
      const bought = state.compras
        .filter((c) => String(c.FechaCompra || c.MesInicio || "").slice(0, 7) === state.mes)
        .filter((c) => !state.idTarjeta || c.idTarjeta === state.idTarjeta)
        .reduce((sum, c) => sum + safeNum(c.Total, 0), 0);
      statBoughtMonth.textContent = fmtCOP(bought);
    }
    if (statPaidMonth) statPaidMonth.textContent = fmtCOP(paidThisMonthTotal);
    if (statInterestMonth) statInterestMonth.textContent = fmtCOP(interestThisMonth);
    if (statNextHit) statNextHit.textContent = biggestPending ? fmtCOP(biggestPending.ValorCuota) : "—";

    if (statPaidMonthHint) {
      statPaidMonthHint.textContent = paidThisMonth.length
        ? `${paidThisMonth.length} cuota(s) pagadas en ${state.mes}`
        : `Aún no hay pagos en ${state.mes}`;
    }

    if (statNextHitHint) {
      statNextHitHint.textContent = biggestPending
        ? `Cuota #${biggestPending.NroCuota}/${biggestPending._cuotasTotal || "?"}`
        : "Sin cuotas pendientes";
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Tabla                                                                      */
  /* -------------------------------------------------------------------------- */
  function renderTable(items) {
    const tbody = $("#tbodyCuotas");
    if (!tbody) return;

    tbody.innerHTML = "";

    for (const cuota of items) {
      const compra = getCompraById(cuota.idCompra) || {};
      const cuotaTxt = `${cuota.NroCuota}/${cuota._cuotasTotal || "?"}`;
      const estado = cuota.Estado === "Pagada" ? "Pagada" : "Pendiente";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="font-weight:900">${escapeHtml(compra.Descripcion || "(sin descripción)")}</div>
          <div class="muted hideSm" style="margin-top:2px;">
            ${escapeHtml(cuota.idTarjeta)} · ${escapeHtml(cuota.Mes)}
            ${safeNum(cuota.InteresCuota, 0) > 0 ? ` · Interés: ${escapeHtml(fmtCOP(cuota.InteresCuota))}` : ""}
          </div>
        </td>
        <td class="hideSm">${escapeHtml(compra.Categoria || "—")}</td>
        <td class="hideSm">${escapeHtml(cuotaTxt)}</td>
        <td>
          <div style="font-weight:950">${escapeHtml(fmtCOP(cuota.ValorCuota))}</div>
          ${safeNum(cuota.InteresCuota, 0) > 0
            ? `<div class="muted">Incluye interés</div>`
            : `<div class="muted">Sin interés</div>`}
        </td>
        <td>
          <span class="pill ${estado === "Pagada" ? "ok" : "warn"}">${escapeHtml(estado)}</span>
        </td>
        <td>
          ${estado === "Pagada"
            ? `<button class="smallBtn" data-unpay="${escapeHtml(cuota.idCuota)}">Deshacer pago</button><div class="muted">${escapeHtml(cuota.FechaPago || "")}</div>`
            : `<button class="smallBtn" data-pay="${escapeHtml(cuota.idCuota)}">Marcar pagada</button>`}
        </td>
      `;
      tbody.appendChild(tr);
    }

    wirePayButtons(tbody);
    wireUnpayButtons(tbody);
  }

  /* -------------------------------------------------------------------------- */
  /* Cards                                                                      */
  /* -------------------------------------------------------------------------- */
  function renderCards(items) {
    const wrap = $("#cardsCuotas");
    if (!wrap) return;

    wrap.innerHTML = "";

    for (const cuota of items) {
      const compra = getCompraById(cuota.idCompra) || {};
      const estado = cuota.Estado === "Pagada" ? "Pagada" : "Pendiente";
      const cuotaTxt = `${cuota.NroCuota}/${cuota._cuotasTotal || "?"}`;
      const interestText = safeNum(cuota.InteresCuota, 0) > 0
        ? ` · Interés ${escapeHtml(fmtCOP(cuota.InteresCuota))}`
        : "";

      const card = document.createElement("div");
      card.className = "quotaCard";
      card.innerHTML = `
        <div class="quotaTop">
          <div>
            <div class="quotaTitle">${escapeHtml(compra.Descripcion || "(sin descripción)")}</div>
            <div class="quotaMeta">
              ${escapeHtml(compra.Categoria || "—")} · Cuota ${escapeHtml(cuotaTxt)} · ${escapeHtml(cuota.Mes)}${interestText}
            </div>
          </div>
          <span class="pill ${estado === "Pagada" ? "ok" : "warn"}">${escapeHtml(estado)}</span>
        </div>

        <div class="quotaMid">
          <div class="quotaValue">${escapeHtml(fmtCOP(cuota.ValorCuota))}</div>
          <div class="muted">${escapeHtml(cuota.idTarjeta)}</div>
        </div>

        <div class="quotaActions">
          ${estado === "Pagada"
            ? `<button class="smallBtn" data-unpay="${escapeHtml(cuota.idCuota)}">Deshacer pago</button><span class="muted">Pagada: ${escapeHtml(cuota.FechaPago || "")}</span>`
            : `<button class="smallBtn" data-pay="${escapeHtml(cuota.idCuota)}">Marcar pagada</button>`}
        </div>
      `;
      wrap.appendChild(card);
    }

    wirePayButtons(wrap);
    wireUnpayButtons(wrap);
  }

  function wirePayButtons(root) {
    root.querySelectorAll("button[data-pay]").forEach((btn) => {
      btn.onclick = async () => {
        const idCuota = btn.getAttribute("data-pay");
        try {
          setLoading(btn, true);
          await API.post("marcarCuotaPagada", {
            idCuota,
            fechaPago: todayISO()
          });
          toast("Cuota marcada como pagada", "✅");
          await sync();
        } catch (err) {
          toast("Error: " + err.message, "⚠️");
        } finally {
          setLoading(btn, false);
        }
      };
    });
  }

  function wireUnpayButtons(root) {
    $$("[data-unpay]", root).forEach((btn) => {
      btn.onclick = async () => {
        const idCuota = btn.getAttribute("data-unpay");
        if (!window.confirm("¿Deshacer el pago de esta cuota?")) return;
        try {
          setLoading(btn, true);
          await API.post("desmarcarCuotaPagada", { idCuota });
          toast("Pago deshecho", "↩");
          await sync();
        } catch (err) {
          toast("Error: " + err.message, "⚠️");
        } finally {
          setLoading(btn, false);
        }
      };
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Histórico y rankings                                                       */
  /* -------------------------------------------------------------------------- */
  function renderHistoryAndStats() {
    const historyWrap = $("#history");
    const topCatsWrap = $("#topCats");
    const topCardsWrap = $("#topCards");
    const emptyState = $("#historyEmpty");
    const hint = $("#historyHint");

    if (!historyWrap || !topCatsWrap || !topCardsWrap) return;

    const allItems = getFilteredAllItems();
    const months = Array.from({ length: 12 }, (_, i) => addMonths(state.mes, -i));

    if (!allItems.length) {
      if (emptyState) emptyState.style.display = "block";
      historyWrap.innerHTML = "";
      topCatsWrap.innerHTML = "";
      topCardsWrap.innerHTML = "";
      if (hint) hint.textContent = "Últimos 12 meses";
      return;
    }

    if (emptyState) emptyState.style.display = "none";

    const byMonth = new Map(months.map((m) => [m, {
      month: m,
      paid: 0,
      interest: 0,
      pending: 0
    }]));

    for (const cuota of allItems) {
      if (byMonth.has(cuota.Mes) && cuota.Estado !== "Pagada") {
        byMonth.get(cuota.Mes).pending += safeNum(cuota.ValorCuota, 0);
      }

      if (cuota.Estado === "Pagada" && cuota.FechaPago) {
        const paidMonth = String(cuota.FechaPago).slice(0, 7);
        if (byMonth.has(paidMonth)) {
          byMonth.get(paidMonth).paid += safeNum(cuota.ValorCuota, 0);
          byMonth.get(paidMonth).interest += safeNum(cuota.InteresCuota, 0);
        }
      }
    }

    const rows = months.map((m) => byMonth.get(m));
    const maxPaid = Math.max(1, ...rows.map((r) => r.paid));
    const maxInterest = Math.max(1, ...rows.map((r) => r.interest));
    const maxPending = Math.max(1, ...rows.map((r) => r.pending));

    historyWrap.innerHTML = "";

    for (const row of rows) {
      const label = row.month.slice(2).replace("-", "/");
      const paidW = Math.round((row.paid / maxPaid) * 100);
      const intW = Math.round((row.interest / maxInterest) * 100);
      const penW = Math.round((row.pending / maxPending) * 100);

      const el = document.createElement("div");
      el.className = "histRow";
      el.innerHTML = `
        <div class="histMonth">${escapeHtml(label)}</div>
        <div class="histBars">
          <div class="barLine">
            <div class="barLabel">Pagado</div>
            <div class="bar"><i style="width:${paidW}%"></i></div>
          </div>
          <div class="barLine">
            <div class="barLabel">Interés</div>
            <div class="bar warn"><i style="width:${intW}%"></i></div>
          </div>
          <div class="barLine">
            <div class="barLabel">Pend.</div>
            <div class="bar alt"><i style="width:${penW}%"></i></div>
          </div>
        </div>
        <div class="histTotal">
          <div>${escapeHtml(fmtCOP(row.paid))}</div>
          <div class="muted">Int ${escapeHtml(fmtCOP(row.interest))} · Pend ${escapeHtml(fmtCOP(row.pending))}</div>
        </div>
      `;
      historyWrap.appendChild(el);
    }

    const catTotals = new Map();
    for (const cuota of allItems) {
      const compra = getCompraById(cuota.idCompra);
      const cat = (compra?.Categoria || "—").trim() || "—";
      catTotals.set(cat, (catTotals.get(cat) || 0) + safeNum(cuota.ValorCuota, 0));
    }

    const topCats = Array.from(catTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    topCatsWrap.innerHTML = topCats.map(([name, value]) => `
      <div class="rankItem">
        <div class="rankName">${escapeHtml(name)}</div>
        <div class="rankVal">${escapeHtml(fmtCOP(value))}</div>
      </div>
    `).join("");

    const pendingByCard = new Map();
    for (const cuota of state.cuotas) {
      if (cuota.Estado === "Pagada") continue;
      if (state.idTarjeta && cuota.idTarjeta !== state.idTarjeta) continue;
      pendingByCard.set(
        cuota.idTarjeta,
        (pendingByCard.get(cuota.idTarjeta) || 0) + safeNum(cuota.ValorCuota, 0)
      );
    }

    const topCards = Array.from(pendingByCard.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([cardId, value]) => {
        const tarjeta = getTarjetaById(cardId);
        const label = tarjeta
          ? `${tarjeta.Nombre}${tarjeta.Banco ? ` (${tarjeta.Banco})` : ""}`
          : cardId;
        return [label, value];
      });

    topCardsWrap.innerHTML = topCards.map(([name, value]) => `
      <div class="rankItem">
        <div class="rankName">${escapeHtml(name)}</div>
        <div class="rankVal">${escapeHtml(fmtCOP(value))}</div>
      </div>
    `).join("");

    if (hint) hint.textContent = "Últimos 12 meses";
  }



  /* -------------------------------------------------------------------------- */
  /* Movimientos Gmail                                                          */
  /* -------------------------------------------------------------------------- */
  function getMovimientoEstadoInfo(estado) {
    const value = String(estado || "detectado").toLowerCase();
    if (value === "confirmado") return { label: "Confirmado", cls: "ok" };
    if (value === "descartado") return { label: "Descartado", cls: "bad" };
    if (value === "revisar") return { label: "Revisar", cls: "warn" };
    return { label: "Detectado", cls: "info" };
  }

  function getTarjetaLabelForMovimiento(mov) {
    const tarjeta = getTarjetaById(mov.idTarjetaDetectada);
    if (tarjeta) {
      return `${tarjeta.Nombre}${tarjeta.Banco ? ` (${tarjeta.Banco})` : ""}${tarjeta.Ultimos4 ? ` · *${tarjeta.Ultimos4}` : ""}`;
    }
    return mov.tarjetaUltimos4 ? `No vinculada · *${mov.tarjetaUltimos4}` : "No detectada";
  }

  function getVisibleMovimientosGmail() {
    const estadoFilter = String($("#movEstado")?.value || "pendientes");
    const q = String($("#movSearch")?.value || "").trim().toLowerCase();

    return state.movimientosGmail.filter((mov) => {
      if (state.idTarjeta && mov.idTarjetaDetectada !== state.idTarjeta) return false;

      if (estadoFilter === "pendientes" && !["detectado", "revisar"].includes(mov.estado)) return false;
      if (!["todos", "pendientes"].includes(estadoFilter) && mov.estado !== estadoFilter) return false;

      if (!q) return true;
      const haystack = [
        mov.banco,
        mov.tipo,
        mov.comercio,
        mov.valor,
        mov.fechaMovimiento,
        mov.tarjetaUltimos4,
        mov.asunto,
        mov.observaciones
      ].join(" ").toLowerCase();

      return haystack.includes(q);
    });
  }

  function renderMovimientosGmail() {
    const tbody = $("#tbodyMovimientos");
    const cardsWrap = $("#cardsMovimientos");
    const empty = $("#emptyMovimientos");
    const hint = $("#movHint");
    const statCount = $("#statMovCount");
    const statValue = $("#statMovValue");
    const statReview = $("#statMovReview");

    if (!tbody && !cardsWrap) return;

    const items = getVisibleMovimientosGmail();
    const pending = state.movimientosGmail.filter((m) => ["detectado", "revisar"].includes(m.estado));
    const pendingValue = pending.reduce((sum, m) => sum + safeNum(m.valor, 0), 0);
    const reviewCount = state.movimientosGmail.filter((m) => m.estado === "revisar").length;

    if (statCount) statCount.textContent = String(pending.length);
    if (statValue) statValue.textContent = fmtCOP(pendingValue);
    if (statReview) statReview.textContent = String(reviewCount);
    if (hint) {
      hint.textContent = `${items.length} movimiento(s) visibles · ${pending.length} pendiente(s) por revisar`;
    }

    if (tbody) {
      tbody.innerHTML = "";

      for (const mov of items) {
        const estado = getMovimientoEstadoInfo(mov.estado);
        const canAct = ["detectado", "revisar"].includes(mov.estado);
        const tarjetaLabel = getTarjetaLabelForMovimiento(mov);

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight:950">${escapeHtml(mov.comercio || "(sin comercio)")}</div>
            <div class="muted hideSm" style="margin-top:2px;">
              ${escapeHtml(mov.banco || "—")} · ${escapeHtml(mov.tipo || "—")} · ${escapeHtml(mov.fechaMovimiento || "")}${mov.horaMovimiento ? ` · ${escapeHtml(mov.horaMovimiento)}` : ""}
            </div>
          </td>
          <td class="hideSm">${escapeHtml(tarjetaLabel)}</td>
          <td>
            <div style="font-weight:950">${escapeHtml(fmtCOP(mov.valor))}</div>
            <div class="muted">${escapeHtml(mov.moneda || "COP")}</div>
          </td>
          <td><span class="pill ${estado.cls}">${escapeHtml(estado.label)}</span></td>
          <td>
            <div class="movementActions">
              ${canAct ? `<button class="smallBtn" data-confirm-mov="${escapeHtml(mov.idMovimiento)}">Confirmar</button>` : ""}
              ${canAct ? `<button class="smallBtn" data-dismiss-mov="${escapeHtml(mov.idMovimiento)}">Descartar</button>` : ""}
              ${mov.idCompra ? `<span class="muted">${escapeHtml(mov.idCompra)}</span>` : ""}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      }

      wireMovementButtons(tbody);
    }

    if (cardsWrap) {
      cardsWrap.innerHTML = "";

      for (const mov of items) {
        const estado = getMovimientoEstadoInfo(mov.estado);
        const canAct = ["detectado", "revisar"].includes(mov.estado);
        const card = document.createElement("div");
        card.className = "quotaCard movementCard";
        card.innerHTML = `
          <div class="quotaTop">
            <div>
              <div class="quotaTitle">${escapeHtml(mov.comercio || "(sin comercio)")}</div>
              <div class="quotaMeta">${escapeHtml(mov.banco || "—")} · ${escapeHtml(mov.fechaMovimiento || "")}${mov.horaMovimiento ? ` · ${escapeHtml(mov.horaMovimiento)}` : ""}</div>
            </div>
            <span class="pill ${estado.cls}">${escapeHtml(estado.label)}</span>
          </div>
          <div class="quotaMid">
            <div class="quotaValue">${escapeHtml(fmtCOP(mov.valor))}</div>
            <div class="muted">${escapeHtml(getTarjetaLabelForMovimiento(mov))}</div>
          </div>
          <div class="quotaActions">
            ${canAct ? `<button class="smallBtn" data-confirm-mov="${escapeHtml(mov.idMovimiento)}">Confirmar</button>` : ""}
            ${canAct ? `<button class="smallBtn" data-dismiss-mov="${escapeHtml(mov.idMovimiento)}">Descartar</button>` : ""}
          </div>
        `;
        cardsWrap.appendChild(card);
      }

      wireMovementButtons(cardsWrap);
    }

    if (empty) empty.style.display = items.length ? "none" : "block";
  }

  function wireMovementButtons(root) {
    $$('[data-confirm-mov]', root).forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-confirm-mov");
        const mov = state.movimientosGmail.find((item) => item.idMovimiento === id);
        if (mov) openCompraFromMovimiento(mov);
      };
    });

    $$('[data-dismiss-mov]', root).forEach((btn) => {
      btn.onclick = async () => {
        const idMovimiento = btn.getAttribute("data-dismiss-mov");
        const mov = state.movimientosGmail.find((item) => item.idMovimiento === idMovimiento);
        const label = mov?.comercio || "este movimiento";

        if (!window.confirm(`¿Descartar ${label}?`)) return;

        try {
          setLoading(btn, true);
          await API.post("descartarMovimientoGmail", {
            idMovimiento,
            observaciones: "Descartado desde la app"
          });
          toast("Movimiento descartado", "🧹");
          await sync();
        } catch (err) {
          toast("Error: " + err.message, "⚠️");
        } finally {
          setLoading(btn, false);
        }
      };
    });
  }

  function openCompraFromMovimiento(mov) {
    resetCompraForm();
    state.movimientoConfirmandoId = mov.idMovimiento;
    state.compraEditandoId = null;

    const modalTitle = $("#modalTitle");
    if (modalTitle) modalTitle.textContent = "Confirmar movimiento";

    const selectedCard = mov.idTarjetaDetectada || state.idTarjeta || state.tarjetas[0]?.idTarjeta || "";
    const fecha = mov.fechaMovimiento || todayISO();

    if ($("#formTarjeta")) $("#formTarjeta").value = selectedCard;
    if ($("#fechaCompra")) $("#fechaCompra").value = fecha;
    if ($("#descripcion")) $("#descripcion").value = mov.comercio || mov.asunto || "Compra importada";
    if ($("#categoria")) $("#categoria").value = detectCategoryFromText([mov.comercio, mov.asunto, mov.observaciones].join(" "));
    if ($("#total")) $("#total").value = Math.round(safeNum(mov.valor, 0));
    if ($("#cuotas")) $("#cuotas").value = 1;
    if ($("#mesInicio")) $("#mesInicio").value = String(fecha).slice(0, 7) || state.mes;
    if ($("#aplicarInteres")) $("#aplicarInteres").value = "auto";
    if ($("#nota")) $("#nota").value = `Importado desde Gmail · ${mov.banco || "Banco"} · *${mov.tarjetaUltimos4 || "----"}`;

    applyAutoInterestToModal();
    openModal();
  }

  function openCompraForEdit(compra) {
    if (!compra) return;
    resetCompraForm();
    state.compraEditandoId = compra.idCompra;
    state.movimientoConfirmandoId = null;

    const modalTitle = $("#modalTitle");
    if (modalTitle) modalTitle.textContent = "Editar compra";

    if ($("#formTarjeta")) $("#formTarjeta").value = compra.idTarjeta || "";
    if ($("#fechaCompra")) $("#fechaCompra").value = compra.FechaCompra || todayISO();
    if ($("#descripcion")) $("#descripcion").value = compra.Descripcion || "";
    if ($("#categoria")) $("#categoria").value = compra.Categoria || detectCategoryFromText(compra.Descripcion);
    if ($("#total")) $("#total").value = Math.round(safeNum(compra.Total, 0));
    if ($("#cuotas")) $("#cuotas").value = Math.max(1, Math.floor(safeNum(compra.Cuotas, 1)));
    if ($("#mesInicio")) $("#mesInicio").value = compra.MesInicio || String(compra.FechaCompra || todayISO()).slice(0, 7);
    if ($("#aplicarInteres")) $("#aplicarInteres").value = safeNum(compra.interesMensual, 0) > 0 ? "si" : "no";
    if ($("#interesMensual")) $("#interesMensual").value = safeNum(compra.interesMensual, 0) || "";
    if ($("#nota")) $("#nota").value = compra.Nota || "";

    openModal();
  }

  /* -------------------------------------------------------------------------- */
  /* Export                                                                      */
  /* -------------------------------------------------------------------------- */
  function exportVisibleToCSV() {
    const items = getVisibleMonthItems();

    if (!items.length) {
      toast("No hay nada para exportar con este filtro", "🫠");
      return;
    }

    const rows = items.map((cuota) => {
      const compra = getCompraById(cuota.idCompra) || {};
      const tarjeta = getTarjetaById(cuota.idTarjeta) || {};

      return {
        mes: cuota.Mes,
        tarjetaId: cuota.idTarjeta,
        tarjeta: tarjeta.Nombre || cuota.idTarjeta,
        banco: tarjeta.Banco || "",
        descripcion: compra.Descripcion || "",
        categoria: compra.Categoria || "",
        cuota: `${cuota.NroCuota}/${cuota._cuotasTotal || ""}`,
        valor: safeNum(cuota.ValorCuota, 0),
        interes: safeNum(cuota.InteresCuota, 0),
        estado: cuota.Estado,
        fechaPago: cuota.FechaPago || ""
      };
    });

    const csv = toCSV(rows);
    const fileName = `cc-tracker_${state.mes}${state.idTarjeta ? "_" + state.idTarjeta : ""}.csv`;

    downloadTextFile(csv, fileName, "text/csv;charset=utf-8");
    toast("CSV exportado", "📄");
  }

  /* -------------------------------------------------------------------------- */
  /* Render all                                                                  */
  /* -------------------------------------------------------------------------- */
  function renderAll() {
    renderBackendStatus();

    const items = getVisibleMonthItems();
    renderListHint(items);
    renderStats();
    renderComprasMes();
    renderTable(items);
    renderCards(items);
    renderMovimientosGmail();
    renderGmailSyncStatus();
    renderHistoryAndStats();

    const emptyState = $("#emptyState");
    if (emptyState) {
      emptyState.style.display = items.length ? "none" : "block";
    }
  }

  function renderComprasMes() {
    const tbody = $("#tbodyComprasMes");
    const empty = $("#emptyComprasMes");
    const hint = $("#comprasHint");
    if (!tbody) return;

    const rows = state.compras
      .filter((c) => String(c.FechaCompra || c.MesInicio || "").slice(0, 7) === state.mes)
      .filter((c) => !state.idTarjeta || c.idTarjeta === state.idTarjeta)
      .sort((a, b) => String(b.FechaCompra).localeCompare(String(a.FechaCompra)));

    tbody.innerHTML = "";
    for (const compra of rows) {
      const tarjeta = getTarjetaById(compra.idTarjeta) || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(compra.FechaCompra || "")}</td>
        <td>
          <div style="font-weight:900">${escapeHtml(compra.Descripcion || "(sin comercio)")}</div>
          <div class="muted">${escapeHtml(compra.Origen || "manual")}</div>
        </td>
        <td class="hideSm">${escapeHtml(tarjeta.Nombre || compra.idTarjeta || "—")}</td>
        <td>${escapeHtml(fmtCOP(compra.Total))}</td>
        <td>${escapeHtml(String(compra.Cuotas || 1))}</td>
        <td><span class="pill info">${escapeHtml(compra.Estado || "Activa")}</span></td>
        <td><button class="smallBtn" type="button" data-edit-compra="${escapeHtml(compra.idCompra)}">Editar</button></td>
      `;
      tbody.appendChild(tr);
    }

    $$("[data-edit-compra]", tbody).forEach((btn) => {
      btn.onclick = () => {
        const idCompra = btn.getAttribute("data-edit-compra");
        openCompraForEdit(state.comprasIndex.get(idCompra) || state.compras.find((c) => c.idCompra === idCompra));
      };
    });

    if (empty) empty.style.display = rows.length ? "none" : "block";
    if (hint) hint.textContent = `${rows.length} compra(s) en ${state.mes}`;
  }

  function renderGmailSyncStatus() {
    const wrap = $("#gmailSyncStatus");
    if (!wrap) return;
    const s = state.gmailSyncStatus || {};
    const daily = s.daily || {};
    const rows = [
      ["Actualización diaria", daily.reason || "Sin revisión automática registrada"],
      ["Se ejecutó hoy", daily.date === todayISO() ? "Sí" : "No"],
      ["Resultado", daily.result || (daily.skipped === true ? "omitido" : daily.skipped === false ? "sincronizado" : "No disponible")],
      ["Última sincronización", s.lastSync || "No registrada"],
      ["Query usada", s.query || "No disponible"],
      ["Rango buscado", s.rangoFechas || "No disponible"],
      ["Correos encontrados", s.correosEncontrados ?? 0],
      ["Correos nuevos procesados", s.correosProcesadosNuevos ?? s.correosProcesados ?? 0],
      ["Compras detectadas", s.comprasDetectadas ?? s.movimientosNuevos ?? 0],
      ["Ignorados no tarjeta", s.ignoradosNoTarjeta ?? s.ignoradosSinMovimiento ?? 0],
      ["Duplicados ignorados", s.duplicadosIgnorados ?? 0],
      ["Errores parser reales", s.erroresParserReales ?? s.erroresParser ?? 0],
      ["Último error", s.ultimoError || "Sin error registrado"],
      ["Recomendación", s.recomendacion || "Ejecuta syncGmailMovimientos desde Apps Script para generar diagnóstico."]
    ];

    wrap.innerHTML = rows.map(([label, value], idx) => `
      <div class="diagnosticItem ${idx === 0 || idx === 4 || idx >= 12 ? "full" : ""}">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("");
  }

  /* -------------------------------------------------------------------------- */
  /* Sync                                                                        */
  /* -------------------------------------------------------------------------- */
  async function sync() {
    const mySeq = ++state.syncSeq;

    try {
      setLoadingGlobal(true);
      renderBackendStatus();

      const tarjetasRes = await API.get({ action: "listarTarjetas" });
      if (mySeq !== state.syncSeq) return;

      state.tarjetas = (tarjetasRes?.data || []).map(normalizeTarjeta);
      state.tarjetasIndex = new Map(state.tarjetas.map((t) => [t.idTarjeta, t]));

      renderTarjetas();

      // Traemos TODO para que histórico/rankings no queden mintiendo.
      const cuotasRes = await API.get({
        action: "listarCuotas",
        idTarjeta: state.idTarjeta || ""
      });
      if (mySeq !== state.syncSeq) return;

      const compras = (cuotasRes?.data?.compras || cuotasRes?.data?.Compras || []).map(normalizeCompra);
      const cuotas = (cuotasRes?.data?.cuotas || cuotasRes?.data?.Cuotas || []).map(normalizeCuota);

      state.compras = compras;
      state.cuotas = cuotas;
      state.comprasIndex = new Map(compras.map((c) => [c.idCompra, c]));

      try {
        const movRes = await API.get({
          action: "listarMovimientosGmail",
          mes: state.mes
        });
        if (mySeq !== state.syncSeq) return;
        state.movimientosGmail = (movRes?.data || []).map(normalizeMovimientoGmail);
      } catch (err) {
        // Si el backend todavía no tiene la hoja/endpoints, no tumbamos la app completa.
        state.movimientosGmail = [];
        console.warn("No se pudieron cargar movimientos Gmail", err);
      }

      try {
        const syncStatusRes = await API.get({ action: "listarGmailSyncStatus" });
        if (mySeq !== state.syncSeq) return;
        state.gmailSyncStatus = syncStatusRes?.data || null;
      } catch (err) {
        state.gmailSyncStatus = {
          recomendacion: "No se pudo cargar el diagnóstico Gmail: " + (err?.message || err)
        };
        console.warn("No se pudo cargar diagnóstico Gmail", err);
      }

      hydrateComputedQuotaFields();
      renderAll();
    } catch (err) {
      const hint = $("#listHint");
      if (hint) hint.textContent = "Error al cargar";

      renderBackendStatus();
      toast("Error: " + err.message, "⚠️");
    } finally {
      if (mySeq === state.syncSeq) {
        setLoadingGlobal(false);
      }
    }
  }

  async function syncGmailOnceDailyOnOpen() {
    if (state.dailyGmailSyncChecked || !API.isRealBackend?.()) return;
    state.dailyGmailSyncChecked = true;

    try {
      const res = await API.post("syncGmailDiarioSiHaceFalta", {});
      const data = res?.data || {};
      if (data.status) {
        state.gmailSyncStatus = {
          ...data.status,
          daily: {
            skipped: data.skipped === true,
            date: data.date || todayISO(),
            reason: data.reason || "",
            result: data.skipped ? "omitido" : "sincronizado"
          }
        };
      }
      toast(data.skipped ? "Gmail ya estaba actualizado hoy" : "Gmail actualizado al abrir", data.skipped ? "ℹ" : "✓");
    } catch (err) {
      const message = err?.message || "No se pudo revisar Gmail";
      const endpointMissing = /acci[oó]n no v[aá]lida|syncGmailDiarioSiHaceFalta/i.test(message);
      state.gmailSyncStatus = {
        ...(state.gmailSyncStatus || {}),
        daily: {
          skipped: null,
          date: todayISO(),
          reason: endpointMissing
            ? "El backend publicado todavÃ­a no tiene la sincronizaciÃ³n diaria automÃ¡tica"
            : message,
          result: endpointMissing ? "pendiente de despliegue" : "error"
        }
      };
      if (!endpointMissing) {
        toast("No se pudo sincronizar Gmail al abrir", "!");
        console.warn("No se pudo ejecutar sync diario Gmail", err);
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Events                                                                      */
  /* -------------------------------------------------------------------------- */
  /*
    Checks manuales Gmail:
    - Confirmar movimiento con 1 cuota y validar Compras/Cuotas.
    - Confirmar movimiento con 6 cuotas y validar seis filas en Cuotas.
    - Confirmar cambiando categoria, total, tarjeta, fecha, mesInicio e interes.
    - Editar esa compra y validar que no queden cuotas duplicadas para idCompra.
  */
  function resetCompraForm() {
    state.movimientoConfirmandoId = null;
    state.compraEditandoId = null;

    const modalTitle = $("#modalTitle");
    if (modalTitle) modalTitle.textContent = "Nueva compra";

    const fechaCompra = $("#fechaCompra");
    const descripcion = $("#descripcion");
    const categoria = $("#categoria");
    const total = $("#total");
    const cuotas = $("#cuotas");
    const mesInicio = $("#mesInicio");
    const nota = $("#nota");
    const aplicarInteres = $("#aplicarInteres");
    const interesMensual = $("#interesMensual");

    if (fechaCompra) fechaCompra.value = todayISO();
    if (descripcion) descripcion.value = "";
    if (categoria) categoria.value = "";
    if (total) total.value = "";
    if (cuotas) cuotas.value = 1;
    if (mesInicio) mesInicio.value = state.mes;
    if (nota) nota.value = "";
    if (aplicarInteres) aplicarInteres.value = "auto";
    if (interesMensual) interesMensual.value = "";

    renderTarjetas();
    applyAutoInterestToModal();
  }

  function bindEvents() {
    const searchInput = $("#search");
    const mesSelect = $("#mesSelect");
    const tarjetaSelect = $("#tarjetaSelect");
    const btnSync = $("#btnSync");
    const btnNuevaCompra = $("#btnNuevaCompra");
    const btnCerrarModal = $("#btnCerrarModal");
    const btnCancelar = $("#btnCancelar");
    const btnExportCsv = $("#btnExportCsv");
    const btnOpenConfig = $("#btnOpenConfig");
    const btnCerrarConfig = $("#btnCerrarConfig");
    const btnResetConfig = $("#btnResetConfig");
    const btnGuardarConfig = $("#btnGuardarConfig");
    const formConfig = $("#formConfig");
    const formCompra = $("#formCompra");
    const aplicarInteres = $("#aplicarInteres");
    const toastClose = $("#toastClose");
    const movEstado = $("#movEstado");
    const movSearch = $("#movSearch");
    const descripcion = $("#descripcion");
    const categoria = $("#categoria");

    const onSearch = debounce(() => renderAll(), 140);
    const onMovSearch = debounce(() => renderMovimientosGmail(), 140);

    if (toastClose) {
      toastClose.onclick = () => {
        const toastEl = $("#toast");
        if (toastEl) toastEl.style.display = "none";
      };
    }

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;

      const compraModal = $("#modalCompra");
      const configModal = $("#modalConfig");

      if (compraModal && compraModal.getAttribute("aria-hidden") === "false") {
        closeModal();
        return;
      }

      if (configModal && configModal.getAttribute("aria-hidden") === "false") {
        closeConfigModal();
      }
    });

    if (mesSelect) {
      mesSelect.onchange = async (e) => {
        state.mes = e.target.value;
        const mesInicio = $("#mesInicio");
        if (mesInicio) mesInicio.value = state.mes;
        renderAll();
      };
    }

    if (tarjetaSelect) {
      tarjetaSelect.onchange = async (e) => {
        state.idTarjeta = e.target.value || null;
        await sync();
      };
    }

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.q = e.target.value || "";
        onSearch();
      });
    }

    if (movEstado) movEstado.onchange = () => renderMovimientosGmail();
    if (movSearch) movSearch.addEventListener("input", onMovSearch);
    if (descripcion) descripcion.addEventListener("input", () => suggestCategoryForCurrentForm(false));
    if (categoria) categoria.addEventListener("blur", () => {
      if (!categoria.value.trim()) suggestCategoryForCurrentForm(true);
    });

    if (btnSync) btnSync.onclick = sync;

    if (btnNuevaCompra) {
      btnNuevaCompra.onclick = () => {
        resetCompraForm();
        openModal();
      };
    }

    if (btnCerrarModal) btnCerrarModal.onclick = () => {
      closeModal();
      resetCompraForm();
    };
    if (btnCancelar) btnCancelar.onclick = () => {
      closeModal();
      resetCompraForm();
    };
    if (aplicarInteres) aplicarInteres.onchange = () => applyAutoInterestToModal();
    if (btnExportCsv) btnExportCsv.onclick = exportVisibleToCSV;
    if (btnOpenConfig) btnOpenConfig.onclick = openConfigModal;
    if (btnCerrarConfig) btnCerrarConfig.onclick = closeConfigModal;

    if (btnResetConfig) {
      btnResetConfig.onclick = () => {
        saveConfig({
          defaultInterestMensual: 0,
          interestByCard: {}
        });
        hydrateConfigUI();
        hydrateComputedQuotaFields();
        applyAutoInterestToModal();
        renderAll();
        toast("Configuración restaurada", "🧽");
      };
    }

    const saveAndCloseConfig = () => {
      readConfigUIAndSave();
      renderAll();
      closeConfigModal();
      toast("Configuración guardada", "⚙️");
    };

    if (btnGuardarConfig) btnGuardarConfig.onclick = saveAndCloseConfig;
    if (formConfig) {
      formConfig.addEventListener("submit", (e) => {
        e.preventDefault();
        saveAndCloseConfig();
      });
    }

    if (formCompra) {
      formCompra.addEventListener("submit", async (e) => {
        e.preventDefault();

        const btnGuardar = $("#btnGuardar");

        const mode = $("#aplicarInteres")?.value || "auto";
        const rawInterest = String($("#interesMensual")?.value || "").trim();
        let interesMensual = safeNum(rawInterest, 0);

        if (mode === "auto" && !rawInterest) {
          interesMensual = resolveAutoInterestForSelectedCard($("#formTarjeta")?.value || "");
        }

        if (mode === "no") {
          interesMensual = 0;
        }

        const payload = {
          idTarjeta: $("#formTarjeta")?.value || "",
          fechaCompra: $("#fechaCompra")?.value || "",
          descripcion: String($("#descripcion")?.value || "").trim(),
          categoria: String($("#categoria")?.value || "").trim(),
          total: safeNum($("#total")?.value, 0),
          cuotas: Math.max(1, Math.floor(safeNum($("#cuotas")?.value, 1))),
          mesInicio: $("#mesInicio")?.value || "",
          interesMensual,
          nota: String($("#nota")?.value || "").trim()
        };

        if (
          !payload.idTarjeta ||
          !payload.fechaCompra ||
          !payload.descripcion ||
          !payload.categoria ||
          !payload.total ||
          !payload.cuotas ||
          !payload.mesInicio
        ) {
          toast("Faltan datos obligatorios", "⚠️");
          return;
        }

        if (payload.total <= 0 || payload.cuotas <= 0) {
          toast("Total y cuotas deben ser > 0", "⚠️");
          return;
        }

        try {
          setLoading(btnGuardar, true);
          setLoadingGlobal(true);

          if (state.compraEditandoId) {
            await API.post("actualizarCompra", {
              idCompra: state.compraEditandoId,
              ...payload
            });
            toast("Compra actualizada", "âœ…");
          } else if (state.movimientoConfirmandoId) {
            await API.post("confirmarMovimientoComoCompra", {
              idMovimiento: state.movimientoConfirmandoId,
              ...payload
            });
            toast("Movimiento confirmado como compra", "✅");
          } else {
            await API.post("crearCompra", payload);
            toast("Compra creada", "✅");
          }

          closeModal();
          resetCompraForm();
          await sync();
        } catch (err) {
          toast("Error: " + err.message, "⚠️");
        } finally {
          setLoading(btnGuardar, false);
          setLoadingGlobal(false);
        }
      });
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Init                                                                        */
  /* -------------------------------------------------------------------------- */
  window.addEventListener("cc-auth-state", async (event) => {
    const authorized = Boolean(event?.detail?.authorized);

    if (!authorized) {
      state.dailyGmailSyncChecked = false;
      resetDataAfterLogout();
      renderBackendStatus();
      return;
    }

    await syncGmailOnceDailyOnOpen();
    await sync();
  });

  window.addEventListener("DOMContentLoaded", async () => {
    loadConfig();
    readBackendState();
    setDefaultsUI();
    wireModalBackdrops();
    bindEvents();
    renderBackendStatus();
    renderCategoryDatalist();

    const authorized = await waitForAuthorizedSession();
    if (!authorized) return;

    await syncGmailOnceDailyOnOpen();
    await sync();
  });
})();
