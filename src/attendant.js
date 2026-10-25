import * as THREE from 'three';
import { makeFigure, animateWalk, idleSway, randomPose, clearPose, twitch, lookAt } from './figures.js';
import { segmentBlocked } from './collision.js';
import { addCapAndEyes } from './people.js';

const SPEED_PATROL = 1.55;
const SPEED_INVESTIGATE = 1.9;
const SPEED_HUNT = 2.15;   // Slower than a sprint. He does not need to run.

// How far into the player's view he counts as "being looked at". Generous on
// purpose: he should freeze while still in your peripheral vision, so you are
// never quite sure whether you caught him moving.
const OBSERVED_FOV = Math.PI * 0.42;
const OBSERVED_RANGE = 26;

// The player wakes on a bench in the hall, which is on his first patrol leg.
// Without this he walks into them before the loop has taught them anything.
const GRACE_SECONDS = 30;

const SIGHT_RANGE = 15;
const SIGHT_FOV = Math.PI * 0.42;
const BEAM_RANGE = 28;
const CATCH_RANGE = 1.3;

// Rooms he will not enter unless the player has opened them.
const GATED_NODES = {
  managerDoor: ['d_manager', 'manager_c'],
  tunnelDoor: ['d_tunnel', 'tunnel_c', 'd_bay0', 'bay0_c'],
};

const PATROLS = [
  { until: '01:00', route: ['hall_c', 'ticket_c', 'hall_c', 'diner_c', 'hall_c', 'rest_c'] },
  { until: '02:00', route: ['hall_c', 'bag_c', 'bag_e', 'bag_c', 'hall_c', 'cctv_c', 'lost_c'] },
  { until: '03:00', route: ['hall_c', 'bay_c', 'bay_w', 'bay_c', 'hall_c', 'rest_c', 'bag_c'] },
];

export class Attendant {
  constructor(level, game) {
    this.level = level;
    this.game = game;

    // Uniform coat and cap, skin the colour of something kept out of the
    // light, and a body pulled a size too long in every direction.
    this.figure = makeFigure({
      coat: 0x26323b,
      trousers: 0x161c21,
      skin: 0x5d6158,
      cap: 0x1b2730,
      height: 2.02,
      gaunt: true,
      eyes: true,
    });
    // Then the real body over it: an old man in a dark suit, tall and thin
    // enough that he never quite looks like he fits in it.
    game.people?.dress(this.figure, 'attendant', 'person', {
      skin: 0xc2cac0,
      onDressed: (d) => addCapAndEyes(d),
    });
    this.figure.position.set(0, 0, -16);
    level.group.add(this.figure);

    this.position = new THREE.Vector3(0, 0, -16);
    this.facing = 0;
    this.state = 'patrol';
    this.speed = 0;

    this.path = [];
    this.pathIndex = 0;
    this.patrolIndex = 0;
    this.target = null;
    this.investigateTarget = null;
    this.investigateTimer = 0;
    this.lostTimer = 0;
    this.stareTimer = 0;
    this.lingerAt = null;

    this.keyTimer = 0;
    this.emitter = null;
    this.visible = true;
    this.grace = GRACE_SECONDS * this.diff.grace;
    this.urgency = 1;
    this.frozen = false;
    this.freezeTime = 0;
    this.legsWalked = 0;
    this.lastSeenByPlayer = false;
  }

  // The difficulty setting's multipliers (settings.js DIFFICULTY).
  get diff() {
    return this.game.settings?.diff ?? { speed: 1, sight: 1, hearing: 1, grace: 1, breath: 1 };
  }

  attachAudio(audio) {
    this.emitter = audio.makeEmitter(this.position.x, this.position.z, 30);
    this.emitter.volume = 0.9;
  }

  reset() {
    this.position.set(0, 0, -16);
    this.figure.position.copy(this.position);
    this.facing = 0;
    this.speed = 0;
    this.state = 'patrol';
    this.path = [];
    this.pathIndex = 0;
    this.patrolIndex = 0;
    this.target = null;
    this.investigateTarget = null;
    this.investigateTimer = 0;
    this.lostTimer = 0;
    this.lingerAt = null;
    this.grace = GRACE_SECONDS * this.diff.grace;
    // Everything else that carries over a catch. `stareTimer` in particular:
    // caught for breathing, it stayed past the threshold, and the next night
    // the first breath in any hiding place near him was an instant catch.
    this.stareTimer = 0;
    this.legsWalked = 0;
    this.lastSeenByPlayer = false;
    this.urgency = 1;
    if (this.frozen) clearPose(this.figure);
    this.frozen = false;
    this.freezeTime = 0;
  }

