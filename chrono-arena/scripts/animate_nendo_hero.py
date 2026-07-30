"""Add the six game-required animation clips to a rigged nendoroid GLB.

Run from the repository root:

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/animate_nendo_hero.py -- hero-nendo-trellis2

Reads ``assets/production/demonic/rigged/<name>-rigged.glb`` (the static
skinned output of ``rig_nendo_character.py``) and writes
``assets/production/demonic/rigged/<name>-animated.glb`` with Idle, Run,
Attack, Dash, Hit and FutureSlash actions baked in, matching the clip names
``chrono-arena/src/main.js``'s ``loadModelAssets()`` requires.

The pose keyframes below are adapted from ``build_blender_assets.py``'s
``create_hero_actions`` (written for the 55-bone MPFB hero rig). The 16-bone
nendoroid rig (see ``rig_nendo_character.py``) happens to share the same
bone names for torso/head/arms/legs (Hips, Chest, Head, UpperArm.L/R,
LowerArm.L/R, UpperLeg.L/R, LowerLeg.L/R) minus the two Cape bones, so the
same bone-name-keyed pose dicts apply directly -- only the rotation
magnitudes are retuned here for the nendoroid's much shorter, stubbier limb
segments (the original values, tuned for adult human proportions, over-rotate
a 2.5-head-tall body).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

ROOT_DIR = Path(__file__).resolve().parents[1]
RIGGED_DIR = ROOT_DIR / "assets" / "production" / "demonic" / "rigged"
ANIMATION_CLIPS = ("Idle", "Run", "Attack", "Dash", "Hit", "FutureSlash")


def log(message: str) -> None:
    print(f"[NENDO_ANIM] {message}")


def clear_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def find_armature() -> bpy.types.Object:
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected exactly one armature, found {len(armatures)}")
    return armatures[0]


def create_hero_actions(armature: bpy.types.Object) -> None:
    bpy.context.scene.render.fps = 24
    armature.animation_data_create()
    all_bones = [bone.name for bone in armature.pose.bones]

    def build_action(name, frames):
        action = bpy.data.actions.new(name=name)
        action.use_fake_user = True
        armature.animation_data.action = action
        for frame, transforms in frames:
            for bone_name in all_bones:
                bone = armature.pose.bones[bone_name]
                bone.rotation_mode = "XYZ"
                spec = transforms.get(bone_name, {})
                bone.location = spec.get("location", (0, 0, 0))
                bone.rotation_euler = spec.get("rotation", (0, 0, 0))
                bone.scale = spec.get("scale", (1, 1, 1))
                bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)
                bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
                bone.keyframe_insert(data_path="scale", frame=frame, group=bone_name)
        if hasattr(action, "fcurves"):
            curves = action.fcurves
        else:
            curves = [
                curve
                for layer in action.layers
                for strip in layer.strips
                for channelbag in strip.channelbags
                for curve in channelbag.fcurves
            ]
        for curve in curves:
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"
        return action

    # Rotation magnitudes below are roughly half of build_blender_assets.py's
    # human-proportioned original -- the nendoroid's UpperArm/UpperLeg bones
    # are much shorter, so the same radian values would over-rotate the mesh
    # and reopen the stretching artefact seen on the arms-up/elbow test poses.
    idle_low = {
        "Hips": {"location": (0, 0, -0.018)},
        "Chest": {"rotation": (0.02, 0, -0.025)},
    }
    idle_high = {
        "Hips": {"location": (0, 0, 0.025)},
        "Chest": {"rotation": (-0.025, 0, 0.03)},
        "Head": {"rotation": (0.025, 0, -0.018)},
        "UpperArm.L": {"rotation": (0.035, 0, 0.025)},
        "UpperArm.R": {"rotation": (-0.035, 0, -0.025)},
    }
    build_action("Idle", [(1, idle_low), (13, idle_high), (25, idle_low), (37, idle_high), (49, idle_low)])

    # 脚は3セグメント（Upper/Lower/Foot）あり人体比率に近いので、走りの振り幅は
    # build_blender_assets.py の原値をほぼそのまま使う。腕だけ2セグメントで短いため
    # 控えめにする。ここを半分に落としすぎると、ねんどろいど体型の脚が太く短い分
    # 見かけの移動量が小さく、静止と区別できなくなる。
    run_a = {
        "Hips": {"location": (0, 0, 0.035), "rotation": (0.12, 0, -0.05)},
        "Chest": {"rotation": (-0.11, 0, 0.07)},
        "UpperLeg.L": {"rotation": (0.68, 0, 0)},
        "LowerLeg.L": {"rotation": (-0.58, 0, 0)},
        "UpperLeg.R": {"rotation": (-0.62, 0, 0)},
        "LowerLeg.R": {"rotation": (0.28, 0, 0)},
        "UpperArm.L": {"rotation": (-0.38, 0.07, 0.035)},
        "UpperArm.R": {"rotation": (0.42, -0.07, -0.035)},
    }
    run_b = {
        "Hips": {"location": (0, 0, -0.015), "rotation": (0.09, 0, 0.045)},
        "Chest": {"rotation": (-0.09, 0, -0.06)},
        "UpperLeg.L": {"rotation": (-0.62, 0, 0)},
        "LowerLeg.L": {"rotation": (0.28, 0, 0)},
        "UpperLeg.R": {"rotation": (0.68, 0, 0)},
        "LowerLeg.R": {"rotation": (-0.58, 0, 0)},
        "UpperArm.L": {"rotation": (0.42, 0.07, 0.035)},
        "UpperArm.R": {"rotation": (-0.38, -0.07, -0.035)},
    }
    build_action("Run", [(1, run_a), (7, run_b), (13, run_a), (19, run_b), (25, run_a)])

    attack_windup = {
        "Hips": {"rotation": (0, 0, -0.13)},
        "Chest": {"rotation": (0.03, -0.1, -0.28)},
        "Head": {"rotation": (0, 0.07, 0.12)},
        "UpperArm.L": {"rotation": (-0.5, 0.16, 0.32)},
        "LowerArm.L": {"rotation": (-0.2, 0, 0.24)},
        "UpperArm.R": {"rotation": (0.4, -0.13, -0.4)},
        "LowerArm.R": {"rotation": (-0.2, 0, -0.2)},
    }
    attack_contact = {
        "Hips": {"location": (0, -0.04, 0), "rotation": (0, 0, 0.2)},
        "Chest": {"rotation": (-0.07, 0.12, 0.36)},
        "Head": {"rotation": (0, -0.07, -0.14)},
        "UpperArm.L": {"rotation": (0.36, -0.17, -0.46)},
        "LowerArm.L": {"rotation": (0.12, 0.06, -0.22)},
        "UpperArm.R": {"rotation": (-0.42, 0.14, 0.44)},
        "LowerArm.R": {"rotation": (0.1, -0.05, 0.24)},
    }
    attack_follow = {
        "Hips": {"rotation": (0, 0, 0.08)},
        "Chest": {"rotation": (-0.035, 0.045, 0.16)},
        "UpperArm.L": {"rotation": (0.15, -0.07, -0.22)},
        "UpperArm.R": {"rotation": (-0.17, 0.06, 0.24)},
    }
    build_action("Attack", [(1, {}), (5, attack_windup), (10, attack_contact), (15, attack_follow), (22, {})])

    dash_pose = {
        "Hips": {"location": (0, -0.05, -0.025), "rotation": (0.16, 0, 0)},
        "Chest": {"rotation": (-0.24, 0, 0)},
        "Head": {"rotation": (0.1, 0, 0)},
        "UpperArm.L": {"rotation": (0.4, 0.03, 0.12)},
        "UpperArm.R": {"rotation": (0.4, -0.03, -0.12)},
        "UpperLeg.L": {"rotation": (-0.26, 0, 0)},
        "UpperLeg.R": {"rotation": (-0.13, 0, 0)},
    }
    build_action("Dash", [(1, {}), (4, dash_pose), (11, dash_pose), (16, {})])

    hit_pose = {
        "Hips": {"location": (0, 0.035, -0.04), "rotation": (-0.07, 0, -0.09)},
        "Chest": {"rotation": (0.2, 0, 0.18)},
        "Head": {"rotation": (-0.16, 0, -0.1)},
        "UpperArm.L": {"rotation": (-0.18, 0, 0.22)},
        "UpperArm.R": {"rotation": (-0.18, 0, -0.22)},
    }
    build_action("Hit", [(1, {}), (3, hit_pose), (7, hit_pose), (13, {})])

    # FutureSlash spins the whole armature object around world Z (see the
    # world_spin block below), so the Hips-bone Z rotation stays zeroed here
    # and the cape-specific keyframes from the original are simply omitted.
    slash_anticipate = {
        "Hips": {"location": (0, 0, -0.045)},
        "Chest": {"rotation": (0.06, 0, -0.36)},
        "UpperArm.L": {"rotation": (-0.6, 0.11, 0.4)},
        "UpperArm.R": {"rotation": (0.54, -0.11, -0.4)},
    }
    slash_mid = {
        "Hips": {"location": (0, -0.045, 0.03)},
        "Chest": {"rotation": (-0.045, 0, 0.7)},
        "UpperArm.L": {"rotation": (0.24, -0.22, -0.56)},
        "UpperArm.R": {"rotation": (-0.24, 0.22, 0.56)},
    }
    slash_end = {
        "Chest": {"rotation": (0, 0, 0.14)},
        "UpperArm.L": {"rotation": (0.11, -0.06, -0.17)},
        "UpperArm.R": {"rotation": (-0.11, 0.06, 0.17)},
    }
    build_action("FutureSlash", [(1, {}), (5, slash_anticipate), (11, slash_mid), (18, slash_end), (24, {})])
    armature.rotation_mode = "XYZ"
    for frame, angle in ((1, 0), (5, -0.75), (11, 2.5), (18, 2 * math.pi), (24, 2 * math.pi)):
        armature.rotation_euler = (0, 0, angle)
        armature.keyframe_insert(data_path="rotation_euler", frame=frame, group="WorldSpin")

    armature.animation_data.action = bpy.data.actions.get("Idle")
    log(f"ACTIONS created={','.join(ANIMATION_CLIPS)}")


def export_glb(output_path: Path) -> int:
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_influence_nb=4,
        export_morph=False,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
    )
    size = output_path.stat().st_size
    log(f"EXPORT path={output_path} bytes={size}")
    return size


def requested_name() -> str:
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(arguments) != 1:
        raise RuntimeError("Expected exactly one base name, for example: -- hero-nendo-trellis2")
    return arguments[0]


def main() -> None:
    name = requested_name()
    source_path = RIGGED_DIR / f"{name}-rigged.glb"
    if not source_path.is_file():
        raise RuntimeError(f"Missing rigged GLB: {source_path}")
    output_path = RIGGED_DIR / f"{name}-animated.glb"
    log(f"START blender={bpy.app.version_string} source={source_path}")
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    armature = find_armature()
    bone_names = {bone.name for bone in armature.pose.bones}
    log(f"IMPORTED bones={sorted(bone_names)}")
    create_hero_actions(armature)
    export_glb(output_path)
    log(f"COMPLETE name={name} clips={','.join(ANIMATION_CLIPS)} output={output_path}")


if __name__ == "__main__":
    main()
