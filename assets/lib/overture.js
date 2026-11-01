// a_tools Overture Maps reader: buildings (OpenStreetMap plus footprints traced from satellite imagery by Microsoft,
// Google and others), roads and rail, water, land use and land cover, read from Overture's monthly PMTiles with range
// requests (assets/lib/pmtiles.js). Features come back as OpenStreetMap-style elements, so the same parsers read them.
// ATOverture.load(site, half, { themes: ['buildings', 'transportation', 'base'], onStep }) →
//   { release, elements: [{ type, id, tags, geometry | members }], sea: [{ outer, holes }] (lng/lat), counts }
(function () {
const BUCKET = 'https://overturemaps-extras-us-west-2.s3.amazonaws.com/';
const FALLBACK = '2026-10-21.0';
const ZOOM = { buildings: 14, transportation: 14, base: 13 };
const credit = 'Overture Maps Foundation (ODbL and CDLA Permissive 2.0; buildings include OpenStreetMap and Microsoft, Google and Esri footprints traced from imagery)';

let releaseP = null;
// The newest release folder (tiles/YYYY-MM-DD.N/), from the public bucket listing.
function release() {
  if (!releaseP) releaseP = fetch(BUCKET + '?list-type=2&prefix=tiles/&delimiter=/').then(r => r.ok ? r.text() : '').then(t => {
    const v = [...t.matchAll(/<Prefix>tiles\/(\d{4}-\d{2}-\d{2}\.\d+)\/<\/Prefix>/g)].map(m => m[1]).sort();
    return v.length ? v[v.length - 1] : FALLBACK;
  }).catch(() => FALLBACK);
  return releaseP;
}

// ---------- Clipping to a tile, so pieces from neighbouring tiles meet without overlap ----------
function clipRing(r, b) {
  const edges = [[p => p[0] >= b.west, (a, c) => cut(a, c, 0, b.west)], [p => p[0] <= b.east, (a, c) => cut(a, c, 0, b.east)],
    [p => p[1] >= b.south, (a, c) => cut(a, c, 1, b.south)], [p => p[1] <= b.north, (a, c) => cut(a, c, 1, b.north)]];
  let out = r.slice(0, -1);
  for (const [ins, x] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], c = inp[(i + 1) % inp.length];
      if (ins(c)) { if (!ins(a)) out.push(x(a, c)); out.push(c); } else if (ins(a)) out.push(x(a, c));
    }
    if (!out.length) return [];
  }
  return out.length >= 3 ? [...out, out[0]] : [];
}
function cut(a, c, k, v) { const t = (v - a[k]) / (c[k] - a[k]); return k === 0 ? [v, a[1] + t * (c[1] - a[1])] : [a[0] + t * (c[0] - a[0]), v]; }
function clipLine(l, b) {
  const out = []; let cur = null;
  for (let i = 0; i + 1 < l.length; i++) {
    let [x0, y0] = l[i], [x1, y1] = l[i + 1], t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    const ok = [[-dx, x0 - b.west], [dx, b.east - x0], [-dy, y0 - b.south], [dy, b.north - y0]].every(([p, q]) => {
      if (p === 0) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; });
    if (!ok) { cur = null; continue; }
    const A = [x0 + t0 * dx, y0 + t0 * dy], B = [x0 + t1 * dx, y0 + t1 * dy];
    if (!cur || t0 > 0) { cur = [A]; out.push(cur); }
    cur.push(B); if (t1 < 1) cur = null;
  }
  return out.filter(p => p.length >= 2);
}
const area = r => { let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
const G = r => r.map(([lon, lat]) => ({ lat, lon }));
const json = s => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } };
const flags = s => (json(s) || []).flatMap(f => f.values || []);

