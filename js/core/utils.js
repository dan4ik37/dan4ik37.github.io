// ═══════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════
// БАГ (найден и исправлен): esc() не экранировала одинарную кавычку, а она
// используется как разделитель JS-строк в inline onclick="fn('...')" в
// нескольких местах (напр. banNick). HTML-экранирование двойных кавычек
// не спасает от этого — атрибут и JS-строка внутри него разные контексты.
// Сейчас ник нельзя задать произвольно (только авто-генерируется), так что
// живой дыры нет, но один шаг (кастомные ники) — и была бы.
// Ссылка на картинку профиля, безопасная для подстановки в style="…url('…')…".
// Сервер и так не пропускает другое (server-hardening.sql), но в базе могло лежать
// старое значение — поэтому проверяем и при показе. Пусто = «нет картинки».
const safeImgUrl = u => (typeof u === 'string' && /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~%+\/-]+(\?t=\d+)?|data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+\/=]+)$/.test(u)) ? u : '';
// Значение для JS-аргумента ВНУТРИ HTML-атрибута onclick="f(${jsAttr(x)})": JSON-строка +
// HTML-экранирование кавычек. Раньше экранировался только ', а " в нике («x" onmouseover="…»)
// выходило из атрибута и превращалось в XSS у всех, кто видит этот ник.
const jsAttr = s => esc(JSON.stringify(String(s == null ? '' : s)));
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
// Ошибка Supabase/сети → понятный текст по-русски. Сырые сообщения были по-английски и с техническими словами
// («new row violates row-level security policy…», «Failed to fetch»). Свои ошибки сервера уже по-русски — их как есть.
function humanErr(e){
  const m = String((e && (e.message || e.error_description || e.msg)) || e || '');
  const code = (e && e.code) || '';
  if (/[а-яё]/i.test(m)) return m;
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'нет связи с сервером — проверь интернет';
  if (/invalid login credentials/i.test(m)) return 'неверный email или пароль';
  if (/user already registered|already been registered/i.test(m)) return 'этот email уже зарегистрирован';
  if (/email not confirmed/i.test(m)) return 'email не подтверждён — открой письмо и перейди по ссылке';
  if (/password should be at least|weak password/i.test(m)) return 'пароль слишком короткий — минимум 6 символов';
  if (/unable to validate email|invalid.*email|email.*invalid/i.test(m)) return 'проверь email — похоже, в нём ошибка';
  if (/rate limit|too many requests|429/i.test(m)) return 'слишком много попыток — подожди пару минут';
  if (/jwt|session.*(expired|missing)|not authenticated/i.test(m)) return 'сессия устарела — войди заново';
  if (code === '42501' || /row-level security|permission denied/i.test(m)) return 'нет прав на это действие';
  if (code === '23505' || /duplicate key/i.test(m)) return 'такое уже есть';
  if (code === '23514' || /check constraint/i.test(m)) return 'не прошло проверку — слишком длинно или недопустимые символы';
  if (code === '22001' || /value too long/i.test(m)) return 'слишком длинный текст';
  if (code === 'PGRST202' || code === '42883' || code === '42P01' || /schema cache|does not exist/i.test(m)) return 'эта функция на сервере ещё не включена';
  if (code === '57014' || /timeout|timed out/i.test(m)) return 'сервер долго не отвечает — попробуй ещё раз';
  return 'что-то пошло не так — попробуй ещё раз' + (code ? ' (код ' + code + ')' : '');
}
// Запрос к Supabase, который при ошибке БРОСАЕТ её (supabase-js сам не бросает — возвращает { error }, и раньше
// интерфейс показывал «готово», хотя бан/удаление/сохранение не прошли): await sbOk(sbClient.from(…).update(…))
async function sbOk(q){ const r = await q; if (r && r.error) throw r.error; return r; }
// То же с заглавной буквы — когда ошибка стоит отдельной строкой
const humanErrCap = e => { const s = humanErr(e); return s.charAt(0).toUpperCase() + s.slice(1); };
const fmt = n => { n = parseInt(n) || 0; return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n) };
