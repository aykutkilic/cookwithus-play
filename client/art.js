// Procedural Canvas-2D art for cookwithus: every ingredient, vessel, tool and
// plated dish is drawn with paths – no images. Cozy, chunky cartoon style:
// rounded squashy shapes, a thick warm outline, flat fills with one soft
// highlight blob and one shade along the bottom-right.
//
// Conventions shared by every public function:
//   (x, y)  bottom-centre resting point of the thing (tools: the active point)
//   s       scale; s = 1 → a tomato is ~110 px wide, a pot ~190 px
//   t       time in seconds, only used for tiny idle animations
// Every call leaves the context state exactly as it found it.
//
// Ingredient / vessel looks are driven by the `art` descriptors in
// shared/ingredients.js: `type` picks a generic routine and c1/c2/c3 (+ flags)
// parameterise it, so a new kind only needs a descriptor. `kind` may also be
// an art descriptor object itself ({type:'round', c1:…}).
//
// Ingredient state (all optional): qty, washed, peeled 0..1, boiled, cook 0..1,
//   cut + k/n (see drawIngredient), seed (int, varies random layouts), and
//   dough: shape 'rough'|'ball'|'flat', size, form 'round'|'oval'|'boat',
//          sauce, coverage, toppings [{kind,x,y}] (also 'olive')
//   leaf:  filled, fill (#hex filling), cut 'rolls' (+k/n)
//   head:  cored, cut 'leaves' (+k/n)
//   egg:   cut 'cracked' (fried / raw in the pan, cook firms it) | 'beaten'
//   slit:  filling (#hex or true) → stuffed (karnıyarık)
//   containers (bottle, carton, jar, can, sack, tea): open
//   cut aliases: sliced, diced, chopped, julienne, minced, quarters, …
// Vessel extras: noTop (çaydanlık without its top pot; result.lower = lower
//   mouth), liquid2 (top-pot colour), on (blender running), hot / steam
//   (steam without boiling), items[i].s (scale multiplier). bakingDish lid =
//   foil. Every public function swallows (and console.warns once) internal
//   errors so a drawing bug can never take down the game loop.

import { INGREDIENTS, VESSELS } from '../shared/ingredients.js';

export const OUTLINE = '#3d2a24';

const TAU = Math.PI * 2;
const PI = Math.PI;
const SHADE = 'rgba(86,36,18,0.2)';      // the one shade, laid over fills
const HL = 'rgba(255,255,255,0.38)';      // the one highlight blob

let LW = 3.2;      // outline width in local units (≈3.2 px at s=1, never < ~1.1 px)
let SC = 1;        // effective px per local unit
let DEPTH = 0;

// ---------------------------------------------------------------- small utils
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  str = String(str);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- colour
const _rgb = new Map();
function rgbOf(col) {
  let v = _rgb.get(col);
  if (v) return v;
  let r = 200, g = 200, b = 200;
  if (typeof col === 'string' && col[0] === '#') {
    if (col.length === 4) {
      r = parseInt(col[1] + col[1], 16); g = parseInt(col[2] + col[2], 16); b = parseInt(col[3] + col[3], 16);
    } else if (col.length >= 7) {
      r = parseInt(col.slice(1, 3), 16); g = parseInt(col.slice(3, 5), 16); b = parseInt(col.slice(5, 7), 16);
    }
    if (!(r >= 0 && g >= 0 && b >= 0)) r = g = b = 200;
  }
  v = [r, g, b];
  if (_rgb.size > 2000) _rgb.clear();
  _rgb.set(col, v);
  return v;
}
const h2 = (v) => { v = clamp(Math.round(v), 0, 255); return (v < 16 ? '0' : '') + v.toString(16); };
const toHex = (r, g, b) => '#' + h2(r) + h2(g) + h2(b);
const _col = new Map();
function memo(key, f) {
  let v = _col.get(key);
  if (v === undefined) { if (_col.size > 6000) _col.clear(); v = f(); _col.set(key, v); }
  return v;
}

// Lighten (amt > 0, towards a warm white) or darken (amt < 0, slightly warm) a colour.
export function shade(hex, amt) {
  amt = Math.round(clamp(num(amt), -1, 1) * 100) / 100;
  if (!amt) return typeof hex === 'string' ? hex : '#c8c8c8';
  return memo('s' + hex + amt, () => {
    const [r, g, b] = rgbOf(hex);
    if (amt > 0) return toHex(r + (255 - r) * amt, g + (250 - g) * amt, b + (238 - b) * amt);
    const k = 1 + amt, w = -amt;
    return toHex(r * k + 22 * w, g * k + 6 * w, b * k);
  });
}
function mix(a, b, t) {
  t = Math.round(clamp(num(t), 0, 1) * 50) / 50;
  if (t <= 0) return a;
  if (t >= 1) return b;
  return memo('m' + a + b + t, () => {
    const A = rgbOf(a), B = rgbOf(b);
    return toHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
  });
}
function rgba(col, al) {
  al = Math.round(clamp(al, 0, 1) * 100) / 100;
  return memo('a' + col + al, () => { const [r, g, b] = rgbOf(col); return `rgba(${r},${g},${b},${al})`; });
}
function lum(col) { const [r, g, b] = rgbOf(col); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
function sat(col) { const [r, g, b] = rgbOf(col); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; }

// ---------------------------------------------------------------- context entry / exit
function enter(c, x, y, s, ang) {
  c.save();
  c.translate(num(x), num(y));
  if (ang) c.rotate(ang);
  s = num(s, 1) || 1;
  if (s !== 1) c.scale(s, s);
  const prev = SC;
  SC = DEPTH ? SC * Math.abs(s) : Math.abs(s);
  if (!DEPTH && c.setLineDash) c.setLineDash([]);
  DEPTH++;
  LW = Math.max(3.2, 1.15 / SC);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = OUTLINE;
  c.lineWidth = LW;
  return prev;
}
function leave(c, prev) {
  DEPTH = Math.max(0, DEPTH - 1);
  SC = prev;
  LW = Math.max(3.2, 1.15 / SC);
  c.restore();
}
// A drawing bug must never take the game loop down: report once, keep going.
const _oops = new Set();
function oops(where, e) {
  const key = where + ':' + (e && e.message);
  if (_oops.has(key)) return;
  _oops.add(key);
  if (typeof console !== 'undefined') console.warn('[art] ' + where, e);
}
// Local sub-transform inside an already entered drawing (keeps LW / SC right).
function sub(c, x, y, s, fn, ang) {
  const prev = enter(c, x, y, s, ang);
  try { fn(); } finally { leave(c, prev); }
}
const tiny = () => SC < 0.34;   // skip fine detail when drawn small

// ---------------------------------------------------------------- path helpers
function E(c, x, y, rx, ry, rot = 0) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  c.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
}
function RR(c, x, y, w, h, r) {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
// Smooth closed curve through a flat [x0,y0,x1,y1…] point list (quadratic through midpoints).
function smoothClosed(c, p) {
  const n = p.length >> 1;
  if (n < 3) return;
  c.moveTo((p[2 * n - 2] + p[0]) / 2, (p[2 * n - 1] + p[1]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    c.quadraticCurveTo(p[2 * i], p[2 * i + 1], (p[2 * i] + p[2 * j]) / 2, (p[2 * i + 1] + p[2 * j + 1]) / 2);
  }
  c.closePath();
}
// Smooth open curve through points (continues the current sub-path).
function smoothOpen(c, p, move) {
  const n = p.length >> 1;
  if (move) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]);
  if (n === 2) { c.lineTo(p[2], p[3]); return; }
  for (let i = 1; i < n - 1; i++) {
    c.quadraticCurveTo(p[2 * i], p[2 * i + 1], (p[2 * i] + p[2 * i + 2]) / 2, (p[2 * i + 1] + p[2 * i + 3]) / 2);
  }
  c.lineTo(p[2 * n - 2], p[2 * n - 1]);
}
// Wobbly blob through n points around an ellipse (stable for a seed).
function blobPts(cx, cy, rx, ry, n, wob, seed, rot = 0) {
  const r = rng(seed), p = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU, k = 1 + (r() - 0.5) * 2 * wob;
    p.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
  }
  return p;
}
// Squashy egg-ish ellipse sitting on its bottom (flatter base).
function squash(c, x, cy, rx, ry) {
  c.moveTo(x + rx, cy);
  c.bezierCurveTo(x + rx, cy + ry * 0.8, x + rx * 0.62, cy + ry, x, cy + ry);
  c.bezierCurveTo(x - rx * 0.62, cy + ry, x - rx, cy + ry * 0.8, x - rx, cy);
  c.bezierCurveTo(x - rx, cy - ry * 0.56, x - rx * 0.56, cy - ry, x, cy - ry);
  c.bezierCurveTo(x + rx * 0.56, cy - ry, x + rx, cy - ry * 0.56, x + rx, cy);
  c.closePath();
}

// Fill + stroke the current path.
function fs(c, fill, lw) {
  if (fill) { c.fillStyle = fill; c.fill(); }
  c.lineWidth = lw || LW;
  c.strokeStyle = OUTLINE;
  c.stroke();
}
function strokeIn(c, col, w) { c.strokeStyle = col; c.lineWidth = w; c.stroke(); }

// The house style: flat fill, details clipped inside, one shade crescent
// (bottom-right, by dx/dy), one highlight blob, thick outline.
//   o = { dx, dy, hl:[x,y,rx,ry,rot], detail(c), after(c), noStroke, lw, shade }
function paint(c, path, fill, o) {
  c.beginPath(); path(c);
  c.fillStyle = fill; c.fill();
  if (o) {
    const dx = o.dx || 0, dy = o.dy || 0;
    if (o.detail || dx || dy || o.hl || o.after) {
      c.save();
      c.clip();
      if (o.detail) o.detail(c);
      if (dx || dy) {
        c.beginPath();
        c.rect(-4000, -4000, 8000, 8000);
        c.translate(-dx, -dy); path(c); c.translate(dx, dy);
        c.fillStyle = o.shade || SHADE;
        c.fill('evenodd');
      }
      if (o.hl) {
        const h = o.hl;
        c.fillStyle = HL;
        c.beginPath(); E(c, h[0], h[1], h[2], h[3], h[4] || 0); c.fill();
      }
      if (o.after) o.after(c);
      c.restore();
    }
    if (o.noStroke) return;
  }
  c.beginPath(); path(c);
  c.lineWidth = (o && o.lw) || LW;
  c.strokeStyle = OUTLINE;
  c.stroke();
}
// Quick ellipse in house style.
function ball(c, x, y, rx, ry, fill, o) {
  paint(c, (q) => E(q, x, y, rx, ry, (o && o.rot) || 0), fill, Object.assign({
    dx: rx * 0.16, dy: ry * 0.2, hl: tiny() ? null : [x - rx * 0.35, y - ry * 0.4, rx * 0.3, ry * 0.2, -0.5],
  }, o || {}));
}
function shine(c, x, y, r) {
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.beginPath(); E(c, x, y, r, r * 0.8, -0.5); c.fill();
}
function line(c, pts, col, w) {
  c.beginPath(); smoothOpen(c, pts, true);
  c.strokeStyle = col; c.lineWidth = w; c.stroke();
}

// ---------------------------------------------------------------- tiny fx
function drop(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y - r * 1.7);
  c.bezierCurveTo(x + r * 0.25, y - r * 1.05, x + r, y - r * 0.45, x + r, y + r * 0.1);
  c.arc(x, y + r * 0.1, r, 0, PI, false);
  c.bezierCurveTo(x - r, y - r * 0.45, x - r * 0.25, y - r * 1.05, x, y - r * 1.7);
  c.closePath();
  c.fillStyle = 'rgba(190,232,252,0.92)'; c.fill();
  c.lineWidth = LW * 0.55; c.strokeStyle = 'rgba(40,90,130,0.8)'; c.stroke();
  c.fillStyle = '#fff';
  c.beginPath(); E(c, x - r * 0.35, y - r * 0.1, r * 0.28, r * 0.4, -0.3); c.fill();
}
function sparkle(c, x, y, r, al) {
  if (al <= 0.02) return;
  c.save();
  c.globalAlpha *= al;
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.quadraticCurveTo(x, y, x, y + r);
  c.quadraticCurveTo(x, y, x - r, y);
  c.quadraticCurveTo(x, y, x, y - r);
  c.fill();
  c.lineWidth = LW * 0.35; c.strokeStyle = 'rgba(255,240,200,0.9)'; c.stroke();
  c.restore();
}
// Water droplets + a twinkle over a w×h item (bottom-centre origin).
function wetFx(c, w, h, t, seed) {
  const r = rng(seed);
  const n = tiny() ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * w * 0.7, y = -h * (0.3 + r() * 0.5);
    drop(c, x, y, clamp(Math.min(w, h) * 0.055, 3.5, 7) * (0.8 + r() * 0.4));
  }
  const tw = 0.5 + 0.5 * Math.sin(t * 3.1 + seed % 9);
  sparkle(c, w * 0.22, -h * 0.82, clamp(h * 0.12, 6, 13) * (0.6 + 0.4 * tw), 0.4 + 0.6 * tw);
  // extra wet shine streak
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = Math.max(LW * 0.8, 2);
  c.beginPath(); c.moveTo(-w * 0.28, -h * 0.55); c.quadraticCurveTo(-w * 0.3, -h * 0.72, -w * 0.18, -h * 0.8); c.stroke();
}
function steamFx(c, x, y, w, amt, t, seed = 0) {
  amt = clamp(amt, 0, 1);
  if (amt <= 0) return;
  const n = amt > 0.45 ? 3 : 2;
  c.save();
  c.lineCap = 'round';
  const ga = c.globalAlpha;
  for (let i = 0; i < n; i++) {
    const ph = (((t * 0.42 + i / n + (seed % 7) * 0.137) % 1) + 1) % 1;
    const al = Math.sin(ph * PI) * (0.35 + 0.45 * amt);
    const bx = x + (i - (n - 1) / 2) * w * 0.34 + Math.sin(t * 1.6 + i * 2.1) * 5;
    const by = y - 12 - ph * 62;
    const sw = 6 + ph * 7;
    c.beginPath();
    c.moveTo(bx, by + 20);
    c.bezierCurveTo(bx - 11, by + 9, bx + 11, by - 3, bx, by - 18);
    c.globalAlpha = ga * al * 0.35; c.strokeStyle = 'rgba(110,80,70,1)'; c.lineWidth = sw + 3; c.stroke();
    c.globalAlpha = ga * al; c.strokeStyle = '#ffffff'; c.lineWidth = sw; c.stroke();
  }
  c.restore();
}

// ---------------------------------------------------------------- descriptors
const FALLBACK_ART = { type: 'round', c1: '#c8b48c', c2: '#f2e6c8', c3: '#8a7350' };
function artOf(kind) {
  if (kind && typeof kind === 'object') return kind.art || kind;
  const i = INGREDIENTS[kind];
  if (i && i.art) return i.art;
  const v = VESSELS[kind];
  if (v && v.art) return v.art;
  return FALLBACK_ART;
}
const MEATY = { chunk: 1, mince: 1, drumstick: 1, strips: 1, sausage: 1 };
// Colour things go towards when cooked: [outside/skin, inside/flesh].
function cookTo(a) {
  if (a.cookTo) return [a.cookTo, a.cookTo];
  switch (a.type) {
    case 'block':
      if (MEATY[a.shape]) return ['#8a4f2e', '#b77a4c'];
      if (a.shape === 'log') return ['#7a2a24', '#b8484a'];
      if (a.shape === 'fillet') return ['#e8c48a', '#f6e8d0'];
      if (a.shape === 'shrimp') return ['#f2683a', '#f8a888'];
      if (a.shape === 'shell') return ['#2a2a40', '#f08a3a'];
      if (a.shape === 'loaf' || a.shape === 'finger') return ['#9a5a22', '#d8a050'];
      return ['#e0a440', '#f0c060'];
    case 'round':
      if (a.tip && !a.segments) return ['#b8742a', '#e0a845'];
      if (a.spots) return ['#a8742e', '#e8b44a'];
      return [shade(a.c1, -0.25), mix(a.c2 || a.c1, '#b8742a', 0.5)];
    case 'long':
      if ((a.taper || 0) < 0) return ['#3c2232', '#a87a4a'];
      return [shade(a.c1, -0.3), mix(a.c2 || a.c1, '#c08a3a', 0.55)];
    case 'egg': return ['#e8b860', '#fff3d8'];
    case 'mushroom': return ['#9a6438', '#b88a58'];
    case 'herb': case 'leaf': case 'head': return ['#5a7a2a', '#8aa04a'];
    case 'pile': return [shade(a.c1, -0.2), mix(a.c1, '#c08a4a', 0.4)];
    case 'dough': return ['#d4903a', '#e8b860'];
    case 'bulb': return ['#d8a04a', '#e8b860'];
    default: return ['#a8702e', '#c89048'];
  }
}
function pal(a, st) {
  const ck = clamp(num(st && st.cook), 0, 1);
  let c1 = a.c1 || '#cccccc', c2 = a.c2 || c1, c3 = a.c3 || c2;
  if (ck > 0) {
    const [t1, t2] = cookTo(a);
    c1 = mix(c1, t1, ck * 0.85);
    c2 = mix(c2, t2, ck * 0.8);
    c3 = mix(c3, t2, ck * 0.35);
  }
  return { c1, c2, c3, ck, stem: a.stem || a.c3 || '#4f8a3a' };
}

// Outlined stroke: a coloured line with the house outline around it (stems, handles…).
function tube(c, pts, col, w, move = true) {
  c.beginPath(); smoothOpen(c, pts, move);
  c.strokeStyle = OUTLINE; c.lineWidth = w + LW * 1.7; c.stroke();
  c.strokeStyle = col; c.lineWidth = w; c.stroke();
}
// Union of several closed parts with one shared outline / shade / highlight.
function paintU(c, parts, fill, o = {}) {
  c.beginPath(); for (const p of parts) p(c);
  c.lineWidth = (o.lw || LW) * 2; c.strokeStyle = OUTLINE; c.stroke();
  c.fillStyle = fill; c.fill();
  c.save(); c.clip();
  if (o.detail) o.detail(c);
  const dx = o.dx || 0, dy = o.dy || 0;
  if (dx || dy) {
    c.save();
    for (const p of parts) {
      c.beginPath(); c.rect(-4000, -4000, 8000, 8000);
      c.translate(-dx, -dy); p(c); c.translate(dx, dy);
      c.clip('evenodd');
    }
    c.fillStyle = o.shade || SHADE; c.fillRect(-4000, -4000, 8000, 8000);
    c.restore();
  }
  if (o.hl) { const h = o.hl; c.fillStyle = HL; c.beginPath(); E(c, h[0], h[1], h[2], h[3], h[4] || 0); c.fill(); }
  if (o.after) o.after(c);
  c.restore();
}

// ================================================================ produce: round
const R0 = 50;
function roundDims(a) { return { rx: R0 * (a.sx || 1), ry: R0 * (a.sy || 1) }; }
function peeledBulb(a, P) { return a.type === 'bulb' ? P.c2 : mix(P.c3, P.c2, 0.3); }

function roundPath(a, rx, ry, seed) {
  const cy = -ry, top = -2 * ry;
  if (a.tip && !a.segments) return (c) => {
    c.moveTo(0, top - 12);
    c.bezierCurveTo(4, top + 2, rx * 0.95, cy - ry * 0.72, rx, cy + ry * 0.08);
    c.bezierCurveTo(rx * 1.02, cy + ry * 0.78, rx * 0.55, 0, 0, 0);
    c.bezierCurveTo(-rx * 0.55, 0, -rx * 1.02, cy + ry * 0.78, -rx, cy + ry * 0.08);
    c.bezierCurveTo(-rx * 0.95, cy - ry * 0.72, -4, top + 2, 0, top - 12);
    c.closePath();
  };
  if (a.lobes) return (c) => {
    c.moveTo(0, top + 9);
    c.bezierCurveTo(rx * 0.3, top - 4, rx * 0.95, top - 2, rx * 0.98, cy - ry * 0.2);
    c.bezierCurveTo(rx * 1.03, cy + ry * 0.55, rx * 0.86, -1, rx * 0.5, 0);
    c.bezierCurveTo(rx * 0.32, 1, rx * 0.22, -5, rx * 0.13, -7);
    c.bezierCurveTo(rx * 0.06, -3, -rx * 0.06, -3, -rx * 0.13, -7);
    c.bezierCurveTo(-rx * 0.22, -5, -rx * 0.32, 1, -rx * 0.5, 0);
    c.bezierCurveTo(-rx * 0.86, -1, -rx * 1.03, cy + ry * 0.55, -rx * 0.98, cy - ry * 0.2);
    c.bezierCurveTo(-rx * 0.95, top - 2, -rx * 0.3, top - 4, 0, top + 9);
    c.closePath();
  };
  if (a.segments) return (c) => {
    c.moveTo(-rx - 11, cy);
    c.bezierCurveTo(-rx - 3, cy - 7, -rx * 0.92, cy - ry, 0, cy - ry);
    c.bezierCurveTo(rx * 0.92, cy - ry, rx + 3, cy - 7, rx + 11, cy);
    c.bezierCurveTo(rx + 3, cy + 7, rx * 0.92, cy + ry, 0, cy + ry);
    c.bezierCurveTo(-rx * 0.92, cy + ry, -rx - 3, cy + 7, -rx - 11, cy);
    c.closePath();
  };
  if (a.spots) {
    const p = blobPts(0, cy, rx, ry, 9, 0.07, seed, 0.3);
    for (let i = 1; i < p.length; i += 2) p[i] = Math.min(p[i], 2);
    return (c) => smoothClosed(c, p);
  }
  return (c) => squash(c, 0, cy, rx, ry);
}
function calyx(c, x, y, r, col, n = 5) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a0 = -PI / 2 + 0.3 + (i / n) * TAU;
    const tx = Math.cos(a0) * r, ty = Math.sin(a0) * r * 0.42 + Math.abs(Math.cos(a0)) * r * 0.28;
    const L = Math.hypot(tx, ty), an = Math.atan2(ty, tx), w = r * 0.5, ca = Math.cos(an), sa = Math.sin(an);
    const pt = (u, v) => [x + u * ca - v * sa, y + u * sa + v * ca];
    parts.push((q) => {
      const p1 = pt(L * 0.45, -w), p2 = pt(L, 0), p3 = pt(L * 0.45, w);
      q.moveTo(x, y); q.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]); q.quadraticCurveTo(p3[0], p3[1], x, y); q.closePath();
    });
  }
  parts.push((q) => E(q, x, y, r * 0.32, r * 0.2));
  paintU(c, parts, col, { lw: LW * 0.85, hl: [x - r * 0.3, y - r * 0.1, r * 0.2, r * 0.08] });
  tube(c, [x, y - 1, x + 1, y - 8, x + 5, y - 13], shade(col, -0.05), 5);
}
function peelStrips(q, rx, ry, cy, peeled, flesh) {
  q.fillStyle = flesh;
  if (peeled >= 0.995) { q.fillRect(-rx * 2, cy - ry * 2, rx * 4, ry * 4); return; }
  const order = [0.05, -0.55, 0.6, -0.25, 0.33, -0.86, 0.86, -0.02];
  const n = Math.max(1, Math.round(peeled * order.length));
  for (let i = 0; i < n; i++) {
    const ox = order[i] * rx;
    q.beginPath(); E(q, ox, cy, rx * 0.2, ry * 1.1, order[i] * 0.3);
    q.fillStyle = flesh; q.fill();
    q.lineWidth = LW * 0.45; q.strokeStyle = shade(flesh, -0.22); q.stroke();
  }
}

// A papery skin flap peeled back from x = fx, curling outwards.
function papFlap(c, fx, cy, rx, ry, col) {
  c.beginPath();
  c.moveTo(fx, cy - ry * 0.55);
  c.bezierCurveTo(fx + rx * 0.45, cy - ry * 0.8, fx + rx * 1.05, cy - ry * 0.35, fx + rx * 1.0, cy + ry * 0.3);
  c.quadraticCurveTo(fx + rx * 0.82, cy + ry * 0.12, fx + rx * 0.74, cy + ry * 0.42);
  c.quadraticCurveTo(fx + rx * 0.38, cy + ry * 0.45, fx, cy + ry * 0.55);
  c.closePath();
  fs(c, shade(col, 0.32));
  if (!tiny()) {
    c.beginPath(); c.moveTo(fx + 3, cy - ry * 0.3); c.quadraticCurveTo(fx + rx * 0.55, cy - ry * 0.3, fx + rx * 0.82, cy + ry * 0.1);
    c.moveTo(fx + 3, cy + ry * 0.1); c.quadraticCurveTo(fx + rx * 0.4, cy + ry * 0.05, fx + rx * 0.62, cy + ry * 0.35);
    strokeIn(c, shade(col, 0.05), LW * 0.45);
  }
}
function drawRound(c, a, P, st, t, seed) {
  const { rx, ry } = roundDims(a), cy = -ry, top = -2 * ry;
  const papery = a.tip && !a.segments;
  const peeled = clamp(num(st.peeled), 0, 1);
  const path = roundPath(a, rx, ry, seed);
  const pb = peeledBulb(a, P);
  const xb = rx * (1 - 2.1 * peeled);
  paint(c, path, papery && peeled >= 1 ? pb : P.c1, {
    dx: rx * 0.12, dy: ry * 0.16,
    hl: [-rx * 0.4, cy - ry * 0.42, rx * 0.24, ry * 0.15, -0.6],
    detail: (q) => {
      if (papery) {
        if (peeled > 0 && peeled < 1) {
          q.fillStyle = pb; q.fillRect(xb, top - 20, rx * 3, ry * 3);
          q.beginPath(); q.moveTo(xb, top - 10);
          for (let i = 1; i <= 8; i++) q.lineTo(xb + (i % 2 ? 4 : -3), top - 10 + i * (ry * 2 + 12) / 8);
          strokeIn(q, shade(P.c1, -0.3), LW * 0.6);
        }
        if (!tiny()) {
          const mcol = peeled >= 1 ? shade(pb, -0.14) : shade(P.c1, -0.22);
          for (const k of [-0.62, -0.22, 0.22, 0.62]) {
            q.beginPath(); q.moveTo(0, top - 8); q.quadraticCurveTo(k * rx * 1.55, cy, k * rx * 0.35, 0);
            strokeIn(q, mcol, LW * 0.5);
          }
        }
      } else if (peeled > 0) peelStrips(q, rx, ry, cy, peeled, P.c2);
      if (tiny()) return;
      if (a.spots && peeled < 0.99) {
        const r = rng(seed + 7);
        for (let i = 0; i < 5; i++) {
          const x = (r() - 0.5) * rx * 1.4, y = cy + (r() - 0.5) * ry * 1.1;
          q.beginPath(); q.arc(x, y, 3.2, 0.15 * PI, 0.85 * PI); strokeIn(q, shade(P.c3, -0.2), LW * 0.55);
        }
        q.fillStyle = shade(P.c1, -0.18);
        for (let i = 0; i < 9; i++) { q.beginPath(); E(q, (r() - 0.5) * rx * 1.6, cy + (r() - 0.5) * ry * 1.4, 1.4, 1.2); q.fill(); }
      }
      if (a.segments) {
        const r = rng(seed + 3);
        q.fillStyle = shade(P.c1, 0.35);
        for (let i = 0; i < 9; i++) { q.beginPath(); E(q, (r() - 0.5) * rx * 1.5, cy + (r() - 0.5) * ry * 1.2, 1.6, 1.3); q.fill(); }
      }
      if (a.lobes) {
        for (const k of [-0.32, 0.32]) {
          q.beginPath(); q.moveTo(k * rx, top + 12); q.quadraticCurveTo(k * rx * 1.25, cy, k * rx * 0.7, -4);
          strokeIn(q, shade(P.c1, -0.22), LW * 0.6);
        }
      }
      if (a.stem && !a.lobes && !tiny()) {
        q.beginPath(); q.moveTo(-rx * 0.2, top + 10); q.quadraticCurveTo(-rx * 0.28, top + 20, -rx * 0.18, top + 26);
        strokeIn(q, shade(P.c1, -0.18), LW * 0.5);
      }
    },
  });
  if (papery && peeled > 0 && peeled < 1) {
    // papery flap peeled back from the boundary
    papFlap(c, xb, cy, rx, ry, P.c1);
  }
  if (papery) {
    if (peeled < 1) {
      tube(c, [0, top - 9, 3, top - 18, 9, top - 22], shade(P.c1, -0.12), 3.2);
    }
    // root tuft
    c.beginPath();
    for (const k of [-1, -0.4, 0.3, 1]) { c.moveTo(k * 5, -2); c.quadraticCurveTo(k * 8, 2, k * 11 + 1, 3); }
    strokeIn(c, peeled >= 1 ? shade(pb, -0.3) : shade(P.c3, -0.3), LW * 0.6);
  }
  if (a.stem && !a.lobes) calyx(c, 0, top + 5, rx * 0.38, P.stem);
  if (a.lobes) {
    c.beginPath();
    c.moveTo(-6, top + 12); c.quadraticCurveTo(-7, top - 2, -2, top - 10);
    c.quadraticCurveTo(4, top - 16, 12, top - 13); c.lineTo(11, top - 7);
    c.quadraticCurveTo(5, top - 8, 5, top - 1); c.lineTo(6, top + 12); c.closePath();
    fs(c, P.stem);
  }
}

// ================================================================ produce: long
const _tubes = new Map();
function tubeOf(a) {
  let g = _tubes.get(a);
  if (g) return g;
  const L = 113 * (a.len || 1), T = a.thin ? 11 : 23, N = 18;
  const tp = a.taper || 0, cv = a.curve || 0;
  const r = [], x = [], y = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let k = tp >= 0 ? 1 - tp * Math.pow(u, 1.5) : 1 + tp + -tp * (u * u * (3 - 2 * u));
    if (tp >= 0) k *= 0.86 + 0.14 * Math.sin(PI / 2 * clamp(u * 5, 0, 1));
    r.push(T * Math.max(0.12, k));
  }
  const x0 = -L / 2 + r[0], x1 = L / 2 - r[N];
  let low = -1e9;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    x.push(lerp(x0, x1, u));
    y.push(-cv * L * 0.3 * Math.sin(PI * u));
    low = Math.max(low, y[i] + r[i]);
  }
  for (let i = 0; i <= N; i++) y[i] -= low;
  let top = 0;
  for (let i = 0; i <= N; i++) top = Math.min(top, y[i] - r[i]);
  g = { L, T, N, r, x, y, top };
  if (_tubes.size > 200) _tubes.clear();
  _tubes.set(a, g);
  return g;
}
function tubePath(g, sy = 1) {
  const tp = [], bt = [];
  for (let i = 0; i <= g.N; i++) { tp.push(g.x[i], g.y[i] - g.r[i] * sy); }
  for (let i = g.N; i >= 0; i--) { bt.push(g.x[i], g.y[i] + g.r[i] * sy); }
  return (c) => {
    smoothOpen(c, tp, true);
    c.ellipse(g.x[g.N], g.y[g.N], g.r[g.N], g.r[g.N] * sy, 0, -PI / 2, PI / 2, false);
    smoothOpen(c, bt, false);
    c.ellipse(g.x[0], g.y[0], g.r[0], g.r[0] * sy, 0, PI / 2, PI * 1.5, false);
    c.closePath();
  };
}
// Points along the centre line, offset by f × radius (for stripes / peel strips).
function tubeLine(g, f, u0 = 0, u1 = 1) {
  const p = [];
  const i0 = Math.round(u0 * g.N), i1 = Math.round(u1 * g.N);
  for (let i = i0; i <= i1; i++) p.push(g.x[i], g.y[i] + g.r[i] * f);
  return p;
}
function tubeAt(g, x) {
  if (x <= g.x[0]) { const d = g.x[0] - x, r = g.r[0]; return { cy: g.y[0], hh: Math.sqrt(Math.max(0, r * r - d * d)) }; }
  if (x >= g.x[g.N]) { const d = x - g.x[g.N], r = g.r[g.N]; return { cy: g.y[g.N], hh: Math.sqrt(Math.max(0, r * r - d * d)) }; }
  const u = (x - g.x[0]) / (g.x[g.N] - g.x[0]) * g.N, i = Math.min(g.N - 1, Math.floor(u)), f = u - i;
  return { cy: lerp(g.y[i], g.y[i + 1], f), hh: lerp(g.r[i], g.r[i + 1], f) };
}

function carrotTop(c, x, y, T, col) {
  const tips = [[-40, -30], [-48, -6], [-34, 16]];
  for (const [dx, dy] of tips) {
    tube(c, [x + 4, y, x + dx * 0.5, y + dy * 0.5 - 3, x + dx, y + dy], shade(col, -0.05), 3.6);
  }
  for (const [dx, dy] of tips) {
    const parts = [];
    const n = tiny() ? 2 : 4;
    for (let k = 0; k < n; k++) {
      const f = 0.45 + k * (0.6 / n), side = k % 2 ? 1 : -1, an = Math.atan2(dy, dx);
      const lx = x + dx * f + Math.cos(an + side * 1.4) * 5, ly = y + dy * f + Math.sin(an + side * 1.4) * 5;
      parts.push((q) => E(q, lx, ly, 8.5, 5.2, an + side * 0.7));
    }
    parts.push((q) => E(q, x + dx * 1.05, y + dy * 1.05, 7, 5.5, Math.atan2(dy, dx)));
    paintU(c, parts, col, { lw: LW * 0.8, detail: tiny() ? null : (q) => { q.fillStyle = HL; q.beginPath(); E(q, x + dx * 0.8 - 2, y + dy * 0.8 - 3, 4, 2); q.fill(); } });
  }
}

function drawLong(c, a, P, st, t, seed) {
  const g = tubeOf(a);
  const path = tubePath(g);
  const peeled = clamp(num(st.peeled), 0, 1);
  const T = g.T, x0 = g.x[0], y0 = g.y[0], r0 = g.r[0];
  const egg = (a.taper || 0) < 0;
  // stems drawn behind the body
  if (a.rings) carrotTop(c, x0, y0, T, P.c3);
  else if (!egg) {
    const sw = a.thin ? 4 : a.stripes ? 9 : 6.5;
    const up = a.curve ? -10 : -3;
    tube(c, [x0 - r0 * 0.4, y0, x0 - r0 - 6, y0 + up * 0.4, x0 - r0 - (a.hollow ? 14 : 10), y0 + up], P.c3, sw);
  } else {
    tube(c, [x0, y0, x0 - r0 - 8, y0 - 3, x0 - r0 - 18, y0 - 9], P.c3, 7);
  }
  paint(c, path, peeled >= 0.995 ? P.c2 : P.c1, {
    dx: 0, dy: T * 0.32,
    detail: (q) => {
      if (peeled > 0 && peeled < 0.995) {
        const order = [-0.15, 0.45, -0.62, 0.85, -0.95, 0.2, -0.38];
        const n = Math.max(1, Math.round(peeled * order.length));
        for (let i = 0; i < n; i++) {
          q.beginPath(); smoothOpen(q, tubeLine(g, order[i], 0.08 + (i % 3) * 0.03, 0.94 - (i % 2) * 0.05), true);
          q.strokeStyle = shade(P.c2, -0.2); q.lineWidth = T * 0.44 + LW * 0.8; q.stroke();
          q.strokeStyle = P.c2; q.lineWidth = T * 0.44; q.stroke();
        }
      }
      if (tiny()) return;
      if (a.stripes && peeled < 0.5) {
        for (const f of [-0.55, 0.05, 0.6]) {
          q.beginPath(); smoothOpen(q, tubeLine(g, f, 0.05, 0.95), true);
          strokeIn(q, shade(P.c1, 0.2), T * 0.13);
        }
      }
      if (a.rings) {
        for (const u of [0.18, 0.32, 0.46, 0.6, 0.74]) {
          const i = Math.round(u * g.N), x = g.x[i], y = g.y[i], r = g.r[i];
          q.beginPath(); q.moveTo(x - 1, y - r * 0.55); q.quadraticCurveTo(x + r * 0.25, y, x - 1, y + r * 0.35);
          strokeIn(q, shade(peeled >= 0.995 ? P.c2 : P.c1, -0.2), LW * 0.5);
        }
      } else if (a.seeds && !a.stripes && !egg && peeled < 0.5) {
        const r = rng(seed);
        q.fillStyle = shade(P.c1, -0.28);
        for (let i = 0; i < 14; i++) {
          const ii = 1 + Math.floor(r() * (g.N - 1));
          q.beginPath(); E(q, g.x[ii] + (r() - 0.5) * 6, g.y[ii] + (r() - 0.6) * g.r[ii] * 1.4, 1.8, 1.4); q.fill();
        }
      }
    },
    after: tiny() ? null : (q) => {
      q.beginPath(); smoothOpen(q, tubeLine(g, -0.52, 0.12, 0.62), true);
      q.strokeStyle = HL; q.lineWidth = T * 0.24; q.stroke();
    },
  });
  if (egg) {
    // calyx cap: a rounded cap with three pointed sepals reaching over the body
    const bx = x0 - r0 * 0.55;
    c.beginPath();
    c.moveTo(bx, y0 - r0 * 1.02);
    c.quadraticCurveTo(bx + r0 * 1.2, y0 - r0 * 1.35, bx + r0 * 2.3, y0 - r0 * 0.95);
    c.quadraticCurveTo(bx + r0 * 1.3, y0 - r0 * 0.7, bx + r0 * 1.15, y0 - r0 * 0.3);
    c.quadraticCurveTo(bx + r0 * 1.8, y0 - r0 * 0.1, bx + r0 * 2.6, y0 + r0 * 0.05);
    c.quadraticCurveTo(bx + r0 * 1.5, y0 + r0 * 0.35, bx + r0 * 1.2, y0 + r0 * 0.55);
    c.quadraticCurveTo(bx + r0 * 1.7, y0 + r0 * 0.9, bx + r0 * 2.2, y0 + r0 * 1.0);
    c.quadraticCurveTo(bx + r0 * 1.1, y0 + r0 * 1.25, bx, y0 + r0 * 1.0);
    c.quadraticCurveTo(bx - r0 * 0.35, y0, bx, y0 - r0 * 1.02);
    c.closePath();
    fs(c, P.c3);
    if (!tiny()) { c.beginPath(); c.moveTo(bx + r0 * 0.2, y0 - r0 * 0.5); c.quadraticCurveTo(bx + r0 * 0.6, y0, bx + r0 * 0.2, y0 + r0 * 0.5); strokeIn(c, shade(P.c3, 0.2), 2); }
  } else if (a.thin && a.curve) {
    c.beginPath(); E(c, x0 - r0 * 0.3, y0, r0 * 0.6, r0 * 1.05); fs(c, P.c3, LW * 0.9);
  } else if (a.hollow) {
    c.beginPath(); E(c, x0 - r0 * 0.75, y0, r0 * 0.32, r0 * 0.7); fs(c, P.c3, LW * 0.9);
  }
}

