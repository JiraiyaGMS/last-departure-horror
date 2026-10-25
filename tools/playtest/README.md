# Playtests

Scripts that play the built game in a headless Chromium and check it still
works, through the game's own code: `window.__game`.

- `endings.mjs` plays every way a night can end: all four endings, being
  caught and missing the bus, each through the real interactables.
- `audit.mjs` stands everywhere a player could stand near every interactable
  and hiding place, aims at it, and checks the game offers it, and that
  nothing can be used through a wall.
- `setpieces.mjs` fires every scare and every set piece of the night's
  schedule, works the machines, and hides, holds its breath and gets caught.
- `monkey.mjs` plays at random for a few minutes: keys in any order, menus
  over menus, settings changed at bad moments, the window resized, scares,
  getting caught. It checks nothing throws, nothing is left stuck, and the
  game can still be played at the end. It is seeded (`SEED=n`), so a failure
  replays exactly.

Each prints `ok` or `FAIL` per check and exits non-zero on a failure or any
console error.

## Running

From the repository root, build and serve the game:

    npm run build
    npx vite preview --port 4173

then, in another terminal:

    cd tools/playtest
    npm install
    npx playwright install chromium   # once
    npm run all                       # or endings / audit / setpieces / monkey

A different address can be given as an argument: `node audit.mjs
http://localhost:5173/`. They render in software, so they are slow (a few
minutes each) but need no GPU.

They also run on every pull request (`.github/workflows/playtest.yml`).

## The itch.io pictures

`promo.mjs` renders the screenshots and cover in `promo/` from the game
itself, at its highest settings with the HUD hidden: `node promo.mjs`, or
`ONLY=hall,cover node promo.mjs` for some of them. A few minutes a picture.
