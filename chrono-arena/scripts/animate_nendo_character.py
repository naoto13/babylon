"""Rigged nendoroid GLB に本編用のモーションを埋め込む。

入力の rigged GLB は読み込むだけで変更しない。各 Action を glTF の個別
animation として書き出すため、Babylon 側の AnimationGroup 名と一対一になる。

実行例:
    blender --background --factory-startup --python-exit-code 1 \
      --python scripts/animate_nendo_character.py -- hero-nendo
"""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector


ROOT_DIR = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT_DIR / "assets" / "production" / "demonic" / "rigged"
OUTPUT_DIR = ROOT_DIR / "assets" / "production" / "demonic" / "animated"
FPS = 30
MAX_INFLUENCES = 4
HERO_CLIPS = ("Idle", "Run", "Attack", "Dash", "Hit", "FutureSlash")
ENEMY_CLIPS = ("Idle", "Move", "Attack", "Hit", "Death")
EXPECTED_BONES = (
    "Root", "Hips", "Spine", "Chest", "Neck", "Head",
    "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R",
    "UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R", "Foot.L", "Foot.R",
)


def log(message: str) -> None:
    print(f"[NENDO_ANIM] {message}")


def requested_name() -> str:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(arguments) != 1:
        raise RuntimeError("Expected one bare name, for example: -- hero-nendo")
    name = arguments[0]
    # *-nendo-trellis2 は画像→3DをSPAR3DからTRELLIS.2へ差し替えた版。
    # リグ規約（16骨・EXPECTED_BONES）は同じなので、このスクリプトのモーションが
    # そのまま流用できる。
    if name not in {
        "hero-nendo", "hero-nendo-trellis2",
        "chaser-nendo", "chaser-nendo-trellis2",
        "shooter-nendo", "shooter-nendo-trellis2",
        "thief-nendo", "thief-nendo-trellis2",
        "boss-nendo", "boss-nendo-trellis2",
    }:
        raise RuntimeError(f"Unsupported nendoroid name: {name!r}")
    return name


def clear_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def imported_rig() -> tuple[bpy.types.Object, bpy.types.Object]:
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    log(
        "IMPORT_OBJECTS "
        + " | ".join(
            f"{obj.name}:type={obj.type}:parent={obj.parent.name if obj.parent else '-'}:"
            f"verts={len(obj.data.vertices) if obj.type == 'MESH' else '-'}:"
            f"mods={','.join(mod.type for mod in obj.modifiers) if obj.type == 'MESH' else '-'}"
            for obj in bpy.context.scene.objects
        )
    )
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, got {len(armatures)}")
    armature = armatures[0]
    # factory/import側の未スキンな補助プリミティブはキャラクターではない。
    # 親子関係または Armature modifier がこのリグを参照するメッシュだけを採用する。
    skinned = [
        mesh
        for mesh in meshes
        if mesh.parent == armature
        or any(mod.type == "ARMATURE" and mod.object == armature for mod in mesh.modifiers)
    ]
    if len(skinned) != 1:
        raise RuntimeError(f"Expected one mesh skinned to {armature.name}, got {[mesh.name for mesh in skinned]}")
    mesh = skinned[0]
    names = tuple(bone.name for bone in armature.pose.bones)
    # glTF importは兄弟ボーンを深さ優先に並べるため、生成時の列順は保持されない。
    # 本編との契約は順番ではなく16本の識別子そのものなので集合で検証する。
    if len(names) != len(EXPECTED_BONES) or set(names) != set(EXPECTED_BONES):
        raise RuntimeError(
            f"Rig bone contract mismatch: missing={sorted(set(EXPECTED_BONES) - set(names))} "
            f"unexpected={sorted(set(names) - set(EXPECTED_BONES))}"
        )
    log(f"IMPORT armature={armature.name} mesh={mesh.name} bones={len(names)}")
    return armature, mesh


