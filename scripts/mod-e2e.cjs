// T-164 ds-mod: 🛡 центр модерации в настоящем Chrome (headless, без npm, загрузки запрещены, без входа и без записи в базу —
// ответы сервера mod_* подменены). Проверяет: меню разделов, обзор, жалобы (статусы, снимок переписки, «в работу», «нарушение»
// с удалением), чужой текст — только текстом, участники (поиск, карточка, заметка), журнал с фильтром, запасной путь без ч. 11,
// лист на весь экран на телефоне, нет «🚩 Пожаловаться» на своём сообщении / у создателя и 🚩 на своём файле.
// Запуск из корня сайта: node scripts/mod-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500 — уже запущенный сервер)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/ds/mod' : os.tmpdir());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}
async function chrome(){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9600 + Math.floor(Math.random() * 600), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const L = { d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && !!window.D37Phone && document.readyState === 'complete'`;
const XSS = '<img src=x onerror="window.__xss=1">';
// подмена сервера: mod_* отвечают как ч. 11; всё, что вызвали, — в window.__calls
const STUB = `(() => {
  window.__real = window.__real || D37Phone.rpc; window.__calls = []; window.__missing = false;
  const X = ${JSON.stringify(XSS)};
  const rep = { kind: 'chat', key: 501, mid: 501, cid: null, cname: '', channel: 'general', author: X, target: 'u9', text: 'плохое ' + X, n: 2, reasons: 'Спам · ' + X, at: new Date().toISOString(), state: 'new', by_nick: null, hidden: false, to_owner: false,
    ctx: [{ id: 499, nick: 'вася', text: 'привет' }, { id: 500, nick: X, text: 'ну' }, { id: 501, nick: X, text: 'плохое' }] };
  const file = { kind: 'file', key: 7, mid: 600, cid: null, cname: '', channel: 'chat', author: 'петя', target: 'u8', text: '', n: 1, reasons: '', at: new Date().toISOString(), state: 'work', by_nick: 'модер', att: { name: X + '.png', mime: 'image/png', size: 2048 } };
  D37Phone.rpc = async (fn, a) => {
    window.__calls.push([fn, a]);
    if (window.__missing && fn.startsWith('mod_')) return { data: null, error: { message: 'missing' }, missing: true };
    const R = {
      mod_overview: { ok: true, new: 3, work: 1, files: 1, owner: 2, joins10: 9, automod10: 2, muted: 1, raid_until: null, raid_hint: true, log: [{ action: 'mute', actor_nick: 'модер', target_nick: X, reason: X, detail: '', at: new Date().toISOString() }] },
      mod_reports: { ok: true, list: a.p_kind === 'file' ? [file] : [rep, file] },
      mod_report_set: { ok: true, n: 2 },
      mod_members: { ok: true, list: [{ id: 'u9', nick: X, role: null, muted_until: new Date(Date.now() + 3600e3).toISOString(), notes: 1, strikes: 2 }, { id: 'u8', nick: 'петя', role: 'helper' }] },
      mod_member: { ok: true, can: true, notes: [{ id: 1, text: X, by: 'модер', mine: true, at: new Date().toISOString() }], log: [{ action: 'warn', by: 'модер', reason: 'спам', at: new Date().toISOString() }] },
      mod_note_add: { ok: true, id: 2 },
      mod_log: { ok: true, list: [{ id: 9, action: 'report_done', actor_nick: 'модер', target_nick: 'вася', reason: '', detail: '', at: new Date().toISOString() }] },
      mod_cfg_get: { ok: true, cfg: { words: ['казино'], newslow: 30 }, raid_until: null, can: true },
      cm_automod_get: { ok: true, cfg: {}, can: true },
      cm_modlog: { ok: true, list: [] },
    }[fn];
    return R ? { data: R, error: null } : window.__real(fn, a);
  };
  return true;
})()`;
const SRV = `{ official: true, id: D37DS.OFF_ID, staff: 'admin', name: 'Денчик37', channels: [{ id: 'general', name: 'общий', kind: 'text' }] }`;
const MOUNT = (sect, w) => `(async () => {
  document.getElementById('mdt')?.remove();
  const box = document.createElement('div'); box.id = 'mdt'; box.style.cssText = 'position:fixed;inset:0;z-index:99990;overflow:auto;background:#111;width:${w || 1280}px';
  document.body.appendChild(box);
  await D37Mod.hub(box, 'page', ${SRV}, ${JSON.stringify(sect ? sect.split('/') : [])});
  return true;
})()`;

(async () => {
  const site = await startSite();
  const B = await chrome();
  try {
    await B.send('Page.navigate', { url: site.base + '/' });
    ok(await B.until(READY, 90000), "сайт загрузился");
    ok(await B.ev(`D37Phone.need('ds').then(() => !!window.D37Mod && D37DS.x.sub.reports.title === '🛡 Модерация' && !!D37DS.x.sub.settings && typeof D37DS.screenSettings === 'function')`), 'ds-mod.js загружен: 🛡 и ⚙️ открывают центр, screenSettings доступен');
    ok(await B.until(`!!document.querySelector('link[data-dsmod]')`, 3000), 'css/ds-mod.css подключён');
    ok(await B.ev(STUB), 'ответы сервера подменены');

    // 1. обзор
    await B.ev(MOUNT(''));
    ok(await B.until(`document.querySelectorAll('#mdt .dm-ni').length === 10`, 5000), 'меню: 10 разделов для админа сайта', await B.ev(`[...document.querySelectorAll('#mdt .dm-ni span')].map(x => x.textContent)`));
    ok(await B.until(`document.querySelectorAll('#mdt .dm-tile').length >= 6`, 5000), 'обзор: плитки (жалобы, файлы, на команду, новички, автомод, тайм-ауты)');
    let o = await B.ev(`({ first: document.querySelector('#mdt .dm-tile b')?.textContent, owner: [...document.querySelectorAll('#mdt .dm-tile span')].some(s => /на команду/.test(s.textContent)), hint: !!document.querySelector('#mdt .dm-alert'), badge: document.querySelector('#mdt .dm-badge')?.textContent, log: document.querySelector('#mdt .ds4-log')?.textContent || '' })`);
    ok(o.first === '3' && o.owner && o.hint && o.badge === '5' && o.log.includes('<img'), 'обзор: 3 новых, 👑 на команду, подсказка «похоже на рейд», значок 5, журнал текстом', o);
    await B.ev(`document.querySelector('#mdt .dm-alert [data-raid]').click(), 1`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_raid' && c[1].p_minutes === 30 && c[1].p_cid === null)`, 3000), '🛡 «Защита на 30 мин» → mod_raid(null, 30)');

    // 2. жалобы
    await B.ev(MOUNT('reports'));
    ok(await B.until(`document.querySelectorAll('#mdt .dm-rep').length === 2`, 5000), 'жалобы: сообщение и файл одним списком');
    o = await B.ev(`({ st: document.querySelector('#mdt .dm-rep .dm-st')?.textContent, ctx: document.querySelectorAll('#mdt .dm-ctx div').length, hit: !!document.querySelector('#mdt .dm-ctx .dm-hit'), by: document.querySelectorAll('#mdt .dm-by').length, scopes: [...document.querySelectorAll('#mdt [data-sc]')].map(b => b.dataset.sc).join() })`);
    ok(/новая/.test(o.st) && o.ctx === 3 && o.hit && o.by === 1 && o.scopes === 'here,all,owner', 'статус, снимок переписки (3, само выделено), «взял: модер», разделы сайт / сообщества / 👑 на команду', o);
    await B.ev(`document.querySelector('#mdt [data-ra="work"]').click(), 1`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_report_set' && c[1].p_state === 'work' && c[1].p_kind === 'chat' && c[1].p_key === 501)`, 3000), '🙋 В работу → mod_report_set(chat, 501, work)');
    await sleep(300);
    await B.ev(`document.querySelector('#mdt [data-ra="done"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('.ds4-sh [data-pick="delete"]')`, 3000), '✅ Нарушение… → лист с «🗑 Удалить сообщение»');
    await B.ev(`(() => { document.querySelector('.ds4-sh [data-f="reason"]').value = 'спам'; document.querySelector('.ds4-sh [data-v="go"]').click(); return 1; })()`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_report_set' && c[1].p_state === 'done' && c[1].p_action === 'delete' && c[1].p_note === 'спам')`, 3000), 'готово + удалить + заметка → mod_report_set(done, delete, «спам»)');
    await sleep(300);
    await B.ev(`document.querySelector('#mdt [data-sc="owner"]').click(), 1`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_reports' && c[1].p_scope === 'owner')`, 3000), '👑 На команду → mod_reports(scope owner)');
    await sleep(200);
    await B.ev(`document.querySelector('#mdt [data-st="rejected"]').click(), 1`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_reports' && c[1].p_state === 'rejected')`, 3000), 'фильтр «❌ Отклонено» → mod_reports(state rejected)');
    ok(await B.ev(`!window.__xss && !document.querySelector('#mdt img[src="x"]')`), 'чужие ники, текст, причины, имя файла — текстом (разметка не исполняется)');

    // 3. файлы
    await B.ev(MOUNT('files'));
    ok(await B.until(`__calls.some(c => c[0] === 'mod_reports' && c[1].p_kind === 'file') && document.querySelectorAll('#mdt .dm-rep').length === 1`, 5000), '📎 Файлы: только жалобы на файлы');
    await B.ev(`document.querySelector('#mdt [data-ra="done"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('.ds4-sh [data-pick="block"]')`, 3000), 'файл: «⛔ Запретить файл» для админа');
    await B.ev(`document.querySelector('.ds4-sh [data-v=""]').click(), 1`);

    // 4. участники и карточка
    await B.ev(MOUNT('members'));
    ok(await B.until(`document.querySelectorAll('#mdt .dm-mem').length === 2`, 5000), 'участники: список (тайм-аут, заметки, предупреждения — метками)');
    await B.ev(`(() => { const i = document.querySelector('#mdt [data-q]'); i.value = 'пе'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_members' && c[1].p_q === 'пе')`, 3000), 'поиск по нику → mod_members(q)');
    await B.ev(`document.querySelector('#mdt [data-mf="banned"]').click(), 1`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_members' && c[1].p_filter === 'banned')`, 3000), 'фильтр «⛔ Баны»');
    await sleep(300);
    await B.ev(`document.querySelector('#mdt .dm-mem').click(), 1`);
    ok(await B.until(`!!document.querySelector('.dm-card [data-ca="mute"]') && !!document.querySelector('.dm-card [data-ca="siteban"]')`, 4000), 'карточка: ⚠️ ⏳ 🔊 🔨 ✅ и заметки');
    await B.ev(`(() => { const i = document.querySelector('.dm-card [data-note]'); i.value = 'уже предупреждали'; document.querySelector('.dm-card [data-ca="note"]').click(); return 1; })()`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_note_add' && c[1].p_text === 'уже предупреждали' && c[1].p_user === 'u9')`, 3000), 'заметка → mod_note_add');
    await B.ev(`document.querySelector('.dm-card [data-ca="mute"]').click(), 1`);
    ok(await B.until(`document.querySelectorAll('.ds4-sh').length === 2 && !!document.querySelector('.ds4-sh:last-child [data-pick="1440"]')`, 3000), '⏳ Тайм-аут: срок и причина');
    await B.ev(`(() => { const s = document.querySelectorAll('.ds4-sh')[1]; s.querySelector('[data-pick="1440"]').click(); s.querySelector('[data-chip="Флуд"]').click(); s.querySelector('[data-v="go"]').click(); return 1; })()`);
    ok(await B.until(`__calls.some(c => c[0] === 'chat_mod' && c[1].p_action === 'mute' && c[1].p_minutes === 1440 && c[1].p_reason === 'Флуд')`, 3000), 'тайм-аут на день с причиной → chat_mod (журнал и сервер)');
    await B.ev(`document.querySelectorAll('.dm-cardsh').forEach(x => x.remove()), 1`);

    // 5. журнал
    await B.ev(MOUNT('log'));
    ok(await B.until(`!!document.querySelector('#mdt .ds4-li')`, 4000), 'журнал: записи');
    await B.ev(`document.querySelector('#mdt [data-lg="punish"]').click(), 1`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_log' && c[1].p_group === 'punish')`, 3000), 'фильтр «⏳ Наказания» → mod_log(punish)');
    // 6. автомод: слова и 🐢
    await B.ev(MOUNT('automod'));
    ok(await B.until(`document.querySelector('#mdt [data-w]')?.value === 'казино' && document.querySelector('#mdt [data-ns]')?.value === '30'`, 4000), 'автомод: запрещённые слова и 🐢 новичкам');
    await B.ev(`(() => { document.querySelector('#mdt [data-w]').value = 'казино, ставки'; document.querySelector('#mdt [data-amx="save"]').click(); return 1; })()`);
    ok(await B.until(`__calls.some(c => c[0] === 'mod_cfg_set' && c[1].p_cfg.words.join() === 'казино,ставки')`, 3000), '💾 → mod_cfg_set(words)');

    // 7. без ч. 11 на сервере — старые экраны внутри центра
    await B.ev(`window.__missing = true, 1`);
    await B.ev(MOUNT('reports'));
    ok(await B.until(`!!document.querySelector('#mdt .dm-legacy')`, 4000), 'нет ч. 11 → старый список жалоб внутри центра');
    await B.ev(`window.__missing = false, 1`);

    // 8. телефон: лист на весь экран, разделы — полоской
    await B.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    await sleep(200);
    await B.ev(MOUNT('overview', 412));
    ok(await B.until(`!!document.querySelector('#mdt .dm-hub.dm-sheet.dm-narrow')`, 4000), 'узкий экран: лист на весь экран');
    o = await B.ev(`(() => { const h = document.querySelector('#mdt .dm-hub'), r = h.getBoundingClientRect(), nav = document.querySelector('#mdt .dm-nav'); return { pos: getComputedStyle(h).position, w: Math.round(r.width), navRow: getComputedStyle(nav).flexDirection, x: !!document.querySelector('#mdt .dm-x'), sw: document.documentElement.scrollWidth }; })()`);
    ok(o.pos === 'fixed' && o.w === 412 && o.navRow === 'row' && o.x && o.sw <= 412, 'лист: fixed, во всю ширину, разделы в ряд, ✕, без прокрутки вбок', o);

    // 9. жалобы: на себя и на создателя кнопки нет; 🚩 на своём файле нет
    o = await B.ev(`(() => { currentUser = { id: 'me1' }; const me = MsgView.noReport({ uid: 'me1' }), adm = MsgView.noReport({ uid: 'x', role: 'admin' }), other = MsgView.noReport({ uid: 'x', role: 'user' });
      const att = { v: 1, enc: 'none', kid: '', name: 'a.png', size: 10, mime: 'image/png', chash: '${'ab'.repeat(32)}', phash: '${'ab'.repeat(32)}' };
      return { me, adm, other, own: D37Files.cardHtml(att, { id: 1, uid: 'me1' }, 'chat').includes('data-fself'), foreign: D37Files.cardHtml(att, { id: 2, uid: 'x' }, 'chat').includes('data-fself') }; })()`);
    ok(o.me && o.adm && !o.other && o.own && !o.foreign, 'noReport: своё и создателя — да, чужое — нет; своя карточка файла помечена (без 🚩)', o);
    const menu = await B.ev(`(async () => {
      await D37Phone.need('mv');
      const box = document.createElement('div'); box.id = 'mvt'; box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;display:flex;flex-direction:column'; document.body.appendChild(box);
      const A = { key: 'test:mod', title: '#тест', maxLen: 500, caps: { reply: false, edit: false, del: false, react: false, pin: false, report: true, typing: false, search: false, stickers: false },
        load: async () => ({ list: [{ id: 1, uid: 'adm', nick: 'Денчик37', role: 'admin', text: 'я создатель', at: new Date().toISOString() }, { id: 2, uid: 'me1', nick: 'я', text: 'моё', at: new Date().toISOString() }, { id: 3, uid: 'x', nick: 'вася', text: 'чужое', at: new Date().toISOString() }], more: false }),
        sub(){ return () => {}; }, state: () => ({ mode: 'read' }), me: () => ({ uid: 'me1', nick: 'я' }), report: async () => ({ ok: true }) };
      const v = MsgView.mount(box, { noFocus: true }); await v.setAdapter(A); await new Promise(r => setTimeout(r, 300));
      const has = id => { document.querySelector('#mvt .mv-m[data-id="' + id + '"] [data-a="more"]').click(); const r = !!document.querySelector('#mvt [data-m="report"]'); document.body.click(); return r; };
      const out = { adm: has(1), mine: has(2), other: has(3) };
      v.destroy(); box.remove();
      return out;
    })()`);
    ok(!menu.adm && !menu.mine && menu.other, 'меню сообщения: «🚩 Пожаловаться» нет у создателя и у своего, есть у чужого', menu);
    ok(!B.errs.length, 'исключений на странице нет', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'сбой: ' + e.message); }
  await B.close(); site.stop();
  console.log(fails ? `mod-e2e: ${fails}/${n} FAIL` : `mod-e2e: ${n} ok`);
  process.exit(fails ? 1 : 0);
})();
