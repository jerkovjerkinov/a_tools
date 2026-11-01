// a_tools terrain library: an elevation grid for a square site from open terrain tiles, refined for a site model
// (bicubic surface, carved stream beds, road benches, building pads), plus contours, closed plates for laser cutting,
// slope, aspect, hillshade, flow accumulation, streams and wetness.
// Grid T = { n, step, half, z: Float32Array(n * n) } in metres above sea level; node (i, j) sits at
// x = -half + i * step (east), y = -half + j * step (north); index j * n + i. Needs ATUtm.
(function () {
const rad = Math.PI / 180;
const MAPTERHORN = (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
const TERRARIUM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// ---------- Tiles ----------
const tx = (lng, z) => (lng + 180) / 360 * 2 ** z;
const ty = (lat, z) => { const s = Math.sin(lat * rad); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z; };
async function fetchTile(url, ms = 20000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const blob = await r.blob(), src = r.headers.get('x-amz-meta-x-imagery-sources') || '';
    // No colour management or premultiplying: the colour channels are the height.
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data, e = new Float32Array(bmp.width * bmp.height);
    for (let k = 0; k < e.length; k++) { const v = d[4 * k] * 256 + d[4 * k + 1] + d[4 * k + 2] / 256 - 32768; e[k] = d[4 * k + 3] < 250 || v < -11000 ? NaN : v; }
    return { e, ts: bmp.width, src };
  } finally { clearTimeout(t); }
}
// Highest zoom with data at the point (Mapterhorn has national lidar at z13–z17 in some countries, Copernicus at z12).
async function mapterhornMaxZoom(lat, lng) {
  const zs = [17, 16, 15, 14, 13, 12];
  const ok = await Promise.all(zs.map(z => fetch(MAPTERHORN(z, Math.floor(tx(lng, z)), Math.floor(ty(lat, z))), { method: 'HEAD' }).then(r => r.ok, () => false)));
  const i = ok.indexOf(true); return i < 0 ? 12 : zs[i];
}

// Mosaic of tiles at zoom z covering the lat/lng box, with missing tiles filled from a parent tile.
async function mosaic(urlFn, z, box, maxUp = 4, onTile = () => {}) {
  const X0 = Math.floor(tx(box.w, z)), X1 = Math.floor(tx(box.e, z)), Y0 = Math.floor(ty(box.n, z)), Y1 = Math.floor(ty(box.s, z));
  const tiles = new Map(), jobs = [], srcs = new Set(); let done = 0, missing = 0, ts = 256;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) jobs.push([x, y]);
  if (jobs.length > 64) throw new Error('too many tiles');
  await Promise.all(jobs.map(async ([x, y]) => {
    let t = null, up = 0;
    for (; up <= maxUp && !t; up++) { try { t = await fetchTile(urlFn(z - up, x >> up, y >> up)); } catch (e) { t = null; } if (t) break; }
    onTile(++done, jobs.length);
    if (!t) { missing++; return; }
    if (t.src) srcs.add(t.src.split('/')[0]);
    ts = t.ts;
    tiles.set(x + ',' + y, up ? { ...t, up, ox: (x - ((x >> up) << up)) * t.ts / 2 ** up, oy: (y - ((y >> up) << up)) * t.ts / 2 ** up } : { ...t, up: 0, ox: 0, oy: 0 });
  }));
  if (missing === jobs.length) throw new Error('no tiles');
  // Height at global pixel (gx, gy) of zoom z (tile size ts), NaN where nothing loaded.
  const px = (gx, gy) => {
    const X = Math.floor(gx / ts), Y = Math.floor(gy / ts), t = tiles.get(X + ',' + Y); if (!t) return NaN;
    const k = 2 ** t.up, lx = Math.min(t.ts - 1, Math.floor(t.ox + (gx - X * ts) / k)), ly = Math.min(t.ts - 1, Math.floor(t.oy + (gy - Y * ts) / k));
    return t.e[ly * t.ts + lx];
  };
  return { z, ts, px, missing, total: jobs.length, srcs: [...srcs], up: Math.max(0, ...[...tiles.values()].map(t => t.up)) };
}
// Catmull-Rom bicubic sample at continuous pixel position (pixel centres at +0.5).
function bicubic(px, gx, gy) {
  gx -= 0.5; gy -= 0.5;
  const x = Math.floor(gx), y = Math.floor(gy), fx = gx - x, fy = gy - y;
  const w = t => [((-t + 2) * t - 1) * t / 2, ((3 * t - 5) * t * t + 2) / 2, ((-3 * t + 4) * t + 1) * t / 2, (t - 1) * t * t / 2];
  const wx = w(fx), wy = w(fy); let s = 0, ws = 0, near = NaN;
  for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
    const v = px(x - 1 + a, y - 1 + b); if (isNaN(v)) continue;
    const k = wx[a] * wy[b]; s += v * k; ws += k; if (a === 1 + (fx > 0.5) && b === 1 + (fy > 0.5)) near = v;
  }
  return ws > 0.5 ? s / ws : near;
}

