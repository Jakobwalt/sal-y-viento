"""Puertos del Estado regional wave model for the Strait (wave_regional_gib).

Finds the newest forecast file in the THREDDS catalogue, asks the subset service (NCSS)
for our box only, and regrids height, peak period and direction onto our grid.
"""
from __future__ import annotations

import re
import datetime as dt
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np
import requests
from netCDF4 import Dataset, num2date
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator

from . import config as C

FC_RE = re.compile(r"HW-(\d{10})-(\d{10})-B(\d{10})-FC\.nc$")
VARS = ("VHM0", "VTPK", "VMDR")


@dataclass
class WaveRun:
    run: dt.datetime
    times: list[dt.datetime]
    h: np.ndarray        # [T, NY, NX] metres, NaN on land
    period: np.ndarray   # [T, NY, NX] seconds
    dir_from: np.ndarray # [T, NY, NX] degrees the waves come from
    report: dict


def _get(url, **kw):
    r = requests.get(url, timeout=kw.pop("timeout", 120), headers={"User-Agent": C.USER_AGENT}, **kw)
    r.raise_for_status()
    return r


def latest_file(now: dt.datetime) -> tuple[str, dt.datetime, int, int]:
    best = None
    for months_back in (0, 1):
        y, m = now.year, now.month - months_back
        if m == 0:
            y, m = y - 1, 12
        try:
            xml = _get(C.WAVES_CATALOG.format(y=y, m=m), timeout=60).text
        except requests.HTTPError:
            continue
        for el in ET.fromstring(xml).iter():
            name = el.attrib.get("name") or el.attrib.get("urlPath", "")
            hit = FC_RE.search(name or "")
            if hit:
                base = dt.datetime.strptime(hit.group(3), "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
                fname = name.rsplit("/", 1)[-1]
                if best is None or base > best[1]:
                    best = (fname, base, y, m)
        if best:
            break
    if not best:
        raise RuntimeError("No wave forecast file found in the Puertos del Estado catalogue")
    return best


def fetch(now: dt.datetime) -> WaveRun:
    name, base, y, m = latest_file(now)
    params = [("var", v) for v in VARS] + [
        ("north", C.LAT_MAX + 0.1), ("south", C.LAT_MIN - 0.1), ("west", C.LON_MIN - 0.1), ("east", C.LON_MAX + 0.1),
        ("horizStride", 1), ("temporal", "all"), ("accept", "netcdf4"),
    ]
    blob = _get(C.WAVES_NCSS.format(y=y, m=m, name=name), params=params, timeout=300).content
    nc = Dataset("waves", memory=blob)
    lat = np.asarray(nc.variables[_find(nc, ("latitude", "lat"))][:], dtype=np.float64)
    lon = np.asarray(nc.variables[_find(nc, ("longitude", "lon"))][:], dtype=np.float64)
    tv = nc.variables[_find(nc, ("time",))]
    times = [d.replace(tzinfo=dt.timezone.utc) if d.tzinfo is None else d
             for d in (dt.datetime(x.year, x.month, x.day, x.hour, x.minute) for x in num2date(tv[:], tv.units))]

    def grid(var):
        a = np.ma.filled(nc.variables[var][:].astype(np.float64), np.nan)   # [T, lat, lon]
        if lat[0] > lat[-1]:
            a_ = a[:, ::-1, :]; la = lat[::-1]
        else:
            a_ = a; la = lat
        return a_, la

    out = {}
    for var in VARS:
        a, la = grid(var)
        T = a.shape[0]
        res = np.empty((T, C.NY, C.NX), np.float32)
        gy, gx = np.meshgrid(C.LATS, C.LONS, indexing="ij")
        for t in range(T):
            f = a[t]
            if var == "VMDR":   # interpolate direction through its sine and cosine
                s = _interp(la, lon, np.sin(np.deg2rad(f)), gy, gx)
                c = _interp(la, lon, np.cos(np.deg2rad(f)), gy, gx)
                res[t] = np.rad2deg(np.arctan2(s, c)) % 360
            else:
                res[t] = _interp(la, lon, f, gy, gx)
        out[var] = res
    nc.close()
    report = {"file": name, "run": base.isoformat(), "hours": len(times),
              "grid": [int(len(lat)), int(len(lon))]}
    return WaveRun(run=base, times=times, h=out["VHM0"], period=out["VTPK"], dir_from=out["VMDR"], report=report)


def _find(nc, names):
    for n in names:
        if n in nc.variables:
            return n
    raise KeyError(f"none of {names} in wave file")


def _interp(la, lo, f, gy, gx):
    """Bilinear where the wave model has sea, NaN elsewhere (land)."""
    sea = ~np.isnan(f)
    filled = f.copy()
    if sea.any() and (~sea).any():
        _, (iy, ix) = ndimage.distance_transform_edt(~sea, return_indices=True)
        filled = f[iy, ix]
    val = RegularGridInterpolator((la, lo), filled, bounds_error=False, fill_value=np.nan)((gy, gx))
    mask = RegularGridInterpolator((la, lo), sea.astype(float), method="nearest", bounds_error=False, fill_value=0)((gy, gx))
    return np.where(mask > 0.5, val, np.nan)
