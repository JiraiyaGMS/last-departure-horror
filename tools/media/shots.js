// Scripted shots for the trailer and screenshots, run by capture.cjs.
//
// Each shot is a cutscene: camera keys (see cutscene.js), and an update that
// moves whatever should move. The game's own scenes are reused where they
// already show the moment (waking up, the endings); the rest are staged here
// with the same figures, posed by the same code the game uses.
import * as THREE from 'three';
import { Shot } from '../../src/cutscene.js';
import { animateWalk, idleSway } from '../../src/figures.js';
import { wakeScene, ENDING_SCENES } from '../../src/scenes.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (u) => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};
const span = (t, t0, t1) => smooth((t - t0) / (t1 - t0));
const mix = (a, b, k) => a + (b - a) * k;
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
// The cinema bars the endings use, on from the first frame.
const BARS = [[0, 1]];

// Walks `fig` along `pts` between t0 and t1 at an even pace (as scenes.js).
function walkAlong(fig, pts, t0, t1, t, dt) {
  const u = clamp01((t - t0) / (t1 - t0));
  const lens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    lens.push(d);
    total += d;
  }
  let want = u * total;
  let i = 0;
  while (i < lens.length - 1 && want > lens[i]) {
    want -= lens[i];
    i++;
  }
  const a = pts[i];
  const b = pts[i + 1] ?? a;
  const k = lens[i] ? want / lens[i] : 1;
  fig.position.set(mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k));
  const moving = t > t0 && t < t1;
  if (moving) {
    fig.rotation.y = yawTo(a[0], a[2], b[0], b[2]);
    animateWalk(fig, total / (t1 - t0), dt);
  }
  fig.userData.poseDirty = true;
  return moving;
}

// Life in the station while the world is frozen: the passengers breathe and
// whatever in the level animates on its own carries on.
function stationLife(g, t, dt) {
  for (const fn of g.refs.animated ?? []) fn(dt);
  let i = 0;
  for (const e of g.echoes.list) {
    idleSway(e.figure, t * 0.4 + i++ * 1.7, false);
    e.figure.userData.poseDirty = true;
  }
}

function staged(g, keys, { start, update, end, frame = null } = {}) {
  const script = {
    name: 'staged',
    duration: 1e6,
    bars: BARS,
    surface: () => 'tile',
    shots: [new Shot(0, keys, frame)],
    start,
    update,
    end,
  };
  return g.playCutscene(script);
}

// The Attendant, borrowed for a shot and standing upright.
function borrowWalter(cs, g) {
  const w = g.attendant.figure;
  cs.borrow(w);
  w.visible = true;
  const rig = w.userData.rig;
  rig.head.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  w.userData.poseDirty = true;
  return w;
}

// The gate corridor, darkened, with him in it. `act(cs, walter, t, dt)` is
// his business; everything is put back when the shot ends.
function darkCorridor(g, act, { seconds, from }) {
  const lights = g.level.lights.filter((l) => l.room === 'gate');
  const saved = lights.map((l) => [l, l.broken, l.flicker]);
  const roy = g.echoes.list.find((e) => e.def.id === 'roy')?.figure;
  const was = g.attendant.position.clone();
  let w;
  const cs = staged(g, [
    { t: 0, p: [0.85, 1.56, -10.4], l: [-0.1, 1.55, -21], ease: 'lin' },
    { t: 7, p: [0.8, 1.55, -10.9], l: [-0.05, 1.62, -21] },
  ], {
    start: (cs) => {
      w = borrowWalter(cs, g);
      w.position.set(...from);
      // Facing up the corridor, towards the camera (figures face -z).
      w.rotation.set(0, Math.PI, 0);
      if (roy) {
        cs.borrow(roy);
        roy.visible = false;
      }
      for (const l of lights) {
        if (l.light.position.z < -16) l.broken = true;
        else l.flicker = 0.9;
      }
      g.player.flashlight.intensity = 20;
    },
    update: (cs, t, dt) => {
      stationLife(g, t, dt);
      act(cs, w, t, dt);
    },
    end: () => {
      for (const [l, broken, flicker] of saved) {
        l.broken = broken;
        l.flicker = flicker;
      }
      g.attendant.position.copy(was);
      g.attendantLightDrain = 0;
      g.player.flashlight.intensity = 0;
    },
  });
  return { cs, seconds };
}

