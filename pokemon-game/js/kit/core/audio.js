// KIT.audio (§6.3, §8.5): a tiny chiptune synth. No files ship with the kit —
// every sound and every music track is a recipe played on WebAudio oscillators,
// so the whole game stays one page. A registry entry may still be
// `{ kind:'file', src }`; then an <audio> element plays it.
//
//   KIT.audio.unlock()                // from a real gesture: makes the context
//   KIT.audio.play('blip')
//   KIT.audio.music('town', { fade: 300 })
//   KIT.audio.jingle('heal')          // pauses the music, plays, resumes
//
// Sound recipe:  { kind:'synth', wave, gain, notes:[[freqOrNote, ms, delayMs?]…], slide }
// Music recipe:  { kind:'synth', tempo, wave, bassWave, lead:[steps], bass:[steps], drum:[steps], gain }
//   A step is a note name ('c4', 'f#3'), '-' (rest) or '~' (hold the last note).
// Nothing here throws when there is no AudioContext: every call becomes a no-op.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  const NOTES = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };
  /** freq('a4') -> 440. Numbers pass through. */
  function freq(note) {
    if (typeof note === 'number') return note;
    const m = /^([a-gA-G][#b]?)(-?\d)$/.exec(String(note || '').trim());
    if (!m) return 0;
    const semi = NOTES[m[1].toLowerCase()];
    if (semi == null) return 0;
    const octave = Number(m[2]);
    return 440 * Math.pow(2, (semi - 9) / 12 + (octave - 4));
  }

  let ctx = null;             // AudioContext (null until init() succeeds)
  let gestured = false;       // has the page been touched? No context before it has.
  let master = null, sfxBus = null, musicBus = null;
  let enabled = true, musicOn = true;
  let volumes = { master: 0.8, sound: 0.9, music: 0.5 };
  let current = null;         // { id, def, stopAt } the playing track
  let saved = null;           // saveMusic()/replayMusic()
  let schedTimer = null, schedStep = 0, schedTime = 0;
  let layerBus = {};          // layer name -> GainNode under musicBus
  let layerWant = {};         // layer name -> 0..1, what it should be
  let fileNodes = [];         // <audio> elements in flight
  let listener = null;        // { map, x, y } for playAt()

  const reg = (name) => (KIT.registry.exists(name) ? KIT.registry(name) : null);
  const defOf = (name, id) => { const r = reg(name); return r && id ? r.get(id) : null; };

  /**
   * init() — create the AudioContext, if we are allowed one yet.
   *
   * Browsers refuse to start an AudioContext before the page has been touched,
   * and Chrome says so in the console. The title screen asks for music before
   * anybody has touched anything, so the context is not made until the first
   * gesture: until then this returns null, calls become no-ops, and `current`
   * remembers what was wanted. unlock() makes the context and starts it.
   */
  function init() {
    if (ctx) return ctx;
    if (!gestured) return null;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      // An iPhone's hardware silent switch muted Web Audio — and ONLY Web Audio,
      // while <audio> and <video> kept playing — from the day the API shipped
      // until iOS 17. The fix is this one line, which most engines still do not
      // set, so a large share of iPhone players hear a silent game and assume it
      // has no sound. Declaring the session 'playback' says "this is the point
      // of the page", which is true of a game.
      try {
        const nav = root.navigator;
        if (nav && nav.audioSession) nav.audioSession.type = 'playback';
      } catch (e) { /* not supported here, and that is fine */ }
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = volumes.master; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = volumes.sound; sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = volumes.music; musicBus.connect(master);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }
  /**
   * unlock() — called from a real user gesture. Makes the context (see init),
   * resumes it if the browser suspended it, and starts whatever music was asked
   * for while we were still silent.
   */
  function unlock() {
    const first = !gestured;
    gestured = true;
    const c = init();
    if (!c) return Promise.resolve(false);
    const started = (ok) => {
      if (first && ok && current && current.id && current.def && current.def.kind !== 'file' && musicOn && enabled) {
        const want = current.id;
        current = null;                   // music() ignores a repeat of the same id
        music(want);
      }
      return ok;
    };
    if (c.state === 'suspended') { try { return c.resume().then(() => started(true), () => false); } catch (e) { return Promise.resolve(false); } }
    return Promise.resolve(started(true));
  }

  // ---- one-shot sounds ---------------------------------------------------------
  /** A single enveloped tone on the sfx bus. */
  function tone(opts) {
    if (!ctx) return;
    const at = opts.at == null ? ctx.currentTime : opts.at;
    const ms = Math.max(10, opts.ms || 120);
    const dur = ms / 1000;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, (opts.gain == null ? 0.3 : opts.gain));
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(opts.bus || sfxBus);
    if (opts.wave === 'noise') {
      const buf = noiseBuffer();
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = Math.max(120, opts.freq || 800); filter.Q.value = 1.2;
      src.connect(filter); filter.connect(g);
      src.start(at); src.stop(at + dur);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = opts.wave || 'square';
    osc.frequency.setValueAtTime(Math.max(20, opts.freq || 440), at);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), at + dur);
    osc.connect(g);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const n = ctx.sampleRate * 0.4;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function playFile(def, volume, loop) {
    try {
      const el = new Audio(def.src);
      el.volume = Math.max(0, Math.min(1, (volume == null ? 1 : volume) * volumes.master * (loop ? volumes.music : volumes.sound)));
      el.loop = !!loop;
      el.play().catch(() => {});
      fileNodes.push(el);
      if (fileNodes.length > 8) fileNodes = fileNodes.slice(-8);
      return el;
    } catch (e) { return null; }
  }

  /**
   * play(id, { volume, pitch, rate }) — a sound from the `sounds` registry.
   * Unknown ids are ignored.
   *
   * `pitch` multiplies every frequency and `rate` every duration, which is how
   * one blip becomes a cast of voices: the same three notes at 0.8 is a big
   * slow character and at 1.6 is a small fast one. This is the Animal Crossing
   * trick, and it costs one multiplication.
   */
  function play(id, opts) {
    if (!enabled || !id) return;
    const def = defOf('sounds', id);
    if (!def) return;
    if (def.kind === 'file') { playFile(def, (opts && opts.volume) || 1, false); return; }
    if (!init()) return;                     // no gesture yet, so nothing to play into
    const vol = (opts && opts.volume == null ? 1 : (opts && opts.volume)) || 1;
    const pitch = (opts && Number(opts.pitch)) > 0 ? Number(opts.pitch) : 1;
    const rate = (opts && Number(opts.rate)) > 0 ? Number(opts.rate) : 1;
    const base = (def.gain == null ? 0.3 : def.gain) * vol;
    const at0 = ctx.currentTime + 0.001;
    let cursor = 0;
    for (const note of def.notes || []) {
      const f = freq(note[0]) * pitch;
      const ms = (note[1] == null ? 90 : note[1]) / rate;
      const delay = (note[2] == null ? cursor : note[2]) / rate;
      tone({ freq: f, ms, at: at0 + delay / 1000, wave: def.wave || 'square', gain: base, slide: note[3] ? freq(note[3]) * pitch : (def.slide ? f * def.slide : 0) });
      cursor = delay + ms;
    }
  }

  /** playAt(id, { map, x, y }) — diegetic: quieter the further it is from the listener, silent on another map. */
  function playAt(id, where) {
    if (!where || !listener) return play(id);
    if (where.map && listener.map && where.map !== listener.map) return;
    const d = Math.hypot((where.x || 0) - (listener.x || 0), (where.y || 0) - (listener.y || 0));
    const vol = Math.max(0, 1 - d / 14);
    if (vol <= 0.02) return;
    return play(id, { volume: vol });
  }

  // ---- music -------------------------------------------------------------------
  function stopSchedule() {
    if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  }

  /**
   * A track's parts, as the scheduler wants them: the base one, then any named
   * layers the def declares.
   *
   *   { tempo: 120, lead: [...], bass: [...], drum: [...],
   *     layers: { rain: { lead: [...] }, danger: { bass: [...], drum: [...] } } }
   *
   * Vertical layering, which is what "adaptive music" mostly means in a 2D game:
   * the same piece, with parts arriving and leaving. The synth makes it nearly
   * free — a layer is another few oscillators on its own gain node, and turning
   * one on is a ramp on that node rather than a new piece of music.
   */
  const LAYER_MAX = 8;
  function partsOf(def) {
    const out = [{ name: '', part: def }];
    const layers = def && def.layers;
    if (layers) for (const name of Object.keys(layers).slice(0, LAYER_MAX)) {
      if (layers[name]) out.push({ name, part: layers[name] });
    }
    return out;
  }

  /** The gain node a layer plays through, made on demand and reused. */
  function busFor(name, def) {
    if (!name) return musicBus;
    if (layerBus[name]) return layerBus[name];
    const g = ctx.createGain();
    // A layer starts where it was left, or off — so entering a map with the
    // rain already on does not fade it in a second time.
    const want = layerWant[name];
    g.gain.value = want == null ? ((def && def.on) ? 1 : 0) : want;
    if (want == null) layerWant[name] = g.gain.value;
    g.connect(musicBus);
    layerBus[name] = g;
    return g;
  }

  function dropLayers() {
    for (const k of Object.keys(layerBus)) { try { layerBus[k].disconnect(); } catch (e) { /* ignore */ } }
    layerBus = {};
  }

  /** The scheduler: every 60 ms it books the next steps of the loop a little ahead of the clock. */
  function startSchedule(def) {
    stopSchedule();
    if (!init()) return;
    const tempo = def.tempo || 120;
    const stepDur = 30 / tempo;                       // an eighth note
    schedStep = 0;
    schedTime = ctx.currentTime + 0.08;

    // Every part is scheduled, on or off, all of them sharing one clock. A
    // silent layer costs a few oscillators and buys the thing that matters:
    // when it comes up it is already in the right bar, on the right beat,
    // rather than starting wherever the fade happened to be asked for.
    const parts = partsOf(def).map(({ name, part }) => ({
      name,
      bus: busFor(name, part),
      lead: part.lead || [], bass: part.bass || [], drum: part.drum || [],
      wave: part.wave || def.wave, bassWave: part.bassWave || def.bassWave,
      gain: part.gain == null ? (def.gain == null ? 0.22 : def.gain) : part.gain,
      lastLead: null,
    }));
    const length = Math.max(1, ...parts.map(p => Math.max(p.lead.length, p.bass.length, p.drum.length)));

    const bookPart = (p, i, when) => {
      const gain = p.gain;
      if (p.lead.length) {
        const l = p.lead[i % p.lead.length];
        if (l === '~' && p.lastLead) { /* hold: nothing new */ }
        else if (l && l !== '-') { p.lastLead = l; tone({ freq: freq(l), ms: stepDur * 1000 * 0.9, at: when, wave: p.wave || 'square', gain, bus: p.bus }); }
        else p.lastLead = null;
      }
      if (p.bass.length) {
        const b = p.bass[i % p.bass.length];
        if (b && b !== '-' && b !== '~') tone({ freq: freq(b), ms: stepDur * 1000 * 1.6, at: when, wave: p.bassWave || 'triangle', gain: gain * 0.9, bus: p.bus });
      }
      if (p.drum.length) {
        const d = p.drum[i % p.drum.length];
        if (d && d !== '-') tone({ freq: d === 'k' ? 90 : 1800, ms: d === 'k' ? 90 : 40, at: when, wave: d === 'k' ? 'sine' : 'noise', gain: gain * (d === 'k' ? 0.9 : 0.4), bus: p.bus });
      }
    };
    const pump = () => {
      if (!ctx || !current) return;
      const horizon = ctx.currentTime + 0.35;
      let guard = 0;
      while (schedTime < horizon && guard++ < 64) {
        for (const p of parts) bookPart(p, schedStep % length, schedTime);
        schedStep++;
        schedTime += stepDur;
      }
    };
    pump();
    schedTimer = setInterval(pump, 60);
  }

  /**
   * layer(name, on, ms) — bring a part of the playing track up or down.
   *
   * The piece does not restart, does not skip and does not go out of time,
   * because the layer has been playing silently the whole while. This is the
   * difference between music that reacts and music that gets interrupted.
   */
  function layer(name, on, ms) {
    const to = on === false ? 0 : (typeof on === 'number' ? Math.max(0, Math.min(1, on)) : 1);
    layerWant[name] = to;
    const bus = layerBus[name];
    if (!bus || !ctx) return Promise.resolve();
    const t = ctx.currentTime;
    const dur = Math.max(0.01, (ms == null ? 600 : ms) / 1000);
    try {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(to, t + dur);     // linear, not exponential: a layer may go to true zero
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  /** layers() -> { name: 0..1 } — what is up and what is down, for a save or a debug panel. */
  function layers() { return Object.assign({}, layerWant); }

  /**
   * layerGain(name) -> what the audio graph is ACTUALLY doing right now, which
   * is not the same as what was asked for while a fade is still running. The
   * debug panel shows this; the tests assert on it, because a bookkeeping object
   * agreeing with itself proves nothing.
   */
  function layerGain(name) {
    const bus = layerBus[name];
    return bus ? bus.gain.value : null;
  }

  /** layersOf(id) -> the names a track declares, so the editor can offer them. */
  function layersOf(id) {
    const def = defOf('music', id) || (current && current.id === id ? current.def : null);
    return def && def.layers ? Object.keys(def.layers).slice(0, LAYER_MAX) : [];
  }

  /** music(id|null, { fade, volume }) — start, swap or stop the track. Re-playing the same id does nothing. */
  function music(id, opts) {
    opts = opts || {};
    if (!musicOn || !enabled) { current = id ? { id, def: defOf('music', id) } : null; stopSchedule(); return Promise.resolve(); }
    if (id && current && current.id === id) return Promise.resolve();
    stopSchedule();
    dropLayers();          // the nodes belong to the old track; the wishes outlive it
    stopFiles(true);
    if (!id) { current = null; if (musicBus && ctx) fadeBus(musicBus, 0, opts.fade || 0, () => { musicBus.gain.value = volumes.music; }); return Promise.resolve(); }
    const def = defOf('music', id);
    current = { id, def };
    if (!def) return Promise.resolve();
    if (def.kind === 'file') { current.el = playFile(def, opts.volume, true); return Promise.resolve(); }
    if (!init()) return Promise.resolve();   // no gesture yet; `current` holds the wish, unlock() plays it
    musicBus.gain.value = volumes.music * (opts.volume == null ? 1 : opts.volume);
    if (opts.fade) {
      musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
      musicBus.gain.exponentialRampToValueAtTime(Math.max(0.0001, volumes.music), ctx.currentTime + opts.fade / 1000);
    }
    startSchedule(def);
    return Promise.resolve();
  }
  function fadeBus(bus, to, ms, done) {
    if (!ctx) { if (done) done(); return; }
    try {
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), t);
      bus.gain.exponentialRampToValueAtTime(Math.max(0.0001, to), t + Math.max(0.01, (ms || 0) / 1000));
    } catch (e) { /* ignore */ }
    if (done) setTimeout(done, (ms || 0) + 20);
  }
  function stopFiles(musicOnly) {
    for (const el of fileNodes.slice()) {
      if (musicOnly && !el.loop) continue;
      try { el.pause(); } catch (e) { /* ignore */ }
    }
    fileNodes = fileNodes.filter(el => !el.paused);
  }

  /** stop('sound'|'music'|'all') */
  function stop(what) {
    const w = what || 'all';
    if (w === 'music' || w === 'all') { stopSchedule(); dropLayers(); current = null; stopFiles(true); }
    if (w === 'sound' || w === 'all') stopFiles(false);
    return Promise.resolve();
  }

  /** jingle(id) — pause the music, play a short fanfare from `music` (or `sounds`), then resume. */
  function jingle(id) {
    const def = defOf('music', id) || defOf('sounds', id);
    if (!def) return Promise.resolve();
    const before = current;
    stopSchedule();
    current = null;
    const notes = def.notes || (def.lead || []).map(n => [n, 160]);
    if (init() && enabled) {
      const at0 = ctx.currentTime + 0.01;
      let cursor = 0;
      for (const n of notes) {
        const ms = n[1] == null ? 160 : n[1];
        tone({ freq: freq(n[0]), ms, at: at0 + cursor / 1000, wave: def.wave || 'square', gain: (def.gain == null ? 0.3 : def.gain), bus: musicBus });
        cursor += ms;
      }
      return new Promise(res => setTimeout(() => { if (before) music(before.id); res(); }, cursor + 120));
    }
    if (before) music(before.id);
    return Promise.resolve();
  }

  const AUDIO = KIT.audio = {
    freq, init, unlock,
    play, playAt, music, stop, jingle,
    layer, layers, layersOf, layerGain,
    /** save()/replay() — the saveMusic/replayMusic commands. */
    save() { saved = current ? current.id : null; return Promise.resolve(); },
    replay() { return music(saved); },
    current() { return current ? current.id : null; },
    /** setListener({ map, x, y }) — where playAt() measures distance from (the active hero). */
    setListener(where) { listener = where; },
    setVolume(kind, v) {
      const val = Math.max(0, Math.min(1, Number(v) || 0));
      if (kind === 'sound' || kind === 'music' || kind === 'master') volumes[kind] = val;
      if (!ctx) return volumes;
      if (master) master.gain.value = volumes.master;
      if (sfxBus) sfxBus.gain.value = volumes.sound;
      if (musicBus) musicBus.gain.value = volumes.music;
      return volumes;
    },
    volumes() { return Object.assign({}, volumes); },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) stop('all');
      else if (musicOn && current) music(current.id);
      return enabled;
    },
    setMusic(on) {
      musicOn = !!on;
      if (!musicOn) { const id = current && current.id; stopSchedule(); stopFiles(true); current = id ? { id, def: defOf('music', id) } : null; }
      else if (current) { const id = current.id; current = null; music(id); }
      return musicOn;
    },
    isEnabled() { return enabled; },
    isMusic() { return musicOn; },
    context() { return ctx; },
  };

  // ---- the standard sounds and tracks ------------------------------------------
  // Registered here so a project always has something to play; a module or the
  // author can replace any id with their own recipe (or a file).
  if (KIT.registry && KIT.registry.exists('sounds')) {
    KIT.registry('sounds').addAll([
      { id: 'blip', name: 'Blip', group: 'ui', kind: 'synth', wave: 'square', gain: 0.18, notes: [['c5', 40]] },
      { id: 'select', name: 'Select', group: 'ui', kind: 'synth', wave: 'square', gain: 0.22, notes: [['e5', 45], ['a5', 70]] },
      { id: 'back', name: 'Back', group: 'ui', kind: 'synth', wave: 'square', gain: 0.2, notes: [['a4', 50], ['e4', 70]] },
      { id: 'bump', name: 'Bump', group: 'world', kind: 'synth', wave: 'triangle', gain: 0.22, notes: [['e3', 70]] },
      { id: 'door', name: 'Door', group: 'world', kind: 'synth', wave: 'triangle', gain: 0.25, notes: [['g3', 70], ['c4', 90]] },
      { id: 'item', name: 'Item', group: 'world', kind: 'synth', wave: 'square', gain: 0.24, notes: [['c5', 60], ['e5', 60], ['g5', 110]] },
      { id: 'sparkle', name: 'Sparkle', group: 'world', kind: 'synth', wave: 'sine', gain: 0.2, notes: [['e6', 50], ['a6', 50], ['c7', 90]] },
      { id: 'heal', name: 'Heal', group: 'world', kind: 'synth', wave: 'sine', gain: 0.22, notes: [['c5', 90], ['e5', 90], ['g5', 90], ['c6', 160]] },
      { id: 'save', name: 'Save', group: 'ui', kind: 'synth', wave: 'square', gain: 0.22, notes: [['g4', 70], ['c5', 70], ['e5', 120]] },
      { id: 'notify', name: 'Notify', group: 'ui', kind: 'synth', wave: 'square', gain: 0.2, notes: [['a5', 60], ['f5', 90]] },
      { id: 'hop', name: 'Hop', group: 'world', kind: 'synth', wave: 'triangle', gain: 0.22, notes: [['c4', 60, 0, 'g4']] },
    ]);
  }
  if (KIT.registry && KIT.registry.exists('music')) {
    KIT.registry('music').addAll([
      { id: 'title', name: 'Title', kind: 'synth', tempo: 96, wave: 'triangle', gain: 0.2,
        lead: ['c5', '~', 'e5', '~', 'g5', '~', 'e5', '~', 'f5', '~', 'a5', '~', 'g5', '~', '~', '-'],
        bass: ['c3', '-', '-', '-', 'g2', '-', '-', '-', 'f2', '-', '-', '-', 'g2', '-', '-', '-'] },
      { id: 'town', name: 'Town', kind: 'synth', tempo: 132, wave: 'square', gain: 0.18,
        lead: ['f4', 'a4', 'c5', 'a4', 'g4', 'bb4', 'd5', 'bb4', 'a4', 'c5', 'f5', 'c5', 'g4', 'e4', 'f4', '-'],
        bass: ['f2', '-', 'c3', '-', 'g2', '-', 'd3', '-', 'a2', '-', 'f2', '-', 'c3', '-', 'f2', '-'],
        drum: ['k', '-', 'h', '-', 'k', '-', 'h', '-', 'k', '-', 'h', '-', 'k', '-', 'h', 'h'] },
      { id: 'route', name: 'Route', kind: 'synth', tempo: 148, wave: 'square', gain: 0.17,
        lead: ['g4', 'b4', 'd5', 'b4', 'c5', 'e5', 'g5', 'e5', 'd5', 'b4', 'g4', 'b4', 'a4', 'd5', 'b4', '-'],
        bass: ['g2', '-', 'd3', '-', 'c3', '-', 'g2', '-', 'd3', '-', 'g2', '-', 'a2', '-', 'd3', '-'],
        drum: ['k', 'h', 'h', '-', 'k', 'h', 'h', '-', 'k', 'h', 'h', '-', 'k', 'h', 'k', 'h'] },
      { id: 'house', name: 'House', kind: 'synth', tempo: 88, wave: 'triangle', gain: 0.18,
        lead: ['c5', '~', 'a4', '~', 'f4', '~', 'g4', '~', 'a4', '~', 'c5', '~', 'g4', '~', '~', '-'],
        bass: ['f2', '-', '-', '-', 'c3', '-', '-', '-', 'f2', '-', '-', '-', 'g2', '-', '-', '-'] },
      { id: 'cave', name: 'Cave', kind: 'synth', tempo: 76, wave: 'sine', gain: 0.2,
        lead: ['a4', '~', '~', 'c5', '~', '~', 'b4', '~', 'g4', '~', '~', 'e4', '~', '~', '~', '-'],
        bass: ['a2', '-', '-', '-', 'e2', '-', '-', '-', 'f2', '-', '-', '-', 'e2', '-', '-', '-'] },
      { id: 'garden', name: 'Garden', kind: 'synth', tempo: 104, wave: 'sine', gain: 0.18,
        lead: ['d5', '~', 'f#5', '~', 'a5', '~', 'f#5', '~', 'e5', '~', 'g5', '~', 'd5', '~', '~', '-'],
        bass: ['d3', '-', '-', 'a2', '-', '-', 'b2', '-', '-', 'g2', '-', '-', 'd3', '-', '-', '-'] },
    ]);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
