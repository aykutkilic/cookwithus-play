// Kitchen themes: each cuisine has its own room – floor, walls, tiles,
// cabinets and worktop, window, lamps and the colour of its light, its
// decorations, and the accent colours of the interface around it. The
// textures are painted on canvases (no images).
import * as THREE from 'three';

export const THEMES = {
  turkish: {
    name: 'Turkish',
    floor: 'stone', floorA: '#d9c7a8', floorB: '#c9b28c', grout: '#a8916c',
    rug: 'kilim', rugA: '#a8322e', rugB: '#f0c060', rugC: '#2f5f8f',
    splash: 'iznik', tileA: '#fbf8f2', tileB: '#2c5ea8', tileC: '#c0412d', tileD: '#3f8f6a',
    wall: 'limewash', wallA: '#f3e6cf', wallB: '#e7d4b2', trim: '#8a5a34',
    cabinet: '#2f6f8f', cabinet2: '#255a74', handle: 'brass', top: 'marble', topA: '#efe9df', topB: '#c9c0b0',
    window: 'lattice', frame: '#7a4e2a', curtain: '#a8322e',
    lamp: 'ottoman', lampGlass: ['#e8573a', '#2c8fd0', '#f2b21a', '#3faa5a'], lampColor: '#ffb062',
    light: { sky: '#fff1dc', ground: '#5a3a2a', hemi: 0.7, key: '#ffe6c4', keyI: 1.5, exposure: 1.08, sun: '#ffd8a0' },
    decor: ['nazar', 'copperPans', 'pepperString', 'teaGlasses'],
    ui: { accent: '#c0412d', accent2: '#2c5ea8', paper: '#fff8ec', bg: '#f6e2c4' },
  },
  italian: {
    name: 'Italian',
    floor: 'cotto', floorA: '#c8714a', floorB: '#b5613d', grout: '#8a4a2e',
    rug: 'stripes', rugA: '#3f7a4a', rugB: '#f6e7c8', rugC: '#c0412d',
    splash: 'brick', tileA: '#b8644a', tileB: '#a3553e', tileC: '#e8d8c0', tileD: '#8a4632',
    wall: 'ochre', wallA: '#f0d8a8', wallB: '#e3c18a', trim: '#6a4426',
    cabinet: '#7a9a5a', cabinet2: '#647f48', handle: 'iron', top: 'wood', topA: '#b07a48', topB: '#8a5a32',
    window: 'shutters', frame: '#4f7a3f', curtain: '#f6e7c8',
    lamp: 'rustic', lampGlass: ['#ffe2a0'], lampColor: '#ffb870',
    light: { sky: '#fff0d6', ground: '#6a3a22', hemi: 0.65, key: '#ffe8c8', keyI: 1.55, exposure: 1.1, sun: '#ffd49a' },
    decor: ['garlicBraid', 'salami', 'chianti', 'basilPot'],
    ui: { accent: '#3f8a4a', accent2: '#c0412d', paper: '#fffaf0', bg: '#f3e2c6' },
  },
  spanish: {
    name: 'Spanish',
    floor: 'hydraulic', floorA: '#efe4d0', floorB: '#2a5aa8', grout: '#c9b89a',
    rug: 'esparto', rugA: '#d9b878', rugB: '#b8955a', rugC: '#c0302a',
    splash: 'azulejo', tileA: '#fdf8ea', tileB: '#2a5aa8', tileC: '#f2b21a', tileD: '#5a8ad0',
    wall: 'whitewash', wallA: '#fbf6ee', wallB: '#efe6d6', trim: '#3a2a22',
    cabinet: '#c0503a', cabinet2: '#a3412e', handle: 'iron', top: 'tile', topA: '#f4ecdc', topB: '#2a5aa8',
    window: 'grille', frame: '#3a2a22', curtain: '#f2b21a',
    lamp: 'lantern', lampGlass: ['#ffe0a0'], lampColor: '#ffbf72',
    light: { sky: '#ffffff', ground: '#7a5a3a', hemi: 0.8, key: '#fff4dc', keyI: 1.75, exposure: 1.04, sun: '#fff0c0' },
    decor: ['paellaPans', 'plates', 'chiliRistra', 'jamon'],
    ui: { accent: '#c0302a', accent2: '#f2b21a', paper: '#fffaf0', bg: '#f8e8cc' },
  },
  french: {
    name: 'French',
    floor: 'checker', floorA: '#f2efe8', floorB: '#2f3440', grout: '#bdb8ae',
    rug: 'none',
    splash: 'metro', tileA: '#f8f7f3', tileB: '#d8d6d0', tileC: '#3a5a9a', tileD: '#c9884a',
    wall: 'panel', wallA: '#e8eef4', wallB: '#d5dfea', trim: '#f8f6f0',
    cabinet: '#6f86a8', cabinet2: '#5b7091', handle: 'brass', top: 'marble', topA: '#f6f3ee', topB: '#cfc8bd',
    window: 'french', frame: '#f8f6f0', curtain: '#3a5a9a',
    lamp: 'chandelier', lampGlass: ['#fff0c8'], lampColor: '#ffd9a0',
    light: { sky: '#eef4ff', ground: '#4a4048', hemi: 0.7, key: '#eef3ff', keyI: 1.5, exposure: 1.06, sun: '#f0f4ff' },
    decor: ['copperRail', 'baguettes', 'herbPots', 'clock'],
    ui: { accent: '#3a5a9a', accent2: '#c9884a', paper: '#fbfaf7', bg: '#e9e6e0' },
  },
  english: {
    name: 'English',
    floor: 'boards', floorA: '#a8784a', floorB: '#946640', grout: '#6a4628',
    rug: 'rag', rugA: '#b84a4a', rugB: '#3a5a4a', rugC: '#e8d8b8',
    splash: 'victorian', tileA: '#f4efe2', tileB: '#4f7a62', tileC: '#b84a4a', tileD: '#e8d8b8',
    wall: 'floral', wallA: '#f4ecd8', wallB: '#e3d3b2', trim: '#4f6f5a',
    cabinet: '#4f6f5a', cabinet2: '#40604c', handle: 'brass', top: 'wood', topA: '#c9a070', topB: '#9a7448',
    window: 'sash', frame: '#f8f4ea', curtain: '#b84a4a',
    lamp: 'fabric', lampGlass: ['#f8e8c8'], lampColor: '#ffcf96',
    light: { sky: '#e2e9f4', ground: '#4a3a2e', hemi: 0.75, key: '#e8eef8', keyI: 1.35, exposure: 1.12, sun: '#dfe8f4' },
    decor: ['plateRack', 'bunting', 'teapot', 'mugs'],
    ui: { accent: '#4f6f5a', accent2: '#b84a4a', paper: '#fdf9ef', bg: '#ece2cc' },
  },
  indian: {
    name: 'Indian',
    floor: 'rangoli', floorA: '#e8d2a8', floorB: '#d8bc8a', grout: '#b89a68',
    rug: 'durrie', rugA: '#c0283a', rugB: '#f2b21a', rugC: '#1a8a8a',
    splash: 'mosaic', tileA: '#1a8a8a', tileB: '#26a8a0', tileC: '#f2b21a', tileD: '#e8601a',
    wall: 'saffron', wallA: '#fbd38a', wallB: '#f2b860', trim: '#c8501a',
    cabinet: '#c8501a', cabinet2: '#a8401a', handle: 'brass', top: 'granite', topA: '#4a4a52', topB: '#6a6a72',
    window: 'jali', frame: '#8a4a22', curtain: '#c0283a',
    lamp: 'brassLantern', lampGlass: ['#e8572a', '#26a8a0', '#f2b21a', '#c0283a'], lampColor: '#ffb45a',
    light: { sky: '#fff0d0', ground: '#6a3a1a', hemi: 0.7, key: '#ffe2b8', keyI: 1.55, exposure: 1.1, sun: '#ffcf8a' },
    decor: ['marigolds', 'brassPots', 'spiceRack', 'toran'],
    ui: { accent: '#c8501a', accent2: '#1a8a8a', paper: '#fff8ea', bg: '#f8e0b8' },
  },
};

