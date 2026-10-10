import test from 'node:test';
import assert from 'node:assert/strict';
import { siteForOrigin, trustedOrigin, senderMatches, subjectMatches, extractCodes, isFresh, rankCandidates, siteIdentity, lifetimeSeconds, candidateIsFresh } from '../src/core.js';

test('Microsoft single-use mail matches its separate login domain without trusting lookalikes', () => {
  const now = Date.now();
  const mail = { id: 'ms-otp', from: 'Microsoft account team <account-security-noreply@accountprotection.microsoft.com>', subject: 'Разовый код', body: 'Мы получили запрос на отправку разового кода для вашей учетной записи Майкрософт. Ваш разовый код: 483921. Вводите этот код только на официальном сайте или в приложении. Заявление о конфиденциальности: https://go.microsoft.com/fwlink/?LinkId=521839', timestamp: now - 1000 };
  for (const origin of ['https://login.live.com', 'https://account.live.com', 'https://login.microsoftonline.com']) {
    const result = rankCandidates([mail], { siteId: 'generic', origin, now });
    assert.equal(result.status, 'found');
    assert.equal(result.candidate.code, '483921');
    assert.equal(result.candidate.requiresReview, true);
    assert.equal(rankCandidates([{ ...mail, timestamp: now - 181000 }], { siteId: 'generic', origin, now }).status, 'old');
  }
  for (const origin of ['https://login.live.com.evil.test', 'https://live.evil.test', 'https://unrelated.example']) {
    assert.equal(rankCandidates([mail], { siteId: 'generic', origin, siteContext: { title: 'Microsoft' }, now }).status, 'none');
  }
  assert.equal(rankCandidates([{ ...mail, from: 'account-security-noreply@accountprotection.microsoft.com.evil.test' }], { siteId: 'generic', origin: 'https://login.live.com', now }).status, 'none');
});

test('exact site origin blocks phishing lookalikes', () => {
  assert.equal(siteForOrigin('https://www.binance.com'), 'binance');
  assert.equal(siteForOrigin('https://www.binance.com.evil.test'), null);
  assert.equal(trustedOrigin('http://www.binance.com', 'binance'), false);
  assert.equal(trustedOrigin('https://binance.com', 'binance'), false);
  assert.equal(siteForOrigin('https://www.bybit.com'), 'bybit');
  assert.equal(siteForOrigin('https://www.okx.com'), 'okx');
  assert.equal(siteForOrigin('https://random-new-site.example'), null);
  assert.equal(siteForOrigin('https://www.alphax.com'), null);
  assert.equal(siteForOrigin('https://www.alphax.com.evil.test'), null);
});

