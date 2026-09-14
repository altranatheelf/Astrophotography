# KIT API reference

Everything the engine exposes, in load order. Written for the people (and
agents) building the runtime UI, the editor and modules. `§` refers to
`ARCHITECTURE.md`. Files marked **stable** are tested and should not be edited
without a reason.

Load order (classic scripts, no modules):
```
core/util.js  core/events.js  core/rng.js  core/registry.js  core/schema.js
core/registries.js  core/pixels.js
world/document.js  world/project.js  world/tiles.js  world/map.js  world/entities.js  world/world.js
script/text.js  script/conditions.js  script/commands.js  script/screenplay.js  script/interpreter.js
systems/index.js        (then: scenes, render, game — being built)
```
(`script/*` must load before `world/project.js` validates scripts, and before
`world/world.js` runs them; the test loader `test/kit/_load.js` has the exact order.)

## core/util — stable
`KIT.deepClone(v)` · `KIT.deepEqual(a,b)` · `KIT.stableStringify(v, indent)` (sorted keys) ·
`KIT.uid(prefix)` · `KIT.slug(s)` · `KIT.clamp(v,lo,hi)` · `KIT.isObject(v)`

## core/events — stable
`KIT.events(name) -> bus` with `on(event,fn) -> off`, `once`, `off`, `emit(event,payload) -> count`, `count`, `clear`.
`'*'` listeners receive `(event, payload)`. A throwing listener never stops the others. `KIT.bus` is the global one.

## core/rng — stable
`KIT.hash(...parts) -> uint32` · `KIT.rng(seed) -> fn()` with `.int(n) .range(lo,hi) .pick(arr) .chance(p) .weighted(items,key) .shuffle(arr) .fork(label)`.
Every random decision in the kit goes through one of these; same seed, same run.

## core/registry + core/registries — stable
`KIT.defineRegistry(name, { fields, onAdd, onRemove, doc }) -> reg` (idempotent) · `KIT.registry(name)` (throws if undefined) · `KIT.registry.exists(name)`.
Registry: `add(def)` (fills defaults, validates against `fields`, warns on replace unless `def.replace`), `addAll`, `get`, `require`, `has`, `list`, `ids`, `size`, `remove`, `clear`, `on('add'|'remove')`, `groups(key)`.
Standard registries: `tiles sprites faces icons sounds music objectTypes behaviours commands conditions itemKinds systems scenes menus editorPanels editorTools fieldEditors validators presets migrations strings`.
`KIT.registry('tiles').stamps` is the multi-tile brush list.

## core/schema — stable
One field declaration drives the form, the validator, defaults, and the usage index.
`{ key, type, label, doc, default, nullable, optional, min, max, integer, pattern, options|optionsFrom, of, fields, array:{min,max}, when:{field,eq|neq|in|truthy}, display, access:'read'|'write', ref:{scope,tag,symmetrical} }`
Types: `string text note number bool enum color position direction region route script condition strings scalar list group tile face` and `ref:<kind>`.
API: `KIT.schema.field(f)` · `fields(list)` · `validate(fields, value, ctx) -> [{path,message,code}]` · `validateValue(field, v, ctx)` · `defaults(fields, ctx)` · `defaultFor(field)` · `fill(fields, value, ctx)` · `refs(fields, value, ctx) -> [{kind,id,path,access}]` · `walk(fields, value, fn)` · `visible(field, siblings)` · `defineType(name, handler)` · `refKind(kind, resolver)` · `registryRefKind(kind, registryName)` · `projectRefKind(kind, table)`.
Ref kinds wired: tile sprite face icon sound music preset map item script var fragment object (+ modules add their own).

## core/pixels — stable
Art is `{ w, h, palette:{ch:'#hex'}, rows:[...] }` or `frames:[rows,...]`, or image-backed `{ image, frame:{x,y,w,h} }`.
`KIT.pixels.canvas(art, { scale, mirror, recolor, frame, tint })` (cached; browser only) · `draw(ctx, art, x, y, opts)` · `downscale(art, size)` · `silhouette(w, h, color)` (**the placeholder for missing art — never crash**) · `validate(art)` · `dims(art)` · `rowsOf(art, frame)` · `frameCount(art)` · `paletteWith(art, map)` · `invalidate(art)` · `artOf(def)`.

