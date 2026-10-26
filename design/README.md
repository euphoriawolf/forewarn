# Forewarn design

First design pass, 26 Oct 2026. Open `index.html` through a local server (the `forewarn-design` preview, port 8830). Run `node shoot.mjs` to write the screenshots in `shots/`.

## Data in the mockups

All numbers are real.

- `data/futures-eastleigh.json`: the 51 ECMWF ensemble runs for Eastleigh, Nairobi, from the Open-Meteo Ensemble API (`ecmwf_ifs025`), fetched 26 Oct 2026 at 20:00 EAT. CC BY 4.0, Open-Meteo.
- The line (33.1 mm): the wettest 24 hours of the 5 to 8 March 2026 storm at this place, ECMWF through the Open-Meteo archive.
- `data/terrain-eastleigh.json`: Copernicus GLO-30 ground heights and Overture building counts. Taken from Flood Check, a project that existed before the hackathon.
- `data/map-eastleigh.json`: roads from OpenStreetMap (ODbL), taken from Flood Check.
- `data/timemachine-durban.json`: 51 past ECMWF runs, 1 to 7 days before the Durban flood of 25 Feb 2025, from dynamical.org (CC BY 4.0).
- `data/satellite-eastleigh.jpg`: Sentinel-2 cloudless 2024 by EOX (contains modified Copernicus Sentinel data), CC BY-NC-SA 4.0, non-commercial. Taken from Flood Check.
- `data/place-eastleigh-{ground,city,life}.json` and `data/place-eastleigh.jpg`: a 3 km square cut by `tools/cut-place.py` from Flood Check's Nairobi data (ground, building footprints with heights from OpenStreetMap and Overture, canopy-map trees, roads, the March model and the Sentinel-2 photo). Split in three so a slow phone shows the ground first.

`place3d.js` is new code for Forewarn. It follows Flood Check's look (true scale, satellite ground, buildings, trees, see-through water, amber roofs for water at the door) but shares no code with it.
