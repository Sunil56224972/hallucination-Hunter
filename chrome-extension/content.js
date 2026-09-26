/* ==========================================
   Hallucination Hunter — Content Script
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
    toast.innerHTML = `
      <div class="hh-toast-inner">
        <svg width="16" height="16" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="45" fill="#3d3832"/>
          <circle cx="50" cy="50" r="22" fill="none" stroke="#f7f4f0" stroke-width="5"/>
          <circle cx="50" cy="50" r="8" fill="#f7f4f0"/>
          <line x1="67" y1="67" x2="90" y2="90" stroke="#f7f4f0" stroke-width="6" stroke-linecap="round"/>
        </svg>
        <span>Text captured! Open <strong>Hallucination Hunter</strong> to analyze.</span>
        <button class="hh-toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;
    document.body.appendChild(toast);

    // Auto-remove after 3.5 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.animation = 'hhToastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
      }
    }, 3500);
  }
})();