  blockedNodes() {
    const blocked = new Set();
    for (const [key, nodes] of Object.entries(GATED_NODES)) {
      if (this.level.isLocked(key)) {
        for (const n of nodes) blocked.add(n);
      }
    }
    return blocked;
  }

  currentPatrol(clock) {
    for (const p of PATROLS) {
      if (!clock.isAfter(p.until)) return p.route;
    }
    return null; // after 3:00 he waits at Bay 9
  }

  setDestination(nodeId) {
    const blocked = this.blockedNodes();
    const from = this.level.nearestNode(this.position, blocked);
    const path = this.level.findPath(from, nodeId, blocked);
    if (!path) return false;
    this.path = path.map((id) => this.level.nav.nodes[id]);
    this.pathIndex = 0;
    this.target = nodeId;
    return true;
  }

  // Walks toward a world point, ignoring the graph. Used for the last few
  // metres once he can see you.
  steerTo(point, speed, dt) {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const step = Math.min(dist, speed * dt);
    this.position.x += (dx / dist) * step;
    this.position.z += (dz / dist) * step;
    this.facing = Math.atan2(-dx, -dz);
    this.speed = speed;
    return dist < 0.4;
  }

  followPath(speed, dt) {
    if (this.pathIndex >= this.path.length) return true;
    const node = this.path[this.pathIndex];
    if (this.steerTo(node, speed, dt)) this.pathIndex++;
    return this.pathIndex >= this.path.length;
  }

  // Is the PLAYER currently looking at HIM? This is the hinge the whole
  // stalker behaviour turns on, and it needs light as well as line of sight:
  // in a dark room you can be staring straight at him and not see a thing,
  // which means he is free to move.
  isObserved(player) {
    if (player.hiding) return false;
    const dx = this.position.x - player.position.x;
    const dz = this.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > OBSERVED_RANGE) return false;

    // Within arm's reach you can always tell he is there.
    if (dist < 1.4) return true;

