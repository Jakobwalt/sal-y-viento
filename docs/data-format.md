# Data files

The pipeline writes five files into `site/data/`. The website reads the first four. They are
published at `https://jakobwalt.github.io/sal-y-viento/data/<file>` and are not in git.

| File | Size (typical) | Read by the site | What |
| --- | --- | --- | --- |
| `meta.json` | ~20 KB | yes, first | timeline, grid, which source covers each hour, file layouts |
| `wind.bin` | ~1 MB | yes | wind grid, every hour |
| `waves.bin` | ~1 MB | yes (optional) | wave grid, only the hours that have waves |
| `spots.json` | ~250 KB | yes | hourly series for each named spot |
| `report.json` | small | no | what the last build fetched and what failed (for people) |

**Conventions**

- Hour `k` is `t0 + k hours`. `t0` is 00:00 Madrid time on the day of the build, written in UTC.
  Example: `2026-11-03T23:00:00+00:00` in winter, `…T22:00…` in summer.
- `hours` is the length of the timeline. Every per-hour array in `meta.json` and `spots.json` has
  exactly `hours` entries.
- Missing values are `null` in JSON. In the binaries a special code is used (below).
- Wind direction and wave direction are always the direction **from** which it comes, in degrees
  (0 = from north, 90 = from east).
- Speeds are in **knots**, heights in metres, periods in seconds, temperature in °C, rain in mm per
  hour, cloud in %.

## meta.json

```jsonc
{
  "version": 1,
  "generated": "2026-11-14T17:47:12+00:00",   // when the build ran (UTC)
  "t0": "2026-11-13T23:00:00+00:00",          // hour 0 = 00:00 Madrid
  "hours": 240,                               // timeline length (≤ 240, 10 days)
  "wave_hours": 228,                          // hours in waves.bin (waves end earlier than wind)
  "timezone": "Europe/Madrid",
  "grid": { "lon0": -6.95, "lat0": 36.95, "step": 0.05, "nx": 46, "ny": 31,
            "order": "row 0 = north, west to east" },
  "files": { "wind.bin": "…layout in words…", "waves.bin": "…" },
  "sources": {
    "aemet":  { "name": "AEMET HARMONIE-AROME", "first": "<UTC>", "last": "<UTC>" },   // hours of the newest AEMET run used
    "ecmwf":  { "name": "…", "ok": true,
                "fetched": "<UTC>",             // when ECMWF was last downloaded
                "outlook_from": "<UTC>" },      // first hour where ECMWF alone is used
    "waves":  { "name": "…", "run": "<UTC>",    // Puertos run (base time)
                "outlook": "meteofrance_wave",  // model used for the wave outlook
                "outlook_fetched": "<UTC>",
                "outlook_from": "<UTC>" },      // first hour from MFWAM
    "tide":   { "name": "Météo-France SMOC via Open-Meteo", "fetched": "<UTC>" }
  },
  "signatures": { "aemet": "down_…_32.tif", "wave_regional_ibi": "HW-…-FC.nc", "wave_regional_gib": "…" },
  "model":      ["aemet", "aemet", …, "ecmwf", …],   // wind source per hour (or null)
  "wave_model": ["pde", …, "mf", …, null],           // wave source per hour (or null)
  "coverage":   { "wind": [true, …], "waves": [true, …, false] },
  "credit": "Forecast data: …"
}
```

