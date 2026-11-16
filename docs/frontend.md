# The website

Plain HTML, CSS and JavaScript, with no framework, no build step and no dependencies. What is in
`site/` is what gets published. The only external request besides the data is Google Fonts.

| File | Lines | What |
| --- | --- | --- |
| `index.html` | ~1,410 | page markup, all CSS, the map, timeline, spot view, data loading |
| `beach.js` | ~1,330 | the beach view: a painted, live view along the beach at Valdevaqueros |
| `swell.js` | ~230 | the "Wave details" and "Wind details" panels |
| `probe.js` | ~70 | tap anywhere on the map: a pin, then a spot view for that place |
| `nav.js` | ~70 | the address bar and browser history: shareable links, the back button |
| `assets/terrain.jpg` | 360 KB | shaded relief drawn under the map |

`index.html` defines everything as top-level globals (`FC`, `curT`, `N`, `selected`, `layer`, `cam`,
`P`, `tween`, …). The four scripts after it read those globals. Each one keeps its own state inside
an IIFE and exports a few functions on `window` (`openBeach`, `swellOpen`, `probeAt`, …). The load
order matters: `index.html`'s inline script, then `beach.js`, `swell.js`, `probe.js`, `nav.js`.

## What the visitor sees

**Overview map**
- **Wind layer:** the mean wind is a soft colour wash. Streaks drift with the wind and are coloured
  by the gusts. The legend explains both.
- **Waves layer:** wave height as colour plus drawn wave crests. Toggle the layer top left; the
  choice is remembered in `localStorage` (`syv-layer`).
- **Spot labels:** each spot marker carries a small label with the value at the timeline's hour
  (`markLabels()`): mean wind to gusts in knots ("7–13 kn") with a direction arrow, or wave height and period on the
  waves layer. No spot name; the name is in the marker's tooltip and accessible label. The label
  sits at a fixed place below and left of the dot (CSS only, `.mk .lab`), and the bar on its left
  edge is the value's colour on the scale (on the wind map, the mean wind's colour with the gusts'
  colour on top, like the bars). Near Tarifa the labels can overlap at the widest zoom.
- **Navigation:** pan by dragging, zoom with the wheel, a pinch or the +/− buttons.
- **Phones:** the legend is a slim bar with the unit beside it (tap it for the title), and
  "Updated" and "Sources" share one line.
- **Decorations:** towns, landmarks, trees, a ferry, a cargo ship, gulls, a whale, dolphins and tuna
  are decoration. The flags at landmarks stream with the forecast wind.
- **Timeline** (bottom):
  - Hourly, starting at 00:00 today.
  - Three days are shown; **"+ N days"** opens the rest of the ten-day outlook.
  - **Play** animates through the hours.
  - The point where ECMWF takes over from AEMET is marked, and outlook hours say "ECMWF" in the time
    chip.
- **Sources** button: when each source was last updated and where the outlook starts.

