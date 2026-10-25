import * as THREE from 'three';
import { PASSENGERS } from './content.js';

// The shoebox of transfer slips on the Lost & Found desk, as something you
// lean over and thumb through rather than a list on a screen.
//
// The slips stand on end in the box, one behind another, the way a card file
// does. The one at the front of the run is pulled up a little so you can read
// it; the ones you have already been through lie tipped forward against the
// front of the box. Scroll, the arrow keys, the D-pad or a sideways drag
// thumbs to the next; E (or a click, or A) takes the slip you are reading.
//
// In the box's own frame: x runs from the front of the box (where you stand)
// to the back, y is up, and a slip's printed face looks back down -x at you.

const BOX_W = 0.34;   // along x
const BOX_D = 0.22;   // along z
const BOX_H = 0.12;
const WALL = 0.008;
const SLIP_W = 0.19;  // along z
const SLIP_H = 0.125;
const SLIP_T = 0.0016;
const TEX_W = 320;
const TEX_H = 210;
// How far a sideways drag has to go to thumb one slip, in pixels.
const DRAG_STEP = 80;

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// The open shoebox: a floor and four walls, so the slips can be seen inside.
export function makeShoebox(mats) {
  const g = new THREE.Group();
  const part = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.card);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  part(BOX_W, WALL, BOX_D, 0, WALL / 2, 0);
  part(WALL, BOX_H, BOX_D, -BOX_W / 2 + WALL / 2, BOX_H / 2, 0);
  part(WALL, BOX_H, BOX_D, BOX_W / 2 - WALL / 2, BOX_H / 2, 0);
  part(BOX_W, BOX_H, WALL, 0, BOX_H / 2, -BOX_D / 2 + WALL / 2);
  part(BOX_W, BOX_H, WALL, 0, BOX_H / 2, BOX_D / 2 - WALL / 2);
  return g;
}

