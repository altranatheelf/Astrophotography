// Screenplay: the plain-text view of a script (§9.5). Lossless by
// construction — the JSON command list is the truth, this is a rendering of
// it that parses back to the same list. Anything that cannot be parsed becomes
// { t:'raw', line } (never dropped) and is reported as a problem.
//
//   KIT.screenplay.serialize(commands) -> text
//   KIT.screenplay.parse(text) -> { commands, problems:[{ line, message, raw }] }
//   KIT.screenplay.serializeDocument(sections) / parseDocument(text)   (":: id [tags] when: …" sections)
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const CMD = KIT.commands;
  const C = KIT.conditions;
  const V = KIT.script.values;
  const reg = KIT.registry('commands');
  const SP = KIT.screenplay = KIT.screenplay || {};

  SP.INDENT = '    ';
  const pad = (level) => SP.INDENT.repeat(level);
  const OPTION = /^-(?: |$)/;
  const isEnd = (s) => s === '@end';
  const isElse = (s) => s === '@else';

  /** How a command lays out its nested lists: 'if' | 'choice' | { body: key } | 'inline' | null */
  SP.layout = function (cmd) {
    if (!KIT.isObject(cmd)) return null;
    if (cmd.t === 'if') return 'if';
    if (cmd.t === 'choice') return 'choice';
    const def = reg.get(cmd.t);
    if (!def) return null;
    const blocks = CMD.blockFields(def);
    if (!blocks.length) return null;
    const fields = KIT.schema.fields(def.fields || []);
    if (blocks.length === 1) {
      const f = fields.find(x => x.key === blocks[0]);
      if (f && f.type === 'script' && def.text && def.text.endLine) return { body: f.key };
    }
    return 'inline';
  };

  // ---- serialize ---------------------------------------------------------------
  function commandLine(cmd) {
    const layout = SP.layout(cmd);
    if (layout === 'inline') {
      // Generic form plus the nested lists as JSON pairs (keysFor skips block fields).
      const def = reg.get(cmd.t);
      const blocks = CMD.blockFields(def);
      const base = CMD.genericToLine(cmd);
      const pairs = blocks.filter(k => cmd[k] !== undefined).map(k => `${k}=${JSON.stringify(cmd[k])}`);
      return pairs.length ? `${base} ${pairs.join(' ')}` : base;
    }
    return CMD.toLine(cmd);
  }
  function writeList(cmds, level, out) {
    for (const cmd of cmds || []) {
      if (!KIT.isObject(cmd)) { out.push(pad(level) + JSON.stringify(cmd)); continue; }
      if (cmd.t === 'raw') { out.push(pad(level) + String(cmd.line == null ? '' : cmd.line).replace(/\r?\n/g, ' ')); continue; }
      const layout = SP.layout(cmd);
      out.push(pad(level) + commandLine(cmd));
      if (layout === 'if') {
        writeList(cmd.then, level + 1, out);
        if (Array.isArray(cmd.else) && cmd.else.length) { out.push(pad(level) + '@else'); writeList(cmd.else, level + 1, out); }
        out.push(pad(level) + '@end');
      } else if (layout === 'choice') {
        for (const opt of cmd.options || []) {
          out.push(pad(level) + CMD.option.toLine(opt));
          writeList(opt.then, level + 1, out);
        }
      } else if (layout && layout.body) {
        writeList(cmd[layout.body], level + 1, out);
        out.push(pad(level) + '@end');
      }
    }
  }
  /** serialize(commands, level=0) -> canonical text (no trailing newline). */
  SP.serialize = function (cmds, level) {
    const out = [];
    writeList(cmds || [], level || 0, out);
    return out.join('\n');
  };

  // ---- parse --------------------------------------------------------------------
  function indentOf(raw) {
    let n = 0;
    for (const ch of raw) { if (ch === ' ') n++; else if (ch === '\t') n += 4; else break; }
    return n;
  }
  /** parse(text) -> { commands, problems } */
  SP.parse = function (text) {
    const problems = [];
    const items = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((raw, i) => {
      const body = raw.trim();
      if (!body) return;
      const spaces = indentOf(raw);
      if (spaces % 4 !== 0) problems.push({ line: i + 1, message: 'indentation should be a multiple of 4 spaces', raw });
      items.push({ n: i + 1, raw, body, level: Math.floor(spaces / 4) });
    });
    let pos = 0;
    const peek = () => items[pos];
    const problem = (it, message) => problems.push({ line: it.n, message, raw: it.raw });
    const rawCmd = (it) => ({ t: 'raw', line: it.body });
    const atLevel = (level, pred) => { const it = peek(); return !!it && it.level === level && pred(it.body); };

    function parseList(level) {
      const cmds = [];
      while (pos < items.length) {
        const it = peek();
        if (it.level < level) break;
        if (it.level > level) { problem(it, 'unexpected indentation'); cmds.push(rawCmd(it)); pos++; continue; }
        if (isEnd(it.body) || isElse(it.body)) { problem(it, `stray ${it.body}`); cmds.push(rawCmd(it)); pos++; continue; }
        if (OPTION.test(it.body)) { problem(it, 'a choice option (- …) outside a choice'); cmds.push(rawCmd(it)); pos++; continue; }
        let cmd = null;
        try { cmd = CMD.fromLine(it.body); } catch (e) { cmd = null; problem(it, e && e.message ? e.message : 'could not read this line'); }
        if (!cmd) { if (!problems.some(p => p.line === it.n)) problem(it, 'could not read this line'); cmds.push(rawCmd(it)); pos++; continue; }
        pos++;
        const layout = SP.layout(cmd);
        if (layout === 'if') {
          cmd.then = parseList(level + 1);
          if (atLevel(level, isElse)) { pos++; cmd.else = parseList(level + 1); }
          else cmd.else = Array.isArray(cmd.else) ? cmd.else : [];
          if (atLevel(level, isEnd)) pos++; else problem(it, `missing @end for the @if on line ${it.n}`);
        } else if (layout === 'choice') {
          cmd.options = [];
          while (atLevel(level, (b) => OPTION.test(b))) {
            const optItem = peek();
            let opt = null;
            try { opt = CMD.option.fromLine(optItem.body); } catch (e) { problem(optItem, e && e.message ? e.message : 'bad option'); }
            pos++;
            if (!opt) { opt = { text: optItem.body.replace(OPTION, ''), when: null, then: [] }; }
            opt.then = parseList(level + 1);
            cmd.options.push(opt);
          }
          if (!cmd.options.length) problem(it, 'a choice needs at least one - option');
        } else if (layout && layout.body) {
          cmd[layout.body] = parseList(level + 1);
          if (atLevel(level, isEnd)) pos++; else problem(it, `missing @end for @${cmd.t} on line ${it.n}`);
        }
        cmds.push(CMD.normalize(cmd));
      }
      return cmds;
    }
    const commands = parseList(0);
    return { commands, problems };
  };

  // ---- documents (many scripts in one text) ---------------------------------------
  const HEADER = /^::\s+(\S+)(?:\s+\[([^\]]*)\])?(?:\s+when:\s*(.*?))?\s*$/;
  const TRIGGERS = ['call', 'auto', 'parallel'];
  /** section: { id, trigger:'call'|'auto'|'parallel', tags:[], when:Condition|null, commands } */
  SP.serializeDocument = function (sections) {
    return (sections || []).map(sec => {
      const tags = [];
      if (sec.trigger && sec.trigger !== 'call') tags.push(sec.trigger);
      for (const t of sec.tags || []) if (!tags.includes(t)) tags.push(t);
      let head = `:: ${sec.id}`;
      if (tags.length) head += ` [${tags.join(' ')}]`;
      if (sec.when) head += ` when: ${C.toText(sec.when)}`;
      const body = SP.serialize(sec.commands || []);
      return body ? `${head}\n${body}` : head;
    }).join('\n\n');
  };
  /** parseDocument(text) -> { sections:[{ id, trigger, tags, when, commands, line }], problems } (lines before the first header go to a section with id null when non-empty). */
  SP.parseDocument = function (text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const problems = [];
    const sections = [];
    let cur = { id: null, trigger: 'call', tags: [], when: null, lines: [], line: 1 };
    lines.forEach((raw, i) => {
      const m = HEADER.exec(raw);
      if (m) {
        if (cur.id !== null || cur.lines.some(l => l.trim())) sections.push(cur);
        const tags = (m[2] || '').split(/\s+/).filter(Boolean);
        const trigger = tags.find(t => TRIGGERS.includes(t)) || 'call';
        let when = null;
        if (m[3] != null && m[3] !== '') {
          try { when = C.parseText(m[3]); } catch (e) { problems.push({ line: i + 1, message: `bad when: ${e.message}`, raw }); }
        }
        cur = { id: m[1], trigger, tags: tags.filter(t => !TRIGGERS.includes(t)), when, lines: [], line: i + 1 };
      } else cur.lines.push(raw);
    });
    if (cur.id !== null || cur.lines.some(l => l.trim())) sections.push(cur);
    for (const sec of sections) {
      const r = SP.parse(sec.lines.join('\n'));
      sec.commands = r.commands;
      for (const p of r.problems) problems.push({ line: p.line + sec.line, message: p.message, raw: p.raw, section: sec.id });
      delete sec.lines;
    }
    return { sections, problems };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
