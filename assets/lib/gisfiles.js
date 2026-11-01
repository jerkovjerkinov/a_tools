// a_tools GIS file writers: ZIP archives, ESRI Shapefiles from GeoJSON features, and KMZ.
// ATGis.zip([{ name, data: Uint8Array | string }]) → Promise<Uint8Array> (deflated when the browser can, stored otherwise)
// ATGis.shapefiles(features, prefix) → [{ name, data }]: one .shp/.shx/.dbf/.prj/.cpg set per `layer` property and geometry kind
(function () {
const enc = new TextEncoder();
const bytes = d => typeof d === 'string' ? enc.encode(d) : d;

// ---------- ZIP ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(b) {
  if (typeof CompressionStream === 'undefined') return null;
  try { return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch (e) { return null; }
}
async function zip(files, { now = new Date() } = {}) {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const data = bytes(f.data), name = enc.encode(f.name), crc = crc32(data);
    const def = data.length > 64 ? await deflate(data) : null, use = def && def.length < data.length ? def : data, method = use === data ? 0 : 8;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, use.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, use.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), name, use); central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + use.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ---------- Shapefile ----------
const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const KIND = { Point: 1, MultiPoint: 1, LineString: 3, MultiLineString: 3, Polygon: 5, MultiPolygon: 5 };
const ringArea = r => { let a = 0; for (let i = 0; i + 1 < r.length; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; };
const closeRing = r => { const a = r[0], b = r[r.length - 1]; return a[0] === b[0] && a[1] === b[1] ? r : [...r, a]; };
// Parts of a feature as rings or lines; shapefile polygons want outer rings clockwise and holes counter-clockwise.
function partsOf(g) {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const out = [];
  polys.forEach(p => p.forEach((r, i) => { const c = closeRing(r), cw = ringArea(c) < 0; out.push(cw === (i === 0) ? c : c.slice().reverse()); }));
  return out;
}
// dBASE field name: 10 ASCII characters, unique within the table.
function fieldNames(keys) {
  const used = new Set();
  return keys.map(k => { let b = k.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'F'; let s = b, q = 1; while (used.has(s.toUpperCase())) s = b.slice(0, 10 - String(q).length) + q++; used.add(s.toUpperCase()); return s; });
}
// Cut UTF-8 bytes to n without splitting a character.
function cutUtf8(b, n) { if (b.length <= n) return b; let e = n; while (e > 0 && (b[e] & 0xc0) === 0x80) e--; return b.subarray(0, e); }
function dbf(features) {
  const keys = [...new Set(features.flatMap(f => Object.keys(f.properties || {}).filter(k => k !== 'layer')))];
  const fields = keys.map((k, i) => {
    const vals = features.map(f => (f.properties || {})[k]).filter(v => v != null && v !== '');
    const num = vals.length > 0 && vals.every(v => typeof v === 'number' && isFinite(v));
    if (num) {
      const dec = Math.min(6, Math.max(0, ...vals.map(v => { const s = String(v), d = s.indexOf('.'); return d < 0 || /e/i.test(s) ? 0 : s.length - d - 1; })));
      const len = Math.min(19, Math.max(1, ...vals.map(v => v.toFixed(dec).length)));
      return { key: k, type: 'N', len, dec };
    }
    const len = Math.min(254, Math.max(1, ...vals.map(v => bytes(typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)).length)));
    return { key: k, type: 'C', len, dec: 0 };
  });
  const names = fieldNames(keys), recLen = 1 + fields.reduce((s, f) => s + f.len, 0), headLen = 32 + 32 * fields.length + 1;
  const out = new Uint8Array(headLen + recLen * features.length + 1), dv = new DataView(out.buffer), now = new Date();
  out[0] = 3; out[1] = now.getFullYear() - 1900; out[2] = now.getMonth() + 1; out[3] = now.getDate();
  dv.setUint32(4, features.length, true); dv.setUint16(8, headLen, true); dv.setUint16(10, recLen, true);
  fields.forEach((f, i) => { const o = 32 + 32 * i; out.set(enc.encode(names[i]), o); out[o + 11] = f.type.charCodeAt(0); out[o + 16] = f.len; out[o + 17] = f.dec; });
  out[headLen - 1] = 0x0d;
  let p = headLen;
  features.forEach(ft => {
    out[p++] = 0x20;
    fields.forEach(f => {
      const v = (ft.properties || {})[f.key], cell = new Uint8Array(f.len).fill(0x20);
      if (v != null && v !== '') {
        if (f.type === 'N') { const s = enc.encode(v.toFixed(f.dec).slice(0, f.len)); cell.set(s, f.len - s.length); }
        else cell.set(cutUtf8(bytes(typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)), f.len));
      }
      out.set(cell, p); p += f.len;
    });
  });
  out[p] = 0x1a;
  return out;
}
function shp(features, type) {
  const recs = features.map(f => {
    if (type === 1) { const c = f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0]; const b = new DataView(new ArrayBuffer(20)); b.setInt32(0, 1, true); b.setFloat64(4, c[0], true); b.setFloat64(12, c[1], true); return { b, box: [c[0], c[1], c[0], c[1]] }; }
    const parts = partsOf(f.geometry).filter(r => r.length >= (type === 5 ? 4 : 2)), np = parts.reduce((s, r) => s + r.length, 0);
    const b = new DataView(new ArrayBuffer(44 + 4 * parts.length + 16 * np)), box = [Infinity, Infinity, -Infinity, -Infinity];
    parts.forEach(r => r.forEach(([x, y]) => { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }));
    if (!np) box.fill(0);
    b.setInt32(0, type, true); box.forEach((v, i) => b.setFloat64(4 + 8 * i, v, true)); b.setInt32(36, parts.length, true); b.setInt32(40, np, true);
    let o = 44, start = 0; parts.forEach(r => { b.setInt32(o, start, true); o += 4; start += r.length; });
    parts.forEach(r => r.forEach(([x, y]) => { b.setFloat64(o, x, true); b.setFloat64(o + 8, y, true); o += 16; }));
    return { b, box };
  });
  const box = recs.reduce((a, r) => [Math.min(a[0], r.box[0]), Math.min(a[1], r.box[1]), Math.max(a[2], r.box[2]), Math.max(a[3], r.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  if (!recs.length) box.fill(0);
  const head = len => { const h = new DataView(new ArrayBuffer(100)); h.setInt32(0, 9994); h.setInt32(24, len / 2); h.setInt32(28, 1000, true); h.setInt32(32, type, true); box.forEach((v, i) => h.setFloat64(36 + 8 * i, v, true)); return new Uint8Array(h.buffer); };
  const shpLen = 100 + recs.reduce((s, r) => s + 8 + r.b.byteLength, 0), main = new Uint8Array(shpLen), index = new Uint8Array(100 + 8 * recs.length);
  main.set(head(shpLen)); index.set(head(index.length));
  const mv = new DataView(main.buffer), iv = new DataView(index.buffer); let o = 100;
  recs.forEach((r, i) => {
    iv.setInt32(100 + 8 * i, o / 2); iv.setInt32(104 + 8 * i, r.b.byteLength / 2);
    mv.setInt32(o, i + 1); mv.setInt32(o + 4, r.b.byteLength / 2); main.set(new Uint8Array(r.b.buffer), o + 8); o += 8 + r.b.byteLength;
  });
  return { shp: main, shx: index };
}
// One shapefile per layer and geometry kind (a shapefile holds a single kind).
function shapefiles(features, prefix = '') {
  const groups = new Map();
  features.forEach(f => { const t = f.geometry && KIND[f.geometry.type]; if (!t) return; const key = ((f.properties && f.properties.layer) || 'layer') + '|' + t; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(f); });
  const kinds = new Map(); groups.forEach((_, key) => { const l = key.split('|')[0]; kinds.set(l, (kinds.get(l) || 0) + 1); });
  const out = [];
  groups.forEach((fs, key) => {
    const [layer, t] = key.split('|'), name = prefix + layer.replace(/[^A-Za-z0-9_-]/g, '_') + (kinds.get(layer) > 1 ? { 1: '_points', 3: '_lines', 5: '_areas' }[t] : '');
    const g = shp(fs, +t);
    out.push({ name: name + '.shp', data: g.shp }, { name: name + '.shx', data: g.shx }, { name: name + '.dbf', data: dbf(fs) }, { name: name + '.prj', data: PRJ_WGS84 }, { name: name + '.cpg', data: 'UTF-8' });
  });
  return out;
}

window.ATGis = { zip, crc32, shapefiles, dbf, shp, PRJ_WGS84 };
})();
