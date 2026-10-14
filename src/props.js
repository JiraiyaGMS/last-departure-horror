import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Modelled props.
//
// Everything in the station used to be a box. That was defensible when the
// image was 320x240 and dithered -- a box and a bench are the same twelve
// pixels -- but at native resolution with shadows and a grazing flashlight, a
// box is just a box. The silhouette is the thing the player actually reads in
// the dark, and a slatted bench throws a completely different shadow than a
// slab does.
//
// The constraint is draw calls. A bench built honestly is twenty-odd pieces and
// there are nine of them in the hall alone. So each prop accumulates its parts
// per material and merges them into one mesh per material at the end: a bench
// costs two draw calls, not twenty-two, and the shadow map only has to chew
// through two.

// Collects box and cylinder primitives grouped by material key, then merges.
export class Build {
  constructor() {
    this.parts = new Map();
  }

  add(geo, key, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
    return this;
  }

  box(w, h, d, opts, key) {
    return this.add(new THREE.BoxGeometry(w, h, d), key, opts);
  }

  // Radial segment counts stay low on purpose: these are background objects
  // and the silhouette survives at 8 sides.
  cyl(rt, rb, h, seg, opts, key) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), key, opts);
  }

  // A turned profile, [[radius, y], ...] bottom to top.
  lathe(profile, seg, opts, key) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y));
    return this.add(new THREE.LatheGeometry(pts, seg), key, opts);
  }

  sphere(r, opts, key, w = 12, h = 8) {
    return this.add(new THREE.SphereGeometry(r, w, h), key, opts);
  }

  // Any ready-made geometry, placed with the usual options.
  geo(geometry, opts, key) {
    return this.add(geometry, key, opts);
  }

  // A box whose long axis runs between two points -- pipes, legs, rails.
  between(a, b, thick, key, seg = 8) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const g = new THREE.CylinderGeometry(thick, thick, len, seg);
    // Cylinder runs along +y; aim it along the segment.
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }

  // Returns a Group with one merged mesh per material.
  build(materials) {
    const group = new THREE.Group();
    for (const [key, geos] of this.parts) {
      const material = materials[key];
      if (!material) {
        console.warn('props: no material for key', key);
        continue;
      }
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) {
        console.warn('props: merge failed for key', key);
        continue;
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

// --- bench ------------------------------------------------------------------

// A municipal waiting-hall bench: slatted seat and back on cast end frames,
// with armrests splitting it into seats so nobody can lie down. The gaps
// between the slats are the whole point -- they are what make the shadow read
// as a bench rather than as a crate, and what let the flashlight throw stripes
// across the floor behind it.
export function makeBench(length, materials, opts = {}) {
  const b = new Build();
  const seatY = 0.44;
  const depth = 0.66;
  const backTilt = -0.14;

  const SLAT_T = 0.045;
  const SLAT_W = 0.1;
  const GAP = 0.035;

  // Seat slats, running the length of the bench.
  const seatSlats = 5;
  const span = seatSlats * SLAT_W + (seatSlats - 1) * GAP;
  for (let i = 0; i < seatSlats; i++) {
    const z = -span / 2 + SLAT_W / 2 + i * (SLAT_W + GAP);
    b.box(length, SLAT_T, SLAT_W, { y: seatY, z }, 'wood');
  }

  // Back slats, raked back off vertical.
  const backSlats = 3;
  for (let i = 0; i < backSlats; i++) {
    const h = 0.26 + i * 0.3;
    b.box(length, SLAT_W, SLAT_T, {
      y: seatY + h,
      z: -depth / 2 + 0.04 + Math.sin(backTilt) * -h,
      rx: backTilt,
    }, 'wood');
  }

  // Cast end frames and a centre support. Each is a foot, a leg and the
  // bracket that carries the seat.
  const frames = opts.frames ?? [-length / 2 + 0.12, 0, length / 2 - 0.12];
  for (const fx of frames) {
    b.box(0.07, seatY, 0.1, { x: fx, y: seatY / 2, z: depth / 2 - 0.12 }, 'metal');
    b.box(0.07, seatY, 0.1, { x: fx, y: seatY / 2, z: -depth / 2 + 0.14 }, 'metal');
    // Foot plates, splayed slightly so the bench looks bolted down.
    b.box(0.14, 0.035, 0.2, { x: fx, y: 0.017, z: depth / 2 - 0.12 }, 'metal');
    b.box(0.14, 0.035, 0.2, { x: fx, y: 0.017, z: -depth / 2 + 0.14 }, 'metal');
    // Rail tying the two legs together under the seat.
    b.box(0.05, 0.05, depth - 0.2, { x: fx, y: seatY - 0.06 }, 'metal');
    // Back upright.
    b.box(0.055, 0.92, 0.055, {
      x: fx, y: seatY + 0.46, z: -depth / 2 + 0.06, rx: backTilt,
    }, 'metal');
  }

  // Armrests over each frame.
  if (opts.arms !== false) {
    for (const fx of frames) {
      b.box(0.05, 0.05, depth - 0.16, { x: fx, y: seatY + 0.26, z: 0.02 }, 'metal');
      b.box(0.05, 0.22, 0.05, { x: fx, y: seatY + 0.15, z: depth / 2 - 0.1 }, 'metal');
    }
  }

  return b.build(materials);
}

// --- payphone ---------------------------------------------------------------

// Wall-mounted, with the handset on a cord. Half the horror of a phone is that
// it is a thing that can ring.
//
// The handset and cord are built as separate sub-groups rather than merged into
// the body, because the receiver coming off the hook by itself is a scare the
// game actually uses. Those two are exposed on `userData` so the caller can
// drop the handset and stretch the cord. It costs two extra draw calls on
// exactly one object in the station, which is a fair price for the one prop
// that has to move.
export function makePayphone(materials) {
  const b = new Build();
  // Backplate and body.
  b.box(0.34, 0.72, 0.16, { y: 0 }, 'metal');
  b.box(0.3, 0.2, 0.07, { y: 0.2, z: 0.1 }, 'dark');      // coin box face
  b.box(0.22, 0.26, 0.05, { y: -0.08, z: 0.1 }, 'dark');  // keypad plate

  // Keypad, 3x4. Tiny, but it catches the flashlight and reads as a phone.
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      b.box(0.045, 0.035, 0.012, {
        x: -0.06 + c * 0.06, y: 0.02 - r * 0.055, z: 0.13,
      }, 'light');
    }
  }

  // Cradle hooks. These stay with the body -- it is the handset that leaves.
  b.box(0.06, 0.05, 0.1, { x: -0.2, y: 0.22, z: 0.08 }, 'dark');
  b.box(0.06, 0.05, 0.1, { x: -0.2, y: -0.18, z: 0.08 }, 'dark');

  const group = b.build(materials);

  // Handset, modelled about its own centre so it can be rotated to dangle.
  // Its own material key, a shade off the body's: on the hook it sits against
  // the housing, and if the two are the same black the phone reads as one lump
  // with no receiver on it at all.
  const hb = new Build();
  hb.box(0.07, 0.3, 0.07, { }, 'handset');               // grip
  hb.box(0.09, 0.08, 0.09, { y: 0.14 }, 'handset');      // earpiece
  hb.box(0.09, 0.08, 0.09, { y: -0.14 }, 'handset');     // mouthpiece
  const handset = hb.build(materials);
  handset.position.set(-0.21, 0.02, 0.1);
  group.add(handset);

  // Armoured cord, as a chain of segments so it reads as hanging rather than
  // as a rod. Built downward from the origin so the caller can scale it in Y
  // and have it pay out from the top like real slack.
  const cb = new Build();
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    cb.cyl(0.016, 0.016, 0.07, 5, {
      x: t * 0.06, y: -0.04 - i * 0.05, z: -t * 0.02, rz: 0.2 * t,
    }, 'dark');
  }
  const cord = cb.build(materials);
  cord.position.set(-0.21, -0.14, 0.1);
  group.add(cord);

  group.userData.handset = handset;
  group.userData.cord = cord;
  return group;
}

