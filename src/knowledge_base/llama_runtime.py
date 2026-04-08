import shutil
import time
from typing import Any, Dict, List

from .config import (
    get_cache_dir,
    get_embedding_provider,
    get_huggingface_embedding_model,
    get_index_dir,
    get_openai_api_key,
    get_openai_base_url,
    get_openai_embedding_model,
    get_openai_llm_model,
)
from .json_utils import extract_json_object

try:
    from llama_index.core import Document, Settings, StorageContext, VectorStoreIndex, load_index_from_storage
    from llama_index.core.node_parser import SentenceSplitter
except ImportError:  # pragma: no cover
    Document = None
    Settings = None
    StorageContext = None
    VectorStoreIndex = None
    load_index_from_storage = None
    SentenceSplitter = None

try:
    from llama_index.llms.openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None

try:
    from llama_index.llms.openai_like import OpenAILike
except ImportError:  # pragma: no cover
    OpenAILike = None

try:
    from llama_index.embeddings.openai import OpenAIEmbedding
except ImportError:  # pragma: no cover
    OpenAIEmbedding = None

try:
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
except ImportError:  # pragma: no cover
    HuggingFaceEmbedding = None


_llm_initialized = False
_embedding_initialized = False


def runtime_log(message: str) -> None:
    print(f"[knowledge-base] {message}", flush=True)


def _core_available() -> bool:
    return all(value is not None for value in (Document, Settings, StorageContext, VectorStoreIndex, load_index_from_storage, SentenceSplitter))


def llm_dependencies_available() -> bool:
    if not _core_available():
        return False
    if get_openai_base_url():
        return OpenAILike is not None
    return OpenAI is not None


def embedding_dependencies_available() -> bool:
    if not _core_available():
        return False
    provider = get_embedding_provider()
    if provider == "openai":
        return OpenAIEmbedding is not None
    return HuggingFaceEmbedding is not None


def dependencies_available() -> bool:
    return llm_dependencies_available() and embedding_dependencies_available()


def llm_runtime_ready() -> bool:
    return llm_dependencies_available() and bool(get_openai_api_key())


def embedding_runtime_ready() -> bool:
    if not embedding_dependencies_available():
        return False
    if get_embedding_provider() == "openai":
        return bool(get_openai_api_key())
    return True


def runtime_ready() -> bool:
    return llm_runtime_ready() and embedding_runtime_ready()


def _build_openai_kwargs() -> Dict[str, Any]:
    kwargs: Dict[str, Any] = {"api_key": get_openai_api_key()}
    base_url = get_openai_base_url()
    if base_url:
        kwargs["base_url"] = base_url
    return kwargs


def _ensure_core() -> None:
    if not _core_available():
        raise RuntimeError("LlamaIndex core dependencies are not installed")
    Settings.text_splitter = SentenceSplitter(chunk_size=768, chunk_overlap=96)


def _ensure_llm_runtime() -> None:
    global _llm_initialized
    _ensure_core()
    if not get_openai_api_key():
        raise RuntimeError("OPENAI_API_KEY or AI_KNOWLEDGE_BASE_OPENAI_API_KEY is required for LLM usage")
    base_url = get_openai_base_url()
    started = time.perf_counter()
    if base_url:
        if OpenAILike is None:
            raise RuntimeError("LlamaIndex OpenAI-compatible LLM dependency is not installed")
        if not _llm_initialized:
            runtime_log(f"initialize llm provider=openai-compatible model={get_openai_llm_model()}")
        Settings.llm = OpenAILike(
            model=get_openai_llm_model(),
            api_key=get_openai_api_key(),
            api_base=base_url,
            context_window=128000,
            is_chat_model=True,
            is_function_calling_model=False,
        )
        if not _llm_initialized:
            runtime_log(f"llm ready in {time.perf_counter() - started:.2f}s")
            _llm_initialized = True
        return
    if OpenAI is None:
        raise RuntimeError("LlamaIndex OpenAI LLM dependency is not installed")
    if not _llm_initialized:
        runtime_log(f"initialize llm provider=openai model={get_openai_llm_model()}")
    Settings.llm = OpenAI(model=get_openai_llm_model(), **_build_openai_kwargs())
    if not _llm_initialized:
        runtime_log(f"llm ready in {time.perf_counter() - started:.2f}s")
        _llm_initialized = True


def _ensure_embedding_runtime() -> None:
    global _embedding_initialized
    _ensure_core()
    provider = get_embedding_provider()
    started = time.perf_counter()
    if provider == "openai":
        if OpenAIEmbedding is None:
            raise RuntimeError("LlamaIndex OpenAI embedding dependency is not installed")
        if not get_openai_api_key():
            raise RuntimeError("OPENAI_API_KEY or AI_KNOWLEDGE_BASE_OPENAI_API_KEY is required for OpenAI embeddings")
        if not _embedding_initialized:
            runtime_log(f"initialize embedding provider=openai model={get_openai_embedding_model()}")
        Settings.embed_model = OpenAIEmbedding(model=get_openai_embedding_model(), **_build_openai_kwargs())
        if not _embedding_initialized:
            runtime_log(f"embedding ready in {time.perf_counter() - started:.2f}s")
            _embedding_initialized = True
        return

    if HuggingFaceEmbedding is None:
        raise RuntimeError("LlamaIndex HuggingFace embedding dependency is not installed")
    if not _embedding_initialized:
        runtime_log(f"initialize embedding provider=huggingface model={get_huggingface_embedding_model()}")
    Settings.embed_model = HuggingFaceEmbedding(model_name=get_huggingface_embedding_model())
    if not _embedding_initialized:
        runtime_log(f"embedding ready in {time.perf_counter() - started:.2f}s")
        _embedding_initialized = True


