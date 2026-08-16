"""SPAR3D の白飛び材質を、暗い装甲と意匠として読める発光回路へ作り直す。

SPAR3D が出力するアルベドは一定の明度へ寄るため、元画像の彩度を上げて
復元しない。輝度を正規化して黒い金属のパネル形状が残るレンジへ写し、発光は
ワールド座標で選んだ「胸のコア・目・体側の縦線・関節点」だけを頂点カラーから
UV へ焼く。胴を横断する高さだけの水平帯は作らない。

実行例:
    blender --background --factory-startup --python-exit-code 1 \
      --python scripts/rebuild_materials.py -- chaser
"""

from __future__ import annotations

import math
import sys
from collections.abc import Iterable
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "production" / "demonic" / "spar3d"
OUTPUT_DIR = ROOT / "assets" / "production" / "demonic" / "materials"
REFERENCE_DIR = ROOT / "assets" / "production" / "demonic" / "refs"

CHARACTER_NAMES = frozenset(("hero", "chaser", "shooter", "thief", "boss"))
EMISSIVE_HEX = {
    "hero": "#22d3ee",
    "chaser": "#e11d48",
    "shooter": "#d946ef",
    "thief": "#c026d3",
    "boss": "#dc2626",
}
LUMINANCE = np.array((0.2126, 0.7152, 0.0722), dtype=np.float32)
# 参照画像を投影した baseColor が主役になったので、発光は差し色に留める。
# 面積を広く・強くすると GlowLayer で全身が発光色に染まり、装甲の色分けが見えなくなる。
EMISSION_AREA_MIN = 0.02
EMISSION_AREA_MAX = 0.055
# 本編ライティング下で沈まない baseColor の明度レンジ（実測で決めた値）。
BASECOLOR_LUMINANCE_MIN = 0.26
BASECOLOR_LUMINANCE_MAX = 0.34
EMISSION_AREA_THRESHOLD = 0.15
EMISSION_MASK_CUTOFF = 0.06
EDGE_AREA_MAX = 0.15
EDGE_MASK_THRESHOLD = 0.30
MAX_MATERIAL_BYTES = 3_500_000
# 投影した参照画を立体へ馴染ませる陰影乗算の強度。彩度補正ではなく、SPAR3D の
# 元アルベドが持つ明暗だけを控えめに戻す（強すぎると参照画の意匠が沈む）。
SHADOW_MULTIPLY_STRENGTH = 0.72
EDGE_HIGHLIGHT_MIX = 0.35
PROJECTION_FRONT_UV = "ReferenceProjectionFrontUV"
PROJECTION_BACK_UV = "ReferenceProjectionBackUV"
PROJECTION_FRONT_WEIGHT = "ReferenceProjectionFrontWeight"
HUE_BIN_COUNT = 12
HUE_SATURATION_MIN = 0.10


def log(name: str, message: str) -> None:
    print(f"[MATERIAL_REBUILD] name={name} {message}")


def fail(message: str) -> None:
    raise RuntimeError(message)


def parse_names(argv: list[str]) -> list[str]:
    """Blender の ``--`` より後だけをキャラクター名として扱う。"""
    try:
        separator = argv.index("--")
    except ValueError:
        fail("Pass one or more names after '--', for example: -- chaser")
    names = argv[separator + 1 :]
    if not names:
        fail("No character names were provided after '--'.")
    unknown = sorted(set(names) - CHARACTER_NAMES)
    if unknown:
        fail(f"Unsupported character name(s): {', '.join(unknown)}")
    return names


def clear_scene() -> None:
    """factory-startup の既定キューブも含め、今回の入力だけを残す。"""
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def largest_character_mesh() -> bpy.types.Object:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        fail("The imported GLB contains no mesh.")
    # SPAR3D の撮影ステージ用 cube は数面だけなので、最多面メッシュが本体。
    character = max(meshes, key=lambda obj: len(obj.data.polygons))
    if len(character.data.polygons) < 100:
        fail("The largest imported mesh is too small to be a character.")
    # 装飾・付属メッシュ（100面以上）とアーマチュアは残す。一方、SPAR3D撮影用の
    # 少面数ステージ、カメラ、ライト、空のrootは出力に混ぜない。これは作業シーンの
    # 選別であり、入力GLBは一切変更しない。
    for obj in list(bpy.context.scene.objects):
        keep = obj == character or obj.type == "ARMATURE" or (obj.type == "MESH" and len(obj.data.polygons) >= 100)
        if not keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    character.name = "RebuiltCharacter"
    return character


def image_for_socket(material: bpy.types.Material, socket_name: str) -> bpy.types.Image:
    """Principled の接続から元の glTF 画像を取り出す。"""
    if not material or not material.node_tree:
        fail("Imported character has no node material.")
    bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        fail("Imported character material has no Principled BSDF.")
    socket = bsdf.inputs.get(socket_name)
    if not socket or not socket.is_linked:
        fail(f"Imported material has no connected {socket_name} texture.")
    from_node = socket.links[0].from_node
    if socket_name == "Normal" and from_node.type == "NORMAL_MAP":
        color_socket = from_node.inputs.get("Color")
        if color_socket and color_socket.is_linked:
            from_node = color_socket.links[0].from_node
    if from_node.type != "TEX_IMAGE" or from_node.image is None:
        fail(f"Could not resolve {socket_name} to an image texture.")
    return from_node.image


def pixels_array(image: bpy.types.Image) -> np.ndarray:
    width, height = image.size
    if width <= 0 or height <= 0:
        fail(f"Image has invalid dimensions: {image.name} {tuple(image.size)}")
    pixels = np.asarray(image.pixels[:], dtype=np.float32)
    expected = width * height * 4
    if pixels.size != expected:
        fail(f"Image pixel count mismatch for {image.name}: {pixels.size} != {expected}")
    return pixels.reshape((height, width, 4))


def save_png(image: bpy.types.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"Failed to save PNG: {path}")


def reduce_texture_resolution(images: Iterable[bpy.types.Image]) -> tuple[int, int]:
    """GLB が容量上限を超えた時だけ、テクスチャを 75% へ縮小する。"""
    final_size: tuple[int, int] | None = None
    for image in images:
        width, height = image.size
        reduced = (max(512, round(width * 0.75)), max(512, round(height * 0.75)))
        if reduced == (width, height):
            fail(f"Cannot reduce texture further while enforcing material size: {image.name} {reduced}")
        image.scale(*reduced)
        final_size = reduced
    if final_size is None:
        fail("No textures available for material-size reduction.")
    return final_size


def image_from_pixels(
    name: str,
    pixels: np.ndarray,
    *,
    colorspace: str,
) -> bpy.types.Image:
    height, width, channels = pixels.shape
    if channels != 4:
        fail(f"Expected RGBA pixels for {name}, got {channels} channels.")
    image = bpy.data.images.new(name, width=width, height=height, alpha=True)
    image.colorspace_settings.name = colorspace
    image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
    image.update()
    return image


def reference_image(name: str) -> bpy.types.Image:
    """色の正本である参照 PNG を読む。hero も bright 版ではなく必ず hero.png を使う。"""
    path = REFERENCE_DIR / f"{name}.png"
    if not path.is_file():
        fail(f"Missing reference image for projection: {path}")
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "sRGB"
    return image


def subject_uv_bounds(reference: bpy.types.Image) -> tuple[float, float, float, float]:
    """参照 PNG の alpha から、被写体が占める UV 範囲を返す。"""
    pixels = pixels_array(reference)
    alpha = pixels[:, :, 3]
    occupied = alpha > (1.0 / 255.0)
    if not occupied.any():
        fail(f"Reference image has no non-transparent subject: {reference.filepath}")
    ys, xs = np.where(occupied)
    height, width = alpha.shape
    # Blender の image.pixels は UV と同じく下から上の順で並ぶ。PNG ファイル上の
    # 行番号へ反転し直さず、このまま V 範囲にする。
    left = float(xs.min() / width)
    right = float((xs.max() + 1) / width)
    bottom = float(ys.min() / height)
    top = float((ys.max() + 1) / height)
    if right - left < 1e-5 or top - bottom < 1e-5:
        fail(f"Reference subject bounds are degenerate: {reference.filepath}")
    return left, right, bottom, top


def active_uv_name(mesh: bpy.types.Object) -> str:
    layer = mesh.data.uv_layers.active or (mesh.data.uv_layers[0] if mesh.data.uv_layers else None)
    if layer is None:
        fail("Character mesh has no UV map for the SPAR3D shading guide.")
    return layer.name


