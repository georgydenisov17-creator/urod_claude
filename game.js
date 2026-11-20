'use strict';
/* ============ «УРОД» — 2D-игра. Всё рисуется кодом, музыка — music.mp3 ============ */

/* ---------- CONFIG ---------- */
const CFG = {
  maxKmh: 50, ppm: 24,            // лимит скорости, пикселей на метр
  accel: 6, brake: 12, drag: 1.5, // м/с²
  cap0: 30, capGrow: 0.2,         // стартовый потолок км/ч и рост в секунду
  g: 1500, jumpV: 620, airMin: 12,// гравитация, скорость прыжка, мин. воздушная скорость (м/с)
  maxAngle: 80, wheelBack: 90,    // лимит вили, скорость возврата °/с
  wheelBonus: 2,                  // очков за метр на заднем колесе
  carW: 110, carH: 34, carGap: 340, // размеры машины и безопасная дистанция между ними
  bottlePts: 10, crashWheelie: 2, crashCar: 1, slow: 0.5
};
const SKINS = [
  { id: 'classic', n: 'Классика', p: 0,   shirt: '#e53935', helm: '#1e88e5', pack: '#fdd835', bike: '#ff6f00', acc: '#222' },
  { id: 'neon',    n: 'Неон',     p: 20,  shirt: '#00e5ff', helm: '#76ff03', pack: '#ff1744', bike: '#d500f9', acc: '#00e5ff' },
  { id: 'camo',    n: 'Камуфляж', p: 40,  shirt: '#5d6b3a', helm: '#3e4a2a', pack: '#6d5a3a', bike: '#4e5d2e', acc: '#2b3318', fx: 'camo' },
  { id: 'fire',    n: 'Огонь',    p: 60,  shirt: '#ff5722', helm: '#b71c1c', pack: '#212121', bike: '#d50000', acc: '#ffab00', fx: 'fire' },
  { id: 'space',   n: 'Космос',   p: 100, shirt: '#283593', helm: '#ede7f6', pack: '#6a1b9a', bike: '#1a237e', acc: '#ffd740', fx: 'space' }
];
const WALLS = ['#f2e3c6', '#d9e8f5', '#e8d5d5', '#d8ecd0', '#f5f0e0', '#cfd8dc'];
const ROOFS = ['#7b3f2e', '#37474f', '#5d4037', '#2e5339', '#8d2f2f'];
const FENCES = ['#2e7d32', '#6d4c41', '#78909c', '#1565c0', '#8d6e63'];
const CARCOL = ['#f5f5f5', '#e8d9b0', '#2e7d32', '#8e1b3a', '#4fc3f7', '#9e9e9e'];