export class SlipBox {
  // `box` is the shoebox group, already placed; `fonts` the sign, hand and
  // mono faces the rest of the station's paper is set in.
  constructor(game, box, fonts) {
    this.game = game;
    this.box = box;
    this.fonts = fonts;
    this.slips = [];
    this.current = 0;
    this.drag = 0;
    this.taking = null;
    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xd9cfac, roughness: 0.92 });
    this.root = new THREE.Group();
    box.add(this.root);
    this.view = this.makeView();
    this.target = this.makeTarget();
  }

  // Who is in the box tonight: the fourteen, and once every one of them has
  // been heard, a fifteenth at the very back.
  roster() {
    const list = PASSENGERS.map((p, i) => ({ id: p.id, name: p.name, no: 1047 + i * 3, seat: i + 1 }));
    if (this.game.state.heardAllStories(PASSENGERS.length)) {
      list.push({ id: 'self', name: this.game.playerName || 'PASSENGER', no: 1093, seat: 0, own: true });
    }
    return list;
  }

  // The slips, made the first time anyone looks in, and remade if the roster
  // has grown since.
  build() {
    const roster = this.roster();
    if (this.slips.length === roster.length) return;
    for (const s of this.slips) {
      s.mesh.geometry.dispose();
      s.tex.dispose();
      this.root.remove(s.mesh);
    }
    const n = roster.length;
    const first = -BOX_W / 2 + WALL + 0.03;
    const last = BOX_W / 2 - WALL - 0.016;
    this.slips = roster.map((r, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_W;
      canvas.height = TEX_H;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
      // BoxGeometry's faces: +x, -x, +y, -y, +z, -z. The print is on -x.
      const geo = new THREE.BoxGeometry(SLIP_T, SLIP_H, SLIP_W);
      geo.translate(0, SLIP_H / 2, 0);
      const mesh = new THREE.Mesh(geo, [this.paperMat, face, this.paperMat, this.paperMat, this.paperMat, this.paperMat]);
      mesh.castShadow = true;
      const x = first + ((last - first) * i) / Math.max(1, n - 1);
      // Not quite square in the box: a hand has been through them before.
      const yaw = (((i * 37) % 7) - 3) * 0.012;
      mesh.position.set(x, WALL, (((i * 13) % 5) - 2) * 0.003);
      mesh.rotation.set(0, yaw, 0);
      this.root.add(mesh);
      const slip = { ...r, mesh, tex, canvas, x, yaw, tilt: 0, lift: 0, punched: false };
      this.paint(slip);
      return slip;
    });
  }

  // A transfer, printed, with the passenger's name written in.
  paint(slip) {
    const ctx = slip.canvas.getContext('2d');
    const w = TEX_W;
    const h = TEX_H;
    const { sign, hand, mono } = this.fonts;
    ctx.fillStyle = slip.own ? '#e4dbc0' : '#ddd3b0';
    ctx.fillRect(0, 0, w, h);
    // Thirty-odd years in a shoebox.
    const seed = slip.no;
    for (let i = 0; i < 90; i++) {
      const a = Math.sin(seed * 12.9 + i * 78.2) * 43758.5;
      const r = a - Math.floor(a);
      const b = Math.sin(seed * 4.1 + i * 19.7) * 24634.6;
      const q = b - Math.floor(b);
      ctx.fillStyle = `rgba(110, 84, 40, ${0.03 + r * 0.05})`;
      ctx.fillRect(r * w, q * h, 2 + q * 10, 1 + r * 3);
    }
    ctx.strokeStyle = 'rgba(122, 38, 30, 0.75)';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.lineWidth = 1;
    ctx.strokeRect(13, 13, w - 26, h - 26);

    ctx.fillStyle = '#7a261e';
    ctx.textAlign = 'left';
    ctx.font = `600 13px ${sign}`;
    ctx.fillText('GRAYHOLLOW TRANSIT CO.', 22, 32);
    ctx.font = `700 34px ${sign}`;
    ctx.fillText('TRANSFER', 20, 66);
    ctx.textAlign = 'right';
    ctx.font = `500 13px ${mono}`;
    ctx.fillStyle = '#3a2f22';
    ctx.fillText(`No. ${String(slip.no).padStart(5, '0')}`, w - 22, 32);
    ctx.fillText('NOV 03 1987', w - 22, 52);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#5a4a36';
    ctx.font = `600 11px ${sign}`;
    ctx.fillText('PASSENGER', 22, 94);
    ctx.fillText('VIA BAY 9 TO', 22, 146);
    ctx.fillRect(22, 126, w - 44, 1);
    // The name, in whatever was to hand. Yours is not in ink.
    ctx.fillStyle = slip.own ? '#9a2a1e' : '#1d2a52';
    ctx.font = `600 ${slip.name.length > 16 ? 30 : 34}px ${hand}`;
    ctx.fillText(slip.name, 30, 122);
    ctx.fillStyle = '#1d2a52';
    ctx.font = `600 28px ${hand}`;
    ctx.fillText('the Coast', 110, 150);
    ctx.fillStyle = '#5a4a36';
    ctx.font = `600 11px ${sign}`;
    ctx.fillText(`SEAT ${slip.seat}`, w - 70, 146);

    // The punch row: one hole, once it has been validated.
    ctx.fillText('VALID WHEN PUNCHED', 22, h - 24);
    for (let i = 0; i < 6; i++) {
      const cx = w - 128 + i * 20;
      const cy = h - 28;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(90, 74, 54, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (slip.punched && i === 3) {
        ctx.fillStyle = '#0d0b08';
        ctx.fill();
      }
    }
    slip.tex.needsUpdate = true;
  }

  // Leaning over the box from its front, looking down at the slip being
  // read. Mouse or stick movement looks a little about.
  makeView() {
    const out = {};
    return (eye, aspect, fov, look, o) => {
      const s = this.slips[this.current];
      this.box.updateWorldMatrix(true, false);
      const x = s ? s.x : 0;
      // The point being read: the middle of the current slip's face, raised.
      _t.set(x - 0.01, WALL + SLIP_H * 0.62 + 0.03, 0).applyMatrix4(this.box.matrixWorld);
      _v.set(x - 0.30, WALL + 0.36, look.lx * 0.08).applyMatrix4(this.box.matrixWorld);
      o.position.copy(_v);
      _t.y += look.ly * 0.03;
      _m.lookAt(o.position, _t, UP);
      o.quaternion.setFromRotationMatrix(_m);
      o.fov = Math.min(fov, 40 / Math.max(1, look.zoomNow * 0.8));
      o.dist = o.position.distanceTo(_t);
      void out;
      return o;
    };
  }

  // The thing game.inspect() is handed.
  makeTarget() {
    const box = this;
    return {
      label: 'Transfer slips',
      view: (...a) => box.view(...a),
      arrows: true,
      useLabel: 'TAKE',
      onStart: () => box.open(),
      onEnd: () => box.close(),
      update: () => {},
      prompt: () => box.prompt(),
      key: (code, down) => box.key(code, down),
      wheel: (dy) => box.wheel(dy),
      look: (dx) => box.look(dx),
      use: () => box.take(),
    };
  }

  open() {
    this.build();
    this.root.visible = true;
    this.box.userData.staticSlips && (this.box.userData.staticSlips.visible = false);
    this.drag = 0;
    this.taking = null;
    // Start at the front, or at the one you took last time if it is still in
    // your pocket and needs punching.
    const chosen = this.game.state.run.chosenSlip;
    const at = this.slips.findIndex((s) => s.id === chosen);
    this.current = at >= 0 && !this.game.state.run.ticketPunched ? at : 0;
    for (const s of this.slips) {
      s.mesh.visible = !(s.id === chosen && this.game.state.run.ticketPunched);
      s.punched = s.id === chosen && this.game.state.run.ticketPunched;
    }
    this.game.audio.paper();
    this.settle(true);
  }

  close() {
    this.root.visible = false;
    if (this.box.userData.staticSlips) this.box.userData.staticSlips.visible = true;
  }

  // A night starts with every slip back in the box.
  reset() {
    for (const s of this.slips) {
      s.mesh.visible = true;
      if (s.punched) {
        s.punched = false;
        this.paint(s);
      }
    }
    this.current = 0;
    this.root.visible = false;
  }

  prompt() {
    const s = this.slips[this.current];
    if (!s) return '';
    const who = s.own ? 'A slip with your own name on it' : `${s.name}, to the coast`;
    const of = `${this.current + 1}/${this.slips.length}`;
    if (this.game.touch) return '';
    const k = this.game.pad?.active
      ? '<kbd>&#9664;</kbd> <kbd>&#9654;</kbd> thumb through<span class="sep"></span><kbd>A</kbd> take it<span class="sep"></span><kbd>B</kbd> put them back'
      : '<kbd>SCROLL</kbd> or <kbd>A</kbd> <kbd>D</kbd> thumb through<span class="sep"></span><kbd>E</kbd> take it<span class="sep"></span><kbd>Q</kbd> put them back';
    return `${who} (${of})<span class="sep"></span>${k}`;
  }

  key(code, down = true) {
    if (!down) return false;
    if (this.taking) return true;
    if (code === 'ArrowRight' || code === 'KeyD') return this.step(1), true;
    if (code === 'ArrowLeft' || code === 'KeyA') return this.step(-1), true;
    return false;
  }

  // One notch of a wheel is one slip; a trackpad sends the same distance in
  // dozens of small pieces, so it is the distance that counts.
  wheel(dy) {
    if (this.taking) return true;
    if (Math.sign(dy) !== Math.sign(this.wheelAcc ?? 0)) this.wheelAcc = 0;
    this.wheelAcc = (this.wheelAcc ?? 0) + Math.max(-100, Math.min(100, dy));
    while (this.wheelAcc >= 90) {
      this.wheelAcc -= 90;
      this.step(1);
    }
    while (this.wheelAcc <= -90) {
      this.wheelAcc += 90;
      this.step(-1);
    }
    return true;
  }

  // A sideways drag is a thumb running along the tops of the slips.
  look(dx) {
    if (this.taking) return true;
    this.drag += dx;
    while (this.drag > DRAG_STEP) {
      this.drag -= DRAG_STEP;
      this.step(1);
    }
    while (this.drag < -DRAG_STEP) {
      this.drag += DRAG_STEP;
      this.step(-1);
    }
    return true;
  }

  step(dir) {
    const next = this.current + dir;
    if (next < 0 || next >= this.slips.length) {
      // The end of the box: the slip knocks against the cardboard.
      this.game.audio.blip({ freq: 180, type: 'sine', dur: 0.05, vol: 0.05 });
      return;
    }
    this.current = next;
    this.game.audio.flick();
    const s = this.slips[next];
    if (s.own) this.game.subtitle('Your own name. In your own handwriting. You do not remember writing it.', 4);
  }

  // Takes the slip being read: it comes up out of the box, gets punched if
  // there is a punch to punch it with, and goes in your pocket.
  take() {
    if (this.taking) return true;
    const s = this.slips[this.current];
    if (!s || !s.mesh.visible) return true;
    this.taking = { slip: s, t: 0 };
    this.game.audio.paper();
    const run = this.game.state.run;
    const punch = run.hasPunch;
    this.game.later(0.45, () => {
      this.game.pickSlip(s.id, s.own);
      if (punch) {
        s.punched = true;
        this.paint(s);
      }
    });
    this.game.later(1.25, () => {
      s.mesh.visible = false;
      this.taking = null;
      this.game.stopInspecting();
    });
    return true;
  }

  // Every frame while the box is open: each slip eases towards where it
  // should be for the slip being read.
  settle(instant = false, dt = 1 / 60) {
    const k = instant ? 1 : 1 - Math.pow(0.0005, dt);
    this.slips.forEach((s, i) => {
      // A positive tilt tips a slip's top towards you, a negative one leans
      // it back so its face turns up to the light.
      let tilt = -0.08;
      let lift = 0;
      let reach = 0;
      if (i < this.current) {
        // Tipped forward against the front of the box: the first one you
        // went past lies flattest, the rest pile up on it.
        tilt = 0.86 + Math.min(0.3, (this.current - 1 - i) * 0.05);
      } else if (i === this.current) {
        tilt = -0.24;
        lift = 0.045;
      }
      if (this.taking?.slip === s) {
        const p = Math.min(1, this.taking.t / 0.9);
        lift += p * 0.16;
        reach = -p * 0.08;
        tilt = -0.24 + p * 0.3;
      }
      s.tilt += (tilt - s.tilt) * k;
      s.lift += (lift - s.lift) * k;
      s.mesh.rotation.set(0, s.yaw, s.tilt, 'YXZ');
      s.mesh.position.x = s.x + reach;
      s.mesh.position.y = WALL + s.lift;
    });
  }

  update(dt) {
    if (!this.root.visible) return;
    if (this.taking) this.taking.t += dt;
    this.settle(false, dt);
  }
}
