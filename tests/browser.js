// Browser regression checks with all network calls mocked. Run: node tests/browser.js
// Needs Playwright with Chromium, plus leaflet and earcut from npm (see tests/package.json).
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const F = require('./fixtures/dense.js'), ROOT = 'file://' + path.join(__dirname, '..') + '/';
const LEAF = path.dirname(require.resolve('leaflet/dist/leaflet.js')), EARCUT = require.resolve('earcut/dist/earcut.min.js');
const { lat0, lng0 } = F, mLat = 1 / 110540, mLng = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
const LL = ([x, y]) => ({ lat: lat0 + y * mLat, lon: lng0 + x * mLng });
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(LL);
let fails = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const json = (r, o) => r.fulfill({ body: JSON.stringify(o), contentType: 'application/json' });

async function page(browser, file, { osm = F.osm(), elev = F.elevation, site = { lat: lat0, lng: lng0, name: 'Kadıköy, İstanbul' } } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(s => localStorage.setItem('atools.site', JSON.stringify(s)), site);
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text()) && p.errs.push(m.text()));
  await p.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('leaflet.js')) return r.fulfill({ path: LEAF + '/leaflet.js' });
    if (u.includes('leaflet.css')) return r.fulfill({ path: LEAF + '/leaflet.css' });
    if (u.includes('earcut')) return r.fulfill({ path: EARCUT, contentType: 'application/javascript' });
    if (/overpass|interpreter/.test(u)) return osm ? json(r, osm) : r.abort();
    if (u.includes('/v1/elevation')) return elev ? json(r, elev(u)) : r.abort();
    if (u.includes('archive-api.open-meteo')) return json(r, F.meteo(2024));
    if (u.startsWith('file:')) return r.continue();
    return r.abort();   // tiles, GHSL, Wikidata, fonts: offline
  });
  await p.goto(ROOT + file); await p.waitForTimeout(300);
  return p;
}
const runBtn = async (p, id = 'run') => { await p.click('#' + id); await p.waitForFunction(i => !document.getElementById(i).disabled, id, { timeout: 90000 }); await p.waitForTimeout(300); };

