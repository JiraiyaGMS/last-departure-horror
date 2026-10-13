import * as THREE from 'three';
// Blocky humanoids. The crudeness is kept on purpose -- a figure that reads as
// a person at thirty metres and as an assemblage up close is more unsettling
// than one that is merely low-detail, and it means the eye never quite commits
// to what it is looking at.

function part(w, h, d, color, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    // Cloth, not plastic. Without this every figure catches the fluorescents
    // like a mannequin, which is the one read we do not want for the living.
    roughness: opts.roughness ?? 0.92,
    metalness: 0,
    transparent: opts.opacity !== undefined && opts.opacity < 1,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    depthWrite: (opts.opacity ?? 1) > 0.95,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function makeFigure(opts = {}) {
  const {
    coat = 0x2b3340,
    skin = 0x6b5a4a,
    cap = null,
    opacity = 1,
    height = 1.85,
    emissive = 0x000000,
  } = opts;

  const group = new THREE.Group();
  const s = height / 1.85;

  const torso = part(0.52, 0.72, 0.3, coat, { opacity, emissive });
  torso.position.y = 1.18 * s;
  group.add(torso);

  const hips = part(0.46, 0.22, 0.28, coat, { opacity, emissive });
  hips.position.y = 0.76 * s;
  group.add(hips);

  const head = part(0.26, 0.3, 0.26, skin, { opacity, emissive });
  head.position.y = 1.68 * s;
  group.add(head);

  // The face is always in shadow: a black plate just in front of it.
  const face = part(0.2, 0.16, 0.02, 0x05060a, { opacity: Math.min(1, opacity + 0.2) });
  face.position.set(0, 1.68 * s, -0.14);
  group.add(face);

  if (cap !== null) {
    const brim = part(0.3, 0.05, 0.34, cap, { opacity });
    brim.position.set(0, 1.8 * s, -0.04);
    group.add(brim);
    const crown = part(0.27, 0.12, 0.27, cap, { opacity });
    crown.position.y = 1.88 * s;
    group.add(crown);
  }

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = part(0.17, 0.72, 0.19, coat, { opacity, emissive });
    leg.position.set(side * 0.13, 0.36 * s, 0);
    group.add(leg);
    legs.push(leg);
  }

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = part(0.14, 0.64, 0.16, coat, { opacity, emissive });
    // Pivot at the shoulder so rotation reads as a swing.
    arm.geometry.translate(0, -0.32, 0);
    arm.position.set(side * 0.33, 1.48 * s, 0);
    group.add(arm);
    arms.push(arm);
  }

  group.userData.rig = { torso, head, legs, arms, scale: s };
  group.userData.walkPhase = Math.random() * 6;
  return group;
}

export function animateWalk(figure, speed, dt) {
  const rig = figure.userData.rig;
  if (!rig) return;
  figure.userData.walkPhase += dt * (3 + speed * 3.2);
  const p = figure.userData.walkPhase;
  const amp = Math.min(0.5, speed * 0.3);
  rig.legs[0].rotation.x = Math.sin(p) * amp;
  rig.legs[1].rotation.x = -Math.sin(p) * amp;
  rig.arms[0].rotation.x = -Math.sin(p) * amp * 0.8;
  rig.arms[1].rotation.x = Math.sin(p) * amp * 0.8;
  rig.torso.position.y = (1.18 + Math.abs(Math.sin(p)) * 0.02) * rig.scale;
}

export function idleSway(figure, t) {
  const rig = figure.userData.rig;
  if (!rig) return;
  const p = t * 0.8 + figure.userData.walkPhase;
  rig.torso.rotation.z = Math.sin(p) * 0.02;
  rig.head.rotation.y = Math.sin(p * 0.6) * 0.12;
}

// Held poses for the freeze-when-watched trick. None of them are things a
// person waiting for a bus would do, which is the point: every time you look
// away and look back, he is standing wrong in a new way.
const POSES = [
  // [torsoPitch, torsoRoll, headPitch, headRoll, armL, armR, legSpread]
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],  // dead straight, arms flat
  [0.22, 0.00, -0.35, 0.00, 0.10, 0.10, 0.00], // stooped, head craned up
  [0.00, 0.14, 0.00, 0.55, -0.20, 0.08, 0.05], // head cocked hard to one side
  [-0.12, 0.00, 0.30, 0.00, 1.45, 1.45, 0.00], // leaning back, both arms raised
  [0.05, -0.10, 0.10, -0.48, 0.00, 1.20, 0.00], // one arm up, head tilted away
  [0.45, 0.00, -0.55, 0.00, -0.30, -0.30, 0.10], // bent at the waist, staring up
  [0.00, 0.00, 0.00, 0.95, 0.00, 0.00, 0.00],  // head almost horizontal
];

export function randomPose(figure) {
  const rig = figure.userData.rig;
  if (!rig) return;
  const p = POSES[Math.floor(Math.random() * POSES.length)];
  rig.torso.rotation.x = p[0];
  rig.torso.rotation.z = p[1];
  rig.head.rotation.x = p[2];
  rig.head.rotation.z = p[3];
  rig.arms[0].rotation.x = -p[4];
  rig.arms[1].rotation.x = -p[5];
  rig.legs[0].rotation.x = p[6];
  rig.legs[1].rotation.x = -p[6];
  figure.userData.nextTwitch = 0.8 + Math.random() * 2.7;
}

export function clearPose(figure) {
  const rig = figure.userData.rig;
  if (!rig) return;
  rig.torso.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
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
    if (d.twitchLeft <= 0) rig.head.rotation.z = d.twitchBase ?? 0;
    return;
  }
  if (d.nextTwitch <= 0) {
    d.nextTwitch = 0.8 + Math.random() * 2.7;
    d.twitchLeft = 0.06 + Math.random() * 0.12;
    d.twitchBase = rig.head.rotation.z;
    rig.head.rotation.z += (Math.random() - 0.5) * 1.2;
  }
}