def remove_projection_data(mesh: bpy.types.Object) -> None:
    """投影専用の UV/属性は焼き込み後に除き、最終 GLB の容量を増やさない。"""
    for uv_name in (PROJECTION_FRONT_UV, PROJECTION_BACK_UV):
        layer = mesh.data.uv_layers.get(uv_name)
        if layer:
            mesh.data.uv_layers.remove(layer)
    attribute = mesh.data.color_attributes.get(PROJECTION_FRONT_WEIGHT)
    if attribute:
        mesh.data.color_attributes.remove(attribute)


def create_reference_projection_uvs(
    mesh: bpy.types.Object,
    reference: bpy.types.Image,
) -> tuple[str, tuple[float, float, float, float, float]]:
    """+Y 正面のメッシュを参照画像へ正投影する一時 UV を作る。

    前面は通常投影、背面は左右反転した投影を使う。横向きの法線だけは両者を
    smoothstep で混ぜるため、肩や腕の境界で正面の意匠が一本の帯にならない。
    """
    remove_projection_data(mesh)
    base_uv_name = active_uv_name(mesh)
    reference_left, reference_right, reference_bottom, reference_top = subject_uv_bounds(reference)
    coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    normals = np.asarray([tuple(vertex.normal) for vertex in mesh.data.vertices], dtype=np.float32)
    minimum, maximum = coords.min(axis=0), coords.max(axis=0)
    width = max(float(maximum[0] - minimum[0]), 1e-6)
    height = max(float(maximum[2] - minimum[2]), 1e-6)
    front_uv = mesh.data.uv_layers.new(name=PROJECTION_FRONT_UV)
    back_uv = mesh.data.uv_layers.new(name=PROJECTION_BACK_UV)

    # 正面ビューの外形 bbox と alpha 被写体 bbox を一致させる。SPAR3D の crop に
    # 依存せず、各キャラクターの実メッシュ寸法からスケールとオフセットを決める。
    projected_u = reference_left + (coords[:, 0] - minimum[0]) / width * (reference_right - reference_left)
    projected_v = reference_bottom + (coords[:, 2] - minimum[2]) / height * (reference_top - reference_bottom)
    for loop_index, loop in enumerate(mesh.data.loops):
        vertex_index = loop.vertex_index
        u = float(projected_u[vertex_index])
        v = float(projected_v[vertex_index])
        front_uv.data[loop_index].uv = (u, v)
        back_uv.data[loop_index].uv = (reference_left + reference_right - u, v)

    # 既存プレビューで hero の兜・胸コアが参照と同じ向きに見える +Y を正面として
    # 実測確認した。n.y = 0 付近だけをなめらかに混ぜ、前後を確実に分離する。
    transition = np.clip((normals[:, 1] + 0.28) / 0.56, 0.0, 1.0)
    front_weight = (transition * transition * (3.0 - 2.0 * transition)).astype(np.float32)
    assign_vertex_mask(mesh, front_weight, PROJECTION_FRONT_WEIGHT)
    front_ratio = float((front_weight >= 0.99).mean())
    back_ratio = float((front_weight <= 0.01).mean())
    side_ratio = float(1.0 - front_ratio - back_ratio)
    return base_uv_name, (reference_left, reference_right, reference_bottom, reference_top, side_ratio)


