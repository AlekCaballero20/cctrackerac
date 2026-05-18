// firebase.config.template.js
// Esta plantilla documenta los valores que genera GitHub Actions en js/firebase.config.js.

window.CC_FIREBASE_CONFIG = {
  apiKey: "__CC_FIREBASE_API_KEY__",
  authDomain: "__CC_FIREBASE_AUTH_DOMAIN__",
  projectId: "__CC_FIREBASE_PROJECT_ID__",
  storageBucket: "__CC_FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__CC_FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__CC_FIREBASE_APP_ID__"
};

window.CC_ALLOWED_EMAILS = __CC_ALLOWED_EMAILS_JSON__;

window.CC_RUNTIME_CONFIG = {
  backendMode: "apps_script",
  appsScriptUrl: "__CC_APPS_SCRIPT_URL__",
  demoOnNetworkError: false,
  timeoutMs: 20000
};