const SHOTS = {
  // Waking on the bench: the lids, the blur, the tube, sitting up.
  wake: (g) => {
    const s = wakeScene(g);
    s.bars = BARS;
    const cs = g.playCutscene(s);
    cs.seek(1.6);
    return { cs, seconds: 7.0 };
  },

  // A slow push down the hall to the departure board, past the sleepers.
  hall: (g) => {
    const cs = staged(g, [
      { t: 0, p: [1.9, 1.62, 6.6], l: [0.3, 2.75, -9.1], ease: 'lin' },
      { t: 6.5, p: [0.7, 1.6, 0.4], l: [0.0, 2.95, -9.1] },
    ], { update: (cs, t, dt) => stationLife(g, t, dt) });
    return { cs, seconds: 6.0 };
  },

  // The 3:33 at Bay 9: he punches the ticket, steps aside, the door folds open.
  bus: (g) => {
    const s = ENDING_SCENES.coast(g);
    const cs = g.playCutscene(s);
    cs.seek(4.7);
    return { cs, seconds: 4.2 };
  },

  // The rules on the hall wall.
  rules: (g) => {
    const cs = staged(g, [
      { t: 0, p: [-8.95, 1.8, -0.2], l: [-10.63, 1.86, -0.92], ease: 'lin' },
      { t: 4.5, p: [-8.95, 1.76, -1.75], l: [-10.63, 1.82, -1.08] },
    ], { update: (cs, t, dt) => stationLife(g, t, dt) });
    return { cs, seconds: 4.0 };
  },

  // Him, coming up the gate corridor out of the dark, and stopping. The
  // far tube is out; the near one stutters the closer he gets, the way the
  // lights do around him in the game, and the torch is on.
  attendant: (g) => darkCorridor(g, (cs, w, t, dt) => {
    const moving = walkAlong(w, [[-0.3, 0, -21.5], [0.0, 0, -15.6]], 0, 5.0, t, dt);
    const rig = w.userData.rig;
    if (!moving) {
      idleSway(w, t, false);
      rig.head.rotation.z = 0.42 * span(t, 5.3, 6.2);
      rig.head.rotation.x = -0.12 * span(t, 5.3, 6.2);
    }
    g.attendant.position.copy(w.position);
    g.attendantLightDrain = 0.95 * span(t, 1.5, 4.8);
    w.userData.poseDirty = true;
  }, { seconds: 6.6, from: [-0.3, 0, -21.5] }),

  // From under a bench in the hall, his feet going by, and stopping.
  hide: (g) => {
    let w;
    const cs = staged(g, [
      { t: 0, p: [0.95, 0.27, 5.42], l: [1.4, 0.38, 9.5], ease: 'lin' },
      { t: 6, p: [0.95, 0.27, 5.44], l: [1.25, 0.42, 9.5] },
    ], {
      start: (cs) => {
        w = borrowWalter(cs, g);
        w.position.set(-3.6, 0, 6.85);
      },
      update: (cs, t, dt) => {
        stationLife(g, t, dt);
        const moving = walkAlong(w, [[-3.6, 0, 6.85], [1.15, 0, 6.85]], 0.2, 4.0, t, dt);
        if (!moving) {
          // Turns to the bench.
          w.rotation.y += (0 - w.rotation.y) * Math.min(1, dt * 3);
          idleSway(w, t, false);
        }
        w.userData.poseDirty = true;
      },
    });
    return { cs, seconds: 5.5 };
  },

  // The security console: four feeds, him at the lens on one, and the
  // thing on camera four.
  cctv: (g) => {
    const screens = g.cctv.monitors.screens.map((s) => s.getWorldPosition(new THREE.Vector3()));
    const centre = screens.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / screens.length);
    const all = g.cctv.poses.all;
    const one = g.cctv.poses.one[3];
    const p0 = [all.x, all.eye, all.z];
    const p1 = [mix(all.x, one.x, 0.55), mix(all.eye, one.eye, 0.55), mix(all.z, one.z, 0.55)];
    const l1 = centre.clone().lerp(screens[3], 0.6);
    const cs = staged(g, [
      { t: 0, p: p0, l: [centre.x, centre.y, centre.z], ease: 'io' },
      { t: 5, p: p1, l: [l1.x, l1.y, l1.z] },
    ], {
      start: () => {
        g.player.watching = { focus: -1 };
        g.camera4Active = true;
        g.state.persistent.sawCamera4 = 0;
        g.presence.cctvStare = { cam: 2, variant: 2, until: 1e6 };
        g.cctv.stale = true;
      },
      update: (cs, t, dt) => {
        stationLife(g, t, dt);
        g.cctv.update(dt);
        g.cctv.render();
      },
      end: () => {
        g.player.watching = null;
        g.camera4Active = false;
        g.presence.cctvStare = null;
        g.cctv.reset();
      },
    });
    return { cs, seconds: 4.5 };
  },

  // Every passenger on the 3:33 turning, all at once, to look at you.
  ghosts: (g) => {
    const s = ENDING_SCENES.coast(g);
    const cs = g.playCutscene(s);
    // The rows of them, bowed, with the lamps going by; then all at once.
    const turnAt = s.duration - 3.4;
    cs.seek(turnAt - 2.9);
    return { cs, seconds: 3.6 };
  },

  // The thing in the driver's seat at Bay 0, its head coming all the way round.
  bay0: (g) => {
    const s = ENDING_SCENES.bay0(g);
    const cs = g.playCutscene(s);
    cs.seek(25.0);
    return { cs, seconds: 4.2 };
  },

  // The cover: him, stopped in the corridor, looking down at you.
  cover: (g) => {
    const shot = darkCorridor(g, (cs, w, t) => {
      w.position.set(0.05, 0, -14.6);
      g.attendant.position.copy(w.position);
      g.attendantLightDrain = 0.5;
      idleSway(w, t, false);
      const rig = w.userData.rig;
      rig.head.rotation.z = 0.3;
      rig.head.rotation.x = 0.16;
      w.userData.poseDirty = true;
    }, { seconds: 1, from: [0.05, 0, -14.6] });
    shot.cs.shots[0] = new Shot(0, [
      { t: 0, p: [0.32, 1.12, -11.35], l: [0.02, 1.62, -14.6] },
      { t: 10, p: [0.32, 1.12, -11.35], l: [0.02, 1.62, -14.6] },
    ]);
    return shot;
  },

  // The rules sign whole, on its wall, for a screenshot.
  sign: (g) => {
    const cs = staged(g, [
      { t: 0, p: [-7.35, 1.72, -0.55], l: [-10.63, 1.86, -1.0] },
      { t: 10, p: [-7.35, 1.72, -0.55], l: [-10.63, 1.86, -1.0] },
    ], { update: (cs, t, dt) => stationLife(g, t, dt) });
    return { cs, seconds: 1 };
  },

  // Him, stopped in the corridor, from straight in front, for a screenshot.
  corridor: (g) => {
    const shot = darkCorridor(g, (cs, w, t) => {
      w.position.set(0.0, 0, -15.6);
      g.attendant.position.copy(w.position);
      g.attendantLightDrain = 0.95;
      idleSway(w, t, false);
      const rig = w.userData.rig;
      rig.head.rotation.z = 0.42;
      rig.head.rotation.x = -0.12;
      w.userData.poseDirty = true;
    }, { seconds: 1, from: [0.0, 0, -15.6] });
    shot.cs.shots[0] = new Shot(0, [
      { t: 0, p: [0.02, 1.58, -10.7], l: [0.0, 1.5, -21] },
      { t: 10, p: [0.02, 1.58, -10.7], l: [0.0, 1.5, -21] },
    ]);
    return shot;
  },

  // His face, at the lens, in the same corridor.
  face: (g) => {
    let flashed = false;
    return darkCorridor(g, (cs, w, t) => {
      w.position.set(0.0, 0, -15.6);
      g.attendant.position.copy(w.position);
      g.attendantLightDrain = 1;
      if (t >= 0.25 && !flashed) {
        flashed = true;
        g.presence.flashFace(0, 0.9);
      }
    }, { seconds: 1.4, from: [0.0, 0, -15.6] });
  },
};

