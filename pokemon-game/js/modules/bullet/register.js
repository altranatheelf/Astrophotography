// The live half: the art, the scene, the command that starts a fight.
//
// Everything here is written against the engine's PUBLIC API only. What that
// cost (the one thing js/kit grew for it, a scene that draws, and the one thing
// still done by hand, world.busy) is in README.md, "What it cost".
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const B = KIT.bullet = KIT.bullet || {};
  const num = KIT.num;
  const T = () => KIT.text;

  let registered = false;
  B.registerAll = function () {
    if (registered) return;
    registered = true;

    // --- art -------------------------------------------------------------------
    const tiles = KIT.registry('tiles');
    tiles.addAll([
      { id: 'bullet', name: 'Bullet', group: 'bullet', palette: { w: '#ffffff', k: '#c0c8d8' },
        rows: ['................', '................', '................', '................',
               '.....kkkkkk.....', '....kwwwwwwk....', '...kwwwwwwwwk...', '...kwwwwwwwwk...',
               '...kwwwwwwwwk...', '...kwwwwwwwwk...', '....kwwwwwwk....', '.....kkkkkk.....',
               '................', '................', '................', '................'] },
      { id: 'bullet-bone', name: 'Bone', group: 'bullet', palette: { w: '#ffffff', k: '#b8bece' },
        rows: ['................', '................', '..kwk......kwk..', '..wwww....wwww..',
               '..kwwwwwwwwwwk..', '...wwwwwwwwww...', '...wwwwwwwwww...', '..kwwwwwwwwwwk..',
               '..wwww....wwww..', '..kwk......kwk..', '................', '................',
               '................', '................', '................', '................'] },
      { id: 'soul', name: 'Soul', group: 'bullet', palette: { r: '#ff2d55', d: '#a01030' },
        rows: ['................', '................', '...dd......dd...', '..drrd....drrd..',
               '.drrrrd..drrrrd.', '.drrrrrddrrrrrd.', '.drrrrrrrrrrrrd.', '..drrrrrrrrrrd..',
               '...drrrrrrrrd...', '....drrrrrrd....', '.....drrrrd.....', '......drrd......',
               '.......dd.......', '................', '................', '................'] },
      { id: 'arena', name: 'Arena edge', group: 'bullet', palette: { w: '#ffffff' },
        rows: Array.from({ length: 16 }, (_, y) => (y === 0 || y === 15 ? 'wwwwwwwwwwwwwwww' : 'w..............w')) },
    ]);

    // --- the scene ---------------------------------------------------------------
    KIT.registry('scenes').add({ id: 'bullet-fight', name: 'A fight', create: fightScene });

    // --- the command that starts one ---------------------------------------------
    KIT.registry('commands').add({
      id: 'fight', label: 'Bullet Fight', group: 'Battle', icon: 'npc', blocking: true,
      doc: 'A real-time bullet pattern the player dodges. Returns when they survive it or run out of heart.',
      fields: [
        { key: 'pattern', type: 'enum', options: ['rain', 'sweep', 'hunt', 'ring'], default: 'rain' },
        { key: 'count', type: 'number', integer: true, min: 1, max: 200, default: 16 },
        { key: 'hp', type: 'number', integer: true, min: 1, default: 20 },
        { key: 'who', type: 'string', default: '', shown: true, label: 'Who you are fighting' },
        { key: 'says', type: 'text', default: '', label: 'What they say',
          doc: 'Typed inside the arena while you dodge. Takes the same codes a message does — {color:}, {fx:wave}, {voice:}.' },
        { key: 'onLose', type: 'script', default: [] },
      ],
      async run(ctx, cmd) {
        const r = await KIT.scenes.run('bullet-fight', {
          game: KIT.game, pattern: cmd.pattern, count: cmd.count, hp: cmd.hp,
          who: T().substitute(cmd.who || '', ctx), says: T().substitute(cmd.says || '', ctx),
        });
        if (r === 'lost' && cmd.onLose && cmd.onLose.length) await ctx.runList(cmd.onLose, ['onLose']);
        return r;
      },
      summary(cmd) { return `${cmd.pattern} × ${cmd.count}`; },
      text: {
        toLine(cmd) { return `@fight ${cmd.pattern} ${cmd.count}`; },
        fromLine(line) {
          const m = /^@fight\s+(\w+)(?:\s+(\d+))?$/.exec(line.trim());
          return m ? { t: 'fight', pattern: m[1], count: m[2] ? Number(m[2]) : 16 } : null;
        },
      },
    });
  };

  function fightScene() {
    let game = null, world = null, fight = null, pattern = null, self = null;
    let writer = null, who = '', blipVoice = null;
    const held = { x: 0, y: 0 };

    return {
      id: 'bullet-fight',
      // The fight OWNS the screen: the world is not drawn under it, and this
      // scene gets the whole frame to itself. That is what makes it a battle
      // screen rather than an arena painted over whatever room you were in.
      opaque: true,
      background: '#000000',
      enter(params) {
        self = this;
        game = (params && params.game) || KIT.game;
        world = game.world || null;
        // The arena is in its own space now, not the map's, so it is placed in
        // tiles from the top-left of the screen and does not care where you were.
        fight = B.create({ x: 0, y: 0, w: num(params.w, 9), h: num(params.h, 6), hp: num(params.hp, 20) });
        const make = B.PATTERNS[params.pattern] || B.PATTERNS.rain;
        pattern = make(fight, num(params.count, 16));
        if (world) world.busy = true;
        // What they say, typed inside the arena while you dodge — the thing that
        // makes this a conversation you are surviving rather than a minigame.
        who = params.who || '';
        writer = params.says ? KIT.textWriter({ size: 15, speed: 26, color: '#ffffff', shadow: '#000000', width: 320 }) : null;
        if (writer) writer.say(params.says);
        blipVoice = KIT.registry.exists('voices') ? (KIT.registry('voices').get(params.voice || 'default') || null) : null;
      },
      exit() {
        if (world) world.busy = false;
      },
      update(dt) {
        if (!fight || fight.over) return;
        // Held input is fine: KIT.input.state(player) gives what is down right
        // now, which is exactly what continuous movement needs. (input(ev) only
        // fires on the press edge, so `held` below is just the fallback.)
        const st = KIT.input.state ? KIT.input.state(1) : null;
        const dir = st ? { x: (st.right ? 1 : 0) - (st.left ? 1 : 0), y: (st.down ? 1 : 0) - (st.up ? 1 : 0) } : held;
        B.runPattern(fight, pattern, dt);
        const ev = B.step(fight, dt, dir);
        if (ev.hit) {
          KIT.audio.play('bump');
          if (KIT.fx && KIT.fx.shake) KIT.fx.shake({ power: 4, ms: 180 });
        }
        if (ev.grazed) KIT.audio.play('blip');
        if (writer) {
          const said = writer.update(dt);
          if (said && blipVoice && blipVoice.sound) {
            for (let i = 0; i < said.length; i += Math.max(1, blipVoice.everyChars || 2)) {
              if (!/\s/.test(said[i])) KIT.audio.play(blipVoice.sound, { pitch: blipVoice.pitch || 1, volume: (blipVoice.volume == null ? 0.5 : blipVoice.volume) * 0.7 });
            }
          }
        }
        if (fight.hp <= 0) { self.finish('lost'); return; }
        if (B.patternDone(fight, pattern)) self.finish('survived');
      },
      /**
       * The scene's own canvas. `view` gives W/H and the tile size the world is
       * drawn at, so the arena is sized in the same units as the rest of the
       * game and a bullet is the size of a thing on a map.
       */
      draw(ctx, view) {
        if (!fight) return;
        const b = fight.box;

        // A battle screen is four bands, top to bottom: who is talking, what
        // they are saying, the arena, and how much heart is left. Each is given
        // its room BEFORE the arena is sized, so a long line never lands on top
        // of the box the way it would if the box were simply centred.
        const unit = Math.max(11, Math.round(view.H * 0.034));
        // The writer is told the size FIRST, so the room reserved for it below
        // and the room it actually takes are the same number. They were not,
        // and the third line of a long sentence landed on top of the arena.
        if (writer) writer.size(unit);
        const lineH = writer ? writer.lineHeight() : Math.round(unit * 1.45);
        const nameY = Math.round(view.H * 0.06);
        const sayY = nameY + (who ? Math.round(unit * 1.5) : 0);
        const SAY_LINES = 3;                                  // the band is fixed, so nothing below it moves
        const bottom = Math.round(unit * 2.2);                // hearts
        const top = sayY + (writer ? SAY_LINES * lineH : 0) + Math.round(unit * 0.6);
        const room = Math.max(unit * 3, view.H - top - bottom - unit);
        const px = Math.max(8, Math.floor(Math.min((view.W * 0.82) / b.w, room / b.h)));
        const ox = Math.round((view.W - b.w * px) / 2);
        const oy = Math.round(top + (room - b.h * px) / 2);
        const at = (x, y) => [ox + x * px, oy + y * px];

        // who is talking, in their own voice — font, colour and all
        if (who) {
          KIT.drawText(ctx, who, ox, nameY, { size: Math.round(unit * 1.05), color: '#ffffff', shadow: '#000000' });
        }
        // and what they are saying, typing itself while you dodge
        if (writer) {
          writer.width(b.w * px);
          writer.draw(ctx, ox, sayY);
        }

        // the box
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, px / 8);
        ctx.strokeRect(ox - ctx.lineWidth / 2, oy - ctx.lineWidth / 2,
          b.w * px + ctx.lineWidth, b.h * px + ctx.lineWidth);

        // the bullets and the soul, drawn from the same registered art the map
        // uses — KIT.pixels.artOf is how the renderer itself resolves a tile.
        const sprite = (id, cx, cy, size) => {
          const art = KIT.pixels.artOf(KIT.tiles.def(id));
          if (!art) return false;
          const d = KIT.pixels.dims(art);
          const sc = (size || px) / d.w;
          KIT.pixels.draw(ctx, art, Math.round(cx - d.w * sc / 2), Math.round(cy - d.h * sc / 2), { scale: sc });
          return true;
        };
        for (const bu of fight.bullets) {
          const [x, y] = at(bu.x - b.x, bu.y - b.y);
          if (!sprite(bu.look === 'bone' ? 'bullet-bone' : 'bullet', x, y, bu.r * 4 * px)) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(x, y, bu.r * px, 0, Math.PI * 2); ctx.fill();
          }
        }
        const s = fight.soul;
        const [sx, sy] = at(s.x - b.x, s.y - b.y);
        ctx.globalAlpha = s.invuln > 0 ? (Math.floor(fight.t * 20) % 2 ? 0.25 : 1) : 1;
        if (!sprite('soul', sx, sy, s.r * 4 * px)) {
          ctx.fillStyle = '#ff2d55';
          ctx.beginPath(); ctx.arc(sx, sy, s.r * px, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // How much heart is left. A row of them, at most ten wide however deep
        // the pool is, because twelve is already more than anybody counts — and
        // the number beside it for anybody who wants the truth.
        const SLOTS = 10;
        const heart = Math.max(6, Math.round(unit * 0.62));
        const gap = Math.max(2, Math.round(heart * 0.35));
        const hy = oy + b.h * px + Math.round(unit * 0.8);
        const full = Math.round((fight.hp / Math.max(1, fight.maxHp)) * SLOTS);
        for (let i = 0; i < SLOTS; i++) {
          ctx.fillStyle = i < full ? '#ff2d55' : '#3a2030';
          ctx.fillRect(ox + i * (heart + gap), hy, heart, heart);
        }
        KIT.drawText(ctx, `${fight.hp} / ${fight.maxHp}`, ox + SLOTS * (heart + gap) + unit * 0.6, hy - 1, {
          size: Math.round(unit * 0.8), color: '#ffffff', shadow: '#000000',
        });
      },
      input(ev) {
        if (!ev || !ev.key) return true;
        const on = ev.down !== false;
        if (ev.key === 'left') held.x = on ? -1 : 0;
        else if (ev.key === 'right') held.x = on ? 1 : 0;
        else if (ev.key === 'up') held.y = on ? -1 : 0;
        else if (ev.key === 'down') held.y = on ? 1 : 0;
        return true;
      },
    };


  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
