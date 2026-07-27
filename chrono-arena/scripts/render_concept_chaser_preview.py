"""Render the production concept Chaser with the established review stage."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "production" / "blender" / "enemy-chaser-concept.blend"
OUTPUT_DIR = ROOT / "screenshots" / "model-review" / "enemies-concept"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SCRIPT_DIR))
from render_enemy_previews import add_stage, look_at  # noqa: E402


def render(action_name: str, frame: int, label: str) -> None:
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"Expected one armature, got {len(rigs)}")
    rig = rigs[0]
    action = bpy.data.actions.get(action_name)
    if action is None:
        raise RuntimeError(f"Missing action: {action_name}")
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    output = OUTPUT_DIR / f"enemy-chaser-concept-{label}.png"
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    print(
        f"CONCEPT_CHASER_PREVIEW_OK action={action_name} "
        f"frame={frame} output={output}"
    )


def set_camera(location: tuple[float, float, float], target=(0.0, 0.0, 0.72)) -> None:
    camera = bpy.context.scene.camera
    if camera is None:
        raise RuntimeError("Preview camera is missing")
    camera.location = location
    look_at(camera, Vector(target))


def main() -> None:
    if not SOURCE.is_file():
        raise RuntimeError(f"Missing production blend: {SOURCE}")
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    add_stage("chaser")
    set_camera((3.9, -6.3, 3.25))
    render("Idle", 13, "idle")
    render("Attack", 10, "attack")
    set_camera((6.4, 0.0, 2.35), target=(0.0, 0.03, 0.68))
    render("Idle", 13, "side")
    set_camera((4.3, -5.2, 6.1), target=(0.0, 0.0, 0.45))
    render("Idle", 13, "gameplay")
    print(f"CONCEPT_CHASER_PREVIEWS_READY output={OUTPUT_DIR}")


if __name__ == "__main__":
    main()
