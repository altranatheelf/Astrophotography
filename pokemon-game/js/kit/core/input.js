// KIT.input (§8.5): one place that answers "is this player holding a
// direction?" and "did they just press A?", whatever the hardware is —
// keyboard, on-screen pads, or a swipe across the canvas.
//
// Players are 1-based (player 1 = hero 0). Buttons are the seven names in KEYS.
//   KIT.input.attach(canvas)              // keyboard + swipe
//   KIT.input.mount(el, { players: 2 })   // on-screen d-pad + A/B/menu per player
//   KIT.input.state(1).left               // held right now (poll every frame)
//   const off = KIT.input.onPress(ev => …) // ev = { player, key }: one edge per press
//
// Repeat-safe by design: holding a direction keeps `state().left` true, and the
// map scene decides that a press shorter than TAP_MS only turns the hero.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  const KEYS = ['up', 'down', 'left', 'right', 'a', 'b', 'menu'];
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  // event.code -> button, per player. Tab is handled separately (swap heroes).
  const KEYMAP = [
    { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'a', Enter: 'a', NumpadEnter: 'a', Space: 'a', KeyX: 'b', Backspace: 'b', Escape: 'menu' },
    { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', KeyF: 'a', KeyG: 'b' },
  ];

  const TAP_MS = 90;                    // a direction held for less than this only turns
  const SWIPE_PX = 22;                  // finger travel that counts as a swipe
  const SWIPE_HOLD_MS = 160;            // how long a swipe keeps the direction held

  function blankState() { const s = {}; for (const k of KEYS) s[k] = false; return s; }

  const pads = [blankState(), blankState()];      // held, by player index
  const since = [{}, {}];                          // ms timestamp of the last press, per button
  const listeners = [];
  const edges = [new Set(), new Set()];            // pressed-this-frame, cleared by consume()
  let players = 1;
  let attached = null;                             // the element swipes are read from
  let mountEl = null;
  let releaseTimers = [];

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ---- gamepad ------------------------------------------------------------------
  // The standard mapping every modern pad reports: 0 bottom face, 1 right face,
  // 9 start, 8 select/back, 12-15 d-pad, axes 0/1 the left stick. A pad that is
  // not standard-mapped still usually agrees about these.
  const PAD_BUTTONS = { 0: 'a', 1: 'b', 2: 'b', 3: 'a', 9: 'menu', 8: 'menu', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  let DEADZONE = 0.35;
  const padWas = [];                 // last frame's held state per player, so a press is an edge

  /** Whatever the browser will tell us, or null. Never throws. */
  function readGamepads() {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav || typeof nav.getGamepads !== 'function') return null;
    try { return nav.getGamepads() || null; } catch (e) { return null; }
  }

  /** One pad, folded into player p's held state. Sticks and d-pad both count. */
  function readPad(gp, p) {
    const want = blankState();
    const btns = gp.buttons || [];
    for (const i of Object.keys(PAD_BUTTONS)) {
      const b = btns[i];
      if (b && (b.pressed || b.value > 0.5)) want[PAD_BUTTONS[i]] = true;
    }
    const ax = gp.axes || [];
    const x = Number(ax[0]) || 0, y = Number(ax[1]) || 0;
    if (x < -DEADZONE) want.left = true;
    if (x > DEADZONE) want.right = true;
    if (y < -DEADZONE) want.up = true;
    if (y > DEADZONE) want.down = true;

    const was = padWas[p] || (padWas[p] = blankState());
    for (const k of KEYS) {
      if (want[k] === was[k]) continue;
      was[k] = want[k];
      // Only the pad's own transitions are written, so holding a key on the
      // keyboard is not cancelled by an idle pad sitting on the table.
      setKey(p, k, want[k]);
    }
  }
  const idx = (player) => {
    if (player === 'p2' || player === 2) return 1;
    if (player && player.id === 'p2') return 1;
    return 0;
  };

  /** Fire the press edge: listeners + the queue read by consume(). */
  function firePress(player, key) {
    edges[player].add(key);
    for (const fn of listeners.slice()) {
      try { fn({ player: player + 1, key }); } catch (e) { (KIT.log || console).error('[input] listener threw', e); }
    }
  }

  function setKey(player, key, down) {
    // Player 2's buttons stay live even with one pad on screen: with co-op off
    // the map scene simply points them at whoever is leading.
    const pad = pads[player];
    if (!pad || !KEYS.includes(key)) return;
    if (down) {
      if (pad[key]) return;                                       // ignore auto-repeat: it is already held
      pad[key] = true;
      since[player][key] = now();
      if (key !== OPPOSITE[key]) pad[OPPOSITE[key]] = false;       // never hold two opposite directions
      firePress(player, key);
    } else {
      pad[key] = false;
    }
  }

  // ---- keyboard ---------------------------------------------------------------
  function typingInto(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeyDown(e) {
    if (typingInto(e.target)) return;
    if (e.code === 'Tab') { e.preventDefault(); firePress(0, 'swap'); return; }
    for (let p = 0; p < KEYMAP.length; p++) {
      const key = KEYMAP[p][e.code];
      if (!key) continue;
      if (e.repeat) return;                                       // held: the state is already true
      e.preventDefault();
      setKey(p, key, true);
      return;
    }
  }
  function onKeyUp(e) {
    if (typingInto(e.target)) return;
    for (let p = 0; p < KEYMAP.length; p++) {
      const key = KEYMAP[p][e.code];
      if (key) { setKey(p, key, false); return; }
    }
  }
  function onBlur() { for (let p = 0; p < pads.length; p++) for (const k of KEYS) pads[p][k] = false; }

  // ---- swipe / tap on the canvas ----------------------------------------------
  let swipe = null;
  function onPointerDown(e) {
    if (e.button != null && e.button > 0) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), fired: false };
  }
  function onPointerMove(e) {
    if (!swipe || e.pointerId !== swipe.id || swipe.fired) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    swipe.fired = true;
    hold(dir, 1, SWIPE_HOLD_MS);
  }
  function onPointerUp(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const quick = now() - swipe.t < 400;
    const moved = Math.hypot(e.clientX - swipe.x, e.clientY - swipe.y) >= SWIPE_PX;
    if (!moved && quick) { hold('a', 1, 60); }                    // a tap on the map is the A button
    swipe = null;
  }

  /** hold(key, player, ms) — press a button now and release it after `ms` (swipes, taps, tests). */
  function hold(key, player, ms) {
    const p = idx(player);
    setKey(p, key, true);
    const t = setTimeout(() => { setKey(p, key, false); }, Math.max(16, ms || 120));
    releaseTimers.push(t);
    if (releaseTimers.length > 64) releaseTimers = releaseTimers.slice(-32);
    return t;
  }

  // ---- on-screen controls -----------------------------------------------------
  function button(key, player, label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kit-btn ' + (cls || '');
    b.setAttribute('data-btn', key);
    b.setAttribute('data-player', String(player));
    b.setAttribute('aria-label', label || key);
    b.textContent = label || '';
    return b;
  }

  /**
   * mount(el, { players }) — build the touch controls inside `el`.
   * One pointer per pad: the d-pad follows a single finger (you can slide from
   * left to up without lifting); A/B/menu are their own buttons.
   */
  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    if (opts.players) players = Math.max(1, Math.min(2, opts.players | 0));
    mountEl = el;
    el.innerHTML = '';
    el.classList.add('kit-controls');
    el.setAttribute('data-players', String(players));
    for (let p = 1; p <= players; p++) el.appendChild(buildPad(p));
  }

  function buildPad(player) {
    const pad = document.createElement('div');
    pad.className = 'kit-pad';
    pad.setAttribute('data-player', String(player));

    const dpad = document.createElement('div');
    dpad.className = 'kit-dpad';
    const dirs = [['up', '▲'], ['left', '◀'], ['right', '▶'], ['down', '▼']];
    for (const [key, label] of dirs) {
      const b = button(key, player, label, 'kit-dir kit-dir-' + key);
      dpad.appendChild(b);
    }

    const face = document.createElement('div');
    face.className = 'kit-face';
    face.appendChild(button('b', player, 'B', 'kit-b'));
    face.appendChild(button('a', player, 'A', 'kit-a'));

    const extra = document.createElement('div');
    extra.className = 'kit-extra';
    if (player === 1) {
      extra.appendChild(button('menu', player, '☰', 'kit-menu'));
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.className = 'kit-btn kit-swap';
      swap.setAttribute('data-btn', 'swap');
      swap.setAttribute('data-player', '1');
      swap.setAttribute('aria-label', 'Swap heroes');
      swap.textContent = '⇄';
      extra.appendChild(swap);
    } else {
      extra.appendChild(button('menu', player, '☰', 'kit-menu'));
    }

    pad.appendChild(dpad);
    pad.appendChild(extra);
    pad.appendChild(face);
    wirePad(pad, player, dpad);
    return pad;
  }

  function wirePad(pad, player, dpad) {
    const p = idx(player);
    let padPointer = null;          // one finger per pad
    const held = new Set();

    const releaseAll = () => { for (const k of held) setKey(p, k, false); held.clear(); };
    const keyAt = (clientX, clientY) => {
      const el = document.elementFromPoint(clientX, clientY);
      const btn = el && el.closest ? el.closest('[data-btn]') : null;
      if (!btn || !pad.contains(btn)) return null;
      return btn.getAttribute('data-btn');
    };
    const apply = (key) => {
      for (const k of Array.from(held)) if (k !== key) { setKey(p, k, false); held.delete(k); }
      if (key && key !== 'swap' && !held.has(key)) { setKey(p, key, true); held.add(key); }
      if (key === 'swap') firePress(0, 'swap');
    };

    pad.addEventListener('pointerdown', (e) => {
      if (padPointer !== null) return;                    // ignore a second finger on this pad
      const key = keyAt(e.clientX, e.clientY);
      if (!key) return;
      padPointer = e.pointerId;
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* not captureable: fine */ }
      apply(key);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== padPointer) return;
      e.preventDefault();
      const key = keyAt(e.clientX, e.clientY);
      if (key === 'swap') return;                         // sliding onto swap does nothing
      // Sliding around the d-pad changes direction; sliding off releases.
      if (key && dpad.contains(document.elementFromPoint(e.clientX, e.clientY))) apply(key);
      else if (!key) releaseAll();
    });
    const end = (e) => {
      if (e.pointerId !== padPointer) return;
      padPointer = null;
      releaseAll();
      try { pad.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- public API --------------------------------------------------------------
  const INPUT = KIT.input = {
    KEYS, TAP_MS,

    /** attach(target) — keyboard on the window, swipe/tap on `target` (the canvas). */
    attach(target) {
      if (typeof window === 'undefined') return INPUT;
      INPUT.detach();
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      attached = target || null;
      if (attached) {
        attached.style.touchAction = 'none';
        attached.addEventListener('pointerdown', onPointerDown);
        attached.addEventListener('pointermove', onPointerMove);
        attached.addEventListener('pointerup', onPointerUp);
        attached.addEventListener('pointercancel', onPointerUp);
      }
      return INPUT;
    },
    detach() {
      if (typeof window === 'undefined') return INPUT;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (attached) {
        attached.removeEventListener('pointerdown', onPointerDown);
        attached.removeEventListener('pointermove', onPointerMove);
        attached.removeEventListener('pointerup', onPointerUp);
        attached.removeEventListener('pointercancel', onPointerUp);
        attached = null;
      }
      onBlur();
      return INPUT;
    },

    mount,
    /** setPlayers(n) — 1 or 2 pads; re-mounts the controls if they are on screen. */
    setPlayers(n) {
      players = Math.max(1, Math.min(2, n | 0 || 1));
      if (mountEl) mount(mountEl, { players });
      return players;
    },
    players() { return players; },

    /** state(player) -> { up, down, left, right, a, b, menu } — what is held right now. */
    state(player) { return pads[idx(player)] || blankState(); },
    /** pressed(key, player) — for the `button` condition (ctx.input.pressed). */
    pressed(key, player) { const s = pads[idx(player)]; return !!(s && s[String(key || '').toLowerCase()]); },
    /** heldMs(key, player) — how long this button has been down (0 when it is up). */
    heldMs(key, player) {
      const p = idx(player);
      if (!pads[p][key]) return 0;
      return now() - (since[p][key] || now());
    },

    /** onPress(fn) -> off. fn({ player, key }) once per press (never on auto-repeat). `key` may also be 'swap'. */
    onPress(fn) {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    /** consume() — forget the presses seen this frame (a scene that handled them calls this). */
    consume() { edges[0].clear(); edges[1].clear(); return INPUT; },
    /** justPressed(key, player) — true until consume() is called. */
    justPressed(key, player) { return edges[idx(player)].has(key); },

    /** press(key, player, ms) — synthesise a press (tests, on-screen swap button, KIT.game.press). */
    press(key, player, ms) { hold(key, player, ms == null ? 120 : ms); return INPUT; },
    /** set(key, player, down) — hold or release a button explicitly. */
    set(key, player, down) { setKey(idx(player), key, !!down); return INPUT; },
    releaseAll: onBlur,

    // ---- gamepads ----------------------------------------------------------------
    /**
     * poll(pads) — read the gamepads and fold them into the same held state the
     * keyboard writes. Call it once a frame, before anything reads state().
     *
     * The Gamepad API has no events for buttons, only a snapshot you read, so
     * this is the one part of input that has to be polled. Everything downstream
     * is unchanged: a stick is a direction, a face button is `a`, and a scene
     * cannot tell which hardware it came from.
     *
     * `pads` overrides what is read, which is how a test drives a controller and
     * how a recorded session could be played back.
     */
    poll(pads) {
      const list = pads || readGamepads();
      if (!list) return INPUT;
      let seat = 0;
      for (const gp of list) {
        if (!gp || !gp.connected) continue;
        const p = seat < players ? seat : players - 1;   // more pads than players: they share
        seat++;
        readPad(gp, p);
      }
      return INPUT;
    },
    /** gamepads(pads) -> [{ index, id, player }] — what is plugged in, for a settings screen. */
    gamepads(pads) {
      const list = pads || readGamepads() || [];
      const out = [];
      let seat = 0;
      for (const gp of list) {
        if (!gp || !gp.connected) continue;
        out.push({ index: gp.index, id: gp.id, player: (seat < players ? seat : players - 1) + 1 });
        seat++;
      }
      return out;
    },
    /** deadzone(v) — how far a stick must move before it counts. 0.1–0.9. */
    deadzone(v) { if (v != null) DEADZONE = KIT.clamp(Number(v) || 0, 0.05, 0.95); return DEADZONE; },

    isTouch() {
      if (typeof window === 'undefined') return false;
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none), (pointer: coarse)').matches;
      return !!(coarse || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
