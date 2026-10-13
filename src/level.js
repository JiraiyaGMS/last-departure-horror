import * as THREE from 'three';
import { tex } from './textures.js';

export const WALL_T = 0.3;
// Fixture intensities are authored on a 0..1 scale and multiplied up to
// candela here. This was 14 against the old unlit-composite pipeline; ACES
// tonemapping has a much heavier toe, and at 14 the station measured 39% pure
// black with a median pixel of 0.02 -- a frame you cannot navigate. 50 puts
// the median around 0.11 and leaves the fixtures themselves to clip.
export const LIGHT_GAIN = 50;

// The whole station as axis-aligned rooms. Small and dense: eight public areas
// plus three that only open up later.
export const ROOMS = {
  bays:      { x1: -26, z1: -40, x2: 26, z2: -22, h: 5.0, surface: 'concrete', outdoor: true, label: 'Bus Bays' },
  gate:      { x1: -4,  z1: -22, x2: 4,  z2: -10, h: 3.2, surface: 'concrete', label: 'Gate Corridor' },
  hall:      { x1: -11, z1: -10, x2: 11, z2: 10,  h: 4.4, surface: 'floor',    label: 'Main Waiting Hall' },
  ticket:    { x1: -23, z1: -10, x2: -11, z2: -2, h: 3.2, surface: 'floor',    label: 'Ticket Office' },
  manager:   { x1: -23, z1: -20, x2: -11, z2: -10, h: 3.2, surface: 'floor',   label: "Manager's Office" },
  lostfound: { x1: -23, z1: 0,   x2: -11, z2: 10, h: 3.2, surface: 'concrete', label: 'Lost & Found' },
  cctv:      { x1: 11,  z1: -10, x2: 23, z2: -2,  h: 3.2, surface: 'floor',    label: 'Security' },
  diner:     { x1: 11,  z1: 0,   x2: 23, z2: 10,  h: 3.2, surface: 'floor',    label: 'Diner Counter' },
  restroom:  { x1: -13, z1: 10,  x2: -1, z2: 20,  h: 3.0, surface: 'tile',     label: 'Restrooms' },
  baggage:   { x1: 1,   z1: 10,  x2: 21, z2: 24,  h: 3.6, surface: 'concrete', label: 'Baggage Claim' },
  tunnel:    { x1: 21,  z1: 14,  x2: 29, z2: 20,  h: 2.4, surface: 'concrete', label: 'Maintenance Tunnel' },
  bay0:      { x1: 29,  z1: -10, x2: 41, z2: 20,  h: 5.0, surface: 'concrete', outdoor: true, label: 'Bay 0' },
};

// Doorways punched through the shared wall between two rooms. `axis` is the
// constant coordinate of the wall; `from`/`to` span the opening.
export const DOORS = [
  { id: 'd_gate',    a: 'hall',    b: 'gate',      axis: 'z', at: -10, from: -3,  to: 3 },
  { id: 'd_bays',    a: 'gate',    b: 'bays',      axis: 'z', at: -22, from: -3,  to: 3 },
  { id: 'd_ticket',  a: 'hall',    b: 'ticket',    axis: 'x', at: -11, from: -8,  to: -4 },
  { id: 'd_lost',    a: 'hall',    b: 'lostfound', axis: 'x', at: -11, from: 2,   to: 6 },
  { id: 'd_cctv',    a: 'hall',    b: 'cctv',      axis: 'x', at: 11,  from: -8,  to: -4 },
  { id: 'd_diner',   a: 'hall',    b: 'diner',     axis: 'x', at: 11,  from: 2,   to: 6 },
  { id: 'd_rest',    a: 'hall',    b: 'restroom',  axis: 'z', at: 10,  from: -9,  to: -5 },
  { id: 'd_bag',     a: 'hall',    b: 'baggage',   axis: 'z', at: 10,  from: 3,   to: 7 },
  { id: 'd_manager', a: 'ticket',  b: 'manager',   axis: 'z', at: -10, from: -19, to: -15, locked: 'managerDoor' },
  { id: 'd_tunnel',  a: 'baggage', b: 'tunnel',    axis: 'x', at: 21,  from: 15,  to: 19, locked: 'tunnelDoor' },
  { id: 'd_bay0',    a: 'tunnel',  b: 'bay0',      axis: 'x', at: 29,  from: 15,  to: 19 },
];

