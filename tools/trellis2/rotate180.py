import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
src = argv[0]
dst = argv[1]

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for obj in objs:
    obj.rotation_mode = "XYZ"
    obj.rotation_euler[2] += 3.14159265358979
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
print(f"ROTATED {src} -> {dst}")
