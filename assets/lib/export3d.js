// a_tools site-model writers: Rhino .3dm (rhino3dm.js, loaded on first use), DXF R12 with layers, polyface meshes
// and tree blocks, OBJ with groups, GeoTIFF (float32, EPSG:4326), and laser-cut plate sheets (SVG / DXF).
// Scene X = {
//   note, P(x, y, z) → [X, Y, Z] (local or UTM),
//   layers: [[path, [r, g, b]]]                       paths use '::' for sub-layers, e.g. 'Terrain::Contours'
//   meshes: [{ name, layer, pos: Float64Array xyz, idx: Uint32Array }],
//   lines:  [{ layer, pts: [[x, y, z]], closed, name }],
//   points: [{ layer, p: [x, y, z], name }],
//   blocks: { NAME: { layer, pos, idx } } unit geometry, inserts: [{ block, layer, p: [x, y, z], s: [sx, sy, sz] }] }
(function () {
const RHINO = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/';
let rhinoP = null;
// The script is loaded once; each export gets a fresh module instance, because rhino3dm 8.17 can leave its heap
// corrupted after a file with block definitions, and the next export in the same instance then crashes the page.
function rhinoFactory() {
  if (!rhinoP) rhinoP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = RHINO + 'rhino3dm.min.js';
    s.onload = () => res(window.rhino3dm);
    s.onerror = () => rej(Object.assign(new Error('rhino3dm'), { why: 'The Rhino file library could not be loaded. Check the connection or use DXF.' }));
    document.head.appendChild(s);
  });
  rhinoP.catch(() => { rhinoP = null; });
  return rhinoP;
}
const rhino = () => rhinoFactory().then(f => f({ locateFile: n => RHINO + n }));

async function write3dm(X) {
  const rh = await rhino(), doc = new rh.File3dm();
  const idx = {};
  X.layers.forEach(([path, c]) => {
    const parts = path.split('::'); let parent = null, acc = '';
    parts.forEach(name => {
      acc = acc ? acc + '::' + name : name;
      if (idx[acc] == null) {
        const L = new rh.Layer(); L.name = name; L.color = { r: c[0], g: c[1], b: c[2], a: 255 };
        if (parent != null) L.parentLayerId = doc.layers().findIndex(parent).id;
        idx[acc] = doc.layers().add(L);
      }
      parent = idx[acc];
    });
  });
  const attr = (layer, name) => { const a = new rh.ObjectAttributes(); a.layerIndex = idx[layer] != null ? idx[layer] : 0; if (name) a.name = String(name).slice(0, 120); return a; };
  const mesh = (pos, ix, P) => {
    // Ask the mesh for its vertex and face lists on every call: holding the list wrappers across calls
    // corrupts rhino3dm 8.17's heap, and the next block definition then crashes the page.
    const m = new rh.Mesh();
    for (let i = 0; i < pos.length; i += 3) { const q = P(pos[i], pos[i + 1], pos[i + 2]); m.vertices().add(q[0], q[1], q[2]); }
    for (let i = 0; i < ix.length; i += 3) m.faces().addTriFace(ix[i], ix[i + 1], ix[i + 2]);
    m.normals().computeNormals(); m.compact(); return m;
  };
  // The document keeps its own copies, so every temporary wasm object is freed once added: tens of thousands of
  // leaked attributes and transforms (one per tree) used to exhaust the wasm heap and crash the page on large sites.
  const add = (geo, a) => { doc.objects().add(geo, a); geo.delete(); a.delete(); };
  X.meshes.forEach(m => { if (m.idx.length) add(mesh(m.pos, m.idx, X.P), attr(m.layer, m.name)); });
  X.lines.forEach(l => {
    if (l.pts.length < 2) return;
    const pl = new rh.Polyline(l.pts.length + 1);
    l.pts.forEach(p => { const q = X.P(p[0], p[1], p[2]); pl.add(q[0], q[1], q[2]); });
    if (l.closed) { const q = X.P(...l.pts[0]); pl.add(q[0], q[1], q[2]); }
    add(pl.toPolylineCurve(), attr(l.layer, l.name)); pl.delete();
  });
  X.points.forEach(pt => { const q = X.P(...pt.p), a = attr(pt.layer, pt.name); doc.objects().addPoint(q, a); a.delete(); });
  const ids = {};
  Object.entries(X.blocks || {}).forEach(([name, b]) => {
    doc.instanceDefinitions().add(name, 'a_tools ' + name.toLowerCase(), '', '', [0, 0, 0], [mesh(b.pos, b.idx, (x, y, z) => [x, y, z])], [attr(b.layer)]);
    ids[name] = doc.instanceDefinitions().get(doc.instanceDefinitions().count - 1).id;
  });
  (X.inserts || []).forEach(t => {
    const q = X.P(...t.p), xf = rh.Transform.identity();
    xf.m00 = t.s[0]; xf.m11 = t.s[1]; xf.m22 = t.s[2]; xf.m03 = q[0]; xf.m13 = q[1]; xf.m23 = q[2];
    add(new rh.InstanceReference(ids[t.block], xf), attr(t.layer)); xf.delete();
  });
  doc.settings().modelUnitSystem = rh.UnitSystem.Meters; doc.settings().modelBasepoint = [0, 0, 0];
  return doc.toByteArray();
}

