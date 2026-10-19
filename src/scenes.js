import * as THREE from 'three';
import { Shot } from './cutscene.js';
import { sitPose, animateWalk, idleSway } from './figures.js';
import { WAKE } from './content.js';
import { lieDown } from './sets.js';
import { roomAt, ROOMS } from './level.js';

// The scripts: waking on the bench, and the four ways out of the station.
// Every one is first person. Times are seconds from the start of the scene;
// positions are metres in the world, or in the coach's own space for shots
// that ride inside it (x across, +z toward the windscreen, floor at y 1.05).

// Where the passengers sat on the 11:47, by the manifest.
const SEATS = {
  marguerite: 2, dale: 4, imelda: 5, tobias: 7, nina: 9, roy: 11, lorraine: 12,
  curtis: 14, vernon: 16, eunice: 18, harold: 19, dwight: 21, otis: 24, claudette: 0,
};
// Yours: the door-side window of row 7, where the lamps go by, between two
// pillars so there is glass to look through.
const MY_SEAT = 28;
const EYE = 1.66;
const CABIN_EYE = 1.05 + 1.62;
const SEATED_EYE = 1.505 + 0.79;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (u) => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};
// 0 before t0, 1 after t1, eased between.
const span = (t, t0, t1) => smooth((t - t0) / (t1 - t0));
const mix = (a, b, k) => a + (b - a) * k;
// The yaw that turns a figure (they face -z) from one point toward another.
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

function surfaceAt(p) {
  const room = roomAt(p.x, p.z);
  return room && ROOMS[room]?.surface === 'concrete' ? 'concrete' : 'tile';
}

// The camera as it is now, as a scene's first key.
function here(game, t = 0) {
  const cam = game.camera;
  const dir = cam.getWorldDirection(new THREE.Vector3());
  return { t, p: cam.position.clone(), l: cam.position.clone().addScaledVector(dir, 4) };
}

// Undoes a sit: legs and arms back to hanging, root back on the floor.
function standUp(fig) {
  const rig = fig.userData.rig;
  if (!rig) return;
  fig.userData.seated = false;
  for (const j of rig.legs) j.rotation.set(0, 0, 0);
  for (const j of rig.shins) j.rotation.set(0, 0, 0);
  rig.arms[0].rotation.set(0, 0, -0.07);
  rig.arms[1].rotation.set(0, 0, 0.07);
  for (const e of rig.forearms) e.rotation.set(0.1, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.pelvis.position.y = rig.pelvisY;
  fig.userData.poseDirty = true;
}

// Seats `fig` in the cabin at seat `s`, facing the windscreen.
function seatIn(cs, sets, fig, s) {
  cs.adopt(fig, sets.cabin);
  const lift = sitPose(fig, s.y);
  fig.position.set(s.x, lift, s.z);
  fig.rotation.set(0, Math.PI, 0);
  fig.visible = true;
  fig.userData.poseDirty = true;
}

function setOpacity(fig, v) {
  for (const m of fig.userData.materials ?? []) {
    if (m.transparent || m.userData.ghost) m.opacity = v;
  }
}

// Walks `fig` along `pts` (in its parent's space) between t0 and t1 at an
// even pace, facing where it is going and moving its legs. Returns whether it
// is still walking.
function walkAlong(fig, pts, t0, t1, t, dt) {
  const u = clamp01((t - t0) / (t1 - t0));
  let total = 0;
  const lens = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2], pts[i][1] - pts[i - 1][1]);
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
    if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.01) fig.rotation.y = yawTo(a[0], a[2], b[0], b[2]);
    animateWalk(fig, total / (t1 - t0), dt);
  } else {
    idleSway(fig, t, false);
  }
  fig.userData.poseDirty = true;
  return moving;
}

// Eases a joint's rotation toward `target` ([x, y, z], nulls left alone).
function ease(joint, target, dt, rate = 5) {
  const k = Math.min(1, dt * rate);
  if (target[0] !== null && target[0] !== undefined) joint.rotation.x += (target[0] - joint.rotation.x) * k;
  if (target[1] !== null && target[1] !== undefined) joint.rotation.y += (target[1] - joint.rotation.y) * k;
  if (target[2] !== null && target[2] !== undefined) joint.rotation.z += (target[2] - joint.rotation.z) * k;
}

// Turns a seated figure's head toward a world point, up to `limit` and past
// where a neck should go if asked.
function headToward(fig, world, dt, limit = 1.1, rate = 5) {
  const rig = fig.userData.rig;
  if (!rig) return;
  const local = fig.worldToLocal(world.clone());
  // Figures face -z in their own space.
  const want = Math.atan2(-local.x, -local.z);
  const target = Math.max(-limit, Math.min(limit, want));
  rig.head.rotation.y += (target - rig.head.rotation.y) * Math.min(1, dt * rate);
  fig.userData.poseDirty = true;
}

// ---- waking up ----------------------------------------------------------

// The bench you wake on: the west half of the middle bench in the back row,
// in the hall. It faces the south wall; the board is behind you. You lie with
// your head on the middle armrest and your feet toward the flickering tube.
const BENCH = { x: -0.45, y: 0.465, z: 5.5 };

export function wakeScene(game) {
  const p = game.state.persistent;
  const loop = p.loop;
  const first = loop <= 1 && !p.lastNight;
  const pick = (list) => list[(loop * 7 + 3) % list.length];

  // What comes back this time.
  const lines = [];
  if (first) {
    lines.push(...WAKE.first);
  } else {
    if (p.lastNight && WAKE.after[p.lastNight]) lines.push(pick(WAKE.after[p.lastNight]));
    const m = loop - 2;
    lines.push(m >= 0 && m < WAKE.memories.length ? WAKE.memories[m] : pick(WAKE.later));
  }
  lines.push(WAKE.end(loop));

  // The long version the first night; after that the body knows the way.
  const k = first ? 1 : 0.72;
  const T = (s) => s * k;
  const duration = T(16.6);

  const eyeLie = [BENCH.x, BENCH.y + 0.16, BENCH.z + 0.04];
  const tube = [-5.5, 4.15, 5.0];
  const shots = [new Shot(0, [
    // Flat on your back, looking down yourself at the tube that flickers.
    { t: 0, p: eyeLie, l: [tube[0] + 0.6, tube[1] - 0.1, tube[2] + 0.3], roll: 0.14 },
    { t: T(3.6), p: eyeLie, l: [tube[0] + 1.2, tube[1] - 0.2, tube[2] + 0.6], roll: 0.08 },
    // Head to the side: the hall, sideways, along the floor.
    { t: T(5.4), p: [BENCH.x - 0.02, BENCH.y + 0.2, BENCH.z + 0.07], l: [BENCH.x - 0.8, 0.8, BENCH.z + 4.5], roll: 1.2 },
    // Sit up, feet down off the front of the seat: the restroom door, lit.
    { t: T(7.8), p: [BENCH.x - 0.3, BENCH.y + 0.74, BENCH.z + 0.1], l: [-4.0, 1.05, 10.0], roll: 0 },
    // Along the row: Marguerite, on the next bench, in her pink coat.
    { t: T(9.6), p: [BENCH.x - 0.3, BENCH.y + 0.74, BENCH.z + 0.12], l: [-5.4, 1.05, 5.9], roll: 0.02 },
    { t: T(10.8), p: [BENCH.x - 0.32, BENCH.y + 0.76, BENCH.z + 0.14], l: [-3.4, 1.2, 9.5], roll: 0 },
    // On your feet, and round to face the board.
    { t: T(12.0), p: [BENCH.x - 0.45, EYE + 0.02, BENCH.z + 0.62], l: [-4.2, 1.6, 8.8], walk: true, ease: 'lin' },
    { t: T(13.2), p: [-2.2, 1.68, 6.25], l: [-7.5, 1.7, 4.2], walk: true, ease: 'lin' },
    { t: T(14.6), p: [-3.2, 1.68, 6.0], l: [-3.4, 2.4, -9.0] },
    { t: duration, p: [-3.2, 1.68, 6.0], l: [-3.2, 1.68, -4.0] },
  ])];

  const events = [];
  let at = first ? 1.5 : 1.3;
  for (const [i, line] of lines.entries()) {
    const last = i === lines.length - 1;
    const len = Math.max(3.6, Math.min(5.6, line.length * 0.055));
    const when = last ? Math.max(at, duration - 3.9) : at;
    events.push([when, () => (last ? game.subtitle(line, 4.5) : game.hud.narrate(line, len))]);
    at = when + len + 0.25;
  }
  events.push([0.9, () => game.audio.splitFlap(18, game.boardEmitter?.gain)]);
  events.push([T(6.8), () => game.audio.gasp?.()]);

  return {
    name: 'wake',
    duration,
    surface: surfaceAt,
    shots,
    events,
    black: [[0, 1], [0.7, 1], [1.3, 0]],
    lids: first
      ? [[0, 1], [1.5, 1], [2.0, 0.55], [2.4, 0.95], [3.1, 0.4], [3.5, 0.78], [4.6, 0.15], [5.6, 0.05], [7.0, 0], [8.2, 0.6], [8.45, 0], [12, 0]]
      : [[0, 1], [1.2, 1], [1.7, 0.45], [2.0, 0.85], [2.8, 0.1], [3.6, 0], [8.2, 0]],
    blur: first ? [[0, 9], [2.4, 7], [4.6, 3], [6.4, 0.6], [7.5, 0]] : [[0, 7], [2.4, 3], [4.2, 0]],
    start() {
      game.audio.setHumLevel(0.085);
    },
  };
}

