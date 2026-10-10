# Картинки-превью 1200×630 для ссылок на тесты и инструменты (img/share/<id>.png) — их показывают Telegram, ВК,
# Discord, когда ссылку отправляют другу. Как img/games/_make-cards.py: Pillow + шрифты Windows (Segoe UI, Segoe UI Emoji).
# Запуск: python -X utf8 img/share/_make-cards.py   (новый тест/инструмент → строка в CARDS и перезапуск)
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))
F = r'C:\Windows\Fonts'
bold = lambda s: ImageFont.truetype(os.path.join(F, 'segoeuib.ttf'), s)
reg = lambda s: ImageFont.truetype(os.path.join(F, 'segoeui.ttf'), s)
emoji = ImageFont.truetype(os.path.join(F, 'seguiemj.ttf'), 320)

# id, эмодзи, заголовок, подпись, кнопка, цвет
CARDS = [
    ('quiz', '🧩', 'Тесты: кто ты из игр?', 'Майнкрафт, FNAF, Роблокс и другие', 'Пройти тест', '#38bdf8'),
    ('quiz-minecraft', '⛏', 'Какой ты моб из Майнкрафта?', 'Тест · 8 вопросов', 'Пройти тест', '#22c55e'),
    ('quiz-fnaf', '🐻', 'Кто ты из FNAF?', 'Тест · 8 вопросов', 'Пройти тест', '#b45309'),
    ('quiz-roblox', '🟨', 'Кто ты в Роблоксе?', 'Тест · 8 вопросов', 'Пройти тест', '#ffd166'),
    ('quiz-poppy', '🧸', 'Кто ты из Poppy Playtime?', 'Тест · 8 вопросов', 'Пройти тест', '#3b82f6'),
    ('quiz-game', '🕹', 'Какая ты игра?', 'Тест для всех · 8 вопросов', 'Пройти тест', '#9147ff'),
    ('quiz-cs2', '🎯', 'Какая ты роль в CS2?', 'Тест · 8 вопросов', 'Пройти тест', '#f59e0b'),
    ('quiz-horror', '👻', 'Кто ты в хоррор-игре?', 'Тест · 8 вопросов', 'Пройти тест', '#8b5cf6'),
    ('quiz-hollow-knight', '🗡', 'Кто ты из Hollow Knight?', 'Тест · 8 вопросов', 'Пройти тест', '#94a3b8'),
    ('quiz-streamer', '🎙', 'Какой ты стример?', 'Тест для всех · 8 вопросов', 'Пройти тест', '#ec4899'),
    ('quiz-viewer', '📺', 'Какой ты зритель dan4ik37?', 'Тест · 8 вопросов', 'Пройти тест', '#ff2d55'),
    ('fonts', '✒️', 'Шрифты для ника', 'Красивые буквы и символы для ника', 'Открыть', '#c084fc'),
    ('nick', '🏷', 'Генератор ников', 'Крутые, милые, аниме и русские', 'Открыть', '#29b6f6'),
    ('typing', '⌨️', 'Тест скорости печати', 'Сколько знаков в минуту?', 'Проверить', '#a78bfa'),
    ('cps', '🖱', 'CPS тест', 'Сколько кликов в секунду?', 'Проверить', '#f59e0b'),
    ('random', '🔢', 'Генератор случайных чисел', 'Монетка и кубики — честный рандом', 'Открыть', '#22c55e'),
    ('wheel', '🎡', 'Колесо фортуны', 'Свои варианты, честный рандом', 'Крутить', '#f472b6'),
    ('studio', '🛠', 'Студия игр', 'Сделай свою игру — без кода', 'Сделать', '#38bdf8'),
    ('top', '🏆', 'Лучшие видео dan4ik37', 'Топ по просмотрам из ~6000 роликов', 'Смотреть', '#ffd166'),
    ('about', '👤', 'Кто такой dan4ik37', 'Ютубер и стример · Денчик37', 'Узнать', '#ff2d55'),
]

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def wrap(d, text, font, width):
    lines, cur = [], ''
    for w in text.split(' '):
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    lines.append(cur)
    return lines

W, H = 1200, 630
for cid, ic, title, sub, btn, color in CARDS:
    c = hex2rgb(color)
    glow = Image.new('RGB', (W, H), (8, 8, 14))
    d = ImageDraw.Draw(glow)
    d.ellipse((-250, -300, 650, 500), fill=tuple(int(v * .45) for v in c))
    d.ellipse((750, 250, 1500, 900), fill=(70, 20, 60))
    img = glow.filter(ImageFilter.GaussianBlur(140))
    d = ImageDraw.Draw(img)
    em = Image.new('RGBA', (700, 700), (0, 0, 0, 0))
    ImageDraw.Draw(em).text((120, 120), ic, font=emoji, embedded_color=True)
    em = em.crop(em.getbbox()) if em.getbbox() else em
    em.thumbnail((330, 330), Image.LANCZOS)
    img.paste(em, (975 - em.width // 2, 300 - em.height // 2), em)
    d.text((80, 64), 'DAN4IK', font=bold(44), fill=(240, 240, 248))
    d.text((80 + d.textlength('DAN4IK', font=bold(44)), 64), '37', font=bold(44), fill=(255, 45, 85))
    # заголовок: до 3 строк по ширине 700
    size = 84
    while True:
        lines = wrap(d, title, bold(size), 700)
        if len(lines) <= 3 or size <= 56: break
        size -= 4
    y = 150
    for ln in lines:
        d.text((80, y), ln, font=bold(size), fill=(255, 255, 255)); y += int(size * 1.12)
    d.text((84, y + 14), sub, font=reg(40), fill=c if sum(c) > 300 else (200, 200, 220))
    bx, by = 84, 490
    bw = d.textlength(btn, font=bold(38)) + 110
    d.rounded_rectangle((bx, by, bx + bw, by + 84), 22, fill=(255, 45, 85))
    d.polygon([(bx + 36, by + 28), (bx + 36, by + 56), (bx + 60, by + 42)], fill=(255, 255, 255))
    d.text((bx + 76, by + 16), btn, font=bold(38), fill=(255, 255, 255))
    d.text((bx + bw + 30, by + 24), 'бесплатно', font=reg(32), fill=(141, 141, 170))
    img.save(os.path.join(OUT, cid + '.png'), optimize=True)
    print('ok', cid)
