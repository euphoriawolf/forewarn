# A satellite base map of Nairobi for the "what area is this?" screen: Sentinel-2 cloudless 2024
# (EOX, CC BY-NC-SA 4.0) from Flood Check's z11 context tiles. Writes data/scales-nairobi.jpg
# and data/scales-nairobi.json with its bounds, so the page can draw squares in lon/lat.
import json, math
from PIL import Image
FC = '/Users/wolf/Documents/Work/software-artist/lagos-flood/public/data/nairobi/imagery/11/'
W, E, S, N = 36.55, 37.0, -1.475, -1.025
z = 11
tx = lambda lon: (lon + 180) / 360 * 2 ** z
ty = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * 2 ** z
fx0, fx1, fy0, fy1 = tx(W), tx(E), ty(N), ty(S)
X0, X1, Y0, Y1 = int(fx0), int(fx1), int(fy0), int(fy1)
big = Image.new('RGB', ((X1 - X0 + 1) * 256, (Y1 - Y0 + 1) * 256))
for x in range(X0, X1 + 1):
    for y in range(Y0, Y1 + 1): big.paste(Image.open(f'{FC}{x}_{y}.jpg'), ((x - X0) * 256, (y - Y0) * 256))
img = big.crop((int((fx0 - X0) * 256), int((fy0 - Y0) * 256), int((fx1 - X0) * 256), int((fy1 - Y0) * 256))).resize((1000, 1000), Image.LANCZOS)
img.save('data/scales-nairobi.jpg', quality=86)
json.dump({'west': W, 'east': E, 'south': S, 'north': N, 'note': 'Sentinel-2 cloudless 2024 by EOX, CC BY-NC-SA 4.0'}, open('data/scales-nairobi.json', 'w'))
print('ok', X0, X1, Y0, Y1)