// Elevation grid for the square |x|, |y| <= half around o. n: nodes per side.
async function load(o, half, { n = 301, onStep = () => {}, source = 'auto' } = {}) {
  const L = ATUtm.local(o), pad = 4 * 2 * half / (n - 1) + 60;
  const sw = L.ll(-half - pad, -half - pad), ne = L.ll(half + pad, half + pad), box = { w: sw.lng, s: sw.lat, e: ne.lng, n: ne.lat };
  const step = 2 * half / (n - 1), cos = Math.cos(o.lat * rad);
  const zoomFor = (ts, zmax) => {   // finest zoom up to zmax whose pixels are not much smaller than the grid, within 36 tiles
    let z = zmax;
    while (z > 8 && 40075016.686 * cos / (2 ** (z - 1) * ts) <= step * 1.01) z--;
    while (z > 8 && (Math.floor(tx(box.e, z)) - Math.floor(tx(box.w, z)) + 1) * (Math.floor(ty(box.s, z)) - Math.floor(ty(box.n, z)) + 1) > 36) z--;
    return z;
  };
  let M = null, label = '', res = 0;
  if (source !== 'terrarium') {
    try {
      onStep('Elevation · Mapterhorn');
      const zmax = await mapterhornMaxZoom(o.lat, o.lng), z = zoomFor(512, zmax);
      M = await mosaic(MAPTERHORN, z, box, 4, (d, t) => onStep(`Elevation · Mapterhorn ${d}/${t}`));
      if (M.missing > M.total * 0.1) throw new Error('gaps');
      res = zmax >= 13 ? 40075016.686 * cos / (2 ** zmax * 512) : 30;
      label = zmax >= 13 ? `Mapterhorn · national lidar (~${res < 2 ? res.toFixed(1) : Math.round(res)} m)` : 'Mapterhorn · Copernicus GLO-30 (30 m)';
    } catch (e) { M = null; }
  }
  if (!M) {
    onStep('Elevation · Terrarium');
    const z = zoomFor(256, 15);
    M = await mosaic(TERRARIUM, z, box, 4, (d, t) => onStep(`Elevation · Terrarium ${d}/${t}`));
    const s = M.srcs.join(', ');
    res = /eudem/.test(s) ? 25 : /ned|3dep|usgs/.test(s) ? 10 : /srtm/.test(s) ? 30 : 30;
    label = `Terrarium tiles${s ? ' · ' + s.replace(/eudem/, 'EU-DEM').replace(/srtm/, 'SRTM').replace(/gmted/, 'GMTED') : ''} (~${res} m)`;
  }
  const zz = new Float32Array(n * n), sc = 2 ** M.z * M.ts;
  let bad = 0, sum = 0, cnt = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ll = L.ll(-half + i * step, -half + j * step);
    const v = bicubic(M.px, (ll.lng + 180) / 360 * sc, ty(ll.lat, M.z) / 2 ** M.z * sc);
    zz[j * n + i] = v; if (isNaN(v)) bad++; else { sum += v; cnt++; }
  }
  if (!cnt) throw Object.assign(new Error('elevation'), { why: 'No elevation data was found for this place.' });
  if (bad) for (let k = 0; k < zz.length; k++) if (isNaN(zz[k])) zz[k] = sum / cnt;
  const T = { n, step, half, z: zz, src: label, res, site: { lat: o.lat, lng: o.lng } };
  return stats(T);
}
function stats(T) { let mn = Infinity, mx = -Infinity; for (const v of T.z) { if (v < mn) mn = v; if (v > mx) mx = v; } T.min = mn; T.max = mx; return T; }

// Height at local x, y on the same two triangles per cell as the mesh (diagonal (i, j)–(i+1, j+1)).
function at(T, x, y, zArr = T.z) {
  const n = T.n, gx = Math.min(n - 1.000001, Math.max(0, (x + T.half) / T.step)), gy = Math.min(n - 1.000001, Math.max(0, (y + T.half) / T.step));
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, E = (a, b) => zArr[b * n + a];
  const a = E(i, j), b = E(i + 1, j), c = E(i + 1, j + 1), d = E(i, j + 1);
  return fx >= fy ? a + fx * (b - a) + fy * (c - b) : a + fy * (d - a) + fx * (c - d);
}

