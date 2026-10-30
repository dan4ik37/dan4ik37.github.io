// ═══════════════════════════════════════
//  ИГРА «ПИТОМЕЦ» (T-140) — день с Бусей: корми, играй, укладывай спать и исполняй желания. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — питомец, три шкалы и три кнопки (DOM). Время — в шагах (60 в секунду).
// Буся — свой пушистый звёздный зверёк (нарисован CSS). День — 2,5 минуты, потребности тают всё быстрее, к вечеру сильнее
// хочется спать. Своё: желания 💭 (успей за 4 с — +15), пока Буся спит, остальное тает вдвое медленнее; лишняя забота
// (шкала почти полная) — «Не хочу!» и −3.
// Очки: +1 за каждую секунду дня, желание +15, весь день — +30. Любая шкала на нуле — Буся обиделся и ушёл гулять (конец).
// Исправлено против прототипа: таймер setInterval раз в секунду и s.map на каждом тике → шаги и Float64Array; кнопки без
// перезарядки (частые нажатия держали питомца вечно) → у действия есть время (Буся ест / играет / спит); «перекормил» бил по
// другой шкале без объяснения → «Не хочу!» и −3; после конца любое нажатие сразу начинало новую игру (тот же баг «нажал —
// и всё») → оверлей ядра; партия без конца → день кончается; 💀 → «ушёл гулять» (детская игра).
(() => {
  const T = ArcadeKit.T;
  const DAY = 150 * 60, NW = 48, WISH = 240, GRUMP = 45;   // шагов
  const RATE = [2.3, 1.9, 1.4];                             // тает в секунду (еда, игра, сон) — в начале дня
  const GAIN = [30, 30, 40], BUSY = [40, 40, 90], FULL = 85;
  const ICON = ['🍎', '⚽', '💤'], WHAT = ['Кормить', 'Играть', 'Спать'];

  function create(rng){
    const s = { rng, t: 0, busy: 0, act: -1, wish: -1, wishT: 0, wi: 0, nextW: 0, grump: 0, score: 0, sec: 0, wishes: 0, nos: 0,
      over: false, why: '', v: 0, snd: 0,
      need: new Float64Array([70, 70, 70]), wk: new Uint8Array(NW), wt: new Uint16Array(NW) };
    // желания заранее (у соперников одинаковые): какое и через сколько (6–9 с)
    for (let i = 0; i < NW; i++) { s.wk[i] = Math.floor(rng() * 3); s.wt[i] = 360 + Math.floor(rng() * 180); }
    s.nextW = 300;
    return s;
  }

  function input(s, e){
    if (s.over || (e.type !== T.PICK && e.type !== T.KEY)) return;
    const k = e.k;
    if (!(k >= 0 && k < 3) || s.busy) return;
    s.v++;
    if (s.need[k] > FULL) { s.grump = GRUMP; s.busy = 20; s.nos++; s.score = Math.max(0, s.score - 3); s.snd = 'bad'; return; }
    s.need[k] = Math.min(100, s.need[k] + GAIN[k]);
    s.act = k; s.busy = BUSY[k]; s.grump = 0; s.snd = k === 2 ? 262 : k === 1 ? 523 : 392;
    if (s.wish === k) { s.wish = -1; s.wishT = 0; s.wishes++; s.score += 15; s.snd = 'win'; }
  }

  function step(s, dt){
    if (s.over) return;
    s.t++;
    if (++s.sec === 60) { s.sec = 0; s.score++; }
    if (s.busy && !--s.busy) { s.act = -1; s.v++; }
    if (s.grump) s.grump--;
    // потребности тают: к концу дня втрое быстрее; вечером (последние 40% дня) сон тает в 1,5 раза быстрее; пока спит — остальное вдвое медленнее
    const speed = (1 + 2 * s.t / DAY) * dt, night = s.t > DAY * .6;
    for (let k = 0; k < 3; k++) {
      let r = RATE[k] * speed;
      if (k === 2 && night) r *= 1.5;
      if (s.act === 2 && k !== 2) r *= .5;
      s.need[k] -= r;
      if (s.need[k] <= 0) { s.need[k] = 0; s.over = true; s.why = 'run'; s.wish = -1; s.snd = 'bad'; s.v++; return; }
    }
    if (s.wish >= 0) { if (!--s.wishT) { s.wish = -1; s.v++; } }
    else if (!--s.nextW) {
      const i = s.wi % NW;
      s.wi++; s.wish = s.wk[i]; s.wishT = WISH; s.nextW = s.wt[i]; s.snd = 784; s.v++;
    }
    if (s.t >= DAY) { s.score += 30; s.over = true; s.why = 'day'; s.wish = -1; s.snd = 'win'; s.v++; return; }
    if (s.t % 6 === 0) s.v++;
  }

  const CSS = '.pt{position:relative;display:flex;flex-direction:column;align-items:center;gap:.55rem;padding:.9rem .7rem .8rem;border-radius:14px;overflow:hidden;'
    + 'background:linear-gradient(var(--sky1,#7ec8ff),var(--sky2,#d9f1ff));transition:background .8s}'
    + '.pt-scene{position:relative;width:100%;max-width:340px;height:170px;display:flex;align-items:flex-end;justify-content:center}'
    + '.pt-ground{position:absolute;left:-10%;right:-10%;bottom:0;height:34px;border-radius:50% 50% 0 0;background:#5cc27a}'
    + '.pt-pet{position:relative;width:120px;height:110px;margin-bottom:14px;transition:transform .2s}'
    + '.pt-body{position:absolute;inset:0;border-radius:50% 50% 46% 46%;background:radial-gradient(circle at 35% 30%,#e4d4ff,#a98bff 55%,#7d5ce6);box-shadow:0 8px 0 rgba(0,0,0,.12)}'
    + '.pt-body::before,.pt-body::after{content:"";position:absolute;top:-16px;width:8px;height:22px;border-radius:4px;background:#8d6df0}'
    + '.pt-body::before{left:30px;transform:rotate(-18deg)}.pt-body::after{right:30px;transform:rotate(18deg)}'
    + '.pt-ant{position:absolute;top:-26px;font-size:14px}.pt-ant.l{left:20px}.pt-ant.r{right:20px}'
    + '.pt-eye{position:absolute;top:36px;width:18px;height:22px;border-radius:50%;background:#1b1430;transition:height .15s,top .15s}'
    + '.pt-eye::after{content:"";position:absolute;top:4px;left:4px;width:6px;height:6px;border-radius:50%;background:#fff}'
    + '.pt-eye.l{left:30px}.pt-eye.r{right:30px}'
    + '.pt-mouth{position:absolute;left:50%;top:66px;width:30px;height:14px;transform:translateX(-50%);border:4px solid #1b1430;border-top:0;border-radius:0 0 20px 20px}'
    + '.pt-cheek{position:absolute;top:60px;width:14px;height:8px;border-radius:50%;background:#ff8fb1aa}.pt-cheek.l{left:16px}.pt-cheek.r{right:16px}'
    + '.pt.sad .pt-mouth{top:72px;border:4px solid #1b1430;border-bottom:0;border-radius:20px 20px 0 0}'
    + '.pt.ok .pt-mouth{height:0;border-radius:0}'
    + '.pt.zz .pt-eye{height:4px;top:46px}.pt.zz .pt-eye::after{display:none}'
    + '.pt.a0 .pt-pet{animation:ptE .3s ease-in-out infinite alternate}@keyframes ptE{to{transform:scale(1.06,.94)}}'
    + '.pt.a1 .pt-pet{animation:ptJ .35s ease-out infinite alternate}@keyframes ptJ{to{transform:translateY(-22px)}}'
    + '.pt.no .pt-pet{animation:ptN .1s linear infinite alternate}@keyframes ptN{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}'
    + '.pt.gone .pt-pet{transform:translateX(160%) scale(.6);opacity:.2;transition:transform 1.2s,opacity 1.2s}'
    + '.pt-say{position:absolute;top:4px;left:50%;transform:translateX(-50%);background:#fff;color:#222;border-radius:14px;padding:.25rem .6rem;font:700 .9rem system-ui,sans-serif;'
    + 'box-shadow:0 3px 8px rgba(0,0,0,.2);white-space:nowrap}.pt-say:empty{display:none}'
    + '.pt-bars{width:100%;max-width:340px;display:grid;grid-template-columns:auto 1fr;gap:.3rem .5rem;align-items:center;font-size:1rem}'
    + '.pt-bar{height:12px;border-radius:6px;background:rgba(0,0,0,.18);overflow:hidden}.pt-bar i{display:block;height:100%;border-radius:6px;background:#2ec27e;transition:width .15s}'
    + '.pt-bar.lo i{background:#ff4d6d}.pt-bar.mid i{background:#ffc233}'
    + '.pt-btns{width:100%;max-width:340px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}'
    + '.pt-b{min-height:52px;border:0;border-radius:14px;background:#fff;color:#222;font:700 .85rem system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.18);touch-action:manipulation}'
    + '.pt-b span{display:block;font-size:1.3rem}.pt-b.w{box-shadow:0 0 0 3px #ffb300,0 4px 0 rgba(0,0,0,.18)}'
    + '.pt-b:disabled{opacity:.55;cursor:default}.pt-b:focus-visible{outline:3px solid #3a86ff;outline-offset:2px}'
    + 'body.low .pt,body.low .pt-pet,body.low .pt-bar i{transition:none;animation:none}';
  const SKY = [['#7ec8ff', '#d9f1ff'], ['#ffb37e', '#ffe2c4'], ['#4b3d8f', '#a07ad6'], ['#141a3d', '#3a2d6b']];

  function build(G){
    if (!document.getElementById('ptCss')) { const st = document.createElement('style'); st.id = 'ptCss'; st.textContent = CSS; document.head.appendChild(st); }
    let h = '<div class="pt"><div class="pt-scene"><div class="pt-ground"></div><div class="pt-say"></div><div class="pt-pet"><div class="pt-body"></div>'
      + '<span class="pt-ant l">⭐</span><span class="pt-ant r">⭐</span><i class="pt-eye l"></i><i class="pt-eye r"></i><i class="pt-cheek l"></i><i class="pt-cheek r"></i><i class="pt-mouth"></i></div></div>'
      + '<div class="pt-bars">';
    for (let k = 0; k < 3; k++) h += '<span>' + ICON[k] + '</span><div class="pt-bar"><i></i></div>';
    h += '</div><div class="pt-btns">';
    for (let k = 0; k < 3; k++) h += '<button type="button" class="pt-b" data-k="' + k + '"><span>' + ICON[k] + '</span>' + WHAT[k] + '</button>';
    G.host.innerHTML = h + '</div></div>';
    G.box = G.host.firstChild;
    G.say = G.box.querySelector('.pt-say');
    G.bars = G.box.querySelectorAll('.pt-bar');
    G.btns = G.box.querySelectorAll('.pt-b');
    G.sky = -1;
  }

  function draw(G, s){
    let m = 100;
    for (let k = 0; k < 3; k++) {
      const v = s.need[k];
      if (v < m) m = v;
      G.bars[k].firstChild.style.width = Math.max(0, Math.min(100, v)).toFixed(1) + '%';
      G.bars[k].classList.toggle('lo', v < 25);
      G.bars[k].classList.toggle('mid', v >= 25 && v < 50);
      G.btns[k].disabled = !!s.busy || s.over;
      G.btns[k].classList.toggle('w', s.wish === k);
    }
    const sky = Math.min(3, Math.floor(s.t / DAY * 4));
    if (sky !== G.sky) { G.sky = sky; G.box.style.setProperty('--sky1', SKY[sky][0]); G.box.style.setProperty('--sky2', SKY[sky][1]); }
    const b = G.box.classList;
    b.toggle('sad', m < 25); b.toggle('ok', m >= 25 && m < 50);
    b.toggle('zz', s.act === 2); b.toggle('a0', s.act === 0); b.toggle('a1', s.act === 1);
    b.toggle('no', s.grump > 0); b.toggle('gone', s.over && s.why === 'run');
    G.say.textContent = s.over ? (s.why === 'day' ? 'Спасибо за день! 🌙' : 'Хмф… пойду гулять') : s.grump ? 'Не хочу!' : s.wish >= 0 ? '💭 ' + ICON[s.wish] + '?'
      : s.act === 0 ? 'Ням-ням!' : s.act === 1 ? 'Ура, мяч!' : s.act === 2 ? 'Хр-р…' : m < 25 ? 'Мне плохо…' : '';
  }

  ArcadeKit.define('pet', {
    kind: 'dom', W: 320, H: 420, maxW: 400,
    title: '🐾 Питомец',
    intro: 'Целый день с Бусей — пушистым зверьком со звёздной полянки. Корми, играй и укладывай спать, чтобы ни одна шкала не опустела. 💭 Исполни желание за 4 секунды — +15.',
    controls: 'Кнопки внизу или клавиши 1 2 3. Пока Буся ест, играет или спит — подожди. Шкала почти полная — «Не хочу!» и −3.',
    duelTitle: 'Одинаковые желания у обоих',
    keys: { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 },
    create, input, step, draw, build,
    hudKey: s => Math.ceil((DAY - s.t) / 60) * 100 + s.wishes,
    hud: s => '☀️ до ночи ' + Math.ceil((DAY - s.t) / 60) + ' с · 💭 ' + s.wishes,
    win: s => s.why === 'day',
    result: s => ({
      title: s.why === 'day' ? (s.wishes >= 12 ? '🌟 Лучший друг Буси!' : '🌙 Буся счастлив!') : '🚶 Буся ушёл гулять',
      text: (s.why === 'day' ? 'весь день' : 'прожито ' + Math.floor(s.t / 60) + ' с') + ' · желаний: ' + s.wishes,
    }),
    consts: { DAY, WISH, GRUMP, RATE, GAIN, BUSY, FULL },
  });
})();
