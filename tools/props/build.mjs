// Builds public/models/props.glb: every model in props.json, downloaded from
// Poly Haven (all CC0), split into the pieces the game places by name,
// simplified, its textures shrunk to WebP, and the whole lot compressed.
//
//   npm install && node build.mjs
//
// Downloads are cached in .work/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, simplify, textureCompress, mergeDocuments, meshopt, getBounds,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
const OUT = path.join(HERE, '..', '..', 'public', 'models', 'props.glb');
const config = JSON.parse(fs.readFileSync(path.join(HERE, 'props.json'), 'utf8'));
const UA = { 'User-Agent': 'last-departure-horror asset build (CC0 Poly Haven models)' };

async function fetchModel(id) {
  const dir = path.join(WORK, id);
  const gltf = path.join(dir, `${id}_1k.gltf`);
  if (fs.existsSync(path.join(dir, 'done'))) return gltf;
  const info = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
  const g = info.gltf['1k'].gltf;
  const files = [[g.url, path.basename(g.url)], ...Object.entries(g.include).map(([rel, v]) => [v.url, rel])];
  for (const [url, rel] of files) {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  fs.writeFileSync(path.join(dir, 'done'), 'ok');
  return gltf;
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

let master = null;
for (const src of config.sources) {
  const doc = await io.read(await fetchModel(src.id));
  const transforms = [weld()];
  // Small things are allowed to lose more shape: their normal maps carry
  // the detail, and nobody studies the silhouette of a soda can.
  if (src.ratio < 1) transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio: src.ratio, error: src.error ?? 0.008 }));
  transforms.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [src.tex, src.tex], quality: 82 }));
  await doc.transform(...transforms);

  // One root per piece, named for it, with the piece standing on the origin:
  // centred in plan, its lowest point at y = 0.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const roots = scene.listChildren();
  const used = new Set();
  for (const piece of src.pieces) {
    const re = new RegExp(piece.nodes);
    const nodes = roots.filter((n) => re.test(n.getName()));
    if (!nodes.length) throw new Error(`${src.id}: no nodes for ${piece.name}`);
    const holder = doc.createNode(`${piece.name}__parts`);
    for (const n of nodes) {
      // Some pieces are posed in the source (a lid leaning on its can).
      if (piece.upright) n.setRotation([0, 0, 0, 1]);
      scene.removeChild(n);
      holder.addChild(n);
      used.add(n);
    }
    const { min, max } = getBounds(holder);
    holder.setTranslation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]);
    // A few sources are authored at the wrong scale.
    const root = doc.createNode(piece.name).addChild(holder).setScale(Array(3).fill(piece.scale ?? 1));
    scene.addChild(root);
    console.log(piece.name.padEnd(16), 'size', [0, 1, 2].map((k) => +((max[k] - min[k]) * (piece.scale ?? 1)).toFixed(3)).join(' x '));
  }
  for (const n of roots) if (!used.has(n)) n.dispose();
  await doc.transform(prune());

  if (!master) {
    master = doc;
    continue;
  }
  mergeDocuments(master, doc);
}

// Everything into the first scene.
const scenes = master.getRoot().listScenes();
for (const s of scenes.slice(1)) {
  for (const n of s.listChildren()) {
    s.removeChild(n);
    scenes[0].addChild(n);
  }
  s.dispose();
}
master.getRoot().setDefaultScene(scenes[0]);
for (const b of master.getRoot().listBuffers().slice(1)) b.dispose();
const buffer = master.getRoot().listBuffers()[0];
for (const a of master.getRoot().listAccessors()) a.setBuffer(buffer);
await master.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(OUT, master);
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), 'MB');
