function countUp(id,t){
  const el=document.getElementById(id);if(!el)return;
  el.classList.remove('skeleton');

  let c=0,s=t/80;
  const tm=setInterval(()=>{c=Math.min(c+s,t);el.textContent=fmt(Math.round(c));if(c>=t){clearInterval(tm)}},18);
}
function statsLoaded(){
  const note=document.getElementById('statsNote');
  if(note) note.hidden=true;
}
function statsError(){
  const note=document.getElementById('statsNote');
  if(note){ note.hidden=false; note.innerHTML='Цифры канала сейчас недоступны · <a href="https://www.youtube.com/@Dan4ik37Yt" target="_blank" rel="noopener">открыть канал →</a>'; }
  // Иначе skeleton-шиммер крутился бы бесконечно, раз countUp() так и не вызовется
  ['s-subs','s-views','s-vids'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.classList.remove('skeleton'); el.textContent='—'; }
  });
}

// ═══════════════════════════════════════
//  CACHE
// ═══════════════════════════════════════
function saveCache(d){try{localStorage.setItem(CACHE_KEY,JSON.stringify({ts:Date.now(),d}))}catch(e){}}
function loadCache(){try{const c=JSON.parse(localStorage.getItem(CACHE_KEY));if(c&&Date.now()-c.ts<CACHE_TTL)return c.d}catch(e){}return null}

// ═══════════════════════════════════════
//  YOUTUBE API — параллельные запросы
// ═══════════════════════════════════════
async function ytFetch(url){
  try{const r=await fetch(url);if(r.ok)return r.json()}catch(e){}
  try{const r=await fetch('https://api.allorigins.win/get?url='+encodeURIComponent(url));const d=await r.json();return JSON.parse(d.contents)}catch(e){}
  return null;
}

// ═══════════════════════════════════════
//  ДЛИТЕЛЬНОСТЬ ВИДЕО (PT18M24S → 18:24)
// ═══════════════════════════════════════
function formatYtDuration(iso){
  if(!iso) return '';
  const m=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if(!m) return '';
  const h=parseInt(m[1]||0),mi=parseInt(m[2]||0),s=parseInt(m[3]||0);
  if(h) return h+':'+String(mi).padStart(2,'0')+':'+String(s).padStart(2,'0');
  return mi+':'+String(s).padStart(2,'0');
}

// ═══════════════════════════════════════
//  «ПРОСМОТРЕНО» — честная бинарная отметка (открывал/не открывал),
//  без выдуманных процентов: реального API прогресса воспроизведения
//  на сайте нет.
// ═══════════════════════════════════════
let watchedIds = new Set();
try{ watchedIds = new Set(JSON.parse(localStorage.getItem('d37_watched')||'[]')); }catch(e){}
function markVidWatched(id){
  if(watchedIds.has(id)) return;
  watchedIds.add(id);
  try{ localStorage.setItem('d37_watched', JSON.stringify([...watchedIds])); }catch(e){}
  const card=document.querySelector(`.vcard[data-id="${id}"]`);
  if(card && !card.querySelector('.vwatched')){
    const b=document.createElement('div');
    b.className='vwatched';b.title='Просмотрено';b.textContent='✓ Просмотрено';
    card.querySelector('.vthumb')?.appendChild(b);
  }
}

let vidCountLimit = 12; // текущий лимит отображения
let videoSearchQuery = ''; // поиск по названию видео

// Что реально должно быть отрисовано прямо сейчас — с учётом активного
// поиска. Используется везде, где раньше было allVids.slice(0,vidCountLimit)
// или голый allVids, чтобы поиск не "терялся" при смене вида/кол-ва/выборе.
function getVisibleVids(){
  if (videoSearchQuery) return allVids.filter(v => (v.title||'').toLowerCase().includes(videoSearchQuery));
  return feedVids().slice(0, vidCountLimit);
}
// В режиме «Новые» самый свежий ролик уже крупно показан в первом экране — не дублируем его в ленте
function feedVids(){
  return (vidSort==='new' && featuredVid) ? allVids.filter(v => v.id !== featuredVid.id) : allVids;
}

