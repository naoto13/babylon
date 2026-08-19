---
name: image-to-3d-asset-spar3d
description: >
  【明示コマンド専用 — 自動発火しない】/image-to-3d-asset-spar3d で実行されたときだけ使う。
  参照画像から SPAR3D (ローカル・Apple Silicon/MPS) でテクスチャ付き glb を生成し、
  検証・減量・配置まで行うパイプライン。3D生成の話題が出ただけでは発火せず、
  ユーザーがこのコマンドを打つか経路名を名指しした場合のみ使用する。
disable-model-invocation: true
argument-hint: '[生成したいアセットの説明 or 参照画像パス]'
---

# image→3D (SPAR3D 経路)

参照画像1枚からテクスチャ付き glb を作りアプリへ入れる。Apple Silicon Mac (統合メモリ24GB+)
で動くローカル経路。**成果物の品質は参照画像でほぼ決まる** — 時間配分は参照画像づくりに厚く。

他経路: 手続きコードモデリングは `/image-to-3d-asset-threejs`、Windows/NVIDIA マシンでは
`/image-to-3d-asset-trellis2` を使う。

## 全体フロー

```text
① 参照画像 (AI生成 or 手持ち)  → 透過PNG・3/4ビュー・単一オブジェクト
② SPAR3D で glb 生成           → tools/spar3d/ (venv+repo)
③ 検証                          → tools/asset-pipeline/check-glb.mjs
④ 必要なら減量                  → gltfpack (小物1MB以下/主役級3MB以下)
⑤ アプリへ配置                  → config駆動 + フォールバック (integration.md)
```

共通スクリプトはリポジトリの `tools/asset-pipeline/` にある:

- `gen-ref-image.sh <out.png> "<対象説明>" ["<共通様式>"]` — gen-image スキル定型で参照画像生成。
  同一シーンのアセットは共通様式文言を全アセットで共有する(様式が揺れると場が壊れる)
- `check-glb.mjs <glb>` — 頂点数/属性/テクスチャ/bbox/充填率の機械検証。生成直後に必ず実行
- `spar3d-batch.sh` — 複数体の直列バッチ (`SPAR3D_ROOT= REFS= MODELS= TEXRES=` を指定)
- `integration.md` — アプリ配置 (config駆動・フォールバック・マテリアル分岐) の詳細

## 参照画像の定型 (要点)

単一オブジェクト・画面中央・**斜め45度の3/4ビュー**・完全透過PNG・均一で柔らかい照明・
文字/ロゴ/人物なし。細い開放構造 (リング・格子・鎖) は苦手 — 骨組みを太くデフォルメする。
正面のみの画像は板状に崩れる。

定型の理由付き詳細・向く/向かない対象・落とし穴6件・gltfpack 減量実測は
`references/pipeline-details.md`。

## 生成と検証

```bash
SPAR3D_ROOT=<repo>/tools/spar3d REFS=<refs dir> MODELS=<配置先> TEXRES=1024 \
  tools/asset-pipeline/spar3d-batch.sh name.png:name ...
node tools/asset-pipeline/check-glb.mjs <配置先>/name.glb
```

- テクスチャ解像度: 主役級 1024 / 小物 512
- 検証で見る: TEXCOORD_0+images あり / 頂点10万超なら減量 / bbox 扁平=板状崩れ /
  充填率で開放構造の潰れ検出 (骨組み意図で45%超なら塊化している)
- **キャラの姿勢**: SPAR3D は参照画像の「見た目の正面」を +Z に置くため縦長キャラは横倒しで
  出る。ゲーム側の rotX/rotY 補正 (asset-config) で立てる。姿勢判定は俯瞰でなく真横アングルで

## セットアップ (無い/壊れた場合)

`references/spar3d-setup.md` 参照。実測で踏んだ追加の罠:

- venv/repo は worktree 削除で消えることがある (ラッパーだけ残る)。`tools/spar3d/venv/bin/python`
  と `repo/run.py` の実在を最初に確認
- requirements.txt は **repo 内から**実行 (./texture_baker が相対パス)
- AlphaCLIP は build isolation で失敗し全体を中断させる → `--no-build-isolation` で単独インストール、
  `loralib` も別途必要
- transparent_background の GUI import が新 flet で死ぬ → `__init__.py` の gui import を try/except 化
- クラウド代替 (形状のみ・テクスチャなし) は `references/cloud-fallback.md`

## 量産のコツ

参照画像生成は並列可、3D生成は直列 (同一GPU)。失敗した個体だけ後でまとめて再生成。
glb と参照画像はセットでリポジトリに入れる。
