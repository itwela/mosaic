"""Renders the stained-glass mosaic background (public/textures/glass.webp).

Voronoi shards of coloured glass in dark lead, composed as a large flower
burst like a glass-on-glass mosaic window. Rendered once to a raster so the
app only ever paints a single image.

    python3 scripts/generate-mosaic-textures.py && cwebp -q 82 public/textures/glass.png -o public/textures/glass.webp
"""
import colorsys
import numpy as np
from PIL import Image

W, H, CELL = 2560, 1600, 46
rng = np.random.default_rng(7)

# burst centre sits right of middle so it shows around the panels
CX, CY = W * 0.62, H * 0.52
PETALS = 14

# jittered seed grid: each pixel only checks its 3x3 neighbouring cells
gx, gy = W // CELL + 3, H // CELL + 3
seeds = (np.stack(np.meshgrid(np.arange(gx), np.arange(gy), indexing="xy"), -1) + rng.uniform(0.12, 0.88, (gy, gx, 2)) - 1) * CELL  # one cell of padding


def palette(x, y):
    """Composition colour for a shard centred at (x, y)."""
    dx, dy = x - CX, y - CY
    r = np.hypot(dx, dy) / np.hypot(W, H)
    a = (np.arctan2(dy, dx) / (2 * np.pi)) % 1
    petal = (a * PETALS) % 1
    on_petal = abs(petal - 0.5) < 0.32
    if r < 0.05:                                   # gold heart
        h, l, s = 0.11, 0.55, 0.85
    elif r < 0.10:                                 # ember ring
        h, l, s = 0.03 + 0.03 * rng.random(), 0.45, 0.8
    elif r < 0.33 and on_petal:                    # petals: amber → rose → violet
        t = (r - 0.10) / 0.23
        h = (0.09 - 0.22 * t) % 1
        l, s = 0.5 - 0.08 * t, 0.75
    elif r < 0.33:                                 # between petals: deep teal
        h, l, s = 0.5, 0.3, 0.55
    else:                                          # outer field: lapis → teal → leaf green
        t = min(1, (r - 0.33) / 0.4)
        h = 0.62 - 0.25 * t + 0.04 * np.sin(a * 12)
        l, s = 0.36 + 0.06 * np.sin(x / 210 + y / 170), 0.6
    h = (h + rng.normal(0, 0.018)) % 1
    l = np.clip(l + rng.normal(0, 0.07), 0.12, 0.8)
    s = np.clip(s + rng.normal(0, 0.08), 0.2, 1)
    if rng.random() < 0.015:                        # stray clear / opal pieces
        l, s = 0.78, 0.15
    return colorsys.hls_to_rgb(h, l, s)


colors = np.zeros((gy, gx, 3))
for j in range(gy):
    for i in range(gx):
        colors[j, i] = palette(*seeds[j, i])

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
ci, cj = (xs // CELL).astype(int) + 1, (ys // CELL).astype(int) + 1
d1 = np.full((H, W), np.inf, np.float32)
d2 = np.full((H, W), np.inf, np.float32)
own = np.zeros((H, W, 2), int)
for oj in (-1, 0, 1):
    for oi in (-1, 0, 1):
        nj, ni = cj + oj, ci + oi
        s = seeds[nj, ni]
        d = np.hypot(xs - s[..., 0], ys - s[..., 1])
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        d1 = np.where(closer, d, d1)
        own[closer] = np.stack([nj, ni], -1)[closer]

img = colors[own[..., 0], own[..., 1]]
# glass lit from behind: brighter centre, slightly darker toward the lead
glow = 1.08 - 0.28 * np.clip(d1 / (CELL * 0.75), 0, 1)
streak = 0.06 * np.sin((xs + ys) / 9 + own[..., 1] * 1.7)  # faint ripple in the glass
img = np.clip(img * glow[..., None] + streak[..., None], 0, 1)
# lead came between shards
lead = np.clip(((d2 - d1) - 2.2) / 1.6, 0, 1)[..., None]
img = img * lead + np.array([0.06, 0.05, 0.045]) * (1 - lead)

Image.fromarray((img * 255).astype(np.uint8)).save("public/textures/glass.png")
print("wrote public/textures/glass.png")