// ---------- DXF (R12) ----------
const f3 = v => (Math.round(v * 1000) / 1000).toString();
const dxfName = p => p.replace(/::/g, '-').replace(/[^A-Za-z0-9_\- ]/g, '_');
// Nearest AutoCAD colour index for an RGB colour (greys and a few hues are enough for layer colours).
function aci([r, g, b]) {
  const pal = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [8, 128, 128, 128], [9, 192, 192, 192],
    [250, 51, 51, 51], [251, 80, 80, 80], [252, 105, 105, 105], [253, 130, 130, 130], [254, 190, 190, 190], [255, 255, 255, 255],
    [30, 255, 127, 0], [52, 255, 223, 127], [82, 95, 191, 0], [92, 63, 127, 0], [134, 0, 127, 191], [142, 76, 153, 204], [152, 63, 95, 127], [171, 0, 63, 255]];
  let best = 7, bd = Infinity; pal.forEach(([c, R, G, B]) => { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = c; } }); return best;
}
function polyface(o, layer, pos, ix, P) {
  // R12 polyface meshes hold at most 32767 vertices: split into chunks.
  let start = 0;
  while (start < ix.length) {
    const map = new Map(), verts = [], faces = [];
    let k = start;
    for (; k < ix.length; k += 3) {
      const need = [ix[k], ix[k + 1], ix[k + 2]].filter(v => !map.has(v)).length;
      if (verts.length + need > 32000) break;
      faces.push([ix[k], ix[k + 1], ix[k + 2]].map(v => { if (!map.has(v)) { map.set(v, verts.length + 1); verts.push(v); } return map.get(v); }));
    }
    o.push('0', 'POLYLINE', '8', layer, '66', '1', '10', '0', '20', '0', '30', '0', '70', '64', '71', String(verts.length), '72', String(faces.length));
    verts.forEach(v => { const q = P(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); o.push('0', 'VERTEX', '8', layer, '10', f3(q[0]), '20', f3(q[1]), '30', f3(q[2]), '70', '192'); });
    faces.forEach(fc => o.push('0', 'VERTEX', '8', layer, '10', '0', '20', '0', '30', '0', '70', '128', '71', String(fc[0]), '72', String(fc[1]), '73', String(fc[2])));
    o.push('0', 'SEQEND', '8', layer);
    start = k;
  }
}
function writeDxf(X) {
  const o = ['999', X.note, '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC'];
  o.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(X.layers.length + 1));
  o.push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS');
  X.layers.forEach(([p, c]) => o.push('0', 'LAYER', '2', dxfName(p), '70', '0', '62', String(aci(c)), '6', 'CONTINUOUS'));
  o.push('0', 'ENDTAB', '0', 'ENDSEC');
  o.push('0', 'SECTION', '2', 'BLOCKS');
  Object.entries(X.blocks || {}).forEach(([name, b]) => {
    o.push('0', 'BLOCK', '8', '0', '2', name, '70', '0', '10', '0', '20', '0', '30', '0', '3', name);
    polyface(o, '0', b.pos, b.idx, (x, y, z) => [x, y, z]);   // layer 0 inside a block takes the insert's layer
    o.push('0', 'ENDBLK', '8', '0');
  });
  o.push('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  X.meshes.forEach(m => polyface(o, dxfName(m.layer), m.pos, m.idx, X.P));
  X.lines.forEach(l => {
    if (l.pts.length < 2) return; const L = dxfName(l.layer);
    o.push('0', 'POLYLINE', '8', L, '66', '1', '10', '0', '20', '0', '30', '0', '70', l.closed ? '9' : '8');
    l.pts.forEach(p => { const q = X.P(p[0], p[1], p[2]); o.push('0', 'VERTEX', '8', L, '10', f3(q[0]), '20', f3(q[1]), '30', f3(q[2]), '70', '32'); });
    o.push('0', 'SEQEND', '8', L);
  });
  X.points.forEach(pt => { const q = X.P(...pt.p); o.push('0', 'POINT', '8', dxfName(pt.layer), '10', f3(q[0]), '20', f3(q[1]), '30', f3(q[2])); });
  (X.inserts || []).forEach(t => { const q = X.P(...t.p); o.push('0', 'INSERT', '8', dxfName(t.layer), '2', t.block, '10', f3(q[0]), '20', f3(q[1]), '30', f3(q[2]), '41', f3(t.s[0]), '42', f3(t.s[1]), '43', f3(t.s[2])); });
  o.push('0', 'ENDSEC', '0', 'EOF');
  return o.join('\n') + '\n';
}

