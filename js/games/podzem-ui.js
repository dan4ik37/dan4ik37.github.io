// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» ⛏ — ИНТЕРФЕЙС: здоровье и мана, цель, панель вещей, окно «Вещи» (вещи, крафт, сундук, описание вещи с
//  действиями), меню (старт, пауза, помощь, достижения, моды), подсказки, Проводник, полоса босса, нокаут, управление пальцем
// ═══════════════════════════════════════
// U = PZUI.create(G, API) — G: состояние игры (podzem.js), API: её функции. Значки предметов — из атласа (podzem-gl.js),
// одна картинка на всё (blob), позиция — CSS-переменные. Стили — свои (pz-*), вставляются один раз.
// Переделано 22.10.2026 (владелец: «интерфейс нереально неудобный, это ужас» — вещи и крафт, телефон, экран игры, меню):
// • раскладка по окну игры, а не по экрану (U.layout — зовёт resize игры): компьютер, телефон стоя (панель 2×5 справа),
//   телефон лёжа (низкая полоса сверху); ячейки и кнопки — не меньше 44 px; клавиши подписаны только на компьютере;
// • «Вещи» — окно с вкладками «Вещи / Сделать / Сундук» (широкое окно — два столбца); тап по вещи — что она делает и кнопки
//   «На панель», «В сундук», «Использовать», «Выбросить»; крафт — «Можно сделать» сверху, по станкам, кнопки «Сделать ×1/×5/всё»;
// • пальцем — подписанные кнопки (подпись «Копать / Удар / Ставить» — по вещи в руке), джойстик с подсказкой, в открытом окне
//   кнопок нет; левша (⚙️ → Управление) — зеркально;
// • меню паузы — общее меню сайта (D37Settings.menu), «🆘 Я застрял», настройки — вкладка «⛏ Подземье» в общем ⚙️;
// • «нокаут» вместо смерти (владелец: без жестокости) — затемнение и «Ты без сил», вещи с тобой.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `.pz [hidden]{display:none!important}
.pz{--pz-bg:rgba(17,15,30,.985);--pz-bg2:rgba(255,255,255,.06);--pz-line:rgba(255,255,255,.12);--pz-gold:#ffd84a;--pz-acc:var(--accent,#7c3aed);--pz-mut:#a9a6bd;--pz-cell:48px;--pz-top:72px;--pz-sc:var(--gs-touch,1);
  position:relative;user-select:none;-webkit-user-select:none;touch-action:none;color:#f2f0fa;font:500 14px/1.35 Montserrat,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.pz button{font-family:inherit}
.pz-wrap{position:relative;width:100%;height:520px;overflow:hidden;border-radius:14px;background:#0b0a14;box-shadow:0 10px 40px -18px rgba(0,0,0,.8)}
.gs-fs .pz-wrap{border-radius:0}
.pz-gl,.pz-ov{position:absolute;left:0;top:0;display:block}
.pz-gl{image-rendering:pixelated;image-rendering:crisp-edges}
.pz-ov{pointer-events:none}
.pz-hurt{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(150,40,0,0) 55%,rgba(200,70,30,.5) 100%)}
.pz-ic{--s:32px;display:inline-block;width:var(--s);height:var(--s);background-image:var(--pz-atlas);background-size:calc(var(--s) * 64) calc(var(--s) * 64);background-position:calc(var(--c) * var(--s) * -1) calc(var(--r) * var(--s) * -1);image-rendering:pixelated;flex:none;vertical-align:middle}
.pz kbd{font:700 10px/1 ui-monospace,Consolas,monospace;padding:2px 4px;border-radius:4px;background:rgba(255,255,255,.14);color:#e6e4f0}
.pz-t kbd,.pz-t .k{display:none!important}
/* ── экран игры: здоровье и мана, цель, панель вещей, кнопки ── */
.pz-box{position:absolute;left:10px;top:10px;z-index:3;display:flex;flex-direction:column;gap:5px;width:220px;pointer-events:none}
.pz-box>*{pointer-events:auto}
.pz-vit{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:12px;background:rgba(8,8,16,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.pz-bar{position:relative;height:16px;border-radius:8px;background:rgba(0,0,0,.55);overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.1) inset}
.pz-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:8px;transition:width .25s}
.pz-bar span{position:relative;display:block;padding:0 7px;font:800 11px/16px Montserrat,system-ui,sans-serif;text-shadow:0 1px 2px #000;white-space:nowrap}
.pz-hp i{background:linear-gradient(180deg,#ff6a7c,#d8203c)}
.pz-hp.low i{animation:pzLow 1s ease-in-out infinite}
@keyframes pzLow{50%{filter:brightness(1.5)}}
.pz-mp{height:11px}.pz-mp span{font-size:9px;line-height:11px}
.pz-mp i{background:linear-gradient(180deg,#7ab8ff,#2f6fd8)}
.pz-buffs{display:flex;gap:4px;flex-wrap:wrap}.pz-buffs:empty{display:none}
.pz-buff{display:inline-flex;align-items:center;gap:3px;padding:2px 7px 2px 2px;border-radius:9px;background:rgba(40,32,8,.7);font:800 11px/1 Montserrat,system-ui,sans-serif}
.pz-buff .pz-ic{--s:20px}
.pz-goal{display:flex;align-items:center;gap:6px;max-width:100%;min-height:32px;padding:5px 9px;border-radius:11px;background:rgba(40,32,8,.72);border:1px solid rgba(255,216,74,.4);color:#fff;font:700 12px/1.25 Montserrat,system-ui,sans-serif;cursor:pointer;text-align:left}
.pz-goal span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.pz-goal b{color:var(--pz-gold);font-weight:800;white-space:nowrap}
.pz-goal:empty{display:none}
.pz-goal.done{animation:pzIn .45s ease-out}
.pz-clock{display:none;align-self:flex-start;padding:3px 8px;border-radius:9px;background:rgba(8,8,16,.5);font:700 11px/1.2 Montserrat,system-ui,sans-serif;text-shadow:0 1px 2px #000}
.pz-t .pz-clock{display:block}
.pz-hot{position:absolute;z-index:3;top:8px;left:50%;display:grid;grid-template-columns:repeat(10,var(--pz-cell));gap:3px;padding:4px;border-radius:13px;background:rgba(8,8,16,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.pz-hb-grid .pz-hot{grid-template-columns:repeat(5,var(--pz-cell))}
.pz-slot{--s:calc(var(--pz-cell) * .66);position:relative;width:var(--pz-cell);height:var(--pz-cell);border-radius:10px;border:2px solid rgba(255,255,255,.12);background:rgba(30,32,52,.8);display:grid;place-items:center;padding:0;cursor:pointer;color:#fff;touch-action:manipulation}
.pz-slot:hover{border-color:rgba(255,255,255,.35)}
.pz-slot.sel{border-color:var(--pz-gold);background:rgba(76,66,24,.88);box-shadow:0 0 0 2px rgba(255,216,74,.3)}
.pz-slot.pick{border-color:#7cf0ff;box-shadow:0 0 0 3px rgba(124,240,255,.35)}
.pz-slot.hb{background:rgba(44,40,26,.82)}
.pz-slot.drop{border-style:dashed}
.pz-slot .pz-ic{--s:calc(var(--pz-cell) * .66)}
.pz-slot b{position:absolute;right:3px;bottom:1px;font:800 12px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 2px #000,0 0 3px #000}
.pz-slot .k{position:absolute;left:4px;top:3px;font:800 10px/1 Montserrat,system-ui,sans-serif;font-style:normal;opacity:.65}
.pz-btns{position:absolute;z-index:3;top:10px;right:10px;display:flex;gap:6px}
.pz-hbtn{display:inline-flex;align-items:center;gap:6px;height:44px;min-width:44px;padding:0 12px;border:0;border-radius:12px;background:rgba(14,14,28,.7);color:#fff;font:800 13px/1 Montserrat,system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.pz-hbtn:hover{background:rgba(60,56,100,.85)}
.pz-hbtn.on{background:rgba(255,216,74,.32);box-shadow:0 0 0 2px rgba(255,216,74,.55) inset}
.pz-hbtn .ic{font-size:18px}
.pz-hbtn[data-a="smart"] b{display:none}
.pz-t .pz-hbtn{padding:0;justify-content:center;width:46px}
.pz-t .pz-hbtn b,.pz-t .pz-hbtn[data-a="inv"],.pz-t .pz-hbtn[data-a="smart"]{display:none}
.pz-sel-name{position:absolute;z-index:3;top:calc(var(--pz-top) - 6px);left:50%;transform:translateX(-50%);padding:5px 12px;border-radius:10px;background:rgba(8,8,16,.6);font:800 13px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none;white-space:nowrap;transition:opacity .4s}
.pz-sel-name.off{opacity:0}
.pz-status{position:absolute;z-index:3;left:10px;bottom:8px;max-width:70%;padding:4px 10px;border-radius:9px;background:rgba(8,8,16,.4);font:600 12px/1.25 Montserrat,system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none}
.pz-t .pz-status{display:none}
.pz-boss{position:absolute;z-index:4;left:50%;top:calc(var(--pz-top) + 20px);transform:translateX(-50%);width:min(420px,80%);text-align:center;font:800 13px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none}
.pz-boss div{height:12px;border-radius:6px;background:rgba(0,0,0,.6);margin-top:4px;overflow:hidden;border:1px solid rgba(255,255,255,.2)}
.pz-boss i{display:block;height:100%;background:linear-gradient(90deg,#c040ff,#ff4070);transition:width .2s}
/* ── подсказки ── */
.pz-toasts{position:absolute;z-index:9;left:50%;top:calc(var(--pz-top) + 50px);transform:translateX(-50%);display:flex;flex-direction:column;gap:5px;align-items:center;pointer-events:none;width:min(480px,92%)}
.pz-modal .pz-toasts{top:auto;bottom:96px}
.pz-toast{max-width:100%;padding:7px 13px;border-radius:12px;box-shadow:0 8px 24px -10px rgba(0,0,0,.8);background:rgba(14,13,26,.9);border:1px solid rgba(255,255,255,.14);font:700 13px/1.3 Montserrat,system-ui,sans-serif;text-align:center;animation:pzIn .2s ease-out;transition:opacity .35s}
.pz-toast.out{opacity:0}
.pz-toast.bad{border-color:rgba(255,120,90,.55)}.pz-toast.good{border-color:rgba(90,255,140,.45)}.pz-toast.ach,.pz-toast.goal{border-color:rgba(255,216,74,.7);background:rgba(50,40,10,.92)}.pz-toast.boss{border-color:rgba(200,90,255,.7);font-size:15px}
.pz-toast.info{white-space:pre-line;text-align:left}
@keyframes pzIn{from{opacity:0;transform:translateY(-6px)}}
.pz-goals{position:absolute;z-index:10;left:10px;top:var(--pz-top);width:min(420px,calc(100% - 20px));max-height:calc(100% - var(--pz-top) - 10px);overflow:auto;padding:12px 14px;border-radius:14px;background:var(--pz-bg);border:1px solid rgba(255,216,74,.45);box-shadow:0 18px 50px -12px rgba(0,0,0,.85)}
.pz-goals h4{margin:0 0 8px;font:800 14px/1.2 Montserrat,system-ui,sans-serif;color:var(--pz-gold)}
.pz-goals li{margin:4px 0;list-style:none}.pz-goals ul{margin:0;padding:0}
.pz-goals li.now{font-weight:800;color:#fff}.pz-goals li.done{opacity:.6}
/* ── Проводник ── */
.pz-talk{position:absolute;z-index:6;left:50%;bottom:16px;transform:translateX(-50%);width:min(500px,92%);padding:12px 14px;border-radius:14px;background:rgba(30,24,10,.95);border:1px solid rgba(255,216,74,.5);box-shadow:0 10px 30px -10px #000}
.pz-t .pz-talk{bottom:auto;top:var(--pz-top)}
.pz-talk b{color:var(--pz-gold)}
/* ── кнопки ── */
.pz-b{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:44px;padding:0 14px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:var(--pz-bg2);color:#fff;font:700 14px/1.1 Montserrat,system-ui,sans-serif;cursor:pointer;text-align:center}
.pz-b:hover{background:rgba(124,58,237,.28);border-color:rgba(167,139,250,.55)}
.pz-b.pri{background:var(--pz-acc);border-color:transparent}
.pz-b.pri:hover{filter:brightness(1.12)}
.pz-b.ghost{background:transparent}
.pz-b.warn{color:#fca5a5}
.pz-b.sm{min-height:36px;padding:0 10px;font-size:12px}
.pz-b:disabled{opacity:.45;cursor:default;filter:none}
.pz-big{min-height:56px!important;font-size:18px!important;padding:0 22px!important}
.pz-big small{display:block;font:600 12px/1.2 Montserrat,system-ui,sans-serif;opacity:.85}
.pz-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.pz-note{font-size:12px;color:var(--pz-mut)}
.pz-err{color:#ff9a9a;font-size:12px}
/* ── окно «Вещи»: вещи, крафт, сундук ── */
.pz-inv{position:absolute;z-index:7;top:8px;bottom:8px;left:50%;transform:translateX(-50%);width:min(1000px,calc(100% - 16px));display:flex;flex-direction:column;border-radius:16px;background:var(--pz-bg);border:1px solid var(--pz-line);box-shadow:0 20px 60px -14px rgba(0,0,0,.85);overflow:hidden}
.pz-inv-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;border-bottom:1px solid var(--pz-line)}
.pz-inv-head h3{margin:0;font:800 16px/1.2 Montserrat,system-ui,sans-serif;white-space:nowrap}
.pz-tabs2{display:flex;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.pz-tabs2 button{flex:none;min-height:44px;padding:0 14px;border:0;border-radius:11px;background:var(--pz-bg2);color:#cfcbe0;font:800 14px/1 Montserrat,system-ui,sans-serif;cursor:pointer}
.pz-tabs2 button.on{background:var(--pz-acc);color:#fff}
.pz-tabs2 i{font-style:normal;display:inline-block;min-width:20px;padding:2px 5px;margin-left:4px;border-radius:9px;background:rgba(255,216,74,.9);color:#201a00;font-size:11px}
.pz-x{flex:none;width:44px;height:44px;border:0;border-radius:12px;background:var(--pz-bg2);color:#fff;font:800 18px/1 Montserrat,system-ui,sans-serif;cursor:pointer}
.pz-x:hover{background:rgba(255,90,90,.35)}
.pz-inv-body{flex:1;min-height:0;display:flex;gap:14px;padding:10px 12px}
.pz-sec{min-width:0;overflow-y:auto;overscroll-behavior:contain}
.pz-inv.wide .pz-sec-items{flex:none}
.pz-inv.wide .pz-sec-craft{flex:1;border-left:1px solid var(--pz-line);padding-left:14px}
.pz-inv.wide .pz-tabs2 [data-tab]{display:none}
.pz-inv:not(.wide) .pz-sec{flex:1}
.pz-inv:not(.wide) .pz-sec:not(.on){display:none}
.pz-sec h4{margin:4px 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:800 13px/1.2 Montserrat,system-ui,sans-serif;color:#dcd8ee}
.pz-sec h4 small{font-weight:600;color:var(--pz-mut)}
.pz-tools{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}
.pz-grid{display:grid;grid-template-columns:repeat(var(--cols,10),var(--pz-cell));gap:4px;margin-bottom:10px}
.pz-grid .pz-slot{--pz-cell:inherit}
.pz-sep{grid-column:1/-1;height:1px;background:var(--pz-line);margin:2px 0}
.pz-det{flex:none;display:flex;align-items:center;gap:10px;min-height:68px;padding:8px 12px;border-top:1px solid var(--pz-line);background:rgba(0,0,0,.25)}
.pz-det .pz-ic{--s:44px}
.pz-det .tx{flex:1;min-width:0}
.pz-det .tx b{display:block;font-size:15px}
.pz-det .tx small{display:block;color:#cfcbe0;font-size:12px;line-height:1.35}
.pz-det .acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.pz-inv:not(.wide) .pz-det{flex-wrap:wrap}
.pz-inv:not(.wide) .pz-det .acts{width:100%;justify-content:flex-start}
.pz-filters{display:flex;gap:4px;margin:0 0 8px;flex-wrap:wrap}
.pz-filters button{min-height:40px;padding:0 12px;border:0;border-radius:10px;background:var(--pz-bg2);color:#cfcbe0;font:700 13px/1 Montserrat,system-ui,sans-serif;cursor:pointer}
.pz-filters button.on{background:rgba(255,216,74,.25);color:#fff;box-shadow:0 0 0 1px rgba(255,216,74,.5) inset}
.pz-grp{margin:10px 0 4px;font:800 12px/1.2 Montserrat,system-ui,sans-serif;color:var(--pz-mut);text-transform:uppercase;letter-spacing:.04em}
.pz-grp.need{color:#ffb4a0}
.pz-rc{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;margin:0 0 5px;padding:6px 10px;border-radius:12px;background:var(--pz-bg2);border:1px solid transparent;color:#fff;text-align:left;cursor:pointer;font:inherit}
.pz-rc:hover{border-color:rgba(255,255,255,.2)}
.pz-rc.ok{background:rgba(40,90,50,.32);border-color:rgba(110,230,140,.25)}
.pz-rc.sel{border-color:var(--pz-gold);box-shadow:0 0 0 1px rgba(255,216,74,.4) inset}
.pz-rc .pz-ic{--s:36px}
.pz-rc .nm{flex:1;min-width:0;font-weight:800}
.pz-rc .nm small{display:block;font-weight:600;font-size:11px;color:var(--pz-mut)}
.pz-rc .nm small.bad{color:#ffb4a0}
.pz-rc .ing{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;max-width:52%}
.pz-rc .ing span{display:inline-flex;align-items:center;gap:2px;font:800 12px/1 Montserrat,system-ui,sans-serif}
.pz-rc .ing .pz-ic{--s:22px}
.pz-rc .ing .lack{color:#ff9a8a}
.pz-rcd{margin:-2px 0 8px;padding:8px 10px 10px;border-radius:0 0 12px 12px;background:rgba(255,216,74,.07);border:1px solid rgba(255,216,74,.25);border-top:0}
.pz-rcd p{margin:0 0 6px;font-size:12px;color:#ddd9ee}
.pz-hand{position:absolute;z-index:20;pointer-events:none;transform:translate(-50%,-50%)}
.pz-hand b{position:absolute;right:-4px;bottom:-4px;font:800 12px/1 Montserrat,system-ui,sans-serif;text-shadow:0 1px 2px #000}
.pz-t .pz-hand{display:none}
.pz-tip{position:absolute;z-index:21;max-width:280px;padding:8px 10px;border-radius:10px;background:rgba(10,10,20,.96);border:1px solid var(--pz-line);font:600 12px/1.35 Montserrat,system-ui,sans-serif;pointer-events:none;box-shadow:0 8px 24px -8px #000}
.pz-tip b{display:block;font-size:13px;margin-bottom:2px}
.pz-t .pz-tip{display:none}
/* ── меню (старт, помощь, достижения…) ── */
.pz-menu{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:10px;background:rgba(6,6,14,.66);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.pz-card{width:min(760px,100%);max-height:100%;overflow:auto;overscroll-behavior:contain;padding:16px;border-radius:18px;background:var(--pz-bg);border:1px solid var(--pz-line);box-shadow:0 24px 60px -16px rgba(0,0,0,.9)}
.pz-card h2{margin:0 0 6px;font:500 26px/1.1 var(--font-display,'Oswald','Arial Narrow',sans-serif);letter-spacing:.04em;text-transform:uppercase}
.pz-card h3{margin:14px 0 6px;font:800 14px/1.2 Montserrat,system-ui,sans-serif;color:#dcd8ee}
.pz-card p{margin:0 0 8px;color:#dcd8ee}
.pz-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.pz-n .pz-cols{grid-template-columns:1fr}
.pz-list{display:flex;flex-direction:column;gap:6px;max-height:230px;overflow:auto}
.pz-it{display:flex;align-items:center;gap:8px;min-height:56px;padding:6px 8px 6px 12px;border-radius:12px;background:var(--pz-bg2);border:2px solid transparent;cursor:pointer}
.pz-it.on{border-color:var(--pz-gold);background:rgba(255,216,74,.1)}
.pz-it .tx{flex:1;min-width:0}
.pz-it .tx b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pz-it .tx small{color:var(--pz-mut);font-size:11px}
.pz-it .ib{width:40px;height:40px;border:0;border-radius:10px;background:transparent;color:#fff;font-size:17px;cursor:pointer;opacity:.75}
.pz-it .ib:hover{opacity:1;background:rgba(255,255,255,.08)}
.pz-field{display:flex;flex-direction:column;gap:5px;margin:10px 0}
.pz-field input,.pz-field select{min-height:44px;border:1px solid rgba(255,255,255,.18);border-radius:11px;background:rgba(255,255,255,.06);color:#fff;padding:9px 12px;font:600 15px/1.2 Montserrat,system-ui,sans-serif}
.pz-field small{color:var(--pz-mut)}
.pz-chk{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer}
.pz-chk input{width:20px;height:20px}
.pz-help details{margin:8px 0;border-radius:12px;background:var(--pz-bg2);padding:4px 12px}
.pz-help summary{min-height:44px;display:flex;align-items:center;font-weight:800;cursor:pointer}
.pz-help li{margin:4px 0}
.pz-ach{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px}
.pz-ach div{padding:9px;border-radius:11px;background:var(--pz-bg2);opacity:.55}
.pz-ach div.got{opacity:1;background:rgba(255,216,74,.12)}
.pz-ach small{display:block;color:var(--pz-mut)}
.pz-mods .pz-it{cursor:default}
.pz-start .pz-play{width:100%;margin:6px 0 4px}
.pz-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.pz-foot .pz-b{flex:1 1 140px}
/* меню паузы (окно сайта D37Settings.menu) — в низком окне в два столбца */
.pz-s .gs-menu-box{width:min(620px,calc(100% - 24px));display:grid;grid-template-columns:1fr 1fr;align-content:start}
.pz-s .gs-menu-head,.pz-s .gs-menu-it.primary{grid-column:1/-1}
.pz .gs-menu-it{min-height:48px}
/* ── нокаут (вместо «смерти»), загрузка ── */
.pz-ko,.pz-load{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;font:800 18px/1.3 Montserrat,system-ui,sans-serif}
.pz-load{background:rgba(6,6,14,.84)}
.pz-ko{background:radial-gradient(ellipse at center,rgba(10,10,24,.55) 20%,rgba(4,4,10,.86) 100%);animation:pzKo .6s ease-out}
@keyframes pzKo{from{opacity:0}}
.pz-ko .big{font-size:34px;letter-spacing:.04em;color:#ffe9a0;text-shadow:0 2px 10px rgba(0,0,0,.8)}
.pz-ko .stars{font-size:40px;animation:pzSpinS 2.2s linear infinite}
@keyframes pzSpinS{to{transform:rotate(360deg)}}
.pz-ko .tip{max-width:440px;font-size:14px;font-weight:600;color:#dcd8ee}
.pz-spin{width:38px;height:38px;border-radius:50%;border:4px solid rgba(255,255,255,.15);border-top-color:var(--pz-gold);animation:pzSpin .8s linear infinite}
@keyframes pzSpin{to{transform:rotate(360deg)}}
.pz-cmd{position:absolute;z-index:9;left:8px;right:8px;bottom:34px;display:flex;gap:6px}
.pz-cmd input{flex:1;min-height:44px;border:1px solid rgba(255,255,255,.2);border-radius:11px;background:rgba(10,10,20,.92);color:#fff;padding:9px 11px;font:600 14px/1 ui-monospace,monospace}
/* ── управление пальцем: слева джойстик, справа кнопки с подписями (левша — наоборот) ── */
.pz-touch{position:absolute;inset:0;z-index:4;pointer-events:none}
.pz-modal .pz-touch{display:none}
.pz-tc{position:absolute;right:0;bottom:0;width:calc(250px * var(--pz-sc));height:calc(260px * var(--pz-sc))}
.gs-lefty .pz-tc{right:auto;left:0;transform:scaleX(-1)}
.gs-lefty .pz-tc .tb>*{transform:scaleX(-1)}
.pz-touch .tb{position:absolute;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:0;border-radius:50%;background:rgba(18,18,36,.62);color:#fff;font:800 22px/1 Montserrat,system-ui,sans-serif;box-shadow:0 0 0 2px rgba(255,255,255,.2) inset;opacity:var(--gs-touch-a,1);touch-action:none;width:calc(var(--d) * var(--pz-sc));height:calc(var(--d) * var(--pz-sc));right:calc(var(--x) * var(--pz-sc));bottom:calc(var(--y) * var(--pz-sc))}
.pz-touch .tb b{font:800 calc(10px * var(--pz-sc))/1 Montserrat,system-ui,sans-serif;letter-spacing:.02em;text-shadow:0 1px 2px #000;white-space:nowrap}
.pz-touch .tb .i{font-size:calc(var(--d) * var(--pz-sc) * .34);line-height:1}
.pz-touch .tb.on{background:rgba(255,216,74,.45)}
.pz-touch .tb.ok{background:rgba(40,130,70,.7)}
.pz-touch .tb.near{box-shadow:0 0 0 3px rgba(255,216,74,.85) inset}
.pz-joyhint{position:absolute;left:calc(26px * var(--pz-sc));bottom:calc(30px * var(--pz-sc));width:calc(120px * var(--pz-sc));height:calc(120px * var(--pz-sc));border-radius:50%;border:2px dashed rgba(255,255,255,.28);display:grid;place-items:center;text-align:center;font:800 11px/1.25 Montserrat,system-ui,sans-serif;color:rgba(255,255,255,.75);text-shadow:0 1px 2px #000;pointer-events:none;opacity:var(--gs-touch-a,1)}
.gs-lefty .pz-joyhint{left:auto;right:calc(26px * var(--pz-sc))}
.pz-joy{position:absolute;width:calc(124px * var(--pz-sc));height:calc(124px * var(--pz-sc));margin:calc(-62px * var(--pz-sc)) 0 0 calc(-62px * var(--pz-sc));border-radius:50%;background:rgba(255,255,255,.09);box-shadow:0 0 0 2px rgba(255,255,255,.2) inset;pointer-events:none}
.pz-joy i{position:absolute;left:50%;top:50%;width:calc(52px * var(--pz-sc));height:calc(52px * var(--pz-sc));margin:calc(-26px * var(--pz-sc)) 0 0 calc(-26px * var(--pz-sc));border-radius:50%;background:rgba(255,255,255,.38)}
.pz-rot{position:absolute;z-index:5;left:50%;bottom:calc(290px * var(--pz-sc));transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border-radius:12px;background:rgba(14,13,26,.85);border:1px solid var(--pz-line);font:700 12px/1.25 Montserrat,system-ui,sans-serif}
/* ── узкое и низкое окно ── */
.pz-s .pz-box{width:160px;top:6px;left:8px;gap:4px}
.pz-s .pz-vit{padding:4px 6px}
.pz-s .pz-bar{height:13px}.pz-s .pz-bar span{font-size:10px;line-height:13px}.pz-s .pz-mp{height:9px}.pz-s .pz-mp span{display:none}
.pz-s .pz-goal{min-height:28px;padding:3px 7px;font-size:11px}.pz-s .pz-goal span{-webkit-line-clamp:1}
.pz-s .pz-inv-head{padding:4px 6px 4px 10px}.pz-s .pz-inv-head h3{font-size:14px}.pz-s .pz-inv-body{padding:6px 10px;gap:10px}.pz-s .pz-sec h4{margin:0 0 4px}.pz-s .pz-tools{margin-bottom:6px}.pz-s .pz-tools .pz-b{min-height:34px}
.pz-s .pz-det{min-height:52px;padding:4px 10px}.pz-s .pz-det .pz-ic{--s:36px}.pz-s .pz-det .tx small{font-size:11px;line-height:1.25}
.pz-s .gs-menu-box{gap:5px;padding:.7rem}.pz-s .gs-menu-it{min-height:44px;padding:.5rem .9rem}
.pz-s .pz-btns{top:6px;right:8px}
.pz-hb-grid .pz-btns{left:8px;right:auto}
.pz-hb-grid .pz-box{left:62px;right:8px;width:auto;flex-direction:row;flex-wrap:wrap;align-items:flex-start;gap:6px}
.pz-hb-grid .pz-vit{flex:1 1 130px}
.pz-hb-grid .pz-goal{flex:1 1 120px;min-height:44px}
.pz-hb-grid .pz-clock{display:none!important}
.pz-hb-grid .pz-buffs{flex-basis:100%}`;
  function addCss(){ const old = document.getElementById('pz-css'); if (old && old.dataset.v === '2') return; old?.remove(); const s = document.createElement('style'); s.id = 'pz-css'; s.dataset.v = '2'; s.textContent = CSS; document.head.appendChild(s); }
  const isTouch = () => { try { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; } catch (e) { return false; } };
  const fmtTime = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const STATION = { workbench: '🔨 верстак', furnace: '🔥 печь', anvil: '⚒ наковальня' };
  const STATION_AT = { workbench: '🔨 У верстака', furnace: '🔥 У печи', anvil: '⚒ У наковальни' };

  function create(G, API){
    const PZ = API.PZ;
    const U = { touch: { mx: 0, my: 0, jump: false, jumpDown: false, use: false, front: false, build: false } };
    let root, wrap, boxEl, hotEl, btnsEl, selName, statusEl, toastsEl, talkEl, bossEl, loadEl, koEl, menuEl, cmdEl, handEl, touchEl, invEl, tipEl, goalsEl, rotEl;
    let invOpen = false, invTab = 'items', craftMode = 'ok', craftSel = '', menuKind = null, hand = null, pick = null, atlasUrl = '', selChar = null, selWorld = null, lastHud = '', lastUse = '';
    let pauseMenu = null, touchUI = false, LW = 0, LH = 0, selNameT = 0, lastSel = '';
    const offs = [];
    const on = (t, ev, f, o) => { t.addEventListener(ev, f, o); offs.push(() => t.removeEventListener(ev, f, o)); };
    // открылось окно (вещи, меню, нокаут) — отпустить всё, что держали пальцем: кнопки под окном не видны
    let wasModal = false;
    const modalObs = new MutationObserver(() => { const m = !!root?.classList.contains('pz-modal'); if (m && !wasModal) U.releaseTouch?.(); wasModal = m; });

    // ── значок, название, описание вещи (что делает — простыми словами) ──
    function icon(id, s){
      const c = G.A?.item?.[id];
      if (c === undefined) return `<i class="pz-ic" style="--c:0;--r:0${s ? ';--s:' + s + 'px' : ''};opacity:.3"></i>`;
      return `<i class="pz-ic" style="--c:${c % 64};--r:${c >> 6}${s ? ';--s:' + s + 'px' : ''}"></i>`;
    }
    const nameOf = id => API.itemDef(id)?.name || id;
    const TILE_INFO = {
      torch: 'Светит. В руке — светит вокруг тебя (как фонарь)', workbench: 'Станок: рядом с ним делают вещи из дерева и камня', furnace: 'Станок: плавит руду в слитки, песок — в стекло',
      anvil: 'Станок: куёт кирки, мечи, крюк', chest: 'Хранит 20 стопок вещей', door: 'Дверь: открыть — ПКМ или «✋ Открыть». Зомби её не открывают', bed: 'После нокаута встанешь здесь',
      platform: 'Сверху стоишь, снизу — проходишь насквозь (вниз — спрыгнуть)', rope: 'По ней лазают: вверх и вниз', ladder: 'По ней лазают: вверх и вниз', glass: 'Пропускает свет',
      glowshroom: 'Светится голубым', crystal: 'Светится фиолетовым', cactus: 'Растёт в пустыне', wood: 'Ставится как доски',
    };
    function infoLines(id){
      const it = API.itemDef(id); if (!it) return [];
      const d = [];
      if (it.kind === 'tool') {
        if (it.tool === 'pick') d.push(`⛏ Кирка: копает блоки (сила ${it.power}), берёт ${['', 'камень, медь, железо', 'серебро и золото', 'глубинит и обсидиан', 'жарит', 'всё'][it.tier] || 'блоки'}`);
        else if (it.tool === 'axe') d.push(`🪓 Топор: рубит деревья и кактусы (сила ${it.power})`);
        else d.push('🔨 Молоток: ломает стены фона, а блок делает полублоком или склоном');
        if (it.dmg) d.push(`⚔ Бьёт мобов: урон ${it.dmg} (меч сильнее)`);
      }
      if (it.kind === 'melee') d.push(`⚔ Меч: урон ${it.dmg}, отбрасывает врага`);
      if (it.kind === 'bow') d.push(`🏹 Лук: урон ${it.dmg} + стрела. Стрелы — на верстаке`);
      if (it.kind === 'wand') d.push(`✨ Жезл: урон ${it.dmg}, тратит ${it.mana} маны`);
      if (it.kind === 'ammo') d.push('🏹 Стрелы для лука');
      if (it.kind === 'hook') d.push('🪝 Крюк-кошка: летит и цепляется за блок, тянет к нему (E / «🪝 Крюк»)');
      if (it.kind === 'tile') d.push('🧱 Ставится в мир' + (TILE_INFO[it.tile] || TILE_INFO[it.key] ? ' — ' + (TILE_INFO[it.key] || TILE_INFO[it.tile]) : ''));
      if (it.kind === 'wall') d.push('🧱 Стена фона: из таких делают дом (сломать — только молотком)');
      if (it.use === 'heal') d.push(`❤ Лечит: +${it.heal} здоровья${it.key === 'potion' ? ' (зелье — раз в 30 с)' : ''}. Быстро — клавиша H`);
      if (it.use === 'life') d.push('❤ Навсегда +20 к здоровью');
      if (it.use === 'mana') d.push('⭐ Навсегда +20 к мане');
      if (it.use === 'boss') d.push(it.night ? '👑 Зовёт босса (только ночью)' : '👑 Зовёт босса');
      if (it.use === 'recall') d.push('🏠 Переносит домой за 1,5 с (не тратится)');
      if (it.use === 'buff') d.push(it.buff === 'mine' ? `⛏ Копаешь быстрее ${Math.round(it.dur / 60)} мин (B — выпить)` : `✨ Светишься сам ${Math.round(it.dur / 60)} мин (B — выпить)`);
      if (it.use === 'script') d.push('🧩 Вещь из мода — что делает, решает мод');
      if (it.acc === 'jump') d.push('👢 Прыжок выше — пока лежат в вещах');
      if (it.acc === 'glide') d.push('🪶 Второй прыжок и парение — пока лежат в вещах');
      if (it.kind === 'mat' || it.kind === 'tile') {
        const uses = []; for (const r of PZ.RECIPES.concat(G.modRecipes || [])) if (r.i.some(([k]) => k === id) && !uses.includes(r.o)) uses.push(r.o);
        if (uses.length) d.push('🛠 Нужно для: ' + uses.slice(0, 5).map(nameOf).join(', ') + (uses.length > 5 ? '…' : ''));
      }
      if (it.mod) d.push('🧩 Из мода: ' + it.mod);
      return d;
    }
    const descOf = id => [nameOf(id), ...infoLines(id)].join(' — ');

    // ═══ Каркас ═══
    U.build = r => {
      addCss();
      root = r;
      wrap = root.querySelector('.pz-wrap');
      wrap.insertAdjacentHTML('beforeend', `
        <div class="pz-hurt"></div>
        <div class="pz-box">
          <div class="pz-vit"><div class="pz-bar pz-hp"><i></i><span></span></div><div class="pz-bar pz-mp"><i></i><span></span></div></div>
          <div class="pz-buffs"></div>
          <button type="button" class="pz-goal" data-a="goals" title="Что сделать дальше — нажми, чтобы увидеть все цели"></button>
          <span class="pz-clock"></span>
        </div>
        <div class="pz-hot" role="toolbar" aria-label="Панель вещей"></div>
        <div class="pz-btns">
          <button type="button" class="pz-hbtn" data-a="inv" title="Вещи и крафт (I или Esc)"><span class="ic">🎒</span><b>Вещи</b><kbd>I</kbd></button>
          <button type="button" class="pz-hbtn" data-a="smart" aria-pressed="false" title="Умный курсор: кирка сама находит блок у курсора (Ctrl)"><span class="ic">🎯</span><b>Курсор</b><kbd>Ctrl</kbd></button>
          <button type="button" class="pz-hbtn" data-a="pause" title="Меню и пауза (P)" aria-label="Меню"><span class="ic">⏸</span><b>Меню</b><kbd>P</kbd></button>
        </div>
        <div class="pz-sel-name off"></div>
        <div class="pz-status"></div>
        <div class="pz-toasts" aria-live="polite"></div>
        <div class="pz-boss" hidden><span></span><div><i></i></div></div>
        <div class="pz-goals" hidden></div>
        <div class="pz-talk" hidden></div>
        <div class="pz-touch" hidden></div>
        <div class="pz-inv" hidden role="dialog" aria-label="Вещи"></div>
        <div class="pz-load" hidden><div class="pz-spin"></div><span>Мир строится…</span></div>
        <div class="pz-ko" hidden></div>
        <div class="pz-menu" hidden></div>
        <form class="pz-cmd" hidden><input maxlength="120" placeholder="/команда — /help" aria-label="Команда"><button class="pz-b" type="submit">↵</button></form>
        <div class="pz-hand" hidden></div>
        <div class="pz-tip" hidden></div>`);
      const q = s => wrap.querySelector(s);
      boxEl = q('.pz-box'); hotEl = q('.pz-hot'); btnsEl = q('.pz-btns'); selName = q('.pz-sel-name'); statusEl = q('.pz-status'); toastsEl = q('.pz-toasts');
      talkEl = q('.pz-talk'); bossEl = q('.pz-boss'); loadEl = q('.pz-load'); koEl = q('.pz-ko'); menuEl = q('.pz-menu'); cmdEl = q('.pz-cmd'); handEl = q('.pz-hand');
      touchEl = q('.pz-touch'); invEl = q('.pz-inv'); tipEl = q('.pz-tip'); goalsEl = q('.pz-goals');
      // панель вещей: выбрать ячейку (открыто окно «Вещи» — как ячейка окна)
      hotEl.addEventListener('click', e => { const sl = e.target.closest('[data-slot]'); if (!sl) return; if (invOpen) slotClick('inv', +sl.dataset.slot, e); else API.selSlot(+sl.dataset.slot); });
      hotEl.addEventListener('contextmenu', e => { const sl = e.target.closest('[data-slot]'); if (sl && invOpen) { e.preventDefault(); slotClick('inv', +sl.dataset.slot, e, true); } });
      const onHud = e => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'inv') U.toggleInv();
        else if (a === 'smart') API.setSmart(!G.opt.smart);
        else if (a === 'pause') { if (G.state === 'play') API.pause(); }
        else if (a === 'goals') goalsToggle();
      };
      btnsEl.addEventListener('click', onHud); boxEl.addEventListener('click', onHud);
      goalsEl.addEventListener('click', () => goalsToggle(false));
      invEl.addEventListener('click', onInv);
      invEl.addEventListener('contextmenu', e => { const sl = e.target.closest('[data-slot]'); if (sl) { e.preventDefault(); slotClick(sl.dataset.box, +sl.dataset.slot, e, true); } });
      invEl.addEventListener('pointerover', e => { const sl = e.target.closest('[data-slot]'); if (sl && !touchUI) showTip(sl); });
      invEl.addEventListener('pointerout', e => { if (e.target.closest('[data-slot]')) tipEl.hidden = true; });
      hotEl.addEventListener('pointerover', e => { const sl = e.target.closest('[data-slot]'); if (sl && !touchUI) showTip(sl); });
      hotEl.addEventListener('pointerout', () => { tipEl.hidden = true; });
      menuEl.addEventListener('click', onMenu);
      talkEl.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'more' && G.talk) API.interactNear(); else if (a === 'close') U.talk(null); });
      cmdEl.addEventListener('submit', e => { e.preventDefault(); const v = cmdEl.querySelector('input').value; cmdEl.hidden = true; cmdEl.querySelector('input').blur(); if (v.trim()) API.runCommand(v); });
      cmdEl.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cmdEl.hidden = true; e.target.blur(); } });
      on(root, 'pointermove', e => {
        const b = wrap.getBoundingClientRect();
        if (hand && !touchUI) { handEl.style.left = (e.clientX - b.left) + 'px'; handEl.style.top = (e.clientY - b.top) + 'px'; }
        if (!tipEl.hidden) { tipEl.style.left = Math.min(b.width - 290, e.clientX - b.left + 16) + 'px'; tipEl.style.top = Math.min(b.height - 90, e.clientY - b.top + 18) + 'px'; }
      });
      // вещь «в руке» бросили мимо окна — выкинуть в мир (компьютер)
      on(root.querySelector('.pz-gl'), 'pointerdown', e => {
        if (!hand || e.button !== 0 || e.pointerType === 'touch') return;
        e.stopPropagation();
        throwHand();
      }, true);
      buildTouch(wrap);
      setTouch(isTouch());
      settingsTab(true);
      // телефон стоя: «поверни — так удобнее» (раз за визит)
      rotEl = document.createElement('div'); rotEl.className = 'pz-rot'; rotEl.hidden = true;
      rotEl.innerHTML = '🔄 Лёжа удобнее: больше мира и кнопки под пальцами <button type="button" class="pz-b sm ghost" aria-label="Скрыть">✕</button>';
      rotEl.querySelector('button').addEventListener('click', () => { rotEl.hidden = true; try { sessionStorage.setItem('d37_pz_rot', '1'); } catch (er) {} });
      wrap.appendChild(rotEl);
      modalObs.observe(root, { attributes: true, attributeFilter: ['class'] });
    };
    function setTouch(v){
      touchUI = !!v;
      root?.classList.toggle('pz-t', touchUI);
      if (touchEl) touchEl.hidden = !touchUI;
      lastHud = ''; U.layout(LW, LH);
    }
    // ═══ Раскладка по размеру окна игры (зовёт resize игры): ячейки панели, где она, высота «шапки» ═══
    U.layout = (w, h) => {
      if (!root || !w) return;
      LW = w; LH = h;
      const portrait = h > w * 1.12 && w < 700, short = h < 520 || (touchUI && h < 600 && w > h);
      root.classList.toggle('pz-p', portrait); root.classList.toggle('pz-s', short); root.classList.toggle('pz-n', w < 700);
      // панель 1–0: обычно — одним рядом между здоровьем (слева) и кнопками (справа); не влезает с ячейками ≥ 44 px (40 мышью) —
      // вторым рядом; телефон стоя — 2 ряда по 5 под строкой «⏸ здоровье цель»
      let mode = portrait ? 'grid' : 'center';
      root.classList.toggle('pz-hb-grid', mode === 'grid'); root.classList.remove('pz-hb-row2');
      const minCell = touchUI ? 44 : 40, top = short ? 6 : 8, r1 = short ? 46 : 54;
      let cell, left, hotTop = top;
      if (mode === 'center') {
        const gl = 10 + (boxEl.offsetWidth || (short ? 160 : 230)) + 10, gr = w - 10 - (btnsEl.offsetWidth || 60) - 10, avail = gr - gl;
        cell = Math.min(52, Math.floor((avail - 35) / 10));
        if (cell >= minCell) left = gl + (avail - (cell * 10 + 35)) / 2;
        else { mode = 'row2'; cell = Math.max(32, Math.min(52, Math.floor((w - 43) / 10))); left = (w - (cell * 10 + 35)) / 2; hotTop = r1 + 6; }
      } else { cell = Math.max(40, Math.min(50, Math.floor((w - 48) / 5))); left = (w - (cell * 5 + 20)) / 2; hotTop = r1 + 6; }
      root.classList.toggle('pz-hb-row2', mode === 'row2');
      root.style.setProperty('--pz-cell', cell + 'px');
      hotEl.style.left = Math.round(left) + 'px'; hotEl.style.top = hotTop + 'px';
      const hotH = (mode === 'grid' ? 2 : 1) * (cell + 3) + 5;
      root.style.setProperty('--pz-top', Math.round(hotTop + hotH + 10) + 'px');
      // телефон стоя — подсказать повернуть (если ещё не скрыли)
      let rotSeen = false; try { rotSeen = !!sessionStorage.getItem('d37_pz_rot'); } catch (e) {}
      if (rotEl) rotEl.hidden = !(touchUI && portrait && !rotSeen && G.state === 'play');
      if (invOpen) U.inv();
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
    // ранили — края экрана на миг (k 0…1)
    U.hurt = k => {
      const el = root?.querySelector('.pz-hurt'); if (!el) return;
      el.style.transition = 'none'; el.style.opacity = String(k); void el.offsetWidth;
      el.style.transition = 'opacity .55s ease-out'; el.style.opacity = '0';
    };

    // ═══ Экран игры: здоровье, мана, усиления, цель, панель ячеек ═══
    U.smart = v => { const b = btnsEl?.querySelector('[data-a="smart"]'); if (b) { b.classList.toggle('on', !!v); b.setAttribute('aria-pressed', v ? 'true' : 'false'); } };
    function useLabel(){   // подпись большой кнопки пальцем — по вещи в руке (враг рядом — «Удар»)
      const s = G.CH?.inv[G.CH.sel], it = s && API.itemDef(s.id);
      if (API.foeNear?.()) return ['⚔', 'Удар'];
      if (!it) return ['✊', 'Рука'];
      if (it.kind === 'tool') return it.tool === 'pick' ? ['⛏', 'Копать'] : it.tool === 'axe' ? ['🪓', 'Рубить'] : ['🔨', 'Молоток'];
      if (it.kind === 'melee') return ['⚔', 'Удар'];
      if (it.kind === 'bow') return ['🏹', 'Стрела'];
      if (it.kind === 'wand') return ['✨', 'Чары'];
      if (it.kind === 'tile') return it.key === 'torch' ? ['🔥', 'Ставить'] : ['🧱', 'Ставить'];
      if (it.kind === 'wall') return ['🧱', 'Стена'];
      if (it.kind === 'use') return it.use === 'heal' ? ['🧪', 'Выпить'] : it.use === 'buff' ? ['🧪', 'Выпить'] : ['✨', 'Применить'];
      if (it.kind === 'hook') return ['🪝', 'Крюк'];
      return ['✊', 'Действие'];
    }
    U.hud = () => {
      if (!root || !G.CH) return;
      const CH = G.CH, bf = API.buffs(), hook = API.hasHook();
      // цель: что сделать сейчас (выполнил — «✅» и следующая); проверяется 4 раза в секунду
      const gl = API.goal(), ge = boxEl.querySelector('.pz-goal'), gk = gl ? gl.i : -1;
      if (ge && gl !== undefined && ge.dataset.k !== String(gk)) {   // undefined — мир ещё не готов
        if (ge.dataset.k && gl && +ge.dataset.k < gk) U.toast('✅ Цель выполнена! Дальше: ' + gl.text, 'goal');
        else if (ge.dataset.k && +ge.dataset.k >= 0 && gk < 0) U.toast('✅ Все первые цели выполнены — дальше глубины, боссы и свои постройки', 'goal');
        ge.dataset.k = String(gk);
        ge.innerHTML = gl ? `${gl.icon} <span>${esc(gl.text)}</span> <b>${gl.i + 1}/${gl.n}</b>` : '';
        ge.classList.remove('done'); void ge.offsetWidth; ge.classList.add('done');
        if (!goalsEl.hidden) goalsToggle(true);
      }
      const ul = touchUI ? useLabel() : null, near = touchUI && API.nearAct?.();
      const key = [CH.hp | 0, CH.maxHp, CH.mana | 0, CH.maxMana, CH.sel, G.A ? 1 : 0, hook ? 1 : 0, ul && ul.join(), near ? 1 : 0, ...Object.keys(bf).map(k => k + Math.ceil(bf[k])), ...CH.inv.slice(0, 10).map(s => s ? s.id + ':' + s.n : '')].join('|');
      if (key === lastHud) return;
      lastHud = key;
      U.smart(G.opt.smart);
      const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      boxEl.querySelector('.pz-buffs').innerHTML = Object.keys(bf).map(k => `<span class="pz-buff" title="${k === 'mine' ? 'Зелье шахтёра: копаешь быстрее' : 'Зелье сияния: светишься сам'}">${icon(k === 'mine' ? 'potion_miner' : 'potion_shine')}<b>${mmss(Math.ceil(bf[k]))}</b></span>`).join('');
      // здоровье и мана — полосы с числами (видно с телефона)
      const hp = Math.max(0, CH.hp | 0), hpEl = boxEl.querySelector('.pz-hp'), mpEl = boxEl.querySelector('.pz-mp');
      hpEl.querySelector('i').style.width = Math.max(0, Math.min(100, hp / CH.maxHp * 100)) + '%';
      hpEl.querySelector('span').textContent = `❤ ${hp} / ${CH.maxHp}`;
      hpEl.classList.toggle('low', hp > 0 && hp <= CH.maxHp * .25);
      mpEl.querySelector('i').style.width = Math.max(0, Math.min(100, CH.mana / CH.maxMana * 100)) + '%';
      mpEl.querySelector('span').textContent = `★ ${CH.mana | 0} / ${CH.maxMana}`;
      // панель 1–0
      hotEl.innerHTML = CH.inv.slice(0, 10).map((s, i) => `<button type="button" class="pz-slot hb${i === CH.sel ? ' sel' : ''}${pick && pick.box === 'inv' && pick.i === i ? ' pick' : ''}" data-slot="${i}" data-box="inv" aria-label="${s ? esc(nameOf(s.id)) + (s.n > 1 ? ' ×' + s.n : '') : 'Пусто'}"><i class="k">${(i + 1) % 10}</i>${s ? icon(s.id) + (s.n > 1 ? `<b>${s.n}</b>` : '') : ''}</button>`).join('');
      const s = CH.inv[CH.sel], nm = s ? nameOf(s.id) : '';
      if (nm !== lastSel) { lastSel = nm; selName.textContent = nm; selName.classList.toggle('off', !nm); clearTimeout(selNameT); if (nm) selNameT = setTimeout(() => selName.classList.add('off'), 1600); }
      // пальцем: подпись большой кнопки и крюк
      const hb = touchEl?.querySelector('[data-t="hook"]'); if (hb) hb.hidden = !hook;
      if (ul) { const ub = touchEl.querySelector('[data-t="use"]'); if (ub && ub.dataset.l !== ul.join()) { ub.dataset.l = ul.join(); ub.innerHTML = `<span class="i">${ul[0]}</span><b>${ul[1]}</b>`; } }
      touchEl?.querySelector('[data-t="act"]')?.classList.toggle('near', !!near);
      if (bossEl && !bossEl.hidden && G.boss) bossEl.querySelector('i').style.width = Math.max(0, G.boss.hp / G.boss.maxHp * 100) + '%';
    };
    U.status = t => {   // 4 раза в секунду: текст меняем, только если он другой (иначе лишняя раскладка)
      if (statusEl && statusEl.textContent !== t) statusEl.textContent = t;
      const ck = boxEl?.querySelector('.pz-clock'), ct = ck && API.clockText ? API.clockText() : null; if (ct !== null && ck.textContent !== ct) ck.textContent = ct;
      if (G.boss && bossEl && !bossEl.hidden) bossEl.querySelector('i').style.width = Math.max(0, G.boss.hp / G.boss.maxHp * 100) + '%';
    };
    function goalsToggle(v){
      const show = v ?? goalsEl.hidden;
      goalsEl.hidden = !show;
      if (!show) return;
      const gl = API.goal(), cur = gl ? gl.i : API.GOALS.length;
      goalsEl.innerHTML = `<h4>🎯 Первые шаги — ${Math.min(cur, API.GOALS.length)} из ${API.GOALS.length}</h4><ul>${API.GOALS.map((g, i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}">${i < cur ? '✅' : i === cur ? '👉' : '▫️'} ${esc(g[1])}</li>`).join('')}</ul><p class="pz-note" style="margin:8px 0 0">Нажми, чтобы закрыть. Проводник тоже подскажет.</p>`;
    }
    function showTip(sl){
      const items = boxItems(sl.dataset.box), s = items && items[+sl.dataset.slot];
      if (!s) { tipEl.hidden = true; return; }
      tipEl.innerHTML = `<b>${esc(nameOf(s.id))}${s.n > 1 ? ' ×' + s.n : ''}</b>${infoLines(s.id).map(esc).join('<br>')}`;
      tipEl.hidden = false;
    }

    // ═══ Окно «Вещи»: вещи, крафт, сундук ═══
    U.toggleInv = v => {
      if (!G.CH || G.state !== 'play') return;
      invOpen = v ?? !invOpen;
      if (!invOpen) { returnHand(); G.chestOpen = null; pick = null; tipEl.hidden = true; }
      else { invTab = G.chestOpen ? 'chest' : invTab === 'chest' ? 'items' : invTab; goalsEl.hidden = true; }
      invEl.hidden = !invOpen;
      modalClass();
      if (invOpen) U.inv(); else U.hud();
      API.snd('click', { vol: .4 });
    };
    U.chest = k => { G.chestOpen = k; if (k) { invOpen = true; invTab = 'chest'; invEl.hidden = false; modalClass(); U.inv(); } else if (invOpen) { if (invTab === 'chest') invTab = 'items'; U.inv(); } };
    function modalClass(){ root?.classList.toggle('pz-modal', !!(invOpen || menuKind || (koEl && !koEl.hidden))); }
    const chestItems = () => G.chestOpen && G.chests?.get(G.chestOpen);
    function grid(box, items, n, cols, from = 0){
      let h = `<div class="pz-grid" style="--cols:${cols}">`;
      for (let i = from; i < n; i++) {
        const s = items[i], hb = box === 'inv' && i < 10;
        if (box === 'inv' && i === 10) h += '<div class="pz-sep"></div>';
        h += `<button type="button" class="pz-slot${hb ? ' hb' : ''}${box === 'inv' && i === G.CH.sel ? ' sel' : ''}${pick && pick.box === box && pick.i === i ? ' pick' : ''}" data-box="${box}" data-slot="${i}" aria-label="${s ? esc(nameOf(s.id)) + (s.n > 1 ? ' ×' + s.n : '') : 'Пусто'}">${hb ? `<i class="k">${(i + 1) % 10}</i>` : ''}${s ? icon(s.id) + (s.n > 1 ? `<b>${s.n}</b>` : '') : ''}</button>`;
      }
      return h + '</div>';
    }
    U.inv = () => {
      U.hud();
      if (!invOpen || !G.CH) return;
      const chest = chestItems();
      if (invTab === 'chest' && !chest) invTab = 'items';
      const W = invEl.clientWidth || LW - 16, wide = W >= 720;
      invEl.classList.toggle('wide', wide);
      // ячейки: широкое окно — 10 в ряд слева, крафт справа; узкое — 5 в ряд (крупные, под палец)
      const cols = wide || W >= 600 ? 10 : 5, avail = wide ? Math.max(400, W - 380) : W - 26;
      const cell = Math.max(40, Math.min(wide ? 54 : 64, Math.floor((avail - (cols - 1) * 4) / cols)));
      invEl.style.setProperty('--pz-cell', cell + 'px');
      const list = API.craftList(), ok = list.filter(x => x.ok);
      const tabs = `<button type="button" data-tab="items" class="${invTab === 'items' ? 'on' : ''}">🎒 Вещи</button><button type="button" data-tab="craft" class="${invTab === 'craft' ? 'on' : ''}">🛠 Сделать${ok.length ? `<i>${ok.length}</i>` : ''}</button>${chest ? `<button type="button" data-tab="chest" class="${invTab === 'chest' ? 'on' : ''}">📦 Сундук</button>` : ''}`;
      const tools = `<div class="pz-tools"><button type="button" class="pz-b sm" data-a="sort" title="Сложить стопки и разложить по видам (панель 1–0 не трогаем)">⇅ Разложить</button><button type="button" class="pz-b sm" data-a="qstack" title="В сундуки рядом — то, что в них уже лежит">📦 По сундукам рядом</button></div>`;
      const chestHtml = chest ? `<h4>📦 Сундук <button type="button" class="pz-b sm" data-a="loot">⬇ Забрать всё</button><button type="button" class="pz-b sm" data-a="stash">⬆ Сложить всё</button></h4>${grid('chest', chest, API.CHEST_N, cols)}` : '';
      const itemsHtml = `<h4>🎒 Вещи <small>${touchUI ? 'коснись вещи — увидишь, что она делает' : 'ЛКМ — взять, ПКМ — половину, Shift — переложить'}</small></h4>${tools}${grid('inv', G.CH.inv, API.INV_N, cols)}`;
      const items = wide ? chestHtml + itemsHtml : invTab === 'chest' ? chestHtml + itemsHtml : itemsHtml;
      const sc0 = invEl.querySelector('.pz-sec-items')?.scrollTop || 0, sc1 = invEl.querySelector('.pz-sec-craft')?.scrollTop || 0;
      invEl.innerHTML = `<div class="pz-inv-head"><h3>${wide ? (chest ? '📦 Сундук и вещи' : '🎒 Вещи и крафт') : ''}</h3><div class="pz-tabs2">${wide ? '' : tabs}</div><button type="button" class="pz-x" data-a="close" aria-label="Закрыть">✕</button></div>
        <div class="pz-inv-body"><section class="pz-sec pz-sec-items${invTab !== 'craft' ? ' on' : ''}">${items}</section><section class="pz-sec pz-sec-craft${invTab === 'craft' ? ' on' : ''}">${craftHtml(list)}</section></div>
        <div class="pz-det">${detailHtml()}</div>`;
      const a = invEl.querySelector('.pz-sec-items'), b = invEl.querySelector('.pz-sec-craft'); if (a) a.scrollTop = sc0; if (b) b.scrollTop = sc1;
    };
    // ── крафт: «Можно сделать» — по станкам; выбранный рецепт раскрывается: что делает вещь и «Сделать ×1 / ×5 / всё» ──
    const rkey = r => { const i = PZ.RECIPES.indexOf(r); return i >= 0 ? String(i) : 'm' + (G.modRecipes || []).indexOf(r); };
    const rOf = k => k[0] === 'm' ? (G.modRecipes || [])[+k.slice(1)] : PZ.RECIPES[+k];
    const canMake = r => Math.min(...r.i.map(([k, n]) => Math.floor(API.count(k) / n)));
    function craftHtml(list){
      const ok = list.filter(x => x.ok), shown = craftMode === 'ok' ? ok : list;
      let h = `<div class="pz-filters"><button type="button" data-cm="ok" class="${craftMode === 'ok' ? 'on' : ''}">✅ Можно (${ok.length})</button><button type="button" data-cm="all" class="${craftMode === 'all' ? 'on' : ''}">📜 Все (${list.length})</button></div>`;
      if (!shown.length) return h + `<p class="pz-note">${craftMode === 'ok' ? 'Пока нечего сделать. Наруби дерева 🪓 — из него верстак, платформы, факелы (с гелем от слизней). Все рецепты — «📜 Все рецепты».' : 'Рецептов нет.'}</p>`;
      const groups = [['', '✋ Руками — где угодно'], ['workbench', STATION_AT.workbench], ['furnace', STATION_AT.furnace], ['anvil', STATION_AT.anvil]];
      const other = [...new Set(shown.map(x => x.r.st || '').filter(s => !groups.some(g => g[0] === s)))].map(s => [s, '🧩 ' + s]);
      for (const [st, title] of groups.concat(other)) {
        const rows = shown.filter(x => (x.r.st || '') === st);
        if (!rows.length) continue;
        rows.sort((a, b) => (b.ok - a.ok) || String(nameOf(a.r.o)).localeCompare(String(nameOf(b.r.o)), 'ru'));
        h += `<div class="pz-grp">${title}</div>` + rows.map(x => recipeRow(x)).join('');
      }
      return h;
    }
    function recipeRow(x){
      const r = x.r, k = rkey(r), sel = craftSel === k;
      const st = r.st ? (x.okSt ? STATION[r.st] || r.st : `нужен ${STATION[r.st] || r.st} рядом`) : 'руками';
      let h = `<button type="button" class="pz-rc${x.ok ? ' ok' : ''}${sel ? ' sel' : ''}" data-rc="${k}" aria-expanded="${sel}">
        ${icon(r.o, 36)}<span class="nm">${esc(nameOf(r.o))}${r.n > 1 ? ' ×' + r.n : ''}<small class="${x.okSt ? '' : 'bad'}">${esc(st)}</small></span>
        <span class="ing">${r.i.map(([id, n]) => `<span class="${API.count(id) >= n ? '' : 'lack'}" title="${esc(nameOf(id))}">${icon(id, 22)}${API.count(id)}/${n}</span>`).join('')}</span></button>`;
      if (sel) {
        const max = x.ok ? canMake(r) : 0;
        h += `<div class="pz-rcd"><p>${infoLines(r.o).map(esc).join('<br>') || esc(nameOf(r.o))}</p>
          ${x.okSt ? '' : `<p class="pz-err">Подойди к станку: ${esc(STATION[r.st] || r.st)} (до 5 клеток).</p>`}
          ${!x.has ? `<p class="pz-err">Не хватает: ${r.i.filter(([id, n]) => API.count(id) < n).map(([id, n]) => esc(nameOf(id)) + ' ' + (n - API.count(id))).join(', ')}</p>` : ''}
          <div class="pz-row" style="margin:0"><button type="button" class="pz-b pri" data-mk="1" ${max >= 1 ? '' : 'disabled'}>🛠 Сделать</button>${max >= 5 ? '<button type="button" class="pz-b" data-mk="5">×5</button>' : ''}${max >= 2 ? `<button type="button" class="pz-b" data-mk="${max}">Всё (×${max})</button>` : ''}</div></div>`;
      }
      return h;
    }
    // ── описание и кнопки внизу окна: вещь в руке или выбранная ячейка ──
    function detailHtml(){
      const ch = chestItems();
      if (hand) {
        return `${icon(hand.id, 44)}<div class="tx"><b>✋ В руке: ${esc(nameOf(hand.id))}${hand.n > 1 ? ' ×' + hand.n : ''}</b><small>${touchUI ? 'Коснись ячейки — положить туда (или поменять местами).' : 'Нажми ячейку — положить (или поменять). Мимо окна — выбросить.'}</small></div>
          <div class="acts"><button type="button" class="pz-b" data-d="back">↩ Вернуть</button><button type="button" class="pz-b warn" data-d="throw">🗑 Выбросить</button></div>`;
      }
      const items = pick && boxItems(pick.box), s = items && items[pick.i];
      if (!s) return `<div class="tx"><small>${touchUI ? (LH < 520 ? 'Коснись вещи — что делает и кнопки; ещё раз — взять в руку.' : 'Коснись вещи — увидишь, что она делает, и кнопки «На панель», «В сундук», «Выбросить». Коснись ещё раз — возьмёшь в руку, чтобы переложить.') : 'Наведи на вещь — подсказка. ЛКМ — взять, ПКМ — половину, Shift+ЛКМ — переложить в сундук или сумку. Esc / I — закрыть.'}</small></div>`;
      const it = API.itemDef(s.id), acts = [];
      if (pick.box === 'inv') {
        if (pick.i >= 10) acts.push('<button type="button" class="pz-b" data-d="tohot">⬆ На панель</button>');
        else { acts.push('<button type="button" class="pz-b" data-d="hold">✋ Взять в руку</button>'); acts.push('<button type="button" class="pz-b" data-d="tobag">⬇ В сумку</button>'); }
        if (ch) acts.push('<button type="button" class="pz-b" data-d="tochest">📦 В сундук</button>');
        if (it && it.kind === 'use') acts.push('<button type="button" class="pz-b pri" data-d="use">🧪 Использовать</button>');
      } else acts.push('<button type="button" class="pz-b pri" data-d="toinv">🎒 Забрать</button>');
      if (s.n > 1) acts.push('<button type="button" class="pz-b" data-d="half">✂ Половину в руку</button>');
      if (touchUI) acts.push('<button type="button" class="pz-b" data-d="take">↕ Переложить</button>');
      acts.push('<button type="button" class="pz-b warn" data-d="throw">🗑 Выбросить</button>');
      return `${icon(s.id, 44)}<div class="tx"><b>${esc(nameOf(s.id))}${s.n > 1 ? ' ×' + s.n : ''}</b><small>${infoLines(s.id).map(esc).join('<br>')}</small></div><div class="acts">${acts.join('')}</div>`;
    }
    function onInv(e){
      const t = e.target, a = t.closest('[data-a]')?.dataset.a;
      if (a === 'close') { U.toggleInv(false); return; }
      if (a === 'sort') { API.sortInv(); pick = null; return; }
      if (a === 'qstack') { API.quickStack(); return; }
      if (a === 'loot' || a === 'stash') { moveAll(a === 'loot'); return; }
      const tb = t.closest('[data-tab]'); if (tb) { invTab = tb.dataset.tab; U.inv(); return; }
      const cm = t.closest('[data-cm]'); if (cm) { craftMode = cm.dataset.cm; U.inv(); return; }
      const mk = t.closest('[data-mk]');
      if (mk) { const r = rOf(craftSel); if (r) { const n = API.craft(r, Math.max(1, +mk.dataset.mk | 0)); if (n) API.toast(`🛠 Сделано: ${nameOf(r.o)}${r.n * n > 1 ? ' ×' + r.n * n : ''}`, 'good'); } U.inv(); return; }
      const rc = t.closest('[data-rc]');
      if (rc) { const k = rc.dataset.rc; if (e.detail >= 2 && !touchUI && craftSel === k) { const r = rOf(k); if (r) API.craft(r, e.shiftKey ? 10 : 1); } else craftSel = craftSel === k && !e.shiftKey ? '' : k; if (e.shiftKey && !touchUI) { const r = rOf(k); if (r) API.craft(r, 10); } U.inv(); return; }
      const d = t.closest('[data-d]')?.dataset.d; if (d) { detailAct(d); return; }
      const sl = t.closest('[data-slot]'); if (sl) slotClick(sl.dataset.box, +sl.dataset.slot, e);
    }
    const boxItems = box => box === 'chest' ? chestItems() : G.CH?.inv;
    // сложить стопку s в items на места [a, b): сначала к таким же, потом в пустые; вернёт, сколько не влезло
    function stackInto(items, s, a, b){
      let n = s.n; const mx = API.stackOf(s.id);
      for (let k = a; k < b && n; k++) { const o = items[k]; if (o && o.id === s.id && o.n < mx) { const q = Math.min(n, mx - o.n); o.n += q; n -= q; } }
      for (let k = a; k < b && n; k++) if (!items[k]) { items[k] = { id: s.id, n: Math.min(n, mx) }; n -= items[k].n; }
      return n;
    }
    function detailAct(d){
      if (d === 'back') { returnHand(); U.inv(); return; }
      if (d === 'throw') { if (hand) throwHand(); else if (pick) { const items = boxItems(pick.box), s = items?.[pick.i]; if (s) { items[pick.i] = null; dropToWorld(s); markChest(); } pick = null; } U.inv(); return; }
      if (!pick) return;
      const items = boxItems(pick.box), s = items?.[pick.i]; if (!s) { pick = null; U.inv(); return; }
      const inv = G.CH.inv, ch = chestItems();
      const move = (to, a, b) => { items[pick.i] = null; const left = stackInto(to, s, a, b); if (left) { s.n = left; items[pick.i] = s; API.toast('Не хватило места', 'bad'); } markChest(); API.snd('click', { vol: .3 }); };
      if (d === 'tohot') move(inv, 0, 10);
      else if (d === 'tobag') move(inv, 10, API.INV_N);
      else if (d === 'tochest' && ch) move(ch, 0, API.CHEST_N);
      else if (d === 'toinv') { items[pick.i] = null; let left = stackInto(inv, s, 10, API.INV_N); if (left) { s.n = left; left = stackInto(inv, s, 0, 10); } if (left) { s.n = left; items[pick.i] = s; API.toast('В вещах нет места', 'bad'); } markChest(); }
      else if (d === 'hold') { API.selSlot(pick.i); U.toggleInv(false); return; }
      else if (d === 'use') { API.useSlot?.(pick.i); }
      else if (d === 'half') { const t = Math.ceil(s.n / 2); returnHand(); hand = { id: s.id, n: t, from: pick }; s.n -= t; if (!s.n) items[pick.i] = null; showHand(); markChest(); }
      else if (d === 'take') { returnHand(); hand = { id: s.id, n: s.n, from: pick }; items[pick.i] = null; showHand(); markChest(); }
      if (!items[pick.i] && d !== 'half' && d !== 'take') pick = null;
      U.inv();
    }
    function slotClick(box, i, e, half){
      const items = boxItems(box); if (!items) return;
      const s = items[i];
      tipEl.hidden = true;
      // Shift: переложить между сундуком и вещами (без сундука — между панелью и сумкой)
      if (e.shiftKey && s && !hand) {
        const ch = chestItems();
        items[i] = null;
        let left;
        if (box === 'chest') { left = stackInto(G.CH.inv, s, 10, API.INV_N); if (left) { s.n = left; left = stackInto(G.CH.inv, s, 0, 10); } }
        else if (ch) left = stackInto(ch, s, 0, API.CHEST_N);
        else left = i < 10 ? stackInto(G.CH.inv, s, 10, API.INV_N) : stackInto(G.CH.inv, s, 0, 10);
        if (left) { s.n = left; items[i] = s; }
        markChest(); U.inv(); API.snd('click', { vol: .3 });
        return;
      }
      if (!hand) {
        if (!s) { pick = null; U.inv(); return; }
        // пальцем: первое касание — показать, что это (кнопки внизу); второе — взять в руку. Мышью — взять сразу (как в Террарии)
        if (touchUI && !half && !(pick && pick.box === box && pick.i === i)) { pick = { box, i }; U.inv(); API.snd('click', { vol: .2 }); return; }
        if (half && s.n > 1) { const t = Math.ceil(s.n / 2); hand = { id: s.id, n: t, from: { box, i } }; s.n -= t; }
        else { hand = { id: s.id, n: s.n, from: { box, i } }; items[i] = null; }
        pick = { box, i };
      } else if (!s) {
        if (half) { items[i] = { id: hand.id, n: 1 }; hand.n--; if (!hand.n) hand = null; }
        else { items[i] = { id: hand.id, n: hand.n }; hand = null; }
        pick = items[i] ? { box, i } : pick;
      } else if (s.id === hand.id) {
        const mx = API.stackOf(s.id), a = Math.min(half ? 1 : hand.n, mx - s.n);
        s.n += a; hand.n -= a; if (!hand.n) hand = null;
        pick = { box, i };
      } else if (!half) { items[i] = { id: hand.id, n: hand.n }; hand = { id: s.id, n: s.n, from: { box, i } }; pick = { box, i }; }
      markChest(); showHand(); U.inv(); API.snd('click', { vol: .3 });
    }
    function moveAll(toInv){
      const ch = chestItems(); if (!ch) return;
      if (toInv) for (let i = 0; i < ch.length; i++) { const s = ch[i]; if (!s) continue; ch[i] = null; let left = stackInto(G.CH.inv, s, 10, API.INV_N); if (left) { s.n = left; left = stackInto(G.CH.inv, s, 0, 10); } if (left) { s.n = left; ch[i] = s; } }
      else for (let i = 10; i < API.INV_N; i++) { const s = G.CH.inv[i]; if (!s) continue; G.CH.inv[i] = null; const left = stackInto(ch, s, 0, API.CHEST_N); if (left) { s.n = left; G.CH.inv[i] = s; } }   // «сложить» — без панели 1–0
      pick = null; markChest(); U.inv();
    }
    function markChest(){ if (!G.chestOpen) return; const [ax, ay] = G.chestOpen.split(',').map(Number); const c = G.chunks.get(PZ.key(ax >> 6, ay >> 6)); if (c) { c.mod = true; G.dirtySave.add(c); } }
    function showHand(){ handEl.hidden = !hand || touchUI; if (hand && !touchUI) handEl.innerHTML = icon(hand.id, 34) + (hand.n > 1 ? `<b>${hand.n}</b>` : ''); }
    // вещь из руки — назад, откуда взяли (нет места — в любые вещи, совсем нет — под ноги)
    function returnHand(){
      if (!hand) return;
      const h = hand; hand = null;
      const items = h.from && boxItems(h.from.box);
      if (items && !items[h.from.i]) items[h.from.i] = { id: h.id, n: h.n };
      else if (items && items[h.from.i].id === h.id && items[h.from.i].n + h.n <= API.stackOf(h.id)) items[h.from.i].n += h.n;
      else { const left = API.give(h.id, h.n); if (left) dropToWorld({ id: h.id, n: left }); }
      markChest(); showHand();
    }
    function dropToWorld(s){ const p = G.pl; if (p) API.dropItem(s.id, s.n, p.x + p.w / 2 + p.dir * 1.2, p.y + .8, p.dir * 6, -4); }
    function throwHand(){ if (!hand) return; dropToWorld(hand); hand = null; pick = null; showHand(); U.inv(); }

    // ═══ Подсказки, Проводник, босс, нокаут, загрузка ═══
    U.toast = (t, kind) => {
      if (!toastsEl) return;
      if (kind === 'goal') for (const o of toastsEl.querySelectorAll('.pz-toast.goal')) o.remove();   // цель — одна, свежая
      const d = document.createElement('div'); d.className = 'pz-toast ' + (kind || ''); d.textContent = t;
      toastsEl.appendChild(d);
      while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
      const life = kind === 'ach' || kind === 'boss' || kind === 'goal' ? 4200 : kind === 'info' ? 6000 : 2800;
      setTimeout(() => d.classList.add('out'), life - 350); setTimeout(() => d.remove(), life);
    };
    U.talk = (name, text) => {
      if (!talkEl) return;
      talkEl.hidden = !name;
      if (name) talkEl.innerHTML = `<b>${esc(name)}:</b> ${esc(text)}<div class="pz-row"><button type="button" class="pz-b" data-a="more">💬 Ещё совет</button><button type="button" class="pz-b ghost" data-a="close">Пока!</button></div>`;
    };
    U.boss = m => { if (!bossEl) return; bossEl.hidden = !m; if (m) { bossEl.querySelector('span').textContent = (m.D.boss === 2 ? '🦉 ' : '🟢 ') + m.D.name; bossEl.querySelector('i').style.width = '100%'; } };
    // «нокаут» вместо смерти (владелец: без жестокости): затемнение, «Ты без сил», совет по тому, кто одолел
    let koT = 0;
    U.dead = by => {
      if (!koEl) return;
      clearInterval(koT);
      koEl.hidden = !by;
      modalClass();
      if (!by) return;
      returnHand(); if (invOpen) U.toggleInv(false);
      const tip = /лава/i.test(by) ? 'Лава жжёт — ставь блоки мостиком и обходи с краю.'
        : /падени|высот/i.test(by) ? 'С высоты лучше спускаться по верёвке или лестнице; вода смягчает падение.'
        : /филин/i.test(by) ? 'Филин кричит «!» перед броском — в этот миг отпрыгни в сторону.'
        : /великан/i.test(by) ? 'Великан сжимается перед прыжком — уходи из-под него и бей с края. Лечение — H.'
        : /зомби/i.test(by) ? 'Ночью зомби много: построй дом с дверью — они её не открывают.'
        : 'Меч получше — у наковальни, лечение — H, кристаллы жизни — +20 к здоровью навсегда.';
      const home = G.W?.bed ? 'у своей кровати' : 'у точки старта';
      const tick = () => { koEl.innerHTML = `<div class="stars">💫</div><div class="big">Нокаут!</div><div>Ты без сил${by ? ' — тебя одолел: ' + esc(by) : ''}</div><div class="tip">Вещи остались с тобой. Встанешь ${home} через ${Math.max(0, Math.ceil(G.pl?.dead || 0))} с…</div><div class="tip">💡 ${esc(tip)}</div>`; };
      tick(); koT = setInterval(() => { if (!G.pl?.dead) { clearInterval(koT); koEl.hidden = true; modalClass(); } else tick(); }, 250);
    };
    U.loading = (v, t) => { if (!loadEl) return; loadEl.hidden = !v; if (t) loadEl.querySelector('span').textContent = t; if (!v && LW) U.layout(LW, LH); };
    U.command = () => { if (!cmdEl || G.state !== 'play') return; cmdEl.hidden = false; const i = cmdEl.querySelector('input'); i.value = '/'; i.focus(); };
    U.modal = () => !!(menuKind || (cmdEl && !cmdEl.hidden));
    U.closeTop = () => {
      if (cmdEl && !cmdEl.hidden) { cmdEl.hidden = true; return; }
      if (menuKind === 'pause') { API.resume(); return; }
      if (menuKind && menuKind !== 'start') { U.menu(G.state === 'menu' ? 'start' : 'pause'); return; }
    };
    U.invOpen = () => invOpen;
    // прогрев: пока виден экран загрузки мира — один раз разложить невидимо «Вещи» (обе вкладки) и меню паузы. Первое открытие
    // иначе тратит на телефоне ~0,2–0,4 с (шрифт значков, код, стили — один раз), дальше ~20 мс
    U.warm = () => {
      if (!root || !G.CH || invOpen || U.warmed) return;
      U.warmed = true;
      const t0 = performance.now(), tab = invTab;
      try {
        invEl.style.visibility = 'hidden'; invEl.hidden = false; invOpen = true;
        invTab = 'items'; U.inv(); void invEl.offsetWidth;
        invTab = 'craft'; U.inv(); void invEl.offsetWidth;
      } catch (e) { console.warn('[podzem] прогрев «Вещей»', e); }
      invOpen = false; invTab = tab; invEl.hidden = true; invEl.style.visibility = '';
      const S = window.D37Settings;
      if (S?.menu && !pauseMenu) {
        try { const m = S.menu(wrap, { title: '⏸ Пауза', sub: ' ', items: pauseItems }); m.el.style.visibility = 'hidden'; void m.el.offsetWidth; m.quiet = true; m.close(); }
        catch (e) { console.warn('[podzem] прогрев паузы', e); }
      }
      G.perf.warmMs = performance.now() - t0;
    };
    // Esc на паузе и в окнах меню (во время игры Esc разбирает сама игра); вещи открыты — Esc закрывает их (escKey игры)
    on(window, 'keydown', e => {
      if (e.key !== 'Escape' || !menuKind || G.state === 'play' || e.target?.closest?.('input, textarea')) return;
      if (window.D37Settings?.isOpen?.()) return;
      e.preventDefault();
      if (menuKind === 'pause') API.resume();
      else if (menuKind !== 'start') U.menu(G.state === 'menu' ? 'start' : 'pause');
    });

    // ═══ Меню ═══
    function closePause(){ if (!pauseMenu) return; const m = pauseMenu; pauseMenu = null; m.quiet = true; m.close(); }
    U.menu = async kind => {
      if (kind === 'opts') { openSettings(); return; }   // настройки — окно сайта поверх (меню под ним остаётся)
      menuKind = kind;
      if (kind !== 'pause') closePause();
      if (!menuEl) return;
      menuEl.hidden = !kind || kind === 'pause';
      modalClass();
      if (kind) { goalsEl.hidden = true; if (invOpen) U.toggleInv(false); }
      if (!kind) { menuEl.innerHTML = ''; return; }
      if (kind === 'start') return startMenu();
      if (kind === 'pause') return pauseOpen();
      if (kind === 'help') { menuEl.innerHTML = helpHtml(); return; }
      if (kind === 'ach') { menuEl.innerHTML = achHtml(); return; }
      if (kind === 'newworld') { menuEl.innerHTML = await newWorldHtml(); return; }
      if (kind === 'newchar') { menuEl.innerHTML = newCharHtml(); return; }
      if (kind === 'mods' || kind === 'wmods') { menuEl.innerHTML = '<div class="pz-card pz-mods"><div class="pz-spin"></div></div>'; window.PZMods ? window.PZMods.renderMenu(menuEl.firstChild, API, kind === 'wmods', () => U.menu(G.state === 'menu' ? 'start' : 'pause')) : menuEl.innerHTML = '<div class="pz-card">Моды не загрузились</div>'; return; }
    };
    // пауза — общее меню игр сайта (как в «Кубомире» и «Мире Денчика»)
    function pauseItems(){
      const ach = G.CH?.ach || {}, gl = API.goal(), wait = Math.ceil(API.stuckWait?.() || 0);
      return [
        { id: 'resume', icon: '▶', text: 'Продолжить', primary: true },
        { id: 'opts', icon: '⚙️', text: 'Настройки' },
        { id: 'help', icon: '❓', text: 'Как играть' },
        { id: 'goals', icon: '🎯', text: `Цели${gl ? ` (${gl.i} из ${gl.n})` : ' — все выполнены'}` },
        { id: 'ach', icon: '🏆', text: `Достижения (${Object.keys(ach).length} из ${Object.keys(API.ACH).length})` },
        { id: 'stuck', icon: '🆘', text: wait > 0 ? `Я застрял (можно через ${wait} с)` : 'Я застрял — вытащить' },
        { id: 'save', icon: '💾', text: 'Сохранить' },
        { id: 'wmods', icon: '🧩', text: 'Моды мира' },
        { id: 'share', icon: '📣', text: 'Позвать друга' },
        { id: 'exit', icon: '🚪', text: 'Сохранить и выйти', warn: true },
      ];
    }
    function pauseOpen(){
      const S = window.D37Settings;
      const sub = `${esc(G.W?.name || '')} · день ${G.W?.day || 1}${API.clockText ? ' · ' + esc(API.clockText()) : ''}`;
      if (!S?.menu) {   // нет общего меню — своё
        menuEl.hidden = false;
        menuEl.innerHTML = `<div class="pz-card" style="max-width:440px"><h2>⏸ Пауза</h2><p class="pz-note">${sub}</p><div class="pz-row" style="flex-direction:column;align-items:stretch">${pauseItems().map(it => `<button type="button" class="pz-b${it.primary ? ' pri pz-big' : ''}${it.warn ? ' warn' : ''}" data-a="p:${it.id}">${it.icon} ${esc(it.text)}</button>`).join('')}</div></div>`;
        return;
      }
      closePause();
      let t = 0;
      const m = S.menu(wrap, { title: '⏸ Пауза', sub, items: pauseItems, onPick: id => pausePick(id), onClose: () => { clearInterval(t); if (pauseMenu === m) pauseMenu = null; if (!m.quiet && menuKind === 'pause') API.resume(); } });
      pauseMenu = m;
      // «Я застрял» — обратный отсчёт виден (таймер живёт, пока открыто меню)
      t = setInterval(() => { if (pauseMenu !== m) { clearInterval(t); return; } if ((API.stuckWait?.() || 0) > 0) m.redraw(); }, 1000);
    }
    async function pausePick(id){
      switch (id) {
        case 'resume': API.resume(); return;
        case 'opts': openSettings(); return;
        case 'help': U.menu('help'); return;
        case 'goals': API.resume(); goalsToggle(true); return;
        case 'ach': U.menu('ach'); return;
        case 'save': API.saveAll().then(() => API.toast('💾 Сохранено', 'good')); return;
        case 'stuck': {
          const r = API.unstuck?.();
          if (!r) return;
          if (r.wait) { API.toast(`🆘 Ещё ${Math.ceil(r.wait)} с — и можно снова`, 'info'); pauseMenu?.redraw(); return; }
          API.resume();
          API.toast(r.home ? '🆘 Рядом безопасного места нет — перенёс домой' : '🆘 Перенёс на безопасное место рядом', 'good');
          return;
        }
        case 'wmods': U.menu('wmods'); return;
        case 'share': share(); return;
        case 'exit': await API.stopWorld(true); U.menu('start'); return;
      }
    }
    function share(){
      const url = (window.D37Ref?.wrap || (u => u))(location.origin + '/games/podzem');   // 👥 с кодом приглашения (js/core/ref.js)
      const text = `Сыграй в «Подземье» на сайте dan4ik37! Мой мир — зерно «${G.W?.seedText || G.W?.seed}»: введи его в «Новый мир» — будет тот же мир.`;
      if (navigator.share) navigator.share({ title: 'Подземье', text, url }).catch(() => {});
      else navigator.clipboard?.writeText(text + ' ' + url).then(() => API.toast('Ссылка скопирована', 'good'), () => prompt('Скопируй:', text + ' ' + url));
    }
    // ⚙️ — вкладка «⛏ Подземье» в общем окне настроек сайта (там же графика, звук, интерфейс)
    function openSettings(){
      const S = window.D37Settings;
      if (S?.open) { S.open({ tab: 'podzem' }); return; }
      menuKind = 'opts'; menuEl.hidden = false; menuEl.innerHTML = optsHtml(); modalClass();
    }
    function settingsTab(onState){
      const S = window.D37Settings; if (!S?.addTab) return;
      if (!onState) { S.addTab({ id: 'podzem', icon: '⛏', title: 'Подземье', order: 5, ctx: [], render: () => '' }); return; }
      S.addTab({ id: 'podzem', icon: '⛏', title: 'Подземье', order: 5, ctx: ['game'], render(body){
        const o = G.opt, sw = (k, t, hint) => `<div class="gs-row"><div class="gs-lbl"><b>${t}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="gs-ctl"><label class="gs-sw"><input type="checkbox" data-pzo="${k}"${o[k] ? ' checked' : ''}><i aria-hidden="true"></i></label></div></div>`;
        const z = Math.round((o.zoom || 1) * 100), ts = Math.round(S.get('touchSize') || 100), ta = Math.round(S.get('touchAlpha') || 100);
        body.innerHTML = `<div class="gs-sec">Управление</div>
          ${sw('ledge', 'Цепляться за края', 'Прыгнул к стене выше себя и держишь к ней — герой хватается за край и подтягивается. Вниз или от стены — отпустить.')}
          ${sw('smart', 'Умный курсор (Ctrl)', 'Мышью: кирка сама находит блок у курсора, блок встаёт туда, где держится. Пальцем и геймпадом — всегда включён.')}
          <div class="gs-row"><div class="gs-lbl"><b>Масштаб мира</b><small>Ближе — крупнее, дальше — больше видно. На компьютере ещё «+ / −» и Ctrl+колесо.</small></div><div class="gs-ctl"><div class="gs-range"><input type="range" min="60" max="190" step="5" value="${z}" data-pzz="1" aria-label="Масштаб"><output data-pzzo="1">${z}%</output></div></div></div>
          <div class="gs-row"><div class="gs-lbl"><b>Кнопки на телефоне</b><small>Размер</small></div><div class="gs-ctl"><div class="gs-range"><input type="range" min="70" max="150" step="5" value="${ts}" data-range="touchSize" data-mul="1" aria-label="Размер кнопок"><output data-out="touchSize">${ts}%</output></div></div></div>
          <div class="gs-row"><div class="gs-lbl"><b>Прозрачность кнопок</b></div><div class="gs-ctl"><div class="gs-range"><input type="range" min="30" max="100" step="5" value="${ta}" data-range="touchAlpha" data-mul="1" aria-label="Прозрачность кнопок"><output data-out="touchAlpha">${ta}%</output></div></div></div>
          <div class="gs-row"><div class="gs-lbl"><b>Для левши</b><small>Кнопки — слева, джойстик — справа.</small></div><div class="gs-ctl"><label class="gs-sw"><input type="checkbox" data-sw="lefty"${S.get('lefty') ? ' checked' : ''}><i aria-hidden="true"></i></label></div></div>
          <div class="gs-sec">Картинка</div>
          ${sw('smooth', 'Плавный свет', 'Выключи — свет «клетками», как в старых играх.')}
          ${sw('back', 'Подземный фон в пещерах')}
          ${sw('parts', 'Частицы', 'Крошки, искры, дым.')}
          ${sw('fps', 'Показывать кадры в секунду')}
          <div class="gs-sec">Игра</div>
          ${sw('autosave', 'Автосохранение', 'Каждые 45 секунд и при выходе.')}
          <p class="gs-note">Шейдеры (Обычные, Красивые, Ультра, Ретро) — вкладка «🎨 Графика». Звук — «🔊 Звук».</p>`;
        body.onchange = e => {
          const k = e.target.dataset.pzo; if (!k) return;
          G.opt[k] = !!e.target.checked; API.saveOpt();
          if (k === 'smart') U.smart(G.opt.smart);
        };
        body.oninput = e => {
          if (!e.target.dataset.pzz) return;
          G.opt.zoom = +e.target.value / 100; const out = body.querySelector('[data-pzzo]'); if (out) out.textContent = e.target.value + '%';
          API.saveOpt(); API.resize();
        };
      } });
    }
    async function startMenu(){
      menuEl.hidden = false;
      const [chars, worlds] = await Promise.all([API.listChars(), API.listWorlds()]);
      if (menuKind !== 'start') return;
      const last = API.last() || {};
      if (!selChar || !chars.some(c => c.id === selChar)) selChar = (chars.find(c => c.id === last.c) || chars[0])?.id || null;
      if (!selWorld || !worlds.some(w => w.id === selWorld)) selWorld = (worlds.find(w => w.id === last.w) || worlds[0])?.id || null;
      const fresh = !chars.length && !worlds.length, ch = chars.find(c => c.id === selChar), wd = worlds.find(w => w.id === selWorld);
      const play = fresh ? `<button type="button" class="pz-b pri pz-big pz-play" data-a="quick">▶ Новая игра<small>Создадим героя и мир — сразу играть</small></button>`
        : ch && wd ? `<button type="button" class="pz-b pri pz-big pz-play" data-a="play">▶ Играть<small>${esc(ch.name)} · мир «${esc(wd.name)}»</small></button>`
        : `<button type="button" class="pz-b pri pz-big pz-play" disabled>▶ Играть<small>Выбери героя и мир ниже</small></button>`;
      menuEl.innerHTML = `<div class="pz-card pz-start">
        <h2>⛏ Подземье</h2>
        <p>Бесконечный мир сбоку: копай вглубь, строй дом, плавь руду, переживи ночь и победи боссов.</p>
        ${play}
        <div class="pz-cols">
          <section><h3>🧑 Герой</h3><div class="pz-list">${chars.map(c => `<div class="pz-it${c.id === selChar ? ' on' : ''}" data-char="${esc(c.id)}" role="button" tabindex="0"><span>❤</span><span class="tx"><b>${esc(c.name)}</b><small>здоровье ${c.maxHp} · ${fmtTime(c.playtime)}</small></span>
            <button type="button" class="ib" data-a="expchar" data-id="${esc(c.id)}" title="Сохранить в файл" aria-label="Сохранить в файл">📤</button><button type="button" class="ib" data-a="delchar" data-id="${esc(c.id)}" title="Удалить" aria-label="Удалить">🗑</button></div>`).join('') || '<div class="pz-note">Пока нет — создай.</div>'}</div>
            <div class="pz-row"><button type="button" class="pz-b" data-a="newchar">➕ Новый герой</button><button type="button" class="pz-b ghost" data-a="impchar">📥 Из файла</button></div></section>
          <section><h3>🌍 Мир</h3><div class="pz-list">${worlds.map(w => `<div class="pz-it${w.id === selWorld ? ' on' : ''}" data-world="${esc(w.id)}" role="button" tabindex="0"><span>🌍</span><span class="tx"><b>${esc(w.name)}</b><small>глубже всего ${w.maxDepth || 0} м · день ${w.day || 1} · ${fmtTime(w.playtime)}${w.mods?.length ? ' · 🧩 ' + w.mods.length : ''}</small></span>
            <button type="button" class="ib" data-a="expworld" data-id="${esc(w.id)}" title="Сохранить в файл" aria-label="Сохранить в файл">📤</button><button type="button" class="ib" data-a="delworld" data-id="${esc(w.id)}" title="Удалить" aria-label="Удалить">🗑</button></div>`).join('') || '<div class="pz-note">Пока нет — создай.</div>'}</div>
            <div class="pz-row"><button type="button" class="pz-b" data-a="newworld">➕ Новый мир</button><button type="button" class="pz-b ghost" data-a="impworld">📥 Из файла</button></div></section>
        </div>
        <div class="pz-foot"><button type="button" class="pz-b" data-a="help">❓ Как играть</button><button type="button" class="pz-b" data-a="opts">⚙️ Настройки</button><button type="button" class="pz-b" data-a="mods">🧩 Моды</button></div>
        <p class="pz-note" style="margin-top:10px">Сохраняется в этом браузере (мир — только изменённые места, поэтому он бесконечный и лёгкий). Кнопкой 📤 — в файл, чтобы перенести на другое устройство.</p>
      </div>`;
    }
    function helpHtml(){
      const pad = !!API.G?.pad?.on, first = touchUI ? 'touch' : pad ? 'pad' : 'pc';
      const sec = {
        pc: ['💻 Клавиатура и мышь', `<ul>
          <li><b>A / D</b> или ←/→ — идти, <b>Пробел</b> — прыжок (держи — выше), <b>W / S</b> — лезть по верёвке и лестнице, <b>S</b> — спрыгнуть с платформы</li>
          <li><b>Край стены:</b> прыгни к стене выше себя и держи к ней — герой схватится за край и подтянется (вниз или от стены — отпустить)</li>
          <li><b>ЛКМ</b> — то, что в руке: кирка копает, блок ставится, меч бьёт. <b>ПКМ</b> — открыть дверь или сундук, поговорить, съесть</li>
          <li><b>1…0</b> или колесо — ячейка, <b>I</b> или <b>Esc</b> — вещи и крафт, <b>H</b> — лечение, <b>B</b> — зелья, <b>E</b> — крюк-кошка (без крюка — открыть рядом), <b>P</b> — меню, <b>+ / −</b> — масштаб, <b>/</b> — команды</li>
          <li><b>Ctrl</b> — умный курсор 🎯 (кирка сама находит блок у курсора), <b>Shift</b> (держать) — сам возьмёт нужный инструмент под курсор</li>
          <li>Рамка у курсора: белая — достаёт, красная — далеко; блок в руке — видно, куда встанет. Пунктирный круг — докуда достаёт рука</li></ul>`],
        touch: ['📱 Телефон', `<ul>
          <li><b>Левый палец</b> — джойстик в любом месте слева: идти, вверх и вниз — лезть, к стене — схватиться за край</li>
          <li><b>⤒ Прыжок</b> — держи, чтобы выше. <b>Большая кнопка</b> делает то, что в руке: «Копать», «Удар», «Ставить», «Выпить» (враг рядом — бьёт сама)</li>
          <li><b>✋ Открыть</b> — дверь, сундук, Проводник рядом (кнопка светится, когда есть что открыть). <b>🎒 Вещи</b> — вещи и крафт</li>
          <li><b>Палец по миру</b>: держи — копать или ставить там, коротко — открыть дверь, сундук, поговорить</li>
          <li><b>✛ Точно</b> — крестик: двигай его пальцем, <b>✓ Сюда</b> — копать или ставить ровно в нём</li>
          <li>Лёжа удобнее, а кнопка ⛶ — во весь экран. Размер кнопок и «для левши» — ⚙️ → «⛏ Подземье»</li></ul>`],
        pad: ['🎮 Геймпад', `<ul><li>Левый стик — идти (к стене — схватиться за край), <b>A</b> — прыжок, правый стик — прицел, <b>RT</b> — копать/бить/ставить, <b>X</b> — открыть, <b>B</b> — крюк, <b>Y</b> — вещи, <b>LB/RB</b> — ячейки, <b>LT</b> — лечение, крестовина ↑ — зелья, <b>Start</b> — меню</li></ul>`],
      };
      const order = [first, ...['touch', 'pc', 'pad'].filter(k => k !== first)];
      return `<div class="pz-card pz-help"><h2>❓ Как играть</h2>
        <h3>${sec[first][0]}</h3>${sec[first][1]}
        ${order.slice(1).map(k => `<details><summary>${sec[k][0]}</summary>${sec[k][1]}</details>`).join('')}
        <h3>🧭 С чего начать</h3><ol>
          <li>Наруби дерева 🪓 → в «🎒 Вещи → 🛠 Сделать» — <b>верстак</b>. Рядом с ним — платформы, двери, стены.</li>
          <li>До ночи построй дом: стены сзади, дверь, факел (дерево + гель от слизней).</li>
          <li>Копай вниз ⛏: медь и железо → <b>печь</b> → слитки → <b>наковальня</b> → кирка и меч лучше.</li>
          <li>Кристаллы жизни ❤ в пещерах — +20 к здоровью навсегда. Возвратный амулет — домой из глубины.</li>
          <li>Боссы: «Желейная приманка» и «Совиный манок» (только ночью). Победа даёт XP и монеты сайта.</li></ol>
        <p class="pz-note">Не можешь выбраться? Меню → «🆘 Я застрял». Без сил — нокаут: встанешь у кровати, вещи с тобой.</p>
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="back">← Назад</button></div></div>`;
    }
    function optsHtml(){   // запасное окно настроек (если нет общего окна сайта)
      const o = G.opt, chk = (k, t) => `<label class="pz-chk"><input type="checkbox" data-opt="${k}" ${o[k] ? 'checked' : ''}> ${t}</label>`;
      return `<div class="pz-card" style="max-width:460px"><h2>⚙️ Настройки игры</h2>
        <div class="pz-field"><span>Масштаб: <b data-zv>${Math.round(o.zoom * 100)}%</b></span><input type="range" min="60" max="190" step="5" value="${Math.round(o.zoom * 100)}" data-opt="zoom"></div>
        ${chk('ledge', 'Цепляться за края: прыгнул к стене выше себя — схватился и подтянулся')}
        ${chk('smooth', 'Плавный свет (выкл — свет «клетками», как в старых играх)')}
        ${chk('back', 'Подземный фон в пещерах')}
        ${chk('parts', 'Частицы (крошки, искры, дым)')}
        ${chk('autosave', 'Автосохранение каждые 45 с')}
        ${chk('fps', 'Показывать кадры в секунду')}
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="back">← Назад</button></div></div>`;
    }
    function achHtml(){
      const got = G.CH?.ach || {};
      return `<div class="pz-card"><h2>🏆 Достижения</h2><p class="pz-note">У героя «${esc(G.CH?.name || '')}»: ${Object.keys(got).length} из ${Object.keys(API.ACH).length}</p>
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
      return `<div class="pz-card" style="max-width:420px"><h2>🧑 Новый герой</h2>
        <p class="pz-note">Выглядит как твой персонаж сайта (гардероб 🎭). Здесь — вещи, здоровье и достижения.</p>
        <div class="pz-field"><span>Имя</span><input data-f="cname" maxlength="24" value="${esc(nick)}"></div>
        <div class="pz-row"><button type="button" class="pz-b pri" data-a="mkchar">Создать</button><button type="button" class="pz-b ghost" data-a="back">Отмена</button></div></div>`;
    }
    const pickFile = accept => new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files?.[0] || null); i.click(); });
    const download = (name, obj) => { const b = new Blob([JSON.stringify(obj)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
    const ask = (t, txt) => window.GameKit?.ask ? window.GameKit.ask({ icon: '🗑', title: t, text: txt, yes: 'Удалить', no: 'Отмена', danger: true }) : Promise.resolve(confirm(t));
    async function onMenu(e){
      const ch = e.target.closest('[data-char]'), w = e.target.closest('[data-world]'), a = e.target.closest('[data-a]')?.dataset.a, id = e.target.closest('[data-id]')?.dataset.id;
      if (!a && ch) { selChar = ch.dataset.char; startMenu(); return; }
      if (!a && w) { selWorld = w.dataset.world; startMenu(); return; }
      if (a && a.startsWith('p:')) { pausePick(a.slice(2)); return; }
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
        case 'delchar': if (await ask('Удалить героя?', 'Его вещи и достижения пропадут (если не сохранил в файл).')) { await API.deleteChar(id); startMenu(); } return;
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
        case 'opts': openSettings(); return;
        case 'ach': U.menu('ach'); return;
        case 'back': U.menu(G.state === 'menu' ? 'start' : 'pause'); return;
        case 'resume': API.resume(); return;
      }
    }
    // запасное окно настроек: флажки и масштаб
    on(document, 'change', e => {
      if (!menuEl || !menuEl.contains(e.target)) return;
      const k = e.target.dataset.opt; if (!k) return;
      if (k === 'zoom') { G.opt.zoom = +e.target.value / 100; menuEl.querySelector('[data-zv]').textContent = e.target.value + '%'; API.resize(); }
      else G.opt[k] = !!e.target.checked;
      API.saveOpt();
    });
    on(document, 'input', e => { if (menuEl?.contains(e.target) && e.target.dataset.opt === 'zoom') { G.opt.zoom = +e.target.value / 100; menuEl.querySelector('[data-zv]').textContent = e.target.value + '%'; API.resize(); } });

    // ═══ Управление пальцем ═══
    // Слева — джойстик (появляется под пальцем; пока им не пользовались — подсказка), справа — кнопки с подписями:
    // ⤒ «Прыжок», большая — «Копать / Удар / Ставить…» (по вещи в руке; враг рядом — бьёт его), «✋ Открыть» (светится,
    // если рядом дверь, сундук, Проводник), «🎒 Вещи», «🪝 Крюк» (когда есть), «✛ Точно» — крестик и «✓ Сюда».
    // Палец по миру: держи — копать/ставить/бить там (умный курсор подправит), коротко — открыть/поговорить.
    function buildTouch(wrap){
      touchEl.innerHTML = `<div class="pz-tc">
          <button type="button" class="tb" data-t="jump" style="--d:80px;--x:12px;--y:16px" aria-label="Прыжок"><span class="i">⤒</span><b>Прыжок</b></button>
          <button type="button" class="tb" data-t="use" style="--d:70px;--x:104px;--y:10px" aria-label="Действие вещью в руке"><span class="i">⛏</span><b>Копать</b></button>
          <button type="button" class="tb" data-t="act" style="--d:58px;--x:22px;--y:110px" aria-label="Открыть, поговорить"><span class="i">✋</span><b>Открыть</b></button>
          <button type="button" class="tb" data-t="inv" style="--d:58px;--x:96px;--y:94px" aria-label="Вещи и крафт"><span class="i">🎒</span><b>Вещи</b></button>
          <button type="button" class="tb" data-t="hook" style="--d:54px;--x:180px;--y:40px" aria-label="Крюк-кошка" hidden><span class="i">🪝</span><b>Крюк</b></button>
          <button type="button" class="tb" data-t="build" style="--d:50px;--x:30px;--y:184px" aria-label="Точный крестик"><span class="i">✛</span><b>Точно</b></button>
          <button type="button" class="tb ok" data-t="put" style="--d:62px;--x:172px;--y:100px" aria-label="Копать или ставить там, где крестик" hidden><span class="i">✓</span><b>Сюда</b></button>
        </div>
        <div class="pz-joyhint"${lsGet('d37_pz_joy') ? ' hidden' : ''}>◀ ▶<br>двигай<br>пальцем</div>
        <div class="pz-joy" hidden><i></i></div>`;
      const joyEl = touchEl.querySelector('.pz-joy'), knob = joyEl.querySelector('i'), hintEl = touchEl.querySelector('.pz-joyhint');
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
          API.toast(v ? '✛ Двигай крестик пальцем, «✓ Сюда» — копать или ставить ровно там' : 'Крестик убран', 'info');
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
        if (!touchUI) setTouch(true);
        if (G.state !== 'play' || U.modal() || invOpen) return;
        e.preventDefault();
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        try { cv.setPointerCapture(e.pointerId); } catch (er) {}
        const lefty = !!window.D37Opt?.lefty || document.documentElement.classList.contains('gs-lefty'), inJoy = (lefty ? x > r.width * .55 : x < r.width * .45) && y > r.height * .3;
        if (inJoy && ![...ptr.values()].some(q => q.kind === 'joy')) {
          ptr.set(e.pointerId, { kind: 'joy', ox: x, oy: y, R: 54 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gs-touch')) || 1) });
          joyEl.hidden = false; joyEl.style.left = x + 'px'; joyEl.style.top = y + 'px'; knob.style.transform = '';
          if (hintEl && !hintEl.hidden) { hintEl.hidden = true; lsSet('d37_pz_joy', '1'); }
          return;
        }
        if (U.touch.build) { ptr.set(e.pointerId, { kind: 'cross', x0: x, y0: y, lx: x, ly: y, t0: performance.now(), moved: false }); return; }   // крестик: палец двигает
        const q = { kind: 'world', x0: x, y0: y, t0: performance.now(), moved: false, use: false };
        ptr.set(e.pointerId, q);
        API.aimTouch(x, y);
        q.timer = setTimeout(() => { if (ptr.get(e.pointerId) === q) { q.use = true; U.touch.use = true; } }, 180);
      });
      cv.addEventListener('pointermove', e => {
        const q = ptr.get(e.pointerId); if (!q) return;
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (q.kind === 'joy') {
          const R = q.R, dx = (x - q.ox) / R, dy = (y - q.oy) / R, d = Math.hypot(dx, dy), k = d > 1 ? 1 / d : 1;
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
      // окно открылось — отпустить всё, что держали пальцем (кнопки скрыты)
      U.releaseTouch = () => { ptr.clear(); U.touch.mx = U.touch.my = 0; U.touch.jump = U.touch.use = U.touch.front = false; joyEl.hidden = true; for (const b of touchEl.querySelectorAll('.tb.on')) b.classList.remove('on'); API.attackEnd(); };
    }

    U.dispose = () => {
      offs.forEach(f => f()); offs.length = 0;
      clearInterval(koT); clearTimeout(selNameT);
      closePause();
      settingsTab(false);
      modalObs.disconnect();
      if (atlasUrl) URL.revokeObjectURL(atlasUrl);
      root = null;
    };
    return U;
  }
  window.PZUI = { create };
})();
