import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from .config import get_db_dir, get_db_path


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_parent_dirs() -> None:
    get_db_dir().mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    ensure_parent_dirs()
    connection = sqlite3.connect(get_db_path())
    connection.row_factory = sqlite3.Row
    return connection


def initialize_store() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_url TEXT NOT NULL DEFAULT '',
                raw_content TEXT NOT NULL,
                ai_summary TEXT NOT NULL DEFAULT '',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                topic TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                confidence REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS annotations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                knowledge_card_id INTEGER,
                note TEXT NOT NULL,
                signal_type TEXT NOT NULL DEFAULT 'note',
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
                FOREIGN KEY(knowledge_card_id) REFERENCES knowledge_cards(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);
            CREATE INDEX IF NOT EXISTS idx_cards_document_id ON knowledge_cards(document_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_document_id ON annotations(document_id);
            """
        )


def _normalize_text(value: Any, fallback: str = "") -> str:
    text = str(value or fallback).strip()
    return text or fallback


def _normalize_tags(items: Iterable[Any]) -> List[str]:
    seen: set[str] = set()
    normalized: List[str] = []
    for item in items:
        tag = str(item or "").strip()
        if not tag:
            continue
        lowered = tag.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(tag)
    return normalized


def _document_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "title": row["title"],
        "sourceType": row["source_type"],
        "sourceUrl": row["source_url"],
        "rawContent": row["raw_content"],
        "aiSummary": row["ai_summary"],
        "metadata": json.loads(row["metadata_json"] or "{}"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _card_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "documentId": int(row["document_id"]),
        "title": row["title"],
        "summary": row["summary"],
        "topic": row["topic"],
        "tags": json.loads(row["tags_json"] or "[]"),
        "confidence": float(row["confidence"] or 0),
        "createdAt": row["created_at"],
    }


def _annotation_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    card_id = row["knowledge_card_id"]
    return {
        "id": int(row["id"]),
        "documentId": int(row["document_id"]),
        "knowledgeCardId": int(card_id) if card_id is not None else None,
        "note": row["note"],
        "signalType": row["signal_type"],
        "createdAt": row["created_at"],
    }


def create_document(
    *,
    title: str,
    source_type: str,
    raw_content: str,
    source_url: str = "",
    ai_summary: str = "",
    metadata: Optional[Dict[str, Any]] = None,
    knowledge_cards: Optional[List[Dict[str, Any]]] = None,
    annotations: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    initialize_store()
    timestamp = utc_now()
    title_value = _normalize_text(title, fallback="Untitled document")
    source_type_value = _normalize_text(source_type, fallback="note")
    raw_content_value = _normalize_text(raw_content)
    if not raw_content_value:
        raise ValueError("raw_content is required")

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO documents (title, source_type, source_url, raw_content, ai_summary, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title_value,
                source_type_value,
                _normalize_text(source_url),
                raw_content_value,
                _normalize_text(ai_summary),
                json.dumps(metadata or {}, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )
        document_id = int(cursor.lastrowid)

        created_cards: List[Dict[str, Any]] = []
        for card in knowledge_cards or []:
            card_title = _normalize_text(card.get("title"), fallback="Untitled knowledge card")
            tags = _normalize_tags(card.get("tags", []))
            card_cursor = connection.execute(
                """
                INSERT INTO knowledge_cards (document_id, title, summary, topic, tags_json, confidence, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    card_title,
                    _normalize_text(card.get("summary")),
                    _normalize_text(card.get("topic")),
                    json.dumps(tags, ensure_ascii=False),
                    float(card.get("confidence", 0) or 0),
                    timestamp,
                ),
            )
            created_cards.append(
                {
                    "id": int(card_cursor.lastrowid),
                    "documentId": document_id,
                    "title": card_title,
                    "summary": _normalize_text(card.get("summary")),
                    "topic": _normalize_text(card.get("topic")),
                    "tags": tags,
                    "confidence": float(card.get("confidence", 0) or 0),
                    "createdAt": timestamp,
                }
            )

        created_annotations: List[Dict[str, Any]] = []
        for annotation in annotations or []:
            note = _normalize_text(annotation.get("note"))
            if not note:
                continue
            connection.execute(
                """
                INSERT INTO annotations (document_id, knowledge_card_id, note, signal_type, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    annotation.get("knowledgeCardId"),
                    note,
                    _normalize_text(annotation.get("signalType"), fallback="note"),
                    timestamp,
                ),
            )
            created_annotations.append(
                {
                    "documentId": document_id,
                    "knowledgeCardId": annotation.get("knowledgeCardId"),
                    "note": note,
                    "signalType": _normalize_text(annotation.get("signalType"), fallback="note"),
                    "createdAt": timestamp,
                }
            )

    document = get_document(document_id)
    document["knowledgeCards"] = created_cards
    document["annotations"] = created_annotations
    return document


def list_documents(limit: int = 50) -> List[Dict[str, Any]]:
    initialize_store()
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM documents ORDER BY id DESC LIMIT ?",
            (max(1, min(int(limit or 50), 200)),),
        ).fetchall()
    return [_document_from_row(row) for row in rows]


def get_document(document_id: int) -> Optional[Dict[str, Any]]:
    initialize_store()
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM documents WHERE id = ?", (int(document_id),)).fetchone()
    if row is None:
        return None
    document = _document_from_row(row)
    document["knowledgeCards"] = list_knowledge_cards_for_document(int(document_id))
    document["annotations"] = list_annotations_for_document(int(document_id))
    return document


def get_documents_by_ids(document_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    initialize_store()
    normalized_ids = sorted({int(document_id) for document_id in document_ids if int(document_id) > 0})
    if not normalized_ids:
        return {}
    placeholders = ", ".join("?" for _ in normalized_ids)
    with get_connection() as connection:
        rows = connection.execute(
            f"SELECT * FROM documents WHERE id IN ({placeholders})",
            tuple(normalized_ids),
        ).fetchall()
    return {int(row["id"]): _document_from_row(row) for row in rows}


def list_knowledge_cards_for_document(document_id: int) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM knowledge_cards WHERE document_id = ? ORDER BY id ASC",
            (int(document_id),),
        ).fetchall()
    return [_card_from_row(row) for row in rows]


def list_annotations_for_document(document_id: int) -> List[Dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM annotations WHERE document_id = ? ORDER BY id ASC",
            (int(document_id),),
        ).fetchall()
    return [_annotation_from_row(row) for row in rows]


def fetch_document_bundles() -> List[Dict[str, Any]]:
    bundles: List[Dict[str, Any]] = []
    for document in list_documents(limit=5000):
        bundles.append(get_document(int(document["id"])))
    return [bundle for bundle in bundles if bundle is not None]


def keyword_search(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    initialize_store()
    needle = f"%{str(query or '').strip()}%"
    if needle == "%%":
        return []
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT d.*
            FROM documents d
            LEFT JOIN knowledge_cards kc ON kc.document_id = d.id
            LEFT JOIN annotations a ON a.document_id = d.id
            WHERE d.title LIKE ?
               OR d.raw_content LIKE ?
               OR d.ai_summary LIKE ?
               OR kc.title LIKE ?
               OR kc.summary LIKE ?
               OR kc.topic LIKE ?
               OR kc.tags_json LIKE ?
               OR a.note LIKE ?
               OR a.signal_type LIKE ?
            ORDER BY d.id DESC
            LIMIT ?
            """,
            (needle, needle, needle, needle, needle, needle, needle, needle, needle, max(1, min(int(limit or 10), 50))),
        ).fetchall()
    return [_document_from_row(row) for row in rows]
