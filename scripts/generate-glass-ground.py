"""Live "Lit glass" ground for the Mosaic theme.

Same cells, colours and surface as the design generator (figcraft-work/mosaic/glass3/tools/ground4.py),
but split into layers so the app can light tiles at runtime instead of baking the light in:

  material.webp  R = surface relief (0..2.4 -> 0..255), G = bevel towards the came,
                 B = bright lip up-left, A = glass (255) vs lead came (0)
  cells.png      R,G = cell index (low, high byte); B = came joint highlight
  cells.json     per cell: centre x,y (logical px), base colour r,g,b, ambient light, opal flag

usage: generate-glass-ground.py <tiles.png> <out dir> [W H scale]
needs numpy, scipy, pillow
"""
import sys, json, os
import numpy as np
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter
from scipy import ndimage as ndi
from PIL import Image

sheet_path, out = sys.argv[1], sys.argv[2]
W, H, S = (int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else (2560, 1600, 1.5)
SEED = 11
rng = np.random.default_rng(SEED)
w, h = int(W * S), int(H * S)
CELL = 40 * S
LEAD = 1.9 * S

nx, ny = int(w / CELL) + 3, int(h / CELL) + 3
gx, gy = np.meshgrid(np.arange(nx), np.arange(ny))
pts = np.stack([(gx.ravel() - 1 + rng.uniform(0.0, 1.0, gx.size)) * CELL,
                (gy.ravel() - 1 + rng.uniform(0.0, 1.0, gy.size)) * CELL], 1)
yy, xx = np.mgrid[0:h, 0:w]
P = np.stack([xx.ravel(), yy.ravel()], 1).astype(np.float32)
_, idx = cKDTree(pts).query(P[::9], k=1)
cnt = np.bincount(idx, minlength=len(pts))
sx = np.bincount(idx, weights=P[::9, 0], minlength=len(pts))
sy = np.bincount(idx, weights=P[::9, 1], minlength=len(pts))
m = cnt > 0
pts[m] = 0.7 * pts[m] + 0.3 * np.stack([sx[m] / cnt[m], sy[m] / cnt[m]], 1)

d, idx = cKDTree(pts).query(P, k=3, workers=-1)
i1, i2 = idx[:, 0], idx[:, 1]
p1, p2 = pts[i1], pts[i2]
sep = np.linalg.norm(p2 - p1, axis=1) + 1e-6
edge = (d[:, 1] ** 2 - d[:, 0] ** 2) / (2 * sep)
p3 = pts[idx[:, 2]]
sep3 = np.linalg.norm(p3 - p1, axis=1) + 1e-6
edge3 = (d[:, 2] ** 2 - d[:, 0] ** 2) / (2 * sep3)
k = 2.4 * S
edge = -k * np.log(np.exp(-edge / k) + np.exp(-edge3 / k)) + k * 0.5

def lowfreq(sig, seed):
    r = np.random.default_rng(seed).normal(size=(h // 8 + 2, w // 8 + 2))
    f = gaussian_filter(r, sig * S / 8)
    return (f - f.min()) / (f.max() - f.min())
n1, n2, n3 = lowfreq(150, 1 + SEED), lowfreq(90, 2 + SEED), lowfreq(60, 3 + SEED)
cx = np.clip((pts[:, 0] / 8).astype(int), 0, n1.shape[1] - 1)
cy = np.clip((pts[:, 1] / 8).astype(int), 0, n1.shape[0] - 1)
warm, acc = n1[cy, cx], n3[cy, cx]

PAL = dict(
    ruby=(196, 38, 46), crimson=(224, 62, 58), rose=(214, 46, 120), magenta=(190, 40, 150),
    amber=(232, 150, 44), ember=(222, 98, 40),
    teal=(30, 138, 140), deep_teal=(22, 96, 110), cobalt=(40, 84, 176), indigo=(52, 58, 140),
    sea=(46, 160, 150), opal=(206, 204, 196), violet=(120, 60, 170),
)
def pick(names, probs, n):
    return np.array([PAL[x] for x in names], float)[rng.choice(len(names), n, p=probs)]
N = len(pts)
col = np.zeros((N, 3))
u = rng.uniform(size=N)
wm = warm + rng.normal(0, 0.035, N)
hot = wm > 0.60
midz = (wm > 0.52) & ~hot
cool = ~hot & ~midz
col[hot] = pick(["ruby", "crimson", "rose", "magenta", "ember", "amber"], [.26, .22, .22, .14, .10, .06], hot.sum())
col[midz] = pick(["magenta", "violet", "rose", "indigo", "amber", "cobalt"], [.22, .22, .16, .16, .10, .14], midz.sum())
col[cool] = pick(["teal", "deep_teal", "cobalt", "indigo", "sea"], [.30, .26, .22, .12, .10], cool.sum())
am = hot & (acc > 0.66)
col[am] = pick(["amber", "ember"], [.6, .4], am.sum())
op = u < 0.035
col[op] = PAL["opal"]
col *= rng.uniform(0.80, 1.12, (N, 1))
col += rng.normal(0, 7, (N, 3))
col = np.clip(col, 0, 255)
ambient = rng.uniform(0.0, 1.0, N) ** 3 * 0.22

# surface relief sampled from the photographed tiles
sheet = np.asarray(Image.open(sheet_path).convert("RGB"), np.float32)
SL = sheet @ np.array([0.299, 0.587, 0.114], np.float32)
bl, bn = ndi.label(ndi.binary_opening(SL > 40, iterations=6))
boxes = [sl for sl in ndi.find_objects(bl) if (sl[0].stop - sl[0].start) > 150 and (sl[1].stop - sl[1].start) > 150]
D = np.clip(SL / (gaussian_filter(SL, 26) + 1.0), 0.35, 2.4)
kk = rng.integers(0, len(boxes), N)
bcx = np.array([(b[1].start + b[1].stop) / 2 for b in boxes]); bcy = np.array([(b[0].start + b[0].stop) / 2 for b in boxes])
bhw = np.array([(b[1].stop - b[1].start) / 2 for b in boxes]); bhh = np.array([(b[0].stop - b[0].start) / 2 for b in boxes])
ang = rng.uniform(0, 2 * np.pi, N)
zs = rng.uniform(0.85, 1.25, N) * (2.0 / S)
jx = rng.uniform(-0.25, 0.25, N) * bhw[kk]; jy = rng.uniform(-0.25, 0.25, N) * bhh[kk]
rel = P - p1
ca, sa = np.cos(ang)[i1], np.sin(ang)[i1]
u_ = (rel[:, 0] * ca - rel[:, 1] * sa) * zs[i1]; v_ = (rel[:, 0] * sa + rel[:, 1] * ca) * zs[i1]
m_ = 14
u_ = np.clip(u_ + jx[i1], -(bhw[kk][i1] - m_), bhw[kk][i1] - m_); v_ = np.clip(v_ + jy[i1], -(bhh[kk][i1] - m_), bhh[kk][i1] - m_)
relief = ndi.map_coordinates(D, [bcy[kk][i1] + v_, bcx[kk][i1] + u_], order=1, mode="nearest")
relief = relief / np.maximum(ndi.mean(relief, i1, np.arange(N))[i1], 1e-3)

inner = np.clip((edge - LEAD) / (9 * S), 0, 1)
bevel = 0.70 + 0.30 * inner ** 0.6
nrm = (p2 - p1) / sep[:, None]
lip = np.clip(1 - np.abs(edge - LEAD - 1.6 * S) / (1.3 * S), 0, 1) * np.clip((nrm * np.array([-0.6, -0.8])).sum(1), 0, 1)
leadm = np.clip((edge - LEAD) / (1.1 * S) + 0.5, 0, 1)
joint = np.clip(1 - np.maximum(np.abs(edge), np.abs(edge3 - k * 0.5)) / (LEAD * 1.7), 0, 1) ** 0.7
ridge = np.clip(1 - np.abs(edge) / LEAD, 0, 1)
leadm = leadm * (1 - 0.85 * (joint > 0.25))

os.makedirs(out, exist_ok=True)
mat = np.stack([np.clip(relief / 2.4, 0, 1), bevel, lip, leadm], 1)
Image.fromarray((mat * 255).round().astype(np.uint8).reshape(h, w, 4), "RGBA").save(
    os.path.join(out, "material.webp"), quality=86, method=6, exact=True)
ids = np.stack([i1 & 255, i1 >> 8, np.clip(joint * 0.75 + ridge * 0.25, 0, 1) * 255], 1).astype(np.uint8)
Image.fromarray(ids.reshape(h, w, 3), "RGB").save(os.path.join(out, "cells.png"), optimize=True)
json.dump({
    "w": W, "h": H, "n": int(N),
    "x": [round(float(v) / S, 1) for v in pts[:, 0]],
    "y": [round(float(v) / S, 1) for v in pts[:, 1]],
    "rgb": [int(round(v)) for v in col.ravel()],
    "amb": [round(float(v), 3) for v in ambient],
    "opal": [int(v) for v in np.nonzero(op)[0]],
}, open(os.path.join(out, "cells.json"), "w"), separators=(",", ":"))
print("wrote", out, w, h, N)
