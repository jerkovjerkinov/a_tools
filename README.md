# a_tools

Free, browser-based design tools for architects and architecture students.

## Tools

| Tool | Status | Path |
| --- | --- | --- |
| Sun & Shadow Study | Prototype | [`tools/sun-shadow/`](tools/sun-shadow/index.html) |

### Sun & Shadow Study

Pick a site on the map, draw a building footprint, set its height, and see:

- shadows of the building and its neighbours (from OpenStreetMap) for any date and time
- a 9:00 / 12:00 / 15:00 overlay and a day animation
- sun altitude, azimuth, sunrise, sunset, shadow length
- a sun path diagram (21 Dec, equinox, 21 Jun), exportable as SVG
- a printable sheet (browser print → Save as PDF)

Each tool is a single static HTML file with no build step. Open it in a browser or serve the repo with any static host.

Data: map tiles © OpenStreetMap contributors © CARTO; buildings via the Overpass API; place search via Nominatim. Neighbour heights come from OSM `height` / `building:levels` tags and are often missing, so the tool falls back to an editable default.
