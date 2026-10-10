# Текстуры для «Мира Денчика» (img/tex/*.jpg): уменьшенные копии CC0-текстур из Unity-проекта владельца
# (D:\UnityProjects\Backrooms\Assets\Art\Textures\Library — ambientCG и Poly Haven, лицензия CC0, можно где угодно).
# Запуск: python -X utf8 scripts/make-textures.py  (нужен Pillow). Цвет — JPEG 512 px, нормали — JPEG 512 px.
import os
from PIL import Image

LIB = r'D:\UnityProjects\Backrooms\Assets\Art\Textures\Library'
OUT = os.path.join(os.path.dirname(__file__), '..', 'img', 'tex')
SETS = {   # имя на сайте: папка в библиотеке
    'asphalt': 'Ground/Asphalt031',
    'plaza': 'Tiles/Tiles139',
    'sidewalk': 'Concrete/Concrete034',
    'parquet': 'Wood/WoodFloor051',
    'plaster': 'Plaster/PaintedPlaster017',
    'planks': 'Wood/Planks037A',
    'carpet': 'Carpet/Carpet012',
    'tiles': 'Tiles/Tiles040',
}
SIZE = 512
os.makedirs(OUT, exist_ok=True)
total = 0
for name, rel in SETS.items():
    stem = os.path.basename(rel)
    for kind, q in (('Albedo', 82), ('Normal', 88)):
        src = None
        for ext in ('jpg', 'png'):
            p = os.path.join(LIB, *rel.split('/'), f'{stem}_{kind}.{ext}')
            if os.path.exists(p):
                src = p
        if not src:
            print('нет', name, kind)
            continue
        im = Image.open(src).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        dst = os.path.join(OUT, f'{name}{"_n" if kind == "Normal" else ""}.jpg')
        im.save(dst, quality=q, optimize=True, progressive=True)
        total += os.path.getsize(dst)
        print(f'{os.path.basename(dst)}: {os.path.getsize(dst) // 1024} КБ')
with open(os.path.join(OUT, 'LICENSE.txt'), 'w', encoding='utf-8') as f:
    f.write('Текстуры: ambientCG (https://ambientcg.com) и Poly Haven (https://polyhaven.com) — CC0 (общественное достояние).\n'
            + '\n'.join(f'{k}: {v.split("/")[-1]}' for k, v in SETS.items()) + '\n')
print(f'всего {total // 1024} КБ')
