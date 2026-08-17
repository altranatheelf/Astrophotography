"""Integration test for the phone-guided web app: upload synthetic frames
over HTTP, start a run, poll to completion, download the result."""

import json
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from meteorprep.webapp import AppState, make_handler


@pytest.fixture()
def server(tmp_path):
    state = AppState(tmp_path / "work")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    yield base, state
    httpd.shutdown()


def _get(base, path):
    with urllib.request.urlopen(base + path, timeout=30) as r:
        return r.status, r.read()


def _get_json(base, path):
    status, body = _get(base, path)
    return status, json.loads(body)


def _post(base, path, data=b""):
    req = urllib.request.Request(base + path, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status, json.loads(r.read())


def test_page_and_checks(server):
    base, _ = server
    status, body = _get(base, "/")
    assert status == 200
    assert b"METEORPREP" in body
    status, checks = _get_json(base, "/api/checks")
    assert status == 200
    assert {"exiftool", "star_matcher", "disk_free_gb", "cores"} <= set(checks)


def test_full_phone_flow(server, synth_dir, ground_truth):
    base, state = server

    # 1. upload every synthetic frame + its metadata sidecar from the "phone"
    for p in sorted(Path(synth_dir).iterdir()):
        if p.suffix not in (".tif", ".json"):
            continue
        status, resp = _post(base, "/api/upload?name=" + p.name,
                             p.read_bytes())
        assert status == 200 and resp.get("ok")

    # power-user override standing in for the phone's simpler defaults:
    # offline catalog + solver seed, and the parallel reprojection path
    # note: NO seed hints — this exercises the fully automatic blind solve
    override = {
        "catalog_file": str(Path(synth_dir) / "catalog_radec.npy"),
        "pixel_pitch_um": 16000.0 / ground_truth["focal_px"],
        "solve_every_k": 4,
        "jobs": 2,
        "emit_psd": False,
    }
    _post(base, "/api/upload?name=meteorprep_config.json",
          json.dumps(override).encode())

    status, snap = _get_json(base, "/api/status")
    assert snap["n_files"] >= 12

    # 2. start and poll like the page does
    status, resp = _post(base, "/api/start")
    assert resp.get("ok")
    deadline = time.time() + 600
    while time.time() < deadline:
        _, snap = _get_json(base, "/api/status")
        if snap["phase"] in ("done", "error"):
            break
        time.sleep(2)
    assert snap["phase"] == "done", snap.get("error")

    g = snap["result"]["groups"][0]
    assert g["n_meteors"] == len(ground_truth["meteors"])
    assert g["n_flagged"] >= 2

    # 3. review artifacts: contact sheet renders, zip downloads
    status, sheet = _get(base, "/api/contact_sheet")
    assert status == 200 and sheet[:8] == b"\x89PNG\r\n\x1a\n"
    status, blob = _get(base, "/api/download")
    assert status == 200 and blob[:2] == b"PK" and len(blob) > 10000

    # 4. cleanup_cache freed the detection cache
    reproj = Path(state.output_dir) / "cache" / "g01" / "detect_aligned"
    assert not reproj.exists() or not any(reproj.iterdir())

    # 5. reset clears the uploads for a new night
    status, resp = _post(base, "/api/reset")
    assert resp.get("ok")
    _, snap = _get_json(base, "/api/status")
    assert snap["n_files"] == 0
