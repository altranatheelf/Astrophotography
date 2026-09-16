
---

## What is in this folder

```
index.html        the page. It lists every file the game loads, in order.
story.js          your whole world, in one readable file.
look.css          your colours and type.
content/          what `npm run build` writes from story.js. Do not hand-edit.
  project.js        everybody, everything, every line of dialogue
  maps/*.js         one file per map
art/              the pictures this game adds to the ones the Kit ships.
modules/          extra systems this game uses (if any). See the Kit's docs/MODULES.md.
tools/            the little scripts below, and the Node half of the Kit.
```

## The commands

| | |
|---|---|
| `{{BUILD}}` | story.js → content/. Run it after you edit story.js. It refuses to write anything if the world is broken, and tells you where. |
| `{{RUN}}` | opens index.html in a browser. (Or just double-click index.html.) |
| `{{SHARE}}` | squashes the whole game into one .html file you can send to somebody. They double-click it; it needs nothing else. |

## Two ways to work

**In the file.** Edit `story.js`, run the build, refresh the page. Good for
writing: all the words are in one place and you can search them.

**In the game.** Open the game and choose **Create** in the pause menu (or add
`?edit=1` to the address). Creator Mode is the whole editor — paint maps, place
people, write their scripts, set the terms — and it saves as you go. Its
**Export** writes `content/` back out.

Both edit the same world. Just do not have unexported Creator Mode changes
sitting there when you run the build, or the build will write over them.

## Where the Kit is

{{KIT_WHERE}} Move the Kit and you change that in two places: the `<script src>`
lines in `index.html`, and `KIT_REL` at the top of `tools/kit-node.js`.

{{KIT_DOCS}}
