// Terrain Model: builds a 3D site model from open data and exports it. See ../../README.md for data sources.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = id => document.getElementById(id);
const rad = Math.PI / 180;
let site = ATools.getSite() || { lat: 40.1467, lng: 26.4086, name: 'Çanakkale' };
let SIZE = 1000, DETAIL = 401;
let M = null;   // the built model

// ---------- Site picker ----------
const pick = ATools.baseMap('pick', [site.lat, site.lng], 14);
const marker = L.circleMarker([site.lat, site.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#c8553d', fillOpacity: 1 }).addTo(pick);
const square = L.rectangle([[0, 0], [0, 0]], { color: '#1b1b19', weight: 1.2, fill: true, fillOpacity: 0.04, dashArray: '5 4' }).addTo(pick);
function drawSquare() {
  const h = SIZE / 2, Lc = ATUtm.local(site), a = Lc.ll(-h, -h), b = Lc.ll(h, h);
  square.setBounds([[a.lat, a.lng], [b.lat, b.lng]]);
}
function setSite(s, save = true) {
  site = s; marker.setLatLng([s.lat, s.lng]); drawSquare();
  $('where').textContent = (s.name ? s.name + ' · ' : '') + s.lat.toFixed(5) + ', ' + s.lng.toFixed(5);
  if (save) ATools.setSite(s);
}
setSite(site, false);
pick.fitBounds(square.getBounds(), { padding: [12, 12] });
pick.on('click', e => setSite({ lat: e.latlng.lat, lng: e.latlng.lng }));
$('go').onclick = async () => {
  const q = $('q').value.trim(); if (!q) return;
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) { setSite({ lat: +m[1], lng: +m[2] }); pick.fitBounds(square.getBounds(), { padding: [12, 12] }); return; }
  try { const s = await ATools.geocode(q); if (!s) return alert('Place not found.'); setSite(s); pick.fitBounds(square.getBounds(), { padding: [12, 12] }); }
  catch { alert('Search failed. Tap the map instead.'); }
};
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') $('go').click(); });

function seg(id, fn) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v);
  }));
}
const segVal = id => (document.querySelector(`#${id} button.on`) || {}).dataset?.v;
seg('size', v => { SIZE = +v; drawSquare(); pick.fitBounds(square.getBounds(), { padding: [12, 12] }); scaleOptions(); });
seg('detail', v => { DETAIL = +v; });
seg('dlTab', v => document.querySelectorAll('.dl').forEach(d => d.hidden = d.dataset.tab !== v));

// ---------- Progress card ----------
const STEPS = [['dem', 'Elevation'], ['osm', 'OpenStreetMap: roads, water, land cover'], ['ovt', 'Overture Maps: buildings traced from imagery'], ['ghsl', 'Building heights (GHSL)'], ['s2', 'Sentinel-2: image and vegetation'],
  ['hist', 'Water history 1984–2021 (JRC)'], ['shape', 'Shaping the ground'], ['analyse', 'Slope, aspect and flow'], ['assemble', 'Assembling the 3D model']];
let prog = {};
function progress(title) {
  prog = {}; const el = $('progress'); el.hidden = false; $('empty').hidden = true;
  el.innerHTML = `<h3>${title}<span id="pPct">0%</span></h3><div class="bar"><i id="pBar"></i></div><ol>${STEPS.map(([k, t]) => `<li id="p-${k}"><span>${t}</span><em></em></li>`).join('')}</ol>`;
}
function step(k, state, note = '') {
  prog[k] = state; const li = $('p-' + k); if (!li) return;
  li.className = state; if (note !== null) li.querySelector('em').textContent = note;
  const done = STEPS.filter(([s]) => /ok|skip|fail/.test(prog[s] || '')).length;
  $('pBar').style.width = Math.round(100 * done / STEPS.length) + '%'; $('pPct').textContent = Math.round(100 * done / STEPS.length) + '%';
}

// ---------- Water history (JRC Global Surface Water occurrence tiles, z13) ----------
async function waterHistory(o, half, size = 512) {
  const z = 13, Lc = ATUtm.local(o), a = Lc.ll(-half, -half), b = Lc.ll(half, half);
  const X0 = Math.floor(ATTerrain.tx(a.lng, z)), X1 = Math.floor(ATTerrain.tx(b.lng, z)), Y0 = Math.floor(ATTerrain.ty(b.lat, z)), Y1 = Math.floor(ATTerrain.ty(a.lat, z));
  if ((X1 - X0 + 1) * (Y1 - Y0 + 1) > 30) throw new Error('too many tiles');
  const tiles = new Map();
  await Promise.all([...Array((X1 - X0 + 1) * (Y1 - Y0 + 1))].map(async (_, k) => {
    const x = X0 + k % (X1 - X0 + 1), y = Y0 + Math.floor(k / (X1 - X0 + 1));
    const r = await fetch(`https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/${z}/${x}/${y}.png`);
    if (!r.ok) return;   // no water at all in that tile
    const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(256, 256), g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    tiles.set(x + ',' + y, g.getImageData(0, 0, 256, 256).data);
  }));
  const occ = new Uint8Array(size * size), st = 2 * half / size; let any = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const ll = Lc.ll(-half + (i + 0.5) * st, half - (j + 0.5) * st), gx = ATTerrain.tx(ll.lng, z), gy = ATTerrain.ty(ll.lat, z);
    const t = tiles.get(Math.floor(gx) + ',' + Math.floor(gy)); if (!t) continue;
    const px = Math.floor((gx % 1) * 256), py = Math.floor((gy % 1) * 256), al = t[4 * (py * 256 + px) + 3];
    occ[j * size + i] = Math.round(al / 255 * 100); if (al) any++;
  }
  return { size, half, occ, any };
}

// ---------- Build ----------
const lineInBox = (pts, h) => pts.some(([x, y]) => Math.abs(x) <= h && Math.abs(y) <= h);
async function build() {
  const o = { ...site }, half = SIZE / 2, want = { b: $('dBuild').checked, r: $('dRoads').checked, w: $('dWater').checked, t: $('dTrees').checked, s: $('dSat').checked, h: $('dHist').checked };
  $('build').disabled = true; $('status').textContent = '';
  progress(`Building model · ${SIZE >= 1000 ? SIZE / 1000 + ' km' : SIZE + ' m'} square`);
  const n = SIZE <= 500 && DETAIL > 401 ? 401 : DETAIL;
  step('dem', 'run');
  const dem = ATTerrain.load(o, half, { n, onStep: s => step('dem', 'run', s) }).then(T => { step('dem', 'ok', `${T.src.split(' (')[0]} · ${n}×${n}`); return T; }, e => { step('dem', 'fail', e.why || e.message); throw e; });
  const needOsm = want.b || want.r || want.w || want.t;
  if (needOsm) step('osm', 'run'); else step('osm', 'skip', 'off');
  const osm = needOsm ? ATLand.load(o, half, { buildings: want.b }).then(j => { step('osm', j.failed.length ? 'fail' : 'ok', `${j.elements.length.toLocaleString('en-US')} features` + (j.failed.length ? ` · ${j.failed.join(', ')} not reached` : '')); return j; }, e => { step('osm', 'fail', e.why || 'not reached'); return null; }) : Promise.resolve(null);
  // Overture Maps: buildings OpenStreetMap lacks (traced from satellite imagery), and roads, water and land cover when OpenStreetMap is not reached.
  const themes = [want.b && 'buildings', want.r && 'transportation', (want.w || want.t) && 'base'].filter(Boolean);
  if (themes.length) step('ovt', 'run'); else step('ovt', 'skip', 'off');
  const ovt = themes.length ? ATOverture.load(o, half, { themes, onStep: s => step('ovt', 'run', s) }).then(r => { step('ovt', 'ok', `${r.release.slice(0, 10)} · ${(r.counts.buildings || 0).toLocaleString('en-US')} buildings`); return r; }, e => { step('ovt', 'fail', e.why || 'not reached'); return null; }) : Promise.resolve(null);
  if (want.b) step('ghsl', 'run'); else step('ghsl', 'skip', 'off');
  const ghsl = want.b ? ATGhsl.load(o, half).then(g => { step('ghsl', 'ok', g.cells ? `median ${g.median.toFixed(0)} m` : 'no built cells'); return g.cells ? g : null; }, () => { step('ghsl', 'fail', 'not reached'); return null; }) : Promise.resolve(null);
  if (want.s) step('s2', 'run'); else step('s2', 'skip', 'off');
  const s2 = want.s ? ATSentinel.load(o, half, { onStep: s => step('s2', 'run', s) }).then(r => { step('s2', 'ok', `${r.date} · cloud ${Math.round(r.siteCloud * 100)}% on site`); return r; }, e => { step('s2', 'fail', e.why || 'not reached'); return null; }) : Promise.resolve(null);
  if (want.h) step('hist', 'run'); else step('hist', 'skip', 'off');
  const hist = want.h ? waterHistory(o, half).then(r => { step('hist', 'ok', r.any ? 'water found' : 'no water recorded'); return r; }, () => { step('hist', 'fail', 'not reached'); return null; }) : Promise.resolve(null);

  let T0;
  try { T0 = await dem; } catch (e) { $('status').textContent = 'Could not load the elevation. ' + (e.why || 'Try again in a minute.'); $('build').disabled = false; $('progress').hidden = true; if (!M) $('empty').hidden = false; return; }
  const [jo, OV, G, S2, H] = await Promise.all([osm, ovt, ghsl, s2, hist]);
  const j = mergeSources(jo, OV, o, half);
  await tick();

  // Layers from OSM.
  step('shape', 'run');
  const lay = j ? ATLand.parse(j, o, half) : { roads: [], rails: [], waterways: [], water: [], coast: [], cover: [], trees: [], rows: [], sea: [] };
  if (j && !lay.sea.length && j.sea.length) { const Lc = ATUtm.local(o), P = r => r.map(([lng, lat]) => Lc.xy(lat, lng)); lay.sea = j.sea.map(pg => ({ outer: P(pg.outer), holes: pg.holes.map(P) })); }
  if (!want.r) { lay.roads = []; lay.rails = []; }
  if (!want.w) { lay.water = []; lay.waterways = []; lay.sea = []; }
  if (!want.t) { lay.trees = []; lay.rows = []; }
  const T = { ...T0, z: Float32Array.from(T0.z) };
  // Sea: flat at sea level (some elevation tiles carry the sea floor).
  if (lay.sea.length) for (let jj = 0; jj < T.n; jj++) for (let i = 0; i < T.n; i++) {
    const p = [-half + i * T.step, -half + jj * T.step];
    if (lay.sea.some(r => ATLand.inside(p, r.outer) && !r.holes.some(h => ATLand.inside(p, h)))) T.z[jj * T.n + i] = 0;
  }
  ATTerrain.stats(T);
  const shaped = [];
  if ($('rBench').checked && lay.roads.length) { ATTerrain.benches(T, lay.roads.filter(r => r.car && !r.bridge && !r.tunnel && !r.area).map(r => ({ pts: r.pts, width: r.width }))); shaped.push('road benches'); }
  if ($('rChan').checked && lay.waterways.length) { ATTerrain.channels(T, lay.waterways.filter(w => !w.tunnel)); shaped.push('stream beds'); }
  const massOpts = () => ({ defH: 9, floorH: 3, ground: (x, y) => ATTerrain.at(T, x, y), ghsl: G });
  // Buildings cut to the square, so the model has a clean edge.
  const cut = bs => bs.map(b => ({ ...b, outer: clipSquare(b.outer, half), holes: b.holes.map(h => clipSquare(h, half)).filter(h => h.length >= 3 && Math.abs(ATTerrain.signedArea(h)) > 1) }))
    .filter(b => b.outer.length >= 3 && Math.abs(ATTerrain.signedArea(b.outer)) > 2);
  let buildings = j && want.b ? cut(ATFabric.masses(j, o, half, massOpts())) : [];
  if ($('rPads').checked && buildings.length) { ATTerrain.pads(T, buildings, Math.max(2, T.step * 1.5)); buildings = cut(ATFabric.masses(j, o, half, massOpts())); shaped.push('building pads'); }
  step('shape', 'ok', shaped.join(', ') || 'as measured');
  await tick();

  step('analyse', 'run');
  // Slope, aspect, wetness and flow describe the natural ground, before pads, benches and beds.
  const A = ATTerrain.analyse(T0);
  const rep = ATTerrain.report(T0, A);
  step('analyse', 'ok', `${A.streams.length} flow lines`);
  await tick();

  step('assemble', 'run');
  const cover = ATLand.raster(lay, buildings, half, 1024);
  const trees = want.t ? ATLand.trees(lay, cover, half, { s2: S2, max: SIZE >= 3000 ? 60000 : 45000 }) : [];
  M = { site: o, half, T, T0, A, rep, lay, buildings, trees, cover, s2: S2, hist: H, ghsl: G, osmTime: j && j.osm3s ? j.osm3s.timestamp_osm_base : '', from: j ? j.from : {}, overture: OV ? OV.release : '', built: new Date() };
  M.interval = autoInterval(rep.relief);
  buildScene();
  step('assemble', 'ok', `${buildings.length.toLocaleString('en-US')} buildings · ${trees.length.toLocaleString('en-US')} trees`);
  report(); legend(); scaleOptions(true);
  document.querySelectorAll('[data-x]').forEach(b => b.disabled = false);
  $('build').disabled = false;
  const osmGone = needOsm && (!jo || jo.failed.length), miss = [j || !needOsm ? '' : 'OpenStreetMap and Overture', S2 || !want.s ? '' : 'Sentinel-2'].filter(Boolean);
  $('status').textContent = `Model ready.` + (osmGone && OV ? ' OpenStreetMap did not answer, so roads, water and land cover come from Overture Maps.' : '') +
    (miss.length ? ` ${miss.join(' and ')} could not be loaded, so the model has less detail. Press "Build model" again to retry.` : '');
  setTimeout(() => { $('progress').hidden = true; }, miss.length || osmGone ? 2500 : 700);
  ATools.track('terrain-model/build/' + SIZE);
}
const tick = () => new Promise(r => setTimeout(r, 0));

