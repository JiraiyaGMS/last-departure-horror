import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { trackLoad } from './textures.js';

// The people. Fifteen characters generated with MakeHuman (MPFB, from its CC0
// asset pack -- see tools/cast) and stored in one file, so the skins, hair and
// clothes they share are downloaded once.
//
// Nothing here animates. Every figure in the game is still the rig from
// figures.js, posed by the same code as before -- walking, sitting, turning a
// head too far, freezing when watched -- and this module copies that pose onto
// the real body each frame. The procedural meshes stay as the fallback: if the
// file never arrives, the station is still full of people, just plainer ones.

const CAST_URL = `${import.meta.env.BASE_URL}models/cast.glb`;

// Beyond this many metres from the camera, the lighter body is drawn.
const LOD_DISTANCE = 8;

// Rig bone -> MakeHuman game_engine bone, parents before children. `dir` is
// which way the rig's bone points along its own Y: limbs hang down it, the
// trunk and head rise up it.
const MAP = [
  { v: 'pelvis', m: 'pelvis', to: 'spine_01', dir: 1 },
  { v: 'torso', m: 'spine_01', to: 'spine_02', dir: 1 },
  { v: 'chest', m: 'spine_03', to: 'neck_01', dir: 1 },
  { v: 'head', m: 'head', to: null, dir: 1 },
  { v: 'hipL', m: 'thigh_l', to: 'calf_l', dir: -1 },
  { v: 'kneeL', m: 'calf_l', to: 'foot_l', dir: -1 },
  { v: 'hipR', m: 'thigh_r', to: 'calf_r', dir: -1 },
  { v: 'kneeR', m: 'calf_r', to: 'foot_r', dir: -1 },
  { v: 'shoulderL', m: 'upperarm_l', to: 'lowerarm_l', dir: -1 },
  { v: 'elbowL', m: 'lowerarm_l', to: 'hand_l', dir: -1 },
  { v: 'shoulderR', m: 'upperarm_r', to: 'lowerarm_r', dir: -1 },
  { v: 'elbowR', m: 'lowerarm_r', to: 'hand_r', dir: -1 },
];

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

// Orientation of `obj` relative to `top` (one of its ancestors), from local
// quaternions alone -- no matrix updates, so it can run before the frame does.
function relQuat(obj, top, out, overrides) {
  out.identity();
  const chain = [];
  for (let o = obj; o && o !== top; o = o.parent) chain.push(o);
  for (let i = chain.length - 1; i >= 0; i--) {
    const o = chain[i];
    out.multiply(overrides?.get(o) ?? o.quaternion);
  }
  return out;
}

function partOf(mesh) {
  // <id>_<Type>_<asset> or <id>_lod1_<Type>_<asset>
  const n = mesh.name;
  return {
    lod1: n.includes('_lod1_'),
    type: (n.match(/_(Basemesh|Clothes|Hair|Eyes|Eyebrows|Eyelashes)_/) || [])[1] || 'Mesh',
    asset: n.replace(/^.*_(Basemesh|Clothes|Hair|Eyes|Eyebrows|Eyelashes)_/, ''),
  };
}

export class People {
  constructor() {
    this.sources = new Map();
    this.ready = false;
    this.failed = false;
    this.waiting = [];
    this.dressed = [];
    this.promise = null;
  }

  load() {
    if (this.promise) return this.promise;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.promise = new Promise((resolve) => {
      loader.load(
        CAST_URL,
        (gltf) => {
          for (const root of gltf.scene.children) this.sources.set(root.name, root);
          this.ready = true;
          for (const fn of this.waiting.splice(0)) fn();
          resolve(true);
        },
        undefined,
        (err) => {
          console.warn('people: could not load the cast, keeping the plain figures', err);
          this.failed = true;
          this.waiting.length = 0;
          resolve(false);
        }
      );
    });
    trackLoad(this.promise);
    return this.promise;
  }

  has(id) {
    return this.sources.has(id);
  }

  // Natural standing height of a character, so the rig can be built to it.
  heightOf(id, fallback) {
    const src = this.sources.get(id);
    if (!src) return fallback;
    if (src.userData.height === undefined) {
      const box = new THREE.Box3().setFromObject(src);
      src.userData.height = box.max.y - box.min.y;
    }
    return src.userData.height;
  }