function drawGinger(c, a, P, st, t, seed) {
  const peeled = clamp(num(st.peeled), 0, 1);
  const lumps = [[-6, -22, 38, 21, 0.1], [-38, -17, 18, 14, 0.4], [32, -26, 18, 16, -0.4], [12, -42, 13, 12, 0.3], [-24, -36, 11, 10, -0.5]];
  const parts = lumps.map((l) => (q) => E(q, l[0], l[1], l[2], l[3], l[4]));
  paintU(c, parts, peeled >= 0.995 ? P.c2 : P.c1, {
    dx: 4, dy: 7,
    hl: [-14, -34, 12, 6, -0.3],
    detail: (q) => {
      if (peeled > 0 && peeled < 0.995) {
        const r = rng(seed + 5), n = Math.round(peeled * 7);
        for (let i = 0; i < n; i++) { q.beginPath(); E(q, -40 + i * 13 + r() * 6, -28 + (r() - 0.5) * 14, 7, 16, 0.3); q.fillStyle = P.c2; q.fill(); }
      }
      if (tiny()) return;
      for (const l of lumps) {
        q.beginPath(); q.ellipse(l[0] + l[2] * 0.2, l[1], l[2] * 0.25, l[3] * 0.85, l[4], -1.2, 1.2);
        strokeIn(q, shade(P.c3, -0.15), LW * 0.5);
      }
    },
  });
}

function drawBeans(c, a, P, st, t, seed) {
  const g = tubeOf(a);
  const path = tubePath(g);
  const n = a.bunch || 3;
  const x0 = g.x[0] - g.r[0];
  const pod = () => {
    tube(c, [g.x[0] - g.r[0] * 0.5, g.y[0], g.x[0] - g.r[0] - 7, g.y[0] - 3], P.c3, 3.5);
    tube(c, [g.x[g.N] + g.r[g.N] * 0.5, g.y[g.N], g.x[g.N] + g.r[g.N] + 6, g.y[g.N] - 3], P.c1, 2.6);
    paint(c, path, P.c1, {
      dx: 0, dy: g.T * 0.32,
      detail: tiny() ? null : (q) => {
        for (let k = 1; k < 5; k++) { const ii = Math.round(k * g.N / 5); q.beginPath(); E(q, g.x[ii], g.y[ii], 5, g.r[ii] * 0.55); q.fillStyle = shade(P.c1, 0.12); q.fill(); }
      },
      after: (q) => { q.beginPath(); smoothOpen(q, tubeLine(g, -0.45, 0.1, 0.7), true); q.strokeStyle = HL; q.lineWidth = 3; q.stroke(); },
    });
  };
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) - 0.5 : 0;
    const row = n - 1 - i;
    sub(c, x0 + ((i * 7) % 3 - 1) * 9, -row * 7.5 + (row > 2 ? 4 : 0), 1, () => sub(c, -x0, 0, 1, pod), (row % 2 ? -0.05 : 0.03) + f * 0.03);
  }
}

// ================================================================ produce: bulb (garlic)
function bulbPath(rx, ry) {
  const cy = -ry, top = -2 * ry;
  return (c) => {
    c.moveTo(0, top - 6);
    c.bezierCurveTo(7, top + 8, rx * 1.05, cy - ry * 0.5, rx, cy + ry * 0.22);
    c.bezierCurveTo(rx * 0.96, cy + ry * 0.88, rx * 0.5, 0, 0, 0);
    c.bezierCurveTo(-rx * 0.5, 0, -rx * 0.96, cy + ry * 0.88, -rx, cy + ry * 0.22);
    c.bezierCurveTo(-rx * 1.05, cy - ry * 0.5, -7, top + 8, 0, top - 6);
    c.closePath();
  };
}
function drawBulb(c, a, P, st, t, seed) {
  const rx = 40, ry = 37, cy = -ry, top = -2 * ry;
  const peeled = clamp(num(st.peeled), 0, 1);
  const pb = P.c2, xb = rx * (1 - 2.1 * peeled);
  if (peeled < 1) { c.beginPath(); RR(c, -5, top - 20, 10, 18, 4); fs(c, shade(P.c3, 0.35)); }
  paint(c, bulbPath(rx, ry), peeled >= 1 ? pb : P.c1, {
    dx: rx * 0.12, dy: ry * 0.15, hl: [-rx * 0.42, cy - ry * 0.3, rx * 0.2, ry * 0.18, -0.4],
    detail: (q) => {
      if (peeled > 0 && peeled < 1) { q.fillStyle = pb; q.fillRect(xb, top - 20, rx * 3, ry * 3); }
      const col = peeled >= 1 ? shade(pb, -0.25) : shade(P.c1, -0.2);
      for (const k of [-0.7, -0.25, 0.25, 0.7]) {
        q.beginPath(); q.moveTo(0, top - 2); q.quadraticCurveTo(k * rx * 1.5, cy - 2, k * rx * 0.45, 0);
        strokeIn(q, col, LW * (peeled >= 1 ? 0.7 : 0.5));
      }
      if (!tiny() && peeled < 1) {
        q.strokeStyle = shade(P.c3, 0.1); q.lineWidth = LW * 0.4;
        for (const k of [-0.45, 0.05, 0.5]) { q.beginPath(); q.moveTo(k * rx, cy - ry * 0.4); q.quadraticCurveTo(k * rx * 1.2, cy + 6, k * rx * 0.8, cy + ry * 0.6); q.stroke(); }
      }
    },
  });
  if (peeled > 0 && peeled < 1) papFlap(c, xb, cy, rx, ry, P.c1);
  c.beginPath();
  for (const k of [-1, -0.4, 0.3, 1]) { c.moveTo(k * 6, -2); c.quadraticCurveTo(k * 9, 2, k * 12 + 1, 3); }
  strokeIn(c, shade(P.c3, -0.2), LW * 0.6);
}

// ================================================================ produce: egg
const EW = 29, EH = 76;
function eggPath(w = EW, h = EH) {
  return (c) => {
    c.moveTo(0, -h);
    c.bezierCurveTo(w * 0.75, -h, w, -h * 0.52, w, -h * 0.36);
    c.bezierCurveTo(w, -h * 0.12, w * 0.62, 0, 0, 0);
    c.bezierCurveTo(-w * 0.62, 0, -w, -h * 0.12, -w, -h * 0.36);
    c.bezierCurveTo(-w, -h * 0.52, -w * 0.75, -h, 0, -h);
    c.closePath();
  };
}
function drawEgg(c, a, P, st, t, seed) {
  if (P.ck > 0) P = Object.assign({}, P, { c1: a.c1, c2: a.c2, c3: a.c3 });
  const path = eggPath();
  const peeled = st.boiled ? clamp(num(st.peeled), 0, 1) : 0;
  const hl = [-EW * 0.38, -EH * 0.68, EW * 0.22, EH * 0.13, -0.4];
  if (peeled > 0) {
    // smooth white egg emerging from a cracked shell
    paint(c, path, P.c2, { dx: 4, dy: 6, hl, after: (q) => shine(q, -EW * 0.42, -EH * 0.5, 2.6) });
    if (peeled < 1) {
      const yb = -EH * (1 - peeled) * 0.92;
      const jag = [];
      for (let i = 0; i <= 8; i++) jag.push(-EW - 2 + i * (EW * 2 + 4) / 8, yb + (i % 2 ? -7 : 4));
      c.save();
      c.beginPath(); path(c); c.clip();
      c.beginPath(); c.moveTo(jag[0], jag[1]);
      for (let i = 2; i < jag.length; i += 2) c.lineTo(jag[i], jag[i + 1]);
      c.lineTo(EW + 4, 4); c.lineTo(-EW - 4, 4); c.closePath();
      c.fillStyle = P.c1; c.fill();
      c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke();
      c.restore();
      c.beginPath(); path(c); c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke();
    }
    // shell flakes on the board
    if (!tiny()) {
      const r = rng(seed + 11);
      for (let i = 0; i < 3; i++) {
        const fx = (i - 1) * 24 + (r() - 0.5) * 8 + (i === 1 ? 34 : 0), fy = -2 - r() * 3;
        c.beginPath(); c.moveTo(fx - 5, fy); c.lineTo(fx - 1, fy - 5 - r() * 3); c.lineTo(fx + 5, fy - 2); c.lineTo(fx + 3, fy + 1); c.closePath();
        fs(c, P.c1, LW * 0.6);
      }
    }
    return;
  }
  paint(c, path, P.c1, {
    dx: 4, dy: 6, hl,
    detail: tiny() ? null : (q) => {
      const r = rng(seed);
      q.fillStyle = shade(P.c1, -0.12);
      for (let i = 0; i < 7; i++) { q.beginPath(); E(q, (r() - 0.5) * EW * 1.4, -EH * (0.15 + r() * 0.65), 1.3, 1.1); q.fill(); }
    },
  });
}
// A cracked egg lying in the pan / on the board (sunny side up). cook firms it.
function drawFriedEgg(c, P, ck, seed, beaten) {
  const wob = blobPts(0, -18, 50, 20, 11, 0.12, seed);
  for (let i = 1; i < wob.length; i += 2) wob[i] = Math.min(wob[i], 0);
  const white = ck > 0.05 ? mix('#fbf7ee', '#ffffff', 0.5) : 'rgba(255,253,245,0.82)';
  if (beaten) {
    paint(c, (q) => smoothClosed(q, wob), mix(P.c3, '#ffd75a', 0.3), {
      dx: 3, dy: 4,
      detail: (q) => { q.beginPath(); q.ellipse(0, -18, 26, 9, 0, 0.3, 5.2); strokeIn(q, shade(P.c3, 0.25), 3); },
      hl: [-18, -26, 14, 4],
    });
    return;
  }
  paint(c, (q) => smoothClosed(q, wob), white, {
    dx: 3, dy: 4,
    detail: ck > 0.25 ? (q) => {
      q.beginPath(); smoothClosed(q, wob);
      q.strokeStyle = rgba('#c88a3a', clamp(ck, 0, 1) * 0.8); q.lineWidth = 9; q.stroke();
    } : null,
  });
  const yolk = ck > 0.6 ? mix(P.c3, '#f6c25a', 0.4) : P.c3;
  ball(c, 6, -22, 15, 12, yolk, { hl: [1, -27, 6, 3.5, -0.3] });
  if (!tiny()) shine(c, 1, -27, 2.4);
}

// ================================================================ mushroom
function drawMushroom(c, a, P, st, t, seed) {
  paint(c, (q) => {
    q.moveTo(-12, -38); q.lineTo(-15, -7); q.quadraticCurveTo(-15, 0, -8, 0);
    q.lineTo(8, 0); q.quadraticCurveTo(15, 0, 15, -7); q.lineTo(12, -38); q.closePath();
  }, P.c2, { dx: 3, dy: 0 });
  c.beginPath(); E(c, 0, -38, 36, 8.5); fs(c, P.c3);
  if (!tiny()) {
    c.beginPath();
    for (let i = -4; i <= 4; i++) { c.moveTo(i * 7, -36); c.lineTo(i * 3.2, -42); }
    strokeIn(c, shade(P.c3, -0.25), LW * 0.4);
  }
  paint(c, (q) => {
    q.moveTo(-43, -37);
    q.bezierCurveTo(-46, -86, 46, -86, 43, -37);
    q.bezierCurveTo(30, -30, -30, -30, -43, -37);
    q.closePath();
  }, P.c1, {
    dx: 4, dy: 6, hl: [-17, -62, 12, 7, -0.5],
    detail: tiny() ? null : (q) => {
      const r = rng(seed); q.fillStyle = shade(P.c1, -0.07);
      for (let i = 0; i < 4; i++) { q.beginPath(); E(q, (r() - 0.5) * 50, -50 - r() * 16, 2 + r(), 1.4 + r() * 0.6); q.fill(); }
    },
  });
}

// ================================================================ herbs (bunch lying on its side)
function leafPath(len, wid, serr) {
  return (c) => {
    c.moveTo(0, 0);
    if (!serr) {
      c.bezierCurveTo(len * 0.25, -wid * 1.05, len * 0.75, -wid * 0.9, len, 0);
      c.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.25, wid * 1.05, 0, 0);
    } else {
      const n = 5;
      for (let i = 1; i <= n; i++) { const u = i / n, w = Math.sin(PI * (u * 0.92 + 0.04)) * wid; c.quadraticCurveTo(len * (u - 0.12), -w * 1.1, len * u, -w * (i === n ? 0 : 0.9)); }
      for (let i = n - 1; i >= 0; i--) { const u = i / n, w = Math.sin(PI * (u * 0.92 + 0.04)) * wid; c.quadraticCurveTo(len * (u + 0.12), w * 1.1, len * u, w * (i === 0 ? 0 : 0.9)); }
    }
    c.closePath();
  };
}
function leaf(c, x, y, len, wid, ang, fill, vein, serr) {
  sub(c, x, y, 1, () => {
    paint(c, leafPath(len, wid, serr), fill, {
      dx: 0, dy: wid * 0.35, lw: LW * 0.85,
      detail: tiny() ? null : (q) => {
        q.beginPath(); q.moveTo(len * 0.05, 0); q.quadraticCurveTo(len * 0.5, -wid * 0.12, len * 0.88, 0);
        strokeIn(q, vein, Math.max(1.4, LW * 0.45));
      },
    });
  }, ang);
}
function drawHerb(c, a, P, st, t, seed) {
  const kind = a.leaf || 'oval';
  const r = rng(seed);
  const tieX = -40;
  const stemCol = P.c3;
  // stems
  if (kind !== 'grass') {
    const nS = 5;
    for (let i = 0; i < nS; i++) {
      const f = i / (nS - 1) - 0.5;
      tube(c, [-78 + Math.abs(f) * 6, -8 + f * 14, tieX, -16 + f * 3, -6, -24 + f * 22], kind === 'tiny' || kind === 'needle' ? shade(stemCol, 0.15) : mix(stemCol, P.c1, 0.5), 4.4);
    }
  }
  if (kind === 'curly') {
    const pts = [];
    for (let i = 0; i < 15; i++) { const ang = r() * TAU, d = Math.sqrt(r()); pts.push([24 + Math.cos(ang) * d * 40, -30 + Math.sin(ang) * d * 20, 11 + r() * 5]); }
    pts.sort((p, q) => p[1] - q[1]);
    const back = pts.slice(0, 7), front = pts.slice(7);
    paintU(c, back.map((p) => (q) => E(q, p[0], p[1] - 4, p[2], p[2] * 0.9)), P.c2, { dx: 2, dy: 3 });
    paintU(c, front.map((p) => (q) => E(q, p[0], p[1], p[2], p[2] * 0.9)), P.c1, {
      dx: 2, dy: 4,
      detail: tiny() ? null : (q) => {
        q.strokeStyle = shade(P.c1, -0.18); q.lineWidth = LW * 0.45;
        for (const p of front) { q.beginPath(); q.arc(p[0], p[1], p[2] * 0.55, 0.3, 2.4); q.stroke(); }
      },
      after: (q) => { for (const p of front.slice(0, 3)) { q.fillStyle = rgba(P.c3, 0.8); q.beginPath(); E(q, p[0] - p[2] * 0.3, p[1] - p[2] * 0.35, p[2] * 0.35, p[2] * 0.22); q.fill(); } },
    });
  } else if (kind === 'oval' || kind === 'serrated') {
    const serr = kind === 'serrated';
    const L = serr ? 40 : 46, W = serr ? 15 : 17;
    const spots = [[-12, -28, -0.95], [-8, -18, 0.5], [0, -36, -0.5], [4, -14, 0.22], [14, -30, -0.18], [20, -18, 0.32], [24, -40, -0.6]];
    spots.forEach((p, i) => leaf(c, p[0], p[1], L * (0.85 + r() * 0.3), W, p[2] + (r() - 0.5) * 0.2, i % 2 ? P.c1 : P.c2 === P.c1 ? P.c1 : mix(P.c1, P.c2, 0.45), shade(P.c3, 0.1), serr));
  } else if (kind === 'grass') {
    for (let i = 0; i < 9; i++) {
      const f = i / 8 - 0.5;
      line(c, [-80, -8 + f * 10, 0, -14 + f * 14, 78, -18 + f * 30 + (r() - 0.5) * 6], OUTLINE, 4.2 + LW);
    }
    for (let i = 0; i < 9; i++) {
      const f = i / 8 - 0.5;
      line(c, [-80, -8 + f * 10, 0, -14 + f * 14, 78, -18 + f * 30], i % 2 ? P.c1 : P.c2, 4.2);
    }
    if (!tiny()) {
      for (const [x, y] of [[82, -30], [80, -6]]) {
        const cl = [];
        for (let k = 0; k < 6; k++) { const an = k / 6 * TAU; cl.push((q) => E(q, x + Math.cos(an) * 5, y + Math.sin(an) * 5, 4.5, 4.5)); }
        paintU(c, cl, P.c3, { lw: LW * 0.7 });
      }
    }
  } else {
    // tiny (thyme) / needle (rosemary): twigs with small leaves
    const twigs = [[-6, -24, 64, -40], [-6, -20, 72, -16], [-6, -16, 60, 2], [-8, -26, 40, -54]];
    for (const [x1, y1, x2, y2] of twigs) {
      tube(c, [x1, y1, (x1 + x2) / 2, (y1 + y2) / 2 - 3, x2, y2], stemCol, 2.6);
    }
    for (const [x1, y1, x2, y2] of twigs) {
      const n = tiny() ? 4 : 9;
      for (let k = 1; k <= n; k++) {
        const u = k / (n + 0.5), x = lerp(x1, x2, u), y = lerp(y1, y2, u) - Math.sin(PI * u) * 3;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        for (const side of [-1, 1]) {
          if (kind === 'needle') {
            const nx = x + Math.cos(ang + side * 1.1) * 11, ny = y + Math.sin(ang + side * 1.1) * 11;
            c.beginPath(); c.moveTo(x, y); c.lineTo(nx, ny);
            c.strokeStyle = OUTLINE; c.lineWidth = 3.4 + LW * 0.9; c.stroke();
            c.strokeStyle = k % 2 ? P.c1 : P.c2; c.lineWidth = 3.4; c.stroke();
          } else {
            c.beginPath(); E(c, x + Math.cos(ang + side * 1.2) * 5, y + Math.sin(ang + side * 1.2) * 5, 4.4, 2.8, ang + side * 1.2);
            fs(c, k % 2 ? P.c1 : P.c2, LW * 0.6);
          }
        }
      }
    }
  }
  // twine tie
  sub(c, tieX, -15, 1, () => {
    c.beginPath(); RR(c, -5, -11, 10, 22, 4); fs(c, '#e8c88a', LW * 0.9);
    if (!tiny()) { c.beginPath(); c.moveTo(-5, -3); c.lineTo(5, -6); c.moveTo(-5, 4); c.lineTo(5, 1); strokeIn(c, '#b8904a', LW * 0.5); }
  }, -0.12);
}

// ================================================================ cabbage leaf & head
function bigLeafPts(rx, ry, seed) {
  const p = [], n = 18, r = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, k = 1 + 0.07 * Math.sin(i * 2.7) + (r() - 0.5) * 0.06;
    p.push(Math.cos(a) * rx * k, Math.sin(a) * ry * k);
  }
  return p;
}
function bigLeaf(c, x, y, rx, ry, rot, fill, vein, seed) {
  const pts = bigLeafPts(rx, ry, seed);
  sub(c, x, y, 1, () => {
    paint(c, (q) => smoothClosed(q, pts), fill, {
      dx: 0, dy: ry * 0.18, hl: [-rx * 0.3, -ry * 0.4, rx * 0.25, ry * 0.15],
      detail: (q) => {
        q.beginPath(); q.moveTo(-rx * 1.05, ry * 0.25); q.quadraticCurveTo(0, -ry * 0.05, rx * 0.85, -ry * 0.15);
        strokeIn(q, vein, Math.max(4, ry * 0.2));
        if (tiny()) return;
        for (const u of [-0.5, -0.1, 0.3]) {
          const bx = u * rx, by = ry * (0.12 - u * 0.15);
          q.beginPath(); q.moveTo(bx, by); q.quadraticCurveTo(bx + rx * 0.2, by - ry * 0.5, bx + rx * 0.35, by - ry * 0.75);
          q.moveTo(bx, by); q.quadraticCurveTo(bx + rx * 0.22, by + ry * 0.4, bx + rx * 0.38, by + ry * 0.6);
          strokeIn(q, vein, 2.2);
        }
      },
    });
  }, rot);
}
function sarma(c, x, y, len, P, ang, fillCol) {
  sub(c, x, y, 1, () => {
    const r = len * 0.24;
    paint(c, (q) => RR(q, -len / 2, -r * 2, len, r * 2, r), P.c1, {
      dx: 0, dy: r * 0.4, hl: [-len * 0.15, -r * 1.45, len * 0.25, r * 0.2],
      detail: tiny() ? null : (q) => {
        q.strokeStyle = shade(P.c2, -0.05); q.lineWidth = 2.2;
        for (let i = -1; i <= 1; i++) { q.beginPath(); q.moveTo(i * len * 0.24 - 6, -r * 2); q.quadraticCurveTo(i * len * 0.24 + 4, -r, i * len * 0.24 - 2, 0); q.stroke(); }
      },
    });
    c.beginPath(); E(c, len / 2 - r * 0.35, -r, r * 0.45, r * 0.85); fs(c, fillCol || '#c8643a', LW * 0.8);
    if (!tiny()) { c.fillStyle = '#fff6e0'; for (const [dx, dy] of [[-1, -3], [1, 2], [-2, 4]]) { c.beginPath(); E(c, len / 2 - r * 0.35 + dx, -r + dy, 1.5, 1); c.fill(); } }
  }, ang);
}
function drawLeafStack(c, a, P, st, t, seed) {
  const fillCol = st.fill || '#c8643a';
  if (st.cut === 'rolls') {
    const nTot = Math.max(1, num(st.n, num(st.qty, 1)) | 0);
    const k = clamp(num(st.k, nTot) | 0, 0, 20);
    const flat = Math.max(0, nTot - k);
    if (flat > 0) {
      sub(c, -40, 0, 0.7, () => drawLeafStack(c, a, P, { qty: Math.min(flat, 6), filled: true, fill: fillCol }, t, seed));
    }
    const per = Math.min(5, Math.max(1, k));
    for (let i = 0; i < k; i++) {
      const row = Math.floor(i / per), col = i % per;
      const x = (flat > 0 ? 30 : 0) + (col - (per - 1) / 2) * 30 + row * 8, y = -row * 13;
      sarma(c, x, y, 50, P, Math.PI / 2 - 0.15 + (i % 2) * 0.1 - Math.PI / 2, fillCol);
    }
    return;
  }
  const q = clamp(num(st.qty, 1) | 0, 1, 8);
  const r = rng(seed);
  for (let i = 0; i < q; i++) {
    bigLeaf(c, (r() - 0.5) * 16, -30 - i * 7, 64, 30, (r() - 0.5) * 0.3 + (i % 2 ? 0.08 : -0.08), i % 2 ? P.c1 : shade(P.c1, 0.07), P.c2, seed + i);
  }
  if (st.filled) {
    const y = -30 - (q - 1) * 7;
    const pts = blobPts(-14, y - 4, 20, 9, 9, 0.18, seed + 3);
    paint(c, (qq) => smoothClosed(qq, pts), fillCol, {
      dx: 2, dy: 3,
      detail: tiny() ? null : (qq) => { const rr = rng(seed); qq.fillStyle = '#fff6e0'; for (let i = 0; i < 8; i++) { qq.beginPath(); E(qq, -14 + (rr() - 0.5) * 30, y - 4 + (rr() - 0.5) * 12, 2.2, 1.2, rr() * 3); qq.fill(); } },
    });
  }
}
function headPath(rx, ry) { return (c) => squash(c, 0, -ry, rx, ry); }
function drawHead(c, a, P, st, t, seed) {
  const rx = 62, ry = 55, cy = -ry;
  const path = headPath(rx, ry);
  paint(c, path, P.c2, { dx: 0, dy: 0 });
  // outer leaves cupping the head
  c.save(); c.beginPath(); path(c); c.clip();
  const leaves = [[-0.62, 0.9, -0.5], [0.62, 0.9, 0.5], [0, 0.72, 0]];
  for (const [lx, h, tilt] of leaves) {
    const x = lx * rx;
    const lp = (q) => {
      q.moveTo(x - rx * 0.75, 4);
      q.bezierCurveTo(x - rx * 0.95, cy - ry * h * 0.6, x - rx * 0.4 + tilt * 10, cy - ry * h, x + tilt * 14, cy - ry * h * 0.95);
      q.bezierCurveTo(x + rx * 0.4 + tilt * 10, cy - ry * h, x + rx * 0.95, cy - ry * h * 0.6, x + rx * 0.75, 4);
      q.closePath();
    };
    paint(c, lp, P.c1, {
      dx: 0, dy: 8,
      detail: tiny() ? null : (q) => {
        q.beginPath(); q.moveTo(x, 4); q.quadraticCurveTo(x + tilt * 8, cy, x + tilt * 14, cy - ry * h * 0.85);
        strokeIn(q, P.c3, 5);
        for (const s2 of [-1, 1]) for (const u of [0.35, 0.65]) {
          const by = lerp(0, cy - ry * h * 0.8, u);
          q.beginPath(); q.moveTo(x + tilt * 10 * u, by); q.quadraticCurveTo(x + s2 * rx * 0.25, by - 8, x + s2 * rx * 0.45, by - 18);
          strokeIn(q, P.c3, 2.4);
        }
      },
    });
  }
  c.fillStyle = HL; c.beginPath(); E(c, -rx * 0.38, cy - ry * 0.55, rx * 0.2, ry * 0.12, -0.5); c.fill();
  c.restore();
  c.beginPath(); path(c); fs(c, null);
  if (st.cored) {
    c.beginPath(); E(c, 0, cy - ry * 0.68, 15, 6.5); fs(c, shade(P.c2, -0.45));
    c.beginPath(); c.moveTo(-9, cy - ry * 0.68); c.lineTo(0, cy - ry * 0.68 + 5); c.lineTo(9, cy - ry * 0.68); strokeIn(c, shade(P.c2, -0.2), 2);
  }
}

// ================================================================ piles of grains
// Cheap shaded ellipse (no clip): shade-coloured base + offset main fill.
function bead(c, x, y, rx, ry, col, rot = 0, lw) {
  c.beginPath(); E(c, x, y, rx, ry, rot);
  c.fillStyle = shade(col, -0.22); c.fill();
  c.lineWidth = lw || LW * 0.75; c.strokeStyle = OUTLINE; c.stroke();
  c.beginPath(); E(c, x - rx * 0.12, y - ry * 0.14, rx * 0.8, ry * 0.78, rot);
  c.fillStyle = col; c.fill();
}
function grainAt(c, g, x, y, sz, P, r, ck) {
  switch (g) {
    case 'pea':
      bead(c, x, y, sz, sz, P.c1);
      if (!tiny()) shine(c, x - sz * 0.35, y - sz * 0.4, sz * 0.22);
      break;
    case 'bean': {
      const big = sz > 10;
      bead(c, x, y, big ? sz * 1.25 : sz, big ? sz * 0.78 : sz * 0.92, P.c1, (r() - 0.5) * 1.2);
      if (!tiny()) {
        c.beginPath(); c.arc(x + sz * 0.1, y - sz * 0.05, sz * 0.55, -0.6, 0.9);
        strokeIn(c, shade(P.c2, -0.1), LW * 0.4);
        shine(c, x - sz * 0.35, y - sz * 0.35, sz * 0.18);
      }
      break;
    }
    case 'raisin': {
      const p = blobPts(x, y, sz * 1.1, sz * 0.85, 7, 0.22, (r() * 1e9) | 0);
      c.beginPath(); smoothClosed(c, p); fs(c, P.c1, LW * 0.75);
      if (!tiny()) { c.beginPath(); c.moveTo(x - sz * 0.5, y - sz * 0.1); c.quadraticCurveTo(x, y + sz * 0.3, x + sz * 0.4, y - sz * 0.2); strokeIn(c, P.c3, 1.6); }
      break;
    }
    case 'seed': {
      const rot = (r() - 0.5) * 1.6;
      bead(c, x, y, sz * 1.35, sz * 0.8, P.c1, rot);
      if (!tiny()) {
        c.beginPath(); c.moveTo(x - Math.cos(rot) * sz, y - Math.sin(rot) * sz); c.lineTo(x + Math.cos(rot) * sz, y + Math.sin(rot) * sz);
        strokeIn(c, P.c2, 1.4);
      }
      break;
    }
    case 'lentil':
      c.beginPath(); E(c, x, y, sz, sz * 0.62, (r() - 0.5) * 0.8);
      c.fillStyle = r() < 0.4 ? P.c3 : P.c1; c.fill();
      c.lineWidth = Math.max(1, LW * 0.35); c.strokeStyle = shade(P.c2, -0.25); c.stroke();
      break;
    default: // rice
      c.beginPath(); E(c, x, y, sz * 1.25, sz * 0.5, (r() - 0.5) * 2.4);
      c.fillStyle = r() < 0.4 ? P.c3 : P.c1; c.fill();
      c.lineWidth = Math.max(1, LW * 0.35); c.strokeStyle = shade(P.c2, -0.3); c.stroke();
  }
}
function moundPath(W, H) {
  return (q) => {
    q.moveTo(-W, 0);
    q.bezierCurveTo(-W * 0.74, -H * 0.34, -W * 0.5, -H, 0, -H);
    q.bezierCurveTo(W * 0.5, -H, W * 0.74, -H * 0.34, W, 0);
    q.quadraticCurveTo(0, 3, -W, 0);
    q.closePath();
  };
}
function drawPile(c, a, P, st, t, seed, amt = 1) {
  const g = a.grain || 'rice';
  const big = a.big ? 1.18 : 1;
  const k = clamp(Math.sqrt(num(st.qty, 1)) * amt, 0.35, 2.2);
  sub(c, 0, 0, k, () => {
    const r = rng(seed);
    const ballish = g === 'bean' || g === 'pea' || g === 'raisin' || g === 'seed';
    if (ballish && !tiny()) {
      const rb = (g === 'pea' ? 8.5 : g === 'bean' ? 9.2 : g === 'raisin' ? 7.5 : 7) * big;
      const rows = [6, 5, 4, 2];
      for (let ri = 0; ri < rows.length; ri++) {
        const n = rows[ri];
        for (let j = 0; j < n; j++) {
          const x = (j - (n - 1) / 2) * rb * 1.72 + (r() - 0.5) * rb * 0.4;
          const y = -rb * 0.95 - ri * rb * 1.3 + (r() - 0.5) * rb * 0.25;
          grainAt(c, g, x, y, rb, P, r, P.ck);
        }
      }
    } else {
      const W = 62 * big, H = 40 * big;
      paint(c, moundPath(W, H), lum(P.c1) > 0.9 ? mix(P.c1, P.c2, 0.45) : P.c1, {
        dx: W * 0.1, dy: H * 0.16, hl: [-W * 0.35, -H * 0.62, W * 0.22, H * 0.14, -0.4],
        detail: tiny() ? null : (q) => {
          const n = g === 'rice' ? 34 : 26;
          for (let i = 0; i < n; i++) {
            const x = (r() - 0.5) * 2 * W * 0.92;
            const top = -H * (1 - Math.pow(Math.abs(x) / W, 1.6));
            const y = lerp(top + 3, -2, r());
            grainAt(q, g, x, y, g === 'rice' ? 4.2 * big : 4.6 * big, P, r, P.ck);
          }
        },
      });
      if (!tiny()) {
        for (let i = 0; i < 4; i++) {
          const side = i % 2 ? 1 : -1;
          grainAt(c, g, side * (W + 4 + r() * 12), -3 - r() * 2, g === 'rice' ? 4.2 * big : 4.6 * big, P, r, P.ck);
        }
      }
    }
    if (st.washed) {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.beginPath(); E(c, -12, -28, 22, 7, -0.2); c.fill();
    }
  });
}

