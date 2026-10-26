// The kitchen's equipment, modelled after the real things (manufacturers'
// photos and specs: WMF, Zwilling, Fissler, Rösle, OXO, Le Creuset … – the
// notes by each model say what it follows): the cutlery and the utensils,
// the board's knife, peeler and grater, the bottles and jars.
//
// Sizes are real (CM: a centimetre in kitchen units – a counter is 90 cm).
// A tool is held at its origin – where a fist takes it – its working end down
// (-y), its handle up (+y), a flat one's faces toward ±z; an upright one
// (a bottle, a jar, the grater) stands on its foot, utensilFoot below the origin.
import * as THREE from 'three';
import { mat } from './parts3d.js';

export const CM = 0.46 / 90;

// ------------------------------------------------------------------ shapes

// a smooth curve through [a, b] pairs (Catmull-Rom), sampled n + 1 times: [[a, b], …]
export function smooth(pts, n = 24) {
  const c = new THREE.SplineCurve(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  return c.getSpacedPoints(n).map((p) => [p.x, p.y]);
}
// a piecewise-linear lookup in [[x, y], …] (x ascending)
export function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1); }
  }
  return pts[pts.length - 1][1];
}
// a smooth curve through [x, y] points as a lookup y(x) (a Catmull-Rom spline, x ascending)
const SPLINES = new WeakMap();
export function spline(pts, x) {
  let d = SPLINES.get(pts);
  if (!d) { d = smooth(pts, Math.max(48, pts.length * 16)); SPLINES.set(pts, d); }
  return interp(d, x);
}
// A turned body from its profile: [r, y] points (cm), smoothed, as a lathe (kitchen units).
export function turned(profile, m, { seg = 28, n = 40, sharp = false } = {}) {
  const pts = (sharp ? profile : smooth(profile, n)).map(([r, y]) => new THREE.Vector2(Math.max(0, r) * CM, y * CM));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), m);
  return mesh;
}

// A flat piece – cutlery, a blade, a turner's head – from its outline seen
// from above: half its width at stations along its length (s: 0 at the
// handle's end … L at the tip, cm), as thick as thick(s, u) (u: -1 one edge
// … 1 the other), bent up off the line of the handle by lift(s) and hollowed
// by dish(s, u) (a spoon's bowl). It runs down -y from y = grip (cm, where
// the hand holds it); its faces look along ±z (+z its top).
export function slab({ widths, thick, lift = () => 0, dish = () => 0, grip = 0, steps = 60, across = 10, x = (s, u, hw) => u * hw }) {
  const L = widths[widths.length - 1][0];
  const hwAt = (s) => Math.max(0.0005, spline(widths, s));
  const top = [], bot = [];
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * L, hw = hwAt(s);
    const rowT = [], rowB = [];
    for (let j = 0; j <= across; j++) {
      const u = (j / across) * 2 - 1;
      const t = thick(s, u) / 2, z = lift(s) - dish(s, u);
      const px = x(s, u, hw), py = grip - s;
      rowT.push([px, py, z + t]); rowB.push([px, py, z - t]);
    }
    top.push(rowT); bot.push(rowB);
  }
  const pos = [], idx = [];
  const add = (p) => { pos.push(p[0] * CM, p[1] * CM, p[2] * CM); return pos.length / 3 - 1; };
  const grid = (rows, flip) => {
    const base = pos.length / 3;
    rows.forEach((r) => r.forEach(add));
    const w = rows[0].length;
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < w - 1; j++) {
      const a = base + i * w + j, b = a + 1, c = a + w, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  };
  // (wound so each face looks outward: the top +z, the bottom −z, the sides out across it, the ends along it)
  grid(top, true);
  grid(bot, false);
  // the edges all round: the two sides along it, the ends
  const side = (j, flip) => grid(top.map((r, i) => [r[j], bot[i][j]]), flip);
  side(0, false); side(across, true);
  grid([top[0], bot[0]], false); grid([top[steps], bot[steps]], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A tube swept along a smooth path through pts ([x, y, z] cm), its section an
// ellipse w(t) across × h(t) (half-widths, cm; t 0 … 1 along it) – h in the
// direction of `up` as seen across the path (a flat handle stays flat).
export function sweep(pts, w, h = w, { seg = 40, radial = 14, up = [0, 0, 1], caps = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const P = curve.getSpacedPoints(seg), U = new THREE.Vector3(...up).normalize();
  const W = typeof w === 'function' ? w : () => w, H = typeof h === 'function' ? h : () => h;
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, T = curve.getTangentAt(Math.min(1, Math.max(0, t))).normalize();
    let S = new THREE.Vector3().crossVectors(T, U);
    if (S.lengthSq() < 1e-6) S = new THREE.Vector3().crossVectors(T, new THREE.Vector3(1, 0, 0));
    S.normalize();
    const N = new THREE.Vector3().crossVectors(S, T).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const p = P[i].clone().addScaledVector(S, Math.cos(a) * W(t)).addScaledVector(N, Math.sin(a) * H(t));
      pos.push(p.x * CM, p.y * CM, p.z * CM);
      uv.push(j / radial, t);
    }
  }
  const r1 = radial + 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * r1 + j, b = a + 1, c = a + r1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (caps) for (const [i, flip] of [[0, true], [seg, false]]) {
    const c = pos.length / 3;
    pos.push(P[i].x * CM, P[i].y * CM, P[i].z * CM);
    uv.push(0.5, i / seg);
    for (let j = 0; j < radial; j++) { const a = i * r1 + j; if (flip) idx.push(c, a, a + 1); else idx.push(c, a + 1, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ materials
export const MATS = {
  steel: () => mat('#d2d6db', { metal: 0.9, rough: 0.22 }),       // polished 18/10
  brushed: () => mat('#c3c8ce', { metal: 0.85, rough: 0.38 }),    // satin / brushed
};

// ------------------------------------------------------------------ the board's knife
// After the Wüsthof Classic 20 cm cook's knife: a forged blade, its spine
// straight then dropping to the tip a fifth of the way down, the edge straight
// from the heel then sweeping up; a full bolster; a black POM handle on the
// full tang with three steel rivets and the red logo, its butt hooking down.
// Its own frame (the work's knife moves by it – see scene3d knifeAt): the
// blade forward along +x from the bolster at the origin, its edge down (-y,
// about 0.022 below), the faces ±z; the handle back along -x. (A little larger
// than life – 1.2× – as it always was, so it reads on the board.)
const KN = CM * 1.2;
// (measured from Wüsthof's side photo: [s, spine, edge] from the bolster's front to the tip, and the
// handle [s, top, bottom] back from the bolster to the butt – cm, y up from the handle's centre line)
const BLADE_TOP = [[0, 1.04], [0.8, 1.02], [3.3, 0.98], [5.8, 0.89], [8.3, 0.85], [10.8, 0.77], [12.4, 0.66], [14.1, 0.54], [15.8, 0.35], [17.4, 0.08], [18.3, -0.07], [19.1, -0.3], [19.9, -0.58]];
const BLADE_BOT = [[0, -3.46], [0.8, -3.61], [3.3, -3.61], [5.8, -3.57], [8.3, -3.48], [10.8, -3.29], [12.4, -3.1], [14.1, -2.83], [15.8, -2.46], [17.4, -1.95], [18.3, -1.6], [19.1, -1.2], [19.9, -0.6]];
const HANDLE_TOP = [[0, 1.05], [0.7, 1.08], [2.3, 1.17], [4.0, 1.23], [5.7, 1.33], [7.3, 1.38], [9.0, 1.42], [9.8, 1.4], [10.6, 1.38], [11.5, 1.23]];
const HANDLE_BOT = [[0, -1.0], [0.7, -0.97], [2.3, -1.1], [4.0, -1.33], [5.7, -1.41], [7.3, -1.39], [9.0, -1.43], [9.8, -1.97], [10.6, -2.08], [11.5, -1.62]];
const BOLSTER = 1.0;
// how far below the knife's line its edge is at x along it (kitchen units) – where the work's cut meets the food
export function knifeEdgeAt(x) { return -spline(BLADE_BOT, Math.max(0, x / KN - BOLSTER)) * KN; }
export function chefKnifeMesh() {
  const g = new THREE.Group();
  const satin = mat('#c8ccd0', { metal: 0.9, rough: 0.3 }), polished = mat('#d8dbde', { metal: 0.95, rough: 0.12 }), pom = mat('#1b1b1e', { rough: 0.35 }), rivet = mat('#c0c4c8', { metal: 0.9, rough: 0.25 });
  // (a side view as a slab: its width ↔ height, its length along x)
  const side = (len, top, bot, th, m, x0, back = false) => {
    const geo = slab({ widths: [[0, 1], [len, 1]], thick: th, steps: 80, across: 14, x: (s, u) => spline(bot, s) + ((u + 1) / 2) * (spline(top, s) - spline(bot, s)) });
    geo.scale(KN / CM, KN / CM, KN / CM);
    geo.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    if (back) mesh.rotation.y = Math.PI;
    mesh.position.x = x0 * KN;
    return mesh;
  };
  // the blade: 3 mm at the spine by the bolster, thinning toward the tip, ground to an edge over its last cm
  g.add(side(19.9, BLADE_TOP, BLADE_BOT, (s, u) => { const k = (u + 1) / 2, sp = 0.3 - (s / 19.9) * 0.22; return 0.02 + (sp - 0.02) * Math.min(1, Math.pow(k * 4.6 / 1.0, 0.6) * 0.35 + k * 0.65); }, satin, BOLSTER));
  // the forged bolster, the blade's depth at its front, flowing into it in a concave shoulder
  g.add(side(BOLSTER, [[0, 1.06], [BOLSTER, 1.05]], [[0, -1.0], [0.5, -2.4], [BOLSTER, -3.46]], (s, u) => 1.0 * Math.sqrt(Math.max(0.1, 1 - u * u * 0.7)), polished, 0));
  // the handle: POM scales on the full tang (its steel showing along the top and the bottom), the butt hooking down
  g.add(side(11.5, HANDLE_TOP, HANDLE_BOT, (s, u) => 1.9 * Math.sqrt(Math.max(0, 1 - u * u)), pom, 0, true));
  g.add(side(11.3, HANDLE_TOP.map(([a, b]) => [a, b + 0.05]), HANDLE_TOP.map(([a, b]) => [a, b - 0.12]), () => 0.18, polished, 0, true));
  g.add(side(11.3, HANDLE_BOT.map(([a, b]) => [a, b + 0.12]), HANDLE_BOT.map(([a, b]) => [a, b - 0.05]), () => 0.18, polished, 0, true));
  // three flush rivets, the red trident between the second and the third
  for (const z of [-1, 1]) {
    for (const x of [2.4, 6.4, 10.4]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * KN, 0.3 * KN, 0.05 * KN, 16), rivet); r.rotation.x = Math.PI / 2; r.position.set(-x * KN, (spline(HANDLE_TOP, x) + spline(HANDLE_BOT, x)) / 2 * KN, z * 0.93 * KN); g.add(r); }
    const logo = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * KN, 0.42 * KN, 0.04 * KN, 18), mat('#c8102e', { rough: 0.4 }));
    logo.rotation.x = Math.PI / 2; logo.position.set(-8.4 * KN, 0.0, z * 0.93 * KN); g.add(logo);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ------------------------------------------------------------------ cutlery
// After WMF Boston (Cromargan 18/10, high polish) – outlines measured from WMF's
// own top views (half-widths, cm, from the handle's end): the fork 19.7 cm,
// the table spoon 19.9, the teaspoon 13.1, the monoblock table knife 22.6.
// Square-ended handles tapering to a slim neck; the fork's head flaring to
// four tines 3.8 cm long (round-bottomed slots); the spoon's bowl egg-shaped,
// widest 3.5 cm from its tip, 0.85 deep; the knife's spine straight on from
// the handle, all the curve on the edge side – a rounded knuckle, then
// parallel, then up to a round tip. Seen from the side the handles are flat,
// the neck drops in an S, the head or bowl sits below the handle's plane.
const half = (pts) => pts.map(([s, w]) => [s, w / 2]);
const FORK = half([[0, 1.21], [1, 1.21], [2, 1.17], [3, 1.12], [4, 1.07], [5, 1.0], [6, 0.94], [7, 0.86], [8, 0.77], [9, 0.67], [10, 0.6], [11, 0.54], [12, 0.5], [12.8, 0.57], [13.3, 0.86], [13.8, 1.46], [14.3, 2.02], [14.8, 2.36], [15.3, 2.47], [15.9, 2.48]]);
const SPOON = half([[0, 1.26], [1, 1.26], [2, 1.23], [3, 1.18], [4, 1.11], [5, 1.02], [6, 0.95], [7, 0.87], [8, 0.78], [9, 0.71], [10, 0.61], [11, 0.54], [12, 0.52], [12.9, 0.58], [13.4, 0.92], [13.9, 1.82], [14.4, 2.77], [14.9, 3.4], [15.4, 3.81], [15.9, 3.98], [16.4, 4.02], [16.9, 3.96], [17.4, 3.78], [17.9, 3.51], [18.4, 3.14], [18.9, 2.63], [19.4, 1.87], [19.75, 0.9], [19.9, 0.15]]);
const TEASPOON = half([[0, 0.85], [1, 0.86], [2, 0.81], [3, 0.74], [4, 0.66], [5, 0.57], [6, 0.49], [7, 0.42], [8, 0.39], [8.6, 0.4], [9.1, 0.83], [9.6, 1.83], [10.1, 2.46], [10.6, 2.67], [11.1, 2.65], [11.6, 2.5], [12.1, 2.16], [12.6, 1.6], [12.95, 0.8], [13.1, 0.12]]);
// (the side profile: the handle flat – its end flicking up a little – the neck dropping in an S to the head)
const dropTo = (neck0, neck1, drop, flick = 0.3, flickLen = 1.5) => (s) => (s < flickLen ? flick * (1 - s / flickLen) ** 2 : 0) - (s < neck0 ? 0 : s > neck1 ? drop : drop * ((t) => t * t * (3 - 2 * t))((s - neck0) / (neck1 - neck0)));

export function forkMesh() {
  const g = new THREE.Group(), steel = MATS.steel();
  const L = 19.7, root = 15.9, grip = 6.5, base = dropTo(12, 14, 0.5);
  const lift = (s) => base(s) + (s > L - 3 ? 0.35 * ((s - (L - 3)) / 3) ** 2 : 0);
  const thick = (s) => (s < 12 ? 0.3 - s * 0.0067 : 0.21);
  g.add(new THREE.Mesh(slab({ widths: FORK, thick, lift, dish: (s, u) => (s > 13.5 ? 0.1 * (1 - u * u) : 0), grip, steps: 70 }), steel));
  // four tines: the outer ones 0.45 at the root (the head's edge flares into them), the inner 0.35, all
  // tapering to rounded points 0.17 across; the slots 0.2 at the root, 0.28 at the tips
  const tine = (cx0, cx1, w0) => slab({ widths: [[0, w0 / 2], [1.5, (w0 * 0.75) / 2], [3.3, 0.1], [3.7, 0.075], [3.85, 0.02]], thick: () => 0.2, lift: (s) => lift(root - 0.15 + s), grip: grip - root + 0.15, steps: 24, across: 4, x: (s, u, hw) => cx0 + (cx1 - cx0) * (s / 3.85) + u * hw });
  for (const [c0, c1, w0] of [[-1.015, -0.77, 0.45], [-0.335, -0.255, 0.35], [0.335, 0.255, 0.35], [1.015, 0.77, 0.45]]) g.add(new THREE.Mesh(tine(c0, c1, w0), steel));
  return finish(g);
}

function spoonMesh(W, L, b0, k) {
  const g = new THREE.Group(), steel = MATS.steel();
  const grip = 6.5 * k, base = dropTo(12.4 * k, 13.9 * k, 0.35 * k, 0.3 * k, 1.5 * k);
  const lift = (s) => base(s) + (s > b0 ? Math.tan(0.087) * (s - b0) * 0.6 : 0); // (the rim tilting up toward the tip, 5°)
  const depth = 0.85 * k, deep = L - 3.5 * k; // (deepest under where it's widest)
  const dish = (s, u) => (s < b0 ? 0 : depth * Math.sin(Math.PI * Math.min(1, (s - b0) / (L - b0))) ** 0.7 * (1 - u * u) * (1 - 0.15 * Math.abs(s - deep) / (L - b0)));
  const thick = (s) => (s < 12.4 * k ? (0.3 - s * 0.0097) * k ** 0.5 : 0.15);
  g.add(new THREE.Mesh(slab({ widths: W, thick, lift, dish, grip, steps: 90, across: 16 }), steel));
  return finish(g);
}
export const spoonDinnerMesh = () => spoonMesh(SPOON, 19.9, 13.3, 1);
export const teaspoonMesh = () => spoonMesh(TEASPOON, 13.1, 8.9, 13.1 / 19.9);

export function tableKnifeMesh() {
  const g = new THREE.Group(), steel = MATS.steel();
  const L = 22.6, grip = 6, h0 = 10.5;
  // its spine (+) dead straight on from the handle's top; the edge side (−) swelling into the blade
  const W = [[0, 1.41], [1, 1.44], [2, 1.41], [3, 1.37], [4, 1.32], [5, 1.28], [6, 1.22], [7, 1.18], [8, 1.11], [9, 1.05], [10.5, 1.02], [11, 1.11], [11.5, 1.29], [12.1, 1.51], [12.6, 1.68], [13.1, 1.79], [13.6, 1.85], [14.6, 1.89], [15.6, 1.89], [16.6, 1.81], [17.6, 1.71], [18.6, 1.61], [19.6, 1.45], [20.6, 1.29], [21.6, 1.04], [22.1, 0.84], [22.6, 0.05]];
  const top = W.map(([s, w]) => [s, s < h0 ? w / 2 : 0.51 - (s > 21 ? (s - 21) * 0.3 : 0)]), bot = W.map(([s, w], i) => [s, top[i][1] - w]);
  const blade = (s, u) => 0.05 + 0.15 * ((u + 1) / 2) * (1 - (s - h0) / 16);
  const thick = (s, u) => { const hd = (0.85 - s * 0.014) * Math.sqrt(Math.max(0.05, 1 - u * u)); if (s < h0 - 0.6) return hd; if (s > h0 + 1.4) return blade(s, u); const t = (s - h0 + 0.6) / 2, e = t * t * (3 - 2 * t); return hd * (1 - e) + blade(h0 + 1.4, u) * e; };
  g.add(new THREE.Mesh(slab({ widths: [[0, 1], [L, 1]], thick, lift: dropTo(10, 12, 0.25), grip, steps: 90, across: 12, x: (s, u) => spline(bot, s) + ((u + 1) / 2) * (spline(top, s) - spline(bot, s)) }), steel));
  return finish(g);
}

// (shadows; how far below its origin it reaches lying on its face, standing on its foot)
function finish(g) {
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const b = new THREE.Box3().setFromObject(g);
  g.userData.under = -b.min.z; g.userData.foot = -b.min.y;
  return g;
}

// ------------------------------------------------------------------ holes
// A perforated sheet's look: round (or slotted) holes cut through it, as an
// alpha map – the turner's head, the masher's plate, a colander, the grater.
const HOLES = new Map();
export function holesMap(cols, rows, { r = 0.32, slot = 1, margin = 0.08, stagger = false } = {}) {
  const key = `${cols}|${rows}|${r}|${slot}|${margin}|${stagger}`;
  let t = HOLES.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 256; c.height = Math.round(256 * rows / cols) || 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#000';
  const W = c.width * (1 - 2 * margin), H = c.height * (1 - 2 * margin), cw = W / cols, ch = H / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const off = stagger && j % 2 ? cw / 2 : 0;
    if (stagger && j % 2 && i === cols - 1) continue;
    const cx = c.width * margin + cw * (i + 0.5) + off, cy = c.height * margin + ch * (j + 0.5);
    x.beginPath(); x.ellipse(cx, cy, cw * r, ch * r * slot, 0, 0, Math.PI * 2); x.fill();
  }
  t = new THREE.CanvasTexture(c);
  HOLES.set(key, t);
  return t;
}
function perforated(color, holes, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: o.rough ?? 0.3, alphaMap: holes, alphaTest: 0.5, side: THREE.DoubleSide });
  return m;
}

