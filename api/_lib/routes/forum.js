// /forum, /forum/t/<метка>, /forum/<id>-<slug> — форум 2.0 (статьи из блоков, T-157); старый адрес /forum/<id> → 301 на /forum/<id>-<slug>;
// POST /api/forum-ping — IndexNow о новой статье; /ideas, /ideas/<id> — «Идеи для видео» (rewrites в vercel.json → api/pages.js?page=forum|ideas|forumping).
// Серверные страницы для поиска и превью ссылок (Telegram, ВК): заголовок, описание, canonical, JSON-LD (DiscussionForumPosting,
// ItemList, BreadcrumbList). Писать, отвечать и голосовать — в разделе сайта (SPA): кнопки ведут на /#/forum/<id> — роутер
// (js/ui/router.js) откроет раздел по тому же адресу /forum/<id>. Вкладка, где уже открыт сайт-приложение, сразу уходит в раздел
// (page({ spa }) в api/_lib/page.js) — перезагрузка не выкидывает из приложения.
// Текст игроков — только экранированный и через publicText(): чужие ссылки — «[ссылка]», телефоны, почта, @ники — «[скрыто]»,
// мат закрыт (как в чате для детей: страницу видит кто угодно, возраст сервер не знает). Реклама (T-157) — одно место в статье и одно
// в ленте, только у опубликованной статьи проверенного автора (прошёл предпроверку), без открытых жалоб и не старше 12+; на
// старой базе, у «на проверке» и скрытых страниц (их сервер вообще не отдаёт) — без рекламы. Данные — по service-ключу, только публичные поля (ник, роль);
// ник ребёнка до 13 — «Игрок» (age.sql: age_public_kids — сервер узнаёт только «прятать или нет», без возраста).
import { SITE, esc } from '../yt.js';
import { page, INDEX_DIET, FORUM_MIN_CHARS } from '../page.js';
import { sbSelect, sbRpc, sbPatch, storeConfigured, oldDb } from '../store.js';
import { makeForumBlocks } from '../forum-blocks.js';   // T-157: блоки статей — тот же код, что в браузере
import { indexNow } from '../indexnow.js';
import { publicKids as kidsOf, publicNick } from '../age.js';   // ники детей до 13 — «Игрок» (страницы индексирует поиск)
const publicKids = ids => kidsOf(ids, sbRpc, storeConfigured);

const num = n => Number(n || 0).toLocaleString('ru-RU');
const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
const ROLE = { admin: 'админ', moderator: 'модератор', helper: 'помощник' };
const day = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }); };
const iso = s => { const d = new Date(s); return isNaN(d) ? undefined : d.toISOString(); };

