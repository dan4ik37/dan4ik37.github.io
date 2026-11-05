// api/video.js — отдельная страница ролика: /v/<id> (rewrite в vercel.json)
//
// Зачем: сайт — SPA на #/хэшах, поисковик видел одну страницу почти без
// собственного текста (AdSense: «бесполезный контент»). Здесь на каждый
// ролик — готовый HTML с названием, описанием, JSON-LD VideoObject и
// перелинковкой, который видят и Google/Яндекс, и превью мессенджеров.
// Плеер — «фасад»: сначала превью, iframe YouTube грузится по клику
// (страница лёгкая, просмотр при воспроизведении засчитывается каналу).
import { SITE, VIDEO_ID_RE, getVideo, getUploads, relatedVideos, isGambling, hiddenVideo, esc, fmtDuration, fmtCount, cleanDesc, ownWords, VIDEO_OWN_WORDS, isShortVideo, SNAPSHOT_AT } from './_lib/yt.js';
import { page, YT_CHANNEL } from './_lib/page.js';
import { videoFromSnapshot } from './_lib/video-snap.js';
import { topicsFor } from './_lib/topics.js';
import { QUIZZES } from './_lib/quizzes.js';
import { videoAge, ageBadge, ageAttr } from './_lib/age.js';

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!VIDEO_ID_RE.test(id)) return notFound(res);

  let v, more, snap;
  try {
    // Сначала снимок (без квоты YouTube API), API — только для роликов новее снимка
    snap = videoFromSnapshot(id);
    [v, more] = await Promise.all([snap || getVideo(id), getUploads(200).catch(() => [])]);
  } catch (e) {
    // YouTube API недоступен/квота — не кэшируем надолго, отдаём ссылку на ролик
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(503).send(page({
      title: 'Видео временно недоступно — dan4ik37',
      body: `<main class="wrap narrow"><h1>Не удалось загрузить видео</h1>
        <p class="muted">Попробуй чуть позже или открой его сразу на YouTube.</p>
        <p><a class="btn btn-yt" href="https://www.youtube.com/watch?v=${esc(id)}">▶ Смотреть на YouTube</a></p></main>`,
      noindex: true
    }));
  }
  if (!v || hiddenVideo(id, v.snippet?.title, v.snippet?.description)) return notFound(res);

  const sn = v.snippet, st = v.statistics || {};
  const url = `${SITE}/v/${id}`;
  const thumb = sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const rawDesc = (sn.description || '').trim();
  const desc = cleanDesc(rawDesc);   // без повторов и строк-рекламы Restream / «глянуть теги» (yt.js cleanDesc)
  const metaDesc = (desc.replace(/\s+/g, ' ').slice(0, 155) || `${sn.title} — видео dan4ik37 на YouTube.`);
  const date = new Date(sn.publishedAt);
  const dateRu = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
  const dur = fmtDuration(v.contentDetails?.duration);
  const rel = relatedVideos({ id, title: sn.title, tags: sn.tags }, more || [], 8);
  const related = rel.list;
  const topics = topicsFor(sn.title);
  const quiz = QUIZZES.find(q => q.topic && topics.some(t => t.slug === q.topic));
  // Возрастная метка (api/_lib/age.js): не по возрасту — браузер накроет страницу обложкой (js/core/age.js, data-age-page)
  const va = videoAge(sn.title, rawDesc);
  // Реклама (05.11.2026): только если в описании есть свой текст автора (≥ VIDEO_OWN_WORDS слов, yt.js ownWords) — иначе страница —
  // одни данные YouTube (AdSense: «бесполезный» и скопированный контент; YouTube API III.G.1.d); не рядом с кейсами (isGambling) и
  // не на роликах 16+ / 18+ (хорроры с жестокостью, стрельба по людям, мат — правила AdSense о шокирующем; красная линия сайта)
  const noAds = isGambling(sn.title, rawDesc) || va.age >= 16 || ownWords(rawDesc) < VIDEO_OWN_WORDS;
  // Шортс — короткий клип (часто кусок того же стрима, что и длинный ролик): страница есть, в поиск — нет (yt.js isShortVideo)
  const short = isShortVideo(sn.title, sn.publishedAt, v.contentDetails?.duration);
  // Цифры — с датой, на когда они (правила YouTube API III.E.4.f): из снимка — его день, из API — день сборки страницы (CDN держит сутки).
  // Вернулся с YouTube после «👍 Лайк на YouTube» — свежие цифры (js/core/vlike.js → /api/vstats) и «обновлено ЧЧ:ММ».
  const statsAt = snap ? 'данные YouTube на ' + new Date(SNAPSHOT_AT).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : 'данные YouTube на ' + new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' });

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: sn.title,
    description: desc.slice(0, 4900) || sn.title,
    thumbnailUrl: [thumb],
    uploadDate: sn.publishedAt,
    duration: v.contentDetails?.duration,
    embedUrl: `https://www.youtube.com/embed/${id}`,
    url,
    author: { '@type': 'Person', name: 'dan4ik37', url: SITE + '/' },
    ...(st.viewCount ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: +st.viewCount } } : {})
  };

  const body = `
<main class="wrap" data-age-page="${va.age}" data-age-why="${esc(va.why)}" data-age-title="${esc(sn.title)}">
  <article class="video">
    <div class="player" id="player" data-id="${esc(id)}">
      <img src="${esc(thumb)}" alt="${esc(sn.title)}" width="1280" height="720" fetchpriority="high">
      <button type="button" class="play" aria-label="Смотреть видео">▶</button>
      ${dur ? `<span class="dur">${esc(dur)}</span>` : ''}
    </div>
    <h1>${esc(sn.title)}</h1>
    <div class="meta">
      <span>${ageBadge(va.age, { title: va.why })}</span>
      <span>📅 ${esc(dateRu)}</span>
      ${st.viewCount ? `<span data-vs="views">👁 ${esc(fmtCount(st.viewCount))} просмотров</span>` : ''}
      ${st.likeCount ? `<span data-vs="likes" title="Лайки на YouTube">👍 ${esc(fmtCount(st.likeCount))}</span>` : ''}
      ${dur ? `<span>⏱ ${esc(dur)}</span>` : ''}
      ${st.viewCount ? `<span data-vs="at" class="vs-at">${esc(statsAt)}</span>` : ''}
    </div>
    <div class="cta">
      <a class="btn btn-yt" href="${YT_CHANNEL}?sub_confirmation=1" target="_blank" rel="noopener">▶ Подписаться на YouTube</a>
      <a class="btn btn-ghost" data-vlike="${esc(id)}" href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener" title="Откроется ролик на YouTube — лайк ставится там (нужен вход в YouTube). Сам сайт лайк не ставит.">👍 Лайк на YouTube<span class="vl-mark"></span></a>
      <a class="btn btn-ghost" href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">Открыть на YouTube</a>
      <button type="button" class="btn btn-ghost" id="share">🔗 Поделиться</button>
      <button type="button" class="btn btn-ghost" onclick="d37Surprise(this)">🎲 Случайное видео</button>
    </div>
    ${desc ? `<section class="desc"><h2>Описание</h2><p>${linkify(desc)}</p></section>` : ''}
    ${noAds ? '' : '<div data-ad="video_page" hidden></div>'}
    ${topics.length ? `<p class="topics">Ещё по теме: ${topics.map(t => `<a href="/topic/${t.slug}">${esc(t.name)} →</a>`).join(' ')}${quiz ? ` <a href="/quiz/${quiz.slug}">🧩 Тест: ${esc(quiz.title)}</a>` : ''}</p>` : ''}
  </article>

  <nav class="next3" aria-label="Что ещё на сайте">
    <a href="/play/words"><span>🔤</span><b>Слово дня</b><small>Угадай слово из 5 букв за 6 попыток</small></a>
    ${quiz ? `<a href="/quiz/${quiz.slug}"><span>${quiz.icon}</span><b>${esc(quiz.title)}</b><small>Тест: 8 вопросов — поделись результатом</small></a>`
      : '<a href="/quiz/game"><span>🕹</span><b>Какая ты игра?</b><small>Тест: 8 вопросов — поделись результатом</small></a>'}
    <a href="/"><span>💬</span><b>Сайт dan4ik37</b><small>Чат, стримы, игры с друзьями и все видео</small></a>
  </nav>

  ${related.length ? `<section class="more"><h2>${rel.similar ? 'Похожие видео' : 'Ещё видео'}</h2><div class="grid">
    ${related.map(r => { const a = videoAge(r.title).age; return `<a class="card" href="/v/${esc(r.id)}"${ageAttr(a)}><img src="${esc(r.thumb)}" alt="${esc(r.title)}" loading="lazy" width="320" height="180">${ageBadge(a, { min: 16 })}<span>${esc(r.title)}</span></a>`; }).join('')}
  </div><p class="all"><a href="/videos">Все видео канала →</a> · <a href="/games">🎮 Игры на сайте</a></p></section>` : ''}
</main>
<script src="/js/core/vlike.js"></script>`;

  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).send(page({
    title: `${sn.title} — dan4ik37`,
    description: metaDesc,
    url, image: thumb, ld, body, script: playerJs(id), ogType: 'video.other', noAds, noindex: short
  }));
}

