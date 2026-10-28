// The kitchen view: a Three.js diorama lit like Detective Achille's rooms – a
// faint room reflection, sky light, a soft-shadowed key light, and the warm
// point lights of the kitchen itself (its lamps, the wood fire, burners and
// ovens when they're on), ACES tone mapping and ambient occlusion on desktop.
// Every frame it shows the live state: pots on the burners with their
// liquid, bubbles and steam, flames and knobs, glowing ovens, running taps,
// bins filling up, food on the boards (the same drawings as the close-ups),
// and the cooks walking and working.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildKitchen, FIXTURES, walkable, splitPlace } from '../shared/kitchens.js';
import { VESSELS, twoHanded, INGREDIENTS, TOOLS } from '../shared/ingredients.js';
import { slotOf } from '../shared/stock.js';
import { buildKitchen3D, COUNTER_H } from './kitchen3d.js';
import { buildCook, poseCook, fadeCook, toolMesh } from './cook3d.js';
import { FpArms, SHOULDER, BRISK, APART, KNIFE, KNIFE_CARRY } from './fparms3d.js';
import { MAIN, SIDE } from './station.js';
import { buildFood, foodKey, boxedFood, boxable, boxSpec, cutLine, syncCuts, hasCuts } from './food3d.js';
import { lookOf } from './figure.js';
import { mat, M, ball, cyl, lathe, ring, box, rod, v3 } from './parts3d.js';
import { vesselModel, GRIP3D, chefKnifeMesh, peelerMesh, graterMesh, utensilMesh, knifeEdgeAt, KNIFE_HANG } from './props3d.js';
import { ACTIONS, BOARD_TOOLS, boardUnits } from '../shared/actions.js';
import { SAKIR, phaseTarget, glovesOn } from '../shared/cook.js';
import { drawIngredient, drawPieces, liquidColor } from './art.js';
import { themeOf } from './theme.js';

