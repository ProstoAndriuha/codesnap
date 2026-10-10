import { getGmailProfile } from './gmail.js';
import { listMailAccounts } from './mail-bridge.js';

// A separate Web application OAuth client is required for Google's account chooser.
// Chrome's manifest OAuth client remains in use for the primary Chrome account.
export const EXTRA_ACCOUNT_CLIENT_ID = '134116028146-6gqpmuduknhcje2mqjqmlj0ra5id6nbg.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function describeAuthError(error, extensionId = chrome.runtime?.id ?? 'unknown') {
  const message = String(error?.message ?? '');
  let reason;
  if (/BROWSER_UNSUPPORTED/.test(message)) reason = 'This browser does not support the required Google sign-in API.';
  else if (/bad client|invalid.client|client.*not found|redirect.*mismatch|invalid.*redirect/i.test(message)) reason = 'Google OAuth client does not match this extension ID or redirect URL.';
  else if (/not signed in|not logged in/i.test(message)) reason = 'Sign in to your Chrome profile before connecting Gmail.';
  else if (/cancel|closed|did not approve|user.*reject/i.test(message)) reason = 'Google sign-in was closed or cancelled.';
  else if (/access.denied|PERMISSION_DENIED|not authorized|not approved/i.test(message)) reason = 'Google denied Gmail access. Check the consent screen and account restrictions.';
  else if (/network|fetch|offline/i.test(message)) reason = 'Google could not be reached. Check the connection and try again.';
  else if (/AUTH_EXPIRED/.test(message)) reason = 'Google did not return a usable Gmail token. Connect again.';
  else if (/OAUTH_RESPONSE/.test(message)) reason = 'The Google sign-in response failed validation. Connect again.';
  else reason = 'Google sign-in failed. Verify this extension ID in Google Cloud.';
  return `${reason} Extension ID: ${extensionId}`;
}

async function extraAccounts() {
  const { extraAccounts = [] } = await chrome.storage.session.get('extraAccounts');
  const active = extraAccounts.filter(item => item.expiresAt > Date.now() + 15_000);
  if (active.length !== extraAccounts.length) await chrome.storage.session.set({ extraAccounts: active });
  return active;
}

export async function listAccounts() {
  const { primaryEmail = null } = await chrome.storage.local.get('primaryEmail');
  return { primaryEmail, extras: (await extraAccounts()).map(({ email, expiresAt }) => ({ email, expiresAt })), mailAccounts: await listMailAccounts() };
}

export async function connectPrimary() {
  const agent = globalThis.navigator?.userAgent ?? '';
  const otherChromium = /(?:Edg|OPR|Vivaldi)\//.test(agent) || Boolean(globalThis.navigator?.brave);
  if (otherChromium || typeof chrome.identity?.getAuthToken !== 'function') return connectAdditional();
  const result = await chrome.identity.getAuthToken({ interactive: true });
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('AUTH_EXPIRED');
  const email = await getGmailProfile(token);
  await chrome.storage.local.set({ primaryEmail: email });
  return email;
}

export async function connectAdditional(clientId = EXTRA_ACCOUNT_CLIENT_ID) {
  if (clientId.startsWith('REPLACE_WITH_')) throw new Error('EXTRA_OAUTH_SETUP');
  if (typeof chrome.identity?.launchWebAuthFlow !== 'function' || !chrome.storage?.session) throw new Error('BROWSER_UNSUPPORTED');
  const extensionId = chrome.runtime?.id;
  const redirect = typeof chrome.identity.getRedirectURL === 'function' ? chrome.identity.getRedirectURL() :
    /^[a-p]{32}$/.test(extensionId ?? '') ? `https://${extensionId}.chromiumapp.org/` : null;
  if (!redirect) throw new Error('BROWSER_UNSUPPORTED');
  const state = crypto.randomUUID();
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'token', scope: SCOPE, state, prompt: 'select_account' });
  const result = await new Promise((resolve, reject) => {
    try {
      const maybePromise = chrome.identity.launchWebAuthFlow({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, interactive: true }, url => {
        const failure = chrome.runtime?.lastError;
        if (failure) reject(new Error(failure.message || 'OAUTH_RESPONSE'));
        else resolve(url);
      });
      if (maybePromise?.then) maybePromise.then(resolve, reject);
    } catch (error) { reject(error); }
  });
  if (!result || new URL(result).origin !== new URL(redirect).origin || new URL(result).pathname !== new URL(redirect).pathname) throw new Error('OAUTH_RESPONSE');
  const fragment = new URLSearchParams(new URL(result).hash.slice(1));
  if (fragment.get('state') !== state || fragment.has('error') || fragment.get('token_type')?.toLowerCase() !== 'bearer') throw new Error('OAUTH_RESPONSE');
  const token = fragment.get('access_token');
  const scopes = (fragment.get('scope') ?? '').split(' ');
  const expiresIn = Number(fragment.get('expires_in'));
  if (!token || !scopes.includes(SCOPE) || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 7200) throw new Error('OAUTH_RESPONSE');
  const email = await getGmailProfile(token);
  const active = (await extraAccounts()).filter(item => item.email !== email);
  active.push({ email, token, expiresAt: Date.now() + Math.min(expiresIn, 3600) * 1000 });
  await chrome.storage.session.set({ extraAccounts: active });
  return email;
}

export async function forgetAdditional(email, revoke = false) {
  const current = await extraAccounts();
  const item = current.find(account => account.email === email);
  let revoked = false;
  if (revoke && item) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: item.token }) });
      revoked = response.ok;
    } catch { /* Local session removal still succeeds. */ }
  }
  await chrome.storage.session.set({ extraAccounts: current.filter(account => account.email !== email) });
  return revoked;
}

export async function getAccessTokens(selection = 'all') {
  const available = [];
  if (selection === 'all' || selection === 'primary') {
    try {
      const result = await chrome.identity.getAuthToken({ interactive: false });
      const token = typeof result === 'string' ? result : result?.token;
      if (token) {
        const { primaryEmail } = await chrome.storage.local.get('primaryEmail');
        available.push({ email: primaryEmail ?? await getGmailProfile(token), token, kind: 'primary' });
      }
    } catch { /* A connected additional account may still be usable. */ }
  }
  if (selection === 'all' || selection.startsWith('extra:')) {
    for (const item of await extraAccounts()) {
      if (selection === 'all' || selection === `extra:${item.email}`) available.push({ email: item.email, token: item.token, kind: 'extra' });
    }
  }
  if (!available.length) throw new Error('AUTH_EXPIRED');
  return available;
}
