// Open the full-screen exam in its own tab when the toolbar icon is clicked.
// (A mic + a long timed exam want a real tab, not a cramped popup.)

const EXAM_URL = chrome.runtime.getURL('exam/index.html');

chrome.action.onClicked.addListener(async () => {
  // Reuse an already-open exam tab if there is one, otherwise open a new one.
  const tabs = await chrome.tabs.query({ url: EXAM_URL });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: EXAM_URL });
  }
});
