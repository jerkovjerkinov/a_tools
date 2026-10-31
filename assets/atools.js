// a_tools shared helpers: the site (location) that every tool shares, plus small utilities.
(function () {
  const KEY = 'atools.site';

  // Pilot settings. Both keys are public by design (they only allow sending, not reading).
  // feedbackKey: Web3Forms access key; feedback arrives by e-mail. Empty = open a GitHub issue instead.
  // goatcounter: GoatCounter site code (cookie-free visit counter). Empty = no counting.
  const CONFIG = { feedbackKey: '', goatcounter: '', repo: 'jerkovjerkinov/a_tools' };

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
    track('download/' + String(name).split('.').pop());
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

  // ---------- Visit counter (GoatCounter, no cookies, no personal data) ----------
  function startCounter() {
    if (!CONFIG.goatcounter || /^(localhost|127\.|file)/.test(location.hostname || 'file')) return;
    const sc = document.createElement('script');
    sc.async = true; sc.src = 'https://gc.zgo.at/count.js';
    sc.dataset.goatcounter = `https://${CONFIG.goatcounter}.goatcounter.com/count`;
    document.head.appendChild(sc);
  }
  function track(name) {
    try { if (window.goatcounter && goatcounter.count) goatcounter.count({ path: name, title: name, event: true }); } catch (e) {}
  }

  // ---------- Feedback ----------
  const toolName = () => (document.querySelector('.crumb b') || {}).textContent || 'Home';
  function feedbackDialog() {
    let d = document.getElementById('atFeedback');
    if (d && d.dataset.done) { d.remove(); d = null; }
    if (!d) {
      d = document.createElement('dialog'); d.id = 'atFeedback'; d.className = 'fb';
      d.innerHTML = `<form method="dialog" class="fb-form">
        <h2>Feedback</h2>
        <p class="fb-lead">a_tools is new. Tell us what worked, what broke and what you wish it did.</p>
        <label>Tool</label><div class="fb-tool"></div>
        <label>How useful was it?</label>
        <div class="fb-rate" role="radiogroup">${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="rate" value="${n}"><span>${n}</span></label>`).join('')}</div>
        <div class="fb-scale"><span>Not useful</span><span>Very useful</span></div>
        <label for="fbRole">You are</label>
        <select id="fbRole" name="role"><option value="">Choose…</option><option>Architecture student</option><option>Architect</option><option>Teacher / academic</option><option>Urban planner</option><option>Other</option></select>
        <label for="fbMsg">Your message</label>
        <textarea id="fbMsg" name="msg" rows="5" required placeholder="What did you try? What was missing or wrong?"></textarea>
        <label for="fbMail">E-mail <span class="unit">optional, if you want an answer</span></label>
        <input id="fbMail" name="mail" type="email" autocomplete="email">
        <p class="fb-note" aria-live="polite"></p>
        <div class="fb-actions"><button class="btn" value="cancel" formnovalidate>Close</button><button class="btn primary" value="send">Send</button></div>
      </form>`;
      document.body.appendChild(d);
      d.querySelector('form').addEventListener('submit', async ev => {
        if (ev.submitter && ev.submitter.value !== 'send') return;
        ev.preventDefault();
        const f = ev.target, note = f.querySelector('.fb-note'), btn = ev.submitter;
        const data = { tool: toolName(), rating: (f.rate.value || '–') + ' / 5', role: f.role.value || '–', message: f.msg.value.trim(),
          email: f.mail.value.trim(), page: location.pathname, site: (getSite() || {}).name || '–' };
        if (!data.message) { note.textContent = 'Please write a few words first.'; return; }
        if (!CONFIG.feedbackKey) {   // no inbox yet: hand over to a prefilled GitHub issue
          const body = `**Tool:** ${data.tool}\n**Useful:** ${data.rating}\n**Role:** ${data.role}\n\n${data.message}`;
          window.open(`https://github.com/${CONFIG.repo}/issues/new?labels=feedback&title=${encodeURIComponent('Feedback: ' + data.tool)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
          d.close(); return;
        }
        btn.disabled = true; note.textContent = 'Sending…';
        try {
          const r = await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ access_key: CONFIG.feedbackKey, subject: `a_tools feedback: ${data.tool} (${data.rating})`, from_name: 'a_tools', replyto: data.email || undefined, ...data, botcheck: '' }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.success === false) throw new Error();
          track('feedback/sent'); d.dataset.done = '1';
          f.innerHTML = '<h2>Thank you</h2><p class="fb-lead">Your feedback reached us. It helps decide what to build next.</p><div class="fb-actions"><button class="btn primary" value="cancel">Close</button></div>';
        } catch (e) { note.textContent = 'Could not send. Check your connection and try again.'; }
        btn.disabled = false;
      });
    }
    d.querySelector('.fb-tool') && (d.querySelector('.fb-tool').textContent = toolName());
    d.showModal();
  }
  function addFeedbackButton() {
    const bar = document.querySelector('.topbar'); if (!bar || bar.querySelector('.fb-open')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fb-open'; b.textContent = 'Feedback';
    b.addEventListener('click', feedbackDialog);
    const pill = document.getElementById('sitePill'); bar.insertBefore(b, pill || null);
    document.querySelectorAll('[data-feedback]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); feedbackDialog(); }));
  }

  window.ATools = { getSite, setSite, showSite, geocode, download, downloadSvg, baseMap, fetchJson, overpass, errorText, slug, feedback: feedbackDialog, track };
  startCounter();
  document.addEventListener('DOMContentLoaded', () => { showSite(); addFeedbackButton(); });
})();
