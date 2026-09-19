#!/usr/bin/env node
/**
 * Генерирует набор .vrma-клипов (движения тела) нейросетью NVIDIA ARDY
 * через Replicate (https://replicate.com/wanjon/ardy2vrm) и сохраняет их
 * в assets/dances/ — дальше приложение подхватывает их само и предлагает
 * режим "ИИ-движения" вместо процедурной анимации.
 *
 * Нужен токен Replicate (бесплатная регистрация, генерация стоит доли цента):
 *   https://replicate.com/account/api-tokens
 *
 * Запуск (Windows PowerShell):
 *   $env:REPLICATE_API_TOKEN="r8_твой_токен"
 *   node tools/generate_dances.js
 *
 * Запуск (macOS/Linux):
 *   REPLICATE_API_TOKEN=r8_твой_токен node tools/generate_dances.js
 *
 * Требует Node.js 18+ (встроенный fetch). Если у тебя Node постарше —
 * обнови: node -v должен быть v18 или выше.
 */

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) {
  console.error('Не задан REPLICATE_API_TOKEN.');
  console.error('Получить токен: https://replicate.com/account/api-tokens');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', 'assets', 'dances');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Приложение теперь умеет подхватывать НЕСКОЛЬКО вариантов на категорию:
// idle_low_1.vrma, idle_low_2.vrma, ... — и само выбирает/чередует их. Так
// что здесь сразу несколько промптов на категорию (короткие и длинные по
// duration), а не по одному — библиотека приходит с разнообразием сразу.
// Хочешь добавить ещё — просто допиши объект с name вида "категория_N" (N —
// следующий свободный номер для этой категории) и своим промптом.
const CLIPS = [
  {
    name: 'idle_low_1',
    prompt:
      'A person stands relaxed and gently sways side to side in place to slow quiet music, ' +
      'minimal calm idol idle motion, subtle weight shift, relaxed shoulders',
    duration: 6,
  },
  {
    name: 'idle_low_2',
    prompt:
      'A person stands calmly and slowly looks around, gentle breathing motion, very subtle ' +
      'weight shift from foot to foot, relaxed and at ease, minimal movement',
    duration: 10,
  },
  {
    name: 'dance_mid_1',
    prompt:
      'An idol dances in place on stage with medium energy k-pop choreography, swaying hips, ' +
      'alternating arm raises, stepping side to side in rhythm with the beat',
    duration: 8,
  },
  {
    name: 'dance_mid_2',
    prompt:
      'An idol performs a short medium-energy dance combo on stage, one arm wave followed by a ' +
      'hip sway and a small side step, smooth and rhythmic k-pop style',
    duration: 4,
  },
  {
    name: 'dance_mid_3',
    prompt:
      'An idol dances a longer medium-energy k-pop routine on stage with several different moves ' +
      'in sequence: arm raises, hip sways, side steps, and a small body turn, flowing smoothly',
    duration: 14,
  },
  {
    name: 'dance_high_1',
    prompt:
      'An idol dances with big energetic k-pop choreography on stage, punching arms overhead, ' +
      'powerful hip and shoulder movement, strong beat-synced steps, high energy performance',
    duration: 8,
  },
  {
    name: 'dance_high_2',
    prompt:
      'An idol performs a short powerful dance accent on stage: a sharp arm punch, a quick jump, ' +
      'and a strong pose, high intensity k-pop performance',
    duration: 4,
  },
  {
    name: 'dance_high_3',
    prompt:
      'An idol performs a long, intense high energy k-pop choreography routine on stage with many ' +
      'different powerful moves in sequence: jumps, arm punches, spins, and strong poses',
    duration: 16,
  },
  {
    name: 'turn_spin_1',
    prompt:
      'A confident dancer does one quick spin turn on stage and strikes a pose facing a new ' +
      'direction, energetic idol performance',
    duration: 2,
  },
  {
    name: 'turn_spin_2',
    prompt:
      'A dancer does a quick half-turn hop on stage, landing facing a new direction with a ' +
      'confident pose, energetic idol style',
    duration: 2,
  },
];

async function createPrediction(input) {
  const res = await fetch('https://api.replicate.com/v1/models/wanjon/ardy2vrm/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait', // просим Replicate подождать результат прямо в этом ответе
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    throw new Error(`Replicate API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function pollUntilDone(prediction) {
  let current = prediction;
  while (!['succeeded', 'failed', 'canceled'].includes(current.status)) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(current.urls.get, { headers: { Authorization: `Token ${TOKEN}` } });
    current = await res.json();
  }
  return current;
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать ${url}: ${res.status}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  for (const clip of CLIPS) {
    console.log(`\nГенерирую "${clip.name}": ${clip.prompt}`);
    let prediction = await createPrediction({
      prompt: clip.prompt,
      duration: clip.duration,
      skeleton: 'core',
    });
    prediction = await pollUntilDone(prediction);

    if (prediction.status !== 'succeeded') {
      console.error(`[!] ${clip.name}: генерация не удалась (${prediction.status})`, prediction.error || '');
      continue;
    }

    const vrmaUrl = prediction.output && prediction.output.vrma;
    if (!vrmaUrl) {
      console.error(
        `[!] ${clip.name}: не нашёл поле "vrma" в ответе — вот что реально пришло, ` +
        `поправь имя поля в скрипте при необходимости:`
      );
      console.error(JSON.stringify(prediction.output));
      continue;
    }

    const outPath = path.join(OUT_DIR, `${clip.name}.vrma`);
    await downloadFile(vrmaUrl, outPath);
    console.log(`  -> сохранено: ${outPath}`);
  }
  console.log('\nГотово. Запусти (или перезапусти) приложение — клипы подхватятся сами,');
  console.log('станет доступна кнопка "Режим: ИИ-движения".');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
