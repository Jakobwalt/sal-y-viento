"""Tide: hourly sea level at each spot from Météo-France's SMOC model via Open-Meteo's marine API.

Sea level is relative to mean sea level (it includes the tide and the effect of air pressure).
SMOC is about 8 km, so near the coast it is a guide to the timing and size of the tide rather
than a harbour tide table. One request for all spots; the forecast is updated once a day, so the
pipeline asks for it at most about once a day and keeps the previous values otherwise.
"""
from __future__ import annotations

import datetime as dt

import requests

from . import config as C

URL = "https://marine-api.open-meteo.com/v1/marine"
H = dt.timedelta(hours=1)
FRESH = dt.timedelta(hours=20)   # fetch again once the tide we have is older than this


def fetch(start: dt.datetime, end: dt.datetime) -> tuple[dict, dict]:
    """Return ({spot id: [metres or None per hour from start to end]}, report)."""
    ids = list(C.SPOTS)
    pts = [C.SPOTS[s]["point"] for s in ids]
    params = {
        "latitude": ",".join(f"{la:.4f}" for _, la in pts),
        "longitude": ",".join(f"{lo:.4f}" for lo, _ in pts),
        "hourly": "sea_level_height_msl",
        "cell_selection": "sea",
        "timezone": "GMT",
        "start_hour": start.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M"),
        "end_hour": end.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M"),
    }
    r = requests.get(URL, params=params, timeout=90, headers={"User-Agent": C.USER_AGENT})
    r.raise_for_status()
    js = r.json()
    if isinstance(js, dict):
        js = [js]
    T = int((end - start) / H) + 1
    out, cells = {}, {}
    for sid, loc in zip(ids, js):
        h = loc.get("hourly") or {}
        vals = [None] * T
        for ts, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])):
            t = dt.datetime.fromisoformat(ts).replace(tzinfo=dt.timezone.utc)
            k = int((t - start) / H)
            if 0 <= k < T and v is not None:
                vals[k] = round(float(v), 2)
        out[sid] = vals
        cells[sid] = [loc.get("latitude"), loc.get("longitude")]
    have = sum(v is not None for vals in out.values() for v in vals)
    if not have:
        raise RuntimeError("tide: no values returned")
    return out, {"hours": T, "values": have, "cells": cells}
