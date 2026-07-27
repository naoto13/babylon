"""Build concept-faithful humanoid enemies on the MPFB2 game rig.

The previous enemy generator constructed anatomy from spheres and cylinders.
This pipeline starts from a continuous CC0 MPFB2 human body and 55-bone game
rig, then layers project-authored armour, cloth and role-specific props.

Run Blender without ``--factory-startup`` so the enabled MPFB2 extension is
available:

    blender --background --python-exit-code 1 \
      --python scripts/build_concept_humanoid_enemies.py

Pass one or more roles after ``--`` to build a subset.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "assets" / "production" / "models"
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
BAKED_FOUNDATION = SOURCE_DIR / "chrono-duelist-custom.blend"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
SOURCE_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SCRIPT_DIR))
from build_blender_assets import clear_scene, export_glb  # noqa: E402
from build_custom_hero import (  # noqa: E402
    add_torus,
    create_surface_texture,
    curve_tube,
    extruded_panel,
    loft_mesh,
    make_mesh,
    pbr_material,
    rigid_bind,
    tube_mesh,
    unwrap_character_meshes,
)
from build_high_detail_enemies import create_humanoid_actions  # noqa: E402
from build_mpfb_hero import (  # noqa: E402
    align_armour_to_human_rig,
    apply_human_material,
    bake_visible_human,
    consolidate_costume_meshes,
    dynamic_import,
    limit_vertex_influences,
    rename_deformation_bones,
)


KINDS = ("shooter", "thief", "boss")


def create_engraving_normal_texture(
    name: str,
    *,
    seed: float,
    strength: float = 1.0,
) -> bpy.types.Image:
    """Bake fine forged grooves to a glTF-compatible tangent normal map."""

    size = 384
    pixels: list[float] = []
    for y in range(size):
        v = y / size * math.tau
        for x in range(size):
            u = x / size * math.tau
            du = (
                math.cos(u * 5.0 + v * 2.0 + seed) * 0.55
                + math.cos(u * 13.0 - v * 3.0 + seed * 0.7) * 0.22
                + math.cos((u + v) * 23.0 + seed * 1.3) * 0.08
            )
            dv = (
                math.cos(v * 7.0 - u * 1.5 + seed) * 0.48
                - math.cos(u * 4.0 - v * 11.0 + seed * 0.6) * 0.2
                + math.cos((u - v) * 19.0 + seed * 1.1) * 0.07
            )
            normal = Vector((-du * strength, -dv * strength, 1.0)).normalized()
            pixels.extend(
                (
                    normal.x * 0.5 + 0.5,
                    normal.y * 0.5 + 0.5,
                    normal.z * 0.5 + 0.5,
                    1.0,
                )
            )
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    image.pixels.foreach_set(pixels)
    image.colorspace_settings.name = "Non-Color"
    texture_dir = ROOT / "assets" / "production" / "textures" / "chrono-duelist-v2"
    texture_dir.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(texture_dir / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    return image


def attach_normal_map(
    material: bpy.types.Material,
    image: bpy.types.Image,
    *,
    strength: float,
) -> None:
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.name = f"{material.name}EngravingNormal"
    texture.image = image
    texture.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = strength
    links.new(texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])


def create_mpfb_enemy(kind: str):
    HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
    TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
    macro = TargetService.get_default_macro_info_dict()
    macro.update(
        {
            "shooter": {
                "gender": 0.08,
                "age": 0.38,
                "muscle": 0.56,
                "weight": 0.34,
                "proportions": 0.68,
                "height": 0.7,
            },
            "thief": {
                "gender": 0.12,
                "age": 0.34,
                "muscle": 0.64,
                "weight": 0.3,
                "proportions": 0.58,
                "height": 0.58,
            },
            "boss": {
                "gender": 0.03,
                "age": 0.48,
                "muscle": 0.88,
                "weight": 0.7,
                "proportions": 0.78,
                "height": 0.82,
            },
        }[kind]
    )
    human = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.135,
        macro_detail_dict=macro,
    )
    rig = HumanService.add_builtin_rig(human, "game_engine")
    if rig is None:
        raise RuntimeError(f"{kind}: MPFB2 did not create the game_engine rig")
    return human, rig


def load_baked_mpfb_foundation(kind: str):
    """Reuse the checked-in MPFB body/rig when the Blender extension is absent."""

    if not BAKED_FOUNDATION.is_file():
        raise RuntimeError(
            f"{kind}: MPFB2 is unavailable and baked foundation is missing: "
            f"{BAKED_FOUNDATION}"
        )
    bpy.ops.wm.open_mainfile(filepath=str(BAKED_FOUNDATION))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    humans = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and "Anatomy" in obj.name
    ]
    if len(rigs) != 1 or len(humans) != 1:
        raise RuntimeError(
            f"{kind}: baked foundation expected one rig and anatomy mesh, "
            f"got rigs={len(rigs)} humans={len(humans)}"
        )
    rig = rigs[0]
    human = humans[0]
    for obj in list(bpy.context.scene.objects):
        if obj not in {rig, human}:
            bpy.data.objects.remove(obj, do_unlink=True)
    if rig.animation_data is not None:
        rig.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    print(
        f"MPFB_FOUNDATION_REUSED kind={kind} source={BAKED_FOUNDATION}",
        flush=True,
    )
    return human, rig


def palette(kind: str) -> dict[str, bpy.types.Material]:
    values = {
        "shooter": {
            "cloth": (0.009, 0.006, 0.022),
            "fabric": (0.045, 0.025, 0.105),
            "armour": (0.07, 0.045, 0.13),
            "metal": (0.022, 0.016, 0.038),
            "trim": (0.55, 0.31, 0.085),
            "glow": (0.18, 0.012, 0.48),
            "emission": (0.52, 0.025, 0.92),
        },
        "thief": {
            "cloth": (0.004, 0.008, 0.014),
            "fabric": (0.015, 0.038, 0.055),
            "armour": (0.025, 0.052, 0.07),
            "metal": (0.008, 0.021, 0.031),
            "trim": (0.5, 0.28, 0.075),
            "glow": (0.0, 0.22, 0.48),
            "emission": (0.0, 0.68, 1.0),
        },
        "boss": {
            "cloth": (0.015, 0.003, 0.008),
            "fabric": (0.075, 0.014, 0.029),
            "armour": (0.075, 0.022, 0.032),
            "metal": (0.026, 0.008, 0.014),
            "trim": (0.52, 0.22, 0.055),
            "glow": (0.42, 0.002, 0.008),
            "emission": (1.0, 0.008, 0.015),
        },
    }[kind]

    cloth_texture = create_surface_texture(
        f"{kind}-void-cloth",
        values["cloth"],
        seed={"shooter": 811, "thief": 821, "boss": 831}[kind],
        weave=True,
    )
    fabric_texture = create_surface_texture(
        f"{kind}-role-fabric",
        values["fabric"],
        seed={"shooter": 812, "thief": 822, "boss": 832}[kind],
        weave=True,
    )
    armour_texture = create_surface_texture(
        f"{kind}-engraved-armour",
        values["armour"],
        seed={"shooter": 813, "thief": 823, "boss": 833}[kind],
        scratches=True,
    )
    trim_texture = create_surface_texture(
        f"{kind}-antique-brass",
        values["trim"],
        seed={"shooter": 814, "thief": 824, "boss": 834}[kind],
        scratches=True,
    )
    engraving_normal = create_engraving_normal_texture(
        f"{kind}-engraving-normal",
        seed={"shooter": 2.7, "thief": 4.1, "boss": 5.9}[kind],
        strength=0.58,
    )
    title = kind.title()
    cloth = pbr_material(
            f"{title}VoidCloth",
            (*values["cloth"], 1),
            metallic=0.02,
            roughness=0.88,
            texture=cloth_texture,
        )
    fabric = pbr_material(
            f"{title}RoleFabric",
            (*values["fabric"], 1),
            metallic=0.04,
            roughness=0.74,
            texture=fabric_texture,
        )
    armour = pbr_material(
            f"{title}EngravedArmour",
            (*values["armour"], 1),
            metallic=0.78,
            roughness=0.31,
            coat=0.16,
            texture=armour_texture,
        )
    dark = pbr_material(
            f"{title}DarkMechanism",
            (*values["metal"], 1),
            metallic=0.84,
            roughness=0.32,
        )
    brass = pbr_material(
            f"{title}AntiqueBrass",
            (*values["trim"], 1),
            metallic=0.9,
            roughness=0.27,
            coat=0.12,
            texture=trim_texture,
        )
    brass_high = pbr_material(
            f"{title}PolishedBrass",
            (
                min(1.0, values["trim"][0] * 1.45),
                min(1.0, values["trim"][1] * 1.5),
                min(1.0, values["trim"][2] * 1.6),
                1,
            ),
            metallic=0.92,
            roughness=0.18,
            coat=0.24,
        )
    glow = pbr_material(
            f"{title}ChronoGlow",
            (*values["glow"], 1),
            metallic=0.08,
            roughness=0.12,
            emission=values["emission"],
            emission_strength=0.38 if kind != "boss" else 0.58,
            coat=0.35,
        )
    eye = pbr_material(
            f"{title}PredatorEye",
            (*values["glow"], 1),
            metallic=0.02,
            roughness=0.08,
            emission=values["emission"],
            emission_strength=0.82,
            coat=0.48,
        )
    attach_normal_map(armour, engraving_normal, strength=0.48)
    attach_normal_map(dark, engraving_normal, strength=0.22)
    attach_normal_map(brass, engraving_normal, strength=0.18)
    return {
        "cloth": cloth,
        "fabric": fabric,
        "armour": armour,
        "dark": dark,
        "brass": brass,
        "brass_high": brass_high,
        "glow": glow,
        "eye": eye,
    }


def remove_hero_weapons() -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith("TimeBlade."):
            bpy.data.objects.remove(obj, do_unlink=True)


def remove_role_conflicts(kind: str) -> None:
    prefixes = {
        "shooter": (
            "ChestHourglassFrame",
            "ChestHourglassCrystal",
        ),
        "thief": (
            "ChestHourglassFrame",
            "ChestHourglassCrystal",
        ),
        "boss": (),
    }[kind]
    for obj in list(bpy.data.objects):
        if any(obj.name.startswith(prefix) for prefix in prefixes):
            bpy.data.objects.remove(obj, do_unlink=True)


def replace_base_materials(
    enemy_palette: dict[str, bpy.types.Material],
) -> None:
    categories = {
        "VoidClothV2": "cloth",
        "MidnightFabricV2": "fabric",
        "MidnightArmourV2": "armour",
        "DarkSteelV2": "dark",
        "AntiqueClockGoldV2": "brass",
        "PolishedClockGoldV2": "brass_high",
        "TimeCrystalV2": "glow",
        "TimeEyeV2": "eye",
    }
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for slot_index, slot in enumerate(obj.material_slots):
            if slot.material is None:
                continue
            category = categories.get(slot.material.name)
            if category:
                obj.data.materials[slot_index] = enemy_palette[category]


def connected_radial_gear(
    name: str,
    center: tuple[float, float, float],
    radius: float,
    depth: float,
    mat,
    rig,
    bone: str,
    *,
    teeth: int = 16,
):
    """Create a single connected rim, hub and spoke topology."""

    segments_per_tooth = 6
    count = teeth * segments_per_tooth
    levels = (1.12, 0.72, 0.26, 0.09)
    cx, cy, cz = center
    vertices: list[tuple[float, float, float]] = []
    for y_offset in (-depth * 0.5, depth * 0.5):
        for level_index, level in enumerate(levels):
            for index in range(count):
                angle = math.tau * index / count
                if level_index == 0:
                    phase = index % segments_per_tooth
                    tooth = 1.0 if 1 <= phase <= 4 else 0.0
                    r = radius * (1.0 + tooth * 0.12)
                else:
                    r = radius * level
                vertices.append(
                    (
                        cx + math.cos(angle) * r,
                        cy + y_offset,
                        cz + math.sin(angle) * r,
                    )
                )

    layer_stride = count * len(levels)

    def vertex(layer: int, level: int, index: int) -> int:
        return layer * layer_stride + level * count + index % count

    faces: list[tuple[int, ...]] = []
    for layer in (0, 1):
        reverse = layer == 0
        for index in range(count):
            following = (index + 1) % count
            rim = (
                vertex(layer, 0, index),
                vertex(layer, 0, following),
                vertex(layer, 1, following),
                vertex(layer, 1, index),
            )
            hub = (
                vertex(layer, 2, index),
                vertex(layer, 2, following),
                vertex(layer, 3, following),
                vertex(layer, 3, index),
            )
            faces.append(tuple(reversed(rim)) if reverse else rim)
            faces.append(tuple(reversed(hub)) if reverse else hub)
            if index % segments_per_tooth in {0, 1}:
                spoke = (
                    vertex(layer, 1, index),
                    vertex(layer, 1, following),
                    vertex(layer, 2, following),
                    vertex(layer, 2, index),
                )
                faces.append(tuple(reversed(spoke)) if reverse else spoke)
    for level in (0, 3):
        for index in range(count):
            following = (index + 1) % count
            wall = (
                vertex(0, level, index),
                vertex(1, level, index),
                vertex(1, level, following),
                vertex(0, level, following),
            )
            faces.append(wall if level == 0 else tuple(reversed(wall)))

    gear = make_mesh(name, vertices, faces, mat, smooth=False)
    rigid_bind(gear, rig, bone)
    return gear


def add_surface_modifiers(
    obj: bpy.types.Object,
    *,
    thickness: float,
    bevel: float,
    subdivision: int = 1,
) -> None:
    """Turn an authored surface patch into a softly forged game-ready shell."""

    solidify = obj.modifiers.new("ForgedThickness", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = 0.0
    solidify.use_even_offset = True
    edge = obj.modifiers.new("HandFinishedEdge", "BEVEL")
    edge.width = bevel
    edge.segments = 3
    edge.limit_method = "ANGLE"
    if subdivision:
        smooth = obj.modifiers.new("TailoredSurface", "SUBSURF")
        smooth.levels = subdivision
        smooth.render_levels = subdivision


def curved_shell(
    name: str,
    *,
    center_x: float,
    center_z: float,
    width: float,
    height: float,
    front_y: float,
    bulge: float,
    material,
    rig,
    bone: str,
    top_scale: float = 0.82,
    bottom_scale: float = 0.9,
    columns: int = 16,
    rows: int = 12,
    thickness: float = 0.025,
    bevel: float = 0.009,
) -> bpy.types.Object:
    """Create a continuous double-curved armour shell instead of a flat panel."""

    vertices: list[tuple[float, float, float]] = []
    for row in range(rows + 1):
        v = row / rows
        scale = top_scale * (1.0 - v) + bottom_scale * v
        scale += math.sin(math.pi * v) * (1.0 - min(top_scale, bottom_scale))
        for column in range(columns + 1):
            u = column / columns * 2.0 - 1.0
            x = center_x + u * width * 0.5 * scale
            z = center_z + height * 0.5 - v * height
            crown = (1.0 - u * u) * math.sin(math.pi * (0.12 + 0.76 * v))
            y = front_y - bulge * crown
            vertices.append((x, y, z))
    faces: list[tuple[int, ...]] = []
    stride = columns + 1
    for row in range(rows):
        for column in range(columns):
            a = row * stride + column
            faces.append((a, a + 1, a + stride + 1, a + stride))
    shell = make_mesh(name, vertices, faces, material, smooth=True)
    add_surface_modifiers(
        shell,
        thickness=thickness,
        bevel=bevel,
        subdivision=0,
    )
    rigid_bind(shell, rig, bone)
    return shell


def draped_panel(
    name: str,
    *,
    center_x: float,
    top_z: float,
    bottom_z: float,
    top_width: float,
    bottom_width: float,
    y: float,
    material,
    rig,
    bone: str,
    seed: float,
    tatter: float = 0.0,
    columns: int = 14,
    rows: int = 18,
) -> bpy.types.Object:
    """Create a rippled cloth sheet with an irregular hem and real thickness."""

    hem = [
        bottom_z
        + tatter
        * (
            0.45 * math.sin(seed + column * 2.19)
            + 0.25 * math.sin(seed * 1.7 + column * 4.13)
        )
        for column in range(columns + 1)
    ]
    vertices: list[tuple[float, float, float]] = []
    for row in range(rows + 1):
        v = row / rows
        width = top_width * (1.0 - v) + bottom_width * v
        for column in range(columns + 1):
            u = column / columns * 2.0 - 1.0
            target_bottom = hem[column]
            z = top_z * (1.0 - v) + target_bottom * v
            x = center_x + u * width * 0.5
            ripple = (
                math.sin(u * math.pi * 2.1 + seed) * 0.025
                + math.sin(v * math.pi * 2.0 + u * 1.7) * 0.012
            )
            vertices.append((x, y + ripple * (0.3 + 0.7 * v), z))
    faces: list[tuple[int, ...]] = []
    stride = columns + 1
    for row in range(rows):
        for column in range(columns):
            a = row * stride + column
            faces.append((a, a + 1, a + stride + 1, a + stride))
    panel = make_mesh(name, vertices, faces, material, smooth=True)
    add_surface_modifiers(
        panel,
        thickness=0.018,
        bevel=0.006,
        subdivision=0,
    )
    rigid_bind(panel, rig, bone)
    return panel


def add_common_concept_geometry(kind: str, rig, mats) -> None:
    """Author the shared curved armour language directly around the MPFB body."""

    title = kind.title()
    torso = loft_mesh(
        f"{title}TailoredArmouredTorso",
        [
            ((0, 0.018, 0.92), 0.285, 0.19),
            ((0, 0.005, 1.12), 0.31, 0.205),
            ((0, -0.005, 1.36), 0.355, 0.225),
            ((0, 0.0, 1.59), 0.405, 0.245),
            ((0, 0.015, 1.73), 0.34, 0.21),
        ],
        mats["dark"],
        sides=36,
        ring_weights=[
            {"Hips": 1.0},
            {"Hips": 0.35, "Spine": 0.65},
            {"Spine": 0.55, "Chest": 0.45},
            {"Chest": 1.0},
            {"Chest": 1.0},
        ],
        armature=rig,
        bevel=0.01,
    )
    torso.name = f"{title}ContinuousUnderCuirass"

    curved_shell(
        f"{title}SculptedBreastplate",
        center_x=0,
        center_z=1.48,
        width=0.66 if kind != "boss" else 0.76,
        height=0.52,
        front_y=-0.23,
        bulge=0.075,
        material=mats["armour"],
        rig=rig,
        bone="Chest",
        top_scale=0.92,
        bottom_scale=0.72,
        thickness=0.035,
        bevel=0.012,
    )
    for side, sign in (("L", 1), ("R", -1)):
        chest_arc = curve_tube(
            f"{title}BreastplateFiligree.{side}",
            [
                (0.025 * sign, -0.322, 1.67),
                (0.18 * sign, -0.325, 1.61),
                (0.285 * sign, -0.305, 1.48),
                (0.205 * sign, -0.31, 1.29),
                (0.04 * sign, -0.315, 1.24),
            ],
            mats["brass"],
            radius=0.011,
            resolution=3,
        )
        rigid_bind(chest_arc, rig, "Chest")
        collar = curved_shell(
            f"{title}RaisedCollar.{side}",
            center_x=0.19 * sign,
            center_z=1.72,
            width=0.34,
            height=0.22,
            front_y=-0.12,
            bulge=0.075,
            material=mats["armour"],
            rig=rig,
            bone="Chest",
            top_scale=0.62,
            bottom_scale=0.98,
            columns=12,
            rows=7,
            thickness=0.03,
            bevel=0.01,
        )
        collar.name = f"{title}RaisedCollar.{side}"

    for band_index, z in enumerate((1.25, 1.15, 1.05)):
        band = curve_tube(
            f"{title}ArticulatedAbdomen{band_index + 1}",
            [
                (-0.24 + band_index * 0.012, -0.235, z),
                (0, -0.285, z - 0.035),
                (0.24 - band_index * 0.012, -0.235, z),
            ],
            mats["brass"] if band_index == 1 else mats["armour"],
            radius=0.014,
            resolution=3,
        )
        rigid_bind(band, rig, "Spine")

    belt = loft_mesh(
        f"{title}ForgedBelt",
        [
            ((0, 0, 0.91), 0.34, 0.225),
            ((0, 0, 1.01), 0.35, 0.23),
        ],
        mats["dark"],
        sides=36,
        cap=False,
        bevel=0.012,
    )
    rigid_bind(belt, rig, "Hips")
    belt_rim = add_torus(
        f"{title}BeltChronometerRim",
        (0, -0.245, 0.96),
        0.105,
        0.018,
        mats["brass_high"],
        rotation=(math.pi / 2, 0, 0),
    )
    rigid_bind(belt_rim, rig, "Hips")

    for side, sign in (("L", 1), ("R", -1)):
        shoulder = curved_shell(
            f"{title}LayeredPauldron.{side}",
            center_x=0.39 * sign,
            center_z=1.68,
            width=0.42 if kind != "boss" else 0.5,
            height=0.3 if kind != "boss" else 0.36,
            front_y=-0.045,
            bulge=0.13,
            material=mats["armour"],
            rig=rig,
            bone=f"UpperArm.{side}",
            top_scale=0.62,
            bottom_scale=1.0,
            thickness=0.035,
            bevel=0.012,
        )
        shoulder.name = f"{title}LayeredPauldron.{side}"
        shoulder_rim = curve_tube(
            f"{title}PauldronBrassRim.{side}",
            [
                (0.22 * sign, -0.14, 1.76),
                (0.38 * sign, -0.18, 1.83),
                (0.57 * sign, -0.12, 1.72),
                (0.49 * sign, -0.14, 1.55),
                (0.3 * sign, -0.16, 1.56),
            ],
            mats["brass_high"],
            radius=0.012,
            resolution=3,
        )
        rigid_bind(shoulder_rim, rig, f"UpperArm.{side}")
        for ridge_index, z_offset in enumerate((0.055, 0.0, -0.055)):
            ridge = curve_tube(
                f"{title}PauldronEngravedRidge.{side}.{ridge_index + 1}",
                [
                    (0.27 * sign, -0.175, 1.71 + z_offset),
                    (0.4 * sign, -0.19, 1.76 + z_offset),
                    (0.52 * sign, -0.15, 1.69 + z_offset),
                ],
                mats["brass"] if ridge_index == 1 else mats["dark"],
                radius=0.007,
                resolution=2,
            )
            rigid_bind(ridge, rig, f"UpperArm.{side}")

        upper_arm = tube_mesh(
            f"{title}ForgedUpperArm.{side}",
            [
                (0.36 * sign, 0.0, 1.59),
                (0.47 * sign, -0.01, 1.5),
                (0.58 * sign, -0.02, 1.36),
            ],
            [(0.14, 0.125), (0.135, 0.118), (0.11, 0.1)],
            mats["dark"],
            sides=28,
            bevel=0.009,
        )
        rigid_bind(upper_arm, rig, f"UpperArm.{side}")
        bracer = tube_mesh(
            f"{title}LayeredVambrace.{side}",
            [
                (0.58 * sign, -0.025, 1.36),
                (0.69 * sign, -0.04, 1.2),
                (0.78 * sign, -0.055, 1.07),
            ],
            [(0.12, 0.105), (0.115, 0.1), (0.095, 0.08)],
            mats["armour"],
            sides=28,
            bevel=0.01,
        )
        rigid_bind(bracer, rig, f"LowerArm.{side}")
        for rib_index, t in enumerate((0.18, 0.5, 0.82)):
            z = 1.34 * (1 - t) + 1.08 * t
            x = (0.59 * (1 - t) + 0.77 * t) * sign
            rib = add_torus(
                f"{title}VambraceRib.{side}.{rib_index + 1}",
                (x, -0.04, z),
                0.105 - t * 0.02,
                0.012,
                mats["brass"],
                rotation=(math.radians(76), 0, math.radians(35) * sign),
            )
            rigid_bind(rib, rig, f"LowerArm.{side}")
        glove = tube_mesh(
            f"{title}ArmouredGlove.{side}",
            [
                (0.75 * sign, -0.05, 1.11),
                (0.84 * sign, -0.07, 1.01),
                (0.88 * sign, -0.08, 0.96),
            ],
            [(0.085, 0.075), (0.075, 0.066), (0.052, 0.05)],
            mats["dark"],
            sides=24,
            bevel=0.008,
        )
        rigid_bind(glove, rig, f"Hand.{side}")

        thigh = tube_mesh(
            f"{title}SculptedCuissard.{side}",
            [
                (0.16 * sign, 0.0, 0.84),
                (0.18 * sign, -0.01, 0.68),
                (0.19 * sign, -0.02, 0.51),
            ],
            [(0.16, 0.14), (0.15, 0.13), (0.125, 0.11)],
            mats["dark"],
            sides=28,
            bevel=0.01,
        )
        rigid_bind(thigh, rig, f"UpperLeg.{side}")
        knee = curved_shell(
            f"{title}KneeChronometer.{side}",
            center_x=0.19 * sign,
            center_z=0.47,
            width=0.25,
            height=0.24,
            front_y=-0.125,
            bulge=0.065,
            material=mats["armour"],
            rig=rig,
            bone=f"LowerLeg.{side}",
            top_scale=0.72,
            bottom_scale=0.62,
            columns=12,
            rows=8,
            thickness=0.028,
            bevel=0.009,
        )
        knee.name = f"{title}KneeChronometer.{side}"
        greave = tube_mesh(
            f"{title}ForgedGreave.{side}",
            [
                (0.19 * sign, -0.025, 0.43),
                (0.19 * sign, -0.055, 0.27),
                (0.19 * sign, -0.095, 0.12),
            ],
            [(0.12, 0.105), (0.115, 0.102), (0.1, 0.095)],
            mats["armour"],
            sides=28,
            bevel=0.01,
        )
        rigid_bind(greave, rig, f"LowerLeg.{side}")
        greave_trim = curve_tube(
            f"{title}GreaveFiligree.{side}",
            [
                (0.14 * sign, -0.17, 0.41),
                (0.19 * sign, -0.18, 0.27),
                (0.23 * sign, -0.17, 0.13),
            ],
            mats["brass"],
            radius=0.01,
            resolution=3,
        )
        rigid_bind(greave_trim, rig, f"LowerLeg.{side}")
        knee_rim = add_torus(
            f"{title}KneeClockRim.{side}",
            (0.19 * sign, -0.215, 0.47),
            0.075,
            0.013,
            mats["brass_high"],
            rotation=(math.pi / 2, 0, 0),
        )
        rigid_bind(knee_rim, rig, f"LowerLeg.{side}")
        thigh_line = curve_tube(
            f"{title}CuissardFiligree.{side}",
            [
                (0.12 * sign, -0.16, 0.81),
                (0.18 * sign, -0.175, 0.66),
                (0.23 * sign, -0.16, 0.53),
            ],
            mats["brass"],
            radius=0.008,
            resolution=2,
        )
        rigid_bind(thigh_line, rig, f"UpperLeg.{side}")
        boot = tube_mesh(
            f"{title}ArmouredSabatons.{side}",
            [
                (0.19 * sign, -0.06, 0.15),
                (0.19 * sign, -0.2, 0.08),
                (0.19 * sign, -0.36, 0.065),
            ],
            [(0.11, 0.105), (0.12, 0.14), (0.115, 0.18)],
            mats["dark"],
            sides=28,
            bevel=0.011,
        )
        rigid_bind(boot, rig, f"Foot.{side}")
        toe_cap = extruded_panel(
            f"{title}SabatonsToeCap.{side}",
            [
                (0.1 * sign, 0.13),
                (0.19 * sign, 0.18),
                (0.3 * sign, 0.12),
                (0.28 * sign, 0.035),
                (0.11 * sign, 0.035),
            ],
            -0.35,
            0.045,
            mats["armour"],
            bevel=0.012,
        )
        rigid_bind(toe_cap, rig, f"Foot.{side}")

        draped_panel(
            f"{title}FrontTasset.{side}",
            center_x=0.19 * sign,
            top_z=1.0,
            bottom_z=0.18 if kind != "thief" else 0.26,
            top_width=0.29,
            bottom_width=0.32,
            y=-0.21,
            material=mats["fabric"],
            rig=rig,
            bone=f"Cape.{side}",
            seed=1.3 + sign,
            tatter=0.08 if kind != "shooter" else 0.045,
        )
        tasset_trim = curve_tube(
            f"{title}TassetBrassSpine.{side}",
            [
                (0.19 * sign, -0.245, 0.96),
                (0.19 * sign, -0.25, 0.6),
                (0.19 * sign, -0.25, 0.25),
            ],
            mats["brass"],
            radius=0.009,
            resolution=2,
        )
        rigid_bind(tasset_trim, rig, f"Cape.{side}")

    hood_tip_x = {"shooter": -0.09, "thief": 0.14, "boss": 0.0}[kind]
    hood_rings = [
        ((0, 0.04, 1.67), 0.24, 0.21),
        ((0, 0.025, 1.82), 0.285, 0.26),
        ((0, 0.035, 2.0), 0.27, 0.265),
        ((hood_tip_x * 0.25, 0.09, 2.18), 0.19, 0.19),
    ]
    if kind == "boss":
        hood_rings.extend(
            [
                ((0, 0.13, 2.29), 0.09, 0.1),
                ((0, 0.15, 2.36), 0.02, 0.025),
            ]
        )
    else:
        hood_rings.extend(
            [
                ((hood_tip_x * 0.72, 0.15, 2.36), 0.105, 0.11),
                ((hood_tip_x, 0.18, 2.52), 0.018, 0.022),
            ]
        )
    hood = loft_mesh(
        f"{title}SculptedClothHood",
        hood_rings,
        mats["fabric"],
        sides=36,
        ring_weights=[{"Head": 1.0}] * len(hood_rings),
        armature=rig,
        bevel=0.008,
    )
    smooth = hood.modifiers.new("TailoredHoodSurface", "SUBSURF")
    smooth.levels = 1
    smooth.render_levels = 1
    hood_rim = curve_tube(
        f"{title}HoodBrassRim",
        [
            (-0.215, -0.22, 2.08),
            (-0.14, -0.285, 2.17),
            (0, -0.305, 2.22),
            (0.14, -0.285, 2.17),
            (0.215, -0.22, 2.08),
        ],
        mats["brass_high"],
        radius=0.013,
        resolution=3,
    )
    rigid_bind(hood_rim, rig, "Head")
    for side, sign in (("L", 1), ("R", -1)):
        hood_seam = curve_tube(
            f"{title}HoodTailoredSeam.{side}",
            [
                (0.04 * sign, -0.205, 2.5 if kind != "boss" else 2.34),
                (0.15 * sign, -0.225, 2.3),
                (0.23 * sign, -0.225, 2.08),
                (0.235 * sign, -0.205, 1.88),
            ],
            mats["brass"],
            radius=0.007,
            resolution=3,
        )
        rigid_bind(hood_seam, rig, "Head")

    curved_shell(
        f"{title}FacetedMask",
        center_x=0,
        center_z=1.89,
        width=0.29,
        height=0.34,
        front_y=-0.265,
        bulge=0.045,
        material=mats["dark"],
        rig=rig,
        bone="Head",
        top_scale=0.72,
        bottom_scale=0.62,
        columns=12,
        rows=10,
        thickness=0.022,
        bevel=0.006,
    )
    for side, sign in (("L", 1), ("R", -1)):
        eye = curve_tube(
            f"{title}PredatorEye.{side}",
            [
                (0.015 * sign, -0.328, 1.94),
                (0.115 * sign, -0.325, 1.99),
            ],
            mats["eye"],
            radius=0.011,
            resolution=3,
        )
        rigid_bind(eye, rig, "Head")
        cheek_line = curve_tube(
            f"{title}MaskCheekFiligree.{side}",
            [
                (0.12 * sign, -0.327, 1.99),
                (0.1 * sign, -0.337, 1.86),
                (0.025 * sign, -0.338, 1.77),
            ],
            mats["brass"],
            radius=0.008,
            resolution=2,
        )
        rigid_bind(cheek_line, rig, "Head")
    mask_seam = curve_tube(
        f"{title}MaskCenterFiligree",
        [(0, -0.33, 1.78), (0, -0.335, 2.03)],
        mats["brass_high"],
        radius=0.009,
        resolution=2,
    )
    rigid_bind(mask_seam, rig, "Head")

    draped_panel(
        f"{title}HoodBackDrape",
        center_x=0,
        top_z=1.98,
        bottom_z=1.28,
        top_width=0.42,
        bottom_width=0.52,
        y=0.19,
        material=mats["cloth"],
        rig=rig,
        bone="Chest",
        seed={"shooter": 2.1, "thief": 3.1, "boss": 4.1}[kind],
        tatter=0.08,
        columns=16,
        rows=16,
    )


def add_shooter_geometry(rig, mats) -> None:
    """Add the concept's crescent bow and arcane marksman silhouette."""

    upper_limb = extruded_panel(
        "ShooterUpperForgedBowLimb",
        [
            (0.82, 1.16),
            (1.01, 1.37),
            (1.11, 1.64),
            (1.06, 1.88),
            (0.94, 1.74),
            (0.92, 1.48),
            (0.74, 1.25),
        ],
        -0.13,
        0.075,
        mats["brass"],
        bevel=0.018,
    )
    rigid_bind(upper_limb, rig, "Hand.L")
    lower_limb = extruded_panel(
        "ShooterLowerForgedBowLimb",
        [
            (0.82, 1.16),
            (1.01, 0.97),
            (1.11, 0.72),
            (1.04, 0.48),
            (0.92, 0.63),
            (0.91, 0.88),
            (0.74, 1.08),
        ],
        -0.13,
        0.075,
        mats["brass"],
        bevel=0.018,
    )
    rigid_bind(lower_limb, rig, "Hand.L")

    bow_points = [
        (1.04, -0.175, 0.51),
        (1.10, -0.18, 0.74),
        (1.01, -0.18, 0.98),
        (0.78, -0.18, 1.16),
        (1.01, -0.18, 1.36),
        (1.10, -0.18, 1.64),
        (1.06, -0.175, 1.86),
    ]
    bow = curve_tube(
        "ShooterContinuousCrescentBow",
        bow_points,
        mats["brass"],
        radius=0.035,
        resolution=4,
    )
    rigid_bind(bow, rig, "Hand.L")
    inner_bow = curve_tube(
        "ShooterBowChronoInlay",
        [(point[0] - 0.035, point[1] - 0.015, point[2]) for point in bow_points],
        mats["glow"],
        radius=0.012,
        resolution=3,
    )
    rigid_bind(inner_bow, rig, "Hand.L")
    string = curve_tube(
        "ShooterBowString",
        [bow_points[0], (0.72, -0.205, 1.16), bow_points[-1]],
        mats["glow"],
        radius=0.005,
        resolution=2,
    )
    rigid_bind(string, rig, "Hand.L")
    connected_radial_gear(
        "ShooterBowConnectedChronometer",
        (0.79, -0.19, 1.16),
        0.28,
        0.075,
        mats["dark"],
        rig,
        "Hand.L",
        teeth=14,
    )
    connected_radial_gear(
        "ShooterBowPurpleRotor",
        (0.79, -0.235, 1.16),
        0.17,
        0.035,
        mats["brass"],
        rig,
        "Hand.L",
        teeth=10,
    )
    bow_core = add_torus(
        "ShooterBowArcaneLens",
        (0.79, -0.265, 1.16),
        0.095,
        0.018,
        mats["glow"],
        rotation=(math.pi / 2, 0, 0),
    )
    rigid_bind(bow_core, rig, "Hand.L")

    arrow = tube_mesh(
        "ShooterChronoArrow",
        [
            (-0.82, -0.17, 1.04),
            (-0.94, -0.2, 1.19),
            (-1.12, -0.22, 1.42),
        ],
        [(0.012, 0.012), (0.012, 0.012), (0.004, 0.004)],
        mats["glow"],
        sides=12,
    )
    rigid_bind(arrow, rig, "Hand.R")

    connected_radial_gear(
        "ShooterChestArcaneClock",
        (0, -0.315, 1.48),
        0.16,
        0.055,
        mats["brass"],
        rig,
        "Chest",
        teeth=12,
    )
    connected_radial_gear(
        "ShooterChestPurpleCore",
        (0, -0.35, 1.48),
        0.08,
        0.028,
        mats["dark"],
        rig,
        "Chest",
        teeth=8,
    )
    chest_lens = add_torus(
        "ShooterChestArcaneLens",
        (0, -0.385, 1.48),
        0.052,
        0.016,
        mats["glow"],
        rotation=(math.pi / 2, 0, 0),
    )
    rigid_bind(chest_lens, rig, "Chest")

    draped_panel(
        "ShooterLongFrontTabard",
        center_x=0,
        top_z=1.12,
        bottom_z=0.09,
        top_width=0.34,
        bottom_width=0.3,
        y=-0.27,
        material=mats["fabric"],
        rig=rig,
        bone="Hips",
        seed=5.2,
        tatter=0.055,
        columns=16,
        rows=22,
    )
    tabard_trim = curve_tube(
        "ShooterTabardFiligree",
        [
            (0, -0.302, 1.08),
            (0, -0.307, 0.7),
            (0, -0.307, 0.26),
            (0, -0.303, 0.1),
        ],
        mats["brass"],
        radius=0.011,
        resolution=2,
    )
    rigid_bind(tabard_trim, rig, "Hips")

    for side, sign in (("L", 1), ("R", -1)):
        crescent = extruded_panel(
            f"ShooterCrescentPauldron.{side}",
            [
                (0.24 * sign, 1.69),
                (0.45 * sign, 1.84),
                (0.56 * sign, 1.72),
                (0.42 * sign, 1.68),
                (0.50 * sign, 1.56),
                (0.31 * sign, 1.6),
            ],
            -0.045,
            0.16,
            mats["armour"],
            bevel=0.016,
        )
        rigid_bind(crescent, rig, f"UpperArm.{side}")
        rune = curve_tube(
            f"ShooterPauldronRune.{side}",
            [
                (0.29 * sign, -0.145, 1.69),
                (0.41 * sign, -0.16, 1.75),
                (0.49 * sign, -0.14, 1.68),
            ],
            mats["glow"],
            radius=0.009,
        )
        rigid_bind(rune, rig, f"UpperArm.{side}")
        crescent_edge = curve_tube(
            f"ShooterSweptPauldronCrescent.{side}",
            [
                (0.26 * sign, -0.12, 1.72),
                (0.39 * sign, -0.16, 1.9),
                (0.58 * sign, -0.13, 2.0),
                (0.67 * sign, -0.08, 1.83),
                (0.56 * sign, -0.1, 1.66),
            ],
            mats["brass_high"],
            radius=0.022,
            resolution=4,
        )
        rigid_bind(crescent_edge, rig, f"UpperArm.{side}")


