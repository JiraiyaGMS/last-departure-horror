# Turn make_face.py's render into the image the game flashes when he catches
# you: cropped close, drained of colour, crushed, grainy, a little doubled as
# if the camera moved during the exposure, and fading to nothing at the edges
# so it comes out of the dark rather than sitting on it in a box.
#
#   python3 post_face.py RENDER.png OUT.webp
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
SIZE = 768
img = Image.open(src).convert('RGB')
w, h = img.size
# A square round the face, a little above centre so the open mouth sits low.
side = int(min(w, h) * 0.86)
cx, cy = int(w * 0.515), int(h * 0.51)
img = img.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)).resize((SIZE, SIZE), Image.LANCZOS)
a = np.asarray(img).astype(np.float32) / 255.0

# Mostly monochrome, leaning cold and a little green, the way sodium-starved
# fluorescent light and a cheap flash leave a face.
lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
a = a * 0.28 + lum[..., None] * 0.72
a *= np.array([0.9, 1.0, 0.95], dtype=np.float32)

# Doubled: a faint second exposure a few pixels off, as if he moved.
ghost = np.roll(np.roll(a, -9, axis=1), 5, axis=0)
a = np.maximum(a, ghost * 0.55) * 0.88 + a * 0.12

# Crush the blacks, push the highlights: an S-curve on a lifted floor.
a = np.clip((a - 0.035) / 0.93, 0, 1)
a = a * a * (3 - 2 * a) * 0.55 + a * 0.45

# Grain: fine per-pixel noise and a coarser mottle under it.
rng = np.random.default_rng(1147)
fine = rng.normal(0, 0.055, (SIZE, SIZE)).astype(np.float32)
coarse = rng.normal(0, 1, (SIZE // 8, SIZE // 8)).astype(np.float32)
coarse = np.asarray(Image.fromarray(coarse).resize((SIZE, SIZE), Image.BICUBIC)) * 0.025
a = np.clip(a + (fine + coarse)[..., None] * (0.4 + a * 0.8), 0, 1)

# Vignette, and the alpha that lets the edges go to the room behind.
yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32) / (SIZE - 1) - 0.5
r = np.sqrt(xx * xx + (yy * 0.94) ** 2)
vig = np.clip(1.0 - (r - 0.2) / 0.32, 0, 1) ** 1.6
a *= (0.25 + 0.75 * vig)[..., None]
alpha = np.clip(1.0 - (r - 0.41) / 0.09, 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)

rgba = np.dstack([a, alpha]).clip(0, 1)
Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(out, 'WEBP', quality=84, method=6)
print('wrote', out)
