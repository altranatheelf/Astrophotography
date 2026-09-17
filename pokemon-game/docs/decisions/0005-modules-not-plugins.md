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
into `KIT` internals anyway, the manifest is ceremony over a monkey-patch. The
guard against that is `docs/ENGINE-HOOKS.md` plus a purity test — and the
extensibility audit found the purity test is currently blind to five sites where
`js/kit` names the `mons` module. That is a real crack in this decision and it is
recorded in `AGAINST-THE-INDUSTRY.md` rather than hidden here.