// --- vending machine --------------------------------------------------------

// Lit from inside, which makes it one of the few things in the station that is
// its own light source. The glass is a separate material so it can be given
// something emissive.
export function makeVending(materials) {
  const b = new Build();
  const w = 0.95, h = 1.85, d = 0.7;

  // Carcass, built as a frame around the window rather than a solid box.
  b.box(w, 0.1, d, { y: h - 0.05 }, 'body');          // top
  b.box(w, 0.14, d, { y: 0.07 }, 'body');             // plinth
  b.box(0.12, h, d, { x: -w / 2 + 0.06, y: h / 2 }, 'body');  // left stile
  b.box(0.26, h, d, { x: w / 2 - 0.13, y: h / 2 }, 'body');   // right column
  b.box(w, h, 0.06, { y: h / 2, z: -d / 2 + 0.03 }, 'body');  // back

  // Glass front.
  b.box(w - 0.38, h - 0.5, 0.03, { x: -0.06, y: h / 2 + 0.05, z: d / 2 - 0.02 }, 'glass');

  // Product rows behind the glass, as blocks of colour on shelves.
  for (let row = 0; row < 4; row++) {
    const y = 0.5 + row * 0.33;
    b.box(w - 0.42, 0.02, d - 0.2, { x: -0.06, y: y - 0.02, z: 0 }, 'dark');
    for (let i = 0; i < 4; i++) {
      b.box(0.1, 0.17, 0.1, { x: -0.28 + i * 0.13, y: y + 0.09, z: 0.04 }, 'product');
    }
  }

  // Selection buttons and the delivery flap.
  for (let i = 0; i < 6; i++) {
    b.box(0.06, 0.04, 0.02, { x: w / 2 - 0.13, y: 1.5 - i * 0.14, z: d / 2 + 0.005 }, 'light');
  }
  b.box(w - 0.3, 0.26, 0.04, { y: 0.32, z: d / 2 - 0.01 }, 'dark');

  return b.build(materials);
}

// --- waste bin --------------------------------------------------------------

export function makeBin(materials) {
  const b = new Build();
  b.cyl(0.21, 0.17, 0.74, 10, { y: 0.37 }, 'metal');
  // Rolled rim, and a domed lid with the opening cut implied by a gap.
  b.cyl(0.225, 0.225, 0.05, 10, { y: 0.745 }, 'dark');
  b.cyl(0.2, 0.215, 0.07, 10, { y: 0.79 }, 'dark');
  return b.build(materials);
}

// --- ceiling fixture --------------------------------------------------------

// The housing around a fluorescent tube. Previously the tube was a bare glowing
// box floating under the ceiling; giving it a reflector and end caps means it
// occludes its own light sideways, which is most of what makes strip lighting
// look like strip lighting.
export function makeFixture(length, materials) {
  const b = new Build();
  const w = 0.34;
  b.box(length, 0.06, w, { y: 0.14 }, 'metal');                       // backplate
  b.box(length, 0.14, 0.05, { y: 0.07, z: w / 2 - 0.025 }, 'metal');  // reflector lip
  b.box(length, 0.14, 0.05, { y: 0.07, z: -w / 2 + 0.025 }, 'metal'); // reflector lip
  b.box(0.05, 0.14, w, { x: length / 2 - 0.025, y: 0.07 }, 'metal');  // end cap
  b.box(0.05, 0.14, w, { x: -length / 2 + 0.025, y: 0.07 }, 'metal'); // end cap
  return b.build(materials);
}

// --- lockers ----------------------------------------------------------------

// A bank of lockers. Doors are inset and the handles catch the light, so the
// wall reads as something you could open rather than as a flat panel.
//
// Cell size is an option because the station needs this at two scales: a grid
// of small coin lockers, and the four tall ones in Baggage Claim that a player
// can climb inside. Structurally they are the same object -- a welded frame
// with doors set into it -- so they are the same function.
export function makeLockers(cols, rows, materials, opts = {}) {
  const b = new Build();
  const cw = opts.cw ?? 0.38, ch = opts.ch ?? 0.44, d = opts.d ?? 0.5;
  const w = cols * cw, h = rows * ch;
  // Hardware scales with the door, but only part way: a locker twice the size
  // does not get a handle twice the size, it gets a slightly bigger one.
  const hw = 0.07 * (1 + (cw - 0.38) * 0.35);
  // { y, h, w }: an open, slatted vent centred `y` up each door, `h` tall and
  // `w` of the door's width across -- for lockers a person can climb into.
  const vent = opts.vent;

  b.box(w, h, 0.04, { y: h / 2, z: -d / 2 }, 'body');
  b.box(w, 0.05, d, { y: h }, 'body');
  b.box(w, 0.05, d, { y: 0.025 }, 'body');

  for (let c = 0; c <= cols; c++) {
    b.box(0.035, h, d, { x: -w / 2 + c * cw, y: h / 2 }, 'body');
  }
  for (let r = 0; r <= rows; r++) {
    b.box(w, 0.035, d, { y: r * ch }, 'body');
  }

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = -w / 2 + cw / 2 + c * cw;
      const y = ch / 2 + r * ch;
      // Door, set back a little so the frame reads as a frame.
      const dw = cw - 0.06;
      const dz = d / 2 - 0.03;
      if (vent) {
        // A real opening at eye height, slatted. Once the door shuts behind
        // you it is the only thing you can see out of -- in strips.
        const y0 = r * ch + 0.03;
        const y1 = y0 + ch - 0.06;
        const vb = r * ch + vent.y - vent.h / 2;
        const vt = vb + vent.h;
        const vw = cw * vent.w;
        const sw = (dw - vw) / 2;
        b.box(dw, vb - y0, 0.03, { x, y: (y0 + vb) / 2, z: dz }, 'door');
        b.box(dw, y1 - vt, 0.03, { x, y: (vt + y1) / 2, z: dz }, 'door');
        b.box(sw, vent.h, 0.03, { x: x - dw / 2 + sw / 2, y: vb + vent.h / 2, z: dz }, 'door');
        b.box(sw, vent.h, 0.03, { x: x + dw / 2 - sw / 2, y: vb + vent.h / 2, z: dz }, 'door');
        const slats = Math.round(vent.h / 0.032);
        for (let k = 0; k < slats; k++) {
          b.box(vw, 0.012, 0.03, { x, y: vb + ((k + 0.5) * vent.h) / slats, z: dz }, 'door');
        }
      } else {
        b.box(dw, ch - 0.06, 0.03, { x, y, z: dz }, 'door');
        // A louvred vent pressed into the top of the door.
        for (let v = 0; v < 3; v++) {
          b.box(cw * 0.45, 0.012, 0.012, {
            x, y: y + ch / 2 - 0.12 - v * 0.035, z: d / 2 - 0.005,
          }, 'metal');
        }
      }
      // Handle and the number plate above it.
      b.box(hw, 0.03, 0.03, { x: x + cw / 2 - 0.1, y, z: d / 2 - 0.005 }, 'metal');
      b.box(0.08, 0.05, 0.012, { x: x - cw / 2 + 0.1, y: y + ch / 2 - 0.09, z: d / 2 - 0.005 }, 'metal');
    }
  }

  return b.build(materials);
}

