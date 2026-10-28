# Every daily ECMWF ensemble forecast since April 2024, at the places of the past floods, for the
# rule test (evals/rules.py). It runs on Modal, so the archive's 8-degree blocks (about 46 GB in all)
# are read in a data centre, and only the point values come back (a few MB).
#
# For each 00 UTC forecast and each place: every member's rain in mm per UTC day, for the day the
# forecast was made and the 7 days after (the same conversion as ens-events.json, from the archive's
# mean rate per step). Source: ECMWF IFS ENS archive, dynamical.org (CC BY 4.0).
#
# Usage:  modal run evals/modal_pull.py                 (all forecasts)
#         modal run evals/modal_pull.py --limit 3       (the last 3 forecasts, a test)
#         modal run evals/modal_pull.py --only 2025-02-20 --out test.npz   (chosen days)
# Writes evals/ens-daily.npz: inits (n), places (lat, lon), mm (n, places, 8 days, 51 members).
import json, os
import modal

app = modal.App('forewarn-ens-pull')
image = modal.Image.debian_slim(python_version='3.12').pip_install('dynamical-catalog==1.0.1', 'xarray==2026.9.0', 'zarr==3.4.2', 'icechunk==2.3.1', 'numpy', 'pandas')
HERE = os.path.dirname(os.path.abspath(__file__))


@app.function(image=image, timeout=1800, retries=2, cpu=1.0, memory=2048)
def pull(inits: list[str], places: list[list[float]]):
    import numpy as np, pandas as pd, dynamical_catalog
    ds = dynamical_catalog.open('ecmwf-ifs-ens-forecast-15-day-0-25-degree', chunks=None)
    p = ds['precipitation_surface']
    leads_h = (pd.to_timedelta(ds.lead_time.values) / pd.Timedelta(hours=1)).astype(int).to_numpy()  # whatever unit the archive stores
    step_s = np.diff(np.concatenate([[0], leads_h])) * 3600  # each value is the mean rate since the previous step
    lats = xr_index(ds.latitude.values, [pl[0] for pl in places])
    lon_axis = ds.longitude.values  # -180..180 or 0..360: match the place to the archive's own axis
    lons = xr_index(lon_axis, [pl[1] if lon_axis.min() < 0 else pl[1] % 360 for pl in places])
    out = []
    for init in inits:
        t = pd.Timestamp(init)
        # one read per forecast: all places at once (the archive fetches each block once)
        v = p.sel(init_time=t).isel(latitude=xr_dim(lats), longitude=xr_dim(lons)).values  # (lead, member, place)
        mm = np.nan_to_num(v) * step_s[:, None, None]
        ends = t + pd.to_timedelta(leads_h, unit='h') - pd.Timedelta(minutes=1)
        days = np.stack([mm[(ends >= t + pd.Timedelta(days=d)) & (ends < t + pd.Timedelta(days=d + 1))].sum(axis=0) for d in range(8)])  # (day, member, place)
        out.append(np.round(days.transpose(2, 0, 1), 1).astype('float32'))  # (place, day, member)
    return np.stack(out)


def xr_index(axis, values):
    import numpy as np
    return [int(np.abs(axis - v).argmin()) for v in values]


def xr_dim(idx):
    import xarray as xr
    return xr.DataArray(idx, dims='place')


@app.local_entrypoint()
def main(limit: int = 0, batch: int = 20, only: str = '', out: str = 'ens-daily.npz'):
    import numpy as np
    floods = json.load(open(os.path.join(HERE, '..', 'app', 'public', 'past', 'floods.json')))['floods']
    # one place per flood (repeats kept: the same place can flood twice)
    places = [[f['lat'], f['lon']] for f in floods]
    inits = ask_inits.remote()
    if only: inits = [i for i in inits if i[:10] in only.split(',')]
    if limit: inits = inits[-limit:]
    chunks = [inits[i:i + batch] for i in range(0, len(inits), batch)]
    parts = list(pull.map(chunks, kwargs={'places': places}))
    mm = np.concatenate(parts)
    np.savez_compressed(os.path.join(HERE, out), inits=np.array(inits), places=np.array([[f['lat'], f['lon']] for f in floods]), mm=mm)
    print(f'{len(inits)} forecasts, {len(places)} places -> evals/{out} {mm.shape}')


@app.function(image=image, timeout=600)
def ask_inits() -> list[str]:
    import pandas as pd, dynamical_catalog
    ds = dynamical_catalog.open('ecmwf-ifs-ens-forecast-15-day-0-25-degree', chunks=None)
    return [str(t)[:19] for t in pd.DatetimeIndex(ds.init_time.values)]
