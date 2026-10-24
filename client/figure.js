// The cooks: chunky chibi figures with big heads, aprons and hats, drawn with
// canvas paths. Four facings (front/back × left/right mirrored), a walk cycle
// and working poses that follow what the hands are doing – a knife going up
// and down with the player's actual gesture, a spoon going round, hands
// scrubbing under the tap.
import { SKINS, HAIR_COLORS, HAT_COLORS, APRONS, SHIRTS } from '../shared/names.js';
import { drawTool, OUTLINE, shade } from './art.js';

const TAU = Math.PI * 2;

export function lookOf(avatar = {}) {
  return {
    skin: SKINS[avatar.skin ?? 2] || SKINS[2],
    hair: avatar.hair ?? 0,
    hairColor: HAIR_COLORS[avatar.hairColor ?? 1] || HAIR_COLORS[1],
    hat: avatar.hat ?? 0,
    hatColor: HAT_COLORS[avatar.hatColor ?? 0] || '#ffffff',
    apron: APRONS[avatar.apron ?? 0] || '#ffffff',
    shirt: SHIRTS[avatar.shirt ?? 0] || SHIRTS[0],
    facial: avatar.facial ?? 0,
    extra: avatar.extra ?? 0,
  };
}

function ol(ctx, s, w = 2.2) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = w * s;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function capsule(ctx, x1, y1, x2, y2, r) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.arc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// pose: {d: 0..3 facing (0 front-right, 1 front-left, 2 back-left, 3 back-right),
//        walk: phase in turns or -1, work: {tool, a: 0..1 (hand height), b: -1..1 (side), mode}}
export function drawCook(ctx, x, y, s, look, pose = {}, t = 0) {
  const d = pose.d ?? 0;
  const back = d === 2 || d === 3;
  const flip = d === 1 || d === 2;
  const walking = pose.walk >= 0;
  const ph = walking ? pose.walk * TAU : 0;
  const bob = walking ? Math.abs(Math.sin(ph)) * 2.2 : Math.sin(t * 2.2) * 0.6;
  const work = pose.work || null;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -s : s, s);
  const S = 1; // drawing in unit space now (scale applied)

  // shadow
  ctx.fillStyle = 'rgba(40,25,20,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 17, 6.5, 0, 0, TAU);
  ctx.fill();

  ctx.translate(0, -bob);

  // legs
  const legSwing = walking ? Math.sin(ph) * 5 : 0;
  ol(ctx, S);
  for (const side of [-1, 1]) {
    const lx = side * 5.5 + (side === -1 ? legSwing : -legSwing) * 0.6;
    const lift = walking ? Math.max(0, Math.sin(ph + (side === -1 ? 0 : Math.PI))) * 2.5 : 0;
    ctx.fillStyle = '#4a4458';
    rrect(ctx, lx - 4.2, -15, 8.4, 12 - lift, 3);
    ctx.fill(); ctx.stroke();
    // shoes
    ctx.fillStyle = '#3a2a24';
    ctx.beginPath();
    ctx.ellipse(lx + (back ? -0.5 : 1), -2.5 - lift, 5.6, 3.6, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
  }

  // seen from the back, the arms work in front of the body: draw them first
  const arms = armPose(work, walking, ph, t, back);
  if (back) drawArms(ctx, look, arms);

  // body
  ctx.fillStyle = look.shirt;
  ctx.beginPath();
  ctx.moveTo(-15, -36);
  ctx.quadraticCurveTo(-17, -24, -15, -13);
  ctx.quadraticCurveTo(0, -9, 15, -13);
  ctx.quadraticCurveTo(17, -24, 15, -36);
  ctx.quadraticCurveTo(0, -42, -15, -36);
  ctx.closePath();
  ctx.fill(); ol(ctx, S); ctx.stroke();
  // shirt shade
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.beginPath();
  ctx.moveTo(6, -38); ctx.quadraticCurveTo(16, -26, 13, -13); ctx.quadraticCurveTo(10, -12, 8, -12); ctx.quadraticCurveTo(11, -25, 6, -38);
  ctx.fill();

  if (!back) {
    // apron front with a bib and a pocket
    ctx.fillStyle = look.apron;
    ctx.beginPath();
    ctx.moveTo(-8, -35);
    ctx.lineTo(8, -35);
    ctx.lineTo(9, -27);
    ctx.quadraticCurveTo(13, -18, 12, -10);
    ctx.quadraticCurveTo(0, -7, -12, -10);
    ctx.quadraticCurveTo(-13, -18, -9, -27);
    ctx.closePath();
    ctx.fill(); ol(ctx, S, 1.8); ctx.stroke();
    ctx.strokeStyle = shade(look.apron, -0.25);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    rrect(ctx, -5, -21, 10, 6, 2);
    ctx.stroke();
    // neck strap
    ctx.strokeStyle = shade(look.apron, -0.15);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-8, -35); ctx.lineTo(-6, -40); ctx.moveTo(8, -35); ctx.lineTo(6, -40); ctx.stroke();
  } else {
    // apron strings tied in a bow at the back
    ctx.strokeStyle = look.apron;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-15, -24); ctx.quadraticCurveTo(0, -21, 15, -24); ctx.stroke();
    ctx.fillStyle = look.apron;
    ol(ctx, S, 1.4);
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * 4.5, -23, 4.2, 2.6, sx * 0.5, 0, TAU);
      ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-1, -22); ctx.lineTo(-4, -15); ctx.moveTo(1, -22); ctx.lineTo(4, -15);
    ctx.strokeStyle = look.apron; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.fillStyle = shade(look.apron, -0.2);
    ctx.beginPath(); ctx.arc(0, -23, 1.8, 0, TAU); ctx.fill();
  }

  if (!back) drawArms(ctx, look, arms);
  // head (nods a little while chopping)
  const hy = -58 + (work && work.mode === 'chop' ? 1 : 0);
  drawHead(ctx, look, 0, hy, back, t);

  ctx.restore();

  // the tool is drawn unflipped, at the working hand (world space)
  if (arms.tool && arms.toolAt) {
    const tx = x + (flip ? -arms.toolAt[0] : arms.toolAt[0]) * s;
    const ty = y + (arms.toolAt[1] - bob) * s;
    const visible = !back || arms.toolAt[1] < -44;
    if (visible) drawTool(ctx, arms.tool, tx, ty, s * 0.2, (flip ? -1 : 1) * (arms.toolAng || 0), false);
  }
}

