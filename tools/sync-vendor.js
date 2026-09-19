#!/usr/bin/env node
/**
 * electron-builder по умолчанию "умно" обрезает node_modules — сам решает,
 * какие файлы нужны, по анализу require()/import в исходниках. Он не видит
 * наше использование three.js/three-vrm: мы их не require()-им в main.js, а
 * подключаем в браузере через <script type="importmap"> прямо в index.html.
 * Из-за этого GLTFLoader.js/OrbitControls.js и подобные файлы обрезались из
 * собранного .exe, хотя в dev-режиме (npm start, node_modules ещё не
 * тронуты сборщиком) всё работало.
 *
 * Решение: копируем ровно то, что реально нужно браузеру, в свою папку
 * vendor/ (НЕ node_modules) — её electron-builder не трогает вообще, потому
 * что это просто наши собственные файлы проекта, а не chunk из npm-пакета.
 *
 * Запускается автоматически после каждого `npm install` (см. "postinstall"
 * в package.json) — вручную запускать не нужно.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'vendor');

const PACKAGES_TO_COPY = [
  // Копируем пакет целиком (а не отдельные файлы), чтобы не сломать
  // внутренние относительные импорты между файлами самого пакета.
  { from: 'node_modules/three', to: 'vendor/three' },
  { from: 'node_modules/@pixiv/three-vrm', to: 'vendor/@pixiv/three-vrm' },
  { from: 'node_modules/@pixiv/three-vrm-animation', to: 'vendor/@pixiv/three-vrm-animation' },
];

function copyPackage(fromRel, toRel) {
  const from = path.join(ROOT, fromRel);
  const to = path.join(ROOT, toRel);

  if (!fs.existsSync(from)) {
    console.error(`[vendor-sync] Не найдено: ${fromRel} — пропускаю (npm install точно выполнен?)`);
    return;
  }

  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`[vendor-sync] ${fromRel} -> ${toRel}`);
}

for (const { from, to } of PACKAGES_TO_COPY) {
  copyPackage(from, to);
}

console.log('[vendor-sync] Готово.');
