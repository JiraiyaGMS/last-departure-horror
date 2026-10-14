// Graphics quality.
//
// The station has to hold a frame rate on everything from a desktop GPU to an
// iPad, and the two disagree by an order of magnitude about what is cheap. So
// every expensive feature is a dial on a tier, and a governor watches the real
// frame time and turns the dials down when the device cannot keep up.
//
// The governor only ever adjusts in one direction on its own. Render scale is
// free to move both ways -- it is a resize, nothing recompiles -- but a tier
// change rebuilds shaders and costs a visible hitch, so the governor will drop
// a tier when it has run out of resolution to give back and never raise one.
// Raising is the player's call, from the start screen.

export const TIERS = {
  high: {
    label: 'HIGH',
    pixelRatioMax: 2,
    ao: true,
    bloom: true,
    msaa: 4,
    shadowBudget: 3,
    pointShadowSize: 512,
    flashShadowSize: 1024,
    // Enough that the room through a doorway is lit as well as the one you
    // are standing in.
    maxLights: 8,
    bigTextures: true,
    anisotropy: 8,
    shafts: true,
    dust: 700,
  },
  medium: {
    label: 'MEDIUM',
    pixelRatioMax: 1.5,
    ao: false,
    bloom: true,
    msaa: 0,
    shadowBudget: 2,
    pointShadowSize: 512,
    flashShadowSize: 1024,
    maxLights: 6,
    bigTextures: false,
    anisotropy: 4,
    shafts: true,
    dust: 450,
  },
  low: {
    label: 'LOW',
    pixelRatioMax: 1,
    ao: false,
    bloom: false,
    msaa: 0,
    shadowBudget: 1,
    pointShadowSize: 256,
    flashShadowSize: 512,
    maxLights: 4,
    bigTextures: false,
    anisotropy: 2,
    shafts: false,
    dust: 220,
  },
};

const ORDER = ['low', 'medium', 'high'];
const STORAGE_KEY = 'lastDeparture.graphics';

// Render scale never goes below this fraction of the tier's pixel ratio. Past
// it the image turns to mush and dropping a tier is the better trade.
const SCALE_FLOOR = 0.6;

// The governor's target. 50 fps leaves headroom for the frames where a light
// pops or a shadow map has to be redrawn.
const TARGET_MS = 20;

function readSaved() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'auto' || TIERS[v] ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function writeSaved(v) {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // Private browsing: the choice just will not survive a reload.
  }
}

export function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

export class Quality {
  constructor() {
    this.setting = readSaved();
    this.tierName = this.setting === 'auto' ? this.autoTier() : this.setting;
    // Tablets start a notch under full resolution. The governor will hand it
    // back within a few seconds if the device has room, which beats a first
    // impression made of dropped frames.
    this.scale = isCoarsePointer() ? 0.8 : 1;
    this.listeners = [];

    this.avgMs = TARGET_MS;
    this.sampleTime = 0;
    this.slowFor = 0;
    this.fastFor = 0;
    this.warmup = 2.5;
  }

  get tier() {
    return TIERS[this.tierName];
  }

  autoTier() {
    // Touch devices start at medium; everything else starts at high and is
    // governed down if it cannot hold the frame rate.
    return isCoarsePointer() ? 'medium' : 'high';
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  emit(reason) {
    for (const fn of this.listeners) fn(this.tier, reason);
  }

  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.max(0.5, Math.min(dpr, this.tier.pixelRatioMax) * this.scale);
  }

  // Cycles AUTO -> HIGH -> MEDIUM -> LOW -> AUTO. Returns the new label.
  cycleSetting() {
    const options = ['auto', 'high', 'medium', 'low'];
    const next = options[(options.indexOf(this.setting) + 1) % options.length];
    this.setting = next;
    writeSaved(next);
    this.tierName = next === 'auto' ? this.autoTier() : next;
    this.scale = 1;
    this.slowFor = 0;
    this.fastFor = 0;
    this.warmup = 2.5;
    this.emit('setting');
    return this.settingLabel();
  }

  settingLabel() {
    return this.setting === 'auto' ? `AUTO (${this.tier.label})` : this.tier.label;
  }

  // Fed the real frame time every frame the simulation is running. Frames
  // spent behind a menu or a fade are not evidence of anything.
  sample(dt, active) {
    if (!active) return;
    const ms = dt * 1000;
    // A long hitch (a shader compile, a tab switch) is not a frame rate.
    if (ms > 250) return;
    this.avgMs += (ms - this.avgMs) * 0.05;
    // After a change, let the average catch up before judging it.
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.sampleTime += dt;
    if (this.sampleTime < 0.5) return;
    this.sampleTime = 0;

    if (this.avgMs > TARGET_MS * 1.2) {
      this.slowFor += 0.5;
      this.fastFor = 0;
    } else if (this.avgMs < TARGET_MS * 0.7) {
      this.fastFor += 0.5;
      this.slowFor = 0;
    } else {
      this.slowFor = Math.max(0, this.slowFor - 0.25);
      this.fastFor = Math.max(0, this.fastFor - 0.25);
    }

    const canDrop = this.setting === 'auto' && ORDER.indexOf(this.tierName) > 0;
    // Badly slow -- under 25 fps -- is not worth easing out of a step at a
    // time: on AUTO, go straight to the next tier down.
    if (this.avgMs > TARGET_MS * 2 && this.slowFor >= 1 && canDrop) {
      this.dropTier();
      return;
    }

    if (this.slowFor >= 1.5) {
      this.slowFor = 0;
      if (this.scale > SCALE_FLOOR + 0.001) {
        this.scale = Math.max(SCALE_FLOOR, this.scale - 0.1);
        this.warmup = 0.75;
        this.emit('scale');
      } else if (canDrop) {
        this.dropTier();
      }
    } else if (this.fastFor >= 4 && this.scale < 1) {
      this.fastFor = 0;
      this.scale = Math.min(1, this.scale + 0.1);
      this.warmup = 0.75;
      this.emit('scale');
    }
  }

  dropTier() {
    this.tierName = ORDER[ORDER.indexOf(this.tierName) - 1];
    // A new tier starts near its own full resolution; the governor will trim
    // it again if it needs to. Its shaders compile on the next frames, so
    // give it a moment before judging.
    this.scale = 0.9;
    this.slowFor = 0;
    this.fastFor = 0;
    this.warmup = 2;
    this.avgMs = TARGET_MS;
    this.emit('tier');
  }
}
