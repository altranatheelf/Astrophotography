# 0006 — Translations are keyed on the source line, not an id

**Status:** accepted

## The question
`msg_pier_014`, or the English sentence itself?

## What was chosen
The source line IS the key. A translation file maps `"Hello, traveller."` to its
translation. Extraction is field-driven and can run at any point in development.

## What was rejected
Id-keyed tables — which is what OMORI built (YAML under `www/languages/<lang>/`,
addressed by key, with plugin calls like `ShowMessage dw_boss_rush.message_1`).

## Why
An id means every line needs a name somebody invents, keeps unique, and keeps
attached to the line when it moves; rename a scene and half of them point at
nothing. Keying on the text means a line can move anywhere and keep its
translation, two places that say the same thing share one translation for free,
and editing the English **correctly** orphans the old translation — the line
changed, so the old rendering is now a lie. gettext settled this in 1995.

The alternative's real cost is visible in the RPG Maker plugin ecosystem, whose
own documentation instructs you to *generate language files only after the game
is finished*, because changing game data afterwards "can lead to serious errors."
That is a tool telling you localization cannot be part of development. OMORI, with
a purpose-built string system, still shipped Japanese **12 months** after English.

## What this costs
Rewording a line orphans its translation. That is correct, and it is still a
loss, so orphans are kept at the bottom of the file under a notice rather than
deleted — a translator who reworded a sentence should not lose an hour to a typo
fix.

## What would make this wrong
Two places that need the SAME English rendered differently in another language.
gettext's answer is `msgctxt`; this engine has no equivalent yet, and the current
advice is to write different English. If that bites in practice, a context field
is the fix, not a switch to ids.
