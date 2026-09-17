# 0001 — No build step; the engine is `<script>` tags

**Status:** accepted

## The question
Every modern JS project compiles. Should this one?

## What was chosen
No bundler, no transpiler, no build. `index.html` lists `<script src>` tags and
the engine runs from `file://` by double-clicking. One global `KIT` namespace.
`npm run build` exists, but it only *concatenates* into a single `.html` — the
engine works identically without ever running it.

## What that rules out
TypeScript, JSX, modules with real imports, tree-shaking, minification-by-default,
and every tool that assumes a build graph.

## Why
The person this is for edits from a phone as often as a laptop, and a build step
is a thing that can be broken from a phone with no way to fix it. It also makes
the engine openable in ten years: a folder of `.js` files and an `.html` needs
nothing that has to still exist.

The research backs the cost side: Undertale's dialogue lived in compiled code and
cost **3m45s per text tweak**; its decompilation team moved text to JSON and got
it to 44 seconds. A build step is a tax on the loop you run ten thousand times.

## What would make this wrong
If the engine grows past roughly 100 files the `<script>` list becomes the
problem it was avoiding, and the browser's own module system (`type="module"`,
no bundler) is the next step — still no build, still openable, but with real
imports. That is a migration, not a rewrite.

## Consequences you can see
`js/kit/**` uses the shim pattern (`(function (root) { ... })(window)`), every
file is loadable in Node for tests, and `templates/_shared/kit-files.js` is the
one list that has to stay in step with `index.html`.
