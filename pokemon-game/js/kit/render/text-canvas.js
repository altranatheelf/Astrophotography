// Text, on the canvas.
//
// The dialogue box is DOM, and that is right for it — real text, selectable,
// scalable, readable on a phone, and the browser does the hard parts. But a
// scene that owns the screen has to draw its own words, and an Undertale battle
// IS its words: `* Smells like a trash can.` sits inside the arena box, FIGHT /
// ACT / ITEM / MERCY are four labels on the battle surface, damage numbers fly
// off the enemy, the enemy's name and HP sit above it. None of that is a DOM
// overlay; all of it is drawn.
//
// So this is the same text pipeline, pointed at a 2D context. Deliberately the
// SAME: KIT.text.tokenize and KIT.text.wrap are already pure and already
// understand {color:}, {size:}, {voice:} and {fx:}, so a line written for the
// dialogue box renders in a battle without being rewritten, and an author learns
// one set of codes rather than two.
//
// The effects are better here than in CSS, for one reason: they are a function
// of a time you pass in, so the same frame draws the same way twice. A recording
// or a screenshot test gets the same pixels.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const TC = KIT.textCanvas = KIT.textCanvas || {};

  const DEFAULT_FONT = 'system-ui, sans-serif';

  /** The CSS font string for a span, given the base options. */
  function fontFor(opts, span) {
    const voice = span && span.voice ? voiceOf(span.voice) : null;
    const family = (voice && voice.font) || opts.font || DEFAULT_FONT;
    const scale = sizeScale(span, voice);
    const px = Math.max(1, Math.round((opts.size || 16) * scale));
    const weight = opts.weight || 'normal';
    return `${weight} ${px}px ${family}`;
  }
  function sizeScale(span, voice) {
    const s = (span && span.size) || (voice && voice.size) || 'normal';
    return s === 'big' ? 1.3 : s === 'small' ? 0.82 : 1;
  }
  function voiceOf(id) {
    const reg = KIT.registry && KIT.registry.exists('voices') ? KIT.registry('voices') : null;
    return (reg && id && reg.get(id)) || null;
  }
  function colorFor(opts, span) {
    if (span && span.color) return span.color;
    const voice = span && span.voice ? voiceOf(span.voice) : null;
    if (voice && voice.color) return voice.color;
    return opts.color || '#ffffff';
  }

  /**
   * offsetFor(fx, amount, index, time) -> { dx, dy, alpha, color }
   *
   * The canvas half of the text effects. Same names as the CSS ones so a line
   * looks the same in a battle as it does in the dialogue box, but computed from
   * `time` rather than left to an animation clock — so it is deterministic, and
   * a screenshot taken at t=1000 is the same screenshot every run.
   */
  TC.offsetFor = function (fx, amount, index, time) {
    const a = amount == null ? 1 : amount;
    const t = time || 0;
    switch (fx) {
      case 'wave':
        return { dx: 0, dy: Math.sin(t / 175 + index * 0.55) * 2.2 * a };
      case 'shiver': {
        // Deterministic, not random: the same character at the same moment
        // jitters the same way, twice.
        const step = Math.floor(t / 45);
        return { dx: ((KIT.hash(index, step) % 3) - 1) * a, dy: ((KIT.hash(index + 977, step) % 3) - 1) * a };
      }
      case 'drift':
        return { dx: 0, dy: Math.sin(t / 900) * 1.6 * a };
      case 'throb':
        return { dx: 0, dy: 0, alpha: 1 - 0.45 * a * (0.5 - Math.cos(t / 800) * 0.5) };
      case 'rainbow': {
        const hue = ((t / 12) + index * 22) % 360;
        return { dx: 0, dy: 0, color: `hsl(${hue.toFixed(0)}, 78%, 66%)` };
      }
      default:
        return { dx: 0, dy: 0 };
    }
  };

  /**
   * measurer(ctx, opts) -> fn(str) -> width, for KIT.text.wrap.
   * Measures in the base font, which is what wrapping needs: a {size:big} run is
   * rare and slightly under-measured, which errs toward a shorter line rather
   * than one that runs off the edge.
   */
  TC.measurer = function (ctx, opts) {
    const font = fontFor(opts, null);
    return (s) => { ctx.font = font; return ctx.measureText(s).width; };
  };

  /**
   * layout(ctx, str, opts) -> { lines, width, height, chars }
   *
   * `lines` is the wrapped span structure; `chars` is the total number of
   * drawable characters, which is what a typewriter counts against.
   */
  TC.layout = function (ctx, str, opts) {
    opts = opts || {};
    const spans = KIT.text.tokenize(str == null ? '' : str);
    const lines = KIT.text.wrap(spans, {
      width: opts.width == null ? Infinity : opts.width,
      measure: TC.measurer(ctx, opts),
    });
    let chars = 0;
    for (const line of lines) for (const sp of line) if (sp.type === 'text') chars += Array.from(sp.text).length;
    const lineHeight = opts.lineHeight || Math.round((opts.size || 16) * 1.45);
    let width = 0;
    for (const line of lines) {
      let w = 0;
      for (const sp of line) {
        if (sp.type !== 'text') continue;
        ctx.font = fontFor(opts, sp);
        w += ctx.measureText(sp.text).width;
      }
      width = Math.max(width, w);
    }
    return { lines, width, height: lines.length * lineHeight, chars, lineHeight };
  };

  /**
   * draw(ctx, str, x, y, opts) -> the same measurements layout() returns.
   *
   * opts: { font, size, color, weight, width, lineHeight, align, time,
   *         reveal, shadow, baseline }
   *
   * `reveal` is how many characters to show — the typewriter, without owning a
   * clock. `time` drives the effects. A run with no effect is drawn whole in one
   * fillText; only an effected run pays for per-character positioning.
   */
  TC.draw = function (ctx, str, x, y, opts) {
    opts = opts || {};
    const m = TC.layout(ctx, str, opts);
    const time = opts.time || 0;
    const align = opts.align || 'left';
    const limit = opts.reveal == null ? Infinity : opts.reveal;
    let shown = 0;

    ctx.save();
    ctx.textBaseline = opts.baseline || 'top';
    ctx.textAlign = 'left';
    m.lines.forEach((line, li) => {
      let lineW = 0;
      if (align !== 'left') {
        for (const sp of line) {
          if (sp.type !== 'text') continue;
          ctx.font = fontFor(opts, sp);
          lineW += ctx.measureText(sp.text).width;
        }
      }
      let cx = x + (align === 'center' ? -lineW / 2 : align === 'right' ? -lineW : 0);
      const cy = y + li * m.lineHeight;

      for (const sp of line) {
        if (sp.type !== 'text' || shown >= limit) continue;
        const chars = Array.from(sp.text);
        const take = Math.min(chars.length, limit - shown);
        const text = chars.slice(0, take).join('');
        ctx.font = fontFor(opts, sp);
        const fill = colorFor(opts, sp);
        const voice = sp.voice ? voiceOf(sp.voice) : null;
        const fx = sp.fx || (voice && voice.fx) || null;
        const amount = sp.fxAmount != null ? sp.fxAmount : (voice && voice.fxAmount);

        if (!fx) {
          if (opts.shadow) { ctx.fillStyle = opts.shadow; ctx.fillText(text, cx + 1, cy + 1); }
          ctx.fillStyle = fill;
          ctx.fillText(text, cx, cy);
          cx += ctx.measureText(text).width;      // what was drawn, not what it would have been
        } else {
          // One character at a time, because each one is somewhere different.
          for (let i = 0; i < take; i++) {
            const ch = chars[i];
            const o = TC.offsetFor(fx, amount, shown + i, time);
            const prevAlpha = ctx.globalAlpha;
            if (o.alpha != null) ctx.globalAlpha = prevAlpha * o.alpha;
            if (opts.shadow) { ctx.fillStyle = opts.shadow; ctx.fillText(ch, cx + o.dx + 1, cy + o.dy + 1); }
            ctx.fillStyle = o.color || fill;
            ctx.fillText(ch, cx + o.dx, cy + o.dy);
            ctx.globalAlpha = prevAlpha;
            cx += ctx.measureText(ch).width;
          }
        }
        shown += take;
      }
    });
    ctx.restore();
    return m;
  };

  /**
   * writer(opts) -> a typewriter that owns its own progress but not its clock.
   *
   *   const w = KIT.textCanvas.writer({ width: 280, size: 16 });
   *   w.say('* Smells like a trash can.');
   *   // in the scene:  w.update(dt)      and   w.draw(ctx, x, y)
   *
   * `update` returns the characters revealed this tick, which is exactly what a
   * caller needs to play a blip per letter without re-deriving it.
   */
  TC.writer = function (opts) {
    const o = Object.assign({ speed: 30 }, opts || {});
    let text = '', revealed = 0, total = 0, acc = 0, clock = 0, measured = null;
    const api = {
      say(str, over) {
        text = str == null ? '' : String(str);
        revealed = 0; acc = 0; measured = null;
        if (over != null) o.speed = over;
        return api;
      },
      /** update(dt) -> the substring revealed by THIS tick ('' when nothing new). */
      update(dt) {
        clock += (dt || 0) * 1000;
        if (!text || revealed >= total) return '';
        acc += (dt || 0) * (o.speed || 30);
        const take = Math.floor(acc);
        if (take <= 0) return '';
        acc -= take;
        const from = revealed;
        revealed = Math.min(total, revealed + take);
        return KIT.text.strip(text).slice(from, revealed);
      },
      draw(ctx, x, y) {
        if (measured === null) { measured = TC.layout(ctx, text, o); total = measured.chars; }
        return TC.draw(ctx, text, x, y, Object.assign({}, o, { reveal: revealed, time: clock }));
      },
      /** width(px) — set the wrap width once the frame is known. Re-lays out. */
      width(px) { if (px && px !== o.width) { o.width = px; measured = null; } return api; },
      /** size(px) — and the type size, for a scene that scales with the window. */
      size(px) { if (px && px !== o.size) { o.size = px; o.lineHeight = null; measured = null; } return api; },
      /** lineHeight() — what a line actually costs, so a caller can reserve room for N of them. */
      lineHeight() { return o.lineHeight || Math.round((o.size || 16) * 1.45); },
      skip() { revealed = total; return api; },
      done() { return total > 0 ? revealed >= total : true; },
      revealed() { return revealed; },
      total() { return total; },
      time() { return clock; },
    };
    return api;
  };

  // The short names a scene actually types.
  KIT.drawText = TC.draw;
  KIT.textWriter = TC.writer;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
