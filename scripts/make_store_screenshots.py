#!/usr/bin/env python3
"""Compose Chrome Web Store screenshots (1280x800) from real UI captures."""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store"
DOCS = ROOT / "docs"

W, H = 1280, 800
BG = (245, 247, 250)  # 浅灰蓝背景
ACCENT = (37, 99, 235)  # CiteBeat 蓝
TEXT = (17, 24, 39)
SUB = (107, 114, 128)


def load_font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(
                p, size, index=1 if bold and p.endswith(".ttc") else 0
            )
        except Exception:
            continue
    return ImageFont.load_default()


def paste_with_shadow(canvas, img, pos, radius=24, shadow=18):
    """Paste img with a soft drop shadow and rounded look (no real rounding, soft shadow only)."""
    from PIL import ImageFilter

    shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sx, sy = pos
    sw, sh = img.size
    sd = Image.new("RGBA", (sw + shadow * 2, sh + shadow * 2), (0, 0, 0, 0))
    sd_draw = ImageDraw.Draw(sd)
    sd_draw.rectangle((shadow, shadow, shadow + sw, shadow + sh), fill=(0, 0, 0, 70))
    sd = sd.filter(ImageFilter.GaussianBlur(shadow / 2))
    shadow_layer.paste(sd, (sx - shadow, sy - shadow + 6), sd)
    canvas.alpha_composite(shadow_layer)
    canvas.alpha_composite(img.convert("RGBA"), pos)


def make_header(canvas, title, subtitle):
    draw = ImageDraw.Draw(canvas)
    icon_path = ROOT / "icons" / "icon128.png"
    icon = Image.open(icon_path).convert("RGBA").resize((72, 72))
    canvas.alpha_composite(icon, (80, 60))
    title_font = load_font(48, bold=True)
    sub_font = load_font(22)
    draw.text((172, 64), title, fill=TEXT, font=title_font)
    draw.text((172, 120), subtitle, fill=SUB, font=sub_font)


def shot1():
    """Popup 界面 + 标题:引用增长一目了然"""
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    make_header(canvas, "CiteBeat", "听见你引用的节拍 · 追踪每篇论文的引用增长")

    popup = Image.open(DOCS / "screenshot-popup.png").convert("RGBA")
    # 放大到约 560 宽
    ratio = 560 / popup.width
    popup = popup.resize((560, int(popup.height * ratio)), Image.LANCZOS)
    paste_with_shadow(canvas, popup, (80, 200))

    # 右侧说明
    draw = ImageDraw.Draw(canvas)
    tf = load_font(34, bold=True)
    bf = load_font(22)
    draw.text((720, 220), "本周期新增引用", fill=ACCENT, font=tf)
    bullets = [
        "• 按论文粒度记录基线",
        "• 实时显示增长数量与总引用",
        "• 支持 Google Scholar / Semantic Scholar",
        "• 一键手动刷新或重置基线",
    ]
    y = 285
    for b in bullets:
        draw.text((720, y), b, fill=TEXT, font=bf)
        y += 42

    canvas.convert("RGB").save(OUT / "screenshot-1-popup.png", "PNG", optimize=True)
    print("screenshot-1-popup.png")


def shot2():
    """Options 界面"""
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    make_header(canvas, "灵活配置", "双数据源切换 · 自定义刷新间隔")

    opts = Image.open(DOCS / "screenshot-options.png").convert("RGBA")
    # 缩小到 900 宽
    ratio = 900 / opts.width
    opts = opts.resize((900, int(opts.height * ratio)), Image.LANCZOS)
    # 可能超高，限高 520
    if opts.height > 520:
        r2 = 520 / opts.height
        opts = opts.resize((int(opts.width * r2), 520), Image.LANCZOS)
    x = (W - opts.width) // 2
    y = 220
    paste_with_shadow(canvas, opts, (x, y))

    canvas.convert("RGB").save(OUT / "screenshot-2-options.png", "PNG", optimize=True)
    print("screenshot-2-options.png")


def shot3():
    """品牌卡 + 双数据源示意"""
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    draw = ImageDraw.Draw(canvas)
    # 大标题居中
    big = load_font(72, bold=True)
    sub = load_font(28)
    tag = load_font(24, bold=True)

    title = "CiteBeat"
    tw = draw.textlength(title, font=big)
    draw.text(((W - tw) // 2, 150), title, fill=ACCENT, font=big)

    slogan = "听见你引用的节拍"
    sw = draw.textlength(slogan, font=sub)
    draw.text(((W - sw) // 2, 240), slogan, fill=SUB, font=sub)

    # 两个数据源卡
    def card(x, y, w, h, title_text, desc):
        draw.rounded_rectangle(
            (x, y, x + w, y + h),
            radius=20,
            fill=(255, 255, 255),
            outline=(226, 232, 240),
            width=2,
        )
        draw.text((x + 28, y + 28), title_text, fill=ACCENT, font=tag)
        draw.text((x + 28, y + 70), desc, fill=TEXT, font=load_font(20))

    card(
        180,
        360,
        420,
        220,
        "Google Scholar",
        "抓取作者主页\n总引用 + 论文明细\n更新及时",
    )
    card(680, 360, 420, 220, "Semantic Scholar", "官方 Graph API\n结构化数据\n更稳定")

    # 底部说明
    foot = load_font(20)
    ft = "MIT 开源 · Chrome MV3 · 无数据收集"
    fw = draw.textlength(ft, font=foot)
    draw.text(((W - fw) // 2, 640), ft, fill=SUB, font=foot)

    canvas.convert("RGB").save(OUT / "screenshot-3-hero.png", "PNG", optimize=True)
    print("screenshot-3-hero.png")


if __name__ == "__main__":
    shot1()
    shot2()
    shot3()
