"""Stand-ins for every source the pipeline talks to, so it can be tested without the network.

`fake_get` replaces `requests.get`: it answers AEMET (a generated archive of coloured GeoTIFFs),
Open-Meteo (ECMWF wind, MFWAM waves, SMOC tide), Puertos del Estado (catalogue + a NetCDF
subset) and the live site (whatever is in DEPLOYED, else 404). Every URL asked for is logged
in CALLS. The values are simple patterns, not realistic weather.
"""
import io, json, tarfile, datetime as dt, tempfile
import numpy as np
import rasterio
from rasterio.transform import from_origin
from netCDF4 import Dataset

from pipeline import aemet

RUN = dt.datetime(2026, 11, 4, 6, tzinfo=dt.timezone.utc)
NOW = dt.datetime(2026, 11, 4, 10, 30, tzinfo=dt.timezone.utc)


def rgb_for(code, value_field):
    leg = aemet.LEGENDS[code][1]; vals = np.array(leg["v"], float)
    idx = np.abs(value_field[..., None] - vals).argmin(-1)
    pal = np.column_stack([leg["R"], leg["G"], leg["B"]]).astype(np.uint8)
    rgb = pal[idx]                                    # (y, x, 3)
    a = np.full(value_field.shape, 255, np.uint8)
    return np.concatenate([np.moveaxis(rgb, -1, 0), a[None]], 0)


def fake_archive(run):
    # PB-like grid at 0.025°, covering -10..5 E, 34..44.5 N
    res = 0.025; west, north = -10.0, 44.5; nx, ny = int(15 / res), int(10.5 / res)
    tr = from_origin(west, north, res, res)
    lon = west + (np.arange(nx) + .5) * res; lat = north - (np.arange(ny) + .5) * res
    LO, LA = np.meshgrid(lon, lat)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for h in range(1, 49):
            t = run + dt.timedelta(hours=h)
            strait = np.exp(-((LA - 35.97) / 0.12) ** 2) * (LO > -5.9) * (LO < -5.3)
            fields = {"32": 15 + 45 * strait + 5 * np.sin(h / 6), "228": 25 + 60 * strait,
                      "11": 18 + 4 * np.sin((h - 6) / 24 * 2 * np.pi) + 0 * LO, "61_1HH": np.where(h > 40, 1.5, 0) + 0 * LO,
                      "71": 30 + 0 * LO}
            for code, f in fields.items():
                data = rgb_for(code, f)
                if code == "32":  # sprinkle some foreign colours (coastline drawn in black)
                    data[:3, ::97, :] = 0
                with tempfile.NamedTemporaryFile(suffix=".tif") as tmp:
                    with rasterio.open(tmp.name, "w", driver="GTiff", width=nx, height=ny, count=4, dtype="uint8",
                                       crs="EPSG:4326", transform=tr) as dst:
                        dst.write(data)
                    b = open(tmp.name, "rb").read()
                name = f"down_{t.strftime('%Y-%m-%dT%H:%M:%S')}+00:00_{code}.tif"
                ti = tarfile.TarInfo(name); ti.size = len(b); tar.addfile(ti, io.BytesIO(b))
    return buf.getvalue()


