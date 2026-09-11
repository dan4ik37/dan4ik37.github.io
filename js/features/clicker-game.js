// ═══════════════════════════════════════
//  КЛИКЕР ИГРА
// ═══════════════════════════════════════
let clickScore=parseInt(localStorage.getItem('d37_click_score')||0);
let clickBest=parseInt(localStorage.getItem('d37_click_best')||0);
let clickMulti=1,clickComboCount=0,lastClickTime=0,cpsClicks=[],clickIcons=['▶','🎮','🔥','💥','⭐','🏆'];

function doClick(e){
  const now=Date.now();
  // Комбо
  if(now-lastClickTime<300){clickComboCount++;if(clickComboCount>4){clickMulti=Math.min(Math.floor(clickComboCount/5)+1,8)}}else{clickComboCount=0;clickMulti=1}
  lastClickTime=now;
  clickScore+=clickMulti;
  cpsClicks.push(now);
  if(clickScore>clickBest){clickBest=clickScore;localStorage.setItem('d37_click_best',clickBest)}
  localStorage.setItem('d37_click_score',clickScore);
  // Обновляем UI
  document.getElementById('clickScore').textContent=fmt(clickScore);
  document.getElementById('clickBest').textContent=fmt(clickBest);
  document.getElementById('clickMulti').textContent='×'+clickMulti;
  if(clickMulti>1){document.getElementById('clickCombo').textContent='🔥 КОМБО ×'+clickMulti+'!'}
  else{document.getElementById('clickCombo').textContent=''}
  // Меняем иконку случайно
  if(Math.random()<.15){document.getElementById('clickTarget').textContent=clickIcons[Math.floor(Math.random()*clickIcons.length)]}
  // Поп-текст
  spawnClickPop(e,'+'+clickMulti);
  // Звук (тихий)
  try{makeOsc('sine',440+clickScore%200,0,.08,.15)}catch(e){}
  // CPS обновляем каждые 500мс
}
setInterval(()=>{
  const now=Date.now();
  cpsClicks=cpsClicks.filter(t=>now-t<1000);
  document.getElementById('clickCps').textContent=cpsClicks.length;
},500);

function spawnClickPop(e,text){
  const pop=document.createElement('div');
  pop.className='click-pop';pop.textContent=text;
  const wrap=document.getElementById('clickerWrap');
  const rect=wrap.getBoundingClientRect();
  pop.style.left=(e.clientX-rect.left)+'px';
  pop.style.top=(e.clientY-rect.top)+'px';
  wrap.appendChild(pop);
  setTimeout(()=>pop.remove(),700);
}
function resetClicker(){
  clickScore=0;clickMulti=1;clickComboCount=0;
  localStorage.removeItem('d37_click_score');
  document.getElementById('clickScore').textContent='0';
  document.getElementById('clickCombo').textContent='';
  document.getElementById('clickMulti').textContent='×1';
  document.getElementById('clickCps').textContent='0';
  document.getElementById('clickTarget').textContent='▶';
}
