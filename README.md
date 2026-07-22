# Babylon.js Game Concept Atlas

Babylon.jsで制作するブラウザゲーム12案を、生成したゲーム画面と一緒に比較する静的HTMLです。

## 閲覧方法

`index.html`を直接開くか、プロジェクトルートで次を実行します。

```bash
python3 -m http.server 4173
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

- `chrono-arena/index.html`: 60秒戦闘、時間停止アップグレード、結果画面
- `chrono-arena/SPEC.md`: クロノ・アリーナのMVP仕様
- `moonlit-potion-workshop/index.html`: 注文、素材選択、温度・加工、鑑定結果
- `moonlit-potion-workshop/SPEC.md`: 月夜のポーション工房のMVP仕様
