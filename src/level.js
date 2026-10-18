import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface, tint } from './textures.js';
import { makeFixture, makeDoorLeaf, chamferBox } from './props.js';

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
//
// The two locked ones are real single doors. They used to be four-metre gaps
// with a slab in them that simply vanished when unlocked; a staff door is a
// metre and a bit wide, and it swings. `swing` is which way it opens: +1 into
// the room on the positive side of the wall, -1 into the negative side.
export const DOORS = [
  { id: 'd_gate',    a: 'hall',    b: 'gate',      axis: 'z', at: -10, from: -3,  to: 3 },
  { id: 'd_bays',    a: 'gate',    b: 'bays',      axis: 'z', at: -22, from: -3,  to: 3 },
  { id: 'd_ticket',  a: 'hall',    b: 'ticket',    axis: 'x', at: -11, from: -8,  to: -4 },
  { id: 'd_lost',    a: 'hall',    b: 'lostfound', axis: 'x', at: -11, from: 2,   to: 6 },
  { id: 'd_cctv',    a: 'hall',    b: 'cctv',      axis: 'x', at: 11,  from: -8,  to: -4 },
  { id: 'd_diner',   a: 'hall',    b: 'diner',     axis: 'x', at: 11,  from: 2,   to: 6 },
  { id: 'd_rest',    a: 'hall',    b: 'restroom',  axis: 'z', at: 10,  from: -9,  to: -5 },
  { id: 'd_bag',     a: 'hall',    b: 'baggage',   axis: 'z', at: 10,  from: 3,   to: 7 },
  { id: 'd_manager', a: 'ticket',  b: 'manager',   axis: 'z', at: -10, from: -17.6, to: -16.4, locked: 'managerDoor', swing: -1 },
  { id: 'd_tunnel',  a: 'baggage', b: 'tunnel',    axis: 'x', at: 21,  from: 16.4,  to: 17.6, locked: 'tunnelDoor', swing: 1 },
  { id: 'd_bay0',    a: 'tunnel',  b: 'bay0',      axis: 'x', at: 29,  from: 15,  to: 19 },
];

// Attendant navigation graph. Every edge is a straight line through open
// floor, so he never walks through a wall -- or through furniture: in the hall
// the routes follow the aisles between the bench rows, where they used to cut
// straight across the benches.
const NAV_NODES = {
  // The hall: three east-west aisles and the gaps between the benches.
  hall_c:    [0, 0.25],
  hall_w:    [-3.25, 0.25],
  hall_e:    [3.25, 0.25],
  hall_wx:   [-9.5, 0.25],
  hall_ex:   [9.5, 0.25],
  hall_n:    [0, -4.5],
  hall_nw:   [-3.25, -4.5],
  hall_ne:   [3.25, -4.5],
  hall_sw:   [-3.25, 7.8],
  hall_se:   [3.25, 7.8],
  d_gate:    [0, -10],
  gate_m:    [0, -16],
  d_bays:    [0, -22],
  bay_c:     [0, -30],
  bay_w:     [-20, -30],
  bay_e:     [18, -30],
  d_ticket:  [-11, -6],
  // Round the north end of the ticket counter.
  ticket_ne: [-12.1, -2.95],
  ticket_n:  [-14.6, -2.95],
  ticket_c:  [-17, -6],
  d_manager: [-17, -10],
  manager_c: [-17, -15],
  d_lost:    [-11, 4],
  lost_c:    [-17.2, 3.05],
  d_cctv:    [11, -6],
  cctv_c:    [17, -6],
  d_diner:   [11, 4],
  diner_c:   [16.5, 6.2],
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
  ['hall_c', 'hall_w'], ['hall_c', 'hall_e'], ['hall_w', 'hall_wx'], ['hall_e', 'hall_ex'],
  ['hall_w', 'hall_nw'], ['hall_e', 'hall_ne'], ['hall_nw', 'hall_n'], ['hall_ne', 'hall_n'],
  ['hall_w', 'hall_sw'], ['hall_e', 'hall_se'],
  ['hall_n', 'd_gate'], ['d_gate', 'gate_m'], ['gate_m', 'd_bays'], ['d_bays', 'bay_c'],
  ['bay_c', 'bay_w'], ['bay_c', 'bay_e'],
  ['hall_nw', 'd_ticket'], ['d_ticket', 'ticket_ne'], ['ticket_ne', 'ticket_n'],
  ['ticket_n', 'ticket_c'], ['ticket_c', 'd_manager'], ['d_manager', 'manager_c'],
  ['hall_wx', 'd_lost'], ['d_lost', 'lost_c'],
  ['hall_ne', 'd_cctv'], ['d_cctv', 'cctv_c'],
  ['hall_ex', 'd_diner'], ['d_diner', 'diner_c'],
  ['hall_sw', 'd_rest'], ['d_rest', 'rest_c'],
  ['hall_se', 'd_bag'], ['d_bag', 'bag_c'], ['bag_c', 'bag_e'], ['bag_e', 'd_tunnel'],
  ['d_tunnel', 'tunnel_c'], ['tunnel_c', 'd_bay0'], ['d_bay0', 'bay0_c'],
];

