#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <input.png> <output_dir>" >&2
  exit 64
fi

SPAR3D_DIR="/Users/ny/orca/workspaces/57_babylon/magic/tools/spar3d"
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
export HF_HOME="/Users/ny/orca/workspaces/57_babylon/magic/tools/spar3d/hf-cache"
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
