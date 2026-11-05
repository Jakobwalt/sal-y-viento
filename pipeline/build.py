"""Fetch every source, line them up hour by hour from 00:00 today (Madrid), and write the site's data files.

    python -m pipeline.build --out site/data --previous https://jakobwalt.github.io/sal-y-viento

Hours before the newest run starts are taken from the data currently on the site, so the
timeline always begins at midnight. A source that fails keeps its previous data; if nothing
new arrives at all, the script exits with an error and the site keeps what it has.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import zlib
import traceback
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import requests

from . import config as C

H = dt.timedelta(hours=1)
MISSING_I8 = -128
NONE_U8 = 255


# ---------------------------------------------------------------- encoding
def enc_wind(u, v, gust):
    """[T,NY,NX] floats (kn) → bytes, [T][NY][NX][u,v,gust]; u/v int8 in half knots, gust uint8 knots."""
    T = u.shape[0]
    out = np.empty((T, C.NY, C.NX, 3), np.uint8)
    for k, a in enumerate((u, v)):
        q = np.clip(np.round(a * 2), -127, 127)
        q = np.where(np.isnan(a), MISSING_I8, q).astype(np.int8)
        out[..., k] = q.view(np.uint8)
    out[..., 2] = np.where(np.isnan(gust), 0, np.clip(np.round(gust), 0, 254)).astype(np.uint8)
    return out.tobytes()


def dec_wind(b, T):
    a = np.frombuffer(b, np.uint8).reshape(T, C.NY, C.NX, 3)
    uv = a[..., :2].view(np.int8).astype(np.float32)
    uv[uv == MISSING_I8] = np.nan
    return uv[..., 0] / 2, uv[..., 1] / 2, a[..., 2].astype(np.float32)


def enc_waves(h, p, d):
    """height 0.05 m, period 0.1 s, direction-from 360/256°; 255 = no data (land)."""
    out = np.full(h.shape + (3,), NONE_U8, np.uint8)
    ok = ~np.isnan(h)
    out[..., 0][ok] = np.clip(np.round(h[ok] / 0.05), 0, 254)
    out[..., 1][ok] = np.clip(np.round(np.nan_to_num(p[ok]) / 0.1), 0, 254)
    out[..., 2][ok] = np.round(np.nan_to_num(d[ok]) * 256 / 360) % 256
    return out.tobytes()


def dec_waves(b, T):
    a = np.frombuffer(b, np.uint8).reshape(T, C.NY, C.NX, 3).astype(np.float32)
    none = a[..., 0] == NONE_U8
    h, p, d = a[..., 0] * 0.05, a[..., 1] * 0.1, a[..., 2] * 360 / 256
    for x in (h, p, d):
        x[none] = np.nan
    return h, p, d


# ---------------------------------------------------------------- helpers
def sample(grid2d, lon, lat):
    """Bilinear value of one [NY,NX] field at lon/lat (row 0 = north)."""
    fx = (lon - C.LONS[0]) / C.STEP
    fy = (C.LATS[0] - lat) / C.STEP
    x0, y0 = int(np.floor(fx)), int(np.floor(fy))
    x0, y0 = min(max(x0, 0), C.NX - 2), min(max(y0, 0), C.NY - 2)
    tx, ty = fx - x0, fy - y0
    q = grid2d[y0:y0 + 2, x0:x0 + 2]
    w = np.array([[(1 - tx) * (1 - ty), tx * (1 - ty)], [(1 - tx) * ty, tx * ty]])
    ok = ~np.isnan(q)
    if not ok.any():
        return np.nan
    return float((q[ok] * w[ok]).sum() / w[ok].sum())


def nearest_sea(grid2d, lon, lat, radius=4):
    v = sample(grid2d, lon, lat)
    if not np.isnan(v):
        return v
    cx = int(round((lon - C.LONS[0]) / C.STEP)); cy = int(round((C.LATS[0] - lat) / C.STEP))
    best, bd = np.nan, 1e9
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            y, x = cy + dy, cx + dx
            if 0 <= y < C.NY and 0 <= x < C.NX and not np.isnan(grid2d[y, x]) and dx * dx + dy * dy < bd:
                best, bd = float(grid2d[y, x]), dx * dx + dy * dy
    return best


def wave_value(grid2d, spot):
    """Value at the inshore wave point; if the wave model has nothing there, the offshore point."""
    v = nearest_sea(grid2d, *spot["wave_point"])
    return v if not np.isnan(v) else nearest_sea(grid2d, *spot["point"])


def r1(x, nd=1):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- previous deploy
def load_previous(base_url: str | None):
    if not base_url:
        return None
    try:
        g = lambda p: requests.get(f"{base_url.rstrip('/')}/data/{p}", timeout=60, headers={"User-Agent": C.USER_AGENT})
        r = g("meta.json")
        if r.status_code != 200:
            log("previous: none deployed yet")
            return None
        meta = r.json()
        if meta.get("grid", {}).get("nx") != C.NX or meta.get("grid", {}).get("ny") != C.NY:
            log("previous: grid changed, ignoring")
            return None
        T = meta["hours"]
        t0 = dt.datetime.fromisoformat(meta["t0"])
        times = [t0 + i * H for i in range(T)]
        prev = {"times": times, "meta": meta}
        w = g("wind.bin"); w.raise_for_status(); prev["wind"] = dec_wind(w.content, T)
        try:
            wv = g("waves.bin"); wv.raise_for_status()
            prev["waves"] = dec_waves(wv.content, meta.get("wave_hours", T))
        except Exception:
            prev["waves"] = None
        s = g("spots.json"); s.raise_for_status(); prev["spots"] = s.json()["spots"]
        log(f"previous: {T} hours from {t0.isoformat()}")
        return prev
    except Exception as e:
        log(f"previous: could not load ({e})")
        return None


# ---------------------------------------------------------------- staying polite to the sources
def set_output(key, value):
    """Tell the GitHub workflow something (no-op when run locally)."""
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            f.write(f"{key}={value}\n")


def aemet_run_id():
    """Name of the first file inside AEMET's archive (it carries the run's first valid time).

    Reads only the first few kilobytes of the download and then closes the connection, so the
    check costs almost nothing. The archive's HTTP headers change on every request, so they
    can't tell us whether the run is new."""
    with requests.get(C.AEMET_URL, stream=True, timeout=60, headers={"User-Agent": C.USER_AGENT}) as r:
        r.raise_for_status()
        z = zlib.decompressobj(16 + zlib.MAX_WBITS)
        buf, read = b"", 0
        for chunk in r.iter_content(16384):
            read += len(chunk)
            buf += z.decompress(chunk)
            if len(buf) >= 512 or read > 1_000_000:
                break
    name = buf[:100].split(b"\0", 1)[0].decode("utf-8", "replace").rsplit("/", 1)[-1]
    return name or None


