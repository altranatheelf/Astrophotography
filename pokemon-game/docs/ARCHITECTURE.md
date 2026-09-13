# Pokémon Adventure Kit — architecture & contract

A top-down, pixel-art, Pokémon-style **story adventure** for two people to play
on one device — with a built-in **Creator Mode** so the author can draw the
maps, place characters, write the dialogue and shape the story themselves
(think: a tiny RPG Maker that lives inside the game). Catching and collecting
Pokémon is a core loop; there are NO traditional battles in v1. Everything
runs as plain HTML/CSS/JS from `file://`, no framework, no build step, classic
scripts only (no ES modules — Chrome blocks them over `file://`).

One global namespace: `window.PKMN`. Every file begins with
`window.PKMN = window.PKMN || {};`. Data/engine files that tests `require()`
use this shim (each file returns the SAME shared object on globalThis):

```js
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  // ... define things on PKMN ...
  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
```

Tests: `node --test test/` from `pokemon-game/`. Browser checks: Playwright 1.56 +
Chromium are installed globally (`export NODE_PATH=$(npm root -g)`), load with
`page.goto('file:///home/user/Astrophotography/pokemon-game/index.html')`.

## File map & load order (index.html)

```
js/data/types.js, moves.js, pokemon.js   PKMN.TYPES / MOVES / POKEMON / ROSTER   (exist — 32 Pokémon)
js/sprites/<id>.js                       PKMN.SPRITES[id]   32×32 Pokémon portraits (3 exist; 29 being drawn)
js/art/tiles.js                          PKMN.TILES         registry + stamps (exists)
js/art/tiles-nature.js, tiles-town.js, tiles-interior.js   PKMN.TILES.register([...])  16×16 map tiles  [art]
js/art/chars.js                          PKMN.CHARS         registry (exists)
js/art/chars-heroes.js, chars-npcs.js    PKMN.CHARS.register([...])  16×24 walking sprites  [art]
js/art/icons.js                          PKMN.ICONS         small UI icons                     [art]
js/core/pixels.js                        PKMN.Pixels        pixel-string → canvas, cache, mirror, recolour, downscale
js/core/input.js                         PKMN.Input         keyboard + on-screen d-pad/A/B, 1 or 2 players
js/core/audio.js                         PKMN.Audio         WebAudio SFX + chiptune music
js/core/storage.js                       PKMN.Storage       localStorage, export/import, artifact republish
js/engine/project.js                     PKMN.Project       project schema, defaults, validate, migrate
js/data/project.js                       PKMN.DEFAULT_PROJECT   the demo world (a small, charming starter)
js/engine/map.js                         PKMN.MapRenderer / PKMN.MapLogic   layers, animation, collision, warps, camera
js/engine/entities.js                    PKMN.Entities      heroes, partner-follow, NPC movement, Pokémon followers
js/engine/script.js                      PKMN.Script        event command interpreter, flags/vars/items
js/engine/dialogue.js                    PKMN.Dialogue      text box, typewriter, choices, name plate
js/engine/pokemon.js                     PKMN.Mons          caught Pokémon, party/box, Pokédex, encounters, catch scene, garden
js/engine/game.js                        PKMN.Game          scene stack + state machine, save/load, new game, settings
js/ui/menus.js                           PKMN.Menus         title, pause menu, Pokémon list, Pokédex, bag, settings, save
js/editor/editor.js (+ editor/*.js)      PKMN.Editor        Creator Mode
js/main.js                               boot
css/style.css
```

## 1. Pixel-art format (shared by tiles, characters, icons, Pokémon sprites)

```js
{ w: 16, h: 16, palette: { g: '#58b848', G: '#3c8c30', ... }, rows: [ '16 chars', ... 16 rows ] }
```
`.` = transparent. Every non-`.` char must be in `palette`; every palette key
must be used. Multi-frame art uses `frames: [rows, rows, ...]` instead of
`rows`. Pokémon portraits (existing files) use `size: 32` + `rows`.

