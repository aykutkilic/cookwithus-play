// The cooks in 3D: chunky chibi figurines (big heads, aprons, chef's hats)
// built from primitives in the avatar's colours, with a few joints – hips,
// shoulders, neck – so they walk, bob, and do with their arms what their
// player's hands are doing at the station (knife up and down, stirring,
// scrubbing, pouring). Height ≈ 0.8 of a floor square.
import * as THREE from 'three';
import { mat, M, ball, cyl, lathe, limb, rbox, ring, box, v3 } from './parts3d.js';
import { lookOf } from './figure.js';

const SKIN_R = 0.6;

export function buildCook(avatar) {
  const L = lookOf(avatar);
  const skin = mat(L.skin, { rough: SKIN_R });
  const shirt = mat(L.shirt, { rough: 0.75 });
  const apron = mat(L.apron, { rough: 0.85 });
  const trousers = mat('#3a3448', { rough: 0.8 });
  const shoe = mat('#3a2a24', { rough: 0.6 });
  const hairM = mat(L.hairColor, { rough: 0.85 });
  const ink = mat('#1e1614', { rough: 0.3 });

  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs while walking
  root.add(body);

  // legs (hip joints swing)
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.055, 0.2, 0);
    hip.add(limb(v3(0, 0, 0), v3(0, -0.16, 0), 0.038, trousers));
    hip.add(ball(0.05, shoe, 0, -0.175, 0.02, 0.9, 0.6, 1.3, 10));
    body.add(hip);
    legs.push(hip);
  }
  // torso with the apron
  body.add(lathe([[0.0, 0.17], [0.1, 0.18], [0.12, 0.26], [0.115, 0.36], [0.09, 0.43], [0.0, 0.44]], shirt, 0, 0, 0, 18));
  body.add(rbox(0.17, 0.2, 0.02, apron, 0, 0.18, 0.1, 0.01));
  body.add(rbox(0.11, 0.07, 0.016, apron, 0, 0.36, 0.085, 0.008));
  body.add(rbox(0.06, 0.035, 0.012, mat(shade(L.apron, -0.15)), 0, 0.25, 0.112, 0.006)); // pocket
  body.add(ball(0.025, apron, -0.03, 0.29, -0.11, 1, 0.7, 0.6));
  body.add(ball(0.025, apron, 0.03, 0.29, -0.11, 1, 0.7, 0.6)); // the bow at the back
  body.add(ring(0.118, 0.008, apron, 0, 0.29, 0, 20));

  // arms (shoulder joints)
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.115, 0.4, 0);
    sh.add(limb(v3(0, 0, 0), v3(0, -0.14, 0), 0.032, shirt));
    const hand = ball(0.036, skin, 0, -0.165, 0);
    sh.add(hand);
    body.add(sh);
    arms.push(sh);
  }
  // what the right hand holds
  const tool = new THREE.Group();
  tool.position.set(0, -0.17, 0.02);
  arms[1].add(tool);
  // a handful of scraps carried in front
  const carry = new THREE.Group();
  carry.position.set(0, 0.27, 0.16);
  carry.visible = false;
  for (let i = 0; i < 6; i++) carry.add(ball(0.025, mat(['#c98a3c', '#f4e4c8', '#4f9a3a', '#e8432e'][i % 4], { rough: 0.7 }), (i % 3 - 1) * 0.03, Math.floor(i / 3) * 0.02, (i % 2) * 0.02, 1.4, 0.6, 1));
  body.add(carry);

  // head
  const head = new THREE.Group();
  head.position.set(0, 0.43, 0);
  body.add(head);
  head.add(ball(0.155, skin, 0, 0.15, 0, 1, 0.97, 0.95, 22));
  for (const sx of [-1, 1]) head.add(ball(0.03, skin, sx * 0.152, 0.15, 0, 0.6, 1, 0.8));
  // face (+z)
  for (const sx of [-1, 1]) {
    head.add(ball(0.019, ink, sx * 0.055, 0.165, 0.136, 0.8, 1.15, 0.6));
    head.add(ball(0.006, mat('#ffffff', { emissive: '#ffffff', ei: 0.4 }), sx * 0.055 + 0.006, 0.175, 0.149));
    head.add(ball(0.024, mat('#f08a8a', { rough: 0.8, opacity: L.extra === 4 ? 0.85 : 0.5 }), sx * 0.09, 0.125, 0.12, 1, 0.6, 0.4));
    head.add(box(0.035, 0.007, 0.008, mat(shade(L.hairColor, -0.1)), sx * 0.055, 0.205, 0.138)); // brows
  }
  head.add(ball(0.02, skin, 0, 0.14, 0.155, 1, 0.9, 0.8));
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12, Math.PI), mat('#7a2a24'));
  smile.position.set(0, 0.11, 0.142);
  smile.rotation.z = Math.PI;
  head.add(smile);
  if (L.extra === 3) for (const [x, y] of [[-0.08, 0.13], [-0.1, 0.12], [0.08, 0.13], [0.1, 0.12]]) head.add(ball(0.004, mat('#8a5032'), x, y, 0.127));
  if (L.extra === 1 || L.extra === 2) {
    for (const sx of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 16), mat('#2a2a32', { metal: 0.3 }));
      g.position.set(sx * 0.055, 0.165, 0.15);
      if (L.extra === 1) g.scale.set(1.15, 0.8, 1);
      head.add(g);
    }
    head.add(box(0.03, 0.006, 0.006, mat('#2a2a32'), 0, 0.17, 0.152));
  }
  facialHair(head, L, hairM);
  hair(head, L, hairM);
  hat(head, L);

  root.userData = { legs, arms, head, body, tool, carry, toolKind: '', look: L };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return root;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt * 0.5)));
  return `#${c.getHexString()}`;
}