// ---- the door of the 3:33 ---------------------------------------------------

// The coach at Bay 9, in the world, and its door (the middle of the doorway,
// on the outside of the body).
const BAY9 = { x: -22, z: -31.3 };
const DOOR_Z = BAY9.z + 4.69;
const DOOR_X = BAY9.x - 1.25;
// Where Walter waits, between the platform and the door, and where you stand
// to give him the ticket.
const WALTER = [-23.95, 0, -26.0];
const FACE = [-25.05, EYE, -27.2];

// Your ticket on its way into Walter's hand: shown in his palm.
function ticketInHand(sets, fig) {
  const rig = fig.userData.rig;
  sets.ticket.visible = true;
  rig.forearms[1].add(sets.ticket);
  sets.ticket.position.set(0, -0.41 * rig.scale, -0.035);
  sets.ticket.rotation.set(-1.25, 0, 0.2);
}

// Shared by the three endings at Bay 9: the walk up to the door, Walter, the
// door folding open, and climbing the steps into the cabin to the top of the
// stair well. `beats(cs, t, dt, walter)` is Walter's own business at the door.
// Returns pieces a scene assembles.
function boarding(game, { walterBeats, doorAt = 6.6, climbAt = 7.6 }) {
  const sets = game.sets;
  const bus = game.refs.bus;
  const walter = game.attendant.figure;
  const start = here(game);
  // Round the nose of the bus if you were standing on its far side.
  const lead = start.p.x > DOOR_X - 0.1 ? [{ t: 1.0, p: [-24.1, EYE, -25.0], l: [-23.6, 1.7, -25.9], walk: true, ease: 'lin' }] : [];
  const top = [-0.62, CABIN_EYE, 4.72];
  const shotA = new Shot(0, [
    { ...start, walk: true },
    ...lead,
    { t: 2.2, p: FACE, l: [WALTER[0], 1.6, WALTER[2]] },
    { t: doorAt - 0.4, p: FACE, l: [WALTER[0] + 0.05, 1.5, WALTER[2] - 0.05] },
    { t: climbAt, p: [FACE[0] + 0.15, EYE, FACE[2] + 0.15], l: [DOOR_X, 1.25, DOOR_Z], walk: true, ease: 'lin' },
    { t: climbAt + 1.0, p: [DOOR_X - 0.75, EYE, DOOR_Z - 0.02], l: [DOOR_X + 1.2, 1.6, DOOR_Z + 0.1], walk: true, ease: 'lin' },
    { t: climbAt + 1.7, p: [DOOR_X - 0.2, 0.42 + 1.64, DOOR_Z], l: [DOOR_X + 1.5, 2.0, DOOR_Z - 0.2], walk: true, ease: 'lin', stride: 0.8 },
    { t: climbAt + 2.3, p: [DOOR_X + 0.2, 0.74 + 1.64, DOOR_Z - 0.01], l: [DOOR_X + 1.6, 2.5, DOOR_Z - 0.9], walk: true, ease: 'lin', stride: 0.8 },
    { t: climbAt + 3.0, p: [BAY9.x + top[0], top[1], BAY9.z + top[2]], l: [BAY9.x + 0.2, 2.3, BAY9.z - 3.0] },
  ]);
  const inside = climbAt + 3.0;
  const events = [
    [doorAt, (cs) => {
      cs.soundAt(DOOR_X, DOOR_Z, (d) => game.audio.doorHiss(d));
      sets.cabinIn(bus);
      sets.cabin.userData.door.leaves.visible = false;
    }],
    // In the doorway: from here on the windows are the cabin's own.
    [climbAt + 1.6, () => {
      if (bus.userData.glass) bus.userData.glass.visible = false;
    }],
  ];
  const update = (cs, t, dt) => {
    bus.userData.door.set(span(t, doorAt, doorAt + 1.1) * (1 - (cs.doorClosing ?? 0)));
    if (sets.rig.visible) sets.cabinLights(cs.cabinPower ?? span(t, doorAt - 0.2, doorAt + 0.6), cs.cabinColor);
    walterBeats(cs, t, dt, walter);
  };
  const begin = (cs) => {
    cs.borrow(walter);
    cs.borrow(bus);
    cs.borrow(bus.userData.door.leaves[0]);
    cs.borrow(bus.userData.door.leaves[1]);
    if (bus.userData.glass) cs.borrow(bus.userData.glass);
    walter.position.set(...WALTER);
    walter.rotation.set(0, yawTo(WALTER[0], WALTER[2], FACE[0], FACE[2]), 0);
    walter.visible = true;
    standUp(walter);
    sets.cabin.userData.door.set(0);
  };
  return { shotA, top, inside, events, update, begin };
}

