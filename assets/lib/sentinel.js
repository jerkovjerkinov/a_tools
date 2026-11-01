// a_tools Sentinel-2 reader: the clearest recent leaf-on scene over a site (Copernicus Sentinel-2 L2A, 10 m),
// read straight from the open COGs on AWS (Element 84 Earth Search; no key, CORS open).
// ATSentinel.load(site, half) → { id, date, cloud, n, step, ndvi, scl, rgb } on an n × n grid over the square
// |x|, |y| ≤ half (local metres, row 0 = north edge). Needs ATUtm and ATCog.
(function () {
const STAC = 'https://earth-search.aws.element84.com/v1';
const BUCKET = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/';
const day = 864e5;

// Leaf-on months score better: the vegetation reading is about trees in leaf.
function score(it, lat) {
  const d = new Date(it.date), m = d.getUTCMonth() + 1, leafOn = lat >= 0 ? m >= 5 && m <= 9 : m >= 11 || m <= 3;
  return it.cloud + (leafOn ? 0 : 25) + (Date.now() - d) / day / 60;
}
const item = f => ({ id: f.id, date: f.properties.datetime, cloud: +f.properties['eo:cloud_cover'] || 0,
  href: k => (f.assets[k] || {}).href, band: k => ((f.assets[k] || {})['raster:bands'] || [{}])[0], epsg: f.properties['proj:epsg'] });

async function searchStac(bbox) {
  const now = new Date(), from = new Date(now - 400 * day);
  const body = { collections: ['sentinel-2-l2a'], bbox, limit: 100, datetime: from.toISOString() + '/' + now.toISOString(), query: { 'eo:cloud_cover': { lt: 30 } } };
  const j = await ATools.fetchJson(STAC + '/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000);
  return (j.features || []).filter(f => f.assets && f.assets.red && f.assets.nir && f.assets.scl).map(item);
}
// Without the catalogue: list the tile's folders in the bucket month by month and read the item files.
async function searchBucket(lat, lng) {
  const t = ATUtm.mgrs(lat, lng), out = [], now = new Date();
  const months = [...Array(13)].map((_, k) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); return [d.getUTCFullYear(), d.getUTCMonth() + 1]; });
  const lists = await Promise.all(months.map(async ([y, m]) => {
    const prefix = `sentinel-s2-l2a-cogs/${t.zone}/${t.band}/${t.sq}/${y}/${m}/`;
    try {
      const r = await fetch(`${BUCKET}?list-type=2&delimiter=/&prefix=${prefix}`); const x = await r.text();
      return [...x.matchAll(/<Prefix>([^<]+_L2A\/)<\/Prefix>/g)].map(a => a[1]);
    } catch (e) { return []; }
  }));
  const cands = lists.flat().map(p => ({ p, date: p.match(/_(\d{8})_/)[1] })).map(c => ({ ...c, d: new Date(c.date.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')) }));
  const leaf = c => { const m = c.d.getUTCMonth() + 1; return lat >= 0 ? m >= 5 && m <= 9 : m >= 11 || m <= 3; };
  cands.sort((a, b) => (leaf(b) - leaf(a)) || (b.d - a.d));
  await Promise.all(cands.slice(0, 10).map(async c => {
    try { const name = c.p.split('/').slice(-2)[0], f = await ATools.fetchJson(BUCKET + c.p + name + '.json', {}, 15000); if (f.assets && f.assets.red) out.push(item(f)); } catch (e) {}
  }));
  return out;
}

// Read one band over the square, resampled to the local grid (nearest cell).
async function band(href, o, half, n, step, zone, south) {
  const img = await ATCog.open(href), L = ATUtm.local(o), pts = new Float64Array(n * n * 2);
  let ex0 = Infinity, ex1 = -Infinity, ny0 = Infinity, ny1 = -Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ll = L.ll(-half + (i + 0.5) * step, half - (j + 0.5) * step), u = ATUtm.toUtm(ll.lat, ll.lng, zone, south), [px, py] = ATCog.pixel(img, u.e, u.n), k = (j * n + i) * 2;
    pts[k] = px; pts[k + 1] = py; ex0 = Math.min(ex0, px); ex1 = Math.max(ex1, px); ny0 = Math.min(ny0, py); ny1 = Math.max(ny1, py);
  }
  const win = await ATCog.read(img, ex0 - 1, ny0 - 1, ex1 + 2, ny1 + 2), spp = win.spp, out = new Float32Array(n * n * spp).fill(NaN);
  for (let q = 0; q < n * n; q++) {
    const x = Math.floor(pts[2 * q]) - win.x0, y = Math.floor(pts[2 * q + 1]) - win.y0;
    if (x < 0 || y < 0 || x >= win.w || y >= win.h) continue;
    for (let s = 0; s < spp; s++) out[q * spp + s] = win.data[(y * win.w + x) * spp + s];
  }
  return out;
}

async function load(o, half, { res = 10, rgb = true, onStep = () => {} } = {}) {
  const L = ATUtm.local(o), sw = L.ll(-half, -half), ne = L.ll(half, half);
  const bbox = [sw.lng, sw.lat, ne.lng, ne.lat];
  let items = [];
  try { items = await searchStac(bbox); } catch (e) { /* catalogue down: fall back to the bucket */ }
  if (!items.length) { const nw = L.ll(-half, half); items = await searchBucket(nw.lat, nw.lng); }
  if (!items.length) throw Object.assign(new Error('no scene'), { why: 'No clear Sentinel-2 image of the last year was found.' });
  items.sort((a, b) => score(a, o.lat) - score(b, o.lat));
  const n = Math.min(600, Math.ceil(2 * half / res)), step = 2 * half / n;
  let last;
  for (const it of items.slice(0, 4)) {
    try {
      onStep(`Sentinel-2 ${it.date.slice(0, 10)}`);
      const zone = it.epsg ? it.epsg % 100 : ATUtm.zoneOf(o.lat, o.lng), south = it.epsg ? Math.floor(it.epsg / 100) === 327 : o.lat < 0;
      const scl = await band(it.href('scl'), o, half, n, step, zone, south);
      let bad = 0, none = 0;
      for (const v of scl) { if (!(v > 0)) none++; else if (v === 3 || v === 8 || v === 9 || v === 10) bad++; }
      if (none > 0.15 * n * n || bad > 0.3 * n * n) { last = new Error('cloudy'); continue; }
      const [red, nir, vis] = await Promise.all([band(it.href('red'), o, half, n, step, zone, south), band(it.href('nir'), o, half, n, step, zone, south),
        rgb && it.href('visual') ? band(it.href('visual'), o, half, n, step, zone, south).catch(() => null) : null]);
      // Processing baseline 04.00 (from 25 Jan 2022) adds 1000 to every value; the catalogue gives scale and offset.
      const br = it.band('red'), sc = br.scale || 1e-4, off = br.offset != null ? br.offset : (new Date(it.date) >= new Date('2022-01-25') ? -0.1 : 0);
      const ndvi = new Float32Array(n * n);
      for (let q = 0; q < n * n; q++) {
        const r = red[q] * sc + off, i = nir[q] * sc + off, c = scl[q];
        ndvi[q] = !(c > 0) || c === 3 || c === 8 || c === 9 || c === 10 || !(r + i > 0) ? NaN : (i - r) / (i + r);
      }
      let img = null;
      if (vis) { img = new Uint8ClampedArray(n * n * 4); for (let q = 0; q < n * n; q++) { img[4 * q] = vis[3 * q]; img[4 * q + 1] = vis[3 * q + 1]; img[4 * q + 2] = vis[3 * q + 2]; img[4 * q + 3] = vis[3 * q] >= 0 ? 255 : 0; } }
      return { id: it.id, date: it.date.slice(0, 10), cloud: it.cloud, siteCloud: bad / (n * n), n, step, half, ndvi, scl: Uint8Array.from(scl, v => v > 0 ? v : 0), rgb: img };
    } catch (e) { last = e; }
  }
  throw Object.assign(last || new Error('scene'), { why: 'The Sentinel-2 images over the site were cloudy or could not be read.' });
}

window.ATSentinel = { load, credit: 'Contains modified Copernicus Sentinel data (Sentinel-2 L2A via Element 84 Earth Search)' };
})();
