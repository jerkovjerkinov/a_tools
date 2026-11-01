// a_tools Cloud-Optimised GeoTIFF reader: reads only the tiles that cover a pixel window, with HTTP range requests.
// Handles classic TIFF and BigTIFF, tiled images, no compression or DEFLATE, horizontal predictor (2),
// 8/16-bit integers and 32-bit floats, one or more interleaved samples. Enough for Sentinel-2 L2A COGs.
// ATCog.open(url) → image; ATCog.read(image, x0, y0, x1, y1) → { data, w, h, spp } (x1, y1 exclusive).
(function () {
async function range(url, a, b, ms = 30000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal: ctl.signal });
    if (r.status !== 206 && r.status !== 200) throw Object.assign(new Error('COG ' + r.status), { why: `The image server answered with an error (${r.status}).` });
    const buf = await r.arrayBuffer();
    return r.status === 200 ? buf.slice(a, b + 1) : buf;
  } finally { clearTimeout(t); }
}
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

async function open(url) {
  let buf = await range(url, 0, 65535), d = new DataView(buf);
  const le = d.getUint16(0) === 0x4949, big = d.getUint16(2, le) === 43;
  const u64 = o => Number(d.getBigUint64(o, le));
  const ifd = big ? u64(8) : d.getUint32(4, le);
  if (ifd + 4096 > buf.byteLength) { buf = await range(url, 0, ifd + 65535); d = new DataView(buf); }
  const cnt = big ? u64(ifd) : d.getUint16(ifd, le), es = big ? 20 : 12, head = big ? 8 : 2, tag = {};
  // Read every value of every tag, fetching out-of-header arrays separately.
  const val = (type, o) => type === 3 ? d.getUint16(o, le) : type === 4 ? d.getUint32(o, le) : type === 16 ? u64(o) : type === 12 ? d.getFloat64(o, le) : type === 11 ? d.getFloat32(o, le) : d.getUint8(o);
  const later = [];
  for (let i = 0; i < cnt; i++) {
    const e = ifd + head + i * es, id = d.getUint16(e, le), type = d.getUint16(e + 2, le);
    const n = big ? u64(e + 4) : d.getUint32(e + 4, le), bytes = n * (SIZE[type] || 1), inl = bytes <= (big ? 8 : 4);
    const off = inl ? e + (big ? 12 : 8) : (big ? u64(e + 12) : d.getUint32(e + 8, le));
    if (inl || off + bytes <= buf.byteLength) tag[id] = Array.from({ length: n }, (_, k) => val(type, off + k * (SIZE[type] || 1)));
    else later.push({ id, type, n, off, bytes });
  }
  await Promise.all(later.map(async t => {
    const dv = new DataView(await range(url, t.off, t.off + t.bytes - 1)), s = SIZE[t.type];
    const v = o => t.type === 3 ? dv.getUint16(o, le) : t.type === 4 ? dv.getUint32(o, le) : t.type === 16 ? Number(dv.getBigUint64(o, le)) : t.type === 12 ? dv.getFloat64(o, le) : dv.getUint8(o);
    tag[t.id] = Array.from({ length: t.n }, (_, k) => v(k * s));
  }));
  const comp = (tag[259] || [1])[0];
  if (!tag[322]) throw new Error('COG: image is not tiled');
  if (comp !== 1 && comp !== 8 && comp !== 32946) throw new Error('COG: unsupported compression ' + comp);
  const sc = tag[33550] || [1, 1], tp = tag[33922] || [0, 0, 0, 0, 0, 0];
  return { url, le, W: tag[256][0], H: tag[257][0], TW: tag[322][0], TH: tag[323][0], offs: tag[324], cnts: tag[325],
    bps: (tag[258] || [8])[0], spp: (tag[277] || [1])[0], fmt: (tag[339] || [1])[0], pred: (tag[317] || [1])[0], comp,
    sx: sc[0], sy: sc[1], x0: tp[3] - tp[0] * sc[0], y0: tp[4] + tp[1] * sc[1] };
}

async function inflate(buf) {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(s).arrayBuffer();
}
function typed(img, buf) {
  if (img.bps === 8) return new Uint8Array(buf);
  if (img.bps === 16) return img.fmt === 2 ? new Int16Array(buf) : new Uint16Array(buf);
  if (img.bps === 32) return img.fmt === 3 ? new Float32Array(buf) : img.fmt === 2 ? new Int32Array(buf) : new Uint32Array(buf);
  throw new Error('COG: unsupported sample size ' + img.bps);
}
const cache = new Map();
async function tile(img, k) {
  const key = img.url + '#' + k;
  if (!cache.has(key)) cache.set(key, (async () => {
    const len = img.cnts[k]; if (!len) return null;
    let buf = await range(img.url, img.offs[k], img.offs[k] + len - 1);
    if (img.comp !== 1) buf = await inflate(buf);
    if (!img.le && img.bps > 8) {   // big-endian samples → swap bytes in place
      const u = new Uint8Array(buf), b = img.bps / 8;
      for (let i = 0; i < u.length; i += b) for (let j = 0; j < b / 2; j++) { const t = u[i + j]; u[i + j] = u[i + b - 1 - j]; u[i + b - 1 - j] = t; }
    }
    const a = typed(img, buf);
    if (img.pred === 2) {   // horizontal differencing, per sample
      const row = img.TW * img.spp;
      for (let y = 0; y < img.TH; y++) for (let i = y * row + img.spp; i < (y + 1) * row; i++) a[i] += a[i - img.spp];
    }
    return a;
  })());
  try { return await cache.get(key); } catch (e) { cache.delete(key); throw e; }
}
async function read(img, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(img.W, Math.ceil(x1)); y1 = Math.min(img.H, Math.ceil(y1));
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), spp = img.spp, out = new (img.bps === 32 ? Float32Array : img.bps === 16 ? (img.fmt === 2 ? Int16Array : Uint16Array) : Uint8Array)(w * h * spp);
  const TA = Math.ceil(img.W / img.TW), jobs = [];
  for (let ty = Math.floor(y0 / img.TH); ty <= Math.floor((y1 - 1) / img.TH); ty++)
    for (let tx = Math.floor(x0 / img.TW); tx <= Math.floor((x1 - 1) / img.TW); tx++) jobs.push([tx, ty]);
  if (jobs.length > 16) throw new Error('COG: window too large');
  await Promise.all(jobs.map(async ([tx, ty]) => {
    const t = await tile(img, ty * TA + tx); if (!t) return;
    const ax = Math.max(x0, tx * img.TW), bx = Math.min(x1, (tx + 1) * img.TW), ay = Math.max(y0, ty * img.TH), by = Math.min(y1, (ty + 1) * img.TH);
    for (let y = ay; y < by; y++) {
      const src = ((y - ty * img.TH) * img.TW + (ax - tx * img.TW)) * spp, dst = ((y - y0) * w + (ax - x0)) * spp;
      out.set(t.subarray(src, src + (bx - ax) * spp), dst);
    }
  }));
  return { data: out, w, h, spp, x0, y0 };
}
// Pixel column/row of a map coordinate in the image's own CRS.
const pixel = (img, X, Y) => [(X - img.x0) / img.sx, (img.y0 - Y) / img.sy];

window.ATCog = { open, read, pixel, range };
})();
