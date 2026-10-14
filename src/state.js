const SAVE_KEY = 'last-departure-save-v1';

// Knowledge survives the loop. Objects do not.
function freshPersistent() {
  return {
    loop: 1,
    notes: [],
    knownCodes: {},
    knownFakeRules: [],
    heardStories: [],
    endingsSeen: [],
    sawCamera4: 0,
    tunnelFound: false,
    managerFound: false,
    // Has opened Walter's safe and read his letter, on any night.
    readLetter: false,
  };
}

function freshRunState() {
  return {
    coins: 0,
    cells: 0,             // spare battery cells, swapped in one at a time
    hasFlashlight: false,
    hasKeyring: false,
    hasPunch: false,
    hasWalkie: false,
    slips: [],            // transfer slips picked up this loop
    chosenSlip: null,
    ticketStub: false,
    ticketStamped: false,
    ticketPunched: false,
    ticketVisibleUntil: -1,
    returnedThisLoop: [],
    pickedUp: new Set(),
    jukeboxPlayed: false,
    paAnsweredWindow: null,
    caught: false,
    boarded: false,
  };
}

// Notebook lines reworded since an older build, so an old save does not end
// up with both versions of the same thing.
const REWORDED_NOTES = {
  'Fourteen postcards in Lost & Found. None were ever sent.': 'Postcards in Lost & Found, written to people on the 11:47. None were ever sent.',
};

export class GameState {
  constructor() {
    this.persistent = freshPersistent();
    this.run = freshRunState();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const fresh = freshPersistent();
        this.persistent = { ...fresh, ...parsed };
        // A save from an older build, or one edited by hand, must not be able
        // to put the wrong type in a field the game iterates over.
        for (const key of ['notes', 'knownFakeRules', 'heardStories', 'endingsSeen']) {
          if (!Array.isArray(this.persistent[key])) this.persistent[key] = fresh[key];
        }
        if (!this.persistent.knownCodes || typeof this.persistent.knownCodes !== 'object') this.persistent.knownCodes = {};
        for (const n of this.persistent.notes) {
          if (n && REWORDED_NOTES[n.text]) n.text = REWORDED_NOTES[n.text];
        }
        if (!Number.isFinite(this.persistent.loop) || this.persistent.loop < 1) this.persistent.loop = 1;
      }
    } catch {
      this.persistent = freshPersistent();
    }
  }

  // Anything to continue from: a notebook entry or a night already lived.
  get hasProgress() {
    return this.persistent.loop > 1 || this.persistent.notes.length > 1 || this.persistent.endingsSeen.length > 0;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.persistent));
    } catch {
      // Private browsing or a full quota: the run still works, it just won't persist.
    }
  }

  wipe() {
    this.persistent = freshPersistent();
    this.run = freshRunState();
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing stored to remove.
    }
  }

  newLoop() {
    this.run = freshRunState();
    // Knowledge-gated items: once you know where the flashlight is you keep
    // finding it, but you still have to walk there.
  }

  // ---- notebook ----------------------------------------------------------

  addNote(category, text) {
    const exists = this.persistent.notes.some((n) => n.text === text);
    if (exists) return false;
    this.persistent.notes.push({ category, text, loop: this.persistent.loop });
    this.save();
    return true;
  }

  hasNote(text) {
    return this.persistent.notes.some((n) => n.text === text);
  }

  learnCode(name, value) {
    if (this.persistent.knownCodes[name] === value) return false;
    this.persistent.knownCodes[name] = value;
    this.save();
    return true;
  }

  knowsCode(name) {
    return this.persistent.knownCodes[name] !== undefined;
  }

  markFakeRule(id) {
    if (this.persistent.knownFakeRules.includes(id)) return false;
    this.persistent.knownFakeRules.push(id);
    this.save();
    return true;
  }

  knowsFake(id) {
    return this.persistent.knownFakeRules.includes(id);
  }

  hearStory(id) {
    if (this.persistent.heardStories.includes(id)) return false;
    this.persistent.heardStories.push(id);
    this.save();
    return true;
  }

  heardAllStories(total) {
    return this.persistent.heardStories.length >= total;
  }

  recordEnding(id) {
    if (!this.persistent.endingsSeen.includes(id)) {
      this.persistent.endingsSeen.push(id);
      this.save();
    }
  }

  // ---- ticket ------------------------------------------------------------

  get ticketValid() {
    return this.run.ticketStub && this.run.ticketStamped && this.run.ticketPunched;
  }

  get ticketParts() {
    return [
      this.run.ticketStub ? 'STUB' : null,
      this.run.ticketStamped ? 'STAMP' : null,
      this.run.ticketPunched ? 'TRANSFER' : null,
    ].filter(Boolean);
  }
}