// ------------------------------------------------------------------ utensils
// After Rösle's (18/10 stainless, brushed handles, a hook or a ring to hang it by).

// the soup ladle: a hemispherical bowl 9 cm across, 4 cm deep; its flat handle strip (1.3 × 0.3 cm)
// rising from the back of the rim in a gentle S, folded over into a hook at its end. 31 cm.
export function ladleMesh() {
  const g = new THREE.Group(), steel = MATS.steel(), brushed = MATS.brushed();
  const R = 4.5, D = 4.1, grip = 16;
  // (the bowl: level when the handle hangs straight down from the hand – its rim at y = -grip + … )
  const prof = [];
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI / 2; prof.push([R * Math.sin(a), -D * Math.cos(a)]); }
  const bowl = turned([...prof, [R + 0.1, 0.0], [R + 0.35, 0.25], [R + 0.3, 0.32]], mat('#e4e6e8', { metal: 0.9, rough: 0.1, double: true }), { seg: 32, sharp: true }); // (its lip flaring out 45°)
  const by = -grip - 1.0;
  bowl.position.set(0, by * CM, R * 0.92 * CM);
  g.add(bowl);
  // the handle: from the rim at the back of the bowl up to the hook
  const path = [[0, by + 0.1, 0.2], [0, by + 2.5, -0.35], [0, by + 6, -0.55], [0, -2, -0.6], [0, 8, -0.6], [0, 11.6, -0.6], [0, 12.3, -0.1], [0, 12.1, 0.55], [0, 10.4, 0.7]];
  // (the strip widening from 0.7 at the bowl to 1.5 at the hook, 0.3 thick)
  g.add(new THREE.Mesh(sweep(path, (t) => 0.35 + 0.4 * Math.min(1, t * 1.15), 0.15, { radial: 10, up: [1, 0, 0], seg: 60 }), brushed));
  return finish(g);
}

// the balloon whisk: eight loops of 1.6 mm wire, 16 cm long and 6.6 cm across at their widest (two
// thirds of the way down), gathered into a cone collar on a 1.9 cm tube handle 11 cm long, a ring at its end.
export function whiskMesh() {
  const g = new THREE.Group(), steel = MATS.steel(), wire = mat('#dfe3e8', { metal: 0.9, rough: 0.25 });
  const grip = 4.5, top = grip + 6.2, collar = grip - 5;
  g.add(new THREE.Mesh(sweep([[0, collar, 0], [0, collar + 0.9, 0], [0, top - 0.6, 0], [0, top, 0]], (t) => (t < 0.08 ? 0.62 + t * 3.5 : t > 0.96 ? 0.95 - (t - 0.96) * 6 : 0.95), undefined, { seg: 30, radial: 20, up: [1, 0, 0] }), MATS.brushed()));
  // the ring to hang it by
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0 * CM, 0.22 * CM, 8, 24), steel);
  ring.position.set(0, (top + 1.15) * CM, 0);
  g.add(ring);
  // the collar the wires go into
  g.add(turned([[0, collar - 1.5], [0.32, collar - 1.5], [0.66, collar - 0.2], [0.66, collar + 0.2]], steel, { seg: 20 }));
  // (its envelope measured from WMF's: [distance from the tip, diameter] – widest a quarter of the way up from it)
  const L = 17.2, y0 = collar - 1.4, ENV = [[0, 0], [0.4, 1.3], [1.1, 3.5], [2.2, 5.5], [3, 6.1], [4.5, 6.5], [6, 6.2], [7.5, 5.65], [9, 4.9], [10.5, 4.1], [12, 3.25], [13.5, 2.5], [15, 1.85], [16.5, 1.47], [17.2, 1.4]];
  const half = (d) => interp(ENV, L - d) / 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    const pts = [];
    for (let k = 0; k <= 20; k++) { const d = (k / 20) * L; pts.push([-half(d), y0 - d - (k === 20 ? (i % 4) * 0.12 : 0)]); }
    for (let k = 19; k >= 0; k--) { const d = (k / 20) * L; pts.push([half(d), y0 - d]); }
    const geo = sweep(pts.map(([x, y]) => [x * Math.cos(a), y, x * Math.sin(a)]), 0.09, 0.09, { seg: 90, radial: 5, up: [Math.sin(a), 0, -Math.cos(a)], caps: false });
    g.add(new THREE.Mesh(geo, wire));
  }
  return finish(g);
}

