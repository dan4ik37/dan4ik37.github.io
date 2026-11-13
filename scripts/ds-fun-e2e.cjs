// T-164 ds-fun: проверка в настоящем Chrome (headless, без npm, загрузки запрещены, без входа и без записи в базу — cf_* подменены).
//  эмодзи / стикеры сервера в ленте (только data:image и только проверенные), ✨ у поля ввода, :имя: → :ce_<id>: при отправке,
//  карточка «Играть вместе: Долина D37», звуковая панель в голосовом, экран «🎉 Фишки сервера» (уровни, годовщина), «с чего начать»
//  новичку один раз, метки в карточках обзора 🧭; чужой текст (ники, метки, имена) — только текстом.
// Запуск из корня сайта: node scripts/ds-fun-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500 — уже запущенный сервер)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/ds/fun' : os.tmpdir());
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
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// подмена cf_* (база не нужна): эмодзи 5 «pog», стикер 6, звук 7; 8 — «картинка» svg (должна отброситься), 9 — кавычка в data
const MOCK = `(() => {
  const PNG = ${JSON.stringify(PNG)}, SND = 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAAA=';
  const list = [{ id: 5, kind: 'emoji', name: 'pog', status: 'ok', data: PNG }, { id: 6, kind: 'sticker', name: 'wow', status: 'ok' }, { id: 7, kind: 'sound', name: 'boom', status: 'ok', dur: 900 }];
  const media = { 5: list[0], 6: { id: 6, kind: 'sticker', name: 'wow', data: PNG }, 7: { id: 7, kind: 'sound', name: 'boom', data: SND, dur: 900 },
    8: { id: 8, kind: 'emoji', name: 'evil', data: 'data:image/svg+xml;base64,PHN2Zz4=' }, 9: { id: 9, kind: 'emoji', name: 'q', data: 'data:image/png;base64,AA"onerror="alert(1)' } };
  window.__calls = [];
  const real = window.__realRpc = window.__realRpc || D37Phone.rpc;
  D37Phone.rpc = async (fn, a) => {
    if (!/^cf_/.test(fn)) return real(fn, a);
    window.__calls.push(fn);
    if (fn === 'cf_media_list') return { data: { ok: true, manage: false, list } };
    if (fn === 'cf_media_get') return { data: (a.p_ids || []).map(i => media[i]).filter(Boolean) };
    if (fn === 'cf_server_get') return { data: { ok: true, manage: false, levels: true, start_chs: ['general', 'memes'], tags: [], stage_chs: [],
      me: { xp: 130, level: 5, next: 180, since: new Date(Date.now() - 400 * 864e5).toISOString() } } };
    if (fn === 'cf_levels_top') return { data: { ok: true, list: [{ uid: 'u1', nick: '<img src=x onerror=alert(1)>', xp: 130, level: 5, since: new Date(Date.now() - 400 * 864e5).toISOString() }] } };
    if (fn === 'cf_tags') return { data: [{ id: 7, tags: ['майнкрафт', '<b>x</b>'] }] };
    if (fn === 'cf_stage_get') return { data: { ok: true, stage: false } };
    return { data: { ok: false, reason: 'rights' } };
  };
  return true;
})()`;

