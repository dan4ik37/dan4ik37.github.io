// T-141 📎 files.js: список типов и проверка по первым байтам (при отправке и при приёме), имена, размер — без браузера (vm).
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'files.js'), 'utf8');
const ctx = { console, setTimeout, clearTimeout, performance, TextDecoder, Uint8Array, DataView, crypto: globalThis.crypto, addEventListener(){}, matchMedia: () => ({ matches: false }) };
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const F = ctx.D37Files, T = F._test;
let n = 0, bad = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
const B = (...a) => new Uint8Array([...a.flatMap(x => typeof x === 'string' ? [...x].map(c => c.charCodeAt(0)) : [x]), ...new Array(32).fill(0x20)]);
ok(T.sniff(B(0x89, 'PNG'), 'image/png'), 'png');
ok(!T.sniff(B('MZ'), 'image/png'), 'exe renamed .png refused');
ok(T.sniff(B(0xFF, 0xD8, 0xFF), 'image/jpeg'), 'jpeg');
ok(T.sniff(B('RIFF', 0, 0, 0, 0, 'WEBP'), 'image/webp'), 'webp');
ok(T.sniff(B('%PDF-1.7'), 'application/pdf'), 'pdf');
ok(T.sniff(B(0x50, 0x4B, 3, 4), 'application/zip'), 'zip');
ok(T.sniff(B('hello world'), 'text/plain'), 'txt');
ok(!T.sniff(B('<html><script>alert(1)</script>'), 'text/plain'), 'html as txt refused');
ok(!T.sniff(B('<svg onload=x>'), 'text/plain'), 'svg as txt refused');
ok(!T.sniff(B('ok', 0, 'bin'), 'text/plain'), 'binary as txt refused');
ok(T.sniff(B(0, 0, 0, 0x18, 'ftypmp42'), 'video/mp4'), 'mp4');
ok(!F.typeOk('a.svg', 'image/svg+xml') && !F.typeOk('a.html', 'text/html') && !F.typeOk('a.exe', 'application/octet-stream'), 'svg / html / exe not in list');
ok(!F.typeOk('a.png', 'image/jpeg') && F.typeOk('a.JPG', 'image/jpeg'), 'extension must match type');
ok(T.mimeOf('song.mp3') === 'audio/mpeg' && T.mimeOf('x.js') === '', 'type by extension');
ok(F.cleanName('../../etc/<x>.png') === '.._.._etc__x_.png' && F.cleanName('') === 'file', 'names cleaned', F.cleanName('../../etc/<x>.png'));
ok(F.size(1536) === '2 КБ' && F.size(5 * 1048576) === '5,0 МБ' && F.size(20 * 1048576) === '20 МБ', 'sizes');
ok(F.cardHtml({ chash: 'zz' }) === '' && !F.cardHtml({ chash: 'a'.repeat(64), name: '<img onerror=1>', mime: 'image/png', size: 1, thumb: 'javascript:1' }).includes('<img onerror') && !F.cardHtml({ chash: 'a'.repeat(64), name: 'x', mime: 'image/png', size: 1, thumb: 'javascript:1' }).includes('javascript:'), 'card escapes name, drops non-data thumb');
// T-160: HEIC / MOV (телефон), строка состояния, повторы с причиной, личные пределы (владелец), приём файлов владельца
ok(T.sniff(B(0, 0, 0, 0x18, 'ftypheic'), 'image/heic') && T.sniff(B(0, 0, 0, 0x14, 'ftypqt  '), 'video/quicktime') && F.typeOk('IMG_1.HEIC', 'image/heic') && F.typeOk('v.MOV', 'video/quicktime'), 'iPhone HEIC / MOV');
ok(!T.sniff(B('MZ'), 'image/heic') && T.kind('image/heic') === 'file', 'HEIC sniffed, saved as file (Chrome cannot show it)');
ok(F.ACCEPT.includes('.heic') && F.ACCEPT.includes('.mov') && !F.ACCEPT.includes('audio/*'), 'picker accepts exactly the allowed list');
ok(F.noteText({ note: 'load', pct: 40, kbs: 2048, eta: 12, via: 'relay/relay' }) === 'получаем… 40% · 2,0 МБ/с · ещё ~12 с · через посредник', 'state line: percent, speed, eta, relay', F.noteText({ note: 'load', pct: 40, kbs: 2048, eta: 12, via: 'relay/relay' }));
ok(/не на сайте|нет на сайте/.test(F.noteText({ note: 'nosrc' })) && /попытка 2 из 4/.test(F.noteText({ note: 'retry', fails: 1 })) && F.noteText({ note: 'wait' }) === 'ищем отправителя…', 'waiting / retry texts');
for (const k of ['relaydown', 'noroute', 'noanswer', 'signal', 'srcrelay', 'srcno']) ok(F.WHY[k] && F.WHY[k].length > 30, 'reason has plain text: ' + k);
{ let rej = null; const st = { fails: 0, att: { chash: 'x' }, rej: e => { rej = e; } };
  T.attemptFailed(st, 'noanswer'); T.attemptFailed(st, 'drop'); T.attemptFailed(st, 'drop'); ok(!rej && st.note === 'retry' && st.nextAt > Date.now(), 'three failures: still retrying with backoff');
  T.attemptFailed(st, 'drop'); ok(rej && rej.code === 'noroute' && /Wi-Fi/.test(rej.message), 'fourth failure: stop with reason noroute', rej && rej.code);
  const st2 = { fails: 0, att: { chash: 'y' }, rej: e => { rej = e; } }; rej = null; T.attemptFailed(st2, 'relaydown'); ok(rej && rej.code === 'relaydown', 'TURN down: stop at once with reason'); }
