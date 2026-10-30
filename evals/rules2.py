# The rule search, round 2: can Forewarn catch about 80% of past floods and still keep alerts rare?
# Data: evals/ens-daily4.npz (evals/modal_pull4.py): every daily forecast since April 2024 for the 4
# forecast squares around each place, with each day's total and heaviest 3-hour burst.
# Ideas tried, alone and together (a day counts when at least `share` of the 51 runs do it):
#   where:  'blend' (the 4 squares blended, as the live app) or 'max' (the wettest of the 4, run by run)
#   day:    the place's flood line in one day (x `line`)
#   sum3:   X mm over the 3 days to that day
#   burst:  P mm in the heaviest 3 hours of that day
#   soaked: every bar x `wet` when the 30 days before the forecast were soaked (the app's rule, on the
#           same Open-Meteo rain the live app reads, against CHIRPS normals)
# Scoring as in evals/rules.py: hits for the day before, the flood day or the day after, 1 to 7 days
# ahead; false alarms are alert spells with no Groundsource report within a day, April 2024 to
# January 2026, per place per year. Parameters are picked on half the floods (train) and checked on
# the other half (test).
# Usage: python3 evals/rules2.py   Writes evals/rules2.json.
import itertools, json, os, urllib.request
import numpy as np, pandas as pd
from shapely import from_wkb, centroid, get_x, get_y

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', '..', 'lagos-flood', 'data-cache')
z = np.load(os.path.join(HERE, 'ens-daily4.npz'))
inits = pd.to_datetime(z['inits']).normalize(); N = len(inits)
W = z['weights']                                   # (place, 4)
MM, PK = z['mm'].astype(np.float32), z['peak'].astype(np.float32)   # (n, place, 4, 9, 51)
floods = json.load(open(os.path.join(HERE, '..', 'app', 'public', 'past', 'floods.json')))['floods']
lines = {int(k): v for k, v in json.load(open(os.path.join(HERE, 'lines.json'))).items()}
END = pd.Timestamp('2026-01-31'); ix = {t: i for i, t in enumerate(inits)}
tested = sorted([i for i, f in enumerate(floods) if f['runs']], key=lambda i: floods[i]['peak'])
train, test = tested[0::2], tested[1::2]
cells, places = {}, []
for i, f in enumerate(floods):
    k = (round(f['lat'] * 4), round(f['lon'] * 4))
    if k not in cells: cells[k] = i; places.append(i)

# the fields per place: blended and wettest-square, day totals and bursts, (n, 9, 51)
def fields(p):
    blend = (MM[:, p] * W[p][None, :, None, None]).sum(1); mx = MM[:, p].max(1)
    pkb = (PK[:, p] * W[p][None, :, None, None]).sum(1); pkm = PK[:, p].max(1)
    s3 = lambda a: np.stack([a[:, max(0, d - 2):d + 1].sum(1) for d in range(9)], 1)
    return {'blend': (blend, s3(blend), pkb), 'max': (mx, s3(mx), pkm)}
F = {p: fields(p) for p in range(len(floods))}

# soaked ground at forecast time, from Open-Meteo's archive (what the live app reads) against CHIRPS normals
norm = np.fromfile(os.path.join(HERE, '..', 'app', 'public', 'normals', 'chirps-1991-2020.bin'), '<u2').reshape(12, 320, 300)
def normal_month(lat, lon):
    r, c = int((40 - lat) / 0.25), int((lon + 20) / 0.25)
    w = norm[:, r - 1:r + 2, c - 1:c + 2].reshape(12, -1).astype(float); w[w == 65535] = np.nan
    return np.nanmean(w, 1) / 100
SOAK_CACHE = os.path.join(HERE, 'rules2-soaked.json')
soak_cache = json.load(open(SOAK_CACHE)) if os.path.exists(SOAK_CACHE) else {}
SOAKED = {}
for p in range(len(floods)):
    f = floods[p]; key = f"{f['lat']},{f['lon']}"
    if key not in soak_cache:
        u = f"https://archive-api.open-meteo.com/v1/archive?latitude={f['lat']}&longitude={f['lon']}&start_date=2024-02-15&end_date=2026-01-31&daily=precipitation_sum&timezone=GMT"
        with urllib.request.urlopen(u, timeout=60) as r: d = json.load(r)['daily']
        soak_cache[key] = {'time': d['time'], 'mm': [x or 0 for x in d['precipitation_sum']]}
    d = soak_cache[key]; s = pd.Series(d['mm'], index=pd.to_datetime(d['time'])); m = normal_month(f['lat'], f['lon'])
    last30 = s.rolling(30).sum().shift(1); normal30 = pd.Series([m[t.month - 1] for t in s.index], index=s.index).rolling(30).sum().shift(1)
    soaked = (last30 >= 1.5 * normal30) & (last30 >= 100)
    SOAKED[p] = np.array([bool(soaked.get(t, False)) for t in inits])
