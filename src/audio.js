// Everything is synthesized at runtime: fluorescent hum, the Attendant's keys,
// the PA, the jukebox. No audio files to ship.

function noiseBuffer(ctx, seconds = 2) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
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

  // ---- spatial helpers ----------------------------------------------------

  makeEmitter(x, z, maxDist = 26) {
    // The context does not exist until the player's first gesture, but the
    // Director does not know that and should not have to. Hand back an inert
    // emitter rather than throwing: an exception here would propagate out of
    // event.run() and cost the frame every system downstream of it.
    if (!this.ctx) {
      return { x, z, maxDist, gain: null, pan: null, volume: 1, muted: true, dead: true };
    }
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    gain.connect(pan);
    pan.connect(this.master);
    const em = { x, z, maxDist, gain, pan, volume: 1, muted: false };
    this.emitters.push(em);
    return em;
  }

  // One-shots park an emitter in the world for a few seconds. Without this they
  // would accumulate in the mix graph for the rest of the night.
  releaseEmitter(em, after = 0) {
    const drop = () => {
      const i = this.emitters.indexOf(em);
      if (i >= 0) this.emitters.splice(i, 1);
      try { em.gain.disconnect(); em.pan.disconnect(); } catch { /* already gone */ }
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
    for (const em of this.emitters) {
      const dx = em.x - lx;
      const dz = em.z - lz;
      const dist = Math.hypot(dx, dz);
      let att = Math.max(0, 1 - dist / em.maxDist);
      att *= att;
      if (occludedFn && att > 0.001 && occludedFn(em.x, em.z)) att *= 0.35;
      const target = em.muted ? 0 : att * em.volume;
      em.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);

      // Right vector is (cos yaw, -sin yaw).
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const side = dist > 0.001 ? (dx * rx + dz * rz) / dist : 0;
      em.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, side)), this.ctx.currentTime, 0.1);
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
    g.connect(dest || this.master);
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
    g.connect(dest || this.master);
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
    this.burst({ freqLow: 60, freqHigh: 1200, dur: 1.2, vol: 0.22 });
  }

  heartbeat(intensity = 1) {
    this.blip({ freq: 56, type: 'sine', dur: 0.14, vol: 0.18 * intensity });
    setTimeout(() => this.blip({ freq: 48, type: 'sine', dur: 0.18, vol: 0.13 * intensity }), 170);
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
    env.connect(dest || this.master);
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
    g.connect(dest || this.master);
    src.start(t);
    src.stop(t + seconds + 0.2);
  }

  // Muffled tannoy speech: a filtered buzz shaped into syllables, plus hiss.
  pa(text) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const syllables = Math.max(4, Math.min(28, Math.round(text.length / 3.2)));

    // Chime first.
    this.blip({ freq: 880, type: 'sine', dur: 0.4, vol: 0.1 });
    setTimeout(() => this.blip({ freq: 660, type: 'sine', dur: 0.5, vol: 0.1 }), 180);

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
    dist.connect(this.master);

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
    hissGain.connect(this.master);
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
    g.connect(this.master);
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
    g.connect(dest || this.master);
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
    g.connect(dest || this.master);
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
