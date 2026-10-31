// a_tools climate library: download a year of ERA5 hours from Open-Meteo, summarise it, and draw the charts.
// Used by tools/climate and tools/site-sheet. Every chart function returns an SVG string.
(function () {
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const BINS = [[0, 2], [2, 4], [4, 6], [6, 8], [8, Infinity]];
const BIN_COLORS = ['#d9e4ee', '#9fbcd6', '#5e8cb8', '#2f5d8a', '#1b3553'];
const SEASONS = { year: null, winter: [11, 0, 1], spring: [2, 3, 4], summer: [5, 6, 7], autumn: [8, 9, 10] };

async function fetchYear(site, y) {
  const url = 'https://archive-api.open-meteo.com/v1/archive?' + new URLSearchParams({
    latitude: site.lat.toFixed(4), longitude: site.lng.toFixed(4), start_date: `${y}-01-01`, end_date: `${y}-12-31`,
    hourly: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,shortwave_radiation',
    wind_speed_unit: 'ms', timezone: 'auto'
  });
  const j = await ATools.fetchJson(url, {}, 45000);
  if (!j.hourly || !j.hourly.time || !j.hourly.time.length) throw Object.assign(new Error('empty'), { why: 'No weather data came back for this place and year.' });
  const d = analyse(j.hourly, y);
  d.lat = site.lat;
  return d;
}

function analyse(h, year) {
  const n = h.time.length;
  const hours = h.time.map((t, i) => ({
    month: +t.slice(5, 7) - 1, day: dayOfYear(t), hour: +t.slice(11, 13),
    T: h.temperature_2m[i], RH: h.relative_humidity_2m[i], P: h.precipitation[i] || 0,
    ws: h.wind_speed_10m[i], wd: h.wind_direction_10m[i], G: h.shortwave_radiation[i] || 0
  })).filter(x => x.T != null);
  const days = {};
  hours.forEach(x => { (days[x.day] ||= { month: x.month, T: [] }).T.push(x.T); });
  const dayStats = Object.values(days).map(d => ({ month: d.month, max: Math.max(...d.T), min: Math.min(...d.T), mean: avg(d.T) }));
  const months = MONTHS.map((_, m) => {
    const hs = hours.filter(x => x.month === m), ds = dayStats.filter(d => d.month === m);
    const nd = ds.length || 1;
    return {
      max: avg(ds.map(d => d.max)), min: avg(ds.map(d => d.min)), mean: avg(hs.map(x => x.T)),
      absMax: Math.max(...hs.map(x => x.T)), absMin: Math.min(...hs.map(x => x.T)),
      rain: sum(hs.map(x => x.P)), sun: sum(hs.map(x => x.G)) / 1000 / nd,  // kWh/m²/day
      RH: avg(hs.map(x => x.RH)),
      cold: hs.filter(x => x.T < 18).length / hs.length, hot: hs.filter(x => x.T > 26).length / hs.length
    };
  });
  return {
    n: hours.length, year, hours, months,
    mean: avg(hours.map(x => x.T)),
    range: avg(dayStats.map(d => d.max - d.min)),
    hdd: sum(dayStats.map(d => Math.max(0, 18 - d.mean))),
    cdd: sum(dayStats.map(d => Math.max(0, d.mean - 24))),
    rain: sum(hours.map(x => x.P)),
    sun: sum(hours.map(x => x.G)) / 1000
  };
}
function dayOfYear(t) { const d = new Date(t.slice(0, 10) + 'T00:00:00Z'); return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5); }
const sum = a => a.reduce((s, x) => s + x, 0);
const avg = a => a.length ? sum(a) / a.length : 0;
const r1 = x => (Math.round(x * 10) / 10).toFixed(1);


// Monthly temperature band chart
function chartTemp(ms) {
  const W = 360, H = 220, l = 30, r = 8, t = 10, b = 22;
  const lo = Math.floor(Math.min(...ms.map(m => m.min), 0) / 5) * 5, hi = Math.ceil(Math.max(...ms.map(m => m.max), 30) / 5) * 5;
  const x = i => l + (i + .5) * (W - l - r) / 12, y = v => t + (hi - v) / (hi - lo) * (H - t - b);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  s += `<rect x="${l}" y="${y(26)}" width="${W - l - r}" height="${y(18) - y(26)}" fill="#e6efe0"/>`;
  for (let v = lo; v <= hi; v += 5) s += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="#f0eee8"/><text x="${l - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#8a8882">${v}</text>`;
  s += `<path d="${ms.map((m, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(m.max)).join('')}${ms.slice().reverse().map((m, i) => 'L' + x(11 - i) + ' ' + y(m.min)).join('')}Z" fill="#f3c9bd" opacity=".9"/>`;
  s += `<path d="${ms.map((m, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(m.mean)).join('')}" fill="none" stroke="#c8553d" stroke-width="2"/>`;
  ms.forEach((m, i) => s += `<circle cx="${x(i)}" cy="${y(m.mean)}" r="2.5" fill="#c8553d"/><text x="${x(i)}" y="${H - 7}" text-anchor="middle" font-size="9" fill="#8a8882">${MONTHS[i]}</text>`);
  return s + `<text x="${l}" y="8" font-size="9" fill="#8a8882">°C</text></svg>`;
}

// Day × hour heatmap
function heatColor(T) {
  const stops = [[-5, [47, 93, 138]], [10, [159, 188, 214]], [20, [244, 241, 234]], [30, [229, 138, 110]], [38, [142, 42, 26]]];
  if (T <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) if (T <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [bb, cb] = stops[i], k = (T - a) / (bb - a);
    return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')})`;
  }
  return `rgb(${stops[stops.length - 1][1]})`;
}
function chartHeat(hours) {
  const W = 730, H = 150, l = 26, t = 4, b = 18, cw = (W - l) / 366, ch = (H - t - b) / 24;
  let s = `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">`;
  hours.forEach(x => s += `<rect x="${(l + x.day * cw).toFixed(2)}" y="${(t + x.hour * ch).toFixed(2)}" width="${(cw + .3).toFixed(2)}" height="${(ch + .3).toFixed(2)}" fill="${heatColor(x.T)}"/>`);
  [0, 6, 12, 18].forEach(hh => s += `<text x="${l - 4}" y="${t + hh * ch + 7}" text-anchor="end" font-size="8" fill="#8a8882">${hh}h</text>`);
  [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334].forEach((dd, i) => s += `<text x="${l + dd * cw + 2}" y="${H - 5}" font-size="8" fill="#8a8882">${MONTH_NAMES[i]}</text>`);
  return s + '</svg>';
}

