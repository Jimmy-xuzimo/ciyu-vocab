"""Generate matching PWA, Windows, and Android icons from the app's Chinese mark."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GREEN = "#2d6851"
GOLD = "#d8b47b"
WHITE = "#f5f7f4"
FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/msyhbd.ttc"),
    Path("C:/Windows/Fonts/msyh.ttc"),
    Path("/System/Library/Fonts/PingFang.ttc"),
    Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc"),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    raise FileNotFoundError("Install a Chinese sans-serif font to render the 词屿 app icon.")


def draw_mark(size: int, *, background: bool, round_icon: bool = False) -> Image.Image:
    image_bg = (0, 0, 0, 0) if not background or round_icon else GREEN
    image = Image.new("RGBA", (size, size), image_bg)
    draw = ImageDraw.Draw(image)
    if round_icon:
        draw.ellipse((0, 0, size - 1, size - 1), fill=GREEN)
    elif background:
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.25), fill=GREEN)
    draw.text(
        (size * 0.48, size * 0.53),
        "屿",
        font=font(round(size * (0.62 if background else 0.58))),
        fill=WHITE,
        anchor="mm",
        stroke_width=max(0, round(size * 0.006)),
        stroke_fill=WHITE,
    )
    draw.ellipse(
        (size * 0.72, size * 0.18, size * 0.85, size * 0.31),
        fill=GOLD,
    )
    return image


def main() -> None:
    public = ROOT / "public"
    icons = public / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    draw_mark(192, background=True).convert("RGB").save(icons / "icon-192.png", optimize=True)
    draw_mark(512, background=True).convert("RGB").save(icons / "icon-512.png", optimize=True)
    draw_mark(512, background=True).save(public / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    for density, scale in (("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)):
        launcher_size = round(48 * scale)
        foreground_size = round(108 * scale)
        folder = ROOT / "android/app/src/main/res" / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        draw_mark(launcher_size, background=True).convert("RGB").save(folder / "ic_launcher.png", optimize=True)
        draw_mark(launcher_size, background=True, round_icon=True).convert("RGB").save(folder / "ic_launcher_round.png", optimize=True)
        draw_mark(foreground_size, background=False).save(folder / "ic_launcher_foreground.png", optimize=True)


if __name__ == "__main__":
    main()
