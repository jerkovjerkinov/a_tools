# Regression checks

Every network call is mocked, so these run offline. They guard bugs that were found and fixed:

- `unit.js` (Node only): the nearest-cell terrain staircase (`destair`), roof stripping of the elevation surface model (`openProfile`, `openGrid`), and closed, correctly sized 3D meshes and OBJ / DXF / STL writers (`assets/lib/model.js`).
- `browser.js` (Playwright + Chromium):
  - every tool opens and runs its main action on a dense synthetic scene (`fixtures/dense.js`) without page errors;
  - Site Section cuts all buildings on a long line and keeps the ground under the roofs;
  - Isometric Map on real OpenStreetMap extracts of Çimenlik Kalesi, Süleymaniye Camii and Selimiye Camii (`fixtures/*.json`, © OpenStreetMap contributors, ODbL): city walls, castle area as ground, the dome on the main part, a dome on the türbe, minaret heights, an untagged dome part above the prayer hall, exports;
  - a coastline that ends inside the square still closes the sea;
  - Urban Analysis Map keeps clip ids unique when all four sheets print.

Run:

```
cd tests
npm install
npx playwright install chromium
npm test
```

GitHub Actions runs the same on every push and pull request (`.github/workflows/tests.yml`).
