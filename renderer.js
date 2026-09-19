// --- Пересылка ошибок/console в файл лога (main.js это пишет на диск) ------
// Ставим САМОЙ ПЕРВОЙ вещью в файле, до всех import — если импорт самого
// three.js/three-vrm упадёт (например, файл не найден при сборке в .exe),
// это тоже должно попасть в лог, а не потеряться до того, как логгер
// успеет подключиться.
window.addEventListener('error', (e) => {
  const msg = e.error && e.error.stack ? e.error.stack : `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
  window.electronAPI && window.electronAPI.logToFile('error', msg);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason && e.reason.stack ? e.reason.stack : String(e.reason);
  window.electronAPI && window.electronAPI.logToFile('error', `Unhandled promise rejection: ${reason}`);
});
{
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args) => {
    origError(...args);
    window.electronAPI && window.electronAPI.logToFile('error', args.map(String).join(' '));
  };
  console.warn = (...args) => {
    origWarn(...args);
    window.electronAPI && window.electronAPI.logToFile('warn', args.map(String).join(' '));
  };
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

const container = document.getElementById('scene-container');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

// --- Сцена, камера, рендерер -------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202329);
scene.fog = new THREE.Fog(0x202329, 3, 11); // мягкая глубина — сцена не выглядит плоской

const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  0.1,
  20
);
camera.position.set(0, 1.3, 2.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

// Ключевой свет спереди-сверху + мягкий холодный заполняющий свет с другой
// стороны — без него лицо выглядело плоско (один источник + ambient).
const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.4);
keyLight.position.set(1, 1.6, 1.2);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fbfff, 0.9);
fillLight.position.set(-1.2, 0.6, -0.8);
scene.add(fillLight);

scene.add(new THREE.AmbientLight(0xffffff, 0.35));

// Небольшая круглая сценическая площадка вместо голой сетки во все стороны.
const stage = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 64),
  new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.9, metalness: 0.05 })
);
stage.rotation.x = -Math.PI / 2;
scene.add(stage);

const stageRing = new THREE.Mesh(
  new THREE.RingGeometry(2.15, 2.22, 64),
  new THREE.MeshBasicMaterial({ color: 0x5a7ea8, side: THREE.DoubleSide })
);
stageRing.rotation.x = -Math.PI / 2;
stageRing.position.y = 0.001;
scene.add(stageRing);

// --- Орбитальная камера ------------------------------------------------------
// Лимиты зума согласованы с дальностью прорисовки камеры (camera far = 20),
// чтобы не повторить баг рассинхронизации лимитов из прошлого проекта.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.minDistance = 0.5;
controls.maxDistance = 8;
controls.enableDamping = true;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Веб-камера: диффузное управление камерой (опционально) ------------------
// Порт идеи из прошлого Python-проекта: покадровая разница яркости
// (motion = |текущий_кадр - предыдущий|) + сглаживание по соседним клеткам
// ("диффузия", простой box-blur в один проход) вместо сырого шумного диффа.
// Взвешенный центроид получившегося поля движения по X/Y плавно разворачивает
// орбитальную камеру в сторону, где было движение; без движения камера сама
// возвращается к центру. Мышиное управление (OrbitControls) на время выкл.

const WEBCAM_GRID_W = 32;
const WEBCAM_GRID_H = 24;
const CAM_MAX_SWING_AZIMUTH = 0.6; // рад, ~34°
const CAM_MAX_SWING_POLAR = 0.3;
const CAM_MOTION_THRESHOLD = 6; // 0..255, игнорировать совсем слабый шум

let webcamActive = false;
let webcamStream = null;
let webcamVideo = null;
let webcamPrevGray = null;
const webcamPreviewCanvas = document.getElementById('webcam-preview');
const webcamPreviewCtx = webcamPreviewCanvas.getContext('2d');

let camBaseAzimuth = 0;
let camBasePolar = 0;
let camAzimuth = 0;
let camPolar = 0;
let camAzimuthTarget = 0;
let camPolarTarget = 0;
let camDistance = 2.2;

function captureCameraSpherical() {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  camDistance = spherical.radius;
  camBaseAzimuth = spherical.theta;
  camBasePolar = spherical.phi;
  camAzimuth = camBaseAzimuth;
  camPolar = camBasePolar;
  camAzimuthTarget = camBaseAzimuth;
  camPolarTarget = camBasePolar;
}

async function toggleWebcam() {
  const btn = document.getElementById('btn-toggle-webcam');

  if (webcamActive) {
    webcamActive = false;
    if (webcamStream) webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
    webcamVideo = null;
    webcamPrevGray = null;
    controls.enabled = true;
    btn.textContent = 'Веб-камера: выкл';
    setStatus('Веб-камера выключена');
    return;
  }

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    webcamVideo = document.createElement('video');
    webcamVideo.srcObject = webcamStream;
    webcamVideo.muted = true;
    await webcamVideo.play();

    captureCameraSpherical();
    controls.enabled = false;
    webcamActive = true;
    btn.textContent = 'Веб-камера: вкл';
    setStatus('Веб-камера включена — двигайтесь в кадре');
  } catch (err) {
    console.error(err);
    setStatus(`Не удалось включить веб-камеру: ${err.message}`);
  }
}

document.getElementById('btn-toggle-webcam').addEventListener('click', toggleWebcam);

function updateWebcamCameraControl(delta) {
  if (!webcamActive || !webcamVideo) return;

  webcamPreviewCtx.drawImage(webcamVideo, 0, 0, WEBCAM_GRID_W, WEBCAM_GRID_H);
  const frame = webcamPreviewCtx.getImageData(0, 0, WEBCAM_GRID_W, WEBCAM_GRID_H);
  const pixels = frame.data;
  const n = WEBCAM_GRID_W * WEBCAM_GRID_H;

  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gray[i] = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
  }

  if (webcamPrevGray) {
    const diff = new Float32Array(n);
    for (let i = 0; i < n; i++) diff[i] = Math.abs(gray[i] - webcamPrevGray[i]);

    // Диффузия: один проход усреднения с 4 соседями (сглаживает шум сенсора
    // в связные "пятна" движения, а не одиночные мерцающие пиксели).
    const diffused = new Float32Array(n);
    for (let y = 0; y < WEBCAM_GRID_H; y++) {
      for (let x = 0; x < WEBCAM_GRID_W; x++) {
        const i = y * WEBCAM_GRID_W + x;
        const left = x > 0 ? diff[i - 1] : diff[i];
        const right = x < WEBCAM_GRID_W - 1 ? diff[i + 1] : diff[i];
        const up = y > 0 ? diff[i - WEBCAM_GRID_W] : diff[i];
        const down = y < WEBCAM_GRID_H - 1 ? diff[i + WEBCAM_GRID_W] : diff[i];
        const v = (diff[i] * 2 + left + right + up + down) / 6;
        diffused[i] = v < CAM_MOTION_THRESHOLD ? 0 : v;
      }
    }

    // Предпросмотр — визуализация поля движения (для проверки, что вообще работает).
    const previewImage = webcamPreviewCtx.createImageData(WEBCAM_GRID_W, WEBCAM_GRID_H);
    for (let i = 0; i < n; i++) {
      const v = Math.min(255, diffused[i] * 4);
      previewImage.data[i * 4] = v;
      previewImage.data[i * 4 + 1] = v * 0.6;
      previewImage.data[i * 4 + 2] = 255 - v;
      previewImage.data[i * 4 + 3] = 255;
    }
    webcamPreviewCtx.putImageData(previewImage, 0, 0);

    let sumW = 0, sumX = 0, sumY = 0;
    for (let y = 0; y < WEBCAM_GRID_H; y++) {
      for (let x = 0; x < WEBCAM_GRID_W; x++) {
        const w = diffused[y * WEBCAM_GRID_W + x];
        sumW += w;
        sumX += w * x;
        sumY += w * y;
      }
    }

    if (sumW > CAM_MOTION_THRESHOLD * 20) {
      const centroidX = sumX / sumW / WEBCAM_GRID_W; // 0..1
      const centroidY = sumY / sumW / WEBCAM_GRID_H; // 0..1
      const dx = centroidX - 0.5;
      const dy = centroidY - 0.5;
      camAzimuthTarget = camBaseAzimuth - dx * 2 * CAM_MAX_SWING_AZIMUTH;
      camPolarTarget = camBasePolar + dy * 2 * CAM_MAX_SWING_POLAR;
    } else {
      // Нет заметного движения — плавно возвращаемся к центру.
      camAzimuthTarget = camBaseAzimuth;
      camPolarTarget = camBasePolar;
    }
  }

  webcamPrevGray = gray;

  camAzimuth += (camAzimuthTarget - camAzimuth) * (1 - Math.exp(-3 * delta));
  camPolar += (camPolarTarget - camPolar) * (1 - Math.exp(-3 * delta));
  camPolar = Math.max(0.4, Math.min(1.3, camPolar));

  const offset = new THREE.Vector3().setFromSphericalCoords(camDistance, camPolar, camAzimuth);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
}

// --- Загрузка VRM -------------------------------------------------------------

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

let currentVRM = null;

function loadVRM(path) {
  setStatus(`Загрузка модели: ${path}`);
  loader.load(
    path,
    (gltf) => {
      const vrm = gltf.userData.vrm;

      if (currentVRM) {
        scene.remove(currentVRM.scene);
        VRMUtils.deepDispose(currentVRM.scene);
      }

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.combineMorphs(vrm);

      // Модель не смотрит "в камеру" по умолчанию в three-vrm — разворачиваем.
      vrm.scene.rotation.y = Math.PI;

      scene.add(vrm.scene);
      currentVRM = vrm;
      captureDanceBaseline(vrm);
      rebindMocapClipsForVRM(vrm);
      setStatus(`Готово: ${path}`);
    },
    (progress) => {
      if (progress.total) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        setStatus(`Загрузка модели... ${pct}%`);
      }
    },
    (error) => {
      console.error(error);
      setStatus(`Ошибка загрузки: ${error.message || error}`);
    }
  );
}

loadVRM(window.APP_CONFIG.defaultVRMPath);

document.getElementById('btn-load-vrm').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openVRMDialog();
  if (filePath) loadVRM(filePath);
});

// --- Вторая модель (дуэт) ------------------------------------------------
// Независимая от первой: своя стойка/танец, но тот же общий бит/интенсивность
// (единственный источник звука один на двоих). Зеркалим позы рук/поворотов,
// чтобы дуэт не выглядел как два идентичных клона.

let secondVRM = null;

function loadSecondVRM(path) {
  setStatus(`Загрузка второй модели: ${path}`);
  loader.load(
    path,
    (gltf) => {
      const vrm = gltf.userData.vrm;
      if (secondVRM) {
        scene.remove(secondVRM.scene);
        VRMUtils.deepDispose(secondVRM.scene);
      }
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.combineMorphs(vrm);
      vrm.scene.rotation.y = Math.PI;

      scene.add(vrm.scene);
      secondVRM = vrm;
      captureSecondBaseline(vrm);

      // Разводим модели по сторонам и чуть отодвигаем камеру, чтобы обе
      // помещались в кадр — раньше была одна модель по центру.
      if (currentVRM) currentVRM.scene.position.x = -0.55;
      secondVRM.scene.position.x = 0.55;
      camera.position.z += 0.6;
      controls.target.set(0, 1.0, 0);
      captureCameraSpherical();

      setStatus(`Готово: вторая модель загружена (${path})`);
    },
    (progress) => {
      if (progress.total) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        setStatus(`Загрузка второй модели... ${pct}%`);
      }
    },
    (error) => {
      console.error(error);
      setStatus(`Ошибка загрузки второй модели: ${error.message || error}`);
    }
  );
}

document.getElementById('btn-load-vrm-2').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openVRMDialog();
  if (filePath) loadSecondVRM(filePath);
});

// --- Эмоции --------------------------------------------------------------
// three-vrm абстрагирует разницу VRM 0.x/1.0 через expressionManager;
// используем единые имена пресетов VRM 1.0.

const EMOTION_PRESETS = ['happy', 'angry', 'sad', 'surprised'];

function setEmotion(name) {
  if (!currentVRM || !currentVRM.expressionManager) return;
  for (const preset of EMOTION_PRESETS) {
    currentVRM.expressionManager.setValue(preset, preset === name ? 1.0 : 0.0);
  }
}

document.getElementById('emotion-buttons').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-emotion]');
  if (!btn) return;
  setEmotion(btn.dataset.emotion);
});

// --- ИИ-режиссёр: эмоция + реплика по описанию сцены -------------------------
// Сам запрос уходит в main.js (там нет CORS-проблем с локальным Ollama и
// удобнее прятать опциональный ANTHROPIC_API_KEY, если он вообще задан).

const SOURCE_LABELS = {
  ollama: 'Ollama (локально, бесплатно)',
  anthropic: 'Anthropic (платный запасной)',
  keyword: 'ключевые слова (без ИИ)',
};

let subtitleTimeout = null;
function showSubtitle(line) {
  const el = document.getElementById('subtitle');
  clearTimeout(subtitleTimeout);
  if (!line) {
    el.classList.remove('visible');
    return;
  }
  el.textContent = line;
  el.classList.add('visible');
  subtitleTimeout = setTimeout(() => el.classList.remove('visible'), 6000);
}

const directorStatusEl = document.getElementById('director-status');
document.getElementById('btn-director-ask').addEventListener('click', async () => {
  const input = document.getElementById('director-input');
  const description = input.value.trim();
  if (!description) return;

  directorStatusEl.textContent = 'Спрашиваю режиссёра...';
  try {
    const result = await window.electronAPI.queryAIDirector(description);
    setEmotion(result.emotion);
    showSubtitle(result.line);
    const sourceLabel = SOURCE_LABELS[result.source] || result.source;
    directorStatusEl.textContent = `Источник: ${sourceLabel} · эмоция: ${result.emotion}`;
  } catch (e) {
    directorStatusEl.textContent = `Ошибка режиссёра: ${e.message}`;
  }
});

// --- Пение (лип-синк от громкости) -------------------------------------------
// Один общий AnalyserNode переключается между источниками (микрофон / файл),
// чтобы не плодить отдельные графы для каждого. Громкость (RMS) идёт напрямую
// в блендшейп 'aa' — это простой, но рабочий вариант из плана (полноценная
// классификация гласных a/i/u/e/o — апгрейд на будущее, не в MVP).

let audioContext = null;
let analyser = null;
let analyserData = null;
let currentAudioSourceNode = null; // MediaStreamAudioSourceNode или AudioBufferSourceNode
let micStream = null;
let lipSyncActive = false;

// Если для загруженного файла нашлась заранее просчитанная партитура
// (см. tools/analyze_song.py), используем её вместо угадывания на лету:
// точные времена битов, вокальная огибающая для лип-синка, интенсивность
// танца по секциям трека (тихо/средне/громко).
let songDanceData = null;
let songStartCtxTime = 0; // audioContext.currentTime в момент старта воспроизведения (устарело при смене скорости — см. ниже)
let currentPlaybackRate = 1;
let songPositionAtLastRateChange = 0; // позиция в треке (сек) на момент последней смены скорости/старта
let ctxTimeAtLastRateChange = 0; // audioContext.currentTime в тот же момент
let songBeatCursor = 0;
let currentAudioPath = null; // для сопоставления с событиями фонового анализа

const lipsyncBar = document.getElementById('lipsync-bar');
const micButton = document.getElementById('btn-toggle-mic');
const danceDataStatusEl = document.getElementById('dance-data-status');

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyserData = new Float32Array(analyser.fftSize);
  }
  return audioContext;
}

function disconnectCurrentSource() {
  if (currentAudioSourceNode) {
    try {
      currentAudioSourceNode.disconnect();
    } catch (e) {
      /* уже отключен — не страшно */
    }
    currentAudioSourceNode = null;
  }
}

function currentSongTime() {
  if (!audioContext) return 0;
  // audioContext.currentTime сам "стоит" во время паузы — этим и держится
  // синхронизация на паузе. При смене скорости пересчитываем от последней
  // контрольной точки, а не от старта трека, иначе позиция была бы неверной
  // после любого изменения playbackRate.
  return songPositionAtLastRateChange + (audioContext.currentTime - ctxTimeAtLastRateChange) * currentPlaybackRate;
}

async function toggleMic() {
  ensureAudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
    disconnectCurrentSource();
    lipSyncActive = false;
    songDanceData = null;
    currentAudioPath = null;
    micButton.textContent = 'Микрофон: выкл';
    setStatus('Микрофон выключен');
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    disconnectCurrentSource();
    const source = audioContext.createMediaStreamSource(micStream);
    source.connect(analyser);
    // Важно: НЕ подключаем analyser/микрофон к destination — иначе будет эхо.
    currentAudioSourceNode = source;
    lipSyncActive = true;
    songDanceData = null; // для живого микрофона партитуры быть не может
    currentAudioPath = null;
    danceDataStatusEl.textContent = '';
    micButton.textContent = 'Микрофон: вкл';
    pauseButton.textContent = 'Пауза'; // на случай, если до этого была пауза от файла
    speedSlider.value = '1';
    speedValueEl.textContent = '1.00x';
    currentPlaybackRate = 1;
    setStatus('Микрофон включён — пойте');
  } catch (err) {
    console.error(err);
    setStatus(`Не удалось включить микрофон: ${err.message}`);
  }
}

micButton.addEventListener('click', toggleMic);

async function loadAndPlayAudio() {
  const result = await window.electronAPI.openAudioDialog();
  if (!result) return;

  // Фикс: раньше currentAudioPath выставлялся только после decodeAudioData()
  // ниже, а событие 'started' от фонового Python-анализа приходит из main.js
  // почти мгновенно — и тихо отбрасывалось фильтром
  // payload.audioPath !== currentAudioPath в onAudioAnalysisStatus.
  // Выставляем путь сразу, как только он известен.
  currentAudioPath = result.audioPath;
  window.electronAPI && window.electronAPI.logToFile('info', `[audio] currentAudioPath установлен: ${currentAudioPath}`);

  ensureAudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
    micButton.textContent = 'Микрофон: выкл';
  }
  disconnectCurrentSource();

  setStatus(`Декодирование аудио: ${result.fileName}`);
  const audioBuffer = await audioContext.decodeAudioData(result.audioArrayBuffer);

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(analyser);
  analyser.connect(audioContext.destination); // файл должен быть слышен

  songDanceData = result.danceData || null;
  songBeatCursor = 0;
  songStartCtxTime = audioContext.currentTime;
  currentAudioPath = result.audioPath;

  currentPlaybackRate = 1;
  songPositionAtLastRateChange = 0;
  ctxTimeAtLastRateChange = audioContext.currentTime;
  source.playbackRate.value = 1;
  speedSlider.value = '1';
  speedValueEl.textContent = '1.00x';

  source.start(0);
  currentAudioSourceNode = source;
  lipSyncActive = true;
  pauseButton.textContent = 'Пауза'; // сброс на случай, если предыдущий трек был на паузе

  if (songDanceData) {
    danceDataStatusEl.textContent =
      `Найдена партитура: ${songDanceData.bpm} BPM, ${songDanceData.beats.length} битов ` +
      `(режим анализа: ${songDanceData.quality})`;
    setStatus(`Играет: ${result.fileName} (точная партитура движений)`);
  } else {
    danceDataStatusEl.textContent =
      'Партитуры ещё нет — считаю автоматически в фоне (не мешает воспроизведению)...';
    setStatus(`Играет: ${result.fileName} (пока в реальном времени, партитура считается в фоне)`);
  }

  source.onended = () => {
    lipSyncActive = false;
    songDanceData = null;
    currentAudioPath = null;
    danceDataStatusEl.textContent = '';
    analyser.disconnect(audioContext.destination);
    setStatus('Аудио закончилось');
  };
}

document.getElementById('btn-load-audio').addEventListener('click', loadAndPlayAudio);

const pauseButton = document.getElementById('btn-pause');
pauseButton.addEventListener('click', () => {
  if (!audioContext) return;
  if (audioContext.state === 'running') {
    audioContext.suspend();
    pauseButton.textContent = 'Играть';
    setStatus('Пауза');
  } else if (audioContext.state === 'suspended') {
    audioContext.resume();
    pauseButton.textContent = 'Пауза';
    setStatus('Играет');
  }
});

const speedSlider = document.getElementById('speed-slider');
const speedValueEl = document.getElementById('speed-value');
speedSlider.addEventListener('input', () => {
  const rate = parseFloat(speedSlider.value);
  speedValueEl.textContent = `${rate.toFixed(2)}x`;

  // Фиксируем текущую позицию в треке ДО смены скорости, иначе формула в
  // currentSongTime() "прыгнет" (она считает от последней контрольной точки
  // с последней известной скоростью).
  if (audioContext) {
    songPositionAtLastRateChange = currentSongTime();
    ctxTimeAtLastRateChange = audioContext.currentTime;
  }
  currentPlaybackRate = rate;

  if (currentAudioSourceNode && currentAudioSourceNode.playbackRate) {
    currentAudioSourceNode.playbackRate.value = rate;
  }
});

// Фоновый автоанализ (main.js сам запускает python tools/analyze_song.py,
// если рядом с файлом ещё нет .dance.json). Как только он готов — подставляем
// партитуру на лету, без перезапуска трека: пересчитываем, с какого бита
// продолжать (беты до текущего момента уже "прошли"), и с этого кадра танец
// становится точным вместо предположений в реальном времени.
window.electronAPI.onAudioAnalysisStatus((payload) => {
  window.electronAPI.logToFile(
    'info',
    `[audio-analysis-status] payload.audioPath=${payload.audioPath} currentAudioPath=${currentAudioPath} status=${payload.status}`
  );
  if (payload.audioPath !== currentAudioPath) return; // трек уже сменился

  if (payload.status === 'started') {
    danceDataStatusEl.textContent = 'Считаю партитуру автоматически в фоне...';
  } else if (payload.status === 'done') {
    songDanceData = payload.danceData;
    const t = currentSongTime();
    songBeatCursor = songDanceData.beats.findIndex((b) => b > t);
    if (songBeatCursor === -1) songBeatCursor = songDanceData.beats.length;
    danceDataStatusEl.textContent =
      `Партитура подключена на лету: ${songDanceData.bpm} BPM, ${songDanceData.beats.length} битов`;
  } else if (payload.status === 'error') {
    danceDataStatusEl.textContent = `Автоанализ не удался: ${payload.message}`;
  }
});

function updateLipSync() {
  if (!currentVRM || !currentVRM.expressionManager) return;
  if (audioContext && audioContext.state === 'suspended') return; // пауза — держим последний кадр

  if (!lipSyncActive) {
    currentVRM.expressionManager.setValue('aa', 0);
    lipsyncBar.style.width = '0%';
    return;
  }

  let mouthOpen;

  if (songDanceData) {
    // Точная предпросчитанная вокальная огибающая — интерполируем по времени.
    const env = songDanceData.vocal_envelope;
    const t = currentSongTime();
    const idxFloat = t / env.hop_seconds;
    const idx0 = Math.max(0, Math.min(env.values.length - 1, Math.floor(idxFloat)));
    const idx1 = Math.min(env.values.length - 1, idx0 + 1);
    const frac = idxFloat - idx0;
    const v0 = env.values[idx0] ?? 0;
    const v1 = env.values[idx1] ?? v0;
    mouthOpen = v0 + (v1 - v0) * frac;
  } else if (analyser) {
    // Живой источник (микрофон) или файл без партитуры — простой RMS на лету.
    analyser.getFloatTimeDomainData(analyserData);
    let sumSquares = 0;
    for (let i = 0; i < analyserData.length; i++) {
      sumSquares += analyserData[i] * analyserData[i];
    }
    const rms = Math.sqrt(sumSquares / analyserData.length);
    mouthOpen = Math.min(1, rms * 6);
  } else {
    mouthOpen = 0;
  }

  currentVRM.expressionManager.setValue('aa', mouthOpen);
  lipsyncBar.style.width = `${Math.round(mouthOpen * 100)}%`;
}

// --- ИИ-движения (mocap): готовые .vrma-клипы вместо ручных формул --------
//
// Если в assets/dances/ лежат клипы, сгенерированные tools/generate_dances.js
// (нейросеть NVIDIA ARDY, текст -> 3D-движение тела), проигрываем их через
// стандартный three.js AnimationMixer — это РЕАЛЬНОЕ, не процедурное
// движение тела (не только руки/ноги по синусоиде). Кроссфейд между
// уровнями энергии секции трека + отдельный клип-разворот на сцене.
//
// Если клипов нет — кнопка режима остаётся выключенной, работает только
// процедурный танец (см. ниже).

const MOCAP_CATEGORIES = ['idle_low', 'dance_mid', 'dance_high', 'turn_spin'];
const MOCAP_MAX_VARIANTS = 8; // сколько пронумерованных файлов пробовать на категорию
const MOCAP_VARIANT_SWITCH_INTERVAL = 15; // сек — как часто пробуем сменить вариант той же категории

const mocapVariants = {}; // category -> [{type, data}, ...] (не привязаны к конкретной модели)
let danceClips = {}; // "category::index" -> THREE.AnimationClip, привязанные к currentVRM
let danceMixer = null;
let currentMocapAction = null;
let currentMocapClipName = null; // "category::index" или null
let currentMocapCategory = null;
let mocapCategoryStartTime = 0;
let danceMode = 'procedural'; // 'procedural' | 'mocap'

const mocapStatusEl = document.getElementById('mocap-status');
const mocapModeButton = document.getElementById('btn-dance-mode');

async function tryLoadMocapFile(filename) {
  // Сначала свой формат (из локального ARDY через tools/convert_ardy_motion.py) —
  // не требует @pixiv/three-vrm-animation вообще, мы сами строим клип.
  try {
    const res = await fetch(`assets/dances/${filename}.motion.json`);
    if (res.ok) return { type: 'motionjson', data: await res.json() };
  } catch (e) {
    /* файла нет — пробуем .vrma ниже */
  }
  try {
    const gltf = await loader.loadAsync(`assets/dances/${filename}.vrma`);
    const vrmAnimation = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
    if (vrmAnimation) return { type: 'vrma', data: vrmAnimation };
  } catch (e) {
    /* нет и такого — нормально */
  }
  return null;
}

async function loadMocapAnimations() {
  for (const category of MOCAP_CATEGORIES) {
    const variants = [];

    // Имя без номера — для обратной совместимости с уже сгенерированными клипами.
    const bare = await tryLoadMocapFile(category);
    if (bare) variants.push(bare);

    // Пронумерованные варианты: category_1, category_2, ... до первого пропуска
    // (библиотека пополняется просто добавлением category_N.motion.json).
    for (let i = 1; i <= MOCAP_MAX_VARIANTS; i++) {
      const v = await tryLoadMocapFile(`${category}_${i}`);
      if (!v) break;
      variants.push(v);
    }

    if (variants.length > 0) mocapVariants[category] = variants;
  }

  const totalClips = Object.values(mocapVariants).reduce((sum, arr) => sum + arr.length, 0);
  if (totalClips > 0) {
    mocapModeButton.disabled = false;
    const categoriesFound = Object.keys(mocapVariants).length;
    mocapStatusEl.textContent = `ИИ-движения: ${totalClips} клип(ов) в ${categoriesFound} категориях`;
    if (currentVRM) rebindMocapClipsForVRM(currentVRM);
  } else {
    mocapStatusEl.textContent = 'ИИ-движения: клипы не найдены (см. tools/generate_dances.js или tools/convert_ardy_motion.py)';
  }
}

// Строит THREE.AnimationClip из своего JSON (кватернионы по костям VRM +
// смещение бёдер), без какого-либо специального VRM-формата — обычный
// three.js AnimationClip, который тем же AnimationMixer проигрывается
// одинаково что для .vrma, что для этого.
function buildClipFromMotionJSON(json, vrm) {
  const fps = json.fps;
  const nFrames = json.hipsPositionDelta.length;
  const times = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) times[i] = i / fps;

  const tracks = [];

  for (const [boneName, quats] of Object.entries(json.tracks)) {
    const node = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) continue; // у этой модели нет такой кости (редко, но возможно)

    const values = new Float32Array(nFrames * 4);
    for (let i = 0; i < nFrames; i++) {
      const [w, x, y, z] = quats[i];
      // THREE.Quaternion хранит порядок (x,y,z,w), наш JSON — (w,x,y,z).
      values[i * 4 + 0] = x;
      values[i * 4 + 1] = y;
      values[i * 4 + 2] = z;
      values[i * 4 + 3] = w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
  }

  const hipsNode = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('hips');
  if (hipsNode && danceBaseline) {
    const values = new Float32Array(nFrames * 3);
    for (let i = 0; i < nFrames; i++) {
      const [dx, dy, dz] = json.hipsPositionDelta[i];
      values[i * 3 + 0] = danceBaseline.hipsX + dx;
      values[i * 3 + 1] = danceBaseline.hipsY + dy;
      values[i * 3 + 2] = danceBaseline.hipsZ + dz;
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${hipsNode.name}.position`, times, values));
  }

  return new THREE.AnimationClip(`motion-${Date.now()}`, nFrames / fps, tracks);
}

