// ═══════════════════════════════════════
//  «АРЕНА» — РЕДАКТОР РЕЖИМА НА НАШЕМ ДВИЖКЕ (T-176, EDITOR_ONE S2: «создание режимов на нашем движке»). Флаг STUDIO_ARENA (config.js)
// ═══════════════════════════════════════
// #/games/studio/arena/new — с нуля; …/arena/demo — из примера (файл движка /d37-preview/modes/trigger_demo.mode.json);
// …/arena/open/<id> — проект этого браузера. Человек собирает режим-арену из блоков движка и нажимает «▶ Проверить»: файл режима
// (формат 1, движок — источник правды, docs/BLOCKS.md движка) уходит в НАШ движок (канал preview) — engine-host.js runMode().
// ВСЁ про блоки — из blocks.json движка: разделы (file.sections + categories), меню «Добавить», формы (params: тип, подпись, единица,
// min / max / step, варианты), пределы (limits), подсказки (desc). Здесь нет ни одного списка блоков, параметров или их русских слов.
// Проверка — функцией движка blocks_check (wasm канала preview, загружается один раз, лениво): причина и предупреждения — рядом с тем
// местом формы, на которое указывает путь («laws[3].do[1].n: …»). Любой текст файла и движка — только textContent / esc().
// Проекты — в этом браузере (d37_arena_index, d37_arena_<id>); «Сохранить в файл» / «Открыть из файла» — текстом. Выложить и «Вдвоём»
// — «скоро» (нужен сервер). Стили — css/studio-arena.css.
(() => {
  const BASE = '/d37-preview/';
  const IDX = 'd37_arena_index', KEY = id => 'd37_arena_' + id;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ver = () => (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
  const clone = o => JSON.parse(JSON.stringify(o));

  // ═══ Модель (чистые функции: их проверяет scripts/studio-arena-test.cjs на живом blocks.json) ═══
  // M — указатель по blocks.json: блоки по id и по категории, типы, пределы
  function index(B){
    const blocks = Array.isArray(B?.blocks) ? B.blocks : [];
    const by = new Map(blocks.map(b => [b.id, b]));
    const cat = id => blocks.filter(b => b.cat === id);
    const types = new Map((B?.types || []).map(t => [t.id, t]));
    const catName = id => (B?.categories || []).find(c => c.id === id)?.name || '';
    const limit = id => (B?.limits || []).find(l => l.id === id);
    return { B, blocks, by, cat, types, catName, limit, file: B?.file || {} };
  }
  const isRef = (M, type) => !!M.types.get(type)?.ns;
  // объекты файла, которые может назвать параметр этого типа (по ns типа и ns блока объекта)
  function refOptions(M, file, type){
    const ns = M.types.get(type)?.ns;
    if (!ns) return [];
    return (file.objects || []).filter(o => M.by.get(o.b)?.ns === ns && typeof o.id === 'string').map(o => o.id);
  }
  // блоки-объекты, которые делают объекты для этого типа (подсказка «добавь …»)
  const makersOf = (M, type) => { const ns = M.types.get(type)?.ns; return M.cat('object').filter(b => b.ns === ns); };
  const textKeys = file => Object.keys(file.texts && typeof file.texts === 'object' ? file.texts : {});
  // новое имя: стем + номер, только знаки id_chars движка
  function freshId(taken, stem){
    const max = M0()?.file?.id_chars?.max || 24;
    const s = String(stem || 'o').replace(/[^A-Za-z0-9_-]/g, '').slice(0, Math.max(1, max - 3)) || 'o';
    for (let i = 1; i < 1000; i++) { const id = s + i; if (!taken.has(id)) return id; }
    return s + Date.now() % 1000;
  }
  function freshText(file){
    const keys = new Set(textKeys(file));
    for (let i = 1; i < 1000; i++) { const k = 't' + i; if (!keys.has(k)) return k; }
    return 't' + (Date.now() % 1000);
  }
  // значения параметров блока по умолчанию; ссылка «обязательно» — первый подходящий объект файла; надпись «обязательно» — первая
  // надпись или новая (тогда её ключ добавляется в texts пустой строкой — человек впишет текст)
  function defaults(M, file, blockId){
    const b = M.by.get(blockId);
    const out = { b: blockId };
    for (const p of b?.params || []) {
      let v = p.default;
      if (isRef(M, p.type) && (v == null) && p.required) v = refOptions(M, file, p.type)[0] ?? null;
      if (p.type === 'text-key' && v == null && p.required) {
        v = textKeys(file)[0];
        if (v == null) { v = freshText(file); file.texts = file.texts || {}; file.texts[v] = ''; }
      }
      if (v === undefined) v = null;
      if (v !== null || p.required) out[p.id] = v;
    }
    return out;
  }
  // блок можно поставить, если для всех его обязательных ссылок в файле есть объект (надпись создаётся сама)
  const usable = (M, file, blockId) => (M.by.get(blockId)?.params || []).every(p => !p.required || !isRef(M, p.type) || refOptions(M, file, p.type).length > 0);
  const live = b => b && b.state !== 'inert';
  function sinceMax(M, file){
    let m = 1;
    const see = x => { const b = x && M.by.get(x.b); if (b && +b.since > m) m = +b.since; };
    (file.rules || []).forEach(see); (file.objects || []).forEach(see);
    for (const l of file.laws || []) { see(l.when); (l.if || []).forEach(see); (l.do || []).forEach(see); }
    const law = M.cat('law')[0]; if ((file.laws || []).length && law && +law.since > m) m = +law.since;
    return m;
  }
  // «С нуля»: конверт файла по file.* движка, все настройки (категория rule) по умолчанию, пусто в объектах и правилах
  function newFile(M){
    const f = M.file;
    const file = { format: f.format || 1, kind: f.kind || (f.kinds || [])[0] || 'arena', engine_min: 1, arena: { kernel: (f.kernels || [])[0] || 'free' }, rules: [], objects: [], laws: [], texts: {} };
    for (const b of M.cat('rule').filter(live)) file.rules.push(defaults(M, file, b.id));
    file.engine_min = sinceMax(M, file);
    return file;
  }
  function addRule(M, file, blockId){ file.rules = file.rules || []; if (!file.rules.some(r => r.b === blockId)) file.rules.push(defaults(M, file, blockId)); }
  function addObject(M, file, blockId){
    file.objects = file.objects || [];
    const { b, ...params } = defaults(M, file, blockId);
    file.objects.push({ b, id: freshId(new Set(file.objects.map(x => x.id)), blockId), ...params });
    return file.objects.length - 1;
  }
  const lawPart = (M, part) => M.file.law?.[part];   // 'when' → 'event', 'if' → 'check', 'do' → 'action'
  const firstUsable = (M, file, cat) => M.cat(cat).filter(live).find(b => usable(M, file, b.id)) || M.cat(cat).filter(live)[0];
  function addLaw(M, file){
    file.laws = file.laws || [];
    const law = M.cat('law')[0];
    const l = { id: freshId(new Set(file.laws.map(x => x.id)), 'L') };
    for (const p of law?.params || []) if (p.default != null) l[p.id] = p.default;
    const ev = firstUsable(M, file, lawPart(M, 'when')), act = firstUsable(M, file, lawPart(M, 'do'));
    l.when = ev ? defaults(M, file, ev.id) : {};
    l.do = act ? [defaults(M, file, act.id)] : [];
    file.laws.push(l);
    return file.laws.length - 1;
  }
  function addPart(M, file, li, part, blockId){
    const l = file.laws[li]; if (!l) return;
    if (part === 'when') { l.when = defaults(M, file, blockId); return; }
    l[part] = l[part] || [];
    l[part].push(defaults(M, file, blockId));
  }
  // путь причины движка: «laws[3].do[1].n: …» → «laws[3].do[1].n»
  function pathOf(msg){
    const m = /^((?:rules|objects|laws|texts|arena|format|kind|engine_min)(?:\[\d+\])?(?:\.[A-Za-z_]+(?:\[\d+\])?)*)\s*:/.exec(String(msg || ''));
    return m ? m[1] : '';
  }
  // ближайшее к пути место формы из списка data-path (самый длинный совпавший префикс)
  function placeFor(path, paths){
    let best = '';
    for (const p of paths) if (p && (path === p || path.startsWith(p + '.') || path.startsWith(p + '[')) && p.length > best.length) best = p;
    return best;
  }
  const textOf = file => JSON.stringify(file, null, 2);
  const parseFile = text => { try { const f = JSON.parse(String(text)); return f && typeof f === 'object' && !Array.isArray(f) ? f : null; } catch (e) { return null; } };

  // ═══ Разметка формы (из params блока) ═══
  function field(M, file, path, p, v){
    const lab = `<span class="sa-lab">${esc(p.label || p.id)}${p.unit ? ` <i>${esc(p.unit)}</i>` : ''}</span>`;
    const dp = `data-path="${esc(path)}" data-type="${esc(p.type)}"`;
    if (p.type === 'number' || p.type === 'integer') {
      const range = typeof p.min === 'number' && typeof p.max === 'number' ? `<small class="sa-range">${esc(p.min)}…${esc(p.max)}</small>` : '';
      return `<label class="sa-f">${lab}<span class="sa-num"><input type="number" inputmode="decimal"${typeof p.min === 'number' ? ` min="${esc(p.min)}"` : ''}${typeof p.max === 'number' ? ` max="${esc(p.max)}"` : ''} step="${typeof p.step === 'number' ? esc(p.step) : p.type === 'integer' ? '1' : 'any'}" value="${esc(v ?? '')}" ${dp}>${range}</span></label>`;
    }
    if (p.type === 'bool') return `<label class="sa-f sa-f-bool">${lab}<input type="checkbox" ${v ? 'checked' : ''} ${dp}></label>`;
    if (p.type === 'choice') return `<label class="sa-f">${lab}<select ${dp}>${(p.options || []).map(o => `<option value="${esc(o.id)}"${o.id === v ? ' selected' : ''}>${esc(o.name || o.id)}</option>`).join('')}</select></label>`;
    if (isRef(M, p.type)) {
      const opts = refOptions(M, file, p.type);
      const none = !p.required ? `<option value=""${v == null ? ' selected' : ''}>— любой —</option>` : '';
      const miss = p.required && !opts.length ? `<option value="" selected>— нет: добавь «${esc(makersOf(M, p.type).map(b => b.name).join(' / '))}» —</option>` : '';
      const lost = v != null && !opts.includes(v) ? `<option value="${esc(v)}" selected>${esc(v)} (нет такого)</option>` : '';
      return `<label class="sa-f">${lab}<select ${dp}>${none}${miss}${lost}${opts.map(id => `<option value="${esc(id)}"${id === v ? ' selected' : ''}>${esc(id)}</option>`).join('')}</select></label>`;
    }
    if (p.type === 'text-key') {
      const keys = textKeys(file);
      const none = !p.required ? `<option value=""${v == null ? ' selected' : ''}>— нет —</option>` : '';
      const lost = v != null && !keys.includes(v) ? `<option value="${esc(v)}" selected>${esc(v)} (нет такой)</option>` : '';
      return `<label class="sa-f">${lab}<select ${dp}>${none}${lost}${keys.map(k => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(file.texts[k] ? String(file.texts[k]).slice(0, 40) : k)}</option>`).join('')}<option value="__new">+ новая надпись</option></select></label>`;
    }
    return `<label class="sa-f">${lab}<input type="text" value="${esc(v ?? '')}" ${dp}></label>`;   // тип, которого редактор ещё не знает: как текст
  }
  const fields = (M, file, path, item) => (M.by.get(item?.b)?.params || []).map(p => field(M, file, path + '.' + p.id, p, item[p.id])).join('');
  const blockHead = (b, fallback) => `<b class="sa-bn" title="${esc(b?.desc || '')}">${esc(b?.name || fallback)}</b>${b && !live(b) ? `<small class="sa-inert">${esc(b.inert_reason || '')}</small>` : ''}`;
  const del = (path, what) => `<button type="button" class="sa-x" data-del="${esc(path)}" aria-label="Убрать ${esc(what)}" title="Убрать">✕</button>`;
  // меню «Добавить» по категории: только живые блоки; где не хватает объекта — подсказка из desc
  function addMenu(M, file, cat, act, extra = ''){
    const list = M.cat(cat).filter(live);
    return `<label class="sa-add"><span>+ Добавить</span><select data-add="${esc(act)}" ${extra}><option value="">+ Добавить…</option>${list.map(b => `<option value="${esc(b.id)}"${usable(M, file, b.id) ? '' : ' disabled'}>${esc(b.name)}</option>`).join('')}</select></label>`;
  }
  function rulesHtml(M, file){
    const have = new Set((file.rules || []).map(r => r.b));
    const missing = M.cat('rule').filter(b => live(b) && !have.has(b.id));
    return (file.rules || []).map((r, i) => `<div class="sa-card" data-path="rules[${i}]">${blockHead(M.by.get(r.b), r.b)}<div class="sa-fs">${fields(M, file, `rules[${i}]`, r)}</div></div>`).join('')
      + (missing.length ? `<label class="sa-add"><span>+ Добавить</span><select data-add="rule"><option value="">+ Добавить…</option>${missing.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>` : '');
  }
  function objectsHtml(M, file){
    const idMax = M.file.id_chars?.max || 24;
    return (file.objects || []).map((o, i) => `<div class="sa-card" data-path="objects[${i}]">${blockHead(M.by.get(o.b), o.b)}${del(`objects[${i}]`, 'объект')}
      <div class="sa-fs"><label class="sa-f"><span class="sa-lab">Имя</span><input type="text" maxlength="${esc(idMax)}" value="${esc(o.id)}" data-path="objects[${i}].id" data-type="id" autocapitalize="off" spellcheck="false"></label>${fields(M, file, `objects[${i}]`, o)}</div></div>`).join('')
      + addMenu(M, file, 'object', 'object');
  }
  function partHtml(M, file, li, part, item, j){
    const path = part === 'when' ? `laws[${li}].when` : `laws[${li}].${part}[${j}]`;
    const cat = lawPart(M, part);
    const pick = `<select class="sa-pick" data-swap="${esc(path)}" aria-label="${esc(M.catName(cat))}">${M.cat(cat).filter(live).map(b => `<option value="${esc(b.id)}"${b.id === item?.b ? ' selected' : ''}${usable(M, file, b.id) || b.id === item?.b ? '' : ' disabled'}>${esc(b.name)}</option>`).join('')}</select>`;
    const b = M.by.get(item?.b);
    return `<div class="sa-part" data-path="${esc(path)}">${pick}${part === 'when' ? '' : del(path, M.catName(cat))}${b?.desc ? `<small class="sa-desc">${esc(b.desc)}</small>` : ''}<div class="sa-fs">${fields(M, file, path, item || {})}</div></div>`;
  }
  function lawsHtml(M, file){
    const law = M.cat('law')[0];
    const max = k => M.file.law?.[k];
    return (file.laws || []).map((l, i) => {
      const ifs = Array.isArray(l.if) ? l.if : [], dos = Array.isArray(l.do) ? l.do : [];
      const lawFields = (law?.params || []).map(p => field(M, file, `laws[${i}].${p.id}`, p, l[p.id])).join('');
      return `<div class="sa-card sa-law" data-path="laws[${i}]"><div class="sa-law-h"><b class="sa-bn">${esc(law?.name || '')} ${i + 1}</b>
          <span class="sa-mv"><button type="button" data-move="${i}" data-dir="-1" aria-label="Выше"${i ? '' : ' disabled'}>↑</button><button type="button" data-move="${i}" data-dir="1" aria-label="Ниже"${i < file.laws.length - 1 ? '' : ' disabled'}>↓</button></span>${del(`laws[${i}]`, 'правило')}</div>
        <div class="sa-w"><span class="sa-w-k">${esc(M.catName(lawPart(M, 'when')))}</span>${partHtml(M, file, i, 'when', l.when, 0)}</div>
        <div class="sa-w"><span class="sa-w-k">${esc(M.catName(lawPart(M, 'if')))}</span>${ifs.map((c, j) => partHtml(M, file, i, 'if', c, j)).join('')}${ifs.length < (max('if_max') ?? 4) ? addMenu(M, file, lawPart(M, 'if'), `if:${i}`) : ''}</div>
        <div class="sa-w"><span class="sa-w-k">${esc(M.catName(lawPart(M, 'do')))}</span>${dos.map((c, j) => partHtml(M, file, i, 'do', c, j)).join('')}${dos.length < (max('do_max') ?? 8) ? addMenu(M, file, lawPart(M, 'do'), `do:${i}`) : ''}</div>
        <details class="sa-more"><summary>Ещё</summary><div class="sa-fs"><label class="sa-f"><span class="sa-lab">Имя</span><input type="text" value="${esc(l.id ?? '')}" data-path="laws[${i}].id" data-type="id" autocapitalize="off" spellcheck="false"></label>${lawFields}</div></details></div>`;
    }).join('') + `<button type="button" class="sa-btn ghost sa-addlaw" data-addlaw="1">+ ${esc(law?.name || '')}</button>`;
  }
  function textsHtml(M, file){
    const max = M.limit('text_chars')?.value;
    return textKeys(file).map(k => `<div class="sa-text" data-path="texts.${esc(k)}"><span class="sa-key">${esc(k)}</span><input type="text" ${typeof max === 'number' ? `maxlength="${esc(max)}"` : ''} value="${esc(file.texts[k])}" data-path="texts.${esc(k)}" data-type="words">${del('texts.' + k, 'надпись')}</div>`).join('')
      + `<button type="button" class="sa-btn ghost" data-addtext="1">+ Надпись</button>`;
  }
  // разделы — по file.sections движка (ключ, категория); заголовок — имя категории (у texts категории нет)
  function sectionsHtml(M, file){
    const body = s => (s.key === 'rules' ? rulesHtml(M, file) : s.key === 'objects' ? objectsHtml(M, file) : s.key === 'laws' ? lawsHtml(M, file) : s.key === 'texts' ? textsHtml(M, file)
      : '<p class="sa-note">Этот раздел файла редактор пока не показывает.</p>');
    const title = s => s.cat ? (s.cat === 'law' ? 'Правила «когда → то»' : M.catName(s.cat)) : 'Надписи';
    return (M.file.sections || []).map(s => `<section class="sa-sec" data-sec="${esc(s.key)}" data-path="${esc(s.key)}"><h3 class="sa-h">${esc(title(s))}${s.key === 'laws' ? ` <small>${esc(M.limit('laws')?.label || '')}: до ${esc(M.limit('laws')?.value ?? '')}</small>` : ''}</h3>
      ${body(s)}</section>`).join('');
  }
  function limitsHtml(M){
    const rows = (M.B.limits || []).map(l => `<li>${esc(l.label)}: <b>${esc(l.value)}</b>${l.unit ? ' ' + esc(l.unit) : ''}${l.owner_pending ? ' <i>(черновик)</i>' : ''}</li>`).join('');
    return `<details class="sa-limits"><summary>Пределы движка</summary><ul>${rows}</ul></details>`;
  }
  function screenHtml(name){
    return `<div class="sa">
      <div class="sa-top"><a class="sa-btn ghost" href="#/games/studio" aria-label="Назад в студию">←</a><input class="sa-name" type="text" maxlength="40" value="${esc(name)}" aria-label="Название режима"><span class="sa-badge">⚡ Наш движок</span></div>
      <div class="sa-main">
        <div class="sa-left">
          <div class="sa-play"><div class="sa-stage"></div><div class="sa-cover"><b>⚡ Арена на нашем движке</b><small>Нажми «Проверить» — режим запустится прямо здесь.</small></div></div>
          <div class="sa-bar"><button type="button" class="sa-btn sa-run" data-run="1">▶ Проверить</button><button type="button" class="sa-btn ghost sa-stop" data-stop="1" hidden>■ Стоп</button></div>
          <div class="sa-status" role="status" aria-live="polite"><span class="sa-st">Загружаем блоки движка…</span></div>
          <div class="sa-warns" hidden></div>
        </div>
        <div class="sa-right"><div class="sa-form"></div>
          <div class="sa-files"><button type="button" class="sa-btn ghost" data-save="1">💾 Сохранить в файл</button><button type="button" class="sa-btn ghost" data-open="1">📂 Открыть из файла</button>
            ${shareOn() ? '' : '<button type="button" class="sa-btn ghost" disabled title="Скоро">🌍 Выложить — скоро</button>'}<button type="button" class="sa-btn ghost" disabled title="Скоро">👥 Вдвоём — скоро</button></div>
          ${shareOn() ? shareHtml() : '<p class="sa-note">Проект хранится только в этом браузере. Чтобы не потерять — «Сохранить в файл».</p>'}
          <div class="sa-limwrap"></div>
          <div class="sa-io" hidden><textarea class="sa-io-t" rows="10" spellcheck="false" aria-label="Текст файла режима"></textarea>
            <div class="sa-io-b"><input type="file" accept=".json,application/json,text/plain" class="sa-io-f" aria-label="Выбрать файл"><button type="button" class="sa-btn" data-io-ok="1">Открыть этот текст</button><button type="button" class="sa-btn ghost" data-io-copy="1">Скопировать</button><button type="button" class="sa-btn ghost" data-io-close="1">Закрыть</button></div></div>
        </div>
      </div></div>`;
  }

  // ═══ Хранилище этого браузера ═══
  function projects(){ try { const a = JSON.parse(localStorage.getItem(IDX) || '[]'); return Array.isArray(a) ? a.filter(p => p && /^[a-z0-9]{4,24}$/.test(String(p.id))) : []; } catch (e) { return []; } }
  function saveProject(id, name, text, meta){
    try {
      localStorage.setItem(KEY(id), text);
      const all = projects(), prev = all.find(p => p.id === id) || {};
      const list = all.filter(p => p.id !== id);
      list.unshift({ ...prev, ...(meta || {}), id, name: String(name || 'Моя арена').slice(0, 40), t: Date.now() });
      localStorage.setItem(IDX, JSON.stringify(list.slice(0, 50)));
      return true;
    } catch (e) { return false; }
  }
  const setMeta = (id, meta) => { const p = projects().find(x => x.id === id); const t = loadProject(id); return p && t != null ? saveProject(id, p.name, t, meta) : false; };
  const loadProject = id => { try { return localStorage.getItem(KEY(id)); } catch (e) { return null; } };
  const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

  // ═══ Движок: blocks.json, проверка (wasm один раз), запуск (engine-host) ═══
  let blocksP = null, wasmP = null, buildP = null, M_ = null;
  const M0 = () => M_;
  const build = () => (buildP ||= fetch(BASE + 'build.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({})));
  const blocks = () => (blocksP ||= build().then(b => fetch(BASE + 'blocks.json?v=' + encodeURIComponent(b.id || ver()))).then(r => { if (!r.ok) throw new Error('blocks.json: HTTP ' + r.status); return r.json(); }));
  // тот же модуль d37_web.js, что берёт engine-host.js (тот же адрес) — wasm скачивается и запускается один раз
  const wasm = () => (wasmP ||= import(BASE + 'd37_web.js').then(async m => { await m.default({ module_or_path: BASE + 'd37_web_bg.wasm' }); return m; }));
  async function check(text){
    const m = await wasm();
    try { return JSON.parse(m.blocks_check(String(text))); } catch (e) { return { ok: false, error: 'проверка не ответила', warnings: [] }; }
  }

  // ═══ Сайт: сохранить, ссылка, «Выложить за 500 🪙», по мотивам (T-176 S3, флаг STUDIO_SHARE) ═══
  // Общий путь игр игроков: таблица ugc_games (вид 'arena', data — файл режима), функции community.sql ч. 19 (ugc_arena_save /
  // ugc_arena_publish / ugc_arena_remix) и старые ugc_status / ugc_play / ugc_like / ugc_report (ugc.sql). Пока ч. 19 нет на сервере
  // (строка site_config 'part19'), кнопки пишут «после обновления базы» и ничего не зовут. Цена — с сервера (ugc_arena_rule), без
  // ответа — 500 (число владельца, EDITOR_ONE §13).
  const shareOn = () => typeof STUDIO_SHARE !== 'undefined' && !!STUDIO_SHARE;
  const SB = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  const me = () => { try { return typeof currentUser !== 'undefined' && currentUser ? currentUser : null; } catch (e) { return null; } };
  const staff = () => { try { return typeof currentProfile !== 'undefined' && ['admin', 'moderator'].includes(currentProfile?.role); } catch (e) { return false; } };
  const AGES = [0, 6, 12, 16];
  let p19 = null, price = 500;
  async function part19(){
    if (p19 !== null) return p19;
    if (!SB()) return false;
    try { const { data } = await SB().from('site_config').select('*').eq('key', 'part19').maybeSingle(); p19 = !!data && String(data.value) !== '0'; } catch (e) { p19 = false; }
    if (p19) { try { const { data } = await SB().rpc('ugc_arena_rule', { p_key: 'price' }); if (Number.isInteger(data) && data > 0) price = data; } catch (e) {} }
    return p19;
  }
  async function rpc(name, args){
    if (!SB()) return { ok: false, reason: 'offline' };
    try { const { data, error } = await SB().rpc(name, args || {}); if (error) return { ok: false, reason: 'error', message: String(error.message || '') }; return data || { ok: false, reason: 'error' }; }
    catch (e) { return { ok: false, reason: 'offline' }; }
  }
  const WHY = { auth: 'Войди на сайт', title: 'Название — от 2 до 60 знаков', data: 'Файл режима не принят (больше 64 КБ или не файл режима)', words: 'В тексте режима есть запрещённые слова или ссылки — поправь',
    age: 'Выбери, для какого возраста режим', age_mod: 'Метку поставил модератор — ниже её не опустить', limit: 'Уже 30 игр — удали старую', too_fast: 'Слишком часто — подожди пару секунд',
    not_found: 'Не найдено', banned: 'Модератор убрал этот режим', held: 'Режим скрыт жалобами — ждёт модератора', same: 'Это точная копия режима — поменяй что-нибудь, тогда можно выложить',
    kind: 'Это не арена', off: 'Выкладывать сейчас нельзя', offline: 'Нет связи с сайтом', error: 'Сайт не ответил — попробуй ещё раз' };
  const why = r => (r && r.reason === 'coins' ? `Не хватает монет: нужно ${r.price ?? price} 🪙, у тебя ${r.coins ?? 0} 🪙` : WHY[r?.reason] || WHY.error);
  const linkOf = id => location.origin + '/#/games/studio/arena/play/' + encodeURIComponent(id);
  function shareHtml(){
    return `<div class="sa-share"><b class="sa-share-h">🌍 На сайт</b>
      <label class="sa-f"><span class="sa-lab">Для какого возраста</span><select class="sa-age" aria-label="Метка возраста"><option value="">— выбери —</option>${AGES.map(a => `<option value="${a}">${a}+</option>`).join('')}</select></label>
      <label class="sa-f"><span class="sa-lab">Описание</span><input type="text" class="sa-descr" maxlength="300" placeholder="Коротко: что делать в режиме"></label>
      <div class="sa-files"><button type="button" class="sa-btn" data-ssave="1">☁️ Сохранить на сайте</button><button type="button" class="sa-btn ghost" data-slink="1">🔗 Ссылка для друзей</button>
        <button type="button" class="sa-btn gold" data-spub="1">🌍 Выложить за <span class="sa-price">500</span> 🪙</button></div>
      <p class="sa-note sa-share-st" role="status" aria-live="polite">Проект хранится в этом браузере. «Сохранить на сайте» — чтобы открыть с другого устройства и позвать друзей.</p>
      <p class="sa-note">Выложенный режим сразу попадает в «Игры игроков» с меткой «не проверено» — без модератора. Жалобы скрывают его до проверки.</p></div>`;
  }
  // Подключить кнопки «На сайт» к экрану редактора st (q — поиск в нём, status — строка редактора)
  function shareBind(st, q){
    const box = q('.sa-share'); if (!box) return;
    const say = (t, bad) => { const e = q('.sa-share-st'); if (e) { e.textContent = t; e.classList.toggle('sa-bad-t', !!bad); } };
    const meta = () => projects().find(p => p.id === st.id) || {};
    const m0 = meta();
    if (m0.age != null) q('.sa-age').value = String(m0.age);
    if (m0.descr) q('.sa-descr').value = String(m0.descr);
    if (m0.srv) say(m0.status === 'public' ? '✓ Выложено в «Игры игроков».' : m0.status === 'link' ? '✓ На сайте, по ссылке.' : '✓ Сохранено на сайте (черновик).');
    part19().then(on => { if (q('.sa-price')) q('.sa-price').textContent = String(price); if (!on) say('Сохранить на сайте и выложить можно будет после обновления базы сайта. Пока — «Сохранить в файл».'); });
    q('.sa-age').addEventListener('change', e => { const v = e.target.value === '' ? null : +e.target.value; setMeta(st.id, { age: v }); });
    q('.sa-descr').addEventListener('change', e => setMeta(st.id, { descr: String(e.target.value).slice(0, 300) }));
    let busy = false;
    async function ready(){
      if (!me()) { say('Войди на сайт, чтобы сохранить режим на сайте.', true); return false; }
      if (!await part19()) { say('Сохранить на сайте можно будет после обновления базы сайта.', true); return false; }
      if (!st.report?.ok) { say('Сначала исправь файл — движок его пока не принимает.', true); return false; }
      return true;
    }
    async function save(){
      const age = q('.sa-age').value === '' ? null : +q('.sa-age').value;
      const r = await rpc('ugc_arena_save', { p_id: meta().srv || '', p_title: st.name, p_descr: q('.sa-descr').value, p_icon: '⚡', p_data: st.file, p_age: age });
      if (!r?.ok) { say('⚠ ' + why(r), true); return null; }
      setMeta(st.id, { srv: r.id, status: r.status, age, descr: q('.sa-descr').value });
      return r;
    }
    box.addEventListener('click', async e => {
      const b = e.target.closest?.('button'); if (!b || busy) return;
      busy = true;
      try {
        if (!await ready()) return;
        if (b.dataset.ssave) { const r = await save(); if (r) say(r.status === 'public' ? '✓ Сохранено — изменения уже в «Играх игроков» (без второй оплаты).' : '✓ Сохранено на сайте.'); }
        else if (b.dataset.slink) {
          const r = await save(); if (!r) return;
          if (r.status !== 'public' && r.status !== 'link') { const s2 = await rpc('ugc_status', { p_id: r.id, p_status: 'link' }); if (!s2?.ok) { say('⚠ ' + why(s2), true); return; } setMeta(st.id, { status: 'link' }); }
          const url = linkOf(r.id);
          try { await navigator.clipboard?.writeText(url); } catch (er) {}
          say('🔗 Ссылка для друзей (скопирована): ' + url);
        } else if (b.dataset.spub) {
          if (q('.sa-age').value === '') { say('⚠ ' + WHY.age, true); q('.sa-age').focus(); return; }
          const paid = meta().status === 'public' || meta().paid;
          if (!paid && !confirm(`Выложить «${st.name}» в «Игры игроков» за ${price} 🪙?\nМонеты списываются один раз; правки потом — бесплатно.`)) return;
          const r = await save(); if (!r) return;
          const p = await rpc('ugc_arena_publish', { p_id: r.id });
          if (!p?.ok) { say('⚠ ' + why(p), true); return; }
          setMeta(st.id, { status: 'public', paid: true });
          say(`✓ Выложено в «Игры игроков»${p.charged ? ` — списано ${p.charged} 🪙` : ''}. Ссылка: ${linkOf(r.id)}`);
          if (typeof window.D37Coins?.refresh === 'function') { try { window.D37Coins.refresh(); } catch (er) {} }
        }
      } finally { busy = false; }
    });
  }

  // ═══ Запуск файла на нашем движке (общий для «Проверить» и страницы игры) ═══
  async function startEngine(stage, text, on){
    const b = await build();
    const host = await import(BASE + 'engine-host.js' + (/^[0-9a-f]{6,16}$/.test(String(b.id || '')) ? '?v=' + b.id : ''));
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return host.start({ root: stage, scene: 'umode', modeText: text, rawSize: +b.wasm_raw || 0, quality: touch ? 'low' : '', onMessage: on.message, onProgress: on.progress });
  }

  // ═══ Страница выложенной арены: #/games/studio/arena/play/<id> — только наш движок, файл ещё раз проверяется движком ═══
  const COLS = 'id,title,icon,descr,kind,data,status,plays,likes,author,created_at';
  async function loadRow(id){
    if (!SB() || !/^[a-z0-9]{4,24}$/.test(id)) return null;
    for (const cols of [COLS + ',age_rating,age_ok,unchecked,src_id,src_title,profiles!ugc_games_author_fkey(nick)', COLS]) {
      try { const { data, error } = await SB().from('ugc_games').select(cols).eq('id', id).maybeSingle(); if (!error) return data || null; } catch (e) { return null; }
    }
    return null;
  }
  function playPage(root, id, api){
    const st = S = { root, api, id, h: null, dead: false, play: true };
    const alive = () => S === st && !st.dead;
    root.innerHTML = `<div class="sa sa-pp"><div class="sa-top"><a class="sa-btn ghost" href="#/games/studio" aria-label="Назад в студию">←</a><b class="sa-pp-t">Загружаем…</b><span class="sa-badge">⚡ Наш движок</span></div>
      <div class="sa-pp-meta"></div><div class="sa-play"><div class="sa-stage"></div><div class="sa-cover"><b>⚡ Арена игрока</b><small class="sa-pp-cs"></small><button type="button" class="sa-btn sa-pp-go" hidden>▶ Играть</button></div></div>
      <div class="sa-status" role="status" aria-live="polite"><span class="sa-st">Загружаем…</span></div>
      <div class="sa-files sa-pp-a"></div><p class="sa-descr-t"></p><p class="sa-note sa-pp-src" hidden></p>
      <p class="sa-note">Это режим игрока. Никогда не вводи в играх пароли и личные данные.</p></div>`;
    const q = s => root.querySelector(s);
    const status = (t, k) => { const e = q('.sa-st'); if (!e) return; e.textContent = t; q('.sa-status').className = 'sa-status sa-' + (k || 'ok'); };
    loadRow(id).then(async g => {
      if (!alive()) return;
      if (!g || g.kind !== 'arena') { q('.sa-pp-t').textContent = 'Режим не найден'; status('Режим не найден, скрыт автором или ждёт модератора.', 'warn'); q('.sa-cover').hidden = true; return; }
      const mine = me() && g.author === me().id;
      q('.sa-pp-t').textContent = String(g.title || 'Арена').slice(0, 60);
      const meta = q('.sa-pp-meta');
      if (g.age_rating != null) { const ab = document.createElement('i'); ab.className = 'sa-age-b'; ab.title = 'Метка возраста режима'; ab.textContent = (+g.age_rating || 0) + '+'; meta.appendChild(ab); }
      if (g.unchecked !== false) { const u = document.createElement('span'); u.className = 'sa-unchecked'; u.textContent = '⚠ не проверено модератором'; meta.appendChild(u); }
      const by = document.createElement('small'); by.textContent = ` от ${String(g.profiles?.nick || 'игрока').slice(0, 40)} · 👁 ${+g.plays || 0} · ❤️ ${+g.likes || 0}`; meta.appendChild(by);
      q('.sa-descr-t').textContent = String(g.descr || '').slice(0, 300);
      if (g.src_id) { const s = q('.sa-pp-src'); s.hidden = false; s.append('По мотивам: '); const a = document.createElement('a'); a.href = '#/games/studio/arena/play/' + encodeURIComponent(String(g.src_id)); a.textContent = String(g.src_title || 'другого режима').slice(0, 60); s.appendChild(a); }
      const acts = q('.sa-pp-a');
      const btn = (t, f, cls = 'ghost') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sa-btn ' + cls; b.textContent = t; b.addEventListener('click', f); acts.appendChild(b); return b; };
      if (mine) { const a = document.createElement('a'); a.className = 'sa-btn ghost'; a.href = '#/games/studio/arena/edit/' + encodeURIComponent(g.id); a.textContent = '✏️ Изменить'; acts.appendChild(a); }
      btn('❤️', async () => { const r = await rpc('ugc_like', { p_id: g.id }); status(r?.ok ? (r.liked ? '❤️ Понравилось' : 'Лайк убран') : '⚠ ' + why(r), r?.ok ? 'ok' : 'warn'); });
      btn('🔗 Ссылка', async () => { try { await navigator.clipboard?.writeText(linkOf(g.id)); } catch (e) {} status('🔗 Ссылка: ' + linkOf(g.id)); });
      if (!mine) btn('⚠️ Пожаловаться', async () => { const w = prompt('Что не так с этим режимом?'); if (w == null) return; const r = await rpc('ugc_report', { p_id: g.id, p_reason: String(w).slice(0, 200) }); status(r?.ok ? 'Жалоба отправлена — модератор посмотрит.' : '⚠ ' + why(r), r?.ok ? 'ok' : 'warn'); });
      btn('🎨 Сделать по мотивам', async () => {
        if (!me()) { status('Войди на сайт, чтобы сделать свой режим по мотивам.', 'warn'); return; }
        if (!await part19()) { status('«По мотивам» заработает после обновления базы сайта.', 'warn'); return; }
        const r = await rpc('ugc_arena_remix', { p_src: g.id });
        if (!r?.ok) { status('⚠ ' + why(r), 'warn'); return; }
        location.hash = '#/games/studio/arena/edit/' + r.id;
      });
      if (staff()) btn('🛡️ Модерация', () => { location.hash = '#/games/studio/mod'; });
      // возраст: чужой режим не по возрасту — обложка вместо игры (как у игр игроков, js/core/age.js)
      const AU = window.D37Age?.ugc;
      if (!mine && AU && window.D37Age?.cover && window.D37Age.cover(q('.sa-stage'), AU.age(g.age_rating), { why: AU.WHY, title: g.title, back: '#/games/studio', onOpen: () => { if (alive()) playPage(root, id, api); } })) { q('.sa-cover').hidden = true; status('Режим для другого возраста.', 'warn'); return; }
      const text = JSON.stringify(g.data || {});
      status('Проверяем файл режима движком…');
      const r = await check(text).catch(() => ({ ok: false, error: 'движок не загрузился — проверь интернет' }));
      if (!alive()) return;
      if (!r.ok) { q('.sa-pp-cs').textContent = 'Движок не принял этот файл.'; status('⚠ Файл режима не прошёл проверку движка: ' + String(r.error || ''), 'err'); return; }
      q('.sa-pp-cs').textContent = `Правил ${+r.laws || 0} · зон ${+r.zones || 0} · предметов ${+r.pickups || 0}`;
      status('✓ Файл проверен движком. Нажми «Играть».');
      const go = q('.sa-pp-go'); go.hidden = false;
      go.addEventListener('click', async () => {
        go.disabled = true; status('Запускаем движок… (первый раз — дольше)');
        try {
          const h = await startEngine(q('.sa-stage'), text, {
            message: m => { if (!alive() || !m) return; if (m.t === 'loaded') { status('▶ Играем на нашем движке'); if (g.status !== 'draft') rpc('ugc_play', { p_id: g.id }); } else if (m.t === 'error') status('⚠ Движок: ' + String(m.msg || m.code || '').slice(0, 200), 'err'); },
            progress: p => { if (alive() && p?.phase === 'wasm' && p.total) status(`Загружаем движок… ${Math.round(100 * p.done / p.total)}%`); } });
          if (!alive()) { h.dispose(); return; }
          st.h = h; q('.sa-cover').hidden = true;
        } catch (e) { if (alive()) { status('⚠ Движок не запустился: ' + String(e?.message || e).slice(0, 200), 'err'); go.disabled = false; } }
      });
    });
  }
  // #/games/studio/arena/edit/<id> — своя арена с сайта: в проект этого браузера (тот же, если уже был) и в редактор
  async function editFromSite(root, id, api){
    const st = S = { root, api, id, dead: false };
    root.innerHTML = '<div class="sa"><div class="sa-status"><span class="sa-st">Загружаем режим с сайта…</span></div></div>';
    const g = await loadRow(id);
    if (S !== st) return;
    const say = t => { const e = root.querySelector('.sa-st'); if (e) e.textContent = t; };
    if (!me()) { say('Войди на сайт, чтобы изменить свой режим.'); return; }
    if (!g || g.kind !== 'arena' || g.author !== me().id) { say('Режим не найден или он не твой. Открой его страницу и нажми «Сделать по мотивам».'); return; }
    const was = projects().find(p => p.srv === g.id);
    const pid = was ? was.id : newId();
    saveProject(pid, g.title, textOf(g.data || {}), { srv: g.id, status: g.status, age: g.age_ok === false ? null : g.age_rating ?? null, descr: g.descr || '', paid: g.status === 'public' });
    history.replaceState(null, '', '#/games/studio/arena/open/' + pid);
    mount(root, 'open/' + pid, api);
  }

  // ═══ Экран ═══
  let S = null;
  function mount(root, rest, api){
    unmount();
    css();
    const [mode, pid] = String(rest || '').split('/');
    if (mode === 'play' && shareOn()) { playPage(root, String(pid || ''), api); return; }   // T-176 S3: страница выложенной арены
    if (mode === 'edit' && shareOn()) { editFromSite(root, String(pid || ''), api); return; }
    const st = S = { root, api, id: mode === 'open' && /^[a-z0-9]{4,24}$/.test(pid || '') ? pid : newId(), file: null, name: 'Моя арена', h: null, hostP: null, report: null, seq: 0, timer: 0, running: false, dead: false };
    root.innerHTML = screenHtml(st.name);
    const q = s => root.querySelector(s);
    const alive = () => S === st && !st.dead;
    blocks().then(async B => {
      if (!alive()) return;
      M_ = st.M = index(B);
      if (mode === 'open') {
        const f = parseFile(loadProject(st.id));
        const meta = projects().find(p => p.id === st.id);
        if (!f) { status('Проект не найден в этом браузере — начинаем с нуля.', 'warn'); st.file = newFile(st.M); } else { st.file = f; st.name = meta?.name || st.name; }
      } else if (mode === 'demo') {
        const b = await build();
        const r = await fetch(BASE + 'modes/trigger_demo.mode.json?v=' + encodeURIComponent(b.id || ver()));
        if (!alive()) return;
        st.file = r.ok ? parseFile(await r.text()) : null;
        if (!st.file) { status('Пример не загрузился — начинаем с нуля.', 'warn'); st.file = newFile(st.M); }
        st.name = 'Арена из примера';
      } else st.file = newFile(st.M);
      q('.sa-name').value = st.name;
      q('.sa-limwrap').innerHTML = limitsHtml(st.M);
      if (mode !== 'open') history.replaceState(null, '', '#/games/studio/arena/open/' + st.id);
      draw(); changed(true);
      if (shareOn()) shareBind(st, q);
    }).catch(e => { if (alive()) status('Блоки движка не загрузились — проверь интернет и обнови страницу.', 'err'); });

    function status(text, kind){ const el = q('.sa-st'); if (!el) return; el.textContent = text; q('.sa-status').className = 'sa-status sa-' + (kind || 'ok'); }
    function draw(){
      const form = q('.sa-form'); if (!form) return;
      const y = window.scrollY;
      form.innerHTML = sectionsHtml(st.M, st.file);
      window.scrollTo(0, y);
      showReport();
    }
    // путь к значению по «laws[2].do[0].n»
    function walk(path){
      const parts = String(path).match(/[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) || [];
      let o = st.file, parent = null, key = null;
      for (const p of parts) { parent = o; key = p[0] === '[' ? +p.slice(1, -1) : p; o = o == null ? undefined : o[key]; }
      return { parent, key, value: o };
    }
    function changed(now){
      st.file.engine_min = Math.max(1, sinceMax(st.M, st.file));
      const text = textOf(st.file);
      saveProject(st.id, st.name, text);
      clearTimeout(st.timer);
      const seq = ++st.seq;
      st.timer = setTimeout(async () => {
        const r = await check(text).catch(() => ({ ok: false, error: 'движок не загрузился — проверь интернет', warnings: [] }));
        if (!alive() || seq !== st.seq) return;
        st.report = r; showReport();
      }, now ? 0 : 250);
    }
    function showReport(){
      const r = st.report, form = q('.sa-form'); if (!form) return;
      form.querySelectorAll('.sa-err,.sa-warn').forEach(e => e.remove());
      form.querySelectorAll('.sa-bad').forEach(e => e.classList.remove('sa-bad'));
      if (!r) return;
      const paths = [...form.querySelectorAll('[data-path]')].map(e => e.dataset.path);
      const put = (msg, cls) => {
        const at = placeFor(pathOf(msg), paths);
        const host = at ? [...form.querySelectorAll('[data-path]')].find(e => e.dataset.path === at) : null;
        const n = document.createElement('div'); n.className = cls; n.setAttribute('role', cls === 'sa-err' ? 'alert' : 'note'); n.textContent = msg;
        if (host) { const box = host.closest('.sa-f,.sa-text,.sa-part,.sa-card,.sa-sec') || host; box.classList.add('sa-bad'); box.insertAdjacentElement(box === host && host.tagName !== 'INPUT' && host.tagName !== 'SELECT' ? 'afterbegin' : 'afterend', n); }
        return !!host;
      };
      const warns = Array.isArray(r.warnings) ? r.warnings : [];
      if (r.ok) status(`✓ Файл в порядке: правил ${r.laws ?? 0}, зон ${r.zones ?? 0}, предметов ${r.pickups ?? 0}${warns.length ? ` · предупреждений ${warns.length}` : ''}`, warns.length ? 'warn' : 'ok');
      else { status('⚠ ' + String(r.error || 'файл не принят'), 'err'); put(String(r.error || ''), 'sa-err'); }
      const wbox = q('.sa-warns');
      wbox.textContent = '';
      for (const w of warns) { if (!put(String(w), 'sa-warn')) { const n = document.createElement('div'); n.className = 'sa-warn'; n.textContent = String(w); wbox.appendChild(n); } }
      wbox.hidden = !wbox.childNodes.length;
      q('.sa-run').disabled = !r.ok;
    }
    function setVal(el){
      const path = el.dataset.path, type = el.dataset.type;
      if (type === 'words' && path.startsWith('texts.')) { st.file.texts[path.slice(6)] = el.value; return false; }
      const { parent, key } = walk(path);
      if (!parent || key == null) return false;
      if (type === 'number' || type === 'integer') { const v = el.value === '' ? NaN : Number(el.value); parent[key] = Number.isFinite(v) ? v : el.value; return false; }
      if (type === 'bool') { parent[key] = !!el.checked; return false; }
      if (type === 'text-key' && el.value === '__new') { const k = freshText(st.file); st.file.texts[k] = ''; parent[key] = k; return true; }
      if (type === 'id') {
        const old = parent[key], v = el.value.trim();
        parent[key] = v;
        if (path.startsWith('objects[') && old && old !== v) renameRefs(old, v);
        return true;
      }
      if (el.value === '') delete parent[key]; else parent[key] = el.value;
      return false;
    }
    // имя объекта поменялось — ссылки на него в правилах тоже (по типам параметров движка, не по названиям)
    function renameRefs(old, v){
      const fix = item => { for (const p of st.M.by.get(item?.b)?.params || []) if (isRef(st.M, p.type) && item[p.id] === old) item[p.id] = v; };
      for (const l of st.file.laws || []) { fix(l.when); (l.if || []).forEach(fix); (l.do || []).forEach(fix); }
      for (const o of st.file.objects || []) fix(o);
    }
    function remove(path){
      if (path.startsWith('texts.')) { delete st.file.texts[path.slice(6)]; return; }
      const { parent, key } = walk(path);
      if (Array.isArray(parent)) parent.splice(key, 1);
    }
    const root_ = q('.sa');
    root_.addEventListener('change', e => {
      const el = e.target;
      if (!st.file) return;
      if (el.matches('.sa-name')) { st.name = el.value.trim() || 'Моя арена'; changed(true); return; }
      if (el.dataset.add) {
        const v = el.value; el.value = ''; if (!v) return;
        const a = el.dataset.add;
        if (a === 'rule') addRule(st.M, st.file, v);
        else if (a === 'object') addObject(st.M, st.file, v);
        else { const [part, li] = a.split(':'); addPart(st.M, st.file, +li, part, v); }
        draw(); changed(true); return;
      }
      if (el.dataset.swap) {
        const { parent, key } = walk(el.dataset.swap);
        if (parent) parent[key] = defaults(st.M, st.file, el.value);
        draw(); changed(true); return;
      }
      if (el.dataset.path) { const redraw = setVal(el); if (redraw) draw(); changed(false); }
    });
    root_.addEventListener('input', e => { const el = e.target; if (st.file && el.dataset.type === 'words') { setVal(el); changed(false); } else if (st.file && el.matches('.sa-name')) { st.name = el.value.trim() || 'Моя арена'; changed(false); } });
    root_.addEventListener('click', e => {
      const t = e.target.closest?.('button'); if (!t || !st.file) return;
      if (t.dataset.del) { remove(t.dataset.del); draw(); changed(true); }
      else if (t.dataset.addlaw) { const lim = st.M.limit('laws')?.value; if (typeof lim === 'number' && st.file.laws.length >= lim) { status('Правил уже ' + lim + ' — это предел движка.', 'warn'); return; } addLaw(st.M, st.file); draw(); changed(true); }
      else if (t.dataset.addtext) { const k = freshText(st.file); st.file.texts[k] = ''; draw(); changed(true); q(`.sa-text input[data-path="texts.${k}"]`)?.focus(); }
      else if (t.dataset.move != null) { const i = +t.dataset.move, j = i + +t.dataset.dir, L = st.file.laws; if (L[i] && L[j]) { [L[i], L[j]] = [L[j], L[i]]; draw(); changed(true); } }
      else if (t.dataset.run) run();
      else if (t.dataset.stop) stop();
      else if (t.dataset.save) io(textOf(st.file), 'save');
      else if (t.dataset.open) io('', 'open');
      else if (t.dataset.ioClose != null) q('.sa-io').hidden = true;
      else if (t.dataset.ioCopy != null) { const ta = q('.sa-io-t'); ta.select(); try { navigator.clipboard?.writeText(ta.value).then(() => status('Текст файла скопирован — сохрани его в заметках или файле.', 'ok'), () => {}); } catch (er) {} }
      else if (t.dataset.ioOk != null) openText(q('.sa-io-t').value);
    });
    q('.sa-io-f').addEventListener('change', e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > (st.M?.limit('file_bytes')?.value || 65536)) { status('Файл больше предела движка.', 'err'); return; } f.text().then(t => { q('.sa-io-t').value = t; }); });
    function io(text, mode){ const box = q('.sa-io'); box.hidden = false; const ta = q('.sa-io-t'); ta.value = text; q('[data-io-ok]').hidden = mode === 'save'; q('[data-io-copy]').hidden = mode !== 'save'; q('.sa-io-f').hidden = mode === 'save'; box.scrollIntoView?.({ block: 'nearest' }); if (mode === 'save') ta.select(); }
    async function openText(text){
      const f = parseFile(text);
      if (!f) { status('⚠ Это не файл режима (не JSON).', 'err'); return; }
      const r = await check(JSON.stringify(f));
      if (!alive()) return;
      st.file = f; q('.sa-io').hidden = true; draw(); changed(true);
      if (!r.ok) status('⚠ Файл открыт, но движок его не принял: ' + String(r.error || ''), 'err');
    }
    // ▶ Проверить: первый раз — движок в рамке; дальше — тот же движок, новый файл, раунд с начала (без перезагрузки)
    async function run(){
      const text = JSON.stringify(st.file);
      const r = await check(text);
      if (!alive()) return;
      st.report = r; showReport();
      if (!r.ok) return;
      q('.sa-stop').hidden = false; q('.sa-cover').hidden = true; q('.sa-run').textContent = '↻ Проверить ещё раз';
      if (st.h) { const a = st.h.runMode(text); if (!a.ok) status('⚠ ' + String(a.error || ''), 'err'); else status('▶ Играем: правила обновлены, раунд заново', 'ok'); return; }
      if (st.hostP) return;
      status('Запускаем движок… (первый раз — дольше)', 'ok');
      st.hostP = (async () => {
        const h = await startEngine(q('.sa-stage'), text, {
          message: m => { if (!alive() || !m) return; if (m.t === 'loaded') { st.running = true; status('▶ Играем на нашем движке', 'ok'); } else if (m.t === 'error') status('⚠ Движок: ' + String(m.msg || m.code || '').slice(0, 200), 'err'); },
          progress: p => { if (alive() && !st.running && p?.phase === 'wasm' && p.total) status(`Загружаем движок… ${Math.round(100 * p.done / p.total)}%`, 'ok'); } });
        if (!alive() || !st.hostP) { h.dispose(); return; }
        st.h = h;
      })().catch(e => { if (alive()) { status('⚠ Движок не запустился: ' + String(e?.message || e).slice(0, 200), 'err'); stop(); } }).finally(() => { if (S === st) st.hostP = null; });
    }
    function stop(){
      st.running = false;
      if (st.h) { try { st.h.dispose(); } catch (e) {} st.h = null; }
      st.hostP = null;
      const s = q('.sa-stage'); if (s) s.textContent = '';
      q('.sa-stop').hidden = true; q('.sa-cover').hidden = false; q('.sa-run').textContent = '▶ Проверить';
      if (st.report) showReport();
    }
    st.stop = stop;
  }
  function unmount(){
    if (!S) return;
    const st = S; S = null; st.dead = true;
    clearTimeout(st.timer);
    if (st.h) { try { st.h.dispose(); } catch (e) {} st.h = null; }
  }
  function css(){
    if (typeof document === 'undefined' || document.getElementById('studio-arena-css')) return;
    const l = document.createElement('link'); l.id = 'studio-arena-css'; l.rel = 'stylesheet'; l.href = 'css/studio-arena.css?v=' + ver();
    document.head.appendChild(l);
  }

  window.D37StudioArena = { mount, unmount, projects, _test: { shareHtml, why, part19, setP19: v => { p19 = v; }, loadRow, index, newFile, defaults, usable, addRule, addObject, addLaw, addPart, refOptions, pathOf, placeFor, sectionsHtml, field, textOf, parseFile, sinceMax, setM: M => { M_ = M; }, state: () => S && { id: S.id, running: S.running, hasHost: !!S.h, report: S.report, file: S.file }, host: () => S?.h || null } };
})();
