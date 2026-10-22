// ═══════════════════════════════════════
//  D37E.quests — книга заданий для любой игры (T-049, docs/plans/kubomir-modpacks.md §4.10; общий модуль §3.3: «Кубомир» —
//  «Дорожная книга», потом «Подземье» (цели → главы), «Мир Денчика», деталь «Задание» в «Студии 3D»). Без DOM и Three.js
// ═══════════════════════════════════════
// Данные (JSON; так же — quests[] в mod.json): { chapters: [{ id, title, icon, order, quests: [{ id, title, text, icon, needs: [ид],
//   hidden, tasks: [{ t, item | block | mob | biome | id, n }], rewards: [{ t: 'item', id, n } | { t: 'unlock', id } | { t: 'title', id }] }] }] }
// Задачи: have (столько в вещах), craft, smelt, break, place, kill, eat, use, sleep, visit (биом), reach (дальше N от начала мира),
//   depth (ниже Y), days, ach (достижение игры), check (отметить самому). Награды — ТОЛЬКО вещи в мире, «открыть», титул, облик:
//   монеты, XP, кристаллы валидатор выкидывает (красные линии сайта: награды — в пределах лимитов сервера, задания их не дают).
//   Q = D37E.quests.create({ data, state, have(вещь) → сколько, val(задача) → число (reach, depth, days), match(ключ, ид) → bool,
//     onDone(q), log }) — state — объект игрока (сохраняется: { s: { ид: { p: [..], d, c } }, pins: [] })
//   Q.event(тип, a, b) — событие игры (тип как у задач; craft/smelt/pickup: a — вещь, b — сколько; break/place: a — блок; kill: a — моб…)
//   Q.refresh() — пересчитать «have / reach / depth / days» (после вещей — не чаще, чем зовут)
//   Q.status(ид) → 'hidden' | 'locked' | 'open' | 'done' | 'claimed'; Q.progress(ид) → [[сколько, надо, задача]]; Q.claim(ид) → награды | null
//   Q.pin(ид) / Q.unpin(ид) (до 3), Q.pins; Q.chapterDone(ид); Q.stats(); D37E.quests.validate(data) → { ok, errors, data } (чистый)
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const TASKS = new Set(['have', 'craft', 'smelt', 'break', 'place', 'kill', 'eat', 'use', 'sleep', 'visit', 'reach', 'depth', 'days', 'ach', 'check']);
  const REWARDS = new Set(['item', 'unlock', 'title', 'cosmetic']);
  const BANNED = /^(coin|coins|xp|exp|gem|gems|crystal|money|premium|vip)$/i;
  const LIM = { quests: 200, text: 400, title: 60, tasks: 6, rewards: 6, chapters: 40 };
  const ID = /^[a-z0-9][a-z0-9_:\-]{0,47}$/;
  const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';

  // ── проверка данных: что можно, без циклов в «needs», без монет и XP в наградах ──
  function validate(data){
    const errors = [], out = { chapters: [] }, seen = new Set();
    const err = t => { if (errors.length < 60) errors.push(t); };
    const chs = Array.isArray(data?.chapters) ? data.chapters.slice(0, LIM.chapters) : [];
    let total = 0;
    for (const c of chs) {
      if (!c || !ID.test(c.id)) { err('глава без id'); continue; }
      const ch = { id: c.id, title: str(c.title, LIM.title) || c.id, icon: str(c.icon, 16), order: +c.order || 0, quests: [] };
      for (const q of Array.isArray(c.quests) ? c.quests : []) {
        if (++total > LIM.quests) { err('заданий больше ' + LIM.quests); break; }
        if (!q || !ID.test(q.id) || seen.has(q.id)) { err('задание без id или повтор: ' + (q && q.id)); continue; }
        seen.add(q.id);
        const tasks = [];
        for (const t of (Array.isArray(q.tasks) ? q.tasks : []).slice(0, LIM.tasks)) {
          if (!t || !TASKS.has(t.t)) { err(q.id + ': неизвестная задача ' + (t && t.t)); continue; }
          tasks.push({ t: t.t, item: str(t.item, 64), block: str(t.block, 64), mob: str(t.mob, 32), biome: str(t.biome, 32), id: str(t.id, 48), n: Math.max(1, Math.min(100000, +t.n || 1)) });
        }
        if (!tasks.length) { err(q.id + ': нет задач'); continue; }
        const rewards = [];
        for (const r of (Array.isArray(q.rewards) ? q.rewards : []).slice(0, LIM.rewards)) {
          if (!r || BANNED.test(String(r.t || '')) || BANNED.test(String(r.id || ''))) { err(q.id + ': награда монетами, XP или кристаллами — нельзя'); continue; }
          if (!REWARDS.has(r.t)) { err(q.id + ': неизвестная награда ' + r.t); continue; }
          rewards.push({ t: r.t, id: str(r.id, 64), n: Math.max(1, Math.min(64, +r.n || 1)) });
        }
        ch.quests.push({ id: q.id, chapter: ch.id, title: str(q.title, LIM.title) || q.id, text: str(q.text, LIM.text), icon: str(q.icon, 64), needs: (Array.isArray(q.needs) ? q.needs : []).filter(x => typeof x === 'string').slice(0, 8), hidden: !!q.hidden, tasks, rewards });
      }
      out.chapters.push(ch);
    }
    out.chapters.sort((a, b) => a.order - b.order);
    // зависимости: только известные, без циклов (иначе задание никогда не откроется — снять зависимость)
    const all = new Map(); for (const ch of out.chapters) for (const q of ch.quests) all.set(q.id, q);
    for (const q of all.values()) q.needs = q.needs.filter(n => { if (all.has(n)) return true; err(q.id + ': нет задания ' + n); return false; });
    const state = new Map();
    const visit = q => { const s = state.get(q.id); if (s === 1) return true; if (s === 2) return false; state.set(q.id, 1); for (const n of q.needs.slice()) if (visit(all.get(n))) { err(q.id + ': по кругу через ' + n); q.needs.splice(q.needs.indexOf(n), 1); } state.set(q.id, 2); return false; };
    for (const q of all.values()) visit(q);
    return { ok: !errors.length, errors, data: out };
  }

  function create(o = {}){
    const v = validate(o.data || {}), D = v.data, S = o.state && typeof o.state === 'object' ? o.state : {};
    if (!S.s || typeof S.s !== 'object') S.s = {};
    if (!Array.isArray(S.pins)) S.pins = [];
    const all = new Map(), byType = new Map(), have = typeof o.have === 'function' ? o.have : () => 0, val = typeof o.val === 'function' ? o.val : () => 0;
    const match = typeof o.match === 'function' ? o.match : (k, id) => k === id;
    for (const ch of D.chapters) for (const q of ch.quests) {
      all.set(q.id, q);
      q.tasks.forEach((t, i) => { let L = byType.get(t.t); if (!L) byType.set(t.t, L = []); L.push({ q, i, t }); });
    }
    const rec = id => { let r = S.s[id]; if (!r || typeof r !== 'object' || !Array.isArray(r.p)) r = S.s[id] = { p: [] }; return r; };
    const Q = { data: D, errors: v.errors, all, state: S, rev: 1 };
    Q.status = id => {
      const q = all.get(id); if (!q) return 'locked';
      const r = S.s[id];
      if (r && r.c) return 'claimed';
      if (r && r.d) return 'done';
      const open = q.needs.every(n => { const s = S.s[n]; return s && (s.d || s.c); });
      return open ? 'open' : q.hidden ? 'hidden' : 'locked';
    };
    Q.progress = id => { const q = all.get(id); if (!q) return []; const r = S.s[id] || { p: [] }; return q.tasks.map((t, i) => [Math.min(t.n, r.p[i] | 0), t.n, t]); };
    // задача засчитана? все задачи — задание сделано (onDone — подсказка игроку; награду забирает сам)
    function check(q){
      const r0 = S.s[q.id]; if (r0 && (r0.d || r0.c)) return;
      if (!q.needs.every(n => { const s = S.s[n]; return s && (s.d || s.c); })) return;   // закрыто — не засчитывать
      const r = rec(q.id);
      for (let i = 0; i < q.tasks.length; i++) if ((r.p[i] | 0) < q.tasks[i].n) return;
      r.d = 1; Q.rev++;
      try { o.onDone?.(q); } catch (e) {}
      // кто ждал это задание — проверить (у «have» могло быть уже всё)
      for (const q2 of all.values()) if (q2.needs.includes(q.id)) check(q2);
    }
    const openNow = q => Q.status(q.id) === 'open';
    // ── события: только задачи этого типа (без перебора всего) ──
    Q.event = (type, a, b) => {
      const L = byType.get(type); if (!L) return;
      for (let k = 0; k < L.length; k++) {
        const { q, i, t } = L[k];
        if (!openNow(q)) continue;
        let ok = false, add = 1;
        if (type === 'break' || type === 'place') ok = match(t.block || t.item, a);
        else if (type === 'craft' || type === 'smelt' || type === 'eat' || type === 'use') { ok = !t.item || match(t.item, a); add = type === 'craft' || type === 'smelt' ? Math.max(1, b | 0) : 1; }
        else if (type === 'kill') ok = !t.mob || t.mob === a;
        else if (type === 'visit') ok = t.biome === a;
        else if (type === 'ach') ok = t.id === a;
        else if (type === 'sleep' || type === 'check') ok = true;
        if (!ok) continue;
        const r = rec(q.id), cur = r.p[i] | 0;
        if (type === 'visit' || type === 'ach') r.p[i] = t.n; else r.p[i] = Math.min(t.n, cur + add);
        if (r.p[i] !== cur) { Q.rev++; check(q); }
      }
    };
    // «have» (в вещах), «reach» / «depth» / «days» — по значению сейчас (не убывает: однажды сделал — засчитано)
    Q.refresh = () => {
      for (const type of ['have', 'reach', 'depth', 'days']) {
        const L = byType.get(type); if (!L) continue;
        for (const { q, i, t } of L) {
          if (!openNow(q)) continue;
          const n = type === 'have' ? have(t.item) : val(t);
          const r = rec(q.id), cur = r.p[i] | 0, nv = Math.min(t.n, Math.max(cur, n | 0));
          if (nv !== cur) { r.p[i] = nv; Q.rev++; check(q); }
        }
      }
    };
    Q.claim = id => {
      const q = all.get(id); if (!q || Q.status(id) !== 'done') return null;
      rec(id).c = 1; Q.rev++;
      Q.unpin(id);
      return q.rewards;
    };
    Q.pin = id => { if (!all.has(id) || S.pins.includes(id)) return false; if (S.pins.length >= 3) S.pins.shift(); S.pins.push(id); Q.rev++; return true; };
    Q.unpin = id => { const i = S.pins.indexOf(id); if (i < 0) return false; S.pins.splice(i, 1); Q.rev++; return true; };
    Q.chapterDone = cid => { const ch = D.chapters.find(c => c.id === cid); return !!ch && ch.quests.every(q => { const s = Q.status(q.id); return s === 'done' || s === 'claimed'; }); };
    Q.chapterCount = cid => { const ch = D.chapters.find(c => c.id === cid); if (!ch) return [0, 0]; let n = 0; for (const q of ch.quests) { const s = Q.status(q.id); if (s === 'done' || s === 'claimed') n++; } return [n, ch.quests.length]; };
    // первое невыполненное открытое задание (подсказка «что дальше»): сначала закреплённые
    Q.next = () => { for (const id of S.pins) if (Q.status(id) === 'open') return all.get(id); for (const ch of D.chapters) for (const q of ch.quests) if (Q.status(q.id) === 'open') return q; return null; };
    Q.stats = () => { let done = 0, claimed = 0; for (const id of all.keys()) { const s = Q.status(id); if (s === 'done') done++; else if (s === 'claimed') claimed++; } return { quests: all.size, done, claimed, chapters: D.chapters.length }; };
    // сразу — задания, у которых уже всё есть (старый мир, творчество)
    for (const q of all.values()) check(q);
    return Q;
  }
  E.quests = { create, validate, TASKS, REWARDS };
})();
