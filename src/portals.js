import * as THREE from 'three';
import { ROOMS, DOORS, roomAt } from './level.js';

// Rooms you cannot see are not drawn.
//
// The station is closed boxes joined by doorways. From any room, what the
// camera can see of the next one is what shows through a doorway in view;
// of the room after that, what shows through both doorways at once; and so
// on. Frustum culling alone draws everything in front of the camera, walls
// or no walls, and standing in the hall that was most of the station.
//
// Every mesh that sits wholly inside one room and stays put is moved to that
// room's layer, and each frame the camera turns on only the layers of the
// rooms it can see. Layers rather than `visible`, because the game hides and
// shows things with `visible` all night and this must never fight it.
// Anything that spans rooms, walks between them or moves at all stays on the
// default layer and is drawn as before.

const NAMES = Object.keys(ROOMS);
// 0 is everything, 1 is the figures only the CCTV sees.
const FIRST_LAYER = 2;
const LAYER = Object.fromEntries(NAMES.map((n, i) => [n, FIRST_LAYER + i]));
export const ALL_ROOMS = NAMES.reduce((m, n) => m | (1 << LAYER[n]), 0);

// The open part of a doorway, a little generous on every side: the header
// over every opening comes down to 2.4 m.
const OPEN_H = 2.5;
const PAD = 0.1;
// How close to its room's edge a mesh may come and still belong to it. Walls
// stand inside their room's rectangle, so nothing of a room's own reaches
// further out than this.
const SLACK = 0.02;

const _box = new THREE.Box3();
const _vp = new THREE.Matrix4();
const _p = new THREE.Vector4();

export class Portals {
  constructor(game) {
    this.game = game;
    this.enabled = true;
    this.claimed = [];
    this.links = Object.fromEntries(NAMES.map((n) => [n, []]));
    for (const d of DOORS) {
      const a = d.from - PAD;
      const b = d.to + PAD;
      const corners = d.axis === 'z'
        ? [[a, -PAD, d.at], [b, -PAD, d.at], [b, OPEN_H, d.at], [a, OPEN_H, d.at]]
        : [[d.at, -PAD, a], [d.at, -PAD, b], [d.at, OPEN_H, b], [d.at, OPEN_H, a]];
      const pts = corners.map(([x, y, z]) => new THREE.Vector4(x, y, z, 1));
      this.links[d.a].push({ to: d.b, pts, def: d });
      this.links[d.b].push({ to: d.a, pts, def: d });
    }
    this.mask = 1 | ALL_ROOMS;
  }

  // Sorts the station's meshes into rooms. Run once the station is built.
  claim(root) {
    const skip = (o) => {
      // People walk, and the CCTV's own figures have a layer of their own.
      for (let p = o; p && p !== root; p = p.parent) if (p.userData.rig) return true;
      return o.isSkinnedMesh || o.layers.mask !== 1;
    };
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || skip(o)) return;
      if (o.isInstancedMesh) {
        if (!o.boundingBox) o.computeBoundingBox();
        _box.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
      } else {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      }
      const room = this.owner(_box);
      if (!room) return;
      const e = o.matrixWorld.elements;
      o.layers.set(LAYER[room]);
      this.claimed.push({ o, x: e[12], y: e[13], z: e[14] });
    });
  }

  owner(box) {
    for (const n of NAMES) {
      const r = ROOMS[n];
      if (box.min.x >= r.x1 - SLACK && box.max.x <= r.x2 + SLACK && box.min.z >= r.z1 - SLACK && box.max.z <= r.z2 + SLACK) return n;
    }
    return null;
  }

  // Anything that has moved since it was claimed goes back to being drawn
  // everywhere: it might be anywhere now. Runs after the frame's matrices are
  // up to date and before anything is drawn, so nothing is ever a frame late.
  release() {
    const list = this.claimed;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      const e = c.o.matrixWorld.elements;
      if (Math.abs(e[12] - c.x) + Math.abs(e[13] - c.y) + Math.abs(e[14] - c.z) < 1e-4) continue;
      c.o.layers.set(0);
      list[i] = list[list.length - 1];
      list.pop();
    }
  }

  // Which rooms the camera can see, as a layer mask: its own, and every room
  // whose doorway shows through the part of the screen the doorways before it
  // left open.
  visible(camera) {
    // A cutscene moves things about and puts the camera where it likes.
    if (!this.enabled || this.game.cutscene) return ALL_ROOMS;
    const here = roomAt(camera.position.x, camera.position.z);
    if (!here) return ALL_ROOMS;
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    let mask = 1 << LAYER[here];
    const doors = this.game.level.doors;
    const visit = (room, from, x0, y0, x1, y1, depth) => {
      for (const link of this.links[room]) {
        if (link.to === from) continue;
        // A locked door, shut, is a wall.
        const leaf = link.def.locked ? doors.get(link.def.locked) : null;
        if (leaf && leaf.locked && Math.abs(leaf.yaw - leaf.closedYaw) < 1e-3) continue;
        let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
        let behind = 0;
        for (const pt of link.pts) {
          _p.copy(pt).applyMatrix4(_vp);
          if (_p.w <= camera.near) { behind++; continue; }
          const sx = _p.x / _p.w;
          const sy = _p.y / _p.w;
          if (sx < ax) ax = sx;
          if (sx > bx) bx = sx;
          if (sy < ay) ay = sy;
          if (sy > by) by = sy;
        }
        if (behind === 4) continue;
        // A doorway reaching round behind the camera, or one it is standing
        // in, can show anything at all of what lies past it.
        if (behind > 0) { ax = -Infinity; ay = -Infinity; bx = Infinity; by = Infinity; }
        ax = Math.max(ax, x0); ay = Math.max(ay, y0);
        bx = Math.min(bx, x1); by = Math.min(by, y1);
        if (ax >= bx || ay >= by) continue;
        mask |= 1 << LAYER[link.to];
        if (depth < 8) visit(link.to, room, ax, ay, bx, by, depth + 1);
      }
    };
    visit(here, null, -1, -1, 1, 1, 0);
    return mask;
  }

  // Called by the renderer with the frame's matrices settled, just before it
  // decides what to draw.
  apply(camera) {
    this.release();
    this.mask = this.visible(camera);
    camera.layers.mask = (camera.layers.mask & ~ALL_ROOMS) | this.mask;
  }
}

// The shadows of the lights near you are drawn into maps that are kept from
// frame to frame, and a room behind you is still in them: draw every room
// into a shadow map, whatever the camera can see.
export function shadowsSeeEverything(renderer) {
  const sm = renderer.shadowMap;
  const render = sm.render;
  sm.render = function (lights, scene, camera) {
    const mask = camera.layers.mask;
    camera.layers.mask = mask | ALL_ROOMS;
    try {
      render.call(this, lights, scene, camera);
    } finally {
      camera.layers.mask = mask;
    }
  };
}