// Where the hands are: rest, walking swing, or following the work gesture.
function armPose(work, walking, ph, t, back) {
  const rest = { l: [-15, -22], r: [15, -22], tool: null };
  if (work) {
    const a = Math.max(0, Math.min(1, work.a ?? 0.5));
    const b = Math.max(-1, Math.min(1, work.b ?? 0));
    const tool = work.tool || null;
    switch (work.mode) {
      case 'chop': {
        // right hand goes up and down with the knife, left hand holds the food
        const y = -26 - a * 22;
        return { l: [-11, -30], r: [13, y], tool, toolAt: [17, y - 2], toolAng: 0 };
      }
      case 'circle': {
        const ang = (work.b ?? t * 4);
        const cx = 6 + Math.cos(ang) * 7, cy = -30 + Math.sin(ang) * 3.5;
        return { l: [-12, -27], r: [cx, cy], tool, toolAt: [cx + 2, cy - 4], toolAng: 0.4 };
      }
      case 'scrub': {
        const sx = b * 7;
        return { l: [-6 + sx, -30], r: [6 + sx, -30], tool: null };
      }
      case 'stroke': {
        const y = -24 - a * 14;
        return { l: [-9 + b * 3, y], r: [9 + b * 3, y], tool, toolAt: [0 + b * 3, y - 3], toolAng: Math.PI / 2 };
      }
      case 'pour': {
        const tilt = a;
        return { l: [-8, -36], r: [12, -40], tool, toolAt: [16, -46], toolAng: -tilt * 1.4 };
      }
      default: { // holding / reaching
        const y = -28 - a * 10;
        return { l: [-10, y + 2], r: [12 + b * 4, y], tool, toolAt: [16 + b * 4, y - 3], toolAng: 0 };
      }
    }
  }
  if (walking) {
    const sw = Math.sin(ph) * 5;
    return { l: [-15 + sw * 0.3, -22 - sw], r: [15 - sw * 0.3, -22 + sw], tool: null };
  }
  const br = Math.sin(t * 2.2) * 0.6;
  return { l: [rest.l[0], rest.l[1] + br], r: [rest.r[0], rest.r[1] + br], tool: null };
}

