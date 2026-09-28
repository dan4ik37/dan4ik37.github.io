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
  },
  google: {
    game_over:  '',
    games_hub:  '',
    seo_game:   '',
    video_page: '',
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

  window.D37Ads = { render, floor, fillAll };
})();