export function roomAt(x, z) {
  for (const [name, r] of Object.entries(ROOMS)) {
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return name;
  }
  return null;
}

// Floor finish by room type. The hall and offices are tiled, the restrooms
// have their own grimier tile, service areas are bare concrete and the bays
// are asphalt under a canopy. Wax survives on the public tile, so it is a
// touch glossier than the scan.
function floorKind(r) {
  if (r.outdoor) return 'asphalt';
  if (r.surface === 'floor') return 'floor';
  if (r.surface === 'tile') return 'tilefloor';
  return 'concfloor';
}

const FLOOR_FINISH = {
  asphalt: () => ({ ...surface('asphalt'), color: tint('asphalt', 0x505252) }),
  floor: () => ({ ...surface('floor', { roughness: 0.55, normal: 1.4 }), color: tint('floor', 0x525754) }),
  tilefloor: () => ({ ...surface('tilefloor', { roughness: 0.7 }), color: tint('tilefloor', 0x595d5b) }),
  concfloor: () => ({ ...surface('concfloor'), color: tint('concfloor', 0x616361) }),
};

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
    // Architectural trim, collected per material while the rooms are built and
    // merged into one mesh each at the end: a couple of draw calls for every
    // skirting board and door casing in the building.
    this.trimParts = new Map();
  }

  addTrim(key, geo) {
    if (!this.trimParts.has(key)) this.trimParts.set(key, []);
    this.trimParts.get(key).push(geo);
  }

  trimBox(key, x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    this.addTrim(key, geo);
  }

  buildTrim(materials) {
    for (const [key, geos] of this.trimParts) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged || !materials[key]) continue;
      this.group.add(new THREE.Mesh(merged, materials[key]));
    }
    this.trimParts.clear();
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

  // Every fixture housing shares one material. There are twenty-seven of them
  // and they are all the same enamelled sheet steel, so giving each its own
  // would cost twenty-seven uniform uploads to say the same thing.
  fixtureMat() {
    if (!this._fixtureMat) {
      this._fixtureMat = this.mat({ color: 0x8e9490, roughness: 0.6, metalness: 0.3 });
    }
    return this._fixtureMat;
  }

  // Adds a box and registers it as a blocker unless `ghost` is set.
  // `opts.bevel` (or `this.bevel`, which furnish.js turns on while it lays
  // out the furniture) cuts the edges back: see chamferBox. Walls stay sharp
  // so they meet cleanly.
  box(x, z, w, d, h, y, material, opts = {}) {
    const geo = (opts.bevel ?? this.bevel) ? chamferBox(w, h, d) : new THREE.BoxGeometry(w, h, d);
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

    // The visible source. `tube` is the glowing part and the only thing that
    // gets modulated as the light flickers; `fixture` is the whole assembly,
    // housing included, and is what gets hidden when the light is too far away
    // or dead. Keeping them separate means the housing stays a dull grey while
    // the tube inside it swings from guttering to blown out.
    const len = opts.fixtureW ?? 2.4;
    const fixture = new THREE.Group();

    const tube = new THREE.Mesh(
      new THREE.BoxGeometry(len - 0.12, 0.1, 0.16),
      new THREE.MeshBasicMaterial({ color: opts.color ?? 0xd8f4e4 })
    );
    fixture.add(tube);

    // Bare tubes floating under the ceiling were the single most obviously
    // untextured thing left in the station. A housing costs one draw call --
    // makeFixture merges it -- and it is what makes a strip light read as
    // bolted to the ceiling rather than hanging in the air.
    const housing = makeFixture(len, { metal: this.fixtureMat() });
    // The housing sits a few centimetres from the point light it belongs to,
    // which is exactly the geometry that makes a cube shadow map self-shadow:
    // the fixture would shadow-test against itself and put the room out. It
    // still receives light from everything else, so it reads as solid.
    housing.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.userData.noShadow = true;
    });
    fixture.add(housing);

    // Offset so the assembly sits around the light rather than above it: the
    // backplate ends up overhead and the reflector lips to either side, with
    // the tube nested inside the shape the way a real one is.
    fixture.position.set(x, y - 0.02, z);
    this.group.add(fixture);

    const entry = {
      light,
      fixture,
      tube,
      base: intensity,
      flicker: opts.flicker ?? 0.1,
      // What the flicker goes back to when the loop resets. The Director
      // drives a fixture to full flicker before popping it, and without this
      // every light it ever popped came back guttering for the rest of the
      // save.
      baseFlicker: opts.flicker ?? 0.1,
      broken: false,
      room: opts.room ?? roomAt(x, z),
      phase: Math.random() * 100,
      on: true,
    };
    this.lights.push(entry);
    return entry;
  }

  buildShell() {
    const wallMat = this.mat({ ...surface('panel'), color: tint('panel', 0x614835) });
    const tileWallMat = this.mat({ ...surface('tilewall', { normal: 1.2 }), color: tint('tilewall', 0x596c65) });
    const concWallMat = this.mat({ ...surface('block'), color: tint('block', 0x545b59) });
    const rawWallMat = this.mat({ ...surface('rawblock'), color: tint('rawblock', 0x555350) });
    // Mineral-fibre tile is about the most matte thing in a building. The
    // normal map is kept gentle: at 1.8 the grid seams caught every tube in
    // the room as a cross of hard glints.
    const ceilMat = this.mat({ ...surface('ceiling', { normal: 0.9, roughness: 2.2 }), color: tint('ceiling', 0x5a5e58) });
    // One material per finish, shared by every room that uses it.
    const floorMats = {};
    this.trimMats = {
      // Black vinyl cove base, the skirting of every public building built
      // between 1965 and 1990.
      skirting: this.mat({ color: 0x15171a, roughness: 0.55 }),
      // Painted hardwood door casings.
      casing: this.mat({ ...surface('paint', { metalness: 0.0, roughness: 0.9 }), color: tint('paint', 0x2f2a24) }),
    };

    for (const [name, r] of Object.entries(ROOMS)) {
      const w = r.x2 - r.x1;
      const d = r.z2 - r.z1;
      const cx = (r.x1 + r.x2) / 2;
      const cz = (r.z1 + r.z2) / 2;

      // Floor.
      const kind = floorKind(r);
      floorMats[kind] ??= this.mat(FLOOR_FINISH[kind]());
      const floorMat = floorMats[kind];
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0, cz);
      this.group.add(floor);

      // Ceiling (the bays get a canopy so there is never an open sky).
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), r.outdoor ? rawWallMat : ceilMat);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(cx, r.h, cz);
      this.group.add(ceil);

      const pickWall = () => {
        if (r.surface === 'tile') return tileWallMat;
        if (r.outdoor) return rawWallMat;
        if (r.surface === 'concrete') return concWallMat;
        return wallMat;
      };

      this.buildRoomWalls(name, r, pickWall());
    }

    this.buildDoorFrames();
    this.buildTrim(this.trimMats);
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

      // The face of the wall the room actually sees.
      const face = side.at + side.inward * WALL_T;
      const skirt = !r.outdoor && r.surface !== 'tile';
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
        // Skirting along the foot of the wall. It is a few centimetres of
        // geometry, and it is most of what stops a wall reading as a texture
        // stood on a floor texture.
        if (skirt) {
          const z = face + side.inward * 0.012;
          if (side.axis === 'z') this.trimBox('skirting', mid, 0.055, z, len, 0.11, 0.024);
          else this.trimBox('skirting', z, 0.055, mid, 0.024, 0.11, len);
        }
      }

      // Casings round every opening, on the side this room sees.
      for (const [a, b] of gaps) {
        const z = face + side.inward * 0.014;
        const W = 0.09;
        const H = 2.4;
        const jambs = [a - W / 2, b + W / 2];
        for (const j of jambs) {
          if (side.axis === 'z') this.trimBox('casing', j, H / 2, z, W, H, 0.028);
          else this.trimBox('casing', z, H / 2, j, 0.028, H, W);
        }
        const len = b - a + W * 2;
        const mid = (a + b) / 2;
        if (side.axis === 'z') this.trimBox('casing', mid, H + W / 2, z, len, W, 0.028);
        else this.trimBox('casing', z, H + W / 2, mid, 0.028, W, len);
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

  // The two locked doors: a painted steel leaf on a hinge, which swings open
  // when unlocked instead of blinking out of existence.
  buildDoorFrames() {
    const mats = {
      door: this.mat({ ...surface('paint', { metalness: 0.3 }), color: tint('paint', 0x3b4640) }),
      metal: this.mat({ ...surface('steel', { metalness: 0.7, roughness: 0.6 }), color: tint('steel', 0x8a8e8c) }),
    };
    for (const door of DOORS) {
      if (!door.locked) continue;
      const width = door.to - door.from;
      const leafW = width - 0.04;
      const leaf = makeDoorLeaf(leafW, 2.36, mats);
      const pivot = new THREE.Group();
      leaf.position.x = 0;
      pivot.add(leaf);

      // Hinge on the `from` jamb. A leaf's local +x runs from the hinge to
      // the latch edge; the closed yaw lays it along the opening.
      const closedYaw = door.axis === 'z' ? 0 : -Math.PI / 2;
      // Open is a quarter turn into the room it swings toward. Exactly a
      // quarter: any further and the leaf folds back through the jamb.
      const openYaw = door.axis === 'z'
        ? -door.swing * Math.PI / 2
        : (door.swing > 0 ? 0 : -Math.PI);
      if (door.axis === 'z') pivot.position.set(door.from + 0.02, 0, door.at);
      else pivot.position.set(door.at, 0, door.from + 0.02);
      pivot.rotation.y = closedYaw;
      this.group.add(pivot);

      const closed = door.axis === 'z'
        ? { x1: door.from, z1: door.at - 0.08, x2: door.to, z2: door.at + 0.08, top: 2.4, bottom: 0 }
        : { x1: door.at - 0.08, z1: door.from, x2: door.at + 0.08, z2: door.to, top: 2.4, bottom: 0 };
      // Swung open the leaf stands out of the wall into the room, so it gets a
      // thin blocker of its own along the hinge jamb.
      const reach = door.swing * leafW;
      const open = door.axis === 'z'
        ? { x1: door.from, z1: Math.min(door.at, door.at + reach), x2: door.from + 0.07, z2: Math.max(door.at, door.at + reach), top: 2.4, bottom: 0 }
        : { x1: Math.min(door.at, door.at + reach), z1: door.from, x2: Math.max(door.at, door.at + reach), z2: door.from + 0.07, top: 2.4, bottom: 0 };
      this.colliders.push(closed);

      this.doors.set(door.locked, {
        def: door, pivot, leaf, closed, open, closedYaw, openYaw,
        locked: true, yaw: closedYaw,
      });
    }
  }

  isLocked(key) {
    return this.doors.get(key)?.locked ?? false;
  }

  // Unlocks a door and swings it open for the rest of this loop.
  unlockDoor(key) {
    const door = this.doors.get(key);
    if (!door || !door.locked) return false;
    door.locked = false;
    this.swapCollider(door.closed, door.open);
    this.onGeometryChange?.();
    return true;
  }

  // Every loop puts the locks back.
  relockDoors() {
    let changed = false;
    for (const door of this.doors.values()) {
      if (door.locked) continue;
      door.locked = true;
      door.yaw = door.closedYaw;
      door.pivot.rotation.y = door.closedYaw;
      this.swapCollider(door.open, door.closed);
      changed = true;
    }
    if (changed) this.onGeometryChange?.();
  }

  swapCollider(out, inn) {
    const i = this.colliders.indexOf(out);
    if (i >= 0) this.colliders.splice(i, 1);
    if (!this.colliders.includes(inn)) this.colliders.push(inn);
  }

  // Eases opening doors round on their hinges.
  update(dt) {
    for (const door of this.doors.values()) {
      const target = door.locked ? door.closedYaw : door.openYaw;
      if (Math.abs(door.yaw - target) < 1e-3) continue;
      const step = Math.min(1, dt * 2.6);
      door.yaw += (target - door.yaw) * step;
      if (Math.abs(door.yaw - target) < 0.004) {
        door.yaw = target;
        // Settled: the cached shadows of the lights around it are stale.
        this.onGeometryChange?.();
      }
      door.pivot.rotation.y = door.yaw;
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
