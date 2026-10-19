import * as THREE from 'three';
import { makeBusInterior, makeBench, Build, busDims } from './props.js';
import { makeFigure } from './figures.js';
import { LIGHT_GAIN } from './level.js';

// What the cutscenes are staged on, beyond the station itself: the inside of
// the coach, a fog road for it to drive down, a few figures who only exist in
// an ending, and three spare lamps to light all of it.
//
// None of it is drawn during play. The cabin waits hidden inside whichever
// bus is being boarded; the road is far enough south of the station that the
// fog keeps the two from ever seeing each other.

// Where the road is, and how much of it is kept around the bus. Everything
// along it slides back past the coach and goes round again, so the bus never
// moves and the road never ends.
export const ROAD = new THREE.Vector3(0, 0, 560);
const SPAN = 168;
const HALF = SPAN / 2;

// The bus drives in the right-hand lane, centred on the road's x = 0. Its
// left (+x) looks across the road; its right (-x), the door side, looks onto
// the verge, the lamps and the stops.
const LANE = 3.6;
const ROAD_X1 = -LANE / 2 - 0.5;
const ROAD_X2 = LANE * 1.5 + 0.5;
const VERGE_X = -4.4;

const SODIUM = 0xffa24a;
// Where a street lamp's light is taken to come from, for lighting the cabin
// as it goes by: under the head and toward the bus, at about window height.
const LAMP_LIGHT = new THREE.Vector3(2.0, 4.2, 0);
// The station's tubes, for the terminals along the road.
const TUBE = 0xbfe6cf;

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

// Deterministic noise for painting, so the textures are the same every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Coach moquette: a navy ground with the rust, mustard and teal bands every
// intercity seat of the decade was covered in.
function moquette() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1a2032';
    ctx.fillRect(0, 0, w, h);
    const bands = [['#7c2f24', 0], ['#b8863a', 22], ['#2e6464', 40]];
    ctx.lineWidth = 9;
    for (let k = -2; k < 6; k++) {
      for (const [col, off] of bands) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(k * 64 + off, 0);
        ctx.lineTo(k * 64 + off + h * 0.6, h);
        ctx.stroke();
      }
    }
    // Little diamonds in the gaps.
    ctx.fillStyle = '#c9a25a';
    for (let y = 16; y < h; y += 32) {
      for (let x = 8 + ((y / 32) % 2) * 16; x < w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 4);
        ctx.lineTo(x - 4, y);
        ctx.fill();
      }
    }
    // Pile: a fine speckle over everything, and wear.
    const r = rng(7);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.12})`;
      ctx.fillRect(r() * w, r() * h, 1, 1);
    }
  }, [1.6, 1.6]);
}

// Asphalt with the lines painted on it: an edge line each side and the
// centre line dashed. 8.2 m across, 24 m along.
function roadTexture() {
  return canvasTexture(256, 768, (ctx, w, h) => {
    ctx.fillStyle = '#2c2c2a';
    ctx.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 26000; i++) {
      const v = 20 + r() * 40;
      ctx.fillStyle = `rgba(${v},${v},${v - 4},${0.35 + r() * 0.4})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // Patched cracks.
    ctx.strokeStyle = 'rgba(12,12,12,0.6)';
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath();
      let x = r() * w;
      let y = r() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 40;
        y += r() * 50;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const px = (x) => ((x - ROAD_X1) / (ROAD_X2 - ROAD_X1)) * w;
    ctx.fillStyle = 'rgba(214,210,196,0.8)';
    ctx.fillRect(px(ROAD_X1 + 0.35), 0, 4, h);
    ctx.fillRect(px(ROAD_X2 - 0.35) - 4, 0, 4, h);
    ctx.fillStyle = 'rgba(206,164,58,0.85)';
    // 3 m dashes every 9 m: two to the tile.
    for (let k = 0; k < 2; k++) ctx.fillRect(px(LANE / 2) - 3, k * (h / 2), 6, h / 8);
  }, [1, SPAN / 24]);
}

