#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

write_stage() {
  local percent="$1"
  local label="$2"
  local width=28
  local filled=$(( percent * width / 100 ))
  local bar
  printf -v bar '%*s' "$filled" ''
  bar="${bar// /#}"
  printf -v bar '%-*s' "$width" "$bar"
  bar="${bar// /.}"
  printf '[%3d%%] [%s] %s\n' "$percent" "$bar" "$label"
}

load_env_file() {
  local env_file="$ROOT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    return
  fi

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *"="* ]] && continue

    local name="${line%%=*}"
    local value="${line#*=}"
    name="${name%"${name##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ ${#value} -ge 2 ]]; then
      if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi

    if [[ -z "${!name+x}" ]]; then
      export "$name=$value"
    fi
  done < "$env_file"
}

write_stage 5 "prepare workspace"
write_stage 15 "load .env"
load_env_file

write_stage 35 "resolve python entrypoint"
PYTHON_BIN="${AI_KNOWLEDGE_BASE_PYTHON:-$ROOT_DIR/.venv-hf-cpu/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "knowledge-base python runtime not found: $PYTHON_BIN" >&2
  echo "Expected the CPU-only environment at .venv-hf-cpu or set AI_KNOWLEDGE_BASE_PYTHON." >&2
  exit 1
fi

export AI_KNOWLEDGE_BASE_BOOT_PROGRESS=1
write_stage 55 "import knowledge-base modules"
write_stage 75 "initialize storage and http server"
write_stage 90 "handoff to python runtime"
PYTHONPATH=. "$PYTHON_BIN" -m src.knowledge_base.server
