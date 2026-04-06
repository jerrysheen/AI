#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
BASE_URL="${AI_REVIEW_ENGINE_URL:-http://127.0.0.1:8776}"
SHARED_DATA_ROOT="${AI_SHARED_DATA_DIR:-${REPO_ROOT}/.ai-data}"
RUNTIME_DIR="${SHARED_DATA_ROOT}/review-engine/runs"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"

usage() {
  cat <<'EOF' >&2
Usage:
  skills/review-engine/scripts/review_engine.sh start
  skills/review-engine/scripts/review_engine.sh status
  skills/review-engine/scripts/review_engine.sh health
  skills/review-engine/scripts/review_engine.sh decks
  skills/review-engine/scripts/review_engine.sh stats [--deck "Graphics Engine Interview"]
  skills/review-engine/scripts/review_engine.sh open-review --deck "Graphics Engine Interview"
  skills/review-engine/scripts/review_engine.sh review-prompt
  skills/review-engine/scripts/review_engine.sh review-current
  skills/review-engine/scripts/review_engine.sh review-log --card-id id --question "Q" --answer "A" --user-answer "..." --judgment "部分正确" --suggested-ease 2 [--issues "..."] [--weak-points "p1|p2"]
  skills/review-engine/scripts/review_engine.sh review-log-current --user-answer "..." --judgment "部分正确" --suggested-ease 2 [--issues "..."] [--weak-points "p1|p2"]
  skills/review-engine/scripts/review_engine.sh review-answer --ease 3
  skills/review-engine/scripts/review_engine.sh review-next [--ease 2]
  skills/review-engine/scripts/review_engine.sh review-history --card-id id [--limit 10]
  skills/review-engine/scripts/review_engine.sh followup-select --card-id id --user-answer "..."
  skills/review-engine/scripts/review_engine.sh interview-log --card-id id --question "Q" --user-answer "..." [--reference-answer "..."] [--judgment "..."] [--issues "..."] [--weak-points "p1|p2"] [--followup-qa-file /path/to.json] [--candidate-file /path/to.json]
  skills/review-engine/scripts/review_engine.sh candidate-list [--status pending]
  skills/review-engine/scripts/review_engine.sh candidate-approve --candidate-ids "id1,id2" [--deck "Graphics Engine Interview"]
  skills/review-engine/scripts/review_engine.sh search --query "draw call" [--limit 5]
  skills/review-engine/scripts/review_engine.sh add --deck "Graphics Engine Interview" --front "Question" --back "Answer" [--tags "a,b"]
  skills/review-engine/scripts/review_engine.sh update --card-id id [--deck "New Deck"] [--front "New"] [--back "New"] [--tags "a,b"]
  skills/review-engine/scripts/review_engine.sh delete --card-id id
  skills/review-engine/scripts/review_engine.sh add-json --file /path/to/cards.json
EOF
}

service_running() {
  curl -sS --max-time 2 "${BASE_URL}/health" >/dev/null 2>&1
}

start_service() {
  mkdir -p "${RUNTIME_DIR}"
  if service_running; then
    echo "{\"ok\":true,\"status\":\"already-running\",\"url\":\"${BASE_URL}\"}"
    return 0
  fi

  local launcher=("${REPO_ROOT}/scripts/start_review_engine.sh")
  if command -v setsid >/dev/null 2>&1; then
    setsid "${launcher[@]}" >"${LOG_FILE}" 2>&1 < /dev/null &
  else
    nohup "${launcher[@]}" >"${LOG_FILE}" 2>&1 < /dev/null &
  fi
  local pid=$!
  echo "${pid}" >"${PID_FILE}"

  for _ in $(seq 1 40); do
    if service_running; then
      echo "{\"ok\":true,\"status\":\"started\",\"pid\":${pid},\"url\":\"${BASE_URL}\",\"logFile\":\"${LOG_FILE}\"}"
      return 0
    fi
    sleep 0.25
  done

  echo "Review engine failed to start. See log: ${LOG_FILE}" >&2
  return 1
}

print_status() {
  if service_running; then
    if [[ -f "${PID_FILE}" ]]; then
      echo "{\"ok\":true,\"status\":\"running\",\"pid\":$(cat "${PID_FILE}"),\"url\":\"${BASE_URL}\",\"logFile\":\"${LOG_FILE}\"}"
    else
      echo "{\"ok\":true,\"status\":\"running\",\"url\":\"${BASE_URL}\"}"
    fi
    return 0
  fi

  if [[ -f "${PID_FILE}" ]]; then
    echo "{\"ok\":false,\"status\":\"stopped\",\"lastPid\":$(cat "${PID_FILE}"),\"url\":\"${BASE_URL}\",\"logFile\":\"${LOG_FILE}\"}"
  else
    echo "{\"ok\":false,\"status\":\"stopped\",\"url\":\"${BASE_URL}\",\"logFile\":\"${LOG_FILE}\"}"
  fi
}

