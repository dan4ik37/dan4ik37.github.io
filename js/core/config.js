// ═══════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════
const YT_KEY    = 'AIzaSyA0dK2a1YG_s54zG-zapYgjycIempCvHp0';
const YT_HANDLE = '@Dan4ik37Yt';
const YT_CH_ID  = 'UCXXXXXXXXXXXXXXXXXXXXXXXXX'; // заполнится автоматически (в оригинале никогда не переприсваивается)
const TWITCH    = 'dan4ik37';
const CACHE_KEY = 'dan4ik37_cache_v2';
const CACHE_TTL = 15 * 60 * 1000;
const HOST      = location.hostname || 'localhost';

// ═══════════════════════════════════════
//  GOOGLE ADSENSE — ID рекламных блоков
// ═══════════════════════════════════════
// AdSense → Реклама → По рекламным блокам → «Медийный» → скопировать
// значение data-ad-slot (только цифры) и вписать сюда. Пока ID пустой —
// блок на сайте скрыт (иначе Google отдаёт ошибку и пустое место).
// «Автоматическая реклама» (Auto ads) включается в кабинете AdSense
// и работает без этих ID — скрипт уже подключён в <head>.
const AD_SLOTS = {
  home_mid:      '4386851962', // главная, после ленты видео («Главная — середина»)
  home_bottom:   '1760688624', // главная, в самом низу («Главная — низ»)
  ads_page_top:  '', // раздел «Реклама», сверху
  ads_page_card: '', // раздел «Реклама», карточка Google AdSense
};
