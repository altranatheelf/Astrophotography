// Languages: one lookup in front of the text pipeline, one walk over the
// project to find everything a player reads, and one plain-text file a
// translator can actually open.
//
// The key IS the English. Not an id, not a path — the line itself.
//
// That choice is the whole design. An id-keyed table (`msg_pier_014`) means
// every line has a name somebody has to invent, keep unique, and keep attached
// to the line when it moves; rename a map and half of them are wrong. Keying on
// the text means a line can move anywhere in the project and keep its
// translation, two places that say "You can't go that way." share one
// translation for free, and editing the English *correctly* orphans the old
// translation, which is what should happen — the line changed, so the Japanese
// is now a lie. gettext worked this out in 1995 and everyone who ignored it
// rebuilt it badly.
//
// What this is NOT: a runtime that swaps fonts, mirrors the UI for Arabic, or
// picks plurals. Those are real and they are not here yet. What is here is the
// part that has to exist first and is agony to retrofit: every string a player
// can see is findable, addressable and replaceable, and nothing in the engine
// concatenates a sentence out of pieces.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const L = KIT.lang = KIT.lang || {};
  const has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);

  // ---- state -----------------------------------------------------------------

  let current = 'en';                 // the language being played
  let table = null;                   // { source: translation } for `current`, or null for the original
  let project = null;                 // where translations are read from
  const misses = new Map();           // source -> how many times it was asked for and not found

  /**
   * The source language is a PROPERTY OF THE PROJECT, not a constant. A game
   * written in Japanese keys its lines on Japanese and carries an `en` pack;
   * nothing here privileges English except the default.
   */
  L.source = () => (project && project.settings && project.settings.language) || 'en';
  L.SOURCE = 'en';                    // the default for a project that says nothing

  /**
   * bind(project, want) — point the lookup at a project and pick a language.
   * `want` is the player's saved choice; without one the game plays in the
   * language it was written in.
   */
  L.bind = function (p, want) {
    project = p || null;
    L.use(want || L.source());
    return L;
  };

  /** known() -> every language this project can be played in, the one it was written in first. */
  L.known = function () {
    const src = L.source();
    const out = [src];
    const langs = (project && project.languages) || {};
    for (const code of Object.keys(langs).sort()) if (code !== src) out.push(code);
    return out;
  };

  /** nameOf(code) -> what to call it in a menu ('日本語'), falling back to the code. */
  L.nameOf = function (code) {
    if (code === L.source()) return (project && project.settings && project.settings.languageName) || code;
    const d = project && project.languages && project.languages[code];
    return (d && d.name) || code;
  };

  /**
   * use(code) — switch language. An unknown code falls back to the source
   * rather than throwing, because this is reachable from a menu and from a
   * device setting written by a build that had a language this one does not.
   */
  L.use = function (code) {
    const langs = (project && project.languages) || {};
    const src = L.source();
    if (code && code !== src && langs[code]) {
      current = code;
      table = langs[code].lines || {};
    } else {
      current = src;
      table = null;
    }
    misses.clear();
    if (KIT.events) KIT.events('kit').emit('languageChanged', { language: current });
    return current;
  };

  /**
   * guess(prefer) -> the best language this project has for somebody whose
   * browser asks for `prefer` (navigator.languages). Matched on the primary
   * subtag, so a pt-BR browser finds a `pt` translation and an en-GB one finds
   * `en`. Falls back to the language the game was written in, which is always
   * a language the game definitely has.
   */
  L.guess = function (prefer) {
    const have = L.known();
    const want = Array.isArray(prefer) ? prefer : (prefer ? [prefer] : []);
    const base = (c) => String(c || '').toLowerCase().split(/[-_]/)[0];
    for (const w of want) {
      const exact = have.find((h) => h.toLowerCase() === String(w).toLowerCase());
      if (exact) return exact;
      const near = have.find((h) => base(h) === base(w));
      if (near) return near;
    }
    return L.source();
  };

  L.current = () => current;
  /** translating() — false when the game is being played in the language it was written in. */
  L.translating = () => table !== null;

  /**
   * t(text) — the lookup. Untranslated text comes back unchanged and is
   * remembered, so `missing()` is a real QA list rather than a guess.
   *
   * Deliberately NOT trimmed or normalised: a translator gets the line exactly
   * as the writer typed it, trailing space and all, because in a typewriter box
   * that trailing space is a beat.
   */
  L.t = function (text) {
    if (table === null || typeof text !== 'string' || !text) return text;
    if (has(table, text)) {
      const v = table[text];
      if (typeof v === 'string' && v !== '') return v;
    }
    misses.set(text, (misses.get(text) || 0) + 1);
    return text;
  };

  /** missing() -> [{ text, asked }] — what this session wanted and did not have, most-wanted first. */
  L.missing = function () {
    return Array.from(misses, ([text, asked]) => ({ text, asked })).sort((a, b) => b.asked - a.asked);
  };

  // ---- finding every string a player can read --------------------------------
  //
  // Field-driven, like everything else here. A field is something a player reads
  // when it is `type: 'text'` (prose, by definition) or when it is marked
  // `shown: true` (a short string that happens to be player-facing: a speaker's
  // name, a choice option). `type: 'note'` never is — that is the author talking
  // to themselves. Nothing has a list of commands to keep up to date, so a module
  // that adds a command gets its lines extracted on the day it is written.

  /** shown(field) -> is this field something a player reads? */
  L.shown = function (f) {
    if (!f || f.translate === false) return false;
    if (f.type === 'text') return true;
    return f.type === 'string' && f.shown === true;
  };

  function place(where) {
    if (!where) return '';
    if (where.script) return `script ${where.script}`;
    const bits = [];
    if (where.map) bits.push(where.map);
    if (where.object) bits.push(where.object);
    if (where.page != null) bits.push(`page ${where.page + 1}`);
    if (where.slot) bits.push(where.slot);
    return bits.join(' · ');
  }

  /**
   * extract(project) -> [{ text, where: string[] }] in the order a player would
   * first meet them, deduplicated, with every place each line appears. The
   * `where` list is what makes a translation file translatable: "Yes." is
   * unanswerable on its own and obvious under `pier · mira · talk`.
   */
  L.extract = function (p) {
    const P = KIT.project;
    const found = new Map();
    const note = (text, where) => {
      if (typeof text !== 'string') return;
      const s = text.trim() === '' ? '' : text;
      if (!s) return;
      let e = found.get(s);
      if (!e) found.set(s, (e = { text: s, where: [] }));
      if (where && e.where.length < 8 && !e.where.includes(where)) e.where.push(where);
    };

    // 1. every command, through its own field declarations
    if (P && P.walkCommands) {
      const reg = KIT.registry('commands');
      P.walkCommands(p, (cmd, where) => {
        const def = cmd && reg.get(cmd.t);
        if (!def) return;
        const at = place(where);
        KIT.schema.walk(def.fields || [], cmd, (f, v) => { if (L.shown(f)) note(v, at); });
      });
    }

    // 2. the project's own tables, through theirs
    const F = (P && P.fields) || {};
    const rowsOf = (box, fields, label) => {
      if (!fields || !box) return;
      const rows = Array.isArray(box) ? box.map((v, i) => [(v && v.id) || String(i + 1), v]) : Object.entries(box);
      for (const [id, row] of rows) {
        KIT.schema.walk(fields, row, (f, v) => { if (L.shown(f)) note(v, `${label} · ${id}`); });
      }
    };
    rowsOf(p && p.items, F.item, 'item');
    rowsOf(p && p.heroes, F.hero, 'hero');
    rowsOf(p && p.maps, F.map, 'map');
    rowsOf(p && p.cast, F.person, 'cast');
    if (p && p.meta && F.meta) KIT.schema.walk(F.meta, p.meta, (f, v) => { if (L.shown(f)) note(v, 'the game itself'); });

    // 3. the Terms table: the words the engine itself says
    if (KIT.strings && KIT.strings.defaults) {
      const defs = KIT.strings.defaults();
      const over = (p && p.strings) || {};
      for (const key of Object.keys(defs)) note(has(over, key) ? over[key] : defs[key], `terms · ${key}`);
      for (const key of Object.keys(over)) if (!has(defs, key)) note(over[key], `terms · ${key}`);
    }

    return Array.from(found.values());
  };

  // ---- the file a translator opens -------------------------------------------
  //
  //   # pier · mira · talk
  //   > Hello, traveller.
  //   < こんにちは、旅人よ。
  //
  // `>` is what the game says now, `<` is your version, `#` is a note. A blank
  // `<` means "leave it in English", which is a legitimate answer and how the
  // file starts. Multi-line strings get one `>` per line and one `<` per line.
  //
  // Not JSON, not XLIFF, not .po. JSON because a translator should not be able
  // to break the file with a quotation mark, and because a merge conflict in a
  // JSON blob is unreadable. XLIFF because nobody who is not paid to has ever
  // opened one. .po because it is nearly this, and worse to read on a phone.

  const OUT = (s) => String(s).split('\n').map((l) => (l === '' ? '>' : '> ' + l)).join('\n');
  const IN = (s) => String(s).split('\n').map((l) => (l === '' ? '<' : '< ' + l)).join('\n');

  /**
   * toText(project, code) -> the translation file for one language, with every
   * line the project currently contains, already-translated ones filled in.
   * Lines that have vanished from the project are kept at the bottom under a
   * notice, because a translator who reworded a sentence should not silently
   * lose an hour of work to a typo fix.
   */
  L.toText = function (p, code) {
    const lines = L.extract(p);
    const existing = (p && p.languages && p.languages[code] && p.languages[code].lines) || {};
    const name = (p && p.languages && p.languages[code] && p.languages[code].name) || code;
    const done = lines.filter((l) => existing[l.text]).length;
    const live = new Set(lines.map((l) => l.text));
    const orphans = Object.keys(existing).filter((k) => !live.has(k) && existing[k]);

    const out = [
      `# ${(p && p.meta && p.meta.title) || 'A game'} — ${name} (${code})`,
      `# ${done} of ${lines.length} lines translated.`,
      '#',
      '# `>` is what the game says now. Put your version on the `<` line under it.',
      '# Leave a `<` line empty and the game keeps the original.',
      '# Lines starting with `#` are notes to you and are ignored.',
      '#',
      '# Keep anything in {curly braces} exactly as it is — {p1} is the player\'s',
      '# name, {color:red} turns the text red, {pause} is a beat. You can move',
      '# them around inside the sentence; just do not translate them.',
      '',
    ];
    for (const l of lines) {
      if (l.where.length) out.push('# ' + l.where.join('  ·  '));
      out.push(OUT(l.text));
      out.push(IN(existing[l.text] || ''));
      out.push('');
    }
    if (orphans.length) {
      out.push('# ' + '-'.repeat(60));
      out.push(`# ${orphans.length} translation(s) below are for lines the game no longer has.`);
      out.push('# Kept in case a line was only reworded. Delete them when you are sure.');
      out.push('');
      for (const k of orphans) { out.push(OUT(k)); out.push(IN(existing[k])); out.push(''); }
    }
    return out.join('\n');
  };

  /**
   * fromText(text) -> { lines, problems }. Forgiving on purpose: a translator
   * working in a phone notes app will lose a `<`, and losing their afternoon to
   * a parse error is not an acceptable answer. Anything unreadable becomes a
   * problem with a line number and the rest of the file still loads.
   */
  L.fromText = function (text) {
    const lines = {};
    const problems = [];
    const rows = String(text || '').split(/\r?\n/);
    let src = null, dst = null, srcAt = 0;
    const commit = () => {
      if (src === null) return;
      const s = src.join('\n');
      if (s !== '') {
        if (has(lines, s)) problems.push({ line: srcAt, message: `this line appears twice; the later one wins`, text: s });
        lines[s] = dst === null ? '' : dst.join('\n');
      }
      src = dst = null;
    };
    rows.forEach((row, i) => {
      const at = i + 1;
      if (/^\s*#/.test(row)) return;                     // a note
      if (row === '>' || row.startsWith('> ')) {
        if (dst !== null) commit();                      // a new pair starts
        if (src === null) { src = []; srcAt = at; }
        src.push(row === '>' ? '' : row.slice(2));
        return;
      }
      if (row === '<' || row.startsWith('< ')) {
        if (src === null) { problems.push({ line: at, message: 'a `<` with no `>` above it — skipped' }); return; }
        if (dst === null) dst = [];
        dst.push(row === '<' ? '' : row.slice(2));
        return;
      }
      if (row.trim() === '') { commit(); return; }
      problems.push({ line: at, message: 'not a `>` line, a `<` line or a `#` note — skipped', text: row });
    });
    commit();
    return { lines, problems };
  };

  /**
   * put(project, code, { name, lines }) — install a language. Returns what it
   * did, because the editor says it out loud ("412 lines, 8 still in English").
   */
  L.put = function (p, code, pack) {
    if (!p || !code) return { added: 0, blank: 0 };
    p.languages = p.languages || {};
    const lines = (pack && pack.lines) || {};
    const filled = Object.keys(lines).filter((k) => lines[k]);
    p.languages[code] = {
      name: (pack && pack.name) || (p.languages[code] && p.languages[code].name) || code,
      lines,
    };
    if (p === project && code === current) table = p.languages[code].lines;
    return { added: filled.length, blank: Object.keys(lines).length - filled.length };
  };

  /** coverage(project, code) -> { total, translated, missing[] } for the editor and for a build check. */
  L.coverage = function (p, code) {
    const all = L.extract(p);
    const lines = (p && p.languages && p.languages[code] && p.languages[code].lines) || {};
    const missing = all.filter((l) => !lines[l.text]);
    return { total: all.length, translated: all.length - missing.length, missing };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
