# ADK 46 Poster Generator

A browser-based map generator for designing a framable poster of the
Adirondack 46 High Peaks. Inspired by the look of
[cartocuts.com](https://cartocuts.com), but with the filters needed for
peak-bagging posters — most importantly, filtering by elevation.

The map is rendered with [Leaflet](https://leafletjs.com/) on top of
[OpenTopoMap](https://opentopomap.org/) tiles (contours + hillshade) styled
into black and white with CSS filters. The 46ers are drawn as labeled
markers with their elevations.

## Use

1. Open the site.
2. Pick an aspect ratio for the poster.
3. Use the elevation slider to dim peaks outside the range you care about.
4. Toggle layers (contours, road overlay, peak names, elevations, border).
5. Pan/zoom to frame the composition.
6. Hit **Print / Save as PDF** — set the print dialog's margins to "None"
   and choose a paper size that matches your aspect ratio.

To physically highlight your hiked trails, print the poster, frame it
behind glass, and use a fine-tip wet-erase or dry-erase marker on the
glass.

## Develop locally

There's no build step. Any static file server works:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

## Deploy

A workflow at `.github/workflows/deploy.yml` publishes the repo to GitHub
Pages on every push to `main`. After the first run:

1. Open the repository's **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.

The site will be served from your `*.github.io` URL.

## Data

`js/peaks.js` is the traditional ADK 46 list (kept intact even where modern
surveys have moved a few peaks below 4000 ft). Coordinates are summit
positions and elevations are in feet.

## License

Code: MIT. Tile data: see attribution on the map (OpenTopoMap CC-BY-SA,
OSM ODbL, SRTM).
