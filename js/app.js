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

  const state = {
    unit: "ft", // "ft" | "m"
    peaks: [], // current rendered set
    cache: new Map(), // bboxKey -> peak[]
    fetchSeq: 0, // race-condition guard
    inflight: null, // AbortController
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
  };

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

  // Contour overlay. The previous Stamen Terrain Lines source (Stadia Maps)
  // gave clean label-free contours, but Stadia returns 401 for anonymous
  // requests from any non-localhost origin, so the deployed GitHub Pages
  // site rendered every tile as a "401 Invalid Authentication" placeholder.
  // OpenTopoMap allows unauthenticated requests; its tiles include faint OSM
  // place names alongside the contours, which the density slider (opacity)
  // is used to dial back.
  const contourLayer = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 17,
      subdomains: "abc",
      opacity: 0.3,
      zIndex: 2,
      attribution:
        'Contours © <a href="https://opentopomap.org/">OpenTopoMap</a> ' +
        '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>), ' +
        'data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }
  );
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

  let currentBaseKey = "hillshade";
  function applyMapStyle(key) {
    const prev = baseLayers[currentBaseKey];
    if (prev) map.removeLayer(prev);
    currentBaseKey = key;
    const next = baseLayers[key];
    if (next) next.addTo(map);
  }
  baseLayers[currentBaseKey].addTo(map);
  contourLayer.addTo(map);

  const peaksGroup = L.layerGroup().addTo(map);

  // Default to ADK High Peaks region — it's where the user is hiking — but
  // nothing else assumes that. The Region presets jump elsewhere instantly.
  map.fitBounds([
    [43.95, -74.30],
    [44.45, -73.65],
  ]);

  // ---------------------------------------------------------------
  // Overpass: fetch peaks for current map view
  // ---------------------------------------------------------------

  function bboxKey(bounds, zoom) {
    return [
      bounds.getSouth().toFixed(3),
      bounds.getWest().toFixed(3),
      bounds.getNorth().toFixed(3),
      bounds.getEast().toFixed(3),
      zoom,
    ].join("/");
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

    const key = bboxKey(bounds, zoom);
    if (state.cache.has(key)) {
      state.peaks = state.cache.get(key);
      render();
      return;
    }

    // Cancel any in-flight request.
    if (state.inflight) state.inflight.abort();
    const ctrl = new AbortController();
    state.inflight = ctrl;
    const mySeq = ++state.fetchSeq;

    setStatus("loading peaks…", "loading");

    const s = bounds.getSouth();
    const w = bounds.getWest();
    const n = bounds.getNorth();
    const e = bounds.getEast();
    const query =
      "[out:json][timeout:25];" +
      '(node["natural"="peak"](' + s + "," + w + "," + n + "," + e + ");" +
      'node["natural"="volcano"](' + s + "," + w + "," + n + "," + e + "););" +
      "out body;";

    try {
      const data = await overpassFetch(query, ctrl.signal);
      if (mySeq !== state.fetchSeq) return; // a newer fetch superseded us
      const peaks = (data.elements || [])
        .map(parseOSMElement)
        .filter(Boolean);
      state.cache.set(key, peaks);
      state.peaks = peaks;
      setStatus(peaks.length + " peaks loaded", "ready");
      render();
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Overpass fetch failed:", err);
      setStatus("fetch failed — try again", "error");
    } finally {
      if (state.inflight === ctrl) state.inflight = null;
    }
  }

  const fetchPeaksDebounced = debounce(fetchPeaks, 600);

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  function visiblePeaks() {
    const lo = state.filters.eleMin;
    const hi = state.filters.eleMax;
    const requireName = state.filters.requireName;
    const requireEle = state.filters.requireEle;

    let arr = state.peaks.filter((p) => {
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

    const html =
      '<div class="pin ' + (dimmed ? "pin--dim" : "") + '">' +
      '<span class="pin__tri" aria-hidden="true"></span>' +
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
    state.peaks.forEach((peak) => {
      if (shownIds.has(peak.id)) return;
      // Render unfiltered peaks faintly only if elevation data exists or names
      // are present so we don't pollute the map with hundreds of unnamed nodes.
      if (peak.ele == null && !peak.name) return;
      buildMarker(peak, true).addTo(peaksGroup);
    });

    updateBadges(shown);
    updatePeakList(shown);
    updateAutoElevationRange();
  }

  function updateBadges(shown) {
    $("chip-peaks").textContent =
      shown.length + " peak" + (shown.length === 1 ? "" : "s");
    $("badge-peaks").textContent = String(shown.length);
  }

  function updatePeakList(shown) {
    const list = $("peaklist");
    if (!shown.length) {
      list.innerHTML =
        '<li class="peaklist__empty">No peaks match the current filters.</li>';
      return;
    }
    list.innerHTML = shown
      .map((p) => {
        const name = p.name
          ? escapeHtml(p.name)
          : '<em class="peaklist__unnamed">unnamed</em>';
        const ele =
          p.ele != null
            ? '<span class="peaklist__ele">' + formatElev(p.ele) + "</span>"
            : '<span class="peaklist__ele peaklist__ele--missing">—</span>';
        return (
          '<li class="peaklist__item" ' +
          'data-lat="' + p.lat + '" data-lng="' + p.lng + '">' +
          '<span class="peaklist__name">' + name + "</span>" +
          ele +
          "</li>"
        );
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

  function wireStyle() {
    $("opt-map-style").addEventListener("change", (e) => {
      applyMapStyle(e.target.value);
    });
    $("opt-contours").addEventListener("change", (e) => {
      if (e.target.checked) contourLayer.addTo(map);
      else map.removeLayer(contourLayer);
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
      contourLayer.setOpacity(v / 100);
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
    list.addEventListener("mouseover", (e) => {
      const li = e.target.closest(".peaklist__item");
      if (!li) return;
      const lat = +li.dataset.lat;
      const lng = +li.dataset.lng;
      if (highlight) map.removeLayer(highlight);
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
        if (highlight) {
          map.removeLayer(highlight);
          highlight = null;
        }
      }
    });
    list.addEventListener("click", (e) => {
      const li = e.target.closest(".peaklist__item");
      if (!li) return;
      const lat = +li.dataset.lat;
      const lng = +li.dataset.lng;
      map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: 0.5 });
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

  wirePanel();
  wireUnits();
  wireFilters();
  wireStyle();
  wirePoster();
  wireSearch();
  wirePresets();
  wirePeakList();

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