// --- belongings -------------------------------------------------------------

// The fourteen things on the Lost & Found shelves, one per passenger.
//
// These were all the same brown box, which undercut the only mechanic in the
// room: you are meant to pick an object up, recognise it, and carry it to the
// person it belongs to. Fourteen identical boxes means reading the prompt
// instead of looking at the shelf. So each one is matched to its description
// by keyword -- a hatbox is a wide drum, a thermos is a capped cylinder, a
// duffel is a bag lying on its side -- and you can tell them apart by
// silhouette from the aisle.
//
// Keyed off the item string in content.js rather than off the passenger id, so
// new passengers get a sensible shape without touching this file. The fallback
// is a parcel, which is a perfectly good thing to find in a lost property
// office.
const BELONGINGS = {
  hatbox: (b) => {
    b.cyl(0.17, 0.17, 0.18, 12, { y: 0.09 }, 'item');
    b.cyl(0.175, 0.175, 0.03, 12, { y: 0.185 }, 'item');
    // The crush on one side: a panel pushed in, which is the whole
    // description in one box.
    b.box(0.1, 0.12, 0.06, { x: 0.12, y: 0.09, z: 0.06, rz: 0.3 }, 'item');
  },
  thermos: (b) => {
    b.cyl(0.05, 0.055, 0.26, 10, { y: 0.13 }, 'metal');
    b.cyl(0.045, 0.045, 0.06, 10, { y: 0.29 }, 'dark');
    b.box(0.03, 0.09, 0.05, { x: 0.075, y: 0.17 }, 'dark');  // handle
  },
  rosary: (b) => {
    // A loop of beads, dropped on the shelf rather than laid out.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      b.cyl(0.012, 0.012, 0.022, 5, {
        x: Math.cos(a) * 0.07, y: 0.012, z: Math.sin(a) * 0.05, rx: Math.PI / 2,
      }, 'dark');
    }
    b.box(0.018, 0.045, 0.008, { z: 0.085, y: 0.012 }, 'metal');
    b.box(0.032, 0.012, 0.008, { z: 0.08, y: 0.012 }, 'metal');
  },
  soldier: (b) => {
    b.box(0.03, 0.09, 0.025, { y: 0.045 }, 'metal');         // body
    b.cyl(0.018, 0.018, 0.028, 6, { y: 0.1 }, 'metal');      // head
    b.box(0.055, 0.015, 0.02, { y: 0.065 }, 'metal');        // arms
    b.cyl(0.03, 0.035, 0.012, 8, { y: 0.006 }, 'dark');      // base
  },
  camera: (b) => {
    b.box(0.13, 0.085, 0.06, { y: 0.043 }, 'dark');
    b.cyl(0.032, 0.032, 0.045, 10, { y: 0.045, z: 0.05, rx: Math.PI / 2 }, 'metal');
    b.cyl(0.026, 0.026, 0.008, 10, { y: 0.045, z: 0.074, rx: Math.PI / 2 }, 'item');
    b.box(0.022, 0.018, 0.02, { x: 0.042, y: 0.094 }, 'metal');  // winder
    b.box(0.03, 0.012, 0.025, { x: -0.04, y: 0.092 }, 'dark');   // finder
  },
  logbook: (b) => {
    b.box(0.17, 0.028, 0.23, { y: 0.014 }, 'dark');
    b.box(0.155, 0.02, 0.215, { y: 0.036 }, 'paper');
    b.box(0.012, 0.004, 0.2, { x: -0.078, y: 0.05 }, 'metal');  // spine wire
  },
  watch: (b) => {
    b.cyl(0.042, 0.042, 0.016, 12, { y: 0.008 }, 'metal');
    b.cyl(0.036, 0.036, 0.004, 12, { y: 0.018 }, 'paper');
    b.cyl(0.01, 0.01, 0.012, 8, { y: 0.02, z: 0.044, rx: Math.PI / 2 }, 'metal');
    b.box(0.022, 0.006, 0.03, { y: 0.004, z: -0.05 }, 'metal');  // pin
  },
  duffel: (b) => {
    // Lying on its side and slumped, so it is a cylinder with the ends pulled
    // in rather than a clean tube.
    b.cyl(0.1, 0.1, 0.3, 10, { y: 0.1, rz: Math.PI / 2 }, 'item');
    b.cyl(0.07, 0.07, 0.04, 10, { x: 0.165, y: 0.1, rz: Math.PI / 2 }, 'item');
    b.cyl(0.07, 0.07, 0.04, 10, { x: -0.165, y: 0.1, rz: Math.PI / 2 }, 'item');
    b.box(0.14, 0.016, 0.03, { y: 0.2 }, 'dark');   // strap over the top
    b.box(0.26, 0.014, 0.012, { y: 0.1, z: 0.1 }, 'dark');  // zip
  },
  buttons: (b) => {
    // A sample case, lid open, trays of buttons showing. This is the one item
    // whose note points at a locker code, so it is worth being findable.
    b.box(0.26, 0.07, 0.19, { y: 0.035 }, 'dark');
    b.box(0.26, 0.015, 0.19, { y: 0.078 }, 'item');
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        b.cyl(0.02, 0.02, 0.008, 8, {
          x: -0.09 + c * 0.06, y: 0.09, z: -0.04 + r * 0.08,
        }, 'paper');
      }
    }
    b.box(0.07, 0.014, 0.02, { y: 0.077, z: 0.1 }, 'metal');  // clasp
  },
  sweets: (b) => {
    // A paper bag, gathered at the neck.
    b.box(0.12, 0.14, 0.09, { y: 0.07 }, 'paper');
    b.box(0.1, 0.05, 0.03, { y: 0.16, rz: 0.2 }, 'paper');
    b.cyl(0.022, 0.022, 0.02, 8, { x: 0.04, y: 0.01, z: 0.07 }, 'item');
    b.cyl(0.022, 0.022, 0.02, 8, { x: -0.02, y: 0.01, z: 0.08, rz: 0.4 }, 'item');
  },
  glasses: (b) => {
    // Folded, one arm up. The cracked lens is not modelled -- at this size the
    // shape is all you get -- but the asymmetry of the folded arms reads.
    for (const s of [-1, 1]) {
      b.cyl(0.032, 0.032, 0.006, 10, { x: s * 0.035, y: 0.02, rx: Math.PI / 2 }, 'metal');
    }
    b.box(0.022, 0.006, 0.006, { y: 0.02 }, 'metal');           // bridge
    b.box(0.1, 0.006, 0.006, { x: 0.085, y: 0.02, rz: -0.12 }, 'dark');
    b.box(0.1, 0.006, 0.006, { x: -0.08, y: 0.034, rz: 0.3 }, 'dark');
  },
  ribbon: (b) => {
    b.box(0.1, 0.004, 0.07, { y: 0.002 }, 'paper');   // cellophane sleeve
    b.box(0.055, 0.008, 0.035, { y: 0.008 }, 'item'); // the ribbon itself
    b.box(0.055, 0.006, 0.008, { y: 0.014, z: 0.012 }, 'metal');  // bar
  },
  mouthpiece: (b) => {
    b.cyl(0.019, 0.027, 0.07, 10, { y: 0.019, rx: Math.PI / 2 }, 'dark');
    b.cyl(0.016, 0.016, 0.02, 10, { y: 0.019, z: -0.044, rx: Math.PI / 2 }, 'metal');
    b.box(0.03, 0.008, 0.018, { y: 0.03, z: 0.026 }, 'metal');  // ligature
  },
  program: (b) => {
    // Folded to the hymn, so it is a tent rather than a flat sheet.
    b.box(0.14, 0.004, 0.1, { y: 0.03, z: -0.045, rx: 0.5 }, 'paper');
    b.box(0.14, 0.004, 0.1, { y: 0.03, z: 0.045, rx: -0.5 }, 'paper');
  },
  parcel: (b) => {
    b.box(0.2, 0.14, 0.15, { y: 0.07 }, 'item');
    b.box(0.206, 0.014, 0.014, { y: 0.07, z: 0.0 }, 'dark');   // string
    b.box(0.014, 0.014, 0.156, { y: 0.141 }, 'dark');
    b.box(0.07, 0.004, 0.045, { y: 0.141, x: 0.055 }, 'paper'); // label
  },
};