// Comfort stacked bars
function chartComfort(ms) {
  const W = 360, H = 200, l = 30, r = 8, t = 10, b = 22, bw = (W - l - r) / 12;
  const y = v => t + (1 - v) * (H - t - b);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  [0, .5, 1].forEach(v => s += `<text x="${l - 5}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#8a8882">${v * 100}%</text>`);
  ms.forEach((m, i) => {
    const x = l + i * bw + 2, w = bw - 4, ok = 1 - m.cold - m.hot;
    s += `<rect x="${x}" y="${y(m.cold)}" width="${w}" height="${y(0) - y(m.cold)}" fill="#9fbcd6"/>`;
    s += `<rect x="${x}" y="${y(m.cold + ok)}" width="${w}" height="${y(m.cold) - y(m.cold + ok)}" fill="#cfe0c3"/>`;
    s += `<rect x="${x}" y="${y(1)}" width="${w}" height="${y(m.cold + ok) - y(1)}" fill="#e58a6e"/>`;
    s += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle" font-size="9" fill="#8a8882">${MONTHS[i]}</text>`;
  });
  return s + '</svg>';
}

// Rain bars + sun line
function chartRainSun(ms) {
  const W = 360, H = 200, l = 30, r = 30, t = 10, b = 22, bw = (W - l - r) / 12;
  const rMax = Math.max(50, ...ms.map(m => m.rain)) * 1.1, sMax = Math.max(4, ...ms.map(m => m.sun)) * 1.1;
  const yR = v => t + (1 - v / rMax) * (H - t - b), yS = v => t + (1 - v / sMax) * (H - t - b);
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  [0, .5, 1].forEach(k => {
    s += `<line x1="${l}" x2="${W - r}" y1="${yR(rMax * k)}" y2="${yR(rMax * k)}" stroke="#f0eee8"/>`;
    s += `<text x="${l - 5}" y="${yR(rMax * k) + 3}" text-anchor="end" font-size="9" fill="#5e8cb8">${Math.round(rMax * k)}</text>`;
    s += `<text x="${W - r + 5}" y="${yS(sMax * k) + 3}" font-size="9" fill="#c08a1e">${(sMax * k).toFixed(1)}</text>`;
  });
  ms.forEach((m, i) => s += `<rect x="${l + i * bw + 4}" y="${yR(m.rain)}" width="${bw - 8}" height="${yR(0) - yR(m.rain)}" fill="#5e8cb8" rx="2"/>` +
    `<text x="${l + (i + .5) * bw}" y="${H - 7}" text-anchor="middle" font-size="9" fill="#8a8882">${MONTHS[i]}</text>`);
  s += `<path d="${ms.map((m, i) => (i ? 'L' : 'M') + (l + (i + .5) * bw) + ' ' + yS(m.sun)).join('')}" fill="none" stroke="#e0a23a" stroke-width="2"/>`;
  ms.forEach((m, i) => s += `<circle cx="${l + (i + .5) * bw}" cy="${yS(m.sun)}" r="2.5" fill="#e0a23a"/>`);
  return s + '</svg>';
}

