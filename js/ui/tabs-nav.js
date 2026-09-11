// ═══════════════════════════════════════
//  NAV
// ═══════════════════════════════════════
function toggleNav(){const nav=document.getElementById('navLinks'),b=document.getElementById('burger');nav.classList.toggle('open');b.classList.toggle('open');b.setAttribute('aria-expanded', nav.classList.contains('open'))}
document.querySelectorAll('.nav-links a').forEach(a=>a.addEventListener('click',()=>{document.getElementById('navLinks').classList.remove('open');document.getElementById('burger').classList.remove('open')}));
window.addEventListener('scroll',()=>document.getElementById('nav').classList.toggle('scrolled',scrollY>40));

// ═══════════════════════════════════════
//  SELECT MODE
// ═══════════════════════════════════════
function toggleSel(){selMode=true;selectedIds.clear();document.getElementById('selBtn').style.display='none';document.getElementById('likeSelBtn').style.display='inline-flex';document.getElementById('playSelBtn').style.display='inline-flex';document.getElementById('cancelSelBtn').style.display='inline-flex';document.getElementById('selHint').style.display='flex';document.getElementById('ytOverflowMenu')?.classList.remove('open');renderVids(getVisibleVids())}
function cancelSel(){selMode=false;selectedIds.clear();document.getElementById('selBtn').style.display='inline-flex';document.getElementById('likeSelBtn').style.display='none';document.getElementById('playSelBtn').style.display='none';document.getElementById('cancelSelBtn').style.display='none';document.getElementById('selHint').style.display='none';document.getElementById('multiPlayer').style.display='none';renderVids(getVisibleVids())}
function toggleYtOverflow(e){e.stopPropagation();document.getElementById('ytOverflowMenu')?.classList.toggle('open')}
document.addEventListener('click',e=>{const m=document.getElementById('ytOverflowMenu');if(m&&m.classList.contains('open')&&!e.target.closest('#ytOverflow'))m.classList.remove('open')});
function toggleSel2(card,id){if(selectedIds.has(id)){selectedIds.delete(id);card.classList.remove('selected');card.querySelector('.sel-check').textContent=''}else{selectedIds.add(id);card.classList.add('selected');card.querySelector('.sel-check').textContent='✓'}document.getElementById('selCount').textContent=selectedIds.size}
function selectAllVids(){getVisibleVids().forEach(v=>selectedIds.add(v.id));renderVids(getVisibleVids());document.getElementById('selCount').textContent=selectedIds.size}
function likeSelected(){if(!selectedIds.size)return;selectedIds.forEach(id=>{if(!likedIds.has(id)){likedIds.add(id);window.open(`https://www.youtube.com/watch?v=${id}`,`_ytlike_${id}`,'width=900,height=600')}});try{localStorage.setItem('d37_liked',JSON.stringify([...likedIds]))}catch(e){}}
function playSelected(){
  const ids=[...selectedIds];if(!ids.length)return;
  const mp=document.getElementById('multiPlayer');
  mp.innerHTML=`<div class="mp-bar"><span>▶ ${ids.length} видео</span><button class="mp-close" onclick="this.closest('#multiPlayer').style.display='none';this.closest('#multiPlayer').innerHTML=''">✕ Закрыть</button></div><div class="mp-grid">${ids.map(id=>{const v=allVids.find(x=>x.id===id);return`<div class="mp-item"><div class="mp-ratio"><iframe src="https://www.youtube.com/embed/${id}?rel=0" allowfullscreen allow="encrypted-media"></iframe></div><div class="mp-title">${esc(v?.title||id)}</div></div>`}).join('')}</div>`;
  mp.style.display='block';mp.scrollIntoView({behavior:'smooth'});cancelSel();
}

// ═══════════════════════════════════════
//  TABS
// ═══════════════════════════════════════
const tabMap={yt:'a-yt',tw:'a-tw'};
function switchTab(p,btn){
  document.querySelectorAll('.tab').forEach(t=>t.className='tab');
  btn.classList.add(tabMap[p]||'a-yt');
  document.querySelectorAll('.panel').forEach(el=>el.classList.remove('active'));
  document.getElementById('panel-'+p).classList.add('active');
  const sb=document.getElementById('shuffleBtn');
  sb.style.opacity=p==='yt'?'1':'0.3';
  sb.style.pointerEvents=p==='yt'?'auto':'none';
  if(p==='tw'){
    const fr=document.getElementById('twitchFrame');
    if(!fr.src) fr.src=`https://player.twitch.tv/?channel=${TWITCH}&parent=${HOST}&autoplay=false`;
  }
}