def claw_blade(
    name: str,
    sign: int,
    y: float,
    z_offset: float,
    mat,
    rig,
    bone: str,
):
    x_base = 0.72 * sign
    points = [
        (x_base, 1.08 + z_offset),
        ((x_base + 0.07 * sign), 1.04 + z_offset),
        ((x_base + 0.24 * sign), 0.84 + z_offset),
        ((x_base + 0.105 * sign), 0.95 + z_offset),
    ]
    blade = extruded_panel(
        name,
        points,
        y,
        0.027,
        mat,
        bevel=0.006,
    )
    rigid_bind(blade, rig, bone)
    return blade


def add_thief_geometry(rig, mats) -> None:
    """Add claw gauntlets, hourglass lantern and tension cables."""

    for side, sign in (("L", 1), ("R", -1)):
        for index, (y, z_offset) in enumerate(
            ((-0.12, 0.055), (-0.155, 0.0), (-0.19, -0.055))
        ):
            claw_blade(
                f"ThiefForgedClaw.{side}.{index + 1}",
                sign,
                y,
                z_offset,
                mats["brass_high"] if index == 1 else mats["armour"],
                rig,
                f"Hand.{side}",
            )

    lantern_frame = loft_mesh(
        "ThiefHourglassLanternFrame",
        [
            ((-0.92, -0.18, 0.74), 0.12, 0.085),
            ((-0.92, -0.18, 0.88), 0.17, 0.11),
            ((-0.92, -0.18, 1.02), 0.12, 0.085),
        ],
        mats["brass"],
        sides=20,
        cap=False,
        bevel=0.008,
    )
    rigid_bind(lantern_frame, rig, "Hand.R")
    lantern_glass = loft_mesh(
        "ThiefContinuousHourglassChronoGlass",
        [
            ((-0.92, -0.18, 0.77), 0.1, 0.075),
            ((-0.92, -0.18, 0.86), 0.045, 0.035),
            ((-0.92, -0.18, 0.9), 0.038, 0.03),
            ((-0.92, -0.18, 0.99), 0.1, 0.075),
        ],
        mats["glow"],
        sides=28,
        bevel=0.006,
    )
    rigid_bind(lantern_glass, rig, "Hand.R")
    for index, angle in enumerate((0, math.pi / 2, math.pi, math.pi * 1.5)):
        x = -0.92 + math.cos(angle) * 0.125
        y = -0.18 + math.sin(angle) * 0.09
        strut = curve_tube(
            f"ThiefLanternForgedStrut{index + 1}",
            [(x, y, 0.74), (x, y, 1.02)],
            mats["brass"],
            radius=0.012,
            resolution=2,
        )
        rigid_bind(strut, rig, "Hand.R")
    for z in (0.74, 1.02):
        ring = add_torus(
            f"ThiefLanternRing{z}",
            (-0.92, -0.18, z),
            0.15,
            0.018,
            mats["brass_high"],
        )
        ring.scale.y = 0.68
        bpy.context.view_layer.objects.active = ring
        ring.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rigid_bind(ring, rig, "Hand.R")
    lantern_handle = curve_tube(
        "ThiefLanternHandLoop",
        [
            (-0.76, -0.19, 1.04),
            (-0.84, -0.2, 1.12),
            (-0.96, -0.2, 1.09),
            (-1.0, -0.19, 1.01),
        ],
        mats["brass_high"],
        radius=0.018,
        resolution=3,
    )
    rigid_bind(lantern_handle, rig, "Hand.R")

    chest_rune = extruded_panel(
        "ThiefFracturedChestRune",
        [
            (-0.16, 1.58),
            (-0.045, 1.54),
            (-0.09, 1.43),
            (0, 1.48),
            (0.08, 1.37),
            (0.16, 1.5),
            (0.05, 1.47),
            (0.09, 1.59),
            (0, 1.53),
        ],
        -0.315,
        0.042,
        mats["glow"],
        bevel=0.009,
    )
    rigid_bind(chest_rune, rig, "Chest")

    for side, sign in (("L", 1), ("R", -1)):
        shoulder_clock = add_torus(
            f"ThiefShoulderChronometer.{side}",
            (0.39 * sign, -0.03, 1.66),
            0.16,
            0.025,
            mats["brass"],
            rotation=(math.pi / 2, 0, math.radians(18) * sign),
        )
        rigid_bind(shoulder_clock, rig, f"UpperArm.{side}")

    for side, sign in (("L", 1), ("R", -1)):
        cable = curve_tube(
            f"ThiefBackTensionCable.{side}",
            [
                (0.2 * sign, 0.13, 1.58),
                (0.38 * sign, 0.24, 1.35),
                (0.46 * sign, 0.2, 1.02),
            ],
            mats["glow"] if side == "L" else mats["dark"],
            radius=0.012,
            resolution=3,
        )
        rigid_bind(cable, rig, "Chest")