export function themeOf(cuisine) { return THEMES[cuisine] || THEMES.turkish; }

// The interface takes the kitchen's colours too.
export function applyUiTheme(cuisine) {
  const t = themeOf(cuisine).ui;
  const s = document.documentElement.style;
  s.setProperty('--accent', t.accent);
  s.setProperty('--accent2', t.accent2);
  s.setProperty('--paper', t.paper);
  s.setProperty('--bg', t.bg);
  document.body.dataset.cuisine = cuisine;
}

// ------------------------------------------------------------------ painted textures

const texCache = new Map();
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(key, w, h, paint, repeat = [1, 1]) {
  let t = texCache.get(key);
  if (t) return t;
  const c = canvas(w, h);
  paint(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}
const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
function noise(g, w, h, alpha, seed, n = 600) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha * r()})` : `rgba(255,255,255,${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

// One tile of floor (a texture repeated once per grid square).
export function floorTexture(t) {
  return tex(`floor:${t.floor}:${t.floorA}`, 256, 256, (g, w, h) => {
    g.fillStyle = t.grout; g.fillRect(0, 0, w, h);
    const r = rnd(7);
    switch (t.floor) {
      case 'checker': {
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? t.floorB : t.floorA; g.fillRect(x * 128, y * 128, 128, 128); }
        break;
      }
      case 'boards': {
        for (let i = 0; i < 4; i++) {
          g.fillStyle = i % 2 ? t.floorA : t.floorB; g.fillRect(0, i * 64 + 1, w, 62);
          g.strokeStyle = 'rgba(60,30,10,0.18)'; g.lineWidth = 1.5;
          for (let k = 0; k < 5; k++) { g.beginPath(); const y = i * 64 + 8 + k * 11; g.moveTo(0, y); g.bezierCurveTo(80, y - 4, 170, y + 5, w, y - 1); g.stroke(); }
          g.fillStyle = 'rgba(40,20,10,0.5)'; g.fillRect(((i * 97) % 200) + 20, i * 64 + 1, 2, 62);
        }
        break;
      }
      case 'cotto': {
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          g.fillStyle = (x + y) % 2 ? t.floorA : t.floorB; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
        }
        g.fillStyle = '#e8c890'; for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128], [256, 256], [256, 0], [0, 256]]) { g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 12, y); g.lineTo(x, y + 12); g.lineTo(x - 12, y); g.fill(); }
        break;
      }
      case 'hydraulic': {
        // encaustic cement tiles: a star in each square
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          const cx = x * 128 + 64, cy = y * 128 + 64;
          g.fillStyle = t.floorA; g.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
          g.fillStyle = t.floorB;
          g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? 22 : 54; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill();
          g.fillStyle = '#f2b21a'; g.beginPath(); g.arc(cx, cy, 12, 0, Math.PI * 2); g.fill();
          g.fillStyle = t.floorB; for (const [qx, qy] of [[2, 2], [126, 2], [2, 126], [126, 126]]) { g.beginPath(); g.arc(x * 128 + qx, y * 128 + qy, 20, 0, Math.PI * 2); g.fill(); }
        }
        break;
      }
      case 'rangoli': {
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? t.floorA : t.floorB; g.fillRect(x * 128 + 2, y * 128 + 2, 124, 124); }
        g.strokeStyle = 'rgba(200,80,26,0.35)'; g.lineWidth = 3;
        g.beginPath(); g.arc(128, 128, 40, 0, Math.PI * 2); g.stroke();
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.ellipse(128 + Math.cos(a) * 62, 128 + Math.sin(a) * 62, 16, 7, a, 0, Math.PI * 2); g.stroke(); }
        break;
      }
      default: { // stone flags
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          g.fillStyle = (x + y) % 2 ? t.floorA : t.floorB; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
        }
      }
    }
    noise(g, w, h, 0.06, 3, 900);
    void r;
  });
}

