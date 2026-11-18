# CodeSnap — email verification codes, activation links & local 2FA

Chrome Manifest V3 extension: find recent email verification codes and confirmation/activation links across 12+ mail providers — plus built-in encrypted 2FA TOTP & 1-click Dual Fill — **100% locally in your browser**. Never submits website forms or opens links without your click.

Version 1.1.1. Zero backend servers, zero Python, zero helper ZIPs, zero stored mail passwords.

- **Gmail**: direct Google OAuth + Gmail API (multiple accounts), or open Gmail Web tab.
- **Yandex, Outlook / Hotmail, Yahoo, Mail.ru, Proton Mail, iCloud, Zoho, Rambler, Fastmail, AOL, GMX**: read recent verification codes and activation links locally from open webmail tabs in Chrome with **0 ms instant push** when a new email arrives — without sharing passwords or using any external server.
- **Built-in Local Authenticator (TOTP), Bulk Import/Export & Pop-out Window**: full Authenticator view & standalone window showing all saved 2FA codes with live 30-second pie timers and instant search, offline QR (`jsQR`) scanner, plus 1-click import/export (Authenticator `.txt`/`.json`, `.2fas`, Aegis, Bitwarden, `otpauth-migration://`, CSV, QR PNG/SVG).
- **Smart Multi-Account Matching + 1-Click Dual Fill**: automatically picks the matching 2FA account by typed login email, masked email, or verified OTP mailbox — or shows an account-labeled chooser (`Email + 2FA`) if multiple accounts match the same website.
- **Quick Hotkey, Context Menu, Mute & Smart Learning**: `Alt+Shift+V` shortcut & right-click menu, 45-second clipboard auto-clear, per-site chip muting, and automatic per-site mailbox learning (`learnedAccounts`).
- **Optional direct local APIs**: Fastmail JMAP API token (`https://api.fastmail.com/*`) and Outlook Microsoft Graph PKCE (`https://graph.microsoft.com/*`) directly from your browser.

[Website](https://prostoandriuha.github.io/codesnap/) · [Privacy](https://prostoandriuha.github.io/codesnap/privacy.html) · [Support](https://prostoandriuha.github.io/codesnap/support.html) · [Releases](https://github.com/ProstoAndriuha/codesnap/releases)

## Install / update

Extract `CodeSnap-Chrome.zip` into a stable folder and load unpacked in `chrome://extensions` with Developer mode enabled. Updates replace files in that same folder; click Reload. The existing manifest key and Google client IDs are preserved.

## Shortcuts & Local Features

1. **`Alt+Shift+V` (or Right-click -> CodeSnap)**: find and fill the latest email code or matching 2FA TOTP code on demand (including active inputs or clipboard fallback).
2. **2FA / TOTP Vault**: open the popup, click **+ Add 2FA key** (scan QR/`otpauth://` from the current page or paste Base32), optionally protect with a PIN. Inline 2FA chips appear ONLY on websites that match a saved 2FA entry.
3. **Dual Fill**: when a security screen asks for both Email OTP and 2FA Authenticator, CodeSnap shows a combined fill option (`Email + 2FA`).

## Development

Node.js 20+: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm run browser-smoke`, `npm run build:firefox`. `npm run release:chrome` builds `dist/`, updates `CodeSnap-Chrome`, and writes `CodeSnap-Chrome.zip`.
