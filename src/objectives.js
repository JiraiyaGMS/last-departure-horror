// What tonight still needs, worked out from where the player has got to.
//
// The station never tells you what to do, and the notebook is a record of
// what you have learned rather than a plan, so a first-time player could
// wander the whole eleven minutes not knowing the ticket was three things in
// three rooms. This is the plan: the next step of each part of the ticket,
// with where to go for it, plus what else the player has found out they could
// do. With hints off it is the bare checklist.

import { PASSENGERS, theItem } from './content.js';

// Where someone is, as you would say it.
const WHERE = {
  hall: 'in the waiting hall',
  bays: 'out at the bus bays',
  gate: 'in the gate corridor',
  ticket: 'in the Ticket Office',
  manager: 'in the manager\'s office',
  lostfound: 'in Lost & Found',
  cctv: 'in Security',
  diner: 'at the diner counter',
  restroom: 'in the restrooms',
  baggage: 'in Baggage Claim',
  tunnel: 'down the service tunnel',
  bay0: 'at Bay 0',
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
    ticket.push({ done: true, text: 'Ticket stub, printed.' });
  } else if (!hints) {
    ticket.push({ done: false, text: `Ticket stub (${coins}/4 coins).` });
  } else {
    ticket.push({
      done: false,
      text: `Ticket stub: four 1987 coins in the machine in the Ticket Office (${coins}/4).`,
      hint: run.coins >= 4
        ? 'You have the fare.'
        : 'Coins turn up where people waited: under the benches, on desks, counters and sinks. The diner\'s vending machines each give one, loudly.',
    });
  }

  // Part two: the stamp, in Walter's drawer.
  if (run.ticketStamped) {
    ticket.push({ done: true, text: 'Destination stamp: THE COAST.' });
  } else if (!hints) {
    ticket.push({ done: false, text: 'Destination stamp.' });
  } else if (!run.hasKeyring) {
    ticket.push({
      done: false,
      text: 'Destination stamp: in Walter\'s locked desk drawer, in the Ticket Office.',
      hint: game.attendantHasRing()
        ? 'His keyring is on his belt on the midnight round. At 1:30 it goes back on its hook in Security.'
        : 'His keyring hangs on a hook by the door in Security.',
    });
  } else {
    ticket.push({
      done: false,
      text: run.ticketStub
        ? 'Destination stamp: the keyring opens Walter\'s drawer in the Ticket Office.'
        : 'Destination stamp: the keyring opens Walter\'s drawer, once there is a stub to stamp.',
    });
  }

  // Part three: a transfer, punched.
  const slipOwner = run.chosenSlip === 'self'
    ? 'your own name'
    : PASSENGERS.find((x) => x.id === run.chosenSlip)?.name;
  if (run.ticketPunched) {
    ticket.push({ done: true, text: `Transfer slip, punched${slipOwner ? ` (${slipOwner})` : ''}.` });
  } else if (!hints) {
    ticket.push({ done: false, text: 'Punched transfer slip.' });
  } else if (!run.hasPunch) {
    const code = p.knownCodes.locker;
    ticket.push({
      done: false,
      text: 'Transfer: the conductor\'s punch is in Locker 9, at the end of the lockers in Baggage Claim.',
      hint: code
        ? `Its dials take a four-letter word. You wrote it down: ${code}.`
        : 'Its dials take a four-letter word. The departure board has been trying to tell you something.',
    });
  } else {
    ticket.push({
      done: false,
      text: run.chosenSlip
        ? 'Transfer: punch the slip you took, at the shoebox in Lost & Found.'
        : 'Transfer: take a slip from the shoebox on the desk in Lost & Found, and punch it.',
      hint: 'Whichever slip you punch is where the bus takes you.',
    });
  }

  // Then the bus.
  const valid = game.state.ticketValid;
  const boarding = clock.isAfter('03:25');
  let board;
  if (!valid) {
    board = { done: false, text: 'Board the 3:33 at Bay 9, with all three.' };
  } else if (!boarding) {
    board = { done: false, text: 'Board the 3:33 at Bay 9. The doors open when the board says BOARDING, at 3:25.' };
  } else {
    board = { done: false, text: 'Bay 9 is boarding. Go.' };
  }

  // Warnings for right now: the rules that are about to matter.
  const now = [];
  if (hints) {
    if (clock.isBetween('00:55', '02:00') && run.ticketStub) {
      now.push('Between 1:00 and 2:00, keep your ticket out of sight. Handling it counts.');
    }
    if (clock.isAfter('03:00') && !valid) {
      now.push('He is waiting at Bay 9. Without a valid ticket, do not let him see you there.');
    }
  }

  // What else the player has found out they could do.
  const more = [];
  const heard = p.heardStories.length;
  const total = PASSENGERS.length;
  if (heard >= total) {
    if (!p.endingsSeen.includes('home')) {
      more.push({ done: false, text: 'Every passenger has been heard. There is a slip with your own name in the Lost & Found shoebox.' });
    }
  } else if (hints || heard > 0) {
    const owner = game.carrying && PASSENGERS.find((x) => x.id === game.carrying.owner);
    more.push({
      done: false,
      text: owner
        ? `Take ${theItem(game.carrying.item.split(',')[0])} back to ${owner.name}${hints && WHERE[owner.where.room] ? `, ${WHERE[owner.where.room]}` : ''}.`
        : `Passengers heard: ${heard} of ${total}.`,
      hint: hints
        ? (owner
          ? `Passengers heard so far: ${heard} of ${total}.`
          : 'Each of them lost something, and it is all on the shelves in Lost & Found. Take it back to them, one thing at a time, and they will tell you what they know.')
        : null,
    });
  }
  if (p.managerFound && !p.readLetter) {
    more.push({ done: false, text: 'Walter\'s safe: set the stopped clock in the manager\'s office to 11:47. The keyring opens the office.' });
  }
  if (p.readLetter && !p.endingsSeen.includes('nightshift')) {
    more.push({ done: false, text: 'Take the walkie from Walter\'s safe to Bay 9 with a valid ticket, and you could give him the ticket instead.' });
  }
  if (p.tunnelFound && !p.endingsSeen.includes('bay0')) {
    more.push({ done: false, text: 'The service door on the east wall of Baggage Claim. Walter\'s ring opens it. Dale never walked all the way down.' });
  }

  return { ticket, board, now, more };
}

// The first thing still to do, for the pause screen.
export function nextStep(game) {
  const o = objectives(game);
  const line = o.ticket.find((l) => !l.done) ?? o.board;
  return line.text;
}
