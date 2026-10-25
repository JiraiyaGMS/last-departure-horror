// Fires every scare and set piece, and works the machines and the hiding,
// watching for errors and for the world getting stuck.
import { open, close, check } from './lib.mjs';

const s = await open();
const ev = (fn, arg) => s.page.evaluate(fn, arg);

// Every Director scare and every Presence one, with the world running.
const scares = await ev(async () => {
  const g = window.__game;
  const thrown = [];
  for (const e of g.director.events) {
    try {
      const ctx = g.director.buildContext(g.player, g.clock);
      Object.assign(ctx, { dark: true, attendantFar: true, litNearby: true, roomLights: 4 });
      e.run(ctx);
      H.sim(4);
    } catch (err) {
      thrown.push(`${e.id}: ${err.message}`);
    }
  }
  for (const [id, fn] of [['glimpse', () => g.presence.glimpse()], ['face', () => g.presence.flashFace(3)], ['cctv', () => g.presence.cctvHaunt(5)], ['mirror', () => g.presence.mirrorHaunt(5, {})]]) {
    try { fn(); H.sim(3); } catch (err) { thrown.push(`${id}: ${err.message}`); }
  }
  return { n: g.director.events.length, thrown };
});
check(!scares.thrown.length, `${scares.n} Director scares and 4 Presence ones${scares.thrown.length ? ': ' + scares.thrown.join('; ') : ''}`);

// The night's schedule, standing where each set piece is worst.
const stops = [['00:09', [-3, 6]], ['00:29', [16, 5]], ['00:59', [8, 15]], ['01:39', [0, 0]], ['01:59', [-4, 15]], ['02:13', [17.2, -4.5]], ['02:59', [0, -14]], ['03:24', [-10, -28]], ['03:28', null]];
for (const [t, pos] of stops) {
  const r = await ev(([t, pos]) => {
    const g = window.__game;
    if (pos) g.player.teleport(pos[0], pos[1], 0);
    if (t === '02:13') g.watchMonitors();
    H.at(t);
    H.sim(6);
    if (t === '02:13') g.stopWatching();
    return { time: g.clock.label, stuck: g.transitioning || g.ended, att: g.attendant.state };
  }, [t, pos]);
  check(!r.stuck, `${r.time}: set piece ran (he is ${r.att})`);
}

// Hiding, holding your breath, and running out of it -- early in a fresh
// night, so nothing on the schedule gets in the way.
const hide = await ev(() => {
  const g = window.__game;
  g.clock.time = 23 * 60 + 50;
  g.attendant.reset();
  H.safe();
  const spot = g.level.hideSpots[0];
  g.player.teleport(spot.position.x, spot.position.z, 0);
  g.player.enterHide(spot);
  g.player.keys.Space = true;
  H.sim(6);
  g.player.keys.Space = false;
  const r = { gasped: g.player.gasp > 0 || g.player.breath < 0.6, hiding: !!g.player.hiding };
  g.player.exitHide();
  return r;
});
check(hide.hiding && hide.gasped, 'hiding, holding breath until it gives out');

const heard = await ev(() => {
  const g = window.__game;
  const spot = g.level.hideSpots[0];
  g.player.teleport(spot.position.x, spot.position.z, 0);
  g.player.enterHide(spot);
  g.attendant.grace = 0;
  g.attendant.state = 'investigate';
  g.attendant.path = [];
  g.attendant.position.set(spot.position.x + 1.5, 0, spot.position.z);
  H.sim(6);
  return { caught: g.transitioning, line: g.hud.el.subtitle.textContent };
});
check(heard.caught && /breathing/.test(heard.line), `breathing in a hiding place beside him gets you caught ("${heard.line}")`);

await s.page.waitForFunction(() => window.__game.hud.pauseOpen, null, { timeout: 60000 }).catch(() => {});
await ev(() => { const g = window.__game; if (g.hud.pauseOpen) g.resume(); H.safe(); });

// The machines.
const machines = await ev(() => {
  const g = window.__game;
  const r = {};
  H.use('int_pamic');
  g.hud.pick(0);
  r.pa = g.attendant.state === 'investigate';
  H.safe();
  g.state.run.coins = 2;
  H.use('int_jukebox');
  g.hud.pick(2);
  H.sim(1);
  r.jukebox = g.jukeboxDeafens() && g.state.run.coins === 1;
  H.use('int_payphone');
  H.sim(3);
  H.use('int_payphone');
  r.phone = true;
  H.use('int_monitors');
  r.monitors = !!g.player.watching;
  g.stopWatching();
  g.player.teleport(0, 4, 0);
  g.state.run.coins = 1;
  g.throwCoin();
  H.sim(3);
  const c = g.throwables.resting[0]?.position;
  if (c) g.player.teleport(c.x + 0.6, c.z, 0);
  H.sim(0.5);
  r.coin = !!c && g.state.run.coins === 1;
  return r;
});
for (const [k, v] of Object.entries(machines)) check(v, `machine: ${k}`);

await close(s, 'set pieces');
