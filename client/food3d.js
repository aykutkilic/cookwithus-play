// The food in 3D, for first person (the room view keeps art.js's cartoon
// standees). Built from the same `art` descriptors in shared/ingredients.js
// and the same state rules as art.js: a generator per art.type (round, long,
// egg, herb, block, bottle …) parameterised by c1/c2/c3 and the flags; and
// the state – qty, washed (glossy), peeled, cook (colours), cut + k/n (the
// whole shrinking as pieces pile up beside it), cracked / beaten eggs, dough
// (ball / flat, sauce, toppings), leaf rolls, a head's leaves.
//
// buildFood(kind, st) → a THREE.Group: its origin is the middle of its
// bottom, +y up, its length along x. st.spread (a radius): in a pot or pan –
// the pieces scattered over its floor, slices lying flat, eggs cracked across it.
// st.box ([w, d], inside): in a food container – several side by side in a
// grid, pieces scattered over its floor (see boxedFood). Sizes are art.js's px × FOOD_K (an egg
// is 80 px tall: 6 cm-ish next to the cook's hand).
import * as THREE from 'three';
import { artOf, artPal, normCut, sizeArt, defaultCount, pieceCol, roundDims, tubeOf, BLOCK_SIZE, mixHex, doughFlatGeom, artHash } from './art.js';
import { ingName, PACKED } from '../shared/ingredients.js';
import { consolidate } from './parts3d.js';

export const FOOD_K = 0.00075;
const K = FOOD_K;
const TAU = Math.PI * 2;
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