// ---------- Overture properties → OpenStreetMap tags ----------
const ROAD = /^(motorway|trunk|primary|secondary|tertiary|residential|service|unclassified|living_street|pedestrian|footway|steps|path|track|cycleway|bridleway)$/;
const RAIL = { standard_gauge: 'rail', narrow_gauge: 'narrow_gauge', light_rail: 'light_rail', subway: 'subway', tram: 'tram', monorail: 'monorail', funicular: 'funicular' };
function segmentTags(p) {
  const f = flags(p.road_flags), t = { name: p['@name'] || '' };
  if (f.includes('is_bridge')) t.bridge = 'yes';
  if (f.includes('is_tunnel')) t.tunnel = 'yes';
  if (p.subtype === 'road') { t.highway = ROAD.test(p.class) ? p.class : 'road'; return t; }
  if (p.subtype === 'rail') { t.railway = RAIL[p.class] || 'rail'; return t; }
  return null;
}
const LANDUSE = /^(farmland|orchard|vineyard|grass|meadow|cemetery|allotments|recreation_ground|village_green|plant_nursery|forest|greenhouse_horticulture)$/;
const LEISURE = /^(park|garden|pitch|golf_course|nature_reserve|playground|dog_park)$/;
const NATURAL = { forest: ['landuse', 'forest'], wood: ['natural', 'wood'], scrub: ['natural', 'scrub'], shrub: ['natural', 'scrub'], heath: ['natural', 'heath'], grass: ['natural', 'grassland'], grassland: ['natural', 'grassland'],
  wetland: ['natural', 'wetland'], marsh: ['natural', 'wetland'], swamp: ['natural', 'wetland'], bog: ['natural', 'wetland'], reedbed: ['natural', 'wetland'], sand: ['natural', 'sand'], beach: ['natural', 'beach'], dune: ['natural', 'sand'],
  bare_rock: ['natural', 'bare_rock'], scree: ['natural', 'scree'], shingle: ['natural', 'beach'] };
const COVER = { forest: ['natural', 'wood'], shrub: ['natural', 'scrub'], grass: ['natural', 'grassland'], crop: ['landuse', 'farmland'], wetland: ['natural', 'wetland'], mangrove: ['natural', 'wetland'] };
const WATERWAY = /^(river|stream|canal|ditch|drain)$/;
function baseTags(layer, p, type) {
  const c = p.class || '', name = p['@name'] || '';
  if (layer === 'land_use') {
    if (LEISURE.test(c)) return { leisure: c, name };
    if (LANDUSE.test(c)) return { landuse: c, name };
    if (c === 'nature_reserve' || p.subtype === 'protected') return null;
    return null;
  }
  if (layer === 'land') {
    if (type === 1) return c === 'tree' ? { natural: 'tree' } : null;
    if (type === 2) return c === 'tree_row' ? { natural: 'tree_row' } : null;
    const m = NATURAL[c]; return m ? { [m[0]]: m[1], name } : null;
  }
  if (layer === 'land_cover') { const m = COVER[p.subtype]; return m ? { [m[0]]: m[1], 'overture:cover': 'yes' } : null; }
  if (layer === 'water') {
    if (type === 2) return WATERWAY.test(c) ? { waterway: c, name, intermittent: p.is_intermittent ? 'yes' : undefined } : null;
    if (type === 3 && !/^(ocean|sea)$/.test(c) && !/^(physical|human_made)$/.test(p.subtype)) return { natural: 'water', name };
  }
  return null;
}
function buildingTags(p) {
  const t = { building: p.class || (p.subtype && p.subtype !== 'outbuilding' ? p.subtype : 'yes'), name: p['@name'] || '', 'overture:source': p['@geometry_source'] || '' };
  if (p.height) t.height = String(p.height);
  if (p.num_floors) t['building:levels'] = String(p.num_floors);
  if (p.min_height) t.min_height = String(p.min_height);
  if (p.roof_shape) t['roof:shape'] = p.roof_shape;
  if (p.subtype === 'religious') { t.amenity = 'place_of_worship'; if (p.class === 'mosque') t.religion = 'muslim'; }
  return t;
}