// the slotted turner: a flat head 7.5 cm wide at its thin front edge (5 cm at the back), 10.5 cm long,
// with 20 holes in rows; a cranked neck stepping it down from the handle strip; a hook at the end. 34 cm.
export function turnerMesh() {
  const g = new THREE.Group(), brushed = MATS.brushed();
  g.add(new THREE.Mesh(sweep([[0, -3.6, 1.1], [0, -1, 0.6], [0, 8, 0], [0, 15.6, 0], [0, 16.4, -0.5], [0, 16.0, -1.15], [0, 14.8, -1.25]], (t) => 0.7 - 0.08 * t, 0.17, { radial: 10, up: [0, 0, 1], seg: 50 }), brushed));
  // the neck stepping down to the head
  g.add(new THREE.Mesh(sweep([[0, -3.6, 1.1], [0, -5.2, 1.5], [0, -6.4, 2.1], [0, -7.4, 2.25]], (t) => 0.62 - 0.12 * t, 0.15, { radial: 10, up: [0, 0, 1], seg: 20 }), brushed));
  const head = slab({ widths: [[0, 2.5], [2, 2.7], [8.5, 3.6], [10.2, 3.75], [10.5, 3.5]], thick: (s) => 0.16 - s * 0.01, grip: 0, steps: 20, across: 8 });
  const m = new THREE.Mesh(head, perforated('#c9ced4', holesMap(4, 5, { r: 0.3, margin: 0.14 })));
  // (the alpha map runs across its outline: u along x, v along its length)
  setUV(head, (x, y) => [x / (7.5 * CM) + 0.5, -y / (10.5 * CM)]);
  m.position.set(0, -7.3 * CM, 2.25 * CM);
  g.add(m);
  return finish(g);
}
// (planar texture coordinates for a geometry from its x, y)
function setUV(geo, f) {
  const p = geo.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push(...f(p.getX(i), p.getY(i), p.getZ(i)));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

// the tongs: two springy arms 30 cm long, 1.6 cm wide, hinged at the end with a pull-ring lock and a
// hanging eye; their heads scalloped cups 4.5 cm long; they lie open a little.
export function tongsMesh() {
  const g = new THREE.Group(), brushed = MATS.brushed(), steel = MATS.steel();
  const grip = 9;
  for (const sx of [-1, 1]) {
    const pts = [[sx * 0.55, grip + 1, 0], [sx * 0.8, grip - 4, 0], [sx * 1.4, grip - 12, 0], [sx * 2.2, grip - 20, 0], [sx * 2.4, grip - 24.5, 0], [sx * 2.2, grip - 27.5, 0], [sx * 1.6, grip - 29, 0]];
    g.add(new THREE.Mesh(sweep(pts, 0.1, (t) => (t < 0.78 ? 0.8 : 0.8 + 0.5 * Math.sin(Math.PI * Math.min(1, (t - 0.78) / 0.22) * 0.9)), { radial: 10, up: [0, 0, 1], seg: 60 }), brushed));
  }
  // the hinge end: a rounded cap, the lock ring, the eye
  g.add(new THREE.Mesh(sweep([[0, grip + 0.6, 0], [0, grip + 2.1, 0]], 1.0, 0.85, { radial: 16, seg: 4 }), steel));
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.6 * CM, 0.16 * CM, 8, 18), steel);
  eye.position.set(0, (grip + 2.8) * CM, 0); g.add(eye);
  const lock = new THREE.Mesh(new THREE.TorusGeometry(0.75 * CM, 0.12 * CM, 6, 18), steel);
  lock.rotation.x = Math.PI / 2; lock.position.set(0, (grip - 2.5) * CM, 0); g.add(lock);
  return finish(g);
}

// the masher: a perforated plate 9.5 × 5 cm on two steel struts spreading down from a flange
// under a tube handle (2.4 cm, 11 cm long). 26 cm.
export function masherMesh() {
  const g = new THREE.Group(), brushed = MATS.brushed(), steel = MATS.steel();
  const grip = 6, top = grip + 5.5, fl = grip - 5.5, pl = fl - 13.5;
  g.add(new THREE.Mesh(sweep([[0, fl, 0], [0, top - 0.5, 0], [0, top, 0]], (t) => (t > 0.95 ? 1.2 - (t - 0.95) * 8 : 1.2), undefined, { radial: 22, seg: 12, up: [1, 0, 0] }), brushed));
  g.add(turned([[0, fl - 0.2], [2.0, fl - 0.2], [2.0, fl], [1.0, fl + 0.25]], steel, { seg: 28, sharp: true })); // (the guard disc, Ø4)
  for (const sx of [-1, 1]) g.add(new THREE.Mesh(sweep([[sx * 0.5, fl, 0], [sx * 2.4, fl - 6, 0], [sx * 4.1, pl + 0.7, 0], [sx * 4.3, pl + 0.1, 0]], 0.6, 0.15, { radial: 8, seg: 20, up: [0, 0, 1] }), brushed)); // (flat arms in a V)
  const pg = new THREE.CylinderGeometry(4.55 * CM, 4.55 * CM, 0.15 * CM, 36, 1);
  setUV(pg, (x, y, z) => [x / (9.1 * CM) + 0.5, z / (9.1 * CM) + 0.5]);
  const plate = new THREE.Mesh(pg, perforated('#c9ced4', holesMap(7, 7, { r: 0.3, margin: 0.12, stagger: true })));
  plate.position.set(0, pl * CM, 0);
  g.add(plate);
  return finish(g);
}

// ------------------------------------------------------------------ the board's grater
// After the classic four-sided steel box grater (IKEA IDEALISK, Westmark): a
// tapering box 19 cm tall – 10.5 × 8 cm at its foot, 6 × 4.5 at the top –
// each face different: coarse, medium, fine (rasp), and the slicing slot; a
// rolled rim round the foot, a steel strap handle over the top. Held by the
// handle at its origin, its foot 0.115 below (as the board's own always was).
const FACES = new Map();
function graterFace(kind) {
  let t = FACES.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, '#cfd4d9'); gr.addColorStop(0.5, '#eef1f4'); gr.addColorStop(1, '#c4c9cf');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 256);
  const hole = (cx, cy, w, h) => {
    x.fillStyle = '#3c4148'; x.beginPath(); x.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(1, h * 0.35); x.beginPath(); x.ellipse(cx, cy + h * 0.3, w * 0.9, h * 0.8, 0, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); // (the raised lip)
  };
  if (kind === 'coarse') for (let j = 0; j < 9; j++) for (let i = 0; i < 4; i++) hole(22 + i * 28 + (j % 2) * 10, 22 + j * 26, 8, 5);
  if (kind === 'medium') for (let j = 0; j < 14; j++) for (let i = 0; i < 6; i++) hole(14 + i * 20 + (j % 2) * 6, 14 + j * 17.5, 4.5, 3);
  if (kind === 'fine') for (let j = 0; j < 30; j++) for (let i = 0; i < 11; i++) { x.fillStyle = (i + j) % 2 ? '#5a6068' : '#7a8088'; x.fillRect(8 + i * 10.5 + (j % 2) * 4, 8 + j * 8, 3, 3); }
  if (kind === 'slice') { for (const y of [70, 160]) { x.fillStyle = '#3c4148'; x.fillRect(22, y, 84, 12); x.fillStyle = '#ffffff'; x.fillRect(22, y + 12, 84, 3); } }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  FACES.set(kind, t);
  return t;
}
export function graterMesh() {
  const g = new THREE.Group();
  const H = 18, foot = -22.5, top = foot + H; // (cm: the handle at the origin, the foot 22.5 below – 0.115, as the board's own always stood)
  const B = [5.0, 4.0], T = [4.35, 3.25];
  const kinds = ['coarse', 'medium', 'fine', 'slice'];
  // the four faces, each its own panel leaning in toward the top
  const corners = (w, d, y) => [[-w, y, d], [w, y, d], [w, y, -d], [-w, y, -d]];
  const lo = corners(B[0], B[1], foot), hi = corners(T[0], T[1], top);
  for (let f = 0; f < 4; f++) {
    const a = lo[f], b = lo[(f + 1) % 4], c = hi[(f + 1) % 4], d = hi[f];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d].map((v) => v * CM), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: graterFace(kinds[f]), metalness: 0.75, roughness: 0.32, side: THREE.DoubleSide })));
  }
  const steel = MATS.steel();
  // the rolled rim round the foot, the folded top edge
  // (round a rounded rectangle – its corners turned in quarter circles, so the curve through them can't overshoot)
  const rim = (w, d, y, r) => {
    const pts = [], rad = 0.35;
    for (let i = 0; i < 4; i++) for (let j = 0; j <= 4; j++) { const a = (i + j / 4) * Math.PI / 2; pts.push([(i === 0 || i === 3 ? 1 : -1) * (w - rad) + Math.cos(a) * rad, y, (i < 2 ? 1 : -1) * (d - rad) + Math.sin(a) * rad]); }
    pts.push(pts[0]);
    return new THREE.Mesh(sweep(pts, r, r, { seg: 120, radial: 8, caps: false }), steel);
  };
  g.add(rim(B[0] + 0.1, B[1] + 0.1, foot + 0.15, 0.22));
  g.add(rim(T[0] + 0.05, T[1] + 0.05, top, 0.15));
  // the handle: a steel strap arching over the top, end to end
  // (a flat polished strap 1.8 wide, riveted to the narrow faces, arching 5.5 over the top)
  g.add(new THREE.Mesh(sweep([[-T[0] - 0.05, top - 1.6, 0], [-T[0] - 0.05, top + 1.2, 0], [-T[0] + 0.6, top + 4.6, 0], [-1.8, top + 5.5, 0], [1.8, top + 5.5, 0], [T[0] - 0.6, top + 4.6, 0], [T[0] + 0.05, top + 1.2, 0], [T[0] + 0.05, top - 1.6, 0]], 0.08, 0.9, { seg: 50, radial: 10, up: [0, 0, 1] }), steel));
  for (const sx of [-1, 1]) { const rv = new THREE.Mesh(new THREE.SphereGeometry(0.22 * CM, 10, 6), steel); rv.position.set(sx * (T[0] + 0.12) * CM, (top - 0.9) * CM, 0); g.add(rv); }
  return finish(g);
}

// ------------------------------------------------------------------ kitchen scissors
// After Zwilling Twin kitchen shears: 20 cm; polished blades 9 cm, one with
// a micro-serrated edge; red plastic handles – a big loop for the fingers, a
// smaller one for the thumb – with a toothed nutcracker between them; a red
// pivot cap. Lying closed.
export function scissorsMesh() {
  const g = new THREE.Group(), red = mat('#d32a26', { rough: 0.45 }), steel = MATS.steel();
  const grip = 4;
  // the blades: two slim slabs crossing at the pivot, closed
  for (const [sx, z] of [[-1, 0.12], [1, -0.12]]) {
    const geo = slab({ widths: [[0, 0.6], [2, 0.75], [6, 0.55], [9.5, 0.08]], thick: (s, u) => 0.06 + 0.1 * ((u * sx + 1) / 2), grip: -0.4, steps: 30, across: 8, x: (s, u, hw) => sx * 0.12 + u * hw * (u * sx > 0 ? 1 : 0.7) });
    const m = new THREE.Mesh(geo, steel); m.position.z = z * CM; g.add(m);
  }
  g.add(new THREE.Mesh(sweep([[0, 0, -0.45], [0, 0, 0.45]], 0.55, 0.55, { radial: 16, seg: 2 }), red)); // the pivot
  // the handles: two loops in red plastic, the big one longer
  const loop = (cx, cy, rx, ry, w) => {
    const pts = [];
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0]); }
    return new THREE.Mesh(sweep(pts, w, 0.42, { seg: 60, radial: 10, up: [0, 0, 1], caps: false }), red);
  };
  g.add(loop(-1.7, grip + 3.6, 1.6, 3.4, 0.38), loop(1.5, grip + 2.6, 1.15, 2.2, 0.36));
  for (const sx of [-1, 1]) g.add(new THREE.Mesh(sweep([[sx * 0.3, 0.6, 0], [sx * 0.9, grip - 0.6, 0], [sx * 1.4, grip + 0.4, 0]], 0.45, 0.42, { radial: 10, seg: 12, up: [0, 0, 1] }), red));
  return finish(g);
}