// ------------------------------------------------------------------ shared parts
const MATS = new Map();
function fm(color, o = {}) {
  const key = `${color}|${o.rough ?? 0.62}|${o.metal || 0}|${o.opacity ?? 1}|${o.emissive || ''}|${o.side || 0}`;
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.62, metalness: o.metal || 0, side: o.side || THREE.FrontSide });
    if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = 0.25; }
    MATS.set(key, m);
  }
  return m;
}
const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  sphereLo: new THREE.SphereGeometry(1, 10, 7),
  hemi: new THREE.SphereGeometry(1, 18, 9, 0, TAU, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 18),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  disc: new THREE.CircleGeometry(1, 20),
  torus: new THREE.TorusGeometry(1, 0.28, 8, 18),
  caps: new THREE.CapsuleGeometry(0.5, 1, 4, 10), // (y: -1 … 1, radius 0.5)
  tube: new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), // (open at both ends: a ring cut off a pepper)
  annulus: new THREE.RingGeometry(0.8, 1, 24),
};
function part(g, geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy ?? sx, sz ?? sx);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  g.add(m);
  return m;
}
// a rounded box (soft-cornered blocks: butter, bread, meat)
const RBOX = new Map();
function rbox(w, h, d, r) {
  const key = [w, h, d, r].map((n) => n.toFixed(4)).join('|');
  let geo = RBOX.get(key);
  if (!geo) {
    const s = new THREE.Shape();
    const x0 = -w / 2, y0 = 0, rr = Math.min(r, w / 2, h / 2);
    s.moveTo(x0 + rr, y0); s.lineTo(x0 + w - rr, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rr);
    s.lineTo(x0 + w, y0 + h - rr); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
    s.lineTo(x0 + rr, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
    s.lineTo(x0, y0 + rr); s.quadraticCurveTo(x0, y0, x0 + rr, y0);
    geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0001, d - 2 * rr), bevelEnabled: true, bevelThickness: rr, bevelSize: rr * 0.6, bevelSegments: 3, curveSegments: 6 });
    geo.translate(0, 0, -(d - 2 * rr) / 2);
    RBOX.set(key, geo);
  }
  return geo;
}
// a tube along a centre line with a radius at each point (long vegetables, sausages, rolls…)
function tubeGeo(pts, radii, flat = 1, seg = 12, a0 = 0, a1 = TAU) { // (a0 … a1: only that much of the way round)
  const n = pts.length;
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const t = (i < n - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    const nrm = Math.abs(t.y) > 0.9 ? v(1, 0, 0) : v(0, 1, 0);
    const b1 = new THREE.Vector3().crossVectors(t, nrm).normalize(), b2 = new THREE.Vector3().crossVectors(b1, t).normalize();
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (j / seg) * (a1 - a0);
      const q = p.clone().addScaledVector(b1, Math.cos(a) * radii[i] * flat).addScaledVector(b2, Math.sin(a) * radii[i]);
      pos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
const RIM = new THREE.TorusGeometry(1, 0.07, 8, 32);
function lathe(profile, seg = 18) { return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg); }

// ------------------------------------------------------------------ the food
const CACHE = new Map();
export function foodKey(kind, st) {
  return `${typeof kind === 'string' ? kind : JSON.stringify(kind)}|${st ? JSON.stringify(st, ['qty', 'washed', 'peeled', 'cut', 'k', 'n', 'cook', 'shape', 'size', 'form', 'sauce', 'coverage', 'toppings', 'x', 'y', 'kind', 'boiled', 'cored', 'peelStripes', 'rolls', 'stuffed', 'filled', 'fill', 'filling', 'cracked', 'open', 'spread', 'box', 'bits', 'extra', 'slots', 'mix', 'balls', 'ballsOf', 'turned', 'fold', 'roll', 'units']) : ''}`;
}
export function buildFood(kind, st) {
  const key = foodKey(kind, st);
  let g = CACHE.get(key);
  if (!g) {
    g = new THREE.Group();
    try { foodLocal(g, kind, st && typeof st === 'object' ? st : {}); } catch (e) { console.warn('food3d', kind, e); }
    // (a heap of rice, a bunch of parsley …: its pieces drawn together, a few draw calls – not one each)
    consolidate(g);
    if (CACHE.size > 400) CACHE.clear();
    CACHE.set(key, g);
  }
  const c = g.clone();
  // (a thing half cut through: its own materials, cut off at the knife's line –
  // syncCuts keeps that where the thing is)
  c.traverse((o) => {
    if (o.userData.clipX == null) return;
    const local = new THREE.Plane(v(-1, 0, 0), o.userData.clipX), plane = local.clone();
    const cl = (mm) => { const m = mm.clone(); m.clippingPlanes = [plane]; m.clipShadows = true; return m; };
    o.traverse((m) => { if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map(cl) : cl(m.material); });
    o.userData.clip = { local, plane };
  });
  return c;
}
// Keeps the cut of a half-cut thing (its clipping plane, in the world) where it is now.
export function syncCuts(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => { const c = o.userData.clip; if (c) c.plane.copy(c.local).applyMatrix4(o.matrixWorld); });
}
export function hasCuts(root) {
  let any = false;
  root.traverse((o) => { if (o.userData.clip) any = true; });
  return any;
}
// ------------------------------------------------------------------ food containers
// Loose food is kept, carried and put down in a food container – glass, clear
// plastic or coloured plastic, from nesting sets of three (the small one fits
// in the middle one, that in the big one). What comes in its own pack – a
// bottle, carton, can, jar, sack, shaker – doesn't; nor does dough.
export function boxable(kind) { const a = artOf(kind); return !!a && !PACKED.has(a.type); }
// (inside at the rim: w × d, h deep; the walls lean out a little, so they stack)
const BOX_SIZES = [{ w: 0.12, d: 0.09, h: 0.055 }, { w: 0.16, d: 0.12, h: 0.065 }, { w: 0.21, d: 0.155, h: 0.08 }];
const PLASTIC = ['#7ec8a8', '#f2a65a', '#8ab4e8', '#e9dfc9', '#d98ab0'];
const SPECS = new Map();
// which container a food has: the smallest of the three it fits in, whole – it keeps it while it's cut up
// The rows and columns q things of w × d best lie in, in a w0 × d0 space: the one that
// needs them shrunk least (fit: 1 – at their own size).
function gridFor(q, w, d, w0, d0) {
  let best = { cols: 1, rows: q, fit: -1 };
  for (let c = 1; c <= q; c++) {
    const r = Math.ceil(q / c), fit = Math.min(1, (w0 / c * 0.96) / w, (d0 / r * 0.96) / d);
    if (fit > best.fit + 1e-6) best = { cols: c, rows: r, fit };
  }
  return best;
}
export function boxSpec(kind, st) {
  const q = clamp(Math.max(num(st && st.qty, 1) + num(st && st.extra, 0), num(st && st.cap, 0)) | 0, 1, 12); // (a bunch: all it was filled with)
  const key = `${typeof kind === 'string' ? kind : JSON.stringify(kind)}|${q}`;
  let sp = SPECS.get(key);
  if (!sp) {
    // (the smallest of the set they all lie in at their own size – the biggest if none does)
    const a = artOf(kind), S = a ? sizeArt(a) : { w: 100, h: 60 }, w = S.w * K, long = S.w > S.h * 1.6;
    const deep = long ? Math.min(S.w, S.h) * K : Math.min(w, S.h * K * 1.2);
    let size = BOX_SIZES.findIndex((b) => gridFor(q, w, deep, b.w * 0.86, b.d * 0.86).fit >= 1);
    if (size < 0) size = 2;
    const h = artHash(typeof kind === 'string' ? kind : JSON.stringify(kind));
    sp = { size, style: ['glass', 'clear', 'plastic'][h % 3], color: PLASTIC[(h >> 3) % PLASTIC.length], label: typeof kind === 'string' ? ingName(kind, q) : '' };
    SPECS.set(key, sp);
  }
  return sp;
}
const BOX_MATS = new Map();
function boxMat(style, color) {
  const key = `${style}|${color}`;
  let m = BOX_MATS.get(key);
  if (!m) {
    m = style === 'glass' ? new THREE.MeshStandardMaterial({ color: '#b8e2e6', roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide })
      : style === 'clear' ? new THREE.MeshStandardMaterial({ color: '#dce8ee', roughness: 0.3, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.55, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    BOX_MATS.set(key, m);
  }
  return m;
}
const RIM_MAT = {
  glass: new THREE.MeshStandardMaterial({ color: '#8fc4c8', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  clear: new THREE.MeshStandardMaterial({ color: '#f4f8fa', roughness: 0.4, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
};
const WATER_MAT = new THREE.MeshStandardMaterial({ color: '#9fd0ea', roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false });
// A label on the container saying what's in it: a strip of paper, written on
const LABELS = new Map();
function labelMat(text) {
  let m = LABELS.get(text);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const x = c.getContext('2d');
  x.fillStyle = '#fbf6e6'; x.fillRect(0, 0, 256, 72);
  x.strokeStyle = 'rgba(120,100,70,0.35)'; x.lineWidth = 3; x.strokeRect(2, 2, 252, 68);
  x.fillStyle = '#3a2a1e';
  let size = 44;
  do { x.font = `700 ${size}px Fredoka, "Comic Sans MS", system-ui, sans-serif`; size -= 2; } while (x.measureText(text).width > 236 && size > 18);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  LABELS.set(text, m);
  return m;
}
const LABEL_GEO = new THREE.PlaneGeometry(1, 1);

// the container itself (origin: the middle of its floor) – .userData.water: its water, scaled to how full
function containerMesh(sp) {
  const b = BOX_SIZES[sp.size], m = boxMat(sp.style, sp.color), t = sp.style === 'glass' ? 0.004 : 0.0025;
  const g = new THREE.Group();
  // (a square frustum, stretched: the walls lean out toward the rim)
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.86, 1, 4, 1, true), m);
  walls.rotation.y = Math.PI / 4;
  const wg = new THREE.Group();
  wg.add(walls);
  wg.scale.set(b.w + t * 2, b.h, b.d + t * 2);
  wg.position.y = b.h / 2 + t;
  g.add(wg);
  const floor = new THREE.Mesh(GEO.box, m);
  floor.scale.set(b.w * 0.86, t, b.d * 0.86);
  floor.position.y = t / 2;
  g.add(floor);
  // (a little rim, so it reads as a container even in clear plastic)
  // (a rim you can see, so even clear plastic reads as a container)
  const rimMat = sp.style === 'plastic' ? m : RIM_MAT[sp.style];
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1, true), rimMat);
  rim.rotation.y = Math.PI / 4;
  const rg = new THREE.Group();
  rg.add(rim);
  rg.scale.set(b.w + t * 4, 0.008, b.d + t * 4);
  rg.position.y = b.h + t - 0.003;
  g.add(rg);
  // what's in it, on a label on each side (one always faces you)
  if (sp.label) {
    const m2 = labelMat(sp.label), lean = Math.atan(0.07 * Math.max(b.w, b.d) / b.h), y = t + b.h * 0.5;
    for (const [nx, nz, len] of [[0, 1, b.w], [0, -1, b.w], [1, 0, b.d], [-1, 0, b.d]]) {
      const lw = Math.min(len * 0.78, b.h * 2.6), lh = lw * 72 / 256;
      const lab = new THREE.Mesh(LABEL_GEO, m2);
      const half = (nx ? b.w : b.d) / 2 + t + 0.0015, wid = (nx ? b.w : b.d);
      lab.scale.set(lw, lh, 1);
      lab.position.set(nx * (half - wid * 0.035), y, nz * (half - wid * 0.035));
      lab.rotation.set(0, Math.atan2(nx, nz), 0);
      lab.rotateX(lean); // (leaning out with the wall)
      g.add(lab);
    }
  }
  const water = new THREE.Mesh(GEO.box, WATER_MAT);
  water.visible = false;
  water.userData.keep = true; // (filled and emptied on its own)
  g.add(water);
  g.userData.water = water;
  g.userData.inner = b;
  return consolidate(g); // (its walls and floor as one, its four labels as one)
}
// A food in its container: {g, setWater(0..1)}. The food is built for the
// container's inside (several in a grid, pieces over the floor) and shrunk if it must.
// (of: the thing itself – its container is chosen by how many there are, whatever state they're in)
export function boxedFood(kind, st, of = st) {
  const sp = boxSpec(kind, of);
  const b = BOX_SIZES[sp.size];
  const g = new THREE.Group();
  const c = containerMesh(sp);
  g.add(c);
  if (st) {
    // (st null: the container on its own, empty)
    // (laid out round the container's middle already – each in a place of its own, so taking one
    // out moves none of the others; whole ones in, as they come)
    const f = buildFood(kind, { ...st, spread: 0, box: [b.w * 0.86, b.d * 0.86], slots: Math.max(1, num(of && of.qty, 1) + num(of && of.extra, 0), num(of && of.cap, 0)) });
    f.position.set(0, 0.004, 0);
    g.add(f);
  }
  const water = c.userData.water;
  return {
    g,
    setWater(level) {
      water.visible = level > 0.02;
      if (!water.visible) return;
      const hh = b.h * Math.min(1, level);
      water.scale.set(b.w * (0.86 + 0.14 * Math.min(1, level)), hh, b.d * (0.86 + 0.14 * Math.min(1, level)));
      water.position.y = 0.004 + hh / 2;
    },
  };
}

// A stack of empty food containers, the three sizes nested in each other (glass), standing by a
// board: an empty one's taken from it for what's been cut or portioned out.
export function containerNest() {
  const g = new THREE.Group();
  [2, 1, 0].forEach((size, i) => {
    const c = containerMesh({ size, style: 'glass', color: PLASTIC[0], label: '' });
    // (no water in these – and the hidden water box mustn't be baked into the kitchen)
    const wm = c.userData.water;
    if (wm && wm.parent) wm.parent.remove(wm);
    c.position.y = i * 0.006;
    g.add(c);
  });
  return consolidate(g);
}

// how wide (along x) a food is, in kitchen units
const WIDTHS = new Map();
export function foodWidth(kind, st) {
  const key = foodKey(kind, st);
  let w = WIDTHS.get(key);
  if (w == null) {
    const b = new THREE.Box3().setFromObject(buildFood(kind, st));
    w = Math.max(0.02, b.max.x - b.min.x);
    WIDTHS.set(key, w);
  }
  return w;
}

function foodLocal(g, kind, st) {
  const a = artOf(kind);
  const P = artPal(a, st);
  const seed = ((artHash(typeof kind === 'string' ? kind : a.type + a.c1) + (num(st.seed) | 0)) >>> 0);
  const cut = st.cut ? normCut(st.cut) : null;
  const wet = !!st.washed;
  if (a.type === 'dough') {
    const q = clamp(num(st.qty, 1) | 0, 1, 8);
    if (cut && cut !== 'whole') return pieces(g, a, P, cut, defaultCount(a, cut, st), seed, st);
    // divided into balls (balls of ballsOf so far): what's left of the lump – smaller for each – and the balls
    // rolled off it in rows beside it; all done, just the balls
    const nb = clamp(num(st.balls, 0) | 0, 0, 12), of = clamp(Math.max(nb, num(st.ballsOf, nb) | 0), 1, 12);
    if (nb > 0 && st.shape !== 'flat') {
      const one = { ...st, shape: 'ball', qty: 1, balls: 0, ballsOf: 0 }, s1 = Math.cbrt(1 / of), left = of - nb;
      if (left > 0) { const h = new THREE.Group(); dough(h, a, P, one, seed, wet); h.scale.setScalar(Math.cbrt(left / of)); g.add(h); }
      const cols = Math.min(3, nb), x0 = left > 0 ? 0.075 : -((cols - 1) * 0.046) / 2;
      for (let i = 0; i < nb; i++) {
        const h = new THREE.Group();
        dough(h, a, P, one, seed + i, wet);
        h.scale.setScalar(s1);
        h.position.set(x0 + (i % 3) * 0.046, 0, (Math.floor(i / 3) - (Math.ceil(nb / 3) - 1) / 2) * 0.046);
        g.add(h);
      }
      return;
    }
    if (q > 1 && st.shape !== 'flat') return cluster(g, a, q, (h) => dough(h, a, P, { ...st, qty: 1 }, seed, wet));
    return dough(g, a, P, st, seed, wet);
  }
  if (a.type === 'egg' && (cut === 'cracked' || cut === 'beaten' || st.cracked)) return pieces(g, a, P, cut === 'beaten' ? 'beaten' : 'cracked', defaultCount(a, 'cracked', st), seed, st);
  if (cut && cut !== 'whole') return cutProgress(g, a, P, cut, st, seed, wet);
  const q = clamp((num(st.qty, 1) + num(st.extra, 0)) | 0, 1, 8); // (a bunch: what the recipe takes and the rest)
  // (in a container that held more – a bunch – even the last one keeps its place)
  const box = Array.isArray(st.box) ? st.box : null, slots = box ? clamp(num(st.slots, q) | 0, q, 12) : q;
  if ((q > 1 || slots > 1) && a.type !== 'pile' && a.type !== 'leaf' && !(a.type === 'block' && a.shape === 'mince')) return cluster(g, a, q, (h, i) => whole(h, a, P, { ...st, qty: 1 }, seed + i * 31, wet), num(st.spread), box, slots);
  whole(g, a, P, st, seed, wet);
}

// several of a thing, side by side (a row; two rows for many) – or round a pan
// (spread: its radius), or in a grid in a food container (box: its inside)
function cluster(g, a, q, make, spread = 0, box = null, slots = q) {
  const S = sizeArt(a);
  const w = S.w * K, d = Math.min(S.w, S.h) * K;
  const long = S.w > S.h * 1.6;
  // (in a container: each at its own size in a place of its own on its floor – long ones one behind the
  // other – and those that don't fit there piled on top, askew; a bunch is taken from the top, so the
  // rest never move. Shrunk only if not even one fits.)
  const deep = long ? d : Math.min(w, S.h * K * 1.2);
  const cols = box ? Math.max(1, Math.floor((box[0] * 0.96) / w)) : 0, rows = box ? Math.max(1, Math.floor((box[1] * 0.96) / deep)) : 0;
  const fit = box ? Math.min(1, (box[0] * 0.96) / w, (box[1] * 0.96) / deep) : 1, per = cols * rows;
  const cw = box ? box[0] / cols : 0, cd = box ? box[1] / rows : 0, layerH = S.h * K * 0.72 * fit;
  // (the places it has – as many as it was filled with – in the middle of its floor)
  const usedC = box ? Math.min(cols, slots) : 0, usedR = box ? Math.min(rows, Math.ceil(Math.min(slots, per) / cols)) : 0;
  for (let i = 0; i < q; i++) {
    const h = new THREE.Group();
    make(h, i);
    if (box) {
      const L = Math.floor(i / per), j = i % per, c = j % cols, rI = Math.floor(j / cols);
      // (on top: nestled between those below – half a place over – and turned a little)
      const up = L > 0, nx = up && cols > 1 ? cw * 0.5 * (L % 2 ? 1 : -1) : 0, nz = up && rows > 1 ? cd * 0.5 * (L % 2 ? 1 : -1) : 0;
      const x = Math.max(-box[0] / 2 + (w * fit) / 2, Math.min(box[0] / 2 - (w * fit) / 2, (c - (usedC - 1) / 2) * cw + nx + (slots > 1 ? (((i * 0.37) % 1) - 0.5) * cw * 0.15 : 0)));
      const z = Math.max(-box[1] / 2 + (deep * fit) / 2, Math.min(box[1] / 2 - (deep * fit) / 2, (rI - (usedR - 1) / 2) * cd + nz));
      h.position.set(x, L * layerH, z);
      h.scale.setScalar(fit);
      h.rotation.y = (slots > 1 ? ((i * 1.7) % 0.5) - 0.25 : 0) + (up ? (L % 2 ? 0.35 : -0.35) : 0);
    } else if (spread > 0) {
      const an = i * 2.4, rr = q > 1 ? Math.min(spread - w * 0.4, spread * 0.55) * (0.5 + 0.5 * ((i * 0.618) % 1)) : 0;
      h.position.set(Math.cos(an) * Math.max(0, rr), 0, Math.sin(an) * Math.max(0, rr));
      h.rotation.y = an;
    } else if (long) h.position.set((i % 2 ? 0.1 : -0.06) * w, 0, (i - (q - 1) / 2) * d * 0.95);
    else {
      const perRow = q <= 3 ? q : Math.ceil(q / 2), row = Math.floor(i / perRow), col = i % perRow;
      h.position.set((col - (Math.min(perRow, q - row * perRow) - 1) / 2) * w * 0.82, 0, (row - 0.5 * (q > perRow)) * d * 0.9);
      h.rotation.y = (i * 1.7) % 0.8 - 0.4;
    }
    g.add(h);
  }
}

// ------------------------------------------------------------------ a whole one
function whole(g, a, P, st, seed, wet) {
  const r = rng(seed);
  const rough = wet ? 0.16 : 0.62;
  // (peeled – or being: pf of the skin off it, the flesh showing where it's gone)
  const pf = clamp(num(st.peeled, 0), 0, 1), part0 = pf > 0 && pf < 1;
  const skin = pf >= 1 || (part0 && a.type !== 'long') ? mixHex(P.c2, P.c1, 0.15) : P.c1;
  // (what's left of the skin over it: the part of the way round that's still on)
  const skinLeft = (geo, mat, x, y, z, sx, sy, sz) => { const m = mat.clone(); m.side = THREE.DoubleSide; return part(g, geo, m, x, y, z, sx, sy, sz); };
  const cf = clamp(num(st.cored, 0), 0, 1);
  switch (a.type) {
    case 'round': {
      const { rx, ry } = roundDims(a);
      const R = rx * K, H = ry * K;
      const m = fm(skin, { rough });
      if (a.lobes) {
        for (let i = 0; i < 4; i++) { const an = i * TAU / 4 + 0.4; part(g, GEO.sphere, m, Math.cos(an) * R * 0.36, H, Math.sin(an) * R * 0.36, R * 0.64, H * 1.02, R * 0.64); }
      } else if (a.segments) {
        part(g, GEO.sphere, m, 0, H, 0, R, H, H * 0.98);
        for (const sx of [-1, 1]) part(g, GEO.cone, m, sx * (R + 0.006), H, 0, H * 0.22, 0.016, H * 0.22, 0, 0, -sx * Math.PI / 2);
      } else part(g, GEO.sphere, m, 0, H, 0, R, H, R * 0.97);
      if (part0 && !a.lobes && !a.segments) skinLeft(new THREE.SphereGeometry(1, 20, 14, 0, TAU * (1 - pf)), fm(P.c1, { rough }), 0, H, 0, R * 1.015, H * 1.015, R * 0.985);
      if (a.tip && !a.segments) part(g, GEO.cone, fm(st.peeled ? skin : P.c3, { rough }), 0, H * 2 + 0.006, 0, H * 0.18, 0.018, H * 0.18);
      // (cored – or being: the knife's cut round the stem as far as it's gone; then a hole where it was)
      if (cf > 0 && cf < 1) part(g, new THREE.TorusGeometry(1, 0.08, 5, 24, TAU * cf), fm(mixHex(P.c2, '#3a2a1e', 0.35), { rough: 0.6 }), 0, H * 1.98, 0, R * 0.28, R * 0.28, R * 0.28, Math.PI / 2, 0, 0);
      if (cf >= 1) part(g, GEO.disc, fm(mixHex(P.c2, '#000000', 0.25), { rough: 0.7 }), 0, H * 1.985, 0, R * 0.26, R * 0.26, R * 0.26, -Math.PI / 2, 0, 0);
      if (a.spots) for (let i = 0; i < 5; i++) { const an = r() * TAU, el = (r() - 0.5) * 1.6; part(g, GEO.sphereLo, fm(P.c3), Math.cos(an) * Math.cos(el) * R * 0.98, H + Math.sin(el) * H * 0.98, Math.sin(an) * Math.cos(el) * R * 0.95, 0.003); }
      if ((a.stem || a.lobes) && !st.peeled && cf < 1) {
        const sm = fm(a.stem || P.c3);
        part(g, GEO.cyl, sm, 0, H * 2 + 0.005, 0, 0.0035, 0.014, 0.0035);
        if (!a.lobes) for (let i = 0; i < 5; i++) { const an = i * TAU / 5; part(g, GEO.sphereLo, sm, Math.cos(an) * R * 0.22, H * 1.98, Math.sin(an) * R * 0.22, R * 0.2, 0.003, R * 0.07, 0, -an, 0); }
      }
      break;
    }
    case 'long': {
      if (a.knobby) {
        const m = fm(skin, { rough });
        [[-0.03, 0.017, 0, 0.022], [0.0, 0.02, 0.005, 0.025], [0.032, 0.017, -0.004, 0.02], [0.012, 0.03, 0.016, 0.014]].forEach(([x, y, z, s]) => part(g, GEO.sphere, m, x, y, z, s * 1.3, s, s));
        break;
      }
      const T = tubeOf(a);
      const bunch = a.bunch || 1;
      // (being peeled – or peeled in stripes: the skin, with a strip of the flesh showing for each pull of the
      // peeler, from the top round – side by side, or with a strip of skin left between)
      const pf = clamp(num(st.peeled, 0), 0, 1), striped = !!st.peelStripes, strips = pf > 0 && (pf < 1 || striped) ? Math.round(pf * (striped ? 4 : 8)) : 0;
      for (let b = 0; b < bunch; b++) {
        const dz = bunch > 1 ? (b - (bunch - 1) / 2) * T.T * 2.1 * K : 0;
        const pts = T.x.map((x, i) => v(x * K, -T.y[i] * K, dz));
        const rad = T.r.map((q) => q * K);
        const m = fm(strips || striped ? P.c1 : skin, { rough: a.stripes ? rough * 0.9 : rough });
        const tm = new THREE.Mesh(tubeGeo(pts, rad, 0.95), m);
        tm.castShadow = true;
        g.add(tm);
        if (strips) {
          const fl = fm(mixHex(P.c2, P.c1, 0.15), { rough }), sw = TAU / 8, rr = rad.map((q) => q * 1.012);
          for (let i = 0; i < strips; i++) {
            const c = Math.PI / 2 + (striped ? 2 * i : i % 2 ? (i + 1) / 2 : -i / 2) * sw; // (side by side: either side of the first in turn)
            g.add(new THREE.Mesh(tubeGeo(pts.slice(1, -1), rr.slice(1, -1), 0.95, 4, c - sw * (striped ? 0.42 : 0.52), c + sw * (striped ? 0.42 : 0.52)), fl));
          }
        }
        part(g, GEO.sphere, m, pts[0].x, pts[0].y, dz, rad[0], rad[0], rad[0] * 0.95);
        part(g, GEO.sphere, m, pts[T.N].x, pts[T.N].y, dz, rad[T.N], rad[T.N], rad[T.N] * 0.95);
        // the stem / top at the thick end
        if ((pf < 1 || striped) && a.c3 && b === 0) {
          const end = (a.taper || 0) >= 0 ? 0 : T.N;
          const dir = end === 0 ? -1 : 1;
          const sm = fm(a.c3);
          if (a.rings) for (let i = 0; i < 3; i++) part(g, GEO.cylLo, sm, pts[end].x + dir * (rad[end] + 0.02), pts[end].y + (i - 1) * 0.008, dz + (i - 1) * 0.006, 0.0025, 0.045, 0.0025, 0, 0, dir * (Math.PI / 2 - (i - 1) * 0.3));
          else part(g, GEO.cyl, sm, pts[end].x + dir * (rad[end] + 0.004), pts[end].y + rad[end] * 0.3, dz, rad[end] * 0.35, 0.012, rad[end] * 0.35, 0, 0, dir * Math.PI / 2.4);
        }
      }
      break;
    }
    case 'bulb': {
      // garlic: its papery skin faintly mauve, the cloves under it a warm ivory – peeled, the skin's left on round
      // the rest of it, as far as it's still on
      const prof = [[0.001, 0], [0.02, 0.004], [0.034, 0.02], [0.033, 0.04], [0.02, 0.058], [0.006, 0.07], [0.001, 0.076]];
      const geo = lathe(prof), skinM = fm(mixHex(P.c1, '#c9a3b8', 0.28), { rough }), bare = fm(mixHex(P.c2, '#e8cf86', 0.6), { rough: 0.3 });
      for (let i = 0; i < 6; i++) { const mm = part(g, geo, pf > 0 ? bare : skinM, 0, 0, 0, 1, 1, 0.55, 0, i * Math.PI / 6, 0); mm.scale.x = 0.8; }
      if (part0) {
        const sm = skinM.clone(); sm.side = THREE.DoubleSide;
        part(g, new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x * 0.8, y)), 18, 0, TAU * (1 - pf)), sm, 0, 0, 0, 1.04, 1.01, 1.04);
      }
      if (pf < 1) part(g, GEO.cylLo, fm(P.c3), 0, 0.001, 0, 0.012, 0.004, 0.012);
      break;
    }
    case 'egg': {
      const prof = [[0.0001, 0], [0.014, 0.003], [0.022, 0.015], [0.0235, 0.03], [0.02, 0.046], [0.012, 0.057], [0.0001, 0.061]].map(([x, y]) => new THREE.Vector2(x, y));
      const col = pf > 0 ? '#fbfaf4' : skin;
      // (lying on its side, as an egg does – its length across, front to back)
      const eg = new THREE.Group();
      eg.rotation.x = Math.PI / 2;
      eg.position.set(0, 0.0235, -0.0305);
      g.add(eg);
      part(eg, new THREE.LatheGeometry(prof, 18), fm(col, { rough: wet ? 0.18 : 0.45 }), 0, 0, 0, pf > 0 ? 0.985 : 1);
      // (being shelled: the top first – the shell still on round the rest, underneath, cracked all over)
      if (part0) {
        const sm = fm(P.c1, { rough: 0.45 }); sm.side = THREE.DoubleSide;
        part(eg, new THREE.LatheGeometry(prof, 18, -TAU * (1 - pf) / 2, TAU * (1 - pf)), sm, 0, 0, 0, 1.01, 1.01, 1.01);
        const crk = fm(mixHex(P.c1, '#5a4636', 0.55), { rough: 0.8 });
        const rAt = (y) => { for (let j = 1; j < prof.length; j++) if (y <= prof[j].y) { const t = (y - prof[j - 1].y) / (prof[j].y - prof[j - 1].y); return prof[j - 1].x + (prof[j].x - prof[j - 1].x) * t; } return 0.001; };
        for (let i = 0; i < 7; i++) { const an = ((i + 0.5) / 7 - 0.5) * TAU * (1 - pf), y = 0.014 + ((i * 0.37) % 1) * 0.03, rr = rAt(y) * 1.012; part(eg, GEO.box, crk, Math.sin(an) * rr, y, Math.cos(an) * rr, 0.0007, 0.01, 0.0007, (i % 3 - 1) * 0.5, an, 0); }
      }
      break;
    }
    case 'mushroom': {
      part(g, GEO.cyl, fm(P.c2), 0, 0.016, 0, 0.012, 0.032, 0.012);
      part(g, GEO.hemi, fm(skin, { rough }), 0, 0.028, 0, 0.034, 0.026, 0.034);
      part(g, GEO.disc, fm(P.c3), 0, 0.0279, 0, 0.033, 0.033, 0.033, Math.PI / 2, 0, 0);
      break;
    }
    case 'herb': {
      const r2 = rng(seed);
      const stem = fm(P.c3), l1 = fm(P.c1, { rough }), l2 = fm(P.c2, { rough });
      const grass = a.leaf === 'grass', needle = a.leaf === 'needle';
      for (let i = 0; i < 7; i++) {
        const an = (i - 3) * 0.13, len = 0.085 + r2() * 0.03;
        const s = part(g, GEO.cylLo, grass ? l1 : stem, -0.03 + Math.cos(an) * len / 2, 0.006 + i * 0.0015, Math.sin(an) * len / 2, grass ? 0.0025 : 0.0016, len, grass ? 0.0025 : 0.0016, 0, -an, Math.PI / 2);
        void s;
        if (grass) continue;
        const nl = needle ? 8 : 4;
        for (let j = 0; j < nl; j++) {
          const u = 0.45 + (j / nl) * 0.55;
          const x = -0.03 + Math.cos(an) * len * u, z = Math.sin(an) * len * u;
          const sz = needle ? 0.006 : a.leaf === 'tiny' ? 0.006 : 0.014;
          part(g, GEO.sphereLo, j % 2 ? l1 : l2, x, 0.009 + i * 0.0015, z + (j % 2 ? 0.007 : -0.007), sz, 0.003, sz * (needle ? 0.4 : 0.7), 0, -an + (j % 2 ? 0.6 : -0.6), 0);
        }
      }
      part(g, GEO.cylLo, fm('#c9a24a'), -0.03, 0.009, 0, 0.007, 0.006, 0.007, 0, 0, Math.PI / 2); // the band
      break;
    }
    case 'leaf': {
      const q = clamp(num(st.qty, 1) | 0, 1, 6);
      if (st.filled || st.fill) { // a leaf with filling on it, being rolled: its sides folded in (fold 0 … 1) over the
        // filling, then rolled up from the near edge (+z, my side; roll 0 … 1) into a little cigar
        const fold = clamp(num(st.fold), 0, 1), roll = clamp(num(st.roll), 0, 1), fc = fm(typeof st.fill === 'string' ? st.fill : '#b8603a', { rough: 0.8 });
        const lm = fm(P.c1, { rough }), w = 0.07 * (1 - 0.4 * fold);
        const lg = new THREE.Group();
        leafShape(lg, a, P, 0, rough);
        lg.scale.set(1 - 0.4 * fold, 1, Math.max(0.05, 1 - roll));
        lg.position.z = -0.055 * roll;
        g.add(lg);
        if (roll < 0.95) part(g, GEO.sphere, fc, 0, 0.012, 0.01 - 0.06 * roll, 0.022, 0.009, 0.014);
        // (the sides, folded over the filling)
        if (fold > 0) for (const sd of [-1, 1]) part(g, GEO.sphereLo, lm, sd * (0.05 - 0.028 * fold), 0.012 + 0.008 * fold, 0.01 - 0.06 * roll, 0.022, 0.004, 0.04 * Math.max(0.2, 1 - roll), 0, 0, sd * (0.5 - 0.35 * fold));
        // (what's rolled up so far: a roll at my side of it, fatter as it goes, moving away)
        const rr = 0.008 + 0.007 * roll; // (GEO.caps: radius 0.5, 2 long)
        if (roll > 0) part(g, GEO.caps, lm, 0, rr, 0.055 - 0.07 * roll, rr * 2, w * 0.62, rr * 2, 0, 0, Math.PI / 2);
        break;
      }
      for (let i = 0; i < Math.min(q, 4); i++) leafShape(g, a, P, i, rough);
      break;
    }
    case 'head': {
      const m1 = fm(skin, { rough }), m3 = fm(P.c3, { rough });
      part(g, GEO.sphere, fm(P.c2), 0, 0.044, 0, 0.044, 0.042, 0.044);
      for (let i = 0; i < 6; i++) {
        const an = i * TAU / 6 + 0.3;
        const lf = part(g, new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 1.1, 0.2, 2.2), i % 2 ? m1 : m3, Math.cos(an) * 0.006, 0.045, Math.sin(an) * 0.006, 0.05, 0.047, 0.05, 0, an, 0);
        lf.material = lf.material.clone(); lf.material.side = THREE.DoubleSide;
      }
      // its core (it lies stem up to be cored): the stump – the knife's cut round it as far as it's gone – then a
      // hole where it was
      const pale = fm(mixHex(P.c2, '#f4f0d8', 0.4), { rough: 0.6 });
      if (cf < 1) part(g, GEO.cyl, pale, 0, 0.092, 0, 0.011, 0.008, 0.011);
      if (cf > 0 && cf < 1) part(g, new THREE.TorusGeometry(1, 0.1, 5, 24, TAU * cf), fm('#33421a', { rough: 0.7 }), 0, 0.0935, 0, 0.018, 0.018, 0.018, Math.PI / 2, 0, 0);
      if (cf >= 1) part(g, GEO.disc, fm(mixHex(P.c2, '#22300f', 0.55), { rough: 0.8 }), 0, 0.0935, 0, 0.017, 0.017, 0.017, -Math.PI / 2, 0, 0);
      break;
    }
    case 'pile': {
      // (crushed – crush 0 … 1: pressed flatter and wider, the pods split open, their dark seeds spilling)
      const cr = clamp(num(st.crush, 0), 0, 1);
      const S = sizeArt(a);
      const w = S.w * K * 0.5 * (1 + 0.3 * cr), h = S.h * K * 0.8 * (1 - 0.55 * cr);
      part(g, GEO.hemi, fm(P.c2, { rough: 0.9 }), 0, 0, 0, w, h, w * 0.8);
      const r2 = rng(seed);
      const gs = a.grain === 'bean' || a.grain === 'pea' ? 0.0055 : a.grain === 'rice' ? 0.0035 : 0.0042;
      const cols = [fm(P.c1, { rough: 0.7 }), fm(P.c3, { rough: 0.7 })], seedM = fm('#2e261e', { rough: 0.6 });
      for (let i = 0; i < 46; i++) {
        const an = r2() * TAU, d = Math.sqrt(r2());
        const x = Math.cos(an) * d * w, z = Math.sin(an) * d * w * 0.8;
        const y = h * Math.sqrt(Math.max(0, 1 - d * d)) + gs * 0.3;
        const rot = r2() * TAU;
        if (cr > 0 && (i * 0.61803) % 1 < cr) {
          // split: the husk pressed flat, a few seeds beside it
          part(g, GEO.sphereLo, cols[i % 5 ? 0 : 1], x, y * 0.8, z, gs * 1.25, gs * 0.3, gs * 0.9, 0, rot, 0);
          for (let j = 0; j < 2; j++) part(g, GEO.sphereLo, seedM, x + Math.cos(rot + j * 2.4) * gs * 1.1, y * 0.8 + gs * 0.25, z + Math.sin(rot + j * 2.4) * gs * 1.1, gs * 0.45, gs * 0.35, gs * 0.45, 0, 0, 0);
        } else part(g, GEO.sphereLo, cols[i % 5 ? 0 : 1], x, y, z, a.grain === 'rice' ? gs * 1.8 : gs, gs * 0.75, gs, 0, rot, 0);
      }
      break;
    }
    case 'block': block(g, a, P, st, seed, wet); break;
    case 'bottle': {
      const tall = a.wine ? 1.08 : 1;
      const glass = fm(a.c2 || '#dfeee8', { rough: 0.08, opacity: 0.45 });
      const prof = [[0.0001, 0], [0.024, 0], [0.025, 0.004], [0.025, 0.08 * tall], [0.02, 0.095 * tall], [0.009, 0.108 * tall], [0.009, 0.128 * tall], [0.0001, 0.128 * tall]];
      part(g, lathe(prof), glass, 0, 0, 0, 1);
      part(g, lathe([[0.0001, 0.002], [0.022, 0.002], [0.022, 0.07 * tall], [0.0001, 0.07 * tall]]), fm(P.c1, { rough: 0.2, opacity: 0.88 }), 0, 0, 0, 1);
      part(g, GEO.cyl, fm(P.c3), 0, 0.133 * tall, 0, 0.0105, 0.012, 0.0105);
      part(g, GEO.cyl, fm('#fbf6ea', { rough: 0.8 }), 0, 0.045, 0, 0.0255, 0.03, 0.0255);
      break;
    }
    case 'carton': {
      const m = fm(P.c1, { rough: 0.7 });
      part(g, GEO.box, m, 0, 0.045, 0, 0.05, 0.09, 0.05);
      const roof = new THREE.CylinderGeometry(0.036, 0.036, 0.05, 3, 1);
      part(g, roof, m, 0, 0.098, 0, 1, 0.5, 1, 0, 0, Math.PI / 2).scale.set(0.98, 1, 0.98);
      part(g, GEO.box, fm(P.c3, { rough: 0.7 }), 0, 0.05, 0.0255, 0.04, 0.035, 0.001);
      part(g, GEO.cyl, fm('#f2efe6'), 0.012, 0.106, 0.008, 0.006, 0.008, 0.006);
      break;
    }
    case 'jar': case 'tea': {
      const tea = a.type === 'tea';
      part(g, GEO.cyl, fm(tea ? P.c2 : (a.c2 || '#e6f0ee'), { rough: tea ? 0.35 : 0.08, opacity: tea ? 1 : 0.5, metal: tea ? 0.5 : 0 }), 0, 0.03, 0, 0.026, 0.06, 0.026);
      if (!tea) part(g, GEO.cyl, fm(P.c1, { rough: 0.5 }), 0, 0.024, 0, 0.023, 0.044, 0.023);
      part(g, GEO.cyl, fm(P.c3, { rough: 0.4, metal: 0.3 }), 0, 0.063, 0, 0.027, 0.009, 0.027);
      if (!tea) part(g, GEO.cyl, fm('#fbf6ea', { rough: 0.8 }), 0, 0.032, 0, 0.0262, 0.02, 0.0262);
      break;
    }
    case 'jug': {
      const glass = fm('#e8f2f4', { rough: 0.06, opacity: 0.4 });
      part(g, lathe([[0.0001, 0], [0.03, 0], [0.032, 0.04], [0.028, 0.09], [0.031, 0.1], [0.0001, 0.1]]), glass, 0, 0, 0, 1);
      part(g, GEO.cyl, fm(P.c1, { rough: 0.15, opacity: 0.75 }), 0, 0.035, 0, 0.028, 0.068, 0.028);
      part(g, GEO.torus, glass, -0.035, 0.055, 0, 0.022, 0.026, 0.022, 0, 0, Math.PI / 2);
      break;
    }
    case 'can': {
      part(g, GEO.cyl, fm(P.c3, { rough: 0.3, metal: 0.7 }), 0, 0.03, 0, 0.026, 0.06, 0.026);
      part(g, GEO.cyl, fm(P.c2, { rough: 0.6 }), 0, 0.03, 0, 0.0263, 0.042, 0.0263);
      break;
    }
    case 'shaker': {
      part(g, GEO.cyl, fm(a.c2 || '#f6f2ea', { rough: 0.25, opacity: 0.6 }), 0, 0.025, 0, 0.016, 0.05, 0.016);
      part(g, GEO.cyl, fm(P.c1, { rough: 0.9 }), 0, 0.018, 0, 0.014, 0.034, 0.014);
      part(g, GEO.hemi, fm(P.c3, { rough: 0.35, metal: 0.4 }), 0, 0.05, 0, 0.0165, 0.012, 0.0165);
      break;
    }
    case 'sack': {
      const paper = fm(P.c2, { rough: 0.85 });
      part(g, lathe([[0.0001, 0], [0.034, 0.002], [0.04, 0.03], [0.038, 0.07], [0.03, 0.09], [0.034, 0.1], [0.0001, 0.1]]), paper, 0, 0, 0, 1, 1, 0.75);
      part(g, GEO.cyl, fm(P.c3, { rough: 0.8 }), 0, 0.045, 0, 0.0405, 0.025, 0.0405 * 0.75);
      if (st.open) part(g, GEO.disc, fm(P.c1, { rough: 0.9 }), 0, 0.0995, 0, 0.03, 0.03, 0.022, -Math.PI / 2, 0, 0);
      break;
    }
    case 'bundle': {
      const m = fm(P.c1, { rough: 0.5 });
      const r2 = rng(seed);
      for (let i = 0; i < 22; i++) { const an = r2() * TAU, d = Math.sqrt(r2()) * 0.012; part(g, GEO.cylLo, m, 0, 0.013 + Math.sin(an) * d, Math.cos(an) * d, 0.0016, 0.15, 0.0016, 0, 0, Math.PI / 2); }
      part(g, GEO.cyl, fm(P.c2, { rough: 0.7 }), 0, 0.013, 0, 0.0145, 0.026, 0.0145, 0, 0, Math.PI / 2);
      break;
    }
    // (not ingredients: a spoonful of something; peelings left on a counter)
    case 'blob': part(g, GEO.sphere, fm(P.c1, { rough: 0.45 }), 0, 0.008, 0, 0.02, 0.01, 0.018); break;
    // (a piece of shell, of papery skin, being pulled off)
    case 'flake': { const fl = fm(P.c1, { rough: 0.6 }); fl.side = THREE.DoubleSide; part(g, new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, 0.9), fl, 0, 0.002, 0, 0.014, 0.006, 0.011); break; }
    case 'scraps': {
      const r2 = rng(seed);
      const n = clamp(num(a.n, 3), 1, 6) * 3;
      for (let i = 0; i < n; i++) part(g, GEO.sphereLo, fm(i % 4 === 3 ? mixHex(P.c1, '#7ab05a', 0.5) : P.c1, { rough: 0.6 }), (r2() - 0.5) * 0.09, 0.002 + r2() * 0.004, (r2() - 0.5) * 0.07, 0.012, 0.0025, 0.005, r2() * 0.5, r2() * TAU, r2() * 0.5);
      break;
    }
    default: part(g, GEO.sphere, fm(skin), 0, 0.03, 0, 0.03); break;
  }
}

