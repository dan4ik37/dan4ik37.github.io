const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// --- Единый лог-файл на сессию: main-процесс + renderer + все ошибки -------
// Перезаписывается заново при каждом запуске (logs/latest.log) — если
// воспроизводишь баг, не перезапускай приложение между этим и отправкой
// файла. Пишем и в консоль (для разработки), и в файл (чтобы можно было
// просто прислать файл вместо копирования текста руками).

const LOGS_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });
const LOG_FILE_PATH = path.join(LOGS_DIR, 'latest.log');
const logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'w' });

function writeLogLine(prefix, args) {
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    })
    .join(' ');
  logStream.write(`[${new Date().toISOString()}] [${prefix}] ${text}\n`);
}

const _origConsoleLog = console.log.bind(console);
const _origConsoleError = console.error.bind(console);
const _origConsoleWarn = console.warn.bind(console);
console.log = (...args) => { _origConsoleLog(...args); writeLogLine('main:log', args); };
console.error = (...args) => { _origConsoleError(...args); writeLogLine('main:error', args); };
console.warn = (...args) => { _origConsoleWarn(...args); writeLogLine('main:warn', args); };

writeLogLine('session', [
  `start, app=${app.getName ? app.getName() : 'vtuber-vrm-player'}`,
  `electron=${process.versions.electron}`,
  `node=${process.versions.node}`,
  `platform=${process.platform}`,
  `arch=${process.arch}`,
]);

