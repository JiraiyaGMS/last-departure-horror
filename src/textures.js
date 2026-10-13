import * as THREE from 'three';

// Every surface in the station is a photo-scanned material.
//
// This used to be a procedural generator: each surface was a function of
// position baked into albedo, height and roughness at startup. It held the
// lighting together, but a formula for "old vinyl tile" is never going to be
// as convincing as a photograph of one, and baking fourteen of them in
// JavaScript cost a second or two of a phone's startup.
//
// The maps are CC0 scans from Poly Haven and ambientCG (see
// public/textures/CREDITS.md). Each material is three images: colour, an
// OpenGL normal map, and an "ARM" map that packs ambient occlusion, roughness
// and metalness into red, green and blue -- exactly the channels three reads
// those maps from, so one image serves all three slots.
//
// Scale is physical. `size` is how many metres one copy of the texture covers,
// and every mesh that uses one of these materials gets its UVs rewritten in
// metres by applyMetricUVs() below. A floor tile is the same size in every room
// and a wall plank does not stretch because the wall is long.

const BASE = `${import.meta.env.BASE_URL}textures/`;

// `mean` is each scan's average colour in linear RGB, measured from the
// shipped 512px image. tint() divides by it, so call sites can say what colour
// a surface should average out to and get that regardless of the photograph.
const SURFACES = {
  // Worn grey tiles: the waiting hall, offices and the diner.
  floor:     { size: 2.2, mean: [0.132, 0.113, 0.084], big: true },
  // Scuffed, stained concrete for the service areas.
  concfloor: { size: 2.0, mean: [0.089, 0.064, 0.048], big: true },
  // Cracked asphalt under the bus canopy.
  asphalt:   { size: 3.0, mean: [0.107, 0.105, 0.096], big: true },
  // Chipped white subway tile on the restroom walls.
  tilewall:  { size: 1.27, mean: [0.601, 0.571, 0.502], big: true },
  // The restroom floor, which nobody has mopped in a long time.
  tilefloor: { size: 2.0, mean: [0.074, 0.067, 0.055], big: true },
  // Vertical-board panelling, the 1970s refit of the hall.
  panel:     { size: 1.13, mean: [0.146, 0.073, 0.023], big: true },
  // Painted breeze block, for everywhere the public was not meant to linger.
  block:     { size: 2.0, mean: [0.191, 0.184, 0.147], big: true },
  // Raw block outside, under the canopy.
  rawblock:  { size: 2.0, mean: [0.095, 0.081, 0.063], big: true },
  // Mineral-fibre ceiling tiles on a suspended grid.
  ceiling:   { size: 2.4, mean: [0.909, 0.909, 0.909], big: true },
  // Brushed stainless: handrails, counters, fittings.
  steel:     { size: 1.0, mean: [0.295, 0.3, 0.309] },
  // Painted sheet steel, worn through: lockers, cabinets, machines.
  paint:     { size: 2.0, mean: [0.098, 0.082, 0.067] },
  // Dark varnished timber for desks and counters.
  wood:      { size: 2.0, mean: [0.103, 0.043, 0.028] },
  // Seat vinyl; tinted per bench.
  vinyl:     { size: 0.3, mean: [0.272, 0.272, 0.24] },
  // Twill, for the clothes on the figures.
  cloth:     { size: 0.27, mean: [0.161, 0.16, 0.155] },
};

// --- loading ----------------------------------------------------------------

const imageLoader = new THREE.ImageLoader();
const sets = new Map();
let bigTextures = false;
let maxAnisotropy = 4;

const progress = {
  total: 0,
  done: 0,
  failed: 0,
  listeners: [],
};

function notify() {
  for (const fn of progress.listeners) fn(progress.done, progress.total, progress.failed);
}

export function onTextureProgress(fn) {
  progress.listeners.push(fn);
  fn(progress.done, progress.total, progress.failed);
}

export function texturesReady() {
  return progress.total > 0 && progress.done >= progress.total;
}

// A 1x1 stand-in used when an image fails to load, so a missing file degrades
// to a flat surface instead of a black one.
function flatImage(r, g, b) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, 1, 1);
  return c;
}