// Matched longest-keyword-first so 'logbook' is not caught by a shorter word.
const BELONGING_WORDS = [
  ['hatbox', 'hatbox'], ['thermos', 'thermos'], ['rosary', 'rosary'],
  ['soldier', 'soldier'], ['camera', 'camera'], ['logbook', 'logbook'],
  ['watch', 'watch'], ['duffel', 'duffel'], ['button', 'buttons'],
  ['sweets', 'sweets'], ['glasses', 'glasses'], ['ribbon', 'ribbon'],
  ['mouthpiece', 'mouthpiece'], ['program', 'program'],
];

export function belongingShape(name) {
  const s = String(name).toLowerCase();
  for (const [word, shape] of BELONGING_WORDS) {
    if (s.includes(word)) return shape;
  }
  return 'parcel';
}

export function makeBelonging(name, materials) {
  const b = new Build();
  (BELONGINGS[belongingShape(name)] ?? BELONGINGS.parcel)(b);
  return b.build(materials);
}

// --- doors ------------------------------------------------------------------

// A painted steel door leaf. Origin on the hinge edge at floor level; the leaf
// runs along +x to its latch edge and is centred on z, so the caller only has
// to turn it about its origin to swing it.
export function makeDoorLeaf(width, height, materials) {
  const b = new Build();
  const t = 0.05;
  b.box(width, height, t, { x: width / 2, y: height / 2 + 0.01 }, 'door');
  for (const s of [1, -1]) {
    const face = s * (t / 2 + 0.003);
    // Recessed panels, implied by a raised border.
    b.box(width - 0.16, 0.035, 0.006, { x: width / 2, y: height - 0.12, z: face }, 'door');
    b.box(width - 0.16, 0.035, 0.006, { x: width / 2, y: 1.18, z: face }, 'door');
    b.box(0.035, height - 0.3, 0.006, { x: 0.1, y: height / 2 + 0.02, z: face }, 'door');
    b.box(0.035, height - 0.3, 0.006, { x: width - 0.1, y: height / 2 + 0.02, z: face }, 'door');
    // Kick plate.
    b.box(width - 0.08, 0.24, 0.004, { x: width / 2, y: 0.15, z: s * (t / 2 + 0.002) }, 'metal');
    // Lever handle on a rose, near the latch edge.
    b.box(0.06, 0.16, 0.01, { x: width - 0.09, y: 1.02, z: s * (t / 2 + 0.005) }, 'metal');
    b.box(0.024, 0.024, 0.05, { x: width - 0.09, y: 1.05, z: s * (t / 2 + 0.03) }, 'metal');
    b.box(0.15, 0.022, 0.022, { x: width - 0.15, y: 1.05, z: s * (t / 2 + 0.055) }, 'metal');
  }
  // Three hinges on the hinge edge.
  for (const hy of [0.25, 1.15, height - 0.25]) {
    b.cyl(0.014, 0.014, 0.12, 8, { x: 0.005, y: hy }, 'metal');
  }
  return b.build(materials);
}

// --- vehicles ---------------------------------------------------------------

