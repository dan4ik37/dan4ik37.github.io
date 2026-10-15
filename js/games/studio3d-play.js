// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — в игре: режим игры без кода и ракурс камеры мира (модуль D37E.studioPlay 'play'). Работает везде, где
//  играют: «▶ Играть» в редакторе, выложенный мир по ссылке, «👥 Тест вдвоём» и комната с друзьями.
// ═══════════════════════════════════════
// Настройки мира — SC.settings: game { mode, …параметры } (D37E.modes), camera { mode, free, dist, angle } (D37E.views).
// Правила считает тот, кто считает мир (один или хозяин комнаты, js/engine/net.js): раунды, очки, команды, жизни, волны зомби;
// гости получают снимок M.view() событием 'mode' { v } и рисуют табло; хозяин двигает их (появиться: { cmd: 'spawn', at }),
// бьёт ({ cmd: 'hurt', dmg, kx, kz }), пишет ({ cmd: 'say' }), меняет им ракурс ({ cmd: 'cam' }). Гость бьёт — { cmd: 'atk', yaw }
// хозяину (он проверяет, кто рядом). Ушёл хозяин — новый продолжает раунд с последнего снимка (M.restore).
// Удар: F, RT на геймпаде, 👊 на телефоне (в «Каждый сам», «Команды», «Царь горы» — по игрокам, в «Выживании» — по зомби).
// Скрипты: Game.* / Camera.* (script.js) → команды 'mode' / 'camera'; сюда же шлём им состояние 'game' и события раундов.
(() => {
  const E = window.D37E = window.D37E || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEG = Math.PI / 180;
  let A = null, M = null, V = null, st = null;   // A — PLAY_API студии
  const pl = () => A?.pl, SC = () => A?.SC;
  const myId = () => A?.myId?.() || 'me';
  const idOf = pid => pid === 'me' ? myId() : pid;   // студия зовёт себя 'me', режим — номером в комнате
  const gameCfg = () => { const g = SC()?.settings?.game; return g && E.modes?.MODES[g.mode] && g.mode !== 'none' ? g : null; };
  const camCfg = () => SC()?.settings?.camera || null;
  const view = () => M ? M.view() : st?.view || null;   // снимок: у хозяина — свой, у гостя — пришедший
  const meIn = v => v?.ps?.find(p => p.id === myId()) || null;

  // ═══ Точки появления: команда, порядок, разброс по площадке ═══
  function spawnsFor(team, mode){
    const all = SC().all().filter(o => o.cls === 'Spawn' && o.pos && o.size);
    let list = all;
    if (team) { const t = all.filter(o => (o.team | 0) === team); list = t.length ? t : all.filter(o => !(o.team | 0)).length ? all.filter(o => !(o.team | 0)) : all; }
    else { const free = all.filter(o => !(o.team | 0)); if (free.length) list = free; }
    if (mode === 'obby' || mode === 'race') list = list.slice(0, mode === 'obby' ? 1 : 4);
    return list;
  }
  function spawnPos(team, k, mode){
    const list = spawnsFor(team, mode);
    if (!list.length) return A.spawnPoint();
    const s = list[k % list.length], n = Math.floor(k / list.length);
    const r = n ? Math.min(Math.min(s.size[0], s.size[2]) / 2 - .4, .9 + .7 * Math.floor((n - 1) / 6)) : 0, a = (n - 1) * Math.PI / 3;
    return [+(s.pos[0] + Math.cos(a) * Math.max(0, r)).toFixed(3), +(s.pos[1] + s.size[1] / 2 + .05).toFixed(3), +(s.pos[2] + Math.sin(a) * Math.max(0, r)).toFixed(3)];
  }
  // чекпоинты гонки: детали «🚩» по номеру (order), потом по порядку в мире — у хозяина и гостей одинаково
  const checksOf = () => SC().all().filter(o => o.cls === 'Part' && o.touch === 'check').sort((a, b) => ((a.order | 0) - (b.order | 0)));
  const topOf = o => [o.pos[0], o.pos[1] + (o.size?.[1] || 0) / 2 + .05, o.pos[2]];

  // ═══ Режим (у того, кто считает мир) ═══
  function startMode(restore){
    const g = gameCfg(); M = null;
    if (!g) { broadcast(true); return; }
    const c = E.modes.cfg(g.mode, g);
    st.checks = checksOf().map(o => o.id);
    M = E.modes.create(c, hooks);
    M.setChecks(st.checks.length);
    for (const p of A.players()) M.join(idOf(p.id), p.name);
    if (!(restore && st.view && M.restore(st.view))) M.start();
    st.sentAt = 0; broadcast(true);
  }
  const hooks = {
    net: () => !!A?.mp?.S,
    spawnAll(list){ list.forEach((x, k) => spawnOne(x.id, spawnPos(x.team, k, M?.cfg.mode))); },
    spawn(id, team){ spawnOne(id, spawnPos(team, Math.random() * 4 | 0, M?.cfg.mode)); },
    freeze(id, on){ if (id === myId()) { st.frozen = on; applyMe(); } },
    blind(id, on){ if (id === myId()) { st.blind = on; } },
    say(text, id){ if (!id || id === myId()) toast(text); if (!id) A.sendAll('mode', { cmd: 'say', text }); else if (id !== myId()) A.sendTo(id, 'mode', { cmd: 'say', text }); },
    event(name, d){
      A.scriptEvent(name, d);
      if (name === 'roundStart') A.sound('coin');
      if (name === 'roundEnd' || name === 'matchEnd') { A.sound('pickup'); confetti(); A.sendAll('mode', { cmd: 'fx' }); }
    },
    resetRound(){ for (const c of st.coins.splice(0)) backCoin(c); st.zhp.clear(); },
    zombies(n, wave){ spawnZombies(n, wave); },
    clearZombies(){ for (const id of st.zIds) { const o = SC().get(id); if (o) SC().remove(o); } st.zIds.clear(); st.zhp.clear(); },
    coinTaken(){},
  };
  function spawnOne(id, at){
    if (id === myId()) { const P = pl(); P.sp = at.slice(); P.dead = 0; A.respawn(); applyMe(); }
    else A.sendTo(id, 'mode', { cmd: 'spawn', at });
  }
  // свой персонаж: заморожен (отсчёт, ищущий с закрытыми глазами, итоги раунда) — стоит
  // только на переходе «заморожен → свободен» (иначе разбудим ждущего комнату или мёртвого)
  function applyMe(){ const P = pl(); if (!P || !st) return; if (st.frozen) { P.P.enabled = false; st.fzOn = true; } else if (st.fzOn) { st.fzOn = false; if (!P.dead && P.role !== 'wait') P.P.enabled = true; } }
  function toast(t){ if (t) A.toast(String(t).slice(0, 140), true); }
  function confetti(){ const e = A.ed, P = pl()?.P; if (!e?.FX || !P) return; const em = e.FX.emitter({ kind: 'confetti', at: [P.ch.x, P.ch.y + 3, P.ch.z], rate: 0 }); em.burst(140); setTimeout(() => em.dispose(), 4000); }

  // ── Монетки «Сбора монет»: исчезла — вернётся через coinBack с (и вся — в новом раунде) ──
  function takeCoin(o){
    const S = SC(), data = S.serialize([o, ...S.descendants(o)]);
    S.remove(o);
    const back = M?.cfg.coinBack || 0;
    st.coins.push({ data, at: back > 0 ? st.now + back : Infinity });
  }
  function backCoin(c){ const S = SC(); for (const d of c.data) { if (S.get(d.id)) continue; try { S.add(d.cls, d, d.parent && S.get(d.parent) ? d.parent : null, d.id); } catch (e) {} } }

  // ── Зомби «Выживания»: в 🟥 зонах (touch: zspawn) или кольцом вокруг старта ──
  function spawnZombies(n, wave){
    const S = SC(), zones = S.all().filter(o => o.cls === 'Part' && o.touch === 'zspawn'), ph = A.ed.ph, sp = A.spawnPoint();
    for (let i = 0; i < Math.min(30, n); i++) {
      let x, z, y;
      if (zones.length) { const zo = zones[i % zones.length], b = S.box(zo); x = b.min.x + Math.random() * (b.max.x - b.min.x); z = b.min.z + Math.random() * (b.max.z - b.min.z); y = b.max.y + .05; }
      else { const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 8; x = sp[0] + Math.cos(a) * d; z = sp[2] + Math.sin(a) * d; y = ph.supportAt(x, z, .4, 1e6).y + .05; }
      const o = S.add('NPC', { name: 'Зомби', look: 'zombie', act: 'follow', damage: M?.cfg.zdmg || 15, speed: Math.min(1.6, .78 + wave * .06), seed: Math.random().toString(36).slice(2, 8), text: '', pos: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)] });
      st.zIds.add(o.id); st.zhp.set(o.id, 100);
    }
  }
  const zombiesAlive = () => { let n = 0; for (const id of st.zIds) if (SC().get(id)) n++; else st.zIds.delete(id); return n; };

  // ═══ Удар (F / RT / 👊) — считает хозяин ═══
  function attack(from, yawIn){
    const v = view(); if (!M || M.phase !== 'play') return;
    const pvp = E.modes.PVP.has(M.cfg.mode); if (!pvp) return;
    const now = performance.now(); if (now - (st.atk.get(from) || 0) < 420) return; st.atk.set(from, now);
    const all = A.players(), me = from === myId();
    const a = me ? all.find(p => p.me) : all.find(p => p.id === from); if (!a?.pos) return;
    const yaw = me ? pl().P.yaw : (Number.isFinite(yawIn) ? yawIn : a.yaw || 0), fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bd = 2.9;
    const consider = (kind, id, pos, ref) => {
      const dx = pos[0] - a.pos[0], dz = pos[2] - a.pos[2], d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(pos[1] - a.pos[1]) > 2.4) return;
      if (d > .45 && (dx * fx + dz * fz) / d < .25) return;   // впереди, а не за спиной
      best = { kind, id, d, dx, dz, ref }; bd = d;
    };
    if (M.cfg.mode === 'survival') { for (const e of A.ed.NPC.list.values()) if (st.zIds.has(e.o.id) && e.P) consider('z', e.o.id, [e.P.ch.x, e.P.ch.y, e.P.ch.z], e); }
    else for (const p of all) if (p !== a && p.pos && !p.dead) consider('p', p.me ? myId() : p.id, p.pos);
    if (!best) return;
    const k = 1 / Math.max(.35, best.d), kx = best.dx * k, kz = best.dz * k;
    if (best.kind === 'z') {
      const hp = (st.zhp.get(best.id) ?? 100) - (M.cfg.dmg || 34);
      best.ref.P?.push(kx * 7, 3.5, kz * 7);
      A.sound('hit', [best.ref.P.ch.x, best.ref.P.ch.y, best.ref.P.ch.z]);
      if (hp <= 0) { const o = SC().get(best.id); if (o) SC().remove(o); st.zIds.delete(best.id); st.zhp.delete(best.id); M.zombieKilled(from); }
      else st.zhp.set(best.id, hp);
      return;
    }
    const r = M.hit(from, best.id); if (!r) return;
    A.sound('hit', null);
    hurtOne(best.id, r.dmg, kx, kz);
  }
  function hurtOne(id, dmg, kx, kz){
    if (id === myId()) { const P = pl(); if (dmg > 0) A.hurt(dmg); P.P.push(kx * 9, 5.5, kz * 9); P.rig.kick?.(1); }
    else A.sendTo(id, 'mode', { cmd: 'hurt', dmg, kx, kz });
  }

  // ═══ Разослать снимок (гостям и скриптам) ═══
  function broadcast(force){
    if (!A?.live()) return;
    const v = M ? M.view() : null;
    st.view = v;
    if (M && !force && !M.take() && st.now - st.sentAt < 1.5) return;
    st.sentAt = st.now;
    A.sendAll('mode', { v });
    // скриптам: Game.Mode, State, Round, TimeLeft, очки и команды игроков (себя скрипты зовут 'me')
    const sid = id => id === myId() ? 'me' : id, scores = {}, teams = {};
    for (const p of v?.ps || []) { scores[sid(p.id)] = p.s; teams[sid(p.id)] = p.tm; }
    A.scriptEvent('game', { s: { mode: v?.m || '', phase: v?.ph || '', round: v?.r || 0, rounds: v?.c.rounds || 1, left: leftOf(v), scores, teams, cam: V?.mode || 'third' } });
  }
  // сколько осталось (с): отсчёт, время спрятаться, время раунда; −1 — без ограничения
  function leftOf(v, extra = 0){
    if (!v) return -1;
    const t = (v.t || 0) + extra, c = v.c || {};
    if (v.ph === 'count') return Math.max(0, c.count - t);
    if (v.ph === 'end') return Math.max(0, 5 - t);
    if (v.ph !== 'play') return -1;
    if (v.m === 'hide') return t < c.hide ? Math.max(0, c.hide - t) : c.time > 0 ? Math.max(0, c.hide + c.time - t) : -1;
    return c.time > 0 && v.m !== 'survival' ? Math.max(0, c.time - t) : -1;
  }

  // ═══ Табло: режим, время, раунд; моя строка; лучшие; отсчёт; итоги ═══
  const TEAM = n => E.modes.TEAMS[n] || null;
  const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function drawHud(){
    const P = pl(); if (!P) return;
    const v = view(), hud = P.hud, viewEl = A.ed.q('.s3-view');
    let el = hud.querySelector('.s3x-mhud');
    if (!v) { if (el) { for (const x of hud.querySelectorAll('.s3x-mhud,.s3x-mine,.s3x-board,.s3x-blind,.s3x-count')) x.remove(); } viewEl?.querySelector('.s3x-win')?.remove(); hud.classList.remove('s3x-moded'); return; }
    hud.classList.add('s3x-moded');
    const D = E.modes.MODES[v.m] || {}, extra = M ? 0 : (performance.now() - st.viewAt) / 1000, left = leftOf(v, extra), me = meIn(v);
    if (!el) { el = document.createElement('div'); el.className = 's3x-mhud'; hud.appendChild(el); }
    const ph = v.ph === 'wait' ? '⏳ Ждём игроков' : v.ph === 'count' ? 'Приготовься' : v.ph === 'end' ? 'Итоги раунда' : v.ph === 'over' ? 'Конец игры' : '';
    const teams = v.c.teams ? `<span class="s3x-teams">${[1, 2, 3, 4].slice(0, v.c.teams).map(k => `<span style="background:${TEAM(k)[2]}55">${TEAM(k)[0]} ${v.ts[k] | 0}${v.c.goal ? '/' + v.c.goal : ''}</span>`).join('')}</span>` : '';
    const html = `<span class="m">${D.icon || '🎮'} ${esc(D.name || '')}${ph ? ' · ' + ph : ''}</span>${v.c.rounds > 1 ? `<span class="r">Раунд ${v.r || 1}/${v.c.rounds}</span>` : ''}${teams}${left >= 0 ? `<span class="t">⏱ ${fmt(left)}</span>` : ''}`;
    if (el.innerHTML !== html) el.innerHTML = html;
    // моя строка
    let mine = hud.querySelector('.s3x-mine'); if (!mine) { mine = document.createElement('div'); mine.className = 's3x-mine'; hud.appendChild(mine); }
    let t = '';
    if (v.ph === 'wait') t = v.m === 'hide' ? '🙈 Прятки — нужно 2 игрока и больше: позови друга (👥)' : `👥 Нужно игроков: ${v.c.min} — сейчас ${v.ps.length}. Позови друзей по ссылке`;
    else if (me) {
      if (me.tm && TEAM(me.tm)) t += `Ты в команде ${TEAM(me.tm)[0]} ${TEAM(me.tm)[1]} · `;
      if (v.m === 'race') t += `🏁 Круг ${Math.min(me.lp + 1, v.c.laps)}/${v.c.laps} · 🚩 ${me.cp}/${v.ck}${me.b ? ' · лучший ' + me.b.toFixed(1) + ' с' : ''}`;
      else if (v.m === 'obby') t += me.f ? `🏁 Финиш: ${me.f.toFixed(1)} с` : '🏃 Беги к 🏁 финишу!';
      else if (v.m === 'hide') t += me.ro === 'seeker' ? (v.ph === 'play' && v.t < v.c.hide ? '👀 Ты ищешь — глаза закрыты…' : '👀 Ты ищешь — подбеги вплотную') : '🙈 Ты прячешься';
      else if (v.m === 'survival') t += `🧟 Волна ${v.wave || 0}/${v.c.waves}${me.o ? ' · ☠️ выбыл' : v.c.lives ? ' · ❤️×' + me.lv : ''} · 🗡 ${me.k}`;
      else if (v.m === 'koth') t += `👑 ${me.s}${v.c.goal ? '/' + v.c.goal : ''} — стой в 🟩 зоне один`;
      else if (v.m === 'coins') t += `💰 ${me.s}${v.c.goal && !v.c.teams ? '/' + v.c.goal : ''}`;
      else if (v.m === 'ffa' || v.m === 'teams') t += `💥 ${me.s}${v.c.goal && !v.c.teams ? '/' + v.c.goal : ''}${v.c.lives ? (me.o ? ' · ☠️ выбыл' : ' · ❤️×' + me.lv) : ''} · удар — ${E.inputKind?.kind === 'pad' ? 'RT' : P.I.touch ? '👊' : 'F'}`;
      if (v.ph === 'play' && v.ps.length < 2 && E.modes.PVP.has(v.m) && v.m !== 'survival') t += ' · позови друзей (👥) — бить некого';
    }
    if (mine.textContent !== t) mine.textContent = t;
    mine.hidden = !t;
    // лучшие (или команды)
    let bd = hud.querySelector('.s3x-board'); if (!bd) { bd = document.createElement('div'); bd.className = 's3x-board'; hud.appendChild(bd); }
    const unit = v.m === 'race' ? (p => p.f ? p.f.toFixed(1) + ' с' : `${p.lp}/${v.c.laps}`) : v.m === 'obby' ? (p => p.f ? p.f.toFixed(1) + ' с' : '—') : (p => p.s);
    const bh = v.ps.slice(0, 6).map(p => `<div class="${p.id === myId() ? 'me' : ''}${p.o ? ' out' : ''}"><span>${p.tm && TEAM(p.tm) ? TEAM(p.tm)[0] + ' ' : ''}${p.ro === 'seeker' ? '👀 ' : p.ro === 'hider' ? '🙈 ' : ''}${esc(p.n)}</span><b>${esc(unit(p))}</b></div>`).join('');
    if (bd.innerHTML !== bh) bd.innerHTML = bh;
    bd.hidden = !v.ps.length;
    // отсчёт
    let cn = hud.querySelector('.s3x-count');
    const cnum = v.ph === 'count' ? Math.ceil(left) : v.ph === 'play' && (v.t + extra) < .9 && v.m !== 'none' ? 0 : -1;
    if (cnum >= 0) {
      if (!cn) { cn = document.createElement('div'); cn.className = 's3x-count'; hud.appendChild(cn); }
      const txt = cnum > 0 ? String(cnum) : 'Старт!';
      if (cn.textContent !== txt) { cn.textContent = txt; cn.classList.toggle('go', !cnum); cn.style.animation = 'none'; void cn.offsetWidth; cn.style.animation = ''; if (cnum > 0) A.sound('click'); }
    } else cn?.remove();
    // ищущий с закрытыми глазами
    let bl = hud.querySelector('.s3x-blind');
    const blind = M ? st.blind : !!me?.bl;
    if (blind) { if (!bl) { bl = document.createElement('div'); bl.className = 's3x-blind'; hud.appendChild(bl); } bl.textContent = `🙈 Считаю до ${Math.ceil(Math.max(0, v.c.hide - v.t - extra))}… Прятавшиеся прячутся!`; }
    else bl?.remove();
    // итоги раунда / конец игры
    let w = viewEl.querySelector('.s3x-win');
    if (v.ph === 'end' || v.ph === 'over') {
      const key = v.ph + v.r + (v.w?.text || '');
      if (!w || w.dataset.k !== key) {
        w?.remove(); w = document.createElement('div'); w.className = 's3x-win'; w.dataset.k = key; viewEl.appendChild(w);
        const live = !!M, last = v.ph === 'over';
        const rows = v.ps.slice(0, 8).map((p, i) => `<tr class="${p.id === myId() ? 'me' : ''}"><td>${i + 1}. ${p.tm && TEAM(p.tm) ? TEAM(p.tm)[0] + ' ' : ''}${esc(p.n)}</td><td>${esc(unit(p))}${v.c.rounds > 1 ? ` · 🏆${p.w}` : ''}</td></tr>`).join('');
        w.innerHTML = `<div><h3>${esc(v.w?.text || (last ? 'Конец игры' : 'Раунд окончен'))}</h3><p>${last ? (v.c.rounds > 1 ? `Сыграно раундов: ${v.c.rounds}` : '') : `Раунд ${v.r} из ${v.c.rounds} · следующий сейчас начнётся`}</p><table>${rows}</table>`
          + `<div class="s3x-row">${live && last ? '<button type="button" class="s3-play" data-w="again">🔁 Ещё раз</button>' : ''}${live && !last ? '<button type="button" data-w="next">▶ Дальше</button>' : ''}${!live && last ? '<p>Ждём, когда хозяин начнёт заново…</p>' : ''}<button type="button" data-w="hide">✕</button></div></div>`;
        w.addEventListener('click', ev => { const k = ev.target.closest('[data-w]')?.dataset.w; if (!k) return; if (k === 'hide') w.hidden = true; else if (k === 'again' && M) { M.start(); broadcast(true); } else if (k === 'next' && M && M.phase === 'end') { M.t = 99; } });
      }
    } else w?.remove();
  }

  // ═══ Ракурс камеры ═══
  function camsFromScene(){
    const S = SC();
    return S.all().filter(o => o.cls === 'Camera' && o.pos).map(c => ({ id: c.id, pos: c.pos, rot: c.rot, fov: c.fov, kind: c.kind,
      zones: S.children(c).filter(z => z.pos && z.size).map(z => { const b = S.box(z); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]; }) }));
  }
  function applyCam(first){
    const P = pl(); if (!P || !V) return;
    const cc = camCfg(), mode = E.views.cfg(cc || 'third');
    // мир «как обычно» (3-е лицо, можно переключать) — как выбрал игрок в ⚙️ «Вид»
    if (mode.mode === 'third' && mode.free && window.D37Settings?.get('view') === 'first') mode.mode = 'first';
    V.cams = camsFromScene();
    V.set(mode, { smooth: !first });
    P.H.crosshair(V.mode === 'first' || V.mode === 'shoulder');
  }
  function setCamMode(m, smooth = true){
    if (!V || !E.views.IDS.includes(m)) return false;
    V.set({ ...(camCfg() || {}), mode: m }, { smooth });
    pl()?.H.crosshair(V.mode === 'first' || V.mode === 'shoulder');
    return true;
  }

  // ═══ Модуль игры ═══
  E.studioPlay = E.studioPlay || [];
  E.studioPlay.push({
    id: 'play',
    start(papi){
      A = papi; M = null;
      E.s3ui?.css?.();
      st = { now: 0, view: null, viewAt: performance.now(), frozen: false, blind: false, coins: [], zIds: new Set(), zhp: new Map(), atk: new Map(), checks: [], sentAt: 0, camT: 0, hudT: 0, myIdWas: myId() };
      const P = pl();
      V = E.views?.create(papi.R.camera, P.rig, { T: papi.R.T }) || null;
      applyCam(true);
      // 👊 на телефоне — в режимах с боем
      const g = gameCfg();
      if (P.I.touch && g && E.modes.PVP.has(g.mode)) P.H.buttons([{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'interact', icon: '✋', label: 'действие' }, { id: 'attack', action: 'attack', icon: '👊', label: 'удар' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }]);
      if (g) setTimeout(() => { if (A === papi && pl()) toast(`${E.modes.MODES[g.mode].icon} ${E.modes.MODES[g.mode].name}: ${E.modes.MODES[g.mode].desc}`); }, 900);
    },
    world(restore){ if (st) startMode(restore); },
    unworld(){ M = null; },
    stop(){
      const P = pl(); V?.reset();
      if (P) { for (const x of P.hud.querySelectorAll('.s3x-mhud,.s3x-mine,.s3x-board,.s3x-blind,.s3x-count')) x.remove(); P.hud.classList.remove('s3x-moded'); }
      A?.ed?.q('.s3x-win')?.remove();
      M = null; V = null; st = null; A = null;
    },
    settings(){ if (st) { applyCam(false); if (A.live()) startMode(false); } },
    step(dt, live){
      if (!st) return;
      st.now += dt;
      const P = pl(); if (!P) return;
      // свой номер сменился (открыли комнату посреди игры)
      if (M && st.myIdWas !== myId()) { M.rename(st.myIdWas, myId()); st.myIdWas = myId(); }
      if (M && live) {
        // где кто: холм, прятки, зомби
        const ctx = {};
        if (M.cfg.mode === 'koth') {
          if (!st.hills || st.now - (st.hillsAt || 0) > 1) { st.hillsAt = st.now; st.hills = SC().all().filter(o => o.cls === 'Part' && o.touch === 'hill').map(o => SC().box(o)); }
          ctx.hill = A.players().filter(p => p.pos && !p.dead && st.hills.some(b => p.pos[0] >= b.min.x - .3 && p.pos[0] <= b.max.x + .3 && p.pos[2] >= b.min.z - .3 && p.pos[2] <= b.max.z + .3 && p.pos[1] >= b.min.y - 1 && p.pos[1] <= b.max.y + 2.5)).map(p => idOf(p.id));
        }
        if (M.cfg.mode === 'hide') {
          const all = A.players().filter(p => p.pos), near = [];
          for (const s of all) { const S2 = M.player(idOf(s.id)); if (S2?.role !== 'seeker') continue; for (const h of all) { const H2 = M.player(idOf(h.id)); if (H2?.role === 'hider' && Math.hypot(s.pos[0] - h.pos[0], s.pos[2] - h.pos[2]) < E.modes.TAG_R && Math.abs(s.pos[1] - h.pos[1]) < 2.4) near.push([S2.id, H2.id]); } }
          ctx.near = near;
        }
        if (M.cfg.mode === 'survival') ctx.zombies = zombiesAlive();
        M.step(dt, ctx);
        // монетки возвращаются
        for (const c of st.coins.slice()) if (c.at <= st.now) { st.coins.splice(st.coins.indexOf(c), 1); backCoin(c); }
        broadcast(false);
      }
      // удар: у себя — хозяину (или сразу, если считаем мир сами)
      const v = view();
      if (v && E.modes.PVP.has(v.m) && P.C.down('attack') && !P.dead) {
        P.rig.kick?.(.6); A.sound('click');
        if (M) attack(myId()); else A.sendHost('mode', { cmd: 'atk', yaw: P.P.yaw });
      }
      // гость: заморожен ли (из снимка)
      if (!M && v) { const me = meIn(v); st.frozen = !!me?.fz; }
      applyMe();
      // камеры в мире: перечитать зоны раз в секунду (их могли подвинуть скрипты, гостю — пришли по сети)
      if (V?.mode === 'fixed' && st.now - st.camT > 1) { st.camT = st.now; V.cams = camsFromScene(); }
    },
    moveCam(){ if (!V || !st) return null; return V.moveCam(pl().C, pl().P); },
    moved(){ V?.afterMove(pl()?.P); },
    camera(dt, look){
      if (!V || !st) return false;
      const P = pl();
      V.update(dt, P.P, look, A.ed.ph, P.C);
      if (V.mode === 'shoulder') P.I.wantLock = !P.I.touch && !window.D37Settings?.isOpen?.() && !P.phoneOn;
      return true;
    },
    frame(){
      if (!st) return;
      const now = performance.now(); if (now - st.hudT < 110) return; st.hudT = now;
      try { drawHud(); } catch (e) { console.error('режим игры, табло', e); }
    },
    view(){
      if (!V) return false;
      const cc = E.views.cfg(camCfg() || 'third');
      if (!cc.free || !['third', 'first', 'shoulder'].includes(cc.mode)) { toast('🎥 Ракурс задан миром — переключить нельзя'); return true; }
      const base = cc.mode === 'first' ? 'third' : cc.mode, next = V.mode === 'first' ? base : 'first';
      setCamMode(next);
      A.msg(next === 'first' ? '👁 Вид от 1-го лица (V — обратно)' : next === 'shoulder' ? '🎯 Из-за плеча' : '🎥 Вид от 3-го лица', true);
      if (next !== 'first') pl()?.I.unlock();
      return true;
    },
    // касания: режим может забрать (чекпоинт гонки, монетка «Сбора монет», финиш, чужой спавн команды)
    touch(pid, o){
      if (!st || !o) return false;
      const v = view(); if (!v || v.m === 'none') return false;
      const id = idOf(pid);
      // чужая точка появления в командах — не чекпоинт
      if (o.cls === 'Spawn' && v.c.teams && (o.team | 0)) { const p = v.ps.find(x => x.id === id); if (p && p.tm && p.tm !== (o.team | 0)) return true; }
      if (!M) return false;   // у гостя монетки и финиш считает хозяин
      if (o.touch === 'coin' && M.cfg.mode === 'coins') { if (M.touch(id, 'coin', { oid: o.id })) { takeCoin(o); A.sound('coin', o.pos); if (id !== myId()) A.sendTo(id, 'coin', {}); } return true; }
      if (o.touch === 'finish' && (M.cfg.mode === 'obby' || M.cfg.mode === 'race')) { const was = M.player(id)?.fin; M.touch(id, 'finish'); if (!was && M.player(id)?.fin && id === myId()) confetti(); return true; }
      if (o.touch === 'check') { M.touch(id, 'check', { idx: st.checks.indexOf(o.id) }); if (id === myId() && M.cfg.mode === 'race') A.sound('pickup'); return true; }
      if (o.touch === 'hill' || o.touch === 'zspawn') return true;
      return false;
    },
    died(pid){ if (M) M.died(idOf(pid)); },
    respawnDelay(){
      if (M) return M.respawnDelay(myId());
      const v = view(), me = meIn(v); if (!v || v.m === 'none') return null;
      if (me?.o) return { v: Infinity, text: '☠️ Ты выбыл — жди следующий раунд' };
      if (me && v.c.lives > 0 && (v.m === 'ffa' || v.m === 'teams' || v.m === 'survival') && me.lv <= 1) return { v: Infinity, text: '☠️ Ты выбыл — жди следующий раунд' };
      return { v: Math.max(.05, v.c.respawn), text: v.c.respawn >= 1 ? `💀 Возвращение через ${v.c.respawn} с` : '💀 Ой!' };
    },
    // куда возрождаться: гонка — к последнему чекпоинту, команды — к своим
    spawnAt(){
      const v = view(); if (!v || v.m === 'none' || !st) return null;
      const me = meIn(v);
      if (v.m === 'race' && me?.cp > 0) { const ch = checksOf()[me.cp - 1]; if (ch) return topOf(ch); }
      if (v.c.teams && me?.tm) return spawnPos(me.tm, Math.random() * 3 | 0, v.m);
      return null;
    },
    join(p){ if (M && A.live()) { M.join(p.id, p.nick); broadcast(true); } },
    leave(p){ if (M) M.leave(p.id); },
    // у хозяина: удар гостя, его смерть
    hostEvent(ty, d, from){
      if (ty === 'died') { M?.died(from); return false; }
      if (ty !== 'mode' || !d || typeof d !== 'object') return false;
      if (d.cmd === 'atk') attack(from, +d.yaw);
      return true;
    },
    // у гостя: снимок, «появись», удар, надпись, ракурс
    guestEvent(ty, d){
      if (!st) return false;
      if (ty === 'coin') { A.sound('coin'); return true; }
      if (ty !== 'mode') return false;
      if ('v' in d) { st.view = d.v && typeof d.v === 'object' ? d.v : null; st.viewAt = performance.now(); }
      if (d.cmd === 'spawn' && Array.isArray(d.at) && d.at.length === 3 && d.at.every(Number.isFinite)) { const P = pl(); P.sp = d.at.slice(); P.dead = 0; A.respawn(); applyMe(); }
      else if (d.cmd === 'hurt') { const P = pl(); if (+d.dmg > 0) A.hurt(Math.min(200, +d.dmg)); P.P.push(Math.max(-2, Math.min(2, +d.kx || 0)) * 9, 5.5, Math.max(-2, Math.min(2, +d.kz || 0)) * 9); P.rig.kick?.(1); }
      else if (d.cmd === 'say') toast(String(d.text || ''));
      else if (d.cmd === 'cam') setCamMode(String(d.mode || ''));
      else if (d.cmd === 'shake' && Array.isArray(d.s)) pl()?.rig.shake?.(Math.min(5, +d.s[0] || 1), Math.min(3, +d.s[1] || .4));
      else if (d.cmd === 'fx') { confetti(); A.sound('pickup'); }
      return true;
    },
    // команды скриптов: Game.* и Camera.* (у того, кто считает мир)
    cmd(d){
      if (!st) return;
      if (d.t === 'camera') {
        if (Array.isArray(d.shake)) { pl()?.rig.shake?.(d.shake[0], d.shake[1]); A.sendAll('mode', { cmd: 'shake', s: d.shake }); return; }
        const m = String(d.mode || ''); if (!E.views.IDS.includes(m)) { A.print(`⚠️ Camera.Mode: нет ракурса «${m}» — есть ${E.views.IDS.join(', ')}`, 'warn'); return; }
        const to = d.pid && d.pid !== 'me' ? d.pid : null;
        if (!to || to === myId()) setCamMode(m);
        if (!to) A.sendAll('mode', { cmd: 'cam', mode: m }); else if (to !== myId()) A.sendTo(to, 'mode', { cmd: 'cam', mode: m });
        broadcast(true);
        return;
      }
      if (d.cmd === 'set') {
        const m = String(d.mode || '');
        if (m && m !== 'none' && !E.modes.MODES[m]) { A.print(`⚠️ Game.Mode: нет режима «${m}» — есть ${E.modes.LIST.join(', ')}`, 'warn'); return; }
        const S = SC(); S.settings = S.settings || {};
        if (!m || m === 'none') { delete S.settings.game; M = null; broadcast(true); return; }
        S.settings.game = { ...(S.settings.game?.mode === m ? S.settings.game : {}), mode: m };
        startMode(false);
        return;
      }
      if (!M) return;
      const pid = d.pid ? idOf(d.pid) : null;
      if (d.cmd === 'score' && pid) M.addScore(pid, +d.n || 0);
      else if (d.cmd === 'team' && pid) M.setTeam(pid, d.n | 0);
      else if (d.cmd === 'end') M.endRound('script', pid || undefined);
      else if (d.cmd === 'start') M.start();
      broadcast(true);
    },
  });
  E.s3play = { _test: { leftOf, spawnPos: (t, k, m) => spawnPos(t, k, m), state: () => ({ M, V, st }) } };
})();
