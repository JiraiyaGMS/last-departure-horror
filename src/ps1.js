import * as THREE from 'three';

// Internal render resolution. Everything is drawn here, then point-upscaled.
export const INTERNAL_W = 320;
export const INTERNAL_H = 240;

const DITHER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

// A 4x4 Bayer matrix as a repeating texture. Avoids dynamically indexing a
// uniform array, which GLSL ES 1.00 does not reliably allow.
function makeDitherTexture() {
  const data = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    const v = Math.round((DITHER_4X4[i] / 16) * 255);
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const compositeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const compositeFrag = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform sampler2D tDither;
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

// The scene is rendered into a linear render target, and a raw ShaderMaterial
// gets no automatic output conversion, so encode to sRGB here.
vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

void main() {
  vec2 uv = vUv;

  // Slight CRT barrel warp.
  vec2 c = uv - 0.5;
  c *= 1.0 + 0.045 * dot(c, c);
  uv = c + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // VHS tracking: whole scanlines jump sideways, plus a slow travelling wave.
  float line = floor(uv.y * uResolution.y);
  float jump = step(0.72, hash(vec2(line, floor(uTime * 24.0))));
  uv.x += uDistort * (jump * (hash(vec2(line, floor(uTime * 24.0) + 7.0)) - 0.5) * 0.08
                      + sin(uv.y * 30.0 + uTime * 12.0) * 0.003);

  // Chromatic aberration, pushed radially so the edges smear hardest.
  float r2 = dot(c, c);
  vec2 off = c * uAberration * (0.25 + r2 * 3.5) * 0.012;
  vec3 col;
  col.r = toSRGB(texture2D(tDiffuse, uv + off).rgb).r;
  col.g = toSRGB(texture2D(tDiffuse, uv).rgb).g;
  col.b = toSRGB(texture2D(tDiffuse, uv - off).rgb).b;

  // Ordered dithering down to a 5-bit-ish palette, the PS1 look.
  float threshold = texture2D(tDither, gl_FragCoord.xy / 4.0).r - 0.5;
  float levels = 24.0;
  col = floor(col * levels + threshold) / levels;

  // Scanline darkening on alternate internal rows.
  float row = floor(uv.y * uResolution.y);
  col *= 1.0 - 0.07 * mod(row, 2.0);

  float v = 1.0 - uVignette * dot(c, c);
  col *= clamp(v, 0.0, 1.0);

  float n = hash(gl_FragCoord.xy + uTime * 60.0);
  col += (n - 0.5) * uGrain;

  // Dread drains the colour out of the place before it does anything else.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), uDesat);

  // Blown-out video static.
  col = mix(col, vec3(n), uStatic * 0.85);

  // Red wash sits under the flash so a hit reads as blood then light.
  col = mix(col, vec3(0.55, 0.03, 0.02), uRed * 0.75);
  col = mix(col, vec3(1.0), uWhiteFlash);
  col *= 1.0 - clamp(uBlackout, 0.0, 1.0);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// Snaps clip-space vertices to the internal pixel grid, which is what gives
// PS1 geometry its characteristic wobble. Injected into every material.
export function applyVertexSnap(material, strength = 1.0) {
  if (!material || material.__ps1Patched) return material;
  material.__ps1Patched = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        float snapW = max(gl_Position.w, 0.0001);
        vec2 grid = vec2(${(INTERNAL_W / 2).toFixed(1)}, ${(INTERNAL_H / 2).toFixed(1)}) / ${strength.toFixed(2)};
        vec2 ndc = gl_Position.xy / snapW;
        ndc = floor(ndc * grid + 0.5) / grid;
        gl_Position.xy = ndc * snapW;
      }`
    );
  };
  material.needsUpdate = true;
  return material;
}

export class PS1Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: compositeVert,
      fragmentShader: compositeFrag,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uResolution: { value: new THREE.Vector2(INTERNAL_W, INTERNAL_H) },
        tDither: { value: makeDitherTexture() },
        uTime: { value: 0 },
        uVignette: { value: 1.15 },
        uGrain: { value: 0.055 },
        uAberration: { value: 0.12 },
        uDistort: { value: 0 },
        uStatic: { value: 0 },
        uRed: { value: 0 },
        uWhiteFlash: { value: 0 },
        uDesat: { value: 0.28 },
        uBlackout: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  render(scene, camera, time) {
    this.material.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  setGrain(v) {
    this.material.uniforms.uGrain.value = v;
  }

  setVignette(v) {
    this.material.uniforms.uVignette.value = v;
  }

  // Drives every uniform off the shared Fear model, so the screen and the
  // soundtrack are always describing the same emotional state.
  apply(fear) {
    const u = this.material.uniforms;
    const f = fear.fear;
    const t = fear.tension;
    u.uAberration.value = 0.12 + f * 0.45 + fear.get('aberration');
    u.uVignette.value = 1.15 + f * 0.9;
    u.uGrain.value = 0.055 + f * 0.05 + t * 0.02;
    u.uDesat.value = 0.28 + t * 0.2;
    u.uDistort.value = fear.get('distort') + f * 0.08;
    u.uStatic.value = fear.get('static');
    u.uRed.value = fear.get('red');
    u.uWhiteFlash.value = fear.get('whiteFlash');
    u.uBlackout.value = fear.get('blackout');
  }
}
