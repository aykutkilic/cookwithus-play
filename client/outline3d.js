// Outlines: a thing drawn as nothing but the line round its silhouette – the ghost of what I hold where it will go,
// what E would take, where the knife will come down. No see-through fill over it: the user, 2026-11-09, "ghost
// should only show the outline of the object".
//
// How: each mesh is drawn twice more, after everything else. First its own shape, writing nothing but a 1 into
// the stencil where it is (a mask); then the same shape blown up by a few pixels on the screen along its (smoothed)
// normals, drawn only where the stencil isn't 1 – what's left is a ring of even width round its silhouette, as wide
// near or far. With depth: hidden behind what's in front of it; x-ray: seen through everything (the knife's ghost
// down inside the food). The renderer and the composer's target must have a stencil buffer (scene3d.js).
import * as THREE from 'three';

// (the drawing buffer's size in pixels: the ring's width is in pixels of it)
const RES = { value: new THREE.Vector2(1, 1) };
export function setOutlineRes(w, h) { RES.value.set(Math.max(1, w), Math.max(1, h)); }

// the normals of each mesh's shape averaged where its corners meet (a box's split faces would open gaps at its
// corners when blown up) – made once for each shape, its position and index shared, not copied
const SMOOTH = new WeakMap();
function outlineGeometry(geo) {
  let g = SMOOTH.get(geo);
  if (g) return g;
  const pos = geo.getAttribute('position');
  g = new THREE.BufferGeometry();
  g.setAttribute('position', pos);
  if (geo.index) g.setIndex(geo.index);
  let nrm = geo.getAttribute('normal');
  if (!nrm) { const t = new THREE.BufferGeometry(); t.setAttribute('position', pos); if (geo.index) t.setIndex(geo.index); t.computeVertexNormals(); nrm = t.getAttribute('normal'); }
  const sum = new Map(), keyOf = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = (keys[i] = keyOf(i));
    const s = sum.get(k) || [0, 0, 0];
    s[0] += nrm.getX(i); s[1] += nrm.getY(i); s[2] += nrm.getZ(i);
    sum.set(k, s);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sum.get(keys[i]), l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l; out[i * 3 + 1] = s[1] / l; out[i * 3 + 2] = s[2] / l;
  }
  g.setAttribute('oNormal', new THREE.BufferAttribute(out, 3));
  g.boundingSphere = geo.boundingSphere; g.boundingBox = geo.boundingBox;
  SMOOTH.set(geo, g);
  return g;
}

// a style: {color, width (px), opacity, xray} → its two materials, made once
const STYLES = new Map();
function materialsOf(style) {
  const key = `${style.color}|${style.width}|${style.opacity}|${!!style.xray}`;
  let m = STYLES.get(key);
  if (m) return m;
  const mask = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: !style.xray, transparent: true, side: THREE.DoubleSide });
  Object.assign(mask, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp });
  const ring = new THREE.ShaderMaterial({
    uniforms: { uRes: RES, uWidth: { value: style.width }, uColor: { value: new THREE.Color(style.color) }, uOpacity: { value: style.opacity ?? 1 } },
    vertexShader: `attribute vec3 oNormal; uniform vec2 uRes; uniform float uWidth;
void main() {
  vec4 p = vec4(position, 1.0); vec3 n = oNormal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
#endif
  vec4 clip = projectionMatrix * modelViewMatrix * p;
  vec3 vn = normalize(mat3(modelViewMatrix) * n);
  vec2 d = (projectionMatrix * vec4(vn, 0.0)).xy * uRes; // (its way on the screen, in pixels)
  float l = length(d);
  if (l > 1e-6) clip.xy += d / l * uWidth * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`,
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main() { gl_FragColor = vec4(uColor, uOpacity); }',
    transparent: true, depthWrite: false, depthTest: !style.xray, side: THREE.DoubleSide,
  });
  Object.assign(ring, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp });
  m = { mask, ring };
  STYLES.set(key, m);
  return m;
}

// the two outline meshes for one mesh (its own transform left to the parent they're put under)
function outlinePair(o, style) {
  const M = materialsOf(style), mk = (geo, mat, order) => {
    const c = o.isInstancedMesh ? new THREE.InstancedMesh(geo, mat, o.count) : new THREE.Mesh(geo, mat);
    if (o.isInstancedMesh) c.instanceMatrix = o.instanceMatrix;
    c.renderOrder = order; c.raycast = () => {}; c.castShadow = c.receiveShadow = false; c.frustumCulled = false;
    c.userData.glow = true;
    return c;
  };
  return [mk(o.geometry, M.mask, 30), mk(outlineGeometry(o.geometry), M.ring, 31)];
}
const drawn = (o) => o.isMesh && !o.isSprite && !o.userData.glow && o.geometry && o.geometry.getAttribute('position');

// A thing outlined in place, or not: the outline rides along as each mesh's children (doors swing, pans move);
// slot: which outline (the pointed-at one, …), so different ones don't trade styles
export function setOutline(o, on, style, slot = 'outline') {
  o.traverse((m) => {
    if (!drawn(m)) return;
    let g = m.userData[slot];
    if (!g) {
      if (!on) return;
      g = new THREE.Group();
      g.userData.glow = true;
      g.add(...outlinePair(m, style));
      m.userData[slot] = g;
      m.add(g);
    }
    g.visible = on;
  });
}

// A copy of a thing made of nothing but its outline – its own shapes, posed as its meshes are within it (skip: a
// part of it left out – a pot's lid). The copy's root is at the thing's own origin, to be posed by the caller.
export function outlineCopy(src, style, skip = null) {
  const copy = (o) => {
    if (o === skip || o.userData.glow || !o.visible || o.isSprite || o.isLine || o.isPoints) return null;
    const c = new THREE.Group();
    c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
    if (drawn(o)) c.add(...outlinePair(o, style));
    for (const ch of o.children) { const cc = copy(ch); if (cc) c.add(cc); }
    return c;
  };
  const body = copy(src) || new THREE.Group();
  body.position.set(0, 0, 0); body.quaternion.identity(); body.scale.set(1, 1, 1);
  const root = new THREE.Group();
  root.add(body);
  return root;
}
