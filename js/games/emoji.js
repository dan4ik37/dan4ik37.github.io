// ═══════════════════════════════════════
//  ИГРА «УГАДАЙ ИГРУ ПО ЭМОДЗИ» — 10 раундов, 4 варианта, 10 секунд на ответ. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Очки: верно — 100 + до 50 за скорость (5 очков за каждую секунду, оставшуюся из 10) + 10 за каждый верный подряд после первого.
// Случайность (загадки, варианты, порядок) — только через rand: в соревновании у обоих одинаковый seed и одни и те же раунды.
// Победа (для XP) — от 7 верных. Ключи сервера: emoji / emoji_duel (games-emoji.sql).
(() => {
  const ROUNDS = 10, SEC = 10;
  // [игра, эмодзи] — известные игры и игры с канала; подсказки — без названия игры
  const PUZZLES = [
    ['Minecraft', '⛏️🧱🧟🌙'], ['Roblox', '🟨🧱👥🎮'], ['Fortnite', '🪂🏗️🔫🚌'], ['Among Us', '🚀🔪🕵️🟥'],
    ['FNAF', '🐻🍕🔦🕛'], ['Counter-Strike 2', '💣🔫🛡️🔁'], ['GTA V', '🚗💰👮🌴'], ['Terraria', '⛏️🌳🌙👁️'],
    ['The Sims', '🏠👪💚🛋️'], ['Тетрис', '🧱⬇️📏🎵'], ['Pac-Man', '🟡👻🍒🌀'], ['Super Mario', '🍄👨‍🔧🐢🏰'],
    ['Angry Birds', '🐦😡🐷🏗️'], ['Plants vs Zombies', '🌻🧟🌱🏡'], ['Fall Guys', '🫘🏃👑🌈'], ['Subway Surfers', '🚇🏃🛹💰'],
    ['Clash Royale', '👑🏰🃏⚔️'], ['Brawl Stars', '⭐🤠💥🏆'], ['Pokémon', '⚡🐭🔴⚪'], ['Hollow Knight', '🗡️🪲🕯️🗺️'],
    ['Poppy Playtime', '🧸🏭🔵✋'], ['Geometry Dash', '🟧🔺🎵🔁'], ['Fruit Ninja', '🍉🔪🍍💥'], ['Dota 2', '🧙🗼🌳⚔️'],
    ['Apex Legends', '🪂🦾🔫👥'], ['PUBG', '🪂🍳🔫🚙'], ['Standoff 2', '🔫💣📱🎯'], ['Zelda', '🗡️🛡️🧝🔺'],
    ['Sonic', '🦔💨💍🔵'], ['Cyberpunk 2077', '🤖🌃🔫🦾'], ['Ведьмак', '🐺⚔️🧪🧙'], ['Rocket League', '🚗⚽🚀🥅'],
    ['FIFA', '⚽🏟️🥅🏆'], ['Stardew Valley', '🌾🐔🏡🎣'], ['Undertale', '💀❤️🐐🦴'], ['Portal', '🔵🟠🧪🍰'],
    ['Dead by Daylight', '🔪🏃‍♀️🪝🌫️'], ['Metro 2033', '🚇☢️😷🔦'], ['Tiny Bunny', '🐰❄️🌲👦'], ['Dead Rails', '🚂🤠🧟🏜️'],
    ['99 ночей в лесу', '🌲🔥🦌🌙'], ['Call of Duty', '🪖🔫💥🎖️'], ['Overwatch', '🦸🎯🛡️👥'], ['Hogwarts Legacy', '🧙🦉⚡🏰'],
    ['Assassin’s Creed', '🗡️🦅🏛️🥷'],
  ];
  let root, api, G = null, timer = 0, tick = 0, stopDuel = null;

  // Раунды игры: rand → [{ name, emoji, options: [4 названия] }]
  function makeRounds(rand){
    const pool = PUZZLES.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const names = [...new Set(PUZZLES.map(p => p[0]))];
    return pool.slice(0, ROUNDS).map(([name, emoji]) => {
      const others = names.filter(n => n !== name);
      const opts = [name];
      while (opts.length < 4) { const n = others[Math.floor(rand() * others.length)]; if (!opts.includes(n)) opts.push(n); }
      for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
      return { name, emoji, options: opts };
    });
  }

  // opt: { rand, duel, onScore(score), onEnd(score, right, marks) }
  function render(el, opt){
    clearTimeout(timer); clearInterval(tick);
    G = { el, opt, rounds: makeRounds(opt.rand), i: -1, score: 0, right: 0, streak: 0, marks: [], t0: 0, locked: false };
    el.innerHTML = `<div class="em">
        <div class="em-top"><span class="em-round">Раунд 1 из ${ROUNDS}</span><span class="em-score">0 очков</span></div>
        <div class="em-bar"><i></i></div>
        <div class="em-q" aria-live="polite">🤔</div>
        <div class="em-opts"></div>
        <div class="em-end" hidden></div>
        ${opt.duel ? '' : `<div class="ct-actions em-start"><button class="ct-start emGo">▶ Начать</button><button class="ct-duel-btn emDuel">⚔️ Соревноваться с другом</button></div>
        <div class="ct-stats">Лучший результат: <b>${api.local().best ? api.local().best + ' очков' : '—'}</b></div>`}
      </div>`;
    el.querySelector('.emGo')?.addEventListener('click', next);
    el.querySelector('.emDuel')?.addEventListener('click', () => { location.hash = '#/games/emoji/' + GameRoom.newCode(); });
    el.querySelector('.em-opts').addEventListener('click', e => { const b = e.target.closest('button[data-n]'); if (b) answer(b.dataset.n, b); });
    if (opt.duel) next();
  }

  function next(){
    if (!G) return;
    G.el.querySelector('.em-start')?.remove();
    G.i++;
    if (G.i >= ROUNDS) return finish();
    const r = G.rounds[G.i];
    G.locked = false; G.t0 = performance.now();
    G.el.querySelector('.em-round').textContent = `Раунд ${G.i + 1} из ${ROUNDS}`;
    G.el.querySelector('.em-q').textContent = r.emoji;
    G.el.querySelector('.em-opts').innerHTML = r.options.map(n => `<button type="button" data-n="${n.replace(/"/g, '&quot;')}">${n}</button>`).join('');
    const bar = G.el.querySelector('.em-bar i');
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    bar.style.transition = `width ${SEC}s linear`; bar.style.width = '0%';
    clearTimeout(timer);
    timer = setTimeout(() => answer(null, null), SEC * 1000);
  }

  function answer(name, btn){
    if (!G || G.locked || G.i < 0 || G.i >= ROUNDS) return;
    G.locked = true; clearTimeout(timer);
    const r = G.rounds[G.i], ok = name === r.name;
    const left = Math.max(0, SEC - (performance.now() - G.t0) / 1000);
    if (ok) { G.score += 100 + Math.round(left * 5) + (G.streak > 0 ? 10 * G.streak : 0); G.right++; G.streak++; }
    else G.streak = 0;
    G.marks.push(ok);
    api.sfx(ok ? 'ok' : 'bad');
    G.el.querySelectorAll('.em-opts button').forEach(b => { if (b.dataset.n === r.name) b.classList.add('ok'); else if (b === btn) b.classList.add('bad'); b.disabled = true; });
    G.el.querySelector('.em-score').textContent = `${G.score} очков`;
    G.opt.onScore?.(G.score);
    const bar = G.el.querySelector('.em-bar i'); bar.style.transition = 'none'; bar.style.width = getComputedStyle(bar).width;
    timer = setTimeout(next, ok ? 700 : 1300);
  }

  function finish(){
    const marks = G.marks.map(m => m ? '✅' : '❌').join('');
    const verdict = G.right >= 9 ? '🏆 Знаток игр!' : G.right >= 7 ? '🔥 Отлично!' : G.right >= 4 ? '🙂 Неплохо' : '🐣 Есть куда расти';
    const q = G.el.querySelector('.em-q'); q.textContent = verdict; q.classList.add('done');
    G.el.querySelector('.em-opts').innerHTML = '';
    const end = G.el.querySelector('.em-end');
    end.hidden = false;
    end.innerHTML = `<div class="em-res"><b>${G.score} очков</b><span>Угадано ${G.right} из ${ROUNDS}</span><div class="em-marks">${marks}</div></div>
      ${G.opt.duel ? '' : `<div class="ct-actions"><button class="ct-start emAgain">↻ Ещё раз</button><button class="emShare">📤 Поделиться</button><button class="ct-duel-btn emDuel2">⚔️ С другом</button></div>`}`;
    end.querySelector('.emAgain')?.addEventListener('click', () => render(G.el, { ...G.opt, rand: Math.random }));
    end.querySelector('.emDuel2')?.addEventListener('click', () => { location.hash = '#/games/emoji/' + GameRoom.newCode(); });
    end.querySelector('.emShare')?.addEventListener('click', async e => {
      const text = `Угадай игру по эмодзи: ${G.right}/${ROUNDS}, ${G.score} очков\n${marks}`, url = location.origin + '/games/emoji';
      if (navigator.share) { navigator.share({ text: text + '\n', url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text + '\n' + url); e.target.textContent = '✅ Скопировано'; } catch (err) { prompt('Скопируй и отправь:', text + '\n' + url); }
    });
    api.sfx(G.right >= 7 ? 'win' : 'ok');
    G.opt.onEnd(G.score, G.right, marks);
  }

  window.GAME_IMPL.emoji = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'emoji', gameApi.param, {
          run(stage, rand, hooks){
            const host = document.createElement('div');
            stage.appendChild(host);
            render(host, { rand, duel: true, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ clearTimeout(timer); G = null; },
        });
      } else {
        render(root, { rand: Math.random, onEnd: (score, right) => api.report('emoji', right >= 7, score, score) });
      }
    },
    unmount(){ clearTimeout(timer); clearInterval(tick); G = null; stopDuel?.(); stopDuel = null; root = null; },
    _test: { makeRounds, PUZZLES },
  };
})();
