# 0005 — Extensions are manifests with declared slices, not monkey-patches

**Status:** accepted

## The question
How does somebody add a system — battles, farming, a bestiary — without editing
the engine?

## What was chosen
A module is a folder with a manifest declaring what it adds: registrations, a
`save` slice (key, defaults, a versioned `migrate` chain, `repair`), and a
`content` slice with typed fields. The engine fills and migrates the slice; the
module never touches `js/kit/**`.

## What was rejected
Prototype monkey-patching, which is what RPG Maker plugins are.

## Why
The research is a catalogue of what monkey-patching costs over a long project.
OMORI's VX Ace → MV migration **broke its plugins and consumed most of the first
half of 2017**. Mid-development the vendor shipped MV 1.6.0, broke projects, and
un-shipped it. The largest commercial plugin suite is deliberately obfuscated,
making compatibility patches impossible, and the official conflict-resolution
method — from the biggest vendor's own wiki — is *"turn off your plugins one by
one to find the problem's source."* There is no dependency system, no conflict
detection, no hook registry.

A declared slice with a migration chain is the specific answer to the specific
failure: a module can change shape across versions without invalidating saves,
and the engine knows which module owns what.

## What would make this wrong
If modules routinely need a hook the manifest cannot express and start reaching
into `KIT` internals anyway, the manifest is ceremony over a monkey-patch.

This decision used to say the guard was `docs/ENGINE-HOOKS.md` **plus a purity
test**, and that the purity test was "blind to five sites where `js/kit` names
the `mons` module". It was worse than blind: **there was no purity test.** The
decision named its own guard and the guard did not exist, which is how the
engine's map editor came to draw a table out of one module's content pack.

`test/kit/purity.test.js` is the guard now, and the crack it was recording is
closed:

- The map panel asks a **`mapSections` registry** what to draw, and the mons
  module puts its own legacy-encounters section in it. The kit no longer knows
  what is in there, and one section throwing does not take the panel with it.
- The remaining sites are the **v2→v3 converter**, which is the kit knowing its
  own past format — v2 of this project was a Pokémon game for about a week —
  frozen with a format that no longer changes. Classified `HISTORY`, with why.
- Every file that names a module carries its line **count**, so a new naming
  inside an excused file fails the test. Without that, "this file may mention
  mons" becomes "this file may do anything".

The test's first version was cleverer and therefore useless: it looked for
`'mons'`, `KIT.mons` and `packs.mons` — "the three shapes a dependency actually
takes" — so a module called `home` would not trip over an entity's home square.
Then the negative check put `(st.project.packs || {}).mons` back into the map
panel and the test passed, because that is `.mons` after a bracket. The same
blindness, in the test written to catch it. It matches the word now, and the
innocent uses are listed by name and by count.
