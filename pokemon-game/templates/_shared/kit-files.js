// The Kit's file list, in load order — the ONE place that knows it.
//
// tools/new-game.js writes a game's index.html from this, tools/pack-kit.js
// copies exactly these files into a packed kit, and the kit-node.js a new game
// gets uses NODE to load the engine in Node for its content build script.
//
// Paths are relative to the kit root (the repo, or a packed kit folder), and a
// packed kit keeps the same layout, so nothing here changes between the two.
'use strict';

/** The engine, in the order docs/KIT-API.md gives. */
const CORE = [
  'js/kit/core/util.js', 'js/kit/core/events.js', 'js/kit/core/rng.js', 'js/kit/core/registry.js',
  'js/kit/core/schema.js', 'js/kit/core/registries.js', 'js/kit/core/modules.js',
  'js/kit/core/pixels.js', 'js/kit/core/assets.js',
  'js/kit/core/input.js', 'js/kit/core/audio.js', 'js/kit/core/lang.js', 'js/kit/core/storage.js',
  'js/kit/world/document.js', 'js/kit/world/project.js', 'js/kit/world/tiles.js', 'js/kit/world/cast.js', 'js/kit/world/log.js', 'js/kit/world/rules.js', 'js/kit/world/timeline.js',
  'js/kit/script/text.js', 'js/kit/script/conditions.js', 'js/kit/script/commands.js',
  'js/kit/script/screenplay.js', 'js/kit/script/interpreter.js',
  'js/kit/world/map.js', 'js/kit/world/entities.js', 'js/kit/world/world.js', 'js/kit/systems/index.js',
  'js/kit/import/tiled.js', 'js/kit/import/rpgmaker.js', 'js/kit/import/aseprite.js', 'js/kit/import/image.js', 'js/kit/import/merge.js',
  'js/kit/render/atmosphere.js', 'js/kit/render/text-canvas.js', 'js/kit/render/renderer.js',
  'js/kit/scenes/stack.js', 'js/kit/scenes/dialogue.js', 'js/kit/scenes/menu.js', 'js/kit/scenes/title.js',
  'js/kit/scenes/map.js', 'js/kit/game.js',
];

/** The art that ships with the kit. Every game starts with these tiles and people. */
const ART = [
  'js/art/tiles.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js', 'js/art/tiles-interior.js',
  'js/art/chars.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js',
];

/** Creator Mode. Loaded after the game, before the modules. */
const EDITOR = [
  'js/kit/editor/ops.js', 'js/kit/editor/editor.js', 'js/kit/editor/tools.js', 'js/kit/editor/inspector.js',
  'js/kit/editor/panels-map.js', 'js/kit/editor/panels-objects.js', 'js/kit/editor/script-editor.js',
  'js/kit/editor/panels-writing.js', 'js/kit/editor/panels-project.js', 'js/kit/editor/panel-cast.js',
  'js/kit/editor/integration.js',
];

/** The entry point. Always last. */
const MAIN = ['js/main.js'];

/** Stylesheets, in order. */
const CSS = ['css/kit.css', 'css/editor.css'];

/**
 * Everything that runs headless in Node (no DOM needed): the engine and the art.
 * Creator Mode is not in here — it needs a document.
 */
const NODE = CORE.concat(ART);

/** A module's files, in load order. The manifest is always last. */
function moduleFiles(dir, id) {
  return ['rules.js', 'art.js', 'register.js', 'strings.js', 'scenes.js', 'panel.js', 'systems.js', 'actions.js', 'script.js', 'manifest.js']
    .map(f => `${dir}/${id}/${f}`);
}

module.exports = { CORE, ART, EDITOR, MAIN, CSS, NODE, moduleFiles };