test('unrelated mail-provider domains match a site by its hostname brand in subject and body', () => {
  const now = Date.now();
  const options = { siteId: 'generic', origin: 'https://www.alphax.com', now };
  const mail = { id: 'provider', from: 'no-reply@mail.privy.io', subject: 'Your login code for AlphaX', body: 'Log in to AlphaX. Your code is 483921. This code expires in 10 minutes.', timestamp: now - 6 * 60_000 };
  assert.equal(rankCandidates([mail], options).candidate.code, '483921');
  assert.equal(rankCandidates([mail], options).candidate.requiresReview, true);
  assert.equal(rankCandidates([mail], { ...options, learnedSenders: ['no-reply@mail.privy.io'] }).candidate.requiresReview, false);
  assert.equal(rankCandidates([mail], options).candidate.lifetimeSeconds, 600);
  assert.equal(rankCandidates([{ ...mail, subject: 'Login' }], options).candidate.requiresReview, true);
  assert.equal(rankCandidates([{ ...mail, timestamp: now - 1000, subject: 'Login', body: 'Your code is 483921. This code expires in 10 minutes.' }], options).status, 'none');
  assert.equal(rankCandidates([{ ...mail, timestamp: now - 1000, subject: 'Login', body: 'FakeAlphaXPlus. Your code is 483921.' }], options).status, 'none');
  assert.equal(rankCandidates([{ ...mail, timestamp: now - 11 * 60_000 }], options).status, 'old');
  const other = { ...mail, id: 'other', subject: 'Your login code for Northstar', body: 'Northstar login code is 738291. Valid for 5 minutes.', timestamp: now - 4 * 60_000 };
  assert.equal(rankCandidates([other], { siteId: 'generic', origin: 'https://login.northstar.example', now }).candidate.code, '738291');
  assert.equal(lifetimeSeconds('Expires in 10 minutes'), 600);
  assert.equal(lifetimeSeconds('Expires in 45 minutes'), 900);
  assert.equal(candidateIsFresh({ timestamp: now - 6 * 60_000, lifetimeSeconds: 600 }, now), true);
});
test('sender and subject match exact verified values', () => {
  assert.equal(senderMatches('Binance <notice@binance.com>', 'notice@binance.com'), true);
  assert.equal(senderMatches('notice@binance.com.evil.test', 'notice@binance.com'), false);
  assert.equal(subjectMatches('Your verification code', 'binance'), true);
  assert.equal(subjectMatches('Sale today', 'binance'), false);
});
test('extracts contextual numeric and alphanumeric codes only', () => {
  assert.deepEqual(extractCodes('Your verification code is 483921.'), ['483921']);
  assert.deepEqual(extractCodes('Email OTP: A7K92P'), ['A7K92P']);
  assert.deepEqual(extractCodes('Order number 483921'), []);
  assert.equal(extractCodes('Code 483921. Backup code 123456.').length, 2);
  assert.deepEqual(extractCodes('Your OTP is 4821'), ['4821']);
  assert.deepEqual(extractCodes('Authentication code: AB72K9P'), ['AB72K9P']);
  assert.deepEqual(extractCodes('Your code is <span>5</span> <span>8</span> <span>7</span> <span>8</span> <span>8</span> <span>7</span>'), ['587887']);
  assert.deepEqual(extractCodes('Verification code: <table><tr><td>2</td><td>9</td><td>4</td><td>7</td><td>1</td><td>8</td></tr></table>'), ['294718']);
  assert.deepEqual(extractCodes('Email code: 123 - 456'), ['123456']);
  assert.deepEqual(extractCodes('Your code expires in 2026. Code: 483921. Total: $150.00'), ['483921']);
  assert.deepEqual(extractCodes('Your referral code is 998877. Your verification code is 483921.'), ['483921']);
  assert.deepEqual(extractCodes('Use promo code 554433 for discount. Verification code: 483921.'), ['483921']);
  assert.deepEqual(extractCodes('Реферальный код: 887766. Код подтверждения: 483921.'), ['483921']);
  assert.deepEqual(extractCodes('Промокод: 778899. Ваш проверочный код: 483921.'), ['483921']);
  assert.deepEqual(extractCodes('Почтовый индекс: 101000. Код подтверждения: 483921.'), ['483921']);
  assert.deepEqual(extractCodes('Phone: +1 800 555 1234. OTP: 483921.'), ['483921']);
  assert.deepEqual(extractCodes('Total: 500 ₽. Your OTP code: 483921.'), ['483921']);
});
test('freshness rejects old and future timestamps', () => {
  assert.equal(isFresh(100_000, 280_000), true);
  assert.equal(isFresh(100_000, 281_000), false);
  assert.equal(isFresh(200_000, 100_000), false);
});
test('candidate ranking rejects wrong sender, old mail and ambiguous mails', () => {
  const now = 1_000_000;
  const message = (id, timestamp, code, from = 'notice@binance.com') => ({ id, timestamp, from, subject: 'Verification code', body: `Your verification code is ${code}` });
  const opts = { siteId: 'binance', sender: 'notice@binance.com', now };
  assert.equal(rankCandidates([message('x', now - 1000, '483921', 'bad@evil.test')], opts).status, 'none');
  assert.equal(rankCandidates([message('x', now - 200_000, '483921')], opts).status, 'old');
  assert.equal(rankCandidates([message('a', now - 1000, '483921'), message('b', now - 4000, '123456')], opts).status, 'ambiguous');
  assert.equal(rankCandidates([message('a', now - 1000, '483921'), message('b', now - 60_000, '123456')], opts).candidate.code, '483921');
});

test('generic matching supports a previously unknown HTTPS site without a saved sender', () => {
  const now = Date.now();
  const origin = 'https://accounts.novaportal.example';
  const candidate = { id: 'new', timestamp: now - 3000, from: 'codes@novaportal.example', subject: 'NovaPortal verification code', body: 'Your order number is 123456. Your verification code is 847291.' };
  const result = rankCandidates([candidate], { siteId: 'generic', origin, siteContext: { title: 'NovaPortal - Login' }, startedAt: now - 8000, now });
  assert.equal(result.status, 'found');
  assert.equal(result.candidate.code, '847291');
  assert.equal(siteIdentity(origin, { title: 'NovaPortal - Login' }).names.includes('novaportal'), true);
});