// ═══════════════════════════════════════
//  ПОРЯДОК ВИДЕО: новые / популярные / случайные
//  newestVids — исходный порядок плейлиста загрузок (он и есть «от новых к старым»),
//  allVids — то, что сейчас показано в выбранном порядке.
// ═══════════════════════════════════════
let newestVids = [];
let vidSort = 'new';
function sortedVids(mode){
  const list=[...newestVids];
  if(mode==='top') return list.sort((a,b)=>(b.viewsN||0)-(a.viewsN||0));
  if(mode==='rand'){
    for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
  }
  return list;
}
function setVidSort(mode){
  vidSort=mode;
  document.querySelectorAll('.vs-opt').forEach(b=>b.classList.toggle('active', b.dataset.sort===mode));
  if(!newestVids.length) return;
  allVids=sortedVids(mode);
  vidCountLimit=12;
  renderCurrentVids();
}
function showMoreVids(){
  vidCountLimit+=12;
  renderCurrentVids();
}
function renderCurrentVids(){
  if (videoSearchQuery) { filterVids(document.getElementById('videoSearchInput')?.value || ''); return; }
  renderVids(getVisibleVids());
}
function updateMoreBtn(){
  const b=document.getElementById('vidMore');
  if(b) b.hidden = !!videoSearchQuery || selMode || vidCountLimit>=feedVids().length;
}

// ═══════════════════════════════════════
//  НОВОЕ ВИДЕО в первом экране
// ═══════════════════════════════════════
let featuredVid = null;
function renderFeatured(v){
  if(!v || !v.id) return;
  featuredVid=v;
  const img=document.getElementById('heroFeatureImg');
  if(img){
    img.alt=v.title||'';
    img.onload=()=>{img.hidden=false;document.getElementById('heroFeaturePh')?.remove();};
    img.src=v.thumb||`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  }
  const t=document.getElementById('heroFeatureTitle'); if(t) t.textContent=v.title||'';
  const m=document.getElementById('heroFeatureMeta');
  if(m) m.textContent=[v.views?'👁 '+v.views:'', v.date?'📅 '+v.date:''].filter(Boolean).join('   ');
  const d=document.getElementById('heroFeatureDur');
  if(d){ d.textContent=v.duration||''; d.hidden=!v.duration; }
  const lbl=document.getElementById('heroFeatureLabel');
  if(lbl) lbl.textContent=watchedIds.has(v.id)?'Последнее видео':'Новое видео';
}
function openFeaturedVid(){
  if(featuredVid) openVid(featuredVid.id,featuredVid.title,featuredVid.date,featuredVid.views);
  else window.open('https://www.youtube.com/@Dan4ik37Yt/videos','_blank','noopener');
}
function filterVids(query){
  videoSearchQuery = query.trim().toLowerCase();
  const clearBtn = document.getElementById('videoSearchClear');
  if (clearBtn) clearBtn.style.display = videoSearchQuery ? 'flex' : 'none';
  updateMoreBtn();
  if (!allVids.length) return;
  const vids = getVisibleVids();
  if (videoSearchQuery && !vids.length) {
    document.getElementById('yt-grid').innerHTML = `<div class="empty-state"><span class="empty-state-icon">🔍</span><div class="empty-state-title">Ничего не найдено</div><div class="empty-state-text">По запросу «${esc(query.trim())}» видео не нашлось — попробуй другое слово</div></div>`;
    return;
  }
  renderVids(vids);
}
function clearVideoSearch(){
  const inp = document.getElementById('videoSearchInput');
  if (inp) inp.value = '';
  filterVids('');
}

function changeVidCount(val, btn) {
  vidCountLimit = parseInt(val);
  document.querySelectorAll('.count-opt').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (allVids.length) renderCurrentVids();
}

async function loadYT(){
  showLoader();
  let cached=loadCache();
  // Кэш старого формата (без ts) мог сохраниться перемешанным — не доверяем ему
  if(cached && !cached.vids?.[0]?.ts) cached=null;
  if(cached){
    newestVids=cached.vids||[];
    allVids=sortedVids(vidSort);
    if(cached.stats){countUp('s-subs',cached.stats.subs);countUp('s-views',cached.stats.views);countUp('s-vids',cached.stats.vids)}
    if(allVids.length){
      renderFeatured(newestVids[0]);
      renderCurrentVids();
      statsLoaded();
      // Кэш свежий (< CACHE_TTL) — не тратим квоту YouTube API повторно
      return;
    }
    showFallback();
  }
  try{
    const ch=await ytFetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&forHandle=${YT_HANDLE}&key=${YT_KEY}`);
    if(!ch?.items?.length)throw new Error('Канал не найден');
    channelId=ch.items[0].id;
    const stats=ch.items[0].statistics;
    const uploads=ch.items[0].contentDetails.relatedPlaylists.uploads;
    const st={subs:parseInt(stats.subscriberCount||0),views:parseInt(stats.viewCount||0),vids:parseInt(stats.videoCount||0)};
    countUp('s-subs',st.subs);countUp('s-views',st.views);countUp('s-vids',st.vids);
    statsLoaded();

    // Последние 50 загрузок. «Популярные» сортируем по просмотрам локально:
    // search?order=viewCount стоил 100 единиц квоты из 10 000 в сутки на КАЖДЫЙ заход.
    const pl = await ytFetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploads}&maxResults=50&key=${YT_KEY}`);
    if(!pl?.items?.length) throw new Error('Видео не найдены');

    const ids=pl.items.map(i=>i.contentDetails.videoId).join(',');
    const det=await ytFetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${ids}&key=${YT_KEY}`);
    const dm={};det?.items?.forEach(v=>{dm[v.id]={stats:v.statistics,duration:v.contentDetails?.duration}});

    const rawVids=pl.items.map(item=>{
      const id=item.contentDetails.videoId,sn=item.snippet,d=dm[id]||{},st=d.stats||{};
      return{id,title:sn.title,thumb:sn.thumbnails?.high?.url||'',date:new Date(sn.publishedAt).toLocaleDateString('ru-RU'),views:st.viewCount?fmt(st.viewCount):'',viewsN:parseInt(st.viewCount||0),ts:Date.parse(sn.publishedAt)||0,likes:st.likeCount?fmt(st.likeCount):'',duration:formatYtDuration(d.duration)};
    }).filter(v=>v.title!=='Private video'&&v.title!=='Deleted video');

    // Плейлист загрузок почти всегда идёт от новых к старым, но не гарантированно — сортируем явно
    newestVids = rawVids.sort((a,b)=>b.ts-a.ts);
    allVids = sortedVids(vidSort);
    saveCache({vids:rawVids,stats:st});
    renderFeatured(newestVids[0]);
    renderCurrentVids();
  }catch(err){
    console.warn('YT:',err.message);
    statsError();
    if(!cached)showFallback();
  }
}

