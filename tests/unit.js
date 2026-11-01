// Unit checks for shared libraries (no browser). Run: node tests/unit.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { window: {}, console, earcut: require('earcut'), Math };
vm.createContext(ctx);
['assets/lib/fabric.js', 'assets/lib/model.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const { ATFabric: F, ATModel: M } = ctx.window;
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

console.log(fails ? `\n${fails} failed` : '\nall unit checks passed'); process.exit(fails ? 1 : 0);
