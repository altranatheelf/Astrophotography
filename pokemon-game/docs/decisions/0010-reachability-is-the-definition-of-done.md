# 0010 — Done means a player or author can reach it

**Status:** accepted

## The question
When is a feature finished?

## What was chosen
When somebody can get to it. Not when the API exists, not when a unit test calls
it, not when it works in the console.

## Why this needed writing down
Because it was violated three times in one week, in the same repo, by the same
author, without anyone noticing:

- a complete, tested localization pipeline **no player could select a language from**
- separate sound and music volumes in the API and in the saved settings, with **no row in the menu**
- a git-mergeable project format the editor had **no button for** — the single clearest
  advantage this engine has over RPG Maker, unreachable from the tool

Every one was real, tested and shipped. The whole suite passed and not one test
would have failed if the feature had been deleted from the product's reach,
because "done" had quietly become *the API exists and a unit test calls it*.

## What follows from it
`test/kit/reachable.test.js` asserts that a device setting a player is meant to
change appears as a ROW in the settings menu. Its first version did not work — it
searched the whole file and passed with the volume row deleted, because the
handler still mentioned the setting. A setting you can only change if you can
*see* it. Scoped to `settingRows()`, it fails naming the setting.

`NOT_IN_MENU` is the escape hatch and is meant to be uncomfortable: adding to it
is a written admission that a setting exists which nobody can change.

## What this does NOT cover
The test checks settings. The rule is general and the test is narrow, and that
gap is where the fourth instance will come from. The broader form — every ticket
ends with "how to verify this yourself" in plain language — is the standard to
hold, and browser suites are how it is met here: `e2e/` drives the real UI and
asserts on pixels and audio nodes rather than on the objects that produced them.

## What would make this wrong
Nothing yet. If the escape-hatch list grows past a handful, the rule is being
worked around rather than followed.
