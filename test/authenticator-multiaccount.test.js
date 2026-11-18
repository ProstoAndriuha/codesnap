import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  extractAccountEmail,
  parseTotpInput,
  addTotpAccount,
  updateTotpAccount,
  refreshTotpSiteHints,
  generateTotpCode,
  getTotpCandidatesForSite,
  listAllTotpCodes,
  importTotpPayload,
  exportTotpVault
} from '../src/totp.js';

function makeChromeStorageMock(initialLocal = {}, initialSession = {}) {
  const local = { ...initialLocal };
  const session = { ...initialSession };
  return {
    localData: local,
    sessionData: session,
    storage: {
      local: {
        get: async keys => {
          if (typeof keys === 'string') return { [keys]: local[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, local[k]]));
          return { ...local };
        },
        set: async obj => Object.assign(local, obj)
      },
      session: {
        get: async keys => {
          if (typeof keys === 'string') return { [keys]: session[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, session[k]]));
          return { ...session };
        },
        set: async obj => Object.assign(session, obj)
      }
    }
  };
}

function setupBasicChromeEnv(mockStorage) {
  const prior = {
    chrome: globalThis.chrome,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval
  };
  globalThis.chrome = {
    storage: {
      ...mockStorage.storage,
      onChanged: { addListener() {} }
    },
    identity: { getAuthToken: async () => ({ token: 'tok' }), removeCachedAuthToken: async () => {} },
    tabs: {
      get: async () => null,
      create: async () => ({}),
      sendMessage: async () => null,
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    contextMenus: { removeAll: async () => {}, create: () => {} },
    alarms: { create: () => {} },
    offscreen: { createDocument: async () => {} },
    runtime: {
      id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
      getURL: path => `chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/${path.replace(/^\/+/, '')}`,
      getContexts: async () => [],
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };
  return () => Object.assign(globalThis, prior);
}

const SAMPLE_SECRETS = {
  okx1: 'JBSWY3DPEHPK3PXP',
  okx2: 'KRSXG5CTMVRXEZLU',
  kcex: 'MFRGGZDFMZTWQ2LK',
  czrex: 'NBSWY3DPEB3W64TMMQ======'.replace(/=+$/, ''),
  onebullex: 'GEZDGNBVGY3TQOJQ'
};

test('extractAccountEmail parses exchange label formats accurately', () => {
  assert.equal(extractAccountEmail('OKEx.com--tomaandreioff@gmail.com'), 'tomaandreioff@gmail.com');
  assert.equal(extractAccountEmail('tomaandreiw@gmail.com-CZR'), 'tomaandreiw@gmail.com');
  assert.equal(extractAccountEmail('ined/kcex'), null);
  assert.equal(extractAccountEmail('tomaandreiw@gmail.com'), 'tomaandreiw@gmail.com');
  assert.equal(extractAccountEmail('Alice <USER.Name+1@Sub.Example.COM>', 'Okex'), 'user.name+1@sub.example.com');
});

test('importTotpPayload imports Authenticator .txt/.json, .2fas, Aegis, Bitwarden, CSV and exports cleanly', async () => {
  const mockStorage = makeChromeStorageMock();
  const restore = setupBasicChromeEnv(mockStorage);
  try {
    // 1) Authenticator.cc .txt multi-line otpauth:// import
    const txtPayload = [
      `otpauth://totp/Okex:OKEx.com--tomaandreioff@gmail.com?secret=${SAMPLE_SECRETS.okx1}&issuer=Okex`,
      `otpauth://totp/Okex:OKEx.com--tomaandreiw@gmail.com?secret=${SAMPLE_SECRETS.okx2}&issuer=Okex`,
      `otpauth://totp/kcex:ined/kcex?secret=${SAMPLE_SECRETS.kcex}&issuer=kcex`,
      `otpauth://totp/czrex:tomaandreiw@gmail.com-CZR?secret=${SAMPLE_SECRETS.czrex}&issuer=czrex`,
      `otpauth://totp/onebullex:tomaandreiw@gmail.com?secret=${SAMPLE_SECRETS.onebullex}&issuer=onebullex`
    ].join('\n');

    const firstImport = await importTotpPayload(txtPayload, {}, 1_700_000_000_000);
    assert.deepEqual(firstImport, { ok: true, imported: 5, updated: 0, total: 5 });

    // Re-importing same accounts deduplicates cleanly
    const reImport = await importTotpPayload(txtPayload, {}, 1_700_000_000_000);
    assert.deepEqual(reImport, { ok: true, imported: 0, updated: 5, total: 5 });

    const hints = mockStorage.localData.totpSiteHints ?? [];
    const okx1Hint = hints.find(h => h.accountEmail === 'tomaandreioff@gmail.com');
    const kcexHint = hints.find(h => h.issuer === 'kcex');
    const onebullHint = hints.find(h => h.issuer === 'onebullex');
    assert.ok(okx1Hint.matchDomains.includes('okx.com'));
    assert.equal(kcexHint.accountEmail, null);
    assert.ok(kcexHint.matchDomains.includes('kcex.com'));
    assert.ok(onebullHint.matchDomains.includes('onebullex.com'));
    assert.equal(onebullHint.accountEmail, 'tomaandreiw@gmail.com');

    // Export TXT and JSON round-trip into an empty storage
    const exportedTxt = await exportTotpVault('txt');
    const exportedJson = await exportTotpVault('json');
    assert.equal(exportedTxt.split(/\r?\n/).length, 5);
    assert.match(exportedJson, /"format": "codesnap-totp"/);

    mockStorage.localData.totpVault = null;
    mockStorage.localData.totpSiteHints = [];
    const roundTrip = await importTotpPayload(exportedJson);
    assert.deepEqual(roundTrip, { ok: true, imported: 5, updated: 0, total: 5 });

    // updateTotpAccount edits account label & refreshes accountEmail
    const targetHint = mockStorage.localData.totpSiteHints.find(h => h.issuer === 'kcex');
    const updated = await updateTotpAccount(targetHint.id, { account: 'trader@kcex.com' });
    assert.equal(updated.account.account, 'trader@kcex.com');
    assert.equal(updated.account.accountEmail, 'trader@kcex.com');

    // 2) Encrypted Authenticator.cc JSON rejects cleanly
    await assert.rejects(
      () => importTotpPayload(JSON.stringify({ id1: { encrypted: true, issuer: 'OKX', secret: 'cipher' } })),
      /TOTP_IMPORT_ENCRYPTED_JSON/
    );

    // 3) Unencrypted Authenticator.cc JSON map import
    mockStorage.localData.totpVault = null;
    mockStorage.localData.totpSiteHints = [];
    const authJson = JSON.stringify({
      entryA: { issuer: 'GitHub', account: 'dev@example.com', secret: SAMPLE_SECRETS.okx1, type: 'totp', digits: 6, period: 30 }
    });
    assert.equal((await importTotpPayload(authJson)).imported, 1);

    // 4) .2fas import
    const twoFasJson = JSON.stringify({
      services: [
        { name: 'Bybit', secret: SAMPLE_SECRETS.okx2, otp: { account: 'bybit@example.com', issuer: 'Bybit', digits: 6, period: 30, algorithm: 'SHA1', tokenType: 'TOTP' } }
      ]
    });
    assert.equal((await importTotpPayload(twoFasJson)).imported, 1);

    // 5) Aegis JSON import
    const aegisJson = JSON.stringify({
      db: {
        entries: [
          { type: 'totp', name: 'sec@example.com', issuer: 'Kraken', info: { secret: SAMPLE_SECRETS.kcex, algo: 'SHA1', digits: 6, period: 30 } }
        ]
      }
    });
    assert.equal((await importTotpPayload(aegisJson)).imported, 1);

    // 6) Bitwarden JSON import
    const bitwardenJson = JSON.stringify({
      items: [
        { name: 'BingX', login: { username: 'bw@example.com', uris: [{ uri: 'https://bingx.com/login' }], totp: SAMPLE_SECRETS.onebullex } }
      ]
    });
    assert.equal((await importTotpPayload(bitwardenJson)).imported, 1);

    // 7) CSV import
    const csvPayload = `Gate.io,csv@example.com,${SAMPLE_SECRETS.czrex}`;
    assert.equal((await importTotpPayload(csvPayload)).imported, 1);

    const listed = await listAllTotpCodes('https://bingx.com');
    assert.equal(listed.count, 5);
    assert.equal(listed.items[0].issuer, 'BingX');
    assert.equal(listed.items[0].isCurrentSite, true);
  } finally {
    restore();
  }
});

test('multi-account OKX disambiguates by typed/matched/unique-masked email or returns choose when ambiguous', async () => {
  const mockStorage = makeChromeStorageMock();
  const restore = setupBasicChromeEnv(mockStorage);
  try {
    const now = 1_700_000_000_000;
    await importTotpPayload([
      `otpauth://totp/Okex:OKEx.com--tomaandreioff@gmail.com?secret=${SAMPLE_SECRETS.okx1}&issuer=Okex`,
      `otpauth://totp/Okex:OKEx.com--tomaandreiw@gmail.com?secret=${SAMPLE_SECRETS.okx2}&issuer=Okex`,
      `otpauth://totp/kcex:ined/kcex?secret=${SAMPLE_SECRETS.kcex}&issuer=kcex`,
      `otpauth://totp/czrex:tomaandreiw@gmail.com-CZR?secret=${SAMPLE_SECRETS.czrex}&issuer=czrex`,
      `otpauth://totp/onebullex:tomaandreiw@gmail.com?secret=${SAMPLE_SECRETS.onebullex}&issuer=onebullex`
    ].join('\n'), {}, now);

    // No email clue -> ambiguous chooser
    const noCue = await getTotpCandidatesForSite('https://www.okx.com', {}, now);
    assert.equal(noCue.status, 'choose');
    assert.equal(noCue.count, 2);
    assert.equal(noCue.candidates.length, 2);

    // Ambiguous mask "t***@gmail.com" matches both tomaandreioff@gmail.com and tomaandreiw@gmail.com equally -> choose
    const ambigMask = await getTotpCandidatesForSite('https://www.okx.com', { maskedEmail: 't***@gmail.com' }, now);
    assert.equal(ambigMask.status, 'choose');
    assert.equal(ambigMask.count, 2);

    // Auto-select via lastTypedEmail
    const byTyped = await getTotpCandidatesForSite('https://www.okx.com', { lastTypedEmail: 'tomaandreiw@gmail.com' }, now);
    assert.equal(byTyped.status, 'found');
    assert.equal(byTyped.resolvedByAccount, true);
    assert.equal(byTyped.accountEmail, 'tomaandreiw@gmail.com');

    // Auto-select via matchedEmailAccount
    const byMatchedMail = await getTotpCandidatesForSite('https://www.okx.com', { matchedEmailAccount: 'tomaandreioff@gmail.com' }, now);
    assert.equal(byMatchedMail.status, 'found');
    assert.equal(byMatchedMail.resolvedByAccount, true);
    assert.equal(byMatchedMail.accountEmail, 'tomaandreioff@gmail.com');

    // Auto-select via unique maskedEmail
    const byUniqueMask = await getTotpCandidatesForSite('https://www.okx.com', { maskedEmail: 'toma***off@gmail.com' }, now);
    assert.equal(byUniqueMask.status, 'found');
    assert.equal(byUniqueMask.resolvedByAccount, true);
    assert.equal(byUniqueMask.accountEmail, 'tomaandreioff@gmail.com');

    // listAllTotpCodes puts OKX cards first with isCurrentSite = true
    const allList = await listAllTotpCodes('https://www.okx.com', {}, now);
    assert.equal(allList.status, 'ok');
    assert.equal(allList.count, 5);
    assert.equal(allList.items[0].isCurrentSite, true);
    assert.equal(allList.items[1].isCurrentSite, true);
    assert.equal(allList.items[2].isCurrentSite, false);
    assert.equal(allList.items[3].isCurrentSite, false);
    assert.equal(allList.items[4].isCurrentSite, false);
  } finally {
    restore();
  }
});

test('inline OKX multi-account flow shows 🔐 2FA (2) chooser and auto-selects when login email was typed', async () => {
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8')
    .replaceAll('if (!event.isTrusted) return;', '')
    .replaceAll('if (event.isTrusted) ', '');

  const mockStorage = makeChromeStorageMock({
    autoWatch: true,
    totpEnabled: true,
    detailedPopup: false,
    senders: {},
    learnedSenders: {},
    accountSelections: {},
    learnedAccounts: {}
  });
  const prior = {
    chrome: globalThis.chrome,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval
  };
  let bgListener;
  let activeContentListener;
  let activeTabUrl = 'https://www.okx.com/account/login-verify';

  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: {
      ...mockStorage.storage,
      onChanged: { addListener() {} }
    },
    identity: { getAuthToken: async () => ({ token: 'tok' }), removeCachedAuthToken: async () => {} },
    tabs: {
      get: async () => ({ id: 9, url: activeTabUrl }),
      create: async () => ({}),
      sendMessage: async (_tabId, msg) => (activeContentListener ? new Promise(resolve => activeContentListener(msg, {}, resolve)) : null),
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    contextMenus: { removeAll: async () => {}, create: () => {} },
    alarms: { create: () => {} },
    offscreen: { createDocument: async () => {} },
    runtime: {
      id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
      getURL: path => `chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/${path.replace(/^\/+/, '')}`,
      getContexts: async () => [],
      onMessage: { addListener(fn) { bgListener = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) });

  try {
    await addTotpAccount(`otpauth://totp/Okex:OKEx.com--tomaandreioff@gmail.com?secret=${SAMPLE_SECRETS.okx1}&issuer=Okex`);
    await addTotpAccount(`otpauth://totp/Okex:OKEx.com--tomaandreiw@gmail.com?secret=${SAMPLE_SECRETS.okx2}&issuer=Okex`);
    await import(`../src/background.js?multi=${Math.random()}`);

    // Scenario A: Ambiguous OKX 2FA page shows 🔐 2FA (2) chip and opens chooser with both email accounts
    const ambigDom = new JSDOM(`
      <main>
        <h1>OKX Security Verification</h1>
        <label for="totp">Google Authenticator code</label>
        <input id="totp" maxlength="6" inputmode="numeric">
      </main>
    `, { url: 'https://www.okx.com/account/login-verify', runScripts: 'outside-only' });

    try {
      ambigDom.window.crypto.randomUUID = (() => { let n = 0; return () => `a-${++n}`; })();
      ambigDom.window.setInterval = () => 1;
      ambigDom.window.chrome = {
        storage: {
          local: { get: async k => mockStorage.storage.local.get(k), set: async o => mockStorage.storage.local.set(o) },
          onChanged: { addListener() {} }
        },
        runtime: {
          onMessage: { addListener(fn) { activeContentListener = fn; } },
          sendMessage: async req => new Promise(resolve => bgListener(req, { tab: { id: 9 }, frameId: 0, url: 'https://www.okx.com/account/login-verify' }, resolve))
        }
      };

      ambigDom.window.eval(fieldsSource);
      ambigDom.window.eval(contentSource);

      let chip;
      for (let i = 0; i < 30; i++) {
        chip = ambigDom.window.document.querySelector('button[aria-label="Find verification code"]');
        if (chip?.textContent === '🔐 2FA (2)') break;
        await new Promise(r => setTimeout(r, 25));
      }
      assert.ok(chip, 'Expected floating chip on OKX 2FA page');
      assert.equal(chip.textContent, '🔐 2FA (2)');

      chip.click();
      await new Promise(r => setTimeout(r, 20));

      const panelHost = ambigDom.window.document.querySelector('#codesnap-inline-panel');
      assert.ok(panelHost, 'Expected inline chooser panel to open');
      const panelText = panelHost.shadowRoot.textContent;
      assert.match(panelText, /tomaandreioff@gmail\.com/);
      assert.match(panelText, /tomaandreiw@gmail\.com/);

      const pickBtns = [...panelHost.shadowRoot.querySelectorAll('.totp-pick-btn')];
      assert.equal(pickBtns.length, 2);

      // Click second candidate (tomaandreiw@gmail.com / okx2)
      const beforeGen = (await generateTotpCode({ secret: SAMPLE_SECRETS.okx2 }, Date.now())).code;
      pickBtns[1].click();

      const totpInput = ambigDom.window.document.querySelector('#totp');
      for (let i = 0; i < 25; i++) {
        if (totpInput.value) break;
        await new Promise(r => setTimeout(r, 25));
      }
      const afterGen = (await generateTotpCode({ secret: SAMPLE_SECRETS.okx2 }, Date.now())).code;
      assert.ok(totpInput.value === beforeGen || totpInput.value === afterGen, `Expected okx2 code, got ${totpInput.value}`);
    } finally {
      ambigDom.window.close();
    }

    // Scenario B: Typing email on login step saves __cs_login_email and auto-selects on redirected 2FA page
    const loginDom = new JSDOM(`
      <form>
        <input id="email" type="email" autocomplete="username">
      </form>
    `, { url: 'https://www.okx.com/account/login', runScripts: 'outside-only' });
    let capturedSessionEmail;
    try {
      loginDom.window.crypto.randomUUID = (() => { let n = 0; return () => `l-${++n}`; })();
      loginDom.window.setInterval = () => 1;
      loginDom.window.chrome = {
        storage: {
          local: { get: async k => mockStorage.storage.local.get(k), set: async o => mockStorage.storage.local.set(o) },
          onChanged: { addListener() {} }
        },
        runtime: {
          onMessage: { addListener(fn) { activeContentListener = fn; } },
          sendMessage: async req => new Promise(resolve => bgListener(req, { tab: { id: 9 }, frameId: 0, url: 'https://www.okx.com/account/login' }, resolve))
        }
      };
      loginDom.window.eval(fieldsSource);
      loginDom.window.eval(contentSource);

      const emailInput = loginDom.window.document.querySelector('#email');
      emailInput.value = 'tomaandreiw@gmail.com';
      emailInput.dispatchEvent(new loginDom.window.Event('input', { bubbles: true }));
      capturedSessionEmail = loginDom.window.sessionStorage.getItem('__cs_login_email');
      assert.ok(capturedSessionEmail);
      assert.equal(JSON.parse(capturedSessionEmail).email, 'tomaandreiw@gmail.com');
    } finally {
      loginDom.window.close();
    }

    const verifyDom = new JSDOM(`
      <main>
        <h1>OKX Security Verification</h1>
        <label for="totp">Google Authenticator code</label>
        <input id="totp" maxlength="6" inputmode="numeric">
      </main>
    `, { url: 'https://www.okx.com/account/login-verify', runScripts: 'outside-only' });
    try {
      verifyDom.window.sessionStorage.setItem('__cs_login_email', capturedSessionEmail);
      verifyDom.window.crypto.randomUUID = (() => { let n = 0; return () => `v-${++n}`; })();
      verifyDom.window.setInterval = () => 1;
      verifyDom.window.chrome = {
        storage: {
          local: { get: async k => mockStorage.storage.local.get(k), set: async o => mockStorage.storage.local.set(o) },
          onChanged: { addListener() {} }
        },
        runtime: {
          onMessage: { addListener(fn) { activeContentListener = fn; } },
          sendMessage: async req => new Promise(resolve => bgListener(req, { tab: { id: 9 }, frameId: 0, url: 'https://www.okx.com/account/login-verify' }, resolve))
        }
      };

      verifyDom.window.eval(fieldsSource);
      verifyDom.window.eval(contentSource);

      const beforeExpected = (await generateTotpCode({ secret: SAMPLE_SECRETS.okx2 }, Date.now())).code;
      let autoChip;
      for (let i = 0; i < 30; i++) {
        autoChip = verifyDom.window.document.querySelector('button[aria-label="Find verification code"]');
        if (autoChip && /^\d{6}\s·\s\d+s$/.test(autoChip.textContent ?? '')) break;
        await new Promise(r => setTimeout(r, 25));
      }
      const afterExpected = (await generateTotpCode({ secret: SAMPLE_SECRETS.okx2 }, Date.now())).code;
      assert.ok(autoChip, 'Expected auto-resolved TOTP chip');
      assert.ok(
        autoChip.textContent.startsWith(beforeExpected) || autoChip.textContent.startsWith(afterExpected),
        `Expected chip to show okx2 code (${beforeExpected}/${afterExpected}), got ${autoChip.textContent}`
      );
      assert.match(autoChip.title, /tomaandreiw@gmail\.com/);
    } finally {
      verifyDom.window.close();
    }
  } finally {
    Object.assign(globalThis, prior);
  }
});

test('BloFin label variants, unattributed email fallback and stale hint refresh match blofin.com', async () => {
  const mockStorage = makeChromeStorageMock();
  const restore = setupBasicChromeEnv(mockStorage);
  try {
    const p1 = parseTotpInput(`otpauth://totp/BloFin-trader1@gmail.com?secret=${SAMPLE_SECRETS.okx1}`);
    assert.equal(p1.issuer, 'BloFin');
    assert.equal(p1.domain, 'blofin.com');

    const p2 = parseTotpInput(`otpauth://totp/trader2@gmail.com-BloFin?secret=${SAMPLE_SECRETS.okx2}`);
    assert.equal(p2.issuer, 'BloFin');
    assert.equal(p2.domain, 'blofin.com');

    const p3 = parseTotpInput(SAMPLE_SECRETS.kcex, { issuer: 'BloFin1', account: 'trader3@gmail.com' });
    assert.equal(p3.domain, 'blofin.com');

    // Simulate stale 1.1.0 hints lacking domain/matchDomains/unattributed upgrade
    await addTotpAccount(`otpauth://totp/BloFin1:trader1@gmail.com?secret=${SAMPLE_SECRETS.okx1}&issuer=BloFin1`);
    mockStorage.localData.totpSiteHints = [
      { id: mockStorage.localData.totpSiteHints[0].id, issuer: 'BloFin1', account: 'trader1@gmail.com', domain: '', matchDomains: [], matchNames: ['blofin1'] }
    ];
    const refreshed = await refreshTotpSiteHints();
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.updated, true);

    const blofinRes = await getTotpCandidatesForSite('https://blofin.com');
    assert.equal(blofinRes.status, 'found');
    assert.equal(blofinRes.issuer, 'BloFin1');
    assert.equal(blofinRes.domain, 'blofin.com');

    // Email-only entry (no site label) matches only via lastTypedEmail/pageEmails on blofin.com
    mockStorage.localData.totpVault = null;
    mockStorage.localData.totpSiteHints = [];
    await addTotpAccount(`otpauth://totp/mywallet@gmail.com?secret=${SAMPLE_SECRETS.czrex}`);
    const withoutEmail = await getTotpCandidatesForSite('https://blofin.com');
    assert.equal(withoutEmail.status, 'none');
    const withEmail = await getTotpCandidatesForSite('https://blofin.com', { lastTypedEmail: 'mywallet@gmail.com' });
    assert.equal(withEmail.status, 'found');
    assert.equal(withEmail.accountEmail, 'mywallet@gmail.com');
  } finally {
    restore();
  }
});

test('BloFin SPA 6-box, maxlength="6" and aria-hidden overlay 2FA forms detect authenticator & insert on click', async () => {
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8')
    .replaceAll('if (!event.isTrusted) return;', '')
    .replaceAll('if (event.isTrusted) ', '');

  const mockStorage = makeChromeStorageMock({
    autoWatch: true,
    totpEnabled: true,
    detailedPopup: false,
    senders: {},
    learnedSenders: {},
    accountSelections: {},
    learnedAccounts: {}
  });
  const prior = {
    chrome: globalThis.chrome,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval
  };
  let bgListener;
  let activeContentListener;

  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: {
      ...mockStorage.storage,
      onChanged: { addListener() {} }
    },
    identity: { getAuthToken: async () => ({ token: 'tok' }), removeCachedAuthToken: async () => {} },
    tabs: {
      get: async () => ({ id: 12, url: 'https://blofin.com/en/login?redirect=%2Fen%2F' }),
      create: async () => ({}),
      sendMessage: async (_tabId, msg) => (activeContentListener ? new Promise(resolve => activeContentListener(msg, {}, resolve)) : null),
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    contextMenus: { removeAll: async () => {}, create: () => {} },
    alarms: { create: () => {} },
    offscreen: { createDocument: async () => {} },
    runtime: {
      id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
      getURL: path => `chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/${path.replace(/^\/+/, '')}`,
      getContexts: async () => [],
      onMessage: { addListener(fn) { bgListener = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) });

  try {
    await addTotpAccount(`otpauth://totp/BloFin:user@blofin.example?secret=${SAMPLE_SECRETS.okx1}&issuer=BloFin`);
    await import(`../src/background.js?blofin=${Math.random()}`);

    const layouts = [
      {
        name: 'deep-form-nested-6cell-with-hidden-step1',
        html: `
          <div class="auth-card">
            <div class="step1" style="display:none">
              <input name="email" type="text" value="user@blofin.example">
              <input name="password" type="password" value="secret">
            </div>
            <div class="card-header"><span>←</span><h1>Google Authenticator</h1></div>
            <p>Enter the Google Authenticator code</p>
            <form>
              <div><div><div><div><div><div><div>
                ${'<input maxlength="1" autocomplete="off">'.repeat(6)}
              </div></div></div></div></div></div></div>
              <button type="submit">Confirm</button>
              <a href="#trouble">Unable to verify?</a>
            </form>
          </div>
        `,
        readValue: doc => [...doc.querySelectorAll('form input')].map(i => i.value).join('')
      },
      {
        name: 'six-inputs-maxlength-6',
        html: `
          <div class="auth-card">
            <h2>Google Authenticator</h2>
            <p>Enter the Google Authenticator code</p>
            <form class="otp-form">
              <div class="otp-row">
                ${'<input type="tel" maxlength="6" inputmode="numeric">'.repeat(6)}
              </div>
              <button type="button">Confirm</button>
            </form>
          </div>
        `,
        readValue: doc => [...doc.querySelectorAll('.otp-row input')].map(i => i.value).join('')
      },
      {
        name: 'aria-hidden-overlay-input-with-6-decorative-slots',
        html: `
          <div class="auth-card">
            <h2>Google Authenticator</h2>
            <p>Enter the Google Authenticator code</p>
            <div class="otp-wrapper">
              <input id="overlay-otp" aria-hidden="true" tabindex="0" inputmode="numeric" maxlength="6">
              <div class="slots">
                <div class="slot"></div><div class="slot"></div><div class="slot"></div>
                <div class="slot"></div><div class="slot"></div><div class="slot"></div>
              </div>
            </div>
          </div>
        `,
        wireDom: doc => {
          const input = doc.querySelector('#overlay-otp');
          const slots = [...doc.querySelectorAll('.slot')];
          input.addEventListener('paste', e => {
            e.preventDefault();
            const text = (e.clipboardData?.getData('text/plain') || '').slice(0, 6);
            slots.forEach((s, idx) => { s.textContent = text[idx] ?? ''; });
          });
        },
        readValue: doc => [...doc.querySelectorAll('.slot')].map(s => s.textContent.trim()).join('')
      }
    ];

    for (const layout of layouts) {
      const dom = new JSDOM(`<!doctype html><body>${layout.html}</body>`, {
        url: 'https://blofin.com/en/login?redirect=%2Fen%2F',
        runScripts: 'outside-only'
      });
      try {
        layout.wireDom?.(dom.window.document);
        dom.window.crypto.randomUUID = (() => { let n = 0; return () => `bf-${layout.name}-${++n}`; })();
        dom.window.setInterval = () => 1;
        dom.window.chrome = {
          storage: {
            local: { get: async k => mockStorage.storage.local.get(k), set: async o => mockStorage.storage.local.set(o) },
            onChanged: { addListener() {} }
          },
          runtime: {
            onMessage: { addListener(fn) { activeContentListener = fn; } },
            sendMessage: async req => new Promise(resolve => bgListener(req, { tab: { id: 12 }, frameId: 0, url: 'https://blofin.com/en/login?redirect=%2Fen%2F' }, resolve))
          }
        };

        dom.window.eval(fieldsSource);
        const detected = dom.window.VerificationFields.detect(dom.window.document, { allow2fa: true });
        assert.ok(detected, `${layout.name}: expected VerificationFields.detect to find 2FA field`);
        assert.equal(detected.channel, 'authenticator', `${layout.name}: expected channel=authenticator`);

        dom.window.eval(contentSource);
        let chip;
        for (let i = 0; i < 30; i++) {
          chip = dom.window.document.querySelector('button[aria-label="Find verification code"]');
          if (chip && /^\d{6}\s·\s\d+s$/.test(chip.textContent ?? '')) break;
          await new Promise(r => setTimeout(r, 25));
        }
        assert.ok(chip && /^\d{6}\s·\s\d+s$/.test(chip.textContent ?? ''), `${layout.name}: expected live 2FA chip, got ${chip?.textContent}`);

        const beforeGen = (await generateTotpCode({ secret: SAMPLE_SECRETS.okx1 }, Date.now())).code;
        chip.click();
        for (let i = 0; i < 40; i++) {
          if (chip.textContent === '✓' && layout.readValue(dom.window.document).length === 6) break;
          await new Promise(r => setTimeout(r, 25));
        }
        const afterGen = (await generateTotpCode({ secret: SAMPLE_SECRETS.okx1 }, Date.now())).code;
        const val = layout.readValue(dom.window.document);
        assert.ok(val === beforeGen || val === afterGen, `${layout.name}: expected code ${beforeGen}/${afterGen}, got ${val}`);
      } finally {
        dom.window.close();
      }
    }
  } finally {
    Object.assign(globalThis, prior);
  }
});
