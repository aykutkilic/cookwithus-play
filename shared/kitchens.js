// Kitchens: six sizes × six cuisines. A kitchen is a tile grid seen
// isometrically; the two back walls run behind row y=0 and column x=0.
// Fixtures (counters, sinks, stoves, ovens …) stand on tiles; a cook works
// at a fixture from its "stand" tile in front of it.
//
// Layouts are drawn as ASCII maps:
//   F fridge   C counter (cutting board)   K sink   S stove (2 burners)
//   O oven     X cuisine special (2 tiles) T table (plating)
//   H shelf    P plant   . floor
//   b m B  trash cans: small, medium, big
// A fixture on row 0 faces +y (the cook stands below it), one on column 0
// faces +x; free-standing ones (islands, tables, bins) are worked from the
// first free tile next to them.

export const SIZES = {
  mini:       { id: 'mini', name: 'Cozy Mini', cap: 1, blurb: 'A tiny kitchenette for one' },
  small:      { id: 'small', name: 'Cozy Small', cap: 2, blurb: 'Snug, for one or two' },
  medium:     { id: 'medium', name: 'Medium', cap: 3, blurb: 'Room for three cooks' },
  large:      { id: 'large', name: 'Large', cap: 5, blurb: 'Five cooks + a special oven' },
  huge:       { id: 'huge', name: 'Huge', cap: 8, blurb: 'Eight cooks, two stoves' },
  industrial: { id: 'industrial', name: 'Industrial', cap: 16, blurb: 'A restaurant line for sixteen' },
};
export const SIZE_ORDER = ['mini', 'small', 'medium', 'large', 'huge', 'industrial'];

const MAPS = {
  mini: [
    'FCKS',
    'C...',
    'H...',
    'P..b',
  ],
  small: [
    'FCKSS',
    'C....',
    'O....',
    'C..T.',
    'H...b',
  ],
  medium: [
    'FCCKSS',
    'C.....',
    'O.....',
    'C..TT.',
    'H....b',
    'P....m',
  ],
  large: [
    'FCCKSSOC',
    'C.......',
    'K......b',
    'C..CC...',
    'X.......',
    'X....TT.',
    'P.B.....',
  ],
  huge: [
    'FCCKSSOCCK',
    'C.........',
    'C.........',
    'O..CCCC..b',
    'X.........',
    'X..SS.....',
    'C........m',
    'H.TTT.....',
    'P.....B.B.',
  ],
  industrial: [
    'FCCCKSSSSOOKCC',
    'C.............',
    'C.............',
    'C..CCCCCC..m.b',
    'X.............',
    'X.............',
    'K..SSSSCCC...m',
    'C.............',
    'C.............',
    'O..TTTT..TTT.B',
    'Pb...........B',
  ],
};

// Fixture types and what they can be used for ("caps"):
//   board  – cutting, peeling, mixing … on a counter     plate – plating & serving
//   sink   – washing, filling, draining                   hob   – burners (slots = burners)
//   bake   – an oven                                      chill – the fridge
//   tandoor – the Indian clay oven
export const FIXTURES = {
  counter:      { name: 'Counter', caps: ['board', 'plate'], slots: 1 },
  table:        { name: 'Table', caps: ['plate'], slots: 1 },
  sink:         { name: 'Sink', caps: ['sink'], slots: 1 },
  stove:        { name: 'Stove', caps: ['hob'], slots: 2 },
  oven:         { name: 'Oven', caps: ['bake'], slots: 1, bakeKind: 'electric' },
  fridge:       { name: 'Fridge', caps: ['chill'], slots: 4 },
  binS:         { name: 'Small trash can', caps: ['bin'], slots: 1, holds: 8 },
  binM:         { name: 'Trash can', caps: ['bin'], slots: 1, holds: 14 },
  binL:         { name: 'Big trash bin', caps: ['bin'], slots: 1, holds: 24 },
  shelf:        { name: 'Shelf', caps: [], slots: 0 },
  plant:        { name: 'Plant', caps: [], slots: 0 },
  // cuisine specials (2 tiles long)
  pizzaOven:    { name: 'Wood-fired oven', caps: ['bake'], slots: 2, bakeKind: 'dome', big: true },
  stoneOven:    { name: 'Stone oven (taş fırın)', caps: ['bake'], slots: 2, bakeKind: 'dome', big: true },
  tandoor:      { name: 'Tandoor', caps: ['bake', 'tandoor'], slots: 2, bakeKind: 'tandoor', big: true },
  paellaBurner: { name: 'Paella burner', caps: ['hob'], slots: 1, wide: true, big: true },
  aga:          { name: 'AGA range', caps: ['hob', 'bake'], slots: 2, bakeKind: 'electric', big: true },
  piano:        { name: 'Piano range', caps: ['hob', 'bake'], slots: 4, bakeKind: 'electric', big: true },
};

