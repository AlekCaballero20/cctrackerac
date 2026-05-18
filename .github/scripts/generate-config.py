#!/usr/bin/env python3
import json
import os
import pathlib
import sys

REQUIRED = [
    "CC_FIREBASE_API_KEY",
    "CC_FIREBASE_AUTH_DOMAIN",
    "CC_FIREBASE_PROJECT_ID",
    "CC_FIREBASE_STORAGE_BUCKET",
    "CC_FIREBASE_MESSAGING_SENDER_ID",
    "CC_FIREBASE_APP_ID",
    "CC_ALLOWED_EMAILS",
    "CC_APPS_SCRIPT_URL",
]

missing = [name for name in REQUIRED if not os.environ.get(name)]
if missing:
    print("Missing required GitHub Secrets:", ", ".join(missing), file=sys.stderr)
    raise SystemExit(1)

allowed_raw = os.environ.get("CC_ALLOWED_EMAILS", "")
allowed = [item.strip().lower() for item in allowed_raw.replace(";", ",").split(",") if item.strip()]

def js_string(value):
    return json.dumps(value or "")

content = """// firebase.config.js - generado por GitHub Actions. No editar manualmente.
window.CC_FIREBASE_CONFIG = {
  apiKey: %s,
  authDomain: %s,
  projectId: %s,
  storageBucket: %s,
  messagingSenderId: %s,
  appId: %s
};

window.CC_ALLOWED_EMAILS = %s;

window.CC_RUNTIME_CONFIG = {
  backendMode: "apps_script",
  appsScriptUrl: %s,
  demoOnNetworkError: false,
  timeoutMs: 20000
};
""" % (
    js_string(os.environ.get("CC_FIREBASE_API_KEY")),
    js_string(os.environ.get("CC_FIREBASE_AUTH_DOMAIN")),
    js_string(os.environ.get("CC_FIREBASE_PROJECT_ID")),
    js_string(os.environ.get("CC_FIREBASE_STORAGE_BUCKET")),
    js_string(os.environ.get("CC_FIREBASE_MESSAGING_SENDER_ID")),
    js_string(os.environ.get("CC_FIREBASE_APP_ID")),
    json.dumps(allowed),
    js_string(os.environ.get("CC_APPS_SCRIPT_URL")),
)

out_path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/js/firebase.config.js")
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(content, encoding="utf-8")
print(f"Generated {out_path}")
