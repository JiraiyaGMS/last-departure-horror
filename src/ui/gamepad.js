// Controllers. Like the touch controls, nothing here knows the rules of the
// station: the left stick feeds the player the same analog move vector the
// on-screen stick does, the right stick turns the head, and the buttons press
// the keys the keyboard build already listens for. One input path through
// the game, not three.
//
// In menus, documents and the locker the D-pad walks the focus through
// whatever is on screen and A presses it, so nothing ever needs the mouse.
//
// Standard mapping (an Xbox pad's names):
//   left stick  move              right stick  look
//   A           use / pick        B            back, leave, or crouch
//   X           flashlight        Y            ticket / answer (lean closer, reading)
//   LB          throw a coin      RB           fresh cell
//   LT          hold breath       RT, L3       run
//   VIEW        notebook          MENU         pause
//   D-pad       answer 1 / 2, switch camera, menus

const DEAD = 0.18;
const LOOK_YAW = 2.7;     // radians a second at full tilt
const LOOK_PITCH = 1.9;
const REPEAT_FIRST = 0.38;
const REPEAT_NEXT = 0.12;

// Button indices in the standard mapping.
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

function press(code, down) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
}

// A stick, with a round dead zone and the travel past it rescaled to 0..1, so
// a gentle push is a slow creep rather than nothing then everything.
function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k, Math.min(1, m)];
}

