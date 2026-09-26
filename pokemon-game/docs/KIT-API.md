# KIT API reference

Everything the engine exposes, in load order. Written for the people (and
agents) building the runtime UI, the editor and modules. `§` refers to
`ARCHITECTURE.md`. Files marked **stable** are tested and should not be edited
without a reason.

Load order (classic scripts, no modules): `CORE` in `templates/_shared/kit-files.js`
is the one list — core, world, script, map/entities/world, systems, import,
render, scenes, `game.js` — and `test/kit/load-order.test.js` holds `index.html`
and `test/kit/_load.js` to it. It is not copied here, because a copy is what drifts.
(`world/world.js` captures `KIT.interpreter` at load time, so `script/*` must
load before it; `world/project.js` only uses the script schema lazily, so it may
come earlier.)

## core/util — stable
`KIT.deepClone(v)` · `KIT.deepEqual(a,b)` · `KIT.stableStringify(v, indent)` (sorted keys) ·
`KIT.uid(prefix)` · `KIT.slug(s)` · `KIT.clamp(v,lo,hi)` · `KIT.isObject(v)`

`KIT.storage.fileName(project)` → `<id>.kitgame.json` · `toFile(project)` · `fromFile(text) -> { ok, project, savedAt, title, reason }` · `saveToFile(project)` · `copyToClipboard(text)` — a whole game as one file, which is how it moves between a phone and a laptop. There is no server and no account; the file is the bridge. `fromFile` takes a bare project too (an older export, or one somebody wrote by hand) and refuses anything else in words a person can act on. Creator Mode: Project › “This game, on your other device”.

`KIT.storage.meta()` / `saveMeta(patch)` — what the game remembers about the PLAYER rather than about the run: how many times they have started, what they called themselves, which endings they reached. It lives beside the saves and outside all of them, which is what makes it survive New Game. Authors write it with `@remember key = value` (`has` for a list, `+=` to count, `forget`), read it with the `meta` condition and say it with `{meta:key}` in a line.

`KIT.labelOf(def, ctx, fallback)` — what to call a registry entry on screen. A
`label` may be text or a function of the context (`(game) => KIT.strings.get(game.project, 'x')`),
so an entry can take its name from the Terms table; this resolves either, falling
back to `name`, then `fallback`, then `id`. Read a label with this, never `def.label`.

