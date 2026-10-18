# The props

`public/models/props.glb` holds the station's photo-scanned clutter: bins,
crates, barrels, suitcases, the CCTV cameras, chairs, shelving, the register in
the diner, and so on. Every model comes from [Poly Haven](https://polyhaven.com/models)
and is **CC0** (public domain): no attribution required, though the list of
sources is in `props.json` and below.

## Rebuilding

    cd tools/props
    npm install
    node build.mjs

downloads each model in `props.json` (1k textures, cached in `.work/`), splits
it into the pieces the game places by name, stands each piece on its own
origin, simplifies the heavier ones, shrinks the textures to WebP and writes
one meshopt-compressed file to `public/models/props.glb`.

## Adding a prop

Add a source to `props.json`:

| field | meaning |
| --- | --- |
| `id` | the Poly Haven model id (the last part of its URL) |
| `tex` | largest texture side to keep, in pixels |
| `ratio` | how much of the geometry simplification keeps (1 = all of it) |
| `pieces` | the props to cut from it, each `{ name, nodes, upright?, scale? }` |

`nodes` is a regular expression over the source's top-level node names (`.`
for all of them); `upright` resets those nodes' rotation, for a lid posed
leaning against its can; `scale` fixes a source authored at the wrong size.

In the game, `src/furnish.js` places a piece with
`model('name', x, y, z, rotY, { block, tint, fallback })`, and `src/models.js`
loads the file.

## Sources

Barrel_01, binder_notebook, cardboard_box_01, CashRegister_01, can_rusted,
cigarette_pack, concrete_road_barrier, fire_alarm, hand_truck,
industrial_wall_lamp, metal_tool_chest, metal_trash_can,
office_notepads, old_tyre, plastic_crate_01, potted_plant_02, power_box_01,
SchoolChair_01, security_camera_01, stationery_supplies,
steel_frame_shelves_01, Television_01, trashbag, utility_box_02,
vintage_suitcase, WetFloorSign_01, wooden_crate_01 — all by Poly Haven
contributors, all CC0.
