// ═══════════════════════════════════════
//  ПРИЛОЖЕНИЯ ТЕЛЕФОНА 📱: Сообщения (ЛС — та же лента MsgView, что в чате), Друзья (кто где — «📍 К другу», позвать в
//  игру, позвонить), Камера (снимок 3D: сохранить / поделиться), Карта «Мира Денчика» (телепорт), Уведомления.
//  Настройки телефона — вкладка «📱 Телефон» в окне «⚙️ Настройки» (phone.js).
// ═══════════════════════════════════════
// ЛС — таблица direct_messages (friends-dm.sql): писать можно только другу (проверяет сервер). Новое ЛС приходит событием
// d37:dm (friends.js). Картинки в чаты не отправляются (детская аудитория): снимок — сохранить или поделиться самому.
(() => {
  const P = window.D37Phone, MV = window.MsgView;
  const e = s => esc(s);
  const SITE = 'https://dan4ik37.vercel.app';
  const rid = n => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (const x of crypto.getRandomValues(new Uint8Array(n))) s += a[x % a.length]; return s; };

  // ═══ Сообщения ═══
  const dmMsg = r => ({ id: r.id, uid: r.sender_id, nick: P.prof(r.sender_id)?.nick || (r.sender_id === P.me() ? P.myNick() : 'друг'), text: r.text || '', at: r.created_at, read: r.read_at, mine: r.sender_id === P.me() });
  async function markRead(uid){
    const me = P.me(); if (!me) return;
    await sbClient.from('direct_messages').update({ read_at: new Date().toISOString() }).eq('sender_id', uid).eq('recipient_id', me).is('read_at', null);
    if (typeof updateDmUnreadBadge === 'function') updateDmUnreadBadge();
  }
  // Безопасность детей (js/core/age.js): ребёнку — кому нельзя лично ('age'), до 9 — никому ('u9'); остальным решает сервер
  const kidBlock = async uid => (window.D37Age?.contact ? window.D37Age.contact(uid).catch(() => null) : null);
  const kidMsg = k => window.D37Age?.kidMsg?.(k) || '🚫 Нельзя написать этому игроку';
  // Отказ сервера на ЛС / вызов / приглашение: свой текст сервера (ребёнку, до 9) — как есть; общий отказ прав — «нельзя»
  const dmErr = (error, kind = 'no') => /row-level|42501/i.test(error?.message || '') || error?.code === '42501' ? kidMsg(kind) : P.err(error);
  function dmAdapter(uid, nick, block){
    const me = P.me();
    return {
      key: 'dm:' + uid, title: nick, maxLen: 1000, placeholder: `Написать ${nick}…`,
      startText: `Это начало переписки с ${nick}. Писать можно только друзьям. Не отправляй адрес, телефон и пароли — даже друзьям.`,
      emptyText: 'Напиши первым! 👋',
      caps: { reply: false, edit: false, del: false, react: false, pin: false, report: false, typing: false, search: true, stickers: false },
      async load({ before }){
        await P.profiles([uid, me]);
        let qy = sbClient.from('direct_messages').select('*').or(`and(sender_id.eq.${me},recipient_id.eq.${uid}),and(sender_id.eq.${uid},recipient_id.eq.${me})`).order('id', { ascending: false }).limit(50);
        if (before) qy = qy.lt('id', before);
        const { data, error } = await qy;
        if (error) return { list: [], err: error, errText: P.err(error) };
        markRead(uid);
        return { list: (data || []).map(dmMsg).reverse(), more: (data || []).length === 50 };
      },
      sub(fn){
        const h = ev => { const m = ev.detail; if (m?.sender_id === uid) { fn({ t: 'ins', m: dmMsg(m) }); if (!document.hidden) markRead(uid); } };
        window.addEventListener('d37:dm', h);
        return () => window.removeEventListener('d37:dm', h);
      },
      async send(text){
        if (window.MsgView?.blocked?.has(uid)) return { ok: false, err: 'ты заблокировал(а) этого человека' };
        if (block) return { ok: false, err: kidMsg(block) };
        const { data, error } = await sbClient.from('direct_messages').insert([{ sender_id: me, recipient_id: uid, text }]).select().single();
        if (error) return { ok: false, err: /row-level|42501/i.test(error.message || '') ? '🚫 Нельзя написать этому игроку (писать можно только друзьям)' : P.err(error) };
        return { ok: true, m: dmMsg(data) };
      },
      async fetch(){ return []; },
      async search(q){
        const s = q.replace(/[%_,()]/g, ' ').trim(); if (!s) return [];
        const { data } = await sbClient.from('direct_messages').select('*').or(`and(sender_id.eq.${me},recipient_id.eq.${uid}),and(sender_id.eq.${uid},recipient_id.eq.${me})`).ilike('text', `%${s}%`).order('id', { ascending: false }).limit(40);
        return (data || []).map(dmMsg);
      },
      state: () => (!P.me() ? { mode: 'login', note: 'Войди, чтобы писать друзьям' } : block ? { mode: 'readonly', note: kidMsg(block) } : { mode: 'write' }),
      me: () => ({ uid: me, nick: P.myNick() }),
    };
  }
  P.define('msgs', {
    render(el, arg){
      if (!P.me()) { el.innerHTML = P.head('💬 Сообщения') + '<div class="ph-body"></div>'; P.login(el.querySelector('.ph-body'), 'Личные сообщения — друзьям. Нужен аккаунт.'); return; }
      if (arg && /^[0-9a-f-]{36}$/.test(arg)) return openChat(el, arg);
      el.innerHTML = P.head('💬 Сообщения', '<button type="button" class="ph-hbtn" data-k="new" title="Новое сообщение">✏️</button>') + '<div class="ph-body"><div class="ph-load"><i></i>Загружаем…</div></div>';
      const b = el.querySelector('.ph-body');
      el.querySelector('[data-k="new"]').onclick = () => pickFriend('✏️ Кому написать?', id => P.go('msgs/' + id));
      (async () => {
        const me = P.me();
        const { data } = await sbClient.from('direct_messages').select('*').or(`sender_id.eq.${me},recipient_id.eq.${me}`).order('id', { ascending: false }).limit(300);
        const conv = new Map();
        for (const m of data || []) {
          const other = m.sender_id === me ? m.recipient_id : m.sender_id;
          if (!conv.has(other)) conv.set(other, { uid: other, last: m, unread: 0 });
          if (m.recipient_id === me && !m.read_at) conv.get(other).unread++;
        }
        await P.profiles([...conv.keys()]);
        const st = await P.friendStatus([...conv.keys()]);
        b.innerHTML = conv.size ? `<div class="ph-list">${[...conv.values()].map(c => { const p = P.prof(c.uid) || {}, call = P.callCode(c.last.text);
          const prev = e(call ? (/Зову/.test(c.last.text) ? '🎧 Зовёт в голосовой' : '📞 Звонок') : P.clean(c.last.text).replace(/https?:\/\/\S+/g, '🔗').slice(0, 80));
          return `<button type="button" class="ph-item" data-u="${e(c.uid)}">${P.avatar(p, p.nick, 44)}${st.has(c.uid) ? '<i class="ph-dot"></i>' : ''}<span><b>${e(p.nick || 'игрок')}</b><small>${c.last.sender_id === me ? 'Ты: ' : ''}${prev}</small></span><time>${e(P.when(c.last.created_at))}</time>${c.unread ? `<em class="ph-un">${c.unread}</em>` : ''}</button>`; }).join('')}</div>`
          : '<div class="ph-empty"><b>Пока пусто</b><span>Напиши другу — кнопка ✏️ вверху. Друзей можно найти в чате, в мире или по нику («Друзья»).</span></div>';
        b.addEventListener('click', ev => { const x = ev.target.closest('[data-u]'); if (x) P.go('msgs/' + x.dataset.u); });
      })();
    },
  });
  function openChat(el, uid){
    const p = P.prof(uid);
    el.innerHTML = P.head(`<span class="ph-chathead">${P.avatar(p, p?.nick, 26)} ${e(p?.nick || 'друг')}</span>`, `<button type="button" class="ph-hbtn" data-k="call" title="Позвонить">📞</button><button type="button" class="ph-hbtn" data-k="game" title="Позвать в игру">🎮</button><a class="ph-hbtn" href="#/profile/${e(uid)}" title="Профиль" style="display:inline-grid;place-items:center;text-decoration:none">👤</a>`) + '<div class="ph-body ph-mvhost"><div class="ds-mv"></div></div>';
    const view = MV.mount(el.querySelector('.ds-mv'), { compact: true });
    let block = null;
    Promise.all([P.profiles([uid]), kidBlock(uid)]).then(([r, b]) => {
      const pp = r[uid]; const h = el.querySelector('.ph-chathead'); if (pp && h) h.innerHTML = `${P.avatar(pp, pp.nick, 26)} ${e(pp.nick)}`;
      block = b;
      // ребёнку со взрослым / до 9: переписку видно, но писать, звонить и звать нельзя
      if (b) el.querySelectorAll('[data-k="call"],[data-k="game"]').forEach(x => { x.classList.add('ph-off'); x.title = kidMsg(b); });
      view.setAdapter(dmAdapter(uid, pp?.nick || 'друг', b));
    });
    el.querySelector('[data-k="call"]').onclick = async () => { if (block) { P.toast(kidMsg(block), false); return; } await P.need('calls'); window.D37Calls.call(uid, P.prof(uid)?.nick || 'друг'); };
    el.querySelector('[data-k="game"]').onclick = () => { if (block) { P.toast(kidMsg(block), false); return; } gameInvite(uid); };
    return () => view.destroy();
  }

  // ═══ Позвать в игру: комната с кодом → ЛС со ссылкой (у друга — карточка «Войти») → сам туда ═══
  const QUICK = ['world', 'chess', 'durak', 'uno', 'checkers', 'pool', 'nardy', 'ludo', 'arena', 'horde', 'td', 'sea', 'ttt'];
  const COOP = new Set(['horde', 'td']);
  async function gameInvite(uid){
    const b = await kidBlock(uid);
    if (b) { P.toast(kidMsg(b), false); return; }
    const games = QUICK.map(id => typeof GAMES !== 'undefined' && GAMES.find(g => g.id === id)).filter(Boolean);
    P.sheet(`<b>🎮 Во что позвать?</b><div class="ph-chips">${games.map(g => `<button type="button" class="ph-chip" data-s="${g.id}">${g.icon} ${e(g.title)}${COOP.has(g.id) ? ' (вместе)' : ''}</button>`).join('')}</div><small class="ph-dim">Другу придёт сообщение с кнопкой «Войти», а ты сразу окажешься в комнате.</small>`,
      async gid => {
        P.closeSheet();
        const g = GAMES.find(x => x.id === gid);
        let text, go;
        if (gid === 'world') {
          const a = P.activity(), shard = a.w || 1;
          text = `🌍 Заходи ко мне в «Мир Денчика»${a.w ? `, я на сервере ${shard}` : ''}! ${window.D37Route ? D37Route.abs('#/games/world', SITE) : SITE + '/#/games/world'}`;
          go = a.w ? null : '#/games/world';
        } else {
          const code = window.GameRoom?.newCode?.() || rid(6);
          const path = `#/games/${gid}/${COOP.has(gid) ? 'coop/' : ''}${code}`;
          text = `🎮 Зову в «${g.title}»! ${SITE}/${path}`;
          go = path;
        }
        const { error } = await sbClient.from('direct_messages').insert([{ sender_id: P.me(), recipient_id: uid, text }]);
        if (error) { P.toast(dmErr(error, 'noinv'), false); return; }
        P.toast('📨 Позвал(а)!', true);
        if (go) setTimeout(() => { if (!P.isDocked()) P.close(); location.hash = go; }, 500);
      });
  }
  async function pickFriend(title, cb){
    const f = await P.friends(true);
    if (!f.list.length) { P.toast('Сначала добавь друзей — «Друзья» → поиск по нику', false); return; }
    const st = await P.friendStatus(f.list);
    P.sheet(`<b>${title}</b><div class="ph-list">${f.list.map(id => { const p = P.prof(id) || {}; return `<button type="button" class="ph-item" data-s="${e(id)}">${P.avatar(p, p.nick, 34)}<span><b>${e(p.nick || 'друг')}</b><small>${st.has(id) ? e(P.actText(st.get(id).a)) : 'не в сети'}</small></span></button>`; }).join('')}</div>`,
      id => { P.closeSheet(); cb(id); });
  }
  P.pickFriend = pickFriend;
  P.gameInvite = gameInvite;

  // ═══ Друзья: кто где (из «кто онлайн» сайта и — с community.sql — friends_online), «📍 К другу», заявки, поиск по нику ═══
  P.define('friends', {
    render(el){
      el.innerHTML = P.head('🤝 Друзья', '<button type="button" class="ph-hbtn" data-k="find" title="Найти по нику">🔍</button>') + '<div class="ph-body"><div class="ph-load"><i></i>Загружаем…</div></div>';
      const b = el.querySelector('.ph-body');
      if (!P.me()) { P.login(b, 'Друзья, звонки и «📍 К другу» — для вошедших.'); return; }
      let alive = true, drawn = false;
      const draw = async () => {
        const f = await P.friends(!drawn); drawn = true;
        const st = await P.friendStatus(f.list);
        const kb = window.D37Age?.contacts ? await window.D37Age.contacts(f.list).catch(() => new Map()) : new Map();   // ребёнку / до 9: с кем нельзя лично
        if (!alive) return;
        const on = f.list.filter(id => st.has(id)), off = f.list.filter(id => !st.has(id));
        const row = id => {
          const p = P.prof(id) || {}, s = st.get(id), k = kb.get(id), j = s && k !== 'age' ? P.actJoin(s.a) : null, x = k ? ` ph-off" title="${e(kidMsg(k))}` : '';
          return `<div class="ph-item">${P.avatar(p, p.nick, 42)}${s ? '<i class="ph-dot"></i>' : ''}<span><b>${e(p.nick || 'друг')}</b><small>${s ? e(P.actText(s.a)) : 'не в сети'}</small>${k === 'age' ? '<small class="ph-kid">🔒 Только дружба: писать и звонить нельзя</small>' : ''}${j ? `<button type="button" class="ph-chip" data-j="${e(id)}" style="margin-top:5px;align-self:flex-start">${e(j.label)}</button>` : ''}</span>
            <span class="ph-ibtns"><button type="button" class="ph-ib${x}" data-dm="${e(id)}" aria-label="Написать">✉</button><button type="button" class="ph-ib${x}" data-game="${e(id)}" aria-label="Позвать в игру">🎮</button><button type="button" class="ph-ib call${x}" data-call="${e(id)}" aria-label="Позвонить">📞</button></span></div>`;
        };
        b.innerHTML = `${f.incoming.length ? `<div class="ph-sec">Заявки в друзья — ${f.incoming.length}</div>${f.incoming.map(id => { const p = P.prof(id) || {}; return `<div class="ph-item">${P.avatar(p, p.nick, 40)}<span><b>${e(p.nick || 'игрок')}</b><small>хочет дружить</small></span><span class="ph-ibtns"><button type="button" class="ph-ib call" data-acc="${e(id)}" aria-label="Принять">✓</button><button type="button" class="ph-ib" data-dec="${e(id)}" aria-label="Отклонить">✕</button></span></div>`; }).join('')}` : ''}
          ${on.length ? `<div class="ph-sec">В сети — ${on.length}</div>${on.map(row).join('')}` : ''}
          ${off.length ? `<div class="ph-sec">Не в сети — ${off.length}</div>${off.map(row).join('')}` : ''}
          ${!f.list.length && !f.incoming.length ? '<div class="ph-empty"><b>Пока нет друзей</b><span>Нажми 🔍 и найди по нику, или зови в друзья из чата и мира (нажми на ник).</span></div>' : ''}
          <small class="ph-dim" style="display:block;margin-top:12px">Кто где — видно у друзей, чей профиль открыт всем. Невидимки и «только я» — не видны.</small>`;
      };
      b.addEventListener('click', async ev => {
        const x = ev.target.closest('[data-j],[data-dm],[data-game],[data-call],[data-acc],[data-dec]'); if (!x) return;
        if (x.dataset.j) { const st = await P.friendStatus([x.dataset.j]); const s = st.get(x.dataset.j); if (s) P.goJoin(x.dataset.j, s.a); }
        else if (x.dataset.dm) P.go('msgs/' + x.dataset.dm);
        else if (x.dataset.game) gameInvite(x.dataset.game);
        else if (x.dataset.call) { const b = await kidBlock(x.dataset.call); if (b) { P.toast(kidMsg(b), false); return; } await P.need('calls'); window.D37Calls.call(x.dataset.call, P.prof(x.dataset.call)?.nick || 'друг'); }
        else if (x.dataset.acc) { if (typeof acceptFriendRequest === 'function') await acceptFriendRequest(x.dataset.acc); P.dropFriends(); draw(); }
        else if (x.dataset.dec) { await sbClient.from('friendships').delete().eq('requester_id', x.dataset.dec).eq('addressee_id', P.me()); P.dropFriends(); draw(); }
      });
      el.querySelector('[data-k="find"]').onclick = () => {
        const s = P.sheet(`<b>🔍 Найти по нику</b><input type="search" class="ds-in" placeholder="Ник…" aria-label="Ник"><div class="ph-list" style="margin-top:8px"></div>`, async (k, btn) => {
          if (typeof sendFriendRequest === 'function') { btn.disabled = true; await sendFriendRequest(k); btn.textContent = '⏳'; }
        });
        const inp = s.querySelector('input'), list = s.querySelector('.ph-list'); let t = 0;
        inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
          const q = inp.value.trim().replace(/[%_,()]/g, ''); if (q.length < 2) { list.innerHTML = ''; return; }
          const { data } = await sbClient.from('profiles').select('id, nick, role, avatar_url, is_vip, vip_until').ilike('nick', `${q}%`).limit(8);
          list.innerHTML = (data || []).filter(p => p.id !== P.me()).map(p => `<div class="ph-item">${P.avatar(p, p.nick, 34)}<span><b>${P.nick(p)}</b></span><button type="button" class="ph-btn ghost" data-s="${e(p.id)}">➕ В друзья</button></div>`).join('') || '<div class="ph-dim">Никого</div>';
        }, 300); });
      };
      draw();
      const t = setInterval(() => { if (alive && !P.sheetOpen()) draw(); }, 20000);
      return () => { alive = false; clearInterval(t); };
    },
  });

  // ═══ Камера: снимок 3D — сохранить / поделиться (своим приложением) / позвать друга сюда ═══
  const shots = [];
  P.define('camera', {
    render(el){
      const h = P.ctx();
      el.innerHTML = P.head('📷 Камера') + '<div class="ph-body"></div>';
      const b = el.querySelector('.ph-body');
      if (!h?.shot) {
        b.innerHTML = `<div class="ph-empty"><b>📷 Камера работает в 3D</b><span>Открой «Мир Денчика» или свой мир в «Студии 3D» — и делай снимки.</span><a class="ph-btn" href="#/games/world">🌍 В Мир Денчика</a></div>${galleryHtml()}`;
        return;
      }
      const draw = () => {
        const last = shots[0];
        b.innerHTML = `<div class="ph-cam">${last ? `<img src="${last.url}" alt="Снимок">` : '<div class="ph-dim" style="text-align:center;padding:20px">Наведи камеру в игре и нажми кнопку</div>'}
          <button type="button" class="ph-shutter" data-k="shot" aria-label="Сделать снимок"></button>
          ${last ? `<div class="ph-row"><a class="ph-btn" href="${last.url}" download="dan4ik37-${last.t}.jpg">💾 Сохранить</a>${navigator.canShare ? '<button type="button" class="ph-btn ghost" data-k="share">📤 Поделиться</button>' : ''}<button type="button" class="ph-btn ghost" data-k="invite">📍 Позвать друга сюда</button></div>
          <small class="ph-dim">В чаты сайта картинки не отправляются — так безопаснее. Сохрани снимок и отправь куда хочешь сам.</small>` : ''}
          ${galleryHtml(1)}</div>`;
      };
      b.addEventListener('click', async ev => {
        const k = ev.target.closest('[data-k]')?.dataset.k;
        if (k === 'shot') {
          const url = await shoot(h); if (!url) { P.toast('Не получилось снять', false); return; }
          shots.unshift({ url, t: new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') }); if (shots.length > 9) shots.pop();
          P.tone([[2200, .03], [1400, .05]], .5); draw();
        } else if (k === 'share') {
          try { const blob = await (await fetch(shots[0].url)).blob(); const f = new File([blob], 'dan4ik37.jpg', { type: 'image/jpeg' }); if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: 'Снимок из «Мира Денчика»', text: SITE + '/play/world' }); } catch (er) {}
        } else if (k === 'invite') {
          if (!P.me()) { P.toast('Войди, чтобы звать друзей', false); return; }
          pickFriend('📍 Кого позвать сюда?', async id => {
            const a = P.activity(), where = h.placeName?.() || '';
            const text = a.j ? `📍 Иди ко мне! ${window.D37Route ? D37Route.abs('#/' + a.j, SITE) : SITE + '/#/' + a.j}` : `📍 Иди ко мне в «Мир Денчика»${a.w ? `, сервер ${a.w}` : ''}${where ? ` — я ${where}` : ''}! ${window.D37Route ? D37Route.abs('#/games/world', SITE) : SITE + '/#/games/world'}`;
            const b = await kidBlock(id); if (b) { P.toast(kidMsg(b), false); return; }
            const { error } = await sbClient.from('direct_messages').insert([{ sender_id: P.me(), recipient_id: id, text }]);
            P.toast(error ? dmErr(error, 'noinv') : '📨 Позвал(а)!', !error);
          });
        }
        const g = ev.target.closest('[data-g]'); if (g) { const s = shots.splice(+g.dataset.g, 1)[0]; shots.unshift(s); draw(); }
      });
      draw();
    },
  });
  async function shoot(h){
    const wasOpen = P.isOpen();
    try { return await h.shot(); } catch (er) { return null; } finally { if (!wasOpen) P.close(); }
  }
  // (объявление функцией: P.define выше может сразу нарисовать камеру — открыта первой, пока файл грузился)
  function galleryHtml(from){ return shots.length > (from || 0) ? `<div class="ph-sec">Снимки этой игры</div><div class="ph-gal">${shots.slice(from || 0).map((s, i) => `<img src="${s.url}" alt="Снимок" data-g="${i + (from || 0)}">`).join('')}</div>` : ''; }

  // ═══ Карта «Мира Денчика»: где что, где ты и друзья; нажми место — телепорт ═══
  // Схема — по mir.js (buildWorld): поменялись здания — поправь здесь
  const W = { x0: -84, x1: 84, z0: -70, z1: 92 };
  const PTS = [
    ['⛲', 'Площадь', 0, 11, 0, 0], ['☕', 'Кафе «У Денчика»', 0, -25, 0, -36], ['🕹️', 'Игровой клуб', 25, -1, 36, -2], ['🎤', 'Сцена', -31, -1, -38, -1],
    ['🎭', 'Гардероб', -16, 18, -22, 24], ['🏠', 'Улица с домиками', 0, 40, 0, 60], ['🌳', 'Парк и пруд', 24, 27, 32, 34], ['🔥', 'Костёр', 37, 46, 40, 50],
    ['🧟', 'Ворота «Орда»', 43, 24, 47, 24], ['🔫', 'Ворота «Арена»', 43, 40, 47, 40], ['🏰', 'Ворота «Башни»', 30, 47, 30, 52], ['🏘️', 'Район участков', -12.5, -36, -12.5, -46],
  ];
  const BLD = [['Кафе', 0, -36, 22, 14, '#9a3412'], ['Клуб', 36, -2, 16, 20, '#4c1d95'], ['Гардероб', -22, 24, 9, 8, '#db2777'], ['Сцена', -38, -1, 7, 13, '#3b2a5a'],
    ['', -12, 30, 9, 9, '#b91c1c'], ['', 12, 30, 9, 9, '#1d4ed8'], ['', -12.5, 52, 10, 11, '#15803d'], ['', 12, 52, 9, 9, '#7e22ce']];
  // Мир с зонами (js/games/mir-zones.js → MirMap): тот же рисунок, что окно «🗺️ Карта» (M) в мире — лобби, Солнечный городок,
  // Большой город, Боевая зона, метки возраста; «Весь мир» / «Центр». Возраст зоны проверяет сам мир (h.tp → ворота).
  const CENTER = { x0: -84, x1: 84, z0: -70, z1: 92 };
  let mapZoom = 'all';
  function mapZones(el, h, inWorld, MM){
    const pts = MM.points(), age = p => (p.age ? `<b class="ph-age a${p.age}">${p.age}+</b>` : '');
    const grp = [['Лобби и старый мир', p => !p.zone], ...MM.ZLIST.map(Z => [`${Z.icon} ${Z.name}${Z.age ? ' · ' + Z.age + '+' : ''}`, p => p.zone === Z.id])];
    el.innerHTML = P.head('🗺️ Карта мира') + `<div class="ph-body"><div class="ph-mapv" role="radiogroup">${[['all', '🌍 Весь мир'], ['center', '⛲ Центр']].map(([v, t]) => `<button type="button" role="radio" aria-checked="${mapZoom === v}" class="ph-chip${mapZoom === v ? ' on' : ''}" data-z="${v}">${t}</button>`).join('')}</div>
      <div class="ph-map"><canvas width="640" height="620" aria-label="Карта Мира Денчика"></canvas></div>
      ${inWorld ? '' : '<div class="ph-row" style="margin:10px 0"><a class="ph-btn" href="#/games/world">🌍 Открыть Мир Денчика</a></div><small class="ph-dim">Телепорт работает в мире.</small>'}
      ${grp.map(([t, f]) => { const L = pts.filter(f); return L.length ? `<div class="ph-sec">${e(t)}</div><div class="ph-pts">${L.map(p => `<button type="button" class="ph-pt" data-p="${e(p.id)}"${inWorld ? '' : ' disabled'}><i>${p.icon}</i><span>${e(p.name)}</span>${age(p)}</button>`).join('')}</div>` : ''; }).join('')}</div>`;
    const cv = el.querySelector('canvas'), g = cv.getContext('2d');
    let view = null;
    const draw = () => {
      const o = { points: pts };
      if (inWorld) { o.players = (h.players?.() || []).map(p => ({ x: p.x, z: p.z, friend: p.friend })); o.me = h.where?.() || null; }
      view = MM.draw(g, cv.width, cv.height, mapZoom === 'center' ? CENTER : null, o);
    };
    draw();
    const t = inWorld ? setInterval(draw, 700) : 0;
    const tp = id => {
      const p = pts.find(x => x.id === id); if (!p || !inWorld) return;
      h.tp(p.x, p.z, p.yaw);
      P.toast(`${p.icon} ${p.name}`, true); P.tone([[880, .06], [1320, .1]], .5);
      setTimeout(() => P.close(), 350);
    };
    el.querySelector('.ph-mapv').addEventListener('click', ev => { const b = ev.target.closest('[data-z]'); if (!b || b.dataset.z === mapZoom) return; mapZoom = b.dataset.z; el.querySelectorAll('.ph-mapv [data-z]').forEach(x => { const on = x.dataset.z === mapZoom; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); }); draw(); });
    el.querySelector('.ph-body').addEventListener('click', ev => { const b = ev.target.closest('[data-p]'); if (b) tp(b.dataset.p); });
    cv.addEventListener('click', ev => {
      if (!inWorld || !view) return;
      const r = cv.getBoundingClientRect(), [x, z] = view.inv((ev.clientX - r.left) / r.width * cv.width, (ev.clientY - r.top) / r.height * cv.height);
      let best = null, bd = 26 / Math.max(.2, view.sc) + 4;
      for (const p of pts) { const d = Math.hypot(p.lx - x, p.lz - z); if (d < bd) { bd = d; best = p; } }
      if (best) tp(best.id);
    });
    return () => clearInterval(t);
  }
  P.define('map', {
    render(el){
      const h = P.ctx(), inWorld = P.ctxName() === 'world' && h?.tp;
      if (window.MirMap?.draw) return mapZones(el, h, inWorld, window.MirMap);
      el.innerHTML = P.head('🗺️ Карта мира') + `<div class="ph-body"><div class="ph-map"><canvas width="640" height="620" aria-label="Карта Мира Денчика"></canvas></div>
        ${inWorld ? '<div class="ph-sec">Телепорт</div>' : '<div class="ph-row" style="margin:10px 0"><a class="ph-btn" href="#/games/world">🌍 Открыть Мир Денчика</a></div><small class="ph-dim">Телепорт работает в мире.</small>'}
        <div class="ph-pts">${PTS.map((p, i) => `<button type="button" class="ph-pt" data-p="${i}"${inWorld ? '' : ' disabled'}><i>${p[0]}</i>${e(p[1])}</button>`).join('')}</div></div>`;
      const cv = el.querySelector('canvas'), g = cv.getContext('2d');
      const sx = x => (x - W.x0) / (W.x1 - W.x0) * cv.width, sz = z => (z - W.z0) / (W.z1 - W.z0) * cv.height;
      const draw = () => {
        g.fillStyle = '#3f8f3a'; g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = '#5aa84a'; for (let i = 0; i < 40; i++) { g.globalAlpha = .25; g.beginPath(); g.arc((i * 97) % cv.width, (i * 61) % cv.height, 20 + (i % 5) * 6, 0, 7); g.fill(); } g.globalAlpha = 1;
        g.fillStyle = 'rgba(147,207,124,.55)'; g.fillRect(sx(-81), sz(-66), sx(-10) - sx(-81), sz(-12) - sz(-66));   // район участков
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([6, 5]); g.strokeRect(sx(-81), sz(-66), sx(-10) - sx(-81), sz(-12) - sz(-66)); g.setLineDash([]);
        g.fillStyle = '#e8dcc0'; for (const [x1, z1, x2, z2, w] of [[0, -17, 0, -29, 4.2], [17, -1, 28, -1, 4.2], [-17, -1, -27, -1, 4.2], [-12, 12, -19, 19, 3], [13, 12, 28, 28, 3.4], [-11.5, -13.5, -12.5, -38, 3]]) { g.strokeStyle = '#e8dcc0'; g.lineWidth = w * cv.width / (W.x1 - W.x0); g.beginPath(); g.moveTo(sx(x1), sz(z1)); g.lineTo(sx(x2), sz(z2)); g.stroke(); }
        g.fillStyle = '#5b6270'; g.fillRect(sx(-3.5), sz(17), sx(3.5) - sx(-3.5), sz(75) - sz(17));                 // улица
        g.fillStyle = '#ece2cb'; g.beginPath(); g.arc(sx(0), sz(0), 18 * cv.width / (W.x1 - W.x0), 0, 7); g.fill();   // площадь
        g.fillStyle = '#5ec8f2'; g.beginPath(); g.arc(sx(0), sz(0), 3.3 * cv.width / (W.x1 - W.x0), 0, 7); g.fill();
        g.fillStyle = '#3aa6dc'; g.beginPath(); g.arc(sx(32), sz(34), 6.6 * cv.width / (W.x1 - W.x0), 0, 7); g.fill();  // пруд
        g.font = '800 15px Montserrat, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const [n, x, z, w, d, c] of BLD) { g.fillStyle = c; g.fillRect(sx(x - w / 2), sz(z - d / 2), sx(x + w / 2) - sx(x - w / 2), sz(z + d / 2) - sz(z - d / 2)); if (n) { g.fillStyle = '#fff'; g.fillText(n, sx(x), sz(z)); } }
        g.font = '22px sans-serif';
        for (const p of PTS) g.fillText(p[0], sx(p[4]), sz(p[5]) + (p[1].startsWith('Ворота') ? 0 : -2));
        if (inWorld) {
          for (const pl of h.players?.() || []) { g.fillStyle = pl.friend ? '#4ade80' : '#e2e8f0'; g.beginPath(); g.arc(sx(pl.x), sz(pl.z), 6, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); }
          const me = h.where?.();
          if (me) { g.save(); g.translate(sx(me.x), sz(me.z)); g.rotate(-me.yaw + Math.PI); g.fillStyle = '#facc15'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore(); }
        }
      };
      draw();
      const t = inWorld ? setInterval(draw, 700) : 0;
      const tp = i => {
        const p = PTS[i]; if (!p || !inWorld) return;
        h.tp(p[2], p[3], Math.atan2(p[4] - p[2], p[5] - p[3]));
        P.toast(`${p[0]} ${p[1]}`, true); P.tone([[880, .06], [1320, .1]], .5);
        setTimeout(() => P.close(), 350);
      };
      el.querySelector('.ph-pts').addEventListener('click', ev => { const b = ev.target.closest('[data-p]'); if (b) tp(+b.dataset.p); });
      cv.addEventListener('click', ev => {
        if (!inWorld) return;
        const r = cv.getBoundingClientRect(), x = W.x0 + (ev.clientX - r.left) / r.width * (W.x1 - W.x0), z = W.z0 + (ev.clientY - r.top) / r.height * (W.z1 - W.z0);
        let best = -1, bd = 14; PTS.forEach((p, i) => { const d = Math.hypot(p[4] - x, p[5] - z); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) tp(best);
      });
      return () => clearInterval(t);
    },
  });

  // ═══ «Птичка» — мини-игра в телефоне: нажимай — взлетает, не задевай трубы. В мире персонаж держит телефон боком
  //     двумя руками и «играет» (phone.js → hand 'play'). Рекорд — в браузере (d37_ph_bird), без наград ═══
  P.define('game', {
    render(el){
      el.innerHTML = P.head('🐤 Птичка', '<b class="ph-gbest"></b>') + '<div class="ph-body ph-game"><canvas width="320" height="440" aria-label="Мини-игра «Птичка»: нажимай, чтобы взлететь"></canvas><small class="ph-dim">Нажимай на экран (или Пробел) — птичка взлетает. Не задевай трубы!</small></div>';
      const cv = el.querySelector('canvas'), g = cv.getContext('2d'), W = 320, H = 440, GROUND = 400, GAP = 128, R = 13;
      let best = 0; try { best = +localStorage.getItem('d37_ph_bird') || 0; } catch (e) {}
      const bestEl = el.querySelector('.ph-gbest'), showBest = () => { bestEl.textContent = best ? `🏆 ${best}` : ''; };
      showBest();
      let s = null, raf = 0, last = 0, alive = true;
      const reset = () => { s = { y: H * .42, vy: 0, pipes: [], next: 1.1, score: 0, mode: 'ready', t: 0 }; };
      reset();
      const flap = () => {
        if (s.mode === 'over') { if (s.t > .5) reset(); return; }
        s.mode = 'play'; s.vy = -330; P.sfx('tap');
      };
      const hit = (p) => 90 + R > p.x && 90 - R < p.x + 52 && (s.y - R < p.gy || s.y + R > p.gy + GAP);
      function step(dt){
        s.t += dt;
        if (s.mode === 'ready') { s.y = H * .42 + Math.sin(s.t * 4) * 6; return; }
        if (s.mode === 'over') { if (s.y < GROUND - R) { s.vy += 1300 * dt; s.y = Math.min(GROUND - R, s.y + s.vy * dt); } return; }
        s.vy += 1100 * dt; s.y += s.vy * dt;
        if ((s.next -= dt) <= 0) { s.next = 1.45; s.pipes.push({ x: W + 10, gy: 70 + Math.random() * (GROUND - GAP - 130), got: false }); }
        for (const p of s.pipes) { p.x -= 120 * dt; if (!p.got && p.x + 52 < 90) { p.got = true; s.score++; P.tone([[1320, .05]], .35); } }
        s.pipes = s.pipes.filter(p => p.x > -60);
        if (s.y + R >= GROUND || s.y < -40 || s.pipes.some(hit)) {
          s.mode = 'over'; s.t = 0; P.tone([[300, .12], [220, .18]], .5);
          if (s.score > best) { best = s.score; try { localStorage.setItem('d37_ph_bird', String(best)); } catch (e) {} showBest(); }
        }
      }
      function draw(){
        const sky = g.createLinearGradient(0, 0, 0, GROUND); sky.addColorStop(0, '#38bdf8'); sky.addColorStop(1, '#bae6fd');
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(255,255,255,.85)'; for (const [x, y, r] of [[60, 70, 18], [82, 66, 14], [230, 110, 16], [250, 106, 12]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
        for (const p of s.pipes) {
          g.fillStyle = '#16a34a'; g.fillRect(p.x, 0, 52, p.gy); g.fillRect(p.x, p.gy + GAP, 52, GROUND - p.gy - GAP);
          g.fillStyle = '#15803d'; g.fillRect(p.x - 4, p.gy - 16, 60, 16); g.fillRect(p.x - 4, p.gy + GAP, 60, 16);
        }
        g.fillStyle = '#65a30d'; g.fillRect(0, GROUND, W, 12); g.fillStyle = '#a16207'; g.fillRect(0, GROUND + 12, W, H - GROUND - 12);
        // птичка: наклон по скорости
        g.save(); g.translate(90, s.y); g.rotate(Math.max(-.5, Math.min(1.1, s.vy / 500)));
        g.fillStyle = '#facc15'; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
        g.fillStyle = '#fde68a'; g.beginPath(); g.ellipse(-3, 3, 7, 5, 0, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(5, -4, 4.5, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(6.5, -4, 2, 0, 7); g.fill();
        g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(10, 0); g.lineTo(20, 3); g.lineTo(10, 6); g.fill();
        g.restore();
        g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 5; g.textAlign = 'center'; g.font = '900 40px Montserrat, sans-serif';
        if (s.mode !== 'ready') { g.strokeText(String(s.score), W / 2, 58); g.fillText(String(s.score), W / 2, 58); }
        g.font = '800 20px Montserrat, sans-serif';
        if (s.mode === 'ready') { g.strokeText('Нажми, чтобы лететь', W / 2, 140); g.fillText('Нажми, чтобы лететь', W / 2, 140); }
        if (s.mode === 'over') { g.strokeText('Упала! Нажми — ещё раз', W / 2, 150); g.fillText('Упала! Нажми — ещё раз', W / 2, 150); }
      }
      const frame = now => {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        const dt = Math.min(.05, Math.max(0, (now - (last || now)) / 1000)); last = now;
        step(dt); draw();
      };
      raf = requestAnimationFrame(frame);
      cv.addEventListener('pointerdown', e => { e.preventDefault(); flap(); });
      // Пробел — игре (управление мира его не получит: телефон открыт, мир стоит)
      const onKey = e => { if (e.code !== 'Space' || e.repeat || e.target?.closest?.('input, textarea')) return; e.preventDefault(); flap(); };
      window.addEventListener('keydown', onKey);
      return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
    },
  });

  // ═══ Уведомления (notifications.js) ═══
  P.define('notif', {
    render(el){
      el.innerHTML = P.head('🔔 Уведомления', '<button type="button" class="ph-hbtn" data-k="all" title="Прочитать все">✓✓</button>') + '<div class="ph-body"></div>';
      const b = el.querySelector('.ph-body');
      if (!P.me()) { P.login(b, 'Уведомления — ответы, упоминания, друзья — для вошедших.'); return; }
      const draw = () => {
        const items = typeof notifItems !== 'undefined' ? notifItems : [];
        if (typeof notifAvailable !== 'undefined' && notifAvailable === false) { b.innerHTML = '<div class="ph-empty"><b>🔔 Скоро</b><span>Уведомления появятся, когда сайт обновится.</span></div>'; return; }
        b.innerHTML = items.length ? `<div class="ph-list">${items.map(n => `<button type="button" class="ph-item${n.read_at ? '' : ' unread'}" data-n="${n.id}"><span class="ph-ava" style="width:38px;height:38px;background:rgba(255,255,255,.08);font-size:18px">${(typeof NOTIF_ICON !== 'undefined' && NOTIF_ICON[n.kind]) || '🔔'}</span><span><b>${n.actor_nick ? e(n.actor_nick) + ' ' : ''}${e(n.title)}</b>${n.body ? `<small>${e(n.body)}</small>` : ''}</span><time>${e(P.ago(n.created_at))}</time>${n.read_at ? '' : '<em class="ph-un">•</em>'}</button>`).join('')}</div>`
          : '<div class="ph-empty"><b>Пока тихо</b><span>Здесь будут ответы, упоминания, заявки в друзья и пропущенные звонки.</span></div>';
      };
      b.addEventListener('click', ev => { const x = ev.target.closest('[data-n]'); if (!x || typeof notifItems === 'undefined') return; const n = notifItems.find(i => i.id === +x.dataset.n); if (!n) return; if ((n.link || '').startsWith('#/phone/')) { if (!n.read_at && typeof sbClient !== 'undefined') { n.read_at = new Date().toISOString(); sbClient.rpc('mark_notifications_read', { p_ids: [n.id] }); } P.go(n.link.slice(8)); } else if (typeof openNotif === 'function') { openNotif(n); if (!P.isDocked()) P.close(); } });
      el.querySelector('[data-k="all"]').onclick = async () => { if (typeof markAllNotifsRead === 'function') await markAllNotifsRead(); draw(); };
      draw();
      if (typeof notifLoad === 'function') notifLoad().then(draw);
    },
  });

  // ⚙️ Настройки телефона — вкладка «📱 Телефон» в общем окне настроек (phone.js → D37Settings.addTab)
})();