// Wind rose
function windFreq(data, season) {
  const months = SEASONS[season];
  const hs = data.hours.filter(x => x.ws != null && x.wd != null && (!months || months.includes(x.month)));
  const f = DIRS.map(() => BINS.map(() => 0));
  hs.forEach(x => {
    const s = Math.round(((x.wd % 360) / 22.5)) % 16, bi = BINS.findIndex(([a, b]) => x.ws >= a && x.ws < b);
    f[s][bi]++;
  });
  return { f: f.map(r => r.map(c => c / hs.length)), calm: hs.filter(x => x.ws < 0.5).length / hs.length };
}
function rose(data, season = 'year') {
  const { f } = windFreq(data, season);
  const totals = f.map(r => sum(r)), mx = Math.max(...totals);
  const ring = mx > .15 ? .05 : mx > .08 ? .025 : .01;
  const top = Math.ceil(mx / ring) * ring;
  const cx = 160, cy = 160, R = 120, half = Math.PI / 16 * .9;
  let s = `<svg viewBox="0 0 320 320">`;
  for (let v = ring; v <= top + 1e-9; v += ring) {
    s += `<circle cx="${cx}" cy="${cy}" r="${R * v / top}" fill="none" stroke="#e3e0d8"/>`;
    s += `<text x="${cx + 3}" y="${cy - R * v / top - 2}" font-size="8" fill="#8a8882">${Math.round(v * 100)}%</text>`;
  }
  const arc = (a, r0, r1) => {
    const p = (ang, rr) => [cx + rr * Math.sin(ang), cy - rr * Math.cos(ang)];
    const [a0, a1] = [a - half, a + half];
    const [x1, y1] = p(a0, r1), [x2, y2] = p(a1, r1), [x3, y3] = p(a1, r0), [x4, y4] = p(a0, r0);
    return `M${x1} ${y1}A${r1} ${r1} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r0} ${r0} 0 0 0 ${x4} ${y4}Z`;
  };
  f.forEach((row, i) => {
    let acc = 0;
    const a = i * Math.PI / 8;
    row.forEach((v, bi) => {
      if (!v) return;
      const r0 = R * acc / top, r1 = R * (acc + v) / top;
      s += `<path d="${arc(a, r0, r1)}" fill="${BIN_COLORS[bi]}" stroke="#fff" stroke-width=".5"/>`;
      acc += v;
    });
  });
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => {
    const rr = a * Math.PI / 180;
    s += `<text x="${cx + (R + 16) * Math.sin(rr)}" y="${cy - (R + 16) * Math.cos(rr) + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="#4a4945">${t}</text>`;
  });
  return s + '</svg>';
}
function roseLegend() {
  return BINS.map((b, i) => `<span><i style="background:${BIN_COLORS[i]}"></i>${b[1] === Infinity ? '>' + b[0] : b[0] + '–' + b[1]}</span>`).join('');
}
function prevailing(data, season) {
  const { f } = windFreq(data, season), t = f.map(r => sum(r));
  const i = t.indexOf(Math.max(...t));
  return { dir: DIRS[i], share: t[i] };
}
// Summer and winter seasons for the site's hemisphere.
const localSeason = (lat, s) => lat >= 0 ? s : { summer: 'winter', winter: 'summer' }[s];
function extremes(d) {
  const ms = d.months;
  return { hot: ms.reduce((b, m, i) => m.max > ms[b].max ? i : b, 0), cold: ms.reduce((b, m, i) => m.min < ms[b].min ? i : b, 0) };
}

