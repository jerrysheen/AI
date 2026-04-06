import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def get_engine_root_dir() -> Path:
    configured = os.environ.get("AI_REVIEW_ENGINE_DATA_DIR", "data/review-engine").strip()
    if os.path.isabs(configured):
        return Path(configured)
    return REPO_ROOT / configured


def get_engine_cache_dir() -> Path:
    return get_engine_root_dir() / "cache"


def get_engine_runs_dir() -> Path:
    return get_engine_root_dir() / "runs"


def get_bind_host() -> str:
    return os.environ.get("AI_REVIEW_ENGINE_HOST", "127.0.0.1").strip() or "127.0.0.1"


def get_bind_port() -> int:
    raw = os.environ.get("AI_REVIEW_ENGINE_PORT", "8776").strip()
    try:
        value = int(raw)
    except ValueError:
        return 8776
    return value if value > 0 else 8776