// shoulders at (±13, -34); sleeves in the shirt colour, hands in skin
function drawArms(ctx, look, arms) {
  for (const [sx, hand] of [[-1, arms.l], [1, arms.r]]) {
    ctx.fillStyle = look.shirt;
    capsule(ctx, sx * 13, -34, hand[0], hand[1], 4.4);
    ctx.fill(); ol(ctx, 1, 1.9); ctx.stroke();
    ctx.fillStyle = look.skin;
    ctx.beginPath(); ctx.arc(hand[0], hand[1], 4.4, 0, TAU); ctx.fill(); ol(ctx, 1, 1.9); ctx.stroke();
  }
}

function drawHead(ctx, look, hx, hy, back, t) {
  const R = 18.5;
  // hair behind the head (long styles)
  if ([2, 4, 9].includes(look.hair) && look.hat !== 4 && look.hat !== 6) {
    ctx.fillStyle = look.hairColor;
    ctx.beginPath();
    if (look.hair === 2) { rrect(ctx, hx - R - 1, hy - 6, 2 * R + 2, 26, 9); }
    else if (look.hair === 4) { ctx.ellipse(hx + (back ? 0 : 0), hy + 10, 6, 13, 0, 0, TAU); }
    else { rrect(ctx, hx - R + 1, hy - 4, 2 * R - 2, 24, 6); }
    ctx.fill(); ol(ctx, 1, 2); ctx.stroke();
  }
  // ears
  ctx.fillStyle = look.skin;
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(hx + sx * (R - 1), hy + 2, 4, 5, 0, 0, TAU); ctx.fill(); ol(ctx, 1, 2); ctx.stroke();
  }
  // head
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.ellipse(hx, hy, R, R * 0.96, 0, 0, TAU);
  ctx.fill(); ol(ctx, 1, 2.3); ctx.stroke();
  // cheek shade
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  ctx.beginPath(); ctx.ellipse(hx + 7, hy + 6, 10, 9, 0, 0, TAU); ctx.fill();

  if (!back) drawFace(ctx, look, hx, hy, t);
  drawHair(ctx, look, hx, hy, R, back);
  drawHat(ctx, look, hx, hy, R, back);
  if (!back && (look.extra === 1 || look.extra === 2)) drawGlasses(ctx, look.extra === 2, hx, hy);
}