def make_reference_projection_bake_material(
    name: str,
    reference: bpy.types.Image,
    shadow_source: bpy.types.Image,
    base_uv_name: str,
    shadow_range: tuple[float, float],
    image: bpy.types.Image,
) -> bpy.types.Material:
    """投影色と SPAR3D 輝度ガイドを元 UV へ焼く Emit 材質を組み立てる。"""
    material = bpy.data.materials.new(f"BakeProjection.{name}")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    target.select = True
    nodes.active = target

    def reference_sample(label: str, uv_name: str) -> bpy.types.Node:
        uv_map = nodes.new("ShaderNodeUVMap")
        uv_map.uv_map = uv_name
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = label
        texture.image = reference
        texture.interpolation = "Linear"
        texture.extension = "CLIP"
        links.new(uv_map.outputs["UV"], texture.inputs["Vector"])
        return texture

    front = reference_sample("Reference Front Projection", PROJECTION_FRONT_UV)
    back = reference_sample("Reference Mirrored Back Projection", PROJECTION_BACK_UV)
    front_weight = nodes.new("ShaderNodeVertexColor")
    front_weight.layer_name = PROJECTION_FRONT_WEIGHT
    front_back_mix = nodes.new("ShaderNodeMixRGB")
    links.new(front_weight.outputs["Color"], front_back_mix.inputs["Fac"])
    links.new(back.outputs["Color"], front_back_mix.inputs[1])
    links.new(front.outputs["Color"], front_back_mix.inputs[2])

    # SPAR3D の白飛びアルベドは色には使わず、percentile 正規化した明暗だけを
    # 0.72 強度で掛ける。これにより参照画像の塗りを平坦なステッカーにしない。
    guide_uv = nodes.new("ShaderNodeUVMap")
    guide_uv.uv_map = base_uv_name
    guide_texture = nodes.new("ShaderNodeTexImage")
    guide_texture.name = "SPAR3D Shadow Guide"
    guide_texture.image = shadow_source
    guide_texture.interpolation = "Linear"
    guide_luminance = nodes.new("ShaderNodeRGBToBW")
    guide_normalize = nodes.new("ShaderNodeMapRange")
    guide_normalize.clamp = True
    guide_normalize.inputs["From Min"].default_value = shadow_range[0]
    guide_normalize.inputs["From Max"].default_value = shadow_range[1]
    guide_normalize.inputs["To Min"].default_value = 1.0 - SHADOW_MULTIPLY_STRENGTH * 0.40
    guide_normalize.inputs["To Max"].default_value = 1.0 + SHADOW_MULTIPLY_STRENGTH * 0.12
    projection_with_shade = nodes.new("ShaderNodeMixRGB")
    projection_with_shade.blend_type = "MULTIPLY"
    projection_with_shade.inputs["Fac"].default_value = 1.0
    links.new(guide_uv.outputs["UV"], guide_texture.inputs["Vector"])
    links.new(guide_texture.outputs["Color"], guide_luminance.inputs["Color"])
    links.new(guide_luminance.outputs["Val"], guide_normalize.inputs["Value"])
    links.new(front_back_mix.outputs["Color"], projection_with_shade.inputs[1])
    links.new(guide_normalize.outputs["Result"], projection_with_shade.inputs[2])
    links.new(projection_with_shade.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def triangle_texel_weights(
    uv: np.ndarray,
    size: tuple[int, int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """UV 三角形が覆う texel と、その頂点重みを返す（Blender GPU bake 非依存）。"""
    width, height = size
    positions = np.empty((3, 2), dtype=np.float32)
    positions[:, 0] = uv[:, 0] * (width - 1)
    positions[:, 1] = uv[:, 1] * (height - 1)
    determinant = (
        (positions[1, 1] - positions[2, 1]) * (positions[0, 0] - positions[2, 0])
        + (positions[2, 0] - positions[1, 0]) * (positions[0, 1] - positions[2, 1])
    )
    if abs(float(determinant)) < 1e-9:
        return None
    x_min = max(0, int(math.floor(float(positions[:, 0].min()))))
    x_max = min(width - 1, int(math.ceil(float(positions[:, 0].max()))))
    y_min = max(0, int(math.floor(float(positions[:, 1].min()))))
    y_max = min(height - 1, int(math.ceil(float(positions[:, 1].max()))))
    if x_max < x_min or y_max < y_min:
        return None
    xs, ys = np.meshgrid(
        np.arange(x_min, x_max + 1, dtype=np.float32),
        np.arange(y_min, y_max + 1, dtype=np.float32),
    )
    weight0 = (
        (positions[1, 1] - positions[2, 1]) * (xs - positions[2, 0])
        + (positions[2, 0] - positions[1, 0]) * (ys - positions[2, 1])
    ) / determinant
    weight1 = (
        (positions[2, 1] - positions[0, 1]) * (xs - positions[2, 0])
        + (positions[0, 0] - positions[2, 0]) * (ys - positions[2, 1])
    ) / determinant
    weight2 = 1.0 - weight0 - weight1
    inside = (weight0 >= -1e-4) & (weight1 >= -1e-4) & (weight2 >= -1e-4)
    if not inside.any():
        return None
    coordinates = np.column_stack((ys[inside].astype(np.int32), xs[inside].astype(np.int32)))
    weights = np.column_stack((weight0[inside], weight1[inside], weight2[inside])).astype(np.float32)
    return coordinates, weights, inside


def triangle_loop_indices(mesh: bpy.types.Object) -> Iterable[tuple[int, int, int]]:
    """ngon でも fan 分割して、UV と頂点を同じ loop index で扱う。"""
    for polygon in mesh.data.polygons:
        loops = polygon.loop_indices[:]
        for index in range(1, len(loops) - 1):
            yield loops[0], loops[index], loops[index + 1]


def rasterize_vertex_values_to_uv(
    mesh: bpy.types.Object,
    values: np.ndarray,
    size: tuple[int, int],
) -> np.ndarray:
    """頂点値を元 UV へ CPU ラスタライズする。

    headless Linux Blender 4.0 は Cycles の IMAGE_TEXTURES bake が空画像を返すため、
    同じ barycentric 補間を明示的に行う。これは投影の近似ではなく、UV 三角形への
    値の厳密な線形補間である。
    """
    if len(values) != len(mesh.data.vertices):
        fail(f"Vertex-value length mismatch: {len(values)} != {len(mesh.data.vertices)}")
    width, height = size
    uv_layer = mesh.data.uv_layers.get(active_uv_name(mesh))
    if uv_layer is None:
        fail("Could not resolve the active UV map for CPU rasterization.")
    output = np.zeros((height, width), dtype=np.float32)
    for loop_indices in triangle_loop_indices(mesh):
        loops = np.asarray(loop_indices, dtype=np.int32)
        triangle = np.asarray([uv_layer.data[index].uv[:] for index in loops], dtype=np.float32)
        rasterized = triangle_texel_weights(triangle, size)
        if rasterized is None:
            continue
        coordinates, weights, _ = rasterized
        vertex_indices = np.asarray([mesh.data.loops[index].vertex_index for index in loops], dtype=np.int32)
        output[coordinates[:, 0], coordinates[:, 1]] = weights @ values[vertex_indices]
    return np.clip(output, 0.0, 1.0)


def bilinear_sample(pixels: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Blender の下→上ピクセル配列から、UV の色を線形補間で読む。"""
    height, width, channels = pixels.shape
    if channels < 3:
        fail("Projection image has fewer than three color channels.")
    clipped = np.clip(uv, 0.0, 1.0)
    x = clipped[:, 0] * (width - 1)
    y = clipped[:, 1] * (height - 1)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.minimum(x0 + 1, width - 1)
    y1 = np.minimum(y0 + 1, height - 1)
    tx = (x - x0)[:, None]
    ty = (y - y0)[:, None]
    lower = pixels[y0, x0, :3] * (1.0 - tx) + pixels[y0, x1, :3] * tx
    upper = pixels[y1, x0, :3] * (1.0 - tx) + pixels[y1, x1, :3] * tx
    return lower * (1.0 - ty) + upper * ty


def rasterize_reference_projection_to_uv(
    mesh: bpy.types.Object,
    reference: bpy.types.Image,
    shadow_source: bpy.types.Image,
    shadow_range: tuple[float, float],
) -> tuple[np.ndarray, np.ndarray]:
    """前面/左右反転背面の参照色を、元 UV へ CPU で焼き込む。"""
    source_pixels = pixels_array(shadow_source)
    height, width, _ = source_pixels.shape
    size = (width, height)
    base_uv = mesh.data.uv_layers.get(active_uv_name(mesh))
    front_uv = mesh.data.uv_layers.get(PROJECTION_FRONT_UV)
    back_uv = mesh.data.uv_layers.get(PROJECTION_BACK_UV)
    front_attribute = mesh.data.color_attributes.get(PROJECTION_FRONT_WEIGHT)
    if not base_uv or not front_uv or not back_uv or not front_attribute:
        fail("Reference projection UV data is incomplete before CPU rasterization.")
    reference_pixels = pixels_array(reference)
    output = np.zeros((height, width, 4), dtype=np.float32)
    valid_mask = np.zeros((height, width), dtype=bool)
    shadow_min, shadow_max = shadow_range
    for loop_indices in triangle_loop_indices(mesh):
        loops = np.asarray(loop_indices, dtype=np.int32)
        base_triangle = np.asarray([base_uv.data[index].uv[:] for index in loops], dtype=np.float32)
        rasterized = triangle_texel_weights(base_triangle, size)
        if rasterized is None:
            continue
        coordinates, weights, _ = rasterized
        front_triangle = np.asarray([front_uv.data[index].uv[:] for index in loops], dtype=np.float32)
        back_triangle = np.asarray([back_uv.data[index].uv[:] for index in loops], dtype=np.float32)
        vertex_indices = np.asarray([mesh.data.loops[index].vertex_index for index in loops], dtype=np.int32)
        front_weights = np.asarray(
            [front_attribute.data[index].color[0] for index in vertex_indices],
            dtype=np.float32,
        )
        front_color = bilinear_sample(reference_pixels, weights @ front_triangle)
        back_color = bilinear_sample(reference_pixels, weights @ back_triangle)
        blend = (weights @ front_weights)[:, None]
        projected_color = back_color * (1.0 - blend) + front_color * blend
        source_color = source_pixels[coordinates[:, 0], coordinates[:, 1], :3]
        source_luminance = source_color @ LUMINANCE
        normalized = np.clip((source_luminance - shadow_min) / (shadow_max - shadow_min), 0.0, 1.0)
        shade = 1.0 - SHADOW_MULTIPLY_STRENGTH * 0.40 + normalized * SHADOW_MULTIPLY_STRENGTH * 0.52
        output[coordinates[:, 0], coordinates[:, 1], :3] = projected_color * shade[:, None]
        output[coordinates[:, 0], coordinates[:, 1], 3] = 1.0
        valid_mask[coordinates[:, 0], coordinates[:, 1]] = True
    return output, valid_mask


def bake_reference_projection(
    name: str,
    mesh: bpy.types.Object,
    reference: bpy.types.Image,
    shadow_source: bpy.types.Image,
) -> tuple[np.ndarray, np.ndarray, tuple[float, float], tuple[float, float, float, float, float]]:
    """参照投影を既存 UV へ焼き、最終 PNG が従来の UV 契約を保つようにする。"""
    base_uv_name, projection_bounds = create_reference_projection_uvs(mesh, reference)
    source_pixels = pixels_array(shadow_source)
    source_luminance = np.tensordot(source_pixels[:, :, :3], LUMINANCE, axes=([2], [0]))
    shadow_range = tuple(float(value) for value in np.percentile(source_luminance, (8, 92)))
    if shadow_range[1] - shadow_range[0] < 1e-6:
        fail(f"Base-color source has no usable brightness range: {shadow_range}")
    target_uv = mesh.data.uv_layers.get(base_uv_name)
    if target_uv is None:
        fail(f"Could not restore source UV map for projection bake: {base_uv_name}")
    mesh.data.uv_layers.active = target_uv
    target_uv.active_render = True
    baked, valid_mask = rasterize_reference_projection_to_uv(mesh, reference, shadow_source, shadow_range)
    coverage = float(valid_mask.mean())
    if coverage < 0.03:
        fail(f"Reference projection bake covered too little of the source UV: coverage={coverage:.4f}")
    remove_projection_data(mesh)
    return baked, valid_mask, shadow_range, projection_bounds


def color_statistics(rgb: np.ndarray, valid_mask: np.ndarray) -> tuple[float, float, list[int], int]:
    """輝度・平均彩度・主要色相ビン数を、実際にメッシュへ焼かれた texel だけで測る。"""
    if not valid_mask.any():
        fail("No valid texels are available for base-color statistics.")
    values = np.clip(rgb, 0.0, 1.0)
    maximum = values.max(axis=2)
    minimum = values.min(axis=2)
    delta = maximum - minimum
    saturation = np.divide(delta, maximum, out=np.zeros_like(delta), where=maximum > 1e-6)
    hue = np.zeros_like(maximum)
    nonzero = delta > 1e-6
    red = nonzero & (maximum == values[:, :, 0])
    green = nonzero & (maximum == values[:, :, 1])
    blue = nonzero & (maximum == values[:, :, 2])
    hue[red] = np.mod((values[:, :, 1][red] - values[:, :, 2][red]) / delta[red], 6.0)
    hue[green] = (values[:, :, 2][green] - values[:, :, 0][green]) / delta[green] + 2.0
    hue[blue] = (values[:, :, 0][blue] - values[:, :, 1][blue]) / delta[blue] + 4.0
    hue /= 6.0
    colorful = valid_mask & (saturation >= HUE_SATURATION_MIN) & (maximum >= 0.025)
    histogram = np.bincount(
        np.minimum((hue[colorful] * HUE_BIN_COUNT).astype(np.int32), HUE_BIN_COUNT - 1),
        minlength=HUE_BIN_COUNT,
    ).tolist()
    colorful_count = int(colorful.sum())
    # 主要ビンは彩度がある texel の 1% 以上（最低 32 texel）。灰銀エッジの丸め誤差を
    # 色相として数えず、参照画像由来の実在する複数色だけを通す閾値にする。
    major_threshold = max(32, math.ceil(colorful_count * 0.01))
    major_bins = sum(count >= major_threshold for count in histogram)
    mean_luminance = float(np.tensordot(values[valid_mask], LUMINANCE, axes=([1], [0])).mean())
    mean_saturation = float(saturation[valid_mask].mean())
    return mean_luminance, mean_saturation, histogram, major_bins


def rebuild_basecolor(
    name: str,
    mesh: bpy.types.Object,
    source: bpy.types.Image,
    reference: bpy.types.Image,
    edge_mask: np.ndarray,
) -> tuple[bpy.types.Image, float, float, list[int], int, tuple[float, float], tuple[float, float, float, float, float]]:
    """参照画像を投影し、既存の明暗と控えめな銀エッジを合成して baseColor にする。"""
    projected, valid_mask, percentile_range, projection_bounds = bake_reference_projection(name, mesh, reference, source)
    output = projected.copy()
    silver = srgb_to_linear((200 / 255, 212 / 255, 232 / 255))
    edge_mix = EDGE_HIGHLIGHT_MIX * np.clip(edge_mask, 0.0, 1.0)[:, :, None]
    output[:, :, :3] = output[:, :, :3] * (1.0 - edge_mix) + silver * edge_mix

    # 最終調整は RGB の同一スカラーだけを掛ける。色相・彩度を一律に操作せず、
    # 参照画が持つ装甲・革・布・宝石の差を保ったまま平均輝度だけを 0.30 へ寄せる。
    for _ in range(3):
        current_mean, _, _, _ = color_statistics(output[:, :, :3], valid_mask)
        scalar = 0.30 / max(current_mean, 1e-6)
        output[valid_mask, :3] = np.clip(output[valid_mask, :3] * scalar, 0.0, 1.0)
    mean_luminance, mean_saturation, hue_histogram, major_hue_bins = color_statistics(output[:, :, :3], valid_mask)
    output[:, :, 3] = 1.0
    image = image_from_pixels(f"{name}-basecolor", output, colorspace="sRGB")
    return (
        image,
        mean_luminance,
        mean_saturation,
        hue_histogram,
        major_hue_bins,
        percentile_range,
        projection_bounds,
    )


def copy_normal_as_png(name: str, source: bpy.types.Image) -> bpy.types.Image:
    """SPAR3D の有効なノーマルを再符号化せず PNG として保存する。"""
    return image_from_pixels(f"{name}-normal", pixels_array(source).copy(), colorspace="Non-Color")


def mesh_bounds(mesh: bpy.types.Object) -> tuple[np.ndarray, np.ndarray]:
    coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    if not len(coords):
        fail("Character mesh has no vertices.")
    return coords.min(axis=0), coords.max(axis=0)


def mesh_edge_cv(mesh: bpy.types.Object) -> float:
    """辺長のばらつきで marching-cubes 系の凹みノイズを見分ける。"""
    coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    edges: set[tuple[int, int]] = set()
    for polygon in mesh.data.polygons:
        vertices = polygon.vertices[:]
        for index, start in enumerate(vertices):
            end = vertices[(index + 1) % len(vertices)]
            edges.add((min(start, end), max(start, end)))
    lengths = np.asarray([np.linalg.norm(coords[a] - coords[b]) for a, b in edges], dtype=np.float32)
    if not len(lengths) or float(lengths.mean()) <= 1e-8:
        fail("Could not calculate a valid mesh edge-length distribution.")
    return float(lengths.std() / lengths.mean())


def smooth_vertex_values(values: np.ndarray, neighbors: list[list[int]], iterations: int = 6) -> np.ndarray:
    """凹み値を頂点グラフ上でぼかし、三角面ごとの粒を抑える。"""
    current = values.astype(np.float32, copy=True)
    for _ in range(iterations):
        averaged = np.asarray(
            [current[linked].mean() if linked else current[index] for index, linked in enumerate(neighbors)],
            dtype=np.float32,
        )
        current = current * 0.35 + averaged * 0.65
    return current


def smoothed_convex_values(mesh: bpy.types.Object) -> np.ndarray:
    """法線方向ラプラシアンから、スムージング済みの凸装甲エッジ候補を作る。"""
    vertices = mesh.data.vertices
    coords = np.asarray([tuple(vertex.co) for vertex in vertices], dtype=np.float32)
    normals = np.asarray([tuple(vertex.normal) for vertex in vertices], dtype=np.float32)
    neighbors: list[set[int]] = [set() for _ in vertices]
    for polygon in mesh.data.polygons:
        indices = polygon.vertices[:]
        for index, start in enumerate(indices):
            end = indices[(index + 1) % len(indices)]
            neighbors[start].add(end)
            neighbors[end].add(start)
    linked = [sorted(group) for group in neighbors]
    laplacian = np.asarray(
        [coords[group].mean(axis=0) - coords[index] if group else np.zeros(3) for index, group in enumerate(linked)],
        dtype=np.float32,
    )
    # 近傍平均が頂点より内側に寄る凸部では laplacian が内向きになるため、負号を
    # 付けた値が正になる。これは前回のcavity検出と同じ演算だが、符号の実体は凸部。
    convexity = -np.einsum("ij,ij->i", laplacian, normals)
    smooth = smooth_vertex_values(convexity, linked)
    lo, hi = (float(value) for value in np.percentile(smooth, (55, 97)))
    if hi - lo < 1e-8:
        return np.zeros(len(vertices), dtype=np.float32)
    # 高い凸部のみを残す。複数回の平滑化により三角形単位のノイズは後段の面積・
    # 孤立粒チェックで拒否できる。
    return np.clip((smooth - lo) / (hi - lo), 0.0, 1.0) ** 2.0


def head_visibility_values(mesh: bpy.types.Object) -> np.ndarray:
    """頭部 t >= 0.85 を緩く選択し、フード内の baseColor 下限に使う。"""
    coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    minimum, maximum = coords.min(axis=0), coords.max(axis=0)
    height = max(float(maximum[2] - minimum[2]), 1e-6)
    t = (coords[:, 2] - minimum[2]) / height
    return np.clip((t - 0.835) / 0.035, 0.0, 1.0).astype(np.float32)


def gaussian(distance_squared: np.ndarray, sharpness: float = 1.0) -> np.ndarray:
    """距離二乗をなめらかな 0..1 のガウシアン値に変える。

    ``sharpness`` を上げても中心値は 1 のまま、裾だけを短くできる。
    """
    return np.exp(-0.5 * distance_squared * sharpness).astype(np.float32)


def sharpen_emission_mask(mask: np.ndarray) -> np.ndarray:
    """発光ガウシアンの見えない裾を切り、中心寄りへ急減衰させる。"""
    clipped = np.where(mask >= EMISSION_MASK_CUTOFF, mask, 0.0)
    return np.clip(clipped, 0.0, 1.0) ** 1.35


def region_values(name: str, mesh: bpy.types.Object, spread: float) -> np.ndarray:
    """キャラクター意匠として読める発光だけをワールド座標で選ぶ。

    各値はメッシュ頂点から計算する 3D ガウシアンであり、UV 島・三角分割・元の
    アルベドには依存しない。高さだけでは決めないので、胸や腰を一周する帯になら
    ない。座標系は Mixamo handoff と同じ 180 度補正後の正面を -Y とする。
    """
    raw_coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    # SPAR3D の生入力は +Y が正面。prepare_for_mixamo.py の既定 180° yaw と
    # 同じ正規化を「選別用座標だけ」に適用し、実メッシュの向きは一切変えない。
    coords = raw_coords.copy()
    coords[:, :2] *= -1.0
    minimum, maximum = coords.min(axis=0), coords.max(axis=0)
    size = maximum - minimum
    height = max(float(size[2]), 1e-6)
    center_x = float((minimum[0] + maximum[0]) * 0.5)
    center_y = float((minimum[1] + maximum[1]) * 0.5)
    t = (coords[:, 2] - minimum[2]) / height
    depth = max(float(size[1]), 1e-5)
    half_width = max(float(size[0]) * 0.5, 1e-5)

    def front_distance_at(height_t: float) -> np.ndarray:
        """その高さの -Y 側表面を基準にする（胸と頭の前後差を吸収する）。"""
        sample = coords[np.abs(t - height_t) <= 0.035, 1]
        front_y = float(np.percentile(sample if len(sample) else coords[:, 1], 8))
        front_sigma = max(depth * 0.095 * spread, 0.014)
        return ((coords[:, 1] - front_y) / front_sigma) ** 2

    # 1. 胸のコア: 前面・中心の円形。boss だけ半径と高さ域を大きくする。
    # 前回より半径を 65% に絞る。大きい発光面ではなく、胸の一点として読む。
    chest_radius = 0.104 if name == "boss" else 0.049
    chest_t = 0.66 if name == "boss" else 0.66
    chest_sigma = chest_radius * 0.52 * spread
    chest_z_sigma = max(chest_sigma, height * (0.033 if name == "boss" else 0.027) * spread)
    chest = gaussian(
        ((coords[:, 0] - center_x) / chest_sigma) ** 2
        + ((coords[:, 2] - (minimum[2] + height * chest_t)) / chest_z_sigma) ** 2
        + front_distance_at(chest_t),
        sharpness=2.05,
    )

    # 2. 体側の縦ライン: 胴の幅を中央高さ帯から測り、左右の外側 60% 以降に
    # 約 8% の幅で置く。高さは 0.35-0.75 に収まり、横方向の線分にはならない。
    torso = (t >= 0.35) & (t <= 0.75)
    torso_half_width = float(np.percentile(np.abs(coords[torso, 0] - center_x), 40)) if torso.any() else half_width
    torso_half_width = max(min(torso_half_width, half_width), half_width * 0.28)
    line_x = torso_half_width * 0.82
    line_sigma = max(torso_half_width * 0.075 * spread, 0.008)  # 実機で見えるよう太さを戻す
    # UVの伸びた肩島へ漏れないよう、胸下から腰上までに限定する。横幅は前回の60%
    # のままで、縦の発光だけを短くして細い体側ラインとして読む。
    line_z_sigma = height * 0.075 * spread
    left_line = gaussian(
        ((coords[:, 0] - (center_x - line_x)) / line_sigma) ** 2
        + ((t - 0.55) / (line_z_sigma / height)) ** 2
        + ((coords[:, 1] - center_y) / max(depth * 0.42, 0.03)) ** 2,
        sharpness=1.65,
    )
    right_line = gaussian(
        ((coords[:, 0] - (center_x + line_x)) / line_sigma) ** 2
        + ((t - 0.55) / (line_z_sigma / height)) ** 2
        + ((coords[:, 1] - center_y) / max(depth * 0.42, 0.03)) ** 2,
        sharpness=1.65,
    )
    side_lines = np.maximum(left_line, right_line)

    # 3. 関節の点: 指定された二つの高さに、外側へ控えめな小点を置く。
    outer_half_width = float(np.percentile(np.abs(coords[torso, 0] - center_x), 88)) if torso.any() else half_width
    joint_x = min(outer_half_width * 0.84, half_width * 0.92)
    joint_x_sigma = max(outer_half_width * 0.075 * spread, 0.012)
    joint_z_sigma = max(height * 0.022 * spread, 0.014)
    joint_y_sigma = max(depth * 0.28, 0.028)
    joint_values: list[np.ndarray] = []
    for joint_t in (0.50, 0.71):
        joint_z = minimum[2] + height * joint_t
        for sign in (-1.0, 1.0):
            joint_values.append(
                gaussian(
                    ((coords[:, 0] - (center_x + sign * joint_x)) / joint_x_sigma) ** 2
                    + ((coords[:, 2] - joint_z) / joint_z_sigma) ** 2
                    + ((coords[:, 1] - center_y) / joint_y_sigma) ** 2
                )
            )
    joints = np.maximum.reduce(joint_values)

    # 目は荒い三角面上で頂点カラーにすると二点が一塊へ補間されるため、出力GLBの
    # 微小な発光ジオメトリとして別途追加する。
    # 関節の位置・半径は維持する。SPAR3Dの伸びたUV島では同じ面積でも肩だけが
    # 大きな発光面に見えるため、胸のコアより前に出ない出力強度へ抑える。
    return np.maximum.reduce((chest, side_lines * 0.55, joints * 0.18)).astype(np.float32)


def face_eye_surface_points(mesh: bpy.types.Object) -> tuple[tuple[Vector, Vector], ...]:
    """実際の前面三角形から、左右の目を置く3D座標と外向き法線を求める。

    投影できなかった目は結果から除かれるため、返る要素数は 0〜2 になる。

    SPAR3D の顔は一枚の大きな三角面になり得る。そのためUVへ小点を描くと面全体へ
    伸びる場合がある。三角形上の点を直接求め、出力GLBにだけ極小の発光点を置く。
    """
    coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    minimum, maximum = coords.min(axis=0), coords.max(axis=0)
    size = maximum - minimum
    center_x = float((minimum[0] + maximum[0]) * 0.5)
    height = max(float(size[2]), 1e-6)
    depth = max(float(size[1]), 1e-5)
    axial = np.abs(coords[:, 0] - center_x) <= max(float(size[0]) * 0.11, 0.020)
    anatomy_top = float(np.percentile(coords[axial, 2], 99.5)) if axial.any() else float(maximum[2])
    anatomy_height = max(anatomy_top - float(minimum[2]), height * 0.72)
    eye_z = float(minimum[2] + anatomy_height * 0.92)
    eye_band = np.abs(coords[:, 2] - eye_z) <= anatomy_height * 0.030
    eye_band_front = np.percentile(coords[eye_band, 1], 88) if eye_band.any() else float((minimum[1] + maximum[1]) * 0.5)
    face_front = eye_band & (coords[:, 1] >= eye_band_front - depth * 0.075)
    if face_front.any():
        face_center_x = float(np.median(coords[face_front, 0]))
        face_half_width = float(np.percentile(np.abs(coords[face_front, 0] - face_center_x), 82))
    else:
        face_center_x = center_x
        face_half_width = max(float(size[0]) * 0.06, 0.012)
    face_half_width = max(face_half_width, 0.012)
    eye_offset = max(face_half_width * 0.68, 0.009)
    # 幅のある帯ではなく、目の実高さで +Y 側にある断面から二点を取る。局所面が
    # 分断されるSPAR3Dメッシュでも、空間ではなく実際の三角面上へ置ける。
    eye_slice = np.abs(coords[:, 2] - eye_z) <= max(anatomy_height * 0.006, 0.004)
    slice_front_y = np.percentile(coords[eye_slice, 1], 85) if eye_slice.any() else eye_band_front
    slice_front = eye_slice & (coords[:, 1] >= slice_front_y - depth * 0.070)
    if int(slice_front.sum()) >= 6:
        eye_targets = (
            float(np.percentile(coords[slice_front, 0], 25)),
            float(np.percentile(coords[slice_front, 0], 75)),
        )
    else:
        eye_targets = (face_center_x - eye_offset, face_center_x + eye_offset)

    def point_at_front_surface(target_x: float) -> tuple[Vector, Vector]:
        """+Y 側から見て指定 x/z を覆う、最前面三角形上の点と法線を返す。"""
        best_y = -math.inf
        best_point: Vector | None = None
        best_normal: Vector | None = None
        for polygon in mesh.data.polygons:
            loops = polygon.loop_indices[:]
            if len(loops) < 3:
                continue
            for index in range(1, len(loops) - 1):
                triangle_loops = (loops[0], loops[index], loops[index + 1])
                vertex_indices = [mesh.data.loops[loop].vertex_index for loop in triangle_loops]
                triangle = coords[vertex_indices]
                x0, z0 = float(triangle[0, 0]), float(triangle[0, 2])
                x1, z1 = float(triangle[1, 0]), float(triangle[1, 2])
                x2, z2 = float(triangle[2, 0]), float(triangle[2, 2])
                determinant = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2)
                if abs(determinant) < 1e-9:
                    continue
                weight0 = ((z1 - z2) * (target_x - x2) + (x2 - x1) * (eye_z - z2)) / determinant
                weight1 = ((z2 - z0) * (target_x - x2) + (x0 - x2) * (eye_z - z2)) / determinant
                weight2 = 1.0 - weight0 - weight1
                if min(weight0, weight1, weight2) < -0.002:
                    continue
                surface_y = float(np.dot((weight0, weight1, weight2), triangle[:, 1]))
                if surface_y <= best_y:
                    continue
                best_y = surface_y
                point = Vector(weight0 * triangle[0] + weight1 * triangle[1] + weight2 * triangle[2])
                normal = (Vector(triangle[1]) - Vector(triangle[0])).cross(Vector(triangle[2]) - Vector(triangle[0]))
                if normal.length_squared < 1e-12:
                    continue
                normal.normalize()
                if normal.y < 0.0:
                    normal.negate()
                best_point = point
                best_normal = normal
        if best_point is None or best_normal is None:
            # 頭部の形状によっては前面へ投影できる三角形が見つからない（thief の角ばった
            # 仮面など）。目は装飾なので、失敗したらその点だけ省いて続行する。
            print(
                f"[MATERIAL_REBUILD] WARN eye emitter projection failed at "
                f"x={target_x:.4f} z={eye_z:.4f}; skipping this eye",
                file=sys.stderr,
            )
            return None
        return best_point, best_normal

    return tuple(
        projected
        for projected in (
            point_at_front_surface(eye_targets[0]),
            point_at_front_surface(eye_targets[1]),
        )
        if projected is not None
    )


def assign_vertex_mask(mesh: bpy.types.Object, values: np.ndarray, attribute_name: str) -> None:
    if len(values) != len(mesh.data.vertices):
        fail(f"Vertex-mask length mismatch: {len(values)} != {len(mesh.data.vertices)}")
    existing = mesh.data.color_attributes.get(attribute_name)
    if existing:
        mesh.data.color_attributes.remove(existing)
    attribute = mesh.data.color_attributes.new(attribute_name, type="FLOAT_COLOR", domain="POINT")
    for index, value in enumerate(values):
        attribute.data[index].color = (float(value), float(value), float(value), 1.0)


def make_bake_material(attribute_name: str, image: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.new(f"BakeMask.{attribute_name}")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = attribute_name
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    target.select = True
    nodes.active = target
    # 粗いUV上のテクスチャ発光は補助的な細線だけに留める。胸コアと目は別の微小
    # ジオメトリで鋭く描くため、広い裾が先に見えない強度へ抑える。
    emission.inputs["Strength"].default_value = 0.40
    links.new(vertex_color.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def bake_values_to_uv(
    mesh: bpy.types.Object,
    values: np.ndarray,
    label: str,
    size: tuple[int, int],
    attribute_name: str,
) -> np.ndarray:
    """頂点値を元 UV へ焼く。

    Blender 4.0/5.2 の headless GPU 初期化差に影響されないよう、Cycles の
    IMAGE_TEXTURES bake ではなく barycentric CPU ラスタライズを使う。``label`` と
    ``attribute_name`` は既存ログ/呼び出し契約を保つため残している。
    """
    del label, attribute_name
    return rasterize_vertex_values_to_uv(mesh, values, size)


def remove_bake_attribute(mesh: bpy.types.Object, attribute_name: str) -> None:
    """検証専用の頂点カラーを最終GLBへ持ち込まない。"""
    attribute = mesh.data.color_attributes.get(attribute_name)
    if attribute:
        mesh.data.color_attributes.remove(attribute)


def mask_metrics(mask: np.ndarray, threshold: float = EMISSION_AREA_THRESHOLD) -> tuple[float, float]:
    """面積比と孤立粒の比率。後者で全身の発光斑点を拒否する。"""
    active = mask > threshold
    area = float(active.mean())
    if not active.any():
        return area, 1.0
    padded = np.pad(active, 1, mode="constant", constant_values=False)
    neighbors = np.zeros_like(active, dtype=np.uint8)
    for dy in range(3):
        for dx in range(3):
            if dy == 1 and dx == 1:
                continue
            neighbors += padded[dy : dy + active.shape[0], dx : dx + active.shape[1]]
    isolated = active & (neighbors <= 1)
    return area, float(isolated.sum() / active.sum())


def select_edge_highlight_mask(
    mesh: bpy.types.Object,
    size: tuple[int, int],
) -> tuple[np.ndarray, float, float, float]:
    """凸エッジを 15% 未満に抑え、細かい白粒を含む候補を拒否する。"""
    raw_mask = bake_values_to_uv(
        mesh,
        smoothed_convex_values(mesh),
        "convex-edge",
        size,
        "RebuildEdgeMask",
    )
    remove_bake_attribute(mesh, "RebuildEdgeMask")
    candidates: list[tuple[np.ndarray, float, float, float]] = []
    # 面積が 15% を超えたら threshold を必ず上げて再評価する。
    for threshold in (0.24, 0.32, 0.40, 0.48, 0.56, 0.64):
        # 平滑化済みの凸稜線はこの応答で 7.56% から始まり、15%上限より下に保つ。
        # 中間調を残すことで、白粒ではなく連続した白銀のエッジになる。
        normalized = np.clip((raw_mask - threshold) / (1.0 - threshold), 0.0, 1.0) ** 0.45
        area, isolated = mask_metrics(normalized, threshold=EDGE_MASK_THRESHOLD)
        candidates.append((normalized, area, isolated, threshold))
        if area <= EDGE_AREA_MAX and isolated <= 0.035:
            return normalized, area, isolated, threshold
    measured = ", ".join(
        f"threshold={threshold:.2f}:area={area:.4f}:isolated={isolated:.4f}"
        for _, area, isolated, threshold in candidates
    )
    fail(
        "Could not build a coherent convex edge mask below the 15% cap. "
        f"mask_threshold={EDGE_MASK_THRESHOLD:.2f}; {measured}"
    )


def select_emission_mask(name: str, mesh: bpy.types.Object, size: tuple[int, int]) -> tuple[np.ndarray, float, float, float]:
    """意匠の比率を守ったガウシアン候補から、規定レンジの発光面積を選ぶ。"""
    candidates: list[tuple[np.ndarray, float, float, float]] = []
    # 発光を差し色へ戻したので下限側の候補も要る。上限側は残しておき、
    # 目標面積が変わっても同じ探索で拾えるようにする。
    for spread in (0.60, 0.78, 0.96, 1.14, 1.50, 1.86, 2.20, 2.60, 3.00, 3.40, 3.80, 4.30, 4.80, 5.40, 6.00):
        candidate = sharpen_emission_mask(bake_values_to_uv(
            mesh,
            region_values(name, mesh, spread),
            "anatomical-region",
            size,
            "RebuildEmissionMask",
        ))
        area, isolated = mask_metrics(candidate)
        candidates.append((candidate, area, isolated, spread))
        if EMISSION_AREA_MIN <= area <= EMISSION_AREA_MAX and isolated <= 0.035:
            return candidate, area, isolated, spread
    measured = ", ".join(
        f"spread={spread:.2f}:area={area:.4f}:isolated={isolated:.4f}"
        for _, area, isolated, spread in candidates
    )
    fail(
        f"Could not build an anatomical emission mask in the required "
        f"{EMISSION_AREA_MIN:.0%}-{EMISSION_AREA_MAX:.0%} range. "
        f"threshold={EMISSION_AREA_THRESHOLD:.2f}; {measured}"
    )


def srgb_to_linear(color: Iterable[float]) -> np.ndarray:
    values = np.asarray(tuple(color), dtype=np.float32)
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def hex_color(value: str) -> np.ndarray:
    raw = value.lstrip("#")
    if len(raw) != 6:
        fail(f"Invalid emissive color: {value}")
    return srgb_to_linear(tuple(int(raw[index : index + 2], 16) / 255.0 for index in range(0, 6, 2)))


def emission_image(name: str, mask: np.ndarray) -> bpy.types.Image:
    height, width = mask.shape
    output = np.zeros((height, width, 4), dtype=np.float32)
    # 発光ゼロ域は完全な黒。淡い元テクスチャを混ぜて斑点化しない。
    output[:, :, :3] = mask[:, :, None] * hex_color(EMISSIVE_HEX[name])
    output[:, :, 3] = 1.0
    return image_from_pixels(f"{name}-emissive", output, colorspace="sRGB")


def material_with_textures(
    name: str,
    basecolor: bpy.types.Image,
    emissive: bpy.types.Image,
    normal: bpy.types.Image,
) -> bpy.types.Material:
    material = bpy.data.materials.new(f"{name.title()} Obsidian Circuit")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.85
    bsdf.inputs["Roughness"].default_value = 0.42
    # glTF では KHR_materials_emissive_strength になる。4.0 にしたら GlowLayer(0.62)
    # と合わさって全身が発光色に染まり、投影した装甲の色分けが見えなくなった。
    # baseColor を主役にし、発光は差し色として乗せる。
    bsdf.inputs["Emission Strength"].default_value = 1.2
    base_node = nodes.new("ShaderNodeTexImage")
    base_node.name = "Obsidian Base Color"
    base_node.image = basecolor
    emission_node = nodes.new("ShaderNodeTexImage")
    emission_node.name = "Circuit Emissive"
    emission_node.image = emissive
    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = "SPAR3D Normal"
    normal_node.image = normal
    normal_node.image.colorspace_settings.name = "Non-Color"
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 1.0
    links.new(base_node.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(emission_node.outputs["Color"], bsdf.inputs["Emission Color"])
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return material


def create_eye_emitters(name: str, mesh: bpy.types.Object) -> list[bpy.types.Object]:
    """UV歪みを受けない、出力専用の微小な二つの発光眼を追加する。"""
    minimum, maximum = mesh_bounds(mesh)
    height = max(float((maximum - minimum)[2]), 1e-6)
    radius = max(height * 0.006, 0.003)
    offset = max(height * 0.0035, 0.0015)
    material = bpy.data.materials.new(f"{name.title()} Eye Cyan")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    cyan = hex_color(EMISSIVE_HEX[name])
    bsdf.inputs["Base Color"].default_value = (*cyan, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.24
    bsdf.inputs["Emission Color"].default_value = (*cyan, 1.0)
    # 目は面積が極小なので本体より強くてよいが、GlowLayer の滲みを考えて抑える。
    bsdf.inputs["Emission Strength"].default_value = 3.0
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    eyes: list[bpy.types.Object] = []
    for index, (point, normal) in enumerate(face_eye_surface_points(mesh), start=1):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=point + normal * offset)
        eye = bpy.context.object
        eye.name = f"{name.title()} Eye Emitter {index}"
        eye.rotation_euler = normal.to_track_quat("Y", "Z").to_euler()
        # 正面へ薄い楕円として張り出し、光る球や大きな面にはしない。
        eye.scale = (radius, radius * 0.30, radius * 0.58)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        # 全身プレビューは本体を床へ平行移動する。目も同じローカル座標系に親子付けし、
        # その移動で腰へ取り残されないようにする。
        eye.parent = mesh
        eye.matrix_parent_inverse = mesh.matrix_world.inverted()
        eye.data.materials.append(material)
        eyes.append(eye)
    return eyes


def create_chest_core_emitter(name: str, mesh: bpy.types.Object) -> bpy.types.Object:
    """粗いUVに依存しない、小さく円形の胸コアを前面へ追加する。"""
    minimum, maximum = mesh_bounds(mesh)
    height = max(float((maximum - minimum)[2]), 1e-6)
    coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    center_x = float((minimum[0] + maximum[0]) * 0.5)
    target_z = float(minimum[2] + height * 0.66)
    band = np.abs(coords[:, 2] - target_z) <= height * 0.045
    if not band.any():
        fail("Could not resolve chest vertices for core emitter.")
    front_cut = float(np.percentile(coords[band, 1], 84))
    candidates = np.flatnonzero(band & (coords[:, 1] >= front_cut - height * 0.030))
    if not len(candidates):
        fail("Could not resolve chest front surface for core emitter.")
    score = ((coords[candidates, 0] - center_x) / max(height * 0.07, 1e-5)) ** 2 + ((coords[candidates, 2] - target_z) / max(height * 0.05, 1e-5)) ** 2
    vertex_index = int(candidates[int(np.argmin(score))])
    point = Vector(coords[vertex_index])
    normal = mesh.data.vertices[vertex_index].normal.copy()
    if normal.y < 0.0:
        normal.negate()
    radius = max(height * 0.010, 0.004)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=point + normal * max(height * 0.004, 0.0015))
    core = bpy.context.object
    core.name = f"{name.title()} Chest Core Emitter"
    core.rotation_euler = normal.to_track_quat("Y", "Z").to_euler()
    core.scale = (radius, radius * 0.30, radius)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    core.parent = mesh
    core.matrix_parent_inverse = mesh.matrix_world.inverted()
    material = bpy.data.materials.new(f"{name.title()} Core Cyan")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    cyan = hex_color(EMISSIVE_HEX[name])
    bsdf.inputs["Base Color"].default_value = (*cyan, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.20
    bsdf.inputs["Emission Color"].default_value = (*cyan, 1.0)
    # 胸コアは意匠の中心なので目より僅かに強い程度に留める。
    bsdf.inputs["Emission Strength"].default_value = 3.2
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    core.data.materials.append(material)
    return core


def export_material_glb(
    name: str,
    mesh: bpy.types.Object,
    material: bpy.types.Material,
    path: Path,
    extra_objects: Iterable[bpy.types.Object] = (),
) -> None:
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    for obj in extra_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    result = bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        # Blender 5.2 は PNG を明示指定せず、RGBA PNG 入力を AUTO で保持する。
        export_image_format="AUTO",
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    if "FINISHED" not in result or not path.is_file() or path.stat().st_size == 0:
        fail(f"glTF export failed: result={result} path={path}")


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    size: float,
    target: Vector,
) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, target)


def configure_preview_bloom(scene: bpy.types.Scene) -> None:
    """Blender 5+ のコンポジタで、ゲーム内 GlowLayer に近い軽い bloom を足す。"""
    if bpy.app.version >= (5, 0, 0):
        tree = bpy.data.node_groups.new("PreviewBloomCompositor", "CompositorNodeTree")
        scene.compositing_node_group = tree
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        output = tree.nodes.new("NodeGroupOutput")
    else:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        output = tree.nodes.new("CompositorNodeComposite")

    render_layers = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    if bpy.app.version >= (5, 0, 0):
        # Blender 5 では Glare の設定が属性ではなく入力ソケットになった。
        glare.inputs["Type"].default_value = "Fog Glow"
        glare.inputs["Quality"].default_value = "High"
        glare.inputs["Threshold"].default_value = 0.85
        glare.inputs["Strength"].default_value = 0.16
        glare.inputs["Size"].default_value = 0.28
    else:
        glare.glare_type = "FOG_GLOW"
        glare.quality = "HIGH"
        glare.threshold = 0.85
        glare.size = 6
        glare.mix = -0.84  # 原画を保ちつつ、強い発光の周囲だけを軽く広げる。
    tree.links.new(render_layers.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], output.inputs["Image"])


def render_preview(name: str, mesh: bpy.types.Object, path: Path, *, back: bool = False, ground_mesh: bool = False) -> int:
    """ゲームに近い暗い環境で、前面または背面の材質破綻を検証する。"""
    minimum, maximum = mesh_bounds(mesh)
    if ground_mesh:
        mesh.location.z -= float(minimum[2])
        bpy.context.view_layer.update()
    size = maximum - minimum
    height = float(size[2])
    target = Vector((0.0, 0.0, height * 0.52))
    scene = bpy.context.scene
    engine_ids = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engine_ids else "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    # factory-startup の World は node-based のため world.color だけでは反映されない。
    world = scene.world
    neutral_black = tuple(srgb_to_linear((7 / 255, 8 / 255, 11 / 255)))
    world.color = neutral_black
    if world.use_nodes:
        background = next((node for node in world.node_tree.nodes if node.type == "BACKGROUND"), None)
        if background:
            background.inputs["Color"].default_value = (*neutral_black, 1.0)
            background.inputs["Strength"].default_value = 1.0
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.30

    # 暗い床で接地を読ませ、やや強めのキーライトで黒い金属面を浮かび上がらせる。
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.15, depth=0.06, location=(0.0, 0.0, -0.035))
    plinth = bpy.context.object
    plinth.name = "PreviewPlinth"
    plinth_material = bpy.data.materials.new("PreviewPlinthMaterial")
    plinth_material.use_nodes = True
    pbr = plinth_material.node_tree.nodes.get("Principled BSDF")
    pbr.inputs["Base Color"].default_value = (0.004, 0.005, 0.008, 1.0)
    pbr.inputs["Metallic"].default_value = 0.45
    pbr.inputs["Roughness"].default_value = 0.32
    plinth.data.materials.append(plinth_material)

    camera_data = bpy.data.cameras.new("MaterialPreviewCamera")
    camera = bpy.data.objects.new("MaterialPreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    # 生入力は +Y が正面。背面も同じ画角・露出で描き、投影の引き伸ばしを比較する。
    direction = -1.0 if back else 1.0
    camera.location = (0.0, direction * height * 3.35, height * 1.20)
    camera.data.lens = 62
    look_at(camera, target)
    scene.camera = camera
    # カメラと同じ側に中出力の無彩色キーを置く。背面だけ暗くして破綻を隠さない。
    add_area_light("SilverKey", (-height * 1.5, direction * height * 2.1, height * 2.5), 180, (0.78, 0.80, 0.86), height * 1.55, target)
    add_area_light("CoolFill", (height * 1.6, direction * height * 1.2, height * 1.35), 45, (0.40, 0.42, 0.48), height * 1.7, target)
    add_area_light("Rim", (-height * 1.8, -direction * height * 2.2, height * 2.5), 230, (0.45, 0.47, 0.58), height * 1.5, target)
    configure_preview_bloom(scene)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.is_file() or path.stat().st_size < 30_000:
        fail(f"Preview render is missing or unexpectedly small: {path}")
    return path.stat().st_size


def render_face_preview(name: str, mesh: bpy.types.Object, path: Path) -> int:
    """フードと目を判定できる 512px 正方形の頭部クローズアップを描く。"""
    minimum, maximum = mesh_bounds(mesh)
    size = maximum - minimum
    height = float(size[2])
    coords = np.asarray([tuple(vertex.co) for vertex in mesh.data.vertices], dtype=np.float32)
    t = (coords[:, 2] - minimum[2]) / max(height, 1e-6)
    head = coords[(t >= 0.84) & (t <= 0.98)]
    if not len(head):
        fail("Could not resolve head vertices for face preview.")
    # mesh は全身プレビューで床へ移動済みなので、頭部ターゲットだけ同じ world 座標へ補正する。
    head_center = np.median(head, axis=0) + np.asarray(tuple(mesh.location), dtype=np.float32)
    face_z = float(minimum[2] + height * 0.915 + mesh.location.z)
    front_y = float(np.percentile(head[:, 1], 96) + mesh.location.y)
    target = Vector((float(head_center[0]), front_y - height * 0.03, face_z))
    scene = bpy.context.scene
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    # 全身用の3灯と顔用キーを重ねると、黒いフードの金属反射が白飛びして目を消す。
    # 全身レンダーを書き終えた後だけ既存ライトを隠し、顔用の弱い斜光だけにする。
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True

    camera_data = bpy.data.cameras.new("MaterialPreviewFaceCamera")
    camera = bpy.data.objects.new("MaterialPreviewFaceCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    # 肩や胸の発光で判定が逃げないよう、フードと目だけがほぼ画面を満たす画角にする。
    camera.data.ortho_scale = height * 0.43
    camera.location = (float(head_center[0]), front_y + height * 2.0, face_z + height * 0.015)
    look_at(camera, target)
    scene.camera = camera
    add_area_light(
        "FaceKey",
        (float(head_center[0] - height * 0.38), front_y + height * 0.80, face_z + height * 0.16),
        75,
        (0.58, 0.72, 1.0),
        height * 0.62,
        target,
    )
    add_area_light(
        "FaceFill",
        (float(head_center[0] + height * 0.30), front_y + height * 0.62, face_z - height * 0.06),
        22,
        (0.28, 0.48, 0.90),
        height * 0.54,
        target,
    )
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.is_file() or path.stat().st_size < 20_000:
        fail(f"Face preview render is missing or unexpectedly small: {path}")
    return path.stat().st_size


def process_character(name: str) -> None:
    source_path = SOURCE_DIR / f"{name}.glb"
    if not source_path.is_file():
        fail(f"Missing SPAR3D GLB: {source_path}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base_path = OUTPUT_DIR / f"{name}-basecolor.png"
    emissive_path = OUTPUT_DIR / f"{name}-emissive.png"
    normal_path = OUTPUT_DIR / f"{name}-normal.png"
    material_path = OUTPUT_DIR / f"{name}-material.glb"
    preview_path = OUTPUT_DIR / f"preview-{name}-lit.png"
    face_preview_path = OUTPUT_DIR / f"preview-{name}-face.png"
    back_preview_path = OUTPUT_DIR / f"preview-{name}-back-lit.png"

    clear_scene()
    result = bpy.ops.import_scene.gltf(filepath=str(source_path))
    if "FINISHED" not in result:
        fail(f"glTF import failed: {result}")
    mesh = largest_character_mesh()
    # 主メッシュ以外の実キャラクター部品と骨格は保持する。少面数メッシュはSPAR3Dの
    # 撮影ステージとして出力から除外するが、シーンからは消さない。
    preserved_objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj != mesh and (obj.type == "ARMATURE" or (obj.type == "MESH" and len(obj.data.polygons) >= 100))
    ]
    source_material = mesh.active_material
    base_source = image_for_socket(source_material, "Base Color")
    normal_source = image_for_socket(source_material, "Normal")
    texture_size = tuple(base_source.size)
    reference = reference_image(name)
    edge_mask, edge_area, edge_isolated_ratio, edge_threshold = select_edge_highlight_mask(mesh, texture_size)
    (
        basecolor,
        mean_luminance,
        mean_saturation,
        hue_histogram,
        major_hue_bins,
        percentile_range,
        projection_bounds,
    ) = rebuild_basecolor(
        name,
        mesh,
        base_source,
        reference,
        edge_mask,
    )
    normal = copy_normal_as_png(name, normal_source)
    mask, emission_area, isolated_ratio, gaussian_spread = select_emission_mask(name, mesh, texture_size)
    remove_bake_attribute(mesh, "RebuildEmissionMask")
    emissive = emission_image(name, mask)
    save_png(basecolor, base_path)
    save_png(emissive, emissive_path)
    save_png(normal, normal_path)
    final_material = material_with_textures(name, basecolor, emissive, normal)
    eye_emitters = create_eye_emitters(name, mesh)
    chest_core_emitter = create_chest_core_emitter(name, mesh)
    export_extras = [*preserved_objects, *eye_emitters, chest_core_emitter]
    texture_size_after_export = tuple(basecolor.size)
    for export_attempt in range(3):
        export_material_glb(name, mesh, final_material, material_path, export_extras)
        material_bytes = material_path.stat().st_size
        if material_bytes <= MAX_MATERIAL_BYTES:
            break
        if export_attempt == 2:
            fail(
                f"Material GLB exceeds 3.5 MB after texture reduction: bytes={material_bytes}; "
                "manual asset optimization is required."
            )
        texture_size_after_export = reduce_texture_resolution((basecolor, emissive, normal))
        save_png(basecolor, base_path)
        save_png(emissive, emissive_path)
        save_png(normal, normal_path)
    else:
        fail("Material export loop ended unexpectedly.")
    preview_bytes = render_preview(name, mesh, preview_path, ground_mesh=True)
    back_preview_bytes = render_preview(name, mesh, back_preview_path, back=True)
    face_preview_bytes = render_face_preview(name, mesh, face_preview_path)
    if not BASECOLOR_LUMINANCE_MIN <= mean_luminance <= BASECOLOR_LUMINANCE_MAX:
        fail(
            f"Base-color mean luminance is outside "
            f"{BASECOLOR_LUMINANCE_MIN}-{BASECOLOR_LUMINANCE_MAX}: {mean_luminance:.4f}"
        )
    if edge_area > EDGE_AREA_MAX:
        fail(f"Edge highlight area exceeds the {EDGE_AREA_MAX:.0%} cap: {edge_area:.4f}")
    if major_hue_bins < 3:
        fail(
            "Reference projection did not preserve enough distinct hues: "
            f"major_hue_bins={major_hue_bins} histogram={hue_histogram}"
        )
    if not EMISSION_AREA_MIN <= emission_area <= EMISSION_AREA_MAX:
        fail(
            f"Emission area is outside "
            f"{EMISSION_AREA_MIN:.0%}-{EMISSION_AREA_MAX:.0%}: {emission_area:.4f}"
        )
    log(
        name,
        "BASECOLOR_STATS "
        f"mean_luminance={mean_luminance:.4f} mean_saturation={mean_saturation:.4f} "
        f"hue_histogram={hue_histogram} major_hue_bins={major_hue_bins} "
        f"source_p8={percentile_range[0]:.4f} source_p92={percentile_range[1]:.4f}",
    )
    log(
        name,
        "PROJECTION_STATS "
        "front_axis=+Y back_projection=mirrored side_blend=smoothstep "
        f"reference_uv_bounds=({projection_bounds[0]:.4f},{projection_bounds[1]:.4f},"
        f"{projection_bounds[2]:.4f},{projection_bounds[3]:.4f}) "
        f"side_vertex_ratio={projection_bounds[4]:.4f} shadow_multiply_strength={SHADOW_MULTIPLY_STRENGTH:.2f} "
        f"edge_highlight_mix={EDGE_HIGHLIGHT_MIX:.2f}",
    )
    log(
        name,
        "EDGE_STATS "
        f"area_ratio={edge_area:.4f} threshold={edge_threshold:.2f} "
        f"mask_threshold={EDGE_MASK_THRESHOLD:.2f} isolated_ratio={edge_isolated_ratio:.4f}",
    )
    log(
        name,
        "EMISSIVE_STATS "
        "plan=anatomical_region "
        f"area_ratio={emission_area:.4f} threshold={EMISSION_AREA_THRESHOLD:.2f} "
        f"isolated_ratio={isolated_ratio:.4f} gaussian_spread={gaussian_spread:.2f}",
    )
    log(name, f"OUTPUT basecolor={base_path} emissive={emissive_path} normal={normal_path}")
    log(
        name,
        f"OUTPUT material_glb={material_path} material_bytes={material_bytes} "
        f"texture_size={texture_size_after_export} preview={preview_path} preview_bytes={preview_bytes} "
        f"back_preview={back_preview_path} back_preview_bytes={back_preview_bytes} "
        f"face_preview={face_preview_path} face_preview_bytes={face_preview_bytes} "
        f"eye_emitters={len(eye_emitters)} chest_core_emitter=1 preserved_objects={len(preserved_objects)}",
    )


def main() -> None:
    names = parse_names(sys.argv)
    for name in names:
        process_character(name)
    print(f"MATERIAL_REBUILD_OK names={','.join(names)} output_dir={OUTPUT_DIR}")


if __name__ == "__main__":
    main()
