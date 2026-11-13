// T-162: проверка в настоящем Chrome (headless, без npm, загрузки запрещены, без входа и без записи в базу).
//  1) лента (MsgView) с сообщением «видео + текст»: правка своего сообщения (меню ⋯ → ✏️) и правка, пришедшая по realtime
//     (строка UPDATE без неизменённого att — как присылает Supabase для TOAST-колонки, через настоящий offMsg из chat.js),
//     закреп, реакции — карточка файла (превью) остаётся, открытое ▶ видео не сбрасывается; удаление убирает сообщение;
//  2) настройки T-162 (community2.js): канал не по возрасту скрыт, значок и «13+» в списке, правила новичку — один раз.
// Запуск из корня сайта: node scripts/t162-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500 — уже запущенный сервер)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t162' : os.tmpdir());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
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
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const L = { d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && !!window.D37Phone && document.readyState === 'complete'`;
// лента с поддельным адаптером: одно своё сообщение с видео (превью) и текстом
const SETUP = `(async () => {
  await D37Phone.need('mv');
  const h = 'ab'.repeat(32);
  const att = { v: 1, enc: 'none', kid: '', name: 'Тихо, тихо, тихо и вдруг .mp4', size: 1038336, mime: 'video/mp4', chash: h, phash: h,
    thumb: 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', w: 640, h: 360, dur: 12 };
  const box = document.createElement('div'); box.id = 'mvt'; box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;display:flex;flex-direction:column';
  document.body.appendChild(box);
  window.__fn = null; window.__edits = [];
  const A = { key: 'test:t162', title: '#тест', maxLen: 500, fileKind: 'chat',
    caps: { reply: true, edit: true, del: true, react: 'count', pin: true, report: false, typing: false, search: false, stickers: false },
    load: async () => ({ list: [{ id: 101, uid: 'u1', nick: 'Денчик37', text: '123', at: new Date().toISOString(), att, reactions: {} }], more: false }),
    sub(fn){ window.__fn = fn; return () => { window.__fn = null; }; },
    send: async () => ({ ok: false, err: 'тест' }), edit: async (m, t) => { window.__edits.push(t); return { ok: true }; }, del: async () => ({ ok: true }),
    react: async () => ({ ok: true }), canPin: () => true, pin: async () => ({ ok: true }),
    state: () => ({ mode: 'write' }), me: () => ({ uid: 'u1', nick: 'Денчик37' }) };
  // файл «на устройстве» — чтобы можно было ▶ открыть видео
  await D37Files._store.store({ chash: h, name: att.name, mime: 'video/mp4', size: 16, pinned: false, sent: false, used: Date.now(), at: Date.now() }, new Blob([new Uint8Array(16)], { type: 'video/mp4' }));
  window.__v = MsgView.mount(box, { noFocus: true });
  await window.__v.setAdapter(A);
  return !!window.__fn;
})()`;
const CARD = `(() => { const m = document.querySelector('#mvt .mv-m[data-id="101"]'); return m ? { card: !!m.querySelector('.mv-file.mvf-video'), thumb: !!m.querySelector('.mvf-th img, .mvf-th video'), video: !!m.querySelector('.mvf-th video'), ed: !!m.querySelector('.mv-ed'), text: m.querySelector('.mv-text')?.textContent.trim().slice(0, 40), pin: !!m.querySelector('.mv-pin'), reacts: m.querySelector('.mv-reacts')?.textContent || '' } : null; })()`;

(async () => {
  const site = await startSite();
  const B = await chrome();
  try {
    await B.send('Page.navigate', { url: site.base + '/' });
    ok(await B.until(READY, 30000), 'сайт загрузился');
    ok(await B.ev(SETUP), 'лента с поддельным каналом и сообщением «видео + текст»');
    ok(await B.until(`!!document.querySelector('#mvt [data-f="open"]')`, 10000), 'карточка видео: файл на устройстве, есть «▶ Открыть»');
    let c = await B.ev(CARD); ok(c?.card && c.thumb, 'до правки: карточка видео с превью', c);
    await B.ev(`document.querySelector('#mvt [data-f="open"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('#mvt .mvf-th video')`, 5000), '▶ видео открыто (плеер в ленте)');

    // 1. правка своего сообщения через меню ⋯ → ✏️ Изменить → Enter (как владелец на скриншоте)
    await B.ev(`document.querySelector('#mvt .mv-m[data-id="101"] [data-a="more"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('#mvt [data-m="edit"]')`, 3000), 'меню сообщения: есть «✏️ Изменить»');
    await B.ev(`(() => { document.querySelector('#mvt [data-m="edit"]').click(); const i = document.querySelector('#mvt .mv-in'); i.value = '123 — изменено'; i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1; })()`);
    ok(await B.until(`(window.__edits || []).length === 1`, 3000), 'правка ушла в адаптер', await B.ev('window.__edits'));
    await sleep(200);
    c = await B.ev(CARD); ok(c?.card && c.thumb && c.video && c.ed && /изменено/.test(c.text), 'после своей правки: видео-карточка и открытый плеер на месте, «(изменено)»', c);

    // 2. правка пришла по realtime: строка UPDATE БЕЗ att (TOAST) — через настоящий offMsg (chat.js)
    const row = `{ id: 101, user_id: 'u1', nick: 'Денчик37', text: '123', created_at: new Date().toISOString(), edited_at: new Date().toISOString(), deleted: false, is_sticker: false, role: 'user', channel: null }`;
    ok(await B.ev(`typeof offMsg === 'function' && offMsg(${row}).att === undefined`), 'offMsg: нет колонки att в строке → att undefined (не null)');
    await B.ev(`window.__fn({ t: 'upd', m: offMsg(${row}) }), 1`); await sleep(150);
    c = await B.ev(CARD); ok(c?.card && c.thumb && c.video && c.text.startsWith('123'), 'realtime-правка без att: вложение не пропало (баг T-162)', c);
    // 3. закреп и реакции (UPDATE тоже без att)
    await B.ev(`window.__fn({ t: 'upd', m: Object.assign(offMsg(${row}), { pinned: true }) }), 1`); await sleep(100);
    c = await B.ev(CARD); ok(c?.card && c.pin, 'закреп: 📌 и карточка на месте', c);
    await B.ev(`window.__fn({ t: 'upd', m: { id: 101, reactions: { '👍': 2 }, att: undefined } }), 1`); await sleep(100);
    c = await B.ev(CARD); ok(c?.card && /👍/.test(c.reacts) && /2/.test(c.reacts), 'реакции: счётчик и карточка на месте', c);
    // 4. файл прикрепили позже (msg_attach → UPDATE с att) — карточка появляется у сообщения без файла
    await B.ev(`window.__fn({ t: 'ins', m: { id: 102, uid: 'u2', nick: 'друг', text: 'фото', at: new Date().toISOString() } }), 1`); await sleep(100);
    await B.ev(`window.__fn({ t: 'upd', m: { id: 102, att: { v: 1, enc: 'none', kid: '', name: 'a.png', size: 10, mime: 'image/png', chash: '${'cd'.repeat(32)}', phash: '${'cd'.repeat(32)}' } } }), 1`); await sleep(100);
    ok(await B.ev(`!!document.querySelector('#mvt .mv-m[data-id="102"] .mv-file.mvf-image')`), 'att пришёл позже (UPDATE с att) — карточка появилась');
    // 5. удаление
    await B.ev(`window.__fn({ t: 'upd', m: { id: 102, deleted: true } }), 1`); await sleep(100);
    ok(await B.ev(`!document.querySelector('#mvt .mv-m[data-id="102"]')`), 'удалённое сообщение убрано из ленты');
    await B.ev(`window.__v.destroy(), document.getElementById('mvt').remove(), 1`);

    // 6. настройки T-162: значки и возраст каналов, правила новичку (cm_server_get подменён — без базы)
    ok(await B.ev(`D37Phone.need('ds').then(() => !!(window.D37DS?.x?.withExtra && D37DS.x.rulesGate))`), 'community2.js: T-162 подключён');
    const srv = await B.ev(`(async () => {
      const real = D37Phone.rpc;
      D37Phone.rpc = async (fn, a) => fn === 'cm_server_get' ? { data: { ok: true, rules: '1. Без мата\\n2. <b>не</b> HTML', welcome: 'Привет 👋', default_ch: 'memes', manage: false,
        chans: [{ id: 'general', emoji: '', min_age: 0, ok: true }, { id: 'games', emoji: '🎮', min_age: 0, ok: true }, { id: 'lfg', emoji: '', min_age: 13, ok: false }, { id: 'memes', emoji: '😂', min_age: 0, ok: true }] } } : real(fn, a);
      const s = await D37DS.x.withExtra({ official: true, id: '0', channels: [{ id: 'general', name: 'общий', kind: 'text' }, { id: 'games', name: 'игры', kind: 'text' }, { id: 'lfg', name: 'поиск', kind: 'text' }, { id: 'memes', name: 'мемы', kind: 'text' }] }, true);
      D37Phone.rpc = real;
      return { ids: s.channels.map(c => c.id), emoji: s.channels.find(c => c.id === 'games')?.emoji, def: s.default_ch, rules: s.rules, ext: s.ext };
    })()`);
    ok(srv.ids.join() === 'general,games,memes' && srv.emoji === '🎮' && srv.def === 'memes' && srv.ext, 'канал не по возрасту скрыт, значок и канал по умолчанию пришли', srv);
    await B.ev(`localStorage.removeItem('d37_ds_rules'); D37DS.x.rulesGate({ official: true, id: '0', ext: true, rules: ${JSON.stringify('1. Без мата\n2. <b>не</b> HTML')}, welcome: 'Привет 👋' }); 1`);
    ok(await B.until(`!!document.querySelector('.ds4-sh .ds-rules')`, 3000), 'новичку показаны правила');
    const sh = await B.ev(`({ txt: document.querySelector('.ds4-sh .ds-rules').textContent, b: !!document.querySelector('.ds4-sh .ds-rules b'), wel: document.querySelector('.ds4-sh .ds-wel')?.textContent })`);
    ok(sh.txt.includes('<b>не</b>') && !sh.b && sh.wel === 'Привет 👋', 'правила — текстом (разметка не исполняется), приветствие видно', sh);
    await B.ev(`document.querySelector('.ds4-sh [data-v="ok"]').click(), 1`); await sleep(100);
    await B.ev(`D37DS.x.rulesGate({ official: true, id: '0', ext: true, rules: ${JSON.stringify('1. Без мата\n2. <b>не</b> HTML')}, welcome: 'Привет 👋' }); 1`); await sleep(200);
    ok(await B.ev(`!document.querySelector('.ds4-sh')`), 'второй раз правила не показываются');
    ok(!B.errs.length, 'исключений на странице нет', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'сбой: ' + e.message); }
  await B.close(); site.stop();
  console.log(fails ? `t162-e2e: ${fails}/${n} FAIL` : `t162-e2e: ${n} ok`);
  process.exit(fails ? 1 : 0);
})();
