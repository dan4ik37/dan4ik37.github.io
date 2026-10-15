// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — панель «🎨 Графика» мира (расширение D37E.studioExt, studio3d.js не трогает)
// ═══════════════════════════════════════
// Готовые настроения (E.WORLD_PRESETS: Солнечный день, Закат, Ночь, Туманный лес, Неон-город) и всё по отдельности: время
// суток и смена дня и ночи, небо (дымка, солнце, облака, звёзды, луна), туман (дальность, у земли, высота, к солнцу, цвет),
// свет (солнце, небо, экспозиция), цвет кадра (цветокоррекция, свечение), вода (цвет, прозрачность, пена), тени (вкл,
// мягкость). Хранится в освещении мира: R.lighting (time, brightness, ambient, fogEnd, shadows, cycle) + R.lighting.gfx
// (js/engine/gfx.js E.worldGfx) — уходит в файл мира, при «📤 Выложить» и гостям в блоке world. Загрузили другой мир —
// графика берётся из него (полный объект освещения сбрасывает gfx). Настройки игрока — потолок (render.js).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtT = v => { const h = Math.floor(v) % 24, m = Math.round((v - Math.floor(v)) * 60) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
  const CSS = `.s3g{position:absolute;z-index:7;top:48px;right:8px;width:310px;max-width:calc(100% - 16px);max-height:calc(100% - 64px);overflow:auto;padding:10px 12px 12px;border-radius:12px;background:#23252e;border:1px solid #4a4e5c;box-shadow:0 14px 34px rgba(0,0,0,.5);color:#e5e7eb;font:13px/1.4 system-ui,sans-serif}
.s3g h4{margin:.7em 0 .3em;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#a78bfa}
.s3g-head{display:flex;align-items:center;gap:6px;font-weight:800}.s3g-head span{flex:1}.s3g-head button{border:0;background:#383b48;color:#fff;border-radius:7px;padding:3px 8px;cursor:pointer}
.s3g-pre{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}.s3g-pre button{border:1px solid #4a4e5c;background:#2f323d;color:#e5e7eb;border-radius:8px;padding:5px 2px;cursor:pointer;font-size:18px;line-height:1.1}
.s3g-pre button small{display:block;font-size:9.5px;color:#cbd5e1}.s3g-pre button.on{border-color:#a78bfa;background:#3b3466}
.s3g label{display:block;margin:5px 0}.s3g label b{float:right;font-weight:700;color:#c4b5fd}.s3g input[type=range]{width:100%;accent-color:#a78bfa}
.s3g select{width:100%;background:#2f323d;color:#e5e7eb;border:1px solid #4a4e5c;border-radius:7px;padding:4px}
.s3g .s3g-row{display:flex;align-items:center;gap:6px}.s3g .s3g-row input[type=color]{width:38px;height:24px;border:0;background:none;padding:0}
.s3g .s3g-chk{display:flex;align-items:center;gap:6px}.s3g-note{color:#9ca3af;font-size:11.5px;margin:.6em 0 0}
.s3g-auto{border:0;background:#383b48;color:#cbd5e1;border-radius:6px;padding:2px 7px;cursor:pointer;font-size:11px}`;
  let api = null, btn = null, box = null, seen = null, poll = 0;
  const R = () => api?.ed?.R || null;
  // что показано: объект графики мира + свет (панель «☀ Свет» студии меняет его без нас)
  const sig = r => { const L = r.lighting; return [L.time, L.brightness, L.ambient, L.fogEnd, L.shadows, L.cycle].join('|'); };
  let seenSig = '';
  function style(){ if (document.getElementById('s3g-css')) return; const s = document.createElement('style'); s.id = 's3g-css'; s.textContent = CSS; document.head.appendChild(s); }
  // ── поля: [ключ, подпись, min, max, шаг, формат] ──
  const rng = (k, label, min, max, step, val, fmt = v => (+v).toFixed(2)) => `<label>${label} <b data-o="${k}">${fmt(val)}</b><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-k="${k}"></label>`;
  const chk = (k, label, on) => `<label class="s3g-chk"><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}> ${label}</label>`;
  const FMT = { time: fmtT, fogEnd: v => String(Math.round(v)), cycle: v => +v ? Math.round(v) + ' мин' : 'нет', 'fog.height': v => (+v).toFixed(1) };
  function render(){
    if (!box || !R()) return;
    const L = R().lighting, G = L.gfx;
    seen = G; seenSig = sig(R());
    const pre = Object.entries(E.WORLD_PRESETS || {}).map(([k, p]) => `<button type="button" data-pre="${k}" class="${G.preset === k ? 'on' : ''}" title="${esc(p.name)}">${p.icon}<small>${esc(p.name)}</small></button>`).join('');
    const grades = Object.entries(E.GRADES || {}).map(([k, g]) => `<option value="${k}"${G.grade === k ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    box.innerHTML = `<div class="s3g-head"><span>🎨 Графика мира</span><button type="button" data-a="reset" title="Как в новом мире">↺</button><button type="button" data-a="close" aria-label="Закрыть">✕</button></div>
      <div class="s3g-pre">${pre}</div>
      <h4>Время</h4>
      ${rng('time', '🕒 Время суток', 0, 24, .05, L.time, fmtT)}
      ${rng('cycle', '🔁 Сутки в игре длятся', 0, 60, 1, L.cycle || 0, FMT.cycle)}
      <h4>Небо</h4>
      ${rng('sky.haze', 'Дымка', 0, 1, .01, G.sky.haze)}${rng('sky.sun', 'Размер солнца', .3, 3, .05, G.sky.sun)}
      ${rng('sky.clouds', 'Облака', 0, 1, .05, G.sky.clouds)}${rng('sky.stars', 'Звёзды ночью', 0, 1, .05, G.sky.stars)}
      ${chk('sky.moon', '🌙 Луна ночью (и её свет)', G.sky.moon)}
      <h4>Туман</h4>
      ${rng('fogEnd', 'Видно на', 40, 800, 10, L.fogEnd, FMT.fogEnd)}${rng('fog.density', 'Туман у земли', 0, 1, .01, G.fog.density)}
      ${rng('fog.height', 'Высота тумана', -20, 60, .5, G.fog.height, FMT['fog.height'])}${rng('fog.sun', 'Свечение к солнцу', 0, 1, .01, G.fog.sun)}
      <div class="s3g-row">Цвет тумана <input type="color" data-k="fog.color" value="${G.fog.color || '#9fb4cc'}"><button type="button" class="s3g-auto" data-a="fog.auto">${G.fog.color ? 'авто' : '✓ авто (небо)'}</button></div>
      <h4>Свет</h4>
      ${rng('brightness', 'Солнце', 0, 2.5, .05, L.brightness)}${rng('ambient', 'Свет неба', 0, 2.5, .05, L.ambient)}${rng('exposure', 'Экспозиция', -1, 1, .05, G.exposure)}
      ${chk('shadows', 'Тени', L.shadows !== false)}${rng('shadow.soft', 'Мягкость теней', 0, 1, .01, G.shadow.soft)}
      <h4>Цвет кадра</h4>
      <label>Цветокоррекция<select data-k="grade">${grades}</select></label>
      ${rng('bloom', 'Свечение (неон, солнце)', 0, 2.5, .05, G.bloom)}
      <h4>Вода</h4>
      <div class="s3g-row">Цвет <input type="color" data-k="water.color" value="${G.water.color || '#3aa6dc'}"><button type="button" class="s3g-auto" data-a="water.auto">${G.water.color ? 'обычный' : '✓ обычный'}</button></div>
      ${rng('water.clarity', 'Прозрачность', 0, 1, .01, G.water.clarity)}${rng('water.foam', 'Пена у берега', 0, 1, .01, G.water.foam)}
      <p class="s3g-note">Сохраняется в мире и видна всем, кто в него заходит. У игроков свои настройки графики — на слабом телефоне тяжёлое само выключается.</p>`;
  }
  // значение поля → освещение мира
  function put(k, v){
    const r = R(); if (!r) return;
    const top = { time: 1, brightness: 1, ambient: 1, fogEnd: 1, shadows: 1 };
    if (k === 'cycle') { r.lighting.cycle = Math.max(0, Math.min(60, Math.round(+v))); }
    else if (top[k]) r.setLighting({ [k]: k === 'shadows' ? !!v : +v });
    else if (k.includes('.')) { const [a, b] = k.split('.'); r.setLighting({ gfx: { preset: '', [a]: { [b]: typeof v === 'boolean' || typeof v === 'string' ? v : +v } } }); }
    else r.setLighting({ gfx: { preset: '', [k]: k === 'grade' ? v : +v } });
    seen = r.lighting.gfx; seenSig = sig(r);
    api.markDirty();
  }
  function preset(k){
    const p = E.WORLD_PRESETS?.[k], r = R(); if (!p || !r) return;
    const L = r.lighting;
    // полный объект освещения: графика мира целиком из настроения (то, чего в нём нет, — по умолчанию)
    r.setLighting({ time: p.lighting.time, brightness: p.lighting.brightness, ambient: p.lighting.ambient, fogEnd: p.lighting.fogEnd, shadows: L.shadows !== false, cycle: L.cycle || 0, gfx: { ...p.gfx, preset: k } });
    r.envNow?.();
    api.markDirty(); api.msg?.(`${p.icon} ${p.name}`, true);
    render();
  }
  function onInput(e){
    const t = e.target, k = t.dataset?.k; if (!k) return;
    const v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value;
    const o = box.querySelector(`[data-o="${k}"]`);
    if (o) o.textContent = (FMT[k] || (x => (+x).toFixed(2)))(v);
    put(k, v);
    if (e.type === 'change') {   // отпустили ползунок / выбрали — панели студии («☀ Свет») тоже показать новое
      try { api.refresh(); } catch (er) {}
      if (t.type !== 'range') render();
      if (k === 'time' || k.startsWith('sky.')) R()?.envNow?.();
    }
  }
  function onClick(e){
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pre) { preset(b.dataset.pre); return; }
    const a = b.dataset.a;
    if (a === 'close') toggle(false);
    else if (a === 'reset') { const r = R(); if (!r) return; const L = r.lighting; r.setLighting({ time: 14, brightness: 1, ambient: 1, fogEnd: 360, shadows: true, cycle: L.cycle || 0, gfx: {} }); r.envNow?.(); api.markDirty(); render(); }
    else if (a === 'fog.auto') { put('fog.color', ''); render(); }
    else if (a === 'water.auto') { put('water.color', ''); render(); }
  }
  function toggle(on){
    on = on ?? !box;
    if (!on) { box?.remove(); box = null; clearInterval(poll); btn?.classList.remove('on'); return; }
    const host = api?.ed?.box; if (!host || !R()) return;
    style();
    box = document.createElement('div'); box.className = 's3g'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Графика мира');
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'contextmenu', 'keydown']) box.addEventListener(ev, e => e.stopPropagation());
    box.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    box.addEventListener('input', onInput); box.addEventListener('change', onInput); box.addEventListener('click', onClick);
    host.appendChild(box);
    btn?.classList.add('on');
    render();
    // мир сменили (открыли другой, шаблон, загрузили файл) — панель показывает его графику
    poll = setInterval(() => { if (!box) return; const r = R(); if (!r) { toggle(false); return; } if ((r.lighting.gfx !== seen || sig(r) !== seenSig) && !box.contains(document.activeElement)) render(); }, 600);
  }
  const ext = {
    id: 'gfx',
    mount(a){
      api = a;
      const slot = a.slot; if (!slot || slot.querySelector('[data-s3g]')) return;
      btn = document.createElement('button'); btn.type = 'button'; btn.dataset.s3g = '1'; btn.title = 'Графика мира: время суток, небо, туман, цвет кадра, вода, тени';
      btn.innerHTML = '🎨<span> Графика</span>';
      btn.addEventListener('click', () => toggle());
      slot.appendChild(btn);
    },
    unmount(){ toggle(false); btn?.remove(); btn = null; api = null; },
    play(){ toggle(false); },
  };
  (E.studioExt = E.studioExt || []).push(ext);
  E.studioGfx = { ext, toggle: v => toggle(v), render: () => render() };
})();
