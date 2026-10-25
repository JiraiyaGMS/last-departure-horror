// Renders the trailer's title cards and bar lines (trailer.json) to
// transparent PNGs, in the game's own type (cards.html).
//
//   node tools/media/cards.cjs OUT_DIR
//
// Needs the capture dev server: npx vite --config tools/media/vite.capture.config.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'trailer.json'), 'utf8'));
const [W, H] = spec.size;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const render = async (card, file) => {
    await page.goto('about:blank');
    await page.goto(`http://127.0.0.1:5174/tools/media/cards.html#${encodeURIComponent(JSON.stringify(card))}`);
    await page.waitForSelector('body[data-ready]');
    await page.screenshot({ path: path.join(outDir, file), omitBackground: true });
    console.log('wrote', file);
  };
  for (const [i, seg] of spec.segments.entries()) {
    if (seg.card) await render({ kind: 'card', ...seg.card }, `seg${i}_card.png`);
    if (seg.bar) await render({ kind: 'bar', text: seg.bar[2] }, `seg${i}_bar.png`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
