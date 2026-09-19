#!/usr/bin/env python3
"""
Офлайн-анализ трека для VTuber VRM Player.

Слушает песню ЗАРАНЕЕ (не в реальном времени) и сохраняет рядом файл
"<название>.dance.json" — точный BPM, точные времена битов, огибающую
громкости вокала для лип-синка и разбивку трека на секции по энергии
(тихо/средне/громко), чтобы танец был разным на куплете и на припеве,
а не одной и той же дрожащей анимацией всю песню.

Два режима:

  --quality fast (по умолчанию)
      Гармоника/перкуссия (HPSS, librosa). Работает сразу, без GPU,
      без тяжёлых зависимостей. Вокальная огибающая — приближение через
      гармоническую компоненту (не идеально чистый вокал, но заметно
      чище, чем громкость всего микса).

  --quality high
      Реальное разделение на стемы (vocals/drums/bass/other) нейросетью
      Demucs (Meta AI, https://github.com/facebookresearch/demucs).
      Даёт: барабаны отдельно (точная детекция битов без "путаницы" с
      мелодией) и настоящий вокал отдельно (точный лип-синк — рот не
      будет открываться от баса или ударных). Использует твою RTX через
      CUDA, если она видна PyTorch — если нет, просто посчитает на CPU
      медленнее, но так же корректно.

      Установить один раз:
          pip install demucs torch --index-url https://download.pytorch.org/whl/cu121

Использование:
    python analyze_song.py "Свет.mp3"
    python analyze_song.py "Свет.mp3" --quality high
"""

import argparse
import json
import os
import sys

import numpy as np
import librosa


def compute_envelope(y, sr, fps=50):
    """RMS-огибающая громкости с заданной частотой кадров (для плавной
    интерполяции амплитуды рта во время воспроизведения)."""
    hop = max(1, int(sr / fps))
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
    ref = np.percentile(rms, 95) + 1e-6
    env = np.clip(rms / ref, 0.0, 1.0)
    return env.tolist(), hop / sr


def compute_sections(y, sr, win_sec=2.0):
    """Грубая разбивка трека на окна по 2 секунды с уровнем энергии
    low/mid/high (по перцентилям) — куплет тише, припев/дроп громче."""
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    frame_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    duration = float(frame_times[-1]) if len(frame_times) else 0.0
    n_windows = max(1, int(duration // win_sec) + 1)

    energies = []
    for i in range(n_windows):
        mask = (frame_times >= i * win_sec) & (frame_times < (i + 1) * win_sec)
        energies.append(float(rms[mask].mean()) if mask.any() else 0.0)
    energies = np.array(energies)

    if len(energies) >= 3:
        p33, p66 = np.percentile(energies, [33, 66])
    else:
        p33 = p66 = float(energies.mean()) if len(energies) else 0.0

    sections = []
    for i, e in enumerate(energies):
        level = "low" if e < p33 else ("high" if e > p66 else "mid")
        sections.append({
            "start": round(i * win_sec, 2),
            "end": round((i + 1) * win_sec, 2),
            "energy": level,
        })
    return sections


def analyze_fast(y, sr):
    """Без GPU и тяжёлых зависимостей: перкуссия для битов, гармоника —
    приближение вокала."""
    y_harm, y_perc = librosa.effects.hpss(y)
    tempo, beat_frames = librosa.beat.beat_track(y=y_perc, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    return float(np.atleast_1d(tempo)[0]), beat_times, y_harm


def analyze_high(input_path, sr_target):
    """Реальное разделение на стемы нейросетью Demucs. Возвращает
    (drums, vocals) как numpy-массивы на sr_target."""
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import AudioFile

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[demucs] устройство: {device}"
          + (" (RTX используется)" if device == "cuda" else " (GPU не найден, будет медленнее)"))

    model = get_model("htdemucs")
    model.to(device)
    model.eval()

    wav = AudioFile(input_path).read(
        streams=0, samplerate=model.samplerate, channels=model.audio_channels
    ).to(device)
    ref = wav.mean(0)
    wav_norm = (wav - ref.mean()) / (ref.std() + 1e-8)

    with torch.no_grad():
        sources = apply_model(model, wav_norm[None], device=device, progress=True)[0]
    sources = sources * ref.std() + ref.mean()

    stem_names = model.sources  # ['drums', 'bass', 'other', 'vocals']
    stems = {name: sources[i].mean(0).cpu().numpy() for i, name in enumerate(stem_names)}

    drums = librosa.resample(stems["drums"], orig_sr=model.samplerate, target_sr=sr_target)
    vocals = librosa.resample(stems["vocals"], orig_sr=model.samplerate, target_sr=sr_target)
    return drums, vocals


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audio_path", help="Путь к аудиофайлу (mp3/wav/flac/...)")
    parser.add_argument("--quality", choices=["fast", "high"], default="fast")
    parser.add_argument("--fps", type=int, default=50, help="частота огибающей громкости для лип-синка")
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(f"Файл не найден: {args.audio_path}")
        sys.exit(1)

    print(f"Загрузка: {args.audio_path}")
    sr_analysis = 22050
    y, sr = librosa.load(args.audio_path, sr=sr_analysis, mono=True)
    duration = len(y) / sr

    quality = args.quality
    if quality == "high":
        try:
            drums, vocals = analyze_high(args.audio_path, sr_target=sr_analysis)
            tempo, beat_frames = librosa.beat.beat_track(y=drums, sr=sr_analysis)
            beat_times = librosa.frames_to_time(beat_frames, sr=sr_analysis)
            vocal_env, hop_sec = compute_envelope(vocals, sr_analysis, fps=args.fps)
        except Exception as e:
            print(f"[!] Режим high недоступен ({e}), переключаюсь на fast")
            quality = "fast"

    if quality == "fast":
        tempo, beat_times, vocal_proxy = analyze_fast(y, sr)
        vocal_env, hop_sec = compute_envelope(vocal_proxy, sr, fps=args.fps)

    sections = compute_sections(y, sr)

    result = {
        "version": 1,
        "source_file": os.path.basename(args.audio_path),
        "quality": quality,
        "duration": round(duration, 3),
        "bpm": round(float(np.atleast_1d(tempo)[0]), 2),
        "beats": [round(float(t), 4) for t in beat_times],
        "sections": sections,
        "vocal_envelope": {
            "hop_seconds": round(hop_sec, 6),
            "values": [round(float(v), 4) for v in vocal_env],
        },
    }

    out_path = args.audio_path + ".dance.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"Готово: {out_path}")
    print(f"Режим: {quality}, BPM: {result['bpm']}, битов: {len(result['beats'])}, секций: {len(sections)}")


if __name__ == "__main__":
    main()
