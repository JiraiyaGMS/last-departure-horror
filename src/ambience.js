// The station's own small noises, each where it comes from: the railway
// clock over the hall, a tap in the restrooms, water in the tunnel, wind at
// the bays, the vending machines, the monitors in Security, the pipes.
//
// None of it means anything, which is the point: it is the floor the real
// sounds stand on, and every part of the building gets one of its own, so you
// can tell where you are with your eyes shut. When the hum dies -- the
// station holding its breath before something happens -- everything on the
// mains dies with it, and the clock stops ticking.

const HUM_BASE = 0.085;

export class Ambience {
  constructor(game) {
    this.game = game;
    this.audio = game.audio;
    this.sources = [];
    this.mains = [];
    this.started = false;
  }

  // Once the audio context exists (after the first gesture).
  start() {
    const a = this.audio;
    if (this.started || !a.ctx) return;
    this.started = true;
    const ctx = a.ctx;

    // The railway clock over the gate. Tick, then a slightly duller tock.
    this.clock = { em: a.makeEmitter(-8.5, -9.4, 15), next: ctx.currentTime + 0.5, tock: false };
    this.clock.em.volume = 0.8;

    // Taps that were never turned off properly. Each drip is its own size.
    this.drips = [
      { em: a.makeEmitter(-1.9, 13.2, 11), next: 0, pitch: 1.0, gap: [1.1, 3.2] },
      { em: a.makeEmitter(23.4, 15.4, 14), next: 0, pitch: 0.75, gap: [0.7, 2.6] },
      { em: a.makeEmitter(26.8, 18.6, 14), next: 0, pitch: 0.62, gap: [1.6, 4.5] },
      { em: a.makeEmitter(-9.0, -31.0, 12), next: 0, pitch: 0.85, gap: [2.0, 5.5] },
    ];
    for (const d of this.drips) d.next = ctx.currentTime + 1 + Math.random() * 3;

    // Wind through the open end of the bays, gusting.
    for (const [x, z] of [[-14, -39], [12, -39]]) {
      const em = a.makeEmitter(x, z, 44);
      em.volume = 0.9;
      this.wind(em);
    }

    // The two vending machines' compressors and the monitors' line whine:
    // on the mains, so they go when the hum goes.
    const vend = a.makeEmitter(12.4, 7.75, 9);
    this.mains.push(this.vendingHum(vend));
    const crt = a.makeEmitter(17.2, -2.9, 8);
    this.mains.push(this.crtWhine(crt));

    // Pipes in the tunnel, settling.
    this.pipes = { em: a.makeEmitter(25, 16, 20), next: ctx.currentTime + 12 };
  }

  // Is the station holding its breath (the hum cut right down)?
  hushed() {
    const hum = this.audio.humGain;
    return !!hum && hum.gain.value < HUM_BASE * 0.5;
  }

  update() {
    if (!this.started) return;
    const a = this.audio;
    const ctx = a.ctx;
    const now = ctx.currentTime;
    // Paused: the context is suspended and its clock stands still.
    if (ctx.state !== 'running') return;
    const hushed = this.hushed();
    // Far enough ahead that a slow frame does not leave a gap.
    const ahead = now + 0.35;

    // The clock, scheduled ahead on the audio clock so it never drifts, and
    // keeping its beat across a hitch rather than restarting it. Hushed, it
    // simply is not ticking.
    const c = this.clock;
    while (c.next < now) {
      c.next += 1;
      c.tock = !c.tock;
    }
    while (c.next < ahead) {
      if (!hushed) this.tick(c.em.gain, c.next, c.tock);
      c.tock = !c.tock;
      c.next += 1;
    }

    for (const d of this.drips) {
      if (d.next < now) d.next = now + 0.05;
      if (d.next < ahead) {
        if (!hushed) this.drip(d.em.gain, d.next, d.pitch * (0.92 + Math.random() * 0.16));
        d.next += d.gap[0] + Math.random() * (d.gap[1] - d.gap[0]);
      }
    }

    if (this.pipes.next < now) {
      this.pipes.next = now + 18 + Math.random() * 30;
      if (!hushed) a.creak(this.pipes.em.gain, 0.5 + Math.random() * 0.4);
    }

    // The mains follows the hum down and back up.
    const level = Math.min(1, (a.humGain?.gain.value ?? HUM_BASE) / HUM_BASE);
    for (const g of this.mains) g.gain.setTargetAtTime(level, now, 0.08);
  }

  // ---- the sounds ------------------------------------------------------------

  tick(dest, at, tock) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = tock ? 1900 : 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.05, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
    // The mechanism's body under the click.
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.value = tock ? 380 : 440;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, at);
    bg.gain.linearRampToValueAtTime(0.03, at + 0.003);
    bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    osc.connect(g);
    body.connect(bg);
    g.connect(dest);
    bg.connect(dest);
    osc.start(at);
    body.start(at);
    osc.stop(at + 0.05);
    body.stop(at + 0.08);
  }

  // A drop landing in standing water: a bubble that rises in pitch as it
  // closes.
  drip(dest, at, pitch) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(700 * pitch, at);
    osc.frequency.exponentialRampToValueAtTime(1900 * pitch, at + 0.045);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.09, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(g);
    g.connect(dest);
    osc.start(at);
    osc.stop(at + 0.09);
  }

  wind(em) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 1.3;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    // Gusts: two slow, unrelated swells on the level and on the pitch of
    // the air.
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.06 + Math.random() * 0.03;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.04;
    gust.connect(gustDepth);
    gustDepth.connect(g.gain);
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.11 + Math.random() * 0.05;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 180;
    sweep.connect(sweepDepth);
    sweepDepth.connect(bp.frequency);
    src.connect(bp);
    bp.connect(g);
    g.connect(em.gain);
    src.start();
    gust.start();
    sweep.start();
  }

  vendingHum(em) {
    const ctx = this.audio.ctx;
    const mains = ctx.createGain();
    mains.connect(em.gain);
    for (const [freq, level] of [[50, 0.05], [100, 0.03], [150, 0.012]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq + Math.random() * 0.6;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(mains);
      osc.start();
    }
    // The compressor's rattle, faint.
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.04;
    src.connect(lp);
    lp.connect(g);
    g.connect(mains);
    src.start();
    return mains;
  }

  // The line whine of a cathode-ray tube, which half the people who play
  // this will not hear at all and the other half will not be able to stop
  // hearing.
  crtWhine(em) {
    const ctx = this.audio.ctx;
    const mains = ctx.createGain();
    mains.connect(em.gain);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 15734;
    const g = ctx.createGain();
    g.gain.value = 0.006;
    osc.connect(g);
    g.connect(mains);
    osc.start();
    const buzz = ctx.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 60;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const bg = ctx.createGain();
    bg.gain.value = 0.01;
    buzz.connect(lp);
    lp.connect(bg);
    bg.connect(mains);
    buzz.start();
    return mains;
  }
}