// ---------- Refining for a site model ----------
// Apply fn(k, target, t) to every node within h + bank of a polyline whose heights along it are zs;
// t = 0 inside the half-width h, rising to 1 at the outer edge of the bank. Nearest line wins per call.
function corridor(T, pts, zs, h, bank, fn) {
  const n = T.n, s = T.step, best = new Map();
  for (let q = 0; q + 1 < pts.length; q++) {
    const [ax, ay] = pts[q], [bx, by] = pts[q + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9, R = h + bank;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + T.half) / s)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + R + T.half) / s));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - R + T.half) / s)), j1 = Math.min(n - 1, Math.ceil((Math.max(ay, by) + R + T.half) / s));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -T.half + i * s, y = -T.half + j * s, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const d = Math.hypot(x - ax - u * dx, y - ay - u * dy); if (d > R) continue;
      const k = j * n + i, b = best.get(k);
      if (!b || d < b.d) best.set(k, { d, z: zs[q] + u * (zs[q + 1] - zs[q]) });
    }
  }
  best.forEach((b, k) => fn(k, b.z, b.d <= h ? 0 : (b.d - h) / bank));
}
// Points every maxLen metres along a line.
function densify(pts, maxLen) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxLen));
    for (let m = 1; m <= k; m++) out.push([ax + (bx - ax) * m / k, ay + (by - ay) * m / k]);
  }
  return out;
}
const smooth01 = t => t * t * (3 - 2 * t);

// Flat platforms under buildings (at the median ground of the footprint), blended over `blend` metres.
function pads(T, buildings, blend = 4) {
  const n = T.n, s = T.step, z = T.z;
  buildings.forEach(b => {
    const r = b.outer; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    const i0 = Math.max(0, Math.floor((x0 - blend + T.half) / s)), i1 = Math.min(n - 1, Math.ceil((x1 + blend + T.half) / s));
    const j0 = Math.max(0, Math.floor((y0 - blend + T.half) / s)), j1 = Math.min(n - 1, Math.ceil((y1 + blend + T.half) / s));
    if (i1 < i0 || j1 < j0) return;
    const under = [], ring = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const p = [-T.half + i * s, -T.half + j * s];
      if (inside(p, r)) under.push(j * n + i); else { const d = distRing(p, r); if (d < blend) ring.push([j * n + i, d]); }
    }
    const samples = under.length ? under.map(k => z[k]) : r.map(([x, y]) => at(T, x, y));
    samples.sort((a, c) => a - c);
    const target = samples[samples.length >> 1];
    b.pad = target;
    under.forEach(k => z[k] = target);
    ring.forEach(([k, d]) => { const t = smooth01(d / blend); z[k] = target * (1 - t) + z[k] * t; });
  });
  return stats(T);
}
// Roads cut and filled to a bench that follows the smoothed centre-line profile.
function benches(T, roads, { shoulder = 3 } = {}) {
  roads.forEach(rd => {
    const pts = densify(rd.pts, T.step / 2); if (pts.length < 2) return;
    let zs = pts.map(([x, y]) => at(T, x, y));
    const w = Math.max(1, Math.round(20 / (T.step / 2)));   // ±20 m running mean
    const pre = [0]; zs.forEach(v => pre.push(pre[pre.length - 1] + v));
    zs = zs.map((_, i) => { const a = Math.max(0, i - w), b = Math.min(zs.length, i + w + 1); return (pre[b] - pre[a]) / (b - a); });
    corridor(T, pts, zs, rd.width / 2, shoulder, (k, zt, t) => { T.z[k] = t === 0 ? zt : zt * (1 - smooth01(t)) + T.z[k] * smooth01(t); });
  });
  return stats(T);
}
// Stream and river beds: the profile never rises downstream (OSM draws waterways downstream), cut `depth` metres.
function channels(T, ways) {
  ways.forEach(wy => {
    const pts = densify(wy.pts, T.step / 2); if (pts.length < 2) return;
    let zs = pts.map(([x, y]) => at(T, x, y)), m = Infinity;
    zs = zs.map(v => (m = Math.min(m, v)));
    zs = zs.map(v => v - wy.depth);
    corridor(T, pts, zs, wy.width / 2, Math.max(2, wy.width), (k, zt, t) => { const v = t === 0 ? zt : zt * (1 - smooth01(t)) + T.z[k] * smooth01(t); if (v < T.z[k]) T.z[k] = v; });
  });
  return stats(T);
}
// Bicubic up-sampling of the grid by an integer factor (the DEM is already sampled bicubically; this only adds nodes).
function resample(T, n2) {
  const z2 = new Float32Array(n2 * n2), step2 = 2 * T.half / (n2 - 1), n = T.n;
  const px = (i, j) => T.z[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))];
  for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) z2[j * n2 + i] = bicubic(px, i * step2 / T.step + 0.5, j * step2 / T.step + 0.5);
  return stats({ ...T, n: n2, step: step2, z: z2 });
}

