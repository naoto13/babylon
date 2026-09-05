# Ink Tide Scout: GLB-mediated img2threejs 制作方針

> **現在の状態（2026-08-21）:** この文書は方式2の実験計画と実測記録であり、production向けの現行方針ではない。実験は `VISUAL_NO-GO / LIMIT_MEASURED` で終了した。キャラクター本体は高品質なBlender正本からGLBを直接利用し、img2threejsはハードサーフェス小物またはThree.js上の検証・インタラクション補助へ限定する。判断根拠は[img2threejs用途調査](./img2threejs-usage-findings.md)を参照。

## 決定

以下は実験開始時の決定である。方式2を採用し、ライセンスを確認した人体ベースから Blender でキャラクターを制作し、意味のあるパーツ単位で中間 GLB を書き出す。img2threejs はその GLB を Three.js 上の構造・外観ベースラインとして使い、別系統の `ObjectSculptSpec` とコード専用の手続き的 TypeScript factory を制作する。

重要な境界として、GLB の頂点、トポロジー、マテリアル、リグを TypeScript factory へコピーまたはエンコードしない。GLB を Surface Nets へ自動変換する方式ではない。Surface Nets は、独立したfactory内で連続した閉曲面が必要な部位に SDF を設計した場合だけ使う。

最終成果物は **GLB-mediated independent procedural model（GLBを比較基準にした独立手続きモデル）** と表記する。「画像またはGLBから形状を直接抽出した」とは表記しない。

## 目的

- 参照画像 `threejs-project/assets/refs/ink-survivor-catgirl-ink-tide-scout-turnaround.png` の正面・右側面・背面を忠実に再現する。
- 顔、ボブヘア、猫耳、衣装、装備、J字型の尻尾を独立して修正できる構造にする。
- 高密度なSDF / Surface Netsを含むimg2threejsの手続き表現が、このキャラクターと実ランタイムでどこまでGLBベースラインへ近づけるか検証する。
- 元の `.blend`、中間GLB、変換ではなく再造形したspec、検証画像、最終TypeScriptの由来を追跡可能にする。

## 非目標

- 公開showcaseの形状ストリーム、モデル、未配布GLBを流用しない。
- BlenderまたはGLBの頂点・トポロジー・マテリアル・リグをfactoryへコピーしない。
- 中間GLBをimg2threejsが画像から自動生成した成果物として扱わない。
- High品質をゲーム本編の既定値に先決めしない。
- 現在の試験では、ライセンス未確認かどうかを問わず第三者のMakeHuman / MPFB追加アセットを使用しない。

## 人体ベース候補と権利境界

第一候補はMPFB 2.0.17とし、採用確定は隔離環境でBlender 5.2.0 LTSの起動、人体生成、保存、GLB書き出し、再読込を通過した後とする。

- MPFBのコード: GPL-3.0-or-later。
- MPFBに同梱されたベースメッシュ、プロキシ、ターゲット、テクスチャ、衣服、リグ等のアセット: CC0 1.0。
- MPFBの説明では、書き出した生成データにプログラムロジックは含まれず、出力物への追加制限は設けない。
- 今回の初回試験は、MPFBの版とextension tree SHA-256を実行時に照合した同梱/systemアセットと、プロジェクト側で新規制作する部品だけを使う。
- MPFBの外部ユーザーデータパスと追加ルートは無効化する。無効化できない場合は参照された全ファイルを列挙し、試験を`NO-GO`にする。
- 将来第三者アセットを使う場合は別判断とし、取得元、作者、版、ファイルハッシュ、商用利用、改変、再配布、表示義務、生成物への混入可否を確認してユーザーが明示承認するまで使用しない。
- 参照画像、MPFB配布物、使用アセット、img2threejs自体も`provenance.json`の対象にする。

MPFBの現行manifestはBlender 4.2.0以上を要求するが、これはBlender 5.2.0での動作保証ではない。互換性は実動テストで判定する。

一次情報:

- [MPFB 2.0.17](https://github.com/makehumancommunity/mpfb2/releases/tag/v2.0.17)
- [MPFB license](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md)
- [MPFB getting started](https://static.makehumancommunity.org/mpfb/docs/getting_started.html)
- [MPFB Blender manifest](https://github.com/makehumancommunity/mpfb2/blob/master/src/mpfb/blender_manifest.toml)

## 正本と成果物の境界

`.blend`がBlender造形の正本、`object-sculpt-spec.json`がimg2threejs再造形の正本である。中間GLBは比較用の入力であり、ゲームの最終成果物には含めない。

| 種別 | 実パス | 役割 |
|---|---|---|
| Blender正本 | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/blockout-v1/ink-tide-scout-blockout-v1.blend` | 静的な比較blockoutの形状とマテリアル |
| 中間GLB | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/blockout-v1/ink-tide-scout-blockout-v1.glb` | Three.jsで描画する構造・外観ベースライン |
| 由来台帳 | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/provenance.json` | 入力、ツール、素材、ライセンス、版、ハッシュ |
| GLB検査 | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/blockout-v1/img2threejs-glb-probe.json` | scene、mesh、material、skin、bounds、警告 |
| 再造形spec | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/object-sculpt-spec.json` | 独立factoryの階層、形状戦略、材質、品質契約 |
| 描画設定 | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/render-profile.v2.json` | GLBとfactoryで共用するカメラ・照明・6パス設定 |
| 描画台帳 | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/render-manifest.json` | GLB基準画像とfactory画像のハッシュ・診断 |
| 検証証拠 | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/verify/` | 比較画像、診断JSON、性能結果 |
| 試験factory | `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/generated/` | registry未統合の独立TypeScript factory |

初期試験の描画は静的Aポーズとし、外部GLB、GLBのbase64、`GLTFLoader`、外部テクスチャ、GLB由来のskin/animationをfactory単体へ含めない。GLB比較専用previewはこの境界の対象外である。ゲーム用へ昇格するときは、img2threejs側で独立してリグを設計・検証する。

## 変換ではなく再造形する契約

初回試験で使うimg2threejsは、公式リポジトリ `https://github.com/img2threejs/img2threejs.git` のcommit `d6673386f89673a58736f8d398dd16ece67874f5`（`v1.5-beta`、作業ツリーclean）へ固定する。実行時にはcommitと、利用したスクリプトのSHA-256を`provenance.json`へ記録する。別commitへ変更する場合は、旧・新commitと理由を残す。

固定した処理順は次のとおり。

```text
参照三面図 + Blender正本
  -> 意味的に分割した中間GLB
  -> probe_glb.pyで構造・hash・provenanceを記録
  -> GLTFLoaderでGLBをThree.js上に描画
  -> 固定カメラごとに6パスのベースラインを記録
  -> 画像とGLB描画を根拠にObjectSculptSpecを人間/エージェントが設計
  -> 独立したTypeScript geometry/material factoryを生成
  -> 同じThree.js描画条件で6パスを再記録
  -> compare_region_passes.pyと視覚レビューで比較
```

開始コマンドの契約:

```bash
python3 forge/stage1_intake/probe_glb.py /path/to/ink-tide-scout-reference.glb
python3 forge/stage4_review/render_bridge.py init \
  --reference-glb /path/to/ink-tide-scout-reference.glb \
  --reference-browser-url /references/ink-tide-scout-reference.glb \
  --runtime-url http://127.0.0.1:5173/#/character-demo \
  --out .img2threejs/ink-tide-scout/render-manifest.json
python3 scripts/capture_threejs_playwright.py \
  --manifest .img2threejs/ink-tide-scout/render-manifest.json \
  --mode reference
```

実コマンド、Blender/glTF exporter設定、入力GLBのSHA-256、render profile、spec、factory、各出力のSHA-256を`provenance.json`へ残す。途中入力または設定が変わった場合、過去の比較結果は流用しない。

部位別の形状戦略はspecで明示する。

- 頭・胴など閉じた連続ボリューム: SDF / Surface Nets候補。
- 薄いジャケットや襟: 厚みを持つ連続shell。ゼロ厚みをSDFで偽装しない。
- 髪: 頭部のmassと方向性clumpを分け、根元・先端・後頭部の連続性を持たせる。
- 目、口、服飾、ベルト、手袋、ブーツ: 意味単位ごとの連続形状または制御された付着形状。
- 尻尾: 骨盤のsocketへ接続した連続したJ字形状。

## パーツ構成

最低限、次の意味単位を維持する。GLBのsemantic-IDパスとfactoryのノード名で同じIDを使う。

- `body`, `head`, `eyes`, `mouth`
- `hair_cap`, `hair_bangs`, `hair_sides`, `ahoge`
- `ear_l`, `ear_r`, `ear_inner_l`, `ear_inner_r`
- `jacket`, `sailor_collar`, `inner_top`
- `shorts`, `belt`, `belt_buckle`
- `glove_l`, `glove_r`
- `boot_l`, `boot_r`
- `tail`

尻尾は背面から自然に生え、側面でJ字の輪郭が読める独立パーツとする。GLBがone-node / one-mesh / one-primitive / one-materialへ融合した場合は、意味的分解が不十分なため`NO-GO`とする。

## 制作順序

1. MPFBを隔離したBlender設定へ導入し、スモークテストを実行する。
2. Aポーズ、身長、肩幅、胴、腰、脚、手足の比率と三面シルエットを合わせる。
3. 頭部、顎、頬、目鼻口を調整する。
4. ボブヘア、前髪、横髪、アホ毛、猫耳を別パーツで制作する。
5. ジャケット、セーラーカラー、インナートップ、ショーツ、ベルト、手袋、ブーツを制作する。
6. J字型の尻尾を制作し、骨盤との接続と可動時の干渉を確認する。
7. Blender側の比較用リグを設定し、意味単位を維持したGLBを書き出して再読込する。
8. GLBのprobeとThree.jsベースラインキャプチャを行う。
9. `object-sculpt-spec.json`を作り、img2threejsのblockoutから独立factoryを段階制作する。
10. `camera → silhouette → face → clothing → accessory → materials → lighting`の順で、一度に一群だけ修正して全パスを再取得する。
11. High / Medium / Low候補を生成・計測し、用途を決定する。
12. 静的試験が`VISUAL_GO`かつ性能ゲートを通過した場合だけ、独立リグを追加してゲーム用昇格を判断する。

## MPFBスモークテスト契約

実行前に、隔離したBlender user config、scripts、extensions、dataディレクトリを一時ディレクトリ内へ作り、グローバルなBlender設定とMakeHumanユーザーデータを参照させない。ネットワークはMPFB 2.0.17と公式system assetsの取得時だけ許可し、取得物のURLとSHA-256を記録する。

スモークテスト用スクリプトは実行前にプロジェクトへ保存し、同じ入力で再実行可能にする。合格条件は次の全項目である。

- Blender 5.2.0 LTSを隔離した専用user configで起動する。`--factory-startup`はextension導入時だけ使い、スモーク実行時はその隔離configに保存されたMPFB有効化状態を読み込む。
- MPFB 2.0.17を登録し、外部asset rootが空または明示した隔離ディレクトリだけを指す。
- system assetsを使った人体を1体生成できる。
- `.blend`保存と`body`という意味名を持つ基礎人体GLBの書き出しが成功する。multipart要件は本番の比較用GLBで別途判定する。
- 同じ隔離user configを使う別プロセスでGLBを再読込できる。
- mesh、material、skin、bounds、非有限値、頂点ウェイト数の検査結果をJSONへ保存できる。

いずれかが失敗、外部asset rootが残存、未記録ファイルが参照された、または再読込結果が書出し前と不整合なら`NO-GO`とする。

再実行レシピ:

```bash
INK_MPFB_ROOT="$(mktemp -d /tmp/ink-tide-scout-mpfb.XXXXXX)"
export BLENDER_USER_CONFIG="$INK_MPFB_ROOT/config"
export BLENDER_USER_SCRIPTS="$INK_MPFB_ROOT/scripts"
export BLENDER_USER_EXTENSIONS="$INK_MPFB_ROOT/extensions"
export BLENDER_USER_DATAFILES="$INK_MPFB_ROOT/datafiles"

blender --factory-startup --online-mode \
  --command extension install -s -e mpfb
blender --background --offline-mode \
  --python tools/asset-pipeline/mpfb-smoke-test.py -- \
  --phase create --out-dir "$INK_MPFB_ROOT/smoke"
blender --background --offline-mode \
  --python tools/asset-pipeline/mpfb-smoke-test.py -- \
  --phase reimport --out-dir "$INK_MPFB_ROOT/smoke"
```

2026-08-20の実測ではBlender 5.2.0 LTSとMPFB 2.0.17の組合せで両フェーズが`GO`になった。外部asset rootは全て空またはfalse、生成meshは19,158頂点、非有限頂点0、頂点group所属最大4だった。MPFB manifest SHA-256は`bda56b74520f432417be162d97f3279149a056910ed9ddc5b0de8d0d02282fd1`、extension tree SHA-256は`63c2b6fbe3b5b211469841d60a1817192eae7aede166065538e61b575d4f8cca`で、スモークスクリプトが後者を実行時に照合する。証拠は`threejs-project/.img2threejs/ink-tide-scout/glb-mediated/compatibility/blender-5.2-mpfb-2.0.17/`に保存した。

## 固定キャプチャと合格条件

`render-profile.v2`をfactory編集前にvalidateし、GLBとfactoryの両方で次の7カメラを使う。

1. `hero/reference-match`
2. `orbit-plus-35`
3. `orbit-minus-35`
4. `profile-78`
5. `rear-180`
6. `head-hero`
7. `head-three-quarter`

各カメラで`beauty`、`alpha-silhouette`、`semantic-id`、`depth`、`normal`、`roughness-material-id`の6パスをThree.jsブラウザから取得する。viewport、DPR、camera、tone mapping、exposure、PMREM、background、lightingを固定し、referenceとfactoryのPNGハッシュを台帳へ記録する。

### `VISUAL_GO`

- 全7カメラ、全6パス、semantic regionが記録済みで、比較不能またはblocked claimがない。
- `hero/reference-match`、`profile-78`、`rear-180`のalpha-silhouette IoUが各0.90以上、他の全身カメラが0.85以上。
- `face`、`hair`、`ears`、`jacket`、`shorts`、`boots`、`tail`のcritical regionでalpha-silhouette IoUが0.85以上。
- beauty、depth、normalの全体similarityが各0.85以上。数値は回帰検出に使い、単独では似ていると判定しない。
- 視覚レビューが全体9/10以上かつ各critical feature 9/10以上で、欠落部位、浮遊パーツ、深い自己交差、破綻した厚みがない。
- AポーズのGLBとfactoryを同じ条件で並べ、正面・側面・背面の主要比率に説明不能な差がない。

数値を満たしても三次元形状が平板、接続が不自然、またはcritical featureが異なる場合は`VISUAL_NO-GO`とする。数値未達は限界点の測定結果として残し、合格扱いにしない。

### ランタイム境界

- 現在の限界測定では、最終factoryソース単体に`.glb`、GLB base64、`GLTFLoader`、外部テクスチャ、GLB由来リグが含まれないことを機械検査する。GLB比較専用の`glb-mediated-preview.html`はこの検査対象外で、意図的に`GLTFLoader`を使う。production昇格時はfactoryを組み込んだ`dist/`とimport graphも追加検査する。
- 静的試験ではスキニングを要求しない。ゲーム用昇格時は独立リグ、各頂点4ウェイト以下、有限・正規化済みウェイト、肩・肘・手首・股関節・膝・足首・首・尻尾のstress poseを別ゲートにする。

### 性能区分

テスト端末の機種、OS、GPU、Chrome版、viewport、DPRを記録し、cold load後の初回factory構築時間、転送gzip、peak JS heap増分、60秒描画のp95 frame timeを3回測定して中央値を使う。

| 判定 | factory構築 | gzip転送 | peak heap増分 | p95 frame time |
|---|---:|---:|---:|---:|
| `GAME_GO` | 1秒以下 | 8 MiB以下 | 256 MiB以下 | 16.7 ms以下 |
| `ADMIN_ONLY` | 5秒以下 | 32 MiB以下 | 1 GiB以下 | 33.3 ms以下 |
| `NO-GO` | 上記`ADMIN_ONLY`を1項目でも超過 | | | |

High / Medium / Lowという名前だけでは用途を決めない。`VISUAL_GO`と性能区分を併記し、Highは少なくとも初期段階では遅延ロードされた管理・検証用途に限定する。

## 2026-08-20 実測結果

方式2のblockout試験は完了した。判定は **`VISUAL_NO-GO / LIMIT_MEASURED`**。`proportion-lock`以降は解放せず、ゲームのprocedural registryにも組み込まない。

### 作成・検証できたもの

- Blender 5.2.0 LTS + MPFB 2.0.17の隔離スモークテストは`GO`。
- 比較用Blender blockoutは53 mesh、評価時186,564 triangles。書出しGLBは53 mesh / 53 primitive / 9 material、skin・animationなし、非有限値なし。
- 公式img2threejsをcommit `d6673386f89673a58736f8d398dd16ece67874f5`へ固定し、GLB probe、strict spec validation、pass orchestration、Playwright capture、Tier 1診断を実行した。
- 最終factory blockoutは51 mesh / 107,428 triangles。全高1.56843、幅0.91291、奥行0.48579。最終factoryソース単体の静的scanでは、GLB/image/remote URL/base64へのランタイム依存は全て0。GLB比較専用previewは検査範囲外で、production用`dist/`の検査は未実施。
- 7 camera × 6 passをブラウザから取得し、console errorは0。profileの面積比0.741を含めmulti-angle collapseは検出されず、平面看板ではないことを確認した。
- 原画固有の猫耳と内耳、ボブと前髪、虹彩と瞳、開いた短丈ジャケット、白い袖口、左右ショーツ、ベルト金具、多部品ブーツ、二色J字尻尾を独立ノード化した。

### 補正履歴

| 段階 | mesh / triangles | hero silhouette IoU | 判定 |
|---|---:|---:|---|
| 初期移行 | 74 / 116,884 | 0.459 | 旧GLB proxyの重複、座標・素材規約不整合 |
| pass選択・textureless補正 | 32 / 61,684 | **0.7675** | 最高値だがTier 1閾値0.85未達 |
| 原画identity補正 | 51 / 107,428 | 0.7440 | 原画固有部品は増えたがGLB輪郭一致は低下 |

最終補正後のaspect ratio deltaは0.0270、scale deltaは0.0159、bilateral symmetry errorは0.0151。Tier 1 hard gateが失敗したため、公式review契約どおりAI/VLM scoreとfeature scoreは付けていない。bounded correction loopは`progress plateaued below target`で停止した。

### 確認できたimg2threejs側の限界

1. ポリゴン数を増やしても、primitive / ellipsoid / straight extrude主体では、アニメ顔、毛束、身体へ沿う衣服、襟・縫い目・裾の立体構造は自動的に増えない。高ポリゴン化は主に曲面の滑らかさを増やす。
2. `buildPass.componentRefs`だけでは除外にならず、`level=macro`または`fidelityTier=blockout`の部品も生成対象になる。移行specでは旧proxyが重複したため、非選択部品を後段tierへ明示的に送る必要があった。
3. strict evidence用の`referencePbr`をそのまま生成器へ渡すと外部画像loaderがfactoryへ配線される。またprocedural CanvasTextureは参照画像由来paletteの誤対応を強調した。今回はgeometry/rig hashを不変に保つadapterで外部loaderを除き、textureless flat PBRを既定にした。
4. attachment付きtubeは直線cylinderへ置換されるため、J字尻尾とアホ毛はworld-space tubeとして保持した。見た目は維持できるがattachment metadataは弱くなる。
5. 公式render-profile validatorにはshowcase由来の固定region名が残るため、このキャラクター固有regionに加えてcompatibility aliasが必要だった。
6. ローカルworkflow stateは`reviewHistory.action=stop`をterminal stateとして扱わず`await-pass-transition`に残る。正本specの最終reviewと`terminal-verdict.json`を終了判定の証拠とする。
7. 比較用GLB自体が原画より成人体型・簡略衣装・粗い髪/顔になった。GLB一致だけを最適化すると原画忠実度が下がるため、最高IoU版と原画identity版の評価が分岐した。

### メリット・デメリットと次の判断

方式2のメリットは、意味パーツ、固定カメラ、厳格な由来境界、コードだけのランタイム、再現可能な数値比較を作れること。少なくとも「立体である」「外部GLBを隠していない」「どの部品が不足したか」は検証できる。

デメリットは、中間GLBの品質が上限を決めること、generic generatorの造形語彙だけではshowcase級キャラクターへ届かないこと、忠実度を上げるほどsubject-specificな手作業specが増え、最終的にはBlender造形と同等以上の調整量になること。

このため現在の推奨は **方式2を限界測定として終了し、production採用しない**。showcase級を本当に狙う次手は次のどちらかで、推奨はA。

- **A: Blenderで高品質な正本を造形してGLBを直接使う。** 長所は顔・髪・衣服・リグ・ウェイトを目的に合うトポロジーで管理でき、品質の見通しが最も良い。短所はモデリング工数とBlender技能が必要で、img2threejsのcode-only性は得られない。
- **B: img2threejs自体を拡張する。** 長所はcode-only、semantic parts、再現性を維持できる。短所はcurve/spline、fitted shell、subject-specific SDF、顔・髪用生成器、attachment semantics、review stateまで実装対象になり、今回の1キャラクター制作より大きな開発になる。

試験成果物は`.img2threejs/ink-tide-scout/glb-mediated/`、再実行スクリプトは`tools/asset-pipeline/`、ブラウザ比較入口は`threejs-project/glb-mediated-preview.html`に残す。
