import * as THREE from 'three';

// The public address console in Security, worked by hand.
//
// Leaning over it shows the panel: a VU meter and an ON AIR lamp, five lit
// zone buttons, a chime, a LIVE MIC switch, and the long PUSH TO TALK bar.
// Moving the mouse (or the stick, or a finger) moves your eye across it, and
// whatever is in the middle of the view is what E, a click or A presses.
// Number keys pick a zone, C chimes, and Space (LT, or HOLD TO TALK on a
// touchscreen) is push-to-talk.
//
// With the LIVE MIC switch off, talking reads the zone's announcement in the
// station's voice. With it on, it is your voice: recorded while you hold the
// bar, and nowhere else but here, then played out of that zone's speakers
// through the tannoys when you let go. Either way he walks to the zone and
// stays a while. Shout, and the Security room hears you too.

export const PA_ZONES = [
  { label: 'BAGGAGE', node: 'bag_c', line: 'Attention please. A cleanup is required in Baggage Claim. Attendant to Baggage Claim.' },
  { label: 'TICKETS', node: 'ticket_c', line: 'Attention please. Lost property has been handed in at the Ticket Office. Attendant to the Ticket Office.' },
  { label: 'DINER', node: 'diner_c', line: 'Attention please. There is a spill at the Diner Counter. Attendant to respond.' },
  { label: 'RESTROOMS', node: 'rest_c', line: 'Attention please. There is a disturbance in the Restrooms. Attendant to respond.' },
  { label: 'BAY 9', node: 'bay_w', line: 'Attention please. The three thirty-three to the coast is boarding at Bay 9. Attendant to Bay 9.' },
];

const FACE_W = 0.5;
const FACE_H = 0.172;
const TEX_W = 1024;
const TEX_H = 352;
// The longest a recording runs before the console cuts it off.
const MAX_TALK = 8;
// Loud enough, as a microphone level, to be heard through the door.
const SHOUT = 0.22;

// Where everything is on the panel, in canvas pixels.
const PARTS = [
  ...PA_ZONES.map((z, i) => ({ id: 'zone' + i, zone: i, x: 236 + i * 118, y: 96, w: 108, h: 112, label: z.label })),
  { id: 'talk', x: 236, y: 232, w: 580, h: 92, label: 'PUSH TO TALK' },
  { id: 'chime', x: 862, y: 70, w: 122, h: 122, label: 'CHIME' },
  { id: 'mic', x: 852, y: 212, w: 142, h: 116, label: 'LIVE MIC' },
];

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// The amplifier: a sloped steel box, its panel on the slope. Faces +z.
export function makePAConsole(mats) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  // Side profile in (z, y): deep at the bottom, the panel sloping back.
  shape.moveTo(0.11, 0);
  shape.lineTo(0.11, 0.09);
  shape.lineTo(-0.03, 0.19);
  shape.lineTo(-0.11, 0.19);
  shape.lineTo(-0.11, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: FACE_W + 0.04, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate((FACE_W + 0.04) / 2, 0, 0);
  const body = new THREE.Mesh(geo, mats.body);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.2, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(FACE_W, FACE_H), faceMat);
  // On the slope, a hair proud of it.
  face.position.set(0, 0.14 + 0.814 * 0.002, 0.04 + 0.581 * 0.002);
  face.rotation.x = -0.951;
  face.userData.keepUVs = true;
  face.userData.noShadow = true;
  g.add(face);
  return { group: g, face, canvas, tex };
}

export class PAConsole {
  constructor(game, built, fonts) {
    this.game = game;
    this.face = built.face;
    this.canvas = built.canvas;
    this.tex = built.tex;
    this.fonts = fonts;
    this.zone = -1;
    this.hover = null;
    this.talking = null;
    this.level = 0;
    this.needle = 0;
    this.lastVoice = null;
    this.drawnAt = 0;
    this.target = this.makeTarget();
    this.draw();
  }

  get micOn() {
    return !!this.game.settings.paMic;
  }

  makeTarget() {
    const pa = this;
    return {
      label: 'PA console',
      arrows: true,
      talk: true,
      reticle: true,
      useLabel: 'PRESS',
      view: (eye, aspect, fov, look, out) => pa.view(aspect, fov, look, out),
      onStart: () => pa.open(),
      onEnd: () => pa.close(),
      update: () => pa.update(),
      prompt: () => pa.prompt(),
      key: (code, down) => pa.key(code, down),
      use: () => pa.press(pa.hover),
    };
  }

