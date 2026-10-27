# Cuts a whole Flood Check region (Lagos or Nairobi) into 2 km tiles for the 3D, from Flood Check's
# data (pre-existing, disclosed in the README). A tile with no buildings is skipped.
#
# Writes public/tiles/<region>/index.json and, per tile, public/tiles/<region>/<i>_<j>/:
#   ground.json  ground heights (m) on the region's 60 m grid, for the cells around the tile
#   city.json    buildings (footprint rings in 0.5 m steps from the tile corner, height m, 0 = unknown)
#                and roads (points in 0.5 m steps from the tile corner)
#   life.json    trees [x, z in 0.5 m steps, height m, spread in 0.1 m] and the last storm's water:
#                only the cells that ever reached 4 cm, each with its 96 hourly depths in cm
#   photo.jpg    Sentinel-2 cloudless 2024 (EOX, CC BY-NC-SA 4.0) for the tile, 512 x 512
# Tile (i, j) covers x from i*2000 to (i+1)*2000 m east of the region's west edge and z from j*2000
# to (j+1)*2000 m south of its north edge. The client joins four tiles around a pin.
# Usage: python3 tools/make-tiles.py <region>   (needs numpy and Pillow)
import gzip, json, math, os, struct, sys
import numpy as np
from PIL import Image

REGION = sys.argv[1]
FC = f'/Users/wolf/Documents/Work/software-artist/lagos-flood/public/data/{REGION}/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'tiles', REGION)
T = 2000  # tile size, metres

m = json.load(open(FC + 'dem.json')); W, H = m['width'], m['height']; west, south, east, north = m['bbox']
kx = 111320 * math.cos(math.radians((south + north) / 2)); ky = 110574
widthM, heightM = (east - west) * kx, (north - south) * ky
cmx, cmz = widthM / W, heightM / H
dem = np.fromfile(FC + 'dem.bin', '<f4').reshape(H, W)
raw = np.frombuffer(gzip.open(FC + 'model.bin').read(), 'u1').reshape(-1, H, W)
cm = ((np.cumsum(raw.astype(np.uint32), axis=0) & 0xff) * 2).astype(np.uint16)  # d2 format: 2 cm steps
HOURS = cm.shape[0]
START = json.load(open(FC + 'rain.json'))['times'][0]
EVENT = json.load(open(FC + 'rain.json')).get('event')
peak = cm.max(axis=0)
cols, rows = math.ceil(widthM / T), math.ceil(heightM / T)