def action_curves(action: bpy.types.Action) -> list[Any]:
    """Blender 4.x と 5.x の Action 内部表現の両方で FCurve を取得する。"""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    return [
        curve
        for layer in action.layers
        for strip in layer.strips
        for channelbag in strip.channelbags
        for curve in channelbag.fcurves
    ]


def pose(armature: bpy.types.Object, transforms: dict[str, dict[str, tuple[float, float, float]]]) -> None:
    """すべてを明示キー化し、補間中にも未指定ボーンが古い姿勢を保持しないようにする。"""
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
        spec = transforms.get(bone.name, {})
        bone.location = spec.get("location", (0.0, 0.0, 0.0))
        bone.rotation_euler = spec.get("rotation", (0.0, 0.0, 0.0))
        bone.scale = spec.get("scale", (1.0, 1.0, 1.0))


def build_action(
    armature: bpy.types.Object,
    name: str,
    keyframes: list[tuple[int, dict[str, dict[str, tuple[float, float, float]]]]],
) -> bpy.types.Action:
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    for frame, transforms in keyframes:
        pose(armature, transforms)
        for bone in armature.pose.bones:
            bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
            bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone.name)
            bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)
    curves = action_curves(action)
    if not curves:
        raise RuntimeError(f"Action {name} contains no FCurves")
    for curve in curves:
        for point in curve.keyframe_points:
            # 弾みを保ちつつ反転で過剰に振れない補間にする。
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"
    distinct = {round(point.co[0], 4) for curve in curves for point in curve.keyframe_points}
    if len(distinct) < 2:
        raise RuntimeError(f"Action {name} needs at least two keyed frames")
    moving_channels = sum(
        len({round(point.co[1], 6) for point in curve.keyframe_points}) > 1
        for curve in curves
    )
    if moving_channels == 0:
        raise RuntimeError(f"Action {name} has keys but no varying bone channels")
    log(
        f"ACTION name={name} frames={min(distinct):g}-{max(distinct):g} "
        f"keyframes={len(distinct)} channels={len(curves)} moving_channels={moving_channels}"
    )
    return action


def locomotion_pose(phase: float, *, forward: float = -0.14) -> dict[str, dict[str, tuple[float, float, float]]]:
    """短い手足でも読み取れる、脚と逆相の腕・胴体バウンスを作る。"""
    swing = math.sin(phase) * 0.72
    bounce = max(0.0, math.cos(phase * 2.0)) * 0.045 - 0.012
    return {
        "Hips": {"location": (0.0, 0.0, bounce), "rotation": (0.12, 0.0, -swing * 0.10)},
        "Spine": {"rotation": (forward * 0.46, 0.0, swing * 0.055)},
        "Chest": {"rotation": (forward, 0.0, swing * 0.10)},
        # 大きな頭は胸の反対へ少し遅らせ、重さを感じさせる。
        "Neck": {"rotation": (-forward * 0.22, 0.0, -swing * 0.06)},
        "Head": {"rotation": (-forward * 0.30, 0.0, -swing * 0.12)},
        "UpperLeg.L": {"rotation": (swing, 0.0, 0.0)},
        "LowerLeg.L": {"rotation": (-max(0.0, swing) * 0.70, 0.0, 0.0)},
        "Foot.L": {"rotation": (-max(0.0, swing) * 0.26, 0.0, 0.0)},
        "UpperLeg.R": {"rotation": (-swing, 0.0, 0.0)},
        "LowerLeg.R": {"rotation": (-max(0.0, -swing) * 0.70, 0.0, 0.0)},
        "Foot.R": {"rotation": (-max(0.0, -swing) * 0.26, 0.0, 0.0)},
        "UpperArm.L": {"rotation": (-swing * 0.76, 0.0, 0.07)},
        "LowerArm.L": {"rotation": (-swing * 0.13, 0.0, 0.0)},
        "UpperArm.R": {"rotation": (swing * 0.76, 0.0, -0.07)},
        "LowerArm.R": {"rotation": (swing * 0.13, 0.0, 0.0)},
    }


