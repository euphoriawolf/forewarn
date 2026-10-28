# The false-alarm test for the ground reading ("soaked ground floods sooner"). The time machine only
# looks at days that flooded; this looks at every day from 2000 to 2025 at the same places, to see how
# often the ground was soaked with no flood after it.
#
# Soaked: the 30 days before a day brought at least 1.5 times normal and at least 100 mm (the rule in
# app/src/server/rain30.ts). Flood: a Google Groundsource report (news reports placed on a map, CC BY 4.0)
# with its centre within 15 km of the place, starting that day or in the 6 days after.
# Rain: CHIRPS daily, 3 x 3 squares around the place, like the app's normals.
# Reads ../lagos-flood/data-cache (CHIRPS daily, Groundsource) and app/public/past/floods.json.
# Writes evals/false-alarms.json. Usage: python3 evals/false-alarms.py   (needs numpy, Pillow, pandas, pyarrow, shapely)
#
# Caveat: Groundsource counts news coverage, so a flood that no paper wrote about counts as no flood.
import gzip, io, json, os, datetime as dt
import numpy as np, pandas as pd
from PIL import Image
from shapely import from_wkb, centroid, get_x, get_y

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, '..', '..', 'lagos-flood', 'data-cache')
NORTH, WEST, CELL = 40, -20, 0.25
START, END = dt.date(2000, 1, 1), dt.date(2025, 12, 31)

floods = json.load(open(os.path.join(HERE, '..', 'app', 'public', 'past', 'floods.json')))['floods']
# one place per CHIRPS square (Cape Town appears three times)
places = {}
for f in floods:
    r, c = int((NORTH - f['lat']) / CELL), int((f['lon'] - WEST) / CELL)
    places.setdefault((r, c), {'label': f['label'], 'country': f['country'], 'lat': f['lat'], 'lon': f['lon'], 'r': r, 'c': c})
places = list(places.values())

# daily rain, 3 x 3 mean, per place
days = pd.date_range(START - dt.timedelta(days=30), END).date
# the series is kept beside this script (git-ignored) so a second run skips reading 26 years of files
CACHE = os.path.join(HERE, 'false-alarms-rain.npy')
rain = np.load(CACHE) if os.path.exists(CACHE) else np.zeros((len(places), len(days)), np.float32)
for j, d in enumerate([] if os.path.exists(CACHE) else days):
    p = f'{DATA}/chirps-daily-p25/{d.year}/chirps-v2.0.{d:%Y.%m.%d}.tif'
    a = np.array(Image.open(io.BytesIO(gzip.open(p + '.gz').read())) if os.path.exists(p + '.gz') else Image.open(p), dtype=np.float32)
    for i, pl in enumerate(places):
        w = a[pl['r'] - 1:pl['r'] + 2, pl['c'] - 1:pl['c'] + 2]
        rain[i, j] = w[w >= 0].mean() if (w >= 0).any() else np.nan
    if d.day == 1 and d.month == 1: print(d.year, flush=True)

np.save(CACHE, rain)

# normal for each day of the year from the app's own normals file (mean daily rain per month)
norm = np.fromfile(os.path.join(HERE, '..', 'app', 'public', 'normals', 'chirps-1991-2020.bin'), '<u2').reshape(12, 320, 300)
def monthly(pl):
    w = norm[:, pl['r'] - 1:pl['r'] + 2, pl['c'] - 1:pl['c'] + 2].reshape(12, -1).astype(float)
    w[w == 65535] = np.nan
    return np.nanmean(w, 1) / 100

# flood report days near each place
gs = pd.read_parquet(f'{DATA}/groundsource/groundsource_2026.parquet', columns=['geometry', 'start_date'])
gs = gs[(gs.start_date >= str(START)) & (gs.start_date <= str(END))]
cent = centroid(from_wkb(gs.geometry.values))
gx, gy = get_x(cent), get_y(cent)

out, total = [], {'days': 0, 'soaked': 0, 'soakedFlood': 0, 'dryFlood': 0}
for i, pl in enumerate(places):
    km = np.hypot((gx - pl['lon']) * 111 * np.cos(np.radians(pl['lat'])), (gy - pl['lat']) * 111)
    fdays = set(pd.to_datetime(gs.start_date.values[km <= 15]).date)
    m = monthly(pl)
    s30 = pd.Series(rain[i]).rolling(30).sum().shift(1).values  # the 30 days before each day
    n30 = pd.Series([m[d.month - 1] for d in days]).rolling(30).sum().shift(1).values
    rows = []
    for j in range(30, len(days)):
        d = days[j]
        soaked = s30[j] >= 1.5 * n30[j] and s30[j] >= 100
        flood = any(d + dt.timedelta(days=k) in fdays for k in range(7))
        rows.append((soaked, flood))
    a = np.array(rows, bool)
    s, f = a[:, 0], a[:, 1]
    res = {**{k: pl[k] for k in ('label', 'country', 'lat', 'lon')}, 'days': int(len(a)), 'soakedDays': int(s.sum()),
           'floodShareWhenSoaked': round(float(f[s].mean()), 3) if s.any() else None,
           'floodShareOtherwise': round(float(f[~s].mean()), 3), 'reportDays': len(fdays)}
    out.append(res)
    total['days'] += len(a); total['soaked'] += int(s.sum()); total['soakedFlood'] += int((s & f).sum()); total['dryFlood'] += int((~s & f).sum())
    print(f"{pl['label'][:22]:22} soaked {s.mean():5.1%} of days | flood within 7 days: soaked {res['floodShareWhenSoaked']}, otherwise {res['floodShareOtherwise']}", flush=True)

ps = total['soakedFlood'] / max(total['soaked'], 1); po = total['dryFlood'] / max(total['days'] - total['soaked'], 1)
summary = {'places': len(places), 'from': str(START), 'to': str(END), 'soakedShare': round(total['soaked'] / total['days'], 3),
           'floodWithin7DaysWhenSoaked': round(ps, 3), 'floodWithin7DaysOtherwise': round(po, 3), 'lift': round(ps / po, 2) if po else None,
           'falseAlarmShare': round(1 - ps, 3)}
print(summary)
json.dump({'summary': summary, 'places': out, 'rule': 'soaked = 30 days before at least 1.5x normal and at least 100 mm; flood = Groundsource report within 15 km in the next 7 days'}, open(os.path.join(HERE, 'false-alarms.json'), 'w'), indent=1)
