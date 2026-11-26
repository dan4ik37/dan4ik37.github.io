// ═══════════════════════════════════════
//  «СТУДИЯ 3D» НА НАШЕМ ДВИЖКЕ (EDITOR_ONE §8 S7 «детали», S8 «физика, эффекты, NPC, скрипты»; флаг STUDIO_D37 в
//  js/core/config.js, откат — одна строка STUDIO_D37 = false: студия ровно как без этого файла).
// ═══════════════════════════════════════
// Редактор тот же (кнопки, места, урок); меняется только, ГДЕ мир рисуется и играется. Мир, которому хватает того, что
// уже умеет движок (проверка — сам движок: wasm studio_check, «ворота» EDITOR_ONE §2.2), по «▶ Играть» играется на нашем
// движке (Rust → wasm, канал /d37-preview/, сцена 'studio', game/sys/studio движка). Остальные — на старом, как раньше,
// и ярлык в верхней панели говорит, чего движку пока не хватает. «🪟 Рядом» — тот же мир справа на нашем движке,
// с той же камеры, что редактор (правки видны сразу).
// Скрипты на всех шести языках (JavaScript, Lua, C#, Java, C++, Rust) работают там же, где сегодня (песочница
// js/engine/script.js, ничего в языках не меняется); их команды уходят движку пачкой каждый кадр, движок проверяет каждую
// по правилам сайта и применяет по порядку. Касания, твины, монетки, финиш, смерть — события движка обратно в скрипты.
// Старые миры не переписываются: в файл мира этот модуль ничего не пишет; «играть на старом» — флажок в этом браузере.
(() => {
  const E = window.D37E = window.D37E || {};
  const on = () => typeof STUDIO_D37 !== 'undefined' && !!STUDIO_D37;
  const BASE = '/d37-preview/';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let api = null, H = null, hostP = null, wasmP = null, buildP = null;
  const S = { gate: null, gateSig: '', side: false, play: null, stage: null, ui: null, ready: null, readyRes: null, loadedSig: '', camSig: '', timer: 0, changed: 0, warned: new Set() };

  // ── что из мира движку пока не по силам — по-русски (ключи — из отчёта движка, needs) ──
  const NEED_RU = { 'mat.glass': 'стекло (прозрачное)', 'mat.ice': 'лёд (прозрачный)', 'part.alpha': 'полупрозрачные детали', mesh: 'свои 3D-модели',
    'terrain.relief': 'холмы и ямы на земле', 'terrain.water': 'вода', 'gfx.custom': 'свои настройки графики', weather: 'погода', support: 'прочность', 'view.first': 'вид от 1-го лица',
    'view.shoulder': 'вид из-за плеча', 'view.fixed': 'камеры в мире',
    'part.loose.rigid': 'детали, которые падают и кувыркаются', 'script.click': 'клики по деталям (ClickDetector, Clicked) в скриптах',
    'script.prompt': 'подсказки [E] (ProximityPrompt, Prompt) в скриптах', 'script.game': 'Game.* (режимы игры) в скриптах', 'script.camera': 'Camera.* в скриптах',
    'script.weather': 'Weather.* (погода) в скриптах', 'script.support': 'Support.* (прочность) в скриптах', 'script.fire': 'Fire.* (огонь) в скриптах' };
  const needRu = n => NEED_RU[n] || (n.startsWith('game.') ? 'режим игры «' + n.slice(5) + '»' : n.startsWith('fx.') ? 'эффект «' + n.slice(3) + '»' : n.startsWith('class.') ? 'объект «' + n.slice(6) + '»'
    : n.startsWith('npc.look.') ? 'внешность NPC «' + n.slice(9) + '»' : n.startsWith('npc.') ? 'поведение NPC «' + n.slice(4) + '»' : n.startsWith('script.') ? 'язык скрипта «' + n.slice(7) + '»' : n.startsWith('prefab.') ? 'предмет «' + n.slice(7) + '»'
    : n.startsWith('touch.') ? 'касание «' + n.slice(6) + '»' : n.startsWith('view.') ? 'ракурс «' + n.slice(5) + '»' : n);

  // ── движок: build.json, wasm (проверка мира), engine-host (картинка) ──
  const build = () => (buildP ||= fetch(BASE + 'build.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({})));
  const wasm = () => (wasmP ||= build().then(b => import(BASE + 'd37_web.js' + (b.id ? '?v=' + b.id : ''))).then(async m => { await m.default({ module_or_path: BASE + 'd37_web_bg.wasm' }); return m; }));
  const optKey = () => 'd37_s3_r0_' + (api?.ed?.placeId || '');
  const optedOut = () => { try { return localStorage.getItem(optKey()) === '1'; } catch (e) { return false; } };
  const setOpt = v => { try { if (v) localStorage.setItem(optKey(), '1'); else localStorage.removeItem(optKey()); } catch (e) {} };

  // мир как его сохраняет студия (snapshot без сжатия ландшафта)
  function worldText(){
    const ed = api?.ed; if (!ed?.SC) return '';
    const d = ed.SC.toJSON();
    try { d.terrain = ed.TR?.toJSONSync ? ed.TR.toJSONSync() : null; } catch (e) { d.terrain = null; }
    return JSON.stringify(d);
  }
  // дёшево: счётчик правок (SC add / remove / change) + свет и настройки мира; файл мира собирается, только когда сдвинулось
  const sigNow = () => { const ed = api?.ed; let l = ''; try { l = JSON.stringify(ed?.R?.lighting || {}) + JSON.stringify(ed?.SC?.settings || {}) + (ed?.TR?.dirty ? 'T' : '') + (ed?.TR?.enabled ? 'E' : ''); } catch (e) {} return S.changed + ':' + l.length + ':' + l.slice(0, 400); };
  async function gate(force){
    const sig = sigNow();
    if (!force && S.gate && sig === S.gateSig) return S.gate;
    const text = worldText(); if (!text) return null;
    let r;
    try { const m = await wasm(); r = typeof m.studio_check === 'function' ? JSON.parse(m.studio_check(text)) : { ok: false, fits: false, error: 'на канале движка старая сборка (нет studio_check)' }; }
    catch (e) { r = { ok: false, fits: false, error: 'движок не загрузился: ' + String(e && e.message || e).slice(0, 120) }; }
    S.gate = r; S.gateSig = sig;
    label();
    return r;
  }
  const r1 = () => on() && !!S.gate?.fits && !optedOut();

  // ── верхняя панель: ярлык движка и «🪟 Рядом» ──
  function label(){
    const b = S.ui?.querySelector('.s3d-eng'); if (!b) return;
    const g = S.gate;
    b.innerHTML = !g ? '⏳<span> Движок…</span>' : r1() ? '⚡<span> Наш движок</span>' : '🧱<span> Старый</span>';
    b.classList.toggle('s3d-r1', r1());
    b.title = !g ? 'Проверяем, может ли мир играть на нашем движке' : r1() ? 'Этот мир играется на нашем движке D37. Нажми — подробнее' : g.fits ? 'Можно на нашем движке — выключено флажком. Нажми — подробнее' : 'Этот мир пока играется на старом движке. Нажми — чего не хватает';
  }
  function sheet(){
    const g = S.gate || {}, ed = api?.ed; if (!ed) return;
    ed.box.querySelector('.s3d-sheet')?.remove();
    const d = document.createElement('div'); d.className = 's3d-sheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'На каком движке играет мир');
    const miss = Array.isArray(g.missing) ? g.missing : [];
    d.innerHTML = `<b>${r1() ? '⚡ Мир играется на нашем движке D37' : '🧱 Мир играется на старом движке'}</b>
      <p class="s3d-why"></p><ul class="s3d-miss"></ul>
      <label class="s3d-chk"><input type="checkbox" class="s3d-opt"${optedOut() ? '' : ' checked'}${g.fits ? '' : ' disabled'}> Играть на нашем движке, когда можно</label>
      <p class="s3d-note">Редактор тот же. Старые миры не меняются: этот выбор хранится только в этом браузере.</p>
      ${g.fits ? '<p class="s3d-note">Пока отличается от старого: трава не меняет цвет по сезону (осень, снег), за краем земли мира — та же трава до горизонта.</p>' : ''}
      <div class="s3d-row"><button type="button" class="s3d-side2">🪟 Рядом: старый | наш</button><button type="button" class="s3d-x">Закрыть</button></div>`;
    const why = d.querySelector('.s3d-why'), ul = d.querySelector('.s3d-miss');
    why.textContent = g.error ? 'Движок не ответил: ' + g.error : g.fits ? `Движку хватает всего, что есть в мире (объектов: ${g.objects ?? 0}).` : 'Движок пока не умеет:';
    for (const n of miss.slice(0, 12)) { const li = document.createElement('li'); li.textContent = needRu(n); ul.appendChild(li); }
    d.querySelector('.s3d-opt').addEventListener('change', e => { setOpt(!e.target.checked); label(); });
    d.querySelector('.s3d-x').addEventListener('click', () => d.remove());
    d.querySelector('.s3d-side2').addEventListener('click', () => { d.remove(); side(!S.side); });
    ed.box.appendChild(d);
  }

  // ── картинка движка: одна на студию, поверх правой половины («Рядом») или всего окна («Играть») ──
  function stage(){
    const view = api?.ed?.q('.s3-view'); if (!view?.parentElement) return null;
    if (S.stage && S.stage.isConnected) return S.stage;
    const s = document.createElement('div'); s.className = 's3d-stage'; s.hidden = true;
    s.innerHTML = '<div class="s3d-host"></div><div class="s3d-tag">⚡ Наш движок D37</div><div class="s3d-wait" hidden>⏳ Загружаем наш движок…</div>';
    view.parentElement.insertBefore(s, view.nextSibling);   // рядом с окном старого движка (оба — половины), не поверх
    S.stage = s;
    return s;
  }
  function layout(){
    const s = stage(); if (!s) return;
    s.hidden = !(S.side || S.play);
    s.classList.toggle('s3d-full', !!S.play);
    api?.ed?.box.classList.toggle('s3d-sbs', S.side && !S.play);
  }
  async function engine(){
    if (H) return H;
    if (hostP) return hostP;
    const s = stage(); if (!s) throw new Error('нет окна студии');
    S.ready = new Promise(res => { S.readyRes = res; });
    s.querySelector('.s3d-wait').hidden = false;
    hostP = (async () => {
      const b = await build();
      const host = await import(BASE + 'engine-host.js' + (/^[0-9a-f]{6,16}$/.test(String(b.id || '')) ? '?v=' + b.id : ''));
      const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      let gl = ''; try { gl = new URLSearchParams(location.search).get('gl') || ''; } catch (e) {}
      const h = await host.start({ root: s.querySelector('.s3d-host'), scene: 'studio', world: 'main', rawSize: +b.wasm_raw || 0, quality: touch ? 'low' : '', gl: gl === '1',
        onMessage: m => onMsg(m), onProgress: () => {} });
      H = h;
      try { h.studio.hud(false); h.input(false); } catch (e) {}
      return h;
    })();
    try { return await hostP; } catch (e) { hostP = null; s.querySelector('.s3d-wait').textContent = '⚠ Наш движок не запустился: ' + String(e && e.message || e).slice(0, 140); throw e; }
  }
  function onMsg(m){
    if (!m) return;
    if (m.t === 'loaded') { S.stage?.querySelector('.s3d-wait') && (S.stage.querySelector('.s3d-wait').hidden = true); S.readyRes?.(); S.readyRes = null; return; }
    if (m.t === 'mode' && m.data && m.data.kind === 'studio') studioEv(m.data);
  }
  // мир и камера редактора → движок (раз в 100 мс; мир — только когда изменился)
  async function pushWorld(force){
    if (!H) return;
    const sig = sigNow();
    if (!force && sig === S.loadedSig) return;
    S.loadedSig = sig;
    H.studio.load(worldText());
  }
  function pushCam(){
    const ed = api?.ed; if (!H || !ed?.R?.camera || S.play) return;
    const c = ed.R.camera, T = ed.R.T, p = c.position, dir = new T.Vector3(); c.getWorldDirection(dir);
    const at = [p.x + dir.x * 20, p.y + dir.y * 20, p.z + dir.z * 20], sig = [p.x, p.y, p.z, ...at].map(v => v.toFixed(2)).join(',');
    if (sig === S.camSig) return;
    S.camSig = sig;
    H.studio.cam([p.x, p.y, p.z], at);
  }
  function tickSide(){ if (!H || S.play) return; pushWorld(false); pushCam(); }
  async function side(want){
    S.side = !!want;
    api?.ed?.q('.s3d-side')?.classList.toggle('on', S.side);
    layout();
    if (!S.side) return;
    try { await engine(); await S.ready; S.loadedSig = ''; S.camSig = ''; tickSide(); }
    catch (e) { /* сказано в окне */ }
  }

  // ═══ ▶ Играть на нашем движке ═══
  function hudHtml(){ return '<div class="s3-hud s3d-hud"><div class="s3-tags"></div><div class="s3-stats" hidden></div><div class="s3-health"><i></i></div><div class="s3-labels"></div></div><div class="s3d-toast" hidden></div>'; }
  function toast(t, ms = 2600){
    const e = S.stage?.querySelector('.s3d-toast'); if (!e) return;
    e.textContent = String(t).slice(0, 140); e.hidden = false;
    clearTimeout(S.toastT); S.toastT = setTimeout(() => { e.hidden = true; }, ms);
  }
  function drawHud(pl){
    const h = S.stage?.querySelector('.s3d-hud'); if (!h) return;
    const i = h.querySelector('.s3-health i'); if (i) { i.style.width = Math.max(0, pl.health / pl.max * 100) + '%'; i.parentElement.classList.toggle('low', pl.health < pl.max * .35); }
    const st = h.querySelector('.s3-stats'), e = Object.entries(pl.stats);
    st.hidden = !e.length; st.innerHTML = `<b>${esc(pl.nick)}</b>` + e.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    h.querySelector('.s3-labels').innerHTML = Object.values(pl.labels).map(t => `<div>${esc(t)}</div>`).join('');
  }
  // команда скрипта: то, что про картинку сайта (надписи, звук, очки), — здесь; мир — движку (он проверит сам)
  function cmd(pl, d){
    if (!d || typeof d !== 'object') return;
    if (++pl.cmds > 4000) {   // не больше 4000 команд за кадр (как на старом движке); автору — один раз, что лишнее отброшено
      if (!pl.cutSaid) { pl.cutSaid = true; api?.print('⚠️ Скрипты прислали больше 4000 команд за один кадр — лишние отброшены. Делай меньше за раз: await task.wait() в циклах', 'warn'); }
      return;
    }
    if (d.t === 'gui') {
      const c = String(d.cmd || ''), k = String(d.key ?? '').slice(0, 30), t = String(d.text || '').slice(0, 140);
      if (c === 'message') toast(t); else if (c === 'text') pl.labels[k] = t; else if (c === 'clear') delete pl.labels[k];
      else if (c === 'labels' && d.labels && typeof d.labels === 'object') { pl.labels = {}; for (const [kk, tt] of Object.entries(d.labels).slice(0, 20)) pl.labels[String(kk).slice(0, 30)] = String(tt).slice(0, 140); }
      pl.dirty = true; return;
    }
    if (d.t === 'sound') { try { if (E.synth?.NAMES?.includes(d.name)) pl.AU?.play(d.name, {}); } catch (e) {} return; }
    if (d.t === 'player') {
      if (d.cmd === 'stat' && d.v && typeof d.v.k === 'string') { pl.stats[d.v.k.slice(0, 20)] = typeof d.v.v === 'number' ? Math.round(d.v.v * 100) / 100 : String(d.v.v).slice(0, 20); pl.dirty = true; return; }
      if (d.cmd === 'message' && d.v) { toast(String(d.v.text || '')); return; }
      if (d.pid && d.pid !== 'me') return;
      pl.batch.push(d); return;
    }
    if (d.t === 'prompt' || d.t === 'want' || d.t === 'mode' || d.t === 'camera') {
      const k = d.t === 'want' ? 'клики по деталям' : d.t === 'prompt' ? 'подсказки [E]' : d.t === 'mode' ? 'Game.* (режимы игры)' : 'Camera.*';
      if (!S.warned.has(k)) { S.warned.add(k); api?.print(`⚠️ На нашем движке пока нет: ${k} — остальное работает`, 'warn'); }
      return;
    }
    pl.batch.push(d);
  }
  function studioEv(d){
    const pl = S.play; if (!pl) return;
    const SH = pl.SH;
    if (d.ev === 'state') { if (Array.isArray(d.p)) pl.me = d.p; pl.health = +d.hp || 0; pl.max = +d.max || 100; pl.dirty = true; return; }
    if (d.ev === 'touch') {
      for (const id of d.on || []) if (SH.want.touched.has(id)) SH.event('touched', { id, player: 'me' });
      for (const id of d.off || []) if (SH.want.touchEnded.has(id)) SH.event('touchEnded', { id, player: 'me' });
      return;
    }
    if (d.ev === 'tween') { SH.sync(d.id, d.props || {}); SH.event('tweenDone', { tid: d.tid }); return; }
    if (d.ev === 'coin') { pl.stats['Монеты'] = Math.round(((+pl.stats['Монеты'] || 0) + 1) * 100) / 100; pl.dirty = true; return; }
    if (d.ev === 'finish' && !pl.finished) { pl.finished = true; pl.stats['Время'] = String(d.sec); pl.dirty = true; toast(`🏁 Финиш! Время: ${String(d.sec).slice(0, 12)} с`, 4000); return; }
    if (d.ev === 'died') { toast('💀 Ты погиб — сейчас вернёшься'); SH.event('died', { player: 'me' }); return; }
    if (d.ev === 'respawned') { SH.event('respawned', { player: 'me' }); return; }
    if (d.ev === 'cut' && !pl.cutSaid) { pl.cutSaid = true; api?.print(`⚠️ Движок не успел за скриптами: ${+d.n || 0} команд отброшено. Делай меньше за раз: await task.wait() в циклах`, 'warn'); return; }
  }
  function frame(t){
    const pl = S.play; if (!pl) return;
    const dt = Math.min(.1, Math.max(0, (t - (pl.last || t)) / 1000)); pl.last = t;
    if (pl.batch.length && H) { H.studio.cmd(pl.batch); pl.batch = []; }
    pl.cmds = 0;
    if (pl.has) pl.SH.tick(dt, [{ id: 'me', pos: pl.me.slice() }]);
    if (pl.dirty) { pl.dirty = false; drawHud(pl); }
    pl.raf = requestAnimationFrame(frame);
  }
  async function startPlay(){
    const ed = api.ed, SC = ed.SC;
    S.side = S.side || false;
    const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || 'Игрок';
    const pl = S.play = { nick, stats: {}, labels: {}, health: 100, max: 100, me: [0, 0, 0], batch: [], cmds: 0, dirty: true, finished: false, AU: null };
    try { pl.AU = E.audio ? E.audio() : null; } catch (e) {}
    // то же, что студия делает перед своей игрой: расширения (урок — шаг «Играть», листы и панели закрываются, подсказки),
    // сохранить правки, снять выделение и меню
    try { api.core.ext?.('play'); if (ed.dirty) api.core.save(true); api.core.tut?.('play'); ed.TR?.cursor(null); ed.G?.attach(null); if (ed.boxHelper) ed.boxHelper.visible = false; api.core.closeMenu?.(); } catch (e) {}
    layout();
    ed.box.classList.add('s3-playing', 's3d-playing');
    ed.q('.s3-play').textContent = '■ Стоп';
    ed.q('.s3-hint') && (ed.q('.s3-hint').hidden = true);
    ed.loop?.pause(true);
    const s = stage();
    s.querySelector('.s3d-hud')?.remove(); s.querySelector('.s3d-toast')?.remove();
    s.insertAdjacentHTML('beforeend', hudHtml());
    try { await engine(); await S.ready; } catch (e) { stopPlay(); api.msg('⚠ Наш движок не запустился — играем на старом', false); S.forceR0 = true; api.core.play(); return; }
    if (S.play !== pl) return;
    S.loadedSig = '';
    await pushWorld(true);
    H.studio.play();
    H.input(true);
    try { s.querySelector('canvas')?.focus(); } catch (e) {}
    // скрипты — те же, что на старом движке (песочница, все шесть языков); их команды — движку
    for (const o of SC.all()) if (o.cls === 'Script' && o.enabled !== false && E.langs?.[o.lang]?.kind === 'binary' && !o.code) api.print(`⚠️ Скрипт «${o.name}» не собран — нажми ⚙️ Собрать`, 'warn');
    pl.SH = E.scripts({
      apply: d => cmd(pl, d),
      print: (t, k) => api.print(t, k),
      error: (sc, line, m) => { api.print(`❌ ${sc || 'скрипт'}${line > 0 ? ', строка ' + line : ''}: ${m}`, 'err'); api.setBottom('out'); },
      hang: () => { api.print('⛔ Скрипт завис (бесконечный цикл?) — остановлен. Используй await task.wait() в циклах.', 'err'); api.setBottom('out'); },
    });
    const sp = SC.all().find(o => o.cls === 'Spawn');
    pl.me = sp ? [sp.pos[0], sp.pos[1] + sp.size[1] / 2 + .05, sp.pos[2]] : [0, .05, 0];
    pl.has = pl.SH.start(SC, [{ id: 'me', name: nick, pos: pl.me.slice(), stats: {} }], { restore: false });
    if (pl.has) api.print('▶ Скрипты запущены (наш движок)', 'sys');
    api.print('▶ Играешь на нашем движке D37. WASD — идти, Пробел — прыжок. ■ Стоп — назад в редактор', 'sys');
    pl.raf = requestAnimationFrame(frame);
  }
  function stopPlay(){
    const pl = S.play; if (!pl) return;
    S.play = null;
    cancelAnimationFrame(pl.raf);
    try { pl.SH?.stop(); } catch (e) {}
    try { H?.studio.stop(); H?.input(false); } catch (e) {}
    S.stage?.querySelector('.s3d-hud')?.remove(); S.stage?.querySelector('.s3d-toast')?.remove();
    const ed = api?.ed;
    if (ed) {
      ed.box.classList.remove('s3-playing', 's3d-playing');
      ed.q('.s3-play').textContent = '▶ Играть';
      ed.loop?.pause(false);
      if (!S.leaving) try { api.core.ext?.('stop'); } catch (e) {}
      api.print('■ Остановлено — мир вернулся как был', 'sys');
    }
    S.loadedSig = ''; S.camSig = '';
    layout();
    if (S.side) tickSide();
  }
  // Esc в игре на нашем движке — назад в редактор (как на старом), раньше, чем клавишу возьмёт игра
  const onKey = e => { if (S.play && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPlay(); } };

  function style(){
    if (document.getElementById('s3d-css')) return;
    const st = document.createElement('style'); st.id = 's3d-css';
    st.textContent = `.s3d-stage{position:relative;min-width:0;min-height:0;z-index:3;background:#0b1220;border-left:2px solid #f59e0b;overflow:hidden}
.s3d-stage[hidden]{display:none}.s3d-sbs .s3-main{grid-template-columns:220px minmax(0,1fr) minmax(0,1fr) 290px}
.s3d-playing .s3-view{display:none}.s3d-playing .s3-main{grid-template-rows:minmax(0,1fr)}
.s3d-stage.s3d-full{border-left:0}.s3d-host{position:absolute;inset:0}.s3d-full .s3d-tag{top:28px;left:10px}.s3-compact.s3-playing .s3d-hud .s3-stats{bottom:150px}@media (max-width:2400px){.s3-top .s3d-ui button span{display:none}}
.s3d-tag{position:absolute;left:8px;top:8px;z-index:6;background:rgba(245,158,11,.92);color:#111;font:600 12px/1.2 system-ui,sans-serif;padding:4px 8px;border-radius:8px;pointer-events:none}
.s3d-wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:600 15px system-ui,sans-serif;background:rgba(11,18,32,.75);z-index:7;text-align:center;padding:16px}
.s3d-toast{position:absolute;left:50%;top:18%;transform:translateX(-50%);z-index:8;background:rgba(17,24,39,.88);color:#fff;font:600 16px system-ui,sans-serif;padding:8px 14px;border-radius:10px;max-width:86%;text-align:center;pointer-events:none}
.s3d-hud{z-index:6}.s3-ext .s3d-eng{font-weight:600}.s3-ext .s3d-eng.s3d-r1{background:#f59e0b;color:#111}.s3-ext .s3d-side.on{outline:2px solid #f59e0b}
.s3d-sheet{position:absolute;right:12px;top:52px;z-index:40;max-width:min(360px,calc(100% - 24px));background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;padding:12px 14px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.s3d-sheet p{margin:6px 0}.s3d-sheet ul{margin:4px 0 8px 18px;padding:0}.s3d-chk{display:flex;gap:8px;align-items:center;margin:6px 0}.s3d-note{font-size:12px;opacity:.75}
.s3d-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.s3d-row button{flex:1;min-height:36px;border-radius:8px;border:1px solid #4b5563;background:#1f2937;color:#fff;cursor:pointer}
@media (max-width:760px){.s3d-sbs .s3-main{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr)}.s3d-stage{border-left:0;border-top:2px solid #f59e0b}.s3d-stage.s3d-full{border-top:0}}`;
    document.head.appendChild(st);
  }

  E.studioExt = E.studioExt || [];
  E.studioExt.push({
    id: 'd37',
    mount(a){
      if (!on()) return;
      api = a; style();
      const slot = a.slot; if (!slot) return;
      const box = document.createElement('span'); box.className = 's3d-ui';
      box.innerHTML = '<button type="button" class="s3d-eng" title="На каком движке играет мир">⏳<span> Движок…</span></button><button type="button" class="s3d-side" title="Тот же мир рядом на нашем движке">🪟<span> Рядом</span></button>';
      slot.appendChild(box); S.ui = box;
      box.querySelector('.s3d-eng').addEventListener('click', () => { gate(true).then(sheet); });
      box.querySelector('.s3d-side').addEventListener('click', () => side(!S.side));
      const SC = a.ed?.SC;
      if (SC?.on) for (const ev of ['add', 'remove', 'change']) SC.on(ev, () => { S.changed++; });
      clearInterval(S.timer);
      S.timer = setInterval(() => { if (!api?.ed?.SC) return; tickSide(); if (!S.play && document.visibilityState === 'visible') gate(false); }, 120);
      window.addEventListener('keydown', onKey, true);
      gate(true);
    },
    unmount(){
      clearInterval(S.timer); S.timer = 0;
      window.removeEventListener('keydown', onKey, true);
      S.leaving = true; stopPlay(); S.leaving = false;
      try { H?.studio.quit(); H?.dispose(); } catch (e) {}
      H = null; hostP = null; S.stage?.remove(); S.stage = null; S.ui?.remove(); S.ui = null; S.side = false; S.gate = null; api = null;
    },
    // «▶ Играть»: мир, которому хватает движка, — на нашем движке; «■ Стоп» во время такой игры — назад. Возврат true — студия
    // свою игру не начинает (крючок в studio3d.js startPlay). «Тест вдвоём», чужой мир — пока на старом движке.
    playOn(opt = {}){
      if (!on() || !api) return false;
      if (S.forceR0) { S.forceR0 = false; return false; }
      if (S.play) { stopPlay(); return true; }
      if (opt.wait || api.ed?.mp || api.ed?.player || opt.r0) return false;
      if (!r1()) return false;
      startPlay();
      return true;
    },
  });
  // для проверок (scripts/studio-d37-e2e.cjs): состояние без внутренностей
  E.studioD37 = { state: () => ({ on: on(), gate: S.gate, side: S.side, playing: !!S.play, engine: !!H, me: S.play?.me || null, hp: S.play ? S.play.health : null, stats: S.play ? { ...S.play.stats } : null, labels: S.play ? { ...S.play.labels } : null }), handle: () => H };
})();
