// /c/<код> — ссылка-приглашение в сообщество (чат «как Дискорд», community.sql): значок, название, участники, о чём — для
// превью ссылки в Telegram / ВК и для того, кто её открыл. «Вступить» → SPA /chat/join/<код> (там экран вступления, нужен вход).
// Данные — cm_invite_info (то же, что видит гость). Пока community.sql не выполнен или код неверный — «приглашение не найдено».
// Не для поиска (noindex) и без рекламы: содержимое игроков без модерации.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { sbRpc, storeConfigured } from '../store.js';

const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
const IMG = `${SITE}/img/share/community.png`;

export default async function handler(req, res) {
  const code = String(req.query.code || '').toLowerCase();
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  if (!/^[a-z0-9]{6,12}$/.test(code)) return notFound(res, false);
  let c = null, soon = !storeConfigured();
  if (!soon) {
    try { c = await sbRpc('cm_invite_info', { p_code: code }); }
    catch (e) { soon = /PGRST202|HTTP 404/.test(String(e?.message || '')); }   // community.sql ещё не выполнен
  }
  if (!c || !c.name) return notFound(res, soon);
  const n = Number(c.members) || 0;
  const name = String(c.name).slice(0, 40), about = String(c.about || '').slice(0, 300), icon = String(c.icon || '🏰').slice(0, 8);
  const url = `${SITE}/c/${code}`, join = `/chat/join/${code}`;
  const title = `«${name}» — приглашение в сообщество`;
  const description = `${about ? about + ' · ' : ''}${n} ${plural(n, 'участник', 'участника', 'участников')}. Сообщество на сайте Денчика: чат, голосовой канал и друзья — вступай!`;
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/">Главная</a> › <a href="/chat">Чат и сообщества</a> › <span>Приглашение</span></nav>
  <section class="iv-card">
    <span class="iv-ic">${esc(icon)}</span>
    <small class="iv-lbl">Тебя зовут в сообщество</small>
    <h1>${esc(name)}</h1>
    <p class="iv-meta">👥 ${n} ${plural(n, 'участник', 'участника', 'участников')} · ${c.public ? '🌍 открытое' : '🔒 по приглашению'}</p>
    ${about ? `<p class="lead">${esc(about)}</p>` : ''}
    <a class="btn btn-acc iv-go" href="${join}">🏰 Вступить</a>
    <p class="iv-note">Нужен аккаунт на сайте — войти или зарегистрироваться можно на следующем шаге. Бесплатно.</p>
  </section>
  <aside class="join"><div><b>Что внутри</b><span>Текстовые каналы, голосовой канал, ответы и упоминания, а ещё общий чат сайта, друзья, звонки и «Мир Денчика» — всё в одном месте.</span></div><a class="btn btn-ghost" href="/chat">💬 Общий чат сайта</a></aside>
  <p class="iv-warn">Сообщество создал игрок сайта. Никогда не сообщай в чатах пароли и личные данные. Нарушение — пожалуйся на сообщение (⋯ → 🚩).</p>
</main>`;
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page({ title, description, url, image: IMG, body, css: CSS, noindex: true, noAds: true }));
}

function notFound(res, soon){
  res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
  const text = soon ? 'Сообщества скоро появятся на сайте — загляни чуть позже. А пока есть общий чат сайта.' : 'Ссылку поменяли, сообщество удалили или в ссылке опечатка. Попроси у друга новую.';
  res.send(page({ title: 'Приглашение не найдено — сообщества на сайте Денчика', description: text,
    body: `<main class="wrap"><section class="iv-card"><span class="iv-ic">🏰</span><h1>Приглашение не найдено</h1><p class="lead">${esc(text)}</p><a class="btn btn-acc iv-go" href="/chat">💬 В чат сайта</a></section></main>`,
    noindex: true, noAds: true, css: CSS }));
}

const CSS = `
.iv-card{max-width:560px;margin:1.4rem auto 0;padding:2rem 1.6rem 1.6rem;border-radius:22px;background:var(--card);border:1px solid var(--line);text-align:center;display:flex;flex-direction:column;align-items:center;gap:.35rem}
.iv-ic{width:96px;height:96px;border-radius:28px;display:grid;place-items:center;font-size:3.2rem;background:linear-gradient(135deg,rgba(129,140,248,.35),rgba(79,70,229,.35));box-shadow:0 14px 34px rgba(0,0,0,.35);margin-bottom:.4rem}
.iv-lbl{font-size:.72rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.iv-card h1{margin:.1rem 0 .1rem;word-break:break-word}
.iv-meta{color:var(--muted);font-size:.88rem;font-weight:700;margin:0}
.iv-card .lead{margin:.5rem 0 0;white-space:pre-line}
.iv-go{margin-top:1rem;font-size:1.08rem;padding:.85rem 2rem}
.iv-note{color:var(--muted);font-size:.78rem;margin:.6rem 0 0}
.iv-warn{max-width:560px;margin:1rem auto 0;color:var(--muted);font-size:.78rem;text-align:center}
`;
