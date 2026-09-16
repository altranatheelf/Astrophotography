// Creator Mode — the Tiles panel and the Map panel (contract: docs/EDITOR-CONTRACT.md).
//
//   Tiles: which layer you are painting, what you are painting with (tiles,
//          stamps, terrains, regions, collision), what the map shows, and the
//          autotile wizard that turns a handful of tiles into a rule group.
//   Map:   this map's name, kind, size, music and note; where the game starts;
//          the doors to the maps next door; and every map in the world.
//
// Nothing here writes to the project directly: every change goes through
// KIT.editor.ops or KIT.editor.commit, so undo covers all of it.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const T = ED.tools = ED.tools || {};
  const UI = KIT.ui;
  if (!UI || typeof document === 'undefined') return;                     // headless: nothing to mount

  const P = KIT.project;
  const LAYERS = [
    { id: 'ground', label: 'Ground', help: 'The floor: grass, path, water, floorboards. Every square has one.' },
    { id: 'deco', label: 'Deco', help: 'Things standing on the ground: flowers, signs, furniture, tree trunks.' },
    { id: 'above', label: 'Above', help: 'Drawn over the characters: treetops, roofs, the front of a bridge.' },
    { id: 'terrain', label: 'Terrain', help: 'Paint the kind of ground and the autotiles draw the edges for you.' },
    { id: 'regions', label: 'Regions', help: 'Invisible numbered areas. Scripts ask "is the hero standing in region 3?"' },
    { id: 'collision', label: 'Collision', help: 'Override where people may walk, on top of what the tiles already say.' },
  ];
  const VIEWS = [
    { id: 'grid', label: 'Grid' }, { id: 'collision', label: 'Collision' }, { id: 'regions', label: 'Regions' },
    { id: 'terrain', label: 'Terrain' }, { id: 'objects', label: 'Events' }, { id: 'labels', label: 'Names' },
  ];
  const TILE_LAYERS = ['ground', 'deco', 'above'];
  const SIDES = [
    { id: 'n', label: 'Top (north)' }, { id: 's', label: 'Bottom (south)' },
    { id: 'e', label: 'Right (east)' }, { id: 'w', label: 'Left (west)' },
  ];
  const SIDE_DIR = { n: 'up', s: 'down', e: 'right', w: 'left' };

  // ---- small DOM helpers ------------------------------------------------------
  const make = UI.make;
  function el(spec, opts, children) {
    const node = make(spec, opts);
    for (const c of children || []) if (c) node.appendChild(c);
    return node;
  }
  function button(label, onTap, cls) {
    const b = make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    b.onclick = (e) => { e.preventDefault(); onTap(e); };
    return b;
  }
  function chip(label, onTap, cls) {
    const b = make('button.ed-chip' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    b.onclick = (e) => { e.preventDefault(); onTap(e); };
    return b;
  }
  function field(label, input, hint) {
    const wrap = make('label.ed-field');
    wrap.appendChild(make('span', { text: label }));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(make('small.ed-hint', { text: hint }));
    return wrap;
  }
  function input(type, value, onChange) {
    const i = make('input');
    i.type = type || 'text';
    if (value != null) i.value = value;
    i.onchange = () => onChange(i.value, i);
    return i;
  }
  function select(options, value, onChange) {
    const s = make('select');
    for (const o of options) {
      const opt = make('option', { text: o.label });
      opt.value = o.value == null ? '' : String(o.value);
      s.appendChild(opt);
    }
    s.value = value == null ? '' : String(value);
    s.onchange = () => onChange(s.value, s);
    return s;
  }
  /** Keep an input in step with the document without stealing the caret. */
  function sync(node, value) {
    if (!node || node === document.activeElement) return;
    const v = value == null ? '' : String(value);
    if (node.value !== v) node.value = v;
  }
  function section(title, open) {
    const d = make('details.ed-sec');
    d.open = !!open;
    d.appendChild(make('summary', { text: title }));
    const body = make('div.ed-sec-body');
    d.appendChild(body);
    d.body = body;
    return d;
  }
  function tileCanvas(id, size) {
    const def = KIT.registry.exists('tiles') ? KIT.registry('tiles').get(id) : null;
    const art = def ? (KIT.pixels.artOf(def) || def) : null;
    const cv = UI.artCanvas(art, size || 2, '#3a4358');
    cv.style.width = '100%';
    cv.style.height = '100%';
    return cv;
  }
  function swatchButton(tileId, selected, onTap, title) {
    const b = make('button.ed-swatch');
    b.type = 'button';
    b.title = title || tileId || 'empty';
    b.setAttribute('aria-label', title || tileId || 'empty');
    b.dataset.tile = tileId == null ? '' : tileId;
    b.setAttribute('aria-selected', String(!!selected));
    if (tileId) b.appendChild(tileCanvas(tileId, 2));
    else b.appendChild(make('span.ed-swatch-empty', { text: '—' }));
    b.onclick = (e) => { e.preventDefault(); onTap(e); };
    return b;
  }
  function colorDot(color) {
    const d = make('span.ed-dot');
    d.style.background = color || '#888';
    return d;
  }

  /**
   * Every panel edit runs through here: one undo step, then the shell's
   * after-an-edit pass (repaint + validate + save the draft), which lives on
   * ED.afterEdit so every panel does exactly the same thing.
   */
  function edit(label, fn) {
    const out = ED.commit(label, fn);
    if (ED.afterEdit) ED.afterEdit();
    else { ED.refresh(); if (ED.saveNow) ED.saveNow(); }
    return out;
  }
  ED.panelEdit = edit;      // the Map panel and the Tiles panel share it

  // =============================================================================
  // The Tiles panel
  // =============================================================================
  const tilesPanel = {
    id: 'tiles', label: 'Tiles', icon: 'grid', order: 10,
    group: null, search: '', armed: null, wizard: null,

    mount(host, ed) {
      this.host = host;
      UI.clear(host);

      // --- layer -------------------------------------------------------------
      this.layerChips = make('div.ed-chips');
      for (const l of LAYERS) {
        const b = chip(l.label, () => this.pickLayer(l.id));
        b.dataset.layer = l.id;
        this.layerChips.appendChild(b);
      }
      host.appendChild(make('div.ed-label', { text: 'Painting on' }));
      host.appendChild(this.layerChips);
      this.layerHelp = make('p.ed-hint');
      host.appendChild(this.layerHelp);

      // --- what the brush is holding -----------------------------------------
      this.brushLine = make('div.ed-brush');
      host.appendChild(this.brushLine);

      // --- the palette (tiles / terrains / regions / collision) ---------------
      this.searchWrap = make('div.ed-field.ed-searchwrap');
      this.searchInput = make('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = 'Search tiles by name…';
      this.searchInput.oninput = () => { this.search = this.searchInput.value.trim().toLowerCase(); this.renderPalette(ED); };
      this.searchWrap.appendChild(this.searchInput);
      host.appendChild(this.searchWrap);

      this.groupTabs = make('div.ed-subtabs');
      host.appendChild(this.groupTabs);
      this.palette = make('div.ed-palette');
      host.appendChild(this.palette);

      // --- stamps --------------------------------------------------------------
      this.stampSec = section('Stamps (multi-square brushes)');
      this.stampSec.addEventListener('toggle', () => { if (this.stampSec.open) this.renderStamps(ED); });
      host.appendChild(this.stampSec);

      // --- what the map shows ---------------------------------------------------
      this.viewSec = section('What the map shows', true);
      this.viewChips = make('div.ed-chips');
      for (const v of VIEWS) {
        const b = chip(v.label, () => {
          const patch = {}; patch[v.id] = !ED.state.show[v.id];
          ED.set({ show: patch });
          this.refresh(ED);
        });
        b.dataset.show = v.id;
        this.viewChips.appendChild(b);
      }
      this.viewSec.body.appendChild(this.viewChips);
      this.viewSec.body.appendChild(make('p.ed-hint', { text: 'Only you see these. Keyboard: G grid, C collision, R regions, T terrain.' }));
      host.appendChild(this.viewSec);

      // --- terrains and autotiles -------------------------------------------------
      this.autoSec = section('Terrains & autotiles');
      this.autoSec.addEventListener('toggle', () => { if (this.autoSec.open) this.renderAutotiles(ED); });
      host.appendChild(this.autoSec);

      // the shell repaints panels on selection/document events; tools, layers and the
      // zoom travel on 'change', and this panel shows all three
      if (!this._offChange) this._offChange = ED.on('change', (patch) => {
        if (!patch) return;
        if (patch.layer !== undefined && !fitsLayer(ED.state.tile, patch.layer)) ED.state.tile = T.brushFor(patch.layer);
        this.refresh(ED);
      });

      // imported art arrives after the page does: redraw the palette when it lands
      if (KIT.pixels.onImageLoaded && !this._watchingImages) {
        this._watchingImages = KIT.pixels.onImageLoaded(() => { if (!host.hidden) this.renderPalette(ED); });
      }
      this.refresh(ed);
    },

    pickLayer(layer) {
      T.remember(ED.state.layer, ED.state.tile);
      const patch = { layer, tile: T.brushFor(layer) };
      if (layer === 'terrain' && !['terrain', 'pencil', 'fill', 'rect', 'eraser'].includes(ED.state.tool)) patch.tool = 'terrain';
      ED.set(patch);
      if (ED.updateStatus) ED.updateStatus();      // the status bar names the layer; the shell only refreshes it on a pointer move
      this.group = null;
      this.refresh(ED);
    },
    pickTile(id) {
      if (this.armed) { this.assignTemplate(id); return; }
      T.remember(ED.state.layer, id);
      ED.set({ tile: id, stamp: null });
      if (ED.state.tool === 'stamp') ED.set({ tool: 'pencil' });
      this.refresh(ED);
    },

    refresh(ed) {
      if (!this.host || this.host.hidden) return;
      const st = ed.state;
      const layer = LAYERS.find(l => l.id === st.layer) || LAYERS[0];
      for (const b of this.layerChips.querySelectorAll('[data-layer]')) b.setAttribute('aria-pressed', String(b.dataset.layer === st.layer));
      this.layerHelp.textContent = layer.help;
      for (const b of this.viewChips.querySelectorAll('[data-show]')) b.setAttribute('aria-pressed', String(!!st.show[b.dataset.show]));
      const isTiles = TILE_LAYERS.includes(st.layer);
      this.searchWrap.hidden = !isTiles;
      this.groupTabs.hidden = !isTiles;
      this.stampSec.hidden = !isTiles;
      this.renderBrush(ed);
      this.renderPalette(ed);
      if (isTiles && this.stampSec.open) this.renderStamps(ed);
      if (this.autoSec.open) this.renderAutotiles(ed);
    },

    renderBrush(ed) {
      const st = ed.state;
      const line = this.brushLine;
      UI.clear(line);
      const name = T.describe(ed, st.layer, st.tile);
      if (st.tool === 'stamp' && st.stamp) {
        const def = (KIT.registry('tiles').stamps || []).find(s => s.id === st.stamp);
        line.appendChild(make('span.ed-badge', { text: 'Stamp' }));
        line.appendChild(make('strong', { text: (def && (def.name || def.id)) || st.stamp }));
      } else {
        if (TILE_LAYERS.includes(st.layer) && st.tile) {
          const box = make('span.ed-brush-swatch');
          box.appendChild(tileCanvas(st.tile, 2));
          line.appendChild(box);
        } else if (st.layer === 'terrain' || st.layer === 'regions') {
          line.appendChild(colorDot(st.layer === 'terrain' ? T.terrainColor(ed, Number(st.tile) || 0) : T.regionColor(Number(st.tile) || 0)));
        }
        line.appendChild(make('strong', { text: name }));
      }
      const hint = st.layer === 'collision' ? T.collisionAt(st.tile).help : '';
      if (hint) line.appendChild(make('small.ed-hint', { text: hint }));
    },

    renderPalette(ed) {
      const st = ed.state;
      const host = this.palette;
      const reg0 = KIT.registry('tiles');
      const sig = [st.layer, this.group, this.search, this.armed, reg0.size(), (st.project.terrains || []).length].join('|');
      if (sig === this.paletteSig && host.firstChild) return this.markSelected(ed);   // same palette: just move the tick
      this.paletteSig = sig;
      UI.clear(host);
      UI.clear(this.groupTabs);

      if (st.layer === 'collision') return this.renderCollision(ed, host);
      if (st.layer === 'regions') return this.renderRegions(ed, host);
      if (st.layer === 'terrain') return this.renderTerrainBrushes(ed, host);

      const reg = KIT.registry('tiles');
      const groups = reg.groups();
      if (!this.group || !groups.some(g => g.group === this.group)) this.group = groups.length ? groups[0].group : null;
      const q = this.search;
      for (const g of groups) {
        const b = make('button.ed-tab', { text: `${g.group} (${g.items.length})` });
        b.type = 'button';
        b.setAttribute('aria-selected', String(!q && g.group === this.group));
        b.onclick = () => { this.group = g.group; this.search = ''; this.searchInput.value = ''; this.renderPalette(ed); };
        this.groupTabs.appendChild(b);
      }
      let items = [];
      if (q) {
        for (const g of groups) items = items.concat(g.items.filter(t => (`${t.name || ''} ${t.id} ${t.group || ''}`).toLowerCase().includes(q)));
      } else {
        const g = groups.find(g => g.group === this.group);
        items = g ? g.items.slice() : [];
      }
      if (this.armed) host.appendChild(make('p.ed-hint.ed-armed', { text: `Tap a tile for “${this.armed}”.` }));
      const grid = make('div.ed-swatches');
      if (st.layer !== 'ground') {
        grid.appendChild(swatchButton(null, st.tile == null, () => this.pickTile(null), 'Nothing (erases this square)'));
      }
      for (const t of items) {
        const b = swatchButton(t.id, st.tile === t.id && !this.armed, () => this.pickTile(t.id), t.name || t.id);
        if (t.solid) b.appendChild(make('span.ed-swatch-flag', { text: '■' }));
        grid.appendChild(b);
      }
      host.appendChild(grid);
      if (!items.length) host.appendChild(make('p.ed-hint', { text: q ? `No tile called “${q}”.` : 'No tiles in this group yet.' }));
      if (q && items.length) host.appendChild(make('p.ed-hint', { text: `${items.length} tile${items.length === 1 ? '' : 's'} found` }));
    },

    /** The palette is already drawn: move the selection marks without rebuilding it. */
    markSelected(ed) {
      const st = ed.state;
      for (const b of this.palette.querySelectorAll('.ed-swatch')) {
        const id = b.dataset.tile || null;
        b.setAttribute('aria-selected', String(!this.armed && id === (st.tile == null ? null : st.tile)));
      }
      for (const item of this.palette.querySelectorAll('.ed-item')) {
        if (item.dataset.value === undefined) continue;
        item.setAttribute('aria-selected', String(item.dataset.value === String(st.tile)));
      }
      for (const b of this.palette.querySelectorAll('.ed-num')) b.setAttribute('aria-pressed', String(Number(st.tile) === Number(b.textContent)));
    },

    renderCollision(ed, host) {
      const st = ed.state;
      const list = make('div.ed-list');
      for (const c of T.COLLISION) {
        const item = make('div.ed-item');
        item.dataset.value = String(c.value);
        item.setAttribute('aria-selected', String(T.sameValue(c.value, st.tile)));
        item.tabIndex = 0;
        item.appendChild(colorDot(c.color.replace(/[\d.]+\)$/, '0.9)')));
        const text = make('div.ed-item-text');
        text.appendChild(make('strong', { text: c.label }));
        text.appendChild(make('small.ed-hint', { text: c.help }));
        item.appendChild(text);
        const tap = () => { T.remember('collision', c.value); ED.set({ tile: c.value }); this.refresh(ED); };
        item.onclick = tap;
        item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } };
        list.appendChild(item);
      }
      host.appendChild(list);
      host.appendChild(make('p.ed-hint', { text: 'Turn on “Collision” above to see the squares you have changed. RPG Maker calls these the passage settings.' }));
    },

    renderRegions(ed, host) {
      const st = ed.state;
      const grid = make('div.ed-numbers');
      for (let n = 0; n <= 31; n++) {
        const b = chip(String(n), () => { T.remember('regions', n); ED.set({ tile: n }); this.refresh(ED); }, 'ed-num');
        b.setAttribute('aria-pressed', String(Number(st.tile) === n));
        if (n) b.style.borderColor = T.regionColor(n);
        grid.appendChild(b);
      }
      host.appendChild(grid);
      host.appendChild(make('p.ed-hint', { text: '0 clears the square. A script can ask “is the hero in region 4?” — good for encounter areas and cut-scene triggers.' }));
    },

    renderTerrainBrushes(ed, host) {
      const st = ed.state;
      const brush = KIT.registry('editorTools').get('terrain');
      const sizes = make('div.ed-chips');
      for (const [n, label] of [[1, '1 square'], [2, '3 × 3'], [3, '5 × 5']]) {
        const b = chip(label, () => { if (brush) brush.size = n; this.paletteSig = null; this.renderPalette(ED); });
        b.setAttribute('aria-pressed', String(brush && brush.size === n));
        sizes.appendChild(b);
      }
      host.appendChild(make('div.ed-label', { text: 'Brush size' }));
      host.appendChild(sizes);
      const list = make('div.ed-list');
      const none = make('div.ed-item');
      none.dataset.value = '0';
      none.setAttribute('aria-selected', String(!Number(st.tile)));
      none.appendChild(colorDot('#5a6478'));
      none.appendChild(make('span', { text: 'No terrain (hand painted)' }));
      none.onclick = () => { T.remember('terrain', 0); ED.set({ tile: 0 }); this.refresh(ED); };
      list.appendChild(none);
      for (const t of ed.state.project.terrains || []) {
        const item = make('div.ed-item');
        item.dataset.value = String(t.id);
        item.setAttribute('aria-selected', String(Number(st.tile) === t.id));
        item.appendChild(colorDot(t.color));
        const text = make('div.ed-item-text');
        text.appendChild(make('strong', { text: t.name }));
        text.appendChild(make('small.ed-hint', { text: t.base ? `base tile: ${t.base}` : 'no base tile yet' }));
        item.appendChild(text);
        item.appendChild(make('span.ed-badge', { text: String(t.id) }));
        item.onclick = () => { T.remember('terrain', t.id); ED.set({ tile: t.id }); this.refresh(ED); };
        list.appendChild(item);
      }
      host.appendChild(list);
      if (!(ed.state.project.terrains || []).length) host.appendChild(make('p.ed-hint', { text: 'No terrains yet — add one under “Terrains & autotiles”.' }));
      else host.appendChild(make('p.ed-hint', { text: 'Paint with a terrain and the autotile rules redraw the edges and corners around it.' }));
    },

    renderStamps(ed) {
      const body = this.stampSec.body;
      UI.clear(body);
      const stamps = (KIT.registry('tiles').stamps || []).slice();
      if (!stamps.length) { body.appendChild(make('p.ed-hint', { text: 'No stamps yet.' })); return; }
      const grid = make('div.ed-stamps');
      for (const s of stamps) {
        const b = make('button.ed-stamp');
        b.type = 'button';
        b.setAttribute('aria-selected', String(ed.state.stamp === s.id && ed.state.tool === 'stamp'));
        const w = Math.max.apply(null, s.tiles.map(r => r.length)), h = s.tiles.length;
        const grid2 = make('span.ed-stamp-art');
        grid2.style.gridTemplateColumns = `repeat(${w}, 1fr)`;
        grid2.style.width = `${Math.round(76 * w / Math.max(w, h))}px`;      // the tall ones must not balloon
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const cell = make('span.ed-stamp-cell');
          const id = s.tiles[y][x];
          if (id) cell.appendChild(tileCanvas(id, 2));
          grid2.appendChild(cell);
        }
        b.appendChild(grid2);
        b.appendChild(make('span.ed-stamp-name', { text: s.name || s.id }));
        b.onclick = () => {
          ED.set({ stamp: s.id, tool: 'stamp', layer: TILE_LAYERS.includes(ed.state.layer) ? ed.state.layer : 'deco' });
          this.refresh(ED);
        };
        grid.appendChild(b);
      }
      body.appendChild(grid);
      body.appendChild(make('p.ed-hint', { text: 'Pick one, then tap the map to drop the whole shape in one go.' }));
    },

    // ---- terrains + the autotile wizard -------------------------------------------
    renderAutotiles(ed) {
      const body = this.autoSec.body;
      UI.clear(body);
      const project = ed.state.project;
      const terrains = project.terrains || [];

      for (const t of terrains) {
        const row = make('div.ed-row.ed-terrain-row');
        const color = input('color', t.color, (v) => edit('Terrain colour', (doc) => doc.set(['terrains', terrains.indexOf(t), 'color'], v)));
        color.className = 'ed-colour';
        const name = input('text', t.name, (v) => edit('Rename terrain', (doc) => doc.set(['terrains', terrains.indexOf(t), 'name'], v || `Terrain ${t.id}`)));
        row.appendChild(color);
        row.appendChild(name);
        row.appendChild(make('span.ed-badge', { text: `#${t.id}` }));
        row.appendChild(button('Use', () => { T.remember('terrain', t.id); ED.set({ layer: 'terrain', tile: t.id }); this.refresh(ED); }));
        body.appendChild(row);
      }
      const addRow = make('div.ed-row');
      addRow.appendChild(button('+ Add terrain', () => {
        const id = terrains.reduce((m, t) => Math.max(m, t.id), 0) + 1;
        edit('Add terrain', (doc) => doc.push(['terrains'], { id, name: `Terrain ${id}`, color: T.regionColor(id), base: null }));
        T.remember('terrain', id);
        ED.set({ layer: 'terrain', tile: id });
        this.refresh(ED);
      }));
      body.appendChild(addRow);

      // the wizard
      body.appendChild(make('h4.ed-h4', { text: 'Fill this template with your tiles' }));
      body.appendChild(make('p.ed-hint', { text: 'Tap a slot, then tap a tile in the palette above. The middle one is the inside of the area; the eight around it are its edges and corners.' }));
      const w = this.wizard = this.wizard || { terrain: Number(ed.state.tile) || (terrains[0] && terrains[0].id) || 1, tiles: {}, layer: 'ground' };
      if (!terrains.some(t => t.id === w.terrain)) w.terrain = (terrains[0] && terrains[0].id) || 1;

      const pick = select(terrains.map(t => ({ value: t.id, label: `${t.name} (#${t.id})` })), w.terrain, (v) => { w.terrain = Number(v); this.renderAutotiles(ED); });
      body.appendChild(field('These tiles belong to', pick));

      const SLOTS = [['nw', '↖'], ['n', '↑'], ['ne', '↗'], ['w', '←'], ['center', 'middle'], ['e', '→'], ['sw', '↙'], ['s', '↓'], ['se', '↘']];
      const grid = make('div.ed-template');
      for (const [key, label] of SLOTS) grid.appendChild(this.slotButton(key, label, w));
      body.appendChild(grid);
      const inner = make('div.ed-template-inner');
      inner.appendChild(make('span.ed-hint', { text: 'Inside corners' }));
      for (const [key, label] of [['innerNW', '◤'], ['innerNE', '◥'], ['innerSW', '◣'], ['innerSE', '◢']]) inner.appendChild(this.slotButton(key, label, w));
      body.appendChild(inner);

      if (this.armed) body.appendChild(this.tilePicker(`Tap the tile for “${this.armed}”`));

      const actions = make('div.ed-row');
      actions.appendChild(button('Make the rules', () => this.buildRules(ed, w), 'primary'));
      actions.appendChild(button('Clear', () => { w.tiles = {}; this.armed = null; this.renderAutotiles(ED); this.renderPalette(ED); }));
      body.appendChild(actions);
      if (!w.tiles.center) body.appendChild(make('p.ed-hint', { text: 'At the very least fill the middle slot: that is the tile inside the area.' }));

      // the groups that exist, and which tiles they own
      const sets = project.autotiles || {};
      const setId = Object.keys(sets)[0] || 'default';
      const groups = (sets[setId] && sets[setId].groups) || [];
      body.appendChild(make('h4.ed-h4', { text: `Rule groups (${groups.length})` }));
      if (!groups.length) body.appendChild(make('p.ed-hint', { text: 'None yet. Fill the template above and press “Make the rules”.' }));
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const card = make('div.ed-card');
        const head = make('div.ed-row');
        const t = terrains.find(t => t.id === g.terrain);
        head.appendChild(colorDot(t ? t.color : '#888'));
        head.appendChild(make('strong', { text: g.name || g.id }));
        head.appendChild(make('span.ed-badge', { text: `${(g.rules || []).length} rule${(g.rules || []).length === 1 ? '' : 's'}` }));
        head.appendChild(make('span.ed-badge', { text: g.layer || 'ground' }));
        card.appendChild(head);
        const owned = Array.from(KIT.tiles.ownedTiles({ groups: [g] }, g.layer || 'ground'));
        const strip = make('div.ed-owned');
        for (const id of owned) {
          const s = make('span.ed-owned-tile');
          s.title = id;
          s.appendChild(tileCanvas(id, 2));
          strip.appendChild(s);
        }
        card.appendChild(strip);
        card.appendChild(make('p.ed-hint', { text: owned.length ? `Owns ${owned.length} tile${owned.length === 1 ? '' : 's'}: ${owned.join(', ')}` : 'Owns no tiles yet.' }));
        const row = make('div.ed-row');
        row.appendChild(button('Re-bake this map', () => this.rebake(ED)));
        row.appendChild(button('Delete', async () => {
          if (!(await ED.confirm(`Delete the rule group “${g.name || g.id}”?`))) return;
          edit('Delete rule group', (doc) => doc.splice(['autotiles', setId, 'groups'], i, 1, []));
          this.renderAutotiles(ED);
        }, 'danger'));
        card.appendChild(row);
        body.appendChild(card);
      }
    },

    slotButton(key, label, w) {
      const b = make('button.ed-tslot');
      b.type = 'button';
      b.title = key;
      if (this.armed === key) b.classList.add('is-armed');
      if (w.tiles[key]) b.appendChild(tileCanvas(w.tiles[key], 2));
      else b.appendChild(make('span.ed-tslot-label', { text: label }));
      b.onclick = () => {
        this.armed = this.armed === key ? null : key;
        this.renderAutotiles(ED);
        this.renderPalette(ED);
        if (this.armed) ED.toast(`Now tap the tile for “${key}”`);
      };
      return b;
    },
    /** A small palette that lives inside the wizard, so a slot can be filled from any layer. */
    tilePicker(title) {
      const box = make('div.ed-picker');
      box.appendChild(make('p.ed-hint.ed-armed', { text: title }));
      const search = make('input');
      search.type = 'search';
      search.placeholder = 'Search tiles by name…';
      const grid = make('div.ed-swatches.ed-picker-grid');
      const fill = () => {
        UI.clear(grid);
        const q = search.value.trim().toLowerCase();
        const all = KIT.registry('tiles').list().filter(t => !q || (`${t.name || ''} ${t.id}`).toLowerCase().includes(q));
        for (const t of all.slice(0, 200)) grid.appendChild(swatchButton(t.id, false, () => this.assignTemplate(t.id), t.name || t.id));
      };
      search.oninput = fill;
      fill();
      box.appendChild(search);
      box.appendChild(grid);
      box.appendChild(button('Nothing here', () => this.assignTemplate(null)));
      return box;
    },
    assignTemplate(id) {
      const w = this.wizard;
      if (!w) return;
      if (id == null) delete w.tiles[this.armed]; else w.tiles[this.armed] = id;
      this.armed = null;
      this.renderAutotiles(ED);
      this.renderPalette(ED);
    },
    buildRules(ed, w) {
      const tiles = {};
      for (const k of Object.keys(w.tiles)) if (w.tiles[k]) tiles[k] = w.tiles[k];
      if (!Object.keys(tiles).length) { ED.toast('Fill at least one slot first'); return; }
      const terrains = ed.state.project.terrains || [];
      const t = terrains.find(t => t.id === w.terrain);
      const group = KIT.tiles.rulesFromTemplate({
        groupId: `terrain-${w.terrain}`, terrain: w.terrain, name: t ? `${t.name} edges` : `Terrain ${w.terrain} edges`,
        tiles, layer: w.layer || 'ground',
      });
      const sets = ed.state.project.autotiles || {};
      const setId = Object.keys(sets)[0] || 'default';
      const groups = (sets[setId] && sets[setId].groups) || [];
      const at = groups.findIndex(g => g.id === group.id);
      edit('Autotile rules from template', (doc) => {
        if (!doc.get(['autotiles', setId])) doc.set(['autotiles', setId], { source: 'terrain', groups: [] });
        if (at >= 0) doc.splice(['autotiles', setId, 'groups'], at, 1, [group]);
        else doc.push(['autotiles', setId, 'groups'], group);
        if (tiles.center && t && !t.base) doc.set(['terrains', terrains.indexOf(t), 'base'], tiles.center);
      });
      ED.toast(`${group.rules.length} rules made. Paint with terrain #${w.terrain} to see them.`);
      this.renderAutotiles(ED);
    },
    /** Run the autotiles over the whole map again (one undo step). */
    rebake(ed) {
      const st = ed.state;
      const cells = [];
      for (let y = 0; y < st.map.height; y++) for (let x = 0; x < st.map.width; x++) cells.push({ x, y });
      let n = 0;
      edit('Re-bake autotiles', (doc, ops) => {
        const m = doc.get(['maps', st.mapId]);
        const painted = cells.filter(c => m.layers.terrain[c.y * m.width + c.x]);
        if (!painted.length) return 0;
        n = ops.terrain(doc, { map: st.mapId, cells: painted, terrain: undefined, label: 'Re-bake autotiles' });
        return n;
      });
      ED.toast('The autotiles ran over this map again.');
    },
  };

  // =============================================================================
  // The Map panel
  // =============================================================================
  const mapPanel = {
    id: 'map', label: 'Map', icon: 'map', order: 45,

    mount(host, ed) {
      this.host = host;
      UI.clear(host);

      // Name, Kind, Music and Note are one inspector form — the same widgets, the same
      // "back to the default" control and the same look as an Event's fields.
      this.problems = make('div.ed-obj-problems');
      host.appendChild(this.problems);
      const formHost = make('div');
      host.appendChild(formHost);
      this.form = this.buildForm(formHost);

      // size
      const sizeRow = make('div.ed-row');
      this.wInput = input('number', '', () => this.previewResize(ED));
      this.hInput = input('number', '', () => this.previewResize(ED));
      this.wInput.min = 1; this.hInput.min = 1; this.wInput.max = 512; this.hInput.max = 512;
      this.wInput.oninput = this.hInput.oninput = () => this.previewResize(ED);
      const wf = field('Width', this.wInput), hf = field('Height', this.hInput);
      wf.className = 'ed-field ed-half'; hf.className = 'ed-field ed-half';
      sizeRow.appendChild(wf); sizeRow.appendChild(hf);
      host.appendChild(sizeRow);
      this.resizeWarn = make('p.ed-hint');
      host.appendChild(this.resizeWarn);
      this.resizeBtn = button('Resize the map', () => this.doResize(ED));
      host.appendChild(el('div.ed-row', {}, [this.resizeBtn]));

      this.propsSec = section('Encounters & props');
      host.appendChild(this.propsSec);

      this.connSec = section('Maps next door', true);
      host.appendChild(this.connSec);

      const startRow = make('div.ed-row');
      startRow.appendChild(button('Set the start here', () => {
        const at = { x: ED.state.cursor.x, y: ED.state.cursor.y };
        edit('Move the start', (doc) => { doc.set(['start', 'map'], ED.state.mapId); doc.set(['start', 'x'], at.x); doc.set(['start', 'y'], at.y); });
        ED.toast(`The game now starts on ${ED.state.map.map.name || ED.state.mapId} at ${at.x}, ${at.y}`);
        this.refresh(ED);
      }, 'primary'));
      host.appendChild(startRow);
      this.startLine = make('p.ed-hint');
      host.appendChild(this.startLine);

      const mapActions = make('div.ed-row');
      mapActions.appendChild(button('+ New map', () => this.newMap(ED, false)));
      mapActions.appendChild(button('+ Copy of this one', () => this.newMap(ED, true)));
      mapActions.appendChild(button('Delete this map', () => this.deleteMap(ED), 'danger'));
      host.appendChild(mapActions);

      this.worldSec = section('Every map in the world', true);
      host.appendChild(this.worldSec);

      this.refresh(ed);
    },

    refresh(ed) {
      if (!this.host || this.host.hidden) return;
      const st = ed.state;
      const m = st.project.maps[st.mapId];
      if (!m) return;
      if (this.form) this.form.refresh(this.formValue(m));
      this.renderProblems(ed);
      sync(this.wInput, m.width);
      sync(this.hInput, m.height);
      this.previewResize(ed);
      const start = st.project.start || {};
      this.startLine.textContent = start.map === st.mapId
        ? `The game starts on this map at ${start.x}, ${start.y}. The cursor is at ${st.cursor.x}, ${st.cursor.y}.`
        : `The game starts on “${(st.project.maps[start.map] || {}).name || start.map}”. The cursor is at ${st.cursor.x}, ${st.cursor.y}.`;
      this.renderProps(ed);
      this.renderConnections(ed);
      this.renderWorld(ed);
    },

    // ---- name, kind, music, note (KIT.editor.inspector) -----------------------
    formValue(m) { return { name: m.name || '', kind: m.kind, music: m.music || '', note: m.note || '' }; },
    buildForm(hostEl) {
      const INS = ED.inspector;
      const st = ED.state;
      const m = st.project.maps[st.mapId] || {};
      const musicIds = KIT.registry.exists('music') ? KIT.registry('music').ids() : [];
      const fields = [
        { key: 'name', type: 'string', label: 'Name', doc: 'What this place is called — the name in the map list and in a Transfer.' },
        { key: 'kind', type: 'enum', label: 'Kind', options: (P.MAP_KINDS || ['outdoor']).map(k => ({ value: k, label: titleCase(k) })),
          doc: 'Outdoor, indoor, cave or garden — it picks the ground a new square starts with.' },
        { key: 'music', type: 'enum', label: 'Music', default: '', options: [{ value: '', label: 'No music' }].concat(musicIds.map(i => ({ value: i, label: i }))),
          doc: 'Plays while the hero is on this map.' },
        { key: 'note', type: 'note', label: 'Note', default: '', doc: 'For you, not the player — what happens here, what is missing.' },
      ];
      return INS.mount(hostEl, {
        fields,
        value: this.formValue(m),
        ctx: { project: st.project, map: m, mapId: st.mapId },
        onChange: (path, v) => {
          const id = ED.state.mapId;
          if (path[0] === 'name') edit('Rename map', (doc, ops) => ops.renameMap(doc, { map: id, name: v || id }));
          else if (path[0] === 'kind') edit('Change map kind', (doc) => doc.set(['maps', id, 'kind'], v));
          else if (path[0] === 'music') edit('Change music', (doc) => doc.set(['maps', id, 'music'], v || null));
          else if (path[0] === 'note') edit('Edit note', (doc) => doc.set(['maps', id, 'note'], v || ''));
        },
      });
    },
    /** Whatever the validator says about this map, at the top where it is read. */
    renderProblems(ed) {
      if (!this.problems) return;
      UI.clear(this.problems);
      const list = ED.problemsFor({ kind: 'map', id: ed.state.mapId }) || [];
      for (const p of list.slice(0, 6)) {
        this.problems.appendChild(make('div.ed-problem' + (p.severity === 'warn' ? '.warn' : ''), { text: p.message }));
      }
    },

    // ---- size ---------------------------------------------------------------
    previewResize(ed) {
      const st = ed.state;
      const m = st.project.maps[st.mapId];
      if (!m || !this.resizeWarn) return;
      const w = Math.max(1, parseInt(this.wInput.value, 10) || m.width);
      const h = Math.max(1, parseInt(this.hInput.value, 10) || m.height);
      if (w === m.width && h === m.height) {
        this.resizeWarn.textContent = `${m.width} × ${m.height} squares.`;
        this.resizeWarn.className = 'ed-hint';
        this.resizeBtn.disabled = true;
        return;
      }
      this.resizeBtn.disabled = false;
      const lostCols = Math.max(0, m.width - w), lostRows = Math.max(0, m.height - h);
      const lostObjects = (m.objects || []).filter(o => o.x >= w || o.y >= h);
      if (!lostCols && !lostRows) {
        this.resizeWarn.className = 'ed-hint ed-ok';
        this.resizeWarn.textContent = `Growing to ${w} × ${h}. New squares start empty; nothing is lost.`;
      } else {
        this.resizeWarn.className = 'ed-hint ed-warn';
        const bits = [];
        if (lostCols) bits.push(`${lostCols} column${lostCols === 1 ? '' : 's'} on the right`);
        if (lostRows) bits.push(`${lostRows} row${lostRows === 1 ? '' : 's'} at the bottom`);
        let text = `Careful: ${bits.join(' and ')} will be cut off, with everything painted there.`;
        if (lostObjects.length) text += ` ${lostObjects.length} event${lostObjects.length === 1 ? '' : 's'} would end up outside the map (${lostObjects.map(o => o.name || o.id).join(', ')}).`;
        text += ' Undo puts it all back.';
        this.resizeWarn.textContent = text;
      }
    },
    doResize(ed) {
      const st = ed.state;
      const m = st.project.maps[st.mapId];
      const w = Math.max(1, parseInt(this.wInput.value, 10) || m.width);
      const h = Math.max(1, parseInt(this.hInput.value, 10) || m.height);
      if (w === m.width && h === m.height) return;
      edit('Resize map', (doc, ops) => ops.resizeMap(doc, { map: st.mapId, width: w, height: h }));
      ED.toast(`This map is now ${w} × ${h}.`);
      this.refresh(ED);
    },

    // ---- props / encounters ----------------------------------------------------
    renderProps(ed) {
      const st = ed.state;
      const m = st.project.maps[st.mapId];
      const body = this.propsSec.body;
      const props = m.props || {};
      const keys = Object.keys(props);
      const encounters = ((st.project.packs && st.project.packs.mons && st.project.packs.mons.encounters) || {})[st.mapId];
      this.propsSec.hidden = !keys.length && !encounters;
      if (this.propsSec.hidden) return;
      UI.clear(body);
      if (encounters && Array.isArray(encounters.table)) {
        body.appendChild(make('h4.ed-h4', { text: 'Wild encounters' }));
        const table = make('div.ed-list');
        encounters.table.forEach((row, i) => {
          const item = make('div.ed-item');
          item.appendChild(make('strong', { text: String(row.mon || row.id || '?') }));
          const lvl = input('text', row.level == null ? '' : String(row.level), (v) => edit('Encounter level', (doc) => doc.set(['packs', 'mons', 'encounters', st.mapId, 'table', i, 'level'], v)));
          lvl.className = 'ed-small-input';
          item.appendChild(lvl);
          const weight = input('number', row.weight == null ? 1 : row.weight, (v) => edit('Encounter weight', (doc) => doc.set(['packs', 'mons', 'encounters', st.mapId, 'table', i, 'weight'], Number(v) || 0)));
          weight.className = 'ed-small-input';
          item.appendChild(weight);
          table.appendChild(item);
        });
        body.appendChild(table);
        body.appendChild(make('p.ed-hint', { text: 'Level and how often it turns up, compared with the others.' }));
      }
      for (const k of keys) {
        const v = props[k];
        if (v && typeof v === 'object') {
          body.appendChild(field(k, make('span.ed-hint', { text: JSON.stringify(v).slice(0, 120) })));
          continue;
        }
        if (typeof v === 'boolean') {
          const box = make('input');
          box.type = 'checkbox';
          box.checked = v;
          box.onchange = () => edit(`Set ${k}`, (doc) => doc.set(['maps', st.mapId, 'props', k], box.checked));
          body.appendChild(field(k, box));
        } else {
          body.appendChild(field(k, input(typeof v === 'number' ? 'number' : 'text', v, (val) => {
            edit(`Set ${k}`, (doc) => doc.set(['maps', st.mapId, 'props', k], typeof v === 'number' ? Number(val) : val));
          })));
        }
      }
    },

    // ---- connections -------------------------------------------------------------
    renderConnections(ed) {
      const st = ed.state;
      const body = this.connSec.body;
      UI.clear(body);
      const project = st.project;
      const conns = (project.world && project.world.connections) || [];
      const mine = [];
      conns.forEach((c, i) => { if (c.a === st.mapId || c.b === st.mapId) mine.push({ c, i }); });

      if (!mine.length) body.appendChild(make('p.ed-hint', { text: 'No doors to another map yet. Add one and the hero can walk straight off this edge onto the next map.' }));
      for (const { c, i } of mine) {
        const card = make('div.ed-card');
        const mineSide = c.a === st.mapId ? c.side : opposite(c.side);
        const otherId = c.a === st.mapId ? c.b : c.a;
        const other = project.maps[otherId];
        const head = make('div.ed-row');
        head.appendChild(make('strong', { text: `${sideLabel(mineSide)} → ${(other && other.name) || otherId}` }));
        card.appendChild(head);

        const offRow = make('div.ed-row');
        const off = input('number', c.offset || 0, (v) => edit('Line up the maps', (doc) => doc.set(['world', 'connections', i, 'offset'], parseInt(v, 10) || 0)));
        off.className = 'ed-small-input';
        offRow.appendChild(make('span', { text: 'Slide the neighbour' }));
        offRow.appendChild(off);
        offRow.appendChild(button('Open it', () => ED.openMap(otherId)));
        offRow.appendChild(button('Remove', async () => {
          if (!(await ED.confirm(`Remove the way from here to “${(other && other.name) || otherId}”?`))) return;
          edit('Remove connection', (doc) => doc.splice(['world', 'connections'], i, 1, []));
          this.refresh(ED);
        }, 'danger'));
        card.appendChild(offRow);

        const report = walkCheck(project, st.mapId, mineSide);
        const line = make('p.ed-hint');
        if (!report.total) { line.textContent = 'These two edges do not overlap at all — try sliding the neighbour.'; line.className = 'ed-hint ed-warn'; }
        else if (report.ok === report.total) { line.textContent = `All ${report.total} squares along this edge are walkable on both sides.`; line.className = 'ed-hint ed-ok'; }
        else if (report.ok === 0) { line.textContent = `None of the ${report.total} squares along this edge are walkable on both sides — the hero cannot cross yet.`; line.className = 'ed-hint ed-warn'; }
        else { line.textContent = `${report.ok} of ${report.total} squares are walkable on both sides (${report.blockedHere} blocked here, ${report.blockedThere} blocked there).`; line.className = 'ed-hint ed-warn'; }
        card.appendChild(line);
        body.appendChild(card);
      }

      const others = Object.keys(project.maps).filter(id => id !== st.mapId);
      if (!others.length) return;
      const addRow = make('div.ed-row');
      const sideSel = select(SIDES.map(s => ({ value: s.id, label: s.label })), 's', () => {});
      const mapSel = select(others.map(id => ({ value: id, label: project.maps[id].name || id })), others[0], () => {});
      addRow.appendChild(sideSel);
      addRow.appendChild(mapSel);
      addRow.appendChild(button('Add a way through', () => {
        edit('Connect maps', (doc) => doc.push(['world', 'connections'], { a: ED.state.mapId, side: sideSel.value, b: mapSel.value, offset: 0 }));
        this.refresh(ED);
      }));
      body.appendChild(make('h4.ed-h4', { text: 'Add a way through' }));
      body.appendChild(addRow);
      body.appendChild(make('p.ed-hint', { text: 'Pick an edge of this map and the map on the other side of it.' }));
    },

    // ---- new / copy / delete ---------------------------------------------------------
    newMap(ed, copy) {
      const st = ed.state;
      const src = st.project.maps[st.mapId];
      const base = copy ? `${src.name} copy` : 'New map';
      let id = KIT.slug(base), n = 2;
      while (st.project.maps[id]) id = `${KIT.slug(base)}-${n++}`;
      const layout = (st.project.world && st.project.world.maps && st.project.world.maps[st.mapId]) || { x: 0, y: 0, folder: '' };
      if (copy) {
        const clone = KIT.deepClone(src);
        clone.id = id;
        clone.name = `${src.name} copy`;
        edit('Copy map', (doc) => {
          doc.set(['maps', id], clone);
          doc.set(['world', 'maps', id], { x: (layout.x || 0) + 1, y: layout.y || 0, folder: layout.folder || '' });
        });
      } else {
        edit('New map', (doc, ops) => ops.newMap(doc, { id, name: 'New map', width: src.width, height: src.height, kind: src.kind, wx: (layout.x || 0) + 1, wy: layout.y || 0, folder: layout.folder || '' }));
      }
      ED.openMap(id);
      ED.toast(copy ? 'Copied. You are on the copy now.' : 'A new map. You are on it now.');
    },
    async deleteMap(ed) {
      const st = ed.state;
      const ids = Object.keys(st.project.maps);
      if (ids.length <= 1) { ED.toast('This is the only map — a game needs one.'); return; }
      const m = st.project.maps[st.mapId];
      const events = (m.objects || []).length;
      if (!(await ED.confirm(`Delete “${m.name}”, its ${events} event${events === 1 ? '' : 's'} and everything painted on it? Undo can bring it back.`))) return;
      const gone = st.mapId;
      const next = ids.find(id => id !== gone);
      edit('Delete map', (doc, ops) => {
        ops.deleteMap(doc, { map: gone });
        const conns = (doc.get(['world', 'connections']) || []).slice();
        for (let i = conns.length - 1; i >= 0; i--) if (conns[i].a === gone || conns[i].b === gone) doc.splice(['world', 'connections'], i, 1, []);
        if (doc.get(['start', 'map']) === gone) doc.set(['start', 'map'], next);
      });
      ED.openMap(next);
      ED.toast(`“${m.name}” is gone. Ctrl+Z brings it back.`);
    },

    // ---- the world --------------------------------------------------------------------
    renderWorld(ed) {
      const st = ed.state;
      const body = this.worldSec.body;
      UI.clear(body);
      const project = st.project;
      const ids = Object.keys(project.maps);
      const byFolder = new Map();
      for (const id of ids) {
        const folder = ((project.world && project.world.maps && project.world.maps[id]) || {}).folder || '';
        if (!byFolder.has(folder)) byFolder.set(folder, []);
        byFolder.get(folder).push(id);
      }
      for (const [folder, list] of byFolder) {
        if (folder) body.appendChild(make('h4.ed-h4', { text: folder }));
        const grid = make('div.ed-cards');
        for (const id of list) {
          const m = project.maps[id];
          const card = make('button.ed-mapcard');
          card.type = 'button';
          card.setAttribute('aria-selected', String(id === st.mapId));
          card.appendChild(make('strong', { text: m.name || id }));
          const bits = make('span.ed-mapcard-bits');
          bits.appendChild(make('span.ed-badge', { text: `${m.width} × ${m.height}` }));
          bits.appendChild(make('span.ed-badge', { text: `${(m.objects || []).length} events` }));
          bits.appendChild(make('span.ed-badge', { text: m.kind }));
          if (project.start && project.start.map === id) bits.appendChild(make('span.ed-badge.ed-start', { text: '★ start' }));
          card.appendChild(bits);
          card.onclick = () => { ED.openMap(id); this.refresh(ED); };
          grid.appendChild(card);
        }
        body.appendChild(grid);
      }
      body.appendChild(make('p.ed-hint', { text: 'Tap a card to open that map.' }));
    },
  };

  // ---- helpers shared by the two panels ---------------------------------------------
  /** Does this brush value belong on that layer? (['] and [[] switch layers behind our back.) */
  function fitsLayer(value, layer) {
    if (layer === 'terrain' || layer === 'regions') return typeof value === 'number';
    if (layer === 'collision') return T.COLLISION.some(c => T.sameValue(c.value, value));
    return value == null || typeof value === 'string';
  }

  function titleCase(s) { return String(s || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
  function opposite(side) { return { n: 's', s: 'n', e: 'w', w: 'e' }[side] || side; }
  function sideLabel(side) { return (SIDES.find(s => s.id === side) || { label: side }).label; }

  /**
   * walkCheck(project, mapId, side) -> { total, ok, blockedHere, blockedThere }
   * Walks the shared edge with the real map view, so the answer is exactly what the
   * game will do when the hero tries to step across.
   */
  function walkCheck(project, mapId, side) {
    const out = { total: 0, ok: 0, blockedHere: 0, blockedThere: 0 };
    let view;
    try { view = KIT.mapView(project, null, mapId); } catch (e) { return out; }
    const dir = SIDE_DIR[side];
    const cells = [];
    if (side === 'n' || side === 's') {
      const y = side === 'n' ? 0 : view.height - 1;
      for (let x = 0; x < view.width; x++) cells.push({ x, y });
    } else {
      const x = side === 'w' ? 0 : view.width - 1;
      for (let y = 0; y < view.height; y++) cells.push({ x, y });
    }
    const otherViews = new Map();
    for (const c of cells) {
      const conn = view.connectionAt(c.x, c.y, dir);
      if (!conn) continue;
      out.total++;
      let there = otherViews.get(conn.map);
      if (!there) { try { there = KIT.mapView(project, null, conn.map); } catch (e) { continue; } otherViews.set(conn.map, there); }
      const here = !view.flagsAt(c.x, c.y).solid;
      const far = !there.flagsAt(conn.x, conn.y).solid;
      if (here && far) out.ok++;
      if (!here) out.blockedHere++;
      if (!far) out.blockedThere++;
    }
    return out;
  }
  ED.walkCheck = walkCheck;

  KIT.registry('editorPanels').add(Object.assign({ replace: true }, tilesPanel));
  KIT.registry('editorPanels').add(Object.assign({ replace: true }, mapPanel));

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
