# Writing a module

A module is a folder that adds a system to the engine without editing it. The
Pokémon side of this game is a module; so is anything you add later. If you can
describe a feature as "things, rules, screens and saved state", it is a module.

## The shape

```
js/modules/<id>/
  manifest.js      KIT.module({...})   — the only file the page has to load first
  <anything>.js    whatever the module needs
  README.md        what it does, in a paragraph
```

```js
KIT.module({
  id: 'mons',
  version: 1,
  label: 'Pokémon',                       // shown in the Project panel
  requires: [],                           // other module ids; boot sorts and fails loudly
  describe: 'Catching, the Pokédex, the garden and a follower.',

  register(KIT) {
    // Everything the module adds goes in here. It runs once, after the kit and
    // before the game boots, only when the project enables this module.
  },

  // Optional: a slice of the save file this module owns.
  save: {
    key: 'mons',
    defaults: () => ({ party: [], box: [], dex: {} }),
    migrate: [ { from: 1, to: 2, up(data) { return data; } } ],
  },

  // Optional: a slice of the project this module owns (project.packs.<key>),
  // validated and edited by the schema like everything else.
  content: {
    key: 'mons',
    fields: [ { key: 'startingBalls', type: 'number', default: 5 } ],
    defaults: () => ({ species: {}, encounters: {} }),
  },
})
```

## What `register` may add

Everything is a registry, so a module adds the same way the kit does:

| To add | Registry | Notes |
|---|---|---|
| tiles, sprites, faces, icons | `tiles` `sprites` `faces` `icons` | art the module ships |
| object types | `objectTypes` | with `fields` (their page props) — the editor forms itself |
| behaviours | `behaviours` | autonomous movement kinds |
| script commands | `commands` | `{ fields, run(ctx, cmd), summary, text }` — the editor and Screenplay pick them up |
| conditions | `conditions` | `{ fields, test(cond, ctx) }` |
| item kinds | `itemKinds` | `{ fields, use(ctx, item) }` |
| systems | `systems` | `{ order, update(world, dt), onMapEnter }` |
| scenes | `scenes` | menus, minigames, anything full-screen |
| pause-menu entries | `menus` | `{ label, icon, order, open(game) }` |
| editor panels and tools | `editorPanels` `editorTools` | Creator Mode extends itself |
| field widgets | `fieldEditors` | new schema types |
| validators | `validators` | project problems |
| strings | `strings` | every line of text the module shows |
| reference kinds | `KIT.schema.refKind('mon', …)` | so `ref:mon` fields get a picker |

## Rules

1. **Never edit the kit.** If you need a hook it does not have, say so; a hook
   added to the kit serves every module, a patched kit serves none.
2. **Own your state.** Runtime state lives in the save section you declared.
   Content lives in `project.packs.<key>`. Nothing else is yours.
3. **Every string is registered**, so it can be reworded in the Terms panel.
4. **Fail soft.** A module that cannot do its job disables its own affordances
   and says why once; it never throws during boot or a turn.
5. **Headless first.** Rules go in pure functions that Node can test. Scenes and
   panels are the thin layer on top.
6. **Ship a test.** `test/modules/<id>.test.js`, loaded like the kit tests.
7. **Version your save.** If the shape changes, add a migration; old saves must
   keep loading.

## Turning it on

`project.modules` lists the modules a game uses. The Project panel in Creator
Mode toggles them; `node tools/new-game.js` asks which to include. A module that
is loaded but not listed registers nothing.

## Scaffolding

```
node tools/new-module.js jobs --label "Jobs" --describe "Errands your friends can run"
```
writes `js/modules/jobs/` with a manifest, a save section, a command, a system,
a panel, a test and a README — all working, all obviously replaceable.