// Palettes: walls, floor, counter tops, accents – and the special fixture.
export const CUISINES = {
  turkish: {
    id: 'turkish', name: 'Turkish', flag: '🇹🇷', hello: 'Hoş geldin!', special: 'stoneOven',
    wall: '#f3e6cf', wall2: '#e9d6b4', tile: '#2f6fae', tile2: '#ffffff', tile3: '#c0412d', floorA: '#c98d5a', floorB: '#b97b4a',
    top: '#e9e2d6', front: '#2f6f8f', trim: '#c9a24a', rug: '#a8322e', rug2: '#f0c060', accent: '#c0412d',
  },
  italian: {
    id: 'italian', name: 'Italian', flag: '🇮🇹', hello: 'Benvenuto!', special: 'pizzaOven',
    wall: '#f6e7c8', wall2: '#ead3a6', tile: '#5a8a4a', tile2: '#fff8ea', tile3: '#c0412d', floorA: '#c8714a', floorB: '#b5613d',
    top: '#efe9df', front: '#7a9a5a', trim: '#b5613d', rug: '#c0412d', rug2: '#f6e7c8', accent: '#3f8a4a',
  },
  spanish: {
    id: 'spanish', name: 'Spanish', flag: '🇪🇸', hello: '¡Bienvenido!', special: 'paellaBurner',
    wall: '#fbeed2', wall2: '#f1d9a8', tile: '#2a5aa8', tile2: '#fff6dc', tile3: '#f2b21a', floorA: '#c4673f', floorB: '#ad5632',
    top: '#f1e6d2', front: '#c0503a', trim: '#f2b21a', rug: '#f2b21a', rug2: '#c0302a', accent: '#c0302a',
  },
  french: {
    id: 'french', name: 'French', flag: '🇫🇷', hello: 'Bienvenue !', special: 'piano',
    wall: '#eef1f4', wall2: '#dfe5ec', tile: '#3a5a9a', tile2: '#ffffff', tile3: '#c9a24a', floorA: '#f2efe8', floorB: '#3a3f4a',
    top: '#f4f1ea', front: '#6f86a8', trim: '#c9884a', rug: '#3a5a9a', rug2: '#f2efe8', accent: '#c9884a',
  },
  english: {
    id: 'english', name: 'English', flag: '🇬🇧', hello: 'Welcome, love!', special: 'aga',
    wall: '#f4ecd8', wall2: '#e3d6b8', tile: '#7a9a8a', tile2: '#fbf8ef', tile3: '#b84a4a', floorA: '#a8784a', floorB: '#946640',
    top: '#d8c4a0', front: '#5f7f6a', trim: '#b84a4a', rug: '#b84a4a', rug2: '#3a5a4a', accent: '#3a5a4a',
  },
  indian: {
    id: 'indian', name: 'Indian', flag: '🇮🇳', hello: 'Swagat hai!', special: 'tandoor',
    wall: '#fbe3b8', wall2: '#f2c98a', tile: '#1a8a8a', tile2: '#fff3dc', tile3: '#e8601a', floorA: '#d8a060', floorB: '#c88a4a',
    top: '#efe4d0', front: '#c8501a', trim: '#e8b81a', rug: '#c0283a', rug2: '#f2b21a', accent: '#1a8a8a',
  },
};
export const CUISINE_ORDER = ['turkish', 'italian', 'spanish', 'french', 'english', 'indian'];

