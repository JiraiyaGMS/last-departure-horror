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
class Build {
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
      b.box(cw - 0.06, ch - 0.06, 0.03, { x, y, z: d / 2 - 0.03 }, 'door');
      // Handle and the number plate above it.
      b.box(hw, 0.03, 0.03, { x: x + cw / 2 - 0.1, y, z: d / 2 - 0.005 }, 'metal');
      b.box(0.08, 0.05, 0.012, { x: x - cw / 2 + 0.1, y: y + ch / 2 - 0.09, z: d / 2 - 0.005 }, 'metal');
      // Louvred vent in the top of each door. On the tall ones this is the
      // only thing you can see out of once the door shuts behind you.
      for (let v = 0; v < 3; v++) {
        b.box(cw * 0.45, 0.012, 0.012, {
          x, y: y + ch / 2 - 0.12 - v * 0.035, z: d / 2 - 0.005,
        }, 'metal');
      }
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
