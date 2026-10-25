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

  async function geocode(q) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const j = await r.json();
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

  // Standard light basemap for all map tools.
  function baseMap(id, center, zoom) {
    const map = L.map(id).setView(center, zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 21, maxNativeZoom: 20, subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);
    L.control.scale({ metric: true, imperial: false }).addTo(map);
    return map;
  }

  window.ATools = { getSite, setSite, showSite, geocode, download, downloadSvg, baseMap };
  document.addEventListener('DOMContentLoaded', showSite);
})();
