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

- `chrono-arena/`: Babylon.jsで動作するクロノ・アリーナのプレイアブルMVP
- `chrono-arena/README.md`: pnpmでの起動方法と操作
- `chrono-arena/SPEC.md`: クロノ・アリーナの実装状況とMVP仕様
- `moonlit-potion-workshop/index.html`: 注文、素材選択、温度・加工、鑑定結果
- `moonlit-potion-workshop/SPEC.md`: 月夜のポーション工房のMVP仕様

## Babylon.js 実装版

- `moonlit-potion-workshop/game/index.html`: 月夜のポーション工房の3D実装（MVP）。素材ドラッグ投入、まな板・乳鉢の前処理ジェスチャー、火加減ダイヤル、円ドラッグかき混ぜ、鑑定・納品・後日談、3夜12注文、保留棚、図鑑、ローカルセーブ
- 技巧システム: かき混ぜの真円度、注ぎ量ゲージの止めどころ、煮込みの秒数ぴったり停止など、プレイヤーの手の巧拙が効力・安定度・副作用へ反映される（設定「判定をやさしく」あり）
- 起動: 上記の `python3 tools/serve.py 4173` 後、`http://127.0.0.1:4173/moonlit-potion-workshop/game/` を開く（配置編集は末尾に `?layout=1`）
- ロジックの単体テスト: `node --test moonlit-potion-workshop/game/test/`

クロノ・アリーナのプレイ版はBabylon.jsをバンドルするため、次のコマンドで起動します。

```bash
cd chrono-arena
pnpm install
pnpm dev
```
