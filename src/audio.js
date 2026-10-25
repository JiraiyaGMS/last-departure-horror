// Everything is synthesized at runtime: fluorescent hum, the Attendant's keys,
// the PA, the jukebox. No audio files to ship.

function noiseBuffer(ctx, seconds = 2) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// A room's echo, made rather than recorded: a burst of discrete reflections
// off the nearest walls, then a tail of decaying noise whose top end is eaten
// as it goes, the way air and soft surfaces eat it. The two channels are
// separate noise, so the tail is wide even when the sound that feeds it is
// not.
function impulse(ctx, seconds, { predelay = 0.012, shape = 2.4, bright = 0.7, early = [] } = {}) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const pre = Math.floor(rate * predelay);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const u = (i - pre) / (len - pre);
      const k = Math.max(0.04, bright * (1 - u * 0.85));
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.pow(1 - u, shape);
    }
    for (const [ms, g] of early) {
      // Offset per ear, so a reflection arrives at one a beat before the other.
      const at = Math.floor(((ms + (ch ? 1.7 : 0)) / 1000) * rate);
      for (let j = 0; j < 24 && at + j < len; j++) d[at + j] += g * (1 - j / 24) * (Math.random() * 0.6 + 0.7);
    }
  }
  return buf;
}

// How each part of the station sounds: the share of the small-room and the
// big-room echo. Painted block and tile rooms ring; the offices, full of desks
// and paper, are close and dead; the hall and the bays are cavernous, and the
// tunnel is a concrete pipe.
const SPACES = {
  hall: [0.15, 0.62],
  gate: [0.35, 0.45],
  bays: [0.05, 0.5],
  ticket: [0.42, 0.06],
  manager: [0.38, 0.04],
  lostfound: [0.48, 0.1],
  cctv: [0.4, 0.05],
  diner: [0.45, 0.08],
  restroom: [0.75, 0.12],
  baggage: [0.2, 0.55],
  tunnel: [0.3, 0.85],
  bay0: [0.05, 0.6],
  // Off the map: the road, the coach, the cutscenes' own places.
  outside: [0.04, 0.1],
};

