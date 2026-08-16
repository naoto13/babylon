"""Build the production-quality Chrono Duelist v2 hero.

Unlike the reproducible primitive placeholder in build_blender_assets.py,
this file authors purpose-built topology for the body, hood, armour, coat,
and curved time blades. The generated source remains editable in Blender and
exports the animation contract already consumed by Babylon.js.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "assets" / "production" / "models"
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
PREVIEW_DIR = ROOT / "screenshots" / "model-review"
TEXTURE_DIR = ROOT / "assets" / "production" / "textures" / "chrono-duelist-v2"
for directory in (MODEL_DIR, SOURCE_DIR, PREVIEW_DIR, TEXTURE_DIR):
    directory.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SCRIPT_DIR))
from build_blender_assets import (  # noqa: E402
    clear_scene,
    create_hero_actions,
    create_hero_rig,
    export_glb,
)


def pbr_material(
    name: str,
    base: tuple[float, float, float, float],
    *,
    metallic: float,
    roughness: float,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
    coat: float = 0.0,
    texture=None,
    normal_texture=None,
    orm_texture=None,
):
    material = bpy.data.materials.new(name)
    material.diffuse_color = base
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    coat_input = bsdf.inputs.get("Coat Weight") or bsdf.inputs.get("Clearcoat")
    coat_roughness = bsdf.inputs.get("Coat Roughness") or bsdf.inputs.get("Clearcoat Roughness")
    if coat_input:
        coat_input.default_value = coat
    if coat_roughness:
        coat_roughness.default_value = min(0.35, roughness)
    if emission:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = (*emission, 1.0)
        if strength_input:
            strength_input.default_value = emission_strength
    if texture:
        image_node = material.node_tree.nodes.new("ShaderNodeTexImage")
        image_node.name = f"{name}BaseColor"
        image_node.image = texture
        image_node.interpolation = "Linear"
        material.node_tree.links.new(image_node.outputs["Color"], bsdf.inputs["Base Color"])
    if normal_texture or orm_texture:
        attach_surface_detail_nodes(material, normal_texture, orm_texture)
    return material


def create_surface_texture(
    name: str,
    base: tuple[float, float, float],
    *,
    seed: int,
    weave: bool = False,
    scratches: bool = False,
):
    size = 384
    rng = random.Random(seed)
    scratch_columns = {rng.randrange(size) for _ in range(18)} if scratches else set()
    scratch_rows = {rng.randrange(size) for _ in range(12)} if scratches else set()
    pixels = []
    for y in range(size):
        for x in range(size):
            grain = (
                math.sin(x * 0.19 + y * 0.07)
                + math.sin(x * 0.043 - y * 0.11)
                + math.sin((x + y) * 0.017)
            ) / 3
            noise = rng.uniform(-1, 1) * 0.035
            weave_value = 0.0
            if weave:
                weave_value = (math.sin(x * math.pi * 0.48) * math.sin(y * math.pi * 0.42)) * 0.055
            scratch_value = 0.0
            if scratches and (x in scratch_columns or y in scratch_rows):
                scratch_value = 0.08 * (0.25 + rng.random() * 0.75)
            factor = 0.93 + grain * 0.055 + noise + weave_value + scratch_value
            pixels.extend(
                [
                    max(0.0, min(1.0, base[0] * factor)),
                    max(0.0, min(1.0, base[1] * factor)),
                    max(0.0, min(1.0, base[2] * factor)),
                    1.0,
                ]
            )
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(TEXTURE_DIR / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    return image


# 主役 hero の金属面は、圧縮しても 5MB 以下に収まる共有 2048px atlas にする。
# 現行の smart-project UV は各装甲マテリアルが 0..1 を広く使うため、継ぎ目で
# 破綻しないタイル可能な板金パターンを全装甲材で共有する。
SURFACE_TEXTURE_SIZE = 2048


def _smoothstep(edge0: float, edge1: float, values: np.ndarray) -> np.ndarray:
    ratio = np.clip((values - edge0) / (edge1 - edge0), 0.0, 1.0)
    return ratio * ratio * (3.0 - 2.0 * ratio)


def _save_data_texture(name: str, rgb: np.ndarray) -> bpy.types.Image:
    """Save an 8-bit Non-Color map without silently reusing an older image."""

    existing = bpy.data.images.get(name)
    if existing:
        bpy.data.images.remove(existing)
    height, width, _ = rgb.shape
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    rgba = np.empty((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0.0, 1.0)
    rgba[:, :, 3] = 1.0
    image.pixels.foreach_set(np.ascontiguousarray(rgba).ravel())
    image.filepath_raw = str(TEXTURE_DIR / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    return image


def _add_panel(
    height: np.ndarray,
    bevel_mask: np.ndarray,
    groove_mask: np.ndarray,
    *,
    bounds: tuple[float, float, float, float],
    lift: float = 0.055,
    bevel_width: float = 0.007,
    groove_width: float = 0.0038,
) -> None:
    """Add a raised plate, its chamfer, and a recessed seam to the height field."""

    image_height, image_width = height.shape
    left, bottom, right, top = bounds
    margin = max(bevel_width, groove_width) * 5.0
    x0 = max(0, int((left - margin) * image_width))
    x1 = min(image_width, int((right + margin) * image_width) + 1)
    y0 = max(0, int((bottom - margin) * image_height))
    y1 = min(image_height, int((top + margin) * image_height) + 1)
    x = (np.arange(x0, x1, dtype=np.float32) + 0.5) / image_width
    y = (np.arange(y0, y1, dtype=np.float32) + 0.5) / image_height
    u, v = np.meshgrid(x, y)
    signed_distance = np.minimum.reduce((u - left, right - u, v - bottom, top - v))
    chamfer = _smoothstep(0.0, bevel_width, signed_distance)
    seam = np.exp(-np.square(signed_distance / groove_width))
    height[y0:y1, x0:x1] += lift * chamfer - lift * 0.92 * seam
    bevel_mask[y0:y1, x0:x1] = np.maximum(
        bevel_mask[y0:y1, x0:x1], 1.0 - np.abs(chamfer * 2.0 - 1.0)
    )
    groove_mask[y0:y1, x0:x1] = np.maximum(groove_mask[y0:y1, x0:x1], seam)


def _add_rivet(
    height: np.ndarray,
    wear_mask: np.ndarray,
    *,
    center: tuple[float, float],
    radius: float = 0.008,
) -> None:
    """Add a sparse hemispherical rivet with a slightly worn perimeter."""

    image_height, image_width = height.shape
    cx, cy = center
    x0 = max(0, int((cx - radius * 1.4) * image_width))
    x1 = min(image_width, int((cx + radius * 1.4) * image_width) + 1)
    y0 = max(0, int((cy - radius * 1.4) * image_height))
    y1 = min(image_height, int((cy + radius * 1.4) * image_height) + 1)
    x = (np.arange(x0, x1, dtype=np.float32) + 0.5) / image_width
    y = (np.arange(y0, y1, dtype=np.float32) + 0.5) / image_height
    u, v = np.meshgrid(x, y)
    distance = np.sqrt(np.square(u - cx) + np.square(v - cy)) / radius
    dome = np.clip(1.0 - np.square(distance), 0.0, 1.0)
    ring = np.exp(-np.square((distance - 1.0) / 0.18))
    height[y0:y1, x0:x1] += dome * 0.048 - ring * 0.018
    wear_mask[y0:y1, x0:x1] = np.maximum(wear_mask[y0:y1, x0:x1], ring * 0.55)


def _add_groove_segment(
    height: np.ndarray,
    groove_mask: np.ndarray,
    *,
    start: tuple[float, float],
    end: tuple[float, float],
    width: float = 0.0024,
) -> None:
    """Carve a shallow circuit stroke; it is deliberate geometry, never noise."""

    image_height, image_width = height.shape
    ax, ay = start
    bx, by = end
    margin = width * 5.0
    x0 = max(0, int((min(ax, bx) - margin) * image_width))
    x1 = min(image_width, int((max(ax, bx) + margin) * image_width) + 1)
    y0 = max(0, int((min(ay, by) - margin) * image_height))
    y1 = min(image_height, int((max(ay, by) + margin) * image_height) + 1)
    x = (np.arange(x0, x1, dtype=np.float32) + 0.5) / image_width
    y = (np.arange(y0, y1, dtype=np.float32) + 0.5) / image_height
    u, v = np.meshgrid(x, y)
    segment_x = bx - ax
    segment_y = by - ay
    length_squared = segment_x * segment_x + segment_y * segment_y
    projection = np.clip(((u - ax) * segment_x + (v - ay) * segment_y) / length_squared, 0.0, 1.0)
    distance = np.sqrt(np.square(u - (ax + projection * segment_x)) + np.square(v - (ay + projection * segment_y)))
    stroke = np.exp(-np.square(distance / width))
    height[y0:y1, x0:x1] -= stroke * 0.022
    groove_mask[y0:y1, x0:x1] = np.maximum(groove_mask[y0:y1, x0:x1], stroke * 0.78)


def create_armour_surface_textures() -> tuple[bpy.types.Image, bpy.types.Image]:
    """Generate the shared 2048² tangent normal and ORM maps for plated metal."""

    size = SURFACE_TEXTURE_SIZE
    height = np.zeros((size, size), dtype=np.float32)
    bevel_mask = np.zeros_like(height)
    groove_mask = np.zeros_like(height)
    wear_mask = np.zeros_like(height)
    # UV 全体に密度を揃えた非対称パネル。縁の溝と面取りを別量で保持する。
    panels = (
        (0.025, 0.035, 0.245, 0.235), (0.275, 0.030, 0.545, 0.190),
        (0.575, 0.040, 0.935, 0.260), (0.055, 0.285, 0.310, 0.505),
        (0.350, 0.245, 0.650, 0.475), (0.695, 0.315, 0.960, 0.560),
        (0.030, 0.575, 0.230, 0.830), (0.275, 0.540, 0.555, 0.760),
        (0.600, 0.600, 0.910, 0.825), (0.080, 0.860, 0.370, 0.970),
        (0.420, 0.805, 0.700, 0.955), (0.750, 0.875, 0.970, 0.975),
    )
    for bounds in panels:
        _add_panel(height, bevel_mask, groove_mask, bounds=bounds)

    for center in (
        (0.060, 0.070), (0.220, 0.070), (0.295, 0.055), (0.510, 0.165),
        (0.595, 0.070), (0.915, 0.235), (0.075, 0.485), (0.295, 0.320),
        (0.370, 0.445), (0.625, 0.270), (0.720, 0.535), (0.940, 0.340),
        (0.055, 0.805), (0.210, 0.600), (0.300, 0.740), (0.535, 0.560),
        (0.620, 0.810), (0.895, 0.625), (0.095, 0.885), (0.680, 0.930),
    ):
        _add_rivet(height, wear_mask, center=center)

    # 発光回路に合わせやすい浅い彫刻。面を砂嵐にせず意匠だけを残す。
    circuits = (
        ((0.085, 0.155), (0.185, 0.155)), ((0.185, 0.155), (0.215, 0.190)),
        ((0.410, 0.305), (0.540, 0.305)), ((0.540, 0.305), (0.575, 0.355)),
        ((0.745, 0.420), (0.865, 0.420)), ((0.865, 0.420), (0.895, 0.470)),
        ((0.115, 0.675), (0.190, 0.725)), ((0.370, 0.635), (0.485, 0.635)),
        ((0.485, 0.635), (0.515, 0.685)), ((0.665, 0.700), (0.820, 0.700)),
        ((0.465, 0.880), (0.605, 0.880)), ((0.605, 0.880), (0.640, 0.915)),
    )
    for start, end in circuits:
        _add_groove_segment(height, groove_mask, start=start, end=end)

    # 摩耗は面全体のノイズではなく、凸縁と短い擦過傷だけに限定する。
    for start, end in (
        ((0.095, 0.050), (0.155, 0.061)), ((0.385, 0.255), (0.455, 0.273)),
        ((0.710, 0.330), (0.775, 0.344)), ((0.115, 0.780), (0.170, 0.793)),
        ((0.780, 0.805), (0.855, 0.818)), ((0.470, 0.945), (0.535, 0.933)),
    ):
        _add_groove_segment(height, wear_mask, start=start, end=end, width=0.00125)
    wear_mask = np.maximum(wear_mask, bevel_mask * 0.68)

    gradient_y, gradient_x = np.gradient(height)
    normal = np.stack((-gradient_x * 38.0, -gradient_y * 38.0, np.ones_like(height)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal_rgb = normal * 0.5 + 0.5

    # glTF ORM: R=AO, G=roughness, B=metallic。隙間を暗く、縁ほど粗くする。
    occlusion = 0.985 - groove_mask * 0.50 - bevel_mask * 0.10
    roughness = 0.25 + bevel_mask * 0.30 + groove_mask * 0.39 + wear_mask * 0.20
    metallic = 0.915 - groove_mask * 0.025 - wear_mask * 0.070
    orm_rgb = np.stack((occlusion, roughness, metallic), axis=-1)
    return (
        _save_data_texture("chrono-duelist-armour-normal-2048", normal_rgb),
        _save_data_texture("chrono-duelist-armour-orm-2048", orm_rgb),
    )


def create_cloth_surface_textures() -> tuple[bpy.types.Image, bpy.types.Image]:
    """Keep cloth tactile with a weak weave; it must not inherit hard armour seams."""

    size = 1024
    coordinates = (np.arange(size, dtype=np.float32) + 0.5) / size
    u, v = np.meshgrid(coordinates, coordinates)
    weave = np.sin(u * math.tau * 76.0) * np.sin(v * math.tau * 62.0) * 0.009
    gradient_y, gradient_x = np.gradient(weave)
    normal = np.stack((-gradient_x * 8.0, -gradient_y * 8.0, np.ones_like(weave)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal_rgb = normal * 0.5 + 0.5
    cloth_orm = np.stack(
        (np.full_like(weave, 0.97), np.full_like(weave, 0.85), np.full_like(weave, 0.03)),
        axis=-1,
    )
    return (
        _save_data_texture("chrono-duelist-cloth-normal-1024", normal_rgb),
        _save_data_texture("chrono-duelist-cloth-orm-1024", cloth_orm),
    )


def create_hero_detail_textures() -> dict[str, tuple[bpy.types.Image, bpy.types.Image]]:
    return {
        "armour": create_armour_surface_textures(),
        "cloth": create_cloth_surface_textures(),
    }


def attach_surface_detail_nodes(material, normal_texture, orm_texture) -> None:
    """Connect tangent normals and a shared glTF ORM image to a Principled material."""

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        raise RuntimeError(f"{material.name} has no Principled BSDF")
    for node_name in (
        f"{material.name}Normal", f"{material.name}NormalMap", f"{material.name}ORM",
        f"{material.name}ORMChannels", f"{material.name}glTFOutput",
    ):
        if node := nodes.get(node_name):
            nodes.remove(node)
    if normal_texture:
        normal_texture.colorspace_settings.name = "Non-Color"
        normal_node = nodes.new("ShaderNodeTexImage")
        normal_node.name = f"{material.name}Normal"
        normal_node.image = normal_texture
        normal_node.interpolation = "Linear"
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.name = f"{material.name}NormalMap"
        normal_map.space = "TANGENT"
        normal_map.inputs["Strength"].default_value = 1.25 if material.name.endswith("V2") else 1.0
        links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    if orm_texture:
        orm_texture.colorspace_settings.name = "Non-Color"
        orm_node = nodes.new("ShaderNodeTexImage")
        orm_node.name = f"{material.name}ORM"
        orm_node.image = orm_texture
        orm_node.interpolation = "Linear"
        # Blender 5.x は旧 SeparateRGB を SeparateColor(RGB mode) に統合した。
        channels = nodes.new("ShaderNodeSeparateColor")
        channels.name = f"{material.name}ORMChannels"
        channels.mode = "RGB"
        links.new(orm_node.outputs["Color"], channels.inputs["Color"])
        links.new(channels.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(channels.outputs["Blue"], bsdf.inputs["Metallic"])
        # Blender glTF exporter はこの名前の node group の Occlusion 入力を正本として出力する。
        group = bpy.data.node_groups.get("glTF Material Output")
        if group is None:
            from io_scene_gltf2.blender.com.material_helpers import create_settings_group

            group = create_settings_group("glTF Material Output")
        gltf_output = nodes.new("ShaderNodeGroup")
        gltf_output.name = f"{material.name}glTFOutput"
        gltf_output.node_tree = group
        links.new(channels.outputs["Red"], gltf_output.inputs["Occlusion"])


HERO_MATERIAL_SPECS = {
    "VoidClothV2": {
        # 黒に見せるのは照明側に任せ、布地にも織り目が残る下限の albedo を持たせる。
        "base": (0.042, 0.063, 0.133, 1),
        "metallic": 0.02,
        "roughness": 0.86,
        "texture": ("void-cloth-basecolor", (0.084, 0.119, 0.228), 142, {"weave": True}),
        "detail": "cloth",
    },
    "MidnightFabricV2": {
        "base": (0.063, 0.133, 0.301, 1),
        "metallic": 0.04,
        "roughness": 0.88,
        "texture": ("midnight-fabric-basecolor", (0.112, 0.231, 0.455), 287, {"weave": True}),
        "detail": "cloth",
    },
    "MidnightArmourV2": {
        # 3.5 倍の中間調ガンメタル。黒を塗るのではなく IBL とリムで黒く見せる。
        "base": (0.182, 0.273, 0.413, 1),
        "metallic": 0.80,
        "roughness": 0.30,
        "coat": 0.30,
        "texture": ("midnight-armour-basecolor", (0.182, 0.273, 0.413), 911, {"scratches": True}),
        "detail": "armour",
    },
    "DarkSteelV2": {
        # テクスチャなしの第二装甲も主装甲と同じ可読域へ（旧値の約 3.5 倍）。
        "base": (0.161, 0.224, 0.301, 1),
        "metallic": 0.85,
        "roughness": 0.42,
        "coat": 0.15,
        "detail": "armour",
    },
    "AntiqueClockGoldV2": {
        # The illustrative dark-silver RGB would only reach 0.376 luminance.
        # This is still the subdued trim, but clears the >= 0.45 readability
        # floor required by the deliberately dark arena lighting.
        "base": (0.40, 0.46, 0.55, 1),
        "metallic": 0.9,
        "roughness": 0.20,
        "coat": 0.25,
        # The material identifier is stable for downstream assignment; the
        # texture itself is now dark silver, not gold.
        "texture": ("dark-silver-trim-basecolor", (0.43, 0.49, 0.59), 733, {"scratches": True}),
        "detail": "armour",
    },
    "PolishedClockGoldV2": {
        "base": (0.74, 0.80, 0.90, 1),
        "metallic": 0.94,
        "roughness": 0.14,
        "coat": 0.35,
        "detail": "armour",
    },
    "TimeCrystalV2": {
        "base": (0.018, 0.24, 0.36, 1),
        "metallic": 0.12,
        "roughness": 0.12,
        # #22d3ee cyan, at the established restrained crystal strength.
        "emission": (0.018, 0.50, 0.68),
        "emission_strength": 0.72,
        "coat": 0.38,
    },
    "TimeEyeV2": {
        "base": (0.025, 0.38, 0.52, 1),
        "metallic": 0.0,
        "roughness": 0.08,
        "emission": (0.025, 0.68, 0.88),
        "emission_strength": 1.55,
        "coat": 0.6,
    },
}


def create_demonic_hero_materials() -> dict[str, bpy.types.Material]:
    """Create the eight role-preserving materials for a clean Blender scene."""

    textures = {
        name: create_surface_texture(texture_name, color, seed=seed, **options)
        for name, spec in HERO_MATERIAL_SPECS.items()
        if (texture_spec := spec.get("texture")) is not None
        for texture_name, color, seed, options in (texture_spec,)
    }
    detail_textures = create_hero_detail_textures()
    return {
        name: pbr_material(
            name,
            spec["base"],
            metallic=spec["metallic"],
            roughness=spec["roughness"],
            emission=spec.get("emission"),
            emission_strength=spec.get("emission_strength", 0.0),
            coat=spec.get("coat", 0.0),
            texture=textures.get(name),
            normal_texture=detail_textures.get(spec.get("detail"), (None, None))[0],
            orm_texture=detail_textures.get(spec.get("detail"), (None, None))[1],
        )
        for name, spec in HERO_MATERIAL_SPECS.items()
    }


def refresh_demonic_hero_materials_in_place() -> None:
    """Recolour the checked-in MPFB source without altering its rig or meshes."""

    missing = sorted(name for name in HERO_MATERIAL_SPECS if bpy.data.materials.get(name) is None)
    if missing:
        raise RuntimeError(f"hero source is missing required materials: {', '.join(missing)}")

    textures = {
        name: create_surface_texture(texture_name, color, seed=seed, **options)
        for name, spec in HERO_MATERIAL_SPECS.items()
        if (texture_spec := spec.get("texture")) is not None
        for texture_name, color, seed, options in (texture_spec,)
    }
    detail_textures = create_hero_detail_textures()
    for name, spec in HERO_MATERIAL_SPECS.items():
        material = bpy.data.materials[name]
        material.diffuse_color = spec["base"]
        material.use_nodes = True
        nodes = material.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        if bsdf is None:
            raise RuntimeError(f"{name} has no Principled BSDF")
        bsdf.inputs["Base Color"].default_value = spec["base"]
        bsdf.inputs["Metallic"].default_value = spec["metallic"]
        bsdf.inputs["Roughness"].default_value = spec["roughness"]
        coat_input = bsdf.inputs.get("Coat Weight") or bsdf.inputs.get("Clearcoat")
        if coat_input:
            coat_input.default_value = spec.get("coat", 0.0)
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if spec.get("emission"):
            if emission_input:
                emission_input.default_value = (*spec["emission"], 1.0)
            if strength_input:
                strength_input.default_value = spec["emission_strength"]
        elif strength_input:
            strength_input.default_value = 0.0

        texture = textures.get(name)
        if texture:
            base_color_node = nodes.get(f"{name}BaseColor")
            if base_color_node is None or base_color_node.type != "TEX_IMAGE":
                raise RuntimeError(f"{name} is missing its named base-colour image node")
            base_color_node.image = texture
        if detail := detail_textures.get(spec.get("detail")):
            attach_surface_detail_nodes(material, *detail)


def activate(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def make_mesh(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    material,
    *,
    smooth: bool = True,
    bevel: float = 0.0,
    bevel_segments: int = 3,
):
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if material:
        obj.data.materials.append(material)
    if smooth:
        for polygon in mesh.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("MicroBevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = bevel_segments
        modifier.limit_method = "ANGLE"
    return obj


def add_armature_modifier(obj, armature) -> None:
    world_transform = obj.matrix_world.copy()
    obj.parent = armature
    obj.matrix_world = world_transform
    modifier = obj.modifiers.new("ChronoDuelistDeform", "ARMATURE")
    modifier.object = armature


def assign_weights(obj, armature, vertex_weights: list[dict[str, float]]) -> None:
    groups = {}
    for weights in vertex_weights:
        for bone_name in weights:
            groups.setdefault(bone_name, obj.vertex_groups.new(name=bone_name))
    for vertex_index, weights in enumerate(vertex_weights):
        total = sum(weights.values()) or 1.0
        for bone_name, value in weights.items():
            groups[bone_name].add([vertex_index], value / total, "REPLACE")
    add_armature_modifier(obj, armature)


def rigid_bind(obj, armature, bone_name: str) -> None:
    weights = [{bone_name: 1.0} for _ in obj.data.vertices]
    assign_weights(obj, armature, weights)


def loft_mesh(
    name: str,
    rings: list[tuple[tuple[float, float, float], float, float]],
    material,
    *,
    sides: int = 24,
    ring_weights: list[dict[str, float]] | None = None,
    armature=None,
    cap: bool = True,
    bevel: float = 0.0,
):
    vertices = []
    weights = []
    for ring_index, (center, radius_x, radius_y) in enumerate(rings):
        for side in range(sides):
            angle = side / sides * math.tau
            vertices.append(
                (
                    center[0] + math.cos(angle) * radius_x,
                    center[1] + math.sin(angle) * radius_y,
                    center[2],
                )
            )
            if ring_weights:
                weights.append(ring_weights[ring_index])
    faces = []
    for ring_index in range(len(rings) - 1):
        current = ring_index * sides
        following = (ring_index + 1) * sides
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((current + side, current + nxt, following + nxt, following + side))
    if cap:
        faces.append(tuple(reversed(range(sides))))
        last = (len(rings) - 1) * sides
        faces.append(tuple(last + index for index in range(sides)))
    obj = make_mesh(name, vertices, faces, material, smooth=True, bevel=bevel)
    if armature and ring_weights:
        assign_weights(obj, armature, weights)
    return obj


def tube_mesh(
    name: str,
    points: list[tuple[float, float, float]],
    radii: list[tuple[float, float]],
    material,
    *,
    sides: int = 18,
    ring_weights: list[dict[str, float]] | None = None,
    armature=None,
    bevel: float = 0.0,
):
    vertices = []
    weights = []
    for index, point_tuple in enumerate(points):
        point = Vector(point_tuple)
        if index == 0:
            direction = Vector(points[1]) - point
        elif index == len(points) - 1:
            direction = point - Vector(points[index - 1])
        else:
            direction = Vector(points[index + 1]) - Vector(points[index - 1])
        direction.normalize()
        depth_axis = Vector((0, 1, 0))
        if abs(direction.dot(depth_axis)) > 0.94:
            depth_axis = Vector((1, 0, 0))
        width_axis = direction.cross(depth_axis).normalized()
        depth_axis = width_axis.cross(direction).normalized()
        for side in range(sides):
            angle = side / sides * math.tau
            offset = (
                width_axis * math.cos(angle) * radii[index][0]
                + depth_axis * math.sin(angle) * radii[index][1]
            )
            vertices.append(tuple(point + offset))
            if ring_weights:
                weights.append(ring_weights[index])
    faces = []
    for ring_index in range(len(points) - 1):
        current = ring_index * sides
        following = (ring_index + 1) * sides
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((current + side, current + nxt, following + nxt, following + side))
    faces.append(tuple(reversed(range(sides))))
    last = (len(points) - 1) * sides
    faces.append(tuple(last + index for index in range(sides)))
    obj = make_mesh(name, vertices, faces, material, smooth=True, bevel=bevel)
    if armature and ring_weights:
        assign_weights(obj, armature, weights)
    return obj


def extruded_panel(
    name: str,
    points_xz: list[tuple[float, float]],
    y: float,
    depth: float,
    material,
    *,
    bevel: float = 0.0,
    smooth: bool = False,
):
    front_y = y - depth * 0.5
    back_y = y + depth * 0.5
    vertices = [(x, front_y, z) for x, z in points_xz] + [(x, back_y, z) for x, z in points_xz]
    count = len(points_xz)
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    return make_mesh(name, vertices, faces, material, smooth=smooth, bevel=bevel)


def curve_tube(
    name: str,
    points: list[tuple[float, float, float]],
    material,
    *,
    radius: float,
    resolution: int = 2,
):
    curve_data = bpy.data.curves.new(f"{name}Curve", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = radius * 0.62
    curve_data.bevel_resolution = 3
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bezier_point, coordinate in zip(spline.bezier_points, points):
        bezier_point.co = coordinate
        bezier_point.handle_left_type = "AUTO"
        bezier_point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_torus(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    material,
    *,
    rotation=(0, 0, 0),
):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius * 0.68,
        major_segments=48,
        minor_segments=10,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def create_time_blade(name: str, sign: int, cyan, steel, gold, armature, hand_bone: str):
    samples = 18
    centers = []
    widths = []
    for index in range(samples):
        t = index / (samples - 1)
        x = sign * (0.79 + 0.43 * t + 0.2 * math.sin(math.pi * t))
        y = -0.12 - 0.18 * t
        z = 1.05 - 0.72 * t - 0.1 * math.sin(math.pi * t)
        centers.append(Vector((x, y, z)))
        widths.append(0.024 + 0.058 * math.sin(math.pi * t) ** 0.8)

    front_vertices = []
    back_vertices = []
    for index, center in enumerate(centers):
        if index == 0:
            tangent = centers[1] - center
        elif index == samples - 1:
            tangent = center - centers[index - 1]
        else:
            tangent = centers[index + 1] - centers[index - 1]
        tangent_2d = Vector((tangent.x, 0, tangent.z)).normalized()
        normal = Vector((-tangent_2d.z, 0, tangent_2d.x))
        outer = center + normal * widths[index] * sign
        inner = center - normal * widths[index] * sign
        front_vertices.extend([tuple(outer + Vector((0, -0.022, 0))), tuple(inner + Vector((0, -0.022, 0)))])
        back_vertices.extend([tuple(outer + Vector((0, 0.022, 0))), tuple(inner + Vector((0, 0.022, 0)))])
    vertices = front_vertices + back_vertices
    faces = []
    for index in range(samples - 1):
        a = index * 2
        b = a + 2
        faces.append((a, b, b + 1, a + 1))
        back = samples * 2
        faces.append((back + a + 1, back + b + 1, back + b, back + a))
    perimeter = list(range(0, samples * 2, 2))
    perimeter += list(reversed(range(1, samples * 2, 2)))
    back_offset = samples * 2
    for index, vertex_index in enumerate(perimeter):
        nxt = perimeter[(index + 1) % len(perimeter)]
        faces.append((vertex_index, nxt, back_offset + nxt, back_offset + vertex_index))
    blade = make_mesh(f"{name}Blade", vertices, faces, cyan, smooth=True, bevel=0.012)
    rigid_bind(blade, armature, hand_bone)

    spine_points = [tuple(center + Vector((0, 0.025, 0))) for center in centers]
    spine = curve_tube(f"{name}Spine", spine_points, steel, radius=0.014)
    rigid_bind(spine, armature, hand_bone)
    hilt = tube_mesh(
        f"{name}Hilt",
        [(0.67 * sign, -0.02, 1.08), (0.9 * sign, -0.02, 1.08)],
        [(0.035, 0.035), (0.035, 0.035)],
        gold,
        sides=14,
    )
    rigid_bind(hilt, armature, hand_bone)
    guard = add_torus(
        f"{name}ClockGuard",
        (0.78 * sign, -0.025, 1.08),
        0.085,
        0.018,
        gold,
        rotation=(math.pi / 2, 0, 0),
    )
    rigid_bind(guard, armature, hand_bone)


def create_custom_geometry(armature):
    materials = create_demonic_hero_materials()
    cloth = materials["VoidClothV2"]
    cloth_blue = materials["MidnightFabricV2"]
    armour = materials["MidnightArmourV2"]
    armour_dark = materials["DarkSteelV2"]
    gold = materials["AntiqueClockGoldV2"]
    gold_highlight = materials["PolishedClockGoldV2"]
    cyan = materials["TimeCrystalV2"]
    eye = materials["TimeEyeV2"]

    torso = loft_mesh(
        "DuelistBody",
        [
            ((0, 0.02, 0.76), 0.22, 0.16),
            ((0, 0.01, 0.95), 0.29, 0.2),
            ((0, 0.0, 1.18), 0.27, 0.18),
            ((0, 0.0, 1.42), 0.32, 0.185),
            ((0, 0.0, 1.62), 0.39, 0.205),
            ((0, 0.0, 1.72), 0.31, 0.18),
        ],
        cloth,
        sides=28,
        ring_weights=[
            {"Hips": 1},
            {"Hips": 0.65, "Spine": 0.35},
            {"Spine": 1},
            {"Spine": 0.45, "Chest": 0.55},
            {"Chest": 1},
            {"Chest": 1},
        ],
        armature=armature,
        bevel=0.008,
    )

    neck = loft_mesh(
        "DuelistNeck",
        [
            ((0, 0, 1.62), 0.16, 0.14),
            ((0, 0, 1.78), 0.14, 0.13),
            ((0, 0, 1.9), 0.16, 0.15),
        ],
        cloth,
        sides=22,
        ring_weights=[{"Chest": 1}, {"Chest": 0.45, "Head": 0.55}, {"Head": 1}],
        armature=armature,
    )

    for side, sign in (("L", 1), ("R", -1)):
        arm_points = [
            (0.34 * sign, 0, 1.6),
            (0.51 * sign, -0.01, 1.48),
            (0.62 * sign, -0.025, 1.31),
            (0.74 * sign, -0.035, 1.13),
            (0.79 * sign, -0.04, 1.03),
        ]
        tube_mesh(
            f"BodyArm.{side}",
            arm_points,
            [(0.115, 0.1), (0.11, 0.095), (0.092, 0.082), (0.078, 0.068), (0.075, 0.064)],
            cloth,
            sides=20,
            ring_weights=[
                {f"UpperArm.{side}": 1},
                {f"UpperArm.{side}": 0.72, f"LowerArm.{side}": 0.28},
                {f"UpperArm.{side}": 0.18, f"LowerArm.{side}": 0.82},
                {f"LowerArm.{side}": 0.55, f"Hand.{side}": 0.45},
                {f"Hand.{side}": 1},
            ],
            armature=armature,
        )
        leg_points = [
            (0.16 * sign, 0.015, 0.83),
            (0.18 * sign, 0, 0.62),
            (0.19 * sign, -0.01, 0.43),
            (0.19 * sign, -0.03, 0.22),
            (0.19 * sign, -0.12, 0.08),
        ]
        tube_mesh(
            f"BodyLeg.{side}",
            leg_points,
            [(0.135, 0.12), (0.125, 0.112), (0.105, 0.095), (0.092, 0.085), (0.09, 0.125)],
            cloth,
            sides=20,
            ring_weights=[
                {f"UpperLeg.{side}": 1},
                {f"UpperLeg.{side}": 1},
                {f"UpperLeg.{side}": 0.28, f"LowerLeg.{side}": 0.72},
                {f"LowerLeg.{side}": 0.62, f"Foot.{side}": 0.38},
                {f"Foot.{side}": 1},
            ],
            armature=armature,
        )

        upper_arm_plate = tube_mesh(
            f"UpperArmPlate.{side}",
            [(0.35 * sign, -0.015, 1.59), (0.48 * sign, -0.015, 1.48), (0.56 * sign, -0.02, 1.38)],
            [(0.13, 0.115), (0.126, 0.11), (0.108, 0.095)],
            armour,
            sides=18,
            bevel=0.008,
        )
        rigid_bind(upper_arm_plate, armature, f"UpperArm.{side}")
        bracer = tube_mesh(
            f"ClockBracer.{side}",
            [(0.57 * sign, -0.025, 1.38), (0.68 * sign, -0.035, 1.22), (0.76 * sign, -0.04, 1.09)],
            [(0.108, 0.095), (0.108, 0.092), (0.092, 0.078)],
            armour,
            sides=20,
            bevel=0.01,
        )
        rigid_bind(bracer, armature, f"LowerArm.{side}")
        bracer_ring = add_torus(
            f"BracerClock.{side}",
            (0.67 * sign, -0.13, 1.23),
            0.095,
            0.018,
            gold,
            rotation=(math.radians(76), 0, math.radians(35) * sign),
        )
        rigid_bind(bracer_ring, armature, f"LowerArm.{side}")
        glove = tube_mesh(
            f"ArmouredGlove.{side}",
            [(0.735 * sign, -0.035, 1.13), (0.805 * sign, -0.045, 1.045), (0.845 * sign, -0.055, 1.0)],
            [(0.088, 0.075), (0.082, 0.072), (0.068, 0.06)],
            armour_dark,
            sides=18,
            bevel=0.006,
        )
        rigid_bind(glove, armature, f"Hand.{side}")
        knuckle = extruded_panel(
            f"ClockKnuckle.{side}",
            [
                (0.77 * sign, 1.09),
                (0.83 * sign, 1.08),
                (0.855 * sign, 1.015),
                (0.8 * sign, 1.0),
            ],
            -0.115,
            0.035,
            gold,
            bevel=0.007,
        )
        rigid_bind(knuckle, armature, f"Hand.{side}")

        greave = tube_mesh(
            f"ClockGreave.{side}",
            [(0.18 * sign, -0.02, 0.46), (0.19 * sign, -0.04, 0.28), (0.19 * sign, -0.08, 0.12)],
            [(0.126, 0.112), (0.118, 0.102), (0.108, 0.12)],
            armour,
            sides=20,
            bevel=0.012,
        )
        rigid_bind(greave, armature, f"LowerLeg.{side}")
        knee = extruded_panel(
            f"KneeGuard.{side}",
            [
                (0.08 * sign, 0.49),
                (0.18 * sign, 0.57),
                (0.29 * sign, 0.49),
                (0.27 * sign, 0.34),
                (0.19 * sign, 0.29),
                (0.1 * sign, 0.35),
            ],
            -0.145,
            0.08,
            armour,
            bevel=0.018,
        )
        rigid_bind(knee, armature, f"LowerLeg.{side}")
        boot = tube_mesh(
            f"ArmouredBoot.{side}",
            [(0.19 * sign, -0.03, 0.16), (0.19 * sign, -0.15, 0.08), (0.19 * sign, -0.31, 0.07)],
            [(0.108, 0.105), (0.112, 0.135), (0.12, 0.17)],
            armour_dark,
            sides=20,
            bevel=0.012,
        )
        rigid_bind(boot, armature, f"Foot.{side}")
        toe_plate = extruded_panel(
            f"BootToePlate.{side}",
            [
                (0.1 * sign, 0.13),
                (0.19 * sign, 0.18),
                (0.29 * sign, 0.13),
                (0.28 * sign, 0.03),
                (0.11 * sign, 0.03),
            ],
            -0.3,
            0.055,
            armour,
            bevel=0.012,
        )
        rigid_bind(toe_plate, armature, f"Foot.{side}")

        shoulder_points = [
            (0.22 * sign, 1.66),
            (0.34 * sign, 1.72),
            (0.49 * sign, 1.62),
            (0.44 * sign, 1.51),
            (0.29 * sign, 1.52),
        ]
        shoulder = extruded_panel(
            f"LayeredPauldron.{side}",
            shoulder_points,
            -0.035,
            0.22,
            armour,
            bevel=0.024,
        )
        rigid_bind(shoulder, armature, f"UpperArm.{side}")
        shoulder_trim = curve_tube(
            f"PauldronTrim.{side}",
            [(x, -0.16, z) for x, z in shoulder_points + [shoulder_points[0]]],
            gold,
            radius=0.014,
        )
        rigid_bind(shoulder_trim, armature, f"UpperArm.{side}")
        lower_shoulder_points = [
            (0.26 * sign, 1.57),
            (0.37 * sign, 1.62),
            (0.48 * sign, 1.55),
            (0.43 * sign, 1.48),
            (0.3 * sign, 1.49),
        ]
        lower_shoulder = extruded_panel(
            f"LowerPauldronLayer.{side}",
            lower_shoulder_points,
            -0.145,
            0.055,
            armour_dark,
            bevel=0.012,
        )
        rigid_bind(lower_shoulder, armature, f"UpperArm.{side}")

        bracer_trim = curve_tube(
            f"BracerTrim.{side}",
            [
                (0.59 * sign, -0.12, 1.36),
                (0.68 * sign, -0.13, 1.22),
                (0.75 * sign, -0.115, 1.11),
            ],
            gold,
            radius=0.009,
        )
        rigid_bind(bracer_trim, armature, f"LowerArm.{side}")
        greave_trim = curve_tube(
            f"GreaveTrim.{side}",
            [
                (0.13 * sign, -0.14, 0.43),
                (0.19 * sign, -0.16, 0.3),
                (0.23 * sign, -0.155, 0.16),
            ],
            gold,
            radius=0.009,
        )
        rigid_bind(greave_trim, armature, f"LowerLeg.{side}")

        create_time_blade(f"TimeBlade.{side}", sign, cyan, armour_dark, gold_highlight, armature, f"Hand.{side}")

    chest_plate_points = [(-0.255, 1.61), (0, 1.69), (0.255, 1.61), (0.22, 1.31), (0, 1.22), (-0.22, 1.31)]
    chest_plate = extruded_panel(
        "LayeredChestPlate",
        chest_plate_points,
        -0.2,
        0.09,
        armour,
        bevel=0.022,
    )
    rigid_bind(chest_plate, armature, "Chest")
    for side, sign in (("L", 1), ("R", -1)):
        rib_points = [
            (0.03 * sign, 1.58),
            (0.23 * sign, 1.53),
            (0.21 * sign, 1.39),
            (0.04 * sign, 1.32),
        ]
        rib_plate = extruded_panel(
            f"RibArmour.{side}",
            rib_points,
            -0.255,
            0.035,
            armour_dark,
            bevel=0.01,
        )
        rigid_bind(rib_plate, armature, "Chest")
        rib_trim = curve_tube(
            f"RibTrim.{side}",
            [(x, -0.278, z) for x, z in rib_points],
            gold,
            radius=0.007,
        )
        rigid_bind(rib_trim, armature, "Chest")

        collar_points = [
            (0.035 * sign, 1.67),
            (0.18 * sign, 1.75),
            (0.3 * sign, 1.64),
            (0.2 * sign, 1.57),
        ]
        collar = extruded_panel(
            f"ClockCollar.{side}",
            collar_points,
            -0.18,
            0.08,
            armour,
            bevel=0.014,
        )
        rigid_bind(collar, armature, "Chest")
    chest_trim = curve_tube(
        "ChestGoldFiligree",
        [(x, -0.255, z) for x, z in chest_plate_points + [chest_plate_points[0]]],
        gold,
        radius=0.012,
    )
    rigid_bind(chest_trim, armature, "Chest")
    chest_clock = add_torus(
        "ChestHourglassFrame",
        (0, -0.3, 1.47),
        0.13,
        0.022,
        gold_highlight,
        rotation=(math.pi / 2, 0, 0),
    )
    rigid_bind(chest_clock, armature, "Chest")
    hourglass = extruded_panel(
        "ChestHourglassCrystal",
        [(-0.075, 1.57), (0.075, 1.57), (0.035, 1.48), (0.075, 1.38), (-0.075, 1.38), (-0.035, 1.48)],
        -0.325,
        0.04,
        cyan,
        bevel=0.012,
    )
    rigid_bind(hourglass, armature, "Chest")

    for band_index, z in enumerate((1.18, 1.1, 1.02)):
        band = curve_tube(
            f"AbdomenBand{band_index}",
            [(-0.22 + band_index * 0.015, -0.19, z), (0, -0.225, z - 0.025), (0.22 - band_index * 0.015, -0.19, z)],
            gold if band_index == 1 else armour_dark,
            radius=0.011 if band_index == 1 else 0.014,
        )
        rigid_bind(band, armature, "Spine")

    belt = loft_mesh(
        "ClockworkBelt",
        [
            ((0, 0, 0.94), 0.32, 0.215),
            ((0, 0, 1.0), 0.32, 0.215),
        ],
        armour_dark,
        sides=28,
        cap=False,
        bevel=0.01,
    )
    rigid_bind(belt, armature, "Hips")
    belt_clock = add_torus(
        "BeltClock",
        (0, -0.235, 0.97),
        0.13,
        0.021,
        gold_highlight,
        rotation=(math.pi / 2, 0, 0),
    )
    rigid_bind(belt_clock, armature, "Hips")
    for angle in (0, math.pi / 2, math.pi, math.pi * 1.5):
        hand = curve_tube(
            f"BeltClockHand{angle:.2f}",
            [
                (0, -0.263, 0.97),
                (math.cos(angle) * 0.09, -0.263, 0.97 + math.sin(angle) * 0.09),
            ],
            gold,
            radius=0.008,
        )
        rigid_bind(hand, armature, "Hips")

    hood = loft_mesh(
        "SculptedChronoHood",
        [
            ((0, 0.03, 1.64), 0.23, 0.21),
            ((0, 0.04, 1.77), 0.27, 0.245),
            ((0, 0.045, 1.94), 0.255, 0.255),
            ((0, 0.075, 2.08), 0.15, 0.17),
            ((0, 0.09, 2.19), 0.025, 0.05),
        ],
        cloth_blue,
        sides=30,
        ring_weights=[{"Head": 1}] * 5,
        armature=armature,
        bevel=0.008,
    )
    mask_points = [(-0.145, 1.99), (0, 2.06), (0.145, 1.99), (0.15, 1.77), (0, 1.69), (-0.15, 1.77)]
    mask = extruded_panel("FacelessChronoMask", mask_points, -0.26, 0.045, armour_dark, bevel=0.014)
    rigid_bind(mask, armature, "Head")
    mask_trim = curve_tube(
        "MaskGoldRim",
        [(x, -0.29, z) for x, z in mask_points + [mask_points[0]]],
        gold,
        radius=0.012,
    )
    rigid_bind(mask_trim, armature, "Head")
    for side, sign in (("L", 1), ("R", -1)):
        eye_slit = curve_tube(
            f"EyeSlit.{side}",
            [
                (0.018 * sign, -0.32, 1.87),
                (0.118 * sign, -0.32, 1.95),
            ],
            eye,
            radius=0.009,
        )
        rigid_bind(eye_slit, armature, "Head")
    time_seam = curve_tube(
        "MaskTimeSeam",
        [
            (0, -0.322, 1.87),
            (0, -0.322, 2.01),
        ],
        eye,
        radius=0.008,
    )
    rigid_bind(time_seam, armature, "Head")

    hood_crown = extruded_panel(
        "HoodCrownBlade",
        [(-0.035, 2.1), (0, 2.32), (0.035, 2.1), (0.025, 2.0), (-0.025, 2.0)],
        -0.02,
        0.18,
        gold,
        bevel=0.01,
    )
    rigid_bind(hood_crown, armature, "Head")

    coat_front = [
        (-0.22, 0.99),
        (-0.04, 0.96),
        (-0.06, 0.33),
        (-0.19, 0.12),
        (-0.35, 0.34),
        (-0.31, 0.8),
    ]
    coat_back = [
        (-0.21, 0.98),
        (-0.03, 0.96),
        (-0.05, 0.26),
        (-0.2, 0.08),
        (-0.34, 0.29),
        (-0.3, 0.82),
    ]
    for side, sign in (("L", 1), ("R", -1)):
        points = [(x * sign, z) for x, z in coat_front]
        panel = extruded_panel(
            f"FrontCoatPanel.{side}",
            points,
            -0.12,
            0.045,
            cloth_blue,
            bevel=0.012,
        )
        rigid_bind(panel, armature, f"Cape.{side}")
        trim = curve_tube(
            f"FrontCoatTrim.{side}",
            [(x, -0.148, z) for x, z in points + [points[0]]],
            gold,
            radius=0.009,
        )
        rigid_bind(trim, armature, f"Cape.{side}")
        rear_points = [(x * sign, z) for x, z in coat_back]
        rear = extruded_panel(
            f"RearCoatPanel.{side}",
            rear_points,
            0.13,
            0.05,
            cloth,
            bevel=0.012,
        )
        rigid_bind(rear, armature, f"Cape.{side}")

    return {
        "torso": torso,
        "neck": neck,
        "materials": {
            "cloth": cloth,
            "cloth_blue": cloth_blue,
            "armour": armour,
            "gold": gold,
            "cyan": cyan,
        },
    }


def add_preview_stage(armature, preview_filename="chrono-duelist-v2.png") -> None:
    engine_ids = {
        item.identifier
        for item in bpy.context.scene.render.bl_rna.properties["engine"].enum_items
    }
    bpy.context.scene.render.engine = (
        "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engine_ids else "BLENDER_EEVEE"
    )
    bpy.context.scene.render.resolution_x = 900
    bpy.context.scene.render.resolution_y = 1100
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.filepath = str(PREVIEW_DIR / preview_filename)
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.world.color = (0.006, 0.012, 0.025)

    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, -0.02))
    floor = bpy.context.object
    floor.name = "PreviewFloor"
    floor_mat = pbr_material("PreviewFloorMaterial", (0.012, 0.018, 0.03, 1), metallic=0.18, roughness=0.42)
    floor.data.materials.append(floor_mat)

    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (4.0, -6.4, 3.7)
    target = Vector((0, 0, 1.12))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 62
    bpy.context.scene.camera = camera

    key_data = bpy.data.lights.new("PreviewKey", "AREA")
    key_data.energy = 560
    key_data.shape = "DISK"
    key_data.size = 4.5
    key = bpy.data.objects.new("PreviewKey", key_data)
    bpy.context.collection.objects.link(key)
    key.location = (-3.5, -4.0, 6.0)
    key.rotation_euler = ((Vector((0, 0, 1.1)) - key.location).to_track_quat("-Z", "Y").to_euler())

    fill_data = bpy.data.lights.new("PreviewFill", "AREA")
    fill_data.energy = 320
    fill_data.color = (0.12, 0.45, 1.0)
    fill_data.size = 3.0
    fill = bpy.data.objects.new("PreviewFill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = (3.0, -1.0, 4.2)
    fill.rotation_euler = ((Vector((0, 0, 1.15)) - fill.location).to_track_quat("-Z", "Y").to_euler())

    rim_data = bpy.data.lights.new("PreviewRim", "AREA")
    rim_data.energy = 520
    rim_data.color = (0.05, 0.7, 1.0)
    rim_data.size = 2.0
    rim = bpy.data.objects.new("PreviewRim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.location = (-2.0, 3.0, 4.4)
    rim.rotation_euler = ((Vector((0, 0, 1.2)) - rim.location).to_track_quat("-Z", "Y").to_euler())

    armature.animation_data.action = bpy.data.actions.get("Idle")
    bpy.context.scene.frame_set(13)
    bpy.ops.render.render(write_still=True)


def unwrap_character_meshes() -> None:
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.data.uv_layers:
            continue
        activate(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project()
        bpy.ops.object.mode_set(mode="OBJECT")


def main() -> None:
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    armature = create_hero_rig()
    create_custom_geometry(armature)
    unwrap_character_meshes()
    create_hero_actions(armature)
    bpy.context.scene["asset_name"] = "Chrono Duelist v2 Custom"
    bpy.context.scene["source_reference"] = "chrono-duelist-turnaround-v2.png"
    bpy.context.scene["animation_clips"] = "Idle,Run,Attack,Dash,Hit,FutureSlash"
    bpy.context.scene["pipeline"] = "custom-topology-pbr-skinned"

    source_path = SOURCE_DIR / "chrono-duelist-v2.blend"
    model_path = MODEL_DIR / "chrono-duelist-v2.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    export_glb(model_path, animations=True)
    add_preview_stage(armature)
    print(f"CUSTOM_HERO_READY source={source_path} model={model_path}")


if __name__ == "__main__":
    main()