// OpenStreetMap first. Overture adds the buildings OSM does not have (a footprint whose middle is not inside an OSM
// building), and stands in for roads, water and land cover when the OSM query for them failed.
function mergeSources(jo, ov, o, half) {
  if (!jo && !ov) return null;
  const osmEls = jo ? jo.elements : [], restOk = jo && !jo.failed.includes('rest'), bldOk = jo && !jo.failed.includes('buildings');
  const isB = e => e.tags && e.tags.building, ovEls = ov ? ov.elements : [];
  const out = [...osmEls], from = { osmBuildings: osmEls.filter(isB).length, overtureBuildings: 0, overtureLayers: false };
  // Grid of OSM building outlines (local metres) for the inside test.
  const Lc = ATUtm.local(o), cell = 50, grid = new Map(), key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  osmEls.filter(isB).forEach(e => (e.type === 'way' ? [e.geometry] : (e.members || []).filter(m => m.role !== 'inner').map(m => m.geometry)).forEach(g => {
    if (!g || g.length < 4) return; const r = g.map(q => Lc.xy(q.lat, q.lon)), xs = r.map(p => p[0]), ys = r.map(p => p[1]);
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++) for (let y = Math.floor(Math.min(...ys) / cell); y <= Math.floor(Math.max(...ys) / cell); y++) { const k = x + ',' + y; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r); }
  }));
  ovEls.forEach(e => {
    const t = e.tags || {};
    if (t.building) {
      const g = e.type === 'way' ? e.geometry : e.members[0].geometry, r = g.map(q => Lc.xy(q.lat, q.lon));
      const c = ATTerrain.interiorPoint(r) || r[0];
      if (bldOk && (grid.get(key(c[0], c[1])) || []).some(rr => ATLand.inside(c, rr))) return;
      out.push(e); from.overtureBuildings++;
    } else if (!restOk) { if (t['overture:cover'] && osmEls.length) return; out.push(e); from.overtureLayers = true; }
  });
  return { elements: out, osm3s: jo && jo.osm3s, sea: !restOk && ov ? ov.sea : [], from };
}
function autoInterval(relief) { for (const c of [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200]) if (relief / c <= 45) return c; return 250; }
const contourInterval = () => { const v = $('cInt').value; return v === 'auto' ? M.interval : +v; };

// ---------- Styles ----------
const STYLE = {
  clay: { bg: '#e9e7e1', ground: '#efece6', cover: { farmland: '#ebe8e0', grass: '#e9e9e1', park: '#e6e7dd', orchard: '#e8e8de', vineyard: '#ebe7df', scrub: '#e6e6dc', wood: '#e3e4d9', wetland: '#e4e8e6', sand: '#f2efe6' },
    water: '#cdd8de', waterLine: '#b3c4cd', road: '#faf9f5', roadEdge: '#d6d2c8', path: '#dcd8cf', rail: '#9b978e', contour: 'rgba(70,66,58,0.28)', index: 'rgba(70,66,58,0.55)', build: '#d8d4ca',
    house: '#fbfaf7', tree: '#f4f3ee', conifer: '#efeee8', shrub: '#f1f0ea', base: '#d9d5cc', section: '#3b3934' },
  atlas: { bg: '#e8e6df', ground: '#f0eee6', cover: { farmland: '#ebe5cf', grass: '#e0e6cf', park: '#d4dfc2', orchard: '#d8dfbd', vineyard: '#e3dbc3', scrub: '#d2dbbb', wood: '#c1cfac', wetland: '#d2e0da', sand: '#eee4c9' },
    water: '#b3cad8', waterLine: '#8fb0c6', road: '#ffffff', roadEdge: '#cbc5b7', path: '#cfc8b8', rail: '#8a857a', contour: 'rgba(120,98,60,0.30)', index: 'rgba(120,98,60,0.60)', build: '#cfc9bb',
    house: '#f3f0e9', tree: '#9db08a', conifer: '#7f9a78', shrub: '#b7c39c', base: '#cfcabf', section: '#4a4337' },
  ink: { bg: '#f1f0ec', ground: '#fbfaf7', cover: { farmland: '#fbfaf7', grass: '#fbfaf7', park: '#f4f4f1', orchard: '#f4f4f1', vineyard: '#f4f4f1', scrub: '#f1f1ee', wood: '#ececea', wetland: '#f1f3f3', sand: '#fbfaf7' },
    water: '#e3e7ea', waterLine: '#1b1b19', road: '#ffffff', roadEdge: '#1b1b19', path: '#5c5b57', rail: '#1b1b19', contour: 'rgba(27,27,25,0.35)', index: 'rgba(27,27,25,0.75)', build: '#1b1b19',
    house: '#ffffff', tree: '#ffffff', conifer: '#ffffff', shrub: '#ffffff', base: '#ffffff', section: '#1b1b19' },
};
STYLE.sat = { ...STYLE.atlas, contour: 'rgba(255,255,255,0.35)', index: 'rgba(255,255,255,0.7)', road: 'rgba(255,255,255,0.85)', roadEdge: 'rgba(0,0,0,0.25)', tree: '#56704a', conifer: '#45603f', shrub: '#6f8656', house: '#ebe9e4', base: '#cfcabf' };
const sty = () => STYLE[segVal('style')] || STYLE.clay;

// Analysis maps: class breaks and muted ramps; dominant classes stay pale.
const MAPS = {
  elev: { title: 'Elevation, m', ramp: ['#eef1e6', '#e1e7d2', '#e9e2c7', '#e2d2b3', '#d4bd9f', '#c4a993', '#b19d98'] },
  slope: { title: 'Slope, %', breaks: [5, 10, 15, 25, 35], labels: ['0–5 flat', '5–10 gentle', '10–15 moderate', '15–25 steep', '25–35 very steep', '> 35 extreme'], ramp: ['#f5f2e9', '#e8dfc4', '#dac39a', '#c99f6e', '#b07448', '#85492f'] },
  aspect: { title: 'Aspect (facing)', labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'Flat'], ramp: ['#9fb3c8', '#a9c2b7', '#c4cfa4', '#e2cf96', '#ecb98a', '#e2a493', '#c3a2b4', '#a6a8c4', '#f1efe8'] },
  wet: { title: 'Wetness index (TWI)', breaks: [4, 6, 8, 10, 12], labels: ['< 4 dry', '4–6', '6–8', '8–10', '10–12', '> 12 wet'], ramp: ['#f4f1e8', '#e2e7e2', '#c7d8df', '#a3c2d4', '#7aa6c4', '#4f7fa8'] },
  ndvi: { title: 'Vegetation (NDVI)', breaks: [0.1, 0.25, 0.4, 0.55, 0.7], labels: ['< 0.1 bare, built', '0.1–0.25', '0.25–0.4', '0.4–0.55', '0.55–0.7', '> 0.7 dense'], ramp: ['#f1eee6', '#e7e5cf', '#d5dcb4', '#b9cc95', '#94b276', '#6d915a'] },
  hist: { title: 'Water history, % of months', breaks: [10, 50, 90], labels: ['< 10 rare', '10–50 seasonal', '50–90 frequent', '> 90 permanent'], ramp: ['#d9e6ee', '#a9c6da', '#6f9ec0', '#3f6f97'] },
};
const classOf = (v, b) => { let k = 0; while (k < b.length && v >= b[k]) k++; return k; };
function elevBreaks() { const T = M.T, c = 7, s = (T.max - T.min) / c; return [...Array(c - 1)].map((_, k) => T.min + s * (k + 1)); }
// Colour of the analysis map at grid node k (or null).
function mapColor(kind) {
  const T = M.T, A = M.A;
  if (kind === 'elev') { const b = elevBreaks(); return k => MAPS.elev.ramp[classOf(T.z[k], b)]; }
  if (kind === 'slope') return k => MAPS.slope.ramp[classOf(Math.tan(A.slope[k] * rad) * 100, MAPS.slope.breaks)];
  if (kind === 'aspect') return k => MAPS.aspect.ramp[A.aspect[k] < 0 || Math.tan(A.slope[k] * rad) < 0.03 ? 8 : Math.round(A.aspect[k] / 45) % 8];
  if (kind === 'wet') return k => MAPS.wet.ramp[classOf(A.twi[k], MAPS.wet.breaks)];
  return null;
}

