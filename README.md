# CodeSnap – email verification codes

Find recent Gmail verification codes and fill OTP fields with one click. CodeSnap is a Chrome Manifest V3 extension. It processes email locally, supports multiple Gmail accounts, and never submits website forms.

**Version 0.7.2. Chrome Web Store publication is pending. Gmail OAuth availability is also subject to Google verification and test-user restrictions.**

- Single-field and multi-cell OTP forms, including controlled fields and many iframe forms.
- Optional detailed suggestions with sender, mailbox, code age and recent matching emails.
- Separate recognition of email, SMS and authenticator fields.
- Yahoo, Yandex, Mail.ru and manual IMAP through a separate Windows helper.
- Outlook is postponed and removed from the connection interface.

[Website](https://prostoandriuha.github.io/codesnap/) · [Privacy](https://prostoandriuha.github.io/codesnap/privacy.html) · [Support](https://prostoandriuha.github.io/codesnap/support.html) · [Releases](https://github.com/ProstoAndriuha/codesnap/releases)

## Install the unpacked Chrome build

Download CodeSnap-Chrome.zip from Releases, extract it to a stable folder, open chrome://extensions, enable Developer mode and select Load unpacked. For subsequent updates replace files in that same folder and click Reload. The manifest key preserves the unpacked extension ID.

Chrome Web Store assigns its own package identity. Google OAuth and the native helper must be configured for the actual store ID before that build can be published as working. Installing a ZIP is not a Chrome Web Store installation.

## Optional IMAP on Windows

Gmail needs no local helper. Yahoo, Yandex, Mail.ru and custom IMAP need Python 3 and CodeSnap-Mail-Setup.zip. Extract that bundle and run scripts/install-mail-helper.ps1 with PowerShell. Use an app password, not your ordinary mailbox password. Details: [MAIL.ru.md](MAIL.ru.md).

The helper uses certificate-validated TLS/STARTTLS, a Windows DPAPI vault, read-only INBOX selection and BODY.PEEK. It neither sends nor deletes messages. Native Messaging origins are allowlisted.

## Development

Node.js 20+ and Python 3 on Windows:

```text
npm ci
npm run lint
npm test
python -m unittest discover -s native -p test_mail_host.py -v
npm run build
```

`npm run release:chrome` also updates the local installed folder and registers the Windows helper. Run it only when you intend those local changes.

## Limits and privacy

Recognition is generic but some custom fields are unsupported. Codes are filled or copied only after a click. Gmail readonly grants wider read access than CodeSnap's bounded recent-message search. Additional Gmail tokens use temporary browser-session storage. IMAP searches only Inbox. No ads, analytics or developer mailbox-processing server.

Do not put real codes, app passwords or access tokens in GitHub issues.