// ================================================================ blocks (dairy, meat, bread …)
const BLOCK_SIZE = {
  brick: [116, 60], wedge: [116, 74], ball: [92, 86], loaf: [176, 70], chunk: [124, 56], mince: [124, 50],
  drumstick: [146, 68], fillet: [176, 46], strips: [160, 52], sausage: [164, 58], log: [172, 54],
  shrimp: [96, 70], shell: [120, 58], finger: [150, 50],
};
function drawBlock(c, a, P, st, t, seed) {
  const sh = a.shape || 'chunk';
  const r = rng(seed);
  switch (sh) {
    case 'brick': {
      const W = 100, H = 38, D = 12, Dy = 20;
      const x0 = -W / 2 - D / 2;
      c.beginPath(); c.moveTo(x0 + W, -H); c.lineTo(x0 + W + D, -H - Dy); c.lineTo(x0 + W + D, -Dy + 2); c.lineTo(x0 + W, 0); c.closePath(); fs(c, shade(P.c1, -0.16));
      c.beginPath(); c.moveTo(x0, -H); c.lineTo(x0 + D, -H - Dy); c.lineTo(x0 + W + D, -H - Dy); c.lineTo(x0 + W, -H); c.closePath(); fs(c, P.c2);
      paint(c, (q) => RR(q, x0, -H, W, H, 5), P.c1, { dx: 0, dy: 7, hl: [x0 + 22, -H + 10, 16, 5] });
      if (!tiny()) {
        c.beginPath(); c.moveTo(x0 + 26, -H - 6); c.lineTo(x0 + 34, -H - 14); c.moveTo(x0 + 52, -H - 6); c.lineTo(x0 + 60, -H - 14);
        strokeIn(c, P.c3, 2.2);
      }
      break;
    }
    case 'wedge': {
      const W = 104, H = 62;
      // top (cut) face going back, front face, rind on the left end
      c.beginPath(); c.moveTo(-W / 2, -H); c.lineTo(-W / 2 + 12, -H - 12); c.lineTo(W / 2 + 10, -22); c.lineTo(W / 2, -16); c.closePath(); fs(c, shade(P.c2, 0.12));
      paint(c, (q) => { q.moveTo(-W / 2, -H); q.lineTo(W / 2, -16); q.quadraticCurveTo(W / 2 + 2, 0, W / 2 - 8, 0); q.lineTo(-W / 2 + 6, 0); q.quadraticCurveTo(-W / 2, 0, -W / 2, -8); q.closePath(); }, P.c2, {
        dx: 0, dy: 6, hl: [-W * 0.2, -H * 0.5, 14, 6, -0.4],
        detail: (q) => {
          q.fillStyle = P.c1; q.fillRect(-W / 2 - 2, -H - 2, 13, H + 4);
          if (tiny()) return;
          if (a.holes) {
            for (const [hx, hy, hr] of [[-18, -30, 7], [8, -14, 5], [24, -26, 4], [-30, -12, 4], [-4, -40, 4]]) { q.beginPath(); E(q, hx, hy, hr, hr * 0.8); fs(q, shade(P.c2, -0.15), LW * 0.5); }
          }
          if (lum(P.c3) < 0.55 && !a.holes && sat(P.c3) > 0.2) {
            q.strokeStyle = P.c3; q.lineWidth = 2.6;
            for (let i = 0; i < 6; i++) { const x = -26 + r() * 64, y = -10 - r() * 34; q.beginPath(); q.moveTo(x, y); q.quadraticCurveTo(x + 6, y - 6, x + 12, y - 2); q.stroke(); }
          }
        },
      });
      break;
    }
    case 'ball': {
      paint(c, (q) => squash(q, 0, -38, 44, 38), P.c1, { dx: 6, dy: 7, hl: [-16, -54, 13, 8, -0.5] });
      c.beginPath(); c.moveTo(-8, -74); c.quadraticCurveTo(0, -86, 9, -78); c.quadraticCurveTo(4, -72, 6, -68); c.quadraticCurveTo(0, -70, -6, -68); c.closePath(); fs(c, P.c3);
      if (!tiny()) shine(c, -22, -48, 3);
      break;
    }
    case 'loaf': {
      const W = 86, H = 62;
      paint(c, (q) => { q.moveTo(-W, -8); q.bezierCurveTo(-W - 2, -H * 0.9, -W * 0.5, -H, 0, -H); q.bezierCurveTo(W * 0.5, -H, W + 2, -H * 0.9, W, -8); q.quadraticCurveTo(W, 0, W - 10, 0); q.lineTo(-W + 10, 0); q.quadraticCurveTo(-W, 0, -W, -8); q.closePath(); }, P.c1, {
        dx: 6, dy: 8, hl: [-W * 0.45, -H * 0.7, 22, 7, -0.15],
        detail: (q) => {
          for (const x of [-46, -10, 26, 58]) {
            q.beginPath(); q.moveTo(x - 14, -H * 0.62); q.quadraticCurveTo(x, -H * 0.9, x + 16, -H * 0.82);
            q.strokeStyle = OUTLINE; q.lineWidth = 7 + LW; q.stroke();
            q.strokeStyle = P.c2; q.lineWidth = 7; q.stroke();
          }
          if (tiny()) return;
          q.fillStyle = 'rgba(255,255,255,0.7)';
          for (let i = 0; i < 10; i++) { q.beginPath(); E(q, (r() - 0.5) * W * 1.6, -H * (0.5 + r() * 0.4), 1.6, 1.2); q.fill(); }
        },
      });
      break;
    }
    case 'chunk': {
      const top = blobPts(0, -30, 58, 22, 10, 0.08, seed);
      c.beginPath(); smoothClosed(c, top.map((v, i) => (i % 2 ? v + 14 : v))); fs(c, shade(P.c1, -0.18));
      paint(c, (q) => smoothClosed(q, top), P.c1, {
        dx: 4, dy: 5, hl: [-24, -40, 14, 5, -0.2],
        detail: (q) => {
          q.beginPath(); q.moveTo(-60, -40); q.quadraticCurveTo(0, -60, 60, -42); strokeIn(q, P.c3, 9);
          if (tiny()) return;
          q.strokeStyle = rgba(P.c3, 0.9); q.lineWidth = 2;
          for (let i = 0; i < 5; i++) { const x = -40 + i * 18 + r() * 6, y = -30 + (r() - 0.5) * 14; q.beginPath(); q.moveTo(x, y); q.quadraticCurveTo(x + 6, y - 5, x + 13, y + 1); q.stroke(); }
        },
      });
      break;
    }
    case 'mince': {
      const W = 60, H = 42;
      paint(c, moundPath(W, H), P.c1, {
        dx: 6, dy: 6, hl: [-W * 0.35, -H * 0.62, 12, 5, -0.4],
        detail: tiny() ? null : (q) => {
          for (let i = 0; i < 22; i++) {
            const x = (r() - 0.5) * W * 1.7, top = -H * (1 - Math.pow(Math.abs(x) / W, 1.6)), y = lerp(top + 4, -3, r());
            q.beginPath(); q.moveTo(x - 5, y); q.quadraticCurveTo(x, y - 5, x + 5, y); q.quadraticCurveTo(x + 8, y + 3, x + 11, y - 1);
            strokeIn(q, i % 3 ? P.c2 : P.c3, 2.4);
          }
        },
      });
      break;
    }
    case 'drumstick': {
      // bone with knobs, then the meaty part
      c.beginPath(); RR(c, 10, -40, 50, 13, 6); fs(c, P.c3);
      c.beginPath(); E(c, 62, -45, 9, 9); E(c, 64, -27, 9, 9); fs(c, P.c3);
      c.beginPath(); RR(c, 30, -39, 36, 11, 5); c.fillStyle = P.c3; c.fill();
      paint(c, (q) => {
        q.moveTo(28, -42); q.bezierCurveTo(10, -66, -66, -70, -70, -36);
        q.bezierCurveTo(-72, -6, -20, 2, 4, -14); q.bezierCurveTo(14, -20, 22, -26, 28, -26); q.closePath();
      }, P.c1, { dx: 6, dy: 8, hl: [-40, -52, 14, 7, -0.3], detail: tiny() ? null : (q) => { q.fillStyle = shade(P.c1, -0.08); for (let i = 0; i < 8; i++) { q.beginPath(); E(q, -50 + r() * 60, -50 + r() * 34, 2, 1.6); q.fill(); } } });
      break;
    }
    case 'fillet': {
      const path = (q) => {
        q.moveTo(-84, -22); q.bezierCurveTo(-84, -48, -10, -46, 50, -30);
        q.quadraticCurveTo(70, -25, 86, -20); q.quadraticCurveTo(70, -10, 52, -8);
        q.bezierCurveTo(-10, 2, -84, 4, -84, -22); q.closePath();
      };
      c.save(); c.translate(0, 6); c.beginPath(); path(c); fs(c, shade(P.c1, -0.12)); c.restore();
      paint(c, path, P.c1, {
        dx: 3, dy: 5, hl: [-46, -34, 22, 4.5, -0.05],
        detail: tiny() ? null : (q) => {
          for (let i = 0; i < 7; i++) {
            const x = -62 + i * 18;
            q.beginPath(); q.moveTo(x, -38 + i * 1.2); q.quadraticCurveTo(x + 10, -24, x, -10 - i * 0.5);
            strokeIn(q, P.c3, 2.6);
          }
        },
      });
      break;
    }
    case 'strips': {
      for (let k = 0; k < 2; k++) {
        const oy = -k * 16, ox = k * 8 - 4;
        const top = [], bot = [];
        for (let i = 0; i <= 8; i++) { const x = -76 + i * 19 + ox, w = Math.sin(i * 1.3 + k) * 4; top.push(x, oy - 30 + w); bot.unshift(x, oy - 8 + w); }
        const path = (q) => { smoothOpen(q, top, true); smoothOpen(q, bot, false); q.closePath(); };
        paint(c, path, P.c1, {
          dx: 0, dy: 4,
          detail: (q) => {
            for (const f of [0.32, 0.7]) {
              const p = [];
              for (let i = 0; i <= 8; i++) p.push(top[2 * i], lerp(top[2 * i + 1], bot[16 - 2 * i + 1], f));
              q.beginPath(); smoothOpen(q, p, true); strokeIn(q, P.c2, f < 0.5 ? 5 : 3.5);
            }
          },
        });
      }
      break;
    }
    case 'sausage': {
      const spots = [[-4, -13, 0.04], [16, -13, -0.05], [6, -35, 0.03]];
      for (const [x, y, ang] of spots.slice().reverse().sort((p, q) => p[1] - q[1])) {
        sub(c, x, y, 1, () => {
          tube(c, [-68, 0, -76, -2], P.c3, 4); tube(c, [68, 0, 76, 2], P.c3, 4);
          paint(c, (q) => { q.moveTo(-60, -12); q.bezierCurveTo(-20, -16, 20, -16, 60, -12); q.arc(60, 0, 12, -PI / 2, PI / 2); q.bezierCurveTo(20, 14, -20, 14, -60, 12); q.arc(-60, 0, 12, PI / 2, PI * 1.5); q.closePath(); }, P.c1, {
            dx: 0, dy: 5, after: (q) => { q.beginPath(); q.moveTo(-50, -6); q.quadraticCurveTo(0, -10, 40, -7); q.strokeStyle = HL; q.lineWidth = 4; q.stroke(); },
          });
        }, ang);
      }
      break;
    }
    case 'log': {
      const L = 72, R = 24;
      tube(c, [L + 8, -R, L + 18, -R - 6, L + 22, -R + 4], '#f2e6d0', 2.6);
      paint(c, (q) => { q.moveTo(-L, -2 * R); q.lineTo(L, -2 * R); q.arc(L, -R, R, -PI / 2, PI / 2); q.lineTo(-L, 0); q.closePath(); }, P.c1, {
        dx: 0, dy: 8, hl: [0, -2 * R + 10, 40, 5],
        detail: tiny() ? null : (q) => {
          q.strokeStyle = 'rgba(255,248,236,0.85)'; q.lineWidth = 2;
          for (let i = 0; i < 6; i++) { const x = -L + 20 + i * 24; q.beginPath(); q.moveTo(x, -2 * R); q.quadraticCurveTo(x + 6, -R, x, 0); q.stroke(); }
          q.fillStyle = 'rgba(255,255,255,0.45)';
          for (let i = 0; i < 10; i++) { q.beginPath(); E(q, -L + r() * 2 * L, -2 * R + r() * 2 * R, 2.5, 1.8); q.fill(); }
        },
      });
      sub(c, -L, -R, 1, () => xsecBlock(c, a, P, R * 0.42, R, 'log', seed));
      break;
    }
    case 'shrimp': drawShrimp(c, P, seed, !!st.peeled); break;
    case 'shell': {
      const open = !!st.open || P.ck > 0.5;
      const spots = [[-28, -4, -0.35], [26, -4, 0.3], [0, -22, 0.05]];
      for (const [x, y, ang] of spots) sub(c, x, y, 1, () => mussel(c, P, open), ang);
      break;
    }
    case 'finger': {
      const spots = [[-6, 0], [6, -14], [0, -28]];
      for (const [x, y] of spots) sub(c, x, y, 1, () => finger(c, P, r));
      break;
    }
    default:
      paint(c, (q) => RR(q, -50, -50, 100, 50, 14), P.c1, { dx: 5, dy: 6, hl: [-26, -38, 14, 6] });
  }
}
function finger(c, P, r) {
  const col = P.c1;
  paint(c, (q) => { q.moveTo(-64, -22); q.bezierCurveTo(-64, -30, -40, -30, -20, -25); q.bezierCurveTo(0, -21, 20, -30, 52, -27); q.arc(56, -12.5, 13, -PI / 2, PI / 2); q.bezierCurveTo(20, 4, 0, -4, -20, -1); q.bezierCurveTo(-40, 2, -64, 4, -64, -6); q.closePath(); }, col, {
    dx: 0, dy: 5,
    detail: tiny() ? null : (q) => { q.fillStyle = P.c3; for (let i = 0; i < 9; i++) { q.beginPath(); E(q, -56 + r() * 112, -22 + r() * 7, 1.8, 1.3); q.fill(); } },
  });
}
function mussel(c, P, open) {
  const shell = (q, flip) => {
    q.moveTo(-26, 0); q.bezierCurveTo(-20, -22 * flip, 22, -22 * flip, 30, -4 * flip); q.bezierCurveTo(18, 4 * flip, -10, 6 * flip, -26, 0); q.closePath();
  };
  if (open) {
    sub(c, 0, -14, 1, () => paint(c, (q) => shell(q, 1), P.c1, { dx: 0, dy: 3 }), -0.25);
    sub(c, 0, -8, 1, () => {
      c.beginPath(); E(c, 2, -4, 23, 9); fs(c, shade(P.c1, 0.35));
      ball(c, 4, -5, 18, 7, P.c2, { hl: [-2, -8, 7, 2] });
    });
    return;
  }
  sub(c, 0, -10, 1, () => paint(c, (q) => shell(q, 1), P.c1, {
    dx: 0, dy: 4, hl: [-2, -12, 12, 3, -0.1],
    detail: tiny() ? null : (q) => { for (const k of [0.45, 0.7]) { q.beginPath(); q.ellipse(-22, 0, 48 * k, 18 * k, 0, -1.4, -0.1); strokeIn(q, P.c3, 1.8); } },
  }));
}
function drawShrimp(c, P, seed, peeled) {
  const col = peeled ? P.c2 : P.c1;
  // tail fan
  c.beginPath(); c.moveTo(-12, -14); c.lineTo(-38, -4); c.quadraticCurveTo(-30, -16, -36, -26); c.closePath(); fs(c, shade(P.c3, 0.1));
  // curled body: segments along an arc
  const segs = 6;
  for (let i = segs - 1; i >= 0; i--) {
    const u = i / (segs - 1), ang = PI * 1.05 - u * PI * 1.25;
    const x = 4 + Math.cos(ang) * 26, y = -30 - Math.sin(ang) * 22;
    const rr = 9 + u * 7;
    ball(c, x, y, rr, rr * 0.9, i % 2 ? col : shade(col, -0.04), { hl: null, dx: 0, dy: rr * 0.25, rot: ang });
  }
  // head + eye + feelers
  ball(c, 30, -40, 15, 13, col, { hl: [26, -46, 6, 3] });
  c.fillStyle = OUTLINE; c.beginPath(); E(c, 36, -44, 2.6, 2.6); c.fill();
  if (!tiny()) {
    c.beginPath(); c.moveTo(42, -46); c.quadraticCurveTo(60, -62, 70, -56); c.moveTo(42, -42); c.quadraticCurveTo(62, -48, 74, -40);
    strokeIn(c, shade(P.c3, -0.1), 1.8);
    c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(4 + i * 6, -16); c.lineTo(2 + i * 6, -8); } strokeIn(c, P.c3, 2);
  }
}

// ================================================================ containers
function glassHL(c, x, y0, y1, w) {
  c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = w;
  c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke();
}
function drawBottle(c, a, P, st, t, seed) {
  const wine = !!a.wine;
  const path = wine
    ? (q) => { q.moveTo(-26, -10); q.lineTo(-26, -100); q.bezierCurveTo(-26, -122, -10, -118, -10, -138); q.lineTo(-10, -170); q.lineTo(10, -170); q.lineTo(10, -138); q.bezierCurveTo(10, -118, 26, -122, 26, -100); q.lineTo(26, -10); q.quadraticCurveTo(26, 0, 16, 0); q.lineTo(-16, 0); q.quadraticCurveTo(-26, 0, -26, -10); q.closePath(); }
    : (q) => { q.moveTo(-28, -10); q.lineTo(-28, -104); q.bezierCurveTo(-28, -128, -11, -126, -11, -142); q.lineTo(-11, -156); q.lineTo(11, -156); q.lineTo(11, -142); q.bezierCurveTo(11, -126, 28, -128, 28, -104); q.lineTo(28, -10); q.quadraticCurveTo(28, 0, 18, 0); q.lineTo(-18, 0); q.quadraticCurveTo(-28, 0, -28, -10); q.closePath(); };
  const glass = wine ? P.c2 : mix(P.c2, '#ffffff', 0.45);
  const lvl = wine ? -118 : -112;
  paint(c, path, glass, {
    dx: 5, dy: 0,
    detail: (q) => {
      q.fillStyle = wine ? mix(P.c2, P.c1, 0.35) : P.c1;
      q.fillRect(-40, lvl, 80, 200);
      if (!wine) { q.beginPath(); q.moveTo(-40, lvl); q.lineTo(40, lvl); strokeIn(q, shade(P.c1, 0.35), 2.5); }
      // label
      const ly = wine ? -76 : -84, lh = wine ? 46 : 44;
      q.beginPath(); RR(q, -30, ly, 60, lh, 3); fs(q, wine ? '#fbf1dc' : mix(P.c2, '#ffffff', 0.25), LW * 0.8);
      if (!tiny()) {
        if (wine) {
          q.fillStyle = P.c3; q.fillRect(-30, ly + lh - 10, 60, 6);
          for (const [gx, gy] of [[-5, -2], [5, -2], [0, 6], [-10, -10 + 4], [10, -6]]) { q.beginPath(); E(q, gx, ly + 18 + gy, 4.2, 4.2); fs(q, P.c1, LW * 0.5); }
        } else {
          q.beginPath(); E(q, 0, ly + lh / 2, 12, 12); fs(q, P.c3, LW * 0.6);
          q.beginPath(); E(q, -2, ly + lh / 2 + 1, 4.5, 6.5, 0.5); fs(q, P.c1, LW * 0.5);
        }
      }
      glassHL(q, -16, -100, -20, 5);
    },
  });
  if (wine) {
    c.beginPath(); RR(c, -11.5, -182, 23, 34, 4); fs(c, P.c3);
    c.beginPath(); c.moveTo(-11, -156); c.lineTo(11, -156); strokeIn(c, shade(P.c3, -0.25), 2);
  } else {
    c.beginPath(); RR(c, -13, -172, 26, 18, 5); fs(c, P.c3);
    if (!tiny()) { c.beginPath(); for (let i = -1; i <= 1; i++) { c.moveTo(i * 6, -168); c.lineTo(i * 6, -158); } strokeIn(c, shade(P.c3, -0.25), 1.6); }
  }
  if (st.open) { c.fillStyle = OUTLINE; c.beginPath(); E(c, 0, wine ? -184 : -174, 6, 2.5); c.fill(); }
}
function drawCarton(c, a, P, st, t, seed) {
  const W = 60, H = 100, D = 12, Dy = 8;
  const x0 = -W / 2 - D / 2;
  // side face + gable
  c.beginPath(); c.moveTo(x0 + W, -H); c.lineTo(x0 + W + D, -H - Dy); c.lineTo(x0 + W + D, -Dy + 2); c.lineTo(x0 + W, 0); c.closePath(); fs(c, shade(P.c1, -0.16));
  c.beginPath(); c.moveTo(x0 + W, -H); c.lineTo(x0 + W + D, -H - Dy); c.lineTo(x0 + W + 4, -H - 24); c.closePath(); fs(c, shade(P.c1, -0.08));
  c.beginPath(); c.moveTo(x0, -H); c.lineTo(x0 + W, -H); c.lineTo(x0 + W + 4, -H - 24); c.lineTo(x0 + 4, -H - 24); c.closePath(); fs(c, shade(P.c1, 0.12));
  c.beginPath(); RR(c, x0 + 2, -H - 34, W + 4, 11, 3); fs(c, shade(P.c1, 0.05));
  paint(c, (q) => RR(q, x0, -H, W, H, 4), P.c1, {
    dx: 0, dy: 6, hl: [x0 + 12, -H + 22, 6, 16],
    detail: (q) => {
      q.fillStyle = P.c3; q.beginPath(); q.moveTo(x0, -52); q.quadraticCurveTo(x0 + W / 2, -64, x0 + W, -52); q.lineTo(x0 + W, -20); q.lineTo(x0, -20); q.closePath(); q.fill();
      if (tiny()) return;
      q.beginPath(); E(q, x0 + W / 2, -64, 15, 15); fs(q, '#ffffff', LW * 0.7);
      q.beginPath(); q.moveTo(x0 + W / 2, -75); q.quadraticCurveTo(x0 + W / 2 + 9, -63, x0 + W / 2 + 6, -59); q.arc(x0 + W / 2, -60, 6.5, 0.2, PI - 0.2); q.quadraticCurveTo(x0 + W / 2 - 9, -63, x0 + W / 2, -75); q.closePath();
      fs(q, P.c2 === '#ffffff' ? '#cfe6f6' : P.c2, LW * 0.6);
    },
  });
  if (st.open) { c.beginPath(); E(c, x0 + W - 6, -H - 36, 5, 3); fs(c, shade(P.c3, 0.2), LW * 0.7); }
}
function drawJar(c, a, P, st, t, seed) {
  const glass = mix(P.c2, '#ffffff', 0.35);
  paint(c, (q) => RR(q, -34, -80, 68, 80, 15), glass, {
    dx: 5, dy: 5,
    detail: (q) => {
      q.fillStyle = P.c1; q.beginPath(); q.moveTo(-40, -62); q.quadraticCurveTo(0, -70, 40, -62); q.lineTo(40, 10); q.lineTo(-40, 10); q.closePath(); q.fill();
      q.beginPath(); q.moveTo(-40, -62); q.quadraticCurveTo(0, -70, 40, -62); strokeIn(q, shade(P.c1, 0.25), 2);
      q.beginPath(); RR(q, -36, -48, 72, 28, 2); fs(q, mix(P.c2, '#fffaf0', 0.55), LW * 0.7);
      if (!tiny()) { q.beginPath(); E(q, 0, -34, 9, 9); fs(q, P.c3, LW * 0.6); q.beginPath(); q.moveTo(-26, -40); q.lineTo(-14, -40); q.moveTo(14, -28); q.lineTo(26, -28); strokeIn(q, shade(P.c2, -0.3), 2); }
      glassHL(q, -24, -70, -54, 4); glassHL(q, -24, -16, -8, 4);
    },
  });
  if (st.open) {
    sub(c, 46, -6, 1, () => { c.beginPath(); E(c, 0, 0, 30, 9); fs(c, P.c3); }, 0.1);
  } else {
    paint(c, (q) => RR(q, -31, -100, 62, 22, 6), P.c3, {
      dx: 0, dy: 4, hl: [-12, -94, 10, 3],
      detail: tiny() ? null : (q) => { q.strokeStyle = shade(P.c3, -0.22); q.lineWidth = 1.8; for (let i = -24; i <= 24; i += 6) { q.beginPath(); q.moveTo(i, -98); q.lineTo(i, -82); q.stroke(); } },
    });
  }
}
function drawJug(c, a, P, st, t, seed) {
  // handle
  c.beginPath(); c.moveTo(34, -104); c.bezierCurveTo(70, -108, 72, -40, 36, -36);
  c.strokeStyle = OUTLINE; c.lineWidth = 12 + LW * 1.8; c.stroke(); c.strokeStyle = '#e4f2f8'; c.lineWidth = 12; c.stroke();
  const path = (q) => { q.moveTo(-48, -126); q.quadraticCurveTo(-36, -120, -34, -116); q.lineTo(36, -118); q.lineTo(42, -12); q.quadraticCurveTo(42, 0, 30, 0); q.lineTo(-30, 0); q.quadraticCurveTo(-42, 0, -42, -12); q.lineTo(-38, -106); q.quadraticCurveTo(-44, -114, -48, -126); q.closePath(); };
  paint(c, path, '#eef8fc', {
    dx: 6, dy: 0,
    detail: (q) => {
      q.fillStyle = P.c1; q.fillRect(-60, -86, 120, 100);
      q.beginPath(); E(q, 0, -86, 40, 7); q.fillStyle = shade(P.c1, 0.25); q.fill(); strokeIn(q, shade(P.c1, -0.1), 1.6);
      glassHL(q, -24, -100, -20, 6);
      if (!tiny()) glassHL(q, -12, -60, -34, 3);
    },
  });
  c.beginPath(); E(c, 1, -117, 35, 6); c.strokeStyle = OUTLINE; c.lineWidth = LW * 0.6; c.stroke();
}
function drawCan(c, a, P, st, t, seed) {
  const R = 33, Ry = 8, H = 94;
  paint(c, (q) => { q.moveTo(-R, -H); q.lineTo(-R, -Ry); q.ellipse(0, -Ry, R, Ry, 0, PI, 0, true); q.lineTo(R, -H); q.ellipse(0, -H, R, Ry, 0, 0, PI, false); q.closePath(); }, P.c3, {
    dx: 6, dy: 0,
    detail: (q) => {
      q.fillStyle = P.c2; q.fillRect(-R - 2, -H + 12, 2 * R + 4, H - 26);
      q.strokeStyle = shade(P.c3, -0.25); q.lineWidth = 1.8;
      for (const y of [-H + 6, -8]) { q.beginPath(); q.ellipse(0, y, R, Ry, 0, 0.1, PI - 0.1); q.stroke(); }
      if (tiny()) return;
      q.fillStyle = shade(P.c2, 0.25); q.fillRect(-R, -H + 16, 2 * R, 5);
      for (const [x, y, rr] of [[-8, -48, 10], [8, -46, 9], [0, -36, 10]]) { q.beginPath(); E(q, x, y, rr, rr * 0.92); fs(q, P.c1, LW * 0.6); shine(q, x - rr * 0.35, y - rr * 0.4, rr * 0.2); }
      q.beginPath(); E(q, 3, -59, 6, 3, -0.4); fs(q, '#5aa83c', LW * 0.5);
    },
  });
  c.beginPath(); E(c, 0, -H, R, Ry); fs(c, shade(P.c3, 0.15));
  if (st.open) {
    c.beginPath(); E(c, 0, -H, R - 4, Ry - 2.5); fs(c, P.c1, LW * 0.6);
    sub(c, -R + 6, -H - 2, 1, () => { c.beginPath(); E(c, R - 6, 0, R - 5, Ry - 2); fs(c, shade(P.c3, 0.1), LW * 0.8); }, -1.25);
  } else if (!tiny()) {
    c.beginPath(); E(c, 0, -H, R - 5, Ry - 2.5); strokeIn(c, shade(P.c3, -0.2), 1.6);
    c.beginPath(); RR(c, -6, -H - 3, 12, 6, 3); fs(c, shade(P.c3, 0.2), LW * 0.6);
  }
}
function drawShaker(c, a, P, st, t, seed) {
  const glass = mix(P.c2, '#ffffff', 0.3);
  paint(c, (q) => RR(q, -24, -80, 48, 80, 13), glass, {
    dx: 4, dy: 4,
    detail: (q) => {
      q.fillStyle = P.c1; q.beginPath(); q.moveTo(-30, -48);
      for (let i = 0; i <= 6; i++) q.lineTo(-30 + i * 10, -48 + (i % 2 ? -3 : 2));
      q.lineTo(30, 10); q.lineTo(-30, 10); q.closePath(); q.fill();
      if (!tiny() && a.coarse) {
        const r = rng(seed); q.fillStyle = P.c3;
        for (let i = 0; i < 18; i++) { q.beginPath(); E(q, -20 + r() * 40, -44 + r() * 42, 1.6 + r(), 1.2, r() * 3); q.fill(); }
      } else if (!tiny()) {
        const r = rng(seed); q.fillStyle = shade(P.c1, lum(P.c1) > 0.8 ? -0.1 : 0.2);
        for (let i = 0; i < 12; i++) { q.beginPath(); E(q, -20 + r() * 40, -44 + r() * 42, 1.2, 1.2); q.fill(); }
      }
      glassHL(q, -14, -66, -40, 4);
    },
  });
  paint(c, (q) => { q.moveTo(-25, -78); q.lineTo(-25, -92); q.bezierCurveTo(-25, -108, 25, -108, 25, -92); q.lineTo(25, -78); q.closePath(); }, P.c3, {
    dx: 0, dy: 4, hl: [-10, -96, 7, 3, -0.2],
  });
  if (!tiny()) {
    c.fillStyle = OUTLINE;
    for (const [hx, hy] of [[-7, -99], [0, -101], [7, -99], [-3.5, -95], [3.5, -95]]) { c.beginPath(); E(c, hx, hy, 1.7, 1.2); c.fill(); }
    c.beginPath(); c.moveTo(-25, -82); c.lineTo(25, -82); strokeIn(c, shade(P.c3, -0.25), 1.6);
  }
}
function drawSack(c, a, P, st, t, seed) {
  const path = (q) => { q.moveTo(-40, -96); q.lineTo(40, -96); q.bezierCurveTo(48, -60, 50, -20, 44, -6); q.quadraticCurveTo(42, 0, 32, 0); q.lineTo(-32, 0); q.quadraticCurveTo(-42, 0, -44, -6); q.bezierCurveTo(-50, -20, -48, -60, -40, -96); q.closePath(); };
  if (st.open) {
    paint(c, (q) => { q.moveTo(-36, -96); q.bezierCurveTo(-30, -120, 30, -120, 36, -96); q.closePath(); }, P.c1, { dx: 0, dy: 3 });
  }
  paint(c, path, P.c2, {
    dx: 6, dy: 6, hl: [-24, -70, 6, 18, 0.1],
    detail: (q) => {
      if (tiny()) { q.fillStyle = P.c3; q.beginPath(); E(q, 0, -46, 16, 16); q.fill(); return; }
      q.beginPath(); E(q, 0, -48, 22, 22); fs(q, '#fffaf0', LW * 0.7);
      q.beginPath(); E(q, 0, -48, 17, 17); strokeIn(q, P.c3, 2.5);
      for (let i = 0; i < 3; i++) { q.beginPath(); E(q, -6 + i * 6, -52 + (i === 1 ? -4 : 0), 3.2, 6, (i - 1) * 0.5); fs(q, P.c3, LW * 0.45); }
      q.beginPath(); q.moveTo(0, -44); q.lineTo(0, -34); strokeIn(q, P.c3, 2.2);
      q.fillStyle = P.c3; q.fillRect(-48, -20, 96, 6);
    },
  });
  if (!st.open) {
    c.beginPath(); c.moveTo(-42, -94);
    for (let i = 0; i <= 8; i++) c.lineTo(-42 + i * 10.5, -112 + (i % 2 ? -5 : 0));
    c.lineTo(42, -94); c.closePath(); fs(c, shade(P.c2, -0.08));
    c.beginPath(); RR(c, -44, -100, 88, 10, 4); fs(c, shade(P.c2, -0.04));
  } else {
    c.beginPath(); E(c, 0, -96, 40, 7); c.lineWidth = LW; c.stroke();
  }
}
function drawTeaTin(c, a, P, st, t, seed) {
  const R = 34, Ry = 9;
  paint(c, (q) => { q.moveTo(-R, -80); q.lineTo(-R, -Ry); q.ellipse(0, -Ry, R, Ry, 0, PI, 0, true); q.lineTo(R, -80); q.ellipse(0, -80, R, Ry, 0, 0, PI, false); q.closePath(); }, P.c2, {
    dx: 7, dy: 0,
    detail: (q) => {
      q.fillStyle = '#fbf1dc'; q.fillRect(-R - 2, -60, 2 * R + 4, 32);
      q.beginPath(); q.moveTo(-R - 2, -60); q.lineTo(R + 2, -60); q.moveTo(-R - 2, -28); q.lineTo(R + 2, -28); strokeIn(q, shade(P.c2, -0.2), 1.8);
      if (tiny()) return;
      for (const d of [-1, 1]) {
        q.beginPath(); E(q, d * 7, -44, 9, 5.5, d * 0.6); fs(q, d < 0 ? P.c1 : shade(P.c1, 0.15), LW * 0.6);
        q.beginPath(); q.moveTo(d * 7 - Math.cos(d * 0.6) * 6, -44 - Math.sin(d * 0.6) * 6); q.lineTo(d * 7 + Math.cos(d * 0.6) * 6, -44 + Math.sin(d * 0.6) * 6); strokeIn(q, shade(P.c1, 0.4), 1.4);
      }
    },
  });
  if (st.open) {
    c.beginPath(); E(c, 0, -80, R, Ry); fs(c, shade(P.c2, -0.3));
    c.beginPath(); E(c, 0, -80, R - 5, Ry - 2.5); fs(c, P.c1, LW * 0.6);
    if (!tiny()) { const r = rng(seed); c.fillStyle = shade(P.c1, 0.25); for (let i = 0; i < 9; i++) { c.beginPath(); E(c, (r() - 0.5) * 46, -80 + (r() - 0.5) * 8, 2.4, 1.2, r() * 3); c.fill(); } }
    sub(c, R + 22, -8, 1, () => { c.beginPath(); E(c, 0, 0, R + 1, Ry); fs(c, P.c3); }, 0.12);
  } else {
    paint(c, (q) => { q.moveTo(-R - 2, -78); q.lineTo(-R - 2, -92); q.ellipse(0, -92, R + 2, Ry + 1, 0, PI, 0, false); q.lineTo(R + 2, -78); q.ellipse(0, -78, R + 2, Ry + 1, 0, 0, PI, false); q.closePath(); }, P.c3, { dx: 0, dy: 3 });
    c.beginPath(); E(c, 0, -92, R + 2, Ry + 1); fs(c, shade(P.c3, 0.18));
    if (!tiny()) { c.beginPath(); E(c, 0, -92, 8, 2.6); fs(c, shade(P.c3, -0.1), LW * 0.6); }
  }
}
function drawBundle(c, a, P, st, t, seed, short) {
  const L = short ? 56 : 88, H = 24;
  paint(c, (q) => RR(q, -L, -H - 2, 2 * L, H, 9), P.c1, {
    dx: 0, dy: 5,
    detail: tiny() ? null : (q) => {
      q.strokeStyle = shade(P.c1, -0.14); q.lineWidth = 1.4;
      for (let i = 1; i < 6; i++) { const y = -H - 2 + i * H / 6; q.beginPath(); q.moveTo(-L, y); q.lineTo(L, y + (i % 2 ? 1 : -1)); q.stroke(); }
    },
  });
  c.beginPath(); E(c, -L + 2, -H / 2 - 2, 6, H / 2); fs(c, shade(P.c1, 0.1), LW * 0.8);
  if (!tiny()) { c.fillStyle = shade(P.c1, -0.25); for (let i = 0; i < 6; i++) { c.beginPath(); E(c, -L + 1 + (i % 2) * 3, -H + 2 + i * 3.4, 1.2, 1.2); c.fill(); } }
  if (!short) {
    paint(c, (q) => RR(q, -28, -H - 7, 56, H + 10, 6), P.c2, {
      dx: 0, dy: 4, hl: [-12, -H, 10, 3],
      detail: tiny() ? null : (q) => { q.beginPath(); E(q, 0, -H / 2 - 2, 10, 8); fs(q, '#fffaf0', LW * 0.6); q.beginPath(); q.moveTo(-5, -H / 2); q.quadraticCurveTo(0, -H / 2 - 6, 5, -H / 2); strokeIn(q, '#d8a040', 2); },
    });
  }
}

// ================================================================ dough
function doughFlatGeom(st) {
  const size = clamp(num(st.size, 1), 0, 1);
  const R = lerp(48, 106, size);
  const form = st.form || 'round';
  const th = lerp(13, 7, size);
  if (form === 'boat') return { R, rx: R * 1.45, ry: R * 0.36, th, form, size };
  if (form === 'oval') return { R, rx: R * 1.12, ry: R * 0.55, th, form, size };
  return { R, rx: R, ry: R * 0.58, th, form, size };
}
function doughFlatPath(g, cy, k = 1) {
  const rx = g.rx * k, ry = g.ry * k;
  if (g.form === 'boat') return (q) => {
    q.moveTo(-rx - 6 * k, cy);
    q.bezierCurveTo(-rx * 0.55, cy - ry * 1.45, rx * 0.55, cy - ry * 1.45, rx + 6 * k, cy);
    q.bezierCurveTo(rx * 0.55, cy + ry * 1.45, -rx * 0.55, cy + ry * 1.45, -rx - 6 * k, cy);
    q.closePath();
  };
  if (g.form === 'oval') return (q) => {
    q.moveTo(-rx, cy);
    q.bezierCurveTo(-rx, cy - ry * 1.2, rx * 0.4, cy - ry * 1.05, rx, cy - ry * 0.1);
    q.bezierCurveTo(rx * 1.05, cy + ry * 0.4, rx * 0.4, cy + ry * 1.05, -rx * 0.1, cy + ry);
    q.bezierCurveTo(-rx * 0.7, cy + ry * 0.95, -rx, cy + ry * 0.6, -rx, cy);
    q.closePath();
  };
  return (q) => E(q, 0, cy, rx, ry);
}
function drawDough(c, kind, a, P, st, t, seed) {
  const shape = st.shape || 'ball';
  const r = rng(seed);
  if (shape === 'rough') {
    const p = blobPts(0, -32, 56, 32, 14, 0.15, seed);
    for (let i = 1; i < p.length; i += 2) p[i] = Math.min(p[i], 1);
    paint(c, (q) => smoothClosed(q, p), P.c1, {
      dx: 6, dy: 7, hl: [-20, -46, 14, 7, -0.4],
      detail: tiny() ? null : (q) => {
        for (let i = 0; i < 5; i++) { const x = -36 + r() * 72, y = -48 + r() * 34; q.beginPath(); q.moveTo(x, y); q.quadraticCurveTo(x + 6, y + 4, x + 12, y + 1); strokeIn(q, shade(P.c1, -0.22), 2); }
        q.fillStyle = P.c2; for (let i = 0; i < 12; i++) { q.beginPath(); E(q, -40 + r() * 80, -55 + r() * 30, 2, 1.5); q.fill(); }
      },
    });
    if (!tiny()) for (let i = 0; i < 3; i++) { const p2 = blobPts((i - 1) * 50 + (r() - 0.5) * 10, -4, 6, 4, 6, 0.3, seed + i); c.beginPath(); smoothClosed(c, p2); fs(c, P.c1, LW * 0.7); }
    return;
  }
  if (shape === 'ball') {
    paint(c, (q) => squash(q, 0, -36, 54, 36), P.c1, {
      dx: 6, dy: 7, hl: [-20, -52, 15, 7, -0.35],
      detail: (q) => {
        q.fillStyle = rgba(P.c2, 0.8); q.beginPath(); E(q, 6, -62, 22, 6, 0.1); q.fill();
        if (tiny()) return;
        q.fillStyle = P.c2; for (let i = 0; i < 10; i++) { q.beginPath(); E(q, -40 + r() * 80, -64 + r() * 30, 1.8, 1.4); q.fill(); }
      },
    });
    if (P.ck > 0.4 && !tiny()) { c.beginPath(); c.moveTo(-14, -62); c.lineTo(14, -50); c.moveTo(14, -62); c.lineTo(-14, -50); strokeIn(c, shade(P.c1, -0.3), 3); }
    return;
  }
  // flat disc (pizza / naan / pide / lahmacun)
  const g = doughFlatGeom(st);
  const cy = -(g.th + g.ry);
  const top = doughFlatPath(g, cy);
  const ck = P.ck;
  const crust = ck > 0 ? mix(a.c1, '#d08a3a', ck * 0.85) : P.c1;
  c.save(); c.translate(0, g.th); c.beginPath(); top(c); c.restore();
  fs(c, shade(crust, -0.18));
  const inner = g.form === 'boat' ? 0.74 : 0.84;
  paint(c, top, crust, {
    dx: 0, dy: g.ry * 0.12,
    hl: st.sauce ? null : [-g.rx * 0.35, cy - g.ry * 0.45, g.rx * 0.25, g.ry * 0.12],
    detail: (q) => {
      if (!tiny()) {
        q.beginPath(); doughFlatPath(g, cy, inner + 0.06)(q);
        strokeIn(q, shade(crust, -0.12), LW * 0.7);
      }
      if (ck > 0.35 && !tiny()) {
        q.fillStyle = rgba('#5a2e14', clamp((ck - 0.35) * 1.4, 0, 0.8));
        for (let i = 0; i < 14; i++) { const an = r() * TAU; q.beginPath(); E(q, Math.cos(an) * g.rx * 0.93, cy + Math.sin(an) * g.ry * 0.92, 3 + r() * 2.5, 2 + r() * 1.5, an); q.fill(); }
      }
      if (!st.sauce && ck < 0.3 && !tiny()) {
        q.fillStyle = P.c2; for (let i = 0; i < 12; i++) { const an = r() * TAU, d = Math.sqrt(r()) * 0.8; q.beginPath(); E(q, Math.cos(an) * g.rx * d, cy + Math.sin(an) * g.ry * d, 2, 1.4); q.fill(); }
      }
    },
  });
  if (g.form === 'boat') {
    // twisted tips
    for (const sx of [-1, 1]) { c.beginPath(); E(c, sx * (g.rx + 4), cy, 10, 6, sx * 0.3); fs(c, crust, LW * 0.8); }
  }
  // sauce
  const cov = clamp(num(st.coverage, st.sauce ? 1 : 0), 0, 1);
  if (st.sauce && cov > 0) {
    const k = inner * Math.sqrt(cov);
    const sp = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const an = (i / n) * TAU, w = 1 + (cov < 0.97 ? 0.08 * Math.sin(i * 2.3 + seed) : 0.02 * Math.sin(i * 3));
      sp.push(Math.cos(an) * g.rx * k * w, cy + Math.sin(an) * g.ry * k * w);
    }
    if (g.form !== 'round') {
      c.save(); c.beginPath(); doughFlatPath(g, cy, inner)(c); c.clip();
    }
    const sauce = ck > 0 ? mix(st.sauce, '#7a2a14', ck * 0.3) : st.sauce;
    paint(c, (q) => smoothClosed(q, sp), sauce, {
      dx: 0, dy: -g.ry * 0.06, lw: LW * 0.7, shade: 'rgba(86,36,18,0.16)',
      hl: [-g.rx * k * 0.35, cy - g.ry * k * 0.4, g.rx * k * 0.22, g.ry * k * 0.1, -0.15],
    });
    if (g.form !== 'round') c.restore();
  }
  // toppings
  const tops = Array.isArray(st.toppings) ? st.toppings.filter((p) => p && typeof p === 'object').sort((p, q) => num(p.y) - num(q.y)) : [];
  const ts = clamp(g.R / 106, 0.5, 1.3) * 1.45;
  for (let i = 0; i < tops.length; i++) {
    const tp = tops[i];
    if (!tp) continue;
    const px = clamp(num(tp.x), -1, 1) * g.rx * inner * 0.92, py = cy + clamp(num(tp.y), -1, 1) * g.ry * inner * 0.92;
    drawTopping(c, tp.kind, px, py, ts, ck, seed + i * 31);
  }
}

