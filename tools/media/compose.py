"""Cuts the trailer together from rendered shots, title cards and the
soundtrack, as laid out in trailer.json, and encodes it.

    python3 compose.py TRAILER_JSON FRAMES_DIR CARDS_DIR AUDIO.wav OUT.mp4 [--preview]

FRAMES_DIR/<shot>/f_00000.jpg... are capture.cjs output (the title screen in
FRAMES_DIR/title); CARDS_DIR/seg<i>_card.png and seg<i>_bar.png are
cards.cjs output. Audio is levelled and limited on the way in.
"""
import json
import os
import subprocess
import sys

from PIL import Image

spec_path, frames_dir, cards_dir, audio, out = sys.argv[1:6]
preview = '--preview' in sys.argv
spec = json.load(open(spec_path))
FPS = spec['fps']
W, H = spec['size']

BLACK = Image.new('RGB', (W, H), (0, 0, 0))
cache = {}


def rgba(path):
    if path not in cache:
        cache[path] = Image.open(path).convert('RGBA')
    return cache[path]


def fade(t, t0, t1, fin, fout):
    """0..1: up over `fin` from t0, down over `fout` to t1."""
    if t < t0 or t > t1:
        return 0.0
    a = 1.0
    if fin > 0:
        a = min(a, (t - t0) / fin)
    if fout > 0:
        a = min(a, (t1 - t) / fout)
    return max(0.0, min(1.0, a))


def overlay(base, layer_path, alpha):
    if alpha <= 0:
        return base
    layer = rgba(layer_path)
    if alpha < 1:
        r, g, b, a = layer.split()
        a = a.point(lambda v: int(v * alpha))
        layer = Image.merge('RGBA', (r, g, b, a))
    return Image.alpha_composite(base.convert('RGBA'), layer).convert('RGB')


def shot_frame(name, k):
    d = os.path.join(frames_dir, name)
    files = sorted(os.listdir(d)) if os.path.isdir(d) else []
    if not files:
        return BLACK
    k = min(k, len(files) - 1)
    return Image.open(os.path.join(d, files[k])).convert('RGB').resize((W, H))


def frames():
    start = 0.0
    for i, seg in enumerate(spec['segments']):
        dur = seg['dur']
        f0 = round(start * FPS)
        f1 = round((start + dur) * FPS)
        for f in range(f0, f1):
            k = f - f0
            t = k / FPS
            if 'shot' in seg:
                img = shot_frame(seg['shot'], k)
            else:
                img = BLACK.copy()
            if 'card' in seg:
                fin = min(0.6, dur * 0.18)
                img = overlay(img, os.path.join(cards_dir, f'seg{i}_card.png'), fade(t, 0, dur, fin, min(0.6, dur * 0.2)))
            if 'bar' in seg:
                b0, b1, _ = seg['bar']
                img = overlay(img, os.path.join(cards_dir, f'seg{i}_bar.png'), fade(t, b0, b1, 0.4, 0.4))
            k_in = seg.get('fadein', 0)
            k_out = seg.get('fadeout', 0)
            if k_in or k_out:
                level = fade(t, 0, dur, k_in, k_out)
                if level < 1:
                    img = Image.blend(BLACK, img, level)
            # The very first shot comes up out of the dark.
            if seg.get('shot') == 'wake' and t < 0.5:
                img = Image.blend(BLACK, img, t / 0.5)
            yield img
        start += dur


total = sum(s['dur'] for s in spec['segments'])
cmd = [
    'ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
    '-i', audio,
    '-filter_complex',
    # Level the game's mix up to trailer loudness without letting the hits clip.
    f'[1:a]volume=14dB,alimiter=limit=0.84:attack=4:release=60:level=false,'
    f'afade=t=in:d=0.6,afade=t=out:st={total - 1.6:.2f}:d=1.6[a]',
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast' if preview else 'slow', '-crf', '28' if preview else '17',
    '-tune', 'film', '-pix_fmt', 'yuv420p', '-r', str(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-shortest', out,
]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
n = 0
for img in frames():
    proc.stdin.write(img.tobytes())
    n += 1
proc.stdin.close()
proc.wait()
print(f'{n} frames, {n / FPS:.2f} s -> {out}', 'ok' if proc.returncode == 0 else f'ffmpeg failed {proc.returncode}')
