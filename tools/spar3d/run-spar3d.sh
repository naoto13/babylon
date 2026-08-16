#!/usr/bin/env bash
# 【非推奨】Mac (Apple Silicon / MPS) 専用の SPAR3D 実行ラッパー。
# SPAR3D は精度限界のため非推奨。現行のアセット生成は windows-image-to-3d スキル
# （専用 Windows/NVIDIA 機の TRELLIS.2/ComfyUI）を使うこと。
# 経緯の詳細: docs/asset-pipeline-history.html
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <input.png> <output_dir>" >&2
  exit 64
fi

SPAR3D_DIR="${SPAR3D_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
REPO_DIR="$SPAR3D_DIR/repo"
VENV_DIR="$SPAR3D_DIR/venv"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "SPAR3D virtual environment is missing: $VENV_DIR" >&2
  exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "SPAR3D repository is missing: $REPO_DIR" >&2
  exit 1
fi

if [[ "$1" = /* ]]; then
  INPUT_PATH="$1"
else
  INPUT_PATH="$PWD/$1"
fi

if [[ "$2" = /* ]]; then
  OUTPUT_DIR="$2"
else
  OUTPUT_DIR="$PWD/$2"
fi
export PYTORCH_ENABLE_MPS_FALLBACK=1
export HF_HOME="$SPAR3D_DIR/hf-cache"
unset SPAR3D_LOW_VRAM

if [[ -f /tmp/hf_token ]]; then
  token_mode="$(stat -f '%Lp' /tmp/hf_token)"
  if [[ "$token_mode" != "400" && "$token_mode" != "600" ]]; then
    echo "/tmp/hf_token must have permissions 0400 or 0600" >&2
    exit 1
  fi
  export HF_TOKEN="$(< /tmp/hf_token)"
fi

mkdir -p "$HF_HOME" "$OUTPUT_DIR"
source "$VENV_DIR/bin/activate"
cd "$REPO_DIR"

exec python run.py "$INPUT_PATH" --output-dir "$OUTPUT_DIR" --device mps