function rebindMocapClipsForVRM(vrm) {
  danceClips = {};
  for (const [category, variants] of Object.entries(mocapVariants)) {
    variants.forEach((entry, i) => {
      const key = `${category}::${i}`;
      try {
        danceClips[key] =
          entry.type === 'motionjson'
            ? buildClipFromMotionJSON(entry.data, vrm)
            : createVRMAnimationClip(entry.data, vrm);
      } catch (e) {
        console.error(`Не удалось привязать клип "${key}" к текущей модели:`, e);
      }
    });
  }
  danceMixer = new THREE.AnimationMixer(vrm.scene);
  currentMocapAction = null;
  currentMocapClipName = null;
  currentMocapCategory = null;
}

// Случайный вариант ВНУТРИ категории (idle_low/dance_mid/dance_high/turn_spin) —
// так библиотека из нескольких сгенерированных клипов реально используется,
// а не залипает на первом же найденном файле.
function pickMocapVariantKey(category) {
  const variants = mocapVariants[category];
  if (!variants || variants.length === 0) return null;
  const idx = Math.floor(Math.random() * variants.length);
  return `${category}::${idx}`;
}

function playMocapClip(key, fadeDuration = 0.4) {
  if (!danceMixer || !danceClips[key] || currentMocapClipName === key) return;

  const action = danceMixer.clipAction(danceClips[key]);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.fadeIn(fadeDuration);
  action.play();

  if (currentMocapAction && currentMocapAction !== action) {
    currentMocapAction.fadeOut(fadeDuration);
  }
  currentMocapAction = action;
  currentMocapClipName = key;
}

