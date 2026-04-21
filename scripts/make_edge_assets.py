#!/usr/bin/env python3
"""Generate Edge Add-ons store assets (different sizes from Chrome)."""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "edge"
OUT.mkdir(parents=True, exist_ok=True)

ACCENT = (37, 99, 235)
TEXT = (17, 24, 39)
SUB = (107, 114, 128)
BG = (245, 247, 250)


def font(size, bold=False):
    path = "/System/Library/Fonts/PingFang.ttc"
    try:
        return ImageFont.truetype(path, size, index=1 if bold else 0)
    except Exception:
        return ImageFont.load_default()


def logo_300():
    """Edge store logo: 300x300 PNG, square, the brand mark."""
    src = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA")
    # Upscale 128→300 with good filter, center on white
    canvas = Image.new("RGBA", (300, 300), (255, 255, 255, 255))
    up = src.resize((260, 260), Image.LANCZOS)
    canvas.alpha_composite(up, (20, 20))
    canvas.convert("RGB").save(OUT / "logo-300.png", "PNG", optimize=True)
    print("logo-300.png")


def promo_tile_920():
    """Edge promotional tile: 920x680."""
    W, H = 920, 680
    canvas = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    # Gradient-ish top band
    for y in range(260):
        t = y / 260
        r = int(37 + (99 - 37) * t * 0.3)
        g = int(99 + (160 - 99) * t * 0.3)
        b = int(235 + (255 - 235) * t * 0.2)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Icon left
    icon = (
        Image.open(ROOT / "icons" / "icon128.png")
        .convert("RGBA")
        .resize((140, 140), Image.LANCZOS)
    )
    canvas.alpha_composite(icon, (70, 70))

    # Title + slogan
    draw.text((230, 80), "CiteBeat", fill=(255, 255, 255), font=font(68, bold=True))
    draw.text((232, 160), "听见你引用的节拍", fill=(230, 240, 255), font=font(30))

    # Lower content area
    draw.text((70, 300), "追踪每篇论文的引用增长", fill=TEXT, font=font(40, bold=True))
    bullets = [
        "双数据源  ·  Google Scholar + Semantic Scholar",
        "按论文粒度记录基线，本周期新增一目了然",
        "Chrome / Edge MV3  ·  MIT 开源  ·  无数据收集",
    ]
    y = 380
    for b in bullets:
        draw.ellipse((72, y + 10, 84, y + 22), fill=ACCENT)
        draw.text((100, y), b, fill=TEXT, font=font(24))
        y += 55

    # Footer
    draw.text((70, 610), "github.com/sci-m-wang/CiteBeat", fill=SUB, font=font(20))

    canvas.convert("RGB").save(OUT / "promo-tile-920x680.png", "PNG", optimize=True)
    print("promo-tile-920x680.png")


def small_tile_440():
    """Optional small tile 440x280 — reuse Chrome small promo structure."""
    W, H = 440, 280
    canvas = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    for y in range(H):
        t = y / H
        r = int(37 + (99 - 37) * t * 0.4)
        g = int(99 + (160 - 99) * t * 0.4)
        b = int(235 - 10 * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    icon = (
        Image.open(ROOT / "icons" / "icon128.png")
        .convert("RGBA")
        .resize((80, 80), Image.LANCZOS)
    )
    canvas.alpha_composite(icon, (30, 30))
    draw.text((130, 36), "CiteBeat", fill=(255, 255, 255), font=font(40, bold=True))
    draw.text((132, 88), "听见你引用的节拍", fill=(220, 232, 255), font=font(18))
    draw.text(
        (30, 160),
        "追踪 Google Scholar &",
        fill=(255, 255, 255),
        font=font(22, bold=True),
    )
    draw.text(
        (30, 195),
        "Semantic Scholar 引用增长",
        fill=(255, 255, 255),
        font=font(22, bold=True),
    )
    draw.text((30, 240), "MIT · Chrome MV3", fill=(220, 232, 255), font=font(16))
    canvas.convert("RGB").save(OUT / "promo-tile-440x280.png", "PNG", optimize=True)
    print("promo-tile-440x280.png")


if __name__ == "__main__":
    logo_300()
    promo_tile_920()
    small_tile_440()
