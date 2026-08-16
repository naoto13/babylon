# Chrono Arena Asset Prompts

画像は組み込みImage Genで生成し、プロジェクト内へ保存した。

## Gameplay reference

`assets/gameplay.webp` はルートのコンセプト制作時に生成したゲームプレイ画面。元プロンプトは `../IMAGE_PROMPTS.md` の `01 Chrono Arena` を参照。

## Time-freeze upgrade screen

Use case: `stylized-concept`

Asset type: 16:9 desktop browser game supporting screen, 1440 x 810.

Input image: the Chrono Arena gameplay image as a visual continuity reference, not an edit target.

Create the between-round time-freeze upgrade scene in the same circular ruined clockwork arena. Freeze translucent enemy silhouettes and projectiles in the background. Place the hero beside a cracked brass chronometer pedestal and show three distinct floating relics: a cyan blade shard, a violet loop sigil, and a golden hourglass core. Keep the same high-angle three-quarter top-down camera, navy void, cyan time fractures, warm brass PBR materials, and restrained bloom. Leave clean negative space for HTML selection controls. No text, numbers, logos, watermark, browser chrome, device bezel, or baked-in card UI.

## 2D concept and UI assets (2026-07-23)

すべて組み込みImage Genで、`../assets/game-screens/01-chrono-arena.png` を画材・色・カメラの参照として生成した。キャラクターは一様な `#ff00ff` 背景で生成し、公式ヘルパーでクロマキー除去後、`scripts/process_assets.py` で分割・余白調整・縮小している。

主人公と敵のPNGは3D化の造形・配色リファレンスであり、現在のゲーム内キャラクターの正本ではない。ゲーム内では後述のBlender製GLBを使用する。アリーナ背景と能力アイコンは引き続きUI／床面アートとして使用する。

### Arena

Use case: `stylized-concept`. Production square Babylon.js arena background. A centered gigantic circular cracked slate-stone arena, concentric antique-brass clock rings, cyan time fractures and four cardinal time pylons, surrounded by a deep navy mechanical abyss with gears, pipes and broken masonry. Fixed high three-quarter top-down camera around 50 degrees. Premium stylized 3D painterly PBR quality. Keep the center open for gameplay. No characters, enemies, projectiles, UI, text, numbers, logos or watermark.

Final: `assets/production/arena-clockwork.png`

### Chrono Walker

Use case: `stylized-concept`. One complete agile armored time warrior in a dynamic ready stance, dark navy layered armor, antique-brass clockwork trim, hooded faceless silhouette, cyan hourglass chest core and two separated crescent energy blades. Fixed high three-quarter gameplay camera, hard readable silhouette, premium stylized 3D render. Perfectly uniform `#ff00ff` chroma background, no floor, shadow, particles, text or crop.

3D reference: `assets/production/hero.png`

### Enemies and boss

Use case: `stylized-concept`. Exact 2x2 sheet on uniform `#ff00ff`: top-left a squat horned clockwork hound, top-right a hooded violet ranged cultist, bottom-left a lean masked time thief with cyan hourglass lantern, bottom-right a large crimson-black horned chronomancer boss casting a red orb. Same fixed high three-quarter camera and painterly PBR style, clear gutters, no shadows, text, UI or overlap.

3D references: `enemy-chaser.png`, `enemy-shooter.png`, `enemy-thief.png`, `enemy-boss.png`

高精細モデル向けには上の敵一覧を構造と配色の参照画像にして、4体を個別の正投影三面図へ展開した。共通プロンプトは「front / side / back の完全な全身、ゲーム向けPBR造形、時計機構と武器の接続が読める高密度ディテール、無地の濃紺背景、文字・ロゴ・UI・床・影なし」。個別特徴は、四足の歯車獣、発光弓を持つ射手、時間灯籠を持つ盗賊、浮遊コアと背面大歯車を持つボスとして指定した。

- `assets/production/concept/enemies/chaser-turnaround-v2.png`
- `assets/production/concept/enemies/shooter-turnaround-v2.png`
- `assets/production/concept/enemies/thief-turnaround-v2.png`
- `assets/production/concept/enemies/boss-turnaround-v2.png`

