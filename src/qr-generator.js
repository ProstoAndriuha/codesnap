// 100% local, dependency-free ISO/IEC 18004 QR Code encoder (Model 2, Byte mode, ECC Level L, Versions 1..14)

const EC_CODEWORDS_PER_BLOCK = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30];
const NUM_ERROR_CORRECTION_BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4];
const ALIGN_POS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66]
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function computeRsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function computeRsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

function createTemplate(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (x, y, dark) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    modules[y][x] = Boolean(dark);
    isFunction[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunc(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  if (version >= 2) {
    const pos = ALIGN_POS[version];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) {
          continue;
        }
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFunc(pos[j] + dx, pos[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
  }

  // Reserve format info modules
  for (let i = 0; i <= 5; i++) setFunc(8, i, false);
  setFunc(8, 7, false);
  setFunc(8, 8, false);
  setFunc(7, 8, false);
  for (let i = 9; i < 15; i++) setFunc(14 - i, 8, false);
  for (let i = 0; i < 8; i++) setFunc(size - 1 - i, 8, false);
  for (let i = 8; i < 15; i++) setFunc(8, size - 15 + i, false);
  setFunc(8, size - 8, true);

  // Version info for >= 7
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  let rawDataModules = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x]) rawDataModules++;
    }
  }
  const totalCodewords = Math.floor(rawDataModules / 8);
  const ecCount = EC_CODEWORDS_PER_BLOCK[version] * NUM_ERROR_CORRECTION_BLOCKS[version];
  const dataCapacityCodewords = totalCodewords - ecCount;

  return { size, modules, isFunction, totalCodewords, dataCapacityCodewords };
}

function appendBits(bitBuffer, val, len) {
  for (let i = len - 1; i >= 0; i--) {
    bitBuffer.push((val >>> i) & 1);
  }
}

function buildAllCodewords(dataCodewords, version, totalCodewords) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[version];
  const blockEcLen = EC_CODEWORDS_PER_BLOCK[version];
  const rawCodewords = totalCodewords;
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const shortDataLen = shortBlockLen - blockEcLen;

  const divisor = computeRsDivisor(blockEcLen);
  const blocks = [];
  let offset = 0;

  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortDataLen + (i < numShortBlocks ? 0 : 1);
    const dat = dataCodewords.subarray(offset, offset + datLen);
    offset += datLen;
    const ecc = computeRsRemainder(dat, divisor);
    const combined = new Uint8Array(shortBlockLen + 1);
    combined.set(dat, 0);
    if (i < numShortBlocks) {
      combined.set(ecc, datLen + 1);
    } else {
      combined.set(ecc, datLen);
    }
    blocks.push({ dat, ecc, combined });
  }

  const out = [];
  for (let i = 0; i < shortDataLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i < blocks[j].dat.length) out.push(blocks[j].dat[i]);
    }
  }
  for (let i = 0; i < blockEcLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      out.push(blocks[j].ecc[i]);
    }
  }
  return new Uint8Array(out);
}

function placeCodewords(template, codewords) {
  const { size, modules, isFunction } = template;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIdx < totalBits) {
          modules[y][x] = getBit(codewords[bitIdx >>> 3], 7 - (bitIdx & 7));
          bitIdx++;
        }
      }
    }
  }
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(modules, isFunction, mask) {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && maskCondition(mask, x, y)) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

