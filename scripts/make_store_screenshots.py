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
    """Find a CJK-capable font. The bitmap fallback cannot render Chinese,
    so fail loudly rather than silently emitting tofu boxes."""
    candidates = [
        # macOS
        ("/System/Library/Fonts/PingFang.ttc", 1 if bold else 0),
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
        # Windows
        (r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc", 0),
        (r"C:\Windows\Fonts\simhei.ttf", 0),
        (r"C:\Windows\Fonts\simsun.ttc", 0),
        # Linux
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc" if bold
         else "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
        ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
    ]
    for path, index in candidates:
        try:
            return ImageFont.truetype(path, size, index=index)
        except Exception:
            continue
    raise SystemExit(
        "No CJK font found. Install one, or add its path to load_font().\n"
        "The default bitmap font renders Chinese as empty boxes, which would\n"
        "silently produce broken store screenshots."
    )


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
    # Fit inside the 200..760 band so nothing is clipped by the canvas edge.
    MAX_W, MAX_H = 560, 560
    ratio = min(MAX_W / popup.width, MAX_H / popup.height)
    popup = popup.resize(
        (int(popup.width * ratio), int(popup.height * ratio)), Image.LANCZOS
    )
    paste_with_shadow(canvas, popup, (110, 200))

    # 右侧说明
    draw = ImageDraw.Draw(canvas)
    tf = load_font(34, bold=True)
    bf = load_font(22)
    draw.text((760, 240), "本周期新增引用", fill=ACCENT, font=tf)
    bullets = [
        "• 按论文粒度记录基线",
        "• 引用减少或被合并也单独列出",
        "• 内置引用趋势图",
        "• 支持 Google Scholar / Semantic Scholar",
    ]
    y = 305
    for b in bullets:
        draw.text((760, y), b, fill=TEXT, font=bf)
        y += 42

    canvas.convert("RGB").save(OUT / "screenshot-1-popup.png", "PNG", optimize=True)
    print("screenshot-1-popup.png")


def shot2():
    """Options 界面"""
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    make_header(canvas, "灵活配置", "双数据源切换 · 自动统计周期 · 可选主页上报")

    opts = Image.open(DOCS / "screenshot-options.png").convert("RGBA")
    # The options page is far taller than the 1280x800 canvas. Scaling the
    # whole page down makes the text unreadable, so crop to the top section
    # instead. Raise CROP if the page grows and the cut lands mid-field.
    CROP = 0.54
    opts = opts.crop((0, 0, opts.width, int(opts.height * CROP)))

    MAX_W, MAX_H = 700, 560
    ratio = min(MAX_W / opts.width, MAX_H / opts.height)
    opts = opts.resize(
        (int(opts.width * ratio), int(opts.height * ratio)), Image.LANCZOS
    )
    paste_with_shadow(canvas, opts, (80, 200))

    draw = ImageDraw.Draw(canvas)
    tf = load_font(34, bold=True)
    bf = load_font(22)
    draw.text((830, 240), "按你的习惯配置", fill=ACCENT, font=tf)
    bullets = [
        "• 双数据源随时切换",
        "• 手动 / 每周 / 每月 / 每 N 天",
        "• 可选上报到自己的主页",
        "• 数据默认仅存本地",
    ]
    y = 305
    for b in bullets:
        draw.text((830, y), b, fill=TEXT, font=bf)
        y += 42

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
    ft = "开源 · Chrome MV3 · 数据默认仅存本地"
    fw = draw.textlength(ft, font=foot)
    draw.text(((W - fw) // 2, 640), ft, fill=SUB, font=foot)

    canvas.convert("RGB").save(OUT / "screenshot-3-hero.png", "PNG", optimize=True)
    print("screenshot-3-hero.png")


if __name__ == "__main__":
    shot1()
    shot2()
    shot3()