async function load(o, half, { themes = ['buildings', 'transportation', 'base'], onStep = () => {} } = {}) {
  const L = ATUtm.local(o), sw = L.ll(-half - 30, -half - 30), ne = L.ll(half + 30, half + 30);
  const rel = await release(), elements = [], counts = {}, seaPieces = [], landRings = []; let bathy = false, id = 1;
  for (const theme of themes) {
    const a = await ATPmtiles.open(`${BUCKET}tiles/${rel}/${theme}.pmtiles`), tiles = ATPmtiles.cover(sw.lng, sw.lat, ne.lng, ne.lat, ZOOM[theme]);
    if (tiles.length > 64) throw Object.assign(new Error('too many tiles'), { why: 'The area is too big.' });
    let done = 0;
    await Promise.all(tiles.map(async ([z, x, y]) => {
      const bytes = await ATPmtiles.tile(a, z, x, y); onStep(`${theme} ${++done}/${tiles.length}`); if (!bytes) return;
      const layers = ATPmtiles.decode(bytes, z, x, y), b = ATPmtiles.bounds(z, x, y);
      const poly = (geom, tags) => geom.forEach(rings => {
        const rs = rings.map(r => clipRing(r, b)).filter(r => r.length >= 4); if (!rs.length || rs[0].length < 4) return;
        if (rs.length === 1) elements.push({ type: 'way', id: id++, tags, geometry: G(rs[0]) });
        else elements.push({ type: 'relation', id: id++, tags: { ...tags, type: 'multipolygon' }, members: rs.map((r, i) => ({ type: 'way', role: i ? 'inner' : 'outer', geometry: G(r) })) });
      });
      const line = (geom, tags) => geom.forEach(l => clipLine(l, b).forEach(p => elements.push({ type: 'way', id: id++, tags, geometry: G(p) })));
      if (theme === 'buildings') (layers.building || []).forEach(f => { if (f.type === 3 && !f.props.is_underground) { poly(f.geom, buildingTags(f.props)); const [lon, lat] = f.geom[0][0][0], [px, py] = L.xy(lat, lon); if (Math.abs(px) <= half && Math.abs(py) <= half) counts.buildings = (counts.buildings || 0) + 1; } });
      if (theme === 'transportation') (layers.segment || []).forEach(f => { const t = f.type === 2 && segmentTags(f.props); if (t) { line(f.geom, t); counts.roads = (counts.roads || 0) + 1; } });
      if (theme === 'base') {
        ['land_use', 'land', 'land_cover', 'water'].forEach(ln => (layers[ln] || []).forEach(f => {
          const t = baseTags(ln, f.props, f.type); if (!t) return;
          if (f.type === 1) f.geom.forEach(([lon, lat]) => { if (lon >= b.west && lon < b.east && lat > b.south && lat <= b.north) elements.push({ type: 'node', id: id++, lat, lon, tags: t }); });
          else if (f.type === 2) line(f.geom, t); else poly(f.geom, t);
          counts[ln] = (counts[ln] || 0) + 1;
        }));
        (layers.water || []).forEach(f => { if (f.type === 3 && /^(ocean|sea)$/.test(f.props.class || '')) f.geom.forEach(rings => { const rs = rings.map(r => clipRing(r, b)).filter(r => r.length >= 4); if (rs.length) seaPieces.push({ outer: rs[0], holes: rs.slice(1) }); }); });
        if ((layers.bathymetry || []).length) bathy = true;
        (layers.land || []).forEach(f => { if (f.type === 3 && f.props.subtype === 'land') f.geom.forEach(rings => { const r = clipRing(rings[0], b); if (r.length >= 4) landRings.push(r, ...rings.slice(1).map(h => clipRing(h, b)).filter(h => h.length >= 4)); }); });
      }
    }));
  }
  // Sea: Overture's ocean polygons, else (along coasts mapped only as land) the square minus the land polygons.
  let sea = seaPieces;
  if (!sea.length && bathy && landRings.length) sea = [{ outer: [[sw.lng, sw.lat], [ne.lng, sw.lat], [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat]], holes: landRings }];
  return { release: rel, elements, sea, counts, credit };
}

window.ATOverture = { load, release, credit, clipRing, clipLine, area };
})();