(async () => {
  const browser = await chromium.launch();

  // 1. Every tool opens, runs its main action on the dense fixture and throws no errors.
  for (const t of ['index.html', 'sun-shadow', 'climate', 'zoning', 'figure-ground', 'walkability', 'site-sheet', 'context-3d', 'sun-hours', 'facade-sun', 'precedents', 'site-section', 'urban-map', 'iso-map']) {
    const p = await page(browser, t.endsWith('.html') ? t : `tools/${t}/index.html`);
    for (const id of ['load', 'run']) if (await p.$(`#${id}:not([disabled])`)) { await runBtn(p, id).catch(e => p.errs.push('run: ' + e.message)); break; }
    ok(!p.errs.length, `${t} opens and runs without errors ${p.errs.length ? JSON.stringify(p.errs.slice(0, 2)) : ''}`);
    await p.context().close();
  }

  // 2. Site Section: a 580 m line through 14 buildings cuts all 14 (buildings near B were dropped before),
  //    and the ground does not ride over the roofs (the elevation model includes +12 m building bumps).
  {
    const sc = { elements: [] };
    for (let i = 0; i < 14; i++) { const x = -270 + i * 40; sc.elements.push({ type: 'way', id: 100 + i, tags: { building: 'yes', 'building:levels': String(2 + (i % 5)) }, geometry: box(x, -10, x + 22, 10) }); }
    sc.elements.push({ type: 'way', id: 5, tags: { highway: 'secondary', name: 'Test Caddesi', width: '12' }, geometry: [[-235, -80], [-235, 80]].map(LL) });
    const elev = url => { const u = new URL(url), la = u.searchParams.get('latitude').split(','), lo = u.searchParams.get('longitude').split(',').map(Number);
      return { elevation: la.map((_, i) => { const x = (lo[i] - lng0) / mLng, inB = ((x + 270) % 40 + 40) % 40 < 22 && x > -270 && x < 290; return +(20 + x * 0.03 + (inB ? 12 : 0)).toFixed(1); }) }; };
    const p = await page(browser, 'tools/site-section/index.html', { osm: sc, elev });
    await p.click('#draw');
    const mb = await (await p.$('#map')).boundingBox(), cx = mb.x + mb.width / 2, cy = mb.y + mb.height / 2;
    const mpp = await p.evaluate(() => 40075016.686 * Math.cos(41 * Math.PI / 180) / Math.pow(2, 17 + 8));
    await p.mouse.click(cx - 290 / mpp, cy); await p.mouse.click(cx + 290 / mpp, cy);
    await runBtn(p);
    const st = await p.textContent('#status'), stats = await p.$$eval('.stat', x => x.map(e => e.innerText.replace(/\s+/g, ' ')).join(' | '));
    ok(/14 building cuts/.test(st), 'Site Section cuts all 14 buildings on a long line: ' + st.trim());
    ok(/H\/W at Test Caddesi/.test(stats), 'Site Section measures H/W at the street it crosses');
    const lv = parseFloat((stats.match(/([\d.]+) m Level difference/) || [])[1]);
    ok(lv > 14 && lv < 20, `Site Section ground follows streets, not roofs (level difference ${lv} m, slope alone 17.4 m)`);
    ok(!p.errs.length, 'Site Section no errors');
    await p.context().close();
  }

  // 3. Isometric Map on real OSM extracts (ODbL): Çimenlik Kalesi and Süleymaniye Camii.
  for (const name of ['cimenlik', 'suleymaniye', 'selimiye']) {
    const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json')));
    const site = J.bbox ? { lat: (J.bbox[0] + J.bbox[2]) / 2, lng: (J.bbox[1] + J.bbox[3]) / 2, name } : { lat: 41.6781, lng: 26.5592, name };
    const p = await page(browser, 'tools/iso-map/index.html', { osm: J, elev: null, site });
    await p.click('#size button[data-v="300"]'); await runBtn(p);
    const s = await p.evaluate(() => ({ walls: data.blds.filter(b => b.wall).length, castleArea: data.blds.filter(b => b.t.historic === 'castle' && !b.t.building && !b.wall).length,
      heritage: data.heritage.length, domes: data.blds.filter(b => b.mosque || b.dome).map(b => ({ part: !!b.part, mosque: !!b.mosque, tomb: !!b.tomb, h: b.h, top: b.geo && b.geo.top, z1: b.geo && b.geo.z1 })),
      minarets: data.spires.filter(sp => sp.minaret).map(sp => [sp.h, sp.cone]), domeParts: data.blds.filter(b => b.part && b.dome && b.parent).map(b => [b.h, b.parent.h, b.parent.hidden]), tris: model3d().parts.reduce((n, q) => n + q.tris.length, 0) }));
    if (name === 'cimenlik') {
      ok(s.walls > 20, `Çimenlik: city walls drawn as wall blocks (${s.walls})`);
      ok(s.castleArea === 0 && s.heritage > 0, 'Çimenlik: the castle area is ground, not an extruded building');
    } else if (name === 'selimiye') {
      ok(s.domeParts.length && s.domeParts.every(([h, ph]) => h > ph + 15), `Selimiye: the untagged dome part rises above the prayer hall (${JSON.stringify(s.domeParts)})`);
      ok(s.minarets.length === 4 && s.minarets.every(([h, c]) => h + c > 60), `Selimiye: minaret nodes scaled to the mosque (${JSON.stringify(s.minarets.map(([h, c]) => Math.round(h + c)))} m)`);
    } else {
      const d = s.domes.find(x => x.part);
      ok(d && d.top === 53 && d.z1 < 45, `Süleymaniye: dome on the main part, top 53 m (${JSON.stringify(d)})`);
      ok(!s.domes.some(x => !x.part && x.mosque), 'Süleymaniye: the mosque outline does not get a second dome');
      ok(s.domes.some(x => x.tomb), 'Süleymaniye: the türbe gets a dome');
      ok(s.minarets.length === 4 && s.minarets.every(([h, c]) => h + c === 55), `Süleymaniye: 4 minarets, 55 m with cone (${JSON.stringify(s.minarets)})`);
    }
    ok(s.tris > 1000, `${name}: 3D model has ${s.tris} triangles`);
    for (const id of ['svg', 'xObj', 'xDxf', 'xStl']) { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#' + id)]); ok(fs.statSync(await d.path()).size > 10000, `${name}: ${d.suggestedFilename()} downloads`); }
    ok(!p.errs.length, `${name}: no errors ${JSON.stringify(p.errs.slice(0, 2))}`);
    await p.context().close();
  }

  // 4. Isometric Map: a coastline that ends inside the square still closes a sea polygon (it used to vanish).
  {
    const el = [{ type: 'way', id: 1, tags: { natural: 'coastline' }, geometry: [[-120, 250], [-100, 0], [-130, -180]].map(LL) }];   // land on the left = east, ends inside
    for (let i = 0; i < 6; i++) el.push({ type: 'way', id: 10 + i, tags: { building: 'yes' }, geometry: box(-60 + i * 30, -10, -40 + i * 30, 10) });
    const p = await page(browser, 'tools/iso-map/index.html', { osm: { elements: el }, elev: null });
    await runBtn(p);
    const svg = await p.evaluate(() => drawing());
    ok(/>Sea</.test(svg), 'Isometric Map: sea drawn from a coastline that ends inside the square');
    ok(!p.errs.length, 'coast: no errors');
    await p.context().close();
  }

  // 5. Urban Analysis Map: printing all four sheets keeps clip ids unique (clipping failed when they clashed);
  //    the sea is drawn from the coastline (it was missing on coastal sheets); civic buildings count as landmarks.
  {
    const osm = F.osm(170, 1500);
    osm.elements.push({ type: 'way', id: 990001, tags: { natural: 'coastline' }, geometry: [[-100, 300], [-120, 0], [-100, -300]].map(LL) });   // sea to the west
    osm.elements.push({ type: 'way', id: 990002, tags: { amenity: 'theatre', name: 'Test Theatre' }, geometry: box(20, 20, 40, 40) });
    const p = await page(browser, 'tools/urban-map/index.html', { osm });
    await runBtn(p);
    const u = await p.evaluate(() => ({ sea: data.water.filter(w => w.t.natural === 'sea').length, theatre: data.marks.some(m => m.name === 'Test Theatre') }));
    ok(u.sea > 0, `Urban Analysis Map: sea drawn from the coastline (${u.sea} areas)`);
    ok(u.theatre, 'Urban Analysis Map: a named theatre counts as a landmark');
    await p.evaluate(() => { window.print = () => {}; }); await p.click('#printAll');
    const dup = await p.evaluate(() => { const ids = [...document.querySelectorAll('clipPath[id], pattern[id]')].map(e => e.id); return ids.length - new Set(ids).size; });
    ok(dup === 0, `Urban Analysis Map: clip and pattern ids unique after print (${dup} duplicates)`);
    // Each building used to be its own hatched path; Chrome re-encodes the hatch per path and the ink density PDF reached 260 MB.
    const np = await p.evaluate(() => { style = 'ink'; return (sheetSvg('density').match(/<path/g) || []).length; });
    ok(np < 120, `Urban Analysis Map: buildings drawn as one path per class (${np} paths for 170 buildings)`);
    ok(!p.errs.length, 'urban map: no errors');
    await p.context().close();
  }

  await browser.close();
  console.log(fails ? `\n${fails} failed` : '\nall browser checks passed'); process.exit(fails ? 1 : 0);
})();
