// Building blocks for the procedural 3D kitchen (the same approach as
// Detective Achille's dioramas): cached materials, primitive meshes placed
// with their base at the given y, and bake(), which merges a finished model
// into one mesh per material so a detailed kitchen stays cheap to draw.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const matCache = new Map();

// opts: {rough, metal, emissive, ei, opacity, double, map}
export function mat(color, opts = {}) {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.ei ?? 0}|${opts.opacity ?? 1}|${opts.double ?? false}|${opts.map ? opts.map.uuid : ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      ...(opts.map ? { map: opts.map } : {}),
      ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: opts.ei ?? 1 } : {}),
      ...(opts.opacity !== undefined && opts.opacity < 1 ? { transparent: true, opacity: opts.opacity, depthWrite: false } : {}),
      ...(opts.double ? { side: THREE.DoubleSide } : {}),
    });
    matCache.set(key, m);
  }
  return m;
}

export const C = {
  steel: '#c9ccd2', steelDark: '#8a8f99', iron: '#2a2c2e', copper: '#d0804a', brass: '#c9a24a', gold: '#d4b062',
  wood: '#8a5a36', woodDark: '#5a3a24', woodLight: '#c09060', ink: '#3d2a24', white: '#f8f6f0', glass: '#cfe6f0',
  terracotta: '#b8643e', clay: '#c8784a', leaf: '#4f9a3f', leafDark: '#357a2f',
};

export const M = {
  steel: () => mat(C.steel, { metal: 0.85, rough: 0.28 }),
  steelDark: () => mat(C.steelDark, { metal: 0.8, rough: 0.35 }),
  brass: () => mat(C.brass, { metal: 0.85, rough: 0.32 }),
  copper: () => mat(C.copper, { metal: 0.85, rough: 0.3 }),
  iron: () => mat(C.iron, { metal: 0.5, rough: 0.5 }),
  glass: () => mat(C.glass, { rough: 0.05, metal: 0.1, opacity: 0.45 }),
  enamel: (c) => mat(c, { rough: 0.25, metal: 0.05 }),
  wood: (c = C.wood) => mat(c, { rough: 0.7 }),
};

function placed(geo, m, x, y, z) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  return mesh;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

/** A box with its base at y. */
export function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = placed(boxGeo, m, x, y + h / 2, z);
  mesh.scale.set(w, h, d);
  return mesh;
}

