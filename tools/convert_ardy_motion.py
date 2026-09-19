#!/usr/bin/env python3
"""
Конвертирует "сырой" .npz — результат локального запуска
`python scripts/generate.py ... --output X` из репозитория nv-tlabs/ardy
(модель "core", скелет CoreSkeleton27, 27 костей) — в свой простой JSON-формат
покадровых кватернионов по костям VRM. Никакого .vrma (это формат-обёртка
поверх glTF, реализовывать его бинарную схему вслепую — отдельный источник
риска), просто набор ключевых кадров, который renderer.js собирает в
THREE.AnimationClip сам, теми же средствами three.js, что мы уже используем.

ЧЕСТНО: это ретаргетинг "по счастливому совпадению иерархий" — я предполагаю,
что CoreSkeleton27 определяет локальные повороты как "коррекция от бинд-позы"
(так делает подавляющее большинство подобных скелетов, но не 100% гарантия),
и что оси костей у CoreSkeleton27 и у нормализованного скелета VRM совпадают
по смыслу (сгибание руки в локте — вокруг одной и той же локальной оси и
т.п.). Если после теста в приложении какая-то часть тела гнётся не в ту
сторону — это чинится в словаре AXIS_CORRECTION ниже, а не пересборкой всего
конвертера.

Использование:
    python tools/convert_ardy_motion.py outputs/idle_low.npz --name idle_low
    python tools/convert_ardy_motion.py outputs/dance_high.npz --name dance_high

Результат: assets/dances/<name>.motion.json — приложение подхватит сам.
Нужен только numpy (без PyTorch/ARDY) — можно гонять хоть на другом
компьютере, лишь бы .npz был уже сгенерирован.
"""

import argparse
import json
import os

import numpy as np

# --- Точный порядок и иерархия костей CoreSkeleton27 (см. ardy/skeleton/definitions.py
# в репозитории nv-tlabs/ardy) — local_rot_mats[:, i] соответствует CORE27_ORDER[i].
CORE27_ORDER = [
    "Hips", "Spine", "Spine1", "Spine2", "Spine3", "Neck", "Head",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand", "RightHandEnd", "RightHandThumb1",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "LeftHandEnd", "LeftHandThumb1",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
]

# Core (27 костей, 4 сегмента позвоночника) -> кости нормализованного
# гуманоида VRM (spine/chest/upperChest/neck/head). RightHandEnd/*Thumb1 —
# концевые/пальцевые кости, для танца тела не нужны, пропускаем.
CORE_TO_VRM = {
    "Hips": "hips",
    "Spine": "spine",
    "Spine1": "chest",
    "Spine2": "upperChest",
    "Neck": "neck",  # финальный поворот = Spine3 (см. ниже) * Neck
    "Head": "head",
    "RightShoulder": "rightShoulder",
    "RightArm": "rightUpperArm",
    "RightForeArm": "rightLowerArm",
    "RightHand": "rightHand",
    "LeftShoulder": "leftShoulder",
    "LeftArm": "leftUpperArm",
    "LeftForeArm": "leftLowerArm",
    "LeftHand": "leftHand",
    "RightUpLeg": "rightUpperLeg",
    "RightLeg": "rightLowerLeg",
    "RightFoot": "rightFoot",
    "RightToeBase": "rightToes",
    "LeftUpLeg": "leftUpperLeg",
    "LeftLeg": "leftLowerLeg",
    "LeftFoot": "leftFoot",
    "LeftToeBase": "leftToes",
}

# У Core 4 сегмента спины (Spine..Spine3), у VRM обычно 3 (spine/chest/
# upperChest) + neck. Spine3 у Core "пропадает" — сворачиваем её поворот в
# neck (композиция матриц), чтобы не терять часть движения верхней части
# позвоночника/шеи.
FOLD_INTO_NECK = "Spine3"