// ================================================================ cross sections
// A cut face / slice face centred at (0,0) with radii rx × ry, incl. outline.
function xsec(c, a, P, rx, ry, seed) {
  switch (a.type) {
    case 'round': return xsecRound(c, a, P, rx, ry, seed);
    case 'long': return xsecLong(c, a, P, rx, ry, seed);
    case 'block': return xsecBlock(c, a, P, rx, ry, a.shape, seed);
    case 'egg': {
      c.beginPath(); E(c, 0, 0, rx, ry); fs(c, P.c2);
      c.beginPath(); E(c, 0, ry * 0.05, rx * 0.5, ry * 0.5); fs(c, P.c3, LW * 0.6);
      return;
    }
    case 'bulb': {
      c.beginPath(); E(c, 0, 0, rx, ry); fs(c, P.c2);
      if (!tiny()) { c.beginPath(); for (const k of [-0.5, 0, 0.5]) { c.moveTo(k * rx, -ry * 0.8); c.lineTo(k * rx * 0.6, ry * 0.8); } strokeIn(c, shade(P.c3, 0.2), 1.6); }
      return;
    }
    case 'mushroom': {
      c.beginPath(); E(c, 0, 0, rx, ry); fs(c, P.c2);
      c.beginPath(); c.ellipse(0, ry * 0.15, rx * 0.8, ry * 0.5, 0, PI * 1.05, PI * 1.95); strokeIn(c, P.c3, 2);
      return;
    }
    case 'head': case 'leaf': {
      c.beginPath(); E(c, 0, 0, rx, ry); fs(c, P.c2);
      if (!tiny()) { for (const k of [0.75, 0.5, 0.28]) { c.beginPath(); c.ellipse(0, 0, rx * k, ry * k, 0, 0.2, 5.6); strokeIn(c, P.c1, 2.2); } }
      return;
    }
    default:
      c.beginPath(); E(c, 0, 0, rx, ry); fs(c, P.c2 || P.c1);
  }
}
function rimFlesh(c, rx, ry, rim, skin, flesh, path) {
  c.beginPath(); (path ? path(1) : E(c, 0, 0, rx, ry)); c.fillStyle = skin; c.fill();
  c.beginPath(); (path ? path(1 - rim) : E(c, 0, 0, rx * (1 - rim), ry * (1 - rim))); c.fillStyle = flesh; c.fill();
}
function xsecRound(c, a, P, rx, ry, seed) {
  const papery = a.tip && !a.segments;
  const sm = Math.min(rx, ry);
  if (a.hollow) return ringFace(c, P, rx, ry, seed, false);
  if (papery) {
    rimFlesh(c, rx, ry, 0.06, P.c1, P.c2);
    if (!tiny()) for (const k of [0.8, 0.6, 0.4, 0.2]) { c.beginPath(); E(c, 0, 0, rx * k, ry * k); strokeIn(c, P.c3, Math.max(1.4, sm * 0.05)); }
  } else if (a.segments) {
    rimFlesh(c, rx, ry, 0.1, P.c1, P.c3);
    c.beginPath(); E(c, 0, 0, rx * 0.84, ry * 0.84); c.fillStyle = P.c2; c.fill();
    if (!tiny()) {
      c.beginPath();
      for (let i = 0; i < 8; i++) { const an = (i / 8) * TAU; c.moveTo(0, 0); c.lineTo(Math.cos(an) * rx * 0.84, Math.sin(an) * ry * 0.84); }
      strokeIn(c, P.c3, Math.max(1.4, sm * 0.07));
      c.beginPath(); E(c, 0, 0, rx * 0.1, ry * 0.1); c.fillStyle = P.c3; c.fill();
    }
  } else if (a.stem) {
    rimFlesh(c, rx, ry, 0.1, P.c1, P.c2);
    if (!tiny()) {
      const gel = mix(P.c2, P.c3, 0.45);
      for (let i = 0; i < 3; i++) {
        const an = -PI / 2 + i * TAU / 3, gx = Math.cos(an) * rx * 0.45, gy = Math.sin(an) * ry * 0.45;
        c.beginPath(); E(c, gx, gy, rx * 0.25, ry * 0.25, an); c.fillStyle = gel; c.fill();
        c.fillStyle = P.c3;
        for (let k = -1; k <= 1; k++) { c.beginPath(); E(c, gx + Math.cos(an + 1.6) * k * rx * 0.1, gy + Math.sin(an + 1.6) * k * ry * 0.1, Math.max(1.3, rx * 0.04), Math.max(1, ry * 0.03), an); c.fill(); }
      }
      c.beginPath(); E(c, 0, 0, rx * 0.12, ry * 0.12); c.fillStyle = shade(P.c2, 0.2); c.fill();
    }
  } else {
    rimFlesh(c, rx, ry, 0.06, P.c1, P.c2);
    if (!tiny()) { c.beginPath(); E(c, 0, 0, rx * 0.78, ry * 0.78); strokeIn(c, shade(P.c2, -0.08), Math.max(1.2, sm * 0.04)); }
  }
  c.beginPath(); E(c, 0, 0, rx, ry); fs(c, null);
}
function ringFace(c, P, rx, ry, seed, hole) {
  const lob = (k) => (q) => {
    const p = [];
    for (let i = 0; i < 16; i++) { const an = (i / 16) * TAU, w = 1 + 0.06 * Math.cos(an * 4); p.push(Math.cos(an) * rx * k * w, Math.sin(an) * ry * k * w); }
    smoothClosed(q, p);
  };
  c.beginPath(); lob(1)(c); c.fillStyle = P.c1; c.fill();
  c.beginPath(); lob(0.8)(c); c.fillStyle = hole ? 'rgba(0,0,0,0)' : mix(P.c2, '#ffffff', 0.25); c.fill();
  if (!hole && !tiny()) {
    c.fillStyle = '#fbf0cc';
    const r = rng(seed);
    for (let i = 0; i < 6; i++) { c.beginPath(); E(c, (r() - 0.5) * rx * 0.5, (r() - 0.5) * ry * 0.5, Math.max(1.5, rx * 0.07), Math.max(1.1, ry * 0.05), r() * 3); c.fill(); }
  }
  c.beginPath(); lob(0.8)(c); strokeIn(c, OUTLINE, LW * 0.6);
  c.beginPath(); lob(1)(c); fs(c, null);
}
function xsecLong(c, a, P, rx, ry, seed) {
  const sm = Math.min(rx, ry);
  if (a.hollow) return ringFace(c, P, rx, ry, seed, false);
  if (a.thin) {
    rimFlesh(c, rx, ry, 0.28, P.c1, P.c2);
    if (!tiny()) { c.fillStyle = shade(P.c2, 0.4); for (const k of [-0.3, 0.3]) { c.beginPath(); E(c, k * rx, 0, rx * 0.16, ry * 0.18); c.fill(); } }
  } else if (a.rings) {
    c.beginPath(); E(c, 0, 0, rx, ry); c.fillStyle = P.c1; c.fill();
    c.beginPath(); E(c, 0, 0, rx * 0.5, ry * 0.5); c.fillStyle = P.c2; c.fill(); strokeIn(c, shade(P.c1, -0.12), Math.max(1.2, sm * 0.05));
    if (!tiny()) { c.beginPath(); for (let i = 0; i < 6; i++) { const an = (i / 6) * TAU; c.moveTo(Math.cos(an) * rx * 0.55, Math.sin(an) * ry * 0.55); c.lineTo(Math.cos(an) * rx * 0.85, Math.sin(an) * ry * 0.85); } strokeIn(c, shade(P.c1, 0.2), 1.2); }
  } else if (a.knobby) {
    rimFlesh(c, rx, ry, 0.08, P.c1, P.c2);
    if (!tiny()) { const r = rng(seed); c.fillStyle = P.c3; for (let i = 0; i < 8; i++) { c.beginPath(); E(c, (r() - 0.5) * rx * 1.2, (r() - 0.5) * ry * 1.2, 1.4, 1.4); c.fill(); } }
  } else {
    rimFlesh(c, rx, ry, 0.08, P.c1, P.c2);
    if (a.seeds && !tiny()) {
      const egg = (a.taper || 0) < 0;
      if (!egg) { c.beginPath(); E(c, 0, 0, rx * 0.5, ry * 0.5); c.fillStyle = shade(P.c2, -0.08); c.fill(); }
      c.fillStyle = egg ? shade(P.c2, -0.45) : '#fffbea';
      for (let i = 0; i < (egg ? 9 : 6); i++) {
        const an = (i / (egg ? 9 : 6)) * TAU, k = egg ? 0.5 : 0.32;
        c.beginPath(); E(c, Math.cos(an) * rx * k, Math.sin(an) * ry * k, Math.max(1.4, rx * 0.08), Math.max(1, ry * 0.05), an); c.fill();
      }
    }
  }
  c.beginPath(); E(c, 0, 0, rx, ry); fs(c, null);
}
function xsecBlock(c, a, P, rx, ry, shapeName, seed) {
  const r = rng(seed);
  const sm = Math.min(rx, ry);
  switch (shapeName) {
    case 'log': case 'sausage':
      rimFlesh(c, rx, ry, 0.1, P.c1, P.c2);
      if (!tiny()) {
        c.fillStyle = P.c3;
        for (let i = 0; i < (shapeName === 'log' ? 9 : 4); i++) { const an = r() * TAU, d = Math.sqrt(r()) * 0.7; c.beginPath(); E(c, Math.cos(an) * rx * d, Math.sin(an) * ry * d, Math.max(1.2, rx * 0.09), Math.max(1, ry * 0.07), r() * 3); c.fill(); }
      }
      break;
    case 'loaf':
      rimFlesh(c, rx, ry, 0.13, P.c1, P.c2);
      if (!tiny()) { c.fillStyle = shade(P.c2, -0.12); for (let i = 0; i < 7; i++) { c.beginPath(); E(c, (r() - 0.5) * rx * 1.2, (r() - 0.5) * ry * 1.2, Math.max(1.2, rx * 0.07), Math.max(1, ry * 0.05)); c.fill(); } }
      break;
    case 'chunk': case 'drumstick': case 'mince':
      rimFlesh(c, rx, ry, 0.1, P.c1, P.c2);
      if (!tiny()) {
        if (shapeName === 'drumstick') { c.beginPath(); E(c, 0, 0, rx * 0.22, ry * 0.22); fs(c, '#fbf3e8', LW * 0.5); }
        else { c.beginPath(); c.moveTo(-rx * 0.6, -ry * 0.2); c.quadraticCurveTo(0, ry * 0.3, rx * 0.5, -ry * 0.3); strokeIn(c, P.c3, Math.max(1.4, sm * 0.1)); }
      }
      break;
    case 'fillet':
      c.beginPath(); E(c, 0, 0, rx, ry); c.fillStyle = P.c2; c.fill();
      if (!tiny()) for (const k of [-0.4, 0, 0.4]) { c.beginPath(); c.moveTo(k * rx - 2, -ry * 0.7); c.quadraticCurveTo(k * rx + rx * 0.2, 0, k * rx - 2, ry * 0.7); strokeIn(c, P.c3, 1.6); }
      break;
    case 'strips':
      c.beginPath(); E(c, 0, 0, rx, ry); c.fillStyle = P.c1; c.fill();
      c.save(); c.beginPath(); E(c, 0, 0, rx, ry); c.clip(); c.fillStyle = P.c2; c.fillRect(-rx, -ry * 0.35, rx * 2, ry * 0.25); c.fillRect(-rx, ry * 0.25, rx * 2, ry * 0.2); c.restore();
      break;
    default: // cheese, butter, mozzarella, paneer, ladyfingers, shell…
      rimFlesh(c, rx, ry, shapeName === 'ball' ? 0.04 : 0.07, P.c1, P.c2);
      if (!tiny()) {
        if (a.holes) { c.fillStyle = shade(P.c2, -0.14); for (let i = 0; i < 4; i++) { c.beginPath(); E(c, (r() - 0.5) * rx, (r() - 0.5) * ry, Math.max(1.5, sm * 0.15), Math.max(1.2, sm * 0.12)); c.fill(); } }
        else if (shapeName === 'wedge' && sat(P.c3) > 0.2 && lum(P.c3) < 0.55) { c.beginPath(); c.moveTo(-rx * 0.5, -ry * 0.1); c.quadraticCurveTo(0, -ry * 0.5, rx * 0.4, ry * 0.2); strokeIn(c, P.c3, Math.max(1.4, sm * 0.08)); }
      }
  }
  c.beginPath(); E(c, 0, 0, rx, ry); fs(c, null);
}

// ================================================================ pieces
const CUT_ALIAS = { slice: 'slices', sliced: 'slices', ring: 'rings', half: 'halves', halved: 'halves', wedge: 'wedges', quarters: 'wedges', strip: 'strips', julienne: 'strips', sticks: 'strips', chips: 'strips', shredded: 'strips', diced: 'dice', cubes: 'dice', chopped: 'dice', minced: 'mince', grate: 'grated', tear: 'torn', chunk: 'chunks', crush: 'crushed', roll: 'rolls', leaf: 'leaves' };
function normCut(cut) { return CUT_ALIAS[cut] || cut; }

// The main colour of small pieces (dice, mince…) of an ingredient.
function pieceCol(a, P) {
  switch (a.type) {
    case 'round':
      if (a.hollow) return P.c1;
      if (a.stem && !a.lobes) return mix(P.c1, P.c2, 0.4);
      return P.c2;
    case 'long':
      if (a.rings || a.hollow || a.thin) return P.c1;
      return P.c2;
    case 'block':
      if (a.shape === 'strips' || a.shape === 'mince') return P.c1;
      if (a.shape === 'ball') return P.c1;
      return P.c2;
    case 'herb': case 'head': case 'leaf': case 'pile': case 'dough': return P.c1;
    case 'egg': case 'bulb': case 'mushroom': return P.c2;
    default: return P.c1; // containers: the content colour
  }
}
// Skin colour shown on some faces of pieces (or null when it would not read).
function pieceSkin(a, P) {
  if (a.type === 'long' && a.seeds) return P.c1;
  if (a.type === 'mushroom') return P.c1;
  if (a.type === 'block' && (a.shape === 'chunk' || a.shape === 'loaf')) return P.c1;
  if (a.type === 'round' && a.stem && !a.lobes) return P.c1;
  if (a.type === 'egg') return P.c3;
  return null;
}

function cube(c, d, front, top, side, rr) {
  const o = d * 0.34, h = d / 2;
  c.lineWidth = LW * 0.75; c.strokeStyle = OUTLINE;
  c.beginPath(); c.moveTo(h, -h); c.lineTo(h + o, -h - o); c.lineTo(h + o, h - o); c.lineTo(h, h); c.closePath();
  c.fillStyle = side; c.fill(); c.stroke();
  c.beginPath(); c.moveTo(-h, -h); c.lineTo(-h + o, -h - o); c.lineTo(h + o, -h - o); c.lineTo(h, -h); c.closePath();
  c.fillStyle = top; c.fill(); c.stroke();
  c.beginPath(); RR(c, -h, -h, d, d, rr || d * 0.16); c.fillStyle = front; c.fill(); c.stroke();
}
function stick(c, len, w, fill, edge) {
  paint(c, (q) => RR(q, -len / 2, -w / 2, len, w, w * 0.45), fill, {
    dx: 0, dy: w * 0.28, lw: LW * 0.8,
    detail: edge ? (q) => { q.fillStyle = edge; q.fillRect(-len / 2, -w / 2 - 2, len, w * 0.32 + 2); } : null,
  });
}
// Bread / cheese / meat slab slice standing slightly leaning.
function slab(c, a, P, w, h, seed) {
  const sh = a.shape;
  if (sh === 'loaf') {
    const path = (q) => { q.moveTo(-w / 2, h / 2); q.lineTo(-w / 2, -h * 0.15); q.bezierCurveTo(-w * 0.62, -h * 0.62, -w * 0.2, -h * 0.58, 0, -h / 2); q.bezierCurveTo(w * 0.2, -h * 0.58, w * 0.62, -h * 0.62, w / 2, -h * 0.15); q.lineTo(w / 2, h / 2); q.closePath(); };
    c.beginPath(); path(c); fs(c, P.c1);
    c.save(); c.beginPath(); path(c); c.clip();
    c.translate(0, 2); c.scale(0.8, 0.82); c.beginPath(); path(c); c.fillStyle = P.c2; c.fill();
    if (!tiny()) { const r = rng(seed); c.fillStyle = shade(P.c2, -0.12); for (let i = 0; i < 6; i++) { c.beginPath(); E(c, (r() - 0.5) * w * 0.7, (r() - 0.4) * h * 0.6, 2.4, 1.8); c.fill(); } }
    c.restore();
    return;
  }
  paint(c, (q) => RR(q, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.22), MEATY[sh] || sh === 'fillet' ? P.c2 : P.c2, {
    dx: 0, dy: h * 0.12, lw: LW * 0.85,
    detail: (q) => {
      q.fillStyle = P.c1; q.fillRect(-w / 2 - 2, -h / 2 - 2, w + 4, 5);
      if (tiny()) return;
      if (a.holes) { q.fillStyle = shade(P.c2, -0.15); for (const [hx, hy, hr] of [[-w * 0.2, -h * 0.05, 5], [w * 0.18, h * 0.15, 4], [w * 0.05, -h * 0.25, 3]]) { q.beginPath(); E(q, hx, hy, hr, hr * 0.8); q.fill(); } }
      if (MEATY[sh]) { q.beginPath(); q.moveTo(-w * 0.4, -h * 0.05); q.quadraticCurveTo(0, h * 0.2, w * 0.4, -h * 0.1); strokeIn(q, P.c3, 2.4); }
      if (sh === 'fillet') for (const k of [-0.25, 0.05, 0.35]) { q.beginPath(); q.moveTo(k * w, -h * 0.4); q.quadraticCurveTo(k * w + 6, 0, k * w, h * 0.4); strokeIn(q, P.c3, 2); }
    },
  });
}
function pSlice(c, a, P, rx, ry, seed) {
  // edge (thickness) then face
  c.beginPath(); E(c, 3.5, 3, rx, ry); fs(c, shade(a.type === 'egg' ? P.c2 : P.c1, -0.1), LW * 0.85);
  if (a.type === 'mushroom') return mushSlice(c, P, rx * 2);
  xsec(c, a, P, rx, ry, seed);
}
function mushSlice(c, P, w) {
  const path = (q) => {
    q.moveTo(-w / 2, -w * 0.02);
    q.bezierCurveTo(-w / 2, -w * 0.48, w / 2, -w * 0.48, w / 2, -w * 0.02);
    q.quadraticCurveTo(w * 0.3, w * 0.06, w * 0.16, w * 0.04);
    q.lineTo(w * 0.16, w * 0.32); q.quadraticCurveTo(0, w * 0.37, -w * 0.16, w * 0.32);
    q.lineTo(-w * 0.16, w * 0.04); q.quadraticCurveTo(-w * 0.3, w * 0.06, -w / 2, -w * 0.02);
    q.closePath();
  };
  c.beginPath(); path(c); fs(c, P.c2, LW * 0.85);
  if (!tiny()) { c.beginPath(); c.moveTo(-w * 0.4, -w * 0.06); c.quadraticCurveTo(0, -w * 0.16, w * 0.4, -w * 0.06); strokeIn(c, P.c3, Math.max(1.4, w * 0.05)); }
  c.beginPath(); c.moveTo(-w * 0.44, -w * 0.2); c.bezierCurveTo(-w * 0.36, -w * 0.4, w * 0.36, -w * 0.4, w * 0.44, -w * 0.2); strokeIn(c, P.c1, Math.max(1.5, w * 0.05));
}
function pRing(c, a, P, rx, ry, seed, idx) {
  const papery = a.tip && !a.segments;
  if (papery) {
    const k = clamp(9 / Math.max(rx, 1), 0.16, 0.34);
    c.beginPath(); E(c, 0, 0, rx, ry); E(c, 0, 0, rx * (1 - k), ry * (1 - k));
    c.fillStyle = P.c2; c.fill('evenodd'); c.lineWidth = LW * 0.75; c.strokeStyle = OUTLINE; c.stroke();
    if (!tiny() && rx > 14) { c.beginPath(); c.ellipse(0, 0, rx * (1 - k / 2), ry * (1 - k / 2), 0, PI * 1.05, PI * 1.75); strokeIn(c, rgba('#ffffff', 0.8), Math.max(1.4, rx * k * 0.25)); c.beginPath(); c.ellipse(0, 0, rx * (1 - k / 2), ry * (1 - k / 2), 0, 0.2, 2.6); strokeIn(c, rgba(P.c3, 0.9), Math.max(1.2, rx * k * 0.2)); }
    return;
  }
  if (a.thin) {
    c.beginPath(); E(c, 0, 0, rx, ry); fs(c, P.c1, LW * 0.65);
    c.beginPath(); E(c, 0, 0, rx * 0.6, ry * 0.6); fs(c, mix(P.c2, '#ffffff', 0.2), LW * 0.4);
    if (!tiny()) { c.fillStyle = '#fbf0cc'; for (const k of [-0.25, 0.25]) { c.beginPath(); E(c, k * rx, 0, rx * 0.14, ry * 0.12); c.fill(); } }
    return;
  }
  const lob = (k) => { const p = []; for (let i = 0; i < 16; i++) { const an = (i / 16) * TAU, w = 1 + 0.07 * Math.cos(an * 4 + idx); p.push(Math.cos(an) * rx * k * w, Math.sin(an) * ry * k * w); } return p; };
  c.beginPath(); smoothClosed(c, lob(1)); smoothClosed(c, lob(0.76));
  c.fillStyle = P.c1; c.fill('evenodd'); c.lineWidth = LW * 0.8; c.strokeStyle = OUTLINE; c.stroke();
  if (!tiny()) { c.beginPath(); smoothClosed(c, lob(0.8)); strokeIn(c, mix(P.c2, '#ffffff', 0.3), Math.max(1.2, rx * 0.05)); }
}
function pHalf(c, a, P, seed, w) {
  if (a.type === 'long' && !a.knobby) {
    const g = tubeOf(a);
    const sk = tubePath(g, 0.5), k = w / (g.L + 10);
    sub(c, 0, 0, k, () => {
      c.save(); c.translate(0, 9); c.beginPath(); sk(c); c.restore(); fs(c, a.hollow ? P.c1 : shade(P.c1, -0.05));
      paint(c, sk, a.hollow ? P.c1 : P.c2, {
        lw: LW,
        detail: (q) => {
          if (a.hollow) { q.save(); q.translate(0, 0); const inner = tubePath({ ...g, r: g.r.map((v) => v * 0.78) }, 0.4); q.beginPath(); inner(q); q.fillStyle = mix(P.c2, '#ffffff', 0.2); q.fill(); q.restore(); }
          else if (a.seeds && !tiny()) {
            q.fillStyle = (a.taper || 0) < 0 ? shade(P.c2, -0.45) : shade(P.c2, -0.1);
            for (let i = 2; i < g.N - 1; i += 2) { q.beginPath(); E(q, g.x[i], g.y[i], 3, g.r[i] * 0.18); q.fill(); }
          } else if (a.rings) { q.beginPath(); smoothOpen(q, tubeLine(g, 0, 0.05, 0.9), true); strokeIn(q, shade(P.c2, 0.25), g.T * 0.3); }
        },
      });
    });
    return;
  }
  const fx = w / 2, fy = fx * 0.5, d = fx * 0.55;
  if (a.type === 'egg' && !P.boiled) {
    c.beginPath(); c.moveTo(-fx, -d); c.ellipse(0, -d, fx, d, 0, PI, 0, true);
    for (let i = 0; i <= 6; i++) c.lineTo(fx - i * fx / 3, -d + (i % 2 ? -5 : 0));
    c.closePath(); fs(c, P.c1);
    c.beginPath(); E(c, 0, -d - 1, fx * 0.8, fy * 0.6); fs(c, shade(P.c1, -0.2), LW * 0.6);
    return;
  }
  const skin = a.type === 'egg' ? P.c2 : P.c1;
  paint(c, (q) => { q.moveTo(-fx, -d); q.ellipse(0, -d, fx, d, 0, PI, 0, true); q.closePath(); }, skin, { dx: 0, dy: d * 0.3 });
  sub(c, 0, -d, 1, () => {
    if (a.type === 'egg') { c.beginPath(); E(c, 0, 0, fx, fy); fs(c, P.c2); ball(c, 0, -fy * 0.15, fx * 0.48, fy * 0.62, P.c3, { hl: [-fx * 0.15, -fy * 0.4, fx * 0.15, fy * 0.15] }); }
    else if (a.type === 'block') xsecBlock(c, a, P, fx, fy, a.shape, seed);
    else if (a.type === 'bulb') { c.beginPath(); E(c, 0, 0, fx, fy); fs(c, P.c2); c.beginPath(); for (let i = 0; i < 6; i++) { const an = (i / 6) * TAU; c.moveTo(0, 0); c.lineTo(Math.cos(an) * fx * 0.9, Math.sin(an) * fy * 0.9); } strokeIn(c, shade(P.c3, 0.2), 1.6); }
    else xsec(c, a, P, fx, fy, seed);
  });
}
function pWedge(c, a, P, L, seed) {
  const h = L * 0.34;
  const outer = (q) => { q.moveTo(-L / 2, -h); q.quadraticCurveTo(0, -h * 0.8, L / 2, -h); q.bezierCurveTo(L * 0.42, h * 0.1, -L * 0.42, h * 0.1, -L / 2, -h); q.closePath(); };
  const egg = a.type === 'egg';
  paint(c, outer, egg ? P.c2 : P.c1, { dx: 0, dy: h * 0.25 });
  const rim = a.segments ? 0.32 : egg ? 0.12 : 0.18;
  const inner = (q) => { q.moveTo(-L / 2 + 3, -h + 1); q.quadraticCurveTo(0, -h * 0.8, L / 2 - 3, -h + 1); q.bezierCurveTo(L * 0.38, -h * rim * 1.5, -L * 0.38, -h * rim * 1.5, -L / 2 + 3, -h + 1); q.closePath(); };
  c.beginPath(); inner(c);
  c.fillStyle = egg ? P.c3 : P.c2; c.fill();
  c.lineWidth = LW * 0.55; c.strokeStyle = egg ? OUTLINE : shade(P.c2, -0.2); c.stroke();
  if (tiny()) return;
  if (a.segments) { c.beginPath(); for (const k of [-0.25, 0, 0.25]) { c.moveTo(k * L * 0.6, -h * 0.9); c.lineTo(k * L * 0.3, -h * 0.45); } strokeIn(c, P.c3, 2); }
  else if (a.stem) { c.fillStyle = mix(P.c2, P.c3, 0.5); c.beginPath(); E(c, 0, -h * 0.7, L * 0.18, h * 0.16); c.fill(); c.fillStyle = P.c3; for (const k of [-1, 0, 1]) { c.beginPath(); E(c, k * L * 0.08, -h * 0.7, 1.8, 1.4); c.fill(); } }
}
function pTorn(c, a, P, rr, seed) {
  const p = blobPts(0, 0, rr, rr * 0.7, 7, 0.28, seed);
  const leafy = a.type === 'herb' || a.type === 'head' || a.type === 'leaf';
  const col = leafy ? ((seed & 1) ? P.c1 : (a.type === 'herb' ? P.c2 : P.c1)) : pieceCol(a, P);
  paint(c, (q) => smoothClosed(q, p), col, {
    dx: rr * 0.1, dy: rr * 0.15, lw: LW * 0.85,
    detail: tiny() ? null : (q) => {
      if (leafy) { q.beginPath(); q.moveTo(-rr * 0.6, rr * 0.2); q.quadraticCurveTo(0, -rr * 0.1, rr * 0.6, -rr * 0.15); strokeIn(q, a.type === 'herb' ? P.c3 : P.c2, 2); }
      else if (a.shape === 'loaf') { q.fillStyle = P.c1; q.fillRect(-rr * 1.5, -rr, rr * 3, rr * 0.45); }
    },
  });
}
function pCrushed(c, a, P, seed) {
  const p = blobPts(0, 0, 20, 9, 9, 0.2, seed);
  paint(c, (q) => smoothClosed(q, p), a.type === 'bulb' ? P.c2 : pieceCol(a, P), {
    dx: 2, dy: 3,
    detail: tiny() ? null : (q) => { q.beginPath(); q.moveTo(-12, -2); q.lineTo(-4, 2); q.lineTo(2, -3); q.lineTo(10, 2); strokeIn(q, shade(P.c2, -0.25), 1.6); },
  });
  if (!tiny()) { c.beginPath(); c.moveTo(14, -6); c.lineTo(24, -10); c.lineTo(20, -2); c.closePath(); fs(c, P.c1, LW * 0.6); }
}
// Heap of tiny bits (mince) or fluffy shreds (grated).
function heap(c, a, P, amount, seed, kind) {
  const r = rng(seed);
  const col = pieceCol(a, P), skin = pieceSkin(a, P);
  const W = 22 + amount * 2.4, H = 9 + amount * 1.1;
  if (kind === 'grated') {
    const parts = [(q) => { q.moveTo(-W, 0); q.quadraticCurveTo(0, -H * 0.9, W, 0); q.closePath(); }];
    const n = 5 + Math.round(amount / 3);
    for (let i = 0; i < n; i++) { const u = (i + 0.5) / n * 2 - 1, y = -H * (1 - u * u) * 0.75; parts.push((q) => E(q, u * W * 0.8, y, W * 0.22, H * 0.38)); }
    paintU(c, parts, col, {
      dx: 3, dy: 4,
      detail: tiny() ? null : (q) => {
        for (let i = 0; i < 10 + amount * 2; i++) {
          const x = (r() - 0.5) * W * 1.7, y = -r() * H * 1.1, an = r() * PI;
          q.beginPath(); q.moveTo(x, y); q.quadraticCurveTo(x + Math.cos(an) * 6, y - 4, x + Math.cos(an) * 10, y + Math.sin(an) * 3);
          strokeIn(q, i % 3 ? shade(col, -0.2) : shade(col, 0.35), 1.8);
        }
      },
    });
    if (!tiny()) for (let i = 0; i < 4; i++) { const x = (i % 2 ? 1 : -1) * (W + 4 + r() * 10), y = -2 - r() * 3; tube(c, [x - 5, y, x, y - 4, x + 6, y - 1], col, 2.6); }
    return;
  }
  // mince: bumpy heap made of tiny outlined bits
  const Hm = H * 1.35;
  const parts = [(q) => { q.moveTo(-W, 0); q.quadraticCurveTo(0, -Hm * 1.1, W, 0); q.closePath(); }];
  const nb = 4 + Math.round(amount / 4);
  for (let i = 0; i < nb; i++) { const u = (i + 0.5) / nb * 2 - 1, y = -Hm * (1 - u * u) * 0.62; parts.push((q) => E(q, u * W * 0.8, y, W * 0.2, Hm * 0.36)); }
  paintU(c, parts, col, {
    dx: 3, dy: 4,
    detail: (q) => {
      const n = tiny() ? 8 : 22 + amount * 3;
      q.lineWidth = Math.max(0.8, LW * 0.28); q.strokeStyle = rgba(OUTLINE, 0.55);
      for (let i = 0; i < n; i++) {
        const x = (r() - 0.5) * W * 1.9, y = -r() * Hm * 1.15;
        const v = r(), sz = 2.4 + r() * 1.6;
        q.fillStyle = skin && v < 0.22 ? skin : v < 0.5 ? shade(col, -0.14) : shade(col, 0.28);
        q.beginPath(); q.moveTo(x - sz, y); q.lineTo(x - sz * 0.2, y - sz); q.lineTo(x + sz, y - sz * 0.2); q.lineTo(x + sz * 0.3, y + sz * 0.9); q.closePath(); q.fill(); q.stroke();
      }
    },
  });
  if (!tiny()) {
    for (let i = 0; i < 5; i++) {
      const x = (i % 2 ? 1 : -1) * (W * 0.8 + r() * 12), y = -2 - r() * 2;
      c.beginPath(); c.moveTo(x - 2.5, y); c.lineTo(x, y - 3); c.lineTo(x + 3, y); c.lineTo(x, y + 2); c.closePath();
      fs(c, skin && i === 1 ? skin : col, LW * 0.45);
    }
  }
}

function sizeArt(a) {
  switch (a.type) {
    case 'round': {
      const { rx, ry } = roundDims(a);
      let w = 2 * rx + 6, h = 2 * ry + 4;
      if (a.tip && !a.segments) h += 22;
      if (a.stem || a.lobes) h += 14;
      if (a.segments) w += 18;
      return { w: Math.round(w), h: Math.round(h) };
    }
    case 'long': {
      if (a.knobby) return { w: 114, h: 60 };
      const g = tubeOf(a);
      if (a.bunch) return { w: Math.round(g.L + 36), h: Math.round(2 * g.T + 26) };
      return { w: Math.round(g.L + (a.rings ? 46 : a.hollow ? 22 : (a.taper || 0) < 0 ? 24 : 16)), h: Math.round(-g.top + (a.rings ? 22 : 6)) };
    }
    case 'bulb': return { w: 86, h: 96 };
    case 'egg': return { w: 62, h: 80 };
    case 'herb': return { w: 176, h: 82 };
    case 'leaf': return { w: 136, h: 72 };
    case 'head': return { w: 128, h: 114 };
    case 'mushroom': return { w: 92, h: 78 };
    case 'pile': return a.big ? { w: 150, h: 56 } : { w: 136, h: 50 };
    case 'block': { const s = BLOCK_SIZE[a.shape] || [104, 54]; return { w: s[0], h: s[1] }; }
    case 'bottle': return a.wine ? { w: 58, h: 186 } : { w: 62, h: 176 };
    case 'carton': return { w: 78, h: 142 };
    case 'jar': return { w: 74, h: 104 };
    case 'jug': return { w: 118, h: 132 };
    case 'can': return { w: 72, h: 106 };
    case 'shaker': return { w: 54, h: 108 };
    case 'sack': return { w: 100, h: 116 };
    case 'bundle': return { w: 184, h: 36 };
    case 'dough': return { w: 116, h: 76 };
    case 'tea': return { w: 76, h: 106 };
    default: return { w: 100, h: 100 };
  }
}
function profileAt(a, x) {
  const S = sizeArt(a);
  switch (a.type) {
    case 'round': { const { rx, ry } = roundDims(a); return { cy: -ry, hh: ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) }; }
    case 'long': if (!a.knobby) return tubeAt(tubeOf(a), x); break;
    case 'bulb': return { cy: -37, hh: 37 * Math.sqrt(Math.max(0, 1 - (x / 40) ** 2)) };
    case 'egg': return { cy: -EH * 0.45, hh: EH * 0.45 * Math.sqrt(Math.max(0, 1 - (x / EW) ** 2)) };
    case 'head': return { cy: -55, hh: 55 * Math.sqrt(Math.max(0, 1 - (x / 62) ** 2)) };
    case 'mushroom': return { cy: -50, hh: 26 * Math.sqrt(Math.max(0, 1 - (x / 43) ** 2)) };
    case 'block': {
      const u = Math.min(1, Math.abs(x) / (S.w / 2));
      const hh = (S.h / 2) * Math.pow(Math.max(0, 1 - u ** 4), 0.25) * 0.86;
      return { cy: -S.h * 0.45, hh };
    }
    default: break;
  }
  const u = Math.min(1, Math.abs(x) / (S.w / 2));
  return { cy: -S.h / 2, hh: (S.h / 2) * Math.sqrt(Math.max(0, 1 - u * u)) * 0.9 };
}

