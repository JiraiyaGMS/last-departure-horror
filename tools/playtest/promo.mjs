// Renders the stills and the cover in promo/ for the itch.io page, from the
// game itself at its highest settings with the HUD hidden. Software
// rendering at full quality is slow: a few minutes a picture.
//
//   node promo.mjs [url]            every picture
//   ONLY=hall,cctv node promo.mjs   some of them
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const ADDRESS = process.argv[2] ?? 'http://localhost:4173/';
const OUT = fileURLToPath(new URL('../../promo/', import.meta.url));
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SETTLE = 25000;
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// [name, what to do in the page first, with `g` the game]
const SHOTS = [
  // name, setup function body (runs in the page with g = game)
  ['hall', `g.player.teleport(4.6, 8.6, 0.24); g.player.pitch = 0.1;`],
  // He freezes when looked at, in whatever shape he was caught in.
  ['attendant', `
    g.player.teleport(1.2, 0.5, -0.389); g.player.pitch = 0.07;
    const a = g.attendant;
    a.position.set(3.25, 0, -4.5);
    a.facing = Math.atan2(2.05, -5);
    a.state = 'patrol'; a.path = []; a.grace = 0;
    g.player.hiding = null;
    a.figure.position.copy(a.position); a.figure.rotation.y = a.facing;
    a.reset = () => {};
    g.onCaught = () => {};`],
  ['bays', `g.player.teleport(-13.5, -26.4, 1.075); g.player.pitch = 0.05;`],
  ['lostfound', `g.player.teleport(-12.6, 3.05, 1.5708); g.player.pitch = -0.06; g.state.run.hasFlashlight = true; g.player.flashlightOn = true; g.player.battery = 1;
    for (const l of g.level.lights) if (l.room === 'lostfound') l.broken = true;`],
  ['cctv', `g.player.teleport(17.2, -4.6, 0); g.presence.cctvHaunt(120); g.watchMonitors();
    const p = g.watchPose(); g.player.position.set(p.x, 0, p.z); g.player.eyeHeight = p.eye; g.player.yaw = p.yaw; g.player.pitch = p.pitch;
    g.camera.fov = p.fov; g.camera.updateProjectionMatrix();`],
  ['baggage', `g.player.teleport(4.5, 22.5, -0.94); g.player.pitch = 0.03;`],
];

async function stills(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    localStorage.setItem('lastDeparture.graphics', 'high');
    localStorage.setItem('lastDeparture.settings', JSON.stringify({ calibrated: true, fov: 72 }));
  });
  await page.goto(ADDRESS, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('startbtn').disabled, null, { timeout: 300000 });
  await page.evaluate(() => { window.__game.skipCutscenes = true; });
  await page.click('#startbtn');
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const g = window.__game;
    g.noLock = true;
    if (g.hud.pauseOpen) g.resume();
    g.attendant.grace = 1e9;
    g.director.update = () => {};
    g.clock.update = () => null;
    // A clean picture: no HUD, and nothing frightening the camera.
    document.getElementById('hud').style.display = 'none';
    document.getElementById('cine')?.classList.add('hidden');
    g.fear.update = () => {};
    g.fear.reset();
  });
  for (const [name, body] of SHOTS) {
    if (ONLY && !ONLY.includes(name)) continue;
    const t0 = Date.now();
    await page.evaluate((body) => { new Function('g', body)(window.__game); }, body);
    await page.waitForTimeout(SETTLE);
    await page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 90, timeout: 600000 });
    console.log(`${name}.jpg  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    await page.evaluate(() => {
      const g = window.__game;
      g.stopWatching();
      g.player.flashlightOn = false;
      for (const l of g.level.lights) l.broken = false;
      g.attendant.grace = 1e9;
      g.attendant.position.set(0, 0, -60);
      g.attendant.path = [];
    });
  }
  await page.close();
}

// The cover: the title over the station, 630 x 500.
async function cover(browser) {
  if (ONLY && !ONLY.includes('cover')) return;
  const page = await browser.newPage({ viewport: { width: 630, height: 500 } });
  await page.addInitScript(() => {
    localStorage.setItem('lastDeparture.graphics', 'high');
    localStorage.setItem('lastDeparture.settings', JSON.stringify({ calibrated: true }));
  });
  await page.goto(ADDRESS, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('startbtn').disabled, null, { timeout: 300000 });
  await page.addStyleTag({ content: `
    #title nav, #loadbar, .foot, #progressline, #version { display: none !important; }
    #title { padding-left: 38px !important; align-items: flex-end !important; padding-bottom: 44px !important; }
    .title-inner { animation: none !important; }
    .logo { font-size: 92px !important; margin: 8px 0 14px !important; }
    .tagline { font-size: 17px !important; margin: 0 !important; }
    .eyebrow { font-size: 12px !important; }` });
  await page.waitForTimeout(SETTLE);
  await page.screenshot({ path: `${OUT}cover.jpg`, type: 'jpeg', quality: 92, timeout: 600000 });
  console.log('cover.jpg');
  await page.close();
}

const browser = await chromium.launch({ args: ARGS });
await stills(browser);
await cover(browser);
await browser.close();
