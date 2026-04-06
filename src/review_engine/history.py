import json
import time
import uuid
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

from .config import get_engine_runs_dir


def history_file_path() -> Path:
    runs_dir = get_engine_runs_dir()
    runs_dir.mkdir(parents=True, exist_ok=True)
    return runs_dir / "review-history.jsonl"


def read_all_history_events() -> List[Dict[str, Any]]:
    path = history_file_path()
    if not path.exists():
        return []

    events: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def append_history_event(event: Dict[str, Any]) -> Dict[str, Any]:
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": int(time.time()),
        **event,
    }
    path = history_file_path()
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def read_history_events(card_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    items = [item for item in read_all_history_events() if item.get("cardId") == card_id]
    return items[-limit:]


def summarize_weak_points(card_id: str, limit: int = 8) -> List[Dict[str, Any]]:
    counter: Counter[str] = Counter()
    for item in read_history_events(card_id, limit=200):
        if item.get("eventType") != "review_evaluation":
            continue
        weak_points = item.get("weakPoints") or []
        if isinstance(weak_points, list) and weak_points:
            for weak_point in weak_points:
                text = str(weak_point).strip()
                if text:
                    counter[text] += 1
        else:
            issues = str(item.get("issues", "")).strip()
            if issues:
                counter[issues] += 1
    return [{"text": text, "count": count} for text, count in counter.most_common(limit)]


def set_confirmed_ease(card_id: str, confirmed_ease: int) -> bool:
    path = history_file_path()
    if not path.exists():
        return False

    lines = path.read_text(encoding="utf-8").splitlines()
    updated = False
    for index in range(len(lines) - 1, -1, -1):
        line = lines[index].strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if item.get("cardId") != card_id or item.get("eventType") != "review_evaluation":
            continue
        item["confirmedEase"] = confirmed_ease
        lines[index] = json.dumps(item, ensure_ascii=False)
        updated = True
        break

    if updated:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return updated


def count_review_answers_today(deck_name: str = "") -> int:
    today = time.strftime("%Y-%m-%d", time.localtime())
    total = 0
    for item in read_all_history_events():
        if item.get("eventType") != "review_answer":
            continue
        timestamp = item.get("timestamp")
        if not isinstance(timestamp, int):
            continue
        if time.strftime("%Y-%m-%d", time.localtime(timestamp)) != today:
            continue
        if deck_name and str(item.get("deckName", "")).strip() != deck_name:
            continue
        total += 1
    return total