// ---------- Geometry helpers ----------
function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
}
function distRing(p, r) {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    d = Math.min(d, Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy));
  }
  return d;
}
const signedArea = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

// ---------- Contours (marching squares, chained into polylines) ----------
// Returns [{ z, pts: [[x, y]], closed }] for every level base + k * interval inside the data range.
function isolines(z, n, step, half, levels) {
  const out = [], nn = n * n;
  const byLevel = new Map();
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
    const a = z[j * n + i], b = z[j * n + i + 1], c = z[(j + 1) * n + i + 1], d = z[(j + 1) * n + i];
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
    for (const L of levels(lo, hi)) {
      // Corner bits: a (SW) 1, b (SE) 2, c (NE) 4, d (NW) 8; edges: S = h(i, j), E = v(i+1, j), N = h(i, j+1), W = v(i, j).
      const m = (a >= L) | (b >= L) << 1 | (c >= L) << 2 | (d >= L) << 3; if (m === 0 || m === 15) continue;
      const S = j * n + i, E = nn + j * n + i + 1, N = (j + 1) * n + i, W = nn + j * n + i;
      let segs;
      switch (m) {
        case 1: case 14: segs = [[W, S]]; break;
        case 2: case 13: segs = [[S, E]]; break;
        case 3: case 12: segs = [[W, E]]; break;
        case 4: case 11: segs = [[E, N]]; break;
        case 6: case 9: segs = [[S, N]]; break;
        case 7: case 8: segs = [[W, N]]; break;
        case 5: case 10: {
          const ctr = (a + b + c + d) / 4 >= L;
          segs = (m === 5) === ctr ? [[W, N], [S, E]] : [[W, S], [E, N]];
          break;
        }
      }
      let g = byLevel.get(L); if (!g) byLevel.set(L, g = []);
      segs.forEach(s => g.push(s[0], s[1]));
    }
  }
  const pt = (e, L) => {
    if (e < nn) { const j = Math.floor(e / n), i = e % n, za = z[e], zb = z[e + 1], t = zb === za ? 0.5 : (L - za) / (zb - za); return [-half + (i + t) * step, -half + j * step]; }
    const k = e - nn, j = Math.floor(k / n), i = k % n, za = z[k], zb = z[k + n], t = zb === za ? 0.5 : (L - za) / (zb - za);
    return [-half + i * step, -half + (j + t) * step];
  };
  byLevel.forEach((g, L) => {
    const adj = new Map(), used = new Uint8Array(g.length / 2);
    for (let s = 0; s < g.length / 2; s++) for (const e of [g[2 * s], g[2 * s + 1]]) { const l = adj.get(e); if (l) l.push(s); else adj.set(e, [s]); }
    const other = (s, e) => g[2 * s] === e ? g[2 * s + 1] : g[2 * s];
    const walk = (s, e) => { const chain = [e]; for (;;) { used[s] = 1; e = other(s, e); chain.push(e); const nx = (adj.get(e) || []).find(t => !used[t]); if (nx === undefined) return chain; s = nx; } };
    for (let s = 0; s < g.length / 2; s++) {
      if (used[s]) continue;
      // Extend both ways from s so open lines come out whole.
      const fwd = walk(s, g[2 * s]);
      const startEnd = g[2 * s], back = (adj.get(startEnd) || []).find(t => !used[t]);
      let keys = fwd;
      if (back !== undefined) keys = walk(back, startEnd).reverse().concat(fwd.slice(1));
      const closed = keys.length > 3 && keys[0] === keys[keys.length - 1];
      out.push({ z: L, pts: keys.map(e => pt(e, L)), closed });
    }
  });
  return out;
}
const levelsEvery = (interval, base = 0) => (lo, hi) => { const r = []; for (let L = Math.ceil((lo - base) / interval) * interval + base; L <= hi; L += interval) r.push(+L.toFixed(6)); return r; };
function contours(T, interval, base = 0) { return isolines(T.z, T.n, T.step, T.half, levelsEvery(interval, base)); }

