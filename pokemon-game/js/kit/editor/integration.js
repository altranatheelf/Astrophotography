// Creator Mode — the joins between the shell, the panels and the running game.
//
// What lives here rather than in the shell (js/kit/editor/editor.js):
//
//   Delete              with a page selected, deletes the event the page belongs to
//   play mode           Escape (and a visible bar) come back to editing
//   ED.close()          hands the player back to the game, not to the title
//   re-open             the panels the shell mounted are kept across close/open
//   ED.fitMap()         a map opens at a zoom that shows all of it
//   the tab strip       the four groups and their chips
//
// Nothing here writes to the project: it only moves the author between the game
// and Creator Mode, and keeps the panels in step.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const UI = KIT.ui;
  if (typeof document === 'undefined' || !UI) return;                 // headless: nothing to join

  // ---- 1. Delete with a page selected ------------------------------------------------
  // Tapping a page tab in the Events panel selects `{ kind:'page', id }`; the shell's
  // deleteSelection only knows `object`, so the Delete key (and the panel's 🗑,
  // which asks the shell) did nothing until the event was picked again. A page
  // names its event: delete that.
  const deleteSelection = ED.deleteSelection;
  ED.deleteSelection = function () {
    const s = ED.state.selection;
    if (s && s.kind === 'page' && s.map && s.id) ED.select({ kind: 'object', map: s.map, id: s.id });
    return deleteSelection.call(ED);
  };

  // ---- 2. play mode: a way back ------------------------------------------------------
  // playHere() hides the editor's middle, but the host is opaque and the shell's key
  // handler is off in play mode — so without this the game is invisible and Escape is
  // the pause menu. The bar is a real button because a keyboard is not a given.
  let playBar = null;
  /** The bar floats over the top of the page, so the game steps down out from under it. */
  function markPlaying(on) {
    if (ED.el && ED.el.host) ED.el.host.classList.toggle('is-playing', on);
    const app = document.getElementById('app');
    if (app) app.classList.toggle('ed-playing', on);
  }
  function buildPlayBar() {
    // Every open rebuilds the shell's DOM, so a bar from the last open is a detached
    // element: forget it, or the second time round Play here has no way back on a phone.
    if (playBar && !playBar.isConnected) playBar = null;
    if (playBar || !ED.el || !ED.el.root) return;
    playBar = UI.make('div.ed-playbar');
    const back = UI.make('button.ed-btn.primary', { text: '‹ Back to Creator Mode' });
    back.type = 'button';
    back.onclick = () => ED.backToEdit();
    playBar.appendChild(back);
    if (!(KIT.input && KIT.input.isTouch && KIT.input.isTouch())) playBar.appendChild(UI.make('span.ed-playbar-hint', { text: 'Escape' }));   // a phone has no Escape key
    ED.el.root.appendChild(playBar);
  }
  ED.on('mode', (mode) => {
    buildPlayBar();
    const playing = mode === 'play';
    markPlaying(playing);
    if (playBar) playBar.hidden = !playing;
    if (playing && KIT.game && KIT.game.resize) setTimeout(() => KIT.game.resize(), 0);
  });
  document.addEventListener('keydown', (ev) => {
    if (!ED.isOpen() || ED.state.mode !== 'play' || ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    ED.backToEdit();
  }, true);

  // Play here: start standing where the cursor is, not where a new game starts.
  // The shell warps after the new game has already entered the start map, which lands
  // the author in the intro instead of at their event; a test state puts the heroes on
  // the right square before the map is entered. If the author was playing when they
  // opened Creator Mode, their switches and bag come along, so an event can be tested
  // with the story as far as they have taken it.
  const playHere = ED.playHere;
  ED.playHere = function (opts) {
    const o = Object.assign({}, opts || {});
    const at = o.at || ED.playStart();
    const save = (KIT.game && KIT.game._editorReturn && KIT.game._editorReturn.save) || null;
    o.testState = Object.assign({
      map: ED.state.mapId, x: at.x, y: at.y, dir: 'down',
      vars: save ? KIT.deepClone(save.vars || {}) : {},
      inventory: save ? KIT.deepClone(save.inventory || {}) : {},
      modules: save ? KIT.deepClone(save.modules || {}) : {},
    }, o.testState || {});
    // The shell warps to the cursor *after* the new game has entered the start map,
    // which would enter the map (and run its On Enter scripts) a second time. The test
    // state has already put the heroes there, so the warp has nothing left to do.
    const game = KIT.game;
    const warp = game && game.warp;
    if (game) game.warp = () => Promise.resolve();
    const done = playHere.call(ED, o);
    return Promise.resolve(done).finally(() => { if (game && warp) game.warp = warp; });
  };

  // Coming back from a test run: stop the story, silence the music, keep the draft.
  const backToEdit = ED.backToEdit;
  ED.backToEdit = function () {
    try { if (KIT.scenes) KIT.scenes.clear(); } catch (e) { /* nothing was open */ }
    try { if (KIT.fx) KIT.fx.reset(); } catch (e) { /* ditto */ }
    try { if (KIT.audio) KIT.audio.music(null, { fade: 150 }); } catch (e) { /* ditto */ }
    if (KIT.game) KIT.game.world = null;
    backToEdit.call(ED);
    markPlaying(false);
    if (playBar) playBar.hidden = true;
    ED.toast('Back in Creator Mode');
  };

  // ---- 3. open / close ------------------------------------------------------------------
  // The shell leaves the host visible on close (an opaque panel over the game) and
  // forgets that its panels are already mounted, so a second open shows empty tabs.
  // Keep the mounted bodies aside and put them back.
  let parked = null;

  const open = ED.open;
  ED.open = function (opts) {
    if (ED.isOpen()) return ED;
    const out = open.call(ED, opts || {});
    if (ED.el && ED.el.host) ED.el.host.hidden = false;
    markPlaying(false);
    if (parked && ED.el && ED.el.panel) {
      for (const body of parked) if (body.dataset.panel) ED.el.panel.appendChild(body);
      parked = null;
      if (ED.refreshPanels) ED.refreshPanels();
    }
    ED.set({ panel: ED.state.panel });
    return out;
  };

  const close = ED.close;
  ED.close = async function () {
    if (!ED.isOpen()) return;
    if (ED.state.mode === 'play') ED.backToEdit();
    const game = KIT.game;
    const resume = game && game._editorReturn;
    const toTitle = game && game.toTitle;
    // The shell drops the player at the title screen; we are going to put them back
    // exactly where they were, so hold the title off while it runs.
    if (game && resume) game.toTitle = function () {};
    try { await close.call(ED); }
    finally { if (game && toTitle) game.toTitle = toTitle; }
    parked = ED.el && ED.el.panel ? Array.from(ED.el.panel.children) : null;
    if (ED.el && ED.el.host) ED.el.host.hidden = true;
    markPlaying(false);
    if (game && resume && game.resumeFromEditor) await game.resumeFromEditor(ED.state.project);
  };

  // ---- 4. "you can see the whole map" ------------------------------------------------
  // The renderer picks its own zoom from the canvas size, which on a phone shows eight
  // squares of a twelve-square map. When a map opens, start at a zoom that fits it.
  ED.fitMap = function () {
    const st = ED.state;
    const stage = ED.el && ED.el.stage;
    if (!stage || !st.map) return;
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scale = ED.tools.fitScale({
      stageW: box.width, stageH: box.height,
      mapW: st.map.width, mapH: st.map.height,
      tileSize: (st.project.settings && st.project.settings.tileSize) || 16,
      minTile: box.width < 640 ? 32 : 0,          // a thumb needs a bigger square than a mouse
    });
    ED.set({ view: { x: 0, y: 0 } });
    if (ED.tools && ED.tools.lockScale) ED.tools.lockScale(scale);
    else ED.set({ view: { scale } });
    // A margin round a map smaller than the stage, so the edge squares are not against
    // the frame. Two squares is as far as the shell lets the camera go.
    const px = ED.tilePixels();
    const margin = (span, tiles) => -Math.min(2, Math.max(0, Math.floor((span / px - tiles) / 2)));
    ED.set({ view: { x: margin(box.width, st.map.width), y: margin(box.height, st.map.height) } });
  };
  let fitQueued = false;
  function fitSoon() {
    if (fitQueued) return;
    fitQueued = true;
    setTimeout(() => { fitQueued = false; ED.fitMap(); }, 60);
  }
  ED.on('change', (patch) => { if (patch && (patch.open || patch.mapId)) fitSoon(); });

  // ---- 5. the tab strip ------------------------------------------------------------------
  // Fourteen panels do not fit across a phone. The strip scrolls; this keeps the tab
  // you are on in view after every change, so it never scrolls off on its own.
  function showActiveTab() {
    const bar = ED.el && ED.el.tabs;
    if (!bar || !bar.scrollTo) return;
    const on = bar.querySelector('.ed-tab[aria-selected="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  ED.on('change', (patch) => { if (patch && patch.panel) setTimeout(showActiveTab, 0); });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
