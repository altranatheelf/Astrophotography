// Loads the kit core in order for tests. require() returns the shared KIT.
'use strict';
const path = require('path');
const root = path.join(__dirname, '..', '..');
const files = ['js/kit/core/util.js', 'js/kit/core/events.js', 'js/kit/core/rng.js', 'js/kit/core/registry.js', 'js/kit/core/schema.js', 'js/kit/core/registries.js', 'js/kit/world/document.js'];
files.push('js/kit/core/pixels.js');
files.push('js/kit/world/project.js');
files.push('js/kit/world/tiles.js');
files.push('js/kit/script/text.js');
files.push('js/kit/script/conditions.js');
files.push('js/kit/script/commands.js');
for (const f of files) require(path.join(root, f));
module.exports = globalThis.KIT;