// Starts shot `name`. Returns how many frames it runs and how to end it.
export function begin(g, name, fps = 24, { bars = true, hud = false } = {}) {
  const make = SHOTS[name];
  if (!make) throw new Error(`no shot ${name}`);
  g.cutscene?.finish();
  g.ended = false;
  // Nothing from the last shot carries over: no face on screen, no static.
  const pr = g.presence;
  pr.faceFrames = 0;
  pr.faceHold = 0;
  pr.faceMesh.visible = false;
  g.fear.reset();
  const { cs, seconds } = make(g);
  // A screenshot rather than a trailer frame: no cinema bars.
  if (!bars) cs.bars = () => 0;
  if (hud) {
    // A screenshot of play: the HUD up, with the clock somewhere along the
    // night (minutes past midnight).
    const clock = { hall: 1432, rules: 1461, sign: 1461, attendant: 1558, corridor: 1558, hide: 1601, cctv: 1576 }[name];
    if (clock) g.clock.time = clock;
    g.refs.board?.redraw();
    g.refs.wallClock?.redraw();
    g.cameraViews = g.describeCameras();
    g.refs.monitors?.redraw();
    g.state.run.hasFlashlight = ['attendant', 'corridor', 'hide', 'cctv'].includes(name);
    g.hud.el.hud.classList.remove('cinematic');
    document.body.classList.remove('incutscene');
  }
  return {
    cs,
    frames: Math.round(seconds * fps),
    preroll: 3,
    end: () => cs.finish(),
  };
}

export const NAMES = Object.keys(SHOTS);