function leafShape(g, a, P, i, rough) {
  const lf = part(g, new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, 0.9), fm(i % 2 ? P.c2 : P.c1, { rough }), 0.004 * i, 0.03 + i * 0.004, -0.004 * i, 0.07, 0.03, 0.055, Math.PI, i * 0.4, 0);
  lf.material = lf.material.clone(); lf.material.side = THREE.DoubleSide;
  part(g, GEO.cylLo, fm(P.c2), 0.004 * i, 0.002 + i * 0.004, -0.004 * i, 0.002, 0.11, 0.002, 0, i * 0.4, Math.PI / 2);
}

// butter, cheese, meat, bread, fish, sausages …
function block(g, a, P, st, seed, wet) {
  const s = BLOCK_SIZE[a.shape] || [104, 54];
  const W = s[0] * K, H = s[1] * K;
  const rough = wet ? 0.2 : a.shape === 'loaf' ? 0.8 : 0.55;
  const m1 = fm(P.c1, { rough }), m2 = fm(P.c2, { rough }), m3 = fm(P.c3 || P.c2, { rough });
  const r = rng(seed);
  switch (a.shape) {
    case 'brick': part(g, rbox(W * 0.8, H * 0.8, W * 0.5, 0.004), m1, 0, 0, 0, 1); break;
    case 'wedge': {
      const sh = new THREE.Shape(); sh.moveTo(-W * 0.45, 0); sh.lineTo(W * 0.45, 0); sh.lineTo(-W * 0.45, H * 0.85); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: W * 0.45, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
      geo.translate(0, 0, -W * 0.225);
      part(g, geo, [m2, m1], 0, 0, 0, 1);
      break;
    }
    case 'ball': part(g, GEO.sphere, m1, 0, H * 0.45, 0, W * 0.48, H * 0.45, W * 0.46); break;
    case 'loaf': {
      part(g, rbox(W * 0.85, H * 0.8, W * 0.38, 0.018), m1, 0, 0, 0, 1);
      for (let i = 0; i < 3; i++) part(g, GEO.box, m3, (i - 1) * W * 0.2, H * 0.8, 0, 0.004, 0.002, W * 0.25, 0, 0.5, 0);
      break;
    }
    case 'chunk': for (let i = 0; i < 3; i++) part(g, rbox(W * 0.3, H * 0.7, W * 0.28, 0.006), i % 2 ? m1 : m2, (i - 1) * W * 0.28, 0, (r() - 0.5) * 0.02, 1, 1, 1, 0, r() * 0.8, 0); break;
    case 'mince': {
      const q = clamp(num(st.qty, 1), 1, 6), f = Math.min(1.7, Math.pow(q, 0.35));
      part(g, GEO.hemi, m1, 0, 0, 0, W * 0.4 * f, H * 0.9 * f, W * 0.32 * f);
      for (let i = 0; i < 26; i++) { const an = r() * TAU, d = Math.sqrt(r()); part(g, GEO.sphereLo, i % 3 ? m1 : m2, Math.cos(an) * d * W * 0.38 * f, H * 0.9 * f * Math.sqrt(1 - d * d * 0.9), Math.sin(an) * d * W * 0.3 * f, 0.006); }
      break;
    }
    case 'drumstick': {
      part(g, GEO.sphere, m1, -W * 0.12, H * 0.42, 0, W * 0.3, H * 0.42, H * 0.42);
      part(g, GEO.cyl, fm('#f4ecd8'), W * 0.25, H * 0.3, 0, 0.006, W * 0.3, 0.006, 0, 0, Math.PI / 2);
      part(g, GEO.sphere, fm('#f4ecd8'), W * 0.4, H * 0.3, 0, 0.01);
      break;
    }
    case 'fillet': part(g, GEO.sphere, m1, 0, H * 0.25, 0, W * 0.48, H * 0.3, W * 0.17); part(g, GEO.sphere, m2, 0, H * 0.22, 0.005, W * 0.46, H * 0.27, W * 0.16); break;
    case 'strips': for (let i = 0; i < 3; i++) { const z = (i - 1) * 0.022; part(g, GEO.box, m1, 0, 0.003 + i * 0.002, z, W * 0.9, 0.004, 0.018, 0, (i - 1) * 0.08, 0); part(g, GEO.box, m2, 0, 0.0052 + i * 0.002, z, W * 0.88, 0.0006, 0.005, 0, (i - 1) * 0.08, 0); } break;
    case 'sausage': for (let i = 0; i < 2; i++) part(g, GEO.caps, m1, 0, H * 0.32, (i - 0.5) * H * 0.7, H * 0.6, W * 0.42, H * 0.6, 0, 0, Math.PI / 2); break;
    case 'log': part(g, GEO.cyl, m1, 0, H * 0.45, 0, H * 0.45, W * 0.9, H * 0.45, 0, 0, Math.PI / 2); part(g, GEO.disc, m2, W * 0.45 + 0.0005, H * 0.45, 0, H * 0.44, H * 0.44, 1, 0, Math.PI / 2, 0); break;
    case 'shrimp': {
      const pts = [], rad = [];
      for (let i = 0; i <= 10; i++) { const an = Math.PI * 1.25 * (i / 10); pts.push(v(Math.cos(an) * W * 0.28, H * 0.18, Math.sin(an) * W * 0.28)); rad.push(H * 0.2 * (1 - i / 14)); }
      const tm = new THREE.Mesh(tubeGeo(pts, rad, 1), st.peeled ? m2 : m1); tm.castShadow = true; g.add(tm);
      break;
    }
    case 'shell': for (const sz of [-1, 1]) part(g, GEO.hemi, fm(P.c1, { rough: 0.3 }), 0, 0.012, sz * 0.002, W * 0.36, 0.014, H * 0.4, sz > 0 ? 0 : Math.PI, 0, 0); break;
    case 'finger': for (let i = 0; i < 3; i++) part(g, GEO.caps, m1, 0, H * 0.25, (i - 1) * H * 0.55, H * 0.45, W * 0.4, H * 0.3, 0, 0, Math.PI / 2); break;
    default: part(g, rbox(W * 0.8, H * 0.8, W * 0.5, 0.005), m1, 0, 0, 0, 1);
  }
}

