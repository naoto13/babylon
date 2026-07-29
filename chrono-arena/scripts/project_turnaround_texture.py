"""三面図を正本に SPAR3D の hero テクスチャを方向別に再投影する。

SPAR3D は正面画像だけから背面を推測するため、元の UV を保ったまま各面の
ワールド法線に応じて正面・側面・背面の三面図を焼き込む。画像を単に横へ
貼り伸ばすのではなく、各方向の正投影 bbox と三面図の被写体 bbox を個別に
一致させる。

実行例:
    blender --background --factory-startup --python-exit-code 1 \
      --python scripts/project_turnaround_texture.py -- hero-nendo
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "production" / "demonic" / "spar3d"
TURNAROUND_DIR = ROOT / "assets" / "production" / "demonic" / "turnarounds"
OUTPUT_DIR = ROOT / "assets" / "production" / "demonic" / "nendo"

VIEW_NAMES = ("front", "side", "back")
LUMINANCE = np.array((0.2126, 0.7152, 0.0722), dtype=np.float32)
NORMAL_BLEND_EXPONENT = 3.0
MIN_PREVIEW_BYTES = 20_000
MAX_GLB_BYTES = 4 * 1024 * 1024
# 512px は 512x768 の照合プレビューで十分な細部を残しつつ、全三角形を Python で
# ラスタライズする処理を確実に完走させる。元の 1K normal map は縮小しない。
BASECOLOR_MAX_DIMENSION = 512


@dataclass(frozen=True)
class PixelBox:
    """Blender 画像配列（左下原点）上での被写体範囲。"""

    x_min: int
    x_max: int
    y_min: int
    y_max: int

    @property
    def width(self) -> int:
        return self.x_max - self.x_min + 1

    @property
    def height(self) -> int:
        return self.y_max - self.y_min + 1


@dataclass(frozen=True)
class TurnaroundView:
    name: str
    box: PixelBox


@dataclass(frozen=True)
class ProjectionFit:
    """1 方向の mesh 正投影座標を三面図ピクセルへ写す係数。"""

    name: str
    horizontal: Vector
    mesh_h_min: float
    mesh_h_max: float
    mesh_z_min: float
    mesh_z_max: float
    u_scale: float
    u_offset: float
    v_scale: float
    v_offset: float
    flip_horizontal: bool


def log(message: str) -> None:
    # Blender がネイティブ側で異常終了しても、直前の検証地点を失わないよう即時出力する。
    print(f"[TURNAROUND_TEXTURE] {message}", flush=True)


def fail(message: str) -> None:
    raise RuntimeError(message)


def parse_name(argv: list[str]) -> str:
    """`<キャラ名>-nendo` を受け取る。対応する三面図とメッシュの存在まで確認する。"""
    try:
        separator = argv.index("--")
    except ValueError:
        fail("Pass the character name after '--', for example: -- hero-nendo")
    names = argv[separator + 1 :]
    if len(names) != 1:
        fail(f"Pass exactly one character name, got: {names or '(none)'}")
    name = names[0]

    if not (SOURCE_DIR / f"{name}.glb").exists():
        fail(f"SPAR3D の出力がない: {SOURCE_DIR / f'{name}.glb'}")
    if not turnaround_path(name).exists():
        fail(f"三面図がない: {turnaround_path(name)}")
    return name


def turnaround_path(name: str) -> Path:
    """`hero-nendo` → `turnarounds/hero.png` のように三面図へ対応づける。"""
    base = name[: -len("-nendo")] if name.endswith("-nendo") else name
    return TURNAROUND_DIR / f"{base}.png"


def split_components_by_valleys(
    subject_mask: np.ndarray,
    components: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """連結成分が3個に割れなかったとき、列密度の谷で分割し直す。

    三面図でも体の間隔が狭いと背景の列が一本も残らず、隣の体とつながって
    一つの成分になる。列ごとの被写体ピクセル数を見て、最も密度が低い位置
    ＝体の切れ目で分けるほうが正しい。crop_turnaround_front.py と同じ考え方。
    """
    if not components or len(components) >= 3:
        return components

    widest = max(components, key=lambda component: component[1] - component[0])
    others = [component for component in components if component is not widest]
    expected_inside = 3 - len(others)
    if expected_inside < 2:
        return components

    # components は両端を含む閉区間で持っているのでスライス幅は +1 する。
    density = subject_mask[:, widest[0] : widest[1] + 1].sum(axis=0).astype(np.float32)
    span = widest[1] - widest[0] + 1
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
        return components

    edges = [widest[0], *boundaries, widest[1]]
    split: list[tuple[int, int]] = []
    for index in range(len(edges) - 1):
        start = edges[index] if index == 0 else edges[index] + 1
        split.append((start, edges[index + 1]))
    return sorted([*others, *split])


def clear_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def pixels_array(image: bpy.types.Image) -> np.ndarray:
    width, height = image.size
    if width <= 0 or height <= 0:
        fail(f"Image has invalid dimensions: {image.name} {tuple(image.size)}")
    pixels = np.asarray(image.pixels[:], dtype=np.float32)
    expected = width * height * 4
    if pixels.size != expected:
        fail(f"Image pixel count mismatch for {image.name}: {pixels.size} != {expected}")
    # Blender の image.pixels は UV と同じく下から上の行順なので、以降の V と一致する。
    return pixels.reshape((height, width, 4))


def image_for_socket(material: bpy.types.Material, socket_name: str) -> bpy.types.Image:
    if not material or not material.node_tree:
        fail("Imported character has no node material.")
    bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        fail("Imported character material has no Principled BSDF.")
    socket = bsdf.inputs.get(socket_name)
    if not socket or not socket.is_linked:
        fail(f"Imported material has no connected {socket_name} texture.")
    source = socket.links[0].from_node
    if socket_name == "Normal" and source.type == "NORMAL_MAP":
        color_socket = source.inputs.get("Color")
        if color_socket and color_socket.is_linked:
            source = color_socket.links[0].from_node
    if source.type != "TEX_IMAGE" or source.image is None:
        fail(f"Could not resolve {socket_name} to an image texture.")
    return source.image


def image_from_pixels(name: str, pixels: np.ndarray) -> bpy.types.Image:
    height, width, channels = pixels.shape
    if channels != 4:
        fail(f"Expected RGBA pixels for {name}, got {channels} channels")
    image = bpy.data.images.new(name, width, height, alpha=True)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
    image.update()
    return image


def save_png(image: bpy.types.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"Failed to save PNG: {path}")


def load_turnaround(
    name: str,
) -> tuple[bpy.types.Image, np.ndarray, np.ndarray, list[TurnaroundView], np.ndarray, float]:
    """四隅背景との差分から三体を列方向の連結成分として検出する。"""
    path = turnaround_path(name)
    if not path.is_file():
        fail(f"Missing turnaround: {path}")
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "sRGB"
    pixels = pixels_array(image)
    height, width, _ = pixels.shape
    rgb = pixels[:, :, :3]

    patch = max(8, min(width, height) // 64)
    corners = np.concatenate(
        (
            rgb[:patch, :patch].reshape((-1, 3)),
            rgb[:patch, -patch:].reshape((-1, 3)),
            rgb[-patch:, :patch].reshape((-1, 3)),
            rgb[-patch:, -patch:].reshape((-1, 3)),
        )
    )
    background = corners.mean(axis=0)
    distance = np.linalg.norm(rgb - background, axis=2)
    # 背景ノイズの上限から決め、写真風の灰背景でも被写体だけを残す下限を置く。
    threshold = max(0.04, float(np.quantile(distance, 0.15)) * 3.0)
    subject_mask = distance > threshold

    # 被写体の細い隙間（羽根やフード縁）で一体が分割されないようだけ補間する。
    column_mask = subject_mask.sum(axis=0) >= max(2, int(height * 0.002))
    bridge_gap = max(4, int(width * 0.015))
    occupied = np.flatnonzero(column_mask)
    components: list[tuple[int, int]] = []
    if occupied.size:
        start = previous = int(occupied[0])
        for value in occupied[1:]:
            current = int(value)
            if current - previous > bridge_gap:
                components.append((start, previous))
                start = current
            previous = current
        components.append((start, previous))
    components = [component for component in components if component[1] - component[0] + 1 >= width * 0.10]
    if len(components) < 3:
        # 体の間隔が狭いと背景の列が一本も残らず隣の体とつながる（boss / chaser で発生）。
        # その場合は列密度の谷＝体の切れ目で分け直す。
        components = split_components_by_valleys(subject_mask, components)
    if len(components) != 3:
        fail(
            "Could not detect exactly three turnaround subjects: "
            f"components={components} threshold={threshold:.5f} bridge_gap={bridge_gap}"
        )

    views: list[TurnaroundView] = []
    for view_name, (x_start, x_end) in zip(VIEW_NAMES, components, strict=True):
        local_mask = subject_mask[:, x_start : x_end + 1]
        ys, xs = np.where(local_mask)
        if not xs.size:
            fail(f"Detected empty turnaround component for {view_name}")
        box = PixelBox(
            x_min=x_start + int(xs.min()),
            x_max=x_start + int(xs.max()),
            y_min=int(ys.min()),
            y_max=int(ys.max()),
        )
        views.append(TurnaroundView(view_name, box))
        log(
            f"VIEW_DETECTED view={view_name} bbox=({box.x_min},{box.y_min})-({box.x_max},{box.y_max}) "
            f"size={box.width}x{box.height}"
        )
    log(
        "TURNAROUND_MASK "
        f"path={path} background=({background[0]:.4f},{background[1]:.4f},{background[2]:.4f}) "
        f"threshold={threshold:.5f} foreground_ratio={subject_mask.mean():.4f}"
    )
    return image, pixels, subject_mask, views, background, threshold


def apply_world_transform(mesh: bpy.types.Object) -> None:
    """親の残った変換を頂点へ焼き、以降の投影を world 基準に固定する。"""
    matrix = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = matrix
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def primary_character_mesh() -> bpy.types.Object:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        fail("The imported GLB contains no mesh.")
    primary = max(meshes, key=lambda obj: len(obj.data.polygons))
    if len(primary.data.polygons) < 100:
        fail("The largest imported mesh is too small to be a character.")
    # SPAR3D の撮影台は少面数。十分な面数を持つ付属物（角など）は本体へ統合する。
    selected = [obj for obj in meshes if len(obj.data.polygons) >= max(100, len(primary.data.polygons) * 0.01)]
    log(f"IMPORT_MESHES all={[(item.name, len(item.data.polygons)) for item in meshes]} selected={[item.name for item in selected]}")
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in selected:
        log(f"IMPORT_NORMALIZE object={mesh.name}")
        apply_world_transform(mesh)
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = primary
    if len(selected) > 1:
        bpy.ops.object.join()
    log(f"IMPORT_JOINED primary={primary.name} selected_count={len(selected)}")
    for mesh in list(meshes):
        if mesh != primary and mesh.name not in {item.name for item in selected}:
            log(f"IMPORT_REMOVE_STAGING object={mesh.name}")
            bpy.data.objects.remove(mesh, do_unlink=True)
    primary.name = "HeroNendoTurnaroundProjected"
    return primary


def mesh_bounds(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    coordinates = [mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices]
    if not coordinates:
        fail("Character mesh has no vertices.")
    return (
        Vector(tuple(min(coordinate[axis] for coordinate in coordinates) for axis in range(3))),
        Vector(tuple(max(coordinate[axis] for coordinate in coordinates) for axis in range(3))),
    )


def normalize_to_plus_y_front(mesh: bpy.types.Object) -> str:
    """native Y-up の入力を Z-up・+Y 正面へ正規化する。

    prepare_for_mixamo.py と同じ X->Z / Y->Z 判定と yaw 180 をここでも適用する。
    これにより三面図の front/back の方向ベクトルを曖昧な入力座標へ依存させない。
    """
    minimum, maximum = mesh_bounds(mesh)
    size = maximum - minimum
    vertical_axis = max(range(3), key=lambda axis: size[axis])
    mesh.rotation_mode = "XYZ"
    if vertical_axis == 0:
        mesh.rotation_euler[1] = -math.pi / 2.0
        correction = "X_TO_Z"
    elif vertical_axis == 1:
        mesh.rotation_euler[0] = math.pi / 2.0
        correction = "Y_TO_Z"
    else:
        correction = "Z_ALREADY_UPRIGHT"
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mesh.rotation_euler[2] = math.pi
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    minimum, maximum = mesh_bounds(mesh)
    size = maximum - minimum
    log(
        "ORIENTATION "
        f"source_long_axis={vertical_axis} correction={correction} yaw_degrees=180 "
        "confirmed_projection_front=+Y projection_back=-Y projection_side=+X "
        f"normalized_bbox=({size.x:.5f},{size.y:.5f},{size.z:.5f})"
    )
    return correction


def projection_fit(name: str, horizontal: Vector, mesh: bpy.types.Object, source: TurnaroundView, *, flip: bool) -> ProjectionFit:
    coordinates = np.asarray([tuple(mesh.matrix_world @ vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    horizontal_values = coordinates @ np.asarray(tuple(horizontal), dtype=np.float32)
    h_min, h_max = float(horizontal_values.min()), float(horizontal_values.max())
    z_min, z_max = float(coordinates[:, 2].min()), float(coordinates[:, 2].max())
    h_span = h_max - h_min
    z_span = z_max - z_min
    if h_span <= 1e-6 or z_span <= 1e-6:
        fail(f"Degenerate projected mesh bounds for {name}: horizontal={h_span} z={z_span}")
    u_scale = (source.box.width - 1) / h_span
    v_scale = (source.box.height - 1) / z_span
    fit = ProjectionFit(
        name=name,
        horizontal=horizontal,
        mesh_h_min=h_min,
        mesh_h_max=h_max,
        mesh_z_min=z_min,
        mesh_z_max=z_max,
        u_scale=u_scale,
        u_offset=source.box.x_min - h_min * u_scale,
        v_scale=v_scale,
        v_offset=source.box.y_min - z_min * v_scale,
        flip_horizontal=flip,
    )
    log(
        "PROJECTION_FIT "
        f"view={name} mesh_h=({h_min:.5f},{h_max:.5f}) mesh_z=({z_min:.5f},{z_max:.5f}) "
        f"image_bbox=({source.box.x_min},{source.box.y_min})-({source.box.x_max},{source.box.y_max}) "
        f"scale=({u_scale:.4f},{v_scale:.4f}) offset=({fit.u_offset:.4f},{fit.v_offset:.4f}) "
        f"flip_horizontal={flip}"
    )
    return fit


def sample_bilinear(image: np.ndarray, x: np.ndarray, y: np.ndarray, *, wrap: bool = False) -> np.ndarray:
    """左下原点の Blender 画像配列をベクトル化してバイリニア取得する。"""
    height, width, _ = image.shape
    if wrap:
        x = np.mod(x, width)
        y = np.mod(y, height)
    else:
        x = np.clip(x, 0.0, width - 1.0)
        y = np.clip(y, 0.0, height - 1.0)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = (x0 + 1) % width if wrap else np.minimum(x0 + 1, width - 1)
    y1 = (y0 + 1) % height if wrap else np.minimum(y0 + 1, height - 1)
    dx = (x - x0)[:, None]
    dy = (y - y0)[:, None]
    lower = image[y0, x0] * (1.0 - dx) + image[y0, x1] * dx
    upper = image[y1, x0] * (1.0 - dx) + image[y1, x1] * dx
    return lower * (1.0 - dy) + upper * dy


def projected_sample(
    pixels: np.ndarray,
    subject_mask: np.ndarray,
    fit: ProjectionFit,
    coordinates: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    horizontal = coordinates @ np.asarray(tuple(fit.horizontal), dtype=np.float32)
    x = horizontal * fit.u_scale + fit.u_offset
    if fit.flip_horizontal:
        # 左面は同じ「右を向く」側面図を左右反転して使う。
        x = fit.mesh_h_max * fit.u_scale + fit.u_offset - (horizontal - fit.mesh_h_min) * fit.u_scale
    y = coordinates[:, 2] * fit.v_scale + fit.v_offset
    colors = sample_bilinear(pixels, x, y)
    mask_image = subject_mask.astype(np.float32)[:, :, None]
    validity = sample_bilinear(mask_image, x, y)[:, 0]
    return colors, np.clip(validity, 0.0, 1.0)


def original_shadow(
    source_pixels: np.ndarray,
    uv: np.ndarray,
    p8: float,
    p92: float,
) -> np.ndarray:
    width = source_pixels.shape[1]
    height = source_pixels.shape[0]
    sampled = sample_bilinear(source_pixels, uv[:, 0] * (width - 1), uv[:, 1] * (height - 1), wrap=True)
    luminance = sampled[:, :3] @ LUMINANCE
    normalized = np.clip((luminance - p8) / max(p92 - p8, 1e-5), 0.0, 1.0)
    # 色相・彩度はいじらず、元の明暗だけを 0.78〜0.90 の控えめな乗算として戻す。
    return 0.78 + normalized * 0.12


def bake_turnaround_basecolor(
    mesh: bpy.types.Object,
    turnaround_pixels: np.ndarray,
    subject_mask: np.ndarray,
    views: list[TurnaroundView],
    source_base: bpy.types.Image,
) -> tuple[bpy.types.Image, dict[str, float], tuple[float, float], int]:
    """元 UV の各テクセルへ、補間した座標・法線で方向別投影を焼く。"""
    bpy.context.view_layer.update()
    uv_layer = mesh.data.uv_layers.active
    if uv_layer is None:
        fail("Character mesh has no active UV map.")
    source_pixels = pixels_array(source_base)
    source_width, source_height = source_base.size
    if source_width <= 0 or source_height <= 0:
        fail("Source base-color texture dimensions are invalid.")
    texture_width = min(source_width, BASECOLOR_MAX_DIMENSION)
    texture_height = min(source_height, BASECOLOR_MAX_DIMENSION)

    source_luma = source_pixels[:, :, :3] @ LUMINANCE
    p8, p92 = (float(value) for value in np.quantile(source_luma, (0.08, 0.92)))
    turnaround = {view.name: view for view in views}
    fits = (
        projection_fit("front", Vector((-1.0, 0.0, 0.0)), mesh, turnaround["front"], flip=False),
        projection_fit("back", Vector((1.0, 0.0, 0.0)), mesh, turnaround["back"], flip=False),
        projection_fit("side_right", Vector((0.0, 1.0, 0.0)), mesh, turnaround["side"], flip=False),
        projection_fit("side_left", Vector((0.0, -1.0, 0.0)), mesh, turnaround["side"], flip=True),
    )
    directions = np.asarray(
        ((0.0, 1.0, 0.0), (0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (-1.0, 0.0, 0.0)),
        dtype=np.float32,
    )

    result = np.zeros((texture_height, texture_width, 4), dtype=np.float32)
    covered = np.zeros((texture_height, texture_width), dtype=bool)
    direction_pixels = np.zeros(4, dtype=np.int64)
    fallback_pixels = 0
    world_matrix = mesh.matrix_world
    normal_matrix = world_matrix.to_3x3().inverted().transposed()
    vertex_coordinates = np.asarray([tuple(world_matrix @ vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    vertex_normals = np.asarray(
        [tuple((normal_matrix @ vertex.normal).normalized()) for vertex in mesh.data.vertices], dtype=np.float32
    )
    log("BAKE_RASTERIZER stage=vertex_data_ready")
    mesh.data.calc_loop_triangles()
    log(f"BAKE_RASTERIZER stage=triangles_ready count={len(mesh.data.loop_triangles)}")

    for triangle_index, triangle in enumerate(mesh.data.loop_triangles):
        if triangle_index and triangle_index % 5000 == 0:
            log(f"BAKE_RASTERIZER stage=progress triangle={triangle_index}")
        loop_indices = triangle.loops
        vertex_indices = triangle.vertices
        uv = np.asarray([tuple(uv_layer.data[loop_index].uv) for loop_index in loop_indices], dtype=np.float32)
        # glTF UV は 0..1 に収まることを前提とし、極小の境界誤差だけ丸める。
        uv = np.clip(uv, 0.0, 1.0)
        screen = np.column_stack((uv[:, 0] * (texture_width - 1), uv[:, 1] * (texture_height - 1)))
        min_x = max(0, int(math.floor(float(screen[:, 0].min()))))
        max_x = min(texture_width - 1, int(math.ceil(float(screen[:, 0].max()))))
        min_y = max(0, int(math.floor(float(screen[:, 1].min()))))
        max_y = min(texture_height - 1, int(math.ceil(float(screen[:, 1].max()))))
        if max_x < min_x or max_y < min_y:
            continue
        a, b, c = screen
        denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(float(denominator)) < 1e-8:
            continue
        grid_x, grid_y = np.meshgrid(
            np.arange(min_x, max_x + 1, dtype=np.float32) + 0.5,
            np.arange(min_y, max_y + 1, dtype=np.float32) + 0.5,
        )
        bary_a = ((b[1] - c[1]) * (grid_x - c[0]) + (c[0] - b[0]) * (grid_y - c[1])) / denominator
        bary_b = ((c[1] - a[1]) * (grid_x - c[0]) + (a[0] - c[0]) * (grid_y - c[1])) / denominator
        bary_c = 1.0 - bary_a - bary_b
        inside = (bary_a >= -1e-5) & (bary_b >= -1e-5) & (bary_c >= -1e-5)
        if not inside.any():
            continue
        weights = np.column_stack((bary_a[inside], bary_b[inside], bary_c[inside])).astype(np.float32)
        point_coordinates = weights @ vertex_coordinates[np.asarray(vertex_indices)]
        point_normals = weights @ vertex_normals[np.asarray(vertex_indices)]
        point_normals /= np.maximum(np.linalg.norm(point_normals, axis=1, keepdims=True), 1e-6)
        point_uv = weights @ uv

        samples: list[np.ndarray] = []
        validities: list[np.ndarray] = []
        for fit in fits:
            color, valid = projected_sample(turnaround_pixels, subject_mask, fit, point_coordinates)
            samples.append(color)
            validities.append(valid)
        sample_colors = np.stack(samples, axis=1)
        valid = np.stack(validities, axis=1)
        normal_weights = np.maximum(point_normals @ directions.T, 0.0) ** NORMAL_BLEND_EXPONENT
        weighted = normal_weights * valid
        weight_sum = weighted.sum(axis=1)
        color = (sample_colors * weighted[:, :, None]).sum(axis=1)
        usable = weight_sum > 1e-5
        color[usable] /= weight_sum[usable, None]
        if (~usable).any():
            # 真上など水平法線が無い面は、空色の背景を混ぜず元 SPAR3D の色を残す。
            color[~usable] = sample_bilinear(
                source_pixels,
                point_uv[~usable, 0] * (source_width - 1),
                point_uv[~usable, 1] * (source_height - 1),
                wrap=True,
            )
            fallback_pixels += int((~usable).sum())
        shade = original_shadow(source_pixels, point_uv, p8, p92)
        color[:, :3] *= shade[:, None]
        color[:, 3] = 1.0

        ys, xs = np.where(inside)
        write_y = ys + min_y
        write_x = xs + min_x
        result[write_y, write_x] = color
        covered[write_y, write_x] = True
        if usable.any():
            direction_pixels += np.bincount(np.argmax(weighted[usable], axis=1), minlength=4)

    if not covered.any():
        fail("UV rasterization wrote no pixels.")
    # UV の未使用領域は PNG 圧縮効率を優先し透明のまま置き、面に使う画素だけ不透明にする。
    direction_ratio = {
        "front": float(direction_pixels[0] / max(direction_pixels.sum(), 1)),
        "back": float(direction_pixels[1] / max(direction_pixels.sum(), 1)),
        "side_right": float(direction_pixels[2] / max(direction_pixels.sum(), 1)),
        "side_left": float(direction_pixels[3] / max(direction_pixels.sum(), 1)),
    }
    image = image_from_pixels("HeroNendoTurnaroundBaseColor", result)
    log(
        "BAKE_STATS "
        f"texture={texture_width}x{texture_height} uv_covered_ratio={covered.mean():.4f} "
        f"shadow_percentiles=({p8:.5f},{p92:.5f}) shadow_multiply_range=(0.78,0.90) "
        f"fallback_pixels={fallback_pixels}"
    )
    log(
        "DIRECTION_TEXEL_RATIO "
        + " ".join(f"{key}={value:.4f}" for key, value in direction_ratio.items())
    )
    return image, direction_ratio, (p8, p92), fallback_pixels


def bake_turnaround_basecolor_gpu(
    mesh: bpy.types.Object,
    turnaround_image: bpy.types.Image,
    views: list[TurnaroundView],
    source_base: bpy.types.Image,
) -> tuple[bpy.types.Image, dict[str, float], tuple[float, float]]:
    """Cy​cles の UV bake で投影材質を焼く。

    Python で 27,648 三角形を一つずつ走査すると Blender のバッチ実行時間を超える。
    そこで座標・法線の補間と各テクセルの評価は renderer に任せる。法線方向による
    ブレンド式は同じで、出力するのは元 UV へ焼かれた通常の baseColor PNG である。
    """
    source_pixels = pixels_array(source_base)
    source_luma = source_pixels[:, :, :3] @ LUMINANCE
    p8, p92 = (float(value) for value in np.quantile(source_luma, (0.08, 0.92)))
    source_width, source_height = source_base.size
    texture_width = min(source_width, BASECOLOR_MAX_DIMENSION)
    texture_height = min(source_height, BASECOLOR_MAX_DIMENSION)
    turnaround = {view.name: view for view in views}
    fits = (
        projection_fit("front", Vector((-1.0, 0.0, 0.0)), mesh, turnaround["front"], flip=False),
        projection_fit("back", Vector((1.0, 0.0, 0.0)), mesh, turnaround["back"], flip=False),
        projection_fit("side_right", Vector((0.0, 1.0, 0.0)), mesh, turnaround["side"], flip=False),
        projection_fit("side_left", Vector((0.0, -1.0, 0.0)), mesh, turnaround["side"], flip=True),
    )

    material = bpy.data.materials.new("Hero Nendo Turnaround Projection Bake")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    geometry = nodes.new("ShaderNodeNewGeometry")
    position = nodes.new("ShaderNodeSeparateXYZ")
    normal = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Position"], position.inputs["Vector"])
    links.new(geometry.outputs["Normal"], normal.inputs["Vector"])

    def signed_scalar(socket: bpy.types.NodeSocket, factor: float) -> bpy.types.NodeSocket:
        if factor == 1.0:
            return socket
        node = nodes.new("ShaderNodeMath")
        node.operation = "MULTIPLY"
        node.inputs[1].default_value = factor
        links.new(socket, node.inputs[0])
        return node.outputs[0]

    def map_scalar(
        socket: bpy.types.NodeSocket,
        from_min: float,
        from_max: float,
        to_min: float,
        to_max: float,
    ) -> bpy.types.NodeSocket:
        node = nodes.new("ShaderNodeMapRange")
        node.clamp = False
        node.inputs["From Min"].default_value = from_min
        node.inputs["From Max"].default_value = from_max
        node.inputs["To Min"].default_value = to_min
        node.inputs["To Max"].default_value = to_max
        links.new(socket, node.inputs["Value"])
        return node.outputs["Result"]

    def projection_color(fit: ProjectionFit) -> bpy.types.NodeSocket:
        if abs(fit.horizontal.x) > 0.5:
            horizontal_socket = signed_scalar(position.outputs["X"], float(fit.horizontal.x))
        else:
            horizontal_socket = signed_scalar(position.outputs["Y"], float(fit.horizontal.y))
        if fit.flip_horizontal:
            u_min = (fit.mesh_h_max * fit.u_scale + fit.u_offset) / turnaround_image.size[0]
            u_max = (fit.mesh_h_min * fit.u_scale + fit.u_offset) / turnaround_image.size[0]
        else:
            u_min = turnaround["side" if fit.name.startswith("side") else fit.name].box.x_min / turnaround_image.size[0]
            u_max = (turnaround["side" if fit.name.startswith("side") else fit.name].box.x_max + 1) / turnaround_image.size[0]
        v_min = turnaround["side" if fit.name.startswith("side") else fit.name].box.y_min / turnaround_image.size[1]
        v_max = (turnaround["side" if fit.name.startswith("side") else fit.name].box.y_max + 1) / turnaround_image.size[1]
        u = map_scalar(horizontal_socket, fit.mesh_h_min, fit.mesh_h_max, u_min, u_max)
        v = map_scalar(position.outputs["Z"], fit.mesh_z_min, fit.mesh_z_max, v_min, v_max)
        vector = nodes.new("ShaderNodeCombineXYZ")
        links.new(u, vector.inputs["X"])
        links.new(v, vector.inputs["Y"])
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = turnaround_image
        texture.interpolation = "Linear"
        texture.projection = "FLAT"
        links.new(vector.outputs["Vector"], texture.inputs["Vector"])
        return texture.outputs["Color"]

    def normal_weight(socket: bpy.types.NodeSocket, sign: float) -> bpy.types.NodeSocket:
        signed = signed_scalar(socket, sign)
        clamp = nodes.new("ShaderNodeMath")
        clamp.operation = "MAXIMUM"
        clamp.inputs[1].default_value = 0.0
        links.new(signed, clamp.inputs[0])
        power = nodes.new("ShaderNodeMath")
        power.operation = "POWER"
        power.inputs[1].default_value = NORMAL_BLEND_EXPONENT
        links.new(clamp.outputs[0], power.inputs[0])
        return power.outputs[0]

    def multiply_color(color: bpy.types.NodeSocket, scalar: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
        node = nodes.new("ShaderNodeMixRGB")
        node.blend_type = "MULTIPLY"
        node.inputs["Fac"].default_value = 1.0
        links.new(color, node.inputs[1])
        links.new(scalar, node.inputs[2])
        return node.outputs["Color"]

    def add_color(first: bpy.types.NodeSocket, second: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
        node = nodes.new("ShaderNodeMixRGB")
        node.blend_type = "ADD"
        node.inputs["Fac"].default_value = 1.0
        links.new(first, node.inputs[1])
        links.new(second, node.inputs[2])
        return node.outputs["Color"]

    color_sockets = [projection_color(fit) for fit in fits]
    weight_sockets = (
        normal_weight(normal.outputs["Y"], 1.0),
        normal_weight(normal.outputs["Y"], -1.0),
        normal_weight(normal.outputs["X"], 1.0),
        normal_weight(normal.outputs["X"], -1.0),
    )
    weighted_colors = [multiply_color(color, weight) for color, weight in zip(color_sockets, weight_sockets, strict=True)]
    summed_color = weighted_colors[0]
    for color in weighted_colors[1:]:
        summed_color = add_color(summed_color, color)
    summed_weight = weight_sockets[0]
    for weight in weight_sockets[1:]:
        add = nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        links.new(summed_weight, add.inputs[0])
        links.new(weight, add.inputs[1])
        summed_weight = add.outputs[0]
    inverse_weight = nodes.new("ShaderNodeMath")
    inverse_weight.operation = "DIVIDE"
    inverse_weight.inputs[0].default_value = 1.0
    inverse_weight.inputs[1].default_value = 0.001
    links.new(summed_weight, inverse_weight.inputs[1])
    projected = multiply_color(summed_color, inverse_weight.outputs[0])

    # 元アルベドの明度だけを percentile 正規化して 0.78〜0.90 で控えめに戻す。
    source_texture = nodes.new("ShaderNodeTexImage")
    source_texture.image = source_base
    rgb_to_bw = nodes.new("ShaderNodeRGBToBW")
    shade_range = nodes.new("ShaderNodeMapRange")
    shade_range.clamp = True
    shade_range.inputs["From Min"].default_value = p8
    shade_range.inputs["From Max"].default_value = p92
    shade_range.inputs["To Min"].default_value = 0.0
    shade_range.inputs["To Max"].default_value = 1.0
    shade_scale = nodes.new("ShaderNodeMath")
    shade_scale.operation = "MULTIPLY_ADD"
    shade_scale.inputs[1].default_value = 0.12
    shade_scale.inputs[2].default_value = 0.78
    links.new(source_texture.outputs["Color"], rgb_to_bw.inputs["Color"])
    links.new(rgb_to_bw.outputs["Val"], shade_range.inputs["Value"])
    links.new(shade_range.outputs["Result"], shade_scale.inputs[0])
    shaded = multiply_color(projected, shade_scale.outputs[0])
    links.new(shaded, bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    target = bpy.data.images.new("HeroNendoTurnaroundBaseColor", texture_width, texture_height, alpha=True)
    target.colorspace_settings.name = "sRGB"
    target_node = nodes.new("ShaderNodeTexImage")
    target_node.image = target
    for node in nodes:
        node.select = False
    target_node.select = True
    nodes.active = target_node
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    for polygon in mesh.data.polygons:
        polygon.material_index = 0
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    log(f"BAKE_GPU start texture={texture_width}x{texture_height} samples=1")
    result = bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True, margin=4)
    if "FINISHED" not in result:
        fail(f"Cycles base-color bake failed: result={result}")
    target.update()

    # 方向IDを同じ UV へもう一度焼き、頂点数ではなく実テクセルから割合を求める。
    max_weight = weight_sockets[0]
    for weight in weight_sockets[1:]:
        maximum = nodes.new("ShaderNodeMath")
        maximum.operation = "MAXIMUM"
        links.new(max_weight, maximum.inputs[0])
        links.new(weight, maximum.inputs[1])
        max_weight = maximum.outputs[0]

    def winner(weight: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
        compare = nodes.new("ShaderNodeMath")
        compare.operation = "COMPARE"
        compare.inputs[1].default_value = 0.0
        compare.inputs[2].default_value = 0.0001
        difference = nodes.new("ShaderNodeMath")
        difference.operation = "SUBTRACT"
        links.new(weight, difference.inputs[0])
        links.new(max_weight, difference.inputs[1])
        links.new(difference.outputs[0], compare.inputs[0])
        nonzero = nodes.new("ShaderNodeMath")
        nonzero.operation = "GREATER_THAN"
        nonzero.inputs[1].default_value = 0.0001
        links.new(max_weight, nonzero.inputs[0])
        product = nodes.new("ShaderNodeMath")
        product.operation = "MULTIPLY"
        links.new(compare.outputs[0], product.inputs[0])
        links.new(nonzero.outputs[0], product.inputs[1])
        return product.outputs[0]

    front_id, back_id, side_right_id, side_left_id = (winner(weight) for weight in weight_sockets)
    red = nodes.new("ShaderNodeMath")
    red.operation = "ADD"
    links.new(front_id, red.inputs[0])
    links.new(side_left_id, red.inputs[1])
    green = nodes.new("ShaderNodeMath")
    green.operation = "ADD"
    links.new(back_id, green.inputs[0])
    links.new(side_left_id, green.inputs[1])
    direction_rgb = nodes.new("ShaderNodeCombineXYZ")
    links.new(red.outputs[0], direction_rgb.inputs["X"])
    links.new(green.outputs[0], direction_rgb.inputs["Y"])
    links.new(side_right_id, direction_rgb.inputs["Z"])
    for link in list(bsdf.inputs["Base Color"].links):
        links.remove(link)
    links.new(direction_rgb.outputs["Vector"], bsdf.inputs["Base Color"])
    direction_target = bpy.data.images.new("HeroNendoTurnaroundDirectionIds", texture_width, texture_height, alpha=True)
    direction_node = nodes.new("ShaderNodeTexImage")
    direction_node.image = direction_target
    for node in nodes:
        node.select = False
    direction_node.select = True
    nodes.active = direction_node
    result = bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True, margin=4)
    if "FINISHED" not in result:
        fail(f"Cycles direction-ID bake failed: result={result}")
    direction_target.update()

    # bake 後に UV 全体を readback して、面の無い透明領域を除いた実テクセル割合を記録する。
    baked = pixels_array(target)
    baked_ratio = float((baked[:, :, 3] > 0.01).mean())
    direction_pixels = pixels_array(direction_target)
    occupied = baked[:, :, 3] > 0.01
    red_channel = direction_pixels[:, :, 0] > 0.5
    green_channel = direction_pixels[:, :, 1] > 0.5
    blue_channel = direction_pixels[:, :, 2] > 0.5
    classified = {
        "front": occupied & red_channel & ~green_channel & ~blue_channel,
        "back": occupied & ~red_channel & green_channel & ~blue_channel,
        "side_right": occupied & ~red_channel & ~green_channel & blue_channel,
        "side_left": occupied & red_channel & green_channel & ~blue_channel,
    }
    classified_total = max(sum(mask.sum() for mask in classified.values()), 1)
    direction_ratio = {
        key: float(mask.sum() / classified_total) for key, mask in classified.items()
    }
    log(
        "BAKE_STATS "
        f"texture={texture_width}x{texture_height} baked_uv_coverage={baked_ratio:.4f} "
        f"shadow_percentiles=({p8:.5f},{p92:.5f}) shadow_multiply_range=(0.78,0.90)"
    )
    log(
        "DIRECTION_TEXEL_RATIO "
        "method=direction-id-UV-bake "
        + " ".join(f"{key}={value:.4f}" for key, value in direction_ratio.items())
    )
    return target, direction_ratio, (p8, p92)


def turnaround_material(basecolor: bpy.types.Image, normal: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.new("Hero Nendo Turnaround Material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Metallic"].default_value = 0.18
    base_node = nodes.new("ShaderNodeTexImage")
    base_node.image = basecolor
    normal_node = nodes.new("ShaderNodeTexImage")
    normal.colorspace_settings.name = "Non-Color"
    normal_node.image = normal
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 1.0
    links.new(base_node.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return material


def export_glb(mesh: bpy.types.Object, path: Path, extras: tuple[bpy.types.Object, ...] = ()) -> int:
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    for extra in extras:
        extra.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    result = bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
    )
    if "FINISHED" not in result or not path.is_file() or path.stat().st_size == 0:
        fail(f"glTF export failed: result={result} path={path}")
    size = path.stat().st_size
    if size > MAX_GLB_BYTES:
        fail(f"Output GLB exceeds 4 MB: bytes={size} limit={MAX_GLB_BYTES}")
    return size


def srgb_to_linear(value: float) -> float:
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def look_at(object_: bpy.types.Object, target: Vector) -> None:
    object_.rotation_euler = (target - object_.location).to_track_quat("-Z", "Y").to_euler()


def clear_render_helpers(mesh: bpy.types.Object) -> None:
    for object_ in list(bpy.context.scene.objects):
        if object_ != mesh and object_.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(object_, do_unlink=True)


def create_back_wings(mesh: bpy.types.Object) -> tuple[bpy.types.Object, bpy.types.Object]:
    """SPAR3D の正面生成では失われた背面翼の外形を、三面図位置にだけ補う。

    広い板ではなく羽根状の半透明4枚ずつに分ける。背面では左右へ、側面では
    後方へ張り出すので、三面図で確認できる翼の輪郭をテクスチャだけに頼らない。
    """
    minimum, maximum = mesh_bounds(mesh)
    size = maximum - minimum
    center_x = (minimum.x + maximum.x) * 0.5
    root_y = minimum.y - size.y * 0.015
    # 羽根は背面 x-z 面に畳む。正面では胴に隠れ、側面には背面端の意匠だけを残す。
    tip_y = root_y
    # 三面図の円形ハブと同じ腰寄りの高さから羽根を開く。
    root_z = minimum.z + size.z * 0.42
    material = bpy.data.materials.new("Hero Nendo Cyan Translucent Wings")
    material.use_nodes = True
    bsdf = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    cyan = (0.01, 0.45, 0.72, 1.0)
    bsdf.inputs["Base Color"].default_value = cyan
    bsdf.inputs["Metallic"].default_value = 0.10
    bsdf.inputs["Roughness"].default_value = 0.24
    bsdf.inputs["Alpha"].default_value = 0.35
    bsdf.inputs["Emission Color"].default_value = (0.0, 0.08, 0.20, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.22
    # Blender 5 の DITHERED は glTF の alpha blend と EEVEE 表示の両方で透過を保つ。
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    if hasattr(material, "use_backface_culling"):
        material.use_backface_culling = True

    wings: list[bpy.types.Object] = []
    for side, label in ((-1.0, "Left"), (1.0, "Right")):
        vertices: list[tuple[float, float, float]] = []
        faces: list[tuple[int, int, int]] = []
        for blade in range(5):
            root_top = root_z - size.z * (0.010 + blade * 0.026)
            root_bottom = root_top - size.z * 0.050
            # 正面の肩幅を超えない寸法へ畳み、背面だけで羽根の段差を読ませる。
            tip_x = center_x + side * size.x * (0.42 + blade * 0.018)
            tip_z = root_z - size.z * (0.075 + blade * 0.065)
            # 先端を後ろへ振ることで、側面では胴の後ろに半透明の羽根束が見える。
            blade_tip_y = tip_y
            start = len(vertices)
            vertices.extend(
                (
                    (center_x + side * size.x * 0.16, root_y, root_top),
                    (center_x + side * size.x * 0.17, root_y, root_bottom),
                    (tip_x, blade_tip_y, tip_z),
                )
            )
            # すべて -Y（背面カメラ）を向く片面に統一する。front へ翼を透かさない。
            faces.append((start, start + 1, start + 2) if side > 0 else (start, start + 2, start + 1))
        # 折れた側面羽根: +X/-X の各カメラへだけ広い面を見せる。前面は edge-on のため
        # フードと胸コアを隠さず、側面では胴体背面から連続して開く。
        panel_x = center_x + side * size.x * 0.52
        # 側面で見える胴の背中内側まで根元を入れ、羽根と胴の間に背景を残さない。
        panel_root_y = minimum.y + size.y * 0.35
        for blade in range(4):
            panel_root_z = root_z - size.z * (0.018 + blade * 0.042)
            # 三面図の側面では翼は画像右の後方へ開くため、側面用の折り面だけ +Y へ振る。
            panel_tip_y = minimum.y + size.y * (0.64 + blade * 0.030)
            panel_tip_z = root_z - size.z * (0.090 + blade * 0.070)
            start = len(vertices)
            vertices.extend(
                (
                    (panel_x, panel_root_y, panel_root_z),
                    (panel_x, panel_root_y, panel_root_z - size.z * 0.055),
                    (panel_x, panel_tip_y, panel_tip_z),
                )
            )
            faces.append((start, start + 1, start + 2) if side > 0 else (start, start + 2, start + 1))
        data = bpy.data.meshes.new(f"HeroNendoBackWing{label}Mesh")
        data.from_pydata(vertices, [], faces)
        data.materials.append(material)
        wing = bpy.data.objects.new(f"HeroNendoBackWing{label}", data)
        bpy.context.collection.objects.link(wing)
        wings.append(wing)
    log("WING_GEOMETRY back_blades_per_side=5 side_blades_per_side=4 material=cyan_translucent")
    return tuple(wings)  # type: ignore[return-value]


def add_area_light(name: str, location: Vector, energy: float, size: float, target: Vector) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, target)


def render_preview(
    mesh: bpy.types.Object,
    path: Path,
    direction: Vector,
    extras: tuple[bpy.types.Object, ...] = (),
) -> int:
    """三面図と同じ正投影で、意匠比較用の中間グレー背景プレビューを描く。"""
    clear_render_helpers(mesh)
    coordinates = [
        object_.matrix_world @ vertex.co
        for object_ in (mesh, *extras)
        for vertex in object_.data.vertices
    ]
    minimum = Vector(tuple(min(coordinate[axis] for coordinate in coordinates) for axis in range(3)))
    maximum = Vector(tuple(max(coordinate[axis] for coordinate in coordinates) for axis in range(3)))
    center = (minimum + maximum) * 0.5
    height = float(maximum.z - minimum.z)
    horizontal = Vector((-direction.y, direction.x, 0.0))
    horizontal_span = max(
        abs(float((object_.matrix_world @ vertex.co - center).dot(horizontal)))
        for object_ in (mesh, *extras)
        for vertex in object_.data.vertices
    ) * 2.0
    aspect = 512 / 768
    ortho_scale = max(height * 1.08, horizontal_span / aspect * 1.08)

    scene = bpy.context.scene
    available_engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in available_engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium Low Contrast"
    scene.view_settings.exposure = 0.0
    # 濃紺ではなく中間グレー。テクスチャの白銀トリムとシアンを比較しやすくする。
    grey = srgb_to_linear(0.52)
    world = scene.world
    world.color = (grey, grey, grey)
    if world.use_nodes:
        background = next((node for node in world.node_tree.nodes if node.type == "BACKGROUND"), None)
        if background:
            background.inputs["Color"].default_value = (grey, grey, grey, 1.0)
            background.inputs["Strength"].default_value = 0.18

    camera_data = bpy.data.cameras.new(f"PreviewCamera{path.stem}")
    camera = bpy.data.objects.new(camera_data.name, camera_data)
    bpy.context.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    camera.location = center + direction * (height * 3.0)
    look_at(camera, center)
    scene.camera = camera
    right = Vector((-direction.y, direction.x, 0.0))
    # 色確認が目的なので、白飛びせず黒いフードを残す低出力の無彩色3灯にする。
    add_area_light("PreviewKey", center + direction * (height * 1.8) + right * (height * 0.65) + Vector((0, 0, height)), 105, height * 1.4, center)
    add_area_light("PreviewFill", center + direction * (height * 1.1) - right * (height * 0.85) + Vector((0, 0, height * 0.35)), 42, height * 1.6, center)
    add_area_light("PreviewRim", center - direction * (height * 1.5) + Vector((0, 0, height * 1.2)), 65, height * 1.3, center)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.is_file() or path.stat().st_size < MIN_PREVIEW_BYTES:
        fail(f"Preview render is missing or unexpectedly small: {path}")
    return path.stat().st_size


def process(name: str) -> None:
    source_path = SOURCE_DIR / f"{name}.glb"
    if not source_path.is_file():
        fail(f"Missing SPAR3D input: {source_path}")
    output_basecolor = OUTPUT_DIR / f"{name}-basecolor.png"
    output_glb = OUTPUT_DIR / f"{name}.glb"
    preview_paths = {view: OUTPUT_DIR / f"preview-{name}-{view}.png" for view in VIEW_NAMES}

    clear_scene()
    imported = bpy.ops.import_scene.gltf(filepath=str(source_path))
    if "FINISHED" not in imported:
        fail(f"glTF import failed: {imported}")
    mesh = primary_character_mesh()
    source_material = mesh.active_material
    source_base = image_for_socket(source_material, "Base Color")
    source_normal = image_for_socket(source_material, "Normal")
    log(
        f"INPUT path={source_path} mesh={mesh.name} vertices={len(mesh.data.vertices)} "
        f"faces={len(mesh.data.polygons)} base_texture={tuple(source_base.size)} normal_texture={tuple(source_normal.size)}"
    )
    normalize_to_plus_y_front(mesh)
    turnaround_image, _, _, views, _, _ = load_turnaround(name)
    basecolor, _, _ = bake_turnaround_basecolor_gpu(mesh, turnaround_image, views, source_base)
    save_png(basecolor, output_basecolor)

    material = turnaround_material(basecolor, source_normal)
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    for polygon in mesh.data.polygons:
        polygon.material_index = 0
    wings = create_back_wings(mesh)
    glb_bytes = export_glb(mesh, output_glb, wings)
    preview_bytes = {
        "front": render_preview(mesh, preview_paths["front"], Vector((0.0, 1.0, 0.0)), wings),
        "side": render_preview(mesh, preview_paths["side"], Vector((1.0, 0.0, 0.0)), wings),
        "back": render_preview(mesh, preview_paths["back"], Vector((0.0, -1.0, 0.0)), wings),
    }
    log(
        "OUTPUT "
        f"basecolor={output_basecolor} bytes={output_basecolor.stat().st_size} "
        f"glb={output_glb} bytes={glb_bytes} "
        + " ".join(f"preview_{view}={preview_paths[view]}:{preview_bytes[view]}" for view in VIEW_NAMES)
    )


def main() -> None:
    name = parse_name(sys.argv)
    process(name)
    print(f"TURNAROUND_TEXTURE_OK name={name} output_dir={OUTPUT_DIR}")


if __name__ == "__main__":
    main()
