import * as THREE from 'three';

// Leaning in to read something, the way the CCTV console is watched: the eye
// goes to the page instead of the page coming up to the eye, and the station
// carries on around you while you read.
//
// A view takes the eye the player is standing with, the screen's aspect, the
// player's field of view and how far they have leaned in and looked across
// (`look`: zoom, lx, ly), and fills `out` with where the camera goes:
// { position, quaternion, fov, dist }. `dist` is how far the thing being read
// is from that camera, so the torch can be pointed at it.

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const _c = new THREE.Vector3();
const _x = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u2 = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qi = new THREE.Quaternion();

export function makeView() {
  return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 68, dist: 1 };
}

// The centre of a flat panel and its right, up and outward directions. A
// PlaneGeometry faces +Z, with the top of its texture towards +Y.
function basis(obj) {
  obj.updateWorldMatrix(true, false);
  const e = obj.matrixWorld.elements;
  _c.setFromMatrixPosition(obj.matrixWorld);
  _x.set(e[0], e[1], e[2]).normalize();
  _u.set(e[4], e[5], e[6]).normalize();
  _n.set(e[8], e[9], e[10]).normalize();
}

// Square on to a panel and close enough that it fills the view: a page on a
// desk is looked straight down at, a notice on a wall straight across at.
// The panel's own up is the view's up, so the writing is the right way round
// whichever side of the desk you were standing on. Leaning in brings the eye
// closer; looking about slides it across the face, never off the edge.
export function faceView(obj, w, h, opts = {}) {
  const margin = opts.margin ?? 1.3;
  // The page sits a little high in the frame, clear of a line of subtitle.
  const lift = opts.lift ?? 0.14;
  return (eye, aspect, fov, look, out) => {
    basis(obj);
    const t = Math.tan((fov * DEG) / 2);
    const z = look.zoomNow;
    const fit = Math.max(((h / 2) * margin) / t, ((w / 2) * margin) / (t * aspect));
    const dist = Math.max(opts.minDist ?? 0.08, fit / z);
    const vy = dist * t;
    const vx = vy * aspect;
    const ox = Math.max(0, (w / 2) * 1.04 - vx) * look.lx;
    const oy = Math.max(0, (h / 2) * 1.04 - vy) * look.ly - (lift * vy) / (z * z);
    out.position.copy(_c).addScaledVector(_x, ox).addScaledVector(_u, oy).addScaledVector(_n, dist);
    _m.makeBasis(_x, _u, _n);
    out.quaternion.setFromRotationMatrix(_m);
    out.fov = fov;
    out.dist = dist;
    return out;
  };
}

// Something hung too high to walk up to. You stay about where you are, turn
// to it and the eye narrows until it fills the view, the way you squint at a
// board across a hall. From right underneath it, or from well off to one
// side, you step round in front of it first, if there is room to.
//   minDist: how far in front of the face the eye has to be
//   maxSide: how far off its centre line the eye can be
//   clear(a, b): whether the eye can get from a to b
export function zoomView(obj, w, h, opts = {}) {
  const margin = opts.margin ?? 1.1;
  return (eye, aspect, fov, look, out) => {
    basis(obj);
    const p = out.position.copy(eye);
    _t.set(_n.x, 0, _n.z).normalize();
    _u2.set(_x.x, 0, _x.z).normalize();
    _v.subVectors(p, _c);
    const back = Math.max(0, (opts.minDist ?? 0) - _v.dot(_n));
    const side = _v.dot(_u2);
    const limit = opts.maxSide ?? Infinity;
    const over = side - Math.max(-limit, Math.min(limit, side));
    if (back > 0 || over !== 0) {
      _v.copy(p).addScaledVector(_t, back).addScaledVector(_u2, -over);
      if (!opts.clear || opts.clear(p, _v)) p.copy(_v);
    }
    const z = look.zoomNow;
    const rx = (w / 2) * (1 - 1 / z);
    const ry = (h / 2) * (1 - 1 / z);
    _t.copy(_c).addScaledVector(_x, look.lx * rx).addScaledVector(_u, look.ly * ry);
    _m.lookAt(p, _t, UP);
    out.quaternion.setFromRotationMatrix(_m);
    _qi.copy(out.quaternion).invert();
    let need = 0;
    for (const [sx, sy] of CORNERS) {
      _v.copy(_t)
        .addScaledVector(_x, (sx * w) / (2 * z))
        .addScaledVector(_u, (sy * h) / (2 * z))
        .sub(p)
        .applyQuaternion(_qi);
      if (_v.z > -1e-3) continue;
      need = Math.max(need, Math.abs(_v.y) / -_v.z, Math.abs(_v.x) / (-_v.z * aspect));
    }
    const fit = (2 * Math.atan(need * margin)) / DEG;
    out.fov = Math.min(fov, Math.max(opts.minFov ?? 6, fit));
    out.dist = p.distanceTo(_t);
    return out;
  };
}

// Something with no face to square up to -- a coffee pot and a cup on a
// counter. Lean a little way towards it and let the view close in around it.
export function aimView(center, radius, opts = {}) {
  const margin = opts.margin ?? 1.15;
  return (eye, aspect, fov, look, out) => {
    _v.subVectors(center, eye);
    const d = _v.length();
    const lean = Math.min((opts.lean ?? 0.35) * d, Math.max(0, d - (opts.minDist ?? 0.8)));
    const p = out.position.copy(eye).addScaledVector(_v, lean / Math.max(1e-6, d));
    const z = look.zoomNow;
    // Looking about, once leaned in: across the view's own right and up.
    _m.lookAt(p, center, UP);
    _x.setFromMatrixColumn(_m, 0);
    _u.setFromMatrixColumn(_m, 1);
    const r = radius * (1 - 1 / z);
    _t.copy(center).addScaledVector(_x, look.lx * r).addScaledVector(_u, look.ly * r);
    _m.lookAt(p, _t, UP);
    out.quaternion.setFromRotationMatrix(_m);
    const dist = p.distanceTo(_t);
    const need = ((radius * margin) / Math.max(0.05, dist)) * Math.max(1, 1 / aspect);
    out.fov = Math.min(fov, Math.max(opts.minFov ?? 6, (2 * Math.atan(need / z)) / DEG));
    out.dist = dist;
    return out;
  };
}
