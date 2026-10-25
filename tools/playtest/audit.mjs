// For every interactable and hiding place: is there somewhere a player can
// stand where aiming at it offers it? And can any be used through a wall?
// Checked against the game's own colliders and its own bestInteractable().
import { open, close, check } from './lib.mjs';

const s = await open({ width: 320, height: 180 });

const report = await s.page.evaluate(() => {
  const g = window.__game;
  g.hud.pauseOpen = true; // hold the world still while we probe it
  const cols = g.level.colliders;
  const R = 0.34;
  const ROOMS = {
    bays: [-26, -40, 26, -22], gate: [-4, -22, 4, -10], hall: [-11, -10, 11, 10], ticket: [-23, -10, -11, -2],
    manager: [-23, -20, -11, -10], lostfound: [-23, 0, -11, 10], cctv: [11, -10, 23, -2], diner: [11, 0, 23, 10],
    restroom: [-13, 10, -1, 20], baggage: [1, 10, 21, 24], tunnel: [21, 14, 29, 20], bay0: [29, -10, 41, 20],
  };
  const roomOf = (x, z) => Object.keys(ROOMS).find((k) => { const [a, b, c, d] = ROOMS[k]; return x >= a && x <= c && z >= b && z <= d; }) ?? null;
  // Somewhere the player's body fits.
  const free = (x, z) => {
    if (!roomOf(x, z)) return false;
    for (const c of cols) {
      if (c.top <= 0.3) continue;
      if (c.bottom !== undefined && c.bottom >= 1.68) continue;
      const cx = Math.max(c.x1, Math.min(x, c.x2));
      const cz = Math.max(c.z1, Math.min(z, c.z2));
      if ((x - cx) ** 2 + (z - cz) ** 2 < R * R) return false;
    }
    return true;
  };
  // A wall between, not counting whatever the target sits on or in.
  const blocked = (ax, az, bx, bz) => {
    const dx = bx - ax;
    const dz = bz - az;
    for (const c of cols) {
      if (c.top < 1.6) continue;
      if (bx > c.x1 - 0.35 && bx < c.x2 + 0.35 && bz > c.z1 - 0.35 && bz < c.z2 + 0.35) continue;
      let tmin = 0; let tmax = 1; let hit = true;
      for (const [o, d, lo, hi] of [[ax, dx, c.x1, c.x2], [az, dz, c.z1, c.z2]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { hit = false; break; } continue; }
        let t1 = (lo - o) / d; let t2 = (hi - o) / d; if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) { hit = false; break; }
      }
      if (hit) return true;
    }
    return false;
  };
  g.level.unlockDoor?.('managerDoor');
  g.level.unlockDoor?.('tunnelDoor');
  const cam = g.camera;
  const aim = (x, eye, z, tx, ty, tz) => {
    g.player.position.set(x, 0, z);
    cam.position.set(x, eye, z);
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, ty, tz);
    cam.updateMatrixWorld(true);
    return g.bestInteractable();
  };
  const out = { unreachable: [], throughWall: [], ok: 0, spotsBad: [], spots: g.level.hideSpots.length };
  for (const it of g.level.interactables) {
    // The passengers are people: they are where they are sitting.
    if (it.id.startsWith('int_echo_')) continue;
    const was = [it.enabled, it.enabledWhen];
    it.enabled = true;
    it.enabledWhen = null;
    let good = 0;
    const wall = [];
    for (let d = 0.45; d < it.radius; d += 0.25) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
        const x = it.position.x + Math.cos(a) * d;
        const z = it.position.z + Math.sin(a) * d;
        if (!free(x, z)) continue;
        for (const eye of [1.68, 1.0]) {
          if (aim(x, eye, z, it.position.x, it.position.y, it.position.z)?.it !== it) continue;
          if (blocked(x, z, it.position.x, it.position.z)) wall.push(`${x.toFixed(1)},${z.toFixed(1)}`);
          else good++;
        }
      }
    }
    [it.enabled, it.enabledWhen] = was;
    if (good) out.ok++;
    else out.unreachable.push(it.id);
    if (wall.length) out.throughWall.push(`${it.id} from ${wall[0]}`);
  }
  for (const spot of g.level.hideSpots) {
    let good = 0;
    for (let d = 0.3; d < 1.7 && !good; d += 0.2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const x = spot.position.x + Math.cos(a) * d;
        const z = spot.position.z + Math.sin(a) * d;
        if (!free(x, z)) continue;
        if (aim(x, 1.68, z, spot.position.x, 0.6, spot.position.z)?.spot === spot && !blocked(x, z, spot.position.x, spot.position.z)) good++;
      }
    }
    if (!good) out.spotsBad.push(spot.id);
  }
  g.hud.pauseOpen = false;
  return out;
});

check(report.unreachable.length === 0, `every interactable usable from the floor (${report.ok} ok${report.unreachable.length ? `; not: ${report.unreachable.join(', ')}` : ''})`);
check(report.throughWall.length === 0, `nothing usable through a wall${report.throughWall.length ? `: ${report.throughWall.join('; ')}` : ''}`);
check(report.spotsBad.length === 0, `every hiding place can be got into (${report.spots - report.spotsBad.length}/${report.spots})`);
await close(s, 'audit');