function drawFace(ctx, look, hx, hy, t) {
  // blink now and then
  const blink = (t % 4.3) < 0.12;
  ctx.fillStyle = '#2a1d1a';
  for (const sx of [-1, 1]) {
    const ex = hx + sx * 6.5 + 1.5, ey = hy + 1;
    if (blink) { ctx.fillRect(ex - 2.5, ey - 0.5, 5, 1.6); continue; }
    ctx.beginPath(); ctx.ellipse(ex, ey, 2.4, 3.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex + 0.8, ey - 1.2, 0.95, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a1d1a';
  }
  // brows
  ctx.strokeStyle = shade(look.hairColor, -0.1);
  ctx.lineWidth = 1.6;
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(hx + sx * 6.5 + 1.5 - 2.6, hy - 4.8); ctx.quadraticCurveTo(hx + sx * 6.5 + 1.5, hy - 6.4, hx + sx * 6.5 + 1.5 + 2.6, hy - 4.8); ctx.stroke();
  }
  // cheeks
  ctx.fillStyle = look.extra === 4 ? 'rgba(240,90,90,0.55)' : 'rgba(240,110,110,0.32)';
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hx + sx * 10 + 1.5, hy + 6, 3.4, 2.2, 0, 0, TAU); ctx.fill(); }
  // freckles
  if (look.extra === 3) {
    ctx.fillStyle = 'rgba(140,80,50,0.6)';
    for (const [fx, fy] of [[-9, 4], [-11, 6], [-8, 7], [11, 4], [13, 6], [10, 7]]) { ctx.beginPath(); ctx.arc(hx + fx + 1.5, hy + fy, 0.7, 0, TAU); ctx.fill(); }
  }
  // nose
  ctx.strokeStyle = shade(look.skin, -0.3);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(hx + 2.5, hy + 3); ctx.quadraticCurveTo(hx + 4.5, hy + 5.5, hx + 2, hy + 6.5); ctx.stroke();
  // mouth: a happy little smile
  ctx.strokeStyle = '#6a2a24';
  ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(hx - 2.5, hy + 9); ctx.quadraticCurveTo(hx + 1.5, hy + 12.5, hx + 5.5, hy + 9); ctx.stroke();
  // facial hair
  const fc = look.hairColor;
  if (look.facial === 1 || look.facial === 2) {
    const big = look.facial === 2;
    ctx.fillStyle = fc;
    ctx.beginPath();
    ctx.moveTo(hx + 1.5, hy + 7.2);
    ctx.bezierCurveTo(hx - 3, hy + 5.5, hx - (big ? 11 : 7), hy + 7, hx - (big ? 12 : 7.5), hy + (big ? 4 : 9.5));
    ctx.bezierCurveTo(hx - (big ? 9 : 5), hy + 11, hx - 2, hy + 10, hx + 1.5, hy + 9);
    ctx.bezierCurveTo(hx + 5, hy + 10, hx + (big ? 12 : 8), hy + 11, hx + (big ? 15 : 10.5), hy + (big ? 4 : 9.5));
    ctx.bezierCurveTo(hx + (big ? 14 : 10), hy + 7, hx + 6, hy + 5.5, hx + 1.5, hy + 7.2);
    ctx.fill(); ol(ctx, 1, 1.4); ctx.stroke();
  } else if (look.facial === 3) {
    ctx.fillStyle = fc;
    ctx.beginPath();
    ctx.moveTo(hx - 17, hy + 1);
    ctx.quadraticCurveTo(hx - 15, hy + 18, hx + 1.5, hy + 20);
    ctx.quadraticCurveTo(hx + 18, hy + 18, hx + 19, hy + 1);
    ctx.quadraticCurveTo(hx + 14, hy + 9, hx + 1.5, hy + 7.5);
    ctx.quadraticCurveTo(hx - 12, hy + 9, hx - 17, hy + 1);
    ctx.fill(); ol(ctx, 1, 1.6); ctx.stroke();
    ctx.strokeStyle = '#6a2a24'; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(hx - 1.5, hy + 11); ctx.quadraticCurveTo(hx + 1.5, hy + 13.5, hx + 4.5, hy + 11); ctx.stroke();
  } else if (look.facial === 4) {
    ctx.fillStyle = 'rgba(60,40,30,0.25)';
    ctx.beginPath(); ctx.ellipse(hx + 1.5, hy + 11, 12, 7, 0, 0, Math.PI); ctx.fill();
  }
}