// Builds the list of pieces for a cut, then lays them out (centred, or with
// their left edge at x=0 when `left`).
function piecesLocal(c, a, P, cut, count, seed, left, extra, measure) {
  cut = normCut(cut);
  const lod = tiny();
  if (lod && (cut === 'dice' || cut === 'chunks' || cut === 'strips' || cut === 'torn' || cut === 'slices' || cut === 'rings')) count = Math.max(1, Math.ceil(count * 0.55));
  const r = rng(seed * 7 + 3);
  const S = sizeArt(a);
  const list = [];
  const add = (x, y, w, z, fn, rot = 0, sc = 1) => list.push({ x, y, w, z, fn, rot, sc });
  const t = a.type;
  const isProduce = t === 'round' || t === 'long' || t === 'bulb' || t === 'egg' || t === 'mushroom' || t === 'head' || t === 'leaf' || t === 'herb';
  if (t === 'pile') { if (measure) return 140 * clamp(0.5 + count * 0.05, 0.5, 1.6); sub(c, 0, 0, 1, () => drawPile(c, a, P, {}, 0, seed, clamp(0.5 + count * 0.05, 0.5, 1.6))); return; }
  if (!isProduce && t !== 'block' && t !== 'dough') {
    if (t === 'bundle') { for (let i = 0; i < Math.min(count, 3); i++) add(0, -i * 14, 120, i, () => drawBundle(c, a, P, {}, 0, seed, true), (r() - 0.5) * 0.2); }
    else add(0, 0, S.w, 0, () => drawWholeArt(c, a, P, {}, 0, seed));
  } else if (t === 'dough') {
    const n = cut === 'halves' ? 2 : clamp(Math.round(count / 2), 2, 6);
    for (let i = 0; i < n; i++) add((i - (n - 1) / 2) * 50 + (i % 2) * 6, -((i % 2) * 14), 56, i % 2 ? 0 : 1, () => sub(c, 0, 0, 0.5, () => drawDough(c, '', a, P, { shape: 'ball' }, 0, seed + i)));
  } else if (t === 'egg' && (cut === 'cracked' || cut === 'beaten')) {
    const n = clamp(count, 1, 3);
    for (let i = 0; i < n; i++) add(i * 70 - (n - 1) * 35, 0, 100, i, () => drawFriedEgg(c, P, P.ck, seed + i, cut === 'beaten'));
  } else if (t === 'head' && cut === 'leaves') {
    const n = clamp(count, 1, 8);
    for (let i = 0; i < n; i++) add((r() - 0.5) * 10, -12 - i * 5, 130, i, () => bigLeaf(c, 0, -18, 60, 26, (r() - 0.5) * 0.3, i % 2 ? P.c1 : shade(P.c1, 0.08), P.c3, seed + i));
  } else if (t === 'leaf' && cut === 'rolls') {
    add(0, 0, 160, 0, () => drawLeafStack(c, a, P, { cut: 'rolls', k: count, n: count }, 0, seed));
  } else if (cut === 'slices' || (cut === 'rings' && !(a.hollow || a.thin || (a.tip && !a.segments)))) {
    const n = clamp(count, 1, 14);
    if (t === 'herb') {
      const lw = Math.max(LW * 0.4, 1);
      for (let i = 0; i < n * 3; i++) add((r() - 0.5) * 60, -3 - r() * 6, 12, r(), () => { c.beginPath(); E(c, 0, 0, 5, 3.6); c.fillStyle = i % 2 ? P.c1 : P.c2; c.fill(); c.lineWidth = lw; c.strokeStyle = OUTLINE; c.stroke(); c.beginPath(); E(c, 0, 0, 2.2, 1.5); c.fillStyle = mix(P.c1, '#ffffff', 0.55); c.fill(); });
    } else if (t === 'head' || t === 'leaf') {
      return piecesLocal(c, a, P, 'strips', count * 2, seed, left, extra, measure);
    } else if (t === 'block' && a.shape !== 'log' && a.shape !== 'sausage' && a.shape !== 'ball') {
      const w = a.shape === 'loaf' ? 62 : clamp(S.h * 0.85, 36, 56), h = a.shape === 'loaf' ? 58 : clamp(S.h * 0.75, 30, 48);
      const step = w * 0.36;
      for (let i = 0; i < n; i++) add(i * step, -h / 2 - 2, w, i, () => slab(c, a, P, w, h, seed + i), 0.18 + (r() - 0.5) * 0.06);
    } else if (t === 'bulb') {
      for (let i = 0; i < n * 2; i++) add((i % 6) * 13 + (r() - 0.5) * 4, -6 - Math.floor(i / 6) * 9, 14, i, () => { c.beginPath(); E(c, 0, 0, 7, 5.5); fs(c, P.c2, LW * 0.7); c.beginPath(); c.moveTo(-3, 0); c.lineTo(3, 0); strokeIn(c, shade(P.c3, 0.3), 1.4); });
    } else {
      let fr, rx0;
      if (t === 'round') { const d = roundDims(a); rx0 = d.rx * 0.82; fr = d.ry / d.rx; }
      else if (t === 'long') { rx0 = tubeOf(a).T * 0.98; fr = 0.95; }
      else if (t === 'egg') { rx0 = 25; fr = 0.85; }
      else if (t === 'mushroom') { rx0 = 30; fr = 0.6; }
      else if (t === 'block') { rx0 = a.shape === 'log' ? 23 : a.shape === 'ball' ? 30 : 12; fr = 0.95; }
      else { rx0 = Math.min(S.w, S.h) * 0.4; fr = 0.9; }
      const g = t === 'long' ? tubeOf(a) : null;
      const rows = n > 8 ? 2 : 1, per = Math.ceil(n / rows);
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / per), col = i % per;
        let rr = rx0;
        if (g) { const idx = Math.round((1 - (i + 0.5) / n) * g.N * 0.9); rr = Math.max(g.r[idx] * 0.98, 5); }
        const ry = rr * fr * (t === 'mushroom' ? 1 : 0.92);
        add(col * rr * 0.62 + row * rr * 0.4, -ry - 3 - row * rr * 0.55, rr * 2, -row * 100 + col, () => pSlice(c, a, P, rr, ry, seed + i), 0.12 * ((i % 3) - 1) + 0.08);
      }
    }
  } else if (cut === 'rings') {
    const n = clamp(count, 1, 12);
    let rx0;
    if (t === 'round') rx0 = roundDims(a).rx * 0.8; else rx0 = tubeOf(a).T * 0.95;
    const papery = a.tip && !a.segments;
    let xx = 0;
    for (let i = 0; i < n; i++) {
      const k = papery ? [1, 0.78, 0.6][i % 3] : 1;
      const rr = rx0 * k;
      const x = xx + rr, y = -rr * 0.6 - (i % 2) * rx0 * 0.28 - 2;
      xx += rr * (papery ? 0.95 : 0.9);
      add(x, y, rr * 2, (i % 2) * -100 + i, () => pRing(c, a, P, rr, rr * 0.6, seed + i, i), (r() - 0.5) * 0.25);
    }
  } else if (cut === 'halves') {
    const n = clamp(count, 1, 6);
    const w = t === 'long' ? S.w * 0.9 : t === 'egg' ? 58 : t === 'mushroom' ? 70 : Math.min(S.w, 120) * 0.95;
    for (let i = 0; i < n; i++) {
      if (t === 'mushroom') add(i * 48, -24, 60, i, () => mushSlice(c, P, 60), (i % 2 ? 0.1 : -0.1));
      else if (t === 'long') add((i % 2) * 14, -(i % 2) * S.h * 0.55 - Math.floor(i / 2) * 20, w, -i, () => pHalf(c, a, P, seed + i, w));
      else add(i * w * 0.92, 0, w, -i, () => pHalf(c, a, P, seed + i, w), i % 2 ? 0.08 : -0.05);
    }
  } else if (cut === 'wedges') {
    const n = clamp(count, 1, 10);
    if (t === 'round' || t === 'egg' || t === 'bulb') {
      const L = t === 'egg' ? 56 : roundDims(a).rx * 1.55;
      for (let i = 0; i < n; i++) {
        const row = i % 2;
        add(Math.floor(i / 2) * L * 0.55 + row * L * 0.25, -L * 0.17 - row * L * 0.18, L, -row * 10 + i, () => pWedge(c, a, P, L, seed + i), (row ? 0.15 : -0.1) + (r() - 0.5) * 0.15);
      }
    } else return piecesLocal(c, a, P, t === 'long' ? 'strips' : 'chunks', count, seed, left, extra, measure);
  } else if (cut === 'strips') {
    const n = clamp(count, 2, 24);
    let len = clamp(S.w * 0.55, 46, 96), w = 9, fill = pieceCol(a, P), edge = null, curve = 0;
    if (t === 'round' && a.spots) { w = 12; len = 78; }
    if (a.hollow) { curve = 1; }
    if (t === 'long' && a.seeds) edge = P.c1;
    if (t === 'head' || t === 'leaf' || t === 'herb') curve = 2;
    if (t === 'round' && a.tip && !a.segments) curve = 3;
    if (t === 'block' && MEATY[a.shape]) { w = 12; len = 70; edge = P.c1; }
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / 6), x = (r() - 0.5) * len * 0.5 + (i % 6 - 2.5) * 8, y = -w * 0.6 - layer * w * 0.7 - r() * 3;
      const rot = (r() - 0.5) * 0.5 + (i % 2 ? 0.12 : -0.12);
      if (curve === 1) add(x, y, len, i, () => { c.beginPath(); c.arc(0, len * 0.6, len * 0.65, -PI / 2 - 0.6, -PI / 2 + 0.6); c.strokeStyle = OUTLINE; c.lineWidth = 10 + LW * 1.6; c.stroke(); c.strokeStyle = fill; c.lineWidth = 10; c.stroke(); c.strokeStyle = mix(P.c2, '#ffffff', 0.3); c.lineWidth = 3; c.beginPath(); c.arc(0, len * 0.6, len * 0.65 - 3, -PI / 2 - 0.5, -PI / 2 + 0.5); c.stroke(); }, rot);
      else if (curve >= 2) add(x, y, len, i, () => { const L2 = len * 0.8; const cc = curve === 3 ? P.c2 : (i % 2 ? P.c1 : (t === 'herb' ? P.c2 : mix(P.c1, P.c2, 0.4))); c.beginPath(); c.moveTo(-L2 / 2, 0); c.bezierCurveTo(-L2 / 6, -8, L2 / 6, 8, L2 / 2, 0); c.strokeStyle = OUTLINE; c.lineWidth = 6 + LW * 1.6; c.stroke(); c.strokeStyle = cc; c.lineWidth = 6; c.stroke(); }, rot);
      else add(x, y, len, i, () => stick(c, len, w, fill, edge), rot);
    }
  } else if (cut === 'dice' || cut === 'chunks') {
    const big = cut === 'chunks';
    const amount = clamp(count, 1, 24);
    const n = big ? clamp(Math.round(amount * 0.5) + 3, 3, 12) : clamp(Math.round(4 + amount * 1.4), 3, 34);
    const d = (big ? clamp(Math.min(S.w, S.h) * 0.3, 18, 26) : clamp(Math.min(S.w, S.h) * 0.16, 9, 14)) * (lod ? 1.3 : 1);
    const col = pieceCol(a, P), skin = pieceSkin(a, P);
    const egg = t === 'egg';
    const meat = t === 'block' && (MEATY[a.shape] || a.shape === 'fillet');
    const rows = [];
    let left2 = n, w0 = Math.max(2, Math.ceil(Math.sqrt(n * 2.2)));
    while (left2 > 0) { const k = Math.min(left2, w0); rows.push(k); left2 -= k; w0 = Math.max(1, w0 - 1); }
    rows.forEach((k, ri) => {
      for (let j = 0; j < k; j++) {
        const x = (j - (k - 1) / 2) * d * 1.18 + (r() - 0.5) * d * 0.3, y = -d / 2 - 1 - ri * d * 0.78 + (r() - 0.5) * 2;
        const v = r();
        let front = col, top = shade(col, 0.22), side = shade(col, -0.16);
        if (egg && v < 0.35) { front = P.c3; top = shade(P.c3, 0.2); side = shade(P.c3, -0.15); }
        else if (meat) { top = P.c1; side = shade(P.c1, -0.15); }
        else if (skin && v < 0.4) { top = skin; }
        add(x, y, d * 1.4, -ri * 100 - j, () => cube(c, d, front, top, side, big ? d * 0.3 : d * 0.16), (r() - 0.5) * (big ? 0.35 : 0.25));
      }
    });
    for (const it of list) it.z = -it.y * 10 + it.x * 0.01;
  } else if (cut === 'mince' || cut === 'grated') {
    add(0, 0, 0, 0, () => heap(c, a, P, clamp(count, 1, 20), seed, cut));
    list[0].w = 2 * (22 + clamp(count, 1, 20) * 2.4) + 20;
  } else if (cut === 'torn') {
    const n = clamp(count, 1, 12);
    const rr = t === 'herb' ? 13 : t === 'block' ? 16 : 20;
    for (let i = 0; i < n; i++) add((r() - 0.5) * rr * Math.sqrt(n) * 2.2, -rr * 0.6 - r() * rr * 0.8, rr * 2, r(), () => pTorn(c, a, P, rr, seed + i * 13), (r() - 0.5) * 1.5);
  } else if (cut === 'crushed') {
    const n = clamp(count, 1, 6);
    for (let i = 0; i < n; i++) add(i * 36 + (r() - 0.5) * 6, -8 - (i % 2) * 6, 48, i % 2 ? 0 : 1, () => pCrushed(c, a, P, seed + i), (r() - 0.5) * 0.4);
  } else if (cut === 'slit') {
    add(0, 0, S.w, 0, () => drawSlit(c, a, P, extra || {}, 0, seed, 1));
  } else if (cut === 'peeled' || cut === 'whole') {
    add(0, 0, S.w, 0, () => drawWholeArt(c, a, P, { peeled: cut === 'peeled' ? 1 : 0 }, 0, seed));
  } else {
    return piecesLocal(c, a, P, 'dice', count, seed, left, extra, measure);
  }
  if (!list.length) return 0;
  let mn = 1e9, mx = -1e9;
  for (const it of list) { mn = Math.min(mn, it.x - it.w / 2); mx = Math.max(mx, it.x + it.w / 2); }
  if (measure) return mx - mn;
  const off = left ? -mn : -(mn + mx) / 2;
  list.sort((p, q) => p.z - q.z);
  for (const it of list) sub(c, it.x + off, it.y, it.sc, it.fn, it.rot);
}
function defaultCount(a, cut, st) {
  cut = normCut(cut);
  const n = num(st.n, 0), q = clamp(num(st.qty, 1), 1, 6);
  const sq = Math.sqrt(q);
  switch (cut) {
    case 'slices': return clamp(n ? n + 1 : (a.type === 'long' ? 8 : 6), 2, 12);
    case 'rings': return clamp(n ? n + 1 : 6, 2, 10);
    case 'halves': return clamp(2 * Math.min(q, 3), 2, 6);
    case 'wedges': return clamp(n ? n : (a.segments ? 4 : 6), 2, 8);
    case 'strips': return clamp(n ? n * 2 : 10, 4, 22);
    case 'crushed': return clamp(q * (a.type === 'bulb' ? 3 : 1), 1, 6);
    case 'torn': return clamp(Math.round(6 * sq), 3, 12);
    case 'chunks': return clamp(Math.round(8 * sq), 4, 20);
    case 'leaves': return clamp(n || 4, 1, 8);
    case 'rolls': return clamp(num(st.k, q), 1, 12);
    case 'cracked': case 'beaten': return clamp(q, 1, 3);
    default: return clamp(Math.round(12 * sq), 4, 20);
  }
}

// ================================================================ whole / slit / cut-progress
function drawWholeArt(c, a, P, st, t, seed) {
  switch (a.type) {
    case 'round': return drawRound(c, a, P, st, t, seed);
    case 'long': return a.knobby ? drawGinger(c, a, P, st, t, seed) : a.bunch ? drawBeans(c, a, P, st, t, seed) : drawLong(c, a, P, st, t, seed);
    case 'bulb': return drawBulb(c, a, P, st, t, seed);
    case 'egg': return drawEgg(c, a, P, st, t, seed);
    case 'herb': return drawHerb(c, a, P, st, t, seed);
    case 'leaf': return drawLeafStack(c, a, P, st, t, seed);
    case 'head': return drawHead(c, a, P, st, t, seed);
    case 'mushroom': return drawMushroom(c, a, P, st, t, seed);
    case 'pile': return drawPile(c, a, P, Object.assign({}, st, { qty: 1 }), t, seed);
    case 'block': return drawBlock(c, a, P, st, t, seed);
    case 'bottle': return drawBottle(c, a, P, st, t, seed);
    case 'carton': return drawCarton(c, a, P, st, t, seed);
    case 'jar': return drawJar(c, a, P, st, t, seed);
    case 'jug': return drawJug(c, a, P, st, t, seed);
    case 'can': return drawCan(c, a, P, st, t, seed);
    case 'shaker': return drawShaker(c, a, P, st, t, seed);
    case 'sack': return drawSack(c, a, P, st, t, seed);
    case 'bundle': return drawBundle(c, a, P, st, t, seed);
    case 'tea': return drawTeaTin(c, a, P, st, t, seed);
    case 'dough': return drawDough(c, '', a, P, st, t, seed);
    default: return drawRound(c, FALLBACK_ART, P, st, t, seed);
  }
}
// Whole item with a long slit opened along its top (stuffing). `open` 0..1.
function drawSlit(c, a, P, st, t, seed, open) {
  drawWholeArt(c, a, P, Object.assign({}, st, { cut: null }), t, seed);
  if (open <= 0.01) return;
  let pts;
  if (a.type === 'long' && !a.knobby) {
    const g = tubeOf(a);
    const i0 = Math.round(g.N * 0.16), i1 = Math.round(g.N * 0.9);
    const up = [], dn = [];
    for (let i = i0; i <= i1; i++) {
      const u = (i - i0) / (i1 - i0), w = Math.sin(PI * u) * g.r[i] * 0.42 * open + 0.6;
      const cy = g.y[i] - g.r[i] * 0.3;
      up.push(g.x[i], cy - w); dn.unshift(g.x[i], cy + w * 0.8);
    }
    pts = [up, dn];
  } else {
    const S = sizeArt(a), w = S.w * 0.36, cy = -S.h * 0.62, up = [], dn = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8, x = lerp(-w, w, u), ww = Math.sin(PI * u) * S.h * 0.12 * open + 0.5; up.push(x, cy - ww); dn.unshift(x, cy + ww * 0.8); }
    pts = [up, dn];
  }
  const path = (q) => { smoothOpen(q, pts[0], true); smoothOpen(q, pts[1], false); q.closePath(); };
  const filled = st.filling || st.filled;
  const fillCol = typeof st.filling === 'string' ? st.filling : '#c8452e';
  paint(c, path, filled ? fillCol : P.c2, {
    detail: (q) => {
      if (filled) {
        if (tiny()) return;
        const r = rng(seed + 9);
        let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
        for (let i = 0; i < pts[0].length; i += 2) { mnx = Math.min(mnx, pts[0][i]); mxx = Math.max(mxx, pts[0][i]); mny = Math.min(mny, pts[0][i + 1]); }
        for (let i = 1; i < pts[1].length; i += 2) mxy = Math.max(mxy, pts[1][i]);
        for (let i = 0; i < 16; i++) { const x = lerp(mnx, mxx, r()), y = lerp(mny, mxy, r()); q.fillStyle = i % 3 ? shade(fillCol, -0.25) : '#5aa83c'; q.beginPath(); E(q, x, y, 2.6, 2); q.fill(); }
        q.fillStyle = HL; q.beginPath(); E(q, (mnx + mxx) / 2 - 10, mny + 3, (mxx - mnx) * 0.25, 2.5); q.fill();
      } else {
        q.beginPath(); smoothOpen(q, pts[0], true); strokeIn(q, shade(P.c2, -0.35), 6);
        if (a.seeds && !tiny()) { q.fillStyle = shade(P.c2, -0.4); for (let i = 0; i < pts[0].length; i += 4) { q.beginPath(); E(q, pts[0][i], (pts[0][i + 1] + pts[1][pts[1].length - 1 - i]) / 2 + 2, 1.8, 1.3); q.fill(); } }
      }
    },
  });
}
function drawCutProgress(c, kind, a, P, st, t, seed) {
  const cut = normCut(st.cut);
  const n = num(st.n, 0), k = num(st.k, n);
  const done = !(n > 0 && k < n);
  const S = sizeArt(a);
  if (a.type === 'pile' || (!['round', 'long', 'bulb', 'egg', 'mushroom', 'head', 'leaf', 'herb', 'block', 'dough'].includes(a.type))) {
    if (a.type === 'pile' || a.type === 'bundle' || a.type === 'dough') return piecesLocal(c, a, P, cut, defaultCount(a, cut, st), seed, false, st);
    return drawWholeArt(c, a, P, st, t, seed);
  }
  if (cut === 'slit') return drawSlit(c, a, P, st, t, seed, done ? 1 : clamp(k / n, 0, 1));
  if (cut === 'rolls' && a.type === 'leaf') return drawLeafStack(c, a, P, st, t, seed);
  if (cut === 'cracked' || cut === 'beaten') return piecesLocal(c, a, P, cut, defaultCount(a, cut, st), seed, false, st);
  if (cut === 'leaves' && a.type === 'head') {
    if (done) return piecesLocal(c, a, P, 'leaves', defaultCount(a, cut, st), seed, false, st);
    const f = 1 - 0.4 * (k / n);
    sub(c, -S.w * 0.28, 0, f, () => drawHead(c, a, P, st, t, seed));
    if (k > 0) sub(c, S.w * 0.42, 0, 0.85, () => piecesLocal(c, a, P, 'leaves', k, seed, false));
    return;
  }
  if (done) return piecesLocal(c, a, P, cut, defaultCount(a, cut, st), seed, false, st);
  const frac = clamp(k / n, 0, 1);
  const whole = Object.assign({}, st, { cut: null, qty: 1 });
  if (cut === 'halves' || frac <= 0) {
    drawWholeArt(c, a, P, whole, t, seed);
    if (!tiny()) {
      c.save(); c.setLineDash([6, 6]); c.beginPath(); c.moveTo(0, -S.h - 6); c.lineTo(0, 4);
      c.strokeStyle = 'rgba(61,42,36,0.45)'; c.lineWidth = 2.4; c.stroke(); c.restore();
    }
    return;
  }
  const amt = (cnt) => Math.max(1, Math.round(cnt * frac));
  if (cut === 'grated' || cut === 'torn' || cut === 'crushed' || a.type === 'herb' || a.type === 'leaf') {
    const f = Math.sqrt(1 - frac * 0.7);
    const cnt = amt(defaultCount(a, cut, st));
    const pw = piecesLocal(c, a, P, cut, cnt, seed, true, null, true) || 0;
    const x0 = -(S.w * f + 8 + pw) / 2;
    sub(c, x0 + S.w * f / 2, 0, f, () => drawWholeArt(c, a, P, whole, t, seed));
    sub(c, x0 + S.w * f + 8, 0, 1, () => piecesLocal(c, a, P, cut, cnt, seed, true));
    return;
  }
  // knife cuts: the remaining part shrinks from the right, pieces pile up next to it
  const f = clamp(1 - frac, 0.12, 1);
  const xl = -S.w / 2, xc = xl + S.w * f;
  const pr = profileAt(a, xc);
  const fr = clamp(pr.hh * 0.34, 4, 20);
  const cnt = cut === 'slices' || cut === 'rings' ? Math.min(12, Math.max(1, k)) : amt(defaultCount(a, cut, st));
  const pw = piecesLocal(c, a, P, cut, cnt, seed, true, null, true) || 0;
  const shift = -(S.w * f + fr + 10 + pw) / 2 - xl;
  c.save();
  c.translate(shift, 0);
  c.save();
  c.beginPath(); c.rect(xl - 80, -S.h - 80, xc - xl + 80, S.h + 160); c.clip();
  drawWholeArt(c, a, P, whole, t, seed);
  c.restore();
  if (pr.hh > 2) sub(c, xc, pr.cy, 1, () => xsec(c, a, P, fr, pr.hh * 0.98, seed));
  sub(c, xc + fr + 10, 0, 1, () => piecesLocal(c, a, P, cut, cnt, seed, true));
  c.restore();
}

// ================================================================ toppings (pizza, flatbreads)
function drawTopping(c, kind, x, y, ts, ck, seed) {
  const a = artOf(kind);
  const P = pal(a, { cook: ck * 0.7 });
  sub(c, x, y, ts, () => {
    if (kind === 'olive' || kind === 'olives' || kind === 'blackOlive') {
      c.beginPath(); E(c, 0, 0, 9, 6.5); E(c, 0, 0, 3.5, 2.5); c.fillStyle = '#2e2a30'; c.fill('evenodd'); c.lineWidth = LW * 0.7; c.strokeStyle = OUTLINE; c.stroke();
      return;
    }
    switch (a.type) {
      case 'block': {
        const sh = a.shape;
        if (sh === 'ball' || sh === 'wedge' || sh === 'brick') {
          const melt = clamp(ck * 1.3, 0, 1);
          const p = blobPts(0, 0, 13 + melt * 5, 9 + melt * 2, 8, 0.2 + melt * 0.1, seed);
          paint(c, (q) => smoothClosed(q, p), sh === 'ball' ? P.c1 : P.c2, {
            dx: 0, dy: 2, lw: LW * 0.8,
            hl: [-4, -3, 5, 2.5],
            detail: melt > 0.3 ? (q) => { q.fillStyle = rgba('#d8902a', melt * 0.55); for (let i = 0; i < 3; i++) { q.beginPath(); E(q, (i - 1) * 6, (i % 2) * 3, 3, 2); q.fill(); } } : null,
          });
        } else if (sh === 'log' || sh === 'sausage') {
          c.beginPath(); E(c, 1.5, 2, sh === 'log' ? 13 : 9, sh === 'log' ? 9 : 6.5); fs(c, shade(P.c1, -0.15), LW * 0.7);
          xsecBlock(c, a, P, sh === 'log' ? 13 : 9, sh === 'log' ? 9 : 6.5, sh, seed);
        } else if (sh === 'mince') {
          for (let i = 0; i < 3; i++) { const p = blobPts((i - 1) * 7, (i % 2) * 4 - 2, 5, 4, 6, 0.3, seed + i); c.beginPath(); smoothClosed(c, p); fs(c, P.c1, LW * 0.6); }
        } else if (sh === 'shrimp') {
          sub(c, 0, 10, 0.32, () => drawShrimp(c, P, seed, false));
        } else {
          sub(c, 0, 4, 0.5, () => cube(c, 16, P.c2, P.c1, shade(P.c1, -0.15)));
        }
        return;
      }
      case 'herb':
        leaf(c, -8, 2, 18, 7, -0.4 + ((seed % 5) - 2) * 0.3, a.leaf === 'curly' ? P.c1 : P.c1, shade(P.c3, 0.1), a.leaf === 'serrated');
        return;
      case 'round':
        if (a.hollow) { ringFace(c, P, 11, 8, seed, true); return; }
        if (a.tip && !a.segments) { pRing(c, a, P, 12, 8, seed, seed); return; }
        xsec(c, a, P, 13, 9.5, seed);
        return;
      case 'long':
        if (a.hollow || a.thin) { pRing(c, a, P, a.thin ? 6.5 : 10, a.thin ? 5 : 7, seed, seed); return; }
        xsec(c, a, P, 10, 7.5, seed);
        return;
      case 'mushroom': mushSlice(c, P, 24); return;
      case 'egg': sub(c, 0, 8, 0.42, () => drawFriedEgg(c, P, Math.max(ck, 0.6), seed, false)); return;
      case 'pile': for (let i = 0; i < 3; i++) grainAt(c, a.grain, (i - 1) * 6, (i % 2) * 3, 4.5, P, rng(seed + i), 0); return;
      case 'bulb': c.beginPath(); E(c, 0, 0, 6, 4.5); fs(c, P.c2, LW * 0.6); return;
      default:
        sub(c, 0, 4, 0.35, () => piecesLocal(c, a, P, 'dice', 2, seed, false));
    }
  });
}

// ================================================================ public: ingredients
export function drawIngredient(ctx, kind, st, x, y, s = 1, t = 0) {
  if (!ctx) return;
  st = st && typeof st === 'object' ? st : {};
  const prev = enter(ctx, x, y, s);
  try {
    ingLocal(ctx, kind, st, num(t));
  } catch (e) { oops('drawIngredient ' + String(kind && kind.type || kind), e); } finally {
    leave(ctx, prev);
  }
}
function ingLocal(c, kind, st, t) {
  const a = artOf(kind);
  const P = pal(a, st);
  P.boiled = !!st.boiled;
  const seed = (hash(typeof kind === 'string' ? kind : a.type + a.c1) + (num(st.seed) | 0)) >>> 0;
  const cut = st.cut ? normCut(st.cut) : null;
  if (a.type === 'dough') {
    const q = clamp(num(st.qty, 1) | 0, 1, 8);
    if (cut && cut !== 'whole') piecesLocal(c, a, P, cut, defaultCount(a, cut, st), seed, false, st);
    else if (q > 1 && st.shape !== 'flat') { const one = Object.assign({}, st, { qty: 1 }); for (const p of clusterPos(q, sizeArt(a))) sub(c, p[0], p[1], p[2], () => drawDough(c, kind, a, P, one, t, seed + p[3])); }
    else drawDough(c, kind, a, P, st, t, seed);
    if (st.washed) { const S = sizeArt(a); wetFx(c, S.w, S.h, t, seed); }
    return;
  }
  if (a.type === 'egg' && (cut === 'cracked' || cut === 'beaten' || st.cracked)) {
    piecesLocal(c, a, P, cut === 'beaten' ? 'beaten' : 'cracked', defaultCount(a, 'cracked', st), seed, false, st);
    return;
  }
  if (cut && cut !== 'whole') {
    drawCutProgress(c, kind, a, P, st, t, seed);
    return;
  }
  const S = sizeArt(a);
  const q = clamp((num(st.qty, 1) + num(st.extra, 0)) | 0, 1, 8); // (a bunch: what the recipe takes and the rest)
  if (q > 1 && a.type === 'block' && a.shape === 'mince') {
    sub(c, 0, 0, Math.min(1.7, Math.pow(q, 0.35)), () => drawWholeArt(c, a, P, st, t, seed));
    if (st.washed) wetFx(c, S.w, S.h, t, seed);
    return;
  }
  if (q > 1 && a.type !== 'pile' && a.type !== 'leaf') {
    const one = Object.assign({}, st, { qty: 1, extra: 0 });
    const pos = clusterPos(q, S);
    for (const p of pos) sub(c, p[0], p[1], p[2], () => drawWholeArt(c, a, P, one, t, seed + p[3]));
    if (st.washed) wetFx(c, S.w * 1.4, S.h * 1.1, t, seed);
    return;
  }
  drawWholeArt(c, a, P, st, t, seed);
  if (st.washed) wetFx(c, S.w, S.h, t, seed);
}
function clusterPos(q, S) {
  const long = S.w > S.h * 1.6;
  const out = [];
  if (long) {
    const sc = q > 3 ? 0.8 : 0.9;
    for (let i = q - 1; i >= 0; i--) out.push([(i % 2 ? 0.08 : -0.06) * S.w, -i * S.h * 0.42 * sc, sc, i * 17]);
    return out;
  }
  const rows = q <= 3 ? [q - (q > 1 ? 1 : 0), q > 1 ? 1 : 0] : q <= 6 ? [Math.ceil(q / 2), Math.floor(q / 2)] : [3, 3, q - 6];
  if (q === 2) { rows[0] = 1; rows[1] = 1; }
  const sc = q <= 2 ? 0.88 : q <= 4 ? 0.8 : q <= 6 ? 0.72 : 0.66;
  const nr = rows.filter((v) => v > 0).length;
  let id = 0;
  rows.forEach((k, ri) => {
    if (!k) return;
    const ry = -(nr - 1 - ri) * S.h * 0.26 * sc;
    for (let j = 0; j < k; j++) {
      let x = (j - (k - 1) / 2) * S.w * 0.62 * sc;
      if (q === 2) x = (ri ? 0.28 : -0.28) * S.w;
      out.push([x + (ri % 2) * S.w * 0.05, ry, sc, id++ * 31]);
    }
  });
  return out;
}

export function drawPieces(ctx, kind, cut, count, x, y, s = 1, seed = 1) {
  if (!ctx) return;
  const prev = enter(ctx, x, y, s);
  try {
    const a = artOf(kind);
    const P = pal(a, {});
    piecesLocal(ctx, a, P, cut || 'dice', clamp(Math.round(num(count, 6)), 1, 40), ((num(seed, 1) | 0) + hash(String(kind))) >>> 0, false);
  } catch (e) { oops('drawPieces ' + kind, e); } finally {
    leave(ctx, prev);
  }
}

export function itemSize(kind) {
  if (typeof kind === 'string' && VESSELS[kind] && !INGREDIENTS[kind]) return vesselSize(VESSELS[kind].art);
  const a = artOf(kind);
  if (VESSEL_TYPES[a.type]) return vesselSize(a);
  const S = sizeArt(a);
  return { w: S.w, h: S.h };
}

const LIQ = {
  water: '#9fd6f2', passata: '#c8321e', milk: '#f6f4ee', cream: '#fbf3e0', broth: '#e2b45c', tea: '#b5481a',
  oil: '#f4d43c', oliveOil: '#c9c43a', redWine: '#7a1a2e', whiteWine: '#efe2a0', vinegar: '#b8642e',
  espresso: '#3a1e12', coffee: '#4a2a1a', tomatoPaste: '#b8281a', yogurt: '#fbfaf4', ghee: '#f4cf5a',
  butter: '#f6d860', bakedBeans: '#d0602a', mascarpone: '#fffaf0',
};
export function liquidColor(kind) {
  if (typeof kind === 'string' && LIQ[kind]) return LIQ[kind];
  const a = artOf(kind);
  return (a && a.c1) || '#9fd6f2';
}

// ================================================================ vessels
const VESSEL_TYPES = { pot: 1, saucepan: 1, pan: 1, bowl: 1, tray: 1, dish: 1, peel: 1, caydanlik: 1, cezve: 1, kettle: 1, colander: 1, blender: 1, plate: 1, glass: 1, cup: 1, skewer: 1 };

// Geometry of each vessel type at s=1, origin = bottom centre.
//   mx,my = mouth centre; rx,ry = mouth radii (inner); depth = mouth → floor;
//   taper = floor radius / mouth radius; w,h = bounding box; top = highest y.
function vgeo(a) {
  switch (a.type) {
    case 'pot': {
      const rx = a.big ? 110 : 92, H = a.big ? 124 : 104, ry = rx * 0.36;
      return { mx: 0, my: -H, rx: rx - 5, ry: ry - 4, orx: rx, ory: ry, H, depth: Math.min(H - ry * 0.9, ry * 1.6), taper: 1, w: 2 * rx + 50, h: H + ry + 4, top: -H - ry - 4, fit: 0.55 };
    }
    case 'saucepan': {
      const rx = 72, H = 78, ry = rx * 0.36;
      return { mx: 0, my: -H, rx: rx - 5, ry: ry - 4, orx: rx, ory: ry, H, depth: Math.min(H - ry * 0.9, ry * 1.6), taper: 1, w: 2 * rx + 130, h: H + ry + 18, top: -H - ry - 18, fit: 0.5 };
    }
    case 'pan': {
      const wide = !!a.wide, rx = wide ? 128 : 100, ry = rx * 0.4, H = wide ? 26 : 32;
      return { mx: 0, my: -H - ry * 0.5, rx: rx - 6, ry: ry - 4, orx: rx, ory: ry, H, depth: H * 0.75, taper: 0.86, w: wide ? 2 * rx + 50 : 2 * rx + 130, h: H + ry * 1.5 + 18, top: -H - ry * 1.5 - 18, fit: 0.7 };
    }
    case 'bowl': case 'colander': {
      const rx = 88, ry = 32, H = 74;
      return { mx: 0, my: -H, rx: rx - 5, ry: ry - 4, orx: rx, ory: ry, H, depth: Math.min(H - 18, ry * 1.5), taper: 0.6, w: 2 * rx + (a.type === 'colander' ? 36 : 6), h: H + ry + 4, top: -H - ry - 4, fit: 0.6 };
    }
    case 'tray': return { mx: 0, my: -60, rx: 98, ry: 30, H: 16, depth: 2, taper: 1, w: 226, h: 104, top: -104, fit: 0.75, rect: true };
    case 'dish': return { mx: 0, my: -86, rx: 92, ry: 24, H: 56, depth: 10, taper: 1, w: 240, h: 124, top: -124, fit: 0.7, rect: true };
    case 'peel': return { mx: 0, my: -52, rx: 96, ry: 44, H: 6, depth: 0, taper: 1, w: 312, h: 106, top: -102, fit: 0.86, flat: true, x0: -104 };
    case 'plate': return { mx: 0, my: -40, rx: 72, ry: 23, H: 8, depth: 4, taper: 1, w: 220, h: 84, top: -82, fit: 0.85, flat: true };
    case 'kettle': return { mx: 0, my: -116, rx: 30, ry: 8, H: 116, depth: 70, taper: 1.5, w: 220, h: 172, top: -170, fit: 0.3 };
    case 'caydanlik': return { mx: 0, my: -152, rx: 34, ry: 9, H: 152, depth: 46, taper: 1.2, w: 220, h: 196, top: -196, fit: 0.3, lower: { mx: 0, my: -96, rx: 44, ry: 12, depth: 70 } };
    case 'cezve': return { mx: 0, my: -88, rx: 34, ry: 9.5, H: 88, depth: 60, taper: 1.2, w: 260, h: 140, top: -136, fit: 0.3 };
    case 'blender': return { mx: 0, my: -206, rx: 48, ry: 11, H: 206, depth: 140, taper: 0.7, w: 150, h: 226, top: -226, fit: 0.3, side: true };
    case 'glass': return { mx: 0, my: -100, rx: 23, ry: 5.5, H: 100, depth: 82, taper: 0.7, w: 106, h: 108, top: -106, fit: 0.2, side: true };
    case 'cup': return { mx: 0, my: -66, rx: 34, ry: 10, H: 66, depth: 40, taper: 0.6, w: 120, h: 78, top: -78, fit: 0.2 };
    case 'skewer': return { mx: 0, my: -34, rx: 110, ry: 14, H: 34, depth: 0, taper: 1, w: 270, h: 70, top: -70, fit: 0.34, flat: true };
    default: return { mx: 0, my: -90, rx: 80, ry: 24, H: 90, depth: 70, taper: 1, w: 180, h: 120, top: -120, fit: 0.4 };
  }
}
function vesselSize(a) { const g = vgeo(a); return { w: g.w, h: g.h }; }

