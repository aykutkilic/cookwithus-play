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
