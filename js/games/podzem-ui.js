// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» ⛏ — ИНТЕРФЕЙС: здоровье и мана, панель ячеек, вещи и крафт, сундук, меню (персонажи, миры, моды, пауза,
//  настройки, достижения, «как играть»), подсказки, Проводник, полоса босса, управление пальцем
// ═══════════════════════════════════════
// U = PZUI.create(G, API) — G: состояние игры (podzem.js), API: её функции. Значки предметов — из атласа (podzem-gl.js),
// одна картинка на всё (blob), позиция — CSS-переменные. Стили — свои (pz-*), вставляются один раз.
// Управление пальцем: слева — джойстик (появляется под пальцем), справа — прыжок, «ударить/копать», действие, вещи;
// палец по миру — прицел: держать — копать/ставить/бить там, короткое нажатие — открыть дверь/сундук или один удар.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `
.pz [hidden]{display:none!important}
.pz{position:relative;user-select:none;-webkit-user-select:none;touch-action:none;color:#f2f0fa;font:500 14px/1.35 Montserrat,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.pz-hurt{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(150,0,10,0) 50%,rgba(190,12,24,.6) 100%)}
.pz-wrap{position:relative;width:100%;height:520px;overflow:hidden;border-radius:14px;background:#0b0a14;box-shadow:0 10px 40px -18px rgba(0,0,0,.8)}
.gs-fs .pz-wrap{border-radius:0}
.pz-gl,.pz-ov{position:absolute;left:0;top:0;display:block}
.pz-gl{image-rendering:pixelated;image-rendering:crisp-edges}
.pz-ov{pointer-events:none}
.pz-ic{--s:32px;display:inline-block;width:var(--s);height:var(--s);background-image:var(--pz-atlas);background-size:calc(var(--s) * 64) calc(var(--s) * 64);background-position:calc(var(--c) * var(--s) * -1) calc(var(--r) * var(--s) * -1);image-rendering:pixelated;flex:none}
.pz-hud{position:absolute;left:8px;right:8px;top:8px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;pointer-events:none;z-index:3}
.pz-hud>*{pointer-events:auto}
.pz-bar{display:flex;gap:3px;padding:4px;border-radius:12px;background:rgba(8,8,16,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.pz-slot{--s:30px;position:relative;width:42px;height:42px;border-radius:9px;border:2px solid rgba(255,255,255,.12);background:rgba(30,32,52,.78);display:grid;place-items:center;padding:0;cursor:pointer;color:#fff}
.pz-slot:hover{border-color:rgba(255,255,255,.35)}
.pz-slot.sel{border-color:#ffd84a;background:rgba(70,62,30,.85);box-shadow:0 0 0 2px rgba(255,216,74,.25)}
.pz-slot b{position:absolute;right:3px;bottom:1px;font:800 11px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 2px #000,0 0 2px #000}
.pz-slot i.k{position:absolute;left:3px;top:2px;font:700 9px/1 Montserrat,system-ui,sans-serif;font-style:normal;opacity:.6}
.pz-slot .pz-ic{--s:30px}
.pz-sel-name{position:absolute;top:58px;left:50%;transform:translateX(-50%);font:800 13px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none;white-space:nowrap;z-index:3;padding:4px 10px;border-radius:10px;background:rgba(8,8,16,.42)}
.pz-sel-name:empty{display:none}
.pz-life{display:flex;flex-direction:column;gap:3px;align-items:flex-start;padding:5px 7px;border-radius:12px;background:rgba(8,8,16,.45)}
.pz-hearts,.pz-stars{display:flex;flex-wrap:wrap;gap:1px;max-width:230px}
.pz-hearts .pz-ic,.pz-stars .pz-ic{--s:20px}
.pz-hp-n{font:800 11px/1 Montserrat,system-ui,sans-serif;opacity:.85}
.pz-buffs{display:flex;gap:4px;flex-wrap:wrap}.pz-buffs:empty{display:none}
.pz-goal{display:flex;align-items:center;gap:6px;max-width:260px;padding:4px 8px;border-radius:10px;background:rgba(40,32,8,.62);border:1px solid rgba(255,216,74,.35);font:700 12px/1.25 Montserrat,system-ui,sans-serif;cursor:pointer;pointer-events:auto}
.pz-goal b{color:#ffd84a;font-weight:800;white-space:nowrap}.pz-goal:empty{display:none}
.pz-goal.done{animation:pzIn .4s ease-out}
.pz-buff{display:inline-flex;align-items:center;gap:2px;padding:1px 5px 1px 1px;border-radius:8px;background:rgba(255,216,74,.14);font:800 11px/1 Montserrat,system-ui,sans-serif}
.pz-buff .pz-ic{--s:18px}
.pz-b.on{background:rgba(255,216,74,.42);box-shadow:0 0 0 2px rgba(255,216,74,.5) inset}
.pz-invbar{margin:2px 0 6px;gap:6px}.pz-invbar .pz-b{height:30px;font-size:12px;padding:0 9px}
.pz-btns{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.pz-b{border:0;border-radius:10px;background:rgba(20,20,36,.7);color:#fff;min-width:38px;height:38px;padding:0 10px;font:700 15px/1 Montserrat,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px}
.pz-b:hover{background:rgba(60,60,96,.85)}
.pz-b.pri{background:linear-gradient(135deg,var(--accent,#ff2d55),var(--accent2,#ff6b35))}
.pz-b.ghost{background:rgba(255,255,255,.07)}
.pz-b:disabled{opacity:.45;cursor:default}
.pz-status{position:absolute;left:10px;bottom:8px;font:600 12px/1.25 Montserrat,system-ui,sans-serif;text-shadow:0 1px 3px #000;opacity:.92;pointer-events:none;z-index:3;max-width:70%;padding:3px 9px;border-radius:9px;background:rgba(8,8,16,.34)}
.pz-panel{position:absolute;left:50%;top:60px;transform:translateX(-50%);z-index:5;width:min(560px,calc(100% - 16px));max-height:calc(100% - 72px);overflow:auto;padding:10px;border-radius:14px;background:rgba(12,12,24,.92);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 50px -12px rgba(0,0,0,.8)}
.pz-panel h4{margin:0 0 6px;font:800 13px/1.2 Montserrat,system-ui,sans-serif;opacity:.85;display:flex;align-items:center;gap:8px}
.pz-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:3px;margin-bottom:8px}
.pz-grid .pz-slot{width:auto;aspect-ratio:1;height:auto;min-width:0}
.pz-chest .pz-grid{grid-template-columns:repeat(10,1fr)}
.pz-craft{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.pz-rc{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid transparent;cursor:pointer;color:#fff;text-align:left;font:inherit}
.pz-rc:hover{border-color:rgba(255,255,255,.18)}
.pz-rc.no{opacity:.5;cursor:default}
.pz-rc .pz-ic{--s:28px}
.pz-rc .nm{font-weight:800;min-width:0;flex:1}
.pz-rc .nm small{display:block;font-weight:500;opacity:.75;font-size:11px}
.pz-rc .ing{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.pz-rc .ing span{display:inline-flex;align-items:center;gap:2px;font:700 11px/1 Montserrat,system-ui,sans-serif}
.pz-rc .ing .pz-ic{--s:18px}
.pz-rc .ing .lack{color:#ff8080}
.pz-tabs{display:flex;gap:4px;margin:4px 0}
.pz-tabs button{border:0;border-radius:8px;padding:5px 9px;background:rgba(255,255,255,.07);color:#fff;font:700 12px/1 Montserrat,system-ui,sans-serif;cursor:pointer}
.pz-tabs button.on{background:rgba(255,216,74,.25)}
.pz-hand{position:absolute;z-index:20;pointer-events:none;transform:translate(-50%,-50%)}
.pz-hand b{position:absolute;right:-4px;bottom:-4px;font:800 12px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 2px #000}
.pz-menu{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(6,6,14,.66);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.pz-card{width:min(720px,100%);max-height:100%;overflow:auto;padding:16px;border-radius:18px;background:rgba(16,16,30,.96);border:1px solid rgba(255,255,255,.1);box-shadow:0 24px 60px -16px rgba(0,0,0,.9)}
.pz-card h2{margin:0 0 6px;font:500 26px/1.1 var(--font-display,'Oswald','Arial Narrow',sans-serif);letter-spacing:.04em;text-transform:uppercase}
.pz-card h3{margin:12px 0 6px;font:800 14px/1.2 Montserrat,system-ui,sans-serif;opacity:.85}
.pz-card p{margin:0 0 8px;opacity:.85}
.pz-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:560px){.pz-cols{grid-template-columns:1fr}.pz-bar{gap:2px;padding:3px}
.pz-hud{flex-wrap:wrap;gap:4px;left:6px;right:6px;top:6px}
.pz-hot{order:3;flex:1 1 100%;justify-content:center}
.pz-hot .pz-slot{flex:1 1 0;min-width:0;max-width:40px;width:auto;height:auto;aspect-ratio:1}
.pz-slot .pz-ic{--s:22px}.pz-slot i.k{display:none}
.pz-life{flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 6px}
.pz-hearts,.pz-stars{max-width:130px}.pz-hearts .pz-ic,.pz-stars .pz-ic{--s:15px}.pz-hp-n{display:none}
.pz-btns{gap:3px}.pz-btns .pz-b{min-width:34px;height:34px;padding:0 7px}
.pz-sel-name{top:96px}.pz-panel{top:84px;max-height:calc(100% - 92px)}}
.pz-list{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto}
.pz-it{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.05);border:2px solid transparent;cursor:pointer}
.pz-it.on{border-color:#ffd84a;background:rgba(255,216,74,.08)}
.pz-it .tx{flex:1;min-width:0}
.pz-it .tx b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pz-it .tx small{opacity:.7;font-size:11px}
.pz-it .ib{border:0;background:none;color:#fff;font-size:16px;cursor:pointer;padding:4px;opacity:.7}
.pz-it .ib:hover{opacity:1}
.pz-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.pz-big{font-size:17px!important;height:46px!important;padding:0 22px!important}
.pz-field{display:flex;flex-direction:column;gap:4px;margin:8px 0}
.pz-field input,.pz-field select{border:1px solid rgba(255,255,255,.15);border-radius:10px;background:rgba(255,255,255,.06);color:#fff;padding:9px 11px;font:600 14px/1.2 Montserrat,system-ui,sans-serif}
.pz-field small{opacity:.7}
.pz-chk{display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer}
.pz-toasts{position:absolute;left:50%;top:104px;transform:translateX(-50%);z-index:9;display:flex;flex-direction:column;gap:5px;align-items:center;pointer-events:none;width:min(520px,94%)}
.pz-toast{padding:8px 14px;border-radius:12px;box-shadow:0 8px 24px -10px rgba(0,0,0,.8);background:rgba(12,12,24,.9);border:1px solid rgba(255,255,255,.12);font:700 13px/1.3 Montserrat,system-ui,sans-serif;text-align:center;animation:pzIn .2s ease-out}
.pz-toast.info{white-space:pre-line;text-align:left}.pz-toast.bad{border-color:rgba(255,90,90,.5)}.pz-toast.good{border-color:rgba(90,255,140,.45)}.pz-toast.ach{border-color:rgba(255,216,74,.7);background:rgba(50,40,10,.92)}.pz-toast.boss{border-color:rgba(200,90,255,.7);font-size:15px}
@keyframes pzIn{from{opacity:0;transform:translateY(-6px)}}
.pz-talk{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);z-index:6;width:min(480px,92%);padding:10px 12px;border-radius:14px;background:rgba(30,24,10,.93);border:1px solid rgba(255,216,74,.45);box-shadow:0 10px 30px -10px #000}
.pz-talk b{color:#ffd84a}
.pz-talk .pz-row{margin-top:6px}
.pz-boss{position:absolute;left:50%;top:70px;transform:translateX(-50%);z-index:4;width:min(420px,80%);text-align:center;font:800 13px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 3px #000}
.pz-boss div{height:10px;border-radius:6px;background:rgba(0,0,0,.6);margin-top:4px;overflow:hidden;border:1px solid rgba(255,255,255,.2)}
.pz-boss i{display:block;height:100%;background:linear-gradient(90deg,#c040ff,#ff4070);transition:width .2s}
.pz-load,.pz-dead{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(6,6,14,.82);font:800 18px/1.3 Montserrat,system-ui,sans-serif;text-align:center;padding:16px}
.pz-dead{background:rgba(60,0,0,.45)}
.pz-spin{width:38px;height:38px;border-radius:50%;border:4px solid rgba(255,255,255,.15);border-top-color:#ffd84a;animation:pzSpin .8s linear infinite}
@keyframes pzSpin{to{transform:rotate(360deg)}}
.pz-cmd{position:absolute;left:8px;right:8px;bottom:34px;z-index:9;display:flex;gap:6px}
.pz-cmd input{flex:1;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(10,10,20,.92);color:#fff;padding:9px 11px;font:600 14px/1 ui-monospace,monospace}
.pz-touch{position:absolute;inset:0;z-index:4;pointer-events:none}
.pz-touch .tb{position:absolute;pointer-events:auto;border:0;border-radius:50%;background:rgba(20,20,40,.55);color:#fff;font:800 22px/1 Montserrat,system-ui,sans-serif;display:grid;place-items:center;box-shadow:0 0 0 2px rgba(255,255,255,.15) inset;opacity:var(--gs-touch-a,1)}
.pz-touch .tb.on{background:rgba(255,216,74,.4)}
.pz-joy{position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;background:rgba(255,255,255,.08);box-shadow:0 0 0 2px rgba(255,255,255,.18) inset;pointer-events:none}
.pz-joy i{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(255,255,255,.35)}
.pz-help li{margin:3px 0}
.pz-ach{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px}
.pz-ach div{padding:8px;border-radius:10px;background:rgba(255,255,255,.05);opacity:.5}
.pz-ach div.got{opacity:1;background:rgba(255,216,74,.1)}
.pz-ach small{display:block;opacity:.75}
.pz-note{font-size:12px;opacity:.7}
.pz-mods .pz-it{cursor:default}
.pz-err{color:#ff9a9a;font-size:12px}
@media (max-width:560px){.pz-boss{top:112px}.pz-toasts{top:140px}}
@media (max-width:560px){.pz-goal{position:absolute;left:0;top:84px;padding:2px 6px}.pz-goal span{display:none}}
`;
  function addCss(){ if (document.getElementById('pz-css')) return; const s = document.createElement('style'); s.id = 'pz-css'; s.textContent = CSS; document.head.appendChild(s); }
  const isTouch = () => { try { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; } catch (e) { return false; } };
  const fmtTime = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };

  function create(G, API){
    const PZ = API.PZ;
    const U = { touch: { mx: 0, my: 0, jump: false, jumpDown: false, use: false, front: false, build: false } };
    let root, hudEl, hotEl, lifeEl, selName, statusEl, panel, menuEl, toastsEl, talkEl, bossEl, loadEl, deadEl, cmdEl, handEl, touchEl;
    let invOpen = false, menuKind = null, hand = null, craftTab = 'ok', atlasUrl = '', selChar = null, selWorld = null, lastHud = '';
    const offs = [];
    const on = (t, ev, f, o) => { t.addEventListener(ev, f, o); offs.push(() => t.removeEventListener(ev, f, o)); };

    // ── значок предмета ──
    function icon(id, s){
      const c = G.A?.item?.[id];
      if (c === undefined) return `<i class="pz-ic" style="--c:0;--r:0${s ? ';--s:' + s + 'px' : ''};opacity:.3"></i>`;
      return `<i class="pz-ic" style="--c:${c % 64};--r:${c >> 6}${s ? ';--s:' + s + 'px' : ''}"></i>`;
    }
    const nameOf = id => API.itemDef(id)?.name || id;
    function descOf(id){
      const it = API.itemDef(id); if (!it) return id;
      const d = [it.name];
      if (it.kind === 'tool') d.push((it.tool === 'pick' ? `кирка: сила ${it.power}, берёт до «${['', 'камень, медь, железо', 'серебро, золото', 'глубинит, обсидиан', 'жарит', 'всё'][it.tier] || ''}»` : it.tool === 'axe' ? `топор: сила ${it.power}` : 'молоток: стены, полублоки и склоны') + (it.dmg ? `, урон ${it.dmg}` : ''));
      if (it.kind === 'melee') d.push(`урон ${it.dmg}`);
      if (it.kind === 'bow') d.push(`урон ${it.dmg} + стрела`);
      if (it.kind === 'wand') d.push(`урон ${it.dmg}, мана ${it.mana}`);
      if (it.kind === 'tile') d.push('ставится');
      if (it.kind === 'wall') d.push('стена фона (ставится)');
      if (it.use === 'heal') d.push(`+${it.heal} здоровья`);
      if (it.use === 'life') d.push('+20 к здоровью навсегда');
      if (it.use === 'mana') d.push('+20 к мане навсегда');
      if (it.use === 'boss') d.push(it.night ? 'зовёт босса (только ночью)' : 'зовёт босса');
      if (it.use === 'recall') d.push('домой за 1,5 с (не тратится)');
      if (it.acc === 'jump') d.push('прыжок выше (пока в вещах)');
      if (it.acc === 'glide') d.push('второй прыжок и парение (пока в вещах)');
      if (it.mod) d.push('мод: ' + it.mod);
      return d.join(' — ');
    }

    // ═══ Каркас ═══
    U.build = r => {
      addCss();
      root = r;
      const wrap = root.querySelector('.pz-wrap');
      wrap.insertAdjacentHTML('beforeend', `
        <div class="pz-hurt"></div>
        <div class="pz-hud">
          <div class="pz-life"><div class="pz-hearts"></div><div class="pz-stars"></div><span class="pz-hp-n"></span><div class="pz-buffs"></div><div class="pz-goal" title="Цель — нажми, чтобы увидеть все"></div></div>
          <div class="pz-bar pz-hot"></div>
          <div class="pz-btns">
            <button type="button" class="pz-b" data-a="inv" title="Вещи и крафт (Esc / I)" aria-label="Вещи и крафт">🎒</button>
            <button type="button" class="pz-b" data-a="smart" title="Умный курсор (Ctrl): сам выберет блок к курсору" aria-label="Умный курсор" aria-pressed="false">🎯</button>
            <button type="button" class="pz-b" data-a="zin" title="Ближе (+)" aria-label="Ближе">＋</button>
            <button type="button" class="pz-b" data-a="zout" title="Дальше (−)" aria-label="Дальше">－</button>
            <button type="button" class="pz-b" data-a="pause" title="Меню (P)" aria-label="Меню">⏸</button>
          </div>
        </div>
        <div class="pz-sel-name"></div>
        <div class="pz-status"></div>
        <div class="pz-toasts" aria-live="polite"></div>
        <div class="pz-boss" hidden><span></span><div><i></i></div></div>
        <div class="pz-talk" hidden></div>
        <div class="pz-panel" hidden></div>
        <div class="pz-touch" hidden></div>
        <div class="pz-load" hidden><div class="pz-spin"></div><span>Мир строится…</span></div>
        <div class="pz-dead" hidden></div>
        <div class="pz-menu" hidden></div>
        <form class="pz-cmd" hidden><input maxlength="120" placeholder="/команда — /help" aria-label="Команда"><button class="pz-b" type="submit">↵</button></form>
        <div class="pz-hand" hidden></div>`);
      hudEl = wrap.querySelector('.pz-hud'); hotEl = wrap.querySelector('.pz-hot'); lifeEl = wrap.querySelector('.pz-life'); selName = wrap.querySelector('.pz-sel-name');
      statusEl = wrap.querySelector('.pz-status'); panel = wrap.querySelector('.pz-panel'); menuEl = wrap.querySelector('.pz-menu'); toastsEl = wrap.querySelector('.pz-toasts');
      talkEl = wrap.querySelector('.pz-talk'); bossEl = wrap.querySelector('.pz-boss'); loadEl = wrap.querySelector('.pz-load'); deadEl = wrap.querySelector('.pz-dead');
      cmdEl = wrap.querySelector('.pz-cmd'); handEl = wrap.querySelector('.pz-hand'); touchEl = wrap.querySelector('.pz-touch');
      hudEl.addEventListener('click', e => {
        const a = e.target.closest('[data-a]')?.dataset.a, sl = e.target.closest('[data-slot]');
        if (sl && !invOpen) { API.selSlot(+sl.dataset.slot); return; }
        if (sl && invOpen) { slotClick('inv', +sl.dataset.slot, e); return; }
        if (a === 'inv') U.toggleInv();
        else if (a === 'smart') API.setSmart(!G.opt.smart);
        else if (a === 'zin') API.zoom(1.12); else if (a === 'zout') API.zoom(.89);
        else if (a === 'pause') { if (G.state === 'play') API.pause(); }
      });
      // цель → весь список: ✅ сделано, 👉 сейчас, дальше
      lifeEl.querySelector('.pz-goal').addEventListener('click', e => {
        e.stopPropagation();
        const gl = API.goal(), cur = gl ? gl.i : API.GOALS.length;
        U.toast(API.GOALS.map((g, i) => (i < cur ? '✅ ' : i === cur ? '👉 ' : '▫️ ') + g[1]).join('\n'), 'info');
      });
      hotEl.addEventListener('contextmenu', e => { const sl = e.target.closest('[data-slot]'); if (sl && invOpen) { e.preventDefault(); slotClick('inv', +sl.dataset.slot, e, true); } });
      panel.addEventListener('click', onPanel);
      panel.addEventListener('contextmenu', e => { const sl = e.target.closest('[data-slot]'); if (sl) { e.preventDefault(); slotClick(sl.dataset.box, +sl.dataset.slot, e, true); } });
      menuEl.addEventListener('click', onMenu);
      talkEl.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'more' && G.talk) API.interactNear(); else if (a === 'close') U.talk(null); });
      cmdEl.addEventListener('submit', e => { e.preventDefault(); const v = cmdEl.querySelector('input').value; cmdEl.hidden = true; cmdEl.querySelector('input').blur(); if (v.trim()) API.runCommand(v); });
      cmdEl.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cmdEl.hidden = true; e.target.blur(); } });
      on(root, 'pointermove', e => { if (hand) { const b = wrap.getBoundingClientRect(); handEl.style.left = (e.clientX - b.left) + 'px'; handEl.style.top = (e.clientY - b.top) + 'px'; } });
      // предмет в «руке» бросили мимо панелей — выкинуть в мир
      on(root.querySelector('.pz-gl'), 'pointerdown', e => {
        if (!hand || e.button !== 0) return;
        e.stopPropagation();
        const p = G.pl; API.dropItem(hand.id, hand.n, p.x + p.w / 2 + p.dir * 1.2, p.y + .8, p.dir * 6, -4);
        hand = null; showHand(); U.inv();
      }, true);
      buildTouch(wrap);
      if (isTouch()) touchEl.hidden = false;
    };
    U.atlas = A => {
      A.canvas.toBlob(b => {
        if (!b || !root) return;
        if (atlasUrl) URL.revokeObjectURL(atlasUrl);
        atlasUrl = URL.createObjectURL(b);
        root.style.setProperty('--pz-atlas', `url(${atlasUrl})`);
      });
      lastHud = ''; U.hud(); if (invOpen) U.inv();
    };

    // ранили — красные края экрана на миг (k 0…1)
    U.hurt = k => {
      const el = root?.querySelector('.pz-hurt'); if (!el) return;
      el.style.transition = 'none'; el.style.opacity = String(k); void el.offsetWidth;
      el.style.transition = 'opacity .55s ease-out'; el.style.opacity = '0';
    };
    // ═══ Панель здоровья и ячеек ═══
    U.smart = v => { const b = hudEl?.querySelector('[data-a="smart"]'); if (b) { b.classList.toggle('on', !!v); b.setAttribute('aria-pressed', v ? 'true' : 'false'); } };
    U.hud = () => {
      if (!root || !G.CH) return;
      const CH = G.CH, bf = API.buffs(), hook = API.hasHook();
      // цель: что сделать сейчас (выполнил — короткий «✅» и следующая); проверяется каждый раз (4 раза в секунду)
      const gl = API.goal(), ge = lifeEl.querySelector('.pz-goal'), gk = gl ? gl.i : -1;
      if (ge && gl !== undefined && ge.dataset.k !== String(gk)) {   // undefined — мир ещё не готов
        if (ge.dataset.k && gl && +ge.dataset.k < gk) U.toast('✅ Цель выполнена! Дальше: ' + gl.text, 'good');
        else if (ge.dataset.k && +ge.dataset.k >= 0 && gk < 0) U.toast('✅ Все первые цели выполнены — дальше глубины, боссы и свои постройки', 'good');
        ge.dataset.k = String(gk);
        ge.innerHTML = gl ? `${gl.icon} <span>${esc(gl.text)}</span> <b>${gl.i + 1}/${gl.n}</b>` : '';
        ge.classList.remove('done'); void ge.offsetWidth; ge.classList.add('done');
      }
      const key = [CH.hp | 0, CH.maxHp, CH.mana | 0, CH.maxMana, CH.sel, G.A ? 1 : 0, hook ? 1 : 0, ...Object.keys(bf).map(k => k + Math.ceil(bf[k])), ...CH.inv.slice(0, 10).map(s => s ? s.id + ':' + s.n : '')].join('|');
      if (key === lastHud) return;
      lastHud = key;
      U.smart(G.opt.smart);
      // усиления: значок и сколько осталось
      const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      lifeEl.querySelector('.pz-buffs').innerHTML = Object.keys(bf).map(k => `<span class="pz-buff" title="${k === 'mine' ? 'Зелье шахтёра: копаешь быстрее' : 'Зелье сияния: светишь вокруг'}">${icon(k === 'mine' ? 'potion_miner' : 'potion_shine')}<b>${mmss(Math.ceil(bf[k]))}</b></span>`).join('');
      const hb = touchEl?.querySelector('[data-t="hook"]'); if (hb) hb.hidden = !hook;
      // сердца: каждое — 20 здоровья, неполное — бледнее
      const hearts = [], nh = Math.ceil(CH.maxHp / 20);
      for (let i = 0; i < nh; i++) { const f = Math.max(0, Math.min(1, (CH.hp - i * 20) / 20)); hearts.push(`<span style="opacity:${f <= 0 ? .18 : .35 + f * .65}">${icon('lifecrystal')}</span>`); }
      lifeEl.querySelector('.pz-hearts').innerHTML = hearts.join('');
      const stars = [], ns = Math.ceil(CH.maxMana / 20);
      for (let i = 0; i < ns; i++) { const f = Math.max(0, Math.min(1, (CH.mana - i * 20) / 20)); stars.push(`<span style="opacity:${f <= 0 ? .18 : .35 + f * .65}">${icon('manastar')}</span>`); }
      lifeEl.querySelector('.pz-stars').innerHTML = stars.join('');
      lifeEl.querySelector('.pz-hp-n').textContent = `❤ ${Math.max(0, CH.hp | 0)}/${CH.maxHp} · ★ ${CH.mana | 0}/${CH.maxMana}`;
      hotEl.innerHTML = CH.inv.slice(0, 10).map((s, i) => `<button type="button" class="pz-slot${i === CH.sel ? ' sel' : ''}" data-slot="${i}" data-box="inv" title="${s ? esc(descOf(s.id)) : 'Пусто'}"><i class="k">${(i + 1) % 10}</i>${s ? icon(s.id) + (s.n > 1 ? `<b>${s.n}</b>` : '') : ''}</button>`).join('');
      const s = CH.inv[CH.sel];
      selName.textContent = s ? nameOf(s.id) : '';
      if (bossEl && !bossEl.hidden && G.boss) bossEl.querySelector('i').style.width = Math.max(0, G.boss.hp / G.boss.maxHp * 100) + '%';
    };
    U.status = t => { if (statusEl) statusEl.textContent = t; if (G.boss && bossEl && !bossEl.hidden) bossEl.querySelector('i').style.width = Math.max(0, G.boss.hp / G.boss.maxHp * 100) + '%'; };

    // ═══ Вещи, крафт, сундук ═══
    U.toggleInv = v => {
      if (!G.CH || G.state !== 'play') return;
      invOpen = v ?? !invOpen;
      if (!invOpen) { G.chestOpen = null; if (hand) { API.give(hand.id, hand.n, G.pl.x, G.pl.y); hand = null; showHand(); } }
      panel.hidden = !invOpen;
      if (invOpen) U.inv();
      API.snd('click', { vol: .4 });
    };
    U.chest = k => { G.chestOpen = k; if (k) { invOpen = true; panel.hidden = false; U.inv(); } else if (invOpen) U.inv(); };
    function grid(box, items, n, from = 0){
      let h = '<div class="pz-grid">';
      for (let i = from; i < n; i++) { const s = items[i]; h += `<button type="button" class="pz-slot${box === 'inv' && i === G.CH.sel ? ' sel' : ''}" data-box="${box}" data-slot="${i}" title="${s ? esc(descOf(s.id)) : 'Пусто'}">${s ? icon(s.id) + (s.n > 1 ? `<b>${s.n}</b>` : '') : ''}</button>`; }
      return h + '</div>';
    }
    U.inv = () => {
      U.hud();
      if (!invOpen || !G.CH) return;
      let h = '';
      if (G.chestOpen && G.chests?.get(G.chestOpen)) {
        h += `<div class="pz-chest"><h4>📦 Сундук <button type="button" class="pz-b ghost" data-a="loot" style="height:28px;font-size:12px">Забрать всё</button> <button type="button" class="pz-b ghost" data-a="stash" style="height:28px;font-size:12px">Сложить всё</button></h4>${grid('chest', G.chests.get(G.chestOpen), API.CHEST_N)}</div>`;
      }
      h += `<h4>🎒 Вещи <span class="pz-note">ПКМ / долгое нажатие — половина, Shift — переложить</span></h4>
        <div class="pz-row pz-invbar"><button type="button" class="pz-b ghost" data-a="sort" title="Сложить стопки и разложить по видам (ячейки 1–0 не трогаем)">⇅ Сортировать</button>
          <button type="button" class="pz-b ghost" data-a="qstack" title="В сундуки рядом — то, что в них уже лежит (как в Террарии)">📦 В сундуки рядом</button>
          <button type="button" class="pz-b ghost" data-a="menu" title="Меню игры (P)">⚙ Меню</button></div>
        ${grid('inv', G.CH.inv, API.INV_N)}`;
      const list = API.craftList();
      const ok = list.filter(x => x.ok), near = list.filter(x => !x.ok && x.known);
      h += `<h4>🛠 Крафт <span class="pz-note">станок рядом: верстак, печь, наковальня</span></h4>
        <div class="pz-tabs"><button type="button" data-a="tab-ok" class="${craftTab === 'ok' ? 'on' : ''}">Можно сделать (${ok.length})</button><button type="button" data-a="tab-all" class="${craftTab === 'all' ? 'on' : ''}">Все рецепты</button></div>
        <div class="pz-craft">${(craftTab === 'ok' ? ok : list).slice(0, 80).map(x => recipeRow(x)).join('') || '<div class="pz-note">Пока нечего сделать. Наруби дерева 🪓 — из него верстак, платформы и факелы (с гелем).</div>'}</div>`;
      if (craftTab === 'ok' && near.length) h += `<div class="pz-note" style="margin-top:6px">Ещё ${near.length} рецептов ждут материалов — вкладка «Все рецепты».</div>`;
      const sc = panel.scrollTop;
      panel.innerHTML = h;
      panel.scrollTop = sc;
    };
    function recipeRow(x){
      const r = x.r, idx = API.PZ.RECIPES.indexOf(r);
      const st = r.st ? { workbench: '🔨 верстак', furnace: '🔥 печь', anvil: '⚒ наковальня' }[r.st] || r.st : 'руками';
      return `<button type="button" class="pz-rc${x.ok ? '' : ' no'}" data-rc="${idx >= 0 ? idx : 'm' + (G.modRecipes || []).indexOf(r)}" title="${esc(descOf(r.o))}">
        ${icon(r.o, 28)}<span class="nm">${esc(nameOf(r.o))}${r.n > 1 ? ' ×' + r.n : ''}<small>${x.okSt ? '' : '⚠ '}${st}</small></span>
        <span class="ing">${r.i.map(([k, n]) => `<span class="${API.count(k) >= n ? '' : 'lack'}">${icon(k, 18)}${API.count(k)}/${n}</span>`).join('')}</span></button>`;
    }
    function onPanel(e){
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'tab-ok' || a === 'tab-all') { craftTab = a.slice(4); U.inv(); return; }
      if (a === 'loot' || a === 'stash') { moveAll(a === 'loot'); return; }
      if (a === 'sort') { API.sortInv(); return; }
      if (a === 'qstack') { API.quickStack(); return; }
      if (a === 'menu') { U.toggleInv(false); API.pause(); return; }
      const rc = e.target.closest('[data-rc]');
      if (rc) {
        const v = rc.dataset.rc, r = v[0] === 'm' ? (G.modRecipes || [])[+v.slice(1)] : API.PZ.RECIPES[+v];
        if (r) { const n = API.craft(r, e.shiftKey ? 10 : 1); if (!n && rc.classList.contains('no')) API.toast('Не хватает материалов или станка рядом', 'bad'); }
        U.inv(); return;
      }
      const sl = e.target.closest('[data-slot]');
      if (sl) slotClick(sl.dataset.box, +sl.dataset.slot, e);
    }
    const boxItems = box => box === 'chest' ? G.chests.get(G.chestOpen) : G.CH.inv;
    function slotClick(box, i, e, half){
      const items = boxItems(box); if (!items) return;
      const s = items[i];
      // Shift: переложить между сундуком и вещами
      if (e.shiftKey && s && !hand) {
        const other = box === 'chest' ? G.CH.inv : G.chestOpen && G.chests.get(G.chestOpen);
        if (other) { let n = s.n; const mx = API.stackOf(s.id); for (let k = 0; k < other.length && n; k++) { const o = other[k]; if (o && o.id === s.id && o.n < mx) { const a = Math.min(n, mx - o.n); o.n += a; n -= a; } } for (let k = 0; k < other.length && n; k++) if (!other[k]) { other[k] = { id: s.id, n }; n = 0; } if (n) s.n = n; else items[i] = null; markChest(); U.inv(); }
        return;
      }
      if (!hand) {
        if (!s) return;
        if (half && s.n > 1) { const t = Math.ceil(s.n / 2); hand = { id: s.id, n: t }; s.n -= t; }
        else { hand = s; items[i] = null; }
      } else if (!s) {
        if (half) { items[i] = { id: hand.id, n: 1 }; hand.n--; if (!hand.n) hand = null; }
        else { items[i] = hand; hand = null; }
      } else if (s.id === hand.id) {
        const mx = API.stackOf(s.id), a = Math.min(half ? 1 : hand.n, mx - s.n);
        s.n += a; hand.n -= a; if (!hand.n) hand = null;
      } else if (!half) { items[i] = hand; hand = s; }
      markChest(); showHand(); U.inv(); API.snd('click', { vol: .3 });
    }
    function moveAll(toInv){
      const ch = G.chests.get(G.chestOpen); if (!ch) return;
      const [from, to] = toInv ? [ch, G.CH.inv] : [G.CH.inv, ch];
      for (let i = toInv ? 0 : 10; i < from.length; i++) {   // «сложить» — без панели ячеек
        const s = from[i]; if (!s) continue;
        let n = s.n; const mx = API.stackOf(s.id);
        for (let k = 0; k < to.length && n; k++) { const o = to[k]; if (o && o.id === s.id && o.n < mx) { const a = Math.min(n, mx - o.n); o.n += a; n -= a; } }
        for (let k = 0; k < to.length && n; k++) if (!to[k]) { to[k] = { id: s.id, n }; n = 0; }
        if (n) s.n = n; else from[i] = null;
      }
      markChest(); U.inv();
    }
    function markChest(){ if (!G.chestOpen) return; const [ax, ay] = G.chestOpen.split(',').map(Number); const c = G.chunks.get(PZ.key(ax >> 6, ay >> 6)); if (c) { c.mod = true; G.dirtySave.add(c); } }
    function showHand(){ handEl.hidden = !hand; if (hand) handEl.innerHTML = icon(hand.id, 34) + (hand.n > 1 ? `<b>${hand.n}</b>` : ''); }

    // ═══ Подсказки, Проводник, босс, смерть, загрузка ═══
    U.toast = (t, kind) => {
      if (!toastsEl) return;
      const d = document.createElement('div'); d.className = 'pz-toast ' + (kind || ''); d.textContent = t;
      toastsEl.appendChild(d);
      while (toastsEl.children.length > 4) toastsEl.firstChild.remove();
      setTimeout(() => d.remove(), kind === 'ach' || kind === 'boss' ? 4200 : 2800);
    };
    U.talk = (name, text) => {
      if (!talkEl) return;
      talkEl.hidden = !name;
      if (name) talkEl.innerHTML = `<b>${esc(name)}:</b> ${esc(text)}<div class="pz-row"><button type="button" class="pz-b ghost" data-a="more">💬 Ещё совет</button><button type="button" class="pz-b ghost" data-a="close">Пока!</button></div>`;
    };
    U.boss = m => { if (!bossEl) return; bossEl.hidden = !m; if (m) { bossEl.querySelector('span').textContent = (m.D.boss === 2 ? '🦉 ' : '🟢 ') + m.D.name; bossEl.querySelector('i').style.width = '100%'; } };
    let deadT = 0;
    U.dead = by => {
      if (!deadEl) return;
      clearInterval(deadT);
      deadEl.hidden = !by;
      if (!by) return;
      // совет по тому, кто победил (и что вещи целы) — смерть учит, а не только наказывает
      const tip = /лава/i.test(by) ? 'Лава жжёт даже в обсидиановой яме — ставь блоки мостиком и обходи с краю.'
        : /падени|высот/i.test(by) ? 'С высоты лучше спускаться по верёвке или лестнице; вода гасит падение.'
        : /филин/i.test(by) ? 'Филин кричит «!» перед пикированием — в этот миг отпрыгни в сторону.'
        : /великан/i.test(by) ? 'Великан сжимается перед прыжком — уходи из-под него и бей с края. Зелья лечения — H.'
        : /зомби/i.test(by) ? 'Ночью зомби много: построй дом с дверью — они её не открывают.'
        : 'Броня и меч получше — у наковальни. Зелья лечения — H, кристаллы жизни — +20 к здоровью.';
      const home = G.W?.bed ? 'у кровати' : 'у точки старта';
      const tick = () => { deadEl.innerHTML = `<div style="font-size:42px">💀</div><div>Ты погиб${by ? ' — ' + esc(by) : ''}</div><div class="pz-note">Вещи с тобой. Появишься ${home} через ${Math.max(0, Math.ceil(G.pl?.dead || 0))} с…</div><div class="pz-note" style="max-width:420px">💡 ${esc(tip)}</div>`; };
      tick(); deadT = setInterval(() => { if (!G.pl?.dead) { clearInterval(deadT); deadEl.hidden = true; } else tick(); }, 250);
    };
    U.loading = (v, t) => { if (!loadEl) return; loadEl.hidden = !v; if (t) loadEl.querySelector('span').textContent = t; };
    U.command = () => { if (!cmdEl || G.state !== 'play') return; cmdEl.hidden = false; const i = cmdEl.querySelector('input'); i.value = '/'; i.focus(); };
    U.modal = () => !!(menuKind || (cmdEl && !cmdEl.hidden));
    U.closeTop = () => {
      if (cmdEl && !cmdEl.hidden) { cmdEl.hidden = true; return; }
      if (menuKind === 'pause') { API.resume(); return; }
      if (menuKind && menuKind !== 'start') { U.menu(G.state === 'menu' ? 'start' : 'pause'); return; }
    };
    U.invOpen = () => invOpen;
    // Esc на паузе и в окнах меню (во время игры Esc разбирает сама игра — keysOnce)
    on(window, 'keydown', e => {
      if (e.key !== 'Escape' || !menuKind || G.state === 'play' || e.target?.closest?.('input, textarea')) return;
      e.preventDefault();
      if (menuKind === 'pause') API.resume();
      else if (menuKind !== 'start') U.menu(G.state === 'menu' ? 'start' : 'pause');
    });

    // ═══ Меню ═══
    U.menu = async kind => {
      menuKind = kind;
      if (!menuEl) return;
      menuEl.hidden = !kind;
      if (!kind) { menuEl.innerHTML = ''; return; }
      if (kind === 'start') return startMenu();
      if (kind === 'pause') {
        menuEl.innerHTML = `<div class="pz-card" style="max-width:420px">
          <h2>⏸ Пауза</h2><p class="pz-note">${esc(G.W?.name || '')} · день ${G.W?.day || 1} · зерно ${esc(G.W?.seedText || G.W?.seed || '')}</p>
          <div class="pz-row" style="flex-direction:column;align-items:stretch">
            <button type="button" class="pz-b pri pz-big" data-a="resume">▶ Продолжить</button>
            <button type="button" class="pz-b" data-a="save">💾 Сохранить</button>
            <button type="button" class="pz-b" data-a="opts">⚙️ Настройки игры</button>
            <button type="button" class="pz-b" data-a="ach">🏆 Достижения</button>
            <button type="button" class="pz-b" data-a="wmods">🧩 Моды мира</button>
            <button type="button" class="pz-b" data-a="share">📣 Позвать друга (зерно мира)</button>
            <button type="button" class="pz-b" data-a="help">❓ Как играть</button>
            <button type="button" class="pz-b ghost" data-a="exit">🚪 Сохранить и выйти в меню</button>
          </div></div>`;
        return;
      }
      if (kind === 'help') { menuEl.innerHTML = helpHtml(); return; }
      if (kind === 'opts') { menuEl.innerHTML = optsHtml(); return; }
      if (kind === 'ach') { menuEl.innerHTML = achHtml(); return; }
      if (kind === 'newworld') { menuEl.innerHTML = await newWorldHtml(); return; }
      if (kind === 'newchar') { menuEl.innerHTML = newCharHtml(); return; }
      if (kind === 'mods' || kind === 'wmods') { menuEl.innerHTML = '<div class="pz-card pz-mods"><div class="pz-spin"></div></div>'; window.PZMods ? window.PZMods.renderMenu(menuEl.firstChild, API, kind === 'wmods', () => U.menu(G.state === 'menu' ? 'start' : 'pause')) : menuEl.innerHTML = '<div class="pz-card">Моды не загрузились</div>'; return; }
    };
    async function startMenu(){
      const [chars, worlds] = await Promise.all([API.listChars(), API.listWorlds()]);
      const last = API.last() || {};
      if (!selChar || !chars.some(c => c.id === selChar)) selChar = (chars.find(c => c.id === last.c) || chars[0])?.id || null;
      if (!selWorld || !worlds.some(w => w.id === selWorld)) selWorld = (worlds.find(w => w.id === last.w) || worlds[0])?.id || null;
      const fresh = !chars.length && !worlds.length;
      menuEl.innerHTML = `<div class="pz-card">
        <h2>⛏ Подземье</h2>
        <p>Бесконечный мир сбоку: копай вглубь хоть на километры, строй дом, плавь руду, переживи ночь и победи боссов. Мир можно расширять модами.</p>
        ${fresh ? `<div class="pz-row"><button type="button" class="pz-b pri pz-big" data-a="quick">▶ Новая игра</button><span class="pz-note">Создадим героя и мир — сразу играть</span></div>` : ''}
        <div class="pz-cols">
          <section><h3>🧑 Персонаж</h3><div class="pz-list">${chars.map(c => `<div class="pz-it${c.id === selChar ? ' on' : ''}" data-char="${esc(c.id)}"><span>❤</span><span class="tx"><b>${esc(c.name)}</b><small>здоровье ${c.maxHp} · ${fmtTime(c.playtime)}</small></span>
            <button type="button" class="ib" data-a="expchar" data-id="${esc(c.id)}" title="Сохранить в файл">📤</button><button type="button" class="ib" data-a="delchar" data-id="${esc(c.id)}" title="Удалить">🗑</button></div>`).join('') || '<div class="pz-note">Пока нет — создай.</div>'}</div>
            <div class="pz-row"><button type="button" class="pz-b" data-a="newchar">➕ Новый</button><button type="button" class="pz-b ghost" data-a="impchar">📥 Из файла</button></div></section>
          <section><h3>🌍 Мир</h3><div class="pz-list">${worlds.map(w => `<div class="pz-it${w.id === selWorld ? ' on' : ''}" data-world="${esc(w.id)}"><span>🌍</span><span class="tx"><b>${esc(w.name)}</b><small>глубже всего ${w.maxDepth || 0} м · день ${w.day || 1} · ${fmtTime(w.playtime)}${w.mods?.length ? ' · 🧩 ' + w.mods.length : ''}</small></span>
            <button type="button" class="ib" data-a="expworld" data-id="${esc(w.id)}" title="Сохранить в файл">📤</button><button type="button" class="ib" data-a="delworld" data-id="${esc(w.id)}" title="Удалить">🗑</button></div>`).join('') || '<div class="pz-note">Пока нет — создай.</div>'}</div>
            <div class="pz-row"><button type="button" class="pz-b" data-a="newworld">➕ Новый мир</button><button type="button" class="pz-b ghost" data-a="impworld">📥 Из файла</button></div></section>
        </div>
        <div class="pz-row"><button type="button" class="pz-b pri pz-big" data-a="play" ${selChar && selWorld ? '' : 'disabled'}>▶ Играть</button>
          <button type="button" class="pz-b" data-a="mods">🧩 Моды</button><button type="button" class="pz-b" data-a="help">❓ Как играть</button><button type="button" class="pz-b" data-a="opts">⚙️ Настройки</button></div>
        <p class="pz-note" style="margin-top:10px">Сохраняется в этом браузере (мир — только изменённые места, поэтому он бесконечный и лёгкий). Файлом 📤 можно перенести на другое устройство.</p>
      </div>`;
    }
    function helpHtml(){
      return `<div class="pz-card pz-help"><h2>❓ Как играть</h2>
        <h3>💻 Клавиатура и мышь (как в Террарии)</h3><ul>
          <li><b>A / D</b> или ←/→ — идти, <b>Пробел</b> — прыжок (держи — выше), <b>W / S</b> — лезть по верёвке и лестнице, <b>S</b> — спрыгнуть с платформы</li>
          <li><b>ЛКМ</b> — то, что в руке: кирка копает, блок ставится, меч бьёт. <b>ПКМ</b> — открыть дверь или сундук, поговорить, съесть. Копать и ставить не спорят — решает только предмет в руке</li>
          <li><b>Ctrl</b> — умный курсор (вкл/выкл, кнопка 🎯): кирка сама берёт ближайший блок к курсору, блок встаёт в ближайшее место, где держится. <b>Shift</b> (держать) — сам возьмёт инструмент под курсор: руда — лучшую кирку, дерево — топор, в темноте — факел (факел или блок в руке не меняет; стены ломает только молоток, который взял сам)</li>
          <li>Рамка у курсора: белая — достаёт, красная — далеко; блок в руке — видно, где встанет (зелёный — можно). Пунктирный круг — докуда достаёт рука</li>
          <li><b>1…0</b> или колесо — ячейка, <b>Esc / I</b> — вещи и крафт (там же ⇅ сортировка и 📦 «в сундуки рядом»), <b>H</b> — лечение, <b>B</b> — зелья-усиления, <b>E</b> — крюк-кошка (без крюка — действие рядом), <b>P</b> — меню, <b>+ / −</b> или Ctrl+колесо — масштаб, <b>/</b> — команды</li></ul>
        <h3>🎮 Геймпад</h3><ul><li>Левый стик — идти, <b>A</b> — прыжок, правый стик — прицел (умный курсор всегда), <b>RT</b> — копать/бить/ставить, <b>X</b> — действие, <b>B</b> — крюк, <b>Y</b> — вещи, <b>LB/RB</b> — ячейки, <b>LT</b> — лечение, крестовина ↑ — усиления, <b>R3</b> — умный курсор для мыши, <b>Start</b> — меню</li></ul>
        <h3>📱 Телефон</h3><ul><li>Левый палец — джойстик (вверх/вниз — лезть), справа — <b>⤒</b> прыжок, <b>⚔</b> атака (сама по ближайшему врагу, нет врага — копает перед собой), <b>✋</b> действие, <b>🎒</b> вещи, <b>🪝</b> крюк (когда он есть).</li>
          <li>Палец по миру: держи — копать/ставить/бить в этом месте (подправится на ближайшую подходящую клетку), коротко — открыть дверь, сундук, поговорить.</li>
          <li><b>🎯 Режим строителя</b> — точный крестик: двигай его пальцем по экрану, коротко нажми — крестик туда, <b>✓</b> — копать или ставить ровно в крестике. Удобнее лёжа и во весь экран ⛶.</li></ul>
        <h3>🧭 С чего начать</h3><ol>
          <li>Наруби дерева 🪓 → в 🎒 сделай <b>верстак</b>. Рядом с ним — платформы, двери, стены.</li>
          <li>До ночи построй дом: стены сзади, дверь, факел (дерево + гель от слизней).</li>
          <li>Копай вниз ⛏: медь и железо → <b>печь</b> (камень, дерево, факелы) → слитки → <b>наковальня</b> → кирка и меч лучше.</li>
          <li>Кристаллы жизни ❤ в пещерах — +20 здоровья навсегда. Возвратный амулет — домой из глубины.</li>
          <li>Боссы: «Желейная приманка» (25 геля + гриб) и «Совиный манок» (только ночью). Победа даёт XP и монеты сайта.</li></ol>
        <p class="pz-note">Мир бесконечный: влево, вправо и вниз. Чем глубже — тем богаче руда и опаснее: пещеры, глубины, лавовый слой.</p>
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="back">← Назад</button></div></div>`;
    }
    function optsHtml(){
      const o = G.opt, chk = (k, t) => `<label class="pz-chk"><input type="checkbox" data-opt="${k}" ${o[k] ? 'checked' : ''}> ${t}</label>`;
      return `<div class="pz-card" style="max-width:460px"><h2>⚙️ Настройки игры</h2>
        <div class="pz-field"><span>Масштаб: <b data-zv>${Math.round(o.zoom * 100)}%</b></span><input type="range" min="60" max="190" step="5" value="${Math.round(o.zoom * 100)}" data-opt="zoom"></div>
        ${shadersHtml()}
        ${chk('smooth', 'Плавный свет (выкл — свет «клетками», как в старых играх)')}
        ${chk('back', 'Подземный фон в пещерах')}
        ${chk('parts', 'Частицы (крошки, искры)')}
        ${chk('autosave', 'Автосохранение каждые 45 с')}
        ${chk('fps', 'Показывать кадры в секунду и время кадра')}
        <div class="pz-row"><button type="button" class="pz-b" data-a="keys">🎮 Клавиши, звук, интерфейс сайта</button></div>
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="back">← Назад</button></div></div>`;
    }
    // «Шейдеры» — та же настройка сайта (⚙️ → Графика → «Шейдеры», js/engine/shade2d.js): меняется сразу, на живую
    function shadersHtml(){
      const S = window.D37Settings, SH = window.D37E?.shade2d; if (!S || !SH) return '';
      const cur = S.get('shaders'), now = cur === 'auto' ? ` — сейчас «${SH.PACKS[SH.pack()]?.name}»` : '';
      const opts = [['auto', 'Авто'], ['normal', 'Обычные'], ['pretty', 'Красивые'], ['ultra', 'Ультра'], ['retro', 'Ретро']];
      return `<div class="pz-field"><span>🎨 Шейдеры${now}</span><div class="pz-tabs pz-sh">${opts.map(([v, t]) => `<button type="button" data-shaders="${v}" class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>
        <small>Обычные — быстро; Красивые — свечение, рябь воды, жар над лавой, цвет края; Ультра — ещё мягче свет и больше искр; Ретро — крупные пиксели.</small>
        ${cur === 'retro' ? `<label class="pz-chk"><input type="checkbox" data-crt ${S.get('crt') ? 'checked' : ''}> Полоски старого телевизора (CRT)</label>` : ''}</div>`;
    }
    function achHtml(){
      const got = G.CH?.ach || {};
      return `<div class="pz-card"><h2>🏆 Достижения</h2><p class="pz-note">У персонажа «${esc(G.CH?.name || '')}»: ${Object.keys(got).length} из ${Object.keys(API.ACH).length}</p>
        <div class="pz-ach">${Object.entries(API.ACH).map(([k, [ic, t, d]]) => `<div class="${got[k] ? 'got' : ''}">${ic} <b>${esc(t)}</b><small>${esc(d)}</small></div>`).join('')}</div>
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="back">← Назад</button></div></div>`;
    }
    async function newWorldHtml(){
      const mods = window.PZMods ? await window.PZMods.installed(API) : [];
      const usable = mods.filter(m => m.game === 'tiles' || m.game === 'both');
      return `<div class="pz-card" style="max-width:480px"><h2>🌍 Новый мир</h2>
        <div class="pz-field"><span>Название</span><input data-f="name" maxlength="32" value="Мир ${new Date().toLocaleDateString('ru')}"></div>
        <div class="pz-field"><span>Зерно (необязательно)</span><input data-f="seed" maxlength="40" placeholder="случайное"><small>Одно и то же зерно — один и тот же мир у всех. Можно слово: «денчик».</small></div>
        ${usable.length ? `<h3>🧩 Моды в этом мире</h3>${usable.map(m => `<label class="pz-chk"><input type="checkbox" data-mod="${esc(m.id)}"> <b>${esc(m.name)}</b> <span class="pz-note">${esc(m.version || '')} · ${esc(m.author || '')}</span></label>`).join('')}` : '<p class="pz-note">Модов пока нет — их можно добавить в «🧩 Моды».</p>'}
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="mkworld">Создать</button><button type="button" class="pz-b ghost" data-a="back">Отмена</button></div></div>`;
    }
    function newCharHtml(){
      const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || 'Герой';
      return `<div class="pz-card" style="max-width:420px"><h2>🧑 Новый персонаж</h2>
        <p class="pz-note">Выглядит как твой персонаж сайта (гардероб 🎭). Здесь — вещи, здоровье и достижения.</p>
        <div class="pz-field"><span>Имя</span><input data-f="cname" maxlength="24" value="${esc(nick)}"></div>
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="mkchar">Создать</button><button type="button" class="pz-b ghost" data-a="back">Отмена</button></div></div>`;
    }
    const pickFile = accept => new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files?.[0] || null); i.click(); });
    const download = (name, obj) => { const b = new Blob([JSON.stringify(obj)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
    const ask = (t, txt) => window.GameKit?.ask ? window.GameKit.ask({ icon: '🗑', title: t, text: txt, yes: 'Удалить', no: 'Отмена', danger: true }) : Promise.resolve(confirm(t));
    async function onMenu(e){
      const shb = e.target.closest('[data-shaders]');
      if (shb) { window.D37Settings?.set('shaders', shb.dataset.shaders, { ui: true }); U.menu('opts'); return; }
      const ch = e.target.closest('[data-char]'), w = e.target.closest('[data-world]'), a = e.target.closest('[data-a]')?.dataset.a, id = e.target.closest('[data-id]')?.dataset.id;
      if (!a && ch) { selChar = ch.dataset.char; startMenu(); return; }
      if (!a && w) { selWorld = w.dataset.world; startMenu(); return; }
      switch (a) {
        case 'quick': {
          const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || 'Герой';
          const c = API.newCharRecord(nick), wr = API.newWorldRecord('Мой мир', '');
          await API.put('chars', c); await API.put('worlds', wr);
          selChar = c.id; selWorld = wr.id;
          U.menu(null); API.play(wr.id, c.id); return;
        }
        case 'play': if (selChar && selWorld) { U.menu(null); API.play(selWorld, selChar); } return;
        case 'newchar': U.menu('newchar'); return;
        case 'newworld': U.menu('newworld'); return;
        case 'mkchar': { const c = API.newCharRecord(menuEl.querySelector('[data-f="cname"]').value.trim() || 'Герой'); await API.put('chars', c); selChar = c.id; U.menu('start'); return; }
        case 'mkworld': {
          const mods = [...menuEl.querySelectorAll('[data-mod]:checked')].map(x => x.dataset.mod);
          const wr = API.newWorldRecord(menuEl.querySelector('[data-f="name"]').value.trim() || 'Мой мир', menuEl.querySelector('[data-f="seed"]').value, mods);
          await API.put('worlds', wr); selWorld = wr.id; U.menu('start'); return;
        }
        case 'delchar': if (await ask('Удалить персонажа?', 'Его вещи и достижения пропадут (если не сохранил в файл).')) { await API.deleteChar(id); startMenu(); } return;
        case 'delworld': if (await ask('Удалить мир?', 'Все постройки пропадут (если не сохранил в файл).')) { await API.deleteWorld(id); startMenu(); } return;
        case 'expchar': { const d = await API.exportChar(id); if (d) download(`podzem-${(d.char.name || 'hero').replace(/[^\wа-яё-]+/gi, '_')}.json`, d); return; }
        case 'expworld': { API.toast('Собираю файл мира…'); const d = await API.exportWorld(id); if (d) download(`podzem-world-${(d.world.name || 'world').replace(/[^\wа-яё-]+/gi, '_')}.json`, d); return; }
        case 'impchar': case 'impworld': {
          const f = await pickFile('.json,application/json'); if (!f) return;
          try { const d = JSON.parse(await f.text()); if (a === 'impchar') { const c = await API.importChar(d); selChar = c.id; } else { const wr = await API.importWorld(d); selWorld = wr.id; } API.toast('📥 Загружено', 'good'); startMenu(); }
          catch (er) { API.toast('Не получилось: ' + (er.message || er), 'bad'); }
          return;
        }
        case 'mods': U.menu('mods'); return;
        case 'wmods': U.menu('wmods'); return;
        case 'help': U.menu('help'); return;
        case 'opts': U.menu('opts'); return;
        case 'ach': U.menu('ach'); return;
        case 'keys': window.D37Settings?.open?.({ ctx: 'site', tab: 'controls' }); return;
        case 'back': U.menu(G.state === 'menu' ? 'start' : 'pause'); return;
        case 'resume': API.resume(); return;
        case 'save': API.saveAll().then(() => API.toast('💾 Сохранено', 'good')); return;
        case 'share': {
          const url = (window.D37Ref?.wrap || (u => u))(location.origin + '/games/podzem');   // 👥 с кодом приглашения (js/core/ref.js)
          const text = `Сыграй в «Подземье» на сайте dan4ik37! Мой мир — зерно «${G.W?.seedText || G.W?.seed}»: введи его в «Новый мир» — будет тот же мир.`;
          if (navigator.share) navigator.share({ title: 'Подземье', text, url }).catch(() => {});
          else navigator.clipboard?.writeText(text + ' ' + url).then(() => API.toast('Ссылка скопирована', 'good'), () => prompt('Скопируй:', text + ' ' + url));
          return;
        }
        case 'exit': await API.stopWorld(true); U.menu('start'); return;
      }
    }
    menuEl && 0;
    on(document, 'change', e => {
      if (!menuEl || !menuEl.contains(e.target)) return;
      if (e.target.matches?.('[data-crt]')) { window.D37Settings?.set('crt', !!e.target.checked, { ui: true }); return; }
      const k = e.target.dataset.opt; if (!k) return;
      if (k === 'zoom') { G.opt.zoom = +e.target.value / 100; menuEl.querySelector('[data-zv]').textContent = e.target.value + '%'; API.resize(); }
      else G.opt[k] = !!e.target.checked;
      API.saveOpt();
    });
    on(document, 'input', e => { if (menuEl?.contains(e.target) && e.target.dataset.opt === 'zoom') { G.opt.zoom = +e.target.value / 100; menuEl.querySelector('[data-zv]').textContent = e.target.value + '%'; API.resize(); } });

    // ═══ Управление пальцем ═══
    // как Террария на телефоне: слева джойстик, справа ⤒ прыжок, ⚔ атака (сама по ближайшему врагу, иначе — перед собой),
    // ✋ действие, 🎒 вещи, 🪝 крюк (если есть), 🎯 «режим строителя» — точный крестик (двигать пальцем) и ✓ «сюда».
    // Палец по миру: держи — копать/ставить/бить там (умный курсор подправит на соседнюю подходящую клетку), коротко —
    // открыть/поговорить.
    function buildTouch(wrap){
      touchEl.innerHTML = `<button type="button" class="tb" data-t="jump" style="right:16px;bottom:22px;width:74px;height:74px" aria-label="Прыжок">⤒</button>
        <button type="button" class="tb" data-t="use" style="right:100px;bottom:16px;width:62px;height:62px" aria-label="Атака: по ближайшему врагу, иначе — перед собой">⚔</button>
        <button type="button" class="tb" data-t="act" style="right:24px;bottom:108px;width:54px;height:54px;font-size:18px" aria-label="Действие">✋</button>
        <button type="button" class="tb" data-t="inv" style="right:94px;bottom:92px;width:50px;height:50px;font-size:18px" aria-label="Вещи">🎒</button>
        <button type="button" class="tb" data-t="hook" style="right:156px;bottom:86px;width:50px;height:50px;font-size:19px" aria-label="Крюк-кошка" hidden>🪝</button>
        <button type="button" class="tb" data-t="build" style="right:30px;bottom:176px;width:44px;height:44px;font-size:17px" aria-label="Режим строителя: точный крестик">🎯</button>
        <button type="button" class="tb" data-t="put" style="right:168px;bottom:16px;width:62px;height:62px;background:rgba(40,120,60,.6)" aria-label="Использовать там, где крестик" hidden>✓</button>
        <div class="pz-joy" hidden><i></i></div>`;
      const joyEl = touchEl.querySelector('.pz-joy'), knob = joyEl.querySelector('i');
      const ptr = new Map();
      const btn = (t, v) => { const b = touchEl.querySelector(`[data-t="${t}"]`); b?.classList.toggle('on', v); };
      touchEl.addEventListener('pointerdown', e => {
        const b = e.target.closest('[data-t]'); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        const t = b.dataset.t;
        try { b.setPointerCapture(e.pointerId); } catch (er) {}
        ptr.set(e.pointerId, { kind: 'btn', t });
        if (t !== 'build') btn(t, true);
        if (t === 'jump') { U.touch.jump = true; U.touch.jumpDown = true; }
        else if (t === 'use') { API.attackStart(); U.touch.front = true; U.touch.use = true; }
        else if (t === 'put') U.touch.use = true;
        else if (t === 'act') API.interactNear();
        else if (t === 'inv') U.toggleInv();
        else if (t === 'hook') API.toggleHook();
        else if (t === 'build') {
          const v = !U.touch.build; API.buildMode(v); btn('build', v);
          touchEl.querySelector('[data-t="put"]').hidden = !v;
          API.toast(v ? '🎯 Режим строителя: двигай крестик пальцем, ✓ — копать или ставить там' : 'Режим строителя выключен', 'info');
        }
      });
      const endBtn = e => {
        const q = ptr.get(e.pointerId); if (!q || q.kind !== 'btn') return;
        ptr.delete(e.pointerId); if (q.t !== 'build') btn(q.t, false);
        if (q.t === 'jump') U.touch.jump = false;
        if (q.t === 'use') { U.touch.use = false; U.touch.front = false; API.attackEnd(); }
        if (q.t === 'put') U.touch.use = false;
      };
      touchEl.addEventListener('pointerup', endBtn); touchEl.addEventListener('pointercancel', endBtn);
      // джойстик и палец по миру — на холсте
      const cv = wrap.querySelector('.pz-gl');
      cv.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'touch') return;
        if (touchEl.hidden) touchEl.hidden = false;
        if (G.state !== 'play' || U.modal()) return;
        e.preventDefault();
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        try { cv.setPointerCapture(e.pointerId); } catch (er) {}
        const lefty = !!window.D37Opt?.lefty, inJoy = (lefty ? x > r.width * .62 : x < r.width * .38) && y > r.height * .3;
        if (inJoy && ![...ptr.values()].some(q => q.kind === 'joy')) {
          ptr.set(e.pointerId, { kind: 'joy', ox: x, oy: y });
          joyEl.hidden = false; joyEl.style.left = x + 'px'; joyEl.style.top = y + 'px'; knob.style.transform = '';
          return;
        }
        if (U.touch.build) { ptr.set(e.pointerId, { kind: 'cross', x0: x, y0: y, lx: x, ly: y, t0: performance.now(), moved: false }); return; }   // строитель: палец — крестик
        const q = { kind: 'world', x0: x, y0: y, t0: performance.now(), moved: false, use: false };
        ptr.set(e.pointerId, q);
        API.aimTouch(x, y);
        q.timer = setTimeout(() => { if (ptr.get(e.pointerId) === q) { q.use = true; U.touch.use = true; } }, 180);
      });
      cv.addEventListener('pointermove', e => {
        const q = ptr.get(e.pointerId); if (!q) return;
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (q.kind === 'joy') {
          const R = 52, dx = (x - q.ox) / R, dy = (y - q.oy) / R, d = Math.hypot(dx, dy), k = d > 1 ? 1 / d : 1;
          U.touch.mx = d < .15 ? 0 : dx * k; U.touch.my = d < .15 ? 0 : dy * k;
          knob.style.transform = `translate(${dx * k * R}px,${dy * k * R}px)`;
        } else if (q.kind === 'cross') {   // крестик идёт за пальцем «вполсилы» — точно по клетке
          if (Math.hypot(x - q.x0, y - q.y0) > 8) q.moved = true;
          if (q.moved) API.buildMove((x - q.lx) * .6, (y - q.ly) * .6);
          q.lx = x; q.ly = y;
        } else if (q.kind === 'world') {
          if (Math.hypot(x - q.x0, y - q.y0) > 10) q.moved = true;
          API.aimTouch(x, y);
        }
      });
      const end = e => {
        const q = ptr.get(e.pointerId); if (!q) return;
        ptr.delete(e.pointerId);
        if (q.kind === 'joy') { U.touch.mx = U.touch.my = 0; joyEl.hidden = true; return; }
        if (q.kind === 'cross') { if (!q.moved && performance.now() - q.t0 < 300) API.buildSet(q.x0, q.y0); return; }   // короткое касание — крестик сюда
        if (q.kind === 'world') {
          clearTimeout(q.timer);
          if (!q.use && !q.moved && performance.now() - q.t0 < 260 && G.state === 'play') { if (!API.tapTouch(q.x0, q.y0)) API.useItem(); }
          if (![...ptr.values()].some(o => o.kind === 'world' && o.use)) U.touch.use = false;
        }
      };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    }

    U.dispose = () => {
      offs.forEach(f => f()); offs.length = 0;
      clearInterval(deadT);
      if (atlasUrl) URL.revokeObjectURL(atlasUrl);
      root = null;
    };
    return U;
  }
  window.PZUI = { create };
})();
