// ═══════════════════════════════════════
//  🩺 ОШИБКИ САЙТА — окно админа (мониторинг, T-016; docs/OPS.md)
// ═══════════════════════════════════════
// Открывается кнопкой в «👑 Панели администратора» профиля (openSiteErrors() в role-management.js грузит этот файл при первом открытии,
// у остальных посетителей его нет). Данные — RPC ops_err_admin / ops_err_act из ops.sql (читает только админ; пока файл не выполнен —
// понятная подсказка). Всё, что пришло из базы, — только через textContent: сообщения присылают браузеры посетителей, им верить нельзя.
(function () {
  'use strict';
  if (window.D37Ops) return;
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;   // let sbClient в chat.js — не свойство window
  const st = { days: 7, hidden: false, data: null, open: new Set(), busy: false };
  let root = null, body = null;

  const CSS = `
.ops-modal{position:fixed;inset:0;z-index:9550;background:rgba(0,0,0,.88);backdrop-filter:blur(14px);display:flex;align-items:flex-start;justify-content:center;padding:1rem;overflow-y:auto}
.ops-box{background:var(--card,#111119);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:18px;width:100%;max-width:980px;padding:1.1rem 1.2rem 1.4rem;position:relative;margin:auto 0}
.ops-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem}
.ops-head h3{font-size:1.1rem;font-weight:800;flex:1;min-width:10rem}
.ops-btn{min-height:36px;padding:.35rem .8rem;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.1));background:rgba(255,255,255,.05);color:var(--text,#f0f0f8);font:inherit;font-size:.75rem;font-weight:700;cursor:pointer}
.ops-btn:hover{border-color:var(--accent,#ff2d55)}.ops-btn.on{background:var(--accent,#ff2d55);border-color:transparent;color:#fff}.ops-btn.danger{color:#ff8a8a}
.ops-btn[disabled]{opacity:.5;cursor:default}
.ops-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem;margin-bottom:.8rem}
.ops-card{background:rgba(255,255,255,.04);border:1px solid var(--border,rgba(255,255,255,.07));border-radius:12px;padding:.55rem .75rem}
.ops-card b{display:block;font-size:1.25rem}.ops-card span{font-size:.68rem;color:var(--muted,#8d8daa)}
.ops-bar{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.8rem}
.ops-chart{display:flex;align-items:flex-end;gap:3px;height:54px;margin-bottom:.9rem}
.ops-chart i{flex:1;min-width:6px;background:linear-gradient(var(--accent,#ff2d55),var(--accent2,#ff6b35));border-radius:3px 3px 0 0;opacity:.85}
.ops-chart i.z{background:rgba(255,255,255,.1);height:2px!important}
.ops-row{background:rgba(255,255,255,.035);border:1px solid var(--border,rgba(255,255,255,.07));border-radius:12px;padding:.6rem .75rem;margin-bottom:.5rem;display:grid;grid-template-columns:auto 1fr;gap:.2rem .75rem}
.ops-row.ign{opacity:.55}.ops-row.new{border-color:rgba(255,107,53,.6)}
.ops-n{grid-row:span 4;min-width:3.2rem;text-align:center;font-weight:800;font-size:1.05rem;align-self:start;padding-top:.1rem}.ops-n small{display:block;font-weight:600;font-size:.6rem;color:var(--muted,#8d8daa)}
.ops-m{font-weight:700;font-size:.82rem;word-break:break-word}
.ops-t{font-size:.7rem;color:var(--muted,#8d8daa);word-break:break-word}
.ops-chips{display:flex;gap:.3rem;flex-wrap:wrap;font-size:.66rem}
.ops-chips span{background:rgba(255,255,255,.07);border-radius:6px;padding:.1rem .4rem}
.ops-act{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.15rem}
.ops-det{grid-column:2;font-size:.7rem;color:var(--muted,#8d8daa);white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);border-radius:8px;padding:.45rem .6rem;font-family:ui-monospace,Consolas,monospace}
.ops-note{font-size:.78rem;color:var(--muted,#8d8daa);line-height:1.55;padding:.8rem;background:rgba(255,255,255,.04);border-radius:12px}
.ops-note b{color:var(--text,#f0f0f8)}.ops-note code{background:rgba(255,255,255,.08);padding:0 .3rem;border-radius:4px}
@media(max-width:560px){.ops-box{padding:.9rem .75rem 1.1rem}.ops-n{min-width:2.6rem}}`;

  // маленький помощник: элемент с текстом (разметка из строк не собирается — только textContent)
  function h(tag, cls, text, kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (kids) for (const k of kids) if (k) e.appendChild(k);
    return e;
  }
  const btn = (text, cls, on) => { const b = h('button', 'ops-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', on); return b; };
  const fmt = n => (+n || 0).toLocaleString('ru-RU');
  const ago = t => {
    const s = Math.max(0, (Date.now() - Date.parse(t)) / 1000);
    return s < 90 ? 'только что' : s < 5400 ? Math.round(s / 60) + ' мин назад' : s < 129600 ? Math.round(s / 3600) + ' ч назад' : Math.round(s / 86400) + ' дн. назад';
  };
  const dm = t => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  // словарь {"ключ": число} → "ключ ×число" по убыванию
  const top = (m, label, n = 5) => Object.entries(m || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => (label ? label(k) : k) + ' ×' + fmt(v));
  const DEV = { m: '📱 телефон', t: '📟 планшет', d: '💻 компьютер' };
  const TYPE = { e: 'ошибка', p: 'обещание', r: 'файл не загрузился', x: 'сообщили вручную', o: 'служебная' };

  // описание для ИИ / разработчика — одним куском текста
  function describe(r) {
    const d = st.data || {};
    return [
      `Ошибка на сайте dan4ik37.vercel.app (${TYPE[r.t] || r.t}): за ${d.days} дн. ${fmt(r.n_win)} раз в ${fmt(r.s_win)} визитах; впервые ${dm(r.first_at)}${r.first_v ? ' (версия ' + r.first_v + ')' : ''}, последний раз ${dm(r.last_at)}${r.last_v ? ' (версия ' + r.last_v + ')' : ''}.`,
      r.m,
      r.f ? `Файл: ${r.f}${r.l ? ':' + r.l : ''}` : '',
      `Разделы: ${top(r.r).join(', ') || '—'}`,
      `Версии сайта: ${top(r.v, k => 'v' + k).join(', ') || '—'}`,
      `Браузеры: ${top(r.b).join(', ') || '—'}; системы: ${top(r.o).join(', ') || '—'}; устройства: ${top(r.d, k => DEV[k] || k).join(', ') || '—'}`,
      r.st ? 'Стек:\n  ' + r.st.split('\n').join('\n  ') : '',
    ].filter(Boolean).join('\n');
  }
  async function copy(text, b) {
    const old = b.textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = '✓ Скопировано'; }
    catch (e) {
      const ta = h('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); b.textContent = '✓ Скопировано'; } catch (x) { b.textContent = 'Не вышло'; }
      ta.remove();
    }
    setTimeout(() => { b.textContent = old; }, 1600);
  }

  async function act(a, k) {
    if (st.busy) return;
    st.busy = true;
    try { const { error } = await sb().rpc('ops_err_act', { p_act: a, p_k: k || null }); if (error) throw error; }
    catch (e) { alert('Не получилось: ' + (e.message || e)); }
    st.busy = false;
    load();
  }

  function row(r, isNew) {
    const open = st.open.has(r.k);
    const el = h('div', 'ops-row' + (r.ign ? ' ign' : '') + (isNew ? ' new' : ''));
    const n = h('div', 'ops-n', fmt(r.n_win) + '×', [h('small', null, fmt(r.s_win) + ' виз.')]);
    el.appendChild(n);
    el.appendChild(h('div', 'ops-m', r.m));
    el.appendChild(h('div', 'ops-t', [(r.f ? r.f + (r.l ? ':' + r.l : '') : TYPE[r.t] || ''), top(r.r, null, 3).join(' · '), 'последний раз ' + ago(r.last_at), 'впервые ' + dm(r.first_at) + (r.first_v ? ' (v' + r.first_v + ')' : ''), r.n_today ? 'сегодня ' + fmt(r.n_today) : ''].filter(Boolean).join(' · ')));
    const chips = h('div', 'ops-chips');
    for (const t of top(r.v, k => 'v' + k, 4)) chips.appendChild(h('span', null, t));
    for (const t of top(r.b, null, 4)) chips.appendChild(h('span', null, t));
    for (const t of top(r.d, k => DEV[k] || k, 3)) chips.appendChild(h('span', null, t));
    el.appendChild(chips);
    const acts = h('div', 'ops-act');
    acts.appendChild(btn(open ? 'Свернуть' : 'Подробнее', '', () => { open ? st.open.delete(r.k) : st.open.add(r.k); render(); }));
    const cp = btn('📋 Для ИИ', '', () => copy(describe(r), cp));
    acts.appendChild(cp);
    acts.appendChild(btn(r.ign ? 'Показывать' : '🙈 Скрыть', '', () => act(r.ign ? 'unign' : 'ign', r.k)));
    el.appendChild(acts);
    if (open) el.appendChild(h('div', 'ops-det', [
      r.st ? 'Стек:\n' + r.st : 'Стека нет (ошибка из чужого файла, eval или без Error).',
      '\nРазделы: ' + (top(r.r, null, 12).join(', ') || '—'),
      'Версии: ' + (top(r.v, k => 'v' + k, 12).join(', ') || '—') + (r.first_v || r.last_v ? ' (первая ' + (r.first_v || '?') + ', последняя ' + (r.last_v || '?') + ')' : ''),
      'Браузеры: ' + (top(r.b, null, 12).join(', ') || '—'),
      'Системы: ' + (top(r.o, null, 12).join(', ') || '—'),
      'Всего за срок хранения: ' + fmt(r.n_all) + ' раз',
      'Отпечаток: ' + r.k,
    ].join('\n')));
    return el;
  }

  function render() {
    if (!body) return;
    body.textContent = '';
    const d = st.data;
    if (!d) return;
    if (d.error) { body.appendChild(h('div', 'ops-note', null, [d.error === 'nosql'
      ? h('div', null, null, [h('b', null, 'Мониторинг ещё не включён в базе. '), document.createTextNode('Выполни файл '), h('code', null, 'ops.sql'), document.createTextNode(' в Supabase (SQL Editor → вставить → Run). Пока этого нет, браузеры шлют отчёты зря и сервер их тихо отбрасывает — сайт при этом работает как обычно.')])
      : h('div', null, String(d.error))])); return; }
    const todays = (d.daily || [])[(d.daily || []).length - 1] || { n: 0, s: 0 };
    const list = (d.top || []).filter(r => st.hidden || !r.ign);
    const newer = r => Date.parse(r.first_at) > Date.now() - st.days * 864e5 && st.days <= 7;
    const q = d.quota || {}, c = d.cfg || {};
    const sum = h('div', 'ops-sum');
    for (const [v, label] of [[fmt(todays.n), 'ошибок сегодня (' + fmt(todays.s) + ' виз.)'], [fmt(list.length), 'разных за период'], [fmt((d.top || []).filter(r => newer(r) && !r.ign).length), 'новых за период'],
      [(q.items ? Math.round(100 * Math.max((q.calls || 0) / (c.calls_day || 1), (q.items || 0) / (c.items_day || 1))) : 0) + ' %', 'потолка за сутки (хранится ' + (c.keep_days || 14) + ' дн.)']]) sum.appendChild(h('div', 'ops-card', null, [h('b', null, v), h('span', null, label)]));
    body.appendChild(sum);
    const bar = h('div', 'ops-bar');
    for (const [dd, label] of [[1, 'Сутки'], [7, '7 дней'], [14, '14 дней']]) bar.appendChild(btn(label, st.days === dd ? 'on' : '', () => { st.days = dd; load(); }));
    bar.appendChild(btn(st.hidden ? '🙈 Скрытые: показаны' : '🙈 Скрытые: нет', st.hidden ? 'on' : '', () => { st.hidden = !st.hidden; render(); }));
    bar.appendChild(btn('↻ Обновить', '', () => load()));
    bar.appendChild(btn('🧹 Очистить всё', 'danger', () => { if (confirm('Стереть все записи об ошибках? Новые продолжат собираться.')) act('clear'); }));
    body.appendChild(bar);
    const mx = Math.max(1, ...(d.daily || []).map(x => x.n));
    const chart = h('div', 'ops-chart');
    for (const x of d.daily || []) { const i = h('i', x.n ? '' : 'z'); i.style.height = x.n ? Math.max(6, Math.round(54 * x.n / mx)) + 'px' : ''; i.title = x.day + ': ' + fmt(x.n) + ' ошибок, ' + fmt(x.s) + ' визитов, ' + fmt(x.keys) + ' разных'; chart.appendChild(i); }
    body.appendChild(chart);
    if (!list.length) body.appendChild(h('div', 'ops-note', null, [h('b', null, st.days === 1 ? 'За сутки ошибок нет 🎉' : 'За выбранный период ошибок нет 🎉'), document.createTextNode(' Браузеры присылают только настоящие ошибки сайта (рекламу, расширения и «пропал интернет» отсеивают). Всего разных в базе: ' + fmt(d.keys_total) + '.')]));
    for (const r of list) body.appendChild(row(r, newer(r)));
    if ((d.top || []).length >= 80) body.appendChild(h('div', 'ops-t', 'Показаны 80 самых частых.'));
  }

  async function load() {
    if (!body) return;
    if (!sb()) { st.data = { error: 'Нет связи с сервером — обнови страницу' }; return render(); }
    body.textContent = 'Загружаем…';
    try {
      const { data, error } = await sb().rpc('ops_err_admin', { p_days: st.days });
      if (error) {
        const m = String(error.message || '') + ' ' + String(error.code || '');
        st.data = { error: /PGRST202|Could not find the function|404/.test(m) ? 'nosql' : /42501|админа/i.test(m) ? 'Только для админа' : 'Ошибка загрузки: ' + (error.message || error.code) };
      } else st.data = data;
    } catch (e) { st.data = { error: 'Ошибка загрузки: ' + (e.message || e) }; }
    render();
  }

  function open() {
    let role = ''; try { role = currentRole; } catch (e) {}   // глобальная из chat.js; сервер всё равно проверяет админа сам
    if (role && role !== 'admin') return;
    if (!document.getElementById('opsCss')) { const s = h('style'); s.id = 'opsCss'; s.textContent = CSS; document.head.appendChild(s); }
    if (!root) {
      root = h('div', 'ops-modal');
      root.addEventListener('click', e => { if (e.target === root) close(); });
      const box = h('div', 'ops-box');
      const head = h('div', 'ops-head', null, [h('h3', null, '🩺 Ошибки сайта'), btn('✕', '', close)]);
      body = h('div', 'ops-body');
      box.appendChild(head); box.appendChild(h('div', 'ops-t', 'Что ломается у посетителей: сообщения браузеров без ников, адресов с параметрами и текста чата. Хранится 14 суток. «📋 Для ИИ» копирует описание — вставь его в чат с Claude.'));
      box.appendChild(body);
      root.appendChild(box);
      document.body.appendChild(root);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && root && root.parentNode) close(); });
    } else document.body.appendChild(root);
    load();
  }
  function close() { if (root && root.parentNode) root.parentNode.removeChild(root); }

  window.D37Ops = { open, close, _test: { describe, top, ago, st } };
})();
