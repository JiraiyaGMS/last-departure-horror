import * as THREE from 'three';

// All textures are generated at tiny sizes with nearest filtering so they read
// as 1987 hardware rather than modern assets.

const cache = new Map();

function makeCanvas(size = 64) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function toTexture(canvas, repeat = [1, 1]) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

function noiseFill(ctx, size, base, amount) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export function checkerFloor() {
  return cached('checkerFloor', () => {
    const size = 64;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const a = '#23302b';
    const b = '#1a2420';
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? a : b;
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 16, 0);
      ctx.lineTo(i * 16, size);
      ctx.moveTo(0, i * 16);
      ctx.lineTo(size, i * 16);
      ctx.stroke();
    }
    noiseFill(ctx, size, null, 22);
    return c;
  });
}

export function woodPanel() {
  return cached('woodPanel', () => {
    const size = 64;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4a3526';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(${90 + Math.random() * 40 | 0},${60 + Math.random() * 30 | 0},${35 + Math.random() * 20 | 0},0.35)`;
      ctx.beginPath();
      const y = Math.random() * size;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + 2, size * 0.6, y - 2, size, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    for (let x = 0; x <= size; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    noiseFill(ctx, size, null, 16);
    return c;
  });
}

export function concrete() {
  return cached('concrete', () => {
    const size = 64;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2f3436';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(${Math.random() * 60 + 30 | 0},${Math.random() * 60 + 35 | 0},${Math.random() * 60 + 35 | 0},0.5)`;
      ctx.fillRect(Math.random() * size | 0, Math.random() * size | 0, 1 + Math.random() * 2 | 0, 1);
    }
    noiseFill(ctx, size, null, 26);
    return c;
  });
}

export function bathroomTile() {
  return cached('bathroomTile', () => {
    const size = 64;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3c4a44';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const v = 58 + Math.random() * 20;
        ctx.fillStyle = `rgb(${v * 0.75 | 0},${v | 0},${v * 0.88 | 0})`;
        ctx.fillRect(x * 8 + 1, y * 8 + 1, 6, 6);
      }
    }
    // Rust streaks.
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = 'rgba(120,60,25,0.25)';
      const x = Math.random() * size;
      ctx.fillRect(x, Math.random() * size * 0.5, 1, Math.random() * size * 0.5);
    }
    noiseFill(ctx, size, null, 18);
    return c;
  });
}

export function ceilingTile() {
  return cached('ceilingTile', () => {
    const size = 64;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c2022';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        ctx.fillStyle = '#23282a';
        ctx.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      }
    }
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.random() * size | 0, Math.random() * size | 0, 1, 1);
    }
    return c;
  });
}

export function vinylSeat(color = '#2d5a4a') {
  return cached('vinyl' + color, () => {
    const size = 32;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(Math.random() * size | 0, Math.random() * size | 0, 1, 1);
    }
    // Cracked vinyl.
    ctx.strokeStyle = 'rgba(20,14,10,0.6)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * size, Math.random() * size);
      ctx.lineTo(Math.random() * size, Math.random() * size);
      ctx.stroke();
    }
    return c;
  });
}

// A canvas that game code keeps repainting (departure board, CRT screens).
export function liveCanvas(w, h) {
  const c = makeCanvas(1);
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return { canvas: c, ctx: c.getContext('2d'), texture: tex };
}

export const tex = {
  floor: (r) => toTexture(checkerFloor(), r),
  wood: (r) => toTexture(woodPanel(), r),
  concrete: (r) => toTexture(concrete(), r),
  tile: (r) => toTexture(bathroomTile(), r),
  ceiling: (r) => toTexture(ceilingTile(), r),
  vinyl: (c, r) => toTexture(vinylSeat(c), r),
};