/* ---------- save ---------- */
const S = {
  get(k, d) { try { const v = localStorage.getItem('urod_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('urod_' + k, JSON.stringify(v)); } catch (e) {} }
};
let best = S.get('best', 0), wallet = S.get('wallet', 0), owned = S.get('owned', ['classic']),
    skinId = S.get('skin', 'classic'), snd = S.get('snd', true);
const skin = () => SKINS.find(s => s.id === skinId) || SKINS[0];

/* ---------- утилиты ---------- */
const $ = id => document.getElementById(id);
const pick = (R, a) => a[Math.floor(R() * a.length)];
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const Q = 2; // множитель разрешения offscreen-тайлов
function mk(w, h, fn) { const c = document.createElement('canvas'); c.width = w * Q; c.height = h * Q; const x = c.getContext('2d'); x.scale(Q, Q); fn(x, w, h); return c; }

/* ---------- audio: музыка из файла + синтез эффектов ---------- */
const A = {
  ctx: null, eng: null, eg: null, music: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sawtooth'; g.gain.value = 0; o.connect(g); g.connect(this.ctx.destination); o.start();
      this.eng = o; this.eg = g;
    } catch (e) {}
    this.music = new Audio('music.mp3'); this.music.loop = true; this.music.volume = 0.5;
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  playMusic() { if (this.music && snd) this.music.play().catch(() => {}); },
  stopMusic() { if (this.music) this.music.pause(); },
  tone(f1, f2, d, type, v) {
    if (!this.ctx || !snd) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + d);
  },
  beep() { this.tone(880, 1400, 0.12, 'square', 0.12); },
  thud() { this.tone(140, 35, 0.4, 'sine', 0.5); this.tone(90, 30, 0.3, 'sawtooth', 0.2); },
  engine(v, on) { if (!this.eg) return; this.eg.gain.value = (snd && on) ? 0.025 : 0; this.eng.frequency.value = 55 + v * 9; }
};

/* ---------- состояние ---------- */
const keys = { gas: 0, brake: 0, wheelie: 0, jump: 0 };
const G = { st: 'menu', t: 0, dist: 0, bonus: 0, bot: 0, ct: 0, flash: 0, paused: false, prev: 'start' };
const cv = $('c'), ctx = cv.getContext('2d');
let dpr = 1, sc = 1, VW = 480, VH = 800, RT = 400, RB = 462, skyG, L, B, P = [], BG, birds = [];
const score = () => Math.floor(G.dist) + Math.floor(G.bonus) + G.bot * CFG.bottlePts;

function resize() {
  const iw = innerWidth, ih = innerHeight;
  dpr = Math.min(devicePixelRatio || 1, 2); cv.width = iw * dpr; cv.height = ih * dpr;
  sc = Math.min(iw / 480, ih / 270); VW = iw / sc; VH = ih / sc;
  RT = Math.round(VH * 0.56); RB = RT + 62; // верх дороги, линия колёс
  skyG = ctx.createLinearGradient(0, 0, 0, RT); skyG.addColorStop(0, '#4f9fe0'); skyG.addColorStop(1, '#e2f3fb');
}
addEventListener('resize', resize);

/* ---------- levelgen: процедурный уровень по сиду ---------- */
function reset() {
  const seed = (Date.now() ^ (Math.random() * 4294967296)) >>> 0;
  L = { r: mulberry(seed), cars: [], bots: [], nx: 600, lce: -1e9 };
  B = { x: 0, v: 0, h: 0, vy: 0, ang: 0, wr: 0 };
  Object.assign(G, { t: 0, dist: 0, bonus: 0, bot: 0, ct: 0, flash: 0, hitCar: null });
  Object.assign(keys, { gas: 0, brake: 0, wheelie: 0, jump: 0 });
  P = []; BG = buildBG(seed);
  const R = mulberry(seed + 7); birds = Array.from({ length: 5 }, () => ({ x: R() * 600, y: 40 + R() * 120, s: 0.7 + R() * 0.6 }));
}
function genAhead(upTo) {
  const r = L.r;
  while (L.nx < upTo) {
    const x = L.nx;
    if (r() < 0.45 && x - L.lce >= CFG.carGap) { // машина (+дуга бутылок над ней)
      L.cars.push({ x, c: pick(r, CARCOL) }); L.lce = x + CFG.carW;
      if (r() < 0.65) for (let i = 0; i < 5; i++) L.bots.push({ x: x + 4 + i * 26, h: 30 + Math.sin(i / 4 * Math.PI) * 80 });
      L.nx = x + CFG.carW + CFG.carGap + r() * 220; // безопасный минимум гарантирован
    } else { // паттерн бутылок
      const t = r(), n = 4 + Math.floor(r() * 5);
      if (t < 0.3) for (let i = 0; i < n; i++) L.bots.push({ x: x + i * 38, h: 22 });                       // линия
      else if (t < 0.55) for (let i = 0; i < n; i++) L.bots.push({ x: x + i * 38, h: i % 2 ? 80 : 22 });      // зигзаг
      else if (t < 0.8) for (let i = 0; i < n; i++) L.bots.push({ x: x + i * 38, h: 30 + Math.sin(i / (n - 1) * Math.PI) * 90 }); // дуга
      else L.bots.push({ x, h: r() < 0.5 ? 22 : 90 });                                                      // одиночная
      L.nx = x + n * 38 + 90 + r() * 180;
    }
  }
}

/* ---------- background: процедурный посёлок (рисуется один раз в offscreen) ---------- */
function hills(c, w, h, base, a1, a2, k1, k2, ph, col) {
  c.fillStyle = col; c.beginPath(); c.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) c.lineTo(x, base - a1 * Math.sin(x / w * 6.283 * k1 + ph) - a2 * Math.sin(x / w * 6.283 * k2));
  c.lineTo(w, h); c.fill();
}
function cloud(c, x, y, s) { c.fillStyle = 'rgba(255,255,255,.85)'; [[0, 0, 18], [16, -6, 22], [36, 0, 16], [22, 4, 18]].forEach(p => { c.beginPath(); c.arc(x + p[0] * s, y + p[1] * s, p[2] * s, 0, 6.283); c.fill(); }); }
function buildFar(R) {
  return mk(960, 260, (c, w, h) => {
    for (let i = 0; i < 5; i++) cloud(c, R() * w, 20 + R() * 70, 0.6 + R() * 0.6);
    hills(c, w, h, h - 80, 14, 8, 2, 5, R() * 6, '#b4d1c0');
    for (let x = 10; x < w - 50; x += 40 + R() * 60) { // многоэтажки на горизонте
      const tw = 26 + R() * 16, th = 60 + R() * 60; c.fillStyle = '#c9d3dc'; c.fillRect(x, h - 50 - th, tw, th + 14);
      c.fillStyle = '#e3ebf2'; for (let y = h - 44 - th; y < h - 50; y += 9) for (let xx = x + 4; xx < x + tw - 4; xx += 8) c.fillRect(xx, y, 4, 5);
    }
    hills(c, w, h, h - 40, 10, 6, 3, 7, R() * 6, '#7fb08a');
    for (let x = 0; x < w; x += 14) { c.fillStyle = '#5f9a6c'; c.beginPath(); c.arc(x, h - 34 + Math.sin(x * 0.3) * 3, 11, 0, 6.283); c.fill(); }
    c.fillStyle = '#6aa56e'; c.fillRect(0, h - 30, w, 30);
  });
}
function birch(c, x, g, R) { const t = 50 + R() * 25; c.fillStyle = '#eee'; c.fillRect(x - 2, g - t, 4, t); c.fillStyle = '#333'; for (let i = 0; i < 5; i++) c.fillRect(x - 2, g - t + 8 + i * 9, 3, 2); c.fillStyle = '#6fae45'; for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(x + Math.sin(i * 2) * 9, g - t - 10 + i * 7, 13, 0, 6.283); c.fill(); } }
function spruce(c, x, g, R) { const t = 60 + R() * 30; c.fillStyle = '#2f6b3f'; for (let i = 0; i < 4; i++) { const y = g - t + i * t / 4.5, w = 10 + i * 7; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x - w, y + t / 3.5); c.lineTo(x + w, y + t / 3.5); c.fill(); } c.fillStyle = '#5d4037'; c.fillRect(x - 2, g - 8, 4, 8); }
function bush(c, x, g) { c.fillStyle = '#4e9a46'; [[0, 10], [10, 12], [22, 9]].forEach(p => { c.beginPath(); c.arc(x + p[0], g - p[1] + 2, p[1], 0, 6.283); c.fill(); }); }
function greenhouse(c, x, g) { c.fillStyle = 'rgba(190,230,200,.7)'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, g); c.quadraticCurveTo(x + 22, g - 48, x + 44, g); c.closePath(); c.fill(); c.stroke(); }
function kennel(c, x, g) { c.fillStyle = '#a1783f'; c.fillRect(x, g - 14, 20, 14); c.fillStyle = '#6d4c41'; c.beginPath(); c.moveTo(x - 3, g - 14); c.lineTo(x + 10, g - 24); c.lineTo(x + 23, g - 14); c.fill(); c.fillStyle = '#222'; c.beginPath(); c.arc(x + 10, g - 6, 4.5, Math.PI, 0); c.fillRect(x + 5.5, g - 6, 9, 6); c.fill(); }
function swing(c, x, g) { c.strokeStyle = '#e53935'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x, g); c.lineTo(x + 12, g - 36); c.lineTo(x + 24, g); c.moveTo(x + 6, g - 18); c.lineTo(x + 6, g - 8); c.moveTo(x + 18, g - 18); c.lineTo(x + 18, g - 8); c.stroke(); c.fillStyle = '#fdd835'; c.fillRect(x + 3, g - 9, 18, 3); }
function mangal(c, x, g) { c.fillStyle = '#37474f'; c.fillRect(x, g - 14, 20, 7); c.fillRect(x + 2, g - 7, 2, 7); c.fillRect(x + 16, g - 7, 2, 7); c.fillStyle = 'rgba(150,150,150,.5)'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(x + 10 + i * 3, g - 22 - i * 9, 4 + i, 0, 6.283); c.fill(); } }
function lamp(c, x, g) { c.fillStyle = '#607d8b'; c.fillRect(x, g - 72, 3, 72); c.fillRect(x, g - 72, 16, 3); c.fillStyle = '#fff59d'; c.fillRect(x + 12, g - 70, 9, 4); }
function rsign(c, x, g, R) {
  c.fillStyle = '#777'; c.fillRect(x, g - 46, 2, 46);
  if (R() < 0.5) { c.fillStyle = '#fff'; c.beginPath(); c.arc(x + 1, g - 52, 8, 0, 6.283); c.fill(); c.strokeStyle = '#d32f2f'; c.lineWidth = 2.5; c.stroke(); c.fillStyle = '#000'; c.font = 'bold 8px sans-serif'; c.textAlign = 'center'; c.fillText('50', x + 1, g - 49); }
  else { c.fillStyle = '#1565c0'; c.fillRect(x - 8, g - 60, 18, 18); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x + 1, g - 58); c.lineTo(x - 5, g - 45); c.lineTo(x + 7, g - 45); c.fill(); }
}
function house(c, x, g, R) { // коттедж + забор из профнастила
  const w = 100 + R() * 50, wh = 80 + R() * 15, top = g - wh, wall = pick(R, WALLS), roof = pick(R, ROOFS);
  c.fillStyle = wall; c.fillRect(x, top, w, wh);
  c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = 1; for (let y = top + 5; y < g; y += 5) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.stroke(); } // сайдинг
  const rh = 28 + R() * 14; c.fillStyle = roof; c.beginPath(); c.moveTo(x - 8, top + 2); c.lineTo(x + w / 2, top - rh); c.lineTo(x + w + 8, top + 2); c.fill();
  if (R() < 0.5) { c.fillStyle = '#8d6e63'; c.fillRect(x + w * 0.7, top - rh + 8, 8, 16); }
  const win = (a, b, ww, hh) => { const gr = c.createLinearGradient(a, b, a + ww, b + hh); gr.addColorStop(0, '#bfe3f5'); gr.addColorStop(1, '#6fa8c8'); c.fillStyle = gr; c.fillRect(a, b, ww, hh); c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(a, b, ww, hh); };
  win(x + 10, top + 8, w - 30, 20); win(x + 10, top + 34, 22, 18); win(x + w - 34, top + 34, 22, 18); // панорамное окно + окна
  if (R() < 0.45) { c.fillStyle = '#eceff1'; c.beginPath(); c.arc(x + w - 6, top + 12, 5, 0, 6.283); c.fill(); c.strokeStyle = '#90a4ae'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + w - 6, top + 12); c.lineTo(x + w - 2, top + 8); c.stroke(); } // тарелка
  if (R() < 0.5) { c.fillStyle = '#fafafa'; c.fillRect(x + w - 56, top + 38, 14, 8); c.fillStyle = '#b0bec5'; c.fillRect(x + w - 54, top + 41, 10, 2); }  // кондиционер
  const fc = pick(R, FENCES), fx = x - 6, fw = w + 12;
  c.fillStyle = fc; c.fillRect(fx, g - 22, fw, 22); c.strokeStyle = 'rgba(0,0,0,.2)'; for (let xx = fx; xx < fx + fw; xx += 5) { c.beginPath(); c.moveTo(xx, g - 22); c.lineTo(xx, g); c.stroke(); }
  c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x + w / 2 - 12, g - 22, 24, 22); c.fillStyle = '#ddd'; c.fillRect(x + w / 2 + 6, g - 12, 3, 5); // калитка
  return w + 12;
}
function buildMid(R) {
  return mk(1440, 170, (c, w, h) => {
    const g = h - 8; c.fillStyle = '#8cc063'; c.fillRect(0, g, w, 8);
    const items = [birch, spruce, bush, greenhouse, kennel, swing, mangal, lamp, rsign];
    let x = 8;
    while (x < w - 190) { x += house(c, x, g, R) + 8; pick(R, items)(c, x, g, R); x += 36 + R() * 26; if (R() < 0.4 && x < w - 190) { pick(R, [birch, spruce, bush])(c, x, g, R); x += 30; } }
    for (; x < w - 14; x += 26) (R() < 0.5 ? birch : spruce)(c, x, g, R);
    for (let k = 0; k < 4; k++) { // столбы ЛЭП с проводами
      const px = 3 + k * 360, nx = px + 360, top = g - 112;
      c.fillStyle = '#5d4037'; c.fillRect(px - 2, top, 4, 112); c.fillRect(px - 12, top + 4, 24, 3);
      c.strokeStyle = '#333'; c.lineWidth = 1;
      for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(px - 10 + j * 10, top + 4); c.quadraticCurveTo((px + nx) / 2 - 10 + j * 10, top + 28, nx - 10 + j * 10, top + 4); c.stroke(); }
    }
  });
}
function buildNear(R) {
  return mk(960, 70, (c, w, h) => {
    c.fillStyle = '#74b24f'; c.fillRect(0, h - 26, w, 26);
    for (let x = 0; x < w; x += 6) { c.fillStyle = '#5e9d3f'; c.fillRect(x, h - 26 - R() * 3, 2, 4); }
    c.fillStyle = '#cfcfcf'; c.fillRect(0, h - 5, w, 5); c.fillStyle = '#9e9e9e'; c.fillRect(0, h - 5, w, 1); // бордюр
    const ads = [['ШАУРМА', '#ffb300', '#3e2723'], ['ПЯТЁРОЧКА', '#e53935', '#fff'], ['АВТОЗАПЧАСТИ', '#1565c0', '#fff']];
    for (let x = 18; x < w - 110; x += 90 + R() * 70) {
      const t = R();
      if (t < 0.3) { const a = pick(R, ads); c.font = 'bold 9px Arial'; const bw = c.measureText(a[0]).width + 12; c.fillStyle = '#555'; c.fillRect(x + 6, h - 34, 3, 28); c.fillRect(x + bw - 8, h - 34, 3, 28); c.fillStyle = a[1]; c.fillRect(x, h - 62, bw, 28); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(x + 2, h - 60, bw - 4, 24); c.fillStyle = a[2]; c.textAlign = 'center'; c.fillText(a[0], x + bw / 2, h - 43); }
      else if (t < 0.5) { for (let i = 0; i < 4; i++) bush(c, x + i * 28, h - 8); }
      else if (t < 0.65) { c.fillStyle = '#8d6e63'; c.fillRect(x, h - 20, 36, 4); c.fillRect(x + 3, h - 16, 3, 10); c.fillRect(x + 30, h - 16, 3, 10); c.fillRect(x, h - 32, 36, 3); } // лавочка
      else if (t < 0.8) { c.strokeStyle = '#37474f'; c.lineWidth = 2; [[0, 0], [24, 0]].forEach(p => { c.beginPath(); c.arc(x + p[0] + 8, h - 15, 8, 0, 6.283); c.stroke(); }); c.beginPath(); c.moveTo(x + 8, h - 15); c.lineTo(x + 18, h - 28); c.lineTo(x + 32, h - 15); c.moveTo(x + 18, h - 28); c.lineTo(x + 14, h - 15); c.stroke(); } // велосипед
      else { c.fillStyle = '#f5f5f5'; for (let i = 0; i < 9; i++) { c.fillRect(x + i * 7, h - 34, 4, 28); } c.fillRect(x, h - 28, 63, 3); } // палисадник
    }
    for (let x = 60; x < w; x += 320) { c.fillStyle = '#546e7a'; c.fillRect(x, h - 66, 3, 62); c.fillRect(x, h - 66, 18, 3); c.fillStyle = '#fff59d'; c.fillRect(x + 14, h - 64, 9, 4); } // фонари
  });
}
function buildRoad(R) {
  return mk(256, 84, (c, w, h) => {
    c.fillStyle = '#4a4d52'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 450; i++) { c.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.12)'; c.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R()); }
    c.fillStyle = 'rgba(0,0,0,.14)'; c.fillRect(R() * 150, 10 + R() * 50, 50, 22); // заплатка
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1; c.beginPath(); let cx = R() * 200, cy = 5; c.moveTo(cx, cy); for (let i = 0; i < 6; i++) { cx += R() * 12 - 4; cy += 10 + R() * 8; c.lineTo(cx, cy); } c.stroke(); // трещина
    c.fillStyle = '#7b6a4d'; c.fillRect(0, 0, w, 4); c.fillRect(0, h - 4, w, 4); // песок на краях
  });
}
function buildBG(seed) { const R = mulberry(seed ^ 0x9e3779b9); return { far: buildFar(R), mid: buildMid(R), near: buildNear(R), road: buildRoad(R) }; }