// A copy of `buffer`, back to front.
function reversed(ctx, buffer) {
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return out;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.emitters = [];
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.enabled = false;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85 * (this.volume ?? 0.8);

    // Everything runs through a lowpass we can slam shut. Ducking the whole
    // mix to a muffled 500 Hz after a scare and letting it bloom back open is
    // what sells the ringing-ears moment -- the silence does the work.
    this.duck = this.ctx.createBiquadFilter();
    this.duck.type = 'lowpass';
    this.duck.frequency.value = 20000;
    this.master.connect(this.duck);
    this.duck.connect(this.ctx.destination);

    this.noise = noiseBuffer(this.ctx, 3);
    this.enabled = true;

    this.buildSpace();

    this.startHum();
    this.startDrone();
    this.startBreath();
  }

  // Slam the mix shut, then let it open back up over `seconds`.
  deafen(seconds = 1.6) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.frequency.cancelScheduledValues(t);
    this.duck.frequency.setValueAtTime(500, t);
    this.duck.frequency.exponentialRampToValueAtTime(20000, t + seconds + 1.5);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Pausing stops the whole sound timeline, scheduled notes included, so a
  // song or a ring carries on exactly where it left off.
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(0.85 * v, this.ctx.currentTime, 0.05);
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---- the room ---------------------------------------------------------------

  // Two echoes run all the time, a small room's and a big one's; where you
  // are standing decides how much of each comes back. Everything that
  // happens in the station feeds them, from his keys to your own feet, so a
  // footstep in the hall hangs in the air and the same step in the ticket
  // office is gone at once.
  buildSpace() {
    const ctx = this.ctx;
    this.verbIn = ctx.createGain();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.master);
    const make = (ir) => {
      const send = ctx.createGain();
      send.gain.value = 0;
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      this.verbIn.connect(send);
      send.connect(conv);
      conv.connect(out);
      return send;
    };
    this.verbSmall = make(impulse(ctx, 0.9, { predelay: 0.006, shape: 3.2, bright: 0.55, early: [[7, 0.5], [13, 0.35], [21, 0.25]] }));
    this.verbLarge = make(impulse(ctx, 3.2, { predelay: 0.024, shape: 2.1, bright: 0.42, early: [[19, 0.4], [41, 0.3], [67, 0.22], [103, 0.14]] }));

    // Sounds that are not placed anywhere -- your hands, your feet -- go out
    // dry and into the room together.
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.32;
    this.sfx.connect(sfxSend);
    sfxSend.connect(this.verbIn);
    this.setSpace('hall', true);
  }

  // `room` is a key of level.ROOMS. Walking through a doorway crossfades the
  // echo rather than switching it.
  setSpace(room, instant = false) {
    if (!this.ctx || !this.verbIn || room === this.space) return;
    this.space = room;
    const [small, large] = SPACES[room] ?? SPACES.outside;
    const t = this.ctx.currentTime;
    const tc = instant ? 0.001 : 0.35;
    this.verbSmall.gain.setTargetAtTime(small, t, tc);
    this.verbLarge.gain.setTargetAtTime(large, t, tc);
  }

  // ---- spatial helpers ----------------------------------------------------

  makeEmitter(x, z, maxDist = 26) {
    // The context does not exist until the player's first gesture, but the
    // Director does not know that and should not have to. Hand back an inert
    // emitter rather than throwing: an exception here would propagate out of
    // event.run() and cost the frame every system downstream of it.
    if (!this.ctx) {
      return { x, z, maxDist, gain: null, pan: null, volume: 1, muted: true, dead: true };
    }
    // `gain` is where a sound goes in, at the emitter's own volume. After it,
    // a filter for distance and walls, then a dry path panned to where it is
    // and a wet one into the room.
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 16000;
    lp.Q.value = 0.5;
    const dry = ctx.createGain();
    dry.gain.value = 0;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(lp);
    lp.connect(dry);
    dry.connect(pan);
    pan.connect(this.master);
    lp.connect(wet);
    wet.connect(this.verbIn ?? this.master);
    const em = { x, z, maxDist, gain, lp, dry, wet, pan, volume: 1, muted: false };
    this.emitters.push(em);
    return em;
  }

  // One-shots park an emitter in the world for a few seconds. Without this they
  // would accumulate in the mix graph for the rest of the night.
  releaseEmitter(em, after = 0) {
    const drop = () => {
      const i = this.emitters.indexOf(em);
      if (i >= 0) this.emitters.splice(i, 1);
      try {
        em.gain.disconnect();
        em.lp.disconnect();
        em.dry.disconnect();
        em.wet.disconnect();
        em.pan.disconnect();
      } catch { /* already gone */ }
    };
    if (after > 0) setTimeout(drop, after * 1000);
    else drop();
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  updateEmitters(occludedFn) {
    if (!this.ctx) return;
    const { x: lx, z: lz, yaw } = this.listener;
    const now = this.ctx.currentTime;
    for (const em of this.emitters) {
      const dx = em.x - lx;
      const dz = em.z - lz;
      const dist = Math.hypot(dx, dz);
      const near = Math.max(0, 1 - dist / em.maxDist);
      let att = near * near;
      // The room carries a sound further than the direct line does: far off,
      // you hear the hall more than you hear the thing in it.
      let send = Math.max(0, 1 - dist / (em.maxDist * 1.6)) * 0.85;
      // Through a wall you lose the top end and most of the direct sound,
      // but the echo still finds its way round through the doorways.
      const blocked = !!(occludedFn && (att > 0.001 || send > 0.001) && occludedFn(em.x, em.z));
      if (blocked) {
        att *= 0.3;
        send *= 0.6;
      }
      const cutoff = blocked ? 700 : 16000 - (1 - near) * 11000;
      em.gain.gain.setTargetAtTime(em.muted ? 0 : em.volume, now, 0.05);
      em.dry.gain.setTargetAtTime(att, now, 0.08);
      em.wet.gain.setTargetAtTime(send, now, 0.12);
      em.lp.frequency.setTargetAtTime(cutoff, now, 0.15);

      // Right vector is (cos yaw, -sin yaw).
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const side = dist > 0.001 ? (dx * rx + dz * rz) / dist : 0;
      em.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, side)), now, 0.1);
    }
  }

  // ---- ambience ----------------------------------------------------------

  startHum() {
    const ctx = this.ctx;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.085;
    this.humGain.connect(this.master);

    // 60 Hz mains buzz plus its harmonic.
    for (const [freq, level] of [[60, 1], [120, 0.5], [180, 0.18]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.05 * level;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      osc.connect(g);
      g.connect(lp);
      lp.connect(this.humGain);
      osc.start();
    }

    // Airy room tone.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.humGain);
    src.start();
  }

  // A sub-bass bed that swells with dread, plus a dissonant upper cluster that
  // only fades in once things are genuinely bad. The player should feel these
  // arrive before they consciously notice them.
  startDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneGain.connect(this.master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.connect(this.droneGain);

    // Low minor-second clusters: 55 against 55.45 beats about twice a second.
    for (const freq of [55, 55.45, 82.6, 41.2]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      osc.connect(g);
      g.connect(lp);
      osc.start();
    }

    // The whine only exists when tension is high.
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineGain.connect(this.master);
    for (const freq of [1318.5, 1396.9, 2093]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.012;
      osc.connect(g);
      g.connect(this.whineGain);
      osc.start();
    }

    // Low rumble, the building settling.
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.02;
    this.rumbleGain.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 110;
    src.connect(rlp);
    rlp.connect(this.rumbleGain);
    src.start();
  }

  // The player's own breathing. Rate and depth track fear, so the loudest
  // thing in a quiet room is you failing to keep it together.
  startBreath() {
    const ctx = this.ctx;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    this.breathGain.connect(this.master);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.9;
    bp.connect(this.breathGain);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.connect(bp);
    src.start();

    // An LFO gates the noise into inhale/exhale shapes.
    this.breathLfo = ctx.createOscillator();
    this.breathLfo.type = 'sine';
    this.breathLfo.frequency.value = 0.28;
    this.breathDepth = ctx.createGain();
    this.breathDepth.gain.value = 0;
    this.breathLfo.connect(this.breathDepth);
    this.breathDepth.connect(this.breathGain.gain);
    this.breathLfo.start();
  }

  // Called every frame with the shared Fear state.
  setMood(fear, tension) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const ramp = (param, v, tc = 1.2) => param.setTargetAtTime(v, t, tc);

    ramp(this.droneGain.gain, 0.05 + tension * 0.22 + fear * 0.1);
    // Below 0.35 tension the whine is simply absent.
    ramp(this.whineGain.gain, Math.max(0, tension - 0.35) * 1.4, 2.0);
    ramp(this.rumbleGain.gain, 0.02 + tension * 0.1);

    const b = Math.max(this.exertion ?? 0, fear * 0.7);
    ramp(this.breathLfo.frequency, 0.28 + b * 0.6, 0.6);
    ramp(this.breathDepth.gain, b * 0.09, 0.4);
  }

  // Running leaves you audibly out of breath even after you stop.
  setExertion(v) {
    this.exertion = v;
  }

  // The hum cutting out is the game's main "something is about to happen" cue.
  cutHum(duration = 2.2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setTargetAtTime(0.002, t, 0.05);
    this.humGain.gain.setTargetAtTime(0.085, t + duration, 0.5);
  }

  setHumLevel(v) {
    if (!this.ctx) return;
    this.humGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
  }

  // ---- one-shots ---------------------------------------------------------

  blip({ freq = 440, type = 'square', dur = 0.08, vol = 0.12, dest = null, slide = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(dest || this.sfx || this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  burst({ freqLow = 200, freqHigh = 4000, dur = 0.1, vol = 0.2, dest = null, q = 1 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (freqLow + freqHigh) / 2;
    bp.Q.value = q;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = freqLow;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(dest || this.sfx || this.master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  footstep(loudness, surface = 'tile', dest = null) {
    if (!this.ctx) return;
    const vol = 0.05 + loudness * 0.1;
    if (surface === 'concrete') {
      this.burst({ freqLow: 120, freqHigh: 900, dur: 0.09, vol, q: 0.8, dest });
    } else {
      this.burst({ freqLow: 200, freqHigh: 2200, dur: 0.06, vol, q: 1.2, dest });
    }
    this.blip({ freq: 70 + Math.random() * 20, type: 'sine', dur: 0.07, vol: vol * 0.7, dest });
  }

  // Sharp, bright, unmistakable: his keyring.
  keyJingle(dest) {
    if (!this.ctx) return;
    const count = 3 + (Math.random() * 3 | 0);
    for (let i = 0; i < count; i++) {
      const t = i * 0.035;
      setTimeout(() => {
        this.blip({
          freq: 1800 + Math.random() * 2400,
          type: 'triangle',
          dur: 0.12,
          vol: 0.1,
          dest,
        });
      }, t * 1000);
    }
  }

  splitFlap(count = 14, dest = null) {
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        this.burst({ freqLow: 900, freqHigh: 5200, dur: 0.035, vol: 0.075, dest, q: 2 });
      }, i * 42 + Math.random() * 20);
    }
  }

  vendingClunk(dest) {
    this.blip({ freq: 110, type: 'square', dur: 0.22, vol: 0.2, dest, slide: -50 });
    this.burst({ freqLow: 300, freqHigh: 3000, dur: 0.18, vol: 0.16, dest });
  }

  coinDrop(dest) {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.blip({
        freq: 2200 + Math.random() * 1800, type: 'triangle', dur: 0.1, vol: 0.07, dest,
      }), i * 70);
    }
  }

  stamp(dest) {
    this.blip({ freq: 160, type: 'square', dur: 0.1, vol: 0.22, dest, slide: -80 });
    this.burst({ freqLow: 400, freqHigh: 2600, dur: 0.07, vol: 0.14, dest });
  }

  lockClick(ok = true) {
    this.blip({ freq: ok ? 900 : 300, type: 'square', dur: 0.06, vol: 0.14 });
    if (ok) setTimeout(() => this.blip({ freq: 1400, type: 'square', dur: 0.08, vol: 0.12 }), 70);
  }

  paper() {
    this.burst({ freqLow: 1800, freqHigh: 7000, dur: 0.16, vol: 0.09, q: 0.7 });
  }

  // One slip thumbed past another: a short, dry tick of card on card.
  flick() {
    this.burst({ freqLow: 2400 + Math.random() * 900, freqHigh: 9000, dur: 0.045, vol: 0.07, q: 1.1 });
    this.blip({ freq: 1400 + Math.random() * 300, type: 'triangle', dur: 0.012, vol: 0.02 });
  }

  // Caught: a hard, descending stinger.
  stinger() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(48, ctx.currentTime + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 1.9);
    this.burst({ freqLow: 60, freqHigh: 1200, dur: 1.2, vol: 0.22, dest: this.master });
  }

  // A throat torn open, right in your face: a harsh voice sliding down
  // through the vowels of a scream, air ripping through it, and a hit in the
  // gut underneath. It goes straight to the speakers, past the deafening
  // that the rest of a catch puts on the mix.
  scream(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = 1.5;
    const out = ctx.createGain();
    out.gain.value = 0.85 * (this.volume ?? 0.8) * vol;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 511) * 2 - 1) * 4);
    shaper.curve = curve;
    shaper.connect(out);
    out.connect(ctx.destination);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    env.gain.setValueAtTime(0.5, t + len * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    env.connect(shaper);
    // The voice: two detuned saws, falling, with a wobble in them.
    for (const detune of [0, 23]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640, t);
      osc.frequency.exponentialRampToValueAtTime(230, t + len);
      osc.detune.value = detune;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 38;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      // Vowel formants: an open "ah" closing toward "aw".
      for (const [f0, f1, q] of [[950, 700, 6], [1550, 1150, 7], [2900, 2500, 8]]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(f0, t);
        bp.frequency.exponentialRampToValueAtTime(f1, t + len);
        bp.Q.value = q;
        osc.connect(bp);
        bp.connect(env);
      }
      osc.start(t);
      lfo.start(t);
      osc.stop(t + len + 0.05);
      lfo.stop(t + len + 0.05);
    }
    // Breath tearing through it.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airBp = ctx.createBiquadFilter();
    airBp.type = 'bandpass';
    airBp.frequency.value = 3200;
    airBp.Q.value = 0.8;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.6;
    air.connect(airBp);
    airBp.connect(airGain);
    airGain.connect(env);
    air.start(t);
    air.stop(t + len + 0.05);
    // The hit.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.9, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    sub.connect(subGain);
    subGain.connect(out);
    sub.start(t);
    sub.stop(t + 0.65);
  }

  // Bones: a neck turning further than it goes.
  crack() {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.burst({ freqLow: 300, freqHigh: 2400, dur: 0.03, vol: 0.22, q: 2 }), i * 55 + Math.random() * 30);
    }
  }

  // Something slammed against the metal you are hiding in.
  bang(dest = null, vol = 1) {
    if (!this.ctx) return;
    this.burst({ freqLow: 60, freqHigh: 900, dur: 0.35, vol: 0.9 * vol, q: 0.6, dest });
    this.burst({ freqLow: 1800, freqHigh: 6000, dur: 0.2, vol: 0.35 * vol, q: 1.2, dest });
    this.blip({ freq: 96, type: 'square', dur: 0.5, vol: 0.28 * vol, dest, slide: -40 });
    this.blip({ freq: 41, type: 'sine', dur: 0.7, vol: 0.5 * vol, dest });
  }

  // In your chest, not in the room: dry.
  heartbeat(intensity = 1) {
    this.blip({ freq: 56, type: 'sine', dur: 0.14, vol: 0.18 * intensity, dest: this.master });
    setTimeout(() => this.blip({ freq: 48, type: 'sine', dur: 0.18, vol: 0.13 * intensity, dest: this.master }), 170);
  }

  // A whisper with no words in it. Three bandpass filters walk through vowel
  // formants, which the ear insists on hearing as speech it can almost make
  // out. `side` biases the stereo image; callers put it behind your head.
  whisper(side = 0, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.1 + Math.random() * 1.3;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.055 * vol, t + 0.25);
    out.gain.setTargetAtTime(0.0001, t + dur - 0.4, 0.2);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, side));
    out.connect(pan);
    pan.connect(this.master);

    // Vowel-ish formant triplets. Stepping between them is what makes it
    // sound like someone is forming words.
    const VOWELS = [
      [570, 840, 2410], [730, 1090, 2440], [300, 870, 2240],
      [530, 1840, 2480], [440, 1020, 2240], [270, 2290, 3010],
    ];
    const filters = [0, 1, 2].map((i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 9 + i * 1.5;
      bp.frequency.value = VOWELS[0][i];
      src.connect(bp);
      bp.connect(out);
      return bp;
    });

    const steps = 4 + Math.floor(Math.random() * 4);
    for (let s = 0; s < steps; s++) {
      const v = VOWELS[Math.floor(Math.random() * VOWELS.length)];
      const at = t + (dur * s) / steps;
      filters.forEach((bp, i) => bp.frequency.setTargetAtTime(v[i], at, 0.05));
    }

    src.start(t);
    src.stop(t + dur + 0.3);
  }

  // His breathing. Slow, wet, and with a rattle in it -- noise through a
  // formant that slides as the chest fills, chopped by a low oscillator so it
  // catches like something in the throat. Positional: you hear it before you
  // see him, and only when he is close.
  rasp(dest = null, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const inhale = 0.9 + Math.random() * 0.4;
    const hold = 0.15 + Math.random() * 0.2;
    const exhale = 1.2 + Math.random() * 0.5;
    const end = t + inhale + hold + exhale;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.5;
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.linearRampToValueAtTime(1150, t + inhale);
    bp.frequency.setValueAtTime(900, t + inhale + hold);
    bp.frequency.linearRampToValueAtTime(320, end);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.11 * vol, t + inhale * 0.8);
    env.gain.linearRampToValueAtTime(0.0001, t + inhale + hold * 0.5);
    env.gain.linearRampToValueAtTime(0.16 * vol, t + inhale + hold + 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    // The rattle: amplitude chopped at ~20 Hz, deeper on the way out.
    const rattle = ctx.createGain();
    rattle.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 17 + Math.random() * 8;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0.2, t);
    depth.gain.linearRampToValueAtTime(0.45, t + inhale + hold + 0.3);
    lfo.connect(depth);
    depth.connect(rattle.gain);

    src.connect(bp);
    bp.connect(rattle);
    rattle.connect(env);
    env.connect(dest || this.sfx || this.master);
    src.start(t);
    lfo.start(t);
    src.stop(end + 0.05);
    lfo.stop(end + 0.05);
  }

  // Knuckles on the inside of a thin steel door.
  knock(dest = null, count = 3, gap = 0.32) {
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        this.blip({ freq: 140 + Math.random() * 25, type: 'sine', dur: 0.12, vol: 0.28, dest });
        this.burst({ freqLow: 300, freqHigh: 2600, dur: 0.05, vol: 0.2, dest, q: 1.4 });
      }, i * gap * 1000 + Math.random() * 40);
    }
  }

  // Something heavy dragged across a hard floor, a little at a time.
  scrape(dest = null, seconds = 1.6) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.linearRampToValueAtTime(1300, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // Stuttering: grip, slip, grip.
    const steps = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < steps; i++) {
      const at = t + (seconds * i) / steps;
      g.gain.linearRampToValueAtTime(0.09 + Math.random() * 0.07, at + 0.04);
      g.gain.linearRampToValueAtTime(0.012, at + seconds / steps * 0.8);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.1);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest || this.sfx || this.master);
    src.start(t);
    src.stop(t + seconds + 0.2);
  }

  // Muffled tannoy speech: a filtered buzz shaped into syllables, plus hiss.
  // The station voice reading `text`. With `dest` (an emitter's input) it
  // comes out of the speakers in one place instead of all around you.
  pa(text, dest = null) {
    if (!this.ctx) return 0;
    const ctx = this.ctx;
    const syllables = Math.max(4, Math.min(28, Math.round(text.length / 3.2)));

    // Chime first.
    this.paChime(dest);

    const start = 0.5;
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1100;
    bandpass.Q.value = 1.1;
    const dist = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6);
    }
    dist.curve = curve;
    bus.connect(bandpass);
    bandpass.connect(dist);
    dist.connect(dest || this.master);
    // A tannoy in a hall this size is mostly echo: every horn in the
    // building says it a fraction later than the last. (An emitter brings
    // its own room.)
    if (this.verbIn && !dest) {
      const paSend = ctx.createGain();
      paSend.gain.value = 0.9;
      dist.connect(paSend);
      paSend.connect(this.verbIn);
    }

    // Tape hiss under the whole announcement.
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const hissHp = ctx.createBiquadFilter();
    hissHp.type = 'highpass';
    hissHp.frequency.value = 2600;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.022;
    hiss.connect(hissHp);
    hissHp.connect(hissGain);
    hissGain.connect(dest || this.master);
    hiss.start(ctx.currentTime + start - 0.1);
    hiss.stop(ctx.currentTime + start + syllables * 0.17 + 0.5);

    for (let i = 0; i < syllables; i++) {
      const t = ctx.currentTime + start + i * 0.17;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const base = 96 + Math.sin(i * 1.7) * 22 + (i % 3 === 0 ? 14 : 0);
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base * (0.9 + Math.random() * 0.25), t + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      const form = ctx.createBiquadFilter();
      form.type = 'bandpass';
      form.frequency.value = 500 + (i % 4) * 420;
      form.Q.value = 3;
      osc.connect(form);
      form.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.17);
    }
    return start + syllables * 0.17;
  }

  // Ding-dong.
  paChime(dest = null) {
    if (!this.ctx) return;
    this.blip({ freq: 880, type: 'sine', dur: 0.4, vol: 0.1, dest });
    setTimeout(() => this.blip({ freq: 660, type: 'sine', dur: 0.5, vol: 0.1, dest }), 180);
  }

  // A recording of a real voice, put through the station's tannoys: a
  // telephone's worth of bandwidth, driven into the horns until they crackle,
  // and the slap of the next horn along. `rate` under 1 slows and deepens it;
  // `reverse` plays it backwards. Returns how long it lasts, in seconds.
  paVoice(buffer, dest = null, { delay = 0.75, rate = 1, reverse = false, vol = 1 } = {}) {
    if (!this.ctx || !buffer) return 0;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = reverse ? reversed(ctx, buffer) : buffer;
    src.playbackRate.value = rate;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const pre = ctx.createGain();
    pre.gain.value = 2.4 * vol;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 511) * 2 - 1) * 2.2);
    shaper.curve = curve;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    const slap = ctx.createDelay(1);
    slap.delayTime.value = 0.11;
    const slapGain = ctx.createGain();
    slapGain.gain.value = 0.32;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(pre);
    pre.connect(shaper);
    shaper.connect(out);
    out.connect(dest || this.master);
    out.connect(slap);
    slap.connect(slapGain);
    slapGain.connect(slap);
    slapGain.connect(dest || this.master);
    src.start(t);
    const length = buffer.duration / rate;
    // The feedback loop rings on after the voice; cut it once it has died.
    setTimeout(() => { slapGain.disconnect(); out.disconnect(); }, (delay + length + 2) * 1000);
    return delay + length;
  }

  // The click and the open hiss of a microphone keyed on, close to you.
  micKey(on) {
    if (!this.ctx) return;
    this.blip({ freq: on ? 1900 : 1300, type: 'square', dur: 0.018, vol: 0.05 });
    this.burst({ freqLow: 2400, freqHigh: 8000, dur: on ? 0.25 : 0.12, vol: 0.025, q: 0.4 });
  }

  // A wrong buzz: the console refusing.
  buzz() {
    this.blip({ freq: 110, type: 'sawtooth', dur: 0.22, vol: 0.07 });
  }

  // ---- loops -------------------------------------------------------------

  startDiesel(emitter) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    src.connect(lp);
    lp.connect(g);
    g.connect(emitter.gain);
    src.start();

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.value = 26;
    const tg = ctx.createGain();
    tg.gain.value = 0.35;
    thud.connect(tg);
    tg.connect(emitter.gain);
    thud.start();
  }

  // A run of breath out of you after holding it too long: ragged and loud.
  gasp() {
    if (!this.ctx) return;
    this.burst({ freqLow: 500, freqHigh: 2600, dur: 0.55, vol: 0.2, q: 0.6 });
    setTimeout(() => this.burst({ freqLow: 400, freqHigh: 2000, dur: 0.7, vol: 0.13, q: 0.6 }), 650);
    setTimeout(() => this.burst({ freqLow: 450, freqHigh: 2200, dur: 0.5, vol: 0.09, q: 0.6 }), 1500);
  }

  // A steel door on dry hinges.
  doorCreak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.linearRampToValueAtTime(260, t + 0.5);
    osc.frequency.linearRampToValueAtTime(140, t + 1.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.15);
    g.gain.setValueAtTime(0.05, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(bp);
    bp.connect(g);
    g.connect(this.sfx ?? this.master);
    osc.start(t);
    osc.stop(t + 1.25);
  }

  // The belt motor, driven up while the carousel is running.
  boostConveyor(seconds) {
    if (!this.ctx || !this.conveyor) return;
    const t = this.ctx.currentTime;
    const g = this.conveyor.g.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1.6, t, 0.4);
    g.setTargetAtTime(0.5, t + seconds, 0.8);
  }

  startConveyor(emitter) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(bp);
    bp.connect(g);
    g.connect(emitter.gain);
    src.start();
    this.conveyor = { src, g };
    return this.conveyor;
  }

  // Warped 80s-ish jukebox tune, original and deliberately a bit wrong.
  playJukebox(emitter, songIndex = 0) {
    if (!this.ctx) return 0;
    const ctx = this.ctx;
    const songs = [
      { notes: [0, 3, 7, 10, 7, 3, 5, 2], tempo: 0.34, wave: 'triangle' },
      { notes: [0, 4, 7, 12, 11, 7, 4, 0], tempo: 0.28, wave: 'square' },
      { notes: [0, 2, 3, 7, 3, 2, -2, 0], tempo: 0.4, wave: 'sawtooth' },
    ];
    const song = songs[songIndex % songs.length];
    const root = 196;
    const bars = 4;
    let t = ctx.currentTime + 0.1;

    for (let bar = 0; bar < bars; bar++) {
      for (let i = 0; i < song.notes.length; i++) {
        const detune = 1 + (Math.random() - 0.5) * 0.012 - bar * 0.004; // tape warp
        const freq = root * Math.pow(2, song.notes[i] / 12) * detune;
        const osc = ctx.createOscillator();
        osc.type = song.wave;
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + song.tempo * 0.9);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        osc.connect(lp);
        lp.connect(g);
        g.connect(emitter.gain);
        osc.start(t);
        osc.stop(t + song.tempo);

        if (i % 2 === 0) {
          const bass = ctx.createOscillator();
          bass.type = 'sine';
          bass.frequency.value = freq / 4;
          const bg = ctx.createGain();
          bg.gain.setValueAtTime(0.0001, t);
          bg.gain.linearRampToValueAtTime(0.1, t + 0.02);
          bg.gain.exponentialRampToValueAtTime(0.0001, t + song.tempo * 1.8);
          bass.connect(bg);
          bg.connect(emitter.gain);
          bass.start(t);
          bass.stop(t + song.tempo * 2);
        }
        t += song.tempo;
      }
    }
    return t - ctx.currentTime;
  }

  // ---- cutscenes ---------------------------------------------------------

  // A coach door on its air rams: a long hiss, and the leaves banging home.
  doorHiss(dest = null, closing = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest || this.sfx || this.master);
    src.start(t);
    src.stop(t + 1.3);
    setTimeout(() => {
      this.blip({ freq: closing ? 70 : 95, type: 'square', dur: 0.12, vol: 0.14, dest, slide: -30 });
      this.burst({ freqLow: 200, freqHigh: 1400, dur: 0.1, vol: 0.12, dest });
    }, closing ? 950 : 1000);
  }

  // A conductor's punch through card: a snap and a click.
  punch(dest = null) {
    this.blip({ freq: 2600, type: 'square', dur: 0.025, vol: 0.12, dest });
    this.burst({ freqLow: 2500, freqHigh: 9000, dur: 0.04, vol: 0.14, dest, q: 0.8 });
    setTimeout(() => this.blip({ freq: 1400, type: 'triangle', dur: 0.05, vol: 0.08, dest }), 60);
  }

  // The coach under you: a diesel at `rev` (0 idling, 1 pulling hard) and
  // the road coming up through the floor at `road` (0..1). Not placed in the
  // world: you are inside it.
  engine() {
    if (!this.ctx) return { set() {}, stop() {} };
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 160;
    const rg = ctx.createGain();
    rg.gain.value = 0.9;
    rumble.connect(rlp);
    rlp.connect(rg);
    rg.connect(out);
    const firing = ctx.createOscillator();
    firing.type = 'sawtooth';
    firing.frequency.value = 34;
    const flp = ctx.createBiquadFilter();
    flp.type = 'lowpass';
    flp.frequency.value = 180;
    const fg = ctx.createGain();
    fg.gain.value = 0.16;
    firing.connect(flp);
    flp.connect(fg);
    fg.connect(out);
    const road = ctx.createBufferSource();
    road.buffer = this.noise;
    road.loop = true;
    const tlp = ctx.createBiquadFilter();
    tlp.type = 'lowpass';
    tlp.frequency.value = 520;
    const tg = ctx.createGain();
    tg.gain.value = 0;
    road.connect(tlp);
    tlp.connect(tg);
    tg.connect(out);
    rumble.start();
    firing.start();
    road.start();
    let stopped = false;
    return {
      set: (level, rev = 0, roadLevel = 0) => {
        if (stopped) return;
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(level * 0.55, now, 0.25);
        firing.frequency.setTargetAtTime(30 + rev * 34, now, 0.4);
        flp.frequency.setTargetAtTime(160 + rev * 260, now, 0.4);
        tg.gain.setTargetAtTime(roadLevel * 0.5, now, 0.5);
      },
      stop: (fade = 0.05) => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, fade);
        setTimeout(() => {
          for (const n of [rumble, firing, road]) {
            try { n.stop(); } catch { /* already stopped */ }
          }
          out.disconnect();
        }, fade * 6000 + 200);
      },
    };
  }

  // Something turning that should not turn that far: a long, dry creak.
  creak(dest = null, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(62, t);
    osc.frequency.linearRampToValueAtTime(44, t + 0.9);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 5;
    // Ratchet: the gain chopped into clicks.
    const chop = ctx.createGain();
    chop.gain.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(28, t);
    lfo.frequency.linearRampToValueAtTime(11, t + 1);
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth);
    depth.connect(chop.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2 * vol, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(bp);
    bp.connect(chop);
    chop.connect(g);
    g.connect(dest || this.sfx || this.master);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 1.2);
    lfo.stop(t + 1.2);
  }

  // A few birds, somewhere outside, at first light.
  birds(count = 6) {
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) {
      const at = i * (0.35 + Math.random() * 0.9);
      const f = 2600 + Math.random() * 1800;
      setTimeout(() => {
        const n = 2 + (Math.random() * 3 | 0);
        for (let k = 0; k < n; k++) {
          setTimeout(() => this.blip({ freq: f, type: 'sine', dur: 0.07, vol: 0.035, slide: 600 + Math.random() * 900 }), k * 95);
        }
      }, at * 1000);
    }
  }
}
