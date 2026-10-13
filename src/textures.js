import * as THREE from 'three';

// Every surface in the station is generated here, as a matched set of albedo,
// roughness and normal maps.
//
// The old versions of these were 64px, nearest-filtered and mipmap-free,
// because the renderer they were written for downsampled everything to 320x240
// anyway. At native resolution that reads as broken rather than as style, and
// more importantly a colour map on its own gives the lighting nothing to work
// with: painted block, glazed tile, varnished veneer and cracked vinyl all
// return light identically and the room flattens into wallpaper.
//
// So each material is defined once, as a function of position, returning all
// three channels at once. Writing them together is the whole point -- the grout
// line that is darker in the albedo is the same grout line that sits lower in
// the height field and scatters more in the roughness, because they are
// computed from the same expression rather than drawn three times and hoped to
// line up.

const RES = 256;

// --- deterministic tileable noise -------------------------------------------

function hash(x, y) {
  // Integer lattice hash. Deterministic across reloads, which matters: a
  // station that re-grains itself every time you die would be unsettling for
  // entirely the wrong reason.
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

// Value noise on a lattice that wraps at `period`, so the texture tiles
// seamlessly no matter how many times it repeats across a wall.
function vnoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const m = (n, p) => ((n % p) + p) % p;
  const x0 = m(xi, period), x1 = m(xi + 1, period);
  const y0 = m(yi, period), y1 = m(yi + 1, period);
  const a = hash(x0, y0), b = hash(x1, y0);
  const c = hash(x0, y1), d = hash(x1, y1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, octaves = 4, period = 8) {
  let sum = 0, amp = 0.5, norm = 0, p = period, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, p);
    norm += amp;
    amp *= 0.5; f *= 2; p *= 2;
  }
  return sum / norm;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// --- surface definitions ----------------------------------------------------
//
// Each takes normalised coordinates in 0..1 and returns:
//   r,g,b   albedo, 0..1
//   h       height, 0..1, where 1 is proud of the surface
//   rough   roughness, 0..1, where 1 scatters completely
//
// `u`,`v` are the tile coordinates; the caller handles repetition.

// Grid of hard lines with a bevel, shared by both tiled surfaces. Returns how
// far into a grout line this pixel is: 0 on the tile face, 1 in the groove.
function groutMask(u, v, tiles, width) {
  const fu = Math.abs(((u * tiles) % 1) - 0.5) * 2;
  const fv = Math.abs(((v * tiles) % 1) - 0.5) * 2;
  const edge = Math.max(fu, fv);
  return smooth(1 - width, 1, edge);
}

