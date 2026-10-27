// The kitchen as a lit 3D diorama (as in Detective Achille): a wooden plinth,
// the floor, two tall back walls (tiles up to the cupboards, the cuisine's
// plaster or paper above, a window) and two low front walls so the camera
// sees in, the fixtures, tidy upper cupboards and hoods, lamps and the
// cuisine's decorations. Static parts are baked into a few meshes; moving
// parts (flames, water, oven glow, bin lids, doors) stay separate in `dyn`.
//
// Grid square (gx, gy) is the world square x∈[gx, gx+1], z∈[gy, gy+1]; y is up.
import * as THREE from 'three';
import { FIXTURES, BAYS, glassDoor, wallUnits, counterDecor as decorOf } from '../shared/kitchens.js';
import { themeOf, floorTexture, splashTexture, wallTexture, topTexture, rugTexture, clothTexture, woodTexture } from './theme.js';
import { mat, M, C, box, rbox, cyl, lathe, ball, ring, rod, v3, bake } from './parts3d.js';
import { chefKnifeMesh, peelerMesh, graterMesh, crockMesh } from './props3d.js';
import { containerNest } from './food3d.js';

export const COUNTER_H = 0.46;
const SINK_DEPTH = 0.1;
export const WALL_H = 1.6;
const CAB_Y0 = 0.98, CAB_Y1 = 1.4, CAB_D = 0.38;
const FRONT_H = 0.12;
const WT = 0.07;

// Plane whose texture repeats once per `perU` × `perV` world units.
function texPlane(w, h, m, perU = 1, perV = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / perU, uv.getY(i) * h / perV);
  return new THREE.Mesh(g, m);
}

export function buildKitchen3D(K) {
  const T = themeOf(K.cuisine);
  const root = new THREE.Group();
  const stat = new THREE.Group(); // baked
  const dyn = new THREE.Group();  // moving / switching parts
  root.add(dyn);
  const fx = {};                  // fixture id -> { anchors, parts }
  const glows = [];               // static lights: {pos, color, power, reach}
  const W = K.w, H = K.h;

  // ------------------------------------------------------------------ plinth, floor, rug
  const plinthTex = woodTexture('#5a3a24');
  stat.add(box(W + 0.5, 0.26, H + 0.5, mat('#5a3a24', { rough: 0.55, map: plinthTex }), W / 2, -0.26, H / 2));
  stat.add(box(W + 0.56, 0.035, H + 0.56, mat(C.gold, { metal: 0.7, rough: 0.35 }), W / 2, -0.045, H / 2));
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(T), roughness: T.floor === 'checker' || T.floor === 'rangoli' ? 0.45 : 0.8 });
  const floor = texPlane(W, H, floorMat, 1, 1);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0.001, H / 2);
  floor.receiveShadow = true;
  root.add(floor);
  if (T.rug !== 'none') {
    const rw = Math.min(3.2, W * 0.42), rh = Math.min(2, H * 0.32);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(rw, rh), new THREE.MeshStandardMaterial({ map: rugTexture(T), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(W * 0.6, 0.004, H * 0.66);
    rug.receiveShadow = true;
    root.add(rug);
  }

  // ------------------------------------------------------------------ walls
  const splashMat = new THREE.MeshStandardMaterial({ map: splashTexture(T), roughness: 0.35 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(T), roughness: 0.92 });
  const outerMat = mat(T.wallB, { rough: 0.9 });
  const trimMat = mat(T.trim, { rough: 0.6 });
  // the window on the back (z = 0) wall
  const wx = Math.max(1, Math.floor(W / 2)), ww = Math.min(2, W - 2) || 1;
  const WIN = { x0: wx + 0.08, x1: wx + ww - 0.08, y0: 0.66, y1: 1.36 };
  const backWall = (len, horizontal) => {
    // a thick slab: tiles below CAB_Y0, plaster above, an outer skin
    const g = new THREE.Group();
    const lower = texPlane(len, CAB_Y0, splashMat, 1, 1); lower.position.set(len / 2, CAB_Y0 / 2, 0.001);
    const upper = texPlane(len, WALL_H - CAB_Y0, wallMat, 1.2, 1.2); upper.position.set(len / 2, CAB_Y0 + (WALL_H - CAB_Y0) / 2, 0.001);
    g.add(lower, upper);
    g.add(box(len + WT, WALL_H, WT, outerMat, len / 2 - WT / 2, 0, -WT / 2 - 0.001));
    g.add(box(len + WT, 0.05, WT + 0.06, trimMat, len / 2 - WT / 2, WALL_H, -WT / 2 + 0.02)); // crown
    g.add(box(len, 0.03, 0.025, trimMat, len / 2, CAB_Y0 - 0.015, 0.012)); // dado rail
    g.add(box(len, 0.08, 0.02, trimMat, len / 2, 0, 0.01)); // skirting
    void horizontal;
    return g;
  };
  const north = backWall(W, true);
  stat.add(north);
  const west = backWall(H, false);
  west.rotation.y = Math.PI / 2; // runs along +z, facing +x
  west.position.set(0, 0, H);
  stat.add(west);
  // corner post and low front walls
  stat.add(box(WT * 1.4, WALL_H + 0.05, WT * 1.4, trimMat, -WT / 2, 0, -WT / 2));
  stat.add(box(W + WT, FRONT_H, WT, outerMat, W / 2, 0, H + WT / 2));
  stat.add(box(WT, FRONT_H, H + WT, outerMat, W + WT / 2, 0, H / 2));
  stat.add(box(W + WT * 2, 0.02, WT + 0.02, trimMat, W / 2, FRONT_H, H + WT / 2));
  stat.add(box(WT + 0.02, 0.02, H + WT * 2, trimMat, W + WT / 2, FRONT_H, H / 2));
  buildWindow(stat, dyn, T, WIN, glows);

  // ------------------------------------------------------------------ fixtures
  const ctx = { T, stat, dyn, glows };
  const cdecor = decorOf(K);
  const blockedN = new Set(), blockedW = new Set(); // wall squares with cupboards / tall things
  for (let x = Math.floor(WIN.x0); x < Math.ceil(WIN.x1); x++) blockedN.add(x);
  for (const f of K.fixtures) {
    const def = FIXTURES[f.type];
    const along = f.face === 'e' ? f.h : f.w; // length of the front
    const g = new THREE.Group();
    const d = { anchors: {}, parts: {} };
    switch (f.type) {
      case 'counter': counter(g, ctx, along, d, true); break;
      case 'dishwasher': dishwasher(g, ctx, along, d); break;
      case 'table': table(g, ctx, d); break;
      case 'sink': sink(g, ctx, d); break;
      case 'stove': stove(g, ctx, d, def.slots); break;
      case 'oven': oven(g, ctx, d); break;
      case 'fridge': fridge(g, ctx, d); break;
      case 'shelf': pantry(g, ctx, d); break;
      case 'plant': plant(g); break;
      case 'binS': case 'binM': case 'binL': bin(g, ctx, d, f.type); break;
      case 'pizzaOven': case 'stoneOven': dome(g, ctx, d, f.type); break;
      case 'tandoor': tandoor(g, ctx, d); break;
      case 'paellaBurner': paellaBurner(g, ctx, d); break;
      case 'aga': aga(g, ctx, d); break;
      case 'piano': piano(g, ctx, d); break;
      default: break;
    }
    if (cdecor[f.id] != null) counterDecor(g, ctx, d, cdecor[f.id]);
    // a board's own tools – when they aren't in someone's hand: the knife and the peeler lying
    // flat at its front left, the box grater standing at its back left
    if (d.anchors.board) {
      const b = d.anchors.board, up = v3(0, 1, 0);
      const flat = (o, dir, along) => { const a = dir.clone().normalize(); o.quaternion.setFromRotationMatrix(along === 'x' ? new THREE.Matrix4().makeBasis(a, new THREE.Vector3().crossVectors(up, a), up) : new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(a, up), a, up)); };
      const knife = chefKnifeMesh(), peeler = peelerMesh(), grater = graterMesh();
      knife.position.set(b.x - 0.12, b.y + 0.007, b.z + 0.125);
      flat(knife, v3(-0.35, 0, -1), 'x');
      peeler.position.set(b.x - 0.035, b.y + 0.0065, b.z + 0.145);
      flat(peeler, v3(0.25, 0, 1), 'y'); // (its handle toward me)
      grater.position.set(b.x - 0.2, b.y + 0.115, b.z - 0.11);
      d.parts.tools = { knife, peeler, grater };
      for (const o of [knife, peeler, grater]) { o.userData.live = true; g.add(o); } // (shown and hidden: not baked in)
      d.anchors.boardTools = [knife.position.clone(), peeler.position.clone(), grater.position.clone()]; // (where each lies: the board's place – shared/stock.js)
      // and a stack of empty food containers on the worktop beside it (an empty one's taken from it
      // for what's been cut or portioned out)
      const nest = containerNest();
      nest.position.set(b.x + 0.39, b.y - (d.anchors.top ? b.y - d.anchors.top.y : 0.025), b.z - 0.06);
      g.add(nest);
      d.anchors.nest = nest.position.clone();
    }
    // place: local front is +z; face 'e' fronts turn to +x
    const cx = f.x + f.w / 2, cz = f.y + f.h / 2;
    g.position.set(cx, 0, cz);
    if (f.face === 'e') g.rotation.y = Math.PI / 2;
    const live = liveOut(g);
    stat.add(g);
    // anchors to world space
    const toWorld = (v) => v.clone().applyMatrix4(g.matrixWorld);
    const A = {};
    for (const [k, v] of Object.entries(d.anchors)) A[k] = Array.isArray(v) ? v.map(toWorld) : toWorld(v);
    // (src, live: its own meshes, kept for the glow on what's next – the bake only copies them)
    fx[f.id] = { anchors: A, parts: d.parts, f, src: g, live, front: f.face === 'e' ? v3(1, 0, 0) : v3(0, 0, 1), bays: baysOut(d.bays, g) };
    // what's on the back walls above it
    const tall = ['fridge', 'shelf', 'pizzaOven', 'stoneOven', 'tandoor', 'aga', 'piano', 'paellaBurner'].includes(f.type);
    if (f.y === 0 && f.x > 0) for (let x = f.x; x < f.x + f.w; x++) { if (tall) blockedN.add(x); }
    if (f.x === 0 && f.y > 0) for (let y = f.y; y < f.y + f.h; y++) { if (tall) blockedW.add(y); }
  }
  // the corner square
  blockedN.add(0); blockedW.add(0);

  // ------------------------------------------------------------------ upper cupboards & hoods
  // (where they go: shared/kitchens.js wallUnits – the cupboards are bays too)
  const walls = K.walls || wallUnits(K);
  for (const f of K.fixtures) {
    if (!walls[f.id]) continue;
    const onN = f.y === 0 && f.x > 0;
    const g = new THREE.Group();
    const d = { bays: {} };
    if (walls[f.id] === 'hood') hood(g, ctx);
    else cupboard(g, ctx, f, d);
    g.position.set(f.x + f.w / 2, 0, f.y + f.h / 2);
    if (!onN) g.rotation.y = Math.PI / 2;
    // sit against the wall: local z = -0.5 is the wall
    liveOut(g);
    stat.add(g);
    if (fx[f.id]) Object.assign(fx[f.id].bays, baysOut(d.bays, g));
    for (let k = onN ? f.x : f.y; k < (onN ? f.x + f.w : f.y + f.h); k++) (onN ? blockedN : blockedW).add(k);
  }

  // ------------------------------------------------------------------ lamps & decorations on the free wall squares
  const spots = [];
  for (let x = 1; x < W; x++) if (!blockedN.has(x)) spots.push({ wall: 'N', at: x + 0.5 });
  for (let y = 1; y < H; y++) if (!blockedW.has(y)) spots.push({ wall: 'W', at: y + 0.5 });
  // lamps either side of the window first, then spread out
  const lampSpots = [];
  const near = (s) => s.wall === 'N' ? Math.abs(s.at - (WIN.x0 + WIN.x1) / 2) : 99;
  spots.sort((a, b) => near(a) - near(b));
  const nLamps = Math.min(spots.length, Math.max(2, Math.round((W + H) / 5)));
  for (let i = 0; i < nLamps; i++) lampSpots.push(spots.shift());
  for (const s of lampSpots) {
    const g = new THREE.Group();
    wallLamp(g, ctx);
    placeOnWall(g, s);
    stat.add(g);
  }
  // window-side lamps light the room even where the wall is full
  const decor = T.decor;
  spots.forEach((s, i) => {
    const g = new THREE.Group();
    wallDecor(g, ctx, decor[i % decor.length], i);
    placeOnWall(g, s);
    stat.add(g);
  });
  // a hanging string across the window (bunting, marigolds, garlic …)
  const hang = new THREE.Group();
  hangingString(hang, ctx, WIN);
  stat.add(hang);

  // ------------------------------------------------------------------ bake
  root.add(bake(stat));
  return { root, dyn, fx, glows, window: WIN, theme: T };

  // (a group placed in the room: its moving parts (marked live) out into dyn, in place)
  function liveOut(g) {
    g.updateMatrixWorld(true);
    const out = [];
    g.traverse((o) => { if (o.userData.live) out.push(o); });
    for (const o of out) {
      const wm = o.matrixWorld.clone();
      o.removeFromParent();
      wm.decompose(o.position, o.quaternion, o.scale);
      dyn.add(o);
    }
    return out;
  }
  // (bays, placed: a door's spots to world space – a drawer's stay its own, they come out with it;
  // the pose it's at shut)
  function baysOut(bays, g) {
    const out = {};
    for (const [k, b] of Object.entries(bays || {})) {
      out[k] = { ...b, spots: b.local ? b.spots : b.spots.map((lv) => lv.map((p) => p.clone().applyMatrix4(g.matrixWorld))), base: { pos: b.obj.position.clone(), rotY: b.obj.rotation.y }, out: new THREE.Vector3(0, 0, 1).transformDirection(g.matrixWorld), frame: g.matrixWorld.clone() };
      b.obj.userData.bay = k;
    }
    return out;
  }

  function placeOnWall(g, s) {
    if (s.wall === 'N') g.position.set(s.at, 0, 0);
    else { g.position.set(0, 0, s.at); g.rotation.y = Math.PI / 2; }
  }
}

