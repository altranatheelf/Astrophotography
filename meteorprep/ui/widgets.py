"""The painted parts: surfaces, keys, lamps, readouts and the one instrument.

Every widget here takes its colours from a :class:`~meteorprep.ui.theme.Theme`
and repaints when the theme changes, so switching skins is a single call —
``apply_theme(window, theme)`` walks the tree and hands each part its materials.

The painting obeys one light source: the lamp sits top-left, so every raised
thing carries a light line along its top edge and a hard shadow under its
bottom one, and every recess has the shadow at the top and the light lip at the
bottom.  That single rule is most of why the surfaces read as physical.
"""

from __future__ import annotations

import math
import random

from PySide6.QtCore import QPoint, QPointF, QRect, QRectF, QSize, Qt, Signal
from PySide6.QtGui import (QBrush, QColor, QConicalGradient, QFont, QFontMetrics,
                           QImage, QLinearGradient, QPainter, QPainterPath,
                           QPen, QPixmap, QPolygonF, QRadialGradient)
from PySide6.QtWidgets import (QAbstractButton, QFrame, QHBoxLayout, QLabel,
                               QPushButton, QSizePolicy, QVBoxLayout, QWidget)

from . import theme as T

FAM = {"serif": "Georgia", "caps": "Georgia", "mono": "Menlo", "hand": "Georgia"}


def set_families(fam: dict) -> None:
    FAM.update(fam)


# ----------------------------------------------------------------- colours
def col(spec, alpha=None) -> QColor:
    """A colour from '#rgb', '#rrggbb' or 'rgba(r,g,b,a)'."""
    if isinstance(spec, QColor):
        c = QColor(spec)
    elif spec.startswith("rgba"):
        parts = spec[spec.index("(") + 1:spec.rindex(")")].split(",")
        r, g, b = (int(float(x)) for x in parts[:3])
        a = float(parts[3]) if len(parts) > 3 else 1.0
        c = QColor(r, g, b, int(round(a * 255)))
    else:
        c = QColor(spec)
    if alpha is not None:
        c.setAlphaF(alpha)
    return c


def mix(a, b, f) -> QColor:
    ca, cb = col(a), col(b)
    return QColor(int(ca.red() + (cb.red() - ca.red()) * f),
                  int(ca.green() + (cb.green() - ca.green()) * f),
                  int(ca.blue() + (cb.blue() - ca.blue()) * f))


_NOISE: dict[int, QPixmap] = {}


def noise(alpha: int = 26) -> QPixmap:
    """A small tile of grain, built once.  Real materials are never flat and
    this is what stops every surface reading as vector art."""
    if alpha not in _NOISE:
        rnd = random.Random(7)
        img = QImage(96, 96, QImage.Format_ARGB32_Premultiplied)
        img.fill(0)
        for y in range(96):
            for x in range(96):
                v = rnd.randint(0, 255)
                a = int(alpha * (0.35 + 0.65 * (v / 255.0)))
                g = 255 if v > 127 else 0
                img.setPixelColor(x, y, QColor(g, g, g, a))
        _NOISE[alpha] = QPixmap.fromImage(img)
    return _NOISE[alpha]


def rr(rect, radius) -> QPainterPath:
    p = QPainterPath()
    p.addRoundedRect(QRectF(rect), radius, radius)
    return p


# ---------------------------------------------------------------- surfaces
def paint_ground(p: QPainter, rect: QRect, t: T.Theme) -> None:
    g = QLinearGradient(QPointF(0, rect.top()), QPointF(0, rect.bottom()))
    g.setColorAt(0.0, col(t.ground_top))
    g.setColorAt(0.5, col(t.ground))
    g.setColorAt(1.0, col(t.ground_bot))
    p.fillRect(rect, QBrush(g))
    lamp = QRadialGradient(QPointF(rect.width() * 0.10, rect.top() - 10),
                           max(rect.width(), rect.height()) * 0.85)
    lamp.setColorAt(0.0, col(t.lamp))
    lamp.setColorAt(1.0, col(t.lamp, 0.0))
    p.fillRect(rect, QBrush(lamp))
    if t.grain > 0.01:
        p.save()
        p.setOpacity(t.grain * 0.55)
        p.drawTiledPixmap(rect, noise())
        p.restore()


