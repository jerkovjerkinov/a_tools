// Realistic-ish OSM / Open-Meteo fixtures around Kadıköy for stress tests.
const lat0 = 40.9900, lng0 = 29.0280, mLat = 1 / 110540, mLng = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const LL = ([x, y]) => ({ lat: lat0 + y * mLat, lon: lng0 + x * mLng });
function poly(cx, cy, w, h, rot, kind) {
  let pts = kind === 'L' ? [[0,0],[w,0],[w,h*0.4],[w*0.4,h*0.4],[w*0.4,h],[0,h]] : kind === 'pent' ? [[0,0],[w,0],[w,h*0.7],[w/2,h],[0,h*0.7]] : [[0,0],[w,0],[w,h],[0,h]];
  const c = Math.cos(rot), s = Math.sin(rot);
  pts = pts.map(([x, y]) => [cx + (x - w/2) * c - (y - h/2) * s, cy + (x - w/2) * s + (y - h/2) * c]);
  if (rnd() < 0.5) pts.reverse();                 // mixed winding like real OSM
  return [...pts, pts[0]];
}
function heightTags() {
  const r = rnd();
  if (r < 0.15) return { height: String(Math.round(8 + rnd() * 30)) };
  if (r < 0.2) return { height: (6 + rnd() * 20).toFixed(1).replace('.', ',') + ' m' };   // "12,5 m"
  if (r < 0.55) return { 'building:levels': String(1 + Math.floor(rnd() * 9)) };
  if (r < 0.57) return { 'building:levels': 'yes' };                                  // junk
  return {};
}
function osm(R = 1000, n = 6000) {
  const el = []; let id = 1;
  for (let i = 0; i < n; i++) {
    const cx = (rnd() * 2 - 1) * R, cy = (rnd() * 2 - 1) * R, w = 6 + rnd() * 30, h = 6 + rnd() * 25;
    const kind = rnd() < 0.15 ? 'L' : rnd() < 0.1 ? 'pent' : 'rect';
    el.push({ type: 'way', id: id++, tags: { building: rnd() < 0.8 ? 'yes' : 'apartments', ...heightTags() }, geometry: poly(cx, cy, w, h, rnd() * 0.6 - 0.3, kind).map(LL) });
  }
  // courtyard blocks as multipolygon relations, one with an orphan inner and one with missing geometry
  for (let i = 0; i < 25; i++) {
    const cx = (rnd() * 2 - 1) * R * 0.8, cy = (rnd() * 2 - 1) * R * 0.8, w = 40 + rnd() * 40;
    el.push({ type: 'relation', id: id++, tags: { building: 'yes', type: 'multipolygon', 'building:levels': '5' },
      members: [{ type: 'way', role: 'outer', geometry: poly(cx, cy, w, w, 0, 'rect').map(LL) }, { type: 'way', role: 'inner', geometry: poly(cx, cy, w * 0.5, w * 0.5, 0, 'rect').map(LL) }] });
  }
  el.push({ type: 'relation', id: id++, tags: { building: 'yes', type: 'multipolygon' }, members: [{ type: 'way', role: 'outer' }] });
  el.push({ type: 'way', id: id++, tags: { building: 'yes' }, geometry: [LL([0, 0]), LL([5, 0])] });       // degenerate
  el.push({ type: 'way', id: id++, tags: { building: 'yes' } });                                           // no geometry
  // streets: irregular grid + kinds
  const kinds = ['primary', 'secondary', 'tertiary', 'residential', 'residential', 'service', 'footway', 'steps', 'path'];
  for (let k = -R; k <= R; k += 70 + rnd() * 40) {
    el.push({ type: 'way', id: id++, tags: { highway: kinds[Math.floor(rnd() * kinds.length)] }, geometry: [[-R, k], [0, k + rnd() * 30], [R, k + rnd() * 30]].map(LL) });
    el.push({ type: 'way', id: id++, tags: { highway: kinds[Math.floor(rnd() * kinds.length)] }, geometry: [[k, -R], [k + rnd() * 30, 0], [k + rnd() * 30, R]].map(LL) });
  }
  // sea to the west: coastline line + green
  el.push({ type: 'way', id: id++, tags: { natural: 'coastline' }, geometry: [[-R * 0.7, -R], [-R * 0.6, 0], [-R * 0.75, R]].map(LL) });
  el.push({ type: 'way', id: id++, tags: { leisure: 'park' }, geometry: poly(300, -300, 150, 100, 0.2, 'rect').map(LL) });
  el.push({ type: 'relation', id: id++, tags: { natural: 'water', type: 'multipolygon' }, members: [{ role: 'outer', geometry: poly(-500, 400, 80, 60, 0, 'rect').map(LL) }] });
  return { version: 0.6, elements: el };
}
// Walk network: nodes + ways (out body / skel) + POIs with centers
function walk(R = 1300) {
  const el = [], nid = (i, j) => 1e6 + (i + 50) * 1000 + (j + 50); let w = 1;
  const step = 75, N = Math.floor(R / step);
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const jx = (rnd() - 0.5) * 20, jy = (rnd() - 0.5) * 20;
    el.push({ type: 'node', id: nid(i, j), lat: lat0 + (j * step + jy) * mLat, lon: lng0 + (i * step + jx) * mLng });
  }
  for (let i = -N; i <= N; i++) {
    let row = [], col = [];
    for (let j = -N; j <= N; j++) {
      row.push(nid(i, j)); col.push(nid(j, i));
      if (rnd() < 0.08 && row.length > 1) { el.push({ type: 'way', id: w++, tags: { highway: 'residential' }, nodes: row }); row = [nid(i, j + 1 > N ? j : j + 1)]; }   // gaps / dead ends
    }
    if (row.length > 1) el.push({ type: 'way', id: w++, tags: { highway: 'residential' }, nodes: row });
    el.push({ type: 'way', id: w++, tags: { highway: rnd() < 0.3 ? 'footway' : 'tertiary' }, nodes: col });
  }
  // an island component not connected to the rest
  el.push({ type: 'node', id: 9e6, lat: lat0 + 2000 * mLat, lon: lng0 }, { type: 'node', id: 9e6 + 1, lat: lat0 + 2050 * mLat, lon: lng0 });
  el.push({ type: 'way', id: w++, tags: { highway: 'path' }, nodes: [9e6, 9e6 + 1] });
  const pois = [['amenity', 'cafe'], ['amenity', 'restaurant'], ['shop', 'supermarket'], ['shop', 'bakery'], ['amenity', 'school'], ['amenity', 'kindergarten'], ['amenity', 'pharmacy'], ['amenity', 'clinic'], ['highway', 'bus_stop'], ['railway', 'station'], ['leisure', 'park'], ['leisure', 'playground']];
  let p = 5e6;
  for (let i = 0; i < 160; i++) {
    const [k, v] = pois[Math.floor(rnd() * pois.length)], x = (rnd() * 2 - 1) * R, y = (rnd() * 2 - 1) * R;
    if (k === 'leisure' && rnd() < 0.5) el.push({ type: 'way', id: p++, center: { lat: lat0 + y * mLat, lon: lng0 + x * mLng }, tags: { [k]: v, name: v + ' ' + i } });
    else el.push({ type: 'node', id: p++, lat: lat0 + y * mLat, lon: lng0 + x * mLng, tags: { [k]: v, name: v + ' ' + i } });
  }
  return { version: 0.6, elements: el };
}
// ERA5-like year for Istanbul incl. leap year and a few nulls
function meteo(year = 2024) {
  const time = [], T = [], RH = [], P = [], ws = [], wd = [], G = [];
  const days = year % 4 === 0 ? 366 : 365;
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) {
    time.push(new Date(Date.UTC(year, 0, 1) + (d * 24 + h) * 36e5).toISOString().slice(0, 16));
    const season = -Math.cos(2 * Math.PI * (d - 20) / days), diurnal = -Math.cos(2 * Math.PI * (h - 4) / 24);
    T.push(+(15 + 9 * season + 3.5 * diurnal + (rnd() - 0.5) * 4).toFixed(1)); RH.push(Math.round(72 - 12 * diurnal - 6 * season));
    P.push(rnd() < (season < 0 ? 0.08 : 0.025) ? +(rnd() * 4).toFixed(1) : 0);
    const north = rnd() < (season > 0 ? 0.7 : 0.55);
    ws.push(+(north ? 3 + rnd() * 6 : 1 + rnd() * 9).toFixed(1)); wd.push(Math.round(north ? 10 + rnd() * 40 : 190 + rnd() * 40));
    G.push(Math.max(0, Math.round((850 - 350 * (1 - season) / 2) * Math.sin(Math.PI * (h - 6) / 12) * (0.5 + 0.5 * rnd()))));
  }
  T[100] = null; ws[200] = null; wd[200] = null; P[300] = null; G[400] = null;
  return { latitude: lat0, longitude: lng0, timezone: 'Europe/Istanbul', hourly: { time, temperature_2m: T, relative_humidity_2m: RH, precipitation: P, wind_speed_10m: ws, wind_direction_10m: wd, shortwave_radiation: G } };
}
function elevation(url) {
  const lat = new URL(url).searchParams.get('latitude').split(',');
  return { elevation: lat.map((_, i) => (i % 10 < 2 ? 0 : 5 + (i % 10) * 6 + Math.floor(i / 10) * 3)) };   // sea on the west edge
}
module.exports = { lat0, lng0, osm, walk, meteo, elevation };
