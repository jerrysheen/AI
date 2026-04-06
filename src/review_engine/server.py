import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from .config import get_bind_host, get_bind_port
from .history import (
    append_history_event,
    count_review_answers_today,
    read_history_events,
    set_confirmed_ease,
    summarize_weak_points,
)
from .scheduler import ReviewState, apply_review, classify_queue, is_due
from .store import (
    add_candidate_cards,
    append_interview_session,
    approve_candidate_cards,
    clear_session_current_card,
    get_card,
    get_card_state,
    get_session,
    import_notes,
    list_candidate_cards,
    list_cards,
    list_decks,
    read_interview_sessions,
    search_cards,
    set_card_state,
    set_session,
    update_card,
)


def normalize_text(value: str) -> str:
    return "".join(str(value).lower().split())


def select_followups_for_answer(card: Dict[str, Any], user_answer: str) -> Dict[str, Any]:
    normalized_answer = normalize_text(user_answer)
    selected: List[Dict[str, Any]] = []
    covered: List[Dict[str, Any]] = []

    for item in card.get("followups", []):
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "")).strip()
        if not question:
            continue

        concept = str(item.get("concept", "")).strip()
        when_missing_any = [
            normalize_text(keyword)
            for keyword in item.get("whenMissingAny", [])
            if str(keyword).strip()
        ]
        covered_signals = [
            normalize_text(keyword)
            for keyword in item.get("coveredSignals", [])
            if str(keyword).strip()
        ]

        matched_covered = [keyword for keyword in covered_signals if keyword and keyword in normalized_answer]
        matched_missing = [keyword for keyword in when_missing_any if keyword and keyword in normalized_answer]

        entry = {
            "question": question,
            "tags": item.get("tags", []),
            "concept": concept,
            "coveredSignalsMatched": matched_covered,
            "missingSignalsMatched": matched_missing,
        }

        if covered_signals and matched_covered:
            covered.append(entry)
            continue
        if when_missing_any:
            if matched_missing:
                covered.append(entry)
            else:
                selected.append(entry)
            continue

        selected.append(entry)

    return {
        "selected": selected,
        "covered": covered,
    }


def compact_card(card: Dict[str, Any]) -> Dict[str, Any]:
    state = get_card_state(str(card["id"]))
    return {
        "cardId": str(card["id"]),
        "deckName": card["deckName"],
        "question": card["front"],
        "answer": card["back"],
        "tags": card.get("tags", []),
        "followups": card.get("followups", []),
        "queue": classify_queue(state),
        "dueAt": state.due_at,
        "weakPointSummary": summarize_weak_points(str(card["id"]), limit=8),
        "history": read_history_events(str(card["id"]), limit=5),
    }


def prompt_card(card: Dict[str, Any]) -> Dict[str, Any]:
    state = get_card_state(str(card["id"]))
    return {
        "cardId": str(card["id"]),
        "deckName": card["deckName"],
        "question": card["front"],
        "tags": card.get("tags", []),
        "followups": [
            {"question": str(item.get("question", "")).strip(), "tags": item.get("tags", [])}
            for item in card.get("followups", [])
            if isinstance(item, dict) and str(item.get("question", "")).strip()
        ],
        "queue": classify_queue(state),
        "dueAt": state.due_at,
        "weakPointSummary": summarize_weak_points(str(card["id"]), limit=8),
        "history": read_history_events(str(card["id"]), limit=5),
    }


def select_next_card(deck_name: str) -> Optional[Dict[str, Any]]:
    cards = [card for card in list_cards() if card.get("deckName") == deck_name]
    due_cards: List[tuple[int, str, Dict[str, Any]]] = []
    for card in cards:
        state = get_card_state(str(card["id"]))
        if not is_due(state):
            continue
        queue_priority = {"learn": 0, "review": 1, "new": 2}.get(classify_queue(state), 3)
        due_cards.append((queue_priority, state.due_at or "", card))
    if not due_cards:
        return None
    due_cards.sort(key=lambda item: (item[0], item[1], item[2]["id"]))
    return due_cards[0][2]