def add_boss_geometry(rig, mats) -> None:
    """Add the boss's horn crown, back chronometer and orbiting time core."""

    for side, sign in (("L", 1), ("R", -1)):
        horn_points = [
            (0.10 * sign, -0.02, 2.03),
            (0.23 * sign, -0.01, 2.17),
            (0.34 * sign, 0.03, 2.36),
            (0.31 * sign, 0.08, 2.55),
            (0.23 * sign, 0.1, 2.72),
        ]
        horn = tube_mesh(
            f"BossSweptHorn.{side}",
            horn_points,
            [
                (0.09, 0.075),
                (0.082, 0.068),
                (0.065, 0.055),
                (0.042, 0.034),
                (0.006, 0.006),
            ],
            mats["armour"],
            sides=24,
            bevel=0.006,
        )
        rigid_bind(horn, rig, "Head")
        horn_edge = curve_tube(
            f"BossHornChronoVein.{side}",
            [
                (0.11 * sign, -0.065, 2.05),
                (0.28 * sign, -0.055, 2.2),
                (0.35 * sign, -0.015, 2.37),
                (0.27 * sign, 0.03, 2.51),
            ],
            mats["glow"],
            radius=0.011,
            resolution=3,
        )
        rigid_bind(horn_edge, rig, "Head")

        spike = extruded_panel(
            f"BossShoulderBlade.{side}",
            [
                (0.29 * sign, 1.74),
                (0.58 * sign, 2.08),
                (0.52 * sign, 1.69),
                (0.38 * sign, 1.58),
            ],
            -0.03,
            0.18,
            mats["armour"],
            bevel=0.018,
        )
        rigid_bind(spike, rig, f"UpperArm.{side}")
        lower_spike = extruded_panel(
            f"BossLayeredShoulderBlade.{side}",
            [
                (0.25 * sign, 1.68),
                (0.7 * sign, 1.86),
                (0.53 * sign, 1.58),
                (0.34 * sign, 1.5),
            ],
            0.015,
            0.22,
            mats["dark"],
            bevel=0.02,
        )
        rigid_bind(lower_spike, rig, f"UpperArm.{side}")

    connected_radial_gear(
        "BossConnectedBackChronometer",
        (0, 0.22, 1.67),
        0.58,
        0.09,
        mats["brass"],
        rig,
        "Chest",
        teeth=18,
    )
    connected_radial_gear(
        "BossBackChronoRotor",
        (0, 0.17, 1.67),
        0.34,
        0.035,
        mats["glow"],
        rig,
        "Chest",
        teeth=12,
    )
    connected_radial_gear(
        "BossChestHourglassChronometer",
        (0, -0.325, 1.48),
        0.235,
        0.065,
        mats["brass"],
        rig,
        "Chest",
        teeth=14,
    )

    for side, sign in (("L", 1), ("R", -1)):
        for layer_index in range(3):
            center_x = sign * (0.17 + layer_index * 0.11)
            draped_panel(
                f"BossTatteredCape.{side}.{layer_index + 1}",
                center_x=center_x,
                top_z=1.62 - layer_index * 0.035,
                bottom_z=-0.03 + layer_index * 0.055,
                top_width=0.3,
                bottom_width=0.38,
                y=0.2 + layer_index * 0.045,
                material=mats["fabric"] if layer_index == 0 else mats["cloth"],
                rig=rig,
                bone=f"Cape.{side}",
                seed=6.1 + layer_index + sign,
                tatter=0.13,
                columns=12,
                rows=22,
            )
            trim = curve_tube(
                f"BossCapeTrim.{side}.{layer_index + 1}",
                [
                    (center_x, 0.16 + layer_index * 0.045, 1.58),
                    (center_x, 0.16 + layer_index * 0.045, 0.78),
                    (center_x, 0.16 + layer_index * 0.045, 0.05),
                ],
                mats["brass"],
                radius=0.009,
                resolution=2,
            )
            rigid_bind(trim, rig, f"Cape.{side}")

    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=4,
        radius=0.18,
        location=(-0.96, -0.27, 1.17),
    )
    orb = bpy.context.object
    orb.name = "BossFacetedTimeCore"
    orb.data.materials.append(mats["glow"])
    for polygon in orb.data.polygons:
        polygon.use_smooth = True
    rigid_bind(orb, rig, "Hand.R")
    for index, rotation in enumerate(
        ((math.pi / 2, 0, 0), (0, math.pi / 2, 0), (math.pi / 4, 0, math.pi / 3))
    ):
        orbit = add_torus(
            f"BossTimeCoreOrbit{index + 1}",
            (-0.96, -0.27, 1.17),
            0.245 + index * 0.025,
            0.012,
            mats["brass_high"],
            rotation=rotation,
        )
        rigid_bind(orbit, rig, "Hand.R")


