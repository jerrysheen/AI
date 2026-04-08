import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _resolve_repo_path(configured: str, default_relative: str) -> Path:
    value = (configured or default_relative).strip() or default_relative
    if os.path.isabs(value):
        return Path(value)
    return REPO_ROOT / value


def get_service_root_dir() -> Path:
    return _resolve_repo_path(
        os.environ.get("AI_KNOWLEDGE_BASE_DATA_DIR", "data/knowledge-base"),
        "data/knowledge-base",
    )


def get_db_dir() -> Path:
    return get_service_root_dir() / "db"


def get_db_path() -> Path:
    return get_db_dir() / "knowledge.db"


def get_index_dir() -> Path:
    return get_service_root_dir() / "index"


def get_cache_dir() -> Path:
    return get_service_root_dir() / "cache"


def get_uploads_dir() -> Path:
    return get_service_root_dir() / "uploads"


def get_bind_host() -> str:
    return os.environ.get("AI_KNOWLEDGE_BASE_HOST", "127.0.0.1").strip() or "127.0.0.1"


def get_bind_port() -> int:
    raw = os.environ.get("AI_KNOWLEDGE_BASE_PORT", "8777").strip()
    try:
        value = int(raw)
    except ValueError:
        return 8777
    return value if value > 0 else 8777


def get_openai_api_key() -> str:
    return (
        os.environ.get("AI_KNOWLEDGE_BASE_OPENAI_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )


def get_openai_base_url() -> str:
    return (
        os.environ.get("AI_KNOWLEDGE_BASE_OPENAI_BASE_URL", "").strip()
        or os.environ.get("OPENAI_BASE_URL", "").strip()
    )


def get_openai_llm_model() -> str:
    return os.environ.get("AI_KNOWLEDGE_BASE_OPENAI_LLM_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"


def get_openai_embedding_model() -> str:
    return (
        os.environ.get("AI_KNOWLEDGE_BASE_OPENAI_EMBED_MODEL", "text-embedding-3-small").strip()
        or "text-embedding-3-small"
    )


def get_embedding_provider() -> str:
    return os.environ.get("AI_KNOWLEDGE_BASE_EMBED_PROVIDER", "huggingface").strip().lower() or "huggingface"


def get_huggingface_embedding_model() -> str:
    return (
        os.environ.get("AI_KNOWLEDGE_BASE_HF_EMBED_MODEL", "BAAI/bge-small-zh-v1.5").strip()
        or "BAAI/bge-small-zh-v1.5"
    )


def should_auto_extract() -> bool:
    raw = os.environ.get("AI_KNOWLEDGE_BASE_AUTO_EXTRACT", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}
