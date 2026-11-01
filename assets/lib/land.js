// a_tools land library for site models: one OpenStreetMap download of roads, rails, water, land cover and trees,
// multipolygons assembled from their member ways, a land-cover raster, and tree positions from OSM features and
// (optionally) Sentinel-2 vegetation. All geometry in local metres around the site (ATUtm.local).
(function () {
const rad = Math.PI / 180;

// Cover classes. Order matters when painting: later classes cover earlier ones.
const COVER = { none: 0, farmland: 1, grass: 2, park: 3, orchard: 4, vineyard: 5, scrub: 6, wood: 7, wetland: 8, sand: 9, water: 10, road: 11, building: 12 };
const COVER_NAMES = Object.keys(COVER);

const ROAD_W = { motorway: 14, trunk: 12, primary: 10, secondary: 8.5, tertiary: 7, residential: 6, unclassified: 5.5, living_street: 5,
  service: 4, pedestrian: 5, track: 3, busway: 7, road: 5, motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 5,
  footway: 2, path: 1.5, cycleway: 2, bridleway: 2, steps: 2 };
const CAR = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|busway|road)(_link)?$/;
const WATERWAY = { river: [15, 2.5], canal: [10, 2], stream: [3, 1], ditch: [1.5, 0.6], drain: [1.5, 0.6], tidal_channel: [6, 1] };
const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : null; };

// Two Overpass queries run side by side: buildings, and everything else. Smaller queries get through busy servers
// more often, and one failing still leaves the other.
function query(bb, { buildings = true, part = 'all' } = {}) {
  const head = `[out:json][timeout:90][bbox:${bb}];`;
  const B = '(way["building"];relation["building"]["type"="multipolygon"];)->.b; .b out geom;';
  const rest = `way["highway"]["highway"!~"^(proposed|construction|platform|corridor|elevator|raceway|abandoned)$"]; out geom;
    way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|preserved)$"]; out geom;
    (way["natural"~"^(water|coastline|wetland|beach|sand|bare_rock|scree)$"];relation["natural"~"^(water|wetland)$"];
     way["waterway"~"^(river|stream|canal|ditch|drain|tidal_channel|riverbank|dock)$"];relation["waterway"="riverbank"];
     way["landuse"~"^(reservoir|basin)$"];relation["landuse"="reservoir"];)->.w; .w out geom;
    (node["natural"="tree"];way["natural"="tree_row"];
     way["natural"~"^(wood|scrub|heath|grassland)$"];relation["natural"~"^(wood|scrub|heath|grassland)$"];
     way["landuse"~"^(forest|orchard|vineyard|grass|meadow|cemetery|farmland|allotments|recreation_ground|village_green|plant_nursery)$"];
     relation["landuse"~"^(forest|orchard|vineyard|meadow|farmland|grass)$"];
     way["leisure"~"^(park|garden|pitch|golf_course|nature_reserve|playground)$"];relation["leisure"~"^(park|garden|golf_course)$"];)->.g; .g out geom;`;
  if (part === 'buildings') return head + B;
  if (part === 'rest') return head + rest;
  return head + (buildings ? B : '') + rest;
}
// → { elements, osm3s, failed: ['buildings' | 'rest'] }; throws only when every part failed.
async function load(o, half, opts = {}) {
  const L = ATUtm.local(o), sw = L.ll(-half, -half), ne = L.ll(half, half);
  const bb = [sw.lat, sw.lng, ne.lat, ne.lng].map(x => x.toFixed(6)).join(',');
  const parts = opts.buildings === false ? ['rest'] : ['buildings', 'rest'];
  const res = await Promise.allSettled(parts.map(part => ATools.overpass(query(bb, { part }), 60000)));
  const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!ok.length) throw res[0].reason;
  return { elements: ok.flatMap(j => j.elements || []), osm3s: ok[0].osm3s, failed: parts.filter((_, i) => res[i].status !== 'fulfilled') };
}