/* ---------- render: отрисовка объектов ---------- */
function decal(c, k, x, y, w, h) {
  if (!k.fx) return; c.save(); c.fillStyle = k.acc;
  if (k.fx === 'camo') [[.2, .3], [.6, .2], [.5, .7], [.8, .8]].forEach(p => { c.beginPath(); c.ellipse(x + p[0] * w, y + p[1] * h, w * .16, h * .2, 0, 0, 6.283); c.fill(); });
  else if (k.fx === 'fire') for (let i = 0; i < 3; i++) { const fx = x + i * w / 3; c.beginPath(); c.moveTo(fx, y + h); c.lineTo(fx + w / 6, y); c.lineTo(fx + w / 3, y + h); c.fill(); }
  else [[.2, .3], [.7, .2], [.5, .7], [.85, .6]].forEach(p => c.fillRect(x + p[0] * w, y + p[1] * h, 2.2, 2.2));
  c.restore();
}
function wheel(c, x, y, wr) {
  c.save(); c.translate(x, y); c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(0, 0, 15, 0, 6.283); c.fill(); c.rotate(wr);
  c.fillStyle = '#3a3a3a'; for (let i = 0; i < 12; i++) { c.rotate(0.5236); c.fillRect(13, -1.5, 3, 3); }
  c.fillStyle = '#cfd8dc'; c.beginPath(); c.arc(0, 0, 9, 0, 6.283); c.fill();
  c.strokeStyle = '#78909c'; c.lineWidth = 1; for (let i = 0; i < 4; i++) { c.rotate(0.785); c.beginPath(); c.moveTo(-9, 0); c.lineTo(9, 0); c.stroke(); }
  c.fillStyle = '#455a64'; c.beginPath(); c.arc(0, 0, 2.5, 0, 6.283); c.fill(); c.restore();
}
function bikeBody(c, k, wr) { // начало координат — точка касания заднего колеса
  wheel(c, 0, -15, wr); wheel(c, 58, -15, wr); c.lineCap = 'round';
  c.strokeStyle = '#90a4ae'; c.lineWidth = 4; c.beginPath(); c.moveTo(26, -24); c.lineTo(8, -30); c.lineTo(-6, -34); c.stroke(); // выхлоп
  c.strokeStyle = '#b0bec5'; c.lineWidth = 4; c.beginPath(); c.moveTo(58, -15); c.lineTo(46, -52); c.stroke();                      // вилка
  c.strokeStyle = k.acc; c.lineWidth = 5; c.beginPath(); c.moveTo(0, -15); c.lineTo(24, -28); c.lineTo(30, -44); c.stroke();        // рама
  c.strokeStyle = k.bike; c.lineWidth = 3; c.beginPath(); c.arc(0, -15, 19, Math.PI * 1.05, Math.PI * 1.6); c.stroke(); c.beginPath(); c.arc(58, -15, 19, Math.PI * 1.4, Math.PI * 1.95); c.stroke(); // крылья
  c.fillStyle = k.bike; c.beginPath(); c.moveTo(20, -46); c.quadraticCurveTo(32, -62, 48, -50); c.lineTo(44, -40); c.lineTo(22, -38); c.closePath(); c.fill(); // бак
  decal(c, k, 24, -54, 20, 14);
  c.fillStyle = '#212121'; c.fillRect(2, -49, 22, 5); c.fillStyle = '#fff'; c.fillRect(-13, -35, 10, 6); c.fillStyle = '#222'; c.fillRect(-11, -33, 6, 1.5); // сиденье, номер
  c.strokeStyle = '#222'; c.lineWidth = 3; c.beginPath(); c.moveTo(46, -52); c.lineTo(42, -63); c.lineTo(50, -65); c.stroke();                 // руль
}
function rider(c, k, bob) {
  c.save(); c.translate(0, bob); c.lineCap = 'round'; c.lineJoin = 'round';
  c.fillStyle = k.pack; c.fillRect(2, -86, 15, 26); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(2, -72, 15, 2); // рюкзак
  c.strokeStyle = '#546e7a'; c.lineWidth = 9; c.beginPath(); c.moveTo(16, -52); c.lineTo(32, -44); c.stroke();      // шорты
  c.strokeStyle = '#f1c27d'; c.lineWidth = 6; c.beginPath(); c.moveTo(32, -44); c.lineTo(28, -29); c.stroke();      // голень
  c.fillStyle = '#fff'; c.fillRect(23, -30, 13, 6); c.fillStyle = '#e53935'; c.fillRect(23, -25, 13, 2);              // кроссовок
  c.strokeStyle = k.shirt; c.lineWidth = 15; c.beginPath(); c.moveTo(17, -55); c.lineTo(34, -78); c.stroke();        // майка
  decal(c, k, 20, -76, 14, 18);
  c.strokeStyle = k.shirt; c.lineWidth = 5; c.beginPath(); c.moveTo(34, -77); c.lineTo(44, -63); c.stroke();         // рука
  c.fillStyle = '#222'; c.beginPath(); c.arc(44, -62, 3, 0, 6.283); c.fill();
  c.fillStyle = k.helm; c.beginPath(); c.arc(40, -91, 10, 0, 6.283); c.fill();                                       // шлем
  c.fillStyle = '#212121'; c.beginPath(); c.ellipse(46, -90, 5.5, 4, 0, 0, 6.283); c.fill(); c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(44, -92, 4, 1.5); // визор
  c.restore();
}
function bikeFull(c, k, wr, bob) { bikeBody(c, k, wr); rider(c, k, bob); }
function drawCar(c, x, y, col, tilt) { // «Жигули» ВАЗ-2106, перед слева
  c.save(); if (tilt) { c.translate(x + 55, y); c.rotate(tilt); c.translate(-x - 55, -y); }
  c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x + 55, y + 1, 58, 5, 0, 0, 6.283); c.fill();
  c.fillStyle = col; c.beginPath(); c.moveTo(x, y - 8); c.lineTo(x, y - 20); c.lineTo(x + 4, y - 23); c.lineTo(x + 32, y - 24); c.lineTo(x + 40, y - 35); c.lineTo(x + 78, y - 35); c.lineTo(x + 88, y - 24); c.lineTo(x + 108, y - 23); c.lineTo(x + 110, y - 18); c.lineTo(x + 110, y - 8); c.closePath(); c.fill();
  c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(x, y - 14, 110, 2);
  c.fillStyle = '#b9dff0'; c.beginPath(); c.moveTo(x + 43, y - 33); c.lineTo(x + 76, y - 33); c.lineTo(x + 84, y - 24); c.lineTo(x + 36, y - 24); c.closePath(); c.fill();
  c.fillStyle = col; c.fillRect(x + 59, y - 33, 3, 9);
  c.fillStyle = '#fff'; c.beginPath(); c.arc(x + 7, y - 17, 4, 0, 6.283); c.fill(); c.strokeStyle = '#999'; c.lineWidth = 1; c.stroke();     // фара
  c.fillStyle = '#cfd8dc'; c.fillRect(x + 1, y - 14, 9, 5); c.fillStyle = '#e53935'; c.fillRect(x + 106, y - 20, 4, 5);                  // решётка, фонарь
  c.fillStyle = '#9e9e9e'; c.fillRect(x - 2, y - 9, 114, 3);                                                                              // бампер
  c.fillStyle = '#fafafa'; c.fillRect(x + 92, y - 14, 12, 5);                                                                             // номер
  c.fillStyle = '#555'; c.fillRect(x + 38, y - 27, 4, 3);                                                                                 // зеркало
  [20, 90].forEach(o => { c.fillStyle = '#111'; c.beginPath(); c.arc(x + o, y - 8, 8, 0, 6.283); c.fill(); c.fillStyle = '#b0bec5'; c.beginPath(); c.arc(x + o, y - 8, 4, 0, 6.283); c.fill(); });
  c.restore();
}
function bottle(c, x, y, t) {
  c.save(); c.translate(x, y + Math.sin(t * 4 + x) * 2);
  c.fillStyle = '#2b1a10'; c.beginPath(); c.moveTo(-7, 14); c.lineTo(-7, -4); c.quadraticCurveTo(-7, -8, -2, -10); c.lineTo(-2, -16); c.lineTo(2, -16); c.lineTo(2, -10); c.quadraticCurveTo(7, -8, 7, -4); c.lineTo(7, 14); c.closePath(); c.fill();
  c.fillStyle = '#c62828'; c.fillRect(-7, -3, 14, 12); c.fillStyle = '#9e9e9e'; c.fillRect(-2.5, -18, 5, 3);
  c.fillStyle = 'rgba(255,255,255,.45)'; c.fillRect(-5.5, -7, 1.6, 20);
  c.fillStyle = '#fff'; c.font = 'italic bold 4.5px sans-serif'; c.textAlign = 'center'; c.save(); c.rotate(-0.3); c.fillText('ГАЗЯВА', 0, 5); c.restore();
  c.restore();
}