// ------------------------------------------------------------------ cookware
// Pots and pans are drawn about twice life size (what's cooked in them has to
// show), each at its kitchen size – r, h: the body's radius and height (the
// liquid and the lid go by them) – shaped after the real one. What's held in
// the hand (a handle's thickness, a knob) is life size.
export const VESSEL_SIZE = {
  pot: [0.13, 0.15], bigPot: [0.16, 0.2], copperPot: [0.13, 0.15], cocotte: [0.15, 0.14], saucepan: [0.11, 0.1], pan: [0.15, 0.04],
  paellaPan: [0.3, 0.04], bowl: [0.13, 0.12], colander: [0.13, 0.08], tray: [0.2, 0.02], peel: [0.2, 0.02], bakingDish: [0.18, 0.065],
  plate: [0.13, 0.015], glass: [0.035, 0.1], cup: [0.045, 0.06], cezve: [0.05, 0.09], kettle: [0.1, 0.16], caydanlik: [0.1, 0.24],
  blender: [0.07, 0.22], skewer: [0.15, 0.03],
};
// a traced profile ([r, y] cm) at k kitchen units a centimetre
const at = (pts, k) => pts.map(([a, b]) => [a * k, b * k]);
// a body turned from [r, y] points (kitchen units, as given – no smoothing)
const spin = (pts, m, seg = 48) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg), m);
// (its texture's v by height, foot 0 … rim 1 – not by the profile's points)
function vByHeight(mesh) {
  const g = mesh.geometry, p = g.attributes.position, uv = g.attributes.uv;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y;
  for (let i = 0; i < p.count; i++) uv.setY(i, (p.getY(i) - y0) / (y1 - y0 || 1));
  return mesh;
}
// a tube along [x, y, z] points (kitchen units), radius r (or rx × ry)
const tube = (pts, rx, ry = rx, o = {}) => { const g = sweep(pts.map((p) => p.map((v) => v / CM)), (t) => (typeof rx === 'function' ? rx(t) : rx) / CM, (t) => (typeof ry === 'function' ? ry(t) : ry) / CM, o); return g; };
const MAT = {
  satin: () => mat('#c9cdd3', { metal: 0.85, rough: 0.34 }),
  mirror: () => mat('#dfe3e8', { metal: 0.95, rough: 0.14 }),
  inside: () => mat('#cfd3d8', { metal: 0.75, rough: 0.4, double: true }),
  copper: () => mat('#e29a70', { metal: 0.62, rough: 0.26 }),
  black: () => mat('#1e1f23', { rough: 0.55 }),
};

// the long handle of a saucepan / frying pan / cezve: where it runs (kitchen units, from the wall out
// along +x) – the hand holds it two thirds of the way along (the golden ratio, a little more)
export const GRIP_T = 0.64;
const LONG = {
  saucepan: { y: 0.8, len: 0.18, rise: 0.048 },  // (Fissler: rising 15°)
  pan: { y: 0.72, len: 0.19, rise: 0.04 },        // (Fissler Adamant: 12°)
  cezve: { y: 0.86, len: 0.085, rise: 0.12 },     // (cast brass, steep – about 55°)
};
export function handlePath(kind) {
  const [r, h] = VESSEL_SIZE[kind], L = LONG[kind];
  if (!L) return null;
  const y0 = h * L.y;
  return [[r - 0.004, y0, 0], [r + 0.02, y0 + L.rise * 0.12, 0], [r + L.len * 0.5, y0 + L.rise * 0.55, 0], [r + L.len, y0 + L.rise, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
}
export const GRIP3D = {};
for (const k of Object.keys(LONG)) GRIP3D[k] = new THREE.CatmullRomCurve3(handlePath(k)).getPointAt(GRIP_T);

// a loop handle on a pot's wall (at angle a round it, height y): a D standing out `out`, its legs `span`
// apart, rising a little; round in section (th)
function loopHandle(r, y, a, { out = 0.04, span = 0.066, rise = 0.01, th = 0.0062, m = MAT.mirror(), flat = 1 } = {}) {
  const pts = [[r - 0.002, y, -span / 2], [r + out * 0.45, y + rise * 0.4, -span * 0.52], [r + out * 0.9, y + rise, -span * 0.38], [r + out, y + rise, 0], [r + out * 0.9, y + rise, span * 0.38], [r + out * 0.45, y + rise * 0.4, span * 0.52], [r - 0.002, y, span / 2]];
  const mesh = new THREE.Mesh(tube(pts, th, th * flat, { seg: 40, radial: 10, up: [0, 1, 0] }), m);
  mesh.rotation.y = a;
  return mesh;
}
// the Fissler handle: its oval plate on the wall, the rod loop on it (life-size ×2, as the pot)
function fisslerHandle(r, y, a) {
  const g = new THREE.Group(), m = MAT.mirror();
  const plate = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, Math.PI / 2, Math.PI), m);
  plate.scale.set(0.006, 0.0155, 0.033); plate.position.set(r - 0.001, y, 0);
  g.add(plate);
  const out = 0.05, wall = 0.05, grip = 0.035, rise = 0.009;
  g.add(new THREE.Mesh(tube([[r + 0.003, y + 0.002, -wall], [r + out * 0.55, y + rise * 0.5, -grip * 1.05], [r + out, y + rise, -grip * 0.8], [r + out + 0.004, y + rise, 0], [r + out, y + rise, grip * 0.8], [r + out * 0.55, y + rise * 0.5, grip * 1.05], [r + 0.003, y + 0.002, wall]], 0.0051, 0.0051, { seg: 50, radial: 12, up: [0, 1, 0] }), m));
  g.rotation.y = a;
  return g;
}
// rivet heads on the inside of the wall where a handle's fixed
function rivets(g, r, y, a, gap, m) {
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m); b.rotation.z = Math.PI / 2; b.position.set((r - 0.0035) * Math.cos(a), y, -(r - 0.0035) * Math.sin(a) + s * gap); b.rotation.y = a; g.add(b); }
}

// The pot body after Fissler Original-Profi: a straight satin wall on a wider sandwich base, the rim
// rolled out into a pouring rim all round, satin inside.
function profiPot(r, h, { body = MAT.satin(), inner = MAT.inside(), base = MAT.mirror() } = {}) {
  const g = new THREE.Group();
  g.add(spin([[0, 0], [r * 0.9, 0], [r * 0.935, 0.002], [r * 0.94, 0.009], [r * 0.96, 0.011]], base));
  g.add(spin([[r * 0.955, 0.011], [r * 0.995, 0.015], [r, 0.022], [r, h - 0.012], [r + 0.0015, h - 0.006], [r + 0.0048, h - 0.001], [r + 0.0042, h + 0.0012], [r + 0.0005, h + 0.0004], [r - 0.0025, h - 0.004]], body));
  g.add(spin([[r - 0.0025, h - 0.004], [r - 0.003, h - 0.012], [r - 0.003, 0.022], [r - 0.012, 0.0125], [0, 0.0125]], inner));
  return g;
}
// its lid: a stainless lid sitting on the rim, gently domed, a loop grip on a round boss
function profiLid(r) {
  const g = new THREE.Group(), m = MAT.mirror();
  g.add(spin([[r + 0.006, 0.0015], [r + 0.004, 0.004], [r - 0.004, 0.006], [r - 0.006, 0.008], [r * 0.6, 0.017], [r * 0.25, 0.0205], [0, 0.021], [0, 0.0185], [r * 0.6, 0.0145], [r - 0.007, 0.004], [r - 0.004, -0.006], [r + 0.005, -0.0005], [r + 0.006, 0.0015]], m));
  g.add(spin([[0, 0.021], [0.044, 0.021], [0.046, 0.0225], [0.04, 0.024], [0, 0.0245]], MAT.satin(), 40)); // (the round plate, Ø9)
  g.add(new THREE.Mesh(tube([[-0.044, 0.024, 0], [-0.04, 0.04, 0], [-0.03, 0.058, 0], [0.03, 0.058, 0], [0.04, 0.04, 0], [0.044, 0.024, 0]], 0.0046, 0.0046, { seg: 40, radial: 12, up: [0, 0, 1] }), m)); // (the stirrup)
  return g;
}

