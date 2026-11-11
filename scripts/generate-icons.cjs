// Generates public/icon-192.png and public/icon-512.png from the LeadFlow
// brand (indigo tile + white bars + green check badge). Pure Node, no deps:
// raw RGBA -> zlib -> minimal PNG encoder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INDIGO = [79, 70, 229, 255];
const WHITE = [255, 255, 255, 255];
const GREEN = [34, 197, 94, 255];

function makeCanvas(size) {
  return { size, px: Buffer.alloc(size * size * 4) };
}

function setPx(cv, x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= cv.size || y >= cv.size) return;
  const i = (y * cv.size + x) * 4;
  cv.px[i] = color[0];
  cv.px[i + 1] = color[1];
  cv.px[i + 2] = color[2];
  cv.px[i + 3] = color[3];
}

function fillRect(cv, x0, y0, w, h, color) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      setPx(cv, x, y, color);
    }
  }
}

function fillCircle(cv, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPx(cv, x, y, color);
    }
  }
}

// Thick line segment with round caps (stamped circles along the segment).
function thickLine(cv, x0, y0, x1, y1, width, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len));
  const r = width / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(cv, x0 + dx * t, y0 + dy * t, r, color);
  }
}

// Same artwork as public/icon.svg, scaled from a 128-unit viewBox.
function drawIcon(size) {
  const cv = makeCanvas(size);
  const s = size / 128; // scale factor
  fillRect(cv, 0, 0, size, size, INDIGO);
  // White bars
  fillRect(cv, 36 * s, 42 * s, 56 * s, 10 * s, WHITE);
  fillRect(cv, 36 * s, 62 * s, 40 * s, 10 * s, WHITE);
  fillRect(cv, 36 * s, 82 * s, 48 * s, 10 * s, WHITE);
  // Green badge + white check
  fillCircle(cv, 92 * s, 82 * s, 16 * s, GREEN);
  thickLine(cv, 86 * s, 82 * s, 90 * s, 86 * s, 3.5 * s, WHITE);
  thickLine(cv, 90 * s, 86 * s, 98 * s, 74 * s, 3.5 * s, WHITE);
  return cv;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(cv) {
  const { size, px } = cv;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type 0 (None)
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

const outDir = path.join(__dirname, '..', 'public');
for (const size of [192, 512]) {
  const png = encodePNG(drawIcon(size));
  const out = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
