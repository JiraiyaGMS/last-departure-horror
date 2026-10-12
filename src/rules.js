// The posted rules. Some are the station's; two were added by something else.
// Breaking a real rule tells the Attendant exactly where you are. Breaking a
// false one does nothing at all, which is the point: the false rules exist to
// stop you solving puzzles, or to get you caught by obeying them.

export const RULES = [
  {
    id: 'no_running',
    text: 'Do not run inside the terminal.',
    real: true,
    posted: true,
    isActive: () => true,
    check: (ctx) => ctx.player.running,
    broke: 'You ran. He heard it.',
  },
  {
    id: 'pa_name',
    text: 'If the PA calls your name, do not answer.',
    real: true,
    posted: true,
    isActive: () => true,
    check: (ctx) => ctx.game.answeredPA,
    broke: 'You answered. Something wrote it down.',
  },
  {
    id: 'board_stare',
    text: 'Do not look at the departure board for more than 10 seconds.',
    real: false,
    posted: true,
    isActive: () => true,
    check: (ctx) => ctx.game.boardStare > 10,
    broke: null,
    falseHint: 'The board rule is a lie. Read it as long as you need.',
  },
  {
    id: 'ticket_hidden',
    text: 'Keep your ticket out of sight between 1:00 and 2:00 AM.',
    real: true,
    posted: true,
    isActive: (clock) => clock.isBetween('01:00', '02:00'),
    check: (ctx) => ctx.clock.time < ctx.state.run.ticketVisibleUntil,
    broke: 'Your ticket was out. The hour does not allow it.',
  },
  {
    id: 'passenger_time',
    text: 'If a passenger asks you for the time, tell them it is 11:47.',
    real: true,
    posted: true,
    isActive: () => true,
    check: (ctx) => ctx.game.toldWrongTime,
    broke: 'You told a passenger the truth. They told on you.',
  },
  {
    id: 'flashlight_lit',
    text: 'Keep your flashlight lit at all times in unlit areas.',
    real: false,
    posted: true,
    isActive: () => true,
    check: (ctx) => ctx.game.inDark && !ctx.player.flashlightOn,
    broke: null,
    falseHint: 'The flashlight rule is bait. He follows the beam.',
  },
];

export const FALSE_RULE_IDS = RULES.filter((r) => !r.real).map((r) => r.id);

export class RuleEngine {
  constructor(game) {
    this.game = game;
    this.cooldown = Object.create(null);
    this.lastBroken = null;
  }

  activeRules(clock) {
    return RULES.filter((r) => r.isActive(clock));
  }

  // Returns the rule that was just broken, or null.
  update(dt, ctx) {
    for (const id of Object.keys(this.cooldown)) {
      this.cooldown[id] = Math.max(0, this.cooldown[id] - dt);
    }

    for (const rule of RULES) {
      if (!rule.isActive(ctx.clock)) continue;
      if (this.cooldown[rule.id] > 0) continue;
      let breaking = false;
      try {
        breaking = rule.check(ctx);
      } catch {
        breaking = false;
      }
      if (!breaking) continue;

      this.cooldown[rule.id] = rule.real ? 6 : 20;
      if (rule.real) {
        this.lastBroken = rule;
        return rule;
      }
      // A false rule being broken is silent, but we quietly note that nothing
      // happened so the player can start to suspect.
      this.game.onFalseRuleBroken?.(rule);
    }
    return null;
  }

  // Rendered onto the sign in the waiting hall. Later loops reorder the list
  // and reword one entry, so a sign you memorised stops matching.
  signText(loop, state) {
    const posted = RULES.filter((r) => r.posted);
    const rotated = posted.slice();
    if (loop > 1) {
      const shift = (loop - 1) % rotated.length;
      rotated.push(...rotated.splice(0, shift));
    }
    return rotated.map((r, i) => {
      let text = r.text;
      if (loop >= 3 && r.id === 'board_stare') {
        text = 'Do not look at the departure board for more than 4 seconds.';
      }
      if (loop >= 4 && r.id === 'no_running') {
        text = 'Do not run. Do not hurry. Do not seem eager.';
      }
      const known = !r.real && state.knowsFake(r.id);
      return { index: i + 1, text, known };
    });
  }
}