json.dump(soak_cache, open(SOAK_CACHE, 'w'))

def fires(rule, p):
    """(n, 9) bool: does the rule count each day of each forecast, at place p?"""
    where, line, sum3, burst, share, wet = rule
    day, s3, pk = F[p][where]
    k = np.where(SOAKED[p], wet, 1.0)[:, None, None]
    hit = np.zeros(day.shape, bool)
    if line: hit |= day >= (lines.get(p) or 30) * line * k
    if sum3: hit |= s3 >= sum3 * k
    if burst: hit |= pk >= burst * k
    return hit.mean(2) >= share

gs = pd.read_parquet(f'{DATA}/groundsource/groundsource_2026.parquet', columns=['geometry', 'start_date'])
gs = gs[gs.start_date >= '2024-03-01']; cent = centroid(from_wkb(gs.geometry.values)); gx, gy = get_x(cent), get_y(cent)
reports = {}
for i in places:
    f = floods[i]; km = np.hypot((gx - f['lon']) * 111 * np.cos(np.radians(f['lat'])), (gy - f['lat']) * 111)
    reports[i] = set(pd.to_datetime(gs.start_date.values[km <= 15]).normalize())

def score(rule):
    fr = {p: fires(rule, p) for p in range(len(floods))}
    def hits(group):
        got = early = 0
        for i in group:
            peak = pd.Timestamp(floods[i]['peak']); first = 0
            for lead in range(7, 0, -1):
                t = peak - pd.Timedelta(days=lead)
                if t in ix and fr[i][ix[t], max(0, lead - 1):min(8, lead + 1) + 1].any(): first = lead; break
            got += first > 0; early += first >= 3
        return got, early
    spells = years = 0
    for i in places:
        warned = set()
        for k, t in enumerate(inits):
            if t > END: break
            for d in np.nonzero(fr[i][k, 1:8])[0] + 1: warned.add(t + pd.Timedelta(days=int(d)))
        days = sorted(x for x in warned if x <= END); groups, cur = [], []
        for x in days:
            if cur and (x - cur[-1]).days > 1: groups.append(cur); cur = []
            cur.append(x)
        if cur: groups.append(cur)
        rep = reports[i]
        spells += sum(1 for g in groups if not any(g[0] - pd.Timedelta(days=1) <= r <= g[-1] + pd.Timedelta(days=1) for r in rep))
        years += (min(inits[-1], END) - inits[0]).days / 365.25
    return hits(train), hits(test), spells / years

today = ('blend', 1.0, 50, 0, 0.2, 1.0)
grid = [today]
for where, line, sum3, burst, share, wet in itertools.product(['blend', 'max'], [1.0, 0], [50, 40, 0], [0, 20, 25, 30], [0.2, 0.15, 0.1], [1.0, 0.75]):
    if not (line or sum3 or burst): continue
    grid.append((where, line, sum3, burst, share, wet))
grid = list(dict.fromkeys(grid))
rows = []
for n, r in enumerate(grid):
    (htr, etr), (hte, ete), fa = score(r)
    rows.append({'rule': dict(zip(['where', 'line', 'sum3', 'burst', 'share', 'wet'], r)), 'train': [htr, len(train), etr], 'test': [hte, len(test), ete], 'all': htr + hte, 'early': etr + ete, 'falseAlarms': round(fa, 1)})
    if n % 20 == 0: print(f'{n}/{len(grid)}', flush=True)

# picked on the train half only: the most train hits within each false-alarm budget, then checked on test
picks = {}
for budget in (4, 5, 6, 8):
    ok = [x for x in rows if x['falseAlarms'] <= budget]
    if ok: picks[budget] = max(ok, key=lambda x: (x['train'][0], x['train'][2], -x['falseAlarms']))
base = rows[0]
print(f"today's rule: {base['all']}/36 ({base['all']/36:.0%}), 3+ days {base['early']}, false alarms {base['falseAlarms']}")
for b, x in picks.items():
    print(f"budget {b}/yr: {x['rule']}  train {x['train'][0]}/18, test {x['test'][0]}/18, all {x['all']}/36 ({x['all']/36:.0%}), 3+ days {x['early']}, false alarms {x['falseAlarms']}")
best80 = sorted([x for x in rows if x['all'] >= 29], key=lambda x: x['falseAlarms'])[:3]
for x in best80: print(f"80%+: {x['rule']}  all {x['all']}/36, test {x['test'][0]}/18, false alarms {x['falseAlarms']}")
json.dump({'train': [floods[i]['label'] + ' ' + floods[i]['peak'] for i in train], 'test': [floods[i]['label'] + ' ' + floods[i]['peak'] for i in test], 'today': base, 'picks': picks, 'best80': best80, 'rows': rows}, open(os.path.join(HERE, 'rules2.json'), 'w'), indent=1)
