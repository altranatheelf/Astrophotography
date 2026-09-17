# Decisions

Every one of these was already made and is already in the code. They are written
down here because a decision that lives only in a commit message is a *story*,
not a decision — you cannot see what it ruled out, so you cannot tell later
whether the reason still holds.

These are backfilled. That is a worse position than writing them as you go, and
it is honest about how this repo actually grew: the code came first and the
reasons were reconstructed from it. Anything from here on gets one at the time.

**Format.** Number, title, status, the question, what was chosen, what was not
and why, and what would make this wrong. That last field matters most: a
decision with no stated way to be wrong is a preference.

**Changing one.** Do not edit a decision. Add a new one that supersedes it and
mark the old one superseded, with the number. The trail is the point.

| # | Decision | Status |
|---|---|---|
| [0001](0001-no-build-step.md) | No build step; the engine is `<script>` tags | accepted |
| [0002](0002-registries-and-schemas.md) | One field declaration drives widget, validator, save and refs | accepted |
| [0003](0003-readable-project-format.md) | Projects are readable JS, one file per map | accepted |
| [0004](0004-screenplay.md) | Scripts have a lossless plain-text form | accepted |
| [0005](0005-modules-not-plugins.md) | Extensions are manifests with declared slices, not monkey-patches | accepted |
| [0006](0006-localization-keyed-on-source.md) | Translations are keyed on the source line, not an id | accepted |
| [0007](0007-dom-text-canvas-world.md) | Text is DOM; the world is canvas; scenes may draw both | accepted |
| [0008](0008-two-tier-persistence.md) | A save is per-run; `meta` is per-player and survives New Game | accepted |
| [0009](0009-layers-are-sparse-overrides.md) | A layer of reality overrides cells, not whole maps | accepted |
| [0010](0010-reachability-is-the-definition-of-done.md) | Done means a player or author can reach it | accepted |
| [0011](0011-history-is-tally-plus-window.md) | History is a permanent tally plus a bounded window | accepted |
| [0012](0012-rules-are-entities.md) | A rule of the world is a condition plus a script, and can be eaten | accepted |
