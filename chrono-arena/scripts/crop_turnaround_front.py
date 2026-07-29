#!/usr/bin/env python3
"""三面図（正面・真横・背面が横一列）から正面ビューだけを切り出す。

SPAR3D は単一ビューから3Dを起こすため、三面図をそのまま入れると3体が並んだ
形状になってしまう。正面だけを切り出し、正方形へパディングして渡す。

    python3 scripts/crop_turnaround_front.py <name> [<name> ...]

入力  assets/production/demonic/turnarounds/<name>.png
出力  assets/production/demonic/refs/<name>-nendo-front.png

背景は四隅の平均色から推定する。被写体の列方向の連結成分で3体を分離し、
一番左を正面とみなす。被写体の平均輝度も出す（0.15 未満だと SPAR3D の
テクスチャベイクが失敗しやすい）。
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TURNAROUND_DIR = ROOT / "assets/production/demonic/turnarounds"
OUTPUT_DIR = ROOT / "assets/production/demonic/refs"

# 背景との色差がこの値を超えた画素を被写体とみなす。
FOREGROUND_THRESHOLD = 0.06
# 幅がこの割合未満のランはノイズとして捨てる。
MIN_RUN_RATIO = 0.03
# 切り出しの余白（ピクセル）。
PADDING = 24
# この輝度を下回るとベイクが失敗しやすいので警告する。
LUMINANCE_WARN = 0.15


def background_color(pixels: np.ndarray) -> np.ndarray:
    """四隅 20x20 の平均を背景色とみなす。"""
    corners = np.concatenate([
        pixels[:20, :20].reshape(-1, 3),
        pixels[:20, -20:].reshape(-1, 3),
        pixels[-20:, :20].reshape(-1, 3),
        pixels[-20:, -20:].reshape(-1, 3),
    ])
    return corners.mean(axis=0)


def horizontal_runs(mask: np.ndarray, width: int) -> list[tuple[int, int]]:
    """被写体が存在する列の連結成分を返す。"""
    columns = mask.any(axis=0)
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, filled in enumerate(columns):
        if filled and start is None:
            start = index
        elif not filled and start is not None:
            if index - start > width * MIN_RUN_RATIO:
                runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, width))
    return runs


def split_by_valleys(mask: np.ndarray, runs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """連結成分で3ビューに割れなかったときに、列密度の谷で分割し直す。

    三面図でも体の間隔が狭いと背景の列が一本も残らず、隣の体とつながって
    検出される（chaser で発生）。その場合は列ごとの被写体ピクセル数を見て、
    最も密度が低い位置＝体の切れ目で分けるほうが正しい。
    """
    if len(runs) >= 3:
        return runs

    # 一番広いランを、そこに含まれる体の数だけ分割する。
    widest = max(runs, key=lambda run: run[1] - run[0])
    others = [run for run in runs if run is not widest]
    expected_inside = 3 - len(others)
    if expected_inside < 2:
        return runs

    density = mask[:, widest[0]:widest[1]].sum(axis=0).astype(np.float32)
    span = widest[1] - widest[0]
    # 端の付近は切れ目になり得ないので探索から外す。
    margin = int(span / expected_inside * 0.45)
    boundaries: list[int] = []
    for index in range(1, expected_inside):
        center = int(span * index / expected_inside)
        low = max(margin, center - margin)
        high = min(span - margin, center + margin)
        if low >= high:
            continue
        boundaries.append(widest[0] + low + int(np.argmin(density[low:high])))

    if len(boundaries) != expected_inside - 1:
        return runs

    edges = [widest[0], *boundaries, widest[1]]
    split = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
    return sorted([*others, *split])


def crop_front(name: str) -> None:
    source = TURNAROUND_DIR / f"{name}.png"
    if not source.exists():
        raise SystemExit(f"三面図がない: {source}")

    image = Image.open(source).convert("RGB")
    pixels = np.asarray(image).astype(np.float32) / 255.0
    height, width, _ = pixels.shape

    background = background_color(pixels)
    mask = np.abs(pixels - background).max(axis=-1) > FOREGROUND_THRESHOLD

    runs = horizontal_runs(mask, width)
    if not runs:
        raise SystemExit(f"{name}: 被写体を検出できなかった")
    if len(runs) < 3:
        runs = split_by_valleys(mask, runs)
    if len(runs) < 3:
        print(f"⚠️  {name}: 検出できたビューが {len(runs)} 個。三面図になっていない可能性がある", file=sys.stderr)

    # 一番左のランが正面。
    x0, x1 = runs[0]
    rows = np.where(mask[:, x0:x1].any(axis=1))[0]
    y0, y1 = int(rows.min()), int(rows.max()) + 1

    x0 = max(0, x0 - PADDING)
    x1 = min(width, x1 + PADDING)
    y0 = max(0, y0 - PADDING)
    y1 = min(height, y1 + PADDING)

    crop = image.crop((x0, y0, x1, y1))

    # SPAR3D は正方形入力を扱いやすい。背景色で埋めて中央に置く。
    side = max(crop.size)
    canvas = Image.new("RGB", (side, side), tuple((background * 255).astype(int)))
    canvas.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / f"{name}-nendo-front.png"
    canvas.save(destination)

    crop_pixels = np.asarray(crop).astype(np.float32) / 255.0
    subject = np.abs(crop_pixels - background).max(axis=-1) > FOREGROUND_THRESHOLD
    luminance = float(crop_pixels[subject].mean())
    warning = "  ⚠️ 暗すぎてベイクが失敗しやすい" if luminance < LUMINANCE_WARN else ""

    print(
        f"{name}: views={len(runs)} front=({x0},{y0})-({x1},{y1}) "
        f"crop={crop.size} square={canvas.size} 被写体平均輝度={luminance:.3f}{warning}"
    )
    print(f"  → {destination}")


def main() -> None:
    names = sys.argv[1:]
    if not names:
        names = sorted(path.stem for path in TURNAROUND_DIR.glob("*.png"))
    for name in names:
        crop_front(name)


if __name__ == "__main__":
    main()
