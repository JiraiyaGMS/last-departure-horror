import { segmentBlocked } from './collision.js';

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
    ];
  }

  reset() {
    this.timer = 24;
    this.cooldowns = Object.create(null);
    this.lastId = null;
    this.sinceAnything = 0;
  }

  update(dt, player, clock) {
    const fear = this.game.fear;
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
    const interval = intervalFor(ctx.progress);
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
    const steps = 4 + Math.floor(Math.random() * 5);
    const gap = 0.42 + Math.random() * 0.16;
    const surface = spot.id.startsWith('bay') || spot.id.startsWith('tunnel') ? 'concrete' : 'tile';
    for (let i = 0; i < steps; i++) {
      setTimeout(() => {
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
      this.game.subtitle(HALF_HEARD[Math.floor(Math.random() * HALF_HEARD.length)], 3);
    }
  }

  keysDownTheHall(ctx) {
    const spot = this.pickHiddenSpot(ctx.player, 12, 34);
    if (!spot) return;
    const em = this.oneShotEmitter(spot.x, spot.z, 38, 4);
    this.game.audio.keyJingle(em.gain);
    this.game.fear.wantFear(0.45);
    this.game.fear.wantTension(0.5);
  }

  // The board turns over rows for a departure that is not on it.
  boardClatter() {
    const board = this.game.refs?.board;
    this.game.audio.splitFlap(6 + Math.floor(Math.random() * 14), this.game.boardEmitter?.gain);
    this.game.fear.wantTension(0.4);
    if (board && Math.random() < 0.5) {
      setTimeout(() => board.redraw?.(), 600);
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
    setTimeout(() => {
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
      setTimeout(() => {
        if (!this.game.phoneRinging) return;
        // Two short trills per ring, the old mechanical bell pattern.
        for (let i = 0; i < 10; i++) {
          setTimeout(() => {
            if (!this.game.phoneRinging) return;
            this.game.audio.blip({ freq: 1040, type: 'sine', dur: 0.045, vol: 0.17, dest: em.gain });
            this.game.audio.blip({ freq: 1320, type: 'sine', dur: 0.045, vol: 0.13, dest: em.gain });
          }, i * 48);
        }
      }, r * 2300);
    }
    setTimeout(() => { this.game.phoneRinging = false; }, rings * 2300 + 800);
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
    audio.burst({ freqLow: 240, freqHigh: 1100, dur: 0.75, vol: 0.19, q: 0.7 });
    setTimeout(() => audio.burst({ freqLow: 180, freqHigh: 900, dur: 0.95, vol: 0.15, q: 0.7 }), 1050);
    audio.deafen(2.2);
    this.game.fear.kick('aberration', 1.4);
    this.game.fear.kick('distort', 0.6);
    this.game.fear.wantFear(0.8);
    this.game.fear.wantTension(0.8);
    this.game.subtitle('Something exhales, close enough to move your hair.', 3);
  }
}