// ---------- OBJ (Y up, north is −Z) ----------
function writeObj(X) {
  const out = ['# ' + X.note, '# metres, Y up, north is -Z'], v = [];
  let n = 1;
  const put = (name, layer, pos, ix, P) => {
    out.push('o ' + name.replace(/\s+/g, '_'), 'g ' + dxfName(layer));
    for (let i = 0; i < pos.length; i += 3) { const q = P(pos[i], pos[i + 1], pos[i + 2]); out.push(`v ${f3(q[0])} ${f3(q[2])} ${f3(-q[1])}`); }
    for (let i = 0; i < ix.length; i += 3) out.push(`f ${ix[i] + n} ${ix[i + 1] + n} ${ix[i + 2] + n}`);
    n += pos.length / 3;
  };
  X.meshes.forEach(m => put(m.name, m.layer, m.pos, m.idx, X.P));
  // Trees: copies of the block geometry.
  const byBlock = {};
  (X.inserts || []).forEach(t => (byBlock[t.block + '|' + t.layer] = byBlock[t.block + '|' + t.layer] || []).push(t));
  Object.entries(byBlock).forEach(([key, list]) => {
    const [name, layer] = key.split('|'), b = X.blocks[name], nv = b.pos.length / 3;
    const pos = new Float64Array(list.length * b.pos.length), ix = new Uint32Array(list.length * b.idx.length);
    list.forEach((t, k) => {
      for (let i = 0; i < nv; i++) { pos[k * nv * 3 + 3 * i] = t.p[0] + b.pos[3 * i] * t.s[0]; pos[k * nv * 3 + 3 * i + 1] = t.p[1] + b.pos[3 * i + 1] * t.s[1]; pos[k * nv * 3 + 3 * i + 2] = t.p[2] + b.pos[3 * i + 2] * t.s[2]; }
      for (let i = 0; i < b.idx.length; i++) ix[k * b.idx.length + i] = b.idx[i] + k * nv;
    });
    put(name.toLowerCase() + 's', layer, pos, ix, X.P);
  });
  X.lines.forEach(l => {
    if (l.pts.length < 2) return;
    out.push('g ' + dxfName(l.layer));
    l.pts.forEach(p => { const q = X.P(p[0], p[1], p[2]); out.push(`v ${f3(q[0])} ${f3(q[2])} ${f3(-q[1])}`); });
    const ids = l.pts.map((_, i) => n + i); if (l.closed) ids.push(n);
    out.push('l ' + ids.join(' ')); n += l.pts.length;
  });
  return out.join('\n') + '\n';
}

