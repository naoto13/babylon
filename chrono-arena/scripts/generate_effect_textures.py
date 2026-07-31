#!/usr/bin/env python3
"""Chrono Arena の加算合成用エフェクトテクスチャを数式だけで生成する。

外部アセットには依存せず、numpy と Pillow のみで PNG (RGBA) を作る。
スプライトシートの時間パラメータは 2π 周期なので、63 番フレームから
0 番フレームへ戻るときも同じ速度で連続する。
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "production" / "effects"
FRAME_SIZE = 128
SHEET_FRAMES = 8
SHEET_SIZE = FRAME_SIZE * SHEET_FRAMES
RUNE_SIZE = 512
AA = 3
LANCZOS = Image.Resampling.LANCZOS


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    """GLSL 風の滑らかな閾値。輪郭をアンチエイリアス的に柔らかくする。"""
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _hash_lattice(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    """整数格子点ごとの決定的な乱数。value noise の値そのもの。"""
    return np.mod(
        np.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123,
        1.0,
    )


def value_noise(x: np.ndarray, y: np.ndarray, seed: int) -> np.ndarray:
    """双一次補間した value noise。外部ノイズ実装は使用しない。"""
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    tx = x - x0
    ty = y - y0
    sx = tx * tx * (3.0 - 2.0 * tx)
    sy = ty * ty * (3.0 - 2.0 * ty)
    n00 = _hash_lattice(x0, y0, seed)
    n10 = _hash_lattice(x0 + 1, y0, seed)
    n01 = _hash_lattice(x0, y0 + 1, seed)
    n11 = _hash_lattice(x0 + 1, y0 + 1, seed)
    nx0 = n00 + (n10 - n00) * sx
    nx1 = n01 + (n11 - n01) * sx
    return nx0 + (nx1 - nx0) * sy


def periodic_fbm(
    x: np.ndarray,
    y: np.ndarray,
    phase: float,
    seed: int,
    octaves: int = 4,
    base_frequency: float = 2.0,
) -> np.ndarray:
    """円軌道でスクロールする、時間方向にも周期的な fractal value noise。"""
    total = np.zeros_like(x, dtype=np.float64)
    normalizer = 0.0
    amplitude = 1.0
    frequency = base_frequency
    for octave in range(octaves):
        # sin/cos のオフセットは phase=0 と 2π で完全に同じ座標へ戻る。
        orbit = 0.38 + octave * 0.17
        sample_x = x * frequency + math.cos(phase + octave * 0.73) * orbit * frequency
        sample_y = y * frequency + math.sin(phase + octave * 1.11) * orbit * frequency
        total += amplitude * value_noise(sample_x, sample_y, seed + octave * 101)
        normalizer += amplitude
        amplitude *= 0.52
        frequency *= 2.03
    return total / normalizer


def grid(size: int) -> tuple[np.ndarray, np.ndarray]:
    axis = np.linspace(-1.0, 1.0, size, dtype=np.float64)
    return np.meshgrid(axis, axis)


def rgba_from_alpha(alpha: np.ndarray, brightness: np.ndarray | float | None = None) -> Image.Image:
    """透明背景を保ちつつ、加算合成向けの白〜グレー RGBA を作る。"""
    visible = np.clip(alpha, 0.0, 1.0)
    if brightness is None:
        brightness = 0.48 + 0.52 * np.sqrt(visible)
    brightness_array = np.broadcast_to(brightness, visible.shape)
    # 透明画素の RGB も 0 にして、テクスチャ単体でも完全透明背景にする。
    rgb = np.where(visible > 1e-4, np.clip(brightness_array, 0.0, 1.0) * 255.0, 0.0)
    packed = np.dstack((rgb, rgb, rgb, visible * 255.0)).astype(np.uint8)
    return Image.fromarray(packed, "RGBA")


def write_image(name: str, image: Image.Image) -> Path:
    if image.mode != "RGBA":
        raise ValueError(f"{name} must be RGBA, got {image.mode}")
    destination = OUT_DIR / name
    image.save(destination, optimize=True)
    return destination


def flame_frame(frame: int) -> Image.Image:
    """上に細く伸びる複数の炎の舌。ノイズを周期スクロールする。"""
    x, y = grid(FRAME_SIZE)
    phase = math.tau * frame / (SHEET_FRAMES * SHEET_FRAMES)
    upward = (y + 1.0) * 0.5  # 下端=0、上端=1 になるように反転済みの座標。
    upward = 1.0 - upward
    coarse = periodic_fbm(x, y, phase, seed=11, octaves=4, base_frequency=1.7)
    detail = periodic_fbm(x * 1.9, y * 1.15, phase, seed=29, octaves=3, base_frequency=3.1)

    # 根元で重なる三つの炎舌を作る。中央は高く、両側は早く消えるので
    # 単なる縦のノイズではなく「下が太く、上で分かれて細くなる」形になる。
    body = np.zeros_like(x)
    for index, (base_center, base_tip) in enumerate(((0.0, 0.99), (-0.25, 0.73), (0.25, 0.69))):
        tip = base_tip + 0.065 * math.sin(phase + index * 2.21)
        remaining = np.clip(1.0 - upward / tip, 0.0, 1.0)
        local_sway = base_center * (0.18 + upward * 0.82)
        local_sway += 0.075 * np.sin(phase + upward * (6.0 + index))
        local_sway += (coarse - 0.5) * 0.11 * upward
        tongue_width = 0.29 * np.power(remaining, 0.48) + 0.013
        distance = np.abs(x - local_sway) / tongue_width
        tongue = smoothstep(1.20, 0.48, distance) * smoothstep(0.012, 0.065, remaining)
        body = np.maximum(body, tongue)
    # 炎の縁だけを少し崩し、芯を縦縞にはしない。
    edge_texture = 0.82 + 0.18 * detail
    alpha = body * edge_texture
    brightness = 0.56 + 0.44 * np.clip(body + (1.0 - upward) * 0.18, 0.0, 1.0)
    return rgba_from_alpha(alpha, brightness)


def smoke_frame(frame: int) -> Image.Image:
    """丸い煙塊がゆっくり膨張・拡散する、低コントラストのループ。"""
    x, y = grid(FRAME_SIZE)
    phase = math.tau * frame / (SHEET_FRAMES * SHEET_FRAMES)
    density = np.zeros_like(x)
    for index in range(10):
        offset = index * 2.399963229728653  # golden angle: 塊を偏らせない。
        drift = phase + offset
        # 係数は整数に限定し、phase が 2π 周した時に各煙塊も厳密に元へ戻す。
        center_x = 0.35 * math.sin(drift) + 0.12 * math.sin(drift * 2.0 + index)
        center_y = 0.16 + 0.50 * math.sin(drift + index * 0.37)
        radius = 0.20 + 0.11 * (0.5 + 0.5 * math.sin(drift * 2.0))
        cloud = np.exp(-(((x - center_x) / radius) ** 2 + ((y - center_y) / (radius * 0.78)) ** 2) * 1.55)
        density += cloud * (0.62 + 0.38 * math.sin(drift + 0.8))
    noise = periodic_fbm(x, y, phase, seed=73, octaves=3, base_frequency=1.45)
    # 濃度の立ち上がりを強めて塊を実体化させる。0.56 では最大アルファが 0.36 しか
    # 出ず、加算合成に載せても煙が見えなかった。
    alpha = 1.0 - np.exp(-density * 1.35)
    alpha *= 0.62 + noise * 0.38
    # 上へ広がる煙らしい薄さを加え、下端を少し濃く残す。
    alpha *= 0.74 + 0.26 * (y + 1.0) * 0.5
    return rgba_from_alpha(np.clip(alpha * 1.25, 0.0, 1.0), 0.48 + alpha * 0.30)


def shockwave_frame(frame: int) -> Image.Image:
    """膨張と収束を滑らかに繰り返す、縁が少し崩れた円環。"""
    x, y = grid(FRAME_SIZE)
    phase = math.tau * frame / (SHEET_FRAMES * SHEET_FRAMES)
    radius = np.sqrt(x * x + y * y)
    angle = np.arctan2(y, x)
    pulse = 0.5 + 0.5 * math.sin(phase)
    ring_radius = 0.34 + pulse * 0.48
    thickness = 0.082 - pulse * 0.042
    edge_noise = periodic_fbm(np.cos(angle), np.sin(angle), phase, seed=101, octaves=3, base_frequency=4.3)
    irregular_radius = ring_radius + (edge_noise - 0.5) * (0.050 + pulse * 0.026)
    ring = np.exp(-0.5 * ((radius - irregular_radius) / max(thickness, 0.012)) ** 2)
    streaks = np.power(np.clip(edge_noise * 1.24, 0.0, 1.0), 1.7)
    alpha = ring * (0.40 + 0.60 * streaks) * (0.98 - pulse * 0.32)
    return rgba_from_alpha(alpha, 0.56 + 0.44 * ring)


def sheet(frame_function) -> Image.Image:
    canvas = Image.new("RGBA", (SHEET_SIZE, SHEET_SIZE), (0, 0, 0, 0))
    for frame in range(SHEET_FRAMES * SHEET_FRAMES):
        tile = frame_function(frame)
        canvas.alpha_composite(tile, ((frame % SHEET_FRAMES) * FRAME_SIZE, (frame // SHEET_FRAMES) * FRAME_SIZE))
    return canvas


def jagged_segment(
    start: tuple[float, float],
    end: tuple[float, float],
    depth: int,
    displacement: float,
    rng: random.Random,
) -> list[tuple[float, float]]:
    """midpoint displacement で折れた稲妻の一本線を作る。"""
    if depth == 0:
        return [start, end]
    mx = (start[0] + end[0]) * 0.5
    my = (start[1] + end[1]) * 0.5
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = max(math.hypot(dx, dy), 1e-5)
    # 線の法線方向を大きく乱すため、縦の電撃でもジグザグが読める。
    mx += (-dy / length) * rng.uniform(-displacement, displacement)
    my += (dx / length) * rng.uniform(-displacement * 0.16, displacement * 0.16)
    midpoint = (mx, my)
    left = jagged_segment(start, midpoint, depth - 1, displacement * 0.57, rng)
    right = jagged_segment(midpoint, end, depth - 1, displacement * 0.57, rng)
    return left[:-1] + right


def lightning_arc() -> Image.Image:
    """白い芯、ぼかした外光、明瞭な枝を持つ縦方向の稲妻。"""
    size = RUNE_SIZE
    rng = random.Random(0xC0FFEE)
    main = jagged_segment((258.0, 34.0), (250.0, 480.0), depth=5, displacement=41.0, rng=rng)
    paths: list[tuple[list[tuple[float, float]], int]] = [(main, 1)]
    branch_specs = ((7, -132.0, 92.0), (15, 116.0, 78.0), (23, -96.0, 70.0), (27, 82.0, 58.0))
    for source_index, x_offset, length in branch_specs:
        source = main[source_index]
        target = (source[0] + x_offset, min(482.0, source[1] + length))
        paths.append((jagged_segment(source, target, depth=3, displacement=22.0, rng=rng), 0))

    glow = Image.new("L", (size, size), 0)
    halo = Image.new("L", (size, size), 0)
    core = Image.new("L", (size, size), 0)
    glow_draw = ImageDraw.Draw(glow)
    halo_draw = ImageDraw.Draw(halo)
    core_draw = ImageDraw.Draw(core)
    for points, is_main in paths:
        width_factor = 1.0 if is_main else 0.62
        glow_draw.line(points, fill=180, width=max(3, round(20 * width_factor)), joint="curve")
        halo_draw.line(points, fill=230, width=max(2, round(8 * width_factor)), joint="curve")
        core_draw.line(points, fill=255, width=max(1, round(3 * width_factor)), joint="curve")
    outer = glow.filter(ImageFilter.GaussianBlur(11))
    middle = halo.filter(ImageFilter.GaussianBlur(3))
    alpha = np.maximum.reduce(
        (np.asarray(outer, dtype=np.float64) * 0.66, np.asarray(middle, dtype=np.float64), np.asarray(core, dtype=np.float64))
    ) / 255.0
    return rgba_from_alpha(alpha, 0.72 + np.clip(alpha * 1.2, 0.0, 0.28))


def spark() -> Image.Image:
    """中心の核と六方向の尖りを持つ、短寿命の火花。"""
    x, y = grid(64)
    radial = np.exp(-(x * x + y * y) / 0.070)
    rays = np.zeros_like(x)
    for angle in (0.0, math.pi / 3.0, math.pi * 2.0 / 3.0):
        along = x * math.cos(angle) + y * math.sin(angle)
        across = -x * math.sin(angle) + y * math.cos(angle)
        rays = np.maximum(rays, np.exp(-(along * along / 0.72 + across * across / 0.010)))
    alpha = np.maximum(radial, rays * 0.64)
    return rgba_from_alpha(alpha, 0.66 + 0.34 * radial)


def soft_particle() -> Image.Image:
    """汎用パーティクル用の完全に滑らかなガウシアン円。"""
    x, y = grid(64)
    alpha = np.exp(-(x * x + y * y) / 0.19)
    return rgba_from_alpha(alpha, 0.52 + 0.48 * alpha)


def polar(center: tuple[float, float], radius: float, angle: float) -> tuple[float, float]:
    return center[0] + math.cos(angle) * radius, center[1] + math.sin(angle) * radius


def rune_mask(kind: str) -> Image.Image:
    """属性ごとに異なる幾何学形状を高解像度マスクへ描く。"""
    size = RUNE_SIZE * AA
    center = (size / 2.0, size / 2.0)
    draw = ImageDraw.Draw(mask := Image.new("L", (size, size), 0))

    def ring(radius: float, width: float = 2.0) -> None:
        r = radius * AA
        draw.ellipse((center[0] - r, center[1] - r, center[0] + r, center[1] + r), outline=225, width=max(1, round(width * AA)))

    def line(points: list[tuple[float, float]], width: float = 2.0, fill: int = 235) -> None:
        draw.line([(x * AA, y * AA) for x, y in points], fill=fill, width=max(1, round(width * AA)), joint="curve")

    def polygon(points: list[tuple[float, float]], width: float = 2.0) -> None:
        scaled = [(x * AA, y * AA) for x, y in points]
        draw.line(scaled + [scaled[0]], fill=240, width=max(1, round(width * AA)), joint="curve")

    def filled_polygon(points: list[tuple[float, float]], fill: int = 235) -> None:
        """装飾の面を描く。時計針のように線だけでは読めない形へ使う。"""
        draw.polygon([(x * AA, y * AA) for x, y in points], fill=fill)

    def small_ring(point: tuple[float, float], radius: float, width: float = 1.4, fill: int = 230) -> None:
        """歯車のリベットなど、中心以外に置く小さな円環。"""
        x, y = point[0] * AA, point[1] * AA
        r = radius * AA
        draw.ellipse((x - r, y - r, x + r, y + r), outline=fill, width=max(1, round(width * AA)))

    # 全属性が共有する外縁。中身の記号で用途を読み分けられるようにする。
    ring(226, 2.5)
    ring(208, 1.1)

    if kind == "fire":
        ring(126, 2.0)
        polygon([polar((256, 256), 103, -math.pi / 2 + step * math.tau / 3) for step in range(3)], 3.0)
        for index in range(12):
            angle = index * math.tau / 12 - math.pi / 2
            # 炎の舌を思わせる、内向きの細長い三角形と放射。
            outer = polar((256, 256), 194, angle)
            left = polar((256, 256), 143, angle - 0.10)
            tip = polar((256, 256), 164, angle + 0.02)
            right = polar((256, 256), 143, angle + 0.10)
            polygon([left, tip, right], 1.6)
            line([polar((256, 256), 205, angle), outer], 2.2)
        # 中央の小さな上向き火焔。
        polygon([(256, 164), (220, 273), (256, 241), (292, 273)], 2.2)
    elif kind == "lightning":
        ring(146, 2.2)
        for index in range(16):
            angle = index * math.tau / 16
            points = [polar((256, 256), 112, angle)]
            for radius, jitter in ((143, -0.075), (165, 0.058), (194, -0.045)):
                points.append(polar((256, 256), radius, angle + jitter))
            line(points, 2.2)
        for index in range(8):
            angle = index * math.tau / 8
            line([polar((256, 256), 199, angle - 0.08), polar((256, 256), 218, angle + 0.08)], 3.0)
    elif kind == "void":
        # 渦ではなく、逆五芒星と直線的な棘を主役にした禍々しい紋章。
        ring(181, 1.8)
        polygon([polar((256, 256), 194, -math.pi / 2 + step * math.tau / 10) for step in range(10)], 1.7)
        polygon([polar((256, 256), 166, -math.pi / 2 + step * math.tau / 10) for step in range(10)], 1.25)
        # 下向きの頂点を持つ五芒星風の逆シンボルを、中央の主役として残す。
        star = [polar((256, 256), 121, math.pi / 2 + step * math.tau / 5) for step in range(5)]
        order = [0, 2, 4, 1, 3]
        polygon([star[item] for item in order], 3.0)
        for arm in range(5):
            angle = math.pi / 2 + arm * math.tau / 5
            # 外周から星へ向かう楔と、その先端の短い棘。曲線・収束線は一切使わない。
            polygon(
                [
                    polar((256, 256), 154, angle - 0.105),
                    polar((256, 256), 190, angle - 0.046),
                    polar((256, 256), 202, angle),
                    polar((256, 256), 190, angle + 0.046),
                    polar((256, 256), 154, angle + 0.105),
                ],
                2.0,
            )
            line([polar((256, 256), 127, angle), polar((256, 256), 150, angle)], 2.2)
        # 五芒星の中心を塗り潰さず、重ねた地面やキャラクターを見せる余白にする。
        ring(42, 1.25)
    elif kind == "chrono":
        # 太細のリングを重ね、時計の文字盤と歯車帯を分けて読ませる。
        ring(190, 1.9)
        ring(181, 1.05)
        ring(170, 2.3)
        ring(128, 1.7)
        ring(116, 1.0)
        for tick in range(60):
            angle = tick * math.tau / 60 - math.pi / 2
            outer = 214
            inner = 193 if tick % 5 == 0 else 201
            line([polar((256, 256), inner, angle), polar((256, 256), outer, angle)], 2.4 if tick % 5 == 0 else 1.1)
        # 24枚の台形歯と12個のリベットで、外側を機械式の歯車帯にする。
        for tooth in range(24):
            angle = tooth * math.tau / 24 - math.pi / 2
            polygon(
                [
                    polar((256, 256), 181, angle - 0.035),
                    polar((256, 256), 190, angle - 0.049),
                    polar((256, 256), 196, angle - 0.025),
                    polar((256, 256), 196, angle + 0.025),
                    polar((256, 256), 190, angle + 0.049),
                    polar((256, 256), 181, angle + 0.035),
                ],
                1.2,
            )
        for index in range(12):
            small_ring(polar((256, 256), 181, index * math.tau / 12 - math.pi / 2), 3.1, 1.1, 220)

        # 時計針と、ローマ数字風の I/V/X 刻みを十二方位へ配置する。
        glyphs = ("XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI")
        for index, glyph in enumerate(glyphs):
            angle = index * math.tau / 12 - math.pi / 2
            anchor = polar((256, 256), 151, angle)
            tangent = (-math.sin(angle), math.cos(angle))
            radial = (math.cos(angle), math.sin(angle))
            cursor = -(len(glyph) - 1) * 4.0
            for char in glyph:
                base = (anchor[0] + tangent[0] * cursor, anchor[1] + tangent[1] * cursor)
                if char == "I":
                    line([(base[0] - radial[0] * 5, base[1] - radial[1] * 5), (base[0] + radial[0] * 5, base[1] + radial[1] * 5)], 1.4)
                elif char == "V":
                    left = (base[0] - tangent[0] * 3 - radial[0] * 5, base[1] - tangent[1] * 3 - radial[1] * 5)
                    tip = (base[0] + radial[0] * 5, base[1] + radial[1] * 5)
                    right = (base[0] + tangent[0] * 3 - radial[0] * 5, base[1] + tangent[1] * 3 - radial[1] * 5)
                    line([left, tip, right], 1.4)
                else:  # X
                    line([(base[0] - tangent[0] * 3 - radial[0] * 5, base[1] - tangent[1] * 3 - radial[1] * 5), (base[0] + tangent[0] * 3 + radial[0] * 5, base[1] + tangent[1] * 3 + radial[1] * 5)], 1.4)
                    line([(base[0] - tangent[0] * 3 + radial[0] * 5, base[1] - tangent[1] * 3 + radial[1] * 5), (base[0] + tangent[0] * 3 - radial[0] * 5, base[1] + tangent[1] * 3 - radial[1] * 5)], 1.4)
                cursor += 8.0

        def ornate_hand(angle: float, length: float, root_width: float, shaft_width: float, tip_length: float) -> None:
            """紡錘形の針に菱形の透かしと矢尻を与え、単線の針を避ける。"""
            direction = (math.cos(angle), math.sin(angle))
            perpendicular = (-direction[1], direction[0])

            def hand_point(distance: float, sideways: float = 0.0) -> tuple[float, float]:
                return (
                    256 + direction[0] * distance + perpendicular[0] * sideways,
                    256 + direction[1] * distance + perpendicular[1] * sideways,
                )

            outline = [
                hand_point(-15),
                hand_point(-7, root_width * 0.48),
                hand_point(17, root_width),
                hand_point(length * 0.69, shaft_width),
                hand_point(length * 0.91, shaft_width * 1.36),
                hand_point(length + tip_length),
                hand_point(length * 0.91, -shaft_width * 1.36),
                hand_point(length * 0.69, -shaft_width),
                hand_point(17, -root_width),
                hand_point(-7, -root_width * 0.48),
            ]
            filled_polygon(outline, 245)
            line(outline, 1.05, fill=255)
            # 針の中央を菱形に抜いて、細部でも装飾的なシルエットを保つ。
            hole_center = length * 0.49
            hole = [
                hand_point(hole_center - 8),
                hand_point(hole_center, shaft_width * 0.72),
                hand_point(hole_center + 8),
                hand_point(hole_center, -shaft_width * 0.72),
            ]
            draw.polygon([(x * AA, y * AA) for x, y in hole], fill=0)

        # 長針は細長く上右、短針は太く短く下左へ。形・長さの差で即座に区別できる。
        ornate_hand(-math.pi / 2 + 0.43, 132, 7.3, 2.8, 13)
        ornate_hand(math.pi / 2 + 0.65, 86, 9.0, 4.0, 11)
        # 同心円と八つの爪を持つハブで、二本の針の根元を時計らしく固定する。
        ring(43, 1.35)
        ring(30, 2.6)
        ring(12, 1.8)
        for claw in range(8):
            angle = claw * math.tau / 8
            line([polar((256, 256), 32, angle), polar((256, 256), 42, angle)], 1.55)
    else:
        raise ValueError(f"Unknown rune kind: {kind}")
    return mask


def colored_rune(kind: str, color: tuple[int, int, int]) -> Image.Image:
    """発光の外縁と白い芯を合成し、縮小でサブピクセル AA を効かせる。"""
    mask = rune_mask(kind)
    glow = mask.filter(ImageFilter.GaussianBlur(4.4 * AA))
    image = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    glow_layer = Image.new("RGBA", mask.size, (*color, 0))
    glow_layer.putalpha(glow.point(lambda value: round(value * 0.48)))
    image.alpha_composite(glow_layer)
    core_layer = Image.new("RGBA", mask.size, (*color, 0))
    core_layer.putalpha(mask)
    image.alpha_composite(core_layer)
    # 主線に僅かな白ハイライトを重ね、暗い背景でも線が潰れないようにする。
    highlight = Image.new("RGBA", mask.size, (255, 255, 255, 0))
    highlight.putalpha(mask.point(lambda value: round(value * 0.28)))
    image.alpha_composite(highlight)
    return image.resize((RUNE_SIZE, RUNE_SIZE), LANCZOS)


def swirl() -> Image.Image:
    """渦巻きを使わず、中心を指す楔と角環で闇の収束を示す。"""
    size = RUNE_SIZE * AA
    center = (size / 2.0, size / 2.0)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)

    def point(radius: float, angle: float) -> tuple[float, float]:
        return center[0] + math.cos(angle) * radius * AA, center[1] + math.sin(angle) * radius * AA

    def line(points: list[tuple[float, float]], width: float, fill: int = 235) -> None:
        draw.line(points, fill=fill, width=max(1, round(width * AA)), joint="curve")

    def polygon(points: list[tuple[float, float]], width: float, fill: int = 240) -> None:
        draw.line(points + [points[0]], fill=fill, width=max(1, round(width * AA)), joint="curve")

    def angular_ring(radius: float, sides: int, offset: float, width: float) -> None:
        polygon([point(radius, offset + index * math.tau / sides) for index in range(sides)], width)

    # 円ではなく角環にすることで、回転して吸い込まれる印象を出さない。
    angular_ring(222, 8, math.pi / 8, 2.2)
    angular_ring(188, 8, math.pi / 8, 1.45)
    angular_ring(142, 8, math.pi / 8, 1.8)
    angular_ring(68, 8, math.pi / 8, 1.55)
    angular_ring(46, 8, math.pi / 8, 1.0)

    for index in range(8):
        angle = index * math.tau / 8 - math.pi / 2
        # 八本の直線的な楔は中心へ向くが、半径46以内を空けて背景を残す。
        polygon(
            [
                point(204, angle - 0.078),
                point(159, angle - 0.128),
                point(106, angle),
                point(159, angle + 0.128),
                point(204, angle + 0.078),
            ],
            2.25,
        )
        line([point(213, angle), point(224, angle)], 2.1)
        # 楔の根元に短い横棒を足し、単なる放射線ではなく刻印として読ませる。
        line([point(124, angle - 0.046), point(124, angle + 0.046)], 1.35, 210)

    # 四隅の小さな菱形は着弾点を囲う符号で、中心へ線を集め過ぎない。
    for index in range(4):
        angle = index * math.tau / 4 - math.pi / 4
        radial = (math.cos(angle), math.sin(angle))
        tangent = (-radial[1], radial[0])
        anchor = point(94, angle)
        diamond = [
            (anchor[0] + radial[0] * 9 * AA, anchor[1] + radial[1] * 9 * AA),
            (anchor[0] + tangent[0] * 6 * AA, anchor[1] + tangent[1] * 6 * AA),
            (anchor[0] - radial[0] * 9 * AA, anchor[1] - radial[1] * 9 * AA),
            (anchor[0] - tangent[0] * 6 * AA, anchor[1] - tangent[1] * 6 * AA),
        ]
        polygon(diamond, 1.35, 225)

    # 線の芯を太らせずに、半透明の外光だけを少し広げて地面の上で読みやすくする。
    glow = mask.filter(ImageFilter.GaussianBlur(6.2 * AA))
    image = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    glow_layer = Image.new("RGBA", mask.size, (194, 194, 194, 0))
    glow_layer.putalpha(glow.point(lambda value: round(value * 0.48)))
    image.alpha_composite(glow_layer)
    core_layer = Image.new("RGBA", mask.size, (225, 225, 225, 0))
    core_layer.putalpha(mask)
    image.alpha_composite(core_layer)
    highlight = Image.new("RGBA", mask.size, (255, 255, 255, 0))
    highlight.putalpha(mask.point(lambda value: round(value * 0.28)))
    image.alpha_composite(highlight)
    return image.resize((RUNE_SIZE, RUNE_SIZE), LANCZOS)


def alpha_stats(image: Image.Image) -> tuple[int, int, float, int]:
    alpha = np.asarray(image.getchannel("A"), dtype=np.uint8)
    return int(alpha.min()), int(alpha.max()), float(alpha.mean()), int(np.count_nonzero(alpha))


def alpha_coverage(image: Image.Image) -> tuple[float, float]:
    """視認できる半透明と、線画の芯になる高アルファを面積率で返す。"""
    alpha = np.asarray(image.getchannel("A"), dtype=np.uint8)
    total = alpha.size
    semi_transparent = np.count_nonzero((alpha >= 16) & (alpha < 128)) / total * 100.0
    opaque = np.count_nonzero(alpha >= 128) / total * 100.0
    return float(opaque), float(semi_transparent)


def loop_difference(sheet_image: Image.Image) -> tuple[float, float, float, float]:
    alpha = np.asarray(sheet_image.getchannel("A"), dtype=np.float32)
    frames = [
        alpha[row * FRAME_SIZE : (row + 1) * FRAME_SIZE, col * FRAME_SIZE : (col + 1) * FRAME_SIZE]
        for row in range(SHEET_FRAMES)
        for col in range(SHEET_FRAMES)
    ]
    differences = [float(np.mean(np.abs(frames[index] - frames[(index + 1) % len(frames)]))) for index in range(len(frames))]
    adjacent = differences[:-1]
    return min(adjacent), float(np.mean(adjacent)), max(adjacent), differences[-1]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    generated: list[Path] = []
    generated.append(write_image("flame-sheet.png", sheet(flame_frame)))
    generated.append(write_image("smoke-sheet.png", sheet(smoke_frame)))
    generated.append(write_image("shockwave-sheet.png", sheet(shockwave_frame)))
    generated.append(write_image("lightning-arc.png", lightning_arc()))
    generated.append(write_image("spark.png", spark()))
    generated.append(write_image("soft-particle.png", soft_particle()))
    generated.append(write_image("rune-circle-fire.png", colored_rune("fire", (255, 93, 61))))
    generated.append(write_image("rune-circle-lightning.png", colored_rune("lightning", (217, 70, 239))))
    generated.append(write_image("rune-circle-void.png", colored_rune("void", (192, 38, 211))))
    generated.append(write_image("rune-circle-chrono.png", colored_rune("chrono", (34, 211, 238))))
    generated.append(write_image("swirl.png", swirl()))

    print("EFFECT_TEXTURES_GENERATED")
    for path in generated:
        image = Image.open(path)
        minimum, maximum, mean, nonzero = alpha_stats(image)
        opaque, semi_transparent = alpha_coverage(image)
        print(
            f"{path.relative_to(ROOT)} mode={image.mode} size={image.width}x{image.height} "
            f"alpha=min:{minimum} max:{maximum} mean:{mean:.2f} nonzero:{nonzero} "
            f"opaque_a128plus:{opaque:.2f}% semi_a16to127:{semi_transparent:.2f}%"
        )
    for name in ("flame-sheet.png", "smoke-sheet.png", "shockwave-sheet.png"):
        minimum, mean, maximum, seam = loop_difference(Image.open(OUT_DIR / name))
        print(f"loop={name} adjacent_abs_diff=min:{minimum:.3f} mean:{mean:.3f} max:{maximum:.3f} seam_last_to_first:{seam:.3f}")


if __name__ == "__main__":
    main()
