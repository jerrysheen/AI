import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
import wave
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_env(root: Path) -> dict:
    merged = {}
    source = root / ".env"
    if not source.exists():
        source = root / ".env.example"
    if source.exists():
        for raw in source.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            merged[key.strip()] = value.strip()
    merged.update(os.environ)
    return merged


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
    valid_paths = []
    for item in extra_paths:
        if Path(item).exists() and item not in valid_paths:
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


def ensure_wav_input(input_path: Path, staging_dir: Path, ffmpeg_path: str | None) -> tuple[Path, dict]:
    info = {"conversion_performed": False}
    if input_path.suffix.lower() == ".wav":
        return input_path, info
    ffmpeg = ffmpeg_path or shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("Input is not WAV and ffmpeg is not available.")
    staging_dir.mkdir(parents=True, exist_ok=True)
    output_path = staging_dir / "converted-input.wav"
    subprocess.run([ffmpeg, "-y", "-i", str(input_path), "-ac", "1", "-ar", "16000", str(output_path)], check=True, capture_output=True, text=True)
    info["conversion_performed"] = True
    return output_path, info


def audio_duration_seconds(wav_path: Path) -> float:
    with wave.open(str(wav_path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


def create_recognizer(model_dir: Path, provider: str, language: str, use_itn: bool, num_threads: int):
    import sherpa_onnx

    model_path = model_dir / "model.int8.onnx"
    if not model_path.exists():
        model_path = model_dir / "model.onnx"
    tokens_path = model_dir / "tokens.txt"
    if not model_path.exists() or not tokens_path.exists():
        raise FileNotFoundError(f"Missing model assets under {model_dir}")
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model_path),
        tokens=str(tokens_path),
        language=language,
        use_itn=use_itn,
        provider=provider,
        num_threads=num_threads,
        debug=False,
    )


def decode_file(recognizer, wav_path: Path) -> dict:
    import soundfile as sf

    audio, sample_rate = sf.read(str(wav_path), dtype="float32", always_2d=True)
    audio = audio[:, 0]
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, audio)
    recognizer.decode_stream(stream)
    result_text = str(stream.result)
    try:
        return json.loads(result_text)
    except json.JSONDecodeError:
        return {"text": result_text, "tokens": [], "timestamps": [], "words": []}


def fmt_srt_ts(value: float) -> str:
    total_ms = max(0, int(round(value * 1000)))
    hours = total_ms // 3600000
    minutes = (total_ms % 3600000) // 60000
    seconds = (total_ms % 60000) // 1000
    millis = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def build_srt(result: dict) -> str:
    tokens = result.get("tokens", [])
    timestamps = result.get("timestamps", [])
    if not tokens:
        text = result.get("text", "").strip()
        return "" if not text else f"1\n00:00:00,000 --> 00:00:05,000\n{text}\n"
    lines = []
    for idx, token in enumerate(tokens):
        start = timestamps[idx] if idx < len(timestamps) else 0.0
        end = timestamps[idx + 1] if idx + 1 < len(timestamps) else start + 0.5
        lines.append(f"{idx + 1}\n{fmt_srt_ts(start)} --> {fmt_srt_ts(end)}\n{token.strip() or token}\n")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir")
    parser.add_argument("--job-id")
    parser.add_argument("--provider")
    parser.add_argument("--language")
    args = parser.parse_args()

    root = repo_root()
    env = load_env(root)
    configure_runtime_paths(env)
    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    output_root = resolve_path(root, env.get("AI_AUTO_TRANSLATE_OUTPUT_ROOT")) or (root / ".ai-data" / "sherpa-onnx" / "runs")
    job_id = args.job_id or uuid.uuid4().hex
    output_dir = Path(args.output_dir).resolve() if args.output_dir else (output_root / job_id)
    output_dir.mkdir(parents=True, exist_ok=True)

    provider = args.provider or env.get("AI_AUTO_TRANSLATE_SHERPA_PROVIDER", "cpu")
    language = args.language or env.get("AI_AUTO_TRANSLATE_SHERPA_LANGUAGE", "auto")
    use_itn = env.get("AI_AUTO_TRANSLATE_SHERPA_USE_ITN", "1") == "1"
    num_threads = int(env.get("AI_AUTO_TRANSLATE_SHERPA_NUM_THREADS", "1"))
    model_dir = resolve_path(root, env.get("AI_AUTO_TRANSLATE_SHERPA_MODEL_DIR"))
    if not model_dir:
        raise RuntimeError("AI_AUTO_TRANSLATE_SHERPA_MODEL_DIR is not configured.")

    prepare_start = time.perf_counter()
    wav_path, conversion = ensure_wav_input(input_path, output_dir / "staging", env.get("AI_FFMPEG_PATH"))
    prepare_seconds = time.perf_counter() - prepare_start
    duration_seconds = audio_duration_seconds(wav_path)

    load_start = time.perf_counter()
    recognizer = create_recognizer(model_dir, provider, language, use_itn, num_threads)
    model_load_seconds = time.perf_counter() - load_start

    decode_start = time.perf_counter()
    result = decode_file(recognizer, wav_path)
    decode_seconds = time.perf_counter() - decode_start
    total_seconds = model_load_seconds + decode_seconds
    rtf = decode_seconds / duration_seconds if duration_seconds else None

    transcript_txt = output_dir / "transcript.txt"
    transcript_json = output_dir / "transcript.json"
    transcript_srt = output_dir / "transcript.srt"
    run_summary = output_dir / "run-summary.json"
    transcript_txt.write_text((result.get("text", "").strip() + "\n") if result.get("text") else "", encoding="utf-8")
    transcript_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    transcript_srt.write_text(build_srt(result), encoding="utf-8")

    summary = {
        "job_id": job_id,
        "backend": "sherpa",
        "model": env.get("AI_AUTO_TRANSLATE_SHERPA_MODEL", "sensevoice"),
        "provider": provider,
        "language": language,
        "input_path": str(input_path),
        "wav_path": str(wav_path),
        "output_dir": str(output_dir),
        "audio_duration_seconds": duration_seconds,
        "timing": {
            "prepare_seconds": round(prepare_seconds, 3),
            "model_load_seconds": round(model_load_seconds, 3),
            "decode_seconds": round(decode_seconds, 3),
            "total_seconds": round(total_seconds, 3),
            "rtf": round(rtf, 3) if rtf is not None else None,
        },
        "conversion": conversion,
        "artifacts": {
            "transcript_txt": str(transcript_txt),
            "transcript_json": str(transcript_json),
            "transcript_srt": str(transcript_srt),
            "run_summary_json": str(run_summary),
        },
    }
    run_summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[sherpa] error: {exc}", file=sys.stderr)
        raise
