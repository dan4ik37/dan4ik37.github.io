// ═══════════════════════════════════════
//  ❓ ОБЪЯСНЕНИЯ «ДИСКОРДА» (T-168, ds-help)
// ═══════════════════════════════════════
// Владелец 19.11: «многие функции слабые нет объяснения. Нужен гайд по созданию». Здесь — только показ и уже готовые функции сервера:
//  • приветствие при первом заходе (вместо однострочной подсказки; d37_ds_hi) — что это, как писать, как звонить + «Создать» / «Найти»;
//  • #/chat/help — страница «что здесь есть» (строка-две на функцию), «?» в шапке чата;
//  • #/chat/guide — «Гайд»: своё сообщество по шагам (название → значок → готовые каналы → ссылка-приглашение → роли);
//    сервер решает всё сам (cm_create, cm_channel_save, cm_role_save — те же, что у обычной формы; дети до 9 — сервер откажет);
//  • подсказки у значков: на телефоне долгое нажатие на кнопку-значок показывает её название (title / aria-label).
// Тексты свои (без чужого ввода), чужое (название сообщества) — только через esc(). Стили — css/ds-help.css.
// Откат одной строкой: HELP_ON = false (всё как до T-168: однострочная подсказка, «＋» ведёт на обычную форму).
(() => {
  'use strict';
  if (window.D37Help) return;
  const HELP_ON = true;
  const H = window.D37Help = { on: HELP_ON };
  if (!HELP_ON) return;
  const P = window.D37Phone, DS = window.D37DS; if (!P || !DS) return;
  const e = s => esc(String(s ?? ''));
  const X = DS.x = DS.x || {}; X.special = X.special || {};
  if (document.head && !document.getElementById('dshCss')) {
    const l = document.createElement('link'); l.id = 'dshCss'; l.rel = 'stylesheet'; l.href = 'css/ds-help.css?v=1'; document.head.appendChild(l);
  }
  const KEY = 'd37_ds_hi';
  const seen = () => { try { return !!localStorage.getItem(KEY); } catch (er) { return true; } };
  const setSeen = () => { try { localStorage.setItem(KEY, '1'); localStorage.setItem('d37_ds_tip', '1'); } catch (er) {} };
  const go = (mode, h) => DS.go ? DS.go(mode, h) : (location.hash = h);

  // ── 1) приветствие (крючок community.js paintTip) ──
  X.welcome = (el, on) => {
    el.hidden = !on || seen();
    if (el.hidden) return;
    const phone = matchMedia('(max-width: 860px)').matches;
    el.classList.add('dsh-hi');
    el.innerHTML = `<div class="dsh-hi-t"><b>👋 Это чат сайта — как Дискорд</b>
        <span>💬 Слева${phone ? ' (кнопка ☰)' : ''} — серверы и каналы. Сервер «Денчик37» — общий для всех.</span>
        <span>✍️ Пиши в поле внизу и жми ${phone ? '➤' : 'Enter'}.</span>
        <span>📞 Позвонить другу — кнопка 📱 (телефон сайта); поговорить всем вместе — голосовой канал 🔊.</span></div>
      <div class="dsh-hi-b"><a class="ds-btn ds-sm" href="${DS.special('page', 'guide')}" data-dsh="hiok">🏰 Создать свой сервер</a><a class="ds-btn ghost ds-sm" href="${DS.special('page', 'find')}" data-dsh="hiok">🧭 Найти сервер</a><a class="ds-btn ghost ds-sm" href="${DS.special('page', 'help')}" data-dsh="hiok">❓ Что здесь есть</a><button type="button" class="dsh-x" data-dsh="hiok" title="Понятно, скрыть" aria-label="Скрыть приветствие">✕</button></div>`;
    el.onclick = ev => { if (ev.target.closest('[data-dsh="hiok"]')) { setSeen(); el.hidden = true; el.classList.remove('dsh-hi'); el.innerHTML = ''; } };
  };
  H.resetWelcome = () => { try { localStorage.removeItem(KEY); } catch (er) {} };

  // ── 2) страница «что здесь есть» ──
  const HELP = [
    ['💬', 'Чаты', 'Каналы с сообщениями внутри сервера. Пиши в поле внизу. Удержи сообщение (на ПК — наведи), чтобы ответить, поставить реакцию или пожаловаться.'],
    ['👥', 'Друзья', 'Кнопка 👥 вверху слева: кто в сети, заявки, «＋ Добавить». Другу можно написать в личку и позвонить.'],
    ['👪', 'Группы', 'Общий чат на нескольких друзей (до 10): 👥 → «Группы» → создать.'],
    ['🏰', 'Серверы', '«Денчик37» — сервер сайта. «＋» — свой сервер (до 3), 🧭 — найти чужие. Внутри — каналы, роли, модераторы.'],
    ['#', 'Каналы', '# — текстовый, 🔊 — голосовой. Значки рядом: 13+ — с какого возраста, 🐢 — пишут не чаще раза в N секунд, 📢 — пишут только модераторы.'],
    ['🔊', 'Голос', 'Нажми на голосовой канал и разреши микрофон. Внизу: 🎙 — выключить микрофон, 🎧 — звук, ✕ — выйти. Проверить микрофон и камеру — 📱 → 🎛 Проверка.'],
    ['📷', 'Камера', 'В звонках и голосовых — кнопка 📷. Своё видео пока могут включать только взрослые (18+): так мы защищаем детей. Голос — с 9 лет.'],
    ['🔒', 'Пароль на канал', 'Владелец может закрыть текстовый канал паролем — зайдут только те, кто его знает. Это замок на двери, а не шифрование: сообщения хранятся на сайте, как обычно.'],
    ['😀', 'Свои смайлики', 'У сервера бывают свои эмодзи, стикеры и звуки — владелец добавляет их в ⚙️ настройках сервера; выбрать — 😀 у поля ввода.'],
    ['📅', 'События', 'Анонс игры или стрима: время, кто придёт, напоминание. Список — вверху каналов сервера.'],
    ['🧵', 'Ветки и опросы', 'Ветка — отдельный разговор под сообщением (меню сообщения). Опрос — ➕ у поля ввода → 📊 Опрос.'],
    ['🛡', 'Безопасность', 'Жалоба — 🚩 у сообщения. Блок и игнор — в карточке человека (нажми на ник). Не пиши свой адрес, телефон и школу.'],
  ];
  X.special.help = {
    title: '❓ Что здесь есть',
    render(el, mode){
      el.innerHTML = `<div class="ds-pane dsh-help"><h3>❓ Что здесь есть</h3><p class="ds-dim">Коротко о каждой функции. Не нашёл ответ — напиши в #общий, там помогут.</p>
        <div class="dsh-list">${HELP.map(([i, t, d]) => `<div class="dsh-it"><i>${i}</i><span><b>${t}</b><small>${d}</small></span></div>`).join('')}</div>
        <div class="ds-row"><a class="ds-btn" href="${DS.special(mode, 'guide')}">🏰 Создать свой сервер по шагам</a><button type="button" class="ds-btn ghost" data-dsh="again">👋 Показать приветствие снова</button></div></div>`;
      el.querySelector('[data-dsh="again"]').onclick = () => { H.resetWelcome(); go(mode, DS.link(mode, DS.OFF_ID)); };
    },
  };

  // ── 3) Гайд: своё сообщество по шагам ──
  const TPL = {
    friends: { t: '🤝 Для друзей', d: 'болтать, мемы, голосовой', ch: [['мемы', 'text'], ['музыка', 'text']] },
    game: { t: '🎮 Для игры', d: 'поиск тиммейтов, скриншоты, два голосовых', ch: [['поиск-тиммейтов', 'text'], ['скриншоты', 'text'], ['Голосовой 2', 'voice']] },
    stream: { t: '📺 Для стримера', d: 'анонсы, клипы, голосовой для зрителей', ch: [['клипы', 'text'], ['идеи-для-стрима', 'text']] },
  };
  const ROLES = [['mod', '🛡 Модератор', '#ef4444', 6, 'удаляет плохие сообщения, закрепляет'], ['vip', '⭐ Активный', '#f59e0b', 0, 'просто цвет ника — за помощь и активность']];
  const STEPS = ['Название', 'Значок', 'Каналы', 'Приглашение', 'Роли'];
  X.special.guide = {
    title: '🏰 Свой сервер — по шагам',
    render(el, mode){
      if (!P.me()) { P.login(el, 'Свой сервер могут создать вошедшие игроки. Это бесплатно.'); return; }
      const G = { step: 0, name: '', icon: '🎮', tpl: 'friends', pub: true, id: null, code: '', roles: new Set(['mod']), busy: false, err: '' };
      const icons = DS.ICONS || ['💬', '🎮', '🏰'];
      const draw = () => {
        const s = G.step, bar = `<ol class="dsh-steps">${STEPS.map((t, i) => `<li class="${i < s ? 'done' : i === s ? 'on' : ''}"><i>${i < s ? '✓' : i + 1}</i><span>${t}</span></li>`).join('')}</ol>`;
        let body = '';
        if (s === 0) body = `<h3>Как назовём сервер?</h3><p class="ds-dim">Это имя увидят все в списке серверов. Потом можно поменять.</p>
          <input class="ds-in" data-g="name" maxlength="40" placeholder="Например: Клан Денчика" value="${e(G.name)}" aria-label="Название сервера">
          <label class="ds-chk"><input type="checkbox" data-g="pub"${G.pub ? ' checked' : ''}> Открытый — его найдут в 🧭 обзоре. Без галочки — вход только по ссылке.</label>`;
        else if (s === 1) body = `<h3>Выбери значок</h3><p class="ds-dim">Он будет кружком слева, в списке серверов.</p>
          <div class="ds-icons">${icons.map(x => `<button type="button" class="${x === G.icon ? 'on' : ''}" data-ic="${e(x)}" aria-label="Значок ${e(x)}">${e(x)}</button>`).join('')}</div>`;
        else if (s === 2) body = `<h3>Для чего сервер?</h3><p class="ds-dim">Сделаем готовые каналы. У всех будут #общий, #новости и 🔊 Голосовой — плюс эти:</p>
          <div class="dsh-tpls">${Object.entries(TPL).map(([k, t]) => `<button type="button" class="dsh-tpl${k === G.tpl ? ' on' : ''}" data-tpl="${k}"><b>${t.t}</b><small>${t.d}</small><em>${t.ch.map(c => (c[1] === 'voice' ? '🔊 ' : '# ') + c[0]).join(' · ')}</em></button>`).join('')}</div>
          <p class="ds-dim">Правила для всех серверов: без мата, оскорблений, рекламы и ссылок; не проси и не пиши личные данные.</p>`;
        else if (s === 3) { const url = `${location.origin}/c/${G.code}`; body = `<h3>🎉 Сервер «${e(G.name)}» готов!</h3><p class="ds-dim">Отправь друзьям эту ссылку — по ней они вступят в один клик.</p>
          <div class="ds-row"><input class="ds-in" readonly value="${e(url)}" data-g="url" aria-label="Ссылка-приглашение"><button type="button" class="ds-btn" data-gx="copy">📋 Скопировать</button></div>
          <p class="ds-dim">Ссылка всегда есть в 🔗 вверху сервера. Новую (старая перестанет работать) — в ⚙️ настройках.</p>`; }
        else body = `<h3>Кто будет помогать?</h3><p class="ds-dim">Роль — это значок и цвет ника. Ты — 👑 владелец. Отметь роли, которые создать сейчас:</p>
          <div class="dsh-roles">${ROLES.map(([k, t, c, , d]) => `<label class="dsh-role"><input type="checkbox" data-role="${k}"${G.roles.has(k) ? ' checked' : ''}><b style="color:${c}">${t}</b><small>${d}</small></label>`).join('')}</div>
          <p class="ds-dim">Дать роль человеку: 👥 Участники → нажми на ник. Роли меняются в ⚙️ → «Роли».</p>`;
        const next = s === 0 ? 'Дальше →' : s === 1 ? 'Дальше →' : s === 2 ? '✅ Создать сервер' : s === 3 ? 'Дальше →' : '✅ Готово — открыть сервер';
        const back = s > 0 && s < 3 ? '<button type="button" class="ds-btn ghost" data-gx="back">← Назад</button>' : '';
        el.innerHTML = `<div class="ds-pane dsh-guide">${bar}<div class="dsh-step">${body}</div>
          <div class="ds-row dsh-nav">${back}<button type="button" class="ds-btn" data-gx="next"${G.busy ? ' disabled' : ''}>${G.busy ? 'Создаём…' : next}</button>${s === 4 ? '<button type="button" class="ds-btn ghost" data-gx="skip">Пропустить</button>' : ''}</div>
          <div class="ds-err"${G.err ? '' : ' hidden'}>${G.err ? '⚠️ ' + e(G.err) : ''}</div>
          ${s === 0 ? `<p class="ds-dim dsh-alt">Нужна вся форма сразу? <a href="${DS.special(mode, 'new')}">Обычное создание</a></p>` : ''}</div>`;
        const inp = el.querySelector('[data-g="name"]'); if (inp && !P.touch()) inp.focus();
      };
      const finish = () => { DS.dropC?.(G.id); go(mode, DS.link(mode, G.id)); };
      el.oninput = ev => { if (ev.target.dataset.g === 'name') G.name = ev.target.value; };
      el.onchange = ev => { const t = ev.target; if (t.dataset.g === 'pub') G.pub = t.checked; if (t.dataset.role) t.checked ? G.roles.add(t.dataset.role) : G.roles.delete(t.dataset.role); };
      el.onkeydown = ev => { if (ev.key === 'Enter' && ev.target.dataset.g === 'name') { ev.preventDefault(); el.querySelector('[data-gx="next"]')?.click(); } };
      el.onclick = async ev => {
        const ic = ev.target.closest('[data-ic]'); if (ic) { G.icon = ic.dataset.ic; el.querySelectorAll('[data-ic]').forEach(x => x.classList.toggle('on', x === ic)); return; }
        const tp = ev.target.closest('[data-tpl]'); if (tp) { G.tpl = tp.dataset.tpl; el.querySelectorAll('[data-tpl]').forEach(x => x.classList.toggle('on', x === tp)); return; }
        const b = ev.target.closest('[data-gx]'); if (!b || G.busy) return;
        const k = b.dataset.gx; G.err = '';
        if (k === 'back') { G.step--; draw(); return; }
        if (k === 'copy') { const u = el.querySelector('[data-g="url"]'); try { await navigator.clipboard.writeText(u.value); b.textContent = '✅ Скопировано'; } catch (er) { u.select(); } return; }
        if (k === 'skip') { finish(); return; }
        if (G.step === 0) { G.name = G.name.trim(); if (G.name.length < 2) { G.err = 'Название — от 2 букв'; draw(); return; } G.step = 1; draw(); return; }
        if (G.step === 1) { G.step = 2; draw(); return; }
        if (G.step === 2) {
          G.busy = true; draw();
          const r = await P.rpc('cm_create', { p_name: G.name, p_about: '', p_icon: G.icon, p_public: G.pub });
          if (!r.data?.ok) { G.busy = false; G.err = DS.why ? DS.why(r) : 'не получилось'; draw(); return; }
          G.id = r.data.id; G.code = r.data.code || '';
          for (const [n, kind] of TPL[G.tpl].ch) await P.rpc('cm_channel_save', { p_community: G.id, p_id: null, p_name: n, p_kind: kind, p_slow: 0, p_mods_only: false });
          await DS.loadMy?.(true);
          if (!G.code) { const s2 = await DS.server?.(G.id); G.code = s2?.raw?.c?.code || ''; }
          G.busy = false; G.step = 3; draw(); return;
        }
        if (G.step === 3) { G.step = 4; draw(); return; }
        if (G.step === 4) {
          G.busy = true; draw();
          let pos = 1, bad = '';
          for (const [k2, t, c, perms] of ROLES) if (G.roles.has(k2)) {
            const r = await P.rpc('cm_role_save', { p_community: G.id, p_id: null, p_name: t.replace(/^\S+\s/, ''), p_color: c, p_position: pos++, p_perms: perms });
            if (!r.data?.ok) bad = DS.why ? DS.why(r) : 'не получилось';
          }
          G.busy = false;
          if (bad) { G.err = 'Роли не создались: ' + bad + '. Их можно добавить потом в ⚙️ → «Роли».'; draw(); return; }
          finish();
        }
      };
      draw();
    },
  };
  X.newHref = mode => DS.special(mode, 'guide');   // «＋» в списке серверов — сразу в гайд

  // ── 4) подсказки у значков на телефоне: долгое нажатие → название кнопки ──
  let lpT = 0, lpEl = null, lpFired = false, tipEl = null;
  const tipHide = () => { if (tipEl) { tipEl.remove(); tipEl = null; } };
  const tipShow = b => {
    const t = b.getAttribute('title') || b.getAttribute('aria-label'); if (!t) return;
    tipHide();
    tipEl = document.createElement('div'); tipEl.className = 'dsh-tip'; tipEl.textContent = t; tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    const r = b.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8), y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    setTimeout(tipHide, 2200);
  };
  document.addEventListener('touchstart', ev => {
    const b = ev.target.closest?.('.ds .ds-hb, .ds .ds-srv, .ds [data-ds4], .ds .ds-vbar button, .ds .ppl-ib'); lpFired = false;
    clearTimeout(lpT); if (!b) return;
    lpEl = b; lpT = setTimeout(() => { lpFired = true; tipShow(b); try { navigator.vibrate?.(8); } catch (er) {} }, 450);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(t => document.addEventListener(t, () => clearTimeout(lpT), { passive: true }));
  // после долгого нажатия «щелчок» не срабатывает (человек хотел только узнать, что это за кнопка)
  document.addEventListener('click', ev => { if (lpFired && lpEl && lpEl.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); lpFired = false; } }, true);
  document.addEventListener('contextmenu', ev => { if (lpEl && ev.target.closest?.('.ds') && lpEl.contains(ev.target)) ev.preventDefault(); });

  // Esc закрывает открытую панель ленты (📌 закреплённые, 🔍 поиск…), даже если курсор не в её поле (раньше закрывалась только из поля)
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    const x = document.querySelector('.ds .mv-over:not([hidden]) [data-a="closeover"]');
    if (x && x.offsetParent) { x.click(); ev.stopPropagation(); }
  });

  H._test = { HELP, TPL, ROLES, STEPS, seen, tipShow };
})();
