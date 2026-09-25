# Creator Mode — the contract

Creator Mode is a set of registered panels and tools around one document. It has
no privileged code: a module can add a panel or a tool the same way the kit does.

## The shell (`js/kit/editor/editor.js`, written)

```js
KIT.editor.open({ game, project, mapId })   // starts editing; builds the document, mounts the UI
KIT.editor.close()                          // back to the game (the draft is saved)
KIT.editor.isOpen()
const ed = KIT.editor.state               // the live editor state (read it, change it through the calls below)
```

`ed` (frozen shape, mutated only through the calls):
```js
{
  doc,                 // KIT.document over the project — every edit goes through it
  project,             // doc.value, for convenience
  mapId,               // the map being edited
  map,                 // KIT.mapView(project, null, mapId), rebuilt when the document changes
  mode: 'edit'|'play', // the mode strip shows this; play runs the real game from the cursor
  tool: 'pencil',      // id in the editorTools registry
  layer: 'ground',     // terrain | ground | deco | above | regions | collision
  tile: 'grass',       // the painting value (a tile id, a terrain number, a region number)
  stamp: null,         // a multi-tile brush id, when the palette picked one
  selection: null,     // see below
  cursor: { x, y },    // tile under the pointer
  view: { x, y, scale },   // camera in tiles + zoom (integer 1..8)
  show: { grid, collision, regions, terrain, objects, labels },
  panel: 'tiles',      // the open side panel id
  sheet: 'auto',       // phone: the panel sheet is short under Map, tall elsewhere; the grip sets short | tall
  problems: [],        // KIT.project.validate output, refreshed on commit
  dirty, saving, lastSaved,
}
```

Selection:
```js
{ kind: 'object', map, id }                       // an object on a map
{ kind: 'page', map, id, page }                   // one of its pages
{ kind: 'script', path: ['scripts','meet-mom'] }  // a common event
{ kind: 'slot', map, id, page, slot }             // a page's script slot
{ kind: 'map', id } | { kind: 'project' } | { kind: 'fragment', id } | { kind: 'item', id } | { kind: 'var', name } | { kind: 'rule', id }
```

Calls every panel and tool uses:
```js
KIT.editor.set(patch)              // shallow-merge into the state and repaint (tool, layer, tile, show, panel, ...)
KIT.editor.select(selection|null)  // change the selection (panels follow it)
KIT.editor.openMap(id)
KIT.editor.on(event, fn) -> off    // 'change' (state), 'document' (ops), 'selection', 'problems', 'mode'
KIT.editor.refresh()               // rebuild the map view + repaint
KIT.editor.repaint()               // canvas only
KIT.editor.ops                     // js/kit/editor/ops.js — every edit (paint, objects, pages, maps, scripts…)
KIT.editor.commit(label, fn)       // doc.transaction + validate + autosave
KIT.editor.problemsFor(selection)  // the problems that belong to a thing
KIT.editor.toast(text) / KIT.editor.confirm(text) -> Promise<bool>
KIT.editor.el                      // { host, root, toolbar, main, stage, canvas, overlay, side, groups, tabs, panel, status } DOM
KIT.editor.previewWorld()          // a world-shaped object the renderer can draw (map + object entities, no play)
```

## Panels (`editorPanels` registry)
```js
KIT.registry('editorPanels').add({
  id: 'tiles', label: 'Tiles', icon: 'grid', order: 10,
  section: 'map',          // which group it sits under: map | story | game | problems (default game)
  tool: 'pencil',          // optional: the tool this panel is for; opening the panel picks it up
  tools: ['pencil', 'fill'],   // unless the active tool is one of these (default: just `tool`)
  mount(el, ed) {},        // build the DOM once, inside `el`
  refresh(ed) {},          // called on change/selection/document events while visible
  onSelect(sel, ed) {},    // optional: the selection changed
  visible(ed) { return true },   // optional
})
```
Panels are chips under one of four groups across the top of the side panel (a
bottom sheet on phones): **Map** for what is on the open map, **Story** for
scripts and the people in them, **Game** for the project as a whole, and
**Problems**. `section` picks the group; a panel that names none lands in Game,
and a group with a single panel hides its chip row and opens that panel when
tapped. `KIT.editor.groups()`, `groupOf(id)` and `panelsOf(group)` read the same
arrangement, and `KIT.editor.el.groups` is the row. Panels must work at 390px
wide, use `KIT.ui` helpers for consistency, and never write to the project
except through `KIT.editor.ops` or `KIT.editor.commit`.

