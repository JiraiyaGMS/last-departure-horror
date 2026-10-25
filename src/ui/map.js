import { ROOMS, DOORS, roomAt } from '../level.js';
import { WHERE } from '../objectives.js';

// The map page of the notebook: the station as you have drawn it, a room at
// a time, in the same pencil as everything else. A room goes on the page the
// first time you walk into it and stays there from night to night. Doorways
// into rooms you have not been in yet get a question mark.
//
// North is up: the bus bays at the top, the gate corridor running up to them
// from the waiting hall. One unit is a metre.

const VIEW = { x: -28, z: -43, w: 71, h: 69 };

// Shorter than the signs. A pencil label has to fit inside the room.
const NAMES = {
  bays: 'Bus Bays',
  gate: 'Gate',
  hall: 'Waiting Hall',
  ticket: 'Tickets',
  manager: 'Manager',
  lostfound: 'Lost & Found',
  cctv: 'Security',
  diner: 'Diner',
  restroom: 'Restrooms',
  baggage: 'Baggage',
  tunnel: 'Tunnel',
  bay0: 'Bay 0',
};

// The same wobble every time the page is opened: a pencil line does not
// redraw itself.
function rng(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a, 31) + seed.charCodeAt(i)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => n.toFixed(2);

// A hand-ruled line: a little past each end, never quite straight.
function stroke(x1, z1, x2, z2, seed, wobble = 0.14) {
  const r = rng(seed);
  const len = Math.hypot(x2 - x1, z2 - z1);
  if (len < 0.05) return '';
  const ux = (x2 - x1) / len;
  const uz = (z2 - z1) / len;
  const over = 0.25 + r() * 0.35;
  const n = Math.max(2, Math.round(len / 1.6));
  let d = '';
  for (let i = 0; i <= n; i++) {
    const s = -over + ((len + over * 2) * i) / n;
    const off = (r() - 0.5) * 2 * wobble * (i === 0 || i === n ? 0.4 : 1);
    const x = x1 + ux * s - uz * off;
    const z = z1 + uz * s + ux * off;
    d += `${i ? 'L' : 'M'}${f(x)} ${f(z)}`;
  }
  return d;
}

// One room's walls, with the doorways left open.
function walls(name, r) {
  const sides = [
    { axis: 'z', at: r.z1, span: [r.x1, r.x2] },
    { axis: 'z', at: r.z2, span: [r.x1, r.x2] },
    { axis: 'x', at: r.x1, span: [r.z1, r.z2] },
    { axis: 'x', at: r.x2, span: [r.z1, r.z2] },
  ];
  let d = '';
  sides.forEach((side, si) => {
    const gaps = DOORS
      .filter((dr) => (dr.a === name || dr.b === name) && dr.axis === side.axis && Math.abs(dr.at - side.at) < 1e-6)
      .map((dr) => [Math.max(dr.from, side.span[0]), Math.min(dr.to, side.span[1])])
      .filter(([a, b]) => b > a)
      .sort((p, q) => p[0] - q[0]);
    let cursor = side.span[0];
    const runs = [];
    for (const [a, b] of gaps) {
      if (a > cursor) runs.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < side.span[1]) runs.push([cursor, side.span[1]]);
    runs.forEach(([a, b], ri) => {
      const seed = `${name}${si}${ri}`;
      d += side.axis === 'z' ? stroke(a, side.at, b, side.at, seed) : stroke(side.at, a, side.at, b, seed);
    });
  });
  return d;
}

// Diagonal pencil shading for the parts of the station that are outdoors.
function hatch(name, r) {
  const rand = rng(name + 'h');
  let d = '';
  for (let k = r.x1 - r.z2 + 1.2; k < r.x2 - r.z1; k += 2.4) {
    // A line x - z = k, clipped to the room.
    const pts = [];
    const tryPt = (x, z) => {
      if (x >= r.x1 - 1e-6 && x <= r.x2 + 1e-6 && z >= r.z1 - 1e-6 && z <= r.z2 + 1e-6) pts.push([x, z]);
    };
    tryPt(r.x1, r.x1 - k);
    tryPt(r.x2, r.x2 - k);
    tryPt(r.z1 + k, r.z1);
    tryPt(r.z2 + k, r.z2);
    if (pts.length < 2) continue;
    pts.sort((p, q) => p[0] - q[0]);
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const inset = 0.6 + rand() * 0.5;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < inset * 2 + 0.5) continue;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    d += `M${f(a[0] + ux * inset)} ${f(a[1] + uz * inset)}L${f(b[0] - ux * inset)} ${f(b[1] - uz * inset)}`;
  }
  return d;
}

