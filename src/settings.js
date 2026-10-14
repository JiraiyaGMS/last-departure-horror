// Player preferences. Per browser, separate from the save: wiping a save to
// start over should not also reset someone's mouse sensitivity.

const KEY = 'lastDeparture.settings';

const DEFAULTS = {
  sensitivity: 1,
  invertY: false,
  fov: 68,
  volume: 0.8,
  // Tones down the white flashes, video static and camera shake, for anyone
  // who needs it. The scares still land; they just do not strobe.
  calm: false,
};

const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

export class Settings {
  constructor() {
    Object.assign(this, DEFAULTS);
    this.listeners = [];
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      this.sensitivity = clamp(Number(raw.sensitivity), 0.2, 3, DEFAULTS.sensitivity);
      this.invertY = raw.invertY === true;
      this.fov = clamp(Number(raw.fov), 60, 90, DEFAULTS.fov);
      this.volume = clamp(Number(raw.volume), 0, 1, DEFAULTS.volume);
      this.calm = raw.calm === true;
    } catch {
      // Unreadable or blocked storage: defaults it is.
    }
  }

  set(key, value) {
    this[key] = value;
    try {
      const out = {};
      for (const k of Object.keys(DEFAULTS)) out[k] = this[k];
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      // Private browsing: the change holds for this session only.
    }
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }
}
