#!/bin/bash
# image-to-3D 用の参照画像を1枚生成する（gpt-image-2 を codex 経由で使う）。
#
#   gen-ref-image.sh <出力パス.png> "<対象物の説明>" ["<共通様式>"]
#
# 例:
#   gen-ref-image.sh refs/lantern.png "真鍮の小さなランタン。ガラス窓、上部に吊り輪、装飾的な縁取り。"
#
# 共通様式を省略するとファンタジー系ハンドペイント風になる。同じシーンに並べる
# アセットでは第3引数に同じ文言を渡して統一する（様式が揺れると場が壊れる）。
#
# 【重要】必ず空の一時ディレクトリで生成してから出力先へ移す。
# codex の作業ディレクトリに既存の PNG があると、新規生成せずにそれをコピーして
# 返してくることがある（実測: 既存38枚のある refs/ に出力させたら、まったく別の
# プロンプトなのに既存画像と byte 単位で同一のものが返った）。既存シーンへ
# アセットを足す場面では必ず踏むので、この隔離は省略できない。
set -euo pipefail

OUT="${1:?出力パス(.png)を指定}"
SUBJECT="${2:?対象物の説明を指定}"
STYLE="${3:-ファンタジーRPGの3Dプロップ参照画像。少し様式化されたハンドペイント風の質感。}"

OUT_DIR="$(cd "$(dirname "$OUT")" && pwd)"
OUT_ABS="$OUT_DIR/$(basename "$OUT")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PROMPT="あなたの内蔵画像生成ツール(gpt-image-2)を使って、次の画像を新規に1枚だけ生成し、即座に ${WORK}/generated.png へ保存して終了してください。既存ファイルの流用やコピーは禁止です。サイズ近似可（正方形推奨）。試行錯誤や複数枚生成は不要です。
共通様式: ${STYLE}
単一オブジェクト（または指定の一体化した小群）のみ、画面中央、斜め45度の3/4ビュー、全体が完全に収まる。背景は完全な透明（アルファチャンネルの真の透過PNG）。均一で柔らかい照明。色付きドラマチック照明・文字・ロゴ・人物は入れない。
画像内容: ${SUBJECT}
完了したら保存先の絶対パスのみ報告してください。"

codex exec -m gpt-5.6-terra -c model_reasoning_effort=low \
  --skip-git-repo-check --cd "$WORK" "$PROMPT" </dev/null 2>&1 | tail -2

GENERATED="$WORK/generated.png"
if [ ! -s "$GENERATED" ]; then
  # 保存名が違っていても拾う
  GENERATED="$(find "$WORK" -name '*.png' -size +10k | head -1)"
fi
[ -s "${GENERATED:-}" ] || { echo "❌ 生成に失敗した" >&2; exit 1; }

mv -f "$GENERATED" "$OUT_ABS"

# 同一ディレクトリ内に同じ画像が既にないか（生成器が流用した場合の検出）
HASH="$(shasum "$OUT_ABS" | awk '{print $1}')"
DUP="$(shasum "$OUT_DIR"/*.png 2>/dev/null | awk -v h="$HASH" -v self="$OUT_ABS" '$1==h && $2!=self {print $2}')"
if [ -n "$DUP" ]; then
  echo "⚠️  既存画像と内容が同一。生成器が流用した可能性が高い:"
  echo "$DUP" | sed 's/^/     /'
  echo "     プロンプトを具体化して再実行するか、別シードで作り直すこと"
fi

python3 - "$OUT_ABS" <<'PY' 2>/dev/null || echo "生成: $OUT_ABS （Pillow が無いため透過率は未検証）"
import sys
from PIL import Image
im = Image.open(sys.argv[1])
alpha = im.getchannel("A") if im.mode == "RGBA" else None
ratio = sum(alpha.histogram()[:16]) / (im.width * im.height) if alpha else 0
print(f"生成: {sys.argv[1]} {im.size} {im.mode} 透過率 {ratio:.0%}")
if not alpha:
    print("  ⚠️  アルファなし。生成器側の背景除去に頼ることになる（輪郭がやや不正確）")
elif ratio < 0.2:
    print("  ⚠️  透過が少ない。被写体が大きすぎるか背景が残っている可能性")
PY
