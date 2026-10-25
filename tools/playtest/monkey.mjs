// Plays at random for a while: keys pressed in any order, menus opened over
// menus, settings changed at bad moments, the window resized, scares fired,
// getting caught. Checks that nothing throws, that nothing is left stuck, and
// that the game can still be played at the end of it.
//
// Seeded, so a failure can be replayed: node monkey.mjs [url] with SEED=n.
// DIFFICULTY=terror plays it in Terror mode.
import { open, close, check } from './lib.mjs';

const SEED = Number(process.env.SEED ?? 1987);
const STEPS = Number(process.env.STEPS ?? 260);

let a = SEED;
const rand = () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

const s = await open({ settings: process.env.DIFFICULTY ? { difficulty: process.env.DIFFICULTY } : {} });
const { page } = s;
const ev = (fn, arg) => page.evaluate(fn, arg);

const KEYS = ['Tab', 'KeyM', 'ArrowLeft', 'ArrowRight', 'Escape', 'KeyE', 'KeyF', 'KeyG', 'KeyB', 'KeyR', 'KeyC', 'Space', 'KeyQ', 'Digit1', 'Digit2', 'KeyP', 'Enter', 'ArrowUp', 'ArrowDown'];
const SIZES = [[480, 270], [844, 390], [390, 844], [1280, 720], [640, 360]];

