# Render the Attendant's face for the moment he catches you: the same CC0
# MakeHuman character the game uses (cast.json), too close to the lens, mouth
# hanging open, eyes gone milky, caught in the flash of a torch held low.
#
#   python3 make_face.py OUT.png [SAMPLES]
#
# post_face.py turns the render into the game's image.
import bpy, os, sys, importlib, json, math
from mathutils import Vector, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from boot import boot

PKG = boot()


def S(mod, name):
    return getattr(importlib.import_module(f'{PKG}.services.{mod}'), name)


HumanService = S('humanservice', 'HumanService')
TargetService = S('targetservice', 'TargetService')
AssetService = S('assetservice', 'AssetService')
ObjectService = S('objectservice', 'ObjectService')
HumanObjectProperties = getattr(importlib.import_module(f'{PKG}.entities.objectproperties'), 'HumanObjectProperties')
LocationService = S('locationservice', 'LocationService')

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = next(c for c in json.load(open(os.path.join(HERE, 'cast.json'))) if c['id'] == 'attendant')


def age(years):
    if years <= 25:
        return 0.1875 + (years - 11) / 14 * (0.5 - 0.1875) if years >= 11 else years / 11 * 0.1875
    return 0.5 + (years - 25) / 65 * 0.5


def asset(name, subdir):
    p = AssetService.find_asset_absolute_path(name, asset_subdir=subdir)
    if not p:
        raise RuntimeError(f'missing asset {subdir}/{name}')
    return p


# MakeHuman's own expression units (CC0, shipped with MPFB): a jaw dropped
# further than a jaw goes, eyes stretched open, the brow pulled down hard and
# the neck cords standing out. The mouth is the one that matters.
EXPRESSION = {
    'mouth-open': 1.0,
    'mouth-depression': 0.2,
    'mouth-retraction': 0.35,
    'eye-left-opened-up': 1.0,
    'eye-right-opened-up': 0.85,
    'eyebrows-left-down': 0.45,
    'eyebrows-right-down': 0.35,
    'eyebrows-left-inner-up': 0.25,
    'nose-left-elevation': 0.35,
    'nose-right-elevation': 0.3,
    'neck-platysma': 0.8,
}

# Shape, not expression: hollow cheeks and sunken eyes on an old, thin man.
SHAPE = {
    'cheek/l-cheek-volume-decr': 0.8,
    'cheek/r-cheek-volume-decr': 0.8,
    'cheek/l-cheek-bones-incr': 0.6,
    'cheek/r-cheek-bones-incr': 0.6,
    'eyes/l-eye-push1-in': 0.6,
    'eyes/r-eye-push1-in': 0.6,
    'eyes/l-eye-bag-incr': 0.8,
    'eyes/r-eye-bag-incr': 0.8,
}


def target_path(rel):
    base = os.path.join(LocationService.get_mpfb_data('targets'), rel + '.target.gz')
    if not os.path.exists(base):
        raise RuntimeError('missing target ' + base)
    return base


def build():
    basemesh = HumanService.create_human()
    macros = {'gender': SPEC['gender'], 'age': age(SPEC['years']), 'muscle': SPEC.get('muscle', 0.5),
              'weight': SPEC.get('weight', 0.5), 'height': SPEC.get('height', 0.5),
              'proportions': SPEC.get('proportions', 0.5), 'caucasian': 1.0, 'african': 0.0, 'asian': 0.0}
    for k, v in macros.items():
        HumanObjectProperties.set_value(k, float(v), entity_reference=basemesh)
    TargetService.reapply_macro_details(basemesh)
    for rel, w in SHAPE.items():
        TargetService.load_target(basemesh, target_path(rel), weight=w, name='shape-' + rel.split('/')[-1])
    for unit, w in EXPRESSION.items():
        TargetService.load_target(basemesh, target_path('expression/units/caucasian/' + unit), weight=w, name='ex-' + unit)

    HumanService.set_character_skin(asset(SPEC['skin'] + '.mhmat', 'skins'), basemesh, skin_type='ENHANCED_SSS')
    parts = [
        ('eyes', 'high-poly.mhclo', 'Eyes'),
        ('eyebrows', SPEC['eyebrows'] + '.mhclo', 'Eyebrows'),
        ('eyelashes', 'eyelashes01.mhclo', 'Eyelashes'),
        ('teeth', 'teeth_base.mhclo', 'Teeth'),
        ('tongue', 'tongue01.mhclo', 'Tongue'),
        ('hair', SPEC['hair'] + '.mhclo', 'Hair'),
        ('clothes', 'male_elegantsuit01.mhclo', 'Clothes'),
    ]
    for subdir, fname, atype in parts:
        HumanService.add_mhclo_asset(asset(fname, subdir), basemesh, asset_type=atype, material_type='MAKESKIN')
    return basemesh