process.on('uncaughtException', (err) => {
  writeLogLine('main:uncaughtException', [err.stack || err.message || String(err)]);
});
process.on('unhandledRejection', (reason) => {
  writeLogLine('main:unhandledRejection', [reason && reason.stack ? reason.stack : String(reason)]);
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Всё, что попадает в DevTools Console у пользователя (включая браузерные
  // "Failed to load resource: ...", не только наши console.log) — тоже в лог-файл.
  const CONSOLE_LEVELS = ['log', 'warning', 'error', 'info'];
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelName = CONSOLE_LEVELS[level] || `level${level}`;
    writeLogLine(`renderer:${levelName}`, [`${message} (${sourceId}:${line})`]);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeLogLine('renderer:did-fail-load', [`${errorDescription} (${errorCode}) url=${validatedURL}`]);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLogLine('renderer:crashed', [JSON.stringify(details)]);
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Диалог выбора .vrm-файла — путь к модели остаётся обычной настройкой,
// в коде не зашито имя/дизайн какого-либо конкретного персонажа.
ipcMain.on('renderer-log', (_event, payload) => {
  writeLogLine(`renderer:${payload.level || 'log'}`, [payload.message]);
});

ipcMain.handle('open-logs-folder', () => {
  shell.showItemInFolder(LOG_FILE_PATH);
});

ipcMain.handle('dialog:openVRM', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите VRM-модель',
    filters: [{ name: 'VRM models', extensions: ['vrm'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Аудио для пения/танца. Читаем файл сами (не через File API в renderer),
// чтобы получить настоящий путь на диске и рядом с ним найти
// "<файл>.dance.json" — заранее просчитанную партитуру движений
// (см. tools/analyze_song.py), если пользователь её уже сделал.
ipcMain.handle('dialog:openAudio', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите аудиофайл',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const audioPath = result.filePaths[0];
  const audioBytes = fs.readFileSync(audioPath);

  const dancePath = audioPath + '.dance.json';
  let danceData = null;
  if (fs.existsSync(dancePath)) {
    try {
      danceData = JSON.parse(fs.readFileSync(dancePath, 'utf-8'));
    } catch (e) {
      console.error('Не удалось прочитать .dance.json:', e);
    }
  } else {
    // Партитуры ещё нет — считаем её сама программа, в фоне, пока песня
    // уже играет в обычном (менее точном) режиме. Как досчитает — подставим
    // результат на лету (см. audio-analysis-status в renderer.js).
    analyzeSongInBackground(audioPath);
  }

  return {
    fileName: path.basename(audioPath),
    audioPath,
    audioArrayBuffer: audioBytes.buffer.slice(
      audioBytes.byteOffset,
      audioBytes.byteOffset + audioBytes.byteLength
    ),
    danceData,
  };
});

// --- ИИ-режиссёр: эмоция + реплика по описанию сцены -------------------------
// По умолчанию — бесплатный локальный Ollama. Платный Anthropic — только
// опциональный запасной вариант (нужен свой ANTHROPIC_API_KEY, не включён по
// умолчанию). Финальный фолбэк — разбор по ключевым словам, без ИИ вообще,
// гарантированно работает всегда.

const DIRECTOR_VALID_EMOTIONS = ['neutral', 'happy', 'angry', 'sad', 'surprised'];

function buildDirectorPrompt(sceneDescription) {
  return (
    'Ты — режиссёр виртуального аватара (VTuber). По описанию сцены выбери ' +
    'ОДНУ эмоцию из списка: neutral, happy, angry, sad, surprised. Придумай ' +
    'короткую (одно предложение, до 15 слов) реплику персонажа для этой ' +
    'сцены на русском языке. Ответь СТРОГО в формате JSON без пояснений и ' +
    'без markdown: {"emotion": "...", "line": "..."}\n\n' +
    `Сцена: ${sceneDescription}`
  );
}

function normalizeDirectorResult(parsed, source) {
  const emotion = DIRECTOR_VALID_EMOTIONS.includes(parsed.emotion) ? parsed.emotion : 'neutral';
  const line = typeof parsed.line === 'string' ? parsed.line.slice(0, 300) : '';
  return { emotion, line, source };
}

async function queryOllama(sceneDescription) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt: buildDirectorPrompt(sceneDescription),
        stream: false,
        format: 'json',
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.response);
    return normalizeDirectorResult(parsed, 'ollama');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function queryAnthropic(sceneDescription) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY не задан — пропускаю (это опциональный вариант)');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      messages: [{ role: 'user', content: buildDirectorPrompt(sceneDescription) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content.map((b) => b.text || '').join('');
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  return normalizeDirectorResult(parsed, 'anthropic');
}

function keywordFallback(sceneDescription) {
  const text = sceneDescription.toLowerCase();
  const rules = [
    { emotion: 'happy', words: ['рад', 'счастли', 'весел', 'ура', 'побед', 'улыб', 'happy', 'yay'] },
    { emotion: 'angry', words: ['зл', 'бешен', 'ярост', 'ненавиж', 'бесит', 'angry', 'mad'] },
    { emotion: 'sad', words: ['груст', 'печал', 'плак', 'слёз', 'слез', 'sad', 'cry'] },
    { emotion: 'surprised', words: ['удивл', 'шок', 'ого', 'вау', 'неожидан', 'surprised', 'wow'] },
  ];
  for (const rule of rules) {
    if (rule.words.some((w) => text.includes(w))) {
      return { emotion: rule.emotion, line: '', source: 'keyword' };
    }
  }
  return { emotion: 'neutral', line: '', source: 'keyword' };
}

ipcMain.handle('ai-director:query', async (_event, sceneDescription) => {
  try {
    return await queryOllama(sceneDescription);
  } catch (e) {
    console.error('Ollama недоступен, пробую запасной вариант:', e.message);
  }
  try {
    return await queryAnthropic(sceneDescription);
  } catch (e) {
    // тихо — это опциональный вариант, отсутствие ключа не ошибка пользователя
  }
  return keywordFallback(sceneDescription);
});

const activeAnalyses = new Set(); // audioPath, чтобы не запускать анализ дважды
const PYTHON_CANDIDATES = ['python3', 'python', 'py'];

function sendAnalysisStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio-analysis-status', payload);
  }
}

function analyzeSongInBackground(audioPath, candidateIndex = 0) {
  if (activeAnalyses.has(audioPath) && candidateIndex === 0) return;
  activeAnalyses.add(audioPath);

  if (candidateIndex === 0) {
    sendAnalysisStatus({ audioPath, status: 'started' });
    console.log(`[analyze] старт фонового анализа: ${audioPath}`);
  }

  if (candidateIndex >= PYTHON_CANDIDATES.length) {
    activeAnalyses.delete(audioPath);
    console.error(`[analyze] ни один python-интерпретатор не найден для: ${audioPath}`);
    sendAnalysisStatus({
      audioPath,
      status: 'error',
      message:
        'Python не найден в PATH. Установи Python (python.org) или запусти анализ вручную: ' +
        'pip install -r tools/requirements.txt && python tools/analyze_song.py "файл"',
    });
    return;
  }

  const pythonCmd = PYTHON_CANDIDATES[candidateIndex];
  const scriptPath = path.join(__dirname, 'tools', 'analyze_song.py');
  console.log(`[analyze] пробую spawn: ${pythonCmd} "${scriptPath}" "${audioPath}"`);
  const child = spawn(pythonCmd, [scriptPath, audioPath], { windowsHide: true });

  let stderr = '';
  let commandMissing = false;

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('error', (err) => {
    // Эта команда python не найдена — пробуем следующую (python3/python/py).
    commandMissing = true;
    console.error(`[analyze] spawn(${pythonCmd}) упал: ${err.message}`);
    analyzeSongInBackground(audioPath, candidateIndex + 1);
  });

  child.on('close', (code) => {
    if (commandMissing) return; // уже обрабатывается через 'error' + повтор
    activeAnalyses.delete(audioPath);
    console.log(`[analyze] ${pythonCmd} завершился с кодом ${code}, stderr: ${stderr.slice(-500)}`);
    if (code !== 0) {
      const hint = /ModuleNotFoundError|No module named/.test(stderr)
        ? 'Не хватает библиотек: выполни pip install -r tools/requirements.txt'
        : stderr.split('\n').slice(-3).join(' ');
      sendAnalysisStatus({ audioPath, status: 'error', message: hint || 'Анализ завершился с ошибкой' });
      return;
    }
    const dancePath = audioPath + '.dance.json';
    try {
      const danceData = JSON.parse(fs.readFileSync(dancePath, 'utf-8'));
      console.log(`[analyze] партитура прочитана успешно: ${dancePath}`);
      sendAnalysisStatus({ audioPath, status: 'done', danceData });
    } catch (e) {
      console.error(`[analyze] не удалось прочитать ${dancePath}: ${e.message}`);
      sendAnalysisStatus({ audioPath, status: 'error', message: 'Не удалось прочитать результат анализа' });
    }
  });
}