// The furniture, from the station's own footprint: everything you would
// bump into, minus the walls (long, thin, and on a room's edge), which the
// rooms already draw. Low things are an outline; anything taller than you
// can see over gets shaded in.
function furniture(colliders, seen) {
  let outline = '';
  let tall = '';
  for (const c of colliders) {
    if ((c.top ?? 3) < 0.25) continue;
    const w = c.x2 - c.x1;
    const d = c.z2 - c.z1;
    // Legs, posts and pipes are too small to be worth a pencil.
    if (Math.max(w, d) < 0.35 || Math.min(w, d) < 0.06) continue;
    const cx = (c.x1 + c.x2) / 2;
    const cz = (c.z1 + c.z2) / 2;
    const room = roomAt(cx, cz);
    if (!room || !seen.has(room)) continue;
    const r = ROOMS[room];
    const edge = Math.min(c.x1 - r.x1, r.x2 - c.x2, c.z1 - r.z1, r.z2 - c.z2) < 0.45;
    if (edge && Math.min(w, d) <= 0.42 && Math.max(w, d) >= 1.0) continue;
    if (w * d > 80) continue;
    // A box drawn in one go, corners a little off: no overshoot at this
    // size, or every bench turns into a hash sign.
    const r2 = rng(`f${c.x1.toFixed(2)}${c.z1.toFixed(2)}`);
    const j = () => (r2() - 0.5) * 0.08;
    outline += `M${f(c.x1 + j())} ${f(c.z1 + j())}L${f(c.x2 + j())} ${f(c.z1 + j())}L${f(c.x2 + j())} ${f(c.z2 + j())}L${f(c.x1 + j())} ${f(c.z2 + j())}Z`;
    if ((c.top ?? 0) > 1.5) {
      // Diagonal shading, clipped to the footprint.
      for (let k = -d + 0.35; k < w; k += 0.35) {
        const ax = Math.max(0, k);
        const az = Math.max(0, -k);
        const bx = Math.min(w, k + d);
        const bz = Math.min(d, w - k);
        if (bx - ax < 0.1) continue;
        tall += `M${f(c.x1 + ax)} ${f(c.z1 + az)}L${f(c.x1 + bx)} ${f(c.z1 + bz)}`;
      }
    }
  }
  return { outline, tall };
}

