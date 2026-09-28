// api/video.js — отдельная страница ролика: /v/<id> (rewrite в vercel.json)
//
// Зачем: сайт — SPA на #/хэшах, поисковик видел одну страницу почти без
// собственного текста (AdSense: «бесполезный контент»). Здесь на каждый
// ролик — готовый HTML с названием, описанием, JSON-LD VideoObject и
// перелинковкой, который видят и Google/Яндекс, и превью мессенджеров.
// Плеер — «фасад»: сначала превью, iframe YouTube грузится по клику
// (страница лёгкая, просмотр при воспроизведении засчитывается каналу).
import { SITE, VIDEO_ID_RE, getVideo, getUploads, esc, fmtDuration, fmtCount } from './_lib/yt.js';
import { page, YT_CHANNEL } from './_lib/page.js';

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!VIDEO_ID_RE.test(id)) return notFound(res);

  let v, more;
  try {
    [v, more] = await Promise.all([getVideo(id), getUploads(50).catch(() => [])]);
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
  if (!v) return notFound(res);

  const sn = v.snippet, st = v.statistics || {};
  const url = `${SITE}/v/${id}`;
  const thumb = sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const desc = (sn.description || '').trim();
  const metaDesc = (desc.replace(/\s+/g, ' ').slice(0, 155) || `${sn.title} — видео dan4ik37 на YouTube.`);
  const date = new Date(sn.publishedAt);
  const dateRu = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
  const dur = fmtDuration(v.contentDetails?.duration);
  const related = (more || []).filter(x => x.id !== id).slice(0, 8);
  const tags = (sn.tags || []).slice(0, 12);

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
<main class="wrap">
  <article class="video">
    <div class="player" id="player" data-id="${esc(id)}">
      <img src="${esc(thumb)}" alt="${esc(sn.title)}" width="1280" height="720" fetchpriority="high">
      <button type="button" class="play" aria-label="Смотреть видео">▶</button>
      ${dur ? `<span class="dur">${esc(dur)}</span>` : ''}
    </div>
    <h1>${esc(sn.title)}</h1>
    <div class="meta">
      <span>📅 ${esc(dateRu)}</span>
      ${st.viewCount ? `<span>👁 ${esc(fmtCount(st.viewCount))} просмотров</span>` : ''}
      ${st.likeCount ? `<span>❤ ${esc(fmtCount(st.likeCount))}</span>` : ''}
      ${dur ? `<span>⏱ ${esc(dur)}</span>` : ''}
    </div>
    <div class="cta">
      <a class="btn btn-yt" href="${YT_CHANNEL}?sub_confirmation=1" target="_blank" rel="noopener">▶ Подписаться на канал</a>
      <a class="btn btn-ghost" href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">Открыть на YouTube</a>
      <button type="button" class="btn btn-ghost" id="share">🔗 Поделиться</button>
    </div>
    ${desc ? `<section class="desc"><h2>Описание</h2><p>${linkify(desc)}</p></section>` : ''}
    <div data-ad="video_page" hidden></div>
    ${tags.length ? `<ul class="tags">${tags.map(t => `<li>#${esc(t)}</li>`).join('')}</ul>` : ''}
  </article>

  <aside class="join">
    <div>
      <b>Это сайт dan4ik37</b>
      <span>Новые видео, стримы на Twitch, живой чат, форум и мини-игры — всё в одном месте.</span>
    </div>
    <a class="btn btn-acc" href="/#/home">На сайт →</a>
  </aside>

  ${related.length ? `<section class="more"><h2>Ещё видео</h2><div class="grid">
    ${related.map(r => `<a class="card" href="/v/${esc(r.id)}"><img src="${esc(r.thumb)}" alt="" loading="lazy" width="320" height="180"><span>${esc(r.title)}</span></a>`).join('')}
  </div><p class="all"><a href="/#/home">Все видео на сайте →</a></p></section>` : ''}
</main>`;

  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).send(page({
    title: `${sn.title} — dan4ik37`,
    description: metaDesc,
    url, image: thumb, ld, body, script: playerJs(id), ogType: 'video.other'
  }));
}

function notFound(res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  return res.status(404).send(page({
    title: 'Видео не найдено — dan4ik37',
    body: `<main class="wrap narrow"><h1>Такого видео нет</h1>
      <p class="muted">Возможно, ссылка неполная или ролик удалён.</p>
      <p><a class="btn btn-acc" href="/#/home">Смотреть все видео →</a></p></main>`,
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
  var s=document.getElementById('share');
  if(s)s.addEventListener('click',function(){
    var u=location.origin+location.pathname,t=document.title;
    if(navigator.share){navigator.share({title:t,url:u}).catch(function(){});return;}
    (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){s.textContent='✓ Ссылка скопирована';setTimeout(function(){s.textContent='🔗 Поделиться'},1800)},function(){prompt('Скопируй ссылку:',u)});
  });
})();`;
}