json_post() {
  local path="$1"
  local body="${2-}"
  if [[ -z "$body" ]]; then
    body="{}"
  fi
  curl -sS --max-time 30 "${BASE_URL}${path}" -X POST -H 'Content-Type: application/json' -d "$body"
}

json_patch() {
  local path="$1"
  local body="${2-}"
  if [[ -z "$body" ]]; then
    body="{}"
  fi
  curl -sS --max-time 30 "${BASE_URL}${path}" -X PATCH -H 'Content-Type: application/json' -d "$body"
}

command="${1:-}"
shift || true

deck=""
query=""
limit="20"
front=""
back=""
tags=""
tags_set="0"
card_id=""
ease=""
file=""
judgment=""
question=""
answer=""
user_answer=""
issues=""
suggested_ease=""
weak_points=""
status=""
candidate_ids=""
followup_qa_file=""
candidate_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deck) deck="${2:-}"; shift 2 ;;
    --query) query="${2:-}"; shift 2 ;;
    --limit) limit="${2:-}"; shift 2 ;;
    --front) front="${2:-}"; shift 2 ;;
    --back) back="${2:-}"; shift 2 ;;
    --tags) tags="${2:-}"; tags_set="1"; shift 2 ;;
    --card-id) card_id="${2:-}"; shift 2 ;;
    --ease) ease="${2:-}"; shift 2 ;;
    --file) file="${2:-}"; shift 2 ;;
    --judgment) judgment="${2:-}"; shift 2 ;;
    --question) question="${2:-}"; shift 2 ;;
    --answer) answer="${2:-}"; shift 2 ;;
    --user-answer) user_answer="${2:-}"; shift 2 ;;
    --issues) issues="${2:-}"; shift 2 ;;
    --suggested-ease) suggested_ease="${2:-}"; shift 2 ;;
    --weak-points) weak_points="${2:-}"; shift 2 ;;
    --status) status="${2:-}"; shift 2 ;;
    --candidate-ids) candidate_ids="${2:-}"; shift 2 ;;
    --followup-qa-file) followup_qa_file="${2:-}"; shift 2 ;;
    --candidate-file) candidate_file="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

case "$command" in
  start)
    start_service
    ;;
  status)
    print_status
    ;;
  health)
    curl -sS --max-time 30 "${BASE_URL}/health"
    ;;
  decks)
    curl -sS --max-time 30 "${BASE_URL}/decks"
    ;;
  stats)
    if [[ -n "$deck" ]]; then
      curl -sS --max-time 30 "${BASE_URL}/stats?deck=$(python3 - <<'PY' "$deck"
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1]))
PY
)"
    else
      curl -sS --max-time 30 "${BASE_URL}/stats"
    fi
    ;;
  open-review)
    [[ -n "$deck" ]] || { echo "Missing --deck" >&2; exit 1; }
    json_post "/review/open" "{\"deckName\": $(python3 - <<'PY' "$deck"
