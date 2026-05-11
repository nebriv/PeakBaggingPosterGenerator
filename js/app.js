/* ADK 46 Poster Generator
 *
 * Renders an artistic, B&W-styled topo map of the Adirondack 46 High Peaks
 * using Leaflet with OpenTopoMap tiles. All filtering and styling happens
 * client-side so the site is a fully static GitHub Pages app.
 */
(function () {
  "use strict";

  const peaks = window.ADK_PEAKS;

  // --- Map setup ---------------------------------------------------------

  const map = L.map("map", {
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true,
    // Generous bounds so users can pan into adjacent terrain if they want.
    maxBounds: [
      [43.5, -75.5],
      [44.8, -73.0],
    ],
    maxBoundsViscosity: 0.8,
  });

  // OpenTopoMap has contours + hillshade baked in. CSS filters give us
  // the B&W cartocuts-style look without needing a vector tile server.
  const topoLayer = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 17,
      subdomains: "abc",
      attribution:
        'Map: &copy; <a href="https://opentopomap.org/">OpenTopoMap</a> ' +
        '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>), ' +
        'data &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>, ' +
        'SRTM | Style: &copy; <a href="https://opentopomap.org/">OpenTopoMap</a>',
    }
  );

  // Optional OSM overlay for roads/towns/water labels.
  const osmOverlay = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      opacity: 0.35,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }
  );

  topoLayer.addTo(map);

  const peakMarkers = new Map();
  const peaksLayer = L.layerGroup().addTo(map);

  // Fit to the peaks once on load so users see all 46 immediately.
  const allBounds = L.latLngBounds(peaks.map((p) => [p.lat, p.lng]));
  map.fitBounds(allBounds, { padding: [40, 40] });

  // --- Peak markers ------------------------------------------------------

  function buildMarker(peak) {
    const html =
      '<div class="peak-marker">' +
      '<span class="peak-marker__triangle" aria-hidden="true"></span>' +
      '<span class="peak-marker__label">' +
      '<span class="peak-marker__name">' + escapeHtml(peak.name) + "</span>" +
      '<span class="peak-marker__elev">' + peak.elevation + " ft</span>" +
      "</span>" +
      "</div>";
    const icon = L.divIcon({
      className: "peak-marker-wrap",
      html: html,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    return L.marker([peak.lat, peak.lng], {
      icon: icon,
      keyboard: false,
      interactive: false,
      // Higher peaks render above lower ones so the biggest names win in overlaps.
      zIndexOffset: peak.elevation,
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  peaks.forEach((peak) => {
    const marker = buildMarker(peak);
    marker.addTo(peaksLayer);
    peakMarkers.set(peak, marker);
  });

  // --- Controls ----------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const titleInput = $("poster-title");
  const subtitleInput = $("poster-subtitle");
  const titleDisplay = $("title-display");
  const subtitleDisplay = $("subtitle-display");

  titleInput.addEventListener("input", () => {
    titleDisplay.textContent = titleInput.value;
  });
  subtitleInput.addEventListener("input", () => {
    subtitleDisplay.textContent = subtitleInput.value;
    subtitleDisplay.style.display = subtitleInput.value ? "" : "none";
  });

  // Elevation range. Outside-range peaks are dimmed rather than hidden so the
  // map keeps its overall composition (this is what the user described —
  // highlight peaks they want, keep the others visible).
  const elevMin = $("elev-min");
  const elevMax = $("elev-max");
  const elevMinVal = $("elev-min-val");
  const elevMaxVal = $("elev-max-val");

  function applyElevationFilter() {
    let lo = +elevMin.value;
    let hi = +elevMax.value;
    if (lo > hi) {
      // Keep handles from crossing.
      if (this === elevMin) {
        elevMax.value = lo;
        hi = lo;
      } else {
        elevMin.value = hi;
        lo = hi;
      }
    }
    elevMinVal.textContent = lo;
    elevMaxVal.textContent = hi;
    peaks.forEach((peak) => {
      const marker = peakMarkers.get(peak);
      const el = marker.getElement();
      if (!el) return;
      const inRange = peak.elevation >= lo && peak.elevation <= hi;
      el.classList.toggle("peak-marker-wrap--dimmed", !inRange);
    });
  }
  elevMin.addEventListener("input", applyElevationFilter);
  elevMax.addEventListener("input", applyElevationFilter);
  map.on("layeradd", applyElevationFilter);

  // Layer toggles.
  $("toggle-contours").addEventListener("change", (e) => {
    if (e.target.checked) {
      topoLayer.addTo(map);
    } else {
      map.removeLayer(topoLayer);
    }
  });
  $("toggle-roads").addEventListener("change", (e) => {
    if (e.target.checked) {
      osmOverlay.addTo(map);
    } else {
      map.removeLayer(osmOverlay);
    }
  });
  $("toggle-peaks").addEventListener("change", (e) => {
    document.body.classList.toggle("hide-peaks", !e.target.checked);
  });
  $("toggle-peak-labels").addEventListener("change", (e) => {
    document.body.classList.toggle("hide-peak-names", !e.target.checked);
  });
  $("toggle-elevations").addEventListener("change", (e) => {
    document.body.classList.toggle("hide-elevations", !e.target.checked);
  });
  $("toggle-border").addEventListener("change", (e) => {
    document.getElementById("poster").classList.toggle(
      "poster--no-border",
      !e.target.checked
    );
  });
  $("toggle-attribution").addEventListener("change", (e) => {
    if (e.target.checked) {
      map.attributionControl.addTo(map);
    } else {
      map.attributionControl.remove();
    }
  });

  // Style sliders apply CSS filters to the map tile pane so they stack
  // cheaply on whatever raster source is active.
  const tilePane = map.getPanes().tilePane;
  function applyStyleFilters() {
    const sat = $("saturation").value;
    const con = $("contrast").value;
    const bri = $("brightness").value;
    tilePane.style.filter =
      "grayscale(" +
      (100 - sat) +
      "%) contrast(" +
      con +
      "%) brightness(" +
      bri +
      "%)";
  }
  ["saturation", "contrast", "brightness"].forEach((id) => {
    $(id).addEventListener("input", applyStyleFilters);
  });
  applyStyleFilters();

  // Aspect ratio. The poster element drives the CSS sizing; we just have
  // to invalidate the map so Leaflet re-measures.
  const poster = $("poster");
  $("aspect").addEventListener("change", (e) => {
    poster.dataset.aspect = e.target.value;
    setTimeout(() => map.invalidateSize(), 50);
  });

  $("fit-peaks").addEventListener("click", () => {
    const lo = +elevMin.value;
    const hi = +elevMax.value;
    const visible = peaks.filter(
      (p) => p.elevation >= lo && p.elevation <= hi
    );
    if (!visible.length) return;
    const bounds = L.latLngBounds(visible.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [50, 50] });
  });

  $("print").addEventListener("click", () => {
    window.print();
  });

  // Default attribution position.
  map.attributionControl.setPosition("bottomleft");
  map.attributionControl.addTo(map);

  // Show coordinates of the center in the footer (nice cartographic touch).
  function updateFooterCoords() {
    const c = map.getCenter();
    const lat = Math.abs(c.lat).toFixed(2);
    const lng = Math.abs(c.lng).toFixed(2);
    $("footer-left").textContent =
      lat + "°" + (c.lat >= 0 ? "N" : "S") +
      " · " +
      lng + "°" + (c.lng >= 0 ? "E" : "W");
  }
  map.on("moveend", updateFooterCoords);
  updateFooterCoords();

  // Recompute on window resize so the map stays sharp.
  window.addEventListener("resize", () => {
    map.invalidateSize();
  });
})();
