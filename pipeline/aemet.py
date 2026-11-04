"""AEMET HARMONIE-AROME: download the latest run and turn its coloured GeoTIFFs into numbers.

AEMET publishes every forecast hour as an RGB image. Each colour stands for a value
on AEMET's own legend, so we map every pixel back to the nearest legend colour.
Legends as decoded by github.com/roman-HG/prediccion-aemet-harmonie-arome.
"""
from __future__ import annotations

import io
import re
import tarfile
import datetime as dt
from dataclasses import dataclass, field

import numpy as np
import requests
import rasterio
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds
from scipy import ndimage

from . import config as C

# code → (name, legend). Legend values are the centre of each colour band.
LEGENDS = {
    "32": ("wind_kmh", {
        "R": [216, 175, 102, 80, 168, 217, 255, 255, 255, 255, 255, 153, 153],
        "G": [250, 249, 246, 249, 244, 242, 201, 138, 105, 89, 120, 102, 51],
        "B": [248, 246, 236, 183, 1, 0, 11, 23, 31, 89, 212, 255, 204],
        "v": [5, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 120]}),
    "228": ("gust_kmh", {
        "R": [217, 176, 102, 79, 168, 217, 255, 255, 255, 255, 255, 153, 153, 171, 190],
        "G": [248, 250, 247, 250, 245, 242, 201, 138, 105, 89, 120, 102, 51, 26, 0],
        "B": [248, 247, 237, 184, 0, 0, 10, 23, 31, 89, 212, 255, 204, 133, 61],
        "v": [5, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125, 135, 140]}),
    "11": ("temp_c", {
        "R": [122, 150, 181, 209, 138, 166, 196, 224, 255, 26, 26, 28, 28, 31, 0, 10, 20, 33, 102, 204, 255, 255, 255, 255, 255, 255, 255, 232, 209, 178, 161, 138],
        "G": [56, 48, 41, 33, 43, 97, 148, 201, 255, 26, 54, 84, 112, 143, 237, 217, 196, 178, 255, 255, 255, 222, 191, 158, 128, 0, 51, 51, 51, 51, 54, 54],
        "B": [140, 140, 140, 143, 227, 232, 240, 247, 255, 112, 148, 184, 219, 255, 237, 214, 191, 171, 102, 0, 0, 0, 0, 0, 0, 0, 178, 145, 112, 79, 46, 15],
        "v": [-27.5, -22.5, -17.5, -12.5, -9, -7, -5, -3, -1, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 44]}),
    "61_1HH": ("rain_mm", {
        "R": [19, 176, 51, 0, 0, 0, 128, 191, 255, 255, 255, 255, 204, 219, 236],
        "G": [49, 224, 245, 204, 178, 153, 204, 230, 255, 186, 122, 61, 84, 141, 200],
        "B": [52, 230, 222, 128, 64, 0, 0, 0, 0, 15, 8, 3, 83, 140, 200],
        "v": [0, 0.75, 1.5, 3.5, 7.5, 15, 25, 35, 50, 70, 90, 110, 150, 215, 275]}),
    "71": ("cloud_pct", {
        "R": [255, 217, 229, 196, 160, 114, 76, 33, 12],
        "G": [255, 217, 235, 214, 196, 169, 141, 115, 41],
        "B": [255, 219, 250, 229, 211, 195, 178, 184, 74],
        "v": [15, 25, 35, 45, 55, 65, 75, 85, 90]}),
}
# Pixels that are fully transparent mean "nothing to show": calm wind, no rain, clear sky.
TRANSPARENT_VALUE = {"wind_kmh": 0.0, "gust_kmh": 0.0, "rain_mm": 0.0, "cloud_pct": 0.0, "temp_c": np.nan}

NAME_RE = re.compile(r"down_(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\+00:00_(\w+?)\.tiff?$")


@dataclass
class AemetRun:
    times: list[dt.datetime]                       # valid times, UTC
    fields: dict[str, np.ndarray]                  # name → [T, NY, NX] on the output grid
    first_valid: dt.datetime | None = None
    report: dict = field(default_factory=dict)


def download(timeout: int = 300) -> bytes:
    r = requests.get(C.AEMET_URL, timeout=timeout, headers={"User-Agent": C.USER_AGENT})
    r.raise_for_status()
    if len(r.content) < 100_000:
        raise RuntimeError(f"AEMET archive suspiciously small: {len(r.content)} bytes")
    return r.content