def paint_metal(p: QPainter, rect, t: T.Theme, radius=3) -> None:
    """Aged brass: olive-brown, a cool highlight on top, brushed streaks that
    never line up, and a dark line where it meets what is under it."""
    r = QRectF(rect)
    path = rr(r.adjusted(0.5, 0.5, -0.5, -0.5), radius)
    g = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
    g.setColorAt(0.0, col(t.metal_top))
    g.setColorAt(0.55, col(t.metal_mid))
    g.setColorAt(1.0, col(t.metal_bot))
    p.fillPath(path, QBrush(g))
    p.save()
    p.setClipPath(path)
    rnd = random.Random(3)
    for period, alpha in ((5, 10), (9, 8), (17, 6)):
        x = r.left()
        while x < r.right():
            p.fillRect(QRectF(x, r.top(), 1.0, r.height()),
                       QColor(255, 244, 214, alpha if rnd.random() > 0.5 else 0))
            p.fillRect(QRectF(x + 1, r.top(), 1.0, r.height()),
                       QColor(0, 0, 0, alpha // 2))
            x += period
    sheen = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
    sheen.setColorAt(0.0, QColor(255, 250, 230, 46))
    sheen.setColorAt(0.45, QColor(255, 255, 255, 0))
    sheen.setColorAt(1.0, QColor(0, 0, 0, 40))
    p.fillRect(r, QBrush(sheen))
    p.restore()
    p.setPen(QPen(col(t.metal_line), 1))
    p.drawPath(path)
    p.setPen(QPen(QColor(255, 244, 210, 110), 1))
    p.drawLine(QPointF(r.left() + radius, r.top() + 1.0),
               QPointF(r.right() - radius, r.top() + 1.0))


def paint_plate(p: QPainter, rect, t: T.Theme, radius=4, metal=False) -> None:
    if metal:
        paint_metal(p, rect, t, radius)
        return
    r = QRectF(rect)
    path = rr(r.adjusted(0.5, 0.5, -0.5, -1.5), radius)
    g = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
    g.setColorAt(0.0, col(t.plate_top))
    g.setColorAt(1.0, col(t.plate_bot))
    p.fillPath(path, QBrush(g))
    # the hard shadow the plate casts on the ground, one pixel of it
    p.setPen(QPen(QColor(0, 0, 0, 150), 1))
    p.drawLine(QPointF(r.left() + radius, r.bottom() - 0.5),
               QPointF(r.right() - radius, r.bottom() - 0.5))
    p.setPen(QPen(col(t.plate_line), 1))
    p.drawPath(path)
    p.setPen(QPen(col(t.plate_lit), 1))
    p.drawLine(QPointF(r.left() + radius, r.top() + 1.5),
               QPointF(r.right() - radius, r.top() + 1.5))


def paint_well(p: QPainter, rect, t: T.Theme, radius=4, tint: str | None = None,
               glow: str | None = None) -> None:
    r = QRectF(rect)
    path = rr(r.adjusted(0.5, 0.5, -0.5, -0.5), radius)
    g = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
    g.setColorAt(0.0, col(tint or t.well_top))
    g.setColorAt(1.0, col(tint or t.well_bot))
    p.fillPath(path, QBrush(g))
    if glow:
        gl = QRadialGradient(r.center(), r.width() * 0.7)
        gl.setColorAt(0.0, col(glow, 0.10))
        gl.setColorAt(1.0, col(glow, 0.0))
        p.fillPath(path, QBrush(gl))
    p.save()
    p.setClipPath(path)
    for i, a in enumerate((150, 96, 58, 30, 14)):     # the shadow falling in
        p.setPen(QPen(QColor(0, 0, 0, a), 1))
        p.drawLine(QPointF(r.left(), r.top() + 0.5 + i), QPointF(r.right(), r.top() + 0.5 + i))
    p.setPen(QPen(col(t.well_lit), 1))                 # the lit lip at the bottom
    p.drawLine(QPointF(r.left(), r.bottom() - 0.5), QPointF(r.right(), r.bottom() - 0.5))
    p.restore()
    p.setPen(QPen(col(t.well_line), 1))
    p.drawPath(path)


def paint_key(p: QPainter, rect, t: T.Theme, kind="key", pressed=False,
              hover=False, radius=4) -> None:
    """A milled key: a lit top face, a hard bottom edge you could feel, and a
    shadow under it.  Pressed drops it onto the panel instead of recolouring."""
    top, bot, line, edge = {
        "key": (t.key_top, t.key_bot, t.key_line, t.key_edge),
        "primary": (t.pri_top, t.pri_bot, t.pri_line, t.pri_edge),
        "stop": (t.stop_top, t.stop_bot, t.stop_line, t.stop_edge),
    }[kind]
    r = QRectF(rect)
    drop = 3 if kind == "stop" else 2
    if pressed:
        r = r.adjusted(0, drop, 0, 0)
        drop = 0
    body = QRectF(r.left() + 0.5, r.top() + 0.5, r.width() - 1, r.height() - drop - 1)
    path = rr(body, radius)
    if drop:
        p.fillPath(rr(QRectF(body.left(), body.top() + 2, body.width(), body.height() + drop - 1),
                      radius), col(edge))
    g = QLinearGradient(QPointF(0, body.top()), QPointF(0, body.bottom()))
    ct, cb = col(top), col(bot)
    if hover and not pressed:
        ct, cb = ct.lighter(112), cb.lighter(110)
    g.setColorAt(0.0, ct)
    g.setColorAt(0.60, mix(ct, cb, 0.75))
    g.setColorAt(1.0, cb)
    p.fillPath(path, QBrush(g))
    if kind == "primary":
        p.save()
        p.setClipPath(path)
        rnd = random.Random(11)
        x = body.left()
        while x < body.right():
            p.fillRect(QRectF(x, body.top(), 1.0, body.height()),
                       QColor(255, 245, 215, 12 if rnd.random() > 0.45 else 0))
            x += 4
        p.restore()
    p.setPen(QPen(col(line), 1))
    p.drawPath(path)
    if not pressed:
        p.setPen(QPen(QColor(255, 250, 235, 70 if kind != "primary" else 120), 1))
        p.drawLine(QPointF(body.left() + radius, body.top() + 1.5),
                   QPointF(body.right() - radius, body.top() + 1.5))
    else:
        p.setPen(QPen(QColor(0, 0, 0, 120), 1))
        p.drawLine(QPointF(body.left() + radius, body.top() + 1.5),
                   QPointF(body.right() - radius, body.top() + 1.5))


# ------------------------------------------------------------ theme plumbing
def apply_theme(root: QWidget, t: T.Theme) -> None:
    """Hand the theme to every painted part under ``root`` (and to root)."""
    for w in [root] + root.findChildren(QWidget):
        setter = getattr(w, "set_theme", None)
        if callable(setter):
            setter(t)


class Themed:
    """Mixin: keeps a theme and repaints when it changes."""

    def set_theme(self, t: T.Theme) -> None:
        self.t = t
        self.on_theme()
        self.update()

    def on_theme(self) -> None:
        pass


# ------------------------------------------------------------------ surfaces
class Skin(Themed, QWidget):
    """The window ground: the material everything else sits on."""

    def __init__(self, t: T.Theme, parent=None):
        super().__init__(parent)
        self.t = t
        self.setAutoFillBackground(False)

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        paint_ground(p, self.rect(), self.t)


class Plate(Themed, QFrame):
    def __init__(self, t: T.Theme, metal=False, rivets=False, radius=4, parent=None):
        super().__init__(parent)
        self.t = t
        self.metal = metal
        self.rivets = rivets
        self.radius = radius

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        paint_plate(p, self.rect(), self.t, self.radius, self.metal)
        if self.rivets:
            self._rivets(p)

    def _rivets(self, p):
        r = self.rect()
        rnd = random.Random(id(self) % 97)
        for cx, cy in ((r.left() + 9, r.top() + 9), (r.right() - 9, r.top() + 9),
                       (r.left() + 9, r.bottom() - 9), (r.right() - 9, r.bottom() - 9)):
            g = QRadialGradient(QPointF(cx - 1, cy - 1.5), 5)
            g.setColorAt(0.0, mix(self.t.metal_top, "#ffffff", 0.35))
            g.setColorAt(0.55, col(self.t.metal_bot))
            g.setColorAt(1.0, col(self.t.metal_line))
            p.setPen(Qt.NoPen)
            p.setBrush(QBrush(g))
            p.drawEllipse(QPointF(cx, cy), 3.5, 3.5)
            p.setPen(QPen(QColor(0, 0, 0, 140), 1))
            a = math.radians(rnd.uniform(-80, 80))
            p.drawLine(QPointF(cx - 2.4 * math.cos(a), cy - 2.4 * math.sin(a)),
                       QPointF(cx + 2.4 * math.cos(a), cy + 2.4 * math.sin(a)))


class Well(Themed, QFrame):
    def __init__(self, t: T.Theme, radius=4, console=False, parent=None):
        super().__init__(parent)
        self.t = t
        self.radius = radius
        self.console = console

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        tint = None
        glow = None
        if self.console:
            tint = mix(self.t.well_top, self.t.lcd_bg, 0.75).name()
            glow = self.t.lcd_glow or None
        paint_well(p, self.rect(), self.t, self.radius, tint, glow)


class Rail(Themed, QWidget):
    """The engraved limb across the bottom: the program's own status line."""

    def __init__(self, t: T.Theme, parent=None):
        super().__init__(parent)
        self.t = t
        self.left = ""
        self.right = ""
        self.setFixedHeight(34)

    def set_text(self, left=None, right=None):
        if left is not None:
            self.left = left
        if right is not None:
            self.right = right
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        paint_metal(p, self.rect(), self.t, 0)
        f = QFont(FAM["caps"], 10)
        f.setLetterSpacing(QFont.PercentageSpacing, 108)
        p.setFont(f)
        r = self.rect().adjusted(14, 0, -14, 0)
        p.setPen(QPen(QColor(255, 246, 220, 90), 1))
        p.drawText(r.adjusted(0, 1, 0, 1), Qt.AlignVCenter | Qt.AlignLeft, self.left)
        p.drawText(r.adjusted(0, 1, 0, 1), Qt.AlignVCenter | Qt.AlignRight, self.right)
        p.setPen(QPen(col(self.t.metal_ink), 1))
        p.drawText(r, Qt.AlignVCenter | Qt.AlignLeft, self.left)
        p.drawText(r, Qt.AlignVCenter | Qt.AlignRight, self.right)


class TitleBar(Themed, QWidget):
    """The table edge the window is set into, with the app's name engraved."""

    def __init__(self, t: T.Theme, parent=None):
        super().__init__(parent)
        self.t = t
        self.title = "MeteorPrep"
        self.setFixedHeight(30)

    def set_title(self, text):
        self.title = text
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = self.rect()
        g = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
        g.setColorAt(0.0, col(self.t.bar_top))
        g.setColorAt(1.0, col(self.t.bar_bot))
        p.fillRect(r, QBrush(g))
        p.save()
        p.setOpacity(0.35)
        p.drawTiledPixmap(r, noise())
        p.restore()
        p.setPen(QPen(col(self.t.bar_line), 1))
        p.drawLine(r.bottomLeft(), r.bottomRight())
        p.setPen(QPen(QColor(255, 220, 180, 34), 1))
        p.drawLine(r.topLeft(), r.topRight())
        f = QFont(FAM["caps"], 11)
        f.setLetterSpacing(QFont.PercentageSpacing, 114)
        p.setFont(f)
        p.setPen(QPen(QColor(0, 0, 0, 170), 1))
        p.drawText(r.adjusted(0, 1, 0, 1), Qt.AlignCenter, self.title)
        p.setPen(QPen(col(self.t.bar_ink), 1))
        p.drawText(r, Qt.AlignCenter, self.title)


# --------------------------------------------------------------------- keys
class Key(Themed, QPushButton):
    def __init__(self, text, t: T.Theme, kind="key", parent=None):
        super().__init__(text, parent)
        self.t = t
        self.kind = kind
        self._hover = False
        self.setCursor(Qt.PointingHandCursor)
        self.setFlat(True)
        self.on_theme()

    def on_theme(self):
        if self.kind == "primary":
            f = QFont(FAM["caps"], 12)
            f.setLetterSpacing(QFont.PercentageSpacing, 112)
            self.setMinimumHeight(34)
        elif self.kind == "stop":
            f = QFont(FAM["caps"], 15)
            f.setLetterSpacing(QFont.PercentageSpacing, 122)
            self.setMinimumHeight(40)
        else:
            f = QFont(FAM["serif"], 13)
            f.setWeight(QFont.DemiBold)
            self.setMinimumHeight(32)
        self.setFont(f)

    def enterEvent(self, ev):
        self._hover = True
        self.update()

    def leaveEvent(self, ev):
        self._hover = False
        self.update()

    def sizeHint(self):
        fm = QFontMetrics(self.font())
        pad = 30 if self.kind != "stop" else 44
        return QSize(fm.horizontalAdvance(self.text()) + pad, self.minimumHeight())

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        down = self.isDown()
        enabled = self.isEnabled()
        paint_key(p, self.rect(), self.t, self.kind, down, self._hover and enabled)
        ink = {"key": self.t.key_ink, "primary": self.t.pri_ink, "stop": self.t.stop_ink}[self.kind]
        r = self.rect().adjusted(0, 1 if down else -1, 0, 1 if down else -1)
        c = col(ink)
        if not enabled:
            c.setAlphaF(0.45)
        # cut the label into the material: dark above on light metal, the
        # other way round on dark
        light = col(self.t.pri_top if self.kind == "primary" else self.t.key_top).lightnessF() > 0.5
        p.setPen(QPen(QColor(255, 250, 235, 90) if light else QColor(0, 0, 0, 150), 1))
        p.drawText(r.adjusted(0, 1, 0, 1), Qt.AlignCenter, self.text())
        p.setPen(QPen(c, 1))
        p.drawText(r, Qt.AlignCenter, self.text())


# ------------------------------------------------------------------ readout
class Lcd(Themed, QFrame):
    """The window anything live is read through.  Amber and glowing on the
    dark skins; an ivory slip read in ink on the paper ones."""

    def __init__(self, t: T.Theme, size=12, lines=1, parent=None):
        super().__init__(parent)
        self.t = t
        self.size = size
        self._lines = [""] * lines
        self._dim = [False] * lines
        self.setMinimumHeight(10 + (size + 5) * lines)

    def set_lines(self, *lines, dim=None):
        self._lines = list(lines)
        self._dim = list(dim or [False] * len(lines))
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect())
        path = rr(r.adjusted(0.5, 0.5, -0.5, -0.5), 3)
        p.fillPath(path, col(self.t.lcd_bg))
        if self.t.lcd_glow:
            g = QRadialGradient(r.center(), r.width() * 0.8)
            g.setColorAt(0.0, col(self.t.lcd_glow, 0.10))
            g.setColorAt(1.0, col(self.t.lcd_glow, 0.0))
            p.fillPath(path, QBrush(g))
        p.save()
        p.setClipPath(path)
        for i, a in enumerate((140, 80, 40, 18)):
            p.setPen(QPen(QColor(0, 0, 0, a), 1))
            p.drawLine(QPointF(r.left(), r.top() + 0.5 + i), QPointF(r.right(), r.top() + 0.5 + i))
        gl = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.top() + r.height() * 0.45))
        gl.setColorAt(0.0, QColor(255, 255, 255, 22))
        gl.setColorAt(1.0, QColor(255, 255, 255, 0))
        p.fillRect(r, QBrush(gl))
        p.restore()
        p.setPen(QPen(col(self.t.lcd_line), 1))
        p.drawPath(path)

        f = QFont(FAM["mono"])
        f.setPixelSize(self.size)
        p.setFont(f)
        fm = QFontMetrics(f)
        lh = fm.height() + 2
        total = lh * len(self._lines)
        y = r.top() + max(4.0, (r.height() - total) / 2)
        for i, line in enumerate(self._lines):
            ink = col(self.t.lcd_dim if (i < len(self._dim) and self._dim[i]) else self.t.lcd_ink)
            box = QRectF(r.left() + 10, y, r.width() - 18, lh)
            if self.t.lcd_glow:
                p.setPen(QPen(col(self.t.lcd_glow, 0.35), 1))
                for dx, dy in ((0.6, 0), (-0.6, 0), (0, 0.6), (0, -0.6)):
                    p.drawText(box.translated(dx, dy), Qt.AlignVCenter | Qt.AlignLeft, line)
            p.setPen(QPen(ink, 1))
            p.drawText(box, Qt.AlignVCenter | Qt.AlignLeft,
                       fm.elidedText(line, Qt.ElideRight, int(r.width() - 18)))
            y += lh


