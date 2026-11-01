// a_tools urban fabric library: buildings, roads, water and green space from OpenStreetMap (Overpass),
// drawn as a 1000 × 1000 figure-ground. Used by tools/figure-ground and tools/site-sheet.
(function () {
const rad = Math.PI / 180;

// Square area of half-size R metres around the site, in local metres (y up).
async function load(site, R) {
  const dLat = R / 110540, dLng = R / (111320 * Math.cos(site.lat * rad));
  const bb = [site.lat - dLat, site.lng - dLng, site.lat + dLat, site.lng + dLng].map(x => x.toFixed(6)).join(',');
  const q = `[out:json][timeout:60][bbox:${bb}];
    (way["building"];relation["building"]["type"="multipolygon"];)->.b; .b out geom;
    way["highway"]["highway"!~"^(proposed|construction|platform|corridor|elevator|steps)$"]; out geom;
    (way["natural"="water"];relation["natural"="water"];way["waterway"="riverbank"];way["natural"="coastline"];)->.w; .w out geom;
    (way["leisure"~"^(park|garden|playground|pitch)$"];way["landuse"~"^(grass|forest|recreation_ground|cemetery|meadow)$"];relation["leisure"="park"];)->.g; .g out geom;`;
  const j = await ATools.overpass(q), geo = parse(j, site, R);
  geo.raw = j;   // kept so callers can build masses from the same download
  return geo;
}

function parse(j, site, R) {
  const xy = (lat, lng) => [(lng - site.lng) * 111320 * Math.cos(site.lat * rad), (lat - site.lat) * 110540];
  const rings = el => el.type === 'way'
    ? (el.geometry ? [el.geometry.map(g => xy(g.lat, g.lon))] : [])
    : (el.members || []).filter(m => m.geometry).map(m => m.geometry.map(g => xy(g.lat, g.lon)));
  const out = { R, buildings: [], roads: [], water: [], coast: [], green: [] };
  j.elements.forEach(el => {
    const t = el.tags || {};
    if (t.building) out.buildings.push(rings(el));
    else if (t.highway) out.roads.push({ line: rings(el)[0], kind: t.highway });
    else if (t.natural === 'coastline') out.coast.push(rings(el)[0]);
    else if (t.natural === 'water' || t.waterway) out.water.push(rings(el));
    else out.green.push(rings(el));
  });
  return out;
}

function area(ring) { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }

const ROAD_W = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3.2, residential: 2.4, unclassified: 2.4, service: 1.4,
                 living_street: 2, pedestrian: 2, footway: .9, path: .9, cycleway: .9, track: 1 };

// Inner markup for <svg viewBox="0 0 1000 1000">. style: figure | inverse | context.
function svg(geo, { style = 'figure', roads = true, water = true, green = true, site = true, id = 'fg' } = {}) {
  const R = geo.R, S = 1000 / (2 * R);
  const P = ([x, y]) => ((x + R) * S).toFixed(1) + ',' + ((R - y) * S).toFixed(1);
  const path = rs => rs.filter(r => r && r.length > 2).map(r => 'M' + r.map(P).join('L') + 'Z').join('');
  const line = r => r && r.length > 1 ? 'M' + r.map(P).join('L') : '';
  const inv = style === 'inverse';
  const bg = inv ? '#111' : '#fff', fig = inv ? '#fff' : '#111';
  const ctx = style === 'context';
  let s = `<defs><clipPath id="${id}-clip"><rect width="1000" height="1000"/></clipPath></defs><rect width="1000" height="1000" fill="${bg}"/><g clip-path="url(#${id}-clip)">`;
  if (green) s += `<g id="green" fill="${inv ? '#2d3a26' : '#dfe8d6'}">${geo.green.map(g => `<path d="${path(g)}" fill-rule="evenodd"/>`).join('')}</g>`;
  if (water) s += `<g id="water" fill="${inv ? '#1d2c3a' : '#d6e3ee'}">${geo.water.map(g => `<path d="${path(g)}" fill-rule="evenodd"/>`).join('')}</g>` +
    `<g id="coast" fill="none" stroke="${inv ? '#4a6a8a' : '#8fb0cc'}" stroke-width="1.2">${geo.coast.map(c => `<path d="${line(c)}"/>`).join('')}</g>`;
  if (roads) s += `<g id="roads" fill="none" stroke="${inv ? '#555' : '#c9c6bd'}" stroke-linecap="round" stroke-linejoin="round">` +
    geo.roads.map(r => `<path d="${line(r.line)}" stroke-width="${((ROAD_W[r.kind] || 1.2) * (500 / R)).toFixed(2)}"/>`).join('') + '</g>';
  s += `<g id="buildings" fill="${ctx ? '#b8b4aa' : fig}">${geo.buildings.map(b => `<path d="${path(b)}" fill-rule="evenodd"/>`).join('')}</g>`;
  if (site) s += `<g id="site"><circle cx="500" cy="500" r="${Math.max(10, 40 * 500 / R)}" fill="none" stroke="#c8553d" stroke-width="3"/><circle cx="500" cy="500" r="4" fill="#c8553d"/></g>`;
  s += '</g>';
  // scale bar + north arrow
  const bar = R >= 1000 ? 500 : R >= 500 ? 200 : 100, bw = bar * S, ink = inv ? '#fff' : '#111';
  s += `<g font-family="Inter, sans-serif" fill="${ink}"><rect x="30" y="952" width="${bw}" height="6" fill="${ink}"/><rect x="${30 + bw / 2}" y="952" width="${bw / 2}" height="6" fill="${bg}" stroke="${ink}" stroke-width="1"/>` +
       `<text x="30" y="944" font-size="14">0</text><text x="${30 + bw}" y="944" font-size="14" text-anchor="end">${bar} m</text>` +
       `<path d="M960 30 L972 66 L960 58 L948 66 Z" fill="${ink}"/><text x="960" y="86" font-size="14" text-anchor="middle" font-weight="600">N</text>` +
       `<text x="970" y="958" font-size="11" text-anchor="end" opacity=".7">© OpenStreetMap contributors</text></g>`;
  return s;
}

// Building count, built coverage (0–1), median footprint (m²) and grain label.
function stats(geo) {
  const areas = geo.buildings.map(b => b.reduce((a, r, i) => a + (i === 0 ? area(r) : -area(r)), 0)).filter(a => a > 4).sort((a, b) => a - b);
  const total = areas.reduce((a, b) => a + b, 0), median = areas[Math.floor(areas.length / 2)] || 0;
  return { count: areas.length, coverage: total / (4 * geo.R * geo.R), median,
    grain: !median ? '–' : median < 150 ? 'Fine' : median < 600 ? 'Medium' : 'Coarse' };
}

// ---------- Building masses (footprint + height) for 3D and shadow tools ----------
const xy = (lat, lng, o) => [(lng - o.lng) * 111320 * Math.cos(o.lat * rad), (lat - o.lat) * 110540];
const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : null; };
function signedArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
// Drop the closing duplicate point and orient: outer rings counter-clockwise, holes clockwise.
function clean(r, ccw) {
  r = r.slice(); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  if ((signedArea(r) > 0) !== ccw) r.reverse();
  return r;
}
function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
}
function osmHeight(t, defH, floorH) {
  const h = num(t.height);
  if (h) return { h, known: true };
  const lv = num(t['building:levels']);
  if (lv) return { h: (lv + (num(t['roof:levels']) || 0)) * floorH, known: true };
  return { h: defH, known: false };
}