// ======================================================================= fixture models
// Local frame: origin at the centre of the footprint on the floor, front +z,
// the wall (for wall fixtures) at z = -0.5.

const live = (o) => { o.userData.live = true; return o; };
function handleMat(T) { return T.handle === 'iron' ? M.iron() : M.brass(); }

// The cupboard under a worktop. Hollow where it opens (you see in when it's
// open): its doors hinged at their outer edges, the drawer over them sliding
// out. Each that opens is a bay (d.bays, see shared/kitchens.js BAYS): what
// moves (obj: a door's hinge, the drawer), how (sign: which way the door swings;
// slide: how far the drawer comes out), its front (for a hand to find, obj
// space), its handle (obj space) and where things go in it (spots[level][slot]:
// the cupboard's in fixture space, the drawer's in its own – they come out with it).
const INNER = '#ecdfc6'; // (the inside of the cupboards: light birch)
function carcass(g, ctx, w, d, { doors = 2, drawer = true, depth = 0.9, top = COUNTER_H - 0.04, drawerBay = true, slots = 2 } = {}) {
  const { T } = ctx;
  const cab = mat(T.cabinet, { rough: 0.55 });
  const cab2 = mat(T.cabinet2, { rough: 0.6 });
  const inner = mat(INNER, { rough: 0.75 });
  const h = handleMat(T);
  d.bays = d.bays || {};
  g.add(box(w - 0.06, 0.05, depth - 0.1, mat('#2a2220', { rough: 0.8 }), 0, 0, -0.05)); // kick
  const fz = depth / 2 - 0.02 + 0.012, back = -0.02 - depth / 2;
  const shelfY = drawer ? COUNTER_H - 0.15 : top; // (the cupboard's ceiling: under the drawer)
  if (!doors && !drawer) g.add(box(w - 0.02, top - 0.05, depth, cab2, 0, 0.05, -0.02));
  else {
    // a hollow box: bottom, back, sides – birch inside – and the floor of the drawer's space
    g.add(box(w - 0.02, 0.02, depth, cab2, 0, 0.05, -0.02));
    g.add(box(w - 0.06, 0.004, depth - 0.04, inner, 0, 0.07, -0.04));
    g.add(box(w - 0.02, top - 0.05, 0.02, cab2, 0, 0.05, back + 0.01));
    g.add(box(w - 0.06, top - 0.07, 0.004, inner, 0, 0.07, back + 0.022));
    for (const sx of [-1, 1]) {
      g.add(box(0.02, top - 0.05, depth, cab2, sx * (w / 2 - 0.02), 0.05, -0.02));
      g.add(box(0.004, top - 0.07, depth - 0.04, inner, sx * (w / 2 - 0.032), 0.07, -0.04));
    }
    if (drawer) g.add(box(w - 0.04, 0.02, depth - 0.02, inner, 0, shelfY - 0.02, -0.03));
    if (doors === 2) g.add(box(0.02, shelfY - 0.09, depth - 0.06, inner, 0, 0.07, -0.05)); // (between the doors)
    if (!drawer) g.add(box(w - 0.04, 0.02, depth - 0.02, inner, 0, top - 0.02, -0.03)); // (its ceiling)
    g.add(box(w - 0.02, 0.025, 0.03, cab2, 0, shelfY - 0.025, fz - 0.03)); // (the rail over the doors)
  }
  // (cut down under a sink: panels round the sides close it up to the worktop)
  if (top < COUNTER_H - 0.04) {
    const ph = COUNTER_H - 0.04 - top;
    for (const [pw, pd, x, z] of [[w - 0.02, 0.02, 0, depth / 2 - 0.03], [w - 0.02, 0.02, 0, -depth / 2 - 0.01], [0.02, depth, -(w - 0.02) / 2 + 0.01, -0.02], [0.02, depth, (w - 0.02) / 2 - 0.01, -0.02]]) g.add(box(pw, ph, pd, cab2, x, top, z));
  }
  if (drawer) {
    // the drawer: its front and handle, a birch tray behind them (out of sight till it's pulled out)
    const bay = drawerBay;
    const dr = bay ? live(new THREE.Group()) : g;
    const y0 = COUNTER_H - 0.13, dd = 0.4;
    dr.add(rbox(w - 0.08, 0.075, 0.024, cab, 0, y0, fz, 0.008));
    dr.add(rod(v3(-0.08, COUNTER_H - 0.093, fz + 0.025), v3(0.08, COUNTER_H - 0.093, fz + 0.025), 0.008, h));
    if (bay) {
      dr.add(box(w - 0.12, 0.006, dd, inner, 0, y0 + 0.006, fz - 0.012 - dd / 2));
      for (const sx of [-1, 1]) dr.add(box(0.008, 0.055, dd, inner, sx * (w / 2 - 0.064), y0 + 0.006, fz - 0.012 - dd / 2));
      dr.add(box(w - 0.12, 0.055, 0.008, inner, 0, y0 + 0.006, fz - 0.012 - dd));
      const n = BAYS.dr.slots, span = w - 0.2;
      // (a cutlery insert: low dividers between the places)
      for (let i = 0; i < n - 1; i++) dr.add(box(0.005, 0.022, dd - 0.05, inner, -span / 2 + ((i + 0.5) * span) / (n - 1), y0 + 0.012, fz - 0.012 - dd / 2));
      g.add(dr);
      d.bays.dr = {
        kind: 'drawer', obj: dr, slide: 0.31, local: true,
        front: { x: 0, y: y0 + 0.0375, z: fz, w: w - 0.08, h: 0.075, d: 0.04 },
        inner: { x: 0, y: y0 + 0.035, z: fz - 0.012 - dd / 2, w: w - 0.12, h: 0.06, d: dd },
        handle: v3(0, COUNTER_H - 0.093, fz + 0.025),
        spots: [Array.from({ length: n }, (_, i) => v3(-span / 2 + (i * span) / (n - 1), y0 + 0.012, fz - 0.012 - dd / 2 + 0.02))],
      };
    }
  }
  const dh = drawer ? COUNTER_H - 0.22 : COUNTER_H - 0.13;
  for (let i = 0; i < doors; i++) {
    const dw = (w - 0.06) / doors - 0.02;
    const x = -w / 2 + 0.04 + dw / 2 + i * (dw + 0.02);
    // hinged at its outer edge (one door alone: on the left), the knob by the other
    const sign = doors === 2 && i === 1 ? 1 : -1, hx = x + sign * dw / 2;
    const hinge = live(new THREE.Group());
    hinge.position.set(hx, 0, fz);
    hinge.add(rbox(dw, dh, 0.024, cab, x - hx, 0.065, 0, 0.008));
    hinge.add(rbox(dw - 0.08, dh - 0.08, 0.008, cab2, x - hx, 0.105, 0.012, 0.004)); // a raised panel
    const kx = x - sign * (dw / 2 - 0.05) - hx;
    hinge.add(ball(0.014, h, kx, 0.065 + dh * 0.7, 0.03));
    g.add(hinge);
    const n = doors === 1 ? slots + 1 : slots;
    d.bays[`c${i}`] = {
      kind: 'door', obj: hinge, sign,
      front: { x: x - hx, y: 0.065 + dh / 2, z: 0, w: dw, h: dh, d: 0.04 },
      inner: { x, y: (0.07 + shelfY) / 2, z: -0.03, w: dw, h: shelfY - 0.07, d: depth - 0.06 }, // (fixture space)
      handle: v3(kx, 0.065 + dh * 0.7, 0.03),
      spots: [Array.from({ length: n }, (_, j) => v3(x + (j - (n - 1) / 2) * (dw / n), 0.074, depth / 2 - 0.2))], // (toward the front: seen over the worktop's edge)
    };
  }
}