def describe_embedding_runtime() -> Dict[str, Any]:
    provider = get_embedding_provider()
    if provider == "openai":
        model_name = get_openai_embedding_model()
    else:
        model_name = get_huggingface_embedding_model()
    return {
        "provider": provider,
        "model": model_name,
        "dependenciesInstalled": embedding_dependencies_available(),
        "runtimeReady": embedding_runtime_ready(),
    }


def _index_exists() -> bool:
    index_dir = get_index_dir()
    return index_dir.exists() and any(index_dir.iterdir())


def build_document_text(bundle: Dict[str, Any]) -> str:
    sections: List[str] = [
        f"Document Title: {bundle.get('title', '')}",
        f"Source Type: {bundle.get('sourceType', '')}",
    ]

    source_url = str(bundle.get("sourceUrl", "")).strip()
    if source_url:
        sections.append(f"Source URL: {source_url}")

    ai_summary = str(bundle.get("aiSummary", "")).strip()
    if ai_summary:
        sections.append(f"AI Summary:\n{ai_summary}")

    cards = bundle.get("knowledgeCards", [])
    if cards:
        card_lines = []
        for card in cards:
            tags = ", ".join(card.get("tags", []))
            card_lines.append(
                f"- Title: {card.get('title', '')}\n  Topic: {card.get('topic', '')}\n  Tags: {tags}\n  Summary: {card.get('summary', '')}"
            )
        sections.append("Knowledge Cards:\n" + "\n".join(card_lines))

    annotations = bundle.get("annotations", [])
    if annotations:
        annotation_lines = [
            f"- [{item.get('signalType', 'note')}] {item.get('note', '')}"
            for item in annotations
            if str(item.get("note", "")).strip()
        ]
        if annotation_lines:
            sections.append("Annotations:\n" + "\n".join(annotation_lines))

    sections.append("Raw Content:\n" + str(bundle.get("rawContent", "")).strip())
    return "\n\n".join(part for part in sections if str(part).strip())


def _to_llama_document(bundle: Dict[str, Any]) -> Any:
    return Document(
        text=build_document_text(bundle),
        doc_id=f"document-{bundle['id']}",
        metadata={
            "document_id": int(bundle["id"]),
            "title": bundle.get("title", ""),
            "source_type": bundle.get("sourceType", ""),
            "source_url": bundle.get("sourceUrl", ""),
        },
    )


def rebuild_index(bundles: List[Dict[str, Any]]) -> Dict[str, Any]:
    runtime_log(f"rebuild index start documents={len(bundles)}")
    started = time.perf_counter()
    _ensure_embedding_runtime()
    index_dir = get_index_dir()
    cache_dir = get_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)

    if index_dir.exists():
        shutil.rmtree(index_dir)
    index_dir.mkdir(parents=True, exist_ok=True)

    if not bundles:
        return {"ok": True, "indexedCount": 0, "indexDir": str(index_dir), "embedding": describe_embedding_runtime()}

    documents = [_to_llama_document(bundle) for bundle in bundles]
    index = VectorStoreIndex.from_documents(documents)
    index.storage_context.persist(persist_dir=str(index_dir))
    runtime_log(f"rebuild index complete in {time.perf_counter() - started:.2f}s")
    return {
        "ok": True,
        "indexedCount": len(documents),
        "indexDir": str(index_dir),
        "embedding": describe_embedding_runtime(),
    }


def _load_index() -> Any:
    _ensure_embedding_runtime()
    if not _index_exists():
        raise RuntimeError("Index is not built yet")
    storage_context = StorageContext.from_defaults(persist_dir=str(get_index_dir()))
    return load_index_from_storage(storage_context)


def semantic_search(query: str, top_k: int = 5) -> List[Dict[str, Any]]:
    runtime_log(f"semantic search start top_k={top_k} query={query[:80]}")
    started = time.perf_counter()
    index = _load_index()
    retriever = index.as_retriever(similarity_top_k=max(1, min(int(top_k or 5), 20)))
    nodes = retriever.retrieve(str(query or "").strip())
    results: List[Dict[str, Any]] = []
    for node in nodes:
        results.append(
            {
                "score": float(getattr(node, "score", 0) or 0),
                "documentId": node.metadata.get("document_id"),
                "title": node.metadata.get("title", ""),
                "sourceType": node.metadata.get("source_type", ""),
                "sourceUrl": node.metadata.get("source_url", ""),
                "snippet": node.text[:800],
            }
        )
    runtime_log(f"semantic search complete results={len(results)} in {time.perf_counter() - started:.2f}s")
    return results


