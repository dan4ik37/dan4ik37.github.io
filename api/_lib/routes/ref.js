// /r/<код> — ссылка-приглашение друга («👥 Пригласи друзей», js/core/ref.js, referrals2.sql): кто позвал, что на сайте, подарок новичку —
// для превью в Telegram / ВК и для того, кто открыл. Код запоминается в браузере (d37RefStore из REF_HEAD, первое касание, 30 дней);
// ?to=<куда> (games/chess/abcd, games/world, g/<id>…) — сразу туда, без остановки на этой странице.
// Ник — ref_public (ник ребёнка и ник по умолчанию не показывает). Не для поиска (noindex), без рекламы.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { sbRpc, storeConfigured } from '../store.js';
import { GAME_PAGES } from '../games-seo.js';

const IMG = `${SITE}/img/share/invite.png`;
const CODE = /^[2-9bcdfghjkmnpqrstvwz]{6}$/;   // как CODE_RE в js/core/ref.js и ref_new_code в referrals2.sql
const PLACE = /^[A-Za-z0-9/_-]{1,80}$/;
// как ref_ladder() -> 'w' (на случай, если сервер не ответил)
const GIFT = { lv: 3, coins: 50, text: 'След «Конфетти»' };

// Куда позвали → «сыграть в «Шахматы»»
function placeText(to){
  if (!to) return '';
  if (/^games\/world(\/|$)/.test(to)) return 'в «Мир Денчика» — 3D-мир с друзьями';
  if (/^games\/studio3d\//.test(to) || /^g\//.test(to)) return 'в игру, которую сделал игрок';
  const m = /^games\/([a-z0-9_]+)/.exec(to);
  const g = m && GAME_PAGES.find(x => x.id === m[1]);
  if (g) return `сыграть в «${g.name}»${/^games\/[a-z0-9_]+\/(coop\/)?[a-z0-9]{4,12}$/.test(to) ? ' — комната уже ждёт' : ''}`;
  if (/^games(\/|$)/.test(to)) return 'поиграть в игры сайта';
  if (/^chat(\/|$)/.test(to)) return 'в чат сайта';
  return '';
}

export default async function handler(req, res) {
  const code = String(req.query.code || '').toLowerCase().replace(/[\s-]/g, '');
  const rawTo = String(req.query.to || '').replace(/^#?\/+/, '');
  const to = PLACE.test(rawTo) ? rawTo : '';
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  if (!CODE.test(code)) return notFound(res);
  let info = null;
  if (storeConfigured()) {
    try { info = await sbRpc('ref_public', { p_code: code }); } catch (e) { info = null; }   // нет referrals2.sql — просто без ника
  }
  if (info && info.ok === false) return notFound(res);
  const nick = info?.nick ? String(info.nick).slice(0, 24) : '';
  const gift = info?.gift && info.gift.coins ? info.gift : GIFT;
  const where = placeText(to);
  const go = `/?ref=${code}#/${to || 'home'}`;
  const title = nick ? `${nick} зовёт тебя на сайт Денчика37` : 'Тебя зовут на сайт Денчика37';
  const description = `${where ? 'Зовут ' + where + '. ' : ''}Игры с друзьями, «Мир Денчика», чат и ролики dan4ik37. Новичку по приглашению — подарок на ${gift.lv} уровне: ${gift.coins} монет и ${String(gift.text || '').toLowerCase()}.`;
  const body = `
<main class="wrap">
  <section class="rf-card">
    <span class="rf-ic" aria-hidden="true">🎁</span>
    <small class="rf-lbl">Приглашение</small>
    <h1>${nick ? `<b>${esc(nick)}</b> зовёт тебя на сайт Денчика37` : 'Тебя зовут на сайт Денчика37'}</h1>
    ${where ? `<p class="rf-where">Зовут ${esc(where)}</p>` : ''}
    <a class="btn btn-acc rf-go" href="${esc(go)}" id="rfGo">▶ Зайти${to ? '' : ' на сайт'}</a>
    <p class="rf-gift">🎊 Новичку по приглашению — подарок на ${esc(gift.lv)} уровне: <b>${esc(gift.coins)} монет</b> и <b>${esc(String(gift.text || '').toLowerCase())}</b> для твоего персонажа.</p>
  </section>
  <ul class="rf-what">
    <li><span>🎮</span><b>40+ игр</b><small>шахматы, «Дурак», «Орда», бильярд — с ботом или с друзьями онлайн</small></li>
    <li><span>🌍</span><b>«Мир Денчика»</b><small>3D-мир: свой персонаж, столы для игр, свой участок</small></li>
    <li><span>💬</span><b>Чат и друзья</b><small>общий чат, сообщества, звонки, телефон 📱</small></li>
    <li><span>🛠️</span><b>Своя игра</b><small>конструктор игр и 3D-миров — без кода</small></li>
  </ul>
  <p class="rf-note">Ссылка ничего не просит и не даёт доступа к аккаунту. Регистрация бесплатная. Никогда не сообщай никому пароль.</p>
</main>`;
  // код — в браузер (первое касание); позвали в конкретное место — сразу туда
  const script = `try{window.d37RefStore&&d37RefStore(${JSON.stringify(code)},${JSON.stringify('link')},${JSON.stringify(to)})}catch(e){}${to ? `location.replace(${JSON.stringify(go)});` : ''}`;
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page({ title, description, url: `${SITE}/r/${code}`, image: IMG, body, script, css: CSS, noindex: true, noAds: true }));
}

function notFound(res){
  res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page({ title: 'Приглашение не найдено — сайт Денчика37', description: 'В ссылке опечатка. Попроси у друга ссылку ещё раз — или просто заходи на сайт.',
    body: `<main class="wrap"><section class="rf-card"><span class="rf-ic">🔗</span><h1>Приглашение не найдено</h1><p class="rf-where">В ссылке опечатка — попроси у друга ссылку ещё раз. Или просто заходи на сайт: игры, мир и чат — бесплатно.</p><a class="btn btn-acc rf-go" href="/#/home">▶ На сайт</a></section></main>`,
    noindex: true, noAds: true, css: CSS }));
}