function playMocapOneShot(key, onFinished) {
  if (!danceMixer || !danceClips[key]) return false;

  const action = danceMixer.clipAction(danceClips[key]);
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.fadeIn(0.15);
  action.play();

  if (currentMocapAction && currentMocapAction !== action) {
    currentMocapAction.fadeOut(0.15);
  }
  currentMocapAction = action;
  currentMocapClipName = key;

  const mixer = danceMixer;
  const handler = (e) => {
    if (e.action !== action) return;
    mixer.removeEventListener('finished', handler);
    currentMocapClipName = null; // форсируем, чтобы playMocapClip не увидел "уже играет"
    onFinished();
  };
  mixer.addEventListener('finished', handler);
  return true;
}

function updateDanceMocap(delta, intensity, isBeat) {
  if (!danceMixer) return;

  const energyCategory = intensity <= 0.6 ? 'idle_low' : intensity >= 1.3 ? 'dance_high' : 'dance_mid';

  if (isBeat && totalBeatCount % 8 === 0 && mocapVariants['turn_spin']) {
    const spinKey = pickMocapVariantKey('turn_spin');
    if (spinKey) {
      playMocapOneShot(spinKey, () => {
        const key = pickMocapVariantKey(energyCategory);
        if (key) {
          playMocapClip(key, 0.3);
          currentMocapCategory = energyCategory;
          mocapCategoryStartTime = performance.now();
        }
      });
      danceMixer.update(delta);
      return;
    }
  }

  if (currentMocapClipName === null || currentMocapCategory !== energyCategory) {
    const key = pickMocapVariantKey(energyCategory);
    if (key) {
      playMocapClip(key);
      currentMocapCategory = energyCategory;
      mocapCategoryStartTime = performance.now();
    }
  } else {
    // Та же категория играет уже давно — иногда переключаем на ДРУГОЙ
    // вариант внутри неё, чтобы вся сгенерированная библиотека реально
    // была видна за длинный трек, а не только первый выбранный клип.
    const variants = mocapVariants[energyCategory];
    const elapsed = (performance.now() - mocapCategoryStartTime) / 1000;
    if (variants && variants.length > 1 && elapsed > MOCAP_VARIANT_SWITCH_INTERVAL) {
      const key = pickMocapVariantKey(energyCategory);
      if (key) {
        playMocapClip(key, 0.6);
        mocapCategoryStartTime = performance.now();
      }
    }
  }

  danceMixer.update(delta);
}

