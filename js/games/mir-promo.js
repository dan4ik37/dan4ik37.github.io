// ═══════════════════════════════════════
//  ЩИТЫ «МИРА ДЕНЧИКА» — свои промо и спонсор (грузит ad-places.js → worldPromo, когда открыт 3D-мир)
// ═══════════════════════════════════════
// Это НЕ реклама сетей: баннеры РСЯ/AdSense нельзя рисовать в 3D (их код — только настоящим окошком страницы, менять
// и перерисовывать нельзя). На щитах — разделы сайта (эфир, слово и судоку дня, видео, гардероб, VIP, игры) и спонсор,
// которого админ задаёт в «⚙️ Настройки сайта» (site_config 'ad_sponsor': прямая договорённость, по закону — пометка
// «Реклама», рекламодатель и erid). Спонсор занимает щит у площади, остальные щиты меняют промо раз в 20 с.
// Дёшево: одна текстура на щит, перерисовка только при смене промо, за кадр — ничего. Нажал на щит или [E] рядом —
// окошко мира с описанием и кнопкой (сразу никуда не уводим — чтобы не уйти из мира случайно). VIP — без спонсора.
// Прямая реклама (кабинет рекламодателя #/adv, js/core/ad-direct.js): одобренная кампания «щит» занимает место спонсора
// (картинка рекламодателя в ту же текстуру + наша строка «Реклама · кто · erid»), показ засчитывается, когда щит в кадре
// секунду, переход — /go/<id>. Нет такой кампании — спонсор из site_config, как раньше.
(() => {
  const PI = Math.PI, ROTATE = 20000;
  // Где стоят (единицы мира): на краю площади — видно с точки появления; запад площади; улица с домиками.
  // yaw — куда смотрит лицо щита (без yaw — на середину площади)
  const SPOTS = [
    { x: 14.5, z: -14.5, w: 5.2, h: 2.6 },
    { x: -18.9, z: 8, w: 5.2, h: 2.6 },
    { x: 7.9, z: 41, w: 4.6, h: 2.3, yaw: -PI / 2 },
  ];
  const LIFT = 1.5;   // низ щита над землёй
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gambling = t => !!window.D37AdPlaces?.gambling?.([t]);

  // Свежий ролик для щита: видео дня или последнее из кэша главной (про кейсы/депозиты — никогда)
  function lastVideo(){
    let list = [];
    try { list = JSON.parse(localStorage.getItem('dan4ik37_cache_v2') || 'null')?.d?.vids || []; } catch (e) {}
    return [window.__d37Daily, ...list].find(v => v && v.id && v.title && !gambling(v.title)) || null;
  }
  // Что показать (порядок = очередь на щитах)
  function promos(S, sp){
    const out = [], vip = !!window.D37AdPlaces?.noAdsPerk?.();
    if (S.live) out.push({ id: 'live', ic: '🔴', t: 'Денчик в эфире!', d: 'Прямо сейчас стрим — подойди к сцене на западе площади', act: 'stage', c: ['#7f1d1d', '#dc2626'] });
    if (typeof wordsDayNo === 'function') {
      let w = null; try { w = typeof wordsToday === 'function' ? wordsToday() : null; } catch (e) {}
      out.push({ id: 'words', ic: '🔤', t: `Слово дня #${wordsDayNo()}`, d: w?.done ? 'Сегодня уже угадано — завтра новое слово' : 'Угадай слово из 5 букв — одно на всех', go: '#/games/words', c: ['#14532d', '#16a34a'] });
    }
    if (typeof sudokuDayNo === 'function') out.push({ id: 'sudoku', ic: '🔢', t: `Судоку дня #${sudokuDayNo()}`, d: 'Одно на всех — кто решит быстрее?', go: '#/games/sudoku', c: ['#1e3a8a', '#3b82f6'] });
    const v = lastVideo();
    out.push(v ? { id: 'video', ic: '🎬', t: 'Видео Денчика', d: v.title, href: '/v/' + encodeURIComponent(v.id), c: ['#450a0a', '#b91c1c'] }
      : { id: 'videos', ic: '🎬', t: 'Почти 6000 роликов', d: 'Смотри видео Денчика прямо на сайте', href: '/videos', c: ['#450a0a', '#b91c1c'] });
    out.push({ id: 'look', ic: '🎭', t: 'Свой персонаж', d: 'Одежда, причёски и любые цвета — в гардеробе', act: 'look', c: ['#831843', '#db2777'] });
    if (!vip) out.push({ id: 'vip', ic: '✨', t: 'VIP на сайте', d: 'Цветной ник, стикеры и сайт без рекламы', href: '/vip', c: ['#713f12', '#ca8a04'] });
    out.push({ id: 'horde', ic: '🧟', t: 'Орда', d: 'Выживи 10 минут против орды монстров', go: '#/games/horde', c: ['#3b0764', '#7c3aed'] });
    out.push({ id: 'studio', ic: '🧱', t: 'Студия 3D', d: 'Построй свой мир со скриптами — как в Roblox', go: '#/games/studio3d', c: ['#78350f', '#f59e0b'] });
    const ad = sp && !vip ? { id: sp.direct ? 'direct:' + sp.direct.t : 'sponsor', sponsor: sp, ic: '', t: sp.title, d: sp.text, href: sp.url, c: [sp.bg, sp.bg], fg: sp.fg, img: sp.img || null } : null;
    return { ad, list: out };
  }
  const markText = sp => ['Реклама', sp.advertiser, sp.erid ? 'erid: ' + sp.erid : ''].filter(Boolean).join(' · ');

  // ── Рисование щита (canvas → текстура) ──
  function fitFont(g, text, weight, size, maxW, min = 18){
    let s = size;
    g.font = `${weight} ${s}px Montserrat, Arial, sans-serif`;
    while (g.measureText(text).width > maxW && s > min) { s -= 2; g.font = `${weight} ${s}px Montserrat, Arial, sans-serif`; }
    return s;
  }
  function wrap(g, text, x, y, maxW, lh, lines){
    const words = String(text || '').split(/\s+/);
    let line = '', n = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > maxW && line) {
        if (n === lines - 1) { while (line && g.measureText(line + '…').width > maxW) line = line.slice(0, -1); g.fillText(line + '…', x, y + n * lh); return; }
        g.fillText(line, x, y + n * lh); n++; line = words[i];
      } else line = test;
    }
    if (line) g.fillText(line, x, y + n * lh);
  }
  function draw(b){
    const p = b.cur, g = b.ctx, W = b.cv.width, H = b.cv.height, k = W / 1024;
    if (!p || !g) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    // Прямая реклама (кабинет рекламодателя): картинка рекламодателя на весь щит + наша пометка «Реклама · кто · erid» снизу
    if (p.img) {
      g.drawImage(p.img, 0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(0, H - 50 * k, W, 50 * k);
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
      fitFont(g, markText(p.sponsor), 700, 26 * k, W - 60 * k, 14 * k);
      g.fillText(markText(p.sponsor), 30 * k, H - 25 * k);
      g.font = `800 ${24 * k}px Montserrat, Arial, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(W - 190 * k, 18 * k, 172 * k, 40 * k);
      g.fillStyle = '#fff'; g.fillText('РЕКЛАМА', W - 32 * k, 47 * k);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 8 * k; g.strokeRect(4 * k, 4 * k, W - 8 * k, H - 8 * k);
      if (b.tex) b.tex.needsUpdate = true;
      return;
    }
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, p.c[0]); gr.addColorStop(1, p.c[1]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalAlpha = .1; g.fillStyle = '#fff'; g.beginPath(); g.arc(W * .88, H * .05, H * .6, 0, 7); g.fill(); g.globalAlpha = 1;
    const fg = p.fg || '#ffffff';
    let x0 = 52 * k;
    if (p.ic) { g.font = `${190 * k}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.ic, 160 * k, H * .47); x0 = 300 * k; }
    const maxW = W - x0 - 46 * k;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = fg;
    fitFont(g, p.t, 900, 84 * k, maxW, 40 * k);
    g.fillText(p.t, x0, H * .38);
    g.font = `600 ${42 * k}px Montserrat, Arial, sans-serif`; g.globalAlpha = .92;
    wrap(g, p.d, x0, H * .56, maxW, 50 * k, 2);
    g.globalAlpha = .75; g.font = `700 ${26 * k}px Montserrat, Arial, sans-serif`;
    g.fillText(p.sponsor ? markText(p.sponsor) : 'Нажми на щит — подробнее', x0, H * .9);
    g.globalAlpha = 1;
    if (p.sponsor) {   // пометка «Реклама» и в углу — видно издалека
      g.font = `800 ${24 * k}px Montserrat, Arial, sans-serif`; g.textAlign = 'right';
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(W - 190 * k, 18 * k, 172 * k, 40 * k);
      g.fillStyle = '#fff'; g.fillText('РЕКЛАМА', W - 32 * k, 47 * k);
    }
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 8 * k; g.strokeRect(4 * k, 4 * k, W - 8 * k, H - 8 * k);
    if (b.tex) b.tex.needsUpdate = true;
  }

  function start(S, ctx = {}){
    const R = S.R, T = R?.T, X = S.X, ph = S.ph;
    if (!R || !T || !R.scene) return null;
    const low = R.q === 'low', st = { S, boards: [], items: [], tick: 0, sponsor: null, dead: false, timer: 0 };
    const frameM = new T.MeshStandardMaterial({ color: '#1f2937', roughness: .55, metalness: .2 });
    const postG = new T.BoxGeometry(.16, 1, .16), frameG = new T.BoxGeometry(1, 1, .16);
    st.shared = [frameM, postG, frameG];
    for (const sp of SPOTS) {
      const yaw = sp.yaw ?? Math.atan2(-sp.x, -sp.z), fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const g = new T.Group(); g.position.set(sp.x, 0, sp.z); g.rotation.y = yaw; g.userData.dyn = true;
      const ph2 = sp.h + LIFT;
      for (const s of [-1, 1]) {
        const post = new T.Mesh(postG, frameM); post.scale.y = ph2; post.position.set(s * (sp.w / 2 - .35), ph2 / 2, -.02); g.add(post);
        ph?.addBox?.({ x: sp.x + rx * s * (sp.w / 2 - .35), z: sp.z + rz * s * (sp.w / 2 - .35), y: ph2 / 2, hx: .1, hy: ph2 / 2, hz: .1, tag: 'world', data: {} });
      }
      const frame = new T.Mesh(frameG, frameM); frame.scale.set(sp.w + .3, sp.h + .3, 1); frame.position.set(0, LIFT + sp.h / 2, -.02); g.add(frame);
      const cv = document.createElement('canvas'); cv.width = low ? 512 : 1024; cv.height = low ? 256 : 512;
      const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
      const faceM = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
      const face = new T.Mesh(new T.PlaneGeometry(sp.w, sp.h), faceM); face.position.set(0, LIFT + sp.h / 2, .07); g.add(face);
      R.scene.add(g);
      try { R.shadowsOn?.(g); } catch (e) {}
      const b = { sp, g, face, cv, ctx: cv.getContext('2d'), tex, faceM, cur: null };
      b.item = X?.add?.({ x: sp.x + fx * 1.4, y: 1.2, z: sp.z + fz * 1.4, r: 1.8, prompt: () => b.cur ? '📣 ' + b.cur.t : null, act: () => open(b) });
      st.boards.push(b);
    }
    try { R.shadowDirty?.(); } catch (e) {}
    // Очередь промо: спонсор — на первом щите постоянно, остальное по кругу (на трёх щитах — разное)
    function fill(){
      if (st.dead) return;
      const { ad, list } = promos(S, st.sponsor);
      st.ad = ad;
      st.boards.forEach((b, i) => {
        const p = ad && i === 0 ? ad : list.length ? list[(i - (ad ? 1 : 0) + st.tick + list.length * 4) % list.length] : null;
        if (p && (b.cur?.id !== p.id || p.id === 'words' || p.id === 'live')) { b.cur = p; draw(b); }
      });
    }
    fill();
    st.timer = setInterval(() => { st.tick++; fill(); }, ROTATE);
    // Спонсор первого щита: одобренная кампания «щит» из кабинета рекламодателя (js/core/ad-direct.js; новая выдача раз
    // в 10 минут), нет её — спонсор из site_config (кэш 10 мин в ad-places.js). Текстура — та же одна на щит
    function sponsorPick(){
      if (st.dead) return;
      Promise.resolve(window.D37AdDirect?.billboard?.()).catch(() => null).then(dp => {
        if (st.dead) return;
        if (dp) { st.sponsor = dp; st.visT = 0; fill(); return; }
        if (st.sponsor?.direct) { st.sponsor = null; fill(); }
        window.D37AdPlaces?.sponsor?.().then(sp => {
          if (st.dead || !sp || st.sponsor?.direct) return;
          const was = st.sponsor; st.sponsor = sp; fill();
          if (!was) try { window.va?.('event', { name: 'sponsor_view', data: { t: sp.title } }); } catch (e) {}
        });
      });
    }
    sponsorPick();
    st.spTimer = setInterval(sponsorPick, 10 * 60e3);
    // Показ прямой рекламы на щите засчитывается, когда щит в кадре лицом к камере, ближе 40 ед. — не меньше секунды
    // (как «видно ≥ 50 % секунду» у баннеров); поверх мира открыта партия / редактор — не считается
    const vC = new T.Vector3(), vP = new T.Vector3();
    st.visT = 0;
    st.visTimer = setInterval(() => {
      const sp = st.sponsor, b = st.boards[0], cam = R.camera;
      if (st.dead || !sp?.direct || !b || b.cur?.sponsor !== sp || st.seenTok === sp.direct.t || !cam) { st.visT = 0; return; }
      vC.set(b.sp.x, LIFT + b.sp.h / 2, b.sp.z);
      const dx = cam.position.x - vC.x, dz = cam.position.z - vC.z, dist = Math.hypot(dx, cam.position.y - vC.y, dz);
      const facing = Math.sin(b.g.rotation.y) * dx + Math.cos(b.g.rotation.y) * dz > 0;
      vP.copy(vC).project(cam);
      const inView = vP.z < 1 && Math.abs(vP.x) < 0.9 && Math.abs(vP.y) < 0.9;
      const busy = S.stopped || S.editing || window.MirPlay?.isOpen?.() || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
      if (facing && inView && dist < 40 && !busy) {
        st.visT += 300;
        if (st.visT >= 1000) { st.seenTok = sp.direct.t; window.D37AdDirect?.seen?.(sp.direct); }
      } else st.visT = 0;
    }, 300);
    // нажатие по щиту (короткий тап/клик по миру — mir.js)
    const ray = new T.Raycaster(), v2 = new T.Vector2();
    function tap(cx, cy){
      if (st.dead) return false;
      const c = R.r?.domElement?.getBoundingClientRect?.();
      if (!c || !c.width) return false;
      v2.set((cx - c.left) / c.width * 2 - 1, -((cy - c.top) / c.height) * 2 + 1);
      ray.setFromCamera(v2, R.camera); ray.far = 45;
      const hit = ray.intersectObjects(st.boards.map(b => b.face), false)[0];
      if (!hit) return false;
      open(st.boards.find(b => b.face === hit.object));
      return true;
    }
    function open(b){
      const p = b?.cur;
      if (!p || st.dead) return;
      if (p.act === 'stage') { S.openStage?.(); return; }
      if (p.act === 'look') { S.openEditor?.(); return; }
      const ext = p.sponsor && (/^https:/.test(p.href) || !!p.sponsor.direct);   // прямая реклама — переход /go/<id> (считает клик)
      const btn = p.go ? `<button type="button" class="ct-start" data-act="go:${esc(p.go)}">▶ Открыть</button>`
        : `<a class="ct-start" href="${esc(p.href)}"${ext ? ' target="_blank" rel="sponsored noopener"' : ''}>${ext ? 'Перейти на сайт ↗' : 'Открыть →'}</a>`;
      const dir = p.sponsor?.direct;
      const body = `<p>${esc(p.d || '')}</p>${p.sponsor ? `<p class="wld-ad-mark">${esc(markText(p.sponsor))}${dir && p.sponsor.inn ? ` · ИНН/БИН ${esc(p.sponsor.inn)}` : ''}</p>` : ''}` +
        `<div class="wld-acts">${btn}${dir ? '<button type="button" class="wld-ad-about">ⓘ О рекламе</button>' : ''}</div>`;
      if (typeof ctx.panel === 'function') ctx.panel(`<span class="wld-pe">${p.ic || '📣'}</span><b>${esc(p.t)}</b>`, body);
      else if (p.go) location.hash = p.go;
      if (dir) document.querySelector('.wld-panel .wld-ad-about')?.addEventListener('click', e => { e.preventDefault(); window.D37AdDirect?.about?.(dir, null); });
      if (p.sponsor) try { window.va?.('event', { name: 'sponsor_open', data: { t: p.t } }); } catch (e) {}
    }
    function dispose(){
      if (st.dead) return;
      st.dead = true; clearInterval(st.timer); clearInterval(st.spTimer); clearInterval(st.visTimer);
      for (const b of st.boards) {
        try { X?.remove?.(b.item); } catch (e) {}
        b.g.parent?.remove(b.g);
        b.face.geometry.dispose(); b.faceM.dispose(); b.tex.dispose();
      }
      st.shared.forEach(x => { try { x.dispose(); } catch (e) {} });
      st.boards.length = 0;
    }
    return { tap, dispose, open, _st: st };
  }

  window.MirPromo = { start, SPOTS, _test: { promos, draw, markText, lastVideo } };
})();
