// Защита от кода в чужом тексте (XSS; T-011) — без браузера и без сети.
//  1) разбор scripts/xss-scan.cjs на коротких примерах: опасное находит, безопасное пропускает;
//  2) всё дерево сайта (js/, api/, studio/, sw.js, config.js): каждое место, где значение попадает в HTML (innerHTML, шаблоны страниц,
//     ссылки, onclick, srcdoc, new Function…), либо экранировано, либо записано в scripts/xss-allowlist.json с причиной — новое без записи ломает проверку;
//  3) строки от других игроков (GameRoom.clean) — без знаков разметки уже при получении;
//  4) ленты чата, карточки, события, аватары, реакции: подборка злых строк (<img onerror>, "> <svg onload>, javascript:, //host…) — разметка не появляется;
//  5) серверные страницы (/forum, /ideas, /c/…, /r/…, /g/…, /games/…?n=, /tools/cps?n=, /tools/wheel?o=…) с подменённым Supabase: текст игроков
//     и параметры адреса не становятся разметкой; места, откуда сервер отдаёт тело ответа (res.send/end), — известные;
//  6) точечные защиты, найденные при разборе (uuid из мира, «//» в ссылках, https у виджета оплаты и ссылки рекламодателя…).
// Запуск из корня сайта: node scripts/xss-test.cjs [путь к сайту]    Новая находка: экранируй (esc) или занеси в xss-allowlist.json с причиной
// (node scripts/xss-scan.cjs показывает, что именно; --add <причина> "заметка" — занести открытые; --prune — убрать устаревшие записи).
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const S = require('./xss-scan.cjs');
S.respawnIfNeeded();                    // нужен встроенный разбор JS (acorn): перезапуск с --expose-internals
const SITE = process.argv[2] || path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : (typeof extra === 'string' ? extra : JSON.stringify(extra))); } };
const MARK = 'XSSMARK';

// ═══ Злые строки: в каждой есть метка XSSMARK — по ней видно, превратилась ли строка в разметку ═══
const PAYLOADS = [
  `<img src=x onerror=${MARK}()>`, `"><svg onload=${MARK}()>`, `'><script>${MARK}()</script>`, `" onmouseover="${MARK}()" x="`, `' onfocus='${MARK}()' autofocus='`,
  `javascript:${MARK}()`, `JaVaScRiPt:${MARK}()`, ` javascript:${MARK}()`, `java\tscript:${MARK}()`, `jav&#x61;script:${MARK}()`, `data:text/html,<script>${MARK}()</script>`,
  `</script><script>${MARK}()</script>`, `</title><img src=x onerror=${MARK}()>`, `</textarea><img src=x onerror=${MARK}()>`, `--><img src=x onerror=${MARK}()>`,
  `${String.fromCharCode(0x2028)}<img src=x onerror=${MARK}()>`, `&lt;img src=x onerror=${MARK}()&gt;`, `&#60;img src=x onerror=${MARK}()&#62;`, `%3Cimg src=x onerror=${MARK}()%3E`,
  `<a href="javascript:${MARK}()">x</a>`, `<iframe srcdoc="<script>${MARK}()</script>">`, `\${${MARK}()}`, '`' + `${MARK}` + '`', `{{constructor.constructor("${MARK}()")()}}`,
  `<style>@import "//e/${MARK}";</style>`, `<math><mtext><table><mglyph><style><img src=x onerror=${MARK}()>`, `<noscript><p title="</noscript><img src=x onerror=${MARK}()>">`,
  `\\"><img src=x onerror=${MARK}()>`, `\\u003cimg src=x onerror=${MARK}()\\u003e`, `<img src=x onerror=${MARK}()`, `<${MARK}>`, `<input autofocus onfocus=${MARK}()>`,
  `<meta http-equiv=refresh content="0;url=javascript:${MARK}()">`, `<form action="javascript:${MARK}()"><button>`, `<details open ontoggle=${MARK}()>`, `<svg><script>${MARK}()</script></svg>`,
  `Привет, мир! 😀 ${MARK}`,
];

// ═══ Маленький разбор HTML: теги, атрибуты (с расшифровкой &#…;), содержимое script/style/title/textarea ═══
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', period: '.', comma: ',', excl: '!', semi: ';' };
const decodeEntities = s => String(s).replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos|colon|tab|newline|lpar|rpar|sol|period|comma|excl|semi));?/gi,
  (m, h, d, n) => (n ? ENT[n.toLowerCase()] : String.fromCodePoint(h ? parseInt(h, 16) : +d)));
