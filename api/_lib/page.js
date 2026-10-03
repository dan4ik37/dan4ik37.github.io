// api/_lib/page.js — общий HTML-шаблон серверных страниц (/v/<id>, /games, /games/<id>):
// шапка, подвал, мета-теги, JSON-LD, AdSense и стили. Своё у страницы — body, script и css.
import { esc } from './yt.js';

export const YT_CHANNEL = 'https://www.youtube.com/@Dan4ik37Yt';

export function page({ title, description = '', url = '', image = '', ld = null, body, noindex = false, script = '', ogType = 'website', css = '' }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
${url ? `<link rel="canonical" href="${esc(url)}">` : ''}
<meta name="theme-color" content="#ff2d55">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${url ? `<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="dan4ik37">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">` : ''}
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@400;600;700;800&family=Oswald:wght@500;600&display=swap" rel="stylesheet">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7940480593743401" crossorigin="anonymous"></script>
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
<script defer src="/_vercel/insights/script.js"></script>
<style>${CSS}${css}</style>
</head>
<body>
<header class="top">
  <a class="logo" href="/#/home">DAN4IK<span>37</span></a>
  <nav>
    <a href="/#/home">Видео</a>
    <a href="/games">Игры</a>
    <a href="/#/chat">Чат</a>
    <a href="/#/forum">Форум</a>
    <a class="sub" href="${YT_CHANNEL}?sub_confirmation=1" target="_blank" rel="noopener">Подписаться</a>
  </nav>
</header>
${body}
<footer class="foot">
  <a href="/#/home">dan4ik37</a> · <a href="/videos">Все видео</a> · <a href="/topics">Игры канала</a> · <a href="/history">История канала</a> · <a href="/games">Игры онлайн</a> · <a href="/tools/nick">Генератор ников</a> · <a href="/reklama">Реклама</a> · <a href="${YT_CHANNEL}" target="_blank" rel="noopener">YouTube</a> ·
  <a href="https://www.twitch.tv/dan4ik37" target="_blank" rel="noopener">Twitch</a> ·
  <a href="https://t.me/+LE25p4pQojkyYjli" target="_blank" rel="noopener">Telegram</a> ·
  <a href="https://vk.com/dan4ik37" target="_blank" rel="noopener">ВКонтакте</a>
</footer>
${script ? `<script>${script}</script>` : ''}
<script src="/js/core/ads-core.js"></script>
<script src="/js/core/surprise.js" defer></script>
<script src="/js/features/secrets.js" defer></script>
<script>window.D37Ads&&D37Ads.fillAll();setTimeout(function(){window.D37Ads&&D37Ads.floor()},15000);</script>
</body>
</html>`;
}

export const CSS = `
:root{--bg:#08080e;--card:#111119;--line:rgba(255,255,255,.08);--text:#f0f0f8;--muted:#8d8daa;--accent:#ff2d55;--accent2:#ff6b35;--yt:#ff4040}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:Montserrat,system-ui,sans-serif;line-height:1.6;
  background-image:radial-gradient(60% 40% at 10% 0%,rgba(255,45,85,.14),transparent 70%),radial-gradient(50% 40% at 95% 10%,rgba(145,71,255,.12),transparent 70%);background-repeat:no-repeat}
a{color:inherit}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1.2rem;background:rgba(8,8,14,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.logo{font-family:'Bebas Neue',sans-serif;font-size:1.7rem;letter-spacing:.06em;text-decoration:none}
.logo span{color:var(--accent)}
.top nav{display:flex;gap:1rem;align-items:center;font-size:.8rem;font-weight:700}
.top nav a{text-decoration:none;color:rgba(240,240,248,.75)}
.top nav a:hover{color:#fff}
.top nav .sub{padding:.45rem .9rem;border-radius:10px;background:var(--yt);color:#fff}
.wrap{max-width:1000px;margin:0 auto;padding:1.6rem 1.2rem 3rem}
.narrow{max-width:640px;text-align:center;padding-top:5rem}
.narrow h1{margin-bottom:.8rem}
.narrow p{margin-top:1rem}
.player{position:relative;aspect-ratio:16/9;border-radius:18px;overflow:hidden;background:#000;cursor:pointer;border:1px solid var(--line);box-shadow:0 30px 70px -30px rgba(0,0,0,.9),0 20px 60px -30px rgba(255,45,85,.5)}
.player img,.player iframe{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border:0}
.play{position:absolute;left:50%;top:50%;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;border:0;cursor:pointer;font-size:1.8rem;color:#fff;padding-left:6px;background:linear-gradient(135deg,#ff4040,#d90429);box-shadow:0 12px 34px -6px rgba(255,64,64,.85),0 0 0 10px rgba(255,64,64,.18);transition:transform .25s}
.player:hover .play{transform:scale(1.08)}
.dur{position:absolute;right:.8rem;bottom:.8rem;padding:.2rem .55rem;border-radius:6px;background:rgba(0,0,0,.8);font-size:.8rem;font-weight:800}
h1{font-family:Oswald,sans-serif;font-weight:600;font-size:clamp(1.4rem,3.4vw,2.2rem);line-height:1.2;margin-top:1.2rem}
h2{font-family:Oswald,sans-serif;font-weight:600;font-size:1.3rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.8rem}
.meta{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;margin-top:.5rem;font-size:.82rem;color:var(--muted)}
.cta{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.2rem}
.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.75rem 1.2rem;border-radius:12px;font:inherit;font-size:.8rem;font-weight:800;text-decoration:none;cursor:pointer;border:1px solid transparent;color:#fff}
.btn-yt{background:linear-gradient(135deg,#ff4040,#d90429);box-shadow:0 12px 30px -12px rgba(255,64,64,.8)}
.btn-acc{background:linear-gradient(135deg,var(--accent),var(--accent2))}
.btn-ghost{background:rgba(255,255,255,.04);border-color:var(--line)}
.btn-ghost:hover{border-color:rgba(255,255,255,.25)}
.desc{margin-top:1.8rem;padding:1.2rem 1.3rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.desc p{font-size:.9rem;color:rgba(240,240,248,.82);word-break:break-word}
.desc a{color:#7cc4ff}
.tags{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;margin-top:1rem}
.tags li{padding:.25rem .6rem;border-radius:999px;background:rgba(255,255,255,.05);font-size:.72rem;color:var(--muted)}
.join{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-top:2rem;padding:1.2rem 1.4rem;border-radius:16px;background:linear-gradient(90deg,rgba(255,45,85,.16),rgba(255,107,53,.1));border:1px solid rgba(255,45,85,.3)}
.join div{display:flex;flex-direction:column;gap:.2rem}
.join span{font-size:.85rem;color:rgba(240,240,248,.75)}
.more{margin-top:2.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:1rem}
.card{display:flex;flex-direction:column;gap:.5rem;text-decoration:none;border-radius:14px;overflow:hidden;background:var(--card);border:1px solid var(--line);transition:transform .25s,border-color .25s}
.card:hover{transform:translateY(-3px);border-color:rgba(255,64,64,.5)}
.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.card span{padding:0 .8rem .8rem;font-size:.8rem;font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.all{margin-top:1rem;text-align:center;font-size:.85rem;font-weight:700}
.all a{color:var(--accent)}
.muted{color:var(--muted)}
.d37-ad{display:block;margin:1.6rem auto 0;min-height:90px;text-align:center}
.d37-ad[hidden]{display:none}
.d37-ad-label{display:block;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem;opacity:.7}
.topics{margin-top:1.2rem;font-size:.85rem;color:var(--muted)}
.topics a{display:inline-block;margin:.2rem .3rem 0 0;padding:.3rem .75rem;border-radius:999px;border:1px solid var(--line);text-decoration:none;font-weight:700;color:var(--text)}
.topics a:hover{border-color:var(--accent)}
.d37-secret{border:0;background:none;padding:.2rem .35rem;font-size:.9rem;line-height:1;color:rgba(255,209,102,.4);cursor:pointer;vertical-align:middle}
.d37-secret:hover{color:#ffd166}
.d37-secret.found{display:none}
.secret-spot{text-align:center;margin-top:1.4rem}
#d37SecretToast{position:fixed;left:50%;bottom:1.4rem;transform:translate(-50%,20px);padding:.75rem 1.2rem;border-radius:14px;background:#16161f;border:1px solid rgba(255,209,102,.45);color:#fff;font-size:.85rem;font-weight:700;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;z-index:50;max-width:90vw;text-align:center}
#d37SecretToast.show{opacity:1;transform:translate(-50%,0)}
.foot{padding:2rem 1rem;text-align:center;font-size:.78rem;color:var(--muted);border-top:1px solid var(--line)}
.foot a{text-decoration:none}
@media(max-width:600px){.top nav a:not(.sub){display:none}.play{width:68px;height:68px;margin:-34px 0 0 -34px}.cta .btn{flex:1 1 100%;justify-content:center}}
`;
