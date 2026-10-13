import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

// The presentation layer.
//
// This replaced a 320x240 PS1 pipeline. That version leaned on dithering and
// vertex wobble to make very simple geometry read as a deliberate style; the
// trade was that it could hide nothing good either. Everything here is the
// opposite bet: render at native resolution, light the station physically, and
// let the room itself do the frightening.
//
// What survives from the old pipeline is the contract. Every screen effect is
// still driven exclusively by the shared Fear model via apply(), so the image
// and the soundtrack are always describing the same emotional state. The
// effects themselves are re-authored for a resolution where a hard scanline
// would look like a bug rather than a CRT.

// The nominal design aspect. Geometry authored against a 4:3 framing still
// composes correctly; the camera uses the real window aspect at runtime.
export const DESIGN_ASPECT = 16 / 9;

// Point-light shadow maps are cached. A cube shadow is six renders of the
// scene, and with three lights casting that was eighteen extra passes a frame
// -- four fifths of every draw call the game made -- to redraw shadows of a
// building that does not move. Now a map is drawn when its light is switched
// on, redrawn when something that moves comes within its reach, and otherwise
// refreshed in the background every couple of seconds.
const SHADOW_REFRESH_SECONDS = 2.0;

// Tuned by measuring the rendered frame, not by eye: this is the value at which
// the concourse sits at a median luminance of ~0.11 with roughly a fifth of the
// frame in true black. Dark enough that the flashlight is worth carrying, light
// enough that you can cross the room without it.
const BASE_EXPOSURE = 1.45;

const fearVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fearFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uDistort;
uniform float uStatic;
uniform float uRed;
uniform float uWhiteFlash;
uniform float uDesat;
uniform float uBlackout;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Value noise, used for the grain so it clumps like film rather than
// sparkling like television snow.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;

  // A whisper of barrel distortion. At 320x240 this was a CRT; here it is
  // just enough lens character that the frame does not feel like a diagram.
  float r2 = dot(c, c);
  uv = c * (1.0 + 0.016 * r2) + 0.5;

  // Reality slipping. Whole bands of the image shear sideways -- the one
  // artefact worth keeping from the old pipeline, because it reads as the
  // image failing rather than as a filter.
  if (uDistort > 0.001) {
    float band = floor(uv.y * 48.0);
    float jump = step(0.86, hash(vec2(band, floor(uTime * 18.0))));
    uv.x += uDistort * (jump * (hash(vec2(band, floor(uTime * 18.0) + 7.0)) - 0.5) * 0.05
                        + sin(uv.y * 22.0 + uTime * 9.0) * 0.0015);
  }

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Chromatic aberration, radial so the corners smear hardest and the centre
  // of frame stays readable no matter how frightened the player is.
  vec2 off = c * uAberration * (0.18 + r2 * 2.2) * 0.010;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + off).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - off).b;

  // Dread drains the colour out of the place before it does anything else.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum), uDesat);

  // Film grain: scaled in screen pixels so it does not crawl when the player
  // turns, and stronger in the shadows where real film grain lives.
  float g = vnoise(gl_FragCoord.xy * 0.75 + uTime * 90.0) - 0.5;
  col += g * uGrain * (1.0 - 0.55 * smoothstep(0.0, 0.6, lum));

  // Blown-out video static.
  float n = hash(gl_FragCoord.xy + uTime * 60.0);
  col = mix(col, vec3(n), uStatic * 0.85);

  // Vignette, smooth rather than quadratic so it falls off like a lens.
  float vig = smoothstep(0.95, 0.15, r2 * uVignette);
  col *= mix(1.0, vig, 0.85);

  // Red wash sits under the flash so a hit reads as blood and then as light.
  col = mix(col, vec3(0.42, 0.02, 0.015), uRed * 0.78);
  col = mix(col, vec3(1.0), uWhiteFlash);
  col *= 1.0 - clamp(uBlackout, 0.0, 1.0);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const FearShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.1 },
    uDistort: { value: 0 },
    uStatic: { value: 0 },
    uRed: { value: 0 },
    uWhiteFlash: { value: 0 },
    uDesat: { value: 0.12 },
    uBlackout: { value: 0 },
  },
  vertexShader: fearVert,
  fragmentShader: fearFrag,
};

export class RenderPipeline {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.tier = opts.tier;

