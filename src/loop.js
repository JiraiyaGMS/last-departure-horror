// The night runs 11:47 PM to 3:33 AM. Times are kept as minutes past
// midnight on the first day, so 11:47 PM is 1427 and 3:33 AM is 1653.
export const START_MIN = 23 * 60 + 47;
export const END_MIN = 24 * 60 + 3 * 60 + 33;

// One real second is twenty game seconds, giving a loop of about 11 minutes.
export const GAME_SECONDS_PER_REAL = 20;

export function parseTime(str) {
  const [h, m] = str.split(':').map(Number);
  // Anything before noon belongs to the following day.
  return (h < 12 ? 24 * 60 : 0) + h * 60 + m;
}

export function formatTime(minutes) {
  const total = Math.floor(minutes) % (24 * 60);
  let h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  let display = h % 12;
  if (display === 0) display = 12;
  return `${display}:${String(m).padStart(2, '0')} ${suffix}`;
}

export class LoopClock {
  constructor() {
    this.time = START_MIN;
    this.events = [];
    this.fired = new Set();
    this.running = false;
    this.paused = false;
  }

  // `at` is a clock string like '01:00'. Events fire once per loop.
  on(at, id, run) {
    this.events.push({ at: parseTime(at), id, run });
    this.events.sort((a, b) => a.at - b.at);
    return this;
  }

  start() {
    this.running = true;
    this.paused = false;
  }

  reset() {
    this.time = START_MIN;
    this.fired.clear();
    this.running = true;
    this.paused = false;
  }

  get progress() {
    return (this.time - START_MIN) / (END_MIN - START_MIN);
  }

  get label() {
    return formatTime(this.time);
  }

  isAfter(at) {
    return this.time >= parseTime(at);
  }

  isBetween(a, b) {
    return this.time >= parseTime(a) && this.time < parseTime(b);
  }

  update(dt, context) {
    if (!this.running || this.paused) return null;
    const before = this.time;
    this.time += (dt * GAME_SECONDS_PER_REAL) / 60;

    for (const ev of this.events) {
      if (this.fired.has(ev.id)) continue;
      if (before < ev.at && this.time >= ev.at) {
        this.fired.add(ev.id);
        ev.run(context);
      }
    }

    if (this.time >= END_MIN) {
      this.running = false;
      return 'departure';
    }
    return null;
  }
}
