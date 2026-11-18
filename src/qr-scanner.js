import jsQR from './vendor/jsqr.js';
import { extractTotpFromScannedText } from './totp.js';

export function decodeQrRgba(rgba, width, height) {
  if (!rgba || !width || !height) return null;
  try {
    const hit = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
    return hit?.data ? hit.data.trim() : null;
  } catch {
    return null;
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('QR_IMAGE_TIMEOUT')), 3000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('QR_IMAGE_LOAD')); };
    img.src = dataUrl;
  });
}

async function detectWithCanvas(ctx, w, h, results) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const direct = decodeQrRgba(imgData.data, w, h);
  if (direct) results.add(direct);
  if (typeof globalThis.BarcodeDetector === 'function') {
    try {
      const bd = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
      const hits = await bd.detect(ctx.canvas);
      for (const hit of hits ?? []) {
        if (hit?.rawValue) results.add(String(hit.rawValue).trim());
      }
    } catch { /* Fallback to jsQR only. */ }
  }
}

export async function decodeQrDataUrl(dataUrl, { paddedSingleElement = false } = {}) {
  const results = new Set();
  if (!dataUrl || typeof document === 'undefined') return [];

  let img;
  try {
    img = await loadImage(dataUrl);
  } catch {
    return [];
  }

  const nw = img.naturalWidth || img.width || 0;
  const nh = img.naturalHeight || img.height || 0;
  if (!nw || !nh) return [];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  if (paddedSingleElement) {
    const pad = 32;
    const scale = Math.min(600 / Math.max(nw, nh), Math.max(1, 300 / Math.min(nw, nh)));
    const dw = Math.max(64, Math.round(nw * scale));
    const dh = Math.max(64, Math.round(nh * scale));
    canvas.width = dw + pad * 2;
    canvas.height = dh + pad * 2;

    for (const bg of ['#ffffff', '#0f172a']) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, pad, pad, dw, dh);
      await detectWithCanvas(ctx, canvas.width, canvas.height, results);
      if (results.size > 0) break;
    }
    return [...results];
  }

  // Pass 1 & 2: Full-viewport scaled scans
  for (const maxDim of [1400, 750]) {
    const scale = Math.min(1, maxDim / Math.max(nw, nh));
    const sw = Math.max(1, Math.round(nw * scale));
    const sh = Math.max(1, Math.round(nh * scale));
    canvas.width = sw;
    canvas.height = sh;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, sw, sh);
    await detectWithCanvas(ctx, sw, sh, results);
    if (results.size > 0) return [...results];
  }

  // Pass 3: Native 1:1 overlapping tiles for crisp HiDPI screenshots
  const cols = 3;
  const rows = 3;
  const stepX = nw / cols;
  const stepY = nh / rows;
  const overlapX = Math.round(stepX * 0.35);
  const overlapY = Math.round(stepY * 0.35);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = Math.max(0, Math.floor(c * stepX - overlapX));
      const sy = Math.max(0, Math.floor(r * stepY - overlapY));
      const sw = Math.min(950, Math.min(nw - sx, Math.ceil(stepX + overlapX * 2)));
      const sh = Math.min(950, Math.min(nh - sy, Math.ceil(stepY + overlapY * 2)));
      if (sw < 48 || sh < 48) continue;
      canvas.width = sw;
      canvas.height = sh;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      await detectWithCanvas(ctx, sw, sh, results);
    }
  }

  return [...results];
}

function classifyDecodedList(rawList, fallbackMeta, nonTotpPreviews) {
  for (const raw of rawList) {
    try {
      const extracted = extractTotpFromScannedText(raw, fallbackMeta);
      if (extracted.kind === 'totp' && extracted.entries?.length) {
        return { found: extracted.entries };
      }
      if (extracted.kind === 'non_totp_qr' && extracted.preview) {
        nonTotpPreviews.push(extracted.preview);
      } else if (extracted.kind === 'unsupported_hotp') {
        nonTotpPreviews.push('HOTP (поддерживается только TOTP)');
      }
    } catch { /* Malformed otpauth URI ignored so other candidates can succeed. */ }
  }
  return { found: null };
}