  // Puts character `id` inside `figure` and hands its pose over to the rig.
  // Waits for the file if it is still downloading. `style`:
  //   'person'  -- as generated
  //   'ghost'   -- translucent, cold, unlit by nothing (the passengers)
  //   'shadow'  -- near-black, for things that are only nearly him
  dress(figure, id, style = 'person', opts = {}) {
    if (this.failed) return;
    if (!this.ready) {
      this.waiting.push(() => this.dress(figure, id, style, opts));
      return;
    }
    const src = this.sources.get(id);
    if (!src) {
      console.warn('people: no character', id);
      return;
    }
    const rig = figure.userData.rig;
    const restLocal = figure.userData.restLocal;
    if (!rig || !restLocal) return;

    const model = cloneSkinned(src);
    model.position.set(0, 0, 0);
    // MakeHuman characters face +Z; figures face -Z.
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI;
    holder.add(model);
    holder.updateMatrixWorld(true);

    const bones = new Map();
    const parts = [];
    model.traverse((o) => {
      // Every character's skeleton uses the same bone names, so the loader
      // suffixes all but the first; the original is kept in userData.
      if (o.isBone) bones.set(o.userData.name || o.name, o);
      if (o.isMesh) parts.push(o);
    });

    // ---- the rig's rest pose, in figure space ----
    const rigBones = new Map();
    figure.traverse((o) => { if (o.isBone || o.type === 'Bone') rigBones.set(o.name, o); });
    // The trunk is measured from upright, not from the rig's own rest: the
    // Attendant's stoop is built into his rest pose, and this way it carries
    // over to the body (and his head and arms come forward with it).
    const restRef = new Map(restLocal);
    for (const name of ['pelvis', 'torso', 'chest']) {
      const b = rigBones.get(name);
      if (b) restRef.set(b, new THREE.Quaternion());
    }
    const pairs = [];
    for (const e of MAP) {
      const vb = rigBones.get(e.v);
      const mb = bones.get(e.m);
      if (!vb || !mb) continue;
      pairs.push({ ...e, vb, mb });
    }

    // Bend the model's own rest pose into the rig's. MakeHuman stands in an
    // A-pose; the rig's arms hang. Each limb bone is turned to point where the
    // rig's does, parents first so a child is measured after its parent moved.
    // The trunk keeps its own natural curve.
    for (const p of pairs) {
      p.restV = relQuat(p.vb, figure, new THREE.Quaternion(), restRef);
      const child = p.to && bones.get(p.to);
      if (p.dir > 0 || !child) continue;
      holder.updateMatrixWorld(true);
      const want = _v.set(0, -1, 0).applyQuaternion(p.restV).normalize();
      const have = child.getWorldPosition(new THREE.Vector3()).sub(p.mb.getWorldPosition(_v2)).normalize();
      const align = new THREE.Quaternion().setFromUnitVectors(have, want);
      const worldQ = p.mb.getWorldQuaternion(new THREE.Quaternion());
      const parentQ = p.mb.parent.getWorldQuaternion(new THREE.Quaternion());
      p.mb.quaternion.copy(parentQ.invert().multiply(align.multiply(worldQ)));
    }
    holder.updateMatrixWorld(true);
    for (const p of pairs) {
      p.restM = p.mb.getWorldQuaternion(new THREE.Quaternion());
    }

    // Hip height of both, for seating the model where the rig sits.
    const mPelvis = bones.get('pelvis');
    const mPelvisRest = mPelvis ? mPelvis.position.clone() : null;
    const mHipY = mPelvis ? mPelvis.getWorldPosition(new THREE.Vector3()).y : rig.pelvisY;

    // ---- materials ----
    const ghost = style === 'ghost';
    const shadow = style === 'shadow';
    const lod0 = [];
    const lod1 = [];
    for (const mesh of parts) {
      const part = partOf(mesh);
      const src = mesh.material;
      const m = src.clone();
      m.name = src.name;
      const card = part.type === 'Hair' || part.type === 'Eyebrows' || part.type === 'Eyelashes';
      m.transparent = false;
      m.depthWrite = true;
      m.alphaTest = card ? 0.45 : 0;
      m.alphaToCoverage = card;
      m.side = part.type === 'Clothes' || card ? THREE.DoubleSide : THREE.FrontSide;
      m.metalness = 0;
      m.roughness = part.type === 'Basemesh' ? 0.58 : part.type === 'Eyes' ? 0.15 : card ? 0.7 : 0.88;
      if (opts.tint?.[part.asset]) m.color.multiply(new THREE.Color(opts.tint[part.asset]));
      if (part.type === 'Basemesh' && opts.skin) m.color.multiply(new THREE.Color(opts.skin));
      if (part.type === 'Basemesh' && !ghost && !shadow) {
        // Light goes into skin and comes back out somewhere else; without
        // that, a lip's shadow on a chin is as black as a hole. A faint
        // self-lit copy of the skin's own colour stands in for it.
        m.emissive = m.color.clone().multiplyScalar(0.09);
        m.emissiveMap = m.map;
      }
      if (ghost) {
        // Translucent, but only the nearest surface: a depth-only copy of the
        // mesh draws first, so the body under the coat and the back of the
        // head never show through the front of them.
        m.transparent = true;
        m.depthWrite = false;
        m.alphaToCoverage = false;
        m.opacity = opts.opacity ?? 0.42;
        m.color.multiply(new THREE.Color(0.72, 0.84, 0.9));
        m.emissive = new THREE.Color(opts.emissive ?? 0x14222a);
        m.userData.ghost = true;
        const depth = new THREE.MeshBasicMaterial({
          colorWrite: false,
          map: card ? m.map : null,
          alphaTest: card ? 0.45 : 0,
          side: m.side,
        });
        const pre = new THREE.SkinnedMesh(mesh.geometry, depth);
        pre.bind(mesh.skeleton, mesh.bindMatrix);
        pre.bindMode = mesh.bindMode;
        pre.name = mesh.name + '_depth';
        pre.castShadow = false;
        // Last of the opaque pass: drawn before the walls behind it, it
        // would stop them drawing and leave a hole the shape of a person.
        pre.renderOrder = 1000;
        // A child at no offset sees the same bones and goes wherever (and
        // whenever) the mesh it covers does.
        mesh.add(pre);
      }
      if (shadow) {
        m.color.multiplyScalar(0.06);
        m.emissive = new THREE.Color(opts.emissive ?? 0x000000);
        m.roughness = 0.9;
      }
      mesh.material = m;
      mesh.castShadow = !ghost;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      // Wide enough for any pose; three never has to skin on the CPU.
      const h = this.heightOf(id, 1.8);
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, h * 0.5, 0), h * 0.9);
      for (const c of mesh.children) if (c.isSkinnedMesh) c.boundingSphere = mesh.boundingSphere;
      const heavy = part.type === 'Basemesh' || part.type === 'Clothes';
      if (heavy) (part.lod1 ? lod1 : lod0).push(mesh);
      if (part.lod1) mesh.visible = false;
    }

    // The plain figure steps aside; its rig stays and keeps being animated.
    for (const mesh of figure.userData.meshes ?? []) mesh.visible = false;
    // Whatever layer the figure lives on (the CCTV-only ones), so does this.
    holder.traverse((o) => { o.layers.mask = figure.layers.mask; });
    figure.add(holder);
    figure.userData.materials = parts.map((p) => p.material);

    const dressed = {
      figure, holder, model, pairs, rig, mPelvis, mPelvisRest, mHipY, lod0, lod1, lod: 0,
      bones, id,
    };
    figure.userData.dressed = dressed;
    this.dressed.push(dressed);
    // Extras go on while the body is still at rest, then the pose arrives.
    opts.onDressed?.(dressed);
    this.sync(dressed);
    return dressed;
  }

  // Copies the rig's current pose onto the body. Rotations go across as the
  // change from rest, measured in figure space, so the two skeletons never
  // need the same bone axes or proportions.
  sync(d) {
    const { figure, pairs, rig } = d;
    for (const p of pairs) {
      relQuat(p.vb, figure, _q);
      _q.multiply(_q2.copy(p.restV).invert());
      _q.multiply(p.restM);
      // Into the model bone's parent frame (holder + model chain, current).
      relQuat(p.mb.parent, figure, _q2);
      p.mb.quaternion.copy(_q2.invert().multiply(_q));
    }
    // Hip height: the rig bobs as it walks and sits by lifting its root.
    if (d.mPelvis) {
      const bob = rig.pelvis.position.y - rig.pelvisY;
      relQuat(d.mPelvis.parent, figure, _q2);
      _v.set(0, bob, 0).applyQuaternion(_q2.invert());
      d.mPelvis.position.copy(d.mPelvisRest).add(_v);
    }
    // Sitting: the rig's hip joint is where the seat wants it, and the body's
    // own hip has to be put there too; standing, the feet stay on the floor.
    d.holder.position.y = figure.userData.seated ? rig.pelvisY - d.mHipY : 0;
  }

  // Per frame, after everything has posed its rig and before the render.
  update(camera) {
    const cam = camera.position;
    for (const d of this.dressed) {
      let vis = d.figure.visible;
      for (let p = d.figure.parent; vis && p; p = p.parent) vis = p.visible;
      if (!vis) continue;
      this.sync(d);
      const fp = d.figure.getWorldPosition(_v);
      const want = fp.distanceTo(cam) > LOD_DISTANCE ? 1 : 0;
      if (want !== d.lod) {
        d.lod = want;
        for (const m of d.lod0) m.visible = want === 0;
        for (const m of d.lod1) m.visible = want === 1;
      }
    }
  }
}

