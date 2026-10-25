# Last Departure

A first-person horror game that runs in the browser.

> Grayhollow Transit Center, November 3, 1987. You fell asleep waiting
> somewhere you never meant to stay. The last bus leaves Bay 9 at 3:33 AM, and
> you need a valid ticket. The station has rules. Some of them are lies.

Every night lasts about eleven minutes. Get caught, or miss the bus, and you
wake on the same bench at 11:47 PM with everything you learned still in your
notebook and nothing in your pockets. There is more than one way out.

Best played with headphones, in the dark.

## Controls

| Keyboard and mouse | |
| --- | --- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, mouse | Move, look |
| <kbd>E</kbd> | Use, pick up, hide, read |
| <kbd>Tab</kbd> | Notebook, with tonight's checklist |
| <kbd>C</kbd> | Crouch (hold, or toggle in Settings) |
| <kbd>Shift</kbd> | Run, against the rules |
| <kbd>F</kbd> / <kbd>B</kbd> | Flashlight / fresh battery cell |
| <kbd>G</kbd> | Throw a coin |
| <kbd>R</kbd> | Show your ticket, or answer |
| <kbd>Space</kbd> / <kbd>Q</kbd> | Hold your breath / leave, while hidden |
| <kbd>Esc</kbd> | Pause |

With a controller: left stick moves, right stick looks, <kbd>A</kbd> uses,
<kbd>B</kbd> backs out of things (or crouches), <kbd>X</kbd> flashlight,
<kbd>Y</kbd> ticket, <kbd>LB</kbd>/<kbd>RB</kbd> coin and cell, <kbd>LT</kbd>
hold breath, <kbd>RT</kbd> run, <kbd>View</kbd> notebook, <kbd>Menu</kbd> pause.
The D-pad answers questions and works every menu and the locker dials. The
prompts switch to the pad's buttons while you use it, and it rumbles.

On a tablet or phone the controls are on screen: a stick under the left thumb,
look by dragging on the right, and buttons for everything else.

Settings has brightness (the game asks once, the first time), look
sensitivity, field of view, text size, toggle crouch, hints, reduced flashing
and shake, graphics quality and fullscreen.

## Running it

Needs Node 22.

    npm ci
    npm run dev        # http://localhost:5173, reloads as you edit
    npm run build      # the finished game, in dist/
    npm run preview    # serves dist/ the way a host would

## Putting it on itch.io

    npm run itch

builds the game and writes `last-departure-itch.zip`, with `index.html` at the
top. On the itch.io page, upload it, tick **This file will be played in the
browser**, and in **Embed options**:

- set the viewport to 1280 × 720 (or 960 × 540),
- tick **Mobile friendly** (the game has touch controls) with landscape
  orientation,
- leave **Fullscreen button** on (the game has its own as well).

### Publishing automatically

`.github/workflows/itch.yml` builds the game on every push and pull request
and keeps it as an artifact called `last-departure-itch`, ready to upload as
it is. To have every push to `main` published to the itch.io page without
touching the zip:

1. Get an API key: `butler login`, or itch.io → Settings → API keys.
2. In the GitHub repository → Settings → Secrets and variables → Actions:
   - add a **secret** `BUTLER_API_KEY` with the key,
   - add a **variable** `ITCH_TARGET` with `your-itch-username/your-game-slug`.

The game goes to the page's `html5` channel. The same build also deploys to
GitHub Pages (`deploy.yml`) and to Cloudflare Workers (`npm run deploy`,
configured in `wrangler.jsonc`).

## How it is made

Three.js and Vite, no engine. Everything is in `src/`:

- `main.js` runs the game: input, the night's schedule, interaction, endings.
- `level.js` and `furnish.js` build the station; `props.js` and `models.js`
  the things in it; `people.js` and `figures.js` the people.
- `attendant.js` is him. `director.js` and `presence.js` decide when the
  station misbehaves; `fear.js` is the one place that dread is kept, and
  everything that frightens or shows fear reads and writes it.
- `rules.js`, `state.js`, `loop.js` and `objectives.js` are the rules, the save,
  the clock and tonight's checklist.
- `content.js` has all the writing.
- `audio.js` synthesizes every sound, the room echoes included: there are no
  audio files.
- `render.js` is the post-processing; `quality.js` picks and governs the
  graphics tier.
- `cutscene.js`, `scenes.js` and `sets.js` are the first-person cutscenes.

The cast and props are generated from CC0 sources by the scripts in `tools/`;
see `public/models/CREDITS.md` and `public/textures/CREDITS.md`.