def source_signatures(now, aemet_mod, waves_mod):
    """Cheap checks for whether new runs exist: AEMET's first archive entry, two wave catalogue reads."""
    sig = {}
    try:
        sig["aemet"] = aemet_run_id()
    except Exception as e:
        log(f"aemet check failed ({e})"); sig["aemet"] = None
    for ds in (C.WAVES_BASE, C.WAVES_DETAIL):
        try:
            sig[ds] = waves_mod.latest_file(now, ds)[0]
        except Exception:
            sig[ds] = None
    return sig


def reuse_live(base_url, out):
    """Copy the live data files (used when only our own code changed) and re-derive the spot
    wave values from the live wave grid, so changes to the spot points apply without any API call."""
    out.mkdir(parents=True, exist_ok=True)
    for f in ("meta.json", "wind.bin", "waves.bin", "spots.json", "report.json"):
        r = requests.get(f"{base_url.rstrip('/')}/data/{f}", timeout=60, headers={"User-Agent": C.USER_AGENT})
        r.raise_for_status()
        (out / f).write_bytes(r.content)
    meta = json.loads((out / "meta.json").read_text()); T = meta.get("wave_hours", meta["hours"])
    WH, WP, WD = dec_waves((out / "waves.bin").read_bytes(), T)
    sp = json.loads((out / "spots.json").read_text())
    for sid, s in C.SPOTS.items():
        o = sp["spots"].get(sid)
        if not o:
            continue
        for k in range(T):
            if np.isnan(WH[k]).all():
                continue
            o["wh"][k] = r1(wave_value(WH[k], s), 2)
            o["wp"][k] = r1(wave_value(WP[k], s))
            o["wd"][k] = r1(wave_value(WD[k], s), 0)
    (out / "spots.json").write_text(json.dumps(sp, separators=(",", ":")))