test('generic matching accepts a login subject from a sibling mail subdomain', () => {
  const now = Date.now();
  const mail = { id: 'login', timestamp: now - 1000, from: 'Bitbase <no-reply@mail.bitbase.com>', subject: 'Login', body: 'Dear Bitbase user: Your email verification code for login is 360069. Verification code is valid for 5 minutes.' };
  const result = rankCandidates([mail], { siteId: 'generic', origin: 'https://www.bitbase.com', now });
  assert.equal(result.status, 'found');
  assert.equal(result.candidate.code, '360069');
  assert.equal(result.candidate.requiresReview, false);
  assert.equal(rankCandidates([{ ...mail, from: 'Bitbase <no-reply@bitbase.com.evil.test>' }], { siteId: 'generic', origin: 'https://www.bitbase.com', now }).candidate.requiresReview, true);
});

test('third-party sender can match a brand named only in the message body, with review', () => {
  const now = Date.now();
  const mail = { id: 'provider', timestamp: now - 1000, from: 'codes@mailer.test', subject: 'Login', body: 'Bitbase: Your email verification code is 360069.' };
  const options = { siteId: 'generic', origin: 'https://www.bitbase.com', now };
  const result = rankCandidates([mail], options);
  assert.equal(result.status, 'found');
  assert.equal(result.candidate.code, '360069');
  assert.equal(result.candidate.subject, 'Login');
  assert.equal(result.candidate.requiresReview, true);
  assert.equal(rankCandidates([{ ...mail, body: 'Your email verification code is 360069.' }], options).status, 'none');
  assert.equal(rankCandidates([{ ...mail, body: 'BitbasePlus: Your email verification code is 360069.' }], options).status, 'none');
});

test('generic matching rejects unrelated sender/site and old session email', () => {
  const now = Date.now();
  const mail = { id: 'x', timestamp: now - 3000, from: 'codes@unrelated.example', subject: 'Unrelated verification code', body: 'Your verification code is 483921' };
  const opts = { siteId: 'generic', origin: 'https://newsite.example', siteContext: { title: 'NewSite' }, now };
  assert.equal(rankCandidates([mail], opts).status, 'none');
  assert.equal(rankCandidates([{ ...mail, from: 'codes@binance.com', subject: 'Binance verification code' }], { ...opts, origin: 'https://binance.com.evil.example', siteContext: { title: 'Binance' } }).status, 'none');
  assert.equal(rankCandidates([{ ...mail, from: 'codes@github.io', subject: 'GitHub verification code' }], { ...opts, origin: 'https://evil.github.io', siteContext: { title: 'GitHub' } }).status, 'none');
  assert.equal(rankCandidates([{ ...mail, from: 'codes@newsite.example', timestamp: now - 120_000 }], { ...opts, startedAt: now - 10_000 }).status, 'old');
});

