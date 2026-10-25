import * as THREE from 'three';

// First-person cutscenes. A scene is a script: shots (camera keyframes, each
// in the world or in a moving object's own space), events at given times,
// tracks for the eyelids, the letterbox, blur and the fade, and an update
// that runs every frame for anything that moves. The engine plays it, lets the
// mouse look a little way off the shot, lets a held key skip it, and puts
// everything it borrowed back when it ends -- skipped or not.
//
// The world is frozen underneath, exactly as it is behind a menu: the clock,
// him, the rules. Only what the scene moves, moves.

const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const EASE = {
  lin: (u) => u,
  io: (u) => u * u * (3 - 2 * u),
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
};

// Seconds a key has to be held to skip.
const SKIP_HOLD = 0.9;

function catmull(a, b, c, d, u, out) {
  const u2 = u * u;
  const u3 = u2 * u;
  for (const k of ['x', 'y', 'z']) {
    out[k] = 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u3);
  }
  return out;
}

const vec = (v) => (v.isVector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));

// A run of camera keys: { t, p: [x, y, z], l: [x, y, z], fov, roll, ease,
// walk }. `p` is the eye, `l` what it looks at. Between keys the eye travels
// a smooth curve through its neighbours, eased by the earlier key's `ease`
// ('io' by default: the head settles at every key; 'lin' to carry on through
// it). `walk` on a key means the stretch after it is walked, not glided: the
// view bobs, and there are footsteps.
export class Shot {
  constructor(at, keys, frame = null) {
    this.at = at;
    this.frame = frame;
    this.keys = keys.map((k) => ({
      ...k,
      p: vec(k.p),
      l: vec(k.l),
    }));
  }

  sample(t, out) {
    const keys = this.keys;
    let i = 0;
    while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
    const k1 = keys[i];
    const k2 = keys[Math.min(i + 1, keys.length - 1)];
    const k0 = keys[Math.max(0, i - 1)];
    const k3 = keys[Math.min(keys.length - 1, i + 2)];
    const span = Math.max(1e-4, k2.t - k1.t);
    const raw = Math.max(0, Math.min(1, (t - k1.t) / span));
    const u = (EASE[k1.ease ?? 'io'] ?? EASE.io)(raw);
    catmull(k0.p, k1.p, k2.p, k3.p, u, out.p);
    catmull(k0.l, k1.l, k2.l, k3.l, u, out.l);
    const f1 = k1.fov ?? null;
    const f2 = k2.fov ?? f1;
    out.fov = f1 === null ? null : f1 + ((f2 ?? f1) - f1) * u;
    out.roll = (k1.roll ?? 0) + ((k2.roll ?? 0) - (k1.roll ?? 0)) * u;
    out.walk = !!k1.walk && raw < 1;
    out.stride = k1.stride ?? 1;
    return out;
  }
}

// A value over time from [t, v] points, eased between them.
export function track(points) {
  return (t) => {
    if (!points.length) return 0;
    if (t <= points[0][0]) return points[0][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [t1, v1] = points[i];
      const [t2, v2] = points[i + 1];
      if (t < t2) {
        const u = (t - t1) / Math.max(1e-4, t2 - t1);
        return v1 + (v2 - v1) * u * u * (3 - 2 * u);
      }
    }
    return points[points.length - 1][1];
  };
}

// Builds the overlay once: a title card and the skip hint. The letterbox,
// eyelids and fades are drawn by the render pipeline's last pass (see
// RenderPipeline.setCinema), on the picture itself.
function overlay() {
  let el = document.getElementById('cine');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'cine';
  el.className = 'hidden';
  el.innerHTML = `<div class="card"><div class="kicker"></div><div class="title"></div></div>
    <div class="skip"><svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="15"/><circle class="fill" cx="18" cy="18" r="15"/></svg><span class="label"></span></div>`;
  document.body.appendChild(el);
  return el;
}

