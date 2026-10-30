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
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
  if (!r.ok) throw new Error(r.status);
  return parse(await r.json(), site, R);
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
       `<path d="M960 30 L972 66 L960 58 L948 66 Z" fill="${ink}"/><text x="960" y="86" font-size="14" text-anchor="middle" font-weight="600">N</text></g>`;
  return s;
}

// Building count, built coverage (0–1), median footprint (m²) and grain label.
function stats(geo) {
  const areas = geo.buildings.map(b => b.reduce((a, r, i) => a + (i === 0 ? area(r) : -area(r)), 0)).filter(a => a > 4).sort((a, b) => a - b);
  const total = areas.reduce((a, b) => a + b, 0), median = areas[Math.floor(areas.length / 2)] || 0;
  return { count: areas.length, coverage: total / (4 * geo.R * geo.R), median,
    grain: !median ? '–' : median < 150 ? 'Fine' : median < 600 ? 'Medium' : 'Coarse' };
}

window.ATFabric = { load, parse, svg, stats, area };
})();