// Short ticks either side of every doorway on the page, so an opening reads
// as a door and not as a gap in the pencil.
function jambs(seen) {
  let d = '';
  for (const dr of DOORS) {
    if (!seen.has(dr.a) && !seen.has(dr.b)) continue;
    for (const at of [dr.from, dr.to]) {
      d += dr.axis === 'z'
        ? `M${f(at)} ${f(dr.at - 0.45)}L${f(at)} ${f(dr.at + 0.45)}`
        : `M${f(dr.at - 0.45)} ${f(at)}L${f(dr.at + 0.45)} ${f(at)}`;
    }
  }
  return d;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// data: { visited: Set of room ids, you: { x, z, yaw }, marks: [{ x, z, text }],
// hides: [{ x, z }], locked(doorDef) -> bool, colliders: [{ x1, z1, x2, z2, top }] }
export function mapSVG(data) {
  const seen = data.visited;
  let pencil = '';
  let faint = '';
  let shade = '';
  let wash = '';
  let labels = '';
  for (const [name, r] of Object.entries(ROOMS)) {
    if (!seen.has(name)) continue;
    pencil += walls(name, r);
    faint += walls(name + '~', r);
    if (r.outdoor) shade += hatch(name, r);
    // A soft graphite wash over the floor, rubbed in unevenly.
    const wr = rng(name + 'w');
    const j = () => (wr() - 0.5) * 0.5;
    wash += `M${f(r.x1 + 0.3 + j())} ${f(r.z1 + 0.3 + j())}L${f(r.x2 - 0.3 + j())} ${f(r.z1 + 0.3 + j())}L${f(r.x2 - 0.3 + j())} ${f(r.z2 - 0.3 + j())}L${f(r.x1 + 0.3 + j())} ${f(r.z2 - 0.3 + j())}Z`;
    const cx = (r.x1 + r.x2) / 2;
    const cz = (r.z1 + r.z2) / 2;
    const size = Math.min(2.3, Math.max(1.5, (r.x2 - r.x1) / 6));
    const tilt = (rng(name + 't')() - 0.5) * 6;
    // The bays' label sits clear of the bus marks along the kerb.
    const lz = name === 'bays' ? r.z1 + 4 : cz;
    labels += `<text class="room" x="${f(cx)}" y="${f(lz)}" font-size="${f(size)}" transform="rotate(${f(tilt)} ${f(cx)} ${f(lz)})">${esc(NAMES[name])}</text>`;
  }

  // Doorways: a shut bar across a locked one, a question mark past one that
  // leads somewhere you have not been.
  let bars = '';
  let unknown = '';
  for (const d of DOORS) {
    const a = seen.has(d.a);
    const b = seen.has(d.b);
    if (!a && !b) continue;
    const mid = (d.from + d.to) / 2;
    if (d.locked && data.locked(d)) {
      bars += d.axis === 'z'
        ? stroke(d.from, d.at, d.to, d.at, d.id + 'bar', 0.05)
        : stroke(d.at, d.from, d.at, d.to, d.id + 'bar', 0.05);
    }
    if (a && b) continue;
    // Which side is the unknown one, and a step into it.
    const into = a ? d.b : d.a;
    const r = ROOMS[into];
    const sign = d.axis === 'z' ? ((r.z1 + r.z2) / 2 > d.at ? 1 : -1) : ((r.x1 + r.x2) / 2 > d.at ? 1 : -1);
    const x = d.axis === 'z' ? mid : d.at + sign * 2.2;
    const z = d.axis === 'z' ? d.at + sign * 2.2 : mid;
    unknown += `<text class="unknown" x="${f(x)}" y="${f(z + 0.9)}">?</text>`;
  }

  // Hiding places in the rooms on the page.
  let hides = '';
  for (const h of data.hides) {
    const room = roomAt(h.x, h.z);
    if (!room || !seen.has(room)) continue;
    const r = rng(`hide${h.x}${h.z}`);
    const s = 0.75;
    const j = () => (r() - 0.5) * 0.18;
    hides += `M${f(h.x - s + j())} ${f(h.z - s + j())}L${f(h.x + s + j())} ${f(h.z - s + j())}L${f(h.x + s + j())} ${f(h.z + s + j())}L${f(h.x - s + j())} ${f(h.z + s + j())}Z`;
  }

  // Tonight's next steps, ringed in red.
  let marks = '';
  for (const m of data.marks) {
    const room = roomAt(m.x, m.z);
    if (!room || !seen.has(room)) continue;
    const r = rng(m.text);
    const rx = 1.5 + r() * 0.3;
    const ry = 1.2 + r() * 0.25;
    marks += `<ellipse class="ring" cx="${f(m.x)}" cy="${f(m.z)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f((r() - 0.5) * 30)} ${f(m.x)} ${f(m.z)})"/>`;
    // The note goes on whichever side has more room on the page.
    const right = m.x < VIEW.x + VIEW.w - 14;
    marks += `<text class="note" x="${f(m.x + (right ? 2.1 : -2.1))}" y="${f(m.z + 0.7)}" text-anchor="${right ? 'start' : 'end'}">${esc(m.text)}</text>`;
  }

  const kit = furniture(data.colliders ?? [], seen);

  // You: an arrow the way you are facing.
  let you = '';
  if (data.you && roomAt(data.you.x, data.you.z)) {
    const { x, z, yaw } = data.you;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const px = -fz;
    const pz = fx;
    const tip = [x + fx * 1.7, z + fz * 1.7];
    const l = [x - fx * 0.9 + px * 1.0, z - fz * 0.9 + pz * 1.0];
    const rr = [x - fx * 0.9 - px * 1.0, z - fz * 0.9 - pz * 1.0];
    const back = [x - fx * 0.35, z - fz * 0.35];
    you = `<circle class="youring" cx="${f(x)}" cy="${f(z)}" r="2.4"/>`
      + `<path class="you" d="M${f(tip[0])} ${f(tip[1])}L${f(l[0])} ${f(l[1])}L${f(back[0])} ${f(back[1])}L${f(rr[0])} ${f(rr[1])}Z"/>`
      + `<text class="youtag" x="${f(x + 2.6)}" y="${f(z + 3.4)}">you</text>`;
  }

  // The sheet it is drawn on: graph paper, taped in, not quite square.
  const S = { x: VIEW.x + 0.4, z: VIEW.z + 0.4, w: VIEW.w - 0.8, h: VIEW.h - 0.8 };
  const sheet = `<g transform="rotate(-0.6 ${f(S.x + S.w / 2)} ${f(S.z + S.h / 2)})">`
    + `<rect class="sheet" x="${f(S.x)}" y="${f(S.z)}" width="${f(S.w)}" height="${f(S.h)}"/>`
    + `<rect x="${f(S.x)}" y="${f(S.z)}" width="${f(S.w)}" height="${f(S.h)}" fill="url(#mapgrid)"/>`
    + `<rect class="tape" x="${f(S.x - 2)}" y="${f(S.z - 1)}" width="9" height="3.2" transform="rotate(-32 ${f(S.x + 2.5)} ${f(S.z + 0.6)})"/>`
    + `<rect class="tape" x="${f(S.x + S.w - 7)}" y="${f(S.z - 1)}" width="9" height="3.2" transform="rotate(34 ${f(S.x + S.w - 2.5)} ${f(S.z + 0.6)})"/>`
    + '</g>';

  // A title, a north arrow and a scale, the way anyone who has ever had to
  // draw a plan at school would.
  const tx = 34.8;
  const tz = -39;
  const title = `<text class="maptitle" x="${tx}" y="${tz}">Grayhollow</text>`
    + `<text class="mapsub" x="${tx}" y="${tz + 2.6}">transit center, Nov 3</text>`
    + `<path class="underline" d="${stroke(tx - 6.5, tz + 0.7, tx + 6.5, tz + 0.7, 'title', 0.08)}"/>`;
  const nx = 35;
  const nz = -27;
  const north = `<path class="north" d="M${nx} ${nz - 4}L${nx - 1.4} ${nz + 1.2}L${nx} ${nz}L${nx + 1.4} ${nz + 1.2}Z"/>`
    + `<circle class="northring" cx="${nx}" cy="${nz - 1}" r="3.6"/>`
    + `<text class="northN" x="${nx}" y="${nz - 5.6}">N</text>`;
  const sx = -26;
  const sz = 23.5;
  let scale = `<path class="scale" d="M${sx} ${sz}L${sx + 10} ${sz}`;
  for (let i = 0; i <= 10; i += 5) scale += `M${sx + i} ${sz - (i % 10 ? 0.5 : 0.8)}L${sx + i} ${sz + (i % 10 ? 0.5 : 0.8)}`;
  scale += `"/><text class="scaletext" x="${sx + 11}" y="${sz + 0.6}">10 m (about)</text>`;

  return `<svg class="stationmap" viewBox="${VIEW.x} ${VIEW.z} ${VIEW.w} ${VIEW.h}" role="img" aria-label="A pencil map of the rooms you have been in">`
    + '<defs>'
    + '<pattern id="mapgrid" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M2 0H0V2" fill="none" stroke="rgba(70,110,150,0.22)" stroke-width="0.06"/></pattern>'
    + '<filter id="graphite" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="0.32" xChannelSelector="R" yChannelSelector="G"/></filter>'
    + '</defs>'
    + sheet
    + `<path class="wash" d="${wash}"/>`
    + '<g filter="url(#graphite)">'
    + `<path class="shade" d="${shade}"/>`
    + `<path class="kit" d="${kit.outline}"/>`
    + `<path class="kittall" d="${kit.tall}"/>`
    + `<path class="faint" d="${faint}"/>`
    + `<path class="pencil" d="${pencil}"/>`
    + `<path class="jamb" d="${jambs(seen)}"/>`
    + `<path class="bar" d="${bars}"/>`
    + `<path class="hide" d="${hides}"/>`
    + '</g>'
    + title + north + scale
    + labels + unknown + marks + you
    + '</svg>';
}

// The facing page: what the marks mean, and how much of the station is down.
export function mapKey(data) {
  const here = data.here && data.visited.has(data.here) ? WHERE[data.here] : null;
  let html = '<div class="mapkey">';
  html += '<h4>THE STATION</h4>';
  html += `<p class="entry">${here ? `You are ${esc(here)}.` : 'You are somewhere you have not drawn.'}</p>`;
  html += `<p class="entry">Rooms drawn: ${data.visited.size}.</p>`;
  html += '<h4>KEY</h4><ul>';
  html += '<li><span class="sym you"></span>You, and the way you are facing</li>';
  html += '<li><span class="sym ring"></span>Tonight\'s next steps</li>';
  html += '<li><span class="sym hide"></span>Somewhere to hide</li>';
  html += '<li><span class="sym bar"></span>A locked door</li>';
  html += '<li><span class="sym q">?</span>Somewhere you have not been</li>';
  html += '</ul></div>';
  return html;
}