const LIGHTS = 6;
const KNIFE_EDGE = knifeEdgeAt(0.08); // (how far below the knife's line its edge is where it cuts – props3d.js)
const GLIDE_S = 0.6 / BRISK;   // a thing taken / put down travels this long, low, settling gently
const REACH_S = 0.55 / BRISK;  // and the cook reaches out for it
const OVEN_HANDLE = new THREE.Vector3(0, 0.28, 0.035); // (the oven door's handle, in its hinge's space – kitchen3d.js)
const EYE_H = 0.84;    // first person: eye height (a counter is 0.46 – about 90 cm – so about 165 cm)
const UP = new THREE.Vector3(0, 1, 0);
const WORK_S = 0.001;  // first person at work: kitchen units per close-up px
const BOX_HALF = [0.06, 0.08, 0.105];
const TIP_LOW = 0.05; // (a food's container held over the pot to tip it in: this far below where the close-up has it – just over the rim) // (a food container's half width, by its size in the nesting set)
// One piece of a food as it's been cut (a torn bit of mozzarella, a lemon wedge, a basil leaf, a garlic clove) –
// pinched in the fingertips to top or garnish with
function pieceCut(kind, it) {
  if (it && it.cut && it.cut !== 'whole') return it.cut;
  const a = (INGREDIENTS[kind] && INGREDIENTS[kind].art) || {};
  return a.type === 'herb' || a.type === 'leaf' ? 'leaves' : a.type === 'round' || a.type === 'bulb' ? 'wedges' : a.type === 'block' ? 'torn' : 'slices';
}
const rgb01 = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// working in an oven, a fridge …: where the camera looks (look, lookUp: out from the spot inside it, up), where it
// looks from (out, up from there – low enough to see in under the oven's top) and where I am (body: out from the
// spot, eye: up from it – crouched for a low oven – near enough for my arms to reach in)
const INTO = {
  oven: { look: 0.32, lookUp: 0.02, out: 0.85, up: 0.42, body: 0.5, eye: 0.42 },
  // (the fridge: from its handle's side, back out of its door's swing)
  chill: { look: 0.22, lookUp: 0.08, out: 1.05, side: 0.34, up: 0.42, body: 0.5, eye: 0.42 },
  dome: { look: 0.05, lookUp: 0.04, out: 0.7, up: 0.35, body: 0.5, eye: 0.2 },
  tandoor: { look: 0.05, lookUp: 0.04, out: 0.6, up: 0.45, body: 0.45, eye: 0.3 },
};
const CLAW_GAP = 0.05; // (cutting: the holding hand's palm is never nearer the blade than this – its curled knuckles stay clear of it)
const BENCHES = ['counter', 'dishwasher', 'sink', 'stove', 'table']; // (worktops an idle hand rests on)
const REST_TURN = 0.25; // (resting there: the fingers turned in this far from the line down from my shoulder – the elbow's out)
const REST_EDGE = 0.05; // (and the wrist about this far in from the worktop's near edge)
const REST_LEAN = 0.14; // (standing at a counter, my hands on it: leaning in this far)
const REST_AFTER = 50; // (and not straight away – standing there or working at it: only once I've been there this long, s – or up to 20 s more)
const CUT_TURN = 0.38; // (cutting: the food lies turned this far from square, its right end away – the knife comes in from the front right, across it)
// how far below the fist a tool's working end is (the knife's edge, the whisk's loops …)
const TOOL_LEN = { knife: 0.19, peeler: 0.07, spoon: 0.18, ladle: 0.18, whisk: 0.19, masher: 0.18, brush: 0.17, spatula: 0.2, tongs: 0.2, blenderStick: 0.12, shaker: 0.07, grater: 0, rollingPin: 0.02, pizzaPeel: 0.05, sponge: 0.025 };
// where a hand holds a pan by its handle (model coordinates, see buildVessel)
// – about two thirds of the way along it from the pan (the golden ratio, a little more): not at its end
// (the long handle runs from the rim, r out, to 0.18 further – see buildVessel)
// (where a hand holds a pan by its long handle: GRIP3D, props3d.js – two thirds along it)
// the tools the work puts in my hand that are the kitchen's own utensils (props3d.js), and how far below the
// fist each one's working end reaches (from its model)
const WORK_UTENSIL = { teaspoon: 'teaspoon', spoon: 'woodSpoon', ladle: 'ladle', whisk: 'whisk', masher: 'masher', spatula: 'spatula', tongs: 'tongs', peeler: 'peeler' };
for (const [t, k] of Object.entries(WORK_UTENSIL)) TOOL_LEN[t] = utensilMesh(k).userData.foot * 0.88;
const mobile = matchMedia('(pointer: coarse)').matches;
// ?lite: no shadows or ambient occlusion and a low frame rate (slow machines, headless tests)
export const LITE = new URLSearchParams(location.search).has('lite');

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.dpr = LITE ? 1 : Math.min(devicePixelRatio, mobile ? 1.5 : 2);
    r.setPixelRatio(this.dpr);
    r.shadowMap.enabled = !LITE;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; // (drawn once a frame – see frame() – not again for every pass that draws)
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true; // (a thing half cut through ends at the knife's line)
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.25;
    this.hemi = new THREE.HemisphereLight('#fff1dc', '#5a3a2a', 0.7);
    this.key = new THREE.DirectionalLight('#ffe6c4', 1.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.fill = new THREE.DirectionalLight('#bcd0ff', 0.3);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill, this.fill.target);
    this.lamps = Array.from({ length: LIGHTS }, (_, i) => {
      const l = new THREE.PointLight('#ffb067', 0, 3, 2);
      this.scene.add(l);
      void i;
      return l;
    });
    this.composer = null;
    // (ambient occlusion only where it's cheap: a screen of ordinary resolution – at a Retina's four pixels a
    // point it costs more than the whole kitchen does, and the governor would soon take it away again, after
    // seconds of stuttering)
    if (!mobile && !LITE && innerWidth * innerHeight * this.dpr * this.dpr <= 2.6e6) {
      try {
        // (the scene drawn with its depth kept, for the occlusion)
        const composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) }));
        composer.addPass(new RenderPass(this.scene, this.camera));
        const ao = new GTAOPass(this.scene, this.camera, 1, 1);
        ao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 2, thickness: 1, scale: 1, samples: 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
        ao.blendIntensity = 0.8;
        // the occlusion worked out from the depth the scene was just drawn with (its normals from that too) – not
        // the whole kitchen drawn over again for it. (What doesn't write depth stays out of it: the food standees,
        // the dirt being cleaned off.)
        const aoRender = ao.render.bind(ao);
        ao.render = function (renderer, writeBuffer, readBuffer, ...rest) {
          if (this.depthTexture !== readBuffer.depthTexture) this.setGBuffer(readBuffer.depthTexture);
          return aoRender(renderer, writeBuffer, readBuffer, ...rest);
        };
        composer.addPass(ao);
        composer.addPass(new OutputPass());
        this.composer = composer;
      } catch (e) { console.warn('no ambient occlusion', e); }
    }
    this.q = { steps: this.qualitySteps(), level: 0, n: 0, sum: 0, skip: 1500 };
    this.fps = 0;
    this.K = null; this.k3 = null;
    this.vessels = new Map();  // vessel id -> {kind, group, liquid, lid, bits}
    this.spins = new Map();    // vessel id -> how far round what's in it has been stirred {a, base, g}
    this.cooks = new Map();    // member id -> {fig, key}
    this.sprites = new Map();  // slot key -> sprite
    this.spriteTex = new Map();
    this.particles = [];
    this.glides = new Map(); // thing -> where it's drawn while it travels
    this.tools = new Map();  // tool id -> {kind, g}: the cutlery, the utensils … (shared/stock.js)
    this.foods = new Map();  // first person: the food in 3D (slot -> {key, g})
    this.lookKeys = new WeakMap();
    this.t = 0;
    this.dt = 0;
    this.zoom = 1;
    this.firstPerson = false;
    this.scene.add(this.camera);
    // first person: my eyes – my arms hang from them (its children are drawn too). The view is
    // seen from them, except at work: then a camera of its own looks down on the work
    this.eye = new THREE.PerspectiveCamera(80, 1, 0.03, 200);
    this.scene.add(this.eye);
    this.fpArms = new FpArms(this.eye);
    this.fpSlots = [null, null]; // what my left and right hands hold (first person)
    this.mainHand = 1;           // the hand I do most with: 1 the right, 0 the left (main.js: the player's choice)
    this.fpWant = new Map();     // (a thing being taken → the hand taking it)
    this.fpHold = new Map();     // thing -> how it's held ('handle', 'palm', 'side')
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.camInit = false;
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.marker = this.buildMarker();
    this.scene.add(this.marker);
    this.guides = new THREE.Group();
    this.scene.add(this.guides);
    this.steam = this.buildSteam();
    this.scene.add(this.steam.points);
  }

  // ------------------------------------------------------------------ kitchen

  setKitchen(size, cuisine) {
    if (this.K && this.K.size === size && this.K.cuisine === cuisine) return this.K;
    if (this.k3) { this.scene.remove(this.k3.root); disposeTree(this.k3.root); }
    // (the old kitchen's glowing copies)
    for (const g of (this.ghosts || new Map()).values()) if (g) { this.guides.remove(g); g.geometry.dispose(); }
    this.ghosts = new Map();
    this.glowing = null;
    for (const v of this.vessels.values()) this.dynamic.remove(v.group);
    this.vessels.clear();
    for (const s of this.sprites.values()) this.dynamic.remove(s);
    this.sprites.clear();
    for (const t of this.tools.values()) this.dynamic.remove(t.g);
    this.tools.clear();
    this.storeMemo = null;
    this.K = buildKitchen(size, cuisine);
    this.k3 = buildKitchen3D(this.K);
    this.glides.clear();
    this.parkedAt = null;
    this.scene.add(this.k3.root);
    const T = this.k3.theme;
    this.hemi.color.set(T.light.sky); this.hemi.groundColor.set(T.light.ground); this.hemi.intensity = T.light.hemi;
    this.key.color.set(T.light.key); this.key.intensity = T.light.keyI;
    this.renderer.toneMappingExposure = T.light.exposure;
    // the key light from above the open front corner, its shadow box round the room
    const W = this.K.w, H = this.K.h;
    const c = new THREE.Vector3(W / 2, 0, H / 2);
    this.key.position.set(c.x + W * 0.6, Math.max(W, H) * 1.5, c.z + H * 1.1);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera;
    const R = Math.hypot(W, H) * 0.62;
    sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 0.5; sc.far = Math.max(W, H) * 5; sc.updateProjectionMatrix();
    this.fill.position.set(c.x - W, H * 0.8, c.z + H * 0.2); this.fill.target.position.copy(c);
    // static light sources: positions to world
    this.staticGlows = this.k3.glows.map((g) => {
      const p = g.pos.clone();
      if (g.local && g.group) { g.group.updateMatrixWorld(true); p.applyMatrix4(g.group.matrixWorld); }
      return { ...g, pos: p };
    });
    this.camInit = false;
    this.q.skip = Math.max(this.q.skip, 1000); // new shaders compile: don't count that time
    return this.K;
  }

  // ------------------------------------------------------------------ keeping it smooth

  // What can be given up, most expensive first, when frames come too slowly.
  qualitySteps() {
    const steps = [];
    if (this.composer) steps.push(['no ambient occlusion', () => { this.composer.dispose(); this.composer = null; }]);
    if (this.dpr > 1.5) steps.push(['resolution 1.5×', () => this.setDpr(1.5)]);
    if (this.dpr > 1) steps.push(['resolution 1×', () => this.setDpr(1)]);
    if (this.renderer.shadowMap.enabled) {
      steps.push(['no shadows', () => {
        this.renderer.shadowMap.enabled = false;
        this.scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
      }]);
    }
    return steps;
  }

  setDpr(r) {
    this.renderer.setPixelRatio(r);
    if (this.composer) this.composer.setPixelRatio(r);
    this.resize();
  }

  get quality() { return `${this.q.steps.slice(0, this.q.level).map((s) => s[0]).join(', ') || 'full'}${this.hz ? ` · display ${this.hz} Hz` : ''}`; }

  // Called every frame with the time since the last one. It learns how fast
  // the display refreshes (60, 120 Hz …) from the quickest frames, and when the
  // frames come clearly slower than 60 a second (or the display, if that's
  // slower) – averaged over about a second – it drops the next extra and looks
  // again. (Seconds, not frames: at a few frames a second, a count of them
  // would be a long wait. And not chasing 120 a second on a 120 Hz display –
  // 60 is smooth; the picture isn't given up for more.)
  govern(ms) {
    const q = this.q;
    if (ms > 250) return; // a hidden tab, a dialog: not the renderer's fault
    if (ms > 2) { q.fast = q.fast ? Math.min(q.fast * 1.002, ms) : ms; } // ~ the refresh interval (slowly forgiving)
    if (q.skip > 0) { q.skip -= ms; return; }
    q.n++; q.sum += ms;
    if (q.sum < 1000) return;
    const avg = q.sum / q.n;
    q.n = 0; q.sum = 0;
    this.fps = Math.round(1000 / avg);
    const refresh = Math.max(4, Math.min(17, q.fast || 16.7));
    this.hz = Math.round(1000 / refresh);
    if (avg > Math.max(1000 / 60, refresh) * 1.18 && q.level < q.steps.length) {
      const [name, apply] = q.steps[q.level++];
      apply();
      console.info(`cookwithus: ${this.fps} fps, now ${name}`);
      q.skip = 750;
    }
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.insets) this.setInsets(this.insets.left, this.insets.bottom);
  }

  zoomBy(f) { if (!this.firstPerson) this.zoom = Math.max(0.45, Math.min(1.6, this.zoom / f)); }
  // first person: my eyes, standing at (x, y) facing yaw, leaning in by lean
  // (a little above the chibi head and a step back)
  eyeAt(x, y, yaw, eyeOff = 0, lean = 0) {
    return new THREE.Vector3(x - Math.sin(yaw) * (0.14 - lean), EYE_H + eyeOff - lean * 0.35, y - Math.cos(yaw) * (0.14 - lean));
  }
  // how far I lean in over work at O (further for the back burner, the middle of the sink;
  // hardly at all for the knob on the stove's front, the tap's lever – real: the pan stays in view too)
  workLeanAt(O, x, y, real = false) { return real ? 0 : Math.max(0.18, Math.min(0.42, Math.hypot(O.x - x, O.z - y) - 0.42)); }
  // first person, the mouse looking round: the view turns at once (no easing after it)
  lookBy(yaw, pitch) { if (this.fpCam) { this.fpCam.yaw += yaw; this.fpCam.pitch += pitch; } }

  // F2: looking through my cook's eyes, or at the whole room
  setFirstPerson(on) {
    this.firstPerson = on;
    this.workCamK = 0;
    this.camera.fov = on ? 80 : 32;
    this.fpCam = null; // (start right at my eyes)
    this.camera.near = on ? 0.03 : 0.1;
    this.camera.updateProjectionMatrix();
    this.camInit = false;
  }

  // panels cover part of the screen: centre the kitchen in what's left
  setInsets(left, bottom, top = 64) {
    this.insets = { left, bottom, top };
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.camera.setViewOffset(w, h, -left / 2, (bottom - top) / 2, w, h);
  }

  // grid point → screen (CSS px), for name tags and prompts
  project(gx, y, gz) {
    const v = new THREE.Vector3(gx, y, gz).project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight, on: v.z < 1 };
  }

  // ---------------------------------------------------------------- first person: hands on things
  // (client px ↔ the world)
  screenOf(w) {
    const r = this.canvas.getBoundingClientRect();
    const v = w.clone().project(this.camera);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: v.z < 1 && v.z > -1 };
  }
  rayAt(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const rc = this.raycaster || (this.raycaster = new THREE.Raycaster());
    rc.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1), this.camera);
    return rc.ray;
  }
  // where the middle of the view is on the screen (the view is shifted clear of the panels)
  viewCenter() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return this.screenOf(this.camera.position.clone().add(d));
  }
  rayPoint(cx, cy, d) { return this.rayAt(cx, cy).at(d, new THREE.Vector3()); }
  // how many screen px a world size is, there
  pxOf(w, size) {
    const r = this.canvas.getBoundingClientRect();
    const d = Math.max(0.05, w.distanceTo(this.camera.position));
    return size / (2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * r.height;
  }
  // how far a store's door is open (as drawn)
  doorOpenness(fx) {
    const F = this.k3.fx[fx];
    return F && F.parts.door ? F.parts.door.userData.o || 0 : 0;
  }
  // a lid: how high its knob stands above its rim; where the knob is, on its pot – or lying beside it (put down
  // there when it came off; else on the worktop to the pot's right)
  lidTop(vr) {
    if (vr.lidTopH == null) { const b = new THREE.Box3().setFromObject(vr.lid.clone()); vr.lidTopH = Math.max(0.02, b.max.y - b.min.y); }
    return vr.lidTopH;
  }
  lidKnobWorld(vid) {
    const vr = this.vessels.get(vid);
    return vr ? vr.group.position.clone().addScaledVector(UP, vr.h + this.lidTop(vr)) : null;
  }
  lidRestWorld(vid, w) {
    const vr = this.vessels.get(vid);
    if (!vr) return null;
    const pk = this.lidsAside && this.lidsAside.get(vid);
    if (pk) return pk.base.clone().addScaledVector(UP, this.lidTop(vr));
    return vr.group.position.clone().addScaledVector(w.R, vr.r * 2.3).setY(COUNTER_H + this.lidTop(vr));
  }
  // scooping from a pot in my other hand: held just left of the work, over the board – its mouth
  scoopHeldAt(w, vid) { const vr = this.vessels.get(vid); return w.O.clone().addScaledVector(w.R, -0.2).addScaledVector(UP, 0.03 + (vr ? vr.h * 0.9 : 0.06)); }
  // scooping: the real mouths – the pot it's taken from (in my other hand: just left of the work), and n places
  // across what it goes into
  scoopWorld(w, def, n, held) {
    const from = held ? this.scoopHeldAt(w, def.from) : this.vesselMouth(def.from), into = def.into || 'plates', to = this.vesselMouth(into);
    if (!from || !to) return null;
    const r = this.vesselRadius(into) * 0.45;
    return { from, to: Array.from({ length: n }, (_, i) => to.clone().addScaledVector(w.R, n > 1 ? (i / (n - 1) - 0.5) * 2 * r : 0)) };
  }
  // a pot's mouth (as drawn), how wide it is
  vesselMouth(vid) { const vr = vid && this.vessels.get(vid); return vr && vr.group.visible ? vr.group.position.clone().addScaledVector(UP, vr.h * 0.9) : null; }
  vesselRadius(vid) { const vr = vid && this.vessels.get(vid); return vr ? vr.r : 0.1; }
  // where a tray rests on the oven's worktop while the gloves go on (right over the spot inside, on the work's
  // plane – where the close-up's point for it is too)
  ovenRest(w) { return w.O.clone().addScaledVector(w.R, 0.22).setY(COUNTER_H + 0.002); }
  // where the oven gloves lie beside this oven (drawn there – or where they'd lie)
  glovesWorld(fx) {
    for (const [id, t] of Object.entries(this.toolsNow || {})) {
      if (!(TOOLS[t.kind] && TOOLS[t.kind].worn) || !t.at || !t.at.startsWith(`${fx}/`)) continue;
      const rec = this.tools.get(id);
      if (rec && rec.g.visible) return rec.g.position.clone().addScaledVector(UP, 0.01);
    }
    const F = this.k3.fx[fx];
    return F && F.anchors.gloves ? F.anchors.gloves[0].clone() : null;
  }
  // with the oven gloves on: the place by an oven they're hung back on, under this point of the screen (in reach)
  glovesSpotAt(cx, cy) {
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      if (!F.anchors.gloves) continue;
      const w = F.anchors.gloves[0], s = this.screenOf(w);
      if (s.on && Math.hypot(s.x - cx, s.y - cy) < Math.max(60, this.pxOf(w, 0.1)) && w.distanceTo(this.camera.position) < 1.4) return { fx, w: w.clone() };
    }
    return null;
  }
  // a store's handle (where a hand takes it), in the world
  handleWorld(fx) {
    const F = this.k3.fx[fx];
    if (F && F.parts.board && F.parts.board.userData.flat && !F.parts.drop && !F.parts.leaf) { F.parts.board.updateWorldMatrix(true, false); return F.parts.board.localToWorld(F.parts.board.userData.handle.clone()); }
    if (F && F.parts.drop) { F.parts.drop.updateWorldMatrix(true, false); return F.parts.drop.localToWorld(OVEN_HANDLE.clone()); }
    if (!F || !F.parts.leaf) return null;
    F.parts.leaf.updateWorldMatrix(true, false);
    const [a, b] = F.parts.handle;
    return F.parts.leaf.localToWorld(a.clone().lerp(b, 0.5));
  }
  // a counter's board, stood up this far (0 lying … 1 up against the wall) – and what moves aside with it
  poseBoard(P, o) {
    const B = P.board, u = B.userData, e = o * o * (3 - 2 * o);
    B.position.lerpVectors(u.flat.pos, u.up.pos, e);
    // (lifted at its near edge first, then over: the back edge stays near the worktop)
    B.quaternion.slerpQuaternions(u.flat.q, u.up.q, Math.min(1, e * 1.15));
    u.posed = o;
    B.updateMatrixWorld(true);
  }
  // the board's knife / peeler / grater, or the stack of containers: where it lies now, where it goes (laid at the
  // back – aside – or on the board)
  boardPart(fx, name) { const P = this.k3.fx[fx] && this.k3.fx[fx].parts; return P ? (name === 'nest' ? P.nest : P.tools && P.tools[name]) : null; }
  partWorld(fx, name) { const o = this.boardPart(fx, name); return o ? o.getWorldPosition(new THREE.Vector3()) : null; }
  partHome(fx, name, aside) { const o = this.boardPart(fx, name); return o && o.userData.flat ? (aside ? o.userData.up.pos : o.userData.flat.pos).clone() : null; }
  // where a door's handle would be, open this far (0 … 1) – as it swings in updateFixtures
  doorHandleAt(fx, v) {
    const F = this.k3.fx[fx], P = F && F.parts;
    if (!P) return null;
    if (P.board && P.board.userData.flat && !P.drop && !P.leaf) {
      const was = P.board.userData.posed ?? 0;
      this.poseBoard(P, v);
      const out = P.board.localToWorld(P.board.userData.handle.clone());
      this.poseBoard(P, was);
      return out;
    }
    const turn = P.drop && P.drop.userData.baseX != null ? ['x', P.drop, P.drop.userData.baseX + v * 1.45] : P.leaf && P.door && P.door.userData.base != null ? ['y', P.door, P.door.userData.base - v * 1.75] : null;
    if (!turn) return null;
    const [ax, obj, r] = turn, was = obj.rotation[ax];
    obj.rotation[ax] = r;
    obj.updateMatrixWorld(true);
    const out = this.handleWorld(fx);
    obj.rotation[ax] = was;
    obj.updateMatrixWorld(true);
    return out;
  }
  // how far open the door is with my hand on its handle at this point of the screen (the nearest along its swing)
  doorVAt(fx, cx, cy) {
    let best = null;
    for (let i = 0; i <= 40; i++) {
      const v = i / 40, hw = this.doorHandleAt(fx, v);
      if (!hw) return null;
      const s = this.screenOf(hw), d = Math.hypot(s.x - cx, s.y - cy);
      if (!best || d < best.d) best = { v, d };
    }
    return best;
  }
  // How far open the door would be with the hand holding its handle at this
  // point of the screen: round its hinge, as far as the handle swings.
  doorAt(fx, cx, cy) {
    const F = this.k3.fx[fx];
    const hinge = F.parts.door, g = hinge.parent;
    const ray = this.rayAt(cx, cy);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const o = ray.origin.clone().applyMatrix4(inv), d = ray.direction.clone().transformDirection(inv);
    const h = hinge.position, R = F.parts.handle[0].x + F.parts.leaf.position.x;
    // in the floor plane: where the line of sight meets the handle's circle round the hinge
    const ox = o.x - h.x, oz = o.z - h.z, n = Math.hypot(d.x, d.z) || 1, dx = d.x / n, dz = d.z / n;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - R * R, disc = b * b - c;
    let px, pz;
    if (disc >= 0) { const t = -b - Math.sqrt(disc) > 0 ? -b - Math.sqrt(disc) : -b + Math.sqrt(disc); px = ox + dx * t; pz = oz + dz * t; } else { px = ox - dx * b; pz = oz - dz * b; }
    return Math.max(0, Math.min(1, Math.atan2(pz, px) / 1.75));
  }
  // the spot on a store's shelves under this point of the screen: {r, x, w}
  shelfSpotAt(fx, cx, cy) {
    const F = this.k3.fx[fx];
    if (!F || !F.anchors.shelfL || this.doorOpenness(fx) < 0.45) return null;
    const g = F.parts.door.parent;
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const ray = this.rayAt(cx, cy);
    const o = ray.origin.clone().applyMatrix4(inv), d = ray.direction.clone().transformDirection(inv);
    const Ls = F.anchors.shelfL.map((w) => w.clone().applyMatrix4(inv)), Rs = F.anchors.shelfR.map((w) => w.clone().applyMatrix4(inv));
    let best = null;
    Ls.forEach((L, lv) => {
      if (Math.abs(d.y) < 1e-4) return;
      const t = (L.y + 0.02 - o.y) / d.y;
      if (t <= 0 || (best && t >= best.t)) return;
      const p = o.clone().addScaledVector(d, t);
      if (p.x < L.x - 0.06 || p.x > Rs[lv].x + 0.06 || p.z < L.z - 0.6 || p.z > L.z + 0.26) return; // (from the back of the shelf to just in front of it)
      const u = Math.max(0, Math.min(1, (p.x - L.x) / (Rs[lv].x - L.x)));
      best = { t, r: Ls.length - 1 - lv, x: Math.round(Math.max(0, Math.min(1, (u - 0.08) / 0.84)) * 100) / 100, w: F.anchors.shelfL[lv].clone().lerp(F.anchors.shelfR[lv], u) };
    });
    return best && { r: best.r, x: best.x, w: best.w };
  }
  // What a hand could take hold of at this point of the screen, in reach:
  // a thing in my hands, a store's door handle, a thing on its shelves (door
  // open), or a spot on a shelf (to put something) – or null.
  fpPick(cx, cy, me, held = [], { withHeld = true } = {}) {
    if (!this.firstPerson || !me) return null;
    const near = (q) => {
      const best = { d: Infinity, q: null };
      for (const c of q) { const s = this.screenOf(c.w); if (!s.on) continue; const d = Math.hypot(s.x - cx, s.y - cy); if (d < c.r && d < best.d) { best.d = d; best.q = c; } }
      return best.q;
    };
    // what's in my hands (unless I'm looking past them)
    const mine = [];
    for (const [k, e] of this.stashAt || []) {
      if (!e.fp || !held.includes(k)) continue;
      const w = this.glides.get(k) ? this.glides.get(k).pos.clone() : e.pos.clone();
      const vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
      w.y += vr ? vr.h * 0.5 : (e.size || 0.1) * 0.4;
      mine.push({ kind: 'held', key: k, w, r: Math.max(34, this.pxOf(w, vr ? vr.r * 1.6 : (e.size || 0.1) * 0.9)) });
    }
    const m = withHeld && near(mine);
    if (m) return m;
    // the stores in reach, in front of me
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      if (!F.parts.leaf) continue;
      const c = F.f;
      const ddx = Math.max(c.x, Math.min(c.x + c.w, me.x)) - me.x, ddz = Math.max(c.y, Math.min(c.y + c.h, me.y)) - me.y;
      if (Math.hypot(ddx, ddz) > 1.3) continue;
      const hw = this.handleWorld(fx);
      const [a, b] = F.parts.handle.map((p) => this.screenOf(F.parts.leaf.localToWorld(p.clone())));
      if (a.on && b.on) {
        // near the handle's line on the screen
        const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((cx - a.x) * vx + (cy - a.y) * vy) / L2));
        if (Math.hypot(a.x + vx * t - cx, a.y + vy * t - cy) < Math.max(28, this.pxOf(hw, 0.07))) return { kind: 'door', fx, w: hw };
      }
      if (this.doorOpenness(fx) < 0.45) continue;
      const things = [];
      for (const [k, e] of this.stashAt || []) {
        if (!e.stored || !e.sig || !e.sig.startsWith(`s:${fx}:`)) continue;
        const w = (this.glides.get(k) ? this.glides.get(k).pos : e.pos).clone();
        const vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
        w.y += vr ? vr.h * 0.8 * 0.5 : 0.17 * 0.4;
        things.push({ kind: 'thing', key: k, fx, w, r: Math.max(26, this.pxOf(w, vr ? vr.r * 0.8 * 1.6 : 0.15)) });
      }
      const t = near(things);
      if (t) return t;
      const spot = this.shelfSpotAt(fx, cx, cy);
      if (spot) return { kind: 'shelf', fx, ...spot };
    }
    // a drawer, a cupboard door – or a thing in one that's open, the crock … a tool lying about
    const bp = this.bayPick(cx, cy, me, held);
    if (bp) return bp;
    // (or just the fridge / pantry itself: its door to open or shut)
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      if (!F.parts.leaf) continue;
      const c = F.f;
      if (Math.hypot(Math.max(c.x, Math.min(c.x + c.w, me.x)) - me.x, Math.max(c.y, Math.min(c.y + c.h, me.y)) - me.y) > 1.3) continue;
      const box = new THREE.Box3(new THREE.Vector3(c.x, 0, c.y), new THREE.Vector3(c.x + c.w, 1.25, c.y + c.h));
      if (this.rayAt(cx, cy).intersectsBox(box)) return { kind: 'store', fx };
    }
    return null;
  }

  // What's in reach under this point of the screen among the cupboards and drawers and the things
  // lying about: a thing put away in an open one (or in the crock, at a counter's corner, a board's
  // own knife …), a tool or a spare thing lying on a worktop – to take: {kind: 'thing', key, fx: its
  // place}; a drawer's or a door's front – to open or shut: {kind: 'bay', fx: place, open, w: its
  // handle}; with something in my hands, the inside of an open one (or the crock) – to put it there:
  // {kind: 'bayIn', fx: place, spot}.
  bayPick(cx, cy, me, held = []) {
    const ray = this.rayAt(cx, cy);
    const reach = (f) => Math.hypot(Math.max(f.x, Math.min(f.x + f.w, me.x)) - me.x, Math.max(f.y, Math.min(f.y + f.h, me.y)) - me.y) < 1.05;
    const D = this.D;
    let thing = null;
    const consider = (k, fx, w, size) => {
      const s = this.screenOf(w);
      if (!s.on) return;
      const d = Math.hypot(s.x - cx, s.y - cy), r = Math.max(20, this.pxOf(w, size));
      if (d < r && (!thing || d < thing.d)) thing = { d, far: ray.origin.distanceTo(w), pick: { kind: 'thing', key: k, fx, w } };
    };
    for (const [k, e] of this.stashAt || []) {
      if (!e.place || e.hidden || e.fp || e.held) continue;
      const F = this.k3.fx[splitPlace(e.place)[0]];
      if (!F || !reach(F.f)) continue;
      const w = (this.glides.get(k) ? this.glides.get(k).pos : e.pos).clone();
      const vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
      w.y += vr ? vr.h * 0.4 : k[0] === 'u' ? (TOOLS[(this.toolsNow[k.slice(2)] || {}).kind] || {}).upright ? 0.06 : e.lie === 'crock' ? 0.05 : 0.01 : 0.04;
      consider(k, e.place, w, vr ? vr.r * 1.5 : k[0] === 'u' ? 0.08 : 0.13);
    }
    // lying on a worktop: the tools, and the food and pots and pans put down there
    for (const [id, rec] of this.tools) {
      const t = this.toolsNow[id];
      if (!rec.g.visible || !t || t.held != null || !t.at || t.at.includes('/') || !this.k3.fx[t.at] || !reach(this.k3.fx[t.at].f)) continue;
      consider(`u:${id}`, t.at, rec.g.position.clone().setY(rec.g.position.y + 0.01), 0.08);
    }
    if (D) {
      for (const [id, v] of Object.entries(D.vessels)) {
        const rec = this.vessels.get(id);
        if (!v.at || v.held != null || !rec || !rec.group.visible || !this.k3.fx[v.at.fx] || this.k3.fx[v.at.fx].parts.leaf || !reach(this.k3.fx[v.at.fx].f)) continue;
        consider(`v:${id}`, v.at.fx, rec.group.position.clone().setY(rec.group.position.y + rec.h * 0.5), rec.r * 1.5);
      }
      for (const [id, it] of Object.entries(D.items)) {
        const f = this.foods.get(`item:${id}`);
        if (!it.at || it.at.includes('/') || it.held != null || it.stored || !f || !f.g.visible || !this.k3.fx[it.at] || this.k3.fx[it.at].anchors.shelfL || !reach(this.k3.fx[it.at].f)) continue;
        consider(`i:${id}`, it.at, f.g.position.clone().setY(f.g.position.y + 0.04), 0.13);
      }
    }
    // the fronts of the drawers and doors, the insides of the open ones
    let bay = null, nearest = null; // (the nearest door or drawer the line of sight meets, and the nearest of anything)
    const hitBox = (m, b) => {
      const inv = new THREE.Matrix4().copy(m).invert();
      const r = ray.clone().applyMatrix4(inv);
      const box = new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, b.y - b.h / 2, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2));
      const p = r.intersectBox(box, new THREE.Vector3());
      return p ? p.applyMatrix4(m).distanceTo(ray.origin) : null;
    };
    for (const [fid, F] of Object.entries(this.k3.fx)) {
      if (!F.bays || !reach(F.f)) continue;
      for (const [b, B] of Object.entries(F.bays)) {
        const place = `${fid}/${b}`, o = B.obj.userData.o || 0;
        const tf = hitBox(B.obj.matrixWorld, B.front);
        if (tf != null && (!bay || tf < bay.t)) bay = { t: tf, place, front: true, o, B };
        if (o > 0.5 && B.inner) {
          const ti = hitBox(B.local ? B.obj.matrixWorld : B.frame, B.inner);
          if (ti != null && (!bay || ti < bay.t)) bay = { t: ti, place, front: false, o, B };
        }
        if (tf != null && (!nearest || tf < nearest.t)) nearest = { t: tf, place };
        if (o > 0.04 && B.kind === 'drawer') { const ti = hitBox(B.obj.matrixWorld, B.inner); if (ti != null && (!nearest || ti < nearest.t)) nearest = { t: ti, place }; }
      }
    }
    // (a thing in front of what it's in – unless a door or a drawer, or another one's open drawer, is in the way)
    if (thing && !(bay && bay.front && bay.t < thing.far - 0.05) && !(nearest && nearest.place !== thing.pick.fx && nearest.t < thing.far - 0.05)) return thing.pick;
    // the crock, with a spoon or a ladle in my hand: in it
    if (held.length) for (const [fid, F] of Object.entries(this.k3.fx)) {
      const c = F.anchors.crock;
      if (!c || !reach(F.f)) continue;
      const s = this.screenOf(c[0]);
      if (s.on && Math.hypot(s.x - cx, s.y - cy) < Math.max(26, this.pxOf(c[0], 0.14))) return { kind: 'bayIn', fx: `${fid}/crock`, spot: null, w: c[0].clone() };
    }
    if (!bay) return null;
    const hw = bay.B.obj.localToWorld(bay.B.handle.clone());
    if (!bay.front && held.length) {
      // where in it: the free spot nearest the pointer
      const P = this.placeSpots(bay.place);
      let best = null;
      if (P) for (let r = 0; r < P.spec.levels; r++) for (let i = 0; i < P.spec.slots; i++) {
        const s = this.screenOf(P.at(r, i));
        const d = s.on ? Math.hypot(s.x - cx, s.y - cy) : 1e9;
        if (!best || d < best.d) best = { d, r, i, w: P.at(r, i) };
      }
      return { kind: 'bayIn', fx: bay.place, spot: best ? { r: best.r, x: P.spec.slots > 1 ? best.i / (P.spec.slots - 1) : 0.5 } : null, w: best ? best.w : hw };
    }
    return { kind: 'bay', fx: bay.place, open: bay.o > 0.5, w: hw };
  }

  // A pot, a pan, a bowl standing in reach under this point of the screen – to tip something into: {kind: 'vessel', id, w}
  vesselPick(cx, cy, me) {
    if (!this.firstPerson || !me || !this.D) return null;
    let best = null;
    for (const [id, v] of Object.entries(this.D.vessels)) {
      const rec = this.vessels.get(id), F = v.at && this.k3.fx[v.at.fx];
      if (!rec || !rec.group.visible || !F || v.held != null) continue;
      const f = F.f;
      if (Math.hypot(Math.max(f.x, Math.min(f.x + f.w, me.x)) - me.x, Math.max(f.y, Math.min(f.y + f.h, me.y)) - me.y) > 1.05) continue;
      const w = rec.group.position.clone().setY(rec.group.position.y + rec.h * 0.5), s = this.screenOf(w);
      const d = s.on ? Math.hypot(s.x - cx, s.y - cy) : Infinity;
      if (d < Math.max(30, this.pxOf(w, rec.r * 1.3)) && (!best || d < best.d)) best = { d, pick: { kind: 'vessel', id, w } };
    }
    return best && best.pick;
  }

  // A stove's knob under this point of the screen, in reach: {kind: 'knob', fx, slot, w, level} (its burner's level now)
  knobPick(cx, cy, me) {
    if (!this.firstPerson || !me || !this.k3) return null;
    let best = null;
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      const f = F.f;
      if (!F.parts.knobs || !(F.anchors.burners || F.parts.drop) || Math.hypot(Math.max(f.x, Math.min(f.x + f.w, me.x)) - me.x, Math.max(f.y, Math.min(f.y + f.h, me.y)) - me.y) > 1.05) continue;
      F.parts.knobs.forEach((kn, slot) => {
        const w = kn.getWorldPosition(new THREE.Vector3()), s = this.screenOf(w);
        if (!s.on) return;
        const d = Math.hypot(s.x - cx, s.y - cy);
        if (d < Math.max(20, this.pxOf(w, 0.045)) && (!best || d < best.d)) best = { d, pick: { kind: 'knob', fx, slot, w, level: this.burnerLevel(fx, slot) } };
      });
    }
    return best && best.pick;
  }
  // how high a stove's burner is on (0 off … 3): the pan on it's, or the empty burner's
  burnerLevel(fx, slot) {
    const D = this.D, F = this.k3.fx[fx], fxs = (this.lastC && this.lastC.fx) || {};
    if (F && F.parts.drop) return (fxs[fx] && fxs[fx].oven) || 0; // (an oven: its dial)
    const v = D && F && vesselAtSlot(D, fx, slot, F.f.type);
    return v ? v.heat || 0 : (fxs[fx] && fxs[fx].lit && fxs[fx].lit[slot]) || 0;
  }
  // An oven's door handle in reach under this point of the screen: {kind: 'ovenDoor', fx, w, open}; or, its door open and
  // something in my hands, its inside: {kind: 'surface', fx, w, inside: true} – to put it in
  ovenPick(cx, cy, me, holding) {
    if (!this.firstPerson || !me || !this.k3) return null;
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      const f = F.f;
      if (!F.parts.drop || Math.hypot(Math.max(f.x, Math.min(f.x + f.w, me.x)) - me.x, Math.max(f.y, Math.min(f.y + f.h, me.y)) - me.y) > 1.05) continue;
      const open = !!(this.lastC && this.lastC.fx[fx] && this.lastC.fx[fx].door);
      const hw = this.handleWorld(fx), hs = hw && this.screenOf(hw);
      if (hs && hs.on && Math.hypot(hs.x - cx, hs.y - cy) < Math.max(24, this.pxOf(hw, 0.07))) return { kind: 'ovenDoor', fx, w: hw, open };
      if (open && holding && F.anchors.inside) {
        const w = F.anchors.inside.clone(), s = this.screenOf(w);
        if (s.on && Math.hypot(s.x - cx, s.y - cy) < Math.max(40, this.pxOf(w, 0.3))) return { kind: 'surface', fx, w, inside: true };
      }
    }
    return null;
  }

  // Where my line of sight meets a worktop in reach – a counter's top or the board lying on it, a table, a
  // stove (the burner nearest), the sink – to put down what I hold just there: {kind: 'surface', fx, w: the
  // point, slot: the burner, sink}, or null.
  surfacePick(cx, cy, me) {
    if (!this.firstPerson || !me || !this.k3) return null;
    const ray = this.rayAt(cx, cy), p = new THREE.Vector3();
    let best = null;
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      const A = F.anchors, f = F.f;
      if (!A.top || F.parts.leaf || A.inside || A.mouth || !(A.spots || A.burners || A.basin || f.type === 'table')) continue;
      if (Math.hypot(Math.max(f.x, Math.min(f.x + f.w, me.x)) - me.x, Math.max(f.y, Math.min(f.y + f.h, me.y)) - me.y) > 1.05) continue;
      // (the board's top, where it lies – not stood up at the back; else the worktop's)
      const B = F.parts.board, tops = [];
      if (A.board && B && !(B.userData.posed > 0.5)) tops.push({ y: A.board.y, board: B });
      tops.push({ y: A.top.y });
      for (const t of tops) {
        if (!ray.intersectPlane(new THREE.Plane(UP, -t.y), p)) continue;
        if (p.x < f.x + 0.02 || p.x > f.x + f.w - 0.02 || p.z < f.y + 0.02 || p.z > f.y + f.h - 0.02) continue;
        if (t.board) { const l = t.board.worldToLocal(p.clone()); if (Math.abs(l.x) > 0.25 || Math.abs(l.z) > 0.17) continue; }
        const d = ray.origin.distanceTo(p);
        if (best && d >= best.d) break;
        let slot = null;
        if (A.burners) { let bd = Infinity; A.burners.forEach((b, i) => { const e = Math.hypot(b.x - p.x, b.z - p.z); if (e < bd) { bd = e; slot = i; } }); }
        best = { d, pick: { kind: 'surface', fx, w: p.clone(), slot, sink: !!A.basin } };
        break;
      }
    }
    return best && best.pick;
  }

  // the screen-space directions of the grid axes (for moving with keys / stick)
  screenAxes() {
    const o = this.project(0, 0, 0), ex = this.project(1, 0, 0), ez = this.project(0, 0, 1);
    return { x: [ex.x - o.x, ex.y - o.y], z: [ez.x - o.x, ez.y - o.y] };
  }

  // ------------------------------------------------------------------ frame

  // view: {C, D, cooks: [{id, x, y, yaw, walk, work, carry, avatar, me}], target, guide: Set, activeAt: Map, me}
  frame(dt, view) {
    if (!this.K) return;
    this.t += dt;
    this.dt = dt;
    this.updateCamera(dt, view);
    this.workScene(view);
    this.updateFixtures(view);
    this.toolsNow = (view.C && view.C.tools) || {};
    this.lastC = view.C;
    this.D = view.D;
    // the boards' own knives, peelers and graters: lying there when they're there (not taken away),
    // and not while they're in someone's hand at work there
    const onBoard = new Set();
    for (const t of Object.values(this.toolsNow)) if (t.held == null && t.at && t.at.endsWith('/board') && TOOLS[t.kind] && TOOLS[t.kind].board) onBoard.add(`${t.at.slice(0, -6)}|${TOOLS[t.kind].board}`);
    const takingNow = this.work && this.work.boardToolInHand;
    for (const [id, F] of Object.entries(this.k3.fx)) if (F.parts.tools) for (const [t, o] of Object.entries(F.parts.tools)) o.visible = onBoard.has(`${id}|${t}`) && !(view.inHand && view.inHand.get(id) && view.inHand.get(id).has(t)) && takingNow !== `${id}|${t}`;
    this.updateCooks(view, dt); // first: things in their hands follow them
    this.updateArms(view, dt);
    this.updateStash(view);
    this.updateVessels(view, dt);
    this.updateItems(view);
    this.updateTools(view);
    this.updateWorkFx(dt);
    this.updateMarker(view);
    this.updateLights(view);
    this.updateSakir(view, dt);
    this.updateSteam(dt);
    this.renderer.shadowMap.needsUpdate = true;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt, view) {
    const K = this.K;
    const W = K.w, H = K.h;
    const me = view.cooks.find((c) => c.me);
    if (this.firstPerson && me) {
      // at my eyes, looking where I face (and up / down as I like)
      // (the view eases after where I face – keys, stick or dragging – so it never jumps)
      const c = this.fpCam;
      if (!c || Math.hypot(c.x - me.x, c.y - me.y) > 1.5) this.fpCam = { x: me.x, y: me.y, yaw: me.yaw || 0, pitch: view.pitch ?? -0.18 };
      const F = this.fpCam, k = 1 - Math.exp(-dt * 22);
      let dy = (me.yaw || 0) - F.yaw;
      dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      F.yaw += dy * k;
      F.pitch += ((view.pitch ?? -0.18) - F.pitch) * k;
      F.x = me.x; F.y = me.y;
      const pitch = F.pitch, yaw = F.yaw;
      // eyes a little above the chibi head and a step back, so a counter right in front doesn't fill the view
      // (leaning in a little while reaching for something)
      // (and a little closer while working at something)
      // (further in for something at the back – the back burner, the middle of the sink)
      const wo = this.work && !this.work.idle && this.work.O;
      const wantLean = wo ? this.workLeanAt(wo, me.x, me.y, this.work.real) : 0;
      this.workLean = (this.workLean || 0) + (wantLean - (this.workLean || 0)) * (1 - Math.exp(-dt * 4 * BRISK));
      // (and over a counter, my hands resting on it)
      this.restLeanK = (this.restLeanK || 0) + ((this.restLean ? REST_LEAN : 0) - (this.restLeanK || 0)) * (1 - Math.exp(-dt * 3 * BRISK));
      const lean = Math.max(this.fpArms.lean(), this.workLean, this.restLeanK);
      const eye = this.eyeAt(me.x, me.y, yaw, view.eyeOff || 0, lean);
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      // at work the view leaves my eyes for a camera of its own, almost straight down on
      // the work (and in front of the knob, the tap's lever) – my arms stay at my
      // shoulders: I see them reach in. It glides there and back.
      const wc = this.work && !this.work.idle && this.work.cam;
      // (from one step's camera to the next it glides too)
      if (wc) {
        const A = this.workCamAt, g = 1 - Math.exp(-dt * 5 * BRISK);
        if (!A || !this.workCamK) this.workCamAt = { pos: wc.pos.clone(), look: wc.look.clone() };
        else { A.pos.lerp(wc.pos, g); A.look.lerp(wc.look, g); }
        // (and my body with it – from the knob to the oven's inside to the door's handle – not in a jump)
        const Bw = this.work.body;
        if (!Bw) this.workBodyAt = null;
        else if (!this.workBodyAt || this.workCamK < 0.05) this.workBodyAt = { pos: Bw.pos.clone(), fwd: Bw.fwd.clone() };
        else { this.workBodyAt.pos.lerp(Bw.pos, g); this.workBodyAt.fwd.lerp(Bw.fwd, g).normalize(); }
      }
      this.workCamK = (this.workCamK || 0) + ((wc ? 1 : 0) - (this.workCamK || 0)) * (1 - Math.exp(-dt * 6 * BRISK));
      if (!wc && this.workCamK < 0.003) this.workCamK = 0;
      const wk = this.workCamK * this.workCamK * (3 - 2 * this.workCamK);
      this.eye.position.copy(eye);
      this.camTarget.copy(eye).add(dir);
      this.eye.lookAt(this.camTarget);
      // (and I step right up to it, leaning over: my shoulders – where my arms come
      // from – just out of that camera's sight, close enough for my hands to be on the work)
      const B = wk > 0 && this.workBodyAt;
      if (B) {
        const qb = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(B.pos, B.pos.clone().add(B.fwd), UP));
        this.eye.position.lerp(B.pos, wk);
        this.eye.quaternion.slerp(qb, wk);
      }
      this.eye.updateMatrixWorld(true);
      if (wk > 0 && this.workCamAt) {
        const Wc = this.workCamAt;
        const q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(Wc.pos, Wc.look, UP));
        this.camera.position.copy(eye).lerp(Wc.pos, wk);
        this.camera.quaternion.copy(this.eye.quaternion).slerp(q1, wk);
      } else {
        this.camera.position.copy(eye);
        this.camera.quaternion.copy(this.eye.quaternion);
      }
      const fov = 80 + (WORK_FOV - 80) * wk;
      if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      this.camera.updateMatrixWorld(true);
      this.camPos.copy(this.camera.position);
      return;
    }
    const R = Math.hypot(W, H) / 2 + 0.6;
    // fit into the part of the screen the panels leave free
    const ins = this.insets || { left: 0, bottom: 0, top: 64 };
    const cw = Math.max(200, this.canvas.clientWidth - ins.left), ch = Math.max(200, this.canvas.clientHeight - ins.bottom - ins.top);
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * ch / this.canvas.clientHeight);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cw / ch);
    let dist = R / Math.sin(Math.min(vfov, hfov) / 2) * 0.9;
    // big kitchens: stay closer and follow the cook
    const big = dist > 13;
    if (big) dist = 12.5;
    dist *= this.zoom;
    const center = new THREE.Vector3(W / 2, 0.3, H / 2 + 0.15);
    const target = center.clone();
    if (me && (big || this.zoom < 0.9)) {
      const f = big ? 0.85 : 0.6;
      target.lerp(new THREE.Vector3(me.x, 0.4, me.y), f);
    }
    const az = Math.PI / 4, el = THREE.MathUtils.degToRad(46);
    const offset = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
    const pos = target.clone().add(offset);
    const k = this.camInit ? 1 - Math.exp(-dt * 4) : 1;
    this.camTarget.lerp(target, k);
    this.camPos.lerp(pos, k);
    this.camInit = true;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  // ------------------------------------------------------------------ fixtures' live parts

  updateFixtures(view) {
    const C = view.C, D = view.D;
    const fxs = (C && C.fx) || {};
    for (const [id, F] of Object.entries(this.k3.fx)) {
      const P = F.parts;
      // the dishwasher's light: on (blinking) while it runs
      if (P.dwLight) {
        const run = !!(C && C.dw && C.dw[id] && C.dw[id].run);
        P.dwLight.visible = run && Math.sin(this.t * 4) > -0.6;
        if (P.dwButton) { P.dwButton.material.color.set(run ? '#5ad86a' : '#3a7ac0'); P.dwButton.material.emissive.set(run ? '#2a9a3a' : '#000000'); }
      }
      // a board after knife work: its stains (going as it's scrubbed) and the suds
      if (P.stains) {
        const wl = this.work && this.work.washing && this.work.washing.fx === id && !this.work.washing.vid ? this.work.washing : null;
        // (and while a step's worked on it, coming as it goes)
        const going = this.work && !this.work.idle && this.work.fx === id ? this.work.boardDirt || 0 : 0;
        // (cleaned freehand: the stains as they're left, rubbed off where the sponge went)
        const mask = wl && wl.mask && wl.mask.board ? wl.mask : null;
        if (mask && P.board) this.cleanLayer(P.board, mask, () => new THREE.PlaneGeometry(0.52, 0.36), 0.0257);
        else if (P.board && P.board.userData.cleanLayer) P.board.userData.cleanLayer.visible = false;
        P.stains.visible = !mask && (!!(fxs[id] && fxs[id].dirty) || !!wl || going > 0.05);
        if (P.stains.visible) {
          const dirt = wl ? wl.dirt : fxs[id] && fxs[id].dirty ? 1 : going, suds = wl ? wl.suds : 0;
          P.stains.children.forEach((m, i) => { m.visible = m.userData.dirt ? i / 9 < dirt - 0.02 : suds > (i % 7) / 9; });
        }
      }
      if (P.door) {
        // the fridge door swings open / shut
        const u = P.door.userData;
        if (u.base == null) { u.base = P.door.rotation.y; u.o = 0; }
        const live = view.doors && view.doors.has(id);
        const want = live ? view.doors.get(id) : fxs[id] && fxs[id].door ? 1 : 0;
        u.o += (want - u.o) * (live ? 0.35 : 0.18);
        P.door.rotation.y = u.base - u.o * 1.75;
      }
      // the drawers slide out, the cupboard doors swing open (as the kitchen has them)
      if (F.bays) for (const [bay, B] of Object.entries(F.bays)) {
        const u = B.obj.userData;
        if (u.o == null) u.o = 0;
        const want = fxs[id] && fxs[id].bays && fxs[id].bays[bay] ? 1 : 0;
        if (Math.abs(want - u.o) < 0.002) { if (u.o === want) continue; u.o = want; } else u.o += (want - u.o) * Math.min(1, (this.dt || 0.016) * 8 * BRISK);
        if (B.kind === 'drawer') B.obj.position.copy(B.base.pos).addScaledVector(B.out, B.slide * u.o);
        else B.obj.rotation.y = B.base.rotY + B.sign * u.o * 1.75;
        B.obj.updateMatrixWorld(true);
      }
      // (the board's things, each where it lies – moved by a hand, one at a time – or in my hand right now)
      for (const name of ['knife', 'peeler', 'grater', 'nest']) {
        const o = name === 'nest' ? P.nest : P.tools && P.tools[name];
        if (!o || !o.userData.flat) continue;
        const held = this.work && !this.work.idle && this.work.part && this.work.part.fx === id && this.work.part.name === name ? this.work.part : null;
        const T = held || (fxs[id] && fxs[id].aside && fxs[id].aside[name] ? o.userData.up : o.userData.flat);
        const k = held ? 1 : Math.min(1, (this.dt || 0.016) * 10 * BRISK);
        o.position.lerp(T.pos, k);
        o.quaternion.slerp(T.q || o.userData.flat.q, k);
      }
      if (P.board && P.board.userData.flat) {
        // a counter's board stood up at the back (for something big) or laid down – by my hands at work, else as
        // the kitchen has it; its knife, peeler, grater and the stack of containers move aside with it
        const u = P.board.userData;
        if (u.o == null) u.o = 0;
        const liveB = view.doors && view.doors.has(id);
        const want = liveB ? view.doors.get(id) : fxs[id] && fxs[id].boardUp ? 1 : 0;
        if (Math.abs(want - u.o) > 0.001) { u.o += (want - u.o) * (liveB ? 0.35 : 0.18); this.poseBoard(P, u.o); } else if (u.posed !== want) { u.o = want; this.poseBoard(P, want); }
      }
      if (P.drop) {
        // the oven door folds down towards you
        const u = P.drop.userData;
        // tip about its own hinge, whichever way the oven faces
        if (u.o == null) { u.o = 0; P.drop.rotation.setFromQuaternion(P.drop.quaternion, 'YXZ'); u.baseX = P.drop.rotation.x; }
        const live = view.doors && view.doors.has(id);
        const want = live ? view.doors.get(id) : fxs[id] && fxs[id].door ? 1 : 0;
        u.o += (want - u.o) * (live ? 0.35 : 0.18);
        P.drop.rotation.x = u.baseX + u.o * 1.45;
      }
      const st = fxs[id] || {};
      if (P.water) {
        P.water.visible = !!st.tap;
        if (P.water.visible) { P.water.scale.x = P.water.scale.z = 1 + Math.sin(this.t * 30) * 0.15; }
        if (P.water.visible && Math.random() < 0.3) this.puff(F.anchors.basin, 'drop');
      }
      // (lifted while the water runs – also while my hand holds it up, filling a pan)
      const held = this.work && !this.work.idle && this.work.lever && this.work.lever.fx === id;
      if (P.lever) P.lever.rotation.z += ((st.tap || (held && this.work.lever.on) ? 0.6 : 0) - P.lever.rotation.z) * Math.min(1, (this.dt || 0.016) * 14 * BRISK);
      // burners
      if (P.flames) {
        P.flames.forEach((fr, slot) => {
          const v = D && vesselAtSlot(D, id, slot, F.f.type);
          const lit = fxs[id] && fxs[id].lit && fxs[id].lit[slot];
          const heat = v ? v.heat || 0 : lit || 0; // (an empty burner left on burns too)
          fr.visible = heat > 0;
          if (heat > 0) {
            // (a pan on it: the flames spread out under its bottom – they never come up through it)
            if (v) fr.scale.set(1.2, 0.28 + heat * 0.04, 1.2); else fr.scale.set(1, 0.6 + heat * 0.35, 1);
            fr.children.forEach((c, i) => { c.scale.y = 0.8 + Math.sin(this.t * 22 + i * 1.7) * 0.25; });
          }
          if (P.knobs && P.knobs[slot]) P.knobs[slot].rotation.z = -heat * 0.9;
          // (turning it right now, in first person: it follows the hand)
          if (P.knobs && P.knobs[slot] && this.work && this.work.knob && this.work.knob.fx === id && this.work.knob.slot === slot) P.knobs[slot].rotation.z = -this.work.knob.level * 0.9;
        });
      }
      // ovens glow when something bakes inside (and the temperature knob is turned to it)
      if (P.glow) {
        const inV = D && Object.values(D.vessels).find((v) => v.at && v.at.fx === id && v.heat > 0 && !v.onHob);
        P.glow.material.emissiveIntensity = inV ? 1.4 + Math.sin(this.t * 3) * 0.15 : 0;
        if (P.knobs && P.knobs[0]) P.knobs[0].rotation.z = this.work && this.work.knob && this.work.knob.fx === id ? -this.work.knob.level * 0.9 : -(inV ? inV.heat : (fxs[id] && fxs[id].oven) || 0) * 0.9;
      }
      if (P.fire) P.fire.children.forEach((c, i) => { c.scale.y = 0.75 + Math.sin(this.t * (9 + i) + i * 2) * 0.3; });
      if (P.fire && P.fire.isMesh) P.fire.material.emissiveIntensity = 2.6 + Math.sin(this.t * 5) * 0.4;
      // bins: the bag bulges as it fills; a full one has its lid up
      if (P.lid) {
        const holds = FIXTURES[F.f.type].holds;
        const fill = C && C.bins && C.bins[id] ? C.bins[id].fill : 0;
        const k = Math.min(1, fill / holds);
        const busy = view.busy && view.busy.has(id);
        const open = k >= 1 || busy ? -1.3 : 0;
        P.lid.rotation.x += (open - P.lid.rotation.x) * 0.15;
        P.bag.visible = k > 0.6;
        P.bag.scale.set(1, 0.5 + (k - 0.6) * 1.5, 1);
        if (k >= 1 && Math.random() < 0.05) this.puff(F.anchors.top, 'fly');
      }
    }
  }

  // ------------------------------------------------------------------ where things are kept / carried

  // Things put away in the fridge / on the shelf each get a place there, and
  // things in someone's hands go where their hands are: thing key -> {pos, yaw}.
  updateStash(view) {
    const D = view.D;
    const out = new Map();
    this.stashAt = out;
    if (!D) return;
    if (this.memoFor !== (view.C && view.C.recipe)) { this.memoFor = view.C && view.C.recipe; this.storeMemo = null; } // (a new dish: places afresh)
    // put away: each store's things, in order – pans at the bottom, dishes
    // above, food at the top (the fridge: food from the top shelf down)
    const per = new Map();
    const add = (fx, key) => { if (!per.has(fx)) per.set(fx, []); per.get(fx).push(key); };
    for (const [id, v] of Object.entries(D.vessels)) if (!v.at && v.held == null && v.home) add(v.home, `v:${id}`);
    for (const [id, it] of Object.entries(D.items)) {
      if (it.in || it.hidden || it.held != null || !it.at) continue;
      const F = this.k3.fx[it.at];
      if (F && F.anchors.shelfL) add(it.at, `i:${id}`);
    }
    for (const [id, t] of Object.entries(this.toolsNow || {})) if (t.held == null && t.at && this.k3.fx[t.at] && this.k3.fx[t.at].anchors.shelfL) add(t.at, `u:${id}`);
    for (const [fx, keys] of per) {
      const F = this.k3.fx[fx];
      if (!F || !F.anchors.shelfL) continue;
      const Ls = F.anchors.shelfL, Rs = F.anchors.shelfR, n = Ls.length;
      const fridge = F.f.type === 'fridge';
      const thing = (k) => (k[0] === 'v' ? D.vessels[k.slice(2)] : k[0] === 'u' ? this.toolsNow[k.slice(2)] : D.items[k.slice(2)]);
      const kindOf = (k) => thing(k).kind;
      const cat = (k) => (k[0] === 'i' ? 'food' : VESSELS[kindOf(k)] && VESSELS[kindOf(k)].hob ? 'pans' : 'dishes');
      // (levels bottom to top here; a spot's shelf r counts from the top)
      const prefer = fridge ? { food: [3, 2, 1, 0], pans: [0, 1, 2, 3], dishes: [0, 1, 2, 3] } : { pans: [0, 1, 2, 3], dishes: [1, 0, 2, 3], food: [2, 3, 1, 0] };
      // (four places along the front of a shelf – and when those are taken, four more behind them)
      const SLOTS = [0.125, 0.375, 0.625, 0.875], BACK = 0.19;
      const taken = Ls.map(() => new Set());
      // (the fridge: the middle of its second shelf – front and back – is kept for a pot put in to chill)
      if (fridge && taken[1]) for (const i of [1, 2, 5, 6]) taken[1].add(i);
      const put = (k, lv, u, back = false) => {
        const pos = Ls[lv].clone().lerp(Rs[lv], u).addScaledVector(F.front, back ? -BACK : 0);
        out.set(k, { pos, yaw: k[0] === 'v' && GRIP3D[kindOf(k)] ? Math.atan2(F.front.z, -F.front.x) : null, stored: true, out: F.front, sig: `s:${fx}:${lv}:${u.toFixed(2)}${back ? 'b' : ''}` });
        taken[lv].add(SLOTS.reduce((a, q, i) => (Math.abs(q - u) < Math.abs(SLOTS[a] - u) ? i : a), 0) + (back ? SLOTS.length : 0));
      };
      // where cooks put things (handles turned to the back of the shelf), then the rest in order
      const loose = [];
      for (const k of keys) {
        const t = thing(k);
        if (t.spot && t.spot.r < n) put(k, n - 1 - t.spot.r, 0.08 + t.spot.x * 0.84);
        else loose.push(k);
      }
      // (the dish's own things first – in front – then everything else the kitchen keeps)
      const spare = (k) => (thing(k).spare || k[0] === 'u' ? 1 : 0);
      loose.sort((a, b) => spare(a) - spare(b) || ['pans', 'dishes', 'food'].indexOf(cat(a)) - ['pans', 'dishes', 'food'].indexOf(cat(b)) || a.localeCompare(b));
      // (each keeps the place it was given while others come and go – then the newcomers, in the first free one)
      const memo = this.storeMemo || (this.storeMemo = new Map()), fresh = [];
      for (const k of loose) {
        const m = memo.get(k);
        if (m && m.fx === fx && m.lv < n && m.i >= 0 && !taken[m.lv].has(m.i + (m.back ? SLOTS.length : 0))) put(k, m.lv, SLOTS[m.i], m.back);
        else fresh.push(k);
      }
      for (const k of fresh) {
        const pr = prefer[cat(k)].filter((i) => i < n);
        let lv = pr.find((i) => [...taken[i]].filter((q) => q < SLOTS.length).length < SLOTS.length), back = false;
        if (lv === undefined) { lv = pr.find((i) => taken[i].size < SLOTS.length * 2); back = true; }
        if (lv === undefined) { lv = pr[0]; back = false; }
        const slot = SLOTS.findIndex((q, i) => !taken[lv].has(i + (back ? SLOTS.length : 0)));
        put(k, lv, slot >= 0 ? SLOTS[slot] : 0.5, back);
        memo.set(k, { fx, lv, i: slot, back });
      }
    }
    // put away in a drawer, a cupboard, the crock, the board's own place … each in its spot there
    // (out of sight while the door's shut – a glass one shows them)
    const inPlace = new Map();
    const addP = (p, k, t) => { if (!inPlace.has(p)) inPlace.set(p, []); inPlace.get(p).push([k, t]); };
    for (const [id, v] of Object.entries(D.vessels)) if (!v.at && v.held == null && v.home && v.home.includes('/')) addP(v.home, `v:${id}`, v);
    for (const [id, it] of Object.entries(D.items)) if (!it.in && !it.hidden && it.held == null && it.at && it.at.includes('/')) addP(it.at, `i:${id}`, it);
    for (const [id, t] of Object.entries(this.toolsNow || {})) if (t.held == null && t.at && t.at.includes('/')) addP(t.at, `u:${id}`, t);
    for (const [place, list] of inPlace) {
      const P = this.placeSpots(place);
      if (!P) continue;
      for (const [k, t] of list) {
        const sl = slotOf(P.spec, t.spot);
        const pos = P.at(sl.r, sl.i);
        if (!pos) continue;
        const handleBack = k[0] === 'v' && GRIP3D[t.kind] ? Math.atan2(P.out.z, -P.out.x) : Math.atan2(P.out.x, P.out.z);
        out.set(k, { pos, yaw: handleBack, stored: true, sig: `b:${place}:${sl.r}:${sl.i}`, place, lie: P.lie, out: P.out, hidden: P.hidden, slot: sl.i });
      }
    }
    // in my own hands, in first person – and on their way into them or out
    const meRec = this.fpOn ? this.cooks.get(this.fpMe) : null;
    if (meRec) {
      for (let i = 0; i < 2; i++) {
        const r = this.fpArms.reaching(i);
        const putting = r && !r.take && !r.released ? r.key : null;
        const k = putting || this.fpSlots[i];
        if (!k || (out.has(k) && !putting)) continue;
        // (being put away: the hand reaches to its spot on the shelf)
        if (putting && out.has(k) && k[0] === 'i') r.world = out.get(k).pos.clone().addScaledVector(UP, 0.01);
        // (put down: out of the hand from the start, it goes straight to its spot – the hand reaching with it – not
        // carried round the arm's way and dropped short)
        if (putting) continue;
        // (where it lay till the hand closes on it; then, if the hand only got
        // within arm's length of it, it comes the rest of the way)
        if (r && r.key === k && r.take && !r.grabbed) { out.set(k, { pos: r.src, yaw: r.srcYaw, sig: 'fp:lying', fp: true, size: 0.24 }); continue; }
        // (food is drawn hand-sized in the hand, and grows back to its size on the
        // counter as it goes there – on its way out of the hand, see updateItems)
        const p = r && r.key === k && r.take ? r.p : 0;
        out.set(k, { ...this.fpAttach(k, i, meRec), sig: 'fp', fp: true, size: 0.1 + 0.14 * p });
      }
    }
    // in someone's hands
    for (const rec of this.cooks.values()) {
      if (!rec.holding || !rec.hands || (rec === meRec && rec.fig.visible === false)) continue;
      rec.holding.forEach((k, i) => {
        if (k[0] === 'v' && !GRIP3D[rec.holdKind] && !twoHanded(rec.holdKind)) {
          // a plate, a bowl: carried on one hand, out in front
          const p = rec.rightHand.clone();
          p.x += Math.sin(rec.yaw) * 0.06; p.z += Math.cos(rec.yaw) * 0.06; p.y -= 0.02;
          out.set(k, { pos: this.aboveCounter(p), yaw: rec.yaw, held: true, sig: `h:${rec.id}` });
          return;
        }
        const g = k[0] === 'v' && GRIP3D[rec.holdKind];
        if (g) {
          // a pan by its handle, in the right hand, the pan out in front
          const th = rec.yaw + Math.PI / 2, sc = 0.85;
          const gx = g.x * Math.cos(th) + g.z * Math.sin(th), gz = -g.x * Math.sin(th) + g.z * Math.cos(th);
          const p = rec.rightHand.clone().sub(new THREE.Vector3(gx * sc, g.y * sc, gz * sc));
          out.set(k, { pos: this.aboveCounter(p, 0.12), yaw: th, held: true, sig: `h:${rec.id}` });
          return;
        }
        const p = rec.hands.clone();
        p.x += Math.sin(rec.yaw) * 0.02 + Math.cos(rec.yaw) * (i - (rec.holding.length - 1) / 2) * 0.07;
        p.z += Math.cos(rec.yaw) * 0.02 - Math.sin(rec.yaw) * (i - (rec.holding.length - 1) / 2) * 0.07;
        p.y -= 0.05;
        out.set(k, { pos: this.aboveCounter(p), yaw: rec.yaw, held: true, sig: `h:${rec.id}` });
      });
    }
  }

  // A place things are kept in (shared/kitchens.js bays), as it's drawn just now: its slots
  // (at(r, i): shelf r – 0 the top one – slot i), how things lie there, which way is out of it,
  // and whether what's in it is out of sight (a shut door – not a glass one – or drawer).
  placeSpots(place) {
    const [fid, bay] = splitPlace(place);
    const F = this.k3.fx[fid], spec = this.K.bays && this.K.bays[place];
    if (!F || !spec) return null;
    if (bay === 'board' || bay === 'crock' || bay === 'corner' || bay === 'gloves') {
      const A = bay === 'board' ? (F.parts.tools ? ['knife', 'peeler', 'grater'].map((t) => F.parts.tools[t].getWorldPosition(new THREE.Vector3())) : F.anchors.boardTools) : F.anchors[bay];
      if (!A) return null;
      return { spec, out: F.front, lie: bay === 'board' ? 'board' : bay === 'crock' ? 'crock' : 'up', hidden: false, open: 1, at: (r, i) => A[Math.min(i, A.length - 1)].clone() };
    }
    const B = F.bays && F.bays[bay];
    if (!B) return null;
    const o = B.obj.userData.o || 0;
    return {
      spec, out: B.out, lie: 'flat', hidden: !B.glass && o < 0.04, open: o, B,
      at: (r, i) => { const lv = B.spots[Math.min(r, B.spots.length - 1)]; const p = lv[Math.min(i, lv.length - 1)].clone(); return B.local ? B.obj.localToWorld(p) : p; },
    };
  }

  // The tools (the cutlery, the utensils, the bottles …) where they are: put away in their spot, in a
  // hand, or lying on a worktop – in a row from its front right corner. (A board's own knife, peeler and
  // grater lying in their places there: the kitchen's own meshes show them.)
  // which way a thing in my hand faces now (its turn about the upright) – kept when it's put down – or null
  heldYaw(k) {
    const o = k[0] === 'v' ? this.vessels.get(k.slice(2))?.group : k[0] === 'i' ? this.foods.get(`item:${k.slice(2)}`)?.g : null;
    return o ? new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y : null;
  }

  // which of the board's tools a thing is – 'knife', 'peeler', 'grater' – or null
  boardKindOf(k) { const t = k && k[0] === 'u' && this.toolsNow && this.toolsNow[k.slice(2)]; return (t && TOOLS[t.kind] && TOOLS[t.kind].board) || null; }

  updateTools(view) {
    void view;
    const tools = this.toolsNow || {};
    const seen = new Set(), perFx = new Map();
    for (const [id, t] of Object.entries(tools)) {
      const k = `u:${id}`;
      const kept = this.stashAt && this.stashAt.get(k);
      if (kept && (kept.hidden || kept.lie === 'board')) continue;
      // (in my hand at work, the work drawing it there itself – the knife as it cuts: not twice)
      if (kept && kept.fp && this.work && !this.work.idle && this.work.tool && TOOLS[t.kind] && this.work.tool.kind === TOOLS[t.kind].board) continue;
      const up = !!(TOOLS[t.kind] && TOOLS[t.kind].upright) || t.kind === 'grater';
      let pos, q;
      if (kept) {
        pos = this.glide(k, kept.sig, kept.pos);
        if (kept.q) q = kept.q;
        else if (kept.fp) q = this.tools.has(id) ? this.tools.get(id).g.quaternion.clone() : new THREE.Quaternion(); // (lying there still, till my hand closes on it)
        else if (kept.held) q = new THREE.Quaternion().setFromAxisAngle(UP, kept.yaw || 0);
        else q = this.lieQuat(kept.lie, kept.out, up, kept.lie === 'flat' && kept.place && kept.place.endsWith('/dr') ? 1 : kept.slot || 0);
      } else if (t.at && this.k3.fx[t.at] && t.lay && t.lay.fx === t.at) {
        // (put down just there by hand: lies there)
        const F = this.k3.fx[t.at];
        pos = this.glide(k, `l:${t.at}:${t.lay.x},${t.lay.z}`, new THREE.Vector3(t.lay.x, t.lay.y, t.lay.z));
        q = this.lieQuat('flat', F.front, up, 0);
      } else if (t.at && this.k3.fx[t.at]) {
        const F = this.k3.fx[t.at], n = perFx.get(t.at) || 0;
        perFx.set(t.at, n + 1);
        pos = this.glide(k, `a:${t.at}:${n}`, this.toolLie(F, n));
        q = this.lieQuat('flat', F.front, up, n);
      } else continue;
      let rec = this.tools.get(id);
      if (!rec || rec.kind !== t.kind) {
        if (rec) this.dynamic.remove(rec.g);
        rec = { kind: t.kind, g: utensilMesh(t.kind) };
        this.tools.set(id, rec);
        this.dynamic.add(rec.g);
      }
      rec.g.position.copy(pos);
      // (standing on its foot; lying, just above what it lies on)
      if (!(kept && (kept.q || kept.held))) rec.g.position.y += up ? rec.g.userData.foot || 0 : kept && kept.lie === 'crock' ? 0 : (rec.g.userData.under || 0) + 0.0008;
      // (out of my hand onto the worktop: turning to lie as it goes, not in a jump)
      const gl = this.glides.get(k);
      if (gl && gl.fromHand && gl.t < 1) rec.g.quaternion.slerp(q, Math.min(1, this.dt * 9)); else rec.g.quaternion.copy(q);
      rec.g.visible = true;
      seen.add(id);
    }
    for (const [id, rec] of this.tools) if (!seen.has(id)) rec.g.visible = false;
  }
  // How a tool lies: flat – its handle toward `out`, the working end away, a face up (turned a little
  // by n on a worktop); in the crock – the working end up, fanned out; upright – standing.
  lieQuat(lie, out, upright, n = 0) {
    const o = (out || new THREE.Vector3(0, 0, 1)).clone().setY(0).normalize();
    const basis = (Y, Z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(Y, Z), Y, Z));
    if (upright || lie === 'up') return new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(o.x, o.z) + n * 0.5);
    if (lie === 'crock') {
      const Y = UP.clone().negate().applyAxisAngle(o, (n - 1.5) * 0.2).applyAxisAngle(new THREE.Vector3().crossVectors(o, UP).normalize(), (n % 2 ? 0.1 : -0.1));
      return basis(Y, o.clone().sub(Y.clone().multiplyScalar(o.dot(Y))).normalize());
    }
    return basis(o.clone().applyAxisAngle(UP, ((n % 3) - 1) * 0.12), UP.clone());
  }
  // where the n-th tool put down on a worktop lies: side by side at its front left, clear of the board
  // and the stack of containers on its right
  toolLie(F, n) {
    const A = F.anchors, R = new THREE.Vector3().crossVectors(UP, F.front);
    const base = (A.spots && A.spots[Math.min(2, A.spots.length - 1)]) || A.top || A.board || F.src.position;
    return base.clone().addScaledVector(R, -(n % 4) * 0.045).addScaledVector(F.front, -0.07 - Math.floor(n / 4) * 0.12);
  }

  // Things travel between places in a little arc instead of jumping: when
  // where it belongs changes (sig), it glides from where it was drawn.
  glide(key, sig, target) {
    let g = this.glides.get(key);
    if (!g) { g = { sig, pos: target.clone(), from: null, t: 1 }; this.glides.set(key, g); return g.pos; }
    if (g.sig !== sig) { g.fromHand = g.sig === 'fp'; g.sig = sig; g.from = g.pos.clone(); g.t = 0; }
    if (g.t < 1) {
      g.t = Math.min(1, g.t + this.dt / GLIDE_S);
      // (set down, never tossed: out of a hand it slows as it lands; only a little lift over the way)
      const e = g.fromHand ? 1 - (1 - g.t) ** 3 : g.t * g.t * (3 - 2 * g.t);
      g.pos.lerpVectors(g.from, target, e);
      // (out of my hand: straight to where it's put – no hop)
      if (!g.fromHand) g.pos.y += Math.sin(Math.PI * g.t) * 0.035 * Math.min(1, g.from.distanceTo(target) * 1.5);
    } else g.pos.copy(target);
    return g.pos;
  }

  // ------------------------------------------------------------------ pots & pans

  updateVessels(view, dt) {
    const D = view.D;
    this.lastD = D;
    const seen = new Set();
    // vessels resting on the same counter / table share its spots
    const spotUse = new Map();
    if (D) {
      for (const [id, v] of Object.entries(D.vessels)) {
        const ov = this.work && this.work.ov.get(`v:${id}`);
        const kept = ov || (this.stashAt && this.stashAt.get(`v:${id}`));
        if (!v.at && !kept) continue;
        if (kept && kept.hidden) continue; // (in a shut cupboard)
        const F = v.at && this.k3.fx[v.at.fx];
        if (!F && !kept) continue;
        let p = null;
        const A = F ? F.anchors : {};
        // where it stands on its fixture (also while my hand is still setting it down there)
        let stand = null;
        if (!F) stand = null;
        else if (A.burners && (v.onHob || F.f.type === 'stove' || F.f.type === 'paellaBurner') && A.burners[v.at.slot]) stand = A.burners[v.at.slot];
        else if (A.mouth) stand = A.mouth;
        else if (A.inside) stand = A.inside; // on the oven's rack (it shows through the door's glass)
        else if (A.basin && F.f.type === 'sink') {
          stand = (A.spout || A.basin).clone().setY(A.basin.y + 0.02); // (right under the spout)
          const wv = this.work && this.work.washing && this.work.washing.fx === v.at.fx ? this.work.washing.vid : null;
          // (several in it, one being washed up: that one under the spout, the rest waiting on the worktop beside the sink)
          if (wv && wv !== id) stand = stand.clone().addScaledVector(new THREE.Vector3().crossVectors(UP, F.front).normalize(), -0.4).addScaledVector(F.front, 0.02).setY(COUNTER_H);
        }
        else if (F.f.type === 'fridge') stand = A.shelf; // chilling (behind the door)
        // (something big on a counter with its board stood up: in the middle, where the board lay)
        else if (A.bigSpot && VESSELS[v.kind] && VESSELS[v.kind].big && F.parts.board && F.parts.board.userData.posed > 0.5) stand = A.bigSpot;
        // (what a step here is working in – the tea glasses being stirred, the cups the foam goes into – stands on
        // the board, under my hands)
        else if (A.board && view.activeVessels && view.activeVessels.get(v.at.fx) === id) stand = A.board;
        // (put down just there by hand: stands there)
        else if (v.lay && v.lay.fx === v.at.fx && !A.burners && !A.basin) stand = new THREE.Vector3(v.lay.x, v.lay.y, v.lay.z);
        else if (A.spots) {
          const n = spotUse.get(v.at.fx) || 0; spotUse.set(v.at.fx, n + 1); stand = A.spots[Math.min(n, A.spots.length - 1)];
          // (a bowl / plate on the board – unless something's being worked on there)
          if (n === 0 && A.board && (v.kind === 'bowl' || v.kind === 'plate' || v.kind === 'blender') && !(view.activeAt && view.activeAt.has(v.at.fx))) stand = A.board;
        }
        else if (A.top) stand = A.top;
        // (in the dishwasher: put in at its door – and not to be seen once it's in)
        if (v.inDw && A.rack) stand = A.rack;
        // (my hand setting it down: it goes right to where it will stand, and lets go there)
        if (kept && stand && this.fpGripAt) for (const { r, i } of this.fpPuts(`v:${id}`)) { const gp = this.fpGripAt(`v:${id}`, i, stand, 0); if (gp) { r.world = gp.world; if (gp.aimAt) r.aimAt = gp.aimAt; } }
        const pk = this.parkedAt && this.parkedAt.get(`v:${id}`);
        if (pk && (kept || !F || v.at.fx !== pk.fx || v.at.slot !== pk.slot)) this.parkedAt.delete(`v:${id}`);
        else if (pk && !ov) stand = pk.pos;
        p = kept ? kept.pos : stand;
        if (!p || (!kept && v.inDw)) continue;
        seen.add(id);
        let rec = this.vessels.get(id);
        if (!rec || rec.kind !== v.kind) {
          if (rec) this.dynamic.remove(rec.group);
          rec = buildVessel(v.kind);
          this.vessels.set(id, rec);
          this.dynamic.add(rec.group);
        }
        rec.group.position.copy(this.glide(`v:${id}`, kept ? kept.sig : `a:${v.at.fx}:${v.at.slot}:${v.onHob ? 1 : 0}`, p));
        const laid = !kept && v.lay && v.lay.fx === v.at.fx && v.lay.yaw != null ? v.lay.yaw : null; // (put down by hand: as it was in the hand)
        rec.group.rotation.set(0, ov && ov.yaw != null ? ov.yaw : kept && kept.yaw != null ? kept.yaw : pk && !ov && this.parkedAt.has(`v:${id}`) ? pk.yaw : laid != null ? laid : F && F.f.type === 'sink' && !kept ? this.sinkYaw(F) : 0, 0);
        rec.group.scale.setScalar(ov || (kept && kept.fp) ? 1 : kept && kept.held ? 0.85 : kept ? 0.8 : 1);
        // (at work, first person: tipped to pour, tossed …)
        if (ov && ov.tilt) rec.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(ov.axis, ov.tilt));
        if (ov) { rec.group.position.copy(ov.pos); this.glides.set(`v:${id}`, { sig: 'work', pos: ov.pos.clone(), from: null, t: 1 }); }
        // (a pot with a lid of its own keeps it on while it's put away – in a cupboard, on the pantry's shelf – and
        // while it's carried empty; it comes off as the pot's set down to cook)
        const empty = !(v.contents && v.contents.length) && !(v.water > 0.05) && !(v.items && v.items.length) && !v.dirty;
        rec.stowed = rec.ownLid && !ov && !!kept && (kept.stored || !!kept.place || ((kept.held || kept.fp) && empty));
        // (washed up freehand: its water tipped out first – what's stuck to its floor to be seen, scrubbed off)
        const wl = this.work && this.work.washing && this.work.washing.vid === id ? this.work.washing : null;
        const vmask = wl && wl.mask && !wl.mask.board ? wl.mask : null;
        updateVessel(rec, vmask ? { ...v, water: 0, contents: [] } : v, this.t, this.firstPerson);
        if (this.work && this.work.lid && this.work.lid.vid === id) { rec.lid.visible = false; rec.towel.visible = false; }
        // dirty: a smear of what was in it (going as it's scrubbed) – and the suds while it's washed
        if (vmask) { const fl = this.vesselFloor(rec); this.cleanLayer(rec.group, vmask, () => new THREE.CircleGeometry(fl.r, 40), fl.y + 0.002); }
        else if (rec.group.userData.cleanLayer) rec.group.userData.cleanLayer.visible = false;
        const grime = v.dirty && !rec.liquid.visible && !v.lid && !vmask ? (wl ? wl.dirt : 1) : 0;
        if (grime > 0.02) { rec.liquid.visible = true; rec.liquid.position.y = 0.012; rec.liquid.material.color.set('#7a5232'); rec.liquid.material.opacity = 0.4 * grime; }
        if (wl && wl.suds > 0.05 && !vmask) rec.bubbles.forEach((b, i) => { b.visible = true; b.position.set(Math.cos(i * 2.1) * rec.r * 0.55, 0.02 + (i % 2) * 0.008, Math.sin(i * 2.1) * rec.r * 0.55); b.scale.setScalar(1.2 + wl.suds * 1.5); });
        // first person: what's in it, in 3D (what's runny is its surface)
        rec.inside = this.firstPerson && !v.lid ? Object.entries(D.items).filter(([, it]) => it.in === id && !it.hidden && solidIn(it, v)) : null;
        if (v.boil > 0.25 && Math.random() < v.boil * dt * 25) this.puff(p.clone().setY(p.y + rec.h), 'steam');
        if (v.heat > 0 && (v.kind === 'pan' || v.kind === 'paellaPan') && v.contents && v.contents.length && Math.random() < dt * 12) this.puff(p.clone().setY(p.y + 0.05), 'sizzle');
        // food lying on trays / plates
        rec.items = (v.items || []).map((i) => ({ id: i.id, st: D.items[i.id] }));
      }
    }
    for (const [id, rec] of this.vessels) if (!seen.has(id)) rec.group.visible = false; else rec.group.visible = true;
    this.spotsTaken = spotUse; // (the food there takes the spots after these)
    this.updateTemps(D, dt);
  }

  // How hot things are – a tag with its temperature on anything hot. (Worked
  // out here from the heat: a pan on the flame climbs to its setting's
  // temperature, water follows its boil to 100 °C, an oven is at its heat;
  // off the heat it cools back down.)
  updateTemps(D, dt) {
    this.temps = this.temps || new Map();
    this.tempTags = this.tempTags || new Map();
    const shown = new Set();
    for (const [id, v] of Object.entries((D && D.vessels) || {})) {
      const F = v.at && this.k3.fx[v.at.fx];
      const oven = !!F && v.heat > 0 && !v.onHob && !!F.anchors.inside;
      const wet = v.water > 0.05 && !oven;
      let want = 20;
      if (v.heat > 0 && v.at) want = oven ? (['pizzaOven', 'stoneOven', 'tandoor'].includes(F.f.type) ? 400 : 220) : wet ? 20 + 80 * Math.min(1, (v.boil || 0) / 0.35) : [20, 140, 180, 230][Math.min(3, v.heat)];
      const t0 = this.temps.get(id) ?? want; // (first seen: already as hot as it should be)
      const rate = wet ? 3 : want > t0 ? 0.09 : 0.025;
      const t1 = t0 + (want - t0) * Math.min(1, dt * rate);
      this.temps.set(id, t1);
      if (t1 < 45) continue;
      const rec = this.vessels.get(id);
      let at = null;
      if (rec && rec.group.visible) {
        // (over its far rim, so it never covers what's in it)
        const away = rec.group.position.clone().sub(this.camera.position).setY(0);
        if (away.lengthSq() > 1e-6) away.normalize();
        at = rec.group.position.clone().addScaledVector(away, this.firstPerson ? rec.r * 1.15 : 0).addScaledVector(UP, rec.h + (this.firstPerson ? 0.04 : 0.2));
      }
      else if (oven) at = F.anchors.inside.clone().addScaledVector(F.front, 0.38).addScaledVector(UP, 0.22);
      if (!at) continue;
      const tag = this.tempTag(`v:${id}`, t1);
      tag.position.copy(at);
      const k = this.firstPerson ? 0.07 : 0.3;
      tag.scale.set(k, k * 56 / 160, 1);
      tag.visible = true;
      shown.add(`v:${id}`);
    }
    for (const [key, tag] of this.tempTags) if (!shown.has(key)) tag.visible = false;
  }
  tempTag(key, t) {
    let tag = this.tempTags.get(key);
    if (!tag) {
      tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
      tag.renderOrder = 12;
      this.scene.add(tag);
      this.tempTags.set(key, tag);
    }
    const c = Math.round(t / 5) * 5;
    if (tag.userData.c !== c) { tag.userData.c = c; tag.material.map = tempTexture(c); tag.material.needsUpdate = true; }
    return tag;
  }

  // ------------------------------------------------------------------ food on the boards (2D drawings as standees)

  spriteFor(kind, st, cut) {
    // (the key of an item's look is worked out once per state object)
    let key = cut ? `p|${kind}|${cut}` : st && this.lookKeys.get(st);
    if (!key) {
      key = `i|${kind}|${JSON.stringify(st, ['qty', 'washed', 'peeled', 'cut', 'k', 'n', 'cook', 'shape', 'size', 'sauce', 'coverage', 'toppings', 'x', 'y', 'kind', 'boiled', 'cored', 'rolls', 'stuffed', 'form'])}`;
      if (st && typeof st === 'object') this.lookKeys.set(st, key);
    }
    let tex = this.spriteTex.get(key);
    if (!tex) {
      if (this.spriteTex.size > 300) { for (const t of this.spriteTex.values()) t.dispose(); this.spriteTex.clear(); }
      const c = document.createElement('canvas');
      c.width = c.height = 192;
      const g = c.getContext('2d');
      try {
        if (cut) drawPieces(g, kind, cut, 7, 96, 170, 0.7, 3);
        else drawIngredient(g, kind, st, 96, 170, 0.9, 0);
      } catch { /* the art never throws, but be safe */ }
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.spriteTex.set(key, tex);
    }
    return tex;
  }

  placeSprite(slot, tex, pos, size = 0.3) {
    let s = this.sprites.get(slot);
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.center.set(0.5, 0.1);
      this.sprites.set(slot, s);
      this.dynamic.add(s);
    }
    if (s.material.map !== tex) { s.material.map = tex; s.material.needsUpdate = true; }
    s.position.copy(pos);
    s.scale.set(size, size, 1);
    s.visible = true;
    s.userData.seen = this.t;
  }

  // first person: a food in 3D at a slot (rebuilt only when its look changes) – in
  // its container if it has one and box is given ({of: the thing, water 0..1, tilt,
  // axis; empty: the container alone})
  placeFood(slot, kind, st, pos, yaw = 0, box = null, scale = 1) {
    const boxed = !!box && boxable(kind);
    const sp = boxed ? boxSpec(kind, box.of || st) : null;
    const key = (boxed && box.empty ? `${kind}|empty` : foodKey(kind, st)) + (boxed ? `|box${sp.size}${sp.style}` : '');
    let f = this.foods.get(slot);
    if (!f || f.key !== key) {
      if (f) this.dynamic.remove(f.g);
      if (boxed) { const bf = boxedFood(kind, box.empty ? null : st, box.of || st); f = { key, g: bf.g, setWater: bf.setWater }; } else f = { key, g: buildFood(kind, st) };
      f.cuts = hasCuts(f.g);
      this.foods.set(slot, f);
      this.dynamic.add(f.g);
    }
    f.g.position.copy(pos);
    f.g.rotation.set(0, yaw, 0);
    f.g.scale.setScalar(scale || 1);
    if (boxed && box.tilt) f.g.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(box.axis || UP, box.tilt));
    if (f.setWater) f.setWater(boxed ? box.water || 0 : 0);
    if (f.cuts) syncCuts(f.g);
    f.g.visible = true;
  }

  updateItems(view) {
    const D = view.D;
    if (!D) { for (const s of this.sprites.values()) s.visible = false; for (const f of this.foods.values()) f.g.visible = false; return; }
    const used = new Set();
    const show = (slot, tex, pos, size) => { this.placeSprite(slot, tex, pos, size); used.add(slot); };
    // first person: the food itself, in 3D (the room view keeps its cartoon standees)
    const fp = this.firstPerson;
    const usedFood = new Set();
    const food = (slot, kind, st, pos, yaw = 0, box = null, scale = 1) => { this.placeFood(slot, kind, st, pos, yaw, box, scale); usedFood.add(slot); };
    const put = (slot, kind, st, tex, pos, size, yaw = 0, box = null, scale = 1) => (fp ? food(slot, kind, st, pos, yaw, box, scale) : show(slot, tex(), pos, size));
    const yawAt = (fxId) => { const F = fxId && this.k3.fx[fxId]; return F ? Math.atan2(F.front.x, F.front.z) : 0; };
    // what's being worked on, and prepped piles waiting
    const perFx = new Map();
    for (const [id, it] of Object.entries(D.items)) {
      if (it.hidden || it.in) continue;
      const ov = this.work && this.work.ov.get(`i:${id}`);
      // (at work: on the board out of its container – which stands beside it; in it, under the tap, being tipped into the pan)
      if (ov) {
        if (ov.hide) continue;
        put(`item:${id}`, it.kind, ov.st ? { ...it, ...ov.st } : it, () => this.spriteFor(it.kind, it), ov.pos, ov.size || 0.2, ov.yaw ?? (this.work.yaw || 0), ov.box ? { ...ov.box, of: it } : null, ov.scale);
        if (fp && ov.q) this.foods.get(`item:${id}`).g.quaternion.premultiply(ov.q);
        // (where it is now, for where it goes next to glide from – not where it was before the work)
        this.glides.set(`i:${id}`, { sig: 'work', pos: ov.pos.clone(), from: null, t: 1 });
        continue;
      }
      // (gathered into its container beside the board: it stays just there till it's taken)
      const bx = this.boxedAt && this.boxedAt.get(id);
      if (bx && it.at !== bx.fx) this.boxedAt.delete(id);
      // where it lies on a counter, the sink, a table … (its spot there)
      const lie = () => {
        if (it.used && !it.at) return null;
        const fxId = it.at || (view.activeItems && view.activeItems.get(id));
        const F = fxId && this.k3.fx[fxId];
        if (!F || F.anchors.shelfL) return null;
        if (bx && bx.fx === fxId) return { pos: bx.pos, fxId, active: false };
        const active0 = view.activeAt && view.activeAt.get(fxId) === id;
        // (put down just there by hand: lies there)
        if (it.lay && it.lay.fx === fxId && !(active0 && F.anchors.board)) return { pos: new THREE.Vector3(it.lay.x, it.lay.y, it.lay.z), fxId, active: active0, yaw: it.lay.yaw };
        const n = perFx.get(fxId) || 0;
        perFx.set(fxId, n + 1);
        const A = F.anchors;
        const active = view.activeAt && view.activeAt.get(fxId) === id;
        const taken = (this.spotsTaken && this.spotsTaken.get(fxId)) || 0;
        const pos = active && A.board ? A.board : A.spots ? A.spots[(n + taken) % A.spots.length] : A.top;
        return pos ? { pos, fxId, active } : null;
      };
      const kept = this.stashAt && this.stashAt.get(`i:${id}`);
      if (kept && kept.hidden) continue; // (in a shut cupboard)
      if (kept) {
        // in the fridge / on the shelf, or in someone's hands – in its container
        // (my hand setting it down on a counter: it goes right to the spot it will lie on)
        const r = it.at && this.fpPutting(`i:${id}`);
        const L = r && lie();
        if (L) r.world = L.pos.clone().addScaledVector(UP, 0.01);
        put(`item:${id}`, it.kind, it, () => this.spriteFor(it.kind, it), this.glide(`i:${id}`, kept.sig, kept.pos), kept.fp ? kept.size : kept.held ? 0.2 : 0.17, kept.yaw || 0, { of: it });
        continue;
      }
      const pk = this.parkedAt && this.parkedAt.get(`i:${id}`);
      if (pk && it.at !== pk.fx) this.parkedAt.delete(`i:${id}`);
      else if (pk) {
        put(`item:${id}`, it.kind, it, () => this.spriteFor(it.kind, it), this.glide(`i:${id}`, `p:${pk.fx}`, pk.pos), 0.24, pk.yaw, null, pk.scale);
        continue;
      }
      const L = lie();
      if (!L) continue;
      const { pos, fxId, active, yaw: laidYaw } = L;
      const done = it.cut && (it.k || 0) >= (it.n || 0);
      const tex = () => (done && !active ? this.spriteFor(it.kind, null, it.cut) : this.spriteFor(it.kind, it));
      const at = this.glide(`i:${id}`, `a:${fxId}`, pos), g = this.glides.get(`i:${id}`);
      const size = active ? 0.34 : 0.24;
      put(`item:${id}`, it.kind, done && !active ? { cut: it.cut, k: it.n, n: it.n, cook: it.cook } : it, tex, at, g.fromHand && g.t < 1 ? 0.1 + (size - 0.1) * g.t * g.t * (3 - 2 * g.t) : size, laidYaw ?? yawAt(fxId), active ? null : { of: it });
    }
    // at work: the containers of what's out on the board, standing beside it, empty
    if (fp && this.work) for (const [k, b] of this.work.boxes || []) {
      const it = D.items[k];
      if (it && boxable(it.kind)) food(`box:${k}`, it.kind, b.st || null, b.pos, b.yaw, { of: b.of || it, empty: !b.st, tilt: b.tilt, axis: b.axis });
    }
    // the empty food containers set down on the stove after their food was tipped into the pot –
    // nested in each other, the smaller inside the bigger
    for (const [fxId, s] of Object.entries((view.C && view.C.fx) || {})) {
      const F = s.empties && s.empties.length && this.k3.fx[fxId];
      if (!F) continue;
      const A = F.anchors, top = A.top || A.board || (A.burners && A.burners[0]) || (A.spots && A.spots[0]);
      const spot = F.src.localToWorld(v3(0, 0, 0.42)).setY(top ? top.y : COUNTER_H); // (the front middle of its top: clear of the burners and what's on them)
      const list = s.empties.map((id) => [id, D.items[id]]).filter(([, it]) => it && boxable(it.kind));
      list.sort((a, b) => boxSpec(b[1].kind, b[1]).size - boxSpec(a[1].kind, a[1]).size);
      list.forEach(([id, it], i) => food(`empty:${fxId}:${id}`, it.kind, null, spot.clone().setY(spot.y + i * 0.004), yawAt(fxId), { of: it, empty: true }));
    }
    // at work (first person): what's in my hand that isn't a thing of its own (an egg to crack, a topping, a spoonful)
    if (this.work) this.work.sprites.forEach((q, i) => { put(`work:${i}`, q.kind, q.st, () => q.tex, q.pos, q.size, q.yaw ?? (this.work.yaw || 0)); if (fp && q.q && this.foods.get(`work:${i}`)) this.foods.get(`work:${i}`).g.quaternion.premultiply(q.q); });
    // food on trays and plates
    for (const [vid, rec] of this.vessels) {
      if (!rec.group.visible || !rec.items) continue;
      rec.items.forEach((i, k) => {
        if (!i.st) return;
        // (in 3D it lies on the tray / plate itself)
        const at = fp ? rec.group.position.clone().add(v3((k - (rec.items.length - 1) / 2) * 0.07, rec.h + 0.002, 0)) : rec.group.position.clone().add(v3((k - (rec.items.length - 1) / 2) * 0.12, rec.h * 0.6, 0));
        put(`on:${vid}:${k}`, i.st.kind, i.st, () => this.spriteFor(i.st.kind, i.st), at, 0.28, rec.group.rotation.y);
      });
    }
    // first person: what's in the pots and pans, in 3D – scattered over the floor
    if (fp) {
      for (const [vid, rec] of this.vessels) {
        if (!rec.group.visible || !rec.inside || !rec.inside.length) continue;
        const spread = Math.round(rec.r * 0.62 * 1000) / 1000;
        const v = D.vessels[vid];
        // (whisked: the eggs beaten, turn by turn – the rest stirred into a batter; mashed, blended: going into
        // the purée, the soup; in a pan with little water in it: browning as it fries; stirred round: turned
        // round with the spoon, and left where it went)
        const mix = v ? Math.min(1, v.mixed || 0) : 0, smooth = v ? Math.min(1, v.smooth || 0) : 0;
        const fry = v && !(v.water > 0.05) && v.cook > 0 ? v.cook : 0;
        const spin = (this.spins.get(vid) || { a: 0 }).a;
        rec.inside.forEach(([iid, it], k) => {
          // (the pot knows how it went in: an egg cracked into it, not dropped in whole)
          const c = v && v.contents.find((q) => q.kind === it.kind);
          let cut = (c && c.cut) || it.cut;
          const egg = cut === 'cracked' || cut === 'beaten';
          if (cut === 'cracked' && mix >= 1) cut = 'beaten';
          const melt = egg ? smooth : Math.max(smooth, mix);
          if (melt >= 0.999) return; // (all in the purée, the batter)
          const pos = rec.group.localToWorld(v3(Math.cos(k * 2.4 + spin) * rec.r * 0.1, 0.01 + k * 0.002, Math.sin(k * 2.4 + spin) * rec.r * 0.1));
          const sts = { ...it, cut, spread, ...(egg && mix > 0 ? { mix: Math.round(mix * 12) / 12 } : {}), ...(fry > 0 && Math.min(1, fry * 2) > (it.cook || 0) ? { cook: Math.round(Math.min(1, fry * 2) * 10) / 10 } : {}) }; // (fried in fat it colours quicker than it cooks through)
          food(`in:${vid}:${iid}`, it.kind, sts, pos, rec.group.rotation.y + k * 1.1 - spin, null, 1 - 0.7 * melt);
          const fg = this.foods.get(`in:${vid}:${iid}`);
          if (fg && melt > 0) fg.g.scale.y *= 1 - 0.5 * melt; // (pressed down into it, sinking)
        });
      }
    }
    // scraps on counters
    const C = view.C;
    if (C && C.scraps) for (const [fxId, sc] of Object.entries(C.scraps)) {
      if (!sc || !sc.n) continue;
      const F = this.k3.fx[fxId];
      if (!F || !F.anchors.scraps) continue;
      const kind = sc.kinds[sc.kinds.length - 1] || 'onion';
      const skin = { egg: '#e3c49c', onion: '#c98a3c', potato: '#c49a5c', carrot: '#f08a24', tomato: '#4f9a3a', garlic: '#f1ead9' }[kind] || '#c98a3c';
      put(`scraps:${fxId}`, { type: 'scraps', c1: skin, n: Math.min(6, sc.n) }, {}, () => this.scrapTex(kind, sc.n), F.anchors.scraps, 0.16 + Math.min(4, sc.n) * 0.02, yawAt(fxId));
    }
    for (const [slot, s] of this.sprites) if (!used.has(slot)) s.visible = false;
    for (const [slot, f] of this.foods) if (!usedFood.has(slot)) f.g.visible = false;
  }

  scrapTex(kind, n) {
    const key = `scraps|${kind}|${Math.min(6, n)}`;
    let tex = this.spriteTex.get(key);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const g = c.getContext('2d');
      const cols = { egg: '#e3c49c', onion: '#c98a3c', potato: '#c49a5c', carrot: '#f08a24', tomato: '#4f9a3a', garlic: '#f1ead9' };
      for (let i = 0; i < Math.min(6, n) * 3; i++) {
        g.save(); g.translate(20 + (i * 37) % 56, 60 + (i * 23) % 26); g.rotate(i * 1.3);
        g.fillStyle = cols[kind] || ['#c98a3c', '#7ab05a', '#e8c88a'][i % 3];
        g.strokeStyle = '#3d2a24'; g.lineWidth = 2;
        g.beginPath(); g.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
      }
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.spriteTex.set(key, tex);
    }
    return tex;
  }

  // ------------------------------------------------------------------ cooks

  updateCooks(view, dt) {
    const seen = new Set();
    for (const c of view.cooks) {
      seen.add(c.id);
      const key = JSON.stringify(c.avatar);
      let rec = this.cooks.get(c.id);
      if (!rec || rec.key !== key) {
        if (rec) { this.scene.remove(rec.fig); disposeTree(rec.fig); }
        rec = { fig: buildCook(c.avatar), key, yaw: c.yaw || 0 };
        this.cooks.set(c.id, rec);
        this.scene.add(rec.fig);
      }
      // how fast they really move (the walk cycle keeps pace with it); a jump is a teleport
      const moved = rec.px === undefined ? 0 : Math.hypot(c.x - rec.px, c.y - rec.py);
      const v = dt > 0 && moved < 1 ? moved / dt : 0;
      rec.speed = rec.speed === undefined ? v : rec.speed + (v - rec.speed) * (1 - Math.exp(-dt * 14));
      rec.px = c.x; rec.py = c.y;
      rec.fig.position.set(c.x, 0, c.y);
      // turn smoothly towards the wanted heading
      let d = (c.yaw || 0) - rec.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const turn = d * (1 - Math.exp(-dt * 12));
      rec.yaw += turn;
      rec.fig.rotation.y = rec.yaw;
      // what they hold changed: they reached out to take it / put it down
      const holding = c.holding || [];
      const hsig = `${holding.join(',')}|${c.carry ? c.carry.n : 0}`;
      if (rec.hsig !== undefined && rec.hsig !== hsig) rec.reachT = 0;
      rec.hsig = hsig;
      if (rec.reachT !== undefined) rec.reachT += dt;
      const reach = rec.reachT !== undefined && rec.reachT < REACH_S ? Math.sin(Math.PI * rec.reachT / REACH_S) : 0;
      const vk = holding.find((k) => k[0] === 'v');
      const vkind = vk && view.D && view.D.vessels[vk.slice(2)] ? view.D.vessels[vk.slice(2)].kind : null;
      const hold = vk ? (GRIP3D[vkind] || !twoHanded(vkind) ? 'handle' : 'both') : holding.length ? 'items' : null;
      // a counter just in front: lift what's carried up over it
      const lift = holding.length && !c.work && this.lowFixtureAt(c.x + Math.sin(rec.yaw) * 0.42, c.y + Math.cos(rec.yaw) * 0.42) ? 1 : 0;
      poseCook(rec.fig, { speed: rec.speed, turn: dt > 0 ? turn / dt : 0, work: c.work, carry: !!c.carry || holding.length > 0, hold, reach, lift, scraps: !!c.carry, t: this.t + c.id * 1.7 }, dt);
      rec.fig.updateMatrixWorld(true);
      rec.hands = rec.fig.userData.carry.getWorldPosition(rec.hands || new THREE.Vector3());
      rec.rightHand = rec.fig.userData.hands[1].getWorldPosition(rec.rightHand || new THREE.Vector3());
      rec.holding = holding.length ? holding : null;
      rec.holdKind = vkind;
      rec.id = c.id;
      // first person: I don't see myself; otherwise, see-through while in front of what I'm looking at
      rec.fig.visible = !(c.me && this.firstPerson);
      fadeCook(rec.fig, this.blocksView(c, view) ? 0.28 : 1, dt);
    }
    for (const [id, rec] of this.cooks) if (!seen.has(id)) { this.scene.remove(rec.fig); disposeTree(rec.fig); this.cooks.delete(id); }
  }

  // A counter-high fixture (not a tall fridge / pantry / oven dome) on the floor square at x, z.
  lowFixtureAt(x, z) {
    const K = this.K;
    const tx = Math.floor(x), ty = Math.floor(z);
    if (!K || tx < 0 || ty < 0 || tx >= K.w || ty >= K.h || !K.solid[ty][tx]) return null;
    const f = K.fixtures.find((q) => tx >= q.x && tx < q.x + q.w && ty >= q.y && ty < q.y + q.h);
    return f && !['fridge', 'shelf', 'pizzaOven', 'stoneOven', 'tandoor', 'plant'].includes(f.type) ? f : null;
  }
  // Where a hand could lie flat at x, z: the worktop's height there – on a counter, a sink's rim,
  // a table (the stove's top: hot) – or null (the basin, a burner, the chopping board, no bench).
  benchAt(x, z, board = false) {
    const f = this.lowFixtureAt(x, z);
    if (!f || !BENCHES.includes(f.type)) return null;
    const F = this.k3.fx[f.id], A = F.anchors;
    const dx = x - (f.x + f.w / 2), dz = z - (f.y + f.h / 2);
    const lx = f.face === 'e' ? -dz : dx, lz = f.face === 'e' ? dx : dz; // (in its own frame: front +z)
    if (f.type === 'sink' && Math.abs(lx) < 0.33 && Math.abs(lz) < 0.29) return null;
    if (A.burners && A.burners.some((b) => Math.hypot(b.x - x, b.z - z) < 0.19)) return null;
    const near = f.type !== 'table' && A.board && Math.abs(lx) < 0.31 && lz > -0.03 && lz < 0.43;
    if (near && !board) return null;
    // (on the board itself: its top – or right at its edge, neither)
    const on = near && Math.abs(lx) < 0.25 && lz > 0.03 && lz < 0.37;
    if (near && !on) return null;
    return { y: on ? A.board.y : A.top ? A.top.y : COUNTER_H, hot: f.type === 'stove' };
  }
  // what stands on the worktops near p, for a resting hand to keep clear of: [{p, r}]
  benchClutter(p, extra = []) {
    const out = [...extra], near = (q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.4;
    const onTop = (q) => q.y > COUNTER_H - 0.05 && q.y < COUNTER_H + 0.35; // (not one in a cupboard)
    for (const rec of this.vessels.values()) if (rec.group.visible && near(rec.group.position) && onTop(rec.group.position)) out.push({ p: rec.group.position, r: rec.r + 0.01 });
    for (const rec of this.tools.values()) if (rec.g.visible && near(rec.g.position) && onTop(rec.g.position)) out.push({ p: rec.g.position, r: 0.07 });
    for (const f of this.foods.values()) if (f.g.visible && near(f.g.position)) out.push({ p: f.g.position, r: 0.08 });
    for (const sp of this.sprites.values()) if (sp.visible && near(sp.position)) out.push({ p: sp.position, r: 0.06 });
    for (const F of Object.values(this.k3.fx)) {
      const P = F.parts, A = F.anchors;
      for (const o of [P.soap, P.sponge, ...(P.tools ? Object.values(P.tools) : [])]) if (o && o.visible && near(o.position)) out.push({ p: o.position, r: 0.07 });
      if (A.nest && near(A.nest)) out.push({ p: A.nest, r: 0.12 });
      for (const c of [...(A.crock ? [A.crock[0]] : []), ...(A.corner || [])]) if (near(c)) out.push({ p: c, r: 0.09 });
    }
    return out;
  }
  // What my idle hands feel like doing for a while (half a minute to two, then picked again at random): rest on
  // the worktop – both, just the left, just the right – or neither, hanging at my sides as I stand;
  // how relaxed the fingers are, and (standing at a counter) a little where.
  idleMood() {
    const M = this.mood;
    if (M && this.t < M.until) return M;
    const r = Math.random();
    const rest = r < 0.4 ? [true, true] : r < 0.6 ? [true, false] : r < 0.8 ? [false, true] : [false, false];
    const pick = (a, b) => a + Math.random() * (b - a);
    this.mood = { id: (M ? M.id : 0) + 1, until: this.t + pick(30, 120), rest, curl: [pick(0.05, 0.35), pick(0.05, 0.35)], pref: [0, 1].map(() => ({ f: pick(0.05, 0.16), o: pick(0.06, 0.2) * APART })) };
    return this.mood;
  }
  // Where my idle hands rest: flat on a worktop near its edge, as I stand – a little out from each
  // shoulder and forward, the arm coming down to it (not bent over to lay the forearm on it); clear
  // of what stands there (and of the work, at O – and its board). body: my eyes {pos, fwd} (my
  // shoulders level below them); reach: how far from the shoulder. [left, right]: {w, dir} or null
  // (dir: about the fingers' way – the arm sets it exactly, in line with the forearm).
  // pref: [left, right] {f, o} – how far forward and out from the shoulder it'd best be.
  benchRest(body, { O = null, clutter = [], reach: most = 0.4, board = false, pref = null } = {}) {
    const fwd = body.fwd.clone().setY(0).normalize(), right = new THREE.Vector3().crossVectors(fwd, UP);
    const things = this.benchClutter(body.pos, clutter);
    const on = (q, y) => { const b = this.benchAt(q.x, q.z, board); return !!b && Math.abs(b.y - y) < 0.01; };
    const clear = (q, r) => !(O && Math.hypot(q.x - O.x, q.z - O.z) < 0.16) && !things.some((t) => Math.abs(t.p.y - q.y) < 0.2 && Math.hypot(t.p.x - q.x, t.p.z - q.z) < t.r + r);
    // (how far in from the worktop's near edge – toward me – a point is)
    const inFrom = (q, y) => { for (let k = 0.02; k < 0.6; k += 0.02) if (!on(q.clone().addScaledVector(fwd, -k), y)) return k; return 0.6; };
    return [-1, 1].map((s) => {
      const sh = body.pos.clone().addScaledVector(right, s * SHOULDER.x).addScaledVector(UP, SHOULDER.y).addScaledVector(fwd, -SHOULDER.z);
      const want = (pref && pref[s < 0 ? 0 : 1]) || { f: 0.1, o: 0.12 * APART };
      let best = null, cost = Infinity;
      for (let f = -0.02; f <= most + 0.001; f += 0.02) for (let o = -0.1; o <= 0.401; o += 0.02) {
        const P = sh.clone().addScaledVector(fwd, f).addScaledVector(right, s * o);
        const b = this.benchAt(P.x, P.z, board);
        if (!b) continue;
        P.y = b.y;
        const reach = P.distanceTo(sh), d = P.clone().sub(sh).setY(0);
        if (reach > most || sh.y - P.y < 0.06) continue;
        if (d.lengthSq() < 1e-4) d.copy(fwd);
        d.normalize().applyAxisAngle(UP, s * REST_TURN);
        // (the whole hand on it, fingertips to wrist, and clear of everything)
        const tip = P.clone().addScaledVector(d, 0.05), wr = P.clone().addScaledVector(d, -0.045);
        if (!on(tip, b.y) || !on(wr, b.y) || !clear(P, 0.04) || !clear(tip, 0.035)) continue;
        const c = Math.abs(inFrom(wr, b.y) - REST_EDGE) * 2 + Math.hypot(f - want.f, o - want.o) + Math.max(0, reach - 0.33) * 3 + (b.hot ? 0.25 : 0);
        if (c < cost) { cost = c; best = { w: P, dir: d }; }
      }
      return best;
    });
  }
  // The camera at work, moved sideways to have pts in the middle (as far as side), then drawn back
  // along its view far enough to see them all (as far as max).
  fitCam(cam, pts, max = 0.6, side = 0.16) {
    const dir = cam.look.clone().sub(cam.pos).normalize();
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize(), up = new THREE.Vector3().crossVectors(right, dir);
    // (the view's centred in what the panels leave free – only that much of it is seen)
    const ins = this.insets || { left: 0, bottom: 0, top: 0 }, cw = this.canvas.clientWidth || 1, ch = this.canvas.clientHeight || 1;
    const tv0 = Math.tan(THREE.MathUtils.degToRad(WORK_FOV / 2)) * 0.88;
    const th = tv0 * Math.max(0.4, cw / ch) * Math.max(0.3, (cw - ins.left) / cw), tv = tv0 * Math.max(0.3, (ch - ins.top - ins.bottom) / ch);
    const xs = pts.map((p) => { const r = p.clone().sub(cam.pos); return r.dot(right) / Math.max(0.05, r.dot(dir)); });
    const dl = cam.look.clone().sub(cam.pos).length();
    const dx = Math.max(-side, Math.min(side, ((Math.max(...xs) + Math.min(...xs)) / 2) * dl));
    cam.pos.addScaledVector(right, dx); cam.look.addScaledVector(right, dx);
    let t = 0;
    for (const p of pts) {
      const r = p.clone().sub(cam.pos), d = r.dot(dir);
      t = Math.max(t, Math.abs(r.dot(right)) / th - d, Math.abs(r.dot(up)) / tv - d);
    }
    cam.pos.addScaledVector(dir, -Math.min(t, max));
    return cam;
  }
  // A carried thing never sinks into a counter: over one, it's at least at the worktop.
  aboveCounter(p, r = 0.08) {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (this.lowFixtureAt(p.x + dx, p.z + dz)) { if (p.y < COUNTER_H + 0.012) p.y = COUNTER_H + 0.012; break; }
    }
    return p;
  }

  // First person: my own arms. Each thing stays in the hand that took it (a
  // pot takes both); a new one is reached for where it lay, and one put down
  // is carried to where it goes and let go there.
  updateArms(view, dt) {
    const me = view.cooks.find((c) => c.me);
    const rec = me && this.cooks.get(me.id);
    const D = view.D;
    const on = this.firstPerson && !!rec && (!view.working || !!this.work);
    this.fpOn = on;
    this.fpMe = me && me.id;
    const holding = (rec && rec.holding) || [];
    const vk = (k) => (k && k[0] === 'v' && D && D.vessels[k.slice(2)] ? D.vessels[k.slice(2)].kind : null);
    // (food in its container: carried on the palm, out at the waist)
    const holdOf = (k) => { if (k[0] === 'u') return 'tool'; const kd = vk(k); if (!kd) { const it = k[0] === 'i' && D && D.items[k.slice(2)]; return it && boxable(it.kind) ? 'tub' : 'palm'; } return twoHanded(kd) ? 'side' : GRIP3D[kd] ? 'handle' : 'palm'; };
    const slots = this.fpSlots, came = [], gone = [];
    for (let i = 0; i < 2; i++) if (slots[i] && !holding.includes(slots[i])) { gone.push([i, slots[i]]); slots[i] = null; }
    for (const k of holding) {
      if (slots.includes(k)) continue;
      const h = holdOf(k);
      this.fpHold.set(k, h);
      const want = this.fpWant.get(k);
      this.fpWant.delete(k);
      const M = this.mainHand;
      if (h === 'side') { slots[0] = slots[1] = k; came.push([0, k], [1, k]); } else { const i = want != null && slots[want] == null ? want : slots[M] == null ? M : 1 - M; slots[i] = k; came.push([i, k]); }
    }
    if (!on) { this.restLean = false; this.fpArms.cancel(); this.fpArms.update(dt, [null, null], { visible: false }); return; }
    this.fpArms.setLook(lookOf(me.avatar));
    this.fpArms.setGloves(!!(view.C && glovesOn(view.C, me.id)));
    const right = new THREE.Vector3(-Math.cos(rec.yaw), 0, Math.sin(rec.yaw));
    // where a hand takes hold of a thing lying at base (yaw: how it lies)
    const gripAt = (k, i, base, yaw) => {
      const h = this.fpHold.get(k) || 'palm', vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
      if (h === 'handle') {
        const g = GRIP3D[vk(k)], c = Math.cos(yaw), sn = Math.sin(yaw);
        const off = new THREE.Vector3(g.x * c + g.z * sn, g.y, -g.x * sn + g.z * c);
        return { world: base.clone().add(off), aimAt: off.clone().setY(0).negate().normalize() };
      }
      if (h === 'side') return { world: base.clone().add(right.clone().multiplyScalar((i ? 1 : -1) * ((vr ? vr.r : 0.13) + 0.035))).setY(base.y + (vr ? vr.h * 0.8 : 0.1)) };
      return { world: base.clone().setY(base.y + (vr ? vr.h * 0.5 : 0.04)) };
    };
    this.fpGripAt = gripAt;
    for (const [i, k] of came) {
      const g = this.glides.get(k);
      if (!g) continue;
      const vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
      const yaw = vr ? vr.group.rotation.y : 0;
      this.fpArms.reach(i, { key: k, take: true, hold: this.fpHold.get(k), src: g.pos.clone(), srcYaw: yaw, ...gripAt(k, i, g.pos, yaw) });
    }
    for (const [i, k] of gone) {
      // (what the work itself just set down – a pan I took to the tap, onto a burner – is where it goes already)
      if (this.workMoved && this.workMoved.has(k)) continue;
      const dest = this.restPos(k, D);
      if (dest) this.fpArms.reach(i, { key: k, take: false, hold: this.fpHold.get(k), ...gripAt(k, i, dest, 0) });
    }
    // (a point in the world, for the hand on side s: in the right hand's camera space)
    const handAt = (w, s) => { const p = this.eye.worldToLocal(w.clone()); if (s < 0) p.x = -p.x; return p; };
    // (resting on a worktop: the palm flat at r.w, the fingers along r.dir – the arm from my shoulder
    // where my body is, level, however I look)
    const rest = (r, i) => {
      const relax = mood.curl[i];
      const d = r.dir.clone().transformDirection(this.eye.matrixWorldInverse);
      if (!i) d.x = -d.x;
      const f = this.eye.getWorldDirection(new THREE.Vector3()).setY(0).normalize(), rt = new THREE.Vector3().crossVectors(f, UP);
      const sh = this.eye.position.clone().addScaledVector(rt, (i ? 1 : -1) * SHOULDER.x).addScaledVector(UP, SHOULDER.y).addScaledVector(f, -SHOULDER.z);
      return { kind: 'rest', at: handAt(r.w, i ? 1 : -1), dir: d, sh: handAt(sh, i ? 1 : -1), curl: relax };
    };
    this.stillT = (rec.speed || 0) < 0.05 ? (this.stillT || 0) + dt : 0;
    let leaning = false;
    // (what my idle hands feel like doing just now – walking, picked afresh when I stop; and how long I
    // stand at a counter before I lean on it)
    if (!this.stillT && !(this.work && !this.work.idle)) { this.mood = null; this.restAfter = null; }
    if (this.restAfter == null) this.restAfter = REST_AFTER + Math.random() * 20;
    const mood = this.idleMood();
    const holds = slots.map((k, i) => {
      if (!k) return null;
      const h = this.fpHold.get(k) || 'palm';
      // carried over to a shelf with the pointer
      if (view.fpGrab && view.fpGrab.key === k && h !== 'side') return { kind: h, at: handAt(view.fpGrab.w, i ? 1 : -1) };
      // (a knife: carried in the hand as it's held to cut, its point forward and a little up, its edge down)
      const tk = k[0] === 'u' && view.C && view.C.tools && view.C.tools[k.slice(2)];
      if (h === 'tool' && tk && tk.kind === 'chefKnife') return { kind: 'knife', at: KNIFE_CARRY.at.clone(), dir: KNIFE_CARRY.dir.clone(), up: KNIFE_CARRY.up.clone() };
      if (h !== 'side') return { kind: h };
      const vr = this.vessels.get(k.slice(2)), r = vr ? vr.r : 0.13;
      return { kind: 'side', at: new THREE.Vector3(r + 0.035, -0.21, -0.25 - r) }; // (held before me, elbows bent – not out at arm's length)
    });
    // at work: what my hands are doing
    if (this.work && !this.work.idle) {
      this.work.hands.forEach((h, i) => {
        if (!h) return;
        // (a direction for the hand, in the right hand's camera space)
        let dir = null;
        if (h.dir) { dir = h.dir.clone().transformDirection(this.eye.matrixWorldInverse); if (!i) dir.x = -dir.x; }
        let up = null;
        if (h.up) { up = h.up.clone().transformDirection(this.eye.matrixWorldInverse); if (!i) up.x = -up.x; }
        holds[i] = { kind: h.kind, at: handAt(h.w, i ? 1 : -1), curl: h.curl, tool: h.tool, dir, up };
      });
      // (a hand with nothing to do rests on the worktop beside it, as the mood takes me – once I've been at it a
      // while, not straight away – or hangs at my side out of sight; so does one whose thing the work has
      // elsewhere – the pan my other hand is holding under the tap)
      for (let i = 0; i < 2; i++) {
        if (this.work.hands[i] || (holds[i] && !(slots[i] && this.work.ov.has(slots[i])))) continue;
        const r = mood.rest[i] && this.stillT > this.restAfter && this.work.rest && this.work.rest[i];
        holds[i] = r ? rest(r, i) : this.work.body ? { kind: 'away', at: new THREE.Vector3(0.15, -0.5, 0.22) } : null;
      }
    } else if (!view.fpGrab && this.stillT > this.restAfter && (holds[0] == null || holds[1] == null)) {
      // standing still at a counter a while, my free hands rest on it as the mood takes me – both, one, or
      // neither – and I lean in a little if they do (walking, they drop out of sight)
      const F = this.fpCam, eye = F && this.eyeAt(me.x, me.y, F.yaw, view.eyeOff || 0, REST_LEAN);
      const key = eye && `${eye.x.toFixed(2)}|${eye.z.toFixed(2)}|${Math.round(F.yaw / 0.05)}|${Math.floor(this.t)}|${mood.id}`; // (looked for again as I turn, and now and then)
      if (eye && (!this.restNow || this.restNow.key !== key)) this.restNow = { key, spots: this.benchRest({ pos: eye, fwd: new THREE.Vector3(Math.sin(F.yaw), 0, Math.cos(F.yaw)) }, { reach: 0.46, board: true, pref: mood.pref }) };
      if (eye) for (let i = 0; i < 2; i++) if (holds[i] == null && mood.rest[i] && this.restNow.spots[i]) { holds[i] = rest(this.restNow.spots[i], i); leaning = true; }
    }
    this.restLean = leaning;
    // a free hand on a door's handle
    if (view.fpGrab && !view.fpGrab.key) {
      const want = view.fpGrab.hand;
      const i = want >= 0 && holds[want] == null ? want : holds[1] == null ? 1 : holds[0] == null ? 0 : -1;
      if (i >= 0) holds[i] = { kind: 'grab', at: handAt(view.fpGrab.w, i ? 1 : -1) };
    }
    this.armHolds = holds; // (for test/arms.html: what my hands were asked to do)
    this.fpArms.update(dt, holds, { visible: true, walk: (rec.speed || 0) / 1.5, t: this.t, hideAway: (this.workCamK || 0) > 0.02, view: this.camera });
    this.workMoved = new Set(this.work && !this.work.idle ? this.work.ov.keys() : []);
  }

  // Where a thing in my hands goes, now it's been put down (roughly: the
  // place's spot for it) – null if it went nowhere to be seen.
  restPos(k, D) {
    // (at work: where the work has it – a food in its container beside the board)
    const ov = this.work && !this.work.idle && this.work.ov.get(k);
    if (ov && ov.pos) return ov.pos.clone();
    // (not drawn where the work is – several worked one at a time: its container beside the board)
    const bx = ov && (this.work.boxes || []).find(([id]) => `i:${id}` === k);
    if (ov) return bx ? bx[1].pos.clone() : null;
    const t = k[0] === 'v' ? D && D.vessels[k.slice(2)] : k[0] === 'u' ? this.toolsNow && this.toolsNow[k.slice(2)] : D && D.items[k.slice(2)];
    const fx = t && (k[0] === 'v' ? (t.at ? t.at.fx : t.held == null && t.home) : t.at);
    // (put away in a drawer, a cupboard, the crock …: its spot there)
    if (fx && fx.includes('/')) { const P = this.placeSpots(fx); if (!P) return null; const sl = slotOf(P.spec, t.spot); return P.at(sl.r, sl.i); }
    const F = fx && this.k3.fx[fx];
    if (!F || t.in) return null;
    const A = F.anchors;
    // put away: its spot on the shelf
    if (A.shelfL) {
      const n = A.shelfL.length, r = t.spot ? Math.min(n - 1, t.spot.r) : 1, u = t.spot ? 0.08 + t.spot.x * 0.84 : 0.5;
      return A.shelfL[n - 1 - r].clone().lerp(A.shelfR[n - 1 - r], u);
    }
    if (k[0] === 'v' && A.burners && (t.onHob || F.f.type === 'stove') && A.burners[t.at.slot]) return A.burners[t.at.slot];
    return A.board || A.basin || (A.spots && A.spots[0]) || A.top || A.mouth || null;
  }

  // my hands' reaches putting this thing down, on their way: [{r, i}] (a big pot: both)
  fpPuts(key) {
    const out = [];
    if (!this.fpOn) return out;
    for (let i = 0; i < 2; i++) { const r = this.fpArms.reaching(i); if (r && !r.take && !r.released && r.key === key) out.push({ r, i }); }
    return out;
  }
  fpPutting(key) { const p = this.fpPuts(key); return p.length ? p[0].r : null; }

  // where a thing in my hand i is drawn: {pos, yaw}
  fpAttach(k, i, me) {
    const A = this.fpArms, h = this.fpHold.get(k) || 'palm';
    if (h === 'tool') {
      // (a knife in the knife grip, as the hand holds it – KNIFE: the blade along xA, its spine yA; the carried one's
      // the utensil, hung from its handle – its point down its −y, its spine its +x, KNIFE_HANG behind the bolster)
      if (k[0] === 'u' && A.hands[i].hold === 'knife') {
        const xA = A.handDir(i, KNIFE.axis).normalize(), u0 = A.handDir(i, KNIFE.up);
        const yA = u0.addScaledVector(xA, -u0.dot(xA)).normalize(), zA = new THREE.Vector3().crossVectors(xA, yA);
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(yA, xA.clone().negate(), zA));
        return { pos: A.handPoint(i, KNIFE.at).addScaledVector(xA, -KNIFE_HANG), yaw: me.yaw, q };
      }
      return { pos: A.fist(i), yaw: me.yaw, q: A.toolQuat(i) }; // (a utensil, a bottle … in the fist)
    }
    if (h === 'side') {
      const a = A.palm(0), b = A.palm(1);
      const vr = this.vessels.get(k.slice(2));
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= vr ? vr.h * 0.8 : 0.1;
      return { pos: mid, yaw: Math.atan2(-(b.z - a.z), b.x - a.x) };
    }
    if (h === 'handle') {
      const g = GRIP3D[this.vessels.get(k.slice(2)) ? this.vessels.get(k.slice(2)).kind : 'pan'] || GRIP3D.pan;
      const d = A.handleDir(i);
      const th = Math.atan2(d.z, -d.x);
      const c = Math.cos(th), sn = Math.sin(th);
      return { pos: A.fist(i).sub(new THREE.Vector3(g.x * c + g.z * sn, g.y, -g.x * sn + g.z * c)), yaw: th };
    }
    return { pos: A.onPalm(i), yaw: me.yaw };
  }

  // ---------------------------------------------------------------- first person: work right there
  // There's no close-up in first person: the close-up's gestures (station.js,
  // run without drawing) happen on a plane standing on the work spot, facing
  // you – a point of the close-up (logical px; MAIN is the spot itself) is a
  // point on that plane, and back. Your hands, the tools, the food and the
  // pans are drawn there, in the kitchen.
  workFrame(fxId, kind, slot = 0, scale = WORK_S) {
    const F = this.k3.fx[fxId];
    if (!F) return null;
    const A = F.anchors;
    const pick = (...ks) => { for (const k of ks) { const a = A[k]; if (a) return Array.isArray(a) ? a[Math.min(slot, a.length - 1)] : a; } return null; };
    let O = kind === 'hob' ? pick('burners', 'top') : kind === 'sink' ? pick('basin', 'top') : ['oven', 'dome', 'tandoor'].includes(kind) ? pick('inside', 'mouth', 'top')
      : kind === 'chill' ? pick('shelf', 'top') : pick('board', 'top', 'mouth', 'basin', 'inside', 'shelf');
    if (!O) return null;
    // (the sink: under the tap's spout, at the worktop – the basin lies in front of it, towards me)
    if (kind === 'sink') O = (A.spout || O).clone().setY(COUNTER_H);
    // facing the side it's worked from (a bin, a table, an island stands free: maybe from the side)
    const f = F.f, sd = f.stand;
    let N = F.front.clone();
    if (sd) {
      const dx = sd.x + 0.5 - (f.x + f.w / 2), dz = sd.y + 0.5 - (f.y + f.h / 2);
      if (Math.abs(dx) > 1e-3 || Math.abs(dz) > 1e-3) N = Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz));
    }
    return { fx: fxId, kind, slot, O: O.clone(), N, R: new THREE.Vector3().crossVectors(N.clone().negate(), UP).normalize(), U: UP.clone(), S: scale };
  }
  // (The close-up looks down at the worktop: above the work spot its points
  // stand up into the air, below it they lie on the worktop, towards you – the
  // plane folds at the spot, so nothing put down beside it sinks into the counter.)
  workWorld(w, x, y) {
    const p = w.O.clone().addScaledVector(w.R, (x - MAIN.x) * w.S);
    return y <= MAIN.y ? p.addScaledVector(w.U, (MAIN.y - y) * w.S) : p.addScaledVector(w.N, (y - MAIN.y) * w.S);
  }
  // a point of the kitchen as a close-up point (on the plane, or on the worktop in front of it)
  workPoint(w, P) {
    const d = P.clone().sub(w.O);
    const x = MAIN.x + d.dot(w.R) / w.S, up = d.dot(w.U);
    return up > 0.001 ? { x, y: MAIN.y - up / w.S } : { x, y: MAIN.y + d.dot(w.N) / w.S };
  }
  // Cleaning freehand (client/station.js cleanAt): the surface cleaned – a board's top (-1 … 1 across its 52 cm, deep
  // its 36), a pot's floor (-1 … 1 across it) – and a close-up point as a point of it, along the line from my eye
  // through it (the close-up's point is on its upright plane over the work, or on the worktop before it)
  cleanSurface(w, def, vid) {
    if (def.do === 'wipe') { const F = this.k3.fx[w.fx], b = F && F.parts.board; return b ? { obj: b, y: 0.025, hx: 0.26, hz: 0.18 } : null; }
    const rec = vid && this.vessels.get(vid), fl = rec && this.vesselFloor(rec);
    return rec ? { obj: rec.group, y: fl.y + 0.002, hx: fl.r, hz: fl.r } : null;
  }
  // a pot's, a bowl's inner floor: how high it is, how far out it's flat (felt for with rays down into its model)
  vesselFloor(rec) {
    if (rec.floor) return rec.floor;
    const skip = new Set([rec.liquid, ...rec.bits, ...rec.bubbles]);
    for (const o of [rec.lid, rec.towel, rec.group.userData.cleanLayer]) if (o) o.traverse((m) => skip.add(m));
    const meshes = [];
    rec.group.updateMatrixWorld(true);
    rec.group.traverse((o) => { if (o.isMesh && !skip.has(o)) meshes.push(o); });
    const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0).transformDirection(rec.group.matrixWorld);
    const hitY = (x) => { rc.set(rec.group.localToWorld(new THREE.Vector3(x, rec.h + 0.2, 0)), down); const h = rc.intersectObjects(meshes, false)[0]; return h ? rec.group.worldToLocal(h.point.clone()).y : null; };
    const y0 = hitY(0) ?? 0.01;
    let r = rec.r * 0.3;
    for (let f = 0.3; f <= 0.95; f += 0.05) { const y = hitY(f * rec.r); if (y == null || y > y0 + 0.008) break; r = f * rec.r; }
    rec.floor = { y: y0, r };
    return rec.floor;
  }
  cleanWorld(w, p, def, vid) {
    const S = p && this.cleanSurface(w, def, vid);
    if (!S) return null;
    S.obj.updateMatrixWorld();
    const Pw = this.workWorld(w, p.x, p.y), eye = this.camera.getWorldPosition(new THREE.Vector3());
    const top = S.obj.localToWorld(new THREE.Vector3(0, S.y, 0)).y, d = Pw.clone().sub(eye);
    if (Math.abs(d.y) < 1e-5) return null;
    const t = (top - eye.y) / d.y;
    return t > 0 ? { S, P: eye.addScaledVector(d, t) } : null;
  }
  cleanUV(w, p, def, vid) {
    const c = this.cleanWorld(w, p, def, vid);
    if (!c) return null;
    const L = c.S.obj.worldToLocal(c.P.clone());
    return { x: L.x / c.S.hx, z: L.z / c.S.hz };
  }
  // (and where that surface is in the close-up, as the pointer has it over it on the screen)
  cleanRect(w, def, vid) {
    const S = this.cleanSurface(w, def, vid);
    if (!S) return null;
    S.obj.updateMatrixWorld();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const s = this.screenOf(S.obj.localToWorld(new THREE.Vector3(a * S.hx, S.y, b * S.hz))), q = this.workAt(w, s.x, s.y);
      if (!q) continue;
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } : null;
  }
  // the dirt and suds left on a surface being cleaned (the station's mask, drawn on it as it's rubbed off)
  cleanLayer(parent, mask, makeGeo, y) {
    let L = parent.userData.cleanLayer;
    if (!L) {
      L = new THREE.Mesh(makeGeo(), new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
      L.rotation.x = -Math.PI / 2;
      parent.add(L);
      parent.userData.cleanLayer = L;
    }
    L.position.y = y;
    if (L.userData.src !== mask.tex) {
      if (L.material.map) L.material.map.dispose();
      L.material.map = new THREE.CanvasTexture(mask.tex);
      L.material.map.colorSpace = THREE.SRGBColorSpace;
      L.material.needsUpdate = true;
      L.userData.src = mask.tex; L.userData.ver = -1;
    }
    if (L.userData.ver !== mask.ver) { L.material.map.needsUpdate = true; L.userData.ver = mask.ver; }
    L.visible = true;
    return L;
  }
  // the close-up point under this point of the screen
  workAt(w, cx, cy) {
    const ray = this.rayAt(cx, cy);
    const den = ray.direction.dot(w.N);
    if (Math.abs(den) > 1e-4) {
      const t = w.O.clone().sub(ray.origin).dot(w.N) / den;
      if (t > 0) {
        const P = ray.at(t, new THREE.Vector3()).sub(w.O);
        if (P.dot(w.U) >= 0) return { x: MAIN.x + P.dot(w.R) / w.S, y: MAIN.y - P.dot(w.U) / w.S };
      }
    }
    // below the spot: on the worktop, towards me
    if (ray.direction.y < -1e-4) {
      const t = (w.O.y - ray.origin.y) / ray.direction.y;
      const Q = ray.at(t, new THREE.Vector3()).sub(w.O);
      if (t > 0 && Q.dot(w.N) >= 0) return { x: MAIN.x + Q.dot(w.R) / w.S, y: MAIN.y + Q.dot(w.N) / w.S };
    }
    return null;
  }
  // The real thing a gesture takes hold of, where the close-up has it somewhere
  // else (the knob for this burner on the stove's front, the tap's lever): its
  // world point and the close-up point – the pointer is shifted from one to the
  // other on the screen, so you take the real one.
  workReal(w, st) {
    const g = st && st.g;
    const F = g && this.k3.fx[w.fx];
    if (!F) return null;
    if (g.kind === 'knob' && F.parts.knobs && F.parts.knobs.length) {
      const kn = F.parts.knobs[Math.min(w.slot || 0, F.parts.knobs.length - 1)];
      return { w: kn.getWorldPosition(new THREE.Vector3()).addScaledVector(w.N, 0.02), at: st.knobPos() };
    }
    if ((g.kind === 'tap' && g.ph.hot === 'faucet') && F.parts.lever) {
      return { w: F.parts.lever.localToWorld(new THREE.Vector3(0.1, 0.03, 0)), at: st.hotspot() };
    }
    // the oven gloves, where they lie beside it
    if (g.kind === 'tap' && g.ph.hot === 'gloves') { const gw = this.glovesWorld(w.fx); if (gw) return { w: gw, at: st.hotspot() }; }
    // the dishwasher's start button
    if (g.kind === 'tap' && g.ph.hot === 'dwStart' && F.parts.dwButton) return { w: F.parts.dwButton.getWorldPosition(new THREE.Vector3()).addScaledVector(w.N, 0.02), at: st.hotspot() };
    // the dish soap: on the sink's rim – or, cleaning a board, standing beside it on the worktop
    if (g.kind === 'tap' && g.ph.hot === 'soap') {
      if (F.parts.soap) return { w: F.parts.soap.localToWorld(new THREE.Vector3(0, 0.14, 0)), at: st.hotspot() };
      return { w: this.soapSpot(w).addScaledVector(UP, 0.14), at: st.hotspot() };
    }
    return null;
  }
  // (cleaning a board: where the dish soap stands, on the worktop to its right)
  soapSpot(w) { return w.O.clone().addScaledVector(w.R, 0.33).addScaledVector(w.N, -0.12).setY(w.O.y - 0.025); }
  // The camera at work: almost straight down on the work, from just my side of it,
  // close enough to see what's happening; for the knob on the stove's front / the
  // tap's lever, from in front and a little above (the pan in view too).
  workCam(w, st) {
    const g = st && st.g;
    if (w.kind === 'sink' && g && (g.kind === 'fill' || (g.kind === 'drag' && g.ph.to === 'underTap'))) {
      // (the tap's lever at the back too: looking a little up the tap, from further out in front)
      const look = w.O.clone().addScaledVector(UP, 0.05).addScaledVector(w.N, -0.1);
      return { look, pos: look.clone().addScaledVector(w.N, 0.64).addScaledVector(UP, 0.46) };
    }
    // (scooping from one pot into others: wide enough to see them all)
    const sw = g && g.kind === 'scoop' && st.c && this.scoopWorld(w, st.c.def, g.n || 2, this.fpSlots.includes(`v:${st.c.def.from}`));
    if (sw) {
      const pts = [sw.from, ...sw.to];
      const look = w.O.clone().addScaledVector(UP, 0.05).addScaledVector(w.N, 0.03);
      return this.fitCam({ look, pos: look.clone().addScaledVector(w.N, 0.3).addScaledVector(UP, 0.55) }, pts, 0.5, 0.25);
    }
    // (standing a board up at the back, laying it down: from further back, seeing the whole counter)
    if (g && g.kind === 'door' && g.ph.hot === 'board') { const look = w.O.clone().addScaledVector(w.N, -0.2).addScaledVector(UP, 0.08); return { look, pos: look.clone().addScaledVector(w.N, 0.85).addScaledVector(UP, 0.55) }; }
    const real = this.workReal(w, st);
    // (the oven gloves, lying on its worktop: looking at them, from where I stand)
    if (real && g.kind === 'tap' && g.ph.hot === 'gloves') return { look: real.w.clone(), pos: real.w.clone().addScaledVector(w.N, 0.5).addScaledVector(UP, 0.5) };
    if (real) {
      // (a knob low on the front: from further out and lower – the knob, the hand coming to it and the pan above)
      const low = real.w.y < COUNTER_H - 0.02;
      const look = real.w.clone().lerp(w.O, low ? 0.3 : 0.4);
      return { look, pos: look.clone().addScaledVector(w.N, low ? 0.78 : 0.42).addScaledVector(UP, low ? 0.4 : 0.62) };
    }
    // an oven, a fridge …: looking in at it from in front, a little above – the door, the inside, my hands going in
    const into = INTO[w.kind];
    if (into) {
      const look = w.O.clone().addScaledVector(w.N, into.look).addScaledVector(UP, into.lookUp);
      // (taking a door's handle: looking down toward it too – an oven's door, dropped open, lies low in front)
      const hw = g && g.kind === 'door' && this.handleWorld(w.fx);
      if (hw) look.lerp(hw, hw.y < w.O.y ? 0.7 : 0.45);
      return { look, pos: look.clone().addScaledVector(w.N, into.out).addScaledVector(w.R, into.side || 0).addScaledVector(UP, into.up) };
    }
    const look = w.O.clone().addScaledVector(UP, 0.05).addScaledVector(w.N, 0.03);
    return { look, pos: look.clone().addScaledVector(w.N, 0.21).addScaledVector(UP, 0.5) };
  }
  // What a step works with, in my hand while I use it: a shaker (shaken upside down) or a bottle (tipped) of what
  // seasons it, a sack's sugar – a pinch – the lemon squeezed, the garlic rubbed on. {id, how, col} or null.
  useInHand(def, D) {
    if (!def || !D) return null;
    const of = (id) => { const it = D.items[id]; return it && !it.used ? (INGREDIENTS[it.kind] && INGREDIENTS[it.kind].art) || {} : null; };
    if (def.do === 'season') {
      const a = of(def.item);
      if (!a) return null;
      return { id: def.item, how: a.type === 'shaker' ? 'shake' : a.type === 'bottle' ? 'pour' : 'sprinkle', col: rgb01(a.type === 'shaker' ? a.c3 === '#c9ccd2' ? '#ffffff' : a.c1 : a.c1 || '#ffffff') };
    }
    if (def.do === 'squeeze' && of(def.item)) return { id: def.item, how: 'squeeze' };
    if (def.do === 'brush' && def.tool === 'grab' && def.with && of(def.with)) return { id: def.with, how: 'rub' };
    return null;
  }
  // how tall a food stands, as built (a shaker, a bottle …)
  foodHeight(kind, st) {
    const key = foodKey(kind, st);
    this.heights = this.heights || new Map();
    if (!this.heights.has(key)) { const b = new THREE.Box3().setFromObject(buildFood(kind, st)); this.heights.set(key, Math.max(0.02, b.max.y - b.min.y)); }
    return this.heights.get(key);
  }
  // When a step ends, what's on its counter / stove stays just where it's drawn – the glass I stirred on the
  // board, the dough I rolled, the bowl that stood aside – till someone takes it (not back to where the
  // kitchen would set it, by itself). Not what was in the air or tipped: that glides back down.
  parkAfterWork(prev, view) {
    const D = view.D;
    if (!D) return;
    if (prev.lid && prev.lid.off && D.vessels[prev.lid.vid] && !D.vessels[prev.lid.vid].lid) (this.lidsAside = this.lidsAside || new Map()).set(prev.lid.vid, { base: prev.lid.base.clone() });
    this.parkedAt = this.parkedAt || new Map();
    for (const [id, v] of Object.entries(D.vessels)) {
      if (!v.at || v.at.fx !== prev.fx || v.held != null) continue;
      const rec = this.vessels.get(id), ov = prev.ov.get(`v:${id}`);
      if (!rec || !rec.group.visible || (ov && (ov.tilt || ov.hide))) continue;
      this.parkedAt.set(`v:${id}`, { fx: prev.fx, slot: v.at.slot, pos: rec.group.position.clone(), yaw: rec.group.rotation.y });
    }
    for (const [id, it] of Object.entries(D.items)) {
      const ov = prev.ov.get(`i:${id}`);
      if (!ov || ov.hide || ov.box || ov.q || it.in || it.hidden || it.held != null || it.at !== prev.fx || boxable(it.kind)) continue;
      this.parkedAt.set(`i:${id}`, { fx: prev.fx, pos: ov.pos.clone(), yaw: ov.yaw ?? prev.yaw ?? 0, scale: ov.scale });
    }
  }
  // the screen shift (px) from the real thing to where the close-up has it
  workOffset(w, st) {
    const r = this.workReal(w, st);
    if (!r) return { x: 0, y: 0 };
    const a = this.screenOf(this.workWorld(w, r.at.x, r.at.y)), b = this.screenOf(r.w);
    return { x: a.x - b.x, y: a.y - b.y };
  }

  // the mouth of the pan I'm working at, in close-up px (what the close-up's drawing would have set)
  workGeo(w, vesselId) {
    const rec = vesselId && this.vessels.get(vesselId);
    if (!rec || !rec.group.visible) return null;
    const p = rec.group.position.clone().sub(w.O);
    const x = MAIN.x + p.dot(w.R) / w.S, base = MAIN.y - p.dot(w.U) / w.S, r = rec.r / w.S;
    return { mouthX: x, mouthY: base - rec.h / w.S, mouthRx: r, mouthRy: r * 0.35, bottomY: base, top: base - rec.h / w.S };
  }

  // What my hands do at work this frame, and where the things they move are
  // (from the close-up's state): this.work = {hands, ov, sprites, rings, stream, knob}.
  workScene(view) {
    const prev = this.work;
    this.work = null;
    const W = view.work;
    // (a step just finished, or I stepped away: what it left where it was stays there – nothing moves by itself)
    const going = W && W.st && W.st.on && this.firstPerson && W.frame && W.st.g && !W.st.done;
    if (prev && !prev.idle && prev.fx && !going) this.parkAfterWork(prev, view);
    if (!W || !W.st || !W.st.on || !this.firstPerson || !W.frame) return;
    const st = W.st, g = st.g, w = W.frame;
    // (gathered into its container – the step's done: it stays where I dropped it in)
    if (st.done && this.boxing) this.commitBoxing();
    this.boxing = null;
    if (!g || st.done) { this.work = { hands: [null, null], ov: new Map(), sprites: [], rings: [], stream: null, knob: null, idle: true }; return; }
    const at = (p) => this.workWorld(w, p.x, p.y);
    const D = view.D, ph = g.ph, p = st.ptr;
    const def = st.c && st.c.def, n = st.c ? st.c.phases.length : 1;
    const boardDirt = def && !def.chore && ACTIONS[def.do] && ACTIONS[def.do].cap === 'board' ? Math.min(1, (st.ph + Math.min(1, st.k / Math.max(1, phaseTarget(ph)))) / Math.max(1, n)) : 0;
    const out = { fx: w.fx, boardDirt, hands: [null, null], ov: new Map(), sprites: [], rings: [], stream: null, knob: null, O: w.O, yaw: Math.atan2(w.N.x, w.N.z), real: !!this.workReal(w, st), cam: this.workCam(w, st), boxes: [] };
    // (into the oven: the tray's set down on the oven's worktop while the gloves go on and the door comes down –
    // then slid in from there)
    if (def && def.do === 'bakeIn' && def.vessel && st.c && st.ph < st.c.phases.findIndex((q) => q.g === 'drag') && this.k3.fx[w.fx] && this.k3.fx[w.fx].parts.drop) out.ov.set(`v:${def.vessel}`, { pos: this.ovenRest(w), yaw: Math.atan2(w.N.x, w.N.z) });
    // (where my body is, working: right up against it, leaning over – the knob, the tap's lever: as I stand)
    const realW = out.real && this.workReal(w, st).w, inside = INTO[w.kind];
    const doorW = g.kind === 'door' && this.handleWorld(w.fx);
    if (realW || doorW) {
      // (the knob, the tap's lever, a door's handle: I step up to it, bending for one low down – within my arm's reach)
      const at = realW || doorW;
      out.body = { pos: at.clone().addScaledVector(w.N, 0.45).setY(Math.min(EYE_H, at.y + 0.45)), fwd: w.N.clone().negate() };
    } else if (inside) out.body = { pos: w.O.clone().addScaledVector(w.N, inside.body).addScaledVector(w.R, (inside.side || 0) * 0.5).addScaledVector(UP, inside.eye), fwd: w.N.clone().negate() };
    // (at a worktop: right up to it, leaning in over the work – my eyes about 63 cm over it, 24 cm back: my elbows bent
    // and down at my sides, as a cook's are, not reaching out at arm's length)
    else out.body = { pos: w.O.clone().addScaledVector(w.N, 0.12).addScaledVector(UP, 0.32), fwd: w.N.clone().negate() };
    // washing is done in the food's container, in the basin: it fills while the tap runs, and is tipped out at the end
    const washing = st.c && st.c.def && st.c.def.do === 'wash';
    const F0 = this.k3.fx[w.fx];
    // washing up / cleaning a board: how grimy, how sudsy it still is
    const cleaning = st.c && st.c.def && (st.c.def.do === 'scrub' || st.c.def.do === 'wipe');
    if (cleaning) out.washing = { fx: w.fx, vid: st.c.def.do === 'scrub' ? st.c.st && st.c.st.vid : null, ...st.washLook(), soap: !F0 || !F0.parts.soap ? this.soapSpot(w) : null };
    const basin = washing && F0 && F0.anchors.basin ? F0.anchors.basin.clone() : null;
    const wantWater = !washing ? 0 : st.ph === 0 ? 0 : g.kind === 'pour' ? 0.7 * (1 - Math.min(1, g.v || 0)) : 0.7;
    this.washWater = (this.washWater || 0) + (wantWater - (this.washWater || 0)) * Math.min(1, (this.dt || 0.016) * (wantWater > (this.washWater || 0) ? 1.6 : 6));
    // the food worked on stands right on the work spot (under the tap, on the board), as big as the gesture has it
    if (g.subject && g.subject.type === 'item' && D && D.items[g.subject.id] && !['drag', 'dip'].includes(g.kind)) {
      const b = st.subjectBox();
      const pos = basin || (this.firstPerson ? at({ x: b.cx, y: b.y1 }) : at({ x: b.cx, y: b.y1 }).addScaledVector(UP, -0.1 * b.h * w.S));
      out.ov.set(`i:${g.subject.id}`, { pos, size: Math.max(0.12, Math.min(0.32, Math.max(b.w, b.h) * w.S * 1.15)), box: washing ? { water: this.washWater } : null });
      // washing: the tap runs into its container
      const F = this.k3.fx[w.fx];
      if (w.kind === 'sink' && g.kind === 'strokes' && F && F.anchors.spout) out.stream = { from: F.anchors.spout.clone(), to: basin ? basin.clone().addScaledVector(UP, 0.05) : at({ x: b.cx, y: b.y0 }), color: '#cfe8f8' };
      // out on the board: its container stands beside it, empty
      if (!washing && w.kind !== 'sink') out.boxes.push([g.subject.id, { pos: this.boxSpot(w), yaw: out.yaw }]);
    }
    // the tool, as the close-up has it
    let tool = ph.tool || { chop: 'knife', peel: 'peeler', circle: 'spoon', paint: 'spoon' }[g.kind] || 'hand';
    if (['drag', 'scoop', 'dip', 'crack', 'knob', 'tap', 'pour', 'fill', 'place', 'flick', 'door'].includes(g.kind) || (g.kind === 'wrap' && g.stage === 0)) {
      if (!['tongs', 'ladle', 'spoon', 'teaspoon', 'pizzaPeel', 'spatula'].includes(tool) && !(BOARD_TOOLS.includes(tool) && g.kind === 'tap')) tool = 'hand';
    }
    if (tool === 'grab') tool = 'hand';
    // (the hand already holding what's carried does it; else the free one)
    const srcKey = g.source && g.source.id ? `${g.source.type === 'vessel' ? 'v' : 'i'}:${g.source.id}` : null;
    const held = srcKey ? this.fpSlots.indexOf(srcKey) : -1;
    // (Q – the left hand – doing it, if it's free)
    // (the knife held at rest in my right hand meanwhile: the left does it)
    // (the food out of its container onto the board: the left – the right's for the knife, the peeler …)
    // (only when my right's busy: the container's on my right – reaching it with my left would be across my chest)
    // (for a left-handed cook, the other way about: M the main hand, O the other)
    const M = this.mainHand, O = 1 - M;
    const leftTakes = g.kind === 'drag' && g.source && g.source.fromBox && this.fpSlots[O] == null && this.fpSlots[M] != null;
    // (a board's tool in my hand that this gesture doesn't use – the knife, while the other hand takes the tomato out of
    // its container – held at rest meanwhile, as between its uses)
    const restTool = ph.held || (!BOARD_TOOLS.includes(ph.tool) && !(ph.g === 'tap' && ph.hot === 'pick') ? this.fpSlots.map((k) => this.boardKindOf(k)).find(Boolean) || null : null);
    let wi = restTool || leftTakes ? O : held >= 0 ? (this.fpSlots[1] === srcKey ? 1 : held) : (this.fpSlots[M] || p.id === ['kq', 'ke'][O]) && this.fpSlots[O] == null ? O : M;
    // (the board's tool – the knife … – in the hand that really holds it: that hand works with it, the other does the
    // rest meanwhile)
    const tk = BOARD_TOOLS.includes(ph.tool) && ph.g !== 'tap' ? ph.tool : restTool;
    const th = tk ? this.fpSlots.findIndex((k) => this.boardKindOf(k) === tk) : -1;
    if (th >= 0) wi = tk === ph.tool ? th : 1 - th;
    const oi = 1 - wi;
    const pt = p.seen ? { x: p.x, y: p.y } : { x: MAIN.x + 60, y: MAIN.y - 120 };
    const len = TOOL_LEN[tool] || 0;
    const hand = (i, pos, kind, extra = {}) => { out.hands[i] = { w: pos, kind, ...extra }; };
    // (a pinch: the piece between my thumb's and index's tips – the grip point of the pinch hold)
    const pinch = (P, curl = 0.6, i = wi) => hand(i, P.clone().addScaledVector(UP, 0.004), 'pinch', { curl });
    // a tool's working end where I point: the knife's edge (the blade forward over the food), a spoon's bowl …
    const into = w.N.clone().negate();
    const toolHand = (pos) => {
      if (tool === 'hand') return hand(wi, pos.clone().addScaledVector(UP, 0.02), 'hand', { curl: p.down ? 0.8 : 0.3 });
      if (tool === 'knife') {
        const K = this.knifeAt(pos, into.clone().addScaledVector(w.R, -0.5).normalize(), 0.12);
        out.tool = { kind: 'knife', grip: K.fist, dir: K.xA, hand: wi, off: K.K0.clone().sub(K.fist) };
        return hand(wi, K.fist, 'knife', { dir: K.xA, up: K.yA });
      }
      // (leaning back toward me as a spoon's held to stir or spread – not upright, seen end on from above –
      // the fist round the handle, along it)
      const dir = UP.clone().multiplyScalar(0.74).addScaledVector(w.N, 0.67).normalize();
      const grip = pos.clone().addScaledVector(dir, len);
      out.tool = { kind: tool, grip, dir, hand: wi };
      return hand(wi, grip, 'tool', { dir });
    };
    const vKey = (q) => (q && q.type === 'vessel' && q.id ? `v:${q.id}` : q && q.type === 'item' && q.id ? `i:${q.id}` : null);
    const ring = (q, r = 60) => { if (q) out.rings.push({ w: at(q), r: (q.r || r) * w.S }); };
    switch (g.kind) {
      case 'wrap': {
        // Rolling a dolma: a leaf flat in the middle of the board; a spoonful of the filling from its bowl onto it;
        // its sides folded in over it, a hand each side; rolled up from my side, both hands behind it – as far as
        // the pointer's gone each time – onto the row of those done at the side.
        const it = D && D.items[g.subject && g.subject.id];
        if (!it) break;
        const L = w.O.clone().addScaledVector(w.N, 0.02), fill = st.scoopColor ? st.scoopColor() : '#b8603a';
        const f = Math.round((g.start && p.down ? (g.stage === 1 ? Math.min(1, Math.abs(p.x - g.start.x) / 80) : g.stage === 2 ? Math.max(0, Math.min(1, (g.start.y - p.y) / 90)) : 0) : 0) * 10) / 10;
        out.ov.set(`i:${it.id || g.subject.id}`, { pos: L, yaw: out.yaw, st: { qty: 1, extra: 0, cut: null, k: 0, n: 0, fill: g.stage >= 1 ? fill : null, fold: g.stage === 1 ? f : g.stage >= 2 ? 1 : 0, roll: g.stage === 2 ? f : 0 } });
        const done = (it.rolls || 0) + st.k;
        if (done > 0) out.sprites.push({ tex: null, kind: it.kind, st: { cut: 'rolls', k: Math.min(12, done), qty: 1 }, pos: this.pileSpot(w), size: 0.12 });
        const lw = 0.07;
        if (g.stage === 0) {
          // (a spoonful taken from the bowl's side, carried over to the leaf)
          const P = g.drag && g.pos ? at(g.pos) : at(SIDE);
          if (g.drag) out.sprites.push({ tex: this.blobTex(fill), kind: { type: 'blob', c1: fill }, st: {}, pos: P.clone().addScaledVector(UP, -0.015), size: 0.05 });
          hand(wi, P.clone().addScaledVector(UP, 0.02), 'pinch', { curl: g.drag ? 0.7 : 0.3 });
          hand(oi, L.clone().addScaledVector(w.R, -lw - 0.05).addScaledVector(UP, 0.01), 'rest');
          ring(g.drag ? { x: MAIN.x, y: MAIN.y - 40, r: 90 } : SIDE, 50);
        } else if (g.stage === 1) {
          // (a hand each side, folding its side in)
          const x = lw * (1 - 0.4 * f) + 0.01;
          for (const [i, sd] of [[wi, 1], [oi, -1]]) hand(i, L.clone().addScaledVector(w.R, sd * x).addScaledVector(UP, 0.012 + 0.01 * f), 'hand', { curl: 0.35, dir: w.R.clone().multiplyScalar(-sd).addScaledVector(w.N, -0.6).normalize() });
        } else {
          // (both hands at my side of it, rolling it up and away)
          const z = 0.055 - 0.09 * f;
          for (const [i, sd] of [[wi, 1], [oi, -1]]) hand(i, L.clone().addScaledVector(w.R, sd * 0.03).addScaledVector(w.N, z + 0.02).addScaledVector(UP, 0.018), 'hand', { curl: 0.5, dir: w.N.clone().negate() });
        }
        break;
      }
      case 'drag': {
        const k = vKey(g.source);
        if (g.source && g.source.fromBox) {
          // Out of its container onto the board: it stands in its container beside the board till
          // you take it – a whole one in your hand, cut-up pieces as a heap in both cupped hands –
          // and put it down on the board.
          const box = this.boxSpot(w), it = D && D.items[g.source.id], U = it && boardUnits(it);
          const bits = !U && it && it.cut && (it.k || 0) >= (it.n || 0);
          if (!g.drag) {
            // (several, one at a time: the next one still in the container – drawn with those still to do)
            out.ov.set(k, U ? { hide: true } : { pos: box.clone(), yaw: out.yaw, box: {} });
            hand(wi, at(st.grabPoint()).addScaledVector(UP, 0.05), 'hand', { curl: 0.3 });
            ring({ ...g.from, r: 50 });
            ring(g.target);
            break;
          }
          if (!U) out.boxes.push([g.source.id, { pos: box, yaw: out.yaw }]);
          const P = at(g.pos);
          P.y = Math.max(P.y, w.O.y + 0.05);
          if (bits) {
            out.ov.set(k, { pos: P.clone().addScaledVector(UP, 0.006), yaw: out.yaw, st: { spread: 0.022 } });
            hand(wi, P.clone().addScaledVector(w.R, 0.019), 'palm', { curl: 0.55 });
            hand(oi, P.clone().addScaledVector(w.R, -0.019), 'palm', { curl: 0.55 });
          } else {
            // (held from above, the fingers round it – just the one: the palm on its top, not in it)
            const one = U ? { qty: 1, extra: 0, cut: null, k: 0, n: 0, peeled: 0 } : null;
            out.ov.set(k, { pos: P.clone().addScaledVector(UP, -(it ? this.foodHeight(it.kind, one ? { ...it, ...one } : it) : 0.04) - 0.006), yaw: out.yaw, st: one });
            hand(wi, P.clone(), 'hand', { curl: 0.55 });
          }
          ring(g.target);
          break;
        }
        if (g.source && (g.source.type === 'newBox' || g.source.oneOver)) {
          // Portioning a bunch: an empty container off the stack, set on the board's right; then, one at a
          // time, from the bunch's container on the left into it – those moved over so far in it.
          const id = st.c.def.item, it = D && D.items[id];
          if (!it) break;
          const from = this.portionSpot(w, -1), to = this.portionSpot(w, 1), moved = g.source.oneOver ? st.k : 0;
          const carrying = g.source.oneOver && g.drag ? 1 : 0, left = (it.qty || 1) + (it.extra || 0) - moved - carrying;
          const of = { ...it, extra: 0 };
          out.ov.set(`i:${id}`, { pos: from.clone(), yaw: out.yaw, box: {}, st: { qty: Math.max(1, left), extra: 0 }, hide: left <= 0 });
          const P = g.drag ? at(g.pos) : null;
          if (P) P.y = Math.max(P.y, w.O.y + 0.05);
          if (g.source.type === 'newBox') {
            out.boxes.push([id, { pos: P ? P.clone().addScaledVector(UP, -0.03) : this.nestSpot(w).addScaledVector(UP, 0.02), yaw: out.yaw, st: null, of }]);
            hand(wi, P || this.nestSpot(w).addScaledVector(UP, 0.09), 'grab', { curl: g.drag ? 0.9 : 0.4 });
          } else {
            out.boxes.push([id, { pos: to.clone(), yaw: out.yaw, st: moved > 0 ? { ...it, qty: moved, extra: 0 } : null, of }]);
            if (P) out.sprites.push({ tex: null, kind: it.kind, st: { ...it, qty: 1, extra: 0 }, pos: P.clone().addScaledVector(UP, -0.03), size: 0.1 });
            hand(wi, P || from.clone().addScaledVector(UP, 0.06), 'hand', { curl: g.drag ? 0.8 : 0.3 });
            this.boxing = { id, fx: w.fx, pos: to.clone(), rest: { id: `${id}~rest`, fx: w.fx, pos: from.clone() } };
          }
          ring(g.target);
          break;
        }
        if (g.source && g.source.unit) {
          // The one just done, pushed along the board to the pile at its side – the knife's blade on
          // its side behind it, its edge on the board (or the hand behind it) – where the pointer has it.
          const it = D && D.items[g.source.id], U = it && boardUnits(it);
          const P = g.drag ? this.boardAt(w, at(g.pos)) : w.O.clone();
          const push = this.pileSpot(w).sub(w.O).setY(0).normalize();
          out.ov.set(k, U && U.cur ? { pos: P.clone(), yaw: out.yaw + CUT_TURN, st: U.cur } : { hide: true });
          if (ph.tool === 'knife') {
            const d = new THREE.Vector3().crossVectors(UP, push).normalize();
            if (d.dot(w.N) > 0) d.negate(); // (pointing away from me)
            const K = this.knifeAt(P.clone().addScaledVector(push, -0.05).setY(w.O.y + 0.001), d, 0.04);
            out.tool = { kind: 'knife', grip: K.fist, dir: K.xA, hand: wi, off: K.K0.clone().sub(K.fist) };
            hand(wi, K.fist, 'knife', { dir: K.xA, up: K.yA });
          } else hand(wi, P.clone().addScaledVector(push, -0.045).addScaledVector(UP, 0.02), 'hand', { curl: 0.3, dir: into.clone().addScaledVector(push, 0.3).normalize() }); // (palm down, the fingers forward: pushed with the hand's edge)
          ring(g.target);
          break;
        }
        if (g.source && g.source.pieces) {
          // Cut up, gathered into its container: the pieces lie where they were cut till
          // you take them; then they're a little heap in your two cupped hands, carried over
          // to the container standing beside the board, and dropped in (it stays there, in it).
          const box = this.boxSpot(w), gIt = D && D.items[g.source.id];
          // (with the rest of its bunch still in its container: into an empty one off the stack – the bunch's
          // container stays where it is, with what's left, to go back)
          const into = gIt && gIt.extra > 0 ? this.nestSpot(w).addScaledVector(UP, 0.012) : box;
          if (!(gIt && boardUnits(gIt))) out.boxes.push([g.source.id, { pos: box, yaw: out.yaw }]);
          this.boxing = { id: g.source.id, fx: w.fx, pos: into.clone(), rest: gIt && gIt.extra > 0 ? { id: `${g.source.id}~rest`, fx: w.fx, pos: box.clone() } : null };
          if (st.k > 0) { this.commitBoxing(); break; }
          if (!g.drag) {
            // (several done one at a time: they're all on the pile at the side)
            out.ov.set(k, ph.pile ? { pos: this.pileSpot(w), yaw: out.yaw, st: { spread: 0.035 } } : { pos: w.O.clone(), yaw: out.yaw + CUT_TURN });
            hand(wi, (ph.pile ? this.pileSpot(w) : at(st.grabPoint())).addScaledVector(UP, 0.035), 'hand', { curl: 0.3 });
            ring(g.target);
            break;
          }
          const P = at(g.pos);
          P.y = Math.max(P.y, w.O.y + 0.05); // (carried a little above the board)
          out.ov.set(k, { pos: P.clone().addScaledVector(UP, 0.006), yaw: out.yaw, st: { spread: 0.022 } });
          hand(wi, P.clone().addScaledVector(w.R, 0.019), 'palm', { curl: 0.55 });
          hand(oi, P.clone().addScaledVector(w.R, -0.019), 'palm', { curl: 0.55 });
          ring(g.target);
          break;
        }
        if (w.kind === 'sink' && ph.to === 'underTap' && k && k[0] === 'v') {
          // To the tap: the pan in my left hand by its handle (handle to my left, toward me – my right's for
          // the tap), carried from where I hold it to right under the spout; low over the sink once it's there.
          const F = this.k3.fx[w.fx], vr = this.vessels.get(k.slice(2));
          const P = at(g.pos);
          if (F && F.anchors.basin) P.y = Math.max(F.anchors.basin.y + 0.02, Math.min(P.y, w.O.y + 0.06));
          out.ov.set(k, { pos: P, yaw: this.sinkYaw(F || { front: w.N }), size: 0.22 });
          if (vr && F) { vr.group.position.copy(P); vr.group.rotation.set(0, this.sinkYaw(F), 0); const G = this.sinkGrip(vr, F); hand(0, G.w, G.kind, { curl: g.drag ? 0.95 : 0.6, dir: G.dir }); }
          if (!g.drag) ring(g.pos, 50);
          ring(g.target);
          break;
        }
        if (g.source && g.source.type === 'part') {
          // the board's knife / peeler / grater, or the stack of containers: in my hand, slid along the worktop (not
          // through the air: where the pointer has it on the screen, at the worktop's height)
          const name = g.source.name, o = this.boardPart(w.fx, name);
          if (o) {
            const sc = this.screenOf(at(g.pos)), ray = this.rayAt(sc.x, sc.y), y = o.userData.flat.pos.y + (g.drag ? 0.015 : 0), t = (y - ray.origin.y) / (ray.direction.y || -1e-6);
            const P = g.drag && t > 0 ? ray.at(t, new THREE.Vector3()) : o.getWorldPosition(new THREE.Vector3());
            if (g.drag) out.part = { fx: w.fx, name, pos: P.clone(), q: o.quaternion.clone() };
            hand(wi, P.clone().addScaledVector(UP, name === 'nest' ? 0.06 : name === 'grater' ? 0.11 : 0.02), name === 'nest' ? 'hand' : 'grab', { curl: g.drag ? 0.85 : 0.4 });
            const to = this.partHome(w.fx, name, g.ph.to.startsWith('aside'));
            if (to) out.rings.push({ w: to, r: name === 'nest' ? 0.08 : 0.05 });
          }
          break;
        }
        if (g.source && g.source.type === 'lid') {
          // A lid – a tea towel under it, for a paella – lifted off by its knob and set down beside the pot, or
          // brought from beside it and put on: the pot's own lid in my hand (not on the pot meanwhile)
          const vid = g.subject && g.subject.id, vr = vid && this.vessels.get(vid);
          if (vr) {
            const top = this.lidTop(vr), onPot = vr.group.position.clone().addScaledVector(UP, vr.h);
            let base = g.source.on && !g.drag ? onPot : at(g.pos).addScaledVector(UP, -top);
            if (g.drag || !g.source.on) base.y = Math.max(base.y, Math.min(onPot.y, COUNTER_H));
            out.lid = { vid, base, towel: !!(g.source.towel || (g.source.on && D.vessels[vid] && D.vessels[vid].towel)), off: !!g.source.on };
            const knob = base.clone().addScaledVector(UP, top);
            hand(wi, knob.clone().addScaledVector(UP, 0.012), 'tool', { dir: UP.clone().addScaledVector(w.N, 0.3).normalize(), curl: g.drag ? 0.8 : 0.5 });
            if (!g.drag) out.rings.push({ w: knob, r: 0.04 });
          }
          ring(g.target);
          break;
        }
        const pos = at(g.pos);
        // (a thing in its container: carried over in it)
        if (k) out.ov.set(k, { pos: this.firstPerson ? pos.clone().addScaledVector(UP, ph.tip ? -TIP_LOW : 0) : k[0] === 'v' ? pos.clone().addScaledVector(UP, -0.03) : pos.clone().addScaledVector(UP, -0.05), size: 0.22, yaw: Math.atan2(w.N.x, w.N.z), box: k[0] === 'i' ? {} : null });
        hand(wi, at(st.grabPoint()), g.grip ? 'grab' : 'hand', { curl: g.drag ? 0.85 : 0.35 });
        if (!g.drag) ring(g.pos, 50);
        ring(g.target);
        break;
      }
      case 'dip': {
        const k = vKey(g.source);
        if (k) out.ov.set(k, { pos: at(g.pos).addScaledVector(UP, -0.04), size: 0.2 });
        toolHand(at(g.pos));
        if (!g.drag) ring(g.pos, 50);
        ring({ x: MAIN.x, y: MAIN.y - 80, r: 100 });
        break;
      }
      case 'crack': {
        const tex = this.spriteFor('egg', { qty: 1 });
        // (the egg in my fingertips, my hand behind it – the camera's above: under my palm it wouldn't be seen; then
        // a thumb in the crack each side, pulling the shell apart)
        if (g.stage === 0) {
          const E = at(g.egg).addScaledVector(UP, -0.01);
          out.sprites.push({ tex, kind: 'egg', st: { qty: 1 }, pos: E, size: 0.12 });
          hand(wi, E.clone().addScaledVector(w.N, 0.045).addScaledVector(UP, 0.04), 'grab', { curl: 0.55, dir: w.N.clone().negate().addScaledVector(UP, -0.5).normalize() });
          ring(st.rimPoint(), 40);
        } else {
          const sp = (g.spread || 0) * 0.5;
          const E = at({ x: g.egg.x - sp, y: g.egg.y }).addScaledVector(UP, -0.01);
          out.sprites.push({ tex, kind: 'egg', st: { qty: 1 }, pos: E, size: 0.11 });
          hand(wi, at({ x: g.egg.x + 30 + sp, y: g.egg.y }).addScaledVector(w.N, 0.03).addScaledVector(UP, 0.02), 'grab', { curl: 0.6 });
          hand(oi, at({ x: g.egg.x - 30 - sp, y: g.egg.y }).addScaledVector(w.N, 0.03).addScaledVector(UP, 0.02), 'grab', { curl: 0.6 });
        }
        break;
      }
      case 'pour': case 'fill': {
        if (g.kind === 'pour' && washing && g.subject && g.subject.type === 'item') {
          // the washing water tipped out of the container, into the basin – tipped on its edge, the
          // other side lifted (not so far the food falls out)
          const base = basin || w.O.clone();
          const it = D && D.items[g.subject.id];
          const tilt = g.pouring ? 0.6 : 0.08, hw = it ? (BOX_HALF[boxSpec(it.kind, it).size] || 0.07) : 0.07, ht = 0.05;
          const pos = base.clone().addScaledVector(w.R, hw * (Math.cos(tilt) - 1)).addScaledVector(UP, hw * Math.sin(tilt));
          out.ov.set(`i:${g.subject.id}`, { pos, size: 0.2, box: { water: this.washWater, tilt, axis: w.N } });
          // (my fist round its rim on the side that lifts, going up with it)
          const rim = pos.clone().addScaledVector(w.R, hw * Math.cos(tilt) - ht * Math.sin(tilt)).addScaledVector(UP, hw * Math.sin(tilt) + ht * Math.cos(tilt));
          hand(wi, rim.addScaledVector(w.R, 0.012), 'grab', { curl: 0.9, dir: w.N.clone().negate() });
          if (g.pouring && this.washWater > 0.03) out.stream = { from: base.clone().addScaledVector(w.R, -hw).addScaledVector(UP, 0.03), to: base.clone().addScaledVector(w.R, -hw - 0.05).addScaledVector(UP, -0.005), color: '#cfe8f8' };
        } else if (g.kind === 'pour' && ph.tip) {
          // A food's container, held over the pot's rim where it was brought – tipped further the
          // longer I hold, toward the pot – the food sliding out and dropping in (from half way it's
          // in the pot, and the container's empty)
          const it = D && D.items[ph.tip], v = Math.min(1, g.v || 0);
          const P = at({ x: MAIN.x + 80, y: MAIN.y - 165 }).addScaledVector(UP, -TIP_LOW), tilt = 0.1 + 1.55 * v;
          if (it && !it.in) out.ov.set(`i:${ph.tip}`, { pos: P.clone(), yaw: out.yaw, box: { tilt, axis: w.N } });
          else if (it) out.boxes.push([ph.tip, { pos: P.clone(), yaw: out.yaw, tilt, axis: w.N }]);
          // (my hand on its far rim, going round with it as it tips)
          const hw = it ? (BOX_HALF[boxSpec(it.kind, it).size] || 0.07) : 0.07, ht = 0.05;
          const rim = P.clone().addScaledVector(w.R, hw * Math.cos(tilt) - ht * Math.sin(tilt)).addScaledVector(UP, hw * Math.sin(tilt) + ht * Math.cos(tilt));
          hand(wi, rim.addScaledVector(w.R, 0.012), 'grab', { curl: 0.9, dir: w.N.clone().negate() }); // (the fist round the rim, which runs away from me)
          const vr = g.subject && g.subject.type === 'vessel' && this.vessels.get(g.subject.id);
          if (g.pouring && v > 0.12 && v < 0.85 && it && vr) {
            const lip = P.clone().addScaledVector(w.R, -0.07).addScaledVector(UP, 0.03), pan = vr.group.position.clone().addScaledVector(UP, vr.h * 0.4);
            const bit = { cut: it.cut && (it.k || 0) >= (it.n || 0) ? it.cut : 'chunks', k: 1, n: 1, bits: 0.1 };
            for (let i = 0; i < 3; i++) { const t = (this.t * 2.4 + i / 3) % 1; out.sprites.push({ tex: null, kind: it.kind, st: bit, pos: lip.clone().lerp(pan, t).addScaledVector(UP, -0.04 * t * t), size: 0.05 }); }
          }
        } else if (g.kind === 'pour') {
          // the jug / pan / bag in my hand, tipped over the pot
          // (held on my right – a pan by its handle, the handle away from the pour – tipped left into the pot)
          const k = vKey(g.source);
          const lip = at({ x: MAIN.x + 80, y: MAIN.y - 165 });
          const tilt = g.pouring ? 1.15 : 0.25;
          const pos = lip.clone().addScaledVector(w.R, 0.06).addScaledVector(UP, -0.08);
          const yaw = Math.atan2(w.N.x, w.N.z);
          if (k) out.ov.set(k, { pos, size: 0.2, yaw, tilt, axis: w.N });
          const vr = k && k[0] === 'v' && this.vessels.get(k.slice(2));
          const grip = vr && GRIP3D[vr.kind];
          if (grip) {
            const q = new THREE.Quaternion().setFromAxisAngle(w.N, tilt).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
            // (the fist along the handle, toward the pan)
            hand(wi, pos.clone().add(grip.clone().applyQuaternion(q)), 'handle', { curl: 1, dir: new THREE.Vector3(-1, 0, 0).applyQuaternion(q) });
          } else hand(wi, pos.clone().addScaledVector(w.R, 0.08).addScaledVector(UP, 0.04), 'grab', { curl: 0.9 });
          if (g.pouring) out.stream = { from: lip.clone().addScaledVector(w.R, -0.03), to: at({ x: MAIN.x, y: MAIN.y - 60 }), color: (st.pourColor && st.pourColor()) || '#c8e4f4' };
        } else {
          // the tap: my right hand on the knob of its lever (pushed up – the water running – while I hold
          // it), my left holding the pan under the spout by its handle
          const F = this.k3.fx[w.fx];
          const lever = F && F.parts.lever ? F.parts.lever.localToWorld(new THREE.Vector3(0.1, 0.03, 0)) : at({ x: 580, y: 200 });
          hand(1, lever.addScaledVector(UP, 0.012), 'hand', { curl: g.pouring ? 0.85 : 0.4 });
          out.lever = { fx: w.fx, on: !!g.pouring };
          const vr = g.subject && g.subject.type === 'vessel' && this.vessels.get(g.subject.id);
          if (vr && F && F.anchors.basin) {
            const at0 = (F.anchors.spout || F.anchors.basin).clone().setY(F.anchors.basin.y + 0.02), yaw = this.sinkYaw(F);
            out.ov.set(`v:${g.subject.id}`, { pos: at0, yaw });
            vr.group.position.copy(at0); vr.group.rotation.set(0, yaw, 0);
            const G = this.sinkGrip(vr, F); hand(0, G.w, G.kind, { curl: 0.95, dir: G.dir });
          }
          const into = vr && vr.group.visible ? vr.group.position.clone().addScaledVector(UP, vr.h * 0.7) : (F && F.anchors.basin ? F.anchors.basin.clone() : w.O.clone());
          if (g.pouring && F && F.anchors.spout) out.stream = { from: F.anchors.spout.clone(), to: into, color: '#cfe8f8' };
        }
        break;
      }
      case 'knob': {
        // the real knob on the stove's front (or the oven's panel)
        const F = this.k3.fx[w.fx];
        const kn = F && F.parts.knobs && F.parts.knobs[Math.min(w.slot || 0, F.parts.knobs.length - 1)];
        const kp = kn ? kn.getWorldPosition(new THREE.Vector3()) : at(st.knobPos());
        hand(wi, kp.clone().addScaledVector(w.N, 0.05), 'hand', { curl: g.turning ? 0.85 : 0.4 });
        out.knob = { fx: w.fx, slot: w.slot || 0, level: (g.ang + 2.4) / 4.8 * 3 };
        if (!g.turning) out.rings.push({ w: kp.clone().addScaledVector(w.N, 0.03), r: 0.045 });
        break;
      }
      case 'tap': {
        // the tap's lever (or the bell, the bin's pedal …): the hand on the real one
        const real = this.workReal(w, st);
        const h = st.hotspot();
        if (real) {
          const off = this.workOffset(w, st), s0 = this.screenOf(at(pt));
          const r2 = this.rayAt(s0.x - off.x, s0.y - off.y);
          hand(wi, r2.at(real.w.distanceTo(this.camera.position), new THREE.Vector3()), 'hand', { curl: p.down ? 0.8 : 0.3 });
          out.rings.push({ w: real.w, r: 0.04 });
        } else if (ph.hot === 'pick' || ph.hot === 'rest') {
          // the board's own knife, peeler, grater: the hand on it (or bringing it back) once the pointer's over it
          const T = this.toolSpot(w, ph.takes), near = T && h && Math.hypot(pt.x - h.x, pt.y - h.y) < h.r;
          const own = near && this.k3.fx[w.fx] && this.k3.fx[w.fx].parts.tools && this.k3.fx[w.fx].parts.tools[ph.takes];
          const lying = ph.takes === 'knife' && own;
          if (own && ph.takes === 'peeler') {
            // (the peeler taken as it lies: the hand onto its handle, palm down, its blade on ahead – not stood up in my
            // fist yet; it's the board's one, drawn where it lies, till I've got it)
            own.updateMatrixWorld(true);
            const along = new THREE.Vector3(0, 1, 0).transformDirection(own.matrixWorld), side = new THREE.Vector3(1, 0, 0).transformDirection(own.matrixWorld);
            hand(wi, own.localToWorld(new THREE.Vector3(0, 0.022, 0)), 'knife', { dir: along.negate(), up: side, curl: 0.85 });
          } else if (own && ph.takes === 'grater') {
            // (the grater, standing: taken by the handle over its top)
            own.updateMatrixWorld(true);
            hand(wi, own.getWorldPosition(new THREE.Vector3()).addScaledVector(UP, 0.006), 'grab', { curl: 0.8 });
          } else if (lying) {
            // (the knife taken as it lies on the board: the hand onto its handle, palm down on its flat, along it)
            const K = this.knifeLying(lying);
            out.tool = { kind: 'knife', grip: K.fist, dir: K.xA, up: K.yA, hand: wi, off: K.K0.clone().sub(K.fist) };
            out.boardToolInHand = `${w.fx}|knife`; // (it's the one in my hand now: not drawn lying there as well)
            hand(wi, K.fist, 'knife', { dir: K.xA, up: K.yA });
          } else toolHand(near ? T.clone().addScaledVector(UP, ph.takes === 'grater' ? 0 : 0.012) : at(pt));
          if (T) out.rings.push({ w: T, r: 0.035 });
        } else {
          toolHand(at(pt));
          if (h) ring(h);
        }
        break;
      }
      case 'door': {
        // (the real door's handle, where it is now – the close-up's door is only how far open it is)
        const hw = this.handleWorld(w.fx) || at(st.doorGrab(g.geo, g.v));
        hand(wi, hw, 'grab', { curl: g.drag ? 0.9 : 0.4 });
        if (!g.drag) out.rings.push({ w: hw.clone(), r: 0.045 });
        break;
      }
      case 'scoop': {
        // (the pot it's scooped from in my other hand, if I hold it – by its handle, just left of the work)
        const fk = def && def.from && `v:${def.from}`, fr = fk && this.vessels.get(def.from);
        if (fr && this.fpSlots.includes(fk) && this.fpGripAt) {
          const mouth = this.scoopHeldAt(w, def.from), base = mouth.clone().addScaledVector(UP, -fr.h * 0.9), yaw = Math.atan2(w.N.x, w.N.z) + Math.PI / 2;
          out.ov.set(fk, { pos: base, yaw });
          const gp = this.fpGripAt(fk, oi, base, yaw);
          if (gp) hand(oi, gp.world, 'handle', { curl: 1, dir: gp.aimAt ? gp.aimAt.clone().negate() : null });
        }
        // (the spoon where the pointer has it on the screen, just over the pots' mouths – not on the work's plane)
        const sw = st.c && this.scoopWorld(w, def, g.n || 2, this.fpSlots.includes(fk));
        const onPots = (q) => { if (!sw) return at(q); const sc = this.screenOf(at(q)), ray = this.rayAt(sc.x, sc.y), y = Math.max(sw.from.y, ...sw.to.map((t) => t.y)) + 0.02; const t = (y - ray.origin.y) / (ray.direction.y || -1e-6); return t > 0 ? ray.at(t, new THREE.Vector3()) : at(q); };
        const S0 = onPots(g.drag && g.pos ? g.pos : pt);
        toolHand(S0);
        if (g.drag && g.pos) out.sprites.push({ tex: this.blobTex(st.scoopColor()), kind: { type: 'blob', c1: st.scoopColor() }, st: {}, pos: S0.clone().addScaledVector(UP, -0.02), size: 0.06 });
        else if (sw) out.rings.push({ w: sw.from, r: 0.05 });
        else ring(st.scoopSource(), 60);
        if (sw) for (const q of sw.to) out.rings.push({ w: q, r: 0.035 });
        else for (const q of st.scoopTargets()) ring(q, 45);
        break;
      }
      case 'chop': {
        // The knife comes down through the food at the next cut (lying turned a little,
        // cut from its right end leftwards), its blade across it, rocking – the heel
        // up, the tip down – as it lifts; the other hand holds it in a claw just
        // behind the blade, fingertips tucked under the knuckles, and walks back
        // along it cut by cut. How high the knife is is the pointer's height
        // over the board (as the close-up has it); off to the side of the food, it
        // goes that way.
        const it = st.subjectItem(), ov = it && out.ov.get(`i:${it.id}`);
        const C = it && cutLine(it.kind, st.k, phaseTarget(ph), boardUnits(it) ? 1 : it.qty);
        if (!ov || !C) { toolHand(at(pt)); break; }
        if (ph.flat) {
          // Crushing (cardamom pods, a garlic clove): the knife on its side over the food, its edge away from
          // me and the tip to the left, my hand on its handle palm down; the heel of the other hand flat on
          // the blade right over the food, pressing it down – as high as the pointer over the board
          const b = st.subjectBox(), lift = p.seen ? Math.max(0, Math.min(1, (b.y1 - 8 - p.y) / (b.y1 - 8 - (b.y0 - 18)))) : 1;
          const xA = w.R.clone().negate().addScaledVector(into, 0.45).normalize();
          const yA = new THREE.Vector3().crossVectors(UP, xA).normalize().multiplyScalar(wi ? 1 : -1); // (the spine toward me)
          // (the blade a little toward me of the pods – they show past its edge)
          const mid = ov.pos.clone().addScaledVector(yA, 0.022).setY(ov.pos.y + C.top * (1 - 0.5 * st.k / Math.max(1, phaseTarget(ph))) + 0.0015 + 0.03 * lift);
          const E = mid.clone().addScaledVector(xA, 0.01).addScaledVector(yA, -KNIFE_EDGE * 0.55); // (the edge, where it'd cut)
          const K0 = E.clone().addScaledVector(xA, -0.08).addScaledVector(yA, KNIFE_EDGE);
          const fist = K0.clone().addScaledVector(xA, -0.013).addScaledVector(yA, -0.006).addScaledVector(UP, 0.006);
          out.tool = { kind: 'knife', grip: fist, dir: xA, up: yA, hand: wi, off: K0.clone().sub(fist) };
          hand(wi, fist, 'knifeFlat', { dir: xA });
          hand(oi, mid.clone().addScaledVector(UP, 0.004).addScaledVector(yA, 0.012), 'rest', { curl: 0.12 });
          break;
        }
        ov.yaw = out.yaw + CUT_TURN;
        const ax = new THREE.Vector3(Math.cos(ov.yaw), 0, -Math.sin(ov.yaw)); // (its length, to the right)
        const blade = new THREE.Vector3().crossVectors(UP, ax).normalize(); // (across it, away from me)
        const b = st.subjectBox(), top2 = b.y0 - (ph.mode === 'mince' ? 10 : 18), board2 = b.y1 - 8;
        const lift = p.seen ? Math.max(0, Math.min(1.6, (board2 - p.y) / (board2 - top2))) : 1.3;
        const off = !p.seen ? 0 : p.x < b.x0 - 40 ? p.x - (b.x0 - 40) : p.x > b.x1 + 60 ? p.x - (b.x1 + 60) : 0;
        const want = C.next + off * w.S;
        const ck = this.chopAt && this.chopAt.id === it.id ? this.chopAt : (this.chopAt = { id: it.id, x: want });
        ck.x += (want - ck.x) * Math.min(1, (this.dt || 0.016) * 14 * BRISK);
        const E = ov.pos.clone().addScaledVector(ax, ck.x).setY(ov.pos.y + 0.001 + lift * (C.top + 0.012));
        const K = this.knifeAt(E, blade, 0.05 + 0.2 * Math.min(1, lift));
        out.tool = { kind: 'knife', grip: K.fist, dir: K.xA, hand: wi, off: K.K0.clone().sub(K.fist) };
        hand(wi, K.fist, 'knife', { dir: K.xA, up: K.yA });
        out.cut = { at: E, ax }; // (the blade's plane: through E, square to ax)
        // (on a touch screen it's held where the second finger is – not at all without one;
        // never nearer the blade than CLAW_GAP, even at the very end of it)
        let hold = ck.x - CLAW_GAP;
        if (st.touchy) { const s2 = st.steadies() && st.steadyAt(); hold = s2 ? Math.min(hold, (s2.x - MAIN.x) * w.S) : null; }
        if (hold != null) {
          hold = Math.min(ck.x - CLAW_GAP, Math.max(C.xL - 0.03, hold));
          const H = ov.pos.clone().addScaledVector(ax, hold).setY(ov.pos.y + C.top + 0.013);
          // (its fingers toward the blade – a little away, the forearm coming in at a slant from my left, not square across)
          hand(oi, H, 'claw', { dir: ax.clone().addScaledVector(blade, 0.55).addScaledVector(UP, -0.35).normalize(), curl: 0.9 });
        }
        break;
      }
      case 'place': {
        // a piece of the topping / the garnish – as it's been cut – between my fingertips, put down where I tap
        const P = at(pt).addScaledVector(UP, 0.012);
        if (ph.piece) out.sprites.push({ tex: this.spriteFor(ph.piece, null, 'slice'), kind: ph.piece, st: { cut: pieceCut(ph.piece, D && D.items[ph.piece]), k: 1, n: 1, bits: 0.01 }, pos: P, size: 0.08 });
        pinch(P, p.down ? 0.75 : 0.6);
        break;
      }
      default: {
        // The salt shaker / the oil bottle upside down over it, the lemon half in my fist, a garlic clove in my
        // fingertips – the thing itself, taken from where it stood (not a stand-in, it left lying there)
        const use = this.useInHand(def, D);
        if (use) {
          const T = at(pt), it = D.items[use.id];
          if (use.how === 'shake' || use.how === 'pour') {
            const H = this.foodHeight(it.kind, it), tilt = use.how === 'shake' ? Math.PI * 0.85 : 2.0;
            const q = new THREE.Quaternion().setFromAxisAngle(w.R, -tilt);
            const mouth = T.clone().addScaledVector(UP, use.how === 'shake' ? 0.05 : 0.07);
            const base = mouth.clone().sub(new THREE.Vector3(0, H, 0).applyQuaternion(q));
            out.ov.set(`i:${use.id}`, { pos: base, q, yaw: 0, size: 0.1 });
            const along = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
            hand(wi, base.clone().addScaledVector(along, -H * 0.5), 'tool', { dir: along, curl: 0.95 });
            if (p.down && Math.random() < 0.6) this.puff(mouth, 'grain', use.how === 'shake' ? use.col : null);
            if (p.down && use.how === 'pour') out.stream = { from: mouth, to: T.clone(), color: use.col ? `rgb(${use.col.map((c) => Math.round(c * 255)).join(',')})` : '#d8b84a' };
          } else if (use.how === 'squeeze') {
            // (cut side down, my fist closing round it as I squeeze – the juice dripping)
            const L = T.clone().addScaledVector(UP, 0.07);
            out.ov.set(`i:${use.id}`, { pos: L, q: new THREE.Quaternion().setFromAxisAngle(w.R, Math.PI), st: { cut: 'halves', k: 1, n: 1, bits: 0.5 }, size: 0.08 });
            hand(wi, L.clone().addScaledVector(UP, 0.03).addScaledVector(w.N, 0.012), 'grab', { curl: p.down ? 1 : 0.65 });
            if (p.down && Math.random() < 0.5) this.puff(L.clone().addScaledVector(UP, -0.03), 'grain', [0.98, 0.93, 0.55]);
          } else if (use.how === 'sprinkle') {
            // (a pinch from the sack, rubbed between my fingertips over it)
            pinch(T.clone().addScaledVector(UP, 0.06), 0.75);
            if (p.down && Math.random() < 0.6) this.puff(T.clone().addScaledVector(UP, 0.055), 'grain', use.col);
          } else {
            // (a piece pinched, rubbed over it – a garlic clove on the toast)
            const P = T.clone().addScaledVector(UP, 0.012);
            out.sprites.push({ tex: null, kind: it.kind, st: { cut: pieceCut(it.kind, it), k: 1, n: 1, bits: 0.01 }, pos: P, size: 0.06 });
            pinch(P, 0.7);
          }
          break;
        }
        // Grating: the box grater stands on the board, left of the food, my left hand on its
        // handle; my right hand rubs the food up and down its face as high as the pointer – smaller
        // with each stroke – and the shreds pile up at its foot.
        const gIt = g.kind === 'strokes' && ph.tool === 'grater' && st.subjectItem(), gOv = gIt && out.ov.get(`i:${gIt.id}`);
        if (gOv) {
          const G = w.O.clone().addScaledVector(w.R, -0.09), yaw = out.yaw + Math.PI / 2;
          out.tool = { kind: 'grater', at: { pos: G.clone().addScaledVector(UP, 0.115), yaw }, hand: oi };
          hand(oi, G.clone().addScaledVector(UP, 0.116), 'grab', { curl: 0.9 });
          const b = st.subjectBox(), C = cutLine(gIt.kind, 0, 1), rad = C ? C.top / 2 : 0.02;
          const up = p.seen ? Math.max(0, Math.min(1, (b.cy + 90 - p.y) / 180)) : 0.5;
          const frac = Math.min(1, st.k / Math.max(1, phaseTarget(ph))), s = 1 - 0.5 * frac;
          const F = G.clone().addScaledVector(w.R, 0.022 + rad * s).addScaledVector(UP, 0.02 + rad * s + up * 0.05);
          gOv.pos = F.clone().addScaledVector(UP, -rad * s);
          gOv.yaw = out.yaw + Math.PI / 2;
          gOv.st = { cut: null, k: 0, n: 0 };
          gOv.scale = s;
          hand(wi, F.clone().addScaledVector(w.R, rad * s * 0.7).addScaledVector(UP, rad * s * 0.9), 'hand', { curl: 0.7, dir: w.R.clone().negate().addScaledVector(UP, -0.6).normalize() });
          if (frac > 0) out.sprites.push({ tex: null, kind: gIt.kind, st: { cut: 'grated', k: 1, n: 1, bits: frac }, pos: G.clone().addScaledVector(w.R, 0.036).addScaledVector(w.N, 0.012), size: 0.1 }); // (just out from its face, under the food)
          break;
        }
        // Peeling by hand – an egg's shell, garlic's papery skin, an onion's, a cabbage's leaves: my other hand holds
        // it from its side (its top in sight); my fingertips take hold of its edge where I pressed and pull a piece
        // off, out to where the pointer's gone; what's come off so far lies beside it
        const pIt = g.kind === 'peel' && ph.tool === 'hand' && st.subjectItem(), pOv = pIt && out.ov.get(`i:${pIt.id}`);
        if (pOv && !pOv.hide) {
          const pst = pOv.st ? { ...pIt, ...pOv.st } : pIt, leaves = def && def.do === 'separate';
          const C = pOv.pos.clone(), h = this.foodHeight(pIt.kind, pst), rad = Math.min(0.07, Math.max(0.022, h * 0.62));
          hand(oi, C.clone().addScaledVector(w.R, -(rad + 0.006)).addScaledVector(UP, h * 0.5), 'side', { curl: 0.55 });
          const skin = PEEL_COL[pIt.kind] || (INGREDIENTS[pIt.kind] && INGREDIENTS[pIt.kind].art.c1) || '#c98a3c';
          if (p.down && g.start) {
            const pull = at(pt).sub(at(g.start)).setY(0);
            if (pull.length() > 0.12) pull.setLength(0.12);
            const edge = at(g.start).sub(C).setY(0);
            if (edge.lengthSq() < 1e-6 || edge.dot(w.R) < 0) edge.copy(w.R);
            edge.setLength(rad * 0.85);
            const P = C.clone().add(edge).addScaledVector(UP, h * 0.75).add(pull);
            pinch(P, 0.75);
            const away = pull.lengthSq() > 1e-6 ? pull.clone().normalize() : edge.clone().normalize();
            out.sprites.push(leaves ? { tex: null, kind: pIt.kind, st: { cut: 'leaves', k: 1, n: 1, qty: 1 }, pos: P.clone().addScaledVector(away, 0.045).addScaledVector(UP, -0.03), size: 0.12 } : { tex: null, kind: { type: 'flake', c1: skin }, st: {}, pos: P.clone().addScaledVector(UP, -0.006), size: 0.04 });
          } else hand(wi, C.clone().addScaledVector(w.R, rad + 0.03).addScaledVector(UP, 0.03), 'hand', { curl: 0.35 });
          const off = Math.ceil(Math.min(1, Number(pst.peeled) || 0) * 5);
          if (!leaves && off > 0) out.sprites.push({ tex: null, kind: { type: 'scraps', c1: skin, n: off }, st: {}, pos: C.clone().addScaledVector(w.R, rad + 0.075).addScaledVector(w.N, 0.035), size: 0.08 });
          break;
        }
        // Turning what's been cut (the strips a quarter round): my hand flat on it, turning with it – not off round
        // the pointer's circle
        if (g.kind === 'circle' && ph.turn) {
          const it = st.subjectItem(), ov = it && out.ov.get(`i:${it.id}`), C = ov ? ov.pos.clone() : w.O.clone(), a = g.lastAng || 0;
          hand(wi, C.addScaledVector(w.R, Math.cos(a) * 0.012).addScaledVector(w.N, Math.sin(a) * 0.012).addScaledVector(UP, 0.028), 'hand', { curl: 0.2, dir: w.N.clone().negate().applyAxisAngle(UP, -(g.rot || 0)).addScaledVector(UP, -0.4).normalize() });
          break;
        }
        // Cleaning freehand: the sponge on the board / the pot's floor right under the pointer – pressed down on it while
        // held – the other hand steadying the pot by its side, or flat on the board's corner
        if (g.kind === 'paint' && ph.clean && def) {
          const vid = st.c.st && st.c.st.vid, cw = this.cleanWorld(w, pt, def, vid);
          if (cw) {
            toolHand(cw.P.clone().addScaledVector(UP, p.down ? 0.003 : 0.022));
            const S = cw.S;
            if (def.do === 'scrub') { const sd = S.obj.localToWorld(new THREE.Vector3(-S.hx * 1.05, S.y + 0.05, 0)); hand(oi, sd, 'side', { curl: 0.6 }); }
            else hand(oi, S.obj.localToWorld(new THREE.Vector3(-S.hx * 0.85, S.y + 0.004, S.hz * 0.55)), 'rest');
            break;
          }
        }
        // knife, peeler, grater, spoon, whisk, brush … – and the other hand on the food
        toolHand(at(pt));
        const s2 = st.steadies && st.steadies() && st.steadyAt();
        if (s2) hand(oi, at(s2).addScaledVector(UP, 0.01), 'claw');
        // the pan jumps when you toss it
        if (g.kind === 'flick' && g.toss) {
          const k = vKey(g.subject);
          const rec = k && k[0] === 'v' && this.vessels.get(k.slice(2));
          if (rec) out.ov.set(k, { pos: rec.group.position.clone().setY(w.O.y + Math.sin(Math.min(1, g.toss) * Math.PI) * 0.12), yaw: rec.group.rotation.y });
        }
        break;
      }
    }
    // a food worked several at a time: its container beside the board with those still to do in it
    // (one less while I carry one out), the pile of those done at the side (but while it's gathered
    // up), and just the one being worked on where the work is
    const uId = st.c && st.c.def && st.c.def.item, uIt = uId && D && D.items[uId], U = uIt && boardUnits(uIt);
    if (U) {
      const left = U.left - (g.kind === 'drag' && g.source && g.source.fromBox && g.drag ? 1 : 0);
      out.boxes = out.boxes.filter(([id]) => id !== uId);
      out.boxes.push([uId, { pos: this.boxSpot(w), yaw: out.yaw, st: left > 0 ? { ...uIt, qty: left, extra: 0, cut: null, k: 0, n: 0, peeled: 0 } : null }]);
      if (U.pile && !(g.kind === 'drag' && g.source && g.source.pieces)) out.sprites.push({ tex: null, kind: uIt.kind, st: U.pile, pos: this.pileSpot(w), size: 0.12 });
      const ov = out.ov.get(`i:${uId}`);
      if (ov && !ov.hide && !(g.source && (g.source.fromBox || g.source.unit || g.source.pieces))) { if (U.cur) ov.st = { ...U.cur, ...(ov.st || {}) }; else ov.hide = true; }
    }
    // the grater standing where it's used, the peeler in my other hand – held between uses
    if (restTool === 'grater' && !out.tool) out.tool = { kind: 'grater', at: { pos: w.O.clone().addScaledVector(w.R, -0.09).addScaledVector(UP, 0.115), yaw: out.yaw + Math.PI / 2 } };
    if (restTool === 'peeler' && !out.tool && !out.hands[oi]) {
      const gp = w.O.clone().addScaledVector(w.R, 0.14).addScaledVector(w.N, 0.06).addScaledVector(UP, 0.07);
      out.tool = { kind: 'peeler', grip: gp, dir: UP.clone().addScaledVector(w.N, 0.3).normalize(), hand: oi };
      hand(oi, gp, 'tool');
    }
    // the knife held at rest (between knife work: turning the strips …) – its tip on the board, at the right
    if (restTool === 'knife' && !out.tool && !out.hands[oi]) {
      // (out on the board's right, its tip resting on it – the forearm laid along it, not drawn back to my side)
      const K = this.knifeAt(w.O.clone().addScaledVector(w.R, 0.1).addScaledVector(w.N, -0.1).setY(w.O.y + 0.012), w.N.clone().negate().addScaledVector(w.R, -0.4).normalize(), 0.3);
      out.tool = { kind: 'knife', grip: K.fist, dir: K.xA, up: K.yA, hand: oi, off: K.K0.clone().sub(K.fist) };
      hand(oi, K.fist, 'knife', { dir: K.xA, up: K.yA });
    }
    // a second finger on a touch screen is my other hand
    if (st.ptr2 && !out.hands[oi]) hand(oi, at(st.ptr2), 'hand', { curl: 0.7 });
    // a hand with nothing to do rests on the worktop beside the work (where it's clear – worked out
    // once a step), and the camera stands back far enough to see both my hands
    if (!this.restAt || this.restAt.g !== g || this.restAt.fx !== w.fx) {
      const me = view.cooks.find((c) => c.me), F = this.fpCam;
      const body = out.body || (me && F ? { pos: this.eyeAt(me.x, me.y, F.yaw, view.eyeOff || 0, 0), fwd: new THREE.Vector3(Math.sin(F.yaw), 0, Math.cos(F.yaw)) } : null);
      const clutter = [...out.ov.values(), ...out.boxes.map(([, b]) => b)].filter((o) => o.pos && !o.hide).map((o) => ({ p: o.pos, r: 0.1 }));
      const spots = body ? this.benchRest(body, { O: w.O, clutter }) : [null, null];
      // (in sight: the work, both hands resting there – and where the working ones start, the pan by its handle …)
      const seen = [];
      for (const r of spots) if (r) seen.push(r.w.clone().addScaledVector(r.dir, 0.07), r.w.clone().addScaledVector(r.dir, -0.08).addScaledVector(UP, 0.04));
      for (const h of out.hands) if (h && h.w) seen.push(h.w.clone());
      this.restAt = { g, fx: w.fx, spots, seen };
    }
    out.rest = this.restAt.spots;
    this.fitCam(out.cam, [out.cam.look, ...this.restAt.seen]);
    // (coring: the knife's tip cut round the core as far as it's gone – it's out once it's gone all the way round)
    if (def && def.do === 'core' && g.kind === 'circle' && D && D.items[def.item] && !(D.items[def.item].cored >= 1)) D.items[def.item].cored = Math.min(0.97, Math.abs(g.acc || 0) / (Math.PI * 2));
    // (turning the strips a quarter round to cut them across: they turn as far as I've turned them)
    if (ph.turn && g.kind === 'circle' && def && D && D.items[def.item]) D.items[def.item].turned = Math.round(Math.min(1, Math.abs(g.acc || 0) / (Math.PI / 2)) * 12) / 12;
    // (stirring, whisking round a pot: what's in it goes round with the spoon – partly – and stays where it went)
    if (g.kind === 'circle' && g.subject && g.subject.type === 'vessel' && !ph.turn) {
      const S = this.spins.get(g.subject.id) || { a: 0, base: 0, g: null };
      if (S.g !== g) { S.base = S.a; S.g = g; }
      S.a = S.base + (g.acc || 0) * 0.4;
      this.spins.set(g.subject.id, S);
    }
    this.work = out;
  }

  // (where a food's container stands beside the board while it's out on it – and where it
  // stays, once what's cut up is gathered into it)
  boxSpot(w) { return w.O.clone().addScaledVector(w.R, 0.19).addScaledVector(w.N, 0.1); }
  // (the stack of empty food containers on the worktop beside the board)
  nestSpot(w) {
    const F = this.k3.fx[w.fx], n = F && (F.parts.nest ? F.parts.nest.getWorldPosition(new THREE.Vector3()) : F.anchors.nest);
    return n ? n.clone() : w.O.clone().addScaledVector(w.R, 0.39).addScaledVector(w.N, -0.06).setY(w.O.y - 0.025);
  }
  // (portioning a bunch: its container in the middle of the board, the new one on its right – clear of
  // the board's own tools on the left and the stack of empty containers beyond its right edge)
  portionSpot(w, side) { return side < 0 ? w.O.clone().addScaledVector(w.R, -0.06).addScaledVector(w.N, -0.03) : w.O.clone().addScaledVector(w.R, 0.2).addScaledVector(w.N, 0.06); }
  // (several worked one at a time: where those done pile up, at the board's back right)
  pileSpot(w) { return w.O.clone().addScaledVector(w.R, 0.13).addScaledVector(w.N, -0.085); }
  // the point on the board under this point of the work plane, as it's seen (what the pointer's over)
  boardAt(w, P) {
    const s = this.screenOf(P), ray = this.rayAt(s.x, s.y);
    if (Math.abs(ray.direction.y) < 1e-4) return P.clone().setY(w.O.y);
    return ray.at((w.O.y - ray.origin.y) / ray.direction.y, new THREE.Vector3());
  }
  // A pot / pan at the sink stands under the spout with its handle toward my left hand, a little toward me
  // (the right one's on the tap's lever). sinkGrip: where my left hand holds it there.
  sinkYaw(F) {
    const N = F.front, R = new THREE.Vector3().crossVectors(N.clone().negate(), UP).normalize();
    const d = R.clone().multiplyScalar(-0.8).addScaledVector(N, 0.6);
    return Math.atan2(-d.z, d.x);
  }
  sinkGrip(rec, F) {
    const yaw = rec.group.rotation.y, gr = GRIP3D[rec.kind];
    if (gr) {
      const off = new THREE.Vector3(gr.x * Math.cos(yaw) + gr.z * Math.sin(yaw), gr.y, -gr.x * Math.sin(yaw) + gr.z * Math.cos(yaw));
      return { w: rec.group.position.clone().add(off), kind: 'handle', dir: off.clone().setY(0).negate().normalize() };
    }
    // (no long handle – a pot by its side handle, a bowl by its rim: the side to my left)
    const N = F.front, R = new THREE.Vector3().crossVectors(N.clone().negate(), UP).normalize();
    return { w: rec.group.position.clone().addScaledVector(R, -(rec.r + 0.025)).addScaledVector(UP, rec.h * 0.85), kind: 'grab', dir: null };
  }

  // (the board's own knife, peeler or grater, where it lies: its handle)
  toolSpot(w, t) {
    const F = this.k3.fx[w.fx], o = F && F.parts.tools && F.parts.tools[t];
    if (!o) return null;
    o.updateMatrixWorld(true);
    return o.localToWorld(t === 'knife' ? new THREE.Vector3(-0.016, -0.003, 0) : t === 'grater' ? new THREE.Vector3(0, -0.012, 0) : new THREE.Vector3(0, -0.004, 0));
  }

  // what was just put in a container (and the bunch's own one, with what's left) stays where it was put
  commitBoxing() {
    const B = this.boxing, M = this.boxedAt || (this.boxedAt = new Map());
    if (!B) return;
    M.set(B.id, B);
    if (B.rest) M.set(B.rest.id, B.rest);
  }

  // The knife in my hand: its edge at E (the middle of it), the blade pointing d
  // (level), its tip rocked down by tilt – the knife's own origin (chefKnife's)
  // and my fist on its handle there; xA: along it, tip-wards.
  knifeAt(E, d, tilt) {
    const xA = d.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(UP, -Math.sin(tilt)).normalize();
    const zA = new THREE.Vector3().crossVectors(xA, UP).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
    const K0 = E.clone().addScaledVector(xA, -0.08).addScaledVector(yA, KNIFE_EDGE);
    return { xA, yA, K0, fist: K0.clone().addScaledVector(xA, -0.013).addScaledVector(yA, -0.006) };
  }
  // the knife lying somewhere (the board's own): taken as it lies – its fist point, its length, its spine's way
  knifeLying(o) {
    o.updateMatrixWorld(true);
    const xA = new THREE.Vector3(1, 0, 0).transformDirection(o.matrixWorld), yA = new THREE.Vector3(0, 1, 0).transformDirection(o.matrixWorld);
    const K0 = o.getWorldPosition(new THREE.Vector3());
    return { xA, yA, K0, fist: K0.clone().addScaledVector(xA, -0.013).addScaledVector(yA, -0.006) };
  }

  // a little round spoonful (scooping)
  blobTex(color) {
    const key = `blob|${color}`;
    let tex = this.texCache && this.texCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = color; x.strokeStyle = '#3a2a24'; x.lineWidth = 4;
    x.beginPath(); x.ellipse(32, 40, 24, 16, 0, 0, Math.PI * 2); x.fill(); x.stroke();
    tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    (this.texCache || (this.texCache = new Map())).set(key, tex);
    return tex;
  }

  // the rings showing where to put things / take hold, and the water / a pour running
  updateWorkFx(dt) {
    const W = this.work;
    if (!this.workFx) {
      this.workFx = { rings: [], stream: null };
      const sm = new THREE.MeshBasicMaterial({ color: '#cfe8f8', transparent: true, opacity: 0.75, depthWrite: false });
      this.workFx.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 1, 10, 1, true), sm);
      this.workFx.stream.visible = false;
      this.scene.add(this.workFx.stream);
    }
    const fx = this.workFx;
    // cleaning a board: the dish soap stands beside it
    if (!fx.soap) {
      fx.soap = new THREE.Group();
      fx.soap.add(cyl(0.026, 0.028, 0.12, mat('#4cbf5c', { rough: 0.25, opacity: 0.92 }), 0, 0, 0, 14));
      fx.soap.add(cyl(0.012, 0.012, 0.02, mat('#f2f2f2', { rough: 0.4 }), 0, 0.12, 0, 10));
      fx.soap.add(box(0.03, 0.008, 0.01, mat('#f2f2f2', { rough: 0.4 }), 0.01, 0.14, 0));
      this.scene.add(fx.soap);
    }
    const soapAt = W && W.washing && W.washing.soap;
    fx.soap.visible = !!soapAt && this.firstPerson;
    if (soapAt) fx.soap.position.copy(soapAt);
    const rings = (W && W.rings) || [];
    while (fx.rings.length < rings.length) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 10;
      this.scene.add(m);
      fx.rings.push(m);
    }
    fx.rings.forEach((m, i) => {
      const r = rings[i];
      m.visible = !!r;
      if (!r) return;
      m.position.copy(r.w);
      m.lookAt(this.camera.position);
      m.scale.setScalar(Math.max(0.02, r.r) * (1 + Math.sin(this.t * 6) * 0.06));
    });
    // the tool in my hand (first person at work)
    const T = W && W.tool;
    if (!T || !this.firstPerson) { if (fx.tool) fx.tool.visible = false; } else {
      if (!fx.tool || fx.toolKind !== T.kind) {
        if (fx.tool) this.scene.remove(fx.tool);
        fx.tool = T.kind === 'knife' ? chefKnifeMesh() : T.kind === 'peeler' ? peelerMesh() : T.kind === 'grater' ? graterMesh() : WORK_UTENSIL[T.kind] ? utensilMesh(WORK_UTENSIL[T.kind]) : toolMesh(T.kind);
        fx.toolKind = T.kind;
        fx.tool.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
        this.scene.add(fx.tool);
      }
      fx.tool.visible = true;
      // (standing where it's used – the grater on the board – or in the fist itself, where the hand got to)
      if (T.at) { fx.tool.position.copy(T.at.pos); fx.tool.quaternion.setFromAxisAngle(UP, T.at.yaw); } else {
      fx.tool.position.copy(this.fpArms.group.visible ? this.fpArms.fist(T.hand) : T.grip);
      if (T.off) fx.tool.position.add(T.off);
      if (T.kind === 'knife' && this.fpArms.group.visible && this.fpArms.hands[T.hand] && this.fpArms.hands[T.hand].hold === 'knife') {
        // (in the hand, as the hand holds it – the knife grip's: KNIFE – wherever the hand's got to)
        const xA = this.fpArms.handDir(T.hand, KNIFE.axis).normalize(), u0 = this.fpArms.handDir(T.hand, KNIFE.up);
        const yA = u0.addScaledVector(xA, -u0.dot(xA)).normalize(), zA = new THREE.Vector3().crossVectors(xA, yA);
        fx.tool.position.copy(this.fpArms.handPoint(T.hand, KNIFE.at));
        fx.tool.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
      } else if (T.kind === 'knife') {
        // blade along x, its edge down (or, given the spine's way – up – on its side)
        const xA = T.dir.clone().normalize();
        const zA = T.up ? new THREE.Vector3().crossVectors(xA, T.up).normalize() : new THREE.Vector3().crossVectors(xA, UP).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
        fx.tool.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
      } else fx.tool.quaternion.setFromUnitVectors(UP, T.dir); // (hanging from the fist, leaning toward me)
      }
    }
    // a lid in my hand (a towel under it), and lids lying aside where they were put down
    fx.lids = fx.lids || new Map();
    const lidsNow = new Map();
    if (W && W.lid) lidsNow.set('hand', W.lid);
    const D = this.lastD;
    for (const [vid, pk] of this.lidsAside || []) {
      const v = D && D.vessels[vid];
      if (!v || v.lid || !this.vessels.has(vid)) { this.lidsAside.delete(vid); continue; }
      if (!(W && W.lid && W.lid.vid === vid)) lidsNow.set(vid, { vid, base: pk.base, towel: false });
    }
    for (const [key, L] of lidsNow) {
      const vr = this.vessels.get(L.vid);
      if (!vr) continue;
      let m = fx.lids.get(key);
      if (!m || m.vid !== L.vid) {
        if (m) { this.scene.remove(m.lid); this.scene.remove(m.towel); }
        m = { vid: L.vid, lid: vr.lid.clone(), towel: vr.towel.clone() };
        this.scene.add(m.lid, m.towel);
        fx.lids.set(key, m);
      }
      m.lid.visible = true;
      m.lid.position.copy(L.base);
      m.towel.visible = !!L.towel;
      m.towel.position.copy(L.base).addScaledVector(UP, -0.004);
    }
    for (const [key, m] of fx.lids) if (!lidsNow.has(key)) { m.lid.visible = false; m.towel.visible = false; }
    const S = W && W.stream;
    fx.stream.visible = !!S;
    if (S) {
      const len = S.from.distanceTo(S.to);
      fx.stream.position.copy(S.from).lerp(S.to, 0.5);
      fx.stream.quaternion.setFromUnitVectors(UP, S.from.clone().sub(S.to).normalize());
      fx.stream.scale.set(0.012, len, 0.012);
      fx.stream.material.color.set(S.color);
      if (Math.random() < dt * 20) this.puff(S.to.clone(), 'drop');
    }
  }

  // Is this cook standing between the camera and what I'm facing (or what's on it)?
  blocksView(c, view) {
    if (this.firstPerson || !view.target) return false;
    const F = this.k3.fx[view.target];
    if (!F) return false;
    const A = F.anchors;
    const pts = [A.board, A.basin, A.top, ...(A.spots || [])].filter(Boolean);
    if (!pts.length) pts.push(new THREE.Vector3(F.f.x + F.f.w / 2, topHeight(F.f), F.f.y + F.f.h / 2));
    const cam = this.camera.position;
    const near = cam.distanceTo(new THREE.Vector3(c.x, 0.4, c.y));
    const feet = this.project(c.x, 0, c.y), head = this.project(c.x, 1.15, c.y); // (with the hat)
    const half = Math.abs(feet.y - head.y) * 0.4;
    return pts.some((tp) => {
      if (cam.distanceTo(tp) <= near) return false;
      const t = this.project(tp.x, tp.y, tp.z);
      return t.x > feet.x - half && t.x < feet.x + half && t.y > head.y - 8 && t.y < feet.y + 8;
    });
  }

  // ------------------------------------------------------------------ highlights

  buildMarker() {
    const g = new THREE.Group();
    const glow = mat('#ffbe28', { emissive: '#ffb020', ei: 1.4, rough: 0.4 });
    const arrow = cyl(0.0, 0.07, 0.12, glow, 0, 0, 0, 12);
    arrow.rotation.x = Math.PI;
    arrow.position.y = 0.12;
    g.add(arrow);
    g.add(ring(0.42, 0.014, mat('#ffd060', { emissive: '#ffc040', ei: 1.2, opacity: 0.85 }), 0, -0.7, 0, 32));
    g.visible = false;
    return g;
  }

  updateMarker(view) {
    const m = this.marker;
    // (first person: no marker over what I face – the dot in the middle is enough)
    const F = !this.firstPerson && view.target && this.k3.fx[view.target];
    if (F) {
      const f = F.f;
      const h = topHeight(f);
      m.visible = true;
      m.position.set(f.x + f.w / 2, h + 0.35 + Math.sin(this.t * 5) * 0.04, f.y + f.h / 2);
      m.children[1].position.y = -(h + 0.35) + 0.01;
      m.children[1].scale.setScalar(Math.max(f.w, f.h) * 0.9);
    } else m.visible = false;
    this.updateGlow(view);
  }

  // What's next glows a little: the equipment (the fridge, the sink, the
  // stove …) and the things (the pan on the shelf, the eggs in the fridge) –
  // their own surfaces lit along the rims, breathing. view.guide: fixture ids
  // and thing keys ('v:pan', 'i:egg').
  updateGlow(view) {
    const want = view.guide || new Set();
    GLOW_MAT.uniforms.uK.value = GLOW_THING.uniforms.uK.value = 0.6 + 0.4 * Math.sin(this.t * 2.6);
    const on = new Set(), things = new Set();
    for (const key of want) {
      const F = this.k3.fx[key];
      if (F) {
        const g = this.fixtureGhost(key, F);
        if (g) on.add(g);
        for (const o of F.live || []) on.add(o);
        continue;
      }
      // things in 3D (the room view's cartoon food is a standee: its place glows instead)
      const obj = key[0] === 'v' ? this.vessels.get(key.slice(2))?.group : this.firstPerson ? this.foods.get(`item:${key.slice(2)}`)?.g : null;
      if (obj && obj.visible) { on.add(obj); things.add(obj); }
    }
    for (const o of this.glowing || []) if (!on.has(o)) setGhost(o, false);
    for (const o of on) setGhost(o, true, things.has(o) ? GLOW_THING : GLOW_MAT);
    this.glowing = on;
  }
  // a fixture's static meshes (baked in with the room) as one rim-lit copy, made the first time it glows
  fixtureGhost(id, F) {
    this.ghosts = this.ghosts || new Map();
    if (this.ghosts.has(id)) return this.ghosts.get(id);
    let ghost = null;
    if (F.src) {
      const geos = [];
      F.src.updateMatrixWorld(true);
      F.src.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.userData.glow) return;
        const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal') geo.deleteAttribute(n);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.clearGroups();
        geo.applyMatrix4(o.matrixWorld);
        geos.push(geo);
      });
      const merged = geos.length ? mergeGeometries(geos, false) : null;
      for (const g of geos) g.dispose();
      if (merged) {
        ghost = new THREE.Mesh(merged, GLOW_MAT);
        ghost.userData.glow = true;
        ghost.renderOrder = 4;
        ghost.raycast = () => {};
        ghost.visible = false;
        this.guides.add(ghost);
      }
    }
    this.ghosts.set(id, ghost);
    return ghost;
  }

  // first person: where my hand touches a fixture (where I look, on its top, in reach) – or the air before me
  touchPoint(fid) {
    const F = fid && this.k3.fx[fid];
    const c = this.viewCenter();
    const ray = this.rayAt(c.x, c.y);
    if (!F) return ray.at(0.45, new THREE.Vector3());
    const f = F.f, top = topHeight(f);
    let p = null;
    if (top < this.camera.position.y - 0.1 && ray.direction.y < -0.05) {
      const t = (top - ray.origin.y) / ray.direction.y;
      if (t > 0 && t < 1.6) p = ray.at(t, new THREE.Vector3());
    }
    if (!p) return ray.at(0.5, new THREE.Vector3()); // (a tall thing: its front, where I look)
    p.x = Math.max(f.x + 0.06, Math.min(f.x + f.w - 0.06, p.x));
    p.z = Math.max(f.y + 0.06, Math.min(f.y + f.h - 0.06, p.z));
    p.y = top + 0.015;
    return p;
  }

  // ------------------------------------------------------------------ Şakir
  // A big, smiling, red, see-through ghost of a ball, a ghostly tail behind
  // him: he drifts in slowly to the food on the counter, bumps it – it flies
  // off onto the floor – has a laugh and floats off, fading.
  buildSakir() {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 20), new THREE.MeshStandardMaterial({ color: '#ff3a3a', emissive: '#ff1a1a', emissiveIntensity: 0.4, roughness: 0.15, transparent: true, opacity: 0.42, depthWrite: false }));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), new THREE.MeshBasicMaterial({ color: '#ff8a8a', transparent: true, opacity: 0.28, depthWrite: false }));
    const g = new THREE.Group();
    g.add(body, core);
    const faces = { happy: sakirFace(false), laugh: sakirFace(true) };
    const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: faces.happy, transparent: true, depthWrite: false }));
    face.scale.set(0.44, 0.44, 1);
    g.add(face);
    const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture('Şakir'), transparent: true, depthTest: false, depthWrite: false }));
    name.scale.set(0.34, 0.11, 1);
    name.position.y = 0.44;
    name.renderOrder = 12;
    g.add(name);
    const tail = [];
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(body.geometry, new THREE.MeshStandardMaterial({ color: '#ff3a3a', emissive: '#ff1a1a', emissiveIntensity: 0.3, transparent: true, opacity: 0.22 - i * 0.04, depthWrite: false }));
      t.scale.setScalar(0.72 - i * 0.12);
      t.visible = false;
      this.scene.add(t);
      tail.push(t);
    }
    g.visible = false;
    this.scene.add(g);
    return { g, body, core, face, faces, name, tail, hist: [], n: 0, t: 0, drops: [] };
  }
  updateSakir(view, dt) {
    const R = this.sakirRig || (this.sakirRig = this.buildSakir());
    const sk = view.C && view.C.sakir;
    // the food he knocked off, falling to the floor and lying there a while
    R.drops = R.drops.filter((d) => {
      d.life += dt;
      if (!d.still) {
        d.v.y -= 9.8 * dt;
        d.o.position.addScaledVector(d.v, dt);
        d.o.rotation.x += d.spin.x * dt; d.o.rotation.z += d.spin.z * dt;
        if (d.o.position.y <= 0.02) { d.o.position.y = 0.02; if (Math.abs(d.v.y) < 0.6) d.still = true; d.v.y = -d.v.y * 0.3; d.v.x *= 0.5; d.v.z *= 0.5; }
      }
      if (d.life > 7) { this.scene.remove(d.o); return false; }
      return true;
    });
    if (!sk) { R.g.visible = false; R.tail.forEach((t) => { t.visible = false; }); R.hist = []; return; }
    if (sk.n !== R.n) {
      // here he comes: from the room, toward the food lying on the counter
      R.n = sk.n; R.t = 0; R.hitDone = false; R.hist = [];
      const F = this.k3.fx[sk.fx];
      const shown = this.foods.get(`item:${sk.id}`), spr = this.sprites.get(`item:${sk.id}`);
      const vis = shown && shown.g.visible ? shown.g : spr && spr.visible ? spr : null;
      R.P = vis ? vis.position.clone() : F ? (F.anchors.board || F.anchors.top || new THREE.Vector3(F.f.x + 0.5, COUNTER_H, F.f.y + 0.5)).clone() : new THREE.Vector3();
      R.front = F ? F.front.clone() : new THREE.Vector3(0, 0, 1);
      R.side = new THREE.Vector3().crossVectors(R.front, UP).normalize();
      R.from = R.P.clone().addScaledVector(R.front, 2.6).addScaledVector(R.side, 1.3).addScaledVector(UP, 0.9);
      R.dropSrc = vis;
      R.face.material.map = R.faces.happy; R.face.material.needsUpdate = true;
    }
    R.t += dt;
    const T = SAKIR.travel, A = SAKIR.after, t = R.t;
    const smooth = (u) => u * u * (3 - 2 * u);
    let pos, fade = 1;
    const at = R.P.clone().addScaledVector(UP, 0.26).addScaledVector(R.front, 0.14);
    if (t < T) {
      const u = Math.min(1, t / T);
      pos = R.from.clone().lerp(at, smooth(u)).addScaledVector(UP, Math.sin(t * 2.2) * 0.06 * (1 - u * 0.5)).addScaledVector(R.side, Math.sin(t * 1.3) * 0.15 * (1 - u));
      fade = Math.min(1, t / 1.2);
    } else {
      // the bump – then a laugh, and off he floats, fading
      if (!R.hitDone && sk.hit) {
        R.hitDone = true;
        R.bumpT = 0;
        R.face.material.map = R.faces.laugh; R.face.material.needsUpdate = true;
        this.glides.delete(`i:${sk.id}`); // (the fresh ones are simply back where they're kept)
        if (!sk.miss && R.dropSrc) {
          const o = R.dropSrc.clone();
          o.position.copy(R.P);
          o.visible = true;
          this.scene.add(o);
          R.drops.push({ o, v: R.front.clone().multiplyScalar(0.9).addScaledVector(R.side, -0.5).addScaledVector(UP, 1.4), spin: new THREE.Vector3(6, 0, 4), life: 0, still: false });
        }
      }
      const u = Math.min(1, (t - T) / A);
      pos = at.clone().addScaledVector(R.front, 1.6 * u * u).addScaledVector(UP, 1.2 * u + Math.sin(t * 6) * 0.03).addScaledVector(R.side, -0.8 * u);
      fade = 1 - u;
    }
    R.g.visible = true;
    R.g.position.copy(pos);
    // (squashed by the bump, wobbling as he floats)
    R.bumpT = (R.bumpT ?? 9) + dt;
    const sq = R.hitDone ? Math.max(0, 1 - R.bumpT * 2.5) : 0;
    R.g.scale.set(1 + 0.25 * sq + Math.sin(t * 3) * 0.03, 1 - 0.22 * sq + Math.cos(t * 3) * 0.03, 1 + 0.25 * sq);
    R.body.material.opacity = 0.42 * fade; R.core.material.opacity = 0.28 * fade;
    R.face.material.opacity = fade; R.name.material.opacity = fade;
    // his face turned to me
    const toCam = this.camera.position.clone().sub(pos).normalize();
    R.face.position.copy(toCam.multiplyScalar(0.2));
    R.hist.push(pos.clone());
    if (R.hist.length > 40) R.hist.shift();
    R.tail.forEach((m, i) => {
      const h = R.hist[R.hist.length - 1 - (i + 1) * 5];
      m.visible = !!h;
      if (h) { m.position.copy(h); m.material.opacity = (0.22 - i * 0.04) * fade; }
    });
  }

  // ------------------------------------------------------------------ lights

  updateLights(view) {
    const D = view.D;
    const cands = [];
    for (const g of this.staticGlows) cands.push({ pos: g.pos, color: g.color, power: g.power, reach: g.reach, kind: g.kind, prio: g.kind === 'fire' ? 3 : g.kind === 'window' ? 2.5 : 2 });
    if (D) {
      for (const v of Object.values(D.vessels)) {
        if (!v.at || !v.heat) continue;
        const F = this.k3.fx[v.at.fx];
        if (!F) continue;
        const hob = F.anchors.burners && F.anchors.burners[v.at.slot] && (v.onHob || F.f.type === 'stove' || F.f.type === 'paellaBurner');
        const p = hob ? F.anchors.burners[v.at.slot] : F.anchors.inside || F.anchors.mouth || F.anchors.top;
        if (!p) continue;
        // (the flame is under the pan: it lights the pan, not the food in it)
        cands.push({ pos: p.clone().setY(p.y + (hob ? -0.01 : 0.15)), color: hob ? '#6a9aff' : '#ff8a3a', power: hob ? 0.35 + v.heat * 0.12 : 1.4, reach: hob ? 1 : 1.8, prio: hob ? 1 : 2.2, flicker: true });
      }
    }
    // the most important first; nearest to the camera's focus breaks ties
    const focus = this.camTarget;
    cands.sort((a, b) => (b.prio - a.prio) || (a.pos.distanceTo(focus) - b.pos.distanceTo(focus)));
    this.lamps.forEach((l, i) => {
      const c = cands[i];
      if (!c) { l.intensity = 0; l.position.set(0, -10, 0); return; }
      l.position.copy(c.pos);
      l.color.set(c.color);
      l.distance = c.reach;
      l.intensity = c.power * (c.kind === 'fire' || c.flicker ? 0.85 + Math.sin(this.t * 13 + i) * 0.1 + Math.sin(this.t * 31 + i) * 0.05 : 1);
    });
  }

  // ------------------------------------------------------------------ steam, drops, sparks, flies

  buildSteam() {
    const n = 300;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const matl = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; varying float vA;
        uniform float uScale;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = color; vA = size > 0.0 ? 1.0 : 0.0;
          gl_PointSize = abs(size) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, r) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a * 0.75); }`,
      transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(geo, matl);
    points.frustumCulled = false;
    return { points, n, list: [] };
  }

  puff(p, kind, col = null) {
    const S = this.steam;
    if (S.list.length >= S.n) return;
    const r = Math.random;
    const e = { x: p.x + (r() - 0.5) * 0.08, y: p.y, z: p.z + (r() - 0.5) * 0.08, vx: (r() - 0.5) * 0.05, vy: 0.25 + r() * 0.2, vz: (r() - 0.5) * 0.05, life: 0, max: 1.6 + r(), kind, col };
    if (kind === 'drop') { e.vy = -0.6; e.max = 0.35; }
    // (salt through a shaker's holes, a pinch of spice, lemon juice: a few small bits falling straight down)
    if (kind === 'grain') { e.x = p.x + (r() - 0.5) * 0.015; e.z = p.z + (r() - 0.5) * 0.015; e.vx *= 0.3; e.vz *= 0.3; e.vy = -0.2 - r() * 0.2; e.max = 0.5; }
    if (kind === 'sizzle') { e.vy = 0.5 + r() * 0.5; e.vx *= 6; e.vz *= 6; e.max = 0.35; }
    if (kind === 'fly') { e.max = 2; e.vy = 0.05; e.y += 0.15; }
    S.list.push(e);
  }

  updateSteam(dt) {
    const S = this.steam;
    const pos = S.points.geometry.attributes.position.array, col = S.points.geometry.attributes.color.array, size = S.points.geometry.attributes.size.array;
    S.list = S.list.filter((e) => (e.life += dt) < e.max);
    S.points.material.uniforms.uScale.value = this.canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (let i = 0; i < S.n; i++) {
      const e = S.list[i];
      if (!e) { size[i] = 0; continue; }
      const k = e.life / e.max;
      if (e.kind === 'fly') { e.x += Math.cos(this.t * 7 + i) * dt * 0.3; e.z += Math.sin(this.t * 6 + i) * dt * 0.3; }
      else { e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt; }
      if (e.kind === 'sizzle' || e.kind === 'drop' || e.kind === 'grain') e.vy -= 3 * dt;
      pos[i * 3] = e.x; pos[i * 3 + 1] = e.y; pos[i * 3 + 2] = e.z;
      const c = e.col || (e.kind === 'steam' ? [1, 1, 1] : e.kind === 'drop' ? [0.6, 0.82, 0.98] : e.kind === 'fly' ? [0.1, 0.1, 0.12] : [1, 0.9, 0.5]);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      size[i] = e.kind === 'steam' ? 0.05 + k * 0.1 : e.kind === 'grain' ? 0.006 : 0.012;
      if (e.kind === 'steam' && k > 0.8) size[i] *= (1 - k) * 5;
    }
    S.points.geometry.attributes.position.needsUpdate = true;
    S.points.geometry.attributes.color.needsUpdate = true;
    S.points.geometry.attributes.size.needsUpdate = true;
  }
}

// ======================================================================= helpers

const WORK_FOV = 50; // (the camera at work sees less, closer)

// The glow: a thing's own surfaces again, lit along the rims (where they turn
// away from me) with a faint wash on what faces me, added over it.
// (equipment gently – big surfaces; a thing to fetch a little brighter, so it stands out on its shelf)
const glowMat = (rim, wash) => new THREE.ShaderMaterial({
  uniforms: { uK: { value: 1 }, uColor: { value: new THREE.Color('#ffc23a') } },
  vertexShader: `varying vec3 vN; varying vec3 vV;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uK; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(uColor, (pow(f, 2.5) * ${rim.toFixed(2)} + ${wash.toFixed(2)}) * uK); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
});
const GLOW_MAT = glowMat(0.5, 0.06), GLOW_THING = glowMat(0.85, 0.14);
// lit or not: a mesh's glowing copy rides along as its child (doors, knobs, a pan all move)
function setGhost(o, on, mat = GLOW_MAT) {
  if (o.userData.glow) { o.visible = on; return; }
  o.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || m.userData.glow) return;
    let g = m.userData.ghost;
    if (!g) {
      if (!on) return;
      g = new THREE.Mesh(m.geometry, mat);
      g.userData.glow = true;
      g.renderOrder = 4;
      g.raycast = () => {};
      m.userData.ghost = g;
      m.add(g);
    }
    g.visible = on;
  });
}

