#!/bin/bash
# 参照画像をまとめて3D化し、成果物を配置先へコピーする。
#
#   SPAR3D_ROOT=<...> REFS=<...> MODELS=<...> spar3d-batch.sh <ref.png:出力名> [...]
#
# 例:
#   SPAR3D_ROOT=~/proj/tools/spar3d REFS=~/proj/assets/refs MODELS=~/proj/game/assets/models \
#     spar3d-batch.sh lantern-ref.png:lantern books-ref.png:dress-books
#
# 環境変数:
#   TEXRES   テクスチャ解像度（既定512。主役級は1024）
#   BACKUP   既存 glb の退避先（指定時のみ退避する）
#
# 直列に回す。同一GPU/メモリを使うので並列化しても速くならず、失敗が増える。
# 1体失敗しても残りは続行し、最後に結果表を出す。
set -uo pipefail

ROOT="${SPAR3D_ROOT:?SPAR3D_ROOT を指定}"
REFS="${REFS:?REFS(参照画像ディレクトリ) を指定}"
MODELS="${MODELS:?MODELS(配置先ディレクトリ) を指定}"
TEXRES="${TEXRES:-512}"
OUT="$ROOT/output"

[ $# -gt 0 ] || { echo "usage: spar3d-batch.sh <ref.png:name> [...]" >&2; exit 2; }
mkdir -p "$MODELS" "$OUT"
[ -n "${BACKUP:-}" ] && mkdir -p "$BACKUP"

export PYTORCH_ENABLE_MPS_FALLBACK=1
export HF_HOME="$ROOT/hf-cache"
[ -f /tmp/hf_token ] && export HF_TOKEN="$(< /tmp/hf_token)"

# shellcheck disable=SC1091
source "$ROOT/venv/bin/activate"
cd "$ROOT/repo"

results=()
for pair in "$@"; do
  ref="${pair%%:*}"
  name="${pair##*:}"
  echo "=== $name (tex ${TEXRES}) ==="

  if [ ! -s "$REFS/$ref" ]; then
    echo "$name: 参照画像なし ($REFS/$ref)"
    results+=("$name: NO-REF")
    continue
  fi

  rm -rf "$OUT/batch-$name"
  python run.py "$REFS/$ref" --output-dir "$OUT/batch-$name" \
    --device mps --texture-resolution "$TEXRES" 2>&1 | tail -1

  glb="$OUT/batch-$name/0/mesh.glb"
  if [ -s "$glb" ]; then
    [ -n "${BACKUP:-}" ] && [ -f "$MODELS/$name.glb" ] && cp -f "$MODELS/$name.glb" "$BACKUP/$name.glb"
    cp -f "$glb" "$MODELS/$name.glb"
    results+=("$name: OK $(( $(stat -f '%z' "$MODELS/$name.glb" 2>/dev/null || stat -c '%s' "$MODELS/$name.glb") / 1024 ))KB")
  else
    results+=("$name: FAILED")
  fi
done

echo ""
echo "=== 結果 ==="
printf '%s\n' "${results[@]}"

# 同一バイト列が混ざっていないか（スクリプト側の取り違え事故の検出）
echo ""
echo "=== 重複チェック ==="
shasum "$MODELS"/*.glb 2>/dev/null | awk '{print $1}' | sort | uniq -d | while read -r dup; do
  echo "⚠️  同一内容の glb が複数ある:"
  shasum "$MODELS"/*.glb | grep "$dup" | awk '{print "   " $2}'
done
echo "（出力が無ければ重複なし）"
