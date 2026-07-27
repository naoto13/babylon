"""Render idle and attack review poses for the high-detail enemy assets."""

from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
OUTPUT_DIR = ROOT / "screenshots" / "model-review" / "enemies-hd"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

KINDS = ("chaser", "shooter", "thief", "boss")


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.5,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    return mat


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


def add_stage(kind: str) -> None:
    scene = bpy.context.scene
    engine_ids = {
        item.identifier
        for item in scene.render.bl_rna.properties["engine"].enum_items
    }
    scene.render.engine = (
        "BLENDER_EEVEE_NEXT"
        if "BLENDER_EEVEE_NEXT" in engine_ids
        else "BLENDER_EEVEE"
    )
    scene.render.resolution_x = 760
    scene.render.resolution_y = 820
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.004, 0.008, 0.019)

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=96,
        radius=2.45 if kind == "boss" else 1.85,
        depth=0.12,
        location=(0, 0, -0.08),
    )
    floor = bpy.context.object
    floor.name = "EnemyPreviewPlinth"
    floor.data.materials.append(
        material(
            "EnemyPreviewPlinthMaterial",
            (0.012, 0.019, 0.035, 1.0),
            metallic=0.48,
            roughness=0.31,
        )
    )

    scale = 1.2 if kind == "boss" else 1.0
    target = Vector((0.0, 0.0, 1.05 * scale))
    camera_data = bpy.data.cameras.new("EnemyPreviewCamera")
    camera = bpy.data.objects.new("EnemyPreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (3.9 * scale, -6.3 * scale, 3.25 * scale)
    camera.data.lens = 66
    look_at(camera, target)
    scene.camera = camera

    add_area_light(
        "EnemyPreviewKey",
        (-3.4 * scale, -4.0 * scale, 5.8 * scale),
        770,
        (1.0, 0.55, 0.29),
        4.0 * scale,
        target,
    )
    add_area_light(
        "EnemyPreviewFill",
        (3.2 * scale, -1.0 * scale, 4.2 * scale),
        510,
        (0.12, 0.53, 1.0),
        3.2 * scale,
        target,
    )
    add_area_light(
        "EnemyPreviewRim",
        (-2.2 * scale, 3.0 * scale, 4.5 * scale),
        850,
        (0.06, 0.83, 1.0),
        2.3 * scale,
        target,
    )


def render_pose(kind: str, action_name: str, frame: int, label: str) -> None:
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
    output = OUTPUT_DIR / f"enemy-{kind}-hd-{label}.png"
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    print(
        f"ENEMY_PREVIEW_OK kind={kind} action={action_name} "
        f"frame={frame} output={output}"
    )


def main() -> None:
    for kind in KINDS:
        source = SOURCE_DIR / f"enemy-{kind}-hd.blend"
        if not source.is_file():
            raise RuntimeError(f"Missing source blend: {source}")
        bpy.ops.wm.open_mainfile(filepath=str(source))
        add_stage(kind)
        render_pose(kind, "Idle", 13, "idle")
        render_pose(kind, "Attack", 10, "attack")
    print(f"ENEMY_PREVIEWS_READY output={OUTPUT_DIR}")


if __name__ == "__main__":
    main()