mocapModeButton.addEventListener('click', () => {
  danceMode = danceMode === 'procedural' ? 'mocap' : 'procedural';
  mocapModeButton.textContent = danceMode === 'mocap' ? 'Режим: ИИ-движения' : 'Режим: процедурный';
  if (currentMocapAction) {
    currentMocapAction.stop();
    currentMocapAction = null;
    currentMocapClipName = null;
    currentMocapCategory = null;
  }
  resetDancePose();
});

loadMocapAnimations();

// --- Танец: детекция битов + хореография поз (не покадровый шум) -------------
//
// Два независимых слоя движения, как в нормальной анимации персонажа, а не
// "дрожание инфузории":
//  1) непрерывный ГРУВ — плавное синусоидальное покачивание бёдер/корпуса/
//     головы на оценённом темпе, есть всегда, пока включён танец;
//  2) на каждый ОБНАРУЖЕННЫЙ БИТ — переключение на следующую заранее
//     поставленную позу рук/корпуса из небольшого набора, при этом переход
//     к ней демпфированный (экспоненциальное сближение), а не мгновенный —
//     из-за этого выглядит как осознанное движение, а не тик.
//
// Детекция бита — энергетический метод по низким частотам (бас), со сравнением
// текущей энергии со скользящим средним; без звука — танец идёт под
// смоделированный ровный темп, чтобы не быть статичным.

let danceActive = false;
let danceBaseline = null;
const DANCE_BONE_NAMES = [
  'hips', 'spine', 'chest', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
];

let freqData = null;
let bassHistory = [];
const BASS_HISTORY_LEN = 43; // ~0.7с при 60 fps
let lastBeatAt = 0;
let beatIntervalEstimate = 500; // мс; уточняется по факту детектированных битов
let simulatedBeatClock = 0;

let groovePhase = 0;
let hipImpulse = 0; // 0..1, резкий рост на бит и экспоненциальный спад

let poseIndex = 0;
let poseCurrent = {};
let poseTarget = {};

let totalBeatCount = 0;
let turnTarget = 0; // куда должны довернуться бёдра/плечи (поворот "как на сцене")
let turnCurrent = 0;