export async function scanTabForTotp(tab, fallbackMeta = {}) {
  if (!tab?.id) {
    return { status: 'error', message: 'Откройте вкладку с настройкой 2FA.' };
  }

  const nonTotpPreviews = [];

  // Layer 1: Visible viewport capture (works without tab reload, even on SVG/cross-origin/iframes)
  if (typeof chrome?.tabs?.captureVisibleTab === 'function') {
    let shot = null;
    try {
      shot = await chrome.tabs.captureVisibleTab(tab.windowId ?? null, { format: 'png' });
    } catch {
      try { shot = await chrome.tabs.captureVisibleTab({ format: 'png' }); } catch { shot = null; }
    }
    if (shot) {
      const decoded = await decodeQrDataUrl(shot, { paddedSingleElement: false });
      const { found } = classifyDecodedList(decoded, fallbackMeta, nonTotpPreviews);
      if (found) {
        return { status: 'found', entries: found, source: 'screen_qr' };
      }
    }
  }

  // Layer 2: DOM deep scan (links, Base32 text keys, SVG/canvas/img data URLs)
  let domScan = null;
  if (typeof chrome?.tabs?.sendMessage === 'function') {
    try {
      domScan = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE_TOTP' }, { frameId: 0 });
    } catch {
      domScan = null;
    }
  }

  const domReachable = Boolean(domScan);
  if (domScan?.status === 'found' && (domScan.uri || domScan.secret)) {
    const mergedMeta = {
      ...fallbackMeta,
      issuer: domScan.issuer || fallbackMeta.issuer,
      domain: domScan.domain || fallbackMeta.domain
    };
    const { found } = classifyDecodedList([domScan.uri || domScan.secret], mergedMeta, nonTotpPreviews);
    if (found) {
      return { status: 'found', entries: found, source: domScan.source || 'dom' };
    }
  }

  if (Array.isArray(domScan?.visualDataUrls) && domScan.visualDataUrls.length) {
    for (const visualUrl of domScan.visualDataUrls) {
      const decoded = await decodeQrDataUrl(visualUrl, { paddedSingleElement: true });
      const { found } = classifyDecodedList(decoded, fallbackMeta, nonTotpPreviews);
      if (found) {
        return { status: 'found', entries: found, source: 'dom_qr' };
      }
    }
  }

  if (nonTotpPreviews.length > 0) {
    return {
      status: 'error',
      message: `QR-код прочитан (${nonTotpPreviews[0]}), но это обычная ссылка, а не секрет 2FA (otpauth://).`
    };
  }
  if (!domReachable) {
    return {
      status: 'error',
      message: 'На видимой части экрана QR-код 2FA не найден. Обновите вкладку сайта (F5) и попробуйте снова.'
    };
  }
  return {
    status: 'error',
    message: 'На открытой странице не найден QR-код 2FA или текстовый секретный ключ.'
  };
}