// A 1980s intercity coach. Built nose toward +z, standing on the ground at y=0
// and centred on x. `userData.sign` is where the destination blind sits, in
// the bus's own space, so the caller can hang a live panel on it.
export function makeBus(materials, opts = {}) {
  const b = new Build();
  const L = opts.length ?? 11.0;
  const W = 2.5;
  const H = 3.15;
  const front = L / 2;
  const back = -L / 2;
  const sill = 1.02;          // bottom of the upper body, over the wheels
  const axles = [front - 2.1, back + 2.6];
  const wellHalf = 0.68;

  // Upper body, from the wheel arches to the roof rail.
  b.box(W, H - sill - 0.12, L, { y: sill + (H - sill - 0.12) / 2 }, 'body');
  // Roof, inset a touch, with rounded rails down both sides.
  b.box(W - 0.24, 0.12, L - 0.3, { y: H - 0.06 }, 'body');
  for (const s of [-1, 1]) {
    b.cyl(0.12, 0.12, L - 0.3, 12, { x: s * (W / 2 - 0.12), y: H - 0.12, rx: Math.PI / 2 }, 'body');
  }
  // Chassis between the wheels, narrower so the wheels sit in real wells.
  b.box(W - 0.72, 0.62, L - 0.4, { y: 0.66 }, 'dark');
  // Skirt panels: everything along the sides that is not a wheel well.
  const cuts = [back + 0.1, ...axles.slice().sort((p, q) => p - q).flatMap((a) => [a - wellHalf, a + wellHalf]), front - 0.1];
  for (let i = 0; i < cuts.length; i += 2) {
    const z1 = cuts[i], z2 = cuts[i + 1];
    if (z2 - z1 < 0.05) continue;
    for (const s of [-1, 1]) {
      b.box(0.08, 0.66, z2 - z1, { x: s * (W / 2 - 0.04), y: 0.69, z: (z1 + z2) / 2 }, 'body');
    }
  }
  // Livery: a stripe and a bright belt-line moulding.
  for (const s of [-1, 1]) {
    b.box(0.012, 0.22, L - 0.2, { x: s * (W / 2 + 0.006), y: 1.32 }, 'trim');
    b.box(0.02, 0.04, L - 0.2, { x: s * (W / 2 + 0.01), y: 1.62 }, 'chrome');
    b.box(0.02, 0.035, L - 0.2, { x: s * (W / 2 + 0.01), y: 0.98 }, 'chrome');
  }

  // Side glazing: a run of windows with dark pillars between them. The front
  // door is on the right-hand (-x) side, just behind the windscreen.
  const winY1 = 1.72, winY2 = 2.72;
  const doorZ1 = front - 1.55, doorZ2 = front - 0.55;
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + 0.008);
    const z1 = back + 0.7;
    const z2 = s < 0 ? doorZ1 - 0.15 : front - 0.75;
    b.box(0.01, winY2 - winY1, z2 - z1, { x, y: (winY1 + winY2) / 2, z: (z1 + z2) / 2 }, 'glass');
    const n = Math.round((z2 - z1) / 1.35);
    for (let i = 0; i <= n; i++) {
      const z = z1 + ((z2 - z1) * i) / n;
      b.box(0.02, winY2 - winY1 + 0.04, 0.09, { x: s * (W / 2 + 0.012), y: (winY1 + winY2) / 2, z }, 'dark');
    }
  }
  // Door: two glazed leaves and a step well.
  b.box(0.012, 2.15, doorZ2 - doorZ1, { x: -(W / 2 + 0.01), y: 0.45 + 2.15 / 2, z: (doorZ1 + doorZ2) / 2 }, 'glass');
  b.box(0.02, 2.2, 0.05, { x: -(W / 2 + 0.014), y: 1.55, z: (doorZ1 + doorZ2) / 2 }, 'dark');
  b.box(0.02, 0.05, doorZ2 - doorZ1, { x: -(W / 2 + 0.014), y: 2.62, z: (doorZ1 + doorZ2) / 2 }, 'dark');

  // Windscreen, raked back, and the destination blind above it.
  b.box(W - 0.26, 1.28, 0.03, { y: 2.0, z: front + 0.005, rx: -0.06 }, 'glass');
  b.box(0.06, 1.3, 0.04, { y: 2.0, z: front + 0.01, rx: -0.06 }, 'dark');
  b.box(W - 0.2, 0.36, 0.04, { y: 2.86, z: front + 0.02 }, 'dark');
  // Rear window and engine grille.
  b.box(W - 0.4, 0.8, 0.03, { y: 2.25, z: back - 0.005 }, 'glass');
  for (let i = 0; i < 6; i++) {
    b.box(W - 0.6, 0.03, 0.02, { y: 0.85 + i * 0.07, z: back - 0.01 }, 'dark');
  }

  // Front: bumper, grille, quad headlamps, indicators.
  b.box(W + 0.04, 0.24, 0.2, { y: 0.52, z: front + 0.08 }, 'chrome');
  b.box(W - 0.9, 0.4, 0.03, { y: 0.98, z: front + 0.01 }, 'dark');
  for (const s of [-1, 1]) {
    for (const o of [0.72, 0.98]) {
      b.box(0.2, 0.16, 0.03, { x: s * o, y: 0.98, z: front + 0.02 }, 'lamp');
    }
    b.box(0.12, 0.08, 0.03, { x: s * 1.08, y: 0.76, z: front + 0.02 }, 'tail');
    // Mirror arms.
    b.box(0.05, 0.05, 0.45, { x: s * (W / 2 + 0.18), y: 2.3, z: front - 0.1 }, 'dark');
    b.box(0.08, 0.32, 0.18, { x: s * (W / 2 + 0.38), y: 2.18, z: front + 0.08 }, 'dark');
  }
  // Rear: bumper and tail lamps.
  b.box(W + 0.02, 0.22, 0.16, { y: 0.52, z: back - 0.06 }, 'chrome');
  for (const s of [-1, 1]) {
    b.box(0.16, 0.42, 0.03, { x: s * (W / 2 - 0.14), y: 1.1, z: back - 0.01 }, 'tail');
  }

  // Wheels: tyre, rim and hub. The rear axle runs twins.
  for (const az of axles) {
    const twin = az < 0;
    for (const s of [-1, 1]) {
      const xs = twin ? [W / 2 - 0.16, W / 2 - 0.46] : [W / 2 - 0.16];
      for (const xo of xs) {
        b.cyl(0.5, 0.5, 0.28, 18, { x: s * xo, y: 0.5, z: az, rz: Math.PI / 2 }, 'tire');
      }
      b.cyl(0.29, 0.29, 0.02, 16, { x: s * (W / 2 - 0.01), y: 0.5, z: az, rz: Math.PI / 2 }, 'chrome');
      b.cyl(0.1, 0.12, 0.05, 10, { x: s * (W / 2 + 0.01), y: 0.5, z: az, rz: Math.PI / 2 }, 'dark');
    }
  }

  const group = b.build(materials);
  group.userData.sign = { x: 0, y: 2.86, z: front + 0.045, w: W - 0.36, h: 0.28 };
  return group;
}

// --- diner ------------------------------------------------------------------

// A late-seventies jukebox: a cabinet under a lit arch, chrome all round, a
// selector window in the middle and a speaker grille below it. Faces +z.
// `userData.panel` is the selector window, for a live panel.
export function makeJukebox(materials) {
  const b = new Build();
  const w = 0.96, d = 0.66, h = 1.28;
  b.box(w, h, d, { y: h / 2 }, 'body');
  b.box(w + 0.04, 0.08, d + 0.04, { y: 0.04 }, 'chrome');
  // The arch. A half drum on top of the cabinet, axis front to back.
  b.geo(new THREE.CylinderGeometry(w / 2, w / 2, d, 28, 1, false, Math.PI / 2, Math.PI), { rx: Math.PI / 2, y: h }, 'body');
  // Lit tubes round the arch and down both front edges.
  b.geo(new THREE.TorusGeometry(w / 2 - 0.05, 0.028, 8, 32, Math.PI), { y: h, z: d / 2 + 0.01 }, 'glow');
  for (const s of [-1, 1]) {
    b.cyl(0.028, 0.028, h - 0.12, 10, { x: s * (w / 2 - 0.05), y: h / 2 + 0.06, z: d / 2 + 0.01 }, 'glow');
  }
  // Chrome bezel round the arch's front face.
  b.geo(new THREE.TorusGeometry(w / 2 - 0.005, 0.016, 6, 32, Math.PI), { y: h, z: d / 2 + 0.005 }, 'chrome');
  // Dome glass, dark and glossy.
  b.geo(new THREE.CircleGeometry(w / 2 - 0.09, 24, 0, Math.PI), { y: h, z: d / 2 + 0.006 }, 'dark');
  // Selector window surround.
  b.box(0.7, 0.42, 0.03, { y: 1.04, z: d / 2 + 0.005 }, 'chrome');
  // Speaker grille, with chrome bars across it.
  b.box(0.62, 0.42, 0.02, { y: 0.48, z: d / 2 + 0.005 }, 'dark');
  for (let i = 0; i < 7; i++) {
    b.box(0.6, 0.012, 0.016, { y: 0.31 + i * 0.058, z: d / 2 + 0.016 }, 'chrome');
  }
  const group = b.build(materials);
  group.userData.panel = { x: 0, y: 1.04, z: d / 2 + 0.023, w: 0.6, h: 0.34 };
  return group;
}

