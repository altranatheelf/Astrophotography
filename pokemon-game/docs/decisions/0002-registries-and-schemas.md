# 0002 — One field declaration drives widget, validator, save and refs

**Status:** accepted

## The question
How does a new kind of thing — a command, an item, a voice — become editable,
validatable and saveable without writing that code four times?

## What was chosen
A registry holds definitions; a definition declares `fields`; a field is
`{ key, type, default, label, doc, ... }`. From that ONE declaration the engine
derives the editor widget, the validator, the fill/default pass, the reference
index, and what goes in the save.

## What that rules out
Hand-written forms. Hand-written validators. A separate schema file. Any place
where adding a field means editing more than one thing.

## Why
The alternative is what RPG Maker does, and the research is unambiguous about
where it leads: **notetags**. Game logic encoded as free text parsed out of
description fields, because the data model had no user-extensible typed fields.
OMORI's entire emotion and state system is notetags, and its own community
documentation warns "there are likely cases where your emotion will break."

The payoff compounds in places nobody planned: localization extraction walks the
same field declarations, so a module that adds a command gets its lines into the
translation file *on the day it is written*, with nobody maintaining a list.

## What would make this wrong
If field types multiply faster than they are reused — if most fields end up with
a bespoke `type` used exactly once — the declaration is just a form in disguise
and the indirection is costing more than it saves.

## Consequences you can see
`js/kit/core/schema.js`, `js/kit/core/registries.js`, and the fact that
`KIT.lang.extract` needs no list of commands.