// Attendant navigation graph. Every edge is a straight line through open
// floor, so he never clips a wall.
const NAV_NODES = {
  hall_c:    [0, 0],
  d_gate:    [0, -10],
  gate_m:    [0, -16],
  d_bays:    [0, -22],
  bay_c:     [0, -30],
  bay_w:     [-20, -30],
  bay_e:     [18, -30],
  d_ticket:  [-11, -6],
  ticket_c:  [-17, -6],
  d_manager: [-17, -10],
  manager_c: [-17, -15],
  d_lost:    [-11, 4],
  lost_c:    [-17, 5],
  d_cctv:    [11, -6],
  cctv_c:    [17, -6],
  d_diner:   [11, 4],
  diner_c:   [17, 5],
  d_rest:    [-7, 10],
  rest_c:    [-7, 15],
  d_bag:     [5, 10],
  bag_c:     [8, 15],
  bag_e:     [19, 17],
  d_tunnel:  [21, 17],
  tunnel_c:  [25, 17],
  d_bay0:    [29, 17],
  bay0_c:    [35, 8],
};

const NAV_EDGES = [
  ['hall_c', 'd_gate'], ['d_gate', 'gate_m'], ['gate_m', 'd_bays'], ['d_bays', 'bay_c'],
  ['bay_c', 'bay_w'], ['bay_c', 'bay_e'],
  ['hall_c', 'd_ticket'], ['d_ticket', 'ticket_c'], ['ticket_c', 'd_manager'], ['d_manager', 'manager_c'],
  ['hall_c', 'd_lost'], ['d_lost', 'lost_c'],
  ['hall_c', 'd_cctv'], ['d_cctv', 'cctv_c'],
  ['hall_c', 'd_diner'], ['d_diner', 'diner_c'],
  ['hall_c', 'd_rest'], ['d_rest', 'rest_c'],
  ['hall_c', 'd_bag'], ['d_bag', 'bag_c'], ['bag_c', 'bag_e'], ['bag_e', 'd_tunnel'],
  ['d_tunnel', 'tunnel_c'], ['tunnel_c', 'd_bay0'], ['d_bay0', 'bay0_c'],
];

export function roomAt(x, z) {
  for (const [name, r] of Object.entries(ROOMS)) {
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return name;
  }
  return null;
}

function surfaceTexture(kind, w, d) {
  const rx = Math.max(1, Math.round(w / 2));
  const rz = Math.max(1, Math.round(d / 2));
  if (kind === 'floor') return tex.floor([rx, rz]);
  if (kind === 'tile') return tex.tile([rx, rz]);
  return tex.concrete([rx, rz]);
}

export class Level {
  constructor() {
    this.group = new THREE.Group();
    this.colliders = [];      // { x1, z1, x2, z2, top } axis-aligned blockers
    this.interactables = [];
    this.hideSpots = [];
    this.lights = [];         // flickering fluorescents
    this.doors = new Map();   // key -> { mesh, collider, locked }
    this.nav = { nodes: {}, edges: {} };
    this.darkRooms = new Set(['tunnel', 'bay0']);
    this.materials = [];
  }

  mat(options) {
    // Standard rather than Lambert: the station is almost entirely painted
    // block, scuffed steel and old vinyl, and the only thing that separates
    // those at a glance is how they handle a grazing light.
    const { roughness = 0.82, metalness = 0.0, ...rest } = options;
    const m = new THREE.MeshStandardMaterial({ roughness, metalness, ...rest });
    this.materials.push(m);
    return m;
  }