// Walter takes what you hand him, looks at it a long time, and punches or
// stamps it. Times are where each beat lands; `after` runs on from there.
function walterTakes(cs, t, dt, walter, { reach = 1.4, look = 2.8, mark = 5.2, aside = 6.0, markSound }) {
  const rig = walter.userData.rig;
  if (!rig) return;
  const out = span(t, reach, reach + 0.6) * (1 - span(t, mark + 0.4, mark + 1.0));
  ease(rig.arms[1], [out * 1.05, null, 0.07], dt, 8);
  ease(rig.forearms[1], [0.1 + out * 0.55, null, null], dt, 8);
  const down = span(t, look, look + 0.5) * (1 - span(t, mark + 0.3, mark + 0.8));
  ease(rig.head, [down * 0.5, null, null], dt, 6);
  if (t >= reach + 0.5 && !cs.ticketGiven) {
    cs.ticketGiven = true;
    cs.borrow(cs.game.sets.ticket);
    ticketInHand(cs.game.sets, walter);
    cs.game.audio.paper();
  }
  if (t >= mark && !cs.marked) {
    cs.marked = true;
    markSound?.();
  }
  if (t >= mark + 1.0 && cs.game.sets.ticket.visible && !cs.keepTicket) cs.game.sets.ticket.visible = false;
  // Then he steps aside, onto the platform, and turns to watch the door.
  if (t >= aside) {
    const moving = walkAlong(walter, [WALTER, [-24.05, 0, -25.4], [-24.25, 0, -24.75]], aside, aside + 1.4, t, dt);
    if (!moving && t > aside + 1.4) {
      walter.rotation.y += (yawTo(-24.25, -24.75, DOOR_X, DOOR_Z) - walter.rotation.y) * Math.min(1, dt * 3);
    }
  } else {
    idleSway(walter, t, false);
  }
}

// Fourteen of them in their seats on the 3:33.
function boardPassengers(cs, game, { bowed = 0, opacity = 0.42 } = {}) {
  const sets = game.sets;
  const out = [];
  for (const echo of game.echoes.list) {
    const s = sets.seat(SEATS[echo.def.id]);
    if (!s) continue;
    const fig = echo.figure;
    seatIn(cs, sets, fig, s);
    setOpacity(fig, opacity);
    const rig = fig.userData.rig;
    if (rig) {
      rig.head.rotation.set(bowed, 0, 0);
      rig.torso.rotation.x = 0.06 + bowed * 0.25;
    }
    out.push({ echo, fig, seat: s, phase: Math.random() * 6 });
  }
  return out;
}

// Down the aisle to row 8 and into the window seat, in the cabin's space,
// from the top of the steps. Returns the keys and when you are sat down.
function aisleToSeat(sets, from, t0) {
  const s = sets.seat(MY_SEAT);
  const rowZ = s.z + 0.06;
  // Glancing at them either side on the way past.
  const keys = [
    { t: t0, p: from, l: [0.15, 2.3, -3.0] },
    { t: t0 + 0.9, p: [-0.12, CABIN_EYE, 3.4], l: [0, 2.25, -5], walk: true, ease: 'lin' },
    { t: t0 + 2.2, p: [0.0, CABIN_EYE, 2.0], l: [-0.75, 1.95, 0.9], walk: true, ease: 'lin' },
    { t: t0 + 3.4, p: [0.02, CABIN_EYE, 0.55], l: [0.75, 1.95, -0.6], walk: true, ease: 'lin' },
    { t: t0 + 4.4, p: [0.0, CABIN_EYE, rowZ + 0.3], l: [-0.5, 2.2, -5], walk: true },
    { t: t0 + 5.1, p: [-0.05, CABIN_EYE - 0.05, rowZ + 0.05], l: [-1.6, 2.0, rowZ - 0.1] },
    { t: t0 + 6.2, p: [s.x + 0.04, SEATED_EYE, s.z + 0.03], l: [s.x + 0.2, 2.15, 3.0] },
  ];
  return { keys, seatedAt: t0 + 6.2, seat: s };
}

// ---- the coast ----------------------------------------------------------

function coastScene(game) {
  const sets = game.sets;
  const bus = game.refs.bus;
  let passengers = [];
  let engine = null;
  const b = boarding(game, {
    walterBeats: (cs, t, dt, w) => walterTakes(cs, t, dt, w, {
      markSound: () => cs.soundAt(WALTER[0], WALTER[2], (d) => game.audio.punch(d)),
    }),
  });
  const walk = aisleToSeat(sets, b.top, b.inside);
  const sat = walk.seatedAt;
  const s = walk.seat;
  const out = [s.x - 2.4, 2.0, s.z + 0.6];
  const fwd = [s.x + 0.35, 2.12, 3.5];
  const shotB = new Shot(b.inside, [
    ...walk.keys,
    { t: sat + 1.6, p: [s.x + 0.04, SEATED_EYE, s.z + 0.03], l: fwd },
    // Reversing out: through the windscreen, the platform going away into fog.
    { t: sat + 6.5, p: [s.x + 0.05, SEATED_EYE, s.z + 0.03], l: [s.x + 0.25, 2.1, 4.0] },
    // On the road: leaning to the window, the lamps going by.
    { t: sat + 8.6, p: [s.x - 0.08, SEATED_EYE, s.z + 0.02], l: out },
    { t: sat + 12.5, p: [s.x - 0.08, SEATED_EYE, s.z + 0.02], l: [s.x - 2.4, 2.05, s.z + 1.6] },
    // Forward again, down the rows of them.
    { t: sat + 14.2, p: [s.x + 0.06, SEATED_EYE + 0.02, s.z + 0.02], l: [0.1, 2.15, 2.0] },
    { t: sat + 17.6, p: [s.x + 0.07, SEATED_EYE + 0.03, s.z], l: [0.05, 2.18, 1.4] },
  ], sets.rig);
  const reverseAt = sat + 2.4;
  const roadAt = sat + 7.2;
  const stopAt = sat + 13.4;
  const turnAt = sat + 16.0;
  const duration = sat + 19.4;

  return {
    name: 'coast',
    duration,
    surface: surfaceAt,
    shots: [b.shotA, shotB],
    bars: [[0, 0], [0.8, 1]],
    black: [[0, 0], [duration - 1.6, 0], [duration - 1.55, 1]],
    events: [
      ...b.events,
      [0.4, () => game.subtitle('You hand over a stranger\'s transfer. The Attendant looks at it for a long time.', 5)],
      [5.6, () => game.subtitle('Then he punches it, and steps aside.', 3.5)],
      [b.inside + 1.6, () => game.subtitle('Every one of them is already in their seat. Nobody looks up.', 4)],
      [sat + 0.6, (cs) => {
        cs.doorClosingAt = cs.t;
        cs.soundAt(DOOR_X, DOOR_Z, (d) => game.audio.doorHiss(d, true));
      }],
      [sat + 1.6, () => {
        engine = game.audio.engine();
        engine.set(0.7, 0.2, 0);
        if (game.busEmitter) game.busEmitter.volume = 1.5;
      }],
      [reverseAt + 0.6, () => game.subtitle('The bus pulls out of Bay 9 into the fog.', 4.5)],
      [reverseAt + 1.0, (cs) => cs.fogTo(0.34, 0x0a0f0f, 0.6)],
      [roadAt, (cs) => {
        sets.cabinIn(null);
        sets.cabin.userData.door.leaves.visible = true;
        sets.showRoad('night');
        sets.speed = 9;
        cs.fogTo(0.065, 0x070b0b, 1.2);
        // Outside, at night, there is no ceiling to bounce the light back.
        game.hemi.intensity = 0.5;
        if (game.busEmitter) game.busEmitter.volume = 0;
        engine?.set(0.85, 0.6, 0.7);
      }],
      [stopAt - 1.6, () => game.subtitle('Somewhere around the third mile the engine noise stops.', 4.5)],
      [stopAt, (cs) => {
        engine?.stop(0.08);
        game.audio.cutHum(6);
        cs.flickerFrom = cs.t;
      }],
      [turnAt, () => {
        game.audio.creak(null, 1.2);
        setTimeout(() => game.audio.whisper(0, 1), 500);
        game.fear.jolt(0.9);
        game.fear.kick('aberration', 1.1);
      }],
      [duration - 1.55, () => game.audio.deafen(2.5)],
    ],
    start(cs) {
      b.begin(cs);
      passengers = boardPassengers(cs, game, { bowed: 0.55, opacity: 0.4 });
    },
    update(cs, t, dt) {
      if (cs.doorClosingAt !== undefined) cs.doorClosing = span(t, cs.doorClosingAt, cs.doorClosingAt + 1.0);
      // The cabin lights: on as the door opens, and stuttering out once the
      // engine dies.
      if (cs.flickerFrom !== undefined) {
        const f = t - cs.flickerFrom;
        cs.cabinPower = f < 1.4 ? (Math.random() < 0.45 ? 0.15 : 0.9) : 0.12;
      }
      b.update(cs, t, dt);
      // Reversing out of the bay.
      if (t >= reverseAt && t < roadAt) {
        bus.position.z = BAY9.z - 2.3 * span(t, reverseAt, roadAt - 0.6);
        sets.cabinIn(bus);
      }
      // On the road: speed, and the lamps going by through the windows.
      if (t >= roadAt) {
        const coast = t >= stopAt;
        const want = coast ? 7 : 18;
        sets.speed += (want - sets.speed) * Math.min(1, dt * (coast ? 0.25 : 0.4));
        if (coast) sets.setLampsLit(1 - span(t, stopAt + 0.4, stopAt + 2.6));
        const pass = sets.passingLight();
        if (pass) sets.lamp(2, pass.pos, 0xffa24a, pass.power, 16);
      }
      for (const ps of passengers) {
        const rig = ps.fig.userData.rig;
        idleSway(ps.fig, t * 0.3 + ps.phase, false);
        // All at once, every one of them, to look at you.
        if (t >= turnAt && rig) {
          headToward(ps.fig, game.camera.position, dt, 2.9, 7);
          ease(rig.head, [0, null, null], dt, 7);
        }
      }
    },
    end() {
      engine?.stop(0.3);
      if (game.busEmitter) game.busEmitter.volume = 1;
      game.audio.setHumLevel(0.085);
    },
  };
}

