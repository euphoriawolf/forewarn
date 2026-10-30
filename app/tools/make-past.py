# The time machine's data: the 40 past African floods and, for 36 of them, ECMWF's 51-run forecasts
# made 1 to 7 days before the flood day. Floods: ../lagos-flood/data-cache/forewarn/ens-events.json
# (Google Groundsource, news reports placed on a map, CC BY 4.0). Forecasts: evals/ens-daily4.npz
# (evals/modal_pull4.py: ECMWF IFS ENS archive from dynamical.org, CC BY 4.0, 00 UTC runs), the 4 forecast
# squares around each flood blended as the live app blends them. Writes public/past/floods.json.
# Per forecast and run, from the day it was made to 8 days after: `mm` the day's rain, `burst` the
# heaviest 3 hours of that day (both blended), so the replay uses the same rules as the live app.
import json, os
import numpy as np
HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', '..', '..', 'lagos-flood', 'data-cache', 'forewarn', 'ens-events.json')
NPZ = os.path.join(HERE, '..', '..', 'evals', 'ens-daily4.npz')
OUT = os.path.join(HERE, '..', 'public', 'past', 'floods.json')
z = np.load(NPZ)
at = {str(t)[:10]: i for i, t in enumerate(z['inits'])}
W = z['weights']
out = []
for p, e in enumerate(json.load(open(SRC))):
    runs = {}
    for k, v in sorted((e.get('runs') or {}).items()):
        lead, init = int(k[:-1]), v['init'][:10]
        w = W[p][:, None, None]
        mm = (z['mm'][at[init], p].astype(float) * w).sum(0)      # (day, run)
        burst = (z['peak'][at[init], p].astype(float) * w).sum(0)
        runs[str(lead)] = {'init': init, 'mm': [[round(float(x), 1) for x in run] for run in mm.T], 'burst': [[round(float(x), 1) for x in run] for run in burst.T]}
    out.append({'label': e['label'], 'country': e['country'], 'peak': e['peak_day'], 'days': e['days'],
                'lat': e['lat'], 'lon': e['lon'], 'reports': int(e['reports']), 'runs': runs})
json.dump({'source': {'floods': 'Google Groundsource (CC BY 4.0)', 'forecasts': 'ECMWF IFS ENS archive, dynamical.org (CC BY 4.0), 4 squares blended'}, 'floods': out}, open(OUT, 'w'), separators=(',', ':'))
print(len(out), 'floods,', sum(1 for f in out if f['runs']), 'with forecasts ->', os.path.getsize(OUT) // 1024, 'KB')
