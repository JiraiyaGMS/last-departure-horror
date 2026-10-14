import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface, tint, projectLocalUVs } from './textures.js';

// People.
//
// These were stacks of boxes, on the theory that a figure which reads as a
// person at thirty metres and as an assemblage up close keeps the eye from
// committing. It did -- but it also told the player, every time, that none of
// them were real. A body that is almost right is worse: shoulders that slope,
// knees that bend, hands with fingers on them, a face with the eyes sunk too
// far into the shadow of the brow. The Attendant is built on the same skeleton
// and then pulled out of true: too tall, too thin, arms that hang past where
// arms should end, and his back bent so his head arrives before he does.
//
// Each figure is a skinned mesh. Every part is rigidly bound to one bone and
// all parts that share a material are merged, so a whole person is four or
// five draw calls however many pieces they are made of, and posing them is
// just rotating bones. The rig object keeps the names the rest of the game
// already uses: torso, head, arms, legs.

// --- geometry helpers ---------------------------------------------------------
//
// All dimensions are for a 1.85m adult and are scaled at the end.

// A turned shape: `profile` is [[radius, y], ...] from bottom to top.
function lathe(profile, segments = 14) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y));
  return new THREE.LatheGeometry(pts, segments);
}

function sphere(r, sx = 1, sy = 1, sz = 1, w = 14, h = 10) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  return g;
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function at(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

// --- skeleton builder -----------------------------------------------------------

class Body {
  constructor() {
    this.bones = [];
    this.parts = new Map();
  }

  bone(name, parent, x, y, z) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    this.bones.push(b);
    return b;
  }

  // `geo` is in the bone's own space.
  add(bone, key, geo) {
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push({ bone, geo });
  }

  // Uniformly rescales the whole model before it is bound.
  scale(s) {
    for (const b of this.bones) b.position.multiplyScalar(s);
    for (const list of this.parts.values()) for (const p of list) p.geo.scale(s, s, s);
  }

  build(group, materials, metricKeys, height) {
    const root = this.bones[0];
    group.add(root);
    group.updateMatrixWorld(true);

    const meshes = [];
    for (const [key, list] of this.parts) {
      const material = materials[key];
      if (!material) continue;
      const geos = list.map(({ bone, geo }) => {
        const g = geo;
        g.applyMatrix4(bone.matrixWorld);
        const n = g.attributes.position.count;
        const index = this.bones.indexOf(bone);
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          si[i * 4] = index;
          sw[i * 4] = 1;
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        return g;
      });
      let merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) {
        console.warn('figures: merge failed for', key);
        continue;
      }
      // Clothes get their weave mapped in metres, in the bind pose, so it
      // stays on the body as the bones move it.
      if (metricKeys.includes(key)) {
        const projected = projectLocalUVs(merged);
        if (projected !== merged) merged.dispose();
        merged = projected;
      }
      const mesh = new THREE.SkinnedMesh(merged, material);
      // Something you can see through does not stop the light. The
      // translucent passengers throw no shadow at all, which nobody notices
      // until they do.
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = true;
      // Culling bounds wide enough for any pose, set by hand so three never
      // has to skin every vertex on the CPU to work them out.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), height * 0.85);
      group.add(mesh);
      meshes.push(mesh);
    }

    const skeleton = new THREE.Skeleton(this.bones);
    for (const mesh of meshes) mesh.bind(skeleton, new THREE.Matrix4());
    return meshes;
  }
}

// --- the figure -----------------------------------------------------------------

