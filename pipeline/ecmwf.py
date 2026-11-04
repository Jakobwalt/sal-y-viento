"""ECMWF IFS 9 km wind via Open-Meteo, for about 85 points, interpolated onto our grid.

We only take the direction from ECMWF (AEMET's archive has none). Wind is interpolated as
u/v components, never as angles, so 350° and 10° blend to north.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np
import requests
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator

from . import config as C


@dataclass
class EcmwfRun:
    times: list[dt.datetime]
    u: np.ndarray            # [T, NY, NX] knots, toward east
    v: np.ndarray            # [T, NY, NX] knots, toward north
    points: dict             # spot id → {"kn": [T], "dir": [T]} at the exact spot point
    report: dict


def _uv(speed, direction_from):
    rad = np.deg2rad(direction_from)
    return -speed * np.sin(rad), -speed * np.cos(rad)


def fetch(start: dt.datetime, end: dt.datetime) -> EcmwfRun:
    pts = C.ECMWF_POINTS
    params = {
        "latitude": ",".join(f"{la:.4f}" for _, la in pts),
        "longitude": ",".join(f"{lo:.4f}" for lo, _ in pts),
        "hourly": "wind_speed_10m,wind_direction_10m",
        "models": "ecmwf_ifs",
        "wind_speed_unit": "kn",
        "timezone": "GMT",
        "start_hour": start.strftime("%Y-%m-%dT%H:00"),
        "end_hour": end.strftime("%Y-%m-%dT%H:00"),
    }
    r = requests.get(C.OPEN_METEO_URL, params=params, timeout=120, headers={"User-Agent": C.USER_AGENT})
    r.raise_for_status()
    body = r.json()
    if isinstance(body, dict):
        body = [body]
    if len(body) != len(pts):
        raise RuntimeError(f"Open-Meteo returned {len(body)} locations for {len(pts)} requested")
    times = [dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc) for s in body[0]["hourly"]["time"]]
    spd = np.array([b["hourly"]["wind_speed_10m"] for b in body], dtype=np.float64)        # [P, T]
    dirn = np.array([b["hourly"]["wind_direction_10m"] for b in body], dtype=np.float64)
    u, v = _uv(spd, dirn)

    xy = np.array(pts)
    gx, gy = np.meshgrid(C.LONS, C.LATS)
    U = np.empty((len(times), C.NY, C.NX), np.float32)
    V = np.empty_like(U)
    for t in range(len(times)):
        for src, dst in ((u[:, t], U), (v[:, t], V)):
            ok = ~np.isnan(src)
            lin = LinearNDInterpolator(xy[ok], src[ok])(gx, gy)
            near = NearestNDInterpolator(xy[ok], src[ok])(gx, gy)
            dst[t] = np.where(np.isnan(lin), near, lin)

    base = len(pts) - len(C.SPOTS) - 6
    points = {}
    for i, sid in enumerate(C.SPOTS):
        k = base + i
        points[sid] = {"kn": spd[k].tolist(), "dir": dirn[k].tolist()}
    report = {"points": len(pts), "hours": len(times),
              "first": times[0].isoformat() if times else None, "last": times[-1].isoformat() if times else None}
    return EcmwfRun(times=times, u=U, v=V, points=points, report=report)
