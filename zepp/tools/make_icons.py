"""Rasterise SimpleWear's Android vector drawables into PNG icons for the Zepp OS app.

Android VectorDrawable paths use SVG path syntax, so each drawable is rewritten as an SVG and
rendered with ImageMagick. Run from anywhere:  python -I zepp/tools/make_icons.py
"""

import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DRAWABLES = os.path.join(ROOT, "shared_resources", "src", "main", "res", "drawable")
OUT = os.path.join(ROOT, "zepp", "assets", "common.r", "icons")
ANDROID = "{http://schemas.android.com/apk/res/android}"

SIZE = 56  # px on a 480-wide design; tiles are 112 px

# watch icon name -> SimpleWear drawable
ICONS = {
    "wifi_on": "ic_network_wifi_white_24dp",
    "wifi_off": "ic_signal_wifi_off_white_24dp",
    "bt_on": "ic_bluetooth_white_24dp",
    "bt_off": "ic_bluetooth_disabled_white_24dp",
    "data_on": "ic_network_cell_white_24dp",
    "data_off": "ic_signal_cellular_off_white_24dp",
    "location_on": "ic_location_on_white_24dp",
    "location_off": "ic_location_off_white_24dp",
    "torch": "ic_lightbulb_outline_white_24dp",
    "lock": "ic_lock_white_24dp",
    "volume": "ic_volume_up_white_24dp",
    "dnd_off": "ic_do_not_disturb_off_white_24dp",
    "dnd_on": "ic_do_not_disturb_silence_white_24dp",
    "ringer_vibrate": "ic_vibration_white_24dp",
    "ringer_silent": "ic_volume_off_white_24dp",
    "ringer_sound": "ic_notifications_active_white_24dp",
    "hotspot": "ic_wifi_tethering",
    "nfc_on": "ic_nfc_on",
    "nfc_off": "ic_nfc_off",
    "battery_saver": "ic_battery_saver",
    "brightness": "ic_brightness_medium",
    "apps": "ic_apps_white_24dp",
    "battery_charging": "ic_battery_charging_white_24dp",
    "battery": "ic_battery_std_white_24dp",
    "gestures": "ic_touch_app",
    "timed": "ic_timelapse",
    "music": "ic_music_note_white_24dp",
}


def to_svg(vector_path):
    root = ET.parse(vector_path).getroot()
    vw = root.get(ANDROID + "viewportWidth")
    vh = root.get(ANDROID + "viewportHeight")
    parts = []

    def walk(node, transform=""):
        for child in node:
            tag = child.tag
            if tag == "group":
                t = []
                tx = child.get(ANDROID + "translateX")
                ty = child.get(ANDROID + "translateY")
                if tx or ty:
                    t.append("translate(%s %s)" % (tx or 0, ty or 0))
                sx = child.get(ANDROID + "scaleX")
                sy = child.get(ANDROID + "scaleY")
                if sx or sy:
                    t.append("scale(%s %s)" % (sx or 1, sy or 1))
                parts.append('<g transform="%s">' % " ".join(t))
                walk(child)
                parts.append("</g>")
            elif tag == "path":
                d = child.get(ANDROID + "pathData")
                rule = "evenodd" if child.get(ANDROID + "fillType") == "evenOdd" else "nonzero"
                alpha = child.get(ANDROID + "fillAlpha") or "1"
                stroke = child.get(ANDROID + "strokeWidth")
                if stroke and not child.get(ANDROID + "fillColor"):
                    parts.append('<path d="%s" fill="none" stroke="#fff" stroke-width="%s"/>' % (d, stroke))
                else:
                    parts.append('<path d="%s" fill="#fff" fill-opacity="%s" fill-rule="%s"/>' % (d, alpha, rule))

    walk(root)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s">%s</svg>' % (vw, vh, "".join(parts))


BATTERY_STEPS = 7  # battery_0 (empty) .. battery_7 (full)
BATTERY_SIZE = 40