function showLoader(){document.getElementById('yt-grid').innerHTML=`<div class="loader-cell"><div class="spinner"></div>Загрузка…</div>`}
function showFallback(){
  const grid = document.getElementById('yt-grid');
  grid.className = 'video-grid';
  // Получаем channelId из кеша (если он уже был определён ранее) или используем общую ссылку
  const chId = channelId || '';
  const playlistSrc = chId
    ? `https://www.youtube.com/embed/videoseries?list=UU${chId.slice(2)}&rel=0&modestbranding=1`
    : `https://www.youtube.com/embed?listType=user_uploads&list=Dan4ik37Yt&rel=0&modestbranding=1`;
  grid.innerHTML = `
    <div class="err-box" style="grid-column:1/-1">
      <strong>📡 YouTube API — превышена суточная квота</strong>
      Видео загружаются напрямую. Квота обновляется каждые 24 часа.
      <br><a href="https://www.youtube.com/@Dan4ik37Yt/videos" target="_blank" style="color:var(--yt)">Все видео на YouTube →</a>
    </div>
    <div style="grid-column:1/-1;border-radius:var(--r);overflow:hidden;background:var(--card);border:1px solid var(--border)">
      <div style="position:relative;padding-bottom:56.25%">
        <iframe src="${playlistSrc}"
          style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen
          allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"></iframe>
      </div>
      <div style="padding:.8rem 1rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
        <span style="font-size:.74rem;color:var(--muted)">Последние видео @Dan4ik37Yt</span>
        <a href="https://www.youtube.com/@Dan4ik37Yt" target="_blank" class="yt-sub" style="font-size:.72rem;padding:.45rem 1rem">▶ Открыть канал</a>
      </div>
    </div>`;
}