// Closed outlines of the ground at or above `level` (for a laser-cut plate): the grid is padded with a low border so
// every outline closes along the edge of the square. Returns [{ outer, holes }] in local metres.
function plateRegions(T, level, zArr = T.z) {
  const n = T.n, n2 = n + 2, low = T.min - 1e4, zp = new Float32Array(n2 * n2).fill(low);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) zp[(j + 1) * n2 + i + 1] = zArr[j * n + i];
  const lines = isolines(zp, n2, T.step, T.half + T.step, (lo, hi) => (lo < level && hi >= level ? [level] : []));
  const clamp = p => [Math.max(-T.half, Math.min(T.half, p[0])), Math.max(-T.half, Math.min(T.half, p[1]))];
  const rings = lines.filter(l => l.closed).map(l => l.pts.slice(0, -1).map(clamp)).filter(r => r.length >= 3 && Math.abs(signedArea(r)) > T.step * T.step * 0.5);
  // Outer rings enclose high ground; decide by sampling just inside each ring.
  const isOuter = r => { const c = interiorPoint(r); return c ? at(T, c[0], c[1], zArr) >= level : signedArea(r) > 0; };
  const outers = [], holes = [];
  rings.forEach(r => (isOuter(r) ? outers : holes).push(r));
  const res = outers.map(o => ({ outer: signedArea(o) > 0 ? o : o.slice().reverse(), holes: [] }));
  holes.forEach(h => { const p = h[0], hosts = res.filter(o => inside(p, o.outer)).sort((a, b) => Math.abs(signedArea(a.outer)) - Math.abs(signedArea(b.outer))); if (hosts[0]) hosts[0].holes.push(signedArea(h) < 0 ? h : h.slice().reverse()); });
  return res;
}
// A point just inside a ring (offset from the middle of its longest edge, to the inside).
function interiorPoint(r) {
  let best = -1, bi = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; bi = i; } }
  const a = r[bi], b = r[(bi + 1) % r.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = (b[0] - a[0]) / best, dy = (b[1] - a[1]) / best;
  for (const e of [0.05, 0.2, 0.5, 1]) { const off = e * Math.max(best, 0.5); for (const sgn of [1, -1]) { const p = [mx - dy * off * sgn, my + dx * off * sgn]; if (inside(p, r)) return p; } }
  return null;
}

