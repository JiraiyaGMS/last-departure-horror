# Trailer, screenshots and cover

Everything on the game's store page is rendered from the game itself, so it
can be made again after the game changes.

The scripts drive the real game in headless Chromium. Each shot in
`shots.js` is a cutscene: camera keys, plus whatever moves (his walk, the
monitors, a borrowed ending). `capture.cjs` takes over the page's clock
before the game loads, so every captured frame moves the game on by exactly
1/fps however long it took to draw. A software renderer at a few seconds a
frame still makes smooth, real-speed footage. Graphics are pinned to HIGH.

The soundtrack is the game's own audio engine (`src/audio.js`) rendered
offline: the hum, the drone, his keys, the door and the stinger are the
game's, cued against the edit in `trailer.json`.

## Running it

Start the capture dev server. It has no file watching or hot reload, so
editing files cannot reload a page mid-render; restart it after editing
`shots.js`.

    npx vite --config tools/media/vite.capture.config.js &
    export NODE_PATH=$(npm root -g)     # Playwright, installed globally

The trailer, from its shots, the title screen, the cards and the sound:

    cd tools/media
    node capture.cjs OUT/frames wake,hall,bus,rules,attendant,hide,cctv,ghosts,bay0,face
    node capture.cjs OUT/frames --title 168
    node cards.cjs OUT/cards
    node soundtrack.cjs OUT/soundtrack.wav
    python3 compose.py trailer.json OUT/frames OUT/cards OUT/soundtrack.wav OUT/trailer.mp4

Screenshots (1920 × 1080 with the HUD) and the cover still:

    node capture.cjs OUT/stills hall@140,rules@60,attendant@150,hide@115,cctv@100 --still --scale 1.5
    node capture.cjs OUT/cover cover@10 --no-bars --size 630x500 --scale 2
    python3 make_cover.py OUT/cover/cover/f_00010.jpg OUT/cover     # adds the logo

`name@N` renders only frame N of a shot, which is the quick way to check a
composition. A full trailer render is about 1,450 frames; on a machine
without a GPU that takes a couple of hours.

Needs `python3` with Pillow, and `ffmpeg` with libx264.
