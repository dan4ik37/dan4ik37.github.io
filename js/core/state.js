// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
// Общее состояние сайта — читается и меняется почти всеми остальными
// модулями. Должен грузиться РАНЬШЕ всех features/ и ui/, сразу после
// core/config.js (classic-скрипты без модулей — порядок в index.html
// имеет значение, см. ИНСТРУКЦИЮ и ПЛАН РАЗБИВКИ).
let allVids=[], recVids=[], viewMode='grid', selMode=false;
let selectedIds=new Set();
let likedIds=new Set(JSON.parse(localStorage.getItem('d37_liked')||'[]'));
let chatNick=localStorage.getItem('d37_nick')||'';
let channelId='';