// ---------- Plan painting (texture for the 3D ground and the plan PNG) ----------
function paint(px, { trees = false, buildings = true } = {}) {
  const st = sty(), half = M.half, k = px / (2 * half), T = M.T, A = M.A;
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d');
  const X = x => (x + half) * k, Y = y => (half - y) * k;
  const path = (r) => { r.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); };
  const poly = (pg, fill) => { g.beginPath(); [pg.outer, ...(pg.holes || [])].forEach(r => { path(r); g.closePath(); }); g.fillStyle = fill; g.fill('evenodd'); };
  const kind = $('mapOn').value, style = segVal('style');
  g.fillStyle = st.ground; g.fillRect(0, 0, px, px);
  const L = M.lay;
  // Base: satellite image, analysis map or land cover.
  const grid = (fn, n, cell, flipY) => {   // draw an n × n colour grid; flipY: rows from the south
    const cv = document.createElement('canvas'); cv.width = cv.height = n; const cg = cv.getContext('2d'), im = cg.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const col = fn(i, flipY ? n - 1 - j : j); if (!col) continue; const q = 4 * (j * n + i); im.data[q] = col[0]; im.data[q + 1] = col[1]; im.data[q + 2] = col[2]; im.data[q + 3] = col[3] == null ? 255 : col[3]; }
    cg.putImageData(im, 0, 0); g.imageSmoothingEnabled = cell; g.drawImage(cv, 0, 0, px, px);
  };
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const satOK = style === 'sat' && M.s2 && M.s2.rgb;
  if (satOK) { const s = M.s2; grid((i, j) => { const q = 4 * (j * s.n + i); return [s.rgb[q], s.rgb[q + 1], s.rgb[q + 2], s.rgb[q + 3]]; }, s.n, true); }
  else {
    ['farmland', 'grass', 'park', 'orchard', 'vineyard', 'scrub', 'wood', 'wetland', 'sand'].forEach(cl => L.cover.filter(p => p.cls === cl).forEach(p => poly(p, st.cover[cl])));
  }
  const mc = mapColor(kind);
  if (mc) { const cache = {}; grid((i, j) => { const col = mc(j * T.n + i); return cache[col] || (cache[col] = [...hex(col), 235]); }, T.n, true, true); }
  if (kind === 'ndvi' && M.s2) { const s = M.s2, m = MAPS.ndvi; grid((i, j) => { const v = s.ndvi[j * s.n + i]; return isNaN(v) ? null : [...hex(m.ramp[classOf(v, m.breaks)]), 235]; }, s.n, false); }
  if ($('sShade').checked) {
    g.globalCompositeOperation = 'multiply';
    grid((i, j) => { const v = Math.round(255 * Math.min(1, 0.55 + 0.5 * A.shade[j * T.n + i])); return [v, v, v, 255]; }, T.n, true, true);
    g.globalCompositeOperation = 'source-over';
  }
  // Water.
  if ($('sWater').checked) {
    L.sea.forEach(p => poly(p, st.water)); L.water.forEach(p => poly(p, st.water));
    if (kind === 'hist' && M.hist) { const h = M.hist, m = MAPS.hist; grid((i, j) => { const v = h.occ[j * h.size + i]; return v ? [...hex(m.ramp[classOf(v, m.breaks)]), 230] : null; }, h.size, false); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    L.waterways.filter(w => !w.tunnel).forEach(w => { g.beginPath(); path(w.pts); g.strokeStyle = st.water; g.lineWidth = Math.max(1, w.width * k); g.stroke(); if (style === 'ink') { g.strokeStyle = st.waterLine; g.lineWidth = 1; g.stroke(); } });
    if (style === 'ink') { g.strokeStyle = st.waterLine; g.lineWidth = 1.2; L.coast.forEach(cl => { g.beginPath(); path(cl); g.stroke(); }); }
  }
  // Flow lines from the terrain analysis.
  if ($('sFlow').checked) {
    g.strokeStyle = style === 'sat' ? 'rgba(170,215,255,0.9)' : '#5f8fb5'; g.lineCap = 'round'; g.lineJoin = 'round';
    A.streams.forEach(s => { g.beginPath(); path(s.pts); g.lineWidth = Math.max(1, Math.log10(s.area / 1e4 + 1) * 3 * px / 2048); g.stroke(); });
  }
  // Contours.
  const ci = contourInterval();
  if (ci > 0) {
    const lines = ATTerrain.contours(T, ci); M.contours = lines;
    lines.forEach(l => { const idx = Math.abs(l.z / (ci * 5) - Math.round(l.z / (ci * 5))) < 1e-6; g.beginPath(); path(l.pts); g.strokeStyle = idx ? st.index : st.contour; g.lineWidth = (idx ? 1.6 : 0.9) * Math.max(1, px / 3000); g.stroke(); });
  } else M.contours = [];
  // Roads and rails.
  if ($('sRoads').checked) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    const rs = L.roads.filter(r => !r.tunnel && !r.area).sort((a, b) => a.width - b.width);
    const edge = Math.max(1, 1.2 * px / 4096 * 2);
    rs.forEach(r => { g.beginPath(); path(r.pts); g.strokeStyle = r.car ? st.roadEdge : st.path; g.lineWidth = Math.max(r.car ? 1.6 : 0.8, r.width * k + (r.car ? 2 * edge : 0)); if (!r.car) g.setLineDash([Math.max(2, 3 * px / 4096 * 2), Math.max(2, 2 * px / 4096 * 2)]); g.stroke(); g.setLineDash([]); });
    rs.filter(r => r.car).forEach(r => { g.beginPath(); path(r.pts); g.strokeStyle = st.road; g.lineWidth = Math.max(1, r.width * k); g.stroke(); });
    L.rails.filter(r => !r.tunnel).forEach(r => { g.beginPath(); path(r.pts); g.strokeStyle = st.rail; g.lineWidth = Math.max(1, 1.4 * k + 0.5); g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]); });
  }
  if (buildings && $('sBuild').checked) M.buildings.forEach(b => poly(b, st.build));
  if (trees && $('sTrees').checked) { g.fillStyle = style === 'ink' ? 'rgba(27,27,25,0.12)' : 'rgba(80,100,60,0.35)'; M.trees.forEach(t => { g.beginPath(); g.arc(X(t.x), Y(t.y), Math.max(0.8, t.r * k), 0, 7); g.fill(); }); }
  return c;
}

// ---------- 3D scene ----------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
const persp = new THREE.PerspectiveCamera(32, 1, 1, 100000), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1);
let camera = persp;
let controls = new OrbitControls(camera, renderer.domElement);
const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b2a6, 1.35); hemi.position.set(0, 0, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.castShadow = true; scene.add(sun, sun.target);
const world = new THREE.Group(); scene.add(world);
const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let need = true;
const requestRender = () => { need = true; };
function loop() { requestAnimationFrame(loop); if (!need) return; need = false; renderer.render(scene, camera); updateNorth(); }
loop();
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, true); persp.aspect = w / h; persp.updateProjectionMatrix();
  const s = ortho.top; ortho.left = -s * w / h; ortho.right = s * w / h; ortho.updateProjectionMatrix(); requestRender();
}
new ResizeObserver(resize).observe(stage);
controls.addEventListener('change', requestRender);

let parts = {};
const VX = () => +$('vx').value;
function disposeGroup(gr) { gr.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }); gr.clear(); }

