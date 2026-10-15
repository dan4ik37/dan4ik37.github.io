// ═══════════════════════════════════════
//  ВОЗРАСТ 🎂 (D37Age) — год рождения, группы по возрасту, метки 0+…18+, «обложки» и детские правила
// ═══════════════════════════════════════
// Владелец 15.10.2026: «Нужен выбор возраста, реклама будет идти от типа возраста, и режимы помечать возрастом тоже.
// Но вся информация конфиденциальная». Один файл для SPA (index.html — до ads-core.js) и серверных страниц (api/_lib/page.js).
// Спрашиваем ТОЛЬКО год рождения (не дату) — группа «взрослеет» сама. Год — тайна: гость — localStorage d37_age, вошедший —
// таблица user_age (age.sql: читает только сам человек; не в profiles, не модераторам и не админу, ни в каких списках); в браузере
// вошедшего — копия (серверным страницам и первым секундам), при выходе стирается. Возраст НЕ уходит в адреса, аналитику
// (Метрика, Vercel), presence, сообщения и логи. Рекламе — только «обработка» Google (ребёнок / подросток) и правила мест.
// Возраст по году — «не меньше»: год сейчас (МСК) − год рождения − 1 (день рождения мог ещё не наступить).
//   child — до 13 · teen — 13–15 · teen16 — 16–17 · adult — 18+ · unknown — не указан
// Менять: первые сутки — свободно (опечатка); дальше — до 2 смен за 30 дней. Стал «старше» или стёр год — 30 дней действуют правила
// прежней группы («остывание»: ребёнок не откроет 18+ и не обойдёт лимиты магазина, перевыбрав год). Стереть — можно всегда.
//
// ЧТО МЕНЯЕТ ВОЗРАСТ (одна таблица; реклама — ADS_RULES.age в ad-places.js, лимиты магазина — age.sql):
//  группа  │ реклама                                     │ контент                            │ общение                           │ магазин 💎
//  child   │ Google «детская» (TFAT 1), без персональной; │ выше возраста — обложка;           │ заявки в друзья — «ни от кого»    │ картой нельзя (сервер) —
//          │ без полноэкранной, полоски, рекламы за       │ 18+ скрыты в списках               │ (сервер; можно поменять); в чате  │ только через взрослого
//          │ награду и спонсора щитов; до 20 за визит     │                                    │ ссылки и контакты скрыты; в мире —│
//          │                                              │                                    │ строгий фильтр                     │
//  teen    │ Google «подростковая» (TFAT 2), без перс.    │ выше возраста — обложка; 18+ скрыты│ как у всех                        │ галочка + 1000 ₽/сутки, 3000/30 дн
//  teen16  │ то же                                        │ то же                              │ как у всех                        │ галочка + 2000 ₽/сутки, 6000/30 дн
//  adult   │ обычная                                      │ всё                                │ как у всех                        │ галочка + 3000 ₽/сутки, 10000/30 дн
//  unknown │ как ADS_RULES.age.unknown (подросток)        │ метки; 18+ — разово «Мне есть 18»  │ как у всех                        │ как раньше (галочка + 3000/10000)
// ЛС — только друзьям у всех (friends-dm.sql). Обложка 12+/16+ мягкая («Взрослый разрешил» — до конца визита), 18+ подростку — нет.
// Метки: игры — GAMES[].age (games.js), разделы — AREAS, ролики — VIDEO_RULES (как api/_lib/topics.js — тест сверяет), игры
// игроков — колонка age_rating (age.sql; автор выбирает, модератор меняет; по умолчанию 12+). Сайт целиком — SITE_AGE.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Age) return;
  const doc = root.document;
  const LS = 'd37_age', SNOOZE = 'd37_age_ask', SOFT = 'd37_age_ok', SEEN = 'd37_age_seen';
  const DAY = 864e5, MONTH = 30 * DAY;
  const now = () => Date.now();
  const yearNow = () => new Date(now() + 3 * 3600e3).getUTCFullYear();   // по Москве, как сервер (age.sql)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (!root.localStorage) return; if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const ssGet = k => { try { return root.sessionStorage ? root.sessionStorage.getItem(k) : null; } catch (e) { return null; } };
  const ssSet = (k, v) => { try { if (root.sessionStorage) root.sessionStorage.setItem(k, String(v)); } catch (e) {} };

  // ═══ Метки ═══
  const SITE_AGE = 12;   // сайт целиком (подвал): чат и мир — общение с незнакомыми; отдельное старше — своей меткой
  const LEVELS = [0, 6, 12, 16, 18];
  const num = r => { const n = typeof r === 'number' ? r : parseInt(String(r ?? '').replace(/\D/g, ''), 10); return LEVELS.includes(n) ? n : 0; };
  const label = r => num(r) + '+';
  // Разделы SPA (#/<раздел>): метка и почему. Мир и студии — игры (GAMES[].age)
  const AREAS = {
    chat:  { age: 12, title: 'Чат и сообщества', why: 'Здесь общаются незнакомые люди: чат, сообщества, приглашения.' },
    forum: { age: 12, title: 'Форум', why: 'Темы и ответы пишут другие игроки — что угодно.' },
    lfg:   { age: 12, title: 'Тиммейты', why: 'Поиск тиммейтов: незнакомые игроки оставляют свои ники в играх.' },
    shop:  { age: 0, title: 'Магазин', why: 'Покупки за деньги — только взрослые или с их разрешения; до 13 лет картой нельзя.' },
  };
  const UGC_AGE = 12;   // игра или мир игрока без метки
  // Ролики: тема (игра) по названию → метка. Как TOPICS[].age / AGE_EXTRA в api/_lib/topics.js (тест сверяет): ролик — наибольшая
  // метка из совпавших; ни одна не совпала — VIDEO_DEFAULT; кейсы и промокоды на депозит (isGambling) — 18+.
  const VIDEO_DEFAULT = 12, WHY_DEFAULT = 'Игровой ролик: бывают стрелялки и страшилки.';
  const WHY18 = 'Ролик про открытие кейсов и промокоды на депозит — это азартные игры.';
  const VIDEO_RULES = [
    [/roblox|роблокс/i, 6, 'Мультяшная игра.'],
    [/\bcs\s?2\b|кс\s?2|counter[\s-]?strike|#кс\b|csgo|cs:go|#cs\b/i, 16, 'Реалистичная стрельба по людям.'],
    [/minecraft|майнкрафт/i, 6, 'Кубический мир: бои с мобами без крови.'],
    [/dead\s*rails|мёртвые\s*рельсы|мертвые\s*рельсы|мёртвыерельсы/i, 12, 'Стрельба по зомби (Роблокс).'],
    [/silksong|hollow\s*knight|хорнет/i, 6, 'Рисованные бои с жуками без крови.'],
    [/fnaf|фнаф|five\s*nights/i, 12, 'Хоррор: скримеры и страшные аниматроники.'],
    [/terraria|террари/i, 6, '2D-песочница: бои с монстрами без крови.'],
    [/99\s*nights|99\s*ноч/i, 12, 'Выживание в лесу с монстрами.'],
    [/apex/i, 16, 'Стрельба по другим игрокам.'],
    [/poppy\s*playtime|haggy|хагги/i, 12, 'Хоррор про игрушки: скримеры.'],
    [/tiny\s*bunny|tinybunny/i, 16, 'Мрачная хоррор-новелла: пропавшие дети, жестокость.'],
    [/metro\s*(2033|redux|last\s*light|exodus)|метро\s*2033|метро\s*исход/i, 16, 'Постапокалипсис: стрельба, мутанты, страшные сцены.'],
    [/fortnite|фортнайт/i, 12, 'Королевская битва: стрельба без крови.'],
    [/spider[\s-]?man|человек[\s-]паук/i, 12, 'Супергерой дерётся с бандитами.'],
    [/not\s*a\s*human|notahuman/i, 16, 'Хоррор: насилие и жуткие сцены.'],
    [/\brepo\b/i, 12, 'Хоррор с монстрами (вместе с друзьями).'],
    [/homura/i, 12, 'Аниме-экшен с драками.'],
    [/horror|хоррор|ужастик/i, 12, 'Хоррор: скримеры и страшные моменты.'],
    [/gta|(?:^|[^а-яё])гта(?![а-яё])|grand\s*theft|(?:^|[^а-яё])самп(?![а-яё])|\bsamp\b|\bmta\b|крмп|crmp|радмир|radmir|black\s*russia|блэк\s*раша/i, 16, 'Криминальный мир как в GTA: стрельба и погони.'],
  ];
  // Кейсы / промокоды на депозит — как GAMBLING_RE в api/_lib/yt.js (тест сверяет)
  const GAMBLING_RE = /ggdrop|ггдроп|case\s*battle|casebattle|кейс\s*батл|кейсбатл|казино|casino|промокод на деп|\bдеп\b|депозит|рулетк|ставк[аиу]/i;
  const isGambling = (...t) => t.some(x => GAMBLING_RE.test(String(x || '')));
  function video(title, desc){
    if (isGambling(title, desc)) return { age: 18, why: WHY18 };
    let a = -1, why = '';
    for (const [re, n, w] of VIDEO_RULES) if (re.test(String(title || '')) && n > a) { a = n; why = w; }
    return a < 0 ? { age: VIDEO_DEFAULT, why: WHY_DEFAULT } : { age: a, why };
  }

  // ═══ Хранилище: { y — год, no — «не хочу указывать», s — 'g' гость / 'a' копия аккаунта, fa — когда указал впервые,
  //     ch — когда менял (30 дней), fg/fu — «остывание» (группа и до когда), c18 — «Мне есть 18», bd — «день рождения в этом году уже
  //     был» (год), mig — гостевой год уже переносили в аккаунт } ═══
  const RANK = { child: 0, teen: 1, teen16: 2, adult: 3 };
  const MAXAGE = { child: 12, teen: 15, teen16: 17, adult: 99 };
  const groupOfAge = a => a < 13 ? 'child' : a < 16 ? 'teen' : a < 18 ? 'teen16' : 'adult';
  const validYear = y => Number.isInteger(y) && y >= yearNow() - 100 && y <= yearNow() - 3;
  function read(){ try { const o = JSON.parse(lsGet(LS) || 'null'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
  let S = read();
  const save = () => lsSet(LS, Object.keys(S).length ? JSON.stringify(S) : null);
  const floorOn = () => !!(S.fg && RANK[S.fg] !== undefined && +S.fu > now());
  const rawGroup = y => validYear(y) ? groupOfAge(yearNow() - y - 1) : 'unknown';
  function group(){
    let g = rawGroup(S.y);
    if (floorOn() && (g === 'unknown' || RANK[S.fg] < RANK[g])) g = S.fg;
    return g;
  }
  // Возраст для меток: «не меньше» (или ровно — если сказал «день рождения в этом году уже был»); при «остывании» — не старше той группы
  function age(){
    let a = validYear(S.y) ? yearNow() - S.y - (+S.bd === yearNow() ? 0 : 1) : null;
    if (floorOn() && (a == null || a > MAXAGE[S.fg])) a = MAXAGE[S.fg];
    return a;
  }
  const known = () => group() !== 'unknown';
  const minor = () => ['child', 'teen', 'teen16'].includes(group());
  const kid = () => group() === 'child';
  // Можно ли по возрасту (строго). Возраст не указан — всё, кроме 18+ (пока не нажал «Мне есть 18»)
  function allows(r){
    const n = num(r);
    if (!n) return true;
    if (!known()) return n < 18 || !!S.c18;
    const a = age();
    return a != null && a >= n;
  }
  // 18+ в списках: прятать (несовершеннолетний) / показывать с меткой (не указан, взрослый)
  const hide18 = () => known() && !allows(18);
  const listOk = r => num(r) < 18 || !hide18();
  // Мягкая обложка: «Взрослый разрешил» — до конца визита (вкладка) для 12+/16+; 18+ несовершеннолетнему — никогда
  const softOk = n => n < 18 && (+ssGet(SOFT) || 0) >= n;
  const canOpen = r => allows(r) || softOk(num(r));

  // ═══ События ═══
  const subs = new Set();
  let gateEl = null;   // обложка раздела SPA (gateRoute)
  function marks(){
    const h = doc && doc.documentElement; if (!h || !h.classList) return;
    h.classList.toggle('d37-h18', hide18());
    h.classList.toggle('d37-c18', !known() && !S.c18);
  }
  function emit(){
    marks();
    const rs = doc?.querySelector?.('.age-reg select');   // поле в регистрации — тот же год
    if (rs) rs.value = validYear(S.y) ? String(S.y) : '';
    for (const f of [...subs]) { try { f(group()); } catch (e) { console.error(e); } }
    try { root.dispatchEvent(new root.CustomEvent('d37:age', { detail: { group: group() } })); } catch (e) {}
    try { if (root.D37Settings?.isOpen?.()) root.D37Settings.refresh(); } catch (e) {}
    // открыт раздел с меткой (чат, форум…), и по новому возрасту обложка нужна / не нужна — пересобрать раздел сразу
    try {
      const r = typeof currentRoute === 'function' ? currentRoute() : '';
      if (AREAS[r] && typeof showPage === 'function' && !!gateEl !== !canOpen(AREAS[r].age)) setTimeout(() => showPage(r), 0);
    } catch (e) {}
  }

  // ═══ Сервер (age.sql). Нет файла (PGRST202) — всё живёт в браузере, как у гостя ═══
  let srv = null;   // null — не знаем, false — age.sql нет, true — есть
  const authed = () => typeof currentUser !== 'undefined' && !!currentUser && typeof sbClient !== 'undefined' && !!sbClient;
  async function rpc(name, args){
    try {
      const { data, error } = await sbClient.rpc(name, args || {});
      if (error) {
        if (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || '')) { srv = false; return { ok: false, reason: 'missing' }; }
        return { ok: false, reason: 'error' };
      }
      srv = true;
      return data || { ok: false, reason: 'error' };
    } catch (e) { return { ok: false, reason: 'error' }; }
  }
  const ts = v => { const t = v ? Date.parse(v) : 0; return Number.isFinite(t) ? t : 0; };
  // Ответ сервера → копия в браузере (c18 и bd — только браузерные отметки, их не трогаем)
  function fromServer(d){
    const n = { s: 'a' };
    if (validYear(+d.year)) n.y = +d.year; else if (S.no || d.cleared) n.no = 1;
    if (d.first_at) n.fa = ts(d.first_at);
    if (d.floor_group && ts(d.floor_until) > now()) { n.fg = d.floor_group; n.fu = ts(d.floor_until); }
    if (S.c18) n.c18 = 1;
    if (S.bd) n.bd = S.bd;
    if (S.mig) n.mig = 1;
    n.left = Number.isFinite(+d.changes_left) ? +d.changes_left : undefined;
    n.next = d.next_at || undefined;
    S = n; save();
  }
  let syncing = null;
  function sync(){
    if (!authed()) return Promise.resolve();
    if (syncing) return syncing;
    syncing = (async () => {
      const d = await rpc('my_age_group');
      if (!d?.ok) return;   // нет age.sql / нет связи — год остаётся в браузере
      // У аккаунта года нет, а гостем в этом браузере указал — переносим один раз
      const guest = S.s !== 'a' && validYear(S.y) ? S.y : null;
      if (d.year == null && !d.floor_group && guest && !S.mig) {
        S.mig = 1; save();
        const r = await rpc('age_set', { p_year: guest });
        if (r?.ok) { fromServer(r); kidNote(r); emit(); return; }
      }
      fromServer(d); emit();
    })().finally(() => { syncing = null; });
    return syncing;
  }
  // Вышел — копию года аккаунта из браузера стираем (общий компьютер: следующий не получит чужой возраст)
  function onAuth(){
    if (authed()) { sync(); return; }
    if (S.s === 'a') { S = {}; save(); lsSet(SNOOZE, now() + DAY); emit(); }
  }

  // ═══ Указать / сменить / стереть ═══
  // → { ok, reason: 'year' | 'rate' (next_at) | 'auth' | 'error', cooling: до когда действуют правила прежней группы }
  async function set(y){
    y = parseInt(y, 10);
    if (!validYear(y)) return { ok: false, reason: 'year' };
    if (authed() && srv !== false) {
      const r = await rpc('age_set', { p_year: y });
      if (r?.ok) { fromServer(r); kidNote(r); emit(); return { ok: true, cooling: r.floor_until || null, same: !!r.same }; }
      if (r && r.reason !== 'missing' && r.reason !== 'error') return r;
      if (r?.reason === 'error') return r;
    }
    const r = localSet(y); if (r.ok) emit(); return r;
  }
  function recentChanges(){ const t = now(); return (Array.isArray(S.ch) ? S.ch : []).filter(x => t - x < MONTH); }
  function localSet(y){
    const t = now();
    if (S.y === y) return { ok: true, same: true };
    const first = !validYear(S.y) && !S.fa, old = group(), typo = S.fa && t - S.fa < DAY;
    let ch = recentChanges();
    if (!first) {
      if (ch.length >= 2) return { ok: false, reason: 'rate', next_at: new Date(Math.min(...ch) + MONTH).toISOString() };
      ch = ch.concat(t);
    }
    const nw = rawGroup(y), n = { ...S, y, s: S.s || 'g', fa: S.fa || t, ch };
    delete n.no; delete n.bd;
    // стал «старше» — 30 дней правила прежней группы (кроме опечатки в первые сутки)
    if (old !== 'unknown' && old !== 'adult' && RANK[nw] > RANK[old] && !typo) { n.fg = old; n.fu = t + MONTH; }
    S = n; save();
    return { ok: true, cooling: n.fu > t && n.fg ? new Date(n.fu).toISOString() : null };
  }
  async function clear(){
    if (authed() && srv !== false) {
      const r = await rpc('age_clear');
      if (r?.ok) { fromServer({ ...r, cleared: true }); S.no = 1; save(); emit(); return { ok: true }; }
      if (r?.reason === 'error') return r;
    }
    const t = now(), old = group(), typo = S.fa && t - S.fa < DAY;
    const n = { no: 1, s: S.s || 'g', ch: validYear(S.y) ? recentChanges().concat(t) : recentChanges() };
    if (S.fa) n.fa = S.fa;
    if (['child', 'teen', 'teen16'].includes(old) && !typo) { n.fg = old; n.fu = t + MONTH; }
    else if (floorOn()) { n.fg = S.fg; n.fu = S.fu; }
    S = n; save(); emit();
    return { ok: true };
  }
  function skip(){ S = { ...S, no: 1 }; delete S.y; save(); lsSet(SNOOZE, null); emit(); }
  function confirm18(){ S = { ...S, c18: 1 }; save(); emit(); }
  function birthdayPassed(){ S = { ...S, bd: yearNow() }; save(); emit(); }
  // Стал ребёнком — сервер выключил заявки в друзья «от всех» (можно включить в профиле); профиль в памяти — тоже
  function kidNote(r){
    if (!r?.kid_defaults) return;
    try { if (typeof currentProfile !== 'undefined' && currentProfile) currentProfile.accepts_friend_requests = false; } catch (e) {}
    toast('🔒 Для безопасности заявки в друзья теперь — только когда ты сам зовёшь. Поменять можно в профиле.');
  }
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else if (typeof gameToast === 'function') gameToast(t); };

  // ═══ Детские правила общения: строгий фильтр (телефоны, почта, соцсети, «скинь фото») — у получателя ═══
  const KID_RE = [
    /\+?\d(?:[\s\-().]{0,2}\d){6,}/g,
    /[\w.+-]+@[\w-]+\.[\w.-]+/g,
    /(?:^|[^\p{L}\p{N}_])(?:тг|tg|телег\p{L}*|telegram|дс|дискорд\p{L}*|discord|вк|vk|вконтакт\p{L}*|инст\p{L}*|insta\p{L}*|ватсап\p{L}*|вотсап\p{L}*|whatsapp|вайбер|viber|снап\p{L}*|snapchat|тикток\p{L}*|tiktok|скайп|skype)(?![\p{L}\p{N}_])/giu,
    /скинь\s*(?:фот\p{L}*|селфи)|где\s*(?:ты\s*)?жив[её]шь|(?:твой|дай|скажи|напиши)\s*(?:адрес|номер)/giu,
  ];
  const AT_RE = /@[\p{L}\p{N}_.]{3,}/gu;
  function kidText(s, o = {}){
    let out = String(s ?? '');
    for (const re of o.at === false ? KID_RE : [...KID_RE, AT_RE]) out = out.replace(new RegExp(re.source, re.flags), m => (/^[\s.,!?:;()"'«»-]/.test(m) ? m[0] : '') + '[скрыто]');
    return out;
  }

  // ═══ Вид ═══
  const GROUP_NAME = { child: 'до 13 лет', teen: '13–15 лет', teen16: '16–17 лет', adult: '18+', unknown: 'не указан' };
  // «12–13 лет» по году (или ровно, если день рождения в этом году уже был); года нет — только группа «остывания»
  function ageText(){
    if (!validYear(S.y)) return floorOn() ? GROUP_NAME[S.fg] : '';
    const a = yearNow() - S.y - 1;
    return +S.bd === yearNow() ? `${a + 1} лет` : `${a}–${a + 1} лет`;
  }
  const badge = (r, o = {}) => { const n = num(r); return `<span class="age-b age-b${n}"${o.title ? ` title="${esc(o.title)}"` : ''}>${n}+</span>`; };
  function yearOptions(sel){
    const Y = yearNow();
    let h = `<option value="">Год рождения</option>`;
    for (let y = Y - 4; y >= Y - 99; y--) h += `<option value="${y}"${y === sel ? ' selected' : ''}>${y}</option>`;
    return h;
  }
  const fmtDate = iso => { const t = ts(iso); return t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''; };
  function errText(r){
    if (r?.reason === 'rate') return `Менять год можно 2 раза за 30 дней${r.next_at ? ` — следующий раз с ${fmtDate(r.next_at)}` : ''}.`;
    if (r?.reason === 'year') return 'Выбери год из списка.';
    return 'Не сохранилось — проверь интернет и попробуй ещё раз.';
  }
  const coolText = iso => `Готово! Правила для нового возраста включатся ${fmtDate(iso) ? 'с ' + fmtDate(iso) : 'через 30 дней'} — так сайт бережёт младших ребят.`;

  // ── Окошко «Сколько тебе лет?» (первый заход — спокойно, без стены; и «Изменить» из настроек) ──
  let sheet = null;
  function ask(o = {}){
    if (!doc?.body) return;
    close();
    const edit = !!o.edit;
    sheet = doc.createElement('div');
    sheet.className = 'age-sheet ym-hide-content' + (edit ? ' edit' : '');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-labelledby', 'ageSheetT');
    sheet.innerHTML = `<div class="age-sheet-box">
      <button type="button" class="age-x" data-age-act="${edit ? 'close' : 'later'}" aria-label="Закрыть">✕</button>
      <div class="age-h" id="ageSheetT">🎂 ${edit ? 'Год рождения' : 'Сколько тебе лет?'}</div>
      <p>${edit ? 'Меняй, если ошибся. Год нужен, чтобы показывать подходящие тебе игры, ролики и рекламу.' : 'Выбери год рождения — сайт покажет игры, ролики и рекламу, которые подходят по возрасту.'}</p>
      <div class="age-row"><select class="age-sel ym-disable-keys" aria-label="Год рождения">${yearOptions(validYear(S.y) ? S.y : null)}</select><button type="button" class="age-ok" data-age-act="save">Сохранить</button></div>
      <div class="age-hint" aria-live="polite"></div>
      <p class="age-lock">🔒 Год видишь только ты: ни другие игроки, ни модераторы, ни админ. Удалить — в ⚙️ Настройки → Сайт.</p>
      ${edit ? '' : '<div class="age-more"><button type="button" data-age-act="no">Не хочу указывать</button><button type="button" data-age-act="later">Потом</button></div>'}
    </div>`;
    doc.body.appendChild(sheet);
    const sel = sheet.querySelector('.age-sel'), hint = sheet.querySelector('.age-hint');
    sel.addEventListener('change', () => { const y = +sel.value; hint.textContent = y ? `Тебе примерно ${yearNow() - y - 1}–${yearNow() - y} лет` : ''; hint.classList.remove('err'); });
    if (!edit) ssSet(SEEN, 1);
    if (edit) sel.focus?.({ preventScroll: true });
  }
  function close(){ if (sheet) { sheet.remove(); sheet = null; } }
  async function sheetSave(){
    const sel = sheet?.querySelector('.age-sel'), hint = sheet?.querySelector('.age-hint'), btn = sheet?.querySelector('.age-ok');
    if (!sel) return;
    if (!sel.value) { hint.textContent = 'Выбери год из списка.'; hint.classList.add('err'); return; }
    btn.disabled = true;
    const r = await set(+sel.value);
    btn.disabled = false;
    if (!r?.ok) { hint.textContent = errText(r); hint.classList.add('err'); return; }
    close();
    toast(r.cooling ? coolText(r.cooling) : '🎂 Сохранено — видишь только ты');
  }
  // Показать в первый заход: только в SPA, через несколько секунд, не поверх игры, окна и полного экрана
  let askTries = 0, askT = 0;
  function maybeAsk(){
    clearTimeout(askT);
    if (!doc?.getElementById('globalAuthModal')) return;   // серверные страницы — без окошка
    if (known() || S.no || ssGet(SEEN) || +lsGet(SNOOZE) > now() || sheet) return;
    if (authed() && srv === null) { askT = setTimeout(maybeAsk, 4000); return; }   // ждём год аккаунта с сервера
    const busy = doc.body.classList.contains('game-on') || doc.documentElement.classList.contains('gs-full') || doc.documentElement.classList.contains('gs-set-open')
      || doc.querySelector('#globalAuthModal.open, #modal.open, #privacyModal.open, .s3, .wld-edit');
    if (busy) { if (++askTries < 6) askT = setTimeout(maybeAsk, 20e3); return; }
    ask();
  }

  // ── Регистрация: «Год рождения» в форме (гостевой год → в аккаунт после входа) ──
  function regField(){
    const box = doc?.getElementById('gauthRegisterFields');
    if (!box || box.querySelector('.age-reg')) return;
    const w = doc.createElement('div'); w.className = 'age-reg ym-hide-content';
    w.innerHTML = `<label><span>🎂 Год рождения</span><select class="age-sel ym-disable-keys" aria-label="Год рождения">${yearOptions(validYear(S.y) ? S.y : null).replace('>Год рождения<', '>Не хочу указывать<')}</select></label>
      <small>Чтобы показывать подходящие игры и рекламу. Его никто не увидит.</small>`;
    const btn = box.querySelector('.auth-submit');
    if (btn) box.insertBefore(w, btn); else box.appendChild(w);
    w.querySelector('select').addEventListener('change', async e => {
      const y = +e.target.value;
      if (y) { const r = await set(y); if (!r?.ok) { e.target.value = validYear(S.y) ? String(S.y) : ''; toast(errText(r)); } }
    });
  }

  // ── ⚙️ Настройки → «Сайт»: строка «🎂 Возраст» (settings.js зовёт settingsRow) ──
  function settingsRow(){
    const k = known(), y = validYear(S.y) ? S.y : null;
    const cool = floorOn() && RANK[S.fg] < RANK[rawGroup(S.y)] ? ` Правила для нового возраста — с ${fmtDate(new Date(+S.fu).toISOString())}.` : '';
    const ctl = y
      ? `<span class="age-set-y">${y} · ${esc(ageText())}</span><button type="button" class="gs-btn" data-age-act="change">Изменить</button><button type="button" class="gs-btn ghost" data-age-act="clear">Удалить</button>`
      : `${k ? `<span class="age-set-y">${esc(GROUP_NAME[group()])}</span>` : ''}<button type="button" class="gs-btn primary" data-age-act="change">🎂 Указать год</button>`;
    return `<div class="gs-row age-srow ym-hide-content"><div class="gs-lbl"><b>🎂 Возраст</b><small>Видишь только ты. Нужен, чтобы показывать подходящие игры, ролики и рекламу. Менять — до 2 раз в месяц.${cool}</small></div><div class="gs-ctl age-sctl">${ctl}</div></div>`;
  }

  // ═══ «Обложка» вместо того, что не по возрасту ═══
  const hooks = new WeakMap();
  // o: { why, title, key, back: true | '#/…' | fn, onOpen() — открыть после «Мне есть 18» / «Взрослый разрешил», compact }
  function coverHtml(r, o = {}){
    const n = num(r), g = group(), unk = g === 'unknown', a = age();
    const minor18 = n >= 18 && !unk;
    const boundary = !unk && validYear(S.y) && +S.bd !== yearNow() && yearNow() - S.y >= n && a < n && !floorOn();
    const title = n >= 18 ? 'Только для взрослых (18+)' : `Это для ${n}+`;
    const lead = unk && n >= 18 ? 'Тебе уже есть 18?' : minor18 ? 'Это нельзя смотреть до 18 лет — даже вместе со взрослыми.' : 'Тебе пока рано — но на сайте много всего для твоего возраста.';
    const acts = [];
    if (o.back !== false) acts.push(`<button type="button" class="age-btn" data-age-act="back">← Назад</button>`);
    if (unk && n >= 18) acts.push(`<button type="button" class="age-btn primary" data-age-act="ok18">Мне есть 18</button>`);
    else if (boundary) acts.push(`<button type="button" class="age-btn primary" data-age-act="bd" data-n="${n}">Мне уже исполнилось ${n}</button>`);
    if (!minor18 && !unk && n < 18) acts.push(`<button type="button" class="age-btn" data-age-act="soft" data-n="${n}" title="Откроется до конца визита">👨‍👩‍👧 Взрослый разрешил</button>`);
    return `<div class="age-cover${o.compact ? ' compact' : ''}" role="note">
      <div class="age-cover-b age-b${n}">${n}+</div>
      <div class="age-cover-t">${esc(title)}${o.title ? `<small>${esc(o.title)}</small>` : ''}</div>
      ${o.why ? `<p class="age-cover-w">Почему: ${esc(o.why)}</p>` : ''}
      <p class="age-cover-l">${esc(lead)}</p>
      <div class="age-cover-a">${acts.join('')}</div>
      ${unk ? `<small class="age-cover-s">Или <button type="button" class="age-link" data-age-act="change">укажи год рождения</button> — его видишь только ты.</small>`
        : `<small class="age-cover-s">Указал не тот год? <button type="button" class="age-link" data-age-act="change">🎂 Изменить</button></small>`}
    </div>`;
  }
  // Показать обложку в el, если нельзя. → true — показана (открывать не надо)
  function cover(el, r, o = {}){
    if (!el || canOpen(r)) return false;
    el.innerHTML = coverHtml(r, o);
    el.classList.add('age-on');
    hooks.set(el, o);
    return true;
  }
  function uncover(el){ if (!el) return; el.classList.remove('age-on'); el.querySelector(':scope > .age-cover')?.remove(); hooks.delete(el); }

  // ── Разделы SPA (router.js: finishShowPage → gateRoute) ──
  function gateRoute(route, ids){
    gateEl?.remove(); gateEl = null;
    const A = AREAS[route];
    if (!A || !doc || canOpen(A.age)) return false;
    const list = (ids || []).map(id => doc.getElementById(id)).filter(Boolean);
    list.forEach(el => { el.style.display = 'none'; });
    gateEl = doc.createElement('section'); gateEl.className = 'age-gate'; gateEl.id = 'ageGate';
    const at = list[0];
    if (at?.parentNode) at.parentNode.insertBefore(gateEl, at); else doc.body.appendChild(gateEl);
    gateEl.innerHTML = coverHtml(A.age, { why: A.why, title: A.title });
    hooks.set(gateEl, { back: '#/home', onOpen: () => { gateEl?.remove(); gateEl = null; if (typeof showPage === 'function' && typeof currentRoute === 'function') showPage(currentRoute()); } });
    return true;
  }

  // ── Кнопки окошка, строки настроек и обложек ──
  function back(o){
    const b = o?.back;
    if (typeof b === 'function') { b(); return; }
    if (typeof b === 'string') { root.location.hash = b; return; }
    if (root.history && root.history.length > 1) root.history.back(); else root.location.href = '/';
  }
  function reopen(host, o){
    const after = () => { if (host && host.isConnected !== false) uncover(host); o?.onOpen?.(); };
    after();
  }
  async function onClick(e){
    const b = e.target?.closest?.('[data-age-act]'); if (!b) return;
    const act = b.dataset.ageAct;
    const host = b.closest('.age-on, .age-gate, [data-age-page]');
    const o = host ? hooks.get(host) || {} : {};
    e.preventDefault();
    if (act === 'save') return sheetSave();
    if (act === 'close') return close();
    if (act === 'later') { close(); lsSet(SNOOZE, now() + 3 * DAY); return; }
    if (act === 'no') { close(); skip(); toast('Хорошо — без возраста. Указать можно в ⚙️ Настройки → Сайт.'); return; }
    if (act === 'change') { ask({ edit: true }); return; }
    if (act === 'clear') {
      if (root.confirm && !root.confirm('Удалить год рождения? Сайт снова будет считать, что возраст не указан.')) return;
      const r = await clear();
      toast(r?.ok ? '🗑 Год рождения удалён' : errText(r));
      return;
    }
    if (act === 'back') { back(o); return; }
    if (act === 'ok18') { confirm18(); reopen(host, o); return; }
    if (act === 'bd') { birthdayPassed(); reopen(host, o); return; }
    if (act === 'soft') { const n = num(b.dataset.n); ssSet(SOFT, Math.max(n, +ssGet(SOFT) || 0)); reopen(host, o); return; }
  }

  // ═══ Игры и миры игроков: метка age_rating (age.sql; автор выбирает до 16+, модератор — любую) ═══
  const UGC_WHY = 'Игра игрока: метку выбрал автор, проверяет модератор.';
  const RATE_HINT = { 0: 'для всех', 6: 'мультяшные драки', 12: 'страшилки, стрельба без крови', 16: 'кровь, мрачные хорроры', 18: 'только взрослым' };
  const ugcAge = r => r != null && LEVELS.includes(+r) ? +r : UGC_AGE;
  const ugcCols = {};
  // Есть ли колонка age_rating (до age.sql — нет; тогда её и не спрашиваем — иначе запрос списка сломается). Один раз на таблицу
  function ugcCol(table){
    if (ugcCols[table]) return ugcCols[table];
    if (typeof sbClient === 'undefined' || !sbClient) return Promise.resolve(false);
    return ugcCols[table] = (async () => { try { const { error } = await sbClient.from(table).select('age_rating').limit(0); return !error; } catch (e) { return false; } })();
  }
  // Поставить метку: kind 'ugc' (Студия игр и Студия 3D) | 'unity'
  async function ugcSet(kind, id, n){
    if (!authed()) return { ok: false, reason: 'auth' };
    return rpc('age_set_rating', { p_kind: kind, p_id: id, p_age: num(n) });
  }
  const ugcSelect = (cur, o = {}) => `<select class="age-rate"${o.attr ? ' ' + o.attr : ''} aria-label="Возрастная метка">${(o.staff ? LEVELS : [0, 6, 12, 16])
    .map(n => `<option value="${n}"${n === ugcAge(cur) ? ' selected' : ''}>${n}+ — ${RATE_HINT[n]}</option>`).join('')}</select>`;
  const ugcErr = r => r?.reason === 'mod' ? `Метку ${r.age}+ поставил модератор — ниже нельзя` : r?.reason === 'age18' ? '18+ ставит только модератор' : r?.reason === 'missing' ? 'Метки заработают, когда сайт обновится' : 'Метка не сохранилась — попробуй ещё раз';

  // ═══ Серверные страницы: <main data-age-page="16" data-age-why="…"> — обложка; карточки [data-age="18"] прячет CSS ═══
  function scanPage(){
    for (const el of doc.querySelectorAll('[data-age-page]')) {
      if (el.dataset.ageDone) continue;
      el.dataset.ageDone = '1';
      const n = num(el.dataset.agePage);
      if (canOpen(n)) continue;
      const box = doc.createElement('div');
      box.className = 'age-page-cover';
      box.innerHTML = coverHtml(n, { why: el.dataset.ageWhy || '', title: el.dataset.ageTitle || '' });
      el.classList.add('age-hidden');
      el.prepend(box);
      hooks.set(el, { onOpen: () => { box.remove(); el.classList.remove('age-hidden'); } });
    }
  }

  // ═══ Стили (свои — и для серверных страниц) ═══
  function css(){
    if (!doc?.head || doc.getElementById('d37AgeCss')) return;
    const s = doc.createElement('style'); s.id = 'd37AgeCss';
    s.textContent = `
.age-b{display:inline-flex;align-items:center;justify-content:center;min-width:2.15em;height:1.5em;padding:0 .38em;border-radius:6px;font:800 .66rem/1 Montserrat,system-ui,sans-serif;letter-spacing:.02em;color:#fff;background:#475569;border:1px solid rgba(255,255,255,.28);vertical-align:middle;white-space:nowrap;box-sizing:border-box}
.age-b0{background:#15803d}.age-b6{background:#0e7490}.age-b12{background:#a16207}.age-b16{background:#c2410c}.age-b18{background:#b91c1c}
html.d37-h18 [data-age="18"]{display:none!important}
.gm-card>.age-b{position:absolute;top:.75rem;right:.75rem}
#gamesStageTitle .age-b{margin-left:.35rem;font-size:.6rem}
.vthumb .age-b{position:absolute;top:32px;right:8px;z-index:3}
.age-chip{display:inline-flex;align-items:center;gap:.35rem}
.age-mark{display:inline-flex;align-items:center;justify-content:center;min-width:2.4em;height:1.6em;padding:0 .4em;border-radius:6px;border:1.5px solid rgba(240,240,248,.45);font:800 .72rem/1 Montserrat,system-ui,sans-serif;color:#f0f0f8;vertical-align:middle;margin-right:.35rem}
.footer-age{font-size:.68rem;color:var(--muted,#8d8daa);margin:0 0 .9rem}
.age-sheet{position:fixed;right:16px;bottom:16px;z-index:9250;width:min(390px,calc(100vw - 32px));color:#f0f0f8;font-family:Montserrat,system-ui,sans-serif}
.age-sheet.edit{z-index:100600;left:50%;right:auto;bottom:50%;transform:translate(-50%,50%)}
.age-sheet-box{position:relative;padding:1.05rem 1.1rem 1rem;border-radius:18px;background:#15131f;border:1px solid rgba(255,255,255,.12);box-shadow:0 22px 60px rgba(0,0,0,.6)}
.age-h{font:800 1.02rem/1.3 Montserrat,system-ui,sans-serif;margin:0 1.6rem .35rem 0}
.age-sheet p{margin:.2rem 0 .55rem;font-size:.8rem;line-height:1.45;color:rgba(240,240,248,.82)}
.age-sheet p.age-lock{font-size:.7rem;color:#9a9ab5;margin:.5rem 0 0}
.age-x{position:absolute;top:.6rem;right:.6rem;width:28px;height:28px;border-radius:50%;border:0;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-size:.8rem}
.age-row{display:flex;gap:.5rem}
.age-sel{flex:1;min-width:0;height:42px;padding:0 .7rem;border-radius:11px;border:1.5px solid rgba(255,255,255,.16);background:#0d0c15;color:#f0f0f8;font:700 .9rem Montserrat,system-ui,sans-serif}
.age-ok,.age-btn{height:42px;padding:0 1rem;border-radius:11px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#f0f0f8;font:800 .8rem Montserrat,system-ui,sans-serif;cursor:pointer}
.age-ok,.age-btn.primary{border:0;background:linear-gradient(135deg,var(--accent,#ff2d55),var(--accent2,#ff6b35));color:#fff}
.age-ok:disabled{opacity:.6}
.age-hint{min-height:1.1em;margin-top:.35rem;font-size:.74rem;color:#9a9ab5}.age-hint.err{color:#f87171}
.age-more{display:flex;gap:.5rem;margin-top:.65rem;flex-wrap:wrap}
.age-more button{flex:1;min-height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:none;color:#c9c9dc;font:700 .74rem Montserrat,system-ui,sans-serif;cursor:pointer}
@media(max-width:768px){.age-sheet:not(.edit){left:12px;right:12px;width:auto;bottom:calc(66px + env(safe-area-inset-bottom))}}
.age-reg{margin:.2rem 0 .7rem}.age-reg label{display:flex;align-items:center;gap:.6rem;font-size:.78rem;font-weight:700}.age-reg label span{flex:none}
.age-reg .age-sel{height:40px}.age-reg small{display:block;margin-top:.3rem;font-size:.68rem;color:var(--muted,#8d8daa)}
.age-srow .age-sctl{display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.age-set-y{font-weight:800;font-size:.8rem;margin-right:.2rem}
.age-cover{max-width:520px;margin:0 auto;padding:1.4rem 1.2rem;text-align:center;border-radius:18px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.1);color:#f0f0f8;font-family:Montserrat,system-ui,sans-serif;box-sizing:border-box}
.age-cover.compact{padding:1rem .9rem;border:0;background:none}
.age-cover-b{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:18px;font:900 1.35rem/1 Montserrat,system-ui,sans-serif;color:#fff;border:2px solid rgba(255,255,255,.3)}
.age-cover-t{margin:.7rem 0 .3rem;font:800 1.15rem/1.3 Montserrat,system-ui,sans-serif}.age-cover-t small{display:block;margin-top:.15rem;font-size:.75rem;font-weight:700;color:#9a9ab5}
.age-cover p{margin:.35rem auto;max-width:420px;font-size:.84rem;line-height:1.5;color:rgba(240,240,248,.85)}
.age-cover-w{color:#ffd166!important}
.age-cover-a{display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-top:.9rem}
.age-cover-s{display:block;margin-top:.8rem;font-size:.72rem;color:#9a9ab5}
.age-link{border:0;background:none;padding:0;color:var(--accent,#ff2d55);font:inherit;font-weight:800;cursor:pointer;text-decoration:underline}
.age-gate{padding:5.5rem 16px 3rem}
.age-rate{max-width:100%;height:34px;padding:0 .5rem;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:#0d0c15;color:#f0f0f8;font:700 .74rem Montserrat,system-ui,sans-serif}
.age-rate-l{display:inline-flex;align-items:center;gap:.4rem;font-size:.74rem;font-weight:700;flex-wrap:wrap}
.st-card .age-b,.st-play-t .age-b,.st-row-b .age-b{margin-left:.3rem;font-size:.58rem}
.shp-kid{padding:.9rem 1rem;border-radius:14px;background:rgba(255,209,102,.07);border:1px dashed rgba(255,209,102,.45);font-size:.82rem}
.shp-kid p{margin:.45rem 0 0;font-size:.78rem;line-height:1.5;color:var(--muted,#8d8daa)}
.pv-kid{margin-top:.5rem;font-size:.72rem;color:#ffd166}
.modal-vid.age-on{padding-bottom:0;min-height:0;background:transparent}
.age-hidden>:not(.age-page-cover){display:none!important}
.age-page-cover{padding:2rem 0}
@media(max-width:480px){.age-cover-a .age-btn{flex:1 1 100%}}`;
    doc.head.appendChild(s);
  }

  // ═══ Запуск ═══
  marks();
  if (doc?.addEventListener) {
    doc.addEventListener('click', onClick);
    const boot = () => {
      css(); marks(); scanPage(); regField();
      setTimeout(maybeAsk, 7000);
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
    root.addEventListener?.('d37:auth', () => setTimeout(onAuth, 0));
    root.addEventListener?.('hashchange', () => { if (!sheet && !known() && askTries < 6) { clearTimeout(askT); askT = setTimeout(maybeAsk, 2500); } });
    // Другая вкладка поменяла год — подхватить
    root.addEventListener?.('storage', e => { if (e.key === LS) { S = read(); emit(); } });
  }

  root.D37Age = {
    SITE_AGE, AREAS, UGC_AGE, LEVELS, VIDEO_DEFAULT,
    group, age, known, minor, kid, allows, canOpen, hide18, listOk, num, label, badge,
    year: () => validYear(S.y) ? S.y : null,
    set, clear, skip, confirm18, birthdayPassed, sync, ask, close,
    on(f){ subs.add(f); return () => subs.delete(f); },
    area: route => AREAS[route] || null,
    video, isGambling, kidText,
    cover, coverHtml, uncover, gateRoute, scanPage, settingsRow,
    ugc: { WHY: UGC_WHY, age: ugcAge, col: ugcCol, set: ugcSet, select: ugcSelect, err: ugcErr },
    _test: { S: () => S, reset(){ S = {}; save(); srv = null; }, read, yearNow, rawGroup, groupOfAge, VIDEO_RULES, GAMBLING_RE, WHY18, KID_RE, localSet, onAuth, fromServer, srv: () => srv, setSrv: v => { srv = v; }, maybeAsk, regField, marks, softOk },
  };
})();