  // Square on to the panel and close, the eye sliding across it as you look
  // about; whatever ends up in the middle of the view is under your finger.
  view(aspect, fov, look, out) {
    this.face.updateWorldMatrix(true, false);
    const e = this.face.matrixWorld.elements;
    _x.set(e[0], e[1], e[2]).normalize();
    _u.set(e[4], e[5], e[6]).normalize();
    _n.set(e[8], e[9], e[10]).normalize();
    _t.setFromMatrixPosition(this.face.matrixWorld);
    const dist = 0.44 / Math.max(1, look.zoomNow * 0.85);
    out.position.copy(_t).addScaledVector(_n, dist).addScaledVector(UP, 0.02);
    // Where the eye is aimed, in the panel's own terms.
    const u = 0.5 + look.lx * 0.5;
    const v = 0.5 + look.ly * 0.5;
    _v.copy(_t).addScaledVector(_x, (u - 0.5) * FACE_W).addScaledVector(_u, (v - 0.5) * FACE_H);
    out.position.addScaledVector(_x, (u - 0.5) * FACE_W * 0.35);
    _m.lookAt(out.position, _v, _u);
    out.quaternion.setFromRotationMatrix(_m);
    const need = (FACE_W * 0.62) / dist / Math.max(0.5, aspect);
    out.fov = Math.min(fov, Math.max(20, (2 * Math.atan(need) * 180) / Math.PI));
    out.dist = dist;
    this.aimAt(u * TEX_W, (1 - v) * TEX_H);
    return out;
  }

  aimAt(px, py) {
    const was = this.hover;
    this.hover = PARTS.find((p) => px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h)?.id ?? null;
    if (this.hover !== was) this.dirty = true;
  }

  open() {
    this.hover = null;
    this.dirty = true;
    if (this.micOn) this.openMic();
  }

  close() {
    if (this.talking) this.endTalk(true);
    this.closeMic();
    this.hover = null;
    this.level = 0;
    this.draw();
  }

  prompt() {
    if (this.game.touch) return '';
    const what = this.talking
      ? `<b>ON AIR</b> &middot; ${PA_ZONES[this.zone].label}`
      : this.hover ? PARTS.find((p) => p.id === this.hover).label : this.zone >= 0 ? `Zone: ${PA_ZONES[this.zone].label}` : 'Pick a zone';
    if (this.game.pad?.active) {
      return `${what}<span class="sep"></span><kbd>A</kbd> press<span class="sep"></span><kbd>LT</kbd> hold to talk<span class="sep"></span><kbd>&#9664;</kbd> <kbd>&#9654;</kbd> zone<span class="sep"></span><kbd>B</kbd> stand up`;
    }
    return `${what}<span class="sep"></span><kbd>E</kbd> press<span class="sep"></span><kbd>SPACE</kbd> hold to talk<span class="sep"></span><kbd>1</kbd>&ndash;<kbd>5</kbd> zone<span class="sep"></span><kbd>Q</kbd> stand up`;
  }

  key(code, down) {
    if (code === 'Space') {
      if (down && !this.talking) this.startTalk('held');
      // The station's voice reads to the end whatever your thumb does; only
      // a recording stops when you let go.
      else if (!down && this.talking?.by === 'held' && this.talking.recorder) this.endTalk();
      return true;
    }
    if (!down) return false;
    const n = /^Digit([1-5])$/.exec(code);
    if (n) return this.pickZone(Number(n[1]) - 1), true;
    if (code === 'ArrowRight' || code === 'KeyD') return this.pickZone((this.zone + 1) % PA_ZONES.length), true;
    if (code === 'ArrowLeft' || code === 'KeyA') return this.pickZone((this.zone + PA_ZONES.length - 1) % PA_ZONES.length), true;
    if (code === 'KeyC') return this.chime(), true;
    if (code === 'KeyV') return this.toggleMic(), true;
    return false;
  }