export function vesselModel(kind) {
  const [r, h] = VESSEL_SIZE[kind] || [0.12, 0.12];
  const g = new THREE.Group();
  let lid = null;
  switch (kind) {
    case 'pot': case 'bigPot': {
      // Fissler Original-Profi stewpot (24 / 28 cm): on each side a round rod bent into an open trapezoid
      // – wide at the wall, narrower at the grip, tilted up a little – welded to an oval plate under the rim
      g.add(profiPot(r, h));
      for (const a of [0, Math.PI]) g.add(fisslerHandle(r, h - 0.022, a));
      lid = profiLid(r);
      break;
    }
    case 'saucepan': {
      // Fissler Original-Profi saucepan: the same pot, a long flat strap handle with a hanging slot
      g.add(profiPot(r, h));
      g.add(longHandle(kind, 'strap'));
      lid = profiLid(r);
      break;
    }
    case 'pan': {
      // Fissler Adamant frying pan: flared walls, a dark granite non-stick inside flecked with mineral
      // grains, a graphite outside, a steel induction disc under it, a black stay-cool grip on a steel collar
      const out = mat('#2c2e33', { metal: 0.35, rough: 0.45 }), inside = granite();
      g.add(spin([[0, 0], [r * 0.7, 0], [r * 0.72, 0.003]], MAT.satin()));
      g.add(spin([[r * 0.72, 0.003], [r * 0.76, 0.005], [r * 0.83, 0.012], [r * 0.95, 0.028], [r, h - 0.002], [r + 0.0015, h], [r - 0.0005, h + 0.0012], [r - 0.004, h - 0.002]], out));
      g.add(spin([[r - 0.004, h - 0.002], [r * 0.93, 0.03], [r * 0.82, 0.016], [r * 0.74, 0.0075], [0, 0.0075]], inside));
      g.add(longHandle(kind, 'grip'));
      lid = glassLid(r);
      break;
    }
    case 'paellaPan': {
      // de Buyer carbon-steel paella pan: wide, shallow, sloping sides, a flat rolled rim, two riveted loops
      // (Garcima polished steel – a little bluish – the base pressed in three shallow rings, the handles
      // painted red, as the classic paella pans are)
      const m = mat('#a9abb8', { metal: 0.85, rough: 0.28, double: true });
      g.add(spin([[0, 0.0035], [r * 0.3, 0.0035], [r * 0.31, 0.005], [r * 0.32, 0.0035], [r * 0.55, 0.0035], [r * 0.56, 0.005], [r * 0.57, 0.0035], [r * 0.75, 0.0035], [r * 0.76, 0.005], [r * 0.77, 0.0035], [r * 0.86, 0.0045], [r * 0.95, 0.03], [r - 0.003, h - 0.002], [r + 0.008, h], [r + 0.011, h + 0.0012], [r + 0.009, h - 0.0012], [r * 0.97, 0.028], [r * 0.875, 0.0015], [r * 0.85, 0], [0, 0]], m, 72));
      for (const a of [0, Math.PI]) { g.add(loopHandle(r, h - 0.01, a, { out: 0.06, span: 0.09, rise: 0.02, th: 0.0042, m: mat('#c42a22', { rough: 0.45 }) })); rivets(g, r - 0.004, h - 0.012, a, 0.032, m); }
      break;
    }
    case 'cocotte': {
      // Le Creuset round cocotte: enamelled cast iron, its Volcanic colour darkening toward the foot,
      // a sand-coloured enamel inside; wide loop handles cast with the body; a heavy lid with rings
      // and a steel knob
      const enamel = volcanic(h), sand = mat('#e8dfcc', { rough: 0.4, double: true });
      const shade = (m) => { shadeByHeight(m); return m; };
      g.add(shade(spin([[0, 0], [r * 0.82, 0], [r * 0.9, 0.004], [r * 0.97, 0.015], [r, 0.035], [r * 1.005, h * 0.6], [r, h - 0.01], [r + 0.002, h], [r - 0.006, h + 0.002]], enamel)));
      g.add(spin([[r - 0.006, h + 0.002], [r - 0.008, h - 0.01], [r - 0.009, 0.03], [r * 0.9, 0.012], [0, 0.011]], sand));
      // (cast D-loops: tops just under the rim, standing out 4 cm, 6.7 across the bar, tilted up 10° – ×2)
      for (const a of [0, Math.PI]) {
        const hd = new THREE.Mesh(tube([[r - 0.006, h - 0.026, -0.056], [r + 0.022, h - 0.019, -0.054], [r + 0.048, h - 0.013, -0.04], [r + 0.052, h - 0.012, 0], [r + 0.048, h - 0.013, 0.04], [r + 0.022, h - 0.019, 0.054], [r - 0.006, h - 0.026, 0.056]], 0.0085, 0.0058, { seg: 50, radial: 12, up: [0, 1, 0] }), enamel);
        hd.rotation.y = a; g.add(shade(hd));
      }
      g.add(spin([[r - 0.006, h + 0.0015], [r - 0.002, h + 0.0028], [r + 0.0025, h + 0.0005]], mat('#2a2622', { rough: 0.7 }))); // (the bare iron rim)
      lid = cocotteLid(r);
      break;
    }
    case 'copperPot': {
      // de Buyer Prima Matera: polished copper outside, steel inside, cast-steel handles riveted on
      const cu = MAT.copper();
      g.add(spin([[0, 0], [r * 0.92, 0], [r * 0.97, 0.003], [r, 0.012], [r, h - 0.004], [r + 0.002, h], [r - 0.003, h + 0.0005]], cu));
      g.add(spin([[r - 0.003, h + 0.0005], [r - 0.004, h - 0.01], [r - 0.004, 0.014], [r * 0.93, 0.008], [0, 0.008]], MAT.inside()));
      for (const a of [0, Math.PI]) { g.add(loopHandle(r, h - 0.032, a, { out: 0.04, span: 0.06, th: 0.0058, m: mat('#b9bec4', { metal: 0.85, rough: 0.3 }) })); rivets(g, r, h - 0.034, a, 0.024, mat('#c9875a', { metal: 0.9, rough: 0.3 })); }
      lid = copperLid(r);
      break;
    }
    case 'kettle': {
      // Le Creuset Tradition whistling kettle: enamelled steel (Marseille blue), a full belly stepping in
      // at the shoulder in two rings, a domed lid with a black knob, a black handle arching over it, the
      // spout rising from low on the belly with a black flip-up whistle
      const blue = mat('#2a62ad', { rough: 0.22, metal: 0.1, double: true }), black = MAT.black();
      g.add(spin([[0, 0], [r * 0.86, 0], [r * 0.95, 0.006], [r * 1.02, 0.03], [r * 1.05, 0.06], [r * 1.0, 0.09], [r * 0.9, 0.108], [r * 0.86, 0.112], [r * 0.84, 0.118], [r * 0.74, 0.125], [r * 0.71, 0.13], [r * 0.6, 0.137], [r * 0.5, 0.14], [r * 0.48, 0.142]], blue, 48));
      lid = new THREE.Group();
      lid.add(spin([[r * 0.5, -0.02], [r * 0.5, 0], [r * 0.42, 0.008], [0, 0.012]], blue, 32));
      lid.add(spin([[0, 0.012], [0.012, 0.012], [0.016, 0.02], [0.013, 0.028], [0, 0.03]], black, 24));
      lid.position.y = 0.142;
      g.add(lid); lid = null; // (it's always on: what's in a kettle never shows)
      // the spout: a tapering tube from low on the belly, up and out
      g.add(new THREE.Mesh(tube([[r * 0.85, 0.035, 0], [r * 1.12, 0.05, 0], [r * 1.36, 0.085, 0], [r * 1.55, 0.125, 0]], (t) => 0.019 - 0.009 * t, (t) => 0.017 - 0.008 * t, { seg: 24, radial: 16, up: [0, 0, 1] }), blue));
      const cap = new THREE.Mesh(tube([[r * 1.53, 0.122, 0], [r * 1.6, 0.134, 0]], 0.0105, 0.0105, { seg: 3, radial: 14 }), black); g.add(cap);
      g.add(new THREE.Mesh(tube([[r * 1.58, 0.135, 0], [r * 1.5, 0.152, 0], [r * 1.42, 0.158, 0]], 0.004, 0.0025, { seg: 8, radial: 8, up: [0, 0, 1] }), black)); // (its lever)
      // the handle: up from the back of the shoulder and from the front, a grip across the top
      g.add(new THREE.Mesh(tube([[-r * 0.72, 0.124, 0], [-r * 0.78, 0.17, 0], [-r * 0.55, 0.215, 0], [r * 0.2, 0.218, 0], [r * 0.48, 0.2, 0], [r * 0.58, 0.13, 0]], 0.0075, 0.0055, { seg: 50, radial: 12, up: [0, 0, 1] }), black));
      break;
    }
    case 'caydanlik': {
      // Korkmaz çaydanlık: two straight polished-steel pots one on the other – the kettle below, the
      // teapot sitting in its neck – each with a cone spout on one side and an ear-shaped handle on the
      // other; a bridge grip on the teapot's lid
      const m = MAT.mirror(), sat = MAT.satin();
      const pot = (R, y0, H, neck) => {
        g.add(spin([[0, y0], [R * 0.92, y0], [R * 0.99, y0 + 0.004], [R, y0 + 0.012], [R, y0 + H - 0.016], [R * 0.95, y0 + H - 0.004], [neck, y0 + H], [neck - 0.002, y0 + H - 0.006]], m, 48));
        g.add(new THREE.Mesh(tube([[-R * 0.9, y0 + H * 0.3, 0], [-R * 1.25, y0 + H * 0.55, 0], [-R * 1.55, y0 + H * 0.86, 0]], (t) => 0.02 - 0.015 * t, (t) => 0.018 - 0.013 * t, { seg: 16, radial: 16, up: [0, 0, 1] }), m));
        g.add(new THREE.Mesh(tube([[R * 0.98, y0 + H * 0.82, 0], [R * 1.28, y0 + H * 0.86, 0], [R * 1.42, y0 + H * 0.6, 0], [R * 1.3, y0 + H * 0.22, 0], [R * 1.1, y0 + H * 0.14, 0], [R * 0.98, y0 + H * 0.2, 0]], 0.0055, 0.0045, { seg: 40, radial: 10, up: [0, 0, 1] }), m));
        for (const y of [H * 0.82, H * 0.2]) g.add(new THREE.Mesh(tube([[R * 0.97, y0 + y, 0], [R * 1.03, y0 + y, 0]], 0.0085, 0.0085, { seg: 2, radial: 14 }), sat)); // (the bosses it's fixed on)
      };
      pot(r, 0, 0.145, r * 0.74);
      pot(r * 0.7, 0.14, 0.09, r * 0.5);
      g.add(spin([[r * 0.52, 0.228], [r * 0.5, 0.232], [r * 0.2, 0.237], [0, 0.238]], m, 32));
      g.add(new THREE.Mesh(tube([[-0.018, 0.236, 0], [-0.016, 0.252, 0], [0.016, 0.252, 0], [0.018, 0.236, 0]], 0.0032, 0.0032, { seg: 24, radial: 10, up: [0, 0, 1] }), m));
      break;
    }
    case 'cezve': {
      // a hammered-copper cezve: a wide foot narrowing to a waist, the mouth flaring again with a pinched
      // lip to pour from, tinned inside; a long flat brass handle rising from just under the rim
      const cu = MAT.copper(), brass = mat('#c8a24a', { metal: 0.85, rough: 0.3 });
      // (Cobper, hammered copper: widest just above the foot, drawing in to a waist two thirds up, the mouth
      // flaring out to a thickened rim; tin-lined)
      const k = h / 8.5;
      g.add(spin([[0, 0], [3.7 * k, 0], [4.0 * k, 0.4 * k], [4.1 * k, 1.5 * k], [3.8 * k, 3.5 * k], [3.3 * k, 5.2 * k], [3.1 * k, 6.0 * k], [3.25 * k, 7.3 * k], [3.5 * k, 8.3 * k], [3.6 * k, 8.5 * k], [3.4 * k, 8.4 * k]].map(([a, b]) => [a * (r / (4.1 * k)), b]), new THREE.MeshStandardMaterial({ color: '#e29a70', metalness: 0.62, roughness: 0.26, bumpMap: hammered(), bumpScale: 2 }), 40));
      g.add(spin([[3.4 * k, 8.4 * k], [3.0 * k, 6.0 * k], [3.95 * k, 1.5 * k], [3.6 * k, 0.3 * k], [0, 0.3 * k]].map(([a, b]) => [a * (r / (4.1 * k)), b]), mat('#bdb8ae', { metal: 0.7, rough: 0.4, double: true }), 40));
      // (the pouring lip, opposite the handle)
      g.add(new THREE.Mesh(tube([[-r * 0.86, h - 0.002, -0.014], [-r * 1.08, h + 0.002, 0], [-r * 0.86, h - 0.002, 0.014]], 0.0022, 0.0022, { seg: 12, radial: 8 }), cu));
      // (a flat cast-brass strip, pierced in a lattice along its upper part, ending in a heart with a hole;
      // two rivets under the rim)
      const P = handlePath(kind).map((p) => p.toArray());
      const strip = tube(P, (t) => 0.0062 + (t > 0.85 ? 0.006 * Math.sin(Math.PI * (t - 0.85) / 0.15) : 0), 0.0015, { seg: 60, radial: 16, up: [0, 0, 1] });
      g.add(new THREE.Mesh(strip, new THREE.MeshStandardMaterial({ color: '#c29a5f', metalness: 0.85, roughness: 0.3, alphaMap: latticeMap(), alphaTest: 0.5, side: THREE.DoubleSide })));
      for (const dy of [-0.008, 0.004]) { const rv = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), brass); rv.position.set(P[0][0] + 0.002, P[0][1] + dy, 0); g.add(rv); }
      break;
    }
    case 'colander': {
      // de Buyer footed colander: a deep steel bowl pierced in rings of holes, a rolled rim, two flat
      // loop handles, standing on a flared foot ring
      const holes = new THREE.MeshStandardMaterial({ color: '#cdd1d6', metalness: 0.85, roughness: 0.3, alphaMap: holesMap(28, 6, { r: 0.28, margin: 0.06, stagger: true }), alphaTest: 0.5, side: THREE.DoubleSide });
      holes.alphaMap.wrapS = THREE.RepeatWrapping;
      const bowl = spin([[0, 0.016], [r * 0.45, 0.018], [r * 0.7, 0.026], [r * 0.88, 0.042], [r * 0.97, 0.062], [r, h]], holes, 56);
      g.add(bowl);
      g.add(spin([[r - 0.001, h - 0.002], [r + 0.004, h], [r + 0.003, h + 0.003], [r - 0.002, h + 0.002]], MAT.mirror(), 56));
      g.add(spin([[r * 0.42, 0], [r * 0.46, 0.002], [r * 0.4, 0.012], [r * 0.38, 0.019], [r * 0.36, 0.019]], MAT.mirror(), 48));
      for (const a of [0, Math.PI]) g.add(loopHandle(r, h - 0.006, a, { out: 0.03, span: 0.05, rise: 0.003, th: 0.0045, flat: 0.45 }));
      break;
    }
    case 'bowl': {
      // Mason Cash Cane S12 (29 cm): buff earthenware outside – twelve raised panels, a small diamond on each,
      // under a collar band of chevrons – a white glaze inside, an unglazed foot (traced from Mason Cash's photo)
      const k = r / 14.5;
      const outside = new THREE.MeshStandardMaterial({ color: '#ffffff', map: caneBump(true), roughness: 0.22, bumpMap: caneBump(), bumpScale: 5 });
      g.add(spin(at([[0, 0.1], [6.3, 0], [6.6, 0.3]], k), mat('#c59c82', { rough: 0.8 }), 48));
      g.add(vByHeight(spin(at([[6.6, 0.3], [7.1, 1.4], [8.4, 1.9], [9.1, 2.5], [9.7, 3.1], [10.2, 3.7], [11.0, 4.9], [11.5, 6.0], [12.0, 7.2], [12.35, 8.4], [12.7, 9.5], [13.1, 10.7], [13.3, 11.3], [14.0, 11.9], [14.3, 12.4], [14.5, 13.6], [14.5, 14]], k), outside, 64)));
      g.add(spin(at([[14.5, 14], [14.1, 14.15], [13.6, 14], [13.4, 12.5], [12.4, 9.5], [11.0, 6], [8.5, 3], [5, 1.3], [0, 1.0]], k), mat('#f2ece2', { rough: 0.2, double: true }), 64));
      break;
    }
    case 'plate': {
      // IKEA VÄRDAGEN (27 cm): a foot ring under it, a shallow well, a wide rim sloping down to it, a rounded
      // bead round its edge (traced)
      const k = r / 13.5, m = mat('#f7f6f2', { rough: 0.14, double: true });
      g.add(spin(at([[0, 0.3], [7.9, 0.3], [8.0, 0], [8.6, 0], [8.75, 0.35], [10.0, 1.15], [11.5, 1.85], [13.0, 2.35], [13.5, 2.65], [13.45, 2.95], [13.2, 3.0], [12.6, 2.85], [9.6, 2.35], [9.0, 1.9], [8.4, 1.1], [8.0, 0.85], [0, 0.8]], k), m, 64));
      break;
    }
    case 'glass': {
      // Paşabahçe Üsküdar (120 cc, gilt rim): heavy-footed, swelling, drawing in to a waist two thirds up and
      // opening out like a tulip – on a Keyif saucer, scalloped (13) round its edge (traced)
      const k = r / 2.85, gl = mat('#f4f8f7', { rough: 0.03, metal: 0.1, opacity: 0.32, double: true });
      const outer = [[0, 0], [1.6, 0], [1.8, 0.12], [2.03, 0.25], [2.2, 0.4], [2.32, 0.67], [2.42, 0.94], [2.5, 1.2], [2.56, 1.5], [2.58, 1.8], [2.58, 2.0], [2.54, 2.3], [2.47, 2.6], [2.38, 2.9], [2.3, 3.3], [2.22, 3.7], [2.16, 4.2], [2.12, 4.7], [2.11, 5.0], [2.13, 5.5], [2.18, 5.8], [2.25, 6.3], [2.33, 6.8], [2.44, 7.1], [2.55, 7.4], [2.68, 7.8], [2.82, 8.15], [2.85, 8.3]];
      const inner = outer.filter(([, y]) => y > 0.45).reverse().map(([a, b]) => [a - 0.12, b]);
      const y0 = 2.2 * k / k; // (it stands in the saucer's ring)
      void y0;
      const lift = 0.55;
      g.add(spin(at([...outer, ...inner, [0, 0.45]].map(([a, b]) => [a, b + lift]), k), gl, 40));
      g.add(spin(at([[2.73, 8.05 + lift], [2.86, 8.3 + lift], [2.74, 8.3 + lift]], k), mat('#d4af37', { metal: 0.9, rough: 0.25 }), 40)); // (the gilt band)
      // (the saucer, scalloped)
      const sp = [[0, 0], [2.7, 0], [2.9, 0.3], [4.0, 1.2], [5.0, 2.1], [5.3, 2.5], [5.1, 2.5], [3.8, 1.4], [2.3, 0.55], [0, 0.5]];
      const saucer = spin(at(sp, k), mat('#f4f9fa', { rough: 0.04, metal: 0.1, opacity: 0.4, double: true }), 52);
      const P = saucer.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), d = Math.hypot(x, z); if (d < 3 * k) continue; const a = Math.atan2(z, x), f = 1 + (0.16 / 5.3) * Math.cos(13 * a) * Math.min(1, (d / k - 3) / 2.3); P.setX(i, x * f); P.setZ(i, z * f); }
      saucer.geometry.computeVertexNormals();
      g.add(saucer);
      break;
    }
    case 'cup': {
      // IKEA VÄRDERA coffee cup and saucer: feldspar porcelain, a tulip-shaped cup, an ear-shaped handle with a
      // flat thumb rest on top, a wide saucer with a seat for the cup (traced)
      const k = r / 4.5, m = mat('#f8f8f6', { rough: 0.12, double: true }), up = 0.6;
      g.add(spin(at([[0, 0.05], [2.1, 0], [2.25, 0.35], [2.55, 0.9], [3.05, 2], [3.55, 3], [3.95, 4], [4.25, 5], [4.45, 6], [4.5, 7], [4.35, 7.05], [4.2, 7], [4.15, 6], [3.9, 5], [3.6, 4], [3.2, 3], [2.7, 2], [2.0, 1], [0, 0.7]].map(([a, b]) => [a, b + up]), k), m, 48));
      const hp = [[4.0, 6.4], [5.6, 6.5], [6.6, 6.2], [7.1, 5.5], [7.0, 4.7], [6.3, 3.8], [5.2, 3.0], [3.4, 2.5]].map(([a, b]) => [a * k, (b + up) * k, 0]);
      g.add(new THREE.Mesh(tube(hp, (t) => (0.75 - 0.2 * t) / 2 * k, (t) => (0.55 - 0.1 * t) / 2 * k, { seg: 40, radial: 12, up: [0, 0, 1] }), m));
      g.add(spin(at([[0, 0.3], [3.9, 0.3], [4.0, 0], [4.6, 0], [4.8, 0.3], [6.5, 1.1], [7.5, 1.85], [7.45, 2.0], [6.5, 1.5], [4.0, 0.85], [2.95, 0.68], [2.9, 0.75], [2.85, 0.65], [0, 0.6]], k), m, 56));
      break;
    }
    case 'tray': {
      // a Nordic Ware half-sheet: natural aluminium, low sloping sides, a rolled rim all round
      const al = mat('#d3d7db', { metal: 0.75, rough: 0.42, double: true }), W = 0.2, D = 0.15, H = 0.02, k = 0.016;
      const pts = (w, d, rad) => { const out = []; for (let i = 0; i < 4; i++) for (let j = 0; j <= 6; j++) { const a = (i + j / 6) * Math.PI / 2; const cx = (i === 0 || i === 3 ? 1 : -1) * (w - rad), cz = (i < 2 ? 1 : -1) * (d - rad); out.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]); } return out; };
      const lo = pts(W - k, D - k, 0.012), hi = pts(W, D, 0.018);
      const pos = [], idx = [];
      lo.forEach(([x, z]) => pos.push(x, 0, z)); hi.forEach(([x, z]) => pos.push(x, H, z));
      const n = lo.length;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + i, j, n + j, n + i); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, al));
      // (its floor: flat, its own)
      const floor = new THREE.Shape(lo.map(([x, z]) => new THREE.Vector2(x, z)));
      const fg = new THREE.ShapeGeometry(floor); fg.rotateX(Math.PI / 2);
      g.add(new THREE.Mesh(fg, al));
      g.add(new THREE.Mesh(tube([...hi, hi[0]].map(([x, z]) => [x, H, z]), 0.0032, 0.0032, { seg: 120, radial: 8, caps: false }), al));
      break;
    }
    case 'bakingDish': {
      // Emile Henry large rectangular dish (Toscane orange): a glazed ceramic tub, its walls leaning out
      // 12°, rounded corners, a thick rounded lip, an ear on each short end, an unglazed foot band
      const glaze = mat('#d4500a', { rough: 0.15, double: true }), W = r, D = r * 0.703, H = h;
      const ring = (w, d, rad, y, n = 8) => { const out = []; for (let i = 0; i < 4; i++) for (let j = 0; j <= n; j++) { const a = (i + j / n) * Math.PI / 2; out.push([(i === 0 || i === 3 ? 1 : -1) * (w - rad) + Math.cos(a) * rad, y, (i < 2 ? 1 : -1) * (d - rad) + Math.sin(a) * rad]); } return out; };
      const layers = [ring(W * 0.865, D * 0.81, 0.04, 0), ring(W * 0.91, D * 0.87, 0.046, 0.012), ring(W * 0.985, D * 0.975, 0.05, H * 0.9), ring(W, D, 0.052, H), ring(W * 0.965, D * 0.95, 0.048, H + 0.002), ring(W * 0.94, D * 0.915, 0.045, H * 0.92), ring(W * 0.83, D * 0.74, 0.036, 0.012)];
      g.add(new THREE.Mesh(loft(layers, true), glaze));
      g.add(new THREE.Mesh(loft([ring(W * 0.86, D * 0.8, 0.04, -0.0005), ring(W * 0.865, D * 0.81, 0.04, 0.004)], false), mat('#c8a47e', { rough: 0.8 })));
      for (const sx of [-1, 1]) g.add(new THREE.Mesh(tube([[sx * W * 0.97, H - 0.012, -D * 0.5], [sx * (W + 0.02), H - 0.004, -D * 0.42], [sx * (W + 0.028), H, 0], [sx * (W + 0.02), H - 0.004, D * 0.42], [sx * W * 0.97, H - 0.012, D * 0.5]], 0.012, 0.005, { seg: 40, radial: 12, up: [0, 1, 0] }), glaze));
      break;
    }
    case 'blender': {
      // a countertop blender (as KitchenAid's): a rounded die-cast base with a control dial, a ribbed glass
      // jug with a handle and a pouring lip, a black lid; the blades at its foot
      const base = mat('#c8312b', { metal: 0.3, rough: 0.3 }), gl = mat('#eef5f6', { rough: 0.05, metal: 0.1, opacity: 0.3, double: true });
      g.add(new THREE.Mesh(loft([0, 0.012, 0.045, 0.06].map((y, i) => { const w = [0.072, 0.075, 0.066, 0.06][i], out = []; for (let j = 0; j < 32; j++) { const a2 = (j / 32) * Math.PI * 2; out.push([Math.cos(a2) * w, y, Math.sin(a2) * w * 0.92]); } return out; }), true), base));
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.015, 0.008, 20), mat('#2a2a2e', { rough: 0.4 })); dial.rotation.x = Math.PI / 2; dial.position.set(0, 0.03, 0.07); g.add(dial);
      g.add(spin([[0, 0.06], [0.05, 0.06], [0.056, 0.075], [0.066, h - 0.01], [0.068, h], [0.064, h]], gl, 32));
      g.add(new THREE.Mesh(tube([[0.062, h - 0.03, 0], [0.098, h - 0.04, 0], [0.104, h - 0.1, 0], [0.09, 0.1, 0], [0.058, 0.09, 0]], 0.008, 0.006, { seg: 30, radial: 10, up: [0, 0, 1] }), gl));
      g.add(spin([[0, h + 0.012], [0.05, h + 0.012], [0.068, h + 0.004], [0.069, h - 0.004], [0.062, h - 0.004]], mat('#1e1e22', { rough: 0.5, double: true }), 32));
      for (let i = 0; i < 4; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.002, 0.008), MAT.mirror()); bl.position.set(0, 0.075, 0); bl.rotation.set(i % 2 ? 0.3 : -0.3, (i * Math.PI) / 4, 0); g.add(bl); }
      break;
    }
    case 'skewer': {
      // Turkish şiş: three flat steel blades with a twisted neck and a ring to hold them by
      const m = MAT.mirror();
      for (let i = 0; i < 3; i++) {
        const z = -0.05 + i * 0.05;
        g.add(new THREE.Mesh(tube([[-r, 0.02, z], [r * 0.75, 0.02, z]], 0.0045, 0.0012, { seg: 6, radial: 8, up: [0, 1, 0] }), m));
        g.add(new THREE.Mesh(tube([[r * 0.75, 0.02, z], [r, 0.02, z]], 0.0018, 0.0018, { seg: 4, radial: 8 }), m));
        const rg = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.002, 6, 16), m); rg.position.set(r + 0.011, 0.02, z); g.add(rg);
      }
      break;
    }
    case 'peel': {
      // a wooden pizza peel: a thin birch paddle tapering to a bevelled front edge, a long round handle
      const birch = mat('#d8b07a', { rough: 0.6 });
      const geo = slab({ widths: [[0, 1.6], [6, 1.8], [8, 7.5], [11, 13.5], [32, 15], [38, 14], [39, 10]], thick: (s) => (s < 7 ? 2 : 0.9 - Math.max(0, s - 32) * 0.1), grip: 0, steps: 40, across: 12 });
      geo.scale((2 * r) / (39 * CM), (2 * r) / (39 * CM), 1); geo.rotateX(-Math.PI / 2); geo.translate(0, 0.006, -r);
      g.add(new THREE.Mesh(geo, birch));
      break;
    }
    default: return null;
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, r, h, lid };
}