test('generic matching surfaces conflicting same-time emails', () => {
  const now = Date.now();
  const mail = code => ({ id: code, timestamp: now - 1000, from: 'codes@example.com', subject: 'Example verification code', body: `Your verification code is ${code}` });
  const result = rankCandidates([mail('483921'), mail('847291')], { siteId: 'generic', origin: 'https://example.com', now });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('known-site adapters still rank verified-sender codes', () => {
  const now = Date.now();
  for (const [siteId, origin] of [['binance', 'https://www.binance.com'], ['bybit', 'https://www.bybit.com'], ['okx', 'https://www.okx.com']]) {
    const sender = `codes@${siteId}.com`;
    const mail = { id: siteId, timestamp: now - 1000, from: sender, subject: `${siteId} verification code`, body: 'Your verification code is 483921' };
    assert.equal(rankCandidates([mail], { siteId, origin, sender, now }).candidate.code, '483921', siteId);
  }
});

test('same-time codes from two Gmail accounts require a choice', () => {
  const now = Date.now();
  const base = { timestamp: now - 1000, from: 'codes@example.com', subject: 'Example verification code', body: 'Your verification code is 483921' };
  const result = rankCandidates([{ ...base, id: 'a', accountEmail: 'one@gmail.com' }, { ...base, id: 'b', accountEmail: 'two@gmail.com' }], { siteId: 'generic', origin: 'https://example.com', now });
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.candidates.map(x => x.accountEmail), ['one@gmail.com', 'two@gmail.com']);
});

test('automatic watch rejects a code sent before the detected session', () => {
  const now = Date.now();
  const mail = { id: 'old-session', timestamp: now - 20_000, from: 'codes@example.com', subject: 'Example verification code', body: 'Your verification code is 483921' };
  const params = { siteId: 'generic', origin: 'https://example.com', startedAt: now - 5000, now };
  assert.equal(rankCandidates([mail], { ...params, startToleranceMs: 5000 }).status, 'old');
  assert.equal(rankCandidates([mail], params).status, 'found');
});

test('automatic watch can find a newly requested code when extension detection starts after the email', () => {
  const now = Date.now();
  const mail = { id: 'recent', timestamp: now - 41_000, from: 'codes@example.com', subject: 'Example verification code', body: 'Your verification code is 483921' };
  const result = rankCandidates([mail], { siteId: 'generic', origin: 'https://example.com', startedAt: now, startToleranceMs: 60_000, now });
  assert.equal(result.status, 'found');
});

test('ranks Binance Russian withdrawal email correctly and extracts exact code', () => {
  const now = Date.now();
  const mail = {
    id: 'binance-withdrawal',
    timestamp: now - 9 * 60_000,
    from: 'Binance <do-not-reply@ses.binance.com>',
    subject: '[Binance] Запрошен вывод средств из Chisinau Moldova - 2026-09-26 15:20:24(UTC)',
    body: `Подтвердите вывод средств
Вы инициировали вывод 179.51 USDT на следующий адрес:
Адрес: 0xF34f6892146DF0b5f4d83b27Cb74e6eB84F93D58
Memo:
Прежде чем продолжить, внимательно проверьте адрес вывода средств. Binance не несет ответственности за потерю средств, отправленных на неверный адрес.

Код подтверждения
413356
Срок действия кода подтверждения истекает через 30 минут. Никому не сообщайте код.`
  };
  const result = rankCandidates([mail], { siteId: 'binance', origin: 'https://www.binance.com', now });
  assert.equal(result.status, 'found');
  assert.equal(result.candidate.code, '413356');
  assert.equal(result.candidate.lifetimeSeconds, 900);
  assert.equal(result.candidate.requiresReview, false);
});

test('extracts codes across multilingual withdrawal, login and security emails', () => {
  assert.deepEqual(extractCodes('Код подтверждения\n413356\nСрок действия истекает через 30 минут.'), ['413356']);
  assert.deepEqual(extractCodes('Подтвердите вывод средств. Код: 948201.'), ['948201']);
  assert.deepEqual(extractCodes('Google verification code: G-739201'), ['739201']);
  assert.deepEqual(extractCodes('Ваш одноразовый пароль для входа: 839102'), ['839102']);
  assert.deepEqual(extractCodes('Su código de confirmación es 628491.'), ['628491']);
  assert.deepEqual(extractCodes('Ihr Bestätigungscode lautet 519382.'), ['519382']);
  assert.deepEqual(extractCodes('您的提现验证码是 492810'), ['492810']);
});

test('ranks newer withdrawal email over older withdrawal email from same sender', () => {
  const now = Date.now();
  const mail1 = {
    id: 'binance-withdrawal-1',
    timestamp: now - 90_000,
    from: 'Binance <do-not-reply@ses.binance.com>',
    subject: '[Binance] Запрошен вывод средств',
    body: 'Код подтверждения: 111111. Срок действия 30 минут.'
  };
  const mail2 = {
    id: 'binance-withdrawal-2',
    timestamp: now - 10_000,
    from: 'Binance <do-not-reply@ses.binance.com>',
    subject: '[Binance] Запрошен вывод средств',
    body: 'Код подтверждения: 222222. Срок действия 30 минут.'
  };
  const result = rankCandidates([mail1, mail2], { siteId: 'binance', origin: 'https://www.binance.com', now });
  assert.equal(result.status, 'found');
  assert.equal(result.candidate.code, '222222');
});

test('single email with order ID, TXID and amount extracts only the verification code without ambiguity', () => {
  const now = Date.now();
  const mail = {
    id: 'onebullex-withdraw',
    timestamp: now - 5000,
    from: 'support@onebullex.com',
    subject: 'Withdrawal verification code',
    body: 'Your withdrawal verification code is: 839201. Order ID: 492018. TXID: 94820174. Amount: 250 USDT. IP: 192.168.1.1.'
  };
  const result = rankCandidates([mail], { siteId: 'generic', origin: 'https://app.onebullex.com', now });
  assert.equal(result.status, 'found');
  assert.equal(result.candidate.code, '839201');
});

test('Bitunix login email with anti-phishing code extracts the real 6-digit OTP code', () => {
  const now = Date.now();
  const mail = {
    id: 'bitunix-login',
    timestamp: now - 3000,
    from: 'Bitunix <no-reply@bitunix.com>',
    subject: 'You are trying to login to Bitunix',
    body: `You are trying to login to Bitunix.
Anti-phishing code: 8202

Your verification code is:
744185

The verification code will expire in 10 minutes.`
  };
  const result = rankCandidates([mail], { siteId: 'generic', origin: 'https://bitunix.com', now });
  assert.equal(result.status, 'found');
  assert.equal(result.candidate.code, '744185');
});

