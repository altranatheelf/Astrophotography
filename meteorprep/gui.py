"""Thin PySide6 drag-and-drop wrapper (§1.4, Phase 4).

One window: a drop target, a "Prepare" button, a progress bar and four
checkboxes.  The GUI only builds a Config and calls
``meteorprep.pipeline.run`` on a worker thread — all logic lives in the
CLI-core library.  Requires the ``gui`` extra (PySide6).
"""

from __future__ import annotations

import sys
import traceback


def main() -> int:
    try:
        from PySide6.QtCore import Qt, QThread, Signal
        from PySide6.QtWidgets import (QApplication, QCheckBox, QFileDialog,
                                       QLabel, QMainWindow, QProgressBar,
                                       QPushButton, QVBoxLayout, QWidget)
    except ImportError:
        print("PySide6 is not installed: pip install 'meteorprep[gui]'",
              file=sys.stderr)
        return 1

    from meteorprep.config import Config
    from meteorprep.pipeline import run as run_pipeline

    class Worker(QThread):
        progressed = Signal(int, str)
        finished_ok = Signal(dict)
        failed = Signal(str)

        def __init__(self, cfg):
            super().__init__()
            self.cfg = cfg

        def run(self):
            try:
                result = run_pipeline(
                    self.cfg,
                    progress=lambda f, m: self.progressed.emit(int(f * 100), m))
                self.finished_ok.emit(result)
            except Exception:
                self.failed.emit(traceback.format_exc())

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            self.setWindowTitle("METEORPREP")
            self.setAcceptDrops(True)
            self.folder = None
            self.worker = None

            central = QWidget()
            layout = QVBoxLayout(central)
            self.drop_label = QLabel(
                "Drop your meteor-frame folder here\n(or click to browse)")
            self.drop_label.setAlignment(Qt.AlignCenter)
            self.drop_label.setMinimumHeight(160)
            self.drop_label.setStyleSheet(
                "border: 2px dashed #888; border-radius: 12px; font-size: 15px;")
            self.drop_label.mousePressEvent = self._browse
            layout.addWidget(self.drop_label)

            self.cb_png = QCheckBox("Emit PNG + Photoshop script fallback")
            self.cb_png.setChecked(True)
            self.cb_trail = QCheckBox("Emit star-trail render")
            self.cb_sheet = QCheckBox("Emit contact sheet")
            self.cb_sheet.setChecked(True)
            self.cb_force = QCheckBox("Force re-run (ignore cache)")
            for cb in (self.cb_png, self.cb_trail, self.cb_sheet, self.cb_force):
                layout.addWidget(cb)

            self.button = QPushButton("Prepare")
            self.button.setEnabled(False)
            self.button.clicked.connect(self._start)
            layout.addWidget(self.button)

            self.bar = QProgressBar()
            self.status = QLabel("")
            layout.addWidget(self.bar)
            layout.addWidget(self.status)
            self.setCentralWidget(central)
            self.resize(460, 420)

        def dragEnterEvent(self, e):
            if e.mimeData().hasUrls():
                e.acceptProposedAction()

        def dropEvent(self, e):
            for url in e.mimeData().urls():
                self._set_folder(url.toLocalFile())
                break

        def _browse(self, _event):
            folder = QFileDialog.getExistingDirectory(self, "Choose frame folder")
            if folder:
                self._set_folder(folder)

        def _set_folder(self, folder):
            self.folder = folder
            self.drop_label.setText(folder)
            self.button.setEnabled(True)

        def _start(self):
            cfg = Config(
                input_dir=self.folder,
                output_dir=str(self.folder) + "_meteorprep",
                emit_pngjsx=self.cb_png.isChecked(),
                emit_startrail=self.cb_trail.isChecked(),
                emit_contact_sheet=self.cb_sheet.isChecked(),
                force=self.cb_force.isChecked(),
            )
            self.button.setEnabled(False)
            self.worker = Worker(cfg)
            self.worker.progressed.connect(self._on_progress)
            self.worker.finished_ok.connect(self._on_done)
            self.worker.failed.connect(self._on_fail)
            self.worker.start()

        def _on_progress(self, pct, msg):
            self.bar.setValue(pct)
            self.status.setText(msg)

        def _on_done(self, result):
            total = sum(g["n_meteors"] for g in result["groups"])
            quality = ", ".join(g["alignment_quality"] for g in result["groups"])
            banner = "" if "degraded" not in quality else "  ⚠ ALIGNMENT DEGRADED"
            self.status.setText(f"Done: {total} meteor(s).{banner}")
            self.button.setEnabled(True)

        def _on_fail(self, tb):
            self.status.setText("Failed — see console")
            print(tb, file=sys.stderr)
            self.button.setEnabled(True)

    app = QApplication(sys.argv)
    win = Window()
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