// The splashback: tiles from the worktop up to the cupboards (repeated per tile width).
export function splashTexture(t) {
  return tex(`splash:${t.splash}:${t.tileB}`, 256, 256, (g, w, h) => {
    const T = 64;
    const motif = (cx, cy, k) => {
      switch (t.splash) {
        case 'iznik': { // a tulip & carnation in cobalt with a red heart
          g.fillStyle = t.tileB;
          g.beginPath(); g.moveTo(cx, cy - 22); g.quadraticCurveTo(cx + 12, cy - 6, cx, cy + 4); g.quadraticCurveTo(cx - 12, cy - 6, cx, cy - 22); g.fill();
          g.strokeStyle = t.tileD; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy + 4); g.quadraticCurveTo(cx + 2, cy + 16, cx - 6, cy + 24); g.stroke();
          g.fillStyle = t.tileC; g.beginPath(); g.arc(cx, cy - 8, 4, 0, Math.PI * 2); g.fill();
          g.fillStyle = t.tileB; for (const [qx, qy] of [[-30, -30], [30, -30], [-30, 30], [30, 30]]) { g.beginPath(); g.arc(cx + qx, cy + qy, 9, 0, Math.PI * 2); g.fill(); }
          break;
        }
        case 'azulejo': {
          g.strokeStyle = t.tileB; g.lineWidth = 4;
          g.beginPath(); g.arc(cx, cy, 18, 0, Math.PI * 2); g.stroke();
          g.fillStyle = t.tileC; g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2); g.fill();
          g.fillStyle = t.tileB; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.ellipse(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, 9, 4, a, 0, Math.PI * 2); g.fill(); }
          break;
        }
        case 'mosaic': {
          for (let i = 0; i < 16; i++) { g.fillStyle = [t.tileA, t.tileB, t.tileC, t.tileD][(i * 7 + k) % 4]; g.fillRect(cx - 32 + (i % 4) * 16 + 1, cy - 32 + Math.floor(i / 4) * 16 + 1, 14, 14); }
          break;
        }
        case 'victorian': {
          g.fillStyle = k % 2 ? t.tileB : t.tileA; g.fillRect(cx - 31, cy - 31, 62, 62);
          if (k % 2 === 0) { g.fillStyle = t.tileC; g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx + 12, cy); g.lineTo(cx, cy + 12); g.lineTo(cx - 12, cy); g.fill(); }
          break;
        }
        default: break;
      }
    };
    if (t.splash === 'metro' || t.splash === 'brick') {
      // running bond: subway tiles / bricks
      g.fillStyle = t.splash === 'metro' ? '#9a968e' : '#d8c4a8'; g.fillRect(0, 0, w, h);
      const bh = t.splash === 'metro' ? 32 : 28, bw = 64;
      for (let y = 0, row = 0; y < h; y += bh, row++) {
        for (let x = -bw; x < w + bw; x += bw) {
          const ox = row % 2 ? bw / 2 : 0;
          g.fillStyle = t.splash === 'metro' ? t.tileA : [t.tileA, t.tileB, t.tileD][(row * 3 + Math.floor(x / bw)) % 3 + (row * 3 + Math.floor(x / bw) < 0 ? 3 : 0)] || t.tileA;
          g.fillRect(x + ox + 2, y + 2, bw - 4, bh - 4);
          if (t.splash === 'metro') { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x + ox + 4, y + 4, bw - 14, 4); }
        }
      }
    } else {
      for (let y = 0; y < h; y += T) for (let x = 0; x < w; x += T) {
        const k = x / T + y / T;
        g.fillStyle = t.splash === 'mosaic' ? '#e8e0d0' : '#ddd5c8'; g.fillRect(x, y, T, T);
        g.fillStyle = t.tileA; g.fillRect(x + 2, y + 2, T - 4, T - 4);
        motif(x + T / 2, y + T / 2, k);
      }
    }
    noise(g, w, h, 0.05, 11, 500);
  });
}

