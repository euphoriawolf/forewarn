# The time machine's data: the 40 past African floods and, for 36 of them, ECMWF's 51-run forecasts
# made 1 to 7 days before the flood day. Floods: ../lagos-flood/data-cache/forewarn/ens-events.json
# (Google Groundsource, news reports placed on a map, CC BY 4.0). Forecasts: evals/ens-floods.npz
# (evals/modal_pull.py --ndays 9: ECMWF IFS ENS archive from dynamical.org, CC BY 4.0, the grid square
# nearest the flood, 00 UTC runs). Writes public/past/floods.json.
# Per forecast: each run's rain in mm per UTC day, from the day it was made to 8 days after, so the
# 3-day totals around the flood day can be added up.
import json, os
import numpy as np
HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', '..', '..', 'lagos-flood', 'data-cache', 'forewarn', 'ens-events.json')
NPZ = os.path.join(HERE, '..', '..', 'evals', 'ens-floods.npz')
OUT = os.path.join(HERE, '..', 'public', 'past', 'floods.json')
z = np.load(NPZ)
at = {str(t)[:10]: i for i, t in enumerate(z['inits'])}
out = []
for p, e in enumerate(json.load(open(SRC))):
    runs = {}
    for k, v in sorted((e.get('runs') or {}).items()):
        lead, init = int(k[:-1]), v['init'][:10]
        mm = z['mm'][at[init], p]  # (day, run)
        # the same numbers as the 3-day file for the day before, the flood day and the day after
        assert np.allclose(mm[lead - 1:lead + 2].T, v['members_mm'], atol=0.06), (e['label'], k)
        runs[str(lead)] = {'init': init, 'mm': [[round(float(x), 1) for x in run] for run in mm.T]}
    out.append({'label': e['label'], 'country': e['country'], 'peak': e['peak_day'], 'days': e['days'],
                'lat': e['lat'], 'lon': e['lon'], 'reports': int(e['reports']), 'runs': runs})
json.dump({'source': {'floods': 'Google Groundsource (CC BY 4.0)', 'forecasts': 'ECMWF IFS ENS archive, dynamical.org (CC BY 4.0)'}, 'floods': out}, open(OUT, 'w'), separators=(',', ':'))
print(len(out), 'floods,', sum(1 for f in out if f['runs']), 'with forecasts ->', os.path.getsize(OUT) // 1024, 'KB')