    const toHim = Math.atan2(-dx, -dz);
    const diff = Math.abs(((toHim - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > OBSERVED_FOV) return false;

    if (segmentBlocked(
      this.level.colliders,
      player.position.x, player.position.z,
      this.position.x, this.position.z
    )) return false;

    // He has to actually be lit to be seen. The flashlight counts only if he
    // is inside its cone.
    if (player.flashlightOn && player.battery > 0 && dist < 20 && diff < Math.PI / 7) return true;
    return this.litness() > 0.18;
  }

  // Roughly how well the room lighting picks a point out, 0..1.
  litnessAt(x, z) {
    let best = 0;
    for (const l of this.level.lights) {
      if (l.broken || !l.light.visible) continue;
      const d = Math.hypot(l.light.position.x - x, l.light.position.z - z);
      const reach = (l.light.distance || 14) * 0.75;
      if (d > reach) continue;
      best = Math.max(best, (1 - d / reach) * Math.min(1, l.light.intensity / Math.max(0.001, l.base)));
    }
    return best;
  }

  litness() {
    return this.litnessAt(this.position.x, this.position.z);
  }

  // The same measure taken at the player. Their own torch counts: it is the
  // brightest thing in the building and it bounces off every surface in front
  // of them, so carrying it lit is carrying a lamp.
  playerLitness(player) {
    const best = this.litnessAt(player.position.x, player.position.z);
    if (player.flashlightOn && player.battery > 0) return Math.max(best, 0.88);
    return best;
  }

  // How far he can pick the player out of a room, in metres.
  //
  // This is the change that makes darkness a tool instead of a mood. Sight
  // used to be pure geometry, so a dead room was no safer than a lit one and
  // the only counterplay was a hide spot.
  //
  // Measured, standing still: 11.5m under a working hall fixture, 10.2m out in
  // the middle of the lit hall, 7.3m crouched there, 3.9m in a blacked-out
  // room and 2.8m crouched in one. Four metres is still close enough that he
  // blunders into you, so the dark is cover rather than a cloak. And it prices
  // the flashlight honestly at 14.3m in any room whatsoever -- the thing that
  // lets you see is the thing that shows you, on top of the beam he can
  // already spot from twenty-eight metres away.
  sightRange(player) {
    // Square-rooted, not linear. `litnessAt` measures distance to the nearest
    // fixture, so the middle of a well-lit room -- equidistant from all of
    // them -- scores about 0.3 and would otherwise cut his reach in the main
    // hall from fifteen metres to seven. Perceived brightness is a power law
    // rather than a falloff product anyway: what this should model is how
    // plainly lit a space reads, and a room with its lights on reads lit
    // whether or not you are standing directly under a tube.
    const lit = Math.sqrt(this.playerLitness(player));
    let range = SIGHT_RANGE * this.diff.sight * (0.26 + 0.74 * lit);
    if (player.crouching) range *= 0.72;
    // Movement catches the eye, and a sprint is not subtle in any light.
    if (player.running) range *= 1.18;
    // Once he is actually hunting he is looking rather than walking a route.
    // Without this he loses you the instant you back two metres into the dark,
    // and a hunt becomes something you end by standing still.
    if (this.state === 'hunt') range *= 1.5;
    return range;
  }

  canSee(player) {
    if (player.hiding) return false;
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.sightRange(player)) return false;
    const toPlayer = Math.atan2(-dx, -dz);
    let diff = Math.abs(((toPlayer - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > SIGHT_FOV) return false;
    return !segmentBlocked(
      this.level.colliders,
      this.position.x, this.position.z,
      player.position.x, player.position.z
    );
  }

  // The flashlight is visible far beyond his own eyeline. Obeying the false
  // rule about keeping it lit is what gets most people caught.
  seesBeam(player) {
    if (!player.flashlightOn || player.hiding) return false;
    const dist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (dist > BEAM_RANGE) return false;
    return !segmentBlocked(
      this.level.colliders,
      this.position.x, this.position.z,
      player.position.x, player.position.z
    );
  }

  hear(x, z, loudness, label) {
    const dist = Math.hypot(x - this.position.x, z - this.position.z);
    const radius = (6 + loudness * 34) * this.diff.hearing;
    if (dist > radius) return false;
    if (this.state === 'hunt') return false;
    // From 3:00 he is at Bay 9 and nothing will move him off it.
    if (this.state === 'wait') return false;
    // While a record is playing the whole hall is deaf, him included.
    if (this.game.jukeboxDeafens?.()) return false;
    this.investigateTarget = new THREE.Vector3(x, 0, z);
    this.investigateTimer = 0;
    this.state = 'investigate';
    const blocked = this.blockedNodes();
    const from = this.level.nearestNode(this.position, blocked);
    const to = this.level.nearestNode(this.investigateTarget, blocked);
    const path = this.level.findPath(from, to, blocked);
    if (path) {
      this.path = path.map((id) => this.level.nav.nodes[id]);
      this.path.push(this.investigateTarget.clone());
      this.pathIndex = 0;
    }
    this.game.onAttendantAlerted?.(label, loudness);
    return true;
  }

  // Called by the PA microphone: he goes and checks, and stays a while.
  lureTo(nodeId) {
    if (this.state === 'wait') return false;
    const blocked = this.blockedNodes();
    const from = this.level.nearestNode(this.position, blocked);
    const path = this.level.findPath(from, nodeId, blocked);
    if (!path) return false;
    this.path = path.map((id) => this.level.nav.nodes[id]);
    this.pathIndex = 0;
    this.state = 'investigate';
    this.investigateTarget = this.level.nav.nodes[nodeId].clone();
    this.investigateTimer = -12; // lingers much longer than a normal check
    return true;
  }

  // Picks a spot the player cannot currently see and puts him there. Used
  // between patrol legs so his position is never something you can memorise.
  relocateUnseen(player, minDist = 6, maxDist = 15) {
    const blocked = this.blockedNodes();
    const ids = Object.keys(this.level.nav.nodes).filter((id) => !blocked.has(id));
    const candidates = [];
    for (const id of ids) {
      const n = this.level.nav.nodes[id];
      const d = Math.hypot(n.x - player.position.x, n.z - player.position.z);
      if (d < minDist || d > maxDist) continue;
      // Must be out of sight: either behind a wall, or behind the player.
      const occluded = segmentBlocked(
        this.level.colliders, player.position.x, player.position.z, n.x, n.z
      );
      const toNode = Math.atan2(-(n.x - player.position.x), -(n.z - player.position.z));
      const diff = Math.abs(((toNode - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (occluded || diff > Math.PI * 0.55) candidates.push({ id, n });
    }
    if (!candidates.length) return false;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this.position.set(pick.n.x, 0, pick.n.z);
    this.figure.position.copy(this.position);
    this.path = [];
    this.pathIndex = 0;
    return true;
  }

  startHunt(player) {
    if (this.state !== 'hunt') this.game.onHuntStart?.();
    this.state = 'hunt';
    this.lostTimer = 0;
    this.path = [];
  }

  update(dt, player, clock) {
    this.speed = 0;
    this.grace = Math.max(0, this.grace - dt);
    const afterThree = clock.isAfter('03:00');

    if (afterThree && this.state !== 'hunt') this.state = 'wait';

    // He moves faster the later it gets. By 3am he is noticeably quicker than
    // you remember him being at midnight.
    this.urgency = (1 + clock.progress * 0.42) * this.diff.speed;

    // The mannequin rule: while you are looking at him he does not move. Look
    // away for even a moment and he has closed the distance and is standing in
    // a different shape. He never moves on screen, so you can never prove it.
    const observed = this.grace <= 0 && this.isObserved(player);
    this.lastSeenByPlayer = observed;

    if (observed) {
      if (!this.frozen) {
        this.frozen = true;
        randomPose(this.figure);
        // He turns to face you, every time.
        const dx = player.position.x - this.position.x;
        const dz = player.position.z - this.position.z;
        this.facing = Math.atan2(-dx, -dz);
      }
      twitch(this.figure, dt);
      this.freezeTime = (this.freezeTime ?? 0) + dt;
      // Being stared at is itself frightening, more so the closer he is.
      const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
      this.game.fear?.wantFear(Math.min(0.85, 0.25 + (1 - Math.min(1, d / 22)) * 0.6));
      this.eatLight(player, d);
      // Frozen means frozen: no pathing, no steering, no footsteps.
      this.updateCatch(dt, player);
      this.updateBody(dt);
      return;
    }

    if (this.frozen) {
      this.frozen = false;
      this.freezeTime = 0;
      clearPose(this.figure);
    }

    switch (this.state) {
      case 'patrol': this.updatePatrol(dt, clock, player); break;
      case 'investigate': this.updateInvestigate(dt, player); break;
      case 'hunt': this.updateHunt(dt, player); break;
      case 'wait': this.updateWait(dt, player, clock); break;
    }

    // Perception. He never perceives you through a wall.
    if (this.state !== 'wait' && this.grace <= 0) {
      if (this.canSee(player)) {
        this.startHunt(player);
      } else if (this.seesBeam(player) && this.state !== 'hunt') {
        this.hear(player.position.x, player.position.z, 0.5, 'your flashlight');
      }
    }

    this.updateCatch(dt, player);
    this.updateBody(dt);
  }

  // Standing too close to a working bulb while he is near makes it stutter.
  // The light failing is the warning that he is behind you.
  eatLight(player, dist) {
    if (dist > 9) return;
    const amount = (9 - dist) / 7;
    this.game.attendantLightDrain = Math.max(this.game.attendantLightDrain ?? 0, amount);
    if (player.flashlightOn) player.flicker = Math.max(player.flicker ?? 0, amount);
  }

  updateCatch(dt, player) {
    const dist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (this.grace > 0) return;
    // Waiting at Bay 9 he is a conductor, not a hunter: a passenger with a
    // valid ticket can walk right up to him. Before, brushing past him on the
    // way to the bus door was a catch even with the ticket in your hand.
    if (this.state === 'wait' && this.game.ticketIsBoardable()) {
      this.stareTimer = 0;
      return;
    }
    if (player.hiding) {
      const spot = player.hiding;
      if (dist < 2.6 && !player.holdingBreath && this.state !== 'patrol') {
        this.stareTimer += dt;
        this.game.fear?.wantFear(0.9);
        if (this.stareTimer > 1.6) this.game.onCaught('He heard you breathing.');
      } else if (dist < 1.0 && this.state === 'hunt' && spot.quality < 0.9) {
        this.stareTimer += dt;
        this.game.fear?.wantFear(0.95);
        if (this.stareTimer > 2.2) this.game.onCaught('He found you.');
      } else {
        this.stareTimer = Math.max(0, this.stareTimer - dt * 0.5);
      }
    } else if (dist < CATCH_RANGE) {
      this.game.onCaught('He punches your ticket.');
    }
  }

  updateBody(dt) {
    // Keys. The tell: when the jingling stops, he has stopped moving.
    this.figure.position.set(this.position.x, 0, this.position.z);
    this.figure.rotation.y = this.facing;
    if (this.speed > 0.1) {
      animateWalk(this.figure, this.speed, dt);
      this.keyTimer -= dt;
      if (this.keyTimer <= 0) {
        this.keyTimer = 0.42 + Math.random() * 0.25;
        this.game.audio.keyJingle(this.emitter?.gain);
      }
    } else if (!this.frozen) {
      idleSway(this.figure, performance.now() / 1000);
    }

    const player = this.game.player;
    const dist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    // While you are not looking, his head finds you. You never see it turn;
    // you only ever look back and find it already turned.
    if (!this.frozen && dist < 14 && !player.hiding) {
      lookAt(this.figure, player.position.x, player.position.z, dt, 1.35);
    }

    // Breathing, close up. It is the one sound he makes that is not the keys,
    // and it carries on when the keys stop.
    this.breathTimer = (this.breathTimer ?? 2) - dt;
    if (this.breathTimer <= 0) {
      this.breathTimer = 3.4 + Math.random() * 1.6;
      if (dist < 11) this.game.audio.rasp(this.emitter?.gain, this.frozen ? 1.25 : 1);
    }

    if (this.emitter) {
      this.emitter.x = this.position.x;
      this.emitter.z = this.position.z;
    }
  }

  updatePatrol(dt, clock, player) {
    const route = this.currentPatrol(clock);
    if (!route) {
      this.state = 'wait';
      return;
    }
    if (!this.path.length || this.pathIndex >= this.path.length) {
      // Every few legs he simply is not where he was. You cannot learn the
      // route because the route stops being the whole story.
      this.legsWalked = (this.legsWalked ?? 0) + 1;
      if (player && this.legsWalked % 3 === 0 && Math.random() < 0.7) {
        this.relocateUnseen(player, 7, 16);
      }
      this.patrolIndex = (this.patrolIndex + 1) % route.length;
      if (!this.setDestination(route[this.patrolIndex])) {
        this.patrolIndex = 0;
        this.setDestination(route[0]);
      }
      return;
    }
    this.followPath(SPEED_PATROL * this.urgency, dt);
  }

  updateInvestigate(dt, player) {
    const arrived = this.followPath(SPEED_INVESTIGATE * this.urgency, dt);
    if (arrived) {
      this.investigateTimer += dt;
      // Sweeps his head around the spot before giving up.
      this.facing += dt * 0.9;
      if (this.investigateTimer > 4.5) {
        this.state = 'patrol';
        this.path = [];
        this.investigateTimer = 0;
      }
    }
  }

  updateHunt(dt, player) {
    const canSee = this.canSee(player);
    if (canSee) {
      this.lostTimer = 0;
      this.steerTo(player.position, SPEED_HUNT * this.urgency, dt);
      return;
    }
    // Keeps coming to your last known position, then starts checking around.
    this.lostTimer += dt;
    if (!this.path.length || this.pathIndex >= this.path.length) {
      const blocked = this.blockedNodes();
      const from = this.level.nearestNode(this.position, blocked);
      const to = this.level.nearestNode(player.position, blocked);
      const path = this.level.findPath(from, to, blocked);
      if (path) {
        this.path = path.map((id) => this.level.nav.nodes[id]);
        this.pathIndex = 0;
      }
    }
    this.followPath(SPEED_HUNT * this.urgency, dt);
    if (this.lostTimer > 11) {
      this.state = 'patrol';
      this.path = [];
      // Losing him has to mean something. Without a breather he re-acquires on
      // the next frame you are in his cone, the night becomes one unbroken
      // chase, and a chase you cannot end is just the new background level.
      this.grace = Math.max(this.grace, 6 * this.diff.grace);
      this.game.onHuntEnd?.();
    }
  }

  // From 3:00 he stops patrolling and stands at Bay 9. Arriving with a valid
  // ticket is safe; arriving without one is not.
  updateWait(dt, player, clock) {
    const bay9 = this.level.nav.nodes.bay_w;
    const dist = Math.hypot(this.position.x - bay9.x, this.position.z - bay9.z);
    if (dist > 1.2) {
      if (!this.path.length || this.pathIndex >= this.path.length) this.setDestination('bay_w');
      this.followPath(SPEED_INVESTIGATE * this.urgency, dt);
      return;
    }
    this.facing = Math.PI * 0.5;
    const toPlayer = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (toPlayer < 9 && !player.hiding) {
      this.facing = Math.atan2(
        -(player.position.x - this.position.x),
        -(player.position.z - this.position.z)
      );
    }
    if (toPlayer < 5.5 && !player.hiding) {
      if (!this.game.ticketIsBoardable()) {
        this.game.onCaught('He steps in front of the door. "Not without a ticket."');
      }
    }
  }
}
