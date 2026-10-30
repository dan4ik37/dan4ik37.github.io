// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — погода и времена года мира (16.10.2026, docs/SEASONS.md): панель «🌦 Погода» (расширение D37E.studioExt) и
//  модуль игры D37E.studioPlay 'weather' (скрипты Weather.*, гости, чужой мир по ссылке); studio3d.js не трогает
// ═══════════════════════════════════════
// Настройки мира — SC.settings.weather = { mode: 'off' | 'calendar' | 'cycle' | 'fixed', days, season, weather: 'auto' | состояние,
// climate, seed } (js/engine/climate.js C.sanitize): сохраняется в мире, выкладывается, гостям — блоком world (как режим игры).
// Нет настроек — «как в общем мире» (calendar): погода у всех одна, от зерна и реального времени. Картинка — D37E.climate.attach
// (js/engine/precip.js) на рендерере студии, кадр — через R.preRender (и в редакторе, и в игре). «По игровым дням» — сутки
// мира длятся lighting.cycle минут (нет смены дня — 20 мин), день считается от реального времени: у хозяина и гостей одинаково.
// Скрипты (у того, кто считает мир): состояние — событие 'weather' раз в 1,5 с и при смене, праздник — 'holiday';
// Weather.Set(state) из скрипта — только на время игры (у всех: событие 'wx' гостям), «■ Стоп» — как в настройках.
(() => {
  const E = window.D37E = window.D37E || {};
  const C = E.climate;
  if (!C || !C.attach) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let api = null, papi = null, btn = null, box = null, X = null, XR = null, lastT = 0, hook = null, poll = 0, sendT = 0, sentLabel = '', offH = null;
  const ED = () => api?.ed || papi?.ed || null;
  const cfg = () => C.sanitize(ED()?.SC?.settings?.weather || {});
  const dayMs = R => Math.max(1, +R.lighting.cycle || 20) * 60000;
  const worldOf = (c, R) => ({ seed: c.seed || 'studio', mode: c.mode, days: c.days, season: c.season, weather: c.weather, climate: c.climate, lapse: -.08, seaY: 0,
    hourAt: () => R.lighting.time, gameTime: () => ({ day: Math.floor(Date.now() / dayMs(R)), hour: R.lighting.time }) });
  // где игрок: в игре — свой персонаж, в редакторе — камера
  function where(){
    const ed = ED(), P = ed?.playing?.P?.ch;
    if (P) return [P.x, P.y, P.z];
    const c = ed?.R?.camera?.position; return c ? [c.x, c.y, c.z] : [0, 0, 0];
  }
  function ensure(){
    const ed = ED(), R = ed?.R; if (!R) return null;
    if (X && XR === R) return X;
    dispose();
    XR = R;
    X = C.attach(R, { world: worldOf(cfg(), R), where, skyTop: E.precip.physTop(ed.ph, 400), water: (x, z) => { const w = ed.ph?.waterLevel?.(x, z); return Number.isFinite(w) ? w : -Infinity; },
      waveAt: (x, z) => ED()?.TR?.waveAt?.(x, z)?.y || 0, sound: E.audio?.() });   // круги дождя — на волне
    // волны воды ландшафта (terrain.js TR.waves, waves.js): высота — от погоды здесь (ветер, гроза, лёд), раз в 2 с
    let wq = 0;
    hook = (r, t0) => {
      const dt = lastT ? Math.min(.1, (t0 - lastT) / 1000) : 1 / 60; lastT = t0;
      try { X?.frame(dt); } catch (e) { console.warn('погода студии:', e); }
      if ((wq -= dt) <= 0) { wq = 2; try { const F = ED()?.TR?.waves; if (F && X?.state) F.weather(X.state); } catch (e) {} }
    };
    R.preRender.push(hook);
    offH = C.on('holiday', h => { if (h.phase === 'burst' || h.phase === 'day') toScripts('holiday', { id: h.id, greet: h.greet }); });
    return X;
  }
  function dispose(){
    if (XR && hook) { const i = XR.preRender.indexOf(hook); if (i >= 0) XR.preRender.splice(i, 1); }
    try { X?.dispose(); } catch (e) {}
    offH?.(); offH = null; X = null; XR = null; hook = null; lastT = 0;
  }
  const apply = () => { const R = ED()?.R; if (X && R) X.setWorld(worldOf(cfg(), R)); };
  const live = () => !!papi?.live?.();
  function toScripts(ev, data){ if (live()) try { papi.scriptEvent(ev, data); } catch (e) {} }
  function stateOut(){
    const s = X?.state || C.blank();
    return { state: s.state, season: s.season, temp: Math.round(s.temp * 10) / 10, feels: Math.round(s.feels * 10) / 10, wind: Math.round(s.wind * 10) / 10, rain: +(s.rain || 0).toFixed(2), snow: +(s.snow || 0).toFixed(2),
      holiday: (C.holidays(Date.now()).find(h => h.phase !== 'pre') || {}).id || '' };
  }

  // ═══ Панель «🌦 Погода» ═══
  const CSS = `.s3w{position:absolute;z-index:7;top:48px;right:8px;width:300px;max-width:calc(100% - 16px);max-height:calc(100% - 64px);overflow:auto;padding:10px 12px 12px;border-radius:12px;background:#23252e;border:1px solid #4a4e5c;box-shadow:0 14px 34px rgba(0,0,0,.5);color:#e5e7eb;font:13px/1.4 system-ui,sans-serif}
.s3w h4{margin:.7em 0 .3em;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7dd3fc}
.s3w-head{display:flex;align-items:center;gap:6px;font-weight:800}.s3w-head span{flex:1}.s3w-head button{border:0;background:#383b48;color:#fff;border-radius:7px;padding:3px 8px;cursor:pointer}
.s3w label{display:block;margin:6px 0}.s3w label b{float:right;color:#bae6fd}.s3w select{width:100%;background:#2f323d;color:#e5e7eb;border:1px solid #4a4e5c;border-radius:7px;padding:4px}
.s3w input[type=range]{width:100%;accent-color:#38bdf8}.s3w-now{margin:.4em 0;padding:6px 8px;border-radius:8px;background:#1b2a3a;color:#e0f2fe}.s3w-note{color:#9ca3af;font-size:11.5px;margin:.6em 0 0}`;
  function style(){ if (document.getElementById('s3w-css')) return; const s = document.createElement('style'); s.id = 's3w-css'; s.textContent = CSS; document.head.appendChild(s); }
  const opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
  function nowLine(){
    const s = X?.state; if (!s) return '—';
    return `${C.SEASON_ICONS[s.season] || ''} ${esc(C.SEASON_NAMES[s.season] || '')} · ${C.STATE_ICONS[s.state] || ''} ${esc(C.STATE_NAMES[s.state] || '')} · ${Math.round(s.temp)}° (ощущается ${Math.round(s.feels)}°)${s.snowCover > .05 ? ' · ❄ снег лежит' : ''}${s.ice > .5 ? ' · 🧊 лёд' : ''}`;
  }
  function render(){
    if (!box) return;
    const c = cfg();
    box.innerHTML = `<div class="s3w-head"><span>🌦 Погода мира</span><button type="button" data-a="close" aria-label="Закрыть">✕</button></div>
      <div class="s3w-now" data-now>${nowLine()}</div>
      <h4>Времена года</h4>
      <label><select data-k="mode">${opt('calendar', '🌍 Как в общем мире (у всех одинаково)', c.mode)}${opt('cycle', '🔁 По игровым дням', c.mode)}${opt('fixed', '📌 Один сезон', c.mode)}${opt('off', '⛔ Выкл (всегда ясно, лето)', c.mode)}</select></label>
      ${c.mode === 'cycle' ? `<label>Игровых суток на сезон <b data-o="days">${esc(c.days)}</b><input type="range" min="1" max="30" step="1" value="${esc(c.days)}" data-k="days"></label>` : ''}
      ${c.mode === 'fixed' ? `<label><select data-k="season">${C.SEASONS.map(s => opt(s, C.SEASON_ICONS[s] + ' ' + C.SEASON_NAMES[s], c.season)).join('')}</select></label>` : ''}
      <h4>Погода</h4>
      <label><select data-k="weather">${opt('auto', '🔄 Сама меняется', c.weather)}${(C.STATES_BASE || C.STATES).map(s => opt(s, C.STATE_ICONS[s] + ' Всегда: ' + C.STATE_NAMES[s], c.weather)).join('')}</select></label>
      <label>Климат<select data-k="climate">${Object.entries(C.CLIMATES).map(([k, v]) => opt(k, v.name, c.climate)).join('')}</select></label>
      <p class="s3w-note">Сохраняется в мире — видят все игроки. Зимой на крышах и земле лежит снег, осенью желтеет листва, озёра замерзают; под крышей не льёт. Скрипты: <code>Weather.State</code>, <code>Weather.Temperature</code>, <code>Weather.Season</code>, <code>Weather.Changed</code>, <code>Weather.Holiday</code>, <code>Weather.Set("snow")</code>.</p>`;
  }
  function put(k, v){
    const SC = ED()?.SC; if (!SC) return;
    SC.settings = SC.settings || {};
    const c = { ...cfg(), [k]: k === 'days' ? +v : v };
    if (!c.seed) c.seed = 's' + Math.random().toString(36).slice(2, 8);   // своё расписание погоды у мира (у всех игроков то же)
    SC.settings.weather = C.sanitize(c);
    apply(); api?.markDirty?.();
  }
  function toggle(on){
    on = on ?? !box;
    if (!on) { box?.remove(); box = null; clearInterval(poll); btn?.classList.remove('on'); return; }
    const host = api?.ed?.box; if (!host) return;
    style(); ensure();
    box = document.createElement('div'); box.className = 's3w'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Погода мира');
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'contextmenu', 'keydown']) box.addEventListener(ev, e => e.stopPropagation());
    box.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    box.addEventListener('input', e => { const t = e.target, k = t.dataset?.k; if (k === 'days') { const o = box.querySelector('[data-o="days"]'); if (o) o.textContent = t.value; } });
    box.addEventListener('change', e => { const t = e.target, k = t.dataset?.k; if (!k) return; put(k, t.value); render(); });
    box.addEventListener('click', e => { if (e.target.closest('[data-a="close"]')) toggle(false); });
    host.appendChild(box); btn?.classList.add('on');
    render();
    poll = setInterval(() => { const el = box?.querySelector('[data-now]'); if (el) el.innerHTML = nowLine(); }, 1000);
  }
  const ext = {
    id: 'weather',
    mount(a){
      api = a; ensure();
      const slot = a.slot; if (!slot || slot.querySelector('[data-s3w]')) return;
      btn = document.createElement('button'); btn.type = 'button'; btn.dataset.s3w = '1'; btn.title = 'Погода мира: времена года, дождь и снег, климат';
      btn.innerHTML = '🌦<span> Погода</span>';
      btn.addEventListener('click', () => toggle());
      slot.appendChild(btn);
    },
    unmount(){ toggle(false); btn?.remove(); btn = null; api = null; if (!papi) dispose(); },
    play(){ toggle(false); },
  };
  (E.studioExt = E.studioExt || []).push(ext);

  // ═══ Модуль игры: и в редакторе, и в чужом мире по ссылке, и у гостя ═══
  const play = {
    id: 'weather',
    start(p){ papi = p; ensure(); sendT = 0; sentLabel = ''; },
    world(){ sendT = 0; sentLabel = ''; },   // этот браузер считает мир — скриптам сразу состояние
    step(dt){
      if (!X || !live() || (sendT -= dt) > 0) return;
      sendT = 1.5;
      const s = stateOut(), changed = !!sentLabel && s.state !== sentLabel;
      sentLabel = s.state;
      toScripts('weather', { s, changed });
    },
    // Weather.Set(state) из скрипта: на время игры, у всех (гостям — 'wx')
    cmd(d){
      if (d.t !== 'mode' || d.cmd !== 'weather' || !X) return;
      const st = C.STATES.includes(d.state) ? d.state : null;
      X.force(st); sendT = 0;
      try { papi.sendAll('wx', { weather: st || 'auto' }); } catch (e) {}
    },
    guestEvent(ty, d){ if (ty !== 'wx' || !X || !d) return false; X.force(C.STATES.includes(d.weather) ? d.weather : null); return true; },
    settings(){ apply(); },   // гость получил настройки мира друга
    stop(){ apply(); papi = null; if (!api) dispose(); },
  };
  (E.studioPlay = E.studioPlay || []).push(play);
  E.studioWeather = { ext, play, toggle: v => toggle(v), state: () => X?.stats?.() || null, X: () => X };
})();
