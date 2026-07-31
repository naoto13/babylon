#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export HF_HUB_DISABLE_XET=1
exec ./venv/Scripts/python.exe ComfyUI/main.py --listen 127.0.0.1 --port 8188