## world/document — stable
`KIT.document(project, { maxSnapshots }) -> doc`: `value`, `get(path)`, `has(path)`, `apply(ops, {label}) -> inverse`, `set/del/splice/push`, `transaction(label, fn)` (one undo step; nested flatten), `undo()`, `redo()`, `canUndo/canRedo`, `history`, `watch(prefixPath, fn) -> off` (fn gets `{ops, inverse, label, kind, seq, paths}`), `replace(next)`, `snapshot(label) -> id`, `snapshots()`, `restore(id)`, `deleteSnapshot(id)`, `dirty`, `markClean()`, `clearHistory()`.
Ops: `{op:'set',path,value}` `{op:'del',path}` `{op:'splice',path,index,remove,insert}`. `set` creates missing intermediates as objects.
`KIT.path.get/has/join/parse/isPrefix/related`.

## world/project — stable
`KIT.project.VERSION=3` · `SLOTS=['interact','step','touch','enter','tick','init']` · `LAYERS=['terrain','ground','deco','above','regions']` · `GROUND_BY_KIND` · `MAP_KINDS`.
`normalize(project, ctx) -> { project, problems }` (migrate chain → fill every default → validate; never mutates the input) · `validate(project, ctx) -> Problem[]` · `migrate(project)` · `fillMap/fillObject/fillPage/fillItem/fillVar` · `newMap({id,name,width,height,kind})` · `newObject` · `resize(map,w,h)` · `blank()` · `clone(p)` · `uniqueObjectId(map, base)` · `buildPreset(presetOrId, ctx)` · `walkScripts(project, fn)` · `walkCommands(project, fn)` · `collect(project) -> { vars:{name:{reads,writes,declared}}, refs }` · `known(kind,id,project)` · `cellSolid(map,x,y)` · `stringify(value,opts)` · `exportFiles(project) -> { 'project.js', 'maps/<id>.js' }` · `importFiles(files)` · `fromContent(projectId)` · `parseFile(text)`.
Problem: `{ severity:'error'|'warn', code, message, where:{ map, object, page, slot, script, path } }`.
Project v3 shape: see §5 — `version meta modules settings strings heroes start vars items scripts fragments testStates autotiles terrains world maps packs`.

## world/tiles — stable
`KIT.tiles.def(id)` · `flags(id) -> { solid, passage:{n,s,e,w}, bush, counter, ledge, warpLook, encounter, terrainTag, probability, animMs, exists }` · `passage(tile, dir)` · `frameAt(tile, timeMs)` · `bake(map, project, { around, radius, seed }) -> { ground, deco, changed }` (pure, deterministic per cell) · `rulesFromTemplate({groupId, terrain, tiles:{center,n,s,e,w,ne,nw,se,sw,inner*}, against})` (the autotile wizard) · `remapGroup(group, from, to, tileMap)` · `ruleRadius(set)` · `ownedTiles(set, layer)` · `ANY/EMPTY/DEFAULTS`.
Tile registry entry: `{ id, name, group, art|frames, solid, passage, bush, counter, ledge:'down', warpLook, encounter, terrainTag, probability, animMs }`.

## world/map — stable
`KIT.mapView(project, save, mapId) -> view` — the authored map composed with `save.overlays[mapId]`.
`view.id width height kind music index(x,y) inBounds tileAt(layer,x,y) terrainAt region collisionAt flagsAt(x,y)` (merged over ground/deco/above + collision override) ·
`passable(x, y, dir, who) -> { ok, reason, to, hop, connection }` — reasons: `step hop through connection turn | tile edge edge-in edge-out ledge ledge-blocked entity direction` ·
`hopTarget(x,y,dir)` · `connectionAt(x,y,dir) -> {map,x,y,dir}` · `interactTarget(x,y,dir) -> { first, second, across }` (counter reach) ·
`objects objectsAt(x,y) objectKey(obj) -> 'map:id'` · `objectState(obj)` · `isHidden(obj)` · `positionOf(obj)` · `activePage(obj, ctx) -> { page, index }` (**the LAST page whose `when` passes**) · `setBlockers(list)` · `overlayCells()`.
`KIT.DIRS` `KIT.OPPOSITE` `KIT.delta(dir)`.

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
`move(heroIndex, dir, opts) -> Promise<result>` (d-pad; bump sound, companion trail, `step` slots, map connections) ·
`runSlot(entity, slot, heroId)` (main-thread slots set `world.busy`; `once` sets `self.done`; `needsBoth` gates in co-op; NPCs face the hero and turn back) ·
`makeCtx(entity, heroId) -> RunCtx` · `ctxBase()` · `refreshPages()` · `rebuildEntities()` · `stepTriggers(hero)` · `runSlotsForMap(slot)` · `hero(i)` · `heroById(id)` · `setActiveHero(i)` · `saveHeroPositions()` · `update(dt)` (runs systems in order).
Events emitted: `mapEnter mapLeave step interact activeHero needsBoth` plus everything commands emit (`varChanged selfChanged itemChanged objectStateChanged timerChanged heroRenamed heal debug`) and `clockTick`.

