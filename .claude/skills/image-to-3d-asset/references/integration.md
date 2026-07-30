# 生成した glb をアプリへ組み込む

Babylon.js を例に書くが、考え方は Three.js / Unity でも同じ。

## 設計の要点: config駆動 + 個別フォールバック

生成アセットは**作り直しが前提**なので、「ファイルを置くだけで差し替わる / 無ければ静かに元へ戻る」形にしておく。これがあると、生成のやり直しや部分的な失敗が怖くなくなる。

```js
const HERO_ASSETS = {
  cauldron: {
    path: "assets/models/cauldron.glb",
    hides: ["cauldron", "cauldron-rim"],   // 差し替え対象の手続き生成メッシュ
    size: { height: 1.15, diameter: 2.05 }, // 目標サイズ（生成器差を吸収）
    family: "iron",                          // 未テクスチャ時に当てる材質
  },
  // ...
};
```

読み込み処理でやること:

1. `ImportMeshAsync` で取り込む
2. **bbox を計測して目標サイズへ正規化**（生成器ごとにスケール基準が違うため必須）
3. アンカー用の TransformNode を作り、既存の位置・回転をそこに持たせて取り込みメッシュを子にする
4. 法線が無ければ再計算（`mesh.createNormals(true)`）— これを飛ばすと陰影がフラットになる
5. **テクスチャの有無で材質を分岐**（下記）
6. 元の手続き生成メッシュを非表示にする（削除しない。フォールバックとして残す）
7. 失敗時は `catch` して**そのアセットだけ**諦める。他は生きたまま

```js
// テクスチャ判定: 生成器がテクスチャを持たせていれば尊重、無ければプロジェクト材質を当てる
for (const mesh of meshes) {
  const m = mesh.material;
  if (m && !m.albedoTexture && !m.diffuseTexture) mesh.material = projectMaterial(family);
}
```

**同一モデルを複数配置する場合**（棚に同じ瓶を8個など）は、1つ読み込んでクローンする。8回読むのは無駄。クローンの親アンカーを既存の配置に載せ替え、元の参照マップ（ドラッグ対象など）をクローン側へ差し替える。

## UV/テクスチャの無いメッシュを見られる状態にする

形状のみの生成器（Hunyuan3D等）は `POSITION` しか持たないことがある。UV が無いので通常のテクスチャは貼れない。

**トライプラナー投影**が有効。ワールド座標を3軸から投影するので UV 不要:

```html
<script src="https://cdn.babylonjs.com/materialsLibrary/babylonjs.materials.min.js"
        onerror="window.__materialsLoadFailed=true;"></script>
```

```js
if (!window.__materialsLoadFailed && typeof BABYLON.TriPlanarMaterial === "function") {
  const mat = new BABYLON.TriPlanarMaterial("iron", scene);
  mat.diffuseTextureX = mat.diffuseTextureY = mat.diffuseTextureZ = noiseTex;
  mat.normalTextureX = mat.normalTextureY = mat.normalTextureZ = bumpTex;
  mat.tileSize = 1.25;
  mesh.material = mat;
} else {
  mesh.material = flatFallbackMaterial;  // CDN失敗時も落とさない
}
```

テクスチャ自体は `DynamicTexture` に手続き生成（固定シードのノイズで槌目・木目・石目）すれば外部アセット不要。ただし**環境によっては実行時生成の DynamicTexture が白くサンプルされる不具合**を踏んだことがある。その場合は素の色 + ジオメトリで表現する方に切り替える（ファイル読み込みの `BABYLON.Texture` は正常だった）。

## 金属アセットが真っ黒になる（PBR + IBL）

テクスチャ付き生成器の出力は `metallicFactor` が高い PBR マテリアルを持つことがある（真鍮や鉄のアセットで実測 0.9）。**金属は「周囲の映り込み」で見えるものなので、環境テクスチャ（IBL）が無いとほぼ真っ黒に描画される。** エラーは一切出ないので原因に気づきにくい。

対策のいずれか:

```js
scene.environmentTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(url, scene);
// または簡易に
scene.createDefaultEnvironment({ createSkybox: false });
// あるいは金属味を落とす
mat.metallic = 0.35; mat.roughness = 0.6;
```

暗いシーンで「アセットだけ黒い」ときは、まず `metallicFactor` と `scene.environmentTexture` を疑う。

**片面ポリゴン**: 生成物は `doubleSided: false` のことが多く、開放構造（リング・取っ手）は浅い角度で内側が抜けて見える。気になるなら `mesh.material.backFaceCulling = false`。

**量子化した glb の拡張**: `gltfpack` は `KHR_mesh_quantization`（`extensionsRequired`）と `KHR_texture_transform`（`extensionsUsed`）を付ける。前者は非対応ローダーが明示的に失敗するので気づけるが、**後者は非対応でも無言でテクスチャがズレる**。Babylon.js / three.js は両方対応。自作ローダーや古いビューアに渡すときは注意。

## スケール変更に追従させる

アセットを拡大すると、それに紐づく演出（液面ディスク、光源位置、パーティクル発生点）がズレる。**取り込み後に実測して合わせる**:

```js
// 頂点から口径を実測して液面をフィットさせる
const mouthRadius = measureRadiusAbove(meshes, centre, thresholdY);
liquid.scaling.x = liquid.scaling.y = clamp(mouthRadius * 0.88 / baseRadius, 0.35, 1);
```

順序が重要: **正規化 → 追加スケール → 実測フィット**。フィットを先にやると拡大分がズレる。

## 開発サーバはキャッシュ無効にする

`python3 -m http.server` はキャッシュ制御ヘッダを返さないため、glb や js を差し替えても「更新したのに変わらない」が頻発する。最初からこれを使う:

```python
#!/usr/bin/env python3
import http.server, sys
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()
http.server.ThreadingHTTPServer(("", int(sys.argv[1] if len(sys.argv)>1 else 4173)), NoCache).serve_forever()
```

## 手動レイアウト編集モード

生成アセットは寸法感が揃わないので、**最終的な配置は人間が触って決める**のが速い。編集モードを用意すると反復が劇的に楽になる。

設計:

- `?layout=1` のクエリで起動（通常プレイには一切影響させない）
- クリックで選択（ハイライト + 座標/回転/倍率のオーバーレイ表示）
- ドラッグで平面移動、ホイールで拡縮、キーで高さ・ヨー・ピッチ・ロール
- 変更は都度 localStorage に保存し、**通常モードでも読み込んで適用**する（編集結果がそのまま遊べる）
- 「配置をコピー」ボタンで JSON をクリップボードへ → それを config に焼き込んで恒久化
- ゲームプレイに関わるアンカー（当たり判定・ドロップ位置）は編集不可にするか、拡縮と高さのみ許可する

**焼き込み時の注意**: localStorage の値は config への**相対値**（scaleMul など）なので、config に焼き込んだ後に古い override が残っていると二重適用される。焼き込んだら編集に使ったブラウザで必ず「全リセット」する。

`window.confirm/alert/prompt` は使わない（ブラウザ自動化を止めてしまう）。確認は「もう一度押す」方式にする。

## 構図の確認方法

ウィンドウサイズに依存しないレンダリングで確認する。ブラウザのウィンドウが縦長だと構図判断を誤る:

```js
const png = await BABYLON.Tools.CreateScreenshotUsingRenderTargetAsync(
  engine, scene.activeCamera, { width: 1920, height: 1080 });
```

自動化から取り出す場合は、返ってきた data URL を分割して回収する（長すぎて一度に取れないことがある）。
