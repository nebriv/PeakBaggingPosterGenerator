# Peak Bagging Poster Generator

Design a framable, topographic poster of any peak-bagging list — Adirondack
46ers, Catskill 3500, NH Whites, Colorado 14ers, the Alps, wherever — and
print it from your browser.

Pan/zoom to the region you care about. Peaks load live from
[OpenStreetMap](https://www.openstreetmap.org/) via the Overpass API.
Filter by elevation, name, or top-N. Pure black-and-white topo styling so
you can frame it on the wall and highlight your finished trails right on
the glass.

Nothing is hardcoded. Everything renders in the browser.

## Use

1. Open the site.
2. Drag/zoom the map, or pick a region preset, or type a place name to
   jump there.
3. Set the elevation filter to the peaks you care about. Out-of-range
   peaks stay visible but dim so the map's composition isn't ruined.
4. Tweak style and frame:
   - Toggle contours/hillshade, road overlay, attribution.
   - Adjust saturation (`0%` = pure B&W), contrast, brightness.
   - Pick an aspect ratio to match your frame (12×18, 18×24, etc.).
   - Set a title and subtitle.
5. **Print / PDF** → in the browser print dialog set margins to None and a
   paper size that matches your aspect ratio.

To highlight your hiked trails on the printed poster, frame it behind
glass and use a fine-tip wet-erase or dry-erase marker.

## Why these choices

- **Leaflet** for the map (no API key, MIT licensed).
- **OpenTopoMap** raster tiles have contour lines and hillshade baked in.
  CSS filters apply the grayscale aesthetic on the client.
- **Overpass API** for peak data. Cached by viewport so panning back
  doesn't refetch.
- **Nominatim** for the place search box.

No build step, no server, no API keys — just static files.

## Develop locally

```sh
python3 -m http.server 8000
# or
npx serve .
```

Open <http://localhost:8000>.

## Deploy

`.github/workflows/deploy.yml` publishes the site to GitHub Pages on every
push to `main`. After the first run:

1. Repo **Settings → Pages**
2. Set **Source** to **GitHub Actions**

The site is served from your `*.github.io` URL.

## Etiquette

OpenTopoMap, Nominatim, and Overpass are community resources. Please don't
hammer them — for high-traffic use, host your own tiles or stand up a
private Overpass instance.

## License

MIT for the code. Tile and data attribution is rendered on the poster
itself (OpenTopoMap CC-BY-SA, OSM ODbL, SRTM).
