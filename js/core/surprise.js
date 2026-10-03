// ═══════════════════════════════════════
//  «🎲 УДИВИ МЕНЯ» — случайный ролик из всего архива канала
// ═══════════════════════════════════════
// Один файл и для SPA (index.html), и для серверных страниц (/videos, /v/<id>, /topic/…).
// Список id — /api/ids (кэш CDN 6 ч, квоту YouTube не тратит). Недавно выпавшие (последние 50)
// не повторяются — localStorage. Нет списка (локально /api не работает) — берём allVids с главной.
(() => {
  let ids = null;
  async function load(){
    if (ids) return ids;
    try {
      const r = await fetch('/api/ids');
      if (r.ok) { const d = await r.json(); if (d.ids) return (ids = d.ids.match(/.{11}/g)); }
    } catch (e) {}
    if (typeof allVids !== 'undefined' && allVids?.length) return allVids.map(v => v.id);
    return [];
  }
  window.d37Surprise = async function(btn){
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '🎲 Выбираю…'; }
    const list = await load();
    if (!list.length) { location.href = '/videos'; return; }
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem('d37_surprise_seen')) || []; } catch (e) {}
    let id, tries = 0;
    do id = list[Math.floor(Math.random() * list.length)]; while (seen.includes(id) && ++tries < 20);
    try { localStorage.setItem('d37_surprise_seen', JSON.stringify([id, ...seen].slice(0, 50))); } catch (e) {}
    if (typeof window.va === 'function') window.va('event', { name: 'surprise_me' });
    location.href = '/v/' + id;
    if (btn) setTimeout(() => { btn.disabled = false; btn.innerHTML = old; }, 1500);
  };
})();
