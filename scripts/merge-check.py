# Проверка после слияний (главный): скрипты игр из каждой влитой ветки есть в main (GAMES[].scripts в js/features/games.js).
# 22.10 при слиянии T-022b конфликт GAMES_VER разобран «нашей» стороной целиком — выпал trees.js у 4 игр, «Кубомир» не открывал новые миры.
# Запуск из корня сайта: python -X utf8 scripts/merge-check.py  (смотрит слияния с 21.10; другое — поправь --since)
import subprocess, re, sys
def run(*a): return subprocess.run(a, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
def lists(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r"\s*\{ id: '([^']+)'", line)
        if not m: continue
        sm = re.search(r"scripts: \[([^\]]*)\]", line)
        if sm: out[m.group(1)] = re.findall(r"'([^']+)'", sm.group(1))
    return out
main = lists(open('js/features/games.js', encoding='utf-8').read())
merges = run('git', 'log', '--merges', '--since=2026-10-21', '--format=%H %s', 'main').splitlines()
bad = 0
for m in merges:
    h, subj = m.split(' ', 1)
    p2 = run('git', 'rev-parse', h + '^2').strip()
    if not p2: continue
    br = lists(run('git', 'show', p2 + ':js/features/games.js'))
    for gid, scr in br.items():
        miss = [s for s in scr if s not in main.get(gid, [])]
        if miss:
            bad += 1
            print(subj[:60], '|', gid, '| missing in main:', miss)
print('done, problems:', bad)