// ═══════════════════════════════════════
//  RENDER VIDEOS
// ═══════════════════════════════════════
function renderVids(vids){
  const grid=document.getElementById('yt-grid');
  grid.innerHTML='';
  grid.className='video-grid'+(viewMode==='list'?' list-view':'');
  updateMoreBtn();
  if(!vids.length){grid.innerHTML=`<div class="empty-state"><span class="empty-state-icon">🎬</span><div class="empty-state-title">Видео не найдены</div><div class="empty-state-text">Пока ничего не загрузилось — возможно, YouTube временно недоступен. Попробуй обновить страницу.</div></div>`;return}
  vids.forEach((v,i)=>{
    if(!v.id)return;
    const liked=likedIds.has(v.id),sel=selectedIds.has(v.id),watched=watchedIds.has(v.id);
    const card=document.createElement('div');
    card.className='vcard'+(selMode?' selectable':'')+(sel?' selected':'');
    card.dataset.id=v.id;card.style.animationDelay=(i*.04)+'s';
    card.innerHTML=`
      <div class="sel-check">${sel?'✓':''}</div>
      ${v.rec?'<div class="rec-badge">🔥 Рекомендация</div>':''}
      <div class="vthumb">
        ${v.thumb?`<img src="${esc(v.thumb)}" alt="${esc(v.title)}" loading="lazy">`:'<div class="vthumb-ph">▶</div>'}
        <div class="pdot pd-yt">YT</div>
        ${v.duration?`<div class="vduration">${v.duration}</div>`:''}
        ${watched?'<div class="vwatched" title="Просмотрено">✓ Просмотрено</div>':''}
        <div class="play-ov"><div class="play-circle">▶</div></div>
        <button class="vlike${liked?' liked':''}" onclick="toggleLike(event,'${v.id}',this)" title="${liked?'Убрать лайк':'Лайкнуть на YouTube'}">
          ${liked?'❤':'🤍'}${v.likes?' '+v.likes:''}
        </button>
      </div>
      <div class="vinfo">
        <a class="vtitle" href="/v/${v.id}">${esc(v.title)}</a>
        <div class="vmeta">${v.views?`<span>👁 ${v.views}</span>`:''}${v.date?`<span>📅 ${v.date}</span>`:''}</div>
      </div>`;
    card.addEventListener('click',e=>{
      if(e.target.closest('.vlike'))return;
      // Название — настоящая ссылка на /v/<id> (для поисковиков и «открыть в новой вкладке»);
      // обычный клик по-прежнему открывает видео в окне на месте
      const a=e.target.closest('a.vtitle');
      if(a&&(e.ctrlKey||e.metaKey||e.shiftKey||e.button===1))return;
      e.preventDefault();
      if(selMode){toggleSel2(card,v.id)}else openVid(v.id,v.title,v.date,v.views)
    });
    grid.appendChild(card);
  });
}

// ═══════════════════════════════════════
//  VIEW MODES
// ═══════════════════════════════════════
function setView(mode){
  viewMode=mode;
  const btn=document.getElementById('viewToggleBtn');
  if(btn) btn.innerHTML = mode==='grid' ? '⊞ Сетка' : '≡ Список';
  if (allVids.length) renderVids(getVisibleVids());
}
function toggleViewMode(){ setView(viewMode==='grid' ? 'list' : 'grid'); }

// Старое имя — на случай внешних вызовов (хоткеи, консоль)
function shuffleVids(){ setVidSort('rand'); }

// ═══════════════════════════════════════
//  LIKES — открывает реальный YouTube
// ═══════════════════════════════════════
function toggleLike(e,id,btn){
  e.stopPropagation();
  const v=allVids.find(x=>x.id===id);
  if(likedIds.has(id)){likedIds.delete(id);btn.classList.remove('liked');btn.innerHTML='🤍'+(v?.likes?' '+v.likes:'')}
  else{likedIds.add(id);btn.classList.add('liked','like-pop');btn.innerHTML='❤'+(v?.likes?' '+v.likes:'');setTimeout(()=>btn.classList.remove('like-pop'),400);
    // Открываем YouTube для реального лайка
    window.open(`https://www.youtube.com/watch?v=${id}`,`_ytlike_${id}`,'width=900,height=600,scrollbars=yes');
  }
  try{localStorage.setItem('d37_liked',JSON.stringify([...likedIds]))}catch(e){}
}
