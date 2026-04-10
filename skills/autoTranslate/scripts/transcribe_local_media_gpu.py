#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def stage_log(stage, message):
    sys.stdout.write(f"[{now_iso()}] [{stage}] {message}\n")
    sys.stdout.flush()


def find_repo_root(start_dir: Path) -> Path:
    current = start_dir.resolve()
    while True:
      if (current / "AGENTS.md").exists() and (current / "skills").exists():
          return current
      parent = current.parent
      if parent == current:
          return start_dir.resolve().parents[2]
      current = parent


def load_repo_env(repo_root: Path):
    env_path = repo_root / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text("utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        os.environ.setdefault(key, value)


def resolve_shared_data_dir(repo_root: Path) -> Path:
    return (repo_root / os.environ.get("AI_SHARED_DATA_DIR", ".ai-data")).resolve()


def resolve_repo_path(repo_root: Path, env_key: str, fallback: str) -> Path:
    return (repo_root / os.environ.get(env_key, fallback)).resolve()


def safe_stem(input_path: Path) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in input_path.stem)


def make_run_dir(base_dir: Path, input_path: Path, output_dir: str | None) -> Path:
    if output_dir:
        run_dir = Path(output_dir).resolve()
    else:
        stamp = datetime.utcnow().isoformat().replace(":", "-").replace(".", "-") + "Z"
        run_dir = (base_dir / f"{safe_stem(input_path)}-{stamp}").resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def split_command(command_text: str) -> list[str]:
    return [part for part in str(command_text or "").strip().split() if part]


def run_command(command_parts: list[str], cwd: Path, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        command_parts,
        cwd=str(cwd),
        check=True,
        text=True,
        capture_output=capture,
    )


def probe_duration(ffprobe_command: str, input_path: Path, repo_root: Path) -> float:
    result = run_command(
        split_command(ffprobe_command)
        + ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)],
        cwd=repo_root,
    )
    return float(result.stdout.strip())