class Lamp(Themed, QWidget):
    """A stage lamp: dark until its stage runs, lit while it does, and it
    keeps its real time once the stage has finished."""

    def __init__(self, t: T.Theme, label="", parent=None):
        super().__init__(parent)
        self.t = t
        self.label = label
        self.state = "off"          # off | lit | hot
        self.sub = ""
        self.setMinimumSize(58, 46)

    def set_state(self, state, sub=""):
        self.state, self.sub = state, sub
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        cx, cy = self.width() / 2, 7.0
        on = self.state in ("lit", "hot")
        warm = col(self.t.accent if self.t.lcd_glow else self.t.metal_top)
        if on:
            halo = QRadialGradient(QPointF(cx, cy), 13 if self.state == "hot" else 9)
            halo.setColorAt(0.0, QColor(warm.red(), warm.green(), warm.blue(),
                                        150 if self.state == "hot" else 90))
            halo.setColorAt(1.0, QColor(warm.red(), warm.green(), warm.blue(), 0))
            p.setPen(Qt.NoPen)
            p.setBrush(QBrush(halo))
            p.drawEllipse(QPointF(cx, cy), 14, 14)
        g = QRadialGradient(QPointF(cx - 1.4, cy - 1.6), 8)
        if on:
            g.setColorAt(0.0, mix(warm, "#ffffff", 0.75 if self.state == "hot" else 0.55))
            g.setColorAt(0.55, warm)
            g.setColorAt(1.0, mix(warm, "#000000", 0.55))
        else:
            g.setColorAt(0.0, mix(self.t.metal_bot, "#000000", 0.35))
            g.setColorAt(1.0, mix(self.t.metal_line, "#000000", 0.45))
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(g))
        p.drawEllipse(QPointF(cx, cy), 6, 6)
        p.setPen(QPen(col(self.t.metal_bot), 1.4))
        p.drawEllipse(QPointF(cx, cy), 7.2, 7.2)

        f = QFont(FAM["caps"], 9)
        f.setLetterSpacing(QFont.PercentageSpacing, 106)
        p.setFont(f)
        p.setPen(QPen(col(self.t.ink_caps if on else self.t.ink_dim), 1))
        fmm = QFontMetrics(f)
        p.drawText(QRect(0, 17, self.width(), 13), Qt.AlignHCenter | Qt.AlignTop,
                   fmm.elidedText(self.label, Qt.ElideRight, self.width()))
        if self.sub:
            fs = QFont(FAM["mono"], 9) if self.state != "hot" else QFont(FAM["serif"], 10)
            if self.state == "hot":
                fs.setItalic(True)
            p.setFont(fs)
            p.setPen(QPen(col(self.t.accent if self.t.lcd_glow else self.t.ink_dim), 1))
            p.drawText(QRect(0, 30, self.width(), 14), Qt.AlignHCenter | Qt.AlignTop, self.sub)