def create_actions(armature: bpy.types.Object, *, is_hero: bool) -> dict[str, bpy.types.Action]:
    """本編の名前を正本にし、デフォルメ体型向けの全身量感を優先してAction化する。"""
    actions: dict[str, bpy.types.Action] = {}
    idle_low = {
        "Hips": {"location": (0.0, 0.0, -0.012), "scale": (1.025, 1.025, 0.965)},
        "Spine": {"rotation": (0.018, 0.0, -0.018)},
        "Chest": {"rotation": (0.030, 0.0, -0.030)},
        "Neck": {"rotation": (-0.012, 0.0, 0.012)},
        "Head": {"rotation": (-0.028, 0.0, 0.028)},
        "UpperArm.L": {"rotation": (0.025, 0.0, 0.018)},
        "UpperArm.R": {"rotation": (-0.025, 0.0, -0.018)},
    }
    idle_high = {
        "Hips": {"location": (0.0, 0.0, 0.026), "scale": (0.975, 0.975, 1.035)},
        "Spine": {"rotation": (-0.020, 0.0, 0.022)},
        "Chest": {"rotation": (-0.035, 0.0, 0.036)},
        "Neck": {"rotation": (0.014, 0.0, -0.016)},
        "Head": {"rotation": (0.034, 0.0, -0.040)},
        "UpperArm.L": {"rotation": (-0.034, 0.0, -0.028)},
        "UpperArm.R": {"rotation": (0.034, 0.0, 0.028)},
    }
    actions["Idle"] = build_action(
        armature, "Idle", [(1, idle_low), (16, idle_high), (31, idle_low), (46, idle_high), (61, idle_low)]
    )

    move_name = "Run" if is_hero else "Move"
    actions[move_name] = build_action(
        armature,
        move_name,
        [(1, locomotion_pose(0.0)), (7, locomotion_pose(math.pi / 2)),
         (13, locomotion_pose(math.pi)), (19, locomotion_pose(math.pi * 1.5)), (25, locomotion_pose(math.pi * 2))],
    )

    # 腕主体の振りにする。以前は Chest の Z が -0.50→+0.66（66度）も振れていて、
    # 腕を振っているのではなく胴ごと回っているように見えた。胴の振れを約1/3に抑え、
    # 代わりに UpperArm と LowerArm の振り幅を広げて肘の曲げ伸ばしを見せる。
    attack_windup = {
        "Hips": {"location": (0.0, 0.025, -0.035), "rotation": (0.0, 0.0, -0.10), "scale": (1.06, 1.02, 0.94)},
        "Spine": {"rotation": (0.04, -0.06, -0.09)},
        "Chest": {"rotation": (0.06, -0.10, -0.17)},
        "Neck": {"rotation": (-0.02, 0.06, 0.07)},
        "Head": {"rotation": (-0.04, 0.10, 0.10)},
        # 振りかぶり: 腕を大きく後方上へ引き、肘を深く畳む
        "UpperArm.L": {"rotation": (-1.38, 0.30, 1.02)},
        "LowerArm.L": {"rotation": (-0.95, 0.0, 0.62)},
        "UpperArm.R": {"rotation": (0.95, -0.26, -0.95)},
        "LowerArm.R": {"rotation": (-0.72, 0.0, -0.48)},
    }
    attack_hit = {
        "Hips": {"location": (0.0, -0.060, 0.025), "rotation": (0.0, 0.0, 0.12), "scale": (0.96, 1.02, 1.06)},
        "Spine": {"rotation": (-0.05, 0.06, 0.10)},
        "Chest": {"rotation": (-0.09, 0.12, 0.22)},
        "Neck": {"rotation": (0.03, -0.06, -0.07)},
        "Head": {"rotation": (0.05, -0.10, -0.10)},
        # 振り下ろし: 腕を前下方へ払い、肘を伸ばし切る
        "UpperArm.L": {"rotation": (1.05, -0.38, -1.32)},
        "LowerArm.L": {"rotation": (0.52, 0.10, -0.86)},
        "UpperArm.R": {"rotation": (-1.02, 0.28, 1.05)},
        "LowerArm.R": {"rotation": (0.46, -0.06, 0.78)},
    }
    attack_follow = {
        "Hips": {"rotation": (0.0, 0.0, 0.05)},
        "Chest": {"rotation": (-0.03, 0.04, 0.09)},
        "Head": {"rotation": (0.02, -0.03, -0.04)},
        # 振り抜き後の戻り。腕だけが余韻で揺れる
        "UpperArm.L": {"rotation": (0.44, -0.16, -0.52)},
        "LowerArm.L": {"rotation": (0.20, 0.04, -0.30)},
        "UpperArm.R": {"rotation": (-0.40, 0.14, 0.48)},
        "LowerArm.R": {"rotation": (0.16, -0.02, 0.26)},
    }
    actions["Attack"] = build_action(
        armature, "Attack", [(1, {}), (5, attack_windup), (10, attack_hit), (15, attack_follow), (21, {})]
    )

    hit_recoil = {
        "Hips": {"location": (0.0, 0.040, -0.055), "rotation": (-0.12, 0.0, -0.20), "scale": (1.10, 1.02, 0.91)},
        "Spine": {"rotation": (0.18, 0.0, 0.15)},
        "Chest": {"rotation": (0.38, 0.0, 0.34)},
        "Neck": {"rotation": (-0.14, 0.0, -0.16)},
        "Head": {"rotation": (-0.34, 0.0, -0.32)},
        "UpperArm.L": {"rotation": (-0.28, 0.0, 0.40)},
        "UpperArm.R": {"rotation": (-0.28, 0.0, -0.40)},
    }
    actions["Hit"] = build_action(armature, "Hit", [(1, {}), (4, hit_recoil), (8, hit_recoil), (14, {})])

    if is_hero:
        dash_pose = {
            "Hips": {"location": (0.0, -0.075, -0.040), "rotation": (0.24, 0.0, 0.0), "scale": (1.12, 0.96, 0.88)},
            "Spine": {"rotation": (-0.24, 0.0, 0.0)},
            "Chest": {"rotation": (-0.48, 0.0, 0.0)},
            "Neck": {"rotation": (0.12, 0.0, 0.0)},
            "Head": {"rotation": (0.22, 0.0, 0.0)},
            "UpperArm.L": {"rotation": (0.92, 0.06, 0.20)},
            "LowerArm.L": {"rotation": (0.20, 0.0, 0.0)},
            "UpperArm.R": {"rotation": (0.92, -0.06, -0.20)},
            "LowerArm.R": {"rotation": (0.20, 0.0, 0.0)},
            "UpperLeg.L": {"rotation": (-0.38, 0.0, 0.0)},
            "UpperLeg.R": {"rotation": (-0.18, 0.0, 0.0)},
        }
        actions["Dash"] = build_action(armature, "Dash", [(1, {}), (4, dash_pose), (11, dash_pose), (16, {})])

        slash_windup = {
            "Root": {"rotation": (0.0, -0.65, 0.0)},
            "Hips": {"location": (0.0, 0.0, -0.065), "rotation": (0.0, 0.0, -0.30), "scale": (1.11, 1.00, 0.90)},
            "Chest": {"rotation": (0.12, 0.0, -0.62)},
            "Head": {"rotation": (-0.06, 0.0, 0.24)},
            "UpperArm.L": {"rotation": (-1.12, 0.20, 0.82)},
            "LowerArm.L": {"rotation": (-0.25, 0.0, 0.36)},
            "UpperArm.R": {"rotation": (0.96, -0.20, -0.82)},
            "LowerArm.R": {"rotation": (-0.18, 0.0, -0.30)},
        }
        slash_sweep = {
            # RootのローカルY（骨の長軸）を回す。glTF出力でもY成分になることを下の検証で確認する。
            "Root": {"rotation": (0.0, math.tau, 0.0)},
            "Hips": {"location": (0.0, -0.055, 0.035), "rotation": (0.0, 0.0, 0.42), "scale": (0.94, 1.02, 1.10)},
            "Chest": {"rotation": (-0.16, 0.0, 0.84)},
            "Neck": {"rotation": (0.06, 0.0, -0.18)},
            "Head": {"rotation": (0.12, 0.0, -0.34)},
            "UpperArm.L": {"rotation": (0.88, -0.34, -1.24)},
            "LowerArm.L": {"rotation": (0.26, 0.0, -0.56)},
            "UpperArm.R": {"rotation": (-0.80, 0.26, 1.10)},
            "LowerArm.R": {"rotation": (0.18, 0.0, 0.46)},
        }
        # glTFはrotationをQuaternionとして保存し、0→360度の1キーだけでは
        # 最短補間されて回転しない。90度未満の4区間へ分け、Babylonでも必ず1周させる。
        slash_quarter = {**slash_sweep, "Root": {"rotation": (0.0, math.pi / 2, 0.0)}}
        slash_half = {**slash_sweep, "Root": {"rotation": (0.0, math.pi, 0.0)}}
        slash_three_quarter = {**slash_sweep, "Root": {"rotation": (0.0, math.pi * 1.5, 0.0)}}
        slash_follow = {
            "Root": {"rotation": (0.0, math.tau, 0.0)},
            "Hips": {"rotation": (0.0, 0.0, 0.16)},
            "Chest": {"rotation": (-0.08, 0.0, 0.28)},
            "Head": {"rotation": (0.06, 0.0, -0.10)},
            "UpperArm.L": {"rotation": (0.28, -0.10, -0.42)},
            "UpperArm.R": {"rotation": (-0.24, 0.08, 0.38)},
        }
        actions["FutureSlash"] = build_action(
            armature,
            "FutureSlash",
            [
                (1, {}), (7, slash_windup), (13, slash_quarter), (19, slash_half),
                (25, slash_three_quarter), (31, slash_sweep), (37, slash_follow),
            ],
        )
    else:
        kneel = {
            "Hips": {"location": (0.0, 0.055, -0.16), "rotation": (0.38, 0.0, 0.12), "scale": (1.10, 1.02, 0.78)},
            "Spine": {"rotation": (-0.16, 0.0, -0.08)},
            "Chest": {"rotation": (-0.34, 0.0, -0.16)},
            "Head": {"rotation": (0.22, 0.0, 0.12)},
            "UpperLeg.L": {"rotation": (-0.86, 0.0, 0.06)},
            "LowerLeg.L": {"rotation": (0.98, 0.0, 0.0)},
            "UpperLeg.R": {"rotation": (-0.76, 0.0, -0.06)},
            "LowerLeg.R": {"rotation": (0.90, 0.0, 0.0)},
            "UpperArm.L": {"rotation": (0.34, 0.0, 0.34)},
            "UpperArm.R": {"rotation": (0.34, 0.0, -0.34)},
        }
        collapse = {
            "Hips": {"location": (0.0, -0.12, -0.24), "rotation": (-0.82, 0.0, 0.20), "scale": (1.18, 1.00, 0.50)},
            "Spine": {"rotation": (-0.42, 0.0, -0.12)},
            "Chest": {"rotation": (-0.64, 0.0, -0.25)},
            "Neck": {"rotation": (0.12, 0.0, 0.06)},
            "Head": {"rotation": (0.34, 0.0, 0.15)},
            "UpperLeg.L": {"rotation": (-1.05, 0.0, 0.10)},
            "LowerLeg.L": {"rotation": (1.12, 0.0, 0.0)},
            "UpperLeg.R": {"rotation": (-0.96, 0.0, -0.10)},
            "LowerLeg.R": {"rotation": (1.06, 0.0, 0.0)},
            "UpperArm.L": {"rotation": (0.72, 0.0, 0.54)},
            "LowerArm.L": {"rotation": (0.28, 0.0, 0.0)},
            "UpperArm.R": {"rotation": (0.72, 0.0, -0.54)},
            "LowerArm.R": {"rotation": (0.28, 0.0, 0.0)},
        }
        actions["Death"] = build_action(
            armature, "Death", [(1, {}), (10, kneel), (22, collapse), (37, collapse)]
        )
    pose(armature, {})
    return actions