  // E, a click or A on whatever is in the middle of the view.
  press(id) {
    if (!id) {
      this.game.audio.blip({ freq: 520, type: 'square', dur: 0.01, vol: 0.02 });
      return true;
    }
    const part = PARTS.find((p) => p.id === id);
    if (part.zone !== undefined) this.pickZone(part.zone);
    else if (id === 'chime') this.chime();
    else if (id === 'mic') this.toggleMic();
    else if (id === 'talk') {
      if (!this.talking) this.startTalk('pressed');
      else if (this.talking.recorder) this.endTalk();
    }
    return true;
  }

  pickZone(i) {
    if (this.talking) return;
    this.zone = i < 0 ? PA_ZONES.length - 1 : i;
    this.game.audio.blip({ freq: 760, type: 'square', dur: 0.016, vol: 0.05 });
    this.game.audio.blip({ freq: 240, type: 'sine', dur: 0.05, vol: 0.04 });
    this.dirty = true;
  }

  // The chime alone, in the zone: no announcement, but he stops what he is
  // doing to listen.
  chime() {
    if (this.zone < 0) return this.refuse();
    const z = PA_ZONES[this.zone];
    const node = this.game.level.nav.nodes[z.node];
    const em = this.game.audio.makeEmitter(node.x, node.z, 70);
    this.game.audio.paChime(em.gain);
    this.game.audio.releaseEmitter(em, 2);
    this.game.caption('pa', `PA chime: ${z.label}`, node.x, node.z, 70);
    this.game.makeNoise(node.x, node.z, 0.3, 'the PA chime');
    this.flash = 0.6;
    this.dirty = true;
  }

  refuse() {
    this.game.audio.buzz();
    this.game.subtitle('Nothing lights. Pick a zone first: the buttons along the top.', 3);
  }

  // ---- talking -------------------------------------------------------------

  startTalk(by) {
    if (this.talking) return;
    if (this.zone < 0) return this.refuse();
    this.game.audio.micKey(true);
    const talk = { by, t0: performance.now(), peak: 0, chunks: [], recorder: null };
    this.talking = talk;
    this.dirty = true;
    if (this.micOn && this.stream) {
      try {
        const rec = new MediaRecorder(this.stream);
        // The recording arrives when it stops, after `talking` is cleared.
        rec.ondataavailable = (e) => { if (e.data.size) talk.chunks.push(e.data); };
        rec.start();
        this.talking.recorder = rec;
      } catch {
        this.talking.recorder = null;
      }
    }
    if (!this.talking.recorder) {
      // The station's own voice reads the announcement, start to finish.
      const z = PA_ZONES[this.zone];
      const length = this.broadcast(null);
      this.game.later(length, () => {
        if (this.talking && !this.talking.recorder) this.endTalk();
      });
      this.game.subtitle(`PA (${z.label}): "${z.line}"`, Math.max(5, length));
    }
  }

  // Let go of the bar. A recording goes out now; a cancelled one (you walked
  // away mid-sentence) does not.
  endTalk(cancel = false) {
    const talk = this.talking;
    if (!talk) return;
    this.talking = null;
    this.dirty = true;
    this.game.audio.micKey(false);
    if (!talk.recorder) return;
    const zone = this.zone;
    const loud = talk.peak > SHOUT;
    talk.recorder.onstop = async () => {
      if (cancel || !talk.chunks.length) return;
      try {
        const blob = new Blob(talk.chunks, { type: talk.recorder.mimeType });
        const buffer = await this.game.audio.ctx.decodeAudioData(await blob.arrayBuffer());
        this.lastVoice = buffer;
        this.broadcast(buffer, zone, loud);
      } catch {
        this.game.toast('The tape would not play back.');
      }
    };
    try {
      talk.recorder.stop();
    } catch {
      // Already stopped.
    }
  }

