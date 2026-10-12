# Режет листы фигурок «Танцев на поле» (public/stage/art/sheet-*.png, Figma AI, чёрный фон) на отдельные
# фигурки с прозрачным фоном: public/stage/art/<man|woman|any>-<1..6>.webp. Запуск: python3 scripts/stage-art.py
# Позы по порядку: 1 диско, 2 мах ногой, 3 звезда, 4 покачивание, 5 с микрофоном, 6 тянет канат.
# Все фигурки листа режутся по общей высоте (от самой высокой макушки до самых низких ног) — один масштаб,
# ноги на одной линии.
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ART = Path(__file__).resolve().parent.parent / "public" / "stage" / "art"
HEIGHT = 480  # высота готовой фигурки, px
POSES = 6


def cut(sheet: Path, name: str) -> None:
    img = np.asarray(Image.open(sheet).convert("RGB")).astype(np.float32)
    bright = img.max(axis=2)
    # Фигурки могут заходить друг за друга по горизонтали (рука над соседом) — делим по связным пятнам.
    mask = ndimage.binary_dilation(bright > 30, iterations=3)
    labels, count = ndimage.label(mask)
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    keep = [i + 1 for i in np.argsort(sizes)[::-1][:POSES]]
    if len(keep) != POSES or min(sizes[k - 1] for k in keep) < 0.15 * max(sizes):
        sys.exit(f"{sheet.name}: не нашлось {POSES} отдельных фигурок")
    boxes = {k: ndimage.find_objects((labels == k).astype(int))[0] for k in keep}
    keep.sort(key=lambda k: boxes[k][1].start)
    top = min(boxes[k][0].start for k in keep)
    bottom = max(boxes[k][0].stop for k in keep)
    for i, k in enumerate(keep, 1):
        xs = boxes[k][1]
        part = img[top:bottom, xs.start : xs.stop]
        own = labels[top:bottom, xs.start : xs.stop] == k
        # Прозрачность из яркости (чёрный фон → прозрачный, мягкий край), только своё пятно; цвет без примеси чёрного.
        alpha = np.clip((part.max(axis=2) - 14) / 60, 0, 1) * own
        rgb = np.where(alpha[..., None] > 0, np.clip(part / np.maximum(alpha[..., None], 1e-3), 0, 255), 0)
        rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
        out = Image.fromarray(rgba, "RGBA")
        w = round(out.width * HEIGHT / out.height)
        out = out.resize((w, HEIGHT), Image.LANCZOS)
        out.save(ART / f"{name}-{i}.webp", "WEBP", quality=88, method=6)
        print(f"{name}-{i}.webp {w}×{HEIGHT}")


for kind in ("man", "woman", "any"):
    cut(ART / f"sheet-{kind}.png", kind)