// Height for a building with no height in OSM. Type defaults for monuments and small buildings first, then the
// GHSL average building height of its 90 m cell (g, metres, 0 when unknown) scaled by footprint area a, with ±1 floor
// of jitter from the id so blocks don't look uniform; else defH. Returns metres.
function estimate(t, a, id, g, defH, floorH = 3) {
  const tt = t['tower:type'] || '';
  if (tt === 'minaret' || t['building:part'] === 'minaret') return 45;
  if (t.man_made === 'tower' || t.building === 'tower') return tt === 'clock' ? 18 : 14;
  if (t.historic === 'castle' || t.building === 'castle') return 20;
  if (t.building === 'mosque' || (t.amenity === 'place_of_worship' && t.religion === 'muslim')) return Math.round(Math.min(24, Math.max(9, 4 + Math.sqrt(a) * 0.2)));
  if (/^(church|cathedral|chapel|synagogue)$/.test(t.building || '')) return 14;
  if (/^(garage|garages|shed|kiosk|roof|hut|carport)$/.test(t.building || '')) return Math.min(3, defH);
  if (!(g > 0)) return defH;
  const k = a < 50 ? 0.6 : a < 150 ? 0.9 : a < 600 ? 1 : 1.1, r = Math.abs(Math.round(+String(id).replace(/\D/g, '').slice(-6) || 0)) % 3;
  let fl = Math.max(a >= 80 ? 2 : 1, Math.round(Math.min(12, Math.max(1, g / 3.1 * k))) + r - 1);
  if (/^(house|bungalow|detached|semidetached_house)$/.test(t.building || '')) fl = Math.min(fl, 2);
  return fl * floorH;
}

// Buildings (and optionally streets) with tags, in a square of half-size R metres.
async function fetchMasses(site, R, { roads = false } = {}) {
  const dLat = R / 110540, dLng = R / (111320 * Math.cos(site.lat * rad));
  const bb = [site.lat - dLat, site.lng - dLng, site.lat + dLat, site.lng + dLng].map(x => x.toFixed(6)).join(',');
  const q = `[out:json][timeout:60][bbox:${bb}];
    (way["building"];relation["building"]["type"="multipolygon"];); out geom;
    ${roads ? 'way["highway"]["highway"!~"^(proposed|construction|platform|corridor|elevator|steps)$"]; out geom;' : ''}`;
  return ATools.overpass(q);
}

