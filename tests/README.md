# Regression checks

Every network call is mocked, so these run offline. They guard bugs that were found and fixed:

- `unit.js` (Node only): the nearest-cell terrain staircase (`destair`), roof stripping of the elevation surface model (`openProfile`, `openGrid`), and closed, correctly sized 3D meshes and OBJ / DXF / STL writers (`assets/lib/model.js`); for the Terrain Model: UTM and Sentinel-2 tile names, contours and laser plates on a cone, building pads, road benches and stream beds, flow lines and aspect on a tilted valley, catchments, height above drainage, TPI and curvature on two side-by-side valleys, sea level rise that floods the shore but not a hollow behind a ridge, multipolygon ring assembly, the GeoTIFF header, the shapefile / dBASE / ZIP writers (header lengths, clockwise outer rings, UTF-8 names, CRC-32), DXF polyface chunking and sheet packing.
- `browser.js` (Playwright + Chromium):
  - every tool opens and runs its main action on a dense synthetic scene (`fixtures/dense.js`) without page errors;
  - Site Section cuts all buildings on a long line and keeps the ground under the roofs;
  - Isometric Map on real OpenStreetMap extracts of Çimenlik Kalesi, Süleymaniye Camii and Selimiye Camii (`fixtures/*.json`, © OpenStreetMap contributors, ODbL): city walls, castle area as ground, the dome on the main part, a dome on the türbe, minaret heights, an untagged dome part above the prayer hall, exports;
  - a coastline that ends inside the square still closes the sea;
  - Urban Analysis Map keeps clip ids unique when all four sheets print;
  - Terrain Model builds from a synthetic Terrarium tile (`fixtures/terrarium.png`) and the dense scene, makes every download (including shapefiles and KMZ), makes the same `.3dm` twice (rhino3dm used to crash the page on the second), draws every analysis map with a legend, and switches views and styles without errors. three.js and rhino3dm are served from `node_modules`.

Run:

```
cd tests
npm install
npx playwright install chromium
npm test
```

GitHub Actions runs the same on every push and pull request (`.github/workflows/tests.yml`).
