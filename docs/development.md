# Development

## Setup

Python 3.10 or newer (CI uses 3.12):

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt pytest
```

`rasterio` and `netCDF4` install from binary wheels, so no system GDAL or NetCDF is needed. Nothing
is needed for the website except a static file server.

## Getting data without calling the APIs

The website needs `site/data/` (not in git). Copy the live files. This touches only GitHub Pages:

```bash
mkdir -p site/data
for f in meta.json spots.json wind.bin waves.bin report.json; do
  curl -sf -o site/data/$f https://jakobwalt.github.io/sal-y-viento/data/$f
done
python -m http.server -d site 8000      # http://localhost:8000
```

If github.io is blocked where you are, run the **Debug sources** workflow and take the files from
the `snapshot` branch:

```bash
git fetch origin snapshot && git archive origin/snapshot | tar -x -C site/data
```

Or produce data with the pipeline (calls every source once, takes a few minutes):

```bash
python -m pipeline.build --out site/data
```

Use the third route only when you are working on the pipeline itself. The live data is the same
thing and costs the sources nothing.

The site shows the timeline from the data's `t0`. Data from an earlier day still works, but "now"
is pinned to its first or last hour.

## Tests

```bash
python -m pytest tests -q              # ~20 s, no network
```

`tests/test_pipeline.py` runs the real pipeline against fakes of every source (`tests/fakes.py`):
- first build
- a later build that keeps the morning from the live data
- an hour with no new runs (asserts nothing heavy is fetched)
- a stale tide (asserts only the tide is fetched)
- a code push (asserts no source is queried)
- the swell-train split
- the site's spot list matching `config.py`

The same tests run on every push to `main`, and nothing deploys if they fail.

The browser stress test needs Playwright and a running local server with data:

```bash
pip install playwright && python -m playwright install chromium
python -m http.server -d site 8000 &
python tests/ui_smoke.py http://localhost:8000/ 8 1     # url, rounds, seed
```

Each round:
1. Picks a device (desktop, iPhone 13, Pixel 7, iPad Mini).
2. Does 8–22 random actions: open and close spots, beach view, details, the map probe, zoom, drag,
   rotate, play, tap anywhere.
3. Checks that the page recovers fully: back on the map, nothing invisible intercepting taps, zoom
   works, markers aligned, a spot and its details open and close, no script errors.

A seed always replays the same actions, so a failure can be reproduced. It takes a few minutes; run
it before shipping UI changes. It does not run on CI.

## Conventions

- **No build step.** Edit `site/` directly. Keep the scripts as separate files loaded with `?v=dev`;
  the workflow swaps in the commit SHA for cache busting. A new script needs the same `?v=dev`
  suffix to be versioned.
- **Globals in `index.html`, modules in IIFEs.** New features that need the page's state can be a new
  `site/<name>.js` file, like `swell.js` or `probe.js`, loaded after `index.html`'s script.
- **The look.** Use the CSS variables (`--ink`, `--foam`, `--wax`, `--spot`, `--f-display`,
  `--f-mono`), the frosted cream card or spot-coloured blur panels, serif for big numbers and mono
  small caps for labels. Windy's colour scale is used for wind on purpose. Don't imitate Windy's
  shapes (dark flags, pills, sidebars).
- **Units.** Knots, metres, seconds, °C, mm. Directions are always "from". Times are UTC in the data
  and Madrid in the UI.
- **Comments say why, briefly.** Most functions carry a one-line comment; keep it that way.
- **Politeness.** Any new source goes behind the same "only when there's a new run" check and must
  not be queried by `--reuse-only`. See [pipeline.md](pipeline.md#when-the-apis-are-called).

## Before you push

1. `python -m pytest tests -q` passes.
2. For UI changes: look at it on desktop and a phone-sized window, and run `tests/ui_smoke.py`.
3. If you changed spot coordinates: both `pipeline/config.py` and `SP` in `site/index.html`.
4. If your change alters data values: plan a **force** run after the push.
5. After the push, check the run log: `reused the live data; no source was queried`, then
   `Reported success!`.

## Branches

- `main` is the only working branch; it deploys on push.
- `snapshot` is written by the Debug sources workflow and holds data only. Don't work on it.

## Ideas not done yet

- Gridded temperature, rain and cloud, so places picked on the map get a weather row (larger
  `wind.bin`-like file).
- Swell trains on the grid, for the same reason.
- Copernicus IBI waves as a finer outlook than MFWAM (needs a Copernicus Marine account).
- Offshore/onshore indication and swell exposure per spot.
