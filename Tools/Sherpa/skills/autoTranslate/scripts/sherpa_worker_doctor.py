import json
import os
import sys
import time
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_env(root: Path) -> dict:
    values = {}
    source = root / ".env"
    if not source.exists():
        source = root / ".env.example"
    if source.exists():
        for raw in source.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    values.update(os.environ)
    return values


def configure_runtime_paths(env: dict) -> None:
    extra_paths = []
    raw = env.get("AI_AUTO_TRANSLATE_SHERPA_EXTRA_PATHS", "")
    if raw:
        extra_paths.extend([item for item in raw.split(";") if item])

    default_cudnn_root = Path(r"C:\Program Files\NVIDIA\CUDNN")
    if default_cudnn_root.exists():
        matches = sorted(default_cudnn_root.rglob("cudnn64_9.dll"), reverse=True)
        if matches:
            extra_paths.append(str(matches[0].parent))

    seen = set()
    valid_paths = []
    for item in extra_paths:
        if item in seen:
            continue
        seen.add(item)
        if Path(item).exists():
            valid_paths.append(item)

    if not valid_paths:
        return

    os.environ["PATH"] = ";".join(valid_paths + [os.environ.get("PATH", "")])
    for item in valid_paths:
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(item)


def resolve_path(root: Path, value: str | None) -> Path | None:
    if not value:
        return None
    path = Path(value)
    return path if path.is_absolute() else (root / path).resolve()


def main() -> int:
    root = repo_root()
    env = load_env(root)
    configure_runtime_paths(env)
    import soundfile as sf
    import sherpa_onnx

    model_dir = resolve_path(root, env.get("AI_AUTO_TRANSLATE_SHERPA_MODEL_DIR"))
    provider = env.get("AI_AUTO_TRANSLATE_SHERPA_PROVIDER", "cuda")
    language = env.get("AI_AUTO_TRANSLATE_SHERPA_LANGUAGE", "auto")
    use_itn = env.get("AI_AUTO_TRANSLATE_SHERPA_USE_ITN", "1") == "1"
    num_threads = int(env.get("AI_AUTO_TRANSLATE_SHERPA_NUM_THREADS", "1"))
    report = {
        "repo_root": str(root),
        "provider": provider,
        "checks": [],
    }

    if not model_dir or not model_dir.exists():
        report["checks"].append({"name": "model_dir", "ok": False, "detail": str(model_dir) if model_dir else None})
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    model_path = model_dir / "model.int8.onnx"
    if not model_path.exists():
        model_path = model_dir / "model.onnx"
    tokens_path = model_dir / "tokens.txt"
    test_wav = model_dir / "test_wavs" / "zh.wav"

    for name, path in [("model", model_path), ("tokens", tokens_path), ("test_wav", test_wav)]:
        report["checks"].append({"name": name, "ok": path.exists(), "detail": str(path)})

    try:
        load_start = time.perf_counter()
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model_path),
            tokens=str(tokens_path),
            language=language,
            use_itn=use_itn,
            provider=provider,
            num_threads=num_threads,
            debug=False,
        )
        report["checks"].append(
            {"name": "recognizer_create", "ok": True, "detail": f"{time.perf_counter() - load_start:.3f}s"}
        )
    except Exception as exc:
        report["checks"].append({"name": "recognizer_create", "ok": False, "detail": str(exc)})
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    if test_wav.exists():
        try:
            audio, sample_rate = sf.read(str(test_wav), dtype="float32", always_2d=True)
            audio = audio[:, 0]
            stream = recognizer.create_stream()
            stream.accept_waveform(sample_rate, audio)
            recognizer.decode_stream(stream)
            report["checks"].append({"name": "test_decode", "ok": True, "detail": str(stream.result)})
        except Exception as exc:
            report["checks"].append({"name": "test_decode", "ok": False, "detail": str(exc)})

    report["ok"] = all(item["ok"] for item in report["checks"])
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        raise