function notFound(res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  return res.status(404).send(page({
    title: 'Видео не найдено — dan4ik37',
    body: `<main class="wrap narrow"><h1>Такого видео нет</h1>
      <p class="muted">Возможно, ссылка неполная или ролик удалён.</p>
      <p><a class="btn btn-acc" href="/">Смотреть все видео →</a></p></main>`,
    noindex: true
  }));
}

// Ссылки в описании кликабельные, переносы строк сохраняются
function linkify(text) {
  return esc(text)
    .replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener nofollow ugc">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>`)
    .replace(/\n/g, '<br>');
}

function playerJs(id) {
  return `
(function(){
  var p=document.getElementById('player');
  function play(){
    if(p.dataset.on)return;p.dataset.on='1';
    p.innerHTML='<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0" title="YouTube" allow="autoplay;encrypted-media;picture-in-picture;fullscreen" allowfullscreen></iframe>';
  }
  p.addEventListener('click',play);
  // «👍 Лайк на YouTube» (js/core/vlike.js): ✓ — отметка этого браузера; вернулся с YouTube — свежие цифры этого ролика
  var L=window.D37VLike;
  if(L){
    L.paint(document);
    window.addEventListener('d37:vstats',function(e){
      var s=e.detail;if(!s||s.id!=='${id}')return;
      function put(k,t){var el=document.querySelector('[data-vs="'+k+'"]');if(el)el.textContent=t;}
      put('views','👁 '+L.fmt(s.views)+' просмотров');put('likes','👍 '+L.fmt(s.likes));put('at',L.when(s));
    });
  }
  var s=document.getElementById('share');
  if(s)s.addEventListener('click',function(){
    var u=location.origin+location.pathname,t=document.title;
    if(navigator.share){navigator.share({title:t,url:u}).catch(function(){});return;}
    (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){s.textContent='✓ Ссылка скопирована';setTimeout(function(){s.textContent='🔗 Поделиться'},1800)},function(){prompt('Скопируй ссылку:',u)});
  });
})();`;
}
