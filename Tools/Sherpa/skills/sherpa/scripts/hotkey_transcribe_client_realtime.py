
import json
import os
import subprocess
import threading
import time
import uuid
import ctypes
from pathlib import Path
import keyboard
import numpy as np
import pystray
import sounddevice as sd
import soundfile as sf
import tkinter as tk
from PIL import Image, ImageDraw


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


def make_logger(root: Path):
    log_dir = root / ".ai-data" / "sherpa-onnx" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "hotkey_realtime.log"

    def log(message: str) -> None:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] {message}"
        print(line, flush=True)
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    return log, log_path


class Overlay:
    def __init__(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.92)
        self.root.configure(bg="#111111")
        self.frame = tk.Frame(self.root, bg="#111111", padx=18, pady=14)
        self.frame.pack()
        self.status_var = tk.StringVar(value="Sherpa Ready")
        self.detail_var = tk.StringVar(value="Hold Ctrl+` to record")
        self.meta_var = tk.StringVar(value="")
        self.subtitle_var = tk.StringVar(value="")
        tk.Label(self.frame, textvariable=self.status_var, bg="#111111", fg="#f5f5f5", font=("Segoe UI Semibold", 16)).pack(anchor="w")
        tk.Label(self.frame, textvariable=self.detail_var, bg="#111111", fg="#b6c2cf", font=("Segoe UI", 10)).pack(anchor="w", pady=(6, 0))
        tk.Label(self.frame, textvariable=self.meta_var, bg="#111111", fg="#7f8c98", font=("Consolas", 10)).pack(anchor="w", pady=(6, 2))
        # 实时字幕区域
        tk.Label(self.frame, textvariable=self.subtitle_var, bg="#111111", fg="#e6f7ff", font=("Segoe UI", 12), wraplength=500, justify="left").pack(anchor="w", pady=(8, 0))
        self.meter = tk.Canvas(self.frame, width=260, height=10, bg="#1b1b1b", highlightthickness=0)
        self.meter.pack(anchor="w", pady=(2, 0))
        self.meter_fill = self.meter.create_rectangle(0, 0, 0, 10, fill="#43c463", width=0)
        self.hide_job = None
        self.root.after(0, self._position)

    def _position(self):
        self.root.update_idletasks()
        width = self.root.winfo_reqwidth()
        self.root.geometry(f"+{self.root.winfo_screenwidth() - width - 28}+28")

    def show(self, status: str, detail: str = "", meta: str = "", subtitle: str = "", level: float = 0.0, auto_hide_ms: int | None = None):
        self.status_var.set(status)
        self.detail_var.set(detail)
        self.meta_var.set(meta)
        self.subtitle_var.set(subtitle)
        width = max(0, min(260, int(260 * level)))
        self.meter.coords(self.meter_fill, 0, 0, width, 10)
        if level > 0.75:
            color = "#ff6b57"
        elif level > 0.35:
            color = "#f3c13a"
        else:
            color = "#43c463"
        self.meter.itemconfig(self.meter_fill, fill=color)
        self._position()
        self.root.deiconify()
        self.root.lift()
        if self.hide_job:
            self.root.after_cancel(self.hide_job)
            self.hide_job = None
        if auto_hide_ms:
            self.hide_job = self.root.after(auto_hide_ms, self.hide)

    def hide(self):
        self.root.withdraw()
        self.hide_job = None

    def run(self):
        self.root.mainloop()

    def stop(self):
        self.root.after(0, self.root.destroy)


