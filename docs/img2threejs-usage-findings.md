# img2threejs 用途調査と採用判断

更新日: 2026-08-21

## 結論

img2threejsは、参照画像から任意の高品質3Dモデルを自動復元する汎用Image-to-3Dではない。現状もっとも適するのは、形状を箱・円柱・押し出し・回転体などへ意味的に分解でき、コードによる差分管理、パラメータ変更、可動部、socket、collider、分解表示に価値があるハードサーフェス小物である。

Ink Tide Scoutのように、顔、人体、髪、身体へ沿う衣服を原画へ忠実に合わせるキャラクター本体には採用しない。高品質なBlender正本からGLBを直接利用し、Three.jsは描画、ゲームプレイ、エフェクト、装備接続、検証を担当する。

この判断は「img2threejsが無価値」という意味ではない。**形状忠実度を最優先する有機キャラクター制作と、img2threejsが提供する3D-as-codeの価値が一致しない**という用途境界である。

## 最大の見落とし: `girl-character` showcaseの前提

公開showcaseの`girl-character`を、通常の「参照画像から汎用Three.js factoryを生成する経路」の達成例として扱ったのは誤りだった。showcaseリポジトリのcommit `bf44f8f1fdef70fcc87f91fc4e777fd760b9757f`を監査すると、少なくとも同デモは次の特殊経路を使っている。

```text
既存の高品質baseline GLB / point cloud
  -> 部位ごとの断面・SDF・Surface Nets再構築
  -> GLB由来の材質・UV・テクスチャ情報を転送
  -> 圧縮した大規模表面データをTypeScriptへ格納
```

ソース内には以下が明記されている。