def node_input(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    return None


# Drain the colour out of a material: whatever feeds the BSDF's base colour
# goes through a hue/saturation node first, then is tinted, then (for the
# eyes) washed toward a milky film. MPFB keeps its BSDFs inside node groups,
# shared between materials, so each tree is only changed once.
_done = set()


def pallid(mat, sat=0.35, val=0.85, tint=(0.86, 0.95, 0.9, 1), film=None, film_amount=0.0):
    if not mat or not mat.use_nodes:
        return
    tint_tree(mat.node_tree, sat, val, tint, film, film_amount)


def tint_tree(nt, sat, val, tint, film, film_amount):
    if nt.as_pointer() in _done:
        return
    _done.add(nt.as_pointer())
    for n in nt.nodes:
        if n.type == 'GROUP' and n.node_tree:
            tint_tree(n.node_tree, sat, val, tint, film, film_amount)
    for bsdf in [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED']:
        base = node_input(bsdf, 'Base Color')
        hs = nt.nodes.new('ShaderNodeHueSaturation')
        hs.inputs['Saturation'].default_value = sat
        hs.inputs['Value'].default_value = val
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[7].default_value = tint
        if base.is_linked:
            src = base.links[0].from_socket
            nt.links.new(src, hs.inputs['Color'])
        else:
            hs.inputs['Color'].default_value = base.default_value
        nt.links.new(hs.outputs['Color'], mix.inputs[6])
        out = mix.outputs[2]
        if film:
            wash = nt.nodes.new('ShaderNodeMix')
            wash.data_type = 'RGBA'
            wash.blend_type = 'MIX'
            wash.inputs['Factor'].default_value = film_amount
            wash.inputs[7].default_value = film
            nt.links.new(out, wash.inputs[6])
            out = wash.outputs[2]
        nt.links.new(out, base)


# Eyes gone the colour of skimmed milk over a grey iris you can only just
# make out, and wet on the surface.
def milky_eyes(obj):
    for m in obj.data.materials:
        pallid(m, sat=0.15, val=0.75, tint=(0.92, 0.96, 0.93, 1), film=(0.62, 0.66, 0.64, 1), film_amount=0.38)
        for nt in [m.node_tree] + [n.node_tree for n in m.node_tree.nodes if n.type == 'GROUP' and n.node_tree]:
            for b in [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED']:
                b.inputs['Roughness'].default_value = 0.05
                if node_input(b, 'Coat Weight'):
                    node_input(b, 'Coat Weight').default_value = 1.0
                    node_input(b, 'Coat Roughness').default_value = 0.02


def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


# The transit cap: a band round the forehead, a stiff crown that flares out
# above it, and a short lacquered peak shading the eyes. Built round the
# measured skull, an ellipse wider front to back than side to side.
def cap(top, cy, rx, ry):
    navy = mat('cap_cloth', (0.014, 0.018, 0.028, 1), 0.85)
    lacquer = mat('cap_peak', (0.004, 0.004, 0.005, 1), 0.15)
    brass = mat('cap_badge', (0.55, 0.42, 0.16, 1), 0.3, 1.0)
    rx += 0.012
    ry += 0.012
    root = bpy.data.objects.new('cap', None)
    bpy.context.scene.collection.objects.link(root)
    root.location = (0, cy, top - 0.07)
    # Tipped forward, the way it is worn.
    root.rotation_euler = Euler((math.radians(-9), 0, 0))
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1, depth=0.042, location=(0, 0, 0.021))
    band = bpy.context.object
    band.scale = (rx, ry, 1)
    band.data.materials.append(lacquer)
    parts.append(band)
    bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=1, radius2=1.22, depth=0.075, location=(0, 0.012, 0.042 + 0.0375))
    crown = bpy.context.object
    crown.scale = (rx, ry, 1)
    crown.data.materials.append(navy)
    parts.append(crown)
    # The peak: the front half of a flat ellipse, sloping down off the band.
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1, depth=0.005, location=(0, 0, 0))
    peak = bpy.context.object
    for v in peak.data.vertices:
        v.select = v.co.y > 0.05
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.delete(type='VERT')
    bpy.ops.object.mode_set(mode='OBJECT')
    peak.scale = (rx * 0.98, 0.075, 1)
    peak.location = (0, -ry + 0.012, 0.004)
    peak.rotation_euler = Euler((math.radians(-22), 0, 0))
    peak.data.materials.append(lacquer)
    parts.append(peak)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.017, depth=0.004, location=(0, -ry - 0.004, 0.06),
                                        rotation=(math.radians(90 - 9), 0, 0))
    badge = bpy.context.object
    badge.data.materials.append(brass)
    parts.append(badge)
    for p in parts:
        p.parent = root
        bpy.ops.object.select_all(action='DESELECT')
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.shade_smooth()


