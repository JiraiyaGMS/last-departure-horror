import * as THREE from 'three';
import { resolveMovement } from './collision.js';

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.0;
const RADIUS = 0.34;

const SPEED_WALK = 2.5;
const SPEED_RUN = 5.2;
const SPEED_CROUCH = 1.25;

export class Player {
  constructor(camera, level, game) {
    this.camera = camera;
    this.level = level;
    this.game = game;

    this.position = new THREE.Vector3(0, 0, 6);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.crouching = false;
    this.running = false;
    this.eyeHeight = EYE_STAND;

    this.hiding = null;          // the hide spot we are inside
    this.watching = null;        // { focus } while sat at the CCTV console
    this.breath = 1;             // 1 = full, drains while holding
    this.holdingBreath = false;

    this.noise = 0;              // 0..1, consumed by the Attendant
    this.stepTimer = 0;
    this.bobPhase = 0;

    this.keys = Object.create(null);
    this.lookEnabled = false;
    this.touchMove = null;       // { x, z } from the on-screen stick

    this.flashlightOn = false;
    this.battery = 1;

    this.buildFlashlight();
    this.bindInput();
  }

  buildFlashlight() {
    this.flashlight = new THREE.SpotLight(0xfff0d0, 0, 22, Math.PI / 7, 0.45, 1.4);
    // Held low and to the right, the way a hand holds a torch, and aimed at
    // the middle of the view a few metres out. A light at the eye can never
    // show the player a shadow -- every one falls directly behind the thing
    // casting it -- so the offset is what makes things in the beam throw them.
    this.flashlight.position.set(0.2, -0.22, 0.05);
    this.flashTarget = new THREE.Object3D();
    this.camera.add(this.flashlight);
    this.camera.add(this.flashTarget);
    this.flashTarget.position.set(0, 0, -7);
    this.flashlight.target = this.flashTarget;

    // The single most important shadow in the game. Everything the player
    // learns about a dark room, they learn from the shape this throws -- and
    // from the fact that it keeps throwing shapes of things that are not
    // there. Worth the full map resolution on its own.
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 24;
    this.flashlight.shadow.bias = -0.0015;
    this.flashlight.shadow.normalBias = 0.02;
    this.flashlight.shadow.focus = 1;
  }

  bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      for (const code of Object.keys(this.keys)) this.keys[code] = false;
    });
    window.addEventListener('mousemove', (e) => {
      // Without pointer lock (a browser that refuses it), look by dragging.
      const drag = this.game.noLock && (e.buttons & 1) && this.game.started && !this.game.hud.modalOpen;
      if (!this.lookEnabled && !drag) return;
      // At the console the view belongs to the monitors.
      if (this.watching) return;
      const settings = this.game.settings;
      const sens = 0.0022 * (settings?.sensitivity ?? 1);
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens * (settings?.invertY ? -1 : 1);
      const limit = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });
  }

  teleport(x, z, yaw = 0) {
    this.position.set(x, 0, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.hiding = null;
    if (this.watching) {
      this.watching = null;
      this.camera.fov = this.game.settings?.fov ?? this.camera.fov;
      this.camera.updateProjectionMatrix();
    }
    this.breath = 1;
    this.gasp = 0;
    this.holdingBreath = false;
    this.running = false;
    this.exertion = 0;
    this.velocity.set(0, 0, 0);
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  enterHide(spot) {
    this.hiding = spot;
    spot.occupied = true;
    // Nobody is running inside a locker. This was left set if you dived in
    // mid-sprint, and the no-running rule kept firing -- and calling him to
    // your hiding place -- every six seconds until you came out.
    this.running = false;
    this.position.set(spot.position.x, 0, spot.position.z);
    if (spot.lookYaw !== undefined) this.yaw = spot.lookYaw;
    // Getting in is a cut. Easing down from standing height would drag the
    // eye through the seat of the bench on the way.
    if (spot.view?.eye !== undefined) this.eyeHeight = spot.view.eye;
    this.game.onEnterHide?.(spot);
  }

  // Sit down at the CCTV console. `focus` is -1 for all four screens, or the
  // one being leaned in to.
  startWatching() {
    this.watching = { focus: -1 };
    this.running = false;
    this.crouching = false;
  }

  exitHide() {
    if (!this.hiding) return;
    const spot = this.hiding;
    spot.occupied = false;
    this.hiding = null;
    this.holdingBreath = false;
    if (spot.exit) this.position.set(spot.exit.x, 0, spot.exit.z);
    this.game.onExitHide?.(spot);
  }

  update(dt) {
    const k = this.keys;

    if (this.hiding) {
      this.updateHiding(dt, k);
      return;
    }
    if (this.watching) {
      this.updateWatching(dt);
      return;
    }

    this.crouching = !!k.KeyC;
    const wantRun = !!(k.ShiftLeft || k.ShiftRight) && !this.crouching;

    let ix = 0;
    let iz = 0;
    if (k.KeyW) iz -= 1;
    if (k.KeyS) iz += 1;
    if (k.KeyA) ix -= 1;
    if (k.KeyD) ix += 1;

    // Touch stick: analog, so a half push is a slow creep.
    let throttle = 1;
    const tm = this.touchMove;
    if (tm && ix === 0 && iz === 0) {
      ix = tm.x;
      iz = tm.z;
      throttle = Math.min(1, Math.hypot(ix, iz));
    }

    const moving = ix !== 0 || iz !== 0;
    this.running = wantRun && moving;

    const speed = this.crouching ? SPEED_CROUCH : this.running ? SPEED_RUN : SPEED_WALK;

    if (moving) {
      const len = Math.hypot(ix, iz);
      ix /= len;
      iz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Forward is (-sin, -cos); right is (cos, -sin).
      const fwd = -iz;
      const dirX = -sin * fwd + cos * ix;
      const dirZ = -cos * fwd - sin * ix;
      this.position.x += dirX * speed * throttle * dt;
      this.position.z += dirZ * speed * throttle * dt;
    }

    resolveMovement(this.level.colliders, this.position, RADIUS, 0, this.eyeHeight);

    // Footstep noise. Running is loud, crouching is nearly silent.
    if (moving) {
      this.stepTimer -= dt * (this.running ? 2.6 : this.crouching ? 1.0 : 1.7);
      if (this.stepTimer <= 0) {
        this.stepTimer = 1;
        const loudness = this.running ? 0.95 : this.crouching ? 0.08 : 0.35;
        this.noise = Math.max(this.noise, loudness);
        this.game.onFootstep?.(loudness);
      }
      this.bobPhase += dt * (this.running ? 13 : 8);
    } else {
      this.bobPhase += dt * 1.5;
    }

    this.noise *= Math.pow(0.08, dt);

    // Exertion builds fast while sprinting and bleeds off slowly, so a chase
    // leaves you panting in the dark long after you have stopped running.
    this.exertion = Math.max(0, Math.min(1,
      (this.exertion ?? 0) + (this.running ? dt * 0.42 : -dt * 0.14)));
    this.game.audio?.setExertion(this.exertion);

    // Crouch/stand easing.
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);

    this.breath = Math.min(1, this.breath + dt * 0.35);

    this.updateFlashlight(dt);
    this.applyCamera(moving);
  }

  updateHiding(dt, k) {
    this.running = false;
    // Run out of breath and you come up gasping, loudly, whether you meant to
    // or not -- and for a moment you cannot hold it again.
    this.gasp = Math.max(0, (this.gasp ?? 0) - dt);
    this.holdingBreath = !!k.Space && this.gasp <= 0;
    if (this.holdingBreath) {
      this.breath = Math.max(0, this.breath - dt * 0.22);
      if (this.breath <= 0) {
        this.holdingBreath = false;
        this.gasp = 2.2;
        this.game.onGasp?.();
      }
    } else {
      this.breath = Math.min(1, this.breath + dt * 0.3);
      // Breathing in a hiding spot is a small, constant tell.
      this.noise = Math.max(this.noise, 0.12);
    }
    if (k.KeyQ) this.exitHide();

    // Holding your breath to the limit means you come back gasping -- and
    // while you hold it, the breath bus goes silent entirely.
    if (this.holdingBreath && this.breath < 0.35) {
      this.exertion = Math.max(this.exertion ?? 0, 1 - this.breath * 1.8);
    } else {
      this.exertion = Math.max(0, (this.exertion ?? 0) - dt * 0.18);
    }
    this.game.audio?.setExertion(this.holdingBreath ? 0 : this.exertion);

    // A spot can say where the eye goes: under a bench it is down at the
    // floor between the legs, not up inside the backrest.
    this.eyeHeight += ((this.hiding.view?.eye ?? 1.15) - this.eyeHeight) * Math.min(1, dt * 8);
    this.updateFlashlight(dt);
    this.applyCamera(false);
  }

  updateWatching(dt) {
    const pose = this.game.watchPose();
    const e = Math.min(1, dt * 5);
    this.position.x += (pose.x - this.position.x) * e;
    this.position.z += (pose.z - this.position.z) * e;
    this.eyeHeight += (pose.eye - this.eyeHeight) * e;
    const dy = Math.atan2(Math.sin(pose.yaw - this.yaw), Math.cos(pose.yaw - this.yaw));
    this.yaw += dy * e;
    this.pitch += (pose.pitch - this.pitch) * e;
    this.running = false;
    this.crouching = false;
    // Sitting still is silent, and the breath comes back.
    this.noise *= Math.pow(0.08, dt);
    this.breath = Math.min(1, this.breath + dt * 0.35);
    this.exertion = Math.max(0, (this.exertion ?? 0) - dt * 0.14);
    this.game.audio?.setExertion(this.exertion);
    this.updateFlashlight(dt);
    this.applyCamera(false);
  }

  updateFlashlight(dt) {
    if (this.flashlightOn && this.battery > 0) {
      // A cell is about two and a quarter real minutes of light against an
      // eleven-minute loop. With the starting cell and all four spare packs
      // that is enough to keep the torch lit the whole night -- but only if
      // you went and found every one of them, and finding them costs the time
      // you were going to spend using it.
      this.battery = Math.max(0, this.battery - dt * 0.0075);
      if (this.battery <= 0) {
        this.flashlightOn = false;
        this.game.toast?.('The flashlight dies.');
      }
    }
    const want = this.flashlightOn && this.battery > 0;
    // Low batteries stutter. So does his proximity -- `flicker` is written by
    // the Attendant when he is close, and the torch dying in your hand is the
    // only warning you get.
    const drain = this.flicker ?? 0;
    this.flicker = 0;
    const stutter = Math.random() < 0.04 + drain * 0.22 ? 0.12 : 1;
    const flicker = (this.battery < 0.25 && Math.random() < 0.08 ? 0.2 : 1)
      * (drain > 0.01 ? stutter : 1);
    const target = want ? 26 * (0.45 + this.battery * 0.55) * flicker : 0;
    this.flashlight.intensity += (target - this.flashlight.intensity) * Math.min(1, dt * 14);
  }

  toggleFlashlight() {
    if (this.battery <= 0) {
      this.game.toast?.('The batteries are dead.');
      return;
    }
    this.flashlightOn = !this.flashlightOn;
  }

  applyCamera(moving) {
    const bob = moving ? Math.sin(this.bobPhase) * (this.running ? 0.07 : 0.035) : Math.sin(this.bobPhase) * 0.008;
    const sway = moving ? Math.cos(this.bobPhase * 0.5) * 0.015 : 0;

    // Unsteady hands. A slow tremble while frightened, plus hard per-frame
    // jitter on a scare impulse.
    const fear = this.game.fear;
    let shakeX = 0;
    let shakeY = 0;
    let roll = 0;
    if (fear) {
      const calm = this.game.settings?.calm ? 0.25 : 1;
      const tremble = fear.fear * 0.012 * calm;
      const t = performance.now() / 1000;
      shakeX = Math.sin(t * 9.3) * tremble;
      shakeY = Math.sin(t * 11.7) * tremble;
      roll = Math.sin(t * 3.1) * fear.fear * 0.018 * calm;

      const kick = fear.get('shake') * calm;
      if (kick > 0.001) {
        shakeX += (Math.random() - 0.5) * kick * 0.18;
        shakeY += (Math.random() - 0.5) * kick * 0.18;
        roll += (Math.random() - 0.5) * kick * 0.09;
      }
    }

    const view = this.hiding?.view;
    this.camera.position.set(
      this.position.x + sway + shakeX + (view?.x ?? 0),
      this.eyeHeight + bob + shakeY,
      this.position.z + (view?.z ?? 0)
    );
    this.camera.rotation.set(this.pitch + shakeY * 0.6, this.yaw + shakeX * 0.6, roll, 'YXZ');
  }
}
