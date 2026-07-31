---
name: local-image-to-3d
description: How to set up, debug, and run local image-to-3D asset generation on this Windows/NVIDIA machine using TRELLIS.2 in ComfyUI, replacing the broken SPAR3D path at tools/spar3d/run-spar3d.sh (hardcoded to macOS/MPS, does not run here). Use this whenever the user asks to set up or fix local 3D generation, mentions SPAR3D/TRELLIS/TRELLIS.2/ComfyUI in the context of this repo, wants to generate or regenerate a game asset (cauldron, props, dress-* items) from a reference image, or hits GPU/CUDA/driver/torch errors while doing AI 3D generation work here. Also consult this before recommending a cloud service (Meshy/Tripo) as the only option — a working local pipeline already exists once set up.
---

# Local image-to-3D generation (TRELLIS.2 on Windows/NVIDIA)

## Why this exists

`tools/spar3d/run-spar3d.sh` was written for a macOS dev machine (hardcoded `/Users/ny/...` paths, `--device mps`) and does not work on this Windows box, and SPAR3D's output quality is also clearly behind current open models anyway. TRELLIS.2 (Microsoft Research, via the community ComfyUI wrapper `visualbruno/ComfyUI-Trellis2`) is the validated replacement — it produces noticeably better geometry and can generate full PBR textures, and fits comfortably in 12GB VRAM using the FP8 model variant. A full working environment was built and verified end-to-end in `tools/trellis2/` (gitignored — see below) during the session that produced this skill; read this before rebuilding it from scratch or re-discovering the same gotchas.

Everything below was learned by hitting the problem, not by reading docs — trust it over generic ComfyUI/PyTorch advice you might otherwise reach for.

## Before touching anything: check the GPU driver, not just the toolkit

Run `nvidia-smi` and read the **"CUDA Version"** field in the header — that's the max CUDA your *driver* supports, which is what actually matters for `torch.cuda.is_available()`. Two things trip people up here:

1. **Installing the CUDA Toolkit (nvcc) does not update the GPU driver.** They're separate installers. It's entirely possible to have `nvcc --version` report CUDA 13.x while the actual display driver still only supports CUDA 12.6 — in that state, any torch build newer than what the driver supports silently reports `cuda.is_available() == False` with `cudaErrorNotSupported`, and nothing in the Python error tells you the driver is the culprit.
2. **After a driver update, verify with more than one tool.** Cross-check `nvidia-smi`'s reported version against PowerShell: `Get-CimInstance Win32_VideoController | Select-Object DriverVersion,DriverDate`. If a user says they updated the driver but `nvidia-smi` looks unchanged, it's worth asking them to actually reboot — driver replacement often doesn't take effect until then even though the installer reports success.

Pick your ComfyUI/PyTorch CUDA build (cu121/cu124/cu126/cu128/cu130/...) to match what the driver *currently* reports, not the newest thing available. If the user later updates their driver, newer builds become viable — recheck rather than assuming yesterday's answer still holds.

## Python environment: don't trust `python` on PATH, and watch Python-version drift

- On this machine, the system `python`/`pip` resolve to a Windows Store stub (`AppData\Local\Microsoft\WindowsApps\python.exe`) that does not actually work. Check with `python -m pip --version` before relying on it. If broken, grab the real installer from python.org and install it to a project-local folder (e.g. `tools/trellis2/python312/`) with silent, non-PATH-polluting flags: `/quiet InstallAllUsers=0 PrependPath=0 TargetDir="..."`. This avoids fighting the broken stub or affecting other projects on the machine.
- **ComfyUI's official "Windows Portable" build bundles its own embedded Python + PyTorch, and that version drifts over time** (it was Python 3.13 + torch cu130 when this was built). A custom node's precompiled wheels are tied to specific `cpXXX` tags (e.g. cp311/cp312 only) — if the portable build's Python is newer than the wheels support, the wheels simply won't install, and the portable build is a dead end for that node no matter what else you try.
  - **Check the node's wheel filenames for their `cpXXX` tag BEFORE deciding between the portable build and a hand-built venv.** If there's a mismatch, skip the portable zip entirely: install a matching Python version yourself, `python -m venv`, then `git clone` ComfyUI from source (much smaller than the portable download and gives you full control of the Python version) instead of fighting the portable build's fixed interpreter.
  - Check `download.pytorch.org/whl/<cuXXX>/` for what torch/torchvision/torchaudio versions actually exist for your target `cuXXX` + Python tag before committing to a plan — don't assume a version exists just because the node's docs mention it.

### The pip footgun that will silently undo your GPU torch install

After manually installing a specific GPU torch build (e.g. `torch==2.10.0+cu130`), running `pip install -r requirements.txt` for ComfyUI itself or any other node can **silently downgrade torch to a CPU-only build** — the requirements file lists torch/torchvision/torchaudio without exact pins, and pip's resolver happily grabs a different (CPU) build from plain PyPI to satisfy the constraint. Nothing errors; you just end up with `torch.cuda.is_available() == False` again with no clear signal why.

