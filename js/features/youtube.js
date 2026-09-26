function countUp(id,t){
  const el=document.getElementById(id);if(!el)return;
  el.classList.remove('skeleton');

  let c=0,s=t/80;
  const tm=setInterval(()=>{c=Math.min(c+s,t);el.textContent=fmt(Math.round(c));if(c>=t){clearInterval(tm)}},18);
}
function statsLoaded(){
  const note=document.getElementById('statsNote');
  if(note) note.innerHTML='✅ Статистика обновлена · <span style="opacity:.5">'+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+'</span>';
}
function statsError(){
  const note=document.getElementById('statsNote');
  if(note) note.innerHTML='⚠️ Статистика недоступна — API работает только на хостинге. <a href="https://www.youtube.com/@Dan4ik37Yt" target="_blank" style="color:var(--yt)">Смотреть канал →</a>';
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
  return allVids.slice(0, vidCountLimit);
}
function filterVids(query){
  videoSearchQuery = query.trim().toLowerCase();
  const clearBtn = document.getElementById('videoSearchClear');
  if (clearBtn) clearBtn.style.display = videoSearchQuery ? 'flex' : 'none';
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
  if (allVids.length) {
    if (videoSearchQuery) { filterVids(document.getElementById('videoSearchInput')?.value || ''); return; }
    // Перемешиваем и показываем нужное кол-во
    const shuffled = [...allVids].sort(() => Math.random() - 0.5);
    renderVids(shuffled.slice(0, vidCountLimit));
  }
}

async function loadYT(){
  showLoader();
  const cached=loadCache();
  if(cached){
    allVids=cached.vids||[];
    recVids=cached.rec||[];
    if(cached.stats){countUp('s-subs',cached.stats.subs);countUp('s-views',cached.stats.views);countUp('s-vids',cached.stats.vids)}
    if(allVids.length){
      const shuffled=[...allVids];
      for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
      renderVids(shuffled.slice(0,vidCountLimit));
    } else { showFallback(); }
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

    // Грузим ВСЕ 50 видео сразу + топ по просмотрам
    const [pl, pop] = await Promise.all([
      ytFetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploads}&maxResults=50&key=${YT_KEY}`),
      ytFetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=viewCount&maxResults=12&type=video&key=${YT_KEY}`)
    ]);
    if(!pl?.items?.length) throw new Error('Видео не найдены');

    const ids=pl.items.map(i=>i.contentDetails.videoId).join(',');
    const det=await ytFetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${ids}&key=${YT_KEY}`);
    const dm={};det?.items?.forEach(v=>{dm[v.id]={stats:v.statistics,duration:v.contentDetails?.duration}});

    const rawVids=pl.items.map(item=>{
      const id=item.contentDetails.videoId,sn=item.snippet,d=dm[id]||{},st=d.stats||{};
      return{id,title:sn.title,thumb:sn.thumbnails?.high?.url||'',date:new Date(sn.publishedAt).toLocaleDateString('ru-RU'),views:st.viewCount?fmt(st.viewCount):'',likes:st.likeCount?fmt(st.likeCount):'',duration:formatYtDuration(d.duration)};
    });

    // Сохраняем все 50, перемешиваем по-настоящему (Fisher-Yates)
    allVids = rawVids;
    for(let i=allVids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[allVids[i],allVids[j]]=[allVids[j],allVids[i]];}

    recVids=pop?.items?.map(i=>({id:i.id.videoId,title:i.snippet.title,thumb:i.snippet.thumbnails?.high?.url||'',date:'',views:'',likes:'',rec:true}))||[];

    saveCache({vids:rawVids,rec:recVids,stats:st});
    renderVids(allVids.slice(0,vidCountLimit));
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
        <div class="vtitle">${esc(v.title)}</div>
        <div class="vmeta">${v.views?`<span>👁 ${v.views}</span>`:''}${v.date?`<span>📅 ${v.date}</span>`:''}</div>
      </div>`;
    card.addEventListener('click',e=>{if(e.target.closest('.vlike'))return;if(selMode){toggleSel2(card,v.id)}else openVid(v.id,v.title,v.date,v.views)});
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

// ═══════════════════════════════════════
//  RECOMMENDATIONS + SHUFFLE
// ═══════════════════════════════════════
let showingRec=false;
function shuffleVids(){
  const b=document.getElementById('shuffleBtn');
  clearVideoSearch(); // шафл переключает между recVids/allVids — с активным поиском комбинация неоднозначна
  if(recVids.length && !showingRec){
    showingRec=true;
    renderVids(recVids.slice(0,vidCountLimit));
    b.innerHTML='🔥 Топ видео';b.style.color='var(--accent)';
  } else {
    showingRec=false;
    // Fisher-Yates shuffle
    const shuffled=[...allVids];
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    renderVids(shuffled.slice(0,vidCountLimit));
    b.innerHTML='✓ Перемешано!';b.style.color='';
    setTimeout(()=>b.innerHTML='🔀 Перемешать',1400);
  }
}

// ═══════════════════════════════════════
//  LIKES — открывает реальный YouTube
// ═══════════════════════════════════════
function toggleLike(e,id,btn){
  e.stopPropagation();
  const v=allVids.find(x=>x.id===id)||recVids.find(x=>x.id===id);
  if(likedIds.has(id)){likedIds.delete(id);btn.classList.remove('liked');btn.innerHTML='🤍'+(v?.likes?' '+v.likes:'')}
  else{likedIds.add(id);btn.classList.add('liked','like-pop');btn.innerHTML='❤'+(v?.likes?' '+v.likes:'');setTimeout(()=>btn.classList.remove('like-pop'),400);
    // Открываем YouTube для реального лайка
    window.open(`https://www.youtube.com/watch?v=${id}`,`_ytlike_${id}`,'width=900,height=600,scrollbars=yes');
  }
  try{localStorage.setItem('d37_liked',JSON.stringify([...likedIds]))}catch(e){}
}