// ---- home ----------------------------------------------------------------

function homeScene(game) {
  const sets = game.sets;
  const bus = game.refs.bus;
  let passengers = [];
  let engine = null;
  const b = boarding(game, {
    walterBeats: (cs, t, dt, w) => {
      walterTakes(cs, t, dt, w, {
        mark: 4.4,
        aside: 6.0,
        markSound: () => cs.soundAt(WALTER[0], WALTER[2], (d) => game.audio.stamp(d)),
      });
      // And tips his cap.
      const rig = w.userData.rig;
      if (rig && t > 4.9 && t < 6.2) {
        const k = span(t, 4.9, 5.3) * (1 - span(t, 5.7, 6.1));
        ease(rig.arms[0], [k * 2.5, null, -0.07 - k * 0.35], dt, 10);
        ease(rig.forearms[0], [0.1 + k * 1.5, null, null], dt, 10);
        ease(rig.head, [k * 0.35, null, null], dt, 8);
      }
    },
  });
  const walk = aisleToSeat(sets, b.top, b.inside);
  const sat = walk.seatedAt;
  const s = walk.seat;
  const reverseAt = sat + 2.4;
  const roadAt = sat + 7.2;
  // Two stops, one passenger stepping down at each; then the rest go, one
  // after another, as the light comes up.
  // Each stop: placed 30 m ahead, braked to over about four and a half
  // seconds, held while they step down, then left behind.
  const stops = [
    { at: roadAt + 3.0, who: 'marguerite' },
    { at: roadAt + 14.0, who: 'tobias' },
  ];
  const restAt = roadAt + 25;
  const lightAt = restAt + 7;
  const duration = lightAt + 7.5;
  const window = [s.x - 2.6, 1.9, s.z + 0.2];
  const keys = [
    ...walk.keys,
    { t: sat + 1.4, p: [s.x + 0.04, SEATED_EYE, s.z + 0.03], l: [s.x + 0.3, 2.1, 4.0] },
    { t: sat + 6.5, p: [s.x + 0.05, SEATED_EYE, s.z + 0.03], l: [s.x + 0.25, 2.05, 4.0] },
    { t: roadAt + 2.0, p: [s.x + 0.06, SEATED_EYE, s.z + 0.02], l: [s.x - 2.4, 2.0, s.z + 2.2] },
  ];
  for (const st of stops) {
    keys.push({ t: st.at + 2.4, p: [s.x - 0.06, SEATED_EYE, s.z + 0.02], l: [s.x - 2.6, 1.9, s.z + 2.2] });
    keys.push({ t: st.at + 4.6, p: [s.x - 0.08, SEATED_EYE, s.z + 0.02], l: window });
    keys.push({ t: st.at + 8.4, p: [s.x - 0.08, SEATED_EYE, s.z + 0.02], l: [s.x - 2.6, 1.95, s.z + 0.1] });
    keys.push({ t: st.at + 9.8, p: [s.x - 0.06, SEATED_EYE, s.z + 0.02], l: [s.x - 2.6, 1.9, s.z - 2.0] });
    keys.push({ t: st.at + 11.0, p: [s.x + 0.05, SEATED_EYE, s.z + 0.02], l: [0.2, 2.15, 2.5] });
  }
  keys.push({ t: restAt + 5.5, p: [s.x + 0.05, SEATED_EYE + 0.02, s.z], l: [0.0, 2.1, 1.5] });
  keys.push({ t: lightAt + 1.5, p: [s.x + 0.1, SEATED_EYE + 0.04, s.z + 0.1], l: [0.2, 2.15, 6.0] });
  keys.push({ t: duration, p: [s.x + 0.12, SEATED_EYE + 0.05, s.z + 0.3], l: [0.25, 2.2, 6.5] });
  const shotB = new Shot(b.inside, keys, sets.rig);

  // The bus's speed: cruising, or braking to stop with the stop alongside.
  const drive = (cs, t, dt) => {
    let want = t >= lightAt - 4 ? 20 : 15;
    const st = cs.stop;
    if (st && st.phase === 'braking') {
      // v = sqrt(2 a d): it rolls to a stop with the shelter by the window.
      const d = Math.max(0, sets.stop.position.z - st.alongside);
      want = Math.min(want, Math.sqrt(2 * 2.4 * d));
      if (d < 0.03) {
        st.phase = 'held';
        st.heldAt = t;
      }
    }
    if (st && st.phase === 'held') {
      want = 0;
      if (t > st.heldAt + 3.6) st.phase = 'away';
    }
    const rate = st?.phase === 'braking' ? 6 : st?.phase === 'away' ? 0.5 : 0.6;
    sets.speed += (want - sets.speed) * Math.min(1, dt * rate);
    if (st?.phase === 'held') sets.speed = 0;
  };

  return {
    name: 'home',
    duration,
    surface: surfaceAt,
    shots: [b.shotA, shotB],
    bars: [[0, 0], [0.8, 1], [duration - 4, 1], [duration - 1.5, 0]],
    white: [[0, 0], [duration - 4.5, 0], [duration - 1.2, 1]],
    events: [
      ...b.events,
      [0.4, () => game.subtitle('You hand him the slip with your own name on it.', 3.5)],
      [2.6, () => {
        game.subtitle('Fourteen voices stop muttering at once.', 3.5);
        game.audio.cutHum(5);
        game.audio.deafen(1.2);
      }],
      [5.0, () => game.subtitle('Walter stamps it, tips his cap, and does not follow you aboard.', 4.5)],
      [sat + 0.6, (cs) => {
        cs.doorClosingAt = cs.t;
        cs.soundAt(DOOR_X, DOOR_Z, (d) => game.audio.doorHiss(d, true));
      }],
      [sat + 1.6, () => {
        engine = game.audio.engine();
        engine.set(0.6, 0.2, 0);
        if (game.busEmitter) game.busEmitter.volume = 1.4;
      }],
      [reverseAt + 1.0, (cs) => cs.fogTo(0.34, 0x0a0f0f, 0.6)],
      [roadAt, (cs) => {
        sets.cabinIn(null);
        sets.cabin.userData.door.leaves.visible = true;
        sets.showRoad('night');
        sets.speed = 9;
        cs.fogTo(0.05, 0x070b0b, 1.2);
        if (game.busEmitter) game.busEmitter.volume = 0;
        engine?.set(0.75, 0.5, 0.6);
      }],
      [roadAt + 1.2, () => game.subtitle('The bus climbs out of Grayhollow as the sky goes grey.', 5)],
      ...stops.map((st) => [st.at, (cs) => {
        // Whoever got off at the last one stays there.
        for (const c of sets.stop.children) if (c.userData.rig) c.visible = false;
        sets.placeStop(30);
        cs.stop = { ...st, phase: 'braking', alongside: s.z + 0.5 };
      }]),
      [stops[0].at + 3.6, () => game.subtitle('The other seats empty one by one, each passenger stepping down', 4.5)],
      [stops[0].at + 8.2, () => game.subtitle('at a stop that should not exist any more, and waving.', 4.5)],
      [restAt, (cs) => {
        cs.restFrom = cs.t;
        game.audio.birds(5);
      }],
      [lightAt - 1, () => game.audio.birds(9)],
      [duration - 4.2, () => game.hud.narrate('You wake up at your own stop, in your own town, at dawn.', 4.5)],
      [duration - 0.2, () => game.hud.narrate('There is a coin in your pocket, dated 1987, still warm.', 5)],
    ],
    start(cs) {
      b.begin(cs);
      passengers = boardPassengers(cs, game, { bowed: 0, opacity: 0.34 });
      cs.gone = new Set();
    },
    update(cs, t, dt) {
      if (cs.doorClosingAt !== undefined) cs.doorClosing = span(t, cs.doorClosingAt, cs.doorClosingAt + 1.0);
      // The cabin's own light giving way to the day.
      cs.cabinPower = t > roadAt ? 1 - 0.75 * span(t, restAt - 2, lightAt) : undefined;
      b.update(cs, t, dt);
      // Walter on the platform, a hand up as it goes.
      const wr = game.attendant.figure.userData.rig;
      if (wr && t > reverseAt && t < roadAt) {
        const k = span(t, reverseAt + 0.4, reverseAt + 1.0);
        ease(wr.arms[1], [k * 2.7, null, 0.07 + k * 0.3], dt, 6);
        ease(wr.forearms[1], [0.1 + k * 0.5 + Math.sin(t * 5) * 0.25 * k, null, null], dt, 8);
      }
      if (t >= reverseAt && t < roadAt) {
        bus.position.z = BAY9.z - 2.3 * span(t, reverseAt, roadAt - 0.6);
        sets.cabinIn(bus);
      }
      if (t >= roadAt) {
        drive(cs, t, dt);
        // Night to dawn: the fog going grey, then pale gold, the sky with it.
        const g1 = span(t, roadAt + 6, restAt);
        const g2 = span(t, restAt, lightAt + 3);
        const fog = new THREE.Color(0x070b0b).lerp(new THREE.Color(0x56626c), g1).lerp(new THREE.Color(0xd9ccb4), g2);
        cs.fogTo(mix(0.05, 0.034, g1) - 0.01 * g2, fog, 2);
        game.hemi.intensity = mix(0.5, 5.5, g1) + 6 * g2;
        game.hemi.color.setRGB(mix(0.29, 0.62, g1 + g2 * 0.4), mix(0.44, 0.6, g1 + g2 * 0.3), mix(0.39, 0.62, g1));
        game.ambient.intensity = 0.18 + 0.5 * g1 + 0.8 * g2;
        sets.setLampsLit(1 - span(t, roadAt + 10, restAt + 2));
        const pass = sets.passingLight();
        if (pass) sets.lamp(2, pass.pos, pass.terminal ? 0xbfe6cf : 0xffa24a, pass.power, 16);
        else sets.lights[2].visible = false;
        engine?.set(0.75, Math.min(1, sets.speed / 20), Math.min(1, sets.speed / 16) * 0.7);
      }
      // Stepping down at the stop: gone from the seat, then out there under
      // the shelter's lamp, waving as the bus pulls away.
      const st = cs.stop;
      if (st && st.phase !== 'braking') {
        const ps = passengers.find((p) => p.echo.def.id === st.who);
        if (ps && !cs.gone.has(st.who)) {
          cs.gone.add(st.who);
          st.fadeFrom = t;
        }
        if (ps && st.fadeFrom !== undefined) {
          const f = t - st.fadeFrom;
          if (f < 0.9) {
            setOpacity(ps.fig, 0.34 * (1 - f / 0.9));
          } else if (!st.outside) {
            st.outside = true;
            ps.fig.visible = true;
            sets.stop.add(ps.fig);
            standUp(ps.fig);
            const p0 = sets.stop.userData.stand;
            ps.fig.position.copy(p0);
            ps.fig.rotation.set(0, -Math.PI / 2, 0);
            ps.fig.updateMatrixWorld(true);
          }
          if (st.outside) {
            setOpacity(ps.fig, 0.5 * span(t, st.fadeFrom + 0.9, st.fadeFrom + 1.8));
            const rig = ps.fig.userData.rig;
            if (rig) {
              ease(rig.arms[1], [2.75, null, 0.35], dt, 6);
              ease(rig.forearms[1], [0.3 + Math.sin(t * 6) * 0.35, null, null], dt, 10);
              headToward(ps.fig, game.camera.position, dt, 1.2, 4);
            }
          }
        }
        if (st.phase === 'away' && sets.stop.position.z < -60) cs.stop = null;
      }
      // The rest of them, one after another, as the light comes up.
      if (cs.restFrom !== undefined) {
        let i = 0;
        for (const ps of passengers) {
          if (stops.some((x) => x.who === ps.echo.def.id)) continue;
          const at = cs.restFrom + i * 0.55;
          i++;
          if (t > at) setOpacity(ps.fig, 0.34 * (1 - span(t, at, at + 1.1)));
          if (t > at + 1.1) ps.fig.visible = false;
        }
      }
      for (const ps of passengers) {
        if (ps.fig.parent !== sets.cabin) continue;
        idleSway(ps.fig, t * 0.3 + ps.phase, false);
        // Heads come round to see you go by on the way down the aisle.
        const d = game.camera.position.distanceTo(ps.fig.getWorldPosition(new THREE.Vector3()));
        if (t < sat + 1 && d < 2.2) headToward(ps.fig, game.camera.position, dt, 1.0, 3);
        else if (ps.fig.userData.rig) ease(ps.fig.userData.rig.head, [null, 0, null], dt, 1.5);
      }
    },
    end() {
      engine?.stop(0.3);
      if (game.busEmitter) game.busEmitter.volume = 1;
      game.audio.setHumLevel(0.085);
    },
  };
}

