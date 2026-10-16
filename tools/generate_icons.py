#!/usr/bin/env python3
"""Generates every Zen Mower launcher/store icon asset from ONE shape description.

Outputs (paths relative to the repository root):
  app/src/main/res/drawable/ic_launcher_background.xml   adaptive icon background (vector)
  app/src/main/res/drawable/ic_launcher_foreground.xml   adaptive icon foreground (vector)
  app/src/main/res/drawable/ic_launcher_monochrome.xml   themed-icon layer (vector)
  app/src/main/res/mipmap-*dpi/ic_launcher{,_round}.png  legacy icons for API 24-25
  store/icon-512.png                                     Google Play icon (opaque, full bleed)

Everything is laid out in the 108x108 dp adaptive-icon viewport; the mower stays inside the
66 dp safe zone. Requires Pillow and numpy:  python3 tools/generate_icons.py
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "app" / "src" / "main" / "res"
STORE = ROOT / "store"

VIEW = 108.0
CENTER = VIEW / 2
SAFE_RADIUS = 33.0
SUPERSAMPLE = 4

# ------------------------------------------------------------------------------------------
# Design
# ------------------------------------------------------------------------------------------
LAWN_CENTER = (54.0, 38.0)
LAWN_RADIUS = 86.0
LAWN_STOPS = [(0.0, "#7FD15A"), (0.55, "#3E9A3E"), (1.0, "#17542A")]
STRIPE_WIDTH = 13.5
STRIPE_COLOR = "#FFFFFF"
STRIPE_ALPHA = 0.10

MOWER_SCALE = 0.92  # applied around the viewport centre


def _blade(x0, x1, tip):
    return ("poly", [(x0, 31.0), (x1, 31.0), tip], "#2E7D32", 1.0, "solid")


def _clipping(cx, cy, angle_deg, length=3.6, width=1.5):
    a = math.radians(angle_deg)
    dx, dy = math.cos(a) * length / 2, math.sin(a) * length / 2
    nx, ny = -math.sin(a) * width / 2, math.cos(a) * width / 2
    pts = [(cx - dx - nx, cy - dy - ny), (cx + dx - nx, cy + dy - ny),
           (cx + dx + nx, cy + dy + ny), (cx - dx + nx, cy - dy + ny)]
    return ("poly", pts, "#C5F07A", 1.0, "solid")


def _mirror(shape):
    """Mirrors a polygon around the vertical centre line."""
    _, pts, *rest = shape
    return ("poly", [(VIEW - x, y) for x, y in reversed(pts)], *rest)


DECK = (33.0, 28.0, 42.0, 32.0, (12.0, 12.0, 6.0, 6.0))
ENGINE = (54.0, 44.0, 10.5)

# Top-down push mower facing up, in un-scaled viewport coordinates, drawn back to front.
#   ("rrect", x, y, w, h, (r_tl, r_tr, r_br, r_bl), color, alpha, mono)
#   ("circle", cx, cy, r, color, alpha, mono)
#   ("poly", [(x, y), ...], color, alpha, mono)
# mono: "solid" = part of the themed-icon silhouette, None = colour detail only.
_LEFT_TUFT = [_blade(41.0, 43.0, (40.0, 22.0)), _blade(43.0, 45.4, (44.4, 20.5)), _blade(45.2, 47.2, (48.6, 23.0))]
_LEFT_BAR = ("poly", [(42.0, 56.0), (45.2, 56.0), (40.7, 81.0), (37.5, 81.0)], "#37474F", 1.0, "solid")
MOWER = [
    # uncut grass ahead of the mower
    *_LEFT_TUFT,
    *[_mirror(b) for b in _LEFT_TUFT],
    # handle, slightly splayed, behind the deck
    _LEFT_BAR,
    _mirror(_LEFT_BAR),
    ("rrect", 35.5, 80.0, 37.0, 5.0, (2.5,) * 4, "#1F2A30", 1.0, "solid"),
    # grass catcher bag between the handle bars
    ("rrect", 40.5, 54.0, 27.0, 21.0, (3.0, 3.0, 6.5, 6.5), "#3F4D44", 1.0, "solid"),
    ("rrect", 43.0, 64.0, 22.0, 1.4, (0.7,) * 4, "#56675B", 1.0, None),
    ("rrect", 43.5, 68.4, 21.0, 1.4, (0.7,) * 4, "#56675B", 1.0, None),
    # soft drop shadow of the deck
    ("rrect", DECK[0] + 1.5, DECK[1] + 2.5, DECK[2], DECK[3], DECK[4], "#000000", 0.2, None),
    # wheels (rear ones a little bigger)
    ("rrect", 29.5, 31.0, 6.0, 11.0, (2.5,) * 4, "#1E272C", 1.0, "solid"),
    ("rrect", 72.5, 31.0, 6.0, 11.0, (2.5,) * 4, "#1E272C", 1.0, "solid"),
    ("rrect", 29.5, 47.0, 6.0, 12.0, (2.5,) * 4, "#1E272C", 1.0, "solid"),
    ("rrect", 72.5, 47.0, 6.0, 12.0, (2.5,) * 4, "#1E272C", 1.0, "solid"),
    # red deck: darker base + brighter top = rounded bevel
    ("rrect", *DECK, "#B42A25", 1.0, None),
    ("rrect", DECK[0], DECK[1], DECK[2], DECK[3] - 3.5, DECK[4], "#EC4A3C", 1.0, None),
    # yellow fuel cap on the deck
    ("circle", 67.0, 34.6, 2.6, "#8E1F1B", 1.0, None),
    ("circle", 66.7, 34.0, 2.3, "#FFC23D", 1.0, "solid"),
    # engine: dark cap with cooling fins
    ("circle", ENGINE[0] + 0.8, ENGINE[1] + 1.2, ENGINE[2] + 0.5, "#000000", 0.18, None),
    ("circle", *ENGINE, "#2B3439", 1.0, None),
    ("rrect", ENGINE[0] - 6.0, ENGINE[1] - 4.4, 12.0, 1.7, (0.85,) * 4, "#4A5B63", 1.0, "solid"),
    ("rrect", ENGINE[0] - 7.5, ENGINE[1] - 0.85, 15.0, 1.7, (0.85,) * 4, "#4A5B63", 1.0, "solid"),
    ("rrect", ENGINE[0] - 6.0, ENGINE[1] + 2.7, 12.0, 1.7, (0.85,) * 4, "#4A5B63", 1.0, "solid"),
    # fresh clippings flying out of the side chute
    _clipping(81.0, 40.0, 30.0),
    _clipping(84.6, 45.2, -25.0),
    _clipping(80.6, 49.6, 65.0, length=3.0),
]

# ------------------------------------------------------------------------------------------
# Geometry helpers
# ------------------------------------------------------------------------------------------
def tp(x: float, y: float) -> tuple[float, float]:
    """Applies the mower transform (uniform scale around the centre)."""
    return CENTER + (x - CENTER) * MOWER_SCALE, CENTER + (y - CENTER) * MOWER_SCALE


def transform(shape):
    kind = shape[0]
    if kind == "rrect":
        _, x, y, w, h, radii, *rest = shape
        nx, ny = tp(x, y)
        return ("rrect", nx, ny, w * MOWER_SCALE, h * MOWER_SCALE, tuple(r * MOWER_SCALE for r in radii), *rest)
    if kind == "circle":
        _, cx, cy, r, *rest = shape
        nx, ny = tp(cx, cy)
        return ("circle", nx, ny, r * MOWER_SCALE, *rest)
    if kind == "poly":
        _, pts, *rest = shape
        return ("poly", [tp(x, y) for x, y in pts], *rest)
    raise ValueError(shape)


def style(shape):
    """(color, alpha, mono) of any shape."""
    return {"rrect": shape[6:9], "circle": shape[4:7], "poly": shape[2:5]}[shape[0]]


def fmt(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def rrect_corners(x, y, w, h, radii):
    """Corner (centre, radius, start angle) for tl, tr, br, bl; clockwise in screen space."""
    tl, tr, br, bl = (min(r, w / 2, h / 2) for r in radii)
    return [
        ((x + tl, y + tl), tl, 180.0),
        ((x + w - tr, y + tr), tr, 270.0),
        ((x + w - br, y + h - br), br, 0.0),
        ((x + bl, y + h - bl), bl, 90.0),
    ]


def rrect_path(x, y, w, h, radii) -> str:
    (c_tl, tl, _), (c_tr, tr, _), (c_br, br, _), (c_bl, bl, _) = rrect_corners(x, y, w, h, radii)

    def arc(r, ex, ey):
        return f"A{fmt(r)},{fmt(r)} 0 0 1 {fmt(ex)},{fmt(ey)}" if r > 0 else f"L{fmt(ex)},{fmt(ey)}"

    return (
        f"M{fmt(x + tl)},{fmt(y)}H{fmt(x + w - tr)}{arc(tr, x + w, y + tr)}"
        f"V{fmt(y + h - br)}{arc(br, x + w - br, y + h)}"
        f"H{fmt(x + bl)}{arc(bl, x, y + h - bl)}"
        f"V{fmt(y + tl)}{arc(tl, x + tl, y)}Z"
    )


def rrect_points(x, y, w, h, radii, steps=24):
    pts = []
    for (cx, cy), r, start in rrect_corners(x, y, w, h, radii):
        for i in range(steps + 1):
            a = math.radians(start + 90.0 * i / steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def circle_path(cx, cy, r) -> str:
    return (
        f"M{fmt(cx - r)},{fmt(cy)}"
        f"A{fmt(r)},{fmt(r)} 0 1 1 {fmt(cx + r)},{fmt(cy)}"
        f"A{fmt(r)},{fmt(r)} 0 1 1 {fmt(cx - r)},{fmt(cy)}Z"
    )


def poly_path(points) -> str:
    head, *tail = points
    return f"M{fmt(head[0])},{fmt(head[1])}" + "".join(f"L{fmt(px)},{fmt(py)}" for px, py in tail) + "Z"


def shape_path(shape) -> str:
    if shape[0] == "rrect":
        return rrect_path(*shape[1:6])
    if shape[0] == "circle":
        return circle_path(*shape[1:4])
    return poly_path(shape[1])


def stripe_polygons():
    """Light diagonal mowing stripes (bands between the lines x + y = c0 and x + y = c1)."""
    polys = []
    w = STRIPE_WIDTH
    start = CENTER * 2 - w / 2  # a light band runs through the icon centre
    for k in range(-8, 9):
        c0 = start + 2 * k * w
        c1 = c0 + w
        if c1 > -20 and c0 < 2 * VIEW + 20:
            polys.append([(c0 + 10, -10), (c1 + 10, -10), (c1 - 130, 130), (c0 - 130, 130)])
    return polys


def check_safe_zone():
    worst = 0.0
    for s in map(transform, MOWER):
        if s[0] == "rrect":
            for (cx, cy), r, _ in rrect_corners(*s[1:6]):
                worst = max(worst, math.hypot(cx - CENTER, cy - CENTER) + r)
        elif s[0] == "circle":
            _, cx, cy, r, *_ = s
            worst = max(worst, math.hypot(cx - CENTER, cy - CENTER) + r)
        else:
            worst = max(worst, *(math.hypot(x - CENTER, y - CENTER) for x, y in s[1]))
    assert worst <= SAFE_RADIUS, f"mower leaves the 66dp safe zone (r={worst:.2f})"
    return worst


# ------------------------------------------------------------------------------------------
# Vector drawable output
# ------------------------------------------------------------------------------------------
HEADER = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<!-- Generated by tools/generate_icons.py - edit the script, not this file. -->\n"
)
VECTOR_OPEN = (
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"{extra}\n'
    '    android:width="108dp"\n'
    '    android:height="108dp"\n'
    '    android:viewportWidth="108"\n'
    '    android:viewportHeight="108">\n'
)


def color_attr(color: str) -> str:
    return "#FF" + color.lstrip("#").upper()


def path_element(path_data: str, color: str, alpha: float = 1.0, even_odd: bool = False) -> str:
    attrs = []
    if alpha < 1:
        attrs.append(f'android:fillAlpha="{fmt(alpha)}"')
    attrs.append(f'android:fillColor="{color_attr(color)}"')
    if even_odd:
        attrs.append('android:fillType="evenOdd"')
    attrs.append(f'android:pathData="{path_data}"')
    return "    <path\n" + "\n".join(f"        {a}" for a in attrs[:-1]) + ("\n" if len(attrs) > 1 else "") + \
        f"        {attrs[-1]} />\n"


def write_background_xml():
    stripes = "".join(poly_path(p) for p in stripe_polygons())
    items = "\n".join(
        f'                    <item android:offset="{fmt(o)}" android:color="{color_attr(c)}" />'
        for o, c in LAWN_STOPS
    )
    xml = (
        HEADER
        + VECTOR_OPEN.format(extra='\n    xmlns:aapt="http://schemas.android.com/aapt"')
        + f"""    <path android:pathData="M0,0H108V108H0Z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:centerX="{fmt(LAWN_CENTER[0])}"
                android:centerY="{fmt(LAWN_CENTER[1])}"
                android:gradientRadius="{fmt(LAWN_RADIUS)}"
                android:type="radial">
{items}
            </gradient>
        </aapt:attr>
    </path>
