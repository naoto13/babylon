#!/usr/bin/env bash
# SPAR3D で参照画像から テクスチャ付き glb を生成する（Chrono Arena 用ラッパー）。
#
#   scripts/spar3d-run.sh <出力ディレクトリ> <参照画像.png> [参照画像2.png ...]
#
# 複数画像を渡すとモデルのロードが1回で済むぶん速い。生成物は入力の
# ファイル名（拡張子なし）を使って <出力ディレクトリ>/<name>.glb へ配置する。
# SPAR3D 素の出力ツリー（<出力ディレクトリ>/<index>/{mesh.glb,input.png,points.ply}）も残す。
#
# 環境変数:
#   TEXRES  テクスチャアトラス解像度（既定 1024。小物なら 512 で十分）
#
# 上位ラッパー tools/spar3d/run-spar3d.sh は引数2個固定で --texture-resolution を
# 渡せないため、ここでは run.py を直接呼ぶ。
set -euo pipefail

SPAR3D_DIR="${SPAR3D_DIR:-/Users/ny/orca/workspaces/57_babylon/magic/tools/spar3d}"
REPO_DIR="$SPAR3D_DIR/repo"
VENV_DIR="$SPAR3D_DIR/venv"
TEXRES="${TEXRES:-1024}"

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <output_dir> <image.png> [image2.png ...]" >&2
  exit 64
fi

[[ -x "$VENV_DIR/bin/python" ]] || { echo "SPAR3D venv がない: $VENV_DIR" >&2; exit 1; }
[[ -d "$REPO_DIR" ]] || { echo "SPAR3D repo がない: $REPO_DIR" >&2; exit 1; }

abspath() { [[ "$1" = /* ]] && echo "$1" || echo "$PWD/$1"; }

OUTPUT_DIR="$(abspath "$1")"; shift
mkdir -p "$OUTPUT_DIR"

INPUTS=()
NAMES=()
for img in "$@"; do
  p="$(abspath "$img")"
  [[ -s "$p" ]] || { echo "入力画像がない: $p" >&2; exit 1; }
  INPUTS+=("$p")
  NAMES+=("$(basename "${p%.*}")")
done

export PYTORCH_ENABLE_MPS_FALLBACK=1
export HF_HOME="$SPAR3D_DIR/hf-cache"
unset SPAR3D_LOW_VRAM

if [[ -f /tmp/hf_token ]]; then
  token_mode="$(stat -f '%Lp' /tmp/hf_token)"
  if [[ "$token_mode" != "400" && "$token_mode" != "600" ]]; then
    echo "/tmp/hf_token のパーミッションは 0400 か 0600 にする" >&2
    exit 1
  fi
  export HF_TOKEN="$(< /tmp/hf_token)"
fi

# ビルド済みネイティブ拡張が壊れていないか先に確認する（CPU カーネル未登録だと
# UV 展開の直前まで走ってから落ちるので、事前に弾く）
"$VENV_DIR/bin/python" - <<'PY'
import sys, torch
if not torch.backends.mps.is_available():
    sys.exit("MPS が見えない環境。この環境では SPAR3D を実行しない")
import uv_unwrapper  # noqa: F401
dump = torch._C._dispatch_dump("UVUnwrapper::assign_faces_uv_to_atlas_index")
if "CPU:" not in dump:
    sys.exit("uv_unwrapper の CPU カーネルが未登録。クリーンビルドが必要")
PY

cd "$REPO_DIR"
"$VENV_DIR/bin/python" run.py "${INPUTS[@]}" \
  --output-dir "$OUTPUT_DIR" \
  --device mps \
  --texture-resolution "$TEXRES"

# 素の index ツリーから名前付きへコピーする
for i in "${!NAMES[@]}"; do
  src="$OUTPUT_DIR/$i/mesh.glb"
  dst="$OUTPUT_DIR/${NAMES[$i]}.glb"
  if [[ -s "$src" ]]; then
    cp -f "$src" "$dst"
    echo "生成: $dst"
  else
    echo "⚠️  ${NAMES[$i]} の出力が見つからない: $src" >&2
  fi
done

# 同一内容の取り違え検出（バッチ時に同じ glb が複数出ていないか）
shasum "$OUTPUT_DIR"/*.glb 2>/dev/null | awk '{c[$1]=c[$1]" "$2} END {for (h in c) {n=split(c[h],a," "); if (n>1) print "⚠️  内容が同一:" c[h]}}'