const FALLBACK = {
  diff: () => flatImage(150, 150, 146),
  nor: () => flatImage(128, 128, 255),
  // Full AO, mid roughness, not metal.
  arm: () => flatImage(255, 190, 0),
};

function urlFor(key, kind) {
  const res = SURFACES[key].big && bigTextures ? '1k' : '512';
  return `${BASE}${res}/${key}_${kind}.jpg`;
}

// Loads `url` into an existing Texture object. Materials keep their reference;
// only the pixels behind it change. A texture whose image changes size has to
// be disposed first, or three would try to write the new image into the old
// allocation.
function loadInto(texture, url, kind) {
  progress.total++;
  notify();
  imageLoader.load(
    url,
    (img) => {
      texture.dispose();
      texture.image = img;
      texture.needsUpdate = true;
      progress.done++;
      notify();
    },
    undefined,
    () => {
      console.warn('textures: could not load', url);
      texture.dispose();
      texture.image = FALLBACK[kind]();
      texture.needsUpdate = true;
      progress.done++;
      progress.failed++;
      notify();
    }
  );
}

function makeTexture(key, kind) {
  const t = new THREE.Texture();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // UVs are in metres, so the repeat is simply "copies per metre".
  const per = 1 / SURFACES[key].size;
  t.repeat.set(per, per);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  // Almost every surface here is seen at a grazing angle down a corridor,
  // which is exactly where isotropic filtering smears into mud.
  t.anisotropy = maxAnisotropy;
  t.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.userData.metric = true;
  t.name = `${key}_${kind}`;
  loadInto(t, urlFor(key, kind), kind);
  return t;
}

function setFor(key) {
  if (!SURFACES[key]) throw new Error(`textures: unknown surface "${key}"`);
  if (!sets.has(key)) {
    sets.set(key, {
      map: makeTexture(key, 'diff'),
      normalMap: makeTexture(key, 'nor'),
      arm: makeTexture(key, 'arm'),
    });
  }
  return sets.get(key);
}

// Must be called before the first surface() call so the initial load fetches
// the right resolution. Changing it later re-fetches the large surfaces into
// the textures already in use.
export function setBigTextures(on) {
  if (on === bigTextures) return;
  bigTextures = on;
  for (const [key, set] of sets) {
    if (!SURFACES[key].big) continue;
    loadInto(set.map, urlFor(key, 'diff'), 'diff');
    loadInto(set.normalMap, urlFor(key, 'nor'), 'nor');
    loadInto(set.arm, urlFor(key, 'arm'), 'arm');
  }
}

export function setAnisotropy(n) {
  maxAnisotropy = n;
  for (const set of sets.values()) {
    for (const t of [set.map, set.normalMap, set.arm]) {
      if (t.anisotropy !== n) {
        t.anisotropy = n;
        t.needsUpdate = true;
      }
    }
  }
}

// Material options ready to spread into MeshStandardMaterial.
//
//   roughness  multiplies the scanned roughness (below 1 = waxed / wet)
//   metalness  multiplies the scanned metalness. There is no environment map
//              in the station, so a fully metallic surface only shows the
//              fixtures' highlights; worn painted steel is kept well under 1
//              so its paint colour still reads.
//   normal     normal map strength
export function surface(key, opts = {}) {
  const set = setFor(key);
  const n = opts.normal ?? 1;
  return {
    map: set.map,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(n, n),
    aoMap: set.arm,
    aoMapIntensity: opts.ao ?? 1,
    roughnessMap: set.arm,
    metalnessMap: set.arm,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
  };
}

// A material colour that makes `key` average out to `hex` (an sRGB colour).
// Components can exceed 1: three multiplies the colour into the texture in
// the shader, so a dark scan can be lifted as easily as a bright one tamed.
export function tint(key, hex) {
  const c = new THREE.Color(hex);
  const [r, g, b] = SURFACES[key].mean;
  return c.setRGB(c.r / r, c.g / g, c.b / b, THREE.LinearSRGBColorSpace);
}

