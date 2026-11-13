// ═══════════════════════════════════════
//  ФАЙЛЫ В ЧАТЕ, СООБЩЕСТВАХ И ЛС (D37Files, T-141; владелец 12.11: «отправку файлов как в лс так и в наш дс», «как в ватсап
//  или телеге, чтобы файл передавался сам»). Флаг FILES_ON — откат одной строкой (и site_config chat_files {"on":false} на сервере).
// ═══════════════════════════════════════
// Как устроено. Сам файл на наш сервер НЕ попадает: он идёт от устройства к устройству (WebRTC, канал данных — DTLS, посредник
// TURN видит только шифр). В строке сообщения — только ссылка att (community.sql ч. 9, msg_attach):
//   { v: 1, enc: 'none', kid: '', name, size, mime, chash, phash, thumb?, w?, h?, dur? }
//   chash — SHA-256 байтов «как переданы», phash — открытого содержимого (сейчас равны; enc/kid — под шифрование T-155),
//   thumb — маленькое превью (WebP ≈ 160 px, data URL), w/h — размер картинки (место под неё держим заранее, без прыжков ленты).
// У кого файл есть (отправитель и каждый, кто уже получил), тот его раздаёт: «рой» — тема Realtime 'd37f:<мир>:<chash>', только
// broadcast (без базы и presence). Сообщения роя подписаны ECDSA-ключом вкладки (те же подписи, что у звонков: D37Calls.sig) —
// в том числе предложение/ответ WebRTC с отпечатком DTLS: подменить их по дороге нельзя. Чего подпись НЕ даёт: ключ вкладки
// новый при каждой загрузке и ни к какому аккаунту не привязан («кто первым назвался» — доверие с первого сообщения).
// Передача: кусками по 64 КБ, кадр [u32 номер][u32 длина][байты] (место под тег AEAD у T-155), у каждого куска свой SHA-256
// (список приходит в начале), в конце — SHA-256 всего файла = chash. Очередь с обратным давлением (bufferedAmount), ограничение
// скорости (в звонке — медленнее), «стоп», продолжение с первого недостающего куска у другого источника. Память ограничена
// размером файла (не больше direct_mb).
// «Передаётся сам»: отправитель держит файл у себя (IndexedDB «d37-files», закреплён, пока не доставлен) и раздаёт его, пока
// открыт сайт; получатель ЛС подбирает свои файлы сам после входа (раз в 2 минуты смотрит свежие ЛС с файлом), в канале —
// картинки до auto_mb грузятся сами, когда карточка видна; остальное — кнопкой. Нет никого с файлом в сети — так и пишем,
// и ждём: появится источник — получим сами. Только внутри своих ЛС и каналов, где ты участник (ссылку видит только тот, кому
// база отдаёт строку), мир (детский / 18+) — в названии роя. До 9 лет — файлов нет. Чёрный список хешей (file_blocked) — до приёма
// и до раздачи. Тип файла — по списку и по первым байтам (при отправке И при приёме). Сохранить — всегда как вложение.
(() => {
  'use strict';
  if (window.D37Files) return;
  const F = window.D37Files = {};
  const FILES_ON = true;
  const P = () => window.D37Phone || null;
  const e = s => (typeof esc === 'function' ? esc(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  const me = () => (typeof currentUser !== 'undefined' && currentUser?.id) || '';
  const now = () => performance.now();
  const CSZ = 65536;

  // ═══ Настройки (сервер: file_cfg; заглушки — до решения владельца) ═══
  // on: false, пока сервер не ответил file_cfg: до запуска community.sql ч. 9 файлов нет вовсе (ни кнопки, ни опроса ЛС)
  // T-160: file_cfg отвечает ЛИЧНЫЕ пределы того, кто спрашивает (владелец сайта — без лимитов: owner true, file_mb = max_mb;
  // решает сервер по profiles.role, устройство только читает). max_mb — технический предел передачи (память получателя),
  // relay_kbs — скорость через наш TURN (= max-bps в server/coturn/turnserver.conf, КБ/с)
  const CFG0 = { on: false, owner: false, file_mb: 10, auto_mb: 10, direct_mb: 25, max_mb: 100, relay_kbs: 1100, seed_mb_day: 300, day_n: 40, day_mb: 100 };
  let cfg = Object.assign({}, CFG0), cfgAt = 0;
  async function loadCfg(maxAge = 600e3){
    if (Date.now() - cfgAt < maxAge || !sb()) return cfg;
    cfgAt = Date.now();
    try { const { data, error } = await sb().rpc('file_cfg'); if (!error && data) { cfg = Object.assign({}, CFG0, { on: true }, data); document.querySelectorAll('.mv-fbtn').forEach(b => { b.hidden = !(b.dataset.fk && F.canSend()); }); } } catch (er) {}
    return cfg;
  }
  F.cfg = () => cfg;
  if (FILES_ON) addEventListener('d37:auth', () => { cfgAt = 0; loadCfg(); });   // вошёл / вышел — пределы другие (владелец)
  const MiB = 1048576;
  const recvCap = () => Math.max(+cfg.direct_mb || 0, +cfg.max_mb || 0) * MiB;   // размер уже проверил сервер при msg_attach
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Причины — простыми словами: что случилось и что делать (строка состояния карточки и ошибки)
  const WHY = {
    nosrc: '📡 отправителя сейчас нет на сайте (и никого с этим файлом) — файл придёт сам, как только он зайдёт; держи эту страницу открытой',
    conn: 'соединяемся…', connr: 'соединяемся через сервер-посредник…',
    retry: 'связь оборвалась — пробуем ещё раз…',
    relaydown: 'сервер-посредник не отвечает, а у тебя включено «🕶 Скрыть мой адрес» — попробуй через пару минут или выключи эту настройку в ⚙️ → 📱 Телефон',
    srcrelay: 'у отправителя не работает сервер-посредник (у него включено «🕶 Скрыть мой адрес») — попробуй через пару минут',
    noroute: 'устройства не смогли соединиться (строгая сеть, например мобильный интернет) и сервер-посредник не помог — попробуй через Wi-Fi или позже',
    noanswer: 'отправитель в сети, но не отвечает (страница у него свёрнута?) — попроси открыть сайт и нажми «Повторить»',
    signal: 'нет связи с сервером сайта — проверь интернет и нажми «Повторить»',
    srcno: 'у отправителя файла больше нет или он сейчас не может раздавать (экономия трафика, мало заряда)',
    big: 'файл слишком большой для передачи', bad: 'файл пришёл испорченным',
  };
  const fail = (code, msg) => Object.assign(new Error(msg || WHY[code] || code), { code });
  F.WHY = WHY;

  // ═══ Типы: список + первые байты ═══
  // T-160: + фото и видео с iPhone (HEIC, MOV) — с телефона это самые частые «нельзя»
  const TYPES = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'image/gif': /\.gif$/i, 'image/webp': /\.webp$/i, 'image/heic': /\.hei[cf]$/i, 'video/mp4': /\.(mp4|m4v)$/i, 'video/webm': /\.webm$/i, 'video/quicktime': /\.mov$/i,
    'audio/mpeg': /\.mp3$/i, 'audio/ogg': /\.(ogg|oga|opus)$/i, 'audio/wav': /\.wav$/i, 'audio/mp4': /\.m4a$/i, 'application/pdf': /\.pdf$/i, 'text/plain': /\.txt$/i, 'application/zip': /\.zip$/i };
  const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip' };
  const MIME_ALIAS = { 'image/heif': 'image/heic' };
  F.ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/webm,video/quicktime,.mov,.mp3,.m4a,.ogg,.oga,.opus,.wav,.pdf,.txt,.zip';
  const at = (b, i, s) => s.split('').every((c, k) => b[i + k] === c.charCodeAt(0));
  function sniff(b, mime){   // b — Uint8Array первых байтов
    switch (mime) {
      case 'image/jpeg': return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
      case 'image/png': return b[0] === 0x89 && at(b, 1, 'PNG');
      case 'image/gif': return at(b, 0, 'GIF8');
      case 'image/webp': return at(b, 0, 'RIFF') && at(b, 8, 'WEBP');
      case 'video/mp4': case 'audio/mp4': case 'video/quicktime': case 'image/heic': return at(b, 4, 'ftyp') || (mime === 'video/quicktime' && (at(b, 4, 'moov') || at(b, 4, 'wide') || at(b, 4, 'mdat')));
      case 'video/webm': return b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3;
      case 'audio/mpeg': return at(b, 0, 'ID3') || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0);
      case 'audio/ogg': return at(b, 0, 'OggS');
      case 'audio/wav': return at(b, 0, 'RIFF') && at(b, 8, 'WAVE');
      case 'application/pdf': return at(b, 0, '%PDF-');
      case 'application/zip': return b[0] === 0x50 && b[1] === 0x4B && (b[2] === 3 || b[2] === 5);
      case 'text/plain': { for (let i = 0; i < Math.min(b.length, 512); i++) if (b[i] === 0) return false; const s = new TextDecoder().decode(b.slice(0, 512)).toLowerCase(); return !/<\s*(script|html|svg|iframe)/.test(s); }
    }
    return false;
  }
  const mimeOf = name => EXT_MIME[String(name || '').split('.').pop().toLowerCase()] || '';
  F.typeOk = (name, mime) => !!TYPES[mime] && TYPES[mime].test(name || '');
  const kind = mime => mime === 'image/heic' ? 'file' : mime.split('/')[0] === 'image' ? 'image' : mime.split('/')[0] === 'video' ? 'video' : mime.split('/')[0] === 'audio' ? 'audio' : 'file';
  const ICON = { image: '🖼', video: '🎬', audio: '🎵', file: '📄' };
  F.size = n => n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ';
  const hex = buf => Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join('');
  const sha = async buf => hex(await crypto.subtle.digest('SHA-256', buf));
  F.cleanName = n => String(n || 'file').replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(-120) || 'file';

  // ═══ Хранилище на устройстве: IndexedDB «d37-files» (meta — список, blob — файлы отдельно). LRU, закреплённые не трогаем ═══
  const CAP = () => (matchMedia?.('(pointer: coarse)').matches ? 200e6 : 600e6);
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('d37-files', 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'chash' }); if (!d.objectStoreNames.contains('blob')) d.createObjectStore('blob'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (stores, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(stores, mode); let out; Promise.resolve(fn(t)).then(v => { out = v; }); t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error); }); };
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  F.meta = async h => { try { return await tx(['meta'], 'readonly', t => req(t.objectStore('meta').get(h))); } catch (er) { return null; } };
  F.blob = async h => { try { return await tx(['blob'], 'readonly', t => req(t.objectStore('blob').get(h))); } catch (er) { return null; } };
  const metas = async () => { try { return await tx(['meta'], 'readonly', t => req(t.objectStore('meta').getAll())); } catch (er) { return []; } };
  const putMeta = m => tx(['meta'], 'readwrite', t => { t.objectStore('meta').put(m); });
  async function store(m, blob){
    const all = await metas(); let used = all.reduce((s, x) => s + (x.chash === m.chash ? 0 : x.size || 0), 0);
    if (m.size > CAP()) throw new Error('Файл больше, чем место для файлов на устройстве');
    const old = all.filter(x => !x.pinned && x.chash !== m.chash).sort((a, b) => (a.used || 0) - (b.used || 0));
    const drop = [];
    while (used + m.size > CAP() && old.length) { const x = old.shift(); drop.push(x.chash); used -= x.size || 0; }
    if (used + m.size > CAP()) throw new Error('Мало места: файлы, которые ждут получателя, занимают всё');
    await tx(['meta', 'blob'], 'readwrite', t => { for (const h of drop) { t.objectStore('meta').delete(h); t.objectStore('blob').delete(h); } t.objectStore('meta').put(m); t.objectStore('blob').put(blob, m.chash); });
    return drop.length;
  }
  F._store = { store, metas, CAP };

  // ═══ Превью: картинка — WebP ≈ 160 px, видео — первый кадр, звук — длительность ═══
  async function thumbOf(blob, mime){
    const k = kind(mime), out = {};
    const draw = (src, w, h) => { const s = Math.min(1, 160 / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s)); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      for (const q of [.7, .5, .35]) { let d = c.toDataURL('image/webp', q); if (!/^data:image\/webp/.test(d)) d = c.toDataURL('image/jpeg', q); if (d.length <= 40000) return d; } return ''; };
    const url = URL.createObjectURL(blob);
    try {
      if (k === 'image') {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        out.w = img.naturalWidth; out.h = img.naturalHeight; const t = draw(img, out.w, out.h); if (t) out.thumb = t;
      } else if (k === 'video' || k === 'audio') {
        const v = document.createElement(k); v.muted = true; v.preload = 'metadata'; v.src = url;
        await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 4000); });
        if (isFinite(v.duration)) out.dur = Math.round(v.duration * 10) / 10;
        if (k === 'video' && v.videoWidth) {
          out.w = v.videoWidth; out.h = v.videoHeight;
          await new Promise(res => { v.onseeked = res; v.currentTime = Math.min(.5, (v.duration || 1) / 2); setTimeout(res, 3000); });
          const t = draw(v, out.w, out.h); if (t) out.thumb = t;
        }
      }
    } catch (er) {} finally { URL.revokeObjectURL(url); }
    return out;
  }

  // ═══ Отправка: проверить, посчитать хеш, превью, положить к себе (закреплён — ждёт получателя), ссылка в сообщение ═══
  F.canSend = () => FILES_ON && cfg.on !== false && !!me() && !window.D37Age?.u9?.();
  F.prepare = async file => {
    await loadCfg(60e3);   // свежие личные пределы (владелец — без лимитов)
    const name = F.cleanName(file.name), ft = MIME_ALIAS[file.type] || file.type, mime = TYPES[ft] && TYPES[ft].test(name) ? ft : mimeOf(name);
    if (!mime || !F.typeOk(name, mime)) throw new Error('Такой тип файла нельзя. Можно: фото (JPG, PNG, GIF, WEBP, HEIC), видео (MP4, WEBM, MOV), звук (MP3, M4A, OGG, WAV), PDF, TXT и ZIP — другое запакуй в ZIP');
    if (file.size < 1) throw new Error('Файл пустой');
    if (file.size > cfg.file_mb * MiB) throw new Error(cfg.owner ? `Файл больше ${cfg.file_mb} МБ — столько за раз устройство получателя не примет` : `Файл больше ${cfg.file_mb} МБ — столько можно за один раз. Сожми видео или раздели архив на части`);
    const head = new Uint8Array(await file.slice(0, 600).arrayBuffer());
    if (!sniff(head, mime)) throw new Error('Содержимое файла не похоже на его тип — не отправляем');
    const chash = await sha(await file.arrayBuffer());
    if ((await blockedList([chash])).has(chash)) throw new Error('Этот файл запрещён модераторами');
    const th = await thumbOf(file, mime);
    const att = Object.assign({ v: 1, enc: 'none', kid: '', name, size: file.size, mime, chash, phash: chash }, th);
    await store({ chash, name, mime, size: file.size, pinned: true, sent: true, got: 0, used: Date.now(), at: Date.now() }, file.slice(0, file.size, mime));
    return att;
  };
  // Целиком: текст «📎 имя · размер» обычным путём ленты, потом ссылку — msg_attach (не вышло — убрать сообщение)
  F.send = async (A, file) => {
    if (!F.canSend()) return { ok: false, err: window.D37Age?.u9?.() ? 'Файлы — с 9 лет' : 'Войди, чтобы отправлять файлы' };
    let att;
    try { att = await F.prepare(file); } catch (er) { return { ok: false, err: er.message }; }
    return F._attach(A, att);
  };
  // T-160: сообщение «📎 имя · размер» → ссылка msg_attach. Любой отказ — настоящая причина простыми словами + код мелко;
  // ссылка не встала — сообщение без файла убираем (не оставляем карточку, будто файл есть)
  F._attach = async (A, att) => {
    const r = await A.send(`📎 ${att.name} · ${F.size(att.size)}`, null);
    if (!r?.ok) return { ok: false, err: (r?.err || 'сообщение не отправилось') };
    if (!r.m?.id) return { ok: false, err: 'сообщение ушло, но сайт не узнал его номер — файл не прикрепился. Обнови страницу и попробуй ещё раз · код: no_id' };
    let data = null, error = null;
    try { ({ data, error } = await sb().rpc('msg_attach', { p_kind: A.fileKind, p_mid: r.m.id, p_att: att })); } catch (er) { error = er; }
    if (error || !data?.ok) {
      let gone = false; try { gone = !!(await A.del?.(r.m))?.ok; } catch (er) {}
      const tail = gone ? '' : ' (сообщение «📎» без файла удали вручную)';
      const R = { type: 'такой тип файла нельзя', big: `файл больше ${cfg.file_mb} МБ`, day: `на сегодня лимит файлов исчерпан (${cfg.day_n} шт. или ${cfg.day_mb} МБ в день) — завтра снова можно`, u9: 'файлы — с 9 лет', blocked: 'файл запрещён модераторами', off: 'файлы пока выключены', late: 'не успели прикрепить — попробуй ещё раз', auth: 'войди, чтобы отправлять файлы' };
      const code = error ? (error.code || 'rpc') : (data?.reason || 'unknown');
      const why = error ? (/msg_attach|PGRST202/.test((error.message || '') + error.code) ? 'файлы появятся, когда сайт обновится' : /JWT|401|auth/i.test((error.message || '') + error.code) ? 'вход устарел — выйди и войди снова' : /fetch|network/i.test(error.message || '') ? 'нет связи с сервером — проверь интернет' : 'сервер не принял файл')
        : R[data?.reason] || { kind: 'этот чат не принимает файлы', not_found: 'сообщение не нашлось (не твоё или удалено)', dup: 'к сообщению уже прикреплён файл', name: 'имя файла с запрещёнными знаками', size: 'неверный размер файла', hash: 'ошибка подсчёта отпечатка файла', thumb: 'не подошло превью', bad: 'неверные данные файла', enc: 'шифрование файлов пока не включено', version: 'старая версия сайта — обнови страницу' }[data?.reason] || 'сервер не принял файл';
      return { ok: false, err: why + tail + ' · код: ' + code };
    }
    seed(att.chash);
    return { ok: true, m: Object.assign(r.m, { att }) };
  };

  // ═══ Чёрный список (сервер), кэш 10 минут ═══
  const BL = new Map();
  async function blockedList(hs){
    const need = hs.filter(h => !(BL.has(h) && Date.now() - BL.get(h).t < 600e3));
    if (need.length && sb()) { try { const { data } = await sb().rpc('file_blocked', { p_hashes: need }); const set = new Set(data || []); for (const h of need) BL.set(h, { t: Date.now(), b: set.has(h) }); } catch (er) {} }
    return new Set(hs.filter(h => BL.get(h)?.b));
  }

  // ═══ Рой: подписанные сообщения в теме Realtime ═══
  const SW = new Map();   // chash → { ch, seed, want: { att, chunks, ... }, peers: Map(key → peer), pubs: Map }
  const MAX_SW = 12, MAX_PEERS = 3, MAX_FAILS = 4;
  const realm = () => (window.D37Age?.group?.() === 'adult' ? 'a' : 'k');
  let keys = null, myKey = '';
  async function sig(){ await P()?.need?.('calls'); const S = window.D37Calls?.sig; if (!S) throw fail('signal'); if (!keys) { keys = await S.myKeys(); myKey = (me() || 'g').slice(0, 8) + '~' + Math.random().toString(36).slice(2, 8); } return S; }
  async function swarm(h){
    let s = SW.get(h); if (s && s.ok) return s;
    if (s && s.ready) leave(h); else if (s) { await s.ready0; if (s.ok) return s; leave(h); }
    if (SW.size >= MAX_SW) { const old = [...SW.entries()].find(([, x]) => !x.want && !x.seed); if (old) leave(old[0]); }
    const S = await sig(), c = sb(); if (!c) throw fail('signal');
    s = { h, ch: null, seed: false, want: null, peers: new Map(), pubs: new Map(), last: 0, ok: false, ready: false };
    SW.set(h, s);
    s.send = async d => { d.ts = Date.now(); d.from = myKey; const m = JSON.stringify(d); try { await s.ch.send({ type: 'broadcast', event: 'f', payload: { k: myKey, m, s: await S.sign(keys.kp.privateKey, m), p: keys.pub } }); } catch (er) {} };
    s.ch = c.channel(`d37f:${realm()}:${h.slice(0, 40)}`, { config: { broadcast: { self: false } } });
    s.ch.on('broadcast', { event: 'f' }, ({ payload }) => onMsg(s, payload));
    // статус канала помним всё время: связь с сервером сайта пропала — следующая попытка подпишется заново (раньше — молчание)
    s.ready0 = new Promise(res => { s.ch.subscribe(st => { s.ok = st === 'SUBSCRIBED'; if (st !== 'SUBSCRIBED' && st !== 'CLOSED') s.ok = false; if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(st)) res(); }); setTimeout(res, 10000); });
    await s.ready0; s.ready = true;
    return s;
  }
  function leave(h){ const s = SW.get(h); if (!s) return; SW.delete(h); for (const p of s.peers.values()) closePeer(p); try { sb()?.removeChannel(s.ch); } catch (er) {} }
  async function onMsg(s, pl){
    if (!pl || typeof pl.k !== 'string' || typeof pl.m !== 'string' || typeof pl.s !== 'string' || typeof pl.p !== 'string' || pl.m.length > 60000 || pl.k === myKey) return;
    const S = window.D37Calls?.sig; if (!S) return;
    let pk = s.pubs.get(pl.k);
    if (pk && pk.raw !== pl.p) return;   // ключ этого участника уже известен — чужой ключ под его именем не принимаем
    if (!pk) { try { pk = { raw: pl.p, key: await S.importPub(pl.p) }; } catch (er) { return; } }
    if (!await S.verifySig(pk.key, pl.s, pl.m)) return;
    s.pubs.set(pl.k, pk);
    let d; try { d = JSON.parse(pl.m); } catch (er) { return; }
    if (!d || d.from !== pl.k || Math.abs(Date.now() - (+d.ts || 0)) > 120e3) return;
    if (d.to && d.to !== myKey) return;
    const peerOf = () => { const p = s.peers.get(d.from); return p && p.sid === d.sid ? p : null; };
    if (d.t === 'want' && s.seed) { if (await seedOk(s.h)) s.send({ t: 'have', to: d.from }); }
    else if (d.t === 'have' && s.want) { s.want.lastHave = Date.now(); pickSource(s, d.from); }
    else if (d.t === 'offer' && s.seed && typeof d.sdp === 'string' && d.sdp.length < 20000) answerPeer(s, d);
    else if (d.t === 'answer' && typeof d.sdp === 'string' && d.sdp.length < 20000) { const p = peerOf(); if (p) { p.answered = true; p.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }).catch(() => {}); } }
    else if (d.t === 'ice' && Array.isArray(d.c) && d.c.length <= 40) { const p = peerOf(); if (p) for (const c of d.c) if (c && typeof c.candidate === 'string' && c.candidate.length < 600) { p.rem.add((/ typ (\w+)/.exec(c.candidate) || [])[1] || '?'); p.pc.addIceCandidate(c).catch(() => {}); } }
    else if (d.t === 'err' && typeof d.why === 'string') { const p = peerOf(); if (p) { p.why = { srcrelay: 'srcrelay', srcno: 'srcno', busy: 'busy' }[d.why] || 'srcno'; p.fail?.(); } }
    else if (d.t === 'got') { const m = await F.meta(s.h); if (m && m.sent) { m.got = (m.got || 0) + 1; m.pinned = false; await putMeta(m).catch(() => {}); const ss = SEND.get(s.h); if (ss) ss.got = true; paintAll(s.h); } }
  }
  // Раздавать ли: файл есть, не в чёрном списке, батарея / экономия трафика, лимит раздачи в день
  let seededToday = { d: '', b: 0 };
  async function seedOk(h){
    const m = await F.meta(h); if (!m) return false;
    if ((await blockedList([h])).has(h)) return false;
    if (navigator.connection?.saveData) return false;
    try { const b = await navigator.getBattery?.(); if (b && !b.charging && b.level < .15) return false; } catch (er) {}
    const d = new Date().toDateString(); if (seededToday.d !== d) seededToday = { d, b: 0 };
    return seededToday.b + m.size <= cfg.seed_mb_day * MiB;
  }
  async function seed(h){ if (!FILES_ON) return; try { const s = await swarm(h); s.seed = true; if (!s.ok) leave(h); } catch (er) {} }

  // ═══ WebRTC: канал данных (те же ICE, что звонки: «скрыть мой адрес» — только через наш TURN) ═══
  // T-160: TURN владельца теперь и запасной путь без «скрыть адрес» (нет прямой связи: мобильный интернет ↔ домашний ПК);
  // пароли TURN — с /turn (rt.js), ждём их до 3 с. «Скрыть адрес» включён, а TURN не отвечает — честная причина, адрес не отдаём.
  function closePeer(p){ p.closed = true; clearTimeout(p.iceT); clearTimeout(p.tm); try { p.dc?.close(); } catch (er) {} try { p.pc?.close(); } catch (er) {} }
  const hasTurn = () => (Array.isArray(window.D37_TURN) ? window.D37_TURN : []).some(x => [].concat(x?.urls || []).some(u => /^turns?:/i.test(String(u))));
  async function iceFor(){
    if (!hasTurn()) { try { window.D37RT?.prefetchTurn?.(); } catch (er) {} for (let i = 0; i < 15 && !hasTurn(); i++) await sleep(200); }
    const c = await window.D37Calls.iceConfig();
    if (c.relay && !c.ok) throw fail('relaydown');
    return c;
  }
  // путь соединения: «host/host» (одна сеть), «srflx/…» (напрямую через интернет), «…relay…» (через наш TURN)
  async function pathOf(pc){
    try {
      const st = await pc.getStats(); let pair = null;
      st.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
      if (!pair) st.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return '';
      return (st.get(pair.localCandidateId)?.candidateType || '?') + '/' + (st.get(pair.remoteCandidateId)?.candidateType || '?');
    } catch (er) { return ''; }
  }
  async function newPc(s, key, sid){
    const cfgI = await iceFor();
    const pc = new RTCPeerConnection(cfgI.relay ? { iceServers: cfgI.iceServers, iceTransportPolicy: 'relay' } : { iceServers: cfgI.iceServers });
    const p = { key, sid, pc, dc: null, ice: [], iceT: 0, tm: 0, closed: false, relay: cfgI.relay, loc: new Set(), rem: new Set(), answered: false, opened: false, via: '', why: '', t0: Date.now() };
    pc.onicecandidate = ev => {
      if (!ev.candidate || !ev.candidate.candidate || p.closed) return;
      const ty = (/ typ (\w+)/.exec(ev.candidate.candidate) || [])[1] || '';
      if (cfgI.relay && ty !== 'relay') return;
      p.loc.add(ty);
      p.ice.push(ev.candidate.toJSON());
      if (!p.iceT) p.iceT = setTimeout(() => { p.iceT = 0; const c = p.ice.splice(0, 40); if (c.length) s.send({ t: 'ice', to: key, sid, c }); }, 250);
    };
    // «скрыть адрес»: сбор кандидатов закончен, а от TURN — ни одного → посредник недоступен (не ждём 20 с впустую)
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete' && p.relay && !p.loc.has('relay') && !p.closed) { p.why = 'relaydown'; p.fail?.(); } };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && !p.closed) { closePeer(p); if (s.peers.get(key) === p) s.peers.delete(key); p.onEnd?.(); } };
    const old = s.peers.get(key); if (old && old !== p) closePeer(old);
    s.peers.set(key, p);
    return p;
  }
  // Источник: ответить и раздавать по запросу «get». Та же вкладка получателя пришла снова (новая попытка) — старое соединение
  // закрываем и отвечаем заново (раньше новая попытка молча пропускалась: «соединяемся…» навсегда); зависшие — через 40 с прочь
  async function answerPeer(s, d){
    const sid = String(d.sid || '').slice(0, 16);
    const old = s.peers.get(d.from);
    if (old) { if (old.sid === sid) return; closePeer(old); s.peers.delete(d.from); }
    for (const [k, x] of s.peers) if (x.dc?.readyState !== 'open' && Date.now() - x.t0 > 40000) { closePeer(x); s.peers.delete(k); }
    if (s.peers.size >= MAX_PEERS) { s.send({ t: 'err', to: d.from, sid, why: 'busy' }); return; }
    let p; try { p = await newPc(s, d.from, sid); } catch (er) { s.send({ t: 'err', to: d.from, sid, why: er.code === 'relaydown' ? 'srcrelay' : 'srcno' }); return; }
    p.pc.ondatachannel = ev => { p.dc = ev.channel; serve(s, p); };
    p.tm = setTimeout(() => { if (!p.closed && p.dc?.readyState !== 'open') { closePeer(p); if (s.peers.get(d.from) === p) s.peers.delete(d.from); } }, 40000);
    try { await p.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp }); const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a); s.send({ t: 'answer', to: d.from, sid: p.sid, sdp: a.sdp }); } catch (er) { closePeer(p); s.peers.delete(d.from); }
  }
  // Скорость раздачи: в звонке — 256 КБ/с (звонку хватает); через наш TURN — relay_kbs (не выше предела TURN: лишнее он
  // выбрасывает, и канал данных сбавляет скорость; при старом max-bps 96000 было ≈ 50 КБ/с, сейчас 2,5 МБ/с ≈ 1,1 МБ/с файла); напрямую — 6 МБ/с
  const rateFor = p => (window.D37Calls?.inCall?.() ? 262144 : /relay/.test(p.via) ? Math.max(32, +cfg.relay_kbs || 1100) * 1024 : 6 * MiB);
  const SEND = new Map();   // chash → { pct, done, got, via } — у отправителя: «передаём N %» / «доставлено»
  F.sendState = h => SEND.get(h) || null;
  function serve(s, p){
    const dc = p.dc; dc.binaryType = 'arraybuffer'; dc.bufferedAmountLowThreshold = 262144;
    dc.onmessage = async ev => {
      let q; try { q = JSON.parse(ev.data); } catch (er) { return; }
      if (q.t === 'stop') { p.stop = true; return; }
      if (q.t !== 'get' || q.h !== s.h) return;
      const m = await F.meta(s.h), blob = await F.blob(s.h);
      if (!m || !blob || m.size > recvCap() || !await seedOk(s.h)) { dc.send(JSON.stringify({ t: 'no' })); return; }
      const n = Math.ceil(m.size / CSZ);
      if (!m.hs || m.hs.length !== n) {   // хеши кусков — один раз, потом из списка
        m.hs = []; for (let i = 0; i < n; i++) m.hs.push(await sha(await blob.slice(i * CSZ, (i + 1) * CSZ).arrayBuffer()));
        await putMeta(m).catch(() => {});
      }
      dc.send(JSON.stringify({ t: 'meta', size: m.size, csz: CSZ, n, hs: m.hs, mime: m.mime }));
      m.used = Date.now(); putMeta(m).catch(() => {});
      p.via = await pathOf(p.pc);
      const ss = SEND.get(s.h) || { got: false }; SEND.set(s.h, Object.assign(ss, { pct: 0, done: false, via: p.via })); paintAll(s.h);
      let t0 = now(), sentB = 0, paintT = 0; p.stop = false;
      const from = Math.max(0, Math.min(n, +q.from || 0)), R = rateFor(p);
      let i = from;
      for (; i < n && !p.stop && dc.readyState === 'open'; i++) {
        if (dc.bufferedAmount > 1048576) await new Promise(r => { dc.onbufferedamountlow = r; setTimeout(r, 2000); });
        const body = new Uint8Array(await blob.slice(i * CSZ, (i + 1) * CSZ).arrayBuffer());
        const fr = new Uint8Array(8 + body.length), dv = new DataView(fr.buffer); dv.setUint32(0, i); dv.setUint32(4, body.length); fr.set(body, 8);
        try { dc.send(fr.buffer); } catch (er) { break; }
        sentB += fr.length; seededToday.b += fr.length;
        if (now() - paintT > 500) { paintT = now(); ss.pct = Math.floor((i + 1) / n * 100); paintAll(s.h); }
        const ahead = sentB / R * 1000 - (now() - t0); if (ahead > 30) await new Promise(r => setTimeout(r, ahead));
      }
      if (i >= n) { ss.pct = 100; ss.done = true; } paintAll(s.h);
    };
  }

  // ═══ Получение ═══
  // ctx: { auto } — само (без нажатия). Возвращает Promise<Blob>. Состояние: wait → conn/connr → load N % → готово | retry → … |
  // nosrc (отправителя нет — ждём, пока открыта страница) | отказ с причиной (err.code: relaydown, noroute, noanswer, signal …)
  const GET = new Map();
  const ERR = new Map();   // chash → текст последней неудачи (карточка показывает и даёт «🔁 Повторить»)
  F.fetch = (att, ctx = {}) => {
    if (GET.has(att.chash)) return GET.get(att.chash).p;
    const st = { att, chunks: null, n: 0, got: 0, hs: null, busy: null, tried: new Set(), done: false, stop: false, pct: 0, note: 'wait', wantT: 0, t0: Date.now(), fails: 0, nextAt: 0, lastHave: 0, via: '', tL: 0, gotL: 0 };
    ERR.delete(att.chash);
    st.p = (async () => {
      const have = await F.blob(att.chash); if (have) return have;
      if (!F.typeOk(att.name, att.mime)) throw fail('type', 'тип файла не разрешён');
      if (window.D37Age?.u9?.()) throw fail('u9', 'файлы — с 9 лет');
      if ((await blockedList([att.phash])).has(att.phash)) throw fail('blocked', 'файл запрещён модераторами');
      await loadCfg();
      if (att.size > recvCap()) throw fail('big');
      const s = await swarm(att.chash);
      if (!s.ok) { leave(att.chash); throw fail('signal'); }
      s.want = st;
      return new Promise((res, rej) => {
        st.res = res; st.rej = rej;
        const ask = () => {
          if (st.done || st.stop) return;
          if (!st.busy) { s.send({ t: 'want' }); if (Date.now() - Math.max(st.t0, st.lastHave) > 20000) setNote(st, 'nosrc'); }
          st.wantT = setTimeout(ask, 8000);
        };
        ask();
      });
    })();
    st.p.catch(er => { if (er?.code !== 'stop') { ERR.set(att.chash, '⚠️ не удалось: ' + (er?.message || 'ошибка')); } }).finally(() => {
      clearTimeout(st.wantT); clearTimeout(st.stallT); if (st.busy) closePeer(st.busy);
      GET.delete(att.chash); const s = SW.get(att.chash); if (s && s.want === st) s.want = null; paintAll(att.chash);
    });
    GET.set(att.chash, st);
    return st.p;
  };
  F.cancel = h => { const st = GET.get(h); if (!st) return; st.stop = true; try { st.busy?.dc?.send(JSON.stringify({ t: 'stop' })); } catch (er) {} if (st.busy) closePeer(st.busy); st.rej?.(fail('stop', 'отменено')); };
  F.state = h => { const st = GET.get(h); if (!st) return null; const dt = (Date.now() - st.tL) / 1000, kbs = st.tL && dt > .5 ? (st.got - st.gotL) * CSZ / 1024 / dt : 0;
    return { pct: st.pct, note: st.note, via: st.via, fails: st.fails, kbs: Math.round(kbs), eta: kbs > 0 ? Math.round((st.n - st.got) * CSZ / 1024 / kbs) : 0 }; };
  const spd = k => (k >= 1024 ? (k / 1024).toFixed(1).replace('.', ',') + ' МБ/с' : Math.round(k) + ' КБ/с');
  F.noteText = g => {
    if (!g) return '';
    if (g.note === 'load') {
      let t = `получаем… ${g.pct}%`;
      if (g.kbs > 0) { t += ' · ' + spd(g.kbs); if (g.eta > 3) t += ' · ещё ~' + (g.eta >= 90 ? Math.round(g.eta / 60) + ' мин' : g.eta + ' с'); }
      return t + (/relay/.test(g.via || '') ? ' · через посредник' : '');
    }
    if (g.note === 'retry') return WHY.retry + ` (попытка ${Math.min(MAX_FAILS, (g.fails || 0) + 1)} из ${MAX_FAILS})`;
    return WHY[g.note] || (g.note === 'wait' ? 'ищем отправителя…' : String(g.note || ''));
  };
  function setNote(st, n){ if (st.note === n) return; st.note = n; paintAll(st.att.chash); }
  // Неудачная попытка: ещё раз чуть позже (1,5 → 3 → 6 с), после MAX_FAILS подряд без прогресса — отказ с причиной
  function attemptFailed(st, w){
    if (st.done || st.stop) return;
    st.fails++;
    if (w === 'relaydown' || st.fails >= MAX_FAILS) { st.rej?.(fail({ drop: 'noroute', bad: 'noroute', busy: 'noanswer' }[w] || w)); return; }
    st.nextAt = Date.now() + 1500 * 2 ** (st.fails - 1); setNote(st, 'retry');
  }
  async function pickSource(s, key){
    const st = s.want; if (!st || st.busy || st.done || st.stop || st.tried.has(key) || Date.now() < st.nextAt) return;
    st.tried.add(key);
    const sid = Math.random().toString(36).slice(2, 10);
    let p; try { p = await newPc(s, key, sid); } catch (er) { st.tried.delete(key); attemptFailed(st, er.code || 'noroute'); return; }
    if (st.done || st.stop || st.busy) { closePeer(p); if (s.peers.get(key) === p) s.peers.delete(key); st.tried.delete(key); return; }
    st.busy = p; setNote(st, p.relay ? 'connr' : 'conn');
    const dc = p.dc = p.pc.createDataChannel('f', { ordered: true }); dc.binaryType = 'arraybuffer';
    const got0 = st.got;
    const why = () => p.why || (!p.answered ? 'noanswer' : p.relay && !p.loc.has('relay') ? 'relaydown' : !p.opened ? 'noroute' : 'drop');
    const bad = () => {
      if (st.busy !== p) return;
      st.busy = null; clearTimeout(st.stallT); const w = why(); closePeer(p); if (s.peers.get(key) === p) s.peers.delete(key); st.tried.delete(key);
      if (st.done || st.stop) return;
      if (st.got > got0) st.fails = 0;   // что-то пришло — счёт неудач заново, продолжим с первого недостающего куска
      attemptFailed(st, w);
    };
    p.onEnd = bad; p.fail = bad; dc.onclose = bad;
    const conT = setTimeout(() => { if (st.busy === p && dc.readyState !== 'open') bad(); }, 20000);
    const stall = () => { clearTimeout(st.stallT); st.stallT = setTimeout(() => { if (st.busy === p && !st.done) { p.why = 'drop'; bad(); } }, 20000); };
    dc.onopen = () => {
      clearTimeout(conT); p.opened = true; const from = st.chunks ? st.chunks.findIndex(x => !x) : 0;
      dc.send(JSON.stringify({ t: 'get', h: st.att.chash, from: from < 0 ? 0 : from }));
      st.tL = Date.now(); st.gotL = st.got; setNote(st, 'load'); stall();
      pathOf(p.pc).then(v => { st.via = p.via = v; F._test.last = { via: v }; paintAll(st.att.chash); });
    };
    let chain = Promise.resolve();
    dc.onmessage = ev => {
      if (typeof ev.data === 'string') {
        let q; try { q = JSON.parse(ev.data); } catch (er) { return; }
        if (q.t === 'no') { p.why = 'srcno'; bad(); return; }
        if (q.t === 'meta') {
          if (+q.size !== st.att.size || +q.csz !== CSZ || !Array.isArray(q.hs) || q.hs.length !== Math.ceil(st.att.size / CSZ) || !q.hs.every(x => /^[0-9a-f]{64}$/.test(x))) { p.why = 'bad'; bad(); return; }
          if (!st.chunks) { st.n = q.hs.length; st.chunks = new Array(st.n).fill(null); st.hs = q.hs; }
          else if (st.hs.join() !== q.hs.join()) { p.why = 'bad'; bad(); return; }   // другой источник прислал другой список — не смешиваем
        }
        return;
      }
      const buf = ev.data; if (!st.chunks || !(buf instanceof ArrayBuffer) || buf.byteLength < 8) return;
      stall();
      chain = chain.then(async () => {
        if (!st.chunks) return;
        const dv = new DataView(buf), i = dv.getUint32(0), len = dv.getUint32(4);
        if (i >= st.n || len !== buf.byteLength - 8 || st.chunks[i]) return;
        const body = buf.slice(8);
        if (await sha(body) !== st.hs[i]) { p.why = 'bad'; bad(); return; }   // кусок испорчен — к другому источнику
        st.chunks[i] = body; st.got++;
        const pct = Math.floor(st.got / st.n * 100); if (pct !== st.pct) { st.pct = pct; paintAll(st.att.chash); }
        if (st.got === st.n) await finish(s, st, p);
      });
    };
    try { const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o); s.send({ t: 'offer', to: key, sid, sdp: o.sdp }); } catch (er) { bad(); }
  }
  async function finish(s, st, p){
    clearTimeout(st.stallT);
    const blob = new Blob(st.chunks, { type: st.att.mime });
    st.chunks = null;
    const h = await sha(await blob.arrayBuffer());
    if (h !== st.att.chash) { st.got = 0; st.tried.clear(); if (st.busy === p) st.busy = null; closePeer(p); attemptFailed(st, 'bad'); return; }
    const head = new Uint8Array(await blob.slice(0, 600).arrayBuffer());
    if (!sniff(head, st.att.mime)) { st.done = true; closePeer(p); st.rej(fail('bad', 'содержимое не похоже на свой тип — не сохраняем')); return; }
    st.done = true; closePeer(p); s.peers.delete(p.key);
    try { await store({ chash: h, name: st.att.name, mime: st.att.mime, size: st.att.size, pinned: false, used: Date.now(), at: Date.now() }, blob); } catch (er) {}
    s.send({ t: 'got' }); s.seed = true;   // теперь и я — источник
    st.res(blob); paintAll(h);
  }

  // ═══ Карточка в ленте (msgview): превью сразу, файл — сам (ЛС и картинки) или по кнопке ═══
  F.cardHtml = (a, m, fk) => {
    if (!a || typeof a !== 'object' || !/^[0-9a-f]{64}$/.test(a.chash || '')) return '';
    const k = kind(String(a.mime || '')), w = +a.w || 0, h = +a.h || 0;
    const box = a.thumb && /^data:image\/(webp|jpeg);base64,/.test(a.thumb) ? `<span class="mvf-th" style="aspect-ratio:${w && h ? w + '/' + h : '16/9'}"><img src="${e(a.thumb)}" alt="" loading="lazy" decoding="async"></span>` : '';
    return `<div class="mv-file mvf-${k}" data-fh="${e(a.chash)}" data-fk="${e(fk || '')}" data-fm="${e(m?.id ?? '')}"${m && (m.mine || (m.uid && m.uid === P()?.me?.()) || window.MsgView?.noReport?.(m)) ? ' data-fself="1"' : ''}>${box}<div class="mvf-row"><span class="mvf-ic">${ICON[k]}</span><span class="mvf-n"><b>${e(a.name)}</b><small>${e(F.size(+a.size || 0))}${a.dur ? ' · ' + e(Math.round(a.dur)) + ' с' : ''} · <span class="mvf-st">…</span></small></span><span class="mvf-bt"></span></div></div>`;
  };
  const CARDS = new Map();   // chash → Set(el)
  const URLS = new WeakMap();
  function paintAll(h){ for (const el of CARDS.get(h) || []) if (el.isConnected) paint(el); }
  async function paint(el){
    const h = el.dataset.fh, a = el._att; if (!a) return;
    const st = el.querySelector('.mvf-st'), bt = el.querySelector('.mvf-bt');
    if (window.D37Age?.u9?.()) { st.textContent = 'файлы — с 9 лет'; bt.innerHTML = ''; return; }
    const m = await F.meta(h), g = GET.get(h);
    if (m && await F.blob(h)) {
      const ss = m.sent ? SEND.get(h) : null;
      st.textContent = !m.sent ? '✅ на устройстве' : m.got || ss?.got ? '✅ доставлено' : ss && !ss.done ? `📤 передаём… ${ss.pct}%${/relay/.test(ss.via || '') ? ' · через посредник' : ''}` : ss?.done ? '📤 отправлено, ждём подтверждения…' : '⏳ ждёт получателя — уйдёт само, пока у тебя открыт сайт';
      bt.innerHTML = `<button type="button" data-f="open">${kind(a.mime) === 'file' ? '💾 Сохранить' : '▶ Открыть'}</button>${repBtn(el)}`;
      return;
    }
    if (g) { st.textContent = F.noteText(F.state(h)); bt.innerHTML = '<button type="button" data-f="stop" title="Остановить">✕</button>'; return; }
    const er = ERR.get(h);
    st.textContent = er || 'передаётся от человека к человеку';
    bt.innerHTML = `<button type="button" data-f="get">${er ? '🔁 Повторить' : '⬇ Получить'}</button>${repBtn(el)}`;
  }
  // 🚩 — не на свой файл и не на файл создателя сайта (T-164: владелец пожаловался сам на себя, жалоба ушла не туда)
  const repBtn = el => (el.dataset.fself ? '' : '<button type="button" data-f="rep" title="Пожаловаться">🚩</button>');
  async function act(el, k){
    const a = el._att; if (!a) return;
    if (k === 'get') { F.fetch(a).then(() => paint(el), () => paint(el)); paint(el); }
    else if (k === 'stop') F.cancel(a.chash);
    else if (k === 'rep') {
      if (!confirm('Пожаловаться на этот файл? Модераторы посмотрят, и если он плохой — его больше нельзя будет отправить.')) return;
      const { data, error } = await sb().rpc('file_report', { p_kind: el.dataset.fk, p_mid: +el.dataset.fm, p_why: '' });
      P()?.toast?.(!error && data?.ok ? '🚩 Жалоба отправлена' : '⚠️ ' + ({ self: 'на свой файл жаловаться нельзя', creator: 'на создателя сайта жаловаться нельзя', rate: 'слишком много жалоб — попробуй позже' }[data?.reason] || 'Не получилось'), !error && data?.ok);
    } else if (k === 'open') {
      const blob = await F.blob(a.chash); if (!blob) { paint(el); return; }
      const m = await F.meta(a.chash); if (m) { m.used = Date.now(); putMeta(m).catch(() => {}); }
      const kk = kind(a.mime);
      if (kk === 'file') {   // всегда как вложение и с безопасным типом
        const u = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
        const x = document.createElement('a'); x.href = u; x.download = a.name; x.rel = 'noopener'; document.body.appendChild(x); x.click(); x.remove();
        setTimeout(() => URL.revokeObjectURL(u), 30000); return;
      }
      const u = URL.createObjectURL(new Blob([blob], { type: a.mime }));
      const old = URLS.get(el); if (old) URL.revokeObjectURL(old); URLS.set(el, u);
      const th = el.querySelector('.mvf-th') || el.insertBefore(Object.assign(document.createElement('span'), { className: 'mvf-th' }), el.firstChild);
      th.style.aspectRatio = a.w && a.h ? `${+a.w}/${+a.h}` : kk === 'audio' ? 'auto' : '16/9';
      const node = document.createElement(kk === 'image' ? 'img' : kk); node.src = u; if (kk !== 'image') { node.controls = true; node.preload = 'metadata'; } else node.alt = '';
      th.replaceChildren(node);
    }
  }
  // Лента подключает: D37Files.watch(listEl, () => сообщения) → отписка. Сами — ЛС (до auto_mb) и картинки в канале, когда видны
  F.watch = (list, getMsg) => {
    if (!FILES_ON || !list) return () => {};
    loadCfg();
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(ents => { for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); auto(en.target); } }, { rootMargin: '200px' }) : null;
    const hook = el => {
      if (el._att) return;
      const id = el.dataset.fm, msg = getMsg(id), a = msg?.att; if (!a) return;
      el._att = a; const h = el.dataset.fh;
      if (!CARDS.has(h)) CARDS.set(h, new Set()); CARDS.get(h).add(el);
      paint(el); io?.observe(el);
    };
    const scan = () => { list.querySelectorAll('.mv-file').forEach(hook); for (const [h, set] of CARDS) { for (const el of set) if (!el.isConnected) { set.delete(el); const u = URLS.get(el); if (u) URL.revokeObjectURL(u); } if (!set.size) CARDS.delete(h); } };
    let t = 0; const mo = new MutationObserver(() => { if (!t) t = requestAnimationFrame(() => { t = 0; scan(); }); });
    mo.observe(list, { childList: true, subtree: true });
    // T-160: кнопки карточки (⬇ Получить / 🔁 Повторить / ▶ Открыть / 💾 Сохранить / ✕ / 🚩) — раньше их никто не слушал: нажатие
    // ничего не делало, файл приходил только сам (ЛС до auto_mb и картинки в канале), а открыть / сохранить пришедший было нельзя
    const onClick = ev => { const b = ev.target.closest?.('.mv-file [data-f]'); if (!b || !list.contains(b)) return; const el = b.closest('.mv-file'); if (!el._att) hook(el); ev.preventDefault(); act(el, b.dataset.f); };
    list.addEventListener('click', onClick);
    scan();
    return () => { mo.disconnect(); io?.disconnect(); list.removeEventListener('click', onClick); cancelAnimationFrame(t); for (const set of CARDS.values()) for (const el of set) if (list.contains(el)) { set.delete(el); const u = URLS.get(el); if (u) URL.revokeObjectURL(u); } };
  };
  async function auto(el){
    const a = el._att; if (!a || window.D37Age?.u9?.() || navigator.connection?.saveData) return;
    await loadCfg();
    const dm = el.dataset.fk === 'dm';
    if (a.size > cfg.auto_mb * MiB || (!dm && kind(a.mime) !== 'image')) return;
    if (await F.blob(a.chash)) return;
    F.fetch(a, { auto: true }).then(() => paint(el), () => paint(el));
    paint(el);
  }

  // ═══ «Передаётся сам»: после входа — раздавать свои недоставленные и подобрать свои ЛС с файлами (раз в 2 минуты) ═══
  let bgT = 0;
  async function background(){
    clearTimeout(bgT); bgT = setTimeout(background, 120e3);
    if (!FILES_ON || !me() || !sb() || document.hidden) return;
    await loadCfg(); if (cfg.on === false) return;
    for (const m of (await metas()).filter(x => x.pinned).slice(0, 6)) seed(m.chash);
    try {
      const { data, error } = await sb().from('direct_messages').select('id,att,sender_id,created_at').eq('recipient_id', me()).not('att', 'is', null).gt('created_at', new Date(Date.now() - 7 * 864e5).toISOString()).order('id', { ascending: false }).limit(8);
      if (error) return;
      for (const r of data || []) { const a = r.att; if (a && a.size <= cfg.auto_mb * MiB && !(await F.blob(a.chash))) F.fetch(a, { auto: true }).catch(() => {}); }
    } catch (er) {}
  }
  if (FILES_ON) { addEventListener('d37:auth', () => setTimeout(background, 3000)); setTimeout(background, 8000); }

  F._test = { sniff, mimeOf, TYPES, CSZ, kind, seed, SW, GET, SEND, ERR, recvCap, attemptFailed, last: null,
    setCfg: o => { cfg = Object.assign({}, CFG0, { on: true }, o); cfgAt = Date.now(); } };
})();
