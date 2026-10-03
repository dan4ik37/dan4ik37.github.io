// ═══════════════════════════════════════
//  ОХОТА ЗА СЕКРЕТАМИ — 7 спрятанных ✦ по сайту → радужный ник на 30 дней (+100 XP)
// ═══════════════════════════════════════
// Один файл и для SPA (index.html), и для серверных страниц (/videos, /topic/…):
// там нет входа, поэтому находки копятся в localStorage и уходят на сервер (secrets.sql →
// secret_found) при следующем заходе на сайт с аккаунтом. Фрагмент — любой элемент с
// data-secret="<код>"; коды те же, что в secret_codes() в secrets.sql.
// Где спрятаны: avatar — 5 кликов по аватарке на главной (easter-egg.js), footer — подвал
// главной, games — под рекордами в «Играх», archive — последняя страница /videos, horror —
// /topic/horror, levels — «Что даёт уровень» в профиле, words — итог слова дня в «5 букв».
// Радужный ник: nick_fx_users() → класс .nick-rainbow в чате и профиле (d37NickFx ниже).
(() => {
  const CODES = ['avatar', 'footer', 'games', 'archive', 'horror', 'levels', 'words'];
  const HINTS = {
    avatar:  'Постучи пять раз по аватарке на главной',
    footer:  'В самом низу главной — там, где сказано, о чём этот сайт',
    games:   'Под таблицей рекордов в «Играх»',
    archive: 'На самой последней странице «Всех видео» — там, где всё началось',
    horror:  'Среди хорроров канала (раздел «Игры канала»)',
    levels:  'Там, где написано, что даёт уровень',
    words:   'Угадай «Слово дня» в «5 букв» — и присмотрись к итогам',
  };
  const KEY = 'd37_secrets', SYNCED = 'd37_secrets_synced';
  const load = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const logged = () => typeof sbClient !== 'undefined' && !!sbClient && typeof currentUser !== 'undefined' && !!currentUser;
  let status = null;   // ответ secret_status() — для «радужный ник до …»

  function toast(text){
    let t = document.getElementById('d37SecretToast');
    if (!t) { t = document.createElement('div'); t.id = 'd37SecretToast'; document.body.appendChild(t); }
    t.textContent = text; t.className = 'show';
    clearTimeout(t._h); t._h = setTimeout(() => { t.className = ''; }, 3200);
  }

  function paint(){
    const found = load(KEY);
    document.querySelectorAll('[data-secret]').forEach(el => el.classList.toggle('found', found.includes(el.dataset.secret)));
    renderPanel();
  }

  async function sync(){
    if (!logged()) return;
    const found = load(KEY), synced = load(SYNCED);
    for (const c of found.filter(c => !synced.includes(c))) {
      const { data, error } = await sbClient.rpc('secret_found', { p_code: c });
      if (error || !data?.ok) return;           // secrets.sql ещё не выполнен — попробуем в другой раз
      synced.push(c); save(SYNCED, synced);
      if (data.just_done) {
        toast(`🌈 Все ${CODES.length} секретов найдены! Радужный ник — твой на 30 дней${data.xp ? `, +${data.xp} XP` : ''}`);
        window.d37NickFx?.reload();
      }
    }
    try { const { data } = await sbClient.rpc('secret_status'); if (data) status = data; } catch (e) {}
    renderPanel();
  }

  function find(code){
    if (!CODES.includes(code)) return;
    const f = load(KEY);
    if (f.includes(code)) { toast('✦ Этот секрет уже найден — ищи остальные'); return; }
    f.push(code); save(KEY, f);
    paint();
    if (typeof window.va === 'function') window.va('event', { name: 'secret_found', data: { code, n: f.length } });
    toast(f.length >= CODES.length
      ? (logged() ? '✦ Все секреты найдены! Забираем награду…' : '✦ Все секреты найдены! Войди на сайт — и радужный ник твой')
      : `✦ Секрет найден: ${f.length} из ${CODES.length}`);
    sync();
  }

  // Панель «Охота за секретами» (#secretHunt — в «Играх»)
  function renderPanel(){
    const box = document.getElementById('secretHunt');
    if (!box) return;
    const f = load(KEY);
    const until = status?.reward_until ? new Date(status.reward_until) : null;
    const active = until && until > new Date();
    box.hidden = false;
    box.innerHTML = `<span class="sh-ic">🕵️</span>
      <div class="sh-body">
        <b>Охота за секретами</b>
        <span>На сайте спрятано ${CODES.length} знаков <i class="sh-star">✦</i>. Найди все — и получишь <b class="nick-rainbow">радужный ник</b> на 30 дней.</span>
        <div class="sh-dots" aria-label="Найдено ${f.length} из ${CODES.length}">${CODES.map(c => `<i class="${f.includes(c) ? 'on' : ''}">✦</i>`).join('')}<small>${f.length} из ${CODES.length}</small></div>
        ${active ? `<small class="sh-done">🌈 Радужный ник активен до ${until.toLocaleDateString('ru-RU')}</small>`
          : f.length >= CODES.length && !logged() ? '<small class="sh-done">Все найдены! <a href="#" onclick="openGlobalAuth();return false">Войди</a>, чтобы забрать награду</small>' : ''}
        <details><summary>Подсказки</summary><ol>${CODES.map(c => `<li class="${f.includes(c) ? 'got' : ''}">${HINTS[c]}</li>`).join('')}</ol></details>
      </div>`;
  }

  document.addEventListener('click', e => {
    const el = e.target.closest?.('[data-secret]');
    if (!el || el.dataset.secretAuto) return;
    e.preventDefault(); e.stopPropagation();
    find(el.dataset.secret);
  }, true);
  window.addEventListener('d37:auth', () => { sync(); window.d37NickFx?.reload(); });
  window.addEventListener('hashchange', () => setTimeout(paint, 300));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
  setTimeout(sync, 2500);

  window.d37Secret = { find, sync, paint, codes: CODES };

  // ── Радужный ник: у кого сейчас награда (nick_fx_users) ──
  let fx = null, fxAt = 0, fxLoading = null;
  async function fxLoad(){
    if (typeof sbClient === 'undefined' || !sbClient) return new Set();
    if (fx && Date.now() - fxAt < 5 * 60e3) return fx;
    if (!fxLoading) fxLoading = sbClient.rpc('nick_fx_users').then(({ data, error }) => {
      fx = new Set(error ? [] : (data || []).map(r => typeof r === 'string' ? r : r.nick_fx_users)); fxAt = Date.now();
      fxLoading = null; return fx;
    }).catch(() => { fxLoading = null; return fx || new Set(); });
    return fxLoading;
  }
  // Сообщения чата: ник — .cu-nick внутри .chat-user, uid — у .lv-badge[data-lv-uid]
  async function mark(root){
    const s = await fxLoad();
    if (!s.size) return;
    (root || document).querySelectorAll('.chat-user').forEach(u => {
      const uid = u.querySelector('[data-lv-uid]')?.dataset.lvUid;
      u.querySelector('.cu-nick')?.classList.toggle('nick-rainbow', !!uid && s.has(uid));
    });
  }
  async function markEl(el, uid){ if (!el) return; const s = await fxLoad(); el.classList.toggle('nick-rainbow', !!uid && s.has(uid)); }
  window.d37NickFx = { mark, markEl, reload(){ fx = null; mark(); } };
})();