def extract_audio(ffmpeg_command: str, input_path: Path, wav_path: Path, start_seconds: float, clip_seconds: float, repo_root: Path):
    stage_log("extract", "starting ffmpeg extraction")
    command = split_command(ffmpeg_command) + ["-y"]
    if start_seconds > 0:
        command += ["-ss", str(start_seconds)]
    command += ["-i", str(input_path)]
    if clip_seconds > 0:
        command += ["-t", str(clip_seconds)]
    command += ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav_path)]
    subprocess.run(command, cwd=str(repo_root), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stage_log("extract", f"audio ready: {wav_path}")


def format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, rem = divmod(total_ms, 3600000)
    minutes, rem = divmod(rem, 60000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def write_outputs(run_dir: Path, segments_payload: list[dict], summary: dict):
    txt_path = run_dir / "transcript.txt"
    json_path = run_dir / "transcript.json"
    srt_path = run_dir / "transcript.srt"
    summary_path = run_dir / "run-summary.json"

    txt_text = ""
    if segments_payload:
        txt_text = "\n".join(segment["text"] for segment in segments_payload if segment["text"].strip()).strip()
    txt_path.write_text(txt_text + ("\n" if txt_text else ""), encoding="utf-8")
    json_path.write_text(json.dumps({"segments": segments_payload}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    srt_lines = []
    for index, segment in enumerate(segments_payload, start=1):
        srt_lines.append(str(index))
        srt_lines.append(f"{format_srt_timestamp(segment['start'])} --> {format_srt_timestamp(segment['end'])}")
        srt_lines.append(segment["text"].strip())
        srt_lines.append("")
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return txt_path, json_path, srt_path, summary_path


def get_nvidia_smi_debug(repo_root: Path) -> dict:
    try:
        result = run_command(
            [
                "nvidia-smi",
                "--query-gpu=name,driver_version,memory.total,cuda_version",
                "--format=csv,noheader",
            ],
            cwd=repo_root,
        )
        return {
            "ok": True,
            "raw": result.stdout.strip(),
        }
    except Exception as error:
        return {
            "ok": False,
            "error": str(error),
        }


def parse_args():
    parser = argparse.ArgumentParser(description="GPU local media transcription with faster-whisper")
    parser.add_argument("input")
    parser.add_argument("--model-size", default=os.environ.get("AI_AUTO_TRANSLATE_DEFAULT_MODEL", "small"))
    parser.add_argument("--language", default=os.environ.get("AI_AUTO_TRANSLATE_DEFAULT_LANGUAGE", "auto"))
    parser.add_argument("--output-dir")
    parser.add_argument("--start-seconds", type=float, default=0)
    parser.add_argument("--clip-seconds", type=float, default=0)
    parser.add_argument("--prompt", default="")
    parser.add_argument("--keep-wav", action="store_true")
    parser.add_argument("--compute-type", default=os.environ.get("AI_AUTO_TRANSLATE_GPU_COMPUTE_TYPE", "float16"))
    parser.add_argument("--beam-size", type=int, default=int(os.environ.get("AI_AUTO_TRANSLATE_GPU_BEAM_SIZE", "5")))
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


def main():
    script_dir = Path(__file__).resolve().parent
    repo_root = find_repo_root(script_dir)
    load_repo_env(repo_root)

    from faster_whisper import WhisperModel

    args = parse_args()
    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    shared_data_dir = resolve_shared_data_dir(repo_root)
    runs_dir = resolve_repo_path(repo_root, "AI_AUTO_TRANSLATE_RUNS_DIR", str(Path(shared_data_dir.name) / "auto-translate" / "runs"))
    models_dir = resolve_repo_path(repo_root, "AI_AUTO_TRANSLATE_GPU_MODELS_DIR", str(Path(shared_data_dir.name) / "cache" / "faster-whisper"))
    ffmpeg_command = os.environ.get("AI_FFMPEG_COMMAND", "ffmpeg")
    ffprobe_command = os.environ.get("AI_FFPROBE_COMMAND", "ffprobe")
    device = os.environ.get("AI_AUTO_TRANSLATE_GPU_DEVICE", "cuda")

    run_dir = make_run_dir(runs_dir, input_path, args.output_dir)
    wav_path = run_dir / "audio-16k-mono.wav"

    timings_ms = {}
    stage_log("setup", f"repo root: {repo_root}")
    stage_log("setup", f"input: {input_path}")
    stage_log("setup", f"run dir: {run_dir}")
    stage_log("setup", f"backend: gpu")
    stage_log("setup", f"device: {device}")
    stage_log("setup", f"compute type: {args.compute_type}")
    stage_log("setup", f"beam size: {args.beam_size}")
    stage_log("setup", f"model size: {args.model_size}")
    stage_log("setup", f"language: {args.language}")

    nvidia_debug = get_nvidia_smi_debug(repo_root)
    if args.debug:
        if nvidia_debug.get("ok"):
            stage_log("debug", f"nvidia-smi: {nvidia_debug['raw']}")
        else:
            stage_log("debug", f"nvidia-smi unavailable: {nvidia_debug['error']}")

    probe_start = time.time()
    media_duration_seconds = probe_duration(ffprobe_command, input_path, repo_root)
    timings_ms["media_probe_ms"] = round((time.time() - probe_start) * 1000)
    stage_log("probe", f"media duration: {media_duration_seconds:.2f}s")

    effective_duration_seconds = max(0.0, media_duration_seconds - args.start_seconds)
    if args.clip_seconds > 0:
        effective_duration_seconds = min(effective_duration_seconds, args.clip_seconds)

    extract_start = time.time()
    extract_audio(ffmpeg_command, input_path, wav_path, args.start_seconds, args.clip_seconds, repo_root)
    timings_ms["audio_extract_ms"] = round((time.time() - extract_start) * 1000)

    model_start = time.time()
    model = WhisperModel(
        args.model_size,
        device=device,
        compute_type=args.compute_type,
        download_root=str(models_dir),
    )
    timings_ms["model_prepare_ms"] = round((time.time() - model_start) * 1000)
    stage_log("model", f"model ready: {args.model_size}")
    stage_log("model", f"models dir: {models_dir}")

    transcribe_start = time.time()
    segments, info = model.transcribe(
        str(wav_path),
        language=None if args.language == "auto" else args.language,
        initial_prompt=args.prompt or None,
        beam_size=args.beam_size,
        vad_filter=False,
    )

    segments_payload = []
    last_progress_bucket = -1
    detected_language = getattr(info, "language", None)
    language_probability = getattr(info, "language_probability", None)
    for segment in segments:
        text = (segment.text or "").strip()
        segments_payload.append(
            {
                "id": segment.id,
                "start": float(segment.start),
                "end": float(segment.end),
                "text": text,
            }
        )
        if effective_duration_seconds > 0:
            percent = min(99, int((float(segment.end) / effective_duration_seconds) * 100))
            bucket = percent // 5
            if bucket > last_progress_bucket:
                last_progress_bucket = bucket
                stage_log("whisper", f"segment progress {percent}% ({segment.end:.2f}s/{effective_duration_seconds:.2f}s)")
        if args.debug and text:
            stage_log("debug", f"segment[{segment.id}] {segment.start:.2f}-{segment.end:.2f}: {text}")

    timings_ms["transcribe_ms"] = round((time.time() - transcribe_start) * 1000)

    if not args.keep_wav and wav_path.exists():
        wav_path.unlink()

    speed_multiplier = None
    if effective_duration_seconds > 0 and timings_ms["transcribe_ms"] > 0:
        speed_multiplier = effective_duration_seconds / (timings_ms["transcribe_ms"] / 1000)

    summary = {
        "status": "completed",
        "backend": "gpu",
        "input_path": str(input_path),
        "run_dir": str(run_dir),
        "model_size": args.model_size,
        "model_path": str(models_dir),
        "language": args.language,
        "detected_language": detected_language,
        "language_probability": language_probability,
        "device": device,
        "compute_type": args.compute_type,
        "beam_size": args.beam_size,
        "start_seconds": args.start_seconds,
        "clip_seconds": args.clip_seconds,
        "media_duration_seconds": media_duration_seconds,
        "effective_audio_seconds": effective_duration_seconds,
        "timings_ms": timings_ms,
        "transcribe_speed_multiplier": speed_multiplier,
        "segments_count": len(segments_payload),
        "debug": {
            "nvidia_smi": nvidia_debug,
        },
        "outputs": {},
    }

    txt_path, json_path, srt_path, summary_path = write_outputs(run_dir, segments_payload, summary)
    summary["outputs"] = {
        "transcript_txt": str(txt_path) if txt_path.exists() else None,
        "transcript_json": str(json_path) if json_path.exists() else None,
        "transcript_srt": str(srt_path) if srt_path.exists() else None,
        "extracted_wav": str(wav_path) if args.keep_wav and wav_path.exists() else None,
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    stage_log("done", f"txt: {summary['outputs']['transcript_txt']}")
    stage_log("done", f"json: {summary['outputs']['transcript_json']}")
    stage_log("done", f"srt: {summary['outputs']['transcript_srt']}")
    stage_log("done", f"summary: {summary_path}")
    if speed_multiplier:
        stage_log("done", f"transcription speed: {speed_multiplier:.2f}x realtime")

    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        sys.exit(1)
