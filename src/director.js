import * as THREE from 'three';
import { segmentBlocked } from './collision.js';
import { makeFigure, animateWalk } from './figures.js';

// The Director decides when the station misbehaves.
//
// Everything in here is deniable: a sound from a room you are not in, a light
// that pops, a board that clatters when nobody touched it. None of it can hurt
// you. The point is that by 2 AM you no longer trust any of it, so when the
// Attendant actually does arrive you have already spent your composure.
//
// Three rules keep it from becoming noise:
//   1. Intervals shorten as the night does -- deniable at midnight, relentless
//      by 3 AM.
//   2. A scripted set piece claims the screen via `fear.busy`, and ambience
//      shuts up entirely while it does.
//   3. Nothing repeats until its own cooldown has passed, so the player never
//      gets the same tell twice in a row.

const PHASES = [
  // progress, interval at that point (seconds)
  [0.0, 42],
  [0.3, 28],
  [0.6, 17],
  [0.85, 10],
  [1.0, 7],
];

function intervalFor(progress) {
  for (let i = 1; i < PHASES.length; i++) {
    if (progress <= PHASES[i][0]) {
      const [p0, v0] = PHASES[i - 1];
      const [p1, v1] = PHASES[i];
      const f = (progress - p0) / (p1 - p0);
      return v0 + (v1 - v0) * f;
    }
  }
  return PHASES[PHASES.length - 1][1];
}

const _dir = new THREE.Vector3();
const _at = new THREE.Vector3();

// When the night starts, as the clock reads it: 11:47 PM.
const START = 23 * 60 + 47;

const HALF_HEARD = [
  'Someone, very close: "...still here..."',
  'Someone, very close: "...you were on the list..."',
  'A voice behind you: "...not yet..."',
  'A voice behind you: "...he counted wrong..."',
  'Someone, very close: "...don\'t turn around..."',
  'A voice behind you: "...one more..."',
];