// The plaster / paper above the tiles.
export function wallTexture(t) {
  return tex(`wall:${t.wall}:${t.wallA}`, 256, 256, (g, w, h) => {
    g.fillStyle = t.wallA; g.fillRect(0, 0, w, h);
    switch (t.wall) {
      case 'floral': {
        // a cottage wallpaper: stripes and little roses
        for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(79,111,90,0.10)'; g.fillRect(x, 0, 10, h); }
        for (let y = 16; y < h; y += 48) for (let x = 16 + ((y / 48) % 2) * 32; x < w; x += 64) {
          g.fillStyle = '#c86a6a'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#e8a0a0'; g.beginPath(); g.arc(x - 1, y - 1, 3, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#6a9a6a'; g.beginPath(); g.ellipse(x + 8, y + 4, 5, 2.5, 0.5, 0, Math.PI * 2); g.ellipse(x - 8, y + 4, 5, 2.5, -0.5, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case 'panel': {
        // painted boiserie panels
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 4; g.strokeRect(20, 30, w - 40, h - 60);
        g.strokeStyle = 'rgba(90,110,140,0.25)'; g.lineWidth = 2; g.strokeRect(26, 36, w - 52, h - 72);
        break;
      }
      case 'ochre': case 'saffron': case 'limewash': case 'whitewash': default: {
        const r = rnd(5);
        for (let i = 0; i < 70; i++) {
          g.fillStyle = r() < 0.5 ? t.wallB : 'rgba(255,255,255,0.35)';
          g.globalAlpha = 0.18; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 40, 10 + r() * 30, r() * 3, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        if (t.wall === 'saffron') {
          // a stencilled border of paisleys
          g.fillStyle = 'rgba(200,80,26,0.45)';
          for (let x = 16; x < w; x += 42) { g.beginPath(); g.ellipse(x, 20, 9, 6, 0.6, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x + 8, 14, 3, 0, Math.PI * 2); g.fill(); }
        }
        if (t.wall === 'limewash') {
          g.fillStyle = 'rgba(44,94,168,0.35)';
          for (let x = 8; x < w; x += 32) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x + 8, 14); g.lineTo(x, 22); g.lineTo(x - 8, 14); g.fill(); }
        }
      }
    }
    noise(g, w, h, 0.04, 9, 700);
  });
}