function worktop(g, ctx, w, depth = 0.96, y = COUNTER_H - 0.04) {
  g.add(box(w, 0.04, depth, mat(ctx.T.topA, { rough: ctx.T.top === 'marble' ? 0.25 : 0.6, map: topTexture(ctx.T) }), 0, y, 0));
}

// A counter with the dishwasher built in under it: a steel front instead of the
// cupboard doors – a handle, a control strip with its lights and the start button
function dishwasher(g, ctx, w, d) {
  counter(g, ctx, w, d, true, false);
  const steel = M.steel(), fz = 0.45 - 0.02 + 0.012;
  g.add(rbox(w - 0.06, COUNTER_H - 0.1, 0.03, steel, 0, 0.055, fz, 0.01));
  g.add(box(w - 0.08, 0.06, 0.012, mat('#3a3f46', { metal: 0.4, rough: 0.4 }), 0, COUNTER_H - 0.11, fz + 0.018)); // the control strip
  g.add(rod(v3(-(w - 0.2) / 2, COUNTER_H - 0.17, fz + 0.04), v3((w - 0.2) / 2, COUNTER_H - 0.17, fz + 0.04), 0.009, M.steel()));
  for (let i = 0; i < 3; i++) g.add(ball(0.006, mat('#7a808a', { rough: 0.3 }), -0.3 + i * 0.05, COUNTER_H - 0.08, fz + 0.026));
  const light = live(ball(0.008, mat('#5ad86a', { emissive: '#3ad84a', ei: 2, rough: 0.3 }), -0.35, COUNTER_H - 0.08, fz + 0.026));
  light.visible = false;
  g.add(light);
  d.parts.dwLight = light;
  const btn = live(cyl(0.016, 0.016, 0.01, mat('#3a7ac0', { rough: 0.35 }), 0.3, COUNTER_H - 0.08, fz + 0.022, 14));
  btn.rotation.x = Math.PI / 2;
  btn.material = btn.material.clone(); // (its own: it turns green while it runs)
  g.add(btn);
  d.parts.dwButton = btn;
  d.anchors.rack = v3(0, 0.42, fz + 0.12); // (in front of its door: where things go in)
}

function counter(g, ctx, w, d, withBoard, doors = true) {
  if (doors) carcass(g, ctx, w, d);
  else carcass(g, ctx, w, d, { doors: 0, drawer: false });
  worktop(g, ctx, w);
  if (withBoard) {
    // (towards the front: in first person it's within a hand's reach)
    g.add(rbox(0.52, 0.024, 0.36, mat('#c9955a', { rough: 0.65 }), 0, COUNTER_H, 0.2, 0.01));
    d.anchors.board = v3(0, COUNTER_H + 0.025, 0.2);
    // after knife work: juice stains and crumbs on it (and suds while it's scrubbed)
    const stains = live(new THREE.Group());
    stains.position.set(0, COUNTER_H + 0.0255, 0.2);
    const dirt = [mat('#8a5a32', { rough: 0.9, opacity: 0.6 }), mat('#b8402a', { rough: 0.7, opacity: 0.55 })];
    for (let i = 0; i < 9; i++) {
      const r = 0.012 + ((i * 37) % 10) * 0.0025, m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), dirt[i % 3 ? 0 : 1]);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(1, 0.6 + ((i * 13) % 5) * 0.12, 1);
      m.position.set(((i * 53) % 9 - 4) * 0.05, 0.0004 * i, ((i * 29) % 7 - 3) * 0.04);
      m.userData.dirt = true;
      stains.add(m);
    }
    const suds = mat('#ffffff', { rough: 0.3, opacity: 0.85 });
    for (let i = 0; i < 7; i++) { const b = ball(0.012 + (i % 3) * 0.006, suds, ((i * 41) % 9 - 4) * 0.045, 0.004, ((i * 17) % 7 - 3) * 0.035, 1, 0.45, 1, 8); b.userData.suds = true; stains.add(b); }
    stains.visible = false;
    g.add(stains);
    d.parts.stains = stains;
  }
  d.anchors.top = v3(0, COUNTER_H, 0.1);
  d.anchors.spots = [v3(-0.3, COUNTER_H, -0.22), v3(0.3, COUNTER_H, -0.22), v3(-0.3, COUNTER_H, 0.3), v3(0.32, COUNTER_H, 0.3)];
  d.anchors.scraps = v3(-0.32, COUNTER_H, 0.3);
}

function table(g, ctx, d) {
  const wood = mat(ctx.T.top === 'wood' ? ctx.T.topB : '#9a6a40', { rough: 0.6 });
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]]) g.add(cyl(0.035, 0.03, 0.36, wood, x, 0, z, 10));
  g.add(rbox(0.98, 0.05, 0.98, wood, 0, 0.36, 0, 0.02));
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.006, 0.86), new THREE.MeshStandardMaterial({ map: clothTexture(ctx.T.ui.accent), roughness: 0.95 }));
  cloth.position.set(0, 0.413, 0);
  g.add(cloth);
  d.anchors.top = v3(0, 0.416, 0);
  d.anchors.board = v3(0, 0.416, 0);
  d.anchors.spots = [v3(-0.25, 0.416, -0.25), v3(0.25, 0.416, -0.25), v3(-0.25, 0.416, 0.25), v3(0.25, 0.416, 0.25)];
  d.anchors.scraps = v3(0.3, 0.416, 0.3);
}

function sink(g, ctx, d) {
  carcass(g, ctx, 1, d, { drawer: false, top: COUNTER_H - SINK_DEPTH - 0.012 }); // (room under the worktop for the basin)
  // worktop around the basin
  const top = mat(ctx.T.topA, { rough: 0.3, map: topTexture(ctx.T) });
  const y = COUNTER_H - 0.04;
  g.add(box(1, 0.04, 0.2, top, 0, y, -0.38));
  g.add(box(1, 0.04, 0.2, top, 0, y, 0.38));
  g.add(box(0.18, 0.04, 0.56, top, -0.41, y, 0));
  g.add(box(0.18, 0.04, 0.56, top, 0.41, y, 0));
  // the basin: a hole in the worktop – a steel rim round it, walls going down, a drain in the bottom
  const steel = M.steel(), inside = mat('#9aa4ac', { metal: 0.7, rough: 0.35 });
  const D = SINK_DEPTH, bot = COUNTER_H - D;
  for (const [w, dz, x, z] of [[0.64, 0.04, 0, -0.26], [0.64, 0.04, 0, 0.26], [0.04, 0.48, -0.3, 0], [0.04, 0.48, 0.3, 0]]) g.add(box(w, 0.012, dz, steel, x, COUNTER_H - 0.006, z)); // rim
  for (const [w, dz, x, z] of [[0.56, 0.01, 0, -0.235], [0.56, 0.01, 0, 0.235], [0.01, 0.46, -0.275, 0], [0.01, 0.46, 0.275, 0]]) g.add(box(w, D, dz, inside, x, bot, z)); // walls
  g.add(box(0.56, 0.01, 0.48, mat('#8a949c', { metal: 0.65, rough: 0.4 }), 0, bot - 0.01, 0)); // bottom
  g.add(cyl(0.025, 0.025, 0.004, mat('#3a3f46', { metal: 0.6 }), 0, bot + 0.001, 0.05, 12)); // drain
  // the tap: a swan neck from the back
  const tapMat = ctx.T.handle === 'brass' ? M.brass() : M.steel();
  g.add(cyl(0.03, 0.035, 0.05, tapMat, 0, COUNTER_H, -0.36, 12));
  const pts = [v3(0, COUNTER_H + 0.05, -0.36), v3(0, COUNTER_H + 0.3, -0.36), v3(0, COUNTER_H + 0.36, -0.28), v3(0, COUNTER_H + 0.33, -0.16), v3(0, COUNTER_H + 0.26, -0.12)];
  for (let i = 0; i < pts.length - 1; i++) g.add(rod(pts[i], pts[i + 1], 0.017, tapMat, 10));
  const lever = live(new THREE.Group());
  lever.position.set(0.05, COUNTER_H + 0.12, -0.36);
  lever.add(rod(v3(0, 0, 0), v3(0.1, 0.03, 0), 0.01, tapMat));
  lever.add(ball(0.02, mat(ctx.T.curtain, { rough: 0.4 }), 0.1, 0.03, 0));
  g.add(lever);
  d.parts.lever = lever;
  const water = live(cyl(0.012, 0.016, 0.26 + SINK_DEPTH, mat('#a9d6f2', { rough: 0.05, opacity: 0.7, emissive: '#6aaee0', ei: 0.25 }), 0, COUNTER_H - SINK_DEPTH, -0.12, 8));
  water.visible = false;
  g.add(water);
  d.parts.water = water;
  // washing up: the dish soap on the rim, the sponge beside it
  const soap = live(new THREE.Group());
  soap.position.set(0.41, COUNTER_H, -0.34);
  soap.add(cyl(0.026, 0.028, 0.12, mat('#4cbf5c', { rough: 0.25, opacity: 0.92 }), 0, 0, 0, 14));
  soap.add(cyl(0.012, 0.012, 0.02, mat('#f2f2f2', { rough: 0.4 }), 0, 0.12, 0, 10));
  soap.add(box(0.03, 0.008, 0.01, mat('#f2f2f2', { rough: 0.4 }), 0.01, 0.14, 0));
  g.add(soap);
  d.parts.soap = soap;
  const sponge = live(new THREE.Group());
  sponge.position.set(0.41, COUNTER_H, 0.12);
  sponge.add(box(0.09, 0.025, 0.06, mat('#f6d44a', { rough: 0.95 }), 0, 0, 0));
  sponge.add(box(0.09, 0.008, 0.06, mat('#3f9a46', { rough: 0.95 }), 0, 0.025, 0));
  g.add(sponge);
  d.parts.sponge = sponge;
  d.anchors.basin = v3(0, COUNTER_H - SINK_DEPTH, 0); // (its bottom)
  d.anchors.spout = v3(0, COUNTER_H + 0.24, -0.12); // where the water comes out
  d.anchors.top = v3(0, COUNTER_H, 0.1);
  d.anchors.spots = [v3(-0.3, COUNTER_H, 0.36), v3(0.3, COUNTER_H, 0.36)];
  d.anchors.scraps = v3(0.36, COUNTER_H, 0.36);
}

