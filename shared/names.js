// Cook names & looks: sanitising profiles and keeping names clean.
//
// The profanity check normalises a name first – lower case, Turkish and other
// accents folded (ş→s, ı→i …), look-alike digits/symbols mapped back to
// letters (4→a, 0→o, $→s …), repeated letters collapsed – then looks for
//   ROOTS – strong words, matched anywhere (also across spaces: "f u c k")
//   WORDS – short words that hide inside innocent ones (ass → "class"), so
//           only matched as a whole word.
// English, Turkish, Spanish, French, Italian, German and Hindi/Urdu slurs and
// swear words. It's a cozy kitchen – a name that trips it is refused.

const ROOTS = [
  // en
  'fuck', 'fuk', 'fck', 'fcuk', 'phuck', 'shit', 'sht', 'cunt', 'bitch', 'biatch', 'bastard', 'asshole', 'arsehole', 'dickhead',
  'motherf', 'nigger', 'nigga', 'faggot', 'fagot', 'whore', 'slut', 'rapist', 'raping', 'pussy', 'penis', 'vagina', 'dildo',
  'porn', 'nazi', 'hitler', 'retard', 'wank', 'twat', 'jizz', 'bollock', 'blowjob', 'handjob', 'cumshot', 'boobs', 'horny',
  'molest', 'pedo', 'paedo', 'kkk', 'heilh', 'siegheil', 'spastic', 'tranny', 'kike', 'chink', 'wetback',
  // tr
  'amk', 'amq', 'aminak', 'amina', 'amcik', 'amck', 'orospu', 'orsp', 'orosbu', 'siktir', 'sikerim', 'sikis', 'sikik', 'siker',
  'yarrak', 'yarak', 'gotveren', 'gotun', 'gotlek', 'ibne', 'kahpe', 'pezevenk', 'kaltak', 'surtuk', 'tassak', 'dassak', 'yavsak',
  'serefsiz', 'pust', 'kancik', 'amcuk', 'sokuk', 'gavat', 'puşt',
  // es
  'puta', 'puto', 'mierda', 'cabron', 'joder', 'gilipollas', 'pendejo', 'verga', 'culero', 'maricon', 'chingad', 'pinche',
  // fr
  'merde', 'putain', 'connard', 'connasse', 'salope', 'encule', 'batard', 'niquer', 'niquetamere', 'tamere', 'fdp',
  // it
  'cazzo', 'stronzo', 'vaffanculo', 'fanculo', 'puttana', 'troia', 'minchia', 'coglion', 'frocio',
  // de
  'scheisse', 'schlampe', 'fotze', 'wichser', 'arschloch', 'hurensohn',
  // hi / ur
  'chutiya', 'chutia', 'madarchod', 'maderchod', 'bhenchod', 'behenchod', 'bhosdi', 'bhosda', 'gandu', 'randi', 'lavda', 'lauda',
];
const WORDS = [
  'ass', 'arse', 'dick', 'cock', 'cum', 'sex', 'tits', 'tit', 'anal', 'anus', 'fag', 'hoe', 'cum', 'jap', 'nig', 'sik', 'pic',
  'oc', 'aq', 'mk', 'spic', 'coon', 'con', 'conne', 'pute', 'cono', 'polla', 'figa', 'lund', 'cul', 'nazi', 'gay', 'homo',
  'kys', 'wtf', 'stfu', 'milf', 'rape', 'piss', 'poop', 'turd',
];

const FOLD = { ı: 'i', İ: 'i', ş: 's', ğ: 'g', ç: 'c', ö: 'o', ü: 'u', ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe' };
const LEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e', '£': 'l' };

export function normalizeName(s) {
  let t = String(s).toLowerCase();
  t = t.replace(/[ıİşğçöüßæøœ]/g, (c) => FOLD[c] || c);
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[0-9@$!|+€£]/g, (c) => LEET[c] || c);
  t = t.replace(/[^a-z]+/g, ' ').trim();
  return t;
}
const squash = (t) => t.replace(/ /g, '').replace(/(.)\1+/g, '$1');

const ROOT_SET = ROOTS.map((w) => squash(normalizeName(w)));
const WORD_SET = new Set(WORDS.map((w) => squash(normalizeName(w))));

export function isProfane(name) {
  // digits read as letters ("sh1t") and as gaps ("ass123")
  return check(normalizeName(name)) || check(normalizeName(String(name).replace(/[0-9]+/g, ' ')));
}

function check(n) {
  if (!n) return false;
  const all = squash(n);
  const raw = n.replace(/ /g, '');
  for (const r of ROOT_SET) if (r.length >= 3 && (all.includes(r) || raw.includes(r))) return true;
  for (const w of n.split(' ')) {
    const q = squash(w);
    if (WORD_SET.has(q) || WORD_SET.has(w)) return true;
    // a bad word with a plural / number tail: "dicks", "ass123"
    if (q.length > 1 && WORD_SET.has(q.replace(/s$/, ''))) return true;
  }
  if (WORD_SET.has(all)) return true;
  return false;
}