// Каждая поза — небольшой набор угловых смещений (радианы) от исходной позы
// модели для РУК/КОРПУСА/ГОЛОВЫ. Ноги в позы не входят — они двигаются
// отдельным непрерывным слоем (см. ниже), имитируя перенос веса и шаги на
// месте, а не застывают в T-позе между сменами поз рук.
const DANCE_POSES = [
  {
    rightUpperArm: { x: -0.9, y: 0.15, z: -0.25 }, rightLowerArm: { x: -0.4 },
    leftUpperArm: { x: -0.2, y: -0.05, z: 0.15 }, leftLowerArm: { x: -0.3 },
    spine: { y: 0.12 }, head: { y: 0.1, z: 0.05 },
  },
  {
    leftUpperArm: { x: -0.9, y: -0.15, z: 0.25 }, leftLowerArm: { x: -0.4 },
    rightUpperArm: { x: -0.2, y: 0.05, z: -0.15 }, rightLowerArm: { x: -0.3 },
    spine: { y: -0.12 }, head: { y: -0.1, z: -0.05 },
  },
  {
    rightUpperArm: { x: -0.6, y: 0.2, z: -0.5 }, rightLowerArm: { x: -0.45 },
    leftUpperArm: { x: -0.6, y: -0.2, z: 0.5 }, leftLowerArm: { x: -0.45 },
    spine: { y: 0 }, head: { y: 0, z: 0.08 },
  },
  {
    rightUpperArm: { x: -0.3, y: 0, z: -0.15 }, rightLowerArm: { x: -0.3 },
    leftUpperArm: { x: -0.3, y: 0, z: 0.15 }, leftLowerArm: { x: -0.3 },
    spine: { y: 0 }, head: { y: 0.05, z: 0 },
  },
  {
    // Руки скрещены к груди, чуть довёрнут корпус — контрастная "остановка".
    rightUpperArm: { x: -1.1, y: -0.2, z: -0.9 }, rightLowerArm: { x: -1.6, y: -0.3 },
    leftUpperArm: { x: -1.1, y: 0.2, z: 0.9 }, leftLowerArm: { x: -1.6, y: 0.3 },
    spine: { y: -0.08 }, head: { y: -0.05, z: -0.03 },
  },
  {
    // Обе руки по диагонали вверх — акцентная поза на сильную долю.
    rightUpperArm: { x: -1.3, y: 0.3, z: -0.35 }, rightLowerArm: { x: -0.25 },
    leftUpperArm: { x: -1.3, y: -0.3, z: 0.35 }, leftLowerArm: { x: -0.25 },
    spine: { y: 0 }, head: { y: 0, z: 0 },
  },
  {
    // Одна рука вперёд-вниз по диагонали (указывающий жест), другая на бедро.
    rightUpperArm: { x: -0.15, y: -0.3, z: -0.55 }, rightLowerArm: { x: -0.1 },
    leftUpperArm: { x: -1.0, y: 0.1, z: 0.6 }, leftLowerArm: { x: -1.3, y: 0.5 },
    spine: { y: 0.06 }, head: { y: 0.08, z: 0.02 },
  },
  {
    // Волна руками наверху — обе согнуты в стороны, локти выше плеч.
    rightUpperArm: { x: -1.5, y: 0.5, z: -0.6 }, rightLowerArm: { x: -1.2, y: -0.4 },
    leftUpperArm: { x: -1.5, y: -0.5, z: 0.6 }, leftLowerArm: { x: -1.2, y: 0.4 },
    spine: { y: 0 }, head: { y: 0, z: -0.05 },
  },
  {
    // Резкий "стоп"-жест — руки прижаты вниз-назад, корпус чуть подан вперёд.
    rightUpperArm: { x: 0.2, y: -0.1, z: -0.3 }, rightLowerArm: { x: -0.15 },
    leftUpperArm: { x: 0.2, y: 0.1, z: 0.3 }, leftLowerArm: { x: -0.15 },
    spine: { y: 0, x: 0.1 }, head: { y: 0, z: 0 },
  },
  {
    // Асимметрия: одна рука высоко прямо, другая расслаблена вдоль тела.
    rightUpperArm: { x: -1.6, y: 0.1, z: -0.1 }, rightLowerArm: { x: -0.1 },
    leftUpperArm: { x: -0.1, y: 0, z: 0.1 }, leftLowerArm: { x: -0.2 },
    spine: { y: -0.05 }, head: { y: -0.06, z: 0.04 },
  },
];

// Не строгое чередование по кругу — случайный выбор без немедленного
// повтора той же позы, чтобы последовательность не была предсказуемой.
function pickNextPoseIndex(current) {
  if (DANCE_POSES.length <= 1) return 0;
  let next = Math.floor(Math.random() * DANCE_POSES.length);
  if (next === current) next = (next + 1) % DANCE_POSES.length;
  return next;
}

// "Длинные" движения: заранее заданная последовательность индексов
// DANCE_POSES, проигрываемая по порядку такт за тактом (а не случайно) —
// читается как осознанная мини-хореография, а не серия несвязанных поз.
// Между такими фразами — обычные "короткие" случайные смены каждый бит.
const DANCE_PHRASES = [
  [0, 2, 5, 3],
  [1, 6, 4, 3],
  [4, 0, 1, 7],
  [7, 2, 6, 0],
];

let activeDancePhrase = null;
let dancePhraseStep = 0;

// Раз в 16 битов (с вероятностью 50%) запускаем длинную фразу вместо
// обычной короткой случайной смены. Возвращает индекс следующей позы.
function pickNextPoseIndexWithPhrasing(current, beatCount) {
  if (activeDancePhrase) {
    const idx = activeDancePhrase[dancePhraseStep % activeDancePhrase.length];
    dancePhraseStep += 1;
    if (dancePhraseStep >= activeDancePhrase.length) activeDancePhrase = null;
    return idx;
  }

  if (beatCount % 16 === 0 && Math.random() < 0.5) {
    // Раньше тут возвращался случайный next, а фраза стартовала только со
    // СЛЕДУЮЩЕГО бита — то есть на "решающем" бите проигрывалась одна лишняя
    // несвязанная поза перед самой фразой. Стартуем фразу сразу же.
    activeDancePhrase = DANCE_PHRASES[Math.floor(Math.random() * DANCE_PHRASES.length)];
    dancePhraseStep = 1;
    return activeDancePhrase[0];
  }
  return pickNextPoseIndex(current);
}

// VRM 0.x по спецификации требует T-позу как канонический bind pose — из-за
// этого персонаж "от рождения" стоит руки горизонтально в стороны, а не
// расслабленно. Раньше это было незаметно (не было idle-анимации), теперь
// видно постоянно. Ниже — ЖИВЫЕ настройки (ползунки в интерфейсе, раздел
// "Настройка позы"): двигаешь — сразу видно на модели, без пересборки и без
// ожидания меня, потому что я сам это увидеть не могу.
let tuning = {
  armRelaxZ: 1.05, // рад — насколько опустить руки из T-позы
  forearmRelaxZ: 0.15, // сгиб локтя
  amplitudeScale: 1.0, // общий множитель размаха танца/дыхания/маха руками
  armSwingScale: 1.0, // мах руками навстречу ногам (тот самый анти-"пингвин")
};

// Восстанавливаем сохранённые настройки (если сохраняли раньше в этом окне).
try {
  const saved = localStorage.getItem('vtuber-pose-tuning');
  if (saved) Object.assign(tuning, JSON.parse(saved));
} catch (e) {
  /* нет сохранённого — используем значения по умолчанию */
}

function refreshTuningUI() {
  document.getElementById('tune-arm').value = tuning.armRelaxZ;
  document.getElementById('tune-arm-value').textContent = tuning.armRelaxZ.toFixed(2);
  document.getElementById('tune-forearm').value = tuning.forearmRelaxZ;
  document.getElementById('tune-forearm-value').textContent = tuning.forearmRelaxZ.toFixed(2);
  document.getElementById('tune-amplitude').value = tuning.amplitudeScale;
  document.getElementById('tune-amplitude-value').textContent = tuning.amplitudeScale.toFixed(2);
  document.getElementById('tune-armswing').value = tuning.armSwingScale;
  document.getElementById('tune-armswing-value').textContent = tuning.armSwingScale.toFixed(2);
}

// Ползунки "расслабление рук"/"сгиб локтей" меняют ФОРМУ базовой позы —
// пересчитываем danceBaseline/secondBaseline из их rawBones прямо сейчас,
// чтобы было видно моментально, а не после следующей загрузки модели.
function onPoseShapeTuningChanged() {
  if (danceBaseline) recomputePoseCorrection(danceBaseline);
  if (secondBaseline) recomputePoseCorrection(secondBaseline);
  if (!danceActive) {
    resetDancePose();
    resetSecondDancePose();
  }
}

document.getElementById('tune-arm').addEventListener('input', (e) => {
  tuning.armRelaxZ = parseFloat(e.target.value);
  document.getElementById('tune-arm-value').textContent = tuning.armRelaxZ.toFixed(2);
  onPoseShapeTuningChanged();
});
document.getElementById('tune-forearm').addEventListener('input', (e) => {
  tuning.forearmRelaxZ = parseFloat(e.target.value);
  document.getElementById('tune-forearm-value').textContent = tuning.forearmRelaxZ.toFixed(2);
  onPoseShapeTuningChanged();
});
document.getElementById('tune-amplitude').addEventListener('input', (e) => {
  tuning.amplitudeScale = parseFloat(e.target.value);
  document.getElementById('tune-amplitude-value').textContent = tuning.amplitudeScale.toFixed(2);
});
document.getElementById('tune-armswing').addEventListener('input', (e) => {
  tuning.armSwingScale = parseFloat(e.target.value);
  document.getElementById('tune-armswing-value').textContent = tuning.armSwingScale.toFixed(2);
});
document.getElementById('btn-tune-save').addEventListener('click', () => {
  localStorage.setItem('vtuber-pose-tuning', JSON.stringify(tuning));
  setStatus('Настройки позы сохранены');
});
document.getElementById('btn-tune-reset').addEventListener('click', () => {
  tuning = { armRelaxZ: 1.05, forearmRelaxZ: 0.15, amplitudeScale: 1.0, armSwingScale: 1.0 };
  localStorage.removeItem('vtuber-pose-tuning');
  refreshTuningUI();
  onPoseShapeTuningChanged();
  setStatus('Настройки позы сброшены на умолчания');
});
refreshTuningUI();