function buildScene() {
  disposeGroup(world); parts = {};
  const st = sty(); scene.background = new THREE.Color(st.bg); stage.parentElement.style.background = st.bg;
  const T = M.T, half = M.half, n = T.n, vx = VX();
  M.zRef = T.min; M.plinth = Math.max(3, SIZE * 0.025);
  const zr = v => (v - M.zRef) * vx;
  // Ground.
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; pos[3 * k] = -half + i * T.step; pos[3 * k + 1] = -half + j * T.step; pos[3 * k + 2] = zr(T.z[k]); uv[2 * k] = i / (n - 1); uv[2 * k + 1] = j / (n - 1); }
  let q = 0; for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) { const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = a; idx[q++] = c; idx[q++] = d; }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); gg.setIndex(new THREE.BufferAttribute(idx, 1)); gg.computeVertexNormals();
  const tex = new THREE.CanvasTexture(paint(Math.min(4096, renderer.capabilities.maxTextureSize)));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.generateMipmaps = true;
  parts.ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, clippingPlanes: [clip], clipShadows: true }));
  parts.ground.receiveShadow = true; parts.ground.castShadow = true; world.add(parts.ground);
  // Plinth: walls along the four edges and a bottom.
  parts.base = new THREE.Mesh(plinthGeometry(), new THREE.MeshStandardMaterial({ color: st.base, roughness: 1, clippingPlanes: [clip], side: THREE.DoubleSide }));
  parts.base.receiveShadow = true; world.add(parts.base);
  // Buildings.
  parts.buildings = new THREE.Mesh(buildingGeometry(), new THREE.MeshStandardMaterial({ color: st.house, roughness: 0.95, clippingPlanes: [clip], clipShadows: true }));
  parts.buildings.castShadow = parts.buildings.receiveShadow = true; parts.buildings.visible = $('sBuild').checked; world.add(parts.buildings);
  // Trees.
  parts.trees = treeMeshes(st); parts.trees.visible = $('sTrees').checked; world.add(parts.trees);
  // Frame with distance and height ticks.
  parts.frame = frame(); parts.frame.visible = $('sGrid').checked; world.add(parts.frame);
  parts.cut = new THREE.Group(); world.add(parts.cut);
  // Light and shadow camera cover the site.
  sun.position.set(-half * 1.2, half * 0.9, half * 1.4 + (T.max - T.min) * vx); sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera, r = half * 1.6; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = half * 8; sc.updateProjectionMatrix();
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = SIZE / 2000;
  renderer.shadowMap.enabled = $('sShadow').checked;
  $('north').hidden = false; $('scaleNote').hidden = false;
  $('scaleNote').textContent = `${SIZE >= 1000 ? SIZE / 1000 + ' km' : SIZE + ' m'} square · ${M.T.src} · contours ${contourInterval() || 'off'}${contourInterval() ? ' m' : ''}${vx > 1 ? ' · heights ×' + vx : ''}`;
  setView(segVal('view') || 'persp', !M.viewSet); M.viewSet = true;
  requestRender();
}
function plinthGeometry() {
  const T = M.T, n = T.n, half = M.half, vx = VX(), zb = -M.plinth, P = [], zr = v => (v - M.zRef) * vx;
  const edge = (pts) => { for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1]; P.push(ax, ay, zb, bx, by, zb, bx, by, bz, ax, ay, zb, bx, by, bz, ax, ay, az); } };
  const E = (i, j) => [-half + i * T.step, -half + j * T.step, zr(T.z[j * n + i])];
  edge([...Array(n)].map((_, i) => E(i, 0))); edge([...Array(n)].map((_, j) => E(n - 1, j)));
  edge([...Array(n)].map((_, i) => E(n - 1 - i, n - 1))); edge([...Array(n)].map((_, j) => E(0, n - 1 - j)));
  P.push(-half, -half, zb, half, half, zb, half, -half, zb, -half, -half, zb, -half, half, zb, half, half, zb);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
}
function buildingTris(b, vx) {
  const z0 = (b.z0 - M.zRef) * vx - 0.3, z1 = (b.z0 - M.zRef) * vx + (b.z1 - b.z0), rings = [b.outer, ...b.holes];
  return [...ATModel.walls(rings, z0, z1), ...ATModel.cap(rings, z1, true)];
}
function buildingGeometry() {
  const vx = VX(), P = [];
  M.buildings.forEach(b => { try { buildingTris(b, vx).forEach(t => t.forEach(p => P.push(p[0], p[1], p[2]))); } catch (e) {} });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
}
// Unit tree shapes: height 1, crown radius 1 (scaled per tree to r, r, h).
function unitShapes() {
  const crown = new THREE.IcosahedronGeometry(1, 1); crown.scale(1, 1, 0.36); crown.translate(0, 0, 0.62);
  const trunk = new THREE.CylinderGeometry(0.07, 0.09, 0.32, 6); trunk.rotateX(Math.PI / 2); trunk.translate(0, 0, 0.16);
  const cone = new THREE.ConeGeometry(0.8, 0.85, 8); cone.rotateX(Math.PI / 2); cone.translate(0, 0, 0.575);
  const ctrunk = new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6); ctrunk.rotateX(Math.PI / 2); ctrunk.translate(0, 0, 0.1);
  const shrub = new THREE.IcosahedronGeometry(1, 1); shrub.scale(1, 1, 0.5); shrub.translate(0, 0, 0.5);
  return { crown, trunk, cone, ctrunk, shrub };
}
function treeMeshes(st) {
  const gr = new THREE.Group(), U = unitShapes(), vx = VX(), m4 = new THREE.Matrix4();
  const groups = { broad: M.trees.filter(t => t.kind === 'broad'), conifer: M.trees.filter(t => t.kind === 'conifer'), shrub: M.trees.filter(t => t.kind === 'shrub') };
  const add = (geo, list, color) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, clippingPlanes: [clip], flatShading: true }), list.length);
    list.forEach((t, i) => { const z = (ATTerrain.at(M.T, t.x, t.y) - M.zRef) * vx; m4.makeScale(t.r, t.r, t.h); m4.setPosition(t.x, t.y, z); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true; gr.add(im);
  };
  add(U.crown, groups.broad, st.tree); add(U.trunk, groups.broad, st.base); add(U.cone, groups.conifer, st.conifer); add(U.ctrunk, groups.conifer, st.base); add(U.shrub, groups.shrub, st.shrub);
  return gr;
}
function label(text, size) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 44; g.font = `500 ${fs}px Inter, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 8; c.width = w; c.height = fs + 12; g.font = `500 ${fs}px Inter, sans-serif`; g.fillStyle = '#4a4945'; g.textBaseline = 'middle'; g.fillText(text, 4, c.height / 2);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })); s.scale.set(size * w / c.height, size, 1); s.renderOrder = 10; return s;
}
function frame() {
  const gr = new THREE.Group(), half = M.half, zb = -M.plinth, P = [], d = SIZE * 0.04;
  const tickEvery = SIZE <= 500 ? 100 : SIZE <= 1000 ? 250 : SIZE <= 2000 ? 500 : 1000;
  const lab = SIZE * 0.022, fmt = v => v >= 1000 ? (v / 1000) + ' km' : v + ' m';
  for (let v = 0; v <= SIZE + 1e-6; v += tickEvery) {
    const x = -half + v; P.push(x, -half - d * 0.3, zb, x, -half - d, zb); const s = label(fmt(v), lab); s.position.set(x, -half - d * 1.8, zb); gr.add(s);
    const y = -half + v; P.push(half + d * 0.3, y, zb, half + d, y, zb); if (v > 0) { const s2 = label(fmt(v), lab); s2.position.set(half + d * 2.4, y, zb); gr.add(s2); }
  }
  P.push(-half, -half - d * 0.6, zb, half, -half - d * 0.6, zb, half + d * 0.6, -half, zb, half + d * 0.6, half, zb);
  // Height axis at the north-west corner, in metres above sea level.
  const vx = VX(), T = M.T, minGap = lab * 1.6 / vx, hs = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000].find(s => (T.max - T.min) / s <= 6 && s >= minGap) || 5000;
  const top = T.max + hs * 0.5;
  P.push(-half - d * 0.6, half, zb, -half - d * 0.6, half, (top - M.zRef) * vx);
  for (let h = Math.ceil(T.min / hs) * hs; h <= top; h += hs) { const z = (h - M.zRef) * vx; P.push(-half - d * 0.6, half, z, -half - d, half, z); const s = label(Math.round(h) + ' m', lab * 0.9); s.position.set(-half - d * 2.6, half, z); gr.add(s); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  gr.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x77736b })));
  return gr;
}

// ---------- Views ----------
function setView(v, reset = true) {
  if (!M) return;
  const half = M.half, zc = (M.T.max - M.T.min) * VX() / 2, w = stage.clientWidth || 800, h = stage.clientHeight || 600;
  $('secBox').hidden = v !== 'section';
  const ortho3 = v !== 'persp';
  const next = ortho3 ? ortho : persp;
  if (next !== camera || reset) {
    const tgt = new THREE.Vector3(0, 0, zc);
    camera = next; controls.dispose(); controls = new OrbitControls(camera, renderer.domElement); controls.addEventListener('change', requestRender);
    controls.target.copy(tgt); controls.enableDamping = false;
    const D = half * 3.2;
    if (v === 'persp') camera.position.set(-half * 2.2, -half * 3.3, half * 2.6);
    if (v === 'axo') camera.position.set(-D, -D, D * 0.8165);
    if (v === 'plan') camera.position.set(0, 0, D * 2);
    if (v === 'section') { const ns = segVal('secDir') !== 'ew', E = half * 2.6; camera.position.set(ns ? -E * 0.25 : -E, ns ? -E : -E * 0.25, E * 0.42); }
    if (ortho3) { const s = half * 1.25; ortho.top = s; ortho.bottom = -s; ortho.left = -s * w / h; ortho.right = s * w / h; ortho.zoom = 1; ortho.updateProjectionMatrix(); }
    camera.lookAt(tgt);
  }
  controls.enableRotate = v !== 'plan';
  if (v === 'plan') { controls.screenSpacePanning = true; }
  clip.constant = 1e9; clip.normal.set(0, 1, 0);
  if (parts.cut) disposeGroup(parts.cut);
  if (v === 'section') section();
  controls.update(); requestRender();
}
seg('view', v => setView(v));
seg('secDir', () => setView('section'));
$('secPos').addEventListener('input', () => { section(); requestRender(); });
// Cut the model with a vertical plane and close the cut with a section face (ground and buildings).
function section() {
  if (!M) return;
  const ns = segVal('secDir') !== 'ew', half = M.half, c = +$('secPos').value * half * 0.98, vx = VX(), T = M.T, st = sty();
  // Keep the part behind the cut as seen from the camera (north of an E–W line for the N–S view direction, etc.).
  if (ns) { clip.normal.set(0, 1, 0); clip.constant = -c; } else { clip.normal.set(1, 0, 0); clip.constant = -c; }
  disposeGroup(parts.cut);
  const P = [], zb = -M.plinth, n = 400;
  for (let i = 0; i < n; i++) {
    const a = -half + 2 * half * i / n, b = -half + 2 * half * (i + 1) / n;
    const pa = ns ? [a, c] : [c, a], pb = ns ? [b, c] : [c, b];
    const za = (ATTerrain.at(T, pa[0], pa[1]) - M.zRef) * vx, zb2 = (ATTerrain.at(T, pb[0], pb[1]) - M.zRef) * vx;
    P.push(pa[0], pa[1], zb, pb[0], pb[1], zb, pb[0], pb[1], zb2, pa[0], pa[1], zb, pb[0], pb[1], zb2, pa[0], pa[1], za);
  }
  // Buildings: the cut line through each footprint gives intervals; each interval is a rectangle from base to roof.
  M.buildings.forEach(b => {
    const xs = [];
    [b.outer, ...b.holes].forEach(r => r.forEach((p, i) => {
      const q = r[(i + 1) % r.length], u = ns ? 1 : 0, v = ns ? 0 : 1;   // u: coordinate fixed by the cut
      if ((p[u] > c) !== (q[u] > c)) xs.push(p[v] + (c - p[u]) / (q[u] - p[u]) * (q[v] - p[v]));
    }));
    xs.sort((m, k) => m - k);
    const z0 = (b.z0 - M.zRef) * vx, z1 = z0 + (b.z1 - b.z0);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const A = ns ? [xs[k], c] : [c, xs[k]], B = ns ? [xs[k + 1], c] : [c, xs[k + 1]];
      P.push(A[0], A[1], z0, B[0], B[1], z0, B[0], B[1], z1, A[0], A[1], z0, B[0], B[1], z1, A[0], A[1], z1);
    }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const off = ns ? [0, 0.02, 0] : [0.02, 0, 0];
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: st.section, side: THREE.DoubleSide }));
  mesh.position.set(...off); parts.cut.add(mesh);
}
function updateNorth() {
  // Screen direction of world north at the centre of the model.
  const a = new THREE.Vector3(0, 0, 0).project(camera), b = new THREE.Vector3(0, M ? M.half * 0.2 : 100, 0).project(camera);
  const ang = Math.atan2(b.x - a.x, (b.y - a.y) * (camera.isPerspectiveCamera ? 1 / camera.aspect : (ortho.top - ortho.bottom) / (ortho.right - ortho.left)));
  const svg = $('north').querySelector('svg'); if (svg && isFinite(ang)) svg.style.transform = `rotate(${ang / rad}deg)`;
}

// ---------- Look controls ----------
let repaintT = null;
function repaint() {
  if (!M || !parts.ground) return;
  clearTimeout(repaintT);
  repaintT = setTimeout(() => {
    const st = sty(); scene.background = new THREE.Color(st.bg); stage.parentElement.style.background = st.bg;
    const m = parts.ground.material; m.map.dispose(); m.map = new THREE.CanvasTexture(paint(Math.min(4096, renderer.capabilities.maxTextureSize)));
    m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); m.needsUpdate = true;
    parts.buildings.material.color.set(st.house); parts.base.material.color.set(st.base);
    world.remove(parts.trees); disposeGroup(parts.trees); parts.trees = treeMeshes(st); parts.trees.visible = $('sTrees').checked; world.add(parts.trees);
    legend(); requestRender();
  }, 60);
}
seg('style', repaint);
['mapOn', 'cInt', 'sRoads', 'sWater', 'sFlow', 'sShade'].forEach(id => $(id).addEventListener('change', repaint));
$('sBuild').addEventListener('change', () => { if (parts.buildings) { parts.buildings.visible = $('sBuild').checked; repaint(); } });
$('sTrees').addEventListener('change', () => { if (parts.trees) { parts.trees.visible = $('sTrees').checked; requestRender(); } });
$('sGrid').addEventListener('change', () => { if (parts.frame) { parts.frame.visible = $('sGrid').checked; requestRender(); } });
$('sShadow').addEventListener('change', () => { renderer.shadowMap.enabled = $('sShadow').checked; [parts.ground, parts.buildings, parts.base].forEach(m => m && (m.material.needsUpdate = true)); requestRender(); });
let vxT = null;
$('vx').addEventListener('input', () => { $('vxV').textContent = '×' + (+$('vx').value).toFixed(2).replace(/0$/, ''); clearTimeout(vxT); vxT = setTimeout(() => M && buildScene(), 150); });

// ---------- Legend and report ----------
function legend() {
  if (!M) return;
  const kind = $('mapOn').value, el = $('legend'), N = M.T.n * M.T.n, T = M.T, A = M.A;
  if (!kind) { el.innerHTML = ''; return; }
  const m = MAPS[kind]; let rows = [];
  const share = fn => { const c = new Array(m.ramp.length).fill(0); for (let k = 0; k < N; k++) c[fn(k)]++; return c.map(v => Math.round(100 * v / N) + '%'); };
  if (kind === 'elev') { const b = elevBreaks(), e = [T.min, ...b, T.max], s = share(k => classOf(T.z[k], b)); rows = m.ramp.map((col, i) => [col, `${Math.round(e[i])}–${Math.round(e[i + 1])}`, s[i]]); }
  if (kind === 'slope') { const s = share(k => classOf(Math.tan(A.slope[k] * rad) * 100, m.breaks)); rows = m.ramp.map((col, i) => [col, m.labels[i], s[i]]); }
  if (kind === 'aspect') { const s = share(k => A.aspect[k] < 0 || Math.tan(A.slope[k] * rad) < 0.03 ? 8 : Math.round(A.aspect[k] / 45) % 8); rows = m.ramp.map((col, i) => [col, m.labels[i], s[i]]); }
  if (kind === 'wet') { const s = share(k => classOf(A.twi[k], m.breaks)); rows = m.ramp.map((col, i) => [col, m.labels[i], s[i]]); }
  if (kind === 'ndvi' || kind === 'hist') {
    const src = kind === 'ndvi' ? M.s2 && M.s2.ndvi : M.hist && M.hist.occ;
    if (!src) { el.innerHTML = `<span class="lt">${m.title}: not loaded</span>`; return; }
    const c = new Array(m.ramp.length).fill(0); let tot = 0; for (const v of src) { if (kind === 'ndvi' ? isNaN(v) : !v) continue; c[classOf(v, m.breaks)]++; tot++; }
    rows = m.ramp.map((col, i) => [col, m.labels[i], (kind === 'hist' ? Math.round(100 * c[i] / src.length * 10) / 10 : Math.round(100 * c[i] / (tot || 1))) + '%']);
  }
  el.innerHTML = `<span class="lt">${m.title}</span><span class="lt" style="display:none"></span>` + rows.map(([c, t, v]) => `<i style="background:${c}"></i><span>${t}</span><span>${v}</span>`).join('') +
    `<span class="lt" style="font-weight:400">${{ elev: 'Equal height bands across the site.', slope: 'Under 5% builds without terraces; over 15% needs retaining walls or stepped sections.', aspect: 'The direction each slope faces. South faces get the most sun in the northern hemisphere.', wet: 'High values gather water: valley floors, hollows. Read with the flow lines.', ndvi: `Sentinel-2, ${M.s2 ? M.s2.date : ''}. Dense, healthy green reads above 0.55.`, hist: 'Share of months the ground was under water, 1984–2021 (Landsat).' }[kind]}</span>`;
}
function report() {
  const r = M.rep, b = M.buildings, known = b.filter(x => x.known).length, osmT = M.trees.filter(t => t.src === 'osm').length;
  const roadKm = M.lay.roads.filter(x => x.car).reduce((s, x) => s + x.pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - x.pts[i - 1][0], p[1] - x.pts[i - 1][1]) : 0, 0), 0) / 1000;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], dom = r.aspects.slice(0, 8).indexOf(Math.max(...r.aspects.slice(0, 8)));
  const stat = (v, t) => `<div class="stat"><b>${v}</b><span>${t}</span></div>`;
  $('stats').innerHTML = stat(`${Math.round(r.min)}–${Math.round(r.max)} m`, 'Ground, lowest–highest') + stat(`${Math.round(r.relief)} m`, 'Relief') +
    stat(`${r.meanSlope.toFixed(1)}%`, 'Mean slope') + stat(r.aspects[8] > 0.5 ? 'Flat' : dirs[dom], 'Most slopes face') +
    stat(b.length.toLocaleString('en-US'), `Buildings · ${b.length ? Math.round(100 * known / b.length) : 0}% with OSM height`) +
    stat(M.trees.length.toLocaleString('en-US'), `Trees and shrubs · ${osmT.toLocaleString('en-US')} mapped`) +
    stat(roadKm.toFixed(1) + ' km', 'Streets and roads') + stat(M.A.streams.length, 'Flow lines (> ' + Math.round(Math.max(2e4, SIZE * SIZE / 400) / 1e4) + ' ha)');
  const names = ['0–5% flat', '5–10% gentle', '10–15% moderate', '15–25% steep', '> 25% very steep'];
  $('slopeBars').innerHTML = r.classes.map((v, i) => `<span>${names[i]}</span><i style="width:${Math.max(1, v * 100)}%;opacity:${0.25 + i * 0.18}"></i><span>${Math.round(v * 100)}%</span>`).join('');
  const s2 = M.s2 ? `Sentinel-2 ${M.s2.date}. ` : '';
  const ov = M.overture && (M.from.overtureBuildings || M.from.overtureLayers) ? ` Overture Maps ${M.overture.slice(0, 10)}: ${M.from.overtureBuildings.toLocaleString('en-US')} buildings traced from imagery or other sources${M.from.overtureLayers ? ', roads, water and land cover' : ''}.` : '';
  $('sources').textContent = `Elevation: ${M.T.src}. ${s2}OpenStreetMap ${M.osmTime ? 'as of ' + M.osmTime.slice(0, 10) : ''}.${ov} Unknown building heights from GHSL where built.`;
}

// ---------- Export scene ----------
function exportScene({ trees = $('xTree').value } = {}) {
  const T = M.T, n = T.n, half = M.half, flat = $('xVec').value === 'flat', Lc = ATUtm.local(M.site), zone = ATUtm.zoneOf(M.site.lat, M.site.lng), south = M.site.lat < 0;
  const utm = $('xCrs').value === 'utm';
  const P = utm ? (x, y, z) => { const ll = Lc.ll(x, y), u = ATUtm.toUtm(ll.lat, ll.lng, zone, south); return [u.e, u.n, z]; } : (x, y, z) => [x, y, z];
  const ground = (x, y) => ATTerrain.at(T, x, y);
  const drape = (pts, lift = 0.15) => flat ? pts.map(p => [p[0], p[1], 0]) : ATTerrain.densify(pts, T.step).map(p => [p[0], p[1], ground(p[0], p[1]) + lift]);
  const X = { note: `a_tools Terrain Model, ${M.site.name || ''} ${M.site.lat.toFixed(6)}, ${M.site.lng.toFixed(6)}, ${SIZE} m square, metres, ${utm ? `UTM zone ${zone}${south ? 'S' : 'N'} (EPSG:${ATUtm.epsg({ zone, south })})` : 'local: site at 0,0, north +Y'}, heights above sea level. Elevation ${T.src}; (c) OpenStreetMap contributors; GHS-BUILT-H (EC JRC).`,
    P, layers: [], meshes: [], lines: [], points: [], blocks: {}, inserts: [] };
  const layer = (p, c) => { if (!X.layers.some(l => l[0] === p)) X.layers.push([p, c]); return p; };
  // Ground mesh.
  const pos = new Float64Array(n * n * 3), idx = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; pos[3 * k] = -half + i * T.step; pos[3 * k + 1] = -half + j * T.step; pos[3 * k + 2] = T.z[k]; }
  let q = 0; for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) { const a = j * n + i; idx[q++] = a; idx[q++] = a + 1; idx[q++] = a + n + 1; idx[q++] = a; idx[q++] = a + n + 1; idx[q++] = a + n; }
  X.meshes.push({ name: 'terrain', layer: layer('Terrain', [205, 200, 188]), pos, idx });
  // Contours.
  const ci = contourInterval() || M.interval, cl = ATTerrain.contours(T, ci);
  cl.forEach(l => { const ix = Math.abs(l.z / (ci * 5) - Math.round(l.z / (ci * 5))) < 1e-6; X.lines.push({ layer: layer(ix ? 'Terrain::Contours index' : 'Terrain::Contours', ix ? [90, 84, 74] : [150, 144, 132]), pts: l.pts.map(p => [p[0], p[1], flat ? 0 : l.z]), closed: l.closed, name: Math.round(l.z * 100) / 100 + ' m' }); });
  // Square outline at the lowest ground.
  X.lines.push({ layer: layer('Site', [200, 85, 61]), pts: [[-half, -half], [half, -half], [half, half], [-half, half]].map(p => [p[0], p[1], flat ? 0 : T.min]), closed: true, name: 'site square' });
  // Water.
  const clipR = r => r.map(p => [Math.max(-half, Math.min(half, p[0])), Math.max(-half, Math.min(half, p[1]))]);
  [...M.lay.sea, ...M.lay.water].forEach(pg => [pg.outer, ...pg.holes].forEach(r => X.lines.push({ layer: layer('Water', [86, 132, 170]), pts: drape(clipR(r), 0.05), closed: true, name: pg.name || 'water' })));
  M.lay.waterways.filter(w => !w.tunnel).forEach(w => clipLine(w.pts, half).forEach(pts => X.lines.push({ layer: layer('Water::Streams', [86, 132, 170]), pts: drape(pts, 0.05), name: [w.kind, w.name].filter(Boolean).join(' ') })));
  if ($('sFlow').checked) M.A.streams.forEach(s => X.lines.push({ layer: layer('Water::Flow lines', [130, 170, 200]), pts: drape(s.pts, 0.05), name: Math.round(s.area / 1e4) + ' ha' }));
  // Roads and rails (centre lines and edges).
  M.lay.roads.filter(r => !r.tunnel).forEach(r => clipLine(r.pts, half).forEach(pts => {
    const L = r.car ? layer('Roads', [120, 120, 120]) : layer('Roads::Paths', [160, 160, 160]);
    X.lines.push({ layer: L, pts: drape(pts, 0.2), name: [r.kind, r.name].filter(Boolean).join(' ') });
    if (r.car && r.width >= 4) [-1, 1].forEach(sgn => { const e = offsetLine(pts, sgn * r.width / 2); if (e.length > 1) X.lines.push({ layer: layer('Roads::Edges', [170, 170, 170]), pts: drape(e, 0.2) }); });
  }));
  M.lay.rails.filter(r => !r.tunnel).forEach(r => clipLine(r.pts, half).forEach(pts => X.lines.push({ layer: layer('Rail', [90, 90, 90]), pts: drape(pts, 0.3), name: r.kind })));
  // Buildings: one mesh each (merged when there are very many).
  const bl = layer('Buildings', [235, 232, 225]), many = M.buildings.length > 4000;
  const mergeP = [], mergeI = [];
  M.buildings.forEach((b, k) => {
    let tris; try { tris = [...ATModel.walls([b.outer, ...b.holes], b.z0 - 0.3, b.z1), ...ATModel.cap([b.outer, ...b.holes], b.z1, true), ...ATModel.cap([b.outer, ...b.holes], b.z0 - 0.3, false)]; } catch (e) { return; }
    if (many) { tris.forEach(t => t.forEach(p => { mergeI.push(mergeP.length / 3); mergeP.push(p[0], p[1], p[2]); })); return; }
    const p = new Float64Array(tris.length * 9), ix = new Uint32Array(tris.length * 3);
    tris.forEach((t, m) => t.forEach((v, c) => { p[m * 9 + c * 3] = v[0]; p[m * 9 + c * 3 + 1] = v[1]; p[m * 9 + c * 3 + 2] = v[2]; ix[m * 3 + c] = m * 3 + c; }));
    const nm = b.tags && b.tags.name ? b.tags.name : 'building ' + (k + 1);
    X.meshes.push({ name: `${nm} · ${Math.round(b.z1 - b.z0)} m${b.known ? '' : ' (estimated)'}`, layer: bl, pos: p, idx: ix });
  });
  if (many) X.meshes.push({ name: 'buildings', layer: bl, pos: Float64Array.from(mergeP), idx: Uint32Array.from(mergeI) });
  // Trees.
  if (trees !== 'off' && M.trees.length) {
    const geo = (...gs) => { const P = [], I = []; gs.forEach(g0 => { const g = g0.index ? g0.toNonIndexed() : g0, a = g.attributes.position.array; for (let i = 0; i < a.length; i += 3) { I.push(P.length / 3); P.push(a[i], a[i + 1], a[i + 2]); } }); return { pos: Float64Array.from(P), idx: Uint32Array.from(I) }; };
    const lt = layer('Vegetation::Trees', [110, 140, 90]), ls = layer('Vegetation::Shrubs', [140, 160, 110]);
    if (trees === 'mesh') {
      X.blocks.TREE = { layer: lt, ...geo(new THREE.IcosahedronGeometry(1, 0).scale(1, 1, 0.36).translate(0, 0, 0.62), new THREE.CylinderGeometry(0.07, 0.09, 0.32, 5).rotateX(Math.PI / 2).translate(0, 0, 0.16)) };
      X.blocks.CONIFER = { layer: lt, ...geo(new THREE.ConeGeometry(0.8, 0.85, 7).rotateX(Math.PI / 2).translate(0, 0, 0.575), new THREE.CylinderGeometry(0.06, 0.08, 0.2, 5).rotateX(Math.PI / 2).translate(0, 0, 0.1)) };
      X.blocks.SHRUB = { layer: ls, ...geo(new THREE.IcosahedronGeometry(1, 0).scale(1, 1, 0.5).translate(0, 0, 0.5)) };
      M.trees.forEach(t => X.inserts.push({ block: t.kind === 'conifer' ? 'CONIFER' : t.kind === 'shrub' ? 'SHRUB' : 'TREE', layer: t.kind === 'shrub' ? ls : lt, p: [t.x, t.y, ground(t.x, t.y)], s: [t.r, t.r, t.h] }));
    } else M.trees.forEach(t => X.points.push({ layer: t.kind === 'shrub' ? ls : lt, p: [t.x, t.y, ground(t.x, t.y)], name: `${t.kind} ${t.h.toFixed(1)} m` }));
  }
  return X;
}
// Polygon cut to the square |x|, |y| <= h (Sutherland–Hodgman); keeps the ring's orientation.
function clipSquare(ring, h) {
  let out = ring;
  for (const [ax, sg] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const inp = out; out = []; if (!inp.length) break;
    const ins = p => sg * p[ax] <= h;
    for (let i = 0; i < inp.length; i++) {
      const p = inp[i], q = inp[(i + 1) % inp.length], pi = ins(p), qi = ins(q);
      if (pi) out.push(p);
      if (pi !== qi) { const t = (sg * h - p[ax]) / (q[ax] - p[ax]); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
  }
  return out;
}
// Line pieces inside the square |x|, |y| <= h (Liang–Barsky per segment).
function clipLine(pts, h) {
  const out = []; let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0; let t0 = 0, t1 = 1, ok = true;
    [[-dx, x0 + h], [dx, h - x0], [-dy, y0 + h], [dy, h - y0]].forEach(([p, qq]) => { if (!ok) return; if (p === 0) { if (qq < 0) ok = false; } else { const r = qq / p; if (p < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; } } });
    if (!ok) { if (cur) { out.push(cur); cur = null; } continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy];
    if (!cur) cur = [a]; cur.push(b);
    if (t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(l => l.length > 1);
}
function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - dy / l * d, p[1] + dx / l * d];
  });
}

// ---------- Downloads ----------
const base = () => `terrain-${ATools.slug(M.site.name || `${M.site.lat.toFixed(4)}-${M.site.lng.toFixed(4)}`)}-${SIZE}m`;
function saveBlob(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); ATools.track('download/' + name.split('.').pop()); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
async function download(kind, btn) {
  if (!M) return;
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    if (kind === '3dm') saveBlob(base() + '.3dm', await ATExport.write3dm(exportScene()), 'application/octet-stream');
    if (kind === 'dxf') saveBlob(base() + '.dxf', ATExport.writeDxf(exportScene()), 'application/dxf');
    if (kind === 'obj') saveBlob(base() + '.obj', ATExport.writeObj(exportScene()), 'text/plain');
    if (kind === 'stl') saveBlob(base() + `-1to${$('xStl').value}.stl`, printStl(+$('xStl').value), 'model/stl');
    if (kind === 'svg') saveBlob(base() + '-plan.svg', planSvg(), 'image/svg+xml');
    if (kind === 'pdf') printPlan();
    if (kind === 'png') saveBlob(base() + '-view.png', await viewPng(), 'image/png');
    if (kind === 'pngplan') saveBlob(base() + '-plan.png', await new Promise(r => paint(4096, { trees: true }).toBlob(r)), 'image/png');
    if (kind === 'tif' || kind === 'tifslope') saveBlob(base() + (kind === 'tif' ? '-elevation.tif' : '-slope.tif'), geoTiff(kind === 'tif' ? M.T.z : M.A.slope), 'image/tiff');
    if (kind === 'geojson') saveBlob(base() + '.geojson', geoJson(), 'application/geo+json');
    if (kind === 'kml') saveBlob(base() + '.kml', kml(), 'application/vnd.google-earth.kml+xml');
    if (kind === 'lsvg' || kind === 'ldxf') { const L = laser(); saveBlob(base() + `-laser-1to${$('lScale').value}.${kind === 'lsvg' ? 'svg' : 'dxf'}`, kind === 'lsvg' ? ATExport.laserSvg(L.sheets, L.W, L.H, L.title) : ATExport.laserDxf(L.sheets, L.W, L.H), kind === 'lsvg' ? 'image/svg+xml' : 'application/dxf'); }
  } catch (e) { console.error(e); alert((e && e.why) || 'Could not make the file: ' + (e && e.message)); }
  btn.textContent = label; btn.disabled = false;
}
document.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => download(b.dataset.x, b)));

async function viewPng() {
  const w = stage.clientWidth, h = stage.clientHeight, pr = renderer.getPixelRatio();
  renderer.setPixelRatio(Math.min(4, 3000 / Math.max(w, h) * 1.0 + 1)); renderer.setSize(w, h, true); renderer.render(scene, camera);
  const blob = await new Promise(r => renderer.domElement.toBlob(r, 'image/png'));
  renderer.setPixelRatio(pr); renderer.setSize(w, h, true); requestRender();
  return blob;
}

// Closed print block in millimetres at 1:scale (ground with walls and a 3 mm base, buildings sunk into it).
function printStl(scale) {
  const T = M.T, half = M.half, vx = VX(), mm = 1000 / scale, n0 = T.n, stepN = Math.max(1, Math.ceil(n0 / 401)), n = Math.floor((n0 - 1) / stepN) + 1;
  const zb = -3, Z = z => (z - T.min) * vx * mm + 0.6, tris = [];
  const P = (i, j) => { const ii = Math.min(n0 - 1, i * stepN), jj = Math.min(n0 - 1, j * stepN); return [(-half + ii * T.step) * mm, (-half + jj * T.step) * mm, Z(T.z[jj * n0 + ii])]; };
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); tris.push([a, b, c], [a, c, d]); }
  const edge = []; for (let i = 0; i < n - 1; i++) edge.push(P(i, 0)); for (let j = 0; j < n - 1; j++) edge.push(P(n - 1, j)); for (let i = n - 1; i > 0; i--) edge.push(P(i, n - 1)); for (let j = n - 1; j > 0; j--) edge.push(P(0, j));
  edge.forEach((p, k) => { const qq = edge[(k + 1) % edge.length], a = [p[0], p[1], zb], b = [qq[0], qq[1], zb]; tris.push([a, b, qq], [a, qq, p]); tris.push([[0, 0, zb], [qq[0], qq[1], zb], [p[0], p[1], zb]]); });
  M.buildings.forEach(b => { try { const z0 = Z(b.z0) - 0.4, z1 = Z(b.z0) + (b.z1 - b.z0) * mm, rings = [b.outer, ...b.holes].map(r => r.map(p => [p[0] * mm, p[1] * mm])); tris.push(...ATModel.walls(rings, z0, z1), ...ATModel.cap(rings, z1, true), ...ATModel.cap(rings, z0, false)); } catch (e) {} });
  return ATModel.stl({ parts: [{ tris }] });
}

function geoTiff(arr) {
  const T = M.T, n = T.n, Lc = ATUtm.local(M.site), nw = Lc.ll(-M.half - T.step / 2, M.half + T.step / 2);
  const dLng = T.step / (111320 * Math.cos(M.site.lat * rad)), dLat = T.step / 110540, data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = arr[(n - 1 - j) * n + i];
  return ATExport.geotiff(data, n, n, nw.lng, nw.lat, dLng, dLat);
}
function geoJson() {
  const Lc = ATUtm.local(M.site), ll = p => { const g = Lc.ll(p[0], p[1]); return [+g.lng.toFixed(7), +g.lat.toFixed(7)]; }, F = [], half = M.half;
  const ring = r => { const c = r.map(ll); c.push(c[0]); return c; };
  const ci = contourInterval() || M.interval;
  ATTerrain.contours(M.T, ci).forEach(l => F.push({ type: 'Feature', properties: { layer: 'contour', elevation: l.z, index: Math.abs(l.z / (ci * 5) - Math.round(l.z / (ci * 5))) < 1e-6 }, geometry: { type: 'LineString', coordinates: l.pts.map(ll) } }));
  M.lay.roads.forEach(r => clipLine(r.pts, half).forEach(pts => F.push({ type: 'Feature', properties: { layer: r.car ? 'road' : 'path', highway: r.kind, name: r.name, width: r.width, bridge: r.bridge, tunnel: r.tunnel }, geometry: { type: 'LineString', coordinates: pts.map(ll) } })));
  M.lay.waterways.forEach(w => clipLine(w.pts, half).forEach(pts => F.push({ type: 'Feature', properties: { layer: 'waterway', waterway: w.kind, name: w.name, width: w.width }, geometry: { type: 'LineString', coordinates: pts.map(ll) } })));
  [...M.lay.water, ...M.lay.sea].forEach(pg => F.push({ type: 'Feature', properties: { layer: 'water', name: pg.name || '' }, geometry: { type: 'Polygon', coordinates: [pg.outer, ...pg.holes].map(ring) } }));
  M.lay.cover.forEach(pg => F.push({ type: 'Feature', properties: { layer: 'landcover', class: pg.cls }, geometry: { type: 'Polygon', coordinates: [pg.outer, ...pg.holes].map(ring) } }));
  M.buildings.forEach(b => F.push({ type: 'Feature', properties: { layer: 'building', height: +(b.z1 - b.z0).toFixed(1), base: +b.z0.toFixed(2), height_source: b.known ? 'osm' : b.est || 'default', name: (b.tags && b.tags.name) || '' }, geometry: { type: 'Polygon', coordinates: [b.outer, ...b.holes].map(ring) } }));
  M.trees.forEach(t => F.push({ type: 'Feature', properties: { layer: 'tree', kind: t.kind, height: +t.h.toFixed(1), crown: +(2 * t.r).toFixed(1), source: t.src }, geometry: { type: 'Point', coordinates: ll([t.x, t.y]) } }));
  M.A.streams.forEach(s => F.push({ type: 'Feature', properties: { layer: 'flowline', catchment_ha: +(s.area / 1e4).toFixed(1) }, geometry: { type: 'LineString', coordinates: s.pts.map(ll) } }));
  return JSON.stringify({ type: 'FeatureCollection', name: base(), attribution: '© OpenStreetMap contributors (ODbL)' + (M.overture ? '; Overture Maps Foundation' : '') + '; elevation ' + M.T.src, features: F });
}
function kml() {
  const Lc = ATUtm.local(M.site), h = M.half, c = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(p => { const g = Lc.ll(p[0], p[1]); return `${g.lng.toFixed(7)},${g.lat.toFixed(7)},0`; }).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${base()}</name><Placemark><name>Site square ${SIZE} m</name><Style><LineStyle><color>ff3d55c8</color><width>2</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style><Polygon><outerBoundaryIs><LinearRing><coordinates>${c}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark><Placemark><name>${(M.site.name || 'Site').replace(/[<&]/g, '')}</name><Point><coordinates>${M.site.lng},${M.site.lat},0</coordinates></Point></Placemark></Document></kml>\n`;
}