# Поправочные повороты (кватернион w,x,y,z) на кость VRM, если конечность
# после теста гнётся не в ту сторону/вывернута. По умолчанию — без поправки.
# Пример правки: AXIS_CORRECTION["rightLowerArm"] = (0.7071, 0.7071, 0, 0)
AXIS_CORRECTION = {}


def mat3_to_quat_wxyz(m):
    """3x3 матрица поворота -> кватернион (w, x, y, z). Устойчивый метод
    (без деления на числа, близкие к нулю)."""
    trace = m[0, 0] + m[1, 1] + m[2, 2]
    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        w = 0.25 / s
        x = (m[2, 1] - m[1, 2]) * s
        y = (m[0, 2] - m[2, 0]) * s
        z = (m[1, 0] - m[0, 1]) * s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = 2.0 * np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2])
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = 2.0 * np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2])
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1])
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    q = np.array([w, x, y, z])
    return q / np.linalg.norm(q)


def quat_multiply_wxyz(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return np.array([
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("npz_path", help="Путь к .npz из scripts/generate.py (репозиторий nv-tlabs/ardy)")
    parser.add_argument("--name", required=True, help="Имя клипа: idle_low / dance_mid / dance_high / turn_spin")
    parser.add_argument(
        "--out-dir", default=None,
        help="Куда писать <name>.motion.json (по умолчанию: assets/dances/ рядом с этим скриптом)"
    )
    args = parser.parse_args()

    data = np.load(args.npz_path, allow_pickle=True)
    local_rot_mats = np.asarray(data["local_rot_mats"])  # [T, 27, 3, 3]
    root_positions = np.asarray(data["root_positions"])  # [T, 3]
    fps = float(np.asarray(data["fps"]))

    n_frames = local_rot_mats.shape[0]
    if local_rot_mats.shape[1] != len(CORE27_ORDER):
        print(
            f"[!] Внимание: в .npz {local_rot_mats.shape[1]} костей, а в CORE27_ORDER их "
            f"{len(CORE27_ORDER)}. Похоже, это не модель 'core' (27 костей) — "
            f"результат может быть неверным."
        )

    name_to_idx = {name: i for i, name in enumerate(CORE27_ORDER)}
    neck_idx = name_to_idx["Neck"]
    fold_idx = name_to_idx[FOLD_INTO_NECK]

    tracks = {vrm_bone: [] for vrm_bone in CORE_TO_VRM.values()}

    for t in range(n_frames):
        for core_name, vrm_bone in CORE_TO_VRM.items():
            idx = name_to_idx[core_name]
            mat = local_rot_mats[t, idx]

            if core_name == "Neck":
                # Сворачиваем "потерянный" сегмент позвоночника в шею, а не
                # отбрасываем его движение молча.
                mat = local_rot_mats[t, fold_idx] @ mat

            quat = mat3_to_quat_wxyz(mat)

            correction = AXIS_CORRECTION.get(vrm_bone)
            if correction is not None:
                quat = quat_multiply_wxyz(np.array(correction), quat)

            tracks[vrm_bone].append(quat.tolist())

    # Смещение бёдер — относительно первого кадра (не абсолютные мировые
    # координаты скелета ARDY), renderer.js прибавит это к реальной высоте
    # бёдер конкретной VRM-модели.
    root_delta = (root_positions - root_positions[0]).tolist()

    result = {
        "version": 1,
        "fps": fps,
        "duration": n_frames / fps,
        "tracks": tracks,  # vrm_bone_name -> [[w,x,y,z], ...] по кадрам
        "hipsPositionDelta": root_delta,  # [[dx,dy,dz], ...] по кадрам, метры
    }

    out_dir = args.out_dir or os.path.join(os.path.dirname(__file__), "..", "assets", "dances")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{args.name}.motion.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f)

    print(f"Готово: {out_path} ({n_frames} кадров, {fps} fps, {result['duration']:.2f}с)")


if __name__ == "__main__":
    main()
