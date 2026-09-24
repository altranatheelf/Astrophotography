// The pure half of a bullet-hell battle: the arena, the soul, the patterns, and
// what hits what. No DOM, no canvas, no timers — so it can be tested in Node,
// which is the point of keeping it separate.
//
// This module exists to answer one question about the engine: can you write an
// Undertale battle in it? Everything it had to work around is written down in
// js/modules/bullet/README.md.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const B = KIT.bullet = KIT.bullet || {};
  const num = KIT.num;

  B.VERSION = 1;

  /** A fresh fight. The arena is in TILES, because that is the world's unit. */
  B.create = function (o) {
    o = o || {};
    return {
      box: { x: num(o.x, 5), y: num(o.y, 5), w: num(o.w, 7), h: num(o.h, 5) },
      soul: { x: num(o.x, 5) + num(o.w, 7) / 2, y: num(o.y, 5) + num(o.h, 5) / 2, r: 0.22, speed: num(o.speed, 6), invuln: 0 },
      hp: num(o.hp, 20), maxHp: num(o.hp, 20),
      bullets: [], t: 0, turn: 'menu', over: null, grazed: 0, hits: 0,
    };
  };

  /** Move the soul, clamped to the box. dir is { x, y } in -1..1. */
  B.steer = function (f, dir, dt) {
    const s = f.soul, b = f.box;
    const dx = num(dir && dir.x, 0), dy = num(dir && dir.y, 0);
    const len = Math.hypot(dx, dy) || 1;
    s.x = KIT.clamp(s.x + (dx / len) * s.speed * dt, b.x + s.r, b.x + b.w - s.r);
    s.y = KIT.clamp(s.y + (dy / len) * s.speed * dt, b.y + s.r, b.y + b.h - s.r);
    return s;
  };

  /**
   * A bullet is data, so a pattern is data too. `move` names a function in
   * B.movers, which is a registry an author can add to — the same shape the rest
   * of the engine uses.
   */
  B.spawn = function (f, o) {
    const b = {
      x: num(o.x, 0), y: num(o.y, 0), vx: num(o.vx, 0), vy: num(o.vy, 0),
      r: num(o.r, 0.2), damage: num(o.damage, 3), life: num(o.life, 6), age: 0,
      move: o.move || 'straight', art: o.art || null, look: o.look || 'bullet',
      data: o.data || {}, dead: false,
    };
    f.bullets.push(b);
    return b;
  };

  B.movers = {
    straight(b, f, dt) { b.x += b.vx * dt; b.y += b.vy * dt; },
    sine(b, f, dt) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      const a = num(b.data.amp, 0.6), w = num(b.data.freq, 3);
      b.x += Math.cos(b.age * w) * a * dt * 3;
    },
    homing(b, f, dt) {
      const dx = f.soul.x - b.x, dy = f.soul.y - b.y, d = Math.hypot(dx, dy) || 1;
      const turn = num(b.data.turn, 1.5);
      b.vx += (dx / d) * turn * dt; b.vy += (dy / d) * turn * dt;
      const sp = Math.hypot(b.vx, b.vy), max = num(b.data.speed, 4);
      if (sp > max) { b.vx = b.vx / sp * max; b.vy = b.vy / sp * max; }
      b.x += b.vx * dt; b.y += b.vy * dt;
    },
    orbit(b, f, dt) {
      const cx = num(b.data.cx, f.box.x + f.box.w / 2), cy = num(b.data.cy, f.box.y + f.box.h / 2);
      const rad = num(b.data.radius, 2), w = num(b.data.speed, 2), phase = num(b.data.phase, 0);
      b.x = cx + Math.cos(b.age * w + phase) * rad;
      b.y = cy + Math.sin(b.age * w + phase) * rad;
    },
  };

  /**
   * One step of the fight. Returns what happened, so the scene can make noise
   * about it without the rules knowing what noise is.
   */
  B.step = function (f, dt, dir) {
    f.t += dt;
    if (f.soul.invuln > 0) f.soul.invuln = Math.max(0, f.soul.invuln - dt);
    if (dir) B.steer(f, dir, dt);

    const events = { hit: 0, grazed: 0, gone: 0 };
    for (const b of f.bullets) {
      if (b.dead) continue;
      b.age += dt;
      const mover = B.movers[b.move] || B.movers.straight;
      mover(b, f, dt);
      if (b.age > b.life) { b.dead = true; events.gone++; continue; }

      const dx = b.x - f.soul.x, dy = b.y - f.soul.y;
      const d = Math.hypot(dx, dy);
      if (d < b.r + f.soul.r) {
        if (f.soul.invuln <= 0) {
          f.hp = Math.max(0, f.hp - b.damage);
          f.soul.invuln = 0.9;
          f.hits++;
          events.hit += b.damage;
        }
      } else if (d < b.r + f.soul.r + 0.25 && !b.data.grazed) {
        b.data.grazed = true;
        f.grazed++;
        events.grazed++;
      }
    }
    f.bullets = f.bullets.filter(b => !b.dead);
    if (f.hp <= 0) f.over = 'lost';
    return events;
  };

  /**
   * A PATTERN is a list of { at, spawn } — spawn at that second into the turn.
   * Data, so an author can write one in content and the editor can form itself
   * from it. `B.runPattern` is called every step and fires what is due.
   */
  B.pattern = function (steps) {
    return { steps: (steps || []).slice().sort((a, b) => a.at - b.at), fired: 0, t: 0 };
  };
  B.runPattern = function (f, p, dt) {
    p.t += dt;
    let n = 0;
    while (p.fired < p.steps.length && p.steps[p.fired].at <= p.t) {
      const s = p.steps[p.fired++];
      for (const o of [].concat(s.spawn || [])) { B.spawn(f, o); n++; }
    }
    return n;
  };
  B.patternDone = function (f, p) { return p.fired >= p.steps.length && !f.bullets.length; };

  /** A few patterns to start from, so a fight is one line to try. */
  B.PATTERNS = {
    rain(f, count) {
      const steps = [];
      for (let i = 0; i < (count || 18); i++) {
        steps.push({ at: i * 0.18, spawn: { x: f.box.x + (i * 0.7) % f.box.w, y: f.box.y - 0.5, vy: 3.5, r: 0.18, damage: 2 } });
      }
      return B.pattern(steps);
    },
    sweep(f, count) {
      const steps = [];
      for (let i = 0; i < (count || 14); i++) {
        steps.push({ at: i * 0.2, spawn: { x: f.box.x - 0.5, y: f.box.y + 0.5 + (i % 4), vx: 4, r: 0.2, damage: 3, move: 'sine', data: { amp: 0.8, freq: 4 } } });
      }
      return B.pattern(steps);
    },
    hunt(f, count) {
      const steps = [];
      for (let i = 0; i < (count || 6); i++) {
        const side = i % 4;
        const at = i * 0.5;
        const x = side === 0 ? f.box.x - 0.5 : side === 1 ? f.box.x + f.box.w + 0.5 : f.box.x + f.box.w / 2;
        const y = side === 2 ? f.box.y - 0.5 : side === 3 ? f.box.y + f.box.h + 0.5 : f.box.y + f.box.h / 2;
        steps.push({ at, spawn: { x, y, vx: 0, vy: 0, r: 0.22, damage: 4, life: 5, move: 'homing', data: { turn: 2.2, speed: 3.2 } } });
      }
      return B.pattern(steps);
    },
    ring(f, count) {
      const n = count || 12;
      const cx = f.box.x + f.box.w / 2, cy = f.box.y + f.box.h / 2;
      const steps = [];
      for (let i = 0; i < n; i++) {
        steps.push({ at: 0.1, spawn: { x: cx, y: cy, r: 0.18, damage: 2, life: 4, move: 'orbit', data: { cx, cy, radius: 1.8, speed: 1.6, phase: (i / n) * Math.PI * 2 } } });
      }
      return B.pattern(steps);
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
