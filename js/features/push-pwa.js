// ═══════════════════════════════════════
//  PUSH УВЕДОМЛЕНИЯ
// ═══════════════════════════════════════
// Настоящий Web Push: подписка браузера (VAPID) хранится в Supabase
// (push.sql → push_subscribe / push_unsubscribe), рассылает api/push-check.js,
// показывает уведомление sw.js — даже когда сайт закрыт.
const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const PUSH_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let pushSubscribed = localStorage.getItem('d37_push') === '1';
let pushBusy = false;

function updatePushBtn() {
  const btn = document.getElementById('pushBtn');
  const profileBtn = document.getElementById('profilePushBtn');
  const label = pushBusy ? '⏳ Секунду…' : pushSubscribed ? '✅ Уведомления включены' : '🔔 Подписаться на уведомления';
  if (btn) { btn.textContent = label; btn.classList.toggle('subscribed', pushSubscribed); }
  if (profileBtn) profileBtn.textContent = label;
}

function setPushState(on) {
  pushSubscribed = on;
  try { on ? localStorage.setItem('d37_push', '1') : localStorage.removeItem('d37_push'); } catch (e) {}
  updatePushBtn();
}

// RPC через обычный fetch — не зависим от того, успел ли загрузиться Supabase SDK.
// Если человек вошёл — передаём его токен, чтобы подписка привязалась к профилю.
async function pushRpc(fn, args) {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  try {
    const s = sbClient && (await sbClient.auth.getSession()).data.session;
    if (s) headers.Authorization = 'Bearer ' + s.access_token;
  } catch (e) {}
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status}`);
}

function pushKeyBytes(b64) {
  const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function sameKey(buf, bytes) {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}
function saveSub(sub) {
  const j = sub.toJSON();
  return pushRpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
}

// Старый sw.js (без обработчика push) мог остаться активным — тогда приветствие
// приходит, но не показывается. Перед подпиской просим браузер проверить обновление
// и ждём (до 5 с), пока новая версия встанет.
async function freshServiceWorker() {
  const reg = await navigator.serviceWorker.ready;
  try { await reg.update(); } catch (e) {}
  const w = reg.installing || reg.waiting;
  if (w) {
    await new Promise(res => {
      const t = setTimeout(res, 5000);
      w.addEventListener('statechange', () => { if (w.state === 'activated') { clearTimeout(t); res(); } });
    });
  }
  return reg;
}

async function togglePush() {
  if (pushBusy) return;
  if (!PUSH_OK) {
    alert(PUSH_IOS
      ? 'На iPhone уведомления работают только из установленного приложения: в Safari нажми «Поделиться» → «На экран Домой», открой сайт с иконки и включи уведомления там.'
      : 'Твой браузер не поддерживает push-уведомления');
    return;
  }
  pushBusy = true; updatePushBtn();
  try {
    const reg = await freshServiceWorker();
    let sub = await reg.pushManager.getSubscription();

    if (pushSubscribed && sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      pushRpc('push_unsubscribe', { p_endpoint: endpoint }).catch(() => {});
      setPushState(false);
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (perm === 'denied') alert('Уведомления запрещены в настройках браузера. Разреши их для сайта (значок слева от адреса) и нажми ещё раз.');
      return;
    }
    const { key } = await fetch('/api/push-check?pubkey=1', { cache: 'no-store' }).then(r => r.json());
    if (!key) throw new Error('VAPID-ключ не настроен');
    const keyBytes = pushKeyBytes(key);
    // Подписка со старым ключом (ключ сменили) — переоформляем
    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, keyBytes)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
    try { await saveSub(sub); }
    catch (e) { await sub.unsubscribe().catch(() => {}); throw e; }
    setPushState(true);
    // Приветствие приходит с сервера — заодно проверка, что вся цепочка работает
    fetch('/api/push-check?test=1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint })
    }).then(r => r.text()).then(t => console.info('push welcome:', t)).catch(e => console.warn('push welcome:', e));
  } catch (e) {
    console.warn('push:', e);
    alert('Не получилось включить уведомления. Попробуй ещё раз чуть позже.');
  } finally {
    pushBusy = false; updatePushBtn();
  }
}

// Кнопка показывает реальное состояние подписки браузера (а не только флаг в localStorage).
// Живую подписку заодно обновляем в базе — после входа она привяжется к профилю.
function syncPush() {
  if (!PUSH_OK) { setPushState(false); return; }
  navigator.serviceWorker.ready
    .then(reg => reg.pushManager.getSubscription())
    .then(sub => {
      const on = !!sub && Notification.permission === 'granted';
      setPushState(on);
      if (on) saveSub(sub).catch(() => {});
    })
    .catch(() => {});
}
syncPush();
window.addEventListener('d37:auth', () => { if (pushSubscribed) syncPush(); });
updatePushBtn();

// ═══════════════════════════════════════
//  PWA
// ═══════════════════════════════════════
let deferredPrompt = null;

// Раньше не было ни manifest.json, ни Service Worker — beforeinstallprompt
// в реальном браузере физически не мог сработать (это требование спеки),
// баннер установки был мёртвым кодом. Теперь оба на месте.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  // Показываем баннер через 3 секунды
  setTimeout(() => {
    if (!localStorage.getItem('d37_pwa_dismissed')) {
      document.getElementById('pwaBanner').classList.add('show');
    }
  }, 3000);
});

async function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('pwaBanner').classList.remove('show');
  if (outcome === 'accepted') localStorage.setItem('d37_pwa_installed','1');
}

document.getElementById('pwaBanner').querySelector('.pwa-close').addEventListener('click', () => {
  localStorage.setItem('d37_pwa_dismissed','1');
});
