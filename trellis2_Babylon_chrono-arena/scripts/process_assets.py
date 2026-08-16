#!/usr/bin/env python3
"""Create runtime-ready Chrono Arena sprites from generated source sheets."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "production"
SOURCES = ASSETS / "sources"
LANCZOS = Image.Resampling.LANCZOS


def save_square_sprite(source: Path, destination: Path, size: int, padding: float = 0.08) -> None:
    image = Image.open(source).convert("RGBA")
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"No visible pixels in {source}")

    subject = image.crop(alpha_box)
    usable = max(1, round(size * (1 - padding * 2)))
    scale = min(usable / subject.width, usable / subject.height)
    resized = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    canvas.save(destination, optimize=True)


def split_sheet(
    source: Path,
    names: tuple[str, str, str, str],
    size: int,
    transparent: bool,
    boxes: tuple[tuple[int, int, int, int], ...] | None = None,
) -> None:
    sheet = Image.open(source).convert("RGBA")
    half_w = sheet.width // 2
    half_h = sheet.height // 2
    cells = boxes or (
        (0, 0, half_w, half_h),
        (half_w, 0, sheet.width, half_h),
        (0, half_h, half_w, sheet.height),
        (half_w, half_h, sheet.width, sheet.height),
    )

    for name, box in zip(names, cells, strict=True):
        destination = ASSETS / name
        cell = sheet.crop(box)
        if transparent:
            temporary = SOURCES / f".{name}.cell.png"
            cell.save(temporary)
            save_square_sprite(temporary, destination, size)
            temporary.unlink()
        else:
            cell.resize((size, size), LANCZOS).save(destination, optimize=True)


def main() -> None:
    save_square_sprite(SOURCES / "hero-keyed.png", ASSETS / "hero.png", 640, padding=0.04)
    split_sheet(
        SOURCES / "enemies-keyed.png",
        ("enemy-chaser.png", "enemy-shooter.png", "enemy-thief.png", "enemy-boss.png"),
        512,
        transparent=True,
        # Keep the boss horns out of the shooter cell and recover their tips in the boss cell.
        boxes=((0, 0, 627, 575), (627, 0, 1254, 575), (0, 627, 627, 1254), (627, 560, 1254, 1254)),
    )
    split_sheet(
        SOURCES / "ability-icons-sheet.png",
        ("icon-slash.png", "icon-stop.png", "icon-rewind.png", "icon-dash.png"),
        256,
        transparent=False,
    )


if __name__ == "__main__":
    main()
