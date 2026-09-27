// ═══════════════════════════════════════
//  SHORTS — вертикальная лента (#/shorts, #/shorts/<id>) + ряд превью на главной
// ═══════════════════════════════════════
// Данные — те же newestVids из youtube.js (ensureYT). YouTube API не отдаёт
// признак «это Short», поэтому эвристика: длительность ≤ 3 мин; если
// длительность неизвестна — по #shorts в названии.
//
// Экономия: iframe есть только у ролика на экране; ушёл с экрана — iframe
// удаляется, остаётся превью. Одновременно играет один ролик.
// Звук: браузеры не дают автозапуск со звуком, поэтому старт без звука и
// большая кнопка «Включить звук»; выбор запоминается и применяется к
// следующим роликам через YouTube IFrame API (postMessage, enablejsapi=1).

const SHORT_MAX_SEC = 180;
let shortsList = [];
let shortsRendered = false;
let shortsActiveId = '';
let shortsMuted = true;
let shortsObserver = null;
try { shortsMuted = localStorage.getItem('d37_shorts_sound') !== '1'; } catch (e) {}

// Вертикальное превью (oardefault) есть не у всех роликов; вместо 404 YouTube часто
// отдаёт серую заглушку 120×90 — её ловим по размеру и берём обычное превью.
function shThumbFallback(img, id){ img.onerror = img.onload = null; img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }
function shThumbCheck(img, id){ if (img.naturalWidth && img.naturalWidth <= 120) shThumbFallback(img, id); }

function durationSec(d){
  if (!d) return null;
  const p = String(d).split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.reduce((acc, n) => acc * 60 + n, 0);
}
function isShortVid(v){
  const sec = durationSec(v.duration);
  if (sec != null) return sec > 0 && sec <= SHORT_MAX_SEC;
  return /#shorts?\b/i.test(v.title || '');
}

// youtube.js зовёт это, когда список роликов готов (или не загрузился)
function onVideosLoaded(){
  shortsList = (typeof newestVids !== 'undefined' ? newestVids : []).filter(isShortVid);
  document.body.classList.toggle('no-shorts', !shortsList.length);
  renderShortsRow();
  if (document.body.dataset.route === 'shorts') renderShortsFeed();
}

// ── Ряд на главной ──
function renderShortsRow(){
  const row = document.getElementById('shortsRow');
  const track = document.getElementById('shortsRowTrack');
  if (!row || !track) return;
  if (!shortsList.length) { row.hidden = true; return; }
  row.hidden = false;
  const sub = document.getElementById('shortsRowSub');
  if (sub) sub.textContent = `${shortsList.length} ${plural(shortsList.length, 'ролик', 'ролика', 'роликов')} · листай подряд, как в TikTok`;
  track.innerHTML = shortsList.slice(0, 16).map(v => `
    <a class="sh-card" href="#/shorts/${v.id}">
      <span class="sh-card-play" aria-hidden="true">▶</span>
      ${typeof isNewVid === 'function' && isNewVid(v) ? '<span class="vnew">NEW</span>' : ''}
      <img src="https://i.ytimg.com/vi/${v.id}/oardefault.jpg" alt="${esc(v.title)}" loading="lazy"
           onload="shThumbCheck(this,'${v.id}')" onerror="shThumbFallback(this,'${v.id}')">
      <span class="sh-card-title">${esc(v.title.replace(/#\S+/g, '').trim() || v.title)}</span>
      ${v.views ? `<span class="sh-card-views">👁 ${v.views}</span>` : ''}
    </a>`).join('');
}