  // Sends the announcement (the station's, or `voice`) out of `zone`'s
  // speakers, and sends him there. Returns how long it lasts.
  broadcast(voice, zone = this.zone, loud = false) {
    const g = this.game;
    const z = PA_ZONES[zone];
    const node = g.level.nav.nodes[z.node];
    const em = g.audio.makeEmitter(node.x, node.z, 80);
    const length = voice ? g.audio.paVoice(voice, em.gain) : g.audio.pa(z.line, em.gain);
    if (voice) {
      g.audio.paChime(em.gain);
      g.subtitle(`Your voice comes out of the speakers in ${z.label === 'BAY 9' ? 'the bays' : z.label.toLowerCase()}, a long way off.`, 4);
    }
    g.audio.releaseEmitter(em, length + 3);
    g.caption('pa', `PA: ${z.label}`, node.x, node.z, 80);
    g.later(Math.min(2, length), () => {
      if (g.attendant.lureTo(z.node)) {
        g.toast(`He is on his way to ${z.label === 'BAY 9' ? 'Bay 9' : z.label.toLowerCase()}.`);
        g.note('Security', 'The PA console in Security sends the Attendant to whichever zone you announce.');
      } else if (g.attendant.state === 'wait') {
        g.toast('Nothing moves. He is not leaving Bay 9 now.');
      }
    });
    if (loud) {
      // Shouting carries through the door as well as down the wire.
      g.later(length + 6, () => {
        g.subtitle('You were loud. Loud enough to hear from outside this room.', 4);
        g.attendant.hear(17, -6, 0.75, 'a voice in Security');
      });
      g.note('Security', 'Shouting into the PA carries out of Security too. He comes to see who.');
    }
    // Late in the night, now and then, the station keeps a copy.
    if (voice && g.clock.isAfter('02:00') && !g.voiceReplayed && Math.random() < 0.3) {
      g.voiceReplayed = true;
      g.later(25 + Math.random() * 30, () => this.replay());
    }
    return length;
  }

  // Your own voice, from somewhere you are not: backwards, slowed, wrong.
  // Without a recording, the station says your name instead.
  replay() {
    const g = this.game;
    const p = g.player.position;
    const far = PA_ZONES
      .map((z) => g.level.nav.nodes[z.node])
      .sort((a, b) => Math.hypot(b.x - p.x, b.z - p.z) - Math.hypot(a.x - p.x, a.z - p.z))[0];
    const em = g.audio.makeEmitter(far.x, far.z, 80);
    let length;
    if (this.lastVoice) {
      length = g.audio.paVoice(this.lastVoice, em.gain, { rate: 0.72, reverse: true, vol: 1.2 });
      g.subtitle('Somewhere in the station the PA plays your voice back. Backwards.', 5);
    } else {
      length = g.audio.pa(`${g.playerName}. ${g.playerName}. Please remain where you are.`, em.gain);
      g.subtitle(`The PA, from nowhere near a microphone: "${g.playerName}. Please remain where you are."`, 5);
    }
    g.audio.releaseEmitter(em, length + 3);
    g.fear.wantFear(0.6);
    g.fear.kick('aberration', 0.8);
    return length;
  }

  // ---- your microphone -----------------------------------------------------

  async toggleMic() {
    if (this.talking) return;
    const s = this.game.settings;
    if (this.micOn) {
      s.set('paMic', false);
      this.closeMic();
      this.game.audio.blip({ freq: 400, type: 'square', dur: 0.03, vol: 0.05 });
      this.dirty = true;
      return;
    }
    this.game.audio.blip({ freq: 900, type: 'square', dur: 0.03, vol: 0.05 });
    s.set('paMic', true);
    this.dirty = true;
    const ok = await this.openMic();
    if (ok) {
      this.game.subtitle('LIVE MIC. Hold the bar and speak: your own voice goes out of the speakers. It stays on this computer; nothing is saved or sent.', 7);
    }
  }