// Lays a figure on its back, head toward `yaw` (0 = +z), the way someone
// sleeps along a bench: knees a little up, hands folded on the chest. Its
// root is its feet, so the caller puts that at the foot of the bench.
export function lieDown(figure, yaw) {
  figure.rotation.set(Math.PI / 2, yaw, 0, 'YXZ');
  const rig = figure.userData.rig;
  if (!rig) return;
  rig.legs[0].rotation.x = 0.22;
  rig.legs[1].rotation.x = 0.12;
  rig.shins[0].rotation.x = -0.35;
  rig.shins[1].rotation.x = -0.18;
  rig.arms[0].rotation.set(0.55, 0, -0.25);
  rig.arms[1].rotation.set(0.6, 0, 0.25);
  rig.forearms[0].rotation.x = 1.5;
  rig.forearms[1].rotation.x = 1.45;
  rig.head.rotation.set(0.15, 0.35, 0);
  figure.userData.poseDirty = true;
}

function radial(inner, outer = 'rgba(255,255,255,0)') {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.35)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export class Sets {
  constructor(game) {
    this.game = game;
    this.level = game.level;
    this.scene = game.scene;
    const mat = (o) => this.level.mat(o);
    const shiny = (m, amount = 1) => {
      m.userData.env = amount;
      return m;
    };

    // ---- the cabin ----
    this.stripMat = mat({ color: 0x15140f, emissive: 0xe6f4e8, emissiveIntensity: 0.7, roughness: 0.5 });
    this.lampMat = mat({ color: 0x2a261c, emissive: 0x6a5a38, emissiveIntensity: 0.2, roughness: 0.4 });
    this.gaugeMat = mat({ color: 0x0c120e, emissive: 0x7fbf90, emissiveIntensity: 0.5, roughness: 0.3 });
    const cabin = {
      floor: mat({ color: 0x232524, roughness: 0.92 }),
      runner: mat({ color: 0x121313, roughness: 0.85 }),
      step: shiny(mat({ color: 0x8c9092, roughness: 0.42, metalness: 0.75 }), 0.8),
      yellow: mat({ color: 0xc9a12f, roughness: 0.7 }),
      wall: mat({ color: 0x8f866e, roughness: 0.62 }),
      trim: mat({ color: 0x2a2c2e, roughness: 0.55 }),
      ceiling: mat({ color: 0x9a9584, roughness: 0.85 }),
      strip: this.stripMat,
      lamp: this.lampMat,
      gauge: this.gaugeMat,
      // Nearly clear: at night the dark outside is the point.
      glass: shiny(mat({ color: 0x86a09e, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false }), 0.12),
      curtain: mat({ color: 0x5c2a22, roughness: 1 }),
      cloth: mat({ color: 0xa8a294, roughness: 1 }),
      seat: mat({ map: moquette(), color: 0xffffff, roughness: 0.95 }),
      frame: mat({ color: 0x2c3134, roughness: 0.5, metalness: 0.4 }),
      chrome: shiny(mat({ color: 0xc0c4c6, roughness: 0.25, metalness: 1 }), 1.2),
      dash: mat({ color: 0x18191b, roughness: 0.6 }),
      dark: mat({ color: 0x0d0e0f, roughness: 0.7 }),
    };
    this.dims = busDims();
    this.cabin = makeBusInterior(cabin, this.dims);
    this.cabin.traverse((o) => {
      if (!o.isMesh) return;
      const clear = o.material.transparent || o.material === this.stripMat;
      o.castShadow = !clear;
      o.receiveShadow = !clear;
    });
    // The rig is what moves: put where a bus is, or out on the road.
    this.rig = new THREE.Group();
    this.rig.add(this.cabin);
    this.rig.visible = false;
    this.scene.add(this.rig);

    // ---- the lamps ----
    // Three point lights of the cutscenes' own: the cabin's two, and one that
    // goes wherever it is needed (a passing street lamp, a platform). They
    // are off in play. When one comes on, the station gives up one of its own
    // light slots for it, so every shader keeps the same number of lights.
    this.lights = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(0xffffff, 0, 9, 1.6);
      l.visible = false;
      l.castShadow = false;
      this.scene.add(l);
      return l;
    });

    this.buildRoad(mat);
    this.buildProps(mat);
  }

  // How many of the cutscene lamps are on, for the station to make room.
  get reserved() {
    let n = 0;
    for (const l of this.lights) if (l.visible) n++;
    return n;
  }

  // Lamp `i` at a world position. `power` is on the station's 0..1 scale.
  lamp(i, pos, color, power, distance = 9) {
    const l = this.lights[i];
    l.visible = power > 0;
    l.position.copy(pos);
    l.color.set(color);
    l.intensity = power * LIGHT_GAIN;
    l.distance = distance;
  }

  lampsOff() {
    for (const l of this.lights) {
      l.visible = false;
      l.intensity = 0;
    }
  }

  // ---- the cabin --------------------------------------------------------

  // Puts the cabin inside `bus` (one of the station's coaches), or out on the
  // road when `bus` is null.
  cabinIn(bus) {
    if (bus) {
      bus.updateMatrixWorld(true);
      bus.matrixWorld.decompose(this.rig.position, this.rig.quaternion, this.rig.scale);
    } else {
      this.rig.position.copy(ROAD);
      this.rig.quaternion.identity();
      this.rig.scale.set(1, 1, 1);
    }
    this.rig.visible = true;
    this.rig.updateMatrixWorld(true);
  }

  hideCabin() {
    this.rig.visible = false;
  }

  // A point in the cabin's own space, in the world.
  inCabin(x, y, z, out = new THREE.Vector3()) {
    this.rig.updateMatrixWorld(true);
    return out.set(x, y, z).applyMatrix4(this.rig.matrixWorld);
  }

  // The cabin lights at `power` (0..1): the strip and both lamps.
  cabinLights(power, color = 0xe2f0e4) {
    this.stripMat.emissiveIntensity = 0.04 + power * 0.7;
    this.lampMat.emissiveIntensity = 0.2 * power;
    this.gaugeMat.emissiveIntensity = 0.15 + power * 0.4;
    const [a, b] = this.cabin.userData.lights;
    this.lamp(0, this.inCabin(a.x, a.y, a.z), color, power * 0.2, 7.5);
    this.lamp(1, this.inCabin(b.x, b.y, b.z), color, power * 0.2, 7.5);
  }

  seat(n) {
    return this.cabin.userData.seats.find((s) => s.n === n);
  }

  // ---- the road ---------------------------------------------------------

  buildRoad(mat) {
    const road = new THREE.Group();
    road.position.copy(ROAD);
    road.visible = false;
    this.scene.add(road);
    this.road = road;
    this.speed = 0;
    this.scroll = 0;
    this.movers = [];

    // A dome the colour of the fog, so where the geometry ends the fog
    // simply carries on.
    this.skyMat = new THREE.MeshBasicMaterial({ color: 0x070b0b, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), this.skyMat);
    sky.renderOrder = -10;
    road.add(sky);

    this.roadTex = roadTexture();
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_X2 - ROAD_X1, SPAN),
      mat({ map: this.roadTex, color: 0xffffff, roughness: 0.88 })
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.set((ROAD_X1 + ROAD_X2) / 2, 0.01, 0);
    road.add(asphalt);

    this.groundTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#141810';
      ctx.fillRect(0, 0, w, h);
      const r = rng(5);
      for (let i = 0; i < 3000; i++) {
        const g = 14 + r() * 26;
        ctx.fillStyle = `rgba(${g},${g + 6},${g - 4},0.8)`;
        ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
      }
    }, [40, SPAN / 4]);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, SPAN), mat({ map: this.groundTex, color: 0xffffff, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    road.add(ground);

    const pole = mat({ color: 0x3a3c3a, roughness: 0.7, metalness: 0.3 });
    const dark = mat({ color: 0x0e100e, roughness: 0.9 });
    const lens = new THREE.MeshBasicMaterial({ color: SODIUM });
    const glowTex = radial('rgba(255,190,120,1)');
    const poolTex = radial('rgba(255,170,90,1)');
    this.glowMats = [];
    this.lampsOn = 1;

    // Street lamps down the verge, every 28 m.
    this.lampPosts = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const b = new Build();
      b.cyl(0.07, 0.1, 7.6, 10, { y: 3.8 }, 'pole');
      b.box(1.5, 0.08, 0.08, { x: 0.7, y: 7.5 }, 'pole');
      b.box(0.62, 0.16, 0.3, { x: 1.4, y: 7.42 }, 'pole');
      g.add(b.build({ pole }));
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.22), lens);
      l.position.set(1.4, 7.33, 0);
      g.add(l);
      const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: SODIUM, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
      this.glowMats.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(3.2, 3.2, 1);
      glow.position.set(1.4, 7.2, 0);
      g.add(glow);
      const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: SODIUM, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32 });
      this.glowMats.push(poolMat);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(1.4, 0.03, 0);
      g.add(pool);
      g.position.set(VERGE_X, 0, -HALF + i * 28);
      g.userData.lens = l;
      road.add(g);
      this.lampPosts.push(g);
      this.movers.push(g);
    }

    // Pines both sides, never quite in rows.
    const pine = mat({ color: 0x0a120d, roughness: 1 });
    const bark = mat({ color: 0x15100c, roughness: 1 });
    const r = rng(23);
    for (let i = 0; i < 30; i++) {
      const b = new Build();
      const hgt = 7 + r() * 7;
      b.cyl(0.14, 0.2, hgt * 0.3, 6, { y: hgt * 0.15 }, 'bark');
      for (let k = 0; k < 3; k++) {
        const y0 = hgt * (0.22 + k * 0.24);
        const rad = (1.9 - k * 0.5) * (0.8 + r() * 0.4);
        b.geo(new THREE.ConeGeometry(rad, hgt * 0.42, 9), { y: y0 + hgt * 0.21 }, 'pine');
      }
      const t = b.build({ pine, bark });
      const side = i % 2 ? 1 : -1;
      t.position.set(side > 0 ? 9 + r() * 16 : -6.5 - r() * 14, 0, -HALF + r() * SPAN);
      t.rotation.y = r() * 6;
      road.add(t);
      this.movers.push(t);
    }

    // Guard rail on the verge: posts that pass, and a rail that is the same
    // everywhere so it can stay where it is.
    const steel = mat({ color: 0x6a6e6c, roughness: 0.5, metalness: 0.6 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, SPAN), steel);
    rail.position.set(ROAD_X1 - 0.6, 0.62, 0);
    road.add(rail);
    const postGeo = new THREE.BoxGeometry(0.1, 0.75, 0.1);
    for (let i = 0; i < 42; i++) {
      const p = new THREE.Mesh(postGeo, dark);
      p.position.set(ROAD_X1 - 0.65, 0.37, -HALF + i * 4);
      road.add(p);
      this.movers.push(p);
    }

    // Telegraph poles across the road, the wires strung between them.
    for (let i = 0; i < 4; i++) {
      const b = new Build();
      b.cyl(0.11, 0.14, 9, 8, { y: 4.5 }, 'wood');
      b.box(1.8, 0.1, 0.1, { y: 8.4 }, 'wood');
      const p = b.build({ wood: bark });
      p.position.set(ROAD_X2 + 3.5, 0, -HALF + i * 42);
      road.add(p);
      this.movers.push(p);
    }
    for (const wx of [-0.75, 0, 0.75]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, SPAN), dark);
      w.position.set(ROAD_X2 + 3.5 + wx, 8.46, 0);
      road.add(w);
    }

    this.buildStop(mat);
    this.buildTerminals(mat);
  }

  // A request stop on the verge: a pole and its sign, a timber shelter with a
  // bench in it, and a lamp of its own. The bus pulls in at it in the good
  // ending, once for each of them.
  buildStop(mat) {
    const g = new THREE.Group();
    const wood = mat({ color: 0x3b2a1c, roughness: 0.9 });
    const roof = mat({ color: 0x1d2224, roughness: 0.8 });
    const metal = mat({ color: 0x55595a, roughness: 0.5, metalness: 0.5 });
    const b = new Build();
    // Shelter: back, two sides, a roof.
    b.box(3.0, 2.3, 0.08, { x: 0, y: 1.15, z: 0, ry: Math.PI / 2 }, 'wood');
    for (const s of [-1, 1]) b.box(1.3, 2.3, 0.06, { x: 0.62, y: 1.15, z: s * 1.5 }, 'wood');
    b.box(1.6, 0.08, 3.3, { x: 0.65, y: 2.36, rz: -0.08 }, 'roof');
    b.box(0.08, 0.04, 2.8, { x: 0.2, y: 0.46 }, 'wood');
    b.box(0.4, 0.05, 2.8, { x: 0.32, y: 0.48 }, 'wood');
    // The sign, on its own pole at the kerb.
    b.cyl(0.035, 0.035, 2.6, 8, { x: 1.9, y: 1.3, z: -2.2 }, 'metal');
    g.add(b.build({ wood, roof, metal }));
    const signTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#e8e2c8';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d3a5a';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8e2c8';
      ctx.font = '700 30px Barlow Condensed, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BUS', w / 2, h / 2 - 2);
      ctx.fillText('STOP', w / 2, h / 2 + 28);
    });
    const sign = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), mat({ map: signTex, color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }));
    sign.position.set(1.9, 2.5, -2.2);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    const glowMat = new THREE.SpriteMaterial({ map: radial('rgba(255,236,200,1)'), color: 0xffe8c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(1.6, 1.6, 1);
    glow.position.set(0.7, 2.2, 0);
    g.add(glow);
    g.position.set(VERGE_X - 1.4, 0, 0);
    g.visible = false;
    this.road.add(g);
    this.stop = g;
    // Where someone stands at the stop, and the light over them, in the
    // stop's own space.
    this.stop.userData.stand = new THREE.Vector3(0.9, 0, -0.4);
    this.stop.userData.lamp = new THREE.Vector3(0.7, 2.1, 0);
  }

  // Bay 0's road: a station like Grayhollow every few hundred metres, each
  // with its bench, its sleeper, and its tired man in a cap. Three of them,
  // going round.
  buildTerminals(mat) {
    this.terminals = [];
    const slab = mat({ color: 0x5a5c58, roughness: 0.9 });
    const wall = mat({ color: 0x46483f, roughness: 0.9 });
    const roof = mat({ color: 0x1c1f20, roughness: 0.8 });
    const seatMat = mat({ color: 0x4f7a6c, roughness: 0.8 });
    const metal = mat({ color: 0x2b3135, roughness: 0.55, metalness: 0.35 });
    const tube = new THREE.MeshBasicMaterial({ color: TUBE });
    const glowTex = radial('rgba(200,240,220,1)');
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const b = new Build();
      b.box(3.2, 0.3, 7.0, { x: 0, y: 0.15 }, 'slab');
      b.box(0.2, 3.1, 7.0, { x: -1.5, y: 1.85 }, 'wall');
      b.box(3.6, 0.14, 7.4, { x: 0.1, y: 3.4 }, 'roof');
      g.add(b.build({ slab, wall, roof }));
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 2.2), tube);
      t.position.set(0.2, 3.3, 0);
      g.add(t);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: TUBE, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95 }));
      glow.scale.set(4.2, 2.4, 1);
      glow.position.set(0.25, 3.2, 0);
      g.add(glow);
      const bench = makeBench(2.6, { wood: seatMat, metal });
      bench.position.set(-0.9, 0.3, 0);
      bench.rotation.y = Math.PI / 2;
      g.add(bench);
      // The sleeper, along the seat with their head on the arm.
      const sleeper = makeFigure({ coat: [0x3a4a56, 0x55463c, 0x3c3c48][i], skin: 0x6b5a4a, height: 1.72 });
      lieDown(sleeper, 0);
      sleeper.position.set(-0.95, 0.3 + 0.55, -0.86);
      g.add(sleeper);
      // And him, at the platform edge, in his cap.
      const man = makeFigure({ coat: 0x26323b, trousers: 0x161c21, skin: 0x5d6158, cap: 0x1b2730, height: 1.98, gaunt: true, eyes: true });
      man.position.set(1.1, 0.3, -1.6 + i * 0.4);
      man.rotation.y = -Math.PI / 2;
      g.add(man);
      g.userData.man = man;
      g.userData.light = new THREE.Vector3(0.2, 3.0, 0);
      g.position.set(VERGE_X - 1.9, 0, -HALF + 30 + i * 56);
      g.visible = false;
      this.road.add(g);
      this.terminals.push(g);
    }
  }

  // The road for a scene: 'night' (lamps, the stop if asked for), 'dawn'
  // (the same, with the lamps going out), or 'terminals' (Bay 0's road).
  showRoad(mode = 'night') {
    this.mode = mode;
    this.road.visible = true;
    const terminals = mode === 'terminals';
    for (const g of this.terminals) g.visible = terminals;
    for (const g of this.lampPosts) g.visible = !terminals;
    this.stop.visible = false;
    this.setLampsLit(1);
    // Terminals pass in the scroll like everything else.
    for (const g of this.terminals) {
      if (!this.movers.includes(g)) this.movers.push(g);
    }
  }

  hideRoad() {
    this.road.visible = false;
    this.stop.visible = false;
    const i = this.movers.indexOf(this.stop);
    if (i >= 0) this.movers.splice(i, 1);
    this.speed = 0;
  }

  // Brings the stop up `ahead` metres in front of the bus's middle, on the
  // verge. It travels with the road from then on.
  placeStop(ahead) {
    this.stop.position.z = ahead;
    this.stop.visible = true;
    if (!this.movers.includes(this.stop)) this.movers.push(this.stop);
  }

  setLampsLit(v) {
    this.lampsOn = v;
    for (const m of this.glowMats) m.opacity = (m.isSpriteMaterial ? 0.9 : 0.32) * v;
    for (const g of this.lampPosts) g.userData.lens.material.color.setHex(SODIUM).multiplyScalar(0.15 + 0.85 * v);
  }

  // Slides the road back past the bus at the current speed.
  updateRoad(dt) {
    if (!this.road.visible) return;
    const d = this.speed * dt;
    if (!d) return;
    this.scroll += d;
    this.roadTex.offset.y = -this.scroll / 24 * 1;
    this.groundTex.offset.y = -this.scroll / 4;
    for (const m of this.movers) {
      m.position.z -= d;
      if (m === this.stop) continue;
      if (m.position.z < -HALF) m.position.z += SPAN;
    }
  }

  // The nearest thing alongside that throws light into the bus, in world
  // space, and how strongly: a street lamp, the stop, or a terminal.
  passingLight(out = new THREE.Vector3()) {
    let best = null;
    let bestD = Infinity;
    const consider = (g, local, power) => {
      if (!g.visible) return;
      const z = g.position.z + local.z;
      const d = Math.abs(z);
      if (d < bestD) {
        bestD = d;
        best = { g, local, power };
      }
    };
    if (this.mode === 'terminals') {
      for (const g of this.terminals) consider(g, g.userData.light, 0.5);
    } else {
      for (const g of this.lampPosts) consider(g, LAMP_LIGHT, 0.75 * this.lampsOn);
    }
    if (this.stop.visible) consider(this.stop, this.stop.userData.lamp, 0.35);
    if (!best) return null;
    out.copy(best.local).add(best.g.position).add(this.road.position);
    // Strongest right alongside, nothing by fifteen metres off.
    const k = Math.max(0, 1 - bestD / 15);
    return { pos: out, power: best.power * k * k, terminal: this.mode === 'terminals' ? best.g : null };
  }

  // ---- figures and props ------------------------------------------------

  buildProps(mat) {
    // A ticket, to be handed over: card stock with the stub's printing on
    // it. 5 x 9 cm, held flat.
    const tex = canvasTexture(128, 224, (ctx, w, h) => {
      ctx.fillStyle = '#e4dcc2';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#8a2a1e';
      ctx.fillRect(0, 0, w, 34);
      ctx.fillStyle = '#efe6cc';
      ctx.font = '700 20px Barlow Condensed, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GRAYHOLLOW', w / 2, 24);
      ctx.fillStyle = '#2b2620';
      ctx.font = '600 22px Barlow Condensed, sans-serif';
      ctx.fillText('THE COAST', w / 2, 70);
      ctx.font = '500 16px IBM Plex Mono, monospace';
      ctx.fillText('BAY 9', w / 2, 100);
      ctx.fillText('3:33 AM', w / 2, 124);
      ctx.strokeStyle = 'rgba(43,38,32,0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(6, 150);
      ctx.lineTo(w - 6, 150);
      ctx.stroke();
      ctx.font = '500 13px IBM Plex Mono, monospace';
      ctx.fillText('ADMIT ONE', w / 2, 178);
      // The punched hole.
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.arc(w * 0.72, 196, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    this.ticket = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.09), mat({ map: tex, color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }));
    this.ticket.visible = false;
    this.scene.add(this.ticket);

    // The uniform, folded on the ticket counter: coat, trousers, the cap on
    // top, and his keyring beside it.
    const navy = mat({ color: 0x1f2a33, roughness: 0.95 });
    const navy2 = mat({ color: 0x18212a, roughness: 0.95 });
    const brass = mat({ color: 0xb59a52, roughness: 0.32, metalness: 0.9, emissive: 0x1a1406 });
    const b = new Build();
    b.box(0.44, 0.06, 0.34, { y: 0.03 }, 'navy2');
    b.box(0.42, 0.07, 0.32, { y: 0.095, ry: 0.06 }, 'navy');
    for (const s of [-1, 1]) b.cyl(0.012, 0.012, 0.006, 10, { x: s * 0.06, y: 0.133, z: 0.05, ry: 0.06 }, 'brass');
    // The cap: crown and peak.
    b.cyl(0.105, 0.1, 0.08, 18, { x: 0.02, y: 0.17, z: -0.04 }, 'navy');
    b.geo(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 18).scale(1, 1, 1.35), { x: 0.02, y: 0.137, z: 0.02 }, 'navy2');
    b.cyl(0.02, 0.02, 0.006, 10, { x: 0.02, y: 0.17, z: 0.065, rx: Math.PI / 2 }, 'brass');
    // Keyring.
    b.geo(new THREE.TorusGeometry(0.035, 0.004, 6, 18), { x: 0.3, y: 0.004, z: 0.08, rx: Math.PI / 2 }, 'brass');
    for (let k = 0; k < 5; k++) {
      b.box(0.012, 0.003, 0.06, { x: 0.3 + Math.cos(k) * 0.05, y: 0.006, z: 0.08 + Math.sin(k) * 0.05, ry: k }, 'brass');
    }
    this.uniform = b.build({ navy, navy2, brass });
    this.uniform.visible = false;
    this.scene.add(this.uniform);
  }

  // Figures that only exist in an ending. Built the first time they are
  // wanted, by which time the cast has long since loaded.
  get thing() {
    if (!this._thing) {
      // The shape on camera four, as the tape shows it: too tall, too
      // narrow, black right through, a point of light in each eye.
      const f = makeFigure({ coat: 0x030405, skin: 0x08090a, height: 2.35, gaunt: true, eyes: true });
      f.scale.set(0.72, 1.12, 0.72);
      f.visible = false;
      this.scene.add(f);
      this._thing = f;
    }
    return this._thing;
  }

  // Someone new, asleep on the bench at 11:47.
  get sleeper() {
    if (!this._sleeper) {
      const f = makeFigure({ coat: 0x4a4038, skin: 0x8a7462, height: 1.74 });
      this.game.people?.dress(f, 'nina', 'person', { tint: { female_casualsuit01: 0x9a8a78 } });
      f.visible = false;
      this.scene.add(f);
      this._sleeper = f;
    }
    return this._sleeper;
  }

  // Everything back as it was in play.
  reset() {
    this.hideCabin();
    this.hideRoad();
    this.lampsOff();
    this.ticket.visible = false;
    this.uniform.visible = false;
    if (this._thing) this._thing.visible = false;
    if (this._sleeper) this._sleeper.visible = false;
  }
}
