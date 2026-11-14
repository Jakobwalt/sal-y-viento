# The data pipeline

`python -m pipeline.build` fetches the forecasts and writes the four files the website reads into
`site/data/`. It runs on GitHub Actions (see [operations.md](operations.md)), but it is an ordinary
script and runs the same way on a laptop.

- [The area and the grid](#the-area-and-the-grid)
- [The spots](#the-spots)
- [Sources](#sources)
- [How a build runs](#how-a-build-runs)
- [Which source wins for each hour](#which-source-wins-for-each-hour)
- [When the APIs are called](#when-the-apis-are-called)
- [When something fails](#when-something-fails)
- [Command line](#command-line)
- [Module by module](#module-by-module)

## The area and the grid

All gridded data is resampled onto one regular grid, defined in `pipeline/config.py`:

| | |
| --- | --- |
| Longitude | −6.95 to −4.70 (west to east), 46 columns |
| Latitude | 36.95 to 35.45 (**row 0 is the north**), 31 rows |
| Spacing | 0.05°, about 5 km |
| Time | hourly, from **00:00 today, Madrid time**, for up to 10 days (`DAYS = 10`) |

The timeline always starts at local midnight, even though the newest model run starts later in the
day. The hours before the newest run are taken from the data already on the site (see
[below](#which-source-wins-for-each-hour)).

All times in the files are UTC ISO strings. The website converts them to Madrid time for display.

## The spots

`config.SPOTS` lists the eight named spots. Each spot has three points, used for different things:

| Point | Where | Used for |
| --- | --- | --- |
| `beach` | on the beach | temperature, rain, cloud |
| `point` | about 3 km offshore, roughly into the wind | wind, gusts, direction; the tide |
| `wave_point` | 15 % of the way from beach to `point`, about 500 m off (`WAVE_FRACTION`) | waves |

Wave models leave cells close inshore empty. If the wave model has no value at `wave_point`, the
nearest cell with sea within 4 grid cells is used, and failing that the offshore `point`
(`build.wave_value`).

The same coordinates are written into `site/index.html` (the `SP` constant). **Change both together**:
see [frontend.md](frontend.md#adding-or-moving-a-spot).

## Sources

### AEMET HARMONIE-AROME (`aemet.py`): wind, gusts, temperature, rain, cloud

- **What:** Spain's weather service's high-resolution model, 2.5 km, hourly, about 48 hours ahead.
  It is the most accurate wind source for this coast and sets the wind speed for its whole range.
- **How:** AEMET publishes a run as one `.tar.gz` archive of **coloured GeoTIFF images**, one per
  variable per hour (`config.AEMET_URL`, region "PB"). There are no numbers in it, only colours. So
  `aemet.py` maps every pixel back to the nearest colour in AEMET's legend (`LEGENDS`) to recover a
  value:
  - Pixels far from every legend colour (borders, labels) are filled from the nearest good pixel.
  - Transparent pixels mean "nothing": 0 for wind, rain and cloud.
- **Smoothing:** wind and gust colours come in 10 km/h bands. A Gaussian blur of about 5 km turns the
  steps into gradients before sampling onto our grid.
- **Safety check:** if more than 25 % of the pixels don't match any legend colour, the fetch fails on
  purpose. The legend has probably changed, and a silently wrong forecast is worse than an old one.
- **Missing:** AEMET's archive has no wind direction. That comes from ECMWF.

### ECMWF IFS via Open-Meteo (`ecmwf.py`): direction, and the outlook

- **What:** the European global model, 9 km. One Open-Meteo request asks for 84 points: a 0.25° base
  grid, the eight spot points, and six extra points along the Strait where the wind turns fastest
  (`config.ECMWF_POINTS`). The values are interpolated onto our grid (linear, nearest outside the
  hull). Wind is interpolated as u/v components, never as angles, so 350° and 10° blend to north.
- **Used for:**
  - While AEMET covers an hour, **only ECMWF's direction** is used. The u/v vector is rescaled to
    AEMET's speed.
  - After AEMET ends, ECMWF supplies everything: wind, gusts, temperature, rain and cloud. This is
    the "outlook". It is shown fainter on the map and hatched in the tables.

### Puertos del Estado (`waves.py`): waves for the first ~3 days

- **What:** Spain's port authority wave models, served over THREDDS:
  - `wave_regional_ibi` (about 8 km) covers the whole area.
  - `wave_regional_gib` (finer, Strait only) replaces it wherever it has data.
  - Variables: significant height `VHM0`, peak period `VTPK`, mean direction (from) `VMDR`.
- **How:** read the month's catalogue, pick the newest `…-FC.nc` file, ask the subset service (NCSS)
  for our box only, and regrid. Land cells stay empty (NaN), and that defines the sea mask used for
  the other wave source too.
- **Note:** Puertos publishes its runs with a delay of about a day, so its newest run covers only
  around two more days from now. That is why the outlook below exists.

### Météo-France MFWAM via Open-Meteo (`marine.py`): wave outlook and swell trains

- **What:** global wave model, about 8 km, 10 days. Falls back to `ecmwf_wam025` if MFWAM returns
  nothing. One request for the 84 ECMWF points plus the eight spot wave points.
- **Used for:**
  1. **The outlook.** Wave hours that Puertos doesn't cover come from MFWAM, interpolated onto the
     grid and masked with Puertos' sea mask, because interpolation would spill onto land.
  2. **Swell trains for every hour at the named spots.** Open-Meteo gives three trains: wind sea,
     swell, and secondary swell, each with height, period and direction. `marine.split_trains` ranks
     them by energy (H² × T²) and keeps the top two as **primary** and **secondary**. It then scales
     them so that together (√(H₁² + H₂² + …)) they match the total height shown for that hour, which
     may come from Puertos. The scale factor is capped at 2.
- Trains exist only at the eight spot wave points. Places picked on the map show the combined sea.

### Météo-France SMOC via Open-Meteo (`tide.py`): tide

- **What:** hourly sea level relative to mean sea level (`sea_level_height_msl`) at each spot's
  `point`. It includes the tide and the effect of air pressure.
- SMOC is about 8 km. Treat it as a guide to the timing and size of the tide, not a harbour tide
  table.
- The model updates once a day, so it is fetched at most about once a day (`tide.FRESH = 20 h`).

## How a build runs

`build.main()` in order:

1. **Load the live data** from `--previous` (the site URL): `meta.json`, `wind.bin`, `waves.bin`,
   `spots.json`. If the grid size has changed, the live data is ignored.
2. **Cheap checks for new runs** (`source_signatures`), which together cost a few kilobytes:
   - **AEMET:** read the first few KB of the archive and take the name of its first file, which
     carries the run's first valid time. The archive's HTTP headers change on every request, so they
     can't be used.
   - **Puertos:** read the two catalogues and take the newest file name of each.
3. **Stop early if nothing is new.** If these signatures equal the ones stored in the live
   `meta.json`, it is still the same Madrid day, and `--force` isn't set, then:
   - If the tide is older than 20 h, copy the live files and refresh only the tide (one small
     request). Deploy.
   - Otherwise fetch nothing, write nothing, and tell the workflow `changed=false`, so there is no
     deploy.
4. **Fetch AEMET** (full archive, the biggest download) and **ECMWF** (to 10 days).
5. Set the timeline length: from 00:00 today to the latest end among AEMET, ECMWF and the live data,
   capped at 10 days.
6. **Fetch Puertos** and **MFWAM**.
7. **Merge hour by hour** (next section), then work out the per-spot series and swell trains.
8. **Tide** (`tide_fill`): fetch if stale, if `--force` is set, or if more than a day of values is
   missing; otherwise carry over the live values.
9. **Write** `wind.bin`, `waves.bin` (only up to the last hour that has waves), `spots.json`,
   `meta.json` and `report.json`. Tell the workflow `changed=true`.

## Which source wins for each hour

**Wind** (map grid and spots):

| Priority | Source | `meta.model` |
| --- | --- | --- |
| 1 | AEMET speed and gusts + ECMWF direction (new runs) | `aemet` |
| 2 | earlier AEMET hours from the live data (hours before the new AEMET run starts) | `aemet` |
| 3 | ECMWF alone (the outlook) | `ecmwf` |
| 4 | whatever the live data had for that hour | as before |

**Weather** at the spots (temperature, rain, cloud): AEMET at the `beach` point while AEMET covers
the hour, ECMWF in the outlook, otherwise carried over.

**Waves:**

| Priority | Source | `meta.wave_model` |
| --- | --- | --- |
| 1 | Puertos, new run | `pde` |
| 2 | Puertos hours from the live data | `pde` |
| 3 | MFWAM (masked to the sea) | `mf` |
| 4 | any older outlook from the live data | as before |

Spot wave values in MFWAM hours come from MFWAM's value at the spot's own wave point, not from the
grid.

Gusts are never lower than the mean wind (`gust = max(gust, speed)`).

## When the APIs are called

The site is a hobby project that uses free public services. Keep the number of calls low:

| Situation | What is fetched |
| --- | --- |
| Hourly check, no new run anywhere | AEMET first few KB + two catalogue pages. Nothing else. |
| Hourly check, no new run, tide older than 20 h | the above + one tide request |
| Hourly check, a new run somewhere | AEMET archive + 1 ECMWF + 2 Puertos subsets + 1 MFWAM (+ tide if stale) |
| Push of code to `main` | nothing: the live data files are copied (`--reuse-only`) |
| Manual run with "republish" | nothing (same as a push) |
| Manual run with "force" | everything, once |

Open-Meteo counts each location in a multi-point request as a call, and requests with many
variables or many days count a little more. A full build is therefore a few hundred calls (84 + 92 + 8
locations), well within its free daily limit for non-commercial use. Even so, don't add per-visitor or
per-minute fetching, and don't loop over points one request at a time.

## When something fails

- **One source fails:** its error goes into `report.json` → `errors`, and those hours keep the data
  from the live site. The rest of the build goes ahead.
- **AEMET, ECMWF and Puertos all fail:** the script exits with an error and nothing is deployed. The
  site keeps what it has.
- **`--reuse-only` can't read the live data:** it exits with an error instead of fetching. This is
  deliberate: a code push must never trigger API calls.

## Command line

```
python -m pipeline.build --out site/data [--previous URL] [--force] [--reuse-only] [--now ISO]
```

| Flag | Meaning |
| --- | --- |
| `--out` | folder to write into (default `site/data`) |
| `--previous` | base URL of the live site, e.g. `https://jakobwalt.github.io/sal-y-viento`. Without it, every build is a first build: no carried-over hours and no "nothing new" check. |
| `--force` | fetch everything even if no source has a new run |
| `--reuse-only` | copy the live data, query no source (needs `--previous`). Spot wave values are re-derived from the live wave grid, so moving a `wave_point` takes effect without fetching. |
| `--now` | pretend it is this time (UTC ISO), for tests |

Progress is logged to stderr. Under GitHub Actions the script writes `changed=true|false` to
`$GITHUB_OUTPUT`, and the workflow deploys only on `true`.

## Module by module

| File | Main functions | Notes |
| --- | --- | --- |
| `config.py` | constants | grid, spots, ECMWF points, URLs, `DAYS`, unit factors, user agent |
| `build.py` | `main`, `source_signatures`, `reuse_live`, `tide_fill`, `tide_only`, `enc_*`/`dec_*` | orchestration and file formats |
| `aemet.py` | `fetch`, `_decode`, `_to_grid` | colour → value decoding; needs `rasterio` (GDAL) |
| `ecmwf.py` | `fetch` | returns grid u/v/gust plus exact values at the spot points |
| `waves.py` | `fetch`, `latest_file`, `_load`, `_interp` | THREDDS catalogue + NCSS subset; needs `netCDF4` |
| `marine.py` | `fetch`, `split_trains` | MFWAM outlook grid + per-spot values and trains |
| `tide.py` | `fetch` | one request, eight points |

Dependencies are in `pipeline/requirements.txt`: numpy, scipy, rasterio, netCDF4, requests. Python 3.12
on CI; 3.10+ should work. `rasterio` and `netCDF4` ship binary wheels, so no system GDAL is needed.
