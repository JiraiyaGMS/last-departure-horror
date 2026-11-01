// What tonight still needs, worked out from where the player has got to.
//
// The station never tells you what to do, and the notebook is a record of
// what you have learned rather than a plan, so a first-time player could
// wander the whole eleven minutes not knowing the ticket was three things in
// three rooms. This is the plan: the next step of each part of the ticket,
// with where to go for it, plus what else the player has found out they could
// do. With hints off it is the bare checklist.

import { PASSENGERS } from './content.js';
import { t, theItem } from './i18n.js';

// Where someone is, as you would say it.
export const WHERE = {
  hall: t('in the waiting hall'),
  bays: t('out at the bus bays'),
  gate: t('in the gate corridor'),
  ticket: t('in the Ticket Office'),
  manager: t('in the manager\'s office'),
  lostfound: t('in Lost & Found'),
  cctv: t('in Security'),
  diner: t('at the diner counter'),
  restroom: t('in the restrooms'),
  baggage: t('in Baggage Claim'),
  tunnel: t('down the service tunnel'),
  bay0: t('at Bay 0'),
};

// { done, text, hint? } per line.
export function objectives(game) {
  const run = game.state.run;
  const p = game.state.persistent;
  const hints = game.settings.hints !== false;
  const clock = game.clock;
  const ticket = [];

  // Part one: the stub.
  const coins = Math.min(4, run.coins);
  if (run.ticketStub) {
    ticket.push({ done: true, text: t('Ticket stub, printed.') });
  } else if (!hints) {
    ticket.push({ done: false, text: t('Ticket stub ({n}/4 coins).', { n: coins }) });
  } else {
    ticket.push({
      done: false,
      text: t('Ticket stub: four 1987 coins in the machine in the Ticket Office ({n}/4).', { n: coins }),
      // Plainer the more nights it has taken.
      hint: run.coins >= 4
        ? t('You have the fare.')
        : p.loop >= 3
          ? t('There are coins under a bench in the hall, on Walter\'s desk, on a Lost & Found shelf, on the diner counter and a restroom sink, and one in each vending machine in the diner.')
          : t('Coins turn up where people waited: under the benches, on desks, counters and sinks. The diner\'s vending machines each give one, loudly.'),
    });
  }

  // Part two: the stamp, in Walter's drawer.
  if (run.ticketStamped) {
    ticket.push({ done: true, text: t('Destination stamp: THE COAST.') });
  } else if (!hints) {
    ticket.push({ done: false, text: t('Destination stamp.') });
  } else if (!run.hasKeyring) {
    ticket.push({
      done: false,
      text: t('Destination stamp: in Walter\'s locked desk drawer, in the Ticket Office.'),
      hint: game.attendantHasRing()
        ? t('His keyring is on his belt on the midnight round. At 1:30 it goes back on its hook in Security.')
        : t('His keyring hangs on a hook by the door in Security.'),
    });
  } else {
    ticket.push({
      done: false,
      text: run.ticketStub
        ? t('Destination stamp: the keyring opens Walter\'s drawer in the Ticket Office.')
        : t('Destination stamp: the keyring opens Walter\'s drawer, once there is a stub to stamp.'),
    });
  }

  // Part three: a transfer, punched.
  const slipOwner = run.chosenSlip === 'self'
    ? t('your own name')
    : t(PASSENGERS.find((x) => x.id === run.chosenSlip)?.name);
  if (run.ticketPunched) {
    ticket.push({ done: true, text: slipOwner ? t('Transfer slip, punched ({owner}).', { owner: slipOwner }) : t('Transfer slip, punched.') });
  } else if (!hints) {
    ticket.push({ done: false, text: t('Punched transfer slip.') });
  } else if (!run.hasPunch) {
    const code = p.knownCodes.locker;
    ticket.push({
      done: false,
      text: t('Transfer: the conductor\'s punch is in Locker 9, at the end of the lockers in Baggage Claim.'),
      hint: code
        ? t('Its dials take a four-letter word. You wrote it down: {code}.', { code })
        : p.loop >= 3
          ? t('Its dials take a four-letter word: the first letters of the cancelled services on the departure board, in the order the board lists them.')
          : t('Its dials take a four-letter word. The departure board has been trying to tell you something.'),
    });
  } else {
    ticket.push({
      done: false,
      text: run.chosenSlip
        ? t('Transfer: punch the slip you took, at the shoebox in Lost & Found.')
        : t('Transfer: take a slip from the shoebox on the desk in Lost & Found, and punch it.'),
      hint: t('Whichever slip you punch is where the bus takes you.'),
    });
  }

  // Then the bus.
  const valid = game.state.ticketValid;
  const boarding = clock.isAfter('03:25');
  let board;
  if (!valid) {
    board = { done: false, text: t('Board the 3:33 at Bay 9, with all three.') };
  } else if (!boarding) {
    board = { done: false, text: t('Board the 3:33 at Bay 9. The doors open when the board says BOARDING, at 3:25.') };
  } else {
    board = { done: false, text: t('Bay 9 is boarding. Go.') };
  }

  // Warnings for right now: the rules that are about to matter.
  const now = [];
  if (hints) {
    if (clock.isBetween('00:55', '02:00') && run.ticketStub) {
      now.push(t('Between 1:00 and 2:00, keep your ticket out of sight. Handling it counts.'));
    }
    if (clock.isAfter('03:00') && !valid) {
      now.push(t('He is waiting at Bay 9. Without a valid ticket, do not let him see you there.'));
    }
  }

  // What else the player has found out they could do.
  const more = [];
  const heard = p.heardStories.length;
  const total = PASSENGERS.length;
  if (heard >= total) {
    if (!p.endingsSeen.includes('home')) {
      more.push({ done: false, text: t('Every passenger has been heard. There is a slip with your own name in the Lost & Found shoebox.') });
    }
  } else if (hints || heard > 0) {
    const owner = game.carrying && PASSENGERS.find((x) => x.id === game.carrying.owner);
    more.push({
      done: false,
      text: owner
        ? (hints && WHERE[owner.where.room]
          ? t('Take {item} back to {name}, {where}.', { item: theItem(game.carrying.item, true), name: t(owner.name), where: WHERE[owner.where.room] })
          : t('Take {item} back to {name}.', { item: theItem(game.carrying.item, true), name: t(owner.name) }))
        : t('Passengers heard: {n} of {total}.', { n: heard, total }),
      hint: hints
        ? (owner
          ? t('Passengers heard so far: {n} of {total}.', { n: heard, total })
          : t('Each of them lost something, and it is all on the shelves in Lost & Found. Take it back to them, one thing at a time, and they will tell you what they know.'))
        : null,
    });
  }
  if (p.managerFound && !p.readLetter) {
    more.push({ done: false, text: t('Walter\'s safe: set the stopped clock in the manager\'s office to 11:47. The keyring opens the office.') });
  }
  if (p.readLetter && !p.endingsSeen.includes('nightshift')) {
    more.push({ done: false, text: t('Take the walkie from Walter\'s safe to Bay 9 with a valid ticket, and you could give him the ticket instead.') });
  }
  if (p.tunnelFound && !p.endingsSeen.includes('bay0')) {
    more.push({ done: false, text: t('The service door on the east wall of Baggage Claim. Walter\'s ring opens it. Dale never walked all the way down.') });
  }

  return { ticket, board, now, more };
}

