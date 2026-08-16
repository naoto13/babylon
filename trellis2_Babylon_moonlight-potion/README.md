# 月夜のポーション工房 (Moonlit Potion Workshop)

客の言葉と持ち込まれた素材から目的を推理し、手作業で一瓶を調合する一人称クラフトシミュレーター。ブラウザで動作します。詳細な仕様は `SPEC.md` を参照してください。

## 使用技術

- **ゲームエンジン**: [Babylon.js](https://www.babylonjs.com/)（CDN 読み込み: `babylon.js` / `loaders` / `materialsLibrary`）
- **言語**: Vanilla JavaScript（ES Modules）。ビルドツールなしの静的配信で動作
- **3D アセット生成**: 参照画像（組み込み Image Gen で生成、`assets/refs/`）を入力に、ローカルの TRELLIS.2（ComfyUI, FP8 量子化）で image-to-3D → GLB 出力
- **アセット圧縮**: gltfpack で量子化・容量予算まで削減（手順と予算は `game/assets/README.md` を参照）
- **テスト**: Node.js 標準の `node:test`（`game/test/*.test.mjs`）

## ドキュメント

- `SPEC.md` — ゲーム仕様
- `ASSET_PROMPTS.md` — 画像アセットの生成プロンプト
- `game/assets/README.md` — GLB アセットの生成・圧縮・差し替え手順
