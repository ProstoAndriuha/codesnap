import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeCandidates, extractCodes, rankCandidates, siteIdentity, matchesMaskedEmail, dkimDomains } from '../src/core.js';

test('extracts space-separated, hyphenated, emphasized HTML and subject-only OTP codes while ignoring URL numbers', () => {
  assert.deepEqual(extractCodes('Your login code is 483 921. Valid for 5 minutes.'), ['483921']);
  assert.deepEqual(extractCodes('Confirmation code: 48 39 21'), ['483921']);
  assert.deepEqual(extractCodes('Your code is AB3-9K2'), ['AB39K2']);
  assert.deepEqual(extractCodes('FB-847291 is your Facebook confirmation code'), ['847291']);
  assert.deepEqual(extractCodes('VK-192837 — ваш код подтверждения'), ['192837']);
  assert.deepEqual(extractCodes('Click https://example.com/verify?id=998877&ref=445566 or use code 310683'), ['310683']);

  const distantHtml = 'Please enter the following verification code on the login page where you started your session in another window right now to finish signing in: ' +
    '<table><tr><td><strong>749201</strong></td></tr></table>';
  assert.deepEqual(extractCodes(distantHtml, { html: distantHtml }), ['749201']);

  assert.deepEqual(extractCodes('Use this code to complete sign in.', { subject: '619482 is your login code' }), ['619482']);

  const preferred = extractCodeCandidates('PIN: 4411. Your verification code is 847291.', { expectedLength: 6 });
  assert.equal(preferred[0].code, '847291');
});

test('ecosystem and DKIM/Reply-To/body-domain attribution connect cross-domain mail safely without trusting phishing lookalikes', () => {
  const now = Date.now();

  const chatgptMail = {
    id: 'oai-1',
    from: 'OpenAI <noreply@tm.openai.com>',
    subject: 'Your ChatGPT code is 592814',
    body: 'Enter this verification code to sign in: 592814',
    timestamp: now - 2000
  };
  const chatgptResult = rankCandidates([chatgptMail], { siteId: 'generic', origin: 'https://chatgpt.com', now });
  assert.equal(chatgptResult.status, 'found');
  assert.equal(chatgptResult.candidate.code, '592814');
  assert.equal(chatgptResult.candidate.requiresReview, true);

  assert.equal(rankCandidates([chatgptMail], { siteId: 'generic', origin: 'https://chatgpt.com.evil.test', now }).status, 'none');

  const claudeMail = {
    id: 'cl-1',
    from: 'Anthropic <no-reply@mail.anthropic.com>',
    subject: 'Sign in to Claude',
    body: 'Your one-time code: 728194',
    timestamp: now - 2000
  };
  assert.equal(rankCandidates([claudeMail], { siteId: 'generic', origin: 'https://claude.ai', now }).candidate.code, '728194');

  const dkimMail = {
    id: 'dkim-1',
    from: 'mailer@sendgrid-relay.net',
    authResults: 'mx.google.com; dkim=pass header.d=mail.novaportal.co.uk; spf=pass',
    subject: 'Security code',
    body: 'Code: 492018',
    timestamp: now - 2000
  };
  const dkimResult = rankCandidates([dkimMail], { siteId: 'generic', origin: 'https://app.novaportal.co.uk', now });
  assert.equal(dkimResult.status, 'found');
  assert.equal(dkimResult.candidate.code, '492018');
  assert.equal(dkimResult.candidate.requiresReview, false);
  assert.deepEqual(dkimDomains(dkimMail.authResults), ['mail.novaportal.co.uk']);

  assert.equal(siteIdentity('https://app.example.com.ua').siteDomain, 'example.com.ua');
  assert.equal(siteIdentity('https://my-app.vercel.app').hostName, 'my-app');

  const maskedA = { id: 'm1', from: 'codes@example.com', subject: 'Verification code', body: 'Code: 111222', timestamp: now - 2000, accountEmail: 'alice.smith@gmail.com' };
  const maskedB = { id: 'm2', from: 'codes@example.com', subject: 'Verification code', body: 'Code: 333444', timestamp: now - 2000, accountEmail: 'bob.jones@gmail.com' };
  assert.equal(matchesMaskedEmail('alice.smith@gmail.com', 'al***th@gmail.com'), true);
  assert.equal(matchesMaskedEmail('bob.jones@gmail.com', 'al***th@gmail.com'), false);
  const maskedWinner = rankCandidates([maskedA, maskedB], {
    siteId: 'generic',
    origin: 'https://example.com',
    siteContext: { maskedEmail: 'al***th@gmail.com' },
    now
  });
  assert.equal(maskedWinner.status, 'found');
  assert.equal(maskedWinner.candidate.code, '111222');

  const subjectBrandOnly = {
    id: 'subj-1',
    from: 'noreply@mailer-relay.net',
    subject: 'Your AcmePortal login code',
    body: 'Verification code: 839201',
    timestamp: now - 2000
  };
  const subjMatch = rankCandidates([subjectBrandOnly], { siteId: 'generic', origin: 'https://app.acmeportal.com', now });
  assert.equal(subjMatch.status, 'found');
  assert.equal(subjMatch.candidate.code, '839201');
  assert.equal(subjMatch.candidate.requiresReview, true);
  assert.equal(rankCandidates([subjectBrandOnly], { siteId: 'generic', origin: 'https://acmeportal.com.evil.test', now }).status, 'none');
});
