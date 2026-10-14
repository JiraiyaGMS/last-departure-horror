#!/usr/bin/env bash
# Rebuilds public/models/cast.glb from scratch. Needs python3, pip and node.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HERE/.work}"
mkdir -p "$WORK"
cd "$WORK"

# Blender as a Python module, and MPFB (MakeHuman for Blender).
python3 -c "import bpy" 2>/dev/null || pip install bpy
[ -d mpfb2 ] || git clone --depth 1 https://github.com/makehumancommunity/mpfb2.git

# MakeHuman's system assets, released as CC0.
if [ ! -d assets ]; then
  curl -L -o system_assets.zip http://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
  unzip -q system_assets.zip -d assets
  python3 "$HERE/patch_textures.py" assets
fi

# boot.py and make_cast.py look for mpfb2/ and assets/ next to their own folder.
mkdir -p gen
cp "$HERE/boot.py" "$HERE/make_cast.py" "$HERE/cast.json" gen/
python3 gen/make_cast.py "$WORK/cast_raw.glb"

# One quantisation grid for the whole file keeps one skin per character.
G="npx -y @gltf-transform/cli@4"
$G dedup cast_raw.glb cast_d.glb
$G prune cast_d.glb cast_p.glb
$G quantize cast_p.glb cast_q.glb --quantization-volume scene
$G dedup cast_q.glb cast_qd.glb
$G meshopt cast_qd.glb "$HERE/../../public/models/cast.glb" --level medium --quantization-volume scene
ls -la "$HERE/../../public/models/cast.glb"