// ---------- Analysis ----------
function analyse(T, { streamArea } = {}) {
  const n = T.n, s = T.step, z = T.z, N = n * n, E = (i, j) => z[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))];
  const slope = new Float32Array(N), aspect = new Float32Array(N), shade = new Float32Array(N);
  const az = 315 * rad, alt = 45 * rad;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // Horn's method; y grows north.
    const gx = ((E(i + 1, j + 1) + 2 * E(i + 1, j) + E(i + 1, j - 1)) - (E(i - 1, j + 1) + 2 * E(i - 1, j) + E(i - 1, j - 1))) / (8 * s);
    const gy = ((E(i - 1, j + 1) + 2 * E(i, j + 1) + E(i + 1, j + 1)) - (E(i - 1, j - 1) + 2 * E(i, j - 1) + E(i + 1, j - 1))) / (8 * s);
    const k = j * n + i, g = Math.hypot(gx, gy);
    slope[k] = Math.atan(g) / rad;
    aspect[k] = g < 1e-4 ? -1 : (Math.atan2(-gx, -gy) / rad + 360) % 360;
    const sl = Math.atan(g), asp = Math.atan2(-gx, -gy);
    shade[k] = Math.max(0, Math.cos(alt) * Math.sin(sl) * Math.cos(az - asp) + Math.sin(alt) * Math.cos(sl));
  }
  // Priority-flood fill with a small gradient, then D8 flow directions and accumulation.
  const zf = Float64Array.from(z), seen = new Uint8Array(N), heap = new Heap(zf), eps = 1e-4;
  for (let i = 0; i < n; i++) for (const j of [0, n - 1]) { const k = j * n + i; if (!seen[k]) { seen[k] = 1; heap.push(k); } }
  for (let j = 1; j < n - 1; j++) for (const i of [0, n - 1]) { const k = j * n + i; if (!seen[k]) { seen[k] = 1; heap.push(k); } }
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const order = new Int32Array(N); let oi = 0;
  while (heap.size) {
    const c = heap.pop(); order[oi++] = c; const ci = c % n, cj = (c - ci) / n;
    for (const [di, dj] of D8) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = j * n + i; if (seen[k]) continue; seen[k] = 1;
      if (zf[k] <= zf[c]) zf[k] = zf[c] + eps;
      heap.push(k);
    }
  }
  const to = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) {
    const ci = k % n, cj = (k - ci) / n; let best = 0;
    for (const [di, dj] of D8) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const q = j * n + i, d = (zf[k] - zf[q]) / Math.hypot(di, dj);
      if (d > best) { best = d; to[k] = q; }
    }
  }
  const acc = new Float32Array(N).fill(1);
  for (let m = N - 1; m >= 0; m--) { const k = order[m]; if (to[k] >= 0) acc[to[k]] += acc[k]; }   // highest first
  const twi = new Float32Array(N);
  for (let k = 0; k < N; k++) twi[k] = Math.log(acc[k] * s / Math.max(0.001, Math.tan(slope[k] * rad)));
  // Streams: cells draining at least streamArea m² (default: 1/400 of the site, at least 2 ha), traced downstream.
  const thr = (streamArea || Math.max(2e4, 4 * T.half * T.half / 400)) / (s * s);
  const isS = k => acc[k] >= thr, hasUp = new Uint8Array(N), visited = new Uint8Array(N), streams = [];
  for (let k = 0; k < N; k++) if (isS(k) && to[k] >= 0) hasUp[to[k]] = 1;
  const P = k => { const i = k % n; return [-T.half + i * s, -T.half + (k - i) / n * s]; };
  for (let k = 0; k < N; k++) {
    if (!isS(k) || hasUp[k]) continue;
    let c = k; const pts = [P(c)], flow = [acc[c]];
    while (to[c] >= 0 && !visited[c]) { visited[c] = 1; c = to[c]; pts.push(P(c)); flow.push(acc[c]); if (visited[c]) break; }
    if (pts.length > 2) streams.push({ pts, area: flow[flow.length - 1] * s * s });
  }
  // Join the remaining unvisited stream cells (below confluences) the same way.
  for (let k = 0; k < N; k++) {
    if (!isS(k) || visited[k]) continue;
    let c = k; const pts = [P(c)];
    while (to[c] >= 0 && !visited[c]) { visited[c] = 1; c = to[c]; pts.push(P(c)); }
    if (pts.length > 2) streams.push({ pts, area: acc[c] * s * s });
  }
  return { slope, aspect, shade, acc, twi, streams, filled: zf };
}
class Heap {
  constructor(key) { this.k = key; this.a = []; }
  get size() { return this.a.length; }
  push(v) { const a = this.a, k = this.k; a.push(v); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (k[a[p]] <= k[v]) break; a[i] = a[p]; i = p; } a[i] = v; }
  pop() {
    const a = this.a, k = this.k, top = a[0], last = a.pop();
    if (a.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= a.length) break; if (c + 1 < a.length && k[a[c + 1]] < k[a[c]]) c++; if (k[a[c]] >= k[last]) break; a[i] = a[c]; i = c; } a[i] = last; }
    return top;
  }
}

// Summary figures for the site report.
function report(T, A) {
  const N = T.n * T.n; let sum = 0, sl = 0; const cls = [0, 0, 0, 0, 0], asp = new Array(9).fill(0);
  const b = [5, 10, 15, 25];   // slope classes in percent: 0–5 flat, 5–10 gentle, 10–15 moderate, 15–25 steep, >25 very steep
  for (let k = 0; k < N; k++) {
    sum += T.z[k]; const p = Math.tan(A.slope[k] * rad) * 100; sl += p;
    cls[p < b[0] ? 0 : p < b[1] ? 1 : p < b[2] ? 2 : p < b[3] ? 3 : 4]++;
    asp[A.aspect[k] < 0 || p < 3 ? 8 : Math.round(A.aspect[k] / 45) % 8]++;
  }
  return { min: T.min, max: T.max, mean: sum / N, relief: T.max - T.min, meanSlope: sl / N, classes: cls.map(c => c / N), aspects: asp.map(c => c / N) };
}

window.ATTerrain = { load, at, pads, benches, channels, resample, contours, isolines, plateRegions, analyse, report, densify, inside, signedArea, interiorPoint, stats, tx, ty, fetchTile };
})();