// ---------- GeoTIFF: one float32 band, rows from the north, EPSG:4326 ----------
function geotiff(data, w, h, west, north, dLng, dLat, nodata = -9999) {
  const tags = [], extra = [];
  const ascii = 'a_tools terrain model\0', nod = String(nodata) + '\0';
  const dataOff = 8, dataLen = w * h * 4;
  // Layout: header, pixel data (one strip), then extra arrays, then the IFD.
  let off = dataOff + dataLen;
  const put = (id, type, count, bytes) => { if (bytes.length <= 4) tags.push({ id, type, count, inline: bytes }); else { tags.push({ id, type, count, off }); extra.push(bytes); off += bytes.length + (bytes.length % 2); } };
  const u16 = a => new Uint8Array(new Uint16Array(a).buffer), u32 = a => new Uint8Array(new Uint32Array(a).buffer), f64 = a => new Uint8Array(new Float64Array(a).buffer), str = s => new TextEncoder().encode(s);
  put(256, 4, 1, u32([w])); put(257, 4, 1, u32([h])); put(258, 3, 1, u16([32])); put(259, 3, 1, u16([1])); put(262, 3, 1, u16([1]));
  put(270, 2, ascii.length, str(ascii)); put(273, 4, 1, u32([dataOff])); put(277, 3, 1, u16([1])); put(278, 4, 1, u32([h])); put(279, 4, 1, u32([dataLen]));
  put(284, 3, 1, u16([1])); put(339, 3, 1, u16([3]));
  put(33550, 12, 3, f64([dLng, dLat, 0])); put(33922, 12, 6, f64([0, 0, 0, west, north, 0]));
  put(34735, 3, 16, u16([1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]));
  put(42113, 2, nod.length, str(nod));
  const ifdOff = off + (off % 2), n = tags.length, total = ifdOff + 2 + n * 12 + 4;
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
  new Float32Array(buf, dataOff, w * h).set(data);
  let p = dataOff + dataLen; extra.forEach(b => { u8.set(b, p); p += b.length + (b.length % 2); });
  dv.setUint16(ifdOff, n, true);
  tags.sort((a, b) => a.id - b.id).forEach((t, i) => {
    const e = ifdOff + 2 + i * 12; dv.setUint16(e, t.id, true); dv.setUint16(e + 2, t.type, true); dv.setUint32(e + 4, t.count, true);
    if (t.inline) u8.set(t.inline, e + 8); else dv.setUint32(e + 8, t.off, true);
  });
  dv.setUint32(ifdOff + 2 + n * 12, 0, true);
  return buf;
}

