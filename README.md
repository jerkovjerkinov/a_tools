# a_tools

Free, browser-based design tools for architects and architecture students.

## Tools

| Tool | Status | Path |
| --- | --- | --- |
| Hub | Prototype | [`index.html`](index.html) |
| Sun & Shadow Study | Prototype | [`tools/sun-shadow/`](tools/sun-shadow/index.html) |
| Site Climate | Prototype | [`tools/climate/`](tools/climate/index.html) |
| Zoning Envelope | Prototype | [`tools/zoning/`](tools/zoning/index.html) |
| Figure-Ground | Prototype | [`tools/figure-ground/`](tools/figure-ground/index.html) |
| Walkability | Prototype | [`tools/walkability/`](tools/walkability/index.html) |
| Site Analysis Sheet | Prototype | [`tools/site-sheet/`](tools/site-sheet/index.html) |
| 3D Context | Prototype | [`tools/context-3d/`](tools/context-3d/index.html) |

### Sun & Shadow Study

Pick a site on the map, draw a building footprint, set its height, and see:

- shadows of the building and its neighbours (from OpenStreetMap) for any date and time
- a 9:00 / 12:00 / 15:00 overlay and a day animation
- sun altitude, azimuth, sunrise, sunset, shadow length
- a sun path diagram (21 Dec, equinox, 21 Jun), exportable as SVG
- a printable sheet (browser print → Save as PDF)

### Site Climate

One year of hourly ERA5 weather (Open-Meteo) for the site: monthly temperature band with comfort zone, comfort hours, wind rose by season, hourly temperature heatmap, rain and solar radiation, and rule-based design notes.

### Zoning Envelope

Plot size, setbacks, site coverage, FAR, height limit and floor heights in; buildable footprint, floors, floor area, governing rule, plan and massing SVG out. Türkiye mode uses TAKS / KAKS (emsal) / Hmax terms. Pre-check only.

### Figure-Ground

Buildings, roads, water and green areas from OpenStreetMap (Overpass) around the site at 500 m, 1 km or 2 km, drawn as figure-ground, inverse or context. Built coverage, median footprint and grain. SVG (layered) and 3000 px PNG export.

### Walkability

The OSM footpath and street network within a 15-minute walk, coloured by 5 / 10 / 15 minute bands (in-browser Dijkstra), with daily-need places (food, grocery, schools, health, transit, parks) counted per band and a 15-minute neighbourhood score.

### Site Analysis Sheet

One A3 landscape board for the site: figure-ground, sun path, wind rose, temperature and rain/sun charts, key figures and design notes. Prints to A3 or saves as PDF from the browser.

### 3D Context

OSM buildings (heights from `height`, `building:levels` or an editable default; courtyards kept) and an optional 10 × 10 Copernicus DEM elevation grid from Open-Meteo, previewed as an axonometric from four directions and exported as closed solids in OBJ (Y up), DXF (3DFACE on Buildings / Terrain / Streets layers) or binary STL. Metres, origin at the site point. Roofs are flat. Uses [earcut](https://github.com/mapbox/earcut) for roof triangulation.

All tools share `assets/atools.css` and `assets/atools.js`. Calculations used by more than one tool live in `assets/lib/`: `sun.js` (sun position, sun path), `climate.js` (Open-Meteo download, climate summary, charts, design notes) and `fabric.js` (OSM buildings, figure-ground drawing). Also, the site set on the hub (or in any tool) is stored in the browser and reused by the others.

Each tool is a single static HTML file with no build step. Open it in a browser or serve the repo with any static host.

Data: map tiles © OpenStreetMap contributors © CARTO; buildings via the Overpass API; place search via Nominatim. Neighbour heights come from OSM `height` / `building:levels` tags and are often missing, so the tool falls back to an editable default.
