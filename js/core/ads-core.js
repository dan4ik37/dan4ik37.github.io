// ═══════════════════════════════════════
//  РЕКЛАМА — номера блоков и показ (Рекламная сеть Яндекса или Google AdSense)
// ═══════════════════════════════════════
// Один файл и для SPA (index.html), и для серверных страниц (/games, /v/<id>).
// Впиши номер блока — реклама появится в этом месте. Пустой номер — места не видно вовсе.
//   Яндекс: partner.yandex.ru → Площадки → блок «Adaptive»/«Баннер» → id вида R-A-1234567-1
//   Google: AdSense → Реклама → По рекламным блокам → «Медийный» → data-ad-slot (только цифры)
// Если у места заданы оба — показывается Яндекс (российская аудитория, Google в РФ рекламу не крутит).
// Когда, где и как часто показывать — js/core/ad-places.js (ADS_RULES: частота, VIP без рекламы, «рядом нельзя»).
window.ADS_IDS = {
  yandex: {
    game_over:  '', // под игрой, после окончания партии (не во время игры)
    games_hub:  '', // раздел «Игры», между карточками игр и рекордами
    seo_game:   '', // страницы /games и /games/<id>, между правилами и вопросами
    video_page: '', // страница ролика /v/<id>, под описанием
    home_mid:   '', // главная, после ленты видео
    floor:      '', // «Floor Ad» — полоска внизу экрана на телефонах (тип блока «Floor Ad» в РСЯ)
    // Новые места (ad-places.js). Тип блока в РСЯ — «Баннер» (адаптивный, тема «Тёмная»):
    loading:    '', // экран загрузки мира / Студии 3D / большой игры / компилятора — если грузится дольше 1,5 с
    break:      '', // компьютер: «☕ Перерыв» под игрой после каждой 3-й партии (пусто — берётся блок game_over)
    feed:       '', // карточка «Реклама» в списках: игры, видео, каталоги игр игроков (размер карточки ~300×250)
    rail:       '', // компьютер от 1400 px: столбик справа от игры (в РСЯ — «Баннер» 160×600 или 300×600)
    // Реклама за награду (тип блока «Rewarded»): возрождение в «Орде», +40 монет, ×2 монеты за забег.
    // В РСЯ это два отдельных блока — для телефона и для компьютера. Пусто — кнопок «за рекламу» не видно.
    rewarded:           '', // Rewarded, телефон (platform touch)
    rewarded_desktop:   '', // Rewarded, компьютер
    fullscreen:         '', // «Fullscreen» на телефоне — между партиями в играх (не чаще раза в 3 минуты)
  },
  // Google H5 Games Ads (adBreak: награда и реклама между партиями) — только после одобрения отдельной заявки
  // в AdSense (developers.google.com/ad-placement). Обычные блоки AdSense за награду показывать НЕЛЬЗЯ — бан.
  h5games: false,
  // Аудитория — дети и подростки: 1 — «детская» обработка запросов Google (без персонализации, data-tag-for-age-treatment),
  // 2 — «подростковая», 0 — не указывать. Меньше дохода с Google, зато спокойнее с законами о детях (COPPA, GDPR).
  kids: 0,
  google: {
    game_over:  '5464523123', // «Игры — после партии» (его же берут loading, break, rail, если своих нет)
    games_hub:  '5924218354', // «Игры — витрина» (его же берёт feed)
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

  // Показать рекламу в el (контейнер с подписью «Реклама»). Вернёт false, если для места нет номера блока или сейчас нельзя
  // (VIP, «рядом нельзя», частота — спрашиваем ad-places.js). o.checked — диспетчер уже всё проверил и сам засчитает показ;
  // o.onEmpty(el) — у сети не нашлось рекламы (РСЯ: второй аргумент render).
  function render(el, key, o = {}){
    if (!el) return false;
    const M = window.D37AdPlaces;
    if (M && !o.checked && M.why(key, { ignoreId: true })) { el.hidden = true; return false; }
    const i = M ? M.ids(key) : { ya: window.ADS_IDS.yandex[key], g: window.ADS_IDS.google[key] };
    const ya = i.ya, g = i.g;
    if (!ya && !g) {
      if (M && M.debug()) return M.placeholder(el, key);   // отладка: пустое место видно рамкой
      el.hidden = true; return false;
    }
    el.hidden = false;
    el.classList.add('d37-ad');
    el.innerHTML = '<span class="d37-ad-label">Реклама</span>';
    if (ya) {
      loadYandex();
      const id = `yandex_rtb_${ya}_${++seq}`;
      const box = document.createElement('div');
      box.id = id;
      el.appendChild(box);
      const p = { blockId: ya, renderTo: id, darkTheme: true };
      const stat = STAT[key]; if (stat) p.statId = stat;
      window.yaContextCb.push(() => { try { Ya.Context.AdvManager.render(p, () => { try { o.onEmpty?.(el); } catch (e) {} }); } catch (e) {} });
    } else {
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', CLIENT);
      ins.setAttribute('data-ad-slot', g);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      if (window.ADS_IDS.kids) ins.setAttribute('data-tag-for-age-treatment', String(window.ADS_IDS.kids));
      el.appendChild(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    }
    if (M && !o.checked) M.mark(key);
    return true;
  }
  // statId РСЯ — срез статистики по местам (один блок может стоять в нескольких местах)
  const STAT = { loading: 11, break: 12, rail: 13, game_over: 14, feed: 20, feed_games: 21, feed_videos: 22, feed_ugc: 23 };

  // Полоска внизу экрана — только на телефонах (320–420 px, правило РСЯ для overlay), не чаще правил ad-places.js
  let floorShown = false;
  function floor(){
    const ya = window.ADS_IDS.yandex.floor, M = window.D37AdPlaces;
    if (!ya || floorShown) return;
    if (M ? M.why('floor') : !matchMedia('(max-width: 768px)').matches) return;
    floorShown = true;
    M?.mark('floor');
    loadYandex();
    window.yaContextCb.push(() => { try { Ya.Context.AdvManager.render({ blockId: ya, type: 'floorAd', platform: 'touch' }); } catch (e) {} });
  }

  // На серверных страницах: все <div data-ad="ключ"> заполняются сами (data-ad-lazy — когда подъедут к экрану)
  function fillAll(){
    if (window.D37AdPlaces) { window.D37AdPlaces.fillAll(); return; }
    document.querySelectorAll('[data-ad]').forEach(el => { if (!el.dataset.adDone) { el.dataset.adDone = '1'; render(el, el.dataset.ad); } });
  }

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
  // Счёт партий, частота, VIP — ad-places.js (ADS_RULES.places.interstitial)
  let interAt = 0, interRounds = 0;
  function interstitial(name){
    const M = window.D37AdPlaces;
    if (M) { if (!M.interRound()) return false; }
    else { interRounds++; if (interRounds < 2 || Date.now() - interAt < 180000 || !isTouch()) return false; }
    const id = window.ADS_IDS.yandex.fullscreen;
    if (id) {
      interAt = Date.now(); M?.mark('interstitial');
      loadYandex();
      window.yaContextCb.push(() => { try { Ya.Context.AdvManager.render({ blockId: id, type: 'fullscreen', platform: 'touch' }); } catch (e) {} });
      return true;
    }
    if (window.ADS_IDS.h5games) { h5Setup(); interAt = Date.now(); M?.mark('interstitial'); window.adBreak({ type: 'next', name: name || 'next' }); return true; }
    return false;
  }

  window.D37Ads = { render, floor, fillAll, rewardReady, prepareReward, showReward, interstitial };
})();