export function makeFigure(opts = {}) {
  const {
    coat = 0x2b3340,
    skin = 0x6b5a4a,
    cap = null,
    opacity = 1,
    height = 1.85,
    emissive = 0x000000,
    // The Attendant's build: longer bones, narrower frame, a hunch.
    gaunt = false,
    // A glint at the back of each eye socket.
    eyes = false,
    trousers = null,
  } = opts;

  const g = gaunt ? 1 : 0;
  const limb = 1 + g * 0.08;       // leg length
  const reach = 1 + g * 0.2;       // arm length
  const width = 1 - g * 0.16;      // shoulders, chest, hips
  const finger = 0.06 + g * 0.065; // finger length

  const body = new Body();
  const root = body.bone('root', null, 0, 0, 0);

  const thighL = 0.46 * limb;
  const shinL = 0.44 * limb;
  const hipY = 0.08 + shinL + thighL;
  const pelvis = body.bone('pelvis', root, 0, hipY, 0);

  // ---- legs ----
  const legs = [];
  const shins = [];
  for (const side of [-1, 1]) {
    const hip = body.bone(side < 0 ? 'hipL' : 'hipR', pelvis, side * 0.095 * width, 0, 0);
    body.add(hip, 'trousers', lathe([
      [0.05, -thighL], [0.058, -thighL * 0.8], [0.072, -thighL * 0.45],
      [0.08, -thighL * 0.15], [0.078, 0.02],
    ]));
    // Kneecap, so the joint has a shape when it bends.
    body.add(hip, 'trousers', at(sphere(0.052), 0, -thighL, -0.005));
    const knee = body.bone(side < 0 ? 'kneeL' : 'kneeR', hip, 0, -thighL, 0);
    body.add(knee, 'trousers', lathe([
      [0.036, -shinL], [0.04, -shinL * 0.85], [0.052, -shinL * 0.45],
      [0.055, -shinL * 0.25], [0.05, 0],
    ]));
    // Shoe: a heel block and a rounded toe, sitting under the ankle.
    body.add(knee, 'dark', at(box(0.095, 0.075, 0.2), 0, -shinL - 0.042, -0.035));
    body.add(knee, 'dark', at(sphere(0.05, 1, 0.75, 1.3), 0, -shinL - 0.05, -0.12));
    legs.push(hip);
    shins.push(knee);
  }

  // Pelvis and the skirt of the coat, which hangs from the waist and hides the
  // join between legs and body the way a real coat does.
  body.add(pelvis, 'trousers', at(lathe([
    [0.1, -0.12], [0.145, -0.09], [0.155, -0.02], [0.15, 0.06],
  ]), 0, 0, 0).scale(width, 1, 0.72));
  const skirtLen = 0.36 + g * 0.18;
  body.add(pelvis, 'coat', lathe([
    [0.215, -skirtLen], [0.235, -skirtLen + 0.01], [0.2, -skirtLen * 0.5],
    [0.168, 0.0], [0.162, 0.07], [0.15, 0.07], [0.155, 0.0],
    [0.19, -skirtLen * 0.5], [0.222, -skirtLen + 0.012],
  ], 18).scale(width, 1, 0.78));

  // ---- torso ----
  const torsoLen = 0.45 * (1 + g * 0.04);
  const torso = body.bone('torso', pelvis, 0, 0.06, 0);
  body.add(torso, 'coat', lathe([
    [0.152, -0.02], [0.156, 0.08], [0.172, 0.2], [0.192, 0.3],
    [0.198, torsoLen - 0.08], [0.178, torsoLen - 0.02], [0.12, torsoLen + 0.02],
    [0.06, torsoLen + 0.04],
  ], 20).scale(width, 1, 0.62));
  // Lapels: two dark folds down the front of the coat.
  for (const side of [-1, 1]) {
    body.add(torso, 'trousers', at(box(0.05, 0.26, 0.012), side * 0.05 * width, torsoLen - 0.17, -0.118, 0.06, 0, side * -0.18));
  }

  // The Attendant's upper back is bent. His head and arms hang off a chest
  // bone tipped forward, so his face leads him into every room.
  const chest = body.bone('chest', torso, 0, torsoLen * 0.55, 0);
  chest.rotation.x = g * 0.2;
  const shoulderY = torsoLen - torsoLen * 0.55;

  // ---- neck and head ----
  const neckLen = 0.08 + g * 0.05;
  body.add(chest, 'skin', at(lathe([[0.056, 0], [0.05, neckLen * 0.6], [0.052, neckLen + 0.02]], 10), 0, shoulderY, 0.005));
  // Collar. His is turned up, high enough to hide most of the neck.
  const collarH = 0.05 + g * 0.06;
  body.add(chest, 'coat', at(lathe([
    [0.085, -0.01], [0.078, collarH * 0.7], [0.074 + g * 0.01, collarH],
    [0.066 + g * 0.01, collarH], [0.07, collarH * 0.6], [0.075, -0.01],
  ], 14), 0, shoulderY, 0.005).scale(1, 1, 0.9));
  const head = body.bone('head', chest, 0, shoulderY + neckLen, -0.01 - g * 0.035);

  const longFace = 1 + g * 0.12;
  // Cranium and jaw. Two masses, not one ball: the jaw is what makes it a face.
  body.add(head, 'skin', at(sphere(0.103, 0.9, 1.1, 1.02, 20, 14), 0, 0.115, 0));
  body.add(head, 'skin', at(sphere(0.078, 0.92, 0.78 * longFace, 0.98), 0, 0.04 - g * 0.012, -0.022));
  // Brow ridge, heavy enough to hold a shadow over the eyes.
  body.add(head, 'skin', at(box(0.092, 0.02, 0.03), 0, 0.142, -0.092, -0.25));
  // Nose.
  body.add(head, 'skin', at(new THREE.ConeGeometry(0.017, 0.045, 6), 0, 0.103, -0.1, -1.25));
  // Cheekbones.
  for (const side of [-1, 1]) {
    body.add(head, 'skin', at(sphere(0.024, 1.2, 0.8, 1), side * 0.052, 0.088, -0.07));
    // Ears.
    body.add(head, 'skin', at(sphere(0.024, 0.45, 1.15, 0.8), side * 0.094, 0.105, 0.01));
    // Sockets: dark hollows set into the skull. In anything but direct light
    // they read as eyes looking straight at you.
    body.add(head, 'dark', at(sphere(0.022, 1.15, 0.85, 0.7), side * 0.036, 0.122, -0.087));
    if (eyes) {
      // Not eyes, exactly -- a wet point of light at the back of the hollow.
      body.add(head, 'eyes', at(sphere(0.0055, 1, 1, 1, 6, 4), side * 0.036, 0.121, -0.1));
    }
  }
  // Mouth: a thin dark line, slightly open.
  body.add(head, 'dark', at(box(0.042, 0.007 + g * 0.006, 0.012), 0, 0.045 - g * 0.018, -0.097));

  if (cap !== null) {
    // Peaked uniform cap, worn low enough to shade the eyes.
    body.add(head, 'cap', at(new THREE.CylinderGeometry(0.108, 0.104, 0.085, 16), 0, 0.2, 0.005, -0.1));
    body.add(head, 'cap', at(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 16).scale(1, 1, 1.35), 0, 0.168, -0.035, 0.12));
  } else {
    // Hair: a cap of dark over the top and back of the skull.
    body.add(head, 'dark', at(new THREE.SphereGeometry(0.107, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)
      .scale(0.92, 1.12, 1.05), 0, 0.118, 0.006, 0.38));
  }

  // ---- arms ----
  const upperL = 0.3 * reach;
  const foreL = 0.26 * reach;
  const arms = [];
  const forearms = [];
  for (const side of [-1, 1]) {
    // Gaunt shoulders ride up and forward, as if he is always reaching.
    const shoulder = body.bone(side < 0 ? 'shoulderL' : 'shoulderR', chest,
      side * 0.175 * width, shoulderY - 0.065 + g * 0.02, -g * 0.03);
    // The deltoid, kept inside the line of the coat so it rounds the shoulder
    // off instead of sitting on top of it like a pad.
    body.add(shoulder, 'coat', at(sphere(0.056, 1.05, 1.0, 1.0), side * -0.01, 0.005, 0));
    body.add(shoulder, 'coat', lathe([
      [0.042, -upperL], [0.048, -upperL * 0.75], [0.054, -upperL * 0.35], [0.058, 0.0],
    ]));
    const elbow = body.bone(side < 0 ? 'elbowL' : 'elbowR', shoulder, 0, -upperL, 0);
    body.add(elbow, 'coat', sphere(0.044));
    body.add(elbow, 'coat', lathe([
      [0.04, -foreL], [0.043, -foreL * 0.8], [0.046, -foreL * 0.4], [0.044, 0],
    ]));
    // Hand: palm and thumb. Ordinary people's fingers are curled into a
    // loose fist; the Attendant's hang open, four of them, half as long again
    // as anyone else's.
    const handY = -foreL - 0.045;
    body.add(elbow, 'skin', at(box(0.072, 0.085, 0.026), 0, handY, 0));
    if (gaunt) {
      for (let f = 0; f < 4; f++) {
        const fx = (f - 1.5) * 0.017;
        const len = finger * (f === 0 || f === 3 ? 0.85 : 1);
        body.add(elbow, 'skin', at(new THREE.CapsuleGeometry(0.0075, len, 1, 4), fx, handY - 0.0425 - len / 2, 0.003, 0.08));
      }
    } else {
      body.add(elbow, 'skin', at(sphere(0.034, 1.05, 0.75, 0.8, 8, 5), 0, handY - 0.05, 0.004));
    }
    body.add(elbow, 'skin', at(new THREE.CapsuleGeometry(0.009, 0.035, 1, 4), side * -0.04, handY + 0.005, -0.012, 0, 0, side * 0.5));
    arms.push(shoulder);
    forearms.push(elbow);
  }

  // Natural height of the proportions above, then scale to what was asked.
  const natural = hipY + 0.06 + torsoLen * 0.55 + shoulderY + neckLen + 0.23;
  const s = height / natural;
  body.scale(s);

  // ---- materials ----
  const ghost = opacity < 1;
  const common = {
    transparent: ghost,
    opacity,
    depthWrite: !ghost,
    emissive,
  };
  const trouserColor = trousers ?? new THREE.Color(coat).multiplyScalar(0.55).getHex();
  const materials = {
    coat: new THREE.MeshStandardMaterial({ ...surface('cloth'), ...common, color: tint('cloth', coat) }),
    trousers: new THREE.MeshStandardMaterial({ ...surface('cloth'), ...common, color: tint('cloth', trouserColor) }),
    cap: cap !== null
      ? new THREE.MeshStandardMaterial({ ...surface('cloth', { normal: 0.6 }), ...common, color: tint('cloth', cap) })
      : null,
    // Skin is matte and a little waxy, and never quite the colour of a living
    // person under these tubes.
    skin: new THREE.MeshStandardMaterial({ ...common, color: skin, roughness: 0.66, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ ...common, color: 0x0b0c0d, roughness: 0.75, metalness: 0 }),
    eyes: eyes
      ? new THREE.MeshBasicMaterial({ color: 0xb9d4c8, transparent: ghost, opacity, depthWrite: !ghost })
      : null,
  };

  const group = new THREE.Group();
  const meshes = body.build(group, materials, ['coat', 'trousers', 'cap'], height);
  const [hipL, hipR] = legs;

  // Rest pose: arms hang a little away from the coat, elbows soft.
  arms[0].rotation.z = -0.07;
  arms[1].rotation.z = 0.07;
  for (const e of forearms) e.rotation.x = 0.1;

  group.userData.rig = {
    pelvis,
    torso,
    head,
    legs: [hipL, hipR],
    shins,
    arms,
    forearms,
    scale: s,
    pelvisY: pelvis.position.y,
  };
  group.userData.materials = Object.values(materials).filter(Boolean);
  group.userData.meshes = meshes;
  group.userData.walkPhase = Math.random() * 6;
  return group;
}

