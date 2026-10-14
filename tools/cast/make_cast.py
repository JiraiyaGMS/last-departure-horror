# Build the cast with MPFB (MakeHuman for Blender) from the CC0 system assets,
# and export every character into one GLB so shared textures are stored once.
#
#   python3 make_cast.py OUT.glb [id id ...]
import bpy, os, sys, importlib, json, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from boot import boot

PKG = boot()


def S(mod, name):
    return getattr(importlib.import_module(f'{PKG}.services.{mod}'), name)


def E(mod, name):
    return getattr(importlib.import_module(f'{PKG}.entities.{mod}'), name)


HumanService = S('humanservice', 'HumanService')
TargetService = S('targetservice', 'TargetService')
AssetService = S('assetservice', 'AssetService')
ExportService = S('exportservice', 'ExportService')
ObjectService = S('objectservice', 'ObjectService')
HumanObjectProperties = E('objectproperties', 'HumanObjectProperties')

# MakeHuman's age macro: 0.5 is 25 years, 1.0 is 90.
def age(years):
    if years <= 25:
        return 0.1875 + (years - 11) / 14 * (0.5 - 0.1875) if years >= 11 else years / 11 * 0.1875
    return 0.5 + (years - 25) / 65 * 0.5


def eth(c=0.0, a=0.0, s=0.0):
    t = c + a + s
    return {'caucasian': c / t, 'african': a / t, 'asian': s / t}


CAST = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cast.json')))


def asset(name, subdir):
    p = AssetService.find_asset_absolute_path(name, asset_subdir=subdir)
    if not p:
        raise RuntimeError(f'missing asset {subdir}/{name}')
    return p


def build(spec):
    basemesh = HumanService.create_human()
    macros = {'gender': spec['gender'], 'age': age(spec['years']), 'muscle': spec.get('muscle', 0.5),
              'weight': spec.get('weight', 0.5), 'height': spec.get('height', 0.5),
              'proportions': spec.get('proportions', 0.5)}
    macros.update(eth(**spec['ethnicity']))
    for k, v in macros.items():
        HumanObjectProperties.set_value(k, float(v), entity_reference=basemesh)
    TargetService.reapply_macro_details(basemesh)

    HumanService.set_character_skin(asset(spec['skin'] + '.mhmat', 'skins'), basemesh, skin_type='GAMEENGINE')
    HumanService.add_builtin_rig(basemesh, 'game_engine')

    parts = [
        ('eyes', 'low-poly.mhclo', 'Eyes'),
        ('eyebrows', spec.get('eyebrows', 'eyebrow001') + '.mhclo', 'Eyebrows'),
        ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes'),
    ]
    if spec.get('hair'):
        parts.append(('hair', spec['hair'] + '.mhclo', 'Hair'))
    for c in spec['clothes']:
        parts.append(('clothes', c + '.mhclo', 'Clothes'))
    for subdir, fname, atype in parts:
        HumanService.add_mhclo_asset(asset(fname, subdir), basemesh, asset_type=atype, material_type='GAMEENGINE')

    root = ExportService.create_character_copy(basemesh, name_suffix='_x')
    xbase = ObjectService.find_object_of_type_amongst_nearest_relatives(root, 'Basemesh')
    ExportService.bake_modifiers_remove_helpers(xbase, bake_masks=True, bake_subdiv=True, remove_helpers=True, also_proxy=True)

    # Shape keys are the modelling targets; bake their mix into the mesh so the
    # export carries geometry only.
    objs = [root] + ObjectService.get_list_of_children(root)
    for o in objs:
        if o.type == 'MESH' and o.data.shape_keys:
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    root.name = spec['id']
    # <id>_<Type>_<asset>: the game finds parts (and the LOD copies) by name.
    for o in ObjectService.get_list_of_children(root):
        if o.type == 'MESH':
            kind = ObjectService.get_object_type(o) or 'Mesh'
            mat = o.active_material.name if o.active_material else 'none'
            asset_name = mat.split('.')[-1] if '.' in mat else mat
            o.name = f"{spec['id']}_{kind}_{asset_name}".replace('-', '')
    add_lod(root, spec['id'])
    # The original stays out of the export.
    for o in [basemesh] + ObjectService.get_list_of_children(basemesh):
        o.hide_set(True)
    rig = ObjectService.find_object_of_type_amongst_nearest_relatives(basemesh, 'Skeleton')
    if rig:
        rig.hide_set(True)
    return root


# A second, much lighter copy of the body, clothes and shoes for when a
# character is more than a few metres away. Hair, eyes and brows are small or
# are alpha cards that decimation wrecks, so both levels share them.
LOD_RATIO = 0.28


def add_lod(root, cid):
    for o in list(ObjectService.get_list_of_children(root)):
        if o.type != 'MESH':
            continue
        part = o.name[len(cid) + 1:]
        if not (part.startswith('Basemesh') or part.startswith('Clothes')):
            continue
        lod = o.copy()
        lod.data = o.data.copy()
        lod.name = f'{cid}_lod1_{part}'
        for coll in o.users_collection:
            coll.objects.link(lod)
        dec = lod.modifiers.new('LOD', 'DECIMATE')
        dec.ratio = LOD_RATIO
        dec.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = lod
        bpy.ops.object.select_all(action='DESELECT')
        lod.select_set(True)
        bpy.ops.object.modifier_move_to_index(modifier='LOD', index=0)
        bpy.ops.object.modifier_apply(modifier='LOD')


def shrink_images():
    for img in bpy.data.images:
        if not img.size[0]:
            continue
        name = img.name.lower()
        cap = 1024
        if any(k in name for k in ('hair', 'brow', 'lash', 'eye', 'shoe', 'fedora', '_ao', 'normal')):
            cap = 512
        if 'skin' in name or 'diffuse' in name and not any(k in name for k in ('hair', 'brow', 'lash', 'shoe')):
            cap = 1024
        w, h = img.size
        if max(w, h) > cap:
            s = cap / max(w, h)
            img.scale(int(w * s), int(h * s))


def main():
    out = sys.argv[1]
    ids = set(sys.argv[2:])
    # Clean scene.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    roots = []
    for spec in CAST:
        if ids and spec['id'] not in ids:
            continue
        print('building', spec['id'])
        roots.append(build(spec))
    shrink_images()
    bpy.ops.object.select_all(action='DESELECT')
    for r in roots:
        r.hide_set(False)
        r.select_set(True)
        for c in ObjectService.get_list_of_children(r):
            c.hide_set(False)
            c.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_image_format='WEBP',
        export_image_quality=82,
        export_yup=True,
        export_apply=False,
    )
    print('wrote', out, os.path.getsize(out))


main()