# buildings from Flood Check's 1 km tiles (0.5 m steps from the 1 km tile's corner less a 1000 m margin)
fcix = json.load(open(FC + 'tiles/index.json')); FT, MG = fcix['tile'], fcix['margin']
blds = [[[] for _ in range(cols)] for _ in range(rows)]
for ti, tj, n in fcix['tiles']:
    b = open(FC + f'tiles/{ti}_{tj}.bin', 'rb').read(); lenB = struct.unpack_from('<I', b, 0)[0]; s = b[4:4 + lenB]
    N, TT = struct.unpack_from('<II', s, 0)
    counts = s[8:8 + N]; hts = s[8 + N:8 + 2 * N]; off = 8 + 2 * N; off += off % 2
    xy = np.frombuffer(s, '<u2', TT * 2, off).reshape(-1, 2).astype(float) * 0.5
    xy[:, 0] += ti * FT - MG; xy[:, 1] += tj * FT - MG
    k = 0
    for bi in range(N):
        c = counts[bi]; ring = xy[k:k + c]; k += c
        cx, cz = ring.mean(0); i, j = int(cx // T), int(cz // T)
        if 0 <= i < cols and 0 <= j < rows: blds[j][i].append((hts[bi], ring))

# trees: "TRE2", f32 step, u32 count, then u16 x, u16 z, u8 height m, u8 spread in 0.1 m
tb = open(FC + 'trees.bin', 'rb').read(); step = struct.unpack_from('<f', tb, 4)[0]; nt = struct.unpack_from('<I', tb, 8)[0]
tr = np.frombuffer(tb, np.dtype([('x', '<u2'), ('z', '<u2'), ('h', 'u1'), ('s', 'u1')]), nt, 12)
trx, trz = tr['x'] * step, tr['z'] * step
tri, trj = (trx // T).astype(int), (trz // T).astype(int)

# roads, in region metres
rd = json.load(open(FC + 'roads.json'))
roads = [{'k': r['k'], 'n': r.get('n', ''), 'p': [((lo - west) * kx, (north - la) * ky) for lo, la in r['p']]} for r in rd['roads']]
# which tiles each road touches (its points and 50 m around them), so a tile only looks at its own roads
roads_in = {}
for r in roads:
    keys = {(int((x + dx) // T), int((zz + dz) // T)) for x, zz in r['p'] for dx in (-50, 50) for dz in (-50, 50)}
    for k in keys: roads_in.setdefault(k, []).append(r)

# imagery: the z14 Sentinel-2 tiles Flood Check already has
z = 14
txy = lambda lon, lat: ((lon + 180) / 360 * 2 ** z, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** z)
tilecache = {}
def img(x, y):
    if (x, y) not in tilecache:
        p = FC + f'imagery/14/{x}_{y}.jpg'
        tilecache[(x, y)] = Image.open(p).convert('RGB') if os.path.exists(p) else Image.new('RGB', (256, 256), (122, 120, 102))
    return tilecache[(x, y)]

os.makedirs(OUT, exist_ok=True)
index = []
for j in range(rows):
    for i in range(cols):
        B = blds[j][i]
        if not B: continue
        x0, z0 = i * T, j * T
        q = lambda x, z: [round((x - x0) * 2), round((z - z0) * 2)]  # 0.5 m steps from the tile corner
        d = os.path.join(OUT, f'{i}_{j}'); os.makedirs(d, exist_ok=True)
        # cells around the tile, one cell of margin so the edges join smoothly
        ci0, ci1 = max(0, int(x0 // cmx) - 1), min(W, int(math.ceil((x0 + T) / cmx)) + 1)
        cj0, cj1 = max(0, int(z0 // cmz) - 1), min(H, int(math.ceil((z0 + T) / cmz)) + 1)
        json.dump({'ci0': ci0, 'cj0': cj0, 'w': ci1 - ci0, 'h': cj1 - cj0, 'z': [round(float(v), 2) for v in dem[cj0:cj1, ci0:ci1].ravel()]}, open(f'{d}/ground.json', 'w'), separators=(',', ':'))
        bl = [{'h': int(h), 'p': [q(x, zz) for x, zz in ring]} for h, ring in B]
        rl = []
        for r in roads_in.get((i, j), []):
            pts = [p for p in r['p'] if x0 - 50 <= p[0] <= x0 + T + 50 and z0 - 50 <= p[1] <= z0 + T + 50]
            if len(pts) > 1: rl.append({'k': r['k'], 'n': r['n'], 'p': [q(x, zz) for x, zz in pts]})
        json.dump({'buildings': bl, 'roads': rl}, open(f'{d}/city.json', 'w'), separators=(',', ':'))
        sel = (tri == i) & (trj == j)
        trees = [[*q(float(a), float(b)), int(h), int(s)] for a, b, h, s in zip(trx[sel], trz[sel], tr['h'][sel], tr['s'][sel])]
        wet = np.argwhere(peak[cj0:cj1, ci0:ci1] >= 4)
        water = [{'c': int(jj * (ci1 - ci0) + ii), 'cm': cm[:, cj0 + jj, ci0 + ii].tolist()} for jj, ii in wet]
        json.dump({'trees': trees, 'water': water}, open(f'{d}/life.json', 'w'), separators=(',', ':'))
        # photo
        lonW, lonE = west + x0 / kx, west + (x0 + T) / kx; latN, latS = north - z0 / ky, north - (z0 + T) / ky
        (fx0, fy0), (fx1, fy1) = txy(lonW, latN), txy(lonE, latS)
        X0, Y0, X1, Y1 = int(fx0), int(fy0), int(fx1), int(fy1)
        big = Image.new('RGB', ((X1 - X0 + 1) * 256, (Y1 - Y0 + 1) * 256))
        for x in range(X0, X1 + 1):
            for y in range(Y0, Y1 + 1): big.paste(img(x, y), ((x - X0) * 256, (y - Y0) * 256))
        big.crop((int((fx0 - X0) * 256), int((fy0 - Y0) * 256), int((fx1 - X0) * 256), int((fy1 - Y0) * 256))).resize((512, 512), Image.LANCZOS).save(f'{d}/photo.jpg', quality=82)
        index.append([i, j, len(bl)])

json.dump({'note': 'Flood Check data (pre-existing) cut into 2 km tiles by tools/make-tiles.py.', 'region': REGION, 'tile': T,
           'west': west, 'north': north, 'kx': kx, 'ky': ky, 'cmx': cmx, 'cmz': cmz, 'cols': cols, 'rows': rows, 'gridW': W, 'gridH': H,
           'hours': HOURS, 'start': START, 'event': EVENT, 'tiles': index}, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print(REGION, len(index), 'tiles of', cols * rows)