// A bar stool: weighted foot, pole, padded seat.
export function makeStool(materials) {
  const b = new Build();
  b.cyl(0.2, 0.22, 0.04, 16, { y: 0.02 }, 'metal');
  b.cyl(0.028, 0.028, 0.66, 10, { y: 0.36 }, 'metal');
  b.geo(new THREE.TorusGeometry(0.14, 0.012, 6, 16), { y: 0.3, rx: Math.PI / 2 }, 'metal');
  b.cyl(0.19, 0.17, 0.035, 16, { y: 0.69 }, 'metal');
  b.cyl(0.2, 0.2, 0.08, 18, { y: 0.745 }, 'seat');
  return b.build(materials);
}

// A drip coffee maker's carafe on its warming plate.
export function makeCoffeePot(materials) {
  const b = new Build();
  b.box(0.22, 0.03, 0.22, { y: 0.015 }, 'dark');
  b.cyl(0.075, 0.075, 0.01, 16, { y: 0.035 }, 'metal');
  b.lathe([[0.05, 0.0], [0.085, 0.03], [0.09, 0.08], [0.07, 0.14], [0.05, 0.17], [0.055, 0.19], [0.05, 0.2]], 18, { y: 0.04 }, 'glass');
  // The coffee itself, a dark mass in the bottom of the glass.
  b.lathe([[0.04, 0.0], [0.08, 0.03], [0.085, 0.07], [0.0, 0.07]], 16, { y: 0.045 }, 'coffee');
  b.box(0.02, 0.1, 0.03, { x: 0.105, y: 0.15 }, 'dark');
  b.box(0.04, 0.02, 0.03, { x: 0.09, y: 0.2 }, 'dark');
  b.box(0.04, 0.02, 0.03, { x: 0.09, y: 0.1 }, 'dark');
  return b.build(materials);
}

// --- security ---------------------------------------------------------------

// A bank of CRT monitors in a row, screens facing +z. Returns the group and,
// in `userData.screens`, each screen's centre and size in the bank's own
// space so the caller can map a slice of one live canvas onto each.
export function makeCRTBank(count, materials, opts = {}) {
  const b = new Build();
  const w = opts.w ?? 0.62, h = opts.h ?? 0.52, d = opts.d ?? 0.5, gap = opts.gap ?? 0.06;
  const total = count * w + (count - 1) * gap;
  const screens = [];
  for (let i = 0; i < count; i++) {
    const x = -total / 2 + w / 2 + i * (w + gap);
    // Bezel and the tapering tube housing behind it.
    b.box(w, h, 0.08, { x, y: h / 2, z: d / 2 - 0.04 }, 'case');
    b.box(w * 0.8, h * 0.8, d - 0.08, { x, y: h / 2, z: -0.04 }, 'case');
    b.box(w * 0.55, h * 0.55, 0.06, { x, y: h / 2, z: -d / 2 + 0.03 }, 'case');
    // Recess the glass sits in.
    b.box(w * 0.84, h * 0.8, 0.012, { x, y: h / 2 + 0.01, z: d / 2 + 0.002 }, 'dark');
    // Knobs and a power lamp along the bottom of the bezel.
    for (let k = 0; k < 2; k++) {
      b.cyl(0.014, 0.014, 0.02, 8, { x: x + w / 2 - 0.06 - k * 0.05, y: 0.045, z: d / 2 + 0.008, rx: Math.PI / 2 }, 'dark');
    }
    b.box(0.014, 0.014, 0.01, { x: x - w / 2 + 0.05, y: 0.045, z: d / 2 + 0.005 }, 'lamp');
    screens.push({ x, y: h / 2 + 0.01, z: d / 2 + 0.009, w: w * 0.78, h: h * 0.72 });
  }
  const group = b.build(materials);
  group.userData.screens = screens;
  group.userData.width = total;
  return group;
}

// A desk microphone on a gooseneck, for the PA.
export function makeDeskMic(materials) {
  const b = new Build();
  b.box(0.16, 0.035, 0.12, { y: 0.0175 }, 'dark');
  b.box(0.04, 0.012, 0.03, { x: 0.04, y: 0.04, z: 0.03 }, 'lamp');
  // The gooseneck: a chain of short segments bending toward the speaker.
  let p = [0, 0.035, -0.02];
  const pts = [[0, 0.1, -0.02], [0, 0.18, 0.0], [0, 0.25, 0.04], [0, 0.29, 0.09], [0, 0.3, 0.14]];
  for (const q of pts) {
    b.between(p, q, 0.009, 'metal', 6);
    p = q;
  }
  b.cyl(0.022, 0.018, 0.08, 10, { y: 0.3, z: 0.18, rx: Math.PI / 2 }, 'dark');
  b.geo(new THREE.SphereGeometry(0.024, 10, 6), { y: 0.3, z: 0.22 }, 'metal');
  return b.build(materials);
}

// --- restrooms --------------------------------------------------------------

// A close-coupled toilet, back to the wall at -z, facing +z.
export function makeToilet(materials) {
  const b = new Build();
  // Pedestal and bowl as one turned profile, squashed front to back.
  b.lathe([[0.11, 0], [0.12, 0.05], [0.1, 0.2], [0.16, 0.32], [0.19, 0.4], [0.185, 0.41], [0.0, 0.41]], 20, {}, 'porcelain');
  // Seat and lid.
  b.geo(new THREE.TorusGeometry(0.15, 0.025, 8, 20), { y: 0.425, rx: Math.PI / 2 }, 'seat');
  b.box(0.36, 0.025, 0.06, { y: 0.44, z: -0.2 }, 'seat');
  // Cistern.
  b.box(0.44, 0.36, 0.18, { y: 0.62, z: -0.27 }, 'porcelain');
  b.box(0.46, 0.04, 0.2, { y: 0.82, z: -0.27 }, 'porcelain');
  b.box(0.06, 0.02, 0.03, { x: 0.15, y: 0.74, z: -0.17 }, 'chrome');
  return b.build(materials);
}