class MicRecorder:
    def __init__(self, env: dict):
        self.sample_rate = int(env.get("AI_AUTO_TRANSLATE_MIC_SAMPLE_RATE", "16000"))
        self.device = self._resolve_device(env.get("AI_AUTO_TRANSLATE_MIC_DEVICE", "").strip())
        self.channels = 1
        self.frames = []
        self.stream = None
        self.recording = False
        self.started_at = None
        self.current_level = 0.0

    def _resolve_device(self, configured: str):
        if configured:
            try:
                return int(configured)
            except ValueError:
                for index, item in enumerate(sd.query_devices()):
                    if configured.lower() in item["name"].lower() and item["max_input_channels"] > 0:
                        return index
        default_input = sd.default.device[0]
        return None if default_input in (-1, None) else int(default_input)

    def start(self) -> None:
        self.frames = []
        self.current_level = 0.0
        self.started_at = time.perf_counter()

        def callback(indata, frames, time_info, status):
            if status:
                print(f"[hotkey] audio status: {status}")
            self.frames.append(indata.copy())
            peak = float(np.max(np.abs(indata))) if len(indata) else 0.0
            self.current_level = max(0.0, min(1.0, peak * 4.0))

        self.stream = sd.InputStream(
            samplerate=self.sample_rate,
            device=self.device,
            channels=self.channels,
            dtype="float32",
            callback=callback,
        )
        self.stream.start()
        self.recording = True

    def get_audio_so_far(self) -> np.ndarray:
        """获取目前为止的所有音频数据"""
        if not self.frames:
            return np.array([])
        return np.concatenate(self.frames, axis=0)

    def stop(self, output_path: Path) -> float:
        if not self.stream:
            raise RuntimeError("Recorder is not running.")
        self.stream.stop()
        self.stream.close()
        self.stream = None
        self.recording = False
        self.current_level = 0.0
        if not self.frames:
            raise RuntimeError("No microphone frames captured.")
        audio = np.concatenate(self.frames, axis=0)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), audio, self.sample_rate)
        return len(audio) / float(self.sample_rate)

    def shutdown(self) -> None:
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None
        self.recording = False
        self.current_level = 0.0

    def elapsed_seconds(self) -> float:
        if not self.recording or self.started_at is None:
            return 0.0
        return max(0.0, time.perf_counter() - self.started_at)


def copy_to_clipboard(text: str) -> None:
    root = tk.Tk()
    root.withdraw()
    root.clipboard_clear()
    root.clipboard_append(text)
    root.update()
    root.destroy()


def get_foreground_window() -> int:
    return ctypes.windll.user32.GetForegroundWindow()


def restore_foreground_window(hwnd: int) -> None:
    if not hwnd:
        return
    ctypes.windll.user32.ShowWindow(hwnd, 5)
    ctypes.windll.user32.SetForegroundWindow(hwnd)


def input_to_focused_control(text: str, hwnd: int | None = None) -> None:
    if not text:
        return
    copy_to_clipboard(text)
    if hwnd:
        time.sleep(0.08)
        restore_foreground_window(hwnd)
    time.sleep(0.08)
    try:
        keyboard.write(text, delay=0, exact=True)
    except Exception:
        keyboard.send("ctrl+v")


def resolve_venv_python(root: Path, env: dict) -> str:
    configured_venv = env.get("AI_AUTO_TRANSLATE_SHERPA_VENV", ".ai-data/tools/sherpa-onnx/venv")
    venv_root = Path(configured_venv)
    if not venv_root.is_absolute():
        venv_root = (root / venv_root).resolve()
    venv_python = venv_root / "Scripts" / "python.exe"
    return str(venv_python) if venv_python.exists() else "python"


