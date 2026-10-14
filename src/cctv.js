import * as THREE from 'three';
import { makeFigure } from './figures.js';
import { ROOMS } from './level.js';
import { addCapAndEyes } from './people.js';

// Closed-circuit television. Four cameras on brackets around the station
// render the actual scene, a few times a second each, into one strip of
// texture that the four CRTs in Security display through a monochrome tube
// shader. What is on the monitors is what is in the rooms -- him included --
// plus the two things that only exist on tape: whatever stands at a lens, and
// the shape on camera 4.

// Per-feed resolution. The screens are 1.29:1; so is this.
const FEED_W = 320;
const FEED_H = 248;

// Layer that only the security cameras render.
export const CCTV_LAYER = 1;

// Order matters: index i is CAM i+1, and the Presence layer's haunts pick a
// camera by the room it covers (hall, baggage, bays, tunnel).
export const FEEDS = [
  { label: 'WAITING HALL', rooms: ['hall'], pos: [0.0, 3.95, 9.5], look: [-0.6, 0.0, -4.5], fov: 66, gain: 3.6, ir: 0 },
  { label: 'BAGGAGE CLAIM', rooms: ['baggage'], pos: [20.45, 3.2, 10.55], look: [7.0, 0.2, 19.5], fov: 64, gain: 3.8, ir: 0.4 },
  { label: 'BAY 9', rooms: ['bays'], pos: [-13.75, 4.2, -25.4], look: [-22.0, 0.5, -30.5], fov: 62, gain: 4.4, ir: 0.8, wall: -24.75 },
  { label: 'SERVICE TUNNEL', rooms: ['tunnel', 'bay0'], pos: [21.4, 2.0, 18.7], look: [29.5, 0.3, 16.6], fov: 66, gain: 5.0, ir: 1.6 },
];

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Each screen's UVs already address its own quarter of the strip, so one
// material draws all four. The feed is turned to luminance, pushed through a
// camera's automatic-gain curve, and given the tube: a bulge, a jittering
// line, a rolling bar, scanlines, grain, and snow when the signal goes.
const FRAG = /* glsl */ `
uniform sampler2D uFeed;
uniform sampler2D uOverlay;
uniform float uTime;
uniform vec4 uSnow;
uniform vec4 uGain;
uniform vec2 uFeedPx;
uniform float uBright;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float idx = clamp(floor(vUv.x * 4.0), 0.0, 3.0);
  int i = int(idx);
  vec2 lu = vec2(vUv.x * 4.0 - idx, vUv.y);

  // The glass bulges; the picture is smaller than the tube.
  vec2 c = lu - 0.5;
  float r2 = dot(c, c);
  vec2 d = 0.5 + c * (1.0 + 0.14 * r2) * 1.02;
  float inside = step(0.0, d.x) * step(d.x, 1.0) * step(0.0, d.y) * step(d.y, 1.0);
  d = clamp(d, 0.003, 0.997);

  // A line now and then slips sideways.
  float line = floor(d.y * uFeedPx.y);
  float frame = floor(uTime * 24.0);
  float slip = step(0.985, hash(vec2(line * 0.37, frame + idx * 7.0))) * (hash(vec2(frame, line)) - 0.5) * 0.03;
  vec2 fuv = vec2((idx + clamp(d.x + slip, 0.003, 0.997)) / 4.0, d.y);

  vec3 rgb = texture2D(uFeed, fuv).rgb;
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  float gain = uGain[i];
  lum = 1.0 - exp(-lum * gain);
  lum = pow(lum, 0.9);

  float n = hash(floor(d * uFeedPx) + vec2(frame * 1.7, idx * 13.0));
  lum = mix(lum, n * 0.9, uSnow[i]);
  lum += (n - 0.5) * 0.07;

  float roll = fract(d.y + uTime * 0.09 + idx * 0.31);
  lum *= 0.9 + 0.1 * smoothstep(0.0, 0.12, roll);
  lum *= 0.84 + 0.16 * sin(d.y * uFeedPx.y * 3.14159);
  lum *= 1.0 - r2 * 1.1;

  vec3 col = vec3(0.66, 0.93, 0.78) * max(lum, 0.0) + vec3(0.012, 0.02, 0.016);
  vec4 o = texture2D(uOverlay, vec2((idx + d.x) / 4.0, d.y));
  col = mix(col, o.rgb, o.a * 0.95);
  gl_FragColor = vec4(col * inside * uBright, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _fwd = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

export class CCTV {
  constructor(game) {
    this.game = game;
    const refs = game.refs;
    this.monitors = refs.monitors;

    this.target = new THREE.WebGLRenderTarget(FEED_W * 4, FEED_H, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    // Stored as sRGB, so the dark end of a dim room keeps its steps.
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.target.scissorTest = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uFeed: { value: this.target.texture },
        uOverlay: { value: this.monitors.live.texture },
        uTime: { value: 0 },
        uSnow: { value: new THREE.Vector4() },
        uGain: { value: new THREE.Vector4(...FEEDS.map((f) => f.gain)) },
        uFeedPx: { value: new THREE.Vector2(FEED_W, FEED_H) },
        uBright: { value: 1.15 },
      },
      fog: false,
      toneMapped: false,
    });
    for (const s of this.monitors.screens) s.material = this.material;

    this.cams = FEEDS.map((f) => {
      const cam = new THREE.PerspectiveCamera(f.fov, FEED_W / FEED_H, 0.1, 70);
      cam.position.set(...f.pos);
      cam.lookAt(...f.look);
      cam.layers.enable(CCTV_LAYER);
      cam.updateMatrixWorld(true);
      return cam;
    });
    this.buildHousings();

    this.snow = [0, 0, 0, 0];
    this.next = 0;
    this.acc = 0;
    this.time = 0;
    this.stale = true;
    this.lastStareCam = -1;

    this.buildFigures();
    this.buildWatchPoses();
  }

  // ---- things in the world --------------------------------------------------

  // A housing on a bracket at each camera, so the player can find them -- and
  // see which way they point.
  buildHousings() {
    const body = new THREE.MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.25, metalness: 0.4 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3e40, roughness: 0.5, metalness: 0.6 });
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2010, emissiveIntensity: 2 });
    const scene = this.game.scene;
    this.leds = [];
    FEEDS.forEach((f, i) => {
      const cam = this.cams[i];
      cam.getWorldDirection(_fwd);
      const g = new THREE.Group();
      // The lens sits just behind the render camera, so the housing never
      // fills its own picture.
      g.position.copy(cam.position).addScaledVector(_fwd, -0.2);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.3), body);
      housing.position.z = -0.05;
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.34), body);
      hood.position.set(0, 0.062, -0.02);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 16), dark);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.115;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), this.ledMat);
      led.position.set(0.045, -0.035, 0.1);
      g.add(housing, hood, lens, led);
      g.lookAt(g.position.clone().add(_fwd));
      scene.add(g);
      if (f.wall) {
        // Bracket: back to the wall or column it hangs from.
        const len = Math.abs(f.wall - g.position.z);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len), metal);
        arm.position.set(g.position.x, g.position.y + 0.07, (f.wall + g.position.z) / 2);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.015), metal);
        plate.position.set(g.position.x, g.position.y + 0.07, f.wall - Math.sign(f.wall - g.position.z) * 0.008);
        scene.add(arm, plate);
      } else {
        // Bracket: straight up into the ceiling.
        const ceilingY = ROOMS[f.rooms[0]].h;
        const len = Math.max(0.05, ceilingY - g.position.y);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 8), metal);
        arm.position.set(g.position.x, g.position.y + len / 2, g.position.z);
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 12), metal);
        plate.position.set(g.position.x, ceilingY - 0.008, g.position.z);
        scene.add(arm, plate);
      }
      this.leds.push(led);
    });
  }

  // What only the tape can see. On the CCTV layer, so the player's own eyes
  // never render them: walk into the room and nothing is there.
  buildFigures() {
    const onTape = (fig) => {
      fig.traverse((o) => o.layers.set(CCTV_LAYER));
      fig.visible = false;
      this.game.scene.add(fig);
      return fig;
    };
    // Both are near-black and unlit from within: on an infrared picture,
    // where everything else is washed pale, they read as holes in it.
    // Whatever stands at a lens: his build, turned up to look into it.
    this.stareFigure = onTape(makeFigure({
      coat: 0x050607,
      skin: 0x0b0c0d,
      cap: 0x040505,
      height: 2.05,
      gaunt: true,
      eyes: true,
    }));
    this.game.people?.dress(this.stareFigure, 'attendant', 'shadow', {
      onDressed: (d) => addCapAndEyes(d, { capColor: 0x050607, eyeColor: 0xe0fff0 }),
    });
    // The shape on camera 4. Too tall and too narrow.
    this.thing = onTape(makeFigure({
      coat: 0x030405,
      skin: 0x08090a,
      height: 2.35,
      gaunt: true,
      eyes: true,
    }));
    this.thing.scale.set(0.72, 1.12, 0.72);
    this.thingCam = -1;
    this.thingDist = 0;
    this.thingTimer = 0;
  }

  // Ground point `dist` metres out along a camera's view, and the yaw that
  // faces a figure standing there back at the lens.
  placeInView(fig, i, dist) {
    const cam = this.cams[i];
    cam.getWorldDirection(_fwd);
    _fwd.y = 0;
    _fwd.normalize();
    fig.position.set(cam.position.x + _fwd.x * dist, 0, cam.position.z + _fwd.z * dist);
    const dx = cam.position.x - fig.position.x;
    const dz = cam.position.z - fig.position.z;
    fig.rotation.y = Math.atan2(-dx, -dz);
    return Math.hypot(dx, dz);
  }

  // How far out along camera i's view a figure of `headY` puts its head
  // a little below the middle of the picture.
  stareDistance(i, headY) {
    const f = FEEDS[i];
    const dx = f.look[0] - f.pos[0];
    const dz = f.look[2] - f.pos[2];
    const pitch = Math.atan2(f.pos[1] - f.look[1], Math.hypot(dx, dz));
    const want = pitch + THREE.MathUtils.degToRad(5);
    return Math.max(1.6, (f.pos[1] - headY) / Math.tan(want));
  }

  // The longest a figure can stand from camera i and still be in its room.
  maxDistance(i) {
    const f = FEEDS[i];
    return Math.min(16, Math.hypot(f.look[0] - f.pos[0], f.look[2] - f.pos[2]) * 0.9);
  }

  // ---- console --------------------------------------------------------------

  label(i) {
    return FEEDS[i]?.label ?? '';
  }

  // Where the eye goes to look at all four, or lean in to one.
  buildWatchPoses() {
    const screens = this.monitors.screens;
    const pos = screens.map((s) => s.getWorldPosition(new THREE.Vector3()));
    const q = screens[0].getWorldQuaternion(new THREE.Quaternion());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const center = pos.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pos.length);
    const halfW = pos[0].distanceTo(pos[pos.length - 1]) / 2 + 0.5;
    const pose = (at, dist, eyeLift, hw, hh) => {
      const x = at.x + normal.x * dist;
      const z = at.z + normal.z * dist;
      const eye = at.y + eyeLift;
      return {
        x, z, eye,
        yaw: Math.atan2(normal.x, normal.z),
        pitch: -Math.atan2(eye - at.y, dist),
        halfW: hw,
        halfH: hh,
        dist,
      };
    };
    this.poses = {
      all: pose(center, 1.85, 0.16, halfW, 0.42),
      one: pos.map((p) => pose(p, 0.86, 0.03, 0.38, 0.31)),
    };
  }

  watchPose(focus, aspect) {
    const p = focus >= 0 ? this.poses.one[focus] : this.poses.all;
    // The narrowest view that still fits the whole target in this window.
    const v = Math.max(p.halfH / p.dist, p.halfW / (p.dist * Math.max(0.5, aspect)));
    p.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(v)), 18, 80);
    return p;
  }

  // ---- per frame ------------------------------------------------------------

  reset() {
    this.stareFigure.visible = false;
    this.thing.visible = false;
    this.thingCam = -1;
    this.lastStareCam = -1;
    this.snow.fill(0);
    this.stale = true;
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;

    // The tally lights blink while the tape runs.
    const on = Math.floor(this.time * 1.2) % 2 === 0;
    for (const led of this.leds) led.visible = on;

    this.updateStare();
    this.updateThing(dt);

    for (let i = 0; i < 4; i++) {
      this.snow[i] = Math.max(0, this.snow[i] - dt * 2.5);
      // A camera with something standing at it never quite holds a picture.
      if (g.presence?.cctvStare?.cam === i && Math.random() < 0.04) this.snow[i] = Math.max(this.snow[i], 0.35);
    }
    this.material.uniforms.uSnow.value.set(...this.snow);
  }

  updateStare() {
    const stare = this.game.presence?.cctvStare;
    const fig = this.stareFigure;
    if (!stare) {
      if (fig.visible) {
        fig.visible = false;
        if (this.lastStareCam >= 0) this.snow[this.lastStareCam] = 1;
      }
      this.lastStareCam = -1;
      return;
    }
    if (stare.cam !== this.lastStareCam) {
      const headY = 2.0;
      this.placeInView(fig, stare.cam, this.stareDistance(stare.cam, headY));
      const rig = fig.userData.rig;
      // Turned up into the lens; the second kind with its head on one side.
      rig.head.rotation.set(0.42, 0, stare.variant === 2 ? 0.45 : 0);
      fig.visible = true;
      this.snow[stare.cam] = 1;
      this.lastStareCam = stare.cam;
    }
  }

  // It is on one camera and it gets nearer -- never while you watch that
  // picture, only in the moments it goes to snow.
  updateThing(dt) {
    const g = this.game;
    if (!g.camera4Active) {
      if (this.thing.visible) this.thing.visible = false;
      this.thingCam = -1;
      return;
    }
    const cam = 4 - Math.min(3, g.state.persistent.sawCamera4) - 1;
    if (cam !== this.thingCam) {
      this.thingCam = cam;
      this.thingDist = this.maxDistance(cam);
      this.placeInView(this.thing, cam, this.thingDist);
      this.thing.visible = true;
      this.thingTimer = 6;
      this.snow[cam] = 1;
    }
    this.thingTimer -= dt;
    const watched = g.player.watching && (g.player.watching.focus === cam);
    if (this.thingTimer <= 0 && !watched) {
      this.thingTimer = 5 + Math.random() * 4;
      const min = 2.2;
      if (this.thingDist > min) {
        this.thingDist = Math.max(min, this.thingDist - (1.2 + Math.random() * 1.4));
        this.placeInView(this.thing, cam, this.thingDist);
        this.snow[cam] = 1;
      }
    }
  }

  // Which feeds to redraw this frame. Only as often as anyone could notice:
  // constantly at the console, often in the room, now and then when the
  // screens are in view from further off, never otherwise.
  render() {
    const g = this.game;
    const p = g.player;
    let rate = 0;
    if (p.watching) rate = 60;
    else if (g.currentRoom === 'cctv') rate = 36;
    else if (this.screensInView()) rate = 10;
    if (this.stale) rate = Math.max(rate, 1e3);
    if (g.quality.tier.label === 'LOW') rate *= 0.5;
    if (!rate) return;

    this.acc = Math.min(4, this.acc + rate / 60);
    let budget = p.watching ? 2 : 1;
    if (this.stale) budget = 4;
    const focus = p.watching ? p.watching.focus : -1;
    if (focus >= 0) {
      // The one you are leaning in to runs at full rate.
      this.renderFeed(focus);
      budget--;
    }
    while (this.acc >= 1 && budget > 0) {
      this.acc -= 1;
      budget--;
      if (this.next === focus) this.next = (this.next + 1) % 4;
      this.renderFeed(this.next);
      this.next = (this.next + 1) % 4;
    }
    this.stale = false;
  }

  screensInView() {
    const g = this.game;
    const s = this.monitors.screens[1];
    s.getWorldPosition(_v);
    if (_v.distanceToSquared(g.camera.position) > 22 * 22) return false;
    _m.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    _sphere.center.copy(_v);
    _sphere.radius = 1.8;
    return _frustum.intersectsSphere(_sphere);
  }

  // One feed. The forward renderer only has so many light slots, and they
  // belong to the lights around the player; for the length of this render the
  // ones that are not casting shadows are handed to the fixtures around this
  // camera instead. The count never changes, so no shader recompiles.
  renderFeed(i) {
    const g = this.game;
    const renderer = g.renderer;
    const f = FEEDS[i];
    const cam = this.cams[i];
    const lights = g.level.lights;

    let slots = 0;
    for (const l of lights) {
      l.feedWas = l.light.visible;
      if (l.light.visible && !l.light.castShadow) slots++;
    }
    const ranked = [];
    for (const l of lights) {
      if (l.broken || l.light.castShadow) continue;
      const lp = l.light.position;
      const d = (lp.x - cam.position.x) ** 2 + (lp.z - cam.position.z) ** 2;
      ranked.push({ l, score: d + (f.rooms.includes(l.room) ? 0 : 900) });
    }
    ranked.sort((a, b) => a.score - b.score);
    for (const e of ranked) e.l.light.visible = false;
    for (let k = 0; k < Math.min(slots, ranked.length); k++) {
      const l = ranked[k].l;
      if (!l.feedWas) l.light.intensity = g.lightIntensity(l, this.time);
      l.light.visible = true;
    }

    // An infrared-sensitive camera sees a little into the dark, and through
    // more of the haze than an eye does.
    const fog = g.scene.fog;
    const fogDensity = fog?.density;
    if (fog) fog.density = fogDensity * 0.45;
    const hemi = g.hemi.intensity;
    const amb = g.ambient.intensity;
    g.hemi.intensity = hemi * (1 + f.ir);
    g.ambient.intensity = amb * (1 + f.ir * 3);
    // Nothing that belongs to the player's eyes.
    const face = g.presence?.faceMesh;
    const faceWas = face?.visible;
    if (face) face.visible = false;
    // The shadow maps were drawn for the player's view this frame; leave them.
    const sm = renderer.shadowMap;
    const smAuto = sm.autoUpdate;
    const smNeeds = sm.needsUpdate;
    sm.autoUpdate = false;
    sm.needsUpdate = false;

    const prevTarget = renderer.getRenderTarget();
    this.target.viewport.set(i * FEED_W, 0, FEED_W, FEED_H);
    this.target.scissor.set(i * FEED_W, 0, FEED_W, FEED_H);
    renderer.setRenderTarget(this.target);
    renderer.render(g.scene, cam);
    renderer.setRenderTarget(prevTarget);

    sm.autoUpdate = smAuto;
    sm.needsUpdate = smNeeds;
    if (face) face.visible = faceWas;
    g.hemi.intensity = hemi;
    g.ambient.intensity = amb;
    if (fog) fog.density = fogDensity;
    for (const l of lights) l.light.visible = l.feedWas;
  }
}
