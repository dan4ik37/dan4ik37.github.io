// /forum, /forum/<id> — форум; /ideas, /ideas/<id> — «Идеи для видео» (rewrites в vercel.json → api/pages.js?page=forum|ideas).
// Серверные страницы для поиска и превью ссылок (Telegram, ВК): заголовок, описание, canonical, JSON-LD (DiscussionForumPosting,
// ItemList, BreadcrumbList). Писать, отвечать и голосовать — в разделе сайта (SPA): кнопки ведут на /#/forum/<id> — роутер
// (js/ui/router.js) откроет раздел по тому же адресу /forum/<id>. Вкладка, где уже открыт сайт-приложение, сразу уходит в раздел
// (page({ spa }) в api/_lib/page.js) — перезагрузка не выкидывает из приложения.
// Текст игроков — только экранированный и через publicText(): чужие ссылки — «[ссылка]», телефоны, почта, @ники — «[скрыто]»,
// мат закрыт (как в чате для детей: страницу видит кто угодно, возраст сервер не знает). Рекламы нет (текст не проверен
// модератором заранее — правила AdSense), как у noAds-страниц. Данные — по service-ключу, только публичные поля (ник, роль);
// ник ребёнка до 13 — «Игрок» (age.sql: age_public_kids — сервер узнаёт только «прятать или нет», без возраста).
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { sbSelect, sbRpc, storeConfigured } from '../store.js';
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
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const kind = String(req.query.page || '') === 'ideas' ? 'ideas' : 'forum';
  const id = String(req.query.id || '');
  if (id && !/^\d{1,12}$/.test(id)) return notFound(res, kind === 'ideas' ? 'Идея' : 'Тема', kind === 'ideas' ? ['/ideas', '💡 Все идеи'] : ['/forum', '📋 Все темы']);
  if (kind === 'ideas') return id ? ideaPage(res, id) : ideasPage(res);
  return id ? threadPage(res, id) : forumPage(res);
}

