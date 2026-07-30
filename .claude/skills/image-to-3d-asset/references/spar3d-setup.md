# SPAR3D をローカル（Apple Silicon Mac）で動かす

Stability AI の SPAR3D（stable-point-aware-3d）は、画像1枚から**UV展開済み・テクスチャ付き glb** を出力する。CVPR 2025 の論文で前身の SF3D より裏面形状・アルベド品質が上と報告されており、README に M4 Max + PyTorch 2.5.1 のテスト実績が明記されている（SF3D は MPS でテクスチャが暗くなる未解決バグを抱えているので、Mac では SPAR3D を選ぶ）。

**上流リポジトリは2025年前半で更新が止まっている。** README 通りに進めると数箇所で必ず落ちる。以下はその回避策込みの手順。

## 前提

- Apple Silicon（M1以降）、macOS 15.2 以上
- 統合メモリ 24GB以上推奨（実測ピーク 15GB）
- ディスク: venv 約1.2GB + リポジトリ約80MB + 重み約1GB
- Hugging Face アカウント（重みが gated のため）
- ライセンス: Stability AI Community License — 年商100万USD未満なら商用利用可。「Powered by Stability AI」の表示義務あり

## 手順

### 1. 重みへのアクセス許可

https://huggingface.co/stabilityai/stable-point-aware-3d をブラウザで開き、ログインして **Agree and access repository** をクリックする（gated: auto なので即時承認）。

read 権限の access token を https://huggingface.co/settings/tokens で作り、ファイルに保存しておく（環境変数直書きやスクリプト埋め込みは避ける）:

```bash
umask 077; cat > /tmp/hf_token   # トークンを貼って Ctrl-D
chmod 600 /tmp/hf_token
```

確認:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -L \
  -H "Authorization: Bearer $(cat /tmp/hf_token)" \
  https://huggingface.co/stabilityai/stable-point-aware-3d/resolve/main/config.yaml
# 200 なら開通。403/401 なら Agree がまだ
```

### 2. リポジトリと仮想環境

```bash
ROOT=<プロジェクト>/tools/spar3d
mkdir -p "$ROOT" && cd "$ROOT"
git clone https://github.com/Stability-AI/stable-point-aware-3d repo
python3 -m venv venv          # Python 3.11 系が無難
./venv/bin/pip install -U pip wheel
./venv/bin/pip install torch torchvision   # arm64 の安定版でよい
./venv/bin/pip install -r repo/requirements.txt
```

**venv・重みキャッシュ・出力は .gitignore に入れる。** 重みは数GBあるのでリポジトリに入れない:

```
tools/spar3d/venv/
tools/spar3d/repo/
tools/spar3d/hf-cache/
tools/spar3d/output/
```

### 3. 既知バグの修正（3箇所）

**(a) `ModuleNotFoundError: No module named 'pkg_resources'`**

依存の alpha_clip が廃止済みAPIを使っている。setuptools を81未満に固定する:

```bash
./venv/bin/pip install "setuptools==80.9.0"
```

**(b) `AttributeError: 'Namespace' object has no attribute 'reduction_count_type'`**

`repo/run.py` はリメッシュ用オプションを条件付きで定義しているのに、無条件で参照している。防御的に読むよう1行直す:

```python
# repo/run.py
vertex_count = (
    -1
    if getattr(args, "reduction_count_type", "keep") == "keep"   # ← getattr にする
    else (...)
)
```

**(c) `NotImplementedError: Could not run 'UVUnwrapper::...' with arguments from the 'CPU' backend`**

これが一番厄介で、原因は**ネイティブ拡張が Metal の見えない環境でビルドされたこと**。`uv_unwrapper/setup.py` は `torch.backends.mps.is_available()` を見てビルド分岐するため、サンドボックス内やGPUが遮断された環境でビルドすると、カーネルが登録されない壊れた `.so` ができる。しかも pip キャッシュに残って再インストールしても直らない。

診断:

```bash
./venv/bin/python -c "
import torch, uv_unwrapper
print(torch._C._dispatch_dump('UVUnwrapper::assign_faces_uv_to_atlas_index')[:400])"
```

`CPU: registered at ...` の行があれば正常。`CUDA:` だけ、または登録行が無ければ壊れている。

修正 — **必ず通常のシェル（Metal が見える環境）で**クリーンビルドする:

```bash
cd "$ROOT/repo"
rm -rf uv_unwrapper/build texture_baker/build uv_unwrapper/*.egg-info texture_baker/*.egg-info
"$ROOT/venv/bin/pip" install --force-reinstall --no-deps --no-build-isolation --no-cache-dir \
  ./uv_unwrapper ./texture_baker
```

`--no-cache-dir` が要点。これを付けないと壊れたホイールが再利用される。

### 4. 実行ラッパー

`$ROOT/run-spar3d.sh` として置く（トークンは埋め込まず読み込む）:

```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
INPUT="$1"; OUTPUT="${2:-$ROOT/output}"; TEXRES="${3:-${TEXRES:-512}}"
export PYTORCH_ENABLE_MPS_FALLBACK=1
export HF_HOME="$ROOT/hf-cache"
[ -f /tmp/hf_token ] && export HF_TOKEN="$(< /tmp/hf_token)"
mkdir -p "$HF_HOME" "$OUTPUT"
source "$ROOT/venv/bin/activate"
cd "$ROOT/repo"
exec python run.py "$INPUT" --output-dir "$OUTPUT" --device mps --texture-resolution "$TEXRES"
```

初回実行時に重み（約1GB）がダウンロードされる。

**既存のラッパーを使う場合は `--texture-resolution` を渡しているか確認する。** 引数2個だけの古い版だと SPAR3D 既定の1024で焼かれ、小物でもファイルが不必要に大きくなる。渡していなければ上記の形へ直すか、`run.py` を直接呼ぶ。

### 5. 疎通確認

```bash
$ROOT/run-spar3d.sh <参照画像.png> $ROOT/output
node <skill>/scripts/check-glb.mjs $ROOT/output/0/mesh.glb
```

`TEXCOORD_0` と images が1枚以上あれば成功。

## 運用メモ

- 生成時間: 1体2〜3分（M4 Max 実測）。モデルのロードが支配的なので、複数体はバッチで回すと効率が良い
- ピークメモリ: 約15GB。他の重いアプリと同時に走らせない
- `--texture-resolution` は 512 / 1024 / 2048。小物は512で十分
- 出力は `<出力dir>/0/mesh.glb`（`points.ply` と `input.png` も同梱される）
- 実行環境によっては Metal が見えず CPU に落ちることがある（サンドボックス設定次第。サブエージェントから MPS で完走した実績もあるので、一律に諦めない）。**走らせる前に下の診断で確認する**:

  ```bash
  ./venv/bin/python -c "import torch; print('mps:', torch.backends.mps.is_available())"
  ```

  `False` なら、その環境ではビルドも実行もしない。`.so` を壊すのは主にビルド側なので、**ビルドだけは必ず Metal が見えるシェルで行う**

## 代替（参考）

- **SF3D**: より軽量だが MPS でテクスチャが暗くなる未解決 issue あり
- **Hunyuan3D-2.1 Mac フォーク**: 品質は上だがテクスチャ生成が CUDA 依存で不安定、形状生成も2〜5分
- **TRELLIS.2**: 品質は現行OSS最高クラスだが NVIDIA 24GB+ / Linux のみで Mac 不可