**Always reinstall the exact pinned `torch` + `torchvision` + `torchaudio` triple from the matching `--index-url download.pytorch.org/whl/cuXXX`, LAST, after any other requirements.txt installs — then re-verify `torch.cuda.is_available()`.** Don't trust an earlier successful GPU-torch install to still be intact after subsequent pip installs.

## DLL loading failures for compiled CUDA extensions (cumesh, nvdiffrast, o_voxel, flex_gemm, ...)

Precompiled `.pyd` extensions can be built against a *different* CUDA runtime DLL than what your environment otherwise provides (e.g. the extension needs `cudart64_12.dll` even though everything else in the environment is CUDA 13). The symptom is `ImportError: DLL load failed while importing _C`, often rendered as garbled/mojibake text in a non-Japanese-locale terminal — that garbled text is just Windows' localized "指定されたモジュールが見つかりません" (module not found).

Windows has no readily-available `ldd`/`objdump` for this (git-bash's `objdump` is usually missing too). Diagnose properly instead of guessing:

```python
pip install pefile
python -c "
import pefile
pe = pefile.PE('path/to/extension.pyd')
for entry in pe.DIRECTORY_ENTRY_IMPORT:
    print(entry.dll.decode())
"
```

This prints the exact DLL dependency list (e.g. reveals `cudart64_12.dll`). Once you know the missing DLL, look for it under an older CUDA Toolkit install that may still be present alongside a newer one (e.g. `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin\`), and make Python find it automatically by dropping a **one-line `.pth` file** into the venv's `site-packages` (`.pth` files starting with `import ` execute at interpreter startup, before any user code):

```
import os; d=r'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin'; os.path.isdir(d) and os.add_dll_directory(d)
```

This is preferable to patching the node's own code, since it survives the node being updated (`git pull`) and applies to every script that uses the venv.

If, after fixing the DLL path, the error changes from "module not found" to "procedure not found" (`ERROR_PROC_NOT_FOUND`), that's a different problem — the DLL now loads but a specific symbol it expects isn't present, usually a torch ABI/version mismatch for that one extension. Before spending time on it, `grep` the node's own `nodes.py` for that extension's import name — if it's never actually used by any node, it's dead weight and safe to ignore.

## Hugging Face downloads: a masked error, and gated models

- **The Xet fast-transfer backend (`hf-xet`) can produce a misleading `OSError: [WinError 123]`** (looks like an invalid-filename/path-length problem, pointing at a `.incomplete` temp file with a garbled-looking name) that is actually hiding a real `403 GatedRepoError` underneath. If a HF download throws WinError 123, don't assume it's a Windows path issue — set `HF_HUB_DISABLE_XET=1` and retry to see the real error.
- Gated Meta models (e.g. `facebook/dinov3-*`, needed by Trellis2) require the **user themselves** to log into Hugging Face, open the model page, and click through the license/access-request flow — don't attempt this on their behalf, it means agreeing to a license and sharing contact info on their account. In this session, approval came through within minutes; it's worth just having them retry the download rather than assuming a long wait.
- dinov3 is gated **separately per model size** (`vitb16`, `vitl16`, etc.), but one Meta approval seemed to cover the whole family — an "access granted" email for a different size than you need isn't a sign something's wrong, just retry the actual download.
- Never go looking for an unofficial mirror of a gated model as a shortcut — that defeats a control the model owner put there on purpose.

## The ComfyUI-Trellis2 node itself

Use **`visualbruno/ComfyUI-Trellis2`** — it's the actively maintained project (hundreds of stars, frequent updates). The various "-GGUF"-named forks found during research turned out to be near-empty (0 stars) and just pointed back at visualbruno's own repos anyway; they're not a separate, better option.

- **For a 12GB-VRAM card, use `visualbruno/TRELLIS.2-4B-FP8`** as the `modelname` on the `Trellis2LoadModel` node (~8GB download, auto-fetched via `snapshot_download` into `ComfyUI/models/<modelname>/` on first use) — not the default `microsoft/TRELLIS.2-4B` (full precision, needs 16-24GB and won't fit).
- The `sparse_backend` widget only accepts `xformers` or `flash_attn` — **not `sdpa`** (you'll get a "Value not in list" validation error). `flash_attn` is painful to build on Windows; install `xformers` instead, matching your torch build's CUDA index: `pip install -U xformers --index-url https://download.pytorch.org/whl/cuXXX`. The plain `backend` widget (not `sparse_backend`) does accept `sdpa` fine.
- **Minor node bug**: it unconditionally tries to copy `reconviagen_pipeline.json` into `models/microsoft/TRELLIS.2-4B/` regardless of which `modelname` you actually picked, and crashes with `FileNotFoundError` if that folder doesn't exist (e.g. because you're using the FP8 variant, which lives under `models/visualbruno/...` instead). Workaround: just `mkdir -p ComfyUI/models/microsoft/TRELLIS.2-4B` ahead of time.
- Also needs `facebook/dinov3-vitl16-pretrain-lvd1689m` at `ComfyUI/models/facebook/dinov3-vitl16-pretrain-lvd1689m/` (see gating notes above), and a small extra pair of files from `microsoft/TRELLIS-image-large` (`ckpts/ss_dec_conv3d_16l8_fp16.{json,safetensors}`, ~150MB) — the node tries to auto-fetch these too but pre-placing them avoids surprises mid-run.
- **Driving the workflow via the browser is much more reliable through the JS API than clicking through the UI.** ComfyUI's frontend exposes a global `window.app`. Load an example workflow (copy the file from `custom_nodes/ComfyUI-Trellis2/example_workflows/*.json` into `ComfyUI/user/default/workflows/` first) with:
  ```js
  const data = await (await fetch('/api/userdata/workflows%2FName.json')).json();
  await window.app.loadGraphData(data);
  ```
  Then edit node widgets directly via `window.app.graph._nodes.find(n => n.id == <id>).widgets.find(w => w.name === '<widget>').value = ...`, and execute with `await window.app.queuePrompt(0)`. This sidesteps flaky UI-panel navigation in browser automation entirely.
- `MeshOnly.json` (shape only, ~13 min on an RTX 4070 SUPER) is a good fast smoke test before trying `MeshWithTexturing.json` (adds PBR texture, ~16 min). Peak VRAM usage stayed well under half of a 12GB card in testing — there's headroom.

## No Node.js? Don't assume it's there

This machine had no Node/npm/pnpm at all, which blocks this repo's documented asset tooling (`pnpm dlx gltfpack`, `node tools/make-placeholder-glbs.mjs`, `game/tools/fable-decimate.mjs`). Check with `command -v node` before assuming any of that works.

Workarounds that don't require installing Node.js just for one tool:
- **gltfpack**: download the standalone Windows binary directly from `github.com/zeux/meshoptimizer/releases` (a small zip) instead of going through `pnpm dlx`.
- **Serving the static game locally**: `python -m http.server <port>` from whatever Python you set up above works fine — the game (`moonlit-potion-workshop/game/`) is plain static files with no build step.

### gltfpack settings that hit this project's asset budgets

The project's own `assets/README.md` documents per-file budgets (e.g. `cauldron.glb` ≤3MB). Raw TRELLIS.2 exports with texture are large (tens of MB) and need compression to fit:

```
gltfpack.exe -i in.glb -o out.glb -cc -tw -tq 6 -tl 1024 -si 0.6
```

- `-cc`: higher meshopt compression ratio
- `-tw`: WebP textures (Babylon.js/browsers handle these natively — avoid `-tc`/KTX2, which the project's own README flags as adding extra decoder dependencies)
- `-tq 6` / `-tl 1024`: texture quality / max dimension
- `-si 0.6`: simplify mesh to 60% of original triangle count

This took a 24.6MB raw export down to 1.85MB in testing, comfortably under budget. Adjust `-si`/`-tl` if a particular asset needs to look sharper or shrink further.

**Don't use `trimesh` (Python) to sanity-check a gltfpack `-c`/`-cc`-compressed file** — it uses the `EXT_meshopt_compression` glTF extension, which trimesh can't decode (`IndexError: list index out of range`). Preview the *uncompressed* export with trimesh if you want a quick Python-side render; trust the actual target engine (Babylon.js here) to validate the final compressed file.

Packing a GLB for these games has its own set of silent-failure traps — most notably a glTF extension the loader ignores *without erroring*, which makes a correctly-generated asset render as a different model in-game. Those are documented separately in the **`glb-compression-pipeline`** skill; read it before debugging any "looks right in Blender/preview, wrong in-game" symptom, and before changing gltfpack flags.

## Browser-automation quirks worth knowing up front

- `computer` screenshot/zoom actions fail with "Browser pane is not displayed" whenever the user hasn't got that pane visually open on their end — this can't be fixed from the agent side; just ask them to open/show it.
- `canvas.toDataURL()` as a screenshot workaround is unreliable when the tab is backgrounded: WebGL canvases without `preserveDrawingBuffer` return near-blank images right after render, and `requestAnimationFrame` can hang entirely while the tab is hidden (throttled), timing out the whole call. Don't burn time forcing this — ask the user to bring the pane into view instead.

## Working directory conventions

The working environment lives under `tools/trellis2/` and is fully gitignored (`downloads/`, `ComfyUI_windows_portable/`, `python312/`, `venv/`, `ComfyUI/`, `secrets/`, `comparison/`) — mirroring the existing `tools/spar3d/{venv,repo,hf-cache,output}/` pattern in `.gitignore`. Keep any HF tokens in `tools/trellis2/secrets/` (never commit them, never paste them into scripts that get committed) and keep scratch/comparison renders in `tools/trellis2/comparison/` rather than in the actual game asset folders.

## Committing generated assets back into the game

When a regenerated asset is ready to replace a file under `moonlit-potion-workshop/game/assets/models/`:
1. Back up the original first.
2. Check the resulting file size against this project's documented budgets in `assets/README.md` before committing.
3. Stage files explicitly (`git add <file> <file>`), never `git add -A` — this repo's local tooling directories sit right next to the asset folders and a blanket add can easily sweep in gigabytes of unrelated local environment files.
4. Never run `git config` on the user's behalf, even mid-task when it's blocking a commit they asked for — ask them to set their identity themselves and wait for confirmation.