# ------------------------------------------------------------- instruments
class Instrument(Themed, QWidget):
    """The one overbuilt thing: a chronometer dial, or the sextant the
    Lantern skin uses instead.  Same job, same slot, different object."""

    def __init__(self, t: T.Theme, size=168, parent=None):
        super().__init__(parent)
        self.t = t
        self.value = 0
        self.setFixedSize(size, size)

    def set_value(self, pct):
        pct = max(0, min(100, int(pct)))
        if pct != self.value:
            self.value = pct
            self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        if self.t.instrument == "sextant":
            self._sextant(p)
        else:
            self._dial(p)

    # -- the chronometer ---------------------------------------------------
    def _dial(self, p: QPainter):
        s = min(self.width(), self.height())
        c = QPointF(s / 2, s / 2)
        R = s / 2

        def pt(deg, rad):
            a = math.radians(deg - 90)
            return QPointF(c.x() + rad * math.cos(a), c.y() + rad * math.sin(a))

        # bezel
        bez = QLinearGradient(QPointF(0, 0), QPointF(0, s))
        bez.setColorAt(0.0, col(self.t.bezel_top))
        bez.setColorAt(0.5, col(self.t.bezel_mid))
        bez.setColorAt(1.0, col(self.t.bezel_bot))
        p.setPen(QPen(col(self.t.metal_line), 1))
        p.setBrush(QBrush(bez))
        p.drawEllipse(c, R - 1, R - 1)
        # knurling
        p.setPen(QPen(QColor(0, 0, 0, 80), 0.8))
        for i in range(120):
            p.drawLine(pt(i * 3, R - 2), pt(i * 3, R - 4.5))
        ring = R - 11
        face = QRadialGradient(QPointF(c.x(), c.y() - ring * 0.25), ring * 1.5)
        face.setColorAt(0.0, col(self.t.face_top))
        face.setColorAt(1.0, col(self.t.face_bot))
        p.setPen(QPen(col(self.t.metal_line), 1.4))
        p.setBrush(QBrush(face))
        p.drawEllipse(c, ring, ring)

        # the rose printed faintly on the face
        ink = col(self.t.face_ink)
        for n, rl, dark, light in ((16, ring * 0.40, 40, 12), (8, ring * 0.56, 76, 20)):
            for i in range(n):
                a0 = i * 360 / n + (11.25 if n == 16 else 0)
                ah = 360 / n / 2
                tip, l, r_ = pt(a0, rl), pt(a0 - ah, rl * 0.2), pt(a0 + ah, rl * 0.2)
                for poly, alpha in ((QPolygonF([c, l, tip]), dark), (QPolygonF([c, tip, r_]), light)):
                    p.setPen(Qt.NoPen)
                    p.setBrush(QColor(ink.red(), ink.green(), ink.blue(), alpha))
                    p.drawPolygon(poly)

        # the divided ring
        f = QFont(FAM["mono"], 8)
        f.setWeight(QFont.DemiBold)
        p.setFont(f)
        for i in range(101):
            a = i * 3.6
            L = 8 if i % 10 == 0 else (5 if i % 5 == 0 else 2.5)
            p.setPen(QPen(ink, 1.3 if i % 10 == 0 else 0.7))
            p.drawLine(pt(a, ring - 2), pt(a, ring - 2 - L))
            if i % 10 == 0 and i < 100:
                q = pt(a, ring - 18)
                p.drawText(QRectF(q.x() - 12, q.y() - 7, 24, 14), Qt.AlignCenter, str(i))
        # maker's line
        fm = QFont(FAM["caps"], 8)
        fm.setLetterSpacing(QFont.PercentageSpacing, 118)
        p.setFont(fm)
        p.setPen(QPen(ink, 1))
        p.drawText(QRectF(0, c.y() - ring * 0.34 - 7, s, 14), Qt.AlignCenter, "MeteorPrep")

        # travelled arc
        if self.value > 0:
            p.setPen(QPen(col(self.t.arc), 3, Qt.SolidLine, Qt.FlatCap))
            rect = QRectF(c.x() - (ring - 12.5), c.y() - (ring - 12.5),
                          2 * (ring - 12.5), 2 * (ring - 12.5))
            p.drawArc(rect, 90 * 16, -int(self.value * 3.6 * 16))

        # the aperture the percent shows through, then the hand over it
        aw, ah_ = 50, 22
        ax, ay = c.x() - aw / 2, c.y() + ring * 0.17
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 60))
        p.drawRoundedRect(QRectF(ax - 1, ay + 2, aw + 2, ah_ + 2), 4, 4)
        p.setBrush(QBrush(bez))
        p.setPen(QPen(col(self.t.metal_line), 1))
        p.drawRoundedRect(QRectF(ax - 2.5, ay - 2.5, aw + 5, ah_ + 5), 4, 4)
        p.setBrush(col(self.t.lcd_bg))
        p.drawRoundedRect(QRectF(ax, ay, aw, ah_), 2.5, 2.5)
        fw = QFont(FAM["mono"], 12)
        fw.setWeight(QFont.DemiBold)
        p.setFont(fw)
        if self.t.lcd_glow:
            p.setPen(QPen(col(self.t.lcd_glow, 0.4), 1))
            for dx, dy in ((0.7, 0), (-0.7, 0), (0, 0.7), (0, -0.7)):
                p.drawText(QRectF(ax + dx, ay + dy, aw, ah_), Qt.AlignCenter, f"{self.value}%")
        p.setPen(QPen(col(self.t.window_ink), 1))
        p.drawText(QRectF(ax, ay, aw, ah_), Qt.AlignCenter, f"{self.value}%")

        # blued-steel hand with its counterweight
        hn = ring - 13
        p.save()
        p.translate(c)
        p.rotate(self.value * 3.6)
        hand = QPolygonF([QPointF(-3, 0), QPointF(0, -hn), QPointF(3, 0), QPointF(0, R * 0.20)])
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 70))
        p.drawPolygon(hand.translated(1.5, 2))
        ng = QLinearGradient(QPointF(-3, 0), QPointF(3, 0))
        ng.setColorAt(0.0, mix(self.t.needle, "#000000", 0.45))
        ng.setColorAt(0.5, col(self.t.needle))
        ng.setColorAt(1.0, mix(self.t.needle, "#000000", 0.55))
        p.setBrush(QBrush(ng))
        p.setPen(QPen(QColor(0, 0, 0, 160), 0.6))
        p.drawPolygon(hand)
        p.restore()
        p.setBrush(QBrush(bez))
        p.setPen(QPen(col(self.t.metal_line), 1))
        p.drawEllipse(c, 5.5, 5.5)
        p.setBrush(col(self.t.metal_line))
        p.setPen(Qt.NoPen)
        p.drawEllipse(c, 2, 2)

        # glass: one asymmetric specular, and the bezel's shadow on the face
        gl = QRadialGradient(QPointF(c.x() - ring * 0.35, c.y() - ring * 0.55), ring * 1.4)
        gl.setColorAt(0.0, QColor(255, 255, 255, 64))
        gl.setColorAt(0.4, QColor(255, 255, 255, 14))
        gl.setColorAt(1.0, QColor(255, 255, 255, 0))
        p.setBrush(QBrush(gl))
        p.drawEllipse(c, ring, ring)
        sh = QRadialGradient(c, ring)
        sh.setColorAt(0.84, QColor(0, 0, 0, 0))
        sh.setColorAt(1.0, QColor(0, 0, 0, 120))
        p.setBrush(QBrush(sh))
        p.drawEllipse(c, ring, ring)

    # -- the sextant -------------------------------------------------------
    def _sextant(self, p: QPainter):
        s = min(self.width(), self.height())
        piv = QPointF(s / 2, s * 0.12)
        R = s * 0.50
        a0, a1 = -52.0, 52.0
        ang = a0 + (a1 - a0) * self.value / 100.0

        def pt(deg, rad):
            t = math.radians(deg)
            return QPointF(piv.x() + rad * math.sin(t), piv.y() + rad * math.cos(t))

        brass = QLinearGradient(QPointF(0, 0), QPointF(0, s))
        brass.setColorAt(0.0, col(self.t.bezel_top))
        brass.setColorAt(0.5, col(self.t.bezel_mid))
        brass.setColorAt(1.0, col(self.t.bezel_bot))

        for d in (a0, a1):                      # the frame's two braces
            p.setPen(QPen(mix(self.t.plate_top, "#ffffff", 0.10), 5, Qt.SolidLine, Qt.RoundCap))
            p.drawLine(piv, pt(d, R))
            p.setPen(QPen(mix(self.t.plate_top, "#ffffff", 0.28), 1.2, Qt.SolidLine, Qt.RoundCap))
            p.drawLine(piv, pt(d, R))

        limb = QPainterPath()                    # the graduated limb
        limb.moveTo(pt(a0, R))
        rect_o = QRectF(piv.x() - R, piv.y() - R, 2 * R, 2 * R)
        limb.arcTo(rect_o, -90 - a0, -(a1 - a0))
        limb.lineTo(pt(a1, R - 15))
        rect_i = QRectF(piv.x() - (R - 15), piv.y() - (R - 15), 2 * (R - 15), 2 * (R - 15))
        limb.arcTo(rect_i, -90 - a1, (a1 - a0))
        limb.closeSubpath()
        p.setPen(QPen(col(self.t.metal_line), 1))
        p.setBrush(QBrush(brass))
        p.drawPath(limb)

        p.setPen(QPen(mix(self.t.metal_line, "#000000", 0.3), 0.8))
        for i in range(0, 101, 2):
            d = a0 + (a1 - a0) * i / 100.0
            L = 9 if i % 10 == 0 else (6 if i % 5 == 0 else 3.5)
            p.setPen(QPen(mix(self.t.metal_line, "#000000", 0.3), 1.3 if i % 10 == 0 else 0.7))
            p.drawLine(pt(d, R - 1.5), pt(d, R - 1.5 - L))
        f = QFont(FAM["mono"], 8)
        p.setFont(f)
        p.setPen(QPen(col(self.t.face_ink), 1))
        for i in (0, 50, 100):
            d = a0 + (a1 - a0) * i / 100.0
            q = pt(d, R + 13)
            p.drawText(QRectF(q.x() - 14, q.y() - 8, 28, 16), Qt.AlignCenter, str(i))

        if self.value > 0:                        # the swept portion, glowing
            swept = QPainterPath()
            swept.moveTo(pt(a0, R - 8))
            rect_s = QRectF(piv.x() - (R - 8), piv.y() - (R - 8), 2 * (R - 8), 2 * (R - 8))
            swept.arcTo(rect_s, -90 - a0, -(ang - a0))
            glow = col(self.t.arc)
            p.setPen(QPen(QColor(glow.red(), glow.green(), glow.blue(), 70), 7,
                          Qt.SolidLine, Qt.RoundCap))
            p.drawPath(swept)
            p.setPen(QPen(glow, 3, Qt.SolidLine, Qt.RoundCap))
            p.drawPath(swept)

        end = pt(ang, R + 2)                      # the index arm
        p.setPen(QPen(col(self.t.well_top), 7, Qt.SolidLine, Qt.RoundCap))
        p.drawLine(piv, end)
        p.setPen(QPen(QBrush(brass), 4.4, Qt.SolidLine, Qt.RoundCap))
        p.drawLine(piv, end)

        blk = pt(ang, R - 7)                      # the clamp block riding the arc
        p.save()
        p.translate(blk)
        p.rotate(-ang)
        p.setPen(QPen(col(self.t.bezel_mid), 1.2))
        p.setBrush(col(self.t.plate_top))
        p.drawRoundedRect(QRectF(-11, -9, 22, 18), 3, 3)
        p.setPen(QPen(col(self.t.arc), 1.4))
        p.drawLine(QPointF(0, -7), QPointF(0, 7))
        p.restore()

        p.setPen(QPen(col(self.t.metal_line), 1))
        p.setBrush(QBrush(brass))
        p.drawEllipse(piv, 9, 9)
        p.setBrush(col(self.t.well_top))
        p.drawEllipse(piv, 3, 3)

        ry = piv.y() + R + 26                      # the reading, in its lit window
        box = QRectF(s / 2 - 30, ry, 60, 28)
        p.setBrush(col(self.t.lcd_bg))
        p.setPen(QPen(col(self.t.bezel_mid), 1.2))
        p.drawRoundedRect(box, 3, 3)
        p.setBrush(QColor(255, 255, 255, 12))
        p.setPen(Qt.NoPen)
        p.drawRoundedRect(QRectF(box.left() + 1.5, box.top() + 1.5, box.width() - 3,
                                 box.height() * 0.45), 2, 2)
        fw = QFont(FAM["mono"], 13)
        fw.setWeight(QFont.DemiBold)
        p.setFont(fw)
        if self.t.lcd_glow:
            p.setPen(QPen(col(self.t.lcd_glow, 0.45), 1))
            for dx, dy in ((0.8, 0), (-0.8, 0), (0, 0.8), (0, -0.8)):
                p.drawText(box.translated(dx, dy), Qt.AlignCenter, f"{self.value}%")
        p.setPen(QPen(col(self.t.window_ink), 1))
        p.drawText(box, Qt.AlignCenter, f"{self.value}%")