// --- animation ------------------------------------------------------------------

export function animateWalk(figure, speed, dt) {
  const rig = figure.userData.rig;
  if (!rig) return;
  figure.userData.walkPhase += dt * (3 + speed * 3.2);
  figure.userData.walking = true;
  const p = figure.userData.walkPhase;
  const amp = Math.min(0.55, speed * 0.3);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  rig.legs[0].rotation.x = sp * amp;
  rig.legs[1].rotation.x = -sp * amp;
  // A knee bends while its leg swings through, and locks as the foot lands.
  rig.shins[0].rotation.x = -(0.06 + Math.max(0, cp) * amp * 1.5);
  rig.shins[1].rotation.x = -(0.06 + Math.max(0, -cp) * amp * 1.5);
  rig.arms[0].rotation.x = -sp * amp * 0.75;
  rig.arms[1].rotation.x = sp * amp * 0.75;
  rig.forearms[0].rotation.x = 0.15 + Math.max(0, -sp) * amp * 0.5;
  rig.forearms[1].rotation.x = 0.15 + Math.max(0, sp) * amp * 0.5;
  rig.torso.rotation.y = sp * amp * 0.12;
  rig.pelvis.position.y = rig.pelvisY + Math.abs(cp) * 0.018 * rig.scale;
}

