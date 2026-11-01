// Unit checks for shared libraries (no browser). Run: node tests/unit.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { window: {}, console, earcut: require('earcut'), Math, TextEncoder, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, DataView, Map, Set, TextDecoder };
vm.createContext(ctx);
['assets/lib/fabric.js', 'assets/lib/model.js', 'assets/lib/utm.js', 'assets/lib/terrain.js', 'assets/lib/land.js', 'assets/lib/export3d.js', 'assets/lib/pmtiles.js', 'assets/lib/overture.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const { ATFabric: F, ATModel: M, ATUtm: U, ATTerrain: TR, ATLand: LD, ATExport: EX, ATPmtiles: PM, ATOverture: OV } = ctx.window;
let fails = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const near = (a, b, e) => Math.abs(a - b) <= e;

// Roof stripping: a 20 m slope with +12 m building bumps 40 m wide every 100 m (5 m samples).
const step = 5, ground = i => 20 + i * step * 0.03, dsm = [...Array(120)].map((_, i) => ground(i) + ((i * step) % 100 < 40 ? 12 : 0));
const op = F.openProfile(dsm, step, 60);
const left = Math.max(...op.slice(10, 110).map((z, i) => z - ground(i + 10)));   // the ends keep a bump when a building sits on them
ok(left < 2.5, 'openProfile removes 12 m roof bumps (max left ' + left.toFixed(1) + ' m)');
const hill = [...Array(120)].map((_, i) => 80 * Math.exp(-(((i - 60) * step) ** 2) / (2 * 120 ** 2)));
ok(near(Math.max(...F.openProfile(hill, step, 60)), 80, 3), 'openProfile keeps a real hill');
const n = 12, g = [...Array(n * n)].map((_, k) => { const i = k % n, j = Math.floor(k / n); return 10 + i + ((i % 3 === 1 && j % 3 === 1) ? 12 : 0); });
const og = F.openGrid(g, n, 40, 100);
ok(og.every((z, k) => z - (10 + (k % n)) < 1.5), 'openGrid removes single-cell 12 m bumps');
const peak = [...Array(n * n)].map((_, k) => (k === 5 * n + 5 ? 90 : 0)), op2 = F.openGrid(peak, n, 90, 200);
ok(op2[5 * n + 5] >= 78, `openGrid keeps a narrow summit within 12 m (90 m peak → ${op2[5 * n + 5]} m; Ankara Kalesi was flattened)`);

// GHSL in villages reads about 3 m (houses averaged with empty ground): houses are two storeys there (Şirince).
ok(F.estimate({ building: 'house' }, 70, 12345, 3, 9, 3) === 6 && F.estimate({ building: 'yes' }, 120, 7, 4.2, 9, 3) === 6, 'GHSL under 5 m gives two-storey houses');
ok(F.estimate({ building: 'yes' }, 30, 7, 3, 9, 3) === 3, 'GHSL under 5 m keeps a small shed at one storey');
// Landmark names that only repeat the feature type are dropped (Çanakkale "feribot").
ok(['feribot', 'Cami', 'park', 'otopark', 'çay bahçesi'].every(F.genericName) && !['Güvenpark', 'Kızılay Meydanı', 'Yalı Camii', 'Anıtkabir', '天坛'].some(F.genericName), 'generic landmark names filtered, real names kept');

// Nearest-cell staircase: treads of equal values become a straight slope.
const stairs = [...Array(60)].map((_, i) => 100 + 10 * Math.floor(i / 10));   // 10 m steps every 10 samples
const ds = F.destair(stairs), jump = Math.max(...ds.slice(1).map((z, i) => Math.abs(z - ds[i])));
ok(jump < 1.5, `destair turns 10 m cliffs into a slope (largest step ${jump.toFixed(2)} m)`);
const sg = [...Array(144)].map((_, k) => 50 + 8 * Math.floor((k % 12) / 4) + 8 * Math.floor(Math.floor(k / 12) / 4)), dg = F.destairGrid(sg, 12);
ok(Math.max(...dg.map((z, k) => k % 12 ? Math.abs(z - dg[k - 1]) : 0)) < 3.5, 'destairGrid smooths a blocky grid');

// Meshes: closed solids with the right volume.
const vol = t => t.reduce((v, [a, b, c]) => v + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);
const open = t => { const E = new Map(), k = p => p.map(v => (Math.round(v * 1000) / 1000 + 0).toFixed(3)).join(','); t.forEach(tr => { for (let i = 0; i < 3; i++) { const e = k(tr[i]) + '|' + k(tr[(i + 1) % 3]); E.set(e, (E.get(e) || 0) + 1); } });
  let bad = 0; E.forEach((v, e) => { const [a, b] = e.split('|'); if ((E.get(b + '|' + a) || 0) !== v) bad++; }); return bad; };
const box = { outer: [[0, 0], [10, 0], [10, 20], [0, 20]], holes: [], c: [5, 10] };
let t = M.building(box, { z0: 0, z1: 9, top: 9, rr: 0, domeH: 0, pyrH: 0 });
ok(near(vol(t), 1800, 0.01) && !open(t), 'box building is closed, 1800 m³');
t = M.building(box, { z0: 0, z1: 9, top: 13, rr: 0, domeH: 0, pyrH: 4 });
ok(near(vol(t), 1800 + 800 / 3, 0.01) && !open(t), 'pyramid roof is closed, volume right');
const court = { outer: [[0, 0], [30, 0], [30, 30], [0, 30]], holes: [[[10, 10], [10, 20], [20, 20], [20, 10]]], c: [15, 15] };
t = M.building(court, { z0: 0, z1: 6, top: 6, rr: 0, domeH: 0, pyrH: 0 });
ok(near(vol(t), 800 * 6, 0.01) && !open(t), 'courtyard building is closed, hole subtracted');
const gm = M.ground((x, y) => 0.1 * x + 5, 50, 10, 5);
ok(near(vol([...gm.top, ...gm.base]), 100000, 0.1) && !open([...gm.top, ...gm.base]), 'printable ground slab is closed');
ok(near(vol(M.dome(0, 0, 0, 10, 10)), 2 / 3 * Math.PI * 1000, 120), 'dome volume close to a hemisphere');
ok(vol(M.spire([0, 0], 2, 0, 30, 5)) > 0, 'spire faces point outwards');
// Writers
const m = { parts: [{ name: 'b', layer: 'Buildings', tris: M.building(box, { z0: 0, z1: 9, top: 9, rr: 0, domeH: 0, pyrH: 0 }) }], lines: [{ layer: 'Streets', pts: [[0, 0, 0], [5, 5, 0]] }], points: [{ layer: 'Trees', p: [1, 2, 0] }], note: 'test' };
ok(M.obj(m).split('\nf ').length - 1 === 12, 'OBJ has 12 faces');
const dx = M.dxf(m); ok(dx.split('3DFACE').length - 1 === 12 && dx.includes('POLYLINE') && dx.includes('POINT') && dx.trim().endsWith('EOF'), 'DXF has faces, polyline, point and EOF');
ok(M.stl(m).byteLength === 84 + 12 * 50, 'STL size is right');

// ---------- Terrain Model libraries ----------
// UTM round trip and Sentinel-2 tile names (35TMK covers 25.7–27.1 E, 44.2–45.1 N).
const u = U.toUtm(40.1467, 26.4086), back = U.fromUtm(u.e, u.n, u.zone, u.south);
ok(u.zone === 35 && near(back.lat, 40.1467, 1e-7) && near(back.lng, 26.4086, 1e-7) && near(u.e, 449626.3, 0.5), `UTM forward and back (${u.e.toFixed(1)} E ${u.n.toFixed(1)} N)`);
ok(U.mgrs(45.1, 25.8).id === '35TMK' && U.mgrs(-33.9, 18.4).zone === 34, 'Sentinel-2 tile name from a point');
// A cone 50 m high, radius 400 m, on a 101 × 101 grid of 10 m: contours are closed circles of the right size.
const cone = (n, st, f) => { const h = (n - 1) * st / 2, z = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = f(-h + i * st, -h + j * st); return TR.stats({ n, step: st, half: h, z }); };
const T1 = cone(101, 10, (x, y) => Math.max(0, 50 - Math.hypot(x, y) / 8));
const cl = TR.contours(T1, 10), c20 = cl.filter(l => l.z === 20);
const rad20 = c20.length === 1 ? Math.sqrt(Math.abs(TR.signedArea(c20[0].pts)) / Math.PI) : 0;
ok(c20.length === 1 && c20[0].closed && near(rad20, 240, 4), `contour at 20 m is one closed ring of radius 240 m (${rad20.toFixed(1)})`);
ok(cl.every(l => l.closed) && [...new Set(cl.map(l => l.z))].join() === '10,20,30,40,50', 'cone contours at 10 to 50 m, all closed');
// Plates: the region above 20 m is one piece of area π·240²; the base plate cut at the edge closes along the square.
const pl = TR.plateRegions(T1, 20);
ok(pl.length === 1 && near(Math.abs(TR.signedArea(pl[0].outer)), Math.PI * 240 * 240, 3000) && !pl[0].holes.length, 'plate above 20 m: one piece, right area');
const T2 = cone(101, 10, (x, y) => 30 + x / 20 - 20 * Math.exp(-(x * x + y * y) / 2e4));   // a slope with a hollow: plate with a hole
const pl2 = TR.plateRegions(T2, 25);
ok(pl2.length >= 1 && pl2.some(p => p.holes.length === 1 || p.outer.some(([x]) => near(Math.abs(x), 500, 1e-6))), 'plate on a slope closes along the square edge');
// Shaping: a pad levels the ground under a building, a bench levels a road across a slope, a bed never rises downstream.
const T3 = cone(101, 4, (x, y) => 100 + 0.1 * x);
const bld = { outer: [[-20, -10], [20, -10], [20, 10], [-20, 10]], holes: [] };
TR.pads(T3, [bld], 4);
ok(near(TR.at(T3, -19, 0), TR.at(T3, 19, 0), 0.01) && near(bld.pad, 100, 0.5), `building pad is flat at the median ground (${bld.pad.toFixed(2)} m)`);
const T4 = cone(101, 4, (x, y) => 100 + 0.2 * y);
TR.benches(T4, [{ pts: [[-150, 0], [150, 0]], width: 8 }]);
ok(near(TR.at(T4, 0, -3), TR.at(T4, 0, 3), 0.05), 'road bench is level across the road');
const T5 = cone(101, 4, (x, y) => 100 - 0.05 * x + 3 * Math.sin(x / 15));
TR.channels(T5, [{ pts: [[-180, 0], [180, 0]], width: 4, depth: 1 }]);
const bed = [...Array(36)].map((_, i) => TR.at(T5, -175 + i * 10, 0));
ok(bed.every((z, i) => !i || z <= bed[i - 1] + 0.05), 'stream bed never rises downstream');
// Flow: on a tilted valley the main flow line runs down the valley floor.
const T6 = cone(81, 10, (x, y) => 200 - 0.05 * y + 0.002 * x * x);
const A6 = TR.analyse(T6, { streamArea: 5e4 });
const main = A6.streams.sort((a, b) => b.area - a.area)[0];
ok(main && main.pts.every(([x]) => Math.abs(x) <= 30) && main.pts[main.pts.length - 1][1] > 300, 'flow line follows the valley floor downhill (north)');
ok(near(A6.slope[40 * 81 + 40], Math.atan(0.05) * 180 / Math.PI, 0.1) && near(A6.aspect[40 * 81 + 40], 0, 1) && near(A6.aspect[40 * 81 + 50], 270, 15), 'slope and aspect: valley floor faces north, east side faces west');
// Multipolygon rings assembled from split member ways.
const rings = LD.assemble([[[0, 0], [10, 0]], [[10, 0], [10, 10], [0, 10]], [[0, 0], [0, 10]]]);
ok(rings.length === 1 && rings[0].length === 4, 'multipolygon ways joined into one ring');
// GeoTIFF header and geo keys.
const gt = new DataView(EX.geotiff(new Float32Array([1, 2, 3, 4]), 2, 2, 26, 40, 0.001, 0.001));
ok(gt.getUint16(0) === 0x4949 && gt.getUint16(2, true) === 42 && gt.getFloat32(8, true) === 1 && gt.getFloat32(20, true) === 4, 'GeoTIFF: little-endian, float pixels in order');
// DXF: polyface meshes split under 32767 vertices, tree blocks inserted.
const n7 = 200, pos7 = new Float64Array(n7 * n7 * 3), idx7 = [];
for (let j = 0; j < n7; j++) for (let i = 0; i < n7; i++) pos7.set([i, j, 0], 3 * (j * n7 + i));
for (let j = 0; j + 1 < n7; j++) for (let i = 0; i + 1 < n7; i++) { const a = j * n7 + i; idx7.push(a, a + 1, a + n7 + 1, a, a + n7 + 1, a + n7); }
const X7 = { note: 't', P: (x, y, z) => [x, y, z], layers: [['Terrain', [200, 200, 200]], ['Vegetation::Trees', [100, 140, 90]]], meshes: [{ name: 'g', layer: 'Terrain', pos: pos7, idx: Uint32Array.from(idx7) }], lines: [], points: [],
  blocks: { TREE: { layer: 'Vegetation::Trees', pos: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 1]), idx: new Uint32Array([0, 1, 2]) } }, inserts: [{ block: 'TREE', layer: 'Vegetation::Trees', p: [1, 2, 3], s: [2, 2, 8] }] };
