// ═══════════════════════════════════════
//  РЕКЛАМА — номера блоков и показ (Рекламная сеть Яндекса или Google AdSense)
// ═══════════════════════════════════════
// Один файл и для SPA (index.html), и для серверных страниц (/games, /v/<id>).
// Впиши номер блока — реклама появится в этом месте. Пустой номер — места не видно вовсе.
//   Яндекс: partner.yandex.ru → Площадки → блок «Adaptive»/«Баннер» → id вида R-A-1234567-1
//   Google: AdSense → Реклама → По рекламным блокам → «Медийный» → data-ad-slot (только цифры)
// Если у места заданы оба — показывается Яндекс (российская аудитория, Google в РФ рекламу не крутит).
window.ADS_IDS = {
  yandex: {
    game_over:  '', // под игрой, после окончания партии (не во время игры)
    games_hub:  '', // раздел «Игры», между карточками игр и рекордами
    seo_game:   '', // страницы /games и /games/<id>, между правилами и вопросами
    video_page: '', // страница ролика /v/<id>, под описанием
    home_mid:   '', // главная, после ленты видео
    floor:      '', // «Floor Ad» — полоска внизу экрана на телефонах (тип блока «Floor Ad» в РСЯ)
    // Реклама за награду (тип блока «Rewarded»): возрождение в «Орде», +40 монет, ×2 монеты за забег.
    // В РСЯ это два отдельных блока — для телефона и для компьютера. Пусто — кнопок «за рекламу» не видно.
    rewarded:           '', // Rewarded, телефон (platform touch)
    rewarded_desktop:   '', // Rewarded, компьютер
    fullscreen:         '', // «Fullscreen» на телефоне — между партиями в играх (не чаще раза в 3 минуты)
  },
  // Google H5 Games Ads (adBreak: награда и реклама между партиями) — только после одобрения отдельной заявки
  // в AdSense (developers.google.com/ad-placement). Обычные блоки AdSense за награду показывать НЕЛЬЗЯ — бан.
  h5games: false,
  google: {
    game_over:  '5464523123', // «Игры — после партии»
    games_hub:  '5924218354', // «Игры — витрина»
    seo_game:   '8326096973', // «Страницы игр»
    video_page: '7013015305', // «Страница видео»
  },
};

