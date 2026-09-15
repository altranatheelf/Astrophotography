"""Home, Run and Done — built once, painted in whichever skin is chosen.

Each builder takes the window, hangs the widgets it makes on it (so the
window's handlers can find them by name) and returns the page.  The layout is
the same in every theme; only the materials change.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (QGridLayout, QHBoxLayout, QLabel, QPushButton,
                               QSizePolicy, QVBoxLayout, QWidget)

from . import theme as T
from .widgets import (FAM, Instrument, Key, Lamp, Lcd, LedgerTable, MoonDisc,
                      PhotoMount, Plate, Rail, SkyWell, Tape, Themed,
                      ThemePicker, Well, col)

STAGES = [("READ", "reading the photos"), ("STARS", "building the starfield"),
          ("LAYERS", "cutting the layers"), ("PSD", "assembling the file"),
          ("PREVIEW", "the preview and report")]


class LogView(Themed, QWidget):
    """The program's own words, in its own console: the last few lines of the
    run log, exactly as the log file has them."""

    def __init__(self, t: T.Theme, lines=4, parent=None):
        super().__init__(parent)
        self.t = t
        self.max_lines = lines
        self.lines: list[str] = []
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 8, 12, 8)
        lay.setSpacing(2)
        self.labels = []
        for _ in range(lines):
            lab = QLabel("")
            lab.setFont(QFont(FAM["mono"], 10))
            lab.setTextInteractionFlags(Qt.TextSelectableByMouse)
            lay.addWidget(lab)
            self.labels.append(lab)
        lay.addStretch(1)
        self.on_theme()

    def add(self, line: str):
        line = " ".join(str(line).split())
        if not line or (self.lines and self.lines[-1] == line):
            return
        self.lines.append(line)
        self.lines = self.lines[-self.max_lines:]
        self.refresh()

    def clear(self):
        self.lines = []
        self.refresh()

    def refresh(self):
        pad = [""] * (self.max_lines - len(self.lines))
        shown = pad + self.lines
        for i, (lab, text) in enumerate(zip(self.labels, shown)):
            fresh = i == self.max_lines - 1 and text
            lab.setText(text + (" ▮" if fresh else ""))
            lab.setStyleSheet(
                f"color: {self.t.lcd_ink if fresh else self.t.lcd_dim}; background: transparent;")

    def on_theme(self):
        for lab in self.labels:
            lab.setFont(QFont(FAM["mono"], 10))
        self.refresh()


def _caps(text, small=False):
    lab = QLabel(text)
    lab.setObjectName("capsSmall" if small else "caps")
    return lab


def _mono(text="", dim=False):
    lab = QLabel(text)
    lab.setObjectName("monoDim" if dim else "mono")
    return lab


def _link(text, slot=None):
    b = QPushButton(text)
    b.setObjectName("link")
    b.setCursor(Qt.PointingHandCursor)
    if slot:
        b.clicked.connect(slot)
    return b


def _page():
    w = QWidget()
    w.setObjectName("page")
    w.setAttribute(Qt.WA_TranslucentBackground, True)
    return w


# ===================================================================== HOME
def build_home(win, t: T.Theme, version: str):
    page = _page()
    lay = QVBoxLayout(page)
    lay.setContentsMargins(14, 12, 14, 10)
    lay.setSpacing(10)

    # --- the nameplate, and whether anything is open ----------------------
    top = QHBoxLayout()
    top.setSpacing(10)
    name_plate = Plate(t, metal=True, rivets=True, radius=3)
    name_plate.setFixedHeight(52)
    nl = QHBoxLayout(name_plate)
    nl.setContentsMargins(24, 0, 20, 0)
    word = QLabel("MeteorPrep")
    word.setObjectName("wordmark")
    nl.addWidget(word)
    nl.addStretch(1)
    top.addWidget(name_plate, 3)

    status_plate = Plate(t)
    status_plate.setFixedHeight(52)
    sl = QHBoxLayout(status_plate)
    sl.setContentsMargins(12, 10, 14, 10)
    sl.setSpacing(10)
    win.home_lcd = Lcd(t, size=14)
    win.home_lcd.set_lines("no folder open", dim=[True])
    sl.addWidget(win.home_lcd, 1)
    win.ready_lamp = Lamp(t, "Ready")
    win.ready_lamp.setFixedWidth(52)
    win.ready_lamp.set_state("lit")
    sl.addWidget(win.ready_lamp)
    top.addWidget(status_plate, 3)
    lay.addLayout(top)

    # --- the drop target: a window onto your own last night ---------------
    drop_plate = Plate(t, rivets=True)
    dp = QVBoxLayout(drop_plate)
    dp.setContentsMargins(13, 13, 13, 13)
    win.sky = SkyWell(t)
    win.sky.setMinimumHeight(196)
    sky_lay = QVBoxLayout(win.sky)
    sky_lay.setContentsMargins(20, 18, 20, 14)
    sky_lay.setSpacing(12)
    sky_lay.addStretch(2)
    win.drop_label = QLabel("Drop a folder of night photographs")
    win.drop_label.setAlignment(Qt.AlignCenter)
    win.drop_label.setStyleSheet(
        "font-size: 19px; color: #f0e6cc; background: transparent;")
    sky_lay.addWidget(win.drop_label)
    win.choose_key = Key("Choose Folder…", t, "primary")
    win.choose_key.setFixedWidth(178)
    win.choose_key.clicked.connect(lambda: win._browse(None))
    sky_lay.addWidget(win.choose_key, alignment=Qt.AlignHCenter)
    sky_lay.addStretch(3)
    foot = QHBoxLayout()
    win.formats_tape = Tape(t, "CR2 · CR3 · NEF · ARW · DNG")
    foot.addWidget(win.formats_tape, alignment=Qt.AlignBottom)
    foot.addStretch(1)
    win.sky_note = QLabel("")
    win.sky_note.setStyleSheet(
        'font-family: "%s"; font-size: 11px; color: #a9a08a; background: transparent;'
        % FAM["mono"])
    foot.addWidget(win.sky_note, alignment=Qt.AlignBottom)
    sky_lay.addLayout(foot)
    dp.addWidget(win.sky)
    lay.addWidget(drop_plate, 1)

    # --- the nights you have already run ----------------------------------
    lay.addWidget(_caps("Recent nights"))
    win.recents = LedgerTable(t, [("Date", Qt.AlignLeft, 62),
                                  ("Folder", Qt.AlignLeft, None),
                                  ("Photos", Qt.AlignRight, 62),
                                  ("Meteors", Qt.AlignRight, 78)], row_h=34)
    win.recents.activated.connect(win._open_recent)
    lay.addWidget(win.recents)

    links = QHBoxLayout()
    links.addStretch(1)
    win.demo_button = _link("try the demo night", win._run_demo)
    win.demo_button.setToolTip(
        "Generates a small night — stars, two meteors, one plane — and runs "
        "the whole thing on it. About a minute, no photos needed.")
    win.test_button = _link("run a self-test", win._self_test)
    win.test_button.setToolTip(
        "Checks this Mac can do every step, on a built-in night. Leaves a "
        "report on your Desktop.")
    links.addWidget(win.demo_button)
    sep = QLabel("·")
    sep.setObjectName("bodyDim")
    links.addWidget(sep)
    links.addWidget(win.test_button)
    links.addStretch(1)
    lay.addLayout(links)

    # --- the moon tonight, and the theme ----------------------------------
    bottom = QHBoxLayout()
    bottom.setSpacing(10)
    moon_plate = Plate(t)
    moon_plate.setFixedHeight(104)
    ml = QHBoxLayout(moon_plate)
    ml.setContentsMargins(16, 14, 16, 14)
    ml.setSpacing(12)
    win.moon = MoonDisc(t, 70)
    ml.addWidget(win.moon)
    mr = QVBoxLayout()
    mr.setSpacing(5)
    mr.addWidget(_caps("Moon tonight"))
    win.moon_lcd = Lcd(t, size=17)
    win.moon_lcd.setFixedHeight(32)
    mr.addWidget(win.moon_lcd)
    win.moon_name = _caps("", small=True)
    mr.addWidget(win.moon_name)
    ml.addLayout(mr, 1)
    bottom.addWidget(moon_plate, 3)

    theme_plate = Plate(t)
    theme_plate.setFixedHeight(104)
    tl = QVBoxLayout(theme_plate)
    tl.setContentsMargins(0, 0, 0, 0)
    win.picker = ThemePicker(t)
    win.picker.changed.connect(win._set_theme)
    tl.addWidget(win.picker)
    bottom.addWidget(theme_plate, 3)
    lay.addLayout(bottom)
    return page


# ====================================================================== RUN
def build_run(win, t: T.Theme):
    page = _page()
    lay = QVBoxLayout(page)
    lay.setContentsMargins(14, 12, 14, 10)
    lay.setSpacing(9)

    head = Plate(t)
    head.setFixedHeight(50)
    hl = QHBoxLayout(head)
    hl.setContentsMargins(14, 7, 14, 7)
    left = QVBoxLayout()
    left.setSpacing(2)
    win.run_path = _mono("")
    left.addWidget(win.run_path)
    win.run_sub = QLabel("")
    win.run_sub.setObjectName("bodyDim")
    left.addWidget(win.run_sub)
    hl.addLayout(left, 1)
    right = QVBoxLayout()
    right.setSpacing(2)
    win.run_night = _caps("")
    win.run_night.setAlignment(Qt.AlignRight)
    right.addWidget(win.run_night)
    win.run_moon = _mono("", dim=True)
    win.run_moon.setAlignment(Qt.AlignRight)
    right.addWidget(win.run_moon)
    hl.addLayout(right)
    lay.addWidget(head)

    # --- the instrument, the stage lamps, the measurements -----------------
    inst = Plate(t)
    inst.setFixedHeight(190)
    il = QHBoxLayout(inst)
    il.setContentsMargins(18, 11, 16, 11)
    il.setSpacing(16)
    win.dial = Instrument(t, 168)
    il.addWidget(win.dial, 0, Qt.AlignTop)

    col_r = QVBoxLayout()
    col_r.setSpacing(8)
    win.run_lcd = Lcd(t, size=11, lines=2)
    win.run_lcd.setFixedHeight(46)
    win.run_lcd.set_lines("starting up…", "")
    col_r.addWidget(win.run_lcd)

    lamps = QHBoxLayout()
    lamps.setSpacing(4)
    win.lamps = []
    for key, _ in STAGES:
        lamp = Lamp(t, key)
        win.lamps.append(lamp)
        lamps.addWidget(lamp)
    col_r.addLayout(lamps)

    facts = QGridLayout()
    facts.setContentsMargins(0, 4, 0, 0)
    facts.setHorizontalSpacing(10)
    facts.setVerticalSpacing(2)
    win.fact_rows = {}
    win.fact_caps = {}
    for i, key in enumerate(("plate solve", "star lock", "star colour")):
        cap = _caps(key, small=True)
        val = _mono("", dim=True)
        facts.addWidget(cap, i, 0)
        facts.addWidget(val, i, 1)
        win.fact_rows[key] = val
        win.fact_caps[key] = cap
        cap.setVisible(False)          # a row appears when it has a figure
    facts.setColumnStretch(1, 1)
    col_r.addLayout(facts)
    col_r.addStretch(1)
    il.addLayout(col_r, 1)
    lay.addWidget(inst)

    from .widgets import FrameStrip
    win.strip = FrameStrip(t)
    lay.addWidget(win.strip)

    logrow = QHBoxLayout()
    logrow.addWidget(_caps("Log"))
    logrow.addStretch(1)
    win.verdict_key = _mono("Verdicts  ✓ kept · PLANE · SATELLITE · METEOR · set aside", dim=True)
    logrow.addWidget(win.verdict_key)
    lay.addLayout(logrow)

    console = Well(t, console=True)
    console.setMinimumHeight(96)
    cl = QVBoxLayout(console)
    cl.setContentsMargins(0, 0, 0, 0)
    win.log = LogView(t, 7)
    cl.addWidget(win.log)
    lay.addWidget(console, 1)

    bottom = QHBoxLayout()
    bottom.setSpacing(10)
    times = Plate(t)
    times.setFixedHeight(92)
    tl = QHBoxLayout(times)
    tl.setContentsMargins(16, 12, 16, 12)
    tl.setSpacing(14)
    for label, attr in (("Elapsed", "elapsed_lcd"), ("Remaining", "remaining_lcd")):
        box = QVBoxLayout()
        box.setSpacing(4)
        box.addWidget(_caps(label, small=True))
        lcd = Lcd(t, size=25)
        lcd.setFixedHeight(42)
        lcd.set_lines("—")
        setattr(win, attr, lcd)
        box.addWidget(lcd)
        tl.addLayout(box, 1)
    bottom.addWidget(times, 2)

    guard = Plate(t, metal=True, radius=6)
    guard.setFixedHeight(92)
    gl = QVBoxLayout(guard)
    gl.setContentsMargins(10, 6, 10, 10)
    gl.setSpacing(4)
    stop_cap = QLabel("Stop the run")
    stop_cap.setAlignment(Qt.AlignCenter)
    stop_cap.setStyleSheet(
        'font-family: "%s"; font-size: 10px; letter-spacing: 2px; color: %s;'
        ' background: transparent;' % (FAM["caps"], t.metal_ink))
    win.stop_cap = stop_cap
    gl.addWidget(stop_cap)
    well = Well(t, radius=5)
    wl = QVBoxLayout(well)
    wl.setContentsMargins(8, 6, 8, 6)
    win.stop_button = Key("STOP", t, "stop")
    win.stop_button.setToolTip(
        "Finishes the photo it is on and stops. Everything worked out so far "
        "is kept — running the same folder again picks up from there.")
    win.stop_button.clicked.connect(win._stop)
    wl.addWidget(win.stop_button)
    gl.addWidget(well)
    bottom.addWidget(guard, 1)
    lay.addLayout(bottom)
    return page


# ===================================================================== DONE
def build_done(win, t: T.Theme):
    page = _page()
    lay = QVBoxLayout(page)
    lay.setContentsMargins(14, 12, 14, 10)
    lay.setSpacing(9)

    head = Plate(t)
    head.setFixedHeight(58)
    hl = QHBoxLayout(head)
    hl.setContentsMargins(16, 6, 12, 8)
    hl.setSpacing(12)
    left = QVBoxLayout()
    left.setSpacing(1)
    win.done_head = QLabel("")
    win.done_head.setObjectName("screenTitle")
    left.addWidget(win.done_head)
    win.done_sub = QLabel("")
    win.done_sub.setObjectName("bodyDim")
    left.addWidget(win.done_sub)
    hl.addLayout(left, 1)
    win.done_lcd = Lcd(t, size=12, lines=2)
    win.done_lcd.setFixedWidth(318)
    win.done_lcd.setFixedHeight(40)
    hl.addWidget(win.done_lcd, 0, Qt.AlignVCenter)
    lay.addWidget(head)

    win.mount = PhotoMount(t)
    lay.addWidget(win.mount, 5)

    win.written_cap = _caps("Written to")
    lay.addWidget(win.written_cap)
    win.files = LedgerTable(t, [("file", Qt.AlignLeft, 172),
                                ("what it is", Qt.AlignLeft, None),
                                ("size", Qt.AlignRight, 74)], row_h=21, head=False)
    win.files.activated.connect(win._open_file_row)
    lay.addWidget(win.files, 0)

    keys = QHBoxLayout()
    keys.setSpacing(8)
    win.adjust_btn = Key("Adjust…", t, "primary")
    win.adjust_btn.setToolTip(
        "Finish the shot right here — brightness, warmth, colour, foreground "
        "light, light-pollution removal, meteor strength — and save a "
        "full-quality JPEG. The layered file stays untouched.")
    win.adjust_btn.clicked.connect(win._open_adjust)
    win.adjust_btn.setMinimumWidth(150)
    win.open_report_btn = Key("Open report", t)
    win.open_report_btn.clicked.connect(
        lambda: win._open_path(getattr(win, "_report_path", None)))
    win.open_psd_btn = Key("Open PSD", t)
    win.open_psd_btn.clicked.connect(
        lambda: win._open_path(getattr(win, "_psd_path", None)))
    win.open_folder_btn = Key("Show folder", t)
    win.open_folder_btn.clicked.connect(
        lambda: win._open_path(getattr(win, "_result_dir", None)))
    win.video_btn = Key("▶  Film", t)
    win.video_btn.clicked.connect(
        lambda: win._open_path(getattr(win, "_video_path", None)))
    for b in (win.adjust_btn, win.open_report_btn, win.open_psd_btn, win.open_folder_btn):
        keys.addWidget(b)
    keys.addStretch(1)
    keys.addWidget(win.video_btn)
    lay.addLayout(keys)

    links = QHBoxLayout()
    links.addStretch(1)
    win.again_btn = _link("run another folder", lambda: win._goto("home"))
    win.horizon_btn = _link("fix horizon", win._open_horizon)
    win.horizon_btn.setToolTip(
        "Paint over anything it got wrong — trees it took for sky, or sky it "
        "took for trees — and it rebuilds with your corrections, snapped to "
        "the real edges.")
    win.tweak_btn = _link("same folder, new settings", lambda: win._goto("setup"))
    for i, b in enumerate((win.again_btn, win.horizon_btn, win.tweak_btn)):
        if i:
            d = QLabel("·")
            d.setObjectName("bodyDim")
            links.addWidget(d)
        links.addWidget(b)
    links.addStretch(1)
    lay.addLayout(links)
    return page


__all__ = ["build_home", "build_run", "build_done", "LogView", "STAGES"]
