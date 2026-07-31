#!/usr/bin/env python3
"""TRELLIS.2 の生 glb を配信予算まで詰めて、ゲームの models/ へ入れる。

  python tools/trellis2/pack_for_game.py --src <生成物ディレクトリ> [--install] [--dry-run]

生成物は 2048² テクスチャ・約 47 万面のまま出力されるので、ここで
  gltfpack -si R -tl <上限> -tw -tq 9 -cc
にかけて EXT_meshopt_compression + WebP へ落とす。R は予算に収まる最大値を候補から選ぶ。

テクスチャ上限はプロップの見え方で決める（接写・操作対象は 1024²、飾りは 512²）。
ゲーム側ローダーは取り込み時に bounding box からスケールと中心を正規化するため、
差し替えで配置がずれることはない（向きだけは glb 側の姿勢がそのまま出る）。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

SP = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(SP, "..", ".."))
MODELS = os.path.join(REPO, "moonlit-potion-workshop", "game", "assets", "models")
GLTFPACK = os.environ.get(
    "GLTFPACK",
    r"C:\Users\yamau\work\babylon\tools\trellis2\downloads\gltfpack\gltfpack.exe")

# 接写・操作対象のヒーロープロップ。それ以外の飾りは 512²。
HERO_1024 = {"appraisal-lens", "cauldron", "cutting-board", "delivery-tray",
             "heat-dial", "jar", "knife", "mortar", "pestle"}
BUDGET_MB = {True: 1.0, False: 0.6}      # 1024² 組 / 512² 組
RATIOS = [0.30, 0.22, 0.16, 0.12, 0.09, 0.07, 0.05, 0.035, 0.025, 0.015]


def pack(src, dst, texture_limit, budget_mb):
    """予算に収まる最大の簡約率を探して詰める。戻り値は (採用比率, MB)。"""
    chosen, size_mb = None, None
    for ratio in RATIOS:
        subprocess.run([GLTFPACK, "-i", src, "-o", dst, "-si", str(ratio),
                        "-se", "0.02", "-tl", str(texture_limit), "-tw",
                        "-tq", "9", "-cc"],
                       check=True, capture_output=True, text=True)
        size_mb = os.path.getsize(dst) / 1048576
        if size_mb <= budget_mb:
            chosen = ratio
            break
    if chosen is None:
        # 薄い枠や細い部品は -se 0.02 の誤差上限で簡約が頭打ちになる。
        # そこで無理に潰すと形が壊れるので、最小比率の結果をそのまま採用して報告する。
        chosen = RATIOS[-1]
    return chosen, size_mb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", action="append", required=True,
                    help="<name>-trellis2-textured.glb を含むディレクトリ（複数可）")
    ap.add_argument("--out-dir", default=os.path.join(SP, "packed"))
    ap.add_argument("--install", action="store_true", help="models/ へ上書きする")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    found = {}
    for directory in args.src:
        for filename in sorted(os.listdir(directory)):
            if filename.endswith("-trellis2-textured.glb"):
                found[filename[: -len("-trellis2-textured.glb")]] = \
                    os.path.join(directory, filename)
    if not found:
        sys.exit("生成物が見つかりません")

    os.makedirs(args.out_dir, exist_ok=True)
    rows, total_before, total_after = [], 0.0, 0.0
    for name, src in found.items():
        target = os.path.join(MODELS, f"{name}.glb")
        if not os.path.isfile(target):
            print(f"  スキップ（models/ に無い）: {name}")
            continue
        before = os.path.getsize(target) / 1048576
        limit = 1024 if name in HERO_1024 else 512
        dst = os.path.join(args.out_dir, f"{name}.glb")
        if args.dry_run:
            rows.append((name, before, 0.0, limit, 0.0))
            continue
        ratio, after = pack(src, dst, limit, BUDGET_MB[limit == 1024])
        total_before += before
        total_after += after
        rows.append((name, before, after, limit, ratio))
        if args.install:
            shutil.copy2(dst, target)
        print(f"  {name:26} {before:5.2f} -> {after:5.2f} MB  tex {limit}  si={ratio}",
              flush=True)

    print(f"\n{len(rows)} 点: {total_before:.1f} MB -> {total_after:.1f} MB"
          f"{'（models/ へ導入済み）' if args.install else '（out-dir に出力のみ）'}")


if __name__ == "__main__":
    main()
