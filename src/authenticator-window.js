import { mountAuthenticatorView } from './authenticator.js';

async function initStandalone() {
  const params = new URLSearchParams(location.search);
  const tabIdParam = Number(params.get('tabId'));
  const originParam = params.get('origin') || '';

  let targetTab = Number.isInteger(tabIdParam) && tabIdParam > 0 ? await chrome.tabs.get(tabIdParam).catch(() => null) : null;
  if (!targetTab) {
    const wins = await chrome.windows?.getAll?.({ populate: true, windowTypes: ['normal'] }).catch(() => []);
    const activeTabs = (wins ?? []).flatMap(w => (w.tabs ?? []).filter(t => t.active && t.url?.startsWith('https://')));
    targetTab = activeTabs[0] ?? null;
  }

  let origin = originParam;
  if (!origin && targetTab?.url) {
    try { origin = new URL(targetTab.url).origin; } catch { origin = ''; }
  }

  let siteContext = {};
  if (targetTab?.id && origin.startsWith('https://')) {
    const status = await chrome.tabs.sendMessage(targetTab.id, { type: 'FIELD_STATUS' }, { frameId: 0 }).catch(() => null);
    if (status?.siteContext) siteContext = status.siteContext;
  }

  await mountAuthenticatorView(document.getElementById('standaloneAuthRoot'), {
    tab: targetTab,
    origin,
    siteContext,
    initialDrawer: params.get('drawer') || null
  });
}

initStandalone().catch(() => {});