function facialHair(head, L, hairM) {
  if (L.facial === 1 || L.facial === 2) {
    const big = L.facial === 2;
    for (const sx of [-1, 1]) {
      const m = ball(big ? 0.032 : 0.024, hairM, sx * (big ? 0.035 : 0.025), 0.122, 0.148, 1.4, 0.55, 0.6);
      m.rotation.z = sx * (big ? -0.35 : -0.2);
      head.add(m);
    }
  } else if (L.facial === 3) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), hairM);
    b.position.set(0, 0.15, 0.012);
    head.add(b);
  } else if (L.facial === 4) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.156, 18, 10, -Math.PI * 0.1, Math.PI * 1.2, Math.PI * 0.58, Math.PI * 0.3), mat('#3a2a24', { opacity: 0.3 }));
    b.position.set(0, 0.15, 0);
    head.add(b);
  }
}

function hair(head, L, hairM) {
  if (L.hair === 7) return; // bald
  if (L.hat === 4 || L.hat === 6) return; // covered
  // a cap of hair over the back and top
  const capH = new THREE.Mesh(new THREE.SphereGeometry(0.162, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
  capH.position.set(0, 0.155, -0.008);
  capH.rotation.x = -0.35;
  head.add(capH);
  switch (L.hair) {
    case 1: for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; head.add(ball(0.05, hairM, Math.cos(a) * 0.12, 0.27 + Math.sin(i) * 0.02, Math.sin(a) * 0.12 - 0.02)); } break; // curly
    case 2: head.add(rbox(0.3, 0.24, 0.12, hairM, 0, 0.0, -0.08, 0.05)); break; // long
    case 3: head.add(ball(0.065, hairM, 0, 0.31, -0.08)); break; // bun
    case 4: head.add(limb(v3(0, 0.2, -0.15), v3(0, 0.02, -0.2), 0.04, hairM)); break; // ponytail
    case 5: head.add(ball(0.22, hairM, 0, 0.2, -0.04, 1, 0.9, 1)); break; // afro
    case 6: head.add(rbox(0.34, 0.16, 0.24, hairM, 0, 0.06, -0.04, 0.07)); break; // bob
    case 8: for (let i = 0; i < 7; i++) { const a = -1.2 + i * 0.4; head.add(cyl(0, 0.03, 0.09, hairM, Math.sin(a) * 0.1, 0.27, Math.cos(a) * 0.04 - 0.03, 6).rotateX(-0.4)); } break; // spiky
    case 9: for (const sx of [-1, 1]) head.add(limb(v3(sx * 0.11, 0.12, -0.08), v3(sx * 0.12, -0.05, -0.06), 0.03, hairM)); break; // braids
    default: break; // short
  }
  // a fringe at the front
  if (L.hair !== 5) head.add(ball(0.09, hairM, 0.03, 0.27, 0.07, 1.4, 0.45, 0.8));
}

function hat(head, L) {
  const c = mat(L.hatColor, { rough: 0.8 });
  switch (L.hat) {
    case 0: case 1: { // chef's toque, tall
      const tall = L.hat === 1 ? 0.09 : 0;
      head.add(cyl(0.135, 0.13, 0.06, c, 0, 0.25, 0, 20));
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; head.add(ball(0.075, c, Math.cos(a) * 0.08, 0.36 + tall, Math.sin(a) * 0.08, 1, 1.15 + tall * 4, 1)); }
      head.add(ball(0.09, c, 0, 0.4 + tall * 1.4, 0, 1, 1 + tall * 3, 1));
      break;
    }
    case 2: { // bandana
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.163, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), c);
      b.position.set(0, 0.16, -0.005);
      b.rotation.x = -0.25;
      head.add(b);
      head.add(ball(0.03, c, 0, 0.17, -0.16, 1.2, 0.8, 0.8));
      head.add(limb(v3(0, 0.17, -0.17), v3(0.03, 0.08, -0.2), 0.016, c));
      break;
    }
    case 3: { // beret
      const b = ball(0.16, c, 0.03, 0.29, -0.01, 1.1, 0.35, 1.1);
      b.rotation.z = -0.25;
      head.add(b);
      head.add(cyl(0.006, 0.008, 0.03, c, 0.04, 0.34, 0));
      break;
    }
    case 4: { // headscarf
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.168, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), c);
      s.position.set(0, 0.15, -0.02);
      s.rotation.x = -0.55;
      head.add(s);
      head.add(ball(0.04, c, 0, 0.02, 0.06, 1, 0.8, 0.8));
      break;
    }
    case 5: { // cap
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.162, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), c);
      s.position.set(0, 0.17, 0);
      head.add(s);
      const brim = cyl(0.1, 0.1, 0.012, c, 0, 0.2, 0.13, 16);
      brim.scale.set(1, 1, 0.6);
      head.add(brim);
      break;
    }
    case 6: { // turban
      for (let i = 0; i < 4; i++) head.add(ring(0.15 - i * 0.025, 0.035, c, 0, 0.24 + i * 0.035, -0.01, 20));
      head.add(ball(0.11, c, 0, 0.3, 0));
      head.add(ball(0.018, M.brass(), 0, 0.27, 0.15));
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------ tools in hand

const TOOL_CACHE = new Map();
function toolMesh(kind) {
  let g = TOOL_CACHE.get(kind);
  if (g) return g.clone();
  g = new THREE.Group();
  const steel = M.steel(), wood = mat('#c9955a', { rough: 0.6 });
  switch (kind) {
    case 'knife': g.add(box(0.016, 0.07, 0.03, mat('#d9573f'), 0, -0.02, 0)); g.add(box(0.006, 0.13, 0.04, steel, 0, -0.15, 0.01)); break;
    case 'peeler': g.add(box(0.02, 0.07, 0.02, mat('#5aa83c'), 0, -0.03, 0)); g.add(box(0.04, 0.012, 0.006, steel, 0, -0.06, 0)); break;
    case 'spoon': case 'ladle': case 'whisk': case 'masher': case 'brush': case 'spatula': case 'blenderStick': case 'tongs':
      g.add(cyl(0.008, 0.008, 0.16, kind === 'spoon' ? wood : steel, 0, -0.15, 0, 6));
      if (kind === 'whisk') g.add(ball(0.03, steel, 0, -0.17, 0, 1, 1.5, 1, 8));
      else if (kind === 'spatula') g.add(box(0.045, 0.004, 0.05, steel, 0, -0.16, 0.02));
      else if (kind === 'blenderStick') g.add(cyl(0.025, 0.025, 0.08, mat('#7cc8c0'), 0, -0.06, 0, 10));
      else g.add(ball(0.025, kind === 'spoon' ? wood : steel, 0, -0.16, 0, 1, 0.6, 1.2));
      break;
    case 'rollingPin': { const r = cyl(0.025, 0.025, 0.24, wood, 0, 0, 0, 10); r.rotation.z = Math.PI / 2; r.position.set(-0.11, -0.01, 0.02); g.add(r); break; }
    case 'shaker': g.add(cyl(0.02, 0.02, 0.06, mat('#ffffff'), 0, -0.05, 0, 10)); break;
    case 'pizzaPeel': g.add(cyl(0.008, 0.008, 0.2, wood, 0, -0.1, 0.08, 6)); g.add(box(0.12, 0.006, 0.12, wood, 0, -0.03, 0.2)); break;
    default: break;
  }
  TOOL_CACHE.set(kind, g);
  return g.clone();
}

// ------------------------------------------------------------------ animation

// pose: {walk: phase 0..1 or -1, work: {tool, mode, a, b} | null, carry: bool, t}
export function poseCook(fig, pose, dt) {
  const U = fig.userData;
  const t = pose.t || 0;
  const walking = pose.walk >= 0;
  const ph = walking ? pose.walk * Math.PI * 2 : 0;
  U.body.position.y = walking ? Math.abs(Math.sin(ph)) * 0.025 : Math.sin(t * 2.2) * 0.003;
  U.legs[0].rotation.x = walking ? Math.sin(ph) * 0.6 : 0;
  U.legs[1].rotation.x = walking ? -Math.sin(ph) * 0.6 : 0;
  const [L, R] = U.arms;
  const work = pose.work;
  let lx = 0, lz = 0.12, rx = 0, rz = -0.12;
  if (walking && !pose.carry) { lx = -Math.sin(ph) * 0.6; rx = Math.sin(ph) * 0.6; }
  if (pose.carry) { lx = rx = -1.1; lz = -0.25; rz = 0.25; }
  if (work) {
    const a = Math.max(0, Math.min(1, work.a ?? 0.5)), b = Math.max(-1, Math.min(1, work.b ?? 0));
    switch (work.mode) {
      case 'chop': lx = -1.2; lz = -0.35; rx = -0.6 - a * 1.4; rz = -0.1; break;
      case 'circle': { const ang = work.b ?? t * 4; lx = -1.0; lz = -0.3; rx = -1.15 + Math.sin(ang) * 0.25; rz = -0.1 + Math.cos(ang) * 0.3; break; }
      case 'scrub': lx = rx = -1.2; lz = -0.35 + b * 0.3; rz = 0.35 + b * 0.3; break;
      case 'stroke': lx = rx = -1.0 - a * 0.5; lz = -0.3 + b * 0.15; rz = 0.3 + b * 0.15; break;
      case 'pour': lx = -1.0; lz = -0.3; rx = -1.4 - a * 0.3; rz = 0.1; break;
      default: lx = rx = -1.1; lz = -0.25; rz = 0.25; break;
    }
  }
  const k = 1 - Math.exp(-dt * 18);
  L.rotation.x += (lx - L.rotation.x) * k; L.rotation.z += (lz - L.rotation.z) * k;
  R.rotation.x += (rx - R.rotation.x) * k; R.rotation.z += (rz - R.rotation.z) * k;
  U.head.rotation.x = work ? 0.25 : 0;
  // tool in hand
  const tk = (work && work.tool) || '';
  if (tk !== U.toolKind) {
    U.toolKind = tk;
    U.tool.clear();
    if (tk && tk !== 'hand' && tk !== 'grab') U.tool.add(toolMesh(tk));
  }
  U.carry.visible = !!pose.carry;
}
