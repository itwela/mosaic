"""Renders the Frutiger Aero wallpaper (public/textures/aero.webp).

Bright sky over glossy green hills: a sun bloom with soft rays, aqua light
ribbons sweeping across, scattered soap bubbles and bokeh. Rendered once to a
raster so the app only ever paints a single image.

    python3 scripts/generate-aero-wallpaper.py && cwebp -q 84 public/textures/aero.png -o public/textures/aero.webp
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 2560, 1600
rng = np.random.default_rng(11)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def lerp(a, b, t):
    return a + (b - a) * t[..., None]


def blend(base, color, alpha):
    """Composite a flat colour over base with a per-pixel alpha (0..1)."""
    return base * (1 - alpha[..., None]) + np.array(color, np.float32) * alpha[..., None]


# Sky: deep azure at the top to pale cyan near the horizon
t = np.clip(yy / (H * 0.72), 0, 1) ** 0.9
img = lerp(np.array([18, 108, 214], np.float32), np.array([176, 232, 255], np.float32), t)

# Sun bloom, upper right
SX, SY = W * 0.74, H * 0.2
d = np.hypot(xx - SX, yy - SY)
img = blend(img, (255, 255, 246), np.clip(1 - d / 900, 0, 1) ** 2.4 * 0.85)
img = blend(img, (255, 255, 255), np.clip(1 - d / 170, 0, 1) ** 1.5)

# Soft rays fanning from the sun
ang = np.arctan2(yy - SY, xx - SX)
rays = (np.sin(ang * 14) * 0.5 + 0.5) ** 6 * np.clip(1 - d / 1500, 0, 1) ** 1.6
img = blend(img, (255, 255, 255), rays * 0.22)


def layer():
    return Image.new("L", (W, H), 0)


def apply(img, mask_img, color, strength=1.0):
    return blend(img, color, np.asarray(mask_img, np.float32) / 255 * strength)


# Clouds: clusters of blurred ellipses
clouds = layer()
cd = ImageDraw.Draw(clouds)
for cx, cy, s in [(0.16, 0.2, 1.0), (0.42, 0.12, 0.7), (0.9, 0.42, 0.8), (0.3, 0.46, 0.6), (0.62, 0.36, 0.5)]:
    for _ in range(14):
        ox, oy = rng.normal(0, 120 * s), rng.normal(0, 30 * s)
        rx, ry = rng.uniform(90, 190) * s, rng.uniform(40, 80) * s
        x, y = cx * W + ox, cy * H + oy
        cd.ellipse([x - rx, y - ry, x + rx, y + ry], fill=235)
img = apply(img, clouds.filter(ImageFilter.GaussianBlur(34)), (255, 255, 255), 0.8)

# Aqua light ribbons sweeping across the sky
for k, (amp, y0, col, width) in enumerate([
    (120, 0.52, (120, 255, 214), 70),
    (90, 0.56, (90, 220, 255), 46),
    (150, 0.48, (220, 255, 250), 26),
]):
    ribbon = layer()
    rd = ImageDraw.Draw(ribbon)
    pts = [(x, y0 * H + amp * np.sin(x / W * np.pi * 1.6 + k * 0.9) - x * 0.12) for x in range(-50, W + 60, 20)]
    rd.line(pts, fill=255, width=width, joint="curve")
    img = apply(img, ribbon.filter(ImageFilter.GaussianBlur(width * 0.55)), col, 0.55)
    core = layer()
    ImageDraw.Draw(core).line(pts, fill=255, width=max(3, width // 10), joint="curve")
    img = apply(img, core.filter(ImageFilter.GaussianBlur(2)), (255, 255, 255), 0.5)

# Rolling hills: back hill lighter, front hill a saturated glossy green
for base_y, amp, freq, phase, top, bottom in [
    (0.70, 70, 1.3, 0.4, (140, 222, 92), (64, 168, 52)),
    (0.80, 90, 0.9, 2.1, (108, 206, 58), (22, 120, 34)),
]:
    ridge = base_y * H + amp * np.sin(xx / W * np.pi * 2 * freq + phase) + 30 * np.sin(xx / W * 9 + phase)
    inside = np.clip((yy - ridge) / 3, 0, 1)
    shade = np.clip((yy - ridge) / (H - ridge.min()), 0, 1)
    hill = lerp(np.array(top, np.float32), np.array(bottom, np.float32), shade)
    # Sheen along the crest, as if lit from the sun
    sheen = np.clip(1 - (yy - ridge) / 70, 0, 1) * inside * 0.45
    hill = hill * (1 - sheen[..., None]) + 255 * sheen[..., None]
    img = img * (1 - inside[..., None]) + hill * inside[..., None]

# Bokeh: soft out-of-focus light discs
bokeh = layer()
bd = ImageDraw.Draw(bokeh)
for _ in range(70):
    x, y, r = rng.uniform(0, W), rng.uniform(0, H * 0.75), rng.uniform(8, 46)
    bd.ellipse([x - r, y - r, x + r, y + r], fill=int(rng.uniform(40, 110)))
img = apply(img, bokeh.filter(ImageFilter.GaussianBlur(6)), (255, 255, 255), 0.6)

out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

# Soap bubbles: clear centre, rim light, a crisp specular highlight
bubbles = Image.new("RGBA", (W, H), (0, 0, 0, 0))
for _ in range(34):
    r = float(rng.choice([rng.uniform(14, 40), rng.uniform(40, 110)], p=[0.7, 0.3]))
    x, y = rng.uniform(0, W), rng.uniform(H * 0.05, H * 0.9)
    size = int(r * 2 + 8)
    by, bx = np.mgrid[0:size, 0:size].astype(np.float32) - size / 2
    dist = np.hypot(bx, by) / r
    rim = np.clip(1 - np.abs(dist - 0.94) / 0.1, 0, 1) ** 1.5
    body = np.clip(1 - dist, 0, 1) * 0.12
    hue = np.stack([
        200 + 55 * np.clip(-bx / r, 0, 1),
        235 + 20 * np.clip(by / r, 0, 1),
        255 + 0 * bx,
    ], -1)
    hx, hy = -0.38 * r, -0.42 * r
    spec = np.clip(1 - np.hypot(bx - hx, (by - hy) * 1.4) / (r * 0.28), 0, 1) ** 1.8
    alpha = np.clip(rim * 0.85 + body + spec, 0, 1) * (dist < 1.02)
    rgb = hue * (1 - spec[..., None]) + 255 * spec[..., None]
    sprite = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")
    bubbles.alpha_composite(sprite, (int(x - size / 2), int(y - size / 2)))
out.alpha_composite(bubbles.filter(ImageFilter.GaussianBlur(0.6)))

out.convert("RGB").save("public/textures/aero.png")
