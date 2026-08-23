#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed or not on PATH." >&2
  exit 1
fi

codex exec --full-auto "$(cat CODEX_CONTINUE_PROMPT.md)"
