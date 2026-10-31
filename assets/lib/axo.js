// a_tools axonometric drawing of building masses (painter's algorithm, SVG).
// Used by tools/context-3d and tools/site-sheet.
(function () {
const rad = Math.PI / 180;

// buildings: [{ outer, holes, z0, z1 }] in local metres (outer rings counter-clockwise).
// Returns inner markup for <svg viewBox="0 0 W H">, seen from compass direction viewAz.
function svg(buildings, { R, viewAz = 225, terrain = null, siteZ = 0, W = 1000, H = 700, pad = 30, north = true } = {}) {
  const a = (viewAz - 180) * rad, ca = Math.cos(a), sa = Math.sin(a), k = 0.5;
  const rot = ([x, y, z]) => [x * ca - y * sa, x * sa + y * ca, z];
  const faces = [];
  const shade = (n, base) => {   // n: rotated outward normal (x, y); light from the viewer's left
    const l = Math.max(0, (-n[0] * .6 - n[1] * .8));
    const v = Math.round(base + 60 * l);
    return `rgb(${v},${v - 3},${v - 10})`;
  };
  buildings.forEach(b => {
    [b.outer, ...b.holes].forEach(r => r.forEach((p, i) => {
      const q = r[(i + 1) % r.length];
      const A = rot([p[0], p[1], b.z0]), B = rot([q[0], q[1], b.z0]);
      const nx = B[1] - A[1], ny = -(B[0] - A[0]);   // outward normal for counter-clockwise outer rings
      if (ny >= 0) return;                            // faces away from the viewer
      const len = Math.hypot(nx, ny) || 1;
      faces.push({ d: (A[1] + B[1]) / 2, pts: [A, B, rot([q[0], q[1], b.z1]), rot([p[0], p[1], b.z1])], fill: shade([nx / len, ny / len], 165) });
    }));
    const roof = b.outer.map(p => rot([p[0], p[1], b.z1]));
    faces.push({ d: roof.reduce((s, p) => s + p[1], 0) / roof.length + 0.01, pts: roof, holes: b.holes.map(h => h.map(p => rot([p[0], p[1], b.z1]))), fill: '#f4f2ec' });
  });
  let ground = null;
  if (terrain) terrain.forEach(t => faces.push({ d: Math.max(...t.map(p => rot(p)[1])) + 1e6, pts: t.map(rot), fill: '#e9e6dd', ground: true }));
  else ground = [[-R, -R, 0], [R, -R, 0], [R, R, 0], [-R, R, 0]].map(rot);
  faces.sort((f, g) => g.d - f.d);
  // Fit to the viewBox.
  const proj = p => [p[0], -p[1] * k - p[2]];
  const all = faces.flatMap(f => f.pts.map(proj)).concat(ground ? ground.map(proj) : []);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  all.forEach(([x, y]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; });
  const S = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
  const ox = W / 2 - (minX + maxX) / 2 * S, oy = H / 2 - (minY + maxY) / 2 * S;
  const P = p => { const [u, v] = proj(p); return (ox + u * S).toFixed(1) + ',' + (oy + v * S).toFixed(1); };
  const ring = pts => 'M' + pts.map(P).join('L') + 'Z';
  let s = '';
  if (ground) s += `<path d="${ring(ground)}" fill="#e9e6dd" stroke="#d6d2c7"/>`;
  faces.forEach(f => {
    s += f.ground ? `<path d="${ring(f.pts)}" fill="${f.fill}" stroke="${f.fill}" stroke-width=".6"/>`
      : `<path d="${ring(f.pts)}${(f.holes || []).map(ring).join('')}" fill="${f.fill}" fill-rule="evenodd" stroke="#4a4945" stroke-width=".35" stroke-linejoin="round"/>`;
  });
  // Site marker at ground level and a north arrow.
  const sp = P(rot([0, 0, siteZ])).split(',');
  s += `<circle cx="${sp[0]}" cy="${sp[1]}" r="6" fill="#c8553d" stroke="#fff" stroke-width="2"/>`;
  if (north) {
    const n = rot([0, 1, 0]), nl = Math.hypot(n[0], n[1] * k) || 1, nx = n[0] / nl, ny = -n[1] * k / nl;
    s += `<g class="axo-n" transform="translate(${W - 50} 60)"><circle r="22" fill="#fff" stroke="#e3e0d8"/><path d="M${nx * 16} ${ny * 16} L${-ny * 8 - nx * 12} ${nx * 8 - ny * 12} L${-nx * 5} ${-ny * 5} L${ny * 8 - nx * 12} ${-nx * 8 - ny * 12}Z" fill="#1b1b19"/>` +
         `<text x="${nx * 32}" y="${ny * 32 + 4}" text-anchor="middle" font-size="12" font-weight="600" font-family="Inter, sans-serif" fill="#1b1b19">N</text></g>`;
  }
  return s;
}

window.ATAxo = { svg };
})();
