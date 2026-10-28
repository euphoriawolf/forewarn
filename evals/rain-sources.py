# Do the rain sources agree? For each past flood, the rain of the 30 days before the flood day from:
#   CHIRPS: station and satellite rain (Climate Hazards Center), the source of the app's "normal";
#   live: Open-Meteo's historical forecast API, the same models the live app reads (api.open-meteo.com);
#   ERA5: the Open-Meteo archive the time machine reads.
# The normal is the app's own (public/normals, CHIRPS 1991 to 2020, 3 x 3 squares). "Soaked" is the app's
# rule: at least 1.5 times normal and at least 100 mm. Reads ../lagos-flood/data-cache/chirps-daily-p25.
# Usage: python3 evals/rain-sources.py   Writes evals/rain-sources.json.
import gzip, io, json, os, statistics, urllib.request, datetime as dt
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CH = os.path.join(HERE, '..', '..', 'lagos-flood', 'data-cache', 'chirps-daily-p25')
NORTH, WEST, CELL = 40, -20, 0.25
norm = np.fromfile(os.path.join(HERE, '..', 'app', 'public', 'normals', 'chirps-1991-2020.bin'), '<u2').reshape(12, 320, 300)
floods = json.load(open(os.path.join(HERE, '..', 'app', 'public', 'past', 'floods.json')))['floods']

def box(a, r, c):
    w = a[r - 1:r + 2, c - 1:c + 2].astype(float); w = w[w >= 0] if a.dtype != np.uint16 else w[w != 65535] / 100
    return float(w.mean()) if w.size else float('nan')

def chirps_day(d, r, c):
    p = f'{CH}/{d.year}/chirps-v2.0.{d:%Y.%m.%d}.tif'
    a = np.array(Image.open(io.BytesIO(gzip.open(p + '.gz').read())) if os.path.exists(p + '.gz') else Image.open(p), dtype=np.float32)
    return box(a, r, c)

def om(url):
    with urllib.request.urlopen(url, timeout=60) as r: return json.load(r)['daily']['precipitation_sum']

rows = []
for f in floods:
    peak = dt.date.fromisoformat(f['peak']); days = [peak - dt.timedelta(days=k) for k in range(30, 0, -1)]
    r, c = int((NORTH - f['lat']) / CELL), int((f['lon'] - WEST) / CELL)
    normal = sum(box(norm[d.month - 1], r, c) for d in days)
    q = f"latitude={f['lat']}&longitude={f['lon']}&start_date={days[0]}&end_date={days[-1]}&daily=precipitation_sum&timezone=GMT"
    try: live = sum(x or 0 for x in om(f'https://historical-forecast-api.open-meteo.com/v1/forecast?{q}'))
    except Exception as e: live = None
    try: era5 = sum(x or 0 for x in om(f'https://archive-api.open-meteo.com/v1/archive?{q}'))
    except Exception: era5 = None
    chirps = sum(chirps_day(d, r, c) for d in days)
    soaked = lambda mm: mm is not None and mm >= 1.5 * normal and mm >= 100
    row = {'flood': f"{f['label']} {f['peak']}", 'normal': round(normal), 'chirps': round(chirps), 'live': None if live is None else round(live), 'era5': None if era5 is None else round(era5),
           'soaked': {'chirps': soaked(chirps), 'live': soaked(live), 'era5': soaked(era5)}}
    rows.append(row)
    print(f"{row['flood'][:34]:34} normal {row['normal']:4}  CHIRPS {row['chirps']:4}  live {row['live']}  ERA5 {row['era5']}  soaked C/L/E {int(row['soaked']['chirps'])}{int(row['soaked']['live'])}{int(row['soaked']['era5'])}", flush=True)

ok = [x for x in rows if x['live'] and x['chirps']]
ratio = statistics.median(x['live'] / x['chirps'] for x in ok)
summary = {'floods': len(rows), 'medianLiveOverChirps': round(ratio, 2), 'medianEra5OverChirps': round(statistics.median(x['era5'] / x['chirps'] for x in ok if x['era5']), 2),
           'soakedByChirps': sum(x['soaked']['chirps'] for x in rows), 'soakedByLive': sum(x['soaked']['live'] for x in rows), 'soakedByEra5': sum(x['soaked']['era5'] for x in rows)}
print(summary)
json.dump({'summary': summary, 'rows': rows}, open(os.path.join(HERE, 'rain-sources.json'), 'w'), indent=1)
