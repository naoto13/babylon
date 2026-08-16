# Babylon.js Game Concept Atlas

Babylon.jsで制作するブラウザゲーム12案を、生成したゲーム画面と一緒に比較する静的HTMLです。

## 閲覧方法

`index.html`を直接開くか、プロジェクトルートで次を実行します。

```bash
python3 tools/serve.py 4173  # no-cache ヘッダー付き（JS/アセット差し替えが即反映）
```

ブラウザで `http://127.0.0.1:4173/` を開いてください。

## 内容

- 4テーマから展開した12のゲーム案
- 各案のカメラ視点、カメラ挙動、主操作、画面設計
- コアループ、Babylon.js実装要点、MVP、主要リスク
- 視点別フィルターとゲーム画面の拡大表示
- 12枚の生成原画は `assets/game-screens/`、HTML用の軽量WebPは `assets/game-screens/web/` に保存
- 画像生成条件は `IMAGE_PROMPTS.md` に記録

## クリック型プロトタイプ

- `trellis2_Babylon_chrono-arena/`: Babylon.jsで動作するクロノ・アリーナのプレイアブルMVP
- `trellis2_Babylon_chrono-arena/README.md`: pnpmでの起動方法と操作
- `trellis2_Babylon_chrono-arena/SPEC.md`: クロノ・アリーナの実装状況とMVP仕様
- `trellis2_Babylon_moonlight-potion/index.html`: 注文、素材選択、温度・加工、鑑定結果
- `trellis2_Babylon_moonlight-potion/SPEC.md`: 月夜のポーション工房のMVP仕様

## Babylon.js 実装版

- `trellis2_Babylon_moonlight-potion/game/index.html`: 月夜のポーション工房の3D実装（MVP）。素材ドラッグ投入、まな板・乳鉢の前処理ジェスチャー、火加減ダイヤル、円ドラッグかき混ぜ、鑑定・納品・後日談、3夜12注文、保留棚、図鑑、ローカルセーブ
- 技巧システム: かき混ぜの真円度、注ぎ量ゲージの止めどころ、煮込みの秒数ぴったり停止など、プレイヤーの手の巧拙が効力・安定度・副作用へ反映される（設定「判定をやさしく」あり）
- 起動: 上記の `python3 tools/serve.py 4173` 後、`http://127.0.0.1:4173/trellis2_Babylon_moonlight-potion/game/` を開く（配置編集は末尾に `?layout=1`）
- ロジックの単体テスト: `node --test trellis2_Babylon_moonlight-potion/game/test/`

## アセット生成パイプライン

3Dアセットの作り方はスキルとして同梱しています。生成経路は二本立てです。

- `.claude/skills/windows-image-to-3d/`: **現行既定**。専用 Windows/NVIDIA 機で TRELLIS.2（ComfyUI）を回して glb を生成する経路
- `.claude/skills/mac-image-to-3d/`: **非推奨**。Mac では TRELLIS.2 がメモリ要件で動かず SPAR3D しか選べないため、精度限界で旧経路扱い（参照画像の作り方、glb の検証・減量、Babylon.js への組み込みの各工程は生成器非依存で現役）

変遷の詳細は `docs/asset-pipeline-history.html` を参照してください。

```bash
# glb の健全性チェック（UV・テクスチャ・法線の欠落、板状の崩れ、塊化を検出）
# ※ gltfpack 圧縮前の glb 専用。圧縮後（EXT_meshopt_compression 付き）は読めないため、生成直後に実行する
node tools/check-glb.mjs trellis2_Babylon_chrono-arena/assets/production/models/chrono-duelist.glb
```

クロノ・アリーナのプレイ版はBabylon.jsをバンドルするため、次のコマンドで起動します。

```bash
cd trellis2_Babylon_chrono-arena
pnpm install
pnpm dev
```