def transcribe_file(root: Path, env: dict, wav_path: Path, provider: str | None = None) -> tuple[str, str]:
    python_exe = resolve_venv_python(root, env)
    script_path = root / "skills" / "sherpa" / "scripts" / "transcribe_local_media_sherpa.py"
    job_id = "mic-" + uuid.uuid4().hex
    output_dir = root / ".ai-data" / "sherpa-onnx" / "runs" / job_id
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(
        [
            python_exe,
            str(script_path),
            "--input",
            str(wav_path),
            "--job-id",
            job_id,
            "--output-dir",
            str(output_dir),
            "--provider",
            provider or env.get("AI_AUTO_TRANSLATE_SHERPA_PROVIDER", "cpu"),
        ],
        capture_output=True,
        text=True,
        creationflags=creationflags,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "transcription failed")
    summary = json.loads((output_dir / "run-summary.json").read_text(encoding="utf-8"))
    transcript_path = Path(summary["artifacts"]["transcript_txt"])
    transcript_text = transcript_path.read_text(encoding="utf-8").strip() if transcript_path.exists() else ""
    # 清理临时文件
    import shutil
    shutil.rmtree(output_dir, ignore_errors=True)
    return transcript_text, str(transcript_path)


def create_tray_icon(stop_event: threading.Event, overlay: Overlay):
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((8, 8, 56, 56), fill=(30, 30, 30, 255))
    draw.rounded_rectangle((26, 16, 38, 38), radius=5, fill=(245, 245, 245, 255))
    draw.rectangle((22, 38, 42, 44), fill=(245, 245, 245, 255))
    draw.rectangle((30, 44, 34, 52), fill=(245, 245, 245, 255))
    draw.rectangle((24, 52, 40, 55), fill=(245, 245, 245, 255))

    def on_quit(icon, item):
        stop_event.set()
        overlay.stop()
        icon.stop()

    return pystray.Icon("sherpa-local-transcribe", image, "Sherpa Local Transcribe", pystray.Menu(pystray.MenuItem("Quit", on_quit)))


def get_text_diff(old: str, new: str) -> tuple[int, str]:
    common_prefix_len = 0
    max_len = min(len(old), len(new))
    while common_prefix_len < max_len and old[common_prefix_len] == new[common_prefix_len]:
        common_prefix_len += 1
    return len(old) - common_prefix_len, new[common_prefix_len:]


