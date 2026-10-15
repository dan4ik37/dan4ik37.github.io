// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — режимы игры без кода (для «Студии 3D»): Обби, Гонка, Каждый сам за себя, Команды, Царь горы,
//  Прятки, Сбор монет, Выживание. Правила — чистые функции и состояние (без сцены и сети): считает хозяин мира, гости
//  получают снимок M.view(). Проверка в node: scripts/studio-modes-test.cjs
// ═══════════════════════════════════════
// D37E.modes: LIST (порядок в меню), MODES[id] { icon, name, desc, params, def, needs }, PARAMS[k] { label, min, max, step, unit,
//   zero, list }, TEAMS[1…4] [значок, название, цвет], cfg(id, свои) → проверенные настройки, create(cfg, hooks) → M.
// M.start() — новый матч (раунд 1); M.join(id, имя) / leave(id); M.step(dt, ctx) — ctx: { hill: [id] (кто в зоне холма),
//   near: [[кто ищет, кого нашёл]] (прятки), zombies: сколько зомби живо } ; M.touch(id, 'coin' | 'finish' | 'check', { idx })
//   → true — режим забрал касание; M.hit(кто, кого) → { dmg, knock } или null; M.died(id) → выбыл ли; M.zombieKilled(кто);
//   M.addScore(id, n), M.setTeam(id, n), M.endRound(причина, победитель), M.view() → снимок для табло и сети, M.restore(v) —
//   продолжить с чужого снимка (новый хозяин комнаты), M.respawnDelay(id) → { v, text }.
// hooks (что делает игра): spawnAll(список { id, team }), spawn(id, team), freeze(id, вкл), blind(id, вкл), say(текст, id?),
//   event(имя, данные) — roundStart / roundEnd / matchEnd (в скрипты Game.*), resetRound(), zombies(n, волна), clearZombies(),
//   coinTaken(), changed() — снимок поменялся (разослать гостям).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};

  const PARAMS = {
    time: { label: 'Время раунда', unit: 'с', min: 0, max: 1800, step: 5, zero: 'без ограничения' },
    goal: { label: 'Очков для победы', min: 0, max: 500, step: 1, zero: 'нет — до конца времени' },
    teams: { label: 'Команды', list: [[0, 'Каждый сам'], [2, '2 команды'], [3, '3 команды'], [4, '4 команды']] },
    laps: { label: 'Кругов', min: 1, max: 10, step: 1 },
    dmg: { label: 'Урон от удара', min: 0, max: 100, step: 5, zero: 'только толкает' },
    lives: { label: 'Жизней', min: 0, max: 10, step: 1, zero: 'бесконечно' },
    respawn: { label: 'Возрождение через', unit: 'с', min: 0, max: 30, step: 1 },
    seekers: { label: 'Сколько ищут', min: 1, max: 3, step: 1 },
    hide: { label: 'Время спрятаться', unit: 'с', min: 5, max: 60, step: 5 },
    coinBack: { label: 'Монетка вернётся через', unit: 'с', min: 0, max: 60, step: 5, zero: 'не вернётся' },
    waves: { label: 'Волн', min: 1, max: 20, step: 1 },
    zombies: { label: 'Зомби в первой волне', min: 1, max: 20, step: 1 },
    grow: { label: 'Прибавка за волну', min: 0, max: 10, step: 1 },
    zdmg: { label: 'Укус зомби', min: 5, max: 50, step: 5 },
    count: { label: 'Отсчёт перед стартом', unit: 'с', min: 0, max: 10, step: 1, zero: 'сразу' },
    rounds: { label: 'Раундов', min: 1, max: 10, step: 1 },
    min: { label: 'Ждать игроков', min: 1, max: 8, step: 1 },
  };
  // needs — что поставить в мир (studio3d-modes.js показывает и даёт «➕»): finish, check, hill, coin, tspawn, zspawn, spawn
  const MODES = {
    none: { icon: '🌍', name: 'Просто мир', desc: 'Без правил: гуляй, исследуй, играй со скриптами.', params: [], def: {}, needs: [] },
    obby: { icon: '🏃', name: 'Обби', desc: 'Пройди полосу препятствий до 🏁 финиша. Точки появления по пути — чекпоинты. Кто быстрее — тот выше.',
      params: ['time', 'rounds', 'count', 'respawn', 'min'], def: { time: 300, rounds: 1, count: 3, respawn: 1, min: 1 }, needs: ['spawn', 'finish'] },
    race: { icon: '🏎️', name: 'Гонка', desc: 'Круги по трассе: проедь 🚩 чекпоинты по порядку и пересеки 🏁 финиш. Лучший круг запоминается.',
      params: ['laps', 'time', 'rounds', 'count', 'respawn', 'min'], def: { laps: 3, time: 300, rounds: 1, count: 3, respawn: 1, min: 1 }, needs: ['spawn', 'finish', 'check'] },
    ffa: { icon: '⚔️', name: 'Каждый сам за себя', desc: 'Бей других (F, RT или 👊). Выбил соперника — очко. Можно с жизнями: кто остался последним — победил.',
      params: ['goal', 'time', 'lives', 'dmg', 'respawn', 'rounds', 'count', 'min'], def: { goal: 10, time: 180, lives: 0, dmg: 35, respawn: 3, rounds: 1, count: 3, min: 2 }, needs: ['spawn'] },
    teams: { icon: '🛡️', name: 'Команды', desc: '2–4 команды, у каждой свои точки появления. Своих бить нельзя. Очки команды — сумма побед её игроков.',
      params: ['teams', 'goal', 'time', 'dmg', 'respawn', 'rounds', 'count', 'min'], def: { teams: 2, goal: 20, time: 240, dmg: 35, respawn: 3, rounds: 1, count: 3, min: 2 }, needs: ['tspawn'] },
    koth: { icon: '👑', name: 'Царь горы', desc: 'Стой в 🟩 зоне холма один (или только своей командой) — капают очки. Сталкивай других!',
      params: ['teams', 'goal', 'time', 'dmg', 'respawn', 'rounds', 'count', 'min'], def: { teams: 0, goal: 60, time: 240, dmg: 0, respawn: 2, rounds: 1, count: 3, min: 1 }, needs: ['spawn', 'hill'] },
    hide: { icon: '🙈', name: 'Прятки', desc: 'Одни прячутся, другие ищут. Ищущий нашёл (подбежал вплотную) — найденный тоже ищет. Не нашли до конца времени — прятавшиеся победили.',
      params: ['seekers', 'hide', 'time', 'rounds', 'count', 'min'], def: { seekers: 1, hide: 20, time: 120, rounds: 3, count: 3, min: 2 }, needs: ['spawn'] },
    coins: { icon: '💰', name: 'Сбор монет', desc: 'Собирай 💰 монетки — кто больше. Собранные появляются снова.',
      params: ['goal', 'time', 'coinBack', 'teams', 'rounds', 'count', 'min'], def: { goal: 20, time: 180, coinBack: 10, teams: 0, rounds: 1, count: 3, min: 1 }, needs: ['spawn', 'coin'] },
    survival: { icon: '🧟', name: 'Выживание', desc: 'Волны зомби. Отбивайся (F, RT или 👊) и продержись все волны. Зомби появляются в 🟥 зонах (или вокруг).',
      params: ['waves', 'zombies', 'grow', 'zdmg', 'lives', 'respawn', 'count', 'min'], def: { waves: 5, zombies: 3, grow: 2, zdmg: 15, lives: 3, respawn: 4, count: 3, min: 1, dmg: 35 }, needs: ['spawn', 'zspawn'] },
  };
  const LIST = ['none', 'obby', 'race', 'ffa', 'teams', 'koth', 'hide', 'coins', 'survival'];
  const TEAMS = [null, ['🔴', 'Красные', '#ef4444'], ['🔵', 'Синие', '#3b82f6'], ['🟢', 'Зелёные', '#22c55e'], ['🟡', 'Жёлтые', '#eab308']];
  const PVP = new Set(['ffa', 'teams', 'koth', 'survival']);   // где есть удар
  const TAG_R = 2.2;   // прятки: «нашёл» — ближе этого
  const PLACE = [10, 8, 6, 5, 4, 3, 2, 1];

  // настройки режима: свои значения в пределах PARAMS, остальное — по умолчанию
  function cfg(id, own = {}){
    const M = MODES[id] ? id : 'none', D = MODES[M], out = { mode: M };
    for (const k of Object.keys(PARAMS)) {
      const P = PARAMS[k], d = D.def[k] ?? (P.list ? P.list[0][0] : P.min);
      let v = own && own[k] !== undefined ? +own[k] : d;
      if (!Number.isFinite(v)) v = d;
      if (P.list) v = P.list.some(x => x[0] === v) ? v : d; else v = Math.max(P.min, Math.min(P.max, Math.round(v / (P.step || 1)) * (P.step || 1)));
      out[k] = v;
    }
    if (M === 'teams' && out.teams < 2) out.teams = 2;
    if (!PVP.has(M)) out.dmg = 0;
    if (M !== 'teams' && M !== 'koth' && M !== 'coins') out.teams = 0;
    return out;
  }

  function create(c, hooks = {}){
    c = cfg(c?.mode, c);
    const H = new Proxy(hooks, { get: (t, k) => typeof t[k] === 'function' ? t[k] : () => {} });
    const ps = new Map();   // id → игрок
    const M = { cfg: c, phase: 'wait', t: 0, round: 0, ts: [0, 0, 0, 0, 0], winner: null, wave: 0, waveT: 0, waveOn: false, rev: 0, seekCnt: new Map(), checks: 0, now: 0, pend: false };
    const net = () => hooks.net ? !!hooks.net() : true;   // по сети ждём игроков, один — играем сразу
    const changed = () => { M.rev++; M.pend = true; };
    const list = () => [...ps.values()];
    const alive = p => p && !p.out;
    const team = n => TEAMS[n] ? TEAMS[n][0] + ' ' + TEAMS[n][1] : '';
    const nm = p => p ? p.name : '';
    // fz / bl (заморожен, глаза закрыты) — не сбрасываем: их снимает только freeze()/blind() (иначе игрок остался бы стоять)
    function fresh(p){ Object.assign(p, { score: 0, lap: 0, cp: 0, lapT0: 0, best: 0, fin: 0, place: 0, out: false, lives: c.lives, deaths: 0, kills: 0, lastHit: null }); }
    function newP(id, name){ const p = { id, name: String(name || 'Игрок').slice(0, 24), team: 0, total: 0, wins: 0, role: '', fz: false, bl: false }; fresh(p); return p; }

    // ── команды: поровну, свои остаются ──
    function balance(all){
      if (!c.teams) { for (const p of ps.values()) p.team = 0; return; }
      const cnt = [0, 0, 0, 0, 0];
      for (const p of ps.values()) if (!all && p.team >= 1 && p.team <= c.teams) cnt[p.team]++; else p.team = 0;
      for (const p of ps.values()) if (!p.team) { let best = 1; for (let k = 2; k <= c.teams; k++) if (cnt[k] < cnt[best]) best = k; p.team = best; cnt[best]++; }
    }
    function pickSeekers(){
      const L = list(); for (const p of L) p.role = 'hider';
      const n = Math.max(1, Math.min(c.seekers, L.length - 1));
      L.sort((a, b) => (M.seekCnt.get(a.id) || 0) - (M.seekCnt.get(b.id) || 0) || (a.joinN - b.joinN));
      for (let i = 0; i < n && i < L.length; i++) { L[i].role = 'seeker'; M.seekCnt.set(L[i].id, (M.seekCnt.get(L[i].id) || 0) + 1); }
    }
    let joinN = 0;

    // ── матч и раунды ──
    M.start = () => {
      M.round = 0; M.winner = null;
      for (const p of ps.values()) { p.total = 0; p.wins = 0; }
      M.seekCnt.clear();
      balance(true);
      if (c.mode === 'none') { M.phase = 'play'; M.t = 0; changed(); return; }
      if (!enough()) { M.phase = 'wait'; M.t = 0; changed(); return; }
      nextRound();
    };
    const enough = () => ps.size >= (c.mode === 'hide' ? Math.max(2, c.min) : net() ? c.min : 1);
    function nextRound(){
      M.round++; M.t = 0; M.winner = null; M.ts = [0, 0, 0, 0, 0]; M.wave = 0; M.waveOn = false; M.waveT = 0;
      for (const p of ps.values()) fresh(p);
      if (c.mode === 'hide') pickSeekers(); else for (const p of ps.values()) p.role = '';
      H.clearZombies(); H.resetRound();
      H.spawnAll(list().map(p => ({ id: p.id, team: p.team })));
      if (c.count > 0) { M.phase = 'count'; for (const p of ps.values()) freeze(p, true); }
      else go();
      changed();
    }
    function go(){
      M.phase = 'play'; M.t = 0;
      for (const p of ps.values()) freeze(p, c.mode === 'hide' && p.role === 'seeker');
      for (const p of ps.values()) blind(p, c.mode === 'hide' && p.role === 'seeker');
      for (const p of ps.values()) p.lapT0 = 0;
      H.event('roundStart', { round: M.round, rounds: c.rounds });
      H.say(c.mode === 'hide' ? `🙈 Прячьтесь! Ищущие откроют глаза через ${c.hide} с` : '▶ Старт!');
      if (c.mode === 'survival') M.waveT = 1.5;   // первая волна — сразу после старта
      changed();
    }
    function freeze(p, on){ if (p.fz === !!on) return; p.fz = !!on; H.freeze(p.id, !!on); }
    function blind(p, on){ if (p.bl === !!on) return; p.bl = !!on; H.blind(p.id, !!on); }

    // ── конец раунда: кто победил ──
    function ranking(){
      const L = list();
      if (c.mode === 'obby' || c.mode === 'race') return L.sort((a, b) => (b.fin ? 1 : 0) - (a.fin ? 1 : 0) || (a.fin && b.fin ? a.fin - b.fin : 0) || b.lap - a.lap || b.cp - a.cp || b.score - a.score);
      return L.sort((a, b) => b.score - a.score || (a.out ? 1 : 0) - (b.out ? 1 : 0) || a.deaths - b.deaths);
    }
    M.ranking = ranking;
    M.endRound = (why, win) => {
      if (M.phase !== 'play' && M.phase !== 'count') return;
      let w = null;
      if (win && typeof win === 'object') w = win;
      else if (typeof win === 'string' && ps.has(win)) w = { id: win };
      else if (c.teams && c.mode !== 'hide') {
        let best = 0; for (let k = 1; k <= c.teams; k++) if (M.ts[k] > (M.ts[best] ?? -1) || !best) best = k;
        const tie = [...Array(c.teams).keys()].map(i => i + 1).filter(k => M.ts[k] === M.ts[best]).length > 1;
        w = tie ? { text: '🤝 Ничья' } : { team: best };
      } else if (c.mode === 'hide') {
        const hiders = list().filter(p => p.role === 'hider');
        if (why === 'found' || !hiders.length) w = { side: 'seek', text: '👀 Ищущие нашли всех!' };
        else { for (const p of hiders) p.score += 3; w = { side: 'hide', text: '🙈 Прятавшиеся победили!' }; }
      } else if (c.mode === 'survival') {
        if (why === 'wipe') w = { side: 'z', text: '🧟 Зомби победили…' };
        else { for (const p of list()) if (!p.out) p.score += 5; w = { side: 'p', text: '🏆 Вы выжили!' }; }
      } else {
        const r = ranking()[0];
        if (r && (r.score > 0 || r.fin || (c.lives && !r.out))) w = { id: r.id };
        else w = { text: '🤝 Никто не набрал очков' };
      }
      if (w.id && ps.get(w.id)) ps.get(w.id).wins++;
      if (w.team) for (const p of ps.values()) if (p.team === w.team) p.wins++;
      if (w.side) for (const p of ps.values()) if (w.side === 'seek' ? p.role === 'seeker' : w.side === 'hide' ? p.role === 'hider' : w.side === 'p' && !p.out) p.wins++;   // прятки, выживание — победа стороны
      for (const p of ps.values()) { p.total += Math.round(p.score); freeze(p, true); blind(p, false); }
      w.text = w.text || (w.team ? `🏆 Победили ${team(w.team)}!` : `🏆 Победил ${nm(ps.get(w.id))}!`);
      M.winner = w; M.phase = 'end'; M.t = 0;
      H.clearZombies();
      H.event('roundEnd', { round: M.round, winner: w.id ? nm(ps.get(w.id)) : w.team ? team(w.team) : '', text: w.text, why: String(why || '') });
      H.say(w.text);
      changed();
    };
    function overMatch(){
      const L = list().sort((a, b) => b.wins - a.wins || b.total - a.total);
      let w;
      if (c.rounds <= 1) w = M.winner;
      else if (c.teams && c.mode !== 'hide') { const tw = [0, 0, 0, 0, 0]; for (const p of L) tw[p.team] += p.wins; let b = 1; for (let k = 2; k <= c.teams; k++) if (tw[k] > tw[b]) b = k; w = { team: b, text: `🏆 Матч за командой ${team(b)}!` }; }
      else w = L[0] ? { id: L[0].id, text: `🏆 Матч выиграл ${nm(L[0])}!` } : M.winner;
      M.winner = w; M.phase = 'over'; M.t = 0;
      H.event('matchEnd', { winner: w?.id ? nm(ps.get(w.id)) : w?.team ? team(w.team) : '', text: w?.text || '' });
      changed();
    }

    // ── шаг ──
    M.step = (dt, ctx = {}) => {
      M.now += dt; M.t += dt;
      if (M.phase === 'wait') { if (c.mode !== 'none' && enough()) nextRound(); return; }
      if (M.phase === 'count') { if (M.t >= c.count) go(); return; }
      if (M.phase === 'end') { if (M.t >= 5) { if (M.round < c.rounds) nextRound(); else overMatch(); } return; }
      if (M.phase !== 'play' || c.mode === 'none') return;
      const mode = c.mode;
      if (mode === 'hide') {
        if (M.t >= c.hide && list().some(p => p.role === 'seeker' && p.fz)) { for (const p of ps.values()) { freeze(p, false); blind(p, false); } H.say('👀 Ищем! Подбегай вплотную к прятавшимся'); changed(); }
        if (M.t >= c.hide) for (const [s, h] of ctx.near || []) {
          const S = ps.get(s), P = ps.get(h);
          if (S?.role === 'seeker' && P?.role === 'hider') { P.role = 'seeker'; S.score += 1; H.say(`👀 ${nm(S)} нашёл ${nm(P)}!`); changed(); }
        }
        if (!list().some(p => p.role === 'hider')) { M.endRound('found'); return; }
        if (c.time > 0 && M.t >= c.hide + c.time) { M.endRound('time'); return; }
        return;
      }
      if (mode === 'koth') {
        const inHill = (ctx.hill || []).map(id => ps.get(id)).filter(p => alive(p));
        const owners = new Set(inHill.map(p => c.teams ? 'T' + p.team : p.id));
        if (owners.size === 1 && inHill.length) {
          for (const p of inHill) p.score += dt;
          if (c.teams) M.ts[inHill[0].team] += dt;
          if (Math.floor(M.now * 2) !== Math.floor((M.now - dt) * 2)) changed();
        }
      }
      if (mode === 'survival') {
        const z = ctx.zombies ?? 0;
        if (M.waveOn && z === 0) { M.waveOn = false; if (M.wave >= c.waves) { M.endRound('waves'); return; } M.waveT = 6; H.say(`✅ Волна ${M.wave} отбита! Следующая через 6 с`); changed(); }
        if (!M.waveOn && M.waveT > 0 && (M.waveT -= dt) <= 0) { M.wave++; M.waveOn = true; const n = c.zombies + c.grow * (M.wave - 1); H.zombies(n, M.wave); H.say(`🧟 Волна ${M.wave} из ${c.waves}: ${n} зомби!`); changed(); }
        if (ps.size && list().every(p => p.out)) { M.endRound('wipe'); return; }
      }
      // победа по очкам
      if (c.goal > 0 && (mode === 'ffa' || mode === 'teams' || mode === 'koth' || mode === 'coins')) {
        if (c.teams) { for (let k = 1; k <= c.teams; k++) if (M.ts[k] >= c.goal) { M.endRound('goal', { team: k }); return; } }
        else for (const p of ps.values()) if (p.score >= c.goal) { M.endRound('goal', p.id); return; }
      }
      // последний оставшийся (с жизнями)
      if ((mode === 'ffa' || mode === 'teams') && c.lives > 0 && ps.size >= 2) {
        const left = list().filter(p => !p.out);
        if (c.teams) { const tl = new Set(left.map(p => p.team)); if (tl.size <= 1) { M.endRound('last', tl.size ? { team: [...tl][0] } : null); return; } }
        else if (left.length <= 1) { M.endRound('last', left[0]?.id); return; }
      }
      // все добежали
      if ((mode === 'obby' || mode === 'race') && ps.size && list().every(p => p.fin)) { M.endRound('finish'); return; }
      if (c.time > 0 && M.t >= c.time) M.endRound('time');
    };

    // ── события игры ──
    M.join = (id, name) => {
      if (ps.has(id)) { ps.get(id).name = String(name || ps.get(id).name).slice(0, 24); return ps.get(id); }
      const p = newP(id, name); p.joinN = ++joinN; ps.set(id, p);
      balance(false);
      if (c.mode === 'hide' && M.phase === 'play') p.role = 'seeker';
      if (M.phase === 'count') freeze(p, true);
      if (M.phase === 'end' || M.phase === 'over') freeze(p, true);
      H.say(`👋 ${p.name}${p.team ? ' — в команде ' + team(p.team) : ''}`);
      changed();
      return p;
    };
    M.leave = id => { if (ps.delete(id)) changed(); };
    // свой номер сменился (открыли комнату посреди игры: был 'me', стал номер в комнате)
    M.rename = (a, b) => { const p = ps.get(a); if (!p || a === b || ps.has(b)) return; ps.delete(a); p.id = b; ps.set(b, p); if (M.seekCnt.has(a)) { M.seekCnt.set(b, M.seekCnt.get(a)); M.seekCnt.delete(a); } changed(); };
    M.player = id => ps.get(id) || null;
    M.players = list;
    // касания: true — режим забрал (студия ничего своего не делает)
    M.touch = (id, kind, d = {}) => {
      const p = ps.get(id); if (!p) return false;
      const mode = c.mode;
      if (kind === 'coin' && mode === 'coins') { if (M.phase !== 'play' || p.out) return true; p.score += 1; if (p.team) M.ts[p.team] += 1; H.coinTaken(id, d.oid); changed(); return true; }
      if (kind === 'finish' && (mode === 'obby' || mode === 'race')) {
        if (M.phase !== 'play' || p.fin) return true;
        if (mode === 'race') {
          if (p.cp < M.checks) { if (p.lap || M.t > 2) H.say(`🚩 Сначала чекпоинт ${p.cp + 1} из ${M.checks}`, id); return true; }
          if (M.t - p.lapT0 < 3) return true;   // старт стоит на финише — это не круг
          const lt = M.t - p.lapT0; p.best = p.best ? Math.min(p.best, lt) : lt; p.lap++; p.cp = 0; p.lapT0 = M.t;
          if (p.lap < c.laps) { H.say(`🏁 Круг ${p.lap} из ${c.laps} · ${lt.toFixed(1)} с`, id); changed(); return true; }
        }
        p.fin = Math.max(.01, M.t); p.place = list().filter(x => x.fin).length; p.score = PLACE[p.place - 1] ?? 1;
        H.say(`🏁 ${nm(p)} — ${p.place}-е место · ${p.fin.toFixed(1)} с`);
        changed();
        return true;
      }
      if (kind === 'check' && mode === 'race') {
        if (M.phase === 'play' && !p.fin && d.idx === p.cp) { p.cp++; H.say(`🚩 Чекпоинт ${p.cp} из ${M.checks}`, id); changed(); }
        return true;
      }
      return kind === 'check' || kind === 'hill';
    };
    // удар: кто бьёт, кого. null — нельзя (свой, не игра, мёртв)
    M.hit = (a, b) => {
      const A = ps.get(a), B = ps.get(b);
      if (!A || !B || a === b || M.phase !== 'play' || A.out || B.out || !PVP.has(c.mode) || c.mode === 'survival') return null;
      if (c.teams && A.team === B.team) return null;
      B.lastHit = { by: a, t: M.now };
      return { dmg: c.dmg, knock: 1 };
    };
    // смерть: очко тому, кто бил последним (до 6 с назад); жизни кончились — выбыл
    M.died = id => {
      const p = ps.get(id); if (!p || M.phase !== 'play') return false;
      p.deaths++;
      const lh = p.lastHit && M.now - p.lastHit.t <= 6 ? ps.get(p.lastHit.by) : null;
      p.lastHit = null;
      if (lh && lh !== p && (c.mode === 'ffa' || c.mode === 'teams' || c.mode === 'koth')) {
        lh.kills++; if (c.mode !== 'koth') { lh.score += 1; if (c.teams) M.ts[lh.team] += 1; }
        H.say(`💥 ${nm(lh)} выбил ${nm(p)}`);
      }
      if (c.lives > 0 && (c.mode === 'ffa' || c.mode === 'teams' || c.mode === 'survival')) { p.lives--; if (p.lives <= 0) { p.out = true; H.say(`☠️ ${nm(p)} выбывает`); } }
      changed();
      return p.out;
    };
    M.zombieKilled = id => { const p = ps.get(id); if (!p || M.phase !== 'play') return; p.score += 1; p.kills++; changed(); };
    M.respawnDelay = id => {
      const p = ps.get(id);
      if (p?.out) return { v: Infinity, text: '☠️ Ты выбыл — жди следующий раунд' };
      if (c.mode === 'none') return null;
      return { v: Math.max(.05, c.respawn), text: c.respawn >= 1 ? `💀 Возвращение через ${c.respawn} с` : '💀 Ой!' };
    };
    M.addScore = (id, n) => { const p = ps.get(id); if (!p) return; p.score += +n || 0; if (p.team) M.ts[p.team] += +n || 0; changed(); };
    M.setTeam = (id, n) => { const p = ps.get(id); if (!p || !c.teams) return; p.team = Math.max(1, Math.min(c.teams, n | 0)); changed(); };
    M.setChecks = n => { M.checks = Math.max(0, n | 0); };

    // ── снимок: табло и сеть (коротко) ──
    M.view = () => ({
      m: c.mode, ph: M.phase, t: Math.round(M.t * 10) / 10, r: M.round, rev: M.rev, wave: M.wave, wv: M.waveOn ? 1 : 0, ck: M.checks,
      c: { time: c.time, goal: c.goal, teams: c.teams, laps: c.laps, lives: c.lives, respawn: c.respawn, count: c.count, rounds: c.rounds, hide: c.hide, waves: c.waves, dmg: c.dmg, min: c.min },
      ts: M.ts.map(v => Math.floor(v)),
      ps: ranking().map(p => ({ id: p.id, n: p.name, tm: p.team, s: Math.floor(p.score), S: p.total, w: p.wins, o: p.out ? 1 : 0, ro: p.role, lp: p.lap, cp: p.cp, b: Math.round(p.best * 10) / 10, f: Math.round(p.fin * 10) / 10, lv: p.lives, fz: p.fz ? 1 : 0, bl: p.bl ? 1 : 0, k: p.kills })),
      w: M.winner ? { ...M.winner } : null,
    });
    // новый хозяин комнаты продолжает с последнего снимка
    M.restore = v => {
      if (!v || v.m !== c.mode || !Array.isArray(v.ps)) return false;
      M.phase = ['wait', 'count', 'play', 'end', 'over'].includes(v.ph) ? v.ph : 'wait'; M.t = +v.t || 0; M.round = v.r | 0; M.wave = v.wave | 0; M.waveOn = !!v.wv;
      M.ts = Array.isArray(v.ts) ? v.ts.map(x => +x || 0) : M.ts; M.winner = v.w || null;
      for (const q of v.ps) { const p = ps.get(q.id) || newP(q.id, q.n); Object.assign(p, { team: q.tm | 0, score: +q.s || 0, total: +q.S || 0, wins: q.w | 0, out: !!q.o, role: q.ro || '', lap: q.lp | 0, cp: q.cp | 0, best: +q.b || 0, fin: +q.f || 0, lives: q.lv ?? c.lives, fz: !!q.fz, bl: !!q.bl, kills: q.k | 0 }); ps.set(q.id, p); }
      changed();
      return true;
    };
    M.take = () => { const p = M.pend; M.pend = false; return p; };   // было ли изменение с прошлого раза
    return M;
  }

  E.modes = { LIST, MODES, PARAMS, TEAMS, PVP, TAG_R, cfg, create };
})();
