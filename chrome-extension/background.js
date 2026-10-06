/* Hallucination Hunter - background service worker.
   Adds the right-click "Check with Hallucination Hunter" item for selected text. */

const APP_URL = 'https://hallucination-hunter-five.vercel.app/';
const MENU_ID = 'hh-check-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ capturedText: '', autoRun: false });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Check with Hallucination Hunter',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = (info.selectionText || '').trim();
  if (text.length < 15) return;

  let from = '';
  try { from = tab && tab.url ? new URL(tab.url).hostname : ''; } catch (e) { /* ignore */ }

  await chrome.storage.local.set({
    capturedText: text.slice(0, 20000),
    capturedAt: Date.now(),
    capturedFrom: from,
    autoRun: true
  });

  // Open the popup and let it run the check. Older Chrome builds cannot open the
  // popup from here, so fall back to the full web app in a new tab.
  try {
    await chrome.action.openPopup();
  } catch (e) {
    await chrome.storage.local.set({ autoRun: false });
    chrome.tabs.create({ url: APP_URL + '?text=' + encodeURIComponent(text.slice(0, 6000)) + '&run=1' });
  }
});
