// a_tools 3D model library: triangle meshes for buildings, domes, minarets and a printable ground slab,
// and writers for OBJ, DXF (3DFACE + polylines + points) and binary STL. Units are metres, Z up, north +Y.
// Needs earcut (https://cdn.jsdelivr.net/npm/earcut@2.2.4) for roofs and floors.
(function () {
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const normal = t => cross(sub(t[1], t[0]), sub(t[2], t[0]));
// Flip a triangle so it faces away from point c (for convex pieces: domes, cylinders, cones).
const away = (t, c) => { const n = normal(t), m = sub(t[0], c); return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0 ? [t[0], t[2], t[1]] : t; };

// Flat polygon (outer counter-clockwise, holes clockwise) at height z, facing up or down.
function cap(rings, z, up) {
  const flat = [], holes = [], pts = [], out = [];
  rings.forEach((r, k) => { if (k) holes.push(pts.length); r.forEach(p => { pts.push(p); flat.push(p[0], p[1]); }); });
  const idx = earcut(flat, holes.length ? holes : null, 2);
  for (let i = 0; i < idx.length; i += 3) {
    let [A, B, C] = [idx[i], idx[i + 1], idx[i + 2]].map(k => pts[k]);
    const ccw = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]) > 0;
    if (ccw !== up) [B, C] = [C, B];
    out.push([[A[0], A[1], z], [B[0], B[1], z], [C[0], C[1], z]]);
  }
  return out;
}
// Walls between z0 and z1 for every ring (outer counter-clockwise, holes clockwise: normals point out).
function walls(rings, z0, z1) {
  const out = [];
  rings.forEach(r => r.forEach((p, i) => {
    const q = r[(i + 1) % r.length], a = [p[0], p[1], z0], b = [q[0], q[1], z0], c = [q[0], q[1], z1], d = [p[0], p[1], z1];
    out.push([a, b, c], [a, c, d]);
  }));
  return out;
}
// Half-ellipsoid of radius rr and height hh standing on z at (x, y).
function dome(x, y, z, rr, hh, nu = 20, nv = 6) {
  const out = [], P = (i, j) => { const u = i / nu * 2 * Math.PI, v = j / nv * Math.PI / 2; return [x + rr * Math.cos(v) * Math.cos(u), y + rr * Math.cos(v) * Math.sin(u), z + hh * Math.sin(v)]; };
  const c = [x, y, z];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
    if (j < nv - 1) out.push(away([a, b, cc], c), away([a, cc, d], c)); else out.push(away([a, b, d], c));
  }
  for (let i = 0; i < nu; i++) out.push(away([c, P(i + 1, 0), P(i, 0)], [x, y, z + hh]));   // base, facing down
  return out;
}
// Building with the shape the drawing uses: g = { z0, z1, top, rr, domeH, pyrH }.
function building(b, g) {
  const rings = [b.outer, ...(b.holes || [])], out = walls(rings, g.z0, g.z1);
  out.push(...cap(rings, g.z0, false));
  if (g.pyrH > 0.2) {
    const apex = [b.c[0], b.c[1], g.top], mid = [b.c[0], b.c[1], g.z1];
    b.outer.forEach((p, i) => { const q = b.outer[(i + 1) % b.outer.length]; out.push(away([[p[0], p[1], g.z1], [q[0], q[1], g.z1], apex], mid)); });
    (b.holes || []).forEach(h => out.push(...cap([h], g.z1, true)));
  } else out.push(...cap(rings, g.z1, true));
  if (g.rr > 0.5 && g.domeH > 0.3) out.push(...dome(b.c[0], b.c[1], g.z1, g.rr, g.domeH));
  return out;
}
// Minaret or tower: 12-sided cylinder from zb to zt and a cone of height cone.
function spire(p, r, zb, zt, cone, n = 12) {
  const out = [], C = (i, z, rr = r) => [p[0] + rr * Math.cos(i / n * 2 * Math.PI), p[1] + rr * Math.sin(i / n * 2 * Math.PI), z];
  const mid = [p[0], p[1], (zb + zt) / 2], apex = [p[0], p[1], zt + cone];
  for (let i = 0; i < n; i++) {
    out.push(away([C(i, zb), C(i + 1, zb), C(i + 1, zt)], mid), away([C(i, zb), C(i + 1, zt), C(i, zt)], mid));
    out.push(away([C(i, zb), C(i + 1, zb), [p[0], p[1], zb]], [p[0], p[1], zb + 1]));
    out.push(away([C(i, zt, r * 1.05), C(i + 1, zt, r * 1.05), apex], mid), away([C(i, zt, r * 1.05), C(i + 1, zt, r * 1.05), [p[0], p[1], zt]], apex));
  }
  return out;
}
// Ground: an n × n grid over the square |x|,|y| <= R following gz, and a closed base `thick` metres below its lowest point.
function ground(gz, R, n, thick) {
  const st = 2 * R / n, P = (i, j) => { const x = -R + i * st, y = -R + j * st; return [x, y, gz(x, y)]; };
  const top = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    top.push([a, b, c], [a, c, d]);
  }
  let zmin = Infinity; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) zmin = Math.min(zmin, P(i, j)[2]);
  const zb = zmin - thick, base = [], edge = [];
  for (let i = 0; i < n; i++) edge.push(P(i, 0)); for (let j = 0; j < n; j++) edge.push(P(n, j));
  for (let i = n; i > 0; i--) edge.push(P(i, n)); for (let j = n; j > 0; j--) edge.push(P(0, j));   // counter-clockwise
  edge.forEach((p, k) => { const q = edge[(k + 1) % edge.length], a = [p[0], p[1], zb], b = [q[0], q[1], zb]; base.push([a, b, q], [a, q, p]); });
  edge.forEach((p, k) => { const q = edge[(k + 1) % edge.length]; base.push([[0, 0, zb], [q[0], q[1], zb], [p[0], p[1], zb]]); });   // bottom fan, facing down
  return { top, base, zb };
}