/* ---------- частицы ---------- */
function spark(x, y, n, col, g) { for (let i = 0; i < n; i++) P.push({ x, y, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 140, l: 0.5, m: 0.5, col, g }); }

/* ---------- physics ---------- */
function step(dt) {
  if (G.st === 'menu') { B.x += 3 * CFG.ppm * dt; B.wr += 3 * CFG.ppm * dt / 15; A.engine(0, false); return; }
  if (G.st === 'crash') { crashStep(dt); partsStep(dt); return; }
  if (G.st !== 'play') return;
  G.t += dt;
  const cap = Math.min(CFG.maxKmh, CFG.cap0 + G.t * CFG.capGrow) / 3.6;
  if (keys.gas) B.v += CFG.accel * dt; else B.v -= CFG.drag * dt;
  if (keys.brake) B.v -= CFG.brake * dt;
  if (B.ang > 8 && B.h === 0) B.v += 0.6 * dt; // вили слегка разгоняет
  B.v = Math.max(0, Math.min(B.v, cap, CFG.maxKmh / 3.6));
  if (keys.jump) { keys.jump = 0; if (B.h === 0) { B.vy = CFG.jumpV; B.h = 0.01; } } // повторное нажатие в воздухе игнорируется
  if (B.h > 0) { B.h += B.vy * dt; B.vy -= CFG.g * dt; if (B.h <= 0) { B.h = 0; B.vy = 0; spark(B.x, RB, 6, '#d7ccc8', 0); } B.ang = Math.max(0, B.ang - CFG.wheelBack * dt); }
  else if (keys.wheelie) { B.ang += (35 + B.ang * 0.6) * dt; G.bonus += CFG.wheelBonus * B.v * dt; }
  else B.ang = Math.max(0, B.ang - CFG.wheelBack * dt);
  const hv = (B.h > 0 && B.v > 1) ? Math.max(B.v, CFG.airMin) : B.v; // воздушный бонус: прыжок гарантированно перелетает «Жигули»
  B.x += hv * CFG.ppm * dt; G.dist = B.x / CFG.ppm; B.wr += B.v * CFG.ppm * dt / 15;
  if (B.ang >= CFG.maxAngle) { crash('wheelie'); return; }
  genAhead(B.x + VW + 400);
  for (const c of L.cars) if (B.x + 52 > c.x && B.x + 4 < c.x + CFG.carW && B.h < CFG.carH) { G.hitCar = c; crash('car'); return; }
  for (let i = L.bots.length - 1; i >= 0; i--) {
    const b = L.bots[i];
    if (Math.abs(B.x + 28 - b.x) < 30 && Math.abs(B.h + 26 - b.h) < 34) {
      L.bots.splice(i, 1); G.bot++; wallet++; S.set('wallet', wallet); A.beep(); spark(b.x, RB - b.h, 10, '#ffeb3b', 200);
    }
  }
  L.cars = L.cars.filter(c => c.x > B.x - 400); L.bots = L.bots.filter(b => b.x > B.x - 400);
  if (B.h === 0 && B.v > 3 && Math.random() < 0.5) P.push({ x: B.x, y: RB - 2, vx: -30 - B.v * 4, vy: -20 - Math.random() * 20, l: 0.4, m: 0.4, col: '#d7ccc8', g: 0 });
  partsStep(dt); A.engine(B.v, true);
}
function partsStep(dt) { for (const p of P) { p.l -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; } P = P.filter(p => p.l > 0); }
function crash(type) {
  G.st = 'crash'; G.ct = 0; G.dur = type === 'car' ? CFG.crashCar : CFG.crashWheelie; G.camx = B.x - 110; A.engine(0, false);
  const sp = B.v * CFG.ppm, bx = B.x, by = RB - B.h;
  if (type === 'car') { G.rider = { x: bx + 30, y: by - 60, vx: sp * 1.1 + 60, vy: -320, r: 0, vr: 9 }; G.bk = { x: bx + 29, y: by - 20, vx: -40, vy: -120, r: 0, vr: -1.5 }; G.flash = 1; }
  else { G.rider = { x: bx + 10, y: by - 60, vx: sp * 0.3, vy: -260, r: -0.5, vr: -7 }; G.bk = { x: bx + 29, y: by - 20, vx: sp * 0.4, vy: -100, r: -1.4, vr: -2.5 }; }
  A.thud(); document.body.className = 'crash';
}
function crashStep(dt) {
  G.ct += dt; const d = dt * CFG.slow; G.flash = Math.max(0, G.flash - dt * 2.5);
  for (const o of [G.rider, G.bk]) {
    o.vy += CFG.g * d; o.x += o.vx * d; o.y += o.vy * d; o.r += o.vr * d;
    const fl = o === G.rider ? RB - 10 : RB - 18;
    if (o.y > fl) { o.y = fl; o.vy = -o.vy * 0.4; o.vx *= 0.6; o.vr *= 0.6; if (Math.abs(o.vy) < 30) o.vy = 0; }
    if (o.y >= fl - 0.5) o.vr *= 0.92;
  }
  if (G.ct > G.dur) over();
}
function over() {
  if (G.st === 'over') return;
  G.st = 'over'; const s = score(); if (s > best) { best = s; S.set('best', best); }
  $('oInfo').innerHTML = 'Очки: ' + s + '<br>Рекорд: ' + best + '<br>Бутылок за забег: ' + G.bot;
  document.body.className = 'over'; show('over');
}