export class Gamepads {
  constructor(game) {
    this.game = game;
    this.index = null;
    this.prev = [];
    this.active = false;     // the pad, not the mouse, was the last thing used
    this.held = new Set();   // keys we are holding down for the pad
    this.repeat = { dir: 0, t: 0 };
    this.lastShake = 0;
    this.moving = false;
    // Where each axis sat when the pad was first seen. Pedals and throttles
    // report as gamepads too, resting at one end; an axis that does not
    // rest in the middle is not a stick, and is left alone.
    this.rest = null;

    window.addEventListener('gamepadconnected', (e) => {
      if (this.index === null) this.index = e.gamepad.index;
      this.game.toast(`Controller connected: ${this.shortName(e.gamepad.id)}`);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.index) return;
      this.index = null;
      this.release();
      this.setActive(false);
      this.game.toast('Controller disconnected.');
    });
    // Touching the mouse or the keyboard hands control back to them.
    const back = (e) => {
      if (e.isTrusted) this.setActive(false);
    };
    window.addEventListener('mousemove', back);
    window.addEventListener('mousedown', back);
    window.addEventListener('keydown', back);
  }

  shortName(id) {
    return String(id).replace(/\s*\(.*$/, '').slice(0, 40) || 'gamepad';
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    document.body.classList.toggle('pad', on);
    this.game.hud.pad = on;
  }

  pad() {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.index !== null && pads[this.index]) return pads[this.index];
    this.rest = null;
    // Some browsers only report a pad once a button has been pressed, and
    // never fire the connected event for one that was already plugged in.
    for (const p of pads) {
      if (p && p.connected) {
        this.index = p.index;
        return p;
      }
    }
    return null;
  }

  // Lets go of everything the pad is holding down.
  release() {
    for (const code of this.held) press(code, false);
    this.held.clear();
    if (this.moving) this.game.player.touchMove = null;
    this.moving = false;
  }

  hold(code, on) {
    if (on && !this.held.has(code)) {
      this.held.add(code);
      press(code, true);
    } else if (!on && this.held.has(code)) {
      this.held.delete(code);
      press(code, false);
    }
  }

  update(dt) {
    const pad = this.pad();
    if (!pad) return;
    const btn = (i) => !!pad.buttons[i]?.pressed;
    const now = pad.buttons.map((b) => !!b?.pressed);
    const was = this.prev;
    const down = (i) => now[i] && !was[i];
    const up = (i) => !now[i] && was[i];
    this.prev = now;

    if (!this.rest) this.rest = pad.axes.map((a) => a ?? 0);
    const axis = (i) => (Math.abs(this.rest[i] ?? 0) > 0.5 ? 0 : pad.axes[i] ?? 0);
    const [lx, ly] = stick(axis(0), axis(1));
    const [rx, ry] = stick(axis(2), axis(3));
    if (!this.active) {
      // It takes something done on purpose to hand the game to the pad: a
      // button, or a stick pushed well off where it was resting.
      const moved = pad.axes.some((a, i) => i < 4 && Math.abs((a ?? 0) - (this.rest[i] ?? 0)) > 0.5 && Math.abs(this.rest[i] ?? 0) <= 0.5);
      if (!now.some((on, i) => on && !was[i]) && !moved) return;
      this.setActive(true);
    }

    const g = this.game;
    const hud = g.hud;

    // A DOM screen is up: the pad drives the focus, not the station.
    const screen = this.activeScreen();
    if (screen) {
      this.release();
      this.navigate(screen, pad, down, ly, dt);
      return;
    }
    if (!g.started) return;

    // In a cutscene, A held skips it; the right stick looks a little off
    // the shot.
    if (g.cutscene) {
      this.hold('KeyE', btn(B.A));
      if (down(B.MENU)) press('Escape', true);
      if (rx || ry) g.cutscene.look(rx * 900 * dt, ry * 900 * dt);
      return;
    }

    const p = g.player;

    // Move: the same analog vector the touch stick gives.
    if (lx || ly) {
      p.touchMove = { x: lx, z: ly };
      this.moving = true;
    } else if (this.moving) {
      p.touchMove = null;
      this.moving = false;
    }

    // Look.
    if (rx || ry) {
      const s = g.settings?.sensitivity ?? 1;
      // A curve, so small corrections are fine and a full push still turns.
      const cx = rx * Math.abs(rx);
      const cy = ry * Math.abs(ry);
      if (p.inspecting) {
        p.inspectLook(cx * 700 * dt, cy * 700 * dt);
      } else if (!p.watching) {
        p.yaw -= cx * LOOK_YAW * s * dt;
        p.pitch -= cy * LOOK_PITCH * s * dt * (g.settings?.invertY ? -1 : 1);
        const limit = Math.PI / 2 - 0.05;
        p.pitch = Math.max(-limit, Math.min(limit, p.pitch));
      }
    }

    // Held: running and holding your breath.
    this.hold('ShiftLeft', btn(B.RT) || btn(B.L3));
    this.hold('Space', btn(B.LT));

    if (down(B.A)) this.tap('KeyE');
    if (down(B.B)) this.back();
    if (down(B.X)) this.tap('KeyF');
    if (down(B.Y)) this.tap(p.inspecting ? 'KeyZ' : 'KeyR');
    if (down(B.LB)) this.tap('KeyG');
    if (down(B.RB)) this.tap('KeyB');
    if (down(B.VIEW)) this.tap('Tab');
    if (down(B.MENU)) g.pause();

    // The D-pad answers a question when there is one; otherwise it is the
    // arrow keys (switching cameras at the console).
    const ch = g.challenge?.keys;
    if (down(B.LEFT)) this.tap(ch?.Digit1 ? 'Digit1' : 'ArrowLeft');
    if (down(B.RIGHT)) this.tap(ch?.Digit2 ? 'Digit2' : 'ArrowRight');
    if (down(B.UP) && p.inspecting) p.zoomInspect(1.25);
    if (down(B.DOWN) && p.inspecting) p.zoomInspect(0.8);

    this.rumble(pad, dt);
    void up;
  }

  tap(code) {
    press(code, true);
    press(code, false);
  }

  // B: whatever "back" means right now; out in the open, crouch.
  back() {
    const g = this.game;
    const p = g.player;
    if (p.hiding) p.exitHide();
    else if (p.watching) g.stopWatching();
    else if (p.inspecting) g.stopInspecting();
    else p.padCrouch = !p.padCrouch;
  }

  // The topmost page-level screen that is open, if any.
  activeScreen() {
    const hud = this.game.hud;
    const open = (id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden') ? el : null;
    };
    if (hud.endingOpen) return hud.ending;
    if (hud.dialsOpen) return hud.dials;
    if (hud.readerOpen) return hud.reader;
    if (hud.notebookOpen) return hud.el.notebook;
    return open('settings') || open('controls') || open('credits') || open('pause') || open('calibrate') || (!this.game.started && open('title'));
  }

  focusables(screen) {
    return [...screen.querySelectorAll('button, input')].filter((el) => !el.disabled && el.getClientRects().length > 0);
  }

  focus(el) {
    for (const o of document.querySelectorAll('.padfocus')) o.classList.remove('padfocus');
    if (!el) return;
    el.classList.add('padfocus');
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }

  navigate(screen, pad, down, ly, dt) {
    const hud = this.game.hud;

    // The locker has its own keys.
    if (screen === hud.dials) {
      if (down(B.LEFT)) this.tap('ArrowLeft');
      if (down(B.RIGHT)) this.tap('ArrowRight');
      if (down(B.UP)) this.tap('ArrowUp');
      if (down(B.DOWN)) this.tap('ArrowDown');
      if (down(B.A)) this.tap('Enter');
      if (down(B.B)) this.tap('Escape');
      return;
    }
    // A page or the notebook with nothing to choose: any of A, B, VIEW
    // puts it down.
    if ((screen === hud.reader && !hud.hasChoices) || screen === hud.el.notebook) {
      if (down(B.A) || down(B.B)) this.tap(screen === hud.el.notebook ? 'Tab' : 'Escape');
      if (down(B.VIEW) && screen === hud.el.notebook) this.tap('Tab');
      // Long pages scroll on the stick.
      const scroller = screen === hud.reader ? screen : hud.el.notebookBody;
      if (ly) scroller.scrollTop += ly * 900 * dt;
      return;
    }

    const items = this.focusables(screen);
    if (!items.length) return;
    // Up and down, from the D-pad or the stick, repeating while held.
    let dir = 0;
    if (pad.buttons[B.UP]?.pressed || ly < -0.6) dir = -1;
    if (pad.buttons[B.DOWN]?.pressed || ly > 0.6) dir = 1;

    let i = items.indexOf(document.activeElement);
    if (i < 0 || !document.activeElement.classList.contains('padfocus')) {
      // Nothing focused yet: the first press only shows where the focus is,
      // on the screen's main button.
      i = Math.max(0, items.findIndex((el) => el.classList.contains('primary')));
      this.focus(items[i]);
      this.repeat = { dir, t: REPEAT_FIRST };
      return;
    }

    if (dir !== this.repeat.dir) {
      this.repeat = { dir, t: REPEAT_FIRST };
      if (dir) this.focus(items[(i + dir + items.length) % items.length]);
    } else if (dir) {
      this.repeat.t -= dt;
      if (this.repeat.t <= 0) {
        this.repeat.t = REPEAT_NEXT;
        this.focus(items[(i + dir + items.length) % items.length]);
      }
    }

    const el = items[i];
    // Left and right move a slider.
    if (el?.type === 'range' && (down(B.LEFT) || down(B.RIGHT))) {
      const step = Number(el.step) || 0.01;
      const span = Number(el.max) - Number(el.min);
      const by = Math.max(step, span / 20) * (down(B.RIGHT) ? 1 : -1);
      el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + by)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (down(B.A) && el) el.click();
    if (down(B.B)) {
      if (screen === hud.reader) this.tap('Escape');
      else if (screen.id === 'pause') this.game.resume();
      else if (screen.id === 'settings' || screen.id === 'controls' || screen.id === 'credits') this.game.backFromScreen();
    }
    if (down(B.MENU) && screen.id === 'pause') this.game.resume();
  }

  // The pad shakes with the screen, and with your heart.
  rumble(pad, dt) {
    const fx = pad.vibrationActuator;
    if (!fx?.playEffect) return;
    const calm = this.game.settings?.calm ? 0.4 : 1;
    const shake = this.game.fear.get('shake');
    if (shake > this.lastShake + 0.15) {
      fx.playEffect('dual-rumble', {
        duration: 140 + shake * 260,
        strongMagnitude: Math.min(1, shake * 0.9) * calm,
        weakMagnitude: Math.min(1, shake * 0.6) * calm,
      }).catch?.(() => {});
    }
    this.lastShake = shake;
  }

  // A heartbeat, felt.
  pulse(intensity) {
    if (!this.active) return;
    const fx = this.pad()?.vibrationActuator;
    if (!fx?.playEffect) return;
    const k = (this.game.settings?.calm ? 0.4 : 1) * Math.min(1, intensity);
    fx.playEffect('dual-rumble', { duration: 60, strongMagnitude: 0.35 * k, weakMagnitude: 0 }).catch?.(() => {});
    setTimeout(() => {
      fx.playEffect('dual-rumble', { duration: 70, strongMagnitude: 0.22 * k, weakMagnitude: 0 }).catch?.(() => {});
    }, 170);
  }
}