def fake_openmeteo(params):
    lats = [float(x) for x in params["latitude"].split(",")]
    start = dt.datetime.fromisoformat(params["start_hour"]); end = dt.datetime.fromisoformat(params["end_hour"])
    n = int((end - start).total_seconds() // 3600) + 1
    times = [(start + dt.timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n)]
    out = []
    cut = n - 30   # the run stops short of what we asked for
    nn = lambda v: [v] * cut + [None] * (n - cut)
    for la in lats:
        out.append({"latitude": la, "hourly": {"time": times, "wind_speed_10m": nn(20.0),
                                               "wind_direction_10m": [90.0 + (la - 36) * 20] * n,
                                               "wind_gusts_10m": [27.0] * n, "temperature_2m": [17.5] * n,
                                               "precipitation": [0.2] * n, "cloud_cover": [40] * n}})
    return out


def fake_marine(params):
    import math
    lats = [float(x) for x in params["latitude"].split(",")]
    start = dt.datetime.fromisoformat(params["start_hour"]); end = dt.datetime.fromisoformat(params["end_hour"])
    n = int((end - start).total_seconds() // 3600) + 1
    times = [(start + dt.timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n)]
    if "wave_height" in params["hourly"]:
        def loc(j, la):
            h = {"time": times}
            g = lambda f: [None if i >= 228 else round(f(i), 2) for i in range(n)]
            h["wave_height"] = g(lambda i: 1.2 + 0.6*math.sin(i/20 + j/9)); h["wave_direction"] = g(lambda i: 270 + 10*math.sin(i/30))
            h["wave_peak_period"] = g(lambda i: 11 + 2*math.sin(i/40)); h["wave_period"] = g(lambda i: 9.0)
            h["wind_wave_height"] = g(lambda i: 0.4 + 0.3*math.sin(i/7)); h["wind_wave_period"] = g(lambda i: 4.5); h["wind_wave_direction"] = g(lambda i: 90)
            h["swell_wave_height"] = g(lambda i: 1.0 + 0.5*math.sin(i/20)); h["swell_wave_period"] = g(lambda i: 12); h["swell_wave_direction"] = g(lambda i: 275)
            h["secondary_swell_wave_height"] = g(lambda i: 0.3); h["secondary_swell_wave_period"] = g(lambda i: 15); h["secondary_swell_wave_direction"] = g(lambda i: 250)
            return {"latitude": la, "longitude": -5.7, "hourly": h}
        return [loc(j, la) for j, la in enumerate(lats)]
    return [{"latitude": la, "longitude": -5.7, "hourly": {"time": times, "sea_level_height_msl": [round(math.cos(2*math.pi*i/12.42), 2) if i < 230 else None for i in range(n)]}} for la in lats]


def fake_netcdf():
    lat = np.arange(35.3, 37.1, 0.02); lon = np.arange(-7.1, -4.5, 0.02)
    T = 72
    with tempfile.NamedTemporaryFile(suffix=".nc") as tmp:
        nc = Dataset(tmp.name, "w")
        nc.createDimension("time", T); nc.createDimension("latitude", len(lat)); nc.createDimension("longitude", len(lon))
        tv = nc.createVariable("time", "f8", ("time",)); tv.units = "hours since 1950-01-01 00:00:00"
        base = (RUN.replace(tzinfo=None) - dt.datetime(1950, 1, 1)).total_seconds() / 3600
        tv[:] = base + 1 + np.arange(T)
        nc.createVariable("latitude", "f4", ("latitude",))[:] = lat
        nc.createVariable("longitude", "f4", ("longitude",))[:] = lon
        LO, LA = np.meshgrid(lon, lat)
        land = (LA > 36.0 + (LO + 6.0) * -0.3) & (LO > -6.3)
        for v, val in (("VHM0", 1.4), ("VTPK", 9.0), ("VMDR", 265.0)):
            x = nc.createVariable(v, "f4", ("time", "latitude", "longitude"), fill_value=-999.0)
            a = np.full((T, len(lat), len(lon)), val, np.float32); a[:, land] = -999.0
            x[:] = np.ma.masked_equal(a, -999.0)
        nc.close()
        return open(tmp.name, "rb").read()


CATALOG = """<?xml version="1.0"?><catalog xmlns="http://www.unidata.ucar.edu/namespaces/thredds/InvCatalog/v1.0">
<dataset name="wave_regional_gib/2026/11"><dataset name="HW-2026110312-2026110611-B2026110312-FC.nc" urlPath="wave_regional_gib/2026/11/HW-2026110312-2026110611-B2026110312-FC.nc"/>
<dataset name="HW-2026110401-2026110700-B2026110400-FC.nc" urlPath="wave_regional_gib/2026/11/HW-2026110401-2026110700-B2026110400-FC.nc"/>
<dataset name="HW-20261103-HC.nc"/></dataset></catalog>"""


class Resp:
    def __init__(self, content=b"", js=None, status=200):
        self.content = content; self._js = js; self.status_code = status
        self.text = content.decode("utf-8", "replace") if isinstance(content, bytes) else content
    def json(self): return self._js
    def iter_content(self, n):
        for i in range(0, len(self.content), n): yield self.content[i:i+n]
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def raise_for_status(self):
        if self.status_code >= 400:
            import requests; raise requests.HTTPError(str(self.status_code))


NC = fake_netcdf()
ARCHIVE = fake_archive(RUN)
DEPLOYED = {}      # file name → bytes "on the live site"
CALLS = []         # every URL requested, without its query


def new_aemet_run(run):
    """Pretend AEMET has published a run starting at `run`."""
    global ARCHIVE
    ARCHIVE = fake_archive(run)


def deploy(folder):
    """Make the files a build wrote the "live" ones."""
    import os
    for f in ("meta.json", "wind.bin", "waves.bin", "spots.json", "report.json"):
        path = os.path.join(folder, f)
        if os.path.exists(path):
            DEPLOYED[f] = open(path, "rb").read()


def fake_get(url, params=None, **kw):
    CALLS.append(url.split("?")[0])
    if "aemet.es" in url: return Resp(ARCHIVE)
    if "marine-api.open-meteo" in url: return Resp(js=fake_marine(params))
    if "open-meteo" in url: return Resp(js=fake_openmeteo(params))
    if "catalog.xml" in url: return Resp(CATALOG.encode())
    if "/ncss/grid/" in url:
        assert "B2026110400" in url, url
        return Resp(NC)
    if "github.io" in url:
        name = url.rsplit("/", 1)[-1]
        if name in DEPLOYED: return Resp(DEPLOYED[name], js=json.loads(DEPLOYED[name]) if name.endswith(".json") else None)
        return Resp(b"", status=404)
    raise AssertionError(url)


