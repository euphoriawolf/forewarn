# Cuts a square around a pin from Flood Check's Nairobi data (pre-existing, disclosed):
# ground heights, March water per hour, building footprints with heights, measured trees,
# roads and the satellite photo. Writes data/place-<name>.json and data/place-<name>.jpg.
# Coordinates are metres from the pin: x east, z south. Usage: python3 tools/cut-place.py
import json, math, gzip, os, struct
import numpy as np
from PIL import Image

FC = '/Users/wolf/Documents/Work/software-artist/lagos-flood/public/data/nairobi/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
NAME, LAT, LON, HALF = 'eastleigh', -1.2847, 36.8608, 1500

m = json.load(open(FC + 'dem.json')); W, H = m['width'], m['height']; west, south, east, north = m['bbox']
kx = 111320 * math.cos(math.radians((south + north) / 2)); ky = 110574
px, pz = (LON - west) * kx, (north - LAT) * ky          # pin, metres from the north-west corner
cmx, cmz = (east - west) * kx / W, (north - south) * ky / H  # metres per model cell

# ground and water on the 60 m grid, cells whose centres fall within HALF + one cell
i0, i1 = int((px - HALF) / cmx) - 1, int((px + HALF) / cmx) + 2
j0, j1 = int((pz - HALF) / cmz) - 1, int((pz + HALF) / cmz) + 2
dem = np.fromfile(FC + 'dem.bin', '<f4').reshape(H, W)[j0:j1, i0:i1]
raw = np.frombuffer(gzip.open(FC + 'model.bin').read(), 'u1').reshape(96, H, W)
cm = ((np.cumsum(raw.astype(np.uint32), axis=0) & 0xff) * 2)[:, j0:j1, i0:i1]
grid = {'x0': (i0 + 0.5) * cmx - px, 'z0': (j0 + 0.5) * cmz - pz, 'dx': cmx, 'dz': cmz, 'w': i1 - i0, 'h': j1 - j0}
ground0 = float(dem[int((pz - (j0 + 0.5) * cmz) / cmz + 0.5), int((px - (i0 + 0.5) * cmx) / cmx + 0.5)])

# buildings from the 1 km tiles (0.5 m steps from the tile corner less a 1000 m margin)
idx = json.load(open(FC + 'tiles/index.json')); T, MG = idx['tile'], idx['margin']
blds = []
for ti, tj, n in idx['tiles']:
    if (ti + 1) * T < px - HALF - 200 or ti * T > px + HALF + 200 or (tj + 1) * T < pz - HALF - 200 or tj * T > pz + HALF + 200: continue
    b = open(FC + f'tiles/{ti}_{tj}.bin', 'rb').read(); lenB = struct.unpack_from('<I', b, 0)[0]; s = b[4:4 + lenB]
    N, TT = struct.unpack_from('<II', s, 0)
    counts = s[8:8 + N]; hts = s[8 + N:8 + 2 * N]; off = 8 + 2 * N; off += off % 2
    xy = np.frombuffer(s, '<u2', TT * 2, off).reshape(-1, 2).astype(float) * 0.5
    xy[:, 0] += ti * T - MG - px; xy[:, 1] += tj * T - MG - pz
    k = 0
    for bi in range(N):
        c = counts[bi]; ring = xy[k:k + c]; k += c
        cx, cz = ring.mean(0)
        if abs(cx) < HALF and abs(cz) < HALF: blds.append({'h': hts[bi], 'p': [[round(a, 1), round(z, 1)] for a, z in ring]})

# trees: "TRE2", f32 step, u32 count, then u16 x, u16 z, u8 height m, u8 spread in 0.1 m
tb = open(FC + 'trees.bin', 'rb').read(); step = struct.unpack_from('<f', tb, 4)[0]; nt = struct.unpack_from('<I', tb, 8)[0]
arr = np.frombuffer(tb, np.dtype([('x', '<u2'), ('z', '<u2'), ('h', 'u1'), ('s', 'u1')]), nt, 12)
tx, tz = arr['x'] * step - px, arr['z'] * step - pz
sel = (abs(tx) < HALF) & (abs(tz) < HALF)
trees = [[round(float(a), 1), round(float(b), 1), int(h), round(int(s) / 10, 1)] for a, b, h, s in zip(tx[sel], tz[sel], arr['h'][sel], arr['s'][sel])]

# roads
rd = json.load(open(FC + 'roads.json'))
roads = []
for r in rd['roads']:
    pts = [[round((lo - west) * kx - px, 1), round((north - la) * ky - pz, 1)] for lo, la in r['p']]
    if any(abs(a) < HALF + 100 and abs(b) < HALF + 100 for a, b in pts): roads.append({'k': r['k'], 'n': r.get('n', ''), 'p': pts})

# Three files, loaded in this order so a slow phone shows the place early: ground first, then
# buildings and roads, then trees and the water.
note = 'Cut from Flood Check (pre-existing). Metres from the pin, x east, z south.'
json.dump({'note': note + ' Copernicus GLO-30 ground.', 'name': NAME, 'lat': LAT, 'lon': LON, 'half': HALF, 'ground0': round(ground0, 2), 'grid': grid,
           'ground': [round(float(v), 2) for v in dem.ravel()]}, open(f'{OUT}/place-{NAME}-ground.json', 'w'))
json.dump({'note': note + ' OpenStreetMap and Overture buildings (height in m, 0 = unknown), OpenStreetMap roads.', 'buildings': blds, 'roads': roads}, open(f'{OUT}/place-{NAME}-city.json', 'w'))
json.dump({'note': note + ' Canopy-map trees [x, z, height m, spread m]; Flood Check model of 5 to 8 Mar 2026, cm per 60 m cell per hour.', 'start': '2026-03-05T00:00',
           'trees': trees, 'cm': [list(map(int, h.ravel())) for h in cm]}, open(f'{OUT}/place-{NAME}-life.json', 'w'))

# satellite photo for the square, from the z14 tiles (Sentinel-2 cloudless 2024, EOX, CC BY-NC-SA 4.0)
z = 14; tile = lambda lon, lat: ((lon + 180) / 360 * 2 ** z, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** z)
lonW, lonE = west + (px - HALF) / kx, west + (px + HALF) / kx; latN, latS = north - (pz - HALF) / ky, north - (pz + HALF) / ky
(fx0, fy0), (fx1, fy1) = tile(lonW, latN), tile(lonE, latS)
X0, Y0, X1, Y1 = int(fx0), int(fy0), int(fx1), int(fy1); S = 256
big = Image.new('RGB', ((X1 - X0 + 1) * S, (Y1 - Y0 + 1) * S))
for x in range(X0, X1 + 1):
    for y in range(Y0, Y1 + 1): big.paste(Image.open(FC + f'imagery/14/{x}_{y}.jpg'), ((x - X0) * S, (y - Y0) * S))
big.crop((int((fx0 - X0) * S), int((fy0 - Y0) * S), int((fx1 - X0) * S), int((fy1 - Y0) * S))).resize((1024, 1024), Image.LANCZOS).save(f'{OUT}/place-{NAME}.jpg', quality=88)
print(len(blds), 'buildings', len(trees), 'trees', len(roads), 'roads', grid['w'], 'x', grid['h'], 'cells', 'ground0', ground0)
