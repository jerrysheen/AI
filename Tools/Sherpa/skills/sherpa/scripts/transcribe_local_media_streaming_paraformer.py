import argparse
import json
import os
import sys
import time
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
import sherpa_onnx


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


def resolve_path(root: Path, value: str | None) -> Path | None:
    if not value:
        return None
    path = Path(value)
    return path if path.is_absolute() else (root / path).resolve()


def make_recognizer(model_dir: Path, provider: str):
    return sherpa_onnx.OnlineRecognizer.from_paraformer(
        tokens=str(model_dir / "tokens.txt"),
        encoder=str(model_dir / "encoder.int8.onnx"),
        decoder=str(model_dir / "decoder.int8.onnx"),
        num_threads=1,
        sample_rate=16000,
        feature_dim=80,
        enable_endpoint_detection=False,
        decoding_method="greedy_search",
        provider=provider,
        debug=False,
    )


def audio_duration_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--provider", default=None)
    parser.add_argument("--chunk-ms", type=int, default=160)
    parser.add_argument("--simulate-realtime", action="store_true")
    args = parser.parse_args()

    root = repo_root()
    env = load_env(root)
    model_dir = resolve_path(root, env.get("AI_SHERPA_STREAMING_MODEL_DIR"))
    if not model_dir or not model_dir.exists():
        raise RuntimeError("AI_SHERPA_STREAMING_MODEL_DIR is not configured or missing.")

    provider = args.provider or env.get("AI_SHERPA_STREAMING_PROVIDER", "cpu")
    recognizer = make_recognizer(model_dir, provider)
    stream = recognizer.create_stream()

    wav_path = Path(args.input).resolve()
    audio, sample_rate = sf.read(str(wav_path), dtype="float32", always_2d=True)
    audio = audio[:, 0]
    if sample_rate != 16000:
        pass

    chunk_samples = max(1, int(sample_rate * args.chunk_ms / 1000))
    started_at = time.perf_counter()
    first_token_latency_ms = None
    first_non_empty_text = ""
    preview_events = []
    previous_text = ""

    for idx in range(0, len(audio), chunk_samples):
        chunk = audio[idx : idx + chunk_samples]
        chunk_start = time.perf_counter()
        stream.accept_waveform(sample_rate, chunk)
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream)
        if text and text != previous_text:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            preview_events.append({"t_ms": elapsed_ms, "text": text})
            previous_text = text
            if first_token_latency_ms is None:
                first_token_latency_ms = elapsed_ms
                first_non_empty_text = text
        if args.simulate_realtime:
            spent = time.perf_counter() - chunk_start
            target = len(chunk) / float(sample_rate)
            if spent < target:
                time.sleep(target - spent)

    stream.input_finished()
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)
    final_text = recognizer.get_result(stream)
    total_seconds = time.perf_counter() - started_at
    duration_seconds = audio_duration_seconds(wav_path)

    payload = {
        "mode": "streaming-preview-experiment",
        "provider": provider,
        "model_dir": str(model_dir),
        "input_path": str(wav_path),
        "audio_duration_seconds": duration_seconds,
        "first_token_latency_ms": first_token_latency_ms,
        "first_non_empty_text": first_non_empty_text,
        "final_text": final_text,
        "preview_events": preview_events,
        "timing": {
            "wall_clock_seconds": round(total_seconds, 3),
            "rtf": round(total_seconds / duration_seconds, 3) if duration_seconds else None,
        },
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[streaming] error: {exc}", file=sys.stderr)
        raise