export function topHeight(f) {
  switch (f.type) {
    case 'fridge': return 1.2;
    case 'shelf': return 1.3;
    case 'pizzaOven': case 'stoneOven': return 1.15;
    case 'tandoor': return 0.66;
    case 'binL': return 0.75;
    case 'binM': return 0.58;
    case 'binS': return 0.4;
    case 'plant': return 0.7;
    case 'table': return 0.42;
    case 'aga': return 0.66;
    case 'piano': return 0.6;
    default: return COUNTER_H;
  }
}

function vesselAtSlot(D, fx, slot, type) {
  for (const v of Object.values(D.vessels)) if (v.at && v.at.fx === fx && v.at.slot === slot && (v.onHob || type === 'stove' || type === 'paellaBurner' || type === 'aga' || type === 'piano')) return v;
  return null;
}

function disposeTree(o) {
  o.traverse((c) => { if (c.isMesh && c.geometry) c.geometry.dispose(); });
}

// ------------------------------------------------------------------ vessel models

// A pot, a pan, a dish …: its model (props3d.js, after the real one), with what goes with it here – the
// liquid's surface, the lid, the towel over it, bits floating about, the bubbles.
export function buildVessel(kind) {
  const vm = vesselModel(kind) || vesselModel('pot');
  const g = vm.group;
  const rec = { kind, group: g, h: vm.h, r: vm.r, liquid: null, lid: null, bits: [], bubbles: [] };
  // liquid surface, lid, and bits floating about
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(rec.r * 0.92, 24), new THREE.MeshStandardMaterial({ color: '#8fc8ea', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }));
  liquid.rotation.x = -Math.PI / 2;
  liquid.visible = false;
  g.add(liquid);
  rec.liquid = liquid;
  const lid = vm.lid || new THREE.Group();
  rec.ownLid = !!vm.lid;
  if (!vm.lid) {
    lid.add(lathe([[rec.r * 1.02, 0], [rec.r * 0.9, 0.025], [rec.r * 0.4, 0.04], [0, 0.045]], mat('#c9ccd2', { metal: 0.8, rough: 0.3, double: true }), 0, 0, 0, 20));
    lid.add(ball(0.018, mat('#3a3a42'), 0, 0.05, 0));
  }
  lid.position.y = rec.h;
  lid.visible = false;
  g.add(lid);
  rec.lid = lid;
  // a cotton tea towel laid over it (under the lid): flat across the top, hanging down past the rim all round
  const towel = new THREE.Mesh(drapedTowel(rec.r), towelMat());
  towel.position.y = rec.h - 0.004;
  towel.visible = false;
  g.add(towel);
  rec.towel = towel;
  for (let i = 0; i < 8; i++) { const b = ball(0.016, mat('#ffffff'), 0, 0, 0, 1, 0.7, 1, 8); b.visible = false; g.add(b); rec.bits.push(b); }
  for (let i = 0; i < 6; i++) { const b = ball(0.01, mat('#ffffff', { opacity: 0.7 }), 0, 0, 0, 1, 1, 1, 6); b.visible = false; g.add(b); rec.bubbles.push(b); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return rec;
}