// A run of wash basins set into a counter, backed against -z, with taps.
export function makeVanity(count, materials, opts = {}) {
  const b = new Build();
  const pitch = opts.pitch ?? 1.05;
  const depth = 0.58;
  const len = count * pitch + 0.2;
  const top = 0.86;
  b.box(len, 0.06, depth, { y: top - 0.03 }, 'counter');
  b.box(len, 0.16, 0.03, { y: top - 0.13, z: depth / 2 - 0.015 }, 'counter');
  // Splashback.
  b.box(len, 0.12, 0.02, { y: top + 0.06, z: -depth / 2 + 0.01 }, 'counter');
  for (let i = 0; i < count; i++) {
    const x = -len / 2 + 0.1 + pitch / 2 + i * pitch;
    // The bowl sits on the counter: a turned shell, up the outside, over the
    // rim and back down the inside, so it reads as a basin from above.
    b.lathe([
      [0.05, 0.0], [0.15, 0.012], [0.2, 0.05], [0.215, 0.11], [0.212, 0.125],
      [0.198, 0.122], [0.186, 0.07], [0.13, 0.032], [0.0, 0.026],
    ], 24, { x, y: top, z: 0.04 }, 'porcelain');
    b.cyl(0.024, 0.024, 0.004, 12, { x, y: top + 0.028, z: 0.04 }, 'chrome');
    // The trap under the counter.
    b.cyl(0.026, 0.026, top - 0.3, 8, { x, y: (top - 0.3) / 2 + 0.25, z: -0.05 }, 'chrome');
    // Pillar taps behind the bowl and a swan-neck spout over it.
    b.cyl(0.014, 0.018, 0.16, 10, { x, y: top + 0.08, z: -0.235 }, 'chrome');
    b.box(0.022, 0.022, 0.14, { x, y: top + 0.16, z: -0.17 }, 'chrome');
    b.cyl(0.011, 0.011, 0.04, 8, { x, y: top + 0.135, z: -0.105 }, 'chrome');
    for (const s of [-1, 1]) {
      b.cyl(0.016, 0.016, 0.06, 8, { x: x + s * 0.11, y: top + 0.03, z: -0.235 }, 'chrome');
      b.box(0.06, 0.012, 0.012, { x: x + s * 0.11, y: top + 0.065, z: -0.235 }, 'chrome');
    }
  }
  return b.build(materials);
}

// --- hall -------------------------------------------------------------------

// A round structural column with a plinth and a plain capital.
export function makeColumn(radius, height, materials) {
  const b = new Build();
  b.cyl(radius + 0.06, radius + 0.08, 0.14, 28, { y: 0.07 }, 'base');
  b.cyl(radius, radius, height - 0.34, 28, { y: 0.14 + (height - 0.34) / 2 }, 'shaft');
  b.cyl(radius + 0.06, radius, 0.2, 28, { y: height - 0.1 }, 'base');
  return b.build(materials);
}

// A dead rubber plant in a planter. Origin at the foot of the pot.
export function makePlant(materials) {
  const b = new Build();
  b.lathe([[0.22, 0], [0.25, 0.06], [0.3, 0.46], [0.31, 0.5], [0.29, 0.5], [0.0, 0.47]], 20, {}, 'pot');
  b.cyl(0.27, 0.27, 0.02, 18, { y: 0.465 }, 'soil');
  // Stems: bare, a little bent, one snapped and hanging.
  const stems = [
    [[0, 0.47, 0], [0.04, 1.0, 0.02], [0.02, 1.45, -0.05]],
    [[0.05, 0.47, 0.03], [0.18, 0.9, 0.1], [0.32, 1.12, 0.16]],
    [[-0.04, 0.47, -0.02], [-0.16, 0.82, -0.12], [-0.22, 0.98, -0.3]],
    [[-0.02, 0.47, 0.05], [-0.08, 0.74, 0.18], [-0.1, 0.6, 0.32]],
  ];
  for (const s of stems) {
    for (let i = 0; i < s.length - 1; i++) b.between(s[i], s[i + 1], 0.013, 'stem', 6);
    // What is left of the leaves: curled, hanging, brown.
    const tip = s[s.length - 1];
    const leaf = new THREE.SphereGeometry(0.075, 8, 5);
    leaf.scale(0.45, 1.4, 0.12);
    b.geo(leaf, { x: tip[0], y: tip[1] - 0.08, z: tip[2], rz: 0.5, ry: tip[0] * 3 }, 'leaf');
    const mid = s[1];
    const leaf2 = new THREE.SphereGeometry(0.06, 8, 5);
    leaf2.scale(0.5, 1.3, 0.12);
    b.geo(leaf2, { x: mid[0] + 0.05, y: mid[1] - 0.07, z: mid[2], rz: -0.7, ry: 1.1 }, 'leaf');
  }
  // Fallen leaves round the foot of the pot.
  for (const [lx, lz, r] of [[0.38, 0.1, 0.4], [-0.3, 0.3, 1.9], [0.12, -0.36, 3.1]]) {
    const leaf = new THREE.SphereGeometry(0.07, 8, 4);
    leaf.scale(0.5, 0.06, 1.3);
    b.geo(leaf, { x: lx, y: 0.008, z: lz, ry: r }, 'leaf');
  }
  return b.build(materials);
}

// A noticeboard: cork in a timber frame, facing +z.
export function makeNoticeboard(w, h, materials) {
  const b = new Build();
  b.box(w, h, 0.025, { y: 0 }, 'cork');
  b.box(w + 0.06, 0.04, 0.04, { y: h / 2 + 0.02 }, 'frame');
  b.box(w + 0.06, 0.04, 0.04, { y: -h / 2 - 0.02 }, 'frame');
  b.box(0.04, h, 0.04, { x: w / 2 + 0.01 }, 'frame');
  b.box(0.04, h, 0.04, { x: -w / 2 - 0.01 }, 'frame');
  return b.build(materials);
}

// --- small things -------------------------------------------------------------

// A two-cell torch lying on its side, lens toward +x.
export function makeFlashlight(materials) {
  const b = new Build();
  b.cyl(0.021, 0.021, 0.19, 12, { x: -0.03, y: 0.022, rz: Math.PI / 2 }, 'body');
  b.cyl(0.036, 0.022, 0.06, 14, { x: 0.095, y: 0.036, rz: Math.PI / 2 }, 'body');
  b.cyl(0.036, 0.036, 0.012, 14, { x: 0.131, y: 0.036, rz: Math.PI / 2 }, 'chrome');
  b.cyl(0.03, 0.03, 0.004, 14, { x: 0.138, y: 0.036, rz: Math.PI / 2 }, 'lens');
  b.box(0.03, 0.012, 0.016, { x: 0.02, y: 0.044 }, 'chrome');
  return b.build(materials);
}

// A hard-shell suitcase standing on its long edge, handle up. Faces +z.
export function makeSuitcase(materials, opts = {}) {
  const b = new Build();
  const w = opts.w ?? 0.62, h = opts.h ?? 0.44, d = opts.d ?? 0.2;
  b.box(w, h, d, { y: h / 2 }, 'case');
  b.box(w + 0.01, 0.03, d + 0.01, { y: h / 2 }, 'trim');
  b.box(0.16, 0.025, 0.035, { y: h + 0.04 }, 'trim');
  b.box(0.02, 0.04, 0.03, { x: -0.07, y: h + 0.02 }, 'trim');
  b.box(0.02, 0.04, 0.03, { x: 0.07, y: h + 0.02 }, 'trim');
  for (const s of [-1, 1]) b.box(0.05, 0.03, 0.022, { x: s * 0.2, y: h / 2 + 0.08, z: d / 2 + 0.006 }, 'trim');
  // The luggage tag.
  b.box(0.05, 0.08, 0.004, { x: 0.12, y: h + 0.0, z: d / 2 + 0.02, rz: 0.2 }, 'tag');
  return b.build(materials);
}

