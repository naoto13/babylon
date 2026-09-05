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

3Dアセットの作り方はスキルとして同梱しています。生成経路は、GLB生成とprocedural factoryの2系統です。

実装スキルはGLB生成2本とprocedural factory 1本の計3本で、いずれも**明示コマンド専用**（3Dの話題だけでは自動発火しない）です。

- `.claude/skills/image-to-3d-asset-trellis2/`: **現行既定**。専用 Windows/NVIDIA 機で TRELLIS.2（ComfyUI）を回して glb を生成する経路
- `.claude/skills/image-to-3d-asset-spar3d/`: Mac（Apple Silicon/MPS）の SPAR3D 経路。品質は TRELLIS.2 に劣るが Mac 内で完結する（参照画像の定型・検証・減量の詳細は `references/pipeline-details.md`）
- `.claude/skills/image-to-3d-asset-threejs/`: 参照画像からコードで手続きモデリングする経路（glb を作らない第2経路）

img2threejsの公式showcase、コミュニティ実験、Ink Tide Scoutでの実測を踏まえた用途境界と現行判断は[`docs/img2threejs-usage-findings.md`](docs/img2threejs-usage-findings.md)を参照してください。高忠実度の有機キャラクター本体には採用せず、hard-surface小物、procedural variant、runtime構造・検証補助へ限定します。

横断知見は自動発火スキルとして `glb-compression-pipeline`（gltfpack の罠）・`windows-cuda-debug`（CUDA/torch 環境デバッグ）・`asset-pipeline-history`（知見集約の運用）にあります。共通スクリプトは `tools/asset-pipeline/` に集約しています。

変遷の詳細は `docs/asset-pipeline-history.html` を参照してください。

```bash
# glb の健全性チェック（UV・テクスチャ・法線の欠落、板状の崩れ、塊化を検出）
# ※ gltfpack 圧縮前の glb 専用。圧縮後（EXT_meshopt_compression 付き）は読めないため、生成直後に実行する
node tools/asset-pipeline/check-glb.mjs trellis2_Babylon_chrono-arena/assets/production/models/chrono-duelist.glb
```

クロノ・アリーナのプレイ版はBabylon.jsをバンドルするため、次のコマンドで起動します。

```bash
cd trellis2_Babylon_chrono-arena
pnpm install
pnpm dev
```