### Ability icons

Use case: `stylized-concept`. Exact 2x2 premium fantasy HUD icon sheet with identical embossed antique-brass frames and navy enamel interiors: twin cyan crescent slash, violet stopped clock, cyan reversing hourglass and blue dash boot. Straight-on, high contrast, readable at 64 pixels, no text, key labels, characters or watermark.

Finals: `icon-slash.png`, `icon-stop.png`, `icon-rewind.png`, `icon-dash.png`

## Blender production assets

現在の主人公は、生成した三面図をデザイン正本とし、MPFB2の人体トポロジー／ゲーム向けリグへ独自のフード、積層装甲、カウル、タバード、時計意匠、双剣を制作したカスタムモデル。

- Design turnaround: `assets/production/concept/chrono-duelist-turnaround-v2.png`
- Editable source: `assets/production/blender/chrono-duelist-custom.blend`
- Runtime hero: `assets/production/models/chrono-duelist-custom.glb`
- Fallback hero: `assets/production/blender/chrono-duelist.blend`, `assets/production/models/chrono-duelist.glb`
- Custom hero generator: `scripts/build_mpfb_hero.py`
- Armour/material authoring: `scripts/build_custom_hero.py`
- Continuous Chaser generator: `scripts/build_concept_chaser.py`
- MPFB humanoid enemy generator: `scripts/build_concept_humanoid_enemies.py`
- Legacy HD enemy generator: `scripts/build_high_detail_enemies.py`
- Enemy/fallback generator: `scripts/build_blender_assets.py`
- Motion preview renderer: `scripts/render_hero_motion_previews.py`
- Production review renderers: `scripts/render_concept_chaser_preview.py`, `scripts/render_concept_humanoid_previews.py`
- Legacy enemy preview renderer: `scripts/render_enemy_previews.py`
- Surface continuity audit: `scripts/audit_enemy_surface_quality.py`
- Import validator: `scripts/validate_blender_assets.py`
- Hero clips: `Idle`, `Run`, `Attack`, `Dash`, `Hit`, `FutureSlash`
- Enemy clips（4モデル共通）: `Idle`, `Move`, `Attack`, `Hit`, `Death`

主人公の人体と衣装はglTFの4骨ウェイト上限へ正規化し、衣装パーツを8材質プリミティブへ統合している。55骨リグで関節変形し、未来斬りの大回転だけは骨ローカル軸ではなくモデルのワールドZ軸で行う。

現在の敵は `enemy-*-concept.glb` がランタイム正本。Chaserは球・円柱の組み立てを廃止し、連続した胴体・頭部・脚芯へフィット装甲と一体トポロジーの時計機構を重ねた13骨モデル。Shooter / Thief / Bossは、13,380頂点・1島のMPFB2連続人体と55骨ゲームリグを共通変形基盤にし、平面パネル中心だった旧版を、二重曲面の鍛造装甲、厚みのある波打つ布、役割別の武器・時計機構、glTF対応の彫金ノーマルへ置き換えた。最終BLENDはShooter 82,180tri、Thief 76,694tri、Boss 99,542triで、ブラウザ負荷を抑えるため全面Subdivisionではなく曲面グリッドとノーマルディテールを併用する。`enemy-*-hd.glb` と旧 `enemy-*.glb` はフォールバックとして残す。レビュー画像は `screenshots/model-review/enemies-concept/` に保存する。

再生成と検証:

```bash
pnpm assets:build:hero
pnpm assets:build:enemies:concept
pnpm assets:preview:hero
pnpm assets:preview:chaser:concept
pnpm assets:preview:enemies:concept
pnpm assets:audit:surfaces
pnpm assets:validate
```

主人公の人体基盤を新規生成するにはBlender 4.2以降と、有効化済みのMPFB2 v2.0.17が必要。敵人型の通常再生成はチェックイン済み `chrono-duelist-custom.blend` の検証済み人体・リグを再利用するため、MPFB2拡張が一時的に無効でも再現できる。配布物の由来とライセンスは `THIRD_PARTY_ASSETS.md` に記録する。
