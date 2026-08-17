"""Checkpoint / artifact cache keyed by per-stage parameter hash.

Each completed stage writes ``<stage>.done`` containing the stage hash.  On
re-run a stage is skipped iff the marker hash matches; ``--force`` re-runs
everything.  Unlike detect_meteors' ``progress.json``, an idempotent re-run
logs "N stages up-to-date, skipping" instead of silently doing nothing.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger("meteorprep")


class CacheStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def dir(self, name: str) -> Path:
        d = self.root / name
        d.mkdir(parents=True, exist_ok=True)
        return d

    def path(self, name: str) -> Path:
        return self.root / name

    def _marker(self, stage: str) -> Path:
        return self.root / f"{stage}.done"

    def is_done(self, stage: str, stage_hash: str) -> bool:
        m = self._marker(stage)
        if not m.exists():
            return False
        try:
            return json.loads(m.read_text()).get("hash") == stage_hash
        except (json.JSONDecodeError, OSError):
            return False

    def mark_done(self, stage: str, stage_hash: str) -> None:
        self._marker(stage).write_text(json.dumps({"stage": stage, "hash": stage_hash}))

    def invalidate(self, stage: str) -> None:
        self._marker(stage).unlink(missing_ok=True)

    def write_json(self, name: str, obj) -> Path:
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(obj, indent=2, default=str))
        return p

    def read_json(self, name: str):
        return json.loads((self.root / name).read_text())