## systems/index — stable
Registered systems, in order: `movement(10)` (interpolation, arrivals, NPC touch) · `behaviours(20)` (`none look wander route approach` in the `behaviours` registry) · `triggers(30)` (background `tick` slots, one at a time per object) · `companions(40)` · `clock(50)` · `camera(90)`.
`KIT.camera.update(world) -> {x,y}` centres on the active hero, clamps to the map, centres small maps.
Add your own: `KIT.registry('systems').add({ id, order, update(world, dt), onMapEnter, onMapLeave })`.

## script/text — stable
`KIT.text.substitute(str, ctx)` (`{p1} {p2} {p} {var:x} {self:k} {item:id} {hero} {arg:n}`, `KIT.text.tags` for module tags) · `tokenize(str) -> spans` (codes `{pause} {pause:ms} {wait} {fast} {instant} {color:x}…{/color} {icon:id} {size:big}…{/size} {shake}`, `\n`, `{{`/`}}` escapes) · `strip` · `plain(str,ctx)` · `wrap(spans, { width, measure })` · `paginate(lines, linesPerPage)` · `render(str, ctx, layout) -> pages` · `escape/unescape` · `contextFrom(ctx)`.
`KIT.strings.get(project, key, vars)` — Terms table: registry defaults, overridden by `project.strings`.
`KIT.script.values`: `format(v,{bare})` `parseBare` `scan(str,i,stops)` `tokenize(str,{separators})` `pairs` `BARE WORD NUMBER`.

## script/conditions — stable
Kinds: `var self item facing button timer region tile meta clock coop all any not` (+ module kinds).
`KIT.conditions.test(cond, ctx) -> bool` · `describe(cond, ctx)` · `normalize` · `validate` · `refs` · `toText(cond)` / `parseText(str)` / `tryParseText` (the `when:` text syntax: `chapter >= 2 and not item.berry >= 1`, `self.opened == true`, `meta.runs > 0`, `kind(key=value)`, `always`/`never`) · helpers `getVar getSelf count target targetLabel heroId heroIndex compare objectKey withDefaults`.
ctx for conditions: `{ world:{ save }, project, self:'map:obj', hero:'p1', coop }`.

## script/commands — stable
`KIT.commands`: `exec(ctx, cmd)` · `summary(cmd, ctx)` · `validateScript(cmds, ctx)` · `refs(cmds, ctx)` · `walk(cmds, fn)` · `nested(cmd)` · `blockFields(def)` · `normalize(cmd)` / `normalizeAll` · `toLine/fromLine` · `genericToLine/genericFromLine` · `option.toLine/fromLine` · `keysFor` · `state.{getVar,setVar,getSelf,setSelf,count,give,heroName,setHeroName}` (every write emits its event) · `get/list/ids`.
Commands (id — MV label): say choice inputNumber scrollText · setVar setSelf timer · if loop break label jump exit call comment wait group · give take nameEntry · transfer setLocation moveRoute scrollMap follow · transparency animation balloon erase · fadeOut fadeIn tint flash shake weather · pictureShow pictureMove pictureErase · music sound stopSound saveMusic replayMusic jingle · menu save title chapter heal debug.
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

## Still to build
`scenes/*` (stack + title/map/dialogue/choice/nameEntry/chapter/menu/transition/debug), `render/*`, `core/input.js`, `core/audio.js`, `core/storage.js`, `game.js`, `main.js`, `index.html`, `css/kit.css`, then `editor/*` and `modules/mons/*`.