const SURFACES = {
  // Vinyl composition tile. The floor of every municipal building ever built:
  // speckled, waxed to a shine in the middle of the room and worn matte in the
  // walking lines.
  floor(u, v) {
    const tiles = 4;
    const g = groutMask(u, v, tiles, 0.06);
    // Which tile are we on -- lets each one differ slightly in tone.
    const ti = Math.floor(u * tiles), tj = Math.floor(v * tiles);
    const tint = hash(ti, tj) * 0.12 - 0.06;
    const speck = fbm(u * 48, v * 48, 3, 32);
    const grime = fbm(u * 5, v * 5, 4, 5);

    let base = 0.17 + tint + speck * 0.14;
    base *= 1 - grime * 0.35;
    const r = base * 0.86, gg = base * 1.0, b = base * 0.93;

    // Wax survives where nobody walks. The grime field doubles as the wear
    // pattern, so the dull patches are the dirty ones.
    const wear = smooth(0.35, 0.75, grime);
    const rough = 0.30 + wear * 0.45 + g * 0.35 + speck * 0.08;
    const h = 1 - g * 0.9 - speck * 0.05;
    return { r, g: gg, b, h, rough: clamp01(rough) };
  },

  // Glazed ceramic, as found in a restroom that has not been refitted since
  // the station opened. Tiles are near-specular; the grout between them has
  // gone porous and holds every stain.
  tile(u, v) {
    const tiles = 8;
    const g = groutMask(u, v, tiles, 0.09);
    const ti = Math.floor(u * tiles), tj = Math.floor(v * tiles);
    const tint = hash(ti * 7, tj * 13) * 0.1;
    const stain = fbm(u * 6, v * 10, 4, 6);

    // Rust bleeding downwards from the fixings, strongest near the top.
    const rust = smooth(0.55, 0.9, fbm(u * 14, v * 3, 3, 14)) * (1 - v) * 0.8;

    let base = 0.30 + tint - stain * 0.12;
    let r = base * 0.80, gg = base, b = base * 0.94;
    r = r * (1 - rust) + 0.26 * rust;
    gg = gg * (1 - rust) + 0.11 * rust;
    b = b * (1 - rust) + 0.05 * rust;

    // Grout is dark and matte, glaze is bright and sharp.
    const dark = g * 0.55;
    r *= 1 - dark; gg *= 1 - dark; b *= 1 - dark;
    const rough = 0.12 + g * 0.78 + stain * 0.2 + rust * 0.4;
    const h = 1 - g;
    return { r, g: gg, b, h, rough: clamp01(rough) };
  },

  // Veneer wall panelling, vertical boards with a routed groove between them.
  wood(u, v) {
    const boards = 4;
    const bu = u * boards;
    const seam = smooth(0.92, 1.0, Math.abs((bu % 1) - 0.5) * 2);
    const bi = Math.floor(bu);
    const shade = hash(bi * 31, 3) * 0.18 - 0.09;

    // Grain runs along the board. Stretching the noise hard in one axis is what
    // makes it read as timber instead of as marble.
    const grain = fbm(u * 60, v * 3.5, 4, 60);
    const figure = Math.sin((v * 7 + grain * 3.2) * Math.PI) * 0.5 + 0.5;

    const base = 0.21 + shade + grain * 0.16 + figure * 0.05;
    const r = base * 1.0, g = base * 0.63, b = base * 0.38;

    // Varnish, worn through at hand height.
    const worn = smooth(0.4, 0.8, fbm(u * 4, v * 4, 3, 4));
    const rough = 0.34 + worn * 0.34 + seam * 0.3 + grain * 0.1;
    const h = 1 - seam * 0.85 - grain * 0.12;
    return { r, g, b, h, rough: clamp01(rough) };
  },

  // Painted breeze block. Chalky, pitted, and the only thing holding the
  // service corridors up.
  concrete(u, v) {
    const pit = fbm(u * 30, v * 30, 4, 30);
    const broad = fbm(u * 4, v * 4, 4, 4);
    const base = 0.26 + broad * 0.16 - pit * 0.1;
    const r = base * 0.94, g = base, b = base * 0.97;
    // Pits catch dirt and scatter hard; the painted face is merely matte.
    const rough = 0.70 + pit * 0.25 + broad * 0.08;
    const h = 0.75 + (1 - pit) * 0.25 - smooth(0.7, 1.0, pit) * 0.5;
    return { r, g, b, h, rough: clamp01(rough) };
  },

  // Mineral-fibre acoustic ceiling tile. Perforated, sagging, water-marked.
  ceiling(u, v) {
    const g = groutMask(u, v, 2, 0.04);
    const holes = fbm(u * 90, v * 90, 2, 64);
    const damp = smooth(0.5, 0.85, fbm(u * 3, v * 3, 4, 3));
    let base = 0.30 - holes * 0.12;
    // Water damage, yellow-brown and spreading from the seams.
    let r = base, gg = base * 0.98, b = base * 0.92;
    r = r * (1 - damp) + 0.22 * damp;
    gg = gg * (1 - damp) + 0.17 * damp;
    b = b * (1 - damp) + 0.08 * damp;
    const rough = 0.88 + holes * 0.1;
    const h = 1 - g * 0.8 - holes * 0.35;
    return { r, g: gg, b, h, rough: clamp01(rough) };
  },

  // Brushed stainless, for lockers, handrails and the baggage carousel.
  steel(u, v) {
    // The brush direction is the entire character of the material.
    const brush = fbm(u * 2, v * 160, 3, 128);
    const dent = fbm(u * 9, v * 9, 3, 9);
    const base = 0.46 + brush * 0.16 + dent * 0.08;
    const r = base * 0.97, g = base, b = base * 1.02;
    const rough = 0.22 + brush * 0.26 + smooth(0.6, 1, dent) * 0.3;
    const h = 0.8 + brush * 0.2 - smooth(0.75, 1, dent) * 0.4;
    return { r, g, b, h, rough: clamp01(rough), metal: 0.85 };
  },
};

// Cracked seat vinyl, parameterised by colour since the benches alternate.
function vinylSurface(rgb) {
  return (u, v) => {
    const pebble = fbm(u * 70, v * 70, 3, 64);
    // Splits in the vinyl: thin, dark, and running along the grain.
    const crackField = fbm(u * 6, v * 14, 4, 6);
    const crack = smooth(0.46, 0.5, crackField) * (1 - smooth(0.5, 0.56, crackField));
    const wear = smooth(0.45, 0.8, fbm(u * 3, v * 3, 3, 3));

    const lit = 0.82 + pebble * 0.3;
    let r = rgb[0] * lit, g = rgb[1] * lit, b = rgb[2] * lit;
    // The split shows the dark foam under the surface.
    r = r * (1 - crack) + 0.03 * crack;
    g = g * (1 - crack) + 0.025 * crack;
    b = b * (1 - crack) + 0.02 * crack;

    const rough = 0.38 + wear * 0.3 + crack * 0.5 + pebble * 0.12;
    const h = 1 - crack * 0.9 - pebble * 0.18;
    return { r, g, b, h, rough: clamp01(rough) };
  };
}