// a skin through rings of points (each [[x, y, z], …], the same count), closed round; cap: close the first
// ring with a floor
function loft(rings, cap) {
  const n = rings[0].length, pos = [], idx = [];
  rings.forEach((rg) => rg.forEach(([x, y, z]) => pos.push(x, y, z)));
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = k * n + i, b = k * n + j, c = a + n, d = b + n; idx.push(a, b, c, b, d, c); }
  if (cap) { const c0 = pos.length / 3; pos.push(0, rings[0][0][1], 0); for (let i = 0; i < n; i++) idx.push(c0, (i + 1) % n, i); const k = rings.length - 1, c1 = pos.length / 3; pos.push(0, rings[k][0][1], 0); for (let i = 0; i < n; i++) idx.push(c1, k * n + i, k * n + (i + 1) % n); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// hammered copper: little round facets (a bump map)
let HAMMER = null;
function hammered() {
  if (HAMMER) return HAMMER;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 420; i++) { const cx = Math.random() * 256, cy = Math.random() * 256, rr = 6 + Math.random() * 6; const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rr); gr.addColorStop(0, '#5a5a5a'); gr.addColorStop(1, 'rgba(128,128,128,0)'); x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill(); }
  HAMMER = new THREE.CanvasTexture(c); HAMMER.wrapS = HAMMER.wrapT = THREE.RepeatWrapping; HAMMER.repeat.set(3, 1);
  return HAMMER;
}
// the cezve handle's piercing: a lattice of diamonds along its upper part, a hole in the heart at its end
// (u runs round the flat strip – its two faces are u 0 … 0.5 and 0.5 … 1, their middles 0.25 and 0.75 –
// v along it, the pot's end 0: the holes are cut through both faces at once)
let LATTICE = null;
function latticeMap() {
  if (LATTICE) return LATTICE;
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 256);
  x.fillStyle = '#000';
  for (const cx of [16, 48]) {
    for (let v = 0.36; v < 0.82; v += 0.075) { const y = 256 * (1 - v); x.beginPath(); x.moveTo(cx, y - 9); x.lineTo(cx + 6, y); x.lineTo(cx, y + 9); x.lineTo(cx - 6, y); x.closePath(); x.fill(); }
    x.beginPath(); x.arc(cx, 256 * (1 - 0.94), 5, 0, Math.PI * 2); x.fill();
  }
  LATTICE = new THREE.CanvasTexture(c);
  return LATTICE;
}
// the cane bowl's relief: panels with a diamond in each, a zig-zag band above them (a bump map)
const CANE = {};
function caneBump(color = false) {
  const k = color ? 'c' : 'b';
  if (CANE[k]) return CANE[k];
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  // (the canvas's top is the rim – v 1 – its bottom the foot: the band near the rim, the panels below it)
  const [base, panel, edge, dia, band] = color ? ['#dcab76', '#e6b986', '#c99862', '#f0c896', '#e8bb86'] : ['#808080', '#a8a8a8', '#606060', '#d0d0d0', '#b8b8b8'];
  x.fillStyle = base; x.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 12; i++) {
    const cx = i * 512 / 12 + 512 / 24;
    x.fillStyle = edge; x.fillRect(cx - 17, 34, 34, 56);
    x.fillStyle = panel; x.fillRect(cx - 14, 37, 28, 50);
    x.fillStyle = dia; x.beginPath(); x.moveTo(cx, 51); x.lineTo(cx + 8, 62); x.lineTo(cx, 73); x.lineTo(cx - 8, 62); x.closePath(); x.fill();
  }
  x.strokeStyle = band; x.lineWidth = 5; x.beginPath();
  for (let i = 0; i <= 48; i++) x.lineTo(i * 512 / 48, i % 2 ? 14 : 24);
  x.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return (CANE[k] = t);
}

