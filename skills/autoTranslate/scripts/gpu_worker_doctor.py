#!/usr/bin/env python3

import argparse
import json
import subprocess
import sys


def run(command):
    try:
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        return {"ok": True, "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except Exception as error:
        return {"ok": False, "error": str(error)}


def main():
    parser = argparse.ArgumentParser(description="GPU worker environment doctor")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    report = {
        "python": sys.version,
        "nvidia_smi": run(["nvidia-smi"]),
        "cuda_query": run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total,cuda_version", "--format=csv,noheader"]),
        "faster_whisper_import": None,
        "ctranslate2_import": None,
    }

    try:
        import faster_whisper  # type: ignore

        report["faster_whisper_import"] = {
            "ok": True,
            "version": getattr(faster_whisper, "__version__", "unknown"),
        }
    except Exception as error:
        report["faster_whisper_import"] = {"ok": False, "error": str(error)}

    try:
        import ctranslate2  # type: ignore

        report["ctranslate2_import"] = {
            "ok": True,
            "version": getattr(ctranslate2, "__version__", "unknown"),
            "cuda_compute_types": ctranslate2.get_supported_compute_types("cuda"),
        }
    except Exception as error:
        report["ctranslate2_import"] = {"ok": False, "error": str(error)}

    print(json.dumps(report, ensure_ascii=False, indent=2))

    if args.debug and not report["ctranslate2_import"]["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
