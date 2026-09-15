"""The four skins, and the tokens every screen is painted from.

A theme is a material swap, never a different app: the windows, the words and
the numbers are identical in all four, and only the surfaces, the metal, the
colour of light, the progress instrument and the way the finished print is
mounted change.

Everything a widget needs is on the ``Theme`` object:

* colours      — ``t.ground``, ``t.plate_top``, ``t.ink`` …  (plain hex)
* the stylesheet — ``t.qss()``, one Qt stylesheet for the whole window
* the instrument — ``t.instrument`` is ``"dial"`` or ``"sextant"``
* the mount    — ``t.mount`` is ``"box"``, ``"pins"``, ``"corners"`` or ``"glass"``

The painters live in :mod:`meteorprep.ui.widgets` and read these tokens, so a
new skin is a table of colours plus two or three choices — no new painting code.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
FONT_DIR = ASSETS / "fonts"

# The families as Qt sees them once the bundled files are loaded.
SERIF = "EB Garamond"
CAPS = "IM FELL English SC"
MONO = "IBM Plex Mono"
HAND = "Caveat Medium"


def load_fonts() -> dict:
    """Register the bundled OFL faces with Qt.  Returns what actually loaded,
    so the app can fall back to system serif/monospace if a file is missing
    (a source checkout without assets, or a trimmed install)."""
    got = {}
    try:
        from PySide6.QtGui import QFontDatabase
    except Exception:
        return got
    for path in sorted(FONT_DIR.glob("*.ttf")):
        fid = QFontDatabase.addApplicationFont(str(path))
        if fid >= 0:
            for fam in QFontDatabase.applicationFontFamilies(fid):
                got[fam] = path.name
    return got


def families(loaded: dict | None = None) -> dict:
    """The font stack, with honest fallbacks when the bundle is absent."""
    have = loaded if loaded is not None else {}
    return {
        "serif": SERIF if SERIF in have else "Georgia",
        "caps": CAPS if CAPS in have else (SERIF if SERIF in have else "Georgia"),
        "mono": MONO if MONO in have else "Menlo",
        "hand": HAND if HAND in have else (SERIF if SERIF in have else "Georgia"),
    }


@dataclass(frozen=True)
class Theme:
    key: str
    name: str
    blurb: str

    # --- the ground the window is made of -------------------------------
    ground: str            # flat fallback / base colour
    ground_top: str        # top of the vertical wash
    ground_bot: str
    lamp: str              # the warm light in the top-left corner (rgba ok)
    grain: float           # how much noise sits over everything, 0..1

    # --- the title strip -------------------------------------------------
    bar_top: str
    bar_bot: str
    bar_line: str
    bar_ink: str

    # --- surfaces --------------------------------------------------------
    plate_top: str
    plate_bot: str
    plate_line: str
    plate_lit: str         # the 1px light along a raised top edge
    well_top: str
    well_bot: str
    well_line: str
    well_lit: str          # the light lip at the bottom of a recess

    # --- metal (the theme's brass) ---------------------------------------
    metal_top: str
    metal_mid: str
    metal_bot: str
    metal_line: str
    metal_ink: str         # engraved text cut into metal

    # --- type ------------------------------------------------------------
    ink: str               # body text on the ground
    ink_dim: str
    ink_caps: str          # engraved small caps
    ink_data: str          # monospace figures
    accent: str            # the one colour that means "live / found"

    # --- the readout window ----------------------------------------------
    lcd_bg: str
    lcd_line: str
    lcd_ink: str
    lcd_dim: str
    lcd_glow: str          # rgba; empty string for skins that do not glow

    # --- keys -------------------------------------------------------------
    key_top: str
    key_bot: str
    key_line: str
    key_ink: str
    key_edge: str          # the hard milled bottom edge
    pri_top: str
    pri_bot: str
    pri_line: str
    pri_ink: str
    pri_edge: str
    stop_top: str
    stop_bot: str
    stop_line: str
    stop_ink: str
    stop_edge: str

    # --- ledger rows ------------------------------------------------------
    row_line: str
    row_head: str
    row_name: str
    row_fig: str
    row_date: str
    chevron: str

    # --- instruments ------------------------------------------------------
    instrument: str        # "dial" | "sextant"
    face_top: str          # dial face
    face_bot: str
    face_ink: str
    needle: str
    arc: str               # the travelled arc
    bezel_top: str
    bezel_mid: str
    bezel_bot: str
    window_ink: str        # the percent in the dial's aperture

    # --- the finished print ------------------------------------------------
    mount: str             # "box" | "pins" | "corners" | "glass"
    mat_top: str
    mat_bot: str
    mat_line: str
    cap_ink: str
    cap_dim: str
    cap_bg: str            # the strip the caption is engraved on ("" = on the mat)

    # --- the swatch shown in the picker -------------------------------------
    swatch: tuple = field(default=())

    # -----------------------------------------------------------------------
    def is_light(self) -> bool:
        """True when the ground is paper rather than night."""
        r = int(self.ground[1:3], 16) + int(self.ground[3:5], 16) + int(self.ground[5:7], 16)
        return r > 330

    def qss(self, fam: dict) -> str:
        """One stylesheet for the whole window.  Anything with a material
        (plates, wells, keys, instruments) is painted in widgets.py; this
        handles type, plain controls and the odds and ends."""
        s, c, m = fam["serif"], fam["caps"], fam["mono"]
        return f"""