## Importers (`importers` registry)
```js
KIT.registry('importers').add({
  id: 'essentials', label: 'Pokémon Essentials PBS', order: 20,
  detect(files) {},       // [{ name, text?, bytes? }] -> { kind, main, label } | null
  run(found, opts) {},    // -> a Result (docs/IMPORT-CONTRACT.md)
});
```
The Import panel and `tools/import.js` ask this registry **before** their own
guesses, so a module can bring a whole toolchain's files with it and the engine
never learns what they are (ADR-0005). A Result may carry `packs[key]`, which is
merged into `project.packs[key]` — that is how an importer fills a module's own
content, and `content.register(pack, project)` on the module's manifest puts it
wherever that module keeps it.

## Tools (`editorTools` registry)
```js
KIT.registry('editorTools').add({
  id: 'pencil', label: 'Pencil', icon: 'pencil', key: '1', order: 10,
  layers: ['terrain','ground','deco','above','regions','collision'],  // where it applies (default: all)
  begin(pt, ed) {},        // pt = { x, y, tx, ty, shift, alt, pointerId }  (tx/ty = tile)
  move(pt, ed) {},
  end(pt, ed) {},
  cancel(ed) {},
  preview(ctx, ed) {},     // draw the tool's ghost on the canvas overlay (tile units, already transformed)
  cursor: 'crosshair',
})
```
A stroke is one undo step: tools call `ed.beginStroke(label)` / `ed.endStroke()`.

## What good looks like
- Every edit is undoable, including inspector fields and deletes.
- Everything is reachable with a finger: targets ≥ 44px, no drag-only interaction
  (tap-then-tap always works), panels scroll, nothing depends on hover.
- Nothing modal that hides the map. The inspector lives beside it.
- The editor never blocks on validation: problems are shown, not enforced.
- Play here is one tap away and comes back to the same spot.

## The joins (`js/kit/editor/integration.js`)

The shell was frozen for a while, and the hooks it turned out to need were
written beside it, each so the shell could take it over later. It has: the
after-edit pass is the shell's now (`ED.commit` runs it), and what is left in
`integration.js` is the joins that are genuinely between the editor and the
game.

| | |
|---|---|
| `KIT.editor.commit(label, fn)` | One undo step, then the after-edit pass: refresh, validate (`ED.validateNow`, which records a crashed validator as a problem), autosave. **A panel calls `commit` and nothing after it.** `KIT.editor.afterEdit()` exists only for a writer that changed the document some other way (an import merge, a paste); calling it after `commit` runs the pass twice, which five panels used to do. |
| `panel.onSelect(sel, ed)` | Called by the shell from `KIT.editor.select` for every mounted panel, once per selection. (It was delivered twice for a while — once by the shell and once by integration.js — so a panel whose onSelect is a full rerender paid double.) |
| `KIT.editor.fitMap()` | A map opens at a zoom that shows all of it, with squares no smaller than a thumb (`KIT.editor.tools.fitScale`, tested). |
| `KIT.editor.emptyState({icon,text,hint,actions})` | In `inspector.js`: one look for “nothing here yet, do this”. |
| `KIT.editor.inspector.btn(label, title, fn, cls)` | The button. The title is the tooltip, and the accessible name when the label is only a glyph (↺ ✕ −); a worded label names itself, so the name follows the label. A click stops at the button. Four panels had grown a copy with exactly those improvements while the shared one lacked them; a panel aliases it, never copies it. |
| `KIT.editor.inspector.section(host, title, open, build, remember)` | A collapsible section that writes `remember.open` on toggle itself, so a redraw puts it back. The one that forgot the listener by hand snapped shut on the first redraw after a person typed into it. |
| `KIT.editor.inspector.searchBox(placeholder)` · `typingIn(host)` · `destroyForms(list)` | The search field, "is the caret in a field in here?" (ask before rebuilding a panel), and form teardown. Ten, seven and five copies each, before; the seven disagreed. |
| `KIT.editor.inspector.packForm(host, prev, { project, fields, value, at, label })` | A module's own settings as a schema form. Each change writes the one field that changed under `at` as one undo step, and the form is built once per project and re-read after that, so the caret survives the refresh its own commit causes. The Dungeon form and every panel `tools/new-module.js` wrote used to pass the field's path to `doc.set` as the whole pack. |
| `KIT.editor.ops.whereSelection(where)` | The one "where → selection" (`js/kit/editor/ops.js`, pure, tested). Three panels had their own and one dropped slot 0. |
| Play here | Starts on the square under the cursor with the switches and bag the author was playing with (a test state), instead of a new game plus a warp. Escape — or the ‹ Back to Creator Mode bar — comes back. |
| `KIT.editor.close()` | Hands the player back to the game where they were standing (`KIT.game.openEditor` remembers it, `KIT.game.resumeFromEditor` restores it), hides the host, and keeps the mounted panels so re-opening is instant. |

`KIT.game.openEditor({mapId})` is the one door into Creator Mode: `?edit=1` and
the pause menu both go through it.