(async () => {
  const site = await startSite();
  const B = await chrome();
  try {
    await B.send('Page.navigate', { url: site.base + '/' });
    ok(await B.until(READY, 30000), 'сайт загрузился');
    ok(await B.ev(`D37Phone.need('ds').then(() => !!(window.D37DsFun && D37DS.x.voiceMore && D37DS.x.sub.fun && MsgView.emojiHook))`), 'ds-fun.js подключён через MODS.ds (крючки на месте)');
    ok(await B.ev(`!!document.querySelector('link[data-dsfun]')`), 'css/ds-fun.css подключён');
    await B.ev(MOCK);

    // 1. эмодзи и стикеры сервера в ленте
    const r = await B.ev(`(() => { const a = MsgView.rich('привет :ce_5: и :ce_8: :ce_9: :pog:'), b = MsgView.rich(':stk_6:'); return { a: a.html, big: b.big }; })()`);
    ok(/data-dsf="5"/.test(r.a) && /data-dsf="8"/.test(r.a) && r.big, ':ce_<id>: и :stk_<id>: превращаются в картинки; стикер — крупно', r);
    await B.ev(`(() => { const d = document.createElement('div'); d.id = 'emt'; d.innerHTML = MsgView.rich('привет :ce_5: и :ce_8: :ce_9:').html + MsgView.rich(':stk_6:').html; document.body.appendChild(d); return 1; })()`);
    ok(await B.until(`document.querySelector('#emt img[data-dsf="5"]')?.src.startsWith('data:image/png')`, 4000), 'картинка эмодзи догружена пачкой (cf_media_get)');
    const em = await B.ev(`({ svg: !!document.querySelector('#emt img[data-dsf="8"]'), q: !!document.querySelector('#emt img[data-dsf="9"]'), txt: document.getElementById('emt').textContent, stk: document.querySelector('#emt img.dsf-stk')?.src.slice(0, 15), on: !!document.querySelector('#emt [onerror]') })`);
    ok(!em.svg && !em.q && /:ce_8:/.test(em.txt) && !em.on, 'svg и «кавычка» в data отброшены — остаётся текст, обработчиков нет', em);
    ok(em.stk === 'data:image/png;', 'стикер показан', em);
    await B.ev(`document.getElementById('emt').remove(), 1`);

    // 2. лента с адаптером сервера: ✨ у поля ввода, :pog: → :ce_5:, «Играть вместе» и карточка Долины
    const setup = await B.ev(`(async () => {
      const box = document.createElement('div'); box.id = 'mvt'; box.className = 'ds-mv'; box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;display:flex;flex-direction:column';
      document.body.appendChild(box); window.__sent = [];
      const A0 = { key: 'test:fun', title: '#тест', maxLen: 500,
        caps: { reply: true, edit: true, del: true, react: 'count', pin: false, report: false, typing: false, search: false, stickers: false },
        load: async () => ({ list: [], more: false }), sub(fn){ window.__fn = fn; return () => {}; },
        send: async t => { window.__sent.push(t); return { ok: true }; }, edit: async () => ({ ok: true }), del: async () => ({ ok: true }), react: async () => ({ ok: true }),
        state: () => ({ mode: 'write' }), me: () => ({ uid: 'u1', nick: 'я' }) };
      const srv = { official: false, id: 7, name: 'клуб', channels: [{ id: 70, name: 'чат', kind: 'text' }] };
      const A = D37DS.x.wrapAdapter(A0, srv, srv.channels[0]);
      window.__v = MsgView.mount(box, { noFocus: true }); await window.__v.setAdapter(A);
      await new Promise(r => setTimeout(r, 300));
      await A.send('смотри :pog: и :nope:');
      return { sent: window.__sent[0] };
    })()`);
    ok(setup.sent === 'смотри :ce_5: и :nope:', 'при отправке :pog: стал :ce_5:, чужое имя не тронуто', setup);
    ok(await B.until(`!!document.querySelector('#mvt .dsf-btn')`, 3000), '✨ у поля ввода');
    await B.ev(`document.querySelector('#mvt .dsf-btn').click(), 1`);
    ok(await B.until(`!!document.querySelector('#mvt .dsf-pop [data-ins=":pog:"]') && !!document.querySelector('#mvt .dsf-pop [data-fstk="6"]')`, 3000), 'панель ✨: эмодзи и стикеры сервера, «🎮 Играть вместе»');
    await B.ev(`document.querySelector('#mvt .dsf-pop [data-f="play"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('.dsf-sh [data-v="hub"]')`, 3000), '«Во что играем вместе?» — Долина D37 и игры сайта');
    ok(await B.ev(`document.querySelectorAll('.dsf-sh .dsf-g').length >= 3`), 'список игр есть', await B.ev(`document.querySelectorAll('.dsf-sh .dsf-g').length`));
    await B.ev(`document.querySelector('.dsf-sh [data-v=""]').click(), 1`);
    const card = await B.ev(`(() => { const r = MsgView.rich('🎮 Играем вместе https://dan4ik37.vercel.app/hub/play'); return { n: r.cards.length, h: r.cards[0] ? MsgView.cardHtml(r.cards[0]) : '' }; })()`);
    ok(card.n === 1 && /Долина D37/.test(card.h) && /href="\/hub\/play"/.test(card.h), 'ссылка /hub/play в ленте — карточка «▶ Войти»', card);
    await B.ev(`window.__v.destroy(), document.getElementById('mvt').remove(), 1`);

    // 3. голосовой: звуковая панель (не в голосовом — кнопки выключены)
    await B.ev(`(() => { const h = document.createElement('div'); h.id = 'vt'; document.body.appendChild(h); D37DS.x.voiceMore(h, { official: false, id: 7, name: 'клуб' }, { id: 71, name: 'голос', kind: 'voice' }); return 1; })()`);
    ok(await B.until(`!!document.querySelector('#vt .dsf-pad[data-id="7"]')`, 4000), 'звуковая панель: звук сервера');
    ok(await B.ev(`document.querySelector('#vt .dsf-pad').disabled && !!document.querySelector('#vt [data-fv="vol"]')`), 'вне голосового звук не играет; громкость — своя');
    await B.ev(`document.querySelector('#vt [data-fv="off"]').click(), 1`); await sleep(300);
    ok(await B.ev(`JSON.parse(localStorage.getItem('d37_ds_sb')).off === true`), '«звуки выкл.» запоминается у человека');
    await B.ev(`document.getElementById('vt').remove(), 1`);

    // 4. экран «🎉 Фишки сервера»: уровень, годовщина, топ (ник — текстом)
    await B.ev(`(async () => { const el = document.createElement('div'); el.id = 'ft'; document.body.appendChild(el); await D37DS.x.sub.fun.render(el, 'page', { official: false, id: 7, name: 'клуб', channels: [] }, ['lv']); await new Promise(r => setTimeout(r, 300)); return 1; })()`);
    const lv = await B.ev(`({ me: document.querySelector('#ft .dsf-me')?.textContent || '', top: document.querySelector('#ft .dsf-trow span')?.textContent || '', img: !!document.querySelector('#ft .dsf-trow img'), tabs: document.querySelectorAll('#ft .ds-chips a').length })`);
    ok(/уровень: 5/.test(lv.me) && /1 год/.test(lv.me), 'мой уровень и значок «🎂 1 год на сервере»', lv);
    ok(lv.top.includes('<img') && !lv.img, 'ник в топе — текстом (разметка не исполняется)', lv);
    ok(lv.tabs === 2, 'участнику — 2 вкладки (без настроек и проверки)', lv);
    await B.ev(`document.getElementById('ft').remove(), 1`);

    // 5. «с чего начать» — один раз
    await B.ev(`localStorage.removeItem('d37_ds_start'); localStorage.setItem('d37_ds_rules', '{}'); D37DS.x.rulesGate({ official: true, id: '0', channels: [{ id: 'general', name: 'общий', kind: 'text' }, { id: 'memes', name: '<b>мемы</b>', kind: 'text' }] }); 1`);
    ok(await B.until(`!!document.querySelector('.dsf-sh .dsf-start')`, 4000), '👋 «С чего начать» — новичку');
    const st = await B.ev(`({ n: document.querySelectorAll('.dsf-sh .dsf-start a').length, b: !!document.querySelector('.dsf-sh .dsf-start b'), t: document.querySelector('.dsf-sh .dsf-start').textContent })`);
    ok(st.n === 2 && !st.b && st.t.includes('<b>мемы</b>'), 'два канала, имя — текстом', st);
    await B.ev(`document.querySelectorAll('.ds4-sh').forEach(x => x.remove()); D37DS.x.rulesGate({ official: true, id: '0', channels: [{ id: 'general', name: 'общий', kind: 'text' }, { id: 'memes', name: '<b>мемы</b>', kind: 'text' }] }); 1`); await sleep(500);
    ok(await B.ev(`!document.querySelector('.dsf-start')`), 'второй раз не показывается');

    // 6. метки в карточке обзора 🧭
    await B.ev(`(() => { const d = document.createElement('div'); d.id = 'cc'; d.innerHTML = D37DS.x.ccard({ id: 7, name: 'клуб', icon: '🎮', members: 12, about: '' }, 'page'); document.body.appendChild(d); return 1; })()`);
    ok(await B.until(`document.querySelectorAll('#cc .dsf-tags span').length === 2`, 4000), 'метки пришли пачкой (cf_tags)');
    const tg = await B.ev(`({ t: document.querySelector('#cc .dsf-tags').textContent, b: !!document.querySelector('#cc .dsf-tags b'), m: /👥 12/.test(document.getElementById('cc').textContent) })`);
    ok(tg.t.includes('#майнкрафт') && !tg.b && tg.m, 'метки текстом, число участников на карточке', tg);
    await B.ev(`document.getElementById('cc').remove(), 1`);
    // 7. значок годовщины
    const an = await B.ev(`[D37DS.x.annivBadge(new Date(Date.now() - 800 * 864e5).toISOString()), D37DS.x.annivBadge(new Date(Date.now() - 40 * 864e5).toISOString()), D37DS.x.annivBadge(new Date().toISOString())].join('|')`);
    ok(/🎂 2 года/.test(an) && /🌱 1 мес/.test(an) && /новичок/.test(an), 'годовщина: 🎂 годы, 🌱 месяцы, 🐣 новичок', an);
    ok(!B.errs.length, 'исключений на странице нет', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'сбой: ' + e.message); }
  await B.close(); site.stop();
  console.log(fails ? `ds-fun-e2e: ${fails}/${n} FAIL` : `ds-fun-e2e: ${n} ok`);
  process.exit(fails ? 1 : 0);
})();