// A ring of little gas flames (shown when the burner is on).
function flameRing(r, n = 10, h = 0.05) {
  const g = live(new THREE.Group());
  const blue = mat('#5a8aff', { emissive: '#4a7aff', ei: 2.2, rough: 0.3, opacity: 0.85 });
  const tip = mat('#ffcc66', { emissive: '#ffb040', ei: 2.4, rough: 0.3, opacity: 0.9 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const f = cyl(0, 0.012, h, blue, Math.cos(a) * r, 0, Math.sin(a) * r, 6);
    f.userData.flame = i;
    g.add(f);
    g.add(cyl(0, 0.005, h * 0.5, tip, Math.cos(a) * r, h * 0.55, Math.sin(a) * r, 5));
  }
  g.visible = false;
  return g;
}

function burnerAt(g, x, z, y, r = 0.1) {
  g.add(ring(r, 0.012, mat('#5a5a62', { metal: 0.6, rough: 0.4 }), x, y + 0.012, z));
  g.add(cyl(r * 0.45, r * 0.5, 0.02, mat('#2a2a30', { metal: 0.5 }), x, y, z, 14));
  const grate = mat('#1a1a1e', { metal: 0.4, rough: 0.6 });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    g.add(rod(v3(x + Math.cos(a) * r * 0.5, y + 0.03, z + Math.sin(a) * r * 0.5), v3(x + Math.cos(a) * r * 1.35, y + 0.03, z + Math.sin(a) * r * 1.35), 0.008, grate));
  }
}

function stove(g, ctx, d, slots) {
  carcass(g, ctx, 1, d, { doors: 1, drawerBay: false }); // (the strip with the knobs: no drawer)
  g.add(box(1, 0.04, 0.96, mat('#26262c', { rough: 0.18, metal: 0.2 }), 0, COUNTER_H - 0.04, 0));
  const pos = slots >= 4 ? [[-0.24, -0.2], [0.24, -0.2], [-0.24, 0.2], [0.24, 0.2]] : [[-0.24, 0], [0.24, 0]];
  d.anchors.burners = [];
  d.parts.flames = [];
  d.parts.knobs = [];
  pos.slice(0, slots).forEach(([x, z], i) => {
    burnerAt(g, x, z, COUNTER_H);
    const fr = flameRing(0.085);
    fr.position.set(x, COUNTER_H + 0.012, z);
    g.add(fr);
    d.parts.flames.push(fr);
    d.anchors.burners.push(v3(x, COUNTER_H + 0.04, z));
    const kn = live(new THREE.Group());
    kn.position.set(-0.3 + i * (0.6 / Math.max(1, slots - 1)), COUNTER_H - 0.07, 0.505); // (out from the front, in sight)
    const k = cyl(0.027, 0.03, 0.028, mat('#f2efe6', { rough: 0.4 }), 0, 0, 0, 14);
    k.rotation.x = Math.PI / 2;
    kn.add(k);
    kn.add(box(0.006, 0.02, 0.006, mat('#e8573a'), 0, 0.005, 0.018));
    g.add(kn);
    d.parts.knobs.push(kn);
  });
  d.anchors.top = v3(0, COUNTER_H, 0);
  d.anchors.scraps = v3(0.4, COUNTER_H, 0.4);
}

function oven(g, ctx, d) {
  const { T } = ctx;
  // a hollow box: when the door's down you see in – the enamelled inside, its light, the wire rack
  const shell = mat('#3a3a42', { metal: 0.5, rough: 0.35 }), enamel = mat('#1e1c24', { rough: 0.55, emissive: '#2a1c14', ei: 0.4 });
  const H = COUNTER_H - 0.04, CY = 0.06, CH = 0.28, CW = 0.8, CD = 0.8; // (the inside: its bottom, height, width, depth)
  g.add(box(0.98, H, 0.06, shell, 0, 0, -0.44));
  for (const sx of [-1, 1]) g.add(box((0.98 - CW) / 2, H, 0.9, shell, sx * (CW / 2 + (0.98 - CW) / 4), 0, -0.02));
  g.add(box(CW, CY, 0.9, shell, 0, 0, -0.02));
  g.add(box(CW, H - CY - CH, 0.9, shell, 0, CY + CH, -0.02));
  g.add(box(CW - 0.01, CH, 0.01, enamel, 0, CY, 0.43 - CD)); // (its back)
  for (const sx of [-1, 1]) g.add(box(0.008, CH, CD, enamel, sx * (CW / 2 - 0.005), CY, 0.43 - CD / 2));
  g.add(box(CW - 0.01, 0.006, CD, enamel, 0, CY, 0.43 - CD / 2));
  g.add(box(CW - 0.01, 0.006, CD, enamel, 0, CY + CH - 0.006, 0.43 - CD / 2));
  g.add(box(0.05, 0.015, 0.012, mat('#fff4d0', { emissive: '#ffe8b0', ei: 1.4 }), -0.3, CY + CH - 0.022, 0.43 - CD + 0.012)); // (the light, at the back)
  // the wire rack, where things go in (the 'inside' anchor stands on it)
  const wire = M.steel();
  const ry = 0.16, rz0 = 0.43 - CD + 0.03, rz1 = 0.41;
  for (const sx of [-1, 1]) g.add(rod(v3(sx * 0.37, ry, rz0), v3(sx * 0.37, ry, rz1), 0.004, wire));
  for (const z of [rz0, rz1]) g.add(rod(v3(-0.37, ry, z), v3(0.37, ry, z), 0.004, wire));
  for (let i = 1; i < 14; i++) { const x = -0.37 + i * (0.74 / 14); g.add(rod(v3(x, ry, rz0), v3(x, ry, rz1), 0.0025, wire)); }
  // the door drops down on its bottom hinge (window, glow and handle go with it); the window is dark glass –
  // what's baking shows through it, lit orange while the oven's on
  const hinge = live(new THREE.Group());
  hinge.position.set(0, 0.05, 0.455);
  hinge.add(rbox(0.86, 0.06, 0.03, mat('#2a2a30', { metal: 0.4, rough: 0.3 }), 0, 0, -0.015, 0.01));
  hinge.add(rbox(0.86, 0.06, 0.03, mat('#2a2a30', { metal: 0.4, rough: 0.3 }), 0, 0.24, -0.015, 0.01));
  for (const sx of [-1, 1]) hinge.add(box(0.13, 0.18, 0.03, mat('#2a2a30', { metal: 0.4, rough: 0.3 }), sx * 0.365, 0.06, -0.015));
  const glow = rbox(0.6, 0.18, 0.012, new THREE.MeshStandardMaterial({ color: '#1a1a20', emissive: new THREE.Color('#ff7a2a'), emissiveIntensity: 0, roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false }), 0, 0.06, -0.012, 0.01);
  hinge.add(glow);
  hinge.add(rod(v3(-0.3, 0.28, 0.025), v3(0.3, 0.28, 0.025), 0.012, M.steel()));
  g.add(hinge);
  d.parts.glow = glow;
  d.parts.drop = hinge;
  g.add(box(0.86, 0.05, 0.02, mat('#1a1a20', { rough: 0.3 }), 0, 0.37, 0.45));
  for (const x of [-0.25, 0]) { const k = cyl(0.02, 0.022, 0.02, mat('#f2efe6'), x, 0.395, 0.47, 12); k.rotation.x = Math.PI / 2; g.add(k); }
  // the temperature knob, on the right: it turns (with a mark to show how far)
  const kn = live(new THREE.Group());
  kn.position.set(0.25, 0.395, 0.47);
  const kc = cyl(0.02, 0.022, 0.02, mat('#f2efe6'), 0, 0, 0, 12);
  kc.rotation.x = Math.PI / 2;
  kn.add(kc);
  kn.add(box(0.005, 0.016, 0.005, mat('#e8573a'), 0, 0.004, 0.012));
  g.add(kn);
  d.parts.knobs = [kn];
  worktop(g, ctx, 1);
  void T;
  d.anchors.inside = v3(0, ry + 0.004, 0.06);
  d.anchors.top = v3(0, COUNTER_H, 0);
  d.anchors.scraps = v3(0.36, COUNTER_H, 0.36);
}