- `signatures` is what the next build compares against to decide whether anything is new (see
  [pipeline.md](pipeline.md#how-a-build-runs)).
- `model` drives the "outlook" styling on the site: ECMWF hours are faded on the map and hatched in
  the tables.
- `wave_model` drives the source labels in the wave tables.

## wind.bin

The raw bytes of `[hours][ny][nx][3]`, row 0 = north, columns west → east:

| Byte | Type | Meaning |
| --- | --- | --- |
| 0 | int8 | u, wind blowing **toward east**, in **half knots** (value / 2 = kn). −128 = no data |
| 1 | int8 | v, wind blowing **toward north**, in half knots. −128 = no data |
| 2 | uint8 | gust in knots (0 when unknown) |

Mean speed = √(u² + v²). Direction from = atan2(−u, −v) in degrees. The range is ±63.5 kn for u and
v, and 254 kn for gusts.

Offset of a cell: `((hour * ny + row) * nx + col) * 3`. Size check: `hours * ny * nx * 3` bytes. The
site refuses a wind file of the wrong size.

## waves.bin

The same layout, but only the first `wave_hours` hours:

| Byte | Type | Meaning |
| --- | --- | --- |
| 0 | uint8 | significant wave height, steps of 0.05 m. **255 = land / no data** |
| 1 | uint8 | peak period, steps of 0.1 s |
| 2 | uint8 | direction from, 360/256° steps (value × 360 / 256) |

The ranges are 0–12.7 m and 0–25.4 s. Wave hours are always a prefix of the timeline.

Python decoders: `build.dec_wind` and `build.dec_waves`. JavaScript readers: `readWind` and
`readWave` in `index.html`.

## spots.json

```jsonc
{ "t0": "<UTC>", "hours": 240,
  "spots": { "valde": { "kn": [...], "gust": [...], ... }, "palmar": {...}, ... } }
```

Spot ids: `sancti`, `palmar`, `canos`, `zahara`, `bolonia`, `valde`, `lances`, `balneario` (see
`pipeline/config.py`). Each field is an array of `hours` values (or `null`):

| Field | Unit | Measured at | Source |
| --- | --- | --- | --- |
| `kn` | kn, rounded | `point` (≈3 km off) | AEMET (sampled from its grid); ECMWF in the outlook |
| `gust` | kn, rounded, ≥ `kn` | `point` | same |
| `dir` | ° from | `point` | ECMWF |
| `temp` | °C | `beach` | AEMET; ECMWF in the outlook |
| `rain` | mm/h | `beach` | same |
| `cloud` | % | `beach` | same |
| `wh` | m (2 decimals) | `wave_point` (≈500 m off) | Puertos; MFWAM in the outlook |
| `wp` | s (1 decimal) | `wave_point` | peak period, same sources |
| `wd` | ° from | `wave_point` | same |
| `wm` | `"pde"`, `"mf"` or null | — | which model gave `wh/wp/wd` that hour |
| `tide` | m relative to mean sea level | `point` | SMOC |
| `s1h`, `s1p`, `s1d` | m, s, ° from | `wave_point` | primary swell train (MFWAM, scaled to `wh`) |
| `s2h`, `s2p`, `s2d` | m, s, ° from | `wave_point` | secondary train, null when below 0.1 m |

"Primary" means the most energetic train, which can be wind sea rather than swell.

## report.json

For people, not for the site. Shown in the workflow's run summary.

```jsonc
{
  "generated": "<UTC>",
  "errors": { "waves": "HTTPError(...)" },          // empty when everything worked
  "aemet":  { "files": 240, "hours": 48, "colour_miss_share": { "wind_kmh": 0.002, … } },
  "ecmwf":  { "points": 84, "hours": 240, "first": "<UTC>", "last": "<UTC>" },
  "waves":  { "dataset": "wave_regional_ibi", "file": "HW-…-FC.nc", "run": "<UTC>", "hours": 72,
              "grid": [ny, nx], "detail": { …the same for wave_regional_gib… } },
  "marine": { "model": "meteofrance_wave", "hours": 228, "trains": { "wind_wave": n, … } },
  "tide":   { "hours": 240, "values": 1920, "cells": { "valde": [lat, lon], … } },
  "spot_sample": { "from_hour": 7, "valde": { "kn": [..3 hours..], … }, "palmar": {…} }
}
```

- `colour_miss_share` is the share of AEMET pixels that matched no legend colour. Above 0.25 the
  build refuses AEMET (see [pipeline.md](pipeline.md#aemet-harmonie-arome-aemetpy-wind-gusts-temperature-rain-cloud)).
- After a tide-only refresh, `report.json` is copied from the live site unchanged, so it describes
  the last full build.
