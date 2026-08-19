---
name: windows-cuda-debug
description: Debug GPU/CUDA/PyTorch environment failures on Windows/NVIDIA machines. Use this whenever the user hits GPU/CUDA/driver/torch errors — torch.cuda.is_available() returning False, cudaErrorNotSupported, "DLL load failed while importing" for compiled CUDA extensions (.pyd), pip silently downgrading a GPU torch build to CPU, Hugging Face downloads failing with WinError 123 or gated-model 403s — while setting up or running any CUDA-dependent tool (ComfyUI, TRELLIS.2, diffusers, custom nodes) on this repo's Windows box or a similar machine. Field-tested knowledge, not generic advice.
---

# Windows CUDA/GPU environment debugging

TRELLIS.2 環境構築（image-to-3d-asset-trellis2 スキル）で実測して確立した、Windows/NVIDIA
マシンの CUDA/torch 環境デバッグ知見。エラーメッセージが原因を指さないものばかりなので、
一般論より本書を信じること。

## Check the GPU driver, not just the toolkit

Run `nvidia-smi` and read the **"CUDA Version"** field in the header — that's the max CUDA your *driver* supports, which is what actually matters for `torch.cuda.is_available()`. Two things trip people up here:

1. **Installing the CUDA Toolkit (nvcc) does not update the GPU driver.** They're separate installers. It's entirely possible to have `nvcc --version` report CUDA 13.x while the actual display driver still only supports CUDA 12.6 — in that state, any torch build newer than what the driver supports silently reports `cuda.is_available() == False` with `cudaErrorNotSupported`, and nothing in the Python error tells you the driver is the culprit.
2. **After a driver update, verify with more than one tool.** Cross-check `nvidia-smi`'s reported version against PowerShell: `Get-CimInstance Win32_VideoController | Select-Object DriverVersion,DriverDate`. If a user says they updated the driver but `nvidia-smi` looks unchanged, it's worth asking them to actually reboot — driver replacement often doesn't take effect until then even though the installer reports success.

Pick your PyTorch CUDA build (cu121/cu124/cu126/cu128/cu130/...) to match what the driver *currently* reports, not the newest thing available. If the user later updates their driver, newer builds become viable — recheck rather than assuming yesterday's answer still holds.

## The pip footgun that will silently undo your GPU torch install

After manually installing a specific GPU torch build (e.g. `torch==2.10.0+cu130`), running `pip install -r requirements.txt` for the host app or any other package can **silently downgrade torch to a CPU-only build** — requirements files list torch/torchvision/torchaudio without exact pins, and pip's resolver happily grabs a different (CPU) build from plain PyPI to satisfy the constraint. Nothing errors; you just end up with `torch.cuda.is_available() == False` again with no clear signal why.

**Always reinstall the exact pinned `torch` + `torchvision` + `torchaudio` triple from the matching `--index-url download.pytorch.org/whl/cuXXX`, LAST, after any other requirements.txt installs — then re-verify `torch.cuda.is_available()`.** Don't trust an earlier successful GPU-torch install to still be intact after subsequent pip installs.

## DLL loading failures for compiled CUDA extensions (.pyd)

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

```text
import os; d=r'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin'; os.path.isdir(d) and os.add_dll_directory(d)
```

This is preferable to patching the consuming project's own code, since it survives updates (`git pull`) and applies to every script that uses the venv.

If, after fixing the DLL path, the error changes from "module not found" to "procedure not found" (`ERROR_PROC_NOT_FOUND`), that's a different problem — the DLL now loads but a specific symbol it expects isn't present, usually a torch ABI/version mismatch for that one extension. Before spending time on it, `grep` the consumer's code for that extension's import name — if it's never actually used, it's dead weight and safe to ignore.

## Hugging Face downloads: a masked error, and gated models

- **The Xet fast-transfer backend (`hf-xet`) can produce a misleading `OSError: [WinError 123]`** (looks like an invalid-filename/path-length problem, pointing at a `.incomplete` temp file with a garbled-looking name) that is actually hiding a real `403 GatedRepoError` underneath. If a HF download throws WinError 123, don't assume it's a Windows path issue — set `HF_HUB_DISABLE_XET=1` and retry to see the real error.
- Gated Meta models (e.g. `facebook/dinov3-*`) require the **user themselves** to log into Hugging Face, open the model page, and click through the license/access-request flow — don't attempt this on their behalf, it means agreeing to a license and sharing contact info on their account. In practice, approval came through within minutes; it's worth just having them retry the download rather than assuming a long wait.
- dinov3 is gated **separately per model size** (`vitb16`, `vitl16`, etc.), but one Meta approval seemed to cover the whole family — an "access granted" email for a different size than you need isn't a sign something's wrong, just retry the actual download.
- Never go looking for an unofficial mirror of a gated model as a shortcut — that defeats a control the model owner put there on purpose.
