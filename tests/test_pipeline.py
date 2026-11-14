"""Offline tests of the whole pipeline (no network: every source is faked in tests/fakes.py).

    pip install -r pipeline/requirements.txt pytest
    python -m pytest tests -q

The scenarios follow the real life of the site: a first build, a later build that keeps the
earlier hours of the day from the live data, an hour with no new runs (nothing fetched), an
hour where only the tide is a day old (one small request), and a code push (nothing fetched).
"""
import datetime as dt
import json
import os

import pytest
import requests

from tests import fakes

LIVE = "https://jakobwalt.github.io/sal-y-viento"
H = dt.timedelta(hours=1)
HEAVY = ("aemet.es", "//api.open-meteo.com", "/ncss/")      # downloads, as opposed to cheap checks


@pytest.fixture(scope="module")
def build(tmp_path_factory):
    """Runs pipeline.build against the fakes; returns run(name, now, *flags) -> (rc, folder, changed)."""
    mp = pytest.MonkeyPatch()
    mp.setattr(requests, "get", fakes.fake_get)
    from pipeline import build as B
    root = tmp_path_factory.mktemp("builds")

    def run(name, now, *flags):
        out = root / name
        gh = root / f"{name}.out"
        mp.setenv("GITHUB_OUTPUT", str(gh))
        fakes.CALLS.clear()
        rc = B.main(["--out", str(out), "--previous", LIVE, "--now", now.isoformat(), *flags])
        changed = gh.read_text().strip().split("=")[-1] if gh.exists() else None
        return rc, out, changed

    yield run
    mp.undo()


def load(folder):
    meta = json.loads((folder / "meta.json").read_text())
    spots = json.loads((folder / "spots.json").read_text())["spots"]
    return meta, spots


def test_first_build(build):
    now = fakes.NOW
    rc, out, changed = build("first", now)
    assert rc == 0 and changed == "true"
    meta, spots = load(out)
    from pipeline import config as C

    # the timeline starts at midnight Madrid time and the binary files match the layout in meta
    assert meta["t0"] == "2026-11-03T23:00:00+00:00"
    t0 = dt.datetime.fromisoformat(meta["t0"])
    T, TW = meta["hours"], meta["wave_hours"]
    assert (out / "wind.bin").stat().st_size == T * C.NY * C.NX * 3
    assert (out / "waves.bin").stat().st_size == TW * C.NY * C.NX * 3
    # AEMET first, then the ECMWF outlook; Puertos del Estado waves first, then MFWAM
    # (with nothing live yet, ECMWF also fills the hours of the night before AEMET's run starts)
    last_aemet = max(i for i, m in enumerate(meta["model"]) if m == "aemet")
    assert set(meta["model"][last_aemet + 1:]) == {"ecmwf"}
    assert meta["sources"]["ecmwf"]["outlook_from"] == (t0 + (last_aemet + 1) * H).isoformat()
    assert {"pde", "mf"} <= set(meta["wave_model"])
    assert TW > 72                                            # waves go on past the Puertos files
    # every spot has every field, hour by hour
    keys = {"kn", "gust", "dir", "temp", "rain", "cloud", "wh", "wp", "wd", "tide",
            "s1h", "s1p", "s1d", "s2h", "s2p", "s2d", "wm"}
    for sid in C.SPOTS:
        o = spots[sid]
        assert set(o) == keys and all(len(v) == T for v in o.values())
        aemet_hour = meta["model"].index("aemet")
        assert o["kn"][aemet_hour] is not None and o["gust"][aemet_hour] >= o["kn"][aemet_hour]
        assert any(v is not None for v in o["tide"])
        assert any(v is not None for v in o["s1h"])
    assert meta["sources"]["tide"]["fetched"] == now.isoformat()
    fakes.deploy(out)


def test_later_build_keeps_the_morning(build):
    # six hours on, AEMET has a new run that starts later: the earlier hours come from the live data
    fakes.new_aemet_run(fakes.RUN + 6 * H)
    rc, out, changed = build("later", fakes.NOW + 6 * H)
    assert rc == 0 and changed == "true"
    meta, spots = load(out)
    first_new = dt.datetime.fromisoformat(meta["sources"]["aemet"]["first"])
    t0 = dt.datetime.fromisoformat(meta["t0"])
    kept = int((first_new - t0) / H)
    assert kept > 0 and all(meta["coverage"]["wind"][:kept][8:])      # the hours between were kept
    assert all(m == "aemet" for m in meta["model"][8:kept])
    fakes.deploy(out)


def test_no_new_runs_fetches_nothing(build):
    rc, out, changed = build("quiet", fakes.NOW + 7 * H)
    assert rc == 0 and changed == "false"
    assert not (out / "meta.json").exists()
    assert not [c for c in fakes.CALLS if any(h in c for h in HEAVY[1:])]
    assert not [c for c in fakes.CALLS if "marine" in c]


def test_stale_tide_refreshes_only_the_tide(build):
    meta = json.loads(fakes.DEPLOYED["meta.json"])
    meta["sources"]["tide"]["fetched"] = (fakes.NOW - 30 * H).isoformat()
    fakes.DEPLOYED["meta.json"] = json.dumps(meta).encode()
    rc, out, changed = build("tide", fakes.NOW + 8 * H)
    assert rc == 0 and changed == "true"
    assert not [c for c in fakes.CALLS if any(h in c for h in HEAVY[1:])]
    assert sum("marine" in c for c in fakes.CALLS) == 1
    meta2, spots = load(out)
    assert meta2["sources"]["tide"]["fetched"] == (fakes.NOW + 8 * H).isoformat()
    assert meta2["model"] == meta["model"]                   # the forecast itself is untouched


def test_code_push_queries_no_source(build):
    rc, out, changed = build("push", fakes.NOW + 9 * H, "--reuse-only")
    assert rc == 0 and changed == "true"
    assert all("github.io" in c for c in fakes.CALLS)
    for f in ("meta.json", "wind.bin", "waves.bin", "spots.json", "report.json"):
        assert os.path.exists(out / f)


def test_split_trains():
    from pipeline.marine import split_trains
    # wind sea, swell, secondary swell; the most energetic (height² × period²) comes first
    # (a long 0.3 m swell outranks a short 0.5 m wind sea: 0.3² × 15² > 0.5² × 4²)
    p, s = split_trains([(0.5, 4, 90), (1.0, 12, 275), (0.3, 15, 250)])
    assert p[1] == 12 and s[1] == 15
    # scaled so the two add up (as Hs²) to the total height shown
    p, s = split_trains([(1.0, 12, 275), (0.5, 4, 90)], total=2.236)
    assert abs((p[0] ** 2 + s[0] ** 2) ** .5 - 2.236) < 1e-3
    assert split_trains([(None, None, None)] * 3) == ((None, None, None), (None, None, None))


def test_site_spots_match_config():
    """The site carries its own copy of the spot coordinates (SP) and a spot list (SPOTS)."""
    import re
    from pathlib import Path
    from pipeline import config as C
    html = (Path(__file__).parent.parent / "site" / "index.html").read_text()
    sp = json.loads(re.search(r"const SP=(\{.*?\});", html).group(1))
    ids = re.findall(r'\{id:"(\w+)",name:', html)
    assert set(sp) == set(C.SPOTS) == set(ids)
    for sid, s in C.SPOTS.items():
        assert sp[sid] == [*s["beach"], *s["point"]], sid
