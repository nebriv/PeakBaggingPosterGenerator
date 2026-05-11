/* Peak Bagging Poster Generator
 *
 * Vector-rendered topographic poster designer built on MapLibre GL JS.
 *
 * Base map: Stadia Maps vector styles (Alidade, Outdoors, Toner, …) or a
 *   custom "hillshade-only" style built from open DEM data.
 * Hillshade: AWS Terrain Tiles (terrarium PNG) fed into MapLibre's
 *   built-in `hillshade` shader — smooth at any zoom, no pre-baked rasters.
 * Contours: `maplibre-contour` generates true vector contour lines client-
 *   side from the same DEM source. Intervals scale with zoom.
 * Peaks: Live OSM data via Overpass, cached by grid cell so panning is
 *   instant. Markers are HTML overlays (DivIcon-style) so the icon picker,
 *   label collision, and tone-flipping logic share one rendering path.
 * Print: A temporary MapLibre instance is rendered at a higher pixelRatio
 *   for the print/PDF path — vector tiles re-rasterise crisply at any DPI.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------
  // Constants & state
  // ---------------------------------------------------------------

  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

  const M_TO_FT = 3.28084;

  // AWS Terrain Tiles — open DEM data, terrarium PNG encoding. The same
  // source feeds both the MapLibre hillshade layer and the contour
  // generator, so we only fetch each DEM tile once.
  const DEM_TILES =
    "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
  const DEM_ATTRIBUTION =
    '<a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>';

  // Peak cache TTL — 12h is comfortable for long editing sessions while
  // still picking up Overpass edits the next day.
  const PEAK_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  function gridStep(zoom) {
    if (zoom <= 8) return 1.0;
    if (zoom <= 10) return 0.5;
    if (zoom <= 12) return 0.25;
    return 0.1;
  }

  const state = {
    unit: "ft",
    peaks: [],
    cache: new Map(),
    fetchSeq: 0,
    inflight: null,
    prefetchTimer: null,
    custom: [],
    excluded: new Set(),
    filters: {
      eleMin: 0,
      eleMax: 9000,
      eleMinManual: false,
      eleMaxManual: false,
      requireName: false,
      requireEle: true,
      topN: 0,
    },
    display: {
      showLabels: true,
      showElev: true,
      border: true,
    },
    style: {
      icon: "triangle",
      paperColor: "#f6f1e6",
      blendMap: false,
      basemap: "hillshade-only",
      contoursEnabled: true,
      contourDensity: 60,
      contourLabels: true,
      hillshadeStrength: 50,
      stadiaKey: "",
      printDpi: 3,
    },
  };

  const USER_DATA_KEY = "pbpg.user";

  function loadUserData() {
    try {
      const raw = localStorage.getItem(USER_DATA_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.custom)) state.custom = data.custom;
      if (Array.isArray(data.excluded)) state.excluded = new Set(data.excluded);
      if (data.style && typeof data.style === "object") {
        Object.assign(state.style, data.style);
      }
    } catch (e) {
      console.warn("Could not load user data:", e);
    }
  }

  function saveUserData() {
    try {
      localStorage.setItem(
        USER_DATA_KEY,
        JSON.stringify({
          custom: state.custom,
          excluded: Array.from(state.excluded),
          style: state.style,
        })
      );
    } catch (e) {
      console.warn("Could not save user data:", e);
    }
  }

  // ---------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function setStatus(text, kind) {
    const chip = $("chip-status");
    chip.textContent = text;
    chip.dataset.kind = kind || "ready";
  }

  function metersToUnit(m) {
    if (m == null) return null;
    return state.unit === "ft" ? m * M_TO_FT : m;
  }
  function formatElev(m) {
    if (m == null) return "—";
    const v = metersToUnit(m);
    return Math.round(v).toLocaleString() + " " + state.unit;
  }

  // ---------------------------------------------------------------
  // Peak icon library
  // ---------------------------------------------------------------

  const peakIcons = {
    triangle: {
      label: "Triangle",
      svg:
        '<svg viewBox="0 0 12 12" aria-hidden="true">' +
        '<polygon points="6,1.5 11,10.5 1,10.5" stroke-width="0.9" stroke-linejoin="round"/>' +
        "</svg>",
    },
    "triangle-fill": {
      label: "Solid triangle",
      svg:
        '<svg viewBox="0 0 12 12" aria-hidden="true">' +
        '<polygon points="6,1 11,10.5 1,10.5"/>' +
        "</svg>",
    },
    mountain: {
      label: "Mountain range",
      svg:
        '<svg viewBox="0 0 12 12" aria-hidden="true">' +
        '<polygon points="0.5,11 3.5,5 5.5,7.5 8,3 11.5,11" stroke-width="0.6" stroke-linejoin="round"/>' +
        "</svg>",
    },
    bench: {
      label: "USGS benchmark",
      svg:
        '<svg viewBox="0 0 12 12" aria-hidden="true">' +
        '<circle cx="6" cy="6" r="4.5" fill="none" stroke-width="0.9"/>' +
        '<line x1="6" y1="1" x2="6" y2="11" stroke-width="0.9"/>' +
        '<line x1="1" y1="6" x2="11" y2="6" stroke-width="0.9"/>' +
        "</svg>",
    },
    "spot-height": {
      label: "Spot height",
      svg:
        '<svg viewBox="0 0 12 12" aria-hidden="true">' +
        '<line x1="2" y1="2" x2="10" y2="10" stroke-width="0.9"/>' +
        '<line x1="10" y1="2" x2="2" y2="10" stroke-width="0.9"/>' +
        '<circle cx="6" cy="6" r="1.6" stroke="none"/>' +
        "</svg>",
    },
    dot: {
      label: "Dot",
      svg:
        '<svg viewBox="0 0 12 12" aria-hidden="true">' +
        '<circle cx="6" cy="6" r="2.8" stroke="none"/>' +
        "</svg>",
    },
  };

  function iconForKey(key) {
    return peakIcons[key] ? key : "triangle";
  }

  // ---------------------------------------------------------------
  // MapLibre style construction
  // ---------------------------------------------------------------
  //
  // Each entry in `basemaps` returns either a Stadia style URL or an
  // inline style spec. The inline "hillshade-only" style is the cleanest
  // poster aesthetic — paper background + pure DEM-derived hillshade,
  // no labels or roads — and the one we default to.

  function stadiaSuffix() {
    const k = state.style.stadiaKey && state.style.stadiaKey.trim();
    return k ? "?api_key=" + encodeURIComponent(k) : "";
  }

  function stadiaStyleUrl(name) {
    return "https://tiles.stadiamaps.com/styles/" + name + ".json" + stadiaSuffix();
  }

  function stadiaGlyphsUrl() {
    // Glyphs/fonts share auth with Stadia tiles. Hosted as PBF per
    // fontstack+range. Used by every custom style we build so the
    // contour-label symbol layer always has a font to draw with.
    return "https://tiles.stadiamaps.com/fonts/{fontstack}/{range}.pbf" + stadiaSuffix();
  }

  function hillshadeOnlyStyle() {
    return {
      version: 8,
      glyphs: stadiaGlyphsUrl(),
      sources: {
        "terrain-dem": {
          type: "raster-dem",
          tiles: [DEM_TILES],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 13,
          attribution: DEM_ATTRIBUTION,
        },
      },
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": state.style.paperColor },
        },
        {
          id: "hillshade",
          type: "hillshade",
          source: "terrain-dem",
          paint: {
            "hillshade-shadow-color": "#222",
            "hillshade-highlight-color": "#fff",
            "hillshade-accent-color": "#333",
            "hillshade-exaggeration": state.style.hillshadeStrength / 100,
            "hillshade-illumination-direction": 315,
          },
        },
      ],
    };
  }

  function paperOnlyStyle() {
    return {
      version: 8,
      glyphs: stadiaGlyphsUrl(),
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": state.style.paperColor },
        },
      ],
    };
  }

  function satelliteStyle() {
    return {
      version: 8,
      glyphs: stadiaGlyphsUrl(),
      sources: {
        satellite: {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution:
            'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#000" } },
        { id: "satellite", type: "raster", source: "satellite" },
      ],
    };
  }

  const basemaps = {
    "hillshade-only": { label: "Hillshade only", tone: "light", build: hillshadeOnlyStyle },
    alidade_smooth: { label: "Alidade Smooth", tone: "light", build: () => stadiaStyleUrl("alidade_smooth") },
    alidade_smooth_dark: { label: "Alidade Smooth Dark", tone: "dark", build: () => stadiaStyleUrl("alidade_smooth_dark") },
    outdoors: { label: "Outdoors", tone: "light", build: () => stadiaStyleUrl("outdoors") },
    stamen_toner: { label: "Stamen Toner", tone: "light", build: () => stadiaStyleUrl("stamen_toner") },
    stamen_toner_lite: { label: "Stamen Toner Lite", tone: "light", build: () => stadiaStyleUrl("stamen_toner_lite") },
    osm_bright: { label: "OSM Bright", tone: "light", build: () => stadiaStyleUrl("osm_bright") },
    satellite: { label: "Satellite", tone: "dark", build: satelliteStyle },
    paper: { label: "Paper only", tone: "light", build: paperOnlyStyle },
  };

  function basemapTone(key) {
    return (basemaps[key] && basemaps[key].tone) || "light";
  }

  // ---------------------------------------------------------------
  // Contour source (maplibre-contour) — generates vector contour
  // tiles from the DEM source. Re-instantiated whenever the unit
  // changes so the threshold rounding stays nice.
  // ---------------------------------------------------------------

  let demSource = null;
  function makeDemSource() {
    if (typeof mlcontour === "undefined") {
      console.warn("maplibre-contour failed to load — contours disabled");
      return null;
    }
    const src = new mlcontour.DemSource({
      url: DEM_TILES,
      encoding: "terrarium",
      maxzoom: 13,
      worker: true,
    });
    src.setupMaplibre(maplibregl);
    return src;
  }

  function contourThresholds() {
    // Threshold pairs are [minor, major] in the user's chosen unit. The
    // contour plugin scales the elevation values by `multiplier` before
    // applying these, so we can pick round numbers in feet OR meters
    // without rebuilding the source.
    if (state.unit === "ft") {
      return {
        9: [1000, 5000],
        10: [500, 2500],
        11: [200, 1000],
        12: [100, 500],
        13: [50, 200],
        14: [40, 200],
        15: [20, 100],
      };
    }
    return {
      9: [250, 1000],
      10: [100, 500],
      11: [50, 250],
      12: [25, 100],
      13: [20, 100],
      14: [10, 50],
      15: [5, 25],
    };
  }

  function contourTileUrl() {
    if (!demSource) return null;
    return demSource.contourProtocolUrl({
      multiplier: state.unit === "ft" ? M_TO_FT : 1,
      thresholds: contourThresholds(),
      elevationKey: "ele",
      levelKey: "level",
      contourLayer: "contours",
    });
  }

  // ---------------------------------------------------------------
  // Map setup
  // ---------------------------------------------------------------

  let currentBasemap = state.style.basemap;
  const initialStyle = basemaps[currentBasemap]
    ? basemaps[currentBasemap].build()
    : hillshadeOnlyStyle();

  const map = new maplibregl.Map({
    container: "map",
    style: initialStyle,
    center: [-74.0, 44.2],
    zoom: 9.5,
    minZoom: 2,
    maxZoom: 18,
    attributionControl: false,
    preserveDrawingBuffer: true, // needed so the canvas can be captured for print
    fadeDuration: 200,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");

  function setMapTone(key) {
    const dark = basemapTone(key) === "dark";
    map.getContainer().classList.toggle("map--dark-base", dark);
  }
  setMapTone(currentBasemap);

  // Add hillshade + contour overlays on top of whichever basemap is loaded.
  // These run on every `style.load` since `map.setStyle` blows away all
  // sources and layers.
  function addCustomLayers() {
    const styleHasOwnHillshade =
      currentBasemap === "hillshade-only" || currentBasemap === "satellite" || currentBasemap === "paper";

    // Add a hillshade layer on top of Stadia vector basemaps so any
    // basemap gets terrain-aware shading. Skip on hillshade-only (already
    // has one) and on satellite/paper (would obscure the imagery / look
    // wrong on flat paper).
    if (!styleHasOwnHillshade && state.style.hillshadeStrength > 0) {
      if (!map.getSource("terrain-dem")) {
        map.addSource("terrain-dem", {
          type: "raster-dem",
          tiles: [DEM_TILES],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 13,
          attribution: DEM_ATTRIBUTION,
        });
      }
      // Insert beneath labels if the basemap exposes a label layer we
      // can recognise; otherwise add on top.
      const beforeLayer = findFirstLabelLayer();
      map.addLayer(
        {
          id: "hillshade-overlay",
          type: "hillshade",
          source: "terrain-dem",
          paint: {
            "hillshade-shadow-color": "#000",
            "hillshade-highlight-color": "#fff",
            "hillshade-accent-color": "#000",
            "hillshade-exaggeration": state.style.hillshadeStrength / 100,
            "hillshade-illumination-direction": 315,
          },
        },
        beforeLayer || undefined
      );
    }

    // Contours generated client-side from the DEM tiles. Two layers:
    // line work + optional elevation labels on the major contours.
    if (state.style.contoursEnabled) {
      addContourLayers();
    }
  }

  function findFirstLabelLayer() {
    // Find the first symbol layer (typically a label) so we can insert
    // overlays beneath it; this keeps place names readable.
    const layers = map.getStyle().layers || [];
    for (const ly of layers) {
      if (ly.type === "symbol") return ly.id;
    }
    return null;
  }

  function addContourLayers() {
    if (!demSource) return;
    if (map.getLayer("contour-lines")) return;
    if (!map.getSource("contour-source")) {
      map.addSource("contour-source", {
        type: "vector",
        tiles: [contourTileUrl()],
        maxzoom: 15,
        attribution: DEM_ATTRIBUTION,
      });
    }
    const dark = basemapTone(currentBasemap) === "dark";
    const lineColor = dark ? "rgba(246,241,230,0.75)" : "rgba(20,20,20,0.7)";
    const labelColor = dark ? "rgba(246,241,230,0.95)" : "rgba(20,20,20,0.85)";
    const haloColor = dark ? "rgba(0,0,0,0.6)" : "rgba(246,241,230,0.85)";

    map.addLayer({
      id: "contour-lines",
      type: "line",
      source: "contour-source",
      "source-layer": "contours",
      paint: {
        "line-color": lineColor,
        "line-width": ["match", ["get", "level"], 1, 1.0, 0.45],
        "line-opacity": state.style.contourDensity / 100,
      },
    });

    if (state.style.contourLabels) {
      map.addLayer({
        id: "contour-labels",
        type: "symbol",
        source: "contour-source",
        "source-layer": "contours",
        filter: [">", ["get", "level"], 0],
        layout: {
          "symbol-placement": "line",
          "text-size": 10,
          "text-field": ["concat", ["to-string", ["get", "ele"]], state.unit === "ft" ? "′" : " m"],
          "text-font": ["Roboto Regular", "Noto Sans Regular"],
          "text-padding": 6,
          "text-rotation-alignment": "map",
          "text-pitch-alignment": "viewport",
          "text-max-angle": 25,
        },
        paint: {
          "text-color": labelColor,
          "text-halo-color": haloColor,
          "text-halo-width": 1.2,
          "text-opacity": state.style.contourDensity / 100,
        },
      });
    }
  }

  function removeContourLayers() {
    if (map.getLayer("contour-labels")) map.removeLayer("contour-labels");
    if (map.getLayer("contour-lines")) map.removeLayer("contour-lines");
    if (map.getSource("contour-source")) map.removeSource("contour-source");
  }

  // ---------------------------------------------------------------
  // Style switching
  // ---------------------------------------------------------------

  function applyBasemap(key) {
    if (!basemaps[key]) return;
    currentBasemap = key;
    state.style.basemap = key;
    setMapTone(key);
    map.setStyle(basemaps[key].build());
    // `style.load` will re-add custom layers.
  }

  function applyPaperColor() {
    document.documentElement.style.setProperty("--paper", state.style.paperColor);
    if (map.getLayer("background")) {
      map.setPaintProperty("background", "background-color", state.style.paperColor);
    }
  }

  function applyBlendMap() {
    const canvas = map.getCanvas();
    canvas.style.mixBlendMode = state.style.blendMap ? "multiply" : "";
  }

  function applyCanvasFilter() {
    const s = $("opt-sat").value;
    const c = $("opt-con").value;
    const b = $("opt-bri").value;
    $("sat-readout").textContent = s + "%";
    $("con-readout").textContent = c + "%";
    $("bri-readout").textContent = b + "%";
    map.getCanvas().style.filter =
      "grayscale(" + (100 - s) + "%) contrast(" + c + "%) brightness(" + b + "%)";
  }

  function applyContourEnabled() {
    if (state.style.contoursEnabled) {
      addContourLayers();
    } else {
      removeContourLayers();
    }
  }

  function applyContourDensity() {
    const op = state.style.contourDensity / 100;
    if (map.getLayer("contour-lines")) {
      map.setPaintProperty("contour-lines", "line-opacity", op);
    }
    if (map.getLayer("contour-labels")) {
      map.setPaintProperty("contour-labels", "text-opacity", op);
    }
  }

  function applyHillshadeStrength() {
    const v = state.style.hillshadeStrength / 100;
    if (map.getLayer("hillshade")) {
      map.setPaintProperty("hillshade", "hillshade-exaggeration", v);
    }
    if (map.getLayer("hillshade-overlay")) {
      map.setPaintProperty("hillshade-overlay", "hillshade-exaggeration", v);
    }
  }

  map.on("style.load", () => {
    addCustomLayers();
    applyPaperColor();
    applyContourDensity();
  });

  // ---------------------------------------------------------------
  // Overpass: fetch peaks for current map view, cell-cached
  // ---------------------------------------------------------------

  function cellKey(s, w, step) {
    return s.toFixed(3) + "/" + w.toFixed(3) + "/" + step;
  }

  function cellsForBounds(bounds, step) {
    const s0 = Math.floor(bounds.getSouth() / step) * step;
    const w0 = Math.floor(bounds.getWest() / step) * step;
    const n0 = Math.ceil(bounds.getNorth() / step) * step;
    const e0 = Math.ceil(bounds.getEast() / step) * step;
    const out = [];
    const eps = step / 1000;
    for (let lat = s0; lat < n0 - eps; lat += step) {
      for (let lng = w0; lng < e0 - eps; lng += step) {
        out.push({
          s: +lat.toFixed(6),
          w: +lng.toFixed(6),
          n: +(lat + step).toFixed(6),
          e: +(lng + step).toFixed(6),
          step: step,
          key: cellKey(lat, lng, step),
        });
      }
    }
    return out;
  }

  function chooseCellsForBounds(bounds, zoom) {
    let step = gridStep(zoom);
    let cells = cellsForBounds(bounds, step);
    while (cells.length > 30) {
      step *= 2;
      cells = cellsForBounds(bounds, step);
    }
    return { cells, step };
  }

  function parseElev(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    const m = s.match(/^(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (Number.isNaN(v)) return null;
    if (/(?:ft|feet|')\s*$/i.test(s)) v = v / M_TO_FT;
    return v;
  }

  function parseOSMElement(el) {
    if (!el || !el.tags) return null;
    const tags = el.tags;
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || lon == null) return null;
    return {
      id: el.type + "/" + el.id,
      lat: lat,
      lng: lon,
      name: tags.name || tags["name:en"] || null,
      ele: parseElev(tags.ele),
      kind: tags.natural || "peak",
      wiki: tags.wikipedia || tags.wikidata || null,
    };
  }

  async function overpassFetch(query, signal) {
    let lastErr = null;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(query),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: signal,
        });
        if (!res.ok) {
          lastErr = new Error("HTTP " + res.status);
          continue;
        }
        return await res.json();
      } catch (e) {
        if (e.name === "AbortError") throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error("All Overpass endpoints failed");
  }

  function buildOverpassQuery(cells) {
    const parts = cells
      .map(
        (c) =>
          'node["natural"="peak"](' + c.s + "," + c.w + "," + c.n + "," + c.e + ");" +
          'node["natural"="volcano"](' + c.s + "," + c.w + "," + c.n + "," + c.e + ");"
      )
      .join("");
    return "[out:json][timeout:25];(" + parts + ");out body;";
  }

  function bucketPeaksIntoCells(peaks, cells) {
    const out = new Map();
    cells.forEach((c) => out.set(c.key, []));
    peaks.forEach((p) => {
      for (const c of cells) {
        if (p.lat >= c.s && p.lat <= c.n && p.lng >= c.w && p.lng <= c.e) {
          out.get(c.key).push(p);
          break;
        }
      }
    });
    return out;
  }

  function cachedCellPeaks(c) {
    const entry = state.cache.get(c.key);
    if (!entry) return null;
    if (Date.now() - entry.t > PEAK_CACHE_TTL_MS) {
      state.cache.delete(c.key);
      return null;
    }
    return entry.peaks;
  }

  async function fetchCells(cells, signal) {
    if (!cells.length) return [];
    const data = await overpassFetch(buildOverpassQuery(cells), signal);
    const peaks = (data.elements || []).map(parseOSMElement).filter(Boolean);
    const bucketed = bucketPeaksIntoCells(peaks, cells);
    const now = Date.now();
    bucketed.forEach((p, key) => state.cache.set(key, { peaks: p, t: now }));
    cells.forEach((c) => {
      if (!state.cache.has(c.key)) state.cache.set(c.key, { peaks: [], t: now });
    });
    return peaks;
  }

  function mapBounds() {
    // MapLibre's LngLatBounds shares getNorth/South/East/West with Leaflet.
    return map.getBounds();
  }

  async function fetchPeaks() {
    const zoom = map.getZoom();
    const bounds = mapBounds();

    if (zoom < 7) {
      state.peaks = [];
      render();
      setStatus("zoom in to load peaks", "info");
      return;
    }

    const { cells, step } = chooseCellsForBounds(bounds, zoom);
    const cached = [];
    const missing = [];
    cells.forEach((c) => {
      const hit = cachedCellPeaks(c);
      if (hit) cached.push(...hit);
      else missing.push(c);
    });

    if (!missing.length) {
      const byId = new Map();
      cached.forEach((p) => byId.set(p.id, p));
      state.peaks = Array.from(byId.values());
      setStatus(state.peaks.length + " peaks (cached)", "ready");
      render();
      schedulePrefetch(cells, step);
      return;
    }

    if (state.inflight) state.inflight.abort();
    const ctrl = new AbortController();
    state.inflight = ctrl;
    const mySeq = ++state.fetchSeq;

    setStatus("loading peaks…", "loading");

    try {
      const fetched = await fetchCells(missing, ctrl.signal);
      if (mySeq !== state.fetchSeq) return;
      const byId = new Map();
      cached.concat(fetched).forEach((p) => byId.set(p.id, p));
      state.peaks = Array.from(byId.values());
      setStatus(state.peaks.length + " peaks loaded", "ready");
      render();
      schedulePrefetch(cells, step);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Overpass fetch failed:", err);
      setStatus("fetch failed — try again", "error");
    } finally {
      if (state.inflight === ctrl) state.inflight = null;
    }
  }

  function schedulePrefetch(visibleCells, step) {
    if (state.prefetchTimer) clearTimeout(state.prefetchTimer);
    state.prefetchTimer = setTimeout(() => {
      if (!visibleCells.length) return;
      let minS = Infinity, minW = Infinity, maxN = -Infinity, maxE = -Infinity;
      visibleCells.forEach((c) => {
        if (c.s < minS) minS = c.s;
        if (c.w < minW) minW = c.w;
        if (c.n > maxN) maxN = c.n;
        if (c.e > maxE) maxE = c.e;
      });
      const expanded = {
        getSouth: () => minS - step,
        getWest: () => minW - step,
        getNorth: () => maxN + step,
        getEast: () => maxE + step,
      };
      const neighbors = cellsForBounds(expanded, step).filter(
        (c) => !cachedCellPeaks(c)
      );
      if (!neighbors.length) return;
      const batch = neighbors.slice(0, 12);
      fetchCells(batch).catch(() => {});
    }, 1800);
  }

  const fetchPeaksDebounced = debounce(fetchPeaks, 400);

  // ---------------------------------------------------------------
  // Rendering — MapLibre Markers
  // ---------------------------------------------------------------

  // Pool of active markers, keyed by peak id. We diff against the new
  // visible set rather than tearing down every marker on each render so
  // pan/zoom doesn't churn the DOM.
  const markers = new Map();

  function allPeaks() {
    return state.peaks.concat(state.custom);
  }

  function visiblePeaks() {
    const lo = state.filters.eleMin;
    const hi = state.filters.eleMax;
    const requireName = state.filters.requireName;
    const requireEle = state.filters.requireEle;

    let arr = allPeaks().filter((p) => {
      if (state.excluded.has(p.id)) return false;
      if (requireName && !p.name) return false;
      if (requireEle && p.ele == null) return false;
      if (p.ele == null) return true;
      const v = metersToUnit(p.ele);
      return v >= lo && v <= hi;
    });

    arr.sort((a, b) => {
      const av = a.ele == null ? -Infinity : a.ele;
      const bv = b.ele == null ? -Infinity : b.ele;
      return bv - av;
    });

    if (state.filters.topN > 0) {
      arr = arr.slice(0, state.filters.topN);
    }
    return arr;
  }

  function buildPinElement(peak) {
    const nameHtml = peak.name
      ? '<span class="pin__name">' + escapeHtml(peak.name) + "</span>"
      : "";
    const eleHtml =
      peak.ele != null
        ? '<span class="pin__ele">' + formatElev(peak.ele) + "</span>"
        : "";
    const showLabel =
      (state.display.showLabels || state.display.showElev) &&
      !peak._labelHidden;
    const label = showLabel
      ? '<span class="pin__label">' +
        (state.display.showLabels ? nameHtml : "") +
        (state.display.showElev ? eleHtml : "") +
        "</span>"
      : "";
    const iconKey = iconForKey(state.style.icon);
    const glyph =
      '<span class="pin__glyph pin__glyph--' + iconKey + '">' +
      peakIcons[iconKey].svg +
      "</span>";

    const el = document.createElement("div");
    el.className = "pin pin--" + iconKey;
    el.innerHTML = glyph + label;
    return el;
  }

  function suppressOverlappingLabels(peaks) {
    const minSepX = 78;
    const minSepY = 26;
    const placed = [];
    peaks.forEach((p) => {
      const pt = map.project([p.lng, p.lat]);
      const collides = placed.some((sp) => {
        const spt = map.project([sp.lng, sp.lat]);
        return (
          Math.abs(pt.x - spt.x) < minSepX &&
          Math.abs(pt.y - spt.y) < minSepY
        );
      });
      p._labelHidden = collides;
      if (!collides) placed.push(p);
    });
  }

  function render() {
    const shown = visiblePeaks();
    suppressOverlappingLabels(shown);

    const wantedIds = new Set();
    shown.forEach((peak) => {
      wantedIds.add(peak.id);
      const el = buildPinElement(peak);
      upsertMarker(peak, el);
    });

    // Drop markers that are no longer wanted
    for (const [id, mk] of markers) {
      if (!wantedIds.has(id)) {
        mk.remove();
        markers.delete(id);
      }
    }

    updateBadges(shown);
    updatePeakList(shown);
    updateExcludedList();
    updateAutoElevationRange();
  }

  function upsertMarker(peak, el) {
    const existing = markers.get(peak.id);
    if (existing) {
      // Replace the inner element in-place so we don't churn the
      // MapLibre marker container (and its DOM position).
      const container = existing.getElement();
      container.innerHTML = "";
      container.appendChild(el);
      existing.setLngLat([peak.lng, peak.lat]);
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "pin-wrap";
    wrap.appendChild(el);
    const mk = new maplibregl.Marker({
      element: wrap,
      anchor: "bottom",
    })
      .setLngLat([peak.lng, peak.lat])
      .addTo(map);
    markers.set(peak.id, mk);
  }

  function updateBadges(shown) {
    $("chip-peaks").textContent =
      shown.length + " peak" + (shown.length === 1 ? "" : "s");
    $("badge-peaks").textContent = String(shown.length);
  }

  function renderPeakListItem(p, opts) {
    const name = p.name
      ? escapeHtml(p.name)
      : '<em class="peaklist__unnamed">unnamed</em>';
    const ele =
      p.ele != null
        ? '<span class="peaklist__ele">' + formatElev(p.ele) + "</span>"
        : '<span class="peaklist__ele peaklist__ele--missing">—</span>';
    const tag = p.custom
      ? '<span class="peaklist__tag" title="Custom peak">+</span>'
      : "";
    const action = opts.action;
    const cls = "peaklist__item" + (p.custom ? " peaklist__item--custom" : "");
    return (
      '<li class="' + cls + '" ' +
      'data-id="' + escapeHtml(p.id) + '" ' +
      'data-lat="' + p.lat + '" data-lng="' + p.lng + '">' +
      '<span class="peaklist__name">' + tag + name + "</span>" +
      ele +
      '<button type="button" class="' + action.cls + '" ' +
      'aria-label="' + action.title + '" title="' + action.title + '">' +
      action.label +
      "</button>" +
      "</li>"
    );
  }

  function updatePeakList(shown) {
    const list = $("peaklist");
    if (!shown.length) {
      list.innerHTML =
        '<li class="peaklist__empty">No peaks match the current filters.</li>';
      return;
    }
    list.innerHTML = shown
      .map((p) =>
        renderPeakListItem(p, {
          action: { cls: "peaklist__hide", label: "✕", title: "Hide peak" },
        })
      )
      .join("");
  }

  function updateExcludedList() {
    const wrap = $("excluded-wrap");
    const list = $("excluded-peaklist");
    const count = state.excluded.size;
    $("badge-excluded").textContent = String(count);
    if (count === 0) {
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "";
    const byId = new Map();
    allPeaks().forEach((p) => byId.set(p.id, p));
    list.innerHTML = Array.from(state.excluded)
      .map((id) => {
        const p =
          byId.get(id) || { id: id, name: null, ele: null, lat: 0, lng: 0 };
        return renderPeakListItem(p, {
          action: {
            cls: "peaklist__restore",
            label: "↺",
            title: "Restore peak",
          },
        });
      })
      .join("");
  }

  function updateAutoElevationRange() {
    const eles = state.peaks
      .map((p) => p.ele)
      .filter((e) => e != null)
      .map(metersToUnit);
    if (!eles.length) return;
    const lo = Math.floor(Math.min(...eles) / 10) * 10;
    const hi = Math.ceil(Math.max(...eles) / 10) * 10;

    const slMin = $("elev-min");
    const slMax = $("elev-max");
    slMin.min = lo;
    slMin.max = hi;
    slMax.min = lo;
    slMax.max = hi;

    if (!state.filters.eleMinManual) {
      slMin.value = lo;
      state.filters.eleMin = lo;
    }
    if (!state.filters.eleMaxManual) {
      slMax.value = hi;
      state.filters.eleMax = hi;
    }
    updateElevReadout();
  }

  function updateElevReadout() {
    $("elev-readout").textContent =
      Math.round(state.filters.eleMin) +
      " / " +
      Math.round(state.filters.eleMax) +
      " " +
      state.unit;
  }

  // ---------------------------------------------------------------
  // Geocoding (Nominatim)
  // ---------------------------------------------------------------

  async function searchPlace(q) {
    if (!q.trim()) return [];
    const params = new URLSearchParams({
      q: q,
      format: "json",
      limit: "5",
      addressdetails: "0",
    });
    const res = await fetch(NOMINATIM_URL + "?" + params.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function showSearchResults(items) {
    const ul = $("search-results");
    if (!items.length) {
      ul.innerHTML = "";
      ul.style.display = "none";
      return;
    }
    ul.innerHTML = items
      .map(
        (it, i) =>
          '<li><button type="button" data-idx="' +
          i +
          '">' +
          escapeHtml(it.display_name) +
          "</button></li>"
      )
      .join("");
    ul.style.display = "block";
    ul.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        const it = items[+b.dataset.idx];
        state.filters.eleMinManual = false;
        state.filters.eleMaxManual = false;
        if (it.boundingbox) {
          const [s, n, w, e] = it.boundingbox.map(parseFloat);
          map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 400 });
        } else {
          map.flyTo({ center: [+it.lon, +it.lat], zoom: 11, duration: 400 });
        }
        ul.style.display = "none";
        $("search-input").value = it.display_name;
      })
    );
  }

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------

  function wirePanel() {
    $("toggle-panel").addEventListener("click", (e) => {
      const panel = $("panel");
      const open = panel.classList.toggle("panel--closed") ? false : true;
      e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
      setTimeout(() => map.resize(), 220);
    });
  }

  function wireUnits() {
    function setUnit(unit) {
      if (unit === state.unit) return;
      const oldMin = state.filters.eleMin;
      const oldMax = state.filters.eleMax;
      const oldUnit = state.unit;
      state.unit = unit;
      const conv = (v) =>
        oldUnit === unit
          ? v
          : oldUnit === "ft"
          ? v / M_TO_FT
          : v * M_TO_FT;
      state.filters.eleMin = conv(oldMin);
      state.filters.eleMax = conv(oldMax);

      $("unit-ft").classList.toggle("seg__btn--on", unit === "ft");
      $("unit-m").classList.toggle("seg__btn--on", unit === "m");
      $("foot-unit").textContent =
        "elevations in " + (unit === "ft" ? "feet" : "meters");
      refreshAddPeakUnit();
      // Contours are keyed off feet/meters thresholds — rebuild the
      // source so the new contours fall on round numbers in the chosen
      // unit instead of a re-scaled meter grid.
      removeContourLayers();
      if (state.style.contoursEnabled) addContourLayers();
      render();
    }
    $("unit-ft").addEventListener("click", () => setUnit("ft"));
    $("unit-m").addEventListener("click", () => setUnit("m"));
  }

  function wireFilters() {
    const slMin = $("elev-min");
    const slMax = $("elev-max");

    function onMin() {
      let lo = +slMin.value;
      let hi = +slMax.value;
      if (lo > hi) {
        lo = hi;
        slMin.value = lo;
      }
      state.filters.eleMin = lo;
      state.filters.eleMinManual = true;
      updateElevReadout();
      render();
    }
    function onMax() {
      let lo = +slMin.value;
      let hi = +slMax.value;
      if (hi < lo) {
        hi = lo;
        slMax.value = hi;
      }
      state.filters.eleMax = hi;
      state.filters.eleMaxManual = true;
      updateElevReadout();
      render();
    }
    slMin.addEventListener("input", onMin);
    slMax.addEventListener("input", onMax);

    $("opt-require-name").addEventListener("change", (e) => {
      state.filters.requireName = e.target.checked;
      render();
    });
    $("opt-require-ele").addEventListener("change", (e) => {
      state.filters.requireEle = e.target.checked;
      render();
    });
    $("opt-show-labels").addEventListener("change", (e) => {
      state.display.showLabels = e.target.checked;
      render();
    });
    $("opt-show-elev").addEventListener("change", (e) => {
      state.display.showElev = e.target.checked;
      render();
    });

    const topn = $("opt-topn");
    topn.addEventListener("input", () => {
      state.filters.topN = +topn.value;
      $("topn-readout").textContent =
        state.filters.topN === 0 ? "all" : String(state.filters.topN);
      render();
    });
  }

  function setIconPickerSelection(key) {
    document.querySelectorAll(".icon-picker__opt").forEach((btn) => {
      btn.classList.toggle("icon-picker__opt--on", btn.dataset.icon === key);
    });
  }

  function buildIconPicker() {
    const root = $("icon-picker");
    if (!root) return;
    root.innerHTML = Object.entries(peakIcons)
      .map(
        ([key, ic]) =>
          '<button type="button" class="icon-picker__opt pin pin--' +
          key + '" data-icon="' + key + '" title="' + escapeHtml(ic.label) +
          '" aria-label="' + escapeHtml(ic.label) + '">' +
          '<span class="pin__glyph pin__glyph--' + key + '">' +
          ic.svg + "</span></button>"
      )
      .join("");
    setIconPickerSelection(state.style.icon);
    root.addEventListener("click", (e) => {
      const btn = e.target.closest(".icon-picker__opt");
      if (!btn) return;
      state.style.icon = iconForKey(btn.dataset.icon);
      setIconPickerSelection(state.style.icon);
      saveUserData();
      render();
    });
  }

  function wireStyle() {
    $("opt-map-style").addEventListener("change", (e) => {
      applyBasemap(e.target.value);
      saveUserData();
    });

    $("opt-contours").addEventListener("change", (e) => {
      state.style.contoursEnabled = e.target.checked;
      applyContourEnabled();
      saveUserData();
    });

    $("opt-contour-density").addEventListener("input", (e) => {
      state.style.contourDensity = +e.target.value;
      $("contour-readout").textContent = state.style.contourDensity + "%";
      applyContourDensity();
      saveUserData();
    });

    $("opt-contour-labels").addEventListener("change", (e) => {
      state.style.contourLabels = e.target.checked;
      removeContourLayers();
      if (state.style.contoursEnabled) addContourLayers();
      saveUserData();
    });

    $("opt-hillshade").addEventListener("input", (e) => {
      state.style.hillshadeStrength = +e.target.value;
      $("hill-readout").textContent = state.style.hillshadeStrength + "%";
      applyHillshadeStrength();
      saveUserData();
    });

    $("opt-stadia-key").addEventListener("change", (e) => {
      state.style.stadiaKey = e.target.value.trim();
      saveUserData();
      // Re-apply basemap so the URL picks up the new key.
      applyBasemap(state.style.basemap);
    });

    $("opt-print-dpi").addEventListener("change", (e) => {
      state.style.printDpi = +e.target.value;
      saveUserData();
    });

    $("opt-attribution").addEventListener("change", (e) => {
      // MapLibre exposes the control container via the dom; toggle visually.
      const el = document.querySelector(".maplibregl-ctrl-bottom-left");
      if (el) el.style.display = e.target.checked ? "" : "none";
    });

    $("opt-border").addEventListener("change", (e) => {
      $("poster").classList.toggle("poster--noborder", !e.target.checked);
    });

    ["opt-sat", "opt-con", "opt-bri"].forEach((id) =>
      $(id).addEventListener("input", applyCanvasFilter)
    );
    applyCanvasFilter();

    const paperInput = $("opt-paper");
    const paperReadout = $("paper-readout");
    paperInput.value = state.style.paperColor;
    if (paperReadout) paperReadout.textContent = state.style.paperColor;
    paperInput.addEventListener("input", () => {
      state.style.paperColor = paperInput.value;
      if (paperReadout) paperReadout.textContent = state.style.paperColor;
      applyPaperColor();
      saveUserData();
    });

    const blendInput = $("opt-blend-map");
    blendInput.checked = state.style.blendMap;
    blendInput.addEventListener("change", () => {
      state.style.blendMap = blendInput.checked;
      applyBlendMap();
      saveUserData();
    });

    // Hydrate map style dropdown + sliders from saved state.
    $("opt-map-style").value = state.style.basemap;
    $("opt-contours").checked = state.style.contoursEnabled;
    $("opt-contour-density").value = state.style.contourDensity;
    $("contour-readout").textContent = state.style.contourDensity + "%";
    $("opt-contour-labels").checked = state.style.contourLabels;
    $("opt-hillshade").value = state.style.hillshadeStrength;
    $("hill-readout").textContent = state.style.hillshadeStrength + "%";
    $("opt-print-dpi").value = state.style.printDpi;
    $("opt-stadia-key").value = state.style.stadiaKey;
  }

  function wirePoster() {
    const titleIn = $("poster-title");
    const subIn = $("poster-subtitle");
    titleIn.addEventListener("input", () => {
      $("title-display").textContent = titleIn.value;
    });
    subIn.addEventListener("input", () => {
      $("subtitle-display").textContent = subIn.value;
      $("subtitle-display").style.display = subIn.value ? "" : "none";
    });
    $("aspect").addEventListener("change", (e) => {
      $("poster").dataset.aspect = e.target.value;
      setTimeout(() => map.resize(), 80);
    });
    $("print").addEventListener("click", printPoster);
  }

  function wireSearch() {
    const input = $("search-input");
    const btn = $("search-btn");
    let cur = [];

    const run = async () => {
      const q = input.value.trim();
      if (!q) {
        showSearchResults([]);
        return;
      }
      setStatus("searching…", "loading");
      try {
        cur = await searchPlace(q);
        showSearchResults(cur);
        setStatus("ready", "ready");
      } catch (e) {
        setStatus("search failed", "error");
      }
    };

    btn.addEventListener("click", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run();
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".combo") && !e.target.closest(".combo__results")) {
        $("search-results").style.display = "none";
      }
    });
  }

  function resetElevationFilter() {
    state.filters.eleMinManual = false;
    state.filters.eleMaxManual = false;
  }

  function wirePresets() {
    document.querySelectorAll(".preset").forEach((b) => {
      b.addEventListener("click", () => {
        const [s, w, n, e] = b.dataset.bounds.split(",").map(parseFloat);
        resetElevationFilter();
        map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 500 });
        const cur = $("poster-title").value;
        if (cur === "High Peaks" || !cur) {
          $("poster-title").value = b.dataset.label;
          $("title-display").textContent = b.dataset.label;
        }
      });
    });
  }

  function wirePeakList() {
    const list = $("peaklist");
    let highlight = null;
    function clearHighlight() {
      if (highlight) {
        highlight.remove();
        highlight = null;
      }
    }
    list.addEventListener("mouseover", (e) => {
      const li = e.target.closest(".peaklist__item");
      if (!li) return;
      const lat = +li.dataset.lat;
      const lng = +li.dataset.lng;
      clearHighlight();
      const el = document.createElement("div");
      el.className = "peak-highlight";
      highlight = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
    });
    list.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget || !e.relatedTarget.closest(".peaklist")) {
        clearHighlight();
      }
    });
    list.addEventListener("click", (e) => {
      if (e.target.classList.contains("peaklist__hide")) {
        e.stopPropagation();
        const li = e.target.closest(".peaklist__item");
        if (!li) return;
        state.excluded.add(li.dataset.id);
        saveUserData();
        clearHighlight();
        render();
        return;
      }
      const li = e.target.closest(".peaklist__item");
      if (!li) return;
      const lat = +li.dataset.lat;
      const lng = +li.dataset.lng;
      map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 13),
        duration: 600,
      });
    });

    $("excluded-peaklist").addEventListener("click", (e) => {
      if (!e.target.classList.contains("peaklist__restore")) return;
      const li = e.target.closest(".peaklist__item");
      if (!li) return;
      state.excluded.delete(li.dataset.id);
      saveUserData();
      render();
    });
  }

  // ---------------------------------------------------------------
  // Custom peaks
  // ---------------------------------------------------------------

  function addCustomPeak({ name, eleM, lat, lng }) {
    const peak = {
      id:
        "custom/" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 7),
      name: name,
      ele: eleM,
      lat: lat,
      lng: lng,
      kind: "peak",
      wiki: null,
      custom: true,
    };
    state.custom.push(peak);
    saveUserData();
    render();
  }

  function refreshAddPeakUnit() {
    const el = $("ap-unit");
    if (el) el.textContent = state.unit;
  }

  function wireCustomPeaks() {
    const form = $("add-peak-form");
    if (!form) return;
    const nameInput = $("ap-name");
    const eleInput = $("ap-ele");
    const latInput = $("ap-lat");
    const lngInput = $("ap-lng");
    const errEl = $("ap-error");

    refreshAddPeakUnit();

    function showError(msg) {
      if (!errEl) return;
      errEl.textContent = msg || "";
      errEl.style.display = msg ? "" : "none";
    }

    $("ap-center").addEventListener("click", () => {
      const c = map.getCenter();
      latInput.value = c.lat.toFixed(6);
      lngInput.value = c.lng.toFixed(6);
      nameInput.focus();
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showError("");
      const name = nameInput.value.trim();
      if (!name) return showError("Name is required.");
      const lat = parseFloat(latInput.value);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return showError("Latitude must be between -90 and 90.");
      }
      const lng = parseFloat(lngInput.value);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return showError("Longitude must be between -180 and 180.");
      }
      let eleM = null;
      const eleRaw = eleInput.value.trim();
      if (eleRaw !== "") {
        const v = parseFloat(eleRaw);
        if (Number.isFinite(v)) {
          eleM = state.unit === "ft" ? v / M_TO_FT : v;
        }
      }
      addCustomPeak({ name, eleM, lat, lng });
      nameInput.value = "";
      eleInput.value = "";
      nameInput.focus();
    });
  }

  function updateFooter() {
    const c = map.getCenter();
    const lat = Math.abs(c.lat).toFixed(2) + "°" + (c.lat >= 0 ? "N" : "S");
    const lng = Math.abs(c.lng).toFixed(2) + "°" + (c.lng >= 0 ? "E" : "W");
    $("foot-coord").textContent = lat + " " + lng;
    const z = map.getZoom();
    $("foot-scale").textContent = "z" + z.toFixed(1);
    $("chip-zoom").textContent = "z" + z.toFixed(1);
  }

  // ---------------------------------------------------------------
  // High-DPI print export
  // ---------------------------------------------------------------
  //
  // MapLibre's pixelRatio is fixed at construction time and the
  // displayed canvas is sized to devicePixelRatio. For a high-DPI print
  // we spin up a hidden Map at our chosen pixelRatio, wait for it to
  // settle, capture its canvas as a PNG dataURL, then overlay that image
  // on top of the live map for the duration of the print so the printer
  // receives the high-resolution version. Markers are CSS overlays, so
  // they print crisply at the system's print DPI without special handling.

  async function printPoster() {
    const dpi = state.style.printDpi || 1;
    const mapEl = $("map");
    if (!mapEl) return window.print();

    if (dpi <= 1) {
      // Fast path — no resampling needed.
      window.print();
      return;
    }

    setStatus("preparing print @ " + dpi + "×…", "loading");
    const width = mapEl.offsetWidth;
    const height = mapEl.offsetHeight;

    let img = null;
    let printMap = null;
    let container = null;
    try {
      container = document.createElement("div");
      container.style.cssText =
        "position:fixed;left:-99999px;top:-99999px;width:" +
        width + "px;height:" + height + "px;";
      document.body.appendChild(container);

      const style = JSON.parse(JSON.stringify(map.getStyle()));
      printMap = new maplibregl.Map({
        container: container,
        style: style,
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        interactive: false,
        attributionControl: false,
        pixelRatio: dpi,
        preserveDrawingBuffer: true,
        fadeDuration: 0,
      });

      await new Promise((resolve, reject) => {
        let done = false;
        const timeout = setTimeout(() => {
          if (!done) reject(new Error("print map load timed out"));
        }, 15000);
        printMap.once("idle", () => {
          done = true;
          clearTimeout(timeout);
          resolve();
        });
      });

      const dataUrl = printMap.getCanvas().toDataURL("image/png");

      img = document.createElement("img");
      img.src = dataUrl;
      img.className = "poster__map-print";
      img.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;" +
        "pointer-events:none;z-index:1;object-fit:cover;";
      mapEl.appendChild(img);
      // Hide the live canvas while the print snapshot is up so the
      // browser doesn't include both in the print buffer.
      mapEl.classList.add("printing");

      // Let the image paint before triggering print.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Cleanup runs on `afterprint` so the snapshot stays in place for
      // the full duration of the print dialog/preview — `window.print()`
      // returns immediately in Chrome/Firefox while the dialog is still
      // open, so a plain setTimeout would yank the snapshot too early.
      // setTimeout is the safety net in case afterprint never fires
      // (e.g. user navigates away mid-print).
      const cleanup = () => {
        if (cleanup._ran) return;
        cleanup._ran = true;
        if (img && img.parentNode) img.parentNode.removeChild(img);
        if (mapEl) mapEl.classList.remove("printing");
        if (printMap) printMap.remove();
        if (container && container.parentNode) container.parentNode.removeChild(container);
        setStatus("ready", "ready");
      };
      window.addEventListener("afterprint", cleanup, { once: true });
      setTimeout(cleanup, 60000);

      setStatus("printing…", "ready");
      window.print();
    } catch (err) {
      console.error("High-DPI print failed:", err);
      setStatus("print fallback (screen DPI)", "error");
      // Clean up partial state, then fall back to a plain print.
      if (img && img.parentNode) img.parentNode.removeChild(img);
      if (mapEl) mapEl.classList.remove("printing");
      if (printMap) printMap.remove();
      if (container && container.parentNode) container.parentNode.removeChild(container);
      window.print();
    }
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  loadUserData();

  // Build the DEM source once, before the map's first style.load fires,
  // so the contour protocol handler is registered and ready.
  demSource = makeDemSource();

  applyPaperColor();
  buildIconPicker();

  wirePanel();
  wireUnits();
  wireFilters();
  wireStyle();
  wirePoster();
  wireSearch();
  wirePresets();
  wirePeakList();
  wireCustomPeaks();

  applyBlendMap();

  map.on("load", () => {
    // The initial style is already loaded by now; ensure custom layers
    // (overlay hillshade + contours) are in place if the initial basemap
    // wants them. style.load handles subsequent style swaps.
    applyContourEnabled();
    fetchPeaks();
  });

  map.on("moveend", () => {
    updateFooter();
    fetchPeaksDebounced();
  });
  map.on("zoomend", () => {
    updateFooter();
    render();
  });
  window.addEventListener("resize", () => map.resize());

  // Initial UI hydration
  updateFooter();
  updateElevReadout();

  // ADK High Peaks default view — matches the original Leaflet boot.
  map.fitBounds(
    [
      [-74.30, 43.95],
      [-73.65, 44.45],
    ],
    { padding: 20, duration: 0 }
  );
})();