// Something worth knowing, for waking up after a night that went wrong.
// The station never explains how he hunts; after he has caught you, the
// notebook does, one thing a night.
const TIPS = {
  caught: [
    t('He does not move while you are looking at him. Keep him in sight, and back away.'),
    t('He sees far less of you in the dark, and less again if you crouch. A lit flashlight shows you to him from across any room.'),
    t('Running breaks a rule. He hears it from anywhere in the building.'),
    t('In a hiding place, hold your breath when he comes close. Not too long: a gasp carries.'),
    t('A thrown coin pulls him to wherever it lands. You can pick it up again afterwards.'),
    t('The PA microphone in Security sends him to any room you name, and he stays there a while.'),
    t('While a record plays on the jukebox, he hears nothing at all. Neither do you.'),
  ],
  departed: [
    t('The 3:33 does not wait. The doors open at 3:25: be at Bay 9 with all three parts.'),
    t('Tonight\'s checklist is in your notebook, with where to go for each part of the ticket.'),
  ],
};

export function wakeTip(game) {
  const p = game.state.persistent;
  const list = TIPS[p.lastNight];
  if (!list || game.settings.hints === false) return '';
  return list[(p.loop - 2 + list.length * 8) % list.length];
}

// The first thing still to do, for the pause screen.
export function nextStep(game) {
  const o = objectives(game);
  const line = o.ticket.find((l) => !l.done) ?? o.board;
  return line.text;
}