def battery_svg(level, charging):
    """Vertical battery outline with a fill proportional to `level` / BATTERY_STEPS."""
    inner_top, inner_bottom = 6.5, 20.5
    h = (inner_bottom - inner_top) * level / BATTERY_STEPS
    parts = [
        '<rect x="10" y="1.5" width="4" height="2.5" rx="0.8" fill="#fff"/>',
        '<rect x="6.5" y="4" width="11" height="18.5" rx="2" fill="none" stroke="#fff" stroke-width="1.6"/>',
    ]
    if h > 0:
        parts.append('<rect x="8.5" y="%.2f" width="7" height="%.2f" rx="0.8" fill="#fff"/>' % (inner_bottom - h, h))
    if charging:
        # dark-edged bolt stays readable over both the fill and the empty part
        parts.append('<path d="M13.2 7.5 L8.8 14 H11.6 L10.8 19.5 L15.2 12.8 H12.4 Z" fill="#fff" '
                     'stroke="#000" stroke-width="1.1" stroke-linejoin="round"/>')
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">%s</svg>' % "".join(parts)


def render(svg_text, png, size, tmp, name):
    svg = os.path.join(tmp, name + ".svg")
    with open(svg, "w", encoding="utf-8") as f:
        f.write(svg_text)
    subprocess.run(
        ["magick", "-background", "none", "-density", "600", svg,
         # Zepp OS only decodes 8-bit RGBA; ImageMagick keeps 16 bits from SVG otherwise
         "-resize", "%dx%d" % (size, size), "-depth", "8",
         "-define", "png:bit-depth=8", "-define", "png:color-type=6", png],
        check=True,
    )


CARD_BATTERY_SIZE = 50  # shortcut card: matches the visual height of the 56 px Material icons

DIM = "#5c5c5c"


def segmented_svg(drawable, lit):
    """SimpleWear vector split into its subpaths; `lit(i, n)` decides which ones are white."""
    root = ET.parse(os.path.join(DRAWABLES, drawable + ".xml")).getroot()
    vw = root.get(ANDROID + "viewportWidth")
    vh = root.get(ANDROID + "viewportHeight")
    d = root.find("path").get(ANDROID + "pathData")
    subpaths = [p + "Z" for p in d.split("Z") if p.strip()]
    parts = ['<path d="%s" fill="%s"/>' % (sp, "#fff" if lit(i, len(subpaths)) else DIM)
             for i, sp in enumerate(subpaths)]
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s">%s</svg>' % (vw, vh, "".join(parts))


# Wi-Fi: subpaths are big arc, middle arc, dot -> level k lights the k innermost parts (0..3)
WIFI_PARTS = 3
# Cellular: four bars left to right -> level k lights the first k bars (0..4)
CELL_PARTS = 4


def main():
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for level in range(BATTERY_STEPS + 1):
            for charging in (False, True):
                name = "battery_%s%d" % ("c" if charging else "", level)
                render(battery_svg(level, charging), os.path.join(OUT, name + ".png"), BATTERY_SIZE, tmp, name)
                card = "card_" + name
                render(battery_svg(level, charging), os.path.join(OUT, card + ".png"), CARD_BATTERY_SIZE, tmp, card)
        for level in range(WIFI_PARTS + 1):
            svg = segmented_svg("ic_network_wifi_white_24dp", lambda i, n, k=level: i >= n - k)
            render(svg, os.path.join(OUT, "wifi_l%d.png" % level), SIZE, tmp, "wifi_l%d" % level)
        for level in range(CELL_PARTS + 1):
            svg = segmented_svg("ic_network_cell_white_24dp", lambda i, n, k=level: i < k)
            render(svg, os.path.join(OUT, "cell_l%d.png" % level), SIZE, tmp, "cell_l%d" % level)

        for name, drawable in ICONS.items():
            svg = os.path.join(tmp, name + ".svg")
            with open(svg, "w", encoding="utf-8") as f:
                f.write(to_svg(os.path.join(DRAWABLES, drawable + ".xml")))
            png = os.path.join(OUT, name + ".png")
            subprocess.run(
                ["magick", "-background", "none", "-density", "600", svg,
                 # Zepp OS only decodes 8-bit RGBA; ImageMagick keeps 16 bits from SVG otherwise
                 "-resize", "%dx%d" % (SIZE, SIZE), "-depth", "8",
                 "-define", "png:bit-depth=8", "-define", "png:color-type=6", png],
                check=True,
            )
            print(name)


if __name__ == "__main__":
    sys.exit(main())
