# Importer contract

How outside tools become Kit content. Three importers, one shape.

**The rule: importers are pure.** Each takes already-read data (a parsed JSON
object, a string, or an `ArrayBuffer`) and returns a result object. They never
touch the filesystem, the DOM, or the network — the CLI (`tools/import.js`) and
the browser panel do the reading, so the same code runs in Node tests and in
Creator Mode.

```js
KIT.import.tiled.map(json, opts)      -> Result
KIT.import.tiled.tileset(json, opts)  -> Result
KIT.import.rpgmaker.project(files, opts) -> Result
KIT.import.aseprite.sheet(json, opts) -> Result
KIT.import.aseprite.file(buffer, opts) -> Result
```

```js
Result = {
  assets:  { [id]: { kind:'image', src, w, h, from } },   // images to add to project.assets
  tiles:   [ tileDef ],         // definitions for KIT.registry('tiles')  (image-backed art)
  sprites: [ spriteDef ],       // definitions for KIT.registry('sprites')
  faces:   [ faceDef ],
  maps:    { [id]: Map },       // project maps (project v3 shape, §5)
  objects: [],                  // already inside the maps; listed here only when a map is not produced
  scripts: { [id]: Script },    // common events
  vars:    { [name]: VarDecl }, // variables the imported scripts use
  items:   { [id]: Item },
  project: { ... } | null,      // top-level fields worth merging (title, start, settings.tileSize)
  problems: [ { severity:'error'|'warn'|'info', code, message, where } ],
  stats:   { ... },             // counts for the report the user sees
}
```

Then `KIT.import.merge(target, result, { prefix, overwrite, dryRun, source })`
folds a result into a project. `target` is a plain project (merged in place) or a
`KIT.document`, in which case every change lands in ONE undo step called
`Import <source>`. Nothing is written to disk by the importer itself —
`tools/import.js` reads the files, resolves the images and writes the content.

```js
Report = {
  problems: [ Problem ],            // the merge's own, then the importer's
  added:    { maps, objects, tiles, sprites, faces, icons, animations, assets,
              scripts, vars, items, terrains, autotiles },
  replaced: { ...same... }, unchanged: { ...same... }, skipped: { ...same... },
  ids:      { added:[ 'maps/town', ... ], replaced:[], skipped:[] },
  label, project, registered, dryRun,
}
```

Where a result lands, and what the engine does with it afterwards:

| Result | Project | Registry |
|---|---|---|
| `assets` | `project.assets[id]` | `KIT.assets.define` |
| `tiles` / `sprites` / `faces` / `icons` | `project.<kind>[id]` | `KIT.registry('<kind>')` |
| `animations` | `project.animations[id]` | none yet (`animations-stored` info) |
| `maps` / `scripts` / `vars` / `items` | `project.<kind>[id]` | — |
| `project` | `meta.title`, `start`, `settings.tileSize`, `terrains`, `autotiles` | — |

`project.tiles/sprites/faces/icons` are content tables: imported art has no
`js/art/*.js` file to register it, so `KIT.project.registerContent(project)` puts
them into the registries when the project loads (`KIT.storage.loadProject`, and
`KIT.game.useAssets`). Values are written in the shape `KIT.project.normalize`
keeps them in, so importing the same file twice compares equal and changes
nothing.

## Ids and collisions
- Every produced id is `KIT.slug`ged and prefixed by the source when `opts.prefix`
  is set (`outside:grass`). Ids must be stable across re-imports of the same file,
  so re-importing updates instead of duplicating.
- Tile ids: `<tilesetId>:<localIndex>` unless the tile has a `name`/`id` property.
- An id that already exists is replaced when `overwrite` is true, otherwise it is
  reported as a `duplicate-id` problem and skipped. An id that already exists
  with *the same value* is neither: it is counted as `unchanged` and says
  nothing, which is what makes re-running an import a no-op.

## Images
Imported art is image-backed (`js/kit/core/assets.js`):
```js
{ image: '<assetId>', frame: { x, y, w, h } }            // one cell
{ image: '<assetId>', frames: [ {x,y,w,h}, ... ] }        // animation frames
```
`opts.asset(src) -> { id, src, w, h }` is supplied by the caller: the CLI turns a
relative path into a copied file or a data URI, the browser panel turns a picked
`File` into a data URI. If the caller gives no resolver, the importer records the
original path and adds an `asset-unresolved` problem — the import still succeeds.

## Tile flags
Map tool properties become Kit tile flags (§6.2): `solid`, `passage:{n,s,e,w}`,
`bush`, `counter`, `ledge`, `encounter`, `terrainTag`, `animMs`.
Unknown custom properties are kept verbatim on `tile.props` so nothing is lost.

## What every importer must do
1. Accept the format's real variants, and say so when it meets one it cannot handle
   (`problems`, never a thrown error, except for input that is not the format at all).
2. Be deterministic: same input, same ids, same output.
3. Round-trip through `KIT.project.normalize` with zero `error` problems.
4. Ship fixtures: small files generated by a script under `test/fixtures/`, plus a
   test that imports them and asserts the produced data.