def main():
    out = sys.argv[1]
    samples = int(sys.argv[2]) if len(sys.argv) > 2 else 128
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    basemesh = build()
    # Find the head: the top of the skull and the front of the face.
    deps = bpy.context.evaluated_depsgraph_get()
    ev = basemesh.evaluated_get(deps)
    verts = [basemesh.matrix_world @ v.co for v in ev.data.vertices]
    top = max(v.z for v in verts)
    head = [v for v in verts if v.z > top - 0.26]
    front = min(v.y for v in head)
    band = [v for v in verts if abs(v.z - (top - 0.06)) < 0.006]
    rx = max(abs(v.x) for v in band)
    y0, y1 = min(v.y for v in band), max(v.y for v in band)
    face_z = top - 0.13
    print('head top', top, 'front', front, 'band', rx, y0, y1)
    # The jaw drops further than a jaw goes.
    keys = basemesh.data.shape_keys.key_blocks
    keys['ex-mouth-open'].slider_max = 2.0
    keys['ex-mouth-open'].value = 1.05

    for o in ObjectService.get_list_of_children(basemesh) + [basemesh]:
        if o.type != 'MESH':
            continue
        t = ObjectService.get_object_type(o)
        if t == 'Eyes':
            milky_eyes(o)
        elif t in ('Basemesh', 'Proxymeshes'):
            for m in o.data.materials:
                pallid(m, sat=0.6, val=0.86, tint=(0.9, 0.97, 0.92, 1))
        elif t in ('Teeth',):
            for m in o.data.materials:
                pallid(m, sat=0.5, val=0.3, tint=(0.8, 0.72, 0.5, 1))
        elif t in ('Tongue',):
            for m in o.data.materials:
                pallid(m, sat=0.3, val=0.25)
    cap(top, (y0 + y1) / 2, rx, (y1 - y0) / 2)

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - High Contrast'
    world = bpy.data.worlds.new('dark')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0, 0.0, 0.0, 1)
    scene.world = world

    # Close: the face fills the frame, a touch below and to one side of
    # centre, the camera tipped as if held by someone falling backwards.
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 32
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 2.8
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    target = Vector((0.0, front + 0.06, face_z - 0.01))
    cam.location = target + Vector((0.035, -0.34, -0.09))
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.rotation_euler.rotate_axis('Z', math.radians(11))
    cam_data.dof.focus_distance = direction.length - 0.03
    scene.camera = cam

    # A torch held low and to one side: hard light up into the face, so the
    # sockets and the open mouth go black and the brow throws its shadow up.
    def light(name, kind, energy, loc, color, size=0.05):
        d = bpy.data.lights.new(name, kind)
        d.energy = energy
        d.color = color
        if kind == 'SPOT':
            d.spot_size = math.radians(55)
            d.spot_blend = 0.35
            d.shadow_soft_size = size
        elif kind == 'AREA':
            d.size = size
        o = bpy.data.objects.new(name, d)
        o.location = loc
        scene.collection.objects.link(o)
        aim = (target - o.location)
        o.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()
        return o

    light('torch', 'SPOT', 11, target + Vector((0.3, -0.32, -0.42)), (1.0, 0.94, 0.82), 0.015)
    # The cold strip light above and behind, catching the cap and one ear.
    light('rim', 'AREA', 18, target + Vector((-0.35, 0.45, 0.55)), (0.62, 0.9, 0.82), 0.6)
    light('fill', 'AREA', 0.9, target + Vector((-0.5, -0.6, 0.1)), (0.55, 0.75, 0.8), 1.0)

    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('wrote', out)


main()