// A flatbed luggage cart with a push handle at one end.
export function makeLuggageCart(materials) {
  const b = new Build();
  b.box(1.5, 0.05, 0.85, { y: 0.32 }, 'metal');
  for (const s of [-1, 1]) {
    b.box(1.5, 0.08, 0.04, { y: 0.29, z: s * 0.42 }, 'dark');
  }
  b.between([-0.74, 0.34, -0.4], [-0.82, 1.05, -0.4], 0.018, 'metal');
  b.between([-0.74, 0.34, 0.4], [-0.82, 1.05, 0.4], 0.018, 'metal');
  b.between([-0.82, 1.05, -0.42], [-0.82, 1.05, 0.42], 0.022, 'metal');
  for (const wx of [-0.6, 0.6]) {
    for (const wz of [-0.36, 0.36]) {
      b.cyl(0.11, 0.11, 0.06, 14, { x: wx, y: 0.11, z: wz, rx: Math.PI / 2 }, 'dark');
      b.box(0.03, 0.12, 0.08, { x: wx, y: 0.24, z: wz }, 'metal');
    }
  }
  return b.build(materials);
}

// --- offices ------------------------------------------------------------------

// A steel office desk: top, pedestal of drawers on the right, modesty panel.
// The user sits on the -z side; it faces +z.
export function makeDesk(w, d, materials, opts = {}) {
  const b = new Build();
  const h = opts.h ?? 0.76;
  b.box(w, 0.04, d, { y: h - 0.02 }, 'top');
  b.box(w - 0.04, 0.05, d - 0.04, { y: h - 0.065 }, 'body');
  // Pedestal with three drawers on the +x end.
  const pw = Math.min(0.44, w * 0.35);
  const px = w / 2 - pw / 2 - 0.02;
  b.box(pw, h - 0.09, d - 0.06, { x: px, y: (h - 0.09) / 2 }, 'body');
  for (let i = 0; i < 3; i++) {
    const dy = 0.1 + i * ((h - 0.2) / 3) + (h - 0.2) / 6;
    b.box(pw - 0.04, (h - 0.2) / 3 - 0.02, 0.012, { x: px, y: dy, z: -(d / 2 - 0.03) }, 'body');
    b.box(0.12, 0.02, 0.025, { x: px, y: dy, z: -(d / 2 - 0.01) }, 'metal');
  }
  // Leg panel on the other end, and the modesty panel across the front.
  b.box(0.04, h - 0.09, d - 0.06, { x: -w / 2 + 0.04, y: (h - 0.09) / 2 }, 'body');
  b.box(w - pw - 0.1, 0.42, 0.02, { x: -pw / 2, y: h - 0.32, z: d / 2 - 0.05 }, 'body');
  return b.build(materials);
}

// A four-drawer filing cabinet, drawers to +z.
export function makeFilingCabinet(materials, opts = {}) {
  const b = new Build();
  const w = opts.w ?? 0.46, d = opts.d ?? 0.62, h = opts.h ?? 1.32;
  const n = opts.drawers ?? 4;
  b.box(w, h, d, { y: h / 2 }, 'body');
  const dh = (h - 0.06) / n;
  for (let i = 0; i < n; i++) {
    const y = 0.04 + dh / 2 + i * dh;
    b.box(w - 0.04, dh - 0.025, 0.02, { y, z: d / 2 + 0.006 }, 'body');
    b.box(0.14, 0.022, 0.03, { y: y + dh * 0.18, z: d / 2 + 0.025 }, 'metal');
    b.box(0.07, 0.03, 0.006, { y: y + dh * 0.33, z: d / 2 + 0.017 }, 'label');
  }
  return b.build(materials);
}

// A floor-standing ticket machine, front to +z. `userData.screen` is where the
// live display goes.
export function makeTicketMachine(materials) {
  const b = new Build();
  const w = 0.82, d = 0.62, h = 1.86;
  b.box(w, h, d, { y: h / 2 }, 'body');
  b.box(w + 0.04, 0.1, d + 0.04, { y: 0.05 }, 'dark');
  b.box(w + 0.03, 0.08, d + 0.03, { y: h - 0.04 }, 'dark');
  // The lit header, the screen recess, the coin slot and the delivery tray.
  b.box(w - 0.08, 0.2, 0.02, { y: h - 0.2, z: d / 2 + 0.006 }, 'lamp');
  b.box(w - 0.16, 0.46, 0.03, { y: 1.3, z: d / 2 + 0.004 }, 'dark');
  b.box(0.16, 0.2, 0.04, { x: 0.22, y: 0.93, z: d / 2 + 0.01 }, 'metal');
  b.box(0.06, 0.012, 0.02, { x: 0.22, y: 0.98, z: d / 2 + 0.032 }, 'dark');
  b.box(0.42, 0.14, 0.12, { y: 0.62, z: d / 2 + 0.03 }, 'metal');
  b.box(0.36, 0.08, 0.1, { y: 0.63, z: d / 2 + 0.04 }, 'dark');
  // Buttons.
  for (let i = 0; i < 3; i++) {
    b.cyl(0.025, 0.025, 0.02, 10, { x: -0.22, y: 0.99 - i * 0.075, z: d / 2 + 0.01, rx: Math.PI / 2 }, 'metal');
  }
  const group = b.build(materials);
  group.userData.screen = { x: 0, y: 1.3, z: d / 2 + 0.021, w: w - 0.24, h: 0.38 };
  return group;
}

// --- baggage ------------------------------------------------------------------

// A straight baggage belt along x, `len` long, with a flap hood at the -x end
// where the luggage goes through the wall.
export function makeConveyor(len, materials) {
  const b = new Build();
  const w = 1.6, h = 0.72;
  // Body, the belt surface and the stainless rails either side of it.
  b.box(len, h - 0.08, w - 0.1, { y: (h - 0.08) / 2 }, 'body');
  b.box(len, 0.03, w - 0.3, { y: h - 0.04 }, 'belt');
  for (const s of [-1, 1]) {
    b.box(len, 0.1, 0.12, { y: h - 0.02, z: s * (w / 2 - 0.08) }, 'metal');
    b.box(len, 0.035, 0.03, { y: h + 0.045, z: s * (w / 2 - 0.13) }, 'metal');
    // Kick panel at the foot.
    b.box(len, 0.12, 0.02, { y: 0.06, z: s * (w / 2 - 0.04) }, 'dark');
  }
  // Slat joints across the belt, so its movement would read.
  for (let x = -len / 2 + 0.2; x < len / 2; x += 0.4) {
    b.box(0.02, 0.006, w - 0.32, { x, y: h - 0.022 }, 'dark');
  }
  // The flap hood: a steel arch over the belt with a curtain of rubber strips.
  const hx = -len / 2 + 0.35;
  b.box(0.7, 0.06, w + 0.1, { x: hx, y: h + 0.82 }, 'metal');
  for (const s of [-1, 1]) {
    b.box(0.7, 0.86, 0.06, { x: hx, y: h + 0.4, z: s * (w / 2 + 0.02) }, 'metal');
  }
  for (let i = 0; i < 9; i++) {
    b.box(0.012, 0.74, (w - 0.2) / 9 - 0.01, { x: hx + 0.33, y: h + 0.41, z: -w / 2 + 0.1 + ((w - 0.2) / 9) * (i + 0.5) }, 'rubber');
  }
  return b.build(materials);
}
