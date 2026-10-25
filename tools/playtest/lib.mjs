// Shared by the playtest scripts: a browser on the built game, started and
// unpaused, with a few helpers installed on window.H.
import { chromium } from 'playwright';

export const URL = process.argv[2] ?? process.env.URL ?? 'http://localhost:4173/';

// Software rendering is enough: these scripts test the game, not the GPU.
export async function open({ width = 480, height = 270, settings = {} } = {}) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript((settings) => {
    localStorage.setItem('lastDeparture.graphics', 'low');
    localStorage.setItem('lastDeparture.settings', JSON.stringify({ calibrated: true, ...settings }));
  }, settings);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('startbtn').disabled, null, { timeout: 300000 });
  await page.evaluate(() => { window.__game.skipCutscenes = true; });
  await page.click('#startbtn');
  await page.waitForTimeout(1500);
  await page.evaluate(installHelpers);
  return { browser, page, errors };
}

// Runs in the page.
function installHelpers() {
  const g = window.__game;
  g.noLock = true;
  if (g.hud.pauseOpen) g.resume();
  const H = (window.H = {});
  H.it = (id) => g.level.interactables.find((i) => i.id === id);
  // Uses an interactable directly, returning the prompt it showed.
  H.use = (id) => {
    const it = H.it(id);
    if (!it) throw new Error('no interactable ' + id);
    if (!it.enabled) return 'disabled:' + id;
    if (it.enabledWhen && !it.enabledWhen()) return 'not now:' + id;
    const p = it.prompt();
    it.use();
    it.redraw?.();
    return p;
  };
  H.closeDoc = () => {
    if (g.hud.readerOpen) g.hud.closeDocument();
    if (g.hud.notebookOpen) g.hud.closeNotebook();
    if (g.hud.dialsOpen) g.hud.closeDials();
  };
  H.pick = (i) => g.hud.pick(i);
  H.choices = () => (g.hud.choices || []).map((c) => c.label);
  H.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  H.frozen = () => g.hud.modalOpen || g.transitioning || g.ended || !!g.cutscene;
  // Runs the world `sec` seconds without drawing it.
  let simT = 1000;
  H.sim = (sec) => {
    const n = Math.round(sec / 0.05);
    for (let i = 0; i < n; i++) {
      if (H.frozen()) return i * 0.05;
      simT += 0.05;
      g.stepWorld(0.05, simT);
      g.fear.update(0.05);
      g.hud.tick(0.05);
    }
    return sec;
  };
  // Moves the clock to `hhmm`, firing the night's events on the way.
  H.at = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const target = (h < 12 ? 1440 : 0) + h * 60 + m;
    let n = 0;
    while (g.clock.time < target && n++ < 4000) {
      g.clock.update(3, g);
      g.tickTimers(3);
    }
    return g.clock.label;
  };
  // He stays out of the way unless a script wants him.
  H.safe = () => { g.attendant.grace = 1e9; g.attendant.position.set(0, 0, -30); };
  H.st = () => ({
    time: g.clock.label,
    loop: g.state.persistent.loop,
    endings: g.state.persistent.endingsSeen.join(','),
    heard: g.state.persistent.heardStories.length,
    ticket: g.state.ticketParts.join('+'),
    ended: g.ended,
    caught: g.transitioning,
    modal: g.hud.modalOpen,
  });
  H.safe();
}

export async function close({ browser, errors }, name) {
  await browser.close();
  if (errors.length) {
    console.log(`\n${name}: ${errors.length} console error(s)\n` + errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`\n${name}: no console errors`);
  }
}

// Fails the run, with a message, if `ok` is false.
export function check(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) process.exitCode = 1;
}