export class Director {
  constructor(game) {
    this.game = game;
    this.level = game.level;
    this.timer = 24;
    this.cooldowns = Object.create(null);
    this.lastId = null;
    this.sinceAnything = 0;

    this.events = [
      {
        id: 'footsteps',
        cooldown: 50,
        weight: () => 1.2,
        run: (c) => this.footstepsNowhere(c),
      },
      {
        id: 'whisper',
        cooldown: 40,
        from: 0.12,
        weight: (c) => 1 + c.progress,
        run: (c) => this.whisperBehind(c),
      },
      {
        id: 'keys',
        cooldown: 70,
        from: 0.2,
        // Pointless unless he is somewhere else; the joke only lands if the
        // keys cannot possibly be his.
        weight: (c) => (c.attendantFar ? 1.1 : 0),
        run: (c) => this.keysDownTheHall(c),
      },
      {
        id: 'board',
        cooldown: 60,
        weight: () => 0.9,
        run: () => this.boardClatter(),
      },
      {
        id: 'lightpop',
        cooldown: 85,
        from: 0.25,
        weight: (c) => (c.litNearby ? 1 : 0),
        run: (c) => this.popALight(c),
      },
      {
        id: 'humcut',
        cooldown: 95,
        from: 0.3,
        weight: () => 0.8,
        run: () => this.humDies(),
      },
      {
        id: 'payphone',
        cooldown: 110,
        from: 0.25,
        weight: () => 0.7,
        run: (c) => this.payphoneRings(c),
      },
      {
        id: 'slam',
        cooldown: 75,
        from: 0.35,
        weight: () => 1,
        run: (c) => this.doorSlam(c),
      },
      {
        id: 'ear',
        cooldown: 100,
        from: 0.5,
        // The worst one, so it is saved for the dark and for later.
        weight: (c) => (c.dark ? 1.5 : 0.5) * c.progress,
        run: () => this.breathAtYourEar(),
      },
      {
        id: 'glimpse',
        cooldown: 90,
        from: 0.3,
        weight: (c) => (c.attendantFar ? 1.3 : 0),
        run: () => this.game.presence?.glimpse(),
      },
      {
        id: 'face',
        cooldown: 120,
        from: 0.45,
        weight: (c) => (c.dark ? 1.6 : 0),
        run: () => this.game.presence?.flashFace(),
      },
      {
        // A shadow crosses the floor under a light. There is nobody there to
        // cast it.
        id: 'phantom',
        cooldown: 110,
        from: 0.2,
        weight: (c) => (c.dark ? 0 : 1.3),
        run: (c) => this.phantomShadow(c),
      },
      {
        // Footsteps a pace behind your own, that stop when you stop.
        id: 'follow',
        cooldown: 120,
        from: 0.3,
        weight: (c) => (c.attendantFar ? 1.1 : 0),
        run: () => this.followingSteps(),
      },
      {
        // The room's lights go out one at a time, toward you.
        id: 'chase',
        cooldown: 150,
        from: 0.4,
        weight: (c) => (c.roomLights >= 3 ? 1.2 : 0),
        run: (c) => this.lightsChase(c),
      },
      {
        // Something knocks from inside a locker you were about to hide in.
        id: 'knock',
        cooldown: 90,
        from: 0.15,
        weight: () => 1,
        run: (c) => this.knockInside(c),
      },
      {
        id: 'drag',
        cooldown: 80,
        from: 0.25,
        weight: () => 0.8,
        run: (c) => this.somethingDragged(c),
      },
      {
        // The clock over the gate runs back to 11:47 while you watch it.
        // Rare: it only works on someone who does not expect it.
        id: 'clockback',
        cooldown: 420,
        from: 0.15,
        weight: (c) => (c.sees(this.game.refs?.wallClock?.mesh, 18, 0.8) ? 1.6 : 0),
        run: () => this.clockRunsBack(),
      },
      {
        // For a few seconds the board has a passenger it should not: you.
        id: 'yourname',
        cooldown: 420,
        from: 0.25,
        weight: (c) => (!this.game.presence?.boardWrong && c.sees(this.game.boardMesh, 24, 0.75) ? 1.4 : 0),
        run: () => this.boardSaysYourName(),
      },
      // ---- terror only -------------------------------------------------------
      {
        // Something a pace behind you, breathing.
        id: 'behind',
        cooldown: 70,
        from: 0.06,
        weight: (c) => (this.game.terror && !c.player.hiding ? 2.2 : 0),
        run: () => this.game.presence?.behindYou(),
      },
      {
        // You are hiding, and something knows exactly where.
        id: 'hunted',
        cooldown: 55,
        weight: (c) => (this.game.terror && c.player.hiding ? 8 : 0),
        run: (c) => this.hunted(c),
      },
      {
        // Every head in the room comes round to you at once, with a sound.
        id: 'heads',
        cooldown: 90,
        weight: (c) => (this.game.terror && c.room === 'hall' ? 1.6 : 0),
        run: () => this.game.echoes.stareAll(5),
      },
      {
        // The PA, with nobody at it: your own voice, or your name.
        id: 'paname',
        cooldown: 150,
        from: 0.25,
        weight: () => (this.game.terror ? 0.9 : 0),
        run: () => this.game.refs?.pa?.replay(),
      },
      {
        // The room's lights sink and come back in time with a heartbeat.
        id: 'pulse',
        cooldown: 140,
        from: 0.35,
        weight: (c) => (c.roomLights >= 2 && !c.dark ? 1 : 0),
        run: (c) => this.lightsPulse(c),
      },
    ];

    this.phantom = null;
    this.follower = null;
  }

  // setTimeout's signature, on the game's clock: a sequence started before a
  // pause waits for it, and one still pending when the night resets is
  // dropped with everything else from that night.
  after(fn, ms) {
    this.game.later(ms / 1000, fn);
  }

  reset() {
    this.timer = 24;
    this.cooldowns = Object.create(null);
    this.lastId = null;
    this.sinceAnything = 0;
    this.endPhantom();
    this.endFollower();
    for (const l of this.level.lights) {
      l.blackout = 0;
      l.dim = 0;
    }
    // The clock keeps the right time again on the next night, whatever it
    // was doing when this one ended.
    if (this.game.wallClockAt != null) {
      this.game.wallClockAt = null;
      this.game.refs?.wallClock?.redraw();
    }
  }

