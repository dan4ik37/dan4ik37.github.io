# Значки приложения (PWA) из icon-512.png: «маскируемые» (Android вырезает круг/каплю — содержимое в безопасной зоне 80 %),
# одноцветный (purpose monochrome), значок уведомлений (строка состояния Android — только белое по прозрачному) и
# значки ярлыков (Мир, Чат, Игры, Слово дня, Магазин — как иконки в телефоне 📱: градиент + эмодзи Segoe UI Emoji).
# Запуск из корня сайта:  python -X utf8 scripts/make-app-icons.py   → img/app/*.png
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'img', 'app')
os.makedirs(OUT, exist_ok=True)
BG = (8, 8, 14, 255)          # --bg сайта, фон значка
SRC = Image.open(os.path.join(ROOT, 'icon-512.png')).convert('RGBA')


def save(im, name):
    p = os.path.join(OUT, name)
    im.save(p, optimize=True)
    print(name, im.size, os.path.getsize(p), 'байт')


# ── Маскируемые: картинка 512 уменьшена до 80 % по центру на том же фоне — кольцо целиком в безопасном круге (r = 40 %) ──
def maskable(size):
    canvas = Image.new('RGBA', (512, 512), BG)
    inner = SRC.resize((410, 410), Image.LANCZOS)
    canvas.alpha_composite(inner, (51, 51))
    return canvas.resize((size, size), Image.LANCZOS)


save(maskable(512), 'maskable-512.png')
save(maskable(192), 'maskable-192.png')


# ── Одноцветный: белое кольцо и «D37» по прозрачному (прозрачность — от яркости/насыщенности исходника) ──
def mono(size, pad=0.0):
    w, h = SRC.size
    m = Image.new('L', (w, h), 0)
    sp, mp = SRC.load(), m.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = sp[x, y]
            v = max(r, g, b)
            mp[x, y] = 0 if v < 40 else 255 if v > 140 else int((v - 40) * 255 / 100)
    m = m.filter(ImageFilter.GaussianBlur(0.6))
    im = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    im.putalpha(m)
    if pad:
        k = 1 - pad * 2
        canvas = Image.new('RGBA', (w, h), (255, 255, 255, 0))
        small = im.resize((int(w * k), int(h * k)), Image.LANCZOS)
        canvas.alpha_composite(small, ((w - small.width) // 2, (h - small.height) // 2))
        im = canvas
    return im.resize((size, size), Image.LANCZOS)


save(mono(512, 0.08), 'mono-512.png')
save(mono(96, 0.02), 'badge-96.png')

# ── Ярлыки: градиент + эмодзи. any — скруглённый квадрат (ПК, меню «Пуск»), maskable — на весь квадрат (Android) ──
EMOJI = ImageFont.truetype('C:/Windows/Fonts/seguiemj.ttf', 109)
SHORTCUTS = [
    ('world', chr(0x1F30D), (56, 189, 248), (37, 99, 235)),
    ('chat', chr(0x1F4AC), (192, 132, 252), (124, 58, 237)),
    ('games', chr(0x1F3AE), (251, 113, 133), (225, 29, 72)),
    ('words', chr(0x1F524), (74, 222, 128), (22, 163, 74)),
    ('shop', chr(0x1F48E), (103, 232, 249), (8, 145, 178)),
]


def gradient(size, c1, c2):
    g = Image.new('RGBA', (size, size))
    px = g.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    return g


def shortcut(ch, c1, c2, rounded, scale):
    S = 192
    im = gradient(S, c1, c2)
    d = ImageDraw.Draw(im)
    # эмодзи — в центре (у maskable меньше: обрезка круга не заденет)
    layer = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((128, 128), ch, font=EMOJI, embedded_color=True, anchor='mm')
    bbox = layer.getbbox()
    if bbox:
        layer = layer.crop(bbox)
    side = int(S * scale)
    k = side / max(layer.size)
    layer = layer.resize((max(1, int(layer.width * k)), max(1, int(layer.height * k))), Image.LANCZOS)
    shadow = Image.new('RGBA', im.size, (0, 0, 0, 0))
    sx, sy = (S - layer.width) // 2, (S - layer.height) // 2
    shadow.paste((0, 0, 0, 70), (sx, sy + 4), layer)
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5)))
    im.alpha_composite(layer, (sx, sy))
    if rounded:
        mask = Image.new('L', (S * 4, S * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S * 4 - 1, S * 4 - 1), radius=S * 4 * 22 // 100, fill=255)
        mask = mask.resize((S, S), Image.LANCZOS)
        im.putalpha(mask)
    return im


for key, ch, c1, c2 in SHORTCUTS:
    save(shortcut(ch, c1, c2, True, 0.58), f'sc-{key}.png')
    save(shortcut(ch, c1, c2, False, 0.46), f'sc-{key}-m.png')
