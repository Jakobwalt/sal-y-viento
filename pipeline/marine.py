"""Wave outlook and swell trains: Météo-France MFWAM (global, ~8 km, 10 days) via Open-Meteo's marine API.

Puertos del Estado's models are finer and stay first for the ~3 days they cover. MFWAM then carries
the waves on to the end of the outlook, and gives the swell trains (wind sea, primary and secondary
swell) for every hour, which the Puertos files do not have. One request for about 95 points,
interpolated onto our grid the same way as the ECMWF wind.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np
import requests
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator

from . import config as C

URL = "https://marine-api.open-meteo.com/v1/marine"
MODELS = ("meteofrance_wave", "ecmwf_wam025")      # second one only if the first returns nothing
TRAINS = (("wind_wave", "w"), ("swell_wave", "s1"), ("secondary_swell_wave", "s2"))


@dataclass
class MarineRun:
    model: str
    times: list[dt.datetime]
    h: np.ndarray          # [T, NY, NX] m (NaN where the points say nothing)
    period: np.ndarray     # [T, NY, NX] s
    dir_from: np.ndarray   # [T, NY, NX] degrees
    spots: dict            # spot id → {"wh","wp","wd", "trains": [[(h, p, d) per train] per hour]}
    report: dict


def _points():
    ids = list(C.SPOTS)
    return list(C.ECMWF_POINTS) + [C.SPOTS[s]["wave_point"] for s in ids], ids


def fetch(start: dt.datetime, end: dt.datetime) -> MarineRun:
    pts, ids = _points()
    hourly = ["wave_height", "wave_direction", "wave_peak_period", "wave_period"]
    for k, _ in TRAINS:
        hourly += [f"{k}_height", f"{k}_direction", f"{k}_period"]
    last = None
    for model in MODELS:
        params = {
            "latitude": ",".join(f"{la:.4f}" for _, la in pts),
            "longitude": ",".join(f"{lo:.4f}" for lo, _ in pts),
            "hourly": ",".join(hourly), "models": model, "cell_selection": "sea", "timezone": "GMT",
            "start_hour": start.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:00"),
            "end_hour": end.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:00"),
        }
        try:
            r = requests.get(URL, params=params, timeout=120, headers={"User-Agent": C.USER_AGENT})
            r.raise_for_status()
            body = r.json()
            body = [body] if isinstance(body, dict) else body
            run = _build(model, body, pts, ids)
            if run.times:
                return run
            last = RuntimeError(f"{model}: no wave values")
        except Exception as e:  # try the next model
            last = e
    raise last or RuntimeError("marine: nothing returned")


def _build(model, body, pts, ids) -> MarineRun:
    if len(body) != len(pts):
        raise RuntimeError(f"marine: {len(body)} locations for {len(pts)} requested")
    times = [dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc) for s in body[0]["hourly"]["time"]]
    nT = len(times)
    col = lambda key: np.array([[np.nan if x is None else x for x in b["hourly"].get(key) or [None] * nT] for b in body], dtype=np.float64)
    H, D = col("wave_height"), col("wave_direction")
    P = col("wave_peak_period")
    if np.isnan(P).all():
        P = col("wave_period")
    have = np.where((~np.isnan(H)).sum(0) >= 3)[0]          # the run may end before the end we asked for
    n = int(have[-1]) + 1 if len(have) else 0
    times, H, P, D = times[:n], H[:, :n], P[:, :n], D[:, :n]

    # grid: points of the open sea only (the spot wave points come last and are for the spots)
    base = len(pts) - len(ids)
    xy = np.array(pts[:base])
    gx, gy = np.meshgrid(C.LONS, C.LATS)
    G = {k: np.full((n, C.NY, C.NX), np.nan, np.float32) for k in ("h", "p", "s", "c")}
    rad = np.deg2rad(D[:base])
    for t in range(n):
        for src, key in ((H[:base, t], "h"), (P[:base, t], "p"), (np.sin(rad[:, t]), "s"), (np.cos(rad[:, t]), "c")):
            ok = ~np.isnan(src)
            if ok.sum() < 3:
                continue
            lin = LinearNDInterpolator(xy[ok], src[ok])(gx, gy)
            G[key][t] = np.where(np.isnan(lin), NearestNDInterpolator(xy[ok], src[ok])(gx, gy), lin)
    dir_g = (np.rad2deg(np.arctan2(G["s"], G["c"])) % 360).astype(np.float32)

    trains = {k: (col(f"{k}_height")[:, :n], col(f"{k}_period")[:, :n], col(f"{k}_direction")[:, :n]) for k, _ in TRAINS}
    spots = {}
    for j, sid in enumerate(ids):
        i = base + j
        f = lambda a, t: None if np.isnan(a[i, t]) else float(a[i, t])
        spots[sid] = {
            "wh": [f(H, t) for t in range(n)], "wp": [f(P, t) for t in range(n)], "wd": [f(D, t) for t in range(n)],
            "trains": [[(f(trains[k][0], t), f(trains[k][1], t), f(trains[k][2], t)) for k, _ in TRAINS] for t in range(n)],
        }
    got = {k: int((~np.isnan(trains[k][0])).sum()) for k, _ in TRAINS}
    return MarineRun(model=model, times=times, h=G["h"], period=G["p"], dir_from=dir_g, spots=spots,
                     report={"model": model, "hours": n, "trains": got})


def split_trains(trains, total=None):
    """The two biggest of (wind sea, swell, secondary swell) as primary and secondary; scaled so that
    together they match `total` (Hs² adds up) when a finer model gives the total height."""
    tr = [t for t in trains if t[0] is not None and t[0] >= 0.05]
    tr.sort(key=lambda t: -(t[0] ** 2 * (t[1] or 8) ** 2))      # by energy
    if total is not None and tr:
        s = np.sqrt(sum(t[0] ** 2 for t in tr))
        k = min(2.0, total / s) if s > 0 else 1.0
        tr = [(t[0] * k, t[1], t[2]) for t in tr]
    p = tr[0] if tr else (None, None, None)
    q = tr[1] if len(tr) > 1 and tr[1][0] >= 0.1 else (None, None, None)
    return p, q
