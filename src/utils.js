import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Deterministic tiny math helpers used across terrain, props, etc.   */
/* ------------------------------------------------------------------ */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function smoothNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function fbm(x, y, octaves = 4) {
  let value = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * freq, y * freq) * amp;
    amp *= 0.5; freq *= 2.03;
  }
  return value;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
export const TAU = Math.PI * 2;

/*  Height of the walkable valley floor. The farm itself is kept nearly
    flat; the ground rises into soft Hampshire-style downs further away.  */
export function groundHeight(x, z) {
  const r = Math.hypot(x * 0.9, z);
  const rise = smoothstep(34, 120, r);
  const hills = (fbm(x * 0.013 + 11.2, z * 0.013 - 4.7, 4) - 0.42) * 34;
  const roll = (fbm(x * 0.045 - 3.1, z * 0.045 + 6.3, 3) - 0.5) * 3.2;
  const far = smoothstep(24, 55, r);
  // A soft mountain skirt closes the horizon without cluttering the farm.
  const mountains = smoothstep(90, 210, r)
    * (12 + fbm(x * 0.007 + 7.3, z * 0.007 - 2.1, 4) * 58);
  return rise * hills * 0.9 + far * roll + mountains;
}

/*  A cheap value-noise normal for water / particles.  */
export function srgbColor(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

export function makeCanvas(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function canvasTexture(canvas, { repeatX = 1, repeatY = 1, srgb = true, anisotropy = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function cloneTexture(tex, rx = 1, ry = 1) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

export function disposeObject(obj) {
  obj.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

export function setShadow(obj, cast = true, receive = true) {
  obj.traverse?.((o) => {
    if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; }
  });
  if (obj.isMesh) { obj.castShadow = cast; obj.receiveShadow = receive; }
  return obj;
}
