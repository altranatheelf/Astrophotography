// dungeon/register — everything the Dungeon module puts into the kit's
// registries: the strings, four object types, one behaviour, four commands,
// two conditions, the per-tick system, a pause-menu entry, two quick-create
// presets and a validator.
//
// There are no rules in here: it is the wiring between rules.js (pure, tested
// in Node) and the engine. manifest.js calls KIT.dungeon.registerAll(KIT) when
// the project lists this module.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const D = KIT.dungeon = KIT.dungeon || {};

  const num = KIT.num;
  const text = (project, key, vars) => KIT.strings.get(project, key, vars || {});

  // ---- every line the module can say -------------------------------------------
  D.STRINGS = [
    { id: 'dungeon-locked', default: 'It is locked.' },
    { id: 'dungeon-locked-need', default: 'It is locked. {item} would open it.' },
    { id: 'dungeon-opened', default: 'The lock turns, and the door swings open.' },
    { id: 'dungeon-already-open', default: 'It is already open.' },
    { id: 'dungeon-no-room', default: 'It will not budge.' },
    { id: 'dungeon-pushed', default: 'The block grinds across the stone.' },
    { id: 'dungeon-switch-down', default: 'Something heavy clicks.' },
    { id: 'dungeon-gate-open', default: 'A gate rattles open somewhere.' },
    { id: 'dungeon-gate-shut', default: 'A gate slams shut somewhere.' },
    { id: 'dungeon-torch-on', default: 'You light the lantern.' },
    { id: 'dungeon-torch-off', default: 'You put the lantern out.' },
    { id: 'dungeon-menu-lantern', default: 'Lantern' },
    { id: 'dungeon-menu-on', default: 'lit' },
    { id: 'dungeon-menu-off', default: 'out' },
  ];

  // ---- helpers shared by the commands, the system and the scenes -----------------
  /** live(world) -> the bundle everything in the module works through. */
  D.live = function (world) {
    const data = D.ensure(world.save);
    return {
      world, data, project: world.project, save: world.save, tuning: D.tuning(world.project),
      sound(id) { if (id && world.ports && world.ports.audio && world.ports.audio.play) world.ports.audio.play(id); },
      /** Things standing on the floor right now, for the plates. */
      standing() {
        const out = [];
        for (const h of world.heroes || []) if (h.visible !== false) out.push({ x: h.x, y: h.y, kind: 'hero' });
        if (world.companion && world.companion.visible !== false) out.push({ x: world.companion.x, y: world.companion.y, kind: 'hero' });
        for (const e of world.entities || []) {
          if (!e.object) continue;
          if (e.object.type === 'dungeon-block') out.push({ x: e.x, y: e.y, kind: 'block' });
        }
        return out;
      },
    };
  };
  const worldOf = (ctx) => ctx.world || (KIT.game && KIT.game.world) || null;

  let registered = false;

  D.registerAll = function (kit) {
    if (registered) return;
    registered = true;

    if (typeof D.registerArt === 'function') D.registerArt();
    const strings = KIT.registry('strings');
    for (const s of D.STRINGS) if (!strings.has(s.id)) strings.add(s);

    // ---- object types -------------------------------------------------------------
    KIT.registry('objectTypes').addAll([
      { id: 'dungeon-door', name: 'Locked door', doc: 'A door that stays shut until you are carrying the right key. Face it and press A.',
        tags: ['door'], icon: 'door', fields: [
          { key: 'look', type: 'tile', nullable: true, default: 'dun-door-locked', doc: 'The tile drawn while it is locked' },
          { key: 'lookOpen', type: 'tile', nullable: true, default: 'dun-door-open', doc: 'The tile drawn once it is open' },
          { key: 'key', type: 'ref:item', nullable: true, default: null, doc: 'The bag item that opens it. Blank = it only needs a push.' },
          { key: 'count', type: 'number', integer: true, min: 1, default: 1, doc: 'How many of that key it takes' },
          { key: 'consume', type: 'bool', default: true, doc: 'Use the key up when the door opens' },
          { key: 'lockedText', type: 'text', default: '', doc: 'What it says when it will not open (blank = the Terms wording)' },
          { key: 'openText', type: 'text', default: '', doc: 'What it says as it opens (blank = the Terms wording)' },
          { key: 'stayShut', type: 'bool', default: false, doc: 'Opened, but still solid — a doorway you can see through and not walk through' },
        ], page: { layer: 'same', on: { interact: [{ t: 'openDoor', target: 'self' }] } }, look: { tile: 'look' } },

      { id: 'dungeon-block', name: 'Pushable block', doc: 'A block you shove one square at a time. Where you leave it is remembered in the save, never in the map.',
        tags: ['furniture'], icon: 'tile', fields: [
          { key: 'look', type: 'tile', nullable: true, default: 'dun-block' },
          { key: 'sound', type: 'ref:sound', nullable: true, default: null, doc: 'Blank = the module’s push sound' },
          { key: 'resetOnEnter', type: 'bool', default: false, doc: 'Snaps back to where you drew it every time you walk into the room' },
        ], page: { layer: 'same', on: { interact: [{ t: 'pushBlock', target: 'self' }] } }, look: { tile: 'look' } },

      { id: 'dungeon-switch', name: 'Switch plate', doc: 'A plate in the floor. It is down while a hero or a block is standing on it.',
        tags: ['logic'], icon: 'flag', fields: [
          { key: 'name', type: 'string', min: 1, default: 'switch1', doc: 'The name gates listen for' },
          { key: 'look', type: 'tile', nullable: true, default: 'dun-plate' },
          { key: 'lookOn', type: 'tile', nullable: true, default: 'dun-plate-down' },
          { key: 'mode', type: 'enum', options: ['hold', 'toggle', 'latch'], default: 'hold',
            doc: 'hold: down only while stood on · toggle: flips each time · latch: once down, stays down' },
          { key: 'holders', type: 'list', of: { type: 'enum', options: ['hero', 'block'] }, default: ['hero', 'block'], doc: 'What is heavy enough' },
          { key: 'sound', type: 'ref:sound', nullable: true, default: null },
        ], page: { layer: 'below', through: true }, look: { tile: 'look' } },

      { id: 'dungeon-guard', name: 'Guard', doc: 'Somebody who walks one way until something stops them, then turns round. (The kit\u2019s own behaviour list is fixed, so the module gives its patrol its own event type — see the README.)',
        tags: ['character'], icon: 'npc', fields: [
          { key: 'axis', type: 'enum', options: ['h', 'v'], default: 'h', label: 'Walks', doc: 'h: left and right · v: up and down' },
          { key: 'speed', type: 'number', min: 1, max: 9, default: 4 },
        ], page: { layer: 'same', sprite: 'man' }, look: { sprite: true } },

      { id: 'dungeon-gate', name: 'Gate', doc: 'Open while the switches it listens for are down; solid the rest of the time.',
        tags: ['door'], icon: 'door', fields: [
          { key: 'needs', type: 'string', default: 'switch1', doc: 'Switch names, separated by commas. All of them must be down.' },
          { key: 'invert', type: 'bool', default: false, doc: 'Open when they are NOT down' },
          { key: 'look', type: 'tile', nullable: true, default: 'dun-gate-closed' },
          { key: 'lookOpen', type: 'tile', nullable: true, default: 'dun-gate-open' },
          { key: 'sound', type: 'ref:sound', nullable: true, default: null },
        ], page: { layer: 'same' }, look: { tile: 'look' } },
    ]);

    // ---- behaviour: pace up and down a corridor -------------------------------------
    KIT.registry('behaviours').add({
      id: 'pace', label: 'Pace up and down',
      doc: 'Walks one way until something stops it, then turns round. A patrolling guard, in one line.',
      fields: [
        { key: 'axis', type: 'enum', options: ['h', 'v'], default: 'h', label: 'Along' },
        { key: 'speed', type: 'number', min: 1, max: 9, default: 4, doc: 'Bigger is faster' },
      ],
      update(e, world, dt) {
        if (e.mover.moving) return;
        e.data.paceTimer = (e.data.paceTimer || 0) - dt;
        if (e.data.paceTimer > 0) return;
        e.data.paceTimer = 1.1 - Math.min(0.9, num(e.behaviour.speed, 4) * 0.1);
        const pair = (e.behaviour.axis === 'v') ? ['up', 'down'] : ['left', 'right'];
        if (!pair.includes(e.data.paceDir)) e.data.paceDir = pair[0];
        const r = KIT.entities.tryMove(e, e.data.paceDir, world.map, {});
        if (!r || !r.ok) e.data.paceDir = e.data.paceDir === pair[0] ? pair[1] : pair[0];
      },
    });

    // ---- commands ------------------------------------------------------------------
    const cmds = KIT.registry('commands');
    const targetField = { key: 'target', type: 'string', default: 'self', doc: 'self | obj:<id>' };

    cmds.add({
      id: 'openDoor', label: 'Open A Locked Door', group: 'Dungeon', icon: 'door', blocking: true, background: false,
      doc: 'Tries to open a locked-door event: takes the key if there is one, says the right line and leaves the door open for good.',
      fields: [targetField, { key: 'silent', type: 'bool', default: false, doc: 'Open it without saying anything' }],
      async run(ctx, cmd) {
        const world = worldOf(ctx);
        const e = D.entityFor(world, ctx, cmd.target);
        if (!e || !world) return;
        const L = D.live(world);
        const props = (e.page && e.page.props) || {};
        const r = D.tryOpen(world.save, e.objectKey, props);
        const itemName = props.key && world.project.items[props.key] ? world.project.items[props.key].name : props.key;
        if (!r.ok) {
          L.sound(L.tuning.lockedSound);
          if (!cmd.silent) await ctx.io.say({ text: props.lockedText || text(world.project, props.key ? 'dungeon-locked-need' : 'dungeon-locked', { item: itemName }) });
          return;
        }
        if (r.reason === 'already') {
          if (!cmd.silent) await ctx.io.say({ text: text(world.project, 'dungeon-already-open') });
          return;
        }
        if (r.count > 0) KIT.commands.state.give(ctx, r.key, -r.count);
        KIT.commands.state.setSelf(ctx, 'opened', true, e.objectKey);
        L.sound(L.tuning.unlockSound);
        if (!cmd.silent) await ctx.io.say({ text: props.openText || text(world.project, 'dungeon-opened') });
      },
      summary(cmd) { return `Open the door (${cmd.target || 'self'})`; },
    });

    cmds.add({
      id: 'pushBlock', label: 'Push A Block', group: 'Dungeon', icon: 'tile', blocking: false, background: true,
      doc: 'Shoves a pushable block one square. Blank direction means "away from whoever is touching it".',
      fields: [targetField, { key: 'dir', type: 'enum', options: ['away', 'up', 'down', 'left', 'right'], default: 'away' }],
      run(ctx, cmd) {
        const world = worldOf(ctx);
        const e = D.entityFor(world, ctx, cmd.target);
        if (!e || !world) return;
        let dir = cmd.dir;
        if (!dir || dir === 'away') {
          const h = world.hero();
          dir = h ? h.dir : 'down';
        }
        D.pushEntity(world, e, dir);
      },
      summary(cmd) { return `Push ${cmd.target || 'self'} ${cmd.dir === 'away' ? 'away from you' : cmd.dir}`; },
    });

    cmds.add({
      id: 'torch', label: 'Lantern', group: 'Dungeon', icon: 'sparkle', blocking: false, background: true,
      doc: 'Lights the lantern the heroes carry, or puts it out. The reach comes from the module’s numbers unless you say otherwise.',
      fields: [
        { key: 'on', type: 'bool', default: true },
        { key: 'radius', type: 'number', min: 0, max: 20, default: 0, doc: '0 = whatever the Dungeon panel says' },
      ],
      run(ctx, cmd) {
        const world = worldOf(ctx);
        const save = (ctx && ctx.save) || (world && world.save);
        if (!save) return;
        const data = D.ensure(save);
        const tuning = D.tuning((world && world.project) || ctx.project);
        if (cmd.on === false) D.putOut(data);
        else D.lightTorch(data, num(cmd.radius, 0) || tuning.torchRadius);
      },
      summary(cmd) { return cmd.on === false ? 'Put the lantern out' : `Light the lantern${cmd.radius ? ' (' + cmd.radius + ' tiles)' : ''}`; },
    });

    cmds.add({
      id: 'setSwitch', label: 'Set A Switch', group: 'Dungeon', icon: 'flag', blocking: false, background: true,
      doc: 'Turns a named dungeon switch on or off from a script, without anybody standing on a plate.',
      fields: [
        { key: 'name', type: 'string', min: 1, default: 'switch1' },
        { key: 'on', type: 'bool', default: true },
      ],
      run(ctx, cmd) {
        const world = worldOf(ctx);
        const save = (ctx && ctx.save) || (world && world.save);
        if (!save) return;
        D.setSwitch(D.ensure(save), cmd.name, cmd.on !== false);
        if (ctx.emit) ctx.emit('dungeonSwitch', { name: cmd.name, on: cmd.on !== false });
      },
      summary(cmd) { return `Switch “${cmd.name}” ${cmd.on === false ? 'off' : 'on'}`; },
    });

    // ---- conditions -------------------------------------------------------------------
    const conds = KIT.registry('conditions');
    conds.add({
      id: 'switch', label: 'A dungeon switch is on',
      fields: [{ key: 'name', type: 'string', min: 1, default: 'switch1' }, { key: 'is', type: 'bool', default: true }],
      test(cond, ctx) {
        const save = (ctx && ctx.world && ctx.world.save) || (ctx && ctx.save) || {};
        return D.switchOn(D.ensure(save), cond.name) === (cond.is !== false);
      },
      describe(cond) { return `switch “${cond.name}” is ${cond.is === false ? 'off' : 'on'}`; },
    });
    conds.add({
      id: 'torchLit', label: 'The lantern is lit',
      fields: [{ key: 'is', type: 'bool', default: true }],
      test(cond, ctx) {
        const save = (ctx && ctx.world && ctx.world.save) || (ctx && ctx.save) || {};
        const data = D.ensure(save);
        return !!(data.torch && data.torch.lit) === (cond.is !== false);
      },
      describe(cond) { return `the lantern is ${cond.is === false ? 'out' : 'lit'}`; },
    });

    // ---- the system -----------------------------------------------------------------
    KIT.registry('systems').add({ id: 'dungeon', order: 35, update: D.tick, onMapEnter: D.onMapEnter });

    // ---- the pause menu ---------------------------------------------------------------
    KIT.registry('menus').add({
      id: 'dungeon-lantern', order: 34, icon: 'dun-torch-icon',
      label: (game) => KIT.strings.get(game && game.project, 'dungeon-menu-lantern'),
      when: (game) => !!(game && game.world),
      value: (game) => {
        const d = D.ensure(game.world.save);
        return text(game.project, d.torch && d.torch.lit ? 'dungeon-menu-on' : 'dungeon-menu-off');
      },
      open(game) {
        const world = game.world;
        if (!world) return;
        const data = D.ensure(world.save);
        const tuning = D.tuning(world.project);
        if (data.torch && data.torch.lit) D.putOut(data); else D.lightTorch(data, tuning.torchRadius);
        if (KIT.toast) KIT.toast(text(world.project, data.torch.lit ? 'dungeon-torch-on' : 'dungeon-torch-off'));
      },
    });

    // ---- quick-create presets ------------------------------------------------------------
    KIT.registry('presets').addAll([
      { id: 'locked-door', name: 'Locked door', kind: 'object', group: 'Dungeon', icon: 'door', doc: 'A door and the key that opens it.',
        fields: [{ key: 'key', type: 'ref:item', nullable: true }, { key: 'lockedText', type: 'text', default: '' }],
        objects: [{ at: 'here', type: 'dungeon-door', name: 'Locked door', pages: [{ props: { key: '$key', lockedText: '$lockedText' } }] }] },
      { id: 'switch-and-gate', name: 'Switch and gate', kind: 'object', group: 'Dungeon', icon: 'flag', doc: 'A plate here and the gate it opens over there.',
        fields: [{ key: 'name', type: 'string', default: 'switch1' }, { key: 'gate', type: 'position', display: 'link' }],
        objects: [
          { at: 'here', type: 'dungeon-switch', name: 'Plate', pages: [{ props: { name: '$name' } }] },
          { at: 'gate', type: 'dungeon-gate', name: 'Gate', pages: [{ props: { needs: '$name' } }] },
        ] },
    ]);

    // ---- a validator: a gate that listens for nothing is a bug, not a style -------------
    KIT.registry('validators').add({
      id: 'dungeon', label: 'Dungeon',
      run(project) {
        const problems = [];
        const known = D.switchNames(project);
        for (const map of Object.values(project.maps || {})) {
          for (const obj of map.objects || []) {
            if (obj.type !== 'dungeon-gate') continue;
            (obj.pages || []).forEach((page, i) => {
              const needs = String((page.props && page.props.needs) || '').split(',').map(s => s.trim()).filter(Boolean);
              const where = { map: map.id, object: obj.id, page: i };
              if (!needs.length) { problems.push({ severity: 'warn', code: 'dungeon-gate-empty', message: `the gate “${obj.name || obj.id}” listens for no switch, so it never opens`, where }); return; }
              for (const n of needs) {
                if (!known.includes(n)) problems.push({ severity: 'warn', code: 'dungeon-no-switch', message: `the gate “${obj.name || obj.id}” waits for the switch “${n}”, which no plate anywhere sets`, where });
              }
            });
          }
        }
        return problems;
      },
    });

    if (typeof D.registerPanel === 'function') D.registerPanel();
  };

  // ---- the live half: what the system does every tick -------------------------------------
  /** entityFor(world, ctx, target) -> the entity a command is aimed at. */
  D.entityFor = function (world, ctx, target) {
    if (!world) return null;
    const t = String(target || 'self');
    if (t === 'self') return ctx.entity || world.activeEntity || null;
    if (t.startsWith('obj:')) return world.entities.find(e => e.id === t.slice(4)) || null;
    return world.entities.find(e => e.id === t) || null;
  };

  /** pushEntity(world, e, dir) -> bool — the one place a block actually moves. */
  D.pushEntity = function (world, e, dir) {
    if (!e || !world || !world.map) return false;
    if (e.mover && e.mover.moving) return false;
    const L = D.live(world);
    const can = D.canPush(world.map, { x: e.x, y: e.y }, dir, {
      ignore: e, blockers: world.entities.concat(world.heroes || []),
    });
    if (!can.ok) { L.sound('bump'); return false; }
    D.setBlock(L.data, e.objectKey, can.to.x, can.to.y);
    L.data.pushes = num(L.data.pushes, 0) + 1;
    KIT.entities.tryMove(e, dir, world.map, { ignoreBlocked: true });
    const props = (e.page && e.page.props) || {};
    L.sound(props.sound || L.tuning.pushSound);
    if (world.events) world.events.emit('dungeonPush', { id: e.id, to: can.to });
    return true;
  };

  /** onMapEnter — light the lantern in a dark room, and put the blocks back where the save left them. */
  D.onMapEnter = function (world) {
    if (!world || !world.map) return;
    D.listen(world);
    const L = D.live(world);
    for (const e of world.entities) {
      if (!e.object || e.object.type !== 'dungeon-block') continue;
      const props = (e.page && e.page.props) || {};
      if (props.resetOnEnter) { delete L.data.blocks[e.objectKey]; continue; }
      const at = D.blockAt(L.data, e.objectKey, { x: e.x, y: e.y });
      e.x = at.x; e.y = at.y; e.px = at.x; e.py = at.y;
    }
    if (L.tuning.lightOnEnter && D.isDark(world.map) && !(L.data.torch && L.data.torch.lit)) D.lightTorch(L.data, L.tuning.torchRadius);
  };

  /**
   * Pushing a block is the answer to "somebody tried to walk into it and could
   * not", which is exactly what the world's `bump` event says. Listening for it
   * rather than polling the d-pad means a block can also be pushed by a script,
   * by a moveRoute, or by any input the engine grows later.
   */
  D.listen = function (world) {
    if (!world || !world.events || world._dungeonListening) return;
    world._dungeonListening = true;
    world.events.on('bump', (p) => {
      try {
        const L = D.live(world);
        if (!L.tuning.pushBlocks || world.busy || !p || !p.to) return;
        const now = world.time || 0;
        if (now - (world._dungeonPushAt || -9) < 0.25) return;      // one push, then a beat
        const block = world.entities.find(e => e.object && e.object.type === 'dungeon-block'
          && e.x === p.to.x && e.y === p.to.y && !e.mover.moving);
        if (!block) return;
        world._dungeonPushAt = now;
        D.pushEntity(world, block, p.dir);
      } catch (e) { (KIT.log || console).error('[dungeon] bump', e); }
    });
  };

  /** tick — looks, solidity, plates, gates and the lantern. */
  D.tick = function (world, dt) {
    if (!world || !world.map) return;
    D.listen(world);
    const L = D.live(world);
    const data = L.data, tuning = L.tuning;
    const standing = L.standing();

    for (const e of world.entities) {
      const type = e.object && e.object.type;
      if (!type || type.slice(0, 8) !== 'dungeon-') continue;
      const props = (e.page && e.page.props) || {};

      if (type === 'dungeon-door') {
        const open = D.isOpen(world.save, e.objectKey);
        e.look = (open && props.lookOpen) ? props.lookOpen : (props.look || null);
        e.solid = open ? !!props.stayShut : true;
        e.through = open && !props.stayShut;
      } else if (type === 'dungeon-block') {
        if (!e.mover.moving) {
          const at = D.blockAt(data, e.objectKey, { x: e.x, y: e.y });
          if (at.x !== e.x || at.y !== e.y) { e.x = at.x; e.y = at.y; e.px = at.x; e.py = at.y; }
        }
      } else if (type === 'dungeon-switch') {
        const held = D.plateHeld({ x: e.x, y: e.y }, standing, props.holders);
        const mode = props.mode || 'hold';
        const was = !!e.data.plateHeld;
        e.data.plateHeld = held;
        let on = D.switchOn(data, props.name);
        if (mode === 'hold') on = held;
        else if (mode === 'latch') on = on || held;
        else if (mode === 'toggle' && held && !was) on = !on;
        if (D.setSwitch(data, props.name, on)) {
          L.sound(props.sound || tuning.switchSound);
          if (world.events) world.events.emit('dungeonSwitch', { name: props.name, on });
        }
        e.look = on ? (props.lookOn || props.look || null) : (props.look || null);
      } else if (type === 'dungeon-guard') {
        // A guard's page may say `behaviour: { kind: 'pace' }` like any other —
        // the page schema reads its options from the `behaviours` registry. This
        // is only the type's convenience: a guard placed in Creator Mode paces
        // along the axis in its own props without the author setting a behaviour.
        if (!e.behaviour || e.behaviour.kind === 'none') e.behaviour = { kind: 'pace', axis: props.axis || 'h', speed: num(props.speed, 4) };
        else if (e.behaviour.kind === 'pace' && e.behaviour.axis === undefined) e.behaviour = Object.assign({ axis: props.axis || 'h', speed: num(props.speed, 4) }, e.behaviour);
      } else if (type === 'dungeon-gate') {
        const open = D.gateOpen(data, props.needs, props.invert);
        if (e.data.gateOpen !== open) {
          if (e.data.gateOpen !== undefined) L.sound(props.sound || tuning.gateSound);
          e.data.gateOpen = open;
        }
        e.look = open ? (props.lookOpen || props.look || null) : (props.look || null);
        e.solid = !open;
        e.through = open;
      }
    }

    // the lantern the heroes carry
    const light = D.torchLight(data, tuning);
    for (const h of world.heroes || []) { h.data = h.data || {}; h.data.light = light; }

  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