"""
        + path_element(stripes, STRIPE_COLOR, STRIPE_ALPHA)
        + "</vector>\n"
    )
    (RES / "drawable" / "ic_launcher_background.xml").write_text(xml)


def write_foreground_xml():
    body = ""
    for s in map(transform, MOWER):
        color, alpha, _ = style(s)
        body += path_element(shape_path(s), color, alpha)
    (RES / "drawable" / "ic_launcher_foreground.xml").write_text(HEADER + VECTOR_OPEN.format(extra="") + body + "</vector>\n")


def write_monochrome_xml():
    """Alpha-only silhouette for Android 13+ themed icons; the engine is cut out of the deck."""
    solids = "".join(shape_path(transform(s)) for s in MOWER if style(s)[2] == "solid")
    deck = shape_path(transform(("rrect", *DECK, "#000000", 1.0, None)))
    engine = shape_path(transform(("circle", *ENGINE, "#000000", 1.0, None)))
    body = path_element(deck + engine, "#FFFFFF", even_odd=True) + path_element(solids, "#FFFFFF")
    (RES / "drawable" / "ic_launcher_monochrome.xml").write_text(HEADER + VECTOR_OPEN.format(extra="") + body + "</vector>\n")


# ------------------------------------------------------------------------------------------
# Raster output (same geometry)
# ------------------------------------------------------------------------------------------
def hex_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def render_lawn(n: int) -> Image.Image:
    k = n / VIEW
    coords = (np.arange(n, dtype=np.float64) + 0.5) / k
    xx, yy = np.meshgrid(coords, coords)
    t = np.clip(np.hypot(xx - LAWN_CENTER[0], yy - LAWN_CENTER[1]) / LAWN_RADIUS, 0.0, 1.0)
    offsets = [o for o, _ in LAWN_STOPS]
    rgb = np.zeros((n, n, 3), dtype=np.float64)
    for ch in range(3):
        rgb[..., ch] = np.interp(t, offsets, [hex_rgb(c)[ch] for _, c in LAWN_STOPS])
    img = Image.fromarray(np.round(rgb).astype(np.uint8), "RGB").convert("RGBA")
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    fill = hex_rgb(STRIPE_COLOR) + (round(255 * STRIPE_ALPHA),)
    for poly in stripe_polygons():
        d.polygon([(px * k, py * k) for px, py in poly], fill=fill)
    img.alpha_composite(layer)
    return img


def draw_mower(img: Image.Image) -> None:
    k = img.width / VIEW
    for s in map(transform, MOWER):
        color, alpha, _ = style(s)
        fill = hex_rgb(color) + (round(255 * alpha),)
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        if s[0] == "rrect":
            d.polygon([(x * k, y * k) for x, y in rrect_points(*s[1:6])], fill=fill)
        elif s[0] == "circle":
            _, cx, cy, r, *_ = s
            d.ellipse([(cx - r) * k, (cy - r) * k, (cx + r) * k, (cy + r) * k], fill=fill)
        else:
            d.polygon([(x * k, y * k) for x, y in s[1]], fill=fill)
        img.alpha_composite(layer)


def render_icon(out_px: int, crop_dp: float) -> Image.Image:
    """Full composite, cropped to the central `crop_dp` of the 108 dp viewport."""
    full_px = math.ceil(out_px * SUPERSAMPLE * VIEW / crop_dp)
    img = render_lawn(full_px)
    draw_mower(img)
    margin = (VIEW - crop_dp) / 2 * full_px / VIEW
    box = (round(margin), round(margin), round(full_px - margin), round(full_px - margin))
    return img.crop(box).resize((out_px, out_px), Image.LANCZOS)


def masked(img: Image.Image, round_shape: bool) -> Image.Image:
    size = img.width
    ss = size * SUPERSAMPLE
    inset = ss * 1.5 / 48  # small transparent margin (1.5 of 48 dp), like the legacy icon grid
    mask = Image.new("L", (ss, ss), 0)
    d = ImageDraw.Draw(mask)
    box = [inset, inset, ss - inset, ss - inset]
    if round_shape:
        d.ellipse(box, fill=255)
    else:
        d.rounded_rectangle(box, radius=(ss - 2 * inset) * 0.2, fill=255)
    # Area averaging (no LANCZOS ringing) keeps the outside fully transparent, which also
    # keeps lint's IconLauncherShape round-icon check happy at small densities.
    mask = mask.resize((size, size), Image.BOX).point(lambda v: 0 if v < 4 else v)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


LEGACY_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
LEGACY_CROP_DP = 72.0  # what an adaptive-icon mask shows of the 108 dp layers
STORE_CROP_DP = 80.0


def write_pngs():
    for density, px in LEGACY_SIZES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        art = render_icon(px, LEGACY_CROP_DP)
        masked(art, round_shape=False).save(folder / "ic_launcher.png", optimize=True)
        masked(art, round_shape=True).save(folder / "ic_launcher_round.png", optimize=True)
    STORE.mkdir(parents=True, exist_ok=True)
    render_icon(512, STORE_CROP_DP).convert("RGB").save(STORE / "icon-512.png", optimize=True)


def main():
    worst = check_safe_zone()
    (RES / "drawable").mkdir(parents=True, exist_ok=True)
    write_background_xml()
    write_foreground_xml()
    write_monochrome_xml()
    write_pngs()
    print(f"Icons generated (mower extent r={worst:.1f}dp of {SAFE_RADIUS:g}dp safe zone).")


if __name__ == "__main__":
    main()
