// The single source of dread.
//
// Everything that can frighten the player writes into this object, and every
// system that can express fear (shader uniforms, audio buses, camera shake)
// reads out of it. Keeping it in one place is what stops the game feeling like
// a collection of unrelated effects.

// Sustained levels. `tension` is the slow bed -- the sense that the station is
// not safe. `fear` is the fast one -- something is happening right now.
//
// Both rise much faster than they fall. Fear that drains as quickly as it
// arrives reads as a UI meter; fear that lingers reads as fear.
const RISE = 2.5;
const FALL = 0.6;
const TENSION_RISE = 0.8;
const TENSION_FALL = 0.25;

// One-shot impulse channels. Each decays at its own rate, so a single scare
// can slam the aberration for a second while the white flash is gone in two
// frames.
const CHANNEL_DECAY = {
  aberration: 1.5,
  distort: 3.0,
  static: 4.0,
  red: 1.2,
  whiteFlash: 6.0,
  face: 30.0,
  shake: 2.2,
  blackout: 8.0,
};

export class Fear {
  constructor() {
    this.fear = 0;
    this.tension = 0;
    this.targetFear = 0;
    this.targetTension = 0;

    this.channels = {};
    for (const key of Object.keys(CHANNEL_DECAY)) this.channels[key] = 0;

    // Seconds for which a scripted set piece owns the screen. Ambient systems
    // check this and stay out of the way -- two scares at once is one scare.
    this.busy = 0;
  }

  claim(seconds) {
    this.busy = Math.max(this.busy, seconds);
  }

  reset() {
    this.fear = 0;
    this.tension = 0;
    this.targetFear = 0;
    this.targetTension = 0;
    this.busy = 0;
    for (const key of Object.keys(this.channels)) this.channels[key] = 0;
  }

  // Ambient systems call these every frame with what they think the level
  // should be; the highest bidder wins.
  wantFear(v) {
    if (v > this.targetFear) this.targetFear = v;
  }

  wantTension(v) {
    if (v > this.targetTension) this.targetTension = v;
  }

  // An impulse. Uses max() rather than +=, so the channel is guaranteed to be
  // read at full strength for at least one frame no matter what else is going
  // on -- a scare that gets averaged away is not a scare.
  kick(channel, amount = 1) {
    if (this.channels[channel] === undefined) return;
    this.channels[channel] = Math.max(this.channels[channel], amount);
  }

  // Convenience: a full-body scare. Most set pieces want all of these at once.
  jolt(strength = 1) {
    this.kick('aberration', 1.8 * strength);
    this.kick('distort', 1.0 * strength);
    this.kick('static', 0.8 * strength);
    this.kick('shake', 1.0 * strength);
    this.fear = Math.max(this.fear, Math.min(1, 0.7 * strength));
  }

  get(channel) {
    return this.channels[channel] ?? 0;
  }

  update(dt) {
    const step = (cur, target, rise, fall) => {
      const rate = target > cur ? rise : fall;
      return cur + (target - cur) * Math.min(1, dt * rate);
    };

    if (this.busy > 0) this.busy = Math.max(0, this.busy - dt);

    this.fear = step(this.fear, this.targetFear, RISE, FALL);
    this.tension = step(this.tension, this.targetTension, TENSION_RISE, TENSION_FALL);

    for (const [key, decay] of Object.entries(CHANNEL_DECAY)) {
      const v = this.channels[key];
      if (v > 0) this.channels[key] = Math.max(0, v - v * Math.min(1, dt * decay) - dt * 0.02);
    }

    // Bids are per-frame; clear them so a system that stops bidding lets go.
    this.targetFear = 0;
    this.targetTension = 0;
  }
}