// pizza / bread dough: a ball, a rough lump, or a flat disc with sauce and toppings
function dough(g, a, P, st, seed, wet) {
  const shape = st.shape || 'ball';
  const ck = clamp(num(st.cook), 0, 1);
  const crust = ck > 0 ? mixHex(a.c1, '#d08a3a', ck * 0.85) : P.c1;
  const m = fm(crust, { rough: wet ? 0.3 : 0.85 });
  if (shape === 'ball' || shape === 'rough') {
    part(g, GEO.sphere, m, 0, 0.026, 0, shape === 'rough' ? 0.044 : 0.04, 0.026, shape === 'rough' ? 0.034 : 0.04);
    return;
  }
  const geo = doughFlatGeom(st);
  const rx = geo.rx * K, rz = (geo.form === 'round' ? geo.rx : geo.ry / 0.58) * K * (geo.form === 'boat' ? 0.45 : geo.form === 'oval' ? 0.75 : 1), th = geo.th * K;
  part(g, GEO.cyl, m, 0, th / 2, 0, rx, th, rz);
  part(g, RIM, m, 0, th, 0, rx * 0.93, rz * 0.93, th * 1.6 / 0.14, Math.PI / 2, 0, 0); // (the crust's rim)
  const inner = geo.form === 'boat' ? 0.74 : 0.84;
  const cov = clamp(num(st.coverage, st.sauce ? 1 : 0), 0, 1);
  if (st.sauce && cov > 0) {
    const k = inner * Math.sqrt(cov);
    part(g, GEO.cyl, fm(typeof st.sauce === 'string' ? st.sauce : '#c8321e', { rough: 0.4 }), 0, th + 0.0008, 0, rx * k, 0.0016, rz * k);
  }
  const tops = Array.isArray(st.toppings) ? st.toppings.filter((p) => p && typeof p === 'object') : [];
  const r = rng(seed);
  for (const tp of tops) {
    const x = clamp(num(tp.x), -1, 1) * rx * inner * 0.92, z = clamp(num(tp.y), -1, 1) * rz * inner * 0.92;
    const h = new THREE.Group();
    topping(h, tp.kind, ck, r);
    h.position.set(x, th + 0.0016, z);
    h.rotation.y = r() * TAU;
    g.add(h);
  }
}
function topping(h, kind, ck, r) {
  if (kind === 'olive') { part(h, GEO.torus, fm('#2a2a24', { rough: 0.3 }), 0, 0.003, 0, 0.006, 0.006, 0.01, Math.PI / 2, 0, 0); return; }
  const a = artOf(kind);
  const P = artPal(a, { cook: ck });
  if (a.type === 'block' && a.shape === 'ball') { part(h, GEO.sphere, fm(mixHex(P.c1, '#f6e0a0', ck * 0.6), { rough: 0.5 }), 0, 0.002, 0, 0.012, 0.004, 0.011); return; }
  if (a.type === 'herb') { part(h, GEO.sphereLo, fm(P.c1), 0, 0.002, 0, 0.01, 0.0015, 0.006); return; }
  if (a.type === 'block' && (a.shape === 'log' || a.shape === 'sausage')) { part(h, GEO.cyl, fm(P.c2), 0, 0.0015, 0, 0.011, 0.003, 0.011); return; }
  piece(h, a, P, 'slices', 0, 0, r, 0.6);
}