// ═══ Текст игроков на публичной странице ═══
// Мат — как P.clean в js/features/phone.js (тот же список, тест сверяет)
const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а' };
export const BAD = [
  /ху[йеёяюи]/u, /п[иеё]зд/u, /(?:^|[^\p{L}])бля(?!х)/u, /(?:^|[^\p{L}])(?:за|на|вы|у|от|по|до|про|раз|рас|съ|подъ|из|изъ|при|пере|недо)?[её]б(?:а|ал|ан|ат|ут|ну|ло|ли|л|ы|ош|уч|ен|ис|ыв|ыр|ет|ёт)/u,
  /(?:^|[^\p{L}])[её]б(?!\p{L})/u, /(?:^|[^\p{L}])сук(?:а+|и|е|у|ой|ин|ам)(?!\p{L})/u, /муда[кч]|мудил/u, /пид[ао]р|педик/u, /г[ао]нд[ао]н/u, /шлюх/u, /залуп/u, /дроч/u,
];
function mask(text){
  const chars = Array.from(String(text || ''));
  const low = chars.map(c => { const l = c.toLowerCase(); return l.length === 1 ? (LAT[l] || l) : c; }).join('');
  const s = chars.join('');
  if (low.length !== s.length) return s;
  const m = Array(low.length).fill(false);
  for (const re of BAD) { const g = new RegExp(re.source, 'gu'); let x; while ((x = g.exec(low))) { for (let i = x.index; i < x.index + x[0].length; i++) m[i] = true; if (!x[0].length) g.lastIndex++; } }
  let out = '', i = 0;
  while (i < s.length) {
    if (/\s/u.test(s[i])) { out += s[i++]; continue; }
    let j = i, bad = false;
    while (j < s.length && !/\s/u.test(s[j])) { if (m[j]) bad = true; j++; }
    out += bad ? '*'.repeat(Math.min(6, j - i)) : s.slice(i, j);
    i = j;
  }
  return out;
}
// Телефоны, почта, «скинь фото / где живёшь», @ники — как kidText в js/core/age.js (названия соцсетей — можно: на сайте стримера
// о его ВК и Telegram говорят постоянно; сами контакты и ссылки закрыты)
const HIDE = [
  /\+?\d(?:[\s\-().]{0,2}\d){6,}/g,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  /скинь\s*(?:фот\p{L}*|селфи)|где\s*(?:ты\s*)?жив[её]шь|(?:твой|дай|скажи|напиши)\s*(?:адрес|номер)/giu,
  /@[\p{L}\p{N}_.]{3,}/gu,
];
const OWN = /^(?:https?:\/\/)?(?:www\.)?dan4ik37\.vercel\.app(\/(?![\/\\])[^\s<>"']*)?$/i;   // «…app//чужой.сайт» — не путь на сайте, а ссылка наружу (//host)
const LINK = /^(?:(?:https?:\/\/|www\.)\S+|[a-z0-9-]{2,}\.(?:ru|com|net|org|io|gg|me|xyz|su|ly|cc|top|link|рф|kz|by|ua|tv|app|dev)(?:\/\S*)?)$/i;
// → { text: чистый текст (для JSON-LD и описаний), html: экранированный HTML (свои ссылки — ссылками, переносы строк — <br>) }
export function publicText(raw, max = 5000){
  let s = Array.from(String(raw ?? '')).filter(c => c === '\n' || c.codePointAt(0) >= 32).join('').replace(/\r/g, '').trim();
  s = s.replace(/\|\|([^|]+)\|\|/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');   // спойлер и жирный (VIP) — простым текстом
  const words = s.split(/(\s+)/);
  const own = [];
  s = words.map(w => {
    if (!w || /^\s+$/.test(w)) return w;
    const tail = (w.match(/[.,!?:;)»"']+$/) || [''])[0], core = tail ? w.slice(0, -tail.length) : w;
    const m = OWN.exec(core);
    if (m) { own.push(m[1] || '/'); return '\u0001' + (own.length - 1) + '\u0002' + tail; }
    return LINK.test(core) ? '[ссылка]' + tail : w;
  }).join('');
  for (const re of HIDE) s = s.replace(new RegExp(re.source, re.flags), m => (/^[\s.,!?:;()"'«»-]/.test(m) ? m[0] : '') + '[скрыто]');
  s = mask(s);
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  const label = p => 'dan4ik37.vercel.app' + (p === '/' ? '' : p);
  const text = s.replace(/\u0001(\d+)\u0002/g, (x, i) => label(own[+i]));
  const html = esc(s).replace(/\u0001(\d+)\u0002/g, (x, i) => `<a href="${esc(own[+i])}">${esc(label(own[+i]))}</a>`).replace(/\n/g, '<br>');
  return { text, html };
}
const plain = (raw, max) => publicText(raw, max).text;
const short = (raw, n = 160) => { const t = plain(raw, 1000).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };

async function safe(fn){ if (!storeConfigured()) return null; try { return await fn(); } catch (e) { return null; } }
// Старая база (forum.sql 2.0 не запущен) — ТОЛЬКО когда PostgREST ответил «нет такой колонки» (oldDb в store.js). Любой другой сбой
// (таймаут, 500) — не откатываться на старый запрос без фильтра статуса: иначе скрытое и «на проверке» попало бы на страницу и в кэш.
// → { rows, v2 } или { err: true } (сбой — показать «временно недоступно», ничего не раскрывая)
async function threads(q2, qOld){
  if (!storeConfigured()) return { rows: null, v2: false };
  try { return { rows: await sbSelect('forum_threads', q2), v2: true }; }
  catch (e) { if (!oldDb(e)) return { err: true }; }
  return { rows: qOld ? await safe(() => sbSelect('forum_threads', qOld)) : null, v2: false };
}
function busy(res){
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).send(page({ title: 'Форум временно недоступен — dan4ik37', description: 'Попробуй обновить страницу через минуту.', noindex: true, noAds: true, css: CSS,
    body: `<main class="wrap fr"><h1>Форум временно недоступен</h1><p class="muted">Попробуй обновить страницу через минуту.</p>
      <div class="cta"><a class="btn btn-acc" href="/#/forum">📋 Открыть форум на сайте</a> <a class="btn btn-ghost" href="/">🏠 На главную</a></div></main>` }));
}
async function nicks(ids){
  const list = [...new Set(ids.filter(x => /^[0-9a-f-]{36}$/i.test(String(x || ''))))];
  if (!list.length) return {};
  const [rows, kids] = await Promise.all([safe(() => sbSelect('profiles', `id=in.(${list.join(',')})&select=id,nick,role`)), publicKids(list)]);
  return Object.fromEntries((rows || []).map(p => [p.id, { ...p, nick: publicNick(kids, p.id, p.nick, p.role) }]));
}
const who = p => `${esc(p?.nick || 'игрок')}${ROLE[p?.role] ? ` <span class="fr-role">${ROLE[p.role]}</span>` : ''}`;
const person = p => ({ '@type': 'Person', name: p?.nick || 'игрок' });
const crumbs = (list) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: list.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });

function notFound(res, what, back){
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  res.status(404).send(page({ title: `${what} не найдена — dan4ik37`, description: 'Её удалили или в ссылке опечатка.', noindex: true, noAds: true, css: CSS,
    body: `<main class="wrap fr"><h1>${what} не найдена</h1><p class="muted">Её удалили или в ссылке опечатка.</p>
      <div class="cta"><a class="btn btn-acc" href="${back[0]}">${back[1]}</a> <a class="btn btn-ghost" href="/">🏠 На главную</a></div></main>` }));
}

export default async function handler(req, res){
  const kind = String(req.query.page || '');
  if (kind === 'forumping') return forumPing(req, res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const isIdeas = kind === 'ideas';
  const raw = String(req.query.id || '');
  // разделы SPA форума 2.0 без своей серверной страницы (редактор, мои, закладки, подписки, модерация, статьи автора) — сразу в приложение
  // (/#/forum/… → роутер вернёт настоящий адрес); noindex и без кэша у поисковика
  const spa = String(req.query.spa || '');
  const spaTo = !isIdeas && (/^(new|my|saved|follow|mod)$/.test(raw) && !spa ? raw : spa === 'edit' && /^\d{1,12}$/.test(raw) ? 'edit/' + raw : spa === 'u' && /^[0-9a-f-]{36}$/i.test(raw) ? 'u/' + raw.toLowerCase() : '');
  if (spaTo) { res.setHeader('Cache-Control', 'public, s-maxage=3600'); res.setHeader('X-Robots-Tag', 'noindex'); res.setHeader('Location', '/#/forum/' + spaTo); return res.status(302).send(''); }
  if (spa) return notFound(res, 'Страница', ['/forum', '📋 Все статьи']);
  const id = (raw.match(/^(\d{1,12})(?:-[a-z0-9-]{0,80})?$/) || [])[1] || '';
  if (raw && !id) return notFound(res, isIdeas ? 'Идея' : 'Статья', isIdeas ? ['/ideas', '💡 Все идеи'] : ['/forum', '📋 Все статьи']);
  if (isIdeas) return id ? ideaPage(res, id) : ideasPage(res);
  if (!id && req.query.tag != null) {
    let tag = ''; try { tag = decodeURIComponent(String(req.query.tag)).toLowerCase(); } catch (e) { tag = ''; }
    if (!/^[a-zа-яё0-9][a-zа-яё0-9-]{1,23}$/.test(tag)) return notFound(res, 'Метка', ['/forum', '📋 Все статьи']);
    return forumPage(res, tag);
  }
  return id ? threadPage(res, id, raw) : forumPage(res, '');
}

// ═══ Форум 2.0 (T-157): статьи из блоков. Нет новых колонок (forum.sql 2.0 не запущен) — как раньше, по старым полям ═══
const MEDIA = key => (/^[0-9a-f-]{36}\/[a-z0-9]{16,40}\.[a-z0-9]{2,5}$/.test(String(key || '')) && process.env.SUPABASE_URL
  ? process.env.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/forum-media/' + key : '');
const FB = makeForumBlocks();
const artUrl = t => `${SITE}/forum/${t.id}${FB.slug(t.title) ? '-' + FB.slug(t.title) : ''}`;
const artPath = t => artUrl(t).slice(SITE.length);
// Текст игрока на публичной странице — через publicText (мат, контакты, голые ссылки скрыты); явные ссылки статьи (https) — rel="nofollow ugc noopener"
const keepSp = s => (/^\s/.test(s) ? ' ' : '') + publicText(s, 6000).html + (/\s$/.test(s) && s.trim() ? ' ' : '');   // пробелы между кусками абзаца
const blocksHtml = blocks => FB.toHtml(blocks, { media: MEDIA, text: keepSp });
const firstVideo = blocks => (Array.isArray(blocks) ? blocks : []).find(b => b && b.t === 'video' && FB.videoOk(b.p, b.id)) || null;
const imageOf = t => MEDIA(t.cover) || FB.poster(firstVideo(t.blocks)) || SITE + '/og-image.jpg';
const adsOk = t => t.status === 'published' && t.trusted !== false && !(t.reports_open > 0) && (t.age_min ?? 12) <= 12;
const AD = '<div data-ad="forum_article" hidden></div>';

async function forumPage(res, tag){
  const url = tag ? `${SITE}/forum/t/${encodeURIComponent(tag)}` : `${SITE}/forum`;
  const got = await threads('status=eq.published&age_min=lte.12&realm=eq.kids'
    + (tag ? '&tags=cs.' + encodeURIComponent('{"' + tag + '"}') : '')
    + '&select=id,title,author_id,pinned,locked,created_at,published_at,excerpt,cover,tags,rating,comments,chars&order=pinned.desc,published_at.desc&limit=60',
    tag ? '' : 'select=id,title,author_id,pinned,locked,created_at,forum_posts(count)&order=pinned.desc,created_at.desc&limit=60');   // старая база — как раньше
  if (got.err) return busy(res);
  const v2 = got.v2, rows = got.rows || [];
  const who_ = await nicks(rows.map(t => t.author_id));
  const items = rows.map(t => ({ id: t.id, title: plain(t.title, 140) || 'Без названия', pinned: t.pinned, locked: t.locked, at: t.published_at || t.created_at,
    n: v2 ? t.comments || 0 : Math.max(0, (t.forum_posts?.[0]?.count ?? 1) - 1), a: who_[t.author_id], x: v2 ? short(t.excerpt || '', 200) : '',
    rating: t.rating || 0, tags: Array.isArray(t.tags) ? t.tags.filter(x => /^[a-zа-яё0-9-]{2,24}$/.test(x)) : [], cover: v2 ? MEDIA(t.cover) : '',
    href: v2 ? artPath(t) : `/forum/${t.id}` }));
  const row = (t, i) => `<li><a class="fr-row${t.cover ? ' fr-has-cover' : ''}" href="${esc(t.href)}">
      ${t.cover ? `<img class="fr-cover" src="${esc(t.cover)}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" width="640" height="360">` : ''}
      <span class="fr-t">${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${esc(t.title)}</span>
      ${t.x ? `<span class="fr-x">${esc(t.x)}</span>` : ''}
      <span class="fr-m">${who(t.a)} · ${esc(day(t.at))} · ${t.rating > 0 ? '+' : ''}${num(t.rating)} · 💬 ${num(t.n)}</span></a>
      ${t.tags.length ? `<span class="fr-tags">${t.tags.map(x => `<a href="/forum/t/${esc(encodeURIComponent(x))}">#${esc(x)}</a>`).join(' ')}</span>` : ''}</li>${i === 5 && items.length > 8 ? '</ol>' + AD + '<ol class="fr-list">' : ''}`;
  const list = items.length ? `<ol class="fr-list">${items.map(row).join('')}</ol>`
    : `<p class="muted fr-empty">${storeConfigured() ? (tag ? 'С этой меткой статей пока нет.' : 'Пока нет ни одной статьи — напиши первую!') : 'Статьи откроются в разделе «Форум» на сайте.'}</p>`;
  const h1 = tag ? `#${esc(tag)} — статьи на форуме` : '📋 Форум dan4ik37 — статьи и обсуждения';
  const body = `
<main class="wrap fr" data-age-page="12" data-age-title="Форум" data-age-why="Статьи и комментарии пишут другие игроки.">
  <nav class="crumbs"><a href="/">Главная</a> › ${tag ? `<a href="/forum">Форум</a> › <span>#${esc(tag)}</span>` : '<span>Форум</span>'}</nav>
  <h1>${h1}</h1>
  <p class="lead">${tag ? `Статьи с меткой #${esc(tag)}: гайды, новости и истории игроков.` : 'Гайды, новости игр, истории и мнения зрителей канала. Читать может любой, а написать свою статью с фото, видео и источником — после входа на сайт.'}</p>
  <div class="cta"><a class="btn btn-acc" href="${v2 ? '/forum/new' : '/#/forum'}">✍️ ${v2 ? 'Написать статью' : 'Создать тему'}</a>${tag ? '<a class="btn btn-ghost" href="/forum">📋 Все статьи</a>' : '<a class="btn btn-ghost" href="/ideas">💡 Идеи для видео</a>'}<a class="btn btn-ghost" href="/chat">💬 Чат</a></div>
  <h2 class="fr-h2">${tag ? 'Статьи' : 'Свежие статьи'}${items.length ? ` <span class="muted">· ${num(items.length)}</span>` : ''}</h2>
  ${list}
  <p class="muted fr-note">Правила: без оскорблений, рекламы и личных данных (телефонов, адресов) — модераторы скрывают такое. Ссылки авторов помечены как пользовательские.</p>
</main>`;
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(page({
    title: tag ? `#${tag} — статьи на форуме dan4ik37` : 'Форум dan4ik37 — статьи, гайды и новости игр',
    description: tag ? `Статьи с меткой #${tag} на форуме сайта dan4ik37: гайды, новости и истории игроков.` : 'Форум сайта dan4ik37: статьи игроков с фото и видео — гайды, новости игр, истории. Читать могут все, писать — после входа.',
    // индекс-диета 14.11 (page.js INDEX_DIET): страница метки — только карточки, noindex; список форума — в поиске от 3 статей
    // со своим текстом (≥ FORUM_MIN_CHARS знаков, как в api/sitemap.js)
    url, image: items.find(i => i.cover)?.cover || SITE + '/og-image.jpg', body, css: CSS, noAds: !v2 || items.length < 3,
    noindex: (!!tag && !items.length) || (INDEX_DIET && (!!tag || rows.filter(t => (t.chars || 0) >= FORUM_MIN_CHARS).length < 3)),
    spa: tag ? '#/forum/t/' + encodeURIComponent(tag) : '#/forum',
    ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': url, url, name: tag ? `#${tag} — форум dan4ik37` : 'Форум dan4ik37', inLanguage: 'ru',
      mainEntity: { '@type': 'ItemList', itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: items.length,
        itemListElement: items.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + t.href, name: t.title })) } },
      crumbs(tag ? [['Главная', SITE + '/'], ['Форум', SITE + '/forum'], ['#' + tag, url]] : [['Главная', SITE + '/'], ['Форум', url]])],
  }));
}

