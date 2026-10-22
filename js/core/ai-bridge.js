// ═══════════════════════════════════════
//  ИИ-ПОМОЩНИК ДЛЯ ИНСТРУМЕНТОВ (D37AI) — «скопировать задание для ИИ» и выполнить ответ командами «d37 v1»
// ═══════════════════════════════════════
// Без ключей и без сети: задание (правила + команды инструментов из D37Tools + что сделать) копируется в буфер, человек
// вставляет его в любой чат-ИИ (ChatGPT, DeepSeek, GigaChat, Алиса…), ответ (JSON-план) вставляет обратно — сайт проверяет
// ВСЕ шаги и выполняет их по одному теми же командами, что и кнопки; каждый шаг — в истории «Отменить», «↶ Отменить всё» —
// откат всего плана. Позже — режимы «свой ИИ на компьютере (Ollama)», «ИИ в браузере», «облако» (ключи — только у владельца).
// D37AI.prompt(goal, { tools }) → текст задания; D37AI.extract(text) → объект плана; D37AI.run(textOrPlan, { onStep }) →
// итог D37Tools.runPlan; D37AI.open({ tools, title, goal }) — окно на странице.
(function (root) {
  'use strict';
  const T = () => root.D37Tools;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ═══ Задание для ИИ ═══
  function prompt(goal, o = {}){
    const D = T(); if (!D) throw new Error('D37Tools не загружен');
    const tools = o.tools && o.tools.length ? o.tools : D.list().map(t => t.id);
    return [
      'Ты управляешь инструментами сайта dan4ik37 (Денчик37) через команды «d37 v1».',
      'Ответь ТОЛЬКО JSON — без пояснений до и после (можно внутри блока ```json):',
      '{"d37":1,"title":"что делаем, коротко","steps":[{"tool":"…","cmd":"…","args":{…},"why":"зачем этот шаг"}]}',
      'Правила:',
      '- только инструменты, команды и поля из списка ниже; числа — в указанных пределах; лишних полей не добавляй;',
      '- шаги выполняются по порядку; результат шага N подставляется строкой "$N.поле" (например "$3.asset");',
      `- не больше ${D.MAX_STEPS} шагов; координаты и размеры — в пикселях картинки, (0,0) — левый верхний угол;`,
      '- текст для надписей — короткий и без ссылок, телефонов и адресов;',
      '- если задачу нельзя сделать этими командами — {"d37":1,"steps":[],"say":"почему нельзя и что можно вместо этого"}.',
      '',
      D.describe(tools),
      '',
      'Задача: ' + String(goal || '').trim().slice(0, 2000),
    ].join('\n');
  }

  // ═══ Ответ ИИ → план ═══
  // Достаёт JSON из ответа: блок ```json … ```, иначе первый сбалансированный { … } или [ … ]
  function extract(text){
    const s = String(text == null ? '' : text).trim();
    if (!s) return null;
    const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(s);
    const cands = [];
    if (fence) cands.push(fence[1].trim());
    cands.push(s);
    for (const c of cands) {
      try { return JSON.parse(c); } catch (e) {}
      const j = balanced(c);
      if (j) { try { return JSON.parse(j); } catch (e) {} }
    }
    return null;
  }
  // Первый сбалансированный кусок { … } или [ … ] (скобки внутри строк не считаются)
  function balanced(s){
    const start = s.search(/[{[]/); if (start < 0) return '';
    const stack = []; let str = false, escp = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (str) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true;
      else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') {
        if (stack.pop() !== c) return '';
        if (!stack.length) return s.slice(start, i + 1);
      }
    }
    return '';
  }

  // Выполнить ответ ИИ (текст или объект). → { ok, say?, error?, steps, done, results }
  async function run(x, o = {}){
    const D = T(); if (!D) return { ok: false, error: 'D37Tools не загружен', steps: [], done: 0 };
    const plan = typeof x === 'string' ? extract(x) : x;
    if (!plan) return { ok: false, error: 'В ответе не нашёлся JSON. Попроси ИИ ответить только JSON по заданию.', steps: [], done: 0 };
    if (plan && typeof plan === 'object' && !Array.isArray(plan) && Array.isArray(plan.steps) && !plan.steps.length)
      return { ok: false, say: String(plan.say || 'ИИ не предложил ни одного шага.').slice(0, 500), steps: [], done: 0 };
    return D.runPlan(plan, Object.assign({ via: 'ai' }, o));
  }

  // Буфер обмена (на телефоне без разрешения — через скрытое поле)
  async function copy(text){
    try { if (root.navigator && root.navigator.clipboard && root.isSecureContext) { await root.navigator.clipboard.writeText(text); return true; } } catch (e) {}
    try {
      const ta = root.document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      root.document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      const ok = root.document.execCommand('copy'); ta.remove(); return !!ok;
    } catch (e) { return false; }
  }

  // ═══ Окно ═══
  let box = null, lastLog = null;
  function css(){
    if (root.document.getElementById('aibCss')) return;
    const st = root.document.createElement('style'); st.id = 'aibCss';
    st.textContent = `.aib{position:fixed;inset:0;z-index:100200;display:flex;align-items:flex-end;justify-content:center;background:rgba(5,6,12,.62)}
.aib-in{width:min(640px,100%);max-height:92dvh;overflow:auto;background:var(--card,#16161f);color:var(--text,#f0f0f8);border:1px solid var(--line,rgba(255,255,255,.12));border-radius:18px 18px 0 0;padding:14px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.5)}
@media(min-width:700px){.aib{align-items:center}.aib-in{border-radius:18px}}
.aib-h{display:flex;align-items:center;gap:8px;margin-bottom:8px}.aib-h b{flex:1;font:800 1.05rem Montserrat,sans-serif}
.aib-x{min-width:40px;min-height:40px;border:0;border-radius:12px;background:rgba(255,255,255,.07);color:inherit;font-size:1.1rem;cursor:pointer}
.aib label{display:block;font-size:.8rem;color:var(--muted,#a0a0b8);margin:10px 0 4px}
.aib textarea{width:100%;min-height:76px;resize:vertical;border-radius:12px;border:1px solid var(--line,rgba(255,255,255,.14));background:rgba(255,255,255,.05);color:inherit;padding:10px;font:500 .92rem/1.4 inherit;box-sizing:border-box}
.aib-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.aib-b{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line,rgba(255,255,255,.14));background:rgba(255,255,255,.07);color:inherit;font:700 .9rem inherit;cursor:pointer}
.aib-b.acc{background:var(--accent,#7c5cff);border-color:transparent;color:#fff}.aib-b:disabled{opacity:.5;cursor:default}
.aib-hint{font-size:.78rem;color:var(--muted,#a0a0b8);margin-top:6px;line-height:1.4}
.aib-steps{list-style:none;margin:10px 0 0;padding:0;font-size:.85rem}.aib-steps li{padding:5px 0;border-top:1px solid rgba(255,255,255,.06)}
.aib-steps .ok{color:#4ade80}.aib-steps .err{color:#ff6b81}.aib-steps .run{color:#ffd166}.aib-say{margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(255,209,102,.1);color:#ffd166;font-size:.86rem}`;
    root.document.head.appendChild(st);
  }
  function close(){ if (box) { box.remove(); box = null; } root.removeEventListener('keydown', onKey, true); }
  function onKey(e){ if (e.key === 'Escape' && box) { e.stopImmediatePropagation(); e.preventDefault(); close(); } }
  // o: { tools: ['photo'], title, goal, examples: [строки] }
  function open(o = {}){
    close(); css();
    const d = root.document;
    box = d.createElement('div'); box.className = 'aib'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'ИИ-помощник');
    const ex = (o.examples || []).map(x => `<button type="button" class="aib-b" data-ex="${esc(x)}">${esc(x)}</button>`).join('');
    box.innerHTML = `<div class="aib-in">
      <div class="aib-h"><b>🤖 ${esc(o.title || 'ИИ-помощник')}</b><button type="button" class="aib-x" data-a="x" aria-label="Закрыть">✕</button></div>
      <label for="aibGoal">1. Что сделать?</label>
      <textarea id="aibGoal" maxlength="2000" placeholder="Например: сделай ярче и теплее, обрежь 9:16 и добавь сверху надпись «ПОБЕДА» жёлтым">${esc(o.goal || '')}</textarea>
      ${ex ? `<div class="aib-row">${ex}</div>` : ''}
      <div class="aib-row"><button type="button" class="aib-b acc" data-a="copy">📋 Скопировать задание для ИИ</button></div>
      <div class="aib-hint">Вставь задание в любой чат с ИИ (ChatGPT, DeepSeek, GigaChat, Алиса), а его ответ — ниже. Сайт ничего никуда не отправляет.</div>
      <label for="aibAns">2. Ответ ИИ</label>
      <textarea id="aibAns" placeholder='{"d37":1,"steps":[…]}'></textarea>
      <div class="aib-row"><button type="button" class="aib-b acc" data-a="run">▶ Выполнить</button><button type="button" class="aib-b" data-a="undo" hidden>↶ Отменить всё</button></div>
      <div class="aib-say" hidden></div>
      <ul class="aib-steps" aria-live="polite"></ul>
    </div>`;
    d.body.appendChild(box);
    root.addEventListener('keydown', onKey, true);
    const $ = s => box.querySelector(s), ul = $('.aib-steps'), say = $('.aib-say');
    box.addEventListener('click', async e => {
      if (e.target === box) { close(); return; }
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ex) { $('#aibGoal').value = b.dataset.ex; return; }
      const a = b.dataset.a;
      if (a === 'x') close();
      else if (a === 'copy') {
        const goal = $('#aibGoal').value.trim();
        if (!goal) { $('#aibGoal').focus(); return; }
        let text; try { text = prompt(goal, { tools: o.tools }); } catch (er) { say.hidden = false; say.textContent = er.message; return; }
        const ok = await copy(text);
        b.textContent = ok ? '✓ Скопировано — вставь в чат с ИИ' : '⚠ Не скопировалось — выдели и скопируй вручную';
        if (!ok) { $('#aibAns').value = text; $('#aibAns').select(); }
        setTimeout(() => { if (box) b.textContent = '📋 Скопировать задание для ИИ'; }, 2600);
      } else if (a === 'run') {
        b.disabled = true; ul.innerHTML = ''; say.hidden = true;
        const items = [];
        const r = await run($('#aibAns').value, { onStep(i, s, state, info){
          let li = items[i];
          if (!li) { li = items[i] = d.createElement('li'); ul.appendChild(li); }
          li.className = state === 'ok' ? 'ok' : state === 'error' ? 'err' : 'run';
          li.textContent = `${state === 'ok' ? '✓' : state === 'error' ? '✗' : '…'} ${i + 1}. ${s.tool}.${s.cmd}${s.why ? ' — ' + s.why : ''}${state === 'error' ? ': ' + info : ''}`;
        } });
        if (box) {
          b.disabled = false;
          lastLog = r.steps || [];
          $('[data-a="undo"]').hidden = !lastLog.some(x => x.ok && x.undoable);
          if (r.say) { say.hidden = false; say.textContent = '🤖 ' + r.say; }
          else if (!r.ok) { say.hidden = false; say.textContent = '⚠ ' + (r.error || 'Не получилось') + (r.errors && r.errors.length > 1 ? ' (и ещё ' + (r.errors.length - 1) + ')' : ''); }
          else { say.hidden = false; say.textContent = `✓ Готово: ${r.done} ${r.done === 1 ? 'шаг' : 'шагов'}.`; }
          if (typeof o.onDone === 'function') { try { o.onDone(r); } catch (er) {} }
        }
      } else if (a === 'undo') {
        const n = await T().undoSteps(lastLog || []);
        lastLog = null; b.hidden = true; say.hidden = false; say.textContent = `↶ Отменено шагов: ${n}`;
      }
    });
    setTimeout(() => { try { $('#aibGoal').focus(); } catch (e) {} }, 50);
    return { close };
  }

  const api = { prompt, extract, run, copy, open, close, MODES: ['copy'] };
  root.D37AI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