const CSS = `
.rf-card{max-width:600px;margin:1.4rem auto 0;padding:2rem 1.4rem 1.6rem;border-radius:22px;background:var(--card);border:1px solid var(--line);text-align:center;display:flex;flex-direction:column;align-items:center;gap:.4rem}
.rf-ic{width:96px;height:96px;border-radius:28px;display:grid;place-items:center;font-size:3.2rem;background:linear-gradient(135deg,rgba(255,209,102,.35),rgba(255,45,85,.3));box-shadow:0 14px 34px rgba(0,0,0,.35);margin-bottom:.4rem}
.rf-lbl{font-size:.72rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.rf-card h1{margin:.1rem 0 .1rem;word-break:break-word;font-size:clamp(1.3rem,5vw,1.9rem);line-height:1.25}
.rf-card h1 b{color:#ffd166}
.rf-where{color:var(--muted);font-size:.92rem;margin:0}
.rf-go{margin-top:1rem;font-size:1.1rem;padding:.9rem 2.2rem}
.rf-gift{margin:.9rem 0 0;font-size:.86rem;color:var(--text);opacity:.9;max-width:460px}
.rf-what{list-style:none;max-width:600px;margin:1rem auto 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem}
.rf-what li{display:flex;flex-direction:column;gap:.15rem;padding:.9rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.rf-what span{font-size:1.5rem}
.rf-what b{font-size:.9rem}
.rf-what small{color:var(--muted);font-size:.76rem;line-height:1.45}
.rf-note{max-width:600px;margin:1rem auto 0;color:var(--muted);font-size:.76rem;text-align:center}
@media(max-width:480px){.rf-what{grid-template-columns:1fr}}
`;
