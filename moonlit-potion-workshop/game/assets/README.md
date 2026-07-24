# GLB ヒーローアセット

このゲームは釜と 8 種の工房プロップを個別の GLB として差し替えられます。各ファイルは独立して読み込まれ、存在しない・壊れている・loader を取得できない場合は、そのプロップだけが手続き生成メッシュのまま残ります。ゲーム操作を止めるエラー表示は出しません。

## ファイル名

既存の釜は `models/cauldron.glb`、追加プロップは次の 8 ファイルです。すべて `game/assets/models/` に置いてください。

| プロップ | ファイル名 | 未読込時の動作 |
| --- | --- | --- |
| まな板 | `cutting-board.glb` | 手続き生成のまな板を使用 |
| ナイフ | `knife.glb` | 手続き生成のナイフを使用 |
| 乳鉢 | `mortar.glb` | 手続き生成の乳鉢を使用 |
| 乳棒 | `pestle.glb` | 手続き生成の乳棒を使用 |
| 火加減ダイヤル | `heat-dial.glb` | 手続き生成のダイヤルを使用 |
| 鑑定レンズ | `appraisal-lens.glb` | 手続き生成のレンズを使用 |
| 納品トレイ | `delivery-tray.glb` | 手続き生成のトレイを使用 |
| 素材 jar（8 個で共有） | `jar.glb` | 素材ごとの手続き生成 jar を使用 |

`jar.glb` は 1 ファイルを 8 個の棚スロットへ複製します。jar の名前ラベル、ドラッグ、前処理、注ぐ角度、棚へのリセットはゲーム側で管理されます。GLB にゲーム固有の名前やノード構成は必要ありません。

## 作成の目安

Meshy または Tripo の Image to 3D を使う場合は、PBR をオン、テクスチャは 1K–2K、可能ならクアッド化またはリメッシュを有効にしてください。釜は上面を開け、液面が見える形にします。

ゲームディレクトリ（`game/`）から釜の参照画像は `../assets/refs/cauldron-ref-*.png` です。この README からは `../../assets/refs/cauldron-ref-*.png` になります。

量子化だけを行う場合は次を使えます。

```sh
pnpm dlx gltfpack -i input.glb -o output.glb
```

`-cc` や KTX2 はデコーダ依存を増やすため任意です。静的配信のまま読み込めることを優先するなら、先に量子化のみで確認してください。

## 容量予算

- `cauldron.glb`: **3MB 以下**
- 8 つの小プロップ: **各 1MB 以下**
- `models/` フォルダ全体: **10MB 以下**

```sh
ls -lh game/assets/models
du -sh game/assets/models
```

## テスト用プレースホルダー

AI モデルの準備前は、依存なしのプレースホルダーを生成できます。`game/` で実行してください。

```sh
node tools/make-placeholder-glbs.mjs
```

box / cylinder / cone の色付き GLB を 8 プロップ分作成します。`cauldron.glb` を含め、すでにあるファイルは既定で必ずスキップするため、実モデルを上書きしません。意図して置き換える場合だけ `--force` を付けます。

```sh
node tools/make-placeholder-glbs.mjs --force
```