// ВАЖНО: раньше эта функция проверяла rotation normalized-костей сразу
// после захвата baseline — и это НИЧЕГО не диагностировало. Проверено по
// исходникам @pixiv/three-vrm (VRMHumanoidRig._setupTransforms): у
// normalized-костей свой .quaternion никогда не задаётся явно и остаётся
// identity (0,0,0) в момент создания рига — вся информация об исходной позе
// модели (T-поза, A-поза, что угодно) хранится отдельно и восстанавливается
// через identity-поворот. Значит capture сразу после загрузки ВСЕГДА видел
// z≈0 для любой модели — isLikelyTPose(rawBones) была true всегда, для
// каждой модели без исключения, и wasTPose в debugPose() ничего не говорил.
//
// Правильный способ: смотреть на РЕАЛЬНОЕ мировое направление кости
// плечо->локоть у raw-скелета (не normalized) — T-поза даёт почти
// горизонтальный вектор (Y-компонента направления близка к 0), опущенная
// или согнутая рука — куда более вертикальный/диагональный вектор.
function isLikelyTPose(vrm) {
  const armDirY = (upperName, lowerName) => {
    const upper = vrm.humanoid.getRawBoneNode(upperName);
    const lower = vrm.humanoid.getRawBoneNode(lowerName);
    if (!upper || !lower) return null;
    upper.updateWorldMatrix(true, false);
    lower.updateWorldMatrix(true, false);
    const a = upper.getWorldPosition(new THREE.Vector3());
    const b = lower.getWorldPosition(new THREE.Vector3());
    const dir = b.sub(a).normalize();
    return Math.abs(dir.y);
  };
  const l = armDirY('leftUpperArm', 'leftLowerArm');
  const r = armDirY('rightUpperArm', 'rightLowerArm');
  if (l == null || r == null) return false;
  // Обе руки заметно ближе к горизонтали (|y| маленький), чем к вертикали.
  return l < 0.5 && r < 0.5;
}

// Пересчитывает baseline.bones из НЕИЗМЕНЯЕМОГО baseline.rawBones + текущих
// значений tuning — вызывается и при загрузке модели, и при каждом движении
// ползунка (поэтому можно крутить вживую, не перезагружая модель).
function recomputePoseCorrection(baseline) {
  const bones = {};
  for (const name of Object.keys(baseline.rawBones)) {
    bones[name] = { ...baseline.rawBones[name] };
  }
  if (baseline.wasTPose) {
    if (bones.leftUpperArm) bones.leftUpperArm.z += tuning.armRelaxZ;
    if (bones.rightUpperArm) bones.rightUpperArm.z -= tuning.armRelaxZ;
    if (bones.leftLowerArm) bones.leftLowerArm.z += tuning.forearmRelaxZ;
    if (bones.rightLowerArm) bones.rightLowerArm.z -= tuning.forearmRelaxZ;
  }
  baseline.bones = bones;
}

function captureDanceBaseline(vrm) {
  const baseline = { rawBones: {} };
  for (const name of DANCE_BONE_NAMES) {
    const node = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) continue;
    baseline.rawBones[name] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
    if (name === 'hips') {
      baseline.hipsY = node.position.y;
      baseline.hipsX = node.position.x;
      baseline.hipsZ = node.position.z;
    }
  }
  baseline.wasTPose = isLikelyTPose(vrm);
  recomputePoseCorrection(baseline);
  danceBaseline = baseline;
  poseCurrent = {};
  poseTarget = {};
  poseIndex = 0;
  groovePhase = 0;
  hipImpulse = 0;
  totalBeatCount = 0;
  turnTarget = 0;
  turnCurrent = 0;
}

function resetDancePose() {
  if (!currentVRM || !currentVRM.humanoid || !danceBaseline) return;
  for (const name of DANCE_BONE_NAMES) {
    const node = currentVRM.humanoid.getNormalizedBoneNode(name);
    const base = danceBaseline.bones[name];
    if (!node || !base) continue;
    node.rotation.set(base.x, base.y, base.z);
  }
  const hips = currentVRM.humanoid.getNormalizedBoneNode('hips');
  if (hips && danceBaseline.hipsY !== undefined) {
    hips.position.y = danceBaseline.hipsY;
    hips.position.x = danceBaseline.hipsX;
    hips.position.z = danceBaseline.hipsZ;
  }
  turnTarget = 0;
  turnCurrent = 0;
}

// --- Вторая модель: своё состояние idle/танца, зеркальное первой -----------

let secondBaseline = null;
let secondPoseCurrent = {};
let secondPoseTarget = {};
let secondPoseIndex = 0;
let secondGroovePhase = Math.PI; // сдвиг фазы — не двигаются идеально синхронно
let secondHipImpulse = 0;
let secondTurnTarget = 0;
let secondTurnCurrent = 0;
let secondIdlePhase = 4.0;

function captureSecondBaseline(vrm) {
  const baseline = { rawBones: {} };
  for (const name of DANCE_BONE_NAMES) {
    const node = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) continue;
    baseline.rawBones[name] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
    if (name === 'hips') {
      baseline.hipsY = node.position.y;
      baseline.hipsX = node.position.x;
      baseline.hipsZ = node.position.z;
    }
  }
  baseline.wasTPose = isLikelyTPose(vrm);
  recomputePoseCorrection(baseline);
  secondBaseline = baseline;
  secondPoseCurrent = {};
  secondPoseTarget = {};
  secondPoseIndex = 0;
  secondGroovePhase = Math.PI;
  secondHipImpulse = 0;
  secondTurnTarget = 0;
  secondTurnCurrent = 0;
}

function resetSecondDancePose() {
  if (!secondVRM || !secondVRM.humanoid || !secondBaseline) return;
  for (const name of DANCE_BONE_NAMES) {
    const node = secondVRM.humanoid.getNormalizedBoneNode(name);
    const base = secondBaseline.bones[name];
    if (!node || !base) continue;
    node.rotation.set(base.x, base.y, base.z);
  }
  const hips = secondVRM.humanoid.getNormalizedBoneNode('hips');
  if (hips && secondBaseline.hipsY !== undefined) {
    hips.position.y = secondBaseline.hipsY;
    hips.position.x = secondBaseline.hipsX;
    hips.position.z = secondBaseline.hipsZ;
  }
  secondTurnTarget = 0;
  secondTurnCurrent = 0;
}

// Зеркалим позу: меняем местами лево/право, чтобы дуэт не выглядел как два
// идентичных клона. Честно: это простой обмен значений между парными
// костями без пересчёта осей — не физически точное зеркало, но визуально
// вполне читается как "второй танцует по-другому".
function mirrorPoseTarget(pose) {
  return {
    leftUpperArm: pose.rightUpperArm, rightUpperArm: pose.leftUpperArm,
    leftLowerArm: pose.rightLowerArm, rightLowerArm: pose.leftLowerArm,
    spine: pose.spine ? { y: -(pose.spine.y || 0) } : undefined,
    head: pose.head ? { y: -(pose.head.y || 0), z: pose.head.z } : undefined,
  };
}

// --- Idle: дыхание + лёгкий перенос веса + микро-движения головы -----------
// Работает, когда танец ВЫКЛЮЧЕН — раньше персонаж в этом состоянии просто
// застывал (только моргание). Сумма нескольких синусоид с несоизмеримыми
// частотами вместо одной — чтобы не было заметного одинакового "тика-так".

let idlePhase = 0;

function setIdleBone(name, dx = 0, dy = 0, dz = 0) {
  if (!currentVRM || !currentVRM.humanoid || !danceBaseline) return;
  const node = currentVRM.humanoid.getNormalizedBoneNode(name);
  const base = danceBaseline.bones[name];
  if (!node || !base) return;
  node.rotation.set(base.x + dx, base.y + dy, base.z + dz);
}

function updateIdle(delta) {
  if (!currentVRM || !currentVRM.humanoid) return;
  if (!danceBaseline) return; // captureDanceBaseline ещё не вызван (модель не загружена)
  if (danceActive) return; // танец сам полностью ведёт тело
  if (audioContext && audioContext.state === 'suspended') return; // на паузе тоже красиво замираем, не дёргаемся

  idlePhase += delta;

  const breathe = Math.sin(idlePhase * 0.7) * 0.025 * tuning.amplitudeScale;
  const sway = (Math.sin(idlePhase * 0.31) * 0.02 + Math.sin(idlePhase * 0.17 + 1.3) * 0.012) * tuning.amplitudeScale;
  const headLook = Math.sin(idlePhase * 0.23 + 0.5) * 0.05;
  const headTilt = Math.sin(idlePhase * 0.13 + 2.1) * 0.02;

  setIdleBone('chest', breathe, 0, 0);
  setIdleBone('spine', breathe * 0.4, sway * 0.3, 0);
  setIdleBone('head', 0, headLook, headTilt);
  setIdleBone('leftUpperArm', 0, 0, sway * 0.4);
  setIdleBone('rightUpperArm', 0, 0, -sway * 0.4);

  const hips = currentVRM.humanoid.getNormalizedBoneNode('hips');
  if (hips && danceBaseline.hipsX !== undefined) {
    hips.position.x = danceBaseline.hipsX + sway * 0.5;
  }
}