(() => {
  const CLIENT = 'ca-pub-7940480593743401';
  let yaLoaded = false, seq = 0;

  function loadYandex(){
    if (yaLoaded) return;
    yaLoaded = true;
    window.yaContextCb = window.yaContextCb || [];
    const s = document.createElement('script');
    s.src = 'https://yandex.ru/ads/system/context.js';
    s.async = true;
    document.head.appendChild(s);
  }

  // Показать рекламу в el (контейнер с подписью «Реклама»). Вернёт false, если для места нет номера блока.
  function render(el, key){
    if (!el) return false;
    const ya = window.ADS_IDS.yandex[key], g = window.ADS_IDS.google[key];
    if (!ya && !g) { el.hidden = true; return false; }
    el.hidden = false;
    el.classList.add('d37-ad');
    el.innerHTML = '<span class="d37-ad-label">Реклама</span>';
    if (ya) {
      loadYandex();
      const id = `yandex_rtb_${ya}_${++seq}`;
      const box = document.createElement('div');
      box.id = id;
      el.appendChild(box);
      window.yaContextCb.push(() => { try { Ya.Context.AdvManager.render({ blockId: ya, renderTo: id }); } catch (e) {} });
    } else {
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', CLIENT);
      ins.setAttribute('data-ad-slot', g);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      el.appendChild(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    }
    return true;
  }

  // Полоска внизу экрана — только на телефонах, один раз за визит
  let floorShown = false;
  function floor(){
    const ya = window.ADS_IDS.yandex.floor;
    if (!ya || floorShown || !matchMedia('(max-width: 768px)').matches) return;
    floorShown = true;
    loadYandex();
    window.yaContextCb.push(() => { try { Ya.Context.AdvManager.render({ blockId: ya, type: 'floorAd', platform: 'touch' }); } catch (e) {} });
  }

  // На серверных страницах: все <div data-ad="ключ"> заполняются сами
  function fillAll(){ document.querySelectorAll('[data-ad]').forEach(el => { if (!el.dataset.adDone) { el.dataset.adDone = '1'; render(el, el.dataset.ad); } }); }

  const isTouch = () => matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 768px)').matches;

  // ── Google H5 Games Ads (если включено) ──
  let h5Init = false, h5Show = null, h5Done = null;
  function h5Setup(){
    if (h5Init) return;
    h5Init = true;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = o => window.adsbygoogle.push(o);
    window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });
  }

  // ── Реклама за награду ──
  // Правила РСЯ: открывать только по кнопке, на которой написано, что будет реклама и что за неё дадут;
  // награда — только если досмотрел (onRewarded(true)); наградой не могут быть деньги.
  const rewardId = () => isTouch() ? window.ADS_IDS.yandex.rewarded : window.ADS_IDS.yandex.rewarded_desktop;
  // Можно ли вообще предложить «за рекламу» (есть блок). Для Google — prepareReward() (кнопка — только когда реклама готова)
  function rewardReady(){ return !!rewardId() || !!h5Show; }
  function prepareReward(name){
    if (rewardId()) return Promise.resolve(true);
    if (!window.ADS_IDS.h5games) return Promise.resolve(false);
    if (h5Show) return Promise.resolve(true);
    h5Setup();
    return new Promise(resolve => {
      let ready = false;
      const t = setTimeout(() => resolve(false), 2500);
      window.adBreak({
        type: 'reward', name: name || 'reward',
        beforeReward: show => { ready = true; clearTimeout(t); h5Show = show; resolve(true); },
        adViewed: () => { h5Done?.(true); h5Done = null; },
        adDismissed: () => { h5Done?.(false); h5Done = null; },
        adBreakDone: () => { if (!ready) { clearTimeout(t); resolve(false); } h5Done?.(false); h5Done = null; },
      });
    });
  }
  // Показать. Обещание: true — досмотрел (выдать награду), false — закрыл раньше / рекламы нет / блокировщик
  function showReward(name){
    return new Promise(resolve => {
      let done = false;
      const finish = ok => { if (!done) { done = true; resolve(ok); } };
      const id = rewardId();
      if (id) {
        loadYandex();
        const t = setTimeout(() => finish(false), 12000);   // скрипт РСЯ так и не загрузился (блокировщик рекламы)
        window.yaContextCb.push(() => {
          clearTimeout(t);
          if (done) return;   // опоздал: награду уже не ждут — рекламу не показываем
          try {
            Ya.Context.AdvManager.render({
              blockId: id, type: 'rewarded', platform: isTouch() ? 'touch' : 'desktop',
              onRewarded: ok => finish(!!ok),
              onClose: () => setTimeout(() => finish(false), 400),   // onRewarded(true) может прийти чуть позже закрытия
              onError: () => finish(false),
            });
          } catch (e) { finish(false); }
        });
        return;
      }
      if (h5Show) { const show = h5Show; h5Show = null; h5Done = finish; try { show(); } catch (e) { finish(false); } return; }
      finish(false);
    });
  }

  // ── Полноэкранная реклама между партиями (только телефон): не после первой партии визита и не чаще раза в 3 минуты ──
  let interAt = 0, interRounds = 0;
  function interstitial(name){
    interRounds++;
    if (interRounds < 2 || Date.now() - interAt < 180000 || !isTouch()) return false;
    const id = window.ADS_IDS.yandex.fullscreen;
    if (id) {
      interAt = Date.now();
      loadYandex();
      window.yaContextCb.push(() => { try { Ya.Context.AdvManager.render({ blockId: id, type: 'fullscreen', platform: 'touch' }); } catch (e) {} });
      return true;
    }
    if (window.ADS_IDS.h5games) { h5Setup(); interAt = Date.now(); window.adBreak({ type: 'next', name: name || 'next' }); return true; }
    return false;
  }

  window.D37Ads = { render, floor, fillAll, rewardReady, prepareReward, showReward, interstitial };
})();
