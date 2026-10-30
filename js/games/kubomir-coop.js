// ═══════════════════════════════════════
//  «КУБОМИР» ВМЕСТЕ — до 8 игроков в мире хозяина (T-019, этап 1)
// ═══════════════════════════════════════
// Хозяин — тот, чей мир: его браузер считает мир (мобы, вещи, вода и лава, песок, печи, сундуки, двери, время суток). Гость заходит
// по ссылке /play/kubomir/<код> (код — отпечаток ключа мира, js/games/coop.js: подделать хозяина нельзя — первый ответ подписан),
// получает зерно и правки — только изменённые чанки рядом с собой (сжатые), остальное строит сам по зерну. Свои действия гость
// показывает сразу и отправляет хозяину: сломать / поставить / дверь / прорубь — хозяин проверяет (дальность, время копания по
// инструменту, частоту, место) и рассылает итог всем (свою правку гость получает назад; отказ — «deny» с тем, что на самом деле, и
// вещь назад). Сундук и печь — по одному: открыл — твои, пока не закрыл («занято»; печь у хозяина ждёт). Вещи и персонаж гостя —
// его; хозяин хранит их в мире (зашёл снова — всё как было). Мобы и вещи — снимками хозяина 10 раз в секунду (через запасной канал
// — 3), только рядом с гостем; игроки видят друг друга (поза, вещи в руках, удар, щит, лук, нокаут). Хозяин ушёл — игра кончилась
// (смены хозяина нет). Миры с модами — пока без игры вместе (моды хозяина гостю пришлось бы ставить — этап 2).
// Пакеты (первый байт): 1 JSON, 2 правки, 3 чанк, 16 снимок хозяина, 17 состояние гостя. Числа — мировые, значения блоков — по
// палитре мира хозяина (как в сохранениях).
//   H = KubomirCoop.host(st, hooks) — хозяин; await H.start(); H.step(dt) — шаг логики, H.frame(dt) — кадр, H.close(why), H.panel()
//   G = KubomirCoop.join(code, hooks) — гость: hooks.start(meta, G) запускает мир (startWorld с guest), G.attach(st), G.loadChunk(c),
//   G.step / G.frame / G.close; действия — G.reqBreak / reqPlace / reqDoor / reqIce / reqDrop / openTile / chat / leave
(() => {
  const VX = () => window.D37E.vox, CO = () => window.D37Coop, CBk = () => window.D37E?.combat;
  const PROTO = 1, MAX = 8, GAME = 'kubomir';
  // T138-V2: что хозяин умеет сверх PROTO (в 'wel'): 1 — удары гостя 'kc' и события физики 'kt' (T-138). Гость рубит через хозяина,
  // только если хозяин это умеет; у старого хозяина (поля нет) — копает как раньше ('brk'). Старый гость у нового хозяина — тоже как
  // раньше (шлёт 'brk', новые сообщения хозяина ему неизвестны и пропускаются): PROTO не меняется, игра вместе после выкладки не рвётся
  const KT_NET = 1;
  const T_JSON = 1, T_EDITS = 2, T_CHUNK = 3, T_SNAP = 16, T_ST = 17;
  const SNAP_MS = 100, SNAP_RELAY_MS = 333, ST_MS = 66, ST_RELAY_MS = 333, EDIT_MS = 50, INV_MS = 10000, HOST_SILENT_MS = 15000;
  const MOB_R = 64, ITEM_R = 40, REACH = 5, REACH_C = 6.5, SLACK = 2.5;
  const now = () => performance.now();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const EMPTY = new Uint8Array(0), EMPTY32 = new Uint32Array(0);
  const fin = v => typeof v === 'number' && Number.isFinite(v);

  // ═══ байты ═══
  function writer(cap = 4096){
    const w = { b: new ArrayBuffer(cap), o: 0 };
    w.a = new Uint8Array(w.b); w.dv = new DataView(w.b);
    w.need = k => { if (w.o + k <= w.b.byteLength) return; const nb = new ArrayBuffer(Math.max(w.b.byteLength * 2, w.o + k + 256)); new Uint8Array(nb).set(w.a.subarray(0, w.o)); w.b = nb; w.a = new Uint8Array(nb); w.dv = new DataView(nb); };
    w.reset = () => { w.o = 0; return w; };
    w.u8 = x => { w.need(1); w.a[w.o++] = x & 255; };
    w.u16 = x => { w.need(2); w.dv.setUint16(w.o, x & 0xffff, true); w.o += 2; };
    w.i16 = x => { w.need(2); w.dv.setInt16(w.o, clamp(Math.round(x), -32768, 32767), true); w.o += 2; };
    w.u32 = x => { w.need(4); w.dv.setUint32(w.o, x >>> 0, true); w.o += 4; };
    w.i32 = x => { w.need(4); w.dv.setInt32(w.o, x | 0, true); w.o += 4; };
    w.f32 = x => { w.need(4); w.dv.setFloat32(w.o, x, true); w.o += 4; };
    w.put8 = (at, x) => { w.a[at] = x & 255; };
    w.put16 = (at, x) => { w.dv.setUint16(at, x & 0xffff, true); };
    w.view = () => w.a.subarray(0, w.o);
    return w;
  }
  const RD = { dv: null, o: 0, n: 0 };
  function rd(u8){ RD.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); RD.o = 0; RD.n = u8.byteLength; return RD; }
  const need = k => { if (RD.o + k > RD.n) throw new Error('short'); };
  const r8 = () => { need(1); return RD.dv.getUint8(RD.o++); };
  const r16 = () => { need(2); const v = RD.dv.getUint16(RD.o, true); RD.o += 2; return v; };
  const ri16 = () => { need(2); const v = RD.dv.getInt16(RD.o, true); RD.o += 2; return v; };
  const r32 = () => { need(4); const v = RD.dv.getUint32(RD.o, true); RD.o += 4; return v; };
  const ri32 = () => { need(4); const v = RD.dv.getInt32(RD.o, true); RD.o += 4; return v; };
  const rf = () => { need(4); const v = RD.dv.getFloat32(RD.o, true); RD.o += 4; return v; };
  function J(obj){ const s = enc.encode(JSON.stringify(obj)), u = new Uint8Array(s.length + 1); u[0] = T_JSON; u.set(s, 1); return u; }
  function unJ(u8){ try { return JSON.parse(dec.decode(u8.subarray(1))); } catch (e) { return null; } }
  const b64 = u => CO().toB64(u), unb64 = s => CO().fromB64(s);

  // ── чанк: правки (номера по возрастанию разностями u16 + значения u16 по палитре), плитки — JSON, «основа» — u16 повторы ──
  function chunkBody(rec){
    const e = rec?.e || EMPTY32, tj = rec?.t?.length ? enc.encode(JSON.stringify(rec.t)) : null, nb = rec?.b ? rec.b.length : 0;
    const s = Array.from(e).sort((a, b) => a - b);
    const u = new Uint8Array(12 + s.length * 4 + (tj ? tj.length : 0) + nb * 2), dv = new DataView(u.buffer);
    dv.setUint32(0, s.length, true); dv.setUint32(4, tj ? tj.length : 0, true); dv.setUint32(8, nb, true);
    let o = 12, prev = 0;
    for (let k = 0; k < s.length; k++) { const c = s[k] >>> 16; dv.setUint16(o, c - prev, true); prev = c; o += 2; }
    for (let k = 0; k < s.length; k++) { dv.setUint16(o, s[k] & 0xffff, true); o += 2; }
    if (tj) { u.set(tj, o); o += tj.length; }
    for (let k = 0; k < nb; k++) { dv.setUint16(o, rec.b[k], true); o += 2; }
    return u;
  }
  function chunkParse(u){
    const V = VX(), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    if (u.length < 12) throw new Error('short');
    const ne = dv.getUint32(0, true), tl = dv.getUint32(4, true), nb = dv.getUint32(8, true);
    if (ne > V.CELLS || tl > 4e6 || nb > V.CELLS * 2 || 12 + ne * 4 + tl + nb * 2 > u.length) throw new Error('bad chunk');
    const e = new Uint32Array(ne); let o = 12, c = 0;
    for (let k = 0; k < ne; k++) { c += dv.getUint16(o, true); o += 2; if (c >= V.CELLS) throw new Error('bad cell'); e[k] = c << 16; }
    for (let k = 0; k < ne; k++) { e[k] = (e[k] | dv.getUint16(o, true)) >>> 0; o += 2; }
    let t = [];
    if (tl) { const a = JSON.parse(dec.decode(u.subarray(o, o + tl))); o += tl; if (Array.isArray(a)) t = a.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] < V.CELLS && x[1] && typeof x[1] === 'object').slice(0, 4096); }
    const rec = { e, t };
    if (nb) { const b = new Uint16Array(nb); let n = 0; for (let k = 0; k < nb; k++) { b[k] = dv.getUint16(o, true); o += 2; } for (let k = 0; k < nb; k += 2) n += b[k]; if (n === V.CELLS && nb % 2 === 0) rec.b = b; }
    return rec;
  }

  // ═══ текст: мат и ссылки закрыты (как в мире), ребёнку — ещё и контакты (D37Age.kidText) ═══
  const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а' };
  const BAD = [
    /ху[йеёяюи]/u, /п[иеё]зд/u, /(?:^|[^\p{L}])бля(?!х)/u, /(?:^|[^\p{L}])(?:за|на|вы|у|от|по|до|про|раз|рас|съ|подъ|из|изъ|при|пере|недо)?[её]б(?:а|ал|ан|ат|ут|ну|ло|ли|л|ы|ош|уч|ен|ис|ыв|ыр|ет|ёт)/u,
    /(?:^|[^\p{L}])[её]б(?!\p{L})/u, /(?:^|[^\p{L}])сук(?:а+|и|е|у|ой|ин|ам)(?!\p{L})/u, /муда[кч]|мудил/u, /пид[ао]р|педик(?!юр)/u, /г[ао]нд[ао]н/u, /шлюх/u, /залуп/u, /дроч/u,
  ];
  function cleanText(text, max = 120){
    const CTRL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) + String.fromCharCode(0x2028) + '-' + String.fromCharCode(0x202e) + ']', 'g');
    let s = String(text || '').replace(CTRL, '').trim().slice(0, max);
    s = s.replace(/(?:https?:\/\/|www\.|t\.me\/|discord\.gg\/?)\S*/giu, '[ссылка]').replace(/\S+\.(?:ru|com|net|org|io|me|gg|tk|su|рф|kz|xyz|app|tv|by|ua|info|site|online|link)\b\S*/giu, '[ссылка]');
    const chars = [...s], low = chars.map(c => { const l = c.toLowerCase(); return l.length === 1 ? (LAT[l] || l) : c; }).join('');
    if (low.length === chars.length) {
      const mask = new Array(low.length).fill(false);
      for (const re of BAD) { const g = new RegExp(re.source, 'gu'); let m; while ((m = g.exec(low))) { for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true; if (!m[0].length) g.lastIndex++; } }
      let out = '', i = 0;
      while (i < chars.length) {
        if (/\s/u.test(chars[i])) { out += chars[i++]; continue; }
        let j = i, bad = false;
        while (j < chars.length && !/\s/u.test(chars[j])) { if (mask[j]) bad = true; j++; }
        out += bad ? '*'.repeat(Math.min(6, j - i)) : chars.slice(i, j).join('');
        i = j;
      }
      s = out;
    }
    return s;
  }
  const kidSafe = s => { try { return window.D37Age?.kid?.() ? window.D37Age.kidText(s) : s; } catch (e) { return s; } };
  const nickOf = s => kidSafe(cleanText(CO().cleanNick(s), 24)) || 'Игрок';
  function myNick(){ try { if (typeof currentProfile !== 'undefined' && currentProfile?.nick) return currentProfile.nick; } catch (e) {} return window.GameRoom?.nick?.() || 'Игрок'; }
  function myLook(){ try { return Object.assign({}, window.D37Char ? window.D37Char.look() : {}, { item: 'none' }); } catch (e) { return { item: 'none' }; } }
  const normLook = l => { try { const L = window.D37Char?.upgrade ? window.D37Char.upgrade(l) : window.D37Char?.norm ? window.D37Char.norm(l) : {}; L.item = 'none'; return L; } catch (e) { return { item: 'none' }; } };
  // свой ключ: в присутствии — от аккаунта (или браузера) и кода комнаты (свой на вкладку: две вкладки — два игрока); у хозяина
  // в мире — от аккаунта и мира (зашёл снова — свои вещи), номер аккаунта никому не уходит
  function baseId(){
    try { if (typeof currentUser !== 'undefined' && currentUser?.id) return 'u' + currentUser.id; } catch (e) {}
    let g = ''; try { g = localStorage.getItem('d37_kb_gid') || ''; } catch (e) {}
    if (!/^[a-z0-9]{10}$/.test(g)) { g = Math.random().toString(36).slice(2, 12).padEnd(10, '0'); try { localStorage.setItem('d37_kb_gid', g); } catch (e) {} }
    return 'g' + g;
  }
  const tabId = (() => { let t = ''; try { t = sessionStorage.getItem('d37_kb_tab') || ''; } catch (e) {} if (!t) { t = Math.random().toString(36).slice(2, 8); try { sessionStorage.setItem('d37_kb_tab', t); } catch (e) {} } return t; })();
  const presKey = code => 'k' + CO().hash(baseId() + '|' + code) + tabId;
  async function playerKey(code){ try { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(baseId() + '|kb|' + code))); return [...h.slice(0, 12)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return CO().hash(baseId() + code) + CO().hash(code + baseId()); } }
  const linkFor = code => (window.D37Ref?.wrap || (u => u))(window.D37Route ? window.D37Route.abs('#/games/kubomir/' + code) : location.origin + '/play/kubomir/' + code);

  // ═══ игроки в мире (общая часть хозяина и гостя): человечки, вещи в руках, поза рук, имена над головой, нокаут ═══
  // флаги: 1 идёт, 2 в воздухе, 4 крадётся, 8 плывёт (дна нет), 16 лестница, 32 висит, 64 нокаут, 128 бежит, 256 лезет, 512 ныряет,
  // 1024 ползком, 2048 сидит, 4096 лежит, 8192 спит (T-123: круг позы; старые версии рисуют такого игрока стоя)
  function peers(st){
    const map = new Map(), A = st.A, Q = { x: 0, y: 0, z: 0, yaw: 0, moving: false, speed: 0, air: false, crouch: 0, crawl: false, swim: false, dive: false, ladder: false, sit: false, hang: false, pk: '', pkK: 0, climbPh: 0, lie: false, sleep: false, seatY: null };
    const wrap = () => st.hudEl?.parentElement || null;
    const P = { map };
    P.add = (pid, nick, look) => {
      P.remove(pid);
      const key = 'p' + pid, a = A?.add(key, normLook(look), { x: st.P.x - st.ox, y: st.P.y, z: st.P.z - st.oz, yaw: 0 });
      const tag = document.createElement('div'); tag.className = 'kb-tag'; tag.textContent = nickOf(nick); tag.hidden = true;
      wrap()?.appendChild(tag);
      const p = { pid, key, nick: nickOf(nick), a, tag, x: 0, y: -999, z: 0, px: 0, py: 0, pz: 0, yaw: 0, pyaw: 0, pitch: 0, flags: 0, main: '', off: '', pose: 0, hp: 20, t: 0, iv: SNAP_MS, seen: false, sc: null, hold: { r: 0, l: 0, m: 0, mh: 0, v: 0, g: 0, d: 0, p: 0 }, starT: 0, tx: -1, ty: -1, tagOn: false };
      map.set(pid, p);
      return p;
    };
    P.state = (pid, x, y, z, yaw, pitch, flags, main, off, pose, hp, iv) => {
      const p = map.get(pid); if (!p) return;
      const k = p.seen ? clamp((now() - p.t) / p.iv, 0, 1) : 1;
      p.px = p.px + (p.x - p.px) * k; p.py = p.py + (p.y - p.py) * k; p.pz = p.pz + (p.z - p.pz) * k; p.pyaw = p.pyaw + angD(p.pyaw, p.yaw) * k;
      if (!p.seen || Math.abs(x - p.x) + Math.abs(y - p.y) + Math.abs(z - p.z) > 24) { p.px = x; p.py = y; p.pz = z; p.pyaw = yaw; }   // телепорт — сразу
      p.x = x; p.y = y; p.z = z; p.yaw = yaw; p.pitch = pitch; p.flags = flags; p.main = main; p.off = off; p.pose = pose; p.hp = hp; p.t = now(); p.iv = iv || SNAP_MS; p.seen = true;
    };
    const angD = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
    P.frame = (dt, t) => {
      const R = st.R, cam = R.camera.position, CB = CBk();
      for (const p of map.values()) {
        const a = p.a; if (!a || !p.seen) continue;
        if (a.ch && a.ch !== p.sc) { p.sc = a.ch; a.ch.root.scale.setScalar(.8); }   // как свой (kubomir.js)
        const k = clamp((now() - p.t) / p.iv, 0, 1), x = p.px + (p.x - p.px) * k, y = p.py + (p.y - p.py) * k, z = p.pz + (p.z - p.pz) * k, f = p.flags, ko = !!(f & 64);
        Q.x = x - st.ox; Q.y = y; Q.z = z - st.oz; Q.yaw = p.pyaw + angD(p.pyaw, p.yaw) * k + Math.PI;
        Q.moving = !!(f & 1) && !ko; Q.speed = f & 128 ? 5.7 : f & 1024 ? 1.15 : f & 4 ? 1.3 : 4.3; Q.air = !!(f & 2); Q.swim = !!(f & 8); Q.dive = !!(f & 512); Q.crouch = (f & 4 && !Q.swim) || ko ? 1 : 0; Q.crawl = !!(f & 1024) && !Q.swim && !ko;
        Q.y = st.swimDrawY ? st.swimDrawY(a, x, y, z, Q.swim && !Q.dive, dt) : y;   // плывёт — гладь у плеч (как свой: kubomir.js)
        Q.ladder = !!(f & 16); Q.hang = !!(f & 32); Q.pk = f & 256 ? 'mantle' : ''; Q.pkK = f & 256 ? .5 : 0;
        Q.sit = !!(f & 2048) && !ko; Q.lie = !!(f & 4096) && !ko; Q.sleep = Q.lie && !!(f & 8192); Q.seatY = Q.lie ? y + .02 : Q.sit ? y + .3 : null;   // сидит / лежит (T-123)
        if (Q.sit || Q.lie) { Q.moving = false; Q.crouch = 0; Q.crawl = false; Q.air = false; }
        A.pose(p.key, Q);
        if (CB && a.ch) { CB.unpack(p.pose, p.hold); if (ko) { p.hold.r = 0; p.hold.l = 0; p.hold.m = 0; } a.hold = p.hold; } else a.hold = null;
        a.lookAt = a.lookAt || { x: 0, y: 0, z: 0 };
        const cp = Math.cos(p.pitch), sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
        a.lookAt.x = Q.x - sy * cp * 8; a.lookAt.y = y + 1.5 - Math.sin(p.pitch) * 8; a.lookAt.z = Q.z - cy * cp * 8;
        st.hand?.remote?.(a, ko ? '' : p.main, ko ? '' : p.off);
        if (ko && (p.starT -= dt) <= 0) { p.starT = .3; st.ents?.glow?.('star', x, y + 1.6, z, 1); }
        // имя над головой (дальше 48 блоков и за спиной — нет)
        const far = Math.abs(x - st.P.x) > 48 || Math.abs(z - st.P.z) > 48;
        let on = false;
        if (!far && !st.hudHidden) { const pr = R.project(Q.x, y + 2.05, Q.z); on = !!pr[2]; if (on) { const tx = Math.round(pr[0]), ty = Math.round(pr[1]); if (tx !== p.tx || ty !== p.ty) { p.tx = tx; p.ty = ty; p.tag.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, -100%)`; } } }
        if (on !== p.tagOn) { p.tagOn = on; p.tag.hidden = !on; }
        const lbl = (ko ? '💫 ' : '') + p.nick;
        if (p.tag.textContent !== lbl) p.tag.textContent = lbl;
      }
    };
    P.remove = pid => { const p = map.get(pid); if (!p) return; map.delete(pid); st.hand?.forget?.(p.key); A?.remove(p.key); p.tag.remove(); };
    P.clear = () => { for (const pid of [...map.keys()]) P.remove(pid); };
    P.get = pid => map.get(pid) || null;
    return P;
  }

  // свои: поза, вещи, флаги — в пакет (хозяин — в снимок, гость — в своё состояние)
  function myFlags(st){
    const P = st.P, sp = Math.hypot(P.vx, P.vz), deep = st.swimDeep ? st.swimDeep(P) : P.water > .9;
    return (sp > .4 ? 1 : 0) | (!P.onGround && !P.climb && !(P.water > .3) ? 2 : 0) | (P.sneak ? 4 : 0) | (deep ? 8 : 0) | (P.climb && !P.onGround ? 16 : 0) | (P.hang ? 32 : 0) | (P.dead ? 64 : 0) | (P.sprint ? 128 : 0) | (P.pk ? 256 : 0) | (deep && P.sneak ? 512 : 0) | (P.crawl ? 1024 : 0)   // 1024 — ползком (T-096a)
      | (st.pose2?.k === 'sit' ? 2048 : 0) | (st.pose2?.k === 'lie' || st.kbSleep ? 4096 : 0) | (st.kbSleep ? 8192 : 0);   // сидит, лежит, спит (T-123)
  }
  function handIds(st){
    const P = st.P, HS = st.F && st.hands;
    if (P.dead) return ['', ''];
    if (HS) { const m = P.inv[P.sel]; return [HS.two || HS.mainOff ? '' : m ? m.id : '', HS.two ? (m ? m.id : '') : HS.offS ? HS.offS.id : '']; }
    return [P.inv[P.sel]?.id || '', P.off?.id || ''];
  }
  const myPose = st => { const CB = CBk(), h = st.hand?.tp; return CB && h ? CB.pack(h) : 0; };

  // ═══════════════════════ ХОЗЯИН ═══════════════════════
  function host(st, hooks){
    const V = VX(), meta = st.meta, MOBS = window.KubomirEnts.MOBS, MOB_I = new Map(Object.keys(MOBS).map((k, i) => [k, i]));
    const H = { st, isHost: true, code: '', R: null, guests: new Map(), pidOf: new Map(), edited: new Set(), editQ: new Map(), editN: 0, t0: now(), closed: false, banned: new Set(), locks: new Map(), ltile: new Map(), lat: new Map(), pend: new Map(), view: null,
      stats: { snaps: 0, snapBytes: 0, edits: 0, editBytes: 0, chunks: 0, chunkBytes: 0, reqs: 0, denied: 0, joins: 0, leaves: 0 }, editT: 0, extraT: 0, items: null, itemIdx: null };
    const W8 = writer(16384), WS = writer(4096);
    const items = () => { if (!H.items) { H.items = V.items.map(i => i.name); H.itemIdx = new Map(H.items.map((n, i) => [n, i + 1])); } return H.itemIdx; };
    const pv = v => (((st.remapOut[v & 0xfff] ?? 0) & 0xfff) | (v & 0xf000)) >>> 0;
    const toLocal = p => (((st.remapIn[p & 0xfff] ?? V.ID.missing) & 0xfff) | (p & 0xf000)) >>> 0;
    const ready = () => [...H.guests.values()].filter(G => G.ready);
    function out(G, u8){ if (!G.out.length) { H.R.send(G.id, u8, false); return; } G.out.push({ u8 }); }
    function outAsync(G, pr){ const it = { u8: null }; G.out.push(it); pr.then(u => { it.u8 = u || EMPTY; pump(G); }, () => { it.u8 = EMPTY; pump(G); }); }
    function pump(G){ while (G.out.length && G.out[0].u8) { const it = G.out.shift(); if (it.u8.length && !G.gone) H.R.send(G.id, it.u8, false); } }
    const sendJ = (G, o) => out(G, J(o));
    const toAll = (o, but) => { const u = J(o); for (const G of H.guests.values()) if (G.ready && G !== but) out(G, u); };

    H.start = async () => {
      meta.coop = meta.coop || {};
      if (!meta.coop.key?.jwk || !meta.coop.code) {
        const k = await CO().makeKey();
        if (!k) throw new Error('браузер не умеет подписи (WebCrypto) — игра вместе недоступна');
        meta.coop.key = { pub: k.pub, jwk: k.jwk }; meta.coop.code = k.code;
      }
      H.code = meta.coop.code;
      for (const k of st.savedKeys) H.edited.add(k);
      for (const c of st.W.chunks.values()) if (c.edits?.size) H.edited.add(c.cx + '|' + c.cz);
      st.W.listeners.push(onEdit);
      const E = st.ents;
      if (E) {
        E.hookHurtRemote = (o, n, m) => { const G = o.G; if (G?.ready) sendJ(G, { t: 'hurt', n, m: m?.id || 0, x: m ? +m.x.toFixed(2) : o.x, z: m ? +m.z.toFixed(2) : o.z }); };
        E.hookGiveRemote = (o, s, eid) => { const G = o.G; if (!G?.ready) return s.n; sendJ(G, { t: 'give', s: { id: s.id, n: s.n, d: s.d | 0 }, e: eid || 0 }); return 0; };
        H.kill0 = E.hookKill; E.hookKill = (m, by) => { H.kill0?.(m, by); mobDied(m); };
        H.fall0 = E.fallGroup; E.fallGroup = (cells, pivot, dir, o) => { const g = H.fall0(cells, pivot, dir, o); if (g && !o?.visual && !(o?.topple && window.KubomirTopple?.NET)) fell(cells, pivot, dir, !!o?.drop); return g; };   // T-138 F5: крен / падение D37E.topple — своими событиями ('kt')
        H.shoot0 = E.shoot; E.shoot = (x, y, z, vx, vy, vz, dmg, o) => { const a = H.shoot0(x, y, z, vx, vy, vz, dmg, o); shotOut(x, y, z, vx, vy, vz, o, H.shooter); return a; };
        E.isLocked = k => { const L = H.locks.get(k); return !!L && L !== 'host'; };
      }
      H.view = peers(st);
      H.R = CO().room({ game: GAME, code: H.code, host: true, max: MAX, me: { key: presKey(H.code), nick: myNick(), meta: { k: meta.coop.key.pub } }, sameHost: p => p.meta?.k === meta.coop.key.pub,
        onMembers: members, onMsg: recv, onGap: from => { const G = H.guests.get(from); if (G?.ready) sendJ(G, { t: 'resync' }); },
        onError: r => { if (!H.closed) hooks.ended?.(r === 'dup' ? 'Этот мир уже открыт для друзей в другой вкладке' : 'Нет связи — друзья не смогут зайти. Проверь интернет', r); H.close(r, true); } });
      document.addEventListener('visibilitychange', onVis);
      return H;
    };
    const onVis = () => { if (!H.closed) toAll({ t: 'pause', on: document.visibilityState === 'hidden' }); };

    // ── кто в комнате ──
    function members(list){
      const ids = new Set(list.map(p => p.id));
      for (const p of list) if (p.id !== H.R.me && !H.guests.has(p.id)) H.guests.set(p.id, newGuest(p));
      for (const [id, G] of H.guests) if (!ids.has(id)) gone(G, 'ушёл');
    }
    function newGuest(p){
      const proxy = { x: 0, y: -999, z: 0, dead: true, G: null, room: s => { const R = proxy.G.room; return R.e > 0 || R.p.has(s.id); } };
      const G = { id: p.id, nick: nickOf(p.nick), ready: false, pid: 0, pkey: '', look: null, x: 0, y: -999, z: 0, yaw: 0, pitch: 0, flags: 0, main: '', off: '', pose: 0, hp: 20, rd: 6, at: now(), stT: 0, tx: 0, ty: 0, tz: 0, tT: 0, sus: 0,
        proxy, room: { e: 1, p: new Set() }, out: [], snapT: 0, snapSeq: 0, itemsN: 0, ckQ: [], ckSet: new Set(), ckBusy: 0, dig: 1.5, digT: now(), puts: 8, putT: now(), acts: 6, actT: now(), drops: 6, dropT: now(), hits: 5, hitT: now(), chatT: 0, lock: null, gone: false, bytes: 0 };
      proxy.G = G;
      return G;
    }
    function freePid(){ for (let i = 1; i < 250; i++) if (!H.pidOf.has(i)) return i; return 0; }
    async function hello(G, m){
      if (G.ready && G.wel && m.nonce === G.nonce) { sendJ(G, G.wel); return; }   // ответ не дошёл (запасной канал теряет до подписки) — ещё раз
      if (G.ready || G.hello) return;
      G.hello = true;
      try {
        if (m.v !== PROTO) { sendJ(G, { t: 'old' }); return; }
        const pk = String(m.pkey || '').slice(0, 40);
        if (H.banned.has(pk) || H.banned.has(G.id)) { sendJ(G, { t: 'kick' }); return; }
        if (ready().length >= MAX - 1) { sendJ(G, { t: 'full' }); return; }
        if (pk && ready().some(o => o.pkey === pk)) { sendJ(G, { t: 'dup' }); return; }
        const pid = freePid(); if (!pid) { sendJ(G, { t: 'full' }); return; }
        G.pid = pid; H.pidOf.set(pid, G); G.pkey = pk; G.look = normLook(m.look); G.rd = clamp(m.rd | 0, 2, 12); if (m.nick) G.nick = nickOf(m.nick);
        const proof = await CO().sign(meta.coop.key, String(m.nonce || '').slice(0, 64) + '|' + H.code);
        if (G.gone || H.closed) { H.pidOf.delete(pid); return; }
        items();
        const keys = new Int16Array(H.edited.size * 2); let i = 0;
        for (const k of H.edited) { const [a, b] = k.split('|'); keys[i++] = +a; keys[i++] = +b; }
        const P = st.P, saved = meta.coopPlayers?.[pk] || null;
        G.nonce = m.nonce;
        G.wel = { t: 'wel', v: PROTO, kt: window.KubomirTopple?.NET ? KT_NET : 0, pid, proof, pub: meta.coop.key.pub, code: H.code,
          host: { pid: 0, nick: myNick(), look: myLook() }, players: ready().filter(o => o !== G).map(o => ({ pid: o.pid, nick: o.nick, look: o.look })),
          world: { name: meta.name, seed: meta.seed, genVer: meta.genVer || 1, mode: meta.mode, diff: meta.diff, gen: meta.gen || null, mc: meta.mc || null, palette: meta.palette, spawn: meta.spawn, time: st.R.lighting.time, day: meta.day || 1, seasons: st.seasons, ice: meta.ice || null, snow: meta.snow || null, wf: st.WX?.force ?? null, cheats: !!meta.cheats, support: meta.support || null },
          items: H.items, you: saved, at: { x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2) }, edited: b64(new Uint8Array(keys.buffer)) };
        sendJ(G, G.wel);
        setTimeout(() => { if (G.wel) G.wel = null; }, 60000);   // дольше минуты не ждём повтора — память
        G.ready = true; G.stT = now(); H.stats.joins++;
        toAll({ t: 'pj', pid, nick: G.nick, look: G.look }, G);
        H.view.add(pid, G.nick, G.look);
        st.ents?.others.push(G.proxy);
        hooks.toast?.('👥 ' + G.nick + ' зашёл в мир');
        hooks.changed?.();
      } finally { G.hello = false; }
    }
    function gone(G, why){
      if (G.gone) return;
      G.gone = true; H.guests.delete(G.id);
      if (G.pid) H.pidOf.delete(G.pid);
      if (G.lock) unlock(G.lock, G);
      if (G.ready) {
        H.stats.leaves++;
        H.view.remove(G.pid);
        const E = st.ents; if (E) { const i = E.others.indexOf(G.proxy); if (i >= 0) E.others.splice(i, 1); }
        toAll({ t: 'pl', pid: G.pid });
        hooks.toast?.('👥 ' + G.nick + ' ' + (why || 'ушёл'));
        hooks.changed?.();
      }
    }
    H.kick = pid => { const G = H.pidOf.get(pid); if (!G) return; if (G.pkey) H.banned.add(G.pkey); H.banned.add(G.id); sendJ(G, { t: 'kick' }); setTimeout(() => gone(G, 'выгнан'), 400); };

    // ── приём ──
    function recv(from, u8){
      const G = H.guests.get(from); if (!G || G.gone || H.closed) return;
      G.bytes += u8.length;
      if (u8[0] === T_ST) { if (G.ready) try { onState(G, u8); } catch (e) {} return; }
      if (u8[0] !== T_JSON) return;
      const m = unJ(u8); if (!m || typeof m.t !== 'string') return;
      if (m.t === 'hi') { hello(G, m); return; }
      if (!G.ready) return;
      H.stats.reqs++;
      try { handle(G, m); } catch (e) { console.warn('Кубомир вместе:', e); }
    }
    function onState(G, u8){
      rd(u8); r8(); r16();
      const x = rf(), y = rf(), z = rf(), yaw = r16() / 65535 * Math.PI * 2, pitch = ri16() / 1e4, flags = r16(), mi = r16(), oi = r16(), pose = r32(), hp = r8();
      if (![x, y, z].every(fin) || Math.abs(x) > V.LIMIT || Math.abs(z) > V.LIMIT || y < -64 || y > 400) return;
      const t = now(), dt = Math.max(.02, (t - G.tT) / 1000), d = Math.hypot(x - G.tx, z - G.tz), lim = (st.creative ? 26 : 12) * dt + 3;
      if (!G.tT || d <= lim || G.sus > 40) { G.tx = x; G.ty = y; G.tz = z; G.tT = t; if (d <= lim) G.sus = Math.max(0, G.sus - 1); else G.sus = 0; }   // слишком быстро — для проверок место прежнее
      else G.sus++;
      G.x = x; G.y = y; G.z = z; G.yaw = yaw; G.pitch = pitch; G.flags = flags; G.pose = pose; G.hp = hp; G.stT = t;
      G.main = H.items[mi - 1] || ''; G.off = H.items[oi - 1] || '';
      const pr = G.proxy; pr.x = G.tx; pr.y = G.ty; pr.z = G.tz; pr.dead = !!(flags & 64);
      H.view.state(G.pid, x, y, z, yaw, pitch, flags, G.main, G.off, pose, hp, H.R.mode(G.id) === 'p2p' ? ST_MS : ST_RELAY_MS);
    }
    // «бюджеты»: сколько можно сделать (копать — секунды копания; ставить, двери, бросать, бить — штуки), копится по времени
    const fill = (G, k, kt, rate, cap) => { const t = now(); G[k] = Math.min(cap, G[k] + (t - G[kt]) / 1000 * rate); G[kt] = t; return G[k]; };
    const eyeOf = G => [G.tx, G.ty + (G.flags & 1024 ? .42 : G.flags & 4 ? 1.27 : 1.62), G.tz];
    const reachOk = (G, x, y, z) => { const [ex, ey, ez] = eyeOf(G); return Math.hypot(x + .5 - ex, y + .5 - ey, z + .5 - ez) <= (st.creative ? REACH_C : REACH) + SLACK; };
    function deny(G, cells, refund, why){
      H.stats.denied++; H.note(G, 'deny', cells[0], why);
      const c = [];
      for (const [x, y, z] of cells) { const v = st.W.raw(x, y, z); if (v >= 0) c.push([x, y, z, pv(v)]); }
      sendJ(G, { t: 'deny', c, s: refund || null, why: why || '' });
    }
    // журнал последних просьб гостей (для проверок: GAME_IMPL.kubomir._test.coop().journal)
    H.journal = [];
    H.note = (G, what, c, why) => { H.journal.push([G.pid, what, c ? c.join(',') : '', why || '']); if (H.journal.length > 60) H.journal.shift(); };
    function handle(G, m){
      const W = st.W, ints = (...a) => a.every(Number.isInteger);
      if (m.t === 'brk' || m.t === 'put' || m.t === 'door') H.note(G, m.t, [m.x, m.y, m.z], m.it || m.tool || '');
      switch (m.t) {
        case 'ck': {   // чанки с правками: по очереди, не больше 128 за раз
          if (!Array.isArray(m.k)) return;
          for (const k of m.k.slice(0, 128)) { if (!Array.isArray(k) || !ints(k[0], k[1])) continue; const s = k[0] + '|' + k[1]; if (!G.ckSet.has(s)) { G.ckSet.add(s); G.ckQ.push(s); } }
          return;
        }
        case 'brk': {
          const { x, y, z } = m; if (!ints(x, y, z)) return;
          const v = W.raw(x, y, z);
          if (v <= 0 || !reachOk(G, x, y, z)) { deny(G, [[x, y, z], [x, y + 1, z], [x, y - 1, z]], null, 'reach'); return; }
          const b = V.blocks[v & 0xfff], tool = typeof m.tool === 'string' ? m.tool : '';
          const need = st.creative ? .12 : Math.max(.04, hooks.breakTime(b, tool) * .7);
          if (fill(G, 'dig', 'digT', 1, 1.6) < need) { deny(G, [[x, y, z], [x, y + 1, z], [x, y - 1, z]], null, 'fast'); return; }
          if (H.locks.has(x + '|' + y + '|' + z)) { deny(G, [[x, y, z]], null, 'busy'); return; }
          G.dig -= need;
          if (!hooks.breakAs(G, x, y, z, tool)) deny(G, [[x, y, z], [x, y + 1, z], [x, y - 1, z]], null, 'no');
          return;
        }
        case 'kc': {   // T-138 F5: удар гостя по надрубаемому блоку / живому стволу — один удар; срез, рубку и «сломан» решает хозяин
          const { x, y, z } = m; if (!ints(x, y, z) || !Array.isArray(m.n) || !ints(m.n[0], m.n[1], m.n[2])) return;
          const T = st.topple; if (!T?.hostHit) return;
          const v = W.raw(x, y, z);
          if (v <= 0 || !reachOk(G, x, y, z)) { deny(G, [[x, y, z]], null, 'reach'); return; }
          if (H.locks.has(x + '|' + y + '|' + z)) return;
          const b = V.blocks[v & 0xfff], tool = typeof m.tool === 'string' && V.item(m.tool) ? m.tool : '';
          const need = hooks.breakTime(b, tool), hit = { x, y, z, v, nx: clamp(m.n[0], -1, 1), ny: clamp(m.n[1], -1, 1), nz: clamp(m.n[2], -1, 1) };
          const per = T.hitCost(hit, b, need), cost = (per > 0 ? per : need) * .7;
          if (!(cost < Infinity) || fill(G, 'dig', 'digT', 1, 1.6) < cost) { H.stats.denied++; H.note(G, 'kc', [x, y, z], 'fast'); return; }
          G.dig -= cost;
          const r = per > 0 ? T.hostHit(hit, b, need, { x: G.tx, z: G.tz }) : 1;   // у хозяина блок не надрубается — «сломать» как обычно
          if (r === 1 && !hooks.breakAs(G, x, y, z, tool)) deny(G, [[x, y, z]], null, 'no');
          return;
        }
        case 'put': {
          const { x, y, z } = m; if (!ints(x, y, z, m.v)) return;
          const refund = typeof m.it === 'string' && V.item(m.it) && !st.creative ? { id: m.it, n: 1 } : null;
          const cells = [[x, y, z], [x, y + 1, z]];
          if (!reachOk(G, x, y, z) || fill(G, 'puts', 'putT', 8, 10) < 1) { deny(G, cells, refund, 'reach'); return; }
          G.puts -= 1;
          if (!hooks.placeAs(G, x, y, z, toLocal(m.v >>> 0), m.it, Number.isInteger(m.v2) ? toLocal(m.v2 >>> 0) : null)) deny(G, cells, refund, 'no');
          return;
        }
        case 'door': case 'ice': {
          const { x, y, z } = m; if (!ints(x, y, z)) return;
          if (!reachOk(G, x, y, z) || fill(G, 'acts', 'actT', 5, 6) < 1) { deny(G, [[x, y, z], [x, y + 1, z], [x, y - 1, z]], null, 'reach'); return; }
          G.acts -= 1;
          if (m.t === 'door') { if (!hooks.doorAs(G, x, y, z)) deny(G, [[x, y, z], [x, y + 1, z], [x, y - 1, z]], null, 'no'); }
          else if (hooks.iceAs(G, x, y, z)) toAll({ t: 'ice', x, y, z, at: Date.now() }, G);
          return;
        }
        case 'fire': {   // огниво гостя (T-022d): поджечь блок — решает хозяин (дальность, частота); пламя гость увидит правками
          const { x, y, z } = m; if (!ints(x, y, z)) return;
          if (!reachOk(G, x, y, z) || fill(G, 'acts', 'actT', 5, 6) < 1) return;
          G.acts -= 1; H.note(G, 'fire', [x, y, z]);
          hooks.fireAs?.(G, x, y, z, clamp(m.nx | 0, -1, 1), clamp(m.ny | 0, -1, 1), clamp(m.nz | 0, -1, 1));
          return;
        }
        case 'drop': {
          const s = m.s, p = m.p, it = s && V.item(s.id);
          if (!it || !Number.isInteger(s.n) || s.n < 1 || s.n > it.stack || !Array.isArray(p) || !p.every(fin) || fill(G, 'drops', 'dropT', 4, 8) < 1) return;
          G.drops -= 1;
          const [px, py, pz] = p; if (Math.hypot(px - G.tx, pz - G.tz) > 6 || Math.abs(py - G.ty) > 6) return;
          const vel = Array.isArray(m.vel) && m.vel.length === 3 && m.vel.every(fin) ? m.vel.map(v => clamp(v, -12, 12)) : null;
          st.ents?.addItem(px, py, pz, { id: s.id, n: s.n, d: clamp(s.d | 0, 0, 100000) }, !vel, vel);
          return;
        }
        case 'hit': {
          const mob = st.ents?.mobs.find(q => q.id === m.id);
          if (!mob || Math.hypot(mob.x - G.tx, mob.z - G.tz) > 7 || Math.abs(mob.y - G.ty) > 5 || fill(G, 'hits', 'hitT', 4, 5) < 1) return;
          G.hits -= 1;
          const res = { dmg: clamp(+m.dmg || 0, 0, 30), kx: clamp(+m.kx || 0, -14, 14), kz: clamp(+m.kz || 0, -14, 14), ky: clamp(+m.ky || 0, 0, 8), stagger: m.stg ? 1 : 0 };
          if (mob.cf && res.stagger) { mob.stag = Math.max(mob.stag || 0, mob.stagT || .4); mob.mv = null; }
          st.ents.damage(mob, res.dmg, 0, 0, 'guest', res);
          return;
        }
        case 'shot': {
          const p = m.p, v = m.v;
          if (!Array.isArray(p) || !Array.isArray(v) || !p.every(fin) || !v.every(fin) || fill(G, 'hits', 'hitT', 4, 5) < 1) return;
          G.hits -= 1;
          if (Math.hypot(p[0] - G.tx, p[2] - G.tz) > 4) return;
          const sp = Math.hypot(v[0], v[1], v[2]), k = sp > 45 ? 45 / sp : 1;
          H.shooter = G;
          try { st.ents?.shoot(p[0], p[1], p[2], v[0] * k, v[1] * k, v[2] * k, clamp(m.dmg | 0, 1, 12), { pick: !st.creative, crit: !!m.crit }); } finally { H.shooter = null; }
          return;
        }
        case 'parry': {
          const mob = st.ents?.mobs.find(q => q.id === m.id);
          if (!mob || Math.hypot(mob.x - G.tx, mob.z - G.tz) > 6) return;
          mob.vx += clamp(+m.kx || 0, -12, 12); mob.vz += clamp(+m.kz || 0, -12, 12); mob.vy = Math.max(mob.vy, 3); mob.wind = 0;
          if (mob.cf) { mob.stag = Math.max(mob.stag || 0, clamp(+m.s || 0, 0, 2)); mob.mv = null; }
          return;
        }
        case 'open': {
          const { x, y, z } = m; if (!ints(x, y, z)) return;
          const v = W.raw(x, y, z), b = v > 0 ? V.blocks[v & 0xfff] : null, kind = b?.ui === 'chest' || b?.ui === 'furnace' ? b.ui : '';
          if (!kind || !reachOk(G, x, y, z)) { sendJ(G, { t: 'tile', x, y, z, ok: false, why: 'far' }); return; }
          const k = x + '|' + y + '|' + z, L = H.locks.get(k);
          if (L && L !== G.id) { sendJ(G, { t: 'tile', x, y, z, ok: false, who: L === 'host' ? myNick() : (H.guests.get(L)?.nick || 'другой игрок') }); return; }
          if (G.lock && G.lock !== k) unlock(G.lock, G);
          H.locks.set(k, G.id); G.lock = k;
          const tile = W.tile(x, y, z, () => kind === 'chest' ? { items: new Array(27).fill(null) } : { in: null, fuel: null, out: null, burn: 0, burnMax: 0, cook: 0 });
          H.ltile.set(k, tile);   // правки гостя — в эту плитку, даже если обрушение её сдвинет (T-124)
          sendJ(G, { t: 'tile', x, y, z, ok: true, kind, tile: JSON.parse(JSON.stringify(tile)) });
          return;
        }
        case 'tset': case 'close': {
          const { x, y, z } = m; if (!ints(x, y, z)) return;
          const k = x + '|' + y + '|' + z;
          if (H.locks.get(k) !== G.id) return;
          setTile(x, y, z, m.tile);
          if (m.t === 'close') unlock(k, G);
          return;
        }
        case 'inv': {
          if (Number.isInteger(m.rd) && m.rd > 0) G.rd = clamp(m.rd, 2, 12);   // дальность гостя (мог поменять в настройках)
          const d = m.d; if (!d || typeof d !== 'object' || !G.pkey) return;
          const stack = s => s && V.item(s.id) && Number.isInteger(s.n) && s.n > 0 ? { id: s.id, n: Math.min(s.n, V.item(s.id).stack), d: clamp(s.d | 0, 0, 100000) } : null;
          const rec = { x: fin(d.x) ? d.x : null, y: fin(d.y) ? d.y : null, z: fin(d.z) ? d.z : null, yaw: fin(d.yaw) ? d.yaw : 0, pitch: fin(d.pitch) ? d.pitch : 0, hp: clamp(+d.hp || 20, 0, 20), food: clamp(+d.food || 20, 0, 20), sat: clamp(+d.sat || 5, 0, 20),
            sel: clamp(d.sel | 0, 0, 8), inv: Array.isArray(d.inv) ? d.inv.slice(0, 36).map(stack) : [], off: stack(d.off), fly: !!d.fly, at: Date.now(),
            // T-049: аксессуары (только вещи-аксессуары, по одной) и данные помощников гостя (простые данные, ≤ 32 КБ) — его, хозяин только хранит
            acc: Array.isArray(d.acc) ? d.acc.slice(0, 12).map(s => { const q = stack(s); return q && V.item(q.id)?.acc ? { id: q.id, n: 1, d: q.d } : null; }) : [],
            ext: window.D37E?.host?.cleanExt ? window.D37E.host.cleanExt(d.ext, 32768) : {} };
          const all = meta.coopPlayers = meta.coopPlayers || {};
          all[G.pkey] = rec;
          const ks = Object.keys(all); if (ks.length > 32) { ks.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)); for (const q of ks.slice(0, ks.length - 32)) delete all[q]; }
          return;
        }
        case 'room': { G.room.e = clamp(m.e | 0, 0, 36); G.room.p = new Set(Array.isArray(m.p) ? m.p.filter(s => typeof s === 'string').slice(0, 64) : []); return; }
        case 'zz': { const t = now(); if (t - (G.zzT || 0) < 400) return; G.zzT = t; G.zz = !!m.on; hooks.sleepVote?.(); return; }   // T-049: гость спит / проснулся
        case 'chat': {
          const t = now(); if (t - G.chatT < 1000) return; G.chatT = t;
          const text = cleanText(m.text, 120); if (!text) return;
          toAll({ t: 'chat', pid: G.pid, text });
          hooks.log?.('💬 ' + G.nick + ': ' + kidSafe(text));
          return;
        }
        case 'emo': { if (typeof m.e !== 'string' || m.e.length > 8) return; toAll({ t: 'emo', pid: G.pid, e: m.e }, G); return; }
        case 'bye': gone(G, 'вышел'); return;
      }
    }
    // плитка от того, кто держит её открытой: только известные поля, вещи — настоящие и не больше стопки
    function setTile(x, y, z, t){
      if (!t || typeof t !== 'object') return;
      const V2 = VX(), stack = s => s && V2.item(s.id) && Number.isInteger(s.n) && s.n > 0 ? { id: s.id, n: Math.min(s.n, V2.item(s.id).stack), d: clamp(s.d | 0, 0, 100000) } : null;
      const k = x + '|' + y + '|' + z, cur = H.ltile.get(k) || st.W.tile(x, y, z); if (!cur) return;
      if (Array.isArray(cur.items)) { if (Array.isArray(t.items)) for (let i = 0; i < cur.items.length; i++) cur.items[i] = stack(t.items[i]); }
      else { cur.in = stack(t.in); cur.fuel = stack(t.fuel); cur.out = stack(t.out); cur.burn = clamp(+t.burn || 0, 0, 1e4); cur.burnMax = clamp(+t.burnMax || 0, 0, 1e4); cur.cook = clamp(+t.cook || 0, 0, 1e3); }
      if (H.pend.has(k)) return;   // плитку обрушение высыпет, когда гость закроет окно (в мире её нет)
      const at = H.lat.get(k), p = at ? at.split('|').map(Number) : null, mx = p ? p[0] : x, mz = p ? p[2] : z;   // сдвинуло — она там
      st.W.markTile(mx, mz);
      const c = st.W.chunkAt(mx, mz); if (c) st.unsaved.add(c.key);
    }
    function unlock(k, G){
      const who = G ? G.id : 'host';
      if (H.locks.get(k) === who) H.locks.delete(k);
      if (G && G.lock === k) G.lock = null;
      const a = H.lat.get(k); if (a) { H.lat.delete(k); if (H.locks.get(a) === who) H.locks.delete(a); }
      H.ltile.delete(k);
      const pd = H.pend.get(k); if (pd) { H.pend.delete(k); try { pd.spill(); } catch (e) { console.error(e); } }   // окно закрыто — высыпать (с правками гостя)
      const [x, y, z] = k.split('|').map(Number);
      const v = st.W.raw(x, y, z); if (v > 0 && /^furnace/.test(V.blocks[v & 0xfff].name)) st.ents?.furnaces?.add(x + ',' + y + ',' + z);   // печь — снова греет у хозяина
    }
    // ── обрушение сдвинуло плитку (kubomir-support.js, T-124): окно гостя на ней закрывается (сообщение 'shut'), его правки идут в саму
    // плитку (H.ltile); to: undefined — плитку взяли (кусок падает), [x, y, z] — легла там (там тоже «занято», пока окно открыто),
    // null — высыпается: spill() — когда гость закроет окно (или уйдёт; не дольше 10 с) → true (высыпать сейчас не надо) ──
    H.tileMoved = (x, y, z, tile, to, spill) => {
      if (H.closed) return false;
      const k = x + '|' + y + '|' + z, L = H.locks.get(k);
      if (!L || L === 'host') return false;
      const G = H.guests.get(L); if (!G) return false;
      if (tile && !H.ltile.has(k)) H.ltile.set(k, tile);
      if (to === undefined) { sendJ(G, { t: 'shut', x, y, z }); return false; }
      if (to) { const k2 = to[0] + '|' + to[1] + '|' + to[2]; H.lat.set(k, k2); if (!H.locks.has(k2)) H.locks.set(k2, L); return false; }
      if (typeof spill !== 'function') return false;
      H.pend.set(k, { spill, t: now() }); sendJ(G, { t: 'shut', x, y, z });
      return true;
    };
    // своё окно сундука или печи: занято гостем — нельзя; открыл — моё, пока окно открыто
    H.tileBusy = (x, y, z) => { const L = H.locks.get(x + '|' + y + '|' + z); return L && L !== 'host' ? (H.guests.get(L)?.nick || 'другой игрок') : ''; };
    H.lockHost = (x, y, z) => { const k = x + '|' + y + '|' + z; if (H.locks.has(k) && H.locks.get(k) !== 'host') return false; H.locks.set(k, 'host'); H.hostLock = k; return true; };

    // ── правки мира → гостям (только тем, у кого этот чанк рядом); новый изменённый чанк — всем (чтобы попросили) ──
    function onEdit(x, y, z, was, v){
      if (H.closed) return;
      const cx = x >> 4, cz = z >> 4, k = cx + '|' + cz;
      if (!H.edited.has(k)) { H.edited.add(k); toAll({ t: 'ek', k: [cx, cz] }); }
      let q = H.editQ.get(k); if (!q) H.editQ.set(k, q = []);
      q.push(x, y, z, pv(v)); H.editN++;
    }
    function flushEdits(){
      if (!H.editN) return;
      for (const G of H.guests.values()) {
        if (!G.ready) continue;
        const gcx = Math.floor(G.x) >> 4, gcz = Math.floor(G.z) >> 4, r = G.rd + 4;   // поток гостя держит чанки до rd + 3 (+1 — место гостя с запаздыванием); было rd + 2 — край оставался без правок, и мир расходился
        W8.reset(); W8.u8(T_EDITS); W8.u16(0); let n = 0;
        for (const [k, q] of H.editQ) {
          const i = k.indexOf('|'), cx = +k.slice(0, i), cz = +k.slice(i + 1);
          if (Math.abs(cx - gcx) > r || Math.abs(cz - gcz) > r) continue;
          for (let j = 0; j < q.length; j += 4) {
            W8.i32(q[j]); W8.u8(q[j + 1]); W8.i32(q[j + 2]); W8.u16(q[j + 3]); n++;
            if (n >= 4000) { W8.put16(1, n); out(G, W8.view().slice()); H.stats.edits += n; H.stats.editBytes += W8.o; W8.reset(); W8.u8(T_EDITS); W8.u16(0); n = 0; }
          }
        }
        if (n) { W8.put16(1, n); out(G, W8.view().slice()); H.stats.edits += n; H.stats.editBytes += W8.o; }
      }
      H.editQ.clear(); H.editN = 0;
    }
    // ── чанк по просьбе гостя: из памяти (если загружен у хозяина) или из сохранения; больше 1 КБ — сжатый ──
    function chunkReply(G, k){
      const i = k.indexOf('|'), cx = +k.slice(0, i), cz = +k.slice(i + 1), c = st.W.chunk(cx, cz);
      const mem = c && c.ready && c.gen && !c.loading ? hooks.chunkRec(c) : null;   // снимок — сейчас (правки после него уйдут следом, по порядку)
      G.ckBusy++;
      outAsync(G, (async () => {
        try {
          const rec = mem || await V.store.chunk(meta.id, cx, cz).catch(() => null);
          const body = chunkBody(rec);
          const gz = body.length > 1024 && window.D37Cloud?.canZip?.() ? await window.D37Cloud.gzip(body).catch(() => null) : null;
          const pay = gz && gz.length < body.length ? gz : body;
          const u = new Uint8Array(14 + pay.length), dv = new DataView(u.buffer);
          u[0] = T_CHUNK; dv.setInt32(1, cx, true); dv.setInt32(5, cz, true); u[9] = pay === gz ? 1 : 0; dv.setUint32(10, pay.length, true); u.set(pay, 14);
          H.stats.chunks++; H.stats.chunkBytes += u.length;
          return u;
        } finally { G.ckBusy--; G.ckSet.delete(k); }
      })());
    }
    // ── снимок для гостя: игроки, время, мобы и вещи рядом с ним ──
    const MF = m => (m.hurtT > 0 ? 1 : 0) | (m.wind > 0 ? 2 : 0) | (m.lunge > 0 ? 4 : 0) | (m.stag > 0 ? 8 : 0) | (m.state === 'chase' ? 16 : 0) | (m.ground ? 32 : 0) | (m.burnT > 0 ? 64 : 0);
    function writeMe(w){
      const P = st.P, [mi, oi] = handIds(st), I = items();
      w.u8(0); w.f32(P.x); w.f32(P.y); w.f32(P.z); w.u16(Math.round(((st.rig.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 65535)); w.i16((st.rig.fp || 0) * 1e4);
      w.u16(myFlags(st)); w.u16(I.get(mi) || 0); w.u16(I.get(oi) || 0); w.u32(myPose(st)); w.u8(clamp(Math.round(P.hp), 0, 255));
    }
    function snapshot(G, t){
      const w = WS.reset(), I = items();
      w.u8(T_SNAP); w.u16(G.snapSeq = (G.snapSeq + 1) & 0xffff); w.u32(Math.round(t - H.t0)); w.f32(st.R.lighting.time); w.u16(meta.day || 1);
      const np = w.o; w.u8(0); let n = 1;
      writeMe(w);
      for (const O of H.guests.values()) if (O.ready && O !== G) {
        w.u8(O.pid); w.f32(O.x); w.f32(O.y); w.f32(O.z); w.u16(Math.round(((O.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 65535)); w.i16(O.pitch * 1e4);
        w.u16(O.flags); w.u16(I.get(O.main) || 0); w.u16(I.get(O.off) || 0); w.u32(O.pose); w.u8(O.hp); n++;
      }
      w.put8(np, n);
      const E = st.ents, nm = w.o; w.u16(0); let k = 0;
      if (E) for (const m of E.mobs) {
        if (Math.abs(m.x - G.x) > MOB_R || Math.abs(m.z - G.z) > MOB_R || k >= 400) continue;
        w.u16(m.id); w.u8(MOB_I.get(m.type) ?? 0); w.f32(m.x); w.f32(m.y); w.f32(m.z); w.u8(Math.round(((m.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 255)); w.u8(MF(m)); k++;
      }
      w.put16(nm, k);
      // вещи — через снимок (лежат — реже не нужно: снимок маленький), не больше 200 ближних
      const ni = w.o; w.u16(0); let q = 0;
      if (E) for (const e of E.items) {
        if (Math.abs(e.x - G.x) > ITEM_R || Math.abs(e.z - G.z) > ITEM_R || q >= 200) continue;
        w.u16(e.id || 0); w.u16(I.get(e.s.id) || 0); w.u8(Math.min(255, e.s.n)); w.f32(e.x); w.f32(e.y); w.f32(e.z); q++;
      }
      w.put16(ni, q);
      H.R.send(G.id, w.view(), true);
      H.stats.snaps++; H.stats.snapBytes += w.o;
    }
    function mobDied(m){ for (const G of H.guests.values()) if (G.ready && Math.abs(m.x - G.x) < MOB_R && Math.abs(m.z - G.z) < MOB_R) sendJ(G, { t: 'mk', id: m.id, kx: +(m.vx || 0).toFixed(2), kz: +(m.vz || 0).toFixed(2) }); }
    function fell(cells, pivot, dir, drop){
      const a = new Int32Array(cells.length); for (let i = 0; i < cells.length; i += 4) { a[i] = cells[i]; a[i + 1] = cells[i + 1]; a[i + 2] = cells[i + 2]; a[i + 3] = pv(cells[i + 3]); }
      const o = { t: 'fell', c: b64(new Uint8Array(a.buffer)), p: [pivot.x, pivot.y, pivot.z], d: [dir.x, dir.z], k: drop ? 'd' : undefined };   // k: 'd' — обрушение (падает целым вниз)
      for (const G of H.guests.values()) if (G.ready && Math.abs(pivot.x - G.x) < MOB_R && Math.abs(pivot.z - G.z) < MOB_R) sendJ(G, o);
    }
    // T-138 F5: события физики хозяина (срезы, крен и падение, обломки — kubomir-topple.js netTake) — после правок того же окна
    function ktFlush(){
      const e = st.topple?.netTake?.(pv, b64); if (!e) return;
      if (ready().length) toAll({ t: 'kt', e });
    }
    function shotOut(x, y, z, vx, vy, vz, o, by){
      const m = { t: 'shot', p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], v: [+vx.toFixed(2), +vy.toFixed(2), +vz.toFixed(2)], crit: !!o?.crit };
      for (const G of H.guests.values()) if (G.ready && G !== by && Math.abs(x - G.x) < MOB_R && Math.abs(z - G.z) < MOB_R) sendJ(G, m);
    }
    // ── шаг (из шага логики хозяина, 60 раз в секунду) ──
    const EXTRA = [];
    H.step = dt => {
      if (H.closed || !H.R) return;
      const t = now();
      if (t - H.editT >= EDIT_MS) { H.editT = t; flushEdits(); ktFlush(); }
      for (const G of H.guests.values()) {
        if (!G.ready) continue;
        while (G.ckQ.length && G.ckBusy < 4 && H.R.backlog(G.id) < 384e3) chunkReply(G, G.ckQ.shift());
        const p2p = H.R.mode(G.id) === 'p2p', iv = p2p ? SNAP_MS : SNAP_RELAY_MS;
        if (t - G.snapT >= iv) { G.snapT = t; snapshot(G, t); }
      }
      // где гости — там и чанки у хозяина (раз в 0,5 с)
      if (t - H.extraT > 500) {
        H.extraT = t; EXTRA.length = 0;
        for (const G of H.guests.values()) if (G.ready && G.ty > -900) { const e = G._e || (G._e = [0, 0]); e[0] = G.tx; e[1] = G.tz; EXTRA.push(e); }
        if (st.ST) st.ST.extra = EXTRA;
      }
      // своё окно закрыл — сундук свободен
      if (H.hostLock && !st.ui?.isOpen()) { unlock(H.hostLock, null); H.hostLock = null; }
      // высыпать после обрушения: гость не закрыл окно за 10 с — высыпать без его последних правок (дальше правки не принимаются)
      if (H.pend.size) for (const [k, p] of H.pend) if (t - p.t > 10000) { const L = H.locks.get(k), G = L && L !== 'host' ? H.guests.get(L) : null; if (G) unlock(k, G); else { H.pend.delete(k); H.ltile.delete(k); try { p.spill(); } catch (e) { console.error(e); } } }
      H.R.flush();
    };
    H.frame = (dt, t) => { if (!H.closed) H.view?.frame(dt, t); };
    H.chat = text => { const s = cleanText(text, 120); if (!s) return; toAll({ t: 'chat', pid: 0, text: s }); hooks.log?.('💬 ' + nickOf(myNick()) + ': ' + s); };
    H.weather = f => toAll({ t: 'wf', f: f ?? null });   // /weather у хозяина
    H.gameMode = m => toAll({ t: 'mode', m });   // /gamemode у хозяина
    H.players = () => [{ pid: 0, nick: nickOf(myNick()), host: true, me: true }].concat(ready().map(G => ({ pid: G.pid, nick: G.nick, mode: H.R?.mode(G.id) || 'relay', ko: !!(G.flags & 64) })));
    H.sleepers = () => { let n = 0; for (const G of ready()) if (G.zz) n++; return n; };   // T-049: сколько гостей спит на лежанках
    H.link = () => linkFor(H.code);
    H.close = (why, quiet) => {
      if (H.done) return;
      H.done = H.closed = true;
      document.removeEventListener('visibilitychange', onVis);
      try { if (H.R && !quiet) { const u = J({ t: 'bye', why: why || 'host' }); for (const G of H.guests.values()) if (G.ready) H.R.send(G.id, u, false); H.R.flush(); } } catch (e) {}
      const R = H.R; H.R = null;
      setTimeout(() => { try { R?.close(); } catch (e) {} }, quiet ? 0 : 400);
      const i = st.W.listeners.indexOf(onEdit); if (i >= 0) st.W.listeners.splice(i, 1);
      const E = st.ents;
      if (E) { E.others.length = 0; E.hookHurtRemote = null; E.hookGiveRemote = null; E.hookKill = H.kill0; if (H.fall0) E.fallGroup = H.fall0; if (H.shoot0) E.shoot = H.shoot0; E.isLocked = null; }
      if (st.ST) st.ST.extra = [];
      H.view?.clear();
      for (const p of H.pend.values()) try { p.spill(); } catch (e) { console.error(e); }
      H.pend.clear(); H.ltile.clear(); H.lat.clear();
      H.guests.clear(); H.pidOf.clear(); H.locks.clear();
      hooks.changed?.();
    };
    H.stat = () => Object.assign({}, H.stats, { guests: ready().length, net: H.R?.stats?.() || null });
    return H;
  }

  // ═══════════════════════ ГОСТЬ ═══════════════════════
  function join(code, hooks){
    const V = VX();
    const G = { isHost: false, guest: true, code, R: null, st: null, pid: -1, hostId: null, meta: null, edited: new Set(), wait: new Map(), ckQ: [], stale: new Set(),
      items: null, closed: false, started: false, lastHost: now(), stT: 0, invT: 0, roomK: '', seqIn: -1, nonce: '', pkey: '', paused: false, view: null, opens: new Map(), lock: null, tset: 0, ckT: 0,
      stats: { snaps: 0, snapBytes: 0, edits: 0, chunks: 0, chunkBytes: 0, joinMs: 0, t0: now() } };
    const WS = writer(256);
    const pv = v => (((G.st.remapOut[v & 0xfff] ?? 0) & 0xfff) | (v & 0xf000)) >>> 0;
    const toLocal = p => (((G.st.remapIn[p & 0xfff] ?? V.ID.missing) & 0xfff) | (p & 0xf000)) >>> 0;
    const toHost = o => { if (G.R && G.hostId && !G.closed) G.R.send(G.hostId, J(o), false); };
    G.start = async () => {
      G.nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      G.pkey = await playerKey(code);
      G.R = CO().room({ game: GAME, code, host: false, max: MAX, me: { key: presKey(code), nick: myNick() },
        onHost: hid => { G.hostId = hid; if (!hid) { if (G.started) end('host', '🏠 Хозяин вышел из мира'); else hooks.status?.('wait'); return; } hooks.status?.('connecting'); hi(); },
        onMsg: recv, onGap: () => toHost({ t: 'ck', k: [...G.edited].filter(k => G.st?.W.chunk(...k.split('|').map(Number))?.ready).slice(0, 128).map(k => k.split('|').map(Number)) }),
        onError: r => end(r, r === 'dup' ? 'Ты уже в этом мире в другой вкладке' : 'Нет связи с миром друга — проверь интернет и попробуй ещё раз') });
      // пока мир не открыт, цикла игры нет: «hi» без ответа 3 с — ещё раз (через запасной канал первое сообщение может потеряться)
      G.hiTimer = setInterval(() => { if (G.closed || G.started) { clearInterval(G.hiTimer); return; } if (G.hostId && now() - (G.hiT || 0) > 3000) hi(); }, 1000);
      return G;
    };
    function hi(){ G.hiT = now(); toHost({ t: 'hi', v: PROTO, nonce: G.nonce, nick: myNick(), look: myLook(), pkey: G.pkey, rd: hooks.rd?.() || 6 }); }
    function end(why, text){ if (G.closed) return; hooks.ended?.(text || '🏠 Игра закончилась', why); G.close(true); }
    async function welcome(m){
      if (G.started) return;
      const ok = await CO().verify(code, m.pub, G.nonce + '|' + code, m.proof);
      if (!ok) { G.R?.markFake(G.hostId); hooks.status?.('wait'); return; }   // не хозяин этого мира — ждём настоящего
      const w = m.world || {};
      if (typeof w.seed !== 'string' && typeof w.seed !== 'number') return;
      G.pid = m.pid | 0; G.items = Array.isArray(m.items) ? m.items.map(String) : []; G.kt = Number.isInteger(m.kt) ? m.kt : 0;
      try { const u = unb64(m.edited || ''), a = new Int16Array(u.buffer, u.byteOffset, u.byteLength >> 1); for (let i = 0; i + 1 < a.length; i += 2) G.edited.add(a[i] + '|' + a[i + 1]); } catch (e) {}
      G.meta = { id: 'coop-' + code, coop: { guest: true, code }, name: String(w.name || 'Мир друга').slice(0, 40), seed: w.seed, mode: w.mode === 'creative' ? 'creative' : 'survival', diff: ['peaceful', 'easy', 'normal', 'hard'].includes(w.diff) ? w.diff : 'easy',
        genVer: w.genVer >= 2 && w.genVer <= 4 ? w.genVer | 0 : 1, gen: w.gen === 'void' ? 'void' : undefined, mc: w.mc && Array.isArray(w.mc.blocks) ? { blocks: w.mc.blocks.slice(0, 2000).map(String) } : undefined,
        palette: Array.isArray(w.palette) ? w.palette.slice(0, 4096).map(String) : null, spawn: w.spawn && fin(w.spawn.x) ? { x: w.spawn.x, y: w.spawn.y, z: w.spawn.z } : null, time: fin(w.time) ? w.time : 8, day: w.day | 0 || 1,
        ice: w.ice || undefined, snow: w.snow || undefined, mods: [], tips: false, cheats: !!w.cheats, played: Date.now(), support: w.support === 'soft' || w.support === 'real' ? w.support : undefined };
      G.seasons = w.seasons; G.wf = w.wf;
      G.you = m.you || null; G.at = m.at || null;
      G.hostInfo = m.host; G.players0 = Array.isArray(m.players) ? m.players : [];
      G.started = true; G.stats.joinMs = Math.round(now() - G.stats.t0);
      hooks.start?.(G.meta, G);
    }
    // мир гостя запущен (startWorld): свои человечки других игроков, подсказки движку
    G.attach = st => {
      G.st = st;
      G.view = peers(st);
      if (G.hostInfo) G.view.add(0, G.hostInfo.nick, G.hostInfo.look);
      for (const p of G.players0) if (p && Number.isInteger(p.pid) && p.pid !== G.pid) G.view.add(p.pid, p.nick, p.look);
      const E = st.ents;
      if (E) {
        E.client = true;
        E.hookHit = (mob, dmg, nx, nz, res) => toHost({ t: 'hit', id: mob.id, dmg: +(+dmg || 0).toFixed(2), kx: +(res?.kx || nx * 6 || 0).toFixed(2), kz: +(res?.kz || nz * 6 || 0).toFixed(2), ky: +(res?.ky || 0).toFixed(2), stg: res?.stagger ? 1 : 0 });
        E.hookShoot = (x, y, z, vx, vy, vz, dmg, o) => toHost({ t: 'shot', p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], v: [+vx.toFixed(2), +vy.toFixed(2), +vz.toFixed(2)], dmg: dmg | 0, crit: !!o?.crit });
        E.furnaces.clear();
      }
      if (G.seasons && st.WX?.setSeasons) { st.seasons = G.seasons; st.WX.setSeasons(G.seasons); }
      if (st.WX && G.wf !== undefined) st.WX.force = G.wf;
      // плитка (сундук, печь), которую держишь открытой: правки окна — хозяину (раз в 0,15 с)
      const mk = st.W.markTile.bind(st.W);
      st.W.markTile = (x, z) => { mk(x, z); if (G.lock && (Math.floor(x) >> 4) === (G.lock[0] >> 4) && (Math.floor(z) >> 4) === (G.lock[2] >> 4)) G.tset = G.tset || now(); };
    };
    // поток мира: чанк с правками хозяина — спросить (ответ — ниже); остальное — по зерну
    G.loadChunk = c => {
      const k = c.cx + '|' + c.cz;
      if (!G.edited.has(k)) return null;
      return new Promise(res => { G.wait.set(k, { res, t: now(), n: 0 }); G.ckQ.push(k); });
    };
    function applyChunk(cx, cz, rec){
      const st = G.st; if (!st) return;
      const k = cx + '|' + cz, w = G.wait.get(k);
      const rec2 = { cx, cz, e: rec.e, t: rec.t, b: rec.b };
      if (w) { G.wait.delete(k); w.res(rec2); return; }
      const c = st.W.chunk(cx, cz); if (!c || !c.ready || !c.gen) return;   // уже выгрузили — попросим снова, когда понадобится
      hooks.applySaved?.(c, rec2);   // поверх: всё, что у хозяина (лишнего не бывает — правки только дописываются)
      c.calcHmap(); c.rev = ++st.W.rev; c.dirty = c.rev; c.urgent = 2;
      st.ST.touch(cx * 16, cz * 16, 2); st.ST.touch(cx * 16 + 15, cz * 16 + 15, 2);
    }
    // ── приём ──
    function recv(from, u8){
      if (G.closed || from !== G.hostId) return;
      G.lastHost = now();
      const t = u8[0];
      if (t === T_JSON) { const m = unJ(u8); if (m && typeof m.t === 'string') try { handle(m); } catch (e) { console.warn('Кубомир вместе:', e); } return; }
      try {
        if (t === T_EDITS) { edits(u8); return; }   // и до запуска мира: какие чанки с правками — запомнить
        if (!G.started || !G.st) return;
        if (t === T_SNAP) { G.stats.snaps++; G.stats.snapBytes += u8.length; snap(u8); }
        else if (t === T_CHUNK) chunk(u8);
      } catch (e) { console.warn('Кубомир вместе: пакет', t, e); }
    }
    function edits(u8){
      const W = G.st?.W; rd(u8); r8(); const n = r16();
      for (let i = 0; i < n; i++) {
        const x = ri32(), y = r8(), z = ri32(), p = r16();
        const k = (x >> 4) + '|' + (z >> 4);
        G.edited.add(k);
        if (!W || G.wait.has(k)) continue;   // мира ещё нет / чанк ждёт ответа — в нём это уже будет
        const c = W.chunkAt(x, z); if (!c || !c.ready || !c.gen) continue;
        W.set(x, y, z, toLocal(p), { urgent: 2, net: 1 });
      }
      G.stats.edits += n;
    }
    async function chunk(u8){
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), cx = dv.getInt32(1, true), cz = dv.getInt32(5, true), gz = u8[9] === 1, len = dv.getUint32(10, true);
      if (14 + len > u8.length) return;
      let body = u8.subarray(14, 14 + len);
      G.stats.chunks++; G.stats.chunkBytes += u8.length;
      if (gz) body = await window.D37Cloud.gunzip(body, 64e6);
      if (G.closed) return;
      applyChunk(cx, cz, chunkParse(body));
    }
    let seqLast = -1;
    function snap(u8){
      const st = G.st; rd(u8); r8();
      const seq = r16(); if (seqLast >= 0 && ((seq - seqLast) & 0xffff) > 32768) return;   // старый снимок (пришёл позже нового)
      seqLast = seq;
      r32(); const time = rf(), day = r16();
      if (fin(time) && time >= 0 && time < 24 && Math.abs(time - st.R.lighting.time) > .01) st.R.lighting.time = time;   // время суток — хозяина
      if (day > 0) st.meta.day = day;
      const iv = G.R.mode(G.hostId) === 'p2p' ? SNAP_MS : SNAP_RELAY_MS, tn = now(), E = st.ents;
      if (E) E.civ = iv * 1.15;
      const np = r8();
      for (let i = 0; i < np; i++) {
        const pid = r8(), x = rf(), y = rf(), z = rf(), yaw = r16() / 65535 * Math.PI * 2, pitch = ri16() / 1e4, fl = r16(), mi = r16(), oi = r16(), pose = r32(), hp = r8();
        if (pid !== G.pid) G.view.state(pid, x, y, z, yaw, pitch, fl, G.items[mi - 1] || '', G.items[oi - 1] || '', pose, hp, iv);
      }
      const nm = r16();
      for (let i = 0; i < nm; i++) {
        const id = r16(), ty = r8(), x = rf(), y = rf(), z = rf(), yaw = r8() / 255 * Math.PI * 2, fl = r8();
        E?.clientMob(id, ty, x, y, z, yaw, fl, tn);
      }
      E?.clientSweep(tn, iv * 4.5);
      const ni = r16();
      for (let i = 0; i < ni; i++) {
        const eid = r16(), ii = r16(), n = r8(), x = rf(), y = rf(), z = rf();
        const id = G.items[ii - 1]; if (id && V.item(id)) E?.clientItem(eid, id, n, x, y, z, tn);
      }
      E?.clientItemSweep(tn, iv * 6);
    }
    function handle(m){
      const st = G.st;
      switch (m.t) {
        case 'wel': welcome(m); return;
        case 'old': end('old', '🔄 У друга другая версия сайта — обновите страницу (оба)'); return;
        case 'full': end('full', '🚪 В мире друга уже ' + MAX + ' игроков — мест нет'); return;
        case 'dup': end('dup', 'Ты уже в этом мире (другая вкладка или устройство)'); return;
        case 'kick': end('kick', '👢 Хозяин мира попросил тебя выйти'); return;
        case 'bye': end('host', m.why === 'new' ? '🔗 Хозяин сменил ссылку — попроси новую' : m.why === 'closed' ? '⛔ Хозяин закрыл мир для друзей' : '🏠 Хозяин вышел из мира'); return;
        case 'ek': if (Array.isArray(m.k) && Number.isInteger(m.k[0]) && Number.isInteger(m.k[1])) { const k = m.k[0] + '|' + m.k[1]; if (!G.edited.has(k)) { G.edited.add(k); const c = st?.W.chunk(m.k[0], m.k[1]); if (c?.ready && !G.wait.has(k)) G.ckQ.push(k); } } return;   // чанк стал «с правками», а он у меня уже есть — сверить целиком
      }
      if (!st) return;
      switch (m.t) {
        case 'pj': if (Number.isInteger(m.pid) && m.pid !== G.pid) { G.view.add(m.pid, m.nick, m.look); hooks.toast?.('👥 ' + nickOf(m.nick) + ' зашёл в мир'); hooks.changed?.(); } return;
        case 'pl': { const p = G.view.get(m.pid); if (p) { hooks.toast?.('👥 ' + p.nick + ' ушёл'); G.view.remove(m.pid); hooks.changed?.(); } return; }
        case 'deny': {
          G.stats.denied = (G.stats.denied | 0) + 1; G.lastDeny = m.why || '';
          if (Array.isArray(m.c)) for (const c of m.c.slice(0, 64)) if (Array.isArray(c) && c.length === 4 && c.every(Number.isInteger) && st.W.loaded(c[0], c[2])) st.W.set(c[0], c[1], c[2], toLocal(c[3] >>> 0), { urgent: 3, net: 1 });
          if (m.s && V.item(m.s.id)) hooks.give?.({ id: m.s.id, n: clamp(m.s.n | 0, 1, 64) });
          if (m.why === 'busy') hooks.toast?.('📦 Сундук сейчас открыт у другого игрока');
          return;
        }
        case 'give': { if (m.e) st.ents?.clientCollect?.(m.e); if (m.s && V.item(m.s.id)) { const left = hooks.give?.({ id: m.s.id, n: clamp(m.s.n | 0, 1, 999), d: m.s.d | 0 }) | 0; if (left > 0) G.reqDrop({ id: m.s.id, n: left, d: m.s.d | 0 }, [st.P.x, st.P.y + 1, st.P.z], null); } return; }
        case 'hurt': { const mob = st.ents?.clientMobById?.(m.m) || (fin(m.x) ? { x: m.x, z: m.z } : null); hooks.hurt?.(clamp(m.n | 0, 1, 20), mob); return; }
        case 'tile': { const w = G.opens.get(m.x + '|' + m.y + '|' + m.z); if (w) { G.opens.delete(m.x + '|' + m.y + '|' + m.z); w(m); } return; }
        case 'shut': { if (G.lock && G.lock[0] === m.x && G.lock[1] === m.y && G.lock[2] === m.z && st.ui?.isOpen()) { st.ui.close({ esc: true }); hooks.toast?.('📦 Сундук сдвинуло обвалом — окно закрыто'); } return; }   // T-124: закрыл — уходит 'close' с плиткой
        case 'mk': st.ents?.clientKill?.(m.id, +m.kx || 0, +m.kz || 0); return;
        case 'ice': if (Number.isInteger(m.x) && Number.isInteger(m.y) && Number.isInteger(m.z)) st.WX?.hole?.(m.x, m.y, m.z, fin(m.at) ? m.at : Date.now()); return;
        case 'kt': st.topple?.netIn?.(m.e, toLocal, unb64); return;   // T-138 F5: события физики хозяина — в такт мира гостя
        case 'fell': {
          try {
            const u = unb64(m.c), a = new Int32Array(u.buffer, u.byteOffset, u.byteLength >> 2); if (a.length > 4 * 2400) return;   // деревья v3 (T-022b): великан — до ~2000 блоков
            const cells = []; for (let i = 0; i + 3 < a.length; i += 4) cells.push(a[i], a[i + 1], a[i + 2], toLocal(a[i + 3] >>> 0));
            const LOG = v => /^log_/.test(V.blocks[v & 0xfff]?.name || '');
            if (Array.isArray(m.p) && Array.isArray(m.d)) st.ents?.fallGroup?.(cells, { x: +m.p[0], y: +m.p[1], z: +m.p[2] }, { x: +m.d[0], z: +m.d[1] }, { trunk: LOG, visual: true, drop: m.k === 'd', fast: true, cap: m.k === 'd' ? 8 : 3 });
          } catch (e) {}
          return;
        }
        case 'shot': if (Array.isArray(m.p) && Array.isArray(m.v) && m.p.every(fin) && m.v.every(fin)) st.ents?.shoot?.(m.p[0], m.p[1], m.p[2], m.v[0], m.v[1], m.v[2], 0, { vis: true, crit: !!m.crit }); return;
        case 'chat': { const p = m.pid === 0 ? G.view.get(0) : G.view.get(m.pid), who = m.pid === G.pid ? nickOf(myNick()) : p?.nick || 'игрок'; hooks.log?.('💬 ' + who + ': ' + kidSafe(cleanText(m.text, 120))); return; }
        case 'emo': if (G.view.get(m.pid)?.a && typeof m.e === 'string') st.A?.emote(G.view.get(m.pid).key, m.e, performance.now() / 1000); return;
        case 'pause': G.paused = !!m.on; hooks.changed?.(); return;
        case 'resync': { const keys = [...G.edited].filter(k => { const c = st.W.chunk(...k.split('|').map(Number)); return c?.ready && !G.wait.has(k); }); for (const k of keys) G.ckQ.push(k); return; }
        case 'wf': if (st.WX) st.WX.force = m.f ?? null; return;
        case 'mode': { const c = m.m === 'creative'; st.creative = c; st.meta.mode = c ? 'creative' : 'survival'; if (!c) st.P.fly = false; hooks.changed?.(); return; }
      }
    }
    // ── действия гостя (kubomir.js показывает сразу, хозяин проверяет) ──
    G.reqBreak = (x, y, z, tool) => toHost({ t: 'brk', x, y, z, tool: tool || '' });
    G.reqCut = (x, y, z, nx, ny, nz, tool) => toHost({ t: 'kc', x, y, z, n: [nx, ny, nz], tool: tool || '' });   // T-138 F5: один удар по надрубаемому
    G.sleep = on => toHost({ t: 'zz', on: !!on });   // T-049: лёг на лежанку / встал (ночь проходит, когда спит половина — решает хозяин)
    G.reqPlace = (x, y, z, v, v2, it) => toHost({ t: 'put', x, y, z, v: pv(v), v2: v2 == null ? null : pv(v2), it: it || '' });
    G.reqFire = (x, y, z, nx, ny, nz) => toHost({ t: 'fire', x, y, z, nx, ny, nz });   // огниво (T-022d)
    G.reqDoor = (x, y, z) => toHost({ t: 'door', x, y, z });
    G.reqIce = (x, y, z) => toHost({ t: 'ice', x, y, z });
    G.reqDrop = (s, p, vel) => { if (!s || !(s.n > 0)) return; toHost({ t: 'drop', s: { id: s.id, n: s.n, d: s.d | 0 }, p: p.map(v => +(+v).toFixed(2)), vel: vel ? vel.map(v => +(+v).toFixed(2)) : null }); };
    G.parry = (id, kx, kz, s) => toHost({ t: 'parry', id, kx: +(+kx || 0).toFixed(2), kz: +(+kz || 0).toFixed(2), s: +(+s || 0).toFixed(2) });
    G.chat = text => { if (window.D37Age?.chatRO?.()) { hooks.toast?.(window.D37Age.KID_MSG?.u9chat || '👀 Писать в чат можно с 9 лет'); return; } const s = cleanText(text, 120); if (s) toHost({ t: 'chat', text: s }); };
    G.emote = e => toHost({ t: 'emo', e: String(e).slice(0, 8) });
    // сундук / печь: спросить хозяина (открыт у другого — «занято»); пока окно открыто — правки ему, закрыл — отпустить
    G.openTile = (kind, x, y, z) => new Promise(res => {
      const k = x + '|' + y + '|' + z;
      const tm = setTimeout(() => { if (G.opens.get(k)) { G.opens.delete(k); res(false); } }, 6000);
      G.opens.set(k, m => {
        clearTimeout(tm);
        if (!m.ok) { hooks.toast?.(m.who ? '📦 Сейчас открыто у: ' + nickOf(m.who) : '📦 Не открылось — подойди ближе'); res(false); return; }
        const st = G.st, c = st.W.chunkAt(x, z); if (!c) { res(false); return; }
        const i = ((x & 15) << 11) | ((z & 15) << 7) | y;
        c.tiles = c.tiles || new Map(); c.tiles.set(i, m.tile && typeof m.tile === 'object' ? m.tile : {});
        G.lock = [x, y, z]; G.lockKind = m.kind;
        if (m.kind === 'furnace') st.ents?.furnaces?.add(x + ',' + y + ',' + z);   // пока открыта — печь греет у меня (у хозяина ждёт)
        res(true);
      });
      toHost({ t: 'open', x, y, z });
    });
    function tileNow(){ const [x, y, z] = G.lock; return G.st.W.tile(x, y, z); }
    // ── шаг (60 раз в секунду) ──
    G.step = dt => {
      if (G.closed || !G.R) return;
      const st = G.st, t = now(), R = G.R;
      if (st && G.started) {
        const p2p = R.mode(G.hostId) === 'p2p';
        if (t - G.stT >= (p2p ? ST_MS : ST_RELAY_MS) && st.ready) { G.stT = t; sendState(st); }
        if (G.ckQ.length && t - G.ckT > 100) { G.ckT = t; const k = G.ckQ.splice(0, 128); toHost({ t: 'ck', k: k.map(s => s.split('|').map(Number)) }); }
        // ответа на чанк нет 8 с — спросить ещё раз; 25 с — строить без правок (придут потом и лягут поверх)
        for (const [k, w] of G.wait) { if (t - w.t > 8000 && w.n < 2) { w.t = t; w.n++; G.ckQ.push(k); } else if (t - w.t > 25000) { G.wait.delete(k); G.stale.add(k); w.res(null); } }
        // открытая плитка: правки — хозяину; закрыл окно — отпустить
        if (G.lock) {
          if (!st.ui?.isOpen()) { toHost({ t: 'close', x: G.lock[0], y: G.lock[1], z: G.lock[2], tile: tileNow() }); if (G.lockKind === 'furnace') st.ents?.furnaces?.delete(G.lock.join(',')); G.lock = null; G.tset = 0; }
          else if ((G.tset && t - G.tset > 150) || (G.lockKind === 'furnace' && t - (G.tsT || 0) > 1000)) { G.tset = 0; G.tsT = t; toHost({ t: 'tset', x: G.lock[0], y: G.lock[1], z: G.lock[2], tile: tileNow() }); }
        }
        if (t - G.invT > INV_MS) { G.invT = t; const d = hooks.playerData?.(); if (d) toHost({ t: 'inv', d, rd: hooks.rd?.() | 0 }); }
        // сверка: чанки с правками вокруг себя (3×3) — раз в 30 с заново у хозяина (что-то могло не дойти — запасной канал, обрыв)
        if (t - (G.fixT || 0) > 30000 && st.ready) {
          G.fixT = t;
          const pcx = Math.floor(st.P.x) >> 4, pcz = Math.floor(st.P.z) >> 4;
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const k = (pcx + dx) + '|' + (pcz + dz), c = st.W.chunk(pcx + dx, pcz + dz); if (G.edited.has(k) && c?.ready && !G.wait.has(k) && !G.ckQ.includes(k)) G.ckQ.push(k); }
        }
        // есть ли место в вещах (хозяину — чтобы вещи тянулись ко мне)
        if (!(st.steps % 30)) { const r = roomHint(st); if (r.k !== G.roomK) { G.roomK = r.k; toHost({ t: 'room', e: r.e, p: r.p }); } }
        if (t - G.lastHost > HOST_SILENT_MS && !G.paused) end('silent', '📡 Связь с хозяином мира потеряна');
      } else if (!G.started && G.hostId && t - (G.hiT || 0) > 6000) { G.hiT = t; hi(); }   // ответа нет — ещё раз (хозяин повтор не примет дважды)
      R.flush();
    };
    function sendState(st){
      const P = st.P, w = WS.reset(), [mi, oi] = handIds(st), I = G.itemIdx || (G.itemIdx = new Map(G.items.map((n, i) => [n, i + 1])));
      w.u8(T_ST); w.u16(G.stSeq = ((G.stSeq | 0) + 1) & 0xffff); w.f32(P.x); w.f32(P.y); w.f32(P.z);
      w.u16(Math.round(((st.rig.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 65535)); w.i16((st.rig.fp || 0) * 1e4);
      w.u16(myFlags(st)); w.u16(I.get(mi) || 0); w.u16(I.get(oi) || 0); w.u32(myPose(st)); w.u8(clamp(Math.round(P.hp), 0, 255));
      G.R.send(G.hostId, w.view(), true);
    }
    function roomHint(st){
      const P = st.P, ps = new Set(); let e = 0;
      for (let i = 0; i < 36; i++) { const s = P.inv[i]; if (!s) e++; else { const it = V.item(s.id); if (it && !it.tool && s.n < it.stack) ps.add(s.id); } }
      const p = [...ps].sort(); return { e, p, k: e + ':' + p.join(',') };
    }
    G.frame = (dt, t) => { if (!G.closed) G.view?.frame(dt, t); };
    G.players = () => { const L = [{ pid: G.pid, nick: nickOf(myNick()), me: true }]; if (G.view) for (const p of G.view.map.values()) L.push({ pid: p.pid, nick: p.nick, host: p.pid === 0, ko: !!(p.flags & 64) }); return L; };
    G.mode = () => (G.R && G.hostId ? G.R.mode(G.hostId) : 'relay');
    G.link = () => linkFor(code);
    G.leave = () => { if (G.closed) return; try { const d = G.started ? hooks.playerData?.() : null; if (d) toHost({ t: 'inv', d }); toHost({ t: 'bye' }); G.R?.flush(); } catch (e) {} setTimeout(() => G.close(true), 250); };
    G.close = quiet => {
      if (G.closed) return;
      G.closed = true;
      clearInterval(G.hiTimer);
      for (const w of G.wait.values()) try { w.res(null); } catch (e) {}
      G.wait.clear();
      try { G.R?.close(); } catch (e) {}
      G.view?.clear();
      const E = G.st?.ents; if (E) { E.hookHit = null; E.hookShoot = null; }
    };
    G.stat = () => Object.assign({}, G.stats, { mode: G.mode(), net: G.R?.stats?.() || null, edited: G.edited.size, waiting: G.wait.size, mobs: G.st?.ents?.mobs.length || 0, items: G.st?.ents?.items.length || 0, players: G.view ? G.view.map.size : 0 });
    return G;
  }

  window.KubomirCoop = { host, join, linkFor, cleanText, chunkBody, chunkParse, PROTO, MAX, _: { writer, peers, myFlags } };
})();