export class Cutscene {
  // `script`: { name, duration, shots, events: [[t, fn]], lids, bars, blur,
  // black, card, start(cs), update(cs, t, dt), end(cs, skipped) }.
  constructor(game, script, onDone) {
    this.game = game;
    this.script = script;
    this.onDone = onDone;
    this.t = 0;
    this.done = false;
    this.skipped = false;
    this.events = (script.events ?? []).slice().sort((a, b) => a[0] - b[0]);
    this.nextEvent = 0;
    this.shots = (script.shots ?? []).slice().sort((a, b) => a.at - b.at);
    this.lids = script.lids ? track(script.lids) : () => 0;
    this.bars = script.bars ? track(script.bars) : () => 0;
    this.blur = script.blur ? track(script.blur) : () => 0;
    this.black = script.black ? track(script.black) : () => 0;
    this.white = script.white ? track(script.white) : () => 0;
    this.sample = { p: new THREE.Vector3(), l: new THREE.Vector3(), fov: null, roll: 0, walk: false, stride: 1 };
    // Free look: the mouse turns the head a little way off the shot, and it
    // drifts back when left alone.
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookIdle = 0;
    this.bobPhase = 0;
    this.lastEye = null;
    this.skipHeld = 0;
    this.skipKeys = new Set();
    this.borrowed = [];
    this.saved = null;
    this.fogTarget = null;
    this.el = overlay();
  }

  start() {
    const g = this.game;
    // The world's lighting, so a scene can push it around freely.
    const fog = g.scene.fog;
    this.saved = {
      fogColor: fog.color.clone(),
      fogDensity: fog.density,
      hemi: g.hemi.intensity,
      hemiSky: g.hemi.color.clone(),
      hemiGround: g.hemi.groundColor.clone(),
      ambient: g.ambient.intensity,
    };
    this.startedAt = performance.now() / 1000;
    this.el.classList.remove('hidden');
    this.el.querySelector('.skip .label').textContent = g.pad?.active ? 'Hold A to skip' : g.touch ? 'Hold to skip' : 'Hold E to skip';
    this.el.classList.toggle('canskip', this.script.skippable !== false);
    document.body.classList.add('incutscene');
    g.hud.el.hud.classList.add('cinematic');
    this.script.start?.(this);
    this.apply(0);
  }

  // ---- what scenes call ---------------------------------------------------

  // Keeps `obj` (and its rig's pose, and its materials' opacity) to put back
  // when the scene ends. Safe to call twice.
  borrow(obj) {
    if (!obj || this.borrowed.some((b) => b.obj === obj)) return obj;
    const bones = [];
    obj.traverse((o) => {
      if (o !== obj && (o.isBone || o.type === 'Bone')) bones.push([o, o.quaternion.clone(), o.position.clone(), o.scale.clone()]);
    });
    const mats = (obj.userData.materials ?? []).map((m) => [m, m.opacity]);
    this.borrowed.push({
      obj,
      parent: obj.parent,
      position: obj.position.clone(),
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
      order: obj.rotation.order,
      visible: obj.visible,
      seated: obj.userData.seated,
      bones,
      mats,
    });
    return obj;
  }

  // Moves `obj` into `parent`'s space without moving it in the world.
  adopt(obj, parent) {
    this.borrow(obj);
    parent.attach(obj);
    return obj;
  }

  // Eases the fog to a density and colour over `rate` (per second).
  fogTo(density, color = null, rate = 1.5) {
    this.fogTarget = { density, color: color === null ? null : new THREE.Color(color), rate };
  }

  // Shows a title card over the picture: `kicker` small above `title`.
  card(title, kicker = '', on = true) {
    const card = this.el.querySelector('.card');
    card.querySelector('.title').textContent = title;
    card.querySelector('.kicker').textContent = kicker;
    card.classList.toggle('show', on);
  }

  // A one-off sound out in the world, at x, z: `play(dest)` makes it.
  soundAt(x, z, play, maxDist = 26, life = 4) {
    const a = this.game.audio;
    if (!a.ctx) return;
    const em = a.makeEmitter(x, z, maxDist);
    play(em.gain);
    a.releaseEmitter(em, life);
  }

  // ---- input --------------------------------------------------------------