// His cap and the points of light in his eye sockets, on the real head. The
// cap is what Tobias remembers about him; the eyes are what everyone else does.
// Runs while the body is still in its rest pose (from dress's onDressed), and
// works in the figure's own space so it does not matter where it is standing.
export function addCapAndEyes(d, { capColor = 0x1b2730, eyeColor = 0xb9d4c8, cap = true } = {}) {
  const head = d.bones.get('head');
  if (!head) return;
  const fig = d.figure;
  fig.updateMatrixWorld(true);
  const eyesMesh = [];
  const hairOrBody = [];
  d.model.traverse((o) => {
    if (!o.isMesh || o.name.includes('_lod1_')) return;
    if (o.name.includes('_Eyes_')) eyesMesh.push(o);
    if (o.name.includes('_Hair_') || o.name.includes('_Basemesh_')) hairOrBody.push(o);
  });
  // Bounds go through the skin: the geometry is stored quantized and only the
  // bind matrices turn it back into metres.
  const posedBox = (mesh) => {
    // Bone matrices are only refreshed at render time; this runs before one.
    mesh.skeleton.update();
    mesh.computeBoundingBox();
    return mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  };
  const toFigure = (p) => fig.worldToLocal(p);
  const inHead = (pf) => head.worldToLocal(fig.localToWorld(pf.clone()));
  const headQ = relQuat(head, fig, new THREE.Quaternion());
  const mask = fig.layers.mask;

  if (eyesMesh.length) {
    const b = posedBox(eyesMesh[0]);
    b.min.copy(toFigure(b.min.clone()));
    b.max.copy(toFigure(b.max.clone()));
    const lo = b.min.clone().min(b.max);
    const hi = b.min.clone().max(b.max);
    b.min.copy(lo);
    b.max.copy(hi);
    const glintMat = new THREE.MeshBasicMaterial({ color: eyeColor });
    for (const side of [-1, 1]) {
      // Each eyeball's centre, then its front surface (figures face -Z); the
      // mesh holds both eyes, so its box is two eyeballs wide.
      const depth = b.max.z - b.min.z;
      const c = new THREE.Vector3(side < 0 ? b.min.x + depth / 2 : b.max.x - depth / 2, (b.min.y + b.max.y) / 2, b.min.z + depth * 0.08);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0026, 8, 6), glintMat);
      glint.position.copy(inHead(c));
      glint.layers.mask = mask;
      head.add(glint);
    }
  }

  if (cap) {
    const top = new THREE.Box3();
    for (const m of hairOrBody) top.union(posedBox(m));
    const crownTop = fig.worldToLocal(new THREE.Vector3(0, top.max.y, 0)).y;
    // A conductor's peaked cap: a stiff band round the head, a crown that
    // flares to a flat top, and a short black peak pulled down over the eyes.
    const capMat = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.62 });
    const peakMat = new THREE.MeshStandardMaterial({ color: 0x07090b, roughness: 0.25, metalness: 0.1 });
    const capGroup = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.042, 24, 1, true), peakMat);
    band.position.y = 0;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.1, 0.05, 24, 1, true), capMat);
    crown.position.set(0, 0.046, 0.008);
    crown.rotation.x = 0.08;
    const lid = new THREE.Mesh(new THREE.CircleGeometry(0.122, 24), capMat);
    lid.rotation.x = -Math.PI / 2;
    lid.position.set(0, 0.07, 0.01);
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.008, 24, 1, false, Math.PI / 2, Math.PI), peakMat);
    peak.scale.set(1, 1, 0.62);
    peak.position.set(0, -0.019, -0.012);
    peak.rotation.x = -0.32;
    capGroup.add(band, crown, lid, peak);
    for (const m of [band, crown, lid, peak]) {
      m.material.side = THREE.DoubleSide;
      m.castShadow = true;
      m.layers.mask = mask;
    }
    // Centred over the skull: the head bone's own position, at crown height.
    const headPos = fig.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
    const at = new THREE.Vector3(headPos.x, crownTop - 0.055, headPos.z + 0.01);
    capGroup.position.copy(inHead(at));
    capGroup.quaternion.copy(headQ).invert();
    capGroup.layers.mask = mask;
    head.add(capGroup);
    d.cap = capGroup;
  }
}
