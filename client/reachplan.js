// Planning a hand's way through the kitchen (first person, played from motion capture or a Blender clip):
// - Contact: a hand that takes a thing arrives exactly at the thing's grasp point, and a thing it carries moves only
//   while it's in the hand. A recorded path ends where the thing was in the recording, not where it is in this kitchen,
//   so it's bent there over the last stretch of the reach (motion warping / target matching) – contactOffset.
// - Clearance: the hand and forearm as a few spheres, what's near as boxes; the whole path is pushed out of them once,
//   kept smooth (a small CHOMP – Ratliff et al. 2009: covariant gradient steps on a distance field, here exact distances
//   to boxes) – planClear; each frame what's left is pushed out (pushOut).
import * as THREE from 'three';

const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// How far a palm is to be moved at time t (s) to keep its contacts: contacts [{ grab, set, Pg, Ps }] – the hand at Pg at
// grab (takes it), carrying it to Ps at set (puts it down); palmAt(t): the path as recorded. Bent in over win before the
// grab, carried across between, let go over win after the set.
export function contactOffset(t, contacts, palmAt, win = 0.6) {
  for (const c of contacts) {
    if (t < c.grab - win || t > c.set + win) continue;
    const pg = palmAt(c.grab), ps = palmAt(c.set);
    if (!pg || !ps) continue;
    const og = c.Pg.clone().sub(pg), os = c.Ps.clone().sub(ps);
    if (t < c.grab) return og.multiplyScalar(sm((t - (c.grab - win)) / win));
    if (t <= c.set) return og.lerp(os, sm((t - c.grab) / Math.max(1e-3, c.set - c.grab)));
    return os.multiplyScalar(1 - sm((t - c.set) / win));
  }
  return new THREE.Vector3();
}

// A sphere (centre p, radius r) against a box (Box3): how far its surface is outside (below 0: in that deep) and the way
// out (unit)
const Q = new THREE.Vector3();
export function sphereBox(p, r, b) {
  Q.copy(p).clamp(b.min, b.max);
  const d = Q.distanceTo(p);
  if (d > 1e-7) return { sd: d - r, n: p.clone().sub(Q).divideScalar(d) };
  // (its centre inside: out through the nearest face – of those facing the work, b.out, when the box says where that is:
  // a hand gets out of a thing on the side toward what it's working on, not toward my eyes or behind it)
  let f = [[p.x - b.min.x, -1, 0, 0], [b.max.x - p.x, 1, 0, 0], [p.y - b.min.y, 0, -1, 0], [b.max.y - p.y, 0, 1, 0], [p.z - b.min.z, 0, 0, -1], [b.max.z - p.z, 0, 0, 1]];
  if (b.out) { const g = f.filter((x) => x[1] * b.out.x + x[2] * b.out.y + x[3] * b.out.z > 0.3); if (g.length) f = g; }
  f.sort((a, c) => a[0] - c[0]);
  return { sd: -f[0][0] - r, n: new THREE.Vector3(f[0][1], f[0][2], f[0][3]) };
}

// The spheres a hand is, palm at P, fingers along d (unit), the forearm back toward the shoulder sh (kitchen units: a hand
// about 10 cm long at the game's scale)
export function handSpheres(P, d, sh) {
  const wrist = P.clone().addScaledVector(d, -0.04);
  const back = sh ? sh.clone().sub(wrist).normalize() : d.clone().negate();
  return [
    { p: P.clone(), r: 0.03 },
    { p: P.clone().addScaledVector(d, 0.03), r: 0.026 },
    { p: P.clone().addScaledVector(d, 0.055), r: 0.02 },
    { p: wrist, r: 0.024 },
    { p: wrist.clone().addScaledVector(back, 0.07), r: 0.026 },
    { p: wrist.clone().addScaledVector(back, 0.14), r: 0.03 },
  ];
}

// The worst overlap of these spheres with these boxes (below 0: in that deep)
export function clearance(spheres, boxes) {
  let m = Infinity;
  for (const s of spheres) for (const b of boxes) m = Math.min(m, sphereBox(s.p, s.r, b).sd);
  return m;
}

// The whole path pushed clear: n frames; at(k) → { P, d, sh } (the palm, the fingers' way, the shoulder) or null; boxes(k)
// → the boxes in the way then; fixed: frames that mustn't move (contacts). Offsets per frame (Vector3), smoothed.
export function planClear(n, at, boxes, { iters = 120, margin = 0.008, step = 1, smooth = 0.25, fixed = new Set() } = {}) {
  const D = Array.from({ length: n }, () => new THREE.Vector3());
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < n; k++) {
      if (fixed.has(k)) continue;
      const a = at(k);
      if (!a) continue;
      const P = a.P.clone().add(D[k]), g = new THREE.Vector3();
      for (const s of handSpheres(P, a.d, a.sh)) for (const b of boxes(k)) {
        const { sd, n: nn } = sphereBox(s.p, s.r, b);
        if (sd < margin) g.addScaledVector(nn, margin - sd);
      }
      D[k].addScaledVector(g, step);
    }
    // (kept smooth: each pulled toward its neighbours' middle – a covariant step keeps the path's shape; the last few rounds
    // only push, so nothing's left in)
    if (it >= iters - 10) continue;
    const S = D.map((v) => v.clone());
    for (let k = 1; k < n - 1; k++) if (!fixed.has(k)) D[k].lerp(S[k - 1].clone().add(S[k + 1]).multiplyScalar(0.5), smooth);
  }
  return D;
}

// What's left, this frame: the palm moved out of what it's in (one step along the way out)
export function pushOut(P, d, sh, boxes, margin = 0.004) {
  const g = new THREE.Vector3();
  for (const s of handSpheres(P, d, sh)) for (const b of boxes) {
    const { sd, n } = sphereBox(s.p, s.r, b);
    if (sd < margin) g.addScaledVector(n, margin - sd);
  }
  return g;
}

// Monocular motion capture is surest of where a hand is on the picture and least of how far away it is: a hand the
// capture puts inside a thing is moved along its own ray toward the camera (cam) – where it's seen in the reference, just
// nearer – the least that clears it, then smoothed. at, boxes: as planClear's. Offsets per frame.
export function planAlongRay(n, at, boxes, cam, { margin = 0.008, maxS = 0.4, ds = 0.004, smooth = 0.3, passes = 12, fixed = new Set() } = {}) {
  const S = new Array(n).fill(0), U = new Array(n).fill(null);
  for (let k = 0; k < n; k++) {
    const a = at(k);
    if (!a || fixed.has(k)) continue;
    const u = cam.clone().sub(a.P).normalize();
    U[k] = u;
    const B = boxes(k);
    for (let s = 0; s <= maxS; s += ds) {
      if (clearance(handSpheres(a.P.clone().addScaledVector(u, s), a.d, a.sh), B) >= margin) { S[k] = s; break; }
      S[k] = s;
    }
  }
  // (smoothed – never below what clears it: a neighbour's raised, the low one comes up to meet it)
  for (let p = 0; p < passes; p++) {
    const T = S.slice();
    for (let k = 1; k < n - 1; k++) if (U[k] && !fixed.has(k)) S[k] = Math.max(T[k], T[k] + ((T[k - 1] + T[k + 1]) / 2 - T[k]) * smooth);
  }
  return S.map((s, k) => (U[k] ? U[k].clone().multiplyScalar(s) : new THREE.Vector3()));
}
