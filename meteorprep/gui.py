"""The METEORPREP window: four screens, one job each.

home  — drop a folder (or watch the demo).
setup — say what you want from that folder, press the big button.
run   — one big number, one line about what it is doing, Stop.
done  — the finished picture, and the three things you can open.

The GUI only builds a Config and calls ``meteorprep.pipeline.run`` on a
worker thread — all logic lives in the CLI-core library.  Requires the
``gui`` extra (PySide6).

Every screen answers exactly one question, because the window this
replaced tried to answer all of them at once: the folder, the choices,
the progress bar, the results and the footer all shared one column, and
a person mid-run was looking at checkboxes they could no longer touch.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

ELEV_CHOICES = {
    "halfway up the sky": 45.0,
    "low, near the horizon": 25.0,
    "high, near overhead": 65.0,
}


def main() -> int:
    try:
        from PySide6.QtCore import Qt, QThread, Signal
        from PySide6.QtWidgets import (QApplication, QButtonGroup, QCheckBox,
                                       QComboBox, QFileDialog, QFrame,
                                       QHBoxLayout, QLabel, QLineEdit,
                                       QMainWindow, QProgressBar, QPushButton,
                                       QRadioButton, QScrollArea, QSlider,
                                       QStackedWidget, QVBoxLayout, QWidget)
    except ImportError:
        print("PySide6 is not installed: pip install 'meteorprep[gui]'",
              file=sys.stderr)
        return 1

    from meteorprep import modes as M
    from meteorprep.config import Config
    from meteorprep.pipeline import run as run_pipeline

    class Cancelled(Exception):
        """Raised out of the progress callback to unwind a run."""

    class Worker(QThread):
        progressed = Signal(int, str)
        finished_ok = Signal(dict)
        failed = Signal(str)
        stopped = Signal()

        def __init__(self, cfg):
            super().__init__()
            self.cfg = cfg
            self._cancel = False

        def cancel(self):
            """Ask the run to stop at its next progress report.  The
            pipeline reports often enough that this lands within a photo
            or two, and it unwinds through run()'s own cleanup, so the
            worker pools and shared memory go away properly."""
            self._cancel = True

        def _progress(self, frac, msg):
            if self._cancel:
                raise Cancelled()
            self.progressed.emit(int(frac * 100), msg)

        def run(self):
            try:
                result = run_pipeline(self.cfg, progress=self._progress)
                self.finished_ok.emit(result)
            except Cancelled:
                self.stopped.emit()
            except Exception:
                if self._cancel:      # a stop can surface as anything
                    self.stopped.emit()
                else:
                    self.failed.emit(traceback.format_exc())

    class SelfTestWorker(QThread):
        progressed = Signal(str)
        report = Signal(str)
        done = Signal(bool, str)

        def run(self):
            # Launched from the .app there is no console, so "see the
            # lines above" pointed at nothing.  The full report goes to a
            # file the window can open.
            try:
                from meteorprep.selftest import format_report, run_self_test
                result = run_self_test(progress=self.progressed.emit)
                text = format_report(result)
                print(text)
                self.report.emit(text)
                self.done.emit(result["ok"], result["verdict"])
            except Exception:
                tb = traceback.format_exc()
                print(tb, file=sys.stderr)
                self.report.emit("The setup check itself crashed:\n\n" + tb)
                self.done.emit(False, "The setup check could not finish.")

    class DemoWorker(QThread):
        """Builds the demo night (synthetic sky, two meteors, one plane)
        in the app's own folder — a few seconds, once — so a person can
        watch the whole thing work before pointing it at real photos."""
        ready = Signal(str)
        failed = Signal(str)

        def run(self):
            try:
                import json
                from pathlib import Path as _P

                if sys.platform == "darwin":
                    base = (_P.home() / "Library" / "Application Support"
                            / "MeteorPrep")
                else:
                    base = _P.home() / ".meteorprep"
                src = base / "demo-night"
                marker = src / "meteorprep_config.json"
                if not marker.exists():
                    src.mkdir(parents=True, exist_ok=True)
                    from meteorprep.testdata.synth import (
                        make_synthetic_sequence)
                    # the same night the setup check has always run:
                    # verified for years as "2 meteors found, 1 plane
                    # flagged", so the demo's story is a known one
                    gt = make_synthetic_sequence(
                        src, n_frames=10, shape=(600, 900),
                        focal_px=2443.0 * 900 / 5472, n_stars=250,
                        n_meteors=2, n_aircraft=1, n_satellites=0, seed=3)
                    marker.write_text(json.dumps({
                        "catalog_file": str(src / "catalog_radec.npy"),
                        "pixel_pitch_um": 16000.0 / gt["focal_px"],
                        "solve_every_k": 4,
                        "emit_gradient_layer": False,
                    }))
                self.ready.emit(str(src))
            except Exception:
                self.failed.emit(traceback.format_exc())

    class FinishWorker(QThread):
        """Owns one finishing bundle on a worker thread: loads it small
        for live slider renders, exports full size on demand.  Renders
        queued while one is in flight collapse to the newest — dragging
        a slider asks for the last position, not every position."""
        loaded = Signal(dict)          # {"fg": bool, "met": bool, ...}
        rendered = Signal(object)      # uint8 HxWx3 RGB
        rendered_base = Signal(object)  # the untouched (default) render
        saved = Signal(str)
        failed = Signal(str)

        def __init__(self, bundle_path):
            super().__init__()
            import queue
            self.bundle_path = str(bundle_path)
            self.jobs = queue.Queue()

        def submit(self, *job):
            self.jobs.put(job)

        def run(self):
            import numpy as np

            from meteorprep.finish import (export_finish,
                                           load_finish_bundle,
                                           render_finish)
            try:
                small = load_finish_bundle(self.bundle_path,
                                           max_width=1100)
                self.loaded.emit({k: (k in small) for k in
                                  ("fg", "met", "flg", "grad",
                                   "skymask")})
                base = render_finish(small)   # for hold-to-compare
                self.rendered_base.emit(
                    (base * 255.0 + 0.5).astype(np.uint8))
            except Exception:
                self.failed.emit(traceback.format_exc())
                return
            while True:
                batch = [self.jobs.get()]
                while not self.jobs.empty():
                    batch.append(self.jobs.get())
                renders = [b for b in batch if b[0] == "render"]
                todo = ([b for b in batch if b[0] != "render"]
                        + renders[-1:])
                for b in todo:
                    if b[0] == "quit":
                        return
                    try:
                        if b[0] == "render":
                            disp = render_finish(small, b[1])
                            self.rendered.emit(
                                (disp * 255.0 + 0.5).astype(np.uint8))
                        elif b[0] == "export":
                            out = export_finish(
                                self.bundle_path, b[1],
                                Path(self.bundle_path).parent,
                                want_tiff=b[2])
                            self.saved.emit(str(out["jpg"]))
                    except Exception:
                        self.failed.emit(traceback.format_exc())

    class CountWorker(QThread):
        """Counting photos means walking the folder, which is instant on
        an SSD and several seconds on a memory card or a network drive —
        so it does not happen on the UI thread."""
        counted = Signal(str, int)

        def __init__(self, folder):
            super().__init__()
            self.folder = folder

        def run(self):
            try:
                from pathlib import Path

                from meteorprep.config import Config as _C
                from meteorprep.ingest.exif import scan_input_dir
                n = len(scan_input_dir(Path(self.folder), _C().raw_extensions))
            except Exception:
                n = -1
            self.counted.emit(self.folder, n)

    INK = "#e7ecf3"
    DIM = "#8d99aa"
    ACCENT = "#3b7dfd"
    PANEL = "#161b22"
    LINE = "#242c37"
    STYLE = f"""
    QMainWindow, QScrollArea, QStackedWidget, QWidget#page {{
        background: #0f1318; }}
    QWidget {{ color: {INK}; font-size: 13px; }}
    QLabel#wordmark {{ font-size: 17px; font-weight: 800;
                       letter-spacing: 2px; }}
    QLabel#verstamp {{ color: #566173; font-size: 11px; }}
    QLabel#hero {{ font-size: 16px; color: #9fb0c5; }}
    QLabel#big {{ font-size: 26px; font-weight: 800; }}
    QLabel#pct {{ font-size: 44px; font-weight: 800; color: {INK}; }}
    QLabel#h {{ font-size: 11px; font-weight: 700; color: {DIM};
                letter-spacing: 2px; }}
    QLabel#sub {{ color: {DIM}; font-size: 12px; }}
    QLabel#estimate {{ color: #9fb0c5; font-size: 13px; }}
    QLabel#preview {{ background: {PANEL}; border: 1px solid {LINE};
                      border-radius: 12px; }}
    QFrame#chip {{ background: {PANEL}; border: 1px solid {LINE};
                   border-radius: 9px; }}
    QFrame#card {{ background: {PANEL}; border: 1px solid {LINE};
                   border-radius: 10px; }}
    QFrame#card[picked="true"] {{ border: 1px solid {ACCENT};
                                  background: #182236; }}
    QCheckBox, QRadioButton {{ spacing: 9px; padding: 1px 0;
                               background: transparent; }}
    QRadioButton {{ font-size: 14px; font-weight: 600; }}
    QLineEdit, QComboBox {{ background: {PANEL}; border: 1px solid #2b3542;
                            border-radius: 7px; padding: 6px 9px;
                            selection-background-color: {ACCENT}; }}
    QLineEdit:focus, QComboBox:focus {{ border-color: {ACCENT}; }}
    QPushButton {{ background: #202834; border: 1px solid #313d4c;
                   border-radius: 9px; padding: 9px 16px; }}
    QPushButton:hover {{ background: #293441; }}
    QPushButton:disabled {{ color: #5a6675; background: #161c23;
                            border-color: #222a34; }}
    QPushButton#primary {{ background: {ACCENT}; border-color: {ACCENT};
                           color: white; font-size: 16px; font-weight: 700;
                           padding: 13px 18px; }}
    QPushButton#primary:hover {{ background: #4d8bff; }}
    QPushButton#primary:disabled {{ background: #202b3c; color: #66738a;
                                    border-color: #202b3c; }}
    QPushButton#stop {{ background: transparent; border: 1px solid #45301f;
                        color: #d9a06a; padding: 10px 22px; }}
    QPushButton#stop:hover {{ background: #251c14; }}
    QPushButton#link {{ background: transparent; border: none; color: {DIM};
                        text-align: left; padding: 4px 0; }}
    QPushButton#link:hover {{ color: {INK}; }}
    QProgressBar {{ background: {PANEL}; border: none; border-radius: 5px;
                    height: 10px; text-align: center; color: transparent; }}
    QProgressBar::chunk {{ background: {ACCENT}; border-radius: 5px; }}
    """

    def _heading(text):
        lab = QLabel(text.upper())
        lab.setObjectName("h")
        return lab

    def _sub(text):
        lab = QLabel(text)
        lab.setObjectName("sub")
        lab.setWordWrap(True)
        return lab

    class Disclosure(QWidget):
        """A labelled toggle with a body that starts hidden.  Everything
        a photographer does not need on a normal night lives in one of
        these, so the window opens short."""

        def __init__(self, label, parent=None):
            super().__init__(parent)
            lay = QVBoxLayout(self)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(4)
            self._label = label
            self.head = QPushButton("▸  " + label)
            self.head.setObjectName("link")
            self.head.setCheckable(True)
            self.head.clicked.connect(self._toggle)
            lay.addWidget(self.head)
            self.body = QWidget()
            self.body_layout = QVBoxLayout(self.body)
            self.body_layout.setContentsMargins(16, 2, 0, 6)
            self.body_layout.setSpacing(8)
            self.body.setVisible(False)
            lay.addWidget(self.body)

        def _toggle(self, on):
            self.body.setVisible(on)
            self.head.setText(("▾  " if on else "▸  ") + self._label)

        def add(self, widget):
            self.body_layout.addWidget(widget)

        def add_layout(self, layout):
            self.body_layout.addLayout(layout)

    class PaintCanvas(QLabel):
        """The Fix-the-horizon painting surface: the finished preview
        with the current mask tinted over it, and two brushes — "this is
        ground" and "this is sky" — that the pipeline obeys on the next
        run.  Strokes live in an overlay image; Undo pops whole strokes.
        """

        def __init__(self):
            super().__init__()
            self.setObjectName("preview")
            self.setAlignment(Qt.AlignCenter)
            self.setMinimumHeight(300)
            self._base = None          # QPixmap of preview.jpg (fitted)
            self._tint = None          # QPixmap of the current mask tint
            self._strokes = None       # QImage ARGB32, the paint
            self._undo = []
            self.brush_px = 30
            self.mode_ground = True
            self._painting = False

        def set_scene(self, base_pm, tint_pm, existing=None):
            """``existing``: the previously saved strokes (QImage), so a
            second session ADDS to the corrections instead of silently
            replacing them — Clear is the way to start over."""
            from PySide6.QtGui import QImage, QPainter
            self._base = base_pm
            self._tint = tint_pm
            self._strokes = QImage(base_pm.size(),
                                   QImage.Format_ARGB32_Premultiplied)
            self._strokes.fill(0)
            self._loaded = False
            if existing is not None and not existing.isNull():
                p = QPainter(self._strokes)
                p.drawImage(self._strokes.rect(), existing)
                p.end()
                self._loaded = True
            self._undo = []
            self._daubs = 0
            self._recompose()

        def has_strokes(self):
            return bool(getattr(self, "_daubs", 0)
                        or getattr(self, "_loaded", False))

        def _recompose(self):
            from PySide6.QtGui import QPainter, QPixmap
            if self._base is None:
                return
            out = QPixmap(self._base.size())
            p = QPainter(out)
            p.drawPixmap(0, 0, self._base)
            if self._tint is not None:
                p.setOpacity(0.35)
                p.drawPixmap(0, 0, self._tint)
                p.setOpacity(1.0)
            p.drawImage(0, 0, self._strokes)
            p.end()
            self.setPixmap(out)

        def _img_pos(self, event_pos):
            """Widget coords -> stroke-image coords (the pixmap is
            centred in the label)."""
            if self._base is None:
                return None
            ox = (self.width() - self._base.width()) // 2
            oy = (self.height() - self._base.height()) // 2
            x = event_pos.x() - ox
            y = event_pos.y() - oy
            if 0 <= x < self._base.width() and 0 <= y < self._base.height():
                return x, y
            return None

        def _daub(self, pos):
            from PySide6.QtCore import QPoint
            from PySide6.QtGui import QColor, QPainter
            pt = self._img_pos(pos)
            if pt is None:
                return
            p = QPainter(self._strokes)
            p.setRenderHint(QPainter.Antialiasing, True)
            color = (QColor(235, 70, 70, 170) if self.mode_ground
                     else QColor(70, 140, 255, 170))
            p.setPen(Qt.NoPen)
            p.setBrush(color)
            r = max(self.brush_px // 2, 2)
            p.drawEllipse(QPoint(pt[0], pt[1]), r, r)
            p.end()
            self._recompose()

        def mousePressEvent(self, e):
            if self._strokes is None:
                return
            # a click outside the picture is not a stroke: it must not
            # push an undo state or arm the rebuild button
            if self._img_pos(e.position().toPoint()) is None:
                return
            if len(self._undo) >= 12:
                self._undo.pop(0)
            self._undo.append((self._strokes.copy(), self._daubs))
            self._painting = True
            self._daubs += 1
            self._daub(e.position().toPoint())

        def mouseMoveEvent(self, e):
            if self._painting:
                self._daub(e.position().toPoint())

        def mouseReleaseEvent(self, _e):
            self._painting = False

        def undo(self):
            if self._undo:
                self._strokes, self._daubs = self._undo.pop()
                self._recompose()

        def clear(self):
            if self._strokes is not None:
                self._undo = []
                self._daubs = 0
                self._loaded = False
                self._strokes.fill(0)
                self._recompose()

        def strokes_image(self):
            return self._strokes

    class ModeCard(QFrame):
        """One of the three things you can ask for: a title, a line about
        what you get, and — once a folder is chosen — how long it takes."""

        def __init__(self, mode, group, on_pick):
            super().__init__()
            self.setObjectName("card")
            self.mode = mode
            self.setToolTip(mode.detail)
            lay = QVBoxLayout(self)
            lay.setContentsMargins(13, 10, 13, 11)
            lay.setSpacing(2)
            self.radio = QRadioButton(mode.title)
            self.radio.setToolTip(mode.detail)
            group.addButton(self.radio)
            self.radio.toggled.connect(lambda on: on and on_pick())
            lay.addWidget(self.radio)
            self.sub = _sub(mode.blurb)
            self.sub.setContentsMargins(25, 0, 0, 0)
            self.sub.setToolTip(mode.detail)
            lay.addWidget(self.sub)
            self.est = QLabel("")
            self.est.setObjectName("estimate")
            self.est.setContentsMargins(25, 0, 0, 0)
            self.est.setVisible(False)
            lay.addWidget(self.est)

        def mousePressEvent(self, _e):
            self.radio.setChecked(True)

        def set_estimate(self, text):
            self.est.setText(text or "")
            self.est.setVisible(bool(text))

        def set_picked(self, picked):
            self.setProperty("picked", "true" if picked else "false")
            self.style().unpolish(self)
            self.style().polish(self)

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            from PySide6.QtCore import QSettings

            from meteorprep import __version__
            self.setWindowTitle(f"MeteorPrep {__version__}")
            try:
                from PySide6.QtGui import QIcon
                _icon = Path(__file__).parent / "assets" / "icon.png"
                if _icon.exists():
                    self.setWindowIcon(QIcon(str(_icon)))
            except Exception:
                pass
            self.setAcceptDrops(True)
            self.folder = None
            self.worker = None
            self._counters = []
            self.n_photos = 0
            self._settings = QSettings("meteorprep", "gui")

            self.pages = QStackedWidget()
            self._page = {
                "home": self._build_home(__version__),
                "setup": self._build_setup(),
                "run": self._build_run(),
                "done": self._build_done(),
                "adjust": self._build_adjust(),
                "horizon": self._build_horizon(),
            }
            for w in self._page.values():
                self.pages.addWidget(w)
            self.setCentralWidget(self.pages)
            self.resize(600, 700)
            self.setMinimumSize(540, 620)

            self._restore_settings()
            # apply the hunt state even when nothing was saved: the box
            # starts unchecked (a composite night is the ordinary night),
            # and the button, the estimates and the contact-sheet row all
            # follow it
            self._meteors_toggled(self.cb_meteors.isChecked())
            last = str(self._settings.value("last_report", ""))
            if last and Path(last).exists():
                self._report_path = last
                self._result_dir = str(Path(last).parent)
                self.last_link.setText("Open the last run's report")
                self.last_link.setVisible(True)

            import time as _time
            from PySide6.QtCore import QTimer
            self._time = _time
            self._last_msg = ""
            self._msg_at = _time.time()
            self._hb = QTimer(self)
            self._hb.setInterval(1000)
            self._hb.timeout.connect(self._heartbeat)
            # slider debounce: render the position the hand settles on,
            # not every pixel it dragged through
            self._adj_timer = QTimer(self)
            self._adj_timer.setSingleShot(True)
            self._adj_timer.setInterval(120)
            self._adj_timer.timeout.connect(self._adj_render_now)
            self._adj = None
            self._adj_path = None

        # ---------------- the four screens -------------------------------

        def _goto(self, name):
            self.pages.setCurrentWidget(self._page[name])

        def _build_home(self, version):
            page = QWidget()
            page.setObjectName("page")
            lay = QVBoxLayout(page)
            lay.setContentsMargins(28, 22, 28, 18)
            lay.setSpacing(10)

            head = QHBoxLayout()
            try:
                from PySide6.QtGui import QPixmap
                _icon = Path(__file__).parent / "assets" / "icon.png"
                if _icon.exists():
                    mark = QLabel()
                    mark.setPixmap(QPixmap(str(_icon)).scaled(
                        30, 30, Qt.KeepAspectRatio,
                        Qt.SmoothTransformation))
                    head.addWidget(mark)
            except Exception:
                pass
            word = QLabel("MeteorPrep")
            word.setObjectName("wordmark")
            head.addWidget(word)
            ver = QLabel(version)
            ver.setObjectName("verstamp")
            head.addWidget(ver, alignment=Qt.AlignBottom)
            head.addStretch(1)
            lay.addLayout(head)
            lay.addStretch(1)

            self.drop_label = QLabel(
                "☄\n\nDrop your night's photo folder here\n"
                "or click to choose one")
            self.drop_label.setAlignment(Qt.AlignCenter)
            self.drop_label.setMinimumHeight(240)
            self.drop_label.setWordWrap(True)
            self._drop_css = (
                "border: 2px dashed #313d4c; border-radius: 16px;"
                " font-size: 16px; color: #8d99aa; background: #12161d;")
            self._drop_css_hot = (
                "border: 2px dashed #3b7dfd; border-radius: 16px;"
                " font-size: 16px; color: #cfe0ff; background: #172236;")
            self.drop_label.setStyleSheet(self._drop_css)
            self.drop_label.mousePressEvent = self._browse
            lay.addWidget(self.drop_label)

            tagline = _sub(
                "One night on a fixed tripod → a clean stacked sky over "
                "your sharp foreground, as a layered Photoshop file and "
                "a finished picture.")
            tagline.setAlignment(Qt.AlignCenter)
            lay.addWidget(tagline)

            self.home_status = QLabel("")
            self.home_status.setObjectName("sub")
            self.home_status.setWordWrap(True)
            self.home_status.setAlignment(Qt.AlignCenter)
            lay.addWidget(self.home_status)

            self.last_link = QPushButton("")
            self.last_link.setObjectName("link")
            self.last_link.setVisible(False)
            self.last_link.clicked.connect(
                lambda: self._open_path(getattr(self, "_report_path", None)))
            lay.addWidget(self.last_link, alignment=Qt.AlignCenter)
            lay.addStretch(1)

            sep = QFrame()
            sep.setFrameShape(QFrame.HLine)
            sep.setStyleSheet(f"color: {LINE};")
            lay.addWidget(sep)
            foot = QHBoxLayout()
            self.demo_button = QPushButton(
                "▶  Watch it work on a demo night")
            self.demo_button.setObjectName("link")
            self.demo_button.setToolTip(
                "Generates a small fake night — stars, two meteors, one "
                "plane — and runs the whole thing on it: the search, the "
                "stack, the layered Photoshop file and the report. About "
                "a minute, no photos needed.")
            self.demo_button.clicked.connect(self._run_demo)
            self.test_button = QPushButton("Check this Mac can run it")
            self.test_button.setObjectName("link")
            self.test_button.setToolTip(
                "A two-minute self-test on a built-in fake night; leaves "
                "a report file on your Desktop.")
            self.test_button.clicked.connect(self._self_test)
            foot.addWidget(self.demo_button)
            foot.addStretch(1)
            foot.addWidget(self.test_button)
            lay.addLayout(foot)
            return page

        def _chip_row(self, with_change):
            """The little folder token that carries the answer to 'what
            is this screen about?' onto every screen after home."""
            chip = QFrame()
            chip.setObjectName("chip")
            row = QHBoxLayout(chip)
            row.setContentsMargins(12, 8, 12, 8)
            row.setSpacing(8)
            icon = QLabel("📁")
            row.addWidget(icon)
            label = QLabel("")
            label.setObjectName("sub")
            label.setWordWrap(True)
            row.addWidget(label, 1)
            if with_change:
                change = QPushButton("Choose another")
                change.setObjectName("link")
                change.clicked.connect(self._browse_or_home)
                row.addWidget(change)
            return chip, label

        def _build_setup(self):
            page = QWidget()
            page.setObjectName("page")
            lay = QVBoxLayout(page)
            lay.setContentsMargins(28, 20, 28, 18)
            lay.setSpacing(9)

            chip, self.chip_label = self._chip_row(with_change=True)
            lay.addWidget(chip)

            # The composite is not a choice — it is what the program IS:
            # every run aligns the sky, stacks it clean, freezes the
            # foreground and hands back a layered file plus a shareable
            # picture.  The choices are the two things you can ask for
            # ON TOP of that.
            lay.addSpacing(4)
            lay.addWidget(_heading("What do you want?"))
            lay.addWidget(_sub(
                "Every run builds the composite: your sharp foreground "
                "under a clean, stacked, star-true sky. These add to it."))
            self.cb_meteors = QCheckBox(
                "Hunt for meteors — each one on its own Photoshop layer")
            self.cb_meteors.setToolTip(
                "Searches every photo for meteor streaks, tells them "
                "apart from planes and satellites, and cuts each meteor "
                "onto its own toggleable layer at its true sky position. "
                "Adds roughly a third to the run. Leave it off for a "
                "nightscape or landscape night — the composite is "
                "identical either way, and you can check this later and "
                "run the same folder again: the sky work is reused.")
            lay.addWidget(self.cb_meteors)
            self.cb_sheet = QCheckBox(
                "Contact sheet — one thumbnail of everything it found")
            self.cb_sheet.setChecked(True)
            self.cb_sheet.setToolTip(
                "A single image with every candidate on it, labelled "
                "meteor or plane or satellite. The quickest way to check "
                "the hunt's work.")
            sheet_row = QHBoxLayout()
            sheet_row.addSpacing(26)          # indented under the hunt
            sheet_row.addWidget(self.cb_sheet)
            lay.addLayout(sheet_row)
            self.cb_meteors.toggled.connect(self._meteors_toggled)
            self.cb_trail = QCheckBox(
                "Star-trail photo — circles around the pole")
            self.cb_trail.setToolTip(
                "Every frame's brightest pixel kept, so the stars draw "
                "arcs around the pole while the ground stays frozen. "
                "Built from the photos you already have, at no extra "
                "reading cost. Gaps between exposures are bridged "
                "automatically using the measured sky rotation, so the "
                "arcs come out solid, not dashed.")
            lay.addWidget(self.cb_trail)
            self.trail_combo = QComboBox()
            self.trail_combo.addItems(["classic — every arc full strength",
                                       "comet fade — the tail thins away"])
            self.trail_combo.setToolTip(
                "Classic is the timeless full-strength circles. Comet "
                "fade keeps the newest light bright and fades the older "
                "arcs behind it, like a tail.")
            self.trail_combo.setEnabled(False)
            self.cb_trail.toggled.connect(self.trail_combo.setEnabled)
            trail_row = QHBoxLayout()
            trail_row.addSpacing(26)
            trail_row.addWidget(self.trail_combo)
            trail_row.addStretch(1)
            lay.addLayout(trail_row)
            self.cb_video = QCheckBox(
                "Timelapse film — the whole night as a short video")
            self.cb_video.setToolTip(
                "Plays your night back as an .mp4: every photo in time "
                "order, one steady exposure (no flicker), ready to post. "
                "Adds a minute or two of reading at the end of the run.")
            lay.addWidget(self.cb_video)

            lay.addSpacing(6)
            lay.addWidget(_heading("How far to take it?"))
            self.mode_group = QButtonGroup(self)
            self.cards = {}
            for mode in M.MODES:
                card = ModeCard(mode, self.mode_group, self._mode_changed)
                self.cards[mode.key] = card
                lay.addWidget(card)

            self.cb_png = QCheckBox(
                "Photoshop rescue script (only if the .psd won't open)")
            self.cb_png.setToolTip(
                "Writes every layer as a PNG plus a script that rebuilds "
                "the document inside Photoshop. It is a fallback for a "
                "Photoshop that refuses the .psd, and it adds about half "
                "a gigabyte. Normally leave this off — if the .psd fails "
                "to write, this is produced automatically anyway.")

            self.night = Disclosure("About your night (optional)")
            self.night.add(_sub(
                "Everything here is optional. Skip it and the run still "
                "works — these only help the star lock start closer, and "
                "unlock the height/distance estimates."))
            point_row = QHBoxLayout()
            point_row.addWidget(QLabel("The camera faced"))
            self.compass = QComboBox()
            self.compass.addItems(["not sure", "N", "NE", "E", "SE",
                                   "S", "SW", "W", "NW"])
            point_row.addWidget(self.compass)
            point_row.addWidget(QLabel("and was aimed"))
            self.elevation = QComboBox()
            self.elevation.addItems(list(ELEV_CHOICES))
            point_row.addWidget(self.elevation)
            point_row.addStretch(1)
            self.night.add_layout(point_row)
            site_row = QHBoxLayout()
            site_row.addWidget(QLabel("You were at"))
            self.site = QLineEdit()
            self.site.setPlaceholderText("44.3275, -72.1725")
            self.site.setToolTip(
                "Find yours in Apple Maps: press and hold your spot and "
                "the numbers appear on the place card. Rough is fine.\n\n"
                "Fill this in and each meteor also gets how high it "
                "burned, how far away it was and how long it lasted. "
                "Leave it empty and everything else still works — those "
                "three numbers are left out rather than guessed. If your "
                "camera's GPS was on they come from the photos and you "
                "can ignore this.")
            site_row.addWidget(self.site)
            self.night.add_layout(site_row)
            self.night.add(_sub(
                "latitude, longitude — adds how high each meteor burned, "
                "how far away it was and how long it lasted"))
            lay.addWidget(self.night)

            self.advanced = Disclosure("Advanced")
            self.cb_force = QCheckBox(
                "Start over — ignore everything the last run worked out")
            self.cb_force.setToolTip(
                "Normally a second run on the same folder reuses the "
                "scan, the star lock, the alignment, the horizon and the "
                "meteor search — most of the time a run takes. Tick this "
                "to measure every one of them again from the photos: "
                "worth doing if you have changed what is in the folder, "
                "or if a run looks wrong and you want a clean one.")
            self.advanced.add(self.cb_force)
            self.advanced.add(self.cb_png)
            lay.addWidget(self.advanced)

            lay.addStretch(1)
            self.status = QLabel("")
            self.status.setWordWrap(True)
            self.status.setObjectName("sub")
            lay.addWidget(self.status)
            self.problem_btn = QPushButton("Save a problem report")
            self.problem_btn.setToolTip(
                "Bundles the run's diary and this Mac's details into one "
                "zip on your Desktop — the file to send when asking for "
                "help.")
            self.problem_btn.clicked.connect(self._save_problem_report)
            self.problem_btn.setVisible(False)
            prow = QHBoxLayout()
            prow.addWidget(self.problem_btn)
            prow.addStretch(1)
            lay.addLayout(prow)

            self.estimate_lbl = QLabel("")
            self.estimate_lbl.setObjectName("estimate")
            self.estimate_lbl.setAlignment(Qt.AlignCenter)
            lay.addWidget(self.estimate_lbl)
            self.button = QPushButton("Build my composite")
            self.button.setObjectName("primary")
            self.button.setEnabled(False)
            self.button.clicked.connect(self._start)
            lay.addWidget(self.button)

            scroll = QScrollArea()
            scroll.setWidget(page)
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(QFrame.NoFrame)
            return scroll

        def _build_run(self):
            page = QWidget()
            page.setObjectName("page")
            lay = QVBoxLayout(page)
            lay.setContentsMargins(40, 20, 40, 24)
            lay.setSpacing(10)

            chip, self.run_chip_label = self._chip_row(with_change=False)
            lay.addWidget(chip)
            lay.addStretch(2)

            self.run_pct = QLabel("0%")
            self.run_pct.setObjectName("pct")
            self.run_pct.setAlignment(Qt.AlignCenter)
            lay.addWidget(self.run_pct)
            self.run_stage = QLabel("starting up…")
            self.run_stage.setObjectName("sub")
            self.run_stage.setWordWrap(True)
            self.run_stage.setAlignment(Qt.AlignCenter)
            lay.addWidget(self.run_stage)
            lay.addSpacing(6)
            self.bar = QProgressBar()
            lay.addWidget(self.bar)
            self.run_eta = QLabel("")
            self.run_eta.setObjectName("estimate")
            self.run_eta.setAlignment(Qt.AlignCenter)
            lay.addWidget(self.run_eta)
            lay.addStretch(3)

            self.stop_button = QPushButton("Stop")
            self.stop_button.setObjectName("stop")
            self.stop_button.setToolTip(
                "Finishes the photo it is on and stops. Everything "
                "worked out so far is kept — running the same folder "
                "again picks up from there.")
            self.stop_button.clicked.connect(self._stop)
            lay.addWidget(self.stop_button, alignment=Qt.AlignCenter)
            return page

        def _build_done(self):
            page = QWidget()
            page.setObjectName("page")
            lay = QVBoxLayout(page)
            lay.setContentsMargins(28, 22, 28, 18)
            lay.setSpacing(10)

            self.done_head = QLabel("")
            self.done_head.setObjectName("big")
            self.done_head.setWordWrap(True)
            self.done_head.setAlignment(Qt.AlignCenter)
            lay.addWidget(self.done_head)
            self.done_sub = QLabel("")
            self.done_sub.setObjectName("sub")
            self.done_sub.setWordWrap(True)
            self.done_sub.setAlignment(Qt.AlignCenter)
            lay.addWidget(self.done_sub)

            self.preview_lbl = QLabel("")
            self.preview_lbl.setObjectName("preview")
            self.preview_lbl.setAlignment(Qt.AlignCenter)
            self.preview_lbl.setMinimumHeight(260)
            lay.addWidget(self.preview_lbl, 1)

            btns = QHBoxLayout()
            btns.addStretch(1)
            self.adjust_btn = QPushButton("Adjust the picture")
            self.adjust_btn.setObjectName("primary")
            self.adjust_btn.setToolTip(
                "Finish the shot right here — brightness, warmth, "
                "colour, foreground light, light-pollution removal, "
                "meteor strength — and save a full-quality JPEG. The "
                "layered Photoshop file stays untouched.")
            self.adjust_btn.clicked.connect(self._open_adjust)
            self.adjust_btn.setVisible(False)
            self.open_report_btn = QPushButton("Open the report")
            self.open_report_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_report_path", None)))
            self.open_psd_btn = QPushButton("Open the Photoshop file")
            self.open_psd_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_psd_path", None)))
            self.video_btn = QPushButton("Play the film")
            self.video_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_video_path", None)))
            self.video_btn.setVisible(False)
            self.open_folder_btn = QPushButton("Show the files")
            self.open_folder_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_result_dir", None)))
            btns.addWidget(self.adjust_btn)
            btns.addWidget(self.open_report_btn)
            btns.addWidget(self.open_psd_btn)
            btns.addWidget(self.video_btn)
            btns.addWidget(self.open_folder_btn)
            btns.addStretch(1)
            lay.addLayout(btns)

            links = QHBoxLayout()
            self.again_btn = QPushButton("Run another folder")
            self.again_btn.setObjectName("link")
            self.again_btn.clicked.connect(lambda: self._goto("home"))
            self.horizon_btn = QPushButton("Fix the horizon")
            self.horizon_btn.setObjectName("link")
            self.horizon_btn.setToolTip(
                "Paint over anything it got wrong — mark trees it "
                "mistook for sky or sky it mistook for trees — and it "
                "rebuilds with your corrections, snapped to the real "
                "edges. The rebuild reuses everything else, so it is "
                "quick.")
            self.horizon_btn.clicked.connect(self._open_horizon)
            self.horizon_btn.setVisible(False)
            self.tweak_btn = QPushButton("Same folder, different choices")
            self.tweak_btn.setObjectName("link")
            self.tweak_btn.clicked.connect(lambda: self._goto("setup"))
            links.addWidget(self.again_btn)
            links.addStretch(1)
            links.addWidget(self.horizon_btn)
            links.addStretch(1)
            links.addWidget(self.tweak_btn)
            lay.addLayout(links)
            return page

        def _build_horizon(self):
            page = QWidget()
            page.setObjectName("page")
            lay = QVBoxLayout(page)
            lay.setContentsMargins(28, 16, 28, 16)
            lay.setSpacing(8)

            top = QHBoxLayout()
            back = QPushButton("◂  Back to the results")
            back.setObjectName("link")
            back.clicked.connect(lambda: self._goto("done"))
            top.addWidget(back)
            top.addStretch(1)
            lay.addLayout(top)
            lay.addWidget(_sub(
                "The red shade is what MeteorPrep took for ground. Paint "
                "over anything it got wrong — your strokes win, and the "
                "edge still snaps to the real treeline."))

            self.paint = PaintCanvas()
            lay.addWidget(self.paint, 1)

            row = QHBoxLayout()
            self.paint_ground_btn = QPushButton("🖌 This is ground")
            self.paint_sky_btn = QPushButton("🖌 This is sky")
            for b in (self.paint_ground_btn, self.paint_sky_btn):
                b.setCheckable(True)
            self.paint_ground_btn.setChecked(True)

            def _mode(ground):
                self.paint.mode_ground = ground
                self.paint_ground_btn.setChecked(ground)
                self.paint_sky_btn.setChecked(not ground)
            self.paint_ground_btn.clicked.connect(lambda: _mode(True))
            self.paint_sky_btn.clicked.connect(lambda: _mode(False))
            row.addWidget(self.paint_ground_btn)
            row.addWidget(self.paint_sky_btn)
            row.addSpacing(14)
            row.addWidget(_sub("brush"))
            self.brush_slider = QSlider(Qt.Horizontal)
            self.brush_slider.setRange(8, 90)
            self.brush_slider.setValue(30)
            self.brush_slider.setMaximumWidth(140)
            self.brush_slider.valueChanged.connect(
                lambda v: setattr(self.paint, "brush_px", v))
            row.addWidget(self.brush_slider)
            row.addStretch(1)
            undo = QPushButton("Undo")
            undo.clicked.connect(self.paint.undo)
            row.addWidget(undo)
            clear = QPushButton("Clear")
            clear.clicked.connect(self.paint.clear)
            row.addWidget(clear)
            lay.addLayout(row)

            brow = QHBoxLayout()
            self.horizon_status = QLabel("")
            self.horizon_status.setObjectName("sub")
            self.horizon_status.setWordWrap(True)
            brow.addWidget(self.horizon_status, 1)
            self.horizon_apply = QPushButton("Rebuild with my fixes")
            self.horizon_apply.setObjectName("primary")
            self.horizon_apply.clicked.connect(self._horizon_apply)
            brow.addWidget(self.horizon_apply)
            lay.addLayout(brow)
            return page

        # ---------------- the horizon editor -----------------------------

        def _open_horizon(self):
            rd = getattr(self, "_result_dir", None)
            if not rd:
                return
            rd = Path(rd)
            pv = rd / "preview.jpg"
            mask = rd / "skymask.png"
            if not pv.exists() or not mask.exists():
                return
            try:
                import numpy as _np
                from PIL import Image as _Im
                from PySide6.QtGui import QImage, QPixmap
                base_pm = QPixmap(str(pv))
                if base_pm.isNull():
                    return
                # fit the window as it actually is: a fixed 700px canvas
                # was wider than the minimum window, and the clipped
                # edges could be neither seen nor painted
                fit_w = max(min(self.pages.width() - 70, 900), 460)
                fit_h = max(min(self.pages.height() - 250, 540), 280)
                base_pm = base_pm.scaled(fit_w, fit_h, Qt.KeepAspectRatio,
                                         Qt.SmoothTransformation)
                pw, ph = base_pm.width(), base_pm.height()
                m = _np.asarray(_Im.open(mask).convert("L")
                                .resize((pw, ph)), _np.uint8)
                rgba = _np.zeros((ph, pw, 4), _np.uint8)
                rgba[:, :, 0] = 235
                rgba[:, :, 1] = 60
                rgba[:, :, 2] = 60
                rgba[:, :, 3] = (255 - m.astype(_np.int32)) * 200 // 255
                tint = QPixmap.fromImage(QImage(
                    rgba.tobytes(), pw, ph, 4 * pw,
                    QImage.Format_RGBA8888).copy())
                # corrections accumulate: strokes saved by an earlier
                # session come back onto the canvas, editable, so a
                # second session ADDS fixes instead of replacing them
                existing = None
                prev = Path(rd) / "horizon_edits.png"
                if prev.exists():
                    old = QImage(str(prev))
                    if not old.isNull():
                        existing = old.scaled(pw, ph,
                                              Qt.IgnoreAspectRatio,
                                              Qt.SmoothTransformation)
                self.paint.set_scene(base_pm, tint, existing=existing)
                self._horizon_mask_size = _Im.open(mask).size
                self.horizon_status.setText(
                    "Your earlier strokes are loaded — add to them, or "
                    "press Clear to start over." if existing is not None
                    else "")
                self._goto("horizon")
            except Exception as exc:
                print(f"horizon editor could not open: {exc}",
                      file=sys.stderr)

        def _horizon_apply(self):
            if self.worker is not None and self.worker.isRunning():
                return
            rd = getattr(self, "_result_dir", None)
            strokes = self.paint.strokes_image()
            if not rd or strokes is None:
                return
            dest = Path(rd) / "horizon_edits.png"
            if not self.paint.has_strokes():
                if dest.exists():
                    # Clear + rebuild = "remove my corrections"
                    dest.unlink(missing_ok=True)
                    self._start()
                    return
                self.horizon_status.setText(
                    "Nothing painted yet — brush over the wrong spots "
                    "first.")
                return
            if self.paint._daubs == 0 and self.paint._loaded:
                # nothing new painted: rebuild against the saved strokes
                # untouched, rather than round-tripping them through the
                # display resolution again
                self._start()
                return
            try:
                mw, mh = getattr(self, "_horizon_mask_size",
                                 (strokes.width(), strokes.height()))
                out = strokes.scaled(mw, mh, Qt.IgnoreAspectRatio,
                                     Qt.SmoothTransformation)
                if not out.save(str(dest)):
                    raise OSError("could not write horizon_edits.png")
            except Exception as exc:
                self.horizon_status.setText(
                    f"Could not save the strokes: {exc}")
                return
            self._start()

        def _build_adjust(self):
            page = QWidget()
            page.setObjectName("page")
            lay = QVBoxLayout(page)
            lay.setContentsMargins(28, 16, 28, 16)
            lay.setSpacing(7)

            top = QHBoxLayout()
            back = QPushButton("◂  Back to the results")
            back.setObjectName("link")
            back.clicked.connect(lambda: self._goto("done"))
            top.addWidget(back)
            top.addStretch(1)
            lay.addLayout(top)

            self.adj_preview = QLabel("loading the picture…")
            self.adj_preview.setObjectName("preview")
            self.adj_preview.setAlignment(Qt.AlignCenter)
            self.adj_preview.setMinimumHeight(230)
            lay.addWidget(self.adj_preview, 1)

            def srow(label, lo, hi, val):
                row = QHBoxLayout()
                lab = QLabel(label)
                lab.setObjectName("sub")
                lab.setMinimumWidth(150)
                sl = QSlider(Qt.Horizontal)
                sl.setRange(lo, hi)
                sl.setValue(val)
                sl.valueChanged.connect(self._adj_changed)
                row.addWidget(lab)
                row.addWidget(sl, 1)
                holder = QWidget()
                holder.setLayout(row)
                lay.addWidget(holder)
                return sl, holder

            self.adj_bright, _ = srow("Sky brightness", 40, 250, 100)
            self.adj_warm, _ = srow("Warmth", -100, 100, 0)
            self.adj_sat, _ = srow("Colour strength", 0, 200, 100)
            self.adj_fg, self._adj_fg_row = srow(
                "Foreground light", 25, 300, 100)
            self.adj_pol, self._adj_pol_row = srow(
                "Remove light pollution", 0, 100, 0)
            self.adj_boost, self._adj_boost_row = srow(
                "Meteor strength", 0, 250, 100)
            self.adj_flagged = QCheckBox(
                "Show the satellite and plane trails too")
            self.adj_flagged.toggled.connect(self._adj_changed)
            self.adj_flagged.setVisible(False)
            lay.addWidget(self.adj_flagged)

            self.adj_status = QLabel("")
            self.adj_status.setObjectName("sub")
            self.adj_status.setWordWrap(True)
            lay.addWidget(self.adj_status)

            brow = QHBoxLayout()
            reset = QPushButton("Back to how the run left it")
            reset.setObjectName("link")
            reset.clicked.connect(self._adj_reset)
            brow.addWidget(reset)
            self.adj_compare = QPushButton("Hold to compare")
            self.adj_compare.setToolTip(
                "Press and hold to see the picture as the run left it; "
                "let go to see your adjustments again.")
            self.adj_compare.pressed.connect(self._adj_compare_on)
            self.adj_compare.released.connect(self._adj_compare_off)
            brow.addWidget(self.adj_compare)
            brow.addStretch(1)
            self.adj_tiff = QCheckBox("Also save a 16-bit TIFF")
            self.adj_tiff.setToolTip(
                "A print-grade 16-bit file of the same picture, next to "
                "the JPEG. Adds ~50–70 MB.")
            brow.addWidget(self.adj_tiff)
            self.adj_save = QPushButton("Save the picture")
            self.adj_save.setObjectName("primary")
            self.adj_save.clicked.connect(self._adj_export)
            brow.addWidget(self.adj_save)
            lay.addLayout(brow)
            return page

        # ---------------- the adjust screen ------------------------------

        def _adj_params(self):
            return {
                "brightness": self.adj_bright.value() / 100.0,
                "warmth": self.adj_warm.value() / 100.0,
                "saturation": self.adj_sat.value() / 100.0,
                "foreground": self.adj_fg.value() / 100.0,
                "depollute": self.adj_pol.value() / 100.0,
                "boost": self.adj_boost.value() / 100.0,
                "show_flagged": self.adj_flagged.isChecked(),
            }

        def _open_adjust(self):
            path = getattr(self, "_bundle_path", None)
            if not path or not Path(path).exists():
                return
            self._goto("adjust")
            if self._adj is not None and self._adj_path == path \
                    and self._adj.isRunning():
                self._adj_changed()
                return
            if self._adj is not None and self._adj.isRunning():
                self._adj.submit("quit")
            self._adj_path = path
            self.adj_preview.setText("loading the picture…")
            self.adj_status.setText("")
            self.adj_save.setEnabled(True)
            self.adj_save.setText("Save the picture")
            self._adj_base_arr = None
            self._adj_last_arr = None
            self._adj = FinishWorker(path)
            self._adj.loaded.connect(self._adj_loaded)
            self._adj.rendered.connect(self._adj_show)
            self._adj.rendered_base.connect(self._adj_keep_base)
            self._adj.saved.connect(self._adj_saved)
            self._adj.failed.connect(self._adj_failed)
            self._adj.start()

        def _adj_loaded(self, have):
            if self.sender() is not None and self.sender() is not self._adj:
                return          # a retired worker's late signal
            # only offer the sliders this night actually has knobs for
            self._adj_fg_row.setVisible(bool(have.get("fg")
                                             and have.get("skymask")))
            self._adj_pol_row.setVisible(bool(have.get("grad")))
            self._adj_boost_row.setVisible(bool(have.get("met")
                                                or have.get("flg")))
            self.adj_flagged.setVisible(bool(have.get("flg")))
            self._adj_render_now()

        def _adj_changed(self, *_a):
            if self._adj is not None:
                self._adj_timer.start()

        def _adj_render_now(self):
            if self._adj is not None and self._adj.isRunning():
                self._adj.submit("render", self._adj_params())

        def _show_arr(self, arr):
            from PySide6.QtGui import QImage, QPixmap
            if arr is None:
                return
            h, w = arr.shape[:2]
            img = QImage(arr.tobytes(), w, h, 3 * w,
                         QImage.Format_RGB888)
            self.adj_preview.setPixmap(QPixmap.fromImage(img).scaled(
                max(self.adj_preview.width(), 540),
                max(self.adj_preview.height(), 320),
                Qt.KeepAspectRatio, Qt.SmoothTransformation))

        def _adj_show(self, arr):
            if self.sender() is not None and self.sender() is not self._adj:
                return          # a retired worker's late render
            self._adj_last_arr = arr
            if not getattr(self, "_adj_holding", False):
                self._show_arr(arr)

        def _adj_keep_base(self, arr):
            if self.sender() is not None and self.sender() is not self._adj:
                return
            self._adj_base_arr = arr

        def _adj_compare_on(self):
            self._adj_holding = True
            self._show_arr(getattr(self, "_adj_base_arr", None))

        def _adj_compare_off(self):
            self._adj_holding = False
            self._show_arr(getattr(self, "_adj_last_arr", None))

        def _adj_reset(self):
            for sl, v in ((self.adj_bright, 100), (self.adj_warm, 0),
                          (self.adj_sat, 100), (self.adj_fg, 100),
                          (self.adj_pol, 0), (self.adj_boost, 100)):
                sl.blockSignals(True)
                sl.setValue(v)
                sl.blockSignals(False)
            self.adj_flagged.blockSignals(True)
            self.adj_flagged.setChecked(False)
            self.adj_flagged.blockSignals(False)
            self._adj_changed()

        def _adj_export(self):
            if self._adj is None or not self._adj.isRunning():
                return
            self.adj_save.setEnabled(False)
            self.adj_save.setText("Saving…")
            self.adj_status.setText(
                "Rendering the full-size picture…")
            self._adj.submit("export", self._adj_params(),
                             self.adj_tiff.isChecked())

        def _adj_saved(self, jpg):
            if self.sender() is not None and self.sender() is not self._adj:
                return          # a retired worker's late signal
            self.adj_save.setEnabled(True)
            self.adj_save.setText("Save the picture")
            extra = (" (and the 16-bit TIFF)"
                     if self.adj_tiff.isChecked() else "")
            self.adj_status.setText(
                f"Saved {Path(jpg).name}{extra} next to your other "
                "files.")
            self._open_path(jpg)

        def _adj_failed(self, tb):
            if self.sender() is not None and self.sender() is not self._adj:
                return          # a retired worker's late signal
            self.adj_save.setEnabled(True)
            self.adj_save.setText("Save the picture")
            self.adj_status.setText(
                "That did not work: "
                + tb.strip().splitlines()[-1][:200])
            print(tb, file=sys.stderr)

        # ---------------- mode + folder ---------------------------------

        def _mode_key(self):
            for key, card in self.cards.items():
                if card.radio.isChecked():
                    return key
            return M.DEFAULT

        def _rate_key(self, mode_key):
            """A composite run and a meteor hunt take different times, so
            each remembers its own pace."""
            return (f"rate_{mode_key}_m" if self.cb_meteors.isChecked()
                    else f"rate_{mode_key}_c")

        def _mode_changed(self):
            key = self._mode_key()
            hunting = self.cb_meteors.isChecked()
            sel = ""
            for k, card in self.cards.items():
                card.set_picked(k == key)
                measured = (self._settings.value(self._rate_key(k))
                            # rates learned before the checkbox existed
                            # were all meteor hunts
                            or (self._settings.value(f"rate_{k}")
                                if hunting else None))
                try:
                    measured = float(measured) if measured else None
                except (TypeError, ValueError):
                    measured = None
                est = M.estimate(k, self.n_photos, measured,
                                 factor=1.0 if hunting else 0.7)
                card.set_estimate(est)
                if k == key:
                    sel = est
            if sel and self.n_photos > 0:
                self.estimate_lbl.setText(
                    f"{sel} for {self.n_photos} photos")
            else:
                self.estimate_lbl.setText("")

        def _refresh_go_label(self):
            self.button.setText("Find my meteors"
                                if self.cb_meteors.isChecked()
                                else "Build my composite")

        def _meteors_toggled(self, on):
            self.cb_sheet.setEnabled(on)
            self._refresh_go_label()
            self._mode_changed()      # the estimates change with the hunt

        def _set_folder(self, folder):
            import os
            if not folder or not os.path.isdir(folder):
                return
            # Normalise once, here.  A path from a drag-and-drop can
            # arrive with a trailing separator, and "/photos/" +
            # "_meteorprep" is /photos/_meteorprep — the results written
            # INSIDE the photo folder, where the next run would scan them.
            folder = os.path.abspath(folder)
            self.folder = folder
            name = os.path.basename(folder) or folder
            self.chip_label.setText(f"{name} — counting the photos…")
            self.n_photos = 0
            self._mode_changed()
            # stays off until the count comes back: pressing go on a
            # folder with no photos in it only produces an error
            self.button.setEnabled(False)
            self._goto("setup")
            # a folder on a memory card can take seconds to walk, and
            # dropping a second folder meanwhile must not drop the only
            # reference to a running QThread — that is how a live thread
            # gets garbage-collected out from under itself
            counter = CountWorker(folder)
            self._counters.append(counter)
            counter.counted.connect(self._on_counted)
            counter.finished.connect(
                lambda c=counter: self._counters.remove(c)
                if c in self._counters else None)
            counter.start()

        def _on_counted(self, folder, n):
            import os
            if folder != self.folder:
                return                      # a newer folder won the race
            self.n_photos = max(n, 0)
            name = os.path.basename(folder) or folder
            if n < 0:
                self.chip_label.setText(
                    f"{name} — could not read that folder")
            elif n == 0:
                self.chip_label.setText(
                    f"{name} — no photos in there. This wants the folder "
                    "holding your RAW files (.CR2, .CR3, .NEF, .ARW, "
                    ".DNG…) — subfolders are fine.")
            else:
                self.chip_label.setText(
                    f"{name} — {n} photo{'s' if n != 1 else ''} · results "
                    f"go to {self._out_name()}")
            if self.worker is None or not self.worker.isRunning():
                self.button.setEnabled(n > 0)
            self._mode_changed()

        def _out_dir(self):
            """The one place the results folder is decided."""
            import os
            return os.path.abspath(str(self.folder)) + "_meteorprep"

        def _out_name(self):
            import os
            return os.path.basename(self._out_dir())

        # ---------------- settings --------------------------------------

        _CBS = (("meteors", "cb_meteors"), ("trail", "cb_trail"),
                ("sheet", "cb_sheet"), ("png", "cb_png"),
                ("force", "cb_force"), ("video", "cb_video"))

        def _restore_settings(self):
            s = self._settings
            key = str(s.value("mode", M.DEFAULT))
            self.cards.get(key, self.cards[M.DEFAULT]).radio.setChecked(True)
            for name, attr in self._CBS:
                v = s.value(name)
                if v is not None:
                    getattr(self, attr).setChecked(v in (True, "true", "1"))
            self.site.setText(str(s.value("site", "")))
            if str(s.value("trail_style", "")) == "comet":
                self.trail_combo.setCurrentIndex(1)
            for combo, name in ((self.compass, "compass"),
                                (self.elevation, "elevation")):
                v = str(s.value(name, ""))
                if v and combo.findText(v) >= 0:
                    combo.setCurrentText(v)
            if str(s.value("site", "")) or str(s.value("compass", "")):
                self.night.head.setChecked(True)
                self.night._toggle(True)
            folder = s.value("folder", "")
            if folder:
                self._set_folder(str(folder))
            else:
                self._goto("home")

        def _save_settings(self):
            s = self._settings
            s.setValue("folder", self.folder or "")
            s.setValue("mode", self._mode_key())
            for name, attr in self._CBS:
                s.setValue(name, getattr(self, attr).isChecked())
            s.setValue("site", self.site.text())
            s.setValue("trail_style",
                       "comet" if self.trail_combo.currentIndex() == 1
                       else "classic")
            s.setValue("compass", self.compass.currentText())
            s.setValue("elevation", self.elevation.currentText())

        # ---------------- housekeeping ----------------------------------

        def _open_path(self, target):
            if not target:
                return
            try:
                import subprocess
                if sys.platform == "darwin":
                    subprocess.Popen(["open", str(target)])
                elif sys.platform.startswith("linux"):
                    subprocess.Popen(["xdg-open", str(target)])
                else:
                    import os
                    os.startfile(str(target))  # type: ignore[attr-defined]
            except Exception:
                pass

        def dragEnterEvent(self, e):
            if self.worker is not None and self.worker.isRunning():
                return                     # mid-run, the folder is fixed
            if e.mimeData().hasUrls():
                self.drop_label.setStyleSheet(self._drop_css_hot)
                e.acceptProposedAction()

        def dragLeaveEvent(self, e):
            self.drop_label.setStyleSheet(self._drop_css)

        def dropEvent(self, e):
            import os
            self.drop_label.setStyleSheet(self._drop_css)
            e.acceptProposedAction()
            for url in e.mimeData().urls():
                path = url.toLocalFile()
                if os.path.isdir(path):
                    self._set_folder(path)
                elif os.path.isfile(path):
                    # dropping one of the photos is an easy mistake and
                    # the answer is obvious: use the folder it is in
                    self._set_folder(os.path.dirname(path))
                else:
                    self.home_status.setText(
                        "That is not a folder I can read — drop the "
                        "folder your photos are in.")
                break

        def _browse(self, _event):
            folder = QFileDialog.getExistingDirectory(
                self, "Choose the folder of photos")
            if folder:
                self._set_folder(folder)

        def _browse_or_home(self):
            """From the setup chip: pick a different folder, or fall back
            to the home screen if the dialog is dismissed."""
            folder = QFileDialog.getExistingDirectory(
                self, "Choose the folder of photos")
            if folder:
                self._set_folder(folder)
            else:
                self._goto("home")

        # ---------------- the run ---------------------------------------

        def _stop(self):
            if self.worker is None or not self.worker.isRunning():
                return
            self.stop_button.setEnabled(False)
            self.stop_button.setText("Stopping…")
            self.run_stage.setText(
                "Stopping — finishing the photo it is on. Everything "
                "worked out so far is kept.")
            self.worker.cancel()

        def _start(self):
            import os
            # Replacing self.worker while the old one runs drops the only
            # Python reference to a live QThread, and Qt aborts the whole
            # app when that gets collected.  Every path that can re-arm
            # this button is guarded, but the guard belongs here too.
            if self.worker is not None and self.worker.isRunning():
                return
            if getattr(self, "tester", None) is not None \
                    and self.tester.isRunning():
                self.status.setText(
                    "Finishing the setup check first — try again in a "
                    "moment.")
                return
            elev = ELEV_CHOICES.get(self.elevation.currentText(), 45.0)
            compass = self.compass.currentText()
            try:
                lat, lon = (float(v) for v in self.site.text().split(","))
                site_given = True
            except ValueError:
                # blank or unparseable: harmless for the solver seed, but
                # it must not be mistaken for the real observing site
                lat, lon = 44.3275, -72.1725
                site_given = False
            mode = self._mode_key()
            cfg = Config(
                input_dir=self.folder,
                output_dir=self._out_dir(),
                emit_pngjsx=self.cb_png.isChecked(),
                emit_startrail=self.cb_trail.isChecked(),
                trail_style=("comet"
                             if self.trail_combo.currentIndex() == 1
                             else "classic"),
                emit_timelapse=self.cb_video.isChecked(),
                find_meteors=self.cb_meteors.isChecked(),
                emit_contact_sheet=(self.cb_sheet.isChecked()
                                    and self.cb_meteors.isChecked()),
                force=self.cb_force.isChecked(),
                jobs=max((os.cpu_count() or 2) - 1, 1),
                cleanup_cache=True,
                site_lat=lat, site_lon=lon, site_explicit=site_given,
                pointed_compass="" if compass == "not sure" else compass,
                pointed_elevation_deg=elev,
                **M.config_kwargs(mode),
            )
            self._run_mode = mode
            self._run_meteors = self.cb_meteors.isChecked()
            self._run_is_demo = False
            self._save_settings()
            self._launch(cfg)

        def _launch(self, cfg):
            """The one place a run actually starts: the run screen, the
            worker wiring, the heartbeat, and — on a Mac — a sleep hold,
            because a laptop that dozes off forty minutes into a
            two-hour stack throws the night away."""
            import os
            self._last_out = cfg.output_dir
            self._set_running(True)
            self._hold_awake(True)
            if getattr(self, "_run_is_demo", False):
                self.run_chip_label.setText("demo night")
            else:
                self.run_chip_label.setText(
                    os.path.basename(str(self.folder or "")) or
                    str(self.folder or ""))
            self.run_pct.setText("0%")
            self.run_stage.setText("starting up…")
            self.run_eta.setText("")
            self.bar.setValue(0)
            self.stop_button.setEnabled(True)
            self.stop_button.setText("Stop")
            self._goto("run")
            self.worker = Worker(cfg)
            self.worker.progressed.connect(self._on_progress)
            self.worker.finished_ok.connect(self._on_done)
            self.worker.failed.connect(self._on_fail)
            self.worker.stopped.connect(self._on_stopped)
            self._last_msg = "starting up"
            self._msg_at = self._time.time()
            self._run_t0 = self._time.time()
            self._hb.start()
            self.worker.start()

        def _hold_awake(self, hold):
            """caffeinate -i while a run is going (macOS): the display
            may sleep, the machine may not."""
            proc = getattr(self, "_caffeinate", None)
            if hold and sys.platform == "darwin" and proc is None:
                try:
                    import subprocess
                    self._caffeinate = subprocess.Popen(["caffeinate", "-i"])
                except Exception:
                    self._caffeinate = None
            elif not hold and proc is not None:
                try:
                    proc.terminate()
                except Exception:
                    pass
                self._caffeinate = None

        def _set_running(self, running):
            self.button.setEnabled(not running and bool(self.folder)
                                   and self.n_photos > 0)
            self.test_button.setEnabled(not running)
            self.demo_button.setEnabled(not running)
            if running:
                self.problem_btn.setVisible(False)
            self._refresh_go_label()

        def _heartbeat(self):
            if self.worker is None or not self.worker.isRunning():
                return
            quiet = self._time.time() - self._msg_at
            if quiet > 4 and self._last_msg:
                m, s = divmod(int(quiet), 60)
                self.run_stage.setText(
                    f"{self._last_msg}  —  still working "
                    f"({m}m {s:02d}s in this step)")

        def _run_demo(self):
            import os
            if self.worker is not None and self.worker.isRunning():
                return
            if getattr(self, "tester", None) is not None \
                    and self.tester.isRunning():
                return
            self.demo_button.setEnabled(False)
            self.button.setEnabled(False)
            self.home_status.setText(
                "Building a demo night — a dozen fake photos with two "
                "meteors hidden in them…")
            self._demo_maker = DemoWorker()

            def _go(folder):
                self.demo_button.setEnabled(True)
                self.home_status.setText("")
                cfg = Config(
                    input_dir=folder,
                    output_dir=folder + "_meteorprep",
                    find_meteors=True, emit_contact_sheet=True,
                    jobs=max((os.cpu_count() or 2) - 1, 1),
                    cleanup_cache=False,      # a second demo is instant
                    **M.config_kwargs("full"),
                )
                self._run_mode = "full"
                self._run_meteors = True
                self._run_is_demo = True
                self._launch(cfg)

            def _bad(tb):
                self.demo_button.setEnabled(True)
                self._set_running(False)
                self.home_status.setText(
                    "The demo could not be built:\n"
                    + tb.strip().splitlines()[-1])
                print(tb, file=sys.stderr)

            self._demo_maker.ready.connect(_go)
            self._demo_maker.failed.connect(_bad)
            self._demo_maker.start()

        def _self_test(self):
            if self.worker is not None and self.worker.isRunning():
                return
            self.test_button.setEnabled(False)
            self.button.setEnabled(False)
            self.home_status.setText("checking…")
            self.tester = SelfTestWorker()
            self.tester.report.connect(self._keep_selftest_report)
            self.tester.progressed.connect(self.home_status.setText)

            def finish(ok, verdict):
                self._show_selftest(ok, verdict)
                running = (self.worker is not None
                           and self.worker.isRunning())
                self.test_button.setEnabled(not running)
                self.button.setEnabled(not running and bool(self.folder)
                                       and self.n_photos > 0)
            self.tester.done.connect(finish)
            self.tester.start()

        def _on_progress(self, pct, msg):
            self.bar.setValue(pct)
            self.run_pct.setText(f"{pct}%")
            self.run_stage.setText(msg)
            t0 = getattr(self, "_run_t0", None)
            if t0 is not None and 8 <= pct < 100:
                left = (self._time.time() - t0) * (100 - pct) / pct
                m = int(left // 60)
                self.run_eta.setText(f"about {m + 1} min left" if m >= 1
                                     else "under a minute left")
            self._last_msg = msg
            self._msg_at = self._time.time()

        def _notify_os(self, title, text):
            """A system notification for the person who pressed go and
            went to edit photos: a long run should announce itself even
            when this window is buried."""
            if sys.platform != "darwin" or self.isActiveWindow():
                return
            try:
                import subprocess
                t = title.replace('"', "'")
                x = text.replace('"', "'")
                subprocess.Popen(
                    ["osascript", "-e",
                     f'display notification "{x}" with title "{t}" '
                     f'sound name "Glass"'])
            except Exception:
                pass

        def _show_preview(self, out_dir):
            """The finished picture is the done screen's hero — nothing
            says 'it worked' like the photograph itself."""
            try:
                from PySide6.QtGui import QPixmap
                p = Path(out_dir) / "preview.jpg"
                if p.exists():
                    pm = QPixmap(str(p))
                    if not pm.isNull():
                        self.preview_lbl.setPixmap(pm.scaled(
                            540, 360, Qt.KeepAspectRatio,
                            Qt.SmoothTransformation))
                        self.preview_lbl.setVisible(True)
                        return
            except Exception:
                pass
            self.preview_lbl.clear()
            self.preview_lbl.setVisible(False)

        def _on_done(self, result):
            self._hb.stop()
            self._hold_awake(False)
            self._set_running(False)
            self.bar.setValue(100)
            self.run_pct.setText("100%")
            groups = result.get("groups", [])
            meteors = sum(g["n_meteors"] for g in groups)
            flagged = sum(g.get("n_flagged", 0) for g in groups)
            quality = ", ".join(g["alignment_quality"] for g in groups)
            secs = self._time.time() - getattr(self, "_run_t0",
                                               self._time.time())
            # remember this machine's own pace, so the next estimate is
            # its number rather than a guess from someone else's laptop
            mode = getattr(self, "_run_mode", M.DEFAULT)
            hunted = getattr(self, "_run_meteors", True)
            if self.n_photos > 0 and secs > 5 \
                    and not getattr(self, "_run_is_demo", False):
                rate = max(secs - M.by_key(mode).overhead_s, 1.0) \
                    / self.n_photos
                self._settings.setValue(
                    f"rate_{mode}_{'m' if hunted else 'c'}", rate)
                self._mode_changed()
            mins = secs / 60.0
            when = (f"{secs:.0f} seconds" if secs < 90
                    else f"{mins:.0f} minutes")
            if hunted:
                head = (f"Found {meteors} "
                        f"meteor{'' if meteors == 1 else 's'}")
                subbits = []
                if flagged:
                    subbits.append(f"{flagged} plane/satellite trail"
                                   f"{'' if flagged == 1 else 's'} flagged")
            else:
                head = "Your composite is ready"
                subbits = []
            subbits.append(f"finished in {when}")
            if "degraded" in quality:
                subbits.append(
                    "⚠ the star lock was shaky on this night, so the "
                    "layers may not line up perfectly — the report says "
                    "what happened")
            self.done_head.setText(head)
            self.done_sub.setText("  ·  ".join(subbits))
            # the setup screen keeps a one-line copy, so coming back to
            # tweak the choices still says what the last run did
            self.status.setText(f"{head} · {'  ·  '.join(subbits)}")
            self._notify_os("MeteorPrep is done",
                            f"{head} · {'  ·  '.join(subbits)}")
            try:
                from pathlib import Path as _P
                target = None
                psd = None
                bundle = None
                video = None
                for g in groups:
                    outs = g.get("outputs", {})
                    target = outs.get("report") or target
                    psd = outs.get("psd") or psd
                    bundle = outs.get("finish_bundle") or bundle
                    video = outs.get("timelapse") or video
                # a fresh run means a fresh bundle: retire the old
                # adjust worker so the screen reloads the new night
                if self._adj is not None and self._adj.isRunning():
                    self._adj.submit("quit")
                self._adj = None
                self._adj_path = None
                self._bundle_path = bundle
                self._video_path = video
                self.adjust_btn.setVisible(bool(bundle))
                self.video_btn.setVisible(bool(video))
                if target is None and groups:
                    target = str(_P(next(iter(
                        groups[0]["outputs"].values()))).parent)
                if target:
                    self._report_path = target
                    self._result_dir = str(_P(target).parent)
                    self._psd_path = psd
                    self.open_psd_btn.setVisible(bool(psd))
                    self.horizon_btn.setVisible(
                        not getattr(self, "_run_is_demo", False)
                        and (_P(self._result_dir)
                             / "skymask.png").exists())
                    self._show_preview(self._result_dir)
                    # a week later, "where did my files go" is the first
                    # support question every tool like this gets — so the
                    # window remembers, across relaunches
                    self._settings.setValue("last_report", target)
                    self.last_link.setText("Open the last run's report")
                    self.last_link.setVisible(True)
                    self._open_path(target)
            except Exception:
                pass
            self._goto("done")

        def _keep_selftest_report(self, text):
            """Park the setup-check report where a person can open it —
            under the .app there is no console for it to go to."""
            from pathlib import Path as _P
            for folder in (_P.home() / "Desktop", _P.home(), _P(".")):
                try:
                    if not folder.is_dir():
                        continue
                    dest = folder / "MeteorPrep setup check.txt"
                    dest.write_text(text, encoding="utf-8")
                    self._selftest_report = str(dest)
                    return
                except OSError:
                    continue

        def _show_selftest(self, ok, verdict):
            text = ("✓ " if ok else "✗ ") + verdict
            path = getattr(self, "_selftest_report", None)
            if path:
                text += (f"\n\nThe details are in {path} — send that file "
                         "if anything is missing.")
            self.home_status.setText(text)

        def _on_stopped(self):
            self._hb.stop()
            self._hold_awake(False)
            self._set_running(False)
            self.status.setText(
                "Stopped. What it had already worked out is kept — run "
                "the same folder again and it picks up from there.")
            self._goto("setup" if self.folder else "home")
            if not self.folder:
                self.home_status.setText(self.status.text())

        def _on_fail(self, tb):
            self._hb.stop()
            self._hold_awake(False)
            self._set_running(False)
            self._notify_os("MeteorPrep stopped",
                            "The run hit a problem — the window has the "
                            "details.")
            # The messages this program raises are written for a person
            # and several of them are a paragraph long — "your disk is
            # full, here is what to do".  Keeping only the last line of
            # the traceback threw the explanation away and then stripped
            # the label off what was left.
            lines = [ln for ln in tb.strip().splitlines() if ln.strip()]
            msg = ""
            for k, ln in enumerate(lines):
                if ln.startswith(("Traceback", "  ", "\t")):
                    continue
                msg = "\n".join(lines[k:]).strip()
                break
            if ":" in msg.split("\n")[0]:
                head, rest = msg.split(":", 1)
                if head.replace(".", "").replace("_", "").isalnum():
                    msg = rest.strip()      # drop only the exception name
            text = ((msg[:1200] or "The run stopped early.")
                    + "\n\nThe full diary is in run_log.txt inside the "
                      "results folder — or press 'Save a problem report' "
                      "and send the zip it puts on your Desktop.")
            self.status.setText(text)
            self.problem_btn.setVisible(True)
            self._last_tb = tb
            self._goto("setup" if self.folder else "home")
            if not self.folder:
                self.home_status.setText(text)
            print(tb, file=sys.stderr)

        def _save_problem_report(self):
            """Everything support needs, one zip, on the Desktop: the run
            diaries, the machine's shape, and the error itself."""
            import io
            import platform
            import zipfile
            from pathlib import Path as _P

            from meteorprep import __version__
            try:
                dest_dir = _P.home() / "Desktop"
                if not dest_dir.is_dir():
                    dest_dir = _P.home()
                dest = dest_dir / "MeteorPrep problem report.zip"
                with zipfile.ZipFile(dest, "w",
                                     zipfile.ZIP_DEFLATED) as z:
                    out = _P(getattr(self, "_last_out", "") or ".")
                    for name in ("run_log.txt", "run_log_quick.txt"):
                        f = out / name
                        if f.exists():
                            z.write(f, name)
                    info = io.StringIO()
                    info.write(f"MeteorPrep {__version__}\n")
                    info.write(f"{platform.platform()}\n")
                    info.write(f"Python {sys.version}\n")
                    info.write(f"folder: {self.folder}\n")
                    info.write(f"photos: {self.n_photos}\n")
                    z.writestr("about_this_mac.txt", info.getvalue())
                    if getattr(self, "_last_tb", ""):
                        z.writestr("error.txt", self._last_tb)
                self.status.setText(
                    f"Saved: {dest}\nSend that file and describe what "
                    "you were doing — it holds the whole story.")
                self._open_path(str(dest_dir))
            except Exception as exc:
                self.status.setText(f"Could not write the report: {exc}")

        def closeEvent(self, event):
            for c in list(self._counters):
                c.wait(2000)
            if self._adj is not None and self._adj.isRunning():
                self._adj.submit("quit")
                self._adj.wait(3000)
            if self.worker is not None and self.worker.isRunning():
                if not getattr(self, "_quit_asked", False):
                    self._quit_asked = True
                    self.run_stage.setText(
                        "Still working — press Stop, or close this window "
                        "again, to end the run. Whatever it has finished "
                        "is kept, and running the folder again picks up "
                        "from there.")
                    event.ignore()
                    return
                # Second ask: stop for real.  Letting the window close
                # with a live QThread is not "cancel" — Qt aborts the
                # process when the thread object is collected, which
                # looks to a person like the app crashed on the way out.
                # The pipeline checks the flag on its next progress
                # report and unwinds through its own cleanup.
                self.run_stage.setText("Stopping…")
                self.worker.cancel()
                if not self.worker.wait(15000):
                    self.run_stage.setText(
                        "The current step will not stop cleanly; leave "
                        "the window open until it finishes.")
                    self._quit_asked = False
                    event.ignore()
                    return
            self._hold_awake(False)
            event.accept()

    app = QApplication.instance() or QApplication(sys.argv)
    app.setStyleSheet(STYLE)
    win = Window()
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
