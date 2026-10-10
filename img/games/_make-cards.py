# Картинки-превью 1200×630 для ссылок «Брось вызов» (img/games/<id>.png)
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = r'E:\site\dan4ik37.github.io\img\games'
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
    ('catch', '💰', 'Лови донаты', '#ffd166'),
    ('guess', '🎬', 'Угадай видео', '#ff2d55'),
    ('studio3d', '🧱', 'Студия 3D', '#f59e0b'),
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

W, H = 1200, 630
for gid, ic, title, color in GAMES:
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
    sub = {'games': 'С ботом или с другом по ссылке', 'studio3d': 'Построй свой мир, как в Roblox'}.get(gid, 'Побьёшь мой рекорд?')
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
