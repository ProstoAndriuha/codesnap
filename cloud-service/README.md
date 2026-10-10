# CodeSnap Cloud mail bridge

Node.js 20+ service for the CodeSnap extension. Gmail stays direct to Google; this service handles Yandex OAuth (login:email + mail:imap_ro), Yahoo/Mail.ru app passwords and custom public IMAP.

`npm ci --ignore-scripts`, `npm test`, `npm run check`. Production unit and narrow nginx provisioning are in deploy/. Runtime endpoint: https://codesnap.fundingbotsecret.pp.ua/api/mail, health at /api/mail/health.

Secrets must never enter Git: root-only `/etc/codesnap-mail/service.env` holds an independent 256-bit AES key and Yandex client secret. Device-scoped connection records are AES-256-GCM encrypted with owner ID as authenticated data under `/var/lib/codesnap-mail`, mode 0700, dedicated service user. Mail bodies are never written to disk; short memory cache is evicted within six seconds. API access uses a 256-bit per-browser bearer kept in extension local storage. Losing extension storage loses access to these records; revoke mailbox authorization/app password if that happens. Remove each account before uninstalling to delete its server record.

No send/delete/mark-read endpoints. Only EXAMINE INBOX and PEEK reads; last 15 minutes, latest 40 messages, 256 KiB message limit. Large attachment messages are skipped. Max 20 IMAP accounts per device; rate/concurrency/storage caps. Custom IMAP only TLS 993 or mandatory STARTTLS 143; all DNS answers must be public, selected address is pinned, original hostname is certificate-verified. Google tokens and website URLs are never sent here.

OAuth state is short-lived, bound to the device bearer, single use and protected with PKCE. Provider tokens stay in the encrypted server vault and are refreshed server-side. Consent is required before connect. Disabling Cloud pauses access but does not delete records; account removal does. Native helper is legacy and unused in extension 0.8.0.

Operating limits: no external security audit yet; preset providers must be live-tested with an authorized mailbox. Publish-origin allowlist and Yandex redirect must be updated when Chrome Web Store assigns the real store ID. Do not advertise that store authentication already works. Monitor health without collecting mailbox payloads. Keep the AES key through deployments; replacing it makes existing records unreadable.
