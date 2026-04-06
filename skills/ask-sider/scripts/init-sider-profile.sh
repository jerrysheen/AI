#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="${1:-${SKILL_DIR}/config/sider-chat.json}"

read_config_field() {
  local field="$1"
  node -e 'const { resolveSiderConfig } = require(process.argv[1]); const cfg = resolveSiderConfig(process.argv[2]); const value = process.argv[3].split(".").reduce((acc, key) => acc && acc[key], cfg); process.stdout.write(String(value ?? ""));' \
    "${SCRIPT_DIR}/runtime_shim.js" "${CONFIG_PATH}" "${field}"
}

DEBUG_PORT="$(read_config_field chrome.remote_debug_port)"
CHROME_PROFILE_DIR="$(read_config_field chrome.user_data_dir)"
STARTUP_URL="$(read_config_field chrome.startup_url)"
CHROME_PATH="$(read_config_field chrome.path)"

mkdir -p "${CHROME_PROFILE_DIR}"

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

printf 'Chrome launched with profile: %s\n' "${CHROME_PROFILE_DIR}"
printf 'Log in to Sider in that window once, then future runs can stay fully automated.\n'