## core/events — stable
`KIT.events(name) -> bus` with `on(event,fn) -> off`, `once`, `off`, `emit(event,payload) -> count`, `count`, `clear`.
`'*'` listeners receive `(event, payload)`. A throwing listener never stops the others. `KIT.bus` is the global one; `KIT.worldBus(save)` is the bus an event of one run belongs on (the live world's own bus when `save` is the live save, else `KIT.bus`).

## core/rng — stable
`KIT.hash(...parts) -> uint32` · `KIT.rng(seed) -> fn()` with `.int(n) .range(lo,hi) .pick(arr) .chance(p) .weighted(items,key) .shuffle(arr) .fork(label)`.
Every random decision in the kit goes through one of these; same seed, same run.

## core/registry + core/registries — stable
`KIT.defineRegistry(name, { fields, doc }) -> reg` (idempotent) · `KIT.registry(name)` (throws if undefined) · `KIT.registry.exists(name)` · `KIT.registry.names()`.
Registry: `add(def)` (fills defaults, validates against `fields`, warns on replace unless `def.replace`), `addAll`, `get`, `require`, `has`, `list`, `ids`, `size`, `remove`, `clear`, `on('add'|'remove')`, `groups(key)`.
Standard registries: `tiles sprites faces icons sounds music voices textEffects assets objectTypes behaviours commands conditions itemKinds systems scenes menus editorPanels editorTools fieldEditors mapSections validators presets blueprints migrations strings importers`.
`KIT.registry('tiles').stamps` is the multi-tile brush list.

## core/schema — stable
One field declaration drives the form, the validator, defaults, and the usage index.
`{ key, type, label, doc, default, nullable, optional, min, max, integer, pattern, options|optionsFrom, of, fields, array:{min,max}, when:{field,eq|neq|in|truthy}, display, access:'read'|'write', ref:{scope,tag,symmetrical} }`
Types: `string text note label number numbers bool enum color position direction region route script condition strings scalar list group tile face` and `ref:<kind>`.
API: `KIT.schema.field(f)` · `fields(list)` (both memoised on the declaration — a schema is static, and normalising it per value was half of validating a project; treat the result as read-only) · `validate(fields, value, ctx) -> [{path,message,code}]` · `validateValue(field, v, ctx)` · `defaults(fields, ctx)` · `defaultFor(field)` · `fill(fields, value, ctx)` · `refs(fields, value, ctx) -> [{kind,id,path,access}]` · `walk(fields, value, fn)` · `visible(field, siblings)` · `defineType(name, handler)` · `refKind(kind, resolver)` · `registryRefKind(kind, registryName)` · `projectRefKind(kind, table)`.
Ref kinds wired: tile sprite face icon sound music voice textEffect asset preset map item script var fragment object cast fact (+ modules add their own).

## core/input — stable
Buttons, not keys: `KIT.input.KEYS = ['up','down','left','right','a','b','menu']`, per player (0-based in the keymap). Keyboard, gamepad, on-screen pad and swipe all arrive as the same seven.

The keymap is DATA, so it can be changed: `keymap(player) -> { code: button }` · `keymaps()` (the whole table, to save) · `bind(player, code, button)` (null unbinds; a code may only mean one thing per player, so binding a taken code MOVES it) · `setKeymap(list)` (overlays the defaults, so a saved table only overrides what it names) · `resetKeymap()` · `boundTo(player, button) -> [code]` · `isDefaultKeymap()`.

For a remapping screen: `keyLabel(code)` turns a `KeyboardEvent.code` (a physical position — `KeyZ` whatever the cap says) into what a person would recognise · `capturable(code)` · `NOT_CAPTURABLE = ['Escape']` — the one key the screen cannot take, because it is how a player gets out of it.

Runtime, what a scene or module reads. Here `player` is `2` or `'p2'` for the second player and anything else for the first — not the keymap's 0-based index: `attach(canvas)` `detach()` (keyboard on the window, swipe and tap on the canvas) · `mount(el, { players })` `setPlayers(n)` `players()` `isTouch()` (the on-screen pads) · `state(player) -> { up, down, left, right, a, b, menu }` `pressed(key, player)` `heldMs(key, player)` · `onPress(fn) -> off` (`fn({ player, key })` once per press; `key` may be `'swap'`) `justPressed(key, player)` `consume()` · `press(key, player, ms)` `set(key, player, down)` `releaseAll()` (synthetic input; `KIT.game.press`/`hold` call these) · `poll(pads)` `gamepads(pads)` `deadzone(v)` · `TAP_MS` (a direction held for less than this only turns).

Player-facing: **Settings → Controls** (`js/kit/scenes/menu.js`, the `keys` scene; rows from `KIT.keysScreen.rows(project, players)`). Saved in `settings.keys`, a device preference like language, restored at boot.

## core/assets — stable
Image-backed art (imported PNGs; the built-in art is pixel strings and needs none of this). `KIT.assets.define(def)` · `get(id)` `has(id)` `ids()` · `image(id)` (the loaded element or null) · `isImageArt(art)` · `tileArt(id)` `animArt(id)` `grid(...)` `size(id)` · `load(id) -> Promise` `loadAll() -> Promise` · `fromProject(project)` (registers what a project carries) · `state()` `clear()`.

## core/audio — stable
`KIT.audio.unlock()` (the first tap; browsers require it) · `play(id, { volume })` `playAt(id, { map, x, y })` (fades with distance from `setListener`) · `music(id|null, { fade, volume })` `setMusic` `stop(what)` `current()` `isMusic(id)` · `jingle(id)` `replay()` `save()` · `layer(id, on)` `layers()` `layerGain` `layersOf(music)` (music with parts that come and go) · `duck(by)` `unduck(by)` `duckedBy()` (a voice turns the music down and gives the player's level back) · `setVolume(bus, v)` `volumes()` `setEnabled(on)` `isEnabled()` · `loaded(id)` `freq(note)` `context()` `init()`.

## core/lang — stable
Translations keyed on the source line (ADR-0006). `KIT.lang.use(project, code)` `current()` · `t(project, text, vars)` · `known(project)` `coverage(project, code) -> { total, translated, missing }` · `extract(project) -> [line]` (every line a player can read) · `toText(project, code)` / `fromText(text) -> { lines, problems }` (the one-file format the Languages panel hands out and takes back) · `bind(el, ...)` `put` `missing` `shown` `translating` `source` `SOURCE` `guess` `nameOf`.

## core/look — how the game looks and sounds, as data
A game's look is `project.ui`: **overrides only**, on top of the look it starts from (`ui.base`; the built-in `kit` when there is none). Nothing here touches the page; `ui/parts` does that.

`KIT.look.resolve(project) -> look` — every field filled in: `tokens` (colours, widths, fonts), each part's options (`dialogue choice menu toast pad cursor`), `sounds` (one per role), `voice`, `base`, plus `_chain` (`['kit', …]`, root first) and `_problems`. The layers are the schema defaults, the `kit` look, the chain of looks it starts from (`project.looks` first, then the `looks` registry; a missing base, a loop or a chain more than eight deep stops the walk there and says so), then `project.ui`. Every layer is sanitised on the way in.
`compile(look, env) -> css` — pure and deterministic; only what differs from the kit: the tokens as custom properties on `#stage`, then one rule per part option that is not the kit's own (every selector starts at `#stage` or `#screen`; the cursor and the chosen line are the look's in `#choice`, `#pause-menu` and an author's screen, never on the title; animations only under `#stage:not([data-kit-motion=reduce]):not([data-kit-fast])`). `env` is `{ fonts, faces }`: `fonts` is the game's `project.fonts`, each usable one written first as `@font-face{font-family:"kitf-<id>";src:url(<data:font/…>) format(…);font-display:block}`, a line each (usable: an id that is not a font word, and a `data:font/(ttf|otf|woff|woff2);base64,` file — a link is never written; every usable font, not only those the look names), and `faces: false` leaves those out. So **the kit look compiles to `''` in a game with no fonts of its own** — a game that never touched its look ships exactly `css/kit.css` — and to only its fonts' `@font-face` in a game with some. The message box's options reach the copy of it a question keeps by its answers (`#screen #choice[data-place] .kit-promptbox`) too. A pixel font (`pixel: true, px: N` on the message text's font) sets the text size to `N × max(1, round(target / N))` px for the targets 14, 17, 20 and 24 (small to huge), and asks for unsmoothed letters. A mark an author types (a cursor, the prefix) is written into CSS with everything but letters, digits and `* . _ , ! ? -` escaped as its code point ·
`inherited(project, path) -> value` — what `path` comes to from the look this game starts from, without the game's own changes: a value equal to it is not a change (`KIT.editor.ops.look` stores nothing) · `css(project, { faces }) -> css` — `compile(resolve(project), { fonts: project.fonts, faces })`; with `faces: false`, what `apply` writes into `#kit-look` · `fontFaces(fonts) -> css` — just the `@font-face` lines `compile` starts with, what `apply` writes into `#kit-look-fonts` · `sanitize(ui) -> { ui, dropped }` (hex colours, written lower case with six digits, numbers pulled into range, known enums, ids; anything else is dropped, and there is no field for raw CSS) · `cleanAt(path, value) -> { ok, value }` — one value cleaned as the field at `path` inside `ui` says (`['dialogue', 'prefix']` cut to four letters, `['tokens', 'paper']` a colour or not ok); `KIT.editor.ops.look.set` stores what it gives · `problems(project)` (what the `ui` validator reports: `ui-base-missing`, `ui-base-cycle`, `ui-base-deep`, `ui-bad-value`; `ui-contrast` (text, the chosen line's text, a value or the cursor on the chosen line, a toast's text, a name typed into the name box (the text colour on `inputBg`), or OK's word on the OK button (`buttonInk`) less than 3:1 against its background; the chosen line's background is the box's own when the look draws no box round it), `ui-lines` (a message box estimated at more than 45% of the game screen on a 390×844 phone), `ui-ref` (a sound, voice or font the game does not have), and about the game's font files: `ui-src` (not a font file inside the game; it is not used), `ui-bad-value` (a font named like a font word), `ui-big` (a font over 300 KB, or all of them over 1.5 MB; `where.path` is `['fonts', id]` or `['fonts']`) — each a warning with `where: { look: true, path }`).
`use(project) -> look` `current()` `get('tokens.paper', fallback)` — the look in use · `sound(role, { or, overrides }) -> id|null` (plays it; the scenes ask for a role, never a sound) · `voice(project)` (the game's setting, else the look's) · `family(value, fonts)` (a font word — `pixel system mono serif rounded` — as its stack; a key of `fonts` as `"kitf-<id>"` then a fallback stack, monospace for a pixel font; anything else unchanged. A font token naming a font the game does not have keeps the kit's font) · `menuOrder(entries, cfg) -> ids` (the pause menu's order: `(order || 50)`, then the look's `order` with `'*'` for the rest, then `hide`; Settings is never hidden).
`TOKENS` (schema fields, each with the `css` property it sets and the `fallback` literal `css/kit.css` writes after the comma; `test/kit/look.test.js` holds the two to each other; `label` and `noneLabel` are what the Look panel calls them; an empty colour's `follows` names the token it is drawn in meanwhile, and `shows` the colour it stands for when that is a picture) · `PARTS` (`dialogue choice menu toast pad cursor sounds`, schema field lists with the panel's words as `label` and `doc`; `later` marks an option a look may hold that the game does not act on or the panel does not offer yet — now only the menu's `order` and `hide`) · `ROLES` (`move confirm cancel buzzer save open close page toast` and the kit's sound for each; null is silence) · `events` (`changed` { look }, `applied` { css, look }) · the `looks` registry (`{ id, label, describe, rev, base, ui }`; `js/kit/ui/presets.js` registers `kit`, `handheld`, `soul` and `dream` — styling only, no art; the `typer` voice in the `voices` registry is Soul's blip on every letter). The author's guide to all of it is `docs/LOOKS.md`.

## core/storage — stable
Adapters IndexedDB → localStorage → memory (`ready() -> { adapter }`, `info()`, `adapters`, `durability()`, `warning`). Keys are `kit.<projectId>.<what>`: `loadProject({ draft, projectId, before, validate })` (a draft that could not be *read* blocks draft writes for the session rather than being overwritten) · `saveDraft(project, { now })` `hasDraft()` `discardDraft()` `draftKey()` · `saveGame(slot, save)` `loadGame(slot)` `deleteGame(slot)` `listGames()` `SLOTS` · `settings()` `saveSettings(patch)` (global) · `meta()` `saveMeta(patch)` (per player, survives New Game) · `persist()` · raw `get(k) set(k, v) del(k) keys()` (never throw) · files: `toFile(project)` `fromFile(text)` `fileName(project)` `saveToFile` `download(name, data, mime)` `zip(files)` `copyToClipboard(text)` `exportGame exportText importGame importText` · `captureHtml()` `publish()` `canPublish()` `onDownload` · `projectId()` `key(what)` `writerId()`.

## core/pixels — stable
Art is `{ w, h, palette:{ch:'#hex'}, rows:[...] }` or `frames:[rows,...]`, or image-backed `{ image, frame:{x,y,w,h} }`.
`KIT.pixels.canvas(art, { scale, mirror, recolor, frame, tint })` (cached; browser only) · `draw(ctx, art, x, y, opts)` · `downscale(art, size)` · `silhouette(w, h, color)` (**the placeholder for missing art — never crash**) · `validate(art)` · `dims(art)` · `rowsOf(art, frame)` · `frameCount(art)` · `paletteWith(art, map)` · `invalidate(art)` · `artOf(def)`.

## world/document — stable
`KIT.document(project) -> doc`: `value`, `get(path)`, `has(path)`, `apply(ops, {label}) -> inverse`, `set/del/splice/push`, `transaction(label, fn)` (one undo step; nested flatten), `undo()`, `redo()`, `canUndo/canRedo`, `seq` (how many changes so far, undo and redo included — a panel compares this instead of re-indexing the project to learn nothing changed), `history`, `watch(prefixPath, fn) -> off` (fn gets `{ops, inverse, label, kind, seq, paths}`), `replace(next)`, `dirty`, `markClean()`, `clearHistory()`.
Ops: `{op:'set',path,value}` `{op:'del',path}` `{op:'splice',path,index,remove,insert}`. `set` creates missing intermediates as objects.
`KIT.path.get/has/join/parse/isPrefix/related`.

## world/project — stable
`KIT.project.VERSION=3` · `SLOTS=['interact','step','touch','enter','tick','init']` · `LAYERS=['terrain','ground','deco','above','regions']` · `GROUND_BY_KIND` · `MAP_KINDS`.
`normalize(project, ctx) -> { project, problems }` (migrate chain → fill every default → validate; never mutates the input) · `validate(project, ctx) -> Problem[]` · `migrate(project)` · `fillMap/fillObject/fillPage/fillItem/fillVar` · `newMap({id,name,width,height,kind})` · `newObject` · `resize(map,w,h)` · `blank()` · `clone(p)` · `uniqueObjectId(map, base)` · `buildPreset(presetOrId, ctx)` · `walkScripts(project, fn)` · `walkCommands(project, fn)` · `collect(project) -> { vars:{name:{reads,writes,declared}}, refs }` · `known(kind,id,project)` · `cellSolid(map,x,y)` · `stringify(value,opts)` · `exportFiles(project) -> { 'project.js', 'maps/<id>.js' }` · `importFiles(files)` · `fromContent(projectId)` · `parseFile(text)`.
Problem: `{ severity:'error'|'warn', code, message, where:{ map, object, page, slot, script, path } }`.
Project v3 shape: see §5 — `version meta modules settings strings heroes start vars items scripts fragments testStates autotiles terrains world maps packs rules facts cast languages assets` (`settings` also carries `language languageName voice clock`).

## world/tiles — stable
`KIT.tiles.def(id)` · `flags(id) -> { solid, passage:{n,s,e,w}, bush, counter, ledge, encounter, terrainTag, animMs, exists }` · `passage(tile, dir)` · `frameAt(tile, timeMs)` · `bake(map, project, { around, radius, seed }) -> { ground, deco, changed }` (pure, deterministic per cell) · `rulesFromTemplate({groupId, terrain, tiles:{center,n,s,e,w,ne,nw,se,sw,inner*}, against})` (the autotile wizard) · `remapGroup(group, from, to, tileMap)` · `ruleRadius(set)` · `ownedTiles(set, layer)` · `ANY/EMPTY/DEFAULTS`.
Tile registry entry: `{ id, name, group, art|frames, solid, passage, bush, counter, ledge:'down', encounter, terrainTag, animMs }`.

## world/blueprints — stable
A whole game to start from. `presets` makes one object, `importers` read one
file; a blueprint makes the entire project.
`KIT.blueprints.list() -> [def]` (by `order`, then label) · `get(id) -> def|null` ·
`titleFor(id) -> string` (the name to use when the author typed none) ·
`build(id, { title, id }) -> { project, problems }` (normalized; throws on an
unknown id or a blueprint that builds nothing).
Registry entry: `{ id, label, describe, defaultTitle, order, build({ title, id }) -> project }`.
The kit ships `blank` only; a module registers its own (ADR-0005, ADR-0015) — the
mons module's `mons-region` is in `js/modules/mons/region.js`.

## world/cast — stable
The people in the story, what they know, and how they feel about each other — the thing switches do not scale to.

Content: `project.cast[id] = { name, pronouns, sprite, face, group, met, knows:[factId], feels:{ castId: −100..100 }, tags, note }` · `project.facts[id] = { label, secret, group, note }`. A fact need not be declared: telling somebody an undeclared one works, and the Cast panel marks it “not written down” so you can tidy up later.
Save: `save.cast[id] = { met, knows:{ factId: { at, from } }, feels:{ castId: n } }`. `KIT.cast.start(project, save)` seeds it once, when the world is made; everything after that is the save's.

`tell(save, who, fact, { from, at }) -> bool` (true when it is news; the first person to say it stays on the record) · `forget` · `knows(save, who, fact) -> { at, from } | null` · `known(save, who)` · `whoKnows(project, save, fact)` ·
`spread(save, from, to, { only, not }) -> [factId]` — gossip, which happens because the story said so and never by itself ·
`feels(save, who, about)` · `feel(save, who, about, delta)` · `setFeeling` · `mutual(save, a, b) -> { ab, ba, both }` (a friendship is only as warm as its cooler half) · `band(n) -> { id, label }` (hostile…close) ·
`meet(save, who)` · `met` · `person(project, who)` · `nameOf` · `fact(project, id)` · `labelOfFact` ·
`speaker(project, payload) -> payload` — a say payload with the voice filled in: its own, else the speaker's from the cast, else the game's (`KIT.look.voice`). The say command and the game's `io.say` port both go through it, so a line from a module sounds like whoever says it ·
`graph(project, save) -> { people[], facts[] }` — what the Cast panel draws, because a cast is only worth having if you can see it.

Scripts: `@tell who fact [from who]` · `@tell who forgets fact` · `@spread a to b` · `@feel a -> b += 10` (`<->` for both ways, `=` to set) · `@meet who`.
Conditions: `knows` (optionally `from` somebody in particular) · `feels` (with `mutual`) · `met`.
Lines: `{who:mira}` · `{they:mira}` `{them:mira}` `{their:mira}` — from their `pronouns`, so a line can be written once for anybody.

## world/log — stable  (`KIT.history`, not `KIT.log`)
What happened, in one run. A permanent **tally** answers "ever?" and "how many times?" exactly; a bounded **window** answers "when, where, in what order". ADR-0011.

Save: `save.log = { n, entries:[{ n, verb, what, who, where, layer, at, data? }], tally:{ 'verb':n, 'verb/what':n } }`. `at` is in-game minutes since the first morning — deliberately not wall-clock.

`add(save, verb, { what, who, where, layer, at, data }) -> entry` (`where`/`layer` default to wherever the world is) · `count(save, query) -> n` · `has(save, query) -> bool` · `exact(query) -> bool` (is this question answered from the tally, and so for all time?) · `last(save, query) -> entry|null` · `all` · `since(save, n, query)` · `seq(save)` · `WINDOW = 400`.
Across runs: `promote(save, verb, what)` carries one fact to `meta`, deliberately · `everDid(verb, what)`.

Scripts: `@did <verb> [what=… who=…]` writes one down · `@remember <verb>[/<what>] ever` carries one across New Game. Conditions: `did.<verb>[/<what>] >= n` (this run) · `ever.<verb>[/<what>] >= n` (every run this player has had). Lines: `{did:ate/bread}` · `{ever:ate/bread}`.

## world/rules — stable
The rules of the world as **things in it**: `when` an event happens, `if` a condition holds, `do` a script. They can be switched off, rewritten and **eaten**. ADR-0012.

Content: `project.rules[id] = { name, when, if, do, on, priority, edible, scope:{ maps, layers }, note }`.
Save: `save.rules[id] = { on?, eaten?, patch?, rule?, at? }` — only what this run changed.

`all(project, save)` · `get(project, save, id)` (with any rewrite applied) · `live(project, save, id) -> bool` (eaten beats on/off beats the rule's own `on`) · `matching(project, save, event, { map, layer }) -> [rule]` — **pure**, in firing order: priority → specificity → most recently defined → id ·
`define(save, rule)` · `activate` · `deactivate` · `eat(save, id)` (permanent; writes `ate rule:<id>` to the history) · `rewrite(save, id, patch)` · `inScope(rule, where)` · `fire(ctx, event, payload, where?) -> Promise<n>` (`where` is `{ map, layer }` where the event happened; the world's queue passes it, otherwise it is where the world is now) · `MAX_DEPTH = 8` · `depthNow()`.

The world listens on `'*'` and queues firings, each with the place its event happened, so two events in a frame cannot start two conversations: `world.rulesSettled()` · `world.rulesPending()`. A drain is capped at 512 firings and writes `rule:loop` rather than freezing.

Scripts: `@rule eat|on|off <id>`. Conditions: `rule.<id>` (a bare word — `not rule.<id>` asks whether it was eaten).

## world/timeline — stable
Saves as a tree of moments, not a row of slots. Every save is a node; playing on from an older one branches. Stored as deltas with an anchor when the chain has cost as much as a whole save. ADR-0013.

Store: `kit.<projectId>.timeline = { v, head, n, nodes: { m1: { p, at, label, where, layer, day, min, tk, keep?, d? | full?, cb?, cl? } } }`. `tk` is what that moment ADDED to the run's tally; `d` is its delta, `full` a whole save.

Delta (pure, and the part that has to be exactly right): `diff(a, b) -> ops` · `patch(base, ops) -> value` · `apply(target, ops) -> target` (in place). Ops: `{p,v}` set · `{p,x:1}` delete · `{p,cut,add}` an array lost n from its front and gained these.

Tree: `load()` · `now()` · `flush()` · `forgetAll()` · `record(save, { label, parent }) -> id` · `rebuild(id) -> save|null` · `goto(id) -> save|null` (stands there and stamps `save.moment`) · `headTo(id) -> bool` · `node(id)` · `head()` · `count()` · `path(id)` · `children(id)` · `label(id, text)` · `keep(id, on)` · `tallyAt(id)` · `bytes()` · `prune(budget)` · `moments() -> [{ id, depth, label, where, layer, day, min, at, mine, head, kept, branches }]` · `MAX_CHAIN` `CUT_PROBE` `BUDGET`.

What the game can ask: `elsewhere(query) -> n` — how many times this happened in a branch that is NOT the player's, counting only after the fork · `everywhere(query) -> n` — the most any one line managed.

Scripts: `@moment <label>` (a named point, never pruned). Conditions: `elsewhere.<verb>[/<what>] >= n` · `everywhere.<verb>[/<what>] >= n`. Lines: `{elsewhere:ate/bread}` · `{everywhere:ate/bread}`. Player: the **Moments** row in the pause menu.

## world/map — stable
`KIT.mapView(project, save, mapId) -> view` — the authored map composed with `save.overlays[mapId]`.
`view.id width height kind music index(x,y) inBounds tileAt(layer,x,y) terrainAt region collisionAt flagsAt(x,y)` (merged over ground/deco/above + collision override) · `bushAt(x,y)` (the one flag the renderer asks for per character per frame, without building the merged answer) ·
`passable(x, y, dir, who) -> { ok, reason, to, hop, connection }` — reasons: `step hop through connection turn | tile edge edge-in edge-out ledge ledge-blocked entity direction` ·
`hopTarget(x,y,dir)` · `connectionAt(x,y,dir) -> {map,x,y,dir}` · `interactTarget(x,y,dir) -> { first, second, across }` (counter reach) ·
`objects objectsAt(x,y) objectKey(obj) -> 'map:id'` · `objectState(obj)` · `isHidden(obj)` · `positionOf(obj)` · `activePage(obj, ctx) -> { page, index }` (**the LAST page whose `when` passes**) · `setBlockers(list)` · `overlayCells()`.
`KIT.DIRS` `KIT.OPPOSITE` `KIT.delta(dir)`.

**Dimensions** — a map may declare `map.dimensions[name] = { tiles, objects, music, atmosphere }`, a layer of reality over the same place. `KIT.mapView(project, save, mapId, { dimension })` pins one; otherwise the view reads `save.dimension` live. The `@shift` command moves the player between them, the `dimension` condition kind asks which one is current, and the world emits `dimensionChanged`.

## world/entities — stable
`KIT.entities.create(spec) -> entity`: `{ id kind objectKey pageIndex x y dir px py sprite art look layer through solid visible dirFix stepAnim opacity speed behaviour home mover walkFrame stepCount data }`.
`tryMove(e, dir, view, { turnOnly, ignoreBlocked }) -> passable result` (turns, then starts the move; ledge hops covered) · `update(e, dt) -> 'arrived'|null` (interpolates `px/py`, arcs hops, advances the 4-step walk cycle) · `frame(e) -> { rows, palette, mirror, w, h }|null` (null = draw a silhouette) · `facingTile` · `at` · `adjacent` · `dirToward(from,to)` · `faceToward(e,target)` ·
`startRoute(e, steps, { wait, skipBlocked, repeat })` / `updateRoute(e, dt, view, ports) -> finished` / `stopRoute` / `applyStep` — route verbs: `up down left right randomStep towardHero awayHero face:<dir> faceHero turnRandom jump:dx,dy wait:ms sprite:<id> speed:n through:on|off visible:on|off dirFix:on|off stepAnim:on|off sound:<id>` ·
`noteLeaderStep(comp, leader)` / `updateCompanion(comp, leader, dt, view)` (trail follow, teleports after a warp) · `DEFAULT_SPEED=6` tiles/s.

## world/world — stable
`KIT.world.create({ project, save, ports, rng, events }) -> world`.
State: `project save events rng ports map entities heroes companion activeHero coop busy time systems camera`.
`enterMap(id,x,y,dir) -> Promise` (swaps the map, places heroes, rebuilds entities, fires `init` then `enter` slots, switches music) ·
`interact(heroIndex) -> Promise<bool>` (A button; reaches across counters; invisible events still react) ·
`addInteractTarget(fn) -> off` — something that is not a map object and would still like to be talked to: `fn(hero)` returns `[{ x, y, answer(hero) }]`. The map's own objects answer first, then these in the order they were added; a target that returns `false` declines and the press falls through. Followers, vehicles, anything off-map. ·
`move(heroIndex, dir, opts) -> Promise<result>` (d-pad; bump sound, companion trail, `step` slots, map connections) ·
`runSlot(entity, slot, heroId)` (main-thread slots set `world.busy`; `once` sets `self.done`; `needsBoth` gates in co-op; NPCs face the hero and turn back) ·
`makeCtx(entity, heroId) -> RunCtx` · `ctxBase()` · `refreshPages()` · `rebuildEntities()` · `stepTriggers(hero)` · `runSlotsForMap(slot)` (deferred while the world is busy — a map entered from inside a script still gets its `init`/`enter` once the script lets go; `drainSlots()` `slotsPending()`) · `hero(i)` · `heroById(id)` · `setActiveHero(i)` · `saveHeroPositions()` · `update(dt)` (runs systems in order).
Events emitted: `mapEnter mapLeave step interact interactMissed activeHero needsBoth` plus everything commands emit (`varChanged selfChanged itemChanged objectStateChanged timerChanged heroRenamed heal debug`), `clockTick` and `sessionResumed`.
`interact { object, hero, result, where:{ map, layer } }` is emitted after the object's script; `where` is where A was pressed, and a rule's scope is checked against it even if the script moved the hero. `interactMissed { hero, x, y, dir }` is the mirror of `step`: A was pressed, and nothing — no object, no extra target — answered. It is how an object type can react without a page.

## systems/index — stable
`KIT.clock` (the one clock, kept in `save.clock`): `stamp(save)` `resume(save, now)` `add(save, minutes)` `of(save)` `gap(save)` `settings(project)`.
Registered systems, in order: `movement(10)` (interpolation, arrivals, NPC touch) · `behaviours(20)` (`none look wander route approach` in the `behaviours` registry) · `triggers(30)` (background `tick` slots, one at a time per object) · `companions(40)` · `clock(50)` · `camera(90)`.

`KIT.clock` — the game's one clock, and there should never be a second.
`settings(project)` (the `settings.clock` group, defaults filled) · `of(save)` · `add(save, minutes)` (days roll over) · `stamp(save)` · `gap(save) -> ms since `lastSeenAt`` ·
`resume(world) -> { elapsedMs, minutesAdded } | null` — the gap between sessions, said once per world at the end of its first tick (`world.update` calls it, after every system has installed its listeners) as `sessionResumed`. `awayMinutesPerRealMinute` turns it into in-game minutes, capped by `awayCapMinutes`; leave that at 0 and the world waits for you while the gap is still reported.
`KIT.camera.update(world) -> {x,y}` centres on the active hero, clamps to the map, centres small maps.
Add your own: `KIT.registry('systems').add({ id, order, update(world, dt), onMapEnter, onMapLeave })`.

## script/text — stable
`KIT.text.substitute(str, ctx)` (`{p1} {p2} {p} {var:x} {self:k} {item:id} {hero} {arg:n}`, `KIT.text.tags` for module tags) · `tokenize(str) -> spans` (codes `{pause} {pause:ms} {wait} {fast} {instant} {color:x}…{/color} {icon:id} {size:big}…{/size} {shake} {voice:id}…{/voice} {fx:name}…{/fx} {fx:name,amount}`, `\n`, `{{`/`}}` escapes) · `strip` · `plain(str,ctx)` · `wrap(spans, { width, measure })` · `paginate(lines, linesPerPage)` · `render(str, ctx, layout) -> pages` · `escape/unescape` · `contextFrom(ctx)`.
`KIT.strings.get(project, key, vars)` — Terms table: registry defaults, overridden by `project.strings`.
`KIT.script.values`: `format(v,{bare})` `parseBare` `scan(str,i,stops)` `tokenize(str,{separators})` `pairs` `BARE WORD NUMBER`.

## script/conditions — stable
Kinds: `var self item facing button timer region tile meta clock coop dimension all any not` (+ module kinds).
`KIT.conditions.test(cond, ctx) -> bool` · `describe(cond, ctx)` · `normalize` · `validate` · `refs` · `toText(cond)` / `parseText(str)` / `tryParseText` (the `when:` text syntax: `chapter >= 2 and not item.berry >= 1`, `self.opened == true`, `meta.runs > 0`, `kind(key=value)`, `always`/`never`) · helpers `getVar getSelf count target targetLabel heroId heroIndex compare objectKey withDefaults`.
ctx for conditions: `{ world:{ save }, project, self:'map:obj', hero:'p1', coop }`.

## script/commands — stable
`KIT.commands`: `exec(ctx, cmd)` · `summary(cmd, ctx)` · `validateScript(cmds, ctx)` · `refs(cmds, ctx)` · `walk(cmds, fn)` · `nested(cmd)` · `blockFields(def)` · `normalize(cmd)` / `normalizeAll` · `toLine/fromLine` · `genericToLine/genericFromLine` · `option.toLine/fromLine` · `keysFor` · `state.{getVar,setVar,getSelf,setSelf,count,give,heroName,setHeroName}` (every write emits its event) · `get/list/ids`.
Commands (id — MV label): say choice inputNumber scrollText · setVar setSelf timer · if loop break label jump exit call comment wait group · give take nameEntry · transfer setLocation moveRoute scrollMap follow · transparency animation balloon erase · fadeOut fadeIn tint flash shake weather · pictureShow pictureMove pictureErase · music sound stopSound saveMusic replayMusic jingle · menu save title chapter heal debug.
Also in the registry, kit-only (no MV label): `meanwhile` (tracks that run at the same time), `atmosphere light layer` (lights and weather on a map), `camera` (pan and follow), `shift` (move to another dimension of the map — see world/map).
Definition: `{ id, label, mv, group, icon, fields, blocking, background, control, editor:{favourite}, run(ctx,cmd), summary(cmd,ctx), text:{toLine,fromLine,endLine,elseLine} }`. `background:false` = needs the main thread.

### The ctx ports (what the runtime must implement)
`ctx = { project, world, save, self, hero, entity, rng, args, emit(event,payload), io, audio, screen, pictures, map, game }`
- `io`: `say({who,face,text,position,bg,raw})` `choice({prompt,options:[{text,index}],cancel}) -> index|-1` `nameEntry({hero,prompt,maxLength,current}) -> string|null` `inputNumber({prompt,digits,current}) -> number|null` `toast({text})` `chapter({title,subtitle,ms})` `scrollText({text,speed,noFast})` `wait(ms)`
- `audio`: `play(id,{volume})` `music(id|null,{fade,volume})` `stop('sound'|'music')` `save()` `replay()` `jingle(id)`
- `screen`: `fadeOut({ms,color})` `fadeIn({ms})` `tint({color,amount,ms})` `flash({color,ms})` `shake({power,ms})` `weather({kind,power,ms})`
- `pictures`: `show({id,image,x,y,anchor,opacity})` `move({id,x,y,opacity,ms,wait})` `erase({id})`
- `map`: `transfer({map,x,y,dir,fade})` `setLocation({target,x,y,swap})` `moveRoute({target,steps,wait,skipBlocked,repeat})` `scrollMap({dx,dy,speed})` `transparency({target,on})` `animation({target,id})` `balloon({target,kind,wait})` `erase({target,persistent})` `follow({on})`
- `game`: `menu()` `save({slot}) -> bool` `title()` `heal({hero})` `debug({text})`
All return promises. `target` is `self | hero | p1 | p2 | obj:<id>`.

## script/screenplay — stable
`KIT.screenplay.serialize(commands) -> text` · `parse(text) -> { commands, problems:[{line,message,raw}] }` · `serializeDocument(sections)` / `parseDocument(text)` · `layout(cmd)` · `INDENT`.
Grammar: `Name: text` and `Name (face=x, at=top): text` → say; `"narration"`; `? prompt` + `- option [when: cond]`; `@if when: …` / `@else` / `@end`; `@loop`/`@group`/`@end`; `# comment`; `@set x += 1`; `@self k = v`; `@call id arg=1`; `@transfer map x y dir`; `@move target: up up left`; `@wait 500`; generic `@id key=value`. Blocks indent by 4 spaces or a tab. Unparsable lines survive as `{t:'raw',line}` and are reported. Round-trip is lossless (tested for every command).

## script/interpreter — stable
`KIT.interpreter.run(cmds, ctx, { kind:'main'|'background', label, path, breakpoints }) -> Promise<{status:'done'|'exit'|'cancelled', thread, signal}>` (main runs are serialised) ·
`runScript(project, id, ctx, {args,kind})` · `runAuto(project, ctx) -> ids` · `runParallel(project, ctx)` · `callScript(ctx, id, args, path)` · `threads()` · `mainBusy()` · `cancel(thread)` · `cancelAll()` ·
`fakeCtx({ project, save, self, hero, seed, answers, names, numbers, onSay, map, coop }) -> ctx` with `log`, `said()`, `calls(port,name)` — the headless test/play harness.
Thread: `{ id, kind, background, breakpoints:Set('2/then/0'), pause(), resume(), step(), cancel(), current:{cmd,path}, steps }`; `ctx.onStep(cmd, path, thread)` is the debugger hook.

## import/* — the importers (docs/IMPORT-CONTRACT.md, docs/IMPORTING.md)
Pure: each takes already-read data plus resolvers and returns a `Result`; no fs, no DOM, no network.
Load after `world/*` and `script/*` (they use `KIT.project`, `KIT.screenplay`, `KIT.tiles`); `index.html` loads all five (`image.js` is the bare-PNG and audio importer).

`KIT.import.tiled` — `map(json, opts)` · `tileset(json, opts)` · `any(input, opts)` · `detect(input) -> 'map'|'tileset'|null` · `gid(n)` · `fromXml(text)` · `prepare(json, opts)` · `blank()`.
`opts`: `asset(src)->{id,src,w,h}` `tilesets{}`/`tileset(src)` `templates{}`/`template(src)` `inflate(bytes,method)` `prefix` `id`/`name`/`title` `mapId(name)->id`.

`KIT.import.rpgmaker` — `project(files, opts)` · `commands(list, ctx)` · `characters(name, opts)` · `faces(name, opts)` · `detect(files)` · helpers (`tileRect` `autotileOrigin` `tileArt` `tileFlags` `convertText` `routeSteps` …).
`opts`: `asset(src)` `prefix` `tileSize` `imageDir`.

`KIT.import.aseprite` — `sheet(json, opts)` · `file(buffer, opts)` (native pixel art) · `parse(buffer, opts)` · `any(input, opts)` · `detect(input) -> 'sheet'|'file'|null` · `artOf(def, dir)` · `direction(tag)` · `split(tag)` · `tagFrames(from,to,dir)` · `zinflate`/`inflateRaw`.
`opts`: `asset(src)` `inflate` `encodePng(w,h,rgba)` `prefix` `id`/`name` `kind:'sprite'|'tiles'|'faces'|'icons'` `maxPixels` `maxColors` `alphaThreshold`.

`KIT.import.image` — a picture or a sound with no data file: `tileset({ name, w, h, tile, margin, spacing, skip, prefix, id, asset })` (every cell a tile, through the Tiled importer) · `sprite({ name, w, h, columns, rows, order, fps, prefix, id, asset })` (a walk-cycle sheet becomes one sprite) · `audio({ name, kind, src, loop, loopStart, loopEnd, prefix, id })` · `guessTile(w, h, prefer)` `guessGrid(w, h)` `guessAudio(name, bytes) -> 'music'|'sound'` `dirsOf(order)` `AUDIO_EXT` · `fontsFrom(files) -> Result` with `fonts: { id: { name, src: 'data:font/<ttf|otf|woff|woff2>;base64,…', pixel: false } }` (the id from the file's name, `-font` added to one named like a font word; the kind from the file's first bytes, else its ending, never the browser's MIME type) `FONT_EXT` · `base64(bytes)`. `KIT.import.merge` has a `fonts` table (`project.fonts`, no registry) and counts `sounds`, `music` and `fonts` in its report.

`KIT.import.merge(target, result, opts) -> Report` — folds a Result into a project.
`target` is a plain project (merged in place) or a `KIT.document` (one undo step, `"Import <source>"`).
`opts`: `{ prefix, overwrite, dryRun, source, label, register, autotileSet }`.
Writes `project.assets/tiles/sprites/faces/icons/animations/items/vars/scripts/maps` and the top-level fields a Result carries (`meta.title`, `start`, `settings.tileSize`, `terrains`, `autotiles`), and registers tiles/sprites/faces/icons/assets into their registries (`register:false` to skip).
Collisions: free id → added · same value → unchanged (no problem) · different + `overwrite` → replaced · different → `duplicate-id` warn, kept. So a re-import leaves the project identical.
`Report`: `{ problems, added, replaced, unchanged, skipped, ids:{added,replaced,skipped}, label, project, registered, dryRun }` (each count table has `assets tiles sprites faces icons animations maps objects scripts vars items terrains autotiles`).
Also `KIT.import.merge.prefix(result, name) -> result` (namespaces ids and rewrites references; idempotent) and `KIT.import.merge.registerProject(project)`.

`KIT.project.registerContent(project) -> { assets, tiles, sprites, faces, icons, sounds, music, modules }` (world/project) puts a project's own content tables into the registries — imported art has no `js/art/*.js` file, so the project is the file. Called by `KIT.storage.loadProject` before normalize and by `KIT.game.useAssets`.

`KIT.storage.loadProject({ draft, projectId, before })` — `before(rawProject)` runs once the project is found and **before** it is registered from or validated against, so whatever it registers counts. `js/main.js` passes `KIT.modules.activate`: a module's object types, commands and item kinds must exist before the content that uses them is checked, or a game that works is reported as broken.

The CLI is `node tools/import.js <file|folder> [--into js/content/<project>] [--prefix name] [--overwrite] [--dry-run] [--inline] [--tile-size n] [--kind k] [--quiet]`; it detects the format, reads the files, copies images to `<into>/assets/<id>.png`, merges, writes with `KIT.project.exportFiles` and prints the report. `docs/IMPORTING.md` is the author's guide.

## render/atmosphere — stable
Lights and weather over a map, drawn after the world. `KIT.atmosphere.set(spec)` `state()` `update(dt)` `draw(ctx, world, view)` · `lights` `lightDetail` `goal` `reset()` `useMap(map)` `rgba(...)` `BLANK` `LAYERED_DARKNESS`. `tools/experiments/frame.js` holds the frame budget for 128 lights.

## render/text-canvas — stable
Text drawn on the canvas rather than in the DOM (ADR-0007 keeps dialogue in the DOM; this is for names over heads and the like). `KIT.textCanvas.draw(ctx, text, x, y, opts)` `layout(text, opts)` `measurer()` `offsetFor(...)` `writer(...)` — `KIT.drawText` and `KIT.textWriter` are the same `draw` and `writer`.

## render/renderer — stable
`KIT.renderer.create({ canvas, project, editor }) -> r`: `render(world)` · `resize()` · `invalidate(mapId, x, y)` (one baked cell; `invalidate(mapId)` drops that map, `invalidate()` drops all) · `clearCaches()` · `cacheStats() -> { maps, bytes, budget }` · `screenToTile` / `tileToScreen` / `viewTiles` · `setScale` · `setProject`. Baked tile layers per map, byte-accounted and evicted LRU under `KIT.renderer.cacheBudget` (192MB).

Per frame it draws only what is on screen (characters and markers outside the camera plus a three-tile margin are neither sorted nor drawn), and allocates nothing per character.

`KIT.renderer.profile` — `null` by default; set it to `{}` and every frame adds milliseconds into it by phase (`tiles sort entities markers atmosphere scenes overlays`). One property read per phase, so it stays in. `tools/experiments/frame.js` (`npm run experiments`) reads it and fails thresholds — the kept form of every frame-rate figure this engine quotes.

## scenes/stack — stable
`KIT.scenes.push(scene|id, params)` · `run(...) -> Promise<result>` · `pop(result)` · `finish(scene, result)` · `replace` · `clear()` · `top()` · `ids()` · `stack` · `update(dt)` · `input(ev)` · `opaqueTop()` · `draw(ctx, view)`.

A scene is `{ id, transparent, opaque, background, enter(params), exit(result), update(dt), input(ev), draw(ctx, view), suspend(by), resume() }`. Only the top scene gets input; every scene updates (so a map keeps animating under a message); `transparent` leaves the one below on screen; `suspend`/`resume` fire when a scene is covered and uncovered.

**`draw(ctx, view)` is the scene's own canvas.** The renderer calls it every frame, bottom of the stack upwards, after the world and atmosphere and before the pictures and the DOM. `view` is `{ W, H, tilePx, camX, camY, time, world, scale, owned }` — `tilePx` and `camX/camY` are what the world is being drawn with, so a scene can line up with the map; `W`/`H` are the canvas, for one that ignores it.

**`opaque: true`** says the world underneath need not be drawn: the renderer clears to `background` (default black) and hands the frame straight to the scene. That is a battle screen, a title card, a minigame — and it is *cheaper* than a map, because the whole world pass is skipped. `js/modules/bullet` is a worked example: an Undertale-style fight, 334 live bullets at 60fps.

`KIT.dialogueLayout.lines(spans, layout) -> { lines, starts, joins }` (in `scenes/dialogue.js`, pure) — the message box's line breaking when the look starts each line with a mark, turns pages by scrolling, or puts the answers by the box: the lines `KIT.text.wrap` makes, the set of line numbers where a piece the author wrote on its own line begins, and `joins`, a Map from each line that only wrapped to what the wrap took out before it (`' '`, or `''` inside a word too long for the box) — the message box marks those lines `data-join`, so a copy of the page can flow its words again at another width · `pages(lines, n, turn) -> [{ lines, keep, from }]` — what each press of A shows: `'clear'` is `KIT.text.paginate`, `'scroll'` moves up a line at a time (`['a','b','c','d']` two at a time is ab, bc, cd, `keep` 0, 1, 1; the kept lines show at once, and only the new one types) · `place(position, heroFraction, mode) -> position` — `'top'` for a box meant for the bottom when the look's `dialogue.at` is `avoid-hero` and the hero is more than half way down the screen. The message box types at the look's `dialogue.speeds` for the player's text speed (a voice's own `speed` still wins), turns pages the look's way with the `page` sound, and — when the look's answers go by the box — stays on screen until the end of the turn (`#dialogue[data-linger]`), for a question with no words of its own to show as its question. A look's opening (`dialogue.open`) is the class `.is-opening` on the box, put on only when the box comes up after being away: a line said straight after another, or after a question by the box, carries on in the same box. The dialogue and choice scene definitions say `previewable: true`: they take `root` (the host is `KIT.ui.el(id, root)`, so a ShadowRoot works) and `preview` (leave the music alone), and the Look panel's preview drives them off the stack. `KIT.pauseScreen` (in `scenes/menu.js`) — `rows(game, project)` `title()` `hint()`: what the pause menu says, in the look's order and with the look's heading and help line, for the menu scene and the preview alike.

`KIT.ui` (the DOM helpers every scene and panel uses: `el(id, root)` (a ShadowRoot works as the root) `make('div.class', { text, html, attrs })` `button(action, label, cls)` `onAction(root, fn)` `select(list, index)` `clear` `show` `hide` `artCanvas(art, scale)`) · `KIT.fx` (screen effects and pictures: `fadeIn fadeOut tint flash shake weather` `show move erase pictures` `instant reset state update`) · `KIT.toast(text, ms)` (it stays `ms`, else the look's `toast.ms`).

## ui/parts — the look in the page, and the built-in screens' markup
`KIT.look.apply(project) -> Promise` — `use`, then the game's fonts (`fontFaces`) into `<style id="kit-look-fonts">` and the look (`css(project, { faces: false })`) into `<style id="kit-look">` after it, both at the end of `<head>` and each rewritten only when its text changes — so a colour changed at every frame of a drag never makes the browser read the font files again (both empty for the kit look in a game with no fonts) — then `#stage`'s attributes, then `applied` (`css` is what `#kit-look` holds); resolves when the look's own fonts have loaded (`fontsReady(ms)`). `KIT.game` calls it at boot (awaited, before the title) and in `loadProject`. `syncMotion()` — `#stage[data-kit-motion="reduce"]` from the player's Reduce motion setting and `#stage[data-kit-fast]` from `?fast=1`. Under the first the stylesheet stops the kit's own animations (the ▼, the shake, the text effects, the chapter card, the toast); the operating system's reduced-motion setting goes further and stops every animation and transition in `#stage`, a module's included.
`KIT.ui.parts` — each built-in screen's markup, built by one function the scene calls: `dialogueBox(host) -> { host, box, face, name, text, next }` (built unless the host already holds a message box) · `listPanel(host, title, rows, { hint }) -> { host, list }` (rows of `{ label, value, note, action, disabled }`) · `choicePanel(host, { prompt, options, place, promptClone }) -> { host, list, promptBox }` (`place` `above-box`, `in-box` or `beside-box` draws the question in `div.kit-box.kit-promptbox`, holding `prompt` (no line at all when it is empty) or a copy of the message box `promptClone` — beside the box, narrower, with the lines that only wrapped joined again so its words flow at that width — with the answers above it, inside it or beside it; the choice scene sets `#choice[data-place][data-position]`, and `data-bg` from a copied line with no window or a dimmed game behind it, which `css/kit.css` lays out: inside the box the answers wrap onto the lines under the question, and beside it a window too wide to leave the box a third of the width goes over the box's right end) · `titleScreen(host, { meta, items, hint }) -> { host, list }` · `toast(host, text) -> { host, pill }` · `card(host, { title, subtitle }) -> { host, card }` (a chapter card). They build DOM and return the pieces; input, timing and sound stay in the scenes. `KIT.ui.host(id, { after, className })` — the overlay `div#id.overlay` inside `#screen`, made once, directly behind `#after`. `KIT.ui.nav(rects, from, dir, wrap) -> index` (pure) — where an arrow goes among boxes on the screen (`{ left, top, width, height }`): the nearest whose middle lies that way, the distance across the arrow counted twice; with nothing that way, `wrap` goes round to the far end of the same row or column, and without it the index stays. Boxes not laid out (0×0) move in reading order. The choice scene moves with it whenever its answers are side by side (a row, a grid, Yes and No inside the box), and ◀ ▶ step to the next or last answer when `nav` finds none that way (a row wrapped one answer to a line); answers in one column step as they always have.

## game.js — the game
`KIT.game`: `boot({ mount, project })` `booted` · `newGame(opts)` `continueGame()` `enterSave(save, where)` `gotoMoment(id)` (saves are a tree, ADR-0013) · `loadProject(project)` `useAssets(project)` `useAtmosphere` · `openEditor({ mapId })` `resumeFromEditor(project)` `startOwnGame({ blueprint, title })` (the title-screen door) `openMenu()` `canOpenMenu()` (no world, a script holding the world, or the story having locked the menu all say no; ☰ on the map asks) `toTitle()` · `warp(map, x, y, dir)` · `project` `world` `scene()` `renderer` `ports` (the six RunCtx ports, implemented over the scenes, `KIT.fx`, `KIT.audio` and the world) · `press(key, player, ms)` `hold(key, player, down)` `tick(ms)` `rngOverride` (the testability API `e2e/*` drives) · `flags` (`?fast=1 ?edit=1 ?test=<id> ?debug=1`) · `fault(text)` `faults` `guard(fn)` · `setCoop(on)` `swapHero()` `save()` `resize()` `applyButtons()` `wantsButtons()`.

## editor/* — Creator Mode (docs/EDITOR-CONTRACT.md, docs/CREATOR-MODE.md)
Load order (after the game): `editor/ops.js  editor/editor.js  editor/tools.js  editor/inspector.js  editor/panels-map.js  editor/panels-objects.js  editor/script-editor.js  editor/panels-writing.js  editor/panels-project.js  editor/panel-cast.js  editor/look-preview.js  editor/panel-look.js  editor/integration.js`.
Everything visible is a registered panel (`editorPanels`), tool (`editorTools`), field widget (`fieldEditors`) or map section (`mapSections`); nothing writes to the project except through `KIT.editor.ops` or `KIT.editor.commit`, so undo covers all of it.

`mapSections` is the Map panel's Props area, for a module that has something to say about one map: `{ id, label, order, when(project, mapId) -> bool, render(body, { project, mapId, ed }) }`. `when` false keeps the section — and the whole Props box, if nothing else is in it — out of the way. A `render` that throws is caught and named, because it is somebody else's code inside the kit's screen. It exists because the kit used to draw `packs.mons.encounters` itself (ADR-0005).

`KIT.editor` — the shell: `open({game,project,mapId})` `close()` `isOpen()` `state` `set(patch)` `select(sel)` `openMap(id)` `on(event,fn)` `refresh()` `groups()` `groupOf(panelId)` `panelsOf(group)` `repaint()` `commit(label,fn)` `pending(key, fn, ms)` `flushPending()` (a change written once the controls have been still for `ms`, 300 by default; undo, redo, Play here, close and a panel switch flush it first) `beginStroke/endStroke` `undo/redo` `saveNow()` `problemsFor(sel)` `toast/confirm` `playHere({at,testState})` `backToEdit()` `previewWorld()` `tilePixels()` `pointFromEvent(ev)` `zoom(d,at)` `el` `ops`. Events: `change document selection problems mode`.

`KIT.editor.ops` — every project edit as a document transaction: `paint rect fill stamp terrain` (terrain re-bakes the autotiles round the stroke) · `placeObject moveObject deleteObject duplicateObject objectPath setField` · `addPage deletePage movePage` · `newMap deleteMap resizeMap renameMap` · `setScript newCommonEvent declareVar newItem addFragment fragmentToScript` · `newRule deleteRule` · `whereSelection(where)` · `uniqueKey` · `eraseValue problems` · `look.set(doc, path, value)` `look.reset(doc, path)` `look.useBase(doc, id, { clean })` `look.overrides(project)` — every write to `project.ui` (paths inside `ui`): the value is stored as `KIT.look.cleanAt` cleans it (one it cannot clean is not written), a value equal to the inherited one is a reset, a parent the write needs is made by a write of its own so undo takes it away, and an empty part goes, `ui` included · `look.addFont(doc, { id, name, src, pixel, px }) -> id` (into `project.fonts`; the same file twice is one font, a clash of names takes the next free id) · `look.editFont(doc, id, patch)` (`{ pixel, px }`; `null` takes the font out, with the look's uses of it, and an empty `fonts` goes too).

`KIT.editor.lookPreview` — `mount(el, { project, onPick }) -> { show(tab, again), mode('edit'|'try'), tab(), destroy() }` (the Look panel's live preview, a shadow root holding a copy of the game screen with the real dialogue and choice scenes driven into it) · `sample(project, look?) -> { who, face, text }` (the line it types; with a `look` whose pages scroll up a line, it runs a page longer, so Try has a page to scroll to). `KIT.editor.lookPanel.sectionOf(path)` — which Look section a path inside `ui` is set in · `sectionFor(path) -> [section, field]` — the same for a problem's whole path, `['fonts', id]` (Fonts) included. `KIT.editor.inspector.messagePages(text, project)` — the pages the look's message box makes of a line, as rows of text (the Show Text form's preview), paged the look's way: with `dialogue.pageTurn: 'scroll'`, what each press of A shows.

`KIT.editor.tools` — the pure part of the nine map tools: `line rectCells floodCells sameValue COLLISION collisionAt collisionCycle brushFor remember paintCells valueAt gridFor describe drawGhostCell outlineArea terrainColor regionColor lockScale byId`.

`KIT.editor.inspector` — one form builder for any schema field list: `mount(el,{fields,value,onChange,ctx,problems}) -> { refresh, destroy, value }` · `field editorFor knownTypes buildValue defaultFor hasDefault isDefault visibleFields enumOptions` · refs `refList refLabel refExists refMissing canCreateRef createRef` · routes `ROUTE_VERBS routeStepLabel routeSummary` · conditions `conditionKinds newCondition conditionText conditionFromText conditionSays` · `scriptSummary openScript(ref)` · `pickOnMap({hint,onPick,onCancel})` (tap-then-tap on the map) · `spriteCanvas tileCanvas regionColor emptyState btn messagePages`. Widgets: an `enum` with `display: 'chips'` is a row of chips; a `string` with `display: 'chips'` and `options` offers them over its box; a `nullable` colour has a chip named `noneLabel`, and while empty its square shows `ctx.noneColour(field)` when the form gives one; a `font` (a look's) is a chip for each of `ctx.project.fonts` and each font word, each written in itself, with "Add a font…" when the form gives `ctx.addFont(field)`; a `text` with `display: 'message'` (what Show Text, a sign or a person says) shows the pages the look's message box makes of it (`messagePages`), drawn again when the look is applied with different lines, mark, width or page turn, and any other text shows none. A look's `font` has no chip to type a family's name: the sanitiser keeps only the game's own fonts and the words there.

`KIT.editor.objects` — `references(project,id)` `rename(doc,{map,id,to})` (rewrites every reference) `placePreset(doc,{preset,map,x,y,input})` `pageOrder(project,mapView,obj)`.

`KIT.editor.scriptEditor` — `open(el,{path,ed})` / `open({path,selection,label})` · `describe branches newCommand labelOf serialize parse roundTrip commitText commandsAt pathForSelection labelForSelection insert move duplicate remove setDisabled pickerGroups recentIds noteUse setTarget target`.

`KIT.editor.writing` — `textIndex(project)` `selectionFor explain fragmentTags matchFragment fragmentToSlot firstLine`. `KIT.editor.projectPanels` — `varIndex usageSelection usageLabel dataPath checkData guessType`. `KIT.editor.importPanel` — `dispatch(files)` `imageSize(bytes)`.

`editor/integration.js` — what lives beside the shell: Delete with a page selected deletes its event, `ED.fitMap()`, the tab strip, Play here starting at the cursor with the story state you were playing, Escape/▸ Back out of play mode, and `close()` handing the player back to the game instead of the title. `ED.emptyState()` is in inspector.js; `ED.afterEdit()` is the shell's own, for a panel that wrote the document some other way than `ED.commit`. `KIT.game.openEditor({mapId})` / `KIT.game.resumeFromEditor(project)` are the game's half of that. `KIT.game.startOwnGame({ blueprint, title })` is the title screen's door: build the blueprint, keep the modules the current game had on, register its content, save the draft at once, open Creator Mode on its first map.

## core/modules.js — the module system
`KIT.module(def)` registers a manifest (`{ id, version, label, requires, describe, register(KIT), save, content }`; see `docs/MODULES.md`) ·
`KIT.modules.all()` `loaded()` `get(id)` `has(id)` ·
`order(ids) -> { order, missing, cycles }` (a pure topological sort) ·
`activate(project)` (registers the modules `project.modules` names, in dependency order; a missing requirement or a cycle is a banner; already-loaded modules are skipped) ·
`forget(id)` (unsay the declaration entirely — for tests).

The two declarations, which the engine acts on so a module does not have to:
`saveSection(save, id)` fills, migrates and repairs `save.modules[key]` and writes it back — `KIT.world.create` calls it for every loaded module, so a module's code can assume its section is there and current ·
`ensureSaves(save)` does all of them ·
`pack(project, id)` → the filled content slice without mutating the project ·
`ensurePacks(project)` writes each one back (called by `KIT.project.normalize`) ·
`problems(project)` validates each declared `fields` against `project.packs[key]` (called by `KIT.project.validate`).

## main.js — the page's entry point
`KIT.banner(text)` · `KIT.problems` (the project's validation, filled in after boot) · `KIT.PRISTINE_HTML` (the page as authored — `KIT.storage.publish` rebuilds from this, never from the live DOM). It loads the project, activates its modules through `loadProject({ before })` and boots the game; the module system itself is the engine's, above.
`tools/load-modules.js` is the Node-side equivalent for the build and the tests: `require('./tools/load-modules.js').load(KIT, ['mons','home'])` requires each module's files in order and calls `activate`.

## The module namespaces
Each module owns one global under `KIT`, one key in `save.modules` and one in `project.packs`. Nothing in `js/kit/**` mentions any of them; a module that is loaded but not listed in `project.modules` registers nothing and its namespace is inert. The full API of each is in its own `js/modules/<id>/README.md` — this is the surface another module or a game script may use.

### `KIT.mons` — Pokémon (`js/modules/mons/`)
Save `save.modules.mons` · content `project.packs.mons` · registry `monSpecies` · ref kind `ref:mon`.
Species: `registerSpecies(list)` `species(id)` `speciesList()` `speciesName(id)` `speciesColor(id)` `bst(src)` `rarity(id, project)` `rarityForBst(n)` ·
Content/state: `pack(project)` `contentDefaults()` `section(save)` `read(save)` `migrateSave(data)` `saveDefaults()` `t(project, key, vars)` ·
The friends: `create(opts)` `add(s, mon, opts)` `all(s)` `find(s, uid)` `owns(s, id)` `move(s, uid, where)` `reorder` `partyFull(s)` `setFollower(s, uid)` `follower(s)` `displayName(mon, project)` ·
Friendship (**the one number**): `addFriendship(mon, d)` `setFriendship(mon, v)` `friendshipTier(n)` `walkFriendship(s, steps, opts)` `pet(s, uid, opts)` `giveBerry(s, uid, opts)` `resumeBonus(s, elapsedMs, opts)` `newVisit(s)` ·
Mood: `moodFor(mon, { project, save, day })` `moodLabel(project, mon, opts)` `provideMood(fn)` — **another module may own how a friend feels**; `fn(mon, o) -> { id, label }`, `label` already in words ·
Catching: `profile(project, id)` `newCatchState(opts)` `applyAction(state, action, opts)` `catchChance(opts)` `ringBand` `ringQuality` `resolveThrow` `shouldFlee` ·
Dex and encounters: `see(s, id)` `markCaught(s, id, at)` `dexCounts(s)` `isNew(s, id)` `encounterTable(map, project)` `rollEncounter(table, region, rng)` `gardenArea(map)` `gardenSpots(...)` ·
Art (**the one place a portrait comes from**): `portrait(id)` `icon(id, size)` `artFor(mon)` `iconFor(mon, size)` `spriteId(id, shiny)` `ensureSprite(id, shiny)` `spriteFor(mon)` `placeholder(w,h,color)` `typeColor(t)` ·
Doing: `grant(ctx, opts)` `startEncounter(ctx, opts)` `adjustFriendship(ctx, opts)` `starterHook(world)` `openScene(id, ctx, params)`.
Emits on the world bus: `monsChanged`, `friendCared { uid, what }` (somebody was petted or fed), `sessionResumed` (only if nobody else did).

### `KIT.home` — what there is to do afterwards (`js/modules/home/`)
Save `save.modules.home` · content `project.packs.home`.
Clock (**the one clock**): `now(save)` `addMinutes(save, n)` `clockText(save)` `durationText(min)` — all against the kit's own `save.clock` (`KIT.clock.stamp` / `KIT.clock.resume` are the kit's), and the system only drives it when `project.settings.clock` does not ·
Content/state: `pack(project)` `tuning(project)` `contentDefaults()` `tuningDefaults()` `TUNING` `ensure(save)` `defaults()` `migrations` ·
Who is here: `provideRoster(fn)` `roster(project, save)` `worker(project, save, uid)` `friendshipBand(n)` — the roster comes from `KIT.mons` when it is loaded, the heroes when it is not, and `fn` when a module provides one. Each entry is `{ uid, name, kind, type, types, friendship, sprite }` and `sprite` is a **registered sprite id** ·
Friendship: `awardFriendship(ctx, uid, amount)` — hands it to whoever owns the friend, through the `friendship` command in the `commands` registry; a quiet no-op when nobody does ·
Jobs: `JOB_FIELDS` `templatesOf(page)` `boardTemplates(project, board)` `startJob(save, opts)` `collectJob(save, id, opts)` `jobsOut(save)` `jobsReady(save, now)` `isOut(save, uid)` `isReady(job, now)` `remaining(job, now)` `jobLine(project, worker, job, reward)` ·
Moods (**the one mood**): `MOODS` `MOOD_IDS` `moodOf(save, uid)` `setMood(save, uid, mood, now)` `react(save, uid, event, now)` `driftMoods(save, project, now)` `nextMood(...)` `moodLine(project, worker, mood)` `moodLabel(project, mood)` `moodFor(project, save, uid)` ·
Furniture: `furnitureItems(project)` `place(save, opts)` `pickUp(save, id)` `placedOn(save, map)` `itemName(project, id)` ·
Gifts and housekeeping: `rollGifts(save, project, now)` `placeGift(save, project, gift)` `sweep(world, opts)` `live(world)`.

### `KIT.dungeon` — room-to-room crawling (`js/modules/dungeon/`)
Save `save.modules.dungeon` · content `project.packs.dungeon`. Used by the `dungeon` template.
`tuning(project)` `contentDefaults()` `TUNING` `ensure(save)` `defaults()` `migrations` `hasKey` `isOpen` `tryOpen` `blockAt` `setBlock` `canPush` `switchOn` `setSwitch` `plateHeld` `gateOpen` `switchNames` `torchLight` `lightTorch` `putOut` `isDark` `describe` — all pure; `live(world)` `onMapEnter` `tick` `entityFor` `pushEntity` `listen` are the wiring, and `panel.js` is a form. The dark is the kit's own `KIT.atmosphere` (`map.props.atmosphere = { darkness, ambient }`), and the lantern is `hero.data.light`.

`KIT.bullet` — a bullet-hell fight as an add-on (`js/modules/bullet`). Save `save.modules.bullet` · content `project.packs.bullet`. `PATTERNS` (`rain sweep hunt ring`, each `(f, count) -> pattern`) `pattern(steps)` `runPattern` `patternDone` · `spawn` `movers` `steer` `step` · `create(...)` `registerAll()` `MANIFEST` `VERSION`.

## Still to build
Nothing in the engine. `core/*`, `world/*`, `script/*`, `render/*`, `scenes/*`, `game.js`, `main.js`, `index.html`, `css/*`, `import/*` and `editor/*` are written and covered by `npm test` plus `npm run e2e`: nineteen browser play-throughs in `e2e/` and one beside the mons module, every one wired in (`test/kit/docs.test.js` fails on an orphan).
What the engine still **owes** its modules — seventeen hooks each of them had to work around — is the punch list in `docs/ENGINE-HOOKS.md`.
