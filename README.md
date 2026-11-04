# Sal y Viento

A wind and wave map for the Costa de la Luz and the Strait of Gibraltar.

The site in `site/` is plain static files. A GitHub Action (`.github/workflows/update.yml`)
runs four times a day: it downloads the newest forecasts, cuts out our area, and publishes
the site with fresh files in `site/data/`.

## Data

| What | Source |
| --- | --- |
| Wind speed, gusts, temperature, rain, cloud | AEMET HARMONIE-AROME, 2.5 km, hourly, 48 h |
| Wind direction | ECMWF IFS 9 km open data, via Open-Meteo |
| Waves: height, peak period, direction | Puertos del Estado, `wave_regional_gib` |

Forecast data © AEMET, ECMWF (CC BY 4.0) and Puertos del Estado. AEMET colour legends as
decoded by [roman-HG/prediccion-aemet-harmonie-arome](https://github.com/roman-HG/prediccion-aemet-harmonie-arome).

## Run locally

```
pip install -r pipeline/requirements.txt
python -m pipeline.build --out site/data
python -m http.server -d site
```

## Data files

`site/data/meta.json` describes the timeline (hourly from 00:00 Madrid time today), the grid
and the binary layouts of `wind.bin` and `waves.bin`. `spots.json` holds hourly values for each
spot's offshore forecast point. `report.json` explains what each run fetched and anything that failed.
