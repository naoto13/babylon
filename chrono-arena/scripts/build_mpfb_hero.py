"""Build the production Chrono Duelist on an MPFB2 human deformation rig.

Prerequisites:
    - Blender 4.2 or newer
    - MPFB2 2.0.17 enabled as a Blender extension

MPFB2 is used only as the CC0 human topology, joint placement, and skin-weight
foundation. The hood, clockwork armour, coat, blades, materials, and animation
clips are authored by this project.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "assets" / "production" / "models"
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
for directory in (MODEL_DIR, SOURCE_DIR):
    directory.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SCRIPT_DIR))
from build_custom_hero import (  # noqa: E402
    add_torus,
    add_preview_stage,
    curve_tube,
    create_custom_geometry,
    extruded_panel,
    loft_mesh,
    refresh_demonic_hero_materials_in_place,
    rigid_bind,
    unwrap_character_meshes,
)
from build_blender_assets import (  # noqa: E402
    clear_scene,
    create_hero_actions,
    export_glb,
)


CUSTOM_MODEL_NAME = "chrono-duelist-custom.glb"
CUSTOM_SOURCE_NAME = "chrono-duelist-custom.blend"
REQUIRED_HERO_ACTIONS = {"Idle", "Run", "Attack", "Dash", "Hit", "FutureSlash"}

# The original procedural rig remains the animation authoring coordinate
# system. Each rigid armour piece is transformed from these rest bones to its
# matching MPFB bone after geometry creation.
ORIGINAL_REST_BONES = {
    "Root": ((0, 0, 0), (0, 0, 0.35)),
    "Hips": ((0, 0, 0.75), (0, 0, 1.02)),
    "Spine": ((0, 0, 1.02), (0, 0, 1.42)),
    "Chest": ((0, 0, 1.42), (0, 0, 1.7)),
    "Head": ((0, 0, 1.7), (0, 0, 2.08)),
    "UpperArm.L": ((0.25, 0, 1.61), (0.56, 0, 1.38)),
    "LowerArm.L": ((0.56, 0, 1.38), (0.76, -0.02, 1.12)),
    "Hand.L": ((0.76, -0.02, 1.12), (0.8, -0.04, 0.96)),
    "UpperArm.R": ((-0.25, 0, 1.61), (-0.56, 0, 1.38)),
    "LowerArm.R": ((-0.56, 0, 1.38), (-0.76, -0.02, 1.12)),
    "Hand.R": ((-0.76, -0.02, 1.12), (-0.8, -0.04, 0.96)),
    "UpperLeg.L": ((0.16, 0, 0.82), (0.18, 0, 0.46)),
    "LowerLeg.L": ((0.18, 0, 0.46), (0.19, -0.01, 0.13)),
    "Foot.L": ((0.19, -0.01, 0.13), (0.19, -0.24, 0.08)),
    "UpperLeg.R": ((-0.16, 0, 0.82), (-0.18, 0, 0.46)),
    "LowerLeg.R": ((-0.18, 0, 0.46), (-0.19, -0.01, 0.13)),
    "Foot.R": ((-0.19, -0.01, 0.13), (-0.19, -0.24, 0.08)),
    "Cape.L": ((0.14, 0.13, 1.52), (0.28, 0.2, 0.58)),
    "Cape.R": ((-0.14, 0.13, 1.52), (-0.28, 0.2, 0.58)),
}

MPFB_TO_CHRONO_BONES = {
    "pelvis": "Hips",
    "spine_01": "Spine",
    "spine_03": "Chest",
    "head": "Head",
    "upperarm_l": "UpperArm.L",
    "lowerarm_l": "LowerArm.L",
    "hand_l": "Hand.L",
    "upperarm_r": "UpperArm.R",
    "lowerarm_r": "LowerArm.R",
    "hand_r": "Hand.R",
    "thigh_l": "UpperLeg.L",
    "calf_l": "LowerLeg.L",
    "foot_l": "Foot.L",
    "thigh_r": "UpperLeg.R",
    "calf_r": "LowerLeg.R",
    "foot_r": "Foot.R",
}

PROCEDURAL_BODY_PREFIXES = (
    "DuelistBody",
    "BodyArm.",
    "BodyLeg.",
)


def dynamic_import(package_suffix: str, symbol: str):
    """Resolve a class from an enabled Blender extension package."""

    for module_name in sys.modules:
        if module_name.endswith(package_suffix):
            module = importlib.import_module(module_name)
            if hasattr(module, symbol):
                return getattr(module, symbol)
    raise RuntimeError(
        f"MPFB2 is not enabled: could not find {symbol} in *.{package_suffix}"
    )


def create_mpfb_character():
    HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
    TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")

    macro = TargetService.get_default_macro_info_dict()
    macro.update(
        {
            "gender": 0.05,
            "age": 0.42,
            "muscle": 0.72,
            "weight": 0.43,
            "proportions": 0.62,
            "height": 0.66,
        }
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
        raise RuntimeError("MPFB2 did not create the game_engine rig")
    return human, rig


def refresh_baked_hero_source():
    """Refresh materials on the checked-in MPFB source when the add-on is absent.

    This path deliberately leaves vertex positions, armature data, weights, and
    existing actions intact.  It is the hero equivalent of the baked-foundation
    fallback used by the concept humanoid enemy builder.
    """

    source_path = SOURCE_DIR / CUSTOM_SOURCE_NAME
    if not source_path.is_file():
        raise RuntimeError(
            f"MPFB2 is unavailable and baked hero source is missing: {source_path}"
        )
    bpy.ops.wm.open_mainfile(filepath=str(source_path))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"baked hero expected one rig, got {len(rigs)}")
    action_names = {action.name for action in bpy.data.actions}
    missing = REQUIRED_HERO_ACTIONS - action_names
    if missing:
        raise RuntimeError(f"baked hero is missing animation clips: {sorted(missing)}")
    refresh_demonic_hero_materials_in_place()
    print(
        f"MPFB_HERO_SOURCE_REUSED source={source_path} bones={len(rigs[0].data.bones)} "
        f"actions={','.join(sorted(action_names))}",
        flush=True,
    )
    return rigs[0]


def bake_visible_human(human, rig):
    """Bake macro shapes and the helper mask while retaining skin weights."""

    for modifier in list(human.modifiers):
        if modifier.type == "ARMATURE":
            human.modifiers.remove(modifier)

    bpy.ops.object.select_all(action="DESELECT")
    human.select_set(True)
    bpy.context.view_layer.objects.active = human
    bpy.ops.object.convert(target="MESH")
    baked = bpy.context.object
    baked.name = "ChronoDuelistAnatomy"
    baked.data.name = "ChronoDuelistAnatomyMesh"

    modifier = baked.modifiers.new("ChronoDuelistDeform", "ARMATURE")
    modifier.object = rig
    return baked


def rename_deformation_bones(human, rig) -> None:
    for old_name, new_name in MPFB_TO_CHRONO_BONES.items():
        if old_name in rig.data.bones:
            rig.data.bones[old_name].name = new_name
        if old_name in human.vertex_groups:
            human.vertex_groups[old_name].name = new_name

    rig.name = "ChronoDuelistRig"
    rig.data.name = "ChronoDuelistRig"

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    chest = rig.data.edit_bones["Chest"]
    for side, sign in (("L", 1), ("R", -1)):
        cape = rig.data.edit_bones.new(f"Cape.{side}")
        cape.head = (0.14 * sign, 0.13, 1.74)
        cape.tail = (0.28 * sign, 0.2, 0.8)
        cape.parent = chest
    bpy.ops.object.mode_set(mode="OBJECT")


def remove_procedural_body_shell() -> None:
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.name.startswith(PROCEDURAL_BODY_PREFIXES):
            bpy.data.objects.remove(obj, do_unlink=True)


def dominant_deform_group(obj):
    if obj.name == "DuelistNeck":
        return "Chest"
    scores = {}
    for vertex in obj.data.vertices:
        for membership in vertex.groups:
            scores[membership.group] = scores.get(membership.group, 0.0) + membership.weight
    if not scores:
        return None
    group_index = max(scores, key=scores.get)
    return obj.vertex_groups[group_index].name


def align_armour_to_human_rig(rig, human) -> None:
    """Move every rigid authored piece from the old rest bone to MPFB rest."""

    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj == human:
            continue
        bone_name = dominant_deform_group(obj)
        if bone_name not in ORIGINAL_REST_BONES or bone_name not in rig.data.bones:
            continue

        original_head, original_tail = ORIGINAL_REST_BONES[bone_name]
        original_head = Vector(original_head)
        original_direction = Vector(original_tail) - original_head
        original_axis = original_direction.normalized()
        target_bone = rig.data.bones[bone_name]
        target_head = rig.matrix_world @ target_bone.head_local
        target_direction = (
            rig.matrix_world.to_3x3() @ (target_bone.tail_local - target_bone.head_local)
        )
        rotation = original_direction.rotation_difference(target_direction)
        axial_scale = target_direction.length / original_direction.length
        axial_scale = max(0.45, min(1.6, axial_scale))
        if bone_name.startswith("Hand."):
            axial_scale = 1.0
        world_to_local = obj.matrix_world.inverted()
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            offset = world - original_head
            parallel = original_axis * offset.dot(original_axis)
            perpendicular = offset - parallel
            aligned_world = target_head + rotation @ (
                perpendicular + parallel * axial_scale
            )
            vertex.co = world_to_local @ aligned_world


def apply_human_material(human, materials) -> None:
    human.data.materials.clear()
    human.data.materials.append(materials["cloth"])
    for polygon in human.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True


def limit_vertex_influences(obj, maximum=4) -> None:
    """Clamp and normalize skin weights to the glTF four-joint contract."""

    for vertex in obj.data.vertices:
        memberships = sorted(
            ((item.group, item.weight) for item in vertex.groups),
            key=lambda item: item[1],
            reverse=True,
        )
        kept = memberships[:maximum]
        for group_index, _weight in memberships[maximum:]:
            obj.vertex_groups[group_index].remove([vertex.index])
        total = sum(weight for _group_index, weight in kept)
        if total <= 0:
            continue
        for group_index, weight in kept:
            normalized = max(0.0, min(1.0, weight / total))
            obj.vertex_groups[group_index].add(
                [vertex.index], normalized, "REPLACE"
            )


def add_final_costume_layers(rig, materials) -> None:
    """Add silhouette and costume layers that are authored in MPFB space."""

    cloth = materials["cloth"]
    cloth_blue = materials["cloth_blue"]
    armour = materials["armour"]
    gold = materials["gold"]
    cyan = materials["cyan"]

    cowl = loft_mesh(
        "LayeredChronoCowl",
        [
            ((0, 0.0, 1.72), 0.24, 0.19),
            ((0, -0.005, 1.78), 0.3, 0.22),
            ((0, -0.012, 1.84), 0.265, 0.205),
            ((0, -0.018, 1.9), 0.29, 0.22),
            ((0, -0.026, 1.96), 0.235, 0.19),
            ((0, -0.035, 2.02), 0.19, 0.17),
        ],
        cloth_blue,
        sides=36,
        ring_weights=[
            {"Chest": 1.0},
            {"Chest": 1.0},
            {"Chest": 0.8, "Head": 0.2},
            {"Chest": 0.55, "Head": 0.45},
            {"Chest": 0.25, "Head": 0.75},
            {"Head": 1.0},
        ],
        armature=rig,
        bevel=0.006,
    )
    cowl_subdivision = cowl.modifiers.new("ClothSurface", "SUBSURF")
    cowl_subdivision.levels = 1
    cowl_subdivision.render_levels = 1

    for index, (z, radius, depth) in enumerate(
        ((1.78, 0.285, 0.026), (1.89, 0.278, 0.022), (1.98, 0.225, 0.018))
    ):
        fold = add_torus(
            f"CowlFold{index}",
            (0, -0.012 - index * 0.008, z),
            radius,
            depth,
            cloth if index != 1 else cloth_blue,
        )
        fold.scale.y = 0.72
        bpy.context.view_layer.objects.active = fold
        fold.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rigid_bind(fold, rig, "Chest" if index < 2 else "Head")

    tabard_points = [
        (-0.17, 1.28),
        (0.17, 1.28),
        (0.145, 0.42),
        (0.0, 0.23),
        (-0.145, 0.42),
    ]
    tabard = extruded_panel(
        "ChronoTabard",
        tabard_points,
        -0.245,
        0.045,
        cloth_blue,
        bevel=0.012,
    )
    rigid_bind(tabard, rig, "Hips")
    tabard_trim = curve_tube(
        "ChronoTabardTrim",
        [(x, -0.274, z) for x, z in tabard_points + [tabard_points[0]]],
        gold,
        radius=0.009,
    )
    rigid_bind(tabard_trim, rig, "Hips")
    tabard_clock = add_torus(
        "TabardClockSigil",
        (0, -0.292, 0.72),
        0.105,
        0.014,
        gold,
        rotation=(3.141592653589793 / 2, 0, 0),
    )
    rigid_bind(tabard_clock, rig, "Hips")
    for angle in (0, 3.141592653589793 / 2):
        hand = curve_tube(
            f"TabardClockHand{angle:.2f}",
            [
                (0, -0.31, 0.72),
                (
                    0.072 if angle == 0 else 0,
                    -0.31,
                    0.72 if angle == 0 else 0.792,
                ),
            ],
            cyan if angle == 0 else gold,
            radius=0.006,
        )
        rigid_bind(hand, rig, "Hips")

    for side, sign in (("L", 1), ("R", -1)):
        strap = curve_tube(
            f"ChestHarness.{side}",
            [
                (0.28 * sign, -0.272, 1.7),
                (0.16 * sign, -0.29, 1.51),
                (0.05 * sign, -0.287, 1.3),
            ],
            gold,
            radius=0.011,
        )
        rigid_bind(strap, rig, "Chest")
        collar = extruded_panel(
            f"RaisedCollar.{side}",
            [
                (0.035 * sign, 1.78),
                (0.17 * sign, 1.84),
                (0.24 * sign, 1.73),
                (0.12 * sign, 1.68),
            ],
            -0.22,
            0.06,
            armour,
            bevel=0.012,
        )
        rigid_bind(collar, rig, "Chest")

    hood = bpy.data.objects.get("SculptedChronoHood")
    if hood is not None:
        subdivision = hood.modifiers.new("SculptedClothSurface", "SUBSURF")
        subdivision.levels = 1
        subdivision.render_levels = 1


def consolidate_costume_meshes(rig, human):
    """Bake costume modifiers and merge pieces to reduce browser draw calls."""

    costume = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj != human and obj.find_armature() == rig
    ]
    if not costume:
        raise RuntimeError("No skinned costume meshes were created")

    for obj in costume:
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in costume:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = costume[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = "ChronoDuelistCostume"
    merged.data.name = "ChronoDuelistCostumeMesh"
    merged.parent = rig
    modifier = merged.modifiers.new("ChronoDuelistDeform", "ARMATURE")
    modifier.object = rig
    limit_vertex_influences(merged)
    return merged


def main() -> None:
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0

    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    materials_only = "--materials-only" in sys.argv[separator + 1 :]
    if materials_only:
        rig = refresh_baked_hero_source()
        bpy.context.scene["asset_name"] = "Chrono Duelist Custom"
        bpy.context.scene["source_reference"] = "chrono-duelist-turnaround-v2.png"
        bpy.context.scene["body_topology"] = "MPFB2 2.0.17 CC0"
        bpy.context.scene["animation_clips"] = "Idle,Run,Attack,Dash,Hit,FutureSlash"
        bpy.context.scene["pipeline"] = "mpfb-game-rig-custom-armour-pbr"
        source_path = SOURCE_DIR / CUSTOM_SOURCE_NAME
        model_path = MODEL_DIR / CUSTOM_MODEL_NAME
        bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
        export_glb(model_path, animations=True)
        add_preview_stage(rig, "chrono-duelist-idle.png")
        print(
            "MPFB_CUSTOM_HERO_READY "
            f"source={source_path} model={model_path} "
            f"bones={len(rig.data.bones)} mode=baked-material-refresh",
            flush=True,
        )
        return

    try:
        human, rig = create_mpfb_character()
    except RuntimeError as error:
        if "MPFB2 is not enabled" not in str(error):
            raise
        rig = refresh_baked_hero_source()
        bpy.context.scene["asset_name"] = "Chrono Duelist Custom"
        bpy.context.scene["source_reference"] = "chrono-duelist-turnaround-v2.png"
        bpy.context.scene["body_topology"] = "MPFB2 2.0.17 CC0"
        bpy.context.scene["animation_clips"] = "Idle,Run,Attack,Dash,Hit,FutureSlash"
        bpy.context.scene["pipeline"] = "mpfb-game-rig-custom-armour-pbr"
        source_path = SOURCE_DIR / CUSTOM_SOURCE_NAME
        model_path = MODEL_DIR / CUSTOM_MODEL_NAME
        bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
        export_glb(model_path, animations=True)
        add_preview_stage(rig, "chrono-duelist-idle.png")
        print(
            "MPFB_CUSTOM_HERO_READY "
            f"source={source_path} model={model_path} "
            f"bones={len(rig.data.bones)} mode=baked-material-refresh",
            flush=True,
        )
        return

    human = bake_visible_human(human, rig)
    rename_deformation_bones(human, rig)

    geometry = create_custom_geometry(rig)
    remove_procedural_body_shell()
    align_armour_to_human_rig(rig, human)
    apply_human_material(human, geometry["materials"])
    limit_vertex_influences(human)
    add_final_costume_layers(rig, geometry["materials"])
    unwrap_character_meshes()
    costume = consolidate_costume_meshes(rig, human)
    create_hero_actions(rig, world_spin=True)

    bpy.context.scene["asset_name"] = "Chrono Duelist Custom"
    bpy.context.scene["source_reference"] = "chrono-duelist-turnaround-v2.png"
    bpy.context.scene["body_topology"] = "MPFB2 2.0.17 CC0"
    bpy.context.scene["animation_clips"] = "Idle,Run,Attack,Dash,Hit,FutureSlash"
    bpy.context.scene["pipeline"] = "mpfb-game-rig-custom-armour-pbr"

    source_path = SOURCE_DIR / CUSTOM_SOURCE_NAME
    model_path = MODEL_DIR / CUSTOM_MODEL_NAME
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    export_glb(model_path, animations=True)
    add_preview_stage(rig, "chrono-duelist-idle.png")
    print(
        "MPFB_CUSTOM_HERO_READY "
        f"source={source_path} model={model_path} "
        f"body_vertices={len(human.data.vertices)} "
        f"costume_vertices={len(costume.data.vertices)} bones={len(rig.data.bones)}"
    )


if __name__ == "__main__":
    main()
