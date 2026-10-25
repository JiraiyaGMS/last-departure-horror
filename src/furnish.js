import * as THREE from 'three';
import { surface, tint, liveCanvas, dropLive } from './textures.js';
import { ROOMS } from './level.js';
import { segmentBlocked } from './collision.js';
import { faceView, zoomView, aimView } from './inspect.js';
import { BOARD_ROUTES, DOCUMENTS, PASSENGERS, LOCKER_CODE } from './content.js';
import {
  Build, makeBench, makePayphone, makeVending, makeBin, makeLockers, makeBelonging,
  makeBus, makeJukebox, makeStool, makeCoffeePot, makeCRTBank, makeDeskMic, makeToilet,
  makeVanity, makeColumn, makePlant, makeNoticeboard, makeFlashlight, makeSuitcase,
  makeLuggageCart, makeDesk, makeFilingCabinet, makeTicketMachine, makeConveyor,
} from './props.js';

// Everything that is not walls, floors and ceilings.
//
// Each room is laid out so that every object a player needs can actually be
// walked up to: the previous layout had a locker bank across the Baggage
// Claim doorway and Lost & Found racks running wall to wall, which between
// them sealed off the conductor's punch, the transfer slips and three of the
// passengers' belongings -- the game could not be finished. Positions here
// are checked by an automated reachability audit against the real colliders.

// Type for anything painted, printed or lit. The UI loads these faces; the
// canvases are redrawn once they arrive (see refs.redrawAll).
export const SIGN_FONT = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
export const MONO_FONT = '"IBM Plex Mono", "Courier New", monospace';
export const HAND_FONT = '"Caveat", "Comic Sans MS", cursive';

const COIN_RADIUS = 0.038;

