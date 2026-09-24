// Atmosphere: what makes a place feel enormous, or cold, or wrong. Darkness with
// real light sources, fog, grain, vignette, letterboxing and a colour wash —
// composited over the finished frame, so nothing else has to know about it.
//
// A map carries its own atmosphere in map.props.atmosphere; the `atmosphere`
// command changes it during a scene, fading over time. Lights come from objects
// whose page props carry `light`, and from the heroes when they carry one.
//
//   KIT.atmosphere.set({ darkness: 0.8, ambient: '#0a1020' }, { ms: 2000 })
//   KIT.atmosphere.draw(ctx, world, { tilePx, camX, camY, W, H })
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const A = KIT.atmosphere = KIT.atmosphere || {};

  /** Everything an atmosphere is. All optional; missing means "nothing". */
  const BLANK = {
    darkness: 0,            // 0 clear, 1 pitch dark outside the lights
    ambient: '#05070d',     // the colour the darkness is made of
    tint: null,             // { color, amount } — a wash over everything
    fog: null,              // { color, amount, speed, scale }
    grain: 0,               // film grain
    vignette: 0,            // darkened corners
    letterbox: 0,           // 0..0.2 of the height, top and bottom
    lightScale: 1,          // multiply every light radius (a torch running low)
  };
  A.BLANK = BLANK;

  let current = Object.assign({}, BLANK);
  let target = Object.assign({}, BLANK);
  let fade = { from: null, ms: 0, t: 0 };
  let noiseCanvas = null, noiseAt = 0;

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const lerp = (a, b, k) => a + (b - a) * k;
  function lerpColor(a, b, k) {
    const pa = hex(a), pb = hex(b);
    return `rgb(${Math.round(lerp(pa[0], pb[0], k))},${Math.round(lerp(pa[1], pb[1], k))},${Math.round(lerp(pa[2], pb[2], k))})`;
  }
  function hex(c) {
    const s = String(c || '#000000').replace('#', '');
    const n = parseInt(s.length === 3 ? s.split('').map(x => x + x).join('') : s, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  A.rgba = function (color, alpha) { const p = hex(color); return `rgba(${p[0]},${p[1]},${p[2]},${alpha})`; };

  /** The atmosphere as it is being drawn right now. */
  A.state = () => current;
  /** What it is heading towards (the same object when nothing is fading). */
  A.goal = () => target;

  /** set(values, { ms }) — change some of it, optionally fading over ms. */
  A.set = function (values, opts) {
    const next = Object.assign({}, target);
    for (const k of Object.keys(values || {})) if (k in BLANK) next[k] = values[k];
    target = next;
    const ms = (opts && opts.ms) || 0;
    if (ms > 0) { fade = { from: Object.assign({}, current), ms, t: 0 }; }
    else { current = Object.assign({}, target); fade = { from: null, ms: 0, t: 0 }; }
    return current;
  };
  /** Adopt a map's own atmosphere (called when a map is entered). */
  A.useMap = function (map, opts) {
    const a = (map && map.props && map.props.atmosphere) || null;
    A.set(Object.assign({}, BLANK, a || {}), opts);
    return current;
  };
  A.reset = function () { current = Object.assign({}, BLANK); target = Object.assign({}, BLANK); fade = { from: null, ms: 0, t: 0 }; };

  /** update(dt seconds) — advances a fade. */
  A.update = function (dt) {
    if (!fade.from || fade.ms <= 0) return;
    fade.t += dt * 1000;
    const k = Math.min(1, fade.t / fade.ms);
    const out = {};
    for (const key of Object.keys(BLANK)) {
      const a = fade.from[key], b = target[key];
      if (isNum(a) && isNum(b)) out[key] = lerp(a, b, k);
      else if (key === 'ambient') out[key] = lerpColor(a, b, k);
      else if (key === 'tint' || key === 'fog') {
        if (!a && !b) out[key] = null;
        else {
          const from = a || Object.assign({}, b, { amount: 0 });
          const to = b || Object.assign({}, a, { amount: 0 });
          out[key] = Object.assign({}, to, { amount: lerp(from.amount || 0, to.amount || 0, k), color: lerpColor(from.color || '#000', to.color || '#000', k) });
        }
      } else out[key] = k >= 1 ? b : a;
    }
    current = out;
    if (k >= 1) { current = Object.assign({}, target); fade = { from: null, ms: 0, t: 0 }; }
  };

  /**
   * lights(world) -> [{ x, y, radius, color, softness, flicker }] in TILE units.
   * An object lights the world through its page props: `light: { radius, color, flicker, softness }`.
   * A hero lights it through `hero.data.light` (a lantern the player carries).
   */
  A.lights = function (world) {
    const out = [];
    const add = (e, l) => {
      if (!l || !(l.radius > 0)) return;
      out.push({ x: (e.px != null ? e.px : e.x) + 0.5, y: (e.py != null ? e.py : e.y) + 0.5,
        radius: l.radius, color: l.color || '#ffd9a0', softness: l.softness == null ? 0.45 : l.softness,
        flicker: l.flicker || 0, seed: e.id || '' });
    };
    for (const e of world.entities || []) {
      if (e.visible === false) continue;
      const l = (e.page && e.page.props && e.page.props.light) || (e.data && e.data.light);
      add(e, l);
    }
    for (const h of world.heroes || []) if (h.visible !== false && h.data && h.data.light) add(h, h.data.light);
    if (world.companion && world.companion.data && world.companion.data.light) add(world.companion, world.companion.data.light);
    return out;
  };

  function noise(size) {
    if (noiseCanvas && noiseCanvas.width === size) return noiseCanvas;
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const img = c.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.floor(Math.random() * 136);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    noiseCanvas = cv;
    return cv;
  }

  /**
   * draw(ctx, world, view) — paint the atmosphere over the finished frame.
   * view: { tilePx, camX, camY, W, H, time } in DEVICE pixels (the renderer's own units).
   */
  /**
   * One offscreen canvas, kept and resized rather than made every frame. The
   * darkness pass draws itself here so its light holes cut the darkness and not
   * the picture underneath it.
   */
  const pads = {};
  function scratch(w, h, which) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const k = which || 'dark';
    let pad = pads[k];
    if (!pad) pad = pads[k] = document.createElement('canvas');
    if (pad.width !== w || pad.height !== h) { pad.width = w; pad.height = h; }
    return pad;
  }
  A.LAYERED_DARKNESS = true;          // a module can ask whether it still has to help
  A.lightDetail = 'soft';             // 'soft' builds the dark at half size; 'full' at every pixel

  /**
   * One radial falloff, drawn once and then blitted.
   *
   * `createRadialGradient` plus two `addColorStop`s, per light, twice per frame,
   * was the only thing measuring below 60: thirty-two lanterns on a dark map ran
   * 56.5fps and the gradients were all of it. A gradient is a small program the
   * rasteriser has to build; a sprite is a `drawImage`. Cached on the shape
   * (softness) and the colour, both of which a game has a handful of, so the
   * cache fills in the first second and never grows again.
   */
  const SPRITE_R = 128;
  const sprites = new Map();
  function falloff(key, inner, stop0, stop1) {
    const had = sprites.get(key);
    if (had !== undefined) return had;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = SPRITE_R * 2;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(SPRITE_R, SPRITE_R, SPRITE_R * inner, SPRITE_R, SPRITE_R, SPRITE_R);
    g.addColorStop(0, stop0);
    g.addColorStop(1, stop1);
    c.fillStyle = g;
    c.fillRect(0, 0, SPRITE_R * 2, SPRITE_R * 2);
    if (sprites.size > 32) sprites.clear();   // a palette swap, not a leak
    sprites.set(key, cv);
    return cv;
  }

  /** Paint one light. Blit when we can, build the gradient when there is no DOM. */
  function blot(c, key, inner, stop0, stop1, x, y, r) {
    const sp = falloff(key, inner, stop0, stop1);
    if (sp) { c.drawImage(sp, x - r, y - r, r * 2, r * 2); return; }
    const g = c.createRadialGradient(x, y, r * inner, x, y, r);
    g.addColorStop(0, stop0);
    g.addColorStop(1, stop1);
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }

  A.draw = function (ctx, world, view) {
    const a = current;
    if (!a) return;
    const { W, H, tilePx, camX, camY } = view;
    const time = view.time || 0;

    // 1. darkness with holes where the lights are
    //
    // On its OWN layer, and this matters. Punching the holes with
    // `destination-out` straight onto the finished frame erases the map as well
    // as the darkness over it, so the lit circle comes out nearly as blank as the
    // dark — measured on a dungeon at darkness 0.88, the floor inside the lantern
    // read 64 against 51 outside it, which is not a lantern, it is a smudge.
    // Built on a layer and composited with `source-over`, the same floor reads
    // 135 against 51: the light shows you the room.
    if (a.darkness > 0.001) {
      // Two things decide what this costs, and neither is the gradient.
      //
      // The first is how many lights are painted: the benchmark put 32 lanterns
      // on a 16x12 patch of a map the camera only shows 12x9 of, and every one
      // of them painted a 444px circle whether or not it was on screen. Lights
      // off screen are skipped now.
      //
      // The second is fill rate. A light of radius 3 on a 74px tile is a 444px
      // disc, and thirty of those, twice, is twelve million blended pixels a
      // frame. But darkness has no detail in it — a flat fill and some soft
      // holes — so it is built at half resolution and blown up on the way out.
      // Four times fewer pixels, and you cannot see the difference.
      const all = A.lights(world);
      const S = Math.max(1, A.lightDetail === 'full' ? 1 : 2);
      const lw = Math.max(1, Math.ceil(W / S)), lh = Math.max(1, Math.ceil(H / S));
      const px = tilePx / S;
      const lights = [];
      for (const l of all) {
        const r = Math.max(2, l.radius * (a.lightScale || 1) * 1.14 * px);   // 1.14: room for the flicker
        const x = (l.x - camX) * px, y = (l.y - camY) * px;
        if (x + r < 0 || x - r > lw || y + r < 0 || y - r > lh) continue;    // not on screen
        lights.push(l);
      }
      const layer = lights.length ? scratch(lw, lh) : null;
      const lc = layer ? layer.getContext('2d') : null;
      const c = lc || ctx;
      const k = lc ? px : tilePx;                  // the units `c` is working in
      ctx.save();
      if (lc) {
        lc.save();
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.clearRect(0, 0, lw, lh);
      }
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = A.rgba(a.ambient, a.darkness);
      c.fillRect(0, 0, lc ? lw : W, lc ? lh : H);
      if (lights.length) {
        c.globalCompositeOperation = 'destination-out';
        c.imageSmoothingEnabled = true;      // the falloff is a gradient, not pixel art
        for (const l of lights) {
          const flick = l.flicker ? 1 + Math.sin(time / 90 + KIT.hash(l.seed) % 100) * 0.06 * l.flicker + (KIT.hash(l.seed, Math.floor(time / 120)) % 100) / 100 * 0.04 * l.flicker : 1;
          const r = Math.max(2, l.radius * (a.lightScale || 1) * flick * k);
          const x = (l.x - camX) * k, y = (l.y - camY) * k;
          const soft = Math.round(KIT.clamp(l.softness, 0, 0.95) * 32) / 32;
          blot(c, 'hole:' + soft, 1 - soft, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)', x, y, r);
        }
        if (lc) {
          lc.restore();
          // the darkness, with its holes, over the frame — and nothing erased
          ctx.globalCompositeOperation = 'source-over';
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(layer, 0, 0, lw, lh, 0, 0, W, H);
        } else {
          c.globalCompositeOperation = 'source-over';
        }
        // Warm the lit area back up a little, so a lantern reads as a lantern.
        // Gathered on its own half-size layer for the same reason as the dark,
        // then laid over the frame in one blit.
        const glow = lc ? scratch(lw, lh, 'glow') : null;
        const gc = glow ? glow.getContext('2d') : null;
        const w2 = gc || ctx;
        const k2 = gc ? px : tilePx;
        if (gc) {
          gc.save();
          gc.setTransform(1, 0, 0, 1, 0, 0);
          gc.clearRect(0, 0, lw, lh);
        }
        w2.globalCompositeOperation = 'lighter';
        w2.imageSmoothingEnabled = true;
        w2.globalAlpha = 0.18 * a.darkness;
        for (const l of lights) {
          const r = Math.max(2, l.radius * (a.lightScale || 1) * k2);
          const x = (l.x - camX) * k2, y = (l.y - camY) * k2;
          const col = l.color || '#ffd9a0';
          blot(w2, 'warm:' + col, 0, A.rgba(col, 1), 'rgba(0,0,0,0)', x, y, r);
        }
        if (gc) {
          gc.restore();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'lighter';
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(glow, 0, 0, lw, lh, 0, 0, W, H);
        }
      }
      ctx.restore();
    }

    // 2. fog: two slow drifting bands, so it moves without a particle system
    if (a.fog && a.fog.amount > 0.001) {
      const scale = (a.fog.scale || 6) * tilePx;
      ctx.save();
      ctx.globalAlpha = a.fog.amount;
      for (let i = 0; i < 2; i++) {
        const drift = (time * (a.fog.speed || 0.02) * (i ? -1 : 1)) % scale;
        const g = ctx.createLinearGradient(0, i ? H * 0.2 : 0, W, i ? H : H * 0.8);
        g.addColorStop(0, A.rgba(a.fog.color || '#b8c6d8', 0));
        g.addColorStop(0.5, A.rgba(a.fog.color || '#b8c6d8', 0.7));
        g.addColorStop(1, A.rgba(a.fog.color || '#b8c6d8', 0));
        ctx.fillStyle = g;
        ctx.translate(drift, 0);
        ctx.fillRect(-scale, 0, W + scale * 2, H);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.restore();
    }

    // 3. a colour wash
    if (a.tint && a.tint.amount > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = a.tint.amount;
      ctx.fillStyle = a.tint.color || '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 4. grain
    if (a.grain > 0.001) {
      const n = noise(96);
      if (n) {
        ctx.save();
        ctx.globalAlpha = a.grain * 0.5;
        ctx.globalCompositeOperation = 'overlay';
        const step = Math.floor(time / 70);
        const ox = (KIT.hash('gx', step) % 96), oy = (KIT.hash('gy', step) % 96);
        for (let y = -oy; y < H; y += 96) for (let x = -ox; x < W; x += 96) ctx.drawImage(n, x, y);
        ctx.restore();
      }
    }

    // 5. vignette
    if (a.vignette > 0.001) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${KIT.clamp(a.vignette, 0, 1)})`);
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    // 6. letterbox
    if (a.letterbox > 0.001) {
      const bar = Math.round(H * KIT.clamp(a.letterbox, 0, 0.3));
      ctx.save(); ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
      ctx.restore();
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