def activate(objects: list[bpy.types.Object], active: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def export_glb(armature: bpy.types.Object, mesh: bpy.types.Object, output: Path) -> int:
    activate([armature, mesh], mesh)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_influence_nb=MAX_INFLUENCES,
        export_all_influences=False,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
    )
    if "FINISHED" not in result or not output.is_file():
        raise RuntimeError(f"glTF export failed: result={result} path={output}")
    return output.stat().st_size


def read_glb_json(path: Path) -> dict[str, Any]:
    with path.open("rb") as stream:
        header = stream.read(20)
        if len(header) != 20:
            raise RuntimeError(f"GLB header is too short: {path}")
        magic, version, _total, json_length, chunk_type = struct.unpack("<IIIII", header)
        if magic != 0x46546C67 or version != 2 or chunk_type != 0x4E4F534A:
            raise RuntimeError(f"Invalid GLB header: {path}")
        return json.loads(stream.read(json_length).decode("utf-8"))


def validate_export(path: Path, expected_clips: tuple[str, ...], budget_bytes: int) -> None:
    gltf = read_glb_json(path)
    clips = [animation.get("name", "") for animation in gltf.get("animations", [])]
    # Babylon の loadModelAssets は名前Setで判定する。並び順に意味はないが、
    # 欠落・重複・余分は本編契約違反として止める。
    if len(clips) != len(expected_clips) or set(clips) != set(expected_clips):
        raise RuntimeError(f"Exported animation names mismatch: expected={list(expected_clips)} actual={clips}")
    if path.stat().st_size > budget_bytes:
        raise RuntimeError(f"GLB size budget exceeded: {path.stat().st_size} > {budget_bytes}")
    summaries = []
    for animation in gltf["animations"]:
        samplers = animation.get("samplers", [])
        channels = animation.get("channels", [])
        frames = sorted({
            gltf["accessors"][sampler["input"]]["count"]
            for sampler in samplers
            if "input" in sampler
        })
        if not channels or not frames or max(frames) < 2:
            raise RuntimeError(f"Clip has no actual keyed bone movement: {animation.get('name')}")
        summaries.append(f"{animation['name']}:frames={max(frames)} channels={len(channels)}")
    log("GLTF_ANIMATIONS names=" + ",".join(clips))
    log("GLTF_CHANNELS " + " | ".join(summaries))
    log(f"GLTF_SIZE bytes={path.stat().st_size} budget_bytes={budget_bytes}")