// (the cloth: flat over a pot of radius r, then falling away past its rim in soft folds)
function drapedTowel(r) {
  const s = r * 2.6, geo = new THREE.PlaneGeometry(s, s, 24, 24);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z), over = Math.max(0, d - r * 0.98);
    const k = over > 0 ? r * 0.98 / d + (1 - r * 0.98 / d) * 0.35 : 1; // (pulled in a little as it falls)
    p.setXYZ(i, x * k, -over * 0.85 + Math.sin(Math.atan2(z, x) * 7) * over * 0.08, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
let TOWEL_MAT = null;
function towelMat() {
  if (TOWEL_MAT) return TOWEL_MAT;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f6f1e6'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#c8402e'; for (const y of [6, 12, 52, 58]) x.fillRect(0, y, 64, 3); // (a striped linen tea towel)
  x.fillStyle = 'rgba(0,0,0,0.04)'; for (let i = 0; i < 64; i += 2) x.fillRect(i, 0, 1, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  TOWEL_MAT = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide });
  return TOWEL_MAT;
}

const CONTENT_COL = { water: '#8fc8ea' };
// what comes off a thing peeled by hand (or by the peeler): an egg's shell, papery skins, peel
const PEEL_COL = { egg: '#e3c49c', onion: '#c98a3c', potato: '#c49a5c', carrot: '#f08a24', tomato: '#4f9a3a', garlic: '#eadde0' };
// a brew: water with tea or coffee steeped in it is that colour – Turkish tea's deep red ("tavşan kanı"), coffee's
// near black – and paler with milk in it
function brewColor(v) {
  const ks = new Set((v.contents || []).map((c) => c.kind));
  const base = ks.has('coffee') ? '#3b2416' : ks.has('tea') ? '#a63d18' : null;
  if (!base) return null;
  return ks.has('milk') ? '#' + new THREE.Color(base).lerp(new THREE.Color('#efe2d0'), 0.5).getHexString() : base;
}
// (solid: first person, where what's in it is drawn in 3D – only what's runny is the surface)
function updateVessel(rec, v, t, solid = false) {
  const r = rec.r;
  const level = Math.max(0, Math.min(1, v.water || 0));
  const wet = (v.contents || []).filter((c) => c.kind !== 'water' && (!solid || runny(c.kind, v)));
  // (first person: mashed, blended – or whisked into a batter – what's in it rising as one purée, soup, batter, its
  // colour theirs together, as far as it's got)
  const lumps = solid ? (v.contents || []).filter((c) => c.kind !== 'water' && !runny(c.kind, v) && (v.smooth > 0 || !(c.kind === 'egg' && (c.cut === 'cracked' || c.cut === 'beaten')))) : [];
  const melt = lumps.length ? Math.min(1, Math.max(v.smooth || 0, v.mixed || 0)) : 0;
  const hasFood = wet.length > 0 || (solid && !!v.liquid) || melt > 0;
  const show = level > 0.02 || hasFood;
  rec.liquid.visible = show && !v.lid;
  rec.liquid.material.roughness = 0.15;
  if (show) {
    // (first person, no water in it: the fat's a film on the floor, the food lying in it – not under it)
    rec.liquid.position.y = level > 0.02 ? 0.008 + level * rec.h * 0.9 : solid ? 0.004 : 0.008 + 0.25 * rec.h * 0.9;
    const brew = !v.liquid && level > 0.02 && brewColor(v);
    const col = v.liquid || brew || (level > 0.02 ? CONTENT_COL.water : wet.length ? bitColor(wet[0].kind) : mainColor(v));
    rec.liquid.material.color.set(col);
    rec.liquid.material.opacity = brew ? 0.9 : level > 0.02 && !v.liquid ? 0.72 : solid && !v.liquid ? 0.55 : 0.96;
    if (v.cook) rec.liquid.material.color.lerp(new THREE.Color('#8a4a1a'), Math.min(0.5, v.cook * 0.4));
    if (melt > 0) {
      if (!(level > 0.02) && !wet.length && !v.liquid) rec.liquid.material.color.set(blendColor(v));
      rec.liquid.material.color.lerp(new THREE.Color(blendColor(v)), melt);
      rec.liquid.material.opacity += (1 - rec.liquid.material.opacity) * melt;
      rec.liquid.material.roughness = 0.15 + 0.6 * melt;
      rec.liquid.position.y = Math.max(rec.liquid.position.y, 0.008 + (0.08 + 0.22 * melt) * rec.h * 0.9);
    }
  }
  rec.lid.visible = !!v.lid || !!rec.stowed;
  rec.towel.visible = !!v.towel;
  // bits of what's inside, bobbing
  // (first person, in a soup, a sauce: the bits of what's in it at the top – fewer as it's blended, none once it's smooth)
  const sm = Math.min(1, v.smooth || 0);
  const kinds = solid ? (v.liquid && sm < 1 ? (v.contents || []).filter((c) => c.kind !== 'water' && !runny(c.kind, v) && !(INGREDIENTS[c.kind] && INGREDIENTS[c.kind].art && CONTAINERS.has(INGREDIENTS[c.kind].art.type))) : []) : (v.contents || []).filter((c) => c.kind !== 'water');
  const most = solid ? Math.round(Math.min(rec.bits.length, kinds.length * 3) * (1 - sm)) : kinds.length * 2;
  rec.bits.forEach((b, i) => {
    const c = kinds[i % Math.max(1, kinds.length)];
    b.visible = !!c && !v.lid && i < most;
    if (!b.visible) return;
    b.material = mat(bitColor(c.kind), { rough: 0.6 });
    const a = i * 2.4 + (v.boil > 0.3 ? t * 0.8 : 0);
    const rr = r * (0.25 + (i % 3) * 0.2);
    b.position.set(Math.cos(a) * rr, rec.liquid.position.y + 0.006 + (v.boil > 0.3 ? Math.abs(Math.sin(t * 5 + i)) * 0.01 : 0), Math.sin(a) * rr);
  });
  rec.bubbles.forEach((b, i) => {
    b.visible = v.boil > 0.3 && !v.lid;
    if (!b.visible) return;
    const ph = (t * 1.5 + i * 0.37) % 1;
    b.position.set(Math.cos(i * 2.1) * r * 0.5, rec.liquid.position.y + 0.004, Math.sin(i * 2.1) * r * 0.5);
    b.scale.setScalar(0.4 + ph * v.boil);
  });
}