def group_search_results(results: List[Dict[str, Any]], top_k: int = 5) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    for item in results:
        document_id = str(item.get("documentId", "")).strip()
        if not document_id:
            continue
        snippet = str(item.get("snippet", "")).strip()
        score = float(item.get("score", 0) or 0)
        current = grouped.get(document_id)
        if current is None:
            grouped[document_id] = {
                "documentId": item.get("documentId"),
                "title": item.get("title", ""),
                "sourceType": item.get("sourceType", ""),
                "sourceUrl": item.get("sourceUrl", ""),
                "score": score,
                "snippet": snippet,
                "matchedSnippets": [snippet] if snippet else [],
                "matchCount": 1,
            }
            continue

        current["matchCount"] += 1
        if snippet and snippet not in current["matchedSnippets"]:
            current["matchedSnippets"].append(snippet)
        if score > float(current.get("score", 0) or 0):
            current["score"] = score
            current["snippet"] = snippet or current.get("snippet", "")

    ordered = sorted(grouped.values(), key=lambda item: (-float(item.get("score", 0) or 0), -int(item.get("matchCount", 0)), str(item.get("documentId", ""))))
    limited = ordered[: max(1, min(int(top_k or 5), 20))]
    for item in limited:
        item["matchedSnippets"] = item.get("matchedSnippets", [])[:3]
    return limited


def ask_index(query: str, top_k: int = 5) -> Dict[str, Any]:
    runtime_log(f"ask start top_k={top_k} query={query[:80]}")
    started = time.perf_counter()
    _ensure_llm_runtime()
    index = _load_index()
    query_engine = index.as_query_engine(similarity_top_k=max(1, min(int(top_k or 5), 20)), response_mode="compact")
    response = query_engine.query(str(query or "").strip())
    sources: List[Dict[str, Any]] = []
    for source_node in getattr(response, "source_nodes", []) or []:
        sources.append(
            {
                "score": float(getattr(source_node, "score", 0) or 0),
                "documentId": source_node.metadata.get("document_id"),
                "title": source_node.metadata.get("title", ""),
                "sourceType": source_node.metadata.get("source_type", ""),
                "sourceUrl": source_node.metadata.get("source_url", ""),
                "snippet": source_node.text[:800],
            }
        )
    runtime_log(f"ask complete sources={len(sources)} in {time.perf_counter() - started:.2f}s")
    return {"answer": str(response), "sources": sources}


def extract_knowledge(title: str, source_type: str, raw_content: str) -> Dict[str, Any]:
    runtime_log(f"extract knowledge start source_type={source_type} title={title[:80]}")
    started = time.perf_counter()
    _ensure_llm_runtime()
    prompt = f"""
You are a document knowledge extraction assistant.
Return strict JSON with this shape:
{{
  "document_summary": "short summary",
  "knowledge_cards": [
    {{
      "title": "specific reusable insight",
      "summary": "one paragraph",
      "topic": "topic name",
      "tags": ["tag1", "tag2"],
      "confidence": 0.0
    }}
  ],
  "annotations": [
    {{
      "note": "optional candidate follow-up or signal",
      "signal_type": "use_later"
    }}
  ]
}}

Rules:
- Produce 3 to 8 knowledge cards when enough content exists.
- Prefer reusable technical insights over generic restatements.
- Keep annotations for explicit future-use signals, experiments, or follow-ups.
- confidence must be between 0 and 1.

Document title: {title}
Source type: {source_type}

Document content:
{raw_content}
""".strip()
    response = Settings.llm.complete(prompt)
    payload = extract_json_object(str(response))

    cards: List[Dict[str, Any]] = []
    for raw_card in payload.get("knowledge_cards", []):
        if not isinstance(raw_card, dict):
            continue
        title_value = str(raw_card.get("title", "")).strip()
        if not title_value:
            continue
        cards.append(
            {
                "title": title_value,
                "summary": str(raw_card.get("summary", "")).strip(),
                "topic": str(raw_card.get("topic", "")).strip(),
                "tags": [str(tag).strip() for tag in raw_card.get("tags", []) if str(tag).strip()],
                "confidence": max(0.0, min(float(raw_card.get("confidence", 0) or 0), 1.0)),
            }
        )

    annotations: List[Dict[str, Any]] = []
    for raw_annotation in payload.get("annotations", []):
        if not isinstance(raw_annotation, dict):
            continue
        note = str(raw_annotation.get("note", "")).strip()
        if not note:
            continue
        annotations.append(
            {
                "note": note,
                "signalType": str(raw_annotation.get("signal_type", "note")).strip() or "note",
            }
        )

    result = {
        "documentSummary": str(payload.get("document_summary", "")).strip(),
        "knowledgeCards": cards,
        "annotations": annotations,
        "rawModelPayload": payload,
    }
    runtime_log(
        f"extract knowledge complete cards={len(cards)} annotations={len(annotations)} in {time.perf_counter() - started:.2f}s"
    )
    return result
