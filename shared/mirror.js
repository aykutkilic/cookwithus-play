// A client's copy of the room: applies the host's messages ('room', 'cook',
// 'up', 'clock', 'pos') to a local state the UI and renderer read from.
// Shared so the tests can check that a guest ends up with exactly the host's state.

export function newMirror() {
  return {
    room: null,       // {code, name, hostId, kitchen, recipe, members}
    kitchen: null,    // {size, cuisine}
    cook: null,       // the cook state (see shared/cook.js) or null
    pos: new Map(),   // member id -> {x, y, d, w, p, at}
    clockAt: 0,       // local time (ms) the last clock arrived
    boil: {},
    ver: 0,           // goes up whenever the room or the cook changes (positions don't count)
  };
}

// Returns the list of events in the message (for sounds / effects).
export function applyMsg(M, msg, nowMs = 0) {
  if (msg.t !== 'pos') M.ver = (M.ver || 0) + 1;
  switch (msg.t) {
    case 'room':
      M.room = msg;
      M.kitchen = msg.kitchen;
      for (const id of [...M.pos.keys()]) if (!msg.members.some((m) => m.id === id)) M.pos.delete(id);
      return [];
    case 'cook':
      M.kitchen = msg.kitchen;
      M.cook = msg.cook;
      return [{ k: 'cook' }];
    case 'up': {
      const C = M.cook;
      if (!C || C.recipe !== msg.recipe) return [];
      if (msg.steps) for (const [id, st] of Object.entries(msg.steps)) {
        // keep the locally ticking timer values; the clock corrects them
        const old = C.steps[id];
        C.steps[id] = { ...st, t: st.t ?? (old ? old.t : 0), over: st.over ?? (old ? old.over : 0) };
      }
      if (msg.items) for (const [id, v] of Object.entries(msg.items)) { if (v == null) delete C.items[id]; else C.items[id] = v; }
      if (msg.vessels) for (const [id, v] of Object.entries(msg.vessels)) {
        const old = C.vessels[id];
        C.vessels[id] = { ...v, boil: v.boil ?? (old ? old.boil : 0) };
      }
      for (const k of ['fx', 'scraps', 'bins', 'carry', 'dw', 'tools']) if (msg[k]) C[k] = Object.assign(C[k] || {}, msg[k]);
      if (msg.tools) for (const [id, v] of Object.entries(msg.tools)) if (v == null) delete C.tools[id]; // (one no more: filled)
      for (const k of ['speed', 'started', 'finished', 'stars', 'verdict', 'credits', 'bagsOut', 'sakir']) if (k in msg) C[k] = msg[k];
      return msg.ev || [];
    }
    case 'clock': {
      const C = M.cook;
      if (!C) return [];
      C.speed = msg.speed;
      C.elapsed = msg.el;
      for (const [id, [t, over]] of Object.entries(msg.w)) if (C.steps[id]) { C.steps[id].t = t; C.steps[id].over = over; }
      for (const [id, b] of Object.entries(msg.boil || {})) if (C.vessels[id]) C.vessels[id].boil = b;
      M.clockAt = nowMs;
      return [];
    }
    case 'pos':
      for (const [id, x, y, d, w, p, ts] of msg.m) M.pos.set(id, { x, y, d, w, p, ts, at: nowMs });
      return [];
  }
  return [];
}
