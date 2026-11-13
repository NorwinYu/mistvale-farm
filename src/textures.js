import * as THREE from 'three';
import { makeCanvas, canvasTexture, mulberry32, TAU } from './utils.js';

const rnd = mulberry32(8417);

function splatter(ctx, size, count, colors, minR, maxR, alpha = 0.16) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * size, y = rnd() * size, r = minR + rnd() * (maxR - minR);
    ctx.globalAlpha = alpha * (0.4 + rnd() * 0.6);
    ctx.fillStyle = colors[(rnd() * colors.length) | 0];
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.35 + rnd()), rnd() * TAU, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/*  Ground                                                             */
/* ------------------------------------------------------------------ */
function grass() {
  const { canvas, ctx } = makeCanvas(1024);
  const g = ctx.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, '#647546');
  g.addColorStop(0.35, '#74834f');
  g.addColorStop(0.7, '#5c7043');
  g.addColorStop(1, '#6c7c49');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 1024);
  splatter(ctx, 1024, 300, ['#82905b', '#4d633b', '#8d9560', '#586c3c'], 10, 90, 0.11);

  // Fine grass blades, wrapped so the texture tiles.
  const greens = ['#3f562f', '#50683a', '#728452', '#83925f', '#435e35', '#97a070'];
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * 1024, y = rnd() * 1024;
    const len = 3 + rnd() * 12, lean = (rnd() - 0.5) * 6;
    ctx.strokeStyle = greens[(rnd() * greens.length) | 0];
    ctx.globalAlpha = 0.22 + rnd() * 0.55;
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * 0.4, y - len * 0.6, x + lean, y - len); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Tiny wildflowers / clover.
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 1024, y = rnd() * 1024;
    ctx.fillStyle = ['#d6c78a', '#dfe0c5', '#b8c58b', '#c8a48b'][(rnd() * 4) | 0];
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(x, y, 0.8 + rnd() * 1.6, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function soil(wet = false) {
  const { canvas, ctx } = makeCanvas(512);
  const base = wet ? '#403126' : '#5c4733';
  ctx.fillStyle = base; ctx.fillRect(0, 0, 512, 512);
  splatter(ctx, 512, 500, wet ? ['#33261d', '#4b392a', '#2b2119'] : ['#70563f', '#4b3829', '#80654b'], 1, 14, 0.5);
  // Furrows running top-to-bottom.
  for (let x = 8; x < 512; x += 48) {
    const grad = ctx.createLinearGradient(x, 0, x + 44, 0);
    grad.addColorStop(0, 'rgba(0,0,0,.32)');
    grad.addColorStop(0.35, 'rgba(255,235,190,' + (wet ? '0.035' : '0.10') + ')');
    grad.addColorStop(0.7, 'rgba(0,0,0,.05)');
    grad.addColorStop(1, 'rgba(0,0,0,.28)');
    ctx.fillStyle = grad; ctx.fillRect(x, 0, 44, 512);
    for (let y = 4; y < 512; y += 9) {
      ctx.fillStyle = 'rgba(20,12,8,' + (0.06 + rnd() * 0.1) + ')';
      ctx.fillRect(x + 3 + rnd() * 32, y, 2 + rnd() * 7, 1);
    }
  }
  // Clods and pebbles.
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = ['#8b7055', '#3b2d22', '#6f5741', '#a08061'][(rnd() * 4) | 0];
    ctx.globalAlpha = 0.35 + rnd() * 0.4;
    ctx.beginPath(); ctx.ellipse(rnd() * 512, rnd() * 512, 1 + rnd() * 4, 0.7 + rnd() * 2, rnd() * TAU, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function dirt() {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#7b6a51'; ctx.fillRect(0, 0, 512, 512);
  splatter(ctx, 512, 480, ['#8e7b5f', '#665640', '#9b8768', '#574a39'], 1, 28, 0.28);
  // compacted wheel/worn lines
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = 'rgba(50,41,30,' + (0.05 + rnd() * 0.08) + ')';
    ctx.lineWidth = 8 + rnd() * 24;
    ctx.beginPath();
    ctx.moveTo(rnd() * 512, 0);
    ctx.bezierCurveTo(rnd() * 512, 170, rnd() * 512, 340, rnd() * 512, 512);
    ctx.stroke();
  }
  for (let i = 0; i < 220; i++) {
    const r = 0.6 + rnd() * 2.4;
    ctx.fillStyle = ['#a89a83', '#968977', '#c0b29a', '#6c6152'][(rnd() * 4) | 0];
    ctx.globalAlpha = 0.45 + rnd() * 0.4;
    ctx.beginPath(); ctx.ellipse(rnd() * 512, rnd() * 512, r, r * 0.65, rnd() * TAU, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/* ------------------------------------------------------------------ */
/*  Architecture                                                       */
/* ------------------------------------------------------------------ */
function wood(base, dark, light, planks = 8, vertical = false) {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 512, 512);
  const step = 512 / planks;
  ctx.save();
  if (vertical) { ctx.translate(512, 0); ctx.rotate(Math.PI / 2); }
  for (let i = 0; i < planks; i++) {
    const y = i * step;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.045)';
    ctx.fillRect(0, y, 512, step);
    ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    ctx.globalAlpha = 1;
    for (let k = 0; k < 12; k++) {
      const yy = y + 4 + rnd() * (step - 8);
      ctx.strokeStyle = rnd() > 0.5 ? dark : light;
      ctx.globalAlpha = 0.1 + rnd() * 0.2;
      ctx.lineWidth = 0.6 + rnd() * 1.4;
      ctx.beginPath(); ctx.moveTo(0, yy);
      ctx.bezierCurveTo(128, yy + (rnd() - 0.5) * 10, 384, yy + (rnd() - 0.5) * 10, 512, yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Nails at plank ends + occasional knots
    ctx.fillStyle = 'rgba(25,20,15,.55)';
    ctx.beginPath(); ctx.arc(12, y + step / 2, 1.9, 0, TAU); ctx.fill();
    if (rnd() > 0.55) {
      const kx = 40 + rnd() * 430, ky = y + step * (0.3 + rnd() * 0.4);
      ctx.strokeStyle = dark; ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(kx, ky, 6 + rnd() * 5, 3 + rnd() * 3, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  return canvas;
}

function shingles() {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#746656'; ctx.fillRect(0, 0, 512, 512);
  const rows = 10, cols = 9;
  const h = 512 / rows, w = 512 / cols;
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols + 1; c++) {
      const off = (r % 2 ? w / 2 : 0);
      const x = c * w + off, y = r * h;
      const colors = ['#6e6152', '#7a6b5b', '#665a4d', '#82725f', '#716454'];
      ctx.fillStyle = colors[(rnd() * colors.length) | 0];
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + w - 1, y + 1);
      ctx.lineTo(x + w - 3, y + h - 4); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x + 3, y + h - 4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(35,30,24,.32)'; ctx.lineWidth = 1.3; ctx.stroke();
      // sun-faded highlight
      ctx.strokeStyle = 'rgba(235,220,195,.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 4, y + 3); ctx.lineTo(x + w - 4, y + 3); ctx.stroke();
    }
  }
  // moss in a few joints
  ctx.globalAlpha = 0.22; ctx.fillStyle = '#63704a';
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 512, y = rnd() * 512;
    ctx.beginPath(); ctx.ellipse(x, y, 2 + rnd() * 8, 1 + rnd() * 4, rnd(), 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function plaster() {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#d7cbb2'; ctx.fillRect(0, 0, 512, 512);
  splatter(ctx, 512, 700, ['#cdbfa4', '#e0d6c1', '#c5b69b', '#eae0cc'], 2, 35, 0.16);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(82,70,52,.12)';
    ctx.fillRect(rnd() * 512, rnd() * 512, 1, 1);
  }
  return canvas;
}

function stone() {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#7d786b'; ctx.fillRect(0, 0, 512, 512);
  const stones = ['#8d8779', '#a09a89', '#726e62', '#b0a998', '#837d70', '#99927f'];
  let y = 0;
  while (y < 512) {
    const h = 34 + rnd() * 44;
    let x = -20;
    while (x < 512) {
      const w = 40 + rnd() * 74;
      ctx.fillStyle = stones[(rnd() * stones.length) | 0];
      ctx.beginPath();
      const pad = 3 + rnd() * 3;
      ctx.roundRect(x + pad, y + pad, w - pad * 1.6, h - pad * 1.6, 8 + rnd() * 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,232,213,.18)'; ctx.lineWidth = 1; ctx.stroke();
      x += w;
    }
    y += h;
  }
  splatter(ctx, 512, 180, ['#63704a', '#5b584b'], 1, 10, 0.18);
  return canvas;
}

function bark() {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#5d4a37'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 170; i++) {
    const x = rnd() * 512;
    ctx.strokeStyle = ['#3e3023', '#745c44', '#856a4d', '#4e3d2d', '#947659'][(rnd() * 5) | 0];
    ctx.globalAlpha = 0.25 + rnd() * 0.45;
    ctx.lineWidth = 1 + rnd() * 5;
    ctx.beginPath(); ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (rnd() - .5) * 30, 160, x + (rnd() - .5) * 34, 330, x + (rnd() - .5) * 22, 512);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // moss flecks
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = 'rgba(98,113,65,.4)';
    ctx.beginPath(); ctx.ellipse(rnd() * 512, rnd() * 512, 2 + rnd() * 8, 1 + rnd() * 3, rnd() * TAU, 0, TAU); ctx.fill();
  }
  return canvas;
}

function awning() {
  const { canvas, ctx } = makeCanvas(512);
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#e7ddc8' : '#8c4b3e';
    ctx.fillRect(i * (512 / stripes), 0, 512 / stripes, 512);
  }
  // canvas weave & wear
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 1024; i += 4) {
    ctx.fillStyle = i % 8 ? '#fff' : '#000';
    ctx.fillRect(i / 2, 0, 1, 512);
  }
  ctx.globalAlpha = 1;
  splatter(ctx, 512, 70, ['#f2e7d1', '#6a3b31'], 1, 18, 0.12);
  return canvas;
}

/* ------------------------------------------------------------------ */
/*  Sprites / signs                                                    */
/* ------------------------------------------------------------------ */
function radialSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const { canvas, ctx } = makeCanvas(256);
  const g = ctx.createRadialGradient(128, 128, 2, 128, 128, 126);
  g.addColorStop(0, inner); g.addColorStop(0.35, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return canvas;
}

function cloudSprite() {
  const { canvas, ctx } = makeCanvas(512);
  ctx.clearRect(0, 0, 512, 512);
  // layered soft ellipses
  for (let i = 0; i < 26; i++) {
    const x = 90 + rnd() * 332;
    const y = 240 + (rnd() - 0.5) * 80;
    const r = 45 + rnd() * 95;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.32)');
    g.addColorStop(0.55, 'rgba(255,255,255,.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  return canvas;
}

function textSign(text, sub = '') {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#3d2c1d'; ctx.fillRect(0, 0, 512, 512);
  const grd = ctx.createLinearGradient(0, 0, 512, 512);
  grd.addColorStop(0, '#57402a'); grd.addColorStop(0.5, '#483323'); grd.addColorStop(1, '#5a4029');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16; i++) {
    ctx.strokeStyle = 'rgba(20,14,9,.35)'; ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath(); ctx.moveTo(0, i * 32 + rnd() * 6); ctx.bezierCurveTo(160, i * 32 + 5, 340, i * 32 - 4, 512, i * 32 + rnd() * 6); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(240,223,184,.92)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 104px "Songti SC", Georgia, serif';
  ctx.fillText(text, 256, 228);
  if (sub) {
    ctx.font = '30px Georgia, serif';
    ctx.letterSpacing = '8px';
    ctx.fillStyle = 'rgba(232,209,166,.6)';
    ctx.fillText(sub, 256, 340);
  }
  // border
  ctx.strokeStyle = 'rgba(233,207,161,.25)'; ctx.lineWidth = 5; ctx.strokeRect(22, 22, 468, 468);
  return canvas;
}

function chalkboard() {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#26352f'; ctx.fillRect(0, 0, 512, 512);
  // clean chalk texture
  splatter(ctx, 512, 70, ['#d7d2c0', '#c4c0b1'], 1, 18, 0.04);
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(239,232,211,.9)';
  ctx.font = '34px "Songti SC", Georgia, serif';
  ctx.fillText('今日 鲜货', 256, 95);
  ctx.strokeStyle = 'rgba(239,232,211,.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(120, 122); ctx.lineTo(392, 122); ctx.stroke();
  ctx.font = '28px "Kaiti SC", Georgia, serif'; ctx.textAlign = 'left';
  const lines = ['胡萝卜  ·  3G', '番茄    ·  6G', '小麦    ·  4G', '南瓜    ·  12G'];
  lines.forEach((l, i) => ctx.fillText(l, 110, 190 + i * 64));
  ctx.textAlign = 'center';
  ctx.font = '25px "Kaiti SC", Georgia, serif'; ctx.fillStyle = 'rgba(239,232,211,.55)';
  ctx.fillText('—— 谷雨 ——', 256, 462);
  return canvas;
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */
export function createTextures(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const t = (canvas, rx = 1, ry = 1, srgb = true) => canvasTexture(canvas, { repeatX: rx, repeatY: ry, srgb, anisotropy: aniso });

  const grassCanvas = grass();
  const soilCanvas = soil(false);
  const wetSoilCanvas = soil(true);
  const dirtCanvas = dirt();
  const woodWarmCanvas = wood('#8a6a4b', '#4f3927', '#c4a37d', 9);
  const woodDarkCanvas = wood('#59422f', '#2f2116', '#8b6948', 7);
  const woodPaleCanvas = wood('#a68c6d', '#6e5943', '#d3bd9d', 10);
  const barnCanvas = wood('#743b2f', '#3d201a', '#a45e4c', 10);
  const fenceCanvas = wood('#71573d', '#453221', '#a08362', 6);
  const roofCanvas = shingles();
  const plasterCanvas = plaster();
  const stoneCanvas = stone();
  const barkCanvas = bark();
  const awningCanvas = awning();

  const cloud = new THREE.CanvasTexture(cloudSprite());
  cloud.colorSpace = THREE.SRGBColorSpace;

  const glow = new THREE.CanvasTexture(radialSprite());
  glow.colorSpace = THREE.SRGBColorSpace;

  const star = new THREE.CanvasTexture(radialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
  star.colorSpace = THREE.SRGBColorSpace;

  return {
    aniso,
    grass: t(grassCanvas, 46, 46),
    grassNear: t(grassCanvas, 8, 8),
    soil: t(soilCanvas, 1, 1),
    soilWet: t(wetSoilCanvas, 1, 1),
    dirt: t(dirtCanvas, 3, 3),
    path: t(dirtCanvas, 1, 1),
    woodWarm: t(woodWarmCanvas, 2, 2),
    woodDark: t(woodDarkCanvas, 2, 2),
    woodPale: t(woodPaleCanvas, 1, 1),
    barn: t(barnCanvas, 2, 2),
    fence: t(fenceCanvas, 1, 1),
    roof: t(roofCanvas, 4, 2),
    plaster: t(plasterCanvas, 2, 2),
    stone: t(stoneCanvas, 2, 2),
    bark: t(barkCanvas, 2, 3),
    awning: t(awningCanvas, 2, 1),
    sign: t(textSign('雾谷农庄', 'MISTVALE FARM'), 1, 1),
    shopChalk: t(chalkboard(), 1, 1),
    cloud,
    glow,
    star,
  };
}