const CHAR_TYPE = { F: 'fridge', C: 'counter', K: 'sink', S: 'stove', O: 'oven', T: 'table', H: 'shelf', P: 'plant', b: 'binS', m: 'binM', B: 'binL' };

// Build the kitchen for a size and cuisine: grid size, fixtures with their
// stand tiles, walkable floor and a spawn spot for each cook.
export function buildKitchen(size, cuisine) {
  if (!SIZES[size]) size = 'small';
  if (!CUISINES[cuisine]) cuisine = 'turkish';
  const map = MAPS[size];
  const h = map.length, w = map[0].length;
  const fixtures = [];
  const solid = Array.from({ length: h }, () => Array(w).fill(false));
  let special = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      if (ch === '.') continue;
      solid[y][x] = true;
      if (ch === 'X') {
        if (!special) {
          special = { id: 'x', type: CUISINES[cuisine].special, x, y, w: 1, h: 1 };
          fixtures.push(special);
        } else special.h++; // the second tile of the 2-tile special (always down column 0)
        continue;
      }
      fixtures.push({ id: '', type: CHAR_TYPE[ch], x, y, w: 1, h: 1 });
    }
  }
  // ids by type: counter1, counter2 … in map order (stable across peers)
  const seen = {};
  for (const f of fixtures) {
    seen[f.type] = (seen[f.type] || 0) + 1;
    f.id = `${f.type}${seen[f.type]}`;
    // the side the cook works from
    if (f.x === 0 && f.y > 0) f.face = 'e';
    else f.face = 's';
    if (f.x === 0 && f.y === 0) f.stand = { x: 1, y: 1 }; // the corner (fridge): reached diagonally
    else if (f.x > 0 && f.y > 0) {
      // free-standing: the first free neighbour
      const free = (x, y) => x >= 0 && y >= 0 && x < w && y < h && map[y][x] === '.';
      const c = [[f.x, f.y + 1], [f.x + 1, f.y], [f.x - 1, f.y], [f.x, f.y - 1]].find(([x, y]) => free(x, y));
      f.stand = c ? { x: c[0], y: c[1] } : { x: f.x, y: f.y + 1 };
    } else f.stand = { x: f.face === 'e' ? f.x + f.w : f.x, y: f.face === 's' ? f.y + f.h : f.y };
    const def = FIXTURES[f.type];
    f.caps = def.caps;
    f.slots = def.slots;
  }
  const spawns = [];
  for (let y = h - 1; y >= 1 && spawns.length < 20; y--) {
    for (let x = w - 1; x >= 1 && spawns.length < 20; x--) if (!solid[y][x]) spawns.push({ x, y });
  }
  // spread cooks out around the middle of the room
  const cx = w / 2, cy = h / 2;
  spawns.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  return { size, cuisine, w, h, fixtures, solid, spawns, cap: SIZES[size].cap, palette: CUISINES[cuisine] };
}

// What a kitchen offers: counts of each capability (burners count per slot).
export function kitchenCaps(k) {
  const c = { board: 0, plate: 0, sink: 0, hob: 0, bake: 0, chill: 0, tandoor: 0, bin: 0, dome: 0, wide: 0 };
  for (const f of k.fixtures) {
    for (const cap of f.caps) c[cap] += cap === 'hob' ? f.slots : 1;
    if (FIXTURES[f.type].bakeKind === 'dome') c.dome++;
    if (FIXTURES[f.type].wide) c.wide++;
  }
  return c;
}

export function fixtureById(k, id) {
  return k.fixtures.find((f) => f.id === id) || null;
}

export function fixturesWith(k, cap) {
  return k.fixtures.filter((f) => f.caps.includes(cap));
}

export function bakeKind(f) {
  return (f && FIXTURES[f.type].bakeKind) || null;
}

export function walkable(k, x, y) {
  return x >= 0 && y >= 0 && x < k.w && y < k.h && !k.solid[y][x];
}