// Allowed characters: letters (any script), digits, space, _ . - '
export function cleanName(s) {
  return String(s || '').replace(/[^\p{L}\p{N} _.\-']/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

// ------------------------------------------------------------------ looks

export const SKINS = ['#ffe0c4', '#f8cfa6', '#eab88a', '#d39a6a', '#b27850', '#8d5a3b', '#6a412b', '#4a2e20'];
export const HAIR_COLORS = ['#2a1d17', '#4a2e1f', '#7a4a2a', '#b3743a', '#e0b45a', '#f2dca0', '#a8a8a8', '#f0f0f0', '#c0412d', '#d4729a', '#4a7ad0', '#5aa06a'];
export const HAIR_STYLES = ['Short', 'Curly', 'Long', 'Bun', 'Ponytail', 'Afro', 'Bob', 'Bald', 'Spiky', 'Braids'];
export const HATS = ['Chef toque', 'Tall toque', 'Bandana', 'Beret', 'Headscarf', 'Cap', 'Turban', 'None'];
export const HAT_COLORS = ['#ffffff', '#c0412d', '#2f6fae', '#3f8a4a', '#f2b21a', '#2a2a32', '#d4729a', '#8a5ac0'];
export const APRONS = ['#ffffff', '#c0412d', '#2f6fae', '#3f8a4a', '#f2b21a', '#e8823a', '#d4729a', '#8a5ac0', '#2a2a32', '#7a5a3a'];
export const SHIRTS = ['#f2efe6', '#3a5a9a', '#c0412d', '#3f8a4a', '#f2b21a', '#2a2a32', '#a8d0e6', '#f0b8c8', '#8a5ac0', '#e8823a'];
export const FACIAL = ['None', 'Moustache', 'Big moustache', 'Beard', 'Stubble'];
export const EXTRAS = ['None', 'Glasses', 'Round glasses', 'Freckles', 'Rosy cheeks'];

const pick = (a) => a[(Math.random() * a.length) | 0];
const NAMES = ['Chef', 'Cookie', 'Pepper', 'Basil', 'Ginger', 'Olive', 'Sage', 'Nutmeg', 'Mango', 'Paprika', 'Saffron', 'Biscuit', 'Dumpling', 'Noodle', 'Pickle'];

export function randomProfile() {
  return {
    name: `${pick(NAMES)}${(Math.random() * 90 + 10) | 0}`,
    avatar: {
      skin: (Math.random() * SKINS.length) | 0, hair: (Math.random() * 7) | 0, hairColor: (Math.random() * 6) | 0,
      hat: Math.random() < 0.6 ? 0 : (Math.random() * HATS.length) | 0, hatColor: 0,
      apron: (Math.random() * APRONS.length) | 0, shirt: (Math.random() * SHIRTS.length) | 0,
      facial: Math.random() < 0.25 ? 1 + ((Math.random() * 4) | 0) : 0, extra: Math.random() < 0.3 ? 1 + ((Math.random() * 4) | 0) : 0,
    },
  };
}

const idx = (v, n, d) => { const i = Math.round(Number(v)); return Number.isFinite(i) && i >= 0 && i < n ? i : d; };

export function sanitizeProfile(p) {
  const a = (p && p.avatar) || {};
  let name = cleanName(p && p.name);
  if (!name || isProfane(name)) name = `Chef${(Math.random() * 900 + 100) | 0}`;
  return {
    name,
    avatar: {
      skin: idx(a.skin, SKINS.length, 2), hair: idx(a.hair, HAIR_STYLES.length, 0), hairColor: idx(a.hairColor, HAIR_COLORS.length, 1),
      hat: idx(a.hat, HATS.length, 0), hatColor: idx(a.hatColor, HAT_COLORS.length, 0),
      apron: idx(a.apron, APRONS.length, 0), shirt: idx(a.shirt, SHIRTS.length, 0),
      facial: idx(a.facial, FACIAL.length, 0), extra: idx(a.extra, EXTRAS.length, 0),
    },
  };
}

// Preset chat: cooks talk with these lines only (sent by number).
export const QUICK_CHAT = [
  'Hi chefs! 👋', 'I’ll take this one! ✋', 'Can someone help me? 🙏', 'Done! ✅', 'Water’s boiling! 💨',
  'Smells amazing 😋', 'Oops! 😅', 'Speed it up? ⏩', 'Taste test! 🥄', 'Great teamwork! 🙌', 'Thank you! 💛', 'Bon appétit! 🍽️',
];

// Colours that mark each cook (name tag, claimed steps), in join order.
export const COOK_COLORS = ['#e8573a', '#2f8fd0', '#3faa5a', '#e8a51a', '#9a5ad0', '#e05a9a', '#1aa8a8', '#a86a3a',
  '#5a6ad0', '#d0503a', '#6aa82a', '#c0408a', '#3a8a8a', '#d08a1a', '#7a4ac0', '#4a9ad0'];
