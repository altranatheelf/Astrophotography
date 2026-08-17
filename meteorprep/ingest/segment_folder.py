"""Folder auto-segmentation into contiguous shooting groups (§2.3).

A new group starts on: a time gap > max_gap_factor x median interval, a
focal-length change, or a lens change.  Tripod bumps are detected later
(after solving) as residual star shift beyond the sidereal prediction and
split groups via ``split_group_at``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

from meteorprep.ingest.exif import FrameMeta

log = logging.getLogger("meteorprep")


@dataclass
class Group:
    group_id: str
    frames: list[FrameMeta] = field(default_factory=list)

    @property
    def files(self) -> list[str]:
        return [m.file for m in self.frames]


def segment_folder(metas: list[FrameMeta], max_gap_factor: float = 5.0) -> list[Group]:
    if not metas:
        return []
    metas = sorted(metas, key=lambda m: m.datetime_original)
    intervals = [(b.datetime_original - a.datetime_original).total_seconds()
                 for a, b in zip(metas, metas[1:])]
    med = float(np.median(intervals)) if intervals else 0.0
    max_gap = max(max_gap_factor * med, 60.0)

    groups: list[Group] = []
    cur = [metas[0]]
    for prev, m in zip(metas, metas[1:]):
        gap = (m.datetime_original - prev.datetime_original).total_seconds()
        new = (gap > max_gap
               or abs(m.focal_mm - prev.focal_mm) > 0.5
               or m.lens_model != prev.lens_model)
        if new:
            groups.append(cur)
            cur = []
        cur.append(m)
    groups.append(cur)

    out = []
    for i, frames in enumerate(groups):
        gid = f"g{i + 1:02d}"
        for m in frames:
            m.group_id = gid
        out.append(Group(group_id=gid, frames=frames))
        models = {m.model for m in frames}
        if len(models) > 1:
            log.warning("group %s mixes camera models: %s", gid, models)
    return out


def split_group_at(group: Group, index: int) -> list[Group]:
    """Split at a tripod-bump boundary (frame ``index`` starts the new group)."""
    a = Group(group_id=group.group_id, frames=group.frames[:index])
    b = Group(group_id=group.group_id + "b", frames=group.frames[index:])
    for m in b.frames:
        m.group_id = b.group_id
    return [a, b]