function liquidOf(vs, contents) {
  if (vs.liquid) return vs.liquid;
  let col = null;
  let brew = null;
  for (const e of contents) {
    if (!e) continue;
    const info = INGREDIENTS[e.kind];
    if (!info) continue;
    if (info.liquid && e.kind !== 'water') col = col ? mix(col, liquidColor(e.kind), 0.5) : liquidColor(e.kind);
    else if (e.kind === 'tea' || e.kind === 'coffee') brew = liquidColor(e.kind === 'tea' ? 'tea' : 'coffee');
    else if (e.kind === 'tomatoPaste') col = col ? mix(col, '#c8402a', 0.6) : '#d0583a';
    else if (e.kind === 'turmeric' || e.kind === 'saffron') col = col ? mix(col, '#f2b21a', 0.35) : '#f0c040';
  }
  if (brew) col = col ? mix(col, brew, 0.6) : brew;
  return col || '#9fd6f2';
}
function isPowder(info, a) { return a.type === 'shaker' || a.type === 'sack' || a.type === 'tea' || (info.powder && a.type !== 'pile'); }

// One small bit of a content kind (in a pot / pan / glass), centred at (0,0).
function miniPiece(c, kind, cut, P, a, info, seed, flat, inLiquid) {
  cut = cut ? normCut(cut) : null;
  const r = rng(seed);
  if (isPowder(info, a)) {
    c.fillStyle = a.type === 'tea' ? shade(P.c1, 0.15) : P.c1;
    for (let i = 0; i < 5; i++) { c.beginPath(); E(c, (r() - 0.5) * 18, (r() - 0.5) * 7, 1.8, 1.4, r() * 3); c.fill(); }
    return;
  }
  switch (a.type) {
    case 'pile':
      for (let i = 0; i < 3; i++) grainAt(c, a.grain, (r() - 0.5) * 12, (r() - 0.5) * 5, a.grain === 'rice' ? 3.6 : a.grain === 'lentil' ? 4 : 6, P, r, 0);
      return;
    case 'bundle': {
      const soft = P.ck > 0.25 || cut;
      c.beginPath();
      if (soft) {
        for (let i = 0; i < 3; i++) { const oy = (i - 1) * 5, ox = (r() - 0.5) * 10; c.moveTo(-26 + ox, oy); c.bezierCurveTo(-14 + ox, oy - 12, -6 + ox, oy + 10, 6 + ox, oy - 1); c.bezierCurveTo(14 + ox, oy - 10, 20 + ox, oy + 6, 28 + ox, oy - 2); }
      } else {
        for (let i = 0; i < 6; i++) { c.moveTo(-10 + i * 3, 6); c.lineTo(22 + i * 7, -58 - (i % 3) * 5); }
      }
      c.strokeStyle = OUTLINE; c.lineWidth = 3.2 + LW * 1.2; c.stroke(); c.strokeStyle = P.c1; c.lineWidth = 3.2; c.stroke();
      return;
    }
    case 'egg':
      if (!cut) { if (flat) sub(c, 0, 8, 0.5, () => drawFriedEgg(c, P, P.ck, seed, false)); else sub(c, 0, 14, 0.38, () => drawEgg(c, a, P, {}, 0, seed)); return; }
      if (cut === 'cracked' || cut === 'beaten') { sub(c, 0, 8, 0.5, () => drawFriedEgg(c, P, P.ck, seed, cut === 'beaten')); return; }
      break;
    case 'jar': case 'can': case 'carton': case 'bottle': case 'jug': {
      const p = blobPts(0, 0, 12, 6, 7, 0.2, seed);
      c.beginPath(); smoothClosed(c, p); fs(c, a.type === 'can' && a.c1 === '#e0742e' ? '#d8682a' : P.c1, LW * 0.7);
      if (a.type === 'can') for (let i = 0; i < 3; i++) bead(c, (i - 1) * 6, (i % 2) * 2 - 1, 3.5, 2.6, '#e0843e');
      return;
    }
    case 'block':
      if (!cut && a.shape === 'brick') {
        c.beginPath(); RR(c, -9, -6, 18, 12, 4); fs(c, P.c1, LW * 0.7);
        c.strokeStyle = rgba(P.c1, 0.6); c.lineWidth = 4; c.beginPath(); E(c, 0, 0, 15, 8); c.stroke();
        return;
      }
      if (!cut && a.shape === 'mince') { for (let i = 0; i < 4; i++) { const p = blobPts((r() - 0.5) * 14, (r() - 0.5) * 6, 4, 3, 6, 0.3, seed + i); c.beginPath(); smoothClosed(c, p); fs(c, P.c1, LW * 0.55); } return; }
      break;
    case 'herb':
      if (!cut || cut === 'mince' || cut === 'dice') { c.fillStyle = P.c1; for (let i = 0; i < 5; i++) { c.beginPath(); E(c, (r() - 0.5) * 16, (r() - 0.5) * 7, 2.2, 1.5, r() * 3); c.fill(); } c.fillStyle = P.c2; for (let i = 0; i < 3; i++) { c.beginPath(); E(c, (r() - 0.5) * 16, (r() - 0.5) * 7, 2, 1.4, r() * 3); c.fill(); } return; }
      break;
    case 'dough':
      sub(c, 0, 10, 0.32, () => drawDough(c, '', a, P, { shape: 'ball' }, 0, seed));
      return;
    default: break;
  }
  if (!cut) {
    const S = sizeArt(a);
    const k = clamp(30 / Math.max(S.w, S.h), 0.16, 0.42);
    sub(c, 0, S.h * k * 0.5, k, () => drawWholeArt(c, a, P, {}, 0, seed));
    return;
  }
  switch (cut) {
    case 'dice': { const col = pieceCol(a, P), sk = pieceSkin(a, P); cube(c, 11, col, sk && r() < 0.4 ? sk : shade(col, 0.22), shade(col, -0.16)); return; }
    case 'chunks': { const col = pieceCol(a, P); const meat = a.type === 'block'; cube(c, 18, col, meat ? P.c1 : shade(col, 0.22), shade(meat ? P.c1 : col, -0.16), 6); return; }
    case 'slices': case 'rings': {
      let rx = 10;
      if (a.type === 'round') rx = roundDims(a).rx * 0.26; else if (a.type === 'long') rx = tubeOf(a).T * 0.48; else if (a.type === 'block') rx = a.shape === 'log' ? 11 : 9;
      if (a.type === 'mushroom') { mushSlice(c, P, 20); return; }
      if (cut === 'rings' || a.hollow) { pRing(c, a, P, rx, rx * 0.6, seed, seed); return; }
      xsec(c, a, P, rx, rx * 0.62, seed);
      return;
    }
    case 'strips': c.save(); c.rotate((r() - 0.5) * 1.2); stick(c, 26, 6, pieceCol(a, P), a.type === 'long' && a.seeds ? P.c1 : null); c.restore(); return;
    case 'mince': case 'grated': {
      const col = pieceCol(a, P);
      for (let i = 0; i < 5; i++) {
        const x = (r() - 0.5) * 16, y = (r() - 0.5) * 7;
        if (cut === 'grated') { c.beginPath(); c.moveTo(x - 4, y); c.quadraticCurveTo(x, y - 4, x + 5, y + 1); c.strokeStyle = OUTLINE; c.lineWidth = 2.6 + LW; c.stroke(); c.strokeStyle = col; c.lineWidth = 2.6; c.stroke(); }
        else { c.beginPath(); c.moveTo(x - 2.6, y); c.lineTo(x, y - 2.6); c.lineTo(x + 2.8, y); c.lineTo(x, y + 2.4); c.closePath(); fs(c, i % 2 ? col : shade(col, -0.15), LW * 0.45); }
      }
      return;
    }
    case 'halves': sub(c, 0, 8, 0.32, () => pHalf(c, a, P, seed, a.type === 'egg' ? 58 : 90)); return;
    case 'wedges': sub(c, 0, 4, 0.4, () => pWedge(c, a, P, 60, seed)); return;
    case 'torn': sub(c, 0, 0, 0.6, () => pTorn(c, a, P, 16, seed)); return;
    case 'crushed': sub(c, 0, 0, 0.6, () => pCrushed(c, a, P, seed)); return;
    case 'slit': {
      const S = sizeArt(a); const k = clamp(46 / S.w, 0.2, 0.5);
      sub(c, 0, S.h * k * 0.5, k, () => drawSlit(c, a, P, {}, 0, seed, 1));
      return;
    }
    default: { const col = pieceCol(a, P); cube(c, 11, col, shade(col, 0.22), shade(col, -0.16)); }
  }
}

// Visible interior of an open vessel: back wall, floor, liquid / contents, bubbles.
//   m = {cx, cy, rx, ry, depth, taper, wall, floor, flat, k}
function interior(c, m, vs, t, seed) {
  const contents = Array.isArray(vs.contents) ? vs.contents.filter((e) => e && e.kind != null) : [];
  const water = clamp(num(vs.water), 0, 1);
  const solids = contents.filter((e) => !(INGREDIENTS[e.kind] && INGREDIENTS[e.kind].liquid));
  const ck = clamp(num(vs.cook), 0, 1);
  const boil = clamp(num(vs.boil), 0, 1);
  const foam = clamp(num(vs.foam), 0, 1);
  const k = m.k || 1;
  c.save();
  // clip: mouth ellipse + everything above the mouth's centre line
  c.beginPath(); E(c, m.cx, m.cy, m.rx, m.ry); c.rect(m.cx - m.rx * 3, m.cy - 600, m.rx * 6, 600);
  c.clip();
  c.save();
  c.beginPath(); E(c, m.cx, m.cy, m.rx, m.ry); c.clip();
  c.fillStyle = m.wall; c.fillRect(m.cx - m.rx - 4, m.cy - m.ry - 4, m.rx * 2 + 8, m.ry * 2 + m.depth + 8);
  // floor
  const frx = m.rx * m.taper, fry = m.ry * m.taper;
  c.fillStyle = m.floor; c.beginPath(); E(c, m.cx, m.cy + m.depth, frx, fry); c.fill();
  if (m.holes && !tiny()) {
    c.fillStyle = rgba(OUTLINE, 0.5);
    for (let i = 0; i < 14; i++) { const an = PI + (i / 13) * PI; c.beginPath(); E(c, m.cx + Math.cos(an) * m.rx * 0.82, m.cy + Math.sin(an) * m.ry * 0.5 + 3, 1.8, 1.2); c.fill(); }
  }
  // content level
  const liquidCol = liquidOf(vs, contents);
  let lvl = water;
  if (!water && solids.length) lvl = m.flat ? 0.6 : Math.min(0.55, 0.16 + 0.06 * solids.length);
  if (foam > 0 && water > 0) lvl = Math.min(1, water + foam * 0.2);
  let sy = m.cy, srx = m.rx, sry = m.ry;
  if (lvl > 0) {
    sy = m.cy + m.depth * (1 - lvl);
    const tk = lerp(m.taper, 1, lvl);
    srx = m.rx * tk; sry = m.ry * tk;
    let col;
    if (water > 0) col = ck > 0 ? mix(liquidCol, '#a8662a', ck * 0.35) : liquidCol;
    else if (m.flat) col = null;
    else {
      const e0 = solids[0], a0 = artOf(e0.kind), P0 = pal(a0, { cook: ck });
      col = isPowder(INGREDIENTS[e0.kind] || {}, a0) ? P0.c1 : pieceCol(a0, P0);
      if (solids[1]) { const a1 = artOf(solids[1].kind); col = mix(col, pieceCol(a1, pal(a1, { cook: ck })), 0.3); }
      col = shade(col, -0.08);
    }
    if (col) {
      c.fillStyle = col; c.beginPath(); E(c, m.cx, sy, srx, sry); c.fill();
      c.lineWidth = Math.max(1.2, LW * 0.45); c.strokeStyle = shade(col, -0.25); c.stroke();
    } else {
      const fat = contents.find((e) => e.kind === 'oil' || e.kind === 'oliveOil' || e.kind === 'butter' || e.kind === 'ghee');
      if (fat) {
        c.fillStyle = rgba(liquidColor(fat.kind), 0.55); c.beginPath(); E(c, m.cx, sy, srx * 0.8, sry * 0.75); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = Math.max(1.5, 2.5 * k); c.beginPath(); c.ellipse(m.cx - srx * 0.2, sy - sry * 0.2, srx * 0.4, sry * 0.3, 0, PI * 1.1, PI * 1.6); c.stroke();
      }
    }
    if (water > 0) {
      // ripple highlight
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(1.6, 3 * k);
      c.beginPath(); c.ellipse(m.cx - srx * 0.15, sy - sry * 0.15, srx * 0.55, sry * 0.45, 0, PI * 1.1, PI * 1.6); c.stroke();
      if (!tiny()) { c.beginPath(); c.ellipse(m.cx + srx * 0.25, sy + sry * 0.2, srx * 0.3, sry * 0.25, 0, PI * 0.1, PI * 0.6); c.stroke(); }
    }
    if (foam > 0 && water > 0) {
      const fcol = '#caa074';
      c.fillStyle = fcol; c.beginPath(); E(c, m.cx, sy, srx * (0.4 + 0.6 * foam), sry * (0.4 + 0.6 * foam)); c.fill();
      if (!tiny()) { const r = rng(seed + 3); c.fillStyle = '#e8c89a'; for (let i = 0; i < 8 + foam * 10; i++) { const an = r() * TAU, d = Math.sqrt(r()) * 0.8 * foam; c.beginPath(); E(c, m.cx + Math.cos(an) * srx * d, sy + Math.sin(an) * sry * d, 2 * k, 1.5 * k); c.fill(); } }
    }
  }
  c.restore();
  // bits of contents on the surface (may poke above the back rim)
  if (solids.length) {
    const r = rng(seed + 17);
    const per = clamp(Math.round((m.flat ? 14 : 11) / solids.length), 2, m.flat ? 8 : 6);
    const bits = [];
    solids.forEach((e, ei) => {
      const a = artOf(e.kind), info = INGREDIENTS[e.kind] || {};
      const P = pal(a, { cook: Math.max(ck, num(e.cook)) });
      const whole = !e.cut && !isPowder(info, a) && a.type !== 'pile' && a.type !== 'block' && a.type !== 'herb' && a.type !== 'bundle';
      const nn = isPowder(info, a) ? Math.max(2, per - 2) : a.type === 'pile' ? per + 2 : a.type === 'bundle' ? 2 : whole ? Math.min(per, 3) : per;
      for (let i = 0; i < nn; i++) {
        let px = 0, py = 0;
        for (let tries = 0; tries < 6; tries++) {
          const an = r() * TAU, d = Math.sqrt(r()) * 0.82;
          px = m.cx + Math.cos(an) * srx * d; py = sy + Math.sin(an) * sry * d;
          const ux = (px - m.cx) / (m.rx * 0.9), uy = (py - m.cy) / (m.ry * 0.9);
          if (ux * ux + uy * uy <= 1) break;
        }
        const bob = water > 0 ? Math.sin(t * 2.2 + i + ei * 1.7) * 1.5 * k * (0.4 + boil) : 0;
        bits.push({ px, py: py + bob, e, a, info, P, seed: seed + ei * 101 + i * 7, whole });
      }
    });
    bits.sort((p, q) => p.py - q.py);
    const wcol = water > 0 ? (ck > 0 ? mix(liquidCol, '#a8662a', ck * 0.35) : liquidCol) : null;
    for (const b of bits) {
      sub(c, b.px, b.py, k, () => miniPiece(c, b.e.kind, b.e.cut, b.P, b.a, b.info, b.seed, m.flat, water > 0));
      if (wcol && (b.whole || (b.e.cut && b.e.cut !== 'mince' && b.e.cut !== 'grated'))) {
        // the water line around a floating / bobbing thing
        const w2 = (b.whole ? 15 : 9) * k;
        c.beginPath(); c.ellipse(b.px, b.py + 1.5 * k, w2, w2 * 0.32, 0, 0, PI); c.lineTo(b.px - w2, b.py + 1.5 * k);
        c.fillStyle = rgba(wcol, 0.85); c.fill();
        c.beginPath(); c.ellipse(b.px, b.py + 1.5 * k, w2, w2 * 0.32, 0, PI * 1.05, PI * 1.95); c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = Math.max(1, 1.6 * k); c.stroke();
      }
    }
  }
  // bubbles
  if (boil > 0 && lvl > 0) {
    const r = rng(seed + 29);
    const n = Math.round(3 + boil * 9);
    const bc = shade(water > 0 ? liquidCol : '#c89050', 0.35);
    for (let i = 0; i < n; i++) {
      const an = r() * TAU, d = Math.sqrt(r()) * 0.75;
      const px = m.cx + Math.cos(an) * srx * d, py = sy + Math.sin(an) * sry * d;
      const ux = (px - m.cx) / m.rx, uy = (py - m.cy) / m.ry;
      if (ux * ux + uy * uy > 0.85) continue;
      const sp = 0.7 + r() * 0.8, off = r();
      const ph = (((t * sp * (0.5 + boil) + off) % 1) + 1) % 1;
      const br = (1.5 + 5.5 * ph) * (0.6 + 0.6 * boil) * k;
      if (ph < 0.86) {
        c.beginPath(); E(c, px, py - br * 0.4, br, br * 0.85);
        c.fillStyle = bc; c.fill(); c.lineWidth = Math.max(1, LW * 0.4); c.strokeStyle = rgba(OUTLINE, 0.7); c.stroke();
        c.fillStyle = '#fff'; c.beginPath(); E(c, px - br * 0.35, py - br * 0.75, br * 0.25, br * 0.2); c.fill();
      } else {
        c.beginPath(); c.arc(px, py - br * 0.4, br * 1.3, PI * 1.1, PI * 1.9);
        c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = Math.max(1, 2 * k); c.stroke();
      }
    }
  }
  // sizzle pops in a hot pan without water
  if (!water && solids.length && num(vs.heat) > 0 && m.flat) {
    const r = rng(seed + 41);
    c.fillStyle = 'rgba(255,250,220,0.9)';
    for (let i = 0; i < 5; i++) {
      const ph = (((t * (1.2 + r()) + r()) % 1) + 1) % 1;
      const px = m.cx + (r() - 0.5) * m.rx * 1.4, py = m.cy + (r() - 0.5) * m.ry - Math.sin(ph * PI) * 16 * k;
      c.beginPath(); E(c, px, py, 1.8 * k, 1.8 * k); c.fill();
    }
  }
  c.restore();
}
// Foam dome rising over the rim (cezve).
function foamDome(c, cx, cy, rx, ry, foam, t) {
  if (foam <= 0.8) return;
  const h = (foam - 0.75) * 4 * ry * 2.4 + 3;
  const p = [];
  for (let i = 0; i <= 10; i++) { const u = i / 10, x = cx - rx + u * rx * 2; p.push(x, cy - Math.sin(PI * u) * h - (i % 2 ? 2 : 0) + Math.sin(t * 3 + i) * 0.8); }
  c.beginPath(); smoothOpen(c, p, true); c.ellipse(cx, cy, rx, ry, 0, 0, PI, false); c.closePath();
  fs(c, '#caa074', LW * 0.8);
  c.fillStyle = '#ead2a8';
  for (let i = 1; i < 9; i += 2) { c.beginPath(); E(c, p[2 * i], p[2 * i + 1] + 4, 3, 2); c.fill(); }
}
function lidOn(c, cx, cy, rx, ry, col, knob, towel, t) {
  if (towel) {
    c.save();
    const towel = (q) => {
      E(q, cx, cy + 2, rx + 16, ry + 11);
      q.moveTo(cx - rx - 14, cy - 4); q.quadraticCurveTo(cx - rx - 30, cy + 30, cx - rx - 26, cy + 64); q.quadraticCurveTo(cx - rx - 8, cy + 44, cx - rx + 10, cy + 26); q.closePath();
      q.moveTo(cx + rx + 14, cy - 4); q.quadraticCurveTo(cx + rx + 30, cy + 34, cx + rx + 24, cy + 68); q.quadraticCurveTo(cx + rx + 6, cy + 46, cx + rx - 10, cy + 26); q.closePath();
    };
    c.beginPath(); towel(c);
    c.fillStyle = '#fffaf0'; c.fill();
    c.clip();
    c.fillStyle = 'rgba(214,64,52,0.55)';
    const st = 10;
    for (let x = cx - rx - 40; x < cx + rx + 40; x += st * 2) c.fillRect(x, cy - ry - 20, st, ry * 2 + 100);
    for (let y = cy - ry - 20; y < cy + 80; y += st * 2) c.fillRect(cx - rx - 40, y, rx * 2 + 80, st);
    c.restore();
    c.beginPath(); towel(c);
    c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke();
  }
  const h = ry * 1.25 + 6;
  const R = rx + 4, Ry = ry + 3;
  paint(c, (q) => { q.moveTo(cx - R, cy); q.bezierCurveTo(cx - R * 0.8, cy - h * 1.35, cx + R * 0.8, cy - h * 1.35, cx + R, cy); q.ellipse(cx, cy, R, Ry, 0, 0, PI, false); q.closePath(); }, col, {
    dx: R * 0.1, dy: 0, hl: [cx - R * 0.45, cy - h * 0.55, R * 0.18, h * 0.16, -0.3],
  });
  c.beginPath(); c.ellipse(cx, cy, R, Ry, 0, 0.05, PI - 0.05); strokeIn(c, shade(col, 0.3), 2.5);
  const ky = cy - h + 2;
  c.beginPath(); RR(c, cx - 5, ky - 9, 10, 12, 3); fs(c, shade(knob, -0.1), LW * 0.85);
  paint(c, (q) => E(q, cx, ky - 12, 14, 6), knob, { dx: 0, dy: 2, hl: [cx - 5, ky - 14, 4, 1.6] });
  return ky - 18;
}

// Rounded-sided body whose top edge is the front of the mouth ellipse.
function potBody(rx, ry, H, bulge = 0, taper = 1) {
  const my = -H, bry = ry * 0.9, brx = rx * taper;
  return (q) => {
    q.moveTo(rx, my);
    q.ellipse(0, my, rx, ry, 0, 0, PI, false);
    q.bezierCurveTo(-rx - bulge, my + H * 0.35, -brx - bulge * 0.5, -bry - 10, -brx, -bry - 4);
    q.bezierCurveTo(-brx, -bry * 0.1, -brx * 0.55, 0, 0, 0);
    q.bezierCurveTo(brx * 0.55, 0, brx, -bry * 0.1, brx, -bry - 4);
    q.bezierCurveTo(brx + bulge * 0.5, -bry - 10, rx + bulge, my + H * 0.35, rx, my);
    q.closePath();
  };
}
function lipRing(c, cx, cy, rx, ry, col) {
  c.beginPath(); E(c, cx, cy, rx + 3, ry + 2.5); fs(c, shade(col, 0.28));
}
function earHandle(c, x, y, dir, col, w = 7) {
  tube(c, [x - dir * 4, y + 2, x + dir * 20, y - 2, x + dir * 24, y + 12, x - dir * 4, y + 18], col, w);
}
function drawItemsOn(c, items, g, t) {
  const list = items.filter((p) => p && typeof p === 'object').sort((p, q) => num(p.y) - num(q.y));
  for (const it of list) {
    const a = artOf(it.kind);
    const st = it.st || {};
    const S = sizeOfState(a, st, c);
    const sc = Math.min(g.fit, (g.rx * 2 * 0.95) / Math.max(1, S.w)) * num(it.s, 1);
    const px = g.mx + clamp(num(it.x), -1, 1) * g.rx * (g.type === 'skewer' ? 1 : 0.72);
    const cut = st.cut ? normCut(st.cut) : null;
    if (g.type === 'skewer') {
      if (cut && cut !== 'slit') {
        const P = pal(a, st);
        sub(c, px, g.my + 4, 1.75 * num(it.s, 1), () => miniPiece(c, it.kind, cut, P, a, INGREDIENTS[it.kind] || {}, (hash(String(it.kind)) + (num(st.seed) | 0)) >>> 0, false, false));
      } else {
        const k2 = Math.min(0.42, 46 / Math.max(S.w, S.h)) * num(it.s, 1);
        sub(c, px, g.my + S.h * k2 * 0.5, k2, () => ingLocal(c, it.kind, st, t));
      }
      continue;
    }
    const py = g.my + clamp(num(it.y), -1, 1) * g.ry * 0.72 + S.h * sc * 0.32;
    sub(c, px, py, sc, () => ingLocal(c, it.kind, st, t));
  }
}
function sizeOfState(a, st, c) {
  if (a.type === 'dough' && st && st.shape === 'flat') { const g = doughFlatGeom(st); return { w: g.rx * 2 + 16, h: g.ry * 2 + g.th }; }
  const S = sizeArt(a);
  if (c && st && st.cut && !(num(st.n, 0) > 0 && num(st.k, num(st.n)) < num(st.n))) {
    const cut = normCut(st.cut);
    if (cut !== 'slit' && cut !== 'rolls') {
      const w = piecesLocal(c, a, pal(a, st), cut, defaultCount(a, cut, st), 1, false, null, true);
      if (w > S.w) return { w, h: S.h };
    }
  }
  return S;
}