class MoonDisc(Themed, QWidget):
    """The moon tonight, drawn from its real illuminated fraction: a 3% moon
    is a 3% sliver, which is the useful thing to know before a night out."""

    def __init__(self, t: T.Theme, size=68, parent=None):
        super().__init__(parent)
        self.t = t
        self.illum = 0.0
        self.waxing = True
        self.setFixedSize(size, size)

    def set_phase(self, illum, waxing=True):
        self.illum, self.waxing = max(0.0, min(1.0, illum)), waxing
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        s = min(self.width(), self.height())
        c = QPointF(s / 2, s / 2)
        R = s / 2 - 1
        # the bezel it is set into
        bez = QLinearGradient(QPointF(0, 0), QPointF(0, s))
        bez.setColorAt(0.0, col(self.t.bezel_top))
        bez.setColorAt(1.0, col(self.t.bezel_bot))
        p.setPen(QPen(col(self.t.metal_line), 1))
        p.setBrush(QBrush(bez))
        p.drawEllipse(c, R, R)
        rr_ = R - 5
        p.setBrush(col(self.t.well_top))
        p.setPen(QPen(QColor(0, 0, 0, 160), 1))
        p.drawEllipse(c, rr_, rr_)

        disc = rr_ - 3
        p.setPen(Qt.NoPen)
        p.setBrush(mix(self.t.well_top, self.t.ink, 0.12))
        p.drawEllipse(c, disc, disc)
        p.setPen(QPen(col(self.t.ink, 0.22), 1.1))
        p.setBrush(Qt.NoBrush)
        p.drawEllipse(c, disc - 0.6, disc - 0.6)

        # the lit limb: a half disc minus an ellipse of the terminator
        dark = mix(self.t.well_top, self.t.ink, 0.12)
        lit_col = col("#efe4c0") if not self.t.is_light() else col("#fbf3d8")
        k = abs(1 - 2 * self.illum) * disc
        p.save()
        if not self.waxing:                    # a waning moon is lit on the left
            p.translate(c)
            p.scale(-1, 1)
            p.translate(-c.x(), -c.y())
        half = QPainterPath()                  # the half that faces the sun
        half.moveTo(QPointF(c.x(), c.y() - disc))
        half.arcTo(QRectF(c.x() - disc, c.y() - disc, 2 * disc, 2 * disc), 90, -180)
        half.closeSubpath()
        p.setPen(Qt.NoPen)
        p.setBrush(lit_col)
        p.drawPath(half)
        term = QRectF(c.x() - k, c.y() - disc, 2 * k, 2 * disc)
        p.setBrush(dark if self.illum < 0.5 else lit_col)
        p.drawEllipse(term)                    # the terminator, an ellipse
        p.restore()
        # glass
        g = QRadialGradient(QPointF(c.x() - disc * 0.4, c.y() - disc * 0.55), disc * 1.6)
        g.setColorAt(0.0, QColor(255, 255, 255, 46))
        g.setColorAt(1.0, QColor(255, 255, 255, 0))
        p.setBrush(QBrush(g))
        p.drawEllipse(c, rr_, rr_)


