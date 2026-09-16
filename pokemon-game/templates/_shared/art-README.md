# art/

Everything this game draws that the Kit does not already ship.

An art file is an ordinary script that registers pictures into the Kit's
registries the moment it loads. `index.html` lists them, so a new file is two
steps: write it, add a `<script src="art/whatever.js"></script>` line.

```js
(function (root) {
  const KIT = root.KIT;
  KIT.registry('tiles').add({
    id: 'my-rug', name: 'My Rug', group: 'interior', solid: false,
    palette: { r: '#d84848', o: '#8c2020' },      // one letter -> one colour
    rows: [                                        // 16 rows of 16 letters
      'oooooooooooooooo',
      'orrrrrrrrrrrrrro',
      // ... 13 more ...
      'oooooooooooooooo',
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
```

`.` is not allowed in a palette — leave a square out of the palette entirely and
it is transparent. Registries you can add to: `tiles`, `sprites` (walking
people: `frames: { down, up, left }`, three frames each, `right` is `left`
mirrored), `faces` (portraits in dialogue), `icons` (bag items).

**You do not have to draw anything.** Art that is missing is drawn as a coloured
silhouette, so a half-finished game still plays. And you can bring pictures in
from elsewhere instead:

```
node tools/import.js ~/sheets/hero.aseprite --kind sprite
node tools/import.js ~/tiled/town.tmj
node tools/import.js ~/RPGMakerProjects/MyGame
```

Imported pictures are copied into `content/assets/` and recorded in the project,
so they travel with the game. See `STARTING-A-GAME.md` in the Kit for the
whole story.