// ------------------------------------------------------------------ cut up
// A thing being cut lies along x and is cut from its right end leftwards: the
// left end (a pepper's stem) is what the other hand holds, and is left over.
// Its cross-section at x: {y (the middle's height), ry, rz (half height, half
// depth)} – no sec for things that aren't cut in clean slices (a head, herbs …).
const KEEP = 0.16; // (how much of it is left over – at least enough for the holding hand's fingertips)
function cutGeom(a) {
  if (a.type === 'round') {
    const { rx, ry } = roundDims(a);
    const R = rx * K, H = ry * K;
    return { xL: -R, xR: R, top: 2 * H, sec: (x) => { const f = Math.sqrt(Math.max(0, 1 - (x / R) ** 2)); return { y: H, ry: H * f, rz: R * 0.97 * f }; } };
  }
  if (a.type === 'long' && !a.knobby && !a.bunch) {
    const T = tubeOf(a), N = T.N;
    const xs = T.x.map((q) => q * K), ys = T.y.map((q) => -q * K), rs = T.r.map((q) => q * K);
    let top = 0;
    for (let i = 0; i <= N; i++) top = Math.max(top, ys[i] + rs[i]);
    return {
      xL: xs[0] - rs[0], xR: xs[N] + rs[N], top,
      sec: (x) => {
        if (x <= xs[0] || x >= xs[N]) { const i = x <= xs[0] ? 0 : N, d = x - xs[i], r = Math.sqrt(Math.max(0, rs[i] * rs[i] - d * d)); return { y: ys[i], ry: r, rz: r * 0.95 }; }
        const u = ((x - xs[0]) / (xs[N] - xs[0])) * N, i = Math.min(N - 1, Math.floor(u)), f = u - i;
        const r = rs[i] + (rs[i + 1] - rs[i]) * f;
        return { y: ys[i] + (ys[i + 1] - ys[i]) * f, ry: r, rz: r * 0.95 };
      },
    };
  }
  const S = sizeArt(a);
  return { xL: (-S.w * K) / 2, xR: (S.w * K) / 2, top: S.h * K, sec: null };
}
// the k-th of n cuts' line (k = 0: the right end)
const cutAt = (C, k, n) => {
  const L = C.xR - C.xL, keep = clamp(0.032, L * KEEP, L * 0.4);
  return C.xR - (L - keep) * clamp(k / Math.max(1, n), 0, 1);
};
// Several of a thing are cut one after the other, the n cuts shared out among
// them: which one is being cut (u), its cuts so far and in all (kk of nn), and the
// cuts on the ones before it.
function unitOf(k, n, q) {
  const b = (j) => Math.round((j * n) / q);
  let u = 0;
  while (u < q - 1 && b(u + 1) <= k) u++;
  return { u, kk: k - b(u), nn: Math.max(1, b(u + 1) - b(u)), before: b(u) };
}
// For the knife in first person: on a thing being cut (qty of them: the one being
// cut), k of n cuts made, where the next cut goes and where the cut face is now (x,
// as buildFood lays it out), and how tall it is.
export function cutLine(kind, k, n, qty = 1) {
  const a = artOf(kind);
  if (!a) return null;
  const C = cutGeom(a);
  const q = clamp(num(qty, 1) | 0, 1, 8);
  if (q > 1) { const U = unitOf(k, n, q); k = U.kk; n = U.nn; }
  return { next: cutAt(C, Math.min(n, k + 1), n), face: cutAt(C, k, n), xL: C.xL, xR: C.xR, top: C.top };
}

