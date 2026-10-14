// ═══════════════════════════════════════
//  «🌍 ВЕСЬ МИР» — чат всех серверов «Мира Денчика» сразу (рядом с чатом своего сервера: кнопка 🏠/🌍 у поля ввода).
// ═══════════════════════════════════════
// Свой канал Supabase Realtime 'mir-all' (только broadcast, без presence — дёшево). Сообщение подписано ключом игрока
// (тот же ECDSA-ключ, что в мире), рядом — пропуск мира (world.sql): если он есть и сходится — ник из базы, иначе ник со
// знаком «?» (как в самом мире). Мат закрывается, ссылки — «[ссылка]» (фильтр мира), не чаще раза в 1,5 с от одного
// игрока, забаненные ники и игроки — не видны. Пишут только вошедшие (как и в чате сервера).
// mir.js: S.allChat = D37WorldChat.start({ form, input, keys: () => S.keys, pass: () => S.pass, me, shard, addLog, toast, clean })
(() => {
  const W = window.D37WorldChat = window.D37WorldChat || {};
  const enc = s => new TextEncoder().encode(s);
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const importPub = pub => crypto.subtle.importKey('raw', unb64(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sign = async (priv, str) => b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc(str)));
  const verify = (pub, sig, str) => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(sig), enc(str)).catch(() => false);
  // чужое сообщение: только знакомые поля, разумные размеры, свежее (не повтор старого)
  W.valid = (pl, now = Date.now()) => {
    if (!pl || typeof pl.m !== 'string' || typeof pl.s !== 'string' || typeof pl.p !== 'string' || pl.m.length > 700 || pl.p.length > 200 || pl.s.length > 200) return null;
    let d; try { d = JSON.parse(pl.m); } catch (e) { return null; }
    if (!d || typeof d.x !== 'string' || typeof d.n !== 'string' || !d.x.trim() || d.x.length > 200) return null;
    if (!(typeof d.ts === 'number' && d.ts > now - 60000 && d.ts < now + 60000)) return null;
    return { n: d.n.slice(0, 24), u: typeof d.u === 'string' ? d.u : null, sh: Number.isInteger(d.sh) && d.sh > 0 && d.sh < 100 ? d.sh : 0, x: d.x.slice(0, 160), ts: d.ts };
  };
  W.start = o => {
    const st = { on: false, ready: false, rate: new Map(), pubs: new Map(), checks: new Map(), lastSend: 0, seen: new Set() };
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'wld-scope';
    btn.title = 'Куда писать: 🏠 свой сервер или 🌍 весь мир (все серверы)';
    const upd = () => {
      btn.textContent = st.on ? '🌍' : '🏠';
      btn.setAttribute('aria-label', st.on ? 'Пишешь во весь мир — нажми, чтобы писать своему серверу' : 'Пишешь своему серверу — нажми, чтобы писать во весь мир');
      if (!o.input.readOnly) o.input.placeholder = st.on ? 'Написать во весь мир (все серверы)…' : 'Написать всем на сервере…';
      btn.classList.toggle('on', st.on);
    };
    btn.addEventListener('click', ev => { ev.preventDefault(); st.on = !st.on; upd(); if (!o.input.readOnly) o.input.focus(); });
    o.form.prepend(btn); upd();
    const ch = sbClient.channel('mir-all', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'm' }, ({ payload }) => recv(payload))
      .subscribe(s => { st.ready = s === 'SUBSCRIBED'; });
    async function check(pass, pub){
      const k = pass + '|' + pub;
      if (st.checks.has(k)) return st.checks.get(k);
      let v = null;
      try { const { data, error } = await sbClient.rpc('world_check', { p_pass: pass, p_pub: pub }); v = error ? null : data || null; } catch (e) {}
      st.checks.set(k, v); if (st.checks.size > 400) st.checks.clear();
      return v;
    }
    async function recv(pl){
      const d = W.valid(pl); if (!d) return;
      const sigKey = pl.s.slice(0, 40); if (st.seen.has(sigKey)) return; st.seen.add(sigKey); if (st.seen.size > 500) st.seen.clear();
      const t = Date.now(), last = st.rate.get(pl.p) || 0;
      if (t - last < 1500) return;
      st.rate.set(pl.p, t); if (st.rate.size > 500) st.rate.clear();
      let pk = st.pubs.get(pl.p);
      if (!pk) { try { pk = await importPub(pl.p); } catch (e) { return; } st.pubs.set(pl.p, pk); if (st.pubs.size > 400) st.pubs.clear(); }
      if (!await verify(pk, pl.s, pl.m)) return;
      const who = typeof pl.ps === 'string' && pl.ps.length < 300 ? await check(pl.ps, pl.p) : null;
      if (who?.banned) return;
      const nick = who && (!d.u || who.uid === d.u) ? who.nick : d.n + ' ?';
      if (typeof bannedNicks !== 'undefined' && bannedNicks.has(String(who?.nick || d.n).toLowerCase())) return;
      if (o.muted?.(pl.p, who?.uid || d.u)) return;
      o.addLog(nick, o.clean(d.x), d.sh, false);
    }
    return {
      get on(){ return st.on; },
      async send(text){
        if (!st.ready) { o.toast('🌍 Чат всего мира подключается — секунду…'); return false; }
        if (Date.now() - st.lastSend < 2000) { o.toast('Не так быстро 🙂'); return false; }
        const keys = o.keys(); if (!keys) return false;
        st.lastSend = Date.now();
        const m = JSON.stringify({ n: String(o.me().nick || 'игрок').slice(0, 24), u: o.me().uid || null, sh: o.shard(), x: text.slice(0, 160), ts: Date.now() });
        const s = await sign(keys.kp.privateKey, m);
        ch.send({ type: 'broadcast', event: 'm', payload: { m, s, p: keys.pub, ps: o.pass() || null } }).catch(() => {});
        o.addLog(o.me().nick, o.clean(text), o.shard(), true);
        return true;
      },
      stop(){ try { sbClient.removeChannel(ch); } catch (e) {} btn.remove(); },
    };
  };
})();