  look(dx, dy) {
    const s = 0.0022 * (this.game.settings?.sensitivity ?? 1);
    const inv = this.game.settings?.invertY ? -1 : 1;
    this.lookYaw = Math.max(-0.45, Math.min(0.45, this.lookYaw - dx * s));
    this.lookPitch = Math.max(-0.3, Math.min(0.3, this.lookPitch - dy * s * inv));
    this.lookIdle = 0;
  }

  key(code, down) {
    if (!['KeyE', 'Space', 'Enter', 'pointer'].includes(code)) return;
    if (down) this.skipKeys.add(code);
    else this.skipKeys.delete(code);
  }

  skip() {
    if (this.done || this.script.skippable === false) return;
    this.skipped = true;
    this.finish();
  }

  // ---- per frame ----------------------------------------------------------

  update(dt) {
    if (this.done) return;
    // Held (by the screenshot harness): the picture stays where it is.
    if (this.hold) dt = 0;
    this.t += dt;
    const t = this.t;
    while (this.nextEvent < this.events.length && this.events[this.nextEvent][0] <= t) {
      const fn = this.events[this.nextEvent++][1];
      fn(this);
      if (this.done) return;
    }
    this.script.update?.(this, t, dt);
    if (this.done) return;
    // The road slides past at whatever speed the scene has set.
    this.game.sets.updateRoad(dt);

    // Held in real seconds, not scene time: on a device that cannot hold the
    // frame rate, scene time runs slow, and the hold should not.
    const now = performance.now() / 1000;
    const wall = Math.min(0.1, now - (this.lastWall ?? now));
    this.lastWall = now;
    if (this.skipKeys.size && this.script.skippable !== false && now - this.startedAt > 0.4) {
      this.skipHeld += wall;
      if (this.skipHeld >= SKIP_HOLD) {
        this.skip();
        return;
      }
    } else {
      this.skipHeld = Math.max(0, this.skipHeld - wall * 2);
    }

    // Fog toward its target.
    if (this.fogTarget) {
      const fog = this.game.scene.fog;
      const k = Math.min(1, dt * this.fogTarget.rate);
      fog.density += (this.fogTarget.density - fog.density) * k;
      if (this.fogTarget.color) fog.color.lerp(this.fogTarget.color, k);
      this.game.atmosphere.density = fog.density;
    }
    this.game.sets.skyMat.color.copy(this.game.scene.fog.color);

    this.lookIdle += dt;
    if (this.lookIdle > 1.2) {
      const k = Math.min(1, dt * 1.4);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
    this.apply(dt);

    if (t >= this.script.duration) this.finish();
  }

  // Runs the scene forward to `target` seconds as fast as it will go, every
  // event and every frame of it, for looking at one moment.
  seek(target, step = 1 / 30) {
    const hold = this.hold;
    this.hold = false;
    while (!this.done && this.t < target - 1e-6) this.update(Math.min(step, target - this.t));
    this.hold = hold;
  }

  // The camera and the overlay for the current time.
  apply(dt) {
    const g = this.game;
    const cam = g.camera;
    const t = this.t;
    let shot = this.shots[0];
    for (const s of this.shots) if (s.at <= t) shot = s;
    if (shot) {
      const s = shot.sample(t, this.sample);
      _p.copy(s.p);
      _l.copy(s.l);
      if (shot.frame) {
        shot.frame.updateMatrixWorld(true);
        _p.applyMatrix4(shot.frame.matrixWorld);
        _l.applyMatrix4(shot.frame.matrixWorld);
      }

      // Walking: bob and footfalls, from how far the eye actually went.
      let bob = 0;
      if (this.lastEye && dt > 0) {
        _a.subVectors(_p, this.lastEye).setY(0);
        const speed = _a.length() / dt;
        if (s.walk && speed > 0.15 && speed < 6) {
          const before = Math.sin(this.bobPhase);
          this.bobPhase += dt * (3.6 + speed * 1.8) * s.stride;
          const after = Math.sin(this.bobPhase);
          // A foot lands at each crossing, and the head dips as it does.
          if (Math.sign(before) !== Math.sign(after)) {
            g.audio.footstep?.(0.35, this.script.surface?.(_p) ?? 'tile');
          }
          bob = -(Math.cos(this.bobPhase * 2) + 1) * 0.5 * 0.03 * Math.min(1, speed / 1.2);
        }
      }
      this.lastEye = (this.lastEye ?? new THREE.Vector3()).copy(_p);

      // Hands are never quite steady, even standing still: a slow drift and
      // a breath.
      const calm = g.settings?.calm ? 0.4 : 1;
      const tt = performance.now() / 1000;
      const swayX = (Math.sin(tt * 0.71) * 0.006 + Math.sin(tt * 1.37) * 0.003) * calm;
      const swayY = (Math.sin(tt * 0.53 + 1.3) * 0.005 + Math.sin(tt * 1.9) * 0.002) * calm + bob;
      cam.position.copy(_p);
      cam.position.y += swayY;
      cam.up.set(0, 1, 0);
      cam.lookAt(_l);
      cam.rotateOnWorldAxis(_b.set(0, 1, 0), this.lookYaw + swayX * 0.6);
      cam.rotateX(this.lookPitch + swayY * 0.4);
      cam.rotateZ(s.roll + Math.sin(tt * 0.43) * 0.004 * calm);
      const fov = s.fov ?? g.settings.fov;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }

    // Overlay.
    // Eyelids (shut is 1), letterbox, fades: all drawn in the last pass.
    const lids = this.lids(t);
    const bars = this.bars(t);
    const black = this.black(t);
    const white = this.white(t);
    // The bars are a little slimmer on a short screen, to match where the
    // subtitles sit (style.css).
    g.ps1.setCinema(lids, bars, black, white, window.innerHeight <= 560 ? 0.09 : 0.11);
    const blur = this.blur(t);
    if (this.cache?.blur !== blur) g.ps1.setBlur(blur > 0.05 ? blur : 0);
    const el = this.el;
    const skip = this.skipHeld / SKIP_HOLD;
    if (this.cache?.skip !== skip) {
      el.querySelector('.skip .fill').style.strokeDashoffset = (94.25 * (1 - skip)).toFixed(2);
      el.classList.toggle('skipping', skip > 0.01);
    }
    el.classList.toggle('hint', t > 1.5);
    this.cache = { lids, bars, blur, black, white, skip };
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const g = this.game;
    try {
      this.script.end?.(this, this.skipped);
    } finally {
      this.restore();
      this.onDone?.(this);
    }
  }

  restore() {
    const g = this.game;
    for (const b of this.borrowed.reverse()) {
      const o = b.obj;
      if (b.parent && o.parent !== b.parent) b.parent.add(o);
      o.position.copy(b.position);
      o.quaternion.copy(b.quaternion);
      o.rotation.order = b.order;
      o.rotation.setFromQuaternion(b.quaternion, b.order);
      o.scale.copy(b.scale);
      o.visible = b.visible;
      o.userData.seated = b.seated;
      for (const [bone, q, p, s] of b.bones) {
        bone.quaternion.copy(q);
        bone.position.copy(p);
        bone.scale.copy(s);
      }
      for (const [m, op] of b.mats) m.opacity = op;
      o.userData.poseDirty = true;
    }
    this.borrowed = [];
    const s = this.saved;
    if (s) {
      g.scene.fog.color.copy(s.fogColor);
      g.scene.fog.density = s.fogDensity;
      g.atmosphere.density = s.fogDensity;
      g.hemi.intensity = s.hemi;
      g.hemi.color.copy(s.hemiSky);
      g.hemi.groundColor.copy(s.hemiGround);
      g.ambient.intensity = s.ambient;
      g.camera.fov = g.settings.fov;
      g.camera.updateProjectionMatrix();
    }
    g.sets.reset();
    g.ps1.setBlur(0);
    this.el.classList.add('hidden');
    this.el.classList.remove('hint', 'skipping');
    g.ps1.setCinema(0, 0, 0, 0);
    this.card('', '', false);
    document.body.classList.remove('incutscene');
    g.hud.el.hud.classList.remove('cinematic');
  }
}
