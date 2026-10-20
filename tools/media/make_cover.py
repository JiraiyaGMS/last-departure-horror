"""Composes the itch.io cover: the rendered still with the game's logo over
it, in the game's own type (Barlow Condensed, embedded so the page needs no
server). Writes cover.png at 630 x 500 and cover@2x.png at 1260 x 1000.

    python3 make_cover.py STILL.jpg OUT_DIR [logo-position: bottom|top]
"""
import base64
import os
import subprocess
import sys

from PIL import Image

still, out_dir = sys.argv[1], os.path.abspath(sys.argv[2])
where = sys.argv[3] if len(sys.argv) > 3 else 'bottom'
fonts = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../node_modules/@fontsource/barlow-condensed/files')


def face(weight):
    data = base64.b64encode(open(f'{fonts}/barlow-condensed-latin-{weight}-normal.woff2', 'rb').read()).decode()
    return f"@font-face {{ font-family: 'Barlow Condensed'; font-weight: {weight}; src: url(data:font/woff2;base64,{data}) format('woff2'); }}"


shade = ('linear-gradient(0deg, rgba(2,4,4,0.92) 0%, rgba(2,4,4,0.55) 26%, rgba(2,4,4,0) 52%)'
         if where == 'bottom' else
         'linear-gradient(180deg, rgba(2,4,4,0.92) 0%, rgba(2,4,4,0.55) 26%, rgba(2,4,4,0) 52%)')
pos = 'bottom: 26px;' if where == 'bottom' else 'top: 24px;'
html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{face(600)}
{face(700)}
html, body {{ margin: 0; width: 630px; height: 500px; background: transparent; overflow: hidden; }}
.shade {{ position: absolute; inset: 0; background: {shade}; }}
.logo {{ position: absolute; left: 30px; {pos} font-family: 'Barlow Condensed'; }}
.kicker {{ font-weight: 600; font-size: 13px; letter-spacing: 0.34em; color: #8d9a92; text-transform: uppercase; margin: 0 0 6px 2px; }}
.word {{ display: block; font-weight: 700; font-size: 92px; line-height: 0.84; letter-spacing: 0.04em; color: #eceee6; text-shadow: 0 2px 18px rgba(0,0,0,0.6); }}
.word.amber {{ color: #e8c860; }}
</style></head><body>
<div class="shade"></div>
<div class="logo"><div class="kicker">Grayhollow Transit Center &middot; 1987</div><span class="word">LAST</span><span class="word amber">DEPARTURE</span></div>
</body></html>"""
page = os.path.join(out_dir, 'cover_overlay.html')
open(page, 'w').write(html)
overlay = os.path.join(out_dir, 'cover_overlay.png')
js = f"""
const {{ chromium }} = require('playwright');
(async () => {{
  const b = await chromium.launch({{ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }});
  const p = await b.newPage({{ viewport: {{ width: 630, height: 500 }}, deviceScaleFactor: 2 }});
  await p.goto('file://{page}');
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({{ path: '{overlay}', omitBackground: true }});
  await b.close();
}})();
"""
subprocess.run(['node', '-e', js], check=True)

base = Image.open(still).convert('RGBA').resize((1260, 1000), Image.LANCZOS)
top = Image.open(overlay).convert('RGBA')
cover = Image.alpha_composite(base, top).convert('RGB')
cover.save(os.path.join(out_dir, 'cover@2x.png'))
cover.resize((630, 500), Image.LANCZOS).save(os.path.join(out_dir, 'cover.png'))
print('wrote cover.png and cover@2x.png')
