// a_tools PMTiles v3 reader and Mapbox Vector Tile decoder, for reading cloud-hosted vector tiles with HTTP range requests.
// ATPmtiles.open(url) → archive; ATPmtiles.tile(archive, z, x, y) → Uint8Array | null; ATPmtiles.decode(bytes, z, x, y) → layers
// with features in longitude / latitude: { name: [{ id, type: 1 point | 2 line | 3 polygon, props, geom }] }.
// geom: points [[lng, lat]], lines [[[lng, lat]]], polygons [[outer, ...holes]] (rings closed; outer rings run clockwise on the map).
(function () {
const gunzip = async u8 => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
async function range(url, off, len) {
  const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  return new Uint8Array(await r.arrayBuffer());
}
const u64 = (dv, o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;

// Directory: varint-encoded columns (tile id deltas, run lengths, lengths, offsets).
function readDir(b) {
  let p = 0;
  const vi = () => { let v = 0, s = 1, c; do { c = b[p++]; v += (c & 0x7f) * s; s *= 128; } while (c & 0x80); return v; };
  const n = vi(), E = Array.from({ length: n }, () => ({}));
  let id = 0; E.forEach(e => { id += vi(); e.id = id; });
  E.forEach(e => { e.run = vi(); }); E.forEach(e => { e.len = vi(); });
  E.forEach((e, i) => { const v = vi(); e.off = v === 0 && i > 0 ? E[i - 1].off + E[i - 1].len : v - 1; });
  return E;
}
const decomp = (a, b) => a.icomp === 2 ? gunzip(b) : Promise.resolve(b);

async function open(url) {
  const h = await range(url, 0, 16384), dv = new DataView(h.buffer, h.byteOffset);
  if (String.fromCharCode(...h.slice(0, 7)) !== 'PMTiles' || h[7] !== 3) throw new Error('not PMTiles v3');
  const a = { url, rootOff: u64(dv, 8), rootLen: u64(dv, 16), leafOff: u64(dv, 40), dataOff: u64(dv, 56), icomp: h[97], tcomp: h[98], minz: h[100], maxz: h[101], dirs: new Map() };
  const root = a.rootOff + a.rootLen <= h.length ? h.slice(a.rootOff, a.rootOff + a.rootLen) : await range(url, a.rootOff, a.rootLen);
  a.root = readDir(await decomp(a, root));
  return a;
}
// Hilbert-curve tile id: all tiles of lower zooms first, then the position along the curve.
function tileId(z, x, y) {
  let acc = 0; for (let i = 0; i < z; i++) acc += Math.pow(4, i);
  const n = Math.pow(2, z); let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
  }
  return acc + d;
}
function find(E, id) {
  let lo = 0, hi = E.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (E[m].id < id) lo = m + 1; else if (E[m].id > id) hi = m - 1; else return E[m]; }
  if (hi >= 0) { const e = E[hi]; if (e.run === 0 || id - e.id < e.run) return e; }
  return null;
}
async function tile(a, z, x, y) {
  const id = tileId(z, x, y); let E = a.root;
  for (let depth = 0; depth < 4; depth++) {
    const e = find(E, id); if (!e) return null;
    if (e.run > 0) { const b = await range(a.url, a.dataOff + e.off, e.len); return a.tcomp === 2 ? gunzip(b) : b; }
    const key = e.off + ':' + e.len;
    if (!a.dirs.has(key)) a.dirs.set(key, range(a.url, a.leafOff + e.off, e.len).then(b => decomp(a, b)).then(readDir));
    E = await a.dirs.get(key);
  }
  return null;
}

// ---------- Mapbox Vector Tile (protobuf) ----------
function Pbf(b) { this.b = b; this.p = 0; }
Pbf.prototype.varint = function () { let v = 0, s = 1, c; do { c = this.b[this.p++]; v += (c & 0x7f) * s; s *= 128; } while (c & 0x80); return v; };
Pbf.prototype.end = function () { return this.varint() + this.p; };
Pbf.prototype.skip = function (t) { if (t === 0) this.varint(); else if (t === 1) this.p += 8; else if (t === 2) this.p = this.end(); else if (t === 5) this.p += 4; };
const zz = v => (v % 2 ? -(v + 1) / 2 : v / 2);
const td = new TextDecoder();

function value(pb) {
  const end = pb.end(); let v = null;
  while (pb.p < end) {
    const k = pb.varint(), f = k >> 3;
    if (f === 1) { const e = pb.end(); v = td.decode(pb.b.subarray(pb.p, e)); pb.p = e; }
    else if (f === 2) { v = new DataView(pb.b.buffer, pb.b.byteOffset + pb.p, 4).getFloat32(0, true); pb.p += 4; }
    else if (f === 3) { v = new DataView(pb.b.buffer, pb.b.byteOffset + pb.p, 8).getFloat64(0, true); pb.p += 8; }
    else if (f === 4 || f === 5) v = pb.varint();
    else if (f === 6) v = zz(pb.varint());
    else if (f === 7) v = !!pb.varint();
    else pb.skip(k & 7);
  }
  return v;
}
function decode(bytes, z, x, y) {
  const pb = new Pbf(bytes), layers = {}, n = Math.pow(2, z);
  while (pb.p < bytes.length) {
    const k = pb.varint();
    if (k >> 3 !== 3) { pb.skip(k & 7); continue; }
    const end = pb.end(); let name = '', ext = 4096; const keys = [], vals = [], feats = [];
    while (pb.p < end) {
      const k2 = pb.varint(), f = k2 >> 3;
      if (f === 1) { const e = pb.end(); name = td.decode(pb.b.subarray(pb.p, e)); pb.p = e; }
      else if (f === 2) { const e = pb.end(); feats.push([pb.p, e]); pb.p = e; }
      else if (f === 3) { const e = pb.end(); keys.push(td.decode(pb.b.subarray(pb.p, e))); pb.p = e; }
      else if (f === 4) vals.push(value(pb));
      else if (f === 5) ext = pb.varint();
      else pb.skip(k2 & 7);
    }
    const lng = px => (x + px / ext) / n * 360 - 180;
    const lat = py => { const t = Math.PI * (1 - 2 * (y + py / ext) / n); return Math.atan(Math.sinh(t)) * 180 / Math.PI; };
    layers[name] = feats.map(([s, e]) => {
      pb.p = s; const ft = { id: 0, type: 0, props: {}, geom: null }; let tags = [], g = [];
      while (pb.p < e) {
        const k3 = pb.varint(), f = k3 >> 3;
        if (f === 1) ft.id = pb.varint();
        else if (f === 2) { const ee = pb.end(); while (pb.p < ee) tags.push(pb.varint()); }
        else if (f === 3) ft.type = pb.varint();
        else if (f === 4) { const ee = pb.end(); while (pb.p < ee) g.push(pb.varint()); }
        else pb.skip(k3 & 7);
      }
      for (let i = 0; i + 1 < tags.length; i += 2) ft.props[keys[tags[i]]] = vals[tags[i + 1]];
      // Geometry commands: MoveTo 1, LineTo 2, ClosePath 7 (zig-zag deltas in tile units).
      const rings = []; let cur = null, cx = 0, cy = 0;
      for (let i = 0; i < g.length;) {
        const c = g[i++], id = c & 7, cnt = c >> 3;
        if (id === 7) { if (cur && cur.length) cur.push(cur[0]); continue; }
        for (let j = 0; j < cnt; j++) {
          cx += zz(g[i++]); cy += zz(g[i++]);
          if (id === 1) { cur = []; rings.push(cur); }
          cur.push([cx, cy]);
        }
      }
      if (ft.type === 1) ft.geom = rings.flat().map(([a, b]) => [lng(a), lat(b)]);
      else if (ft.type === 2) ft.geom = rings.map(r => r.map(([a, b]) => [lng(a), lat(b)]));
      else if (ft.type === 3) {
        // Exterior rings have positive area in tile coordinates (y down); each starts a new polygon.
        const polys = [];
        rings.forEach(r => { if (r.length < 4) return; let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
          const ll = r.map(([a, b]) => [lng(a), lat(b)]);
          if (s > 0 || !polys.length) polys.push([ll]); else polys[polys.length - 1].push(ll); });
        ft.geom = polys;
      }
      return ft;
    });
    pb.p = end;   // feature decoding moved the cursor; continue after this layer
  }
  return layers;
}
// Tiles covering a bounding box at zoom z.
function cover(west, south, east, north, z) {
  const n = Math.pow(2, z), X = lng => Math.floor((lng + 180) / 360 * n);
  const Y = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
  const out = []; for (let x = X(west); x <= X(east); x++) for (let y = Y(north); y <= Y(south); y++) out.push([z, x, y]);
  return out;
}
const bounds = (z, x, y) => { const n = Math.pow(2, z), lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI; return { west: x / n * 360 - 180, east: (x + 1) / n * 360 - 180, north: lat(y), south: lat(y + 1) }; };

window.ATPmtiles = { open, tile, decode, cover, bounds, tileId };
})();
