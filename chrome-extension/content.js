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

    const shortcut = /Mac/i.test(navigator.platform) ? 'Option+Shift+H' : 'Alt+Shift+H';
    const toast = document.createElement('div');
    toast.id = 'hh-capture-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <div class="hh-toast-inner">
        <svg width="18" height="18" viewBox="0 0 36 36" aria-hidden="true">
          <rect width="36" height="36" rx="7" fill="#f4f0e8"/>
          <rect x="2.75" y="2.75" width="30.5" height="30.5" rx="4.75" fill="none" stroke="#191714" stroke-opacity="0.2" stroke-width="0.9"/>
          <path d="M9.5 11.5h17" stroke="#191714" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M9.5 17.5h7.2" stroke="#191714" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M20.2 17.5h6.3" stroke="#cf4a24" stroke-width="2.3" stroke-linecap="round"/>
          <path d="M21.4 22.8l1.95-2.3 1.95 2.3" fill="none" stroke="#cf4a24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9.5 24.5h10.2" stroke="#191714" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        <span>Passage staged &mdash; press <kbd>${shortcut}</kbd> to verify</span>
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