// Overpass JSON → [{ outer, holes, z0, z1, known, est }] in local metres; ground(x, y) gives the terrain height;
// ghsl (from ATGhsl.load) estimates unknown heights, est says which source was used ('ghsl' or 'default').
function masses(j, site, R, { defH = 9, floorH = 3, ground = () => 0, ghsl = null } = {}) {
  const out = [], P = g => xy(g.lat, g.lon, site);
  const inBox = r => r.some(([x, y]) => Math.abs(x) <= R && Math.abs(y) <= R);
  j.elements.forEach(el => {
    const t = el.tags || {};
    if (!t.building) return;
    let polys = [];
    if (el.type === 'way' && el.geometry && el.geometry.length > 3) polys = [{ outer: el.geometry.map(P), holes: [] }];
    else if (el.type === 'relation') {
      const ms = (el.members || []).filter(m => m.geometry && m.geometry.length > 3);
      polys = ms.filter(m => m.role !== 'inner').map(m => ({ outer: m.geometry.map(P), holes: [] }));
      ms.filter(m => m.role === 'inner').forEach(m => {
        const hole = m.geometry.map(P), p = polys.find(p => inside(hole[0], p.outer));
        if (p) p.holes.push(hole);
      });
    }
    const oh = osmHeight(t, defH, floorH);
    const minH = num(t.min_height) || 0;
    polys.forEach(p => {
      const outer = clean(p.outer, true);
      if (outer.length < 3 || !inBox(outer) || Math.abs(signedArea(outer)) < 2) return;
      const holes = p.holes.map(hh => clean(hh, false)).filter(hh => hh.length >= 3);
      const z0 = Math.min(...outer.map(([x, y]) => ground(x, y)));
      let h = oh.h, est = null;
      if (!oh.known) {
        const a = Math.abs(signedArea(outer)), cx = outer.reduce((s, q) => s + q[0], 0) / outer.length, cy = outer.reduce((s, q) => s + q[1], 0) / outer.length;
        const g = ghsl ? ghsl.at(cx, cy) : 0;
        h = estimate(t, a, el.id, g, defH, floorH); est = g > 0 ? 'ghsl' : 'default';
      }
      out.push({ outer, holes, z0: z0 + minH, z1: z0 + Math.max(h, minH + 1), known: oh.known, est, tags: t });
    });
  });
  return out;
}

// The Open-Meteo elevation model (Copernicus GLO-90) is a surface model: in dense blocks it rides over the roofs.
// A morphological opening (running minimum, then running maximum) removes bumps narrower than the window and keeps
// real slopes, so the ground follows the streets. openProfile: samples along a line, step in metres.
// openGrid: a row-major n × n grid with spacing step.
// Open-Meteo returns the nearest 90 m cell, so dense samples come back as flat treads with cliffs between them.
// destair: each run of equal values becomes one point at the run's middle, joined by straight lines.
function destair(z) {
  const n = z.length, mid = [];
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && z[j + 1] === z[i]) j++; mid.push([(i + j) / 2, z[i]]); i = j + 1; }
  if (mid.length < 2) return z.slice();
  return z.map((_, i) => {
    if (i <= mid[0][0]) return mid[0][1];
    if (i >= mid[mid.length - 1][0]) return mid[mid.length - 1][1];
    let k = 0; while (mid[k + 1][0] < i) k++;
    const [a, za] = mid[k], [b, zb] = mid[k + 1];
    return za + (zb - za) * (i - a) / (b - a);
  });
}
// The same on a row-major n × n grid: rows first, then columns.
function destairGrid(e, n) {
  const a = e.slice();
  for (let j = 0; j < n; j++) destair(a.slice(j * n, j * n + n)).forEach((v, i) => a[j * n + i] = v);
  for (let i = 0; i < n; i++) destair([...Array(n)].map((_, j) => a[j * n + i])).forEach((v, j) => a[j * n + i] = v);
  return a;
}
function openProfile(z, step, win = 60) {
  z = destair(z);
  const w = Math.max(1, Math.round(win / 2 / step)), n = z.length;
  const run = (a, f) => a.map((_, i) => f(...a.slice(Math.max(0, i - w), Math.min(n, i + w + 1))));
  return run(run(z, Math.min), Math.max);
}
function openGrid(e, n, step, win = 200) {
  e = destairGrid(e, n);
  const w = Math.max(1, Math.round(win / 2 / step));
  const pass = (a, f) => a.map((_, k) => { const i = k % n, j = Math.floor(k / n), v = [];
    for (let b = Math.max(0, j - w); b <= Math.min(n - 1, j + w); b++) for (let c = Math.max(0, i - w); c <= Math.min(n - 1, i + w); c++) v.push(a[b * n + c]);
    return f(...v); });
  return pass(pass(e, Math.min), Math.max);
}

window.ATFabric = { estimate, destair, destairGrid, openProfile, openGrid, load, parse, svg, stats, area, xy, signedArea, clean, inside, osmHeight, fetchMasses, masses };
})();