**Spot view**: tap a spot marker. The map dives to that spot (circular reveal, close-up map in the
spot's palette), and two tables float over it:
- **Wind:** one row per day, one column per hour. The gust and mean wind figures, a bar, and a
  direction arrow. Every wind bar on the site (this table, Wind details and the beach view's hourly
  strip) is stacked: the mean wind at the bottom in its colour on the Windy scale, the gusts on top
  in the gust's colour, with a thin cream line between.
- **Waves:** height, period and direction, plus the tide's high and low water times and a small tide
  curve per day.
- The first three days are shown. The ECMWF outlook continues below a "ECMWF outlook" label and is
  hatched. The tables open with today in view, starting at the top of a whole day.
- **Phones:** the two tables sit side by side in a sideways scroller. A **Wind | Waves** switch at
  the top of each table jumps between them (swiping still works).
- Tapping a day row moves the map and timeline to that day at the same hour.
- **Wind details** (button in the wind table) and **Wave details** (button in the wave table) each
  expand to the whole spot view and fold the other table into a slim bar; see
  [swell.js](#swelljs-wind-details-and-wave-details).
- **Beach view ↗** appears under the spot name for spots that have a beach scene (currently only
  Valdevaqueros).
- **Back** (top left), Escape or the browser's back button returns to the map; see
  [nav.js](#navjs-links-and-the-back-button).

**Tap anywhere on the map** (overview only): a pin with the wind there, or the waves on the wave
layer, for the timeline's hour. Tapping its card opens a spot view for that place (see
[probe.js](#probejs-tap-anywhere)). A drag pans instead of placing a pin.

## How index.html is organised

The inline script runs top to bottom in sections marked `/* ---------- name ---------- */`:

| Section | What it does |
| --- | --- |
| *(start)* | `GEO` (coastline paths, terrain image box) and `SP` (spot coordinates), both baked in; the projection `P(lon, lat)` |
| geography | land, salt pans, trees and fields drawn into the SVG |
| spots | `SPOTS`: id, name, landmark symbol (`sym`), palette (`pal`); coordinates from `SP` |
| flags, towns, little things | landmark pictures, flags, moving decorations |
| camera | `cam` {x, y, z}, `fit`, `toScreen`/`toWorld`, `applyCam`, `tween`, `flyTo` |
| markers | the spot markers (HTML buttons positioned over the SVG) |
| forecast data | `loadForecast`, `gridSample`, `readWind`/`readWave`, `field`, colour scales |
| wave field | wave colours, distance-inland map, wave crests |
| particles | the wind streaks on the `#wind` canvas |
| spot detail | `fillInfo` (the tables), tide helpers, `buildDetail`, `openSpot`/`closeSpot`/`goBack` |
| timeline | `buildTimeline`, `setTime`, `onTime` (everything that follows the hour), play |
| toggles, sources | layer switch, sources panel |
| pan & zoom | pointer and wheel handling; a tap (not a drag) calls `probeAt` |
| grain, boot | film grain, resize handling, `repairState`, then `loadForecast()` |

**Coordinates.** The map uses its own flat projection, about 1.1 km per unit at this latitude:
`P(lon, lat) = [(lon + 5.8)·cos 36.15°·100, −(lat − 36.15)·100]`. `lonOf`/`latOf` go back. SVG
content is drawn in these units, and the camera sets the SVG `viewBox`.

**Layers, back to front:** `#map` SVG (sea, terrain, land, decorations) → `#detail` SVG (the spot
close-up, revealed with a clip circle) → `#heat` canvas (colour wash) → `#wind` canvas (streaks) →
HTML markers, labels, panels → `#grain`.

**Data loading.** `loadForecast()` fetches `data/meta.json`, then `spots.json`, `wind.bin` and
`waves.bin` in parallel, once, when the page loads (`cache: "no-cache"`, so a reload always gets the
newest build). The page does not poll; visitors get new data when they reload. `FC` then holds:
- `meta`, `g` (grid), `model` (per-hour wind source), `spots`
- typed-array views of the binaries: `wi` (Int8) and `wu` (Uint8) over `wind.bin`, `wv` (Uint8) over
  `waves.bin`

`NOW` is the index of the current hour, and `curT` is the timeline position (fractional while
playing).

**Sampling.** `gridSample(lon, lat, t, readWind | readWave)` is bilinear in space and linear in time,
skipping missing cells. Wave direction is sampled as sin/cos. Everything that shows "the value
here", including the streaks, the wash and the probe, goes through it.

**State and transitions.** `selected` is the open spot or null, `diving` is true during a
transition, and the body classes are `dive`, `ready`, `beach`, `swell`, `dx-waves` and `dx-wind`.
`repairState()` runs every second and puts the page back into a consistent state if a transition was
ever cut short, for example by rapid tapping or a rotation mid-animation.

## Colours

| Scale | Where | Defined in |
| --- | --- | --- |
| Wind | `WINDY` (Windy's scale, converted from m/s to knots) via `windyRGB(kn)`. Wash = mean wind, streaks = gusts lifted towards white, table bars `barCol(kn)` for the mean wind and `barCol(gust)` for the gust part | `index.html`, forecast data |
| Wash opacity | `washA(kn, land)`: light wind lets the map through, full colour from ~22 kn. On land, light wind stays faint and strong wind fills in. "Land" starts 2–5 km inland (`GLF`), so the coast keeps the sea treatment | `index.html` |
| Wave height (map) | `WRAMPW`, same colour family as the wind, steps in metres | `index.html`, wave field |
| Wave bars (tables) | `waveCol`, cool foam → blue → violet | `index.html`, spot detail |
| Wave period pill | `PCOL`, longer period = deeper blue | `swell.js` |
| Wave energy | `ECUT`/`ECOL` buckets | `swell.js` |

The site's own palette is in CSS custom properties at the top of the `<style>`: `--ink`, `--foam`,
`--sea`, `--wax`, fonts `--f-display` (serif), `--f-mono`. Use these for new UI. Panels use a frosted
cream card (`.lgc`, `.pb-card`) or the spot colour (`--spot`) with a blur.

## swell.js: wind details and wave details

One module, two modes (`waves`, `wind`). Opening one:
- adds `body.swell` plus `dx-waves` or `dx-wind`
- fills `#sw` (waves) or `#wx` (wind)
- folds the other table into a bar (`#i-vmini` or `#i-wmini`)
- switches the map layer to match. The previous layer comes back on close.

Each panel has one column per hour from 06:00 to 21:00 for the timeline's day, a drawing on top,
then rows:
- **Wave details:**
  - A drawn wave every 3 hours (desktop only), showing height only.
  - **Primary** swell: height, direction, and period as a coloured pill.
  - **Energy:** ρg²H²T²/16π in kJ per metre of crest, bucketed 0–50, 50, 100 … 950, then 1k, 1.1k …
  - **Secondary** swell.
  - **Tide**, wind in brief, and the source per hour.
- **Wind details:**
  - Stacked wind bars: mean wind at the bottom, gusts on top, each in its own colour.
  - Wind pill, gusts, direction with compass point.
  - Weather: sky icon, °C, rain mm.
  - Tide, waves in brief, and the source (AEMET / ECMWF outlook).

Without swell trains (places picked on the map), the combined sea stands in for the primary swell
and a note says so. Exports: `swellOpen()`, `swellClose(instant)`, `swellFill(spot)`.

## probe.js: tap anywhere

- `probeAt(sx, sy)` is called from the map's tap handler, on the overview only. It places the pin and
  card and reads:
  - **wind:** `gridSample` at that point
  - **waves:** the nearest grid cell with sea within 3 cells, because inshore cells are empty
- The card follows the timeline (`probeFill`) and the camera (`probeMove`). Close it with × or
  Escape.
- **Opening a place.** Tapping the card builds a *custom spot*: hourly arrays sampled from the grids,
  stored as `FC.spots["c<n>"]`. The previous custom spot is removed. It then opens it with
  `requestSpot`.
- **Naming.** Within 1.5 km of a named spot the place takes that spot's name; otherwise its title is
  the coordinates.
- **Tide** is borrowed from the nearest named spot within 15 km, and the subtitle says which.
- **What a picked place doesn't have:** temperature, rain, cloud, swell trains and the beach view.
  These exist only for the named spots, so the weather row and secondary swell are empty, and the
  waves show the combined sea.

## nav.js: links and the back button

The address follows the page, so a view can be shared:

| Address | Opens |
| --- | --- |
| `#valde` | a spot (its id from `SPOTS`) |
| `#valde/beach` | its beach view (ignored for spots without one) |
| `#@36.034,-5.702` | a place picked on the map (lat, lon); ignored outside the grid |
| `…/sat14/15h` | that day of the month and hour, Madrid time; the weekday is only for reading. Left out when it is the current hour |
| `…/waves` | the waves layer; left out for wind |

- **History.** Opening a spot or a beach view by a tap pushes a history entry (`navOpened`,
  `navBeach`); hour and layer changes only rewrite the current entry (`navNote`, once things settle,
  never while playing). The ← button and Escape call `navBack()`: if the page added the entry, it
  goes `history.back()`, otherwise it steps up a level and rewrites the address. So Back never
  leaves the site from inside a spot.
- **Following the address.** On load (`navStart`, after the data) and on `popstate`, the wanted view
  is reached one level at a time by a small loop that waits for each transition (close beach →
  close spot → open spot → open beach), with a 20 s limit. On load the address also sets the hour
  and layer; Back and Forward leave the hour where it is.
- A day that is no longer in the data (an old link) is ignored, and the hour falls back to now.

## beach.js: the beach view

A full-screen canvas scene looking along the beach, drawn every frame from the forecast at the
timeline's hour:
- **Sky:** sun and moon at their real positions (low-precision astronomy at the top of the file),
  plus sky colour, clouds and rain.
- **Wind:** a palm that leans and streams with the forecast wind, a flag, sand and scrub.
- **Sea:** waves from the spot's height, period and direction, with a surfer, a gull and a dog for
  company.
- **On screen:** a 24-hour wind strip and a tide readout. The strip opens at 09–19 and keeps its
  scroll position when an hour is tapped.

Scenes are configured in `SCENES` (currently only `valde`):
- camera bearing and field of view
- the shoreline, scrub line, hills and dune, as fractions of the screen

`beachHas(id)` decides whether the "Beach view" link shows. Exports: `openBeach`, `closeBeach`,
`beachOpen`, `beachBusy`, `beachHas`.

## Common changes

### Adding or moving a spot

1. `pipeline/config.py` → `SPOTS`: id, name, `beach` (lon, lat) and `point` (lon, lat, ~3 km
   offshore). `wave_point` is derived from these.
2. `site/index.html` → `SP`: the same four numbers `[beach lon, beach lat, point lon, point lat]`
   under the same id. Then add `SPOTS`: `{id, name, sym, pal}`, where `sym` is one of the
   `<symbol id="sym-…">` pictures and `pal` is the spot's palette; optional `lm` places the landmark.
3. Push. A code push reuses the live data, so the new spot has no forecast until the next build that
   fetches. To get one immediately, run the workflow with **force** (see
   [operations.md](operations.md)).
4. Optionally add a beach scene in `beach.js` → `SCENES`.

`tests/test_pipeline.py` checks that `config.SPOTS`, `SP` and `SPOTS` agree, so a mismatch fails
the tests.

### Changing a colour scale

Edit `WINDY` / `WRAMPW` in `index.html`. The legend's gradient is painted from the same ramp by
`paintPill("pill-wind", WINDY, [0, 5, 10, 20, 30, 40, 60])`. The labels under it are in the `#lg-wind`
markup (`.lg-tk`) and must list the same values, because they are spaced evenly.

### The map itself

`GEO.coast` and `GEO.detail` (coastline paths in map units), `GEO.box` and `assets/terrain.jpg` were
prepared once when the site was created and are baked into `index.html`. There is no script in the
repo that regenerates them. Edit them only if the coverage area changes. The data grid
(`pipeline/config.py`) would then have to change too.

## Accessibility and devices

- Tested on desktop, iPhone, Pixel and iPad sizes (see `tests/ui_smoke.py`), including rotation
  mid-transition.
- `prefers-reduced-motion` turns off the animations and transitions.
- Spot markers and all controls are buttons with labels. A marker's label includes the value it
  shows. Escape closes, in order: details, beach
  view, spot view.
- iOS page pinch-zoom is suppressed, because the map has its own zoom.