function plural(n, one, few, many){
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
// Стрелки у ряда: прокрутка на ширину видимой части
function scrollShortsRow(dir){
  const t = document.getElementById('shortsRowTrack');
  if (t) t.scrollBy({ left: dir * t.clientWidth * 0.85, behavior: 'smooth' });
}

// ── Роутер: вход/выход из раздела ──
function onShortsRoute(active){
  if (!active) { shortsStopAll(); return; }
  sizeShortsFeed();
  if (typeof ensureYT === 'function') ensureYT();
  if (shortsList.length) renderShortsFeed();
  else showShortsEmpty(typeof newestVids !== 'undefined' && newestVids.length ? 'Shorts пока нет' : 'Загружаем Shorts…');
}

function showShortsEmpty(text){
  const e = document.getElementById('shEmpty');
  if (!e) return;
  e.hidden = false;
  document.getElementById('shEmptyTitle').textContent = text;
}

// Высота ленты = экран минус шапка и нижний таб-бар (на телефоне)
function sizeShortsFeed(){
  const feed = document.getElementById('shFeed');
  if (!feed) return;
  const nav = document.getElementById('nav');
  const tab = document.getElementById('bottomTabbar');
  const top = nav ? nav.getBoundingClientRect().height : 0;
  const bottom = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().height : 0;
  document.getElementById('shorts-page')?.style.setProperty('--sh-top', top + 'px');
  feed.style.height = Math.max(320, innerHeight - top - bottom) + 'px';
}
window.addEventListener('resize', () => { if (document.body.dataset.route === 'shorts') sizeShortsFeed(); });

function renderShortsFeed(){
  const feed = document.getElementById('shFeed');
  if (!feed) return;
  document.getElementById('shEmpty').hidden = true;
  if (!shortsList.length) { showShortsEmpty('Shorts пока нет'); return; }

  if (!shortsRendered) {
    shortsRendered = true;
    feed.innerHTML = shortsList.map(v => `
      <section class="sh-item" data-id="${v.id}">
        <div class="sh-frame">
          <img class="sh-thumb" src="https://i.ytimg.com/vi/${v.id}/oardefault.jpg" alt="" loading="lazy"
               onload="shThumbCheck(this,'${v.id}')" onerror="shThumbFallback(this,'${v.id}')">
          <div class="sh-player"></div>
          <div class="sh-info">
            <div class="sh-title">${esc(v.title)}</div>
            <div class="sh-meta">${v.views ? '👁 ' + v.views : ''}${v.date ? ' · ' + v.date : ''}</div>
            <a class="sh-sub" href="https://www.youtube.com/@Dan4ik37Yt?sub_confirmation=1" target="_blank" rel="noopener">▶ Подписаться</a>
          </div>
        </div>
        <div class="sh-side">
          <button type="button" class="sh-btn sh-sound" onclick="toggleShortsSound()" aria-label="Звук"><span>${shortsMuted ? '🔇' : '🔊'}</span></button>
          <a class="sh-btn" href="https://www.youtube.com/shorts/${v.id}" target="_blank" rel="noopener" aria-label="Лайк на YouTube"><span>❤</span><small>Лайк</small></a>
          <button type="button" class="sh-btn" onclick="shareShort('${v.id}',this)" aria-label="Поделиться"><span>🔗</span><small>Ссылка</small></button>
        </div>
      </section>`).join('') + `
      <section class="sh-item sh-end">
        <div class="sh-end-box">
          <div class="sh-empty-ic">⚡</div>
          <b>Это все Shorts на сайте</b>
          <span>Новые выходят регулярно — подпишись, чтобы не пропустить.</span>
          <a class="yt-sub" href="https://www.youtube.com/@Dan4ik37Yt?sub_confirmation=1" target="_blank" rel="noopener">❤ Подписаться</a>
          <a class="sh-row-all" href="#/home">← К видео</a>
        </div>
      </section>`;
    setupShortsObserver(feed);
    feed.addEventListener('keydown', shortsKeys);
  }
  updateSoundButtons();

  // #/shorts/<id> — начинаем с нужного ролика
  const want = typeof currentRouteParam === 'function' ? currentRouteParam() : null;
  const target = (want && feed.querySelector(`.sh-item[data-id="${CSS.escape(want)}"]`)) || null;
  if (target) target.scrollIntoView({ block: 'start' });
  else if (!shortsActiveId) feed.scrollTop = 0;
  feed.focus({ preventScroll: true });
  // Наблюдатель сработает сам; но если лента уже стоит на ролике — перезапустим его
  // setTimeout, а не rAF: rAF и IntersectionObserver стоят на паузе, пока вкладка не отрисовывается
  setTimeout(() => { if (document.body.dataset.route === 'shorts') { sizeShortsFeed(); const cur = currentShortsItem(); if (cur) activateShort(cur); } }, 60);
  // Шрифты/панели браузера на телефоне могут доехать позже — пересчитаем высоту ещё раз
  setTimeout(() => { if (document.body.dataset.route === 'shorts') sizeShortsFeed(); }, 600);
}

function currentShortsItem(){
  const feed = document.getElementById('shFeed');
  if (!feed) return null;
  const idx = Math.round(feed.scrollTop / Math.max(feed.clientHeight, 1));
  return feed.querySelectorAll('.sh-item')[idx] || null;
}

function setupShortsObserver(feed){
  shortsObserver = new IntersectionObserver(entries => {
    if (document.body.dataset.route !== 'shorts') return;
    entries.forEach(en => {
      if (en.isIntersecting && en.intersectionRatio >= 0.6) activateShort(en.target);
      else if (!en.isIntersecting) deactivateShort(en.target);
    });
  }, { root: feed, threshold: [0, 0.6] });
  feed.querySelectorAll('.sh-item').forEach(it => shortsObserver.observe(it));
}

function activateShort(item){
  const id = item.dataset.id;
  if (!id || shortsActiveId === id && item.querySelector('iframe')) return;
  document.querySelectorAll('.sh-item.is-active').forEach(el => { if (el !== item) deactivateShort(el); });
  shortsActiveId = id;
  item.classList.add('is-active');
  const box = item.querySelector('.sh-player');
  box.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=${shortsMuted ? 1 : 0}&playsinline=1&loop=1&playlist=${id}&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}"
    title="Short" allow="autoplay;encrypted-media;picture-in-picture;fullscreen" allowfullscreen></iframe>`;
  if (typeof xpTrackIframe === 'function') xpTrackIframe(box.querySelector('iframe'), id, 15);
  // Адрес без перезагрузки — ссылку можно скопировать из строки браузера
  if (location.hash !== '#/shorts/' + id) history.replaceState(null, '', '#/shorts/' + id);
  if (typeof markVidWatched === 'function') markVidWatched(id);
}
function deactivateShort(item){
  item.classList.remove('is-active');
  const box = item.querySelector('.sh-player');
  if (box && box.firstChild) box.innerHTML = '';
  if (shortsActiveId === item.dataset.id) shortsActiveId = '';
}
function shortsStopAll(){
  document.querySelectorAll('.sh-item.is-active').forEach(deactivateShort);
}

function ytCommand(iframe, func){
  try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*'); } catch (e) {}
}
function toggleShortsSound(){
  shortsMuted = !shortsMuted;
  try { localStorage.setItem('d37_shorts_sound', shortsMuted ? '0' : '1'); } catch (e) {}
  const fr = document.querySelector('.sh-item.is-active iframe');
  if (fr) { ytCommand(fr, shortsMuted ? 'mute' : 'unMute'); if (!shortsMuted) ytCommand(fr, 'playVideo'); }
  updateSoundButtons();
}
function updateSoundButtons(){
  document.querySelectorAll('.sh-sound span').forEach(s => s.textContent = shortsMuted ? '🔇' : '🔊');
  document.getElementById('shFeed')?.classList.toggle('is-muted', shortsMuted);
}

function shareShort(id, btn){
  const url = typeof vidPageUrl === 'function' ? vidPageUrl(id) : 'https://dan4ik37.vercel.app/v/' + id;
  if (navigator.share) { navigator.share({ url }).catch(() => {}); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
    () => { const t = btn?.querySelector('small'); if (t) { t.textContent = 'Готово'; setTimeout(() => t.textContent = 'Ссылка', 1500); } },
    () => prompt('Скопируй ссылку:', url));
}

function shortsKeys(e){
  const feed = e.currentTarget;
  if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); feed.scrollBy({ top: feed.clientHeight, behavior: 'smooth' }); }
  else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); feed.scrollBy({ top: -feed.clientHeight, behavior: 'smooth' }); }
  else if (e.key === 'm') toggleShortsSound();
}