QWidget {{ color: {self.ink}; font-family: "{s}"; font-size: 14px; }}
QMainWindow, QStackedWidget, QWidget#page {{ background: transparent; }}
QScrollArea, QScrollArea > QWidget > QWidget {{ background: transparent; border: none; }}
QToolTip {{ background: {self.plate_bot}; color: {self.ink}; border: 1px solid {self.plate_line};
            padding: 4px 7px; }}

QLabel#wordmark {{ font-family: "{c}"; font-size: 25px; letter-spacing: 4px;
                   color: {self.metal_ink}; }}
QLabel#screenTitle {{ font-family: "{c}"; font-size: 23px; letter-spacing: 2px; color: {self.ink}; }}
QLabel#caps {{ font-family: "{c}"; font-size: 12px; letter-spacing: 1.6px; color: {self.ink_caps}; }}
QLabel#capsSmall {{ font-family: "{c}"; font-size: 10px; letter-spacing: 1.4px; color: {self.ink_dim}; }}
QLabel#mono {{ font-family: "{m}"; font-size: 12px; color: {self.ink_data}; }}
QLabel#monoDim {{ font-family: "{m}"; font-size: 11px; color: {self.ink_dim}; }}
QLabel#body {{ font-size: 14px; color: {self.ink}; }}
QLabel#bodyDim {{ font-size: 13px; color: {self.ink_dim}; }}
QLabel#hot {{ font-family: "{m}"; font-size: 12px; color: {self.accent}; }}

QCheckBox, QRadioButton {{ spacing: 9px; padding: 2px 0; background: transparent;
                           color: {self.ink}; font-size: 14px; }}
QCheckBox::indicator, QRadioButton::indicator {{ width: 15px; height: 15px;
    border: 1px solid {self.metal_line}; background: {self.well_top}; }}
QCheckBox::indicator {{ border-radius: 3px; }}
QRadioButton::indicator {{ border-radius: 8px; }}
QCheckBox::indicator:checked, QRadioButton::indicator:checked {{
    background: {self.accent}; border: 1px solid {self.metal_mid}; }}
QRadioButton {{ font-size: 15px; }}

QLineEdit, QComboBox, QSpinBox {{ background: {self.well_top}; color: {self.ink};
    border: 1px solid {self.well_line}; border-radius: 3px; padding: 6px 9px;
    font-family: "{m}"; font-size: 12px; selection-background-color: {self.accent}; }}
QLineEdit:focus, QComboBox:focus {{ border: 1px solid {self.metal_mid}; }}
QComboBox::drop-down {{ border: 0; width: 18px; }}
QComboBox QAbstractItemView {{ background: {self.plate_bot}; color: {self.ink};
    border: 1px solid {self.plate_line}; selection-background-color: {self.metal_mid};
    selection-color: {self.metal_ink}; }}

QPushButton#link {{ background: transparent; border: none; color: {self.accent};
    font-size: 13px; font-style: italic; padding: 3px 2px; text-align: left; }}
QPushButton#link:hover {{ color: {self.ink}; }}
QPushButton#link:disabled {{ color: {self.ink_dim}; }}

QSlider::groove:horizontal {{ height: 6px; border-radius: 3px;
    background: {self.well_top}; border: 1px solid {self.well_line}; }}
QSlider::sub-page:horizontal {{ background: {self.metal_mid}; border-radius: 3px; }}
QSlider::handle:horizontal {{ width: 15px; margin: -6px 0; border-radius: 7px;
    background: {self.metal_top}; border: 1px solid {self.metal_line}; }}

