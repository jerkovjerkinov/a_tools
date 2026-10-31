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
| Sun Hours | Prototype | [`tools/sun-hours/`](tools/sun-hours/index.html) |
| Facade Sun | Prototype | [`tools/facade-sun/`](tools/facade-sun/index.html) |
| Precedent Finder | Prototype | [`tools/precedents/`](tools/precedents/index.html) |
| Site Section | Prototype | [`tools/site-section/`](tools/site-section/index.html) |
| Programme & Adjacency | Experimental, not linked from the hub | [`tools/programme/`](tools/programme/index.html) |

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

### Sun Hours

Hours of direct sun on the ground (1 m grid, sun every 10 minutes) for any day, in a 150, 200 or 300 m square. Shadows come from OSM buildings up to 120 m outside the square and from an optional footprint you draw. Reports mean sun on open ground, the share in shade all day, and a pass / fail check against a sunlight rule (UK BRE preset: 2 h on 50% of open ground on 20 March, or custom numbers). Shadows are rasterised on a canvas, one pass per sun position.

### Facade Sun

Draw a footprint or pick a mapped building. Each facade (footprint edge, near-straight edges merged) gets six sample points (both ends and the middle, ground and top floor). For each point a 1° horizon profile is ray-cast against OSM neighbours within 200 m and the building itself; then every hour of a year is checked: the sun must be up, in front of the facade and above that horizon. Solar radiation on the vertical surface comes from Open-Meteo ERA5 hourly direct and diffuse radiation (direct × cos incidence, half the diffuse sky reduced by obstructions, ground reflection 0.2). Outputs: sun hours and kWh/m² per facade and month, share taken by neighbours, orientation-based shading notes (overhang depth for the equator-facing side), SVG plan diagram and CSV.

### Precedent Finder

Searches Wikidata (SPARQL at query.wikidata.org) for buildings by architect (P84), building type (P31, one subclass level), style (P149), country (P17), inception year (P571) and distance from the site (`wikibase:around` on P625). By default only items with a photo (P18) and a known architect. The best known 150 (by sitelink count) come back as cards with Commons thumbnails, a map view and a detail view with the English Wikipedia summary and the photo's author and licence from the Commons API. Starred items form a board kept in the browser, printed as one A3 sheet (up to 9, each photo credited) or exported as CSV. Architect, style and country fields use `wbsearchentities` suggestions.

### Site Section

Draw a line A–B (up to 1 km) on the map. Terrain: 100 samples along the line from Copernicus DEM (90 m) via the Open-Meteo elevation API. Buildings and streets: Overpass around the line. Buildings the line crosses are cut (even-odd intervals of the line against each footprint, holes included) and drawn in black; buildings on the chosen side within a set depth are projected onto the section plane and drawn as a lighter elevation, far to near, standing on the ground level at their own centre. Streets crossed are marked with their width (`width` tag, else lanes or a default per road class). For the widest street crossed, W is the distance between the first cut buildings either side and H their mean height. Spot levels every 5–250 m and at building bases. Exports: SVG, DXF (R12 polylines and text in metres, x from A, y above sea level) and an A3 print at a true scale (1:100 to 1:5000) with optional vertical exaggeration.

### Programme & Adjacency

An editable space list (area, number, zone) from templates (house, primary school, library, office floor, student housing), net / gross / floor-plate totals, an adjacency matrix (must / near / apart) and a force-laid bubble diagram with circle area proportional to floor area. Draggable; kept in the browser; CSV schedule and SVG diagram export.

All tools share `assets/atools.css` and `assets/atools.js`. Calculations used by more than one tool live in `assets/lib/`: `sun.js` (sun position, sun path), `climate.js` (Open-Meteo download, climate summary, charts, design notes) and `fabric.js` (OSM buildings, figure-ground drawing, building masses with heights). Also, the site set on the hub (or in any tool) is stored in the browser and reused by the others.

Each tool is a single static HTML file with no build step. Open it in a browser or serve the repo with any static host.

Data: map tiles © OpenStreetMap contributors (openstreetmap.org standard tiles, greyed in CSS); buildings via the Overpass API; place search via Nominatim. Neighbour heights come from OSM `height` / `building:levels` tags and are often missing, so the tool falls back to an editable default.

## Pilot settings

`assets/atools.js` has a small `CONFIG` block at the top:

- `feedbackKey`: a [Web3Forms](https://web3forms.com) access key. Feedback from the **Feedback** button arrives by e-mail. Left empty, the button opens a prefilled GitHub issue instead.
- `goatcounter`: a [GoatCounter](https://www.goatcounter.com) site code for a cookie-free visit and download counter. Left empty, nothing is counted.

Both keys are public by design: they can only send, not read.
