// Capsule-ish collision: the player is a circle in plan view. Colliders whose
// top is below STEP_HEIGHT are walked over rather than blocked.
const STEP_HEIGHT = 0.3;

export function resolveMovement(colliders, pos, radius, feetY = 0, headY = 1.8) {
  // Two passes so sliding along one wall into another resolves cleanly.
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      if (c.top <= feetY + STEP_HEIGHT) continue;
      if (c.bottom !== undefined && c.bottom >= headY) continue;

      const closestX = Math.max(c.x1, Math.min(pos.x, c.x2));
      const closestZ = Math.max(c.z1, Math.min(pos.z, c.z2));
      let dx = pos.x - closestX;
      let dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq >= radius * radius) continue;

      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      } else {
        // Centre is inside the box: eject along the shallowest axis.
        const toLeft = pos.x - c.x1;
        const toRight = c.x2 - pos.x;
        const toTop = pos.z - c.z1;
        const toBottom = c.z2 - pos.z;
        const min = Math.min(toLeft, toRight, toTop, toBottom);
        if (min === toLeft) pos.x = c.x1 - radius;
        else if (min === toRight) pos.x = c.x2 + radius;
        else if (min === toTop) pos.z = c.z1 - radius;
        else pos.z = c.z2 + radius;
      }
    }
  }
  return pos;
}

// Line-of-sight test used by the Attendant. Walls only; props do not hide you.
export function segmentBlocked(colliders, ax, az, bx, bz, minTop = 1.6) {
  const dx = bx - ax;
  const dz = bz - az;
  for (const c of colliders) {
    if (c.top < minTop) continue;
    let tmin = 0;
    let tmax = 1;
    let hit = true;
    for (const axis of ['x', 'z']) {
      const start = axis === 'x' ? ax : az;
      const delta = axis === 'x' ? dx : dz;
      const lo = axis === 'x' ? c.x1 : c.z1;
      const hi = axis === 'x' ? c.x2 : c.z2;
      if (Math.abs(delta) < 1e-9) {
        if (start < lo || start > hi) {
          hit = false;
          break;
        }
        continue;
      }
      let t1 = (lo - start) / delta;
      let t2 = (hi - start) / delta;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}