function updateSecondIdle(delta) {
  if (!secondVRM || !secondVRM.humanoid || !secondBaseline) return;
  if (danceActive) return;
  if (audioContext && audioContext.state === 'suspended') return;

  secondIdlePhase += delta;
  const breathe = Math.sin(secondIdlePhase * 0.65) * 0.025 * tuning.amplitudeScale;
  const sway = (Math.sin(secondIdlePhase * 0.28 + 0.7) * 0.02 + Math.sin(secondIdlePhase * 0.19) * 0.012) * tuning.amplitudeScale;
  const headLook = Math.sin(secondIdlePhase * 0.21 + 1.1) * 0.05;
  const headTilt = Math.sin(secondIdlePhase * 0.15) * 0.02;

  const setBone = (name, dx = 0, dy = 0, dz = 0) => {
    const node = secondVRM.humanoid.getNormalizedBoneNode(name);
    const base = secondBaseline.bones[name];
    if (!node || !base) return;
    node.rotation.set(base.x + dx, base.y + dy, base.z + dz);
  };

  setBone('chest', breathe, 0, 0);
  setBone('spine', breathe * 0.4, sway * 0.3, 0);
  setBone('head', 0, headLook, headTilt);
  setBone('leftUpperArm', 0, 0, sway * 0.4);
  setBone('rightUpperArm', 0, 0, -sway * 0.4);

  const hips = secondVRM.humanoid.getNormalizedBoneNode('hips');
  if (hips && secondBaseline.hipsX !== undefined) {
    hips.position.x = secondBaseline.hipsX + sway * 0.5;
  }
}

const danceButton = document.getElementById('btn-toggle-dance');
danceButton.addEventListener('click', () => {
  danceActive = !danceActive;
  danceButton.textContent = danceActive ? 'Танцевать: вкл' : 'Танцевать: выкл';
  if (!danceActive) {
    if (currentMocapAction) {
      currentMocapAction.stop();
      currentMocapAction = null;
      currentMocapClipName = null;
      currentMocapCategory = null;
    }
    resetDancePose();
    resetSecondDancePose();
  }
});

function getSectionEnergy(t) {
  if (!songDanceData) return 'mid';
  const sections = songDanceData.sections;
  for (const s of sections) {
    if (t >= s.start && t < s.end) return s.energy;
  }
  return sections.length ? sections[sections.length - 1].energy : 'mid';
}

const ENERGY_INTENSITY = { low: 0.55, mid: 1.0, high: 1.5 };

function detectBeat(deltaMs) {
  // Есть точная партитура — просто идём по расписанию времён битов трека,
  // а не гадаем по громкости на лету.
  if (songDanceData) {
    const t = currentSongTime();
    const beats = songDanceData.beats;
    let triggered = false;
    while (songBeatCursor < beats.length && beats[songBeatCursor] <= t) {
      songBeatCursor += 1;
      triggered = true;
    }
    if (!beatIntervalEstimate || songDanceData.bpm) {
      // /currentPlaybackRate — иначе при ускорении трека грув (непрерывная
      // синусоида) продолжал бы идти в исходном темпе, а смены поз по битам
      // (которые идут от currentSongTime(), уже учитывающей скорость) —
      // быстрее. Разойдутся.
      beatIntervalEstimate = 60000 / songDanceData.bpm / currentPlaybackRate;
    }
    return triggered;
  }

  const now = performance.now();

  if (analyser && lipSyncActive) {
    if (!freqData) freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    let bassSum = 0;
    const bassBinsEnd = Math.min(8, freqData.length);
    for (let i = 1; i < bassBinsEnd; i++) bassSum += freqData[i];
    const bassEnergy = bassSum / (bassBinsEnd - 1);

    bassHistory.push(bassEnergy);
    if (bassHistory.length > BASS_HISTORY_LEN) bassHistory.shift();

    const avg = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;
    const sinceLastBeat = now - lastBeatAt;

    if (bassEnergy > avg * 1.15 && bassEnergy > 25 && sinceLastBeat > 260) {
      if (lastBeatAt > 0) {
        beatIntervalEstimate = beatIntervalEstimate * 0.7 + sinceLastBeat * 0.3;
      }
      lastBeatAt = now;
      return true;
    }
    return false;
  }

  // Без звука (или без активного источника) — ровный смоделированный темп.
  simulatedBeatClock += deltaMs;
  if (simulatedBeatClock >= beatIntervalEstimate) {
    simulatedBeatClock = 0;
    return true;
  }
  return false;
}

function updateDance(delta) {
  if (!currentVRM || !currentVRM.humanoid) return;
  if (!danceBaseline) captureDanceBaseline(currentVRM);
  if (secondVRM && secondVRM.humanoid && !secondBaseline) captureSecondBaseline(secondVRM);
  if (!danceActive) return;
  if (audioContext && audioContext.state === 'suspended') return; // пауза — замерли

  const isBeat = detectBeat(delta * 1000);
  const intensity = songDanceData ? ENERGY_INTENSITY[getSectionEnergy(currentSongTime())] : 1.0;

  if (isBeat) {
    totalBeatCount += 1;
    hipImpulse = 1.0;
    poseIndex = pickNextPoseIndexWithPhrasing(poseIndex, totalBeatCount);
    poseTarget = DANCE_POSES[poseIndex];

    // Раз в 8 битов — доворот корпуса влево/вправо, как будто айдол
    // разворачивается к другой части сцены/зала между фразами припева.
    if (totalBeatCount % 8 === 0) {
      turnTarget += (Math.random() > 0.5 ? 1 : -1) * 0.55;
    }

    if (secondVRM && secondBaseline) {
      secondHipImpulse = 1.0;
      secondPoseIndex = pickNextPoseIndex(secondPoseIndex);
      secondPoseTarget = mirrorPoseTarget(DANCE_POSES[secondPoseIndex]);
      if (totalBeatCount % 8 === 0) {
        secondTurnTarget += (Math.random() > 0.5 ? 1 : -1) * 0.55;
      }
    }
  }

  if (danceMode === 'mocap' && Object.keys(danceClips).length > 0) {
    // Реальные клипы движения (three.js AnimationMixer) сами двигают все
    // кости первой модели — ручную процедурную анимацию тут не трогаем.
    // Вторая модель (дуэт) mocap-клипы пока не поддерживает — танцует
    // процедурно в любом случае (см. ниже).
    updateDanceMocap(delta, intensity, isBeat);
  } else {
    hipImpulse *= Math.exp(-6 * delta);

    const grooveFreq = (2 * Math.PI * 1000) / Math.max(beatIntervalEstimate, 200);
    groovePhase += grooveFreq * delta;
    const effectiveIntensity = intensity * tuning.amplitudeScale;

    // Поворот — медленный, демпфированный (не за один кадр), выглядит как
    // осознанный разворот, а не рывок.
    turnCurrent += (turnTarget - turnCurrent) * (1 - Math.exp(-3 * delta));

    // Демпфированное сближение с целевой позой (масштабированной интенсивностью
    // секции трека) — убирает резкие скачки/дрожание и делает припев заметнее
    // куплета, а не одинаковой амплитудой весь трек.
    const smoothing = 1 - Math.exp(-8 * delta);
    for (const boneName of DANCE_BONE_NAMES) {
      const target = poseTarget[boneName] || {};
      const cur = poseCurrent[boneName] || { x: 0, y: 0, z: 0 };
      cur.x += ((target.x || 0) * effectiveIntensity - cur.x) * smoothing;
      cur.y += ((target.y || 0) * effectiveIntensity - cur.y) * smoothing;
      cur.z += ((target.z || 0) * effectiveIntensity - cur.z) * smoothing;
      poseCurrent[boneName] = cur;

      const node = currentVRM.humanoid.getNormalizedBoneNode(boneName);
      const base = danceBaseline.bones[boneName];
      if (!node || !base) continue;

      let grooveX = 0, grooveZ = 0;
      if (boneName === 'spine') grooveZ = Math.sin(groovePhase) * 0.05 * effectiveIntensity;
      if (boneName === 'chest') grooveZ = -Math.sin(groovePhase) * 0.03 * effectiveIntensity;
      if (boneName === 'head') grooveX = Math.sin(groovePhase * 2) * 0.02;

      if (boneName === 'rightUpperLeg') grooveX = Math.sin(groovePhase) * 0.16 * effectiveIntensity;
      if (boneName === 'leftUpperLeg') grooveX = -Math.sin(groovePhase) * 0.16 * effectiveIntensity;
      if (boneName === 'rightLowerLeg') grooveX = -Math.max(0, Math.sin(groovePhase)) * 0.3 * effectiveIntensity;
      if (boneName === 'leftLowerLeg') grooveX = -Math.max(0, -Math.sin(groovePhase)) * 0.3 * effectiveIntensity;
      if (boneName === 'rightFoot') grooveX = -Math.sin(groovePhase) * 0.07 * effectiveIntensity;
      if (boneName === 'leftFoot') grooveX = Math.sin(groovePhase) * 0.07 * effectiveIntensity;

      // Встречный мах руками (противофаза одноимённой ноге) — то, чего не
      // хватало и получалось "переваливание пингвина": ноги качаются, руки
      // висят неподвижно. Накладывается ПОВЕРХ позы из DANCE_POSES, а не
      // вместо неё, так что позы рук всё ещё меняются на биты.
      if (boneName === 'rightUpperArm') grooveX += -Math.sin(groovePhase) * 0.12 * effectiveIntensity * tuning.armSwingScale;
      if (boneName === 'leftUpperArm') grooveX += Math.sin(groovePhase) * 0.12 * effectiveIntensity * tuning.armSwingScale;

      let boneY = base.y + cur.y;
      if (boneName === 'hips' || boneName === 'chest') boneY += turnCurrent; // разворот корпуса

      node.rotation.set(base.x + cur.x + grooveX, boneY, base.z + cur.z + grooveZ);
    }

    const hips = currentVRM.humanoid.getNormalizedBoneNode('hips');
    if (hips && danceBaseline.hipsY !== undefined) {
      const bounce = Math.abs(Math.sin(groovePhase)) * 0.015 * effectiveIntensity;
      const dip = hipImpulse * 0.03 * effectiveIntensity;
      hips.position.y = danceBaseline.hipsY - dip + bounce;
      hips.position.x = danceBaseline.hipsX + Math.sin(groovePhase) * 0.025 * effectiveIntensity;
      hips.rotation.z = danceBaseline.bones.hips.z + Math.sin(groovePhase) * 0.04 * effectiveIntensity;
    }
  }

  if (secondVRM && secondBaseline) {
    updateSecondDanceProcedural(delta, intensity);
  }
}

