# The cast

`public/models/cast.glb` holds every person in the station: the Attendant and
the fourteen passengers. They are generated, not modelled by hand, with
[MPFB](https://github.com/makehumancommunity/mpfb2) (MakeHuman for Blender)
from MakeHuman's system asset pack.

## Licence

Everything in the file is **CC0** (public domain): use it, change it, ship it,
no credit needed.

- The bodies, skeletons and weights come from MPFB's bundled assets (base mesh,
  targets, rigs), which MPFB's `LICENSE.md` (section C) releases as CC0.
- The skins, hair, eyes and clothes come from MakeHuman's
  `makehuman_system_assets` pack, also released as CC0.
- MPFB's `LICENSE.md` (section D) makes no claim over anything it exports.
  MPFB's own code is GPLv3, but it is only run to build the file; none of it
  ships with the game.

The two T-shirts in the pack carry the MakeHuman logo; `patch_textures.py`
paints it off before building.

## Rebuilding

    ./tools/cast/build.sh

needs `python3`, `pip`, `git` and `node`. It installs Blender as a Python
module (`pip install bpy`), clones MPFB, downloads the asset pack (about
280 MB), builds everything in `cast.json` and compresses the result into
`public/models/cast.glb`. Working files go in `tools/cast/.work/`.

## Changing someone

Each entry in `cast.json` is one person:

| field | meaning |
| --- | --- |
| `id` | the passenger id from `src/content.js`, or `attendant` |
| `gender` | 0 female .. 1 male |
| `years` | age |
| `ethnicity` | weights for `c`aucasian, `a`frican, a`s`ian |
| `weight`, `muscle`, `height`, `proportions` | MakeHuman macros, 0..1 |
| `skin` | a skin from `assets/skins` |
| `hair`, `eyebrows` | from `assets/hair`, `assets/eyebrows` |
| `clothes` | any of `assets/clothes`, shoes and hats included |

## His face

`public/textures/face.webp` is what the screen shows when the Attendant
catches you, and in the three-frame flashes before that. It is the same
`attendant` from `cast.json`, rendered in Blender (Cycles) by `make_face.py`:
MakeHuman's own expression targets drop his jaw and stretch his eyes open, the
skin is drained of colour, the eyes are clouded over, a transit cap is built
round his head, and a torch lights him from below. `post_face.py` crops it,
drains it, adds grain and a faint double exposure, and fades the edges to
transparent. The build script runs both; on their own:

    python3 tools/cast/.work/gen/make_face.py face.png 160
    python3 tools/cast/post_face.py face.png public/textures/face.webp

Like the cast, it is made entirely from CC0 assets and is CC0 itself.

## The skeleton

Every character is exported with the `game_engine` skeleton and a second,
lighter copy of its body and clothes (`<id>_lod1_*`) that the game draws past
a few metres. In the game, `src/people.js` does not animate them itself: the
original figure rigs from `src/figures.js` are still posed by the same code,
and their pose is copied onto these bodies every frame.