function fridge(g, ctx, d) {
  const body = mat('#f4f1ea', { rough: 0.3 });
  const lining = mat('#eef6fa', { rough: 0.5, emissive: '#fffbe8', ei: 0.12 });
  const glass = mat('#dceef6', { rough: 0.1, opacity: 0.5 });
  // a hollow cabinet: when the door swings open you see what's kept inside
  g.add(box(0.86, 1.18, 0.04, body, 0, 0, -0.45));
  for (const sx of [-1, 1]) g.add(box(0.04, 1.18, 0.82, body, sx * 0.41, 0, -0.04));
  g.add(box(0.86, 0.06, 0.82, body, 0, 1.12, -0.04));
  g.add(box(0.86, 0.08, 0.82, body, 0, 0, -0.04));
  g.add(box(0.78, 1.04, 0.01, lining, 0, 0.08, -0.42));
  for (const sx of [-1, 1]) g.add(box(0.005, 1.04, 0.78, lining, sx * 0.385, 0.08, -0.04));
  for (const y of [0.33, 0.57, 0.81]) g.add(box(0.77, 0.012, 0.74, glass, 0, y, -0.05));
  g.add(box(0.06, 0.02, 0.02, mat('#fff8d0', { emissive: '#fff4c0', ei: 1.2 }), 0, 1.08, -0.3)); // the little light
  // the door: hinged on the left, it opens out into the room
  const hinge = live(new THREE.Group());
  hinge.position.set(-0.43, 0, 0.38);
  const door = new THREE.Group();
  door.position.x = 0.43;
  hinge.add(door);
  door.add(rbox(0.86, 1.17, 0.06, body, 0, 0.005, 0, 0.05));
  door.add(box(0.84, 0.01, 0.02, mat('#b8b4ac'), 0, 0.82, 0.03));
  door.add(rod(v3(0.34, 0.9, 0.05), v3(0.34, 1.08, 0.05), 0.014, M.steel()));
  door.add(rod(v3(0.34, 0.3, 0.05), v3(0.34, 0.72, 0.05), 0.014, M.steel()));
  for (const [x, y, c] of [[-0.2, 0.6, '#e8573a'], [0, 0.5, '#f2b21a'], [-0.1, 0.35, '#3faa5a'], [0.15, 0.62, '#2f8fd0']]) door.add(cyl(0.025, 0.025, 0.01, mat(c, { rough: 0.4 }), x, y, 0.03).rotateX(Math.PI / 2));
  door.add(box(0.12, 0.14, 0.004, mat('#fffbe0'), 0.12, 0.4, 0.031));
  // racks on the inside of the door
  for (const y of [0.25, 0.6]) door.add(box(0.7, 0.05, 0.08, lining, 0, y, -0.07));
  g.add(hinge);
  d.parts.door = hinge;
  d.parts.leaf = door;
  d.parts.handle = [v3(0.34, 0.32, 0.05), v3(0.34, 0.7, 0.05)]; // (door space) the long handle a hand takes
  // a fruit bowl on top
  g.add(lathe([[0, 0], [0.14, 0.02], [0.17, 0.08]], mat(ctx.T.tileB, { rough: 0.4, double: true }), 0, 1.18, -0.05));
  for (const [x, z, c] of [[-0.05, 0, '#e8432e'], [0.06, -0.06, '#f7d330'], [0.04, 0.06, '#f08a24']]) g.add(ball(0.05, mat(c, { rough: 0.5 }), x, 1.24, -0.05 + z));
  d.anchors.shelf = v3(0, 0.335, 0.06); // where a pot chills (the middle of the second shelf is kept for it)
  // where things are kept: four shelves (bottom to top), things spread along each
  d.anchors.shelfL = [0.085, 0.335, 0.575, 0.815].map((y) => v3(-0.32, y, 0.16));
  d.anchors.shelfR = [0.085, 0.335, 0.575, 0.815].map((y) => v3(0.32, y, 0.16));
}

function pantry(g, ctx, d) {
  const { T } = ctx;
  const wood = mat(T.trim, { rough: 0.6 });
  const back = mat(T.cabinet2, { rough: 0.7 });
  const Ht = 1.3;
  g.add(box(0.9, Ht, 0.04, back, 0, 0, -0.42));
  for (const sx of [-1, 1]) g.add(box(0.04, Ht, 0.86, wood, sx * 0.45, 0, -0.02));
  const shelves = [0.05, 0.38, 0.7, 1.02, Ht - 0.03];
  for (const y of shelves) g.add(box(0.9, 0.03, 0.86, wood, 0, y, -0.02));
  // at the back of the top shelf: the spice jars and oils every station reaches for (always there)
  const jarCols = ['#c0412d', '#e8601a', '#f2b21a', '#9ab86a', '#3a7ac0', '#8a5a3a'];
  for (let i = 0; i < 6; i++) {
    const x = -0.33 + i * 0.132;
    g.add(cyl(0.05, 0.05, 0.16, M.glass(), x, 1.05, -0.3, 12));
    g.add(cyl(0.045, 0.045, 0.1, mat(jarCols[i], { rough: 0.6 }), x, 1.055, -0.3, 12));
    g.add(cyl(0.052, 0.052, 0.025, mat(T.trim, { rough: 0.5 }), x, 1.21, -0.3, 12));
  }
  // a glass door over the three lower shelves: you see what's in there, and open it by its knob
  const hinge = live(new THREE.Group());
  hinge.position.set(-0.45, 0, 0.43);
  const door = new THREE.Group();
  door.position.x = 0.45;
  hinge.add(door);
  for (const [w, h, x, y] of [[0.9, 0.05, 0, 0.02], [0.9, 0.05, 0, 0.96], [0.05, 0.99, -0.425, 0.02], [0.05, 0.99, 0.425, 0.02], [0.8, 0.03, 0, 0.5]]) door.add(box(w, h, 0.03, wood, x, y, 0));
  door.add(box(0.8, 0.9, 0.006, mat('#dff0f8', { rough: 0.05, opacity: 0.22 }), 0, 0.06, 0));
  door.add(ball(0.025, M.brass(), 0.38, 0.5, 0.03));
  g.add(hinge);
  d.parts.door = hinge;
  d.parts.leaf = door;
  d.parts.handle = [v3(0.38, 0.47, 0.03), v3(0.38, 0.53, 0.03)]; // (door space) the knob
  // below: the pots, pans, bowls and plates, and the food that isn't kept cold – put away
  // on the three lower shelves, each in its own place near the front where you can see it
  d.anchors.shelfL = [0.085, 0.415, 0.735, 1.055].map((y) => v3(-0.38, y, 0.22));
  d.anchors.shelfR = [0.085, 0.415, 0.735, 1.055].map((y) => v3(0.38, y, 0.22));
}

function plant(g) {
  g.add(lathe([[0.1, 0], [0.16, 0.26], [0.18, 0.28], [0.16, 0.3]], mat(C.terracotta, { rough: 0.8 }), 0, 0, 0, 16));
  g.add(cyl(0.15, 0.15, 0.02, mat('#4a3020'), 0, 0.27, 0));
  const leaf = mat(C.leaf, { rough: 0.7 }), leaf2 = mat(C.leafDark, { rough: 0.7 });
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.08 + (i % 3) * 0.05;
    const l = ball(0.1, i % 2 ? leaf : leaf2, Math.cos(a) * r, 0.42 + (i % 4) * 0.1, Math.sin(a) * r, 0.5, 1.4, 0.2, 8);
    l.rotation.set(Math.cos(a) * 0.5, a, Math.sin(a) * 0.5);
    g.add(l);
  }
}

function bin(g, ctx, d, type) {
  const big = type === 'binL', mid = type === 'binM';
  const col = big ? '#2f6fae' : mid ? '#3f8a4a' : '#c9ccd2';
  const body = big || mid ? mat(col, { rough: 0.45 }) : M.steel();
  const hgt = big ? 0.66 : mid ? 0.54 : 0.36;
  const r = big ? 0.3 : mid ? 0.22 : 0.17;
  if (big) {
    g.add(rbox(0.62, hgt, 0.62, body, 0, 0.05, 0, 0.04));
    for (const sx of [-1, 1]) { const w = cyl(0.06, 0.06, 0.04, mat('#1a1a1e'), sx * 0.24, 0.0, -0.3, 12); w.rotation.z = Math.PI / 2; w.position.y = 0.06; g.add(w); }
  } else if (mid) {
    g.add(rbox(0.44, hgt, 0.44, body, 0, 0, 0, 0.06));
  } else {
    g.add(cyl(r, r * 0.92, hgt, body, 0, 0, 0, 20));
    g.add(box(0.12, 0.02, 0.08, mat('#2a2a30', { rough: 0.5 }), 0, 0.01, r + 0.02)); // pedal
  }
  const top = hgt + (big ? 0.05 : 0);
  // the lid on a hinge at the back
  const lid = live(new THREE.Group());
  lid.position.set(0, top, big ? -0.31 : -r);
  const lidMat = mat(big || mid ? shadeHex(col, 0.15) : '#d9dce2', { rough: 0.35, metal: big || mid ? 0 : 0.8 });
  if (big || mid) lid.add(rbox(big ? 0.64 : 0.46, 0.04, big ? 0.64 : 0.46, lidMat, 0, 0, big ? 0.31 : r, 0.02));
  else lid.add(lathe([[0, 0.05], [r * 0.6, 0.045], [r + 0.01, 0.01], [r + 0.01, 0]], lidMat, 0, 0, r, 20));
  g.add(lid);
  d.parts.lid = lid;
  // the bag bulging out as it fills
  const bag = live(ball(r * 0.9, mat('#3a3a46', { rough: 0.5 }), 0, top - 0.02, big ? 0 : 0, 1, 0.6, 1, 12));
  bag.visible = false;
  g.add(bag);
  d.parts.bag = bag;
  d.anchors.top = v3(0, top, 0);
}

function shadeHex(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt * 0.5)));
  return `#${c.getHexString()}`;
}

// The wood-fired pizza oven (Italian) or the taş fırın (Turkish), 2 squares long.
function dome(g, ctx, d, type) {
  const stone = type === 'stoneOven';
  const brick = mat(stone ? '#e9e2d6' : '#b8643e', { rough: 0.85 });
  const base = mat(stone ? '#2f6fae' : '#8a4a32', { rough: 0.8 });
  g.add(box(1.9, 0.5, 0.92, base, 0, 0, -0.02));
  g.add(box(1.96, 0.05, 0.98, mat(stone ? '#f4efe4' : '#d8c4a8', { rough: 0.7 }), 0, 0.5, -0.02));
  const domeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), brick);
  domeMesh.scale.set(1.25, 0.95, 0.72);
  domeMesh.position.set(0, 0.55, -0.08);
  g.add(domeMesh);
  if (stone) for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI; g.add(ball(0.035, mat('#2c5ea8', { rough: 0.4 }), Math.cos(a) * 0.72, 0.55 + Math.sin(a) * 0.45, 0.3, 1, 1, 0.4)); }
  // the arched mouth and the fire inside
  g.add(box(0.5, 0.3, 0.08, mat('#140a06', { rough: 1 }), 0, 0.55, 0.36));
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 20, 1, false, -Math.PI / 2, Math.PI), mat('#140a06', { rough: 1 }));
  arch.rotation.x = Math.PI / 2; arch.rotation.z = Math.PI / 2; arch.position.set(0, 0.85, 0.36);
  g.add(arch);
  g.add(rbox(0.62, 0.06, 0.1, mat(stone ? '#c9a24a' : '#d8c4a8'), 0, 0.52, 0.38, 0.02));
  const fire = live(new THREE.Group());
  const ember = mat('#ff6a1a', { emissive: '#ff5a10', ei: 3, rough: 0.4 });
  const flame = mat('#ffb627', { emissive: '#ffa020', ei: 2.8, rough: 0.4 });
  for (let i = 0; i < 7; i++) {
    const f = cyl(0, 0.05, 0.16 + (i % 3) * 0.06, i % 2 ? ember : flame, -0.24 + i * 0.08, 0.56, 0.05 - (i % 2) * 0.05, 6);
    f.userData.flame = i;
    fire.add(f);
  }
  for (let i = 0; i < 5; i++) fire.add(ball(0.04, ember, -0.2 + i * 0.1, 0.57, -0.08, 1.4, 0.5, 1));
  g.add(fire);
  d.parts.fire = fire;
  ctx.glows.push({ local: true, group: g, pos: v3(0, 0.75, 0.2), color: '#ff8a3a', power: 3.2, reach: 3.2, kind: 'fire' });
  // chimney and logs
  g.add(cyl(0.09, 0.11, 0.55, brick, 0, 1.05, -0.2, 12));
  g.add(cyl(0.12, 0.12, 0.04, mat('#3a3a42', { metal: 0.6 }), 0, 1.6, -0.2, 12));
  const log = mat('#7a4a2a', { rough: 0.9 });
  for (let i = 0; i < 5; i++) { const l = cyl(0.045, 0.045, 0.5, log, 0.75, 0.05 + Math.floor(i / 3) * 0.08, 0.15 + (i % 3) * 0.1, 8); l.rotation.x = Math.PI / 2; g.add(l); }
  d.anchors.mouth = v3(0, 0.58, 0.2);
  d.anchors.top = v3(0, 0.55, 0.3);
}