// Полный аналог процедурного блока выше, но для второй модели: свои
// накопленные фазы/позы (secondGroovePhase и т.п.), бит и интенсивность —
// общие с первой моделью (один источник звука на двоих).
function updateSecondDanceProcedural(delta, intensity) {
  if (!secondVRM || !secondVRM.humanoid || !secondBaseline) return;

  secondHipImpulse *= Math.exp(-6 * delta);

  const grooveFreq = (2 * Math.PI * 1000) / Math.max(beatIntervalEstimate, 200);
  secondGroovePhase += grooveFreq * delta;
  const effectiveIntensity = intensity * tuning.amplitudeScale;
  secondTurnCurrent += (secondTurnTarget - secondTurnCurrent) * (1 - Math.exp(-3 * delta));

  const smoothing = 1 - Math.exp(-8 * delta);
  for (const boneName of DANCE_BONE_NAMES) {
    const target = secondPoseTarget[boneName] || {};
    const cur = secondPoseCurrent[boneName] || { x: 0, y: 0, z: 0 };
    cur.x += ((target.x || 0) * effectiveIntensity - cur.x) * smoothing;
    cur.y += ((target.y || 0) * effectiveIntensity - cur.y) * smoothing;
    cur.z += ((target.z || 0) * effectiveIntensity - cur.z) * smoothing;
    secondPoseCurrent[boneName] = cur;

    const node = secondVRM.humanoid.getNormalizedBoneNode(boneName);
    const base = secondBaseline.bones[boneName];
    if (!node || !base) continue;

    let grooveX = 0, grooveZ = 0;
    if (boneName === 'spine') grooveZ = Math.sin(secondGroovePhase) * 0.05 * effectiveIntensity;
    if (boneName === 'chest') grooveZ = -Math.sin(secondGroovePhase) * 0.03 * effectiveIntensity;
    if (boneName === 'head') grooveX = Math.sin(secondGroovePhase * 2) * 0.02;

    if (boneName === 'rightUpperLeg') grooveX = Math.sin(secondGroovePhase) * 0.16 * effectiveIntensity;
    if (boneName === 'leftUpperLeg') grooveX = -Math.sin(secondGroovePhase) * 0.16 * effectiveIntensity;
    if (boneName === 'rightLowerLeg') grooveX = -Math.max(0, Math.sin(secondGroovePhase)) * 0.3 * effectiveIntensity;
    if (boneName === 'leftLowerLeg') grooveX = -Math.max(0, -Math.sin(secondGroovePhase)) * 0.3 * effectiveIntensity;
    if (boneName === 'rightFoot') grooveX = -Math.sin(secondGroovePhase) * 0.07 * effectiveIntensity;
    if (boneName === 'leftFoot') grooveX = Math.sin(secondGroovePhase) * 0.07 * effectiveIntensity;

    if (boneName === 'rightUpperArm') grooveX += -Math.sin(secondGroovePhase) * 0.12 * effectiveIntensity * tuning.armSwingScale;
    if (boneName === 'leftUpperArm') grooveX += Math.sin(secondGroovePhase) * 0.12 * effectiveIntensity * tuning.armSwingScale;

    let boneY = base.y + cur.y;
    if (boneName === 'hips' || boneName === 'chest') boneY += secondTurnCurrent;

    node.rotation.set(base.x + cur.x + grooveX, boneY, base.z + cur.z + grooveZ);
  }

  const hips = secondVRM.humanoid.getNormalizedBoneNode('hips');
  if (hips && secondBaseline.hipsY !== undefined) {
    const bounce = Math.abs(Math.sin(secondGroovePhase)) * 0.015 * effectiveIntensity;
    const dip = secondHipImpulse * 0.03 * effectiveIntensity;
    hips.position.y = secondBaseline.hipsY - dip + bounce;
    hips.position.x = secondBaseline.hipsX + Math.sin(secondGroovePhase) * 0.025 * effectiveIntensity;
    hips.rotation.z = secondBaseline.bones.hips.z + Math.sin(secondGroovePhase) * 0.04 * effectiveIntensity;
  }
}

// --- Моргание (автономный цикл, не завязан на эмоции) ------------------------

let blinkTimer = 0;
let nextBlinkAt = 2 + Math.random() * 3;
let blinkPhase = 0; // 0 = открыты, растёт к 1 (закрыты) и обратно

function updateBlink(delta) {
  if (!currentVRM || !currentVRM.expressionManager) return;

  blinkTimer += delta;

  const BLINK_DURATION = 0.18;
  if (blinkPhase > 0) {
    blinkPhase += delta / (BLINK_DURATION / 2);
    if (blinkPhase >= 2) {
      blinkPhase = 0;
      currentVRM.expressionManager.setValue('blink', 0);
    } else {
      const value = blinkPhase <= 1 ? blinkPhase : 2 - blinkPhase;
      currentVRM.expressionManager.setValue('blink', value);
    }
  } else if (blinkTimer >= nextBlinkAt) {
    blinkTimer = 0;
    nextBlinkAt = 2 + Math.random() * 3;
    blinkPhase = 0.001;
  }
}

// --- Цикл рендера -------------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updateBlink(delta);
  updateLipSync();
  updateIdle(delta);
  updateSecondIdle(delta);
  updateDance(delta);
  updateWebcamCameraControl(delta);

  if (currentVRM) {
    currentVRM.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}

document.getElementById('btn-open-logs').addEventListener('click', () => {
  window.electronAPI.openLogsFolder();
});

animate();

// --- Диагностика для отладки без скриншотов ----------------------------------
// window.debugPose() в консоли (Ctrl+Shift+I) печатает текущие повороты
// ключевых костей — числа переносятся в чат текстом, это гораздо быстрее и
// точнее, чем присылать фото экрана для проблем с позой/танцем.
window.debugPose = function () {
  const report = {};
  const dump = (vrm, baseline, label) => {
    if (!vrm || !vrm.humanoid) {
      console.log(`[${label}] модель не загружена`);
      report[label] = 'модель не загружена';
      return;
    }
    const names = ['hips', 'spine', 'chest', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'];
    const rows = {};
    for (const name of names) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      rows[name] = {
        current: { x: +node.rotation.x.toFixed(3), y: +node.rotation.y.toFixed(3), z: +node.rotation.z.toFixed(3) },
        rawBaseline: baseline && baseline.rawBones[name] ? {
          x: +baseline.rawBones[name].x.toFixed(3),
          y: +baseline.rawBones[name].y.toFixed(3),
          z: +baseline.rawBones[name].z.toFixed(3),
        } : null,
      };
    }
    // Реальный диагностический сигнал (в отличие от старого wasTPose,
    // который проверял normalized-повороты — те всегда ~0 сразу после
    // загрузки, для любой модели, см. комментарий у isLikelyTPose):
    // мировое направление кости плечо->локоть у RAW-скелета. |y| близко
    // к 0 = рука горизонтальна (похоже на T-позу), ближе к 1 = рука
    // опущена/согнута.
    const armDir = (upperName, lowerName) => {
      const upper = vrm.humanoid.getRawBoneNode(upperName);
      const lower = vrm.humanoid.getRawBoneNode(lowerName);
      if (!upper || !lower) return null;
      upper.updateWorldMatrix(true, false);
      lower.updateWorldMatrix(true, false);
      const a = upper.getWorldPosition(new THREE.Vector3());
      const b = lower.getWorldPosition(new THREE.Vector3());
      const dir = b.sub(a).normalize();
      return { x: +dir.x.toFixed(3), y: +dir.y.toFixed(3), z: +dir.z.toFixed(3) };
    };
    const rawArmDirection = {
      left: armDir('leftUpperArm', 'leftLowerArm'),
      right: armDir('rightUpperArm', 'rightLowerArm'),
    };

    console.log(`[${label}] wasTPose=${baseline ? baseline.wasTPose : 'н/д'}`, 'rawArmDirection=', rawArmDirection);
    console.table(rows);
    report[label] = { wasTPose: baseline ? baseline.wasTPose : null, rawArmDirection, bones: rows };
  };

  dump(currentVRM, danceBaseline, 'модель 1');
  dump(secondVRM, secondBaseline, 'модель 2');
  console.log('tuning:', JSON.stringify(tuning));
  console.log('danceActive:', danceActive, 'danceMode:', danceMode);

  // console.table не всегда чисто попадает в текстовый лог-файл — дублируем
  // явным JSON, чтобы debugPose() гарантированно был виден в файле целиком.
  report.tuning = tuning;
  report.danceActive = danceActive;
  report.danceMode = danceMode;
  window.electronAPI && window.electronAPI.logToFile('info', `debugPose(): ${JSON.stringify(report)}`);
};
console.log('Диагностика доступна: наберите debugPose() в консоли (пишется и в лог-файл).');
