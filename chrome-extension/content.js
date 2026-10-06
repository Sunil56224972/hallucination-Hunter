/* ==========================================
   Hallucination Hunter - Content Script
   Detects text selection/copy on any webpage
   and sends to the extension popup
   ========================================== */

(function () {
  'use strict';

  // Listen for copy events on any page
  document.addEventListener('copy', () => {
    setTimeout(() => {
      const selectedText = window.getSelection().toString().trim();
      if (selectedText && selectedText.length > 10) {
        // Store the selected text so popup can read it
        chrome.storage.local.set({
          capturedText: selectedText,
          capturedAt: Date.now(),
          capturedFrom: window.location.hostname
        });

        // Show a subtle toast notification
        showToast(selectedText);
      }
    }, 100);
  });

  // Also listen for text selection (mouseup) to detect intent
  document.addEventListener('mouseup', () => {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText && selectedText.length > 20) {
      chrome.storage.local.set({
        selectedText: selectedText,
        selectedAt: Date.now(),
        selectedFrom: window.location.hostname
      });
    }
  });

  // Show a small toast when text is captured
  function showToast(text) {
    // Remove any existing toast
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
        <span>Copied. Open <strong>Hallucination Hunter</strong> from the toolbar to check it.</span>
        <button class="hh-toast-close" type="button" aria-label="Dismiss">&times;</button>
      </div>
    `;
    toast.querySelector('.hh-toast-close').addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);

    // Auto-remove after 3.5 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('hh-leaving');
        setTimeout(() => toast.remove(), 200);
      }
    }, 3000);
  }
})();
