export function evaluateContent(window, source) {
  const { runtime, storage } = window.chrome;
  const sendMessage = runtime.sendMessage?.bind(runtime);
  const addListener = runtime.onMessage.addListener.bind(runtime.onMessage);
  runtime.onMessage.addListener = listener => {
    addListener(listener);
    storage.onChanged?.addListener((changes, area) => {
      listener({ type: 'CONTENT_SETTINGS_CHANGED', changes, area }, { id: runtime.id });
    });
  };
  runtime.sendMessage = async request => {
    if (request.type === 'GET_CONTENT_SETTINGS') return storage.local.get([
      'autoWatch', 'detailedPopup', 'showWithdrawalDetails', 'totpTimeOffsetSeconds', 'totpEnabled',
      'totpSiteHints', 'mutedOrigins', 'phishingTrustedOrigins', 'customFieldSelectors', 'localWebmailEnabled'
    ]);
    if (request.type === 'MUTE_CONTENT_ORIGIN') {
      const { mutedOrigins = [] } = await storage.local.get('mutedOrigins');
      await storage.local.set({ mutedOrigins: [...new Set([...mutedOrigins, window.location.origin])] });
      return { status: 'ok' };
    }
    if (request.type === 'SAVE_CONTENT_FIELD') {
      const { customFieldSelectors = {} } = await storage.local.get('customFieldSelectors');
      await storage.local.set({ customFieldSelectors: {
        ...customFieldSelectors, [window.location.origin]: request.descriptor
      } });
      return { status: 'ok' };
    }
    return sendMessage?.(request);
  };
  // Unit tests inspect internal controls. Browser smoke tests use real closed roots.
  const attachShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function (options) {
    return attachShadow.call(this, { ...options, mode: 'open' });
  };
  window.eval(source);
}

export function inlineChip(document) {
  return document.getElementById('codesnap-inline-chip')?.shadowRoot?.querySelector('button') ?? null;
}

export function importBackground(specifier) {
  chrome.storage.local.setAccessLevel ??= async () => {};
  chrome.storage.onChanged ??= { addListener() {} };
  return import(specifier);
}
