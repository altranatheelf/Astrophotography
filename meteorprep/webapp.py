"""Phone-guided web app.

Run ``meteorprep-phone`` (or ``python3 -m meteorprep.webapp``) on the
computer; it prints an address like ``http://192.168.1.23:8765``.  Open that
on a phone on the same Wi-Fi: a step-by-step page walks through adding the
photos (uploaded straight from the phone's Files app — a USB-C card reader
plugged into an iPhone works), starting the run, watching progress, and
reviewing/downloading the result.  "Add to Home Screen" makes it feel like
an app.

The server is dependency-free (stdlib http.server).  Uploads stream one
file per request (no multipart parsing, no whole-file buffering), so
multi-gigabyte RAW batches work.  It serves the local network only — do not
port-forward it to the internet; it has no authentication.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import socket
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from meteorprep.config import Config

log = logging.getLogger("meteorprep")

PORT_DEFAULT = 8765
CHUNK = 1024 * 1024
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")


class AppState:
    """One run at a time; everything the page needs to render, behind a lock."""

    def __init__(self, workdir: Path):
        self.lock = threading.Lock()
        self.workdir = workdir
        self.upload_dir = workdir / "frames"
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.phase = "idle"          # idle | running | done | error
        self.frac = 0.0
        self.msg = ""
        self.error = ""
        self.result = None
        self.output_dir: Path | None = None

    def snapshot(self) -> dict:
        with self.lock:
            n_files = sum(1 for p in self.upload_dir.iterdir()
                          if p.is_file()) if self.upload_dir.exists() else 0
            size_gb = sum(p.stat().st_size for p in self.upload_dir.iterdir()
                          if p.is_file()) / 1e9 if n_files else 0.0
            return {
                "phase": self.phase, "frac": round(self.frac, 3),
                "msg": self.msg, "error": self.error,
                "n_files": n_files, "size_gb": round(size_gb, 2),
                "result": self.result,
            }


def _friendly(msg: str) -> str:
    """Translate pipeline progress lines into photographer language."""
    table = {
        "scanning input folder": "Looking through your photos…",
        "flagging light-painted frames": "Spotting any light-painted shots…",
        "plate solving (sparse subset)": "Matching your stars to the star map…",
        "detecting meteors": "Hunting for meteors…",
        "classifying candidates": "Telling meteors from planes and satellites…",
        "extracting meteor layers": "Cutting each meteor onto its own layer…",
        "stacking point-star base (meteors excluded)":
            "Averaging all frames into one clean starfield…",
        "segmenting sky/ground": "Finding the horizon…",
        "assembling layers": "Building your Photoshop file…",
    }
    for key, friendly in table.items():
        if msg.startswith(key):
            return friendly
    if msg.startswith("reprojecting frames"):
        return "Aligning every frame to the sky… " + msg.split("(")[-1].rstrip(")")
    if msg.startswith("done:"):
        return "Done! " + msg[5:].strip()
    return msg


def _system_checks() -> dict:
    checks = {}
    checks["exiftool"] = shutil.which("exiftool") is not None
    try:
        import twirl  # noqa: F401
        checks["star_matcher"] = True
    except ImportError:
        checks["star_matcher"] = shutil.which("solve-field") is not None
    try:
        free_gb = shutil.disk_usage(Path.home()).free / 1e9
    except OSError:
        free_gb = 0.0
    checks["disk_free_gb"] = round(free_gb, 1)
    checks["disk_ok"] = free_gb > 40
    checks["cores"] = os.cpu_count() or 1
    return checks


def _start_run(state: AppState) -> None:
    cfg = Config(
        input_dir=str(state.upload_dir),
        output_dir=str(state.workdir / "output"),
        jobs=max((os.cpu_count() or 2) - 1, 1),
        cleanup_cache=True,
        emit_psd=True, emit_pngjsx=True, emit_contact_sheet=True,
    )
    # per-run overrides (meteorprep_config.json next to the frames) are
    # applied inside pipeline.run for every entry point

    def progress(frac, msg):
        with state.lock:
            state.frac = float(frac)
            state.msg = _friendly(str(msg))

    def worker():
        from meteorprep.pipeline import run
        try:
            result = run(cfg, progress=progress)
            with state.lock:
                state.phase = "done"
                state.frac = 1.0
                state.result = {
                    "groups": [{k: v for k, v in g.items()}
                               for g in result["groups"]],
                }
                state.output_dir = Path(cfg.output_dir)
        except Exception as exc:
            log.exception("pipeline failed")
            with state.lock:
                state.phase = "error"
                state.error = str(exc)

    with state.lock:
        if state.phase == "running":
            return
        state.phase = "running"
        state.frac = 0.0
        state.msg = "Starting…"
        state.error = ""
        state.result = None
    threading.Thread(target=worker, daemon=True).start()


def make_handler(state: AppState):
    ui_path = Path(__file__).parent / "webui.html"

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet the request spam
            pass

        # ---------- helpers ----------
        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code: int = 200) -> None:
            self._send(code, json.dumps(obj).encode(), "application/json")

        def _file(self, path: Path, ctype: str, download_name=None) -> None:
            if not path.exists():
                self._json({"error": "not found"}, 404)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(path.stat().st_size))
            if download_name:
                self.send_header("Content-Disposition",
                                 f'attachment; filename="{download_name}"')
            self.end_headers()
            with open(path, "rb") as fh:
                shutil.copyfileobj(fh, self.wfile, CHUNK)

        # ---------- GET ----------
        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self._send(200, ui_path.read_bytes(), "text/html; charset=utf-8")
            elif self.path == "/manifest.json":
                self._json({
                    "name": "METEORPREP", "short_name": "METEORPREP",
                    "start_url": "/", "display": "standalone",
                    "background_color": "#10141F", "theme_color": "#10141F",
                })
            elif self.path == "/api/checks":
                self._json(_system_checks())
            elif self.path == "/api/status":
                self._json(state.snapshot())
            elif self.path.startswith("/api/contact_sheet"):
                out = state.output_dir
                sheets = sorted(out.glob("*/contact_sheet.png")) if out else []
                if sheets:
                    self._file(sheets[0], "image/png")
                else:
                    self._json({"error": "no contact sheet"}, 404)
            elif self.path == "/api/download":
                self._download_zip()
            else:
                self._json({"error": "not found"}, 404)

        def _download_zip(self):
            out = state.output_dir
            if not out or not out.exists():
                self._json({"error": "nothing to download yet"}, 404)
                return
            tmp = Path(tempfile.mkstemp(suffix=".zip")[1])
            try:
                with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
                    for p in sorted(out.rglob("*")):
                        if p.is_file() and "cache" not in p.parts:
                            z.write(p, p.relative_to(out))
                self._file(tmp, "application/zip",
                           download_name="meteorprep_result.zip")
            finally:
                tmp.unlink(missing_ok=True)

        # ---------- POST ----------
        def do_POST(self):
            if self.path.startswith("/api/upload"):
                self._upload()
            elif self.path == "/api/start":
                self._read_body()
                _start_run(state)
                self._json({"ok": True})
            elif self.path == "/api/reset":
                self._read_body()
                with state.lock:
                    if state.phase == "running":
                        self._json({"error": "a run is in progress"}, 409)
                        return
                    shutil.rmtree(state.upload_dir, ignore_errors=True)
                    state.upload_dir.mkdir(parents=True, exist_ok=True)
                    state.phase = "idle"
                    state.result = None
                    state.error = ""
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)

        def _read_body(self) -> bytes:
            length = int(self.headers.get("Content-Length", 0) or 0)
            return self.rfile.read(length) if length else b""

        def _upload(self):
            """One file per request, streamed to disk — no size limit from
            buffering, and no multipart parsing to get wrong."""
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            name = SAFE_NAME.sub("_", (q.get("name") or ["frame"])[0])[-80:]
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0:
                self._json({"error": "empty upload"}, 400)
                return
            dest = state.upload_dir / name
            remaining = length
            with open(dest, "wb") as fh:
                while remaining > 0:
                    chunk = self.rfile.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    fh.write(chunk)
                    remaining -= len(chunk)
            if remaining:
                dest.unlink(missing_ok=True)
                self._json({"error": "upload interrupted"}, 400)
                return
            self._json({"ok": True, "file": name})

    return Handler


def lan_address() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main(port: int = PORT_DEFAULT, workdir: Path | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    workdir = Path(workdir or Path.home() / "METEORPREP")
    state = AppState(workdir)
    server = ThreadingHTTPServer(("0.0.0.0", port), make_handler(state))
    ip = lan_address()
    print()
    print("  METEORPREP phone mode is running.")
    print(f"  On your phone (same Wi-Fi), open:   http://{ip}:{port}")
    print("  Tip: use Safari's Share > Add to Home Screen for an app icon.")
    print("  Leave this window open while it works. Press Ctrl+C to stop.")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