async function threadPage(res, id, raw){
  const got = await threads(`id=eq.${id}&select=id,title,author_id,pinned,locked,created_at,published_at,edited_at,status,blocks,cover,tags,source_url,source_title,excerpt,age_min,realm,rating,votes_up,comments,trusted,reports_open`,
    `id=eq.${id}&select=id,title,author_id,pinned,locked,created_at`);   // старая база (нет колонки status) — как раньше
  if (got.err) return busy(res);
  const t = (got.rows || [])[0], v2 = got.v2 && !(t && !('status' in t));   // строка без status — старая база (так отвечают и подменные базы тестов)
  if (!t || (v2 && (t.status !== 'published' || t.realm === 'adult' || t.age_min >= 18))) return notFound(res, 'Статья', ['/forum', '📋 Все статьи']);
  // старый адрес /forum/5 или опечатка в «слаге» → один адрес /forum/5-slug (301)
  if (v2 && raw !== artPath(t).slice('/forum/'.length)) { res.setHeader('Cache-Control', 'public, s-maxage=3600'); res.setHeader('Location', artPath(t)); return res.status(301).send(''); }
  const posts = await safe(() => sbSelect('forum_posts', `thread_id=eq.${id}&select=id,author_id,body,created_at,edited_at${v2 ? ',parent_id,is_body,deleted' : ''}&order=created_at.asc&limit=300`)) || [];
  const who_ = await nicks([t.author_id, ...posts.map(p => p.author_id)]);
  const url = v2 ? artUrl(t) : `${SITE}/forum/${t.id}`;
  const title = plain(t.title, 140) || 'Статья форума';
  let bodyHtml, bodyText, replies;
  if (v2) {
    replies = posts.filter(p => !p.is_body && !p.deleted);
    bodyHtml = blocksHtml(t.blocks);
    bodyText = plain(FB.toText(t.blocks), 5000);
  } else {
    const first = posts[0] || null; replies = posts.slice(1);
    const tx = first ? publicText(first.body) : { text: '', html: '' };
    bodyHtml = tx.html ? `<p>${tx.html}</p>` : ''; bodyText = tx.text;
  }
  const byId = Object.fromEntries(posts.map(p => [p.id, p]));
  const post = p => {
    const tx = publicText(p.body);
    const parent = p.parent_id && byId[p.parent_id] ? who_[byId[p.parent_id].author_id] : null;
    return `<article class="fr-post${p.parent_id ? ' fr-reply' : ''}" id="c${p.id}"><header><b>${who(who_[p.author_id])}</b>${parent ? ` <span class="muted">→ ${esc(parent.nick || 'игрок')}</span>` : ''}<time datetime="${esc(iso(p.created_at) || '')}">${esc(day(p.created_at))}</time></header>
      <div class="fr-body">${tx.html || '<span class="muted">(пусто)</span>'}</div></article>`;
  };
  const description = short(v2 ? t.excerpt || bodyText : bodyText) || `Статья «${title}» на форуме сайта dan4ik37.`;
  const tags = v2 && Array.isArray(t.tags) ? t.tags.filter(x => /^[a-zа-яё0-9-]{2,24}$/.test(x)) : [];
  let srcHost = ''; try { srcHost = t.source_url ? new URL(t.source_url).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  const src = v2 && t.source_url && FB.https(t.source_url) ? `<p class="fa-src">📰 Источник: <a href="${esc(t.source_url)}" rel="nofollow ugc noopener" target="_blank">${esc(plain(t.source_title || '', 140) || srcHost)}</a>${t.source_title && srcHost ? ` <span class="muted">· ${esc(srcHost)}</span>` : ''}</p>` : '';
  const ads = v2 && adsOk(t);
  const age = v2 ? t.age_min ?? 12 : 12;
  const body = `
<main class="wrap fr" data-age-page="${age >= 16 ? 16 : 12}" data-age-title="Форум" data-age-why="Статьи и комментарии пишут другие игроки.">
  <nav class="crumbs"><a href="/">Главная</a> › <a href="/forum">Форум</a> › <span>${esc(title)}</span></nav>
  <article class="fa">
  <h1>${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${esc(title)}</h1>
  <p class="meta"><span>👤 ${who(who_[t.author_id])}</span><span>📅 <time datetime="${esc(iso(t.published_at || t.created_at) || '')}">${esc(day(t.published_at || t.created_at))}</time></span>${v2 ? `<span>${t.rating > 0 ? '+' : ''}${num(t.rating)} ${plural(Math.abs(t.rating || 0), 'голос', 'голоса', 'голосов')}</span>` : ''}<span>💬 ${num(replies.length)}</span>${age >= 16 ? '<span>16+</span>' : ''}</p>
  <div class="fa-body">${bodyHtml || '<p class="muted">(пусто)</p>'}</div>
  ${src}
  ${tags.length ? `<p class="fr-tags">${tags.map(x => `<a href="/forum/t/${esc(encodeURIComponent(x))}">#${esc(x)}</a>`).join(' ')}</p>` : ''}
  </article>
  ${ads ? AD : ''}
  <div class="cta"><a class="btn btn-acc" href="/#/forum/${esc(String(t.id))}">💬 ${t.locked ? 'Открыть на сайте' : 'Обсудить'}</a><a class="btn btn-ghost" href="/forum">📋 Все статьи</a></div>
  ${replies.length ? `<h2 class="fr-h2">Комментарии</h2>${replies.map(post).join('')}` : '<p class="muted fr-empty">Комментариев пока нет — будь первым!</p>'}
  <p class="muted fr-note">Контакты и голые ссылки в тексте на этой странице скрыты; ссылки автора помечены как пользовательские. Нашёл нарушение — нажми «⚑ Пожаловаться» у статьи на сайте.</p>
</main>`;
  const last = posts.length ? posts[posts.length - 1] : null;
  const vid = v2 ? firstVideo(t.blocks) : null;
  const ld = { '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', '@id': url, url, mainEntityOfPage: url, headline: title,
    text: bodyText || title, datePublished: iso(t.published_at || t.created_at), dateModified: iso(t.edited_at || last?.edited_at || last?.created_at || t.created_at), inLanguage: 'ru',
    author: person(who_[t.author_id]), isPartOf: { '@type': 'CollectionPage', '@id': `${SITE}/forum`, url: `${SITE}/forum`, name: 'Форум dan4ik37' },
    interactionStatistic: v2 ? [{ '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: replies.length },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: t.votes_up || 0 }]
      : { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: replies.length },
    comment: replies.slice(0, 100).map(p => ({ '@type': 'Comment', '@id': `${url}#c${p.id}`, text: plain(p.body, 2000) || '…', datePublished: iso(p.created_at), author: person(who_[p.author_id]) })) };
  if (v2) {
    ld.image = imageOf(t);
    if (tags.length) ld.keywords = tags.join(', ');
    if (t.source_url && FB.https(t.source_url)) ld.citation = t.source_url;
    if (vid) ld.video = { '@type': 'VideoObject', name: title, embedUrl: FB.embedUrl(vid, 'dan4ik37.vercel.app'), contentUrl: FB.watchUrl(vid),
      ...(FB.poster(vid) ? { thumbnailUrl: FB.poster(vid) } : {}), uploadDate: iso(t.published_at || t.created_at), description: description };
  }
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=3600');
  res.status(200).send(page({
    title: `${title} — форум dan4ik37`, description, url, image: v2 ? imageOf(t) : SITE + '/og-image.jpg', ogType: 'article', body, css: CSS, noAds: !ads,
    // индекс-диета 14.11: короткая статья (меньше FORUM_MIN_CHARS знаков текста) — страница есть, в поиск и в карту сайта не идёт
    noindex: age >= 16 || (INDEX_DIET && Array.from(v2 ? FB.toText(t.blocks) : bodyText || '').length < FORUM_MIN_CHARS), spa: `#/forum/${t.id}`,
    ld: [ld, crumbs([['Главная', SITE + '/'], ['Форум', SITE + '/forum'], [title, url]])],
  }));
}

// POST /api/forum-ping {id} — опубликовали статью: сообщить Яндексу и Bing (IndexNow). Сервер сам проверяет, что статья опубликована,
// свежая (сутки), для всех (до 12+) и о ней ещё не сообщали (pinged_at) — повторный вызов ничего не делает
async function forumPing(req, res){
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('{"ok":false}'); }
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const id = String(b && b.id || '');
  if (!/^\d{1,12}$/.test(id) || !storeConfigured()) return res.status(200).send('{"ok":false}');
  try {
    const rows = await sbPatch('forum_threads', `id=eq.${id}&status=eq.published&age_min=lte.12&realm=eq.kids&pinged_at=is.null&published_at=gt.${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}`,
      { pinged_at: new Date().toISOString() });
    const t = Array.isArray(rows) ? rows[0] : null;
    if (!t) return res.status(200).send('{"ok":true,"sent":false}');
    const r = await indexNow([artUrl(t), `${SITE}/forum`, ...(Array.isArray(t.tags) ? t.tags.slice(0, 5).filter(x => /^[a-zа-яё0-9-]{2,24}$/.test(x)).map(x => `${SITE}/forum/t/${encodeURIComponent(x)}`) : [])]);
    return res.status(200).send(JSON.stringify({ ok: true, sent: true, r }));
  } catch (e) { return res.status(200).send('{"ok":false}'); }
}

// ═══ Идеи для видео ═══
const ST = { new: ['🆕', 'Новая'], planned: ['🗓', 'В планах'], done: ['✅', 'Сделано'], rejected: ['✖', 'Отклонено'] };
const stOf = s => ST[s] || ST.new;

async function ideasPage(res){
  const url = `${SITE}/ideas`;
  const rows = await safe(() => sbRpc('list_ideas', { p_status: null, p_sort: 'top', p_limit: 100 }));
  const list = (Array.isArray(rows) ? rows : []).filter(r => r.status !== 'rejected');
  const kids = await publicKids(list.map(r => r.author_id));
  const items = list.map(r => ({ id: r.id, title: plain(r.title, 140) || 'Идея', body: short(r.body, 200), st: r.status, votes: r.votes || 0, video: r.video_id,
    a: { nick: publicNick(kids, r.author_id, r.author_nick, r.author_role), role: r.author_role }, at: r.created_at }));
  const done = items.filter(i => i.st === 'done').length, planned = items.filter(i => i.st === 'planned').length;
  const card = i => `<li><a class="fr-row id-row" href="/ideas/${i.id}"><span class="id-votes" title="Голосов">▲ ${num(i.votes)}</span>
      <span class="fr-t">${esc(i.title)} <span class="id-st id-${esc(i.st)}">${stOf(i.st).join(' ')}</span></span>
      ${i.body ? `<span class="fr-x">${esc(i.body)}</span>` : ''}<span class="fr-m">${who(i.a)} · ${esc(day(i.at))}</span></a></li>`;
  const body = `
<main class="wrap fr">
  <nav class="crumbs"><a href="/">Главная</a> › <span>Идеи для видео</span></nav>
  <h1>💡 Идеи для видео dan4ik37</h1>
  <p class="lead">Зрители предлагают, во что поиграть и какие ролики снять, и голосуют за чужие идеи. Лучшие становятся видео и стримами.</p>
  ${items.length ? `<p class="meta"><span>💡 ${num(items.length)} ${plural(items.length, 'идея', 'идеи', 'идей')}</span><span>🗓 в планах: ${num(planned)}</span><span>✅ сделано: ${num(done)}</span></p>` : ''}
  <div class="cta"><a class="btn btn-acc" href="/#/ideas">💡 Предложить идею</a><a class="btn btn-ghost" href="/forum">📋 Форум</a><a class="btn btn-ghost" href="/videos">🎬 Все видео</a></div>
  ${items.length ? `<ol class="fr-list">${items.map(card).join('')}</ol>` : `<p class="muted fr-empty">${storeConfigured() ? 'Идей пока нет — предложи первую!' : 'Идеи откроются в разделе «Идеи» на сайте.'}</p>`}
</main>`;
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(page({
    title: 'Идеи для видео dan4ik37 — предложи и проголосуй',
    description: 'Предложи идею для ролика или стрима dan4ik37 и голосуй за чужие — лучшие идеи становятся видео.',
    url, image: SITE + '/og-image.jpg', body, css: CSS, noAds: true, noindex: INDEX_DIET, spa: '#/ideas',   // индекс-диета 14.11: список идей зрителей — не в поиск
    ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': url, url, name: 'Идеи для видео dan4ik37', inLanguage: 'ru',
      mainEntity: { '@type': 'ItemList', itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: items.length,
        itemListElement: items.map((i, n) => ({ '@type': 'ListItem', position: n + 1, url: `${SITE}/ideas/${i.id}`, name: i.title })) } },
      crumbs([['Главная', SITE + '/'], ['Идеи для видео', url]])],
  }));
}