// ---------- Plan drawing to scale ----------
const PAPER = { A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
const SCALES = [200, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];
function scaleOptions(keepLaser = false) {
  const [pw, ph] = PAPER[$('pPaper').value], room = Math.min(pw - 110, ph - 20);
  const fit = SCALES.filter(s => SIZE * 1000 / s <= room), cur = +$('pScale').value;
  $('pScale').innerHTML = fit.map(s => `<option value="${s}">1:${s}</option>`).join('');
  $('pScale').value = fit.includes(cur) ? cur : fit[0];
  // Laser: scales that give a 80–1000 mm model; by default the largest model that fits the sheet in one piece.
  const lf = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000], lc = +$('lScale').value || 0, [W, H] = $('lSheet').value.split('x').map(Number);
  const ok = lf.filter(s => SIZE * 1000 / s <= 1000 && SIZE * 1000 / s >= 80);
  $('lScale').innerHTML = ok.map(s => `<option value="${s}">1:${s} · ${Math.round(SIZE * 1000 / s)} mm</option>`).join('');
  const fitSheet = ok.find(s => SIZE * 1000 / s <= Math.min(W, H) - 10) || ok[ok.length - 1];
  $('lScale').value = keepLaser && ok.includes(lc) ? lc : fitSheet;
  laserInfo();
}
$('pPaper').addEventListener('change', () => scaleOptions(true));
scaleOptions();
function planSvg() {
  const [pw, ph] = PAPER[$('pPaper').value], scale = +$('pScale').value, mm = 1000 / scale, side = SIZE * mm, half = M.half, st = segVal('style') === 'sat' ? STYLE.atlas : sty();
  const ox = 15, oy = (ph - side) / 2, X = x => (ox + (x + half) * mm).toFixed(2), Y = y => (oy + (half - y) * mm).toFixed(2);
  const d = r => r.map((p, i) => (i ? 'L' : 'M') + X(p[0]) + ',' + Y(p[1])).join('');
  const dp = pg => [pg.outer, ...(pg.holes || [])].map(r => d(r) + 'Z').join('');
  const layerG = (id, body, attrs = '') => `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${id}" ${attrs}>${body}</g>\n`;
  const L = M.lay, ci = contourInterval() || M.interval, lines = ATTerrain.contours(M.T, ci);
  const isIdx = z => Math.abs(z / (ci * 5) - Math.round(z / (ci * 5))) < 1e-6;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${pw}mm" height="${ph}mm" viewBox="0 0 ${pw} ${ph}" font-family="Inter, Arial, sans-serif">\n`;
  s += `<defs><clipPath id="sq"><rect x="${ox}" y="${oy}" width="${side}" height="${side}"/></clipPath></defs>\n<rect width="${pw}" height="${ph}" fill="#ffffff"/>\n`;
  s += `<g clip-path="url(#sq)">\n`;
  s += layerG('Ground', `<rect x="${ox}" y="${oy}" width="${side}" height="${side}" fill="${st.ground}"/>`);
  const kind = $('mapOn').value;
  if (kind && kind !== 'hist' && (kind !== 'ndvi' || M.s2)) {
    const img = mapImage(kind); if (img) s += layerG('Analysis map', `<image x="${ox}" y="${oy}" width="${side}" height="${side}" preserveAspectRatio="none" href="${img}"/>`);
  }
  s += layerG('Land cover', ['farmland', 'grass', 'park', 'orchard', 'vineyard', 'scrub', 'wood', 'wetland', 'sand'].map(cl => L.cover.filter(p => p.cls === cl).map(p => `<path d="${dp(p)}" fill="${st.cover[cl]}" fill-rule="evenodd"/>`).join('')).join(''), kind ? 'opacity="0.55"' : '');
  s += layerG('Water', [...L.sea, ...L.water].map(p => `<path d="${dp(p)}" fill="${st.water}" fill-rule="evenodd"/>`).join('') +
    L.waterways.filter(w => !w.tunnel).map(w => `<path d="${d(w.pts)}" fill="none" stroke="${st.water}" stroke-width="${Math.max(0.25, w.width * mm).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`).join(''));
  s += layerG('Contours', lines.map(l => `<path d="${d(l.pts)}${l.closed ? 'Z' : ''}" fill="none" stroke="#6b6355" stroke-opacity="${isIdx(l.z) ? 0.8 : 0.45}" stroke-width="${isIdx(l.z) ? 0.25 : 0.1}"/>`).join(''));
  const rs = L.roads.filter(r => !r.tunnel && !r.area).sort((a, b) => a.width - b.width);
  s += layerG('Roads', rs.filter(r => r.car).map(r => `<path d="${d(r.pts)}" fill="none" stroke="#8d877b" stroke-width="${(r.width * mm + 0.3).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('') +
    rs.filter(r => r.car).map(r => `<path d="${d(r.pts)}" fill="none" stroke="#ffffff" stroke-width="${Math.max(0.15, r.width * mm).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('') +
    rs.filter(r => !r.car).map(r => `<path d="${d(r.pts)}" fill="none" stroke="#8d877b" stroke-width="0.18" stroke-dasharray="0.8 0.5"/>`).join('') +
    L.rails.filter(r => !r.tunnel).map(r => `<path d="${d(r.pts)}" fill="none" stroke="#1b1b19" stroke-width="0.3" stroke-dasharray="2 1"/>`).join(''));
  if ($('sFlow').checked) s += layerG('Flow lines', M.A.streams.map(f => `<path d="${d(f.pts)}" fill="none" stroke="#5f8fb5" stroke-width="${Math.max(0.15, Math.log10(f.area / 1e4 + 1) * 0.35).toFixed(2)}" stroke-linecap="round"/>`).join(''));
  s += layerG('Trees', M.trees.filter(t => t.kind !== 'shrub' || t.r * mm > 0.3).map(t => `<circle cx="${X(t.x)}" cy="${Y(t.y)}" r="${Math.max(0.2, t.r * mm).toFixed(2)}"/>`).join(''), `fill="#7d9468" fill-opacity="0.35" stroke="#5d7350" stroke-width="0.06"`);
  s += layerG('Buildings', M.buildings.map(b => `<path d="${dp(b)}" fill-rule="evenodd"/>`).join(''), `fill="#2b2a27"`);
  // Contour labels on index contours, upright, with a white halo.
  const labels = [];
  lines.filter(l => isIdx(l.z) && l.pts.length > 8).forEach(l => {
    let len = 0; for (let i = 1; i < l.pts.length; i++) len += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]);
    if (len * mm < 40) return;
    const every = 140 / mm; let acc = 0, next = every / 2;
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i], sl = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += sl;
      if (acc >= next) { next += every; let ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) / rad; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; labels.push(`<text x="${X(b[0])}" y="${Y(b[1])}" transform="rotate(${ang.toFixed(1)} ${X(b[0])} ${Y(b[1])})" dy="0.7">${Math.round(l.z)}</text>`); }
    }
  });
  s += layerG('Contour labels', labels.join(''), `font-size="2" fill="#6b6355" text-anchor="middle" stroke="#ffffff" stroke-width="0.6" paint-order="stroke"`);
  s += '</g>\n';
  // Frame, ticks every grid step with local metres.
  const gs = [50, 100, 200, 250, 500, 1000].find(v => SIZE / v <= 10), tk = [];
  for (let v = 0; v <= SIZE + 1e-6; v += gs) {
    const p = ox + v * mm, q = oy + side - v * mm;
    tk.push(`<path d="M${p.toFixed(2)},${oy + side} v2 M${p.toFixed(2)},${oy} v-2 M${ox},${q.toFixed(2)} h-2 M${ox + side},${q.toFixed(2)} h2"/>`);
    tk.push(`<text x="${p.toFixed(2)}" y="${oy + side + 5}" text-anchor="middle" stroke="none">${v}</text>`);
  }
  s += layerG('Frame', `<rect x="${ox}" y="${oy}" width="${side}" height="${side}" fill="none" stroke-width="0.35"/>` + tk.join(''), `stroke="#1b1b19" stroke-width="0.18" fill="#1b1b19" font-size="2.2"`);
  // Title block on the right.
  const tx = ox + side + 14, Lc = ATUtm.local(M.site), z = ATUtm.toUtm(M.site.lat, M.site.lng), sw = Lc.ll(-half, -half), ne = Lc.ll(half, half);
  const bar = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find(v => v * mm >= 25) || 1000, bw = bar * mm;
  const date = new Date().toISOString().slice(0, 10);
  const txt = (y, t, sz = 3, w = 400, c = '#1b1b19') => `<text x="${tx}" y="${y}" font-size="${sz}" font-weight="${w}" fill="${c}">${t}</text>`;
  let tb = txt(oy + 6, (M.site.name || 'Site').replace(/[<&]/g, ''), 6, 600) + txt(oy + 13, 'Terrain model · site plan', 3.4, 400, '#4a4945');
  tb += txt(oy + 24, `Scale 1:${scale} on ${$('pPaper').value} · ${SIZE >= 1000 ? SIZE / 1000 + ' km' : SIZE + ' m'} square`, 2.8);
  tb += txt(oy + 29, `Contours every ${ci} m, every fifth labelled (m above sea level)`, 2.8);
  tb += txt(oy + 34, `Centre ${M.site.lat.toFixed(5)}°, ${M.site.lng.toFixed(5)}° · UTM ${z.zone}${z.south ? 'S' : 'N'} ${Math.round(z.e)} E ${Math.round(z.n)} N`, 2.8);
  tb += txt(oy + 39, `Extent ${sw.lat.toFixed(5)}–${ne.lat.toFixed(5)} N, ${sw.lng.toFixed(5)}–${ne.lng.toFixed(5)} E`, 2.8);
  tb += `<g transform="translate(${tx} ${oy + 48})" stroke="#1b1b19" stroke-width="0.25"><rect width="${bw}" height="2" fill="#1b1b19"/><rect x="${bw / 2}" width="${bw / 2}" height="2" fill="#ffffff"/></g>` +
    `<text x="${tx}" y="${oy + 54}" font-size="2.6">0</text><text x="${tx + bw}" y="${oy + 54}" font-size="2.6" text-anchor="end">${bar} m</text>`;
  tb += `<g transform="translate(${tx + bw + 16} ${oy + 49})"><path d="M0 -6 L3 4 L0 2 L-3 4 Z" fill="#1b1b19"/><text y="9" font-size="3" text-anchor="middle" font-weight="600">N</text></g>`;
  const legendRows = [['Buildings', '#2b2a27'], ['Trees (mapped or placed by rule)', '#b8c4ad'], ['Water', st.water], ['Woods', st.cover.wood], ['Parks and grass', st.cover.park], ['Fields', st.cover.farmland]];
  legendRows.forEach(([t, c], i) => { tb += `<rect x="${tx}" y="${oy + 64 + i * 6}" width="6" height="4" fill="${c}" stroke="#8d877b" stroke-width="0.1"/>` + txt(oy + 67.2 + i * 6, t, 2.7).replace(`x="${tx}"`, `x="${tx + 9}"`); });
  tb += txt(ph - 34, 'Data', 2.6, 600) + [`Elevation: ${M.T.src}`, '© OpenStreetMap contributors (ODbL)', M.overture && M.from.overtureBuildings ? `Overture Maps ${M.overture.slice(0, 10)} (buildings incl. Microsoft ML footprints)` : '', 'Heights: OSM, else GHS-BUILT-H R2023A (EC JRC)', M.s2 ? `Vegetation: Copernicus Sentinel-2, ${M.s2.date}` : '', `Made with a_tools · ${date}`].filter(Boolean).map((t, i) => txt(ph - 29 + i * 4, t, 2.4, 400, '#4a4945')).join('');
  s += layerG('Title', tb);
  return s + '</svg>\n';
}
// The analysis map alone as a PNG data URL (north-up, the square).
function mapImage(kind) {
  const c = document.createElement('canvas'), T = M.T, n = T.n; c.width = c.height = n;
  const g = c.getContext('2d'), im = g.createImageData(n, n), hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  if (kind === 'ndvi') { const s = M.s2, m = MAPS.ndvi; c.width = c.height = s.n; const im2 = g.createImageData(s.n, s.n); for (let q = 0; q < s.n * s.n; q++) { const v = s.ndvi[q]; if (isNaN(v)) continue; const [r, gg, b] = hex(m.ramp[classOf(v, m.breaks)]); im2.data.set([r, gg, b, 255], 4 * q); } g.putImageData(im2, 0, 0); return c.toDataURL('image/png'); }
  const mc = mapColor(kind); if (!mc) return null;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const [r, gg, b] = hex(mc((n - 1 - j) * n + i)); im.data.set([r, gg, b, 255], 4 * (j * n + i)); }
  g.putImageData(im, 0, 0); return c.toDataURL('image/png');
}
function printPlan() {
  const [pw, ph] = PAPER[$('pPaper').value];
  let st = document.getElementById('pageSize'); if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); }
  st.textContent = `@media print { @page { size: ${pw}mm ${ph}mm; margin: 0; } #printArea svg { width: ${pw}mm; height: ${ph}mm; } }`;
  $('printArea').innerHTML = planSvg().replace(/^<\?xml[^>]*>\s*/, '');
  setTimeout(() => window.print(), 100);
}

