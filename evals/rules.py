# Which alert rule is best? Each candidate is scored on two numbers:
#   hits: of the past floods, how many got an alert 1 to 7 days before (for the day before, the flood day
#         or the day after, as in the time machine), and how many 3 days or more before;
#   false alarms: alert spells per place per year with no flood report within a day of them.
# Parameters are chosen on half the floods (train) and the result is checked on the other half (test),
# so a rule is not fitted to the 36.
#
# Data: evals/ens-daily.npz (evals/modal_pull.py: every daily ECMWF ensemble forecast since April 2024,
# nearest square), evals/lines.json (each flood's line, from /api/past), Google Groundsource reports
# (CC BY 4.0) within 15 km for "did it flood". Groundsource ends on 3 Feb 2026, so false alarms are
# counted from April 2024 to January 2026.
# Usage: python3 evals/rules.py   (needs numpy, pandas, pyarrow, shapely). Writes evals/rules.json.
import json, os, datetime as dt
import numpy as np, pandas as pd
from shapely import from_wkb, centroid, get_x, get_y

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, '..', '..', 'lagos-flood', 'data-cache')
z = np.load(os.path.join(HERE, 'ens-daily.npz'))
inits = pd.to_datetime(z['inits']).normalize()
MM = z['mm']  # (init, place, day 0..7, member)
floods = json.load(open(os.path.join(HERE, '..', 'app', 'public', 'past', 'floods.json')))['floods']
lines = {int(k): v for k, v in json.load(open(os.path.join(HERE, 'lines.json'))).items()}
END = pd.Timestamp('2026-01-31')
ix = {t: i for i, t in enumerate(inits)}

# the floods with a forecast, alternately train and test in date order
tested = sorted([i for i, f in enumerate(floods) if f['runs']], key=lambda i: floods[i]['peak'])
train, test = tested[0::2], tested[1::2]

# one place per forecast square for false alarms (Cape Town floods three times, at one square)
cells, places = {}, []
for i, f in enumerate(floods):
    key = (round(f['lat'] * 4), round(f['lon'] * 4))
    if key not in cells: cells[key] = i; places.append(i)

# flood report days near each place
gs = pd.read_parquet(f'{DATA}/groundsource/groundsource_2026.parquet', columns=['geometry', 'start_date'])
gs = gs[gs.start_date >= '2024-03-01']
cent = centroid(from_wkb(gs.geometry.values)); gx, gy = get_x(cent), get_y(cent)
reports = {}
for i in places:
    f = floods[i]
    km = np.hypot((gx - f['lon']) * 111 * np.cos(np.radians(f['lat'])), (gy - f['lat']) * 111)
    reports[i] = set(pd.to_datetime(gs.start_date.values[km <= 15]).normalize())

# per place, each lead's daily rain for the "model climate" (rule 4): the place's own rain distribution
def runs(place, init_i, day):  # the 51 runs' rain for that day
    return MM[init_i, place, day]

def fires(rule, place, init_i, day):
    """Does `rule` warn, in the forecast made on inits[init_i], about the day `day` days ahead?"""
    kind, a, b = rule
    line = lines.get(place) or 30
    if kind == 'day':            # today's rule: share of runs with a day over the line
        return (runs(place, init_i, day) >= line * a).mean() >= b
    if kind == 'sum3':           # 3 days of rain ending that day over a mm
        lo = max(day - 2, 0)
        return (MM[init_i, place, lo:day + 1].sum(0) >= a).mean() >= b
    if kind == 'or':             # the app's rule from 28 Oct: one day over the line, or 3 days over a mm (b of runs either way)
        return fires(('day', 1.0, b), place, init_i, day) or fires(('sum3', a, b), place, init_i, day)
    if kind == 'clim':           # over this place's own top a% of forecast days
        return (runs(place, init_i, day) >= CLIM[place][a]).mean() >= b
    raise ValueError(kind)

# the model climate: each place's percentiles of forecast daily rain, from every run, lead and day
CLIM = {}
for i in range(len(floods)):
    v = MM[:, i, 1:8, :].ravel()
    CLIM[i] = {p: float(np.percentile(v, 100 - p)) for p in (0.5, 1, 2, 3)}

def hits(rule, group):
    got, early = 0, 0
    for i in group:
        f = floods[i]; peak = pd.Timestamp(f['peak'])
        first = 0
        for lead in range(7, 0, -1):
            t = peak - pd.Timedelta(days=lead)
            if t not in ix: continue
            if any(fires(rule, i, ix[t], d) for d in (lead - 1, lead, lead + 1) if 0 <= d <= 7):
                first = lead; break
        got += first > 0; early += first >= 3
    return got, early

def false_alarms(rule):
    """Alert spells per place per year with no flood report within a day of them."""
    spells, years = 0, 0
    for i in places:
        warned = set()
        for k, t in enumerate(inits):
            if t > END: break
            for d in range(1, 8):
                if fires(rule, i, k, d): warned.add(t + pd.Timedelta(days=d))
        days = sorted(x for x in warned if x <= END)
        # consecutive warned days are one spell (one alert, as the Watch agent does not repeat a warned day)
        groups, cur = [], []
        for x in days:
            if cur and (x - cur[-1]).days > 1: groups.append(cur); cur = []
            cur.append(x)
        if cur: groups.append(cur)
        rep = reports[i]
        spells += sum(1 for g in groups if not any(g[0] - pd.Timedelta(days=1) <= r <= g[-1] + pd.Timedelta(days=1) for r in rep))
        years += (min(inits[-1], END) - inits[0]).days / 365.25
    return spells / years

CANDIDATES = [('day', 1.0, 0.2)]  # today's rule first
CANDIDATES += [('day', s, b) for s in (0.5, 0.67, 0.8, 1.0) for b in (0.1, 0.2) if (s, b) != (1.0, 0.2)]
CANDIDATES += [('sum3', mm, b) for mm in (40, 50, 60, 80) for b in (0.1, 0.2)]
CANDIDATES += [('clim', p, b) for p in (0.5, 1, 2, 3) for b in (0.1, 0.2)]
CANDIDATES += [('or', 50, 0.2)]
if os.environ.get('ONLY'): CANDIDATES = [c for c in CANDIDATES if c[0] in os.environ['ONLY'].split(',')]

rows = []
for r in CANDIDATES:
    h_tr, e_tr = hits(r, train); h_te, e_te = hits(r, test); fa = false_alarms(r)
    rows.append({'rule': r, 'train': [h_tr, len(train), e_tr], 'test': [h_te, len(test), e_te], 'falseAlarmsPerPlaceYear': round(fa, 1)})
    print(f'{str(r):28} train {h_tr:2}/{len(train)} (3d+ {e_tr:2})  test {h_te:2}/{len(test)} (3d+ {e_te:2})  false alarms {fa:5.1f} a place a year', flush=True)
json.dump({'train': [floods[i]['label'] + ' ' + floods[i]['peak'] for i in train], 'test': [floods[i]['label'] + ' ' + floods[i]['peak'] for i in test], 'places': len(places), 'rows': rows}, open(os.path.join(HERE, 'rules.json'), 'w'), indent=1)