export function decodeRawRgbaCrop(rgba, imgWidth, imgHeight, cropRect = null) {
  const results = new Set();
  if (!rgba || imgWidth < 8 || imgHeight < 8) return [];

  let sx = 0;
  let sy = 0;
  let sw = imgWidth;
  let sh = imgHeight;
  if (cropRect && Number(cropRect.width) > 4 && Number(cropRect.height) > 4) {
    const scaleX = imgWidth / (Number(cropRect.viewportWidth) || imgWidth);
    const scaleY = imgHeight / (Number(cropRect.viewportHeight) || imgHeight);
    sx = Math.max(0, Math.floor(Number(cropRect.x) * scaleX) - 8);
    sy = Math.max(0, Math.floor(Number(cropRect.y) * scaleY) - 8);
    sw = Math.min(imgWidth - sx, Math.ceil(Number(cropRect.width) * scaleX) + 16);
    sh = Math.min(imgHeight - sy, Math.ceil(Number(cropRect.height) * scaleY) + 16);
  }
  if (sw < 12 || sh < 12) return [];

  const pad = 24;
  const scales = Math.max(sw, sh) < 280 ? [1, 2] : [1];
  for (const scale of scales) {
    const dw = sw * scale;
    const dh = sh * scale;
    const outW = dw + pad * 2;
    const outH = dh + pad * 2;
    const buf = new Uint8ClampedArray(outW * outH * 4);
    for (const bg of [[255, 255, 255, 255], [15, 23, 42, 255]]) {
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = bg[0];
        buf[i + 1] = bg[1];
        buf[i + 2] = bg[2];
        buf[i + 3] = bg[3];
      }
      for (let y = 0; y < dh; y++) {
        const srcY = sy + Math.floor(y / scale);
        const dstRow = (y + pad) * outW;
        const srcRow = srcY * imgWidth;
        for (let x = 0; x < dw; x++) {
          const srcIdx = (srcRow + sx + Math.floor(x / scale)) * 4;
          const dstIdx = (dstRow + x + pad) * 4;
          buf[dstIdx] = rgba[srcIdx];
          buf[dstIdx + 1] = rgba[srcIdx + 1];
          buf[dstIdx + 2] = rgba[srcIdx + 2];
          buf[dstIdx + 3] = rgba[srcIdx + 3];
        }
      }
      const hit = decodeQrRgba(buf, outW, outH);
      if (hit) results.add(hit);
    }
    if (results.size > 0) break;
  }
  return [...results];
}

export async function decodeCroppedQrDataUrl(dataUrl, cropRect = null) {
  if (!dataUrl) return [];
  try {
    if (typeof document !== 'undefined') {
      const img = await loadImage(dataUrl);
      const nw = img.naturalWidth || img.width || 0;
      const nh = img.naturalHeight || img.height || 0;
      if (!nw || !nh) return [];
      const canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return [];
      ctx.drawImage(img, 0, 0, nw, nh);
      const imgData = ctx.getImageData(0, 0, nw, nh);
      return decodeRawRgbaCrop(imgData.data, nw, nh, cropRect);
    }
    if (typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function') {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);
      const nw = bitmap.width || 0;
      const nh = bitmap.height || 0;
      if (!nw || !nh) { bitmap.close?.(); return []; }
      const canvas = new OffscreenCanvas(nw, nh);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { bitmap.close?.(); return []; }
      ctx.drawImage(bitmap, 0, 0, nw, nh);
      const imgData = ctx.getImageData(0, 0, nw, nh);
      bitmap.close?.();
      const hits = decodeRawRgbaCrop(imgData.data, nw, nh, cropRect);
      if (hits.length) return hits;
      if (typeof globalThis.BarcodeDetector === 'function') {
        const bd = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        const detected = await bd.detect(canvas).catch(() => []);
        return (detected ?? []).map(d => String(d?.rawValue ?? '').trim()).filter(Boolean);
      }
    }
  } catch {
    return [];
  }
  return [];
}

export function classifyQrStringsForTotp(rawList, fallbackMeta = {}) {
  const nonTotpPreviews = [];
  const { found } = classifyDecodedList(Array.isArray(rawList) ? rawList : [], fallbackMeta, nonTotpPreviews);
  if (found?.length) return { status: 'found', entries: found };
  if (nonTotpPreviews.length) {
    return {
      status: 'error',
      message: `QR-код прочитан (${nonTotpPreviews[0]}), но это обычная ссылка, а не секрет 2FA (otpauth://).`
    };
  }
  return {
    status: 'error',
    message: 'В выделенной области QR-код 2FA не найден. Попробуйте выделить чуть шире (с белыми краями).'
  };
}