QScrollBar:horizontal {{ height: 0; background: transparent; }}
QScrollBar:vertical {{ background: transparent; width: 9px; margin: 0; }}
QScrollBar::handle:vertical {{ background: {self.metal_bot}; border-radius: 4px; min-height: 26px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

/* The screens that are lists of choices rather than instruments — setup,
   adjust, the horizon editor — are plain panels and plain keys, and they
   take their materials from the same tokens. */
QLabel#h {{ font-family: "{c}"; font-size: 10px; letter-spacing: 1.8px;
            color: {self.ink_dim}; }}
QLabel#sub {{ font-size: 13px; color: {self.ink_dim}; }}
QLabel#big {{ font-family: "{c}"; font-size: 21px; letter-spacing: 1.5px; color: {self.ink}; }}
QLabel#hero {{ font-size: 16px; color: {self.ink}; }}
QLabel#pct {{ font-family: "{m}"; font-size: 40px; color: {self.accent}; }}
QLabel#estimate {{ font-size: 13px; color: {self.ink_dim}; }}
QLabel#verstamp {{ font-family: "{m}"; font-size: 10px; color: {self.ink_dim}; }}
QLabel#preview {{ background: {self.well_top}; border: 1px solid {self.well_line}; }}
QFrame#chip {{ background: {self.plate_bot}; border: 1px solid {self.plate_line};
               border-radius: 4px; }}
QFrame#card {{ background: {self.plate_bot}; border: 1px solid {self.plate_line};
               border-radius: 4px; }}
QFrame#card[picked="true"] {{ border: 1px solid {self.metal_mid};
                              background: {self.plate_top}; }}
QPushButton {{ background: {self.key_bot}; border: 1px solid {self.key_line};
               border-bottom: 3px solid {self.key_edge}; border-radius: 4px;
               color: {self.key_ink}; padding: 7px 14px; font-size: 13px; }}
QPushButton:hover {{ background: {self.key_top}; }}
QPushButton:pressed {{ border-bottom: 1px solid {self.key_edge};
                       margin-top: 2px; }}
QPushButton:disabled {{ color: {self.ink_dim}; border-bottom-width: 1px; }}
QPushButton#primary {{ background: {self.pri_bot}; border: 1px solid {self.pri_line};
                       border-bottom: 3px solid {self.pri_edge}; color: {self.pri_ink};
                       font-family: "{c}"; font-size: 13px; letter-spacing: 1px;
                       padding: 9px 14px; }}
QPushButton#primary:hover {{ background: {self.pri_top}; }}
QPushButton#primary:disabled {{ background: {self.plate_bot}; color: {self.ink_dim};
                                border-color: {self.plate_line}; }}
QPushButton#stop {{ background: {self.stop_bot}; border: 1px solid {self.stop_line};
                    border-bottom: 3px solid {self.stop_edge}; color: {self.stop_ink};
                    font-family: "{c}"; letter-spacing: 2px; padding: 9px 22px; }}
QPushButton#stop:hover {{ background: {self.stop_top}; }}
QProgressBar {{ background: {self.well_top}; border: 1px solid {self.well_line};
                border-radius: 4px; height: 10px; text-align: center;
                color: transparent; }}
