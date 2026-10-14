# Paints the MakeHuman logo off the two T-shirts in the CC0 asset pack (the
# rest of the pack is used as shipped). Run once, after unpacking the assets.
#
#   python3 patch_textures.py ../path/to/assets
import os
import shutil
import sys

from PIL import Image

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'assets')


def original(path):
    bak = path + '.orig'
    if not os.path.exists(bak):
        shutil.copy(path, bak)
    return Image.open(bak).convert('RGB')


def copy_patches(path, boxes):
    """Covers each box (in 512-px units) with the cloth `dx, dy` away from it."""
    im = original(path)
    s = im.size[0] / 512
    for (x0, y0, x1, y1, dx, dy) in boxes:
        b = tuple(int(v * s) for v in (x0, y0, x1, y1))
        src = im.crop((b[0] + int(dx * s), b[1] + int(dy * s), b[2] + int(dx * s), b[3] + int(dy * s)))
        im.paste(src, b[:2])
    im.save(path)


def tile_patch(path, box, tile_box):
    """Covers `box` with mirrored tiles of a clean square of cloth."""
    im = original(path)
    s = im.size[0] / 512
    tile = im.crop(tuple(int(v * s) for v in tile_box))
    x0, y0, x1, y1 = (int(v * s) for v in box)
    tw, th = tile.size
    for yy in range(y0, y1, th):
        for xx in range(x0, x1, tw):
            t = tile
            if ((xx - x0) // tw) % 2:
                t = t.transpose(Image.FLIP_LEFT_RIGHT)
            if ((yy - y0) // th) % 2:
                t = t.transpose(Image.FLIP_TOP_BOTTOM)
            im.paste(t.crop((0, 0, min(tw, x1 - xx), min(th, y1 - yy))), (xx, yy))
    im.save(path)


clothes = os.path.join(ROOT, 'clothes')
tile_patch(os.path.join(clothes, 'female_casualsuit01', 'female_casualsuit01_diffuse.png'),
           (356, 62, 454, 162), (300, 110, 340, 150))
copy_patches(os.path.join(clothes, 'male_casualsuit06', 'male_casualsuit06_diffuse.png'),
             [(215, 58, 330, 105, 0, 75), (95, 55, 160, 85, 0, 70), (366, 68, 392, 94, 0, 40)])
print('patched')
