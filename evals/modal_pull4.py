# The richer pull for the rule search (evals/rules.py): every daily ECMWF ensemble forecast since April
# 2024 at the places of the past floods, now for the 4 forecast squares around each place (the live app
# blends these) and with each day's heaviest 3-hour burst as well as its total. Runs on Modal like
# evals/modal_pull.py; only the point values come back.
#
# Writes evals/ens-daily4.npz:
#   inits (n), places (lat, lon), weights (place, 4): the bilinear blend the live app uses
#   mm   (n, place, 4 squares, 9 days, 51 runs): rain per UTC day, the day the forecast was made and 8 after
#   peak (n, place, 4 squares, 9 days, 51 runs): the heaviest 3-hour step that day, in mm
# Usage: modal run evals/modal_pull4.py [--limit 3]
import json, os
import modal

app = modal.App('forewarn-ens-pull4')
image = modal.Image.debian_slim(python_version='3.12').pip_install('dynamical-catalog==1.0.1', 'xarray==2026.9.0', 'zarr==3.4.2', 'icechunk==2.3.1', 'numpy', 'pandas')
HERE = os.path.dirname(os.path.abspath(__file__))
STEP = 0.25


def squares(lat, lon):
    """The 4 grid points around a place and their bilinear weights (as in app/src/server/forecast.ts)."""
    import math
    la0, lo0 = math.floor(lat / STEP) * STEP, math.floor(lon / STEP) * STEP
    fy, fx = (lat - la0) / STEP, (lon - lo0) / STEP
    pts = [(la0, lo0), (la0, lo0 + STEP), (la0 + STEP, lo0), (la0 + STEP, lo0 + STEP)]
    return pts, [(1 - fy) * (1 - fx), (1 - fy) * fx, fy * (1 - fx), fy * fx]


@app.function(image=image, timeout=1800, retries=2, cpu=1.0, memory=3072)
def pull(inits: list[str], places: list[list[float]]):
    import numpy as np, pandas as pd, xarray as xr, dynamical_catalog
    ds = dynamical_catalog.open('ecmwf-ifs-ens-forecast-15-day-0-25-degree', chunks=None)
    p = ds['precipitation_surface']
    leads_h = (pd.to_timedelta(ds.lead_time.values) / pd.Timedelta(hours=1)).astype(int).to_numpy()
    step_h = np.diff(np.concatenate([[0], leads_h]))
    step_s = step_h * 3600
    lat_axis, lon_axis = ds.latitude.values, ds.longitude.values
    li, lj = [], []
    for lat, lon in places:
        for (a, b) in squares(lat, lon)[0]:
            li.append(int(np.abs(lat_axis - a).argmin()))
            lj.append(int(np.abs(lon_axis - (b if lon_axis.min() < 0 else b % 360)).argmin()))
    out_mm, out_pk = [], []
    for init in inits:
        t = pd.Timestamp(init)
        v = p.sel(init_time=t).isel(latitude=xr.DataArray(li, dims='pt'), longitude=xr.DataArray(lj, dims='pt')).values  # (lead, member, pt)
        mm = np.nan_to_num(v) * step_s[:, None, None]
        # the rain of a 3-hour slice: steps longer than 3 hours (after 6 days) are spread evenly over their slices
        per3 = mm / np.maximum(step_h / 3, 1)[:, None, None]
        ends = t + pd.to_timedelta(leads_h, unit='h') - pd.Timedelta(minutes=1)
        day_mm, day_pk = [], []
        for d in range(9):
            m = (ends >= t + pd.Timedelta(days=d)) & (ends < t + pd.Timedelta(days=d + 1))
            day_mm.append(mm[m].sum(axis=0)); day_pk.append(per3[m].max(axis=0) if m.any() else np.zeros(mm.shape[1:]))
        a = np.stack(day_mm).reshape(9, mm.shape[1], len(places), 4).transpose(2, 3, 0, 1)  # (place, square, day, member)
        b = np.stack(day_pk).reshape(9, mm.shape[1], len(places), 4).transpose(2, 3, 0, 1)
        out_mm.append(np.round(a, 1).astype('float16')); out_pk.append(np.round(b, 1).astype('float16'))
    return np.stack(out_mm), np.stack(out_pk)


@app.function(image=image, timeout=600)
def ask_inits() -> list[str]:
    import pandas as pd, dynamical_catalog
    ds = dynamical_catalog.open('ecmwf-ifs-ens-forecast-15-day-0-25-degree', chunks=None)
    return [str(t)[:19] for t in pd.DatetimeIndex(ds.init_time.values)]


@app.local_entrypoint()
def main(limit: int = 0, batch: int = 10):
    import numpy as np
    floods = json.load(open(os.path.join(HERE, '..', 'app', 'public', 'past', 'floods.json')))['floods']
    places = [[f['lat'], f['lon']] for f in floods]
    inits = ask_inits.remote()
    if limit: inits = inits[-limit:]
    parts = list(pull.map([inits[i:i + batch] for i in range(0, len(inits), batch)], kwargs={'places': places}))
    mm = np.concatenate([a for a, _ in parts]); pk = np.concatenate([b for _, b in parts])
    weights = np.array([squares(lat, lon)[1] for lat, lon in places])
    np.savez_compressed(os.path.join(HERE, 'ens-daily4.npz'), inits=np.array(inits), places=np.array(places), weights=weights, mm=mm, peak=pk)
    print(f'{len(inits)} forecasts, {len(places)} places x 4 squares -> evals/ens-daily4.npz {mm.shape}')
