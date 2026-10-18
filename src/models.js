import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { trackLoad } from './textures.js';

// The things in the station that are neither people nor built out of boxes:
// photo-scanned props from Poly Haven (all CC0), in one file built by
// tools/props/build.mjs. Each top-level node in the file is one prop, named
// for it, standing on its own origin.
//
// Placing one is synchronous: the caller has already put an empty group where
// it goes, with its collider, and the model fills that group once the file has
// arrived. BEGIN waits for the file with everything else, so in practice it
// is always there. If it never arrives, the caller's fallback builds the old
// procedural version into the same group instead.
const PROPS_URL = `${import.meta.env.BASE_URL}models/props.glb`;

export class Models {
  constructor() {
    this.sources = new Map();
    this.ready = false;
    this.failed = false;
    this.waiting = [];
    this.envMap = null;
    // Called after a prop lands in the world: the cached shadow maps have
    // something new in them.
    this.onAdded = null;
    this.promise = null;
  }

  load() {
    if (this.promise) return this.promise;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.promise = new Promise((resolve) => {
      loader.load(
        PROPS_URL,
        (gltf) => {
          for (const root of gltf.scene.children) {
            this.prepare(root);
            this.sources.set(root.name, root);
          }
          this.ready = true;
          for (const fn of this.waiting.splice(0)) fn(true);
          resolve(true);
        },
        undefined,
        (err) => {
          console.warn('models: could not load the props, keeping the built ones', err);
          this.failed = true;
          for (const fn of this.waiting.splice(0)) fn(false);
          resolve(false);
        }
      );
    });
    trackLoad(this.promise);
    return this.promise;
  }

  prepare(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      // Cutout leaves and labels still throw shadows; real glass would not,
      // but nothing here is glass.
      o.castShadow = true;
      o.receiveShadow = true;
      for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap]) {
        if (t) t.anisotropy = 4;
      }
      if (this.envMap) this.reflect(m);
    });
  }

  reflect(m) {
    m.envMap = this.envMap;
    // Scanned metal is dead without something to reflect; scanned cardboard
    // only wants a little.
    m.envMapIntensity = 0.25 + 0.35 * (m.metalness ?? 0);
    m.needsUpdate = true;
  }

  // The baked station, once main.js has it.
  setEnvironment(env) {
    this.envMap = env;
    for (const root of this.sources.values()) {
      root.traverse((o) => {
        if (o.isMesh) this.reflect(o.material);
      });
    }
  }

  has(name) {
    return this.sources.has(name);
  }

  // Fills `group` with prop `name`.
  //   scale:    a number, or [x, y, z]
  //   tint:     a colour every material of this copy is multiplied by
  //   fallback: (group) => builds something else if the file never comes
  fill(group, name, opts = {}) {
    const go = (ok) => {
      const src = ok && this.sources.get(name);
      if (!src) {
        if (ok) console.warn('models: no prop called', name);
        opts.fallback?.(group);
        this.onAdded?.(group);
        return;
      }
      const obj = src.clone(true);
      if (opts.scale !== undefined) {
        if (Array.isArray(opts.scale)) obj.scale.set(...opts.scale);
        else obj.scale.setScalar(opts.scale);
      }
      if (opts.tint !== undefined) {
        const tint = new THREE.Color(opts.tint);
        obj.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          o.material.color.multiply(tint);
        });
      }
      group.add(obj);
      this.onAdded?.(group);
    };
    if (this.ready) go(true);
    else if (this.failed) go(false);
    else this.waiting.push(go);
    return group;
  }
}
