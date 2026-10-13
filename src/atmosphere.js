import * as THREE from 'three';
import { LIGHT_GAIN } from './level.js';

// The air.
//
// A building like this is never empty air. Dust hangs in it, and you only see
// it where light goes through it: a haze under every tube, and a beam of
// glittering motes wherever the torch points. Both are what make a dark room
// read as a place with depth rather than as black paint, and both cost almost
// nothing: the dust is one draw call simulated entirely on the GPU, and the
// shafts are a handful of soft cones on the nearest lights.
//
// Fog lives here too. Each room has its own density -- the bays are thick with
// it, the tunnel thicker -- and fear pulls it in a little closer.

const MAX_LIGHTS = 6;

// How thick the air is in each room. The hall's value is the one the station
// was originally tuned against.
const FOG_DENSITY = {
  default: 0.038,
  hall: 0.036,
  bays: 0.058,
  bay0: 0.062,
  gate: 0.045,
  tunnel: 0.085,
  baggage: 0.044,
  restroom: 0.04,
};

const dustVert = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform float uSize;
uniform float uFogDensity;
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform float uLightPow[${MAX_LIGHTS}];
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform float uFlash;
attribute vec3 seed;
varying float vBright;

void main() {
  // Slow Brownian drift plus a very gentle settle, wrapped into a box that
  // travels with the camera so the player is always standing in it.
  vec3 drift = vec3(
    sin(uTime * 0.07 + seed.x * 6.283) * 0.7 + sin(uTime * 0.31 + seed.z * 9.1) * 0.05,
    -uTime * (0.012 + seed.y * 0.02) + sin(uTime * 0.13 + seed.z * 6.283) * 0.25,
    cos(uTime * 0.05 + seed.y * 6.283) * 0.7 + cos(uTime * 0.27 + seed.x * 7.3) * 0.05
  );
  vec3 w = mod(position + drift - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  w.y = clamp(w.y, 0.05, 6.0);

  // Lit only by what is actually shining on it.
  float b = 0.0;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 d = uLightPos[i] - w;
    b += uLightPow[i] / (1.0 + dot(d, d) * 0.45);
  }
  vec3 fd = w - uFlashPos;
  float fl = max(0.001, length(fd));
  float cone = smoothstep(0.935, 0.99, dot(fd / fl, uFlashDir));
  b += uFlash * cone * 4.0 / (1.0 + fl * fl * 0.1);

  vec4 mv = modelViewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(0.05, -mv.z);
  gl_PointSize = uSize * (0.55 + seed.x * 0.9) / dist;
  float fog = exp(-uFogDensity * uFogDensity * dist * dist);
  // Motes right against the lens would be blurry blobs; let them go.
  float near = smoothstep(0.35, 1.2, dist);
  vBright = b * fog * near;
}
`;

const dustFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vBright;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c));
  gl_FragColor = vec4(uColor * min(vBright, 3.0), a * uOpacity);
}
`;

const shaftVert = /* glsl */ `
varying vec2 vUv;
varying float vEdge;
varying float vFog;
uniform float uFogDensity;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  // Brightest where we look through the most air: the middle of the cone,
  // fading to nothing at its silhouette so there is never a hard edge.
  vEdge = abs(dot(n, normalize(-mv.xyz)));
  float dist = -mv.z;
  vFog = exp(-uFogDensity * uFogDensity * dist * dist);
  gl_Position = projectionMatrix * mv;
}
`;

const shaftFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
varying float vEdge;
varying float vFog;
void main() {
  // uv.y runs 0 at the floor to 1 at the fixture.
  float fall = pow(vUv.y, 1.7);
  float edge = pow(vEdge, 2.2);
  gl_FragColor = vec4(uColor * uStrength * fall * edge * vFog, 1.0);
}
`;

const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
varying float vEdge;
varying float vFog;
void main() {
  // The torch beam: brightest at the lens, gone by eight metres.
  float fall = pow(vUv.y, 2.6);
  float edge = pow(vEdge, 3.0);
  gl_FragColor = vec4(uColor * uStrength * fall * edge, 1.0);
}
`;

export class Atmosphere {
  constructor(game, tier) {
    this.game = game;
    this.scene = game.scene;
    this.density = FOG_DENSITY.default;

    this.buildDust();
    this.buildShafts();
    this.buildBeam();
    this.applyTier(tier);
  }

