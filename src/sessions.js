import { candidateIsFresh, SEARCH_WINDOW_SECONDS } from './core.js';

export class SessionStore {
  #items = new Map();
  start(tabId, origin, siteId, metadata = {}, now = Date.now()) {
    const item = { sessionId: crypto.randomUUID(), tabId, origin, siteId, created: now, startedAt: metadata.startedAt ?? now, fieldId: metadata.fieldId ?? null, siteContext: metadata.siteContext ?? {}, status: 'searching' };
    this.#items.set(tabId, item);
    return item;
  }
  get(tabId) { return this.#items.get(tabId); }
  set(tabId, item) { this.#items.set(tabId, item); }
  delete(tabId) { this.#items.delete(tabId); }
  deleteTab(tabId) {
    for (const key of this.#items.keys()) if (String(key).startsWith(`${tabId}:`)) this.#items.delete(key);
  }
  valid(tabId, origin, sessionId, now = Date.now()) {
    const item = this.#items.get(tabId);
    return item?.origin === origin && item?.sessionId === sessionId && candidateIsFresh(item, now) ? item : null;
  }
  expire(now = Date.now()) {
    for (const [tabId, item] of this.#items) if (now - item.created > SEARCH_WINDOW_SECONDS * 1000) this.#items.delete(tabId);
  }
}
