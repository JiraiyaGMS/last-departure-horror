// Zips dist/ into the shape itch.io wants for an HTML game: index.html at the
// top of the archive, everything it loads beside it. Upload the result as a
// "This file will be played in the browser" file.
//
//   npm run itch          builds, then writes last-departure-itch.zip
//
// No dependencies: a zip is a list of deflated files with a directory at the
// end, and node:zlib does the deflating.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, process.argv[2] ?? 'last-departure-itch.zip');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing. Run `npm run build` first (or `npm run itch`, which does both).');
  process.exit(1);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Already-compressed formats are stored as they are: deflating them again
// costs time and saves nothing.
const STORE = /\.(jpe?g|png|webp|glb|woff2?|zip|ogg|mp3)$/i;

// A fixed timestamp, so the same build makes the same zip.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01

const locals = [];
const centrals = [];
let offset = 0;
for (const file of walk(DIST)) {
  const name = Buffer.from(relative(DIST, file).split(sep).join('/'), 'utf8');
  const data = readFileSync(file);
  const crc = crc32(data);
  const deflated = STORE.test(file) ? null : deflateRawSync(data, { level: 9 });
  const useDeflate = deflated && deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + body.length;
}

const dirSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(dirSize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(OUT, zip);
console.log(`${relative(ROOT, OUT)}: ${centrals.length / 2} files, ${(zip.length / 1048576).toFixed(1)} MB`);
console.log('Upload it to itch.io as an HTML game ("This file will be played in the browser").');
