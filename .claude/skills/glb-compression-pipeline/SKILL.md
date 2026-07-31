---
name: glb-compression-pipeline
description: How to compress GLB assets with gltfpack for this repo's Babylon.js games and avoid the silent-breakage traps in that pipeline. Use this whenever a 3D asset looks wrong, different, or washed-out in-game but fine in Blender or the asset-preview page; whenever a GLB fails to load with "Required extension ... is not available"; whenever running or changing gltfpack flags; whenever an edit to a model seems not to have taken effect in-game; and before concluding that a mesh, texture, or bake is broken — the cause is very often this pipeline, not the asset.
---

# GLB compression pipeline (gltfpack → Babylon.js)

## Why this exists

Assets in this repo go through `gltfpack` before the game loads them, and that step can change the file in ways the engine silently mishandles. A whole debugging session was lost to this: a hero model that looked correct in Blender and in the asset-preview page rendered as a visibly *different, washed-out model* in-game, with **no console error at all**. The mesh, the bake, and the texture were all fine — the loader was just ignoring a glTF extension. Suspect this pipeline before you suspect the asset.

## The trap: extensions that fail loudly vs. silently

`@babylonjs/loaders` requires each glTF extension to be imported individually as a side-effect (this repo imports the loader piecemeal, not the umbrella bundle). gltfpack emits up to four, and they split into two very different failure modes:

| Extension | Emitted by | In `extensionsRequired`? | Failure mode if not imported |
|---|---|---|---|
| `KHR_mesh_quantization` | always | yes | **Loud** — `Required extension ... is not available` |
| `EXT_meshopt_compression` | `-c` / `-cc` | yes | **Loud** |
| `EXT_texture_webp` | `-tw` | yes | **Loud** |
| `KHR_texture_transform` | UV quantization (implicit) | **no** — only `extensionsUsed` | **SILENT** — no error, wrong output |

The loud three surface one at a time, so you fix them iteratively and feel done. **`KHR_texture_transform` is the dangerous one.** gltfpack quantizes UVs into a small integer range and records a compensating scale (observed: ~15.7×) in this extension. Because it lands in `extensionsUsed` and not `extensionsRequired`, the spec lets a loader skip it — so Babylon loads the file happily and samples the texture through un-compensated UVs, i.e. from roughly 1/15th of the intended area. The result reads as a completely different model, which sends you hunting for bugs in the mesh or the bake instead.

The fix is just registering it. Any entry point that loads a packed GLB needs the full set:

```js
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform.js";
```

Both `chrono-arena/src/main.js` and `chrono-arena/tools/asset-preview.js` carry these. If you add another page or project that loads packed GLBs, copy the whole block — don't add extensions one at a time as errors appear, because the silent one never produces an error to prompt you.

## Inspect the GLB instead of guessing

A GLB's JSON chunk is plain text right after a 20-byte header, so you can check exactly what the engine will see in seconds. This is far faster than reasoning about symptoms, and it's how the texture-transform issue was finally pinned down:

```python
import struct, json
with open(path, "rb") as f:
    data = f.read()
n = struct.unpack("<I", data[12:16])[0]
g = json.loads(data[20:20 + n])
print("used:", g.get("extensionsUsed"))
print("required:", g.get("extensionsRequired"))
for m in g.get("materials", []):
    print(m.get("name"), m.get("emissiveFactor"), json.dumps(m.get("pbrMetallicRoughness"))[:200])
```

Reach for this when you want to confirm which extensions a file actually needs, whether a material value (emissive strength, metallic, roughness) really made it into the export, or whether a `KHR_texture_transform` scale is present on a texture.

Note that `trimesh` **cannot** read `-c`/`-cc` output (`EXT_meshopt_compression`) and dies with `IndexError: list index out of range`. Preview the *uncompressed* export with trimesh; validate the packed file in Babylon (the asset-preview page) or via the JSON dump above.

## Re-pack after every source change

The packed file under `assets/production/models/` is a build artifact of a source GLB elsewhere (e.g. `assets/production/demonic/rigged/*-animated.glb`). Regenerating the source does **not** update it. This produced a confusing stretch where a material fix (emissive 0.35 → 0.12) was verified correct in the source yet the game kept showing the old look — the game was simply reading a stale pack.

When a fix appears not to have taken effect, compare timestamps before re-investigating the fix itself:

```bash
ls -la chrono-arena/assets/production/demonic/rigged/hero-nendo-trellis2-animated.glb chrono-arena/assets/production/models/hero-nendo-trellis2.glb
```

If the packed file is older than its source, that's the whole bug. Re-run gltfpack.

## Flags that meet this repo's budgets

```bash
gltfpack.exe -i in.glb -o out.glb -cc -tw -tq 8 -tl 2048 -af 24
```

- `-cc` higher meshopt compression · `-tw` WebP textures · `-tq 8` texture quality · `-tl 2048` texture dimension cap · `-af 24` resample animation to 24Hz (matches the scene fps these clips are authored at)
- Prefer `-tw` over `-tc`/KTX2: `moonlit-potion-workshop/game/assets/README.md` flags KTX2 as adding a decoder dependency, and WebP needs nothing extra in-browser.
- Add `-si <ratio>` to simplify geometry when a file misses its size budget. Budgets live in `chrono-arena/SPEC.md` §12 (hero ≈3.2MB) and `moonlit-potion-workshop/game/assets/README.md` (cauldron ≤3MB, props ≤1MB).
- Verify animation clip names survive packing when the game requires specific ones — `chrono-arena/src/main.js`'s `loadModelAssets()` throws if the hero lacks `Idle, Run, Attack, Dash, Hit, FutureSlash`. Use the JSON dump to list `animations[].name`.

On Windows without Node.js, get the standalone binary from `github.com/zeux/meshoptimizer/releases` (a zip, no npm needed) rather than `pnpm dlx gltfpack`. Check `command -v node` before assuming the documented pnpm commands are available.

## Validate the packed asset, not just the source

`chrono-arena/tools/asset-preview.html` reproduces the game's real lighting (IBL / ACES / SSAO / GlowLayer) and has a `SET` selector that deliberately includes **`TRELLIS.2 packed (in-game)`** — the exact file the game loads — alongside the uncompressed source. That option exists specifically so a preview/game divergence like the one above gets caught immediately rather than after a round of asset debugging. When you add a new packed asset, add it as a `packedPath` in that page's `models` map too.

It also has `VIEW` (Front / Game 俯瞰 / Side / Back / Turntable) and `MOTION` (the six clips) selectors, all reflected in the URL:

```bash
start "" "http://127.0.0.1:5173/tools/asset-preview.html?model=hero&set=packed&view=front&motion=Run"
```

Two practical notes on using it: the page **must** be served by the Vite dev server — opening `file:///…/asset-preview.html` leaves it stuck on "シーンを準備中…" forever, because bare module specifiers like `@babylonjs/core` can't resolve without the dev server, and that produces no visible error. And judge motion from `view=side`: leg swing in a run cycle is nearly invisible head-on and reads as "the animation isn't playing" when it's actually fine.