function vesselLocal(c, kind, a, vs, t) {
  if (Array.isArray(vs.contents) && vs.contents.some((e) => !e || typeof e !== 'object' || e.kind == null)) {
    vs = Object.assign({}, vs, { contents: vs.contents.filter((e) => e && typeof e === 'object' && e.kind != null) });
  }
  const g = vgeo(a);
  g.type = a.type;
  const seed = hash(String(kind));
  const c1 = a.c1 || '#c9ccd2', c2 = a.c2 || shade(c1, -0.3);
  const metalInner = sat(c1) > 0.3 ? '#e6e1d8' : shade(c1, -0.12);
  const boil = clamp(num(vs.boil), 0, 1), heat = clamp(num(vs.heat), 0, 3);
  const water = clamp(num(vs.water), 0, 1);
  const contents = Array.isArray(vs.contents) ? vs.contents : [];
  const hasStuff = water > 0 || contents.length > 0;
  let top = g.top;
  const k = g.rx / 87;
  const items = Array.isArray(vs.items) ? vs.items : null;
  const steamAmt = boil > 0 ? 0.4 + boil * 0.6 : heat > 0 && hasStuff ? heat * 0.12 : (vs.steam ? 0.5 : 0);
  const mouth = (wall, floor, extra) => Object.assign({ cx: g.mx, cy: g.my, rx: g.rx, ry: g.ry, depth: g.depth, taper: g.taper, wall, floor, k }, extra || {});

  switch (a.type) {
    case 'pot': case 'saucepan': {
      const orx = g.orx, ory = g.ory, H = g.H;
      if (a.type === 'pot') { earHandle(c, -orx, -H + 16, -1, c2); earHandle(c, orx, -H + 16, 1, c2); }
      else {
        sub(c, orx - 8, -H + 18, 1, () => {
          paint(c, (q) => RR(q, 0, -8, 132, 17, 8.5), c2, { dx: 0, dy: 4, hl: [40, -4, 30, 2.5] });
          c.beginPath(); E(c, 118, 0.5, 4.5, 4.5); fs(c, shade(c2, -0.4), LW * 0.6);
        }, -0.1);
      }
      paint(c, potBody(orx, ory, H, 3), c1, {
        dx: orx * 0.12, dy: 0, hl: [-orx * 0.62, -H * 0.5, orx * 0.07, H * 0.26],
        detail: (q) => { q.beginPath(); q.ellipse(0, -H + 14, orx + 2, ory, 0, 0.12, PI - 0.12); strokeIn(q, shade(c1, 0.3), 3); },
      });
      lipRing(c, 0, g.my, orx, ory, c1);
      if (vs.lid) top = lidOn(c, 0, g.my, orx, ory, c1, c2, vs.towel, t);
      else {
        interior(c, mouth(shade(metalInner, -0.22), metalInner), vs, t, seed);
        c.beginPath(); E(c, 0, g.my, g.rx, g.ry); strokeIn(c, OUTLINE, LW * 0.75);
      }
      break;
    }
    case 'pan': {
      const orx = g.orx, ory = g.ory, H = g.H, my = g.my;
      if (a.wide || a.handles === 2) { earHandle(c, -orx, my + 4, -1, c2, 6); earHandle(c, orx, my + 4, 1, c2, 6); }
      else {
        sub(c, orx - 10, my + 8, 1, () => {
          paint(c, (q) => RR(q, 0, -7, 96, 14, 7), c2, { dx: 0, dy: 3 });
          paint(c, (q) => RR(q, 80, -9, 62, 18, 9), '#b8743a', { dx: 0, dy: 4, hl: [92, -5, 16, 2.5] });
          c.beginPath(); E(c, 130, 0, 4, 4); fs(c, '#6a3a1a', LW * 0.6);
        }, -0.12);
      }
      const brx = orx * 0.86, bry = ory * 0.86;
      paint(c, (q) => {
        q.moveTo(orx, my); q.ellipse(0, my, orx, ory, 0, 0, PI, false);
        q.lineTo(-brx, -bry); q.ellipse(0, -bry, brx, bry, 0, PI, 0, true); q.closePath();
      }, c1, { dx: orx * 0.1, dy: 0, hl: [-orx * 0.55, my + H * 0.25 + ory * 0.6, orx * 0.12, 3, 0.15] });
      lipRing(c, 0, my, orx, ory, c1);
      interior(c, mouth(shade(c1, 0.12), shade(c1, 0.2), { flat: true }), vs, t, seed);
      c.beginPath(); E(c, 0, my, g.rx, g.ry); strokeIn(c, OUTLINE, LW * 0.75);
      if (items) drawItemsOn(c, items, g, t);
      if (vs.lid) top = lidOn(c, 0, my, orx, ory, shade(c1, 0.2), c2, false, t);
      break;
    }
    case 'bowl': case 'colander': {
      const orx = g.orx, ory = g.ory, H = g.H;
      const col = a.type === 'colander';
      if (col) {
        for (const d of [-1, 1]) { c.beginPath(); RR(c, d > 0 ? orx - 8 : -orx - 18, -H + 4, 26, 12, 6); fs(c, c2); }
      }
      c.beginPath(); E(c, 0, -6, orx * 0.36, 7); c.lineTo(orx * 0.36, 0); fs(c, shade(c1, -0.12));
      paint(c, (q) => {
        q.moveTo(orx, -H); q.ellipse(0, -H, orx, ory, 0, 0, PI, false);
        q.bezierCurveTo(-orx, -H + H * 0.75, -orx * 0.48, -8, 0, -8);
        q.bezierCurveTo(orx * 0.48, -8, orx, -H + H * 0.75, orx, -H); q.closePath();
      }, c1, {
        dx: orx * 0.12, dy: 4, hl: [-orx * 0.55, -H * 0.62, orx * 0.1, H * 0.16, 0.3],
        detail: (q) => {
          if (col) {
            q.fillStyle = shade(c2, -0.3);
            for (let row = 0; row < 3; row++) for (let i = -5; i <= 5; i++) { const x = i * 13 * (1 - row * 0.18), y = -H + 22 + row * 14 + Math.abs(i) * -1.2; q.beginPath(); E(q, x, y, 2.6, 2); q.fill(); }
          } else {
            q.beginPath(); q.ellipse(0, -H + 12, orx, ory, 0, 0.1, PI - 0.1); strokeIn(q, c2, 7);
            q.beginPath(); q.ellipse(0, -H + 22, orx * 0.97, ory, 0, 0.18, PI - 0.18); strokeIn(q, c2, 2.4);
          }
        },
      });
      lipRing(c, 0, -H, orx, ory, c1);
      if (vs.lid) top = lidOn(c, 0, -H, orx, ory, shade(c1, -0.05), c2, vs.towel, t);
      else {
        interior(c, mouth(shade(c1, -0.12), shade(c1, -0.04), { holes: col }), vs, t, seed);
        c.beginPath(); E(c, 0, g.my, g.rx, g.ry); strokeIn(c, OUTLINE, LW * 0.75);
      }
      if (col && water > 0) {
        c.fillStyle = 'rgba(170,220,245,0.9)';
        for (let i = 0; i < 4; i++) {
          const ph = (((t * 1.4 + i * 0.27) % 1) + 1) % 1;
          drop(c, (i - 1.5) * 18, -6 + ph * 22, 3.2);
        }
      }
      if (items) drawItemsOn(c, items, g, t);
      break;
    }
    case 'tray': {
      c.beginPath(); c.moveTo(-112, -30); c.lineTo(-112, -10); c.quadraticCurveTo(-112, 0, -100, 0); c.lineTo(100, 0); c.quadraticCurveTo(112, 0, 112, -10); c.lineTo(112, -30); c.closePath();
      fs(c, shade(c1, -0.12));
      paint(c, (q) => RR(q, -112, -104, 224, 82, 14), c1, { dx: 0, dy: 0, hl: [-80, -96, 30, 3] });
      c.beginPath(); RR(c, -99, -94, 198, 64, 9); fs(c, shade(c1, -0.06), LW * 0.7);
      if (!tiny()) { c.beginPath(); for (let i = 1; i < 3; i++) { c.moveTo(-99 + 4, -94 + i * 21); c.lineTo(99 - 4, -94 + i * 21); } strokeIn(c, shade(c1, -0.12), 1.5); }
      if (contents.length || water > 0) { c.save(); c.beginPath(); RR(c, -99, -94, 198, 64, 9); c.clip(); interior(c, mouth(shade(c1, -0.06), shade(c1, -0.06), { flat: true, rx: 110, ry: 40, depth: 1, taper: 1 }), vs, t, seed); c.restore(); }
      if (items) drawItemsOn(c, items, g, t);
      break;
    }
    case 'dish': {
      for (const d of [-1, 1]) { c.beginPath(); E(c, d * 114, -84, 14, 8); fs(c, c2); }
      paint(c, (q) => { q.moveTo(-108, -70); q.lineTo(-104, -12); q.quadraticCurveTo(-102, 0, -88, 0); q.lineTo(88, 0); q.quadraticCurveTo(102, 0, 104, -12); q.lineTo(108, -70); q.closePath(); }, c2, {
        dx: 10, dy: 0, hl: [-82, -32, 7, 14, 0],
        detail: tiny() ? null : (q) => { q.beginPath(); q.moveTo(-104, -40); q.lineTo(104, -40); strokeIn(q, shade(c2, 0.3), 3); },
      });
      c.beginPath(); RR(c, -112, -124, 224, 72, 18); fs(c, shade(c1, 0.05));
      c.beginPath(); RR(c, -99, -116, 198, 56, 12); fs(c, shade(c1, -0.1), LW * 0.7);
      if (contents.length || water > 0) {
        c.save(); c.beginPath(); RR(c, -99, -116, 198, 56, 12); c.clip();
        interior(c, mouth(shade(c1, -0.1), shade(c1, -0.1), { flat: true, rx: 110, ry: 40, depth: 2, taper: 1, cy: -88 }), vs, t, seed);
        c.restore();
      }
      if (items && !vs.lid) { c.save(); c.beginPath(); c.rect(-400, -600, 800, 600 - 58); c.clip(); drawItemsOn(c, items, g, t); c.restore(); }
      if (vs.lid) {
        // crinkly aluminium foil
        const foil = (q) => { q.moveTo(-114, -96); q.quadraticCurveTo(-112, -132, -60, -130); q.lineTo(60, -132); q.quadraticCurveTo(114, -130, 114, -96); q.lineTo(112, -60); q.quadraticCurveTo(0, -48, -112, -60); q.closePath(); };
        paint(c, foil, '#dfe3e8', {
          dx: 0, dy: 6, hl: [-50, -116, 30, 5, -0.05],
          detail: tiny() ? null : (q) => { q.strokeStyle = 'rgba(120,130,145,0.55)'; q.lineWidth = 1.6; const r = rng(seed); for (let i = 0; i < 9; i++) { const x = -100 + r() * 200, y = -122 + r() * 56; q.beginPath(); q.moveTo(x, y); q.lineTo(x + 8 + r() * 10, y + (r() - 0.5) * 10); q.lineTo(x + 18 + r() * 8, y + (r() - 0.5) * 8); q.stroke(); } },
        });
        top = -134;
      }
      break;
    }
    case 'peel': {
      sub(c, 92, -52, 1, () => {
        paint(c, (q) => RR(q, 0, -11, 130, 22, 11), c1, { dx: 0, dy: 5, hl: [30, -6, 30, 2.5] });
        c.beginPath(); E(c, 116, 0, 5, 5); fs(c, shade(c2, -0.3), LW * 0.6);
      }, -0.04);
      c.beginPath(); E(c, 0, -46, g.rx + 4, g.ry + 4); fs(c, shade(c1, -0.14));
      paint(c, (q) => E(q, 0, -52, g.rx + 4, g.ry + 4), c1, {
        dx: 0, dy: 0, hl: [-50, -72, 26, 6, -0.15],
        detail: tiny() ? null : (q) => { q.strokeStyle = shade(c2, 0.1); q.lineWidth = 2; for (const yy of [-78, -62, -44, -30]) { q.beginPath(); q.moveTo(-90, yy); q.bezierCurveTo(-30, yy - 4, 30, yy + 4, 90, yy); q.stroke(); } },
      });
      if (items) drawItemsOn(c, items, g, t);
      break;
    }
    case 'plate': {
      c.beginPath(); E(c, 0, -36, 104, 36); fs(c, shade(c1, -0.1));
      paint(c, (q) => E(q, 0, -42, 108, 38), c1, { dx: 0, dy: 0, hl: [-60, -60, 22, 5, -0.25] });
      c.beginPath(); E(c, 0, -42, 98, 33); strokeIn(c, a.c2 || '#5aa0c8', 3);
      c.beginPath(); E(c, 0, -40, 74, 24); fs(c, shade(c1, -0.04), LW * 0.6);
      if (contents.length || water > 0) interior(c, mouth(shade(c1, -0.06), shade(c1, -0.03), { flat: true, rx: 72, ry: 23, depth: 2, taper: 1, cy: -40 }), vs, t, seed);
      if (items) drawItemsOn(c, items, g, t);
      break;
    }
    case 'skewer': {
      c.beginPath(); E(c, -128, -34, 11, 11); E(c, -128, -34, 5, 5); c.fillStyle = c2; c.fill('evenodd'); c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke();
      c.beginPath(); c.moveTo(-117, -34); c.lineTo(128, -34); c.lineTo(138, -34);
      c.strokeStyle = OUTLINE; c.lineWidth = 5 + LW * 1.6; c.stroke(); c.strokeStyle = c1; c.lineWidth = 5; c.stroke();
      if (items) drawItemsOn(c, items, g, t);
      else if (contents.length) {
        const list = contents.filter(Boolean);
        const n = Math.min(8, Math.max(4, list.length * 2));
        for (let i = 0; i < n; i++) {
          const e = list[i % list.length], aa = artOf(e.kind);
          sub(c, -96 + i * (200 / (n - 1)), -26, 1.25, () => miniPiece(c, e.kind, e.cut || 'chunks', pal(aa, { cook: num(vs.cook) }), aa, INGREDIENTS[e.kind] || {}, seed + i, false, false));
        }
      }
      break;
    }
    case 'kettle': {
      // spout, body, handle
      paint(c, (q) => { q.moveTo(-58, -64); q.quadraticCurveTo(-84, -70, -104, -104); q.lineTo(-93, -110); q.quadraticCurveTo(-78, -84, -52, -36); q.closePath(); }, c1, { dx: 0, dy: 3 });
      paint(c, (q) => { q.moveTo(-82, -12); q.bezierCurveTo(-90, -70, -50, -116, 0, -116); q.bezierCurveTo(50, -116, 90, -70, 82, -12); q.quadraticCurveTo(80, 0, 66, 0); q.lineTo(-66, 0); q.quadraticCurveTo(-80, 0, -82, -12); q.closePath(); }, c1, {
        dx: 12, dy: 6, hl: [-44, -86, 12, 20, 0.5],
        detail: (q) => {
          q.beginPath(); q.moveTo(-86, -30); q.quadraticCurveTo(0, -18, 86, -30); strokeIn(q, c2, 8);
          if (tiny()) return;
          for (const [fx, fy] of [[-30, -62], [26, -58]]) { for (let i = 0; i < 5; i++) { const an = i / 5 * TAU; q.beginPath(); E(q, fx + Math.cos(an) * 6, fy + Math.sin(an) * 6, 4.5, 4.5); q.fillStyle = c2; q.fill(); } q.beginPath(); E(q, fx, fy, 3.5, 3.5); q.fillStyle = '#ffd166'; q.fill(); }
        },
      });
      tube(c, [-40, -104, -46, -150, 46, -150, 40, -104], c2, 9);
      if (vs.lid) {
        c.beginPath(); E(c, 0, g.my, 36, 10); fs(c, shade(c1, 0.15));
        c.beginPath(); E(c, 0, g.my - 8, 9, 6); fs(c, c2);
        top = Math.min(top, -170);
      } else {
        lipRing(c, 0, g.my, g.rx, g.ry, c1);
        interior(c, mouth(shade(c1, -0.4), shade(c1, -0.25)), vs, t, seed);
        c.beginPath(); E(c, 0, g.my, g.rx, g.ry); strokeIn(c, OUTLINE, LW * 0.75);
      }
      if (boil > 0) steamFx(c, -100, -112, 26, boil, t, seed + 5);
      break;
    }
    case 'caydanlik': {
      const noTop = vs.noTop || vs.top === false;
      // lower kettle
      paint(c, (q) => { q.moveTo(-58, -40); q.quadraticCurveTo(-90, -52, -104, -92); q.lineTo(-93, -96); q.quadraticCurveTo(-80, -70, -50, -22); q.closePath(); }, c1, { dx: 0, dy: 3 });
      tube(c, [70, -78, 104, -70, 100, -30, 70, -26], c2, 9);
      paint(c, (q) => { q.moveTo(-80, -12); q.bezierCurveTo(-88, -66, -60, -96, -46, -96); q.lineTo(46, -96); q.bezierCurveTo(60, -96, 88, -66, 80, -12); q.quadraticCurveTo(78, 0, 64, 0); q.lineTo(-64, 0); q.quadraticCurveTo(-78, 0, -80, -12); q.closePath(); }, c1, {
        dx: 12, dy: 6, hl: [-48, -60, 9, 18, 0.35],
        detail: (q) => { q.beginPath(); q.moveTo(-84, -20); q.quadraticCurveTo(0, -8, 84, -20); strokeIn(q, c2, 5); },
      });
      const L = g.lower;
      lipRing(c, 0, L.my, L.rx, L.ry, c1);
      if (noTop) {
        interior(c, { cx: 0, cy: L.my, rx: L.rx, ry: L.ry, depth: L.depth, taper: 1.3, wall: shade(c1, -0.4), floor: shade(c1, -0.25), k: 0.5 }, vs, t, seed);
        c.beginPath(); E(c, 0, L.my, L.rx, L.ry); strokeIn(c, OUTLINE, LW * 0.75);
        if (boil > 0) steamFx(c, 0, L.my - 6, 50, boil, t, seed);
        if (boil > 0) steamFx(c, -100, -96, 20, boil * 0.6, t, seed + 3);
        return { mx: 0, my: L.my, rx: L.rx, ry: L.ry, top: L.my - L.ry - 4, lower: L };
      }
      // upper teapot
      paint(c, (q) => { q.moveTo(-34, -118); q.quadraticCurveTo(-56, -124, -66, -148); q.lineTo(-58, -152); q.quadraticCurveTo(-48, -134, -30, -106); q.closePath(); }, c1, { dx: 0, dy: 2 });
      tube(c, [42, -140, 66, -136, 62, -108, 42, -106], c2, 7);
      paint(c, (q) => { q.moveTo(-44, -96); q.bezierCurveTo(-56, -112, -50, -150, -36, -152); q.lineTo(36, -152); q.bezierCurveTo(50, -150, 56, -112, 44, -96); q.ellipse(0, -96, 44, 11, 0, 0, PI, false); q.closePath(); }, c1, {
        dx: 8, dy: 0, hl: [-28, -128, 5, 10, 0.3],
        detail: (q) => { q.beginPath(); q.moveTo(-50, -112); q.quadraticCurveTo(0, -102, 50, -112); strokeIn(q, c2, 3.5); },
      });
      lipRing(c, 0, g.my, 36, 9.5, c1);
      if (vs.lid) top = lidOn(c, 0, g.my, 36, 9.5, c1, c2, false, t);
      else {
        const lv = clamp(num(vs.level2), 0, 1);
        const v2 = Object.assign({}, vs, { water: lv, liquid: vs.liquid2 || (lv > 0 ? liquidColor('tea') : undefined), boil: 0 });
        interior(c, mouth(shade(c1, -0.4), shade(c1, -0.25), { k: 0.4 }), v2, t, seed);
        c.beginPath(); E(c, 0, g.my, g.rx, g.ry); strokeIn(c, OUTLINE, LW * 0.75);
      }
      if (boil > 0) steamFx(c, -100, -96, 20, boil, t, seed + 3);
      if (num(vs.level2) > 0 && (boil > 0 || heat > 0)) steamFx(c, -62, -150, 16, 0.5, t, seed + 8);
      const res = { mx: 0, my: g.my, rx: g.rx, ry: g.ry, top: Math.min(top, g.top), lower: L };
      return res;
    }
    case 'cezve': {
      sub(c, 30, -60, 1, () => {
        paint(c, (q) => RR(q, 0, -6, 44, 12, 5), '#d8b04a', { dx: 0, dy: 3 });
        paint(c, (q) => RR(q, 40, -9, 108, 18, 9), c2, { dx: 0, dy: 4, hl: [70, -5, 26, 2.5] });
      }, -0.32);
      const path = (q) => {
        q.moveTo(-38, -88); q.quadraticCurveTo(-46, -95, -54, -96);
        q.quadraticCurveTo(-42, -82, -32, -70);
        q.bezierCurveTo(-40, -56, -52, -36, -50, -14); q.quadraticCurveTo(-48, 0, -34, 0); q.lineTo(34, 0); q.quadraticCurveTo(48, 0, 50, -14);
        q.bezierCurveTo(52, -36, 40, -56, 32, -70); q.lineTo(38, -88); q.ellipse(0, -88, 38, 10.5, 0, 0, PI, false); q.closePath();
      };
      paint(c, path, c1, {
        dx: 8, dy: 4, hl: [-30, -36, 6, 14, 0.3],
        detail: tiny() ? null : (q) => { const r = rng(seed); q.fillStyle = shade(c1, 0.25); for (let i = 0; i < 14; i++) { q.beginPath(); E(q, (r() - 0.5) * 80, -10 - r() * 60, 2.4, 1.8); q.fill(); } },
      });
      lipRing(c, 0, g.my, 38, 10.5, c1);
      interior(c, mouth(shade(c1, -0.35), shade(c1, -0.2), { k: 0.4 }), vs, t, seed);
      c.beginPath(); E(c, 0, g.my, g.rx, g.ry); strokeIn(c, OUTLINE, LW * 0.75);
      const foam = clamp(num(vs.foam), 0, 1);
      if (foam > 0.8 && water > 0) { foamDome(c, 0, g.my, g.rx + 2, g.ry + 1, foam, t); top = Math.min(top, g.my - (foam - 0.75) * 4 * g.ry * 2.4 - 8); }
      break;
    }
    case 'blender': {
      const on = !!(vs.on || vs.spin || vs.blend);
      const jx = on ? Math.sin(t * 60) * 1.2 : 0;
      // base
      paint(c, (q) => { q.moveTo(-50, -54); q.lineTo(50, -54); q.lineTo(60, -8); q.quadraticCurveTo(60, 0, 50, 0); q.lineTo(-50, 0); q.quadraticCurveTo(-60, 0, -60, -8); q.closePath(); }, c2, { dx: 8, dy: 0, hl: [-34, -44, 14, 3] });
      for (const [bx, bc] of [[-24, '#e8574a'], [0, '#ffd166'], [24, '#7cc25a']]) { c.beginPath(); E(c, bx, -24, 7, 6); fs(c, bc, LW * 0.7); }
      const jar = (q) => { q.moveTo(-36 + jx, -54); q.lineTo(-50 + jx, -206); q.lineTo(50 + jx, -206); q.lineTo(36 + jx, -54); q.closePath(); };
      tube(c, [44 + jx, -190, 74 + jx, -184, 70 + jx, -100, 40 + jx, -96], c2, 9);
      // contents (side view through the glass)
      c.save(); c.beginPath(); jar(c); c.clip();
      c.fillStyle = 'rgba(220,240,248,0.55)'; c.fillRect(-60, -210, 120, 160);
      const lv = water > 0 ? water : contents.length ? Math.min(0.7, 0.2 + contents.length * 0.08) : 0;
      if (lv > 0) {
        const ly = -54 - lv * 148;
        let col = liquidOf(vs, contents);
        if (!water && contents.length) { const a0 = artOf(contents[0].kind); col = pieceCol(a0, pal(a0, {})); }
        if (on && contents.length) col = mix(col, contents.length > 1 ? pieceCol(artOf(contents[1].kind), pal(artOf(contents[1].kind), {})) : col, 0.4);
        c.fillStyle = col; c.fillRect(-60, ly, 120, 200);
        c.beginPath(); E(c, jx, ly, 50, 6); c.fillStyle = shade(col, 0.2); c.fill();
        if (on) { c.strokeStyle = rgba(shade(col, 0.4), 0.9); c.lineWidth = 3; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(jx, ly + 30 + i * 24, 26 - i * 6, 7, 0, t * 9 + i, t * 9 + i + 3.6); c.stroke(); } }
        else if (contents.length) {
          const r = rng(seed);
          for (let i = 0; i < 7; i++) { const e = contents[i % contents.length]; if (!e) continue; const aa = artOf(e.kind); sub(c, jx + (r() - 0.5) * 50, lerp(ly + 12, -66, r()), 1, () => miniPiece(c, e.kind, e.cut, pal(aa, {}), aa, INGREDIENTS[e.kind] || {}, seed + i, false, true)); }
        }
      }
      c.beginPath(); c.moveTo(-12 + jx, -64); c.lineTo(12 + jx, -58); c.moveTo(-12 + jx, -58); c.lineTo(12 + jx, -64); strokeIn(c, '#8a8f99', 4);
      c.restore();
      c.beginPath(); jar(c); c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke();
      glassHL(c, -32 + jx, -190, -80, 6);
      if (!tiny()) { c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(30 + jx, -80 - i * 30); c.lineTo(38 + jx, -80 - i * 30); } strokeIn(c, rgba(OUTLINE, 0.6), 2); }
      c.beginPath(); E(c, jx, -206, 50, 11); strokeIn(c, OUTLINE, LW);
      if (vs.lid) { paint(c, (q) => RR(q, -54 + jx, -222, 108, 18, 7), c2, { dx: 0, dy: 3, hl: [-30 + jx, -217, 16, 2] }); c.beginPath(); RR(c, -12 + jx, -232, 24, 12, 4); fs(c, shade(c2, 0.2)); top = -232; }
      g.mx = jx;
      break;
    }
    case 'glass': {
      // saucer
      c.beginPath(); E(c, 0, -6, 50, 12); fs(c, shade(c1, -0.12));
      c.beginPath(); E(c, 0, -9, 52, 13); fs(c, '#d8402e');
      c.beginPath(); E(c, 0, -9, 46, 10.5); strokeIn(c, c2, 2.5);
      c.beginPath(); E(c, 0, -10, 22, 6); fs(c, shade('#d8402e', -0.15), LW * 0.6);
      const path = (q) => {
        q.moveTo(-24, -100); q.bezierCurveTo(-23, -78, -11, -66, -12, -54); q.bezierCurveTo(-13, -38, -21, -28, -19, -18);
        q.quadraticCurveTo(-18, -12, -12, -12); q.lineTo(12, -12); q.quadraticCurveTo(18, -12, 19, -18);
        q.bezierCurveTo(21, -28, 13, -38, 12, -54); q.bezierCurveTo(11, -66, 23, -78, 24, -100); q.closePath();
      };
      c.save(); c.beginPath(); path(c); c.clip();
      c.fillStyle = rgba(c1, 0.6); c.fillRect(-30, -104, 60, 96);
      if (water > 0) {
        const ly = lerp(-14, -96, water);
        const col = vs.liquid || liquidOf(vs, contents.length ? contents : [{ kind: 'tea' }]);
        c.fillStyle = col; c.fillRect(-30, ly, 60, 100);
        c.beginPath(); E(c, 0, ly, 30, 4); c.fillStyle = shade(col, 0.25); c.fill();
        c.fillStyle = rgba('#ffffff', 0.25); c.fillRect(-30, ly + 4, 9, 100);
      }
      c.restore();
      c.beginPath(); path(c); c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke();
      glassHL(c, -17, -92, -74, 3.5); glassHL(c, -14, -34, -22, 3);
      c.beginPath(); E(c, 0, -100, 24, 5.5); strokeIn(c, OUTLINE, LW * 0.8);
      c.beginPath(); c.ellipse(0, -100, 24, 5.5, 0, 0.1, PI - 0.1); strokeIn(c, c2, 2);
      if (water > 0 && (heat > 0 || vs.hot || boil > 0)) steamFx(c, 0, -104, 28, 0.6, t, seed);
      break;
    }
    case 'cup': {
      c.beginPath(); E(c, 0, -6, 54, 12); fs(c, shade(c1, -0.12));
      c.beginPath(); E(c, 0, -9, 56, 13); fs(c, c1);
      c.beginPath(); E(c, 0, -9, 50, 10.5); strokeIn(c, c2, 2.5);
      tube(c, [32, -58, 54, -60, 52, -34, 28, -30], c1, 8);
      paint(c, (q) => { q.moveTo(38, -66); q.ellipse(0, -66, 38, 11, 0, 0, PI, false); q.bezierCurveTo(-36, -36, -26, -12, 0, -12); q.bezierCurveTo(26, -12, 36, -36, 38, -66); q.closePath(); }, c1, {
        dx: 7, dy: 3, hl: [-22, -44, 5, 10, 0.3],
        detail: (q) => { q.beginPath(); q.ellipse(0, -60, 38, 11, 0, 0.15, PI - 0.15); strokeIn(q, c2, 6); if (!tiny()) { q.fillStyle = '#e8c45a'; for (let i = -3; i <= 3; i++) { q.beginPath(); E(q, i * 9, -44 + Math.abs(i) * -1.5, 2, 2); q.fill(); } } },
      });
      lipRing(c, 0, -66, 38, 11, c1);
      const v2 = water > 0 && !vs.liquid && !contents.length ? Object.assign({}, vs, { liquid: '#4a2a1a' }) : vs;
      interior(c, mouth(shade(c1, -0.15), shade(c1, -0.1), { k: 0.4 }), v2, t, seed);
      c.beginPath(); E(c, 0, g.my, g.rx, g.ry); strokeIn(c, OUTLINE, LW * 0.75);
      if (water > 0 && (heat > 0 || vs.hot || boil > 0)) steamFx(c, 0, -72, 34, 0.6, t, seed);
      break;
    }
    default: {
      paint(c, potBody(80, 24, 90), c1, { dx: 8, dy: 0 });
      lipRing(c, 0, -90, 80, 24, c1);
      interior(c, mouth(shade(c1, -0.3), shade(c1, -0.15)), vs, t, seed);
    }
  }
  // steam over open pots / pans
  if (steamAmt > 0 && a.type !== 'kettle' && a.type !== 'glass' && a.type !== 'cup' && a.type !== 'caydanlik') {
    steamFx(c, g.mx, (vs.lid ? top + 8 : g.my - g.ry), g.rx * 1.1, steamAmt, t, seed);
  }
  return { mx: g.mx, my: g.my, rx: g.rx, ry: g.ry, top: Math.min(top, g.top) };
}

// Where a hand holds a vessel by its handle (at s=1, from the bottom centre),
// or null for things carried with both hands (pots with two ears, bowls, trays).
export function vesselGrip(kind) {
  const a = (typeof kind === 'string' && VESSELS[kind]) ? VESSELS[kind].art : null;
  if (!a) return null;
  switch (a.type) {
    case 'saucepan': return { x: 172, y: -72 };
    case 'pan': return a.wide || a.handles === 2 ? null : { x: 200, y: -57 };
    case 'cezve': return { x: 118, y: -90 };
    case 'kettle': return { x: 0, y: -168 };
    case 'caydanlik': return { x: 0, y: -192 };
    default: return null;
  }
}

export function drawVessel(ctx, kind, vs, x, y, s = 1, t = 0) {
  x = num(x); y = num(y); s = num(s, 1) || 1;
  const fallback = { mouthX: x, mouthY: y - 90 * s, mouthRx: 80 * s, mouthRy: 24 * s, bottomY: y, top: y - 120 * s };
  if (!ctx) return fallback;
  vs = vs && typeof vs === 'object' ? vs : {};
  const a = (typeof kind === 'string' && VESSELS[kind]) ? VESSELS[kind].art : artOf(kind);
  const prev = enter(ctx, x, y, s);
  let g;
  try { g = vesselLocal(ctx, kind, a, vs, num(t)); } catch (e) { oops('drawVessel ' + kind, e); } finally { leave(ctx, prev); }
  if (!g) return fallback;
  const out = { mouthX: x + g.mx * s, mouthY: y + g.my * s, mouthRx: g.rx * s, mouthRy: g.ry * s, bottomY: y, top: y + g.top * s };
  if (g.lower) out.lower = { mouthX: x + g.lower.mx * s, mouthY: y + g.lower.my * s, mouthRx: g.lower.rx * s, mouthRy: g.lower.ry * s };
  return out;
}

// ================================================================ tools
const STEEL = '#d9dfe6';
const WOOD = '#d8a868';
function rivet(c, x, y) { c.beginPath(); E(c, x, y, 3.6, 3.6); fs(c, '#f2e6c8', LW * 0.6); }
function handleBar(c, x, y, w, h, col, rivets) {
  paint(c, (q) => RR(q, x, y, w, h, Math.min(w, h) / 2), col, {
    dx: 0, dy: h * 0.18, hl: [x + w * 0.35, y + h * 0.3, w * 0.25, h * 0.12],
  });
  if (rivets) for (let i = 0; i < rivets; i++) rivet(c, x + w * (0.25 + 0.5 * i / Math.max(1, rivets - 1)), y + h / 2);
}
function vHandle(c, cx, y0, y1, w, col, ring) {
  paint(c, (q) => RR(q, cx - w / 2, y0, w, y1 - y0, w / 2), col, {
    dx: w * 0.25, dy: 0, hl: [cx - w * 0.18, y0 + (y1 - y0) * 0.3, w * 0.14, (y1 - y0) * 0.22],
  });
  if (!tiny()) { c.beginPath(); E(c, cx, y0 + w * 0.7, w * 0.16, w * 0.16); c.fillStyle = rgba(OUTLINE, 0.6); c.fill(); }
  if (ring) { c.beginPath(); RR(c, cx - w / 2 - 1.5, y1 - 8, w + 3, 10, 4); fs(c, ring); }
}
// Rounded stick from (x0,y0) to (x1,y1); wound clockwise like E()/RR() so unions fill solid.
function capsule(q, x0, y0, x1, y1, r) {
  const an = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(an) * r, ny = Math.cos(an) * r;
  q.moveTo(x0 - nx, y0 - ny); q.lineTo(x1 - nx, y1 - ny);
  q.arc(x1, y1, r, an - PI / 2, an + PI / 2, false);
  q.lineTo(x0 + nx, y0 + ny);
  q.arc(x0, y0, r, an + PI / 2, an + PI * 1.5, false);
  q.closePath();
}
const GLOVE = '#fffaf2', CUFF = '#e8574a';
function drawGlove(c, pressed) {
  const k = pressed ? 0.8 : 1;
  paint(c, (q) => RR(q, -31, 28, 62, 24, 10), CUFF, { dx: 0, dy: 5, hl: [-12, 34, 10, 3] });
  const fingers = [[-22, 40, -0.24], [-8, 50, -0.08], [7, 48, 0.08], [21, 38, 0.24]];
  const parts = [(q) => RR(q, -33, -24, 66, 58, 26)];
  for (const [fx, len, ang] of fingers) {
    const a2 = ang * (pressed ? 0.5 : 1), L = len * k;
    parts.push((q) => capsule(q, fx, -10, fx + Math.sin(a2) * L, -10 - Math.cos(a2) * L, 9));
  }
  parts.push((q) => capsule(q, -24, 10, pressed ? -40 : -52, pressed ? -10 : -16, 9.5));
  paintU(c, parts, GLOVE, {
    dx: 5, dy: 5, hl: [-12, -4, 12, 7, -0.3],
    detail: tiny() ? null : (q) => {
      q.strokeStyle = rgba(OUTLINE, 0.45); q.lineWidth = 2.2;
      for (const x of [-11, 0, 11]) { q.beginPath(); q.moveTo(x, 4); q.lineTo(x * 1.08, 20); q.stroke(); }
      q.lineWidth = LW * 0.8; q.strokeStyle = OUTLINE;
      for (let i = 0; i < 3; i++) {
        const a1 = fingers[i], a2 = fingers[i + 1], mx = (a1[0] + a2[0]) / 2, ma = (a1[2] + a2[2]) / 2 * (pressed ? 0.5 : 1);
        const L = Math.min(a1[1], a2[1]) * k * 0.55;
        q.beginPath(); q.moveTo(mx + Math.sin(ma) * 10, -10 - Math.cos(ma) * 10); q.lineTo(mx + Math.sin(ma) * L, -10 - Math.cos(ma) * L); q.stroke();
      }
    },
  });
}
function drawFist(c, pressed) {
  const tipI = pressed ? [3, -6] : [9, -7], tipT = pressed ? [-4, -6] : [-12, -6];
  sub(c, 36, -66, 1, () => paint(c, (q) => RR(q, -15, -46, 30, 40, 10), CUFF, { dx: 4, dy: 0, hl: [-6, -36, 4, 8] }), 0.65);
  const parts = [
    (q) => E(q, 18, -48, 30, 25, 0.45),
    (q) => E(q, 36, -30, 10, 9),
    (q) => E(q, 44, -40, 9.5, 9),
    (q) => E(q, 47, -52, 9, 8.5),
    (q) => capsule(q, 16, -34, tipI[0], tipI[1], 8),
    (q) => capsule(q, -6, -44, tipT[0], tipT[1], 8.5),
  ];
  paintU(c, parts, GLOVE, {
    dx: 5, dy: 5, hl: [10, -60, 12, 6, -0.3],
    detail: tiny() ? null : (q) => {
      q.strokeStyle = rgba(OUTLINE, 0.45); q.lineWidth = 2.2;
      q.beginPath(); q.arc(36, -30, 6, 2.2, 4); q.stroke();
      q.beginPath(); q.arc(44, -40, 6, 2.2, 4); q.stroke();
      q.beginPath(); q.moveTo(-4, -44); q.quadraticCurveTo(4, -50, 14, -46); q.stroke();
    },
  });
}
function toolLocal(c, tool, pressed) {
  switch (tool) {
    case 'knife': {
      if (pressed) c.translate(0, 3);
      sub(c, 26, -24, 1, () => {
        c.beginPath(); RR(c, -6, -14, 14, 30, 4); fs(c, shade(STEEL, -0.2));
        handleBar(c, 6, -15, 80, 28, '#d9573f', 3);
      }, -0.14);
      paint(c, (q) => { q.moveTo(24, -36); q.lineTo(-62, -36); q.quadraticCurveTo(-96, -34, -108, -18); q.quadraticCurveTo(-92, 0, -56, 0); q.lineTo(24, 0); q.closePath(); }, STEEL, {
        dx: 0, dy: 6,
        detail: (q) => { q.beginPath(); q.moveTo(-90, -9); q.quadraticCurveTo(-70, -9, -56, -9); q.lineTo(24, -9); strokeIn(q, '#f4f7fa', 4); },
        hl: [-30, -26, 30, 4],
      });
      if (!tiny()) sparkle(c, -66, -24, 7, 0.9);
      return;
    }
    case 'peeler': {
      if (pressed) c.rotate(0.12);
      tube(c, [-24, -2, -26, -22, -8, -40], shade(STEEL, -0.08), 5);
      tube(c, [24, -2, 26, -22, 8, -40], shade(STEEL, -0.08), 5);
      paint(c, (q) => RR(q, -28, -6, 56, 11, 5), STEEL, { dx: 0, dy: 3, detail: (q) => { q.beginPath(); q.moveTo(-20, -1); q.lineTo(20, -1); strokeIn(q, rgba(OUTLINE, 0.7), 1.8); } });
      vHandle(c, 0, -128, -36, 24, '#5aa83c', shade(STEEL, -0.1));
      return;
    }
    case 'grater': {
      c.beginPath(); c.moveTo(30, -75); c.lineTo(46, -84); c.lineTo(56, 66); c.lineTo(40, 75); c.closePath(); fs(c, shade(STEEL, -0.22));
      paint(c, (q) => { q.moveTo(-30, -75); q.lineTo(30, -75); q.lineTo(40, 75); q.lineTo(-40, 75); q.closePath(); }, STEEL, {
        dx: 8, dy: 0, hl: [-20, -40, 4, 26, 0.05],
        detail: tiny() ? null : (q) => {
          for (let row = 0; row < 9; row++) for (let i = -2; i <= 2; i++) {
            const y = -60 + row * 15, x = i * (12 + row * 0.6) + (row % 2) * 6 - 3;
            q.beginPath(); E(q, x, y, 4, 2.2); q.fillStyle = shade(STEEL, -0.45); q.fill();
            q.beginPath(); q.ellipse(x, y + 1.5, 4, 2.2, 0, 0.1, PI - 0.1); strokeIn(q, '#ffffff', 1.4);
          }
        },
      });
      c.beginPath(); c.moveTo(-30, -75); c.lineTo(-14, -86); c.lineTo(46, -84); c.lineTo(30, -75); c.closePath(); fs(c, shade(STEEL, 0.2));
      tube(c, [-14, -84, -12, -112, 14, -112, 16, -84], '#e8574a', 9);
      return;
    }
    case 'whisk': {
      const sq = pressed ? 0.85 : 1;
      c.save(); c.scale(pressed ? 1.12 : 1, sq);
      for (const w of [30, 20, 9, -20, -30]) {
        c.beginPath(); c.moveTo(0, -78); c.bezierCurveTo(w * 1.3, -60, w * 1.1, 0, 0, 0); c.strokeStyle = OUTLINE; c.lineWidth = 3.4 + LW * 1.3; c.stroke();
      }
      for (const w of [30, 20, 9, -20, -30]) {
        c.beginPath(); c.moveTo(0, -78); c.bezierCurveTo(w * 1.3, -60, w * 1.1, 0, 0, 0); c.strokeStyle = STEEL; c.lineWidth = 3.4; c.stroke();
      }
      c.restore();
      vHandle(c, 0, -170 * sq, -72 * sq, 22, '#f2b33a', shade(STEEL, -0.1));
      return;
    }
    case 'spoon': {
      vHandle(c, 0, -176, -20, 13, WOOD);
      paint(c, (q) => E(q, 0, 0, 22, 30), WOOD, { dx: 3, dy: 4, hl: [-8, -10, 6, 10, 0.2] });
      c.beginPath(); E(c, 1, 2, 14, 21); fs(c, shade(WOOD, -0.12), LW * 0.6);
      if (pressed && !tiny()) sparkle(c, 26, -20, 6, 0.8);
      return;
    }
    case 'ladle': {
      tube(c, [24, -8, 26, -70, 16, -150, 6, -170], STEEL, 8);
      c.beginPath(); c.arc(-2, -170, 9, 0, PI * 1.2, true); strokeIn(c, OUTLINE, 8 + LW * 1.7); c.beginPath(); c.arc(-2, -170, 9, 0, PI * 1.2, true); strokeIn(c, STEEL, 8);
      sub(c, 20, -118, 1, () => handleBar(c, -6, -26, 13, 52, '#3a7ac0'), 0.1);
      paint(c, (q) => { q.moveTo(-32, 0); q.bezierCurveTo(-32, 30, 32, 30, 32, 0); q.ellipse(0, 0, 32, 10, 0, 0, PI, true); q.closePath(); }, STEEL, { dx: 6, dy: 2, hl: [-16, 10, 8, 4] });
      c.beginPath(); E(c, 0, 0, 32, 10); fs(c, shade(STEEL, -0.3), LW * 0.85);
      return;
    }
    case 'rollingPin': {
      const sy = pressed ? 0.9 : 1;
      c.save(); c.scale(1, sy);
      for (const d of [-1, 1]) handleBar(c, d < 0 ? -124 : 84, -10, 40, 20, shade(WOOD, -0.08));
      paint(c, (q) => RR(q, -86, -19, 172, 38, 19), WOOD, {
        dx: 0, dy: 7, hl: [-30, -11, 40, 4],
        detail: tiny() ? null : (q) => { q.strokeStyle = shade(WOOD, -0.15); q.lineWidth = 1.6; for (const y of [-6, 4]) { q.beginPath(); q.moveTo(-70, y); q.bezierCurveTo(-20, y - 4, 20, y + 4, 70, y); q.stroke(); } },
      });
      c.restore();
      return;
    }
    case 'hand': drawGlove(c, pressed); return;
    case 'grab': drawFist(c, pressed); return;
    case 'brush': {
      const sp = pressed ? 1.3 : 1;
      vHandle(c, 0, -160, -48, 16, '#d9573f');
      c.beginPath(); RR(c, -15, -54, 30, 18, 4); fs(c, STEEL);
      paint(c, (q) => { q.moveTo(-14, -38); q.lineTo(14, -38); q.lineTo(16 * sp, (pressed ? -6 : 0)); q.quadraticCurveTo(0, pressed ? 0 : 4, -16 * sp, pressed ? -6 : 0); q.closePath(); }, '#f6e2b0', {
        dx: 3, dy: 0,
        detail: tiny() ? null : (q) => { q.strokeStyle = shade('#f6e2b0', -0.25); q.lineWidth = 1.4; for (let i = -3; i <= 3; i++) { q.beginPath(); q.moveTo(i * 3.6, -36); q.lineTo(i * 4.4 * sp, -3); q.stroke(); } },
      });
      return;
    }
    case 'masher': {
      const sq = pressed ? 0.88 : 1;
      c.save(); c.scale(1, sq);
      tube(c, [-36, -6, -30, -50, -8, -90], STEEL, 5);
      tube(c, [36, -6, 30, -50, 8, -90], STEEL, 5);
      const zz = [];
      for (let i = 0; i <= 8; i++) zz.push(-40 + i * 10, i % 2 ? -12 : 0);
      c.beginPath(); c.moveTo(zz[0], zz[1]); for (let i = 2; i < zz.length; i += 2) c.lineTo(zz[i], zz[i + 1]);
      c.strokeStyle = OUTLINE; c.lineWidth = 5 + LW * 1.7; c.stroke(); c.strokeStyle = STEEL; c.lineWidth = 5; c.stroke();
      c.restore();
      vHandle(c, 0, -176 * sq, -86 * sq, 22, '#3aa0a0', shade(STEEL, -0.1));
      return;
    }
    case 'tongs': {
      const o = pressed ? 2 : 12;
      for (const d of [-1, 1]) {
        tube(c, [d * 4, -170, d * (o + 6), -80, d * o, -6], STEEL, 7);
        c.beginPath(); E(c, d * o, -4, 8, 6, d * 0.3); fs(c, STEEL, LW * 0.8);
        sub(c, d * 9, -150, 1, () => handleBar(c, -6, -22, 12, 50, '#e8843a'), d * -0.1);
      }
      c.beginPath(); E(c, 0, -172, 10, 7); fs(c, shade(STEEL, -0.15));
      return;
    }
    case 'spatula': {
      if (pressed) c.rotate(-0.08);
      tube(c, [0, -46, 0, -70], STEEL, 7);
      vHandle(c, 0, -170, -64, 18, '#d9573f', shade(STEEL, -0.1));
      paint(c, (q) => { q.moveTo(-26, -52); q.lineTo(26, -52); q.lineTo(34, -4); q.quadraticCurveTo(34, 0, 30, 0); q.lineTo(-30, 0); q.quadraticCurveTo(-34, 0, -34, -4); q.closePath(); }, STEEL, {
        dx: 4, dy: 0, hl: [-16, -36, 4, 10],
        detail: tiny() ? null : (q) => { for (const x of [-12, 0, 12]) { q.beginPath(); RR(q, x - 3, -42, 6, 30, 3); q.fillStyle = shade(STEEL, -0.45); q.fill(); } },
      });
      return;
    }
    case 'blenderStick': {
      tube(c, [0, -30, 0, -112], STEEL, 16);
      paint(c, (q) => { q.moveTo(-22, 0); q.quadraticCurveTo(-24, -26, -10, -34); q.lineTo(10, -34); q.quadraticCurveTo(24, -26, 22, 0); q.closePath(); }, STEEL, { dx: 4, dy: 0, hl: [-12, -18, 3, 8] });
      c.beginPath(); c.moveTo(-14, -6); c.lineTo(14, -10); c.moveTo(-14, -10); c.lineTo(14, -6); strokeIn(c, shade(STEEL, -0.4), 3);
      paint(c, (q) => RR(q, -26, -214, 52, 110, 22), '#7cc8c0', { dx: 8, dy: 0, hl: [-12, -186, 6, 22] });
      c.beginPath(); E(c, 0, -170, 9, 9); fs(c, pressed ? '#ffd166' : '#e8574a');
      if (pressed && !tiny()) {
        c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 3;
        for (const r of [30, 38]) { c.beginPath(); c.ellipse(0, -10, r, r * 0.35, 0, 0.3, 2.6); c.stroke(); }
      }
      return;
    }
    case 'pizzaPeel': {
      sub(c, 62, 10, 1, () => {
        paint(c, (q) => RR(q, 0, -11, 130, 22, 11), WOOD, { dx: 0, dy: 5, hl: [30, -6, 30, 2.5] });
        c.beginPath(); E(c, 116, 0, 5, 5); fs(c, '#6a3a1a', LW * 0.6);
      }, 0.35);
      c.beginPath(); E(c, 0, 6, 74, 48); fs(c, shade(WOOD, -0.15));
      paint(c, (q) => E(q, 0, 0, 74, 48), WOOD, { dx: 0, dy: 0, hl: [-30, -20, 20, 6, -0.2], detail: tiny() ? null : (q) => { q.strokeStyle = shade(WOOD, -0.12); q.lineWidth = 2; for (const yy of [-24, -8, 10, 26]) { q.beginPath(); q.moveTo(-70, yy); q.bezierCurveTo(-20, yy - 4, 20, yy + 4, 70, yy); q.stroke(); } } });
      return;
    }
    case 'towel': {
      const path = (q) => { q.moveTo(-60, -30); q.quadraticCurveTo(0, -40, 60, -30); q.lineTo(64, 26); q.quadraticCurveTo(0, 36, -64, 26); q.closePath(); };
      c.save(); c.beginPath(); path(c); c.fillStyle = '#fffaf0'; c.fill(); c.clip();
      c.fillStyle = 'rgba(214,64,52,0.5)';
      for (let x = -70; x < 70; x += 20) c.fillRect(x, -50, 10, 100);
      for (let y = -46; y < 40; y += 20) c.fillRect(-70, y, 140, 10);
      c.fillStyle = SHADE; c.fillRect(-70, 10, 140, 40);
      c.restore();
      c.beginPath(); path(c); fs(c, null);
      c.beginPath(); c.moveTo(-62, -2); c.quadraticCurveTo(0, 6, 62, -2); strokeIn(c, rgba(OUTLINE, 0.6), 2.4);
      return;
    }
    case 'sponge': {
      // a kitchen sponge: yellow foam, the green scouring side on top
      if (pressed) c.translate(0, 3);
      c.beginPath(); c.roundRect(-34, -14, 68, 30, 7); fs(c, '#f6d44a');
      c.beginPath(); c.roundRect(-34, -22, 68, 12, 5); fs(c, '#4aa84a');
      c.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(-24 + i * 10, 4 + (i % 2) * 5, 2.2, 0, Math.PI * 2); c.fill(); }
      return;
    }
    default:
      c.beginPath(); E(c, 0, 0, 12, 12); fs(c, '#e8574a');
  }
}
export function drawTool(ctx, tool, x, y, s = 1, ang = 0, pressed = false) {
  if (!ctx) return;
  const prev = enter(ctx, x, y, s, num(ang));
  try { toolLocal(ctx, tool, !!pressed); } catch (e) { oops('drawTool ' + tool, e); } finally { leave(ctx, prev); }
}