def deck_stats(deck_name: str = "") -> Dict[str, Any]:
    cards = list_cards()
    if deck_name:
        cards = [card for card in cards if card.get("deckName") == deck_name]
    totals = {"new": 0, "learn": 0, "review": 0, "total": len(cards)}
    per_deck: Dict[str, Dict[str, Any]] = {}
    for card in cards:
        state = get_card_state(str(card["id"]))
        deck = str(card.get("deckName", ""))
        queue = classify_queue(state)
        if is_due(state):
            totals[queue] += 1
        bucket = per_deck.setdefault(
            deck,
            {"deckName": deck, "newCount": 0, "learnCount": 0, "reviewCount": 0, "totalInDeck": 0},
        )
        bucket["totalInDeck"] += 1
        if is_due(state):
            if queue == "new":
                bucket["newCount"] += 1
            elif queue == "learn":
                bucket["learnCount"] += 1
            else:
                bucket["reviewCount"] += 1

    decks = sorted(per_deck.values(), key=lambda item: item["deckName"])
    return {
        "ok": True,
        "deckCount": len(decks),
        "reviewedToday": count_review_answers_today(deck_name),
        "totals": totals,
        "decks": decks,
    }


class ReviewEngineHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.write_json(HTTPStatus.OK, {"ok": True, "service": "review-engine"})
            return
        if parsed.path == "/decks":
            self.write_json(HTTPStatus.OK, {"ok": True, "decks": list_decks()})
            return
        if parsed.path == "/stats":
            params = parse_qs(parsed.query)
            deck_name = (params.get("deck", [""]) or [""])[0].strip()
            self.write_json(HTTPStatus.OK, deck_stats(deck_name))
            return
        if parsed.path == "/review/prompt":
            self.handle_review_prompt()
            return
        if parsed.path == "/review/current":
            self.handle_review_current()
            return
        if parsed.path == "/review/history":
            self.handle_review_history(parsed.query)
            return
        if parsed.path == "/interview/sessions":
            self.handle_interview_sessions(parsed.query)
            return
        if parsed.path == "/cards/candidates":
            self.handle_candidate_cards(parsed.query)
            return
        if parsed.path == "/cards/search":
            self.handle_search(parsed.query)
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        body = self.read_json_body()
        if body is None:
            return
        if parsed.path == "/review/open":
            self.handle_open_review(body)
            return
        if parsed.path == "/review/log":
            self.handle_review_log(body)
            return
        if parsed.path == "/review/answer":
            self.handle_review_answer(body)
            return
        if parsed.path == "/review/next":
            self.handle_review_next(body)
            return
        if parsed.path == "/interview/followups/select":
            self.handle_select_followups(body)
            return
        if parsed.path == "/interview/session":
            self.handle_interview_session(body)
            return
        if parsed.path == "/cards/candidates":
            self.handle_create_candidate_cards(body)
            return
        if parsed.path == "/cards/candidates/approve":
            self.handle_approve_candidate_cards(body)
            return
        if parsed.path == "/cards":
            self.handle_add_card(body)
            return
        if parsed.path == "/cards/batch":
            self.handle_add_cards_batch(body)
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def do_PATCH(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        body = self.read_json_body()
        if body is None:
            return
        if parsed.path.startswith("/cards/"):
            self.handle_update_card(parsed.path, body)
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def log_message(self, format: str, *args: Any) -> None:
        return

    def handle_open_review(self, body: Dict[str, Any]) -> None:
        deck_name = str(body.get("deckName") or body.get("deck") or "").strip()
        if not deck_name:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "deckName is required"})
            return
        next_card = select_next_card(deck_name)
        set_session(deck_name, str(next_card["id"]) if next_card else "")
        self.write_json(
            HTTPStatus.OK,
            {"ok": True, "deckName": deck_name, "card": compact_card(next_card) if next_card else None},
        )

    def handle_review_prompt(self) -> None:
        session = get_session()
        active_deck = session["activeDeck"]
        current_card_id = session["currentCardId"]
        card = get_card(current_card_id) if current_card_id else None
        if card is None and active_deck:
            card = select_next_card(active_deck)
            if card is not None:
                set_session(active_deck, str(card["id"]))
        self.write_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "reviewActive": card is not None,
                "activeDeck": active_deck,
                "card": prompt_card(card) if card else None,
            },
        )

    def handle_review_current(self) -> None:
        session = get_session()
        active_deck = session["activeDeck"]
        current_card_id = session["currentCardId"]
        card = get_card(current_card_id) if current_card_id else None
        if card is None and active_deck:
            card = select_next_card(active_deck)
            if card is not None:
                set_session(active_deck, str(card["id"]))
        self.write_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "reviewActive": card is not None,
                "activeDeck": active_deck,
                "card": compact_card(card) if card else None,
            },
        )

    def handle_review_log(self, body: Dict[str, Any]) -> None:
        required = ["cardId", "question", "answer", "userAnswer", "judgment", "suggestedEase"]
        missing = [name for name in required if name not in body]
        if missing:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"Missing required fields: {', '.join(missing)}"})
            return
        event = append_history_event(
            {
                "eventType": "review_evaluation",
                "cardId": str(body["cardId"]),
                "deckName": str(body.get("deckName", "")),
                "question": str(body["question"]),
                "answer": str(body["answer"]),
                "userAnswer": str(body["userAnswer"]),
                "judgment": str(body["judgment"]),
                "issues": str(body.get("issues", "")),
                "weakPoints": [str(item).strip() for item in body.get("weakPoints", []) if str(item).strip()],
                "suggestedEase": int(body["suggestedEase"]),
                "confirmedEase": body.get("confirmedEase"),
            }
        )
        self.write_json(HTTPStatus.CREATED, {"ok": True, "event": event, "weakPointSummary": summarize_weak_points(str(body["cardId"]))})

    def handle_review_answer(self, body: Dict[str, Any]) -> None:
        self._handle_review_transition(body, advance_only=False)

    def handle_review_next(self, body: Dict[str, Any]) -> None:
        self._handle_review_transition(body, advance_only=True)

    def _handle_review_transition(self, body: Dict[str, Any], advance_only: bool) -> None:
        ease = int(body.get("ease", 2))
        session = get_session()
        active_deck = session["activeDeck"]
        current_card_id = session["currentCardId"]
        if not active_deck or not current_card_id:
            self.write_json(HTTPStatus.OK, {"ok": True, "answered": False, "nextCard": None, "reviewActive": False})
            return

        card = get_card(current_card_id)
        if card is None:
            clear_session_current_card()
            self.write_json(HTTPStatus.OK, {"ok": True, "answered": False, "nextCard": None, "reviewActive": False})
            return

        state = get_card_state(current_card_id)
        next_state = apply_review(state, ease)
        set_card_state(current_card_id, next_state)
        set_confirmed_ease(current_card_id, ease)
        history_event = append_history_event(
            {
                "eventType": "review_answer",
                "cardId": current_card_id,
                "deckName": card["deckName"],
                "question": card["front"],
                "answer": card["back"],
                "ease": ease,
            }
        )

        next_card = select_next_card(active_deck)
        set_session(active_deck, str(next_card["id"]) if next_card else "")
        payload = {
            "ok": True,
            "answered": True,
            "ease": ease,
            "answeredCardId": current_card_id,
            "reviewActive": next_card is not None,
            "nextCard": compact_card(next_card) if next_card else None,
            "historyEvent": history_event,
        }
        if advance_only:
            payload["advanced"] = next_card is None or str(next_card["id"]) != current_card_id
        self.write_json(HTTPStatus.OK, payload)

    def handle_review_history(self, query_string: str) -> None:
        params = parse_qs(query_string)
        card_id = (params.get("cardId", [""]) or [""])[0].strip()
        limit_raw = (params.get("limit", ["10"]) or ["10"])[0].strip()
        try:
            limit = max(1, min(int(limit_raw), 50))
        except ValueError:
            limit = 10
        self.write_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "cardId": card_id,
                "events": read_history_events(card_id, limit=limit),
                "weakPointSummary": summarize_weak_points(card_id),
            },
        )

    def handle_interview_sessions(self, query_string: str) -> None:
        params = parse_qs(query_string)
        limit_raw = (params.get("limit", ["20"]) or ["20"])[0].strip()
        try:
            limit = max(1, min(int(limit_raw), 100))
        except ValueError:
            limit = 20
        items = read_interview_sessions(limit=limit)
        self.write_json(HTTPStatus.OK, {"ok": True, "count": len(items), "sessions": items})

    def handle_select_followups(self, body: Dict[str, Any]) -> None:
        card_id = str(body.get("cardId", "")).strip()
        user_answer = str(body.get("userAnswer", "")).strip()
        if not card_id or not user_answer:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "cardId and userAnswer are required"},
            )
            return

        card = get_card(card_id)
        if card is None:
            self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Card not found"})
            return

        result = select_followups_for_answer(card, user_answer)
        self.write_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "cardId": card_id,
                "selected": result["selected"],
                "covered": result["covered"],
            },
        )

    def handle_candidate_cards(self, query_string: str) -> None:
        params = parse_qs(query_string)
        status = (params.get("status", [""]) or [""])[0].strip()
        items = list_candidate_cards(status=status)
        self.write_json(HTTPStatus.OK, {"ok": True, "count": len(items), "candidates": items})

    def handle_search(self, query_string: str) -> None:
        params = parse_qs(query_string)
        query = (params.get("q", [""]) or [""])[0].strip()
        limit_raw = (params.get("limit", ["20"]) or ["20"])[0].strip()
        try:
            limit = max(1, min(int(limit_raw), 100))
        except ValueError:
            limit = 20
        cards = search_cards(query, limit=limit)
        self.write_json(HTTPStatus.OK, {"ok": True, "query": query, "count": len(cards), "cards": [compact_card(card) for card in cards]})

    def handle_interview_session(self, body: Dict[str, Any]) -> None:
        required = ["cardId", "question", "userAnswer"]
        missing = [name for name in required if name not in body]
        if missing:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": f"Missing required fields: {', '.join(missing)}"},
            )
            return

        followup_qa = body.get("followupQA") or []
        candidate_cards = body.get("candidateCards") or []
        if not isinstance(followup_qa, list) or not isinstance(candidate_cards, list):
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "followupQA and candidateCards must be arrays"},
            )
            return

        session_entry = append_interview_session(
            {
                "timestamp": body.get("timestamp"),
                "cardId": str(body["cardId"]),
                "deckName": str(body.get("deckName", "")),
                "question": str(body["question"]),
                "referenceAnswer": str(body.get("referenceAnswer", "")),
                "userAnswer": str(body["userAnswer"]),
                "judgment": str(body.get("judgment", "")),
                "issues": str(body.get("issues", "")),
                "weakPoints": [str(item).strip() for item in body.get("weakPoints", []) if str(item).strip()],
                "followupQA": followup_qa,
                "candidateCards": candidate_cards,
            }
        )
        created_candidates = add_candidate_cards(candidate_cards) if candidate_cards else []
        self.write_json(
            HTTPStatus.CREATED,
            {
                "ok": True,
                "session": session_entry,
                "createdCandidates": created_candidates,
            },
        )

    def handle_create_candidate_cards(self, body: Dict[str, Any]) -> None:
        items = body.get("candidates")
        if not isinstance(items, list) or not items:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "candidates must be a non-empty array"},
            )
            return
        created = add_candidate_cards(items)
        self.write_json(HTTPStatus.CREATED, {"ok": True, "created": len(created), "candidates": created})

    def handle_approve_candidate_cards(self, body: Dict[str, Any]) -> None:
        candidate_ids = body.get("candidateIds") or []
        deck_name = str(body.get("deckName", "")).strip()
        if not isinstance(candidate_ids, list) or not candidate_ids:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "candidateIds must be a non-empty array"},
            )
            return
        result = approve_candidate_cards([str(item) for item in candidate_ids], default_deck_name=deck_name)
        self.write_json(HTTPStatus.OK, {"ok": True, **result})

    def handle_add_card(self, body: Dict[str, Any]) -> None:
        note = {
            "deckName": str(body.get("deckName") or body.get("deck") or "").strip(),
            "fields": {
                "Front": str(body.get("fields", {}).get("Front") or body.get("front") or ""),
                "Back": str(body.get("fields", {}).get("Back") or body.get("back") or ""),
            },
            "tags": [str(tag).strip() for tag in body.get("tags", []) if str(tag).strip()],
        }
        created_ids = import_notes([note])
        self.write_json(HTTPStatus.CREATED, {"ok": True, "cardId": created_ids[0]})

    def handle_add_cards_batch(self, body: Dict[str, Any]) -> None:
        notes = body.get("notes")
        if not isinstance(notes, list) or not notes:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "notes must be a non-empty array"})
            return
        created_ids = import_notes(notes)
        self.write_json(HTTPStatus.CREATED, {"ok": True, "created": len(created_ids), "cardIds": created_ids})

    def handle_update_card(self, path: str, body: Dict[str, Any]) -> None:
        card_id = path.rsplit("/", 1)[-1].strip()
        updated = update_card(
            card_id,
            front=body.get("front"),
            back=body.get("back"),
            tags=body.get("tags"),
        )
        if updated is None:
            self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Card not found"})
            return
        self.write_json(HTTPStatus.OK, {"ok": True, "card": compact_card(updated)})

    def read_json_body(self) -> Optional[Dict[str, Any]]:
        length = self.headers.get("Content-Length")
        if not length:
            return {}
        try:
            raw = self.rfile.read(int(length))
        except ValueError:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid Content-Length"})
            return None
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Body must be valid JSON"})
            return None

    def write_json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_server() -> None:
    bind_address = (get_bind_host(), get_bind_port())
    server = ThreadingHTTPServer(bind_address, ReviewEngineHandler)
    print(
        json.dumps(
            {
                "ok": True,
                "service": "review-engine",
                "listening_on": f"http://{bind_address[0]}:{bind_address[1]}",
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    run_server()
