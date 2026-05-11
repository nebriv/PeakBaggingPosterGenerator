/* Peak Bagging Poster Generator
 *
 * Dynamic, region-agnostic topographic poster designer. Peaks are fetched
 * live from OpenStreetMap via the Overpass API; the user pans/zooms the map
 * to any region (ADK 46, Catskill 3500, Whites, 14ers, Alps, etc.) and the
 * peaks update. Nothing is hardcoded.
 *
 * Output style is intentionally clean and high-contrast so the poster can
 * be framed and (e.g.) trails highlighted on the glass.
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

  // Peaks are cached by grid cell so panning across the same region is
  // instant and we don't make the same Overpass request twice. Cell size
  // varies by zoom to keep the per-fetch payload reasonable.
  const PEAK_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h — keeps long sessions snappy

  function gridStep(zoom) {
    if (zoom <= 8) return 1.0;
    if (zoom <= 10) return 0.5;
    if (zoom <= 12) return 0.25;
    return 0.1;
  }

  // Pick the coarsest grid step that keeps the per-fetch cell count below
  // a safe ceiling so a wide low-zoom viewport doesn't kick off a 100-cell
  // Overpass query.
  function chooseCellsForBounds(bounds, zoom) {
    let step = gridStep(zoom);
    let cells = cellsForBounds(bounds, step);
    while (cells.length > 30) {
      step *= 2;
      cells = cellsForBounds(bounds, step);
    }
    return { cells, step };
  }

  const state = {
    unit: "ft", // "ft" | "m"
    peaks: [], // current rendered set from Overpass
    cache: new Map(), // cellKey -> { peaks, t }
    fetchSeq: 0, // race-condition guard
    inflight: null, // AbortController
    prefetchTimer: null, // debounced neighbor prefetch
    custom: [], // user-added peaks, persisted to localStorage
    excluded: new Set(), // peak IDs (OSM or custom) the user has hidden
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
      icon: "triangle", // peakIcons key
      paperColor: "#f6f1e6", // poster + map background
      blendMap: false, // mix-blend-mode: multiply on base tile pane
      contourSource: "opentopo", // contourSources key
      stadiaKey: "", // optional Stadia Maps API key
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
      // Corrupt storage shouldn't break the app — just log and move on.
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

  // ---------------------------------------------------------------
  // Unit conversion
  // ---------------------------------------------------------------

  function metersToUnit(m) {
    if (m == null) return null;
    return state.unit === "ft" ? m * M_TO_FT : m;
  }
  function unitToMeters(v) {
    return state.unit === "ft" ? v / M_TO_FT : v;
  }
  function formatElev(m) {
    if (m == null) return "—";
    const v = metersToUnit(m);
    return Math.round(v).toLocaleString() + " " + state.unit;
  }

  // ---------------------------------------------------------------
  // Peak icon library — SVG markup keyed for the picker
  // ---------------------------------------------------------------
  //
  // Each icon is a small viewBox-12 SVG that the CSS variables for fill
  // and stroke colour. The wrapper class (.pin--<key>) lets each style
  // tune fill/stroke rules (outline vs solid, lines vs polygons).
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
  // Map setup
  // ---------------------------------------------------------------

  const map = L.map("map", {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
  });
  L.control.zoom({ position: "topleft" }).addTo(map);
  map.attributionControl = L.control
    .attribution({ position: "bottomleft", prefix: false })
    .addTo(map);

  // Custom pane for the contour overlay so we can blend the contour tiles
  // with the underlying basemap independently of the user's CSS-filter
  // tweaks on the base tiles.
  map.createPane("contour");
  map.getPane("contour").style.zIndex = 350;
  map.getPane("contour").classList.add("contour-pane");

  // Base map styles. The user picks one from the "Map style" dropdown.
  // Each option is a meaningfully different look — clean hillshade, classic
  // topo (with labels, for users who want them back), satellite, etc. All
  // bases share zIndex:1 so the contour and road overlays sit above them.
  const baseLayers = {
    hillshade: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 18,
        zIndex: 1,
        attribution:
          'Hillshade © <a href="https://www.esri.com/">Esri</a>, USGS, NOAA',
      }
    ),
    toner: L.tileLayer(
      "https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}.png" +
        stadiaKeySuffix(),
      {
        maxZoom: 18,
        zIndex: 1,
        attribution:
          'Tiles © <a href="https://stadiamaps.com/">Stadia Maps</a>, ' +
          '<a href="https://stamen.com/">Stamen Design</a>; ' +
          'data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }
    ),
    opentopomap: L.tileLayer(
      "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 17,
        subdomains: "abc",
        zIndex: 1,
        attribution:
          '© <a href="https://opentopomap.org/">OpenTopoMap</a> ' +
          '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>), ' +
          'data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }
    ),
    light: L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        subdomains: "abcd",
        zIndex: 1,
        attribution:
          'Tiles © <a href="https://carto.com/">CARTO</a>, ' +
          'data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }
    ),
    dark: L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        subdomains: "abcd",
        zIndex: 1,
        attribution:
          'Tiles © <a href="https://carto.com/">CARTO</a>, ' +
          'data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }
    ),
    satellite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        zIndex: 1,
        attribution:
          'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
      }
    ),
  };

  // Contour overlay configurations. Stadia is the "purest" (lines-only),
  // but its tiles require a registered domain or API key for production
  // sites, so it's no longer the default — OpenTopoMap, blended with
  // mix-blend-mode multiply, gives a usable contour effect on any host.
  function stadiaKeySuffix() {
    const k = state.style.stadiaKey && state.style.stadiaKey.trim();
    return k ? "?api_key=" + encodeURIComponent(k) : "";
  }

  // NOTE on Stamen terrain layers: `stamen_terrain_lines` is misleadingly
  // named — it's the OSM line work (roads, state borders, water edges),
  // NOT contour lines. The actual contour lines live inside the
  // `stamen_terrain_background` hillshade tile and `stamen_terrain` (full).
  // We use `stamen_terrain_background` here so the overlay contributes
  // hillshade + contours together, then mix-blend-mode multiply on the
  // pane drops the white tile background so it composites cleanly over
  // whatever basemap the user picked.
  const contourSources = {
    opentopo: {
      label: "OpenTopoMap (no key)",
      build: () =>
        L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
          pane: "contour",
          maxZoom: 17,
          subdomains: "abc",
          className: "contour-tile contour-tile--blend",
          attribution:
            'Contours © <a href="https://opentopomap.org/">OpenTopoMap</a>',
        }),
    },
    stadia_terrain_bg: {
      label: "Stamen Terrain — hillshade + contours (Stadia)",
      build: () =>
        L.tileLayer(
          "https://tiles.stadiamaps.com/tiles/stamen_terrain_background/{z}/{x}/{y}.png" +
            stadiaKeySuffix(),
          {
            pane: "contour",
            maxZoom: 18,
            className: "contour-tile contour-tile--blend",
            attribution:
              'Terrain © <a href="https://stadiamaps.com/">Stadia Maps</a>, ' +
              '<a href="https://stamen.com/">Stamen Design</a>',
          }
        ),
    },
    stadia_terrain: {
      label: "Stamen Terrain — full (Stadia, with labels)",
      build: () =>
        L.tileLayer(
          "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png" +
            stadiaKeySuffix(),
          {
            pane: "contour",
            maxZoom: 18,
            className: "contour-tile contour-tile--blend",
            attribution:
              'Terrain © <a href="https://stadiamaps.com/">Stadia Maps</a>, ' +
              '<a href="https://stamen.com/">Stamen Design</a>',
          }
        ),
    },
    usgs: {
      label: "USGS Topo (US only)",
      build: () =>
        L.tileLayer(
          "https://server.arcgisonline.com/arcgis/rest/services/USA_Topo_Maps/MapServer/tile/{z}/{y}/{x}",
          {
            pane: "contour",
            maxZoom: 16,
            className: "contour-tile contour-tile--blend",
            attribution:
              'USGS Topo © <a href="https://www.esri.com/">Esri</a>',
          }
        ),
    },
    none: { label: "None", build: () => null },
  };

  let contourLayer = null;
  function applyContour() {
    if (contourLayer) {
      map.removeLayer(contourLayer);
      contourLayer = null;
    }
    if (!$("opt-contours").checked) return;
    const cfg = contourSources[state.style.contourSource] || contourSources.opentopo;
    const layer = cfg.build();
    if (!layer) return;
    // Warn the user if Stadia 401s instead of letting the failure be silent.
    const isStadia = state.style.contourSource.startsWith("stadia");
    let warned = false;
    layer.on("tileerror", () => {
      if (warned) return;
      warned = true;
      if (isStadia && !stadiaKeySuffix()) {
        setStatus("contour: register domain or add Stadia key", "error");
      } else {
        setStatus("contour tiles failed", "error");
      }
    });
    layer.setOpacity((+$("opt-contour-density").value || 60) / 100);
    layer.addTo(map);
    contourLayer = layer;
  }

  const osmLayer = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      opacity: 0.35,
      zIndex: 3,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
  );

  // Each base layer has a perceived tone so pin colors can flip to stay
  // legible — paper-ink on light bases, ink-paper on dark ones.
  const baseLayerTones = {
    hillshade: "light",
    toner: "light",
    opentopomap: "light",
    light: "light",
    dark: "dark",
    satellite: "dark",
    paper: "light",
  };

  let currentBaseKey = "hillshade";
  function setMapTone(key) {
    const dark = (baseLayerTones[key] || "light") === "dark";
    map.getContainer().classList.toggle("map--dark-base", dark);
  }
  function applyMapStyle(key) {
    const prev = baseLayers[currentBaseKey];
    if (prev) map.removeLayer(prev);
    currentBaseKey = key;
    const next = baseLayers[key];
    if (next) next.addTo(map);
    setMapTone(key);
  }
  baseLayers[currentBaseKey].addTo(map);
  setMapTone(currentBaseKey);

  const peaksGroup = L.layerGroup().addTo(map);

  // Default to ADK High Peaks region — it's where the user is hiking — but
  // nothing else assumes that. The Region presets jump elsewhere instantly.
  map.fitBounds([
    [43.95, -74.30],
    [44.45, -73.65],
  ]);

  // ---------------------------------------------------------------
  // Overpass: fetch peaks for current map view, cell-cached
  // ---------------------------------------------------------------
  //
  // Peak data doesn't change with zoom level, so caching by exact bbox+zoom
  // (the old behaviour) re-fetched the same peaks every time the user
  // panned or zoomed. Now we snap each request to a coarse grid, cache by
  // cell, and combine missing cells into a single Overpass query.

  function cellKey(s, w, step) {
    return s.toFixed(3) + "/" + w.toFixed(3) + "/" + step;
  }

  function cellsForBounds(bounds, step) {
    const s0 = Math.floor(bounds.getSouth() / step) * step;
    const w0 = Math.floor(bounds.getWest() / step) * step;
    const n0 = Math.ceil(bounds.getNorth() / step) * step;
    const e0 = Math.ceil(bounds.getEast() / step) * step;
    const out = [];
    // Floating-point drift can leave the loop one cell short if we use
    // strict `<`, so subtract a small epsilon when comparing.
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

  function parseElev(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    const m = s.match(/^(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (Number.isNaN(v)) return null;
    // OSM standard is meters as a plain number. Some entries include units —
    // be defensive about feet so we don't end up showing 16,000 ft summits
    // for a peak that's really 1600 m.
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
      // A peak technically only belongs to one cell, but the parsed cell
      // bounds are inclusive so duplicates between adjacent cells are
      // possible — dedupe by ID at the caller.
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
    // Mark even empty cells as cached so we don't re-query.
    cells.forEach((c) => {
      if (!state.cache.has(c.key)) state.cache.set(c.key, { peaks: [], t: now });
    });
    return peaks;
  }

  async function fetchPeaks() {
    const zoom = map.getZoom();
    const bounds = map.getBounds();

    // At very low zoom the world has too many peaks to return usefully.
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

  // Background pre-fetch: after the visible area loads, quietly pull the
  // ring of cells around it so the next pan in any direction is instant.
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
      // Cap each prefetch batch so we never blow past Overpass's limits.
      const batch = neighbors.slice(0, 12);
      fetchCells(batch).catch(() => {});
    }, 1800);
  }

  const fetchPeaksDebounced = debounce(fetchPeaks, 400);

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  // All peaks under consideration: live OSM results plus the user's
  // persisted custom peaks. Custom peaks always travel with the user, no
  // matter which region of the map is loaded.
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
      if (p.ele == null) return true; // no-ele peaks pass the range filter
      const v = metersToUnit(p.ele);
      return v >= lo && v <= hi;
    });

    // Sort highest first so top-N keeps the most prominent peaks.
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

  function buildMarker(peak, dimmed) {
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

    const html =
      '<div class="pin pin--' + iconKey + " " +
      (dimmed ? "pin--dim" : "") +
      '">' +
      glyph +
      label +
      "</div>";

    const icon = L.divIcon({
      className: "pin-wrap",
      html: html,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    return L.marker([peak.lat, peak.lng], {
      icon: icon,
      keyboard: false,
      interactive: false,
      zIndexOffset: peak.ele != null ? Math.round(peak.ele) : 0,
    });
  }

  // Greedy label de-cluttering: walk the prominence-sorted list and hide the
  // label of any pin whose projected pixel position is too close to an already-
  // shown one. The triangle marker stays so the user still sees every peak.
  function suppressOverlappingLabels(peaks) {
    const zoom = map.getZoom();
    // Rough label footprint; tuned for the current pin style (.pin__label is
    // ~75–90px wide depending on the name, ~28px tall with name + elevation).
    const minSepX = 78;
    const minSepY = 26;
    const placed = [];
    peaks.forEach((p) => {
      const pt = map.project([p.lat, p.lng], zoom);
      const collides = placed.some((sp) => {
        const spt = map.project([sp.lat, sp.lng], zoom);
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
    peaksGroup.clearLayers();

    const shown = visiblePeaks();
    suppressOverlappingLabels(shown);
    const shownIds = new Set(shown.map((p) => p.id));

    // Always render shown peaks fully, render others dimmed so the map keeps
    // its overall composition.
    shown.forEach((peak) => {
      buildMarker(peak, false).addTo(peaksGroup);
    });
    allPeaks().forEach((peak) => {
      if (shownIds.has(peak.id)) return;
      if (state.excluded.has(peak.id)) return;
      // Render unfiltered peaks faintly only if elevation data exists or names
      // are present so we don't pollute the map with hundreds of unnamed nodes.
      if (peak.ele == null && !peak.name) return;
      buildMarker(peak, true).addTo(peaksGroup);
    });

    updateBadges(shown);
    updatePeakList(shown);
    updateExcludedList();
    updateAutoElevationRange();
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
    const action = opts.action; // { cls, label, title }
    const cls =
      "peaklist__item" + (p.custom ? " peaklist__item--custom" : "");
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
          byId.get(id) ||
          // Excluded peak isn't loaded right now (panned away from its
          // region); show a stub so the user can still restore it.
          { id: id, name: null, ele: null, lat: 0, lng: 0 };
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

  // ---------------------------------------------------------------
  // Auto-range the elevation slider to currently loaded peaks so the
  // handles aren't sitting at extremes the user can't reach.
  // ---------------------------------------------------------------

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
  // Geocoding via Nominatim for the search box
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
        // Jumping somewhere new should let the filter auto-range to the new
        // region's peaks rather than carry over the previous values.
        state.filters.eleMinManual = false;
        state.filters.eleMaxManual = false;
        if (it.boundingbox) {
          const [s, n, w, e] = it.boundingbox.map(parseFloat);
          map.fitBounds([
            [s, w],
            [n, e],
          ]);
        } else {
          map.setView([+it.lat, +it.lon], 11);
        }
        ul.style.display = "none";
        $("search-input").value = it.display_name;
      })
    );
  }

  // ---------------------------------------------------------------
  // Wire up controls
  // ---------------------------------------------------------------

  function wirePanel() {
    $("toggle-panel").addEventListener("click", (e) => {
      const panel = $("panel");
      const open = panel.classList.toggle("panel--closed") ? false : true;
      e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
      setTimeout(() => map.invalidateSize(), 220);
    });
  }

  function wireUnits() {
    function setUnit(unit) {
      if (unit === state.unit) return;
      // Convert current slider values to the new unit so we don't lose the
      // user's intent.
      const oldMin = state.filters.eleMin;
      const oldMax = state.filters.eleMax;
      const oldUnit = state.unit;
      state.unit = unit;
      const conv = (v) =>
        oldUnit === unit
          ? v
          : oldUnit === "ft"
          ? v / M_TO_FT // ft -> m
          : v * M_TO_FT; // m -> ft
      state.filters.eleMin = conv(oldMin);
      state.filters.eleMax = conv(oldMax);

      $("unit-ft").classList.toggle("seg__btn--on", unit === "ft");
      $("unit-m").classList.toggle("seg__btn--on", unit === "m");
      $("foot-unit").textContent = "elevations in " + (unit === "ft" ? "feet" : "meters");
      refreshAddPeakUnit();
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

  // Apply mix-blend-mode multiply to base tiles so the white parts of
  // hillshade/topo tiles take on the paper colour underneath. This is
  // what lets the user "make the map match the poster".
  function applyBlendMap() {
    const tilePane = map.getPanes().tilePane;
    tilePane.style.mixBlendMode = state.style.blendMap ? "multiply" : "";
  }

  function applyPaperColor() {
    document.documentElement.style.setProperty("--paper", state.style.paperColor);
  }

  function setIconPickerSelection(key) {
    document.querySelectorAll(".icon-picker__opt").forEach((btn) => {
      btn.classList.toggle(
        "icon-picker__opt--on",
        btn.dataset.icon === key
      );
    });
  }

  function buildIconPicker() {
    const root = $("icon-picker");
    if (!root) return;
    root.innerHTML = Object.entries(peakIcons)
      .map(
        ([key, ic]) =>
          '<button type="button" class="icon-picker__opt pin pin--' +
          key +
          '" ' +
          'data-icon="' + key + '" title="' + escapeHtml(ic.label) + '" ' +
          'aria-label="' + escapeHtml(ic.label) + '">' +
          '<span class="pin__glyph pin__glyph--' + key + '">' +
          ic.svg +
          "</span></button>"
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
      applyMapStyle(e.target.value);
    });
    $("opt-contours").addEventListener("change", applyContour);
    $("opt-contour-source").addEventListener("change", (e) => {
      state.style.contourSource = e.target.value;
      // Stadia key field is only useful for the Stadia-hosted sources.
      $("opt-stadia-key-wrap").style.display =
        state.style.contourSource.startsWith("stadia") ? "" : "none";
      saveUserData();
      applyContour();
    });
    $("opt-stadia-key").addEventListener("change", (e) => {
      state.style.stadiaKey = e.target.value.trim();
      saveUserData();
      applyContour();
    });

    $("opt-osm").addEventListener("change", (e) => {
      if (e.target.checked) osmLayer.addTo(map);
      else map.removeLayer(osmLayer);
    });
    $("opt-attribution").addEventListener("change", (e) => {
      if (e.target.checked) map.attributionControl.addTo(map);
      else map.attributionControl.remove();
    });
    $("opt-border").addEventListener("change", (e) => {
      $("poster").classList.toggle("poster--noborder", !e.target.checked);
    });

    const contourSlider = $("opt-contour-density");
    contourSlider.addEventListener("input", () => {
      const v = +contourSlider.value;
      if (contourLayer) contourLayer.setOpacity(v / 100);
      $("contour-readout").textContent = v + "%";
    });

    const tilePane = map.getPanes().tilePane;
    function applyFilters() {
      const s = $("opt-sat").value;
      const c = $("opt-con").value;
      const b = $("opt-bri").value;
      $("sat-readout").textContent = s + "%";
      $("con-readout").textContent = c + "%";
      $("bri-readout").textContent = b + "%";
      tilePane.style.filter =
        "grayscale(" + (100 - s) + "%) contrast(" + c + "%) brightness(" + b + "%)";
    }
    ["opt-sat", "opt-con", "opt-bri"].forEach((id) =>
      $(id).addEventListener("input", applyFilters)
    );
    applyFilters();

    // Paper color + blend
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
      setTimeout(() => map.invalidateSize(), 80);
    });
    $("print").addEventListener("click", () => window.print());
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
        // Reset the filter so the new region's peaks aren't dimmed by
        // values that made sense for a different range.
        resetElevationFilter();
        map.fitBounds([
          [s, w],
          [n, e],
        ]);
        // Suggest a sensible title without forcing it on the user.
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
        map.removeLayer(highlight);
        highlight = null;
      }
    }
    list.addEventListener("mouseover", (e) => {
      const li = e.target.closest(".peaklist__item");
      if (!li) return;
      const lat = +li.dataset.lat;
      const lng = +li.dataset.lng;
      clearHighlight();
      highlight = L.circleMarker([lat, lng], {
        radius: 14,
        color: "#000",
        weight: 2,
        fillColor: "#ffd400",
        fillOpacity: 0.6,
      }).addTo(map);
    });
    list.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget || !e.relatedTarget.closest(".peaklist")) {
        clearHighlight();
      }
    });
    list.addEventListener("click", (e) => {
      // Hide button — intercept before the row's fly-to handler runs.
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
      map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: 0.5 });
    });

    // Restore button in the Excluded list.
    $("excluded-peaklist").addEventListener("click", (e) => {
      if (!e.target.classList.contains("peaklist__restore")) return;
      const li = e.target.closest(".peaklist__item");
      if (!li) return;
      state.excluded.delete(li.dataset.id);
      saveUserData();
      render();
    });
  }

  // -----------------------------------------------------------------
  // Custom peaks — entered by coordinates in the side panel.
  // -----------------------------------------------------------------

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
      // Clear name + elevation, but keep the lat/lng since the user is
      // probably entering several nearby peaks.
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
    $("foot-scale").textContent = "z" + map.getZoom();
    $("chip-zoom").textContent = "z" + map.getZoom();
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  loadUserData();

  // Hydrate persisted style choices into the DOM before any wiring runs.
  applyPaperColor();
  if ($("opt-contour-source")) $("opt-contour-source").value = state.style.contourSource;
  if ($("opt-stadia-key")) $("opt-stadia-key").value = state.style.stadiaKey;
  if ($("opt-stadia-key-wrap")) {
    $("opt-stadia-key-wrap").style.display =
      state.style.contourSource.startsWith("stadia") ? "" : "none";
  }

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

  // Contours/blend depend on persisted style state — apply after wiring so
  // the layer matches the dropdown the user actually sees.
  applyContour();
  applyBlendMap();

  map.on("moveend", () => {
    updateFooter();
    fetchPeaksDebounced();
  });
  map.on("zoomend", () => {
    updateFooter();
    // Pixel separation between peaks changes with zoom, so the collision
    // map has to be rebuilt to keep labels readable.
    render();
  });
  window.addEventListener("resize", () => map.invalidateSize());

  // Initial run.
  updateFooter();
  updateElevReadout();
  fetchPeaks();
})();
