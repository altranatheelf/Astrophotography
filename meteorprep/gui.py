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

    from PySide6.QtGui import QPixmap

    from meteorprep import modes as M
    from meteorprep.config import Config
    from meteorprep.pipeline import run as run_pipeline
    from meteorprep.ui import facts, screens
    from meteorprep.ui import theme as THEME
    from meteorprep.ui import widgets as W

    class Cancelled(Exception):
        """Raised out of the progress callback to unwind a run."""

    class Worker(QThread):
        progressed = Signal(int, str)
        logged = Signal(str)
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
            import logging

            emit = self.logged.emit

            class _Tap(logging.Handler):
                """The run log, as it is written, so the window's console
                shows the program's own words and not a paraphrase."""

                def emit(self, record):
                    try:
                        emit(record.getMessage())
                    except Exception:
                        pass

            tap = _Tap(level=logging.INFO)
            logger = logging.getLogger("meteorprep")
            logger.addHandler(tap)
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
            finally:
                logger.removeHandler(tap)

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

    class ThumbWorker(QThread):
        """The camera's own JPEG preview out of each RAW, for the frame strip.
        It is the picture the camera made of that frame — nothing generated,
        and cheap enough to read while the run is warming up."""
        got = Signal(int, object)
        listed = Signal(list)

        def __init__(self, folder, limit=14):
            super().__init__()
            self.folder = folder
            self.limit = limit
            self._stop = False

        def cancel(self):
            self._stop = True

        def run(self):
            try:
                from meteorprep.config import Config as _C
                from meteorprep.ingest.exif import scan_input_dir
                files = sorted(scan_input_dir(Path(self.folder), _C().raw_extensions))
            except Exception:
                return
            # the frame strip counts in this order, and the classifier names
            # the photographs it found things in, so the window needs both
            self.listed.emit([Path(f).name for f in files])
            for i, path in enumerate(files[:self.limit]):
                if self._stop:
                    return
                data = None
                try:
                    import rawpy
                    with rawpy.imread(str(path)) as raw:
                        thumb = raw.extract_thumb()
                        if thumb.format == rawpy.ThumbFormat.JPEG:
                            data = thumb.data
                except Exception:
                    data = None
                if data:
                    self.got.emit(i, bytes(data))

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

            # the skin: bundled faces first, then the theme the person chose
            self._fonts = THEME.load_fonts()
            self._fam = THEME.families(self._fonts)
            W.set_families(self._fam)
            self.theme = THEME.get(str(self._settings.value("theme", THEME.DEFAULT)))

            self.skin = W.Skin(self.theme)
            shell = QVBoxLayout(self.skin)
            shell.setContentsMargins(0, 0, 0, 0)
            shell.setSpacing(0)
            self.titlebar = W.TitleBar(self.theme)
            shell.addWidget(self.titlebar)
            self.pages = QStackedWidget()
            self.pages.setAttribute(Qt.WA_TranslucentBackground, True)
            shell.addWidget(self.pages, 1)
            self.rail = W.Rail(self.theme)
            shell.addWidget(self.rail)

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
            self.setCentralWidget(self.skin)
            self.resize(600, 760)
            self.setMinimumSize(600, 700)
            self._thumbs = None
            self._verdicts = {}
            self._stage_i = -1
            self._stage_t0 = None
            self._stage_done = {}
            self._apply_theme(self.theme, first=True)
            self._refresh_recents()
            self._refresh_moon()
            self.rail.set_text(f"v{__version__}", "")

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
            return screens.build_home(self, self.theme, version)

        def _build_run(self):
            return screens.build_run(self, self.theme)

        def _build_done(self):
            return screens.build_done(self, self.theme)

        # ---------------- the skin -----------------------------------------

        def _set_theme(self, key):
            t = THEME.get(key)
            if t.key == self.theme.key:
                return
            self._settings.setValue("theme", t.key)
            self._apply_theme(t)

        def _apply_theme(self, t, first=False):
            self.theme = t
            app = QApplication.instance()
            if app is not None:
                app.setStyleSheet(t.qss(self._fam))
            W.apply_theme(self, t)
            # the one label that paints its own ink on the sky window
            if hasattr(self, "stop_cap"):
                self.stop_cap.setStyleSheet(
                    'font-family: "%s"; font-size: 10px; letter-spacing: 2px;'
                    ' color: %s; background: transparent;'
                    % (self._fam["caps"], t.metal_ink))
            if hasattr(self, "sky_note"):
                self.sky_note.setStyleSheet(
                    'font-family: "%s"; font-size: 11px; color: #a9a08a;'
                    ' background: transparent;' % self._fam["mono"])
            if not first:
                self.update()

        def _home_status(self, text):
            """The one line on Home that says what the app is doing."""
            if hasattr(self, "home_lcd"):
                self.home_lcd.set_lines(text or "no folder open", dim=[not text])

        def _run_header(self, name):
            if not hasattr(self, "run_path"):
                return
            text = str(name)
            parts = Path(text).parts
            if len(text) > 52 and len(parts) > 2:
                text = "…/" + "/".join(parts[-2:])
            self.run_path.setText(text)

        def _set_fact(self, key, value):
            """Show a measurement, and its label, once the program has it."""
            self.fact_rows[key].setText(value)
            self.fact_caps[key].setVisible(True)

        def _run_stage(self, msg):
            if hasattr(self, "run_lcd"):
                lines = self.run_lcd._lines
                self.run_lcd.set_lines(str(msg), lines[1] if len(lines) > 1 else "")

        def _run_eta(self, text):
            if hasattr(self, "remaining_lcd"):
                self.remaining_lcd.set_lines(text or "—")

        def _refresh_moon(self):
            line, name, illum, waxing = facts.moon_line()
            if hasattr(self, "moon"):
                self.moon.set_phase(illum, waxing)
                self.moon_lcd.set_lines(line)
                self.moon_name.setText(name)

        def _refresh_recents(self):
            rows = facts.load_recents()
            self._recent_rows = rows
            if not hasattr(self, "recents"):
                return
            table = []
            for r in rows[:4]:
                m = int(r.get("meteors", 0))
                table.append([(facts.recent_label(r), "date"),
                              r.get("name", ""),
                              (str(r.get("photos", "")), "mono"),
                              (str(m), "hot" if m else "mono")])
            self.recents.set_rows(table)

        def _open_recent(self, i):
            rows = getattr(self, "_recent_rows", [])
            if 0 <= i < len(rows):
                folder = rows[i].get("folder")
                if folder and Path(folder).is_dir():
                    self._set_folder(folder)
                else:
                    self._home_status("that folder has moved or been renamed")

        def _open_file_row(self, i):
            rows = getattr(self, "_file_paths", [])
            if 0 <= i < len(rows):
                self._open_path(rows[i])

        def _start_thumbs(self, folder):
            worker = getattr(self, "_thumbs", None)
            if worker is not None:
                worker.cancel()
            self._frame_files = []
            self._thumbs = ThumbWorker(folder)
            self._thumbs.got.connect(self._on_thumb)
            self._thumbs.listed.connect(self._on_frame_list)
            self._thumbs.start()

        def _on_frame_list(self, names):
            self._frame_files = list(names)

        def _on_thumb(self, i, data):
            pm = QPixmap()
            if pm.loadFromData(data) and hasattr(self, "strip"):
                self.strip.set_thumb(i, pm)

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
            scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
            scroll.viewport().setAutoFillBackground(False)
            return scroll

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
            reset = QPushButton("Back to the run's look")
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
            self.adj_tiff = QCheckBox("Also a 16-bit TIFF")
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
            self.titlebar.set_title(f"{name} — MeteorPrep" if name else "MeteorPrep")
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
            self.strip.clear()
            self._start_thumbs(folder)
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
                self._home_status(f"{name} · {n} photo{'s' if n != 1 else ''}")
                self.run_sub.setText(
                    f"{n} photo{'s' if n != 1 else ''} · results go to "
                    f"{self._out_name()}")
                self.strip.set_count(n)
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

        def closeEvent(self, event):
            """Let the background readers go before the window does: a thread
            still reading thumbnails when Qt tears the app down is a crash on
            quit, and quitting is the last thing a person does here."""
            worker = getattr(self, "_thumbs", None)
            if worker is not None:
                worker.cancel()
                worker.wait(1500)
            for counter in list(getattr(self, "_counters", [])):
                counter.wait(500)
            if self._adj is not None and self._adj.isRunning():
                self._adj.submit("quit")
                self._adj.wait(1500)
            self._hold_awake(False)
            super().closeEvent(event)

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
                self.sky.set_hot(True)
                e.acceptProposedAction()

        def dragLeaveEvent(self, e):
            self.sky.set_hot(False)

        def dropEvent(self, e):
            import os
            self.sky.set_hot(False)
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
                    self._home_status(
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
            self._run_stage(
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
                self._run_header("demo night")
            else:
                self._run_header(str(self.folder or ""))
            self.dial.set_value(0)
            self._run_stage("starting up…")
            self._run_eta("")
            self.log.clear()
            self._verdicts = {}
            self._stage_i = -1
            self._stage_done = {}
            self._stage_t0 = None
            for lamp in self.lamps:
                lamp.set_state("off", "")
            for key in self.fact_rows:
                self.fact_rows[key].setText("")
                self.fact_caps[key].setVisible(False)
            self.strip.clear_verdicts()
            if getattr(self, "_run_is_demo", False):
                self.strip.clear()
            self.elapsed_lcd.set_lines("0:00")
            night, moon = self._night_and_moon()
            self.run_night.setText(night)
            self.run_moon.setText(moon)
            self.stop_button.setEnabled(True)
            self.stop_button.setText("Stop")
            self._goto("run")
            self.worker = Worker(cfg)
            self.worker.progressed.connect(self._on_progress)
            self.worker.logged.connect(self._on_log)
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
                self._run_stage(
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
            self._home_status(
                "Building a demo night — a dozen fake photos with two "
                "meteors hidden in them…")
            self._demo_maker = DemoWorker()

            def _go(folder):
                self.demo_button.setEnabled(True)
                self._home_status("")
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
                self._home_status(
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
            self._home_status("checking…")
            self.tester = SelfTestWorker()
            self.tester.report.connect(self._keep_selftest_report)
            self.tester.progressed.connect(self._home_status)

            def finish(ok, verdict):
                self._show_selftest(ok, verdict)
                running = (self.worker is not None
                           and self.worker.isRunning())
                self.test_button.setEnabled(not running)
                self.button.setEnabled(not running and bool(self.folder)
                                       and self.n_photos > 0)
            self.tester.done.connect(finish)
            self.tester.start()

        # the five stages the lamps stand for, matched on the program's own
        # words first and on the percentage only as a floor
        _STAGE_WORDS = (
            (0, ("scanning", "reading photo", "hot-pixel", "photo info")),
            (1, ("star map", "star lock", "aligning", "starfield", "stacking",
                 "clean starfield", "matching your stars")),
            (2, ("meteor", "planes and satellites", "horizon", "cutting",
                 "layer")),
            (3, ("assembling", "psd", "photoshop")),
            (4, ("preview", "report", "bundle", "film", "timelapse", "done:")),
        )

        def _stage_for(self, pct, msg):
            low = (msg or "").lower()
            best = -1
            for idx, words in self._STAGE_WORDS:
                if any(w in low for w in words):
                    best = max(best, idx)
            if best < 0:
                best = 0 if pct < 12 else 1 if pct < 55 else 2 if pct < 88 else 3
            return best

        @staticmethod
        def _took(secs):
            """A stage that took no time did not run: it was already done from
            a previous run, and saying '0.0 s' would imply it was instant."""
            if secs < 0.05:
                return "reused"
            return f"{secs:.1f} s" if secs < 99 else f"{secs / 60:.0f} min"

        def _advance_stage(self, stage):
            """Light the lamp for the stage that is running, and leave the
            one that finished showing how long it actually took."""
            now = self._time.time()
            if stage <= self._stage_i:
                return          # a run does not go back a stage
            if self._stage_i >= 0 and self._stage_t0 is not None:
                took = now - self._stage_t0
                self._stage_done[self._stage_i] = took
                self.lamps[self._stage_i].set_state("lit", self._took(took))
            for i in range(self._stage_i + 1, stage):
                self.lamps[i].set_state("lit", "")
            self._stage_i = stage
            self._stage_t0 = now
            if 0 <= stage < len(self.lamps):
                self.lamps[stage].set_state("hot", "running")

        def _on_log(self, line):
            """The console, and the three measurements the window quotes
            from the run log the moment the program prints them."""
            import re as _re
            self.log.add(line)
            low = line.lower()
            m = _re.search(r"([\d.]+)\s*px\s*rms", low)
            if m:
                how = "blind" if "blind" in low else "solved"
                self._set_fact("plate solve", f"{how} · {m.group(1)} px RMS")
            if "star lock reused" in low:
                self._set_fact("star lock", "reused from the last run")
            elif "star lock" in low or "solved" in low and "stars" in low:
                self._set_fact("star lock", "solved for this night")
            m = _re.search(r"from (\d+) stars:\s*r\s*x([\d.]+)\s+b\s*x([\d.]+)", low)
            if m:
                self._set_fact("star colour",
                               f"{m.group(1)} stars · R ×{m.group(2)} · B ×{m.group(3)}")

        def _on_progress(self, pct, msg):
            import re as _re
            self.dial.set_value(pct)
            self._run_stage(msg)
            self._advance_stage(self._stage_for(pct, msg))
            t0 = getattr(self, "_run_t0", None)
            if t0 is not None:
                gone = self._time.time() - t0
                self.elapsed_lcd.set_lines(facts.mmss(gone))
                if 8 <= pct < 100:
                    left = gone * (100 - pct) / pct
                    self._run_eta(facts.mmss(left) if left < 5400 else "a while")
            m = _re.search(r"\(?(\d+)\s*/\s*(\d+)\)?", msg or "")
            if m:
                i, n = int(m.group(1)), int(m.group(2))
                known = self.strip.count or self.n_photos
                if known and n == known and 0 < i <= n:
                    self.strip.set_current(i - 1)
                    lines = self.run_lcd._lines
                    self.run_lcd.set_lines(lines[0], f"frame {i} / {n}")
            self._home_status(msg)
            self.rail.set_text(
                f"[{pct:3d}%] {msg}",
                f"frame {self.strip.current + 1} of {self.strip.count}"
                if self.strip.count and self.strip.current >= 0 else "")
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

        def _show_preview(self, out_dir, meteors=0):
            """The finished picture, mounted the way this skin keeps a print,
            with the night's own signature engraved under it."""
            cap1, cap2 = facts.caption_lines(out_dir, self.n_photos, meteors)
            pm = None
            try:
                p = Path(out_dir) / "preview.jpg"
                if p.exists():
                    loaded = QPixmap(str(p))
                    if not loaded.isNull():
                        pm = loaded
                        if not hasattr(self, "_sky_pm"):
                            self._sky_pm = loaded
                        self.sky.set_sky(loaded)
                        name = Path(self.folder).name if self.folder else ""
                        self.sky_note.setText(
                            f"your last night · {name}" if name else "")
            except Exception:
                pm = None
            self.mount.set_photo(pm, cap1, cap2)

        def _list_outputs(self, out_dir):
            """Every file the run wrote, with its real size — the row you
            click is the file it names."""
            notes = {
                "meteorprep.psd": "layered Photoshop file",
                "preview.jpg": "the picture above",
                "report.html": "the report, with the candidates",
                "timelapse.mp4": "film of the night",
                "finish_bundle.npz": "what Adjust edits from",
                "startrail.jpg": "star trails",
                "meteors.jpg": "the meteors alone",
                "capsule.txt": "how this image was made",
                "meteorprep.json": "the numbers, for another program",
            }
            order = ["meteorprep.psd", "preview.jpg", "report.html", "timelapse.mp4",
                     "startrail.jpg", "meteors.jpg", "finish_bundle.npz",
                     "capsule.txt", "meteorprep.json"]
            rows, paths = [], []
            try:
                here = Path(out_dir)
                found = [f for f in here.glob("*.*") if f.is_file()]
            except Exception:
                found = []
            found.sort(key=lambda q: (order.index(q.name) if q.name in order else 99,
                                      q.name))
            for f in found:
                if f.suffix.lower() in (".png", ".log", ".tif", ".json") \
                        and f.name != "meteorprep.json":
                    continue
                try:
                    size = f.stat().st_size
                except OSError:
                    continue
                rows.append([f.name, notes.get(f.name, ""), facts.human_size(size)])
                paths.append(str(f))
            rows, paths = rows[:8], paths[:8]
            self._file_paths = paths
            # the keys follow what is actually in the folder: a stage the run
            # skipped because it was already done still left its file there,
            # and the person can open it
            by_name = {Path(q).name: q for q in paths}
            if by_name.get("meteorprep.psd"):
                self._psd_path = by_name["meteorprep.psd"]
            if by_name.get("timelapse.mp4"):
                self._video_path = by_name["timelapse.mp4"]
            self.open_psd_btn.setVisible(bool(getattr(self, "_psd_path", None)))
            self.video_btn.setVisible(bool(getattr(self, "_video_path", None)))
            bundle = Path(out_dir) / "finish_bundle.npz"
            if bundle.exists():
                self._bundle_path = str(bundle)
                self.adjust_btn.setVisible(True)
            self.files.set_rows([[(r[0], "mono"), (r[1], "note"), (r[2], "mono")]
                                 for r in rows])
            self.files.setFixedHeight(max(len(rows), 1) * 21 + 4)
            here = Path(out_dir)
            where = f"{here.parent.name}/{here.name}" if here.parent.name else here.name
            self.written_cap.setText(f"Written to  {where}")

        def _on_done(self, result):
            self._hb.stop()
            self._hold_awake(False)
            self._set_running(False)
            self.dial.set_value(100)
            self._finish_lamps(result)
            self._mark_verdicts(result)
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
            self.done_lcd.set_lines("[100%] done: your composite is ready",
                                    f"elapsed {facts.mmss(secs)}   frames "
                                    f"{self.n_photos} / {self.n_photos}")
            self.rail.set_text("[100%] done: your composite is ready",
                               f"{facts.mmss(secs)}")
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
                    self._show_preview(self._result_dir, meteors)
                    self._list_outputs(self._result_dir)
                    if not getattr(self, "_run_is_demo", False) and self.folder:
                        cap = facts.read_capsule(self._result_dir)
                        night = ""
                        try:
                            from datetime import datetime as _dt
                            night = facts.night_of(_dt.fromisoformat(
                                str(cap.get("captured")).replace("Z", "+00:00")))
                        except Exception:
                            night = ""
                        facts.remember_night(self.folder, self.n_photos, meteors,
                                             night, self._result_dir, target)
                        self._refresh_recents()
                    # a week later, "where did my files go" is the first
                    # support question every tool like this gets — so the
                    # window remembers, across relaunches
                    self._settings.setValue("last_report", target)
                    self._refresh_recents()
                    self._open_path(target)
            except Exception:
                pass
            self._goto("done")

        def _finish_lamps(self, result):
            """When the run ends, every lamp keeps the time its stage really
            took — from the pipeline's own stage timings where it reports
            them, and from this window's clock for the rest."""
            timings = {}
            for g in result.get("groups", []):
                for label, secs in g.get("timings", []) or []:
                    timings[str(label).lower()] = float(secs)
            keys = (("folder scan", "reading"), ("clean starfield", "starfield"),
                    ("horizon", "layers"), ("assembling", "psd"), ("preview", "report"))
            if self._stage_i >= 0 and self._stage_t0 is not None:
                took = self._time.time() - self._stage_t0
                self._stage_done[self._stage_i] = took
            for i, lamp in enumerate(self.lamps):
                secs = None
                for word in keys[i]:
                    for label, value in timings.items():
                        if word in label:
                            secs = value if secs is None else secs + value
                            break
                    if secs is not None:
                        break
                if secs is None:
                    secs = self._stage_done.get(i)
                if secs is None:
                    lamp.set_state("off", "")
                else:
                    lamp.set_state("lit", self._took(secs))
            self._stage_i = -1
            self._stage_t0 = None

        def _mark_verdicts(self, result):
            """Each frame gets the classifier's own word for it: the frames a
            candidate touches carry its label, the rest were kept."""
            words = {"meteor": "METEOR", "aircraft": "PLANE", "plane": "PLANE",
                     "satellite": "SATELLITE", "cosmic": "?",
                     "observatory_beam": "BEAM", "unknown": "?"}
            # a candidate names the photographs it crosses by file name; the
            # strip counts them in the order the run read them
            order = {name: i for i, name in enumerate(getattr(self, "_frame_files", []))}
            marks = {}
            for g in result.get("groups", []):
                for cand in g.get("candidates", []) or []:
                    label = words.get(str(cand.get("label", "")).lower())
                    if not label:
                        continue
                    for fr in cand.get("frames", []) or []:
                        if isinstance(fr, int):
                            marks[fr] = label
                        elif str(fr) in order:
                            marks[order[str(fr)]] = label
            n = self.strip.count or self.n_photos
            for i in range(n):
                self.strip.set_verdict(i, marks.get(i, "✓"))
            self.strip.set_current(-1)

        def _night_and_moon(self):
            """The night these photographs belong to, and the moon that was up
            while they were taken — both read from the frames themselves."""
            try:
                from datetime import datetime as _dt
                from meteorprep.config import Config as _C
                from meteorprep.ingest.exif import read_metadata, scan_input_dir
                files = sorted(scan_input_dir(Path(self.folder), _C().raw_extensions))
                if not files:
                    return "", ""
                meta = read_metadata(files[0])
                when = getattr(meta, "timestamp", None) or getattr(meta, "utc", None)
                if isinstance(when, str):
                    when = _dt.fromisoformat(when.replace("Z", "+00:00"))
                if when is None:
                    return "", ""
                line, name, illum, waxing = facts.moon_line(when)
                return facts.night_of(when), f"moon {line}"
            except Exception:
                return "", ""

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
            self._home_status(text)

        def _on_stopped(self):
            self._hb.stop()
            self._hold_awake(False)
            self._set_running(False)
            self.status.setText(
                "Stopped. What it had already worked out is kept — run "
                "the same folder again and it picks up from there.")
            self._goto("setup" if self.folder else "home")
            if not self.folder:
                self._home_status(self.status.text())

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
                self._home_status(text)
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
                    self._run_stage(
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
                self._run_stage("stopping…")
                self.worker.cancel()
                if not self.worker.wait(15000):
                    self._run_stage(
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
