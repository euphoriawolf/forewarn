# Normal rain for every 0.25 degree square in Africa, per month: the mean daily rain in each month
# over 1991 to 2020, from CHIRPS daily (Climate Hazards Center, UC Santa Barbara; downloaded into
# ../lagos-flood/data-cache/chirps-daily-p25). The agent's "last 30 days against normal" reads it.
# Writes public/normals/chirps-1991-2020.bin: 12 months x 320 rows x 300 columns, uint16, in 0.01 mm a
# day (65535 = sea or no data). Row 0 is 40 N, column 0 is 20 W; each cell is 0.25 degrees.
# Usage: python3 tools/make-normals.py   (needs numpy and Pillow)
import gzip, io, os, datetime as dt
import numpy as np
from PIL import Image
B = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'lagos-flood', 'data-cache', 'chirps-daily-p25')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'normals', 'chirps-1991-2020.bin')
def read(d):
    p = f'{B}/{d.year}/chirps-v2.0.{d:%Y.%m.%d}.tif'
    if os.path.exists(p + '.gz'): return np.array(Image.open(io.BytesIO(gzip.open(p + '.gz').read())), dtype=np.float32)
    return np.array(Image.open(p), dtype=np.float32)
total = np.zeros((12, 320, 300)); count = np.zeros((12, 320, 300)); sea = np.zeros((320, 300), bool)
d = dt.date(1991, 1, 1)
while d <= dt.date(2020, 12, 31):
    a = read(d); bad = a < 0; sea |= bad
    total[d.month - 1] += np.where(bad, 0, a); count[d.month - 1] += ~bad
    d += dt.timedelta(days=1)
mean = np.where(count > 0, total / np.maximum(count, 1), 0)
out = np.clip(np.round(mean * 100), 0, 65534).astype('<u2'); out[:, sea] = 65535
out.tofile(OUT); print('wrote', OUT, out.nbytes, 'bytes')