// Şakir's face (on a see-through sprite): big eyes and a grin – or laughing, eyes screwed up
function sakirFace(laugh) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.lineCap = 'round';
  // blush
  x.fillStyle = 'rgba(255,170,190,0.75)';
  for (const sx of [70, 186]) { x.beginPath(); x.ellipse(sx, 150, 26, 15, 0, 0, Math.PI * 2); x.fill(); }
  x.strokeStyle = '#4a0a10'; x.fillStyle = '#4a0a10'; x.lineWidth = 12;
  if (laugh) {
    for (const sx of [88, 168]) { x.beginPath(); x.arc(sx, 112, 20, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); }
  } else {
    for (const sx of [88, 168]) {
      x.beginPath(); x.ellipse(sx, 108, 17, 24, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(sx + 6, 98, 7, 0, Math.PI * 2); x.fill(); x.fillStyle = '#4a0a10';
    }
  }
  // the grin (wide open when he laughs)
  x.beginPath();
  if (laugh) { x.moveTo(70, 150); x.quadraticCurveTo(128, 250, 186, 150); x.closePath(); x.fill(); x.fillStyle = '#ff7a8a'; x.beginPath(); x.ellipse(128, 196, 30, 14, 0, 0, Math.PI * 2); x.fill(); } else { x.moveTo(74, 156); x.quadraticCurveTo(128, 214, 182, 156); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// a name, in white with a dark edge
function nameTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 84;
  const x = c.getContext('2d');
  x.font = '700 56px Fredoka, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 10; x.strokeStyle = '#4a0a10'; x.strokeText(text, 128, 44);
  x.fillStyle = '#fff'; x.fillText(text, 128, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a temperature tag's picture: a little thermometer and the degrees, warmer colours as it gets hotter
const TEMP_TEX = new Map();
function tempTexture(c) {
  let tex = TEMP_TEX.get(c);
  if (tex) return tex;
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 56;
  const x = cv.getContext('2d');
  const f = Math.max(0, Math.min(1, (c - 45) / 180));
  const col = f < 0.5 ? `rgb(255,${Math.round(211 - f * 2 * 70)},${Math.round(77 - f * 2 * 40)})` : `rgb(${Math.round(255 - (f - 0.5) * 2 * 23)},${Math.round(141 - (f - 0.5) * 2 * 54)},${Math.round(37 + (f - 0.5) * 2 * 21)})`;
  x.fillStyle = col; x.strokeStyle = '#3a2a1e'; x.lineWidth = 5;
  x.beginPath(); x.roundRect(4, 4, 152, 48, 24); x.fill(); x.stroke();
  // (the thermometer)
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect(22, 12, 10, 24, 5); x.fill(); x.beginPath(); x.arc(27, 38, 8, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#d8261c'; x.beginPath(); x.roundRect(24.5, 22 - f * 8, 5, 18 + f * 8, 2.5); x.fill(); x.beginPath(); x.arc(27, 38, 5.5, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#3a2a1e'; x.font = '700 30px Fredoka, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`${c} °C`, 92, 30);
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  TEMP_TEX.set(c, tex);
  return tex;
}

// poured (oil, milk, stock …) or melted on the heat (butter): the surface, not a thing in it
function runny(kind, v) {
  const I = INGREDIENTS[kind];
  return !!I && (!!I.liquid || ((kind === 'butter' || kind === 'ghee') && (v.heat > 0 || v.cook > 0)));
}
// a thing in a pot drawn in 3D: not what's runny, nor what came out of a bottle, jar, sack or shaker
// (rice, lentils, peas are a heap in it)
const CONTAINERS = new Set(['bottle', 'carton', 'can', 'jar', 'sack', 'shaker', 'tea', 'jug']);
function solidIn(it, v) {
  const I = INGREDIENTS[it.kind];
  if (!I || runny(it.kind, v)) return false;
  return !(I.art && CONTAINERS.has(I.art.type));
}

function bitColor(kind) {
  try { return liquidColor(kind) || '#e0c080'; } catch { return '#e0c080'; }
}
// what's in it all together: the colours of the food in it (the whole of a thing – a runny one half as much,
// spices, salt nothing to speak of), a beaten egg yellow
function blendColor(v) {
  const c = new THREE.Color(0, 0, 0);
  let n = 0;
  for (const q of v.contents || []) {
    if (q.kind === 'water') continue;
    const I = INGREDIENTS[q.kind];
    const w = q.kind === 'egg' ? 1 : I && I.art && CONTAINERS.has(I.art.type) && !I.liquid ? 0.05 : runny(q.kind, v) ? 0.5 : 1;
    c.add(new THREE.Color(q.kind === 'egg' ? '#f2c64a' : bitColor(q.kind)).multiplyScalar(w));
    n += w;
  }
  return n ? '#' + c.multiplyScalar(1 / n).getHexString() : '#e0c080';
}
function mainColor(v) {
  const c = (v.contents || []).find((q) => q.kind !== 'water');
  return c ? bitColor(c.kind) : '#e0c080';
}

export { walkable };