// Join member ways of a multipolygon into closed rings (members are often split into several ways).
function assemble(ways) {
  const key = p => p[0].toFixed(3) + ',' + p[1].toFixed(3), rings = [];
  let open = [];
  ways.forEach(w => { if (w.length < 2) return; if (key(w[0]) === key(w[w.length - 1]) && w.length > 3) rings.push(w); else open.push(w.slice()); });
  while (open.length) {
    let cur = open.shift(), grew = true;
    while (grew && key(cur[0]) !== key(cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i], a = key(cur[cur.length - 1]);
        if (key(w[0]) === a) cur = cur.concat(w.slice(1));
        else if (key(w[w.length - 1]) === a) cur = cur.concat(w.slice().reverse().slice(1));
        else if (key(w[w.length - 1]) === key(cur[0])) cur = w.concat(cur.slice(1));
        else if (key(w[0]) === key(cur[0])) cur = w.slice().reverse().concat(cur.slice(1));
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    if (cur.length > 3) rings.push(cur);   // an unclosed ring (cut by the query box) is closed by its first point
  }
  return rings.map(r => key(r[0]) === key(r[r.length - 1]) ? r.slice(0, -1) : r);
}
const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const area = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
// Overpass element → polygons [{ outer, holes }] in local metres.
function polygons(el, P) {
  if (el.type === 'way') { if (!el.geometry || el.geometry.length < 4) return []; const r = el.geometry.map(P); r.pop(); return r.length >= 3 ? [{ outer: r, holes: [] }] : []; }
  const ms = (el.members || []).filter(m => m.type === 'way' && m.geometry);
  const outers = assemble(ms.filter(m => m.role !== 'inner').map(m => m.geometry.map(P)));
  const inners = assemble(ms.filter(m => m.role === 'inner').map(m => m.geometry.map(P)));
  const res = outers.map(r => ({ outer: r, holes: [] }));
  inners.forEach(h => { const host = res.find(p => inside(h[0], p.outer)); if (host) host.holes.push(h); });
  return res;
}

function coverClass(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.natural === 'wetland') return 'wetland';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (t.landuse === 'orchard' || t.landuse === 'plant_nursery') return 'orchard';
  if (t.landuse === 'vineyard') return 'vineyard';
  if (t.landuse === 'farmland' || t.landuse === 'allotments') return 'farmland';
  if (/^(park|garden|golf_course|nature_reserve|playground)$/.test(t.leisure || '') || t.landuse === 'cemetery' || t.landuse === 'recreation_ground' || t.landuse === 'village_green') return 'park';
  if (t.leisure === 'pitch' || t.landuse === 'grass' || t.landuse === 'meadow' || t.natural === 'grassland') return 'grass';
  if (/^(beach|sand|bare_rock|scree)$/.test(t.natural || '')) return 'sand';
  return null;
}

