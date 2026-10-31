/* Hallucination Hunter — content script.
   Captures copied passages or active selection on demand so the popup can pre-fill them. */

(function () {
  'use strict';

  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'hh-get-selection') {
      const active = document.activeElement;
      if (active && active.type === 'password') {
        sendResponse({ text: '', host: location.hostname });
        return;
      }
      sendResponse({
        text: String(window.getSelection() || '').trim().slice(0, 20000),
        host: location.hostname
      });
    }
  });

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
      } catch {
        /* extension reloaded */
      }
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
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="6" fill="#282724"/>
          <path d="M8.5 10.5h15" stroke="#f7f6f2" stroke-width="2.1" stroke-linecap="round"/>
          <path d="M8.5 16h6.5" stroke="#f7f6f2" stroke-width="2.1" stroke-linecap="round"/>
          <path d="M18.2 16h5.3" stroke="#e5643f" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M8.5 21.5h10.5" stroke="#f7f6f2" stroke-width="2.1" stroke-linecap="round"/>
        </svg>
        <span>Copied &mdash; press <kbd>${shortcut}</kbd> to fact-check</span>
        <button class="hh-toast-close" type="button" aria-label="Dismiss">&times;</button>
      </div>`;
    toast.querySelector('.hh-toast-close').addEventListener('click', () => toast.remove());
    document.documentElement.appendChild(toast);

    setTimeout(() => {
      if (!toast.isConnected) return;
      toast.classList.add('hh-leaving');
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }
})();
