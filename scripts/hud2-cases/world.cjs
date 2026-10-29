// HUD 2.0 (T-123): «Мир Денчика» для scripts/hud2-e2e.cjs — лобби (в покое), большой город, боевая зона (после плашки зоны)
const W = 'GAME_IMPL.world._test.state()';
const clean = `document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast,.wld-panel').forEach(e => e.remove())`;
module.exports = {
  url: '/#/games/world',
  ready: `window.GAME_IMPL?.world?._test?.state()?.zones?.wmv`,
  root: '.wld-wrap', extra: '.wld-top, .wld-top *', skip: '.wld-pop,.wld-panel,.mp',
  caps: { P: 8, L: 6, PC: 4 },   // §9.2: цели «Мира» (меньше общего предела)
  sceneCaps: { 'idle-war': { P: 12, L: 10, PC: 4 }, 'pose-hint': { P: 12, L: 10, PC: 8 } },   // §9.2 «War zone»; подсказка — +4 п. п. (§2.2)
  ls: { d37_mir_pos: '' },
  ctrlScenes: ['idle-hub', 'city', 'idle-war'],   // §2.1: ≤ 5 кнопок (💵 в городе — по обстановке, ⏱ в бою на телефоне — плашка, счёт — ☰)
  async prep(T){
    await T.ev(`(() => { localStorage.removeItem('d37_mir_pos'); const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; } ${W}.fixedTime = 13; return 1; })()`);
  },
  scenes: {
    async 'idle-hub'(T){ await T.ev(`(async () => { ${clean}; await new Promise(r => setTimeout(r, 8000)); return 1; })()`, 30000); },
    // 📱 поверх мира (T-123 fix 5, §9.2): голова персонажа не под телефоном (стоя — лист снизу ≤ 60 % и картинка вверх, лёжа — сбоку);
    // закрыл — сдвиг картинки снят. Голова — верхние 22 % рамки персонажа на экране (проекция камеры со сдвигом)
    async phone(T){
      const r = await T.ev(`(async () => {
        const S = ${W}, cam = S.R.camera, cv = S.wrap.querySelector('canvas'), cr = cv.getBoundingClientRect(), c = S.P.ch, hw = .35, h = c.top || 1.8;
        const box = () => { const xs = [], ys = []; for (const dy of [0, h]) for (const dx of [-hw, hw]) for (const dz of [-hw, hw]) { const v = new THREE.Vector3(c.x + dx, c.y + dy, c.z + dz).project(cam); xs.push(cr.left + (v.x + 1) / 2 * cr.width); ys.push(cr.top + (1 - v.y) / 2 * cr.height); } const t = Math.min(...ys), b = Math.max(...ys); return { l: Math.min(...xs), r: Math.max(...xs), t, b, hb: t + (b - t) * .22 }; };
        document.querySelector('.mir-phone')?.click(); await new Promise(r => setTimeout(r, 2000));
        const p = document.getElementById('d37Phone'); if (!p || p.hidden) return { err: 'телефон не открылся' };
        const q = p.getBoundingClientRect(), k = box();
        const ix = Math.max(0, Math.min(k.r, q.right) - Math.max(k.l, q.left)), iy = Math.max(0, Math.min(k.hb, q.bottom) - Math.max(k.t, q.top));
        const head = Math.round(ix * iy / Math.max(1, (k.r - k.l) * (k.hb - k.t)) * 1000) / 10, phone = Math.round(q.width * q.height / (innerWidth * innerHeight) * 1000) / 10;
        window.D37Phone.close(); await new Promise(r => setTimeout(r, 1500));
        return { head, phone, sheet: p.classList.contains('ph-gsheet'), rect: [q.left, q.top, q.width, q.height].map(Math.round), viewAfterClose: !!(cam.view && cam.view.enabled && (cam.view.offsetX || cam.view.offsetY)) };
      })()`, 30000);
      console.log('  📱:', JSON.stringify(r));
      if (r.err) throw new Error('«Мир», 📱: ' + r.err);
      if (r.head > 0) throw new Error(`«Мир», 📱 закрывает голову персонажа на ${r.head} %`);
      if (r.viewAfterClose) throw new Error('«Мир», 📱 закрыт, а сдвиг картинки остался');
      if (T.P.mobile && T.P.h > T.P.w && r.phone > 61) throw new Error(`«Мир», 📱 стоя занимает ${r.phone} % экрана (лист ≤ 60 %)`);
    },
    // подсказка позы (T-123 fix 8): в покое её нет (не таймер поверх игры — idle-hub меряет покой без неё); игрок походил и
    // остановился — показана один раз
    async 'pose-hint'(T){
      if (!T.P.mobile) return;
      const r = await T.ev(`(async () => { const S = ${W}, q = () => [...document.querySelectorAll('.wld-wrap .e2-hint.on')].map(e => e.textContent);
        const idle = q(), ph = S.poseHint; if (!ph) return { err: 'нет S.poseHint (телефон)' };
        ph.moved = true; ph.at = 0; await new Promise(r => setTimeout(r, 700));
        return { idle, after: q(), done: !S.poseHint }; })()`, 20000);
      console.log('  подсказка позы:', JSON.stringify(r));
      if (r.err) throw new Error('«Мир», подсказка позы: ' + r.err);
      if (r.idle.length) throw new Error('«Мир»: в покое (игрок не ходил) уже висит подсказка: ' + JSON.stringify(r.idle));
      if (!r.done || !r.after.some(t => /Удержи/.test(t))) throw new Error('«Мир»: походил и встал — подсказки позы нет: ' + JSON.stringify(r));
    },
    async city(T){ await T.ev(`(async () => { const z = ${W}.zones, zs = z.zoneState('metro'); if (zs && !zs.ready) await z.buildNow(zs); z.padGo('metro'); await new Promise(r => setTimeout(r, 7000)); ${clean}; return 1; })()`, 120000); },
    async 'idle-war'(T){
      await T.ev(`(async () => { const S = ${W}, z = S.zones, C = MirWar.CENTER, zs = z.zoneState('war'); if (!zs.ready) await z.buildNow(zs);
        S.P.place((C.x0 + C.x1) / 2, MirZones.terrain((C.x0 + C.x1) / 2, C.z0 + 4) + .4, C.z0 + 4, 0);
        for (let i = 0; i < 60 && !(document.querySelector('.mz-war') && !document.querySelector('.mz-war').hidden); i++) await new Promise(r => setTimeout(r, 150));
        await new Promise(r => setTimeout(r, 5000)); ${clean}; return 1; })()`, 120000);
    },
  },
};