export function furnish(level, game) {
  // Furniture gets bevelled edges; the walls, built before this, do not.
  level.bevel = true;
  const refs = {
    boardMeshes: [],
    panels: [],
    monitors: null,
    board: null,
    wallClock: null,
    coins: [],
    animated: [],
  };

  const mat = (o) => level.mat(o);
  // Materials that should pick up the station's reflection map. Set by
  // main.js once the environment has been baked.
  const shiny = (m, amount = 1) => {
    m.userData.env = amount;
    return m;
  };

  // ---- materials -----------------------------------------------------------

  const metal = shiny(mat({ ...surface('steel', { metalness: 0.55, roughness: 0.9 }), color: tint('steel', 0x5d6266) }), 0.6);
  const chrome = shiny(mat({ ...surface('steel', { metalness: 1.0, roughness: 0.35 }), color: tint('steel', 0xb8bcbe) }), 1.2);
  const darkMetal = mat({ color: 0x2b3135, roughness: 0.55, metalness: 0.35 });
  const blackPlastic = mat({ color: 0x141618, roughness: 0.45 });
  const woodMat = mat({ ...surface('wood'), color: tint('wood', 0x5c3d2a) });
  const laminate = shiny(mat({ ...surface('paint', { metalness: 0, roughness: 0.6 }), color: tint('paint', 0x6a675a) }), 0.25);
  const seatA = shiny(mat({ ...surface('vinyl', { roughness: 0.85 }), color: tint('vinyl', 0x4f7a6c) }), 0.3);
  const seatB = shiny(mat({ ...surface('vinyl', { roughness: 0.85 }), color: tint('vinyl', 0x93613f) }), 0.3);
  const redVinyl = shiny(mat({ ...surface('vinyl', { roughness: 0.7 }), color: tint('vinyl', 0x7a2622) }), 0.4);
  // Painted sheet steel, worn back to bare metal at the edges. `hex` is the
  // paint colour the surface should average out to.
  const paint = (hex, rough = 1) => mat({ ...surface('paint', { metalness: 0.35, roughness: rough }), color: tint('paint', hex) });
  const paperMat = mat({ color: 0xbfae8e, roughness: 0.95 });
  const porcelain = shiny(mat({ color: 0xc9cdc6, roughness: 0.22, metalness: 0 }), 0.8);
  const glass = shiny(mat({ color: 0x9fb8b4, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false }), 0.45);
  const darkGlass = shiny(mat({ color: 0x0b1012, roughness: 0.08, metalness: 0.2 }), 1.2);
  const brass = shiny(mat({ color: 0xb59a52, roughness: 0.32, metalness: 0.9, emissive: 0x1a1406 }), 1.0);

  // ---- helpers -------------------------------------------------------------

  function cyl(x, y, z, r, h, material, blocking = false, seg = 20) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material);
    m.position.set(x, y + h / 2, z);
    level.group.add(m);
    if (blocking) level.addCollider(x - r, z - r, x + r, z + r, y + h);
    return m;
  }

  // Places a modelled prop and optionally registers its footprint.
  function place(obj, x, y, z, rotY = 0, collider = null) {
    obj.position.set(x, y, z);
    obj.rotation.y = rotY;
    level.group.add(obj);
    if (collider) level.addCollider(...collider);
    return obj;
  }

  // A photo-scanned prop from props.glb (models.js), placed like anything
  // else: an empty group goes in now, at its spot, and the model fills it
  // when the file is in. `block` is its footprint, [width, depth, height]
  // before it is turned, for a collider; `fallback` builds something if the
  // file never arrives.
  function model(name, x, y, z, rotY = 0, opts = {}) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    level.group.add(g);
    if (opts.block) {
      const [w, d, h] = opts.block;
      const c = Math.abs(Math.cos(rotY));
      const sn = Math.abs(Math.sin(rotY));
      const hx = (w * c + d * sn) / 2;
      const hz = (w * sn + d * c) / 2;
      level.addCollider(x - hx, z - hz, x + hx, z + hz, y + h, y);
    }
    game.models.fill(g, name, opts);
    return g;
  }

  // A flat panel with painted content. `redraw` repaints it whenever needed.
  //   lit:      lit by the room (paint, paper) rather than glowing (screens)
  //   glow:     brightness of a glowing panel, 0..1
  //   geometry: a ready-made geometry instead of a plane (round clock faces)
  //
  // `focus(scale)` repaints it `scale` times sharper for as long as it is
  // being read up close, and `unfocus()` lets that go again. While focused,
  // `panel.focused` is true, so a page can lay out everything it says rather
  // than the gist of it. `light(s)` lifts a lit panel out of the dark, 0..1:
  // your eyes adjusting to a page held a hand's width away.
  function textPanel(x, y, z, rotY, w, h, pxW, pxH, draw, opts = {}) {
    const live = liveCanvas(pxW, pxH, { pixel: opts.pixel });
    const material = opts.lit
      ? new THREE.MeshStandardMaterial({
        map: live.texture,
        // Black until read up close. Set from the start so lifting it later
        // is a colour change, not a new shader.
        emissiveMap: live.texture,
        emissive: 0x000000,
        roughness: opts.roughness ?? 0.88,
        metalness: 0,
        transparent: !!opts.transparent,
        depthWrite: !opts.transparent,
        polygonOffset: !!opts.transparent,
        polygonOffsetFactor: -2,
      })
      : new THREE.MeshBasicMaterial({ map: live.texture, transparent: !!opts.transparent });
    if (!opts.lit && opts.glow !== undefined) material.color.setScalar(opts.glow);
    level.materials.push(material);
    const mesh = new THREE.Mesh(opts.geometry ?? new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.userData.keepUVs = true;
    (opts.parent ?? level.group).add(mesh);
    let detail = null;
    let detailScale = 1;
    const paint = (target, scale) => {
      target.ctx.save();
      target.ctx.setTransform(scale, 0, 0, scale, 0, 0);
      draw(target.ctx, pxW, pxH);
      target.ctx.restore();
      target.texture.needsUpdate = true;
    };
    const setMap = (texture) => {
      material.map = texture;
      if (material.emissiveMap) material.emissiveMap = texture;
    };
    const panel = {
      mesh,
      live,
      focused: false,
      redraw: () => {
        paint(live, 1);
        if (detail) paint(detail, detailScale);
      },
      focus: (scale = 2) => {
        if (detail) return;
        detailScale = scale;
        detail = liveCanvas(Math.round(pxW * scale), Math.round(pxH * scale), { pixel: opts.pixel });
        panel.focused = true;
        // The everyday face as well: some pages say more up close.
        panel.redraw();
        setMap(detail.texture);
      },
      unfocus: () => {
        if (!detail) return;
        setMap(live.texture);
        dropLive(detail);
        detail = null;
        panel.focused = false;
        panel.light(0);
        panel.redraw();
      },
      light: (s) => {
        if (material.emissive) material.emissive.setScalar(s * (opts.readLight ?? 0.32));
      },
    };
    panel.redraw();
    refs.panels.push(panel);
    return panel;
  }

  // Which way a panel faces, in the world.
  function faceOf(mesh) {
    mesh.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld, 2).normalize();
  }

  // Leaning in to a painted panel to read it (see inspect.js and
  // Game.inspect): sharper while you are close, and lit enough to read.
  //   view:    how the eye gets there (faceView unless given)
  //   panels:  every panel that should sharpen, if more than this one
  //   onStart: anything else that happens as you lean in
  function readTarget(panel, w, h, label, opts = {}) {
    const panels = opts.panels ?? [panel];
    return {
      label,
      view: opts.view ?? faceView(panel.mesh, w, h, opts.face),
      caption: opts.caption,
      onStart: () => {
        for (const p of panels) p.focus(opts.scale ?? 4);
        opts.onStart?.();
      },
      onEnd: () => {
        for (const p of panels) p.unfocus();
      },
      // A torch on the page does the work the dark-adapted eye would.
      update: (s) => {
        const torch = game.player?.flashlightOn && game.player.battery > 0;
        for (const p of panels) p.light(torch ? s * 0.3 : s);
      },
    };
  }

  // Every painted surface again, once the typefaces have arrived.
  refs.redrawAll = () => {
    for (const p of refs.panels) p.redraw();
  };

  // A figure in silhouette, for the CCTV feed and the mirror. Always a
  // shape, never a face: the imagination fills that in worse than we could.
  function silhouette(ctx, cx, baseY, height, opts = {}) {
    const h = height;
    const w = h * 0.24;
    ctx.save();
    ctx.fillStyle = opts.color ?? 'rgba(4,6,9,0.92)';
    ctx.beginPath();
    // Legs.
    ctx.moveTo(cx - w * 0.38, baseY);
    ctx.lineTo(cx - w * 0.3, baseY - h * 0.44);
    ctx.lineTo(cx + w * 0.3, baseY - h * 0.44);
    ctx.lineTo(cx + w * 0.38, baseY);
    ctx.lineTo(cx + w * 0.1, baseY);
    ctx.lineTo(cx, baseY - h * 0.3);
    ctx.lineTo(cx - w * 0.1, baseY);
    ctx.closePath();
    ctx.fill();
    // Coat: shoulders sloping too far, arms hanging too long.
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.36, baseY - h * 0.42);
    ctx.lineTo(cx - w * 0.52, baseY - h * 0.78);
    ctx.quadraticCurveTo(cx, baseY - h * 0.86, cx + w * 0.52, baseY - h * 0.78);
    ctx.lineTo(cx + w * 0.36, baseY - h * 0.42);
    ctx.closePath();
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * w * 0.5, baseY - h * 0.78);
      ctx.lineTo(cx + s * w * 0.66, baseY - h * 0.5);
      ctx.lineTo(cx + s * w * 0.6, baseY - h * 0.36);
      ctx.lineTo(cx + s * w * 0.46, baseY - h * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    // Head, tilted off true if asked.
    ctx.translate(cx, baseY - h * 0.84);
    ctx.rotate(opts.tilt ?? 0);
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.07, w * 0.27, h * 0.085, 0, 0, Math.PI * 2);
    ctx.fill();
    // A transit cap: a flat crown and a short peak.
    if (opts.cap) {
      ctx.fillRect(-w * 0.31, -h * 0.17, w * 0.62, h * 0.06);
      ctx.beginPath();
      ctx.ellipse(w * 0.12, -h * 0.112, w * 0.3, h * 0.014, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (opts.eyes) {
      ctx.fillStyle = opts.eyeColor ?? 'rgba(220,240,230,0.9)';
      const ey = -h * 0.08;
      const r = Math.max(1, h * 0.012);
      ctx.beginPath();
      ctx.arc(-w * 0.1, ey, r, 0, Math.PI * 2);
      ctx.arc(w * 0.1, ey + r * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  refs.silhouette = silhouette;

  function wrapLines(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Fine noise and grime laid over a painted surface.
  function grime(ctx, w, h, amount = 0.05, seed = 1) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < w * h * 0.004; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rnd() * amount})`;
      const r = 1 + rnd() * 3;
      ctx.fillRect(rnd() * w, rnd() * h, r, r);
    }
  }

  // ---- paper ---------------------------------------------------------------

  const SERIF_FONT = 'Georgia, "Times New Roman", serif';

  // A page's lines as paragraphs to lay out (see DOCUMENTS): printed lines
  // and handwritten additions, with null for a blank line. What you notice
  // about the page, rather than what is on it, is left out.
  function pageParas(lines) {
    const out = [];
    for (const l of lines ?? []) {
      if (l && typeof l === 'object') {
        if (l.hand) out.push({ text: l.hand, hand: true, color: l.color });
        continue;
      }
      out.push(l ? { text: l } : null);
    }
    return out;
  }

  // ...and that, as one caption.
  function pageSays(lines) {
    return (lines ?? []).filter((l) => l?.say).map((l) => l.say).join(' ');
  }

  // Lays out paragraphs at the largest size, up to `size`, at which they fit
  // the box: up close, nothing on a page is cut off. A line that fits is kept
  // exactly as written, spacing and all; a blank line is half a line.
  function fitText(ctx, paras, maxW, maxH, font, size, minSize, leading = 1.3) {
    for (let s = size; ; s = Math.max(minSize, s * 0.94)) {
      const rows = [];
      let height = 0;
      for (const p of paras) {
        if (!p) {
          rows.push(null);
          height += s * leading * 0.5;
          continue;
        }
        ctx.font = font(s, p);
        const fits = ctx.measureText(p.text).width <= maxW;
        for (const text of fits ? [p.text] : wrapLines(ctx, p.text, maxW)) {
          rows.push({ text, p });
          height += s * leading * (p.hand ? 1.15 : 1);
        }
      }
      if (height <= maxH || s <= minSize) return { rows, size: s, lh: s * leading };
    }
  }

  function drawRows(ctx, fit, x, y, font, color) {
    for (const r of fit.rows) {
      if (!r) {
        y += fit.lh * 0.5;
        continue;
      }
      ctx.font = font(fit.size, r.p);
      ctx.fillStyle = r.p.hand ? (r.p.color ?? 'rgba(36,40,64,0.9)') : color;
      ctx.fillText(r.text, x, y + fit.size * (r.p.hand ? 1.1 : 1));
      y += fit.lh * (r.p.hand ? 1.15 : 1);
    }
    return y;
  }

  // The photograph in the newspaper clipping: Bay 9 at night, under a flash.
  // It is not the same photograph every night.
  function drawPhoto(ctx, x, y, pw, ph, loop = 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, pw, ph);
    ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + ph);
    g.addColorStop(0, '#6b665a');
    g.addColorStop(0.55, '#57534a');
    g.addColorStop(1, '#2c2a26');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, pw, ph);
    // The canopy, and the doors in the back wall.
    ctx.fillStyle = '#2a2824';
    ctx.fillRect(x, y, pw, ph * 0.15);
    ctx.fillStyle = 'rgba(30,29,26,0.55)';
    for (const dx of [0.3, 0.46]) ctx.fillRect(x + pw * dx, y + ph * 0.24, pw * 0.13, ph * 0.44);
    // The bay number.
    ctx.fillStyle = '#1c1b18';
    ctx.fillRect(x + pw * 0.07, y + ph * 0.21, pw * 0.13, ph * 0.17);
    ctx.fillStyle = '#cfc9b6';
    ctx.font = `700 ${ph * 0.14}px ${SIGN_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('9', x + pw * 0.135, y + ph * 0.3);
    // A platform lamp, blown out by the flash.
    ctx.fillStyle = '#23211e';
    ctx.fillRect(x + pw * 0.74, y + ph * 0.15, pw * 0.014, ph * 0.56);
    const lamp = ctx.createRadialGradient(x + pw * 0.747, y + ph * 0.19, 0, x + pw * 0.747, y + ph * 0.19, ph * 0.2);
    lamp.addColorStop(0, 'rgba(255,250,232,0.75)');
    lamp.addColorStop(1, 'rgba(255,250,232,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(x + pw * 0.55, y, pw * 0.4, ph * 0.4);
    // The platform, and its painted edge falling away to the roadway.
    ctx.fillStyle = '#3b3833';
    ctx.beginPath();
    ctx.moveTo(x, y + ph);
    ctx.lineTo(x, y + ph * 0.73);
    ctx.lineTo(x + pw, y + ph * 0.67);
    ctx.lineTo(x + pw, y + ph);
    ctx.fill();
    ctx.fillStyle = '#8e8873';
    ctx.beginPath();
    ctx.moveTo(x, y + ph * 0.73);
    ctx.lineTo(x + pw, y + ph * 0.67);
    ctx.lineTo(x + pw, y + ph * 0.695);
    ctx.lineTo(x, y + ph * 0.76);
    ctx.fill();
    const ink = 'rgba(14,13,11,0.92)';
    if (loop >= 4) {
      // A bench against the wall, and someone sitting on it.
      const bx = x + pw * 0.36;
      const by = y + ph * 0.66;
      const bw = pw * 0.34;
      ctx.fillStyle = '#26241f';
      ctx.fillRect(bx, by - ph * 0.2, bw, ph * 0.05);
      ctx.fillRect(bx, by, bw, ph * 0.04);
      ctx.fillRect(bx + bw * 0.06, by, pw * 0.012, ph * 0.12);
      ctx.fillRect(bx + bw * 0.9, by, pw * 0.012, ph * 0.12);
      const px = bx + bw * 0.58;
      const u = ph * 0.01;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(px, by - u * 33, u * 4.6, u * 5.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px - u * 9, by + u * 1);
      ctx.lineTo(px - u * 8.5, by - u * 22);
      ctx.quadraticCurveTo(px, by - u * 28, px + u * 8.5, by - u * 22);
      ctx.lineTo(px + u * 9, by + u * 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(px - u * 8, by + u * 1, u * 6, u * 15);
      ctx.fillRect(px + u * 2, by + u * 1, u * 6, u * 15);
    } else if (loop === 3) {
      silhouette(ctx, x + pw * 0.58, y + ph * 1.02, ph * 0.86, { color: ink, cap: true, eyes: true, eyeColor: 'rgba(220,226,214,0.55)' });
    } else if (loop === 2) {
      silhouette(ctx, x + pw * 0.88, y + ph * 0.72, ph * 0.5, { color: ink, cap: true, tilt: -0.08 });
    }
    // Newsprint: the whole picture is dots.
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    const step = Math.max(pw / 70, 1);
    for (let yy = y; yy < y + ph; yy += step) {
      for (let xx = x + ((yy / step) % 2) * step * 0.5; xx < x + pw; xx += step) ctx.fillRect(xx, yy, step * 0.42, step * 0.42);
    }
    ctx.restore();
  }

  // The face of a document, so a page on a desk reads as the thing it is
  // from a couple of metres away: a newspaper has a masthead and a photo, a
  // log is ruled and typed, a note is pencil. Read up close (`spec.full`) it
  // is the whole page, every word of it, sized to fit.
  function drawPage(ctx, w, h, spec) {
    const style = spec.style ?? 'typed';
    const base = style === 'news' ? '#cbc3ac' : style === 'note' ? '#d9d2b8' : '#d8d0b6';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Age: a darker edge and a foxing blotch or two.
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(70,50,20,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    grime(ctx, w, h, 0.06, (spec.seed ?? 3) + w);
    const m = w * 0.08;
    const ink = '#2b2620';
    const paras = pageParas(spec.lines);
    if (style === 'news') {
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(w * 0.085)}px ${SIGN_FONT}`;
      ctx.fillText('GRAYHOLLOW SENTINEL', w / 2, m + w * 0.07);
      ctx.fillRect(m, m + w * 0.1, w - m * 2, 2);
      if (spec.full) {
        ctx.font = `600 ${w * 0.026}px ${SIGN_FONT}`;
        ctx.fillText('THURSDAY, NOVEMBER 5, 1987   ·   FINAL EDITION   ·   25¢', w / 2, m + w * 0.135);
        ctx.fillRect(m, m + w * 0.148, w - m * 2, w * 0.003);
        const head = fitText(ctx, [{ text: spec.title ?? '' }], w - m * 2, w * 0.2, (s) => `700 ${s}px ${SIGN_FONT}`, w * 0.075, w * 0.05, 1.05);
        let y = m + w * 0.16;
        ctx.font = `700 ${head.size}px ${SIGN_FONT}`;
        for (const r of head.rows) {
          ctx.fillText(r.text, w / 2, y + head.size);
          y += head.lh;
        }
        y += w * 0.02;
        const pw = w - m * 2;
        const ph = pw * 0.5;
        drawPhoto(ctx, m, y, pw, ph, spec.loop);
        y += ph + w * 0.008;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(40,36,30,0.85)';
        ctx.font = `italic ${w * 0.024}px ${SERIF_FONT}`;
        ctx.fillText('Bay 9, Grayhollow Transit Center.', m, y + w * 0.026);
        y += w * 0.05;
        // The story, in two columns.
        const gap = w * 0.04;
        const cw = (w - m * 2 - gap) / 2;
        const bottom = h - m * 0.8;
        const body = [];
        for (const p of paras) {
          if (!p) continue;
          if (body.length) body.push(null);
          body.push(p);
        }
        const fit = fitText(ctx, body, cw, (bottom - y) * 2 * 0.92, (s) => `${s}px ${SERIF_FONT}`, w * 0.032, w * 0.016, 1.3);
        let x = m;
        let yy = y;
        ctx.fillStyle = 'rgba(24,22,18,0.95)';
        ctx.font = `${fit.size}px ${SERIF_FONT}`;
        for (const r of fit.rows) {
          const step = r ? fit.lh : fit.lh * 0.5;
          if (yy + step > bottom) {
            if (x !== m) break;
            x = m + cw + gap;
            yy = y;
            if (!r) continue;
          }
          if (r) ctx.fillText(r.text, x, yy + fit.size);
          yy += step;
        }
        return;
      }
      ctx.font = `700 ${Math.round(w * 0.07)}px ${SIGN_FONT}`;
      const head = wrapLines(ctx, spec.title ?? '', w - m * 2);
      head.forEach((l, i) => ctx.fillText(l, w / 2, m + w * 0.2 + i * w * 0.075));
      const top = m + w * 0.24 + head.length * w * 0.075;
      drawPhoto(ctx, m, top, w * 0.48, w * 0.36, spec.loop);
      // Columns of grey type.
      ctx.fillStyle = 'rgba(40,36,30,0.55)';
      for (let col = 0; col < 2; col++) {
        const x0 = col === 0 ? m + w * 0.52 : m;
        const y0 = col === 0 ? top : top + w * 0.4;
        const cw = col === 0 ? w - m * 2 - w * 0.52 : w - m * 2;
        for (let y = y0; y < h - m; y += w * 0.03) ctx.fillRect(x0, y, cw * (0.8 + ((y * 7) % 20) / 100), w * 0.012);
      }
      return;
    }
    if (style === 'note') {
      const color = 'rgba(40,40,46,0.88)';
      if (spec.full) {
        const font = (s) => `600 ${s}px ${HAND_FONT}`;
        const fit = fitText(ctx, paras, w - m * 2, h - m * 2, font, w * 0.075, w * 0.028, 1.12);
        drawRows(ctx, fit, m, m, font, color);
        return;
      }
      ctx.fillStyle = color;
      ctx.font = `600 ${Math.round(w * 0.075)}px ${HAND_FONT}`;
      let y = m + w * 0.06;
      for (const p of paras) {
        if (!p) continue;
        for (const l of wrapLines(ctx, p.text, w - m * 2)) {
          ctx.fillText(l, m, y);
          y += w * 0.08;
        }
      }
      return;
    }
    // Typed: a heading and ruled lines of type.
    ctx.fillStyle = ink;
    if (spec.full) {
      const titleFont = (s) => `600 ${s}px ${MONO_FONT}`;
      const title = fitText(ctx, [{ text: (spec.title ?? '').toUpperCase() }], w - m * 2, w * 0.16, titleFont, w * 0.05, w * 0.03, 1.2);
      let y = drawRows(ctx, title, m, m, titleFont, ink);
      y += w * 0.012;
      ctx.fillStyle = ink;
      ctx.fillRect(m, y, w - m * 2, w * 0.005);
      y += w * 0.03;
      const font = (s, p) => (p?.hand ? `600 ${s * 1.3}px ${HAND_FONT}` : `${s}px ${MONO_FONT}`);
      let size = w * 0.036;
      // A table is kept a table: smaller type before any row wraps.
      if (spec.table) {
        ctx.font = font(size);
        let widest = 0;
        for (const p of paras) if (p && !p.hand) widest = Math.max(widest, ctx.measureText(p.text).width);
        if (widest > w - m * 2) size *= (w - m * 2) / widest;
      }
      const body = fitText(ctx, paras, w - m * 2, h - m - y, font, size, w * 0.016, 1.32);
      drawRows(ctx, body, m, y, font, 'rgba(24,22,18,0.94)');
      return;
    }
    ctx.font = `600 ${Math.round(w * 0.055)}px ${MONO_FONT}`;
    for (const [i, l] of wrapLines(ctx, (spec.title ?? '').toUpperCase(), w - m * 2).entries()) {
      ctx.fillText(l, m, m + w * 0.06 + i * w * 0.06);
    }
    ctx.fillRect(m, m + w * 0.1, w - m * 2, 1.5);
    ctx.font = `${Math.round(w * 0.034)}px ${MONO_FONT}`;
    let y = m + w * 0.17;
    for (const p of paras) {
      if (!p) continue;
      ctx.fillStyle = p.hand ? (p.color ?? 'rgba(36,40,64,0.9)') : 'rgba(30,28,24,0.82)';
      for (const l of wrapLines(ctx, p.text, w - m * 2)) {
        if (y > h - m) return;
        ctx.fillText(l, m, y);
        y += w * 0.045;
      }
    }
  }

  // The written side of a postcard: the message on the left, who it is for
  // on the right, and an empty square where the stamp should be.
  function drawPostcard(ctx, w, h, card, color, seed) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    grime(ctx, w, h, 0.05, seed + 11);
    const faint = 'rgba(70,58,44,0.55)';
    ctx.fillStyle = faint;
    ctx.fillRect(w * 0.56, h * 0.1, w * 0.004, h * 0.8);
    ctx.strokeStyle = faint;
    ctx.lineWidth = w * 0.004;
    ctx.setLineDash([w * 0.012, w * 0.008]);
    ctx.strokeRect(w * 0.8, h * 0.09, w * 0.14, h * 0.28);
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.font = `600 ${w * 0.026}px ${SIGN_FONT}`;
    ctx.fillText('PLACE', w * 0.87, h * 0.21);
    ctx.fillText('STAMP', w * 0.87, h * 0.28);
    ctx.fillText('POST CARD', w * 0.68, h * 0.17);
    for (let k = 0; k < 3; k++) ctx.fillRect(w * 0.6, h * (0.6 + k * 0.12), w * 0.35, w * 0.003);
    ctx.textAlign = 'left';
    const pen = 'rgba(26,30,58,0.9)';
    const font = (s) => `600 ${s}px ${HAND_FONT}`;
    ctx.fillStyle = pen;
    ctx.font = font(w * 0.055);
    ctx.fillText(card.to, w * 0.61, h * 0.58);
    const fit = fitText(ctx, [{ text: card.text }], w * 0.47, h * 0.8, font, w * 0.07, w * 0.03, 1.12);
    drawRows(ctx, fit, w * 0.05, h * 0.1, font, pen);
  }

  // A document lying on or pinned to something. Reading it is leaning in to
  // it, the way the monitors are watched (see inspect.js).
  function paper(id, x, y, z, rotY, docKey, opts = {}) {
    const w = opts.w ?? 0.5;
    const h = opts.h ?? 0.36;
    const doc = DOCUMENTS[docKey];
    const pxW = 256;
    const pxH = Math.round((pxW * h) / w);
    const loop = () => game.state?.persistent.loop ?? 1;
    const lines = () => doc.lines(loop(), game.playerName) ?? [];
    let panel = null;
    panel = textPanel(x, y, z, rotY, w, h, pxW, pxH, (ctx, cw, ch) => drawPage(ctx, cw, ch, {
      style: opts.style ?? 'typed',
      title: doc.headline ?? doc.title,
      lines: lines(),
      loop: loop(),
      table: opts.table,
      seed: id.length,
      full: !!panel?.focused,
    }), { lit: true, roughness: 0.92 });
    if (opts.flat) {
      panel.mesh.rotation.set(-Math.PI / 2, 0, rotY);
    }
    const target = readTarget(panel, w, h, doc.title, { caption: () => pageSays(lines()) });
    return level.addInteractable({
      id,
      position: new THREE.Vector3(x, y, z),
      facing: faceOf(panel.mesh),
      radius: opts.radius ?? 2.2,
      prompt: () => opts.prompt ?? 'Read',
      use: () => {
        game.audio.paper();
        game.inspect(target);
        opts.onRead?.();
      },
    });
  }

  // A 1987 coin. Lying flat, as coins do, and a touch brighter than brass has
  // any right to be so a player sweeping a torch across a floor catches it.
  function coin(id, x, y, z, hint) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.006, 18), brass);
    mesh.position.set(x, y + 0.003, z);
    mesh.rotation.y = (x * 13.7 + z * 7.1) % Math.PI;
    level.group.add(mesh);
    const it = level.addInteractable({
      id,
      position: new THREE.Vector3(x, y + 0.02, z),
      radius: 1.9,
      prompt: () => 'Take coin (1987)',
      use: () => {
        game.state.run.coins++;
        mesh.visible = false;
        it.enabled = false;
        game.audio.coinDrop();
        game.toast(`1987 coin (${game.state.run.coins})`);
        game.note('Coins', hint);
      },
      onReset: () => {
        mesh.visible = true;
        it.enabled = true;
      },
    });
    refs.coins.push(it);
    return it;
  }

  // Spare cells for the torch. Deliberately placed one per far corner rather
  // than stocked anywhere convenient: the walk to the next pack is the real
  // price of having run the torch flat, and three of the four sit in rooms you
  // need something else to reach.
  const cellMats = {
    card: mat({ color: 0x8a2a1e, roughness: 0.7 }),
    cell: shiny(mat({ color: 0x3a3a34, roughness: 0.35, metalness: 0.6 }), 0.6),
    top: chrome,
  };
  function cellPack(id, x, y, z, hint, rotY = 0) {
    const b = new Build();
    b.box(0.16, 0.11, 0.012, { y: 0.055 }, 'card');
    for (const s of [-1, 1]) {
      b.cyl(0.017, 0.017, 0.06, 12, { x: s * 0.03, y: 0.045, z: 0.02 }, 'cell');
      b.cyl(0.008, 0.008, 0.008, 8, { x: s * 0.03, y: 0.079, z: 0.02 }, 'top');
    }
    // Lying on its back.
    const group = b.build(cellMats);
    group.rotation.x = -Math.PI / 2 + 0.0;
    const holder = new THREE.Group();
    holder.add(group);
    group.position.y = 0.006;
    place(holder, x, y, z, rotY);
    const it = level.addInteractable({
      id,
      position: new THREE.Vector3(x, y + 0.05, z),
      radius: 1.9,
      prompt: () => 'Take spare cells',
      use: () => {
        game.state.run.cells++;
        holder.visible = false;
        it.enabled = false;
        game.audio.paper();
        game.toast(`Spare cells (${game.state.run.cells})`);
        game.note('Items', hint);
        game.note('Items', `${game.touch ? 'Tap' : 'Press'} ${game.key('B')} to put a fresh cell in the torch.`);
      },
      onReset: () => {
        holder.visible = true;
        it.enabled = true;
      },
    });
    return it;
  }

  // A backlit wayfinding sign over a doorway.
  function doorSign(x, y, z, rotY, text, icon, w = 1.9) {
    const h = 0.34;
    const pxW = 512;
    const pxH = Math.round((pxW * h) / w);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.08), blackPlastic);
    const back = new THREE.Vector3(0, 0, -0.045).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    housing.position.set(x + back.x, y, z + back.z);
    housing.rotation.y = rotY;
    level.group.add(housing);
    return textPanel(x, y, z, rotY, w, h, pxW, pxH, (ctx, cw, ch) => {
      ctx.fillStyle = '#101314';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#e8e4d6';
      ctx.font = `600 ${Math.round(ch * 0.58)}px ${SIGN_FONT}`;
      ctx.textBaseline = 'middle';
      const iconW = icon ? ch : 0;
      if (icon) drawIcon(ctx, icon, ch * 0.5, ch * 0.5, ch * 0.62);
      ctx.fillText(text, iconW + ch * 0.18, ch * 0.54);
    }, { glow: 0.82 });
  }

  // Simple transit pictograms, drawn rather than shipped.
  function drawIcon(ctx, kind, cx, cy, s) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#e8e4d6';
    ctx.strokeStyle = '#e8e4d6';
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    const r = s / 2;
    if (kind === 'arrowUp' || kind === 'arrowLeft' || kind === 'arrowRight') {
      ctx.rotate(kind === 'arrowLeft' ? -Math.PI / 2 : kind === 'arrowRight' ? Math.PI / 2 : 0);
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.8, 0);
      ctx.lineTo(r * 0.3, 0);
      ctx.lineTo(r * 0.3, r);
      ctx.lineTo(-r * 0.3, r);
      ctx.lineTo(-r * 0.3, 0);
      ctx.lineTo(-r * 0.8, 0);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'ticket') {
      ctx.strokeRect(-r, -r * 0.55, r * 2, r * 1.1);
      ctx.setLineDash([s * 0.08, s * 0.08]);
      ctx.beginPath();
      ctx.moveTo(r * 0.35, -r * 0.55);
      ctx.lineTo(r * 0.35, r * 0.55);
      ctx.stroke();
    } else if (kind === 'question') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `700 ${Math.round(s * 0.8)}px ${SIGN_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, s * 0.04);
    } else if (kind === 'camera') {
      ctx.fillRect(-r, -r * 0.4, r * 1.3, r * 0.8);
      ctx.beginPath();
      ctx.moveTo(r * 0.3, -r * 0.25);
      ctx.lineTo(r, -r * 0.55);
      ctx.lineTo(r, r * 0.55);
      ctx.lineTo(r * 0.3, r * 0.25);
      ctx.fill();
    } else if (kind === 'cup') {
      ctx.fillRect(-r * 0.7, -r * 0.4, r * 1.1, r * 1.0);
      ctx.beginPath();
      ctx.arc(r * 0.5, r * 0.1, r * 0.3, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fillRect(-r * 0.9, r * 0.7, r * 1.6, r * 0.12);
    } else if (kind === 'wc') {
      for (const sx of [-0.45, 0.45]) {
        ctx.beginPath();
        ctx.arc(sx * r, -r * 0.7, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(-r * 0.62, -r * 0.45, r * 0.34, r * 1.35);
      ctx.beginPath();
      ctx.moveTo(r * 0.45, -r * 0.45);
      ctx.lineTo(r * 0.75, r * 0.45);
      ctx.lineTo(r * 0.15, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(r * 0.3, r * 0.4, r * 0.3, r * 0.5);
    } else if (kind === 'case') {
      ctx.fillRect(-r * 0.9, -r * 0.4, r * 1.8, r * 1.2);
      ctx.strokeRect(-r * 0.35, -r * 0.8, r * 0.7, r * 0.42);
    } else if (kind === 'bus') {
      ctx.fillRect(-r, -r * 0.8, r * 2, r * 1.35);
      ctx.fillStyle = '#101314';
      ctx.fillRect(-r * 0.8, -r * 0.6, r * 1.6, r * 0.5);
      ctx.fillStyle = '#e8e4d6';
      for (const sx of [-0.55, 0.55]) {
        ctx.beginPath();
        ctx.arc(sx * r, r * 0.6, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---- Main Waiting Hall -------------------------------------------------

  (function hall() {
    const r = ROOMS.hall;

    // Bench rows. You can crouch under them to hide.
    const benchRows = [
      { z: 5.5, flip: false },
      { z: 2.0, flip: true },
      { z: -1.5, flip: false },
    ];
    for (const [i, row] of benchRows.entries()) {
      for (const bx of [-6.5, 0, 6.5]) {
        const seatMat = (i + (bx > 0 ? 1 : 0)) % 2 === 0 ? seatA : seatB;
        // Modelled rather than boxed. The gaps between the slats are what let
        // the flashlight throw stripes on the floor behind a bench, and they
        // are most of the reason you can tell at a glance that the shape in the
        // next row is furniture and not a person sitting down.
        const bench = makeBench(4.6, { wood: seatMat, metal: darkMetal });
        place(bench, bx, 0, row.z, row.flip ? Math.PI : 0);
        // The seat is steppable so it does not block movement outright, and
        // the player hides underneath.
        level.addCollider(bx - 2.3, row.z - 0.35, bx + 2.3, row.z + 0.35, 0.56);
        level.addHideSpot({
          id: `hide_bench_${i}_${bx}`,
          name: 'under the bench',
          position: new THREE.Vector3(bx, 0, row.z),
          exit: new THREE.Vector3(bx, 0, row.z + (row.flip ? -1.4 : 1.4)),
          lookYaw: row.flip ? Math.PI : 0,
          // Lying under the seat, halfway between two of its frames.
          view: { eye: 0.27, x: 1.09 },
          quality: 0.75,
          promptName: 'Hide under bench',
        });
      }
    }

    // Under the seat you wake on: the sleepers before you, cut into the
    // wood, and lately someone in your own hand.
    level.addInteractable({
      id: 'int_benchscratch',
      position: new THREE.Vector3(-1.3, 0.3, 5.45),
      radius: 1.7,
      prompt: () => 'Look under the bench',
      use: () => {
        const lines = DOCUMENTS.bench.lines(game.state.persistent.loop);
        const text = lines.filter((l) => !l?.say).map((l) => (typeof l === 'string' ? l : l.hand));
        const says = lines.filter((l) => l?.say).map((l) => l.say);
        game.audio.scrape?.(null, 0.4);
        game.showDocument(DOCUMENTS.bench.title, text, null, { style: 'paper' });
        if (says.length) game.subtitle(says.join(' '), 7);
        game.note('Station', game.state.persistent.loop >= 2
          ? 'Sleepers before you scratched their marks under the bench you wake on. The newest are in your own hand.'
          : 'Sleepers before you scratched their marks under the bench you wake on.');
      },
    });

    // Four round columns holding the roof up.
    const columnMats = {
      shaft: mat({ ...surface('paint', { metalness: 0, roughness: 0.95 }), color: tint('paint', 0x8c8774) }),
      base: mat({ color: 0x23272a, roughness: 0.5, metalness: 0.2 }),
    };
    for (const cx of [-7.5, 7.5]) {
      for (const cz of [-7, 7]) {
        place(makeColumn(0.42, r.h, columnMats), cx, 0, cz, 0, [cx - 0.5, cz - 0.5, cx + 0.5, cz + 0.5, r.h]);
      }
    }

    // ---- The departure board: a split-flap board in a steel housing, hung
    // from the ceiling in front of the gate the way station boards are, so
    // its rows are big enough to read from the benches. Eight services and the
    // station clock.
    const boardW = 7.0;
    const boardH = 1.94;
    const boardY = 3.32;
    const boardZ = -8.735;
    level.box(0, -8.9, boardW + 0.3, 0.3, boardH + 0.12, boardY - boardH / 2 - 0.06, darkMetal, { ghost: true });
    // Hangers to the ceiling.
    for (const hx of [-3.0, 3.0]) cyl(hx, boardY + boardH / 2 + 0.06, -8.9, 0.025, r.h - boardY - boardH / 2 - 0.06, chrome, false, 8);
    const FLAP_W = 36;
    const FLAP_H = 27;
    const drawFlaps = (ctx, text, x, y, n, color) => {
      const s = String(text).toUpperCase().padEnd(n, ' ').slice(0, n);
      for (let i = 0; i < n; i++) {
        const fx = x + i * (FLAP_W + 2);
        ctx.fillStyle = '#16191a';
        ctx.fillRect(fx, y, FLAP_W, FLAP_H);
        ctx.fillStyle = '#0d0f10';
        ctx.fillRect(fx, y + FLAP_H / 2, FLAP_W, FLAP_H / 2);
        if (s[i] !== ' ') {
          ctx.fillStyle = color;
          ctx.fillText(s[i], fx + FLAP_W / 2, y + FLAP_H / 2 + 1);
        }
        // The split across the middle of every flap.
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(fx, y + FLAP_H / 2 - 0.5, FLAP_W, 1.2);
      }
    };
    refs.board = textPanel(0, boardY, boardZ, 0, boardW, boardH, 1024, 284, (ctx, w, h) => {
      ctx.fillStyle = '#07090a';
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `700 22px ${SIGN_FONT}`;
      ctx.fillStyle = '#e8c860';
      ctx.fillText('DEPARTURES', 12, 15);
      ctx.fillStyle = '#9a9a8c';
      ctx.font = `600 16px ${SIGN_FONT}`;
      ctx.fillText('BAY', 560, 16);
      ctx.fillText('STATUS', 612, 16);
      // The board's own clock, which keeps the same time as everything else.
      const minutes = game.clock ? game.clock.time : 1427;
      const hh = Math.floor(minutes / 60) % 12 || 12;
      const mm = String(Math.floor(minutes) % 60).padStart(2, '0');
      ctx.fillText('NOW', 812, 16);
      ctx.save();
      ctx.font = `700 20px ${SIGN_FONT}`;
      ctx.textAlign = 'center';
      const cw = 22;
      const s = `${String(hh).padStart(2, ' ')}:${mm}`;
      for (let i = 0; i < 5; i++) {
        const fx = w - 12 - (5 - i) * (cw + 2);
        ctx.fillStyle = '#16191a';
        ctx.fillRect(fx, 2, cw, 26);
        ctx.fillStyle = '#e8e4d6';
        if (s[i] !== ' ') ctx.fillText(s[i], fx + cw / 2, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(fx, 14.5, cw, 1.2);
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(232,200,96,0.35)';
      ctx.fillRect(10, 30, w - 20, 1);

      ctx.font = `700 26px ${SIGN_FONT}`;
      ctx.textAlign = 'center';
      const rows = game.boardRows ?? BOARD_ROUTES;
      let y = 33;
      for (const row of rows.slice(0, 8)) {
        const cancelled = row.status === 'CANCELLED';
        const boarding = row.status === 'BOARDING';
        const timed = /\d:\d\d/.test(row.status);
        const color = cancelled ? '#e0654a' : boarding || timed ? '#7dffb8' : row.status === 'DEPARTED' ? '#8f9a90' : '#e8c860';
        drawFlaps(ctx, row.dest, 12, y, 14, '#e8e4d6');
        drawFlaps(ctx, String(row.bay), 560, y, 1, '#e8e4d6');
        drawFlaps(ctx, row.status, 612, y, 9, color);
        y += FLAP_H + 2;
      }
      // The spelled code only surfaces once you have stared long enough.
      ctx.textAlign = 'left';
      ctx.font = `600 15px ${SIGN_FONT}`;
      if (game.boardRevealed) {
        ctx.fillStyle = '#7dffb8';
        ctx.fillText('CANCELLED INITIALS: ' + LOCKER_CODE, 12, h - 8);
      } else {
        ctx.fillStyle = '#5c625c';
        ctx.fillText('PLEASE STAND CLEAR OF THE BAY DOORS UNTIL YOUR SERVICE IS CALLED', 12, h - 8);
      }
    }, { glow: 0.9 });
    refs.boardMeshes.push(refs.board.mesh);
    game.boardMesh = refs.board.mesh;

    // Studying it is staring up at it from where you stand until it fills
    // the view. Stare long enough and the pattern surfaces on the board
    // itself (Game.updateBoardStare).
    const boardTarget = readTarget(refs.board, boardW, boardH, 'Departure Board', {
      scale: 2,
      view: zoomView(refs.board.mesh, boardW, boardH, {
        minDist: 4.5,
        maxSide: 1.0,
        clear: (a, b) => !segmentBlocked(level.colliders, a.x, a.z, b.x, b.z),
      }),
      // The code comes from the board's real timetable. If something has
      // got into the board and made every row read the same, there is
      // nothing to read off it.
      caption: () => (game.presence?.boardWrong
        ? 'Every row says the same thing. Every bay says 9.'
        : game.boardStare > 10
          ? `The cancelled destinations begin: ${game.lockerInitials()}`
          : 'Split-flap, half the slats stuck. You would have to watch it cycle for a while to see a pattern.'),
    });
    level.addInteractable({
      id: 'int_departureboard',
      position: new THREE.Vector3(0, boardY - 0.5, boardZ),
      radius: 6.5,
      prompt: () => 'Study the departure board',
      use: () => {
        game.audio.splitFlap(10);
        if (game.boardStare > 10 && !game.presence?.boardWrong) game.learnLockerCode(game.lockerInitials());
        game.inspect(boardTarget);
      },
    });

    // The station clock, over the ticket side of the gate. Round, with a
    // bezel, so it reads as a clock and not as a square of paper.
    const clockR = 0.55;
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(clockR + 0.05, clockR + 0.05, 0.08, 48), blackPlastic);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(-8.5, 3.25, -9.66);
    level.group.add(bezel);
    refs.wallClock = textPanel(-8.5, 3.25, -9.615, 0, 0, 0, 256, 256, (ctx, w, h) => {
      const c = w / 2;
      ctx.fillStyle = '#d9d4c2';
      ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(c, c, 20, c, c, c);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(60,50,30,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#16181a';
      // Bars, not numerals: a railway clock.
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const long = i % 5 === 0;
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(a);
        ctx.fillRect(long ? -4 : -1.5, -c + 10, long ? 8 : 3, long ? 30 : 10);
        ctx.restore();
      }
      const minutes = game.clock ? game.clock.time : 1427;
      const hourAngle = ((minutes / 60) % 12) * (Math.PI * 2 / 12);
      const minAngle = (minutes % 60) * (Math.PI * 2 / 60);
      const hand = (angle, len, width, tail) => {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(angle);
        ctx.fillRect(-width / 2, -len, width, len + tail);
        ctx.restore();
      };
      hand(hourAngle, c * 0.55, 13, 22);
      hand(minAngle, c * 0.82, 9, 26);
      ctx.beginPath();
      ctx.arc(c, c, 8, 0, Math.PI * 2);
      ctx.fill();
    }, { geometry: new THREE.CircleGeometry(clockR, 48), glow: 0.95, lit: true, roughness: 0.4 });

    // Rules sign on the west wall, between the two doorways: enamelled steel
    // in a frame, screwed to the panelling rather than sunk inside it.
    const signW = 2.0;
    const signH = 2.5;
    level.box(-10.66, -1.0, 0.05, signW + 0.12, signH + 0.12, 1.9 - signH / 2 - 0.06, darkMetal, { ghost: true });
    refs.rulesSign = textPanel(-10.63, 1.9, -1.0, Math.PI / 2, signW, signH, 512, 640, (ctx, w, h) => {
      ctx.fillStyle = '#d6cdb2';
      ctx.fillRect(0, 0, w, h);
      grime(ctx, w, h, 0.07, 7);
      ctx.fillStyle = '#1d2a33';
      ctx.fillRect(0, 0, w, 86);
      ctx.fillStyle = '#e9e3cf';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 48px ${SIGN_FONT}`;
      ctx.fillText('STATION RULES', w / 2, 46);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `500 30px ${SIGN_FONT}`;
      let y = 140;
      const rows = game.ruleSignRows ?? [];
      for (const row of rows) {
        ctx.fillStyle = '#1e211f';
        const lines = wrapLines(ctx, row.text, w - 96);
        ctx.font = `700 30px ${SIGN_FONT}`;
        ctx.fillText(`${row.index}.`, 30, y);
        ctx.font = `500 30px ${SIGN_FONT}`;
        const top = y;
        for (const l of lines) {
          ctx.fillText(l, 72, y);
          y += 34;
        }
        if (row.known) {
          // Struck through in red pencil, by you.
          ctx.strokeStyle = 'rgba(170,30,24,0.9)';
          ctx.lineWidth = 4;
          for (let i = 0; i < lines.length; i++) {
            const ly = top - 10 + i * 34;
            ctx.beginPath();
            ctx.moveTo(66, ly + 2);
            ctx.lineTo(70 + ctx.measureText(lines[i]).width + 8, ly - 3);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(170,30,24,0.95)';
          ctx.font = `600 34px ${HAND_FONT}`;
          ctx.fillText('lie', w - 72, top + 4);
          ctx.font = `500 30px ${SIGN_FONT}`;
        }
        y += 18;
      }
      ctx.fillStyle = '#5a5244';
      ctx.font = `500 20px ${SIGN_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('GRAYHOLLOW TRANSIT AUTHORITY  ·  BY ORDER', w / 2, h - 24);
      // A rule of your own, in marker, across the bottom (the night shift).
      if (game.signScrawl) {
        ctx.save();
        ctx.translate(w / 2, h - 66);
        ctx.rotate(-0.07);
        ctx.fillStyle = 'rgba(24,38,96,0.92)';
        ctx.font = `600 42px ${HAND_FONT}`;
        ctx.fillText(game.signScrawl, 0, 0);
        ctx.restore();
      }
    }, { lit: true, roughness: 0.5 });

    const rulesTarget = readTarget(refs.rulesSign, signW, signH, 'Station Rules', {
      scale: 2,
      caption: () => (game.state.persistent.knownFakeRules.length
        ? 'You have crossed out the ones you know are lies.'
        : 'Some of these were not written by the same hand.'),
    });
    level.addInteractable({
      id: 'int_rulessign',
      position: new THREE.Vector3(-10.6, 1.8, -1.0),
      facing: faceOf(refs.rulesSign.mesh),
      radius: 2.6,
      prompt: () => 'Read the station rules',
      use: () => {
        game.audio.paper();
        game.inspect(rulesTarget);
        game.note('Rules', 'The sign in the hall lists the station rules. Not all of them are real.');
      },
    });

    // Wayfinding over every doorway out of the hall.
    doorSign(-10.66, 2.78, -6, Math.PI / 2, 'TICKETS', 'ticket', 1.8);
    doorSign(-10.66, 2.78, 4, Math.PI / 2, 'LOST & FOUND', 'question', 2.2);
    doorSign(10.66, 2.78, -6, -Math.PI / 2, 'SECURITY — STAFF', 'camera', 2.3);
    doorSign(10.66, 2.78, 4, -Math.PI / 2, 'DINER', 'cup', 1.6);
    doorSign(-7, 2.78, 9.66, Math.PI, 'RESTROOMS', 'wc', 1.9);
    doorSign(5, 2.78, 9.66, Math.PI, 'BAGGAGE CLAIM', 'case', 2.3);
    // Through the gate, hung just inside the corridor so it reads under the
    // departure board.
    // Hung low enough to be read under the departure board through the arch.
    doorSign(0, 2.12, -10.9, 0, 'BUSES · BAYS 1–9', 'bus', 2.6);
    for (const hx of [-1.1, 1.1]) cyl(hx, 2.33, -10.95, 0.012, ROOMS.gate.h - 2.33, chrome, false, 6);

    // Waste bins. A tapered body with a rolled rim and a domed lid, because a
    // plain cylinder at this height reads as a bollard.
    for (const [i, [bx, bz]] of [[-9.5, 8.5], [9.5, -8.5]].entries()) {
      // Spun off axis so the two do not look stamped from the same die. Fixed
      // rather than random: the station should be identical every reload.
      // Galvanised cans, one still lidded and one rusted through and open.
      const rot = 0.4 + i * 0.9;
      const fallback = (g) => g.add(makeBin({ metal, dark: darkMetal }));
      model(i ? 'trash_can_rust' : 'trash_can', bx, 0, bz, rot, { fallback, block: [0.56, 0.56, 0.9] });
      if (!i) model('trash_lid', bx, 0.855, bz, rot + 0.3);
    }
    model('trash_bag', 9.95, 0, -9.15, 2.1, { block: [0.45, 0.4, 0.5] });

    // A dead rubber plant in the corner. The Presence knocks it over now and
    // then, when nobody is looking.
    const plantHome = new THREE.Vector3(9.7, 0, 8.7);
    const plant = model('plant', plantHome.x, 0, plantHome.z, 0.6, {
      // Nobody has watered it since 1987.
      tint: 0x9c8a58,
      fallback: (g) => g.add(makePlant({
        pot: paint(0x6a4a34, 0.8),
        soil: mat({ color: 0x1d1712, roughness: 1 }),
        stem: mat({ color: 0x3a3022, roughness: 0.9 }),
        leaf: mat({ color: 0x4a3b22, roughness: 0.9, side: THREE.DoubleSide }),
      })),
    });
    level.addCollider(9.38, 8.38, 10.02, 9.02, 0.5);
    refs.plant = {
      position: plantHome,
      knockOver() {
        plant.rotation.set(0, 0.6, 0);
        plant.rotateZ(1.32);
        plant.position.set(plantHome.x - 0.3, 0.28, plantHome.z);
      },
      restore() {
        plant.rotation.set(0, 0.6, 0);
        plant.position.copy(plantHome);
      },
    };

    // A noticeboard by the Lost & Found door, with the clipping pinned to it.
    const board = makeNoticeboard(1.4, 0.95, { cork: mat({ color: 0x6e5236, roughness: 0.95 }), frame: woodMat });
    place(board, -10.68, 1.6, 8.0, Math.PI / 2);
    const pinMat = mat({ color: 0xa0281e, roughness: 0.4 });
    const pin = (x, y, z) => cyl(x, y, z, 0.012, 0.012, pinMat, false, 8).rotation.set(0, 0, Math.PI / 2);
    paper('int_clipping', -10.655, 1.62, 8.15, Math.PI / 2, 'clipping', {
      prompt: 'Read newspaper clipping',
      w: 0.42, h: 0.56,
      style: 'news',
      onRead: () => {
        game.note('1987', 'A bus with 14 passengers left Bay 9 on Nov 3 1987 and never arrived.');
        if (game.state.persistent.loop >= 4) {
          game.note('1987', 'The photo in the clipping now shows someone on the bench wearing your clothes.');
        }
      },
    });
    pin(-10.645, 1.88, 8.15);
    // Other paper on the board, for the look of it: a timetable and a
    // handbill, both long out of date.
    const notice = (z, y, w, h, rot, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat({ color, roughness: 0.95 }));
      m.position.set(-10.656, y, z);
      m.rotation.set(0, Math.PI / 2, rot);
      level.group.add(m);
      pin(-10.645, y + h / 2 - 0.03, z);
    };
    notice(7.62, 1.72, 0.26, 0.34, 0.05, 0xc9c09a);
    notice(7.66, 1.36, 0.22, 0.18, -0.08, 0xd6b97a);
    notice(8.52, 1.5, 0.2, 0.28, 0.1, 0xbfc4b8);

    // A coin under the middle bench.
    coin('coin_hall', 0.8, 0, 2.15, 'Coins turn up under the hall benches.');

    // Payphone on the east wall. The line has been dead since 1987, which does
    // not stop it from ringing.
    (function payphone() {
      const px = 10.55;
      const pz = -1.0;
      // A phone has to be recognisable as a phone from across the hall,
      // because the moment it rings you need to already know what the noise is.
      const unit = makePayphone({
        metal,
        dark: darkMetal,
        handset: mat({ color: 0x4a5056, roughness: 0.5 }),
        light: mat({ color: 0x9aa4a0 }),
      });
      // Built facing +z; the east wall needs it looking back into the hall.
      place(unit, px, 1.5, pz, -Math.PI / 2, [10.28, pz - 0.38, 10.7, pz + 0.38, 2.1]);
      // An acoustic hood round it.
      const hood = new Build();
      hood.box(0.04, 1.0, 0.7, { x: -0.02, y: 0 }, 'shell');
      for (const s of [-1, 1]) hood.box(0.42, 1.0, 0.03, { x: -0.21, z: s * 0.35 }, 'shell');
      hood.box(0.42, 0.03, 0.73, { x: -0.21, y: 0.5 }, 'shell');
      place(hood.build({ shell: paint(0x3c4a4e, 0.7) }), 10.7, 1.6, pz, 0);

      const receiver = unit.userData.handset;
      const cord = unit.userData.cord;
      const hookPos = receiver.position.clone();
      const phone = {
        position: new THREE.Vector3(px, 1.5, pz),
        receiver,
        cord,
        offHook: false,
        setOffHook(v) {
          phone.offHook = v;
          if (v) {
            // Dangling on the end of the cord, turned off vertical. Local
            // space, so this is relative to the phone and the rotation on the
            // parent carries it round to the wall for free.
            receiver.position.set(hookPos.x, hookPos.y - 0.55, hookPos.z + 0.04);
            receiver.rotation.z = 0.25;
            cord.scale.y = 2.6;
          } else {
            receiver.position.copy(hookPos);
            receiver.rotation.z = 0;
            cord.scale.y = 1;
          }
        },
      };
      refs.payphone = phone;

      level.addInteractable({
        id: 'int_payphone',
        position: phone.position.clone(),
        radius: 2.2,
        prompt: () => (phone.offHook ? 'Hang up the receiver' : 'Lift the receiver'),
        use: () => {
          if (phone.offHook) {
            phone.setOffHook(false);
            game.audio.lockClick(true);
            return;
          }
          phone.setOffHook(true);
          game.audio.lockClick(false);
          if (game.phoneRinging) {
            game.phoneRinging = false;
            game.onPhoneAnswered?.();
            return;
          }
          game.subtitle('No dial tone. Just the room you are standing in, played back.', 4);
          game.note('Station', 'The payphone has no dial tone. It rings anyway.');
          game.later(1.4, () => {
            if (phone.offHook) game.audio.whisper(0, 0.5);
          });
        },
        onReset: () => phone.setOffHook(false),
      });
    })();

    level.addLight(-5.5, r.h - 0.25, -5, { intensity: 0.95, distance: 15, room: 'hall' });
    level.addLight(5.5, r.h - 0.25, -5, { intensity: 0.95, distance: 15, room: 'hall' });
    level.addLight(-5.5, r.h - 0.25, 5, { intensity: 0.8, distance: 14, room: 'hall', flicker: 0.35 });
    level.addLight(5.5, r.h - 0.25, 5, { intensity: 0.8, distance: 14, room: 'hall' });
  })();

  // ---- Ticket Office -----------------------------------------------------

  (function ticket() {
    // The ticket counter, parallel to the hall wall: the public stand in the
    // strip by the door, staff behind it. Panelled front, laminate top and a
    // glass screen with two speaking windows.
    const cx = -13.4;
    const cz1 = -8.2;
    const cz2 = -3.6;
    const clen = cz2 - cz1;
    const cmid = (cz1 + cz2) / 2;
    level.box(cx, cmid, 0.9, clen, 1.05, 0, woodMat);
    level.box(cx + 0.06, cmid, 1.1, clen + 0.1, 0.05, 1.05, laminate, { ghost: true });
    level.box(cx + 0.47, cmid, 0.02, clen, 0.1, 0.0, blackPlastic, { ghost: true });
    // The screen: glass panes between steel mullions, with a gap at the
    // counter for passing things under.
    const screenX = cx - 0.1;
    for (const [z1, z2] of [[cz1, -6.3], [-5.5, cz2]]) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.0, z2 - z1 - 0.06), glass);
      g.position.set(screenX, 1.75, (z1 + z2) / 2);
      level.group.add(g);
    }
    for (const mz of [cz1, -6.3, -5.5, cz2]) {
      level.box(screenX, mz, 0.05, 0.05, 1.15, 1.1, metal, { ghost: true });
    }
    level.box(screenX, cmid, 0.06, clen + 0.05, 0.05, 2.25, metal, { ghost: true });
    // A brass bell on the counter, for the look of it.
    cyl(cx + 0.25, 1.1, -7.4, 0.05, 0.035, brass, false, 18);

    // Ticket machine, against the south wall in the staff area.
    const machine = makeTicketMachine({
      body: paint(0x7d2f22, 0.8),
      dark: blackPlastic,
      metal: chrome,
      lamp: mat({ color: 0xd8d2b8, emissive: 0x6a6450, roughness: 0.6 }),
    });
    const mx = -21.0;
    const mz = -9.35;
    place(machine, mx, 0, mz, 0, [mx - 0.43, mz - 0.33, mx + 0.43, mz + 0.33, 1.9]);
    const scr = machine.userData.screen;
    const facePanel = textPanel(mx + scr.x, scr.y, mz + scr.z, 0, scr.w, scr.h, 256, 160, (ctx, w, h) => {
      ctx.fillStyle = '#0b1a12';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7dffb8';
      ctx.font = `500 22px ${MONO_FONT}`;
      const coins = game.state?.run.coins ?? 0;
      ctx.fillText('FARE    4 COINS', 14, 36);
      ctx.fillText(`INSERTED ${Math.min(coins, 4)}/4`, 14, 72);
      ctx.fillStyle = game.state?.run.ticketStub ? '#e8c860' : '#7dffb8';
      ctx.fillText(game.state?.run.ticketStub ? 'TICKET PRINTED' : 'READY', 14, 108);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    }, { glow: 0.85 });
    textPanel(mx, 1.66, mz + 0.334, 0, 0.7, 0.16, 256, 58, (ctx, w, h) => {
      ctx.fillStyle = '#e4dcc2';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7d2f22';
      ctx.textAlign = 'center';
      ctx.font = `700 40px ${SIGN_FONT}`;
      ctx.fillText('TICKETS', w / 2, h * 0.78);
    }, { glow: 0.75 });

    level.addInteractable({
      id: 'int_ticketmachine',
      position: new THREE.Vector3(mx, 1.3, mz + 0.4),
      radius: 2.4,
      prompt: () => {
        if (game.state.run.ticketStub) return 'The machine has already printed tonight';
        return `Insert coins (${Math.min(game.state.run.coins, 4)}/4)`;
      },
      use: () => {
        if (game.state.run.ticketStub) {
          game.toast('It will only print one stub a night.');
          return;
        }
        if (game.state.run.coins < 4) {
          game.audio.lockClick(false);
          game.toast(`It needs four 1987 coins. You have ${game.state.run.coins}.`);
          game.note('Ticket', 'The ticket machine needs exactly four 1987 coins.');
          return;
        }
        game.state.run.coins -= 4;
        game.state.run.ticketStub = true;
        game.showTicket();
        game.audio.vendingClunk();
        game.makeNoise(mx, mz, 0.8, 'the ticket machine');
        game.toast('A ticket stub, unstamped.');
        game.note('Ticket', 'Part 1 of 3: the stub, printed by the machine in the Ticket Office.');
      },
      redraw: facePanel.redraw,
    });

    // Walter's desk, against the north wall. The destination stamp is in its
    // locked top drawer and his night log is lying open on top.
    const desk = makeDesk(1.7, 0.75, { top: woodMat, body: paint(0x4a4f48, 0.8), metal: chrome });
    const dx = -17.2;
    const dz = -2.3 - 0.375 - 0.02;
    place(desk, dx, 0, dz, 0, [dx - 0.85, dz - 0.375, dx + 0.85, dz + 0.375, 0.76]);
    const drawerX = dx + 0.85 - 0.22 - 0.02;
    level.addInteractable({
      id: 'int_stampdrawer',
      position: new THREE.Vector3(drawerX, 0.62, dz - 0.4),
      radius: 2.0,
      prompt: () =>
        game.state.run.ticketStamped
          ? 'The drawer is empty now'
          : game.state.run.hasKeyring
            ? 'Unlock the drawer and take the stamp'
            : 'Locked drawer (needs a keyring)',
      use: () => {
        if (game.state.run.ticketStamped) return;
        if (!game.state.run.hasKeyring) {
          game.audio.lockClick(false);
          game.toast('Locked. Walter keeps the ring on him, or on its hook.');
          game.note('Ticket', 'The destination stamp is in a locked drawer in the Ticket Office.');
          return;
        }
        if (!game.state.run.ticketStub) {
          game.toast('Nothing to stamp yet.');
          return;
        }
        game.state.run.ticketStamped = true;
        game.showTicket();
        game.audio.stamp();
        game.makeNoise(drawerX, dz, 0.45, 'the stamp');
        game.toast('Destination stamped: THE COAST.');
        game.note('Ticket', 'Part 2 of 3: the stamp, in the drawer. The keyring opens it.');
      },
    });

    paper('int_nightlog', dx - 0.35, 0.762, dz + 0.02, 0.12, 'nightlog', {
      prompt: "Read Walter's night log",
      flat: true,
      w: 0.32, h: 0.42,
      radius: 2.0,
      onRead: () => {
        game.note('Walter', 'Walter Penn stamped all 14 tickets in 1987 and never boarded.');
        game.note('Rules', 'Walter writes that someone else has been adding rules to his sign.');
      },
    });
    coin('coin_ticket', dx + 0.2, 0.76, dz - 0.18, 'There was a coin on the ticket desk.');
    // A boy's letter, kept on the desk for thirty-odd years.
    paper('int_tobiasletter', dx + 0.24, 0.764, dz + 0.2, -0.25, 'tobiasletter', {
      prompt: 'Read the letter',
      flat: true,
      style: 'note',
      w: 0.2,
      h: 0.26,
      radius: 1.7,
      onRead: () => {
        game.note('Walter', 'A letter from Tobias: Walter promised to put him on the bus himself. Walter kept it.');
      },
    });

    // The fare manifest, left out on the counter where Walter took the fares.
    //
    // This is the quest-giver, so it is deliberately the easiest document in
    // the station to find: it is the only place the player learns there are
    // fourteen of them and what they are called.
    level.box(cx + 0.25, -5.0, 0.3, 0.42, 0.012, 1.1, darkMetal, { ghost: true });
    paper('int_manifest', cx + 0.25, 1.114, -5.0, Math.PI / 2, 'manifest', {
      prompt: 'Read the fare manifest',
      flat: true,
      table: true,
      w: 0.26,
      h: 0.38,
      radius: 2.0,
      onRead: () => {
        game.note('Passengers', 'The manifest lists fourteen fares on the 11:47. Walter stamped every one.');
        game.note('Passengers', 'Line fourteen reads C. FERRY, seat 0. That coach has no seat 0, and the line is in a different hand.');
      },
    });

    // Filing cabinets against the west wall.
    const cabinetMats = { body: paint(0x56605a, 0.8), metal: chrome, label: paperMat };
    for (const fz of [-6.0, -5.45]) {
      place(makeFilingCabinet(cabinetMats), -22.7 + 0.31, 0, fz, Math.PI / 2, [-22.7, fz - 0.24, -22.08, fz + 0.24, 1.32]);
    }

    level.addLight(-17, ROOMS.ticket.h - 0.25, -6, { intensity: 0.85, distance: 12, room: 'ticket', color: 0xd6e8c0 });

    // Door into the manager's office.
    level.addInteractable({
      id: 'int_managerdoor',
      position: new THREE.Vector3(-17, 1.3, -10),
      radius: 2.4,
      enabledWhen: () => level.isLocked('managerDoor'),
      prompt: () =>
        game.state.run.hasKeyring ? "Unlock the manager's office" : "Manager's office (locked)",
      use: () => {
        if (!level.isLocked('managerDoor')) return;
        if (!game.state.run.hasKeyring) {
          game.audio.lockClick(false);
          game.toast('Locked. A staff door.');
          return;
        }
        if (level.unlockDoor('managerDoor')) {
          game.audio.lockClick(true);
          game.audio.doorCreak?.();
          game.toast("The manager's office is open.");
          game.note('Station', "The keyring opens the manager's office behind the Ticket Office.");
        }
      },
    });
    // A plate on the door, so it reads as an office before it is opened.
    const managerPlate = textPanel(-17, 1.62, -9.94, 0, 0.42, 0.12, 256, 72, (ctx, w, h) => {
      ctx.fillStyle = '#b8a462';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1e1a10';
      ctx.textAlign = 'center';
      ctx.font = `700 38px ${SIGN_FONT}`;
      ctx.fillText('MANAGER', w / 2, h * 0.7);
    }, { lit: true, roughness: 0.35 });
    attachToDoor('managerDoor', managerPlate.mesh);
  })();

  // Hangs a mesh on a door leaf so it swings with it.
  function attachToDoor(key, mesh) {
    const door = level.doors.get(key);
    if (!door) return;
    door.pivot.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(door.pivot.matrixWorld).invert();
    mesh.updateMatrixWorld(true);
    mesh.applyMatrix4(inv);
    door.pivot.add(mesh);
  }

  // ---- Manager's Office --------------------------------------------------

  (function manager() {
    const desk = makeDesk(1.8, 0.85, { top: woodMat, body: woodMat, metal: brass }, { h: 0.78 });
    place(desk, -17, 0, -16.0, 0, [-17.9, -16.43, -16.1, -15.57, 0.78]);
    // A green banker's lamp and a blotter on it.
    cyl(-16.4, 0.78, -16.15, 0.07, 0.02, brass, false, 16);
    cyl(-16.4, 0.8, -16.15, 0.012, 0.3, brass, false, 8);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, 0.12, 20, 1, true), mat({ color: 0x1f4a32, roughness: 0.3, side: THREE.DoubleSide }));
    shade.position.set(-16.4, 1.12, -16.15);
    level.group.add(shade);
    level.box(-17.3, -16.0, 0.6, 0.4, 0.006, 0.78, mat({ color: 0x2c3a2c, roughness: 0.9 }), { ghost: true });
    // The week's driver roster, on the blotter where the depot manager left
    // it: the 11:47 on the third was never meant to run.
    paper('int_roster', -17.36, 0.788, -15.98, 0.06, 'roster', {
      prompt: 'Read the duty roster',
      flat: true,
      table: true,
      w: 0.26,
      h: 0.34,
      radius: 1.9,
      onRead: () => {
        game.note('1987', 'The 11:47 on Nov 3 1987 was withdrawn: no driver. It came in anyway, and Walter never saw who was driving.');
        if (game.state.persistent.loop >= 3) {
          game.note('Bay 0', 'Someone has pressed a 0 into the roster, in the driver column for the 11:47.');
        }
      },
    });

    // Filing cabinets on the east wall and a bookcase of binders on the west.
    const cabinetMats = { body: paint(0x4e5650, 0.8), metal: chrome, label: paperMat };
    for (const fz of [-13.6, -14.1, -14.6]) {
      place(makeFilingCabinet(cabinetMats), -11.3 - 0.31, 0, fz, -Math.PI / 2, [-11.92, fz - 0.24, -11.3, fz + 0.24, 1.32]);
    }
    const shelf = new Build();
    const sw = 2.4;
    shelf.box(sw, 2.1, 0.03, { y: 1.05, z: -0.17 }, 'wood');
    for (const sx of [-sw / 2, sw / 2]) shelf.box(0.03, 2.1, 0.36, { x: sx, y: 1.05 }, 'wood');
    for (let i = 0; i < 5; i++) shelf.box(sw, 0.025, 0.36, { y: 0.05 + i * 0.5 }, 'wood');
    const binderCols = ['b1', 'b2', 'b3'];
    for (let i = 0; i < 4; i++) {
      let x = -sw / 2 + 0.06;
      let k = i * 7;
      while (x < sw / 2 - 0.12) {
        const bw = 0.06 + ((k * 37) % 5) * 0.008;
        const bh = 0.3 + ((k * 13) % 4) * 0.02;
        shelf.box(bw - 0.006, bh, 0.28, { x: x + bw / 2, y: 0.065 + i * 0.5 + bh / 2, z: 0.01, rz: (k % 9 === 0) ? 0.12 : 0 }, binderCols[k % 3]);
        x += bw;
        k++;
        if (k % 11 === 0) x += 0.25;
      }
    }
    const bookcase = shelf.build({
      wood: woodMat,
      b1: mat({ color: 0x2a3a52, roughness: 0.6 }),
      b2: mat({ color: 0x5a2422, roughness: 0.6 }),
      b3: mat({ color: 0x3a3a30, roughness: 0.6 }),
    });
    place(bookcase, -22.7 + 0.19, 0, -16.5, Math.PI / 2, [-22.7, -17.75, -22.32, -15.25, 2.1]);

    // The stopped clock. Setting it to 11:47 opens the floor safe.
    let clockSet = false;
    const clockR = 0.42;
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(clockR + 0.04, clockR + 0.04, 0.07, 40), woodMat);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(-17, 1.95, -19.665);
    level.group.add(bezel);
    const stopped = textPanel(-17, 1.95, -19.625, 0, 0, 0, 256, 256, (ctx, w, h) => {
      const c = w / 2;
      ctx.fillStyle = '#cfc6b0';
      ctx.fillRect(0, 0, w, h);
      grime(ctx, w, h, 0.08, 11);
      ctx.fillStyle = '#201c18';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 28px ${SIGN_FONT}`;
      for (let i = 1; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.fillText(String(i), c + Math.sin(a) * (c - 30), c - Math.cos(a) * (c - 30));
      }
      // Frozen at 2:10 until set.
      const hourAngle = clockSet ? (11.78 / 12) * Math.PI * 2 : (2.17 / 12) * Math.PI * 2;
      const minAngle = clockSet ? (47 / 60) * Math.PI * 2 : (10 / 60) * Math.PI * 2;
      const hand = (angle, len, width) => {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(angle);
        ctx.fillRect(-width / 2, -len, width, len + 14);
        ctx.restore();
      };
      hand(hourAngle, c * 0.5, 10);
      hand(minAngle, c * 0.76, 6);
      ctx.beginPath();
      ctx.arc(c, c, 7, 0, Math.PI * 2);
      ctx.fill();
      // A crack across the glass.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.15, h * 0.3);
      ctx.lineTo(w * 0.45, h * 0.42);
      ctx.lineTo(w * 0.62, h * 0.38);
      ctx.lineTo(w * 0.9, h * 0.55);
      ctx.stroke();
    }, { geometry: new THREE.CircleGeometry(clockR, 40), lit: true, roughness: 0.3 });

    // The floor safe: a steel hatch flush with the boards. Releasing it lifts
    // the hatch and shows the safe door underneath.
    const hx = -14.4;
    const hz = -13.1;
    const hatchPivot = new THREE.Group();
    hatchPivot.position.set(hx, 0.0, hz - 0.45);
    level.group.add(hatchPivot);
    const hatch = new Build();
    hatch.box(0.9, 0.025, 0.9, { y: 0.0125, z: 0.45 }, 'plate');
    hatch.box(0.16, 0.02, 0.04, { y: 0.03, z: 0.82 }, 'handle');
    for (let i = 0; i < 5; i++) hatch.box(0.86, 0.004, 0.02, { y: 0.026, z: 0.1 + i * 0.17 }, 'handle');
    hatchPivot.add(hatch.build({ plate: paint(0x3a3e3c, 0.7), handle: metal }));
    // The recess and the safe door in it, visible only once the hatch is up.
    const recess = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.84), mat({ color: 0x050607, roughness: 1 }));
    recess.rotation.x = -Math.PI / 2;
    recess.position.set(hx, 0.002, hz);
    recess.visible = false;
    level.group.add(recess);
    const safeDoor = new Build();
    safeDoor.box(0.56, 0.02, 0.56, { y: 0.01 }, 'steel');
    safeDoor.cyl(0.07, 0.07, 0.03, 20, { y: 0.03 }, 'dial');
    safeDoor.box(0.18, 0.02, 0.03, { x: 0.16, y: 0.03 }, 'dial');
    const safeMesh = safeDoor.build({ steel: paint(0x2b3238, 0.6), dial: chrome });
    // Hinged along its west edge, so it swings up clear of the hatch, which
    // stands up along the north one.
    const safePivot = new THREE.Group();
    safePivot.position.set(hx, 0.004, hz);
    safePivot.rotation.y = 0.2;
    level.group.add(safePivot);
    const safeHinge = new THREE.Group();
    safeHinge.position.x = -0.28;
    safePivot.add(safeHinge);
    safeMesh.position.x = 0.28;
    safeHinge.add(safeMesh);
    safeMesh.visible = false;
    // Walter's letter, lying in the bottom of the safe once the door is open.
    const letterDoc = DOCUMENTS.waltersletter;
    const letterW = 0.2;
    const letterH = 0.27;
    let letter = null;
    letter = textPanel(hx + 0.01, 0.008, hz + 0.01, 0, letterW, letterH, 256, Math.round((256 * letterH) / letterW),
      (ctx, cw, ch) => drawPage(ctx, cw, ch, { style: 'note', lines: letterDoc.lines(), seed: 9, full: !!letter?.focused }),
      { lit: true, roughness: 0.92 });
    letter.mesh.rotation.set(-Math.PI / 2, 0, 0.2 + 0.12);
    letter.mesh.visible = false;
    const letterTarget = readTarget(letter, letterW, letterH, letterDoc.title);
    let hatchAngle = 0;
    let hatchTarget = 0;
    let safeAngle = 0;
    let safeTarget = 0;
    refs.animated.push((dt) => {
      if (Math.abs(safeAngle - safeTarget) > 1e-3) {
        safeAngle += (safeTarget - safeAngle) * Math.min(1, dt * 5);
        if (Math.abs(safeAngle - safeTarget) < 0.003) safeAngle = safeTarget;
        safeHinge.rotation.z = safeAngle;
      }
      if (Math.abs(hatchAngle - hatchTarget) < 1e-3) return;
      hatchAngle += (hatchTarget - hatchAngle) * Math.min(1, dt * 3);
      if (Math.abs(hatchAngle - hatchTarget) < 0.003) hatchAngle = hatchTarget;
      hatchPivot.rotation.x = -hatchAngle;
    });

    level.addInteractable({
      id: 'int_stoppedclock',
      position: new THREE.Vector3(-17, 1.95, -19.6),
      radius: 2.4,
      prompt: () => (clockSet ? 'The hands read 11:47' : 'Move the stopped clock hands'),
      use: () => {
        if (clockSet) return;
        if (!game.state.persistent.managerFound && !game.state.hasNote('The stopped clock opens the floor safe. Set it to 11:47.')) {
          game.toast('The hands move freely, but you do not know where to set them.');
          return;
        }
        clockSet = true;
        stopped.redraw();
        game.audio.lockClick(true);
        game.audio.cutHum(1.4);
        hatchTarget = 1.9;
        recess.visible = true;
        safeMesh.visible = true;
        game.toast('Something heavy unlatches under the floor.');
      },
      onReset: () => {
        clockSet = false;
        stopped.redraw();
        hatchTarget = 0;
        hatchAngle = 0;
        hatchPivot.rotation.x = 0;
        recess.visible = false;
        safeMesh.visible = false;
        safeTarget = 0;
        safeAngle = 0;
        safeHinge.rotation.z = 0;
        letter.mesh.visible = false;
      },
    });

    level.addInteractable({
      id: 'int_safe',
      position: new THREE.Vector3(hx, 0.3, hz),
      radius: 2.0,
      prompt: () => (clockSet ? (game.state.run.hasWalkie ? 'The safe is empty but for the letter' : 'Open the floor safe') : 'A steel hatch in the floor'),
      use: () => {
        if (!clockSet) {
          game.audio.lockClick(false);
          game.toast('Sealed. Something has to release it.');
          return;
        }
        const first = !game.state.run.hasWalkie;
        game.state.run.hasWalkie = true;
        game.state.persistent.readLetter = true;
        game.state.save();
        if (safeTarget === 0) {
          // The door swings up first, and you lean in once it is out of the
          // way rather than through it.
          safeTarget = 1.85;
          letter.mesh.visible = true;
          game.audio.lockClick(true);
          game.later(0.5, () => {
            game.audio.paper();
            game.inspect(letterTarget);
          });
        } else {
          game.audio.paper();
          game.inspect(letterTarget);
        }
        game.note('Walter', 'Walter has been resetting the loop to keep people away from the thing on camera four.');
        game.note('Endings', 'Hear every passenger\'s story and a slip with your own name appears in the box.');
        game.note('Walter', 'A walkie-talkie in Walter\'s safe. With it, he will hear you out at Bay 9 at 3:30.');
        if (first) game.toast('You take a walkie-talkie.');
      },
    });

    level.addLight(-17, ROOMS.manager.h - 0.3, -15, { intensity: 0.5, distance: 10, room: 'manager', flicker: 0.5 });
  })();

  // ---- Lost & Found ------------------------------------------------------

  (function lostfound() {
    // Three double-sided racks running east-west, stopping short of both end
    // walls so every aisle opens onto a walkway. They used to run wall to
    // wall, which left the north aisle -- and everything shelved in it -- with
    // no way in.
    const X_W = -21.0;
    const X_E = -13.4;
    const LEN = X_E - X_W;
    const MID = (X_W + X_E) / 2;
    const SHELF_Z = [1.5, 4.6, 7.7];
    const SHELF_Y = [0.6, 1.3, 1.95];
    const SHELF_D = 0.86;   // full depth, so 0.43 of usable ledge per side
    const UPRIGHTS = [0, 1, 2, 3, 4].map((i) => X_W + (LEN * i) / 4);
    const rack = new Build();
    for (const sz of SHELF_Z) {
      // Spine down the middle, so the two faces cannot see through each other.
      rack.box(LEN, 2.2, 0.04, { x: MID, y: 1.1, z: sz }, 'spine');
      for (const ux of UPRIGHTS) rack.box(0.07, 2.2, SHELF_D, { x: ux, y: 1.1, z: sz }, 'frame');
      for (const sy of SHELF_Y) {
        rack.box(LEN + 0.1, 0.05, SHELF_D, { x: MID, y: sy + 0.025, z: sz }, 'shelf');
        // A lip along both edges.
        for (const s of [-1, 1]) rack.box(LEN + 0.1, 0.04, 0.015, { x: MID, y: sy + 0.06, z: sz + s * (SHELF_D / 2 - 0.008) }, 'frame');
      }
      rack.box(LEN + 0.1, 0.1, SHELF_D, { x: MID, y: 0.05, z: sz }, 'frame');
      // One collider for the whole rack, so the player cannot get wedged
      // between an upright and a shelf lip.
      level.addCollider(X_W - 0.06, sz - SHELF_D / 2, X_E + 0.06, sz + SHELF_D / 2, 2.2);
    }
    place(rack.build({ spine: darkMetal, frame: paint(0x2f3a36, 0.8), shelf: paint(0x56605a, 0.9) }), 0, 0, 0);

    // Coin lockers on the west wall, facing into the first aisle.
    const coinLockers = makeLockers(4, 5, {
      body: paint(0x3e4c45),
      door: paint(0x4a5a52),
      metal,
    });
    place(coinLockers, -22.7 + 0.25, 0, 3.05, Math.PI / 2, [-22.7, 3.05 - 0.78, -22.18, 3.05 + 0.78, 2.2]);

    // One belonging per passenger, laid out across the shelf faces that open
    // onto an aisle.
    //
    // Deriving the layout means adding a passenger is a one-file change. The
    // outer face of the first rack backs onto the south wall, so it gets none.
    const SHELF_SIDES = [[1], [-1, 1], [-1, 1]];
    const surfaces = [];
    SHELF_Z.forEach((sz, rackIndex) => {
      for (const side of SHELF_SIDES[rackIndex]) {
        for (const sy of SHELF_Y) surfaces.push({ z: sz + side * 0.22, y: sy + 0.05, side });
      }
    });
    const SPAN = LEN - 0.6;

    // Surfaces are dealt round-robin so the racks fill evenly. Position along
    // the shelf comes from the golden ratio: stepping by an irrational fraction
    // never repeats, so the items spread along the shelf instead of stacking
    // into tidy columns.
    const slots = PASSENGERS.map((p, i) => {
      const s = surfaces[i % surfaces.length];
      const t = (i * 0.6180339887 + 0.5) % 1;
      let x = MID - SPAN / 2 + SPAN * t;
      // An upright is 7cm wide but an item is 20-30, so anything landing on a
      // post steps aside rather than growing through it.
      for (const ux of UPRIGHTS) {
        if (Math.abs(x - ux) < 0.24) x = ux + (x < ux ? -0.24 : 0.24);
      }
      const jitter = ((i * 2654435761) % 1000) / 1000 - 0.5;
      return { p, x, z: s.z + jitter * 0.06, y: s.y, yaw: (s.side > 0 ? 0 : Math.PI) + jitter * 0.8 };
    });

    // Shared across all fourteen: the shapes differ, the materials do not.
    const itemMats = {
      item: mat({ color: 0x6a5a44, roughness: 0.78 }),
      paper: mat({ color: 0xbcb49c, roughness: 0.9 }),
      metal: shiny(mat({ color: 0x8a8f8c, roughness: 0.4, metalness: 0.7 }), 0.8),
      dark: mat({ color: 0x2c3034, roughness: 0.6 }),
    };

    for (const slot of slots) {
      // Modelled to its description, so you can tell a hatbox from a duffel
      // from the aisle instead of having to read every prompt in the room.
      const mesh = makeBelonging(slot.p.item, itemMats);
      place(mesh, slot.x, slot.y, slot.z, slot.yaw);

      const it = level.addInteractable({
        id: 'int_belonging_' + slot.p.itemId,
        position: new THREE.Vector3(slot.x, slot.y + 0.08, slot.z),
        // Tighter than most interactables. There are fourteen of these within
        // a few metres of each other, and the prompt is picked mostly on aim.
        radius: 1.6,
        prompt: () => {
          if (game.state.persistent.heardStories.includes(slot.p.id)) {
            return `${slot.p.item} (returned)`;
          }
          return `Take: ${slot.p.item}`;
        },
        use: () => {
          if (game.state.persistent.heardStories.includes(slot.p.id)) {
            game.toast('You have already heard that one.');
            return;
          }
          if (game.carrying) {
            game.toast(`Your hands are full: ${game.carrying.item}`);
            return;
          }
          game.carrying = { id: slot.p.itemId, item: slot.p.item, owner: slot.p.id };
          mesh.visible = false;
          it.enabled = false;
          game.audio.paper();
          game.toast(`Carrying: ${slot.p.item}`);
          game.note('Lost & Found', `${slot.p.item} belongs to ${slot.p.name}.`);
        },
        onReset: () => {
          const heard = game.state.persistent.heardStories.includes(slot.p.id);
          mesh.visible = !heard;
          it.enabled = true;
        },
      });
      // Returned on an earlier night: it is no longer on the shelf.
      if (game.state.persistent.heardStories.includes(slot.p.id)) mesh.visible = false;
    }

    // The lost-property desk in the corner by the door, with the shoebox of
    // transfer slips on it. Which slip you punch decides the ending.
    const desk = makeDesk(1.2, 0.7, { top: woodMat, body: paint(0x4a4f48, 0.8), metal: chrome });
    const dz = 0.3 + 0.35 + 0.02;
    place(desk, -12.1, 0, dz, Math.PI, [-12.7, dz - 0.35, -11.5, dz + 0.35, 0.76]);
    const box = new Build();
    box.box(0.34, 0.12, 0.22, { y: 0.06 }, 'card');
    for (let i = 0; i < 9; i++) box.box(0.006, 0.1, 0.19, { x: -0.14 + i * 0.033, y: 0.07 + (i % 3) * 0.008, rz: (i % 2 ? 0.08 : -0.06) }, 'slip');
    place(box.build({ card: mat({ color: 0x8c7a5a, roughness: 0.9 }), slip: mat({ color: 0xd8cfa8, roughness: 0.9 }) }), -12.15, 0.76, dz, 0.2);
    level.addInteractable({
      id: 'int_transferslips',
      position: new THREE.Vector3(-12.15, 0.85, dz),
      radius: 2.2,
      prompt: () => 'Search the transfer slips',
      use: () => {
        const ownSlip = game.state.heardAllStories(PASSENGERS.length);
        const options = PASSENGERS.map((p) => ({ id: p.id, label: `${p.name} — coast route` }));
        if (ownSlip) options.unshift({ id: 'self', label: 'A slip with YOUR OWN name on it', own: true });
        game.chooseSlip(options);
        game.note('Ticket', 'Part 3 of 3: a transfer slip from Lost & Found, punched by the conductor\'s punch.');
      },
    });
    textPanel(-11.32, 1.55, dz + 0.1, -Math.PI / 2, 0.6, 0.3, 256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#d6cdb2';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d2a33';
      ctx.textAlign = 'center';
      ctx.font = `700 40px ${SIGN_FONT}`;
      ctx.fillText('LOST PROPERTY', w / 2, 52);
      ctx.font = `500 22px ${SIGN_FONT}`;
      ctx.fillText('CLAIMS · TRANSFERS · ENQUIRIES', w / 2, 92);
    }, { lit: true, roughness: 0.5 });

    // Postcards pinned to a board on the east wall, north of the door.
    const pinboard = makeNoticeboard(1.1, 0.75, { cork: mat({ color: 0x6e5236, roughness: 0.95 }), frame: woodMat });
    place(pinboard, -11.32, 1.5, 7.6, -Math.PI / 2);
    const cardColors = ['#d7c9a0', '#c8d0c0', '#e0d4b0', '#cfc0a0', '#d4ccb8'];
    const postcards = DOCUMENTS.postcards;
    const cards = postcards.cards.map((card, i) => {
      const panel = textPanel(-11.345, 1.68 - Math.floor(i / 3) * 0.28, 7.25 + (i % 3) * 0.33 + (i > 2 ? 0.16 : 0), 0,
        0.2, 0.13, 256, 166, (ctx, w, h) => drawPostcard(ctx, w, h, card, cardColors[i], i), { lit: true, roughness: 0.9 });
      panel.mesh.rotation.set(0, -Math.PI / 2, ((i * 7) % 5 - 2) * 0.05);
      return panel;
    });
    // The view takes in the whole board; leaning in picks out one card.
    const cardsAnchor = new THREE.Object3D();
    cardsAnchor.position.set(-11.36, 1.54, 7.58);
    cardsAnchor.rotation.y = -Math.PI / 2;
    level.group.add(cardsAnchor);
    const cardsTarget = readTarget(cards[0], 0.96, 0.5, postcards.title, {
      panels: cards,
      scale: 3,
      view: faceView(cardsAnchor, 0.96, 0.5),
      caption: postcards.say,
    });
    level.addInteractable({
      id: 'int_postcards',
      position: new THREE.Vector3(-11.35, 1.5, 7.6),
      facing: faceOf(cardsAnchor),
      radius: 2.2,
      prompt: () => 'Read the postcards',
      use: () => {
        game.audio.paper();
        game.inspect(cardsTarget);
        game.note('Passengers', 'Postcards in Lost & Found, written to people on the 11:47. None were ever sent.');
      },
    });

    // The flashlight, on the first rack where it faces the door.
    const torch = makeFlashlight({
      body: mat({ color: 0x9a6a22, roughness: 0.5, metalness: 0.2 }),
      chrome,
      lens: mat({ color: 0xe8e0c0, emissive: 0x2a2614, roughness: 0.1 }),
    });
    const torchPos = new THREE.Vector3(-14.35, SHELF_Y[1] + 0.05, SHELF_Z[0] + 0.24);
    place(torch, torchPos.x, torchPos.y, torchPos.z, 0.35);
    const flashIt = level.addInteractable({
      id: 'int_flashlight',
      position: torchPos.clone().setY(torchPos.y + 0.05),
      radius: 2.0,
      prompt: () => 'Take the flashlight',
      use: () => {
        game.state.run.hasFlashlight = true;
        game.player.battery = 1;
        torch.visible = false;
        flashIt.enabled = false;
        game.toast(`Flashlight. ${game.touch ? 'Tap' : 'Press'} ${game.key('F')} to switch it on.`);
        game.note('Items', 'A flashlight sits on the Lost & Found shelves. The beam carries further than you think.');
      },
      onReset: () => {
        torch.visible = true;
        flashIt.enabled = true;
      },
    });

    coin('coin_lost', -19.6, SHELF_Y[0] + 0.05, SHELF_Z[0] + 0.24, 'A wallet on the Lost & Found shelf had a coin in it.');

    level.addLight(MID, ROOMS.lostfound.h - 0.3, 3.05, { intensity: 0.65, distance: 11, room: 'lostfound' });
    level.addLight(MID, ROOMS.lostfound.h - 0.3, 6.15, { intensity: 0.5, distance: 10, room: 'lostfound', flicker: 0.4 });
    level.addLight(MID - 1.5, ROOMS.lostfound.h - 0.3, 8.9, { intensity: 0.38, distance: 8, room: 'lostfound', flicker: 0.2 });
  })();

  // ---- Security / CCTV ---------------------------------------------------

  (function cctv() {
    // A console desk against the north wall. The monitors used to be a flat
    // panel turned to face the wall, so nobody had ever seen them.
    const dz = -2.3 - 0.45 - 0.02;
    const desk = makeDesk(4.4, 0.9, { top: laminate, body: paint(0x3a403c, 0.8), metal: chrome });
    place(desk, 17.2, 0, dz, 0, [15.0, dz - 0.45, 19.4, dz + 0.45, 0.76]);

    // Four CRTs on the back of the desk, facing the room.
    const bank = makeCRTBank(4, {
      case: mat({ color: 0xb4ae9a, roughness: 0.6 }),
      dark: blackPlastic,
      lamp: mat({ color: 0x40ff90, emissive: 0x30c070 }),
    });
    const bankZ = -2.3 - 0.02 - 0.25;
    place(bank, 17.2, 0.76, bankZ, Math.PI);
    const screens = bank.userData.screens;
    // The pictures themselves are rendered live by the CCTV system (cctv.js),
    // which gives these screens their tube shader. This canvas is only what a
    // recorder burns in over the top: camera, room, REC, the time.
    const SCREEN_PX_W = 256;
    const SCREEN_PX_H = 200;
    const live = liveCanvas(SCREEN_PX_W * 4, SCREEN_PX_H);
    live.texture.minFilter = THREE.LinearFilter;
    live.texture.generateMipmaps = false;
    const blank = new THREE.MeshBasicMaterial({ color: 0x050807 });
    const screenMeshes = screens.map((s, i) => {
      const geo = new THREE.PlaneGeometry(s.w, s.h);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 4);
      const m = new THREE.Mesh(geo, blank);
      m.position.set(s.x, s.y, s.z);
      m.userData.keepUVs = true;
      m.userData.noShadow = true;
      bank.add(m);
      return m;
    });
    let frame = 0;
    const drawFeed = (ctx, i, view) => {
      const x0 = i * SCREEN_PX_W;
      const W = SCREEN_PX_W;
      const H = SCREEN_PX_H;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, W, H);
      ctx.clip();
      ctx.clearRect(x0, 0, W, H);
      ctx.translate(x0, 0);
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 3;
      ctx.font = `500 17px ${MONO_FONT}`;
      ctx.fillStyle = '#d8f8e4';
      ctx.fillText(`CAM ${i + 1}`, 12, 26);
      ctx.fillText(view ? view.label.slice(0, 15) : '', 12, 46);
      ctx.fillStyle = '#ff5a4a';
      if (frame % 2 === 0) {
        ctx.beginPath();
        ctx.arc(W - 50, 20, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#d8f8e4';
      ctx.fillText('REC', W - 40, 26);
      ctx.font = `500 14px ${MONO_FONT}`;
      ctx.fillText(`NOV 03 87  ${game.clock ? game.clock.label : '11:47 PM'}`, 12, H - 14);
      if (view?.attendant) {
        // Under REC: the timestamp owns the whole bottom line.
        ctx.fillStyle = '#ffb066';
        ctx.textAlign = 'right';
        ctx.fillText('MOTION', W - 12, 46);
        ctx.textAlign = 'left';
      }
      if (view?.anomaly && frame % 3 !== 0) {
        ctx.fillStyle = '#ff4d6b';
        ctx.font = `600 18px ${MONO_FONT}`;
        ctx.fillText('> ' + view.anomaly, 12, 70);
      }
      ctx.restore();
    };
    refs.monitors = {
      mesh: bank,
      live,
      screens: screenMeshes,
      redraw: () => {
        frame++;
        const views = game.cameraViews ?? [];
        for (let i = 0; i < 4; i++) drawFeed(live.ctx, i, views[i]);
        live.texture.needsUpdate = true;
      },
    };
    refs.monitors.redraw();
    refs.panels.push(refs.monitors);

    level.addInteractable({
      id: 'int_monitors',
      position: new THREE.Vector3(17.2, 1.05, bankZ - 0.3),
      radius: 2.6,
      prompt: () => 'Watch the monitors',
      use: () => game.watchMonitors(),
    });

    // The PA microphone: send him somewhere he is not.
    const mic = makeDeskMic({ dark: blackPlastic, metal: chrome, lamp: mat({ color: 0xff3020, emissive: 0x801008 }) });
    place(mic, 15.45, 0.76, -3.0, Math.PI + 0.3);
    level.addInteractable({
      id: 'int_pamic',
      position: new THREE.Vector3(15.45, 1.0, -3.05),
      radius: 2.2,
      prompt: () => 'Use the PA microphone',
      use: () => game.usePAMic(),
    });

    // The keyring on its hook by the door.
    const hookPlate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.14), woodMat);
    hookPlate.position.set(22.685, 1.62, -6.5);
    level.group.add(hookPlate);
    cyl(22.645, 1.635, -6.5, 0.008, 0.05, chrome, false, 6).rotation.z = Math.PI / 2;
    const ring = new THREE.Group();
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.007, 8, 24), brass);
    ring.add(ringMesh);
    const keyMat = brass;
    for (let k = 0; k < 5; k++) {
      const key = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.004), keyMat);
      const a = -Math.PI / 2 + (k - 2) * 0.35;
      key.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.075 - 0.03, 0);
      key.rotation.z = a + Math.PI / 2;
      ring.add(key);
    }
    ring.position.set(22.6, 1.6, -6.5);
    ring.rotation.y = Math.PI / 2;
    level.group.add(ring);

    const ringIt = level.addInteractable({
      id: 'int_keyring',
      position: new THREE.Vector3(22.5, 1.6, -6.5),
      radius: 2.0,
      prompt: () => (game.attendantHasRing() ? 'The hook is empty' : "Take Walter's keyring"),
      use: () => {
        if (game.attendantHasRing()) {
          game.toast('He is carrying it tonight.');
          game.note('Keyring', 'If Walter is carrying the ring, the hook in Security is empty. Wait for his rounds.');
          return;
        }
        game.state.run.hasKeyring = true;
        ring.visible = false;
        ringIt.enabled = false;
        game.audio.keyJingle();
        game.makeNoise(22.5, -6.5, 0.5, 'the keyring');
        game.toast("Walter's keyring. It will not stop jingling.");
        game.note('Keyring', 'The keyring hangs in Security. It opens the stamp drawer, the lockers, the service door.');
      },
      onReset: () => {
        ring.visible = true;
        ringIt.enabled = true;
      },
    });
    refs.keyringMesh = ring;
    // While he has it on his rounds, the hook is visibly empty.
    refs.animated.push(() => {
      if (!ringIt.enabled) return;
      ring.visible = !game.attendantHasRing();
    });

    cellPack('int_cells_cctv', 18.9, 0.76, -3.05, 'Spare cells sit on the security desk.', 0.4);

    paper('int_pascript', 16.25, 0.762, -3.0, -0.15, 'pascript', {
      prompt: 'Read the PA scripts',
      flat: true,
      w: 0.24, h: 0.32,
      onRead: () => {
        game.note('PA', 'One PA script has your own name typed into it. The ink is fresh.');
        game.note('Rules', 'A script in Walter\'s hand reads: "Do not answer to your name."');
      },
    });

    level.addLight(17, ROOMS.cctv.h - 0.3, -6, { intensity: 0.5, distance: 10, room: 'cctv', color: 0xa8d8c0, flicker: 0.3 });
  })();

  // ---- Diner Counter -----------------------------------------------------

  (function diner() {
    // The counter: a panelled front on the customer side, a laminate top with
    // a chrome edge, and a footrail.
    level.box(17, 3.0, 9.0, 1.0, 1.05, 0, woodMat);
    level.box(17, 3.0, 9.2, 1.12, 0.05, 1.05, laminate, { ghost: true });
    level.box(17, 3.56, 9.2, 0.03, 0.05, 1.05, chrome, { ghost: true });
    level.box(17, 3.6, 8.8, 0.04, 0.04, 0.22, chrome, { ghost: true });
    for (let x = 13.0; x <= 21.0; x += 2.0) level.box(x, 3.56, 0.03, 0.08, 0.2, 0.05, chrome, { ghost: true });

    // Stools along the customer side.
    const stoolMats = { metal: chrome, seat: redVinyl };
    for (const sx of [13.3, 15.0, 16.7, 18.4, 20.1]) {
      place(makeStool(stoolMats), sx, 0, 4.3, sx * 1.3, [sx - 0.21, 4.09, sx + 0.21, 4.51, 0.82]);
    }

    // The back bar: a low cabinet under a menu board.
    level.box(17, 0.3 + 0.27, 6.0, 0.54, 0.9, 0, paint(0x4a3a30, 0.8));
    level.box(17, 0.3 + 0.28, 6.1, 0.58, 0.04, 0.9, laminate, { ghost: true });
    textPanel(17, 2.05, 0.32, 0, 2.6, 0.9, 1024, 354, (ctx, w, h) => {
      ctx.fillStyle = '#16120f';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#a8865a';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = '#e8d8b0';
      ctx.textAlign = 'center';
      ctx.font = `700 64px ${SIGN_FONT}`;
      ctx.fillText('GRAYHOLLOW GRILL', w / 2, 84);
      ctx.font = `500 34px ${SIGN_FONT}`;
      const items = [
        ['COFFEE', '.45'], ['PIE, BY THE SLICE', '.95'], ['GRILLED CHEESE', '1.25'],
        ['SOUP OF THE DAY', '1.10'], ['EGGS ANY STYLE', '1.75'], ['HOT CHOCOLATE', '.60'],
      ];
      items.forEach(([name, price], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 60 + col * (w / 2);
        const y = 160 + row * 58;
        ctx.textAlign = 'left';
        ctx.fillText(name, x, y);
        ctx.textAlign = 'right';
        ctx.fillText(price, x + w / 2 - 110, y);
      });
      ctx.textAlign = 'center';
      ctx.fillStyle = '#a8865a';
      ctx.font = `500 26px ${SIGN_FONT}`;
      ctx.fillText('OPEN UNTIL THE LAST BUS', w / 2, h - 30);
    }, { lit: true, roughness: 0.6 });

    level.addHideSpot({
      id: 'hide_counter',
      name: 'behind the counter',
      position: new THREE.Vector3(17, 0, 1.9),
      exit: new THREE.Vector3(15.6, 0, 1.6),
      lookYaw: Math.PI,
      quality: 0.85,
      promptName: 'Hide behind the counter',
    });

    // Vending machines: coins out, but they are loud.
    const vendingDefs = [
      { id: 'vend1', x: 12.1, z: 8.4, color: 0x7a2a22, label: 'COLA', ink: '#c8281e' },
      { id: 'vend2', x: 12.1, z: 7.1, color: 0x22407a, label: 'SNACKS', ink: '#22407a' },
    ];
    for (const v of vendingDefs) {
      // These are the only things in the station lit from inside, so they are
      // the one place the player can stand and see without the flashlight.
      const unit = makeVending({
        body: paint(v.color),
        dark: darkMetal,
        glass: shiny(mat({ color: 0xbfe4ee, emissive: 0x16323a, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22 }), 1),
        product: mat({ color: 0x8a7a5a, roughness: 0.6 }),
        light: mat({ color: 0xd8e8e0, emissive: 0x3a4a46 }),
      });
      // Built facing +z; against the diner's west wall it has to face +x.
      place(unit, v.x, 0, v.z, Math.PI / 2, [v.x - 0.36, v.z - 0.48, v.x + 0.36, v.z + 0.48, 1.85]);
      // The lit header card.
      textPanel(v.x + 0.36, 1.725, v.z + 0.06, Math.PI / 2, 0.56, 0.14, 256, 64, (ctx, w, h) => {
        ctx.fillStyle = '#eef2ee';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = v.ink;
        ctx.font = `700 50px ${SIGN_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(v.label, w / 2, 50);
      }, { glow: 0.9 });
      let used = false;
      level.addInteractable({
        id: 'int_' + v.id,
        position: new THREE.Vector3(v.x + 0.5, 1.2, v.z),
        radius: 2.2,
        prompt: () => (used ? 'The coin return is empty' : 'Hit the coin return'),
        use: () => {
          if (used) return;
          used = true;
          game.state.run.coins++;
          game.audio.vendingClunk();
          game.makeNoise(v.x, v.z, 0.85, 'a vending machine');
          game.toast(`A 1987 coin rolls out. (${game.state.run.coins})`);
          game.note('Coins', 'Both vending machines in the diner give up a coin. They clunk; he hears it.');
        },
        onReset: () => {
          used = false;
        },
      });
      // Cold machine glow from inside the carcass.
      level.addLight(v.x - 0.12, 1.0, v.z, {
        intensity: 0.1, distance: 2.4, decay: 1.4,
        color: 0x9fd8ff, room: 'diner', flicker: 0.15, fixtureW: 0.25,
      });
    }

    // The jukebox, against the east wall.
    const jx = 22.7 - 0.34;
    const jz = 7.5;
    const juke = makeJukebox({
      body: paint(0x5a2030, 0.6),
      chrome,
      glow: mat({ color: 0xffb070, emissive: 0xff7a30, emissiveIntensity: 1.6 }),
      dark: darkGlass,
    });
    place(juke, jx, 0, jz, -Math.PI / 2, [jx - 0.34, jz - 0.5, 22.7, jz + 0.5, 1.75]);
    const jp = juke.userData.panel;
    const jukePanel = textPanel(jx - jp.z, jp.y, jz + jp.x, -Math.PI / 2, jp.w, jp.h, 384, 216, (ctx, w, h) => {
      ctx.fillStyle = '#20141a';
      ctx.fillRect(0, 0, w, h);
      const labels = [['A1', 'BLUE HIGHWAY'], ['A2', 'LAST CALL FOR EVERYTHING'], ['B3', 'HOLLOW MOON']];
      labels.forEach(([code, title], i) => {
        const y = 14 + i * 66;
        ctx.fillStyle = '#efe4c4';
        ctx.fillRect(14, y, w - 28, 56);
        ctx.fillStyle = '#b02a20';
        ctx.fillRect(14, y + 27, w - 28, 2);
        ctx.font = `700 26px ${SIGN_FONT}`;
        ctx.fillStyle = game.state?.run.jukeboxPlayed && i === 2 ? '#1a7a48' : '#2a1a14';
        ctx.fillText(code, 24, y + 22);
        ctx.font = `600 24px ${SIGN_FONT}`;
        ctx.fillText(title, 70, y + 22);
        ctx.font = `500 16px ${SIGN_FONT}`;
        ctx.fillStyle = '#6a4a3a';
        ctx.fillText(i === 2 ? 'M. VANCE' : i === 1 ? 'THE NIGHT SHIFT' : 'R. TEAGUE & THE HAULERS', 70, y + 48);
      });
    }, { glow: 0.8 });
    level.addInteractable({
      id: 'int_jukebox',
      position: new THREE.Vector3(jx - 0.4, 1.1, jz),
      radius: 2.2,
      prompt: () => 'Use the jukebox',
      use: () => game.useJukebox(jukePanel.redraw),
      redraw: jukePanel.redraw,
    });
    refs.jukeboxPos = new THREE.Vector3(jx, 1.1, jz);

    // Coffee pot and batteries on the staff side of the counter.
    place(makeCoffeePot({
      dark: blackPlastic,
      metal: chrome,
      glass: shiny(mat({ color: 0x9fb0a8, roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false }), 1.2),
      coffee: mat({ color: 0x1a0e08, roughness: 0.15 }),
    }), 19.4, 1.1, 2.75, 0.4);
    level.addInteractable({
      id: 'int_coffeepot',
      position: new THREE.Vector3(19.4, 1.25, 2.75),
      radius: 1.9,
      prompt: () => 'The coffee pot',
      use: () => {
        game.audio.blip({ freq: 300, type: 'sine', dur: 0.2, vol: 0.08 });
        game.inspect(coffeeTarget);
      },
    });
    // Looking at it is leaning over the counter to the pot and the cup.
    const coffeeTarget = {
      label: 'Coffee Pot',
      view: aimView(new THREE.Vector3(19.05, 1.2, 3.0), 0.5),
      caption: 'Still warm. It has been still warm since 1987. There is one cup poured, on the counter, with a saucer over it to keep the heat in. Someone meant to come back for it.',
    };
    // The cup, with the saucer over it.
    cyl(18.7, 1.1, 3.25, 0.045, 0.09, porcelain, false, 18);
    cyl(18.7, 1.19, 3.25, 0.075, 0.01, porcelain, false, 20);
    // Sugar pourer and a napkin dispenser for the look of the counter.
    cyl(14.6, 1.1, 3.2, 0.035, 0.11, glass, false, 14);
    cyl(14.6, 1.21, 3.2, 0.028, 0.03, chrome, false, 12);
    level.box(16.1, 3.2, 0.12, 0.08, 0.12, 1.1, chrome, { ghost: true });

    cellPack('int_batteries', 20.4, 1.1, 2.72, 'Spare cells sit on the diner counter.', -0.3);

    coin('coin_diner', 16.6, 1.1, 3.15, 'A coin was left on the diner counter.');

    level.addLight(17, ROOMS.diner.h - 0.3, 3, { intensity: 0.75, distance: 12, room: 'diner' });
    level.addLight(17, ROOMS.diner.h - 0.3, 7.5, { intensity: 0.6, distance: 11, room: 'diner', flicker: 0.25 });
  })();

  // ---- Restrooms ---------------------------------------------------------

  (function restroom() {
    // Three stalls along the north wall, with raised partitions, pilasters
    // and doors left standing open. The basins and the mirror are on the east
    // wall; they used to be on the south wall, with the mirror hanging across
    // the doorway.
    const partMat = paint(0x3a5048, 0.6);
    const zFront = 17.6;
    const zBack = 19.7;
    const partitions = [-11.0, -9.3, -7.6];
    const stallEdges = [-12.7, ...partitions];
    const stall = new Build();
    for (const px of partitions) {
      stall.box(0.035, 1.82, zBack - zFront, { x: px, y: 0.2 + 0.91, z: (zFront + zBack) / 2 }, 'part');
      level.addCollider(px - 0.03, zFront, px + 0.03, zBack, 2.05, 0.2);
    }
    // Headrail along the front, and a pilaster at every partition.
    stall.box(-7.6 - -12.7 + 0.06, 0.05, 0.05, { x: (-12.7 - 7.6) / 2, y: 2.05, z: zFront }, 'metal');
    for (const px of partitions) stall.box(0.06, 2.05, 0.06, { x: px, y: 1.025, z: zFront }, 'part');
    const doorW = 0.78;
    for (let i = 0; i < 3; i++) {
      const x1 = stallEdges[i];
      const x2 = stallEdges[i + 1];
      // Fixed front panel, then the door opening at the east end of the stall.
      const panelW = (x2 - x1) - doorW - 0.03;
      stall.box(panelW, 1.82, 0.035, { x: x1 + panelW / 2, y: 0.2 + 0.91, z: zFront }, 'part');
      level.addCollider(x1, zFront - 0.03, x1 + panelW, zFront + 0.03, 2.05, 0.2);
      // The door, hinged on the panel's edge and standing open into the stall.
      // Swung nearly flat against the inside of the panel line, so the
      // opening stays wide enough to walk through.
      const hinge = x1 + panelW;
      const open = 1.62 + i * 0.05;
      const leaf = new THREE.BoxGeometry(doorW - 0.02, 1.82, 0.03);
      leaf.translate((doorW - 0.02) / 2, 0.2 + 0.91, 0);
      leaf.rotateY(-open);
      leaf.translate(hinge + 0.015, 0, zFront);
      stall.geo(leaf, {}, 'part');
      const tipX = hinge + 0.015 + Math.cos(open) * (doorW - 0.02);
      level.addCollider(Math.min(hinge, tipX) - 0.02, zFront, Math.max(hinge, tipX) + 0.03, zFront + Math.sin(open) * (doorW - 0.02), 2.05, 0.2);
      // Toilet, against the back wall.
      const cx = (x1 + x2) / 2;
      level.addHideSpot({
        id: 'hide_stall_' + i,
        name: 'a stall',
        position: new THREE.Vector3(cx - 0.15, 0, 18.75),
        exit: new THREE.Vector3(x2 - doorW / 2 - 0.05, 0, 16.9),
        lookYaw: 0,
        quality: 1.0,
        promptName: 'Hide in the stall',
      });
      const wc = makeToilet({ porcelain, seat: mat({ color: 0x1e2424, roughness: 0.4 }), chrome });
      place(wc, cx - 0.1, 0, zBack - 0.39, Math.PI, [cx - 0.33, zBack - 0.7, cx + 0.13, zBack, 0.42]);
    }
    place(stall.build({ part: partMat, metal: chrome }), 0, 0, 0);

    // The note from Sister Ruiz, taped inside the end stall.
    paper('int_handwritten', -7.64, 1.5, 18.6, -Math.PI / 2, 'handwritten', {
      prompt: 'Read the handwritten sign',
      w: 0.28, h: 0.36,
      style: 'note',
      onRead: () => {
        game.note('Rules', 'A handwritten sign: two of the posted rules are not the station\'s. "One wants you blind. One wants you lit up."');
      },
    });

    // Basins along the east wall, and the mirror over them.
    const vanityZ = 13.6;
    const vanity = makeVanity(3, { counter: paint(0x9a9a8c, 0.4), porcelain, chrome });
    place(vanity, -1.3 - 0.29, 0, vanityZ, -Math.PI / 2, [-1.9, vanityZ - 1.68, -1.3, vanityZ + 1.68, 0.92]);
    const mirrorW = 3.2;
    const mirrorH = 1.1;
    level.box(-1.31, vanityZ, 0.02, mirrorW + 0.06, mirrorH + 0.06, 1.72 - mirrorH / 2 - 0.03, chrome, { ghost: true });
    const mirror = textPanel(-1.32 - 0.004, 1.72, vanityZ, -Math.PI / 2, mirrorW, mirrorH, 1024, 352, (ctx, w, h) => {
      // Dark glass with a dim smear of the room in it: the band of the
      // opposite wall, the bright stroke of a tube, the floor falling away.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a2422');
      g.addColorStop(0.35, '#2b3a36');
      g.addColorStop(0.62, '#1e2a28');
      g.addColorStop(1, '#0d1312');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(220,240,230,0.35)';
      ctx.fillRect(w * 0.18, h * 0.08, w * 0.3, 6);
      ctx.fillStyle = 'rgba(160,190,180,0.08)';
      for (let x = 0; x < w; x += 22) ctx.fillRect(x, h * 0.15, 1, h * 0.45);
      // Silvering lost at the edges, and spots of tarnish.
      for (let i = 0; i < 900; i++) {
        const edge = Math.random() < 0.6;
        const x = edge ? (Math.random() < 0.5 ? Math.random() * 60 : w - Math.random() * 60) : Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(${10 + Math.random() * 30 | 0},${16 + Math.random() * 30 | 0},${14 + Math.random() * 20 | 0},${0.15 + Math.random() * 0.3})`;
        ctx.fillRect(x, y, 2 + Math.random() * 5, 1 + Math.random() * 3);
      }
      // Something standing in the room behind you. The mirror shows it long
      // before you can turn around, and it is never there when you do.
      if (game.mirrorFigure) {
        const f = game.mirrorFigure;
        silhouette(ctx, w * (f.at ?? 0.68), h - 2, h * (f.scale ?? 0.92) * 1.05, {
          tilt: f.tilt ?? 0,
          eyes: f.eyes ?? false,
          color: `rgba(3,5,7,${f.alpha ?? 0.9})`,
        });
      }
      if (game.mirrorRevealing) {
        ctx.fillStyle = '#9fe8c0';
        ctx.font = `600 34px ${SIGN_FONT}`;
        ctx.fillText('THE WALL, REVERSED:', 30, 56);
        ctx.fillStyle = '#ff6b6b';
        ctx.font = `600 30px ${MONO_FONT}`;
        ctx.fillText('RULE: DEPARTURE BOARD ...... FALSE', 30, 112);
        ctx.fillText('RULE: FLASHLIGHT LIT ....... FALSE', 30, 156);
      }
      // A sheen across the glass.
      const s = ctx.createLinearGradient(0, 0, w, h);
      s.addColorStop(0.3, 'rgba(255,255,255,0)');
      s.addColorStop(0.45, 'rgba(255,255,255,0.05)');
      s.addColorStop(0.6, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, w, h);
    }, { glow: 0.7 });
    refs.mirror = mirror;
    refs.mirrorTarget = readTarget(mirror, mirrorW, mirrorH, 'The Mirror', { scale: 2 });

    level.addInteractable({
      id: 'int_mirror',
      position: new THREE.Vector3(-1.4, 1.6, vanityZ),
      facing: faceOf(mirror.mesh),
      radius: 2.6,
      prompt: () => 'Look in the mirror',
      use: () => game.useMirror(),
    });

    // A paper towel dispenser and a hand dryer by the basins.
    level.box(-1.36, 16.0, 0.12, 0.3, 0.38, 1.25, chrome, { ghost: true });
    level.box(-1.36, 11.3, 0.14, 0.28, 0.24, 1.2, mat({ color: 0xb8b8b0, roughness: 0.4 }), { ghost: true });

    // On the counter between the first two basins.
    coin('coin_restroom', -1.74, 0.86, vanityZ - 0.52, 'Someone left a coin on the restroom sink.');

    level.addLight(-6.0, ROOMS.restroom.h - 0.25, 12.8, { intensity: 0.7, distance: 11, room: 'restroom', flicker: 0.75, color: 0xcfe8d8 });
    level.addLight(-9.5, ROOMS.restroom.h - 0.25, 16.2, { intensity: 0.5, distance: 10, room: 'restroom', flicker: 0.9 });
  })();

  // ---- Baggage Claim -----------------------------------------------------

  (function baggage() {
    // The baggage belt, with the flap hood the luggage disappears through.
    const conveyor = makeConveyor(14, {
      body: paint(0x2a2e30, 0.8),
      belt: mat({ color: 0x141618, roughness: 0.75 }),
      metal: chrome,
      dark: blackPlastic,
      rubber: mat({ color: 0x0d0e0f, roughness: 0.6, side: THREE.DoubleSide }),
    });
    place(conveyor, 11, 0, 18.5, 0, [4.0, 17.65, 18.0, 19.35, 0.8]);
    refs.beltPos = new THREE.Vector3(11, 0.8, 18.5);

    // One suitcase on the belt. Starting the belt sends it round.
    const caseMats = {
      case: mat({ color: 0x5a3a26, roughness: 0.55 }),
      trim: chrome,
      tag: paperMat,
    };
    const caseHolder = new THREE.Group();
    // Lying flat on the belt, handle towards you.
    const suitcase = new THREE.Group();
    suitcase.rotation.x = -Math.PI / 2;
    suitcase.position.set(0, 0.12, 0.284);
    caseHolder.add(suitcase);
    game.models.fill(suitcase, 'suitcase_b', {
      fallback: () => {
        const old = makeSuitcase(caseMats);
        old.rotation.x = -Math.PI / 2;
        old.position.set(0, 0.1, 0.22);
        caseHolder.add(old);
      },
    });
    place(caseHolder, 14.5, 0.72, 18.5, 0.2);
    let beltTime = 0;
    refs.animated.push((dt) => {
      if (beltTime <= 0) return;
      beltTime -= dt;
      caseHolder.position.x -= dt * 0.55;
      // Through the flaps, and round again.
      if (caseHolder.position.x < 4.9) caseHolder.position.x = 17.4;
      caseHolder.visible = caseHolder.position.x > 4.95;
      if (beltTime <= 0) game.audio.stopConveyorBoost?.();
    });
    refs.conveyor = {
      start: () => {
        beltTime = 24;
        game.audio.boostConveyor?.(24);
      },
      reset: () => {
        beltTime = 0;
        caseHolder.position.x = 14.5;
        caseHolder.visible = true;
      },
    };

    level.addHideSpot({
      id: 'hide_conveyor',
      name: 'behind the conveyor',
      position: new THREE.Vector3(11, 0, 20.3),
      exit: new THREE.Vector3(11, 0, 21.5),
      lookYaw: 0,
      quality: 0.9,
      promptName: 'Hide behind the conveyor',
    });

    level.addInteractable({
      id: 'int_conveyor',
      position: new THREE.Vector3(18.3, 1.1, 19.62),
      radius: 2.6,
      prompt: () => 'Start the baggage belt',
      use: () => {
        game.audio.vendingClunk();
        game.makeNoise(11, 18.5, 0.7, 'the conveyor');
        refs.conveyor.start();
        game.showDocument('Conveyor Belt', [
          'You push the lever. The belt shudders and starts to move.',
          'A single suitcase comes around, goes through the flaps, and comes around again.',
          'It has a tag on it with your name and tonight\'s date.',
        ], null, { style: 'panel' });
        game.note('Baggage', 'A suitcase on the belt is tagged with your own name.');
      },
      onReset: () => refs.conveyor.reset(),
    });
    // The control post with its lever, at the head of the belt.
    const post = new Build();
    post.box(0.22, 1.0, 0.22, { y: 0.5 }, 'body');
    post.box(0.04, 0.22, 0.04, { y: 1.1, z: 0.04, rx: 0.4 }, 'metal');
    post.sphere(0.035, { y: 1.2, z: 0.08 }, 'knob');
    place(post.build({ body: paint(0xc8a028, 0.7), metal: chrome, knob: blackPlastic }), 18.3, 0, 19.62, Math.PI, [18.18, 19.5, 18.42, 19.74, 1.1]);

    // Tall lockers along the west wall, by the door: one with a letter lock
    // holds the conductor's punch, three are big enough to climb into. They
    // used to stand right across the doorway, which walled off the whole wing.
    const LOCKERS = 6;
    const LW = 0.62;
    const lz = 15.0;
    const lockerBank = makeLockers(LOCKERS, 1, {
      body: paint(0x3e4c45),
      door: paint(0x4a5a52),
      metal,
    }, { cw: LW, ch: 1.95, d: 0.6, vent: { y: 1.17, h: 0.16, w: 0.62 } });
    place(lockerBank, 1.3 + 0.3, 0, lz, Math.PI / 2, [1.3, lz - (LOCKERS * LW) / 2, 1.92, lz + (LOCKERS * LW) / 2, 1.95]);
    // Locker c's centre along z: the bank is turned so its local +x runs -z.
    const lockerZ = (c) => lz + (LOCKERS * LW) / 2 - LW / 2 - c * LW;
    for (let c = 0; c < LOCKERS; c++) {
      const n = 4 + c;
      textPanel(1.912, 1.86, lockerZ(c) + 0.21, Math.PI / 2, 0.075, 0.045, 64, 40, (ctx, w, h) => {
        ctx.fillStyle = '#c8c0a0';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1a1a16';
        ctx.textAlign = 'center';
        ctx.font = `700 36px ${SIGN_FONT}`;
        ctx.fillText(String(n), w / 2, 33);
      }, { lit: true, roughness: 0.4 });
    }
    for (let c = 0; c < 3; c++) {
      level.addHideSpot({
        id: 'hide_locker_' + c,
        name: 'a locker',
        position: new THREE.Vector3(1.62, 0, lockerZ(c)),
        exit: new THREE.Vector3(2.55, 0, lockerZ(c)),
        lookYaw: -Math.PI / 2,
        quality: 1.0,
        promptName: 'Climb into the locker',
        enclosed: true,
      });
    }
    // Locker 9's letter lock: four brass dials by the handle.
    const codeZ = lockerZ(LOCKERS - 1);
    const dial = new Build();
    dial.box(0.03, 0.06, 0.13, { }, 'plate');
    for (let k = 0; k < 4; k++) dial.cyl(0.012, 0.012, 0.022, 10, { x: 0.02, z: -0.045 + k * 0.03, rz: Math.PI / 2 }, 'dial');
    // Under the handle: the vent takes the door at eye height.
    place(dial.build({ plate: darkMetal, dial: brass }), 1.93, 0.86, codeZ - 0.12, 0);

    let punchTaken = false;
    level.addInteractable({
      id: 'int_codelocker',
      position: new THREE.Vector3(2.0, 0.95, codeZ),
      radius: 2.2,
      prompt: () => {
        if (punchTaken) return 'Locker 9 is empty';
        return game.state.knowsCode('locker')
          ? `Enter ${game.state.persistent.knownCodes.locker} on the dials`
          : 'Locker 9: turn the letter dials';
      },
      use: () => {
        if (punchTaken) return;
        const open = () => {
          punchTaken = true;
          game.state.run.hasPunch = true;
          game.audio.lockClick(true);
          game.toast("The conductor's punch.");
          game.note('Ticket', "The conductor's punch is in Locker 9. The code is spelled by the cancelled routes.");
        };
        // Known from an earlier night: the hands do it without you.
        if (game.state.persistent.knownCodes.locker === LOCKER_CODE) {
          open();
          return;
        }
        game.note('Locker', 'Locker 9 in Baggage Claim has a four-letter dial lock.');
        game.openDials({
          title: 'Locker 9',
          text: 'Four brass dials under the handle, A to Z, stiff with grease. Someone has scratched a 9 beside them, and under it: WHAT WAS CANCELLED.',
          onTry: (word) => {
            if (word === LOCKER_CODE) {
              if (game.state.learnCode('locker', word)) game.note('Locker', `Locker 9 opens to ${word}.`);
              open();
              return true;
            }
            game.audio.lockClick(false);
            // A rattled handle carries.
            game.makeNoise(2.0, codeZ, 0.28, 'a locker handle rattling');
            return false;
          },
        });
      },
      onReset: () => {
        punchTaken = false;
      },
    });

    // Luggage carts, and the unclaimed cases stacked along the north wall.
    const cartMats = { metal, dark: blackPlastic };
    place(makeLuggageCart(cartMats), 16.2, 0, 12.6, 0.25, [15.4, 12.0, 17.0, 13.2, 1.05]);
    place(makeLuggageCart(cartMats), 18.7, 0, 21.4, -0.4, [17.9, 20.8, 19.5, 22.0, 1.05]);
    cellPack('int_cells_cart', 16.2, 0.345, 12.6, 'Spare cells sit in a baggage cart.', 0.5);
    const stack = [
      [14.2, 23.3, 0.0, 0x3a2a20], [14.9, 23.3, 0.0, 0x2a3440], [14.5, 23.32, 0.44, 0x4a3a2a],
      [6.2, 23.3, 0.0, 0x352a24], [6.9, 23.35, 0.0, 0x2e2e2a],
    ];
    for (const [i, [sx, sz, sy, col]] of stack.entries()) {
      // Scanned cases lying flat, each a slightly different leather. The
      // stacked one sits a case's thickness up.
      const g = new THREE.Group();
      place(g, sx, sy ? 0.24 : 0, sz, Math.PI + (sx % 0.3));
      const flat = new THREE.Group();
      flat.rotation.x = -Math.PI / 2;
      flat.position.set(0, 0.12, 0.284);
      g.add(flat);
      game.models.fill(flat, i % 2 ? 'suitcase_a' : 'suitcase_b', {
        tint: new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.72),
        fallback: () => {
          g.position.y = sy;
          g.add(makeSuitcase({ case: mat({ color: col, roughness: 0.6 }), trim: chrome, tag: paperMat }));
        },
      });
    }
    level.addCollider(5.8, 23.0, 7.3, 23.7, 0.5);
    level.addCollider(13.8, 23.0, 15.3, 23.7, 0.9);

    // A hanging sign over the belt.
    doorSign(11, 2.9, 18.5, Math.PI, 'CAROUSEL 1 · COAST SERVICES', 'case', 3.2);
    for (const hx of [9.6, 12.4]) cyl(hx, 3.07, 18.545, 0.012, ROOMS.baggage.h - 3.07, chrome, false, 6);

    // Service door to the tunnel.
    level.addInteractable({
      id: 'int_tunneldoor',
      position: new THREE.Vector3(20.6, 1.3, 17),
      radius: 2.4,
      enabledWhen: () => level.isLocked('tunnelDoor'),
      prompt: () => {
        if (!game.state.persistent.tunnelFound) return 'A painted-over service door';
        return game.state.run.hasKeyring ? 'Unlock the service door' : 'Service door (locked)';
      },
      use: () => {
        if (!level.isLocked('tunnelDoor')) return;
        if (!game.state.persistent.tunnelFound) {
          game.toast('Painted over. There is no handle on this side that you can see.');
          return;
        }
        if (!game.state.run.hasKeyring) {
          game.audio.lockClick(false);
          game.toast("Locked. Walter's ring would open it.");
          return;
        }
        if (level.unlockDoor('tunnelDoor')) {
          game.audio.lockClick(true);
          game.audio.doorCreak?.();
          game.audio.cutHum(2.5);
          game.toast('The service door swings in. Cold air.');
          game.note('Station', 'The service door behind Baggage Claim leads to a maintenance tunnel.');
        }
      },
    });

    level.addLight(6, ROOMS.baggage.h - 0.3, 13, { intensity: 0.8, distance: 13, room: 'baggage' });
    level.addLight(14, ROOMS.baggage.h - 0.3, 15.5, { intensity: 0.7, distance: 13, room: 'baggage' });
    level.addLight(10, ROOMS.baggage.h - 0.3, 21.5, { intensity: 0.65, distance: 12, room: 'baggage' });
  })();

  // ---- Maintenance Tunnel + Bay 0 ---------------------------------------

  // A shallow puddle: a near-black mirror on the floor that catches whatever
  // light there is.
  const puddleMat = shiny(mat({ color: 0x0b0e0e, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false }), 0.35);
  function puddle(x, z, w, d, rot = 0) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 28), puddleMat);
    m.scale.set(w, d, 1);
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(x, 0.004, z);
    m.userData.noShadow = true;
    m.renderOrder = 1;
    level.group.add(m);
  }

  // A bus. Bay 9's is the one on the board; Bay 0's is not on any board.
  function bus(x, z, rotY, colors, signDraw) {
    const b = makeBus({
      body: paint(colors.body, 0.6),
      trim: paint(colors.trim, 0.6),
      glass: darkGlass,
      dark: blackPlastic,
      tire: mat({ color: 0x111214, roughness: 0.85 }),
      chrome,
      lamp: mat({ color: 0xd8d0b0, emissive: colors.lamp, roughness: 0.2 }),
      tail: mat({ color: 0x5a0e0a, emissive: 0x200402, roughness: 0.3 }),
    });
    place(b, x, 0, z, rotY);
    const sign = b.userData.sign;
    const panel = textPanel(sign.x, sign.y, sign.z, 0, sign.w, sign.h, 512, 64, signDraw, { glow: 0.85, parent: b.userData.shell });
    return { group: b, panel };
  }

  (function tunnelAndBay0() {
    // Pipes along the ceiling, hugging both walls, bracketed every couple of
    // metres. They run wall to wall and end in the masonry -- they used to stop
    // short and poke their open ends into the doorway.
    const pipes = new Build();
    const ceil = ROOMS.tunnel.h;
    for (const [pz, r] of [[14.55, 0.09], [14.82, 0.06], [19.45, 0.1]]) {
      const cy = ceil - 0.16 - r;
      pipes.cyl(r, r, 7.4, 12, { x: 25, y: cy, z: pz, rz: Math.PI / 2 }, 'pipe');
      for (let x = 22; x < 28.7; x += 2) {
        // A strap round the pipe and a hanger up into the slab.
        pipes.box(0.04, 0.03, r * 2 + 0.05, { x, y: cy - r - 0.015, z: pz }, 'bracket');
        pipes.box(0.03, ceil - cy, 0.03, { x, y: (ceil + cy) / 2, z: pz }, 'bracket');
      }
    }
    // A run of conduit down the wall by the light.
    pipes.box(0.04, 2.2, 0.04, { x: 24.4, y: 1.1, z: 19.66 }, 'bracket');
    place(pipes.build({ pipe: paint(0x4a3a2a, 0.8), bracket: darkMetal }), 0, 0, 0);
    level.addLight(25, 2.2, 17, { intensity: 0.22, distance: 6, room: 'tunnel', flicker: 0.95, color: 0xffb070, fixtureW: 0.6 });

    puddle(23.4, 15.4, 1.3, 0.8, 0.4);
    puddle(26.8, 18.6, 0.9, 1.5, -0.2);

    cellPack('int_cells_tunnel', 27.0, 0, 15.0, 'Spare cells lie on the tunnel floor.', 1.1);

    // Bay 0: the bus that is not on any map. It faces into the dark.
    refs.bay0Bus = bus(35, 2.0, Math.PI, { body: 0x15191e, trim: 0x3a1210, lamp: 0x3a2a10 }, (ctx, w, h) => {
      ctx.fillStyle = '#060706';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff7b4d';
      ctx.font = `600 40px ${MONO_FONT}`;
      ctx.textAlign = 'center';
      // A destination in a script you cannot read.
      ctx.fillText('⎡∵⧖∴⨝  ⋈∵⧗', w / 2, 46);
    }).group;
    level.addCollider(33.7, -3.75, 36.3, 7.7, 3.2);

    // The door is on the bus's right, which faces east here.
    level.addInteractable({
      id: 'int_bay0bus',
      position: new THREE.Vector3(36.45, 1.3, -2.7),
      radius: 2.8,
      prompt: () => 'Board the bus with no number',
      use: () => game.triggerEnding('bay0'),
    });
    // Where a number was painted out.
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat({ color: 0x26282a, roughness: 0.95 }));
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(35, 0.003, -6.0);
    level.group.add(patch);
    puddle(32.5, 1.5, 1.6, 1.0, 0.3);
    puddle(38.0, 9.5, 1.2, 2.0, 0.1);

    level.addLight(35, 4.4, 8, { intensity: 0.2, distance: 14, room: 'bay0', color: 0xff8a5a, flicker: 0.5 });
    level.addLight(35, 4.4, -4, { intensity: 0.14, distance: 12, room: 'bay0', color: 0xff6b4a, flicker: 0.7 });
  })();

  // ---- Gate corridor + Bus Bays -----------------------------------------

  (function bays() {
    level.addLight(0, ROOMS.gate.h - 0.3, -13, { intensity: 0.65, distance: 11, room: 'gate' });
    level.addLight(0, ROOMS.gate.h - 0.3, -19, { intensity: 0.5, distance: 11, room: 'gate', flicker: 0.5 });

    // Timetables framed on the corridor walls.
    const timetable = (x, z, rotY, title, rows) => {
      level.box(x, z, rotY === 0 || rotY === Math.PI ? 0.84 : 0.03, rotY === 0 || rotY === Math.PI ? 0.03 : 0.84, 1.14, 0.98, darkMetal, { ghost: true });
      const dx = Math.sin(rotY) * 0.02;
      textPanel(x + dx, 1.55, z, rotY, 0.76, 1.06, 384, 536, (ctx, w, h) => {
        ctx.fillStyle = '#d8d0b6';
        ctx.fillRect(0, 0, w, h);
        grime(ctx, w, h, 0.05, x * 3 + 7);
        ctx.fillStyle = '#1d2a33';
        ctx.fillRect(0, 0, w, 64);
        ctx.fillStyle = '#e8e2cf';
        ctx.font = `700 34px ${SIGN_FONT}`;
        ctx.fillText(title, 18, 44);
        ctx.font = `500 24px ${MONO_FONT}`;
        rows.forEach((r, i) => {
          ctx.fillStyle = r.mark ? '#8a1e14' : '#2b2620';
          ctx.fillText(r.t, 18, 104 + i * 34);
          if (r.mark) {
            ctx.strokeStyle = 'rgba(160,30,20,0.9)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(110, 96 + i * 34, 100, 18, -0.04, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      }, { lit: true, roughness: 0.6 });
    };
    timetable(-3.68, -14.5, Math.PI / 2, 'COAST LINE — NIGHT', [
      { t: '9:05 PM   BAY 3' }, { t: '9:40 PM   BAY 6' }, { t: '10:15 PM  BAY 1' },
      { t: '10:50 PM  BAY 4' }, { t: '11:20 PM  BAY 7' }, { t: '11:47 PM  BAY 9', mark: true },
      { t: '' }, { t: 'NO FURTHER SERVICE' }, { t: 'UNTIL 6:10 AM' }, { t: '' }, { t: '3:33 AM   BAY 9', mark: true },
    ]);
    timetable(3.68, -17.5, -Math.PI / 2, 'INLAND ROUTES', [
      { t: 'GLOVERSVILLE  2' }, { t: 'REDHILL       4' }, { t: 'ASHTON FORK   5' }, { t: 'WEST MERROW   3' },
      { t: 'YARROW BEND   6' }, { t: 'PINE JUNCTION 1' }, { t: '' }, { t: 'ALL SERVICES' }, { t: 'SUBJECT TO' }, { t: 'CANCELLATION' },
    ]);

    // The platform edge: a continuous kerb with a painted safety line, and
    // the canopy's columns standing along it.
    level.box(0, -25.4, 51.4, 0.4, 0.18, 0, mat({ color: 0x6a6a60, roughness: 0.9 }), { ghost: true });
    level.box(0, -25.25, 51.4, 0.08, 0.004, 0.18, mat({ color: 0xc8a030, roughness: 0.7 }), { ghost: true });
    const columnMats = { shaft: paint(0x40484a, 0.7), base: darkMetal };
    for (let i = 0; i < 8; i++) {
      const x = -19.25 + i * 5.5;
      place(makeColumn(0.16, ROOMS.bays.h, columnMats), x, 0, -24.9, 0, [x - 0.24, -25.14, x + 0.24, -24.66, ROOMS.bays.h]);
    }

    // Bay numbers 1..9 painted across the platform, 9 at the west end. They
    // are paint, so they are lit by the lamps like everything else -- they
    // used to glow in the dark.
    for (let i = 0; i < 9; i++) {
      const bay = 9 - i;
      const x = -22 + i * 5.5;
      const num = textPanel(x, 0.012, -24.0, 0, 2.0, 2.0, 256, 256, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = bay === 9 ? 'rgba(220,190,80,0.92)' : 'rgba(200,200,190,0.75)';
        ctx.font = `700 200px ${SIGN_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(bay), w / 2, 200);
        // Worn: tyre tracks have taken the paint in places.
        ctx.globalCompositeOperation = 'destination-out';
        for (let k = 0; k < 120; k++) {
          ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.7})`;
          ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 2 + Math.random() * 6);
        }
      }, { lit: true, transparent: true, roughness: 0.8 });
      num.mesh.rotation.set(-Math.PI / 2, 0, 0);
    }
    puddle(-9.0, -31.0, 2.4, 1.2, 0.2);
    puddle(4.0, -35.5, 1.6, 2.2, -0.4);
    puddle(15.5, -27.8, 1.2, 0.8, 0.0);
    puddle(-17.0, -33.0, 1.0, 1.6, 0.6);

    // The 3:33 sits at Bay 9, nose to the platform.
    const busZ = -31.3;
    const bay9 = bus(-22, busZ, 0, { body: 0x3c4a52, trim: 0x8a2a1e, lamp: 0x8a8060 }, (ctx, w, h) => {
      ctx.fillStyle = '#060706';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffb347';
      ctx.font = `700 46px ${SIGN_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText('THE COAST', 24, 48);
      ctx.textAlign = 'right';
      ctx.fillText('3:33', w - 24, 48);
      // LED pitch.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    });
    level.addCollider(-23.3, busZ - 5.5, -20.7, busZ + 5.5 + 0.2, 3.2);
    refs.bus = bay9.group;
    refs.busPos = new THREE.Vector3(-22, 1.2, busZ + 5.5);

    // Platform bench at Bay 9, facing the bus.
    const platformBench = makeBench(3.0, { wood: seatB, metal: darkMetal });
    place(platformBench, -18.0, 0, -22.9, Math.PI);
    level.addCollider(-19.5, -23.25, -16.5, -22.55, 0.56);
    level.addHideSpot({
      id: 'hide_bench_bay9',
      name: 'under the platform bench',
      position: new THREE.Vector3(-18.0, 0, -22.9),
      exit: new THREE.Vector3(-18.0, 0, -24.1),
      // Out from under the seat towards the bus: the other way is the wall
      // a foot behind the bench.
      lookYaw: 0,
      view: { eye: 0.27, x: 0.69 },
      quality: 0.7,
      promptName: 'Hide under bench',
    });

    // The parts crate from work order 4410, with the packing tape never cut.
    // Straddling the end frame rather than tucked fully underneath, so it can
    // be seen from standing height.
    level.box(-19.55, -22.9, 0.5, 0.42, 0.3, 0, woodMat);
    level.box(-19.55, -22.9, 0.52, 0.06, 0.02, 0.3, paperMat, { ghost: true });

    // Clipboard on the seat, where a man would put it down to look at the lamp.
    level.box(-17.0, -22.9, 0.26, 0.36, 0.015, 0.465, darkMetal, { ghost: true });
    paper('int_workorder', -17.0, 0.485, -22.9, Math.PI / 2, 'workorder', {
      prompt: 'Read the work order on the bench',
      flat: true,
      w: 0.22,
      h: 0.32,
      radius: 1.8,
      onRead: () => {
        game.note('Bay 9', 'Bay 9 is three degrees colder than every other bay with the doors shut.');
        game.note('Bay 9', 'The Bay 9 platform lamp reads live with the breaker off.');
        if (game.state.persistent.loop >= 2) {
          game.note('Bay 9', 'Someone wrote NOT A FAULT across Krenshaw\'s work order. Bay 9 is meant to be cold.');
        }
      },
    });

    // The bus door is on its right, the west side here.
    level.addInteractable({
      id: 'int_bus',
      position: new THREE.Vector3(-23.35, 1.3, busZ + 4.7),
      radius: 2.8,
      prompt: () => game.busPrompt(),
      use: () => game.tryBoardBus(),
    });

    // Fog-lit canopy lamps, deliberately dim.
    level.addLight(-22, 4.4, -29, { intensity: 0.5, distance: 16, room: 'bays', color: 0xffd9a0 });
    level.addLight(-8, 4.4, -29, { intensity: 0.42, distance: 15, room: 'bays', color: 0xffd9a0, flicker: 0.3 });
    level.addLight(8, 4.4, -29, { intensity: 0.36, distance: 15, room: 'bays', color: 0xffd9a0 });
    level.addLight(20, 4.4, -29, { intensity: 0.28, distance: 14, room: 'bays', color: 0xffd9a0, flicker: 0.6 });
    // The Bay 9 platform lamp, which the work order says reads live with the
    // breaker off. It is the coldest, steadiest light out here.
    level.addLight(-19.5, 4.4, -24.2, { intensity: 0.5, distance: 12, room: 'bays', color: 0xd6e6ff, flicker: 0.04 });
  })();

  // ---- scanned props ------------------------------------------------------

  // The station's clutter: the things that accumulate in a building nobody
  // has cleaned since 1987. All of it photo-scanned (models.js, props.glb),
  // and all of it kept to the edges of rooms, clear of every walking route,
  // door, hiding place and thing to pick up (the reachability audit checks).
  (function dressing() {
    const box = [0.39, 0.52, 0.34];
    const can = [0.56, 0.56, 0.9];
    const sign = [0.32, 0.36, 0.63];
    const shelf = [1.1, 0.5, 2.14];
    // Board heights of the steel shelving, floor up.
    const SHELF = [0.205, 0.67, 1.14];

    // Hall: a wet-floor sign by the restroom door, nobody's mop in sight,
    // and fire alarms on the walls either side.
    model('wet_floor_sign', -8.4, 0, 9.1, 0.5, { block: sign });
    model('fire_alarm', -10.687, 1.4, 1.2, Math.PI / 2);
    model('fire_alarm', 10.687, 1.4, 1.5, -Math.PI / 2);

    // Ticket office: archive boxes in the corner behind the machine, a chair
    // left at Walter's desk, his pencils and a binder, a fuse box.
    model('cardboard_box', -22.43, 0, -9.42, 0.05);
    model('cardboard_box', -22.4, box[2], -9.38, 0.35);
    model('cardboard_box', -22.42, 0, -8.8, -0.1);
    level.addCollider(-22.7, -9.7, -22.15, -8.5, 0.69);
    model('chair', -17.9, 0, -3.3, 0.25, { block: [0.5, 0.5, 0.48] });
    model('pencil_cup', -17.95, 0.762, -2.45, 0.4);
    model('binder', -16.55, 0.762, -2.5, 0.25);
    model('power_box', -22.5, 1.25, -4.2, Math.PI / 2);

    // Manager's office: his chair pushed back from the desk, and the boxes
    // of everything nobody threw away.
    model('chair', -16.9, 0, -16.75, 0.1, { block: [0.5, 0.5, 0.48] });
    model('paper_stack', -16.45, 0.78, -16.05, -0.2);
    model('cardboard_box', -11.75, 0, -19.4, Math.PI / 2);
    model('cardboard_box', -11.75, box[2], -19.35, 1.7);
    level.addCollider(-12.05, -19.7, -11.3, -18.95, 0.69);

    // Lost & Found: unclaimed cases stood against the end wall, and more
    // boxes.
    model('suitcase_a', -22.58, 0, 5.7, Math.PI / 2, { block: [0.69, 0.24, 0.57], tint: 0xc8b8a0 });
    model('suitcase_b', -22.58, 0, 6.45, Math.PI / 2, { block: [0.69, 0.24, 0.57] });
    model('cardboard_box', -22.4, 0, 9.35, 0.1);
    model('cardboard_box', -21.85, 0, 9.4, -0.2);
    level.addCollider(-22.7, 9.05, -21.55, 9.7, 0.35);

    // Security: the chair pushed away from the console as if someone stood up
    // fast, steel shelving with the old set on it, a bin in the corner.
    model('chair', 19.9, 0, -4.4, -0.7, { block: [0.5, 0.5, 0.48] });
    for (const sx of [13.2, 14.35]) model('steel_shelves', sx, 0, -9.44, 0, { block: shelf });
    model('cardboard_box', 13.2, SHELF[1], -9.45, Math.PI / 2);
    model('plastic_crate', 13.05, SHELF[0], -9.45, Math.PI / 2 + 0.1);
    model('television', 14.35, SHELF[2], -9.47, 0.06);
    model('binder', 14.2, SHELF[0], -9.4, 0.1);
    model('notepad', 15.5, 0.762, -3.2, 0.3);
    model('trash_can_rust', 22.35, 0, -9.35, 0.8, { block: can });
    model('trash_lid_rust', 21.75, 0, -8.85, 2.1, { block: [0.56, 0.56, 0.12] });

    // Diner: the register on the counter, someone's cigarettes beside it, a
    // bin by the jukebox.
    model('cash_register', 13.15, 1.1, 2.95, 0.08);
    model('cigarette_pack', 13.72, 1.1, 3.25, 0.7);
    model('trash_can', 22.3, 0, 9.3, 2.2, { block: can });

    // Restrooms: a bin under the towel dispenser, a wet-floor sign.
    model('trash_can_rust', -1.62, 0, 16.75, 1.4, { block: can });
    model('wet_floor_sign', -4.6, 0, 16.2, 0.7, { block: sign });

    // Baggage claim: shelving along the back wall, crates and boxes in the
    // corners, a hand truck, a bin and bags by the door, the building's
    // electrics.
    for (const sx of [9.2, 10.35]) model('steel_shelves', sx, 0, 23.44, Math.PI, { block: shelf });
    model('cardboard_box', 9.2, SHELF[0], 23.45, Math.PI / 2 + 0.05);
    model('cardboard_box', 9.25, SHELF[1], 23.45, Math.PI / 2 - 0.1);
    model('plastic_crate', 10.25, SHELF[0], 23.45, Math.PI / 2);
    model('cardboard_box', 10.4, SHELF[2], 23.45, Math.PI / 2 + 0.15);
    model('wooden_crate', 2.0, 0, 23.42, 0);
    model('cardboard_box', 2.05, 0.35, 23.45, Math.PI / 2 + 0.2);
    model('cardboard_box', 1.75, 0, 22.75, 0.3);
    level.addCollider(1.3, 22.4, 2.5, 23.7, 0.62);
    model('cardboard_box', 20.25, 0, 23.35, 0.2);
    model('cardboard_box', 20.3, box[2], 23.3, 1.1);
    model('cardboard_box', 19.7, 0, 23.4, -0.1);
    level.addCollider(19.4, 22.95, 20.7, 23.7, 0.69);
    model('hand_truck', 1.65, 0, 20.4, Math.PI / 2, { block: [0.59, 0.69, 1.4] });
    model('trash_can_rust', 20.3, 0, 10.75, 0.3, { block: can });
    model('trash_bag', 19.7, 0, 10.65, 1.2, { block: [0.45, 0.4, 0.5] });
    model('utility_box', 12.6, 0, 10.53, 0, { block: [0.92, 0.43, 1.12] });
    model('power_box', 20.5, 1.3, 12.5, -Math.PI / 2);

    // Maintenance tunnel: a tool chest, oil drums, a tyre against the wall,
    // dead lamps.
    model('tool_chest', 23.2, 0, 19.48, Math.PI, { block: [0.69, 0.41, 0.65] });
    model('barrel', 28.35, 0, 19.35, 0.4, { block: [0.56, 0.56, 0.88] });
    model('barrel', 27.75, 0, 19.4, 1.4, { block: [0.56, 0.56, 0.88] });
    model('tyre', 22.2, 0, 14.49, 0.05, { block: [0.6, 0.17, 0.6] });
    model('cardboard_box', 28.4, 0, 14.65, 0.4, { block: [0.5, 0.5, 0.34] });
    model('can', 26.3, 0, 19.3, 1.1);
    model('wall_lamp', 24.0, 1.7, 14.37, 0);
    model('wall_lamp', 26.0, 1.7, 19.63, Math.PI);

    // The bays: concrete barriers along the back fence, oil drums and a tyre
    // in the far corner, bins on the platform.
    for (const [bx, rz] of [[-8.0, 0], [-6.4, 0.05], [8.5, -0.03], [10.1, 0.02]]) {
      model('road_barrier', bx, 0, -39.25, rz, { block: [1.55, 0.64, 0.83] });
    }
    model('barrel', 24.95, 0, -38.95, 0, { block: [0.56, 0.56, 0.88] });
    model('barrel', 24.3, 0, -39.25, 1, { block: [0.56, 0.56, 0.88] });
    model('barrel', 25.0, 0, -38.3, 2, { block: [0.56, 0.56, 0.88] });
    model('tyre', 22.5, 0, -39.6, 0, { block: [0.6, 0.17, 0.6] });
    model('trash_can', -7.5, 0, -22.62, 0.6, { block: can });
    model('trash_bag', -6.9, 0, -22.6, 0.4, { block: [0.45, 0.4, 0.5] });
    model('trash_can_rust', 12.5, 0, -22.62, 2.6, { block: can });
    model('can', 11.7, 0, -22.75, 0.4);
    model('can', -3.1, 0, -23.4, 2.0);

    // Bay 0: barriers and drums round the dead bus.
    model('road_barrier', 40.2, 0, 13.0, Math.PI / 2, { block: [1.55, 0.64, 0.83] });
    model('road_barrier', 40.2, 0, 14.6, Math.PI / 2 + 0.05, { block: [1.55, 0.64, 0.83] });
    model('barrel', 29.75, 0, -9.25, 0.3, { block: [0.56, 0.56, 0.88] });
    model('barrel', 30.4, 0, -9.35, 1.9, { block: [0.56, 0.56, 0.88] });
    model('tyre', 40.3, 0, -9.3, 0.4, { block: [0.6, 0.17, 0.6] });
  })();

  level.bevel = false;
  return refs;
}