/* ---------- render: кадр ---------- */
function tile(c, f, y, cam) {
  const lw = c.width / Q, lh = c.height / Q; let off = -(((cam * f) % lw) + lw) % lw; if (off > 0) off -= lw;
  for (let x = off; x < VW; x += lw) ctx.drawImage(c, x, y, lw, lh);
}
function draw() {
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
  const cam = G.st === 'crash' || G.st === 'over' ? G.camx : B.x - 110, tm = performance.now() / 1000;
  ctx.fillStyle = skyG; ctx.fillRect(0, 0, VW, VH);
  const sg = ctx.createRadialGradient(VW * .78, RT * .25, 4, VW * .78, RT * .25, 60); sg.addColorStop(0, '#fffde7'); sg.addColorStop(.35, '#ffee58'); sg.addColorStop(1, 'rgba(255,238,88,0)');
  ctx.fillStyle = sg; ctx.fillRect(VW * .78 - 60, RT * .25 - 60, 120, 120);
  tile(BG.far, 0.15, RT - 260, cam); tile(BG.mid, 0.5, RT - 170, cam); tile(BG.near, 0.9, RT - 70, cam);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; birds.forEach((b, i) => { // птицы
    const bx = (((b.x - cam * 0.12 + tm * 15) % (VW + 60)) + VW + 60) % (VW + 60) - 30, by = b.y + Math.sin(tm * 2 + i) * 4, f = Math.sin(tm * 8 + i) * 4 * b.s;
    ctx.beginPath(); ctx.moveTo(bx - 7 * b.s, by - f); ctx.lineTo(bx, by); ctx.lineTo(bx + 7 * b.s, by - f); ctx.stroke();
  });
  // дорога
  let ox = -(((cam % 256) + 256) % 256); for (let x = ox; x < VW; x += 256) ctx.drawImage(BG.road, x, RT, 256, 84);
  ctx.fillStyle = '#ddd'; ctx.fillRect(0, RT + 84, VW, 4); const gg = ctx.createLinearGradient(0, RT + 88, 0, VH); gg.addColorStop(0, '#6aa84f'); gg.addColorStop(1, '#3f7d32'); ctx.fillStyle = gg; ctx.fillRect(0, RT + 88, VW, VH - RT - 88);
  ctx.fillStyle = 'rgba(255,255,255,.85)'; const dox = -(((cam % 80) + 80) % 80); for (let x = dox; x < VW; x += 80) ctx.fillRect(x, RT + 40, 40, 4);
  // сущности
  if (G.st !== 'menu') {
    for (const c of L.cars) { const sx = c.x - cam; if (sx > -130 && sx < VW + 20) drawCar(ctx, sx, RB, c.c, c === G.hitCar && G.st !== 'play' ? Math.sin(G.ct * 20) * Math.exp(-G.ct * 3) * 0.04 : 0); }
    for (const b of L.bots) { const sx = b.x - cam; if (sx > -20 && sx < VW + 20) bottle(ctx, sx, RB - b.h, tm); }
  }
  // байк
  const sx = B.x - cam;
  if (G.st === 'play' || G.st === 'menu' || G.st === 'start') {
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(sx + 29, RB, 38 - B.h * 0.1, 5, 0, 0, 6.283); ctx.fill();
    ctx.save(); ctx.translate(sx, RB - B.h); ctx.rotate(-B.ang * Math.PI / 180 - (B.h > 0 ? B.vy * 0.0006 : 0));
    bikeFull(ctx, skin(), B.wr, B.h === 0 ? Math.sin(tm * 18) * Math.min(B.v / 14, 1) * 0.9 : 0); ctx.restore();
    if (G.st === 'play' && B.ang > 2) { // индикатор угла вили
      const r = B.ang / CFG.maxAngle, bx = sx + 64, by = RB - B.h - 140; ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(bx, by, 44, 7);
      ctx.fillStyle = 'hsl(' + (120 - 120 * Math.min(r, 1)) + ',90%,50%)'; ctx.fillRect(bx + 1, by + 1, 42 * Math.min(r, 1), 5);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'left'; ctx.fillText(Math.round(B.ang) + '°', bx, by - 3);
    }
  } else {
    ctx.save(); ctx.translate(G.bk.x - cam, G.bk.y); ctx.rotate(G.bk.r); ctx.translate(-29, 20); bikeBody(ctx, skin(), B.wr); ctx.restore();
    ctx.save(); ctx.translate(G.rider.x - cam, G.rider.y); ctx.rotate(G.rider.r); ctx.translate(-26, 66); rider(ctx, skin(), 0); ctx.restore();
  }
  for (const p of P) { ctx.globalAlpha = Math.max(0, p.l / p.m); ctx.fillStyle = p.col; ctx.fillRect(p.x - cam, p.y, 3, 3); } ctx.globalAlpha = 1;
  if (G.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + G.flash * 0.7 + ')'; ctx.fillRect(0, 0, VW, VH); }
  if (G.st === 'play' || G.st === 'crash') hud();
}
function hud() {
  ctx.textAlign = 'left'; ctx.font = 'bold 22px "Arial Black",Arial'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = '#fff';
  const t1 = 'Очки: ' + score(); ctx.strokeText(t1, 12, 34); ctx.fillText(t1, 12, 34);
  ctx.font = 'bold 14px Arial'; const t2 = 'Рекорд: ' + best, t3 = 'ГАЗЯВА: ' + wallet; ctx.strokeText(t2, 12, 54); ctx.fillText(t2, 12, 54); ctx.fillStyle = '#ffeb3b'; ctx.strokeText(t3, 12, 74); ctx.fillText(t3, 12, 74);
  // спидометр (экранные координаты)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const iw = innerWidth, ih = innerHeight, cx = iw / 2, cy = ih - 14, r = Math.min(64, iw * 0.17), kmh = B.v * 3.6;
  ctx.fillStyle = 'rgba(15,20,30,.78)'; ctx.beginPath(); ctx.arc(cx, cy, r + 6, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) { const a = Math.PI + i / 5 * Math.PI, ca = Math.cos(a), sa = Math.sin(a); ctx.beginPath(); ctx.moveTo(cx + ca * (r - 7), cy + sa * (r - 7)); ctx.lineTo(cx + ca * r, cy + sa * r); ctx.stroke(); ctx.fillText(i * 10, cx + ca * (r - 17), cy + sa * (r - 17) + 3); }
  const a = Math.PI + Math.min(kmh, 50) / 50 * Math.PI; ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 15px "Arial Black",Arial'; ctx.fillText(Math.round(kmh) + ' км/ч', cx, cy - 8);
}

