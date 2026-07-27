# Chrono Arena

Babylon.jsで動作する、60秒固定見下ろし型アクションローグライトの完成縦切り版です。MPFB2の人体トポロジーを土台にカスタム制作したBlender製主人公、3D敵4種、時計仕掛けアリーナ、能力アイコンを実ゲームへ統合しています。

## 起動

```bash
pnpm install
pnpm dev
```

ターミナルに表示されたローカルURLをブラウザで開きます。

## 検証

```bash
pnpm check
```

ゲームルールのNode標準テスト、JavaScript構文確認、Viteプロダクションビルドを実行します。

Blenderアセットも含めて検証する場合:

```bash
pnpm assets:validate
pnpm check
```

主人公を再生成する場合は、Blender 4.2以降へMPFB2 v2.0.17を有効化してから実行します。

```bash
pnpm assets:build:hero
pnpm assets:preview:hero
pnpm assets:validate
```

Blender 5.2 LTSで生成を確認しています。`assets:build` は軽量な敵4種と旧フォールバック主人公をプリミティブから再生成し、`assets:build:hero` はMPFB2のゲーム向けリグを基礎にカスタム主人公を生成します。外部アセットの由来とライセンスは `THIRD_PARTY_ASSETS.md` を参照してください。

## 操作

| 入力 | 動作 |
| --- | --- |
| WASD / 矢印 / 左スティック | 移動 |
| Space / ゲームパッドA | 残像回避 |
| Q / L1 | 未来斬り（2秒消費） |
| E / R1 | 停止領域（3秒消費） |
| R / X | 巻き戻し（4秒消費） |
| Esc | ポーズ |

通常攻撃は最も近い敵へ自動で行われます。

## 収録内容

- 1.3万頂点の人体ベース、55骨ゲームリグ、青い外套・時計核・双剣を持つカスタム主人公
- 平滑化したフードとカウル、積層装甲、金の時計意匠、長いタバード、PBR材質
- `Idle / Run / Attack / Dash / Hit / FutureSlash` の6モーション
- 連続曲面の追跡獣と、MPFB2連続人体・55骨リグを土台にした射針兵、時盗り、ボス
- コンセプト固有の大型機械弓、三連爪と砂時計灯籠、角冠・背面時計・多重リング時核
- 敵4モデル共通の `Idle / Move / Attack / Hit / Death`
- 攻撃モーションの接触フレームと弾判定、敵の2秒先へ予告を置く未来斬りの同期
- 残り15秒で出現するボス「時喰らいヴァルゴス」
- 30秒地点の遺物選択、時間消費スキル、成功／失敗リザルト
- Web Audio効果音、短いヒットストップ、reduced-motion時に無効化されるカメラ反応、音声切替
- 狭幅でも能力名・時間コスト・クールダウンを表示するHUDと、キーボードフォーカス／ARIA状態
- 低・中・高の描画品質、ゲームパッド、reduced-motion対応

主人公の正本は `assets/production/blender/chrono-duelist-custom.blend` と `assets/production/models/chrono-duelist-custom.glb`。敵の正本は `enemy-*-concept.blend/.glb` です。旧 `chrono-duelist.blend/.glb`、`enemy-*-hd.glb`、`enemy-*.glb` はフォールバックとして残しています。人型敵は連続MPFB2人体の上へ、二重曲面装甲、厚み付きドレープ、彫金ノーマル、役割別の武器と時計機構を重ねています。敵の再生成は `scripts/build_concept_chaser.py` と `scripts/build_concept_humanoid_enemies.py`、表面連続性の監査は `scripts/audit_enemy_surface_quality.py`、GLB再インポート検証は `scripts/validate_blender_assets.py` にあります。従来の2D生成素材はタイトル画面と能力アイコンのアートとして残しています。