// --- baking -----------------------------------------------------------------

function bake(fn) {
  const albedo = new ImageData(RES, RES);
  const height = new Float32Array(RES * RES);
  const rough = new ImageData(RES, RES);
  let metal = 0;

  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const s = fn((x + 0.5) / RES, (y + 0.5) / RES);
      const i = (y * RES + x) * 4;
      // Albedo is sampled as sRGB, so encode out of the linear values above.
      albedo.data[i] = Math.round(255 * Math.pow(clamp01(s.r), 1 / 2.2));
      albedo.data[i + 1] = Math.round(255 * Math.pow(clamp01(s.g), 1 / 2.2));
      albedo.data[i + 2] = Math.round(255 * Math.pow(clamp01(s.b), 1 / 2.2));
      albedo.data[i + 3] = 255;
      height[y * RES + x] = s.h;
      // Roughness and metalness are linear data, not colour. three reads
      // roughness from green and metalness from blue, so pack both here.
      const rv = Math.round(255 * clamp01(s.rough));
      rough.data[i] = 0;
      rough.data[i + 1] = rv;
      rough.data[i + 2] = Math.round(255 * (s.metal ?? 0));
      rough.data[i + 3] = 255;
      if (s.metal) metal = s.metal;
    }
  }
  return { albedo, height, rough, metal };
}

// Sobel the height field into a tangent-space normal map. Wrapping the sample
// coordinates keeps the derivative continuous across the tile seam, which is
// the difference between a wall and a wall with a grid drawn on it.
function normalsFromHeight(height, strength) {
  const img = new ImageData(RES, RES);
  const at = (x, y) => height[(((y % RES) + RES) % RES) * RES + (((x % RES) + RES) % RES)];
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * RES + x) * 4;
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function toCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = RES; c.height = RES;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

function makeTexture(canvas, colorSpace) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // Trilinear with anisotropy, because these surfaces are now mostly seen at a
  // grazing angle down a long corridor, which is precisely where nearest
  // filtering turns into a shimmering mess.
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAnisotropy;
  t.colorSpace = colorSpace;
  return t;
}

let maxAnisotropy = 4;
export function setAnisotropy(n) {
  maxAnisotropy = n;
}

const baked = new Map();

function surfaceSet(key, fn, strength) {
  if (baked.has(key)) return baked.get(key);
  const { albedo, height, rough, metal } = bake(fn);
  const normal = normalsFromHeight(height, strength);
  const set = {
    map: makeTexture(toCanvas(albedo), THREE.SRGBColorSpace),
    normalMap: makeTexture(toCanvas(normal), THREE.NoColorSpace),
    roughnessMap: makeTexture(toCanvas(rough), THREE.NoColorSpace),
    metal,
  };
  baked.set(key, set);
  return set;
}

// Returns material options ready to spread into MeshStandardMaterial. The maps
// are baked once and cloned per repeat, so a texture used on fifty walls is
// still a single upload to the GPU.
function materialFor(key, fn, repeat, strength = 2.0) {
  const set = surfaceSet(key, fn, strength);
  const [rx, ry] = repeat;
  const clone = (t) => {
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };
  return {
    map: clone(set.map),
    normalMap: clone(set.normalMap),
    roughnessMap: clone(set.roughnessMap),
    // roughnessMap and metalnessMap are multiplied by these scalars, so they
    // have to be 1 or the baked values get scaled away.
    roughness: 1,
    metalness: set.metal ? 1 : 0,
    ...(set.metal ? { metalnessMap: clone(set.roughnessMap) } : {}),
  };
}

// A canvas that game code keeps repainting (departure board, CRT screens).
// These stay nearest-filtered on purpose: they are pixel displays, and the
// hard edges are the point.
export function liveCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const texture = new THREE.CanvasTexture(c);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas: c, ctx: c.getContext('2d'), texture };
}

export const tex = {
  floor: (r) => materialFor('floor', SURFACES.floor, r, 2.4),
  wood: (r) => materialFor('wood', SURFACES.wood, r, 1.6),
  concrete: (r) => materialFor('concrete', SURFACES.concrete, r, 2.6),
  tile: (r) => materialFor('tile', SURFACES.tile, r, 3.0),
  ceiling: (r) => materialFor('ceiling', SURFACES.ceiling, r, 1.8),
  steel: (r) => materialFor('steel', SURFACES.steel, r, 1.2),
  vinyl: (c, r) => {
    const rgb = [
      parseInt(c.slice(1, 3), 16) / 255,
      parseInt(c.slice(3, 5), 16) / 255,
      parseInt(c.slice(5, 7), 16) / 255,
    ];
    return materialFor('vinyl' + c, vinylSurface(rgb), r, 2.0);
  },
};