/* ---------- ui: экраны, магазин ---------- */
function show(id) { ['start', 'over', 'shop'].forEach(s => $(s).classList.toggle('hide', s !== id)); if (id === 'start' || id === 'over') G.prev = id; ui(); }
function ui() { $('sInfo').innerHTML = 'Рекорд: ' + best + '<br>ГАЗЯВА: ' + wallet; $('shInfo').textContent = 'ГАЗЯВА: ' + wallet; $('snd').textContent = snd ? '🔊' : '🔇'; }
function startRun() { A.init(); A.resume(); reset(); G.st = 'play'; show(null); document.body.className = 'play'; A.playMusic(); }
function shop() {
  const l = $('list'); l.innerHTML = '';
  SKINS.forEach(k => {
    const row = document.createElement('div'); row.className = 'row';
    const cvs = document.createElement('canvas'); cvs.width = 240; cvs.height = 200; const c = cvs.getContext('2d'); c.scale(2, 2); c.translate(26, 92); c.scale(0.85, 0.85); bikeFull(c, k, 0.5, 0);
    const t = document.createElement('div'); t.className = 't'; const has = owned.includes(k.id); t.innerHTML = k.n + '<br>' + (k.p ? k.p + ' бутылок' : 'бесплатно');
    const b = document.createElement('button'); b.className = 'btn';
    if (has) { b.textContent = skinId === k.id ? 'Выбрано' : 'Выбрать'; b.disabled = skinId === k.id; b.onclick = () => { skinId = k.id; S.set('skin', skinId); shop(); }; }
    else if (wallet >= k.p) { b.textContent = 'Купить'; b.onclick = () => { wallet -= k.p; owned.push(k.id); skinId = k.id; S.set('wallet', wallet); S.set('owned', owned); S.set('skin', skinId); shop(); ui(); }; }
    else { b.textContent = 'Не хватает ' + (k.p - wallet); b.disabled = true; }
    row.append(cvs, t, b); l.appendChild(row);
  });
  ui();
}
document.querySelectorAll('.shopbtn').forEach(b => b.onclick = () => { show('shop'); shop(); });
$('back').onclick = () => show(G.prev);
$('play').onclick = startRun; $('again').onclick = startRun;
$('snd').onclick = e => { e.stopPropagation(); snd = !snd; S.set('snd', snd); if (A.music) { snd ? A.playMusic() : A.stopMusic(); } if (!snd) A.engine(0, false); ui(); };

