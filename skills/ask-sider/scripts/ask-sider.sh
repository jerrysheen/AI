#!/usr/bin/env bash
set -euo pipefail

QUESTION=""
CONFIG_PATH=""
AS_JSON=0
SKIP_BROWSER_CLEANUP=0
REUSE_EXISTING_CHROME=0

while (($# > 0)); do
  case "$1" in
    --config)
      CONFIG_PATH="${2:-}"
      shift 2
      ;;
    --as-json)
      AS_JSON=1
      shift
      ;;
    --skip-browser-cleanup)
      SKIP_BROWSER_CLEANUP=1
      shift
      ;;
    --reuse-existing-chrome)
      REUSE_EXISTING_CHROME=1
      shift
      ;;
    --*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$QUESTION" ]]; then
        QUESTION="$1"
      else
        QUESTION="${QUESTION}"$'\n'"$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$QUESTION" ]]; then
  echo "Usage: ./skills/ask-sider/scripts/ask-sider.sh \"your question\" [--as-json] [--config <path>]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="${CONFIG_PATH:-${SKILL_DIR}/config/sider-chat.json}"

ensure_port_ready() {
  local port="$1"
  local deadline=$((SECONDS + 15))
  while (( SECONDS < deadline )); do
    if curl -fsS "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

install_ws_if_needed() {
  if [[ ! -f "${SKILL_DIR}/node_modules/ws/package.json" ]]; then
    npm install --prefix "${SKILL_DIR}" --silent >/dev/null
  fi
}

read_config_field() {
  local field="$1"
  node -e 'const { resolveSiderConfig } = require(process.argv[1]); const cfg = resolveSiderConfig(process.argv[2]); const value = process.argv[3].split(".").reduce((acc, key) => acc && acc[key], cfg); process.stdout.write(String(value ?? ""));' \
    "${SCRIPT_DIR}/runtime_shim.js" "${CONFIG_PATH}" "${field}"
}

DEBUG_PORT="$(read_config_field chrome.remote_debug_port)"
CHROME_PATH="$(read_config_field chrome.path)"
CHROME_PROFILE_DIR="$(read_config_field chrome.user_data_dir)"
STARTUP_URL="$(read_config_field chrome.startup_url)"
STARTUP_DELAY_MS="$(read_config_field chrome.startup_delay_ms)"

if ! curl -fsS "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  mkdir -p "${CHROME_PROFILE_DIR}"

  if [[ "${REUSE_EXISTING_CHROME}" -eq 0 && "${SKIP_BROWSER_CLEANUP}" -eq 0 && "$(uname -s)" == "Darwin" ]]; then
    pkill -f "Google Chrome.*--remote-debugging-port=${DEBUG_PORT}" >/dev/null 2>&1 || true
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    open -na "Google Chrome" --args \
      "--user-data-dir=${CHROME_PROFILE_DIR}" \
      "--remote-debugging-port=${DEBUG_PORT}" \
      "--no-first-run" \
      "--no-default-browser-check" \
      "--new-window" \
      "${STARTUP_URL}"
  else
    "${CHROME_PATH}" \
      "--user-data-dir=${CHROME_PROFILE_DIR}" \
      "--remote-debugging-port=${DEBUG_PORT}" \
      "--no-first-run" \
      "--no-default-browser-check" \
      "--new-window" \
      "${STARTUP_URL}" >/dev/null 2>&1 &
  fi

  sleep "$(awk "BEGIN { print ${STARTUP_DELAY_MS} / 1000 }")"

  if ! ensure_port_ready "${DEBUG_PORT}"; then
    echo "Chrome remote debugging port ${DEBUG_PORT} is not reachable." >&2
    echo "Run ./skills/ask-sider/scripts/init-sider-profile.sh once, log in to Sider, then retry." >&2
    exit 1
  fi
fi

install_ws_if_needed

JSON_TEXT="$(
  SKILL_DIR_ENV="${SKILL_DIR}" CONFIG_PATH_ENV="${CONFIG_PATH}" QUESTION_ENV="${QUESTION}" node - <<'NODE'
global.WebSocket = require(process.env.SKILL_DIR_ENV + '/node_modules/ws');
process.argv = [
  'node',
  process.env.SKILL_DIR_ENV + '/scripts/ask-sider.js',
  '--config',
  process.env.CONFIG_PATH_ENV,
  '--question',
  process.env.QUESTION_ENV,
];
require(process.env.SKILL_DIR_ENV + '/scripts/ask-sider.js');
NODE
)"

if [[ "${AS_JSON}" -eq 1 ]]; then
  printf '%s\n' "${JSON_TEXT}"
  exit 0
fi

RESULT_STATUS="$(printf '%s' "${JSON_TEXT}" | node -e 'let raw=""; process.stdin.on("data", (d) => raw += d); process.stdin.on("end", () => { const json = JSON.parse(raw); process.stdout.write(String(json.status || "")); });')"
if [[ "${RESULT_STATUS}" != "ok" ]]; then
  printf '%s\n' "${JSON_TEXT}" >&2
  exit 1
fi

printf '%s' "${JSON_TEXT}" | node -e 'let raw=""; process.stdin.on("data", (d) => raw += d); process.stdin.on("end", () => { const json = JSON.parse(raw); process.stdout.write(String(json.reply_text || "")); });'
printf '\n'