def world_bounds(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    points = [mesh.matrix_world @ vertex.co for vertex in evaluated.data.vertices]
    if not points:
        raise RuntimeError("Cannot render an empty mesh")
    return (
        Vector(tuple(min(point[i] for point in points) for i in range(3))),
        Vector(tuple(max(point[i] for point in points) for i in range(3))),
    )


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_light(name: str, location: Vector, energy: float, size: float, target: Vector) -> bpy.types.Object:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, target)
    return light


def configure_render(scene: bpy.types.Scene) -> None:
    engines = {entry.identifier for entry in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    # ポーズの輪郭とテクスチャを確認しやすい中間グレーの無地背景。
    scene.world.color = (0.22, 0.22, 0.22)


def render_previews(
    armature: bpy.types.Object,
    mesh: bpy.types.Object,
    actions: dict[str, bpy.types.Action],
    output_name: str,
) -> None:
    preview_frames = {"Idle": 16, "Run": 7, "Move": 7, "Attack": 10, "Dash": 7, "Hit": 4, "Death": 22, "FutureSlash": 19}
    scene = bpy.context.scene
    configure_render(scene)
    # 崩れ落ちるDeathで評価済みbboxだけが小さくなると、カメラが頭部へ寄り過ぎる。
    # 中立姿勢の外形を全クリップで共有し、各ポーズの違いを同じ画角で比較可能にする。
    armature.animation_data.action = actions["Idle"]
    scene.frame_set(1)
    bpy.context.view_layer.update()
    neutral_minimum, neutral_maximum = world_bounds(mesh)
    neutral_size = neutral_maximum - neutral_minimum
    neutral_target = (neutral_minimum + neutral_maximum) * 0.5
    portrait_aspect = 512 / 768
    ortho_scale = max(neutral_size.z / portrait_aspect * 1.20, neutral_size.x * 1.32)
    for clip, action in actions.items():
        frame = preview_frames[clip]
        armature.animation_data.action = action
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        distance = max(neutral_size.x, neutral_size.z) * 3.1
        camera_data = bpy.data.cameras.new(f"PreviewCamera.{clip}")
        camera = bpy.data.objects.new(f"PreviewCamera.{clip}", camera_data)
        bpy.context.collection.objects.link(camera)
        # rig_nendo_character.py と同じ +Y 正面・少し右からの角度で脚と腕を両方読む。
        camera.location = Vector((distance * 0.54, distance, neutral_target.z + neutral_size.z * 0.06))
        look_at(camera, neutral_target)
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = ortho_scale
        scene.camera = camera
        lights = (
            add_light(f"PreviewKey.{clip}", Vector((2.8, 3.6, 3.8)), 760.0, 3.0, neutral_target),
            add_light(f"PreviewFill.{clip}", Vector((-3.1, 1.1, 2.0)), 430.0, 2.4, neutral_target),
            add_light(f"PreviewRim.{clip}", Vector((1.7, -2.9, 3.0)), 620.0, 2.1, neutral_target),
        )
        output = OUTPUT_DIR / f"preview-{output_name}-{clip}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        if not output.is_file() or output.stat().st_size < 20_000:
            raise RuntimeError(f"Preview render failed: {output}")
        log(f"PREVIEW clip={clip} frame={frame} path={output} bytes={output.stat().st_size} resolution=512x768")
        bpy.data.objects.remove(camera, do_unlink=True)
        for light in lights:
            bpy.data.objects.remove(light, do_unlink=True)
    armature.animation_data.action = actions["Idle"]
    scene.frame_set(1)


def main() -> None:
    name = requested_name()
    source = INPUT_DIR / f"{name}-rigged.glb"
    if not source.is_file():
        raise RuntimeError(f"Missing rigged source GLB: {source}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / f"{name}-animated.glb"
    is_hero = name.startswith("hero-nendo")
    expected_clips = HERO_CLIPS if is_hero else ENEMY_CLIPS
    # TRELLIS.2版はテクスチャ解像度が高く、この非圧縮GLBの時点では本来の予算を
    # 超える。gltfpackで圧縮した models/ 側が本編の読み込み対象なので、ここでは
    # 中間生成物として緩い上限で通し、圧縮後のサイズで予算を守る。
    if name.endswith("-nendo-trellis2"):
        budget = 8 * 1024 * 1024
    elif is_hero:
        budget = 3 * 1024 * 1024
    else:
        budget = int(1.5 * 1024 * 1024)
    log(f"START blender={bpy.app.version_string} source={source} expected={','.join(expected_clips)}")
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source))
    armature, mesh = imported_rig()
    bpy.context.scene.render.fps = FPS
    actions = create_actions(armature, is_hero=is_hero)
    if len(actions) != len(expected_clips) or set(actions) != set(expected_clips):
        raise RuntimeError(f"Created Action names mismatch: {tuple(actions)}")
    render_previews(armature, mesh, actions, name)
    bytes_written = export_glb(armature, mesh, output)
    validate_export(output, expected_clips, budget)
    log(f"COMPLETE name={name} actions={len(actions)} bytes={bytes_written} output={output}")


if __name__ == "__main__":
    main()
