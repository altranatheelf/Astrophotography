"""The window's skins, and the small true things it puts on them."""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from meteorprep.ui import facts
from meteorprep.ui import theme as T


# ----------------------------------------------------------------- themes
def test_every_theme_is_complete_and_distinct():
    assert list(T.THEMES) == T.ORDER
    seen = set()
    for key in T.ORDER:
        t = T.get(key)
        for field, value in vars(t).items():
            if field == "swatch":
                assert len(value) == 3, key
                continue
            if field in ("lcd_glow", "cap_bg"):
                continue          # empty means "this skin does not do that"
            assert value not in (None, ""), f"{key}.{field} is empty"
        assert t.instrument in ("dial", "sextant")
        assert t.mount in ("box", "pins", "corners", "glass")
        # a skin has to be its own thing, not a nudge of the last one
        assert t.ground not in seen
        seen.add(t.ground)
    # lcd_glow is the one token allowed to be empty: paper does not glow
    assert T.get("chartroom").lcd_glow == ""
    assert T.get("console").lcd_glow


def test_only_the_chart_room_is_a_light_skin():
    light = [k for k in T.ORDER if T.get(k).is_light()]
    assert light == ["chartroom"]


def test_the_stylesheet_is_fully_formatted():
    fam = T.families({})
    for key in T.ORDER:
        qss = T.get(key).qss(fam)
        assert "{self." not in qss and "{{" not in qss
        assert qss.count("{") == qss.count("}")
        assert "QPushButton#primary" in qss and "QLabel#caps" in qss


def test_an_unknown_theme_falls_back_rather_than_failing():
    assert T.get("no-such-skin").key == T.DEFAULT
    assert T.get("").key == T.DEFAULT


def test_the_bundled_faces_are_present_with_their_licence():
    ttfs = sorted(p.name for p in T.FONT_DIR.glob("*.ttf"))
    assert "IMFellEnglishSC-Regular.ttf" in ttfs
    assert "IBMPlexMono-Regular.ttf" in ttfs
    assert (T.FONT_DIR / "FONTS.txt").exists()
    # with nothing loaded the app still has a usable stack
    fam = T.families({})
    assert all(fam[k] for k in ("serif", "caps", "mono", "hand"))


# ------------------------------------------------------------------ facts
def test_the_moon_is_computed_not_invented():
    # the night the test photographs were taken: a 2.9-day waxing crescent
    when = datetime(2026, 8, 16, 4, 55, tzinfo=timezone.utc)
    age, illum, waxing = facts.moon_phase(when)
    assert 2.5 < age < 3.3
    assert 0.07 < illum < 0.11
    assert waxing
    assert facts.moon_name(age) == "waxing crescent"
    # and a full moon fourteen days later
    age2, illum2, waxing2 = facts.moon_phase(
        datetime(2026, 8, 30, 4, 55, tzinfo=timezone.utc))
    assert illum2 > 0.95 and not waxing2


def test_a_night_runs_from_evening_to_morning():
    assert facts.night_of(datetime(2026, 8, 16, 4, 55)) == "Night of 15 August"
    assert facts.night_of(datetime(2026, 8, 15, 22, 10)) == "Night of 15 August"


def test_sizes_and_clocks_read_the_way_people_say_them():
    assert facts.human_size(382 * 1024 * 1024) == "382 MB"
    assert facts.human_size(0) == ""
    assert facts.mmss(41) == "0:41"
    assert facts.mmss(None) == "—"


def test_recent_nights_are_remembered_across_runs(tmp_path, monkeypatch):
    monkeypatch.setenv("METEORPREP_STATE_DIR", str(tmp_path))
    facts.remember_night("/photos/perseids", 31, 1, "Night of 12 August")
    rows = facts.remember_night("/photos/frames", 14, 0, "Night of 15 August")
    assert [r["name"] for r in rows] == ["frames", "perseids"]
    assert facts.load_recents()[0]["photos"] == 14
    assert facts.recent_label(rows[0]) == "15 Aug"
    # the same folder run twice is one entry, the newer one
    rows = facts.remember_night("/photos/perseids", 31, 2, "Night of 12 August")
    assert len(rows) == 2 and rows[0]["meteors"] == 2