// Worktops: marble, butcher block, tiles, granite.
export function topTexture(t) {
  return tex(`top:${t.top}:${t.topA}`, 256, 256, (g, w, h) => {
    g.fillStyle = t.topA; g.fillRect(0, 0, w, h);
    const r = rnd(13);
    if (t.top === 'marble') {
      g.strokeStyle = t.topB; g.globalAlpha = 0.55;
      for (let i = 0; i < 6; i++) { g.lineWidth = 1 + r() * 2.5; g.beginPath(); let x = r() * w, y = 0; g.moveTo(x, y); while (y < h) { x += (r() - 0.5) * 40; y += 20 + r() * 30; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 1;
    } else if (t.top === 'wood') {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? t.topB : t.topA; g.globalAlpha = 0.35; g.fillRect(i * 32, 0, 32, h); }
      g.globalAlpha = 1; g.strokeStyle = 'rgba(60,30,10,0.2)';
      for (let i = 0; i < 30; i++) { g.lineWidth = 1; g.beginPath(); const x = r() * w; g.moveTo(x, 0); g.bezierCurveTo(x + 6, 80, x - 6, 170, x + 3, h); g.stroke(); }
    } else if (t.top === 'tile') {
      for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) {
        g.fillStyle = '#d8ccb8'; g.fillRect(x, y, 64, 64);
        g.fillStyle = (x + y) / 64 % 2 ? t.topA : '#fffaf0'; g.fillRect(x + 2, y + 2, 60, 60);
        g.strokeStyle = t.topB; g.lineWidth = 3; g.beginPath(); g.arc(x + 32, y + 32, 14, 0, Math.PI * 2); g.stroke();
      }
    } else { // granite
      for (let i = 0; i < 3000; i++) { g.fillStyle = ['#2a2a32', '#7a7a82', '#9a8a7a', '#5a5a62'][i % 4]; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    }
    noise(g, w, h, 0.04, 21, 400);
  });
}

// Rugs in the middle of the room.
export function rugTexture(t) {
  return tex(`rug:${t.rug}:${t.rugA}`, 512, 256, (g, w, h) => {
    g.fillStyle = t.rugA; g.fillRect(0, 0, w, h);
    switch (t.rug) {
      case 'kilim': case 'durrie': {
        g.strokeStyle = t.rugB; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
        for (let x = 60; x < w - 40; x += 80) {
          g.fillStyle = t.rugB; g.beginPath(); g.moveTo(x, h / 2 - 50); g.lineTo(x + 34, h / 2); g.lineTo(x, h / 2 + 50); g.lineTo(x - 34, h / 2); g.fill();
          g.fillStyle = t.rugC; g.beginPath(); g.moveTo(x, h / 2 - 22); g.lineTo(x + 15, h / 2); g.lineTo(x, h / 2 + 22); g.lineTo(x - 15, h / 2); g.fill();
        }
        g.fillStyle = t.rugC; for (let x = 30; x < w; x += 20) { g.fillRect(x, 30, 8, 8); g.fillRect(x, h - 38, 8, 8); }
        break;
      }
      case 'stripes': case 'rag': case 'esparto': {
        for (let y = 0; y < h; y += 24) { g.fillStyle = [t.rugA, t.rugB, t.rugC][(y / 24) % 3]; g.fillRect(0, y, w, 20); }
        if (t.rug === 'esparto') { g.strokeStyle = 'rgba(80,50,20,0.25)'; for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 3, h); g.stroke(); } }
        break;
      }
      default: break;
    }
    noise(g, w, h, 0.08, 31, 1500);
  });
}

// Checked tablecloths, tea towels.
export function clothTexture(color) {
  return tex(`cloth:${color}`, 128, 128, (g, w, h) => {
    g.fillStyle = '#fffaf2'; g.fillRect(0, 0, w, h);
    g.fillStyle = color; g.globalAlpha = 0.55;
    for (let i = 0; i < 8; i += 2) { g.fillRect(i * 16, 0, 16, h); g.fillRect(0, i * 16, w, 16); }
    g.globalAlpha = 1;
  }, [2, 2]);
}

// The diorama's wooden plinth.
export function woodTexture(color = '#5a3a24') {
  return tex(`wood:${color}`, 256, 64, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const r = rnd(41);
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 14; i++) { g.lineWidth = 1 + r(); g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(80, y + 4, 170, y - 4, w, y + 2); g.stroke(); }
  });
}
