const SVG_NS = 'http://www.w3.org/2000/svg';

function pieSectorPath(cx, cy, r, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return '';
  if (f >= 0.999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const angle = f * 2 * Math.PI;
  const x = cx + r * Math.sin(angle);
  const y = cy - r * Math.cos(angle);
  const largeArc = angle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

function createPieSvg(remaining, period) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'auth-pie');
  svg.setAttribute('aria-label', `${remaining}s`);

  const bg = document.createElementNS(SVG_NS, 'circle');
  bg.setAttribute('cx', '12');
  bg.setAttribute('cy', '12');
  bg.setAttribute('r', '10');
  bg.setAttribute('fill', '#e5eaf4');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pieSectorPath(12, 12, 10, remaining / (period || 30)));
  path.setAttribute('fill', remaining <= 5 ? '#d93848' : '#7a879e');

  svg.append(bg, path);
  return svg;
}

function formatCodeDisplay(code) {
  const s = String(code ?? '');
  if (s.length === 6) return `${s.slice(0, 3)} ${s.slice(3)}`;
  if (s.length === 8) return `${s.slice(0, 4)} ${s.slice(4)}`;
  return s;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
    reader.readAsDataURL(file);
  });
}

function triggerDownload(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function mountAuthenticatorView(container, options = {}) {
  let activeTab = options.tab ?? null;
  let activeOrigin = options.origin ?? '';
  let siteContext = options.siteContext ?? {};
  let has2faField = Boolean(options.has2faField);
  let items = [];
  let searchQuery = '';
  let drawerMode = options.initialDrawer ?? null; // 'import' | 'add' | 'pin' | null
  let editMode = false;
  let editingId = null;
  let pinProtected = false;
  let vaultLocked = false;
  let proStatus = { isPro: false, status: 'free', freeTotpLimit: 5 };
  let clockState = { offsetSeconds: 0, detectedSkewSeconds: null, detectedSkewAt: null, uncompensatedSkewSeconds: 0 };
  let activeQrId = null;
  let activeQrUri = '';
  let qrAutoHideTimer = null;
  let qrSvgFactory = null;
  let lastCounterKey = '';
  let statusMsg = '';
  let statusTone = 'info';
  let phishingAlert = { suspicious: false };
  let ticker = null;

  container.replaceChildren();

  const root = document.createElement('div');
  root.className = 'auth-shell';

  // Top bar (mirrors Authenticator screenshot toolbar)
  const bar = document.createElement('div');
  bar.className = 'auth-bar';

  const leftBtns = document.createElement('div');
  leftBtns.className = 'auth-bar-group';
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'auth-icon-btn';
  importBtn.title = 'Импорт / Экспорт 2FA (Authenticator, 2FAS, Aegis, Bitwarden, TXT/JSON)';
  importBtn.textContent = '⚙ Импорт';
  importBtn.setAttribute('aria-label', 'Импорт и экспорт 2FA');

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'auth-icon-btn';
  pinBtn.title = 'PIN / Заблокировать 2FA';
  pinBtn.textContent = '🔒';

  const clockBtn = document.createElement('button');
  clockBtn.type = 'button';
  clockBtn.className = 'auth-icon-btn';
  clockBtn.title = 'Точное время и автопоправка сдвига 2FA';
  clockBtn.textContent = '⏱';

  const proBtn = document.createElement('button');
  proBtn.type = 'button';
  proBtn.className = 'auth-icon-btn';
  proBtn.title = 'Лицензия CodeSnap Pro (CS1-…)';
  proBtn.textContent = '✦';

  leftBtns.append(importBtn, pinBtn, clockBtn, proBtn);

  const title = document.createElement('h2');
  title.className = 'auth-bar-title';
  title.textContent = 'Аутентификатор';

  const rightBtns = document.createElement('div');
  rightBtns.className = 'auth-bar-group';

  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'auth-icon-btn';
  scanBtn.title = 'Сканировать QR-код со страницы';
  scanBtn.textContent = '📷';

  const sniperBtn = document.createElement('button');
  sniperBtn.type = 'button';
  sniperBtn.className = 'auth-icon-btn';
  sniperBtn.title = 'Выделить QR-код областью на экране';
  sniperBtn.textContent = '🎯';

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'auth-icon-btn';
  pickBtn.title = 'Указать 2FA-поле на сайте вручную';
  pickBtn.textContent = '📍';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'auth-icon-btn';
  addBtn.title = 'Добавить ключ вручную';
  addBtn.textContent = '＋';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'auth-icon-btn';
  editBtn.title = 'Редактировать или удалить записи';
  editBtn.textContent = '✏';

  rightBtns.append(scanBtn, sniperBtn, pickBtn, addBtn, editBtn);
  bar.append(title, leftBtns, rightBtns);

  // Search box
  const searchWrap = document.createElement('div');
  searchWrap.className = 'auth-search-wrap';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'auth-search';
  searchInput.placeholder = 'Поиск (сайт, почта)…';
  searchInput.setAttribute('aria-label', 'Поиск 2FA кодов');
  const slashBadge = document.createElement('kbd');
  slashBadge.className = 'auth-slash';
  slashBadge.textContent = '/';
  searchWrap.append(searchInput, slashBadge);

  // Status banner
  const statusEl = document.createElement('p');
  statusEl.className = 'totp-status';
  statusEl.hidden = true;

  // Phishing alert banner + Clock skew banner + Collapsible drawer
  const phishBanner = document.createElement('div');
  phishBanner.className = 'phishing-banner';
  phishBanner.hidden = true;

  const clockBanner = document.createElement('div');
  clockBanner.className = 'clock-skew-banner';
  clockBanner.hidden = true;

  const drawer = document.createElement('div');
  drawer.className = 'auth-drawer';
  drawer.hidden = true;

  // Card list
  const listEl = document.createElement('div');
  listEl.className = 'auth-list';

  root.append(bar, searchWrap, statusEl, phishBanner, clockBanner, drawer, listEl);
  container.append(root);

  function setStatus(msg, tone = 'info') {
    statusMsg = msg;
    statusTone = tone;
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.className = tone === 'ok' ? 'totp-status ok' : tone === 'err' ? 'totp-status err' : 'totp-status';
  }

  async function sendTotpAction(payload) {
    const res = await chrome.runtime.sendMessage({ type: 'TOTP_ACTION', payload });
    if (res?.status && res.status !== 'ok') {
      if (res.status === 'pro_required') {
        drawerMode = 'pro';
        renderDrawer();
      }
      throw new Error(res.message ?? 'Ошибка 2FA.');
    }
    return res;
  }

  function renderDrawer() {
    drawer.replaceChildren();
    if (vaultLocked) {
      drawer.hidden = false;
      const form = document.createElement('form');
      form.className = 'auth-form';
      const label = document.createElement('p');
      label.className = 'subtle';
      label.textContent = '🔒 Хранилище 2FA защищено PIN-кодом.';
      const pinIn = document.createElement('input');
      pinIn.type = 'password';
      pinIn.placeholder = 'Введите PIN / мастер-пароль';
      const sub = document.createElement('button');
      sub.type = 'submit';
      sub.className = 'secondary full-btn';
      sub.textContent = 'Разблокировать';
      form.append(label, pinIn, sub);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await sendTotpAction({ command: 'unlock', passphrase: pinIn.value });
          setStatus('');
          await refreshList();
        } catch (err) {
          setStatus(err.message, 'err');
        }
      });
      drawer.append(form);
      return;
    }

    if (!drawerMode) {
      drawer.hidden = true;
      return;
    }

    drawer.hidden = false;
    if (drawerMode === 'import') {
      const box = document.createElement('div');
      box.className = 'auth-form';

      const heading = document.createElement('strong');
      heading.className = 'auth-drawer-title';
      heading.textContent = 'Импорт / Экспорт 2FA кодов';

      const desc = document.createElement('p');
      desc.className = 'subtle';
      desc.textContent = 'Поддерживаются бэкапы Authenticator (.txt otpauth:// и .json), 2FAS (.2fas), Aegis, Bitwarden, CSV, otpauth-migration:// и QR-картинки.';

      const fileLabel = document.createElement('label');
      fileLabel.className = 'secondary auth-file-btn';
      fileLabel.textContent = '📂 Выбрать файл (.txt, .json, .2fas, QR PNG/SVG)';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.txt,.json,.2fas,.csv,.png,.jpg,.jpeg,.webp,.svg,image/*';
      fileInput.hidden = true;
      fileLabel.append(fileInput);

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          let rawText;
          if (file.type.startsWith('image/') || /\.(?:png|jpe?g|webp|svg)$/i.test(file.name)) {
            setStatus('🔍 Декодируем QR-код из изображения…', 'info');
            const dataUrl = await readFileAsDataUrl(file);
            const { decodeQrDataUrl } = await import('./qr-scanner.js');
            const decoded = await decodeQrDataUrl(dataUrl, { paddedSingleElement: true });
            if (!decoded.length) throw new Error('На изображении не распознан QR-код.');
            rawText = decoded.join('\n');
          } else {
            rawText = await file.text();
          }
          const res = await sendTotpAction({ command: 'import', text: rawText });
          drawerMode = null;
          setStatus(`✓ Импортировано: +${res.imported} (обновлено: ${res.updated}, всего: ${res.total})`, 'ok');
          await refreshList();
        } catch (err) {
          setStatus(err.message, 'err');
        } finally {
          fileInput.value = '';
        }
      });

      const pasteArea = document.createElement('textarea');
      pasteArea.className = 'auth-textarea';
      pasteArea.rows = 3;
      pasteArea.placeholder = 'Или вставьте сюда строки otpauth://totp/... , JSON или Base32 ключи…';

      const importTextBtn = document.createElement('button');
      importTextBtn.type = 'button';
      importTextBtn.className = 'secondary full-btn';
      importTextBtn.textContent = 'Импортировать из текста';
      importTextBtn.addEventListener('click', async () => {
        const text = pasteArea.value.trim();
        if (!text) { setStatus('Выберите файл или вставьте текст для импорта.', 'err'); return; }
        try {
          const res = await sendTotpAction({ command: 'import', text });
          pasteArea.value = '';
          drawerMode = null;
          setStatus(`✓ Импортировано: +${res.imported} (обновлено: ${res.updated}, всего: ${res.total})`, 'ok');
          await refreshList();
        } catch (err) {
          setStatus(err.message, 'err');
        }
      });

      const exportRow = document.createElement('div');
      exportRow.className = 'auth-export-row';
      const expTxt = document.createElement('button');
      expTxt.type = 'button';
      expTxt.className = 'text-button';
      expTxt.textContent = '⬇ Экспорт .txt (otpauth)';
      expTxt.addEventListener('click', async () => {
        try {
          const res = await sendTotpAction({ command: 'export', format: 'txt' });
          triggerDownload('codesnap-2fa-backup.txt', res.data);
          setStatus('✓ Бэкап .txt скачан локально.', 'ok');
        } catch (err) { setStatus(err.message, 'err'); }
      });

      const expJson = document.createElement('button');
      expJson.type = 'button';
      expJson.className = 'text-button';
      expJson.textContent = '⬇ Экспорт .json';
      expJson.addEventListener('click', async () => {
        try {
          const res = await sendTotpAction({ command: 'export', format: 'json' });
          triggerDownload('codesnap-2fa-backup.json', res.data, 'application/json;charset=utf-8');
          setStatus('✓ Бэкап .json скачан локально.', 'ok');
        } catch (err) { setStatus(err.message, 'err'); }
      });

      exportRow.append(expTxt, expJson);
      box.append(heading, desc, fileLabel, pasteArea, importTextBtn, exportRow);
      drawer.append(box);
      return;
    }

    if (drawerMode === 'add') {
      const form = document.createElement('form');
      form.className = 'auth-form';
      const secretIn = document.createElement('input');
      secretIn.type = 'password';
      secretIn.autocomplete = 'off';
      secretIn.placeholder = 'Секретный ключ Base32 или otpauth://totp/...';
      const issuerIn = document.createElement('input');
      issuerIn.placeholder = 'Сервис (например: OKX, GitHub)';
      if (activeOrigin.startsWith('https://')) {
        try { issuerIn.value = new URL(activeOrigin).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
      }
      const acctIn = document.createElement('input');
      acctIn.placeholder = 'Аккаунт / почта (необязательно)';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'submit';
      saveBtn.className = 'secondary full-btn';
      saveBtn.textContent = 'Сохранить ключ локально';
      form.append(secretIn, issuerIn, acctIn, saveBtn);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const res = await sendTotpAction({
            command: 'add',
            input: secretIn.value.trim(),
            meta: {
              issuer: issuerIn.value.trim() || undefined,
              account: acctIn.value.trim() || undefined,
              domain: activeOrigin.startsWith('https://') ? new URL(activeOrigin).hostname : ''
            }
          });
          drawerMode = null;
          setStatus(`✓ Добавлено (${res.account?.issuer}): ${res.code}`, 'ok');
          await refreshList();
        } catch (err) {
          setStatus(err.message, 'err');
        }
      });
      drawer.append(form);
      return;
    }

    if (drawerMode === 'pro') {
      const box = document.createElement('div');
      box.className = 'auth-form';
      const heading = document.createElement('strong');
      heading.className = 'auth-drawer-title';
      heading.textContent = proStatus?.isPro ? '✦ CodeSnap Pro активен' : 'Лицензия CodeSnap Pro';
      const desc = document.createElement('p');
      desc.className = 'subtle';
      desc.textContent = proStatus?.isPro
        ? `Ключ ${proStatus.keyId || 'PRO'} (${proStatus.lifetime ? 'Навсегда' : 'активен'}). Доступен безлимит 2FA (>5), прямой Gmail OAuth и Withdraw Check.`
        : `В бесплатной версии доступно до ${proStatus?.freeTotpLimit ?? 5} ключей 2FA. Введите ключ CS1-… для безлимита и массового импорта.`;
      box.append(heading, desc);
      if (proStatus?.isPro) {
        const offBtn = document.createElement('button');
        offBtn.type = 'button';
        offBtn.className = 'text-button';
        offBtn.textContent = 'Отключить / сменить ключ Pro';
        offBtn.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({ type: 'LICENSE_ACTION', payload: { command: 'deactivate' } }).catch(() => {});
          setStatus('Ключ Pro отключён.', 'info');
          await refreshList();
        });
        box.append(offBtn);
      } else {
        const form = document.createElement('form');
        form.className = 'auth-form';
        const keyIn = document.createElement('input');
        keyIn.autocomplete = 'off';
        keyIn.spellcheck = false;
        keyIn.placeholder = 'Вставьте ключ CS1-…';
        const actBtn = document.createElement('button');
        actBtn.type = 'submit';
        actBtn.className = 'secondary full-btn';
        actBtn.textContent = 'Активировать Pro';
        form.append(keyIn, actBtn);
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const res = await chrome.runtime.sendMessage({ type: 'LICENSE_ACTION', payload: { command: 'activate', key: keyIn.value.trim() } }).catch(() => null);
          if (res?.status === 'ok') {
            drawerMode = null;
            setStatus(`✓ CodeSnap Pro активирован (${res.keyId})!`, 'ok');
            await refreshList();
          } else {
            setStatus(res?.message ?? 'Недействительный ключ Pro.', 'err');
          }
        });
        box.append(form);
      }
      drawer.append(box);
      return;
    }

    if (drawerMode === 'clock') {
      const box = document.createElement('div');
      box.className = 'auth-form';

      const heading = document.createElement('strong');
      heading.className = 'auth-drawer-title';
      heading.textContent = 'Точное время 2FA (сдвиг часов)';

      const off = Number(clockState?.offsetSeconds) || 0;
      const detected = clockState?.detectedSkewSeconds;
      const info = document.createElement('p');
      info.className = 'subtle';
      info.textContent = `Текущая поправка: ${off >= 0 ? `+${off}` : off}с.` +
        (detected !== null && detected !== undefined
          ? ` Последняя проверка сервера: часы ПК ${detected > 0 ? `отстают на ${detected}с` : detected < 0 ? `спешат на ${Math.abs(detected)}с` : 'идут точно'}.`
          : ' Если коды 2FA не подходят на сайте, проверьте синхронизацию часов Windows.');

      const syncBtn = document.createElement('button');
      syncBtn.type = 'button';
      syncBtn.className = 'secondary full-btn';
      syncBtn.textContent = '🔄 Проверить точное время и синхронизировать';
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        try {
          const res = await sendTotpAction({ command: 'check_clock_skew', autoApply: true });
          const nextOff = Number(res.offsetSeconds) || 0;
          setStatus(
            nextOff === 0
              ? '✓ Часы ПК идут точно (поправка 0с).'
              : `✓ Поправка времени применена: ${nextOff > 0 ? `+${nextOff}` : nextOff}с`,
            'ok'
          );
          await refreshList();
        } catch (err) {
          setStatus(err.message, 'err');
        } finally {
          syncBtn.disabled = false;
        }
      });

      const manualRow = document.createElement('div');
      manualRow.className = 'auth-clock-manual';
      const offIn = document.createElement('input');
      offIn.type = 'number';
      offIn.min = '-86400';
      offIn.max = '86400';
      offIn.value = String(off);
      offIn.placeholder = 'Сдвиг (сек)';
      const saveOffBtn = document.createElement('button');
      saveOffBtn.type = 'button';
      saveOffBtn.className = 'secondary';
      saveOffBtn.textContent = 'Применить';
      saveOffBtn.addEventListener('click', async () => {
        try {
          await sendTotpAction({ command: 'set_time_offset', offsetSeconds: Number(offIn.value) || 0 });
          setStatus(`✓ Поправка времени: ${Number(offIn.value) || 0}с`, 'ok');
          await refreshList();
        } catch (err) {
          setStatus(err.message, 'err');
        }
      });
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'text-button';
      resetBtn.textContent = 'Сброс (0с)';
      resetBtn.addEventListener('click', async () => {
        await sendTotpAction({ command: 'set_time_offset', offsetSeconds: 0 });
        setStatus('Поправка времени сброшена на 0с.', 'ok');
        await refreshList();
      });

      manualRow.append(offIn, saveOffBtn, resetBtn);
      box.append(heading, info, syncBtn, manualRow);
      drawer.append(box);
      return;
    }

    if (drawerMode === 'pin') {
      const box = document.createElement('div');
      box.className = 'auth-form';
      const pinIn = document.createElement('input');
      pinIn.type = 'password';
      pinIn.placeholder = 'Новый PIN (оставьте пустым чтобы снять)';
      const row = document.createElement('div');
      row.className = 'auth-export-row';
      const savePinBtn = document.createElement('button');
      savePinBtn.type = 'button';
      savePinBtn.className = 'secondary';
      savePinBtn.textContent = 'Сохранить PIN';
      savePinBtn.addEventListener('click', async () => {
        try {
          const res = await sendTotpAction({ command: 'set_pin', newPassphrase: pinIn.value });
          drawerMode = null;
          setStatus(res.pinProtected ? '✓ PIN-защита включена.' : 'PIN-защита снята.', 'ok');
          await refreshList();
        } catch (err) { setStatus(err.message, 'err'); }
      });
      row.append(savePinBtn);
      if (pinProtected) {
        const lockNow = document.createElement('button');
        lockNow.type = 'button';
        lockNow.className = 'text-button';
        lockNow.textContent = 'Заблокировать сейчас';
        lockNow.addEventListener('click', async () => {
          await sendTotpAction({ command: 'lock' });
          drawerMode = null;
          await refreshList();
        });
        row.append(lockNow);
      }
      box.append(pinIn, row);
      drawer.append(box);
    }
  }

  async function handleCardClick(item) {
    if (editMode) return;
    if (phishingAlert?.suspicious) {
      setStatus(`⚠️ Вставка заблокирована: ${phishingAlert.hostname} похож на фишинговый клон ${phishingAlert.targetDomain}.`, 'err');
      return;
    }
    const offsetSec = Number(clockState?.offsetSeconds) || 0;
    const epochNowSec = Math.floor(Date.now() / 1000) + offsetSec;
    const remSec = (item.period || 30) - (((epochNowSec % (item.period || 30)) + (item.period || 30)) % (item.period || 30));
    if (activeTab?.id && (item.isCurrentSite || has2faField) && activeOrigin.startsWith('https://')) {
      try {
        if (remSec <= 3) setStatus('⏳ Осталось ≤3с — ждём свежий 30-сек код…', 'info');
        const res = await sendTotpAction({ command: 'insert_totp', tabId: activeTab.id, origin: activeOrigin, id: item.id });
        if (res?.status === 'inserted') {
          setStatus(res.waitedForNextWindow ? `✓ Свежий код ${item.issuer} вставлен в поле на сайте` : `✓ Код ${item.issuer} вставлен в поле на сайте`, 'ok');
          if (!item.isCurrentSite) {
            const host = new URL(activeOrigin).hostname.replace(/^www\./, '');
            const bindBtn = document.createElement('button');
            bindBtn.type = 'button';
            bindBtn.className = 'text-button';
            bindBtn.style.marginLeft = '6px';
            bindBtn.textContent = `Привязать к ${host}`;
            bindBtn.addEventListener('click', async () => {
              await sendTotpAction({ command: 'update', id: item.id, patch: { domain: host } });
              await refreshList();
              setStatus(`✓ Ключ «${item.issuer}» привязан к ${host}`, 'ok');
            });
            statusEl.append(' ', bindBtn);
          }
          return;
        }
      } catch { /* Fallback to clipboard copy cleanly. */ }
    }
    let codeToCopy = item.code;
    if (remSec <= 3) {
      setStatus('⏳ Осталось ≤3с — ждём свежий 30-сек код…', 'info');
      const fresh = await sendTotpAction({ command: 'fresh_code_by_id', id: item.id }).catch(() => null);
      if (fresh?.code) codeToCopy = fresh.code;
    }
    try {
      await navigator.clipboard.writeText(codeToCopy);
      chrome.runtime.sendMessage({ type: 'CLIPBOARD_COPIED' }).catch(() => {});
      setStatus(`✓ Код ${formatCodeDisplay(codeToCopy)} (${item.issuer}) скопирован (очистится через 45 сек)`, 'ok');
    } catch {
      const res = await chrome.runtime.sendMessage({ type: 'COPY_CLIPBOARD', text: codeToCopy }).catch(() => null);
      if (res?.status === 'copied') {
        setStatus(`✓ Код ${formatCodeDisplay(codeToCopy)} скопирован`, 'ok');
      } else {
        setStatus('Не удалось скопировать код.', 'err');
      }
    }
  }

  function hideQrPreview() {
    clearTimeout(qrAutoHideTimer);
    qrAutoHideTimer = null;
    activeQrId = null;
    activeQrUri = '';
  }

  async function openQrTransfer(id) {
    if (!id) return;
    if (activeQrId === id) {
      hideQrPreview();
      renderList();
      return;
    }
    try {
      const res = await sendTotpAction({ command: 'export_uri', id });
      const { createQrSvgElement } = await import('./qr-generator.js');
      qrSvgFactory = createQrSvgElement;
      activeQrId = id;
      activeQrUri = res.uri;
      clearTimeout(qrAutoHideTimer);
      qrAutoHideTimer = setTimeout(() => {
        hideQrPreview();
        if (root.isConnected) renderList();
      }, 60_000);
      qrAutoHideTimer?.unref?.();
      renderList();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  }

  function renderList() {
    listEl.replaceChildren();
    if (vaultLocked) return;

    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? items.filter(it => `${it.issuer} ${it.account} ${it.accountEmail ?? ''} ${it.domain}`.toLowerCase().includes(q))
      : items;

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'auth-empty';
      empty.textContent = items.length
        ? 'Ничего не найдено по вашему запросу.'
        : 'Пока нет 2FA-кодов. Нажмите «⚙ Импорт» чтобы загрузить бэкап, «📷» для скана QR или «＋» чтобы добавить вручную.';
      listEl.append(empty);
      return;
    }

    const epochSec = Math.floor(Date.now() / 1000) + (Number(clockState?.offsetSeconds) || 0);
    for (const item of filtered) {
      const period = item.period || 30;
      const rem = period - (((epochSec % period) + period) % period);

      const card = document.createElement('div');
      card.className = `auth-tile${item.isCurrentSite ? ' current-site' : ''}`;
      if (!editMode) {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', () => void handleCardClick(item));
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handleCardClick(item); }
        });
      }

      const topRow = document.createElement('div');
      topRow.className = 'auth-tile-top';
      const issuerSpan = document.createElement('span');
      issuerSpan.className = 'auth-tile-issuer';
      issuerSpan.textContent = item.issuer;
      topRow.append(issuerSpan);

      if (item.accountMatchScore >= 10) {
        const badge = document.createElement('span');
        badge.className = 'auth-match-pill exact';
        badge.textContent = '★ ПОЧТА СОВПАЛА';
        topRow.append(badge);
      } else if (item.isCurrentSite) {
        const badge = document.createElement('span');
        badge.className = 'auth-match-pill';
        badge.textContent = 'ТЕКУЩИЙ САЙТ';
        topRow.append(badge);
      }

      if (editMode) {
        const controls = document.createElement('div');
        controls.className = 'auth-tile-controls';
        const editItemBtn = document.createElement('button');
        editItemBtn.type = 'button';
        editItemBtn.className = 'text-button';
        editItemBtn.textContent = editingId === item.id ? 'Отмена' : 'Изм.';
        editItemBtn.addEventListener('click', e => {
          e.stopPropagation();
          editingId = editingId === item.id ? null : item.id;
          renderList();
        });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'text-button danger';
        delBtn.textContent = 'Удалить';
        delBtn.addEventListener('click', async e => {
          e.stopPropagation();
          await sendTotpAction({ command: 'remove', id: item.id });
          await refreshList();
        });
        controls.append(editItemBtn, delBtn);
        topRow.append(controls);
      }

      const codeRow = document.createElement('div');
      codeRow.className = 'auth-tile-code';
      codeRow.textContent = formatCodeDisplay(item.code);

      const bottomRow = document.createElement('div');
      bottomRow.className = 'auth-tile-bottom';
      const acctSpan = document.createElement('span');
      acctSpan.className = 'auth-tile-account';
      acctSpan.textContent = item.account || item.domain || '—';

      const pieWrap = document.createElement('span');
      pieWrap.className = 'auth-pie-wrap';
      pieWrap.setAttribute('data-pie-id', item.id);
      pieWrap.append(createPieSvg(rem, period));

      const qrBtn = document.createElement('button');
      qrBtn.type = 'button';
      qrBtn.className = `auth-qr-btn${activeQrId === item.id ? ' active' : ''}`;
      qrBtn.title = 'Перенести на телефон (QR-код)';
      qrBtn.setAttribute('aria-label', `Показать QR-код для ${item.issuer}`);
      qrBtn.textContent = '📱';
      qrBtn.addEventListener('click', e => {
        e.stopPropagation();
        void openQrTransfer(item.id);
      });

      const rightRow = document.createElement('span');
      rightRow.className = 'auth-tile-right';
      rightRow.append(qrBtn, pieWrap);
      bottomRow.append(acctSpan, rightRow);

      card.append(topRow, codeRow, bottomRow);

      if (activeQrId === item.id && activeQrUri && qrSvgFactory) {
        const qrBox = document.createElement('div');
        qrBox.className = 'auth-qr-box';
        qrBox.addEventListener('click', e => e.stopPropagation());
        const svgEl = qrSvgFactory(document, activeQrUri, { className: 'auth-qr-svg' });
        const qrHint = document.createElement('p');
        qrHint.className = 'auth-qr-hint';
        qrHint.textContent = 'Отсканируйте камерой Google Authenticator / 2FAS на телефоне. Не показывайте экран посторонним.';
        const closeQrBtn = document.createElement('button');
        closeQrBtn.type = 'button';
        closeQrBtn.className = 'text-button';
        closeQrBtn.textContent = 'Скрыть QR';
        closeQrBtn.addEventListener('click', e => {
          e.stopPropagation();
          hideQrPreview();
          renderList();
        });
        qrBox.append(svgEl, qrHint, closeQrBtn);
        card.append(qrBox);
      }

      if (editMode && editingId === item.id) {
        const inlineEdit = document.createElement('form');
        inlineEdit.className = 'auth-inline-edit';
        const issIn = document.createElement('input');
        issIn.value = item.issuer;
        issIn.placeholder = 'Сервис';
        const accIn = document.createElement('input');
        accIn.value = item.account ?? '';
        accIn.placeholder = 'Аккаунт / почта';
        const domIn = document.createElement('input');
        domIn.value = item.domain ?? '';
        domIn.placeholder = 'Домен сайта (например okx.com)';
        const okBtn = document.createElement('button');
        okBtn.type = 'submit';
        okBtn.className = 'secondary';
        okBtn.textContent = 'Сохранить';
        inlineEdit.append(issIn, accIn, domIn, okBtn);
        inlineEdit.addEventListener('submit', async e => {
          e.preventDefault();
          await sendTotpAction({
            command: 'update',
            id: item.id,
            patch: { issuer: issIn.value, account: accIn.value, domain: domIn.value }
          });
          editingId = null;
          await refreshList();
        });
        card.append(inlineEdit);
      }

      listEl.append(card);
    }
  }

  function renderPhishingBanner() {
    phishBanner.replaceChildren();
    if (!phishingAlert?.suspicious) {
      phishBanner.hidden = true;
      return;
    }
    phishBanner.hidden = false;
    const msg = document.createElement('span');
    msg.textContent = `⚠️ Внимание: ${phishingAlert.hostname} похож на фишинговый клон ${phishingAlert.targetDomain}. Вставка заблокирована.`;
    const trust = document.createElement('button');
    trust.type = 'button';
    trust.className = 'text-button danger';
    trust.textContent = 'Доверять этому сайту';
    trust.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'TRUST_PHISHING_ORIGIN', origin: activeOrigin }).catch(() => {});
      await refreshList();
    });
    phishBanner.append(msg, trust);
  }

  function renderClockBanner() {
    clockBanner.replaceChildren();
    const uncomp = Number(clockState?.uncompensatedSkewSeconds) || 0;
    if (Math.abs(uncomp) < 20) {
      clockBanner.hidden = true;
      return;
    }
    clockBanner.hidden = false;
    const msg = document.createElement('span');
    msg.textContent = uncomp > 0
      ? `⏱ Часы ПК отстают на ${uncomp}с — коды 2FA могут не подходить.`
      : `⏱ Часы ПК спешат на ${Math.abs(uncomp)}с — коды 2FA могут не подходить.`;
    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'text-button';
    const targetOffset = clockState.detectedSkewSeconds ?? uncomp;
    fixBtn.textContent = `Синхронизировать (${targetOffset >= 0 ? `+${targetOffset}` : targetOffset}с)`;
    fixBtn.addEventListener('click', async () => {
      await sendTotpAction({ command: 'set_time_offset', offsetSeconds: targetOffset });
      setStatus(`✓ Поправка времени 2FA применена: ${targetOffset >= 0 ? `+${targetOffset}` : targetOffset}с`, 'ok');
      await refreshList();
    });
    clockBanner.append(msg, fixBtn);
  }

  async function refreshList() {
    try {
      const res = await sendTotpAction({
        command: 'list_all',
        tabId: activeTab?.id,
        origin: activeOrigin,
        siteContext
      });
      pinProtected = Boolean(res.pinProtected);
      vaultLocked = Boolean(res.vaultLocked);
      phishingAlert = res.phishingAlert ?? { suspicious: false };
      proStatus = res.proStatus ?? proStatus;
      proBtn.textContent = proStatus?.isPro ? '✦ PRO' : '✦';
      proBtn.classList.toggle('active', drawerMode === 'pro' || Boolean(proStatus?.isPro));
      clockState = res.clockState ?? { offsetSeconds: Number(res.timeOffsetSeconds) || 0, detectedSkewSeconds: null, uncompensatedSkewSeconds: 0 };
      clockBtn.classList.toggle('active', drawerMode === 'clock' || Number(clockState.offsetSeconds) !== 0);
      items = Array.isArray(res.items) ? res.items : [];
      const epochSec = Math.floor(Date.now() / 1000) + (Number(clockState?.offsetSeconds) || 0);
      lastCounterKey = items.map(it => `${it.id}:${Math.floor(epochSec / (it.period || 30))}`).join(',');
      options.onCountChange?.(res.count ?? items.length);
      renderPhishingBanner();
      renderClockBanner();
      renderDrawer();
      renderList();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  }

  importBtn.addEventListener('click', () => {
    drawerMode = drawerMode === 'import' ? null : 'import';
    clockBtn.classList.toggle('active', drawerMode === 'clock' || Number(clockState.offsetSeconds) !== 0);
    renderDrawer();
  });
  addBtn.addEventListener('click', () => {
    drawerMode = drawerMode === 'add' ? null : 'add';
    clockBtn.classList.toggle('active', drawerMode === 'clock' || Number(clockState.offsetSeconds) !== 0);
    renderDrawer();
  });
  pinBtn.addEventListener('click', () => {
    drawerMode = drawerMode === 'pin' ? null : 'pin';
    clockBtn.classList.toggle('active', drawerMode === 'clock' || Number(clockState.offsetSeconds) !== 0);
    renderDrawer();
  });
  clockBtn.addEventListener('click', () => {
    drawerMode = drawerMode === 'clock' ? null : 'clock';
    clockBtn.classList.toggle('active', drawerMode === 'clock' || Number(clockState.offsetSeconds) !== 0);
    renderDrawer();
  });
  proBtn.addEventListener('click', () => {
    drawerMode = drawerMode === 'pro' ? null : 'pro';
    proBtn.classList.toggle('active', drawerMode === 'pro' || Boolean(proStatus?.isPro));
    renderDrawer();
  });
  editBtn.addEventListener('click', () => {
    editMode = !editMode;
    editingId = null;
    editBtn.classList.toggle('active', editMode);
    renderList();
  });
  scanBtn.addEventListener('click', async () => {
    if (!activeTab?.id) { setStatus('Откройте вкладку с QR-кодом 2FA в браузере.', 'err'); return; }
    scanBtn.disabled = true;
    setStatus('🔍 Сканируем QR-код на активной вкладке…', 'info');
    try {
      const { scanTabForTotp } = await import('./qr-scanner.js');
      const scan = await scanTabForTotp(activeTab, {
        domain: activeOrigin.startsWith('https://') ? new URL(activeOrigin).hostname : ''
      });
      if (scan.status === 'found' && scan.entries?.length) {
        const saved = await sendTotpAction({ command: 'add_entries', entries: scan.entries });
        setStatus(`✓ Добавлено 2FA: ${saved.first?.account?.issuer ?? 'OK'}`, 'ok');
        await refreshList();
      } else {
        setStatus(scan.message ?? 'QR-код не найден.', 'err');
      }
    } catch (err) {
      setStatus(err.message, 'err');
    } finally {
      scanBtn.disabled = false;
    }
  });
  sniperBtn.addEventListener('click', async () => {
    if (!activeTab?.id || !activeOrigin.startsWith('https://')) {
      setStatus('Откройте HTTPS-страницу с QR-кодом.', 'err');
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'START_QR_SNIPER', tabId: activeTab.id }).catch(() => null);
    if (res?.status === 'started') window.close?.();
    else setStatus(res?.message ?? 'Обновите страницу (F5) и попробуйте снова.', 'err');
  });
  pickBtn.addEventListener('click', async () => {
    if (!activeTab?.id || !activeOrigin.startsWith('https://')) {
      setStatus('Откройте HTTPS-страницу сайта с полем 2FA.', 'err');
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'START_FIELD_PICKER', tabId: activeTab.id, defaultChannel: 'authenticator' }).catch(() => null);
    if (res?.status === 'started') window.close?.();
    else setStatus(res?.message ?? 'Обновите страницу (F5) и попробуйте снова.', 'err');
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderList();
  });

  const onKeyDown = e => {
    if (!root.isConnected || container.hidden) return;
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'Escape' && document.activeElement === searchInput && searchInput.value) {
      searchInput.value = '';
      searchQuery = '';
      renderList();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  ticker = setInterval(() => {
    if (!root.isConnected || !document.defaultView) { clearInterval(ticker); return; }
    if (vaultLocked || !items.length) return;
    const epochSec = Math.floor(Date.now() / 1000) + (Number(clockState?.offsetSeconds) || 0);
    const key = items.map(it => `${it.id}:${Math.floor(epochSec / (it.period || 30))}`).join(',');
    if (key !== lastCounterKey) {
      void refreshList();
      return;
    }
    for (const item of items) {
      const period = item.period || 30;
      const rem = period - (((epochSec % period) + period) % period);
      const wrap = listEl.querySelector(`[data-pie-id="${item.id}"]`);
      if (wrap) wrap.replaceChildren(createPieSvg(rem, period));
    }
  }, 1000);
  ticker?.unref?.();

  await refreshList();

  return {
    refresh: refreshList,
    openImport() { drawerMode = 'import'; renderDrawer(); },
    openQr(id) { return openQrTransfer(id); },
    setContext(next) {
      activeTab = next.tab ?? activeTab;
      activeOrigin = next.origin ?? activeOrigin;
      siteContext = next.siteContext ?? siteContext;
      if (next.has2faField !== undefined) has2faField = Boolean(next.has2faField);
      return refreshList();
    },
    destroy() {
      clearInterval(ticker);
      clearTimeout(qrAutoHideTimer);
      document.removeEventListener('keydown', onKeyDown);
    }
  };
}