const rboxCache = new Map();
/** A box with rounded edges (radius r), base at y. */
export function rbox(w, h, d, m, x = 0, y = 0, z = 0, r = 0.02) {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${rr.toFixed(3)}`;
  let geo = rboxCache.get(key);
  if (!geo) { geo = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, rr)); rboxCache.set(key, geo); }
  return placed(geo, m, x, y + h / 2, z);
}

/** A cylinder (or cone) with its base at y. */
export function cyl(rTop, rBot, h, m, x = 0, y = 0, z = 0, seg = 16) {
  return placed(new THREE.CylinderGeometry(rTop, rBot, h, seg), m, x, y + h / 2, z);
}

/** A turned shape from [radius, height] points, base of the profile at y. */
export function lathe(points, m, x = 0, y = 0, z = 0, seg = 20) {
  return placed(new THREE.LatheGeometry(points.map(([r, py]) => new THREE.Vector2(r, py)), seg), m, x, y, z);
}

/** A sphere centred at (x, y, z), optionally squashed. */
export function ball(r, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 14) {
  const mesh = placed(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), m, x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}

/** A torus lying flat (a ring), centred at (x, y, z). */
export function ring(r, tube, m, x = 0, y = 0, z = 0, seg = 24, arc = Math.PI * 2) {
  const mesh = placed(new THREE.TorusGeometry(r, tube, 8, seg, arc), m, x, y, z);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** A capsule between two points. */
export function limb(a, b, r, m) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/** A round rod from a to b. */
export function rod(a, b, r, m, seg = 8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg), m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

/** A flat plane facing +y (or rotated), centred. */
export function plane(w, d, m, x = 0, y = 0, z = 0) {
  const mesh = placed(new THREE.PlaneGeometry(w, d), m, x, y, z);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function turn(o, y, x = 0, z = 0) { o.rotation.set(x, y, z); return o; }

const noRaycast = () => undefined;

/** Merges every mesh under `root` into one mesh per material (lights kept). */
export function bake(root, { cast = true, receive = true } = {}) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map();
  const out = new THREE.Group();
  const rel = new THREE.Matrix4();
  root.traverse((o) => {
    if (o.isMesh) {
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.clearGroups();
      geo.applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld));
      const list = groups.get(o.material) || [];
      list.push(geo);
      groups.set(o.material, list);
    }
  });
  for (const [m, geos] of groups) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m);
    const glowing = m.emissiveIntensity >= 0.3 && m.emissive && m.emissive.getHex() !== 0;
    mesh.castShadow = cast && !glowing && !m.transparent;
    mesh.receiveShadow = receive;
    mesh.raycast = noRaycast;
    out.add(mesh);
  }
  return out;
}

// A chef's knife: a slim blade forward from its origin (x), its edge down (-y),
// a dark wooden handle back from it (the board's own, and in my hand in first person).
export function chefKnife() {
  const g = new THREE.Group();
  const sh = new THREE.Shape();
  sh.moveTo(0.012, -0.022); sh.lineTo(0.1, -0.02); sh.quadraticCurveTo(0.13, -0.016, 0.135, 0.004); sh.lineTo(0.012, 0.006); sh.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.0018, bevelEnabled: false }), mat('#d8dde2', { metal: 0.85, rough: 0.22 }));
  blade.position.z = -0.0009;
  g.add(blade);
  g.add(box(0.008, 0.02, 0.012, mat('#9aa0a6', { metal: 0.8, rough: 0.3 }), 0.009, -0.01, 0)); // (the bolster)
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.0068, 0.032, 4, 10), mat('#5a3a24', { rough: 0.5 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-0.0145, -0.006, 0);
  g.add(handle);
  return g;
}

// A swivel peeler: its handle in the fist at the origin, the steel fork and the
// slotted blade across its end below (-y) – as a tool hangs from the fist.
export function peelerMesh() {
  const g = new THREE.Group();
  const steel = mat('#cfd4da', { metal: 0.85, rough: 0.25 });
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.0065, 0.038, 4, 10), mat('#5aa83c', { rough: 0.45 }));
  handle.position.y = -0.004;
  g.add(handle);
  for (const s of [-1, 1]) g.add(box(0.0022, 0.034, 0.003, steel, s * 0.0085, -0.044, 0)); // (the fork)
  g.add(box(0.019, 0.0022, 0.003, steel, 0, -0.03, 0));
  const blade = box(0.017, 0.006, 0.0012, steel, 0, -0.058, 0);
  blade.rotation.x = 0.35;
  g.add(blade);
  g.add(box(0.012, 0.0008, 0.0016, mat('#3a3e44', { metal: 0.6, rough: 0.4 }), 0, -0.058, 0.0004)); // (its slot)
  return g;
}

// A box grater: four steel faces full of little holes, narrowing up to a handle on
// top – held by that handle at the origin, standing on its open foot 0.115 below.
let HOLES = null;
export function boxGrater() {
  const g = new THREE.Group();
  if (!HOLES) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#d6dbe0'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#4a4f56';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.beginPath(); x.ellipse(4 + i * 8 + (j % 2) * 4, 4 + j * 8, 2.2, 1.4, 0, 0, Math.PI * 2); x.fill(); }
    HOLES = new THREE.CanvasTexture(c);
    HOLES.wrapS = HOLES.wrapT = THREE.RepeatWrapping;
    HOLES.repeat.set(4, 3);
    HOLES.colorSpace = THREE.SRGBColorSpace;
  }
  const faces = new THREE.MeshStandardMaterial({ map: HOLES, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.036, 0.1, 4, 1, true), faces);
  body.rotation.y = Math.PI / 4;
  body.scale.set(1.25, 1, 1);
  body.position.y = -0.065;
  g.add(body);
  const steel = mat('#cfd4da', { metal: 0.85, rough: 0.25 });
  const lid = box(0.044, 0.002, 0.035, steel, 0, -0.015, 0);
  g.add(lid);
  // (the handle: a loop over the top)
  const loop = ring(0.014, 0.0035, mat('#2e2e34', { rough: 0.5 }), 0, -0.014, 0, 16, Math.PI);
  loop.rotation.set(0, 0, 0); // (an arch standing up over the top)
  g.add(loop);
  return g;
}

// The kitchen's tools as things of their own (shared/ingredients.js TOOLS): each
// held at its origin – where a fist takes it – its working end down (-y), the
// handle up (+y), a flat one's faces toward ±z. Upright ones (bottles, a jar, the
// grater) stand on their foot (`foot` below the origin: utensilFoot).
const UT_CACHE = new Map();
const FOOT = { oilBottle: 0.09, vinegarBottle: 0.08, sugarJar: 0.07, grater: 0.115 };
export function utensilFoot(kind) { return FOOT[kind] || 0; }
export function utensilMesh(kind) {
  let g = UT_CACHE.get(kind);
  if (g) return g.clone();
  g = new THREE.Group();
  const steel = mat('#d4d8de', { metal: 0.85, rough: 0.25 }), wood = mat('#c9955a', { rough: 0.6 }), dark = mat('#2e2e34', { rough: 0.5 });
  const flatBowl = (r, y, m) => { const b = ball(r, m, 0, y, 0, 1, 1.45, 0.32, 12); return b; };
  const tines = (y0) => { for (let i = 0; i < 4; i++) g.add(box(0.0016, 0.028, 0.0016, steel, -0.0054 + i * 0.0036, y0 - 0.028, 0)); };
  switch (kind) {
    case 'fork':
      g.add(box(0.008, 0.06, 0.0026, steel, 0, -0.032, 0));
      g.add(box(0.013, 0.012, 0.0024, steel, 0, -0.045, 0));
      tines(-0.045);
      break;
    case 'spoon': case 'teaspoon': {
      const k = kind === 'teaspoon' ? 0.75 : 1;
      g.add(box(0.007 * k, 0.062 * k, 0.0026, steel, 0, -0.034 * k, 0));
      g.add(flatBowl(0.011 * k, -0.06 * k, steel));
      break;
    }
    case 'tableKnife':
      g.add(box(0.009, 0.05, 0.005, steel, 0, -0.025, 0));
      g.add(box(0.011, 0.062, 0.0014, steel, 0.001, -0.087, 0));
      g.add(ball(0.0055, steel, 0.0015, -0.087, 0, 1, 1, 0.13, 8));
      break;
    case 'ladle': {
      g.add(rod(v3(0, 0.035, 0), v3(0, -0.11, 0.004), 0.004, steel));
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#d4d8de', { metal: 0.85, rough: 0.25, double: true }));
      bowl.rotation.x = -Math.PI / 2; // (its hollow toward +z: face up when it lies)
      bowl.position.set(0, -0.13, 0.026);
      g.add(bowl);
      break;
    }
    case 'whisk':
      g.add(cyl(0.007, 0.006, 0.07, dark, 0, -0.02, 0, 10));
      for (let i = 0; i < 4; i++) { const w = ring(0.018, 0.0012, steel, 0, -0.085, 0, 18); w.rotation.set(0, (i * Math.PI) / 4, 0); w.scale.set(1, 2.4, 1); g.add(w); }
      break;
    case 'spatula':
      g.add(cyl(0.006, 0.006, 0.075, dark, 0, -0.03, 0, 8));
      g.add(box(0.008, 0.03, 0.002, steel, 0, -0.06, 0));
      g.add(box(0.04, 0.05, 0.002, steel, 0, -0.11, 0));
      break;
    case 'woodSpoon':
      g.add(cyl(0.006, 0.0055, 0.13, wood, 0, -0.085, 0, 8));
      g.add(flatBowl(0.016, -0.1, wood));
      break;
    case 'tongs':
      for (const s of [-1, 1]) { const b = box(0.011, 0.13, 0.002, steel, 0, -0.11, s * 0.004); b.rotation.x = s * 0.06; g.add(b); }
      g.add(ring(0.007, 0.0018, steel, 0, 0.02, 0, 10));
      break;
    case 'masher': {
      g.add(cyl(0.009, 0.008, 0.06, wood, 0, -0.02, 0, 10));
      g.add(rod(v3(0, -0.02, 0), v3(0, -0.1, 0), 0.0025, steel));
      const p = ring(0.022, 0.003, steel, 0, -0.1, 0, 16);
      g.add(p);
      break;
    }
    case 'rollingPin': {
      const r = cyl(0.02, 0.02, 0.16, wood, 0, -0.08, 0, 14);
      g.add(r);
      for (const y of [0.08, -0.11]) g.add(cyl(0.009, 0.009, 0.03, wood, 0, y, 0, 10));
      break;
    }
    case 'scissors':
      for (const s of [-1, 1]) {
        const b = box(0.006, 0.06, 0.0015, steel, 0, -0.07, s * 0.001);
        b.rotation.z = s * 0.05;
        g.add(b);
        const h = ring(0.009, 0.0025, mat('#d8402a', { rough: 0.4 }), s * 0.008, 0, 0, 12);
        h.rotation.set(0, 0, 0);
        g.add(h);
      }
      break;
    case 'chefKnife': {
      // (the board's knife: its blade along x – turned to hang down from the grip)
      const k = chefKnife();
      k.rotation.z = -Math.PI / 2;
      k.position.y = -0.0145;
      g.add(k);
      break;
    }
    case 'peeler': g.add(peelerMesh()); break;
    case 'grater': g.add(boxGrater()); break;
    case 'oilBottle':
      g.add(lathe([[0, 0], [0.04, 0.01], [0.04, 0.14], [0.015, 0.2], [0.012, 0.24]], mat('#c9c83a', { rough: 0.15, opacity: 0.8 }), 0, -0.09, 0, 12));
      g.add(cyl(0.013, 0.013, 0.02, dark, 0, 0.145, 0, 8));
      break;
    case 'vinegarBottle':
      g.add(lathe([[0, 0], [0.03, 0.01], [0.03, 0.12], [0.012, 0.17], [0.01, 0.2]], mat('#c06a3a', { rough: 0.15, opacity: 0.8 }), 0, -0.08, 0, 12));
      g.add(cyl(0.011, 0.011, 0.018, dark, 0, 0.115, 0, 8));
      break;
    case 'sugarJar':
      g.add(cyl(0.07, 0.07, 0.16, M.glass(), 0, -0.07, 0, 14));
      g.add(cyl(0.065, 0.065, 0.1, mat('#f6f1e6'), 0, -0.065, 0, 14));
      g.add(cyl(0.072, 0.072, 0.025, mat('#c9a24a', { rough: 0.5 }), 0, 0.09, 0, 14));
      break;
    default:
      g.add(cyl(0.006, 0.006, 0.12, steel, 0, -0.1, 0, 6));
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  UT_CACHE.set(kind, g);
  return g.clone();
}