  update(dt, player, clock) {
    const fear = this.game.fear;
    // Running events tick even while a set piece holds the floor; they were
    // started before it and should finish the way they began.
    this.updatePhantom(dt);
    this.updateFollower(dt);

    for (const key of Object.keys(this.cooldowns)) {
      this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    }

    // A set piece owns the room while it runs, and gets a beat of quiet after.
    if (fear.busy > 0) {
      this.timer = Math.max(this.timer, 6);
      return;
    }
    // So does an actual chase. Ambience during a hunt would only dilute it.
    if (this.game.attendant.state === 'hunt') {
      this.timer = Math.max(this.timer, 12);
      return;
    }

    this.sinceAnything += dt;
    this.timer -= dt;
    if (this.timer > 0) return;

    const ctx = this.buildContext(player, clock);
    const event = this.pick(ctx);
    // Terror: twice as often, nearly.
    const interval = intervalFor(ctx.progress) * (this.game.terror ? 0.55 : 1);
    this.timer = interval * (0.65 + Math.random() * 0.7);

    if (!event) return;
    this.cooldowns[event.id] = event.cooldown;
    this.lastId = event.id;
    this.sinceAnything = 0;
    event.run(ctx);
  }

  buildContext(player, clock) {
    const a = this.game.attendant;
    const attDist = Math.hypot(a.position.x - player.position.x, a.position.z - player.position.z);
    const litNearby = this.level.lights.some(
      (l) => !l.broken && l.light.intensity > 0.5
        && Math.hypot(l.light.position.x - player.position.x, l.light.position.z - player.position.z) < 12
    );
    return {
      player,
      clock,
      progress: clock.progress,
      dark: this.game.inDark,
      room: this.game.currentRoom,
      attDist,
      attendantFar: attDist > 18,
      litNearby,
      roomLights: this.level.lights.filter(
        (l) => l.room === this.game.currentRoom && !l.broken && !(l.blackout > 0)
      ).length,
      // Is this thing in front of you, near enough to make out, with no wall
      // in the way? `cos` is how close to the middle of the view it has to be.
      sees: (obj, maxDist, cos) => {
        if (!obj) return false;
        const cam = this.game.camera;
        obj.getWorldPosition(_at);
        cam.getWorldDirection(_dir);
        const dx = _at.x - cam.position.x;
        const dy = _at.y - cam.position.y;
        const dz = _at.z - cam.position.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > maxDist || d < 1) return false;
        if ((dx * _dir.x + dy * _dir.y + dz * _dir.z) / d < cos) return false;
        // Tested to a point just short of it: a sign on a wall must not be
        // hidden by the wall it hangs on.
        const k = 0.6 / Math.hypot(dx, dz);
        return !segmentBlocked(this.level.colliders, cam.position.x, cam.position.z, _at.x - dx * k, _at.z - dz * k);
      },
    };
  }

  pick(ctx) {
    let total = 0;
    const pool = [];
    for (const e of this.events) {
      if (this.cooldowns[e.id] > 0) continue;
      if (e.id === this.lastId) continue;
      if (e.from !== undefined && ctx.progress < e.from) continue;
      const w = e.weight(ctx);
      if (w <= 0) continue;
      total += w;
      pool.push([e, total]);
    }
    if (!pool.length) return null;
    const roll = Math.random() * total;
    for (const [e, acc] of pool) if (roll <= acc) return e;
    return pool[pool.length - 1][0];
  }

  // ---- helpers -----------------------------------------------------------

  // A spot the player cannot currently see, at a plausible distance. Sound you
  // can see the source of is just sound; sound from somewhere you cannot check
  // without walking there is a decision.
  pickHiddenSpot(player, minDist = 9, maxDist = 32) {
    const entries = Object.entries(this.level.nav.nodes);
    const candidates = [];
    for (const [id, p] of entries) {
      const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
      if (d < minDist || d > maxDist) continue;
      const hidden = segmentBlocked(
        this.level.colliders, player.position.x, player.position.z, p.x, p.z
      );
      candidates.push({ id, x: p.x, z: p.z, d, hidden });
    }
    if (!candidates.length) return null;
    const hiddenOnes = candidates.filter((c) => c.hidden);
    const pool = hiddenOnes.length ? hiddenOnes : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  oneShotEmitter(x, z, maxDist, lifetime) {
    const em = this.game.audio.makeEmitter(x, z, maxDist);
    this.game.audio.releaseEmitter(em, lifetime);
    return em;
  }

  // ---- events ------------------------------------------------------------

  // Someone walks a few paces in another room and stops. Not toward you, not
  // away -- just stops, which is worse.
  footstepsNowhere(ctx) {
    const spot = this.pickHiddenSpot(ctx.player, 8, 30);
    if (!spot) return;
    const em = this.oneShotEmitter(spot.x, spot.z, 34, 8);
    this.game.caption('steps', 'Footsteps', spot.x, spot.z, 34);
    const steps = 4 + Math.floor(Math.random() * 5);
    const gap = 0.42 + Math.random() * 0.16;
    const surface = spot.id.startsWith('bay') || spot.id.startsWith('tunnel') ? 'concrete' : 'tile';
    for (let i = 0; i < steps; i++) {
      this.after(() => {
        // They get quieter, as if walking away, then the last one is loud and
        // close -- a step toward you before the silence.
        const last = i === steps - 1;
        this.game.audio.footstep(last ? 0.9 : 0.55 - i * 0.05, surface, em.gain);
        if (last) {
          this.game.fear.kick('aberration', 0.5);
          this.game.fear.wantFear(0.3);
        }
      }, i * gap * 1000);
    }
  }

  whisperBehind(ctx) {
    const side = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.4);
    this.game.audio.whisper(side, 0.55 + ctx.progress * 0.45);
    this.game.fear.kick('aberration', 0.6);
    this.game.fear.wantFear(0.35);
    if (Math.random() < 0.45) {
      this.game.subtitle(HALF_HEARD[Math.floor(Math.random() * HALF_HEARD.length)], 3, 0);
    }
  }

  keysDownTheHall(ctx) {
    const spot = this.pickHiddenSpot(ctx.player, 12, 34);
    if (!spot) return;
    const em = this.oneShotEmitter(spot.x, spot.z, 38, 4);
    this.game.audio.keyJingle(em.gain);
    this.game.caption('keys', 'Keys jingling', spot.x, spot.z, 38);
    this.game.fear.wantFear(0.45);
    this.game.fear.wantTension(0.5);
  }

  // The clock over the gate runs back to 11:47 while you watch it: a dry
  // ratchet, the hands sweeping round the wrong way, a moment at 11:47. The
  // next time you look it is right again.
  clockRunsBack() {
    const g = this.game;
    const face = g.refs?.wallClock;
    if (!face) return;
    face.mesh.getWorldPosition(_at);
    const em = this.oneShotEmitter(_at.x, _at.z, 26, 9);
    g.caption('clock', 'A clock ticking backwards', _at.x, _at.z, 26);
    const from = g.clock.time;
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      this.after(() => {
        const f = i / steps;
        g.wallClockAt = from + (START - from) * f * f * (3 - 2 * f);
        face.redraw();
        g.audio.blip({ freq: 2600 - i * 30, type: 'square', dur: 0.012, vol: 0.07, dest: em.gain });
      }, 300 + i * 90);
    }
    const end = 300 + steps * 90;
    this.after(() => {
      g.audio.blip({ freq: 900, type: 'square', dur: 0.03, vol: 0.12, dest: em.gain });
      g.fear.kick('aberration', 0.7);
      g.fear.wantTension(0.6);
      g.fear.wantFear(0.35);
      g.subtitle('The clock over the gate says 11:47.', 3, 0);
    }, end);
    this.after(() => {
      g.wallClockAt = null;
      face.redraw();
      g.audio.blip({ freq: 2400, type: 'square', dur: 0.012, vol: 0.05, dest: em.gain });
    }, end + 3800);
  }

  // A row of the board turns over to your name, at Bay 0, waiting. A few
  // seconds later it turns back as if it had never been anything else. It
  // takes the departed service's row, so the cancelled ones still spell what
  // they spell.
  boardSaysYourName() {
    const g = this.game;
    const board = g.refs?.board;
    const row = g.boardRows.findIndex((r) => r.status === 'DEPARTED');
    if (!board || row < 0 || g.presence?.boardWrong) return;
    const name = String(g.playerName || 'PASSENGER').toUpperCase().slice(0, 14);
    g.audio.splitFlap(12, g.boardEmitter?.gain);
    this.after(() => {
      if (g.presence?.boardWrong) return;
      g.boardRows = g.boardRows.map((r, k) => (k === row ? { dest: name, bay: 0, status: 'WAITING' } : r));
      board.redraw();
      g.fear.kick('aberration', 0.5);
      g.fear.wantTension(0.55);
    }, 500);
    this.after(() => {
      if (g.presence?.boardWrong) return;
      g.subtitle('The board has your name on it. Bay 0.', 3, 0);
    }, 1800);
    this.after(() => {
      // Something else has the board now; it puts the timetable back itself.
      if (g.presence?.boardWrong) return;
      g.audio.splitFlap(12, g.boardEmitter?.gain);
      g.boardRows = g.baseBoardRows();
      board.redraw();
    }, 7500);
  }

  // The room's lights sink and come back four times, in time with a heartbeat
  // that is not quite yours. Shallower with reduced flashing on.
  lightsPulse(ctx) {
    const g = this.game;
    const lights = this.level.lights.filter((l) => l.room === ctx.room && !l.broken);
    if (lights.length < 2) return;
    const deep = g.settings?.calm ? 0.3 : 0.7;
    for (let b = 0; b < 4; b++) {
      this.after(() => {
        for (const l of lights) l.dim = Math.max(l.dim ?? 0, deep);
        g.audio.heartbeat(0.9 + b * 0.2);
      }, 400 + b * 860);
      this.after(() => {
        for (const l of lights) l.dim = Math.max(l.dim ?? 0, deep * 0.6);
      }, 400 + b * 860 + 170);
    }
    this.after(() => {
      g.fear.wantFear(0.4);
      g.fear.kick('aberration', 0.4);
    }, 400);
  }

  // Terror, hiding. Steps come straight to your hiding place from across the
  // room and stop outside it. Breathing on the other side of the door. Then
  // it is hit, once, as hard as anything has ever been hit, and the steps go
  // away. None of it is him, and you will not believe that.
  hunted(ctx) {
    const g = this.game;
    const spot = ctx.player.hiding;
    if (!spot) return;
    const sp = spot.position;
    const ang = Math.random() * Math.PI * 2;
    const ox = Math.cos(ang);
    const oz = Math.sin(ang);
    const em = this.oneShotEmitter(sp.x + ox * 10, sp.z + oz * 10, 30, 18);
    g.audio.cutHum(11);
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      this.after(() => {
        const k = (i + 1) / steps;
        em.x = sp.x + ox * (10 - 9.1 * k);
        em.z = sp.z + oz * (10 - 9.1 * k);
        g.audio.footstep(0.55 + k * 0.45, 'tile', em.gain);
        g.caption('steps', 'Footsteps, coming straight to you', em.x, em.z, 30);
        g.fear.wantFear(0.4 + k * 0.45);
      }, i * 640);
    }
    const at = steps * 640;
    this.after(() => {
      g.audio.rasp(em.gain, 1.6);
      g.caption('rasp', 'Breathing, just outside', em.x, em.z, 4);
      g.fear.wantFear(0.95);
    }, at + 900);
    this.after(() => {
      g.audio.bang(em.gain, 1.3);
      g.fear.jolt(1.5);
      g.fear.kick('shake', 1);
      g.fear.kick('static', 0.5);
      g.fear.kick('aberration', 1.5);
      g.subtitle('Something hits the door of your hiding place. Once. Hard.', 3, 0);
    }, at + 3600);
    for (let i = 0; i < 5; i++) {
      this.after(() => {
        em.x += ox * 1.6;
        em.z += oz * 1.6;
        g.audio.footstep(0.7 - i * 0.12, 'tile', em.gain);
      }, at + 6400 + i * 700);
    }
  }

  // The board turns over rows for a departure that is not on it.
  boardClatter() {
    const board = this.game.refs?.board;
    this.game.audio.splitFlap(6 + Math.floor(Math.random() * 14), this.game.boardEmitter?.gain);
    this.game.fear.wantTension(0.4);
    if (board && Math.random() < 0.5) {
      this.after(() => board.redraw?.(), 600);
    }
  }

  // A fixture gives out. Loud, physical, and it takes a room away from you.
  popALight(ctx) {
    const near = this.level.lights
      .filter((l) => !l.broken)
      .map((l) => ({
        l,
        d: Math.hypot(
          l.light.position.x - ctx.player.position.x,
          l.light.position.z - ctx.player.position.z
        ),
      }))
      .filter((e) => e.d > 4 && e.d < 20)
      .sort((a, b) => a.d - b.d);
    if (!near.length) return;
    const target = near[Math.floor(Math.random() * Math.min(3, near.length))];
    const em = this.oneShotEmitter(target.l.light.position.x, target.l.light.position.z, 30, 3);
    target.l.flicker = 1;
    this.after(() => {
      this.game.audio.burst({ freqLow: 400, freqHigh: 7000, dur: 0.07, vol: 0.5, dest: em.gain, q: 0.6 });
      this.game.audio.blip({ freq: 90, type: 'sine', dur: 0.2, vol: 0.3, dest: em.gain });
      target.l.broken = true;
      this.game.fear.kick('static', 0.7);
      this.game.fear.kick('shake', 0.45);
      this.game.fear.kick('aberration', 1.0);
      this.game.fear.wantFear(0.55);
    }, 900 + Math.random() * 700);
  }

  // No payoff. That is the whole event: the station holds its breath and then
  // nothing happens, and you have to decide what to do with that.
  humDies() {
    const seconds = 3 + Math.random() * 4;
    this.game.audio.cutHum(seconds);
    this.game.fear.wantTension(0.75);
    this.game.fear.kick('aberration', 0.4);
  }

  payphoneRings(ctx) {
    const phone = this.game.refs?.payphone;
    if (!phone || phone.offHook) return;
    const { x, z } = phone.position;
    const em = this.oneShotEmitter(x, z, 44, 16);
    const rings = 3 + Math.floor(Math.random() * 3);
    this.game.phoneRinging = true;
    for (let r = 0; r < rings; r++) {
      this.after(() => {
        if (!this.game.phoneRinging) return;
        // Two short trills per ring, the old mechanical bell pattern.
        for (let i = 0; i < 10; i++) {
          this.after(() => {
            if (!this.game.phoneRinging) return;
            this.game.audio.blip({ freq: 1040, type: 'sine', dur: 0.045, vol: 0.17, dest: em.gain });
            this.game.audio.blip({ freq: 1320, type: 'sine', dur: 0.045, vol: 0.13, dest: em.gain });
          }, i * 48);
        }
      }, r * 2300);
    }
    this.after(() => { this.game.phoneRinging = false; }, rings * 2300 + 800);
    this.game.fear.wantTension(0.6);
    const near = Math.hypot(x - ctx.player.position.x, z - ctx.player.position.z) < 16;
    this.game.subtitle(
      near
        ? 'The payphone on the east wall is ringing.'
        : 'Somewhere in the hall, a payphone starts ringing.',
      3.5
    );
  }

  doorSlam(ctx) {
    const spot = this.pickHiddenSpot(ctx.player, 10, 36);
    if (!spot) return;
    const em = this.oneShotEmitter(spot.x, spot.z, 42, 4);
    this.game.caption('slam', 'A door slams', spot.x, spot.z, 42);
    this.game.audio.burst({ freqLow: 60, freqHigh: 1200, dur: 0.22, vol: 0.55, dest: em.gain, q: 0.5 });
    this.game.audio.blip({ freq: 58, type: 'sine', dur: 0.35, vol: 0.4, dest: em.gain });
    this.game.audio.deafen(1.1);
    this.game.fear.kick('shake', 0.7);
    this.game.fear.kick('aberration', 1.1);
    this.game.fear.kick('static', 0.4);
    this.game.fear.wantFear(0.6);
  }

  // Not positioned. It is inside the stereo field, which means it is not in
  // the room -- it is at the microphone.
  breathAtYourEar() {
    const audio = this.game.audio;
    audio.burst({ freqLow: 240, freqHigh: 1100, dur: 0.75, vol: 0.19, q: 0.7, dest: audio.master });
    this.after(() => audio.burst({ freqLow: 180, freqHigh: 900, dur: 0.95, vol: 0.15, q: 0.7, dest: audio.master }), 1050);
    audio.deafen(2.2);
    this.game.fear.kick('aberration', 1.4);
    this.game.fear.kick('distort', 0.6);
    this.game.fear.wantFear(0.8);
    this.game.fear.wantTension(0.8);
    this.game.subtitle('Something exhales, close enough to move your hair.', 3);
  }

  // ---- shadows and steps ---------------------------------------------------

  // A body that only exists in the shadow maps. Its materials write neither
  // colour nor depth, so the camera never sees it, but the shadow pass draws
  // it like anything else -- and the cached shadow of the light it walks
  // under is redrawn every frame it moves.
  buildPhantom() {
    const fig = makeFigure({ coat: 0x000000, skin: 0x000000, height: 1.92, gaunt: true });
    for (const m of fig.userData.materials) {
      m.colorWrite = false;
      m.depthWrite = false;
    }
    fig.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      o.userData.noAO = true;
    });
    fig.visible = false;
    this.game.scene.add(fig);
    this.game.extraShadowCasters = this.game.extraShadowCasters ?? [];
    this.game.extraShadowCasters.push(fig);
    this.phantomFigure = fig;
  }

  phantomShadow(ctx) {
    if (this.phantom) return;
    const player = ctx.player;
    const cam = this.game.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();

    // A burning light in front of the player, not on top of them. It need
    // not already be casting: it is pinned into the shadow budget for as long
    // as the walk lasts.
    let best = null;
    for (const l of this.level.lights) {
      if (!l.light.visible || l.broken || l.blackout > 0 || l.light.intensity < 0.5) continue;
      const dx = l.light.position.x - player.position.x;
      const dz = l.light.position.z - player.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 4.5 || d > 14) continue;
      const aim = (dx * fwd.x + dz * fwd.z) / d;
      if (aim < 0.55) continue;
      if (segmentBlocked(this.level.colliders, player.position.x, player.position.z,
        l.light.position.x, l.light.position.z)) continue;
      // The nearest one: the shadow is the whole event, so it should be big.
      if (!best || d < best.d) best = { l, aim, d };
    }
    if (!best) return;

    if (!this.phantomFigure) this.buildPhantom();
    // Walk it across the player's view on the near side of the light, so its
    // shadow is thrown toward the player and sweeps over the floor in front of
    // them.
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const lp = best.l.light.position;
    const offset = -1.4;
    const from = new THREE.Vector3(lp.x, 0, lp.z).addScaledVector(fwd, offset).addScaledVector(side, -3.2 * dir);
    const to = new THREE.Vector3(lp.x, 0, lp.z).addScaledVector(fwd, offset).addScaledVector(side, 3.2 * dir);
    const fig = this.phantomFigure;
    fig.position.copy(from);
    const travel = new THREE.Vector3().subVectors(to, from);
    fig.rotation.y = Math.atan2(-travel.x, -travel.z);
    fig.visible = true;
    best.l.shadowPinned = true;
    this.phantom = { from, to, t: 0, dur: travel.length() / 1.25, light: best.l };
    this.game.fear.wantTension(0.6);
  }

  updatePhantom(dt) {
    const ph = this.phantom;
    if (!ph) return;
    ph.t += dt;
    const k = Math.min(1, ph.t / ph.dur);
    this.phantomFigure.position.lerpVectors(ph.from, ph.to, k);
    animateWalk(this.phantomFigure, 1.25, dt);
    if (k >= 1) {
      this.endPhantom();
      this.game.fear.kick('aberration', 0.5);
      this.game.fear.wantFear(0.4);
    }
  }

  endPhantom() {
    if (this.phantom?.light) this.phantom.light.shadowPinned = false;
    this.phantom = null;
    if (this.phantomFigure) this.phantomFigure.visible = false;
  }

  followingSteps() {
    if (this.follower) return;
    const em = this.game.audio.makeEmitter(0, 0, 14);
    this.follower = { em, left: 7 + Math.random() * 4, startYaw: this.game.player.yaw, steps: 0 };
  }

  // The player's own footstep, forwarded by the game.
  onPlayerStep(loudness) {
    const f = this.follower;
    if (!f) return;
    // Half a beat late, a little heavier than yours.
    this.after(() => {
      if (!this.follower || this.follower !== f) return;
      const room = this.game.currentRoom;
      const surface = room === 'bays' || room === 'tunnel' || room === 'bay0' ? 'concrete' : 'tile';
      this.game.audio.footstep(Math.max(0.45, loudness), surface, f.em.gain);
      this.game.caption('follow', 'Footsteps', f.em.x, f.em.z, 14);
      f.steps++;
    }, 170 + Math.random() * 60);
  }

  updateFollower(dt) {
    const f = this.follower;
    if (!f) return;
    const player = this.game.player;
    // Always three metres behind, wherever behind is now.
    f.em.x = player.position.x + Math.sin(player.yaw) * 3;
    f.em.z = player.position.z + Math.cos(player.yaw) * 3;
    f.left -= dt;
    // Turning round to look ends it -- with nothing there.
    const turned = Math.abs(((player.yaw - f.startYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 2.2;
    if (turned && f.steps > 2) {
      this.game.fear.kick('aberration', 0.9);
      this.game.fear.wantFear(0.55);
      this.game.subtitle('There is nobody behind you.', 2.5);
      this.endFollower();
      return;
    }
    if (f.left <= 0) this.endFollower();
  }

  endFollower() {
    if (!this.follower) return;
    this.game.audio.releaseEmitter(this.follower.em, 1);
    this.follower = null;
  }

  lightsChase(ctx) {
    const p = ctx.player.position;
    const lights = this.level.lights
      .filter((l) => l.room === ctx.room && !l.broken && !(l.blackout > 0))
      .map((l) => ({ l, d: Math.hypot(l.light.position.x - p.x, l.light.position.z - p.z) }))
      .sort((a, b) => b.d - a.d);
    if (lights.length < 3) return;
    const gap = 0.55;
    const total = lights.length * gap + 2.2;
    this.game.audio.cutHum(total + 1);
    this.game.fear.wantTension(0.9);
    lights.forEach(({ l }, i) => {
      this.after(() => {
        if (this.game.ended || this.game.transitioning) return;
        // Each one goes with the heavy clunk of a relay.
        const em = this.oneShotEmitter(l.light.position.x, l.light.position.z, 30, 2);
        this.game.audio.blip({ freq: 70, type: 'square', dur: 0.09, vol: 0.22, dest: em.gain, slide: -30 });
        this.game.audio.burst({ freqLow: 200, freqHigh: 1800, dur: 0.05, vol: 0.18, dest: em.gain });
        l.blackout = total - i * gap;
        if (i === lights.length - 1) {
          this.game.fear.kick('shake', 0.35);
          this.game.fear.wantFear(0.7);
        }
      }, i * gap * 1000);
    });
    // They come back together, stuttering, and the room is exactly as it was.
    this.after(() => {
      if (this.game.ended || this.game.transitioning) return;
      this.game.fear.kick('aberration', 0.8);
    }, total * 1000);
  }

  knockInside(ctx) {
    const p = ctx.player.position;
    const spots = this.level.hideSpots
      .filter((s) => !s.occupied && /locker|stall|closet|cupboard/.test(s.id))
      .map((s) => ({ s, d: Math.hypot(s.position.x - p.x, s.position.z - p.z) }))
      .filter((e) => e.d > 2.5 && e.d < 12)
      .sort((a, b) => a.d - b.d);
    if (!spots.length) return;
    const { s, d } = spots[0];
    const em = this.oneShotEmitter(s.position.x, s.position.z, 18, 4);
    this.game.caption('knock', 'Knocking', s.position.x, s.position.z, 18);
    this.game.audio.knock(em.gain, 3, 0.3);
    this.after(() => this.game.audio.knock(em.gain, 1, 0.3), 2400);
    this.game.fear.wantFear(0.45);
    this.game.fear.kick('aberration', 0.6);
    if (d < 7) this.game.subtitle(`Something knocks from inside ${s.name}.`, 3);
  }

  somethingDragged(ctx) {
    const spot = this.pickHiddenSpot(ctx.player, 8, 28);
    if (!spot) return;
    const em = this.oneShotEmitter(spot.x, spot.z, 32, 6);
    this.game.caption('drag', 'Something dragged', spot.x, spot.z, 32);
    this.game.audio.scrape(em.gain, 1.4 + Math.random());
    this.after(() => this.game.audio.scrape(em.gain, 0.8), 2600 + Math.random() * 800);
    this.game.fear.wantTension(0.55);
  }
}