// Standing still. Limbs settle back to rest rather than freezing mid-stride.
// A seated figure keeps its legs where they are and only breathes and sways.
// `head` is false when something else (lookAt) owns the head this frame.
export function idleSway(figure, t, head = true) {
  const rig = figure.userData.rig;
  if (!rig) return;
  figure.userData.walking = false;
  const p = t * 0.8 + figure.userData.walkPhase;
  rig.torso.rotation.z = Math.sin(p) * 0.02;
  rig.torso.rotation.y *= 0.85;
  if (head) rig.head.rotation.y = Math.sin(p * 0.6) * 0.12;
  if (!figure.userData.seated) {
    for (const j of [...rig.legs, ...rig.shins]) j.rotation.x *= 0.85;
    rig.arms[0].rotation.x *= 0.85;
    rig.arms[1].rotation.x *= 0.85;
    for (const e of rig.forearms) e.rotation.x += (0.1 - e.rotation.x) * 0.15;
    rig.pelvis.position.y += (rig.pelvisY - rig.pelvis.position.y) * 0.15;
  }
  // Breathing: the chest lifts, very slightly.
  rig.torso.scale.y = 1 + Math.sin(t * 1.7 + figure.userData.walkPhase) * 0.006;
}

// Sitting down: thighs forward along the seat, shins hanging, hands resting
// on the knees. Returns the height the figure's root has to be lifted to for
// its thighs to rest on a seat of height `seatY`.
export function sitPose(figure, seatY) {
  const rig = figure.userData.rig;
  if (!rig) return 0;
  figure.userData.seated = true;
  // Figures face -z; a positive x rotation swings a limb forward.
  rig.legs[0].rotation.set(Math.PI / 2 - 0.04, 0, 0.05);
  rig.legs[1].rotation.set(Math.PI / 2 + 0.03, 0, -0.06);
  rig.shins[0].rotation.x = -Math.PI / 2 + 0.12;
  rig.shins[1].rotation.x = -Math.PI / 2 + 0.02;
  rig.arms[0].rotation.x = 0.42;
  rig.arms[1].rotation.x = 0.38;
  rig.forearms[0].rotation.x = 0.85;
  rig.forearms[1].rotation.x = 0.9;
  rig.torso.rotation.x = 0.06;
  // The hip joint sits about a thigh's thickness above the seat.
  return Math.max(0, seatY + 0.085 * rig.scale - rig.pelvisY);
}