const f3 = v => (Math.round(v * 1000) / 1000).toString();
// m = { parts: [{ name, layer, tris }], lines: [{ layer, pts: [[x,y,z]], closed }], points: [{ layer, p }], note }
function obj(m) {
  const out = ['# ' + m.note, '# metres, Y up, north is -Z'];
  let n = 1;
  m.parts.forEach(p => {
    if (!p.tris.length) return;
    out.push('o ' + p.name, 'g ' + p.layer);
    p.tris.forEach(t => { t.forEach(([x, y, z]) => out.push(`v ${f3(x)} ${f3(z)} ${f3(-y)}`)); out.push(`f ${n} ${n + 1} ${n + 2}`); n += 3; });
  });
  return out.join('\n') + '\n';
}
function dxf(m) {
  const o = ['999', m.note, '0', 'SECTION', '2', 'ENTITIES'];
  m.parts.forEach(p => p.tris.forEach(t => {
    o.push('0', '3DFACE', '8', p.layer);
    [...t, t[2]].forEach(([x, y, z], i) => o.push(String(10 + i), f3(x), String(20 + i), f3(y), String(30 + i), f3(z)));
  }));
  (m.lines || []).forEach(l => {
    if (l.pts.length < 2) return;
    o.push('0', 'POLYLINE', '8', l.layer, '66', '1', '70', l.closed ? '9' : '8');
    l.pts.forEach(([x, y, z]) => o.push('0', 'VERTEX', '8', l.layer, '10', f3(x), '20', f3(y), '30', f3(z), '70', '32'));
    o.push('0', 'SEQEND', '8', l.layer);
  });
  (m.points || []).forEach(({ layer, p }) => o.push('0', 'POINT', '8', layer, '10', f3(p[0]), '20', f3(p[1]), '30', f3(p[2])));
  o.push('0', 'ENDSEC', '0', 'EOF');
  return o.join('\n') + '\n';
}
function stl(m) {
  const tris = m.parts.flatMap(p => p.tris), buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  const head = 'a_tools model, metres, Z up, (c) OpenStreetMap contributors';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const o = 84 + i * 50, nrm = normal(t), l = Math.hypot(...nrm) || 1;
    nrm.forEach((x, j) => dv.setFloat32(o + j * 4, x / l, true));
    t.forEach((p, k) => p.forEach((x, j) => dv.setFloat32(o + 12 + k * 12 + j * 4, x, true)));
  });
  return buf;
}

window.ATModel = { cap, walls, dome, building, spire, ground, obj, dxf, stl, normal };
})();
