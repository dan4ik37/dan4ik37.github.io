// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — скрипты в объектах (как Script в Roblox), язык — JavaScript с привычными именами Roblox:
//  script.Parent, part.Touched.Connect, TweenService, Instance.new, task.wait, Players, leaderstats…
// ═══════════════════════════════════════
// Безопасность: код игроков работает в отдельном потоке (Worker) внутри песочницы (iframe sandbox="allow-scripts"
// + CSP без сети): ни сайта, ни аккаунта, ни сети он не видит; завис (бесконечный цикл) — поток убивается, сайт живёт.
// С миром скрипт общается сообщениями: читает копию свойств, а меняет командами (set/new/destroy/tween…), которые
// хозяин мира проверяет и применяет. SH = D37E.scripts(host) → SH.start(scene, players) / SH.event(…) / SH.tick(dt) / SH.stop().
// host: { apply(cmd) — команда из скрипта, print(text, kind), error(script, line, msg), hang() }.
// Языки: у скрипта obj.lang ('js' по умолчанию). Другие языки — файлы js/engine/lang-*.js: D37E.lang(id, { label, short,
// icon, kind: 'text' | 'binary' (код — base64, например .wasm), worker() — функция, которая работает ВНУТРИ песочницы и
// регистрирует globalThis.D37Lang[id] = { run(code, env, ctx) }, examples: [[название, код]], ai: «задание для ИИ», placeholder }).
// env — те же имена, что у JavaScript (script, game, workspace, Instance, Vector3, …); ctx — служебное: name, error(msg, line),
// err(e), signal, proxyOf, playerOf, objs, players, send. Код языка уходит в песочницу текстом (worker.toString()).
// Двоичный язык может уметь собираться прямо на сайте: compile(src, { name, onStep }) → Promise<Uint8Array | { wasm, log }>
// (кнопка «⚙️ Собрать» в студии; исходник — obj.src, результат — base64 в obj.code; ошибка — throw с .log).
(() => {
  const E = window.D37E = window.D37E || {};

  // ═══ То, что работает внутри песочницы (Worker). Ничего снаружи эта функция не видит ═══
  function runtime(){
    'use strict';
    const objs = new Map();   // id → { id, cls, parent, children: [], p: {свойства} }
    const H = { touched: new Map(), touchEnded: new Map(), clicked: new Map(), prompt: new Map(), heartbeat: new Set(), playerAdded: new Set(), playerRemoving: new Set(), died: new Set() };
    const tweens = new Map(), players = new Map();
    let seq = 0, curScript = '';
    const send = (t, d) => postMessage(Object.assign({ t }, d));
    const lineOf = st => { st = String(st || ''); const m = /\), <anonymous>:(\d+):\d+/.exec(st) || /> Function:(\d+):\d+/.exec(st) || /<anonymous>:(\d+):\d+/.exec(st); return m ? +m[1] : 0; };
    const err = (where, e) => {
      const m = String(e && e.message || e);
      const ln = lineOf(e && e.stack);
      send('error', { script: where || curScript, line: ln && LINE0 ? Math.max(0, ln - LINE0) : 0, msg: m.slice(0, 300) });
    };
    // ── Типы ──
    class Vector3 {
      constructor(x = 0, y = 0, z = 0){ this.X = +x || 0; this.Y = +y || 0; this.Z = +z || 0; }
      get x(){ return this.X; } get y(){ return this.Y; } get z(){ return this.Z; }
      add(o){ return new Vector3(this.X + o.X, this.Y + o.Y, this.Z + o.Z); } sub(o){ return new Vector3(this.X - o.X, this.Y - o.Y, this.Z - o.Z); }
      mul(k){ return typeof k === 'number' ? new Vector3(this.X * k, this.Y * k, this.Z * k) : new Vector3(this.X * k.X, this.Y * k.Y, this.Z * k.Z); }
      get Magnitude(){ return Math.hypot(this.X, this.Y, this.Z); }
      get Unit(){ const m = this.Magnitude || 1; return new Vector3(this.X / m, this.Y / m, this.Z / m); }
      Lerp(o, a){ return new Vector3(this.X + (o.X - this.X) * a, this.Y + (o.Y - this.Y) * a, this.Z + (o.Z - this.Z) * a); }
      toString(){ return `${this.X.toFixed(2)}, ${this.Y.toFixed(2)}, ${this.Z.toFixed(2)}`; }
      static new(x, y, z){ return new Vector3(x, y, z); }
    }
    Vector3.zero = new Vector3(0, 0, 0); Vector3.one = new Vector3(1, 1, 1);
    const V = a => new Vector3(a[0], a[1], a[2]), A = v => v instanceof Vector3 ? [v.X, v.Y, v.Z] : Array.isArray(v) ? v.slice(0, 3).map(Number) : null;
    const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    const Color3 = {
      fromRGB: (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b),
      new: (r, g, b) => '#' + hex2(r * 255) + hex2(g * 255) + hex2(b * 255),
      fromHex: h => (/^#?[0-9a-f]{6}$/i.test(h) ? '#' + h.replace('#', '') : '#ffffff').toLowerCase(),
      fromHSV: (h, s, v) => { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return Color3.new(f(5), f(3), f(1)); },
    };
    const Enum = { Material: { Plastic: 'plastic', SmoothPlastic: 'smooth', Neon: 'neon', Glass: 'glass', Metal: 'metal', DiamondPlate: 'diamond', Wood: 'wood', WoodPlanks: 'planks', Brick: 'brick', Concrete: 'concrete', Cobblestone: 'cobble', Asphalt: 'asphalt', Grass: 'grass', Sand: 'sand', Rock: 'rock', Ground: 'dirt', Snow: 'snow', Ice: 'ice', Marble: 'marble', Fabric: 'fabric', Tiles: 'tiles' },
      PartType: { Block: 'block', Ball: 'ball', Cylinder: 'cyl', Wedge: 'wedge' }, EasingStyle: { Linear: 'linear', Quad: 'quad', Sine: 'sine', Back: 'back', Bounce: 'bounce', Elastic: 'elastic' } };
    // ── События ──
    function signal(reg){
      const list = new Set();
      return {
        Connect(fn){ if (typeof fn !== 'function') throw new Error('Connect: нужна функция'); const w = { fn, s: curScript }; list.add(w); reg && reg(true, list.size); return { Disconnect(){ list.delete(w); reg && reg(false, list.size); }, get Connected(){ return list.has(w); } }; },
        Wait(){ return new Promise(res => { const c = this.Connect((...a) => { c.Disconnect(); res(a[0]); }); }); },
        _fire(...a){ for (const w of [...list]) { const prev = curScript; curScript = w.s; try { const r = w.fn(...a); if (r && r.catch) r.catch(e => err(w.s, e)); } catch (e) { err(w.s, e); } curScript = prev; } },
        _size: () => list.size,
      };
    }
    const evOf = (map, id, want) => { if (!map.has(id)) map.set(id, signal((on, n) => send('want', { ev: want, id, on: n > 0 }))); return map.get(id); };
    // ── Объекты мира: прокси к копии свойств; изменения — командами хозяину ──
    const PROPS = { Position: 'pos', Size: 'size', Orientation: 'rot', Color: 'color', Material: 'mat', Transparency: 'alpha', CanCollide: 'collide', Anchored: 'anchored', CastShadow: 'shadow', Shape: 'shape', Text: 'text', Range: 'range', Brightness: 'power', Name: 'name' };
    const VEC = new Set(['pos', 'size', 'rot']);
    const prox = new Map();
    function proxyOf(id){
      if (!id) return null;
      if (prox.has(id)) return prox.get(id);
      const self = {
        get Name(){ return objs.get(id)?.p.name; }, set Name(v){ set(id, 'name', String(v).slice(0, 40)); },
        get ClassName(){ return objs.get(id)?.cls; }, IsA(c){ const k = objs.get(id)?.cls; return c === k || c === 'Instance' || (c === 'BasePart' && (k === 'Part' || k === 'Spawn')); },
        get Parent(){ const o = objs.get(id); return o ? (o.parent ? proxyOf(o.parent) : workspace) : null; },
        set Parent(v){ if (v === null || v === undefined) { this.Destroy(); return; } const pid = v === workspace ? null : v && v.__id; if (pid === id) return; const o = objs.get(id); if (!o) return; if (o.parent) objs.get(o.parent).children = objs.get(o.parent).children.filter(c => c !== id); o.parent = pid; if (pid) objs.get(pid).children.push(id); send('parent', { id, parent: pid }); },
        get __id(){ return id; },
        GetChildren(){ return (objs.get(id)?.children || []).map(proxyOf); },
        GetDescendants(){ const out = []; const walk = i => { for (const c of objs.get(i)?.children || []) { out.push(proxyOf(c)); walk(c); } }; walk(id); return out; },
        FindFirstChild(name, rec){ return findIn(objs.get(id)?.children || [], name, rec); },
        WaitForChild(name){ return Promise.resolve(this.FindFirstChild(name)); },
        Destroy(){ destroy(id); }, Remove(){ destroy(id); },
        Clone(){ return cloneTree(id); },
        GetAttribute(k){ return (objs.get(id)?.p.attrs || {})[k]; },
        SetAttribute(k, v){ const o = objs.get(id); if (!o) return; o.p.attrs = Object.assign({}, o.p.attrs, { [k]: v }); send('set', { id, k: 'attrs', v: o.p.attrs }); },
        get Touched(){ return evOf(H.touched, id, 'touched'); }, get TouchEnded(){ return evOf(H.touchEnded, id, 'touchEnded'); },
        get Clicked(){ return evOf(H.clicked, id, 'clicked'); }, get MouseClick(){ return this.Clicked; },
        Prompt(text = 'Нажать', hold = 0){ const s = evOf(H.prompt, id, 'prompt'); send('prompt', { id, text: String(text).slice(0, 40), hold: Math.max(0, Math.min(10, +hold || 0)) }); return { Triggered: s }; },
        MoveTo(v){ set(id, 'pos', A(v)); },
        toString(){ return objs.get(id)?.p.name || id; },
      };
      const p = new Proxy(self, {
        get(t, k){
          if (k in t) return t[k];
          const key = PROPS[k];
          if (key) { const v = objs.get(id)?.p[key]; return VEC.has(key) && v ? V(v) : v; }
          if (typeof k === 'string') { const c = (objs.get(id)?.children || []).find(cid => objs.get(cid)?.p.name === k); if (c) return proxyOf(c); }
          return undefined;
        },
        set(t, k, v){
          if (k === 'Name' || k === 'Parent') { t[k] = v; return true; }
          const key = PROPS[k];
          if (!key) throw new Error('Нельзя менять свойство ' + String(k));
          set(id, key, VEC.has(key) ? A(v) : v);
          return true;
        },
      });
      prox.set(id, p);
      return p;
    }
    function findIn(ids, name, rec){
      for (const c of ids) { if (objs.get(c)?.p.name === name) return proxyOf(c); }
      if (rec) for (const c of ids) { const r = findIn(objs.get(c)?.children || [], name, true); if (r) return r; }
      return null;
    }
    function set(id, k, v){
      const o = objs.get(id); if (!o) return;
      if (VEC.has(k)) { if (!Array.isArray(v) || v.some(n => !isFinite(n))) throw new Error('Нужен Vector3'); }
      if (k === 'color' && !/^#[0-9a-f]{6}$/i.test(String(v))) throw new Error('Цвет: Color3.fromRGB(r, g, b) или "#rrggbb"');
      if (k === 'alpha') v = Math.max(0, Math.min(1, +v || 0));
      o.p[k] = v;
      send('set', { id, k, v });
    }
    function destroy(id){
      const o = objs.get(id); if (!o) return;
      for (const c of o.children.slice()) destroy(c);
      if (o.parent && objs.get(o.parent)) objs.get(o.parent).children = objs.get(o.parent).children.filter(c => c !== id);
      objs.delete(id); prox.delete(id);
      for (const k of ['touched', 'touchEnded', 'clicked', 'prompt']) H[k].delete(id);
      send('destroy', { id });
    }
    function newId(){ return 'w' + (++seq).toString(36) + Math.random().toString(36).slice(2, 5); }
    function cloneTree(id){
      const map = {}, walk = (src, parent) => {
        const o = objs.get(src); if (!o) return null;
        const nid = newId(); map[src] = nid;
        objs.set(nid, { id: nid, cls: o.cls, parent, children: [], p: JSON.parse(JSON.stringify(o.p)) });
        if (parent) objs.get(parent).children.push(nid);
        for (const c of o.children) walk(c, nid);
        return nid;
      };
      const root = walk(id, objs.get(id)?.parent || null);
      send('clone', { src: id, map });
      return proxyOf(root);
    }
    const Instance = {
      new(cls, parent){
        const C = { Part: 'Part', WedgePart: 'Part', SpawnLocation: 'Spawn', PointLight: 'Light', Model: 'Model', Folder: 'Model' }[cls];
        if (!C) throw new Error('Instance.new: ' + cls + ' — есть Part, WedgePart, SpawnLocation, PointLight, Model');
        const id = newId(), p = { name: cls === 'WedgePart' ? 'Клин' : cls, ...(C === 'Part' ? { shape: cls === 'WedgePart' ? 'wedge' : 'block', pos: [0, 5, 0], rot: [0, 0, 0], size: [4, 1, 2], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true } : C === 'Light' ? { pos: [0, 4, 0], color: '#fff1c4', range: 18, power: 2 } : {}) };
        const pid = parent && parent !== workspace ? parent.__id : null;
        objs.set(id, { id, cls: C, parent: pid, children: [], p });
        if (pid && objs.get(pid)) objs.get(pid).children.push(id);
        send('new', { id, cls: C, props: p, parent: pid });
        return proxyOf(id);
      },
    };
    const workspace = new Proxy({
      Name: 'Workspace', ClassName: 'Workspace',
      GetChildren(){ return [...objs.values()].filter(o => !o.parent).map(o => proxyOf(o.id)); },
      GetDescendants(){ return [...objs.keys()].map(proxyOf); },
      FindFirstChild(name, rec){ return findIn([...objs.values()].filter(o => !o.parent).map(o => o.id), name, rec); },
      WaitForChild(name){ return Promise.resolve(this.FindFirstChild(name, true)); },
    }, { get(t, k){ if (k in t) return t[k]; if (typeof k === 'string') return t.FindFirstChild(k); } });
    // ── Игроки ──
    function playerOf(pid){
      const P = players.get(pid); if (!P) return null;
      if (P.proxy) return P.proxy;
      const cmd = (c, v) => send('player', { pid, cmd: c, v });
      P.stats = P.stats || {};
      const ls = new Proxy({}, { get(t, k){ return typeof k === 'string' ? { get Value(){ return P.stats[k] ?? 0; }, set Value(v){ P.stats[k] = v; cmd('stat', { k, v }); }, Name: k } : undefined; } });
      P.proxy = {
        get Name(){ return P.name; }, get UserId(){ return pid; }, get DisplayName(){ return P.name; },
        get Position(){ return V(P.pos || [0, 0, 0]); },
        get Character(){ return { get Position(){ return V(P.pos || [0, 0, 0]); }, set Position(v){ cmd('teleport', A(v)); }, Humanoid: P.proxy.Humanoid, PivotTo(v){ cmd('teleport', A(v)); } }; },
        Humanoid: {
          get WalkSpeed(){ return P.walk ?? 16; }, set WalkSpeed(v){ P.walk = Math.max(0, Math.min(100, +v || 0)); cmd('walk', P.walk); },
          get JumpPower(){ return P.jump ?? 50; }, set JumpPower(v){ P.jump = Math.max(0, Math.min(200, +v || 0)); cmd('jump', P.jump); },
          get Health(){ return P.health ?? 100; }, set Health(v){ P.health = Math.max(0, Math.min(P.maxHealth ?? 100, +v || 0)); cmd('health', P.health); },
          get MaxHealth(){ return P.maxHealth ?? 100; }, set MaxHealth(v){ P.maxHealth = Math.max(1, +v || 100); cmd('maxHealth', P.maxHealth); },
          TakeDamage(n){ this.Health = (P.health ?? 100) - Math.max(0, +n || 0); },
          get Died(){ return P.died || (P.died = signal()); },
        },
        leaderstats: ls,
        SetStat(k, v){ ls[k].Value = v; }, GetStat(k){ return ls[k].Value; }, AddStat(k, d){ ls[k].Value = (+ls[k].Value || 0) + (+d || 0); },
        Kill(){ this.Humanoid.Health = 0; }, LoadCharacter(){ cmd('respawn'); },
        Teleport(v){ cmd('teleport', A(v)); },
        Message(text, sec){ cmd('message', { text: String(text).slice(0, 140), sec: +sec || 3 }); },
      };
      return P.proxy;
    }
    const Players = {
      PlayerAdded: signal(), PlayerRemoving: signal(),
      GetPlayers(){ return [...players.keys()].map(playerOf); },
      GetPlayerFromCharacter(c){ return c && c.__player ? playerOf(c.__player) : null; },
      get LocalPlayer(){ return playerOf([...players.keys()][0]); },
    };
    // ── Сервисы ──
    const RunService = { Heartbeat: signal((on, n) => send('want', { ev: 'heartbeat', on: n > 0 })), get Stepped(){ return this.Heartbeat; } };
    const TweenService = {
      Create(inst, info = {}, goals = {}){
        const id = inst && inst.__id; if (!id) throw new Error('TweenService.Create: нужен объект');
        const tid = newId(), g = {};
        for (const [k, v] of Object.entries(goals)) { const key = PROPS[k]; if (!key) continue; g[key] = VEC.has(key) ? A(v) : v; }
        const Completed = signal();
        const tw = { tid, Completed, Play(){ send('tween', { tid, id, goals: g, time: Math.max(0, +(typeof info === 'number' ? info : info.Time) || 1), ease: (info && info.EasingStyle) || 'quad', reverses: !!(info && info.Reverses), repeat: Math.max(-1, Math.min(1000, +(info && info.RepeatCount) || 0)), delay: Math.max(0, +(info && info.DelayTime) || 0) }); tweens.set(tid, tw); return tw; }, Cancel(){ send('tweenCancel', { tid }); tweens.delete(tid); }, Pause(){ this.Cancel(); } };
        return tw;
      },
    };
    const TweenInfo = { new: (Time = 1, EasingStyle = 'quad', _dir, RepeatCount = 0, Reverses = false, DelayTime = 0) => ({ Time, EasingStyle, RepeatCount, Reverses, DelayTime }) };
    const wait = s => new Promise(res => { const t0 = Date.now(); setTimeout(() => res((Date.now() - t0) / 1000), Math.max(0, (+s || 0.03) * 1000)); });
    const task = { wait, spawn(fn, ...a){ setTimeout(() => { try { const r = fn(...a); if (r && r.catch) r.catch(e => err('', e)); } catch (e) { err('', e); } }, 0); }, delay(s, fn, ...a){ setTimeout(() => { try { fn(...a); } catch (e) { err('', e); } }, (+s || 0) * 1000); } };
    const Debris = { AddItem(inst, s){ setTimeout(() => inst && inst.Destroy && inst.Destroy(), Math.max(0, (+s || 0) * 1000)); } };
    const print = (...a) => send('print', { text: a.map(x => typeof x === 'object' ? (x && x.toString !== Object.prototype.toString ? String(x) : JSON.stringify(x)) : String(x)).join(' ').slice(0, 500), kind: 'log' });
    const warn = (...a) => send('print', { text: a.map(String).join(' ').slice(0, 500), kind: 'warn' });
    const gui = { message: (text, sec) => send('gui', { cmd: 'message', text: String(text).slice(0, 140), sec: +sec || 3 }), text: (key, text) => send('gui', { cmd: 'text', key: String(key).slice(0, 30), text: String(text).slice(0, 120) }), clear: key => send('gui', { cmd: 'clear', key: String(key).slice(0, 30) }) };
    const sound = { play: (name, at) => send('sound', { name: String(name).slice(0, 30), pos: at && at.__id ? objs.get(at.__id)?.p.pos : A(at) }) };
    const random = (a, b) => b === undefined ? (a === undefined ? Math.random() : Math.floor(Math.random() * a) + 1) : Math.floor(Math.random() * (b - a + 1)) + a;
    const game = { Workspace: workspace, Players, GetService: n => ({ Players, RunService, TweenService, Workspace: workspace, Debris })[n] || null, get workspace(){ return workspace; } };
    let LINE0 = 0;
    // ── Сообщения от хозяина мира ──
    onmessage = e => {
      const d = e.data || {};
      if (d.t === 'ping') { postMessage({ t: 'pong' }); return; }
      if (d.t === 'init') {
        for (const o of d.objs) objs.set(o.id, { id: o.id, cls: o.cls, parent: o.parent || null, children: [], p: o.p });
        for (const o of objs.values()) if (o.parent && objs.get(o.parent)) objs.get(o.parent).children.push(o.id);
        for (const p of d.players || []) players.set(p.id, p);
        // смещение строк: первая строка кода игрока
        try { new Function('throw new Error("x")')(); } catch (e2) { LINE0 = lineOf(e2.stack); }
        // библиотеки языков (lang-*.js) приходят текстом — регистрируются в globalThis.D37Lang
        globalThis.D37Lang = globalThis.D37Lang || {};
        for (const id of Object.keys(d.libs || {})) { try { (0, eval)(d.libs[id]); } catch (e5) { send('error', { script: '', line: 0, msg: 'Язык ' + id + ': ' + String(e5 && e5.message || e5).slice(0, 200) }); } }
        const API = { game, workspace, Instance, Vector3, Color3, Enum, TweenService, TweenInfo, RunService, Players, Debris, task, wait, print, warn, gui, sound, random };
        for (const s of d.scripts) {
          curScript = s.name;
          if (s.lang && s.lang !== 'js') {
            const L = globalThis.D37Lang[s.lang], nm = s.name;
            if (!L || typeof L.run !== 'function') { err(nm, new Error('Язык «' + s.lang + '» не загрузился')); continue; }
            const scr = { Name: s.name, Parent: s.parent ? proxyOf(s.parent) : workspace, ClassName: 'Script' };
            const ctx = { name: nm, error: (msg, line) => send('error', { script: nm, line: Math.max(0, line | 0), msg: String(msg).slice(0, 300) }), err: e => err(nm, e),
              signal, proxyOf, playerOf, objs, players, send, setCurrent: n => { curScript = n; } };
            try { const r = L.run(s.code, Object.assign({ script: scr }, API), ctx); if (r && r.catch) r.catch(e6 => err(nm, e6)); } catch (e7) { err(nm, e7); }
            continue;
          }
          try {
            const fn = new Function('script', 'game', 'workspace', 'Instance', 'Vector3', 'Color3', 'Enum', 'TweenService', 'TweenInfo', 'RunService', 'Players', 'Debris', 'task', 'wait', 'print', 'warn', 'gui', 'sound', 'random',
              'return (async () => {\n' + s.code + '\n})();');
            const scr = { Name: s.name, Parent: s.parent ? proxyOf(s.parent) : workspace, ClassName: 'Script' };
            const r = fn(scr, game, workspace, Instance, Vector3, Color3, Enum, TweenService, TweenInfo, RunService, Players, Debris, task, wait, print, warn, gui, sound, random);
            const nm = s.name; if (r && r.catch) r.catch(e3 => err(nm, e3));
          } catch (e4) { err(s.name, e4); }
        }
        curScript = '';
        for (const p of players.keys()) Players.PlayerAdded._fire(playerOf(p));
        postMessage({ t: 'ready' });
        return;
      }
      if (d.t === 'tick') { if (d.players) for (const p of d.players) { const P = players.get(p.id); if (P) P.pos = p.pos; } if (d.dt) RunService.Heartbeat._fire(d.dt); return; }
      if (d.t === 'sync') { const o = objs.get(d.id); if (o) Object.assign(o.p, d.p); return; }
      if (d.t === 'ev') {
        if (d.id && (d.ev === 'touched' || d.ev === 'touchEnded' || d.ev === 'clicked' || d.ev === 'prompt') && !objs.has(d.id)) return;
        const pl = d.player ? playerOf(d.player) : null, hit = pl ? { Name: pl.Name, Parent: { Name: pl.Name, __player: d.player, Humanoid: pl.Humanoid }, __player: d.player } : null;
        if (d.ev === 'touched') H.touched.get(d.id)?._fire(hit, pl);
        else if (d.ev === 'touchEnded') H.touchEnded.get(d.id)?._fire(hit, pl);
        else if (d.ev === 'clicked') H.clicked.get(d.id)?._fire(pl);
        else if (d.ev === 'prompt') H.prompt.get(d.id)?._fire(pl);
        else if (d.ev === 'tweenDone') { const tw = tweens.get(d.tid); if (tw) { tweens.delete(d.tid); tw.Completed._fire('Completed'); } }
        else if (d.ev === 'playerAdded') { players.set(d.p.id, d.p); Players.PlayerAdded._fire(playerOf(d.p.id)); }
        else if (d.ev === 'playerRemoving') { const p = playerOf(d.id); if (p) Players.PlayerRemoving._fire(p); players.delete(d.id); }
        else if (d.ev === 'died') { const P = players.get(d.player); if (P) { P.health = 0; P.died && P.died._fire(); } }
        else if (d.ev === 'respawned') { const P = players.get(d.player); if (P) P.health = P.maxHealth ?? 100; }
        return;
      }
    };
  }

  // ═══ Песочница: iframe (CSP без сети) — внутри поток с runtime; iframe пересылает сообщения и следит, не завис ли поток ═══
  function frameHtml(){
    const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>
let w = null, last = Date.now(), dead = false;
const up = m => parent.postMessage(m, '*');
addEventListener('message', e => {
  if (e.source !== parent) return;
  const d = e.data || {};
  if (d.t === 'boot') {
    try { w = new Worker(URL.createObjectURL(new Blob(['(' + d.code + ')()'], { type: 'text/javascript' }))); }
    catch (er) { up({ t: 'error', script: '', line: 0, msg: 'Не удалось запустить скрипты: ' + er.message }); return; }
    w.onmessage = ev => { last = Date.now(); if (ev.data && ev.data.t !== 'pong') up(ev.data); };
    w.onerror = ev => { up({ t: 'error', script: '', line: ev.lineno || 0, msg: ev.message || 'ошибка' }); ev.preventDefault(); };
    last = Date.now();
    setInterval(() => { if (dead || !w) return; w.postMessage({ t: 'ping' }); if (Date.now() - last > 3000) { dead = true; w.terminate(); up({ t: 'hang' }); } }, 700);
    return;
  }
  if (w && !dead) w.postMessage(d);
});
up({ t: 'frame' });
<\/script>`;
  }

  E.scripts = function (host){
    const SH = { running: false, wantBeat: false, want: { touched: new Set(), touchEnded: new Set(), clicked: new Set() } };
    let frame = null, onMsg = null, queue = [], ready = false, posT = 0;
    const post = m => { if (frame?.contentWindow && ready) frame.contentWindow.postMessage(m, '*'); else queue.push(m); };
    SH.start = (scene, players) => {
      SH.stop();
      const scripts = scene.all().filter(o => o.cls === 'Script' && o.enabled !== false && String(o.code || '').trim()).map(o => {
        const lang = o.lang && E.langs[o.lang] ? o.lang : 'js', bin = E.langs[lang].kind === 'binary';
        return { id: o.id, name: o.name, parent: o.parent, lang, code: String(o.code).slice(0, bin ? 3e6 : 200000) };
      });
      const libs = {};
      for (const s of scripts) if (s.lang !== 'js' && !libs[s.lang] && E.langs[s.lang].worker) libs[s.lang] = '(' + E.langs[s.lang].worker.toString() + ')();';
      SH.running = true;
      if (!scripts.length) return false;
      const objs = scene.all().filter(o => o.cls !== 'Script').map(o => {
        const p = {}; for (const k of ['name', 'shape', 'pos', 'rot', 'size', 'color', 'mat', 'alpha', 'collide', 'anchored', 'shadow', 'range', 'power', 'kind', 'text', 'attrs']) if (o[k] !== undefined) p[k] = JSON.parse(JSON.stringify(o[k]));
        return { id: o.id, cls: o.cls, parent: o.parent, p };
      });
      frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      frame.srcdoc = frameHtml();
      onMsg = e => {
        if (e.source !== frame?.contentWindow) return;
        const d = e.data || {};
        if (d.t === 'frame') { ready = true; frame.contentWindow.postMessage({ t: 'boot', code: runtime.toString() }, '*'); frame.contentWindow.postMessage({ t: 'init', objs, scripts, players, libs }, '*'); for (const m of queue) frame.contentWindow.postMessage(m, '*'); queue = []; return; }
        if (d.t === 'want') { if (d.ev === 'heartbeat') SH.wantBeat = !!d.on; else if (SH.want[d.ev]) { if (d.on) SH.want[d.ev].add(d.id); else SH.want[d.ev].delete(d.id); } if (d.ev === 'clicked' || d.ev === 'prompt') host.apply?.(d); return; }
        if (d.t === 'print') { host.print?.(String(d.text || ''), d.kind); return; }
        if (d.t === 'error') { host.error?.(String(d.script || ''), +d.line || 0, String(d.msg || '')); return; }
        if (d.t === 'hang') { host.hang?.(); SH.running = false; return; }
        if (d.t === 'ready') return;
        host.apply?.(d);
      };
      window.addEventListener('message', onMsg);
      document.body.appendChild(frame);
      return true;
    };
    SH.event = (ev, data = {}) => { if (SH.running) post({ t: 'ev', ev, ...data }); };
    // Heartbeat — каждый шаг, только если скрипт подписан; иначе позиции игроков — 10 раз в секунду (player.Position)
    SH.tick = (dt, players) => {
      if (!SH.running) return;
      if (SH.wantBeat) { post({ t: 'tick', dt, players }); return; }
      posT += dt; if (posT >= .1) { posT = 0; post({ t: 'tick', dt: 0, players }); }
    };
    SH.sync = (id, p) => { if (SH.running) post({ t: 'sync', id, p }); };
    SH.stop = () => {
      SH.running = false; SH.wantBeat = false; for (const s of Object.values(SH.want)) s.clear();
      if (onMsg) window.removeEventListener('message', onMsg);
      frame?.remove(); frame = null; onMsg = null; ready = false; queue = [];
    };
    return SH;
  };
  E.scripts.runtime = runtime;

  // ═══ Реестр языков скриптов (JavaScript — встроенный) ═══
  E.langs = E.langs || {};
  E.lang = (id, def) => { E.langs[id] = Object.assign({ id, label: id, short: id, icon: '📜', kind: 'text', examples: [], ai: '', placeholder: '' }, E.langs[id], def); return E.langs[id]; };
  E.lang('js', { label: 'JavaScript', short: 'JS', icon: '📜', kind: 'text' });
})();