function tandoor(g, ctx, d) {
  // a worktop on one square, the clay oven on the other
  const prep = new THREE.Group();
  counter(prep, ctx, 1, { anchors: {}, parts: {} }, false);
  prep.position.x = 0.5;
  g.add(prep);
  const clay = mat('#c8784a', { rough: 0.9 });
  g.add(lathe([[0.3, 0], [0.36, 0.2], [0.34, 0.5], [0.24, 0.62], [0.17, 0.64], [0.17, 0.6]], clay, -0.5, 0, 0, 24));
  g.add(ring(0.17, 0.03, mat('#d8946a', { rough: 0.8 }), -0.5, 0.63, 0, 24));
  const coals = live(cyl(0.15, 0.15, 0.01, mat('#ff6a1a', { emissive: '#ff5a10', ei: 3, rough: 0.6 }), -0.5, 0.6, 0, 20));
  g.add(coals);
  d.parts.fire = coals;
  for (let i = 0; i < 4; i++) g.add(ring(0.34 - i * 0.01, 0.008, mat('#a85a32'), -0.5, 0.12 + i * 0.13, 0, 24));
  ctx.glows.push({ local: true, group: g, pos: v3(-0.5, 0.8, 0), color: '#ff7a2a', power: 2.4, reach: 2.6, kind: 'fire' });
  d.anchors.mouth = v3(-0.5, 0.66, 0);
  d.anchors.top = v3(0.5, COUNTER_H, 0.1);
  d.anchors.board = v3(0.5, COUNTER_H, 0.04);
}

function paellaBurner(g, ctx, d) {
  const prep = new THREE.Group();
  counter(prep, ctx, 1, { anchors: {}, parts: {} }, false);
  prep.position.x = -0.5;
  g.add(prep);
  const iron = M.iron();
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.4; g.add(rod(v3(0.5 + Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36), v3(0.5 + Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3), 0.014, iron)); }
  g.add(ring(0.3, 0.014, iron, 0.5, 0.3, 0, 28));
  g.add(ring(0.2, 0.012, mat('#5a5a62', { metal: 0.6 }), 0.5, 0.3, 0, 28));
  g.add(cyl(0.05, 0.05, 0.25, mat('#c0412d', { rough: 0.4 }), 0.85, 0, 0.3, 12)); // the gas bottle
  const fr = flameRing(0.22, 18, 0.07);
  fr.position.set(0.5, 0.31, 0);
  g.add(fr);
  d.parts.flames = [fr];
  d.anchors.burners = [v3(0.5, 0.34, 0)];
  d.anchors.top = v3(-0.5, COUNTER_H, 0.1);
}

function aga(g, ctx, d) {
  const cream = mat('#efe6d2', { rough: 0.22, metal: 0.05 });
  g.add(rbox(1.9, 0.6, 0.86, cream, 0, 0.04, -0.04, 0.04));
  g.add(box(1.86, 0.04, 0.06, mat('#2a2a30'), 0, 0, 0.36));
  g.add(rod(v3(-0.9, 0.5, 0.42), v3(0.9, 0.5, 0.42), 0.014, M.steel()));
  for (const x of [-0.6, -0.15, 0.25, 0.65]) {
    g.add(rbox(0.32, 0.18, 0.03, cream, x, 0.25, 0.4, 0.02));
    g.add(rod(v3(x - 0.08, 0.42, 0.43), v3(x + 0.08, 0.42, 0.43), 0.01, M.steel()));
  }
  // two hot plates with chrome lids
  d.anchors.burners = [];
  d.parts.flames = [];
  for (const x of [-0.45, 0.35]) {
    g.add(cyl(0.2, 0.2, 0.012, mat('#3a3a42', { metal: 0.5 }), x, 0.64, -0.04, 24));
    const fr = flameRing(0.16, 12, 0.03);
    fr.position.set(x, 0.65, -0.04);
    g.add(fr);
    d.parts.flames.push(fr);
    d.anchors.burners.push(v3(x, 0.68, -0.04));
    g.add(lathe([[0.2, 0], [0.18, 0.05], [0.1, 0.09], [0, 0.1]], M.steel(), x - 0.06, 0.64, -0.3, 20));
  }
  d.parts.glow = live(rbox(0.26, 0.1, 0.008, new THREE.MeshStandardMaterial({ color: '#1a1a20', emissive: new THREE.Color('#ff7a2a'), emissiveIntensity: 0 }), -0.6, 0.28, 0.42, 0.01));
  g.add(d.parts.glow);
  d.anchors.inside = v3(-0.6, 0.2, 0.1);
  d.anchors.top = v3(0, 0.64, 0);
}

function piano(g, ctx, d) {
  const enamel = mat(ctx.T.cabinet, { rough: 0.25, metal: 0.1 });
  g.add(rbox(1.9, 0.5, 0.88, enamel, 0, 0.04, -0.04, 0.03));
  g.add(box(1.92, 0.04, 0.92, M.steel(), 0, 0.54, -0.04));
  g.add(rod(v3(-0.9, 0.46, 0.46), v3(0.9, 0.46, 0.46), 0.014, M.brass()));
  for (const x of [-0.48, 0.48]) {
    g.add(rbox(0.8, 0.3, 0.025, mat(ctx.T.cabinet2, { rough: 0.3 }), x, 0.08, 0.41, 0.015));
    g.add(rbox(0.5, 0.14, 0.01, new THREE.MeshStandardMaterial({ color: '#1a1a20', emissive: new THREE.Color('#ff7a2a'), emissiveIntensity: 0, roughness: 0.15 }), x, 0.16, 0.43, 0.01));
  }
  d.parts.glow = live(rbox(0.5, 0.14, 0.012, new THREE.MeshStandardMaterial({ color: '#1a1a20', emissive: new THREE.Color('#ff7a2a'), emissiveIntensity: 0, roughness: 0.15 }), -0.48, 0.16, 0.435, 0.01));
  g.add(d.parts.glow);
  d.anchors.burners = [];
  d.parts.flames = [];
  for (const [x, z] of [[-0.66, -0.22], [-0.22, -0.22], [0.22, -0.22], [0.66, -0.22]]) {
    burnerAt(g, x, z, 0.58, 0.09);
    const fr = flameRing(0.075);
    fr.position.set(x, 0.59, z);
    g.add(fr);
    d.parts.flames.push(fr);
    d.anchors.burners.push(v3(x, 0.62, z));
  }
  d.anchors.inside = v3(-0.48, 0.2, 0.1);
  d.anchors.top = v3(0, 0.58, 0.2);
}

// ======================================================================= on the walls

// A wall cupboard: hollow, a shelf halfway up, two doors hinged at their outer
// edges – glass (what's in it shows) or painted – their knobs by the middle.
// Bays u0 / u1 (see carcass): spots[0] the upper shelf, spots[1] the lower.
function cupboard(g, ctx, f, d) {
  const { T } = ctx;
  const cab = mat(T.cabinet, { rough: 0.55 }), cab2 = mat(T.cabinet2, { rough: 0.6 }), inner = mat(INNER, { rough: 0.75 });
  const z0 = -0.5, H = CAB_Y1 - CAB_Y0, mid = z0 + CAB_D / 2;
  g.add(box(0.98, H, 0.02, cab2, 0, CAB_Y0, z0 + 0.01));
  g.add(box(0.94, H - 0.04, 0.004, inner, 0, CAB_Y0 + 0.02, z0 + 0.022));
  for (const sx of [-1, 1]) g.add(box(0.02, H, CAB_D, cab2, sx * 0.48, CAB_Y0, mid));
  g.add(box(0.98, 0.02, CAB_D, cab2, 0, CAB_Y0, mid));
  g.add(box(0.94, 0.004, CAB_D - 0.02, inner, 0, CAB_Y0 + 0.02, mid));
  g.add(box(0.94, 0.012, CAB_D - 0.04, inner, 0, CAB_Y0 + 0.2, mid - 0.01)); // the shelf
  g.add(box(0.016, H - 0.04, CAB_D - 0.03, inner, 0, CAB_Y0 + 0.02, mid - 0.005)); // (between the doors)
  g.add(box(1.0, 0.03, CAB_D + 0.03, cab, 0, CAB_Y1, mid + 0.01));
  const fz = z0 + CAB_D + 0.012;
  const hm = handleMat(T), glassM = mat('#dff0f6', { rough: 0.05, metal: 0.1, opacity: 0.28 });
  d.bays = d.bays || {};
  for (let i = 0; i < 2; i++) {
    const x = -0.24 + i * 0.48, sign = i ? 1 : -1, hx = x + sign * 0.23;
    const hinge = live(new THREE.Group());
    hinge.position.set(hx, 0, fz);
    const dh = H - 0.03, y0 = CAB_Y0 + 0.015;
    if (glassDoor(f, i)) {
      // a frame round a pane of glass
      for (const [w, hh, bx, by] of [[0.46, 0.05, 0, y0], [0.46, 0.05, 0, y0 + dh - 0.05], [0.05, dh, -0.205, y0], [0.05, dh, 0.205, y0]]) hinge.add(box(w, hh, 0.022, cab, x - hx + bx, by, 0));
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.36, dh - 0.1), glassM);
      pane.position.set(x - hx, y0 + dh / 2, 0.004);
      hinge.add(pane);
    } else {
      hinge.add(rbox(0.46, dh, 0.022, cab, x - hx, y0, 0, 0.008));
      hinge.add(rbox(0.36, dh - 0.09, 0.008, cab2, x - hx, y0 + 0.045, 0.012, 0.004));
    }
    const kx = x - sign * 0.18 - hx;
    hinge.add(ball(0.013, hm, kx, CAB_Y0 + 0.07, 0.025));
    g.add(hinge);
    const level = (y) => [-0.11, 0.11].map((dx) => v3(x + dx, y, mid + 0.02));
    d.bays[`u${i}`] = {
      kind: 'door', obj: hinge, sign, glass: glassDoor(f, i),
      front: { x: x - hx, y: y0 + dh / 2, z: 0, w: 0.46, h: dh, d: 0.04 },
      inner: { x, y: CAB_Y0 + H / 2, z: mid, w: 0.46, h: H, d: CAB_D }, // (fixture space)
      handle: v3(kx, CAB_Y0 + 0.07, 0.025),
      spots: [level(CAB_Y0 + 0.212), level(CAB_Y0 + 0.024)],
    };
  }
  // a warm light strip underneath
  g.add(box(0.9, 0.012, 0.03, mat('#fff4d0', { emissive: '#ffe2a0', ei: 1.2 }), 0, CAB_Y0 - 0.012, z0 + CAB_D - 0.04));
}