def main() -> int:
    root = repo_root()
    env = load_env(root)
    log, log_path = make_logger(root)
    recorder = MicRecorder(env)
    overlay = Overlay()
    stop_event = threading.Event()
    state = {
        "busy": False,
        "trigger_down": False,
        "target_hwnd": 0,
        "last_recognized": "",
        "last_recognized_time": 0,
        "recognition_lock": threading.Lock(),
        "input_text": "",
        "recognition_inflight": False,
        "last_preview_samples": 0,
        "hotkey_blocked": False,
    }
    preview_interval_sec = float(env.get("AI_AUTO_TRANSLATE_REALTIME_INTERVAL_SEC", "0.9"))
    preview_min_audio_sec = float(env.get("AI_AUTO_TRANSLATE_REALTIME_MIN_AUDIO_SEC", "0.5"))
    preview_min_delta_sec = float(env.get("AI_AUTO_TRANSLATE_REALTIME_MIN_DELTA_SEC", "0.45"))
    provider = env.get("AI_AUTO_TRANSLATE_SHERPA_PROVIDER", "cpu")
    hotkey = env.get("AI_AUTO_TRANSLATE_HOTKEY", "ctrl+`")
    hotkey_mode = env.get("AI_AUTO_TRANSLATE_HOTKEY_MODE", "toggle").strip().lower()
    if hotkey_mode not in {"toggle", "hold"}:
        hotkey_mode = "toggle"
    hotkey_parts = [part.strip().lower() for part in hotkey.split("+") if part.strip()]
    hotkey_main_key = hotkey_parts[-1] if hotkey_parts else "`"
    hotkey_modifiers = hotkey_parts[:-1]

    def overlay_call(status: str, detail: str = "", meta: str = "", subtitle: str = "", level: float = 0.0, auto_hide_ms: int | None = None):
        overlay.root.after(0, lambda: overlay.show(status, detail, meta, subtitle, level, auto_hide_ms))

    def incremental_recognize():
        """增量识别当前已录制的音频"""
        if not recorder.recording or state["busy"]:
            return

        with state["recognition_lock"]:
            if state["recognition_inflight"]:
                return
            if time.time() - state["last_recognized_time"] < preview_interval_sec:
                return
            state["recognition_inflight"] = True

        audio = recorder.get_audio_so_far()
        if len(audio) < recorder.sample_rate * preview_min_audio_sec:
            state["recognition_inflight"] = False
            return
        if (len(audio) - state["last_preview_samples"]) < recorder.sample_rate * preview_min_delta_sec:
            state["recognition_inflight"] = False
            return

        # 保存临时音频文件
        temp_dir = root / ".ai-data" / "sherpa-onnx" / "temp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_wav = temp_dir / f"realtime-{uuid.uuid4().hex}.wav"
        try:
            sf.write(str(temp_wav), audio, recorder.sample_rate)
            state["last_recognized_time"] = time.time()
            state["last_preview_samples"] = len(audio)
            transcript_text, _ = transcribe_file(root, env, temp_wav, provider=provider)

            if transcript_text and transcript_text != state["last_recognized"]:
                log(f"preview old={state['last_recognized']!r} new={transcript_text!r}")
                overlay_call(
                    "Recording",
                    "Press hotkey again to finalize" if hotkey_mode == "toggle" else "Release hotkey to finalize",
                    f"Preview | {provider.upper()}",
                    transcript_text,
                    recorder.current_level
                )
                state["last_recognized"] = transcript_text

        except Exception as e:
            log(f"recognition error: {e}")
        finally:
            if temp_wav.exists():
                temp_wav.unlink()
            state["recognition_inflight"] = False

    def start_recording():
        if state["trigger_down"] or state["busy"] or recorder.recording:
            return
        state["trigger_down"] = True
        state["target_hwnd"] = get_foreground_window()
        state["last_recognized"] = ""
        state["last_recognized_time"] = 0
        state["last_preview_samples"] = 0
        state["input_text"] = ""
        try:
            if not state["hotkey_blocked"]:
                keyboard.block_key(hotkey_main_key)
                state["hotkey_blocked"] = True
            recorder.start()
            log(f"recording start mode={hotkey_mode} hotkey={hotkey} hwnd={state['target_hwnd']}")
            hint = "Press hotkey again to finalize" if hotkey_mode == "toggle" else "Release hotkey to finalize"
            overlay_call("Recording", hint, f"00:00.0 | {provider.upper()}", "", recorder.current_level)
        except Exception as exc:
            state["trigger_down"] = False
            if state["hotkey_blocked"]:
                try:
                    keyboard.unblock_key(hotkey_main_key)
                except KeyError:
                    pass
                state["hotkey_blocked"] = False
            log(f"mic error: {exc}")
            overlay_call("Mic Error", str(exc), "", 0.0, 2600)

    def finalize_recording():
        if not state["trigger_down"] or not recorder.recording:
            return
        state["trigger_down"] = False
        if state["busy"]:
            return
        if state["hotkey_blocked"]:
            try:
                keyboard.unblock_key(hotkey_main_key)
            except KeyError:
                pass
            state["hotkey_blocked"] = False
        state["busy"] = True
        log("recording finalize requested")
        threading.Thread(target=stop_and_transcribe, daemon=True).start()

    def stop_and_transcribe():
        capture_dir = root / ".ai-data" / "sherpa-onnx" / "captures"
        wav_path = capture_dir / f"mic-{uuid.uuid4().hex}.wav"
        try:
            duration = recorder.stop(wav_path)
            log(f"recording stopped duration={duration:.2f}s")
            if duration < 0.2:
                overlay_call("Too Short", "Hold the hotkey a little longer", "", 0.0, 1800)
                return
            overlay_call("Finalizing", f"{duration:.2f}s captured", f"full pass | {provider.upper()}", subtitle=state["last_recognized"], level=0.0)
            transcript_text, transcript_path = transcribe_file(root, env, wav_path, provider=provider)
            if transcript_text:
                log(f"final transcript={transcript_text!r}")
                input_to_focused_control(transcript_text, state["target_hwnd"])
                overlay_call("Inserted", transcript_text[:72], transcript_path, 0.0, 2200)
            else:
                overlay_call("No Text", transcript_path, "", 0.0, 2200)
        except Exception as exc:
            overlay_call("Error", str(exc), "", 0.0, 3200)
        finally:
            if wav_path.exists():
                wav_path.unlink()
            if state["hotkey_blocked"]:
                try:
                    keyboard.unblock_key(hotkey_main_key)
                except KeyError:
                    pass
                state["hotkey_blocked"] = False
            state["busy"] = False
            state["last_recognized"] = ""
            state["last_recognized_time"] = 0
            state["last_preview_samples"] = 0
            state["input_text"] = ""
            # 隐藏录制窗口
            overlay.root.after(0, overlay.hide)

    def on_hotkey_toggle():
        log(f"hotkey toggle pressed hotkey={hotkey}")
        if recorder.recording:
            finalize_recording()
        else:
            start_recording()

    def modifiers_pressed() -> bool:
        for modifier in hotkey_modifiers:
            if modifier == "ctrl" and not keyboard.is_pressed("ctrl"):
                return False
            if modifier == "shift" and not keyboard.is_pressed("shift"):
                return False
            if modifier == "alt" and not keyboard.is_pressed("alt"):
                return False
            if modifier == "win" and not (keyboard.is_pressed("left windows") or keyboard.is_pressed("right windows") or keyboard.is_pressed("windows")):
                return False
        return True

    def on_hold_press():
        log(f"hold hotkey pressed hotkey={hotkey}")
        if modifiers_pressed():
            start_recording()

    def on_hold_release(event=None):
        key_name = getattr(event, "name", hotkey_main_key)
        log(f"hold release key={key_name}")
        finalize_recording()

    if hotkey_mode == "toggle":
        keyboard.add_hotkey(hotkey, on_hotkey_toggle, suppress=True, trigger_on_release=True)
    else:
        keyboard.add_hotkey(hotkey, on_hold_press, suppress=True, trigger_on_release=False)
        keyboard.on_release_key(hotkey_main_key, on_hold_release, suppress=False)
        for modifier in hotkey_modifiers:
            if modifier in {"ctrl", "shift", "alt"}:
                keyboard.on_release_key(modifier, on_hold_release, suppress=False)

    threading.Thread(target=create_tray_icon(stop_event, overlay).run, daemon=True).start()
    ready_detail = f"{hotkey} start/stop" if hotkey_mode == "toggle" else f"Hold {hotkey} to record"
    overlay_call("Ready", ready_detail, f"SenseVoice realtime preview | {provider.upper()} | {log_path.name}", 0.0, 1800)
    log(f"client ready mode={hotkey_mode} hotkey={hotkey} provider={provider} log={log_path}")

    def recording_poll():
        if recorder.recording:
            elapsed = recorder.elapsed_seconds()
            minutes = int(elapsed // 60)
            seconds = elapsed - minutes * 60
            hint = "Press hotkey again to finalize" if hotkey_mode == "toggle" else "Release hotkey to finalize"
            overlay_call(
                "Recording",
                hint,
                f"{minutes:02d}:{seconds:04.1f}",
                state["last_recognized"],
                recorder.current_level,
            )
            # 触发增量识别
            threading.Thread(target=incremental_recognize, daemon=True).start()
        overlay.root.after(80, recording_poll)

    def stop_poll():
        if stop_event.is_set():
            try:
                recorder.shutdown()
            finally:
                overlay.root.quit()
            return
        overlay.root.after(250, stop_poll)

    overlay.root.after(250, stop_poll)
    overlay.root.after(80, recording_poll)
    overlay.run()
    recorder.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
