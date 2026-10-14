import * as THREE from 'three';
import { makeFigure, randomPose } from './figures.js';
import { segmentBlocked } from './collision.js';

// The presence layer. None of this is the Attendant -- he is a real agent with
// a position and a pathfinder. This is the stuff that is only ever a shape:
// a figure at the far end of a corridor that is gone when you look straight at
// it, a face for three frames in the dark, something standing at a camera lens
// in a room you are not in.
//
// Every effect here is non-lethal and unprovable. That is what makes the real
// one work: by the time he is actually behind you, you have taught yourself to
// dismiss exactly this.

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, 96, 96);

  // The head is larger than the frame and off to one side -- it is cropped,
  // the way something is cropped when it is already touching the lens. Never
  // draw the whole oval: an oval that fits on screen reads as a mask.
  const g = ctx.createRadialGradient(34, 26, 3, 42, 50, 58);
  g.addColorStop(0, '#9c9484');
  g.addColorStop(0.35, '#5d5850');
  g.addColorStop(0.72, '#15181b');
  g.addColorStop(1, '#04060a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(42, 58, 48, 66, 0.07, 0, Math.PI * 2);
  ctx.fill();

  // Sockets: tall, deep, and not level with each other.
  ctx.fillStyle = '#020408';
  ctx.beginPath();
  ctx.ellipse(27, 36, 6, 11.5, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(58, 42, 7, 14, -0.1, 0, Math.PI * 2);
  ctx.fill();
  // Wet highlights, deep in and looking slightly off-axis. Not a matched pair.
  ctx.fillStyle = 'rgba(226,238,232,0.85)';
  ctx.fillRect(29, 37, 2, 2);
  ctx.fillStyle = 'rgba(226,238,232,0.5)';
  ctx.fillRect(55, 45, 2, 1);

  // Brow and cheekbone: hard edges where a face should curve.
  ctx.fillStyle = 'rgba(5,7,11,0.6)';
  ctx.beginPath();
  ctx.moveTo(10, 22); ctx.lineTo(44, 17); ctx.lineTo(72, 27); ctx.lineTo(70, 20);
  ctx.lineTo(40, 8); ctx.lineTo(8, 14); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(74, 48); ctx.lineTo(62, 64); ctx.lineTo(78, 82); ctx.lineTo(90, 60); ctx.closePath();
  ctx.fill();

  // Nose: a ridge and two slits, no tip.
  ctx.fillStyle = 'rgba(7,9,13,0.5)';
  ctx.fillRect(41, 42, 3, 20);
  ctx.fillStyle = '#04060a';
  ctx.fillRect(37, 61, 3, 2);
  ctx.fillRect(46, 62, 3, 2);

  // Mouth: open, far too wide, and running off the bottom of the frame.
  ctx.fillStyle = '#010305';
  ctx.beginPath();
  ctx.moveTo(14, 76);
  ctx.quadraticCurveTo(44, 70, 72, 79);
  ctx.quadraticCurveTo(46, 99, 16, 86);
  ctx.closePath();
  ctx.fill();

  // Everything below the jaw is simply absent.
  const fade = ctx.createLinearGradient(0, 84, 0, 96);
  fade.addColorStop(0, 'rgba(4,6,10,0)');
  fade.addColorStop(1, 'rgba(4,6,10,0.95)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 84, 96, 12);

  // Scanline break-up so it reads as something captured, not something present.
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (let y = 0; y < 96; y += 3) ctx.fillRect(0, y, 96, 1);
  // One dropped field, as if the frame did not finish.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 54, 96, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

export class Presence {
  constructor(game) {
    this.game = game;
    this.level = game.level;

    this.buildFace();
    this.buildFigure();
    this.buildThing();
    this.buildHaunts();

    this.faceFrames = 0;
    this.faceHold = 0;
    this.glimpseLife = 0;
    this.cctvStare = null;
    this.cctvTimer = 40;
    this.mirrorTimer = 55;
    this.mirrorLife = 0;
    this.hauntTimer = 50;
  }

  // Things in the station that are only ever different, never seen changing.
  // Each one applies itself while out of sight, waits to be noticed, and puts
  // itself back the moment you look away again -- so going to fetch a second
  // look never confirms anything.
  buildHaunts() {
    const g = this.game;
    this.haunts = [
      {
        id: 'payphone',
        at: () => g.refs.payphone?.position,
        can: () => !!g.refs.payphone && !g.refs.payphone.offHook,
        apply: () => g.refs.payphone.setOffHook(true),
        revert: () => { if (g.refs.payphone.offHook) g.refs.payphone.setOffHook(false); },
        line: 'The payphone receiver is swinging. Nobody has been near it.',
      },
      {
        id: 'plant',
        at: () => g.refs.plant?.position,
        can: () => !!g.refs.plant && !this.plantDown,
        apply: () => {
          this.plantDown = true;
          g.refs.plant.knockOver();
        },
        revert: () => {
          this.plantDown = false;
          g.refs.plant.restore();
        },
        line: 'The dead plant is lying on its side.',
      },
      {
        id: 'board',
        at: () => g.boardMesh?.position,
        can: () => !this.boardWrong,
        apply: () => {
          this.boardWrong = true;
          // Every service, every bay, the same departure. Including yours.
          g.boardRows = g.boardRows.map((r) => ({
            ...r, dest: 'LAST DEPARTURE', bay: 9, status: '3:33 AM',
          }));
          g.refs.board?.redraw();
          g.audio.splitFlap(18, g.boardEmitter?.gain);
        },
        revert: () => {
          this.boardWrong = false;
          // Rebuilt from the timetable rather than restored from a copy: a
          // copy taken before 3:25 would undo BAY 9 -- NOW BOARDING.
          g.boardRows = g.baseBoardRows();
          g.refs.board?.redraw();
        },
        line: 'Every row on the board reads the same. Every bay reads 9.',
      },
    ];
    this.activeHaunt = null;
  }

  // A plane parented to the camera, so the face goes through the entire post
  // pipeline -- aberration, grain, bloom. A DOM overlay would read as a jpeg
  // pasted over the game; this reads as something the camera actually saw.
  buildFace() {
    const h = 0.42;
    // Sized against the live camera aspect and kept in sync on resize, so the
    // face fills the frame the same way on any window.
    const geo = new THREE.PlaneGeometry(h * (this.game.camera.aspect || 1.777), h);
    this.faceMat = new THREE.MeshBasicMaterial({
      map: faceTexture(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // Unaffected by tonemapping would be wrong here: the face should sit in
      // the same exposure as the room it is interrupting.
      toneMapped: true,
      opacity: 1,
    });
    this.faceMesh = new THREE.Mesh(geo, this.faceMat);
    this.faceMesh.position.set(0, 0, -0.32);
    this.faceMesh.renderOrder = 999;
    this.faceMesh.visible = false;
    this.game.camera.add(this.faceMesh);
  }

  // The window changed shape; the face has to change with it.
  resizeFace(aspect) {
    if (!this.faceMesh) return;
    const h = 0.42;
    this.faceMesh.geometry.dispose();
    this.faceMesh.geometry = new THREE.PlaneGeometry(h * aspect, h);
  }

  // The thing from camera 4. It is not the Attendant and it does not use the
  // doors. Between frames it is simply nearer -- and only ever between frames.
  buildThing() {
    this.thing = makeFigure({
      coat: 0x0b0e12,
      skin: 0x14171c,
      height: 2.35,
      emissive: 0x1d242e,
      gaunt: true,
      eyes: true,
    });
    // Too tall and too narrow, which the eye reads before the brain does.
    this.thing.scale.set(0.72, 1.12, 0.72);
    this.thing.visible = false;
    this.game.scene.add(this.thing);
    this.thingState = 'off';
    this.thingHidden = 0;
    this.thingTimer = 30;
  }

  updateThing(dt, player) {
    // It only exists once the cameras have admitted it exists.
    if (!this.game.camera4Active || this.thingDone) {
      if (this.thing.visible) this.thing.visible = false;
      return;
    }

    if (this.thingState === 'off') {
      this.thingTimer -= dt;
      if (this.thingTimer > 0) return;
      const spot = this.pickSpotFar(player, 22, 44);
      if (!spot) { this.thingTimer = 8; return; }
      this.thing.position.set(spot.x, 0, spot.z);
      this.thing.visible = true;
      this.thingState = 'stalking';
      this.thingHidden = 0;
      return;
    }

    const dx = this.thing.position.x - player.position.x;
    const dz = this.thing.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    this.thing.rotation.y = Math.atan2(dx, dz);

    const watched = this.canSee(player, this.thing.position.x, this.thing.position.z, 0.6, 46);
    if (watched) {
      // Dead still, and the room gets heavier the longer you hold the look.
      this.thingHidden = 0;
      this.game.fear.wantFear(Math.min(0.95, 0.4 + (1 - Math.min(1, dist / 30)) * 0.55));
      this.game.fear.wantTension(0.9);
      return;
    }

    // Long enough between jumps that the approach is a sequence of glimpses
    // rather than a pounce. Keeping your eyes on it genuinely holds it off,
    // which is the only reason freezing it is frightening instead of a gimmick.
    this.thingHidden += dt;
    if (this.thingHidden < 0.85) return;
    this.thingHidden = 0;

    // A jump, not a walk. Always directly toward you, always through whatever
    // is in between.
    const step = Math.min(dist - 1.2, 1.8 + Math.random() * 2.2);
    if (step > 0) {
      this.thing.position.x -= (dx / dist) * step;
      this.thing.position.z -= (dz / dist) * step;
      this.game.audio.blip({ freq: 44 + Math.random() * 10, type: 'sine', dur: 0.26, vol: 0.12 });
    }

    if (dist - step < 2.4) {
      // It arrives, and then it is simply not there, and the night goes on.
      this.flashFace(5);
      this.game.fear.jolt(1.3);
      this.game.fear.kick('red', 0.5);
      this.game.audio.deafen(3);
      this.game.subtitle('It is close enough to touch, and then it is not there at all.', 4.5);
      this.game.note('Camera 4', 'The thing on camera 4 can cross the station while you blink. It did not touch you.');
      this.thing.visible = false;
      this.thingDone = true;
    }
  }

  pickSpotFar(player, minDist, maxDist) {
    const options = [];
    for (const [, p] of Object.entries(this.level.nav.nodes)) {
      const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
      if (d < minDist || d > maxDist) continue;
      options.push({ x: p.x, z: p.z });
    }
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }

  buildFigure() {
    // Lit by nothing in the room, which is why he reads at thirty metres down
    // an unlit corridor and why he looks wrong. His build, his cap, his eyes:
    // close enough to be him that you cannot be sure it was not.
    this.figure = makeFigure({
      coat: 0x171c22,
      skin: 0x2a2520,
      cap: 0x111519,
      height: 1.98,
      emissive: 0x2e3742,
      gaunt: true,
      eyes: true,
    });
    this.figure.visible = false;
    this.game.scene.add(this.figure);
  }

  reset() {
    if (this.activeHaunt) this.activeHaunt.h.revert();
    this.activeHaunt = null;
    this.hauntTimer = 50;
    this.thing.visible = false;
    this.thingState = 'off';
    this.thingDone = false;
    this.thingTimer = 30;
    this.faceFrames = 0;
    this.faceHold = 0;
    this.faceMesh.visible = false;
    this.glimpseLife = 0;
    this.figure.visible = false;
    this.cctvStare = null;
    this.cctvTimer = 40;
    this.mirrorTimer = 55;
    this.mirrorLife = 0;
    this.game.mirrorFigure = null;
  }

  // ---- effects -----------------------------------------------------------

  // Three frames of a face, filling the screen. Short enough that the player
  // is never sure they saw it, long enough that they stop moving.
  flashFace(frames = 3, hold = 0) {
    if (this.faceFrames > 0 || this.faceHold > 0) return;
    this.faceFrames = frames;
    this.faceHold = hold;
    this.faceMat.opacity = 0.92;
    this.faceMesh.visible = true;
    this.game.fear.kick('face', 1);
    this.game.fear.kick('static', 0.9);
    this.game.fear.kick('aberration', 1.6);
    this.game.fear.kick('shake', 0.5);
    this.game.fear.wantFear(0.85);
    this.game.audio.stinger();
    this.game.audio.deafen(1.4);
  }

  // A figure at the edge of vision that cannot survive being looked at.
  glimpse() {
    if (this.glimpseLife > 0) return false;
    const player = this.game.player;
    const spot = this.pickGlimpseSpot(player);
    if (!spot) return false;

    this.figure.position.set(spot.x, 0, spot.z);
    // Facing the player, always. He is not passing through; he stopped to look.
    // (Figures face -z, so this is the same yaw the passengers use.)
    const dx = player.position.x - spot.x;
    const dz = player.position.z - spot.z;
    this.figure.rotation.y = Math.atan2(-dx, -dz);
    randomPose(this.figure);
    this.figure.visible = true;
    this.glimpseLife = 7;
    this.glimpseSeen = false;
    this.game.fear.wantTension(0.55);
    return true;
  }

  // In FOV but off to the side, far away, with a clear line of sight. Doorways
  // are preferred: a shape framed by a doorway reads instantly.
  pickGlimpseSpot(player) {
    const nodes = Object.entries(this.level.nav.nodes);
    const options = [];
    for (const [id, p] of nodes) {
      const dx = p.x - player.position.x;
      const dz = p.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 11 || dist > 34) continue;
      const toIt = Math.atan2(-dx, -dz);
      const diff = Math.abs(((toIt - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      // Peripheral: inside the frame, but not where the player is looking.
      if (diff > 0.62 || diff < 0.16) continue;
      if (segmentBlocked(this.level.colliders, player.position.x, player.position.z, p.x, p.z)) continue;
      options.push({ id, x: p.x, z: p.z, dist, door: id.startsWith('d_') });
    }
    if (!options.length) return null;
    const doors = options.filter((o) => o.door);
    const pool = doors.length && Math.random() < 0.7 ? doors : options;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Something is standing at a camera, facing the lens, in a room you are not
  // in. The monitors are supposed to be the safe way to look.
  cctvHaunt(seconds = 22) {
    const playerRoom = this.game.currentRoom;
    const rooms = ['hall', 'baggage', 'bays', 'tunnel'];
    const choices = [0, 1, 2, 3].filter((i) => rooms[i] !== playerRoom);
    const cam = choices[Math.floor(Math.random() * choices.length)];
    this.cctvStare = {
      cam,
      variant: Math.random() < 0.5 ? 1 : 2,
      until: seconds,
    };
    this.game.cameraViews = this.game.describeCameras();
    this.game.refs?.monitors?.redraw();
  }

  mirrorHaunt(seconds = 14, opts = {}) {
    this.game.mirrorFigure = {
      at: opts.at ?? 0.58 + Math.random() * 0.24,
      scale: opts.scale ?? 0.88 + Math.random() * 0.14,
      tilt: opts.tilt ?? (Math.random() < 0.4 ? (Math.random() - 0.5) * 1.1 : 0),
      eyes: opts.eyes ?? Math.random() < 0.35,
      alpha: opts.alpha ?? 0.85,
    };
    this.mirrorLife = seconds;
    this.game.refs?.mirror?.redraw();
  }

  // Is this point inside the player's frame, with nothing in the way? The same
  // predicate the Attendant freezes on, so "looked at" means one consistent
  // thing everywhere in the game.
  canSee(player, x, z, fov = 0.52, maxDist = 30) {
    if (player.hiding) return false;
    const dx = x - player.position.x;
    const dz = z - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist) return false;
    const toIt = Math.atan2(-dx, -dz);
    const diff = Math.abs(((toIt - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > fov) return false;
    // Stop the ray just short of the target: props sit inside their own
    // blockers, and a prop must not occlude itself.
    const back = Math.min(0.8, dist * 0.5) / dist;
    return !segmentBlocked(
      this.level.colliders,
      player.position.x, player.position.z,
      x - dx * back, z - dz * back
    );
  }

  updateHaunts(dt, player) {
    const active = this.activeHaunt;
    if (active) {
      const at = active.h.at();
      const seen = at && this.canSee(player, at.x, at.z, 0.45, 18);
      if (!active.noticed && seen) {
        active.noticed = true;
        active.revertIn = 6;
        this.game.subtitle(active.h.line, 4);
        this.game.fear.kick('aberration', 0.8);
        this.game.fear.wantFear(0.5);
        this.game.fear.wantTension(0.6);
      }
      if (active.noticed) {
        active.revertIn -= dt;
        // Put it back only once you are no longer looking, so you can never
        // catch the moment it changes.
        if (active.revertIn <= 0 && !seen) {
          active.h.revert();
          this.activeHaunt = null;
          this.hauntTimer = 45 + Math.random() * 50;
        }
      } else {
        // Never noticed? It quietly undoes itself and tries again later.
        active.life -= dt;
        if (active.life <= 0 && !seen) {
          active.h.revert();
          this.activeHaunt = null;
          this.hauntTimer = 30 + Math.random() * 40;
        }
      }
      return;
    }

    this.hauntTimer -= dt;
    if (this.hauntTimer > 0) return;
    this.hauntTimer = 20;

    const options = this.haunts.filter((h) => {
      if (!h.can()) return false;
      const at = h.at();
      if (!at) return false;
      const dist = Math.hypot(at.x - player.position.x, at.z - player.position.z);
      // Close enough that the player will plausibly walk back past it, but not
      // currently in frame.
      return dist < 34 && !this.canSee(player, at.x, at.z, 0.7, 34);
    });
    if (!options.length) return;
    const h = options[Math.floor(Math.random() * options.length)];
    h.apply();
    this.activeHaunt = { h, noticed: false, life: 150, revertIn: 0 };
  }

  // ---- per-frame ---------------------------------------------------------

  // Face frames are counted in frames, not seconds. At 60fps three frames is
  // 50ms: seen, but impossible to study. Ticked outside the frozen check so a
  // flash can never get stranded on screen by a modal or the loop reset.
  tickFace(dt) {
    if (this.faceHold > 0) {
      this.faceHold -= dt;
      if (this.faceHold > 0) return;
    }
    if (this.faceFrames > 0) {
      this.faceFrames--;
      if (this.faceFrames <= 0) this.faceMesh.visible = false;
    } else if (this.faceMesh.visible && this.faceHold <= 0) {
      this.faceMesh.visible = false;
    }
  }

  update(dt, player, t) {
    this.updateGlimpse(dt, player);
    this.updateHaunts(dt, player);
    this.updateThing(dt, player);

    if (this.cctvStare) {
      this.cctvStare.until -= dt;
      if (this.cctvStare.until <= 0) {
        this.cctvStare = null;
        this.game.cameraViews = this.game.describeCameras();
        this.game.refs?.monitors?.redraw();
      }
    }

    if (this.mirrorLife > 0) {
      this.mirrorLife -= dt;
      if (this.mirrorLife <= 0) {
        this.game.mirrorFigure = null;
        this.game.refs?.mirror?.redraw();
      }
    }

    // Both of the panel hauntings schedule themselves, tightening with the
    // night, so looking at a screen is never the safe move.
    const squeeze = 1 - this.game.clock.progress * 0.6;
    this.cctvTimer -= dt;
    if (this.cctvTimer <= 0) {
      this.cctvTimer = (50 + Math.random() * 70) * squeeze;
      if (this.game.clock.progress > 0.2 && !this.cctvStare) this.cctvHaunt();
    }
    this.mirrorTimer -= dt;
    if (this.mirrorTimer <= 0) {
      this.mirrorTimer = (60 + Math.random() * 80) * squeeze;
      if (this.game.clock.progress > 0.15 && this.mirrorLife <= 0) this.mirrorHaunt();
    }
  }

  updateGlimpse(dt, player) {
    if (this.glimpseLife <= 0) return;
    this.glimpseLife -= dt;

    const dx = this.figure.position.x - player.position.x;
    const dz = this.figure.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    const toIt = Math.atan2(-dx, -dz);
    const diff = Math.abs(((toIt - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

    // Pressure while he is in frame, scaled by how near the centre of vision
    // he is -- you can feel it before you have identified it.
    this.game.fear.wantFear(0.3 + (1 - Math.min(1, diff / 0.7)) * 0.35);

    // Looked at directly, or approached: gone, between frames, with no sound
    // of leaving.
    const centred = diff < 0.17;
    const close = dist < 9;
    if (centred || close || this.glimpseLife <= 0) {
      this.figure.visible = false;
      this.glimpseLife = 0;
      if (centred || close) {
        this.game.fear.kick('aberration', 1.3);
        this.game.fear.kick('distort', 0.5);
        this.game.fear.wantFear(0.7);
        this.game.audio.whisper(0, 0.45);
        if (!this.glimpseSeen) {
          this.glimpseSeen = true;
          this.game.subtitle('There is nobody there. There was nobody there.', 3);
        }
      }
    }
  }
}
