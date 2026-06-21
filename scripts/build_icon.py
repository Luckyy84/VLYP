from io import BytesIO
from pathlib import Path
import struct

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SIZES = (16, 24, 32, 48, 64, 128, 256)
SUPERSAMPLE = 4

V_POINTS = (
    (224, 256), (352, 256), (352, 448), (416, 448),
    (416, 576), (480, 576), (480, 704), (544, 704),
    (544, 576), (608, 576), (608, 448), (672, 448),
    (672, 256), (800, 256), (800, 512), (736, 512),
    (736, 640), (672, 640), (672, 768), (608, 768),
    (608, 832), (416, 832), (416, 768), (352, 768),
    (352, 640), (288, 640), (288, 512), (224, 512),
)

V_16_RECTS = (
    (4, 4, 5, 7), (10, 4, 11, 7),
    (5, 7, 6, 10), (9, 7, 10, 10),
    (6, 10, 7, 12), (8, 10, 9, 12),
    (7, 12, 8, 13),
)


def render(size: int) -> Image.Image:
    sample = 1 if size <= 32 else SUPERSAMPLE
    canvas_size = size * sample
    scale = canvas_size / 1024
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    left = round(64 * scale)
    top = round(64 * scale)
    right = round(960 * scale) - 1
    bottom = round(960 * scale) - 1
    tile = (left, top, right, bottom)
    draw.rounded_rectangle(tile, radius=round(192 * scale), fill=(0, 0, 0, 255))
    if size == 16:
        for rectangle in V_16_RECTS:
            draw.rectangle(rectangle, fill=(255, 255, 255, 255))
    else:
        points = [(round(x * scale), round(y * scale)) for x, y in V_POINTS]
        draw.polygon(points, fill=(255, 255, 255, 255))

    if sample == 1:
        return image
    return image.resize((size, size), Image.Resampling.LANCZOS)


def png_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def create_ico(frames: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(frames))
    data_offset = 6 + 16 * len(frames)
    entries = []
    payloads = []

    for size, payload in frames:
        dimension = 0 if size == 256 else size
        entries.append(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(payload), data_offset))
        payloads.append(payload)
        data_offset += len(payload)

    return header + b"".join(entries) + b"".join(payloads)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    render(1024).save(ASSETS / "vlyp-icon.png", format="PNG", optimize=True)
    frames = [(size, png_bytes(render(size))) for size in SIZES]
    (ASSETS / "vlyp-icon.ico").write_bytes(create_ico(frames))


if __name__ == "__main__":
    main()