    // Physically-based output. ACES is the reason a bare fluorescent tube can
    // sit in frame without clipping to a white rectangle, and the reason the
    // dark end of the station keeps its separation instead of crushing.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opts.exposure ?? BASE_EXPOSURE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setSize(size.x, size.y);
    // Everything after the scene pass works on the composer's buffers, never
    // the canvas, so antialiasing has to live on those buffers to count.
    this.setMSAA(this.tier.msaa);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Ambient occlusion is built on first use, because it is the single most
    // expensive pass here (it renders the whole scene a second time for its
    // normals) and lower tiers never pay for it at all.
    this.ao = null;
    this.aoFailed = false;

    // Bloom, tuned tight. The threshold sits just under the tubes so only the
    // actual light sources bleed, never the walls they are lighting.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.72, 0.92);
    this.composer.addPass(this.bloom);

    // Tonemap and encode to sRGB here, so every effect after this point works
    // in display space and behaves the way it looks.
    this.composer.addPass(new OutputPass());

    this.fearPass = new ShaderPass(FearShader);
    this.fearPass.uniforms.uResolution.value.set(size.x, size.y);
    this.composer.addPass(this.fearPass);

    this.shadowLights = [];
    this.applyTier(this.tier);
  }

  setMSAA(samples) {
    // Multisampled render targets are WebGL2-only; three falls back silently
    // otherwise, but there is no point asking.
    const n = this.renderer.capabilities.isWebGL2 ? samples : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples === n) continue;
      rt.samples = n;
      // A target's sample count is fixed when it is allocated.
      rt.dispose();
    }
  }

  ensureAO() {
    if (this.ao || this.aoFailed) return this.ao;
    try {
      const size = this.renderer.getSize(new THREE.Vector2());
      this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.ao.output = GTAOPass.OUTPUT.Default;
      // In a building made of right angles this is what puts the dirt back
      // in the corners and stops every surface meeting every other one in a
      // clean seam.
      this.ao.updateGtaoMaterial({
        radius: 0.4,
        distanceExponent: 1.4,
        thickness: 1.0,
        scale: 1.0,
        samples: 12,
      });
      // Only solid surfaces occlude. Out of the box GTAO hides points and
      // lines from its normal pass but not transparent meshes, so light
      // shafts, the torch haze, glass and the translucent passengers would
      // all print dark smudges onto whatever is behind them.
      const hideBase = this.ao.overrideVisibility.bind(this.ao);
      this.ao.overrideVisibility = () => {
        hideBase();
        this.ao.scene.traverse((o) => {
          if (o.isMesh && (o.material?.transparent || o.userData.noAO)) o.visible = false;
        });
      };
      this.composer.insertPass(this.ao, 1);
      this.ao.setSize(size.x, size.y);
    } catch {
      // AO is a luxury; a driver that refuses it should not cost the game.
      this.ao = null;
      this.aoFailed = true;
    }
    return this.ao;
  }

  applyTier(tier) {
    this.tier = tier;
    if (tier.ao) {
      const ao = this.ensureAO();
      if (ao) ao.enabled = true;
    } else if (this.ao) {
      this.ao.enabled = false;
    }
    this.bloom.enabled = tier.bloom;
    this.setMSAA(tier.msaa);
    for (const l of this.shadowLights) {
      const shadow = l.light.shadow;
      if (shadow.mapSize.x !== tier.pointShadowSize) {
        shadow.mapSize.set(tier.pointShadowSize, tier.pointShadowSize);
        this.dropShadowMap(l);
      }
    }
  }

  // Point-light shadows are rationed. Every frame the nearest lit fixtures get
  // the budget and everything else is demoted, which keeps the cost flat no
  // matter how many fixtures a room has.
  registerShadowLights(lights) {
    this.shadowLights = lights;
    for (const l of lights) {
      l.light.castShadow = false;
      l.light.shadow.autoUpdate = false;
      l.light.shadow.mapSize.set(this.tier.pointShadowSize, this.tier.pointShadowSize);
      l.light.shadow.camera.near = 0.15;
      l.light.shadow.camera.far = l.light.distance || 16;
      l.light.shadow.bias = -0.004;
      l.light.shadow.normalBias = 0.03;
      l.shadowAge = 0;
    }
  }

  // A demoted light gives its map back. Each point map is a 4x2 atlas of the
  // cube faces -- eight megabytes at 512 -- and before this every fixture the
  // player had ever walked under kept one alive for the rest of the session.
  dropShadowMap(l) {
    const shadow = l.light.shadow;
    if (shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
    // Ask for a redraw so a light that is still casting is never sampled with
    // no map behind it.
    shadow.needsUpdate = true;
  }

  // Anything that moves and is close enough to a casting light to change its
  // shadow. Called after the frame's simulation, before render.
  updateShadowBudget(position, dt = 0, casters = []) {
    if (!this.shadowLights.length) return;
    const budget = this.tier.shadowBudget;
    const ranked = [];
    for (const l of this.shadowLights) {
      if (l.broken || !l.light.visible || l.light.intensity <= 0.01) {
        if (l.light.castShadow) {
          l.light.castShadow = false;
          this.dropShadowMap(l);
        }
        continue;
      }
      // A pinned light (a scare that needs this one fixture's shadow) jumps
      // the queue; it takes a slot rather than adding one.
      // Lights the player cannot see are worth less of the budget than lights
      // they can, for the same reason they are worth less of the light slots.
      const d = l.shadowPinned
        ? -1
        : Math.hypot(l.light.position.x - position.x, l.light.position.z - position.z) * (l.seen === false ? 2.5 : 1);
      ranked.push([d, l]);
    }
    ranked.sort((a, b) => a[0] - b[0]);

    const active = [];
    for (let i = 0; i < ranked.length; i++) {
      const l = ranked[i][1];
      const want = i < budget;
      if (l.light.castShadow !== want) {
        l.light.castShadow = want;
        if (want) {
          l.light.shadow.needsUpdate = true;
          l.shadowAge = 0;
        } else {
          this.dropShadowMap(l);
        }
      }
      if (want) active.push(l);
    }

    // Which casting lights have something moving inside their reach.
    const candidates = [];
    for (const l of active) {
      l.shadowAge += dt;
      const lp = l.light.position;
      const reach = (l.light.distance || 16) + 1;
      let dirty = false;
      for (const c of casters) {
        const dx = c.x - lp.x;
        const dz = c.z - lp.z;
        if (dx * dx + dz * dz < reach * reach) {
          dirty = true;
          break;
        }
      }
      if (dirty || l.shadowAge > SHADOW_REFRESH_SECONDS) candidates.push(l);
    }
    // Stalest first, a fixed number per frame: two on high, one otherwise.
    candidates.sort((a, b) => b.shadowAge - a.shadowAge);
    const perFrame = budget >= 3 ? 2 : 1;
    for (let i = 0; i < Math.min(perFrame, candidates.length); i++) {
      candidates[i].light.shadow.needsUpdate = true;
      candidates[i].shadowAge = 0;
    }
  }

  // Something static changed shape (a door opened, the loop reset): redraw
  // every casting light on the next frame.
  invalidateShadows() {
    for (const l of this.shadowLights) {
      if (l.light.castShadow) l.light.shadow.needsUpdate = true;
    }
  }

  setSize(w, h, pixelRatio) {
    if (pixelRatio !== undefined) this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.fearPass.uniforms.uResolution.value.set(w, h);
    // Bloom and AO run at CSS resolution rather than device resolution. Both
    // are soft by nature, and on a high-density screen that halves or
    // quarters their cost for no visible difference.
    this.bloom?.setSize(w, h);
    this.ao?.setSize(w, h);
  }
  setGrain(v) {
    this.fearPass.uniforms.uGrain.value = v;
  }

  setVignette(v) {
    this.fearPass.uniforms.uVignette.value = v;
  }

  setExposure(v) {
    this.renderer.toneMappingExposure = v;
  }

  render(scene, camera, time) {
    // The caller owns the scene graph, so honour a swap rather than assuming
    // the pair handed in at construction is still current.
    if (scene !== this.scene || camera !== this.camera) {
      this.scene = scene;
      this.camera = camera;
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      if (this.ao) {
        this.ao.scene = scene;
        this.ao.camera = camera;
      }
    }
    this.fearPass.uniforms.uTime.value = time;
    this.composer.render();
  }

  // Drives every uniform off the shared Fear model. Baselines are far lower
  // than the PS1 version's: at full resolution the same numbers reads as a
  // broken television rather than as unease.
  apply(fear) {
    const u = this.fearPass.uniforms;
    const f = fear.fear;
    const t = fear.tension;
    u.uAberration.value = 0.10 + f * 0.38 + fear.get('aberration');
    u.uVignette.value = 1.0 + f * 0.75 + t * 0.25;
    u.uGrain.value = 0.035 + f * 0.045 + t * 0.02;
    u.uDesat.value = 0.12 + t * 0.26;
    u.uDistort.value = fear.get('distort') + f * 0.05;
    u.uStatic.value = fear.get('static');
    u.uRed.value = fear.get('red');
    u.uWhiteFlash.value = fear.get('whiteFlash');
    u.uBlackout.value = fear.get('blackout');
    // Fear pulls the exposure down, so the room itself seems to lose light as
    // the night gets worse.
    this.renderer.toneMappingExposure = BASE_EXPOSURE * (1 - f * 0.18);
  }
}
