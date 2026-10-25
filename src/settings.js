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
  // 0..1, 0.5 as authored. A gamma on the finished frame (see
  // brightnessGamma): monitors disagree wildly about what a dark room looks
  // like, and a horror game tuned on one is a black screen on another.
  brightness: 0.5,
  // Has the player been through the brightness check on the first BEGIN.
  calibrated: false,
  // Subtitle and document text, as a multiple of the designed size.
  textScale: 1,
  // C toggles crouch instead of being held.
  toggleCrouch: false,
  // Where to go next, in the notebook's checklist and on the pause screen.
  hints: true,
  // How hard he is to get away from (DIFFICULTY below).
  difficulty: 'standard',
  // Captions for the sounds that matter -- his keys, his breathing, steps
  // in another room -- with which way they came from.
  captions: false,
  // The PA console's LIVE MIC switch: your own voice on the station's
  // speakers. Off until the switch is flipped.
  paMic: false,
};

// What each difficulty does to him, and to you. `speed` scales how fast he
// walks, `sight` how far he can pick you out, `hearing` how far a noise
// carries to him, `grace` how long you get after waking or losing him, and
// `breath` how fast holding your breath empties your lungs.
export const DIFFICULTY = {
  story: { label: 'STORY', speed: 0.8, sight: 0.72, hearing: 0.7, grace: 2, breath: 0.65 },
  standard: { label: 'STANDARD', speed: 1, sight: 1, hearing: 1, grace: 1, breath: 1 },
  nightmare: { label: 'NIGHTMARE', speed: 1.14, sight: 1.15, hearing: 1.2, grace: 0.5, breath: 1.25 },
  // Not just harder: the station itself changes (see Game.terror). He moves
  // whenever the lights blink, something stands behind you, the passengers
  // move when you look away, and there is less light to see any of it by.
  terror: { label: 'TERROR', speed: 1.2, sight: 1.25, hearing: 1.35, grace: 0.25, breath: 1.4 },
};

export const TEXT_SCALES = [0.85, 1, 1.2, 1.45];

// The exponent the last pass raises the picture to: under 1 lifts the
// shadows, over 1 sinks them.
export function brightnessGamma(b) {
  return Math.pow(2, (0.5 - b) * 1.4);
}

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
      // Someone whose system asks for less motion starts with it calmed;
      // an explicit choice either way is kept.
      this.calm = typeof raw.calm === 'boolean' ? raw.calm : !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      this.brightness = clamp(Number(raw.brightness), 0, 1, DEFAULTS.brightness);
      this.calibrated = raw.calibrated === true;
      this.textScale = TEXT_SCALES.includes(Number(raw.textScale)) ? Number(raw.textScale) : DEFAULTS.textScale;
      this.toggleCrouch = raw.toggleCrouch === true;
      this.hints = raw.hints !== false;
      this.difficulty = DIFFICULTY[raw.difficulty] ? raw.difficulty : DEFAULTS.difficulty;
      this.captions = raw.captions === true;
      this.paMic = raw.paMic === true;
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

  get diff() {
    return DIFFICULTY[this.difficulty] ?? DIFFICULTY.standard;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }
}