function hood(g, ctx) {
  const steel = ctx.T.handle === 'brass' && ctx.T.name === 'Turkish' ? M.copper() : M.steel();
  const z0 = -0.5;
  const pts = [[0.48, 0], [0.48, 0.06], [0.18, 0.3], [0.18, 0.32]];
  const hd = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 4), steel);
  hd.rotation.y = Math.PI / 4;
  hd.scale.set(1, 1, 0.55);
  hd.position.set(0, 1.0, z0 + 0.28);
  g.add(hd);
  g.add(box(0.3, WALL_H - 1.3, 0.2, steel, 0, 1.3, z0 + 0.12));
  g.add(box(0.9, 0.01, 0.4, mat('#fff4d0', { emissive: '#ffe2a0', ei: 0.9 }), 0, 0.995, z0 + 0.3));
}

function wallLamp(g, ctx) {
  const { T } = ctx;
  const y = 1.18, out = 0.16;
  const glowMat = (c, ei = 1.4) => mat(c, { emissive: c, ei, rough: 0.4 });
  g.add(rbox(0.06, 0.12, 0.02, handleMat(T), 0, y - 0.06, 0.01, 0.01));
  g.add(rod(v3(0, y, 0.02), v3(0, y, out), 0.009, handleMat(T)));
  switch (T.lamp) {
    case 'ottoman': {
      g.add(rod(v3(0, y, out), v3(0, y - 0.14, out), 0.004, M.brass()));
      g.add(ball(0.075, glowMat('#ffd8a0', 1.5), 0, y - 0.22, out, 1, 1.15, 1, 16));
      T.lampGlass.forEach((c, i) => { const a = i / T.lampGlass.length * Math.PI * 2; g.add(ball(0.032, glowMat(c, 1.6), Math.cos(a) * 0.06, y - 0.22, out + Math.sin(a) * 0.06, 1, 1.4, 0.4)); });
      g.add(cyl(0.02, 0.035, 0.03, M.brass(), 0, y - 0.15, out));
      g.add(cyl(0.012, 0.0, 0.05, M.brass(), 0, y - 0.33, out));
      break;
    }
    case 'brassLantern': {
      g.add(rod(v3(0, y, out), v3(0, y - 0.12, out), 0.004, M.brass()));
      g.add(cyl(0.06, 0.07, 0.14, glowMat('#ffc070', 1.5), 0, y - 0.28, out, 10));
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.add(box(0.012, 0.15, 0.012, M.brass(), Math.cos(a) * 0.072, y - 0.285, out + Math.sin(a) * 0.072)); }
      g.add(cyl(0.0, 0.08, 0.06, M.brass(), 0, y - 0.15, out, 10));
      T.lampGlass.forEach((c, i) => g.add(ball(0.018, glowMat(c, 1.7), Math.cos(i * 1.6) * 0.074, y - 0.22, out + Math.sin(i * 1.6) * 0.074)));
      break;
    }
    case 'lantern': case 'rustic': {
      g.add(cyl(0.0, 0.06, 0.05, M.iron(), 0, y - 0.05, out, 4));
      g.add(rbox(0.09, 0.12, 0.09, glowMat('#ffe0a0', 1.4), 0, y - 0.18, out, 0.01));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(box(0.01, 0.13, 0.01, M.iron(), sx * 0.048, y - 0.185, out + sz * 0.048));
      g.add(cyl(0.05, 0.05, 0.015, M.iron(), 0, y - 0.2, out, 4));
      break;
    }
    case 'chandelier': {
      // a brass two-arm sconce with candle bulbs
      for (const sx of [-1, 1]) {
        g.add(rod(v3(0, y - 0.05, out), v3(sx * 0.1, y - 0.02, out + 0.02), 0.007, M.brass()));
        g.add(cyl(0.025, 0.02, 0.02, M.brass(), sx * 0.1, y - 0.03, out + 0.02));
        g.add(cyl(0.012, 0.012, 0.06, mat('#fbf6ea', { rough: 0.6 }), sx * 0.1, y - 0.01, out + 0.02));
        g.add(ball(0.018, glowMat('#ffe8b0', 1.6), sx * 0.1, y + 0.07, out + 0.02, 1, 1.5, 1));
      }
      break;
    }
    case 'fabric': default: {
      g.add(rod(v3(0, y, out), v3(0, y + 0.06, out), 0.007, M.brass()));
      g.add(cyl(0.08, 0.1, 0.11, mat('#f2e2c0', { emissive: '#ffd090', ei: 1.1, rough: 0.9, double: true }), 0, y + 0.02, out, 16));
      break;
    }
  }
  ctx.glows.push({ local: true, group: g, pos: v3(0, y - 0.15, out + 0.1), color: T.lampColor, power: 1.4, reach: 3, kind: 'lamp' });
}

function wallDecor(g, ctx, kind, i) {
  const { T } = ctx;
  const y = 1.12;
  switch (kind) {
    case 'nazar': {
      g.add(rod(v3(0, y + 0.18, 0.03), v3(0, y + 0.04, 0.03), 0.003, mat('#7a5a3a')));
      for (const [r, c, dz] of [[0.07, '#1f4fa8', 0], [0.05, '#ffffff', 0.008], [0.032, '#7ec8f0', 0.014], [0.016, '#1a1a2a', 0.018]]) g.add(cyl(r, r, 0.012, mat(c, { rough: 0.15, metal: 0.1 }), 0, y, 0.03 + dz, 20).rotateX(Math.PI / 2));
      break;
    }
    case 'copperPans': case 'copperRail': case 'paellaPans': {
      const paella = kind === 'paellaPans';
      g.add(rod(v3(-0.4, y + 0.22, 0.05), v3(0.4, y + 0.22, 0.05), 0.01, M.brass()));
      for (let k = 0; k < 3; k++) {
        const x = -0.28 + k * 0.28;
        const r = paella ? 0.13 : 0.08 + k * 0.012;
        const pm = paella ? mat('#3a3a42', { metal: 0.6, rough: 0.4 }) : M.copper();
        g.add(cyl(r, r, 0.03, pm, x, y + 0.06 - r, 0.07, 20).rotateX(Math.PI / 2));
        g.add(rod(v3(x, y + 0.22, 0.05), v3(x, y + 0.06, 0.07), 0.006, pm));
      }
      break;
    }
    case 'pepperString': case 'chiliRistra': case 'garlicBraid': case 'salami': {
      const garlic = kind === 'garlicBraid', salami = kind === 'salami';
      g.add(rod(v3(0, y + 0.25, 0.04), v3(0, y - 0.25, 0.06), 0.006, mat('#c9a96a')));
      for (let k = 0; k < (salami ? 3 : 8); k++) {
        const yy = y + 0.2 - k * (salami ? 0.16 : 0.06);
        if (garlic) g.add(ball(0.04, mat('#f1ead9', { rough: 0.7 }), (k % 2 - 0.5) * 0.04, yy, 0.07));
        else if (salami) g.add(cyl(0.035, 0.035, 0.14, mat('#a8323a', { rough: 0.6 }), (k - 1) * 0.07, yy - 0.12, 0.07, 10));
        else g.add(cyl(0, 0.02, 0.08, mat(kind === 'pepperString' && k % 3 === 0 ? '#5b2a6e' : '#d8261c', { rough: 0.4 }), (k % 2 - 0.5) * 0.04, yy - 0.05, 0.07, 8));
      }
      break;
    }
    case 'plates': case 'plateRack': {
      if (kind === 'plateRack') g.add(box(0.7, 0.03, 0.12, mat(T.trim), 0, y - 0.18, 0.06));
      for (let k = 0; k < 3; k++) {
        const x = -0.22 + k * 0.22;
        g.add(cyl(0.09, 0.09, 0.01, mat('#fbf8f2', { rough: 0.3 }), x, y + (k === 1 ? 0.05 : -0.02), 0.03, 24).rotateX(Math.PI / 2));
        g.add(ring(0.065, 0.008, mat(T.tileB, { rough: 0.3 }), x, y + (k === 1 ? 0.05 : -0.02), 0.04, 20).rotateX(Math.PI / 2));
      }
      break;
    }
    case 'clock': {
      g.add(cyl(0.13, 0.13, 0.03, mat('#fffaf0', { rough: 0.4 }), 0, y, 0.03, 24).rotateX(Math.PI / 2));
      g.add(ring(0.13, 0.012, M.brass(), 0, y, 0.05, 24).rotateX(Math.PI / 2));
      g.add(box(0.008, 0.08, 0.006, mat('#1a1a1a'), 0, y, 0.06));
      g.add(box(0.06, 0.008, 0.006, mat('#1a1a1a'), 0.03, y, 0.06));
      break;
    }
    case 'bunting': case 'toran': case 'marigolds': {
      for (let k = 0; k < 6; k++) {
        const x = -0.4 + k * 0.16;
        if (kind === 'bunting') { const c = ['#c0412d', '#f8f6f0', '#2f6fae'][k % 3]; const fl = cyl(0.0, 0.05, 0.1, mat(c, { rough: 0.8 }), x, y + 0.12, 0.03, 3); fl.rotation.z = Math.PI; g.add(fl); }
        else g.add(ball(0.035, mat(k % 2 ? '#f2b21a' : '#e8601a', { rough: 0.8 }), x, y + 0.2 - Math.sin(k / 5 * Math.PI) * 0.08, 0.04));
      }
      break;
    }
    case 'spiceRack': case 'brassPots': {
      g.add(box(0.7, 0.025, 0.12, mat(T.trim), 0, y - 0.1, 0.06));
      const cols = ['#f2b21a', '#d0401e', '#8a4a22', '#6a8a3a', '#e8601a'];
      for (let k = 0; k < 5; k++) {
        if (kind === 'spiceRack') { g.add(cyl(0.035, 0.035, 0.09, M.glass(), -0.26 + k * 0.13, y - 0.075, 0.06, 10)); g.add(cyl(0.03, 0.03, 0.06, mat(cols[k]), -0.26 + k * 0.13, y - 0.07, 0.06, 10)); }
        else if (k % 2 === 0) g.add(lathe([[0, 0], [0.06, 0.02], [0.065, 0.06], [0.03, 0.1], [0.035, 0.12]], M.brass(), -0.26 + k * 0.13, y - 0.075, 0.06, 14));
      }
      break;
    }
    default: { // teaGlasses, chianti, basilPot, baguettes, herbPots, teapot, mugs, jamon → a shelf with things
      g.add(box(0.7, 0.025, 0.14, mat(T.trim), 0, y - 0.1, 0.07));
      for (let k = 0; k < 3; k++) {
        const x = -0.22 + k * 0.22;
        if (kind === 'chianti') { g.add(lathe([[0, 0], [0.05, 0.01], [0.055, 0.08], [0.02, 0.16], [0.015, 0.22]], mat('#3a6a3a', { rough: 0.2, opacity: 0.85 }), x, y - 0.075, 0.07, 12)); g.add(cyl(0.056, 0.056, 0.07, mat('#d8b878'), x, y - 0.075, 0.07, 12)); }
        else if (kind === 'teaGlasses') g.add(lathe([[0, 0], [0.025, 0.005], [0.018, 0.04], [0.03, 0.08]], mat('#b5401a', { rough: 0.1, opacity: 0.8, double: true }), x, y - 0.075, 0.07, 12));
        else if (kind === 'basilPot' || kind === 'herbPots') { g.add(cyl(0.05, 0.04, 0.07, mat(C.terracotta), x, y - 0.075, 0.07, 12)); g.add(ball(0.06, mat(C.leaf), x, y + 0.02, 0.07, 1, 0.8, 1)); }
        else if (kind === 'teapot' || kind === 'mugs') { g.add(ball(0.055, mat(k === 1 ? T.tileB : '#f8f6f0', { rough: 0.3 }), x, y - 0.03, 0.07, 1, 0.85, 1)); g.add(rod(v3(x + 0.05, y - 0.03, 0.07), v3(x + 0.09, y, 0.07), 0.01, mat('#f8f6f0'))); }
        else if (kind === 'baguettes') { const b = cyl(0.025, 0.025, 0.3, mat('#d08a3c', { rough: 0.7 }), x, y - 0.08, 0.07, 10); b.rotation.z = 0.3; g.add(b); }
        else g.add(ball(0.05, mat(T.curtain), x, y - 0.03, 0.07));
      }
    }
  }
  void i;
}