// the non-stick: dark granite, flecked (a texture of grains)
let GRANITE = null;
function granite() {
  if (!GRANITE) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#2b2d31'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = 60 + Math.random() * 90 | 0; x.fillStyle = `rgb(${v},${v},${v + 6})`; x.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4); }
    GRANITE = new THREE.CanvasTexture(c); GRANITE.wrapS = GRANITE.wrapT = THREE.RepeatWrapping; GRANITE.repeat.set(3, 3); GRANITE.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ map: GRANITE, metalness: 0.2, roughness: 0.55, side: THREE.DoubleSide });
}
// Le Creuset Volcanic: deep red at the foot shading up to flame orange (vertex colours by height)
// (sampled from Le Creuset's photos: the foot's edge #c30a1a, low #db2924, the middle #eb5025, the top #f26925)
const VOLCANIC = [[0, '#c30a1a'], [0.25, '#db2924'], [0.6, '#eb5025'], [1, '#f26925']].map(([t, c]) => [t, new THREE.Color(c)]);
function volcanic(h) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.16, metalness: 0.02, vertexColors: true, side: THREE.DoubleSide });
  m.userData.grad = { h };
  return m;
}
function gradAt(t) {
  for (let i = 1; i < VOLCANIC.length; i++) if (t <= VOLCANIC[i][0]) { const [t0, c0] = VOLCANIC[i - 1], [t1, c1] = VOLCANIC[i]; return c0.clone().lerp(c1, (t - t0) / (t1 - t0)); }
  return VOLCANIC[VOLCANIC.length - 1][1].clone();
}
// (by height – or, a lid, by its distance from the middle: light at the knob, red at the rim)
function shadeByHeight(mesh, radial = 0) {
  const G = mesh.material.userData.grad, p = mesh.geometry.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const t = radial ? 1 - Math.min(1, Math.hypot(p.getX(i), p.getZ(i)) / radial) * 0.75 : Math.max(0, Math.min(1, p.getY(i) / G.h));
    const c = gradAt(t); col.push(c.r, c.g, c.b);
  }
  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}
// a glass lid: a steel rim, the glass domed, a steam vent, a black knob on a steel boss
function glassLid(r) {
  const g = new THREE.Group();
  g.add(spin([[r + 0.004, 0], [r + 0.004, 0.005], [r - 0.006, 0.006], [r - 0.004, -0.004], [r + 0.004, 0]], MAT.mirror()));
  g.add(spin([[r - 0.005, 0.0055], [r * 0.6, 0.016], [0, 0.02]], mat('#e6f2f7', { rough: 0.05, metal: 0.1, opacity: 0.3, double: true })));
  g.add(spin([[0, 0.019], [0.014, 0.019], [0.014, 0.022], [0, 0.022]], MAT.satin(), 24));
  g.add(spin([[0, 0.022], [0.009, 0.022], [0.013, 0.03], [0.012, 0.036], [0, 0.038]], MAT.black(), 24));
  return g;
}
// the cocotte's lid: cast, domed, three raised rings, the steel knob
function cocotteLid(r) {
  const g = new THREE.Group();
  const lid = spin([[r + 0.003, 0], [r + 0.004, 0.006], [r * 0.92, 0.012], [r * 0.84, 0.0125], [r * 0.83, 0.016], [r * 0.8, 0.0165], [r * 0.66, 0.02], [r * 0.65, 0.023], [r * 0.62, 0.0235], [r * 0.47, 0.026], [r * 0.46, 0.029], [r * 0.43, 0.0295], [r * 0.2, 0.031], [0, 0.0315], [0, 0.026], [r - 0.008, 0.004], [r - 0.007, -0.006], [r + 0.003, 0]], volcanic(0.035));
  shadeByHeight(lid, r);
  g.add(lid);
  g.add(spin([[r + 0.0035, -0.0004], [r + 0.0042, 0.0012], [r + 0.0035, 0.0028]], mat('#2a2622', { rough: 0.7 }))); // (its bare iron edge)
  g.add(spin([[0, 0.031], [0.02, 0.031], [0.021, 0.036], [0.017, 0.044], [0, 0.046]], MAT.mirror(), 28));
  return g;
}
// the copper pot's lid: copper, a steel loop grip riveted on
function copperLid(r) {
  const g = new THREE.Group();
  g.add(spin([[r + 0.003, 0], [r + 0.002, 0.004], [r * 0.5, 0.016], [0, 0.018], [0, 0.015], [r - 0.006, 0.002], [r - 0.004, -0.004], [r + 0.003, 0]], MAT.copper()));
  g.add(new THREE.Mesh(tube([[-0.03, 0.016, 0], [-0.026, 0.03, 0], [0, 0.034, 0], [0.026, 0.03, 0], [0.03, 0.016, 0]], 0.004, 0.003, { seg: 30, radial: 10, up: [0, 0, 1] }), mat('#b9bec4', { metal: 0.85, rough: 0.3 })));
  return g;
}

// a long handle along handlePath: 'strap' (Fissler: brushed steel, flat, a slot to hang it by, on a
// riveted bracket), 'grip' (Fissler Adamant: a black stay-cool grip on a steel collar), 'cezve' (flat brass)
function longHandle(kind, style) {
  const g = new THREE.Group(), P = handlePath(kind).map((p) => p.toArray());
  const end = P[P.length - 1];
  if (style === 'strap') {
    g.add(new THREE.Mesh(tube(P, (t) => 0.0092 + 0.0035 * t, 0.0048, { seg: 40, radial: 12, up: [0, 1, 0] }), MAT.satin()));
    // (the bracket on the wall) and the hanging slot near its end
    const br = new THREE.Mesh(tube([[P[0][0] - 0.002, P[0][1] - 0.012, 0], [P[0][0] - 0.0005, P[0][1] + 0.004, 0]], 0.012, 0.0022, { seg: 4, radial: 12, up: [1, 0, 0] }), MAT.satin());
    g.add(br);
    const slot = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.016, 4, 10), MAT.black());
    slot.rotation.z = Math.PI / 2 + Math.atan2(end[1] - P[2][1], end[0] - P[2][0]);
    slot.position.set(end[0] - 0.022, end[1] - 0.0012, 0);
    g.add(slot);
  }
  if (style === 'grip') {
    // (the steel collar riveted to the wall, then the black grip, oval and a little fuller toward its end,
    // a hole to hang it by)
    const n = P.length - 1, at = (t) => new THREE.CatmullRomCurve3(handlePath(kind)).getPointAt(t).toArray();
    g.add(new THREE.Mesh(tube([P[0], at(0.08), at(0.2)], 0.0095, 0.007, { seg: 10, radial: 12, up: [0, 1, 0] }), MAT.mirror()));
    const grip = [at(0.18), at(0.4), at(0.7), at(0.92), P[n]];
    g.add(new THREE.Mesh(tube(grip, (t) => 0.0105 + 0.003 * Math.sin(Math.PI * t * 0.8), (t) => 0.0082 + 0.0016 * t, { seg: 40, radial: 16, up: [0, 1, 0] }), MAT.black()));
    const hole = new THREE.Mesh(new THREE.TorusGeometry(0.0048, 0.0018, 8, 18), mat('#0f1013', { rough: 0.5 }));
    hole.rotation.x = Math.PI / 2; hole.position.set(P[n][0] - 0.014, P[n][1] + 0.0085, 0);
    g.add(hole);
  }
  return g;
}

// ------------------------------------------------------------------ more utensils
// Rösle swivel peeler (19 cm): a hanging ring (Ø1.9), a collar, a brushed tube handle Ø1.84 × 9.2, a
// slimmer neck, then the head – a U-channel frame 5.3 long in line with the handle, its two ends carrying
// the slotted blade (4.5 × 0.7) that swivels along it; a pointed eye-scoop fin near its front. (Held at
// the origin, its blade below – as the board's own always was.)
export function peelerMesh() {
  const g = new THREE.Group(), steel = MATS.steel(), sat = MATS.brushed();
  const top = 7.6, neck = -1.6, head = neck - 1.9, tip = head - 5.3;
  g.add(new THREE.Mesh(sweep([[0, neck, 0], [0, neck + 0.4, 0], [0, top - 0.4, 0], [0, top, 0]], (t) => (t < 0.05 ? 0.6 + t * 6 : t > 0.97 ? 0.92 - (t - 0.97) * 6 : 0.92), undefined, { seg: 24, radial: 20, up: [1, 0, 0] }), sat));
  g.add(turned([[0, top], [0.75, top], [0.8, top + 0.4], [0.4, top + 0.45], [0, top + 0.45]], steel, { seg: 20, sharp: true })); // (the collar)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75 * CM, 0.2 * CM, 8, 22), steel); ring.position.set(0, (top + 1.3) * CM, 0); g.add(ring);
  g.add(new THREE.Mesh(sweep([[0, neck, 0], [0, head, 0]], 0.6, 0.6, { seg: 4, radial: 14 }), steel)); // (the neck)
  // the frame: its back running along the blade's side, its ends turning in to the pivots
  g.add(new THREE.Mesh(sweep([[0.15, head, 0], [0.55, head - 0.2, 0], [0.62, head - 1, 0], [0.62, tip + 0.8, 0], [0.5, tip + 0.1, 0], [0.05, tip, 0]], 0.12, 0.5, { seg: 30, radial: 8, up: [0, 0, 1] }), steel));
  const blade = new THREE.Mesh(slab({ widths: [[0, 0.35], [4.5, 0.35]], thick: (s, u) => 0.04 + 0.05 * (1 - Math.abs(u)), grip: 0, steps: 6, across: 6 }), steel);
  blade.position.set(-0.05 * CM, (head - 0.4) * CM, 0); g.add(blade);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.1 * CM, 3.9 * CM, 0.12 * CM), mat('#3a3e44', { metal: 0.6, rough: 0.4 })); slot.position.set(-0.05 * CM, (head - 2.65) * CM, 0); g.add(slot);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.22 * CM, 0.8 * CM, 8), steel); fin.position.set(0.95 * CM, (tip + 0.9) * CM, 0); fin.rotation.z = -1.2; g.add(fin);
  return finish(g);
}

