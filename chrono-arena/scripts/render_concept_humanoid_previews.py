"""Render the production concept humanoid enemies for model review."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
OUTPUT_DIR = ROOT / "screenshots" / "model-review" / "enemies-concept"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
KINDS = ("shooter", "thief", "boss")

sys.path.insert(0, str(SCRIPT_DIR))
from render_enemy_previews import add_stage  # noqa: E402


def tune_concept_review_stage() -> None:
    """Use neutral studio lighting so dark forged surfaces remain reviewable."""

    scene = bpy.context.scene
    scene.world.color = (0.025, 0.025, 0.03)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.55
    key = bpy.data.lights.get("EnemyPreviewKey")
    fill = bpy.data.lights.get("EnemyPreviewFill")
    rim = bpy.data.lights.get("EnemyPreviewRim")
    if key:
        key.energy = 1150
        key.color = (1.0, 0.83, 0.68)
    if fill:
        fill.energy = 820
        fill.color = (0.42, 0.62, 1.0)
    if rim:
        rim.energy = 980
        rim.color = (0.22, 0.72, 1.0)


def render(kind: str, action_name: str, frame: int, label: str) -> None:
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"{kind}: expected one armature, got {len(rigs)}")
    rig = rigs[0]
    action = bpy.data.actions.get(action_name)
    if action is None:
        raise RuntimeError(f"{kind}: missing action {action_name}")
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    output = OUTPUT_DIR / f"enemy-{kind}-concept-{label}.png"
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    print(
        f"CONCEPT_HUMANOID_PREVIEW_OK kind={kind} action={action_name} "
        f"frame={frame} output={output}",
        flush=True,
    )


def main() -> None:
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    kinds = tuple(sys.argv[separator + 1 :]) or KINDS
    for kind in kinds:
        source = SOURCE_DIR / f"enemy-{kind}-concept.blend"
        if not source.is_file():
            raise RuntimeError(f"Missing production source: {source}")
        bpy.ops.wm.open_mainfile(filepath=str(source))
        add_stage(kind)
        tune_concept_review_stage()
        render(kind, "Idle", 13, "idle")
        render(kind, "Attack", 10, "attack")
    print(f"CONCEPT_HUMANOID_PREVIEWS_READY kinds={','.join(kinds)}")


if __name__ == "__main__":
    main()