function isMetric(material) {
  return !!(material && (material.map?.userData.metric || material.normalMap?.userData.metric));
}

// --- metric UVs ---------------------------------------------------------------
//
// Box projection: every triangle takes its UVs from the two world axes it
// faces most squarely, in metres. A wall gets (along-the-wall, up), a floor
// gets (x, z). It is how a texture artist would map a building made of boxes,
// and it means texel density is identical on every surface whatever shape the
// geometry started as -- including merged props, which arrive here as one
// anonymous buffer.
//
// Projection happens in world space for anything already placed in the level,
// so patterns run continuously across wall segments and through doorways.
// Figures pass `local` so their clothes stay put on the body as it moves.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

function projectGeometry(geometry, matrix) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vertexIndex = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);

  // Pass 1: which axis each triangle projects along. Shared vertices that
  // disagree (the rim of a cylinder, a bevel) force the geometry apart.
  const triAxis = new Uint8Array(triCount);
  const vertAxis = new Int8Array(pos.count).fill(-1);
  let conflict = false;
  const world = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _a.fromBufferAttribute(pos, i);
    if (matrix) _a.applyMatrix4(matrix);
    world[i * 3] = _a.x;
    world[i * 3 + 1] = _a.y;
    world[i * 3 + 2] = _a.z;
  }
  for (let t = 0; t < triCount; t++) {
    const i0 = vertexIndex(t, 0), i1 = vertexIndex(t, 1), i2 = vertexIndex(t, 2);
    _a.fromArray(world, i0 * 3);
    _b.fromArray(world, i1 * 3);
    _c.fromArray(world, i2 * 3);
    _n.subVectors(_c, _b).cross(_b.sub(_a));
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    triAxis[t] = axis;
    for (const v of [i0, i1, i2]) {
      if (vertAxis[v] === -1) vertAxis[v] = axis;
      else if (vertAxis[v] !== axis) conflict = true;
    }
  }

  let geo = geometry;
  if (conflict && index) {
    geo = geometry.toNonIndexed();
    return { geometry: projectGeometry(geo, matrix).geometry, replaced: true };
  }

  const uv = new Float32Array(pos.count * 2);
  for (let t = 0; t < triCount; t++) {
    const axis = triAxis[t];
    for (let k = 0; k < 3; k++) {
      const v = vertexIndex(t, k);
      const x = world[v * 3], y = world[v * 3 + 1], z = world[v * 3 + 2];
      let u, w;
      if (axis === 0) { u = z; w = y; }
      else if (axis === 1) { u = x; w = z; }
      else { u = x; w = y; }
      uv[v * 2] = u;
      uv[v * 2 + 1] = w;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return { geometry: geo, replaced: geo !== geometry };
}

// Projects UVs for a single geometry in its own coordinate space. Used for
// skinned figures, whose clothes are mapped once in the bind pose and then
// carried by the skeleton. May return a new (non-indexed) geometry.
export function projectLocalUVs(geometry) {
  return projectGeometry(geometry, null).geometry;
}

// Rewrites UVs for every mesh under `root` whose material is one of these
// photo surfaces. Anything else -- painted canvas panels, the board, the
// screens -- keeps the UVs it was built with.
export function applyMetricUVs(root, { local = false } = {}) {
  root.updateMatrixWorld(true);
  const done = new Map();
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keepUVs) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(isMetric)) return;
    // A mixed multi-material mesh would lose the UVs its other materials need.
    if (Array.isArray(o.material) && !mats.every((mt) => isMetric(mt) || !mt.map)) return;

    const geo = o.geometry;
    if (done.has(geo)) {
      o.geometry = done.get(geo);
      return;
    }
    // In local mode, project relative to the root so a figure's clothes are
    // laid out on the body and travel with it.
    m.copy(o.matrixWorld);
    if (local) m.premultiply(rootInverse);
    const result = projectGeometry(geo, m);
    done.set(geo, result.geometry);
    if (result.replaced) {
      o.geometry = result.geometry;
      geo.dispose();
    }
  });
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
