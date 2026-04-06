import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import get_engine_cache_dir, get_engine_runs_dir
from .scheduler import ReviewState, initial_due_at


def cards_file_path() -> Path:
    path = get_engine_cache_dir()
    path.mkdir(parents=True, exist_ok=True)
    return path / "cards.json"


def state_file_path() -> Path:
    path = get_engine_runs_dir()
    path.mkdir(parents=True, exist_ok=True)
    return path / "state.json"


def candidate_cards_file_path() -> Path:
    path = get_engine_cache_dir()
    path.mkdir(parents=True, exist_ok=True)
    return path / "candidate_cards.json"


def interview_sessions_file_path() -> Path:
    path = get_engine_runs_dir()
    path.mkdir(parents=True, exist_ok=True)
    return path / "interview-sessions.jsonl"


def load_cards_payload() -> Dict[str, Any]:
    path = cards_file_path()
    if not path.exists():
        return {"cards": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save_cards_payload(payload: Dict[str, Any]) -> None:
    cards_file_path().write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_state_payload() -> Dict[str, Any]:
    path = state_file_path()
    if not path.exists():
        return {"states": {}, "session": {"activeDeck": "", "currentCardId": ""}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state_payload(payload: Dict[str, Any]) -> None:
    state_file_path().write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_candidate_cards_payload() -> Dict[str, Any]:
    path = candidate_cards_file_path()
    if not path.exists():
        return {"candidates": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save_candidate_cards_payload(payload: Dict[str, Any]) -> None:
    candidate_cards_file_path().write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def append_interview_session(entry: Dict[str, Any]) -> Dict[str, Any]:
    enriched = {"id": str(uuid.uuid4()), **entry}
    path = interview_sessions_file_path()
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(enriched, ensure_ascii=False) + "\n")
    return enriched


def read_interview_sessions(limit: int = 20) -> List[Dict[str, Any]]:
    path = interview_sessions_file_path()
    if not path.exists():
        return []
    items: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return items[-limit:]


def list_cards() -> List[Dict[str, Any]]:
    return list(load_cards_payload().get("cards", []))


def list_decks() -> List[str]:
    return sorted({str(card.get("deckName", "")).strip() for card in list_cards() if str(card.get("deckName", "")).strip()})


def get_card(card_id: str) -> Optional[Dict[str, Any]]:
    for card in list_cards():
        if str(card.get("id")) == card_id:
            return card
    return None


def get_card_state(card_id: str) -> ReviewState:
    payload = load_state_payload()
    raw = payload.get("states", {}).get(card_id)
    state = ReviewState.from_dict(raw)
    if state.due_at is None:
        state.due_at = initial_due_at()
    return state


def set_card_state(card_id: str, state: ReviewState) -> None:
    payload = load_state_payload()
    payload.setdefault("states", {})[card_id] = state.to_dict()
    save_state_payload(payload)


def get_session() -> Dict[str, str]:
    payload = load_state_payload()
    session = payload.get("session") or {}
    return {
        "activeDeck": str(session.get("activeDeck", "")),
        "currentCardId": str(session.get("currentCardId", "")),
    }


def set_session(active_deck: str, current_card_id: str) -> None:
    payload = load_state_payload()
    payload["session"] = {"activeDeck": active_deck, "currentCardId": current_card_id}
    save_state_payload(payload)


def clear_session_current_card() -> None:
    session = get_session()
    set_session(session["activeDeck"], "")


def import_notes(notes: List[Dict[str, Any]]) -> List[str]:
    payload = load_cards_payload()
    cards = payload.setdefault("cards", [])
    created_ids: List[str] = []
    for note in notes:
        card_id = str(uuid.uuid4())
        card = {
            "id": card_id,
            "deckName": str(note.get("deckName") or note.get("deck") or "").strip(),
            "front": str(note.get("fields", {}).get("Front", "")),
            "back": str(note.get("fields", {}).get("Back", "")),
            "tags": [str(tag).strip() for tag in note.get("tags", []) if str(tag).strip()],
            "followups": note.get("followups", []),
        }
        cards.append(card)
        created_ids.append(card_id)
    save_cards_payload(payload)
    state_payload = load_state_payload()
    states = state_payload.setdefault("states", {})
    for card_id in created_ids:
        state = ReviewState()
        state.due_at = initial_due_at()
        states[card_id] = state.to_dict()
    save_state_payload(state_payload)
    return created_ids


def update_card(
    card_id: str,
    front: Optional[str] = None,
    back: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    payload = load_cards_payload()
    cards = payload.get("cards", [])
    updated = None
    for card in cards:
        if str(card.get("id")) != card_id:
            continue
        if front is not None:
            card["front"] = front
        if back is not None:
            card["back"] = back
        if tags is not None:
            card["tags"] = tags
        updated = card
        break
    if updated is not None:
        save_cards_payload(payload)
    return updated


def search_cards(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    needle = query.strip().lower()
    if not needle:
        return []
    results: List[Dict[str, Any]] = []
    for card in list_cards():
        haystacks = [
            str(card.get("deckName", "")).lower(),
            str(card.get("front", "")).lower(),
            str(card.get("back", "")).lower(),
            " ".join(str(tag).lower() for tag in card.get("tags", [])),
        ]
        if needle.startswith("deck:"):
            if str(card.get("deckName", "")).lower() == needle.split(":", 1)[1]:
                results.append(card)
        elif needle.startswith("tag:"):
            tag = needle.split(":", 1)[1]
            if tag in [str(item).lower() for item in card.get("tags", [])]:
                results.append(card)
        elif any(needle in haystack for haystack in haystacks):
            results.append(card)
        if len(results) >= limit:
            break
    return results


def list_candidate_cards(status: str = "") -> List[Dict[str, Any]]:
    candidates = load_candidate_cards_payload().get("candidates", [])
    if status:
        return [item for item in candidates if str(item.get("status", "")).strip() == status]
    return list(candidates)


def add_candidate_cards(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    payload = load_candidate_cards_payload()
    candidates = payload.setdefault("candidates", [])
    created: List[Dict[str, Any]] = []
    for item in items:
        candidate = {
            "id": str(uuid.uuid4()),
            "status": "pending",
            "deckName": str(item.get("deckName") or item.get("deck") or "").strip(),
            "front": str(item.get("front", "")),
            "back": str(item.get("back", "")),
            "tags": [str(tag).strip() for tag in item.get("tags", []) if str(tag).strip()],
            "sourceCardId": str(item.get("sourceCardId", "")).strip(),
            "sourceType": str(item.get("sourceType", "ai-generated")).strip(),
            "reason": str(item.get("reason", "")).strip(),
        }
        candidates.append(candidate)
        created.append(candidate)
    save_candidate_cards_payload(payload)
    return created


def approve_candidate_cards(candidate_ids: List[str], default_deck_name: str = "") -> Dict[str, Any]:
    payload = load_candidate_cards_payload()
    candidates = payload.get("candidates", [])
    approved_notes: List[Dict[str, Any]] = []
    approved_ids: List[str] = []
    for candidate in candidates:
        if str(candidate.get("id")) not in candidate_ids:
            continue
        if str(candidate.get("status")) == "approved":
            continue
        candidate["status"] = "approved"
        note = {
            "deckName": str(candidate.get("deckName") or default_deck_name).strip(),
            "fields": {
                "Front": str(candidate.get("front", "")),
                "Back": str(candidate.get("back", "")),
            },
            "tags": [str(tag).strip() for tag in candidate.get("tags", []) if str(tag).strip()],
        }
        approved_notes.append(note)
        approved_ids.append(str(candidate.get("id")))
    save_candidate_cards_payload(payload)
    created_card_ids = import_notes(approved_notes) if approved_notes else []
    return {"approvedCandidateIds": approved_ids, "createdCardIds": created_card_ids}
