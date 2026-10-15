# Картинки-превью 1200×630 для ссылок «Брось вызов» (img/games/<id>.png)
#   python -X utf8 img/games/_make-cards.py            — все
#   python -X utf8 img/games/_make-cards.py krokodil   — только перечисленные (остальные PNG не трогаются)
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))   # рядом со скриптом (в своей копии репозитория)
ONLY = set(sys.argv[1:])
os.makedirs(OUT, exist_ok=True)
F = r'C:\Windows\Fonts'
bold = lambda s: ImageFont.truetype(os.path.join(F, 'segoeuib.ttf'), s)
reg = lambda s: ImageFont.truetype(os.path.join(F, 'segoeui.ttf'), s)
emoji = ImageFont.truetype(os.path.join(F, 'seguiemj.ttf'), 320)

GAMES = [
    ('words', '🔤', '5 букв', '#22c55e'),
    ('cities', '🌍', 'Города', '#29b6f6'),
    ('sea', '🚢', 'Морской бой', '#38bdf8'),
    ('checkers', '⚫', 'Шашки', '#e5e7eb'),
    ('snake', '🐍', 'Змейка', '#22c55e'),
    ('2048', '🧩', '2048', '#ffd166'),
    ('memory', '🃏', 'Найди пару', '#f472b6'),
    ('ttt', '❌', 'Крестики-нолики', '#9147ff'),
    ('reaction', '⚡', 'Реакция', '#22c55e'),
    ('emoji', '🤔', 'Угадай игру по эмодзи', '#f59e0b'),
    ('horde', '🧟', 'Орда', '#a855f7'),
    ('td', '🏰', 'Башни', '#f97316'),
    ('uno', '🃏', 'Одна!', '#e5383b'),
    ('durak', '♠️', 'Дурак', '#d42a3b'),
    ('pool', '🎱', 'Бильярд', '#1f9a5a'),
    ('ludo', '🎲', 'Лудо', '#3b82f6'),
    ('nardy', '🎯', 'Нарды', '#8b1d2c'),
    ('arena', '🔫', 'Арена', '#f97316'),
    ('chess', '♟️', 'Шахматы', '#94a3b8'),
    ('blocks', 'draw:blocks', 'Блоки', '#3b82f6'),
    ('kosynka', 'draw:cards', 'Косынка', '#22c55e'),
    ('pauk', '🕷️', 'Паук', '#a855f7'),
    ('freecell', '♣️', 'Свободная ячейка', '#38bdf8'),
    ('miner', '💣', 'Сапёр', '#ef4444'),
    ('mahjong', '🀄', 'Маджонг Коннект', '#f59e0b'),
    ('sudoku', 'draw:sudoku', 'Судоку', '#60a5fa'),
    ('krokodil', 'draw:kroko', 'Крокодил', '#22c55e'),
    ('balda', 'draw:balda', 'Балда', '#f59e0b'),
    ('domino', 'draw:domino', 'Домино', '#e5e7eb'),
    ('fillword', 'draw:fillword', 'Филворд', '#a855f7'),
    ('podzem', 'draw:podzem', 'Подземье', '#d9783a'),
    ('kubomir', 'draw:kubomir', 'Кубомир', '#4f8cff'),
    ('catch', '💰', 'Лови донаты', '#ffd166'),
    ('guess', '🎬', 'Угадай видео', '#ff2d55'),
    ('studio3d', '🧱', 'Студия 3D', '#f59e0b'),
    ('world', '🌍', 'Мир Денчика', '#60a5fa'),
    ('unity', '🕹️', 'Unity-игры', '#7dd3fc'),
    ('raid', '⚔️', 'Набеги', '#ef4444'),
    ('games', '🎮', 'Игры онлайн', '#ff2d55'),
]

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# «Блоки»: мини-поле с цветными кубиками вместо эмодзи
def draw_blocks():
    cols = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899']
    pic = ['..2.6', '.1126', '00.66', '3.444', '33.47', '..5.7']
    cs, pad = 66, 14
    im = Image.new('RGBA', (cs * 5 + pad * 2, cs * 6 + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, im.height - 1), 26, fill=(20, 24, 56, 255))
    for r, row in enumerate(pic):
        for c, ch in enumerate(row):
            x, y = pad + c * cs, pad + r * cs
            if ch == '.':
                d.rounded_rectangle((x + 3, y + 3, x + cs - 3, y + cs - 3), 10, fill=(32, 38, 79, 255))
                continue
            base = hex2rgb(cols[int(ch)])
            d.rounded_rectangle((x + 3, y + 3, x + cs - 3, y + cs - 3), 12, fill=base)
            d.rounded_rectangle((x + 3, y + 3, x + cs - 3, y + cs // 2), 12, fill=tuple(min(255, int(v * .55 + 115)) for v in base))
            d.rounded_rectangle((x + 3, y + cs // 2 - 6, x + cs - 3, y + cs - 3), 12, fill=base)
            d.rounded_rectangle((x + 3, y + cs - 16, x + cs - 3, y + cs - 3), 10, fill=tuple(int(v * .72) for v in base))
            d.rounded_rectangle((x + 18, y + 16, x + cs - 18, y + cs - 22), 8, fill=tuple(min(255, int(v * .8 + 60)) for v in base))
    return im

# «Судоку»: поле 9×9 с цифрами
def draw_sudoku():
    cs, pad = 52, 12
    im = Image.new('RGBA', (cs * 9 + pad * 2, cs * 9 + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, im.height - 1), 24, fill=(248, 250, 252, 255))
    grid = ['53..7....', '6..195...', '.98....6.', '8...6...3', '4..8.3..1', '7...2...6', '.6....28.', '...419..5', '....8..79']
    mine = {(0, 2): '4', (1, 1): '7', (2, 0): '1', (4, 4): '5', (6, 4): '3'}
    f = bold(34)
    for r in range(9):
        for c in range(9):
            x, y = pad + c * cs, pad + r * cs
            if (r // 3 + c // 3) % 2 == 0:
                d.rectangle((x, y, x + cs, y + cs), fill=(226, 236, 250, 255))
            ch = grid[r][c]
            if ch != '.':
                d.text((x + cs / 2, y + cs / 2 + 1), ch, font=f, fill=(30, 41, 59), anchor='mm')
            elif (r, c) in mine:
                d.text((x + cs / 2, y + cs / 2 + 1), mine[(r, c)], font=f, fill=(37, 99, 235), anchor='mm')
    for k in range(10):
        w = 4 if k % 3 == 0 else 1
        d.line((pad + k * cs, pad, pad + k * cs, pad + 9 * cs), fill=(51, 65, 85), width=w)
        d.line((pad, pad + k * cs, pad + 9 * cs, pad + k * cs), fill=(51, 65, 85), width=w)
    return im

# «Косынка»: веер из трёх карт
def draw_cards():
    im = Image.new('RGBA', (620, 560), (0, 0, 0, 0))
    sym = ImageFont.truetype(os.path.join(F, 'seguisym.ttf'), 120)
    cards = [('Т', '♠', (25, 25, 32), -16), ('К', '♥', (214, 32, 47), 0), ('Д', '♦', (214, 32, 47), 16)]
    for i, (rank, suit, col, ang) in enumerate(cards):
        c = Image.new('RGBA', (250, 350), (0, 0, 0, 0))
        d = ImageDraw.Draw(c)
        d.rounded_rectangle((0, 0, 249, 349), 26, fill=(253, 253, 251, 255), outline=(190, 194, 204, 255), width=3)
        d.text((22, 12), rank, font=bold(84), fill=col)
        d.text((150, 26), suit, font=ImageFont.truetype(os.path.join(F, 'seguisym.ttf'), 64), fill=col)
        d.text((125, 230), suit, font=sym, fill=col, anchor='mm')
        c = c.rotate(-ang, expand=True, resample=Image.BICUBIC)
        im.alpha_composite(c, (60 + i * 130 - c.width // 2 + 125, 280 - c.height // 2 + (0 if i == 1 else 30)))
    return im.crop(im.getbbox())

# «Крокодил»: холст с рисунком (солнце и домик) и крокодил с карандашом
def draw_kroko():
    im = Image.new('RGBA', (560, 470), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, 470, 360), 30, fill=(255, 255, 255, 255), outline=(30, 30, 40, 255), width=6)
    k = (26, 26, 26)
    d.ellipse((50, 40, 160, 150), fill=(253, 216, 53), outline=k, width=7)
    for x0, y0, x1, y1 in [(105, 10, 105, 30), (105, 160, 105, 180), (20, 95, 40, 95), (170, 95, 190, 95), (45, 35, 60, 50), (150, 140, 165, 155), (165, 35, 150, 50), (45, 155, 60, 140)]:
        d.line((x0, y0, x1, y1), fill=(251, 140, 0), width=9)
    d.polygon([(230, 190), (330, 100), (430, 190)], fill=(229, 57, 53), outline=k)
    d.line([(230, 190), (330, 100), (430, 190), (230, 190)], fill=k, width=7)
    d.rectangle((250, 190, 410, 320), fill=(253, 216, 53), outline=k, width=7)
    d.rectangle((310, 245, 350, 320), fill=(141, 85, 36), outline=k, width=6)
    d.rectangle((265, 210, 300, 245), fill=(79, 195, 247), outline=k, width=6)
    em = Image.new('RGBA', (700, 700), (0, 0, 0, 0))
    ImageDraw.Draw(em).text((120, 120), '🐊', font=emoji, embedded_color=True)
    em = em.crop(em.getbbox()); em.thumbnail((190, 190), Image.LANCZOS)
    im.alpha_composite(em, (545 - em.width, 455 - em.height))
    return im

# «Балда»: поле 5×5, в середине «БАЛДА», выделено слово ЛАК (новая буква К)
def draw_balda():
    rows = ['.....', '.К...', 'БАЛДА', '.Т...', '.....']
    cs, pad, g = 96, 14, 8
    im = Image.new('RGBA', (cs * 5 + pad * 2, cs * 5 + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, im.height - 1), 28, fill=(40, 30, 18, 255))
    path = {(2, 2): 1, (2, 1): 2, (1, 1): 3}
    f = bold(62)
    for r in range(5):
        for c in range(5):
            x, y = pad + c * cs + g // 2, pad + r * cs + g // 2
            ch = rows[r][c]
            fill = (255, 214, 102, 255) if (r, c) == (1, 1) else (134, 239, 172, 255) if (r, c) in path else (251, 243, 219, 255) if ch != '.' else (74, 58, 38, 255)
            d.rounded_rectangle((x, y, x + cs - g, y + cs - g), 16, fill=fill)
            if ch != '.':
                d.text((x + (cs - g) / 2, y + (cs - g) / 2 + 2), ch, font=f, fill=(40, 30, 18), anchor='mm')
    return im

# «Домино»: три костяшки цепочкой
def draw_domino():
    im = Image.new('RGBA', (620, 520), (0, 0, 0, 0))
    PIPS = {0: [], 1: [(.5, .5)], 2: [(.25, .25), (.75, .75)], 3: [(.25, .25), (.5, .5), (.75, .75)], 4: [(.25, .25), (.75, .25), (.25, .75), (.75, .75)],
            5: [(.25, .25), (.75, .25), (.5, .5), (.25, .75), (.75, .75)], 6: [(.25, .2), (.75, .2), (.25, .5), (.75, .5), (.25, .8), (.75, .8)]}
    def tile(a, b, ang):
        t = Image.new('RGBA', (180, 350), (0, 0, 0, 0))
        d = ImageDraw.Draw(t)
        d.rounded_rectangle((4, 4, 176, 346), 26, fill=(250, 248, 240, 255), outline=(60, 60, 70, 255), width=6)
        d.line((24, 175, 156, 175), fill=(60, 60, 70), width=6)
        for half, n in ((0, a), (1, b)):
            for px, py in PIPS[n]:
                cx, cy = 14 + px * 152, 14 + half * 166 + py * 152
                d.ellipse((cx - 17, cy - 17, cx + 17, cy + 17), fill=(30, 30, 36))
        return t.rotate(ang, expand=True, resample=Image.BICUBIC)
    for (a, b, ang, x, y) in [(6, 6, 0, 10, 40), (6, 3, 90, 170, 130), (3, 1, 0, 440, 60)]:
        t = tile(a, b, ang)
        im.alpha_composite(t, (x, y))
    return im.crop(im.getbbox())

# «Филворд»: поле 5×5 целиком из слов, найденные слова подкрашены
def draw_fillword():
    rows = ['КОШКА', 'ЗАСИЛ', 'АСЛОН', 'ЯВОЛК', 'ЦМЫШЬ']
    words = [([(0, 0), (0, 1), (0, 2), (0, 3), (0, 4)], (253, 224, 71)), ([(1, 4), (1, 3), (1, 2), (1, 1)], (251, 146, 60)),
             ([(1, 0), (2, 0), (3, 0), (4, 0)], (134, 239, 172)), ([(2, 1), (2, 2), (2, 3), (2, 4)], (125, 211, 252))]
    col = {}
    for cells, c in words:
        for rc in cells: col[rc] = c
    cs, pad = 96, 14
    im = Image.new('RGBA', (cs * 5 + pad * 2, cs * 5 + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, im.height - 1), 28, fill=(30, 27, 75, 255))
    f = bold(60)
    for r in range(5):
        for c in range(5):
            x, y = pad + c * cs + 4, pad + r * cs + 4
            d.rounded_rectangle((x, y, x + cs - 8, y + cs - 8), 18, fill=col.get((r, c), (237, 233, 254)) + (255,))
    for cells, c in words:
        pts = [(pad + cc * cs + cs / 2, pad + rr * cs + cs / 2) for rr, cc in cells]
        d.line(pts, fill=tuple(int(v * .7) for v in c), width=14, joint='curve')
    for r in range(5):
        for c in range(5):
            d.text((pad + c * cs + cs / 2, pad + r * cs + cs / 2 + 2), rows[r][c], font=f, fill=(30, 27, 75), anchor='mm')
    return im

# «Подземье»: срез мира — небо, трава, земля, камень, пещера с факелом, руда, лава внизу, дерево и герой с киркой
def draw_podzem():
    import math, random
    T, WN, HN = 16, 24, 22
    R = random.Random(37)
    im = Image.new('RGBA', (WN * T, HN * T), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    for y in range(HN * T):
        k = y / (HN * T)
        d.line([(0, y), (WN * T, y)], fill=(int(60 + 70 * (1 - k)), int(120 + 80 * (1 - k)), 230, 255))
    surf = [7 + int(round(1.6 * math.sin(x * .55) + .8 * math.sin(x * 1.7))) for x in range(WN)]
    cave = lambda x, y: ((x - 14) / 5.5) ** 2 + ((y - 14) / 2.6) ** 2 < 1 or ((x - 6) / 3) ** 2 + ((y - 16.5) / 1.8) ** 2 < 1
    def tile(x, y, base, dark, light, ore=None):
        X, Y = x * T, y * T
        d.rectangle((X, Y, X + T - 1, Y + T - 1), fill=base)
        for _ in range(10):
            px, py = X + R.randrange(T), Y + R.randrange(T)
            d.point((px, py), fill=dark if R.random() < .6 else light)
        if ore:
            for _ in range(3):
                px, py = X + 2 + R.randrange(T - 6), Y + 2 + R.randrange(T - 6)
                d.rectangle((px, py, px + 2, py + 2), fill=ore)
        d.line([(X, Y + T - 1), (X + T - 1, Y + T - 1)], fill=dark); d.line([(X + T - 1, Y), (X + T - 1, Y + T - 1)], fill=dark)
    for x in range(WN):
        for y in range(HN):
            s = surf[x]
            if y < s: continue
            if cave(x, y):
                d.rectangle((x * T, y * T, x * T + T - 1, y * T + T - 1), fill=(40, 34, 40, 255)); continue
            if y >= HN - 3 and 3 < x < 12:
                d.rectangle((x * T, y * T, x * T + T - 1, y * T + T - 1), fill=(255, 110 + R.randrange(60), 20, 255)); continue
            if y == s: tile(x, y, (139, 90, 52), (108, 66, 36), (163, 113, 74)); d.rectangle((x * T, y * T, x * T + T - 1, y * T + 4), fill=(79, 174, 60))
            elif y < s + 4: tile(x, y, (139, 90, 52), (108, 66, 36), (163, 113, 74))
            else:
                ore = None
                r = R.random()
                if r < .07: ore = (217, 120, 58)
                elif r < .1: ore = (242, 194, 48)
                elif r < .12 and y > 15: ore = (79, 124, 255)
                tile(x, y, (125, 125, 134), (98, 98, 108), (154, 154, 164), ore)
    # факел в пещере и тёплый свет
    glow = Image.new('RGBA', im.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(90, 0, -6): gd.ellipse((14 * T - r, 14 * T - r, 14 * T + r, 14 * T + r), fill=(255, 190, 110, int(70 * (1 - r / 90))))
    im.alpha_composite(glow)
    d = ImageDraw.Draw(im)
    d.rectangle((14 * T + 7, 14 * T + 6, 14 * T + 9, 15 * T + 2), fill=(122, 75, 38)); d.rectangle((14 * T + 5, 14 * T, 14 * T + 11, 14 * T + 6), fill=(255, 179, 71)); d.rectangle((14 * T + 7, 14 * T + 2, 14 * T + 9, 14 * T + 5), fill=(255, 242, 168))
    # дерево слева
    tx = 3; ty = surf[tx]
    d.rectangle((tx * T + 4, (ty - 5) * T, tx * T + 12, ty * T), fill=(122, 82, 50))
    d.ellipse((tx * T - 22, (ty - 9) * T, tx * T + 38, (ty - 4) * T), fill=(47, 143, 58)); d.ellipse((tx * T - 10, (ty - 10) * T, tx * T + 28, (ty - 6) * T), fill=(92, 192, 90))
    # герой с киркой
    hx = 9; hy = surf[hx] * T
    d.rectangle((hx * T + 2, hy - 44, hx * T + 13, hy - 33), fill=(240, 200, 160)); d.rectangle((hx * T + 2, hy - 46, hx * T + 13, hy - 41), fill=(90, 58, 32))
    d.rectangle((hx * T, hy - 33, hx * T + 15, hy - 16), fill=(79, 141, 247)); d.rectangle((hx * T + 2, hy - 16, hx * T + 6, hy), fill=(58, 74, 106)); d.rectangle((hx * T + 9, hy - 16, hx * T + 13, hy), fill=(58, 74, 106))
    d.line([(hx * T + 14, hy - 26), (hx * T + 28, hy - 44)], fill=(120, 80, 45), width=3); d.line([(hx * T + 20, hy - 50), (hx * T + 36, hy - 40)], fill=(217, 120, 58), width=4)
    im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    mask = Image.new('L', im.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), 40, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), mask)
    return out

# «Кубомир»: островок из кубиков в изометрии (дёрн, земля, камень с рудой, дерево, вода) — пиксельные грани
def draw_kubomir():
    import random
    R = random.Random(37)
    a = 34                                   # полширины ромба верха
    im = Image.new('RGBA', (a * 2 * 7 + 40, a * 2 * 7 + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = im.width // 2, 150
    def shade(c, k): return tuple(max(0, min(255, int(v * k))) for v in c)
    def face(poly, base, speck=None, n=26):
        d.polygon(poly, fill=base)
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        for _ in range(n):              # пиксельный шум внутри грани
            u, v = R.random(), R.random()
            p0, p1, p3 = poly[0], poly[1], poly[3]
            x = p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * v; y = p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * v
            c = speck if speck and R.random() < .35 else shade(base, .82 + R.random() * .3)
            d.rectangle((x - 3, y - 3, x + 3, y + 3), fill=c)
    def cube(gx, gy, gz, top, side, ore=None, top_side=None):
        x = ox + (gx - gz) * a; y = oy + (gx + gz) * a // 2 - gy * a
        t = [(x, y - a // 2), (x + a, y), (x, y + a // 2), (x - a, y)]
        l = [(x - a, y), (x, y + a // 2), (x, y + a // 2 + a), (x - a, y + a)]
        r = [(x, y + a // 2), (x + a, y), (x + a, y + a), (x, y + a // 2 + a)]
        face(l, shade(side, .78), ore); face(r, shade(side, .6), ore)
        if top_side:                        # полоса травы по верху боковин
            d.polygon([l[0], l[1], (l[1][0], l[1][1] + 9), (l[0][0], l[0][1] + 9)], fill=shade(top_side, .8))
            d.polygon([r[0], r[1], (r[1][0], r[1][1] + 9), (r[0][0], r[0][1] + 9)], fill=shade(top_side, .62))
        face(t, top, ore)
        for p, q in ((t[0], t[1]), (t[1], t[2]), (t[2], t[3]), (t[3], t[0]), (l[2], l[3]), (r[2], r[3]), (t[2], l[2])):
            d.line([p, q], fill=(20, 24, 40, 90), width=1)
    GRASS, DIRT, STONE, SAND, WATER = (95, 176, 70), (122, 86, 52), (125, 125, 130), (221, 208, 154), (70, 130, 220)
    LOG, LEAF, DIAM = (107, 79, 44), (60, 150, 60), (95, 240, 230)
    blocks = []
    for gx in range(4):
        for gz in range(4):
            h = 2 if (gx, gz) not in ((3, 3), (3, 2), (2, 3)) else 1
            for gy in range(h):
                top = gy == h - 1
                if (gx, gz) in ((3, 3), (3, 2), (2, 3)) and top: blocks.append((gx, gy, gz, WATER, shade(WATER, .9), None, None)); continue
                if gy == 0: blocks.append((gx, gy, gz, STONE, STONE, DIAM if (gx, gz) == (0, 3) else None, None))
                elif (gx, gz) == (2, 2): blocks.append((gx, gy, gz, SAND, SAND, None, None))
                else: blocks.append((gx, gy, gz, GRASS, DIRT, None, GRASS))
    for gy in (2, 3, 4): blocks.append((1, gy, 1, (176, 138, 82), LOG, None, None))
    for gx, gy, gz in ((0, 4, 1), (1, 4, 0), (2, 4, 1), (1, 4, 2), (0, 5, 0), (1, 5, 1), (1, 6, 1), (2, 5, 2), (0, 5, 2), (2, 5, 0)):
        blocks.append((gx, gy, gz, LEAF, shade(LEAF, .9), (40, 120, 40), None))
    blocks.sort(key=lambda b: (b[0] + b[2], b[1]))
    for b in blocks: cube(*b)
    # человечек на острове
    x = ox + (3 - 0) * a; y = oy + (3 + 0) * a // 2 - 1 * a + 4   # стоит на верхнем блоке (3, 1, 0)
    d.rectangle((x - 9, y - 70, x + 9, y - 52), fill=(240, 200, 160)); d.rectangle((x - 9, y - 72, x + 9, y - 66), fill=(90, 58, 32))
    d.rectangle((x - 11, y - 52, x + 11, y - 26), fill=(79, 141, 247)); d.rectangle((x - 9, y - 26, x - 2, y), fill=(58, 74, 106)); d.rectangle((x + 2, y - 26, x + 9, y), fill=(58, 74, 106))
    d.line([(x + 10, y - 40), (x + 30, y - 62)], fill=(120, 80, 45), width=4); d.line([(x + 18, y - 70), (x + 40, y - 56)], fill=(95, 240, 230), width=6)
    return im.crop(im.getbbox())

W, H = 1200, 630
for gid, ic, title, color in GAMES:
    if ONLY and gid not in ONLY: continue
    c = hex2rgb(color)
    img = Image.new('RGB', (W, H), (8, 8, 14))
    glow = Image.new('RGB', (W, H), (8, 8, 14))
    d = ImageDraw.Draw(glow)
    d.ellipse((-250, -300, 650, 500), fill=tuple(int(v * .45) for v in c))
    d.ellipse((750, 250, 1500, 900), fill=(70, 20, 60))
    img = glow.filter(ImageFilter.GaussianBlur(140))
    d = ImageDraw.Draw(img)
    # эмодзи крупно справа
    if ic == 'draw:blocks':
        em = draw_blocks()
        em.thumbnail((370, 370), Image.LANCZOS)
    elif ic == 'draw:sudoku':
        em = draw_sudoku()
        em.thumbnail((380, 380), Image.LANCZOS)
    elif ic == 'draw:cards':
        em = draw_cards()
        em.thumbnail((400, 400), Image.LANCZOS)
    elif ic in ('draw:kroko', 'draw:balda', 'draw:domino', 'draw:fillword'):
        em = {'draw:kroko': draw_kroko, 'draw:balda': draw_balda, 'draw:domino': draw_domino, 'draw:fillword': draw_fillword}[ic]()
        em.thumbnail((400, 400), Image.LANCZOS)
    elif ic == 'draw:podzem':
        em = draw_podzem()
        em.thumbnail((420, 420), Image.LANCZOS)
    elif ic == 'draw:kubomir':
        em = draw_kubomir()
        em.thumbnail((440, 440), Image.LANCZOS)
    else:
        em = Image.new('RGBA', (700, 700), (0, 0, 0, 0))
        ImageDraw.Draw(em).text((120, 120), ic, font=emoji, embedded_color=True)
        em = em.crop(em.getbbox()) if em.getbbox() else em
        em.thumbnail((380, 380), Image.LANCZOS)
    cx = 990 if ic.startswith('draw:') else 950
    img.paste(em, (cx - em.width // 2, 315 - em.height // 2), em)
    d.text((80, 70), 'DAN4IK', font=bold(44), fill=(240, 240, 248))
    d.text((80 + d.textlength('DAN4IK', font=bold(44)), 70), '37', font=bold(44), fill=(255, 45, 85))
    size = 96
    while d.textlength(title, font=bold(size)) > 660: size -= 4
    d.text((80, 190), title, font=bold(size), fill=(255, 255, 255))
    sub = {'games': 'С ботом или с другом по ссылке', 'studio3d': 'Построй свой мир, как в Roblox', 'unity': 'Выложи свою игру из Unity',
           'krokodil': 'Рисуй и угадывай с друзьями', 'raid': 'Строй базу и нападай', 'podzem': 'Копай, строй, сражайся',
           'kubomir': 'Свой мир из кубиков', 'world': 'Город, машины, вертолёты'}.get(gid, 'Побьёшь мой рекорд?')
    d.text((84, 200 + size + 20), sub, font=reg(48), fill=c if sum(c) > 300 else (200, 200, 220))
    # кнопка
    bx, by = 84, 470
    label = 'Играть бесплатно'
    bw = d.textlength(label, font=bold(38)) + 110
    d.rounded_rectangle((bx, by, bx + bw, by + 84), 22, fill=(255, 45, 85))
    d.polygon([(bx + 36, by + 28), (bx + 36, by + 56), (bx + 60, by + 42)], fill=(255, 255, 255))
    d.text((bx + 76, by + 16), label, font=bold(38), fill=(255, 255, 255))
    d.text((bx + bw + 30, by + 24), 'без регистрации', font=reg(32), fill=(141, 141, 170))
    img.save(os.path.join(OUT, gid + '.png'), optimize=True)
    print(gid, os.path.getsize(os.path.join(OUT, gid + '.png')))