function drawGlasses(ctx, round, hx, hy) {
  ctx.strokeStyle = '#2a2a32';
  ctx.lineWidth = 1.6;
  ctx.fillStyle = 'rgba(200,230,255,0.25)';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    if (round) ctx.arc(hx + sx * 6.5 + 1.5, hy + 1, 4.6, 0, TAU);
    else ctx.roundRect(hx + sx * 6.5 + 1.5 - 5, hy - 2.6, 10, 7, 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(hx - 0.5, hy + 0.5); ctx.lineTo(hx + 3.5, hy + 0.5); ctx.stroke();
}

function drawHair(ctx, look, hx, hy, R, back) {
  const hat = look.hat;
  if (look.hair === 7) return; // bald
  if (hat === 4 || hat === 6) return; // headscarf / turban cover it
  ctx.fillStyle = look.hairColor;
  ol(ctx, 1, 2);
  const cap = hat !== 7; // a hat covers the crown: just the fringe and sides
  ctx.beginPath();
  switch (look.hair) {
    case 1: // curly
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        ctx.moveTo(hx + Math.cos(a) * R * 0.95 + 5, hy + Math.sin(a) * R * 0.9 - 2);
        ctx.arc(hx + Math.cos(a) * R * 0.95, hy + Math.sin(a) * R * 0.9 - 2, 5.5, 0, TAU);
      }
      break;
    case 5: // afro
      ctx.ellipse(hx, hy - 6, R + 6, R - 1, 0, Math.PI * 0.95, Math.PI * 2.05);
      ctx.closePath();
      break;
    case 8: // spiky
      ctx.moveTo(hx - R, hy - 2);
      for (let i = 0; i <= 6; i++) {
        const x = hx - R + (i / 6) * 2 * R;
        ctx.lineTo(x - 3, hy - R + 1 - (i % 2 ? 9 : 2));
        ctx.lineTo(x, hy - R + 4);
      }
      ctx.lineTo(hx + R, hy - 2);
      ctx.quadraticCurveTo(hx, hy - R * 0.9, hx - R, hy - 2);
      break;
    case 3: // bun
      ctx.ellipse(hx, hy - 3, R + 1, R * 0.85, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      if (!cap || hat === 7) { ctx.moveTo(hx + 8, hy - R - 2); ctx.arc(hx, hy - R - 2, 8, 0, TAU); }
      break;
    case 6: // bob
      ctx.moveTo(hx - R - 2, hy + 9);
      ctx.quadraticCurveTo(hx - R - 4, hy - R - 2, hx, hy - R - 2);
      ctx.quadraticCurveTo(hx + R + 4, hy - R - 2, hx + R + 2, hy + 9);
      ctx.lineTo(hx + R - 4, hy + 9);
      ctx.quadraticCurveTo(hx + R - 2, hy - 6, hx + 2, hy - 8);
      ctx.quadraticCurveTo(hx - R + 2, hy - 6, hx - R + 4, hy + 9);
      ctx.closePath();
      break;
    default: // short, long, ponytail, braids: a fringe sweep
      ctx.moveTo(hx - R - 1, hy + 2);
      ctx.quadraticCurveTo(hx - R - 2, hy - R - 3, hx + 2, hy - R - 2);
      ctx.quadraticCurveTo(hx + R + 3, hy - R, hx + R + 1, hy + 2);
      ctx.quadraticCurveTo(hx + R - 4, hy - 9, hx + 4, hy - 9);
      ctx.quadraticCurveTo(hx - 6, hy - 5, hx - R + 3, hy + 2);
      ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
  if (back && look.hair !== 5) {
    // the back of the head is all hair
    ctx.beginPath();
    ctx.ellipse(hx, hy - 1, R + 0.5, R * 0.96, 0, Math.PI * 0.9, Math.PI * 2.1);
    ctx.quadraticCurveTo(hx, hy + R * 0.7, hx - R * 0.95, hy + 5);
    ctx.fill(); ctx.stroke();
    if (look.hair === 4) { ctx.beginPath(); ctx.ellipse(hx, hy + 12, 5.5, 12, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
    if (look.hair === 9) {
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hx + sx * 9, hy + 14, 3.6, 11, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
    }
  }
}

function drawHat(ctx, look, hx, hy, R, back) {
  const c = look.hatColor;
  ol(ctx, 1, 2.1);
  switch (look.hat) {
    case 0: case 1: { // chef toque (tall = 1)
      const tall = look.hat === 1 ? 12 : 0;
      ctx.fillStyle = c;
      // band
      rrect(ctx, hx - R + 3, hy - R - 4, 2 * R - 6, 9, 3);
      ctx.fill(); ctx.stroke();
      // puffs
      ctx.beginPath();
      ctx.moveTo(hx - R + 4, hy - R - 3);
      ctx.bezierCurveTo(hx - R - 8, hy - R - 14 - tall, hx - 10, hy - R - 30 - tall, hx - 2, hy - R - 22 - tall);
      ctx.bezierCurveTo(hx + 2, hy - R - 34 - tall, hx + 18, hy - R - 28 - tall, hx + 12, hy - R - 18 - tall);
      ctx.bezierCurveTo(hx + R + 10, hy - R - 18 - tall, hx + R + 4, hy - R - 4, hx + R - 4, hy - R - 3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx - 6, hy - R - 5); ctx.quadraticCurveTo(hx - 8, hy - R - 14, hx - 3, hy - R - 18 - tall); ctx.moveTo(hx + 6, hy - R - 5); ctx.quadraticCurveTo(hx + 7, hy - R - 12, hx + 10, hy - R - 16 - tall); ctx.stroke();
      break;
    }
    case 2: { // bandana
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(hx, hy - 6, R + 1, R * 0.82, 0, Math.PI * 1.02, Math.PI * 1.98);
      ctx.quadraticCurveTo(hx, hy - 9, hx - R, hy - 7);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (const [dx, dy] of [[-8, -16], [0, -21], [8, -16], [-2, -12], [10, -10]]) { ctx.beginPath(); ctx.arc(hx + dx, hy + dy, 1.4, 0, TAU); ctx.fill(); }
      // knot at the back
      ctx.fillStyle = c;
      ol(ctx, 1, 1.8);
      ctx.beginPath(); ctx.ellipse(hx + (back ? 0 : -R + 1), hy - 10 + (back ? 6 : 0), 4, 3, 0.4, 0, TAU); ctx.fill(); ctx.stroke();
      break;
    }
    case 3: { // beret: a soft puffy dome slouched to one side, with a little stalk
      ctx.fillStyle = c;
      ctx.save(); ctx.translate(hx + 3, hy - R + 5); ctx.rotate(-0.18);
      ctx.beginPath();
      ctx.moveTo(-R - 3, 2);
      ctx.bezierCurveTo(-R - 6, -14, R - 2, -20, R + 6, -4);
      ctx.quadraticCurveTo(R + 4, 4, R - 4, 4);
      ctx.quadraticCurveTo(0, 8, -R - 3, 2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(-4, -9, 8, 3, -0.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(1, -14); ctx.lineTo(2, -19); ctx.stroke();
      ctx.restore();
      break;
    }
    case 4: { // headscarf (tied under the chin)
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(hx - R - 2, hy + 8);
      ctx.quadraticCurveTo(hx - R - 4, hy - R - 4, hx, hy - R - 3);
      ctx.quadraticCurveTo(hx + R + 4, hy - R - 4, hx + R + 2, hy + 8);
      ctx.quadraticCurveTo(hx + R - 2, hy + 18, hx + 1.5, hy + 18.5);
      ctx.quadraticCurveTo(hx - R + 2, hy + 18, hx - R - 2, hy + 8);
      if (!back) {
        ctx.moveTo(hx + R - 5, hy + 6);
        ctx.quadraticCurveTo(hx + R - 4, hy - 12, hx + 1.5, hy - 12);
        ctx.quadraticCurveTo(hx - R + 4, hy - 12, hx - R + 5, hy + 6);
        ctx.quadraticCurveTo(hx - R + 6, hy + 15, hx + 1.5, hy + 16);
        ctx.quadraticCurveTo(hx + R - 6, hy + 15, hx + R - 5, hy + 6);
      }
      ctx.fill('evenodd'); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(hx - 12 + i * 6, hy - R + 2 + (i % 2) * 3, 1.5, 0, TAU); ctx.fill(); }
      break;
    }
    case 5: { // cap with a brim
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(hx, hy - 7, R, R * 0.75, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (!back) { ctx.beginPath(); ctx.ellipse(hx + 6, hy - 6.5, 13, 4, 0.08, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = shade(c, 0.3);
      ctx.beginPath(); ctx.arc(hx, hy - R - 6, 2, 0, TAU); ctx.fill();
      break;
    }
    case 6: { // turban
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(hx, hy - 9, R + 3, R * 0.9, 0, Math.PI * 0.98, Math.PI * 2.02);
      ctx.quadraticCurveTo(hx, hy - 2, hx - R - 3, hy - 7);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade(c, -0.25); ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(hx - R + 2, hy - 8 - i * 6); ctx.quadraticCurveTo(hx, hy - 20 - i * 6, hx + R - 2, hy - 10 - i * 5); ctx.stroke(); }
      ctx.fillStyle = '#f2b21a';
      ctx.beginPath(); ctx.arc(hx + 2, hy - R + 1, 2.5, 0, TAU); ctx.fill();
      break;
    }
    default: break;
  }
}

// A big portrait for the profile editor / welcome card.
export function drawPortrait(ctx, w, h, look, t = 0) {
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(w / 70, h / 120);
  drawCook(ctx, w / 2, h - 10 * s, s, look, { d: 0, walk: -1, work: null }, t);
}