// ================================================================ dishes
function bitCut(kind) {
  const a = artOf(kind);
  switch (a.type) {
    case 'round': return a.spots ? 'chunks' : a.segments ? 'wedges' : (a.tip && !a.segments) ? 'rings' : a.hollow ? 'strips' : 'dice';
    case 'long': return a.rings || a.seeds ? 'slices' : a.hollow || a.thin ? 'rings' : a.knobby ? 'mince' : 'strips';
    case 'block':
      if (a.shape === 'mince' || a.shape === 'shrimp' || a.shape === 'shell') return null;
      if (a.shape === 'log' || a.shape === 'sausage') return 'slices';
      if (a.shape === 'wedge') return 'grated';
      if (a.shape === 'strips') return 'dice';
      return a.shape === 'ball' || a.shape === 'brick' ? 'dice' : 'chunks';
    case 'mushroom': return 'slices';
    case 'egg': return 'halves';
    case 'bulb': return 'mince';
    default: return null;
  }
}
function scatterBits(c, bits, cx, cy, rx, ry, n, seed, ck, k = 1) {
  if (!bits.length) return;
  const r = rng(seed + 77);
  const list = [];
  for (let i = 0; i < n; i++) {
    const kind = bits[i % bits.length];
    const an = r() * TAU, d = Math.sqrt(r()) * 0.9;
    list.push({ kind, x: cx + Math.cos(an) * rx * d, y: cy + Math.sin(an) * ry * d, i });
  }
  list.sort((p, q) => p.y - q.y);
  for (const b of list) {
    const a = artOf(b.kind);
    const P = pal(a, { cook: ck });
    sub(c, b.x, b.y, k, () => miniPiece(c, b.kind, bitCut(b.kind), P, a, INGREDIENTS[b.kind] || {}, seed + b.i * 13, true, false));
  }
}
function garnishFx(c, g, f, seed) {
  if (!g) return;
  const r = rng(seed + 5);
  const herb = (kind) => artOf(kind);
  switch (g) {
    case 'parsley': case 'chives': {
      const a = herb(g === 'chives' ? 'chives' : 'parsley');
      for (let i = 0; i < 9; i++) {
        const an = r() * TAU, d = Math.sqrt(r()) * 0.75, x = f.cx + Math.cos(an) * f.rx * d, y = f.cy - f.lift + Math.sin(an) * f.ry * d;
        if (g === 'chives') { c.beginPath(); E(c, x, y, 3.2, 2.4); E(c, x, y, 1.3, 1); c.fillStyle = a.c1; c.fill('evenodd'); c.lineWidth = LW * 0.4; c.strokeStyle = OUTLINE; c.stroke(); }
        else { c.beginPath(); for (let k = 0; k < 3; k++) E(c, x + (k - 1) * 3, y + (k === 1 ? -2 : 0), 3, 2.6); c.fillStyle = k2col(a, i); c.fill(); c.lineWidth = LW * 0.35; c.strokeStyle = OUTLINE; c.stroke(); }
      }
      return;
    }
    case 'basil': case 'mint': {
      const a = herb(g);
      const P = pal(a, {});
      leaf(c, f.cx + f.rx * 0.15, f.cy - f.lift - 6, 30, 12, -0.6, P.c1, shade(P.c3, 0.1), g === 'mint');
      leaf(c, f.cx + f.rx * 0.18, f.cy - f.lift - 4, 26, 11, 0.4, P.c2 === P.c1 ? P.c1 : mix(P.c1, P.c2, 0.4), shade(P.c3, 0.1), g === 'mint');
      if (g === 'basil') leaf(c, f.cx + f.rx * 0.1, f.cy - f.lift - 2, 24, 10, -2.2, P.c1, shade(P.c3, 0.1), false);
      return;
    }
    case 'lemon': {
      const a = artOf('lemon'), P = pal(a, {});
      sub(c, f.cx + f.rx * 0.78, f.cy + f.ry * 0.25, 0.6, () => pWedge(c, a, P, 70, seed), -0.25);
      return;
    }
    case 'cinnamon': case 'cocoa': {
      const col = g === 'cocoa' ? '#4a2818' : '#a0582a';
      c.fillStyle = rgba(col, 0.85);
      for (let i = 0; i < (g === 'cocoa' ? 70 : 40); i++) {
        const an = r() * TAU, d = Math.sqrt(r()) * 0.8;
        c.beginPath(); E(c, f.cx + Math.cos(an) * f.rx * d, f.cy - f.lift + Math.sin(an) * f.ry * d, 1.6 + r(), 1.2 + r() * 0.6); c.fill();
      }
      if (g === 'cinnamon') { sub(c, f.cx + f.rx * 0.45, f.cy - f.lift - 4, 1, () => { c.beginPath(); RR(c, -24, -5, 48, 10, 5); fs(c, '#a0582a', LW * 0.8); c.beginPath(); E(c, 24, 0, 3, 5); fs(c, '#7a3a1a', LW * 0.6); }, -0.3); }
      return;
    }
    default: return;
  }
}
function k2col(a, i) { return i % 3 ? a.c1 : a.c2; }

function dishBase(c, base, d, t, fill) {
  switch (base) {
    case 'bowl': case 'deepPlate': case 'pan': case 'paellaPan': case 'bakingDish': case 'glass': case 'cup': {
      const vk = { bowl: 'bowl', deepPlate: 'plate', pan: 'pan', paellaPan: 'paellaPan', bakingDish: 'bakingDish', glass: 'glass', cup: 'cup' }[base];
      const g = vesselLocal(c, vk, VESSELS[vk].art, fill || {}, t);
      const deep = base === 'bowl' || base === 'glass' || base === 'cup';
      if (base === 'bakingDish') return { cx: 0, cy: -86, rx: 92, ry: 22, lift: 0 };
      return { cx: g.mx, cy: g.my + (deep ? g.ry * 0.25 : 0), rx: g.rx * (base === 'deepPlate' ? 1 : 0.92), ry: g.ry * 0.92, lift: 0, top: g.top };
    }
    case 'board': {
      c.beginPath(); RR(c, -112, -84, 224, 84, 18); fs(c, shade(WOOD, -0.18));
      sub(c, 104, -50, 1, () => { c.beginPath(); RR(c, -6, -12, 34, 24, 12); E(c, 18, 0, 5, 5); c.fillStyle = WOOD; c.fill('evenodd'); c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke(); });
      paint(c, (q) => RR(q, -112, -92, 224, 82, 18), WOOD, { dx: 0, dy: 0, hl: [-70, -82, 30, 4], detail: tiny() ? null : (q) => { q.strokeStyle = shade(WOOD, -0.1); q.lineWidth = 1.8; for (const yy of [-74, -56, -36, -22]) { q.beginPath(); q.moveTo(-100, yy); q.bezierCurveTo(-30, yy - 4, 30, yy + 4, 100, yy); q.stroke(); } } });
      return { cx: 0, cy: -50, rx: 88, ry: 28, lift: 0 };
    }
    case 'pizzaBoard': {
      sub(c, 104, -52, 1, () => { c.beginPath(); RR(c, -10, -12, 40, 24, 12); E(c, 18, 0, 5, 5); c.fillStyle = WOOD; c.fill('evenodd'); c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke(); });
      c.beginPath(); E(c, 0, -48, 112, 48); fs(c, shade(WOOD, -0.18));
      paint(c, (q) => E(q, 0, -56, 112, 50), WOOD, { dx: 0, dy: 0, hl: [-60, -84, 26, 5, -0.2] });
      return { cx: 0, cy: -56, rx: 96, ry: 42, lift: 0 };
    }
    case 'skewers': {
      c.beginPath(); E(c, 0, -34, 120, 34); fs(c, shade('#ffffff', -0.1));
      paint(c, (q) => E(q, 0, -40, 122, 36), '#ffffff', { dx: 0, dy: 0, hl: [-70, -58, 24, 4, -0.15] });
      c.beginPath(); E(c, 0, -40, 112, 31); strokeIn(c, '#d8603a', 3);
      return { cx: 0, cy: -40, rx: 96, ry: 24, lift: 0 };
    }
    default: {
      const g = vesselLocal(c, 'plate', VESSELS.plate.art, fill || {}, t);
      return { cx: g.mx, cy: g.my, rx: 80, ry: 26, lift: 0 };
    }
  }
}
const DISH_COL = {
  rice: '#fbf7ec', soup: '#e8a04a', stew: '#b8542e', pasta: '#d8452e', pizza: '#d8452e', omelette: '#f4cf5a', scramble: '#f6d65a',
  curry: '#e0a030', pudding: '#f6ecd0', drink: '#b5481a', crepes: '#f0d08a', toast: '#e2a852', tortilla: '#f2c25a', pie: '#e2a852',
  layers: '#f8ecd0', rolls: '#8fb86a', chips: '#f2c45a', flatbread: '#e8b860', boat: '#c8452e', stuffedEggplant: '#c8452e', eggHalves: '#f6c84a',
};
function dishLocal(c, d, t) {
  const base = d.base || 'plate';
  const main = d.main || 'rice';
  const col = d.color || DISH_COL[main] || '#e0a050';
  const col2 = d.color2 || null;
  const bits = Array.isArray(d.bits) ? d.bits.filter((k) => typeof k === 'string' && k) : [];
  const seed = hash(main + base + col + bits.join());
  const BS = { plate: 1, bowl: 1.12, deepPlate: 1, paellaPan: 0.74, glass: 1.45, cup: 1.35, board: 1, bakingDish: 0.95, pizzaBoard: 1, pan: 0.86, skewers: 1 }[base] || 1;
  const liquidMain = main === 'soup' || main === 'stew' || main === 'curry' || main === 'pudding' || main === 'drink';
  const deepBase = base === 'bowl' || base === 'deepPlate' || base === 'glass' || base === 'cup' || base === 'pan' || base === 'paellaPan';
  sub(c, 0, 0, BS, () => {
    let fill = null;
    if (liquidMain && deepBase) {
      const cont = main === 'pudding' || main === 'drink' ? [] : bits.map((k) => ({ kind: k, cut: bitCut(k) }));
      fill = { water: base === 'glass' || base === 'cup' ? 0.82 : 0.86, liquid: col, contents: cont, cook: main === 'stew' ? 0.2 : 0, hot: !!d.steam };
    } else if (main === 'scramble' && (base === 'pan' || base === 'bowl')) fill = {};
    const f = dishBase(c, base, d, t, fill);
    if (base === 'bakingDish') { c.save(); c.beginPath(); c.rect(-400, -600, 800, 600 - 58); c.clip(); }
    drawMain(c, main, f, d, col, col2, bits, t, seed, base, liquidMain && deepBase);
    if (base === 'bakingDish') c.restore();
    garnishFx(c, d.garnish, f, seed);
    if (d.steam && base !== 'glass' && base !== 'cup') steamFx(c, f.cx, f.cy - f.ry - 18, f.rx, 0.7, t, seed);
  });
}
function drawMain(c, main, f, d, col, col2, bits, t, seed, base, inVessel) {
  const r = rng(seed);
  const cx = f.cx, cy = f.cy;
  switch (main) {
    case 'soup': case 'stew': case 'curry': case 'drink': case 'pudding': {
      if (!inVessel) {
        if (main === 'curry') {
          moundFood(c, cx - f.rx * 0.42, cy + 4, 44, 30, '#fbf7ec', seed, 'rice');
          const p = blobPts(cx + f.rx * 0.32, cy, f.rx * 0.5, f.ry * 0.75, 12, 0.08, seed);
          paint(c, (q) => smoothClosed(q, p), col, { dx: 0, dy: 3, hl: [cx + f.rx * 0.2, cy - f.ry * 0.3, 14, 4] });
          scatterBits(c, bits, cx + f.rx * 0.32, cy, f.rx * 0.4, f.ry * 0.5, 8, seed, 0.3);
        } else {
          const p = blobPts(cx, cy, f.rx * 0.8, f.ry * 0.75, 14, 0.05, seed);
          paint(c, (q) => smoothClosed(q, p), col, { dx: 0, dy: 3, hl: [cx - f.rx * 0.3, cy - f.ry * 0.3, 16, 4] });
          scatterBits(c, bits, cx, cy, f.rx * 0.6, f.ry * 0.5, 8, seed, 0.2);
        }
      }
      if (main === 'pudding') {
        c.strokeStyle = rgba(shade(col, -0.2), 0.6); c.lineWidth = 2.2;
        for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(cx + (i - 1) * 14, cy - 2 + (i % 2) * 4, 16, 4, 0, PI * 1.1, PI * 1.8); c.stroke(); }
        scatterBits(c, bits, cx, cy, f.rx * 0.5, f.ry * 0.4, 5, seed, 0);
      }
      if (col2 && main !== 'drink') {
        c.beginPath();
        for (let i = 0; i <= 24; i++) { const an = i * 0.55, rr = 2 + i * 1.1; const x = cx + Math.cos(an) * rr, y = cy - 2 + Math.sin(an) * rr * 0.35; if (!i) c.moveTo(x, y); else c.lineTo(x, y); }
        c.strokeStyle = col2; c.lineWidth = 3.4; c.stroke();
      }
      if (main === 'soup' && d.garnish !== 'lemon') garnishFx(c, 'lemon', f, seed);
      if (main === 'drink' && bits.length) scatterBits(c, bits, cx, cy, f.rx * 0.5, f.ry * 0.4, 2, seed, 0);
      return;
    }
    case 'rice': {
      if (base === 'paellaPan' || base === 'pan' || base === 'bakingDish') {
        paint(c, (q) => E(q, cx, cy, f.rx * 0.97, f.ry * 0.94), col, {
          dx: 0, dy: -4, hl: [cx - f.rx * 0.4, cy - f.ry * 0.4, f.rx * 0.2, f.ry * 0.15],
          detail: tiny() ? null : (q) => { for (let i = 0; i < 70; i++) { const an = r() * TAU, dd = Math.sqrt(r()) * 0.95; q.beginPath(); E(q, cx + Math.cos(an) * f.rx * dd, cy + Math.sin(an) * f.ry * dd, 3.6, 1.6, r() * 3); q.fillStyle = r() < 0.5 ? shade(col, 0.3) : shade(col, -0.1); q.fill(); } },
        });
        scatterBits(c, bits, cx, cy, f.rx * 0.8, f.ry * 0.7, 14, seed, 0.3, 1.1);
        return;
      }
      moundFood(c, cx, cy + f.ry * 0.3, f.rx * 0.95, 42, col, seed, 'rice');
      scatterBits(c, bits, cx, cy - 16, f.rx * 0.6, 12, 9, seed, 0.2);
      f.lift = 22;
      return;
    }
    case 'eggHalves': {
      const a = artOf('egg'), P = pal(a, {});
      P.boiled = true; P.c3 = col;
      const pos = [[-0.6, -0.25], [0, -0.55], [0.6, -0.25], [-0.32, 0.45], [0.32, 0.45]];
      for (const [px, py] of pos) {
        sub(c, cx + px * f.rx, cy + py * f.ry + 16, 0.92, () => {
          pHalf(c, a, P, seed, 58);
          if (!tiny()) { c.fillStyle = col2 || '#d0401e'; for (let i = 0; i < 4; i++) { c.beginPath(); E(c, (r() - 0.5) * 16, -16 - r() * 6, 1.6, 1.3); c.fill(); } }
        });
      }
      scatterBits(c, bits, cx, cy + 4, f.rx * 0.2, f.ry * 0.2, 2, seed, 0);
      return;
    }
    case 'omelette': {
      const path = (q) => { q.moveTo(cx - f.rx * 0.95, cy - 6); q.bezierCurveTo(cx - f.rx * 0.9, cy + f.ry * 1.25, cx + f.rx * 0.9, cy + f.ry * 1.25, cx + f.rx * 0.95, cy - 6); q.quadraticCurveTo(cx, cy - f.ry * 0.9, cx - f.rx * 0.95, cy - 6); q.closePath(); };
      scatterBits(c, bits, cx, cy - f.ry * 0.35, f.rx * 0.7, 5, 6, seed, 0.3);
      paint(c, path, col, {
        dx: 0, dy: 5, hl: [cx - f.rx * 0.4, cy + 2, 18, 4, 0.1],
        detail: (q) => { q.fillStyle = rgba('#c8862a', 0.5); for (let i = 0; i < 10; i++) { q.beginPath(); E(q, cx + (r() - 0.5) * f.rx * 1.5, cy + r() * f.ry * 0.8, 4 + r() * 3, 2 + r() * 1.5); q.fill(); } },
      });
      f.lift = 4;
      return;
    }
    case 'scramble': {
      const n = 18;
      const curds = [];
      const lay = blobPts(cx, cy, f.rx * 0.85, f.ry * 0.8, 14, 0.08, seed);
      paint(c, (q) => smoothClosed(q, lay), shade(col, -0.05), { dx: 0, dy: 3 });
      for (let i = 0; i < n; i++) { const an = r() * TAU, dd = Math.sqrt(r()) * 0.78; curds.push([cx + Math.cos(an) * f.rx * dd, cy + Math.sin(an) * f.ry * dd]); }
      curds.sort((p, q) => p[1] - q[1]);
      const mixed = bits.slice();
      curds.forEach((p, i) => {
        if (mixed.length && i % 3 === 1) scatterBits(c, [mixed[i % mixed.length]], p[0], p[1] - 3, 4, 2, 1, seed + i, 0.3);
        const bp = blobPts(p[0], p[1] - 4, 17, 11, 7, 0.25, seed + i);
        paint(c, (q) => smoothClosed(q, bp), i % 4 ? col : shade(col, 0.15), { dx: 2, dy: 3, lw: LW * 0.8, hl: [p[0] - 4, p[1] - 8, 4, 2] });
      });
      f.lift = 6;
      return;
    }
    case 'pasta': {
      const pastaCol = col2 && col2 !== col ? col2 : '#f3d48a';
      moundFood(c, cx, cy + f.ry * 0.3, f.rx * 0.9, 38, pastaCol, seed, 'pasta');
      const p = blobPts(cx, cy - 20, f.rx * 0.48, f.ry * 0.55, 10, 0.12, seed);
      if (col !== pastaCol) paint(c, (q) => smoothClosed(q, p), col, { dx: 0, dy: 3, hl: [cx - 12, cy - 26, 9, 3] });
      scatterBits(c, bits, cx, cy - 20, f.rx * 0.4, 8, 6, seed, 0.3);
      c.fillStyle = '#fbf3d8';
      for (let i = 0; i < 12; i++) { c.beginPath(); E(c, cx + (r() - 0.5) * f.rx * 0.9, cy - 20 + (r() - 0.5) * 16, 2.2, 1.2, r() * 3); c.fill(); }
      f.lift = 22;
      return;
    }
    case 'pizza': case 'flatbread': case 'boat': {
      const form = main === 'boat' ? 'boat' : main === 'flatbread' ? (base === 'board' ? 'oval' : 'round') : 'round';
      const tops = [];
      const kinds = bits.slice();
      if (main === 'pizza' && !kinds.includes('mozzarella')) kinds.unshift('mozzarella');
      const n = Math.min(16, Math.max(6, kinds.length * 4));
      for (let i = 0; i < n; i++) {
        let x, y, ok = false;
        for (let tr = 0; tr < 8 && !ok; tr++) { const an = r() * TAU, dd = Math.sqrt(r()) * 0.88; x = Math.cos(an) * dd; y = Math.sin(an) * dd; ok = tops.every((q) => (q.x - x) ** 2 + (q.y - y) ** 2 > 0.09); }
        tops.push({ kind: kinds[i % kinds.length], x, y });
      }
      const st = { shape: 'flat', size: 1, form, sauce: main === 'flatbread' && !d.color ? null : col, coverage: main === 'flatbread' ? 0.9 : 1, toppings: kinds.length ? tops : [], cook: 0.85 };
      const g = doughFlatGeom(st);
      const fit = Math.min(1, (f.rx * 2.25) / (g.rx * 2 + 12));
      const P = pal(INGREDIENTS.dough.art, st);
      sub(c, cx, cy + (g.th + g.ry) * fit, fit, () => drawDough(c, 'dough', INGREDIENTS.dough.art, P, st, t, seed));
      if (main === 'pizza' && !tiny()) {
        c.strokeStyle = rgba(OUTLINE, 0.35); c.lineWidth = 2;
        for (const an of [0.35, 1.4, 2.5]) { c.beginPath(); c.moveTo(cx - Math.cos(an) * g.rx * fit * 0.95, cy - Math.sin(an) * g.ry * fit * 0.95); c.lineTo(cx + Math.cos(an) * g.rx * fit * 0.95, cy + Math.sin(an) * g.ry * fit * 0.95); c.stroke(); }
      }
      return;
    }
    case 'rolls': {
      const P = { c1: col, c2: shade(col, 0.3), c3: shade(col, -0.2) };
      for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
        sarma(c, cx + (i - 1.5) * 34 + row * 10 - 8, cy - 8 + row * 20, 52, P, -1.35 + (i % 2) * 0.08, col2 || '#c8643a');
      }
      sub(c, cx + f.rx * 0.82, cy + 10, 0.45, () => pSlice(c, artOf('lemon'), pal(artOf('lemon'), {}), 22, 20, seed));
      return;
    }
    case 'tortilla': {
      const R = f.rx * 0.78, Ry = R * 0.42, H = 20;
      paint(c, (q) => { q.moveTo(cx - R, cy - H); q.lineTo(cx - R, cy); q.ellipse(cx, cy, R, Ry, 0, PI, 0, true); q.lineTo(cx + R, cy - H); q.ellipse(cx, cy - H, R, Ry, 0, 0, PI, false); q.closePath(); }, shade(col, -0.08), { dx: 6, dy: 0 });
      paint(c, (q) => E(q, cx, cy - H, R, Ry), col, { dx: 0, dy: 0, hl: [cx - R * 0.4, cy - H - Ry * 0.4, 16, 4], detail: (q) => { q.fillStyle = rgba('#b8742a', 0.45); for (let i = 0; i < 12; i++) { q.beginPath(); E(q, cx + (r() - 0.5) * R * 1.5, cy - H + (r() - 0.5) * Ry * 1.4, 5 + r() * 4, 2 + r() * 2); q.fill(); } } });
      // a slice pulled out showing the potato layers
      sub(c, cx + R * 0.55, cy + Ry * 0.9, 1, () => {
        const w = 46;
        paint(c, (q) => { q.moveTo(-w / 2, -H); q.lineTo(w / 2, -H - 4); q.lineTo(w / 2, -4); q.lineTo(-w / 2, 0); q.closePath(); }, mix(col, '#fbe8a8', 0.5), {
          dx: 0, dy: 0, detail: (q) => { q.strokeStyle = shade(col, -0.1); q.lineWidth = 2; for (const y of [-14, -8]) { q.beginPath(); q.moveTo(-w / 2, y); q.quadraticCurveTo(0, y - 3, w / 2, y - 2); q.stroke(); } q.fillStyle = shade(col, -0.15); q.fillRect(-w / 2, -H - 4, w, 4); },
        });
      }, 0.1);
      f.lift = H;
      return;
    }
    case 'crepes': {
      const fill = col2 || '#6a3a2a';
      for (let i = 0; i < 3; i++) {
        sub(c, cx + (i - 1) * 46, cy + (i === 1 ? -8 : 4), 1, () => {
          const path = (q) => { q.moveTo(-34, 10); q.lineTo(30, 10); q.quadraticCurveTo(34, -22, 0, -34); q.quadraticCurveTo(-20, -14, -34, 10); q.closePath(); };
          c.beginPath(); E(c, -10, 8, 16, 5); fs(c, fill, LW * 0.7);
          paint(c, path, col, { dx: 2, dy: 4, hl: [-6, -14, 6, 4, -0.5], detail: (q) => { q.fillStyle = rgba('#b8742a', 0.4); for (let k = 0; k < 6; k++) { q.beginPath(); E(q, (r() - 0.5) * 50, -r() * 30 + 6, 3, 2); q.fill(); } } });
        }, (i - 1) * 0.25);
      }
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 30; i++) { c.beginPath(); E(c, cx + (r() - 0.5) * f.rx * 1.6, cy - 20 + (r() - 0.5) * 24, 1.4, 1.2); c.fill(); }
      scatterBits(c, bits, cx, cy + 16, f.rx * 0.6, 6, 4, seed, 0);
      f.lift = 14;
      return;
    }
    case 'toast': {
      const loaf = artOf('bread');
      const P = pal(loaf, { cook: 0.6 });
      for (let i = 0; i < 2; i++) {
        sub(c, cx + (i ? 28 : -26), cy + (i ? 6 : -6), 1, () => {
          slab(c, loaf, P, 70, 62, seed + i);
          if (col2) { const p = blobPts(0, 0, 24, 18, 9, 0.12, seed + i); c.beginPath(); smoothClosed(c, p); fs(c, col2, LW * 0.7); }
          scatterBits(c, bits, 0, -2, 18, 12, 4, seed + i * 7, 0.2);
        }, i ? 0.12 : -0.15);
      }
      return;
    }
    case 'pie': {
      const R = f.rx * 0.8, Ry = Math.max(f.ry * 1.1, R * 0.45);
      c.beginPath(); E(c, cx, cy + 6, R + 6, Ry + 4); fs(c, shade(col, -0.2));
      paint(c, (q) => E(q, cx, cy, R, Ry), col2 || col, { dx: 0, dy: 4 });
      if (col2) {
        c.save(); c.beginPath(); E(c, cx, cy, R * 0.9, Ry * 0.9); c.clip();
        for (let i = -2; i <= 2; i++) { c.beginPath(); RR(c, cx - R, cy + i * Ry * 0.36 - 5, R * 2, 10, 5); fs(c, col, LW * 0.7); }
        for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(cx + i * R * 0.27 - 6, cy - Ry); c.lineTo(cx + i * R * 0.27 + 6, cy - Ry); c.lineTo(cx + i * R * 0.3 + 6, cy + Ry); c.lineTo(cx + i * R * 0.3 - 6, cy + Ry); c.closePath(); fs(c, shade(col, 0.06), LW * 0.7); }
        c.restore();
      } else {
        paint(c, (q) => E(q, cx, cy - 4, R * 0.92, Ry * 0.86), col, { dx: 0, dy: 4, hl: [cx - R * 0.4, cy - Ry * 0.4, 18, 5] });
        for (const an of [0, 1.2, 2.4, 3.6, 4.8]) { c.beginPath(); c.moveTo(cx + Math.cos(an) * R * 0.2, cy - 4 + Math.sin(an) * Ry * 0.2); c.lineTo(cx + Math.cos(an) * R * 0.45, cy - 4 + Math.sin(an) * Ry * 0.45); strokeIn(c, shade(col, -0.4), 3); }
      }
      c.beginPath();
      for (let i = 0; i < 28; i++) { const an = (i / 28) * TAU; E(c, cx + Math.cos(an) * R * 0.98, cy + Math.sin(an) * Ry * 0.96, 7, 4.5, an); }
      fs(c, shade(col, 0.05), LW * 0.7);
      f.lift = 4;
      return;
    }
    case 'stuffedEggplant': {
      const a = artOf('eggplant');
      const P = pal(a, { cook: 0.55 });
      const n = 3;
      for (let i = 0; i < n; i++) {
        sub(c, cx + (i - 1) * 20 - 6, cy + 12 + i * 10, 0.7, () => {
          drawSlit(c, a, P, { filling: col }, t, seed + i, 1);
          if (!tiny()) { sub(c, 6, -40, 0.35, () => xsec(c, artOf('tomato'), pal(artOf('tomato'), { cook: 0.3 }), 22, 15, seed)); sub(c, 36, -42, 0.5, () => pRing(c, artOf('greenPepper'), pal(artOf('greenPepper'), {}), 12, 8, seed, i)); }
        }, -0.1);
      }
      scatterBits(c, bits, cx, cy + 8, f.rx * 0.6, f.ry * 0.5, 4, seed, 0.3);
      f.lift = -6;
      return;
    }
    case 'skewers': {
      const kinds = bits.length ? bits : ['meat', 'redPepper', 'onion', 'meat'];
      for (let sIdx = 0; sIdx < 2; sIdx++) {
        sub(c, cx + sIdx * 8, cy - 10 + sIdx * 22, 0.8, () => {
          c.beginPath(); E(c, -128, 0, 9, 9); E(c, -128, 0, 4, 4); c.fillStyle = '#8a8f99'; c.fill('evenodd'); c.lineWidth = LW; c.strokeStyle = OUTLINE; c.stroke();
          c.beginPath(); c.moveTo(-119, 0); c.lineTo(132, 0); c.strokeStyle = OUTLINE; c.lineWidth = 4 + LW * 1.6; c.stroke(); c.strokeStyle = STEEL; c.lineWidth = 4; c.stroke();
          for (let i = 0; i < 7; i++) {
            const kind = kinds[(i + sIdx) % kinds.length], a = artOf(kind);
            sub(c, -96 + i * 31, 6, 1.5, () => miniPiece(c, kind, bitCut(kind) === 'rings' || bitCut(kind) === 'slices' ? 'chunks' : (bitCut(kind) || 'chunks'), pal(a, { cook: 0.75 }), a, INGREDIENTS[kind] || {}, seed + i, false, false));
          }
        }, -0.08);
      }
      return;
    }
    case 'chips': {
      if (bits.includes('fish')) {
        sub(c, cx - f.rx * 0.35, cy + 10, 0.62, () => drawBlock(c, artOf('fish'), { c1: '#e8a848', c2: '#f6d690', c3: '#c8862a', ck: 1 }, {}, t, seed), -0.15);
      }
      const r2 = rng(seed + 1);
      for (let i = 0; i < 12; i++) {
        sub(c, cx + (bits.includes('fish') ? f.rx * 0.32 : 0) + (r2() - 0.5) * 50, cy - 4 - Math.floor(i / 4) * 8 + (r2() - 0.5) * 6, 1, () => stick(c, 64, 11, col, shade(col, -0.18)), (r2() - 0.5) * 1.1);
      }
      if (col2) { sub(c, cx + f.rx * 0.82, cy + 10, 1, () => { c.beginPath(); E(c, 0, 0, 22, 9); c.lineTo(22, 6); fs(c, '#ffffff'); c.beginPath(); E(c, 0, -1, 17, 6); fs(c, col2, LW * 0.7); }); }
      f.lift = 10;
      return;
    }
    case 'layers': {
      const cream = col, sponge = col2 || '#b98a5a';
      for (let i = 0; i < 2; i++) {
        sub(c, cx + (i ? 34 : -38), cy + (i ? 14 : -2), 1, () => {
          const W = 58, H = 46, D = 16;
          c.beginPath(); c.moveTo(W / 2, -H); c.lineTo(W / 2 + D, -H - D * 0.7); c.lineTo(W / 2 + D, -D * 0.7); c.lineTo(W / 2, 0); c.closePath(); fs(c, shade(cream, -0.15));
          c.beginPath(); c.moveTo(-W / 2, -H); c.lineTo(-W / 2 + D, -H - D * 0.7); c.lineTo(W / 2 + D, -H - D * 0.7); c.lineTo(W / 2, -H); c.closePath(); fs(c, '#5a3020');
          if (!tiny()) { c.fillStyle = '#3a1e12'; for (let k = 0; k < 14; k++) { c.beginPath(); E(c, -W / 2 + 6 + r() * (W + D - 12), -H - r() * D * 0.6, 1.4, 1); c.fill(); } }
          paint(c, (q) => RR(q, -W / 2, -H, W, H, 3), cream, {
            dx: 0, dy: 0,
            detail: (q) => { q.fillStyle = sponge; for (const y of [-H + 14, -H + 32]) q.fillRect(-W / 2 - 2, y, W + 4, 9); q.fillStyle = '#5a3020'; q.fillRect(-W / 2 - 2, -H - 2, W + 4, 4); },
          });
        });
      }
      return;
    }
    case 'breakfast': {
      const items = bits.length ? bits : ['egg', 'bacon', 'bakedBeans', 'sausage', 'bread', 'tomato', 'mushroom'];
      const slots = [[-0.55, -0.35], [0.5, -0.4], [-0.05, -0.5], [0.6, 0.25], [-0.6, 0.3], [0.05, 0.45], [0.05, -0.05]];
      const order = items.map((k, i) => ({ k, s: slots[i % slots.length] })).sort((p, q) => p.s[1] - q.s[1]);
      for (const it of order) {
        const x = cx + it.s[0] * f.rx * 1.05, y = cy + it.s[1] * f.ry * 1.3;
        const a = artOf(it.k);
        const P = pal(a, { cook: 0.6 });
        if (it.k === 'egg') sub(c, x, y + 10, 0.62, () => drawFriedEgg(c, pal(a, {}), 0.6, seed, false));
        else if (it.k === 'bakedBeans' || it.k === 'beans') { for (let i = 0; i < 9; i++) bead(c, x + (i % 3 - 1) * 8 + (Math.floor(i / 3) % 2) * 4, y - Math.floor(i / 3) * 5, 5, 3.6, '#d8682a'); }
        else if (a.type === 'block' && a.shape === 'strips') sub(c, x, y + 12, 0.38, () => drawBlock(c, a, P, {}, t, seed), 0.1);
        else if (a.type === 'block' && a.shape === 'sausage') sub(c, x, y + 4, 1, () => { paint(c, (q) => RR(q, -30, -8, 60, 16, 8), P.c1, { dx: 0, dy: 3, hl: [-8, -5, 12, 2] }); }, -0.2);
        else if (a.type === 'block' && a.shape === 'loaf') sub(c, x, y + 4, 0.55, () => slab(c, a, pal(a, { cook: 0.5 }), 70, 62, seed), -0.4);
        else if (it.k === 'tomato') sub(c, x, y + 10, 0.42, () => pHalf(c, a, pal(a, { cook: 0.3 }), seed, 90));
        else if (it.k === 'mushroom') { for (let i = 0; i < 3; i++) sub(c, x + (i - 1) * 12, y + (i % 2) * 4, 1, () => mushSlice(c, P, 22), (i - 1) * 0.3); }
        else sub(c, x, y, 1.2, () => miniPiece(c, it.k, bitCut(it.k), P, a, INGREDIENTS[it.k] || {}, seed, true, false));
      }
      return;
    }
    default: {
      moundFood(c, cx, cy + f.ry * 0.3, f.rx * 0.8, 34, col, seed, 'plain');
      scatterBits(c, bits, cx, cy - 14, f.rx * 0.5, 10, 7, seed, 0.2);
      f.lift = 16;
    }
  }
}
function domePath(W, H) {
  const ry = W * 0.26;
  return (q) => {
    q.moveTo(-W, 0);
    q.bezierCurveTo(-W, -H * 0.62, -W * 0.55, -H, 0, -H);
    q.bezierCurveTo(W * 0.55, -H, W, -H * 0.62, W, 0);
    q.ellipse(0, 0, W, ry, 0, 0, PI, false);
    q.closePath();
  };
}
function moundFood(c, x, y, W, H, col, seed, kind) {
  const r = rng(seed + 9);
  sub(c, x, y, 1, () => paint(c, domePath(W, H), col, {
    dx: W * 0.08, dy: H * 0.12, hl: [-W * 0.35, -H * 0.65, W * 0.18, H * 0.12, -0.3],
    detail: tiny() ? null : (q) => {
      if (kind === 'rice') {
        for (let i = 0; i < 56; i++) {
          const xx = (r() - 0.5) * 2 * W * 0.92, top = -H * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(xx) / W, 2.2)));
          q.beginPath(); E(q, xx, lerp(top + 3, W * 0.22, r()), 4.6, 2, (r() - 0.5) * 2.4);
          q.fillStyle = r() < 0.5 ? '#ffffff' : shade(col, -0.06); q.fill(); q.lineWidth = 1; q.strokeStyle = shade(col, -0.32); q.stroke();
        }
      } else if (kind === 'pasta') {
        for (let i = 0; i < 16; i++) {
          const yy = -H * (0.08 + 0.85 * (i / 16)), w = W * Math.sqrt(Math.max(0, 1 - Math.pow(i / 16, 1.2))) * 0.92;
          q.beginPath(); q.moveTo(-w, yy + 2); q.bezierCurveTo(-w * 0.4, yy - 8, w * 0.2, yy + 8, w, yy - 2);
          q.strokeStyle = shade(col, -0.22); q.lineWidth = 1.8; q.stroke();
        }
      }
    },
  }));
}
export function drawDish(ctx, dish, x, y, s = 1, t = 0) {
  if (!ctx) return;
  const prev = enter(ctx, x, y, s);
  try { dishLocal(ctx, dish && typeof dish === 'object' ? dish : {}, num(t)); } catch (e) { oops('drawDish ' + (dish && dish.main), e); } finally { leave(ctx, prev); }
}

// (the 3D food of first person – food3d.js – is built from the same descriptors and state rules)
export { artOf, pal as artPal, normCut, sizeArt, defaultCount, pieceCol, roundDims, tubeOf, BLOCK_SIZE, MEATY, mix as mixHex, doughFlatGeom, hash as artHash };
