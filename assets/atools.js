// a_tools shared helpers: the site (location) that every tool shares, plus small utilities.
(function () {
  const KEY = 'atools.site';

  function getSite() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
  }
  function setSite(site) {
    try { localStorage.setItem(KEY, JSON.stringify(site)); } catch {}
    showSite();
  }
  // Header pill showing the shared site, if any.
  function showSite() {
    const el = document.getElementById('sitePill');
    if (!el) return;
    const s = getSite();
    el.hidden = !s;
    if (s) el.textContent = s.name || `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`;
  }

  // fetch() + JSON with a time limit; throws an Error whose .why is a sentence for the user.
  async function fetchJson(url, opts = {}, ms = 30000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      if (r.status === 429) throw Object.assign(new Error('429'), { why: 'The data server is busy (too many requests).' });
      if (!r.ok) throw Object.assign(new Error(String(r.status)), { why: `The data server answered with an error (${r.status}).` });
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') e.why = 'The data server took too long to answer.';
      else if (!e.why) e.why = navigator.onLine === false ? 'You seem to be offline.' : 'The data server could not be reached.';
      throw e;
    } finally { clearTimeout(timer); }
  }

  // Overpass (OpenStreetMap) query; tries the main server, then public mirrors.
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  async function overpass(q, ms = 60000) {
    let last;
    for (const url of OVERPASS) {
      try {
        const j = await fetchJson(url, { method: 'POST', body: 'data=' + encodeURIComponent(q) }, ms);
        // Overpass reports its own timeouts inside a 200 response.
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark))
          throw Object.assign(new Error(j.remark), { why: 'The area is too big or the server too busy for this query.' });
        return j;
      } catch (e) { last = e; }
    }
    throw last;
  }
  // One-line message for a failed load, e.g. errorText(e, 'buildings').
  const errorText = (e, what) => `Could not load ${what}. ${(e && e.why) || 'Something went wrong.'} Try again in a minute${/too big/.test((e && e.why) || '') ? ' or pick a smaller area' : ''}.`;

  async function geocode(q) {
    const j = await fetchJson('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), {}, 15000);
    if (!j[0]) return null;
    return { lat: +j[0].lat, lng: +j[0].lon, name: j[0].display_name.split(',').slice(0, 2).join(',').trim() };
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
  }
  function downloadSvg(svgEl, name) {
    const s = svgEl.cloneNode(true);
    s.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    download(name, '<?xml version="1.0"?>\n' + s.outerHTML, 'image/svg+xml');
  }

  // ASCII file-name part from a place name: "Kadıköy, İstanbul" → "kadikoy-istanbul".
  const slug = s => String(s || 'site').replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';

  // Standard light basemap for all map tools.
  function baseMap(id, center, zoom) {
    const map = L.map(id).setView(center, zoom);
    // OpenStreetMap standard tiles (no key needed), greyed in CSS for a calm base.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21, maxNativeZoom: 19, className: 'atools-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    L.control.scale({ metric: true, imperial: false }).addTo(map);
    return map;
  }

  window.ATools = { getSite, setSite, showSite, geocode, download, downloadSvg, baseMap, fetchJson, overpass, errorText, slug };
  document.addEventListener('DOMContentLoaded', showSite);
})();
