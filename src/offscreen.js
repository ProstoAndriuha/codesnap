chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OFFSCREEN_CLIPBOARD_WRITE') {
    (async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(message.text);
          sendResponse({ ok: true });
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = message.text;
          document.body.appendChild(textarea);
          textarea.select();
          const ok = document.execCommand('copy');
          textarea.remove();
          sendResponse({ ok: Boolean(ok) });
        }
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }
});