function tokenize(html){
  const tags = []; const n = html.length; let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i); if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?' || html[lt + 1] === '/') { const e = html.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const m = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 80)); if (!m) { i = lt + 1; continue; }
    let j = lt + m[0].length; const attrs = [];
    for (;;) {
      while (j < n && /[\s/]/.test(html[j])) j++;
      if (j >= n) break;
      if (html[j] === '>') { j++; break; }
      let k = j; while (k < n && !/[\s=/>]/.test(html[k])) k++;
      if (k === j) k = j + 1;
      const name = html.slice(j, k); j = k;
      while (j < n && /\s/.test(html[j])) j++;
      let value = '';
      if (html[j] === '=') {
        j++; while (j < n && /\s/.test(html[j])) j++;
        if (html[j] === '"' || html[j] === "'") { const q = html[j], e = html.indexOf(q, j + 1); value = html.slice(j + 1, e < 0 ? n : e); j = e < 0 ? n : e + 1; }
        else { let e = j; while (e < n && !/[\s>]/.test(html[e])) e++; value = html.slice(j, e); j = e; }
      }
      attrs.push({ n: name, v: decodeEntities(value) });
    }
    const tag = { name: m[1].toLowerCase(), attrs, body: '' };
    i = j;
    if (/^(script|style|textarea|title|xmp|iframe|noembed|noframes)$/.test(tag.name)) {
      const rest = html.slice(i), mm = new RegExp('</' + tag.name + '[\\s/>]', 'i').exec(rest);
      tag.body = mm ? rest.slice(0, mm.index) : rest; i += mm ? mm.index : rest.length;
    }
    tags.push(tag);
  }
  return tags;
}
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'data', 'poster', 'background', 'ping', 'xlink:href', 'codebase', 'cite', 'manifest']);
const SPACE_CODES = new Set([0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]); for (let c = 0x2000; c <= 0x200d; c++) SPACE_CODES.add(c);
const stripSpaces = s => Array.from(s).filter(ch => { const c = ch.codePointAt(0); return c > 32 && !SPACE_CODES.has(c); }).join('');   // как браузер читает «java\tscript:» в ссылке
// что в разметке указывает на «сработавшую» злую строку (метка XSSMARK попала в тег, событие, ссылку, скрипт, стиль)
function danger(html){
  const bad = [], mark = MARK.toLowerCase();
  for (const t of tokenize(String(html))) {
    if (t.name.includes(mark)) bad.push(`тег <${t.name}>`);
    const ld = t.name === 'script' && t.attrs.some(a => a.n.toLowerCase() === 'type' && /json/i.test(a.v));
    if ((t.name === 'script' || t.name === 'style') && !ld && t.body.toLowerCase().includes(mark)) bad.push(`<${t.name}> с меткой внутри`);
    for (const a of t.attrs) {
      const n = a.n.toLowerCase(), v = a.v, vl = v.toLowerCase(), flat = stripSpaces(vl);
      if (n.includes(mark)) bad.push(`атрибут ${n} в <${t.name}>`);
      if (/^on/.test(n) && vl.includes(mark)) bad.push(`${n}= в <${t.name}>`);
      if (n === 'srcdoc' && vl.includes(mark)) bad.push(`srcdoc в <${t.name}>`);
      if (URL_ATTRS.has(n) && /^(javascript|vbscript|data):/.test(flat) && vl.includes(mark)) bad.push(`${n}="${flat.slice(0, 24)}…" в <${t.name}>`);
      if (n === 'content' && t.name === 'meta' && t.attrs.some(x => x.n.toLowerCase() === 'http-equiv' && /refresh/i.test(x.v)) && flat.includes('javascript:') && vl.includes(mark)) bad.push('meta refresh на javascript:');
      if (n === 'style' && /expression\(|javascript:|@import|behavior:/i.test(v) && vl.includes(mark)) bad.push(`style в <${t.name}>`);
    }
  }
  return bad;
}
const hrefsOf = html => tokenize(String(html)).flatMap(t => t.attrs.filter(a => a.n.toLowerCase() === 'href').map(a => a.v));
const noDanger = (html, name) => ok(danger(html).length === 0, name, { bad: danger(html).slice(0, 3), html: String(html).slice(0, 240) });

// проверка самой проверки: на заведомо плохом и заведомо хорошем
function selfCheck(){
  ok(danger(`<div title="${MARK}">ok</div> <b>&lt;img src=x onerror=${MARK}()&gt;</b>`).length === 0, 'проверка разметки: экранированное и значение в title — не тревога');
  ok(danger(`<b><img src=x onerror=${MARK}()></b>`).length > 0, 'проверка разметки: <img onerror> — тревога');
  ok(danger(`<a href="jav&#x09;ascript:${MARK}()">x</a>`).length > 0 && danger(`<a href=" JavaScript:${MARK}()">x</a>`).length > 0, 'проверка разметки: javascript: в ссылке (и с &#x09;, и с пробелом) — тревога');
  ok(danger(`<div title="a" ${MARK}=1>`).length > 0 && danger(`<div title="a" onmouseover="${MARK}()">`).length > 0, 'проверка разметки: чужой атрибут / событие — тревога');
  ok(danger(`<script type="application/ld+json">{"a":"${MARK}"}</script>`).length === 0 && danger(`<script type="application/ld+json">{"a":"</script><script>${MARK}()</script>"}</script>`).length > 0, 'проверка разметки: JSON-LD с меткой — можно, закрытый чужой </script> — тревога');
  ok(danger(`<meta name="description" content="javascript:${MARK}()">`).length === 0 && danger(`<meta http-equiv=refresh content="0;url=javascript:${MARK}()">`).length > 0, 'проверка разметки: meta description с текстом — можно, meta refresh на javascript: — тревога');
  ok(danger(`<title>x</title><textarea>${MARK}</textarea>`).length === 0 && danger(`<style>${MARK}</style>`).length > 0, 'проверка разметки: textarea/title — текст, style с меткой — тревога');
}

(async () => {
  selfCheck();

  // ═══ 1. Разбор: короткие примеры ═══
  {
    const utils = src('js/core/utils.js');
    const C = {   // имя: [код, должна быть находка?]
      'текст без esc': ["function f(m, el){ el.innerHTML = '<b>' + m.nick + '</b>'; }", 1],
      'шаблон без esc': ["function f(m, el){ el.innerHTML = `<b>${m.nick}</b>`; }", 1],
      'шаблон с esc': ["function f(m, el){ el.innerHTML = `<b>${esc(m.nick)}</b>`; }", 0],
      'атрибут без esc': ["function f(m, el){ el.innerHTML = `<div title=\"${m.title}\">x</div>`; }", 1],
      'атрибут с esc': ["function f(m, el){ el.innerHTML = `<div title=\"${esc(m.title)}\">x</div>`; }", 0],
      'атрибут без кавычек': ["function f(m, el){ el.innerHTML = `<div title=${esc(m.title)}>x</div>`; }", 1],
      'ссылка: esc не защищает схему': ["function f(m, el){ el.innerHTML = `<a href=\"${esc(m.url)}\">x</a>`; }", 1],
      'ссылка со своим началом /': ["function f(m, el){ el.innerHTML = `<a href=\"/p/${esc(m.id)}\">x</a>`; }", 0],
      'ссылка #/': ["function f(m, el){ el.innerHTML = `<a href=\"#/p/${esc(m.id)}\">x</a>`; }", 0],
      'ссылка https://': ["function f(m, el){ el.innerHTML = `<a href=\"https://x.test/${esc(m.id)}\">x</a>`; }", 0],
      'onclick без jsAttr': ["function f(m, el){ el.innerHTML = `<button onclick=\"go('${m.id}')\">x</button>`; }", 1],
      'onclick с esc (не защищает JS)': ["function f(m, el){ el.innerHTML = `<button onclick=\"go('${esc(m.id)}')\">x</button>`; }", 1],
      'onclick с jsAttr': ["function f(m, el){ el.innerHTML = `<button onclick=\"go(${jsAttr(m.id)})\">x</button>`; }", 0],
      'onclick с числом': ["function f(m, el){ el.innerHTML = `<button onclick=\"go(${+m.id})\">x</button>`; }", 0],
      'style без защиты': ["function f(m, el){ el.innerHTML = `<div style=\"color:${m.color}\">x</div>`; }", 1],
      'style с esc (не защищает CSS)': ["function f(m, el){ el.innerHTML = `<div style=\"color:${esc(m.color)}\">x</div>`; }", 1],
      'style с числом': ["function f(m, el){ el.innerHTML = `<div style=\"width:${m.w | 0}px\">x</div>`; }", 0],
      'числа в тексте': ["function f(m, el){ el.innerHTML = `<b>${Number(m.n)}</b><i>${m.k | 0}</i><u>${Math.round(m.p)}</u>`; }", 0],
      'insertAdjacentHTML': ["function f(m, el){ el.insertAdjacentHTML('beforeend', '<b>' + m.t + '</b>'); }", 1],
      'outerHTML': ["function f(m, el){ el.outerHTML = '<b>' + m.t + '</b>'; }", 1],
      'document.write': ["function f(m){ document.write('<b>' + m.t + '</b>'); }", 1],
      'innerHTML = чужое': ["function f(m, el){ el.innerHTML = m.html; }", 1],
      'innerHTML = пусто': ["function f(m, el){ el.innerHTML = ''; }", 0],
      'textContent': ["function f(m, el){ el.textContent = m.t; }", 0],
      'srcdoc': ["function f(m, fr){ fr.srcdoc = m.t; }", 1],
      'new Function': ["function f(m){ return new Function(m.t); }", 1],
      'eval': ["function f(m){ return eval(m.t); }", 1],
      'location.href = чужое': ["function f(m){ location.href = m.u; }", 1],
      'location.href = свой путь': ["function f(m){ location.href = '/x/' + encodeURIComponent(m.u); }", 0],
      'window.open': ["function f(m){ window.open(m.u); }", 1],
      'a.href = чужое': ["function f(m, a){ a.href = m.u; }", 1],
      'iframe.src = чужое': ["function f(m){ const fr = document.createElement('iframe'); fr.src = m.u; }", 1],
      'script.src = чужое': ["function f(m){ const s = document.createElement('script'); s.src = m.u; }", 1],
      'setAttribute(href)': ["function f(m, a){ a.setAttribute('href', m.u); }", 1],
      'setAttribute(onclick)': ["function f(m, a){ a.setAttribute('onclick', m.u); }", 1],
      'данные в <script> без </ ': ["function f(m){ return `<script>var a=${JSON.stringify(m.t)};</script>`; }", 1],
      'данные в <script> с \\u003c': ["function f(m){ return `<script>var a=${JSON.stringify(m.t).replace(/</g, '\\\\u003c')};</script>`; }", 0],
      'через функцию-шаблон': ["function row(n){ return '<i>' + n + '</i>'; } function g(m, el){ el.innerHTML = row(m.nick); }", 1],
      'через функцию-шаблон с esc': ["function row(n){ return '<i>' + n + '</i>'; } function g(m, el){ el.innerHTML = row(esc(m.nick)); }", 0],
      'map().join()': ["function f(list, el){ el.innerHTML = list.map(m => `<li>${m.nick}</li>`).join(''); }", 1],
      'map().join() с esc': ["function f(list, el){ el.innerHTML = list.map(m => `<li>${esc(m.nick)}</li>`).join(''); }", 0],
      'свой «esc» без < и >': ["const esc2 = s => String(s).replace(/\"/g, '&quot;'); function f(m, el){ el.innerHTML = `<b>${esc2(m.nick)}</b>`; }", 1],
      'таблица-константа': ["const T = { a: ['x','y'] }; function f(k, el){ el.innerHTML = `<b>${T[k][0]}</b>`; }", 0],
      'условие с константами': ["function f(m, el){ el.innerHTML = `<b>${m.ok ? 'да' : 'нет'}</b>`; }", 0],
      'условие с чужим': ["function f(m, el){ el.innerHTML = `<b>${m.ok ? m.name : 'нет'}</b>`; }", 1],
      'проверка регулярным выражением': ["function f(m, el){ const c = /^[a-z0-9]{6}$/.test(m.c) ? m.c : ''; el.innerHTML = `<b data-c=\"${c}\">x</b>`; }", 0],
      'dataset': ["function f(el, box){ box.innerHTML = `<b>${el.dataset.name}</b>`; }", 1],
      'textContent прочитан': ["function f(el, box){ box.innerHTML = `<b>${el.textContent}</b>`; }", 1],
      'location.hash': ["function f(box){ box.innerHTML = `<b>${location.hash}</b>`; }", 1],
      'параметр адреса': ["function f(box){ const p = new URLSearchParams(location.search); box.innerHTML = `<b>${p.get('x')}</b>`; }", 1],
    };
    const files = { 'js/core/utils.js': utils };
    for (const [k, [code]] of Object.entries(C)) files['js/fx/' + Object.keys(C).indexOf(k) + '.js'] = code;
    const r = S.scanTexts(files);
    ok(r.errors.length === 0, 'разбор: примеры читаются', r.errors);
    const by = new Map();
    for (const f of r.findings) by.set(f.file, (by.get(f.file) || 0) + 1);
    let n = 0;
    for (const [k, [, want]] of Object.entries(C)) {
      const got = by.get('js/fx/' + n++ + '.js') || 0;
      ok((got > 0) === !!want, `разбор: ${k} — ${want ? 'находка' : 'чисто'}`, { got });
    }
    // utils.js сам: его esc / jsAttr / safeImgUrl — «доверенные» только потому, что тело разобрано
    ok(!r.findings.some(f => f.file === 'js/core/utils.js'), 'разбор: в js/core/utils.js (esc, jsAttr, safeImgUrl) находок нет');
  }

  // ═══ 2. Дерево сайта ═══
  {
    const L = S.loadAllowlist(path.join(SITE, 'scripts/xss-allowlist.json'));
    ok(!L.error && L.al.groups && L.al.groups.length > 0, 'список проверенных находок читается', L.error);
    ok(L.bad.length === 0, 'у каждой группы в списке есть причина из claims', L.bad.slice(0, 3));
    const t0 = Date.now();
    const R = S.scan(SITE, { config: L.al });
    ok(R.errors.length === 0, 'все файлы сайта читает разбор JS', R.errors.slice(0, 3));
    ok(R.files > 250, 'разобрано файлов: больше 250', R.files);
    const A = S.applyAllowlist(R.findings, L.map);
    const show = f => `${f.file}:${f.line} [${f.fn}] ${f.kind === 'sink' ? 'SINK ' + f.sink : f.ctx + (f.attr ? ':' + f.attr : '')}: ${f.x}`;
    ok(A.open.length === 0, `новых непроверенных находок нет (${A.open.length}). Экранируй значение через esc()/jsAttr() или занеси в scripts/xss-allowlist.json с причиной`, A.open.slice(0, 15).map(show));
    // «опасные» окружения — причины, которые там не годятся: чужие строки после GameRoom.clean не защищены в JS-коде атрибута, ссылке, стиле, имени тега
    const RISKY = { on: ['id-db', 'enum', 'num-db', 'num-local', 'const', 'regex', 'esc-up', 'id-yt', 'id-server', 'dom-rt', 'sql-checked'],
      url: ['url-checked', 'server-url', 'id-db', 'id-yt', 'id-server', 'const', 'regex', 'esc-up', 'num-db', 'num-local', 'enum', 'yt-data', 'dom-rt', 'admin', 'self-made'],
      style: ['sql-checked', 'enum', 'const', 'num-db', 'num-local', 'regex', 'url-checked', 'esc-up', 'admin', 'id-db'],
      unq: ['const', 'num-db', 'num-local', 'id-db', 'enum', 'regex'], attrs: ['const', 'html-arg', 'html-helper', 'enum'], attrname: ['const'], tagname: ['const', 'not-html'] };
    const badClaims = [];
    for (const f of A.allowed) {
      const g = L.map.get(S.keyOf(f)), ctx = f.kind === 'sink' ? null : f.ctx;
      if (ctx && RISKY[ctx] && !RISKY[ctx].includes(g.c)) badClaims.push(`${f.file}:${f.line} ${ctx}: ${f.x} — причина «${g.c}» здесь не годится`);
    }
    ok(badClaims.length === 0, 'причины в списке подходят окружению (в onclick, ссылке, стиле — нельзя «после GameRoom.clean» и т. п.)', badClaims.slice(0, 6));
    const stale = A.stale.length;
    console.log(`  разобрано: файлов ${R.files}, единиц разметки ${R.stats.units}, вставок в них ${R.stats.interps}, приёмников (innerHTML, href, onclick-строк, srcdoc, new Function…) ${R.stats.sinks}`);
    console.log(`  разбор: файлов ${R.files}, находок ${R.findings.length}, в списке проверенных ${A.allowed.length} (записей ${L.map.size}, устаревших ${stale}), ${((Date.now() - t0) / 1000).toFixed(1)} с`);
    if (stale > 0) console.log(`  (устаревшие записи ничего не скрывают; убрать: node scripts/xss-scan.cjs --prune)`);
    const byClaim = {};
    for (const f of A.allowed) { const c = L.map.get(S.keyOf(f)).c; byClaim[c] = (byClaim[c] || 0) + 1; }
    console.log('  по причинам:', Object.entries(byClaim).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  }

  // ═══ 3. GameRoom.clean: строки от других игроков ═══
  {
    const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, Object, Array, String, Number, navigator: { onLine: true }, sessionStorage: { getItem: () => null, setItem(){} },
      document: { addEventListener(){}, querySelector: () => null }, addEventListener(){}, removeEventListener(){} };
    sb.window = sb; vm.createContext(sb);
    vm.runInContext(src('js/games/room.js'), sb, { filename: 'room.js' });
    const clean = sb.window.GameRoom?.clean;
    ok(typeof clean === 'function', 'GameRoom.clean есть');
    const BAD = /[<>&"'`]/;
    const allStrings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') for (const k of Object.keys(v)) allStrings(v[k], out); return out; };
    for (const p of PAYLOADS) {
      const c = clean({ nick: p, text: p, deep: { list: [p, { x: p }], n: 5 }, arr: [[p]] });
      ok(!allStrings(c).some(s => BAD.test(s)), 'GameRoom.clean: чужая строка без < > & " \' `', p.slice(0, 40));
      ok(!BAD.test(clean(p)), 'GameRoom.clean: строкой', p.slice(0, 40));
    }
    ok(clean(5) === 5 && clean(true) === true && clean(null) === null && clean(undefined) === undefined && clean(1.5) === 1.5, 'GameRoom.clean: числа, да/нет, пусто — как есть');
    const same = { t: 'Привет, мир! 😀 (ход 5: e2–e4) #1 100% [ok] {a} ~x_y | z', n: 7, b: false, a: [1, 'два', null] };
    ok(JSON.stringify(clean(same)) === JSON.stringify(same), 'GameRoom.clean: обычный текст (русский, эмодзи, скобки) не меняется');
    const evil = JSON.parse('{"__proto__":{"polluted":1},"a":{"__proto__":{"p2":1}}}');
    const ce = clean(evil);
    ok(!Object.prototype.hasOwnProperty.call(ce, '__proto__') && ({}).polluted === undefined && ({}).p2 === undefined && ce.a && ce.a.p2 === undefined, 'GameRoom.clean: __proto__ из чужого JSON не проходит');
    let deep = { v: 'x' }; for (let i = 0; i < 40; i++) deep = { d: deep };
    ok(JSON.stringify(clean(deep)).length < 400, 'GameRoom.clean: слишком глубокая вложенность обрезается (не зависает и не падает)');
    // кто вызывает clean при получении: комната, стол (общий канал, личные, расшифрованные), NetPlay, «Крокодил»
    const cnt = (f, re) => (src(f).match(re) || []).length;
    ok(cnt('js/games/room.js', /onMessage\?\.\(clean\(payload\)/g) === 1, 'room.js: сообщения комнаты — через clean');
    ok(cnt('js/games/table.js', /GameRoom\.clean\(/g) >= 3, 'table.js: общий канал, личные и расшифрованные — через GameRoom.clean', cnt('js/games/table.js', /GameRoom\.clean\(/g));
    ok(/GameRoom\?\.clean \? window\.GameRoom\.clean\(m\)/.test(src('js/games/netplay.js')) || /GameRoom\.clean\(m\)/.test(src('js/games/netplay.js')), 'netplay.js: сообщения напарника — через GameRoom.clean');
    ok(/GameRoom\?\.clean \? root\.GameRoom\.clean\(m\)/.test(src('js/games/krokodil.js')), 'krokodil.js: всё от хозяина — через GameRoom.clean');
  }

  // ═══ 4. Отрисовщики на клиенте: ленты, карточки, события, аватары, реакции, esc / jsAttr ═══
  {
    const mkEl = () => ({ style: {}, dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '', classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      appendChild(c){ return c; }, prepend(){}, remove(){}, setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){},
      querySelector(){ return null; }, querySelectorAll(){ return []; }, contains(){ return false; }, focus(){}, closest(){ return null; } });
    const sb = {
      console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval(){}, Date, Math, JSON, Promise, URL, URLSearchParams, Intl, encodeURIComponent, decodeURIComponent, Map, Set,
      localStorage: { s: {}, getItem(k){ return this.s[k] ?? null; }, setItem(k, v){ this.s[k] = String(v); }, removeItem(k){ delete this.s[k]; } },
      sessionStorage: { getItem: () => null, setItem(){} }, matchMedia: () => ({ matches: false }), requestAnimationFrame: f => setTimeout(f, 0),
      CustomEvent: class { constructor(t, o){ this.type = t; this.detail = o?.detail; } }, Event: class { constructor(t){ this.type = t; } },
      GAMES: [{ id: 'chess', icon: '♟️', title: 'Шахматы', desc: 'Шахматы со всеми правилами', color: '#e5e7eb' }, { id: 'uno', icon: '🃏', title: 'Одна!', desc: 'Карты', color: '#e5383b' }],
      customEmoji: [{ name: 'dan', image_url: 'https://x.supabase.co/storage/v1/object/public/emoji/dan.png' }], EMOJI: ['👍', '❤️', '😂'], currentRoute: () => 'home', currentUser: null, chatNick: 'me',
      document: { createElement: mkEl, body: mkEl(), documentElement: mkEl(), head: mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, removeEventListener(){}, hidden: false },
      navigator: { onLine: true, userAgent: 'node' }, location: { origin: 'https://dan4ik37.vercel.app', hash: '', pathname: '/', search: '', href: 'https://dan4ik37.vercel.app/' },
    };
    sb.window = sb; sb.globalThis = sb; sb.addEventListener = () => {}; sb.removeEventListener = () => {}; sb.dispatchEvent = () => true;
    vm.createContext(sb);
    for (const f of ['js/core/utils.js', 'js/features/phone.js', 'js/features/msgview.js', 'js/features/reactions.js']) vm.runInContext(src(f), sb, { filename: f });
    const run = code => vm.runInContext(code, sb);
    const MV = sb.MsgView, P = sb.D37Phone;
    ok(MV && P && typeof run('renderEmoji') === 'function', 'клиентские файлы загрузились (utils, phone, msgview, reactions)');
    const esc = run('esc'), jsAttr = run('jsAttr'), safeImgUrl = run('safeImgUrl');
    ok(/&lt;img src=x onerror=XSSMARK\(\)&gt;/.test(MV.rich(PAYLOADS[0], 'me').html) && /&lt;img/.test(run('renderEmoji')(run('findEmojiDef')(PAYLOADS[0]))), 'контроль: злая строка видна в ленте и в реакции как текст (экранированная), а не пропала');

    // esc / jsAttr / safeImgUrl на злых строках
    for (const p of PAYLOADS) {
      const e = esc(p);
      ok(!/[<>"']/.test(e) && !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(e), 'esc: нет < > " \', & — только начало знака', p.slice(0, 40));
      // jsAttr в onclick="f(${jsAttr(x)})": браузер расшифровывает знаки в значении, потом читает как JS — получится ровно исходная строка
      const a = jsAttr(p);
      ok(!/"/.test(a) && vm.runInNewContext('(' + decodeEntities(a) + ')') === p, 'jsAttr: значение не выходит из атрибута и читается как та же строка', p.slice(0, 40));
      ok(safeImgUrl(p) === '' || /^(https:\/\/|data:image\/)/.test(safeImgUrl(p)), 'safeImgUrl: злая строка не проходит', p.slice(0, 40));
    }
    ok(safeImgUrl('https://x.supabase.co/storage/v1/object/public/avatars/a.png') !== '' && safeImgUrl("https://x.test/a'b.png") === '' && safeImgUrl('javascript:alert(1)') === '', 'safeImgUrl: свой адрес проходит, кавычка и javascript: — нет');

    // лента чата
    for (const p of PAYLOADS) {
      for (const text of [p, 'до ' + p + ' после', `https://dan4ik37.vercel.app/#/games/chess/${p}`, `@${p} ${p}`, `:${p}:`]) {
        const html = MV.rich(text, p).html;
        ok(danger(html).length === 0, 'MsgView.rich: злая строка не становится разметкой', { bad: danger(html).slice(0, 2), text: text.slice(0, 60), html: html.slice(0, 200) });
      }
      const card = MV.cardOf(`#/games/chess/${p}`) || MV.cardOf(`/g/${p}`) || MV.cardOf(`/c/${p}`) || MV.cardOf(`/v/${p}`);
      ok(card === null || (card && /^[A-Za-z0-9_-]{4,20}$/.test(String(card.code || card.id || 'abcd'))), 'MsgView.cardOf: злая строка не становится карточкой с чужим кодом', card);
    }
    // ссылки в ленте: только свои пути
    for (const u of ['https://dan4ik37.vercel.app//evil.example/x', 'https://dan4ik37.vercel.app/\\evil.example', 'dan4ik37.vercel.app//evil.example', 'http://dan4ik37.vercel.app//evil.example/a', 'https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', 'https://dan4ik37.vercel.app.evil.example/x', 'https://dan4ik37.vercel.app@evil.example/x']) {
      const hs = hrefsOf(MV.rich('смотри ' + u + ' тут', '').html);
      ok(hs.every(h => /^#\/[^/\\]/.test(h) || /^\/[^/\\]/.test(h) || h === '/' ), 'MsgView.rich: ссылка только на свой путь (не //host)', { u, hs });
    }
    ok(hrefsOf(MV.rich('го https://dan4ik37.vercel.app/#/games/chess/abc123 сюда', '').html).length === 1, 'MsgView.rich: настоящая ссылка на сайт остаётся ссылкой');
    // события
    for (const p of PAYLOADS) {
      MV.evSet({ id: 5, title: p, about: p, starts_at: '2026-10-22T10:00:00Z', ends_at: '2026-10-22T11:00:00Z', status: 'active', going: 3, mine: false, place_kind: 'text', place: p, place_name: p, community: 7, age: 0, creator: p, cname: p, cicon: p });
      const html = MV.evCardHtml(5);
      ok(danger(html).length === 0, 'MsgView.evCardHtml: название/место события не становятся разметкой', { bad: danger(html).slice(0, 2), html: html.slice(0, 200) });
      const pl = MV.evPlace({ place_kind: 'game', place: p, community: 0 });
      ok(/^#\//.test(pl.href) || pl.href === '' || /^https:\/\/www\.twitch\.tv\//.test(pl.href), 'MsgView.evPlace: ссылка места — «#/…» или Twitch', pl.href);
    }
    // аватар и ник (телефон, друзья, лента)
    for (const p of PAYLOADS) {
      const html = P.avatar({ nick: p, avatar_url: p, role: 'user' }, p, 36) + P.nick({ nick: p, role: 'admin' }, p) + P.avatar(null, p, 20);
      ok(danger(html).length === 0, 'D37Phone.avatar / nick: ник и адрес картинки не становятся разметкой', { bad: danger(html).slice(0, 2), html: html.slice(0, 200) });
    }
    // реакции: findEmojiDef отдаёт {char: значение_из_базы} для незнакомых — раньше вставлялось как есть
    for (const p of PAYLOADS) noDanger(run('renderEmoji')(run('findEmojiDef')(p)), 'renderEmoji: чужое «эмодзи» из базы не становится разметкой');
    ok(run('renderEmoji')(run('findEmojiDef')('👍')) === '👍' && /<img src="https:\/\/x\.supabase\.co/.test(run('renderEmoji')(run('findEmojiDef')(':dan:'))), 'renderEmoji: обычные и свои эмодзи — как были');
  }

  // ═══ 5. Серверные страницы с подменённым Supabase ═══
  {
    const tmp = fs.mkdtempSync(path.join(process.env.D37_TMP || os.tmpdir(), 'd37-xss-api-'));
    try {
      fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
      process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';
      let CUR = 'Привет';   // чужой текст, который «лежит в базе» прямо сейчас
      const J = b => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      globalThis.fetch = async (url) => {
        const u = String(url), P = CUR, now = '2026-10-01T10:00:00Z';
        if (u.includes('/rest/v1/forum_threads?id=eq.5&')) return J([{ id: 5, title: P, author_id: U1, pinned: false, locked: false, created_at: now }]);
        if (u.includes('/rest/v1/forum_threads?id=eq.')) return J([]);
        if (u.includes('/rest/v1/forum_threads?select=id,title')) return J([{ id: 5, title: P, author_id: U1, pinned: true, locked: false, created_at: now, forum_posts: [{ count: 3 }] }]);
        if (u.includes('/rest/v1/forum_threads?select=id,created_at')) return J([{ id: 5, created_at: now }]);
        if (u.includes('/rest/v1/forum_posts?thread_id=eq.5')) return J([{ id: 1, author_id: U1, body: `${P} dan4ik37.vercel.app//evil.example/x https://dan4ik37.vercel.app/\\evil.example **${P}** ||${P}||`, created_at: now }, { id: 2, author_id: U2, body: P, created_at: now }]);
        if (u.includes('/rest/v1/profiles?id=in.')) return J([{ id: U1, nick: P, role: 'user' }, { id: U2, nick: P, role: 'moderator' }]);
        if (u.includes('/rest/v1/rpc/list_ideas')) return J([{ id: 9, author_id: U1, author_nick: P, author_role: null, title: P, body: P, status: 'planned', video_id: null, votes: 12, created_at: now }]);
        if (u.includes('/rest/v1/ideas?id=eq.9')) return J([{ id: 9, author_id: U1, title: P, body: P + ' ' + P, status: 'done', video_id: 'dQw4w9WgXcQ', votes: 12, created_at: now, status_changed_at: now }]);
        if (u.includes('/rest/v1/ideas?id=eq.')) return J([]);
        if (u.includes('/rest/v1/ideas?status=neq.rejected')) return J([{ id: 9, created_at: now, status_changed_at: now }]);
        if (u.includes('/rest/v1/rpc/cm_invite_info')) return J({ name: P, about: P, icon: P, members: 3, public: true, age: 0, code: 'abcd1234' });
        if (u.includes('/rest/v1/rpc/ref_public')) return J({ ok: true, nick: P, gift: { lv: 3, coins: 50, text: P } });
        if (u.includes('/rest/v1/ugc_games?id=eq.abcd1234&status')) return J([{ id: 'abcd1234', title: P, descr: P, icon: P, kind: 'tpl', tpl: 'runner', status: 'public', plays: 3, likes: 1, created_at: now, author: U1, profiles: { nick: P, role: 'user' } }]);
        if (u.includes('/rest/v1/ugc_games?id=eq.abcd1234&select=age_rating')) return J([{ age_rating: 12 }]);
        if (u.includes('/rest/v1/ugc_games?')) return J([{ id: 'beef0001', title: P, icon: P, plays: 2, likes: 1, author: U1, profiles: { nick: P, role: 'user' }, descr: P, kind: 'tpl', tpl: 'runner', status: 'public', created_at: now }]);
        if (/googleapis|youtube/.test(u)) return new Response('{}', { status: 500 });
        return J([]);
      };
      const imp = async f => (await import(pathToFileURL(path.join(tmp, f)).href)).default;
      const pages = await imp('api/pages.js'), game = await imp('api/game.js'), video = await imp('api/video.js'), sitemap = await imp('api/sitemap.js');
      const call = async (handler, q) => {
        const out = { code: 200, headers: {}, body: '' };
        const res = { status(c){ out.code = c; return res; }, setHeader(k, v){ out.headers[k] = String(v); return res; }, send(b){ out.body = String(b ?? ''); return res; }, end(b){ out.body = String(b ?? ''); return res; }, json(b){ out.body = JSON.stringify(b); return res; }, redirect(c, u){ out.code = u ? c : 302; out.headers.Location = u || c; return res; } };
        await handler({ query: q, headers: {}, method: 'GET', url: '/' }, res);
        return out;
      };
      const ldOk = body => [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].every(m => { try { JSON.parse(m[1]); return true; } catch (e) { return false; } });
      const MATRIX = [   // [название, обработчик, запрос]
        ['/forum', pages, { page: 'forum' }], ['/forum/5', pages, { page: 'forum', id: '5' }], ['/ideas', pages, { page: 'ideas' }], ['/ideas/9', pages, { page: 'ideas', id: '9' }],
        ['/c/abcd1234', pages, { page: 'invite', code: 'abcd1234' }], ['/r/bcdfgh', pages, { page: 'r', code: 'bcdfgh' }], ['/g/abcd1234', pages, { page: 'ugc', id: 'abcd1234' }], ['/studio', pages, { page: 'ugc' }],
      ];
      // 5.0. контроль самого стенда: подменная база доходит до страниц (иначе проверки ниже ничего бы не проверяли) и опасное ловится
      CUR = PAYLOADS[0];
      for (const [name, h, q] of MATRIX) {
        const r = await call(h, q);
        ok(r.code === 200 && r.body.includes(MARK + '()') && /&lt;img src=x onerror=XSSMARK\(\)&gt;/.test(r.body), `${name}: текст из подменной базы виден на странице (экранированным)`, { code: r.code, has: r.body.includes(MARK) });
      }
      {   // тот же invite.js, но с вынутым esc() у названия: стенд обязан это заметить
        const badSrc = fs.readFileSync(path.join(tmp, 'api/_lib/routes/invite.js'), 'utf8').replace('<h1>${esc(name)}</h1>', '<h1>${name}</h1>');
        ok(badSrc.includes('<h1>${name}</h1>'), 'контроль: в копии invite.js убрано экранирование названия');
        fs.writeFileSync(path.join(tmp, 'api/_lib/routes/invite-bad.js'), badSrc);
        const bad = await imp('api/_lib/routes/invite-bad.js');
        const r = await call(bad, { code: 'abcd1234' });
        ok(danger(r.body).length > 0, 'контроль: страница без esc() у названия сообщества — стенд поднимает тревогу', r.body.slice(0, 120));
      }
      // 5.1. текст «из базы»
      for (const p of PAYLOADS) {
        CUR = p;
        for (const [name, h, q] of MATRIX) {
          const r = await call(h, q);
          ok(r.code === 200 && danger(r.body).length === 0 && ldOk(r.body), `${name}: чужой текст из базы не становится разметкой`, { bad: danger(r.body).slice(0, 3), code: r.code, ld: ldOk(r.body), p: p.slice(0, 50) });
        }
      }
      // 5.2. параметры адреса
      CUR = 'Привет';
      const Q = [
        ['/r/…?to=', pages, p => ({ page: 'r', code: 'bcdfgh', to: p })], ['/r/<код>', pages, p => ({ page: 'r', code: p })], ['/c/<код>', pages, p => ({ page: 'invite', code: p })], ['/g/<id>', pages, p => ({ page: 'ugc', id: p })],
        ['/games/chess?n=&s=', game, p => ({ id: 'chess', s: '55', n: p })], ['/games/<id>', game, p => ({ id: p })], ['/tools/cps?n=&s=', pages, p => ({ page: 'cps', n: p, s: '7' })],
        ['/quiz/minecraft?r=', pages, p => ({ page: 'quiz', slug: 'minecraft', r: p })], ['/quiz/<slug>', pages, p => ({ page: 'quiz', slug: p })], ['/tools/wheel?o=', pages, p => ({ page: 'wheel', o: p + '|ещё|' + p })],
        ['/topic/<slug>', pages, p => ({ page: 'topic', slug: p })], ['/videos?p=', pages, p => ({ page: 'videos', p })], ['/shop/o/<заказ>', pages, p => ({ page: 'shop', o: p })], ['/terms', pages, p => ({ page: p })],
        ['/forum/<id>', pages, p => ({ page: 'forum', id: p })], ['/ideas/<id>', pages, p => ({ page: 'ideas', id: p })], ['/v/<id>', video, p => ({ id: p })], ['/go/<id>', pages, p => ({ page: 'go', id: p, t: p })], ['/sitemap.xml?part=', sitemap, p => ({ part: p })], ['/tools/typing?s=', pages, p => ({ page: 'typing', s: p })],
      ];
      for (const p of PAYLOADS) for (const [name, h, mk] of Q) {
        let r; try { r = await call(h, mk(p)); } catch (e) { ok(false, `${name}: не падает на злой строке`, String(e.message || e).slice(0, 120)); continue; }
        ok(danger(r.body).length === 0 && ldOk(r.body), `${name}: параметр адреса не становится разметкой`, { bad: danger(r.body).slice(0, 3), code: r.code, p: p.slice(0, 50) });
        if (r.headers.Location != null) ok(!/[\r\n]/.test(r.headers.Location) && !/^\s*(javascript|data):/i.test(r.headers.Location), `${name}: адрес перехода без переноса строки и javascript:`, r.headers.Location);
      }
      // 5.3. страницы без чужого текста — просто не падают и чисто разбираются
      CUR = 'Привет';
      for (const [name, h, q] of [['/tools/nick', pages, { page: 'nick' }], ['/tools/fonts', pages, { page: 'fonts' }], ['/tools/random', pages, { page: 'random' }], ['/vip', pages, { page: 'vip' }], ['/about', pages, { page: 'about' }], ['/history', pages, { page: 'history' }],
        ['/reklama', pages, { page: 'reklama' }], ['/top', pages, { page: 'top' }], ['/games', game, {}], ['/quiz', pages, { page: 'quiz' }], ['/topics', pages, { page: 'topic' }], ['/ads-terms', pages, { page: 'adsterms' }]]) {
        let r; try { r = await call(h, q); } catch (e) { ok(false, `${name}: отдаёт страницу`, String(e.message || e).slice(0, 120)); continue; }
        ok(r.code < 500 && danger(r.body).length === 0 && ldOk(r.body), `${name}: страница читается, JSON-LD целый`, { code: r.code, ld: ldOk(r.body) });
      }
      // 5.4. свои ссылки в форуме: только путь на сайте, не «//чужой.сайт»
      CUR = 'Привет';
      const fr = await call(pages, { page: 'forum', id: '5' });
      ok(hrefsOf(fr.body).every(h => !/^\/[/\\]/.test(h) && !/evil\.example/.test(h)), '/forum/5: «dan4ik37.vercel.app//чужой.сайт» в теме — не ссылка на чужой сайт', hrefsOf(fr.body).filter(h => /evil/.test(h)));
      // 5.5. кто отдаёт тело ответа: известные места (res.send / res.end); новое — проверить, что в нём нет чужого текста без esc
      const known = [   // файл: форма аргумента (начало)
        /^page\(/, /^JSON\.stringify\(/, /^''?$/, /^'[^'$\\]*'$/, /^html$/, /^t \? topicPage\(/, /^typeof body === 'string' \? body : JSON\.stringify\(body\)$/, /^`<\?xml version="1\.0" encoding="UTF-8"\?>/, /^$/,
        /^(hub|topicPage|gamePage|sendPage)\(/, /^out$/, /^body$/, /^freedom/,
      ];
      const unknown = [];
      const walkApi = d => { for (const e of fs.readdirSync(path.join(SITE, d), { withFileTypes: true })) { const rel = d + '/' + e.name; if (e.isDirectory()) walkApi(rel); else if (e.name.endsWith('.js')) scanSends(rel); } };
      function scanSends(rel){
        const t = src(rel); const re = /\.(send|end)\(/g; let m;
        while ((m = re.exec(t))) {
          let i = m.index + m[0].length, depth = 1, q = '', j = i;
          for (; j < t.length && depth > 0; j++) { const c = t[j]; if (q) { if (c === '\\') j++; else if (c === q) q = ''; } else if (c === '"' || c === "'" || c === '`') q = c; else if (c === '(') depth++; else if (c === ')') depth--; }
          const arg = t.slice(i, j - 1).replace(/\s+/g, ' ').trim();
          if (!known.some(r => r.test(arg))) unknown.push(`${rel}: .${m[1]}(${arg.slice(0, 70)})`);
        }
      }
      walkApi('api');
      ok(unknown.length === 0, 'api: всё, что сервер отдаёт через send/end, — известные формы (страница page(), JSON, константа); новое проверь и допиши в xss-test', unknown.slice(0, 8));
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  }

  // ═══ 6. Точечные защиты ═══
  {
    const uidRe = /const UID_RE = \/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/i;/;
    for (const f of ['js/games/mir.js', 'js/games/world.js']) ok(uidRe.test(src(f)) && /uid: typeof m\.uid === 'string' && UID_RE\.test\(m\.uid\) \? m\.uid : null/.test(src(f)), `${f}: uid чужого игрока из присутствия — только uuid`);
    ok(/renderEmoji\(e\)\{[\s\S]{0,400}esc\(e\.char\)/.test(src('js/features/reactions.js')), 'reactions.js: renderEmoji экранирует e.char (эмодзи из базы пишет любой вошедший)');
    ok(/function loadScript\(src\)\{[\s\S]{0,300}\^https:/.test(src('js/core/premium.js')), 'premium.js: виджет оплаты грузится только с https://');
    ok(/\/\^https:\\\/\\\/\/i\.test\(x\.url \|\| ''\) \? esc\(x\.url\) : '#'/.test(src('js/features/adcab.js')), 'adcab.js: ссылка рекламодателя в админке — только https');
    {
      const nt = src('js/features/notifications.js'), uses = nt.split('\n').filter(l => /location\.href = link/.test(l));
      ok(uses.length === 1 && /\/\^https:\\\/\\\//.test(uses[0]), 'notifications.js: чужой адрес в уведомлении открывается только если он https://…', uses);
    }
    ok(/\(\?!\[\\\/\\\\\]\)/.test(src('api/_lib/routes/forum.js')) && /if \(\/\^\\\/\[\\\/\\\\\]\/\.test\(p\)\) return null;/.test(src('js/features/msgview.js')), 'ссылки «сайт//чужой.сайт» (чат и страница форума) — не свои');
    ok(!/\beschumanErr\b/.test(src('js/features/forum.js')), 'forum.js: в обработчике ошибки нет опечатки eschumanErr');
  }

  console.log(`\nxss-test: ${pass} проверок прошло, ${fail} упало`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL xss-test упал:', e && e.stack || e); process.exit(1); });
