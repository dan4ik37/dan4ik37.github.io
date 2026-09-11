// ═══════════════════════════════════════
//  ПАСХАЛКА (5 кликов на аватарку)
// ═══════════════════════════════════════
let easterCount=0,easterTimer=null;
const EASTER_MSGS=['👀 ТЫ НАШЁЛ ПАСХАЛКУ!','🔥 DAN4IK37 FOREVER!','💀 ГГ НАЙДЕНО!','🎉 СЕКРЕТ РАСКРЫТ!'];

function easterClick(){
  easterCount++;
  clearTimeout(easterTimer);
  easterTimer=setTimeout(()=>easterCount=0,2000);
  // Лёгкая вибрация на телефоне
  navigator.vibrate&&navigator.vibrate(30);
  if(easterCount>=5){
    easterCount=0;
    triggerEaster();
  }
}

function triggerEaster(){
  const overlay=document.getElementById('easterOverlay');
  const msg=document.getElementById('easterMsg');
  // Случайные цвета
  const colors=['rgba(255,45,85,.25)','rgba(145,71,255,.25)','rgba(41,182,246,.2)','rgba(255,107,53,.22)'];
  overlay.style.background=colors[Math.floor(Math.random()*colors.length)];
  overlay.style.boxShadow='inset 0 0 200px rgba(255,45,85,.3)';
  overlay.classList.add('active');
  msg.textContent=EASTER_MSGS[Math.floor(Math.random()*EASTER_MSGS.length)];
  msg.classList.add('show');
  // Взрыв частиц
  if(currentPerf==='high')spawnEasterParticles();
  // Звук
  synthTada();
  // Вибрация паттерн
  navigator.vibrate&&navigator.vibrate([100,50,100,50,200]);
  setTimeout(()=>{overlay.classList.remove('active');msg.classList.remove('show')},3000);
}

function spawnEasterParticles(){
  const container=document.getElementById('particles');
  const av=document.getElementById('easterAvatar');
  const rect=av.getBoundingClientRect();
  for(let i=0;i<30;i++){
    const p=document.createElement('div');
    const angle=Math.random()*Math.PI*2,speed=Math.random()*200+80;
    const colors=['#ff2d55','#ff6b35','#9147ff','#29b6f6','#f5a623'];
    p.style.cssText=`position:fixed;left:${rect.left+rect.width/2}px;top:${rect.top+rect.height/2}px;width:${Math.random()*8+4}px;height:${Math.random()*8+4}px;border-radius:50%;background:${colors[Math.floor(Math.random()*colors.length)]};pointer-events:none;z-index:9502;transition:all ${Math.random()*.8+.4}s ease-out;`;
    document.body.appendChild(p);
    setTimeout(()=>{p.style.left=(rect.left+rect.width/2+Math.cos(angle)*speed)+'px';p.style.top=(rect.top+rect.height/2+Math.sin(angle)*speed)+'px';p.style.opacity='0';p.style.transform='scale(0)'},10);
    setTimeout(()=>p.remove(),1200);
  }
}