// ═══ Форум: список тем ═══
async function forumPage(res){
  const url = `${SITE}/forum`;
  const rows = await safe(() => sbSelect('forum_threads', 'select=id,title,author_id,pinned,locked,created_at,forum_posts(count)&order=pinned.desc,created_at.desc&limit=60')) || [];
  const who_ = await nicks(rows.map(t => t.author_id));
  const items = rows.map(t => ({ id: t.id, title: plain(t.title, 140) || 'Без названия', pinned: t.pinned, locked: t.locked, at: t.created_at,
    n: Math.max(0, (t.forum_posts?.[0]?.count ?? 1) - 1), a: who_[t.author_id] }));
  const list = items.length ? `<ol class="fr-list">${items.map(t => `<li><a class="fr-row" href="/forum/${t.id}">
      <span class="fr-t">${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${esc(t.title)}</span>
      <span class="fr-m">${who(t.a)} · ${esc(day(t.at))} · 💬 ${num(t.n)} ${plural(t.n, 'ответ', 'ответа', 'ответов')}</span></a></li>`).join('')}</ol>`
    : `<p class="muted fr-empty">${storeConfigured() ? 'Пока нет ни одной темы — создай первую!' : 'Темы откроются в разделе «Форум» на сайте.'}</p>`;
  const body = `
<main class="wrap fr" data-age-page="12" data-age-title="Форум" data-age-why="Темы и ответы пишут другие игроки — что угодно.">
  <nav class="crumbs"><a href="/">Главная</a> › <span>Форум</span></nav>
  <h1>📋 Форум dan4ik37</h1>
  <p class="lead">Темы про игры, стримы, видео и сам сайт. Читать может любой, а создать тему или ответить — после входа на сайт.</p>
  <div class="cta"><a class="btn btn-acc" href="/#/forum">✏️ Создать тему</a><a class="btn btn-ghost" href="/ideas">💡 Идеи для видео</a><a class="btn btn-ghost" href="/chat">💬 Чат</a></div>
  <h2 class="fr-h2">Темы${items.length ? ` <span class="muted">· ${num(items.length)}</span>` : ''}</h2>
  ${list}
  <p class="muted fr-note">Правила: без оскорблений, рекламы и личных данных (телефонов, адресов) — модераторы удаляют такое. Ссылки на другие сайты на этой странице скрыты.</p>
</main>`;
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(page({
    title: 'Форум dan4ik37 — обсуждения игр, стримов и сайта',
    description: 'Форум сайта dan4ik37: темы про игры, стримы, видео и сам сайт. Читать могут все, создать тему и ответить — после входа.',
    url, image: SITE + '/og-image.jpg', body, css: CSS, noAds: true, spa: '#/forum',
    ld: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': url, url, name: 'Форум dan4ik37', inLanguage: 'ru',
      mainEntity: { '@type': 'ItemList', itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: items.length,
        itemListElement: items.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/forum/${t.id}`, name: t.title })) } },
      crumbs([['Главная', SITE + '/'], ['Форум', url]])],
  }));
}

// ═══ Форум: тема с ответами ═══
async function threadPage(res, id){
  const t = (await safe(() => sbSelect('forum_threads', `id=eq.${id}&select=id,title,author_id,pinned,locked,created_at`)))?.[0];
  if (!t) return notFound(res, 'Тема', ['/forum', '📋 Все темы']);
  const posts = await safe(() => sbSelect('forum_posts', `thread_id=eq.${id}&select=id,author_id,body,created_at,edited_at&order=created_at.asc&limit=300`)) || [];
  const who_ = await nicks([t.author_id, ...posts.map(p => p.author_id)]);
  const url = `${SITE}/forum/${t.id}`;
  const title = plain(t.title, 140) || 'Тема форума';
  const first = posts[0] || null, replies = posts.slice(1);
  const firstText = first ? publicText(first.body) : { text: '', html: '' };
  const last = posts.length ? posts[posts.length - 1] : null;
  const post = (p, i) => {
    const tx = publicText(p.body);
    return `<article class="fr-post" id="p${p.id}"><header><b>${who(who_[p.author_id])}</b><time datetime="${esc(iso(p.created_at) || '')}">${esc(day(p.created_at))}</time></header>
      <div class="fr-body">${tx.html || '<span class="muted">(пусто)</span>'}</div></article>`;
  };
  const description = short(first?.body || '') || `Тема «${title}» на форуме сайта dan4ik37: ${num(replies.length)} ${plural(replies.length, 'ответ', 'ответа', 'ответов')}.`;
  const body = `
<main class="wrap fr" data-age-page="12" data-age-title="Форум" data-age-why="Темы и ответы пишут другие игроки — что угодно.">
  <nav class="crumbs"><a href="/">Главная</a> › <a href="/forum">Форум</a> › <span>${esc(title)}</span></nav>
  <h1>${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${esc(title)}</h1>
  <p class="meta"><span>👤 ${who(who_[t.author_id])}</span><span>📅 ${esc(day(t.created_at))}</span><span>💬 ${num(replies.length)} ${plural(replies.length, 'ответ', 'ответа', 'ответов')}</span>${t.locked ? '<span>🔒 тема закрыта</span>' : ''}</p>
  ${first ? `<article class="fr-post fr-first" id="p${first.id}"><div class="fr-body">${firstText.html}</div></article>` : ''}
  <div class="cta"><a class="btn btn-acc" href="/#/forum/${t.id}">💬 ${t.locked ? 'Открыть на сайте' : 'Ответить'}</a><a class="btn btn-ghost" href="/forum">📋 Все темы</a></div>
  ${replies.length ? `<h2 class="fr-h2">Ответы</h2>${replies.map(post).join('')}` : '<p class="muted fr-empty">Ответов пока нет — будь первым!</p>'}
  <p class="muted fr-note">Ссылки на другие сайты и контакты на этой странице скрыты. Нашёл нарушение — напиши модераторам в чате.</p>
</main>`;
  const ld = { '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', '@id': url, url, mainEntityOfPage: url, headline: title,
    text: firstText.text || title, datePublished: iso(t.created_at), dateModified: iso(last?.edited_at || last?.created_at || t.created_at), inLanguage: 'ru',
    author: person(who_[t.author_id]), isPartOf: { '@type': 'CollectionPage', '@id': `${SITE}/forum`, url: `${SITE}/forum`, name: 'Форум dan4ik37' },
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: replies.length },
    comment: replies.slice(0, 100).map(p => ({ '@type': 'Comment', '@id': `${url}#p${p.id}`, text: plain(p.body, 2000) || '…', datePublished: iso(p.created_at), author: person(who_[p.author_id]) })) };
  if (t.locked) ld.isAccessibleForFree = true;
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=3600');
  res.status(200).send(page({
    title: `${title} — форум dan4ik37`, description, url, image: SITE + '/og-image.jpg', ogType: 'article', body, css: CSS, noAds: true, spa: `#/forum/${t.id}`,
    ld: [ld, crumbs([['Главная', SITE + '/'], ['Форум', SITE + '/forum'], [title, url]])],
  }));
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
    url, image: SITE + '/og-image.jpg', body, css: CSS, noAds: true, spa: '#/ideas',
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
    spa: `#/ideas/${r.id}`, noindex: r.status === 'rejected',
    ld: [ld, crumbs([['Главная', SITE + '/'], ['Идеи для видео', SITE + '/ideas'], [title, url]])],
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.fr .lead{margin-top:.6rem;color:rgba(240,240,248,.82);max-width:720px}
.fr-h2{margin-top:2rem}
.fr-list{list-style:none;display:flex;flex-direction:column;gap:.55rem;margin-top:.4rem}
.fr-row{display:flex;flex-direction:column;gap:.25rem;padding:.9rem 1.1rem;border-radius:14px;background:var(--card);border:1px solid var(--line);text-decoration:none;transition:border-color .2s}
.fr-row:hover{border-color:rgba(145,71,255,.6)}
.fr-t{font-weight:800;font-size:.95rem;word-break:break-word}
.fr-x{font-size:.82rem;color:rgba(240,240,248,.75);word-break:break-word}
.fr-m{font-size:.74rem;color:var(--muted)}
.fr-role{display:inline-block;padding:0 .4rem;border-radius:6px;background:rgba(255,45,85,.16);color:#ff8fa8;font-size:.66rem;font-weight:800;vertical-align:middle}
.fr-post{margin-top:.7rem;padding:1rem 1.2rem;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.fr-post header{display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;font-size:.8rem}
.fr-post time{color:var(--muted);font-size:.74rem}
.fr-first{margin-top:1.2rem;border-color:rgba(145,71,255,.35)}
.fr-body{margin-top:.5rem;font-size:.9rem;line-height:1.65;word-break:break-word;color:rgba(240,240,248,.9)}
.fr-post.fr-first .fr-body{margin-top:0}
.fr-body a{color:#7cc4ff}
.fr-empty{margin-top:1rem}
.fr-note{margin-top:1.6rem;font-size:.75rem}
.fr-video{margin-top:1rem}
.id-row{display:grid;grid-template-columns:auto 1fr;column-gap:.9rem}
.id-row>:not(.id-votes){grid-column:2}
.id-votes{grid-row:1/span 3;align-self:center;min-width:3.4rem;text-align:center;padding:.4rem .5rem;border-radius:10px;background:rgba(255,209,102,.1);color:#ffd166;font-weight:800;font-size:.8rem}
.id-st{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.7rem;font-weight:800;background:rgba(255,255,255,.06);color:var(--muted);vertical-align:middle}
.id-planned{background:rgba(124,196,255,.14);color:#7cc4ff}.id-done{background:rgba(34,197,94,.16);color:#4ade80}.id-rejected{background:rgba(255,45,85,.12);color:#ff8fa8}
@media(max-width:600px){.fr-row{padding:.8rem .9rem}.id-row{column-gap:.6rem}.id-votes{min-width:2.8rem}}
`;
