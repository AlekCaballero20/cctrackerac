#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "Firebase/Google API key": re.compile(r"AIza[0-9A-Za-z_\-]{20,}"),
    "Apps Script URL": re.compile(r"https://script\.google\.com/macros/s/AKfycb[^\s\"']+"),
    "Service account private key": re.compile(r"-----BEGIN PRIVATE KEY-----"),
    "Generic token assignment": re.compile(r"(?i)(api[_-]?token|secret|password)\s*[:=]\s*[\"'][^\"']{8,}[\"']"),
}
SKIP_DIRS = {".git", "node_modules", "dist"}
SKIP_FILES = {"tools/security-scan.py"}

hits = []
for path in ROOT.rglob("*"):
    if not path.is_file():
        continue
    rel = path.relative_to(ROOT).as_posix()
    if rel in SKIP_FILES:
        continue
    if any(part in SKIP_DIRS for part in path.parts):
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    for label, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            hits.append((label, path.relative_to(ROOT), line))

if hits:
    print("Posibles datos sensibles encontrados:")
    for label, path, line in hits:
        print(f"- {label}: {path}:{line}")
    raise SystemExit(1)

print("OK: no se encontraron patrones sensibles comunes.")
