// a_tools sun library: solar position and the polar sun path diagram.
// Used by tools/sun-shadow and tools/site-sheet.
(function () {
// ---------- Sun position (after SunCalc / Astronomy Answers formulas) ----------
const Sun = (() => {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  function coords(d) {
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    return { dec: Math.asin(Math.sin(e) * Math.sin(L)), ra: Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L)) };
  }
  // Altitude (rad, above horizon) and azimuth (rad, from north, clockwise).
  function position(date, lat, lng) {
    const d = toDays(date), phi = rad * lat, c = coords(d);
    const H = rad * (280.16 + 360.9856235 * d) + rad * lng - c.ra;
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
    const alt = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
    return { alt, az: (az + Math.PI) % (2 * Math.PI) };
  }
  return { position, rad };
})();

// Polar sun path diagram (300 × 300 user units) for 21 Dec, 20 Mar and 21 Jun of `year`, clock times in UTC+tz.
// Returns the inner markup; wrap it in <svg viewBox="0 0 300 300">.
function pathSvg(lat, lng, { year, tz = 0, now = null } = {}) {
  const rad = Sun.rad, deg = r => r / rad, cx = 150, cy = 150, R = 120;
  const pt = s => { const r = R * (1 - deg(s.alt) / 90); return [cx + r * Math.sin(s.az), cy - r * Math.cos(s.az)]; };
  let out = `<rect width="300" height="300" fill="#fff"/>`;
  for (const a of [0, 30, 60]) out += `<circle cx="${cx}" cy="${cy}" r="${R * (1 - a / 90)}" fill="none" stroke="#e3e0d8"/>` +
    `<text x="${cx + 3}" y="${cy - R * (1 - a / 90) + 11}" font-size="9" fill="#8a8882">${a}°</text>`;
  for (let a = 0; a < 360; a += 30) {
    const r = rad * a;
    out += `<line x1="${cx}" y1="${cy}" x2="${cx + R * Math.sin(r)}" y2="${cy - R * Math.cos(r)}" stroke="#f0eee8"/>`;
  }
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => {
    const r = rad * a;
    out += `<text x="${cx + (R + 14) * Math.sin(r)}" y="${cy - (R + 14) * Math.cos(r) + 4}" font-size="12" font-weight="600" text-anchor="middle" fill="#4a4945">${t}</text>`;
  });
  const y = year || new Date().getFullYear();
  [[`${y}-12-21`, '#2f5d8a'], [`${y}-03-20`, '#5d8a3c'], [`${y}-06-21`, '#c0392b']].forEach(([d, c]) => {
    const [Y, M, D] = d.split('-').map(Number);
    let path = '', marks = '';
    for (let m = 0; m <= 1440; m += 10) {
      const s = Sun.position(new Date(Date.UTC(Y, M - 1, D) + (m - tz * 60) * 6e4), lat, lng);
      if (s.alt < 0) continue;
      const [x, yy] = pt(s);
      path += (path ? 'L' : 'M') + x.toFixed(1) + ' ' + yy.toFixed(1);
      if (m % 60 === 0) marks += `<circle cx="${x}" cy="${yy}" r="1.8" fill="${c}"/>` +
        (c === '#c0392b' && m % 120 === 0 ? `<text x="${x}" y="${yy - 4}" font-size="8" text-anchor="middle" fill="${c}">${m / 60}</text>` : '');
    }
    out += `<path d="${path}" fill="none" stroke="${c}" stroke-width="1.6"/>` + marks;
  });
  if (now && now.alt > 0) { const [x, yy] = pt(now); out += `<circle cx="${x}" cy="${yy}" r="6" fill="#c8553d" stroke="#fff" stroke-width="2"/>`; }
  out += `<text x="6" y="294" font-size="9" fill="#8a8882">${lat.toFixed(3)}, ${lng.toFixed(3)}</text>`;
  return out;
}
// Türkiye uses UTC+3 all year; elsewhere start from the longitude estimate.
function guessTz(lat, lng) {
  return lat > 35.8 && lat < 42.2 && lng > 25.6 && lng < 44.9 ? 3 : Math.round(lng / 15);
}
// Day length in hours on a given UTC date.
function dayLength(lat, lng, Y, M, D) {
  let up = 0;
  for (let m = 0; m < 1440; m += 5) if (Sun.position(new Date(Date.UTC(Y, M - 1, D) + m * 6e4), lat, lng).alt > -0.833 * Sun.rad) up += 5;
  return up / 60;
}
// Highest sun altitude (degrees) on a given UTC date.
function noonAltitude(lat, lng, Y, M, D) {
  let best = -90;
  for (let m = 0; m < 1440; m += 5) best = Math.max(best, Sun.position(new Date(Date.UTC(Y, M - 1, D) + m * 6e4), lat, lng).alt / Sun.rad);
  return best;
}

window.ATSun = { position: Sun.position, rad: Sun.rad, pathSvg, guessTz, dayLength, noonAltitude };
})();
