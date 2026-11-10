"""Shared settings: the area we cover, the output grid, the spots and the sources."""
from __future__ import annotations

import numpy as np

# Output grid: cell centres every 0.05° (about 5 km) over the Strait and the Costa de la Luz.
LON_MIN, LON_MAX = -6.95, -4.70
LAT_MIN, LAT_MAX = 35.45, 36.95
STEP = 0.05
LONS = np.round(np.arange(LON_MIN, LON_MAX + STEP / 2, STEP), 4)          # west → east
LATS = np.round(np.arange(LAT_MAX, LAT_MIN - STEP / 2, -STEP), 4)         # north → south (row 0 = north)
NX, NY = len(LONS), len(LATS)

# Each spot: the beach (lon, lat) and its forecast point about 3 km offshore (lon, lat).
SPOTS = {
    "sancti":    {"name": "Sancti Petri",  "beach": (-6.2050, 36.3837), "point": (-6.2374, 36.3715)},
    "palmar":    {"name": "El Palmar",     "beach": (-6.0747, 36.2316), "point": (-6.1004, 36.2144)},
    "canos":     {"name": "Caños de Meca", "beach": (-6.0200, 36.1846), "point": (-6.0340, 36.1571)},
    "zahara":    {"name": "Zahara",        "beach": (-5.8479, 36.1325), "point": (-5.8687, 36.1112)},
    "bolonia":   {"name": "Bolonia",       "beach": (-5.7734, 36.0862), "point": (-5.7758, 36.0539)},
    "valde":     {"name": "Valdevaqueros", "beach": (-5.6967, 36.0662), "point": (-5.7017, 36.0340)},
    "lances":    {"name": "Los Lances",    "beach": (-5.6443, 36.0471), "point": (-5.6622, 36.0264)},
    "balneario": {"name": "Balneario",     "beach": (-5.6163, 36.0192), "point": (-5.6465, 36.0075)},
}

# Waves are read close in: about a seventh of the way from the beach to the wind point (~500 m off).
# Where the wave model has no sea cell that close, the nearest sea cell is used (see build.wave_value).
WAVE_FRACTION = 0.15
for _s in SPOTS.values():
    (_bx, _by), (_px, _py) = _s["beach"], _s["point"]
    _s["wave_point"] = (_bx + (_px - _bx) * WAVE_FRACTION, _by + (_py - _by) * WAVE_FRACTION)

# ECMWF points for wind direction: a 0.25° base grid, every spot point, and a few
# extra points along the Strait where the wind turns fastest. We interpolate between them.
_BASE = [(round(lo, 2), round(la, 2))
         for la in np.arange(LAT_MIN, LAT_MAX + 0.01, 0.25)
         for lo in np.arange(LON_MIN, LON_MAX + 0.01, 0.25)]
_STRAIT = [(-5.85, 35.93), (-5.75, 35.95), (-5.65, 35.97), (-5.55, 35.97), (-5.45, 35.98), (-5.35, 36.00)]
ECMWF_POINTS = _BASE + [s["point"] for s in SPOTS.values()] + _STRAIT

# Sources
AEMET_URL = "https://www.aemet.es/es/api-eltiempo/modelos/download/harmonie/PB"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
WAVES_CATALOG = "https://opendap.puertos.es/thredds/catalog/{ds}/{y:04d}/{m:02d}/catalog.xml"
WAVES_NCSS = "https://opendap.puertos.es/thredds/ncss/grid/{ds}/{y:04d}/{m:02d}/{name}"
# IBI (about 8 km) covers the whole area; the finer Strait model replaces it where it has data.
WAVES_BASE = "wave_regional_ibi"
WAVES_DETAIL = "wave_regional_gib"

TIMEZONE = "Europe/Madrid"
DAYS = 10         # today plus nine days: AEMET where it reaches (48 h), the ECMWF outlook beyond
KMH_TO_KN = 1 / 1.852
USER_AGENT = "sal-y-viento/1.0 (+https://github.com/Jakobwalt/sal-y-viento)"