# ------------------------------------------------------------- theme picker
class Swatch(Themed, QAbstractButton):
    """One sample plate, cut from the theme it stands for."""

    def __init__(self, t: T.Theme, sample: T.Theme, parent=None):
        super().__init__(parent)
        self.t = t
        self.sample = sample
        self.setCheckable(True)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(52, 40)
        self.setToolTip(f"{sample.name} — {sample.blurb}")

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        ground, metal, glow = self.sample.swatch
        r = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        path = rr(r, 3)
        g = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
        g.setColorAt(0.0, col(ground).lighter(112))
        g.setColorAt(1.0, col(ground).darker(112))
        p.fillPath(path, QBrush(g))
        p.save()
        p.setClipPath(path)
        mg = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.top() + 9))
        mg.setColorAt(0.0, col(metal).lighter(118))
        mg.setColorAt(1.0, col(metal))
        p.fillRect(QRectF(r.left(), r.top(), r.width(), 9), QBrush(mg))
        p.setPen(QPen(QColor(255, 250, 235, 90), 1))
        p.drawLine(QPointF(r.left(), r.top() + 0.5), QPointF(r.right(), r.top() + 0.5))
        p.setBrush(col(glow))
        p.setPen(Qt.NoPen)
        p.drawRoundedRect(QRectF(r.left() + 7, r.top() + 17, 24, 11), 2, 2)
        p.setBrush(col(metal))
        p.drawRoundedRect(QRectF(r.left() + 35, r.top() + 17, 11, 11), 2, 2)
        p.restore()
        if self.isChecked():
            p.setPen(QPen(col(self.t.metal_top), 2))
            p.setBrush(Qt.NoBrush)
            p.drawPath(rr(r.adjusted(-0.5, -0.5, 0.5, 0.5), 3.5))
            p.setPen(QPen(col(self.t.accent, 0.55), 1))
            p.drawPath(rr(r.adjusted(-1.5, -1.5, 1.5, 1.5), 4.5))
        else:
            p.setPen(QPen(QColor(0, 0, 0, 120), 1))
            p.setBrush(Qt.NoBrush)
            p.drawPath(path)


class ThemePicker(Themed, QWidget):
    """Four sample plates; the chosen one sits in a lit bezel."""

    changed = Signal(str)

    def __init__(self, t: T.Theme, parent=None):
        super().__init__(parent)
        self.t = t
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 8, 14, 8)
        lay.setSpacing(6)
        cap = QLabel("Theme")
        cap.setObjectName("caps")
        lay.addWidget(cap)
        row = QHBoxLayout()
        row.setSpacing(8)
        self.swatches = {}
        for key in T.ORDER:
            sw = Swatch(t, T.THEMES[key], self)
            sw.setChecked(key == t.key)
            sw.clicked.connect(lambda _=False, k=key: self._pick(k))
            self.swatches[key] = sw
            row.addWidget(sw)
        row.addStretch(1)
        lay.addLayout(row)
        self.name = QLabel(t.name)
        self.name.setObjectName("capsSmall")
        lay.addWidget(self.name)

    def _pick(self, key):
        for k, sw in self.swatches.items():
            sw.setChecked(k == key)
        self.changed.emit(key)

    def on_theme(self):
        for k, sw in self.swatches.items():
            sw.setChecked(k == self.t.key)
        self.name.setText(self.t.name)


# ------------------------------------------------------------------- tables
class LedgerTable(Themed, QWidget):
    """Rows in a well: a mark column, a name, figures right-aligned, a chevron.
    Used for the recent nights and for the files a run wrote."""

    activated = Signal(int)

    def __init__(self, t: T.Theme, columns, row_h=38, head=True, parent=None):
        super().__init__(parent)
        self.t = t
        self.columns = columns        # list of (key, align, width or None)
        self.row_h = row_h
        self.head = head
        self.rows = []
        self._hover = -1
        self.setMouseTracking(True)
        self.setCursor(Qt.PointingHandCursor)

    def set_rows(self, rows):
        self.rows = rows
        self.setFixedHeight(self._needed())
        self.update()

    def _needed(self):
        return (20 if self.head else 0) + self.row_h * max(len(self.rows), 1) + 4

    def _row_at(self, y):
        y -= (20 if self.head else 0)
        if y < 0:
            return -1
        i = int(y // self.row_h)
        return i if 0 <= i < len(self.rows) else -1

    def mouseMoveEvent(self, ev):
        i = self._row_at(ev.position().y())
        if i != self._hover:
            self._hover = i
            self.update()

    def leaveEvent(self, ev):
        self._hover = -1
        self.update()

    def mouseReleaseEvent(self, ev):
        i = self._row_at(ev.position().y())
        if i >= 0:
            self.activated.emit(i)

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        paint_well(p, self.rect(), self.t, 4)
        w = self.width()
        y = 0
        if self.head:
            p.save()
            p.setClipPath(rr(QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5), 4))
            p.fillRect(QRect(0, 0, w, 20), QColor(0, 0, 0, 40 if self.t.is_light() else 70))
            f = QFont(FAM["caps"], 8)
            f.setLetterSpacing(QFont.PercentageSpacing, 114)
            p.setFont(f)
            p.setPen(QPen(col(self.t.ink_caps if self.t.is_light() else self.t.row_head), 1))
            for key, align, x0, x1 in self._geom(w):
                p.drawText(QRect(x0, 3, x1 - x0, 14), align | Qt.AlignVCenter, key.upper())
            p.restore()
            y = 20
        for i, row in enumerate(self.rows):
            rect = QRect(0, y, w, self.row_h)
            p.save()
            p.setClipRect(rect)
            if i == self._hover:
                p.fillRect(rect, QColor(255, 255, 255, 14 if not self.t.is_light() else 30))
            if i:
                p.setPen(QPen(col(self.t.row_line), 1))
                p.drawLine(QPointF(0, y + 0.5), QPointF(w, y + 0.5))
                p.setPen(QPen(col(self.t.well_lit), 1))
                p.drawLine(QPointF(0, y + 1.5), QPointF(w, y + 1.5))
            for (key, align, x0, x1), cell in zip(self._geom(w), row):
                text, style = cell if isinstance(cell, tuple) else (cell, "plain")
                if style == "mono":
                    p.setFont(QFont(FAM["mono"], 10))
                    p.setPen(QPen(col(self.t.row_fig), 1))
                elif style == "date":
                    p.setFont(QFont(FAM["mono"], 10))
                    p.setPen(QPen(col(self.t.row_date), 1))
                elif style == "hot":
                    p.setFont(QFont(FAM["mono"], 10))
                    p.setPen(QPen(col(self.t.accent), 1))
                elif style == "note":
                    p.setFont(QFont(FAM["serif"], 11))
                    p.setPen(QPen(col(self.t.row_head), 1))
                else:
                    p.setFont(QFont(FAM["serif"], 13))
                    p.setPen(QPen(col(self.t.row_name), 1))
                fm = QFontMetrics(p.font())
                p.drawText(QRect(x0, y, x1 - x0, self.row_h), align | Qt.AlignVCenter,
                           fm.elidedText(str(text), Qt.ElideRight, x1 - x0))
            p.setFont(QFont(FAM["serif"], 13))
            p.setPen(QPen(col(self.t.chevron), 1))
            p.drawText(QRect(w - 20, y, 14, self.row_h), Qt.AlignVCenter | Qt.AlignRight, "›")
            p.restore()
            y += self.row_h

    def _geom(self, w):
        out = []
        x = 14
        fixed = sum(c[2] for c in self.columns if c[2])
        flex = [c for c in self.columns if not c[2]]
        spare = max(60, w - 34 - fixed) // max(1, len(flex))
        for key, align, width in self.columns:
            cw = width or spare
            out.append((key, align, x, x + cw))
            x += cw
        return out