// Held poses for the freeze-when-watched trick. None of them are things a
// person waiting for a bus would do, which is the point: every time you look
// away and look back, he is standing wrong in a new way.
const POSES = [
  // torsoPitch, torsoRoll, headPitch, headRoll, armL, armR, elbowL, elbowR, legSpread
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.0, 0.0, 0.00],    // dead straight, arms flat
  [0.22, 0.00, -0.45, 0.00, 0.10, 0.10, 0.2, 0.2, 0.00],   // stooped, head craned up at you
  [0.00, 0.14, 0.00, 0.62, -0.20, 0.08, 0.1, 0.4, 0.05],   // head cocked hard to one side
  [-0.08, 0.00, 0.30, 0.00, 1.25, 1.25, 0.25, 0.25, 0.00], // both arms reaching for you
  [0.05, -0.10, 0.10, -0.55, 0.00, 1.45, 0.0, 0.1, 0.00],  // one arm up, pointing, head tilted away
  [0.48, 0.00, -0.75, 0.00, -0.30, -0.30, 0.0, 0.0, 0.10], // bent at the waist, staring up
  [0.00, 0.00, 0.00, 1.05, 0.00, 0.00, 0.6, 0.6, 0.00],    // head almost horizontal
  [0.10, 0.05, 0.55, 0.20, 0.35, -0.10, 1.6, 0.2, 0.00],   // chin on chest, one hand at the throat
];

