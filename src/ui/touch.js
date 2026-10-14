// Touch controls for tablets. Nothing here knows the rules of the station: the
// stick feeds the player an analog move vector, a drag on the right half turns
// the head, and every button simply presses the key the desktop build already
// listens for. That keeps one input path through the game instead of two.

export function isTouchDevice() {
  // iPadOS reports itself as a Mac, so ask about the primary pointer instead of
  // the user agent. A touchscreen laptop still has a fine primary pointer and
  // keeps the mouse-and-keyboard controls.
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

const LOOK_SENS = 0.0055;
const STICK_RADIUS = 56;

function press(code, down) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
}

// Keeps a drag tracking its finger after it slides off the zone. Some
// browsers refuse capture for a pointer they consider already released, which
// is harmless here, so it must not throw out of the handler.
function capture(el, id) {
  try { el.setPointerCapture(id); } catch { /* not capturable */ }
}

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.lookId = null;
    this.stickId = null;
    this.crouchLatched = false;

    document.body.classList.add('touch');

    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div id="lookzone"></div>
      <div id="stickzone"><div id="stickbase"><div id="stickknob"></div></div></div>
      <div id="touchtop">
        <button id="pausebtn" aria-label="Pause">II</button>
        <button data-tap="Tab">NOTES</button>
        <button data-tap="KeyR" data-role="ticket">TICKET</button>
      </div>
      <div id="touchleft">
        <button data-hold="ShiftLeft" data-role="walk">RUN</button>
        <button data-role="crouch">CROUCH</button>
      </div>
      <div id="touchright">
        <button data-tap="Digit1" data-role="c1" class="big">1</button>
        <button data-tap="Digit2" data-role="c2" class="big">2</button>
        <button data-tap="KeyR" data-role="cr" class="big">ANSWER</button>
        <button data-hold="Space" data-role="hide" class="big">HOLD BREATH</button>
        <button data-role="hide" id="leavebtn">LEAVE</button>
        <button data-tap="ArrowRight" data-role="watch" class="big" aria-label="Next camera">&#9654;</button>
        <button data-tap="ArrowLeft" data-role="watch" class="big" aria-label="Previous camera">&#9664;</button>
        <button data-tap="KeyZ" data-role="zoom" class="big">ZOOM</button>
        <button data-tap="KeyE" data-role="use" class="big">USE</button>
        <button data-tap="KeyF" data-role="walk">LIGHT</button>
        <button data-tap="KeyG" data-role="walk">COIN</button>
        <button data-tap="KeyB" data-role="walk">CELL</button>
      </div>`;
    document.body.appendChild(this.root);

    this.lookZone = this.root.querySelector('#lookzone');
    this.stickZone = this.root.querySelector('#stickzone');
    this.stickBase = this.root.querySelector('#stickbase');
    this.stickKnob = this.root.querySelector('#stickknob');
    this.crouchBtn = this.root.querySelector('[data-role="crouch"]');
    this.useBtn = this.root.querySelector('[data-role="use"]');
    this.roles = {};
    for (const btn of this.root.querySelectorAll('[data-role]')) {
      (this.roles[btn.dataset.role] ??= []).push(btn);
    }

    this.bindButtons();
    this.bindStick();
    this.bindLook();
    this.bindModals();
  }

  bindButtons() {
    for (const btn of this.root.querySelectorAll('button')) {
      const tap = btn.dataset.tap;
      const hold = btn.dataset.hold;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('down');
        if (tap) { press(tap, true); press(tap, false); }
        if (hold) press(hold, true);
      });
      const release = () => {
        if (!btn.classList.contains('down')) return;
        btn.classList.remove('down');
        if (hold) press(hold, false);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    }

    // Crouch is a toggle: holding a thumb on it while also steering and looking
    // asks for a third hand.
    // Leaving a hiding spot is polled per frame, so a tap that presses and
    // releases inside one frame would never be seen. Go straight to the player.
    this.root.querySelector('#leavebtn').addEventListener('pointerdown', () => {
      this.game.player.exitHide();
    });
    this.root.querySelector('#pausebtn').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.pause();
    });

    this.crouchBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.crouchLatched = !this.crouchLatched;
      press('KeyC', this.crouchLatched);
      this.crouchBtn.classList.toggle('on', this.crouchLatched);
    });
  }

  bindStick() {
    const zone = this.stickZone;
    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') { this.game.canvas.requestPointerLock?.(); return; }
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      // The stick appears under the thumb rather than at a fixed spot.
      const rect = zone.getBoundingClientRect();
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX - rect.left}px`;
      this.stickBase.style.top = `${e.clientY - rect.top}px`;
      this.stickBase.classList.add('active');
      this.moveStick(e);
      capture(zone, e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e);
    });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickBase.classList.remove('active');
      this.stickKnob.style.transform = '';
      this.game.player.touchMove = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  moveStick(e) {
    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, len / STICK_RADIUS);
    // A small dead zone so a resting thumb does not creep.
    this.game.player.touchMove = mag < 0.18 ? null : { x: dx / STICK_RADIUS, z: dy / STICK_RADIUS };
  }

  bindLook() {
    const zone = this.lookZone;
    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') { this.game.canvas.requestPointerLock?.(); return; }
      if (this.lookId !== null) return;
      e.preventDefault();
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      capture(zone, e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      const g = this.game;
      if (!g.started || g.hud.modalOpen) return;
      const p = g.player;
      const sens = LOOK_SENS * (g.settings?.sensitivity ?? 1);
      if (p.watching) return;
      // Up close, a drag moves the eye across the page.
      if (p.inspecting) {
        p.inspectLook(dx * 1.4, dy * 1.4);
        return;
      }
      p.yaw -= dx * sens;
      p.pitch -= dy * sens * (g.settings?.invertY ? -1 : 1);
      const limit = Math.PI / 2 - 0.05;
      p.pitch = Math.max(-limit, Math.min(limit, p.pitch));
    });
    const end = (e) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // Readers and the notebook close on a tap, since there is no E or TAB key.
  bindModals() {
    const hud = this.game.hud;
    hud.reader.addEventListener('click', (e) => {
      if (e.target.closest('.choice')) return;
      if (hud.readerOpen && !hud.hasChoices) hud.closeDocument();
    });
    hud.el.notebook.addEventListener('click', () => {
      if (hud.notebookOpen) press('Tab', true);
    });
  }

  // Called once a frame: show only the buttons that mean something right now.
  update() {
    const g = this.game;
    const active = g.started && !g.hud.modalOpen && !g.ended && !g.transitioning;
    this.root.classList.toggle('hidden', !g.started || g.ended);
    this.root.classList.toggle('modal', !active);

    const hiding = !!g.player.hiding;
    const watching = !!g.player.watching;
    const inspecting = !!g.player.inspecting;
    const ch = g.challenge?.keys;
    this.show('walk', !hiding && !watching && !inspecting);
    this.show('crouch', !hiding && !watching && !inspecting);
    this.show('use', !hiding);
    this.show('watch', watching);
    this.show('zoom', inspecting);
    // At the console the screens name the camera; the button says how out.
    const useLabel = watching ? 'STAND UP' : inspecting ? 'BACK' : 'USE';
    if (this.useBtn.textContent !== useLabel) this.useBtn.textContent = useLabel;
    this.show('hide', hiding);
    this.show('c1', !!ch?.Digit1);
    this.show('c2', !!ch?.Digit2);
    this.show('cr', !!ch?.KeyR);
    this.show('ticket', !ch?.KeyR);
  }

  show(role, on) {
    for (const btn of this.roles[role] || []) btn.classList.toggle('gone', !on);
  }
}
