#!/usr/bin/env python3
"""Generate exact-size iPhone Home Screen launch PNGs for CRM Работа.
Run from repository root: python scripts/generate_ios_splash.py
Requires Pillow and CairoSVG. No production data or remote connections.
"""
from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons" / "startup"
BG = (251, 252, 255)
# (iPhone CSS width, CSS height, device pixel ratio)
DEVICES = ((390, 844, 3), (393, 852, 3), (402, 874, 3), (430, 932, 3))

# Copy of the inline radiator geometry from index.html, rendered without motion.
LOGO = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 190" fill="none">
<defs>
<linearGradient id="bars" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0eaff"/><stop offset="1" stop-color="#afc7f1"/></linearGradient>
<linearGradient id="flow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9cc4ff"/><stop offset=".6" stop-color="#579bf9"/><stop offset="1" stop-color="#7ba0ff"/></linearGradient>
<linearGradient id="drop" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#5ed2ff"/><stop offset="1" stop-color="#4165eb"/></linearGradient>
</defs>
<path d="M35 86H205" stroke="#a9c2eb" stroke-width="9" stroke-linecap="round"/>
<g fill="url(#bars)">
<rect x="40" y="43" width="36" height="104" rx="18"/>
<rect x="80" y="43" width="36" height="104" rx="18"/>
<rect x="120" y="43" width="36" height="104" rx="18"/>
<rect x="160" y="43" width="36" height="104" rx="18"/>
</g>
<rect x="25" y="88" width="16" height="10" rx="4" fill="#abc2ec"/>
<rect x="198" y="88" width="16" height="10" rx="4" fill="#abc2ec"/>
<path d="M118 65C107 80 95 95 95 109a24 24 0 0 0 48 0c0-14-13-29-25-44Z" fill="#fff" stroke="#fff" stroke-width="9"/>
<path d="M118 69c-10 15-20 28-20 41a20 20 0 0 0 40 0c0-13-11-27-20-41Z" fill="url(#drop)"/>
<path d="M108 104c1-7 5-13 8-18" stroke="#d5f7ff" stroke-width="4" stroke-linecap="round" opacity=".9"/>
<path d="M25 163C81 157 180 133 207 98C231 66 197 45 158 44" stroke="#e4ecfe" stroke-width="9" stroke-linecap="round"/>
<path d="M181 134C198 122 216 109 220 86" stroke="url(#flow)" stroke-width="6" stroke-linecap="round"/>
</svg>"""

def generate(css_width, css_height, dpr):
    w, h = css_width * dpr, css_height * dpr
    picture = Image.new("RGB", (w, h), BG)
    # The glow is prerendered so the native splash visually matches the CSS halo.
    radius = round(160 * dpr)
    halo = Image.new("RGBA", (radius * 2, radius * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(halo)
    for rad in range(radius, 0, -max(2, dpr * 2)):
        a = round(3 * (1 - rad / radius) ** 1.7)
        draw.ellipse((radius-rad, radius-rad, radius+rad, radius+rad),
                     fill=(150, 190, 255, a))
    halo = halo.filter(ImageFilter.GaussianBlur(16 * dpr))
    picture.paste(halo, (w//2-radius, h//2-radius), halo)

    logo_width = round(min(260, css_width * .72) * dpr)
    logo_height = round(logo_width * 190 / 240)
    raster = cairosvg.svg2png(bytestring=LOGO.encode("utf-8"),
                             output_width=logo_width, output_height=logo_height)
    logo = Image.open(BytesIO(raster)).convert("RGBA")
    picture.paste(logo, ((w-logo_width)//2, (h-logo_height)//2), logo)
    target = OUT / f"startup-{w}x{h}.png"
    # Paletted PNG compresses the large nearly uniform background drastically.
    picture.quantize(colors=24, method=Image.Quantize.MEDIANCUT,
                     dither=Image.Dither.NONE).save(target, format="PNG",
                                                    optimize=True, compress_level=9)
    with Image.open(target) as check:
        assert check.size == (w, h), target
        assert check.format == "PNG", target
    print(f"{target.relative_to(ROOT)} — {target.stat().st_size} bytes")

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for device in DEVICES:
        generate(*device)