/* ---------- input ---------- */
document.querySelectorAll('.ctl button').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} keys[k] = 1; b.classList.add('on'); });
  const up = () => { if (k !== 'jump') keys[k] = 0; b.classList.remove('on'); };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, up));
  b.addEventListener('contextmenu', e => e.preventDefault());
});
const KM = { ArrowRight: 'gas', ArrowLeft: 'brake', Space: 'jump', ArrowUp: 'wheelie', KeyW: 'wheelie' };
addEventListener('keydown', e => { const k = KM[e.code]; if (k) { keys[k] = 1; e.preventDefault(); } });
addEventListener('keyup', e => { const k = KM[e.code]; if (k && k !== 'jump') keys[k] = 0; });
cv.addEventListener('pointerdown', () => { if (G.st === 'crash' && G.ct > 0.2) over(); }); // тап пропускает ролик
document.addEventListener('visibilitychange', () => { // пауза при переключении вкладки
  G.paused = document.hidden; if (document.hidden) { A.stopMusic(); A.engine(0, false); } else if (G.st !== 'menu') A.playMusic();
});
addEventListener('contextmenu', e => e.preventDefault());

/* ---------- main loop: фиксированный шаг ---------- */
let last = 0, acc = 0;
function loop(ts) {
  requestAnimationFrame(loop); if (!last) last = ts; let dt = (ts - last) / 1000; last = ts; if (dt > 0.1) dt = 0.1;
  if (G.paused) return; acc += dt; while (acc >= 1 / 60) { step(1 / 60); acc -= 1 / 60; } draw();
}
resize(); reset(); G.st = 'menu'; ui(); requestAnimationFrame(loop);
