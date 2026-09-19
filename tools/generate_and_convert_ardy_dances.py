#!/usr/bin/env python3
"""
Запусти этот скрипт ИЗ ПАПКИ РЕПОЗИТОРИЯ nv-tlabs/ardy (там, где лежит
scripts/generate.py), в активированном conda-окружении ardy. Он сам:

  1. сгенерирует все 4 клипа (idle_low/dance_mid/dance_high/turn_spin)
     через scripts/generate.py — как раньше 4 отдельные команды;
  2. сразу переведёт каждый .npz в кости VRM (та же логика, что в
     tools/convert_ardy_motion.py) и положит готовые .motion.json прямо в
     assets/dances/ проекта vtuber-vrm-player.

Раньше это было 8 ручных команд — теперь одна:

    python generate_and_convert_ardy_dances.py --project-dir "E:\\3d\\vtuber-vrm-player"

(путь укажи свой — туда, где лежит package.json этого Electron-проекта).

Требования: ты уже сделал `pip install -e ".[demo]"` внутри репозитория
ardy (иначе `scripts/generate.py` не найдёт свои же зависимости). Больше
ничего ставить не нужно — конвертация в VRM использует только numpy,
который у ardy и так в зависимостях.
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np

CLIPS = [
    {
        "name": "idle_low_1",
        "prompt": (
            "A person stands relaxed and gently sways side to side in place to slow quiet "
            "music, minimal calm idol idle motion, subtle weight shift, relaxed shoulders"
        ),
        "duration": 6,
    },
    {
        "name": "idle_low_2",
        "prompt": (
            "A person stands calmly and slowly looks around, gentle breathing motion, very "
            "subtle weight shift from foot to foot, relaxed and at ease, minimal movement"
        ),
        "duration": 10,
    },
    {
        "name": "dance_mid_1",
        "prompt": (
            "An idol dances in place on stage with medium energy k-pop choreography, "
            "swaying hips, alternating arm raises, stepping side to side in rhythm with the beat"
        ),
        "duration": 8,
    },
    {
        "name": "dance_mid_2",
        "prompt": (
            "An idol performs a short medium-energy dance combo on stage, one arm wave "
            "followed by a hip sway and a small side step, smooth and rhythmic k-pop style"
        ),
        "duration": 4,
    },
    {
        "name": "dance_mid_3",
        "prompt": (
            "An idol dances a longer medium-energy k-pop routine on stage with several "
            "different moves in sequence: arm raises, hip sways, side steps, and a small "
            "body turn, flowing smoothly"
        ),
        "duration": 14,
    },
    {
        "name": "dance_high_1",
        "prompt": (
            "An idol dances with big energetic k-pop choreography on stage, punching arms "
            "overhead, powerful hip and shoulder movement, strong beat-synced steps, high "
            "energy performance"
        ),
        "duration": 8,
    },
    {
        "name": "dance_high_2",
        "prompt": (
            "An idol performs a short powerful dance accent on stage: a sharp arm punch, a "
            "quick jump, and a strong pose, high intensity k-pop performance"
        ),
        "duration": 4,
    },
    {
        "name": "dance_high_3",
        "prompt": (
            "An idol performs a long, intense high energy k-pop choreography routine on "
            "stage with many different powerful moves in sequence: jumps, arm punches, "
            "spins, and strong poses"
        ),
        "duration": 16,
    },
    {
        "name": "turn_spin_1",
        "prompt": (
            "A confident dancer does one quick spin turn on stage and strikes a pose facing "
            "a new direction, energetic idol performance"
        ),
        "duration": 2,
    },
]

# --- Ниже — то же самое, что в tools/convert_ardy_motion.py (см. тот файл
# за подробными комментариями про допущения ретаргетинга и AXIS_CORRECTION).
# Продублировано здесь, чтобы этот скрипт работал сам по себе, без
# добавления пути к другому репозиторию в sys.path.

CORE27_ORDER = [
    "Hips", "Spine", "Spine1", "Spine2", "Spine3", "Neck", "Head",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand", "RightHandEnd", "RightHandThumb1",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "LeftHandEnd", "LeftHandThumb1",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
]

CORE_TO_VRM = {
    "Hips": "hips", "Spine": "spine", "Spine1": "chest", "Spine2": "upperChest",
    "Neck": "neck", "Head": "head",
    "RightShoulder": "rightShoulder", "RightArm": "rightUpperArm",
    "RightForeArm": "rightLowerArm", "RightHand": "rightHand",
    "LeftShoulder": "leftShoulder", "LeftArm": "leftUpperArm",
    "LeftForeArm": "leftLowerArm", "LeftHand": "leftHand",
    "RightUpLeg": "rightUpperLeg", "RightLeg": "rightLowerLeg",
    "RightFoot": "rightFoot", "RightToeBase": "rightToes",
    "LeftUpLeg": "leftUpperLeg", "LeftLeg": "leftLowerLeg",
    "LeftFoot": "leftFoot", "LeftToeBase": "leftToes",
}

FOLD_INTO_NECK = "Spine3"

# Если после теста конечность гнётся не туда — правь здесь же (см. подробное
# объяснение в tools/convert_ardy_motion.py) и просто перезапусти этот скрипт.
AXIS_CORRECTION = {}


def mat3_to_quat_wxyz(m):
    trace = m[0, 0] + m[1, 1] + m[2, 2]
    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        w, x, y, z = 0.25 / s, (m[2, 1] - m[1, 2]) * s, (m[0, 2] - m[2, 0]) * s, (m[1, 0] - m[0, 1]) * s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = 2.0 * np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2])
        w, x, y, z = (m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = 2.0 * np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2])
        w, x, y, z = (m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1])
        w, x, y, z = (m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s
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


def convert_npz_to_motion_json(npz_path, out_path):
    data = np.load(npz_path, allow_pickle=True)
    local_rot_mats = np.asarray(data["local_rot_mats"])
    root_positions = np.asarray(data["root_positions"])
    fps = float(np.asarray(data["fps"]))
    n_frames = local_rot_mats.shape[0]

    name_to_idx = {name: i for i, name in enumerate(CORE27_ORDER)}
    fold_idx = name_to_idx[FOLD_INTO_NECK]
    tracks = {vrm_bone: [] for vrm_bone in CORE_TO_VRM.values()}

    for t in range(n_frames):
        for core_name, vrm_bone in CORE_TO_VRM.items():
            idx = name_to_idx[core_name]
            mat = local_rot_mats[t, idx]
            if core_name == "Neck":
                mat = local_rot_mats[t, fold_idx] @ mat
            quat = mat3_to_quat_wxyz(mat)
            correction = AXIS_CORRECTION.get(vrm_bone)
            if correction is not None:
                quat = quat_multiply_wxyz(np.array(correction), quat)
            tracks[vrm_bone].append(quat.tolist())

    root_delta = (root_positions - root_positions[0]).tolist()
    result = {
        "version": 1, "fps": fps, "duration": n_frames / fps,
        "tracks": tracks, "hipsPositionDelta": root_delta,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--project-dir", required=True,
        help='Путь к папке проекта vtuber-vrm-player (там, где package.json)'
    )
    parser.add_argument(
        "--outputs-dir", default="outputs",
        help="Куда generate.py пишет .npz внутри репозитория ardy (по умолчанию: outputs/)"
    )
    args = parser.parse_args()

    if not os.path.exists("scripts/generate.py"):
        print("Не нашёл scripts/generate.py — запусти этот скрипт из корня репозитория nv-tlabs/ardy.")
        sys.exit(1)

    dances_dir = os.path.join(args.project_dir, "assets", "dances")
    os.makedirs(dances_dir, exist_ok=True)
    os.makedirs(args.outputs_dir, exist_ok=True)

    for clip in CLIPS:
        npz_stem = os.path.join(args.outputs_dir, clip["name"])
        print(f"\n=== Генерирую '{clip['name']}' ===")
        cmd = [
            sys.executable, "scripts/generate.py", clip["prompt"],
            "--model", "core", "--duration", str(clip["duration"]),
            "--output", npz_stem,
        ]
        result = subprocess.run(cmd)
        if result.returncode != 0:
            print(f"[!] Генерация '{clip['name']}' не удалась (код {result.returncode}), пропускаю.")
            continue

        npz_path = npz_stem + ".npz"
        out_path = os.path.join(dances_dir, f"{clip['name']}.motion.json")
        print(f"Конвертирую -> {out_path}")
        convert_npz_to_motion_json(npz_path, out_path)

    print("\nГотово. Перезапусти приложение — появится «Режим: ИИ-движения».")


if __name__ == "__main__":
    main()