QProgressBar::chunk {{ background: {self.metal_mid}; border-radius: 3px; }}
"""


def _t(**kw) -> Theme:
    return Theme(**kw)


CONSOLE = _t(
    key="console", name="Bridge console",
    blurb="Painted steel, brass fittings, amber lamps.",
    ground="#1e231f", ground_top="#252b26", ground_bot="#171a17",
    lamp="rgba(255,190,110,0.13)", grain=0.30,
    bar_top="#3a2517", bar_bot="#2a1a10", bar_line="#0a0704", bar_ink="#c9b88e",
    plate_top="#30352f", plate_bot="#252822", plate_line="#0f110f", plate_lit="rgba(255,255,255,0.10)",
    well_top="#0f100e", well_bot="#121310", well_line="#000000", well_lit="rgba(255,255,255,0.07)",
    metal_top="#96814f", metal_mid="#7a683d", metal_bot="#66562f", metal_line="#362c16",
    metal_ink="#2a2008",
    ink="#e2d7bc", ink_dim="#a89c7b", ink_caps="#cdbd95", ink_data="#d9cdab", accent="#f4b950",
    lcd_bg="#171106", lcd_line="#090704", lcd_ink="#f4b950", lcd_dim="#b8893c",
    lcd_glow="rgba(255,170,60,0.75)",
    key_top="#5d5549", key_bot="#2f2a24", key_line="#16130f", key_ink="#e9dfc4", key_edge="#14110d",
    pri_top="#a68e57", pri_bot="#6b5a31", pri_line="#2f2512", pri_ink="#2e2410", pri_edge="#2a2010",
    stop_top="#d4574a", stop_bot="#7e2219", stop_line="#38100b", stop_ink="#ffe9e2", stop_edge="#3f110c",
    row_line="rgba(0,0,0,0.80)", row_head="#8f8467", row_name="#ebe1c7", row_fig="#cdbf9e",
    row_date="#c99c45", chevron="#8a7745",
    instrument="dial", face_top="#ece6d2", face_bot="#cfc4a4", face_ink="#2a1c0e",
    needle="#3d5a94", arc="rgba(29,43,74,0.60)",
    bezel_top="#ad9a68", bezel_mid="#7b6a40", bezel_bot="#4a3d22", window_ink="#f0b24c",
    mount="box", mat_top="#2f1d13", mat_bot="#2a1a10", mat_line="#14100a",
    cap_ink="#d8c99f", cap_dim="#a3977a", cap_bg="#100d08",
    swatch=("#2b312b", "#8a7442", "#f4b950"),
)

CHARTROOM = _t(
    key="chartroom", name="Chart room",
    blurb="Aged chart paper, brass clamps, ink. The light one.",
    ground="#b29d72", ground_top="#c0ad82", ground_bot="#a08a60",
    lamp="rgba(255,236,200,0.50)", grain=0.20,
    bar_top="#553c26", bar_bot="#3f2a18", bar_line="#24170c", bar_ink="#e2cfa4",
    plate_top="#eae0c2", plate_bot="#d0c096", plate_line="#8d7746", plate_lit="rgba(255,250,230,0.80)",
    well_top="#b3a077", well_bot="#bfae85", well_line="#7d6a3f", well_lit="rgba(255,250,230,0.45)",
    metal_top="#b79f66", metal_mid="#8a7546", metal_bot="#6b5a31", metal_line="#4a3d22",
    metal_ink="#2a2008",
    ink="#3a2d18", ink_dim="#6b5c3c", ink_caps="#4a3a1c", ink_data="#3f3320", accent="#9c3a22",
    lcd_bg="#f2ead2", lcd_line="#8d7746", lcd_ink="#3a2d14", lcd_dim="#7d6a42", lcd_glow="",
    key_top="#5c4630", key_bot="#33231480", key_line="#241608", key_ink="#f3e9cd", key_edge="#241608",
    pri_top="#c0a96f", pri_bot="#7a6538", pri_line="#3a2f18", pri_ink="#2a2008", pri_edge="#33280f",
    stop_top="#c8503f", stop_bot="#7e2219", stop_line="#3d120c", stop_ink="#fff0ea", stop_edge="#43140e",
    row_line="rgba(90,60,20,0.35)", row_head="#6b5c3c", row_name="#332714", row_fig="#4c3f26",
    row_date="#8a4a20", chevron="#8a7546",
    instrument="dial", face_top="#efe8d0", face_bot="#d8cba6", face_ink="#3a2a10",
    needle="#8a3a22", arc="rgba(156,58,34,0.55)",
    bezel_top="#c0a96f", bezel_mid="#8a7546", bezel_bot="#54451f", window_ink="#8a4a20",
    mount="pins", mat_top="#efe7ce", mat_bot="#e3d8ba", mat_line="#9d8a5e",
    cap_ink="#3a2d14", cap_dim="#6b5c3c", cap_bg="",
    swatch=("#c0ad82", "#a68e57", "#9c3a22"),
)

LOGBOOK = _t(
    key="logbook", name="Logbook",
    blurb="Oxblood leather, cream paper readouts, brass clasps.",
    ground="#3a2018", ground_top="#48291f", ground_bot="#2c1710",
    lamp="rgba(255,200,140,0.12)", grain=0.34,
    bar_top="#533023", bar_bot="#3d221a", bar_line="#180c07", bar_ink="#e4d2ab",
    plate_top="#543325", plate_bot="#3f2419", plate_line="#1d0f09", plate_lit="rgba(255,215,170,0.16)",
    well_top="#efe7cf", well_bot="#e5dbbe", well_line="#6d5733", well_lit="rgba(255,255,255,0.50)",
    metal_top="#b09a63", metal_mid="#8a7546", metal_bot="#6e5b31", metal_line="#33240f",
    metal_ink="#2c2108",
    ink="#eadfc4", ink_dim="#b3a486", ink_caps="#e0cfa4", ink_data="#ddd0ad", accent="#e0c88a",
    lcd_bg="#f6efd9", lcd_line="#6d5733", lcd_ink="#3c2f16", lcd_dim="#7f6c44", lcd_glow="",
    key_top="#5e3a2a", key_bot="#341c14", key_line="#1b0d07", key_ink="#f2e6c8", key_edge="#1b0d07",
    pri_top="#bfa76c", pri_bot="#7a6538", pri_line="#33240f", pri_ink="#2c2108", pri_edge="#33240f",
    stop_top="#c0483a", stop_bot="#762018", stop_line="#33100a", stop_ink="#ffeee8", stop_edge="#3a110c",
    row_line="rgba(90,60,25,0.28)", row_head="#75623c", row_name="#31261a", row_fig="#4a3d28",
    row_date="#8a5a22", chevron="#8d7746",
    instrument="dial", face_top="#f4eed8", face_bot="#ded3b0", face_ink="#332813",
    needle="#4a3a22", arc="rgba(60,45,22,0.45)",
    bezel_top="#c8b27a", bezel_mid="#8d7746", bezel_bot="#4d3f20", window_ink="#4a3a1c",
    mount="corners", mat_top="#f3ecd6", mat_bot="#e8dec0", mat_line="#9d8a5e",
    cap_ink="#3c2f16", cap_dim="#75623c", cap_bg="",
    swatch=("#48291f", "#b09a63", "#efe6cc"),
)

LANTERN = _t(
    key="lantern", name="Lantern",
    blurb="Near-black night, one amber lamp, a sextant for a dial.",
    ground="#0a0e17", ground_top="#0e1420", ground_bot="#06080d",
    lamp="rgba(255,170,70,0.30)", grain=0.22,
    bar_top="#1a2030", bar_bot="#10141d", bar_line="#05070b", bar_ink="#cbbe98",
    plate_top="#19202c", plate_bot="#121723", plate_line="#05070b", plate_lit="rgba(255,200,140,0.12)",
    well_top="#05070b", well_bot="#070a10", well_line="#000000", well_lit="rgba(255,200,140,0.07)",
    metal_top="#8a7442", metal_mid="#6a5830", metal_bot="#4d3f22", metal_line="#241c0e",
    metal_ink="#2b2208",
    ink="#ddd2b6", ink_dim="#9b9179", ink_caps="#cdbf98", ink_data="#cfc4a5", accent="#ffb545",
    lcd_bg="#120c04", lcd_line="#050402", lcd_ink="#ffbe5e", lcd_dim="#bd8c3c",
    lcd_glow="rgba(255,170,60,0.85)",
    key_top="#2b3446", key_bot="#151a26", key_line="#05070b", key_ink="#e7dcbe", key_edge="#090c12",
    pri_top="#a68e57", pri_bot="#5f4f2b", pri_line="#241c0e", pri_ink="#2b2208", pri_edge="#241c0e",
    stop_top="#c9483a", stop_bot="#751f16", stop_line="#2e0d08", stop_ink="#ffe9e2", stop_edge="#340f0a",
    row_line="rgba(0,0,0,0.80)", row_head="#8a8068", row_name="#e8ddc0", row_fig="#c5b995",
    row_date="#c9962f", chevron="#7a6538",
    instrument="sextant", face_top="#141a26", face_bot="#0c111a", face_ink="#a89a74",
    needle="#8a7442", arc="#ffb545",
    bezel_top="#b79a5c", bezel_mid="#7a6538", bezel_bot="#453820", window_ink="#ffbe5e",
    mount="glass", mat_top="#141a26", mat_bot="#0c111a", mat_line="#05070b",
    cap_ink="#d9c99c", cap_dim="#9b9179", cap_bg="#0a0e15",
    swatch=("#121722", "#8a7442", "#ffb545"),
)

THEMES = {t.key: t for t in (CONSOLE, CHARTROOM, LOGBOOK, LANTERN)}
ORDER = ["console", "chartroom", "logbook", "lantern"]
DEFAULT = "console"


def get(key: str) -> Theme:
    return THEMES.get(key or "", THEMES[DEFAULT])


__all__ = ["Theme", "THEMES", "ORDER", "DEFAULT", "get", "load_fonts", "families",
           "SERIF", "CAPS", "MONO", "HAND"]
