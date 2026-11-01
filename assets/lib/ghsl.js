// a_tools GHSL built-height reader: average net building height (ANBH, metres, 2018, about 90 m cells)
// from the JRC Global Human Settlement Layer, read straight from its cloud-optimised GeoTIFF with range requests.
// Licence CC BY 4.0: credit "GHS-BUILT-H R2023A, European Commission JRC". No API key, CORS open.
// ATGhsl.load(site, R) → { at(x, y) → metres or 0 where nothing is built, median } in local metres around the site.
(function () {
const URL_ = 'https://jrc-ghsl.s3.amazonaws.com/ghs-built-h-anbh/r2023a/4326/3asec/2018/GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_4326_3ss_V1_0.tif';
const rad = Math.PI / 180;
async function range(a, b) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(URL_, { headers: { Range: `bytes=${a}-${b}` }, signal: ctl.signal });
    if (r.status !== 206) throw new Error('GHSL: no range support (' + r.status + ')');
    return new DataView(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}
let head = null;
// BigTIFF header: image width, tile size, where the tile offset and size tables are, and the geotransform.
async function header() {
  if (head) return head;
  const d = await range(0, 4095), le = d.getUint16(0) === 0x4949;
  if (d.getUint16(2, le) !== 43) throw new Error('GHSL: unexpected file format');
  const u64 = o => Number(d.getBigUint64(o, le)), ifd = u64(8), n = u64(ifd), tag = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 8 + i * 20, id = d.getUint16(e, le), type = d.getUint16(e + 2, le), cnt = u64(e + 4);
    tag[id] = { type, cnt, v: type === 3 ? d.getUint16(e + 12, le) : type === 4 ? d.getUint32(e + 12, le) : u64(e + 12) };
  }
  if (tag[259].v !== 8 || tag[258].v !== 32 || (tag[317] && tag[317].v !== 1)) throw new Error('GHSL: unexpected compression');
  const sc = tag[33550].v, tp = tag[33922].v;
  head = { W: tag[256].v, TW: tag[322].v, TH: tag[323].v, offs: tag[324].v, offT: tag[324].type, cnts: tag[325].v, cntT: tag[325].type,
    sx: d.getFloat64(sc, le), sy: d.getFloat64(sc + 8, le), x0: d.getFloat64(tp + 24, le), y0: d.getFloat64(tp + 32, le), le };
  return head;
}
async function inflate(buf) {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Float32Array(await new Response(s).arrayBuffer());
}
async function tile(h, k) {
  const ob = h.offT === 16 ? 8 : 4, cb = h.cntT === 16 ? 8 : 4;
  const [o, c] = await Promise.all([range(h.offs + k * ob, h.offs + k * ob + ob - 1), range(h.cnts + k * cb, h.cnts + k * cb + cb - 1)]);
  const off = ob === 8 ? Number(o.getBigUint64(0, h.le)) : o.getUint32(0, h.le), len = cb === 8 ? Number(c.getBigUint64(0, h.le)) : c.getUint32(0, h.le);
  if (!len) return null;
  const d = await range(off, off + len - 1);
  return inflate(d.buffer);
}
async function load(site, R) {
  const h = await header(), dLat = R / 110540, dLng = R / (111320 * Math.cos(site.lat * rad));
  const px = lng => (lng - h.x0) / h.sx, py = lat => (h.y0 - lat) / h.sy;
  const X0 = Math.floor(px(site.lng - dLng)), X1 = Math.floor(px(site.lng + dLng)), Y0 = Math.floor(py(site.lat + dLat)), Y1 = Math.floor(py(site.lat - dLat));
  const TA = Math.ceil(h.W / h.TW), keys = new Set();
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) keys.add(Math.floor(y / h.TH) * TA + Math.floor(x / h.TW));
  if (keys.size > 4) throw new Error('GHSL: area too large');
  const tiles = {}; await Promise.all([...keys].map(async k => { tiles[k] = await tile(h, k); }));
  const val = (x, y) => { const t = tiles[Math.floor(y / h.TH) * TA + Math.floor(x / h.TW)]; const v = t ? t[(y % h.TH) * h.TW + (x % h.TW)] : 0; return v > 0 && v < 500 ? v : 0; };
  const vals = []; for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const v = val(x, y); if (v) vals.push(v); }
  vals.sort((a, b) => a - b);
  const mLng = 1 / (111320 * Math.cos(site.lat * rad)), mLat = 1 / 110540;
  return { median: vals.length ? vals[vals.length >> 1] : 0, cells: vals.length,
    at: (x, y) => val(Math.floor(px(site.lng + x * mLng)), Math.floor(py(site.lat + y * mLat))) };
}
window.ATGhsl = { load, url: URL_, credit: 'GHS-BUILT-H R2023A, European Commission JRC (CC BY 4.0)' };
})();