// Several, cut one after the other: the one being cut where one alone would be,
// the ones still to cut lying whole behind it, the pieces of those done off to its
// front right.
function cutMany(g, a, P, cut, st, seed, wet, q, k, n) {
  const U = unitOf(k, n, q);
  cutProgress(g, a, P, cut, { ...st, qty: 1, k: U.kk, n: U.nn }, seed, wet);
  const S = sizeArt(a), deep = Math.min(S.w, S.h) * K + 0.012;
  for (let i = U.u + 1; i < q; i++) {
    const h = new THREE.Group();
    whole(h, a, P, { ...st, cut: null, qty: 1 }, seed + i * 31, wet);
    h.position.set((i % 2) * 0.012, 0, -(i - U.u) * deep);
    g.add(h);
  }
  if (U.u > 0) {
    const C = cutGeom(a), row = cut === 'slices' || cut === 'rings';
    const pg = new THREE.Group(), cnt = row ? Math.min(12, U.before + U.u) : Math.max(1, Math.round((defaultCount(a, cut, st) * U.before) / Math.max(1, n)));
    pieces(pg, a, P, cut, cnt, seed + 7, st);
    pg.position.set(C.xR + (row ? 0.02 : heapGap(a, cut, cnt, st) * 0.85), 0, deep * 0.9);
    pg.scale.setScalar(0.85);
    g.add(pg);
  }
}

