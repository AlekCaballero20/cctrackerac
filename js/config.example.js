// config.example.js — versión legada
// Ahora la configuración real vive en js/firebase.config.js.
// No uses apiToken como seguridad principal. El backend valida Firebase ID Token en cada petición.

window.CC_RUNTIME_CONFIG = {
  backendMode: "apps_script",
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbx0lsn8gH_nHmhMZ71vtrEnn0DE03e8i4eZQp-Gk2CC1F07NOZ-AgUIahATUzFIc_2i8A/exec",
  timeoutMs: 20000
};