async function ideaPage(res, id){
  const r = (await safe(() => sbSelect('ideas', `id=eq.${id}&select=id,author_id,title,body,status,video_id,votes,created_at,status_changed_at`)))?.[0];
  if (!r) return notFound(res, 'Идея', ['/ideas', '💡 Все идеи']);
  const a = (await nicks([r.author_id]))[r.author_id];
  const url = `${SITE}/ideas/${r.id}`;
  const title = plain(r.title, 140) || 'Идея для видео';
  const tx = publicText(r.body, 1000);
  const [ic, st] = stOf(r.status);
  const video = /^[A-Za-z0-9_-]{11}$/.test(r.video_id || '') && r.status === 'done' ? r.video_id : null;
  const body = `
<main class="wrap fr">
  <nav class="crumbs"><a href="/">Главная</a> › <a href="/ideas">Идеи для видео</a> › <span>${esc(title)}</span></nav>
  <h1>💡 ${esc(title)}</h1>
  <p class="meta"><span class="id-st id-${esc(r.status)}">${ic} ${st}</span><span>▲ ${num(r.votes)} ${plural(r.votes || 0, 'голос', 'голоса', 'голосов')}</span><span>👤 ${who(a)}</span><span>📅 ${esc(day(r.created_at))}</span></p>
  ${tx.html ? `<article class="fr-post fr-first"><div class="fr-body">${tx.html}</div></article>` : ''}
  ${video ? `<p class="fr-video"><a class="btn btn-yt" href="/v/${esc(video)}">▶ Смотреть ролик по этой идее</a></p>` : ''}
  <div class="cta"><a class="btn btn-acc" href="/#/ideas/${r.id}">▲ Поддержать на сайте</a><a class="btn btn-ghost" href="/ideas">💡 Все идеи</a></div>
  <p class="muted fr-note">Голосовать и предлагать свои идеи можно после входа на сайт. Ссылки на другие сайты и контакты на этой странице скрыты.</p>
</main>`;
  const ld = { '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', '@id': url, url, mainEntityOfPage: url, headline: title,
    text: tx.text || title, datePublished: iso(r.created_at), dateModified: iso(r.status_changed_at || r.created_at), inLanguage: 'ru', author: person(a),
    isPartOf: { '@type': 'CollectionPage', '@id': `${SITE}/ideas`, url: `${SITE}/ideas`, name: 'Идеи для видео dan4ik37' },
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: r.votes || 0 } };
  if (video) ld.sharedContent = { '@type': 'VideoObject', url: `${SITE}/v/${video}`, name: title, thumbnailUrl: `https://i.ytimg.com/vi/${video}/hqdefault.jpg`, uploadDate: iso(r.status_changed_at || r.created_at) };
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(page({
    title: `${title} — идея для видео dan4ik37`, description: short(r.body) || `Идея для видео dan4ik37: «${title}». ${st}, ${num(r.votes)} ${plural(r.votes || 0, 'голос', 'голоса', 'голосов')}.`,
    url, image: video ? `https://i.ytimg.com/vi/${video}/hqdefault.jpg` : SITE + '/og-image.jpg', ogType: 'article', body, css: CSS, noAds: true,
    spa: `#/ideas/${r.id}`, noindex: r.status === 'rejected' || INDEX_DIET,   // индекс-диета 14.11: идея — пара строк зрителя, не в поиск
    ld: [ld, crumbs([['Главная', SITE + '/'], ['Идеи для видео', SITE + '/ideas'], [title, url]])],
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.fr .lead{margin-top:.6rem;color:rgba(var(--text-rgb),.82);max-width:720px}
.fr-h2{margin-top:2rem}
.fr-list{list-style:none;display:flex;flex-direction:column;gap:.55rem;margin-top:.4rem}
.fr-row{display:flex;flex-direction:column;gap:.25rem;padding:.9rem 1.1rem;border-radius:14px;background:var(--card);border:1px solid var(--line);text-decoration:none;transition:border-color .2s}
.fr-row:hover{border-color:rgba(145,71,255,.6)}
.fr-t{font-weight:800;font-size:.95rem;word-break:break-word}
.fr-x{font-size:.82rem;color:rgba(var(--text-rgb),.75);word-break:break-word}
.fr-m{font-size:.74rem;color:var(--muted)}
.fr-role{display:inline-block;padding:0 .4rem;border-radius:6px;background:rgba(255,45,85,.16);color:var(--pink-t);font-size:.66rem;font-weight:800;vertical-align:middle}
.fr-post{margin-top:.7rem;padding:1rem 1.2rem;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.fr-post header{display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;font-size:.8rem}
.fr-post time{color:var(--muted);font-size:.74rem}
.fr-first{margin-top:1.2rem;border-color:rgba(145,71,255,.35)}
.fr-body{margin-top:.5rem;font-size:.9rem;line-height:1.65;word-break:break-word;color:rgba(var(--text-rgb),.9)}
.fr-post.fr-first .fr-body{margin-top:0}
.fr-body a{color:var(--link)}
.fr-empty{margin-top:1rem}
.fr-note{margin-top:1.6rem;font-size:.75rem}
.fr-video{margin-top:1rem}
.id-row{display:grid;grid-template-columns:auto 1fr;column-gap:.9rem}
.id-row>:not(.id-votes){grid-column:2}
.id-votes{grid-row:1/span 3;align-self:center;min-width:3.4rem;text-align:center;padding:.4rem .5rem;border-radius:10px;background:rgba(255,209,102,.1);color:var(--gold-t);font-weight:800;font-size:.8rem}
.id-st{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.7rem;font-weight:800;background:rgba(var(--fg-rgb),.06);color:var(--muted);vertical-align:middle}
.id-planned{background:rgba(124,196,255,.14);color:var(--link)}.id-done{background:rgba(34,197,94,.16);color:var(--ok-hi)}.id-rejected{background:rgba(255,45,85,.12);color:var(--pink-t)}
.fr-has-cover{padding-top:0;overflow:hidden}
.fr-cover{display:block;width:calc(100% + 2.2rem);margin:0 -1.1rem .5rem;aspect-ratio:16/9;object-fit:cover;height:auto;background:rgba(var(--fg-rgb),.06)}
.fr-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin:.35rem 0 0 .2rem;font-size:.76rem}
.fr-tags a{color:var(--link);text-decoration:none;font-weight:700}
.fa{margin-top:.4rem}
.fa-body{margin-top:1rem;font-size:1rem;line-height:1.7;word-break:break-word;color:rgba(var(--text-rgb),.92)}
.fa-body p{margin:0 0 .9em}.fa-body h2{margin:1.3em 0 .5em;font-size:1.25rem}.fa-body h3{margin:1.1em 0 .4em;font-size:1.08rem}
.fa-body ul,.fa-body ol{margin:0 0 .9em;padding-left:1.4em}
.fa-body blockquote{margin:0 0 1em;padding:.5rem .9rem;border-left:4px solid rgba(145,71,255,.7);background:rgba(145,71,255,.07);border-radius:0 10px 10px 0}
.fa-body blockquote p{margin:0}.fa-body blockquote footer{font-size:.8rem;color:var(--muted);margin-top:.3rem}
.fa-body figure{margin:0 0 1em}.fa-body img{max-width:100%;height:auto;border-radius:12px;display:block}
.fa-body figcaption{font-size:.78rem;color:var(--muted);margin-top:.35rem}
.fa-body a{color:var(--link)}.fa-body hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}
.fa-video a{position:relative;display:block;text-decoration:none}
.fa-video span{position:absolute;left:.7rem;bottom:.6rem;padding:.3rem .6rem;border-radius:8px;background:rgba(0,0,0,.7);color:#fff;font-weight:800;font-size:.85rem}
.fa-file span{color:var(--muted);font-size:.8rem}
.fa-src{margin-top:1rem;padding:.6rem .8rem;border-radius:10px;background:rgba(var(--fg-rgb),.05);font-size:.88rem;word-break:break-word}
.fa-src a{color:var(--link);font-weight:700}
.fr-reply{margin-left:1rem;border-left:3px solid rgba(145,71,255,.3)}
@media(max-width:600px){.fr-cover{width:calc(100% + 1.8rem);margin:0 -.9rem .5rem}.fr-reply{margin-left:.5rem}}
@media(max-width:600px){.fr-row{padding:.8rem .9rem}.id-row{column-gap:.6rem}.id-votes{min-width:2.8rem}}
`;