def _decode(rgba: np.ndarray, legend: dict) -> tuple[np.ndarray, float]:
    """rgba: (bands, y, x) uint8 → values (y, x) and the share of pixels far from any legend colour."""
    pal = np.column_stack([legend["R"], legend["G"], legend["B"]]).astype(np.int16)
    vals = np.asarray(legend["v"], dtype=np.float32)
    px = np.moveaxis(rgba[:3].astype(np.int16), 0, -1)                    # (y, x, 3)
    dist = np.abs(px[..., None, :] - pal).sum(-1)                          # (y, x, n)
    idx = dist.argmin(-1)
    out = vals[idx]
    best = dist.min(-1)
    alpha = rgba[3] if rgba.shape[0] >= 4 else np.full(out.shape, 255, np.uint8)
    opaque = alpha > 0
    far = (best > 45) & opaque
    out = np.where(far, np.nan, out)
    out = np.where(opaque, out, -9999.0)                                   # transparent marker
    miss = float(far.sum()) / max(1, int(opaque.sum()))
    return out, miss


def _to_grid(src: rasterio.DatasetReader, legend: dict, name: str) -> tuple[np.ndarray, float]:
    pad = 0.1
    win = from_bounds(C.LON_MIN - pad, C.LAT_MIN - pad, C.LON_MAX + pad, C.LAT_MAX + pad, src.transform)
    win = win.round_offsets().round_lengths()
    rgba = src.read(window=win, boundless=True, fill_value=0)
    vals, miss = _decode(rgba, legend)
    vals = np.where(vals == -9999.0, TRANSPARENT_VALUE[name], vals)
    # fill colour misses (borders, labels) with the nearest good pixel
    bad = np.isnan(vals)
    if bad.any() and (~bad).any():
        _, (iy, ix) = ndimage.distance_transform_edt(bad, return_indices=True)
        vals = vals[iy, ix]
    # wind and gusts come in 10 km/h colour bands; a ~5 km blur turns the steps into gradients
    if name in ("wind_kmh", "gust_kmh"):
        vals = ndimage.gaussian_filter(vals, sigma=2.0, mode="nearest")
    # sample at our cell centres (bilinear between pixels)
    t = src.window_transform(win)
    cols = (C.LONS[None, :] - t.c) / t.a - 0.5
    rows = (C.LATS[:, None] - t.f) / t.e - 0.5
    rr, cc = np.broadcast_arrays(rows, cols)
    grid = ndimage.map_coordinates(vals, [rr, cc], order=1, mode="nearest")
    return grid.astype(np.float32), miss


def fetch() -> AemetRun:
    blob = download()
    per_time: dict[dt.datetime, dict[str, np.ndarray]] = {}
    misses: dict[str, list[float]] = {}
    names_seen = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for m in tar.getmembers():
            base = m.name.rsplit("/", 1)[-1]
            hit = NAME_RE.search(base)
            if not hit or not m.isfile():
                continue
            names_seen += 1
            code = hit.group(2)
            if code not in LEGENDS:
                continue
            name, legend = LEGENDS[code]
            t = dt.datetime.fromisoformat(hit.group(1)).replace(tzinfo=dt.timezone.utc)
            data = tar.extractfile(m).read()
            with MemoryFile(data) as mf, mf.open() as src:
                grid, miss = _to_grid(src, legend, name)
            per_time.setdefault(t, {})[name] = grid
            misses.setdefault(name, []).append(miss)
    if not per_time:
        raise RuntimeError(f"No usable files in the AEMET archive ({names_seen} matched the name pattern)")
    times = sorted(per_time)
    fields = {}
    for code, (name, _) in LEGENDS.items():
        stack = [per_time[t].get(name) for t in times]
        if all(s is None for s in stack):
            continue
        fields[name] = np.stack([s if s is not None else np.full((C.NY, C.NX), np.nan, np.float32) for s in stack])
    report = {
        "files": names_seen,
        "hours": len(times),
        "colour_miss_share": {k: round(float(np.mean(v)), 4) for k, v in misses.items()},
    }
    worst = max(report["colour_miss_share"].values())
    if worst > 0.25:
        raise RuntimeError(f"AEMET colours no longer match the legend (miss share {worst:.0%}); legend may have changed")
    return AemetRun(times=times, fields=fields, first_valid=times[0], report=report)
