"""Chrono Arena 用の軽量な反射専用 IBL パノラマを生成する。"""

from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "production" / "env" / "arena-clockwork-ibl.hdr"
ARENA_ART = ROOT / "assets" / "production" / "arena-clockwork.png"


def new_material(name, base, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*base, 1)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if emission:
        principled.inputs["Emission Color"].default_value = (*emission, 1)
        principled.inputs["Emission Strength"].default_value = strength
    return material


def add_torus(name, major_radius, minor_radius, height, material):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=96,
        minor_segments=12,
        location=(0, height, 0),
    )
    ring = bpy.context.object
    ring.name = name
    ring.data.materials.append(material)
    return ring


def add_pylon(index, angle, brass, cyan):
    radius = 17.5
    position = Vector((radius, 0, 0))
    position.rotate(Matrix.Rotation(angle, 4, "Z"))

    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.95, depth=0.65, location=(position.x, -0.68, position.y))
    base = bpy.context.object
    base.name = f"brass-pylon-base-{index}"
    base.data.materials.append(brass)

    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.18, depth=3.8, location=(position.x, 1.25, position.y))
    core = bpy.context.object
    core.name = f"cyan-time-rift-{index}"
    core.data.materials.append(cyan)

    bpy.ops.object.light_add(type="POINT", location=(position.x, 2.0, position.y))
    light = bpy.context.object
    light.name = f"time-rift-light-{index}"
    light.data.color = (0.02, 0.62, 1.0)
    light.data.energy = 520
    light.data.shadow_soft_size = 2.0


def add_floor(arena_image, stone):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=30, depth=0.28, location=(0, -1.42, 0))
    floor = bpy.context.object
    floor.name = "clockwork-stone-reflection-floor"
    floor.data.materials.append(stone)

    bpy.ops.mesh.primitive_plane_add(size=52, location=(0, -1.265, 0))
    art = bpy.context.object
    art.name = "clockwork-arena-art"
    material = bpy.data.materials.new("clockwork-arena-art-material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = arena_image
    texture.interpolation = "Linear"
    texture.extension = "CLIP"
    links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    links.new(texture.outputs["Color"], principled.inputs["Emission Color"])
    principled.inputs["Emission Strength"].default_value = 0.08
    principled.inputs["Metallic"].default_value = 0.32
    principled.inputs["Roughness"].default_value = 0.38
    art.data.materials.append(material)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    # Equirectangular camera は Cycles でレンダーし、床・リング・亀裂を実際にパノラマへ焼き込む。
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "HDR"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "32"
    scene.render.film_transparent = False
    # IBL は表示用のAgX変換を通さず、金属が読める線形HDRとして保存する。
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    world = bpy.data.worlds.new("midnight-arena-world")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.002, 0.008, 0.03, 1)
    background.inputs["Strength"].default_value = 0.16
    scene.world = world

    brass = new_material(
        "antique-brass", (0.28, 0.105, 0.018), metallic=0.9, roughness=0.24, emission=(0.32, 0.07, 0.008), strength=28.0
    )
    dark_brass = new_material(
        "aged-brass", (0.09, 0.028, 0.006), metallic=0.84, roughness=0.36, emission=(0.06, 0.008, 0.001), strength=8.0
    )
    cyan = new_material(
        "time-rift-cyan", (0.005, 0.18, 0.28), metallic=0.12, roughness=0.22, emission=(0.0, 0.64, 1.0), strength=2400.0
    )
    stone = new_material("midnight-stone", (0.012, 0.02, 0.04), metallic=0.22, roughness=0.45)
    add_floor(bpy.data.images.load(str(ARENA_ART)), stone)

    # 水平リングと立ち上がる歯車が、金属に暖色と輪郭を返す。
    add_torus("warm-brass-ring-near", 7.4, 0.12, -0.92, brass)
    add_torus("warm-brass-ring-mid", 14.5, 0.16, -0.78, brass)
    add_torus("warm-brass-ring-far", 22.5, 0.19, -0.62, dark_brass)
    for index, angle in enumerate((0, 1.5708, 3.1416, 4.7124)):
        add_pylon(index, angle, brass, cyan)

    bpy.ops.object.light_add(type="AREA", location=(0, 10, -8))
    key = bpy.context.object
    key.data.energy = 950
    key.data.shape = "DISK"
    key.data.size = 9
    key.data.color = (0.03, 0.32, 0.75)
    key.rotation_euler = (0.75, 0, 0)

    bpy.ops.object.light_add(type="AREA", location=(-10, 4, 6))
    warm = bpy.context.object
    warm.data.energy = 700
    warm.data.shape = "DISK"
    warm.data.size = 6
    warm.data.color = (1.0, 0.23, 0.035)
    warm.rotation_euler = (1.15, 0, -0.95)

    bpy.ops.object.camera_add(location=(0, 1.45, 0))
    camera = bpy.context.object
    camera.name = "arena-ibl-camera"
    camera.data.type = "PANO"
    camera.data.panorama_type = "EQUIRECTANGULAR"
    camera.data.lens = 16
    scene.camera = camera

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(OUTPUT)
    bpy.ops.render.render(write_still=True)
    print(f"ARENA_IBL_OK {OUTPUT}")


if __name__ == "__main__":
    main()
