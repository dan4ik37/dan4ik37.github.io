# scripts/news-add.py — новая запись «Что нового» (/news) одной командой: сжимает снимки в img/news/<slug>-N.webp (< 200 КБ,
# ширина до 1280) и вставляет запись в начало api/_lib/news-posts.js (под строкой-меткой). Потом: node scripts/news-test.mjs,
# коммит с явными путями. Нужен Pillow (pip install pillow). Запуск из корня сайта:
#   python -X utf8 scripts/news-add.py --slug ep11-reki --date 2026-11-20 --tag engine \
#     --title "EP11: реки и мосты" --lead "Одно-два предложения: что вышло." --text M:/d37/claude-tmp/news/ep11.txt \
#     --shot M:/d37/d37-play/EP11-shots/rivers/a.png "Подпись под снимком" --link /hub "Играть в браузере"
# Текст (--text, UTF-8): пустая строка — новый абзац, строка «## Заголовок» — подзаголовок, строки «- пункт» — список.
# Пишем только своё и только правду: что сделано, что пока слабо (docs/areas/seo-ads.md: без воды и чужих текстов).
# --dry — показать запись и размеры, ничего не записывать.
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'api', '_lib', 'news-posts.js')
MARK = '// ↓ новые записи — сюда'
LIMIT = 200 * 1024


def parse_text(path):
    blocks, para, items = [], [], []
    def flush():
        if para: blocks.append({'p': ' '.join(para)}); para.clear()
        if items: blocks.append({'ul': list(items)}); items.clear()
    for raw in open(path, encoding='utf-8').read().splitlines():
        line = raw.strip()
        if not line: flush(); continue
        if line.startswith('## '): flush(); blocks.append({'h': line[3:].strip()}); continue
        if line.startswith('- '):
            if para: blocks.append({'p': ' '.join(para)}); para.clear()
            items.append(line[2:].strip()); continue
        if items: blocks.append({'ul': list(items)}); items.clear()
        para.append(line)
    flush()
    return blocks


def shrink(src, dst, dry):
    from PIL import Image
    im = Image.open(src).convert('RGB')
    if im.width > 1280: im = im.resize((1280, round(im.height * 1280 / im.width)), Image.LANCZOS)
    q, size = 80, 0
    while q >= 40:
        tmp = dst + '.tmp'
        im.save(tmp, 'WEBP', quality=q, method=6)
        size = os.path.getsize(tmp)
        if size < LIMIT: break
        os.remove(tmp); q -= 8
    if size >= LIMIT:
        im = im.resize((im.width * 3 // 4, im.height * 3 // 4), Image.LANCZOS); im.save(tmp, 'WEBP', quality=60, method=6); size = os.path.getsize(tmp)
    if dry: os.remove(tmp)
    else: os.replace(tmp, dst)
    return im.width, im.height, size


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--slug', required=True); a.add_argument('--date', required=True); a.add_argument('--tag', default='engine', choices=['engine', 'site'])
    a.add_argument('--title', required=True); a.add_argument('--lead', required=True); a.add_argument('--text', required=True)
    a.add_argument('--shot', nargs=2, action='append', default=[], metavar=('PNG', 'ПОДПИСЬ'))
    a.add_argument('--link', nargs=2, action='append', default=[], metavar=('АДРЕС', 'ТЕКСТ'))
    a.add_argument('--dry', action='store_true')
    o = a.parse_args()
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', o.slug): sys.exit('slug: латиница, цифры и дефис')
    if not re.fullmatch(r'20\d\d-\d\d-\d\d', o.date): sys.exit('date: ГГГГ-ММ-ДД')
    if len(o.shot) > 3: sys.exit('не больше 3 снимков')
    for h, _ in o.link:
        if not re.fullmatch(r'/[\w\-/]*', h): sys.exit(f'ссылка {h!r}: только адрес сайта вида /hub (Git Bash портит «/…» — запускай из PowerShell или с MSYS_NO_PATHCONV=1)')
    src = open(DATA, encoding='utf-8').read()
    if MARK not in src: sys.exit('нет строки-метки в ' + DATA)
    if re.search(r"slug: ?['\"]" + re.escape(o.slug) + r"['\"]", src): sys.exit('такой slug уже есть')
    shots = []
    for i, (png, cap) in enumerate(o.shot, 1):
        name = f'{o.slug}-{i}.webp'
        w, h, size = shrink(png, os.path.join(ROOT, 'img', 'news', name), o.dry)
        print(f'{name}: {w}x{h}, {size // 1024} КБ')
        shots.append({'src': '/img/news/' + name, 'w': w, 'h': h, 'alt': cap, 'cap': cap})
    post = {'slug': o.slug, 'date': o.date, 'tag': o.tag, 'title': o.title, 'lead': o.lead, 'shots': shots,
            'body': parse_text(o.text), 'links': [[h, t] for h, t in o.link]}
    words = len(re.findall(r'\w+', ' '.join([o.lead] + [b.get('p') or b.get('h') or ' '.join(b.get('ul', [])) for b in post['body']])))
    print(f'слов: {words} (реклама на записи — от 150)')
    js = json.dumps(post, ensure_ascii=False, indent=2) + ','
    if o.dry: print(js); return
    i = src.index(MARK); j = src.index('\n', i) + 1
    open(DATA, 'w', encoding='utf-8', newline='\n').write(src[:j] + js + '\n' + src[j:])
    print('записано в api/_lib/news-posts.js; дальше: node scripts/news-test.mjs')


if __name__ == '__main__':
    main()