  buildDust() {
    this.dustUniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(16, 7, 16) },
      uSize: { value: 26 },
      uFogDensity: { value: FOG_DENSITY.default },
      uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(0, -100, 0)) },
      uLightPow: { value: new Array(MAX_LIGHTS).fill(0) },
      uFlashPos: { value: new THREE.Vector3() },
      uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
      uFlash: { value: 0 },
      uColor: { value: new THREE.Color(0xc8d8cc) },
      uOpacity: { value: 0.22 },
    };
    this.dustMaterial = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = null;
  }

  setDustCount(count) {
    if (this.dust && this.dust.geometry.attributes.position.count === count) return;
    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
      this.dust = null;
    }
    if (count <= 0) return;
    const box = this.dustUniforms.uBox.value;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box.x;
      pos[i * 3 + 1] = Math.random() * box.y;
      pos[i * 3 + 2] = Math.random() * box.z;
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    this.dust = new THREE.Points(geo, this.dustMaterial);
    // Positions are made up in the shader, so the CPU-side bounds mean nothing.
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.scene.add(this.dust);
  }

  buildShafts() {
    this.shafts = [];
    const group = new THREE.Group();
    for (const entry of this.game.level.lights) {
      const h = Math.max(1.5, entry.light.position.y - 0.05);
      // A soft cone from the tube to the floor, open at both ends.
      const geo = new THREE.CylinderGeometry(0.55, 1.9, h, 18, 1, true);
      geo.translate(0, -h / 2, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0xd8f4e4) },
          uStrength: { value: 0 },
          uFogDensity: { value: FOG_DENSITY.default },
        },
        vertexShader: shaftVert,
        fragmentShader: shaftFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(entry.light.position.x, entry.light.position.y - 0.02, entry.light.position.z);
      mesh.visible = false;
      mesh.renderOrder = 4;
      group.add(mesh);
      this.shafts.push({ entry, mesh, mat });
    }
    this.shaftGroup = group;
    this.scene.add(group);
  }

  buildBeam() {
    // The torch's own haze, hung off the camera along the beam.
    const len = 8;
    const geo = new THREE.CylinderGeometry(0.03, 1.15, len, 36, 1, true);
    // Point it down -Z from just under the lens.
    geo.translate(0, -len / 2, 0);
    geo.rotateX(Math.PI / 2);
    // uv.y should be 1 at the lens; the cylinder's top cap ring is uv.y = 1
    // and after the rotation the top sits at the lens, so nothing to flip.
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xfff0d0) },
        uStrength: { value: 0 },
        uFogDensity: { value: 0 },
      },
      vertexShader: shaftVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.position.set(0.12, -0.12, 0);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 6;
    this.beam.visible = false;
    this.game.camera.add(this.beam);
  }

  applyTier(tier) {
    this.tier = tier;
    this.setDustCount(tier.dust);
    this.shaftGroup.visible = tier.shafts;
  }

  // Per-room fog, eased so walking through a door is a change in the air and
  // not a cut.
  updateFog(room, fear, dt) {
    const target = (FOG_DENSITY[room] ?? FOG_DENSITY.default) * (1 + fear * 0.25);
    this.density += (target - this.density) * Math.min(1, dt * 1.5);
    const fog = this.scene.fog;
    if (fog?.isFogExp2) fog.density = this.density;
  }

  update(dt, t) {
    const game = this.game;
    const cam = game.camera;
    const u = this.dustUniforms;
    u.uTime.value = t;
    u.uCam.value.copy(cam.position);
    u.uFogDensity.value = this.density;
    // Point size is in pixels; keep motes the same apparent size whatever the
    // render resolution.
    u.uSize.value = 26 * game.renderer.getPixelRatio();

    // The nearest burning lights, as the dust sees them.
    let n = 0;
    for (const s of this.shafts) {
      const l = s.entry;
      const on = l.light.visible && !l.broken && l.light.intensity > 0.01;
      const power = on ? l.light.intensity / LIGHT_GAIN : 0;
      if (on && n < MAX_LIGHTS) {
        u.uLightPos.value[n].copy(l.light.position);
        u.uLightPow.value[n] = power * 0.9;
        n++;
      }
      s.mesh.visible = on && this.tier.shafts;
      if (s.mesh.visible) {
        s.mat.uniforms.uStrength.value = power * 0.05;
        s.mat.uniforms.uFogDensity.value = this.density;
      }
    }
    for (let i = n; i < MAX_LIGHTS; i++) u.uLightPow.value[i] = 0;

    const flash = game.player.flashlight;
    const flashPower = Math.max(0, flash.intensity / 26);
    u.uFlash.value = flashPower;
    u.uFlashPos.value.copy(cam.position);
    cam.getWorldDirection(u.uFlashDir.value);

    this.beam.visible = flashPower > 0.02 && !game.player.hiding;
    this.beamMat.uniforms.uStrength.value = flashPower * 0.035;
  }
}