def test_the_caption_quotes_the_run_and_nothing_else(tmp_path):
    (tmp_path / "capsule.json").write_text(
        '{"captured": "2026-08-16T04:55:54+00:00",'
        ' "integration": "5 min of exposure (14 x 20s)",'
        ' "alignment": "blind plate solve, 3.60 px RMS",'
        ' "lineage": "measured, full depth 79.8%; ground 19.8%"}', "utf-8")
    one, two = facts.caption_lines(tmp_path, 14, 2)
    assert one.startswith("Night of 15 August")
    assert "5 min" in one
    assert "3.60 px RMS" in two and "2 meteors" in two
    # an empty folder says nothing rather than making something up
    assert facts.caption_lines(tmp_path / "nope") == ("", "")


# -------------------------------------------------------------- the window
pytest.importorskip("PySide6", reason="the window needs the gui extra")


@pytest.fixture(scope="module")
def app():
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from PySide6.QtWidgets import QApplication
    existing = QApplication.instance()
    yield existing or QApplication([])


def _window(app):
    from PySide6.QtWidgets import QApplication
    import meteorprep.gui as gui
    real_exec = QApplication.exec
    QApplication.exec = lambda self=None: 0
    try:
        gui.main()
    finally:
        QApplication.exec = real_exec
    for w in QApplication.topLevelWidgets():
        if w.__class__.__name__ == "Window":
            return w
    raise AssertionError("the window did not open")


def test_the_window_paints_every_screen_in_every_skin(app, tmp_path, monkeypatch):
    monkeypatch.setenv("METEORPREP_STATE_DIR", str(tmp_path))
    win = _window(app)
    win.resize(600, 760)
    for key in T.ORDER:
        win._set_theme(key)
        assert win.theme.key == key
        # the picker follows the window, and the instrument follows the theme
        assert win.picker.swatches[key].isChecked()
        assert win.dial.t.instrument == T.get(key).instrument
        for page in ("home", "run", "done", "setup", "adjust", "horizon"):
            win._goto(page)
            shot = win.grab()
            assert not shot.isNull() and shot.width() == 600
    win.close()


def test_the_chosen_skin_is_remembered(app, tmp_path, monkeypatch):
    monkeypatch.setenv("METEORPREP_STATE_DIR", str(tmp_path))
    win = _window(app)
    win._set_theme("lantern")
    assert str(win._settings.value("theme")) == "lantern"
    win._set_theme("lantern")          # asking twice is not an event
    assert win.theme.key == "lantern"
    win._set_theme("console")
    assert win.theme.key == "console"
    win.close()


def test_progress_drives_the_instruments_from_real_messages(app, tmp_path, monkeypatch):
    monkeypatch.setenv("METEORPREP_STATE_DIR", str(tmp_path))
    win = _window(app)
    win.n_photos = 14
    win.strip.set_count(14)
    win._run_t0 = win._time.time() - 7
    win._on_progress(12, "reading photo info (3/14)…")
    assert win.dial.value == 12
    assert win.strip.current == 2          # the third frame is the one in hand
    assert win.lamps[0].state in ("hot", "lit")
    win._on_progress(55, "telling meteors from planes and satellites")
    assert win.lamps[2].state == "hot"
    assert win.lamps[0].state == "lit" and win.lamps[0].sub
    # the console shows the program's own lines, and quotes its figures
    win._on_log("star colour calibration from 51 stars: R x0.845  B x1.024")
    win._on_log("blind plate solve, 3.60 px RMS")
    assert "51 stars" in win.fact_rows["star colour"].text()
    assert "3.60 px RMS" in win.fact_rows["plate solve"].text()
    assert any("51 stars" in line for line in win.log.lines)
    win.close()


def test_verdicts_come_from_the_classifier(app, tmp_path, monkeypatch):
    monkeypatch.setenv("METEORPREP_STATE_DIR", str(tmp_path))
    win = _window(app)
    win.n_photos = 5
    win.strip.set_count(5)
    # the classifier names the photographs it found things in, by file name
    win._frame_files = ["IMG_01.CR2", "IMG_02.CR2", "IMG_03.CR2", "IMG_04.CR2",
                        "IMG_05.CR2"]
    win._mark_verdicts({"groups": [{"candidates": [
        {"label": "meteor", "frames": ["IMG_02.CR2"]},
        {"label": "aircraft", "frames": ["IMG_04.CR2", "IMG_05.CR2"]}]}]})
    assert win.strip.verdicts == {0: "✓", 1: "METEOR", 2: "✓", 3: "PLANE", 4: "PLANE"}
    win.close()