// ---- night shift ------------------------------------------------------------

// Where the uniform waits on the ticket counter, and the bench in the hall.
const COUNTER = new THREE.Vector3(-13.3, 1.1, -6.85);

function nightshiftScene(game) {
  const sets = game.sets;
  const bus = game.refs.bus;
  const walter = game.attendant.figure;
  let passengers = [];
  const start = here(game);
  const lead = start.p.x > DOOR_X - 0.1 ? [{ t: 1.0, p: [-24.1, EYE, -25.0], l: [-23.6, 1.7, -25.9], walk: true, ease: 'lin' }] : [];
  // Tobias, by the window in row 2, and the seat beside him.
  const toby = sets.seat(SEATS.tobias);
  const byToby = sets.seat(SEATS.tobias + 1);
  const rowWorldZ = BAY9.z + toby.z;
  const doorAt = 7.0;
  const boardAt = 7.6;
  const sitAt = 13.2;
  const closeAt = 17.2;
  const goAt = 18.4;
  const counterAt = 27.0;
  const hallAt = 32.5;
  const signAt = hallAt + 5.4;
  const duration = signAt + 7;

  const shots = [
    new Shot(0, [
      { ...start, walk: true },
      ...lead,
      { t: 2.2, p: FACE, l: [WALTER[0], 1.83, WALTER[2]] },
      { t: 5.4, p: FACE, l: [WALTER[0] + 0.05, 1.7, WALTER[2]] },
      // Watching him climb in.
      { t: boardAt + 1.0, p: [FACE[0], EYE, FACE[2] + 0.1], l: [DOOR_X, 1.7, DOOR_Z] },
      { t: boardAt + 3.0, p: [FACE[0] + 0.1, EYE, FACE[2] - 0.6], l: [DOOR_X + 0.4, 1.9, DOOR_Z - 0.8], walk: true },
      // Along the side of the coach to the window by Tobias.
      { t: boardAt + 5.2, p: [-24.45, EYE + 0.05, rowWorldZ + 0.25], l: [-22.0, 2.1, rowWorldZ - 0.1], walk: true },
      { t: sitAt + 3.6, p: [-24.3, EYE + 0.06, rowWorldZ + 0.2], l: [-22.3, 2.2, rowWorldZ - 0.15] },
      // Back from it as the door goes.
      { t: closeAt + 0.4, p: [-24.9, EYE, rowWorldZ + 1.2], l: [-22.5, 2.0, rowWorldZ - 0.8], walk: true },
      { t: goAt + 2.0, p: [-25.2, EYE, -25.2], l: [-22.6, 1.8, -31.0], walk: true },
      { t: goAt + 7.0, p: [-25.2, EYE, -25.0], l: [-22.4, 1.6, -34.0] },
      { t: counterAt - 0.5, p: [-25.0, EYE, -24.8], l: [-20.0, 1.6, -36.0] },
    ]),
    // The ticket office: the uniform on the counter.
    new Shot(counterAt, [
      { t: counterAt, p: [-12.0, 1.64, -6.0], l: [COUNTER.x, 1.12, COUNTER.z] },
      { t: hallAt - 0.6, p: [-12.45, 1.58, -6.45], l: [COUNTER.x - 0.05, 1.12, COUNTER.z - 0.02] },
    ]),
    // The hall: someone new asleep on the bench, where you woke.
    new Shot(hallAt, [
      { t: hallAt, p: [-3.5, 1.7, 9.0], l: [-1.2, 0.62, 5.55] },
      { t: signAt, p: [-3.0, 1.66, 8.5], l: [-1.15, 0.6, 5.55] },
    ]),
    // The rules on the wall, and a new one at the bottom in your hand.
    new Shot(signAt, [
      { t: signAt, p: [-8.0, 1.6, -0.1], l: [-10.6, 1.3, -1.0] },
      { t: duration, p: [-8.6, 1.55, -0.5], l: [-10.6, 1.25, -1.0] },
    ]),
  ];

  return {
    name: 'nightshift',
    duration,
    surface: surfaceAt,
    shots,
    bars: [[0, 0], [0.8, 1]],
    black: [[0, 0], [counterAt - 0.7, 0], [counterAt - 0.2, 1], [counterAt + 0.5, 0], [hallAt - 0.7, 0], [hallAt - 0.2, 1], [hallAt + 0.6, 0],
      [signAt - 0.6, 0], [signAt - 0.1, 1], [signAt + 0.4, 0], [duration - 1.6, 0], [duration - 0.3, 1]],
    events: [
      [0.4, () => game.subtitle('You hold out the ticket. Walter does not take it for a long moment.', 4.5)],
      [3.6, () => game.subtitle('"That\'s mine?" he says. "That\'s actually mine?"', 4)],
      [doorAt, (cs) => {
        cs.soundAt(DOOR_X, DOOR_Z, (d) => game.audio.doorHiss(d));
        sets.cabinIn(bus);
        sets.cabin.userData.door.leaves.visible = false;
        // Clear glass, to see him in there.
        if (bus.userData.glass) {
          cs.clearGlass = bus.userData.glass.material;
          bus.userData.glass.material = cs.seeThrough;
        }
      }],
      [8.2, () => game.subtitle('He boards the 3:33 with his cap in his hands.', 4)],
      [sitAt + 1.2, () => game.subtitle('Through the window he is already younger.', 4)],
      [closeAt, (cs) => {
        cs.doorClosingAt = cs.t;
        cs.soundAt(DOOR_X, DOOR_Z, (d) => game.audio.doorHiss(d, true));
        if (game.busEmitter) game.busEmitter.volume = 1.6;
      }],
      [goAt + 0.4, (cs) => cs.fogTo(0.6, 0x0a0f0f, 0.55)],
      [goAt + 3.4, () => game.subtitle('The bus goes. The hall is very quiet.', 4.5)],
      [goAt + 6.6, () => {
        bus.visible = false;
        sets.hideCabin();
        sets.lampsOff();
      }],
      [counterAt - 0.3, (cs) => {
        cs.fogTo(0.036, 0x070b0b, 3);
        game.audio.setHumLevel(0.06);
        sets.uniform.visible = true;
        sets.uniform.position.copy(COUNTER);
        sets.uniform.rotation.set(0, 0.35, 0);
      }],
      [counterAt + 0.8, () => game.subtitle('The uniform is folded on the ticket counter, and it is your size.', 4.5)],
      [hallAt - 0.3, () => {
        sets.uniform.visible = false;
        const f = sets.sleeper;
        f.visible = true;
        // Head on the middle arm, feet to the west end: where you lay.
        lieDown(f, Math.PI / 2);
        f.position.set(BENCH.x - 1.68, BENCH.y + 0.1, BENCH.z + 0.04);
      }],
      [hallAt + 0.8, () => {
        game.hud.narrate('At 11:47 PM someone new falls asleep on the bench, and you pick up the keyring,', 5);
        game.audio.keyJingle();
      }],
      [signAt + 0.3, () => game.hud.narrate('and you start writing the rules you wish somebody had written for you.', 6)],
      [signAt + 1.8, () => {
        game.signScrawl = 'Listen to them. All of them.';
        game.refs.rulesSign?.redraw();
        game.audio.scrape?.(null, 0.8);
      }],
    ],
    start(cs) {
      cs.borrow(walter);
      cs.borrow(bus);
      cs.borrow(bus.userData.door.leaves[0]);
      cs.borrow(bus.userData.door.leaves[1]);
      if (bus.userData.glass) cs.borrow(bus.userData.glass);
      cs.seeThrough = new THREE.MeshStandardMaterial({ color: 0x0b1012, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
      walter.position.set(...WALTER);
      walter.rotation.set(0, yawTo(WALTER[0], WALTER[2], FACE[0], FACE[2]), 0);
      walter.visible = true;
      standUp(walter);
      sets.cabin.userData.door.set(0);
      passengers = boardPassengers(cs, game, { bowed: 0, opacity: 0.38 });
      // The ticket, held out low in front of you.
      cs.borrow(sets.ticket);
      game.camera.add(sets.ticket);
      sets.ticket.position.set(0.05, -0.12, -0.34);
      sets.ticket.rotation.set(-0.5, 0.15, 0.1);
      sets.ticket.visible = true;
      // The cap, so it can come off.
      const cap = walter.userData.dressed?.cap;
      if (cap) cs.borrow(cap);
    },
    update(cs, t, dt) {
      const rig = walter.userData.rig;
      // He takes the ticket out of your hand.
      if (rig) {
        const reach = span(t, 5.2, 5.8) * (1 - span(t, 6.4, 6.9));
        ease(rig.arms[1], [reach * 1.0, null, 0.07], dt, 8);
        ease(rig.forearms[1], [0.1 + reach * 0.5, null, null], dt, 8);
        const look = span(t, 2.6, 3.0) * (1 - span(t, 4.4, 4.8));
        ease(rig.head, [look * 0.45, null, look * 0.12], dt, 5);
      }
      if (t >= 5.7 && !cs.taken) {
        cs.taken = true;
        game.audio.paper();
        ticketInHand(sets, walter);
      }
      // The cap comes off into his left hand.
      const cap = walter.userData.dressed?.cap;
      if (cap && t >= 6.6 && !cs.capOff && rig) {
        cs.capOff = true;
        rig.forearms[0].attach(cap);
        cap.position.set(0, -0.44 * rig.scale, -0.06);
        cap.rotation.set(-0.4, 0, 1.4);
      }
      if (rig && t >= 6.4 && t < boardAt) {
        ease(rig.arms[0], [0.55, null, -0.07], dt, 6);
        ease(rig.forearms[0], [1.1, null, null], dt, 6);
      }
      bus.userData.door.set(span(t, doorAt, doorAt + 1.1) * (1 - (cs.doorClosingAt !== undefined ? span(t, cs.doorClosingAt, cs.doorClosingAt + 1) : 0)));
      if (sets.rig.visible) sets.cabinLights(1 - span(t, goAt + 3.4, goAt + 6.0));

      // Into the coach, up the steps, and down the aisle to row 2.
      if (t >= boardAt && t < sitAt) {
        const inCabin = t >= boardAt + 3.2;
        if (inCabin && walter.parent !== sets.cabin) {
          sets.cabin.attach(walter);
        }
        if (!inCabin) {
          walkAlong(walter, [WALTER, [-23.75, 0, DOOR_Z + 0.05], [DOOR_X - 0.15, 0, DOOR_Z], [DOOR_X + 0.15, 0.42, DOOR_Z], [DOOR_X + 0.41, 0.74, DOOR_Z - 0.02], [DOOR_X + 0.7, 1.05, DOOR_Z - 0.06]], boardAt, boardAt + 3.2, t, dt);
        } else {
          walkAlong(walter, [[-0.55, 1.05, 4.63], [-0.05, 1.05, 4.0], [0, 1.05, toby.z + 0.45], [toby.x + 0.06, 1.05, toby.z + 0.3]], boardAt + 3.2, sitAt - 0.3, t, dt);
        }
        if (rig) {
          ease(rig.arms[1], [0.5, null, 0.07], dt, 4);
          ease(rig.forearms[1], [1.2, null, null], dt, 4);
        }
      }
      // Tobias makes room by the window, and Walter sits down by him.
      const tob = passengers.find((p) => p.echo.def.id === 'tobias');
      if (tob) {
        const slide = span(t, sitAt - 1.6, sitAt - 0.6);
        tob.fig.position.x = mix(toby.x, byToby.x, slide);
        if (t > sitAt - 2.4) headToward(tob.fig, walter.getWorldPosition(new THREE.Vector3()).setY(2.4), dt, 1.4, 3);
      }
      if (t >= sitAt && !cs.walterSat) {
        cs.walterSat = true;
        const lift = sitPose(walter, toby.y);
        walter.position.set(toby.x, lift, toby.z);
        walter.rotation.set(0, Math.PI, 0);
      }
      if (cs.walterSat && rig) {
        // Straighter, all at once: the stoop gone out of him.
        const k = span(t, sitAt + 0.6, sitAt + 2.6);
        const chest = rig.torso.children.find((c) => c.name === 'chest');
        if (chest) chest.rotation.x = 0.2 * (1 - k);
        if (tob) headToward(walter, tob.fig.getWorldPosition(new THREE.Vector3()).setY(2.3), dt, 1.2, 2);
        walter.userData.poseDirty = true;
      }
      // Reversing into the fog until there is nothing there.
      if (t >= goAt && t < goAt + 6.6) {
        bus.position.z = BAY9.z - 2.3 * span(t, goAt, goAt + 6.0);
        sets.cabinIn(bus);
        if (game.busEmitter) game.busEmitter.volume = 1.6 * (1 - span(t, goAt + 3, goAt + 6.5));
      }
      for (const ps of passengers) {
        if (ps.fig.parent === sets.cabin) idleSway(ps.fig, t * 0.3 + ps.phase, ps.echo.def.id !== 'tobias');
      }
    },
    end(cs) {
      if (cs.clearGlass && bus.userData.glass) bus.userData.glass.material = cs.clearGlass;
      cs.seeThrough?.dispose();
      if (game.busEmitter) game.busEmitter.volume = 1;
      game.signScrawl = null;
      game.refs.rulesSign?.redraw();
      game.audio.setHumLevel(0.085);
    },
  };
}

// ---- bay 0 -------------------------------------------------------------------

function bay0Scene(game) {
  const sets = game.sets;
  const bus = game.refs.bay0Bus;
  const thing = sets.thing;
  const start = here(game);
  const drv = sets.cabin.userData.driver;
  let engine = null;
  // Everything here is in the coach's own space (it faces north, so its
  // door, on its right, is on the east side of it).
  const doorAt = 1.8;
  const climbAt = 4.4;
  const inside = climbAt + 3.2;
  const moveAt = 11.4;
  const roadAt = 14.6;
  const turnAt = 26.4;
  const duration = 30.5;
  const doorMid = 4.69;
  // Standing off the doorway, on the east side, then up the steps: from
  // there on, in the coach's own space (it faces north, so its door, on
  // its right, is on the east).
  const eyeW = [37.55, EYE, -2.45];
  const doorW = [36.25, 1.5, -2.69];
  const shots = [
    new Shot(0, [
      { ...start, walk: true },
      { t: 1.8, p: eyeW, l: doorW },
      { t: climbAt, p: eyeW, l: [doorW[0], 1.45, doorW[2]] },
    ]),
    new Shot(climbAt, [
      { t: climbAt, p: toLocalPoint(bus, eyeW), l: toLocalPoint(bus, [doorW[0], 1.45, doorW[2]]) },
      { t: climbAt + 1.0, p: [-1.95, EYE, doorMid], l: [0.2, 1.7, doorMid + 0.2], walk: true, ease: 'lin' },
      { t: climbAt + 1.8, p: [-1.45, 0.42 + 1.64, doorMid], l: [0.6, 2.1, doorMid + 0.3], walk: true, ease: 'lin', stride: 0.8 },
      { t: climbAt + 2.5, p: [-1.05, 0.74 + 1.64, doorMid - 0.02], l: [0.6, 2.3, doorMid + 0.4], walk: true, ease: 'lin', stride: 0.8 },
      { t: inside, p: [-0.6, CABIN_EYE, 4.6], l: [drv.x, 2.2, drv.z + 0.2] },
      { t: inside + 2.6, p: [-0.5, CABIN_EYE, 4.5], l: [drv.x, 2.15, drv.z + 0.1] },
      // Beside it, at the top of the steps, to look out of the windscreen.
      { t: moveAt - 0.4, p: [-0.38, 2.5, 4.3], l: [-0.6, 1.95, 15] },
      { t: roadAt + 4.0, p: [-0.36, 2.5, 4.32], l: [-1.6, 1.85, 16] },
      // A terminal going by the door-side windows.
      { t: roadAt + 6.4, p: [-0.3, 2.62, 3.6], l: [-3.4, 1.7, 3.0] },
      { t: roadAt + 9.2, p: [-0.3, 2.62, 3.5], l: [-3.4, 1.65, 0.8] },
      // Back into the aisle, behind it.
      { t: turnAt - 0.8, p: [0.3, CABIN_EYE - 0.04, 3.2], l: [drv.x, 2.35, drv.z + 0.2], walk: true },
      { t: turnAt + 0.6, p: [0.3, CABIN_EYE - 0.05, 3.25], l: [drv.x, 2.4, drv.z + 0.1] },
      { t: duration, p: [0.32, CABIN_EYE - 0.06, 3.38], l: [drv.x, 2.42, drv.z] },
    ], sets.rig),
  ];

  return {
    name: 'bay0',
    duration,
    surface: () => 'concrete',
    shots,
    bars: [[0, 0], [0.8, 1]],
    black: [[0, 0], [duration - 1.2, 0], [duration - 1.15, 1]],
    events: [
      [0.4, () => game.subtitle('A bus is idling at a platform with no number painted on it.', 4)],
      [doorAt, (cs) => {
        cs.soundAt(36.25, -2.7, (d) => game.audio.doorHiss(d));
        sets.cabinIn(bus);
        sets.cabin.userData.door.leaves.visible = false;
        game.subtitle('It opens the doors.', 3);
      }],
      [climbAt + 1.6, () => {
        if (bus.userData.glass) bus.userData.glass.visible = false;
      }],
      [inside + 0.2, () => game.subtitle('The thing from camera four is already in the driver\'s seat.', 4)],
      [inside + 4.2, () => game.subtitle('It has been waiting all night, one camera at a time, for someone curious enough to walk the service tunnel.', 5.5)],
      [moveAt - 1.2, (cs) => {
        cs.doorClosingAt = cs.t;
        cs.soundAt(36.25, -2.7, (d) => game.audio.doorHiss(d, true));
        engine = game.audio.engine();
        engine.set(0.75, 0.3, 0);
        if (game.bay0Emitter) game.bay0Emitter.volume = 1.4;
      }],
      [moveAt + 0.6, (cs) => cs.fogTo(0.36, 0x0d0705, 0.7)],
      [roadAt, (cs) => {
        sets.cabinIn(null);
        sets.cabin.userData.door.leaves.visible = true;
        sets.showRoad('terminals');
        sets.speed = 12;
        // Thin enough to see the next one, and the next.
        cs.fogTo(0.034, 0x0b0706, 1.2);
        game.hemi.intensity = 0.45;
        if (game.bay0Emitter) game.bay0Emitter.volume = 0;
        engine?.set(0.8, 0.7, 0.6);
      }],
      [roadAt + 1.6, () => game.subtitle('Through the windscreen you can see the next station, and the next, and the next:', 4.6)],
      [roadAt + 6.4, () => game.subtitle('a thousand terminals strung along one road, each with a bench, each with a sleeper,', 4.6)],
      [roadAt + 11.0, () => game.subtitle('each with a tired man in a cap who thinks his is the only one.', 4.6)],
      [turnAt + 0.4, () => {
        game.audio.creak(null, 1.4);
        game.fear.jolt(0.45);
      }],
      [duration - 1.15, () => game.audio.deafen(2.5)],
    ],
    start(cs) {
      cs.borrow(bus);
      cs.borrow(bus.userData.door.leaves[0]);
      cs.borrow(bus.userData.door.leaves[1]);
      if (bus.userData.glass) cs.borrow(bus.userData.glass);
      sets.cabin.userData.door.set(0);
      // It, behind the wheel.
      cs.borrow(thing);
      sets.cabin.add(thing);
      const lift = sitPose(thing, drv.y);
      thing.position.set(drv.x, lift, drv.z);
      thing.rotation.set(0, Math.PI, 0);
      thing.visible = true;
      cs.cabinColor = 0xff6a42;
    },
    update(cs, t, dt) {
      const closing = cs.doorClosingAt !== undefined ? span(t, cs.doorClosingAt, cs.doorClosingAt + 1) : 0;
      bus.userData.door.set(span(t, doorAt, doorAt + 1.6) * (1 - closing));
      if (sets.rig.visible) sets.cabinLights(0.85 * span(t, doorAt - 0.2, doorAt + 1.5), 0xff6a42);
      // Forward, into the dark at the end of the bay.
      if (t >= moveAt && t < roadAt) {
        bus.position.z = 2.0 - 2.6 * span(t, moveAt, roadAt - 0.4);
        sets.cabinIn(bus);
      }
      if (t >= roadAt) {
        sets.speed += (19 - sets.speed) * Math.min(1, dt * 0.5);
        const pass = sets.passingLight();
        if (pass && t < turnAt - 1.2) sets.lamp(2, pass.pos, 0xbfe6cf, pass.power * 1.4, 14);
        // Every one of them turns his head to watch it go by.
        for (const g of sets.terminals) {
          const man = g.userData.man;
          const rig = man.userData.rig;
          if (!rig || Math.abs(g.position.z) > 30) continue;
          const mx = g.position.x + man.position.x;
          const mz = g.position.z + man.position.z;
          const rel = yawTo(mx, mz, 0, 2.0) - man.rotation.y;
          const want = Math.max(-1.3, Math.min(1.3, Math.atan2(Math.sin(rel), Math.cos(rel))));
          rig.head.rotation.y += (want - rig.head.rotation.y) * Math.min(1, dt * 3);
        }
      }
      // A cold light from the cabin onto it, guttering, for the end.
      if (t >= turnAt - 1.2) {
        const flick = Math.random() < 0.15 ? 0.3 : 1;
        sets.lamp(2, sets.inCabin(0.15, 2.75, 3.65), 0xc8d8d0, 0.07 * flick * span(t, turnAt - 1.2, turnAt - 0.4), 4);
      }
      // Its head comes all the way round.
      const rig = thing.userData.rig;
      if (rig) {
        idleSway(thing, t * 0.2, false);
        const k = span(t, turnAt, turnAt + 1.3);
        rig.head.rotation.y = k * Math.PI * 0.98;
        rig.head.rotation.x = -k * 0.12;
        thing.userData.poseDirty = true;
      }
    },
    end() {
      engine?.stop(0.3);
      if (game.bay0Emitter) game.bay0Emitter.volume = 0.7;
    },
  };
}

// A world point in the coach's own space.
function toLocalPoint(bus, p) {
  bus.updateMatrixWorld(true);
  const v = bus.worldToLocal(new THREE.Vector3(p[0], p[1], p[2]));
  return [v.x, v.y, v.z];
}

export const ENDING_SCENES = {
  coast: coastScene,
  home: homeScene,
  nightshift: nightshiftScene,
  bay0: bay0Scene,
};