const actions = [
  // A key, any key.
  [6, async () => { await page.keyboard.press(pick(KEYS)); return 'key'; }],
  // Walk somewhere for a moment.
  [3, async () => {
    const k = pick(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
    await page.keyboard.down(k);
    if (rand() < 0.3) await page.keyboard.down('ShiftLeft');
    await ev((sec) => H.sim(sec), 0.5 + rand() * 2);
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up(k);
    return 'walk';
  }],
  // Somewhere else in the station.
  [2, async () => {
    const spots = [[-3, 6], [0, -14], [8, 15], [-15, 5], [17, -5], [-8, -28], [16, 5], [-7, 15], [-17, -6], [24, 17], [34, 6], [-17, -15]];
    const [x, z] = pick(spots);
    await ev(([x, z, yaw]) => { const g = window.__game; if (!H.frozen()) g.player.teleport(x, z, yaw); }, [x, z, rand() * 6.28]);
    return 'teleport';
  }],
  // Let the night run.
  [3, async () => { await ev((sec) => H.sim(sec), 1 + rand() * 4); return 'sim'; }],
  // Use whatever is in front of you, the way E would.
  [2, async () => {
    return ev(() => {
      const g = window.__game;
      if (H.frozen()) return 'use (frozen)';
      const target = g.bestInteractable();
      if (!target) return 'use (nothing)';
      const id = target.spot ? target.spot.id : target.it.id;
      try { g.tryInteract(); } catch (e) { throw new Error(`using ${id}: ${e.message}`); }
      return 'use ' + id;
    });
  }],
  // The station misbehaves.
  [2, async () => {
    return ev((r) => {
      const g = window.__game;
      const events = g.director.events;
      const e = events[Math.floor(r * events.length)];
      const ctx = g.director.buildContext(g.player, g.clock);
      e.run(ctx);
      return 'scare ' + e.id;
    }, rand());
  }],
  // Later in the night.
  [1, async () => {
    const t = pick(['00:30', '01:05', '01:45', '02:20', '03:10', '03:27']);
    return ev((t) => { if (!H.frozen()) H.at(t); return 'clock ' + window.__game.clock.label; }, t);
  }],
  // Settings, changed from the pause menu at whatever moment this is.
  [2, async () => {
    return ev((r) => {
      const g = window.__game;
      if (!g.hud.pauseOpen) g.pause();
      if (!g.hud.pauseOpen) return 'settings (could not pause)';
      document.querySelector('#pause button[data-open="settings"]')?.click();
      const inputs = [...document.querySelectorAll('#settings input, #settings select')].filter((el) => el.getClientRects().length);
      const el = inputs[Math.floor(r * inputs.length)];
      if (!el) return 'settings (none)';
      if (el.type === 'checkbox') el.checked = !el.checked;
      else if (el.type === 'range') el.value = String(Number(el.min) + (Number(el.max) - Number(el.min)) * ((r * 7.3) % 1));
      else if (el.tagName === 'SELECT') el.selectedIndex = Math.floor(((r * 13.7) % 1) * el.options.length);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'setting ' + (el.id || el.className);
    }, rand());
  }],
  // The window changes shape.
  [1, async () => { const [w, h] = pick(SIZES); await page.setViewportSize({ width: w, height: h }); return `resize ${w}x${h}`; }],
  // Caught.
  [1, async () => {
    await ev(() => { const g = window.__game; if (!H.frozen()) g.onCaught('The monkey was caught.'); });
    await page.waitForTimeout(3600);
    return 'caught';
  }],
];
const total = actions.reduce((n, [w]) => n + w, 0);

// Gets back to plain play from wherever the monkey left things.
const settle = async () => {
  for (let i = 0; i < 12; i++) {
    const st = await ev(() => {
      const g = window.__game;
      if (g.hud.dialsOpen) g.hud.closeDials();
      if (g.hud.readerOpen) g.hud.closeDocument();
      if (g.hud.notebookOpen) g.closeNotebook();
      if (g.hud.endingOpen) document.getElementById('endbtn')?.click();
      for (const id of ['settings', 'controls', 'credits']) {
        if (!document.getElementById(id)?.classList.contains('hidden')) g.hud.showScreen('pause');
      }
      if (g.hud.pauseOpen) g.resume();
      if (g.player.hiding) g.player.exitHide?.();
      if (g.player.watching) g.stopWatching?.();
      if (g.player.inspecting) g.stopInspecting?.();
      return { frozen: H.frozen(), modal: g.hud.modalOpen, transitioning: g.transitioning, ended: g.ended, cutscene: !!g.cutscene };
    });
    if (!st.frozen) return st;
    await page.waitForTimeout(800);
  }
  return ev(() => ({ frozen: H.frozen(), modal: window.__game.hud.modalOpen, transitioning: window.__game.transitioning, ended: window.__game.ended, cutscene: !!window.__game.cutscene }));
};

const log = [];
let stuck = null;
for (let i = 0; i < STEPS; i++) {
  let r = rand() * total;
  const [, act] = actions.find(([w]) => (r -= w) < 0) ?? actions[0];
  let what;
  try {
    what = await act();
  } catch (e) {
    what = 'THREW ' + e.message.split('\n')[0];
    check(false, `step ${i}: ${what}`);
  }
  log.push(what);
  // A wake-up or a caught screen is part of the game; the monkey wakes up.
  if (i % 12 === 11) {
    const st = await settle();
    if (st.frozen) {
      stuck = `after step ${i} (${log.slice(-6).join(', ')}): ${JSON.stringify(st)}`;
      break;
    }
  }
}
check(!stuck, `${log.length} random actions without getting stuck${stuck ? ': ' + stuck : ''}`);

// Still playable: the notebook opens on both pages, and you can walk.
await page.setViewportSize({ width: 480, height: 270 });
const end = await settle();
check(!end.frozen, `back to plain play at the end (${JSON.stringify(end)})`);
await page.keyboard.press('Tab');
const notes = await ev(() => [window.__game.hud.notebookOpen, window.__game.hud.notebookTab]);
await page.keyboard.press('ArrowRight');
const map = await ev(() => [window.__game.hud.notebookTab, !!document.querySelector('#notebookmap svg.stationmap')]);
await page.keyboard.press('Tab');
check(notes[0] && map[0] !== notes[1] && (map[0] === 'notes' || map[1]), `the notebook still opens and turns to its map (${JSON.stringify({ notes, map })})`);
const moved = await ev(() => {
  const g = window.__game;
  g.player.teleport(-3, 6, Math.PI);
  const before = g.player.position.clone();
  g.player.keys.KeyW = true;
  H.sim(1);
  g.player.keys.KeyW = false;
  return before.distanceTo(g.player.position);
});
check(moved > 0.5, `and you can still walk (${moved.toFixed(2)} m in a second)`);

await close(s, 'monkey');
