// Entities (§8.2): heroes, NPCs, decorations and companions as plain objects,
// with grid movement, interpolation, the walk cycle, move routes and the
// companion trail. Pure logic — the renderer reads px/py, nothing here draws.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const E = KIT.entities = KIT.entities || {};
  const DIRS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };
  const DIR_LIST = ['up', 'down', 'left', 'right'];
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  E.DEFAULT_SPEED = 6;          // tiles per second
  E.TURN_MS = 90;               // a tap shorter than this only turns in place

  /** create(spec) -> entity. Everything optional but `id`. */
  E.create = function (spec) {
    const s = spec || {};
    const e = {
      id: s.id || KIT.uid('ent'), kind: s.kind || 'npc', objectKey: s.objectKey || null, pageIndex: s.pageIndex == null ? null : s.pageIndex,
      x: s.x || 0, y: s.y || 0, dir: s.dir || 'down',
      px: s.x || 0, py: s.y || 0,                    // interpolated position, in tiles
      sprite: s.sprite || null, art: s.art || null, look: s.look || null,
      layer: s.layer || 'same', through: !!s.through, solid: s.solid !== undefined ? !!s.solid : (s.kind !== 'look'),
      visible: s.visible !== false, dirFix: !!s.dirFix, stepAnim: !!s.stepAnim, opacity: s.opacity == null ? 1 : s.opacity,
      speed: s.speed || E.DEFAULT_SPEED, behaviour: s.behaviour || { kind: 'none' }, home: { x: s.x || 0, y: s.y || 0 },
      mover: { moving: false, fromX: s.x || 0, fromY: s.y || 0, toX: s.x || 0, toY: s.y || 0, t: 0, duration: 0, hop: false },
      walkFrame: 0, stepCount: 0, animT: 0, blocked: false, route: null, wait: 0, data: s.data || {},
    };
    return e;
  };

  E.facingTile = (e) => { const d = DIRS[e.dir] || DIRS.down; return { x: e.x + d.dx, y: e.y + d.dy }; };
  E.at = (e, x, y) => e.x === x && e.y === y;
  E.adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  E.dirToward = function (from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx === 0 ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left');
    return dy > 0 ? 'down' : 'up';
  };
  E.faceToward = function (e, target) { if (!e.dirFix) e.dir = E.dirToward(e, target); return e.dir; };

  /**
   * tryMove(entity, dir, view, opts) -> { ok, reason, connection }
   * Turns the entity, and when the way is clear starts a move (a ledge hop covers two tiles).
   * opts.turnOnly turns without moving; opts.ignoreBlocked reports but does not set `blocked`.
   */
  E.tryMove = function (e, dir, view, opts) {
    opts = opts || {};
    if (!DIRS[dir]) return { ok: false, reason: 'direction' };
    if (e.mover.moving) return { ok: false, reason: 'busy' };
    if (!e.dirFix) e.dir = dir;
    if (opts.turnOnly) return { ok: false, reason: 'turn' };
    const r = view ? view.passable(e.x, e.y, dir, e) : { ok: true, reason: 'step', to: { x: e.x + DIRS[dir].dx, y: e.y + DIRS[dir].dy } };
    if (!r.ok) { if (!opts.ignoreBlocked) e.blocked = true; return r; }
    if (r.reason === 'connection') return r;                       // the world handles the map change
    const to = r.hop || r.to;
    e.mover = { moving: true, fromX: e.x, fromY: e.y, toX: to.x, toY: to.y, t: 0, duration: (r.hop ? 2 : 1) / Math.max(0.1, e.speed), hop: !!r.hop };
    e.x = to.x; e.y = to.y;                                         // logical position updates immediately; px/py catch up
    e.blocked = false;
    return r;
  };

  /** update(entity, dt seconds) -> 'arrived' | null. Advances interpolation and the 4-step walk cycle. */
  E.update = function (e, dt) {
    let arrived = null;
    if (e.wait > 0) e.wait = Math.max(0, e.wait - dt);
    const m = e.mover;
    if (m.moving) {
      m.t += dt;
      const k = m.duration > 0 ? Math.min(1, m.t / m.duration) : 1;
      e.px = m.fromX + (m.toX - m.fromX) * k;
      e.py = m.fromY + (m.toY - m.fromY) * k;
      if (m.hop) e.py -= Math.sin(k * Math.PI) * 0.5;               // the little jump over a ledge
      e.animT += dt;
      if (k >= 1) { m.moving = false; e.px = m.toX; e.py = m.toY; e.stepCount++; e.walkFrame = (e.walkFrame + 1) % 4; arrived = 'arrived'; }
      else e.walkFrame = (e.stepCount + (k > 0.5 ? 1 : 0)) % 4;
    } else {
      e.px = e.x; e.py = e.y;
      if (e.stepAnim) { e.animT += dt; e.walkFrame = Math.floor(e.animT * 4) % 4; }
      else e.walkFrame = 0;                                          // standing frame
    }
    return arrived;
  };

  /** The sprite frame to draw: { rows, mirror } via the sprites registry, or null when there is no art. */
  const frameCache = new Map();          // 'sprite|dir|seq' -> the SAME object every time, so canvas caches keyed by identity hit
  E.frame = function (e) {
    const reg = KIT.registry.exists('sprites') ? KIT.registry('sprites') : null;
    const def = reg && e.sprite ? reg.get(e.sprite) : null;
    if (!def || !def.frames) return null;
    const seq = [0, 1, 0, 2][e.walkFrame % 4];
    const dir = e.dir === 'right' ? 'left' : e.dir;
    const frames = def.frames[dir] || def.frames.down;
    if (!frames) return null;
    const key = `${e.sprite}|${dir}|${Math.min(seq, frames.length - 1)}|${e.dir === 'right' ? 'm' : ''}`;
    let cached = frameCache.get(key);
    if (!cached || cached.def !== def) {
      cached = { def, rows: frames[Math.min(seq, frames.length - 1)], palette: def.palette, mirror: e.dir === 'right', w: def.w || 16, h: def.h || 24 };
      frameCache.set(key, cached);
    }
    return cached;
  };
  E.clearFrameCache = () => frameCache.clear();

  // ---- move routes (§9.2) -----------------------------------------------------
  /**
   * startRoute(entity, steps, { wait, skipBlocked, repeat }) — a small state machine
   * stepped by E.updateRoute(entity, dt, view, ports). `entity.route.done` flips when finished.
   */
  E.startRoute = function (e, steps, opts) {
    opts = opts || {};
    e.route = { steps: (steps || []).slice(), i: 0, repeat: !!opts.repeat, skipBlocked: opts.skipBlocked !== false, done: false, wait: 0, stuck: 0 };
    return e.route;
  };
  E.stopRoute = function (e) { if (e.route) e.route.done = true; e.route = null; };

  /** One route step. `ports` may provide { sound(id), rng } and `world` the hero for towardHero/faceHero. */
  function applyStep(e, step, view, ports) {
    const [cmd, argRaw] = String(step).split(':');
    const arg = argRaw == null ? '' : argRaw;
    const hero = ports && ports.hero;
    const rng = (ports && ports.rng) || Math.random;
    switch (cmd) {
      case 'up': case 'down': case 'left': case 'right': return E.tryMove(e, cmd, view, { ignoreBlocked: true });
      case 'randomStep': return E.tryMove(e, DIR_LIST[Math.floor((rng.int ? rng.int(4) / 4 : rng()) * 4) % 4], view, { ignoreBlocked: true });
      case 'towardHero': return hero ? E.tryMove(e, E.dirToward(e, hero), view, { ignoreBlocked: true }) : { ok: false, reason: 'no-hero' };
      case 'awayHero': return hero ? E.tryMove(e, OPPOSITE[E.dirToward(e, hero)], view, { ignoreBlocked: true }) : { ok: false, reason: 'no-hero' };
      case 'face': if (DIRS[arg]) e.dir = arg; return { ok: true, reason: 'face' };
      case 'faceHero': if (hero) e.dir = E.dirToward(e, hero); return { ok: true, reason: 'face' };
      case 'turnRandom': e.dir = DIR_LIST[Math.floor((rng.int ? rng.int(4) / 4 : rng()) * 4) % 4]; return { ok: true, reason: 'face' };
      case 'jump': {
        const [jx, jy] = arg.split(',').map(Number);
        const tx = e.x + (jx || 0), ty = e.y + (jy || 0);
        e.mover = { moving: true, fromX: e.x, fromY: e.y, toX: tx, toY: ty, t: 0, duration: Math.max(0.2, Math.hypot(jx || 0, jy || 0) / Math.max(0.1, e.speed)), hop: true };
        e.x = tx; e.y = ty;
        return { ok: true, reason: 'jump' };
      }
      case 'wait': e.wait = (Number(arg) || 0) / 1000; return { ok: true, reason: 'wait' };
      case 'sprite': e.sprite = arg; return { ok: true, reason: 'sprite' };
      case 'speed': e.speed = Math.max(0.5, Number(arg) || E.DEFAULT_SPEED); return { ok: true, reason: 'speed' };
      case 'through': e.through = arg === 'on'; return { ok: true, reason: 'through' };
      case 'visible': e.visible = arg === 'on'; return { ok: true, reason: 'visible' };
      case 'dirFix': e.dirFix = arg === 'on'; return { ok: true, reason: 'dirFix' };
      case 'stepAnim': e.stepAnim = arg === 'on'; return { ok: true, reason: 'stepAnim' };
      case 'sound': if (ports && ports.sound) ports.sound(arg); return { ok: true, reason: 'sound' };
      default: return { ok: false, reason: 'unknown-step' };
    }
  }
  E.applyStep = applyStep;

  /** updateRoute(entity, dt, view, ports) -> true when the route finished this tick. */
  E.updateRoute = function (e, dt, view, ports) {
    const r = e.route;
    if (!r || r.done) return false;
    if (e.mover.moving || e.wait > 0) return false;
    if (r.i >= r.steps.length) {
      if (r.repeat && r.steps.length) r.i = 0;
      else { r.done = true; e.route = null; return true; }
    }
    const step = r.steps[r.i];
    const res = applyStep(e, step, view, ports);
    const isMove = ['up', 'down', 'left', 'right', 'randomStep', 'towardHero', 'awayHero'].includes(String(step).split(':')[0]);
    if (isMove && !res.ok) {
      if (r.skipBlocked) r.i++;                                    // skip it and carry on
      else { r.stuck++; if (r.stuck > 240) { r.done = true; e.route = null; return true; } }
      return false;
    }
    r.stuck = 0;
    r.i++;
    return false;
  };

  // ---- companion trail --------------------------------------------------------
  /**
   * A companion walks the leader's path one tile behind (HGSS style).
   * Call E.noteLeaderStep(companion, leader) whenever the leader finishes a step.
   */
  E.noteLeaderStep = function (comp, leader) {
    comp.data.trail = comp.data.trail || [];
    comp.data.trail.push({ x: leader.mover.fromX, y: leader.mover.fromY, dir: leader.dir });
    if (comp.data.trail.length > 8) comp.data.trail.shift();
  };
  /** updateCompanion(comp, leader, dt, view) — steps the companion toward the oldest trail tile. */
  E.updateCompanion = function (comp, leader, dt, view) {
    if (comp.mover.moving) return;
    const trail = comp.data.trail || [];
    while (trail.length && trail[0].x === comp.x && trail[0].y === comp.y) trail.shift();
    if (!trail.length) return;
    const target = trail[0];
    if (Math.abs(target.x - comp.x) + Math.abs(target.y - comp.y) > 3) {   // teleport if left far behind (a warp)
      comp.x = target.x; comp.y = target.y; comp.px = comp.x; comp.py = comp.y; trail.shift(); return;
    }
    const dir = E.dirToward(comp, target);
    const r = E.tryMove(comp, dir, view, { ignoreBlocked: true });
    if (!r.ok && !comp.through) { comp.through = true; E.tryMove(comp, dir, view, { ignoreBlocked: true }); comp.through = false; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