// ---------- Laser-cut sheets ----------
// pieces: [{ plate, outer: [[x, y]] mm, holes, score: [[[x, y]]] mm, label }]; shelf-packed onto sheets W × H mm.
function pack(pieces, W, H, gap = 4) {
  const bb = r => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; r.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
  const items = pieces.map(p => ({ p, b: bb(p.outer) })).sort((a, b) => b.b.h - a.b.h);
  const sheets = [];
  items.forEach(it => {
    if (it.b.w > W - 2 * gap || it.b.h > H - 2 * gap) { sheets.push({ items: [{ ...it, dx: gap - it.b.x0, dy: gap - it.b.y0 }], over: true }); return; }
    let placed = false;
    for (const s of sheets) {
      if (s.over) continue;
      for (const sh of s.shelves) if (it.b.h <= sh.h && sh.x + it.b.w <= W - gap) { s.items.push({ ...it, dx: sh.x - it.b.x0, dy: sh.y - it.b.y0 }); sh.x += it.b.w + gap; placed = true; break; }
      if (placed) break;
      const y = s.shelves.length ? s.shelves[s.shelves.length - 1].y + s.shelves[s.shelves.length - 1].h + gap : gap;
      if (y + it.b.h <= H - gap) { s.shelves.push({ y, h: it.b.h, x: gap + it.b.w + gap }); s.items.push({ ...it, dx: gap - it.b.x0, dy: y - it.b.y0 }); placed = true; break; }
    }
    if (!placed) sheets.push({ shelves: [{ y: gap, h: it.b.h, x: gap + it.b.w + gap }], items: [{ ...it, dx: gap - it.b.x0, dy: gap - it.b.y0 }] });
  });
  return sheets.map(s => ({ items: s.items, over: !!s.over }));
}
// Sheets side by side in one SVG (mm). Red = cut, blue = score, black = engrave.
function laserSvg(sheets, W, H, title) {
  const gap = 30, tw = sheets.length * (W + gap) - gap, th = H + 24;
  const d = (r, it) => 'M' + r.map(([x, y]) => (x + it.dx).toFixed(2) + ',' + (H - (y + it.dy)).toFixed(2)).join('L') + 'Z';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}mm" height="${th}mm" viewBox="0 0 ${tw} ${th}">\n<title>${title}</title>\n`;
  sheets.forEach((sh, k) => {
    s += `<g id="sheet-${k + 1}" transform="translate(${k * (W + gap)} 0)">\n<rect id="sheet-${k + 1}-frame" width="${W}" height="${H}" fill="none" stroke="#999999" stroke-width="0.1" stroke-dasharray="2 2"/>\n`;
    s += `<text x="0" y="${H + 8}" font-family="Arial" font-size="5" fill="#999999">Sheet ${k + 1} of ${sheets.length}${sh.over ? ' (piece larger than the sheet)' : ''}</text>\n`;
    s += `<g id="sheet-${k + 1}-score" fill="none" stroke="#0000ff" stroke-width="0.1">` + sh.items.map(it => (it.p.score || []).map(r => `<path d="${d(r, it)}"/>`).join('')).join('') + '</g>\n';
    s += `<g id="sheet-${k + 1}-engrave" fill="#000000" font-family="Arial" font-size="4" text-anchor="middle">` + sh.items.map(it => it.p.labelAt ? `<text x="${(it.p.labelAt[0] + it.dx).toFixed(1)}" y="${(H - (it.p.labelAt[1] + it.dy) + 1.4).toFixed(1)}">${it.p.label}</text>` : '').join('') + '</g>\n';
    s += `<g id="sheet-${k + 1}-cut" fill="none" stroke="#ff0000" stroke-width="0.1">` + sh.items.map(it => `<path d="${[it.p.outer, ...(it.p.holes || [])].map(r => d(r, it)).join('')}"/>`).join('') + '</g>\n</g>\n';
  });
  return s + '</svg>\n';
}
function laserDxf(sheets, W, H) {
  const gap = 30, o = ['999', 'a_tools laser plates, millimetres. CUT red, SCORE blue, ENGRAVE black.', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '4',
    '0', 'LAYER', '2', 'CUT', '70', '0', '62', '1', '6', 'CONTINUOUS', '0', 'LAYER', '2', 'SCORE', '70', '0', '62', '5', '6', 'CONTINUOUS',
    '0', 'LAYER', '2', 'ENGRAVE', '70', '0', '62', '7', '6', 'CONTINUOUS', '0', 'LAYER', '2', 'SHEET', '70', '0', '62', '8', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES'];
  const poly = (L, pts, ox) => { o.push('0', 'POLYLINE', '8', L, '66', '1', '10', '0', '20', '0', '30', '0', '70', '1'); pts.forEach(([x, y]) => o.push('0', 'VERTEX', '8', L, '10', f3(x + ox), '20', f3(y), '30', '0')); o.push('0', 'SEQEND', '8', L); };
  sheets.forEach((sh, k) => {
    const ox = k * (W + gap);
    poly('SHEET', [[0, 0], [W, 0], [W, H], [0, H]], ox);
    sh.items.forEach(it => {
      const mv = r => r.map(([x, y]) => [x + it.dx, y + it.dy]);
      [it.p.outer, ...(it.p.holes || [])].forEach(r => poly('CUT', mv(r), ox));
      (it.p.score || []).forEach(r => poly('SCORE', mv(r), ox));
      if (it.p.labelAt) o.push('0', 'TEXT', '8', 'ENGRAVE', '10', f3(it.p.labelAt[0] + it.dx + ox), '20', f3(it.p.labelAt[1] + it.dy - 1.4), '30', '0', '40', '4', '1', it.p.label, '72', '1', '11', f3(it.p.labelAt[0] + it.dx + ox), '21', f3(it.p.labelAt[1] + it.dy - 1.4), '31', '0');
    });
  });
  o.push('0', 'ENDSEC', '0', 'EOF');
  return o.join('\n') + '\n';
}

window.ATExport = { rhino, write3dm, writeDxf, writeObj, geotiff, pack, laserSvg, laserDxf, aci };
})();