// Rule-based design clues
function notes(d) {
  const ms = d.months, out = [], lat = d.lat;
  const south = lat >= 0 ? 'south' : 'north';
  const summer = lat >= 0 ? [5, 6, 7] : [11, 0, 1];
  const sumRH = avg(summer.map(i => ms[i].RH));
  const hotHours = avg(ms.map(m => m.hot)), coldHours = avg(ms.map(m => m.cold));
  if (d.hdd > 2 * d.cdd && d.hdd > 1500)
    out.push(`<b>Heating-dominated.</b> ${Math.round(d.hdd)} heating degree days against ${Math.round(d.cdd)} cooling. Favour a compact form, good insulation and most glazing on the ${south} side to collect winter sun.`);
  else if (d.cdd > d.hdd)
    out.push(`<b>Cooling-dominated.</b> ${Math.round(d.cdd)} cooling degree days against ${Math.round(d.hdd)} heating. Shade glazing, especially west-facing, and keep roofs light-coloured or ventilated.`);
  else
    out.push(`<b>Mixed climate.</b> ${Math.round(d.hdd)} heating and ${Math.round(d.cdd)} cooling degree days. ${south[0].toUpperCase() + south.slice(1)}-facing glazing with fixed overhangs works both ways: sun in winter, shade in summer.`);
  if (d.range >= 10)
    out.push(`<b>Large daily swing (${r1(d.range)} °C).</b> Heavy materials with exposed thermal mass and night-time ventilation can flatten indoor temperatures.`);
  else if (sumRH > 70 && hotHours > .15)
    out.push(`<b>Warm and humid summers (${Math.round(sumRH)}% mean humidity).</b> Thermal mass helps little; prioritise cross-ventilation, raised floors and permeable shading.`);
  const pw = prevailing(d, localSeason(lat, 'summer')), ww = prevailing(d, localSeason(lat, 'winter'));
  out.push(`<b>Wind.</b> Summer winds come mostly from the ${pw.dir} (${Math.round(pw.share * 100)}% of hours); winter winds from the ${ww.dir} (${Math.round(ww.share * 100)}%). Align openings for cross-ventilation with the summer wind and shelter entrances and outdoor spaces from the winter wind.`);
  if (d.rain > 1000) out.push(`<b>Wet (${Math.round(d.rain)} mm/year).</b> Plan generous roof overhangs, covered outdoor routes and surface-water drainage.`);
  else if (d.rain < 400) out.push(`<b>Dry (${Math.round(d.rain)} mm/year).</b> Consider rainwater collection, courtyards and drought-tolerant planting.`);
  else out.push(`<b>Moderate rainfall (${Math.round(d.rain)} mm/year).</b> Wettest month is ${MONTH_NAMES[ms.reduce((b, m, i) => m.rain > ms[b].rain ? i : b, 0)]}.`);
  out.push(`<b>Solar resource ${Math.round(d.sun).toLocaleString('en-US')} kWh/m² per year.</b> ${d.sun > 1500 ? 'Strong: roof PV and solar water heating are well worth it, and shading matters.' : d.sun > 1100 ? 'Good: roof PV pays back; keep the roof free of clutter.' : 'Moderate: maximise daylight and keep glazing unobstructed.'}`);
  out.push(`<b>Comfort.</b> ${Math.round((1 - hotHours - coldHours) * 100)}% of hours fall between 18 and 26 °C outdoors. ${coldHours > hotHours ? 'Cold hours dominate the rest.' : 'Hot hours dominate the rest.'}`);
  return out;
}

window.ATClimate = { MONTHS, MONTH_NAMES, DIRS, BINS, BIN_COLORS, SEASONS, fetchYear, analyse, extremes, localSeason,
  chartTemp, chartHeat, chartComfort, chartRainSun, rose, roseLegend, prevailing, notes, r1 };
})();