export function randomPose(figure) {
  const rig = figure.userData.rig;
  if (!rig) return;
  const p = POSES[Math.floor(Math.random() * POSES.length)];
  rig.torso.rotation.x = p[0];
  rig.torso.rotation.z = p[1];
  rig.head.rotation.x = p[2];
  rig.head.rotation.z = p[3];
  // Positive swings the arm forward, toward whoever he is facing.
  rig.arms[0].rotation.x = p[4];
  rig.arms[1].rotation.x = p[5];
  rig.forearms[0].rotation.x = p[6];
  rig.forearms[1].rotation.x = p[7];
  rig.legs[0].rotation.x = p[8];
  rig.legs[1].rotation.x = -p[8];
  rig.shins[0].rotation.x = 0;
  rig.shins[1].rotation.x = 0;
  figure.userData.nextTwitch = 0.8 + Math.random() * 2.7;
  figure.userData.poseDirty = true;
  figure.userData.walking = false;
}

export function clearPose(figure) {
  const rig = figure.userData.rig;
  if (!rig) return;
  rig.torso.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
  figure.userData.poseDirty = true;
}

// Tiny involuntary head movements while frozen. Always a touch too fast and
// in the wrong direction to read as breathing.
export function twitch(figure, dt) {
  const rig = figure.userData.rig;
  if (!rig) return;
  const d = figure.userData;
  d.nextTwitch = (d.nextTwitch ?? 1) - dt;
  if (d.twitchLeft > 0) {
    d.twitchLeft -= dt;
    if (d.twitchLeft <= 0) {
      rig.head.rotation.z = d.twitchBase ?? 0;
      d.poseDirty = true;
    }
    return;
  }
  if (d.nextTwitch <= 0) {
    d.nextTwitch = 0.8 + Math.random() * 2.7;
    d.twitchLeft = 0.06 + Math.random() * 0.12;
    d.twitchBase = rig.head.rotation.z;
    rig.head.rotation.z += (Math.random() - 0.5) * 1.2;
    d.poseDirty = true;
  }
}

// Turns the head toward a world point, within what a neck allows -- and, for
// the Attendant, a little past it. Returns nothing; eases over `dt`.
export function lookAt(figure, x, z, dt, limit = 1.1) {
  const rig = figure.userData.rig;
  if (!rig) return;
  const dx = x - figure.position.x;
  const dz = z - figure.position.z;
  // Figures face -Z; work out the target yaw relative to the body.
  const want = Math.atan2(-dx, -dz) - figure.rotation.y;
  const rel = Math.atan2(Math.sin(want), Math.cos(want));
  const target = Math.max(-limit, Math.min(limit, rel));
  rig.head.rotation.y += (target - rig.head.rotation.y) * Math.min(1, dt * 5);
  figure.userData.poseDirty = true;
}