function drawFormatBits(modules, mask) {
  const size = modules.length;
  // Error correction Level L indicator bits = 01
  const data = (1 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) modules[i][8] = getBit(bits, i);
  modules[7][8] = getBit(bits, 6);
  modules[8][8] = getBit(bits, 7);
  modules[8][7] = getBit(bits, 8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = getBit(bits, i);

  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = getBit(bits, i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = getBit(bits, i);
}

function penaltyScore(modules) {
  const size = modules.length;
  let score = 0;

  // Rule 1: adjacent modules in row/col having same color
  const countRun = getCell => {
    for (let i = 0; i < size; i++) {
      let runColor = false;
      let runLen = 0;
      const hist = [0, 0, 0, 0, 0, 0, 0];
      const pushHist = len => {
        hist.pop();
        hist.unshift(len);
      };
      const hasFinder = () => {
        const n = hist[1];
        return n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n &&
          ((hist[0] >= n * 4 && hist[6] >= n) || (hist[6] >= n * 4 && hist[0] >= n));
      };
      for (let j = 0; j < size; j++) {
        const cell = getCell(i, j);
        if (cell === runColor) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          if (runLen > 0) {
            pushHist(runLen);
            if (!runColor && hasFinder()) score += 40;
          }
          runColor = cell;
          runLen = 1;
        }
      }
      if (runLen > 0) {
        pushHist(runLen);
        if (!runColor && hasFinder()) score += 40;
        pushHist(0);
      }
    }
  };
  countRun((y, x) => modules[y][x]);
  countRun((x, y) => modules[y][x]);

  // Rule 2: 2x2 blocks of same color
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        score += 3;
      }
    }
  }

  // Rule 4: balance of dark/light modules
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
    }
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

export function encodeQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let selectedVersion = -1;
  let template = null;

  for (let ver = 1; ver <= 14; ver++) {
    const t = createTemplate(ver);
    const charCountBits = ver <= 9 ? 8 : 16;
    const neededBits = 4 + charCountBits + bytes.length * 8;
    if (neededBits <= t.dataCapacityCodewords * 8) {
      selectedVersion = ver;
      template = t;
      break;
    }
  }

  if (selectedVersion < 0 || !template) {
    throw new Error('QR_PAYLOAD_TOO_LONG');
  }

  const bits = [];
  appendBits(bits, 0b0100, 4); // Byte mode
  appendBits(bits, bytes.length, selectedVersion <= 9 ? 8 : 16);
  for (const b of bytes) appendBits(bits, b, 8);

  const capBits = template.dataCapacityCodewords * 8;
  appendBits(bits, 0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = new Uint8Array(template.dataCapacityCodewords);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) dataCodewords[i >>> 3] |= 1 << (7 - (i & 7));
  }
  let bytePos = bits.length >>> 3;
  for (let padByte = 0xec; bytePos < template.dataCapacityCodewords; padByte ^= 0xec ^ 0x11) {
    dataCodewords[bytePos++] = padByte;
  }

  const allCodewords = buildAllCodewords(dataCodewords, selectedVersion, template.totalCodewords);
  placeCodewords(template, allCodewords);

  let bestMask = 0;
  let minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(template.modules, template.isFunction, mask);
    drawFormatBits(template.modules, mask);
    const p = penaltyScore(template.modules);
    if (p < minPenalty) {
      minPenalty = p;
      bestMask = mask;
    }
    applyMask(template.modules, template.isFunction, mask);
  }

  applyMask(template.modules, template.isFunction, bestMask);
  drawFormatBits(template.modules, bestMask);

  return {
    version: selectedVersion,
    size: template.size,
    modules: template.modules
  };
}

function buildQrPathData(modules, margin = 4) {
  const size = modules.length;
  const parts = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!modules[y][x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && modules[y][x]) x++;
      parts.push(`M${start + margin},${y + margin}h${x - start}v1h${start - x}z`);
    }
  }
  return parts.join('');
}

export function renderQrSvgString(text, { margin = 4, darkColor = '#111827', lightColor = '#ffffff' } = {}) {
  const { size, modules } = encodeQrMatrix(text);
  const full = size + margin * 2;
  const d = buildQrPathData(modules, margin);
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="${lightColor}"/><path d="${d}" fill="${darkColor}"/></svg>`;
}

export function createQrSvgElement(doc, text, { margin = 4, darkColor = '#111827', lightColor = '#ffffff', className = 'auth-qr-svg' } = {}) {
  const { size, modules } = encodeQrMatrix(text);
  const full = size + margin * 2;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${full} ${full}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR код для переноса 2FA на телефон');

  const bg = doc.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(full));
  bg.setAttribute('height', String(full));
  bg.setAttribute('fill', lightColor);

  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', buildQrPathData(modules, margin));
  path.setAttribute('fill', darkColor);

  svg.append(bg, path);
  return svg;
}