import json, sys
print(json.dumps(sys.argv[1], ensure_ascii=False))
PY
)}"
    ;;
  review-prompt)
    curl -sS --max-time 30 "${BASE_URL}/review/prompt"
    ;;
  review-current)
    curl -sS --max-time 30 "${BASE_URL}/review/current"
    ;;
  review-log)
    [[ -n "$card_id" && -n "$question" && -n "$answer" && -n "$user_answer" && -n "$judgment" && -n "$suggested_ease" ]] || { echo "Missing required review-log args" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$card_id" "$deck" "$question" "$answer" "$user_answer" "$judgment" "$issues" "$suggested_ease" "$weak_points"
import json, subprocess, sys
base_url, card_id, deck, question, answer, user_answer, judgment, issues, suggested_ease, weak_points = sys.argv[1:]
payload = {
    "cardId": card_id,
    "deckName": deck,
    "question": question,
    "answer": answer,
    "userAnswer": user_answer,
    "judgment": judgment,
    "issues": issues,
    "suggestedEase": int(suggested_ease),
    "weakPoints": [item.strip() for item in weak_points.split("|") if item.strip()],
}
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/review/log", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  review-log-current)
    [[ -n "$user_answer" && -n "$judgment" && -n "$suggested_ease" ]] || { echo "Missing required review-log-current args" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$deck" "$user_answer" "$judgment" "$issues" "$suggested_ease" "$weak_points"
import json, subprocess, sys
base_url, deck_name, user_answer, judgment, issues, suggested_ease, weak_points = sys.argv[1:]
current = subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/review/current"],
    capture_output=True,
    text=True,
    check=True,
)
parsed = json.loads(current.stdout)
card = parsed.get("card")
if not parsed.get("ok") or not card:
    raise SystemExit("No active review card to log")
payload = {
    "cardId": str(card["cardId"]),
    "deckName": deck_name or card.get("deckName", ""),
    "question": card.get("question", ""),
    "answer": card.get("answer", ""),
    "userAnswer": user_answer,
    "judgment": judgment,
    "issues": issues,
    "suggestedEase": int(suggested_ease),
    "weakPoints": [item.strip() for item in weak_points.split("|") if item.strip()],
}
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/review/log", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  review-answer)
    [[ -n "$ease" ]] || { echo "Missing --ease" >&2; exit 1; }
    json_post "/review/answer" "{\"ease\": ${ease}}"
    ;;
  review-next)
    ease="${ease:-2}"
    json_post "/review/next" "{\"ease\": ${ease}}"
    ;;
  review-history)
    [[ -n "$card_id" ]] || { echo "Missing --card-id" >&2; exit 1; }
    curl -sS --max-time 30 "${BASE_URL}/review/history?cardId=$(python3 - <<'PY' "$card_id"
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1]))
PY
)&limit=${limit}"
    ;;
  followup-select)
    [[ -n "$card_id" && -n "$user_answer" ]] || { echo "Missing --card-id or --user-answer" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$card_id" "$user_answer"
import json, subprocess, sys
base_url, card_id, user_answer = sys.argv[1:]
payload = {"cardId": card_id, "userAnswer": user_answer}
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/interview/followups/select", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  interview-log)
    [[ -n "$card_id" && -n "$question" && -n "$user_answer" ]] || { echo "Missing required interview-log args" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$card_id" "$deck" "$question" "$answer" "$user_answer" "$judgment" "$issues" "$weak_points" "$followup_qa_file" "$candidate_file"
import json, subprocess, sys
from pathlib import Path
(
    base_url,
    card_id,
    deck_name,
    question,
    reference_answer,
    user_answer,
    judgment,
    issues,
    weak_points,
    followup_qa_file,
    candidate_file,
) = sys.argv[1:]
followup_qa = []
candidate_cards = []
if followup_qa_file:
    followup_qa = json.loads(Path(followup_qa_file).read_text(encoding='utf-8'))
if candidate_file:
    candidate_cards = json.loads(Path(candidate_file).read_text(encoding='utf-8'))
payload = {
    "cardId": card_id,
    "deckName": deck_name,
    "question": question,
    "referenceAnswer": reference_answer,
    "userAnswer": user_answer,
    "judgment": judgment,
    "issues": issues,
    "weakPoints": [item.strip() for item in weak_points.split("|") if item.strip()],
    "followupQA": followup_qa,
    "candidateCards": candidate_cards,
}
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/interview/session", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  candidate-list)
    if [[ -n "$status" ]]; then
      curl -sS --max-time 30 "${BASE_URL}/cards/candidates?status=$(python3 - <<'PY' "$status"
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1]))
PY
)"
    else
      curl -sS --max-time 30 "${BASE_URL}/cards/candidates"
    fi
    ;;
  candidate-approve)
    [[ -n "$candidate_ids" ]] || { echo "Missing --candidate-ids" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$candidate_ids" "$deck"
import json, subprocess, sys
base_url, candidate_ids, deck_name = sys.argv[1:]
payload = {
    "candidateIds": [item.strip() for item in candidate_ids.split(",") if item.strip()],
    "deckName": deck_name,
}
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/cards/candidates/approve", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  search)
    [[ -n "$query" ]] || { echo "Missing --query" >&2; exit 1; }
    curl -sS --max-time 30 "${BASE_URL}/cards/search?q=$(python3 - <<'PY' "$query"
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1]))
PY
)&limit=${limit}"
    ;;
  add)
    [[ -n "$deck" && -n "$front" && -n "$back" ]] || { echo "Missing required add args" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$deck" "$front" "$back" "$tags"
import json, subprocess, sys
base_url, deck, front, back, tags = sys.argv[1:]
payload = {
    "deckName": deck,
    "front": front,
    "back": back,
    "tags": [tag.strip() for tag in tags.split(",") if tag.strip()],
}
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/cards", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  update)
    [[ -n "$card_id" ]] || { echo "Missing --card-id" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$card_id" "$deck" "$front" "$back" "$tags" "$tags_set"
import json, subprocess, sys
base_url, card_id, deck, front, back, tags, tags_set = sys.argv[1:]
payload = {}
if deck:
    payload["deckName"] = deck
if front:
    payload["front"] = front
if back:
    payload["back"] = back
if tags_set == "1":
    payload["tags"] = [tag.strip() for tag in tags.split(",") if tag.strip()]
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/cards/{card_id}", "-X", "PATCH", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  delete)
    [[ -n "$card_id" ]] || { echo "Missing --card-id" >&2; exit 1; }
    curl -sS --max-time 30 "${BASE_URL}/cards/${card_id}" -X DELETE
    ;;
  add-json)
    [[ -n "$file" ]] || { echo "Missing --file" >&2; exit 1; }
    python3 - <<'PY' "$BASE_URL" "$file"
import json, subprocess, sys
base_url, file_path = sys.argv[1:]
with open(file_path, "r", encoding="utf-8") as fh:
    parsed = json.load(fh)
notes = parsed if isinstance(parsed, list) else parsed["notes"]
payload = {"notes": notes}
subprocess.run(
    ["curl", "-sS", "--max-time", "30", f"{base_url}/cards/batch", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=False)],
    check=True,
)
PY
    ;;
  *)
    usage
    exit 1
    ;;
esac
