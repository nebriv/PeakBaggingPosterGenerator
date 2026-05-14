# Peak Bagging Poster Generator

Design a framable, topographic poster of any peak-bagging list — Adirondack
46ers, Catskill 3500, NH Whites, Colorado 14ers, the Alps, wherever — and
export it as a print-ready **PNG, PDF, or SVG**.

This is a fork of [Terraink](https://github.com/nebriv/terraink) that adds
peak-bagging features on top of Terraink's vector poster engine: live OSM
peaks via Overpass, DEM hillshade and client-side contour lines, custom
user-supplied overlays, and high-DPI export.

## Features

- **Vector basemap**: OpenFreeMap / OpenMapTiles vector tiles via MapLibre GL.
  Crisp at any DPI.
- **Themes + per-layer styling**: dozens of curated palettes, fully overridable
  colors, independent control over roads / water / parks / buildings / rail /
  paths / outlines.
- **Typography**: any Google Fonts family for the poster's city / country
  labels.
- **DEM hillshade**: client-side shaded relief from AWS open Terrarium tiles.
- **Vector contour lines**: generated client-side with `maplibre-contour`.
  Density and label toggle.
- **Peaks**: live OSM peaks via Overpass, cached per viewport. Elevation
  filter, top-N, name required, custom peaks by lat/lon, exclude individual
  peaks.
- **Region presets**: one-click jump to the Adirondack High Peaks, the
  Catskills, the Whites, the Greens, the Smokies, the Front Range, the
  Sawatch, the Sangre de Cristo, and the Bernese Alps.
- **Custom layers**: drop in any GeoJSON URL (trails, boundaries) or any
  XYZ raster tile template (USGS topo, ESRI satellite, your own MBTiles
  server). Toggle, color, and remove inline.
- **Export**: PNG (with embedded DPI), PDF, and layered SVG. Pick the DPI
  to match your printer.

## Develop

Requires [Bun](https://bun.sh/).

```sh
bun install
bun run dev
```

Build for production:

```sh
bun run build
```

## Deploy

`.github/workflows/deploy.yml` builds with Vite and publishes the `dist/`
output to GitHub Pages on every push to `main`. After the first run:

1. Repo **Settings → Pages**
2. Set **Source** to **GitHub Actions**

The site is served from your `*.github.io/<repo>/` URL. The Vite config uses
`base: "./"` so the bundle works at both subpath and root deployments.

## Custom-layer usage

Open the **Custom layers** section in the sidebar.

- **GeoJSON URL**: any URL that returns a GeoJSON document. CORS must be
  enabled on the origin.
- **XYZ tile URL**: any `{z}/{x}/{y}` template. Examples that work without
  an API key:
  - USGS topo:
    `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}`
  - Stamen Terrain background (via Stadia):
    `https://tiles.stadiamaps.com/tiles/stamen_terrain_background/{z}/{x}/{y}.png`

Custom layers persist in localStorage alongside your custom peaks and
exclude list.

## Etiquette

OpenFreeMap, Overpass, Nominatim, and AWS Terrain Tiles are community /
shared resources. Don't hammer them. For high-traffic use, host your own
basemap and DEM tiles or stand up a private Overpass instance.

## License

MIT for the code in this repository. Terraink's MapLibre style code is
re-licensed here under AGPL-3.0 in its original feature folders; if you
distribute a hosted version you should preserve that.

Map data:

- OSM peak nodes — [OpenStreetMap](https://www.openstreetmap.org/) ODbL.
- Basemap — [OpenFreeMap](https://openfreemap.org/) /
  [OpenMapTiles](https://openmaptiles.org/).
- DEM tiles — [AWS Open Data
  Registry](https://registry.opendata.aws/terrain-tiles/) (Mapzen / NASA
  SRTM / etc.).
