"""Render key animation poses from an opened Chrono Duelist source blend."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
PREVIEW_DIR = ROOT / "screenshots" / "model-review"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SCRIPT_DIR))
from build_custom_hero import add_preview_stage  # noqa: E402


def main() -> None:
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one hero armature, got {len(armatures)}")
    rig = armatures[0]
    add_preview_stage(rig, "chrono-duelist-idle.png")

    poses = {
        "run": ("Run", 7),
        "attack": ("Attack", 10),
        "future-slash": ("FutureSlash", 11),
    }
    for label, (action_name, frame) in poses.items():
        action = bpy.data.actions.get(action_name)
        if action is None:
            raise RuntimeError(f"Missing action: {action_name}")
        rig.animation_data.action = action
        bpy.context.scene.frame_set(frame)
        output = PREVIEW_DIR / f"chrono-duelist-{label}.png"
        bpy.context.scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        print(f"MOTION_PREVIEW_OK action={action_name} frame={frame} output={output}")


if __name__ == "__main__":
    main()
