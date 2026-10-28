# The time machine's data: the 40 past African floods and, for 36 of them, ECMWF's 51-run forecasts
# made 1 to 7 days before the flood day. Reads ../lagos-flood/data-cache/forewarn/ens-events.json
# (floods: Google Groundsource, news reports geocoded, CC BY 4.0; forecasts: ECMWF IFS ENS archive from
# dynamical.org, CC BY 4.0, the grid square nearest the flood, 00 UTC runs) and writes public/past/floods.json.
# Per run: rain in mm for the day before the flood day, the flood day and the day after (UTC days).
import json, os
HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', '..', '..', 'lagos-flood', 'data-cache', 'forewarn', 'ens-events.json')
OUT = os.path.join(HERE, '..', 'public', 'past', 'floods.json')
out = []
for e in json.load(open(SRC)):
    runs = e.get('runs') or {}
    out.append({
        'label': e['label'], 'country': e['country'], 'peak': e['peak_day'], 'days': e['days'],
        'lat': e['lat'], 'lon': e['lon'], 'reports': int(e['reports']),
        # lead days -> init time and 51 x 3 rain values
        'runs': {k[:-1]: {'init': v['init'][:10], 'mm': [[round(x, 1) for x in m] for m in v['members_mm']]} for k, v in sorted(runs.items())},
    })
json.dump({'source': {'floods': 'Google Groundsource (CC BY 4.0)', 'forecasts': 'ECMWF IFS ENS archive, dynamical.org (CC BY 4.0)'}, 'floods': out}, open(OUT, 'w'), separators=(',', ':'))
print(len(out), 'floods,', sum(1 for f in out if f['runs']), 'with forecasts ->', os.path.getsize(OUT) // 1024, 'KB')