  // Adds a box and registers it as a blocker unless `ghost` is set.
  box(x, z, w, d, h, y, material, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y + h / 2, z);
    this.group.add(mesh);
    if (!opts.ghost) {
      this.colliders.push({
        x1: x - w / 2, z1: z - d / 2, x2: x + w / 2, z2: z + d / 2,
        top: y + h, bottom: y,
        step: opts.step || false,
      });
    }
    return mesh;
  }

  addCollider(x1, z1, x2, z2, top = 3, bottom = 0) {
    this.colliders.push({ x1, z1, x2, z2, top, bottom });
  }

  addInteractable(def) {
    const it = {
      enabled: true,
      radius: 2.4,
      ...def,
    };
    this.interactables.push(it);
    return it;
  }

  addHideSpot(def) {
    const spot = { occupied: false, ...def };
    this.hideSpots.push(spot);
    return spot;
  }

  addLight(x, y, z, opts = {}) {
    // Fixture intensities are authored on a 0..1 scale; three's physical lights
    // want candela, so a ceiling fixture needs roughly an order of magnitude more.
    const intensity = (opts.intensity ?? 1.0) * LIGHT_GAIN;
    const light = new THREE.PointLight(
      opts.color ?? 0xbfe6cf,
      intensity,
      opts.distance ?? 14,
      opts.decay ?? 1.6
    );
    light.position.set(x, y, z);
    this.group.add(light);

    // The visible tube, so the source reads on screen even when culled.
    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(opts.fixtureW ?? 2.4, 0.12, 0.3),
      new THREE.MeshBasicMaterial({ color: opts.color ?? 0xd8f4e4 })
    );
    fixture.position.set(x, y + 0.1, z);
    this.group.add(fixture);

    const entry = {
      light,
      fixture,
      base: intensity,
      flicker: opts.flicker ?? 0.1,
      broken: false,
      room: opts.room ?? roomAt(x, z),
      phase: Math.random() * 100,
      on: true,
    };
    this.lights.push(entry);
    return entry;
  }

  buildShell() {
    const wallMat = this.mat({ map: tex.wood([4, 1]), color: 0xb09a86 });
    const tileWallMat = this.mat({ map: tex.tile([4, 2]), color: 0xa8bdb4 });
    const concWallMat = this.mat({ map: tex.concrete([4, 2]), color: 0x8f9a9a });
    const ceilMat = this.mat({ map: tex.ceiling([6, 6]), color: 0x8d9a96 });

    for (const [name, r] of Object.entries(ROOMS)) {
      const w = r.x2 - r.x1;
      const d = r.z2 - r.z1;
      const cx = (r.x1 + r.x2) / 2;
      const cz = (r.z1 + r.z2) / 2;

      // Floor.
      const floorMat = this.mat({ map: surfaceTexture(r.surface, w, d), color: 0xbfbfbf });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0, cz);
      this.group.add(floor);

      // Ceiling (the bays get a canopy so there is never an open sky).
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), r.outdoor ? concWallMat : ceilMat);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(cx, r.h, cz);
      this.group.add(ceil);

      const pickWall = () => {
        if (r.surface === 'tile') return tileWallMat;
        if (r.outdoor || r.surface === 'concrete') return concWallMat;
        return wallMat;
      };

      this.buildRoomWalls(name, r, pickWall());
    }

    this.buildDoorFrames();
    this.buildNav();
  }

  buildRoomWalls(name, r, material) {
    const sides = [
      { axis: 'z', at: r.z1, span: [r.x1, r.x2], inward: +1 },
      { axis: 'z', at: r.z2, span: [r.x1, r.x2], inward: -1 },
      { axis: 'x', at: r.x1, span: [r.z1, r.z2], inward: +1 },
      { axis: 'x', at: r.x2, span: [r.z1, r.z2], inward: -1 },
    ];

    for (const side of sides) {
      // Openings that sit on this exact wall line.
      const gaps = DOORS
        .filter((d) => (d.a === name || d.b === name) && d.axis === side.axis && Math.abs(d.at - side.at) < 1e-6)
        .map((d) => [Math.max(d.from, side.span[0]), Math.min(d.to, side.span[1])])
        .filter(([a, b]) => b > a)
        .sort((p, q) => p[0] - q[0]);

      const segments = [];
      let cursor = side.span[0];
      for (const [a, b] of gaps) {
        if (a > cursor) segments.push([cursor, a]);
        cursor = Math.max(cursor, b);
      }
      if (cursor < side.span[1]) segments.push([cursor, side.span[1]]);

      for (const [a, b] of segments) {
        const len = b - a;
        if (len <= 0.001) continue;
        const mid = (a + b) / 2;
        const offset = side.at + side.inward * (WALL_T / 2);
        if (side.axis === 'z') {
          this.box(mid, offset, len, WALL_T, r.h, 0, material);
        } else {
          this.box(offset, mid, WALL_T, len, r.h, 0, material);
        }
      }

      // Header above each opening so you see a door frame, not a slot.
      for (const [a, b] of gaps) {
        const len = b - a;
        const mid = (a + b) / 2;
        const offset = side.at + side.inward * (WALL_T / 2);
        const headerH = Math.max(0.1, r.h - 2.4);
        if (side.axis === 'z') {
          this.box(mid, offset, len, WALL_T, headerH, 2.4, material, { ghost: true });
        } else {
          this.box(offset, mid, WALL_T, len, headerH, 2.4, material, { ghost: true });
        }
      }
    }
  }

  buildDoorFrames() {
    const doorMat = this.mat({ color: 0x5a4432 });
    for (const door of DOORS) {
      if (!door.locked) continue;
      const len = door.to - door.from;
      const mid = (door.from + door.to) / 2;
      let mesh;
      if (door.axis === 'x') {
        mesh = this.box(door.at, mid, 0.16, len, 2.4, 0, doorMat);
      } else {
        mesh = this.box(mid, door.at, len, 0.16, 2.4, 0, doorMat);
      }
      const collider = this.colliders[this.colliders.length - 1];
      this.doors.set(door.locked, { mesh, collider, locked: true });
    }
  }

  isLocked(key) {
    return this.doors.get(key)?.locked ?? false;
  }

  // Hides a locked door and lifts its blocker for the rest of this loop.
  unlockDoor(key) {
    const door = this.doors.get(key);
    if (!door || !door.locked) return false;
    door.locked = false;
    door.mesh.visible = false;
    const i = this.colliders.indexOf(door.collider);
    if (i >= 0) this.colliders.splice(i, 1);
    return true;
  }

  // Every loop puts the locks back.
  relockDoors() {
    for (const door of this.doors.values()) {
      if (door.locked) continue;
      door.locked = true;
      door.mesh.visible = true;
      if (!this.colliders.includes(door.collider)) this.colliders.push(door.collider);
    }
  }

  buildNav() {
    for (const [id, p] of Object.entries(NAV_NODES)) {
      this.nav.nodes[id] = new THREE.Vector3(p[0], 0, p[1]);
      this.nav.edges[id] = [];
    }
    for (const [a, b] of NAV_EDGES) {
      this.nav.edges[a].push(b);
      this.nav.edges[b].push(a);
    }
  }

  nearestNode(pos, blocked = new Set()) {
    let best = null;
    let bestD = Infinity;
    for (const [id, p] of Object.entries(this.nav.nodes)) {
      if (blocked.has(id)) continue;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  // A* across the waypoint graph.
  findPath(fromId, toId, blocked = new Set()) {
    if (fromId === toId) return [fromId];
    const nodes = this.nav.nodes;
    const open = new Set([fromId]);
    const cameFrom = new Map();
    const g = new Map([[fromId, 0]]);
    const h = (id) => nodes[id].distanceTo(nodes[toId]);
    const f = new Map([[fromId, h(fromId)]]);

    while (open.size) {
      let current = null;
      let bestF = Infinity;
      for (const id of open) {
        const v = f.get(id) ?? Infinity;
        if (v < bestF) {
          bestF = v;
          current = id;
        }
      }
      if (current === toId) {
        const path = [current];
        while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0]));
        return path;
      }
      open.delete(current);
      for (const next of this.nav.edges[current]) {
        if (blocked.has(next) && next !== toId) continue;
        const tentative = (g.get(current) ?? Infinity) + nodes[current].distanceTo(nodes[next]);
        if (tentative < (g.get(next) ?? Infinity)) {
          cameFrom.set(next, current);
          g.set(next, tentative);
          f.set(next, tentative + h(next));
          open.add(next);
        }
      }
    }
    return null;
  }
}