const d7 = EX.writeDxf(X7), counts = [...d7.matchAll(/\n70\n64\n71\n(\d+)\n72\n(\d+)/g)].map(m => +m[1]);
ok(counts.length >= 2 && counts.every(c => c <= 32767) && /INSERT\n8\nVegetation-Trees\n2\nTREE/.test(d7), `DXF: ${counts.length} polyface chunks under 32767 vertices, tree inserted as a block`);
// Laser sheets: every piece lands inside a sheet.
const sh = EX.pack([...Array(9)].map((_, k) => ({ outer: [[0, 0], [150, 0], [150, 100], [0, 100]], holes: [], label: String(k) })), 400, 300);
ok(sh.length === 3 && sh.every(s => s.items.every(it => it.p.outer.every(([x, y]) => x + it.dx >= 0 && x + it.dx <= 400 && y + it.dy >= 0 && y + it.dy <= 300))), `laser pieces packed on ${sh.length} sheets inside the edges`);

// ---------- Overture / PMTiles ----------
ok(PM.tileId(0, 0, 0) === 0 && [[0, 0], [0, 1], [1, 1], [1, 0]].map(([x, y]) => PM.tileId(1, x, y)).join() === '1,2,3,4' && PM.tileId(2, 0, 0) === 5, 'PMTiles tile ids follow the Hilbert curve');
// A hand-made vector tile: layer "building" with one square (keys/values) and layer "segment" with one line.
const vint = v => { const o = []; while (v > 127) { o.push((v & 127) | 128); v = Math.floor(v / 128); } o.push(v); return o; };
const zzE = v => (v << 1) ^ (v >> 31), fld = (f, w) => vint(f * 8 + w), lenD = (f, b) => [...fld(f, 2), ...vint(b.length), ...b], str = t => [...new TextEncoder().encode(t)];
const feat = (type, geom, tags) => lenD(2, [...lenD(2, tags.flatMap(vint)), ...fld(3, 0), ...vint(type), ...lenD(4, geom.flatMap(vint))]);
const sq = [9, zzE(1024), zzE(1024), 26, zzE(1024), 0, 0, zzE(1024), zzE(-1024), 0, 15];   // MoveTo, LineTo ×3, ClosePath: clockwise in tile space = exterior
const ln = [9, zzE(0), zzE(2048), 10, zzE(4096), 0];
const layer = (name, f, keys, vals) => lenD(3, [...fld(15, 0), 2, ...lenD(1, str(name)), ...f, ...keys.flatMap(k => lenD(3, str(k))), ...vals.flatMap(v => lenD(4, lenD(1, str(v)))), ...fld(5, 0), ...vint(4096)]);
const mvt = Uint8Array.from([...layer('building', feat(3, sq, [0, 0]), ['class'], ['mosque']), ...layer('segment', feat(2, ln, [0, 0, 1, 1]), ['subtype', 'class'], ['road', 'primary'])]);
const lay = PM.decode(mvt, 1, 1, 0), bf = lay.building && lay.building[0], sf = lay.segment && lay.segment[0];
ok(bf && bf.type === 3 && bf.props.class === 'mosque' && bf.geom.length === 1 && near(bf.geom[0][0][0][0], 45, 1e-9) && OV.area(bf.geom[0][0]) < 0, 'vector tile: polygon decoded with its tags, exterior ring clockwise on the map');
ok(sf && sf.type === 2 && sf.props.class === 'primary' && near(sf.geom[0][1][0], 180, 1e-9) && near(sf.geom[0][0][1], 66.5133, 1e-3), 'vector tile: line decoded to longitude / latitude');
const b9 = { west: 0, east: 10, south: 0, north: 10 };
const cr = OV.clipRing([[-5, 2], [5, 2], [5, 8], [-5, 8], [-5, 2]], b9);
ok(cr.length === 5 && near(Math.abs(OV.area(cr)), 30, 1e-9), 'Overture pieces clipped to their own tile, so neighbours meet without overlap');
const cl2 = OV.clipLine([[-5, 5], [5, 5], [5, 15], [8, 5], [15, 5]], b9);
ok(cl2.length === 2 && near(cl2[0][0][0], 0, 1e-9) && near(cl2[1][cl2[1].length - 1][0], 10, 1e-9), `a line leaving and re-entering a tile splits into ${cl2.length} pieces`);

console.log(fails ? `\n${fails} failed` : '\nall unit checks passed'); process.exit(fails ? 1 : 0);
