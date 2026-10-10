# Панель для Twitch (320×120): «Сайт dan4ik37 — игры, тесты, чат». Запуск: python -X utf8 img/promo/_make-panel.py
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = os.path.dirname(os.path.abspath(__file__))
F = r'C:\Windows\Fonts'
bold = lambda s: ImageFont.truetype(os.path.join(F, 'segoeuib.ttf'), s)
reg = lambda s: ImageFont.truetype(os.path.join(F, 'segoeui.ttf'), s)
emoji = ImageFont.truetype(os.path.join(F, 'seguiemj.ttf'), 109)
S = 2                      # рисуем в 2 раза крупнее и уменьшаем — чётче
W, H = 320 * S, 120 * S
g = Image.new('RGB', (W, H), (8, 8, 14)); d = ImageDraw.Draw(g)
d.ellipse((-120 * S, -80 * S, 200 * S, 160 * S), fill=(110, 20, 45)); d.ellipse((180 * S, 20 * S, 420 * S, 220 * S), fill=(60, 25, 110))
img = g.filter(ImageFilter.GaussianBlur(40 * S)); d = ImageDraw.Draw(img)
em = Image.new('RGBA', (220, 220), (0, 0, 0, 0)); ImageDraw.Draw(em).text((20, 20), '🎮', font=emoji, embedded_color=True)
em = em.crop(em.getbbox()); em.thumbnail((64 * S, 64 * S), Image.LANCZOS)
img.paste(em, (16 * S, (H - em.height) // 2), em)
x = 96 * S
d.text((x, 22 * S), 'САЙТ', font=bold(15 * S), fill=(255, 209, 102))
d.text((x, 38 * S), 'DAN4IK', font=bold(30 * S), fill=(240, 240, 248))
d.text((x + d.textlength('DAN4IK', font=bold(30 * S)), 38 * S), '37', font=bold(30 * S), fill=(255, 45, 85))
d.text((x, 80 * S), 'игры · тесты · чат', font=reg(15 * S), fill=(200, 200, 220))
img = img.resize((320, 120), Image.LANCZOS)
img.save(os.path.join(OUT, 'twitch-panel.png'), optimize=True)
print('ok')