# ---------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data")
    ap.add_argument("--previous", default=None, help="base URL of the live site, to keep earlier hours")
    ap.add_argument("--now", default=None, help="override the clock (ISO, UTC) for testing")
    ap.add_argument("--reuse-only", action="store_true", help="republish the live data without querying any source")
    ap.add_argument("--force", action="store_true", help="fetch even if no source has a new run")
    args = ap.parse_args(argv)

    if args.reuse_only and args.previous:
        try:
            reuse_live(args.previous, Path(args.out)); set_output("changed", "true")
            log("reused the live data; no source was queried"); return 0
        except Exception as e:
            log(f"could not reuse live data ({e}); not fetching anything on a code push")
            set_output("changed", "false")
            return 1

    now = dt.datetime.fromisoformat(args.now) if args.now else dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    madrid = ZoneInfo(C.TIMEZONE)
    t0 = now.astimezone(madrid).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)
    report = {"generated": now.isoformat(), "errors": {}}

    from . import aemet, ecmwf, waves  # noqa: E402  (imported late so --help works without GDAL)

    prev = load_previous(args.previous)
    sig = source_signatures(now, aemet, waves)
    old = (prev or {}).get("meta", {}).get("signatures", {})
    same_day = bool(prev) and prev["times"][0] == t0
    log(f"source check: {sig}\n        live build: {old}")
    if (not args.force and same_day and sig.get("aemet") and all(sig.get(k) and sig.get(k) == old.get(k) for k in sig)):
        log(f"no new runs since the last build ({sig}); nothing fetched, nothing to deploy")
        set_output("changed", "false")
        return 0

    ae = None
    try:
        ae = aemet.fetch(); report["aemet"] = ae.report
        log(f"aemet: {len(ae.times)} hours {ae.times[0]} → {ae.times[-1]}")
    except Exception as e:
        report["errors"]["aemet"] = repr(e); log("aemet FAILED"); traceback.print_exc()

    # AEMET where it reaches (48 h), ECMWF's own forecast beyond it, out to DAYS days.
    horizon = t0 + (C.DAYS * 24 - 1) * H
    ec = None
    try:
        ec = ecmwf.fetch(t0, horizon); report["ecmwf"] = ec.report
        log(f"ecmwf: {len(ec.times)} hours")
    except Exception as e:
        report["errors"]["ecmwf"] = repr(e); log("ecmwf FAILED"); traceback.print_exc()

    ends = [x for x in (ae.times[-1] if ae else None, ec.times[-1] if ec and ec.times else None,
                        prev["times"][-1] if prev else None) if x is not None]
    if not ends:
        log("Nothing to publish: no source answered and there is no previous data.")
        return 1
    end = min(max(ends), horizon)
    T = int((end - t0) / H) + 1
    if T <= 0:
        log("Newest data ends before today; nothing to publish."); return 1
    times = [t0 + i * H for i in range(T)]

    wv = None
    try:
        wv = waves.fetch(now); report["waves"] = wv.report
        log(f"waves: run {wv.run}, {len(wv.times)} hours")
    except Exception as e:
        report["errors"]["waves"] = repr(e); log("waves FAILED"); traceback.print_exc()

    if not ae and not ec and not wv:
        log("All sources failed; keeping the site as it is."); return 1

    idx = lambda ts: {t: i for i, t in enumerate(ts)}
    ae_i = idx(ae.times) if ae else {}
    ec_i = idx(ec.times) if ec else {}
    wv_i = idx(wv.times) if wv else {}
    pv_i = idx(prev["times"]) if prev else {}

    nan = lambda: np.full((T, C.NY, C.NX), np.nan, np.float32)
    U, V, G = nan(), nan(), nan()
    WH, WP, WD = nan(), nan(), nan()
    src_wind, src_wave, model = [], [], []
    prev_model = (prev["meta"].get("model") if prev else None) or (
        ["aemet" if c else None for c in prev["meta"]["coverage"]["wind"]] if prev else [])
    first_ae = ae.times[0] if ae else None
    for k, t in enumerate(times):
        pj = pv_i.get(t)
        prev_has = prev and pj is not None and not np.isnan(prev["wind"][0][pj]).all()
        prev_is_aemet = prev_has and pj < len(prev_model) and prev_model[pj] == "aemet"
        # wind: AEMET speed + ECMWF direction; then earlier AEMET hours from the live build;
        # then ECMWF's own wind (the outlook); then anything the live build had
        if t in ae_i and t in ec_i:
            s = ae.fields["wind_kmh"][ae_i[t]] * C.KMH_TO_KN
            eu, evv = ec.u[ec_i[t]], ec.v[ec_i[t]]
            m = np.hypot(eu, evv); m[m < 1e-6] = np.nan
            U[k], V[k] = s * eu / m, s * evv / m
            G[k] = ae.fields.get("gust_kmh", ae.fields["wind_kmh"])[ae_i[t]] * C.KMH_TO_KN
            src_wind.append("new"); model.append("aemet")
        elif prev_is_aemet and (first_ae is None or t < first_ae):
            U[k], V[k], G[k] = prev["wind"][0][pj], prev["wind"][1][pj], prev["wind"][2][pj]
            src_wind.append("prev"); model.append("aemet")
        elif t in ec_i:
            j = ec_i[t]; U[k], V[k], G[k] = ec.u[j], ec.v[j], ec.gust[j]
            src_wind.append("ecmwf"); model.append("ecmwf")
        elif prev_has:
            U[k], V[k], G[k] = prev["wind"][0][pj], prev["wind"][1][pj], prev["wind"][2][pj]
            src_wind.append("prev"); model.append(prev_model[pj] if pj < len(prev_model) else "aemet")
        else:
            src_wind.append(None); model.append(None)
        # waves
        if wv and t in wv_i:
            j = wv_i[t]; WH[k], WP[k], WD[k] = wv.h[j], wv.period[j], wv.dir_from[j]; src_wave.append("new")
        elif prev and prev.get("waves") and t in pv_i and pv_i[t] < len(prev["waves"][0]) \
                and not np.isnan(prev["waves"][0][pv_i[t]]).all():
            j = pv_i[t]; WH[k], WP[k], WD[k] = (a[j] for a in prev["waves"]); src_wave.append("prev")
        else:
            src_wave.append(None)

    # ------------------------------------------------ per-spot hourly values
    spots_out = {}
    for sid, s in C.SPOTS.items():
        plon, plat = s["point"]; blon, blat = s["beach"]
        o = {k: [] for k in ("kn", "gust", "dir", "temp", "rain", "cloud", "wh", "wp", "wd")}
        pv = prev["spots"].get(sid) if prev else None
        for k, t in enumerate(times):
            j_prev = pv_i.get(t) if pv else None
            take_prev = lambda key: (pv[key][j_prev] if pv and j_prev is not None and j_prev < len(pv[key]) else None)
            if src_wind[k] == "new":
                spd = sample(ae.fields["wind_kmh"][ae_i[t]], plon, plat) * C.KMH_TO_KN
                gst = sample(ae.fields.get("gust_kmh", ae.fields["wind_kmh"])[ae_i[t]], plon, plat) * C.KMH_TO_KN
                d = ec.points[sid]["dir"][ec_i[t]]
                o["kn"].append(r1(spd, 0)); o["gust"].append(r1(max(gst, spd), 0)); o["dir"].append(r1(d, 0))
            elif src_wind[k] == "ecmwf":
                e = ec.points[sid]; j = ec_i[t]
                o["kn"].append(r1(e["kn"][j], 0)); o["gust"].append(r1(max(e["gust"][j], e["kn"][j]) if e["gust"][j] == e["gust"][j] else e["kn"][j], 0))
                o["dir"].append(r1(e["dir"][j], 0))
            else:
                for key in ("kn", "gust", "dir"):
                    o[key].append(take_prev(key))
            if src_wind[k] == "ecmwf":
                e = ec.points[sid]; j = ec_i[t]
                o["temp"].append(r1(e["temp"][j])); o["rain"].append(r1(e["rain"][j])); o["cloud"].append(r1(e["cloud"][j], 0))
            elif ae and t in ae_i:
                f = ae.fields; j = ae_i[t]
                o["temp"].append(r1(sample(f["temp_c"][j], blon, blat)) if "temp_c" in f else None)
                o["rain"].append(r1(sample(f["rain_mm"][j], blon, blat)) if "rain_mm" in f else None)
                o["cloud"].append(r1(sample(f["cloud_pct"][j], blon, blat), 0) if "cloud_pct" in f else None)
            else:
                for key in ("temp", "rain", "cloud"):
                    o[key].append(take_prev(key))
            if src_wave[k] is not None:
                o["wh"].append(r1(wave_value(WH[k], s), 2))
                o["wp"].append(r1(wave_value(WP[k], s)))
                o["wd"].append(r1(wave_value(WD[k], s), 0))
            else:
                for key in ("wh", "wp", "wd"):
                    o[key].append(take_prev(key))
        spots_out[sid] = o

    # ------------------------------------------------ write
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    (out / "wind.bin").write_bytes(enc_wind(U, V, G))
    # waves end long before the ECMWF outlook does: only write the hours that have any
    TW = max((k + 1 for k, x in enumerate(src_wave) if x is not None), default=0)
    (out / "waves.bin").write_bytes(enc_waves(WH[:TW], WP[:TW], WD[:TW]))
    (out / "spots.json").write_text(json.dumps({"t0": t0.isoformat(), "hours": T, "spots": spots_out}, separators=(",", ":")))
    meta = {
        "version": 1,
        "generated": now.isoformat(),
        "t0": t0.isoformat(),
        "hours": T,
        "wave_hours": TW,
        "timezone": C.TIMEZONE,
        "grid": {"lon0": float(C.LONS[0]), "lat0": float(C.LATS[0]), "step": C.STEP, "nx": C.NX, "ny": C.NY,
                 "order": "row 0 = north, west to east"},
        "files": {
            "wind.bin": "[hour][row][col][u, v, gust]: u/v int8 in half knots (toward east/north), -128 = none; gust uint8 knots",
            "waves.bin": "first wave_hours hours only; [hour][row][col][height, period, dir]: uint8 height 0.05 m, period 0.1 s, direction-from 360/256 deg; 255 = land/none",
        },
        "sources": {
            "aemet": {"name": "AEMET HARMONIE-AROME", "first": ae.times[0].isoformat() if ae else None,
                      "last": ae.times[-1].isoformat() if ae else None},
            "ecmwf": {"name": "ECMWF IFS 9 km via Open-Meteo", "ok": bool(ec),
                      "outlook_from": next((times[i].isoformat() for i in range(max((i for i, m in enumerate(model) if m == "aemet"), default=-1) + 1, T) if model[i] == "ecmwf"), None)},
            "waves": {"name": "Puertos del Estado IBI + Strait wave models", "run": wv.run.isoformat() if wv else None},
        },
        "signatures": sig,
        "model": model,
        "coverage": {"wind": [s is not None for s in src_wind], "waves": [s is not None for s in src_wave]},
        "credit": "Forecast data: AEMET, ECMWF (CC BY 4.0), Puertos del Estado. Direction via Open-Meteo.",
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    first = next((i for i, x in enumerate(src_wind) if x), 0)
    report["spot_sample"] = {"from_hour": first, **{sid: {k: v[first:first + 3] for k, v in o.items()}
                                                   for sid, o in spots_out.items() if sid in ("valde", "palmar")}}
    (out / "report.json").write_text(json.dumps(report, indent=1, default=str))
    set_output("changed", "true")
    log(f"wrote {T} hours from {t0.isoformat()} to {out}  "
        f"(wind new {src_wind.count('new')}, ecmwf {src_wind.count('ecmwf')}, prev {src_wind.count('prev')}; waves new {src_wave.count('new')}, prev {src_wave.count('prev')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
