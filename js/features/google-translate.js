// ═══════════════════════════════════════
//  GOOGLE TRANSLATE
// ═══════════════════════════════════════
const LANGS=[['af','Afrikaans'],['sq','Shqip'],['am','አማርኛ'],['ar','العربية'],['hy','Հայերեն'],['az','Azərbaycan'],['eu','Euskara'],['be','Беларуская'],['bn','বাংলা'],['bs','Bosanski'],['bg','Български'],['ca','Català'],['ceb','Cebuano'],['zh-CN','中文(简体)'],['zh-TW','中文(繁體)'],['co','Corsu'],['hr','Hrvatski'],['cs','Čeština'],['da','Dansk'],['nl','Nederlands'],['en','English'],['eo','Esperanto'],['et','Eesti'],['fi','Suomi'],['fr','Français'],['fy','Frysk'],['gl','Galego'],['ka','ქართული'],['de','Deutsch'],['el','Ελληνικά'],['gu','ગુજરાતી'],['ht','Kreyòl ayisyen'],['ha','Hausa'],['haw','ʻŌlelo Hawaiʻi'],['iw','עברית'],['hi','हिन्दी'],['hmn','Hmoob'],['hu','Magyar'],['is','Íslenska'],['ig','Igbo'],['id','Bahasa Indonesia'],['ga','Gaeilge'],['it','Italiano'],['ja','日本語'],['jw','Basa Jawa'],['kn','ಕನ್ನಡ'],['kk','Қазақша'],['km','ភាសាខ្មែរ'],['ko','한국어'],['ku','Kurdî'],['ky','Кыргызча'],['lo','ພາສາລາວ'],['la','Latina'],['lv','Latviešu'],['lt','Lietuvių'],['lb','Lëtzebuergesch'],['mk','Македонски'],['mg','Malagasy'],['ms','Bahasa Melayu'],['ml','മലയാളം'],['mt','Malti'],['mi','Te Reo Māori'],['mr','मराठी'],['mn','Монгол'],['my','မြန်မာဘာသာ'],['ne','नेपाली'],['no','Norsk'],['ny','Chichewa'],['ps','پښتو'],['fa','فارسی'],['pl','Polski'],['pt','Português'],['pa','ਪੰਜਾਬੀ'],['ro','Română'],['ru','Русский'],['sm','Gagana Samoa'],['gd','Gàidhlig'],['sr','Српски'],['st','Sesotho'],['sn','ChiShona'],['sd','سنڌي'],['si','සිංහල'],['sk','Slovenčina'],['sl','Slovenščina'],['so','Soomaali'],['es','Español'],['su','Basa Sunda'],['sw','Kiswahili'],['sv','Svenska'],['tl','Filipino'],['tg','Тоҷикӣ'],['ta','தமிழ்'],['te','తెలుగు'],['th','ภาษาไทย'],['tr','Türkçe'],['uk','Українська'],['ur','اردو'],['uz','O\'zbek'],['vi','Tiếng Việt'],['cy','Cymraeg'],['xh','isiXhosa'],['yi','ייִדיש'],['yo','Yorùbá'],['zu','isiZulu']];
let curLang='ru';

function buildLangList(){
  const list=document.getElementById('langList');list.innerHTML='';
  LANGS.forEach(([code,name])=>{const b=document.createElement('button');b.className='lang-opt'+(code===curLang?' active':'');b.dataset.code=code;b.dataset.name=name;b.textContent=name;b.onclick=()=>selectLang(code);list.appendChild(b)});
}
function filterLangs(q){document.querySelectorAll('#langList .lang-opt').forEach(b=>{b.style.display=b.dataset.name.toLowerCase().includes(q.toLowerCase())||b.dataset.code.includes(q)?'block':'none'})}
function toggleLang(e){e.stopPropagation();const dd=document.getElementById('langDropdown');if(!dd.querySelector('button'))buildLangList();dd.classList.toggle('open');if(dd.classList.contains('open'))setTimeout(()=>dd.querySelector('.lang-search')?.focus(),50)}
document.addEventListener('click',e=>{if(!document.getElementById('langWrap').contains(e.target))document.getElementById('langDropdown').classList.remove('open')});

function selectLang(code){
  curLang=code;document.getElementById('langDropdown').classList.remove('open');
  document.getElementById('langLabel').textContent=code.split('-')[0].toUpperCase();
  document.querySelectorAll('#langList .lang-opt').forEach(b=>b.classList.toggle('active',b.dataset.code===code));
  if(code==='ru'){document.cookie='googtrans=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/';document.cookie='googtrans=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/;domain=.'+HOST;location.reload();return}
  const v='/ru/'+code;document.cookie='googtrans='+v+';path=/';document.cookie='googtrans='+v+';path=/;domain=.'+HOST;
  function tryTranslate(){const sel=document.querySelector('.goog-te-combo');if(sel){sel.value=code;sel.dispatchEvent(new Event('change',{bubbles:true}));return true}if(window.doGTranslate){window.doGTranslate('ru|'+code);return true}return false}
  if(!tryTranslate()){let n=0;const t=setInterval(()=>{n++;if(tryTranslate()||n>20)clearInterval(t)},300)}
}
window.addEventListener('load',()=>{const m=document.cookie.match(/googtrans=\/ru\/([^;]+)/);if(m){curLang=m[1];document.getElementById('langLabel').textContent=m[1].split('-')[0].toUpperCase()}});
