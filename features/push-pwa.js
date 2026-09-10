// ═══════════════════════════════════════
//  PUSH УВЕДОМЛЕНИЯ
// ═══════════════════════════════════════
let pushSubscribed = localStorage.getItem('d37_push') === '1';

function updatePushBtn() {
  const btn = document.getElementById('pushBtn');
  if (!btn) return;
  if (pushSubscribed) {
    btn.textContent = '✅ Уведомления включены';
    btn.classList.add('subscribed');
  } else {
    btn.textContent = '🔔 Подписаться на стримы';
    btn.classList.remove('subscribed');
  }
}

async function togglePush() {
  if (!('Notification' in window)) {
    alert('Твой браузер не поддерживает уведомления');
    return;
  }
  if (pushSubscribed) {
    pushSubscribed = false;
    localStorage.removeItem('d37_push');
    updatePushBtn();
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    pushSubscribed = true;
    localStorage.setItem('d37_push', '1');
    updatePushBtn();
    new Notification('dan4ik37', {
      body: '🔴 Уведомления включены! Сообщим когда начнётся стрим.',
      icon: 'https://dan4ik37.vercel.app/og-image.jpg'
    });
  }
}

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
