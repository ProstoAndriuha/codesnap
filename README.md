# CodeSnap — email verification codes

Chrome Manifest V3 extension: find recent email verification codes and fill OTP fields with one click. Never submits website forms.

Version 0.8.1. No Python, PowerShell or local mail helper required. Chrome Web Store publication remains pending; Gmail availability is subject to Google's OAuth test-user and verification rules.

- Gmail: direct Google OAuth + Gmail API, multiple accounts.
- Yandex: official OAuth sign-in, read-only IMAP through CodeSnap Cloud.
- Yahoo, Mail.ru and custom IMAP: app password through CodeSnap Cloud.
- Generic single and multi-cell OTP recognition, detailed suggestions and explicit click-to-fill.
- Outlook remains postponed.

[Website](https://prostoandriuha.github.io/codesnap/) · [Privacy](https://prostoandriuha.github.io/codesnap/privacy.html) · [Support](https://prostoandriuha.github.io/codesnap/support.html) · [Releases](https://github.com/ProstoAndriuha/codesnap/releases)

## Install/update

Extract CodeSnap-Chrome.zip into a stable folder and load unpacked in chrome://extensions with Developer mode enabled. Updates replace files in that same folder; click Reload. The existing manifest key and Google client IDs are preserved. Store publication will require registering the actual Chrome Web Store extension ID with Google, Yandex and the Cloud service.

## Mail through CodeSnap Cloud

Enable this option in Settings and explicitly confirm server processing before connecting. Select Yandex and click Sign in with Yandex. Yahoo/Mail.ru/custom IMAP use an app password from the provider. No helper ZIP or Python installation.

Gmail tokens and messages go directly to Google. Cloud connection credentials are AES-256-GCM encrypted on the CodeSnap server, isolated by a random per-browser access key. Recent IMAP messages are processed in memory, never stored on disk. Read-only Inbox searches cover the last 15 minutes; oversized messages over 256 KiB are skipped. Custom IMAP accepts only public servers with validated TLS 993 or required STARTTLS 143. Up to 20 Cloud mailboxes per browser; Google/provider limits also apply.

Remove connected Cloud accounts before uninstalling to delete their server credentials. Turning Cloud off pauses access but does not delete credentials. If extension storage is lost, revoke provider authorization/app passwords. Legacy helpers from older versions are unused and are not automatically removed or migrated.

## Development

Node.js 20+: npm ci, npm run lint, npm test, npm run build. npm run release:chrome also replaces the local installed extension folder. It does not install a helper.

Backend source and operating documentation are in cloud-service/. Secrets and production vaults are deliberately excluded. No ads or analytics; no sending, deleting mail or form submission. Recognition is generic, not a guarantee of every website. Do not post real codes, tokens or passwords in issues.
