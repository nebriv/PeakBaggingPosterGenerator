import type { RegionPreset } from "./types";

export const M_TO_FT = 3.28084;
export const FT_TO_M = 1 / M_TO_FT;

export const REGION_PRESETS: RegionPreset[] = [
  {
    id: "adirondacks",
    label: "Adirondack High Peaks",
    bbox: [-74.5, 43.85, -73.55, 44.55],
    defaultZoom: 10,
  },
  {
    id: "catskills",
    label: "Catskill 3500",
    bbox: [-74.65, 41.85, -74.1, 42.3],
    defaultZoom: 11,
  },
  {
    id: "whites",
    label: "NH White Mountains",
    bbox: [-71.85, 43.95, -71.1, 44.5],
    defaultZoom: 10,
  },
  {
    id: "greens",
    label: "VT Green Mountains",
    bbox: [-72.95, 44.0, -72.55, 44.6],
    defaultZoom: 11,
  },
  {
    id: "smokies",
    label: "Great Smoky Mountains",
    bbox: [-83.95, 35.4, -83.2, 35.8],
    defaultZoom: 10,
  },
  {
    id: "front-range",
    label: "Front Range 14ers",
    bbox: [-106.6, 39.5, -105.5, 40.3],
    defaultZoom: 9,
  },
  {
    id: "sawatch",
    label: "Sawatch Range",
    bbox: [-106.85, 38.7, -106.0, 39.6],
    defaultZoom: 9,
  },
  {
    id: "sangres",
    label: "Sangre de Cristo",
    bbox: [-105.95, 37.45, -105.3, 38.2],
    defaultZoom: 10,
  },
  {
    id: "alps",
    label: "Swiss Alps (Bernese)",
    bbox: [7.4, 46.3, 8.4, 46.8],
    defaultZoom: 10,
  },
];

export const PEAK_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