class FrameStrip(Themed, QWidget):
    """The night's frames in a tray: the camera's own thumbnail, the frame
    number, and the classifier's verdict once it has one."""

    def __init__(self, t: T.Theme, rows=2, cols=7, parent=None):
        super().__init__(parent)
        self.t = t
        self.rows, self.cols = rows, cols
        self.count = 0
        self.current = -1
        self.thumbs: dict[int, QPixmap] = {}
        self.verdicts: dict[int, str] = {}
        self.setMinimumHeight(118)

    def clear(self):
        """A different folder: forget the pictures as well as the marks."""
        self.count = 0
        self.current = -1
        self.thumbs.clear()
        self.verdicts.clear()
        self.update()

    def set_count(self, count):
        """How many frames this night has.  The thumbnails already read stay —
        they belong to these photographs, and reading them again is wasteful."""
        self.count = int(count)
        self.current = -1
        self.update()

    def clear_verdicts(self):
        self.verdicts.clear()
        self.current = -1
        self.update()

    def set_thumb(self, i, pix):
        self.thumbs[i] = pix
        self.update()

    def set_verdict(self, i, text):
        self.verdicts[i] = text
        self.update()

    def set_current(self, i):
        if i != self.current:
            self.current = i
            self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        paint_well(p, self.rect(), self.t, 3,
                   tint=mix(self.t.well_top, "#000000", 0.35).name())
        if not self.count:
            f = QFont(FAM["serif"], 12)
            f.setItalic(True)
            p.setFont(f)
            p.setPen(QPen(col(self.t.ink_dim), 1))
            p.drawText(self.rect(), Qt.AlignCenter, "the night's frames appear here")
            return
        n = min(self.count, self.rows * self.cols)
        cw = (self.width() - 24) / self.cols
        ch = (self.height() - 18) / self.rows
        tw, th = min(72.0, cw - 6), min(46.0, ch - 6)
        for i in range(n):
            r, c = divmod(i, self.cols)
            x = 12 + c * cw + (cw - 6 - tw) / 2
            y = 9 + r * ch + (ch - 6 - th) / 2
            cell = QRectF(x, y, tw, th)
            pend = self.verdicts.get(i) is None and i != self.current
            p.save()
            p.setClipPath(rr(cell, 2))
            p.fillRect(cell, col(self.t.well_bot).darker(115))
            pix = self.thumbs.get(i)
            if pix is not None and not pix.isNull():
                p.setOpacity(0.42 if pend else 1.0)
                scaled = pix.scaled(int(tw), int(th - 15), Qt.KeepAspectRatioByExpanding,
                                    Qt.SmoothTransformation)
                p.drawPixmap(QRectF(cell.left(), cell.top(), tw, th - 15),
                             scaled, QRectF(0, 0, scaled.width(), scaled.height()))
                p.setOpacity(1.0)
            tag = QRectF(cell.left(), cell.bottom() - 15, tw, 15)
            p.fillRect(tag, QColor(6, 6, 5, 210))
            p.setFont(QFont(FAM["mono"], 8))
            p.setPen(QPen(col(self.t.ink_dim if pend else self.t.ink_data), 1))
            p.drawText(tag.adjusted(4, 0, -4, 0), Qt.AlignVCenter | Qt.AlignLeft, f"{i+1:02d}")
            v = self.verdicts.get(i)
            if i == self.current and v is None:
                v = "…"
            if v:
                hot = v not in ("✓", "…")
                p.setPen(QPen(col(self.t.accent if hot else self.t.ink_data), 1))
                p.drawText(tag.adjusted(4, 0, -4, 0), Qt.AlignVCenter | Qt.AlignRight, v)
            p.restore()
            p.setPen(QPen(col(self.t.accent) if i == self.current else QColor(0, 0, 0, 200),
                          1.4 if i == self.current else 1))
            p.setBrush(Qt.NoBrush)
            p.drawPath(rr(cell, 2))
        if self.count > n:
            p.setFont(QFont(FAM["mono"], 9))
            p.setPen(QPen(col(self.t.ink_dim), 1))
            p.drawText(self.rect().adjusted(0, 0, -14, -4),
                       Qt.AlignRight | Qt.AlignBottom, f"+{self.count - n} more")


class PhotoMount(Themed, QWidget):
    """How the finished picture is kept: a brass-bound box, pinned to the
    chart, on photo corners, or under glass — the theme decides."""

    def __init__(self, t: T.Theme, parent=None):
        super().__init__(parent)
        self.t = t
        self.pix = None
        self.cap1 = ""
        self.cap2 = ""
        self.setMinimumHeight(220)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

    def set_photo(self, pix, cap1="", cap2=""):
        self.pix, self.cap1, self.cap2 = pix, cap1, cap2
        self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        t = self.t
        outer = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        cap_h = 34 if (self.cap1 or self.cap2) else 0
        pad = 12 if t.mount in ("pins", "corners") else 10

        if t.mount == "box":
            path = rr(outer, 4)
            g = QLinearGradient(QPointF(0, outer.top()), QPointF(0, outer.bottom()))
            g.setColorAt(0.0, col(t.mat_top))
            g.setColorAt(1.0, col(t.mat_bot))
            p.fillPath(path, QBrush(g))
            p.save()
            p.setClipPath(path)
            rnd = random.Random(5)                     # sawn planks, not stripes
            y = outer.top()
            while y < outer.bottom():
                h = rnd.choice((9, 15, 31, 36))
                p.fillRect(QRectF(outer.left(), y, outer.width(), h),
                           QColor(255, 255, 255, rnd.choice((0, 5, 9))))
                y += h
            p.setOpacity(0.5)
            p.drawTiledPixmap(outer.toRect(), noise(18))
            p.restore()
            p.setPen(QPen(col(t.mat_line), 1))
            p.drawPath(path)
        elif t.mount == "glass":
            path = rr(outer, 3)
            g = QLinearGradient(QPointF(0, outer.top()), QPointF(0, outer.bottom()))
            g.setColorAt(0.0, col(t.mat_top))
            g.setColorAt(1.0, col(t.mat_bot))
            p.fillPath(path, QBrush(g))
            p.setPen(QPen(col(t.mat_line), 1))
            p.drawPath(path)
            p.setPen(QPen(QColor(255, 210, 150, 40), 1))
            p.drawLine(QPointF(outer.left() + 3, outer.top() + 1.5),
                       QPointF(outer.right() - 3, outer.top() + 1.5))
        else:                                          # paper: a mat or a leaf
            path = rr(outer, 2)
            g = QLinearGradient(QPointF(0, outer.top()), QPointF(0, outer.bottom()))
            g.setColorAt(0.0, col(t.mat_top))
            g.setColorAt(1.0, col(t.mat_bot))
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(0, 0, 0, 60))
            p.drawRoundedRect(outer.adjusted(3, 5, 3, 6), 2, 2)
            p.fillPath(path, QBrush(g))
            p.setPen(QPen(col(t.mat_line), 1))
            p.drawPath(path)

        inner = QRectF(outer.left() + pad, outer.top() + pad,
                       outer.width() - 2 * pad, outer.height() - 2 * pad - cap_h)
        if self.pix is not None and not self.pix.isNull():
            scaled = self.pix.scaled(inner.size().toSize(), Qt.KeepAspectRatio,
                                     Qt.SmoothTransformation)
            box = QRectF(inner.center().x() - scaled.width() / 2.0,
                         inner.top() + (inner.height() - scaled.height()) / 2.0,
                         scaled.width(), scaled.height())
            p.fillRect(box.adjusted(-1, -1, 1, 1), QColor(5, 5, 5))
            p.drawPixmap(box.topLeft(), scaled)
            p.setPen(QPen(col(t.metal_mid), 2))
            p.setBrush(Qt.NoBrush)
            p.drawRect(box.adjusted(-2, -2, 2, 2))
            sheen = QLinearGradient(box.topLeft(), QPointF(box.right(), box.bottom()))
            sheen.setColorAt(0.0, QColor(255, 255, 255, 26))
            sheen.setColorAt(0.35, QColor(255, 255, 255, 6))
            sheen.setColorAt(0.55, QColor(255, 255, 255, 0))
            p.fillRect(box, QBrush(sheen))
            if t.mount == "corners":                    # black photo corners
                p.setPen(Qt.NoPen)
                p.setBrush(QColor(24, 18, 13))
                for cx, cy, pts in (
                        (box.left(), box.top(), [(0, 0), (1, 0), (0, 1)]),
                        (box.right() - 22, box.top(), [(0, 0), (1, 0), (1, 1)]),
                        (box.left(), box.bottom() - 22, [(0, 0), (0, 1), (1, 1)]),
                        (box.right() - 22, box.bottom() - 22, [(1, 0), (1, 1), (0, 1)])):
                    poly = QPolygonF([QPointF(cx + dx * 22, cy + dy * 22) for dx, dy in pts])
                    p.drawPolygon(poly)
        else:
            p.setFont(QFont(FAM["serif"], 12))
            p.setPen(QPen(col(t.cap_dim), 1))
            p.drawText(inner, Qt.AlignCenter, "the finished picture goes here")

        if cap_h:
            strip = QRectF(outer.left() + pad, outer.bottom() - pad - cap_h + 2,
                           outer.width() - 2 * pad, cap_h - 4)
            if t.cap_bg:
                p.setBrush(col(t.cap_bg))
                p.setPen(QPen(col(t.metal_line), 1))
                p.drawRoundedRect(strip, 2, 2)
                p.setPen(QPen(col(t.metal_mid), 1))
                p.drawRoundedRect(strip.adjusted(-1, -1, 1, 1), 3, 3)
            f1 = QFont(FAM["caps"], 9)
            f1.setLetterSpacing(QFont.PercentageSpacing, 112)
            p.setFont(f1)
            p.setPen(QPen(col(t.cap_ink), 1))
            p.drawText(QRectF(strip.left(), strip.top() + 1, strip.width(), 15),
                       Qt.AlignCenter, self.cap1)
            p.setFont(QFont(FAM["mono"], 9))
            p.setPen(QPen(col(t.cap_dim), 1))
            p.drawText(QRectF(strip.left(), strip.top() + 16, strip.width(), 14),
                       Qt.AlignCenter, self.cap2)

        if t.mount == "pins":                           # four brass pins
            for cx, cy in ((outer.left() + 2, outer.top() + 2), (outer.right() - 2, outer.top() + 2),
                           (outer.left() + 2, outer.bottom() - 2), (outer.right() - 2, outer.bottom() - 2)):
                g = QRadialGradient(QPointF(cx - 2, cy - 2.5), 9)
                g.setColorAt(0.0, mix(t.metal_top, "#ffffff", 0.45))
                g.setColorAt(0.52, col(t.metal_mid))
                g.setColorAt(1.0, col(t.metal_line))
                p.setPen(Qt.NoPen)
                p.setBrush(QColor(0, 0, 0, 70))
                p.drawEllipse(QPointF(cx + 1, cy + 2), 7, 7)
                p.setBrush(QBrush(g))
                p.drawEllipse(QPointF(cx, cy), 7, 7)
        elif t.mount == "box":                          # brass corner fittings
            p.setPen(QPen(col(t.metal_mid), 3))
            for x0, y0, x1, y1, x2, y2 in (
                    (outer.left() + 1, outer.top() + 14, outer.left() + 1, outer.top() + 1,
                     outer.left() + 14, outer.top() + 1),
                    (outer.right() - 14, outer.top() + 1, outer.right() - 1, outer.top() + 1,
                     outer.right() - 1, outer.top() + 14),
                    (outer.left() + 1, outer.bottom() - 14, outer.left() + 1, outer.bottom() - 1,
                     outer.left() + 14, outer.bottom() - 1),
                    (outer.right() - 14, outer.bottom() - 1, outer.right() - 1, outer.bottom() - 1,
                     outer.right() - 1, outer.bottom() - 14)):
                p.drawLine(QPointF(x0, y0), QPointF(x1, y1))
                p.drawLine(QPointF(x1, y1), QPointF(x2, y2))