T.setCfg({ owner: false }); ok(T.recvCap() === 100 * 1048576, 'receiver accepts files up to max_mb (size was checked by the server)');
T.setCfg({ owner: true, file_mb: 100, max_mb: 100, direct_mb: 100 }); ok(F.cfg().owner === true && F.cfg().file_mb === 100, 'owner caps come from file_cfg');
// T-160b (владелец 13.11: «файл не отправился не картинка не звук» в #общий): общий чат сайта (chat.js sendOfficial) не возвращал
// номер сообщения → msg_attach не вызывался, «не отправилось». Здесь — настоящие функции из chat.js с заглушкой базы
(async () => {
  const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10);
  const csrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'chat.js'), 'utf8').split(CRLF).join(NL);
  const cut = (a, b) => { const i = csrc.indexOf(a), j = csrc.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('chat.js: ' + a); return csrc.slice(i, j); };
  const code = cut('async function sendOfficial', 'const CHAT_COLORS') + cut('async function sendMsgToSupabase', NL + '// Ошибки') + cut('function offMsg', NL + '}' + NL) + NL + '}' + NL;
  let inserted = null;
  const cx = { console, chatNick: 'dan4ik37', isChatStaff: () => true, muteUntil: 0, bannedNicks: new Set(), checkRateLimit: () => true, checkSpam: () => '', registerGoodMsg(){}, registerStrike(){}, lastSentText: '',
    chatRow: t => ({ nick: 'dan4ik37', text: t, role: 'admin', user_id: 'u1' }), chatHasNew: () => true, chatSendError: e => 'ERR ' + (e && e.message), navigator: {},
    sbClient: { from: () => ({ insert: rows => { inserted = rows[0]; const q = Promise.resolve({ data: null, error: null }); q.select = () => Promise.resolve({ data: [Object.assign({ id: 41, created_at: '2026-11-13T01:11:00Z' }, rows[0])], error: null }); return q; } }) } };
  vm.createContext(cx); vm.runInContext(code + 'this.sendOfficial = sendOfficial;', cx);
  const r = await cx.sendOfficial('general', '📎 a.mp4 · 1014 КБ', null);
  ok(r.ok && r.m && r.m.id === 41 && inserted && inserted.text.startsWith('📎'), 'site chat send returns the message with its id (file attach needs it)', JSON.stringify(r));
  // F._attach: настоящая причина и код, сообщение без файла убирается
  const calls = []; let del = 0;
  ctx.sbClient = { rpc: async (fn, a) => { calls.push([fn, a.p_kind, a.p_mid]); return fn === 'msg_attach' ? { data: a.p_mid === 41 ? { ok: true } : { ok: false, reason: 'late' }, error: null } : { data: null, error: null }; } };
  vm.runInContext('var sbClient = this.sbClient;', ctx);
  const att = { v: 1, enc: 'none', kid: '', name: 'a.mp4', size: 1038336, mime: 'video/mp4', chash: 'a'.repeat(64), phash: 'a'.repeat(64) };
  const mk = (send) => ({ fileKind: 'chat', send, del: async () => { del++; return { ok: true }; } });
  let x = await F._attach(mk(async () => ({ ok: true })), att);
  ok(!x.ok && /код: no_id/.test(x.err) && !calls.length, 'no message id: real reason + code, attach not attempted', x.err);
  x = await F._attach(mk(async () => ({ ok: true, m: { id: 42 } })), att);
  ok(!x.ok && /не успели/.test(x.err) && /код: late/.test(x.err) && del === 1, 'server refusal: plain reason + code, orphan message removed', x.err);
  x = await F._attach(mk(async () => ({ ok: false, err: '⏱ не так быстро' })), att);
  ok(!x.ok && x.err === '⏱ не так быстро', 'message refused: its own reason, not «не отправилось»');
  x = await F._attach(mk(async () => ({ ok: true, m: { id: 41 } })), att);
  ok(x.ok && x.m.att === att && calls.some(c => c[1] === 'chat' && c[2] === 41), 'site chat: message id goes to msg_attach (kind chat)');
  console.log(bad ? `files-test: ${bad}/${n} FAIL` : `files-test: ${n} ok`); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
