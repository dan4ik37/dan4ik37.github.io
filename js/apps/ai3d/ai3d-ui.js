// ═══════════════════════════════════════
//  AI3D shell on the site: /tools/3d (hidden: noindex, not in search, menus, footer or sitemap). AI3D author: the site owner
//  (dan4ik37); ported into the site 2026-10-29 (T-112, A1 of «AI3D = our Blender», E:\d37-core\spec\PLAN.md).
// ═══════════════════════════════════════
// js/apps/apps.js loads three r149 (the same build as the games and D37E), ai3d-gltf.js, ai3d-core.js and this file when the route
// "ai3d" opens, and calls D37AI3DUI.mount(host, { param }); leaving the route → unmount() (renderers, GPU memory, listeners, the MCP socket).
// The editor is the owner's (ai3d-core.js): command JSON → «Выполнить», his buttons, his self-test. Added here: examples (the six demo
// scenes of the tests), «📦 В Студию 3D» (GLB → D37E.models, the list «🧩 Модели» in Studio 3D), «🔌 ИИ» (his MCP bridge server.mjs on
// this computer: ws://localhost:3737, or /tools/3d?ws=ws://localhost:PORT), a fallback when WebGL does not start, and a notice on
// WebGL context loss. All text from commands, AI and files reaches the page only through textContent.
// window.D37AI3D = { active } — js/ui/hotkeys.js leaves the keyboard to the editor while it is open.
(function(){
  'use strict';
  const root = window;
  // The six demo scenes (the same commands the node test exports to GLB and Blender imports)
  const DEMOS = [
    { id: 'table', t: '🪑 Стол с вазой', cmds: [
      { op: 'add', name: 'столешница', type: 'box', size: [3, .15, 1.6], pos: [0, 1.5, 0], color: '#a8754a' },
      { op: 'add', name: 'нога1', type: 'box', size: [.15, 1.5, .15], pos: [-1.35, .75, -.65], color: '#6d4a2e' },
      { op: 'add', name: 'нога2', type: 'box', size: [.15, 1.5, .15], pos: [1.35, .75, -.65], color: '#6d4a2e' },
      { op: 'add', name: 'нога3', type: 'box', size: [.15, 1.5, .15], pos: [-1.35, .75, .65], color: '#6d4a2e' },
      { op: 'add', name: 'нога4', type: 'box', size: [.15, 1.5, .15], pos: [1.35, .75, .65], color: '#6d4a2e' },
      { op: 'add', name: 'ваза', type: 'cylinder', size: [.18, .5], pos: [.6, 1.825, 0], color: '#3d8fd1' }] },
    { id: 'dog', t: '🐕 Собака с шерстью', cmds: [
      { op: 'make', type: 'dog', name: 'rex', fur: { pattern: 'belly', color: '#9a6b3f', color2: '#e8d6b8', length: .03, density: 2500 } },
      { op: 'gait', prefix: 'rex_', clip: 'walk', anim: 'walk' }] },
    { id: 'human', t: '🧍 Человек с волосами', cmds: [
      { op: 'make', type: 'human', name: 'u', build: 'avg' }, { op: 'hair', name: 'u_hair', on: 'u_head', style: 'long' },
      { op: 'gait', prefix: 'u_', clip: 'walk', anim: 'walk' }] },
    { id: 'fox', t: '🦊 Лис-антропоморф', cmds: [
      { op: 'make', type: 'anthro', species: 'fox', name: 'fox', fur: true }, { op: 'gait', prefix: 'fox_', clip: 'run', anim: 'run' }] },
    { id: 'dragon', t: '🐉 Дракон', cmds: [{ op: 'make', type: 'dragon', name: 'd' }, { op: 'gait', prefix: 'd_', clip: 'walk', anim: 'walk' }] },
    { id: 'land', t: '🏝 Остров и 10 сосен', cmds: [   // a pine is ~6000 triangles (branches; leafDensity barely matters): 10 fit the scatter budget (60000) and Studio 3D's 100k limit
      { op: 'terrain', name: 'land', size: [60, 60], res: 96, amp: 6, seed: 3, island: true, erode: 6, sea: .4 },
      { op: 'tree', name: 'pine1', species: 'pine', height: 4, pos: [100, 0, 100], leafDensity: .4 },
      { op: 'scatter', src: 'pine1', on: 'land', count: 10, minH: 1, maxSlope: .5, minDist: 2.5, hideSrc: true }] },
  ];
  const BUTTONS = [['run', 'Выполнить', 'p'], ['undo', 'Отменить'], ['redo', 'Вернуть'], ['snap', 'Виды 2×2'], ['sum', 'Сводка'], ['json', 'JSON сцены'],
    ['obj', 'Экспорт OBJ'], ['glb', 'Скачать GLB'], ['studio', '📦 В Студию 3D'], ['play', 'Играть'], ['test', 'Самотест'], ['ins', 'Инструкция для ИИ']];
  const PERF = [['lod', 'Авто-LOD (упрощение далёких сеток)'], ['cull', 'Скрывать слишком мелкое и далёкое'], ['adaptive', 'Адаптивное разрешение'], ['onDemand', 'Рисовать только при изменениях']];

  function el(tag, attrs, text){
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'cls') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (text != null) e.textContent = text;
    return e;
  }
  // Markup: the owner's page (stage + panel), ids with the a3- prefix (the core's $('#x') looks for #a3-x inside the host)
  function markup(){
    const a3 = el('div', { cls: 'a3', role: 'application', 'aria-label': '3D-мастерская AI3D' });
    const bar = el('div', { cls: 'a3-bar' });
    const ttl = el('div', { cls: 'a3-title' }); ttl.append(el('b', null, '🧊 AI3D'), el('span', null, '3D-мастерская: команды от ИИ или свои'));
    const demo = el('select', { id: 'a3-demo', 'aria-label': 'Пример сцены' });
    demo.append(el('option', { value: '' }, '🎲 Пример…'));
    for (const d of DEMOS) demo.append(el('option', { value: d.id }, d.t));
    bar.append(ttl, demo, el('button', { type: 'button', id: 'a3-ai', title: 'Подключить ИИ: мост MCP (server.mjs) на этом компьютере' }, '🔌 ИИ'));
    const stage = el('div', { id: 'a3-stage' });
    stage.append(el('canvas', { id: 'a3-c' }), el('div', { id: 'a3-hint' }, 'Тяни — вращать, щипок — приблизить'));
    const lost = el('div', { cls: 'a3-lost', role: 'status' }, '3D перезапускается…'); lost.hidden = true; stage.append(lost);
    const panel = el('div', { id: 'a3-panel' });
    panel.append(el('textarea', { id: 'a3-cmd', spellcheck: 'false', 'aria-label': 'Команды в JSON' }));
    const row = el('div', { cls: 'a3-row' });
    for (const [id, t, c] of BUTTONS) row.append(el('button', { type: 'button', id: 'a3-' + id, cls: c || '' }, t));
    panel.append(row, el('pre', { id: 'a3-out' }, 'Вставь команды от ИИ и нажми «Выполнить».'));
    const perf = el('details', { id: 'a3-perf' }); perf.append(el('summary', null, 'Производительность'));
    for (const [k, t] of PERF) { const l = el('label'); l.append(el('input', { type: 'checkbox', id: 'a3-set-' + k }), document.createTextNode(' ' + t)); perf.append(l); }
    perf.append(el('pre', { id: 'a3-st' }));
    panel.append(perf, el('img', { id: 'a3-shot', alt: 'Четыре вида сцены: спереди, сбоку, сверху, три четверти' }));
    a3.append(bar, stage, panel);
    return a3;
  }
  function failView(host, msg, retry){
    host.textContent = '';
    const f = el('div', { cls: 'a3-fail', role: 'alert' });
    f.append(el('b', null, '⚠️ 3D-мастерская не запустилась'), el('span', null, msg),
      el('small', null, 'Нужен WebGL (3D в браузере). Открой в Chrome или Яндекс Браузере, выключи режим экономии энергии и обнови страницу.'));
    const b = el('button', { type: 'button', cls: 'p' }, 'Повторить'); b.onclick = retry; f.append(b);
    host.append(f);
  }
  // Model name for Studio 3D: the common prefix of the object names ("rex_body", "rex_head" → "rex")
  function sceneName(state){
    const names = (state || []).map(o => String(o.name || '')).filter(Boolean);
    if (!names.length) return 'AI3D';
    const pre = names[0].split('_')[0];
    return (names.every(n => n.split('_')[0] === pre) ? pre : names[0]).slice(0, 40) || 'AI3D';
  }

  function mount(host, o = {}){
    const api = { active: true, core: null, unmount };
    let core = null, busy = false, dead = false, a3 = null;
    const onResize = () => place();
    function place(){
      if (!a3) return;
      const nav = document.getElementById('nav');
      a3.style.setProperty('--a3-top', (nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0) + 'px');
    }
    function start(){
      if (dead) return;
      host.textContent = '';
      a3 = markup(); host.append(a3); place();
      const $ = s => a3.querySelector(s), aiBtn = $('#a3-ai');
      let ws = null;
      try { ws = new URLSearchParams(root.location.search).get('ws'); } catch (e) {}
      const env = {
        ws: ws || null,
        exportGLB: (group, clips) => root.D37AI3DGltf.exportGLB(group, clips),
        onAI: on => { aiBtn.textContent = on ? '🟢 ИИ' : '🔌 ИИ'; aiBtn.classList.toggle('on', !!on); },
      };
      const T = root.THREE;
      try {
        if (!T || !T.WebGLRenderer) throw new Error('не загрузилась библиотека 3D (three.js)');
        core = root.D37AI3DCore.create(a3, env);
      } catch (e) {
        core = null; a3 = null;
        failView(host, String(e && e.message || e), () => start());
        return;
      }
      api.core = core;
      // WebGL context loss (driver reset, too many tabs): three restores it itself; we show a notice and redraw after
      const cv = $('#a3-c'), lost = $('.a3-lost');
      cv.addEventListener('webglcontextlost', () => { if (!dead) lost.hidden = false; });
      cv.addEventListener('webglcontextrestored', () => { lost.hidden = true; if (core) core.redraw(); });
      // examples
      const demo = $('#a3-demo');
      demo.onchange = () => {
        const d = DEMOS.find(x => x.id === demo.value); demo.value = '';
        if (!d || busy) return;
        core.reset();
        $('#a3-cmd').value = JSON.stringify(d.cmds, null, 1);
        const r = core.run(d.cmds);
        core.say(r.ok ? 'Пример «' + d.t + '» готов.\n' + r.summary : 'Ошибка: ' + r.error, !r.ok);
        core.frame();
      };
      $('#a3-studio').onclick = async () => {
        if (busy) return;
        busy = true; core.say('Отправляю в «Студию 3D»…');
        try {
          const buf = await core.exportGLB();
          const m = await root.D37AI3DGltf.toStudio(buf, sceneName(core.state()));
          if (!dead) core.say('📦 Готово: «Студия 3D» → 🧩 Модели: «' + m.name + '», треугольников ' + m.tris + ', ' + Math.round(buf.byteLength / 1024) + ' КБ GLB.');
        } catch (e) { if (!dead) core.say('Не получилось отправить в «Студию 3D»: ' + (e && e.message || e), 1); }
        finally { busy = false; }
      };
      aiBtn.onclick = () => {
        if (core.aiOn()) { core.say('ИИ уже подключён.'); return; }
        core.connectAI(ws || '1');
        core.say('Подключаюсь к мосту ИИ на этом компьютере (' + (ws || 'ws://localhost:3737') + '). Запусти server.mjs из пакета AI3D (README).');
      };
      root.D37AI3D = api;
    }
    root.addEventListener('resize', onResize);
    document.body.classList.add('a3-on');
    start();
    function unmount(){
      if (dead) return;
      dead = true; api.active = false;
      root.removeEventListener('resize', onResize);
      document.body.classList.remove('a3-on');
      if (core) { try { core.dispose(); } catch (e) { console.warn(e); } }
      core = null; api.core = null; a3 = null;
      host.textContent = '';
      if (root.D37AI3D === api) root.D37AI3D = { active: false };
    }
    return api;
  }

  root.D37AI3DUI = { mount, DEMOS, sceneName };
})();