class Tape(Themed, QWidget):
    """The one hand-stuck label in the app.  It names the formats it reads,
    which is something the program actually knows."""

    def __init__(self, t: T.Theme, text="", parent=None):
        super().__init__(parent)
        self.t = t
        self.text = text
        self.setFixedHeight(24)
        self.on_theme()

    def on_theme(self):
        fm = QFontMetrics(QFont(FAM["hand"], 14))
        self.setFixedWidth(fm.horizontalAdvance(self.text) + 26)

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0, 3, 0, -3)
        poly = QPolygonF([
            QPointF(r.left(), r.top() + r.height() * 0.15),
            QPointF(r.left() + r.width() * 0.03, r.top()),
            QPointF(r.right() - r.width() * 0.03, r.top() + r.height() * 0.04),
            QPointF(r.right(), r.top() + r.height() * 0.2),
            QPointF(r.right() - r.width() * 0.01, r.bottom() - r.height() * 0.2),
            QPointF(r.right(), r.bottom()),
            QPointF(r.left() + r.width() * 0.03, r.bottom() - r.height() * 0.04),
            QPointF(r.left(), r.bottom() - r.height() * 0.3)])
        g = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
        g.setColorAt(0.0, QColor(240, 231, 200))
        g.setColorAt(1.0, QColor(224, 211, 170))
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 90))
        p.drawPolygon(poly.translated(0, 1.5))
        p.setBrush(QBrush(g))
        p.drawPolygon(poly)
        f = QFont(FAM["hand"], 14)
        f.setWeight(QFont.DemiBold)
        p.setFont(f)
        p.setPen(QPen(QColor(58, 47, 27), 1))
        p.drawText(self.rect(), Qt.AlignCenter, self.text)


class SkyWell(Themed, QFrame):
    """The drop target: a glazed window onto the user's own last stacked
    night, so the first thing the app shows is their sky, not an empty box."""

    def __init__(self, t: T.Theme, parent=None):
        super().__init__(parent)
        self.t = t
        self.sky = None
        self.hot = False

    def set_sky(self, pix):
        self.sky = pix
        self.update()

    def set_hot(self, hot):
        if hot != self.hot:
            self.hot = hot
            self.update()

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        t = self.t
        r = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        path = rr(r, 4)
        p.save()
        p.setClipPath(path)
        if self.sky is not None and not self.sky.isNull():
            scaled = self.sky.scaled(self.size(), Qt.KeepAspectRatioByExpanding,
                                     Qt.SmoothTransformation)
            p.drawPixmap(QPointF(r.center().x() - scaled.width() / 2,
                                 r.center().y() - scaled.height() / 2 - 10), scaled)
            wash = QLinearGradient(QPointF(0, r.top()), QPointF(0, r.bottom()))
            wash.setColorAt(0.0, QColor(6, 8, 12, 70))
            wash.setColorAt(0.6, QColor(6, 8, 12, 140))
            wash.setColorAt(1.0, QColor(6, 8, 12, 205))
            p.fillRect(r, QBrush(wash))
        else:
            p.fillPath(path, col(t.well_top))
        lamp = QRadialGradient(QPointF(r.left() + r.width() * 0.2, r.top()), r.width() * 0.8)
        lamp.setColorAt(0.0, QColor(255, 240, 210, 34))
        lamp.setColorAt(1.0, QColor(255, 240, 210, 0))
        p.fillRect(r, QBrush(lamp))
        sheen = QLinearGradient(r.topLeft(), QPointF(r.right() * 0.55, r.bottom()))
        sheen.setColorAt(0.0, QColor(255, 255, 255, 20))
        sheen.setColorAt(0.35, QColor(255, 255, 255, 5))
        sheen.setColorAt(0.5, QColor(255, 255, 255, 0))
        p.fillRect(r, QBrush(sheen))
        for i, a in enumerate((130, 80, 45, 20)):
            p.setPen(QPen(QColor(0, 0, 0, a), 1))
            p.drawLine(QPointF(r.left(), r.top() + 0.5 + i), QPointF(r.right(), r.top() + 0.5 + i))
        p.restore()
        p.setPen(QPen(col(t.accent if self.hot else t.well_line), 2 if self.hot else 1))
        p.setBrush(Qt.NoBrush)
        p.drawPath(path)


__all__ = ["apply_theme", "set_families", "Skin", "Plate", "Well", "Rail", "TitleBar",
           "Key", "Lcd", "Lamp", "Instrument", "MoonDisc", "ThemePicker", "LedgerTable",
           "FrameStrip", "PhotoMount", "Tape", "SkyWell", "col", "mix"]
