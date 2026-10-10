// ═══════════════════════════════════════
//  МОЙ ПЕРСОНАЖ 🎭 — свой герой для игр сайта: цвет, глаза, рот, шапка, предмет, питомец, след
// ═══════════════════════════════════════
// Рисуется кодом на canvas (без картинок): D37Char.draw(ctx, look, x, y, size) — ноги в точке (x, y),
// size — рост. Для игр быстрее D37Char.sprite(look, px) — готовый canvas, рисовать drawImage.
// Части покупаются за монеты (js/core/coins.js, предмет 'skin:<слот>:<id>'); цена 0 — доступна всем;
// vip — бесплатно для VIP/персонала или за монеты. Цены — как coin_price() в coins.sql (раздел «Персонаж»):
// поменял тут — поменяй там (scripts в сессии генерировали SQL из этого списка).
// Надетое (look) — в базе (char_save / char_looks в coins.sql) или в браузере (d37_char), пока не вошёл.
// Где виден: «Орда» (герой), гардероб #/games/wardrobe (js/games/wardrobe.js), витрина игр, профиль.
(() => {
  const EF = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const TAU = Math.PI * 2;
  // [id, название, цена, значение (цвет / эмодзи), vip]
  const PARTS = {
    color: { name: 'Цвет', icon: '🎨', list: [
      ['blue', 'Синий', 0, '#4f8df7'], ['red', 'Красный', 0, '#ff4d6d'], ['green', 'Зелёный', 0, '#34c759'],
      ['yellow', 'Жёлтый', 60, '#ffcc33'], ['orange', 'Оранжевый', 60, '#ff8c2e'], ['purple', 'Фиолетовый', 60, '#9b6dff'],
      ['pink', 'Розовый', 60, '#ff6fb5'], ['teal', 'Бирюзовый', 60, '#22c7b8'], ['white', 'Белый', 100, '#eef0f4'],
      ['black', 'Чёрный', 100, '#3a3a46'], ['galaxy', 'Космос', 350, '#2b2366'], ['gold', 'Золото', 800, '#f5b81c'],
      ['rainbow', 'Радуга', 3000, '#ff4d6d', 1],
    ] },
    eyes: { name: 'Глаза', icon: '👀', list: [
      ['normal', 'Обычные', 0], ['happy', 'Довольные', 0], ['angry', 'Злые', 50], ['sleepy', 'Сонные', 50],
      ['dizzy', 'Ошалевшие', 80], ['heart', 'Влюблённые', 100], ['star', 'Звёзды', 100], ['cool', 'Очки', 120],
      ['cyclops', 'Циклоп', 150], ['robot', 'Визор', 200],
    ] },
    mouth: { name: 'Рот', icon: '👄', list: [
      ['smile', 'Улыбка', 0], ['cat', 'Котик', 0], ['grin', 'Хохот', 40], ['o', 'Удивление', 40],
      ['tongue', 'Язык', 60], ['fangs', 'Клыки', 80], ['mustache', 'Усы', 120],
    ] },
    hat: { name: 'Шапка', icon: '🎩', list: [
      ['none', 'Без шапки', 0], ['bow', 'Бантик', 100, '🎀'], ['cap', 'Кепка', 100, '🧢'], ['party', 'Колпак', 120],
      ['grad', 'Выпускник', 150, '🎓'], ['helmet', 'Каска', 150, '⛑️'], ['army', 'Шлем', 150, '🪖'], ['top', 'Цилиндр', 200, '🎩'],
      ['ears', 'Ушки', 200], ['horns', 'Рожки', 250], ['propeller', 'Пропеллер', 250], ['halo', 'Нимб', 300],
      ['crown', 'Корона', 800, '👑'], ['headphones', 'Наушники стримера', 3000, '', 1],
    ] },
    item: { name: 'В руке', icon: '✋', list: [
      ['none', 'Ничего', 0], ['rose', 'Роза', 80, '🌹'], ['pizza', 'Пицца', 80, '🍕'], ['balloon', 'Шарик', 100, '🎈'],
      ['mic', 'Микрофон', 100, '🎤'], ['gamepad', 'Геймпад', 120, '🎮'], ['flashlight', 'Фонарик', 120, '🔦'],
      ['sword', 'Меч', 150, '🗡️'], ['trophy', 'Кубок', 300, '🏆'],
    ] },
    pet: { name: 'Питомец', icon: '🐾', list: [
      ['none', 'Без питомца', 0], ['dog', 'Пёсик', 300, '🐶'], ['cat', 'Котик', 300, '🐱'], ['frog', 'Лягушка', 300, '🐸'],
      ['fox', 'Лис', 400, '🦊'], ['ghost', 'Призрак', 400, '👻'], ['robot', 'Робот', 500, '🤖'], ['unicorn', 'Единорог', 700, '🦄'],
      ['dragon', 'Дракончик', 900, '🐲'],
    ] },
    trail: { name: 'След', icon: '✨', list: [
      ['none', 'Без следа', 0], ['dust', 'Пыль', 100, '💨'], ['sparks', 'Искры', 250, '✨'], ['hearts', 'Сердечки', 250, '💕'],
      ['notes', 'Ноты', 300, '🎵'], ['stars', 'Звёзды', 300, '⭐'], ['fire', 'Огонь', 350, '🔥'], ['rainbow', 'Радуга', 3000, '🌈', 1],
    ] },
  };
  const SLOTS = Object.keys(PARTS);
  const DEFAULT = { color: 'blue', eyes: 'normal', mouth: 'smile', hat: 'none', item: 'none', pet: 'none', trail: 'none' };
  const LS = 'd37_char';

  const part = (slot, id) => {
    const p = PARTS[slot]?.list.find(x => x[0] === id) || PARTS[slot]?.list[0];
    return p && { id: p[0], name: p[1], price: p[2], v: p[3] || '', vip: !!p[4] };
  };
  function price(item){
    const m = /^skin:(\w+):(\w+)$/.exec(item || '');
    if (!m || !PARTS[m[1]]) return null;
    const p = PARTS[m[1]].list.find(x => x[0] === m[2]);
    return p ? p[2] : null;
  }
  function norm(look){
    const L = { ...DEFAULT };
    if (look && typeof look === 'object') for (const s of SLOTS) if (PARTS[s].list.some(x => x[0] === look[s])) L[s] = look[s];
    return L;
  }

  // ── Владение: бесплатное, купленное, VIP-часть у VIP/персонала ──
  function owns(slot, id){
    const p = part(slot, id);
    if (!p || p.id !== id) return false;
    if (!p.price) return true;
    const C = window.D37Coins;
    return !!C && (C.owns(`skin:${slot}:${id}`) || (p.vip && C.perks()));
  }

  // ── Надетое ──
  let mine = null;
  const listeners = new Set();
  function readLocal(){ try { return norm(JSON.parse(localStorage.getItem(LS))); } catch (e) { return { ...DEFAULT }; } }
  function current(){
    if (!mine) mine = readLocal();
    return mine;
  }
  // Снять то, чем больше не владеешь (кончился VIP, вышел из аккаунта) — вместо этого бесплатное
  function wearable(look){
    const L = norm(look);
    for (const s of SLOTS) if (!owns(s, L[s])) L[s] = DEFAULT[s];
    return L;
  }
  async function set(look){
    mine = wearable(look);
    try { localStorage.setItem(LS, JSON.stringify(mine)); } catch (e) {}
    listeners.forEach(fn => { try { fn(mine); } catch (e) {} });
    const r = await window.D37Coins?.saveLook?.(mine);
    return r || { ok: true };
  }
  // Кошелёк узнал надетое из базы (coins_state) — берём его; если в базе пусто, а в браузере есть — сохраним туда
  function fromServer(look){
    if (look && Object.keys(look).length) {
      mine = norm(look);
      try { localStorage.setItem(LS, JSON.stringify(mine)); } catch (e) {}
      listeners.forEach(fn => { try { fn(mine); } catch (e) {} });
    } else if (JSON.stringify(current()) !== JSON.stringify(DEFAULT)) window.D37Coins?.saveLook?.(current());
  }

  // ── Рисование ──
  function shade(hex, amt){
    const n = parseInt(hex.slice(1), 16), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (t - v) * p));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function bodyFill(ctx, col, S, t){
    const cy = -.47 * S;
    if (col.id === 'rainbow') {
      const g = ctx.createLinearGradient(-.4 * S, cy - .4 * S, .4 * S, cy + .4 * S);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${Math.round(i * 60 + t * 90) % 360},90%,62%)`);
      return g;
    }
    if (col.id === 'gold') {
      const g = ctx.createLinearGradient(-.2 * S, cy - .42 * S, .2 * S, cy + .42 * S);
      g.addColorStop(0, '#fff6cc'); g.addColorStop(.3, '#ffd34d'); g.addColorStop(.7, '#e09b12'); g.addColorStop(1, '#8a5207');
      return g;
    }
    if (col.id === 'galaxy') {
      const g = ctx.createRadialGradient(-.1 * S, cy - .15 * S, .02 * S, 0, cy, .5 * S);
      g.addColorStop(0, '#8b5cf6'); g.addColorStop(.45, '#3b2a8f'); g.addColorStop(1, '#0d0a2b');
      return g;
    }
    const g = ctx.createRadialGradient(-.12 * S, cy - .2 * S, .04 * S, 0, cy, .56 * S);
    g.addColorStop(0, shade(col.v, .38)); g.addColorStop(.55, col.v); g.addColorStop(1, shade(col.v, -.32));
    return g;
  }
  function emoji(ctx, e, x, y, size, rot){
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.font = `${Math.round(size)}px ${EF}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e, 0, 0);
    ctx.restore();
  }
  function star(ctx, x, y, r){
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function heart(ctx, x, y, s){
    ctx.beginPath();
    ctx.moveTo(x, y + s * .35);
    ctx.bezierCurveTo(x - s * .9, y - s * .3, x - s * .35, y - s * .95, x, y - s * .35);
    ctx.bezierCurveTo(x + s * .35, y - s * .95, x + s * .9, y - s * .3, x, y + s * .35);
    ctx.fill();
  }

  function drawEyes(ctx, kind, S, t){
    const ey = -.6 * S, ex = .13 * S, dark = '#1b1626';
    const blink = kind !== 'cool' && kind !== 'robot' && t % 4 > 3.86;
    ctx.lineCap = 'round';
    const white = (x, y, rx, ry) => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); };
    const pupil = (x, y, r) => {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - r * .35, y - r * .4, r * .35, 0, TAU); ctx.fill();
    };
    if (blink && kind !== 'happy') {
      ctx.strokeStyle = dark; ctx.lineWidth = .028 * S;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * ex - .06 * S, ey); ctx.lineTo(s * ex + .06 * S, ey); ctx.stroke(); }
      return;
    }
    switch (kind) {
      case 'happy':
        ctx.strokeStyle = dark; ctx.lineWidth = .032 * S;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * ex, ey + .03 * S, .058 * S, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
        break;
      case 'sleepy':
        for (const s of [-1, 1]) {
          white(s * ex, ey + .02 * S, .075 * S, .05 * S); pupil(s * ex + .012 * S, ey + .03 * S, .034 * S);
          ctx.strokeStyle = dark; ctx.lineWidth = .026 * S; ctx.beginPath(); ctx.moveTo(s * ex - .085 * S, ey - .01 * S); ctx.lineTo(s * ex + .085 * S, ey - .01 * S); ctx.stroke();
        }
        break;
      case 'cool':
        ctx.fillStyle = '#111'; ctx.strokeStyle = '#111'; ctx.lineWidth = .025 * S;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(s * ex - .09 * S, ey - .055 * S, .18 * S, .11 * S, .04 * S) : ctx.rect(s * ex - .09 * S, ey - .055 * S, .18 * S, .11 * S); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(-ex + .09 * S, ey - .02 * S); ctx.lineTo(ex - .09 * S, ey - .02 * S); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = .016 * S;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * ex - .05 * S, ey - .03 * S); ctx.lineTo(s * ex - .02 * S, ey + .02 * S); ctx.stroke(); }
        break;
      case 'heart':
        ctx.fillStyle = '#ff2d55';
        for (const s of [-1, 1]) heart(ctx, s * ex, ey + .01 * S, .11 * S * (1 + Math.sin(t * 6) * .06));
        break;
      case 'star':
        ctx.fillStyle = '#ffd166';
        for (const s of [-1, 1]) star(ctx, s * ex, ey, .085 * S);
        break;
      case 'cyclops':
        white(0, ey, .13 * S, .14 * S); pupil(.015 * S, ey + .01 * S, .065 * S);
        break;
      case 'robot': {
        const g = ctx.createLinearGradient(0, ey - .07 * S, 0, ey + .07 * S);
        g.addColorStop(0, '#67e8f9'); g.addColorStop(1, '#0284c7');
        ctx.fillStyle = '#0b1220'; ctx.beginPath(); ctx.ellipse(0, ey, .27 * S, .085 * S, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, ey, .24 * S, .065 * S, 0, 0, TAU); ctx.fill();
        const sx = Math.sin(t * 2.4) * .14 * S;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, ey, .028 * S, 0, TAU); ctx.fill();
        break;
      }
      case 'dizzy':
        ctx.strokeStyle = dark; ctx.lineWidth = .02 * S;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          for (let i = 0; i <= 26; i++) { const a = i * .5 + t * 4 * s, r = i / 26 * .075 * S; ctx.lineTo(s * ex + Math.cos(a) * r, ey + Math.sin(a) * r); }
          ctx.stroke();
        }
        break;
      default:   // normal, angry
        for (const s of [-1, 1]) { white(s * ex, ey, .08 * S, .1 * S); pupil(s * ex + .016 * S, ey + .012 * S, .043 * S); }
        if (kind === 'angry') {
          ctx.strokeStyle = dark; ctx.lineWidth = .03 * S;
          for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * (ex + .08 * S), ey - .14 * S); ctx.lineTo(s * (ex - .06 * S), ey - .085 * S); ctx.stroke(); }
        }
    }
  }

  function drawMouth(ctx, kind, S){
    const my = -.43 * S, dark = '#1b1626';
    ctx.strokeStyle = dark; ctx.fillStyle = dark; ctx.lineWidth = .028 * S; ctx.lineCap = 'round';
    switch (kind) {
      case 'cat':
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * .035 * S, my - .01 * S, .035 * S, .1 * Math.PI, .9 * Math.PI); ctx.stroke(); }
        break;
      case 'grin':
        ctx.beginPath(); ctx.moveTo(-.1 * S, my - .03 * S); ctx.quadraticCurveTo(0, my + .13 * S, .1 * S, my - .03 * S); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(-.07 * S, my - .028 * S, .14 * S, .025 * S);
        ctx.fillStyle = '#ff6b8a'; ctx.beginPath(); ctx.ellipse(0, my + .045 * S, .04 * S, .02 * S, 0, 0, TAU); ctx.fill();
        break;
      case 'o':
        ctx.beginPath(); ctx.ellipse(0, my + .01 * S, .034 * S, .045 * S, 0, 0, TAU); ctx.fill();
        break;
      case 'tongue':
        ctx.beginPath(); ctx.arc(0, my - .03 * S, .075 * S, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#ff6b8a'; ctx.beginPath(); ctx.ellipse(.025 * S, my + .05 * S, .035 * S, .045 * S, 0, 0, TAU); ctx.fill();
        break;
      case 'fangs':
        ctx.beginPath(); ctx.arc(0, my - .04 * S, .085 * S, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * .045 * S, my + .028 * S); ctx.lineTo(s * .02 * S, my + .03 * S); ctx.lineTo(s * .035 * S, my + .075 * S); ctx.closePath(); ctx.fill(); }
        break;
      case 'mustache':
        ctx.beginPath(); ctx.arc(0, my + .005 * S, .04 * S, .2 * Math.PI, .8 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#3b2412';
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(0, my - .035 * S);
          ctx.quadraticCurveTo(s * .07 * S, my - .075 * S, s * .13 * S, my - .025 * S);
          ctx.quadraticCurveTo(s * .07 * S, my - .03 * S, 0, my - .01 * S); ctx.fill();
        }
        break;
      default:   // smile
        ctx.beginPath(); ctx.arc(0, my - .03 * S, .07 * S, .18 * Math.PI, .82 * Math.PI); ctx.stroke();
    }
  }

  function drawHat(ctx, h, S, t, col){
    const top = -.89 * S;
    switch (h.id) {
      case 'none': return;
      case 'party': {
        ctx.save(); ctx.translate(.06 * S, top + .02 * S); ctx.rotate(.18);
        ctx.fillStyle = '#ff4fa3'; ctx.beginPath(); ctx.moveTo(-.13 * S, 0); ctx.lineTo(.13 * S, 0); ctx.lineTo(0, -.32 * S); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = .03 * S;
        for (const y of [-.08, -.17]) { ctx.beginPath(); ctx.moveTo(-.13 * S * (1 + y * 3.1), y * S); ctx.lineTo(.13 * S * (1 + y * 3.1), y * S); ctx.stroke(); }
        ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(0, -.33 * S, .045 * S, 0, TAU); ctx.fill();
        ctx.restore();
        return;
      }
      case 'ears':
        for (const s of [-1, 1]) {
          ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(s * .3 * S, top + .17 * S); ctx.lineTo(s * .27 * S, top - .1 * S); ctx.lineTo(s * .08 * S, top + .06 * S); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ff9ec7'; ctx.beginPath(); ctx.moveTo(s * .25 * S, top + .1 * S); ctx.lineTo(s * .245 * S, top - .03 * S); ctx.lineTo(s * .14 * S, top + .06 * S); ctx.closePath(); ctx.fill();
        }
        return;
      case 'horns':
        ctx.fillStyle = '#e11d48';
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * .1 * S, top + .1 * S); ctx.quadraticCurveTo(s * .3 * S, top - .02 * S, s * .26 * S, top - .17 * S); ctx.quadraticCurveTo(s * .22 * S, top + .02 * S, s * .2 * S, top + .14 * S); ctx.closePath(); ctx.fill(); }
        return;
      case 'halo':
        ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = .04 * S; ctx.shadowColor = '#ffd34d'; ctx.shadowBlur = .08 * S;
        ctx.beginPath(); ctx.ellipse(0, top - .1 * S + Math.sin(t * 3) * .015 * S, .19 * S, .055 * S, 0, 0, TAU); ctx.stroke();
        ctx.shadowBlur = 0;
        return;
      case 'propeller': {
        ctx.fillStyle = '#ffcc33'; ctx.beginPath(); ctx.ellipse(0, top + .09 * S, .25 * S, .13 * S, 0, Math.PI, TAU); ctx.fill();
        ctx.fillStyle = '#4f8df7'; ctx.beginPath(); ctx.ellipse(0, top + .09 * S, .25 * S, .13 * S, 0, Math.PI, Math.PI * 1.5); ctx.lineTo(0, top + .09 * S); ctx.fill();
        ctx.strokeStyle = '#555'; ctx.lineWidth = .025 * S; ctx.beginPath(); ctx.moveTo(0, top - .04 * S); ctx.lineTo(0, top - .13 * S); ctx.stroke();
        const a = Math.cos(t * 14);
        ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.ellipse(0, top - .14 * S, .24 * S * Math.abs(a) + .015 * S, .04 * S, 0, 0, TAU); ctx.fill();
        return;
      }
      case 'headphones':
        ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = .055 * S;
        ctx.beginPath(); ctx.arc(0, -.6 * S, .35 * S, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        for (const s of [-1, 1]) {
          ctx.fillStyle = '#ff2d55'; ctx.beginPath(); ctx.ellipse(s * .345 * S, -.6 * S, .07 * S, .11 * S, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#2b2b33'; ctx.beginPath(); ctx.ellipse(s * .345 * S, -.6 * S, .035 * S, .07 * S, 0, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = .025 * S;
        ctx.beginPath(); ctx.moveTo(-.34 * S, -.52 * S); ctx.quadraticCurveTo(-.3 * S, -.38 * S, -.12 * S, -.4 * S); ctx.stroke();
        ctx.fillStyle = '#2b2b33'; ctx.beginPath(); ctx.arc(-.11 * S, -.4 * S, .03 * S, 0, TAU); ctx.fill();
        return;
      default: {   // шапка-эмодзи: [размер, x, y, наклон] в долях роста
        const pos = { bow: [.4, .17, -.83, .3], cap: [.64, 0, -.86, 0], grad: [.66, 0, -.9, 0], helmet: [.62, 0, -.86, 0], army: [.66, 0, -.85, 0], top: [.62, 0, -.97, 0], crown: [.54, 0, -.93, 0] }[h.id] || [.6, 0, -.88, 0];
        emoji(ctx, h.v, pos[1] * S, pos[2] * S, pos[0] * S, pos[3]);
      }
    }
  }

  // look, S — рост; o: { t — время (анимации), dir — 1 / −1 (смотрит влево), item — эмодзи в руке вместо своего,
  //   noPet, squash (−0,1…0,1 — сплющить при ходьбе) }
  function draw(ctx, look, x, y, S, o = {}){
    const L = norm(look), t = o.t || 0, dir = o.dir < 0 ? -1 : 1;
    const col = part('color', L.color);
    ctx.save();
    ctx.translate(x, y);
    if (!o.noPet && L.pet !== 'none') emoji(ctx, part('pet', L.pet).v, -dir * .6 * S, -.2 * S + Math.sin(t * 5) * .035 * S, .32 * S, 0);
    ctx.scale(dir, 1);
    if (o.squash) ctx.scale(1 + o.squash, 1 - o.squash);
    // ножки и тень
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, -.01 * S, .3 * S, .05 * S, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = col.id === 'galaxy' ? '#1e1b4b' : shade(col.v === '' ? '#888888' : col.v, -.45);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * .15 * S, -.06 * S, .11 * S, .065 * S, 0, 0, TAU); ctx.fill(); }
    // тело
    ctx.fillStyle = bodyFill(ctx, col, S, t);
    ctx.strokeStyle = 'rgba(15,10,25,.55)'; ctx.lineWidth = .032 * S;
    ctx.beginPath(); ctx.ellipse(0, -.47 * S, .36 * S, .42 * S, 0, 0, TAU); ctx.fill(); ctx.stroke();
    if (col.id === 'galaxy') {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 11; i++) { const a = i * 2.39996, r = (.08 + (i * 37 % 23) / 23 * .27) * S; ctx.globalAlpha = .45 + (i % 3) * .2; ctx.beginPath(); ctx.arc(Math.cos(a) * r * .9, -.47 * S + Math.sin(a) * r, (.008 + (i % 3) * .005) * S, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // блик и пузико
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.ellipse(-.15 * S, -.69 * S, .07 * S, .11 * S, -.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(.02 * S, -.27 * S, .2 * S, .14 * S, 0, 0, TAU); ctx.fill();
    if (col.id === 'gold') { ctx.fillStyle = 'rgba(255,255,255,.5)'; star(ctx, .2 * S, -.72 * S, .04 * S * (1 + Math.sin(t * 4) * .3)); }
    drawEyes(ctx, L.eyes, S, t);
    drawMouth(ctx, L.mouth, S);
    drawHat(ctx, part('hat', L.hat), S, t, col.v || '#888888');
    // предмет в руке
    const it = o.item !== undefined ? o.item : L.item !== 'none' ? part('item', L.item).v : '';
    if (it) {
      ctx.fillStyle = col.id === 'galaxy' ? '#3b2a8f' : shade(col.v, -.15);
      ctx.beginPath(); ctx.arc(.34 * S, -.34 * S, .065 * S, 0, TAU); ctx.fill();
      emoji(ctx, it, .43 * S, -.42 * S, .34 * S, -.3);
    }
    ctx.restore();
  }

  // ── Готовые картинки для игр (кэш) ──
  // Анимированные части (радуга, пропеллер, глаза-визор) — 8 кадров по времени
  const cache = new Map();
  function animated(L){ return L.color === 'rainbow' || L.hat === 'propeller' || L.hat === 'halo' || ['robot', 'dizzy', 'heart'].includes(L.eyes) || L.color === 'gold'; }
  // → { c: canvas, ax, ay } — точка (ax, ay) в пикселях canvas: ноги персонажа
  function sprite(look, px, o = {}){
    const L = norm(look);
    const frame = animated(L) ? Math.floor((o.t || 0) * 8) % 16 : 0;
    const key = JSON.stringify(L) + '|' + Math.round(px) + '|' + (o.dir < 0 ? -1 : 1) + '|' + (o.item ?? '') + '|' + (o.noPet ? 1 : 0) + '|' + frame;
    let s = cache.get(key);
    if (s) return s;
    if (cache.size > 160) cache.clear();
    const S = Math.max(8, Math.round(px)), c = document.createElement('canvas');
    c.width = Math.ceil(S * 1.5); c.height = Math.ceil(S * 1.32);
    const ax = Math.round(c.width / 2), ay = Math.round(S * 1.24);
    draw(c.getContext('2d'), L, ax, ay, S, { t: frame / 8, dir: o.dir, item: o.item, noPet: o.noPet });
    s = { c, ax, ay };
    cache.set(key, s);
    return s;
  }
  // Картинка для <img>
  function img(look, px){ try { return sprite(look, px, { noPet: false }).c.toDataURL('image/png'); } catch (e) { return ''; } }

  // Эмодзи следа (частицы за персонажем при беге) или '' — радуга рисуется полосой ('rainbow')
  function trail(look){ const L = norm(look); return L.trail === 'none' ? '' : L.trail === 'rainbow' ? 'rainbow' : part('trail', L.trail).v; }
  function petEmoji(look){ const L = norm(look); return L.pet === 'none' ? '' : part('pet', L.pet).v; }

  // Чужие персонажи (рекорды, профиль, кооп) — из базы, с кэшем на визит
  const others = new Map();
  async function looksOf(ids){
    const need = [...new Set(ids)].filter(id => id && !others.has(id)).slice(0, 100);
    if (need.length && typeof sbClient !== 'undefined' && sbClient) {
      try {
        const { data, error } = await sbClient.rpc('char_looks', { p_ids: need });
        if (!error) { need.forEach(id => others.set(id, null)); (data || []).forEach(r => others.set(r.user_id, norm(r.look))); }
      } catch (e) {}
    }
    const out = {};
    ids.forEach(id => { if (others.get(id)) out[id] = others.get(id); });
    return out;
  }

  window.D37Char = {
    PARTS, SLOTS, DEFAULT, part, price, norm, owns, wearable,
    look: () => wearable(current()), set, fromServer,
    draw, sprite, img, trail, petEmoji, looksOf,
    on(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