def add_role_geometry(kind: str, rig, mats) -> None:
    if kind == "shooter":
        add_shooter_geometry(rig, mats)
    elif kind == "thief":
        add_thief_geometry(rig, mats)
    elif kind == "boss":
        add_boss_geometry(rig, mats)
    else:
        raise ValueError(kind)


def validate_meshes(kind: str, *, fail: bool = True) -> list[str]:
    corrected: list[str] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if obj.data.validate(verbose=False, clean_customdata=True):
            corrected.append(obj.name)
        obj.data.update(calc_edges=True)
    if corrected and fail:
        raise RuntimeError(f"{kind}: invalid mesh data corrected in {corrected}")
    if corrected:
        print(f"ROLE_MESH_CORRECTED kind={kind} objects={corrected}", flush=True)
    return corrected


def build_enemy(kind: str) -> None:
    print(f"HUMANOID_BUILD_BEGIN kind={kind}", flush=True)
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0

    try:
        human, rig = create_mpfb_enemy(kind)
    except RuntimeError as error:
        if "MPFB2 is not enabled" not in str(error):
            raise
        human, rig = load_baked_mpfb_foundation(kind)
    else:
        human = bake_visible_human(human, rig)
        rename_deformation_bones(human, rig)
    rig.name = f"{kind.title()}ConceptRig"
    rig.data.name = f"{kind.title()}ConceptRig"
    human.name = f"{kind.title()}ConceptAnatomy"
    human.data.name = f"{kind.title()}ConceptAnatomyMesh"

    mats = palette(kind)
    apply_human_material(human, {"cloth": mats["cloth"]})
    limit_vertex_influences(human)
    add_common_concept_geometry(kind, rig, mats)
    add_role_geometry(kind, rig, mats)
    align_armour_to_human_rig(rig, human)
    validate_meshes(kind, fail=False)
    unwrap_character_meshes()
    costume = consolidate_costume_meshes(rig, human)
    costume.name = f"{kind.title()}ConceptCostume"
    costume.data.name = f"{kind.title()}ConceptCostumeMesh"
    create_humanoid_actions(rig, kind)
    validate_meshes(kind)

    bpy.context.scene["asset_name"] = f"Chrono Arena {kind.title()} Concept Production"
    bpy.context.scene["design_reference"] = f"{kind}-turnaround-v2.png"
    bpy.context.scene["body_topology"] = "MPFB2 2.0.17 CC0"
    bpy.context.scene["animation_clips"] = "Idle,Move,Attack,Hit,Death"
    bpy.context.scene["pipeline"] = "mpfb-continuous-anatomy-concept-armour-v1"
    bpy.context.scene["runtime_role"] = kind
    bpy.context.scene["production_asset"] = True

    source_path = SOURCE_DIR / f"enemy-{kind}-concept.blend"
    model_path = MODEL_DIR / f"enemy-{kind}-concept.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    export_glb(model_path, animations=True)
    human.data.calc_loop_triangles()
    costume.data.calc_loop_triangles()
    print(
        "CONCEPT_HUMANOID_READY "
        f"kind={kind} source={source_path} model={model_path} "
        f"body_vertices={len(human.data.vertices)} "
        f"body_triangles={len(human.data.loop_triangles)} "
        f"costume_vertices={len(costume.data.vertices)} "
        f"costume_triangles={len(costume.data.loop_triangles)} "
        f"bones={len(rig.data.bones)}",
        flush=True,
    )


def main() -> None:
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    kinds = tuple(sys.argv[separator + 1 :]) or KINDS
    invalid = [kind for kind in kinds if kind not in KINDS]
    if invalid:
        raise ValueError(f"Unknown humanoid enemy kinds: {invalid}")
    for kind in kinds:
        build_enemy(kind)
    print(f"CONCEPT_HUMANOIDS_READY kinds={','.join(kinds)}", flush=True)


if __name__ == "__main__":
    main()
