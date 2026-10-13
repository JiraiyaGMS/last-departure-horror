import * as THREE from 'three';
import { segmentBlocked } from './collision.js';

const GRAVITY = 11.0;
const THROW_SPEED = 10.5;
const THROW_LIFT = 2.4;
const REST_Y = 0.016;

// A coin lands loud enough to pull him off a patrol leg but not so loud that
// it reads as a person. 0.55 puts his hearing radius at ~25m, which covers a
// room and its neighbour.
const LAND_LOUDNESS = 0.55;

// Generous, because a coin lying flat on a dark floor is a 10cm disc seen
// almost edge-on from standing height. The player knows roughly where they
// threw it; they should not have to hunt the pixel.
const PICKUP_RANGE = 1.15;

// Litter cap. Past this the oldest coin is quietly recycled rather than left
// to accumulate draw calls across a four-hour loop.
const MAX_RESTING = 16;

// The thrown coin is the only tool in the station that makes a noise somewhere
// the player is not standing. The jukebox, the PA microphone and the payphone
// are all bolted to one spot the Attendant already knows about; this is
// portable misdirection, and it is bought with ticket money.
//
// Crucially a thrown coin is not destroyed, it is *displaced*. You can have it
// back whenever you like -- by walking to the place you just sent him. That is
// a better cost than losing the coin outright, because it scales with how
// badly you needed the distraction: a panicked throw across the hall costs you
// a long walk through where he now is, and a careful throw into the next room
// costs almost nothing. The player prices it themselves.
export class Throwables {
  constructor(level, game) {
    this.level = level;
    this.game = game;

    this.geo = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 8);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xb8a460, roughness: 0.42, metalness: 0.75, emissive: 0x241e08,
    });

    this.live = [];     // in flight
    this.resting = [];  // landed, recoverable
  }

  // `from` is the eye, not the feet: a coin that spawns at floor level clips
  // through the bench you are standing behind on the first frame.
  throwCoin(from, forward) {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.castShadow = true;
    mesh.position.copy(from);
    this.level.group.add(mesh);

    this.live.push({
      mesh,
      vx: forward.x * THROW_SPEED,
      vy: THROW_LIFT,
      vz: forward.z * THROW_SPEED,
      spin: 14 + Math.random() * 6,
      age: 0,
    });
  }

  // Highest surface under (x, z) that a coin could come to rest on. Walls and
  // tall furniture are excluded by the ceiling test -- the horizontal sweep
  // already stops the coin before it gets inside one of those, so anything
  // still overlapping here is something it is sitting on top of.
  restHeight(x, z) {
    let best = 0;
    for (const c of this.level.colliders) {
      if (c.top > 2.0) continue;
      if (x < c.x1 || x > c.x2 || z < c.z1 || z > c.z2) continue;
      if (c.top > best) best = c.top;
    }
    return best + REST_Y;
  }

  update(dt, player) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      c.age += dt;
      c.vy -= GRAVITY * dt;

      const px = c.mesh.position.x;
      const pz = c.mesh.position.z;
      const nx = px + c.vx * dt;
      const nz = pz + c.vz * dt;

      // Hit a wall in flight: drop the horizontal component and let it fall
      // where it struck. Coins do not ricochet usefully, and a bouncing one
      // would make the landing noise ambiguous about where it came to rest.
      if (segmentBlocked(this.level.colliders, px, pz, nx, nz)) {
        c.vx = 0;
        c.vz = 0;
      } else {
        c.mesh.position.x = nx;
        c.mesh.position.z = nz;
      }

      c.mesh.position.y += c.vy * dt;
      c.mesh.rotation.x += c.spin * dt;
      c.mesh.rotation.z += c.spin * 0.6 * dt;

      const ground = this.restHeight(c.mesh.position.x, c.mesh.position.z);
      if (c.mesh.position.y <= ground || c.age > 6) {
        c.mesh.position.y = ground;
        // A cylinder's discs already face up, so the only thing left to
        // randomise is which way round it settled. Rotating X here would stand
        // the coin on its edge, which is both wrong and nearly invisible.
        c.mesh.rotation.set(0, Math.random() * Math.PI, 0);
        this.live.splice(i, 1);
        this.land(c.mesh);
      }
    }

    if (player && !player.hiding) this.tryRecover(player);
  }

  land(mesh) {
    const { x, z } = mesh.position;

    const em = this.game.audio.makeEmitter(x, z, 26);
    this.game.audio.coinDrop(em.gain);
    this.game.audio.releaseEmitter(em, 1.2);

    this.game.makeNoise(x, z, LAND_LOUDNESS, 'something metal, across the room');

    this.resting.push(mesh);
    while (this.resting.length > MAX_RESTING) {
      const old = this.resting.shift();
      this.level.group.remove(old);
    }
  }

  tryRecover(player) {
    for (let i = this.resting.length - 1; i >= 0; i--) {
      const m = this.resting[i];
      const d = Math.hypot(m.position.x - player.position.x, m.position.z - player.position.z);
      if (d > PICKUP_RANGE) continue;
      this.resting.splice(i, 1);
      this.level.group.remove(m);
      this.game.state.run.coins++;
      this.game.toast(`Picked the coin back up (${this.game.state.run.coins})`);
    }
  }

  // The loop resets the station, and coins you threw last night are not on the
  // floor tonight.
  clear() {
    for (const c of this.live) this.level.group.remove(c.mesh);
    for (const m of this.resting) this.level.group.remove(m);
    this.live.length = 0;
    this.resting.length = 0;
  }
}