// ---------- Laser plates ----------
function laserParams() {
  const scale = +$('lScale').value || 2000, t = +$('lThick').value || 2, vx = +$('lVx').value || 1, [W, H] = $('lSheet').value.split('x').map(Number);
  const stepM = t / 1000 * scale / vx;
  return { scale, t, vx, W, H, stepM, mm: 1000 / scale };
}
function laserInfo() {
  if (!M) { $('lInfo').textContent = 'Build a model to see the plates.'; return; }
  const p = laserParams(), base = Math.floor(M.T.min / p.stepM) * p.stepM, nPl = Math.floor((M.T.max - base) / p.stepM) + 1;
  $('lInfo').textContent = `${nPl} plates of ${p.t} mm, one every ${p.stepM < 1 ? p.stepM.toFixed(2) : p.stepM.toFixed(1)} m of height. Model ${Math.round(SIZE * p.mm)} × ${Math.round(SIZE * p.mm)} mm, ${Math.round(nPl * p.t)} mm tall.` + (nPl > 150 ? ' Too many plates: choose a thicker sheet, a smaller scale or more height exaggeration.' : '');
}
['lScale', 'lThick', 'lVx'].forEach(id => $(id).addEventListener('change', laserInfo));
$('lSheet').addEventListener('change', () => scaleOptions());
// Douglas–Peucker for closed rings.
function simplify(r, tol) {
  if (r.length < 8) return r;
  const keep = new Uint8Array(r.length); keep[0] = keep[r.length - 1] = 1;
  const st = [[0, r.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = r[a], [bx, by] = r[b], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((r[i][0] - ax) * dy - (r[i][1] - ay) * dx) / l; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const out = r.filter((_, i) => keep[i]); return out.length >= 3 ? out : r;
}
function laser() {
  const p = laserParams(), T = M.T, half = M.half, base = Math.floor(T.min / p.stepM) * p.stepM, nPl = Math.floor((T.max - base) / p.stepM) + 1;
  if (nPl > 150) throw Object.assign(new Error('plates'), { why: `That would be ${nPl} plates. Choose a thicker sheet, a smaller scale or more height exaggeration.` });
  const toMm = r => simplify(r.map(([x, y]) => [(x + half) * p.mm, (y + half) * p.mm]), 0.08);
  const regions = [];
  for (let k = 0; k < nPl; k++) regions.push(k === 0 ? [{ outer: [[-half, -half], [half, -half], [half, half], [-half, half]], holes: [] }] : ATTerrain.plateRegions(T, base + k * p.stepM));
  const pieces = [];
  regions.forEach((rg, k) => {
    const next = regions[k + 1] || [], letters = 'abcdefghijklmnopqrstuvwxyz';
    rg.filter(pg => Math.abs(ATTerrain.signedArea(pg.outer)) * p.mm * p.mm > 6).forEach((pg, m) => {
      const outer = toMm(pg.outer), holes = pg.holes.map(toMm);
      const score = next.filter(nx => ATTerrain.inside(nx.outer[0], pg.outer)).flatMap(nx => [nx.outer, ...nx.holes]).map(toMm);
      const ip = ATTerrain.interiorPoint(outer) || outer[0];
      pieces.push({ plate: k, outer, holes, score, label: rg.length > 1 ? `${k}${letters[m % 26]}` : String(k), labelAt: ip });
    });
  });
  const sheets = ATExport.pack(pieces, p.W, p.H);
  return { sheets, W: p.W, H: p.H, title: `${M.site.name || 'Site'} · 1:${p.scale} · ${p.t} mm sheets · ${nPl} plates`, plates: nPl, pieces: pieces.length };
}

$('build').onclick = build;
window.TM = { get M() { return M; }, build, exportScene, planSvg, laser, printStl, geoJson, geoTiff, paint, setView, scene, renderer, get camera() { return camera; } };
