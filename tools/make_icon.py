#!/usr/bin/env python3
"""Draw the app icon — the instrument the Run screen is built around, on a
night ground — and write both the PNG the window uses and the .icns the Mac
bundle shows in the Dock.

Run it from the repository root:  python3 tools/make_icon.py
"""
from __future__ import annotations

import math
import os
import struct
import sys
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PySide6.QtCore import QBuffer, QByteArray, QPointF, QRectF, Qt  # noqa: E402
from PySide6.QtGui import (QColor, QFont, QImage, QLinearGradient, QPainter,  # noqa: E402
                           QPainterPath, QPen, QPolygonF, QRadialGradient)
from PySide6.QtWidgets import QApplication  # noqa: E402

ASSETS = Path(__file__).resolve().parent.parent / "meteorprep" / "assets"


def draw(size: int) -> QImage:
    img = QImage(size, size, QImage.Format_ARGB32_Premultiplied)
    img.fill(0)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    s = size
    r = QRectF(0, 0, s, s)

    # the rounded night ground, with the lamp in the top-left corner
    body = QPainterPath()
    body.addRoundedRect(r.adjusted(s * 0.045, s * 0.045, -s * 0.045, -s * 0.045),
                        s * 0.22, s * 0.22)
    g = QLinearGradient(QPointF(0, 0), QPointF(0, s))
    g.setColorAt(0.0, QColor("#1d2430"))
    g.setColorAt(1.0, QColor("#0a0d14"))
    p.fillPath(body, g)
    lamp = QRadialGradient(QPointF(s * 0.22, s * 0.10), s * 0.85)
    lamp.setColorAt(0.0, QColor(255, 180, 90, 70))
    lamp.setColorAt(1.0, QColor(255, 180, 90, 0))
    p.fillPath(body, lamp)

    p.save()
    p.setClipPath(body)
    # a few stars, and one meteor across the corner
    rnd = [(0.18, 0.22, 1.0), (0.33, 0.13, 0.7), (0.72, 0.18, 0.9), (0.85, 0.34, 0.7),
           (0.26, 0.42, 0.6), (0.64, 0.08, 0.6), (0.90, 0.13, 0.8), (0.12, 0.35, 0.5)]
    for x, y, w in rnd:
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 250, 235, int(200 * w)))
        p.drawEllipse(QPointF(x * s, y * s), s * 0.008 * w, s * 0.008 * w)
    streak = QLinearGradient(QPointF(s * 0.62, s * 0.13), QPointF(s * 0.88, s * 0.30))
    streak.setColorAt(0.0, QColor(255, 236, 190, 0))
    streak.setColorAt(0.6, QColor(255, 236, 190, 200))
    streak.setColorAt(1.0, QColor(255, 255, 255, 255))
    p.setPen(QPen(streak, s * 0.016, Qt.SolidLine, Qt.RoundCap))
    p.drawLine(QPointF(s * 0.62, s * 0.13), QPointF(s * 0.88, s * 0.30))
    p.restore()

    # the instrument: brass bezel, silvered face, divided ring, blued hand
    c = QPointF(s / 2, s * 0.585)
    R = s * 0.305
    bez = QLinearGradient(QPointF(0, c.y() - R), QPointF(0, c.y() + R))
    bez.setColorAt(0.0, QColor("#c3aa71"))
    bez.setColorAt(0.5, QColor("#8a7546"))
    bez.setColorAt(1.0, QColor("#4a3d22"))
    p.setPen(QPen(QColor("#241c0e"), max(1.0, s * 0.006)))
    p.setBrush(bez)
    p.drawEllipse(c, R, R)
    ring = R * 0.80
    face = QRadialGradient(QPointF(c.x(), c.y() - ring * 0.3), ring * 1.6)
    face.setColorAt(0.0, QColor("#f1ead6"))
    face.setColorAt(1.0, QColor("#cec3a3"))
    p.setBrush(face)
    p.setPen(QPen(QColor("#3a2c14"), max(1.0, s * 0.005)))
    p.drawEllipse(c, ring, ring)

    def pt(deg, rad):
        a = math.radians(deg - 90)
        return QPointF(c.x() + rad * math.cos(a), c.y() + rad * math.sin(a))

    p.setPen(QPen(QColor("#2a1c0e"), max(1.0, s * 0.008)))
    for i in range(0, 100, 5):
        long = i % 10 == 0
        p.setPen(QPen(QColor("#2a1c0e"), max(1.0, s * (0.010 if long else 0.005))))
        p.drawLine(pt(i * 3.6, ring * 0.94), pt(i * 3.6, ring * (0.80 if long else 0.86)))
    # the travelled arc and the hand, at the angle the Run screen's dial shows
    p.setPen(QPen(QColor(29, 43, 74, 150), s * 0.018, Qt.SolidLine, Qt.FlatCap))
    p.drawArc(QRectF(c.x() - ring * 0.70, c.y() - ring * 0.70, ring * 1.40, ring * 1.40),
              90 * 16, -int(55 * 3.6 * 16))
    p.save()
    p.translate(c)
    p.rotate(55 * 3.6)
    hand = QPolygonF([QPointF(-s * 0.018, 0), QPointF(0, -ring * 0.88),
                      QPointF(s * 0.018, 0), QPointF(0, ring * 0.22)])
    p.setPen(QPen(QColor("#0b1120"), max(1.0, s * 0.004)))
    p.setBrush(QColor("#3d5a94"))
    p.drawPolygon(hand)
    p.restore()
    p.setBrush(bez)
    p.setPen(QPen(QColor("#241c0e"), max(1.0, s * 0.004)))
    p.drawEllipse(c, s * 0.030, s * 0.030)

    # glass
    gl = QRadialGradient(QPointF(c.x() - ring * 0.4, c.y() - ring * 0.6), ring * 1.5)
    gl.setColorAt(0.0, QColor(255, 255, 255, 70))
    gl.setColorAt(1.0, QColor(255, 255, 255, 0))
    p.setBrush(gl)
    p.setPen(Qt.NoPen)
    p.drawEllipse(c, ring, ring)
    p.end()
    return img


def png_bytes(img: QImage) -> bytes:
    # the byte array has to outlive the buffer, so hold a name for it
    ba = QByteArray()
    buf = QBuffer(ba)
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    buf.close()
    return bytes(ba)


def write_icns(path: Path, images: dict[int, QImage]) -> None:
    """A minimal .icns writer: the modern types all take a PNG payload."""
    types = {16: b"icp4", 32: b"icp5", 64: b"icp6", 128: b"ic07", 256: b"ic08",
             512: b"ic09", 1024: b"ic10"}
    chunks = []
    for size, code in sorted(types.items()):
        if size not in images:
            continue
        data = png_bytes(images[size])
        chunks.append(code + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> int:
    app = QApplication([])
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    images = {n: draw(n) for n in sizes}
    ASSETS.mkdir(parents=True, exist_ok=True)
    images[512].save(str(ASSETS / "icon.png"), "PNG")
    icns = Path(__file__).resolve().parent.parent / "MeteorPrep.app" / "Contents" / \
        "Resources" / "MeteorPrep.icns"
    if icns.parent.is_dir():
        write_icns(icns, images)
    print("wrote", ASSETS / "icon.png", "and", icns)
    # Qt's teardown of an offscreen app after painting can trip over its own
    # cleanup; the files are on disk, so leave without unwinding it
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    raise SystemExit(main())