  async openMic() {
    if (this.stream) return true;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.micFailed('This browser has no microphone to give the PA.');
      return false;
    }
    try {
      this.stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.micFailed('The browser would not open the microphone.');
      return false;
    }
    // Stood up while the browser was asking.
    if (this.game.player.inspecting?.target !== this.target) {
      this.closeMic();
      return false;
    }
    const ctx = this.game.audio.ctx;
    if (ctx) {
      this.micSource = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      // To the meter only: never to the speakers, or it would howl.
      this.micSource.connect(this.analyser);
      this.samples = new Float32Array(this.analyser.fftSize);
    }
    this.dirty = true;
    return true;
  }

  micFailed(why) {
    this.game.settings.set('paMic', false);
    this.game.toast(why);
    this.dirty = true;
  }

  // Off whenever you step away, so the browser's microphone light goes out.
  closeMic() {
    this.micSource?.disconnect();
    this.micSource = null;
    this.analyser = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }

  // ---- every frame while you are at it --------------------------------------

  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastUpdate ?? now)) / 1000);
    this.lastUpdate = now;
    let level = 0;
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i];
      level = Math.sqrt(sum / this.samples.length);
    } else if (this.talking) {
      // The station voice, on the meter: syllables.
      const t = (now - this.talking.t0) / 1000;
      level = 0.08 + Math.abs(Math.sin(t * 18)) * 0.12 * (0.6 + 0.4 * Math.sin(t * 2.3));
    }
    this.level = level;
    if (this.talking) {
      this.talking.peak = Math.max(this.talking.peak, level);
      if (this.talking.recorder && (now - this.talking.t0) / 1000 > MAX_TALK) this.endTalk();
    }
    // A real needle has weight: up fast, back slowly.
    const want = Math.min(1, level * 4.2);
    this.needle += (want - this.needle) * Math.min(1, dt * (want > this.needle ? 18 : 5));
    this.flash = Math.max(0, (this.flash ?? 0) - dt);
    if (this.dirty || now - this.drawnAt > 50) this.draw();
  }

  draw() {
    this.drawnAt = performance.now();
    this.dirty = false;
    const ctx = this.canvas.getContext('2d');
    const { sign, mono } = this.fonts;
    const W = TEX_W;
    const H = TEX_H;
    // Hammertone steel.
    ctx.fillStyle = '#272a28';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.012 + (i % 3) * 0.006})`;
      ctx.fillRect(0, (i * 37) % H, W, 1);
    }
    // The maker's strip.
    ctx.fillStyle = '#c9c0a2';
    ctx.fillRect(16, 12, W - 32, 42);
    ctx.fillStyle = '#1d1f1e';
    ctx.font = `700 26px ${sign}`;
    ctx.textAlign = 'left';
    ctx.fillText('GRAYHOLLOW TRANSIT', 30, 43);
    ctx.textAlign = 'right';
    ctx.font = `600 20px ${sign}`;
    ctx.fillText('PUBLIC ADDRESS  ·  MODEL 9', W - 30, 41);

    const lit = (on, a, b) => (on ? a : b);
    const hover = (id, x, y, w, h, round = false) => {
      if (this.hover !== id) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 244, 210, 0.9)';
      ctx.lineWidth = 4;
      ctx.shadowColor = 'rgba(255, 230, 160, 0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      if (round) ctx.arc(x + w / 2, y + h / 2, w / 2 + 4, 0, Math.PI * 2);
      else ctx.rect(x - 4, y - 4, w + 8, h + 8);
      ctx.stroke();
      ctx.restore();
    };

    // VU meter.
    ctx.fillStyle = '#e7dcb8';
    ctx.fillRect(24, 70, 190, 150);
    ctx.strokeStyle = '#1d1f1e';
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 70, 190, 150);
    const cx = 119;
    const cy = 205;
    ctx.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI * 0.8 + (i / 10) * Math.PI * 0.6;
      ctx.strokeStyle = i >= 8 ? '#b0281c' : '#1d1f1e';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92);
      ctx.lineTo(cx + Math.cos(a) * (i % 5 === 0 ? 76 : 82), cy + Math.sin(a) * (i % 5 === 0 ? 76 : 82));
      ctx.stroke();
    }
    ctx.fillStyle = '#b0281c';
    ctx.font = `700 18px ${sign}`;
    ctx.textAlign = 'center';
    ctx.fillText('+3', cx + 74, 112);
    ctx.fillStyle = '#1d1f1e';
    ctx.fillText('VU', cx, 178);
    const na = -Math.PI * 0.8 + this.needle * Math.PI * 0.6;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(na) * 98, cy + Math.sin(na) * 98);
    ctx.stroke();

    // ON AIR.
    const onAir = !!this.talking;
    ctx.fillStyle = lit(onAir, '#ff3b24', '#3a1612');
    if (onAir) {
      ctx.save();
      ctx.shadowColor = '#ff5a3a';
      ctx.shadowBlur = 28;
    }
    ctx.fillRect(24, 236, 190, 84);
    if (onAir) ctx.restore();
    ctx.fillStyle = lit(onAir, '#fff1d8', '#6a3a32');
    ctx.font = `700 40px ${sign}`;
    ctx.fillText('ON AIR', 119, 292);

    // Zone buttons.
    ctx.font = `600 15px ${sign}`;
    ctx.fillStyle = '#a49c84';
    ctx.textAlign = 'left';
    ctx.fillText('ZONE', 236, 86);
    for (const p of PARTS.filter((q) => q.zone !== undefined)) {
      const on = this.zone === p.zone;
      if (on) {
        ctx.save();
        ctx.shadowColor = '#ffb640';
        ctx.shadowBlur = 24;
      }
      ctx.fillStyle = lit(on, '#ffbe4a', '#4a3c22');
      ctx.fillRect(p.x, p.y, p.w, p.h);
      if (on) ctx.restore();
      ctx.fillStyle = lit(on, '#2a1a06', '#a8915e');
      ctx.textAlign = 'center';
      ctx.font = `700 ${p.label.length > 8 ? 19 : 24}px ${sign}`;
      ctx.fillText(p.label, p.x + p.w / 2, p.y + p.h / 2 + 8);
      ctx.font = `500 14px ${mono}`;
      ctx.fillText(String(p.zone + 1), p.x + p.w / 2, p.y + 22);
      hover(p.id, p.x, p.y, p.w, p.h);
    }

    // The talk bar.
    const talk = PARTS.find((p) => p.id === 'talk');
    ctx.fillStyle = lit(onAir, '#d8321e', '#5a1c14');
    ctx.fillRect(talk.x, talk.y, talk.w, talk.h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 22; i++) ctx.fillRect(talk.x + 12 + i * 26, talk.y + 10, 6, talk.h - 20);
    ctx.fillStyle = lit(onAir, '#fff1d8', '#d9a294');
    ctx.font = `700 34px ${sign}`;
    ctx.textAlign = 'center';
    const sending = onAir && this.talking.recorder;
    ctx.fillText(sending ? 'RECORDING  ·  LET GO TO SEND' : onAir ? 'ON AIR' : 'PUSH TO TALK', talk.x + talk.w / 2, talk.y + talk.h / 2 + 12);
    hover('talk', talk.x, talk.y, talk.w, talk.h);

    // Chime.
    const ch = PARTS.find((p) => p.id === 'chime');
    const flash = (this.flash ?? 0) > 0;
    ctx.fillStyle = lit(flash, '#fff6d0', '#b7ad8e');
    ctx.beginPath();
    ctx.arc(ch.x + ch.w / 2, ch.y + ch.h / 2, ch.w / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d1f1e';
    ctx.font = `700 22px ${sign}`;
    ctx.fillText('CHIME', ch.x + ch.w / 2, ch.y + ch.h / 2 + 8);
    hover('chime', ch.x, ch.y, ch.w, ch.h, true);

    // LIVE MIC: a toggle lever.
    const mic = PARTS.find((p) => p.id === 'mic');
    const live = this.micOn;
    ctx.fillStyle = '#1b1d1c';
    ctx.fillRect(mic.x, mic.y, mic.w, mic.h);
    ctx.fillStyle = '#a49c84';
    ctx.font = `700 18px ${sign}`;
    ctx.fillText('LIVE MIC', mic.x + mic.w / 2, mic.y + 24);
    ctx.font = `600 14px ${sign}`;
    ctx.fillText(live ? 'YOUR VOICE' : 'STATION VOICE', mic.x + mic.w / 2, mic.y + mic.h - 10);
    ctx.fillStyle = '#5a5a56';
    ctx.fillRect(mic.x + mic.w / 2 - 22, mic.y + 40, 44, 44);
    ctx.fillStyle = '#d6d2c6';
    ctx.fillRect(mic.x + mic.w / 2 - 7, live ? mic.y + 30 : mic.y + 62, 14, 32);
    ctx.fillStyle = lit(live && this.stream, '#58ff8a', '#1d3a26');
    ctx.beginPath();
    ctx.arc(mic.x + mic.w - 20, mic.y + 62, 8, 0, Math.PI * 2);
    ctx.fill();
    hover('mic', mic.x, mic.y, mic.w, mic.h);

    this.tex.needsUpdate = true;
  }
}