// Overpass JSON → layers. half: half-size of the square (to keep only what touches it).
function parse(j, o, half) {
  const L = ATUtm.local(o), P = g => L.xy(g.lat, g.lon), out = { roads: [], rails: [], waterways: [], water: [], coast: [], cover: [], trees: [], rows: [] };
  const near = pts => pts.some(([x, y]) => Math.abs(x) <= half + 50 && Math.abs(y) <= half + 50);
  j.elements.forEach(el => {
    const t = el.tags || {};
    if (t.building) return;   // buildings go through ATFabric.masses
    if (el.type === 'node') { if (t.natural === 'tree') { const p = L.xy(el.lat, el.lon); if (Math.abs(p[0]) <= half && Math.abs(p[1]) <= half) out.trees.push({ p, h: num(t.height), crown: num(t.diameter_crown), leaf: t.leaf_type, src: 'osm' }); } return; }
    if (t.highway && el.geometry) {
      const pts = el.geometry.map(P); if (!near(pts) || pts.length < 2) return;
      const k = t.highway, lanes = num(t.lanes), w = num(t.width) || (lanes && CAR.test(k) ? lanes * 3.25 + 1 : ROAD_W[k] || 3);
      out.roads.push({ pts, kind: k, width: Math.min(40, w), car: CAR.test(k), bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no', name: t.name || '', area: t.area === 'yes' });
      return;
    }
    if (t.railway && el.geometry) { const pts = el.geometry.map(P); if (near(pts)) out.rails.push({ pts, kind: t.railway, bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no' }); return; }
    if (t.natural === 'coastline' && el.geometry) { out.coast.push(el.geometry.map(P)); return; }
    if (t.natural === 'tree_row' && el.geometry) { const pts = el.geometry.map(P); if (near(pts)) out.rows.push({ pts, h: num(t.height), leaf: t.leaf_type }); return; }
    if (WATERWAY[t.waterway] && el.type === 'way' && el.geometry) {
      const pts = el.geometry.map(P); if (!near(pts)) return;
      const [w, d] = WATERWAY[t.waterway];
      out.waterways.push({ pts, kind: t.waterway, width: Math.min(200, num(t.width) || w), depth: d, tunnel: !!t.tunnel && t.tunnel !== 'no' || t.culvert === 'yes', name: t.name || '', intermittent: t.intermittent === 'yes' });
      return;
    }
    const cls = coverClass(t); if (!cls) return;
    polygons(el, P).forEach(pg => {
      if (!near(pg.outer)) return;
      if (cls === 'water') out.water.push({ ...pg, name: t.name || '' });
      else out.cover.push({ ...pg, cls, leaf: t.leaf_type });
    });
  });
  out.sea = out.coast.length ? ATFabric.seaRings(out.coast, half) : [];
  return out;
}

// Land-cover raster (size × size, row 0 = north) painted from the layers; buildings and roads on top.
function raster(layers, buildings, half, size) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = c.getContext('2d', { willReadFrequently: true }), k = size / (2 * half);
  const X = x => (x + half) * k, Y = y => (half - y) * k;
  const fill = (pg, v) => { g.beginPath(); [pg.outer, ...(pg.holes || [])].forEach(r => { r.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.closePath(); }); g.fillStyle = `rgb(${v * 20},0,0)`; g.fill('evenodd'); };
  g.fillStyle = 'rgb(0,0,0)'; g.fillRect(0, 0, size, size);
  const order = ['farmland', 'grass', 'park', 'orchard', 'vineyard', 'scrub', 'wood', 'wetland', 'sand'];
  order.forEach(cl => layers.cover.filter(p => p.cls === cl).forEach(p => fill(p, COVER[cl])));
  layers.sea.forEach(p => fill(p, COVER.water));
  layers.water.forEach(p => fill(p, COVER.water));
  g.lineCap = 'round'; g.lineJoin = 'round';
  layers.waterways.filter(w => !w.tunnel).forEach(w => { g.strokeStyle = `rgb(${COVER.water * 20},0,0)`; g.lineWidth = Math.max(1, w.width * k); g.beginPath(); w.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); });
  layers.roads.filter(r => !r.tunnel).forEach(r => { g.strokeStyle = `rgb(${COVER.road * 20},0,0)`; g.lineWidth = Math.max(1, r.width * k); g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); });
  buildings.forEach(b => fill({ outer: b.outer, holes: b.holes }, COVER.building));
  const d = g.getImageData(0, 0, size, size).data, cls = new Uint8Array(size * size);
  // Canvas paths are anti-aliased: an edge pixel blends two codes. Keep a pixel only when it is an exact code
  // (multiples of 20) that a neighbour shares; blended edge pixels become "none".
  for (let q = 0; q < cls.length; q++) {
    const v = d[4 * q]; if (v % 20) continue;
    const i = q % size, same = (i > 0 && d[4 * (q - 1)] === v) || (i < size - 1 && d[4 * (q + 1)] === v) || (q >= size && d[4 * (q - size)] === v) || (q < cls.length - size && d[4 * (q + size)] === v);
    if (same) cls[q] = v / 20;
  }
  return { size, half, cls, at: (x, y) => { const i = Math.floor((x + half) * k), j = Math.floor((half - y) * k); return i < 0 || j < 0 || i >= size || j >= size ? 0 : cls[j * size + i]; } };
}

// Deterministic pseudo-random number in [0, 1) from a position.
const hash = (x, y, s = 0) => { let h = Math.imul(Math.round(x * 10) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(Math.round(y * 10) + s * 7919, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };

// Trees and shrubs: [{ x, y, h, r, kind: 'broad' | 'conifer' | 'shrub', src: 'osm' | 'cover' | 'satellite' }].
// cover: the raster; s2: ATSentinel result or null; max: cap on the count (spacing grows to fit).
function trees(layers, cover, half, { s2 = null, max = 50000, satellite = true } = {}) {
  const out = [], code = COVER;
  layers.trees.forEach(t => { const [x, y] = t.p, h = t.h || 7 + 4 * hash(x, y), r = (t.crown || h * 0.7) / 2; out.push({ x, y, h, r, kind: t.leaf === 'needleleaved' ? 'conifer' : 'broad', src: 'osm' }); });
  layers.rows.forEach(rw => ATTerrain.densify(rw.pts, 7).forEach(([x, y]) => { if (Math.abs(x) > half || Math.abs(y) > half) return; const h = rw.h || 7 + 4 * hash(x, y); out.push({ x, y, h, r: h * 0.33, kind: rw.leaf === 'needleleaved' ? 'conifer' : 'broad', src: 'osm' }); }));
  const ndvi = (x, y) => { if (!s2) return NaN; const i = Math.floor((x + s2.half) / s2.step), j = Math.floor((s2.half - y) / s2.step); return i < 0 || j < 0 || i >= s2.n || j >= s2.n ? NaN : s2.ndvi[j * s2.n + i]; };
  // Expected count at base spacings, to scale spacing under the cap.
  const base = { wood: 7, scrub: 4.5, orchard: 6, vineyard: 3, park: 9, sat: 7.5 };
  const tally = {}; let est = 0; const cs = cover.size, cell = (2 * half / cs) ** 2;
  for (let q = 0; q < cs * cs; q++) {
    const v = cover.cls[q]; const name = v === code.wood ? 'wood' : v === code.scrub ? 'scrub' : v === code.orchard ? 'orchard' : v === code.vineyard ? 'vineyard' : v === code.park ? 'park' : null;
    if (name) tally[name] = (tally[name] || 0) + cell;
  }
  Object.entries(tally).forEach(([k, a]) => est += a / base[k] ** 2 * (k === 'park' ? 0.25 : 1));
  if (s2 && satellite) { let sat = 0; for (const v of s2.ndvi) if (v > 0.5) sat++; est += sat * s2.step * s2.step / base.sat ** 2 * 0.6; }
  const f = Math.max(1, Math.sqrt(est / Math.max(1, max - out.length)));
  const conif = new Set(layers.cover.filter(p => p.leaf === 'needleleaved').map(p => p));
  const isConifer = (x, y) => { for (const p of conif) if (inside([x, y], p.outer)) return true; return false; };
  const grid = (sp, fn) => { for (let y = -half + sp / 2; y < half; y += sp) for (let x = -half + sp / 2; x < half; x += sp) { const jx = x + (hash(x, y, 1) - 0.5) * sp * 0.8, jy = y + (hash(x, y, 2) - 0.5) * sp * 0.8; fn(jx, jy, x, y); } };
  // Woods, scrub and parks from OSM.
  grid(base.wood * f, (x, y) => {
    const v = cover.at(x, y);
    if (v === code.wood) { const h = 9 + 7 * hash(x, y, 3); out.push({ x, y, h, r: h * (0.3 + 0.08 * hash(x, y, 4)), kind: conif.size && isConifer(x, y) ? 'conifer' : 'broad', src: 'cover' }); }
    else if (v === code.park && hash(x, y, 5) < 0.25) { const h = 7 + 6 * hash(x, y, 3); out.push({ x, y, h, r: h * 0.36, kind: 'broad', src: 'cover' }); }
  });
  grid(base.scrub * f, (x, y) => { if (cover.at(x, y) === code.scrub && hash(x, y, 6) < 0.7) { const h = 1.2 + 1.8 * hash(x, y, 3); out.push({ x, y, h, r: h * 0.6, kind: 'shrub', src: 'cover' }); } });
  // Orchards and vineyards in rows (no row direction in OSM: east–west).
  const rowGrid = (sx, sy, cls, mk) => { for (let y = -half + sy / 2; y < half; y += sy) for (let x = -half + sx / 2; x < half; x += sx) if (cover.at(x, y) === cls) out.push(mk(x, y)); };
  rowGrid(base.orchard * f, base.orchard * f, code.orchard, (x, y) => { const h = 3.5 + 1.5 * hash(x, y, 3); return { x, y, h, r: h * 0.45, kind: 'broad', src: 'cover' }; });
  rowGrid(base.vineyard * f * 0.7, base.vineyard * f, code.vineyard, (x, y) => ({ x, y, h: 1.4, r: 0.7, kind: 'shrub', src: 'cover' }));
  // Satellite: dense green where OSM maps nothing (or a park, or grass), never on fields, roads, roofs or water.
  if (s2 && satellite) grid(base.sat * f, (x, y) => {
    const v = cover.at(x, y); if (v !== code.none && v !== code.park && v !== code.grass) return;
    const nd = ndvi(x, y); if (!(nd > 0.5)) return;
    if (hash(x, y, 7) > Math.min(1, (nd - 0.5) / 0.2) * 0.8) return;
    if (v === code.park && hash(x, y, 5) < 0.25) return;   // already placed above
    const h = 6 + 7 * hash(x, y, 3); out.push({ x, y, h, r: h * 0.36, kind: 'broad', src: 'satellite' });
  });
  return out.slice(0, Math.max(max, layers.trees.length));
}

window.ATLand = { COVER, COVER_NAMES, ROAD_W, query, load, parse, assemble, polygons, raster, trees, hash, area, inside };
})();