- 各regionはbaseline node自身のpoint cloudから取得したcross-sectionでloftされ、material parameterはGLBから取得される。[createGirlCharacterModel.ts](https://github.com/img2threejs/img2threejs-showcase/blob/bf44f8f1fdef70fcc87f91fc4e777fd760b9757f/src/demos/girl-character/createGirlCharacterModel.ts)
- 表面データは以前107.6 MBのbinaryで、2,109,210 vertices / 4,220,724 trianglesを含んでいた。[surfaceCodec.ts](https://github.com/img2threejs/img2threejs-showcase/blob/bf44f8f1fdef70fcc87f91fc4e777fd760b9757f/src/demos/girl-character/surfaceCodec.ts)
- 圧縮後も25.52 MBのbase64データがTypeScriptへ埋め込まれている。[surfaceData.ts](https://github.com/img2threejs/img2threejs-showcase/blob/bf44f8f1fdef70fcc87f91fc4e777fd760b9757f/src/demos/girl-character/surfaceData.ts)
- cross-sectionとUVはGLB nodeのpoint cloudおよびnearest vertexを基準にする。[crossSections.ts](https://github.com/img2threejs/img2threejs-showcase/blob/bf44f8f1fdef70fcc87f91fc4e777fd760b9757f/src/demos/girl-character/crossSections.ts)

したがって、このshowcaseと同等の形状を得るには先に高品質な正本メッシュが必要になる。その正本があるゲーム制作では、mesh相当の巨大データをTypeScriptへ再格納するより、DracoまたはMeshopt等で圧縮したGLBを直接ロードする方が、通常は単純で保守しやすい。showcase方式が合理的なのは、研究・デモまたは表面をコード側で再構築する固有要件がある場合に限られる。

## 追加で判明した見落とし

### 外部画像・テクスチャを一律禁止した

初回試験の「factoryは外部テクスチャを使わない」という境界は、純粋なgeometry能力を測る実験条件としては有効だったが、公式showcaseの品質と比較する条件としては不適切だった。公式のナイフやGlock系デモは、投影画像やalbedo、AO、roughness、metalness、normalなどを利用している。

- [classic-fade demo source](https://github.com/img2threejs/img2threejs-showcase/tree/bf44f8f1fdef70fcc87f91fc4e777fd760b9757f/src/demos/classic-fade)
- [glock-ghost-protocol demo source](https://github.com/img2threejs/img2threejs-showcase/tree/bf44f8f1fdef70fcc87f91fc4e777fd760b9757f/src/demos/glock-ghost-protocol)

今後の小物試験ではテクスチャ利用を禁止しない。ただし、参照画像の投影だけで側面や背面の形状不足を隠していないかは、無地material、silhouette、depth、normalを別々に検証する。

### 三面図が自動的に統合されると考えた

複数画像を渡しても、build/reviewが実質的に1枚目のreferenceへ偏る問題が公式Issueで報告されている。三面図を用意しただけでは、各viewが同時に満たす三次元制約になったとはいえない。[Issue #58](https://github.com/img2threejs/img2threejs/issues/58)

multi-view synthesisが公式に実装・検証されるまでは、正面・側面・背面を人間またはsubject-specific adapterが明示的にspecへ統合し、全viewを独立したhard gateとして扱う。

### strict validationの完走を見た目の合格と近く捉えた

品質ゲートのscale、IoU、fallback geometry、anatomy/color評価には、低品質な形状へ誤った確信を与え得る問題が報告された。v1.5-betaで一部は修正されているため、過去のIssueをすべて現行不具合とは扱わない。一方、strict validationは構造・手順の完了証拠であり、対象への視覚的忠実度を単独で保証しない。[Issue #18](https://github.com/img2threejs/img2threejs/issues/18)

Ink Tide Scoutでは、この原則どおりsilhouette hard gateを優先し、最終IoU `0.7440`を合格へ読み替えなかった。

### 対象カテゴリ専用の造形語彙が不足していた

車両試験でも、列挙した部品を配置できても全体のbody formが玩具的になり、専用adapterが必要だと報告されている。[Issue #38](https://github.com/img2threejs/img2threejs/issues/38) 人体、顔、髪、衣服では、anatomical landmark、曲線、身体へ沿うshell、毛束、接続関係など、プリミティブの細分化だけでは得られない造形語彙が必要になる。

このため今回の低品質は、単に反復回数が少なかったためではない。generic generatorの表現方法と対象が合っておらず、同じ方式の反復を増やしても費用対効果が低い。

## 公式方針とコミュニティ実験

公式CONTRIBUTINGも、得意領域をhard-surface objects、props、stylized/low-poly assetsとし、characters/creaturesはavatarまたはfigurine程度、特定人物・動物のphotoreal likenessは対象外としている。[公式CONTRIBUTING](https://github.com/img2threejs/img2threejs/blob/d6673386f89673a58736f8d398dd16ece67874f5/CONTRIBUTING.md)

独立した利用者の公開実験からも、次の傾向が見える。

- F1車は失敗し、より単純なNES controllerは認識可能なshell、button、cable、interactionまで到達した。ただしpolished assetではなくrough demoという評価だった。[SHUOによる検証](https://blog.shuochen.me/en/articles/img2threejs-codex-test/)
- keyboardは8 passとstrict validationを完了してもTier 1 silhouetteを通過せず、material分類には手動overrideが必要だった。[Aiden Linによる検証](https://www.aidenlin.dev/blog/img2threejs-codex-hands-on)
- weaponやboxのようなsimple hard-bodyには使える一方、characterは長時間・大量creditを使っても良くなかったという報告がある。[StableDiffusionコミュニティ](https://www.reddit.com/r/StableDiffusion/comments/1v4jd0a/img2threejs_rebuild_the_object/)
- 良い結果まで半日調整した例や、単純なmodelでも20万token以上を消費した例がある。[AI Game Devコミュニティ](https://www.reddit.com/r/aigamedev/comments/1v169hl/img2threejs_and_codex_experiments/)
- 高品質characterの公開例でも、作者は一回のpromptで得られるのはproportion/structureまでで、各partを個別に磨き、丸一日と複数の長時間sessionを要したとしている。[Three.jsコミュニティのcharacter例](https://www.reddit.com/r/threejs/comments/1vrfm79/one_still_photograph_that_never_moved_has_become/)

これらは件数が少なく、作者・maintainer・利用者の投稿が混在するため、統計的な品質評価ではない。ただし、「単純なhard-surfaceは比較的成立する」「正確なorganic/compound surfaceは難しい」「反復とtoken消費が大きい」という傾向は、公式スコープ、Issue、Ink Tide Scoutの実測と一致する。

## 採用マトリクス

| 対象・目的 | 判断 | 主なメリット | 主なデメリット |
|---|---|---|---|
| 箱、銃、ナイフ、家具、単純な機械 | `GO候補` | semantic part、可動部、コード差分、再利用 | 曲面精度とtexture調整に手作業が必要 |
| 色、長さ、部品構成を変えるconfigurator | `GO候補` | parameter化の価値が大きい | variant不要ならGLBより複雑 |
| 分解表示、socket、collider、interaction | `GO候補` | runtime構造を直接設計できる | 見た目だけが目的なら過剰 |
| stylizedな背景props、建物 | `条件付き` | 認識可能な形を早く試せる | draw call、token、手修正が増えやすい |
| アニメ調characterの粗いfigurine | `実験限定` | code-onlyの構造検証ができる | 顔、髪、衣服、rigの忠実度が低い |
| 原画へ忠実なcharacter、人体、動物 | `NO-GO` | なし | 専用造形語彙と手修正量がBlender制作へ接近する |
| 車体など連続した意匠曲面 | `原則NO-GO` | dedicated adapter開発の研究対象にはなる | generic primitiveではbody formが崩れる |
| 高品質baseline GLBの表面をTSへ再格納 | `通常NO-GO` | 外部GLBなしでbundle化できる | payload、build、保守、意味上はmesh dataの再包装 |

## このプロジェクトでの現行方針

### キャラクター本体

Blenderで高品質な正本を制作し、GLBをThree.jsまたはBabylon.jsから直接利用する。

- メリット: 顔、髪、衣服、topology、rig、weight、animationを目的に合う正本で管理できる。
- デメリット: Blenderの制作工数と技能が必要で、geometryをTypeScriptのコード差分として編集できない。

GLBを直接使うことはThree.jsと無関係になることではない。Blenderはasset authoring、GLBは交換形式、Three.js/Babylon.jsはweb runtimeとして、描画、animation、input、physics、shader、effect、LOD、gameplayを担当する。

### img2threejs

次へ限定して利用候補とする。

- 銃、ナイフ、インクタンク、装備品、container、機械部品などのhard-surface props
- runtimeで寸法・色・部品を変更するprocedural variant
- socket、collider、hit volume、可動部、分解表示、debug visualization
- reference/GLBと同条件で撮影するcamera、pass capture、visual review harness

character本体の欠けたgeometryをimg2threejsが補うとは扱わない。

## 次回pilotの停止条件

pure img2threejsを再評価する場合は、characterではなく小さなhard-surface 1点を対象にする。

1. 正面・側面・背面またはfront/back broadsideを用意し、すべてをspecへ明示的に反映する。
2. texture projectionとPBR mapを許可する一方、untextured silhouette/depth/normalも評価する。
3. 対象カテゴリ専用adapterとpart vocabularyをblockout前に定義する。
4. blockout silhouetteを最優先し、polycount増加を忠実度向上の代理指標にしない。
5. 2回のbounded correction後も主要silhouetteが閾値未達なら停止する。
6. token、wall time、bundle gzip、triangle、draw call、frame timeを記録し、同等GLBと比較する。

再開条件は、公式multi-view synthesisまたは対象カテゴリ専用adapterが実装され、同一referenceに対する独立検証で現在のhard gateを超えた場合とする。

## 関連記録

- [Ink Tide Scout: GLB-mediated img2threejs 制作方針と実測](./ink-tide-scout-glb-mediated-plan.md)
- 実験結果: `VISUAL_NO-GO / LIMIT_MEASURED`
- 最高hero silhouette IoU: `0.7675`
- 最終identity補正版hero silhouette IoU: `0.7440`
- 試験成果物: `threejs-project/.img2threejs/ink-tide-scout/glb-mediated/`
