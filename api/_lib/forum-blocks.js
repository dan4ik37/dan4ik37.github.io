// api/_lib/forum-blocks.js — статьи форума 2.0 (T-157): блоки статьи — ДАННЫЕ, не HTML. ОДИН код для браузера и сервера:
//   браузер — копия js/features/forum-blocks.js (window.D37ForumBlocks): её собирает node scripts/make-forum-blocks.mjs из
//   makeForumBlocks.toString() (руками не править; тест forum-test.cjs сверяет); сервер — api/_lib/routes/forum.js (страницы для поиска).
// Правда — на сервере базы (forum.sql, forum_check): здесь та же проверка ради подсказок в редакторе, тест сверяет причины.
// Поэтому makeForumBlocks — без ссылок наружу, только ES2018 без lookbehind.
// Блоки:
//   {t:'p', r:[{x:'текст', b:1?, i:1?, h:'https://…'?}]}  {t:'h', x, l:2|3}  {t:'list', o:0|1, items:['…']}  {t:'quote', x, by?}
//   {t:'img', src:'<uid>/<имя>.webp|jpg', w?, h?, cap?}  {t:'video', p:'yt'|'vk'|'rt'|'tw', id, cap?}
//   {t:'file', key:'<uid>/<имя>.<ext>', name, size, mime}  {t:'hr'}
export function makeForumBlocks(){
  'use strict';
  const L = { blocks: 60, para: 5000, runs: 200, head: 200, items: 30, item: 500, quote: 2000, by: 120, cap: 300, title: 140, titleMin: 5,
    tags: 5, total: 40000, imgs: 20, vids: 10, files: 5, srcTitle: 140, url: 500, fname: 120, comment: 4000 };
  const VIDEO = {
    yt: { name: 'YouTube', re: /^[A-Za-z0-9_-]{11}$/ },
    vk: { name: 'VK Видео', re: /^-?[0-9]{1,12}_[0-9]{1,12}$/ },
    rt: { name: 'RuTube', re: /^[0-9a-f]{32}$/ },
    tw: { name: 'Twitch', re: /^(v[0-9]{5,12}|c:[A-Za-z0-9_-]{4,100})$/ },
  };
  // Причины отказа (forum.sql) → текст для человека
  const REASON = {
    auth: 'Войди, чтобы писать статьи', u9: '👀 Писать на форуме можно с 9 лет — пока можно читать и ставить оценки', muted: 'Тебя заглушили в чате — на форуме пока тоже нельзя',
    too_fast: 'Слишком часто — подожди немного', day_limit: 'На сегодня хватит — завтра снова можно', not_found: 'Статья не найдена или скрыта', not_yours: 'Это не твоя статья',
    hidden: 'Статью скрыл модератор — изменить её нельзя', locked: 'Статья закрыта', doc: 'Не получилось прочитать статью', too_big: 'Статья слишком большая',
    title_long: 'Заголовок длиннее 140 знаков', title_short: 'Заголовок — хотя бы 5 знаков', bad: 'Есть грубые слова — убери их', blocks: 'Не получилось прочитать блоки',
    blocks_many: 'Больше 60 блоков — раздели на две статьи', block: 'Блок испорчен', block_type: 'Такого блока нет', link: 'Ссылка — только https://… (без логинов и пробелов)',
    text_long: 'Слишком длинный текст в блоке', media_off: 'Картинки и файлы пока выключены — включит владелец сайта', media_key: 'Картинка или файл не твои',
    media_type: 'Такой тип файла нельзя', media_missing: 'Файл не загрузился — добавь заново', media_size: 'Файл слишком большой', file_name: 'Неправильное имя файла',
    video: 'Видео — только ссылкой на YouTube, VK Видео, RuTube или Twitch', media_many: 'Слишком много картинок, видео или файлов', too_long: 'Статья длиннее 40 000 знаков',
    empty: 'Напиши хоть пару предложений или добавь фото / видео', tag: 'Метка — 2–24 буквы или цифры, без пробелов', tags_many: 'Не больше 5 меток',
    source: 'Источник — ссылка https://… и название до 140 знаков', own: 'Свою статью оценить нельзя', not_published: 'Статья ещё на проверке',
    parent: 'Такого ответа уже нет', link_new: 'Ссылки — после первых проверенных статей', too_old: 'Править можно только в первые сутки', limit: 'Достигнут предел',
    mod: 'Только для модераторов', kind: 'Ошибка запроса', age: 'Эта статья — для тех, кто старше', action: 'Ошибка запроса',
  };
  const reason = r => REASON[r] || 'Не получилось — попробуй ещё раз';
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = v => (typeof v === 'string' ? v.replace(/\r/g, '').replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : null);
  const len = s => Array.from(s).length;   // как char_length в Postgres (по символам)
  const HTTPS = /^https:\/\/[a-zA-Z0-9а-яА-ЯёЁ.-]+\.[a-zA-Zа-яА-ЯёЁ]{2,}(:[0-9]{2,5})?([/?#][^\s<>"'`\\]*)?$/;
  const https = u => typeof u === 'string' && u.length >= 12 && u.length <= L.url && HTTPS.test(u) && !/^https:\/\/[^/]*@/.test(u);
  const videoOk = (p, id) => !!(VIDEO[p] && typeof id === 'string' && VIDEO[p].re.test(id));
  const KEY_IMG = /^[0-9a-f-]{36}\/[a-z0-9]{16,40}\.(webp|jpg)$/, KEY_FILE = /^[0-9a-f-]{36}\/[a-z0-9]{16,40}\.([a-z0-9]{2,5})$/;

  // Ссылка на ролик → { p, id } (только разрешённые сайты; код вставки не принимаем — только адрес)
  function parseVideo(raw){
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const h = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, ''), parts = u.pathname.split('/').filter(Boolean);
    const out = (p, id) => (videoOk(p, id) ? { p, id } : null);
    if (h === 'youtu.be') return out('yt', parts[0] || '');
    if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') {
      if (parts[0] === 'watch') return out('yt', u.searchParams.get('v') || '');
      if (['shorts', 'embed', 'live', 'v'].indexOf(parts[0]) >= 0) return out('yt', parts[1] || '');
      return null;
    }
    if (h === 'vk.com' || h === 'vkvideo.ru' || h === 'vk.ru') {
      if (/video_ext\.php$/.test(u.pathname)) return out('vk', (u.searchParams.get('oid') || '') + '_' + (u.searchParams.get('id') || ''));
      const z = u.searchParams.get('z') || '';
      const m = (z.match(/(?:video|clip)(-?\d+_\d+)/) || (parts[parts.length - 1] || '').match(/^(?:video|clip)(-?\d+_\d+)$/));
      return m ? out('vk', m[1]) : null;
    }
    if (h === 'rutube.ru') {
      const i = parts.findIndex(x => /^[0-9a-f]{32}$/.test(x));
      return i >= 0 ? out('rt', parts[i]) : null;
    }
    if (h === 'clips.twitch.tv') return parts[0] === 'embed' ? out('tw', 'c:' + (u.searchParams.get('clip') || '')) : out('tw', 'c:' + (parts[0] || ''));
    if (h === 'twitch.tv') {
      if (parts[0] === 'videos') return out('tw', 'v' + (parts[1] || ''));
      if (parts[1] === 'clip') return out('tw', 'c:' + (parts[2] || ''));
      return null;
    }
    return null;
  }
  // Адрес встроенного плеера (только после нажатия; iframe с sandbox) и картинка-заставка
  function embedUrl(v, parent){
    if (!v || !videoOk(v.p, v.id)) return '';
    const host = String(parent || 'dan4ik37.vercel.app').replace(/[^a-z0-9.-]/gi, '');
    if (v.p === 'yt') return 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0';
    if (v.p === 'vk') { const m = v.id.split('_'); return 'https://vkvideo.ru/video_ext.php?oid=' + m[0] + '&id=' + m[1] + '&hd=2&autoplay=1'; }
    if (v.p === 'rt') return 'https://rutube.ru/play/embed/' + v.id + '?autoplay=1';
    if (v.p === 'tw') return v.id.indexOf('c:') === 0 ? 'https://clips.twitch.tv/embed?clip=' + v.id.slice(2) + '&parent=' + host + '&autoplay=true'
      : 'https://player.twitch.tv/?video=' + v.id + '&parent=' + host + '&autoplay=true';
    return '';
  }
  function watchUrl(v){
    if (!v || !videoOk(v.p, v.id)) return '';
    if (v.p === 'yt') return 'https://www.youtube.com/watch?v=' + v.id;
    if (v.p === 'vk') return 'https://vkvideo.ru/video' + v.id;
    if (v.p === 'rt') return 'https://rutube.ru/video/' + v.id + '/';
    return v.id.indexOf('c:') === 0 ? 'https://clips.twitch.tv/' + v.id.slice(2) : 'https://www.twitch.tv/videos/' + v.id.slice(1);
  }
  const poster = v => (v && v.p === 'yt' && videoOk(v.p, v.id) ? 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg' : '');
  const providerName = p => (VIDEO[p] ? VIDEO[p].name : '');
  const fileExt = k => ((String(k || '').match(/\.([a-z0-9]+)$/) || [])[1] || '');

  // Проверка статьи — как forum_check в forum.sql (те же причины). o: { publish, media, files: ['pdf',…], mod, cap }
  function check(doc, o){
    o = o || {};
    if (!isObj(doc)) return { ok: false, reason: 'doc' };
    const title = (str(doc.title) || '').trim();
    if (len(title) > L.title) return { ok: false, reason: 'title_long' };
    if (o.publish && len(title) < L.titleMin) return { ok: false, reason: 'title_short' };
    const blocks = doc.blocks == null ? [] : doc.blocks;
    if (!Array.isArray(blocks)) return { ok: false, reason: 'blocks' };
    if (blocks.length > L.blocks) return { ok: false, reason: 'blocks_many' };
    const out = []; let txt = '', links = 0, imgs = 0, vids = 0, files = 0, chars = 0, media = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], fail = r => ({ ok: false, reason: r, at: i });
      if (!isObj(b)) return fail('block');
      if (b.t === 'p') {
        if (!Array.isArray(b.r) || b.r.length > L.runs) return fail('block');
        const runs = []; let k = 0;
        for (const r of b.r) {
          const x = isObj(r) ? str(r.x) : null;
          if (!x) continue;
          k += len(x);
          const n = { x };
          if (r.b === 1 || r.b === true || r.b === '1') n.b = 1;
          if (r.i === 1 || r.i === true || r.i === '1') n.i = 1;
          if (r.h != null && r.h !== '') { if (!https(r.h)) return fail('link'); n.h = r.h; links++; }
          runs.push(n); txt += x;
        }
        if (k > L.para) return fail('text_long');
        if (!runs.length) continue;
        chars += k; txt += '\n'; out.push({ t: 'p', r: runs });
      } else if (b.t === 'h') {
        const x = (str(b.x) || '').trim(); if (!x) continue;
        if (len(x) > L.head) return fail('text_long');
        chars += len(x); txt += x + '\n'; out.push({ t: 'h', x, l: String(b.l) === '3' ? 3 : 2 });
      } else if (b.t === 'list') {
        if (!Array.isArray(b.items) || b.items.length > L.items) return fail('block');
        const items = [];
        for (const it of b.items) { const x = (str(it) || '').trim(); if (!x) continue; if (len(x) > L.item) return fail('text_long'); items.push(x); chars += len(x); txt += '• ' + x + '\n'; }
        if (!items.length) continue;
        out.push({ t: 'list', o: b.o === 1 || b.o === true || b.o === '1' ? 1 : 0, items });
      } else if (b.t === 'quote') {
        const x = (str(b.x) || '').trim(), by = (str(b.by) || '').trim(); if (!x) continue;
        if (len(x) > L.quote || len(by) > L.by) return fail('text_long');
        chars += len(x); txt += '«' + x + '»\n'; const n = { t: 'quote', x }; if (by) n.by = by; out.push(n);
      } else if (b.t === 'img') {
        if (!o.media) return fail('media_off');
        if (typeof b.src !== 'string' || !KEY_FILE.test(b.src) || (o.uid && b.src.indexOf(o.uid + '/') !== 0)) return fail('media_key');
        if (!KEY_IMG.test(b.src)) return fail('media_type');
        const cap = (str(b.cap) || '').trim(); if (len(cap) > L.cap) return fail('text_long');
        imgs++; media++; const n = { t: 'img', src: b.src };
        if (/^[0-9]{1,4}$/.test(String(b.w)) && /^[0-9]{1,4}$/.test(String(b.h))) { n.w = +b.w; n.h = +b.h; }
        if (cap) { n.cap = cap; txt += cap + '\n'; }
        out.push(n);
      } else if (b.t === 'video') {
        if (!videoOk(b.p, b.id)) return fail('video');
        const cap = (str(b.cap) || '').trim(); if (len(cap) > L.cap) return fail('text_long');
        vids++; const n = { t: 'video', p: b.p, id: b.id }; if (cap) n.cap = cap; out.push(n);
      } else if (b.t === 'file') {
        if (!o.media) return fail('media_off');
        if (typeof b.key !== 'string' || !KEY_FILE.test(b.key) || (o.uid && b.key.indexOf(o.uid + '/') !== 0)) return fail('media_key');
        if ((o.files || ['pdf', 'txt', 'zip']).indexOf(fileExt(b.key)) < 0) return fail('media_type');
        const name = (str(b.name) || '').trim();
        if (!name || len(name) > L.fname || /[/\\<>]/.test(name)) return fail('file_name');
        files++; media++;
        out.push({ t: 'file', key: b.key, name, size: /^[0-9]{1,10}$/.test(String(b.size)) ? +b.size : 0, mime: String(b.mime || '').slice(0, 80) });
      } else if (b.t === 'hr') out.push({ t: 'hr' });
      else return fail('block_type');
    }
    if (imgs > L.imgs || vids > L.vids || files > L.files) return { ok: false, reason: 'media_many' };
    if (chars > L.total) return { ok: false, reason: 'too_long' };
    if (o.publish && chars < 20 && imgs + vids === 0) return { ok: false, reason: 'empty' };
    const tags = [];
    if (Array.isArray(doc.tags)) {
      for (const t0 of doc.tags) {
        const tg = (str(t0) || '').trim().replace(/^[#\s]+|[#\s]+$/g, '').toLowerCase();
        if (!tg) continue;
        if (!/^[a-zа-яё0-9][a-zа-яё0-9-]{1,23}$/.test(tg)) return { ok: false, reason: 'tag' };
        if (tags.indexOf(tg) < 0) tags.push(tg);
      }
      if (tags.length > L.tags) return { ok: false, reason: 'tags_many' };
    }
    let cover = typeof doc.cover === 'string' && doc.cover.trim() ? doc.cover.trim() : null;
    if (cover && !out.some(b => b.t === 'img' && b.src === cover)) cover = null;
    if (!cover) { const im = out.find(b => b.t === 'img'); cover = im ? im.src : null; }
    const src = typeof doc.source_url === 'string' && doc.source_url.trim() ? doc.source_url.trim() : null;
    const srcTitle = (str(doc.source_title) || '').trim();
    if (src && !https(src)) return { ok: false, reason: 'source' };
    if (len(srcTitle) > L.srcTitle) return { ok: false, reason: 'source' };
    if (src) links++;
    let age = [0, 6, 12, 16, 18].indexOf(+doc.age) >= 0 && doc.age !== '' && doc.age != null ? +doc.age : 12;
    if (age === 18 && !o.mod) age = 16;
    if (o.cap != null && age > o.cap && !o.mod) age = Math.max(0, o.cap);
    return { ok: true, title, blocks: out, text: txt, chars, links, media, videos: vids, excerpt: txt.trim().replace(/\s+/g, ' ').slice(0, 300),
      tags, cover, src, src_title: srcTitle || null, age };
  }
  // Обычный текст статьи (описание страницы, поиск)
  function toText(blocks){
    return (Array.isArray(blocks) ? blocks : []).map(b => !b ? '' : b.t === 'p' ? (b.r || []).map(r => (r && r.x) || '').join('')
      : b.t === 'h' || b.t === 'quote' ? b.x || '' : b.t === 'list' ? (b.items || []).join('\n') : b.cap || '').filter(Boolean).join('\n');
  }
  // Адрес статьи: /forum/<id>-<slug> (как forum_slug в forum.sql)
  function slug(t){
    const map = { 'ж': 'zh', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ю': 'yu', 'я': 'ya', 'ь': '' };
    const a = 'абвгдезийклмнопрстуфхцыэё', b = 'abvgdeziiklmnoprstufhcyee';
    let s = String(t || '').toLowerCase().split('').map(c => { const i = a.indexOf(c); return i >= 0 ? b[i] : c; }).join('');
    s = s.replace(/[жчшщюяь]/g, c => map[c]);
    return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/^-+|-+$/g, '');
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // HTML статьи для серверной страницы (роботы, превью). o.text(s) → безопасный HTML текста (по умолчанию esc),
  // o.media(key) → адрес картинки / файла; чужие ссылки — rel="nofollow ugc noopener". Никакого HTML из данных — только экранированный текст.
  function toHtml(blocks, o){
    o = o || {};
    const tx = o.text || esc, md = o.media || (() => '');
    const alt = x => tx(String(x || '')).replace(/<[^>]*>/g, '');   // подпись в alt — тот же фильтр текста (контакты, мат), без разметки; уже экранирована
    const a = (href, inner) => '<a href="' + esc(href) + '" rel="nofollow ugc noopener" target="_blank">' + inner + '</a>';
    return (Array.isArray(blocks) ? blocks : []).map(b => {
      if (!b) return '';
      if (b.t === 'p') return '<p>' + (b.r || []).map(r => {
        if (!r || typeof r.x !== 'string') return '';
        let s = tx(r.x).replace(/\n/g, '<br>');
        if (r.b) s = '<strong>' + s + '</strong>';
        if (r.i) s = '<em>' + s + '</em>';
        return r.h && https(r.h) ? a(r.h, s) : s;
      }).join('') + '</p>';
      if (b.t === 'h') return (b.l === 3 ? '<h3>' : '<h2>') + tx(b.x || '') + (b.l === 3 ? '</h3>' : '</h2>');
      if (b.t === 'list') { const tg = b.o ? 'ol' : 'ul'; return '<' + tg + '>' + (b.items || []).map(x => '<li>' + tx(String(x)) + '</li>').join('') + '</' + tg + '>'; }
      if (b.t === 'quote') return '<blockquote><p>' + tx(b.x || '').replace(/\n/g, '<br>') + '</p>' + (b.by ? '<footer>— ' + tx(b.by) + '</footer>' : '') + '</blockquote>';
      if (b.t === 'img') { const u = md(b.src); if (!u) return ''; const wh = b.w && b.h ? ' width="' + (+b.w) + '" height="' + (+b.h) + '"' : '';
        return '<figure><img src="' + esc(u) + '" alt="' + alt(b.cap) + '" loading="lazy" decoding="async"' + wh + '>' + (b.cap ? '<figcaption>' + tx(b.cap) + '</figcaption>' : '') + '</figure>'; }
      if (b.t === 'video') { const w = watchUrl(b), p = poster(b); if (!w) return '';
        return '<figure class="fa-video"><a href="' + esc(w) + '" rel="nofollow noopener" target="_blank">' + (p ? '<img src="' + esc(p) + '" alt="' + (b.cap ? alt(b.cap) : esc(providerName(b.p))) + '" loading="lazy" width="480" height="360">' : '')
          + '<span>▶ Смотреть на ' + esc(providerName(b.p)) + '</span></a>' + (b.cap ? '<figcaption>' + tx(b.cap) + '</figcaption>' : '') + '</figure>'; }
      if (b.t === 'file') { const u = md(b.key); if (!u) return '';
        return '<p class="fa-file">📎 <a href="' + esc(u + '?download=' + encodeURIComponent(b.name || 'file')) + '" rel="nofollow noopener" download>' + tx(b.name || 'файл') + '</a>' + (b.size ? ' <span>' + esc(fmtSize(b.size)) + '</span>' : '') + '</p>'; }
      if (b.t === 'hr') return '<hr>';
      return '';
    }).join('\n');
  }
  function fmtSize(n){ n = +n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
  // Дерево комментариев из плоского списка (parent) — порядок по времени, «сироты» — в корень
  function tree(list){
    const by = {}, roots = [];
    (list || []).forEach(c => { by[c.id] = Object.assign({}, c, { kids: [] }); });
    (list || []).forEach(c => { const n = by[c.id], p = c.parent != null && by[c.parent]; (p ? p.kids : roots).push(n); });
    return roots;
  }
  return { L, VIDEO, REASON, reason, https, videoOk, parseVideo, embedUrl, watchUrl, poster, providerName, check, toText, slug, toHtml, fmtSize, tree, fileExt };
}