// Berard olive-wood cooking spoon: 30 cm, its long slim handle (1.6 cm, rounded) widening into an oval
// bowl 6 × 4.6 cm, shallow; the olive wood's grain swirling along it.
let GRAIN = null;
function oliveWood() {
  if (!GRAIN) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#c7702a'; x.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = i % 3 ? 'rgba(110,59,26,0.4)' : 'rgba(226,166,90,0.45)'; x.lineWidth = 1 + (i % 4);
      x.beginPath(); for (let y = 0; y <= 512; y += 16) x.lineTo(32 + Math.sin(y / 40 + i) * 18 + (i - 13) * 2.2, y); x.stroke();
    }
    GRAIN = new THREE.CanvasTexture(c); GRAIN.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ map: GRAIN, roughness: 0.6 });
}
export function woodSpoonMesh() {
  const g = new THREE.Group();
  const L = 30, b0 = 23.5, grip = 9;
  const geo = slab({
    widths: [[0, 0.6], [5, 0.575], [10, 0.55], [15, 0.5], [b0 - 1.2, 0.48], [b0, 0.7], [b0 + 1.2, 1.7], [b0 + 3.6, 2.15], [L - 1.2, 1.8], [L - 0.3, 0.9], [L, 0.15]],
    thick: (s, u) => (s < b0 - 0.5 ? (0.9 + 0.2 * Math.max(0, (s - 18) / 5)) * Math.sqrt(Math.max(0, 1 - u * u * 0.9)) : 0.5),
    lift: (s) => (s > b0 ? 0.25 : 0), dish: (s, u) => (s < b0 + 0.4 ? 0 : 0.45 * Math.sin(Math.PI * Math.min(1, (s - b0 - 0.4) / (L - b0 - 0.6))) * (1 - u * u)),
    grip, steps: 90, across: 14,
  });
  setUV(geo, (x, y) => [x / (5 * CM) + 0.5, -y / (L * CM)]);
  g.add(new THREE.Mesh(geo, oliveWood()));
  return finish(g);
}

// IKEA MAGASIN rolling pin: solid beech, a barrel Ø6 × 25.5 turning on its axle between two turned
// handles (a waist, a fuller grip, a domed end). 43 cm. Held by a handle; the barrel hangs below.
export function rollingPinMesh() {
  const g = new THREE.Group(), beech = mat('#dcb88b', { rough: 0.7 });
  const b1 = -2.5, b0 = b1 - 25.5;
  g.add(turned([[0, b0], [2.7, b0], [3.0, b0 + 0.3], [3.0, b1 - 0.3], [2.7, b1], [0, b1]], beech, { seg: 32, sharp: true }));
  const handle = [[0, 0.85], [0.5, 0.85], [2.5, 0.7], [5, 0.95], [6.5, 1.1], [7.8, 1.0], [8.3, 0.7], [8.5, 0]];
  g.add(turned(handle.map(([x, d]) => [d, b1 + 0.2 + x]), beech, { seg: 20 }));
  g.add(turned(handle.map(([x, d]) => [d, b0 - 0.2 - x]), beech, { seg: 20 }));
  return finish(g);
}

// ------------------------------------------------------------------ bottles and jars
// (upright: their foot – userData.foot – below the origin, where a hand takes them)
// a Marasca olive-oil bottle (500 ml): square in section (5.7 across, corners rounded 0.7), antique-green
// glass, its shoulders turning round into the neck, a long gold screw cap, a label on its face (traced)
export function oilBottleMesh() {
  const g = new THREE.Group(), glass = mat('#5f5716', { rough: 0.06, metal: 0.25, opacity: 0.9 }), y0 = -10;
  const body = new THREE.Mesh(roundedPrism(2.85, 2.85, 0.7, 0, 18.6), glass); body.position.y = y0 * CM; g.add(body);
  g.add(turned([[2.85, 18.6], [2.75, 18.9], [2.65, 19.3], [2.43, 20.1], [2.0, 20.8], [1.65, 21.6], [1.5, 22.7], [0, 22.7]].map(([a, b]) => [a, b + y0]), glass, { seg: 28 }));
  g.add(turned([[0, 21.8], [1.6, 21.8], [1.62, 25.4], [1.66, 25.5], [1.66, 26.2], [1.4, 26.4], [0, 26.4]].map(([a, b]) => [a, b + y0]), mat('#b8962e', { metal: 0.85, rough: 0.3 }), { seg: 24, sharp: true }));
  const label = new THREE.Mesh(new THREE.PlaneGeometry(5.2 * CM, 9.5 * CM), mat('#f1e7c8', { rough: 0.7 })); label.position.set(0, (4 + 4.75 + y0) * CM, 2.87 * CM); g.add(label);
  const band = new THREE.Mesh(new THREE.PlaneGeometry(5.2 * CM, 1.3 * CM), mat('#3f6a2a', { rough: 0.6 })); band.position.set(0, (10.6 + y0) * CM, 2.88 * CM); g.add(band);
  return finish(g);
}
// a Dorica bottle (500 ml) of red-wine vinegar: round, clear glass, a short sharp shoulder, a long neck,
// a red screw cap, a label wrapped part way round (traced)
export function vinegarBottleMesh() {
  const g = new THREE.Group(), y0 = -10;
  g.add(turned([[0, 0.25], [2.7, 0], [3.0, 0.4], [3.05, 1], [3.05, 20.6], [2.95, 20.9], [2.45, 21.2], [1.9, 21.4], [1.65, 21.6], [1.55, 22.5], [1.5, 23.8], [1.43, 24.4], [1.5, 24.6], [1.45, 24.8], [1.45, 25.2], [0, 25.2]].map(([a, b]) => [a, b + y0]), mat('#f2f7f4', { rough: 0.04, metal: 0.1, opacity: 0.35, double: true }), { seg: 32, sharp: true }));
  g.add(turned([[0, 0.5], [2.9, 0.5], [2.9, 17], [0, 17]].map(([a, b]) => [a, b + y0]), mat('#7a1e1a', { rough: 0.2, opacity: 0.88 }), { seg: 28, sharp: true }));
  g.add(turned([[0, 24.8], [1.6, 24.8], [1.6, 26.6], [0, 26.6]].map(([a, b]) => [a, b + y0]), mat('#8b1a1a', { metal: 0.6, rough: 0.35 }), { seg: 24, sharp: true }));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(3.08 * CM, 3.08 * CM, 9 * CM, 32, 1, true, -1.75, 3.5), mat('#f4ede0', { rough: 0.7 })); label.position.y = (9 + y0) * CM; g.add(label);
  return finish(g);
}
// a Kilner clip-top jar (1 l) of sugar: round glass, a bead at the neck, the glass lid on its orange rubber
// seal, the wire clasp at the back (traced)
export function sugarJarMesh() {
  const g = new THREE.Group(), glass = mat('#eef5f0', { rough: 0.04, metal: 0.1, opacity: 0.3, double: true }), y0 = -8;
  const P = (pts) => pts.map(([a, b, c]) => (c === undefined ? [a, b + y0] : [a, b + y0, c]));
  g.add(turned(P([[0, 0.2], [4.0, 0], [4.2, 0.6], [4.7, 1.1], [5.08, 1.6], [5.31, 2.0], [5.44, 2.5], [5.5, 3.1], [5.5, 10.5], [5.44, 11], [5.25, 11.9], [5.0, 12.9], [4.72, 13.8], [4.6, 14.3], [4.85, 14.4], [4.6, 14.6], [4.6, 16.5]]), glass, { seg: 36, sharp: true }));
  g.add(turned(P([[0, 0.6], [5.0, 0.6], [5.1, 1.6], [5.1, 10.6], [0, 10.8]]), mat('#fbf8f2', { rough: 0.9 }), { seg: 32 }));
  g.add(turned(P([[4.6, 16.5], [5.0, 16.5], [5.0, 16.75], [4.6, 16.75]]), mat('#f28a1e', { rough: 0.6 }), { seg: 36, sharp: true }));
  g.add(turned(P([[0, 18], [4.2, 18], [4.6, 17.7], [4.65, 16.8], [0, 16.8]]), glass, { seg: 36 }));
  const wire = mat('#b0afac', { metal: 1, rough: 0.3 });
  g.add(new THREE.Mesh(sweep(P([[-4.7, 14.1, -2.0], [-5.25, 14.1, 0], [-4.7, 14.1, 2.0]]), 0.13, 0.13, { seg: 20, radial: 6 }), wire));
  g.add(new THREE.Mesh(sweep(P([[-4.6, 17.9, -2.4], [-5.4, 17.2, -2.2], [-5.6, 15.0, 0], [-5.4, 17.2, 2.2], [-4.6, 17.9, 2.4]]), 0.13, 0.13, { seg: 30, radial: 6 }), wire));
  g.add(new THREE.Mesh(sweep(P([[-5.6, 15.0, 0], [-6.4, 12.5, 0], [-6.6, 10.6, 0]]), 0.15, 0.15, { seg: 12, radial: 6 }), wire)); // (the lever)
  return finish(g);
}
// (a rounded square prism, sides w × d with corner radius rad, from y0 up to y1 – cm)
function roundedPrism(w, d, rad, y0, y1) {
  const s = new THREE.Shape(), a = w - rad, b = d - rad;
  s.moveTo(-a, -d); s.lineTo(a, -d); s.quadraticCurveTo(w, -d, w, -b); s.lineTo(w, b); s.quadraticCurveTo(w, d, a, d); s.lineTo(-a, d); s.quadraticCurveTo(-w, d, -w, b); s.lineTo(-w, -b); s.quadraticCurveTo(-w, -d, -a, -d);
  const geo = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, y0, 0); geo.scale(CM, CM, CM);
  return geo;
}

// ------------------------------------------------------------------ by kind
// The board's knife carried in a hand: hanging from the fist, the blade down (the handle up through it).
function hangingKnife() {
  const g = new THREE.Group(), k = chefKnifeMesh();
  k.rotation.z = -Math.PI / 2;
  k.position.y = -4 * KN; // (the fist round the handle, 4 cm behind the bolster)
  g.add(k);
  return finish(g);
}
// A tool of the kitchen by its kind (shared/ingredients.js TOOLS): a copy of its model. userData: under
// (how far below the origin it reaches lying on its face), foot (standing / hanging: how far below)
const MAKERS = {
  fork: forkMesh, spoon: spoonDinnerMesh, teaspoon: teaspoonMesh, tableKnife: tableKnifeMesh, ladle: ladleMesh, whisk: whiskMesh,
  spatula: turnerMesh, woodSpoon: woodSpoonMesh, tongs: tongsMesh, masher: masherMesh, rollingPin: rollingPinMesh, scissors: scissorsMesh,
  chefKnife: hangingKnife, peeler: peelerMesh, grater: graterMesh, oilBottle: oilBottleMesh, vinegarBottle: vinegarBottleMesh, sugarJar: sugarJarMesh,
};
const MADE = new Map();
export function utensilMesh(kind) {
  let g = MADE.get(kind);
  if (!g) { g = (MAKERS[kind] || forkMesh)(); MADE.set(kind, g); }
  return g.clone();
}
export function utensilFoot(kind) { return utensilMesh(kind).userData.foot || 0; }

// The Le Creuset utensil jar (the crock at a counter's corner) in the kitchen's colour: straight-sided
// stoneware, a rounded foot with three grooves above it, a thickened rim, a cream glaze inside.
export function crockMesh(color) {
  const g = new THREE.Group();
  const k = CM; // (life size: 13 across, 14.6 tall)
  const body = spin(at([[0, 0.35], [3.7, 0.35], [4.1, 0], [5.6, 0], [6.2, 0.25], [6.45, 0.7], [6.5, 1.5], [6.5, 1.75], [6.62, 1.8], [6.62, 2.0], [6.5, 2.05], [6.5, 2.25], [6.62, 2.3], [6.62, 2.5], [6.5, 2.55], [6.5, 3.25], [6.62, 3.3], [6.62, 3.5], [6.5, 3.55], [6.5, 3.75], [6.62, 3.8], [6.62, 4.0], [6.5, 4.05], [6.5, 14.2], [6.45, 14.45], [6.2, 14.6], [5.95, 14.55], [5.85, 14.35]], k), new THREE.MeshStandardMaterial({ roughness: 0.14, vertexColors: true }), 48);
  const top = new THREE.Color(color).offsetHSL(0, 0, 0.06), base = new THREE.Color(color).offsetHSL(0, 0.05, -0.16), p = body.geometry.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) { const c = base.clone().lerp(top, Math.min(1, p.getY(i) / (14.6 * k))); col.push(c.r, c.g, c.b); }
  body.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.add(body);
  g.add(spin(at([[5.85, 14.35], [5.8, 2.0], [5.4, 1.2], [0, 1.1]], k), mat('#dcd2bd', { rough: 0.3, double: true }), 40));
  g.add(spin(at([[4.1, 0.01], [5.6, 0.01], [5.6, 0.12], [4.1, 0.12]], k), mat('#c9b48f', { rough: 0.8 }), 40)); // (the unglazed foot)
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;

}
