/* Hallucination Hunter - content script.
   When you copy a passage, keep it so the popup can pre-fill it. Nothing else is read. */

(function () {
  'use strict';

  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  document.addEventListener('copy', () => {
    setTimeout(() => {
      if (!alive()) return;
      const active = document.activeElement;
      if (active && active.type === 'password') return;
      const text = String(window.getSelection() || '').trim();
      if (text.length < 40) return;
      try {
        chrome.storage.local.set({
          capturedText: text.slice(0, 20000),
          capturedAt: Date.now(),
          capturedFrom: location.hostname,
          autoRun: false
        });
        showToast();
      } catch (e) { /* extension was reloaded; ignore */ }
    }, 50);
  });

  function showToast() {
    const old = document.getElementById('hh-capture-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'hh-capture-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <div class="hh-toast-inner">
        <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="15" fill="#f3efe6"/>
          <rect x="14" y="18" width="36" height="5" rx="2.5" fill="#1c1a17"/>
          <rect x="14" y="29.5" width="12" height="5" rx="2.5" fill="#1c1a17"/>
          <rect x="29" y="29.5" width="21" height="5" rx="2.5" fill="#d4502a"/>
          <rect x="14" y="41" width="24" height="5" rx="2.5" fill="#1c1a17"/>
        </svg>
        <span>Copied. Press <strong>Alt+Shift+H</strong> to check it.</span>
        <button class="hh-toast-close" type="button" aria-label="Dismiss">&times;</button>
      </div>`;
    toast.querySelector('.hh-toast-close').addEventListener('click', () => toast.remove());
    document.documentElement.appendChild(toast);

    setTimeout(() => {
      if (!toast.isConnected) return;
      toast.classList.add('hh-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }
})();
