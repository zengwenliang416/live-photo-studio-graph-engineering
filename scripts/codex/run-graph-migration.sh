#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed or not on PATH." >&2
  echo "Install/authenticate Codex, then run this script again." >&2
  exit 1
fi

if [[ ! -f CODEX_FULL_EXECUTION_PROMPT.md ]]; then
  echo "CODEX_FULL_EXECUTION_PROMPT.md was not found." >&2
  exit 1
fi

codex exec --full-auto "$(cat CODEX_FULL_EXECUTION_PROMPT.md)"
