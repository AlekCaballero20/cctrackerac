// utils.js — CC Tracker · Musicala (v2.0)
// Helpers puros + DOM helpers mínimos
// Expuesto como window.CC_UTILS
//
// Objetivos:
// - Evitar líos de zona horaria con toISOString()
// - Mantener compatibilidad con app.js / api.js
// - Centralizar helpers reutilizables sin duplicar humo

(() => {
  "use strict";

  /* -------------------------------------------------------------------------- */
  /* DOM helpers                                                                 */
  /* -------------------------------------------------------------------------- */
  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  /* -------------------------------------------------------------------------- */
  /* Números                                                                     */
  /* -------------------------------------------------------------------------- */
  function safeNum(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function round(value, digits = 0) {
    const factor = Math.pow(10, safeNum(digits, 0));
    return Math.round(safeNum(value, 0) * factor) / factor;
  }

  /* -------------------------------------------------------------------------- */
  /* Formato / texto                                                             */
  /* -------------------------------------------------------------------------- */
  const copFormatter = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });

  function fmtCOP(value) {
    return copFormatter.format(safeNum(value, 0));
  }

  function normStr(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function slugify(value) {
    return normStr(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
  }

  /* -------------------------------------------------------------------------- */
  /* Fechas locales                                                              */
  /* -------------------------------------------------------------------------- */
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
  }

  function localDateParts(date = new Date()) {
    return {
      y: date.getFullYear(),
      m: date.getMonth() + 1,
      d: date.getDate()
    };
  }

  function todayISO() {
    const { y, m, d } = localDateParts(new Date());
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function monthISO(date = new Date()) {
    const { y, m } = localDateParts(date);
    return `${y}-${pad2(m)}`;
  }

  // "YYYY-MM" -> Date(YYYY, MM-1, 1)
  function parseMonth(value) {
    const str = normStr(value);
    if (!/^\d{4}-\d{2}$/.test(str)) return null;

    const [y, m] = str.split("-").map(Number);
    const date = new Date(y, m - 1, 1);

    return isValidDate(date) ? date : null;
  }

  // Suma meses a "YYYY-MM"
  function addMonths(yyyyMm, delta = 0) {
    const base = parseMonth(yyyyMm) || new Date();
    const date = new Date(base.getFullYear(), base.getMonth(), 1);
    date.setMonth(date.getMonth() + safeNum(delta, 0));
    return monthISO(date);
  }

  // "YYYY-MM-DD" -> "YYYY-MM" (best effort)
  function toMonth(value) {
    const str = normStr(value);
    if (!str) return "";

    if (/^\d{4}-\d{2}$/.test(str)) return str;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str.slice(0, 7);

    const maybeDate = new Date(str);
    if (isValidDate(maybeDate)) return monthISO(maybeDate);

    return "";
  }

  /* -------------------------------------------------------------------------- */
  /* Colecciones                                                                 */
  /* -------------------------------------------------------------------------- */
  function uniq(arr) {
    const out = [];
    const seen = new Set();

    for (const item of arr || []) {
      const key = String(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }

    return out;
  }

  function groupBy(arr, getKey) {
    const map = new Map();

    for (const item of arr || []) {
      const key = getKey(item);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }

    return map;
  }

  function indexBy(arr, getKey) {
    const map = new Map();

    for (const item of arr || []) {
      map.set(getKey(item), item);
    }

    return map;
  }

  function structuredCloneSafe(value) {
    try {
      return structuredClone(value);
    } catch (_) {
      return JSON.parse(JSON.stringify(value));
    }
  }

  /* -------------------------------------------------------------------------- */
  /* CSV / descargas                                                             */
  /* -------------------------------------------------------------------------- */
  function toCSV(rows, options = {}) {
    const {
      delimiter = ",",
      headers = null
    } = options;

    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return "";

    const cols = Array.isArray(headers) && headers.length
      ? headers
      : Object.keys(list[0]);

    const esc = (value) => {
      const s = String(value ?? "");
      return `"${s.replace(/"/g, '""')}"`;
    };

    return [
      cols.join(delimiter),
      ...list.map((row) => cols.map((col) => esc(row?.[col])).join(delimiter))
    ].join("\n");
  }

  // Compatibilidad:
  // - nuevo orden recomendado: downloadTextFile(content, filename, mime)
  // - orden viejo tolerado:    downloadTextFile(filename, content, mime)
  function downloadTextFile(arg1, arg2, arg3 = "text/plain;charset=utf-8") {
    let content;
    let filename;
    let mime = arg3;

    const looksLikeFilename = (value) =>
      typeof value === "string" &&
      /^[^\\/\n\r\t]+\.[a-z0-9]{1,8}$/i.test(value.trim());

    if (looksLikeFilename(arg1) && !looksLikeFilename(arg2)) {
      filename = arg1;
      content = arg2;
    } else {
      content = arg1;
      filename = arg2;
    }

    filename = normStr(filename) || "archivo.txt";
    let finalContent = content ?? "";

    // Excel a veces necesita BOM para no dañar tildes en CSV.
    if (typeof finalContent === "string" && /text\/csv|application\/csv|csv/i.test(mime)) {
      if (!finalContent.startsWith("\uFEFF")) {
        finalContent = "\uFEFF" + finalContent;
      }
    }

    const blob = new Blob([finalContent], { type: mime });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  /* -------------------------------------------------------------------------- */
  /* Timing                                                                      */
  /* -------------------------------------------------------------------------- */
  function debounce(fn, ms = 180) {
    let timer = null;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /* -------------------------------------------------------------------------- */
  /* Negocio útil reutilizable                                                   */
  /* -------------------------------------------------------------------------- */
  function calcInterestForInstallment(base, interesMensual, installmentIndex, totalInstallments = null) {
    const rate = safeNum(interesMensual, 0) / 100;
    if (!(rate > 0)) return 0;

    const total = totalInstallments == null ? 0 : safeNum(totalInstallments, 0);
    const idx = Math.max(1, safeNum(installmentIndex, 1));

    const remaining = total
      ? Math.max(1, total - idx + 1)
      : Math.max(1, 6 - idx + 1);

    const estimatedBalance = safeNum(base, 0) * (remaining + 0.5);
    const interest = Math.round(estimatedBalance * rate);

    return clamp(interest, 0, Math.round(safeNum(base, 0) * 0.65));
  }

  /* -------------------------------------------------------------------------- */
  /* API pública                                                                 */
  /* -------------------------------------------------------------------------- */
  window.CC_UTILS = {
    $,
    $$,

    safeNum,
    clamp,
    round,

    fmtCOP,
    normStr,
    escapeHtml,
    slugify,

    todayISO,
    monthISO,
    parseMonth,
    addMonths,
    toMonth,
    isValidDate,

    uniq,
    groupBy,
    indexBy,
    structuredCloneSafe,

    toCSV,
    downloadTextFile,

    debounce,
    calcInterestForInstallment
  };
})();