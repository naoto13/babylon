# Moonlit Potion Workshop Asset Prompts

画像は組み込みImage Genで生成し、プロジェクト内へ保存した。

## Workbench reference

`assets/workbench.webp` はルートのコンセプト制作時に生成したゲームプレイ画面。元プロンプトは `../IMAGE_PROMPTS.md` の `04 Moonlit Potion Workshop` を参照。

## Prop references（`assets/refs/*-ref.png`）

image-to-3D の入力にするため、小物は 1 点ずつ単体で生成する。共通条件は次のとおり。

- 正方形 1254 x 1254、背景は完全透明（RGBA、被写体だけに alpha を残す）
- 被写体は 1 つだけ。接地影、台座、床、他の小物を入れない
- やや上からの四分の三ビューで、上面と側面の両方が見える角度
- 工房と同じ質感（手仕事の木・真鍮・ガラス・石）。強い色被りのライティングは避け、形と素材が読める均一光
- 文字、ロゴ、透かし、UI を入れない

### Workbench（`workbench-ref.png`）

A sturdy handcrafted alchemist's workbench of dark aged oak, seen in three-quarter view from slightly above. The top is built from four or five wide planks with visible seams, a worn rounded front edge, scattered scorch marks, ink stains, and shallow knife scars. Four square tapered legs with simple chamfers, joined by a low stretcher shelf near the floor. The top is noticeably wider than it is deep, roughly a five-to-three footprint. Empty surface, nothing placed on it. Isolated object on a fully transparent background, no floor, no contact shadow, no props, no text.

### Jar shelf（`shelf-ref.png`）

A single long wall shelf of the same dark aged oak, seen in three-quarter view from slightly above. One thick plank with a worn front edge and visible grain, supported by two carved corbel brackets underneath, with a small raised lip along the back edge. Long and shallow, roughly a fifteen-to-one length to depth ratio. Empty, nothing placed on it. Isolated object on a fully transparent background, no wall, no contact shadow, no props, no text.

## Customer order intake screen

Use case: `stylized-concept`

Asset type: 16:9 desktop browser game supporting screen, 1440 x 810.

Input image: the Moonlit Potion Workshop gameplay image as a visual continuity reference, not an edit target.

Create the customer-order intake scene at the front counter of the same moonlit potion shop. From the alchemist player's first-person perspective, show a gentle exhausted forest courier holding a wilted luminous plant. Place a blank illustrated order parchment, hourglass, sample ingredient jars, and empty potion bottle on the counter. Match the cozy handcrafted wood and glass, warm candlelight, cool moonlight, crescent window, and restrained magical glow of the reference. Leave clean negative space on the right for HTML order details and at the bottom for the main action. No written words, legible parchment text, logos, watermark, browser chrome, device bezel, or baked-in UI.
