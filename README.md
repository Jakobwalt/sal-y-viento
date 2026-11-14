# Sal y Viento

A wind and wave forecast map for the Costa de la Luz and the Strait of Gibraltar, from Sancti Petri to
Tarifa. Live at **https://jakobwalt.github.io/sal-y-viento**.

It has three parts:

- **The map.** An animated map shows wind or waves for any hour of the next ten days, with eight named
  kite and surf spots.
- **Spot views.** Tap a spot to open hourly wind, wave and tide tables, plus panels with more detail.
  Tap anywhere else on the map to see the wind and waves at that point.
- **An hourly job.** A GitHub Actions job checks the forecast providers for new model runs. When one
  appears, it downloads it, cuts out this stretch of coast and republishes the site.

There is no server, no database and no API key. The site is static files on GitHub Pages; the data
files sit next to them and are rebuilt by a Python script.

```
 AEMET HARMONIE ──┐
 ECMWF IFS ───────┤   pipeline/build.py      site/data/            site/index.html
 Puertos (waves) ─┼─▶ (GitHub Actions, ──▶   meta.json      ──▶   + beach.js, swell.js, probe.js
 MFWAM (waves) ───┤    hourly check)         spots.json            (static, GitHub Pages)
 SMOC (tide) ─────┘                          wind.bin, waves.bin
```

## Where the forecast comes from

| What | Source | Range |
| --- | --- | --- |
| Wind speed, gusts, temperature, rain, cloud | AEMET HARMONIE-AROME, 2.5 km | first ~48 h |
| Wind direction (and everything after AEMET ends) | ECMWF IFS 9 km, via Open-Meteo | to 10 days |
| Waves: height, peak period, direction | Puertos del Estado: IBI model + finer Strait model | first ~3 days |
| Wave outlook, primary and secondary swell | Météo-France MFWAM, via Open-Meteo | to 10 days |
| Tide (sea level) | Météo-France SMOC, via Open-Meteo | to 10 days |

Each hour uses the most accurate source that covers it. The site says which one in every table and
in the "Sources" panel. Why it is done this way is explained in [docs/pipeline.md](docs/pipeline.md).

## Repository layout

```
site/                    the website (published as is)
  index.html             page, styles, map, timeline, spot view
  beach.js               the beach view (Valdevaqueros only)
  swell.js               the "Wave details" and "Wind details" panels
  probe.js               tap anywhere on the map: pin, then a spot view for that place
  assets/terrain.jpg     shaded relief under the map
  data/                  written by the pipeline, not in git (see .gitignore)
pipeline/                Python that fetches the sources and writes site/data
  build.py               entry point: decides what to fetch, merges, writes the files
  config.py              area, grid, spots, URLs
  aemet.py, ecmwf.py, waves.py, marine.py, tide.py   one module per source
tests/
  test_pipeline.py       offline tests of the whole pipeline (all sources faked)
  fakes.py               the fake sources
  ui_smoke.py            browser stress test of the site (Playwright)
.github/workflows/
  update.yml             hourly check, build and deploy; also runs on every push to main
  debug-sources.yml      manual: check each source, snapshot the live data
  unstick-pages.yml      manual: cancel a stuck GitHub Pages deployment
docs/                    documentation (start below)
```

## Quick start

```bash
pip install -r pipeline/requirements.txt
python -m pipeline.build --out site/data             # fetches every source once (a few minutes)
python -m http.server -d site 8000                   # open http://localhost:8000
```

To work on the website without calling the forecast APIs at all, copy the live data instead (see
[docs/development.md](docs/development.md#getting-data-without-calling-the-apis)).

## Documentation

| Read this | For |
| --- | --- |
| [docs/pipeline.md](docs/pipeline.md) | how the data is fetched, merged, and when the APIs are called |
| [docs/data-format.md](docs/data-format.md) | every field of `meta.json` and `spots.json`, and the binary grids |
| [docs/frontend.md](docs/frontend.md) | how the website is built, what each part does, colours, how to change things |
| [docs/operations.md](docs/operations.md) | the GitHub workflows, deploying, refreshing, troubleshooting |
| [docs/development.md](docs/development.md) | local setup, tests, conventions, a checklist before pushing |

## Ground rules

- **Be polite to the sources.** The hourly job fetches only when a source has published a new run.
  A push of code changes republishes the live data and fetches nothing. Don't add work that fetches
  more often. Details in [docs/pipeline.md](docs/pipeline.md#when-the-apis-are-called).
- **Keep the look.** The site has its own visual style: cream, ink, grain, serif numbers. New UI
  should match it and should not look like a copy of Windy, even where it borrows Windy's colour
  scale.

## Credits

Forecast data: AEMET; ECMWF (CC BY 4.0); Puertos del Estado; Météo-France (MFWAM, SMOC). ECMWF, MFWAM
and SMOC come via [Open-Meteo](https://open-meteo.com) (CC BY 4.0). The AEMET colour legends were
decoded by
[roman-HG/prediccion-aemet-harmonie-arome](https://github.com/roman-HG/prediccion-aemet-harmonie-arome).
The wind colour scale follows [Windy](https://www.windy.com)'s.
