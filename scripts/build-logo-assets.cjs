// Builds web-ready logo files from the root logo.png brand lockup:
//   public/logo.png     — trimmed artwork, 640px wide (login, sidebar, header)
// Re-run with: node scripts/build-logo-assets.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'logo.png');
const OUT = path.join(ROOT, 'public', 'logo.png');

function decodePNG(buf) {
  let pos = 8;
  const idat = [];
  let W = 0;
  let H = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      W = buf.readUInt32BE(pos + 8);
      H = buf.readUInt32BE(pos + 12);
    }
    if (type === 'IDAT') idat.push(buf.slice(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * 4;
  const img = Buffer.alloc(W * H * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = row[i];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[i] = v;
    }
    out.copy(img, y * stride);
    prev = out;
  }
  return { W, H, img };
}

function alphaAt(d, x, y) {
  return d.img[(y * d.W + x) * 4 + 3];
}

function contentBBox(d) {
  let minX = d.W;
  let minY = d.H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < d.H; y += 2) {
    for (let x = 0; x < d.W; x += 2) {
      if (alphaAt(d, x, y) > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function sampleBilinear(d, sx, sy) {
  const xA = Math.max(0, Math.min(d.W - 2, Math.floor(sx)));
  const yA = Math.max(0, Math.min(d.H - 2, Math.floor(sy)));
  const fx = Math.max(0, Math.min(1, sx - xA));
  const fy = Math.max(0, Math.min(1, sy - yA));
  const px = [];
  for (let k = 0; k < 4; k++) {
    const p00 = d.img[(yA * d.W + xA) * 4 + k];
    const p10 = d.img[(yA * d.W + xA + 1) * 4 + k];
    const p01 = d.img[((yA + 1) * d.W + xA) * 4 + k];
    const p11 = d.img[((yA + 1) * d.W + xA + 1) * 4 + k];
    px.push(Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy));
  }
  return px;
}

function crc32(buf) {
  let t = crc32.t;
  if (!t) {
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, c]);
}

// Flattened onto white (the logo always sits on a white pill, and opaque
// RGB compresses far better than RGBA) — color type 2 (truecolor, no alpha).
function encodeRGBWhite(w, h, rgba) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3] / 255;
      raw[y * (w * 3 + 1) + 1 + x * 3] = Math.round(rgba[i] * a + 255 * (1 - a));
      raw[y * (w * 3 + 1) + 1 + x * 3 + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
      raw[y * (w * 3 + 1) + 1 + x * 3 + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const d = decodePNG(fs.readFileSync(SRC));
const box = contentBBox(d);
console.log('content bbox:', box);
const PAD = 24;
const x0 = Math.max(0, box.minX - PAD);
const y0 = Math.max(0, box.minY - PAD);
const x1 = Math.min(d.W - 1, box.maxX + PAD);
const y1 = Math.min(d.H - 1, box.maxY + PAD);
const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;

const TW = 480;
const TH = Math.round((ch * TW) / cw);
const rgba = new Array(TW * TH * 4);
for (let y = 0; y < TH; y++) {
  for (let x = 0; x < TW; x++) {
    const sx = ((x + 0.5) * cw) / TW - 0.5 + x0;
    const sy = ((y + 0.5) * ch) / TH - 0.5 + y0;
    const p = sampleBilinear(d, sx, sy);
    rgba[(y * TW + x) * 4] = p[0];
    rgba[(y * TW + x) * 4 + 1] = p[1];
    rgba[(y * TW + x) * 4 + 2] = p[2];
    rgba[(y * TW + x) * 4 + 3] = p[3];
  }
}
const png = encodeRGBWhite(TW, TH, rgba);
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${TW}x${TH}, ${png.length} bytes)`);
