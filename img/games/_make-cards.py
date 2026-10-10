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
    ('catch', '💰', 'Лови донаты', '#ffd166'),
    ('guess', '🎬', 'Угадай видео', '#ff2d55'),
    ('games', '🎮', 'Игры онлайн', '#ff2d55'),
]

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

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
    em = Image.new('RGBA', (700, 700), (0, 0, 0, 0))
    ImageDraw.Draw(em).text((120, 120), ic, font=emoji, embedded_color=True)
    em = em.crop(em.getbbox()) if em.getbbox() else em
    em.thumbnail((380, 380), Image.LANCZOS)
    img.paste(em, (950 - em.width // 2, 315 - em.height // 2), em)
    d.text((80, 70), 'DAN4IK', font=bold(44), fill=(240, 240, 248))
    d.text((80 + d.textlength('DAN4IK', font=bold(44)), 70), '37', font=bold(44), fill=(255, 45, 85))
    size = 96
    while d.textlength(title, font=bold(size)) > 660: size -= 4
    d.text((80, 190), title, font=bold(size), fill=(255, 255, 255))
    sub = 'Побьёшь мой рекорд?' if gid != 'games' else 'С ботом или с другом по ссылке'
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
