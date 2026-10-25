// The trailer's soundtrack, made by the game's own audio engine (src/audio.js)
// rendered offline: an OfflineAudioContext stands in for the real one, and
// the render is suspended at each cue to trigger the sound, so the hum, the
// dread drone, his keys, the door hiss and the stinger are exactly the ones
// the game plays. Cue times are trailer seconds, laid against trailer.json.
//
//   node tools/media/soundtrack.cjs OUT.wav
//
// Needs the capture dev server: npx vite --config tools/media/vite.capture.config.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'trailer.json'), 'utf8'));

// Where each segment starts, by shot name (or `card<i>` / `black<i>`).
const starts = {};
let at = 0;
for (const [i, s] of spec.segments.entries()) {
  starts[s.shot ?? (s.card ? `card${i}` : `black${i}`)] = at;
  at += s.dur;
}
const LENGTH = at;
// A shot's first frame is 4 frames into its scene (3 of preroll, then the
// first step): scene time s of a shot that began at scene time s0 lands at
// start + (s - s0 - 4/fps).
const LEAD = 4 / spec.fps;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => console.log('[page]', m.text()));
  await page.goto('http://127.0.0.1:5174/tools/media/cards.html');
  const b64 = await page.evaluate(async ({ starts, LENGTH, LEAD }) => {
    const SR = 48000;
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(SR * LENGTH), sampleRate: SR });
    // The engine makes its own context; hand it this one.
    window.AudioContext = function () { return ctx; };
    const { AudioEngine } = await import('/src/audio.js');

    // Suspend points are per render quantum and must be unique.
    const taken = new Set();
    const cue = (t, fn) => {
      let q = Math.max(1, Math.round((t * SR) / 128));
      while (taken.has(q)) q++;
      taken.add(q);
      ctx.suspend((q * 128) / SR).then(() => {
        try { fn(); } catch (e) { console.log('cue failed at', t, e.message); }
        ctx.resume();
      });
    };
    // The engine's own setTimeouts (a jingle's later keys, a door's thunk)
    // become suspends on the audio clock.
    window.setTimeout = (fn, ms = 0) => {
      cue(ctx.currentTime + Math.max(4, ms) / 1000, fn);
      return 0;
    };

    const a = new AudioEngine();
    a.volume = 0.8;
    a.init();
    const S = starts;
    // Scene time s in a shot that began at scene time s0.
    const sc = (shot, s, s0 = 0) => S[shot] + (s - s0 - LEAD);
    const mood = (t, fear, tension) => cue(t, () => a.setMood(fear, tension));
    const boom = (t, vol = 0.5) => cue(t, () => {
      a.blip({ freq: 44, type: 'sine', dur: 2.2, vol, slide: -16 });
      a.burst({ freqLow: 30, freqHigh: 260, dur: 1.4, vol: vol * 0.5, q: 0.5 });
    });
    const steps = (from, to, every, surface, loud) => {
      for (let t = from, n = 0; t < to; t += every, n++) {
        const k = (t - from) / Math.max(0.01, to - from);
        cue(t, () => a.footstep(loud(k), surface));
        if (n % 2 === 1) cue(t + 0.06, () => a.keyJingle());
      }
    };
    const heart = (from, to, every, strength) => {
      for (let t = from; t < to; t += every) {
        const k = (t - from) / Math.max(0.01, to - from);
        cue(t, () => a.heartbeat(strength(k)));
      }
    };

    // ---- the night begins ----
    mood(0.05, 0, 0.1);
    cue(0.9, () => a.splitFlap(18));
    cue(2.5, () => a.splitFlap(10));

    // Waking: the gasp as you sit up.
    mood(S.wake, 0.1, 0.2);
    cue(sc('wake', 6.8, 1.6), () => a.gasp());

    // The board turning over.
    mood(S.hall, 0.05, 0.3);
    cue(S.hall + 0.7, () => a.splitFlap(22));
    cue(S.hall + 3.4, () => a.splitFlap(12));

    // Bay 9: the diesel idling, his punch through the card, the door.
    let bus;
    cue(S.bus + 0.01, () => { bus = a.engine(); bus.set(0.6, 0.1, 0); });
    cue(sc('bus', 5.2, 4.7), () => a.punch());
    cue(sc('bus', 6.6, 4.7), () => a.doorHiss());
    cue(S.rules - 0.05, () => bus?.stop(0.08));
    mood(S.bus, 0.05, 0.35);

    // The rules, then the hum cut dead for the lie.
    mood(S.rules, 0.1, 0.45);
    cue(S.card5 + 0.02, () => a.cutHum(1.9));
    boom(S.card5 + 0.04, 0.4);
    mood(S.card5, 0.2, 0.6);

    // Him, up the corridor: footsteps and keys getting louder, then he stops.
    mood(S.attendant + 0.5, 0.25, 0.7);
    mood(S.attendant + 2.6, 0.45, 0.95);
    steps(sc('attendant', 0.3), sc('attendant', 5.0), 0.4636, 'concrete', (k) => 0.25 + 0.7 * k);
    heart(sc('attendant', 2.6), S.hide, 0.82, (k) => 0.6 + 0.4 * k);
    cue(sc('attendant', 5.3), () => a.creak(null, 0.7));
    cue(sc('attendant', 5.9), () => a.whisper(0.4, 0.6));

    // Under the bench: his feet going past, your heart.
    mood(S.hide, 0.25, 1.0);
    steps(sc('hide', 0.25), sc('hide', 4.0), 0.449, 'tile', (k) => 0.35 + 0.65 * Math.sin(Math.min(1, k * 1.05) * Math.PI * 0.5));
    heart(S.hide + 0.2, S.cctv, 0.7, () => 1);

    // The monitors: the tape hissing, something on four.
    mood(S.cctv, 0.3, 0.9);
    for (const dt of [0.15, 1.3, 2.4, 3.6]) cue(S.cctv + dt, () => a.burst({ freqLow: 1500, freqHigh: 7000, dur: 0.2, vol: 0.05, q: 0.5 }));
    cue(S.cctv + 2.0, () => a.whisper(-0.7, 0.8));

    // The coach on the coast road; the engine dies; they all turn.
    const turnS = 2.9;
    let coast;
    mood(S.ghosts, 0.2, 0.7);
    cue(S.ghosts + 0.01, () => { coast = a.engine(); coast.set(0.85, 0.6, 0.7); });
    cue(sc('ghosts', 0.3), () => { coast?.stop(0.08); a.cutHum(6); });
    cue(sc('ghosts', turnS), () => {
      a.creak(null, 1.2);
      a.burst({ freqLow: 200, freqHigh: 8000, dur: 0.7, vol: 0.18, q: 0.4 });
    });
    cue(sc('ghosts', turnS + 0.5), () => a.whisper(0, 1));
    mood(sc('ghosts', turnS), 0.6, 1.0);

    // Bay 0: down the road of terminals; its head comes round.
    let road;
    mood(S.bay0, 0.3, 0.8);
    cue(S.bay0 + 0.01, () => { road = a.engine(); road.set(0.8, 0.7, 0.6); });
    cue(sc('bay0', 26.4, 25.0), () => a.creak(null, 1.4));
    cue(S.black11, () => { road?.stop(0.05); a.cutHum(2.4); a.deafen(1.0); });
    mood(S.black11, 0.1, 0.5);
    cue(S.black11 + 0.5, () => a.whisper(0.8, 0.45));

    // His face.
    cue(sc('face', 0.25), () => {
      a.stinger();
      a.burst({ freqLow: 300, freqHigh: 9000, dur: 0.9, vol: 0.32, q: 0.4 });
      a.deafen(1.4);
    });
    boom(sc('face', 0.25) + 0.01, 0.6);

    // The title.
    mood(S.title, 0, 0.15);
    boom(S.title + 0.05, 0.34);
    cue(S.title + 1.4, () => a.splitFlap(24));

    const buf = await ctx.startRendering();
    // 16-bit PCM WAV.
    const n = buf.length;
    const ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const data = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
    str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true);
    data.setUint32(24, SR, true); data.setUint32(28, SR * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true);
    str(36, 'data'); data.setUint32(40, n * 4, true);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        const v = ch[c][i];
        peak = Math.max(peak, Math.abs(v));
        data.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, v)) * 32767, true);
      }
    }
    console.log('rendered', (n / SR).toFixed(2), 's, peak', peak.toFixed(3));
    const bytes = new Uint8Array(data.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { starts, LENGTH, LEAD });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('wrote', out, `(${LENGTH.toFixed(1)} s)`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
