// ═══════════════════════════════════════
//  🏙️ ЭКОНОМИКА ГОРОДА — окно админа «Живого города» (T-032, docs/CITY_ECONOMY.md)
// ═══════════════════════════════════════
// Владелец 22.10.2026: «потом посмотрим — сделаем лог, чтобы проверить баланс». Открывается кнопкой «🏙️ Экономика города» в «👑 Панели
// администратора» профиля (openCityEconomy() в role-management.js грузит файл при первом открытии) и из 📱 «🏦 Банк» (персоналу).
// Вкладки: 📊 Журнал — по дням: выпущено (подарки новичкам, эмиссия, админ) / уничтожено (сверх потолка казны, админ, удалённые) /
// переводы (зарплаты, налог, еда), казна, M против цели T, k центробанка, сколько упёрлись в лимит, «касса пуста», топ профессий,
// подозрительные двойники (ники детей и «без возраста» скрыты), выгрузка CSV; ⚙️ Настройки — числа без кода (белый список city.sql:
// cfgk), пауза города, поправка казны; 🔎 Проверка — сохранение денег (дрейф должен быть 0) и цепочка кошелька игрока.
// Данные — RPC city_admin (city.sql): читать — admin и moderator, менять — только admin. Всё из базы — только через textContent.
(function () {
  'use strict';
  if (window.D37CityAdm) return;
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;   // let sbClient в chat.js — не свойство window
  const st = { tab: 'log', days: 30, log: null, twins: null, cfg: null, sum: null, busy: false, msg: '' };
  let root = null, body = null;
  const isAdmin = () => typeof currentRole !== 'undefined' && currentRole === 'admin';

  const CSS = `
.cea-modal{position:fixed;inset:0;z-index:9550;background:rgba(0,0,0,.88);backdrop-filter:blur(14px);display:flex;align-items:flex-start;justify-content:center;padding:1rem;overflow-y:auto}
.cea-box{background:var(--card,#111119);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:18px;width:100%;max-width:1100px;padding:1.1rem 1.2rem 1.4rem;position:relative;margin:auto 0}
.cea-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem}.cea-head h3{font-size:1.1rem;font-weight:800;flex:1;min-width:10rem}
.cea-btn{min-height:36px;padding:.35rem .8rem;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.1));background:rgba(255,255,255,.05);color:var(--text,#f0f0f8);font:inherit;font-size:.75rem;font-weight:700;cursor:pointer}
.cea-btn:hover{border-color:var(--accent,#ff2d55)}.cea-btn.on{background:var(--accent,#ff2d55);border-color:transparent;color:#fff}.cea-btn[disabled]{opacity:.5;cursor:default}
.cea-bar{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin:.2rem 0 .8rem}
.cea-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem;margin-bottom:.8rem}
.cea-card{background:rgba(255,255,255,.04);border:1px solid var(--border,rgba(255,255,255,.07));border-radius:12px;padding:.55rem .75rem}
.cea-card b{display:block;font-size:1.2rem}.cea-card span{font-size:.68rem;color:var(--muted,#8d8daa)}.cea-card.ok{border-color:rgba(74,222,128,.5)}.cea-card.bad{border-color:rgba(248,113,113,.7)}
.cea-sec{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8d8daa);margin:1rem 0 .4rem}
.cea-wrap{overflow-x:auto;border:1px solid var(--border,rgba(255,255,255,.07));border-radius:12px}
.cea-t{border-collapse:collapse;width:100%;font-size:.72rem;white-space:nowrap}.cea-t th,.cea-t td{padding:.35rem .5rem;border-bottom:1px solid rgba(255,255,255,.05);text-align:right}
.cea-t th{position:sticky;top:0;background:#16162a;font-weight:800;color:var(--muted,#8d8daa)}.cea-t td:first-child,.cea-t th:first-child,.cea-t td:nth-child(2),.cea-t th:nth-child(2){text-align:left}
.cea-t tr.today td{background:rgba(250,204,21,.07)}
.cea-note{font-size:.78rem;color:var(--muted,#8d8daa);line-height:1.55;padding:.8rem;background:rgba(255,255,255,.04);border-radius:12px;margin-bottom:.6rem}
.cea-note b{color:var(--text,#f0f0f8)}
.cea-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.45rem}
.cea-f{display:grid;grid-template-columns:1fr 90px auto;gap:.35rem;align-items:center;font-size:.74rem;background:rgba(255,255,255,.03);border-radius:10px;padding:.35rem .5rem}
.cea-f input{width:100%;min-height:32px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.12));background:rgba(0,0,0,.25);color:var(--text,#f0f0f8);padding:0 .45rem;font:inherit}
.cea-f.set input{border-color:#facc15}.cea-f small{display:block;color:var(--muted,#8d8daa);font-size:.62rem}
.cea-tw{background:rgba(255,255,255,.035);border:1px solid var(--border,rgba(255,255,255,.07));border-radius:12px;padding:.5rem .7rem;margin-bottom:.4rem;font-size:.74rem}
.cea-tw span{display:inline-block;background:rgba(255,255,255,.07);border-radius:6px;padding:.1rem .4rem;margin:.15rem .25rem 0 0}
.cea-msg{font-size:.78rem;margin:.4rem 0}.cea-msg.err{color:#ff8a8a}.cea-msg.ok{color:#4ade80}
@media(max-width:560px){.cea-box{padding:.9rem .7rem 1.1rem}.cea-f{grid-template-columns:1fr 80px auto}}`;
  function h(tag, cls, text, kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (kids) for (const k of kids) if (k) e.appendChild(k);
    return e;
  }
  const btn = (text, cls, on) => { const b = h('button', 'cea-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', on); return b; };
  const fmt = n => (+n || 0).toLocaleString('ru-RU');
  const C_N = { kids: '🧸 Солнечный городок', metro: '🏙️ Большой город' };
  const PN = id => (window.MirEcon?.PROFS?.[id] ? window.MirEcon.PROFS[id].e + ' ' + window.MirEcon.PROFS[id].n : id);
  const GN = id => (window.MirEcon?.GOODS?.[id] ? window.MirEcon.GOODS[id].e + ' ' + window.MirEcon.GOODS[id].n : id);
  async function rpc(name, args) {
    if (!sb()) return { ok: false, reason: 'net' };
    try {
      const { data, error } = await sb().rpc(name, args || {});
      if (error) return { ok: false, reason: error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '') ? 'nosql' : 'net', error };
      return data || { ok: false, reason: 'net' };
    } catch (e) { return { ok: false, reason: 'net' }; }
  }
  const nosqlNote = () => h('div', 'cea-note', null, [h('b', null, 'Экономика города ещё не включена. '), document.createTextNode('Выполни city.sql в Supabase → SQL Editor (список «Ожидает запуска» — CLAUDE.md), потом открой окно снова.')]);
  const why = r => ({ rights: 'Только для администрации', nosql: 'Нужен city.sql', net: 'Нет связи — попробуй ещё раз', args: 'Неверное значение' + (r.key ? ': ' + r.key : ''), city: 'Нет города', treasury: 'В казне столько нет', none: 'Не найдено' }[r?.reason] || 'Ошибка');

  // ── строки журнала: день × город ──
  const row = (c, d, s) => ({
    d, c, grant: s.mint?.grant | 0, issue: s.mint?.issue | 0, adm: s.mint?.adm | 0, cap: s.burn?.cap | 0, admB: s.burn?.adm | 0, gone: s.burn?.gone | 0,
    wage: s.tr?.wage | 0, tax: Math.round((s.tr?.t100 | 0) / 100), food: s.tr?.food | 0, tasks: s.n?.tasks | 0, people: s.people ?? '', caphit: s.n?.caphit | 0, tired: s.n?.tired | 0,
    noslot: s.n?.noslot | 0, soon: s.n?.soon | 0, nonce: s.n?.nonce | 0, treasury: s.treasury ?? '', M: s.M ?? '', T: s.T ?? '', k: s.k ?? '', a7: s.a7 ?? '',
    top: Object.entries(s.pn || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, v]) => `${p} ${v}`).join(', '),
  });
  const COLS = [['d', 'Дата'], ['c', 'Город'], ['grant', '🎁 подарки'], ['issue', '🏦 эмиссия'], ['adm', '🛠 +админ'], ['cap', '🔥 сверх казны'], ['admB', '🛠 −админ'], ['gone', '🗑 удалённые'],
    ['wage', '🧰 зарплаты'], ['tax', 'налог'], ['food', '🍽 еда'], ['tasks', 'заданий'], ['people', 'работали'], ['caphit', 'упёрлись в 400'], ['tired', 'устали (60)'], ['noslot', 'касса пуста'],
    ['soon', 'рано (too_soon)'], ['nonce', 'чужой номер'], ['treasury', 'казна'], ['M', 'M'], ['T', 'T'], ['k', 'k ‰'], ['a7', 'A7'], ['top', 'топ профессий']];
  function rowsOf(L) {
    const out = [];
    if (!L) return out;
    for (const [c, x] of Object.entries(L.cities || {})) if (x.today) out.push({ ...row(c, x.day || L.today, x.today), treasury: x.treasury, M: L.bank?.M, T: L.bank?.T, k: L.bank?.k, today: true });
    for (const y of L.days || []) out.push(row(y.c, y.d, y.s || {}));
    return out;
  }
  function csv() {
    const L = rowsOf(st.log), q = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = String.fromCharCode(0xFEFF) + [COLS.map(c => q(c[1])).join(';'), ...L.map(r => COLS.map(c => q(c[0] === 'c' ? C_N[r.c] || r.c : r[c[0]])).join(';'))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'economy-' + (st.log?.today || 'city') + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function drawLog() {
    const L = st.log;
    if (!L) return h('div', 'cea-note', 'Загружаем…');
    if (!L.ok) return L.reason === 'nosql' ? nosqlNote() : h('div', 'cea-note', why(L));
    const wrap = h('div');
    const cards = h('div', 'cea-sum');
    const B = L.bank || {}, pct = B.T ? Math.round((B.M || 0) * 100 / B.T) : 0;
    for (const [c, x] of Object.entries(L.cities || {})) {
      cards.appendChild(h('div', 'cea-card', null, [h('b', null, fmt(x.treasury) + ' 💵'), h('span', null, `${C_N[c] || c}: казна${x.frozen ? ' · ⏸ пауза' : ''} (запас ${fmt(x.reserve)})`)]));
      cards.appendChild(h('div', 'cea-card', null, [h('b', null, '+' + fmt(x.minted) + ' / −' + fmt(x.burned)), h('span', null, `${C_N[c] || c}: всего выпущено / уничтожено`)]));
    }
    cards.appendChild(h('div', 'cea-card' + (pct > 130 || pct < 70 ? ' bad' : ' ok'), null, [h('b', null, `${fmt(B.M)} / ${fmt(B.T)}`), h('span', null, `M (средний кошелёк за 14 дней) / цель T — ${pct} % · игроков ${fmt(B.actives)}`)]));
    cards.appendChild(h('div', 'cea-card', null, [h('b', null, (B.k ?? '—') + ' ‰'), h('span', null, 'k центробанка (1000 — норма; ниже — эмиссия меньше)')]));
    wrap.appendChild(cards);
    const bar = h('div', 'cea-bar', null, [
      ...[7, 30, 90].map(d => btn(d + ' дн.', st.days === d ? 'on' : '', () => { st.days = d; load('log', true); })),
      btn('⬇ CSV', '', csv), btn('⟳ Обновить', '', () => load('log', true)),
    ]);
    wrap.appendChild(bar);
    // сегодня: топ профессий и еды
    for (const [c, x] of Object.entries(L.cities || {})) {
      const t = x.today || {}, pn = Object.entries(t.pn || {}).sort((a, b) => b[1] - a[1]), fs = Object.entries(t.fs || {}).sort((a, b) => b[1] - a[1]);
      wrap.appendChild(h('div', 'cea-note', null, [h('b', null, `${C_N[c] || c}, сегодня: `),
        document.createTextNode(`заданий ${fmt(t.n?.tasks)}, зарплаты ${fmt(t.tr?.wage)} 💵 (налог ${fmt(Math.round((t.tr?.t100 | 0) / 100))}), еда ${fmt(t.tr?.food)}, подарки ${fmt(t.mint?.grant)}, эмиссия ${fmt(t.mint?.issue)}; ` +
          `упёрлись в дневной лимит — ${fmt(t.n?.caphit)}, «касса пуста» — ${fmt(t.n?.noslot)}, «рано» — ${fmt(t.n?.soon)}. ` +
          (pn.length ? 'Больше всего платят: ' + pn.slice(0, 5).map(([p, v]) => `${PN(p)} ${fmt(v)} 💵 (${fmt(t.pt?.[p])} зад.)`).join(', ') + '. ' : '') +
          (fs.length ? 'Еда: ' + fs.slice(0, 5).map(([g, v]) => `${GN(g)} ×${v}`).join(', ') + '.' : ''))]));
    }
    const R = rowsOf(L);
    const tb = h('table', 'cea-t');
    const hd = h('tr'); for (const c of COLS) hd.appendChild(h('th', null, c[1]));
    tb.appendChild(h('thead', null, [hd]));
    const bd = h('tbody');
    for (const r of R) { const tr = h('tr', r.today ? 'today' : ''); for (const c of COLS) tr.appendChild(h('td', null, c[0] === 'c' ? (C_N[r.c] || r.c) : c[0] === 'd' ? r.d + (r.today ? ' (сегодня)' : '') : typeof r[c[0]] === 'number' ? fmt(r[c[0]]) : String(r[c[0]] ?? ''))); bd.appendChild(tr); }
    tb.appendChild(bd);
    wrap.appendChild(h('div', 'cea-sec', 'По дням'));
    wrap.appendChild(h('div', 'cea-wrap', null, [tb]));
    if (!R.length) wrap.appendChild(h('div', 'cea-note', 'Пока пусто — журнал заполнится, когда в городах начнут работать.'));
    // двойники
    wrap.appendChild(h('div', 'cea-sec', 'Подозрительные: общий IP или браузер за 30 дней'));
    const T = st.twins;
    if (!T) wrap.appendChild(h('div', 'cea-note', 'Загружаем…'));
    else if (!T.ok) wrap.appendChild(h('div', 'cea-note', why(T)));
    else if (!T.list.length) wrap.appendChild(h('div', 'cea-note', 'Не найдено — хорошо.'));
    else for (const x of T.list) {
      const el = h('div', 'cea-tw', null, [h('b', null, `${x.kind === 'ip' ? '🌐 общий интернет' : '💻 общий браузер'} · ${x.n} аккаунта(ов) · метка ${x.h}`), h('br')]);
      for (const a of x.acc || []) el.appendChild(h('span', null, `${a.nick ? a.nick : '🔒 скрыт (ребёнок или возраст не указан)'} · #${a.id} · 💵 ${fmt(a.cash)} · зарплаты за 7 дн. ${fmt(a.w7)}`));
      wrap.appendChild(el);
    }
    wrap.appendChild(h('div', 'cea-note', 'Общий IP бывает и у честных (семья, школа, мобильный интернет). Переводов денек между игроками нет — двойник может только сам работать в пределах лимитов. Подозрительно: много аккаунтов на одном браузере и у всех зарплата под лимит.'));
    return wrap;
  }

  // ── настройки: поля из белого списка cfgk ──
  function fieldsOf(base) {
    const out = [];
    for (const [pat, lo, hi] of base.cfgk || []) {
      const parts = pat.split('.'), star = parts.indexOf('*');
      const keys = star < 0 ? [pat] : Object.keys(parts.slice(0, star).reduce((o, k) => o?.[k], base) || {}).map(k => [...parts.slice(0, star), k, ...parts.slice(star + 1)].join('.'));
      for (const k of keys) { const v = k.split('.').reduce((o, x) => o?.[x], base); if (typeof v === 'number') out.push({ k, lo, hi, base: v }); }
    }
    return out;
  }
  const LABEL = k => {
    const p = k.split('.');
    if (k === 'start') return '🎁 Подарок новичку, 💵';
    if (p[0] === 'profs') return `${PN(p[1])}: ${p[2] === 'wage' ? 'зарплата за задание, 💵' : 'мин. время задания, с'}`;
    if (p[0] === 'caps') return { wageDay: 'Зарплата в день, не больше (валовая), 💵', full: 'Заданий одной работы с полной зарплатой', half: 'Заданий одной работы в день, всего', foodDay: 'Еды купить в день', foodHold: 'Еды одного вида в кармане' }[p[1]] || k;
    if (p[0] === 'cities') return `${C_N[p[1]] || p[1]}: ` + ({ 'tax.income': 'налог с зарплаты, %', 'tax.sales': 'налог с продаж, % (P2)', 'issue.base': 'эмиссия в день — база', 'issue.per': 'эмиссия — за активного жителя', 'issue.cap': 'эмиссия — не больше', reserve: 'неприкосновенный запас казны', capDays: 'казна — не больше (дней эмиссии)' }[p.slice(2).join('.')] || k);
    if (k === 'bank.T') return '🏦 Цель центробанка T (средний кошелёк), 💵';
    if (p[0] === 'goods') return `${GN(p[1])}: опорная цена (в магазине ×1,25)`;
    if (k === 'site.units') return '🏗️ Заданий строителей на этап стройки';
    return k;
  };
  function drawCfg() {
    const X = st.cfg;
    if (!X) return h('div', 'cea-note', 'Загружаем…');
    if (!X.ok) return X.reason === 'nosql' ? nosqlNote() : h('div', 'cea-note', why(X));
    const wrap = h('div');
    const adm = isAdmin();
    wrap.appendChild(h('div', 'cea-note', null, [h('b', null, 'Числа экономики без кода. '), document.createTextNode('Пустое поле — как в каталоге (серое число). Жёлтое — твоя настройка. Меняется сразу у всех (клиенты перечитают каталог за пару минут). ' + (adm ? '' : 'Менять может только администратор.'))]));
    const grid = h('div', 'cea-grid'), inputs = [];
    for (const f of fieldsOf(X.base)) {
      const cur = X.data?.[f.k];
      const inp = h('input'); inp.type = 'number'; inp.min = f.lo; inp.max = f.hi; inp.step = 1; inp.placeholder = String(f.base); if (cur != null) inp.value = String(cur); inp.disabled = !adm;
      const reset = btn('↺', '', () => { inp.value = ''; }); reset.title = 'Как в каталоге'; reset.disabled = !adm;
      const lab = h('div', null, LABEL(f.k), [h('small', null, `${f.k} · ${f.lo}…${f.hi}`)]);
      grid.appendChild(h('label', 'cea-f' + (cur != null ? ' set' : ''), null, [lab, inp, reset]));
      inputs.push({ f, inp, cur });
    }
    wrap.appendChild(grid);
    const msg = h('div', 'cea-msg', st.msg); wrap.appendChild(msg);
    if (adm) {
      wrap.appendChild(h('div', 'cea-bar', null, [btn('💾 Сохранить', 'on', async b => {
        const set = {};
        for (const { f, inp, cur } of inputs) {
          const v = inp.value.trim() === '' ? null : Math.round(+inp.value);
          if (v !== null && (!Number.isFinite(v) || v < f.lo || v > f.hi)) { msg.className = 'cea-msg err'; msg.textContent = `${LABEL(f.k)}: от ${f.lo} до ${f.hi}`; return; }
          if (v !== (cur ?? null)) set[f.k] = v;
        }
        if (!Object.keys(set).length) { msg.className = 'cea-msg'; msg.textContent = 'Ничего не поменялось'; return; }
        const r = await rpc('city_admin', { p_act: 'cfg', p_a: { set } });
        if (r.ok) { st.cfg = r; st.msg = '✅ Сохранено: ' + Object.keys(set).length + ' настр.'; draw(); } else { msg.className = 'cea-msg err'; msg.textContent = why(r); }
      })]));
      // пауза и поправка казны
      wrap.appendChild(h('div', 'cea-sec', 'Пауза и казна'));
      const L = st.log?.cities || {};
      const row2 = h('div', 'cea-bar');
      for (const c of ['kids', 'metro']) {
        const fr = !!L[c]?.frozen;
        row2.appendChild(btn(`${fr ? '▶ Снять паузу' : '⏸ Пауза'}: ${C_N[c]}`, fr ? 'on' : '', async () => {
          if (!fr && !confirm(`Поставить ${C_N[c]} на паузу? Работы и магазины закроются, пока не снимешь.`)) return;
          const r = await rpc('city_admin', { p_act: 'freeze', p_a: { city: c, on: !fr } }); st.msg = r.ok ? '✅ Готово' : why(r); load('log', true);
        }));
      }
      wrap.appendChild(row2);
      const sel = h('select'); for (const c of ['kids', 'metro']) { const o = h('option', null, C_N[c]); o.value = c; sel.appendChild(o); }
      const amt = h('input'); amt.type = 'number'; amt.placeholder = '± денки'; amt.style.width = '110px';
      const rea = h('input'); rea.placeholder = 'причина'; rea.maxLength = 60;
      for (const e of [sel, amt, rea]) Object.assign(e.style, { minHeight: '34px', borderRadius: '8px', border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.25)', color: 'inherit', padding: '0 .45rem' });
      wrap.appendChild(h('div', 'cea-bar', null, [sel, amt, rea, btn('Поправить казну', '', async () => {
        const n = Math.round(+amt.value); if (!n) return;
        if (!confirm(`${n > 0 ? 'Выпустить' : 'Уничтожить'} ${fmt(Math.abs(n))} 💵 в казне «${C_N[sel.value]}»?`)) return;
        const r = await rpc('city_admin', { p_act: 'grant', p_a: { city: sel.value, n, why: rea.value.slice(0, 60) } });
        st.msg = r.ok ? `✅ Казна: ${fmt(r.treasury)} 💵` : why(r); load('log', true); draw();
      })]));
    }
    wrap.appendChild(h('div', 'cea-sec', 'История настроек'));
    if (!(X.hist || []).length) wrap.appendChild(h('div', 'cea-note', 'Пока ничего не меняли.'));
    for (const e of X.hist || []) wrap.appendChild(h('div', 'cea-tw', `${new Date(e.at * 1000).toLocaleString('ru-RU')} · #${e.by}: ` + Object.entries(e.set || {}).map(([k, v]) => `${LABEL(k)} → ${v === null ? 'как в каталоге' : v}`).join('; ')));
    return wrap;
  }

  function drawCheck() {
    const S = st.sum, wrap = h('div');
    if (!S) return h('div', 'cea-note', 'Загружаем…');
    if (!S.ok) return S.reason === 'nosql' ? nosqlNote() : h('div', 'cea-note', why(S));
    const cards = h('div', 'cea-sum');
    for (const [v, t, cls] of [[fmt(S.cash) + ' 💵', `кошельки игроков (${fmt(S.people)})`], [fmt(S.treasury) + ' 💵', 'казна городов'], [fmt(S.minted) + ' 💵', 'всего выпущено'], [fmt(S.burned) + ' 💵', 'всего уничтожено'],
      [S.drift === 0 ? '✅ 0' : '⚠️ ' + fmt(S.drift), 'дрейф: кошельки + казна − (выпущено − уничтожено)', S.drift === 0 ? 'ok' : 'bad']]) cards.appendChild(h('div', 'cea-card' + (cls ? ' ' + cls : ''), null, [h('b', null, v), h('span', null, t)]));
    wrap.appendChild(cards);
    wrap.appendChild(h('div', 'cea-note', 'Денки не появляются из воздуха: всё, что в кошельках и казне, — это подарки новичкам, эмиссия и поправки админа минус уничтоженное. Дрейф не ноль — пиши разработчику (номер дня и этот экран).'));
    wrap.appendChild(h('div', 'cea-sec', 'Цепочка кошелька игрока'));
    const inp = h('input'); inp.placeholder = 'id игрока (или первые 8 знаков)'; Object.assign(inp.style, { minHeight: '34px', borderRadius: '8px', border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.25)', color: 'inherit', padding: '0 .45rem', minWidth: '260px' });
    const out = h('div', 'cea-msg');
    wrap.appendChild(h('div', 'cea-bar', null, [inp, btn('Проверить', '', async () => {
      const r = await rpc('city_admin', { p_act: 'audit', p_a: { uid: inp.value.trim() } });
      out.className = 'cea-msg ' + (r.ok && r.match && !r.breaks ? 'ok' : 'err');
      out.textContent = r.ok ? `#${r.id}: строк журнала ${r.rows}, разрывов ${r.breaks}, кошелёк ${fmt(r.cash)} 💵, по журналу ${r.last == null ? '—' : fmt(r.last)} — ${r.match && !r.breaks ? 'сходится ✅' : 'НЕ сходится ⚠️'}` : why(r);
    })]));
    wrap.appendChild(out);
    return wrap;
  }

  function draw() {
    if (!body) return;
    body.textContent = '';
    const tabs = h('div', 'cea-bar', null, [['log', '📊 Журнал'], ['cfg', '⚙️ Настройки'], ['check', '🔎 Проверка']].map(([id, t]) => btn(t, st.tab === id ? 'on' : '', () => { st.tab = id; st.msg = ''; load(id); draw(); })));
    body.appendChild(tabs);
    body.appendChild(st.tab === 'log' ? drawLog() : st.tab === 'cfg' ? drawCfg() : drawCheck());
  }
  async function load(tab, force) {
    if (tab === 'log' && (force || !st.log)) { st.log = await rpc('city_admin', { p_act: 'log', p_a: { days: st.days } }); if (st.log.ok) st.twins = await rpc('city_admin', { p_act: 'twins' }); }
    else if (tab === 'cfg' && (force || !st.cfg)) { st.cfg = await rpc('city_admin', { p_act: 'cfg' }); if (!st.log) st.log = await rpc('city_admin', { p_act: 'log', p_a: { days: 7 } }); }
    else if (tab === 'check') st.sum = await rpc('city_admin', { p_act: 'sum' });
    else return;
    if (root) draw();
  }
  function ensureNames() {   // названия профессий и еды — из каталога (js/games/mir-econ.js), если ещё не загружен
    if (window.MirEcon) return;
    const s = document.createElement('script'); s.src = 'js/games/mir-econ.js?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
    s.onload = () => { if (root) draw(); }; document.head.appendChild(s);
  }
  function open() {
    if (!document.getElementById('ceaCss')) { const s = document.createElement('style'); s.id = 'ceaCss'; s.textContent = CSS; document.head.appendChild(s); }
    ensureNames();
    if (!root) {
      root = h('div', 'cea-modal');
      const box = h('div', 'cea-box');
      body = h('div');
      box.appendChild(h('div', 'cea-head', null, [h('h3', null, '🏙️ Экономика города (денки 💵)'), btn('✕ Закрыть', '', close)]));
      box.appendChild(body);
      root.appendChild(box);
      root.addEventListener('click', e => { if (e.target === root) close(); });
      document.addEventListener('keydown', onKey);
    }
    document.body.appendChild(root);
    draw(); load(st.tab, true);
  }
  const onKey = e => { if (e.key === 'Escape' && root?.isConnected) close(); };
  function close() { root?.remove(); }
  window.D37CityAdm = { open, close, _st: st };
})();
