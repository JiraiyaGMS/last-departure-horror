// Renders scripted shots of the game frame by frame (see shots.js).
//
//   node tools/media/capture.cjs OUT_DIR shot[@frame][,shot...] [--fps 24] [--size 1280x720] [--scale 1]
//        [--only N] [--every K] [--keep-text] [--still | --no-bars --hud] [--title N]
//
// --still: screenshots of play rather than trailer frames, the same as
// --no-bars --hud. --keep-text: the game's subtitles and cards too.
//
// The game runs on a virtual clock: performance.now and requestAnimationFrame
// are taken over before it loads, and each captured frame advances it by
// exactly 1/fps, however long the frame takes to draw. So a software
// renderer at one frame every few seconds still produces smooth, real-speed
// footage. Graphics are pinned to HIGH and the quality governor is switched
// off, so a slow machine is not mistaken for a weak device.
//
// Needs the capture dev server: npx vite --config tools/media/vite.capture.config.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const [outDir, list] = args;
const FPS = Number(opt('fps', 24));
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const SCALE = Number(opt('scale', 1));
// --only N: render just frame N of each shot (for checking a composition).
const ONLY_ALL = opt('only', null);
// --every K: keep every Kth frame (a quick preview of the motion).
const EVERY = Number(opt('every', 1));
const URL = opt('url', 'http://127.0.0.1:5174/');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });

  await page.addInitScript(() => {
    try { localStorage.setItem('lastDeparture.graphics', 'high'); } catch {}
    const realNow = performance.now.bind(performance);
    const realRAF = window.requestAnimationFrame.bind(window);
    const V = (window.__vclock = { on: false, t: 0, queue: [] });
    performance.now = () => (V.on ? V.t : realNow());
    window.requestAnimationFrame = (cb) => {
      if (V.on) {
        V.queue.push(cb);
        return 1;
      }
      return realRAF((ts) => (V.on ? V.queue.push(cb) : cb(ts)));
    };
    V.start = () => {
      V.t = realNow();
      V.on = true;
    };
    V.step = (ms) => {
      V.t += ms;
      const q = V.queue;
      V.queue = [];
      for (const cb of q) cb(V.t);
      return q.length;
    };
  });

  await page.goto(URL, { timeout: 600000 });
  await page.waitForFunction(() => window.__game && !document.getElementById('startbtn').disabled, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__game.people.ready, null, { timeout: 300000 });
  // --title N: N frames of the title screen itself, before the game starts,
  // with the menu swapped for a line about where to play it.
  const TITLE = Number(opt('title', 0));
  if (TITLE) {
    await page.evaluate(() => {
      const nav = document.querySelector('#title nav.menu');
      nav.innerHTML = '<div style="font-family: var(--sign); font-weight: 600; font-size: 20px; letter-spacing: 0.32em; color: var(--amber); margin: 4px 0 0 2px;">PLAY IN YOUR BROWSER</div>';
      document.getElementById('loadbar').style.display = 'none';
      window.__vclock.start();
    });
    const dir = path.join(outDir, 'title');
    fs.mkdirSync(dir, { recursive: true });
    const tick = () => page.evaluate(async (ms) => {
      const V = window.__vclock;
      for (let i = 0; i < 1500 && !V.queue.length; i++) await new Promise((r) => setTimeout(r, 20));
      return V.step(ms);
    }, 1000 / FPS);
    for (let i = 0; i < 4; i++) await tick();
    for (let f = 0; f < TITLE; f++) {
      await tick();
      await page.screenshot({ path: path.join(dir, `f_${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94, timeout: 600000 });
    }
    console.log(`title: ${TITLE} frames`);
    await browser.close();
    return;
  }

  await page.evaluate(({ keepText, hud }) => {
    const g = window.__game;
    g.noLock = true;
    g.start();
    g.cutscene?.skip();
    g.quality.sample = () => {};
    // The game's own words are left to the trailer's cards.
    const css = document.createElement('style');
    css.textContent = '#cine .skip, #toast { display: none !important; }'
      + (keepText ? '' : ' #subtitle, #cine .card { display: none !important; }')
      + (keepText || hud ? '' : ' #hud { display: none !important; }');
    document.head.appendChild(css);
    window.__vclock.start();
  }, { keepText: flag('keep-text'), hud: flag('still') || flag('hud') });
  // One frame of the game. When the clock has just been taken over, the
  // game's next frame may still be waiting on a real one; wait for it rather
  // than stepping nothing and capturing a stale picture.
  const step = () => page.evaluate(async (ms) => {
    const V = window.__vclock;
    for (let i = 0; i < 1500 && !V.queue.length; i++) await new Promise((r) => setTimeout(r, 20));
    if (!V.queue.length) throw new Error('the game stopped asking for frames');
    return V.step(ms);
  }, 1000 / FPS);
  for (let i = 0; i < 4; i++) await step();

  for (const item of list.split(',')) {
    // `name@N` renders only frame N of that shot.
    const [name, at] = item.split('@');
    const ONLY = at ?? ONLY_ALL;
    const dir = path.join(outDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const info = await page.evaluate(async ({ name, fps, bars, hud }) => {
      const { begin } = await import('/tools/media/shots.js');
      window.__shot = begin(window.__game, name, fps, { bars, hud });
      return { frames: window.__shot.frames, preroll: window.__shot.preroll ?? 0 };
    }, { name, fps: FPS, bars: !(flag('still') || flag('no-bars')), hud: flag('still') || flag('hud') });
    const t0 = Date.now();
    for (let i = 0; i < info.preroll; i++) await step();
    let first = 0;
    if (ONLY !== null) {
      // Straight to that frame: run the scene forward without drawing it.
      first = Number(ONLY);
      await page.evaluate(({ n, fps }) => {
        const cs = window.__shot.cs;
        cs.seek(cs.t + n / fps);
        window.__vclock.t += (n * 1000) / fps;
      }, { n: first, fps: FPS });
    }
    let saved = 0;
    for (let f = first; f < info.frames; f++) {
      await step();
      const want = ONLY !== null ? f === Number(ONLY) : f % EVERY === 0;
      if (!want) continue;
      await page.screenshot({ path: path.join(dir, `f_${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94, timeout: 600000 });
      saved++;
      if (ONLY !== null) break;
    }
    await page.evaluate(() => window.__shot.end?.());
    const s = (Date.now() - t0) / 1000;
    console.log(`${name}: ${saved} frames in ${s.toFixed(0)}s (${(s / Math.max(1, saved)).toFixed(1)}s/frame)`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
