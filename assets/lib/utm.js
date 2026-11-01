// a_tools map projections: WGS84 lat/lng ↔ UTM (Krüger series, accurate to millimetres inside a zone),
// the local site plane every tool uses (metres east/north of the site point), and Sentinel-2 MGRS tile names.
(function () {
const rad = Math.PI / 180, a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
const n = f / (2 - f), A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
const be = [n / 2 - 2 * n * n / 3 + 37 * n ** 3 / 96, n * n / 48 + n ** 3 / 15, 17 * n ** 3 / 480];
const de = [2 * n - 2 * n * n / 3 - 2 * n ** 3, 7 * n * n / 3 - 8 * n ** 3 / 5, 56 * n ** 3 / 15];

const zoneOf = (lat, lng) => Math.min(60, Math.floor((lng + 180) / 6) + 1);
// lat/lng → { e, n, zone, south } in the given zone (default: the point's own zone).
function toUtm(lat, lng, zone = zoneOf(lat, lng), south = lat < 0) {
  const l0 = ((zone - 1) * 6 - 180 + 3) * rad, phi = lat * rad, lam = lng * rad - l0;
  const e2 = 2 * Math.sqrt(n) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e2 * Math.atanh(e2 * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 3; j++) { E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
  return { e: 500000 + k0 * A * E, n: (south ? 10000000 : 0) + k0 * A * N, zone, south };
}
function fromUtm(e, nn, zone, south) {
  const xi = (nn - (south ? 10000000 : 0)) / (k0 * A), eta = (e - 500000) / (k0 * A);
  let x = xi, y = eta;
  for (let j = 1; j <= 3; j++) { x -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); y -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(x) / Math.cosh(y));
  let phi = chi; for (let j = 1; j <= 3; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
  return { lat: phi / rad, lng: ((zone - 1) * 6 - 180 + 3) + Math.atan2(Math.sinh(y), Math.cos(x)) / rad };
}
const epsg = u => (u.south ? 32700 : 32600) + u.zone;

// Local site plane (the same as ATFabric.xy): x east, y north in metres from the site point.
const local = o => ({
  xy: (lat, lng) => [(lng - o.lng) * 111320 * Math.cos(o.lat * rad), (lat - o.lat) * 110540],
  ll: (x, y) => ({ lat: o.lat + y / 110540, lng: o.lng + x / (111320 * Math.cos(o.lat * rad)) })
});

// Sentinel-2 tile (MGRS 100 km square), e.g. "35TMK", for the square whose tile covers the point.
// Tiles are 109.8 km wide from the square's west and north edges, so pass the area's north-west corner.
function mgrs(lat, lng) {
  const u = toUtm(lat, lng), bands = 'CDEFGHJKLMNPQRSTUVWX';
  const band = bands[Math.max(0, Math.min(19, Math.floor((lat + 80) / 8)))];
  const cols = ['STUVWXYZ', 'ABCDEFGH', 'JKLMNPQR'][u.zone % 3], rows = 'ABCDEFGHJKLMNPQRSTUV';
  const col = cols[Math.floor(u.e / 100000) - 1], row = rows[(Math.floor(u.n / 100000) + (u.zone % 2 ? 0 : 5)) % 20];
  return { zone: u.zone, band, sq: col + row, id: u.zone + band + col + row };
}

window.ATUtm = { toUtm, fromUtm, zoneOf, epsg, local, mgrs };
})();
