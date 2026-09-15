// ═══════════════════════════════════════
//  КАСТОМНЫЕ ЭМОДЗИ (загружает админ через "⚙️ Настройки сайта")
//  Хранятся в таблице custom_emoji + картинки в Storage-бакете "emoji"
//  (см. custom_emoji.sql). Доступны и в пикере реакций, и как :shortcode:
//  в тексте сообщений (см. buildReactionSet/renderMessageText).
// ═══════════════════════════════════════
let customEmoji = [];
async function loadCustomEmoji(){
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('custom_emoji').select('*').order('created_at');
    customEmoji = data || [];
  } catch(e) { customEmoji = []; }
  appendCustomEmojiToComposerPicker();
}

// Приводим картинку к фиксированному размеру на канвасе (contain — вписываем
// с сохранением пропорций, не искажаем и не обрезаем), отдаём PNG-blob.
function resizeImageToBlob(file, size = 64){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error('canvas toBlob failed'));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('не удалось открыть картинку')); };
    img.src = url;
  });
}

async function uploadCustomEmoji(){
  const statusEl = document.getElementById('emojiUploadStatus');
  const nameInput = document.getElementById('emojiAdminName');
  const fileInput = document.getElementById('emojiAdminFile');
  const rawName = nameInput.value.trim().toLowerCase();
  const file = fileInput.files[0];

  if (!rawName) { statusEl.textContent = '⚠ Введи имя эмодзи'; return; }
  if (!/^[a-z0-9_]+$/.test(rawName)) { statusEl.textContent = '⚠ Только латиница, цифры и _ , без пробелов и двоеточий'; return; }
  if (!file) { statusEl.textContent = '⚠ Выбери картинку'; return; }
  if (!sbClient || currentRole !== 'admin') { statusEl.textContent = '⚠ Нужно быть админом'; return; }

  statusEl.textContent = '⏳ Обрабатываю...';
  try {
    const blob = await resizeImageToBlob(file, 64);
    const path = `${rawName}_${Date.now()}.png`;
    const { error: upErr } = await sbClient.storage.from('emoji').upload(path, blob, { contentType: 'image/png' });
    if (upErr) throw upErr;
    const { data: urlData } = sbClient.storage.from('emoji').getPublicUrl(path);
    const { error: dbErr } = await sbClient.from('custom_emoji').insert({ name: rawName, image_url: urlData.publicUrl });
    if (dbErr) throw dbErr;

    await loadCustomEmoji();
    renderCustomEmojiList();
    nameInput.value = ''; fileInput.value = '';
    statusEl.textContent = '✅ Загружено!';
  } catch(e) {
    statusEl.textContent = (e.message||'').includes('duplicate') ? '⚠ Эмодзи с таким именем уже есть' : '⚠ Не удалось загрузить: ' + (e.message || 'ошибка');
  }
  setTimeout(()=>{ if(statusEl) statusEl.textContent=''; }, 4000);
}

function renderCustomEmojiList(){
  const el = document.getElementById('customEmojiList');
  if (!el) return;
  if (!customEmoji.length) { el.innerHTML = `<div style="font-size:.7rem;color:var(--muted)">Пока не загружено ни одного</div>`; return; }
  el.innerHTML = customEmoji.map(e => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:.3rem;background:rgba(255,255,255,.04);border-radius:10px;padding:.5rem;width:64px">
      <img src="${esc(e.image_url)}" alt=":${esc(e.name)}:" style="width:32px;height:32px;object-fit:contain">
      <div style="font-size:.6rem;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title=":${esc(e.name)}:">:${esc(e.name)}:</div>
      <button data-emoji-id="${e.id}" onclick="deleteCustomEmoji(this.dataset.emojiId)" aria-label="Удалить эмодзи ${esc(e.name)}" style="background:rgba(255,45,85,.15);border:1px solid rgba(255,45,85,.3);color:var(--accent);border-radius:6px;width:20px;height:20px;font-size:.6rem;cursor:pointer">✕</button>
    </div>
  `).join('');
}

async function deleteCustomEmoji(id){
  const emoji = customEmoji.find(e => String(e.id) === String(id));
  if (!emoji) return;
  try {
    const path = emoji.image_url.split('/emoji/').pop();
    if (path) await sbClient.storage.from('emoji').remove([path]);
    await sbClient.from('custom_emoji').delete().eq('id', id);
  } catch(e) {}
  await loadCustomEmoji();
  renderCustomEmojiList();
}

// :shortcode: в тексте сообщения -> картинка кастомного эмодзи. Текст уже
// должен быть экранирован (esc) до вызова — подстановка идёт ПОСЛЕ
// экранирования, по списку реально существующих эмодзи, поэтому новой
// дыры для инъекции тут нет (не голая замена по regex произвольного ввода).
function renderMessageText(escapedText){
  let out = escapedText;
  customEmoji.forEach(e => {
    const code = `:${e.name}:`;
    if (out.includes(code)) {
      out = out.split(code).join(`<img src="${esc(e.image_url)}" alt="${code}" title="${code}" class="custom-emoji-img inline-emoji">`);
    }
  });
  // @упоминания — текст уже экранирован esc()'ом ДО вызова этой функции,
  // regex работает по уже безопасной строке и оборачивает только в свои
  // же теги, новой дыры для инъекции нет (тот же принцип, что у эмодзи выше).
  out = out.replace(/@([a-zA-Zа-яА-Я0-9_]{1,24})/g, (m, nick) =>
    `<span class="chat-mention" data-mention-nick="${nick}">@${nick}</span>`
  );
  return out;
}

// Кастомные эмодзи в пикере набора сообщения (вставляют :shortcode: текстом,
// а не сам символ). Безопасно перевызывать — сначала убирает старые кнопки
// кастомных, чтобы не задублировать при повторном вызове (напр. после
// загрузки нового эмодзи админом, пока чат уже открыт).
function appendCustomEmojiToComposerPicker(){
  const picker = document.getElementById('emojiPicker');
  if (!picker) return;
  picker.querySelectorAll('.custom-emoji-picker-btn').forEach(b => b.remove());
  customEmoji.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'custom-emoji-picker-btn';
    btn.innerHTML = `<img src="${esc(e.image_url)}" alt=":${esc(e.name)}:" style="width:24px;height:24px;object-fit:contain">`;
    btn.setAttribute('aria-label', 'Вставить эмодзи ' + e.name);
    btn.onclick = () => insertEmoji(`:${e.name}:`);
    btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:.2rem .25rem;border-radius:6px;transition:background .15s;display:inline-flex;align-items:center';
    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,.1)';
    btn.onmouseout = () => btn.style.background = 'none';
    picker.appendChild(btn);
  });
}