`PKMN.Pixels`:
```js
Pixels.canvas(art, { scale=1, mirror=false, recolor={ from:'#hex', to:'#hex' } | { key:'#hex' }, frame=0 }) -> HTMLCanvasElement  (memoised by a key of all options)
Pixels.draw(ctx, art, x, y, opts)          // draws the (cached) canvas at integer coordinates
Pixels.downscale(art32, 16) -> art         // nearest-neighbour 32→16 for Pokémon overworld icons (keeps the palette; drops '.')
Pixels.silhouette(w, h, color) -> art      // placeholder when art is missing — never crash on missing art
Pixels.validate(art) -> string[] errors
```

## 2. Tiles — `js/art/tiles.js`

```js
PKMN.TILES = {
  list: [ { id:'grass', name:'Grass', group:'nature', art:{...}, solid:false, encounter:false,
            frames:[art,art] /* animated, ~0.5 s per frame */, ledge:'down' /* one-way */, warpLook:true /* door/stairs/mat */ } ],
  byId: { grass: {...} },
  stamps: [ { id:'big-tree', name:'Big tree', group:'nature', tiles: [['tree-tl','tree-tr'],['tree-bl','tree-br']] },
            { id:'house-red', name:'Red house (5×4)', tiles: [[...],[...],[...],[...]] }, ... ],
  groups: ['nature','town','interior','cave'],
}
```
Required tile ids (draw ALL of them; `*` = solid; `~` = animated 2 frames):
- **nature**: grass, grass-2 (variant with tufts), tall-grass (encounter), flowers-red, flowers-yellow, flowers-blue, path, path-edge-n, path-edge-s, path-edge-e, path-edge-w (grass on that side), sand, water*~, water-lily*~, rock*, boulder*, tree-small*, tree-tl*, tree-tr*, tree-bl*, tree-br*, bush*, hedge*, stump*, log*, ledge-down (ledge: 'down' — walkable only from north to south; a little jump), bridge-h, bridge-v, cave-floor, cave-wall*, cave-rock*
- **town**: fence-h*, fence-v*, fence-post*, sign*, mailbox*, lamp-post*, bench*, flower-pot*, roof-red*, roof-red-eave*, roof-blue*, roof-blue-eave*, roof-green*, roof-green-eave*, wall*, wall-window*, door (warpLook), lab-wall*, lab-window*, lab-door (warpLook), pokeball-item (a pokéball lying on the ground — used by item objects)
- **interior**: floor-wood, floor-tile, carpet-red, carpet-blue, rug, wall-in-top*, wall-in* (wall face), window-inner*, poster*, exit-mat (warpLook), stairs-up (warpLook), stairs-down (warpLook), bed-top*, bed-bottom*, table*, chair*, bookshelf*, pc*, tv*, plant*, counter*, fridge*, stove*, cushion, crate*
Stamps required: big-tree (2×2), house-red (roof-red 5×2 with roof-red-eave on row 2, then wall/wall-window/door/wall-window/wall, and the same for house-blue and house-green), lab (lab-wall/lab-window/lab-door, 7×4 with roof-blue), bed (bed-top over bed-bottom).
Style: 16×16, GBA-era cheerful palette (grass ≈ #78c850 / #58a838 shades), 1-px darker outlines on objects, no pure black except tiny details; tiles that repeat (grass, path, water, floors) must tile seamlessly — check a 3×3 repetition.

## 3. Characters — `js/art/chars.js`

```js
PKMN.CHARS = {
  list: [ { id:'hero-boy', name:'Hero (boy)', group:'hero', w:16, h:24, palette:{...},
            frames: { down:[rows,rows,rows], up:[...], left:[...] } } ],   // right = mirrored left
  byId: {...},
  recolorable: { 'hero-boy': { hair:'#5a3a1a', shirt:'#e04040', pants:'#3060c0' } },   // palette keys the editor lets the author swap
}
```
Frame order per direction: `[stand, stepA, stepB]`; the walk cycle plays
stand → stepA → stand → stepB. 16 wide × 24 tall; the feet sit on the bottom
row, the head overlaps the tile above. Big readable heads (GBA/FRLG style), 1-px
dark outline (dark colour, not pure black).
Required: hero-boy, hero-girl, kid-boy, kid-girl, woman (mom), man (dad),
grandpa, grandma, professor (lab coat), nurse, clerk (apron), trainer (girl in a
cap), plus `pokeball` (16×16, 1 frame, used for item objects) — no, use the tile.

## 4. Icons — `js/art/icons.js`

`PKMN.ICONS = { byId: { pokeball: art16, berry: art12, 'golden-berry': art12, heart: art8, 'heart-empty': art8, arrow: art8, sparkle: art8, star: art8, bag: art16, pokedex: art16, save: art16, gear: art16, map: art16, play: art16, pencil: art16, note: art8, speaker: art8, hand: art8, exclaim: art8, question: art8, zzz: art8, key: art12, egg: art16 } }`.

## 5. Project (the world) — `js/engine/project.js` + `js/data/project.js`

```js
{
  version: 1,
  title: 'Our Adventure', subtitle: 'for you ♥', author: '',
  heroes: [ { name:'Player 1', sprite:'hero-boy', recolor:{} }, { name:'Player 2', sprite:'hero-girl', recolor:{} } ],
  start: { map:'home', x:5, y:6, dir:'down' },
  intro: [ /* commands run once on New Game, before control */ ],
  items: { pokeball:{ name:'Poké Ball', icon:'pokeball', kind:'ball', desc:'...' }, berry:{ kind:'berry', ... }, 'golden-berry':{...}, ... },
  settings: { encounterRate: 12 /* % per step in tall grass */, catchDifficulty: 'normal', followers: true, coop: false, textSpeed:'normal' },
  garden: 'garden',                      // id of the map where caught Pokémon roam
  mapOrder: ['home','town','lab','route','garden'],
  maps: {
    home: {
      id:'home', name:'Home', width:12, height:10, music:'house', kind:'indoor'|'outdoor'|'garden',
      layers: { ground: [ 'floor-wood', ... width*height ids ], deco: [ null|id ... ], above: [ null|id ... ] },
      collision: [ 0|1|null ... ]          // null = derive from tiles; 1 forces solid; 0 forces walkable
      encounters: { rate: null /* null = settings default */, table: [ { id:'pikachu', weight:5 } ] },
      objects: [ Object ... ],
    }, ...
  }
}
```
Objects (things on a map with behaviour):
```js
{ id:'mom', type:'npc', x:4, y:5, sprite:'woman', dir:'down', move:'none'|'wander'|'look'|'path', path:['up','left'], name:'Mom',
  trigger:'interact'|'step'|'auto', once:false, needsBoth:false,
  condition: { flag:'met_mom', is:false } | { var:'coins', op:'>=', value:3 } | null,   // object is present only when true
  hiddenByFlag: null | 'flag_name',      // hides the object while the flag is true (cheap "it's gone now")
  event: [ Command... ] }
type:'sign'    -> look:'sign' (tile id drawn at the position), trigger interact, solid
type:'item'    -> look:'pokeball-item', item:'berry', count:1, once:true  (picking it up: sparkle + "Found a Berry!" + sets doneOnce)
type:'warp'    -> to:{ map:'town', x:10, y:12, dir:'down' }, look:null (invisible; put it on a door/mat/stairs tile), trigger:'step', sound:'door'
type:'trigger' -> invisible, trigger:'step'|'auto', event
type:'pokemon' -> a Pokémon standing in the world: mon:'eevee', wild:true (interact = catch scene) | wild:false (a friendly Pokémon that talks: event)
```
Commands (the event script language — each `{ t: ... }`):
```
say        { who:'Mom', text:'Hi {p1}! ...' }      // {p1} {p2} hero names, {p} the hero who triggered, {mon} last caught, \n new line; long text auto-pages
choice     { prompt:'Ready?', options:[ { text:'Yes', then:[...] }, { text:'Not yet', then:[...] } ] }
if         { flag:'x', is:true, then:[...], else:[...] } | { var:'coins', op:'>='|'<'|'=='|'!=', value:3, then, else } | { item:'berry', count:1, then, else } | { has:'pikachu', then, else } | { dexCount:5, op:'>=', then, else }
set        { flag:'x', value:true }
var        { name:'coins', op:'set'|'add', value:1 }
give       { item:'berry', count:1 }               // shows "Got 1 Berry!"
take       { item:'berry', count:1 }
givePokemon{ mon:'eevee', nickname:'' }             // catch fanfare, dex registers, joins party (or box if full)
warp       { map:'town', x:10, y:12, dir:'down', fade:true }
move       { target:'self'|'p1'|'p2'|'<objectId>', path:['up','up','left'], wait:true }
face       { target, dir:'up'|'down'|'left'|'right'|'player' }
wait       { ms:500 }
sound      { name:'sparkle' }
music      { name:'town' | null }
shake      { }        flash { }        fade { to:'out'|'in' }
heal       { }        // "Your Pokémon look happy!" (friendship +5 for all)
encounter  { mon:'pikachu', shiny:false }            // scripted catch scene; sets var `lastCaught` on success
chapter    { title:'Chapter 1', subtitle:'A new morning' }   // full-screen title card
hide       { target:'<objectId>' }     show { target }       // persistent (saved)
end        { }
```
`PKMN.Project.normalize(project)` fills defaults & validates (returns `{ project, errors[] }`);
`Project.newMap({ id, name, width, height, kind })`, `Project.resize(map, w, h)`,
`Project.blank()` (empty project with one map), `Project.clone(p)`.

## 6. Game state (a save)

```js
{ version:1, projectTitle, hero:{ map, x, y, dir }, partner:{ x, y, dir }, activeHero:0,
  flags:{}, vars:{}, items:{ pokeball:5, berry:3 }, doneOnce:{ 'town:item-1':true },
  hidden:{ 'town:mom':true }, party:[Mon...] (max 6), box:[Mon...], dex:{ seen:{}, caught:{} },
  follower: uid|null, steps:0, playtimeMs:0, savedAt:ISO, coop:false }
Mon: { uid, id:'pikachu', nickname:'', friendship:70 (0-255), mood:'happy'|'okay'|'sleepy', shiny:false,
       caughtAt:{ map, date:ISO }, caughtBy:'p1'|'p2', metAt:'Route 1', favouriteBerry:'berry' }
```

## 7. Engine behaviour

- **Rendering**: one `<canvas>` for the map/entities, DOM overlay for UI. Tile = 16 logical px. `tileScale` chosen so a tile is ~40 CSS px on phones (viewport width < 600) and ~48 on desktop, adjustable in settings (small/normal/large); canvas backing store is logical × tileScale × devicePixelRatio with `imageSmoothingEnabled=false` → crisp pixels. Draw order: ground layer → deco layer → entities sorted by y (feet) → above layer → weather/overlays. Animated tiles cycle every 500 ms. Camera centres on the active hero, clamped to the map (maps smaller than the viewport are centred with a dark border).
- **Movement**: grid-based, 4 directions, ~8 tiles/second; smooth interpolation; holding a direction keeps walking; turning in place if tapped briefly; bump sound when blocked (rate-limited). Ledges: stepping onto a `ledge:'down'` tile from the north performs a 2-tile hop; from other sides it is solid. Warps trigger on stepping onto the object's tile (fade out → load map → fade in, `door` sound; the hero appears at the target facing `dir`).
- **Partner**: the second hero follows the first along its path (Gen-2 HGSS style trail). In **co-op mode** (settings toggle) both heroes are controlled: keyboard P1 = arrows + Z/X (A/B) or Enter/Backspace, P2 = WASD + F/G; on touch, two d-pads (left → P1, right → P2) each with A/B. The camera follows the *active* hero (Tab / a swap button switches); the other hero cannot leave the screen (blocked at the edge). Either hero can interact; `{p}` in text is the hero who triggered. `needsBoth` objects require both heroes adjacent, else "This needs both of you!".
- **Follower Pokémon**: the first party Pokémon walks behind the hero as a 16×16 icon (`Pixels.downscale` of its 32×32 portrait; missing portrait → coloured silhouette). Interacting with it (turn around and press A) shows a mood line ("Pikachu is happy to be with you!"), friendship +1 (max once per 50 steps).
- **NPC movement**: `wander` = random step every 1-2 s within 3 tiles of home, never onto hero/other objects; `look` = turns randomly; `path` = loops the path. NPCs face the hero when talked to, then resume.
- **Interaction**: A while facing an object with trigger `interact`; `step` fires when a hero enters the tile; `auto` fires on map entry (respecting `condition`, `once`). Talking to a `pokemon` object that is `wild` starts the catch scene. Signs show text with a wooden-sign frame.
- **Script interpreter**: runs commands sequentially (async, awaitable), one script at a time (input locked); `once` objects record `doneOnce[map:id]`; `hide/show` persist; text substitution as above; `say` pages long text (3 lines of the box) with the ▼ prompt; choices render as a small menu. Unknown commands are skipped with a console warning, never a crash.
- **Encounters**: each step onto `tall-grass` rolls `rate%`; pick from the map's table by weight; wild level cosmetic. **Catch scene**: the map dims, a grassy card slides in, the Pokémon's 32×32 portrait appears at 4× scale (bobbing; shiny = sparkles + a hue-shifted palette), name + type badges + "dex: new!" marker. Actions: **Throw Ball** (uses 1 pokeball; a ring shrinks toward the Pokémon; tap/press A to throw; the closer the ring is to the green band the better — 'perfect'/'great'/'ok'/'miss'), **Berry** (uses 1 berry: Pokémon calms — bigger green band + catch bonus; golden-berry = guaranteed next throw), **Talk** (a cute random line, small friendship head-start, 30% it gets curious = bonus), **Run**. Catch chance = base (common 60% / uncommon 45% / rare 30% / legendary 15% by Pokémon `rarity`, default by base-stat total: <420 common, <500 uncommon, <580 rare, else legendary) × timing (perfect 1.6, great 1.3, ok 1.0, miss 0.4) + berry bonus (+20%), clamp 5-95%. Ball wobbles 1-3 times then either "Gotcha! X was caught!" (sparkle + jingle + nickname prompt: "Give it a nickname?" Yes/No with a text field) or "Oh no! It broke free!". After 3 failed throws, 40% chance it flees each further throw ("X ran away!"). Caught → party (if < 6) else box; dex.caught; `vars.lastCaught`. Running out of Poké Balls → "You're out of Poké Balls!" (Mom/shop/lab can give more via events).
- **Garden** (the "after catching" hub): the map with `kind:'garden'` shows every caught Pokémon (party + box) roaming as icons (wander AI), shiny ones sparkle. Interact: a card with nickname, species, types, friendship hearts (0-5), mood, caught where/when/by whom; actions: **Pet** (friendship +3, a heart floats up; 1 per visit per Pokémon), **Give berry** (friendship +10, uses a berry), **Take along** (moves it to the party/first slot = follower), **Leave here**. Friendship thresholds change the mood text and unlock nothing yet — hooks for the author's ideas (flags `friend_<id>_max` are set at 255 so events can react).
- **Pause menu** (Start/Esc/menu button): Pokémon (party list → details → reorder / send to box), Pokédex (32 entries: seen = silhouette, caught = portrait + blurb + where caught; counts), Bag (items with counts and descriptions; berries can be given to the follower), Save, Settings (sound, music, text speed, zoom, co-op toggle, controls help), Creator Mode (if enabled in the project or `?edit=1`), Quit to title.
- **Save/load**: `PKMN.Storage` keys under `pkmn-adventure.`; one save slot + autosave on map change; Title screen: New Game / Continue (if a save exists) / Create (Creator Mode) / Settings. New Game asks for both hero names (prefilled from the project) and runs `project.intro`.
- **Audio**: SFX 'blip','select','back','bump','door','item','sparkle','ball-throw','ball-wobble','ball-break','catch','shiny','heal','save','pet','notify','hop'; music 'title','town','route','house','cave','garden','encounter','fanfare' (short jingle, not looped). Music switches on map change by `map.music`. Everything synthesised (no files); silent no-op until the first user gesture.
- **Input**: `PKMN.Input.state(player) -> { up,down,left,right,a,b,menu }` plus `Input.onPress(fn)` for menus; on-screen controls appear on touch devices (or setting "always"), sized ≥ 56 px; keyboard as above; swipe on the map canvas also moves. A/B/menu buttons must not scroll or zoom the page (touch-action: none; user-scalable=no).
- **Testability hooks**: `window.PKMN.Game` exposes `state` (live save state), `project`, `scene` (name of the top scene: 'title'|'map'|'dialogue'|'choice'|'catch'|'menu'|'editor'|'chapter'|'nameEntry'), `loadProject(p)`, `newGame({names})`, `warp(map,x,y)`, `press(key)` (simulate a press: 'up'|'down'|'left'|'right'|'a'|'b'|'menu'), `tick(ms)` (advance the game clock; with `?fast=1` all animations/typewriter are instant). DOM: `#screen-title`, `#game-canvas`, `#dialogue` (`.speaker`, `.text`, `.choices button`), `#pause-menu`, `#catch-scene`, `#editor`, on-screen buttons `[data-btn="up|down|left|right|a|b|menu"]` (and `[data-player="2"]` variants).

## 8. Creator Mode — `js/editor/*.js` (`PKMN.Editor`)

Opened from the title ("Create") or the pause menu; toggle **Play ⇄ Edit** at any time (Play starts at the cursor position: "Play here"). Layout: a top bar (map selector, Play/Edit, Undo/Redo, save status, ☰ menu), the map canvas in the middle (pan by drag on empty space / two-finger, zoom buttons), and a side panel (bottom sheet on phones) with tabs:
- **Tiles**: groups as tabs (Nature / Town / Interior / Cave / Stamps), a swatch grid of the tile art, tools: pencil, fill (bucket), rectangle, eraser, eyedropper; layer selector (Ground / Deco / Above); toggles: grid, collision overlay (red = solid), object labels. Painting on `ground` never leaves holes (erase = grass/floor-wood by map kind).
- **Objects**: buttons to add NPC / Sign / Item / Door(warp) / Trigger / Wild Pokémon; tap an object on the map to select → **Inspector**: id (auto), name, sprite (picker with previews + recolour swatches for hair/shirt/pants on heroes/NPCs), direction, movement, trigger, once, needsBoth, condition (flag/var/item/has), warp target (map + tap-on-map to pick x/y), item + count, Pokémon + wild, and the **Event editor**: a vertical list of command cards, "+ Add" opens a friendly picker ("Say something", "Ask a question", "If…", "Set flag", "Change number", "Give item", "Take item", "Give Pokémon", "Teleport", "Move", "Face", "Wait", "Sound", "Music", "Shake", "Flash", "Fade", "Heal", "Wild encounter", "Chapter card", "Hide/Show", "End"); cards have inline fields (textarea for text with a live preview of the dialogue box; dropdowns for flags/items/maps/Pokémon/sprites; nested lists for choice/if branches, indented); drag handle or ▲▼ to reorder; duplicate/delete. Delete object with confirm.
- **Map**: name, size (resize keeps content anchored top-left), kind, music, encounter rate, wild table (add Pokémon from the roster with a weight slider, shows portraits), a "Set start here" for the project start; New map (blank / copy), duplicate, delete (confirm), reorder.
- **Project**: title, subtitle, hero names + sprites + recolours, start position, intro script (same event editor), settings defaults, items (add custom items with icon + description), a "Flags & numbers" list (auto-collected from all scripts; rename with refactor), and **Save / Export / Import / Reset to demo** (see Storage).
- Undo/redo for every change (Ctrl+Z / Ctrl+Shift+Z), min 50 steps. Keyboard: 1-5 tools, G grid, C collision, [ ] layer.
- Everything must be usable with a finger on a 390×844 phone (targets ≥ 44 px, panels scroll) and comfortable with a mouse on a laptop.
- The editor validates on save (`Project.normalize`) and shows problems (warp to a missing map, unknown tile, empty say) as a list that jumps to the object.

## 9. Storage — `js/core/storage.js`

```js
Storage.loadProject() -> { project, source: 'draft'|'embedded'|'default' }
   // 1. localStorage draft ('pkmn-adventure.project') if present; 2. <script id="project-data" type="application/json"> if present; 3. PKMN.DEFAULT_PROJECT
Storage.saveDraft(project)        // debounced autosave from the editor; shows "Saved" in the top bar
Storage.discardDraft()
Storage.exportJSON(project) -> string        // pretty, stable key order
Storage.download(filename, text)             // uses the artifact 'downloads' capability when present, else a Blob link; else shows a copyable textarea
Storage.importJSON(text) -> { project, errors }
Storage.canPublish() -> Promise<boolean>     // claude.use('artifact') resolves non-null
Storage.publish(project) -> Promise<'ok'|'conflict'|'not_granted'|'unavailable'>
   // regenerates the page: PRISTINE_HTML (captured by main.js before any DOM mutation: '<!doctype html>' + document.documentElement.outerHTML) with the
   // <script id="project-data"> block replaced by the JSON (escape '</' as '<\/'), then artifact.publish(html). Never serialises the live DOM.
Storage.saveGame(state) / loadGame() / hasGame() / deleteGame()
Storage.settings()/saveSettings()
```
`window.claude` may not exist (file://): every capability check is `typeof claude !== 'undefined' && claude.use ? await claude.use(name) : null`, with a 10 s timeout treated as null. Buttons for cloud save/download only appear when available.

## 10. The demo world — `js/data/project.js`

A small, warm starter that shows every feature and is easy to replace:
- **home** (12×10, indoor): bedroom + kitchen, Mom (npc, wander) — first talk gives 5 Poké Balls and 3 Berries and says the Professor is waiting; a PC (sign-type object explaining "your Pokémon relax in the Garden"), a TV with a cute line, stairs/mat warp to town.
- **town** (24×18, outdoor): your red house, a blue house (a kid NPC inside talks about the follower), the Lab, fences, flowers, a sign with the town name, a lamp post, bench with grandma ("Everyone's a beginner at first!"), a gate (warp) south to the route and a hedge-lined path east to the garden. Chapter card "Chapter 1 — A New Morning" on first entry.
- **lab** (14×10, indoor): the Professor (auto event once: welcome; interact: choice of three starters shown as `pokemon` objects (not wild) — pick one: `givePokemon` + sets flag `has_starter`; the other two vanish via `hide`). A nurse-ish assistant explaining catching.
- **route** (20×30, outdoor): tall grass patches with wild table (pikachu 5, butterfree 4, jolteon 1 …), a pond, a ledge, a `pokemon` wild object (an Eevee-like — use `mew`? no: use 'pikachu' standing by a tree), an item (golden-berry), a trainer NPC with a choice, a cave entrance stub.
- **garden** (16×12, kind garden): flowers, pond, benches, a gate back to town; roaming caught Pokémon.
Intro script: fade in, chapter card, `say` from a narrator ("{p1} and {p2} wake up to a bright new morning…").

## 11. Non-goals for v1
No battles, no levels/experience, no trading, no online. Keep the code plain and
readable — the author will read it with Claude to change things.
