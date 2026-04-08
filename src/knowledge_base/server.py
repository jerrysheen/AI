import json
import os
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

from .config import get_bind_host, get_bind_port, get_index_dir, get_openai_llm_model, get_openai_base_url, get_service_root_dir, should_auto_extract
from .llama_runtime import (
    ask_index,
    dependencies_available,
    describe_embedding_runtime,
    extract_knowledge,
    group_search_results,
    llm_runtime_ready,
    rebuild_index,
    runtime_ready,
    semantic_search,
)
from .store import create_document, fetch_document_bundles, get_document, get_documents_by_ids, initialize_store, keyword_search, list_documents

STATIC_DIR = Path(__file__).resolve().parent / "static"


def boot_progress(percent: int, label: str) -> None:
    if os.environ.get("AI_KNOWLEDGE_BASE_BOOT_PROGRESS", "").strip() != "1":
        return
    width = 28
    filled = min(width, int(percent * width / 100))
    bar = ("#" * filled).ljust(width, ".")
    print(f"[{percent:>3}%] [{bar}] {label}", flush=True)


def parse_iso_datetime(raw_value: str) -> Optional[datetime]:
    value = str(raw_value or "").strip()
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def filter_grouped_results_by_time(
    grouped_results: list[Dict[str, Any]],
    *,
    days: int = 0,
    created_after_raw: str = "",
) -> list[Dict[str, Any]]:
    if not grouped_results:
        return grouped_results

    created_after = parse_iso_datetime(created_after_raw)
    if days > 0:
        cutoff_from_days = datetime.now(timezone.utc) - timedelta(days=days)
        created_after = max(filter(None, [created_after, cutoff_from_days]), default=cutoff_from_days)

    if created_after is None:
        return grouped_results

    documents = get_documents_by_ids([int(item.get("documentId", 0) or 0) for item in grouped_results])
    filtered: list[Dict[str, Any]] = []
    for item in grouped_results:
        document_id = int(item.get("documentId", 0) or 0)
        document = documents.get(document_id)
        if document is None:
            continue
        created_at = parse_iso_datetime(document.get("createdAt", ""))
        if created_at is None or created_at < created_after:
            continue
        enriched = dict(item)
        enriched["createdAt"] = document.get("createdAt", "")
        filtered.append(enriched)
    return filtered


class KnowledgeBaseHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            self.write_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/debug":
            self.write_file(STATIC_DIR / "debug.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/health":
            self.write_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "knowledge-base",
                    "dataDir": str(get_service_root_dir()),
                    "indexDir": str(get_index_dir()),
                    "llamaDependenciesInstalled": dependencies_available(),
                    "llamaRuntimeReady": runtime_ready(),
                    "llmRuntimeReady": llm_runtime_ready(),
                    "embeddingRuntime": describe_embedding_runtime(),
                    "openaiBaseUrl": get_openai_base_url(),
                    "llmModel": get_openai_llm_model(),
                },
            )
            return
        if parsed.path == "/documents":
            params = parse_qs(parsed.query)
            limit = int((params.get("limit", ["20"]) or ["20"])[0])
            self.write_json(HTTPStatus.OK, {"ok": True, "documents": list_documents(limit=limit)})
            return
        if parsed.path == "/documents/view":
            params = parse_qs(parsed.query)
            document_id = int((params.get("id", ["0"]) or ["0"])[0])
            document = get_document(document_id)
            if document is None:
                self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Document not found"})
                return
            self.write_json(HTTPStatus.OK, {"ok": True, "document": document})
            return
        if parsed.path == "/knowledge/search":
            params = parse_qs(parsed.query)
            query = (params.get("q", [""]) or [""])[0].strip()
            top_k = int((params.get("topK", ["5"]) or ["5"])[0])
            raw = (params.get("raw", ["0"]) or ["0"])[0].strip().lower() in {"1", "true", "yes"}
            days = int((params.get("days", ["0"]) or ["0"])[0])
            created_after = (params.get("createdAfter", [""]) or [""])[0].strip()
            if not query:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "q is required"})
                return
            try:
                raw_results = semantic_search(query, top_k=max(top_k * 3, top_k))
                grouped_results = group_search_results(raw_results, top_k=top_k)
                grouped_results = filter_grouped_results_by_time(
                    grouped_results,
                    days=days,
                    created_after_raw=created_after,
                )
                payload = {"ok": True, "mode": "llama", "results": grouped_results}
                if raw:
                    payload["rawResults"] = raw_results
                if days > 0:
                    payload["days"] = days
                if created_after:
                    payload["createdAfter"] = created_after
                self.write_json(HTTPStatus.OK, payload)
            except Exception as exc:
                self.write_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "mode": "keyword-fallback",
                        "warning": str(exc),
                        "results": keyword_search(query, limit=top_k),
                    },
                )
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        body = self.read_json_body()
        if body is None:
            return
        if parsed.path == "/documents":
            self.handle_create_document(body)
            return
        if parsed.path == "/knowledge/ask":
            self.handle_ask(body)
            return
        if parsed.path == "/knowledge/reindex":
            self.handle_reindex()
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def handle_create_document(self, body: Dict[str, Any]) -> None:
        title = str(body.get("title", "")).strip() or "Untitled document"
        source_type = str(body.get("sourceType", "note")).strip() or "note"
        source_url = str(body.get("sourceUrl", "")).strip()
        raw_content = str(body.get("rawContent", "")).strip()
        metadata = body.get("metadata", {}) if isinstance(body.get("metadata"), dict) else {}
        if not raw_content:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "rawContent is required"})
            return

        auto_extract = body.get("autoExtract")
        if auto_extract is None:
            auto_extract = should_auto_extract()
        extraction: Dict[str, Any] = {"documentSummary": "", "knowledgeCards": [], "annotations": []}
        extraction_warning = ""
        if auto_extract:
            try:
                extraction = extract_knowledge(title, source_type, raw_content)
            except Exception as exc:
                extraction_warning = str(exc)

        manual_cards = body.get("knowledgeCards", []) if isinstance(body.get("knowledgeCards"), list) else []
        manual_annotations = body.get("annotations", []) if isinstance(body.get("annotations"), list) else []
        document = create_document(
            title=title,
            source_type=source_type,
            source_url=source_url,
            raw_content=raw_content,
            ai_summary=extraction.get("documentSummary", ""),
            metadata=metadata,
            knowledge_cards=extraction.get("knowledgeCards", []) + manual_cards,
            annotations=extraction.get("annotations", []) + manual_annotations,
        )

        reindex_result: Optional[Dict[str, Any]] = None
        reindex_warning = ""
        try:
            reindex_result = rebuild_index(fetch_document_bundles())
        except Exception as exc:
            reindex_warning = str(exc)

        self.write_json(
            HTTPStatus.CREATED,
            {
                "ok": True,
                "document": document,
                "extractionWarning": extraction_warning,
                "reindexWarning": reindex_warning,
                "reindex": reindex_result,
            },
        )

    def handle_ask(self, body: Dict[str, Any]) -> None:
        query = str(body.get("query", "")).strip()
        top_k = int(body.get("topK", 5) or 5)
        if not query:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "query is required"})
            return
        try:
            self.write_json(HTTPStatus.OK, {"ok": True, "mode": "llama", **ask_index(query, top_k=top_k)})
        except Exception as exc:
            self.write_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "mode": "keyword-fallback",
                    "warning": str(exc),
                    "answer": "",
                    "sources": keyword_search(query, limit=top_k),
                },
            )

    def handle_reindex(self) -> None:
        try:
            result = rebuild_index(fetch_document_bundles())
        except Exception as exc:
            self.write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})
            return
        self.write_json(HTTPStatus.OK, result)

    def read_json_body(self) -> Optional[Dict[str, Any]]:
        content_length = int(self.headers.get("Content-Length", "0") or 0)
        raw_body = self.rfile.read(content_length) if content_length > 0 else b""
        if not raw_body:
            return {}
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return None
        if not isinstance(payload, dict):
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "JSON body must be an object"})
            return None
        return payload

    def write_json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def write_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Static file not found"})
            return
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        return


def run_server() -> None:
    boot_progress(92, "initialize sqlite store")
    initialize_store()
    boot_progress(96, "bind http server")
    server = ThreadingHTTPServer((get_bind_host(), get_bind_port()), KnowledgeBaseHandler)
    boot_progress(100, f"listening on http://{get_bind_host()}:{get_bind_port()}")
    print(f"knowledge-base listening on http://{get_bind_host()}:{get_bind_port()}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