function hangingString(g, ctx, WIN) {
  const { T } = ctx;
  const n = 9;
  const kind = T.decor.includes('bunting') ? 'bunting' : T.decor.includes('marigolds') ? 'marigold' : T.decor.includes('garlicBraid') ? 'garlic' : T.decor.includes('chiliRistra') ? 'chili' : T.decor.includes('pepperString') ? 'pepper' : 'bunting';
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const x = WIN.x0 + (WIN.x1 - WIN.x0) * t;
    const y = WIN.y1 + 0.12 - Math.sin(t * Math.PI) * 0.07;
    const z = 0.05;
    if (kind === 'bunting') { const fl = cyl(0, 0.035, 0.08, mat(['#c0412d', '#f8f6f0', T.tileB][k % 3], { rough: 0.8 }), x, y - 0.08, z, 3); fl.rotation.z = Math.PI; g.add(fl); }
    else if (kind === 'marigold') g.add(ball(0.03, mat(k % 2 ? '#f2b21a' : '#e8601a', { rough: 0.8 }), x, y, z));
    else if (kind === 'garlic') g.add(ball(0.03, mat('#f1ead9', { rough: 0.7 }), x, y, z));
    else g.add(cyl(0, 0.018, 0.07, mat(k % 3 === 0 ? '#3f8a3a' : '#d8261c', { rough: 0.4 }), x, y - 0.07, z, 6));
  }
}

// At a counter's back corner (k: shared/kitchens.js counterDecor): a utensil crock,
// oil & vinegar, a storage jar … The crock is part of the counter; what stands in it
// and at the corner are things of their own (tools) – here are their places
// (anchors.crock, anchors.corner).
function counterDecor(g, ctx, d, k) {
  const { T } = ctx;
  const y = COUNTER_H;
  const x = k % 2 ? 0.34 : -0.34, z = -0.34;
  if (k === 0) {
    const crock = crockMesh(T.tileB);
    crock.position.set(x, y, z);
    g.add(crock);
    d.anchors.crock = [0, 1, 2, 3].map((i) => v3(x + (i - 1.5) * 0.016, y + 0.055, z + (i % 2 ? 0.01 : -0.01)));
  }
  if (k === 1 || k === 2) d.anchors.corner = [v3(x, y, z), v3(x + (k % 2 ? -0.1 : 0.1), y, z)];
}

// ======================================================================= the window

function buildWindow(stat, dyn, T, WIN, glows) {
  const g = new THREE.Group();
  const frame = mat(T.frame, { rough: 0.55 });
  const w = WIN.x1 - WIN.x0, h = WIN.y1 - WIN.y0, cx = (WIN.x0 + WIN.x1) / 2, cy = (WIN.y0 + WIN.y1) / 2;
  // the view outside: a bright sky with a hint of a garden
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: '#cfe8f6', emissive: new THREE.Color(T.light.sun), emissiveIntensity: 0.9, roughness: 1 }));
  sky.position.set(cx, cy, 0.006);
  g.add(sky);
  g.add(box(w, 0.1, 0.012, mat('#7ab05a', { emissive: '#5a9a4a', ei: 0.4 }), cx, WIN.y0, 0.008));
  // frame, sill
  g.add(box(w + 0.08, 0.04, 0.05, frame, cx, WIN.y1, 0.025));
  g.add(box(w + 0.16, 0.035, 0.12, frame, cx, WIN.y0 - 0.035, 0.05));
  for (const x of [WIN.x0, WIN.x1]) g.add(box(0.04, h, 0.05, frame, x, WIN.y0, 0.025));
  switch (T.window) {
    case 'lattice': case 'jali': {
      // a wooden lattice over the lower half / the whole window
      const top = T.window === 'jali' ? WIN.y1 : cy;
      for (let k = 1; k < 8; k++) g.add(box(0.012, top - WIN.y0, 0.02, frame, WIN.x0 + w * k / 8, WIN.y0, 0.03));
      for (let k = 1; k < 6; k++) g.add(box(w, 0.012, 0.02, frame, cx, WIN.y0 + (top - WIN.y0) * k / 6, 0.03));
      if (T.window === 'lattice') { const arch = new THREE.Mesh(new THREE.TorusGeometry(w / 2, 0.025, 6, 20, Math.PI), frame); arch.position.set(cx, WIN.y1, 0.025); arch.scale.set(1, 0.22, 1); g.add(arch); }
      break;
    }
    case 'shutters': {
      for (const sx of [-1, 1]) {
        const sh = box(w / 2, h, 0.03, mat(T.frame, { rough: 0.6 }), cx + sx * (w / 2 + w / 4 + 0.03), WIN.y0, 0.04);
        g.add(sh);
        for (let k = 0; k < 7; k++) g.add(box(w / 2 - 0.04, 0.01, 0.035, mat('#3f6a33'), cx + sx * (w / 2 + w / 4 + 0.03), WIN.y0 + 0.06 + k * h / 7, 0.05));
      }
      g.add(box(0.03, h, 0.03, frame, cx, WIN.y0, 0.03));
      g.add(box(w, 0.025, 0.03, frame, cx, cy, 0.03));
      break;
    }
    case 'grille': {
      for (let k = 1; k < 6; k++) g.add(rod(v3(WIN.x0 + w * k / 6, WIN.y0, 0.05), v3(WIN.x0 + w * k / 6, WIN.y1, 0.05), 0.008, M.iron()));
      for (const y of [WIN.y0 + h * 0.3, WIN.y0 + h * 0.7]) g.add(rod(v3(WIN.x0, y, 0.05), v3(WIN.x1, y, 0.05), 0.008, M.iron()));
      break;
    }
    default: { // french / sash: muntins
      g.add(box(0.03, h, 0.03, frame, cx, WIN.y0, 0.03));
      for (const y of [WIN.y0 + h / 3, WIN.y0 + 2 * h / 3]) g.add(box(w, 0.025, 0.03, frame, cx, y, 0.03));
    }
  }
  // curtains either side, tied back
  if (T.window !== 'shutters') {
    const cloth = mat(T.curtain, { rough: 0.95 });
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) g.add(cyl(0.022, 0.03, h + 0.06, cloth, (sx < 0 ? WIN.x0 - 0.06 : WIN.x1 + 0.06) + sx * k * 0.025, WIN.y0 - 0.03, 0.06 + (k % 2) * 0.01, 8));
      g.add(ball(0.02, M.brass(), sx < 0 ? WIN.x0 - 0.04 : WIN.x1 + 0.04, WIN.y0 + h * 0.4, 0.09));
    }
    g.add(rod(v3(WIN.x0 - 0.2, WIN.y1 + 0.07, 0.07), v3(WIN.x1 + 0.2, WIN.y1 + 0.07, 0.07), 0.012, M.brass()));
  }
  // a plant on the sill
  g.add(cyl(0.05, 0.04, 0.08, mat(C.terracotta), cx + w * 0.3, WIN.y0, 0.07, 12));
  g.add(ball(0.07, mat(C.leaf), cx + w * 0.3, WIN.y0 + 0.13, 0.07, 1, 0.8, 1));
  stat.add(g);
  // daylight pouring in
  glows.push({ pos: v3(cx, cy, 0.5), color: T.light.sun, power: 1.6, reach: 4.5, kind: 'window' });
  void dyn;
}
