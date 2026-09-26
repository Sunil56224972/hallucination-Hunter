/* ==========================================
   Hallucination Hunter — Background Service Worker
   Handles communication between content script & popup
   ========================================== */

// Listen for extension install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Hallucination Hunter extension installed');
  chrome.storage.local.set({ capturedText: '', selectedText: '' });
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getText') {
    // Popup is asking for captured text
    chrome.storage.local.get(['capturedText', 'capturedAt', 'capturedFrom', 'selectedText', 'selectedAt'], (data) => {
      sendResponse(data);
    });
    return true; // async response
  }

  if (message.action === 'clearText') {
    chrome.storage.local.set({ capturedText: '', selectedText: '' });
    sendResponse({ success: true });
    return true;
  }
});