function cutProgress(g, a, P, cut, st, seed, wet) {
  // (just what's come off it so far, in a heap – grated shreds under the grater: bits, 0 … 1)
  if (st.bits != null) return pieces(g, a, P, cut, Math.max(1, Math.round(defaultCount(a, cut, st) * clamp(num(st.bits), 0, 1))), seed, st);
  const n = num(st.n, 0), k = num(st.k, n);
  const done = !(n > 0 && k < n);
  if (!['round', 'long', 'bulb', 'egg', 'mushroom', 'head', 'leaf', 'herb', 'block', 'dough'].includes(a.type)) {
    // (a heap of pods, seeds … crushed stays a heap: pressed flatter, the pods split – as far as it's got)
    if (a.type === 'pile' && cut === 'crushed') return whole(g, a, P, { ...st, crush: done ? 1 : clamp(k / n, 0, 1) }, seed, wet);
    if (a.type === 'pile' || a.type === 'bundle') return pieces(g, a, P, cut, defaultCount(a, cut, st), seed, st);
    return whole(g, a, P, st, seed, wet);
  }
  if (cut === 'slit') { whole(g, a, P, { ...st, cut: null }, seed, wet); return slitGroove(g, a, st, done ? 1 : clamp(k / n, 0, 1)); }
  if (cut === 'rolls' && a.type === 'leaf') return pieces(g, a, P, 'rolls', defaultCount(a, cut, st), seed, st);
  // (cut into strips: they lie together where it was – turned a quarter round, as far as it's been, to be cut across)
  const loose = Array.isArray(st.box) || num(st.spread) > 0;
  if (done && cut === 'strips' && !loose && cutGeom(a).sec) return stripsLayout(g, a, P, cutGeom(a), n || 4, num(st.turned));
  if (done) return pieces(g, a, P, cut, defaultCount(a, cut, st), seed, st);
  const q = clamp(num(st.qty, 1) | 0, 1, 8);
  if (q > 1 && cut !== 'halves') return cutMany(g, a, P, cut, st, seed, wet, q, k, n);
  const frac = clamp(k / n, 0, 1);
  const wholeG = new THREE.Group();
  whole(wholeG, a, P, { ...st, cut: null, qty: 1 }, seed, wet);
  if (cut === 'halves' || frac <= 0) { g.add(wholeG); return; }
  // (leaves taken off a head one by one: the head smaller all round for each, the leaves piled up beside it)
  if (cut === 'leaves') {
    wholeG.scale.setScalar(1 - 0.4 * frac);
    g.add(wholeG);
    const lg = new THREE.Group();
    for (let i = 0; i < Math.min(6, Math.max(1, Math.round(k))); i++) leafShape(lg, a, P, i, 0.6);
    lg.position.set(0.115, 0, 0.01);
    g.add(lg);
    return;
  }
  const C = cutGeom(a);
  const xc = cutAt(C, k, n);
  const row = cut === 'slices' || cut === 'rings';
  const cnt = row ? Math.min(12, Math.max(1, k)) : Math.max(1, Math.round(defaultCount(a, cut, st) * frac));
  if (C.sec) {
    // cut off clean where the knife went through, the cut face showing; the
    // slices off it standing against each other beside it (the bits: a heap) – diced: the strips (turned a
    // quarter round) cut across, the cubes beside them
    if (cut === 'dice') {
      const sg = new THREE.Group();
      stripsLayout(sg, a, P, C, num(st.strips, 4) || 4, 1);
      sg.userData.clipX = xc;
      g.add(sg);
    } else {
      wholeG.userData.clipX = xc;
      g.add(wholeG);
      cutFace(g, a, P, C.sec(xc), xc);
    }
    if (row) return cutSlices(g, a, P, C, k, n);
    const pg = new THREE.Group();
    pieces(pg, a, P, cut, cnt, seed, st);
    pg.position.x = xc + 0.006 + heapGap(a, cut, cnt, st);
    g.add(pg);
    return;
  }
  // (the rest: what's left shrinks from the right, the pieces right beside it)
  const W = C.xR - C.xL;
  const f = clamp(1 - frac, 0.15, 1);
  wholeG.scale.x = f;
  wholeG.position.x = (-W * (1 - f)) / 2;
  g.add(wholeG);
  const pg = new THREE.Group();
  pieces(pg, a, P, cut, cnt, seed, st);
  const half = row ? ((cnt - 1) * Math.min(0.016, Math.max(0.04, W) / cnt)) / 2 + 0.012 : heapGap(a, cut, cnt, st);
  pg.position.x = -W / 2 + W * f + 0.006 + half * 0.85;
  pg.scale.setScalar(0.85);
  g.add(pg);
}
// the face where it was cut through: its flesh – a hollow one's (a pepper's) a
// ring round the pith and seeds, a tomato's or a lemon's with its middle
function cutFace(g, a, P, s, x) {
  if (!s || s.ry < 0.002) return;
  const flesh = fm(P.c2, { rough: 0.45 });
  if (a.hollow) {
    part(g, GEO.annulus, flesh, x, s.y, 0, s.rz, s.ry, 1, 0, Math.PI / 2, 0);
    part(g, GEO.disc, fm(mixHex(P.c2, '#fffbe8', 0.55), { rough: 0.7 }), x - 0.004, s.y, 0, s.rz * 0.8, s.ry * 0.8, 1, 0, Math.PI / 2, 0);
    return;
  }
  part(g, GEO.disc, flesh, x, s.y, 0, s.rz, s.ry, 1, 0, Math.PI / 2, 0);
  if (a.type === 'round' && !a.spots) part(g, GEO.disc, fm(P.c3, { rough: 0.5 }), x + 0.0004, s.y, 0, s.rz * 0.55, s.ry * 0.55, 1, 0, Math.PI / 2, 0);
}
// the slices cut off so far, standing against each other beside it: the
// newest nearly upright by the knife, the older ones further over
function cutSlices(g, a, P, C, k, n) {
  const skin = fm(P.c1, { rough: 0.45 }), flesh = fm(P.c2, { rough: 0.5 }), inner = fm(P.c2, { rough: 0.5, side: THREE.BackSide });
  let px = cutAt(C, k, n) + 0.004;
  for (let j = k - 1; j >= 0; j--) {
    const hi = cutAt(C, j, n), lo = cutAt(C, j + 1, n), t = Math.max(0.002, (hi - lo) * 0.9);
    const s = C.sec((hi + lo) / 2);
    if (!s || s.ry < 0.002) continue;
    const phi = Math.min(0.85, 0.3 + 0.2 * (k - 1 - j));
    px += j === k - 1 ? t / 2 : (t / Math.cos(phi)) * 1.08 + 0.0015;
    // (leaning over from its foot)
    const h = new THREE.Group();
    h.position.set(px, (Math.sin(phi) * t) / 2, 0);
    h.rotation.z = -phi;
    // (the slice standing on its edge, its cut faces to the sides: built round y, turned)
    const sl = new THREE.Group();
    sl.position.y = s.ry;
    sl.rotation.z = Math.PI / 2;
    sl.scale.set(s.ry, t, s.rz);
    if (a.hollow) {
      part(sl, GEO.tube, skin, 0, 0, 0, 1, 1, 1);
      part(sl, GEO.tube, inner, 0, 0, 0, 0.8, 0.999, 0.8);
      part(sl, GEO.annulus, flesh, 0, 0.5, 0, 1, 1, 1, -Math.PI / 2, 0, 0);
      part(sl, GEO.annulus, flesh, 0, -0.5, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    } else {
      part(sl, GEO.cyl, [skin, flesh, flesh], 0, 0, 0, 1, 1, 1);
      if ((a.type === 'round' && !a.spots) || a.type === 'egg') for (const y of [0.502, -0.502]) part(sl, GEO.disc, fm(a.type === 'egg' ? mixHex(P.c3, '#f6e7a0', 0.35) : P.c3, { rough: 0.5 }), 0, y, 0, 0.55, 0.55, 0.55, y > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
    }
    h.add(sl);
    g.add(h);
  }
}
// Cut into strips (n cuts): side by side where it was, each as tall and deep as it was there – turned (0 … 1) a
// quarter round, as far as it's been turned to be cut across
function stripsLayout(g, a, P, C, n, turned = 0) {
  const skin = fm(P.c1, { rough: 0.5 }), flesh = fm(pieceCol(a, P), { rough: 0.5 });
  const L = C.xR - C.xL, m = clamp(Math.round(n) + 1, 3, 10);
  const grp = new THREE.Group();
  // (sticks as wide as they're tall, side by side as long as it was across there – a second layer on top, shorter)
  const sw = (L / m) * 0.88;
  for (let layer = 0; layer < 2; layer++) for (let j = 0; j < m; j++) {
    const xc = C.xL + ((j + 0.5) * L) / m, sc = C.sec(xc);
    if (!sc || sc.ry < 0.002 || (layer && (j === 0 || j === m - 1))) continue;
    const d = sc.rz * 1.9 * (layer ? 0.65 : 1);
    part(grp, GEO.box, [flesh, flesh, flesh, flesh, skin, skin], xc + (j - (m - 1) / 2) * 0.0016 + (layer ? sw * 0.5 : 0), sw * (layer + 0.5), (layer ? 0.004 : 0), sw, sw, d, 0, layer ? 0.08 : 0, 0);
  }
  const wrap = new THREE.Group();
  grp.rotation.y = (clamp(num(turned), 0, 1) * Math.PI) / 2;
  wrap.add(grp);
  g.add(wrap);
  return wrap;
}
// how much of it there is – what it's cut up into heaps up as much
const FILL = { round: 0.52, long: 0.45, bulb: 0.35, egg: 0.5, herb: 0.03, leaf: 0.04, head: 0.45, mushroom: 0.4, block: 0.5, dough: 0.5, pile: 0.4 };
function volumeOf(a) {
  const S = sizeArt(a), w = S.w * K, h = S.h * K;
  return w * h * Math.min(w, h) * (FILL[a.type] ?? 0.4);
}
// (the size of a piece of each cut, for how many lie on a heap's top)
const HEAP_PIECE = { dice: 0.009, mince: 0.0035, grated: 0.008, torn: 0.012, chunks: 0.014 };
// a heap's shape: a dome, lumpy all over (a pile of bits, not a cake) – a few of them, made once
const HEAPS = [];
function heapGeo(i) {
  if (!HEAPS[i]) {
    const geo = new THREE.SphereGeometry(1, 28, 12, 0, TAU, 0, Math.PI / 2), pos = geo.attributes.position, v0 = new THREE.Vector3();
    for (let j = 0; j < pos.count; j++) {
      v0.fromBufferAttribute(pos, j);
      const a = Math.atan2(v0.z, v0.x), up = v0.y, bump = 1 + 0.09 * Math.sin(a * 7 + i * 1.3) * Math.sin(up * 9 + i) + 0.06 * Math.sin(a * 13 + up * 5 + i * 2.1);
      v0.multiplyScalar(up < 0.02 ? 1 : bump);
      pos.setXYZ(j, v0.x, v0.y, v0.z);
    }
    geo.computeVertexNormals();
    HEAPS[i] = geo;
  }
  return HEAPS[i];
}
// a heap's radius: of count pieces (of all it's cut into) of qty of them
function heapRadius(a, cut, count, st) {
  const q = clamp(num(st && st.qty, 1), 1, 8), full = Math.max(1, defaultCount(a, cut, st || {})), units = num(st && st.units, 0);
  const V = (volumeOf(a) * (units > 0 ? Math.min(8, units) : clamp(count / full, 0.03, 1) * q)) / 0.6;
  return Math.max(0.01, Math.cbrt((3 * V) / Math.PI));
}
// (how far from where it's cut its heap lies: clear of it)
const heapGap = (a, cut, count, st) => (HEAP_PIECE[cut] ? heapRadius(a, cut, count, st) + 0.012 : 0.016 + Math.sqrt(count) * 0.0065);
function slitGroove(g, a, st, open) {
  const T = tubeOf(a);
  const fill = st.filling || st.stuffed ? (typeof (st.filling || st.stuffed) === 'string' ? st.filling || st.stuffed : '#b8603a') : '#f2ecd0';
  const top = Math.max(...T.r.map((r, i) => -T.y[i] + r)) * K;
  part(g, GEO.caps, fm(fill, { rough: 0.7 }), 0, top - 0.002, 0, 0.012 * open, T.L * K * 0.36, 0.006 + 0.01 * open, 0, 0, Math.PI / 2);
}

// a little heap / row of pieces
function pieces(g, a, P, cut, count, seed, st) {
  const r = rng(seed);
  const count0 = count;
  count = clamp(count | 0, 1, 40);
  const S = sizeArt(a);
  const W = Math.max(0.04, S.w * K);
  const spread = num(st && st.spread);
  // slit ones (done, on the pile): each whole, its pocket open along the top
  if (cut === 'slit') {
    count = clamp(num(st && st.units, 0) || Math.round(num(st && st.qty, 1)), 1, 8);
    for (let i = 0; i < count; i++) { const h = new THREE.Group(); whole(h, a, P, { ...st, cut: null, qty: 1 }, seed + i * 31, false); slitGroove(h, a, st || {}, 1); h.position.set((i % 2) * 0.01, 0, i * Math.min(S.w, S.h) * K * 1.05); g.add(h); }
    return;
  }
  // diced, minced, grated, torn, in chunks – on the board: a heap as big as what it was cut from (as much of it as
  // has been: count of what there'll be), its pieces all over it
  // (a pile beside the board – spread a little – is a heap too; in a pan it's all over its floor)
  if (HEAP_PIECE[cut] && !Array.isArray(st && st.box) && !(spread > 0.035)) {
    const Rh = heapRadius(a, cut, count0, st), Hh = Rh * (cut === 'mince' || cut === 'grated' ? 0.4 : 0.48);
    const col = pieceCol(a, P);
    part(g, heapGeo(seed % 3), fm(mixHex(col, '#000000', 0.12), { rough: 0.9 }), 0, 0, 0, Rh * 0.9, Hh * 0.88, Rh * 0.76);
    const sz = HEAP_PIECE[cut], m = clamp(Math.round(((Math.PI * Rh * Rh * 0.8) / (sz * sz)) * 0.45), 8, cut === 'mince' || cut === 'grated' ? 70 : 46);
    for (let i = 0; i < m; i++) {
      const an = r() * TAU, d = Math.sqrt(r()), x = Math.cos(an) * d * Rh * 0.95, z = Math.sin(an) * d * Rh * 0.8;
      const h = new THREE.Group();
      piece(h, a, P, cut, 0, 0, r, 1, i, m, true);
      h.position.set(x, Hh * 0.88 * Math.sqrt(Math.max(0, 1 - d * d)) - sz * 0.25, z);
      h.rotation.set((r() - 0.5) * 0.8, r() * TAU, (r() - 0.5) * 0.8);
      g.add(h);
    }
    return;
  }
  if (cut === 'cracked' || cut === 'beaten') {
    // in a pan / bowl: whites and yolks, or beaten yellow
    const ck = clamp(num(st && st.cook), 0, 1);
    // (being whisked – mix 0 … 1: the yolks broken and running, the whites going yellow and frothy, the beaten
    // egg spreading out from the middle till it's all one)
    const mx = cut === 'cracked' ? clamp(num(st && st.mix), 0, 0.99) : 0;
    if (mx > 0) part(g, GEO.cyl, fm(mixHex('#f8e08a', '#f8d55a', mx), { rough: 0.5, opacity: 0.6 + 0.4 * mx }), 0, 0.0025, 0, (spread > 0 ? spread * 0.9 : 0.035) * (0.35 + 0.65 * mx), 0.004, (spread > 0 ? spread * 0.9 : 0.03) * (0.35 + 0.65 * mx));
    for (let i = 0; i < count; i++) {
      let x = (i - (count - 1) / 2) * 0.05, z = 0;
      if (spread > 0) { const an = i * 2.4 + 0.5, d = count > 1 ? Math.max(0, spread - 0.035) * (0.45 + 0.5 * ((i * 0.618) % 1)) : 0; x = Math.cos(an) * d; z = Math.sin(an) * d; }
      if (cut === 'beaten') { part(g, GEO.cyl, fm(mixHex('#f8d55a', '#e8a840', ck), { rough: 0.5 }), x, 0.002, z, spread > 0 ? spread * 0.9 : 0.035, 0.004, spread > 0 ? spread * 0.9 : 0.03); if (spread > 0) break; continue; }
      const sw = 1 - 0.55 * mx;
      part(g, GEO.sphere, fm(mx > 0 ? mixHex('#f4f2ea', '#f6dc78', mx) : ck > 0.2 ? '#fbfaf4' : '#f4f2ea', { rough: 0.3, opacity: ck > 0.2 ? 1 : 0.85 }), x * (1 - 0.4 * mx), 0.002, z * (1 - 0.4 * mx), 0.032 * sw, 0.004, 0.028 * sw);
      part(g, GEO.sphere, fm(mixHex(P.c3, '#f0a020', ck * 0.4), { rough: 0.3 }), x * (1 - 0.4 * mx) + 0.004, 0.006 - 0.003 * mx, z * (1 - 0.4 * mx) - 0.002, 0.012 * (1 + 0.8 * mx) * sw, 0.007 * (1 - 0.6 * mx), 0.012 * (1 + 0.5 * mx) * sw);
    }
    return;
  }
  if (cut === 'rolls') {
    for (let i = 0; i < count; i++) part(g, GEO.caps, fm(P.c1, { rough: 0.5 }), (i % 4 - 1.5) * 0.026, 0.009, Math.floor(i / 4) * 0.026 - 0.02, 0.018, 0.032, 0.018, 0, 0.1, Math.PI / 2);
    return;
  }
  if (cut === 'leaves') { for (let i = 0; i < Math.min(count, 6); i++) leafShape(g, a, P, i, 0.6); return; }
  // in a food container: all over its floor (slices lying flat)
  const box = Array.isArray(st && st.box) ? st.box : null;
  // slices / rings fan out in a row; the rest make a little heap – in a pan, all over its floor
  const row = cut === 'slices' || cut === 'rings' || cut === 'halves' || cut === 'wedges';
  // (slices lean on each other in a row; small bits make a heap, higher in the middle)
  const heapR = 0.016 + Math.sqrt(count) * 0.0065;
  for (let i = 0; i < count; i++) {
    let x, z, y = 0;
    if (box) { x = (r() - 0.5) * box[0] * 0.82; z = (r() - 0.5) * box[1] * 0.78; } else if (spread > 0) { const an = r() * TAU, d = Math.sqrt(r()) * spread; x = Math.cos(an) * d; z = Math.sin(an) * d; } else if (row) { x = (i - (count - 1) / 2) * Math.min(0.016, W / Math.max(1, count)); z = (r() - 0.5) * 0.008; } else { const an = r() * TAU, d = Math.sqrt(r()); x = Math.cos(an) * d * heapR; z = Math.sin(an) * d * heapR * 0.8; y = (1 - d) * heapR * 0.45; }
    const h = new THREE.Group();
    piece(h, a, P, cut, 0, 0, r, 1, i, count, spread > 0 || !!box);
    h.position.set(x, y, z);
    if (spread > 0 || box) h.rotation.y = r() * TAU;
    g.add(h);
  }
}
// one piece (its colour: the flesh, or the skin for small bits of some)
function piece(g, a, P, cut, x, z, r, s = 1, i = 0, count = 1, lying = false) {
  const flesh = fm(cut === 'dice' || cut === 'mince' || cut === 'chunks' || cut === 'strips' || cut === 'grated' || cut === 'torn' || cut === 'crushed' ? pieceCol(a, P) : P.c2, { rough: 0.5 });
  // (an egg cut up is a shelled one: white outside, its yolk in the middle of the cut)
  const skin = fm(a.type === 'egg' ? P.c2 : P.c1, { rough: 0.5 });
  const yolk = a.type === 'egg' ? fm(mixHex(P.c3, '#f6e7a0', 0.35), { rough: 0.7 }) : null;
  let R = 0.026;
  if (a.type === 'round') R = roundDims(a).rx * K * 0.9;
  else if (a.type === 'long') { const T = tubeOf(a); R = T.r[Math.floor(T.N / 2)] * K * 1.0; }
  else if (a.type === 'block') { const bs = BLOCK_SIZE[a.shape] || [104, 54]; R = bs[1] * K * 0.45; }
  else if (a.type === 'bulb') R = 0.012;
  else if (a.type === 'mushroom') R = 0.028;
  else if (a.type === 'egg') R = 0.02;
  R *= s;
  switch (cut) {
    case 'slices': {
      const t = Math.max(0.003, R * 0.12);
      // (leaning on the next one in a row; in a pan, lying flat)
      if (lying) { part(g, GEO.cyl, [skin, flesh, flesh], x, t * 0.6, z, R, t, R, (r() - 0.5) * 0.2, 0, (r() - 0.5) * 0.2); break; }
      const tilt = 1.05 + r() * 0.2;
      part(g, GEO.cyl, [skin, flesh, flesh], x, R * Math.cos(tilt) + t, z, R, t, R, tilt, 0, -0.15 + r() * 0.3);
      break;
    }
    // (a hollow thing's ring is its skin – a pepper's green; an onion's is its flesh)
    case 'rings': {
      part(g, GEO.torus, a.type === 'long' ? skin : flesh, x, 0.004, z, R * 0.9, R * 0.9, 0.006, Math.PI / 2 - (lying ? 0.02 : 0.25), 0, 0);
      // (fried: blistered brown here and there)
      if (P.ck > 0.3) { const sear = fm(mixHex('#7a4a1e', P.c1, 0.3), { rough: 0.7 }); for (let j = 0; j < 2; j++) { const an = (i * 2.4 + j * 3.3) % TAU; part(g, GEO.sphereLo, sear, x + Math.cos(an) * R * 0.9, 0.0062, z + Math.sin(an) * R * 0.9, R * 0.5 * P.ck, 0.0018, R * 0.32 * P.ck, 0, an, 0); } }
      break;
    }
    case 'halves': {
      const h = new THREE.Group();
      if (yolk) {
        // (a boiled egg's halves lie cut face up: the white round the yolk)
        part(h, GEO.hemi, skin, 0, 0, 0, R, R * 0.9, R * 1.25, Math.PI, 0, 0);
        part(h, GEO.disc, flesh, 0, 0.0004, 0, R * 0.98, R * 1.22, 1, -Math.PI / 2, 0, 0);
        part(h, GEO.sphere, yolk, 0, 0.0005, 0, R * 0.52, R * 0.14, R * 0.62);
        h.position.set(x, R * 0.9, z);
        h.rotation.y = i * 0.5;
        g.add(h);
        break;
      }
      part(h, GEO.hemi, skin, 0, 0, 0, R, R, R * 0.95);
      part(h, GEO.disc, flesh, 0, 0.0005, 0, R * 0.96, R * 0.96, R * 0.96, -Math.PI / 2, 0, 0);
      if (yolk) part(h, GEO.sphere, yolk, 0, 0, 0, R * 0.55, R * 0.12, R * 0.52);
      h.rotation.x = i % 2 ? Math.PI / 2 : -Math.PI / 2 + 0.2; // (cut face up / to the side)
      h.position.set(x, R * 0.9, z);
      g.add(h);
      break;
    }
    case 'wedges': {
      const geo = new THREE.CylinderGeometry(R, R, R * 0.5, 10, 1, false, 0, Math.PI * 0.55);
      part(g, geo, [skin, flesh, flesh], x, R * 0.25, z, 1, 1, 1, 0, r() * TAU, 0);
      break;
    }
    case 'strips': part(g, GEO.box, flesh, x, 0.003, z, 0.004, 0.004, Math.max(0.02, R * 1.6), 0, r() * 0.6 - 0.3, 0); break;
    case 'mince': part(g, GEO.box, flesh, x, 0.0018, z, 0.0035, 0.0035, 0.0035, r(), r(), r()); break;
    case 'grated': part(g, GEO.cylLo, flesh, x, 0.0015, z, 0.0012, 0.012, 0.0012, Math.PI / 2, r() * TAU, 0); break;
    case 'torn': if (a.type === 'block') part(g, GEO.sphereLo, flesh, x, 0.005, z, 0.012, 0.006, 0.01, 0, r() * TAU, 0); else part(g, GEO.sphereLo, flesh, x, 0.002, z, 0.01, 0.0015, 0.008, 0, r() * TAU, 0); break;
    case 'crushed': part(g, GEO.sphereLo, flesh, x, 0.003, z, 0.008, 0.003, 0.007, 0, r() * TAU, 0); break;
    case 'chunks': part(g, GEO.box, flesh, x, 0.007, z, 0.014, 0.014, 0.014, r() * 0.3, r() * TAU, 0); break;
    default: part(g, GEO.box, flesh, x, 0.0045, z, 0.009, 0.009, 0.009, r() * 0.3, r() * TAU, 0); break; // dice
  }
}
