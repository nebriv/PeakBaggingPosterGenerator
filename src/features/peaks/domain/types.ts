/* ────── Peak feature domain types ────── */

export interface PeakItem {
  /** Stable identifier — `osm:<id>` for OSM peaks, `custom:<uuid>` for user-added. */
  id: string;
  /** Display name, may be empty for an unnamed peak. */
  name: string;
  lat: number;
  lon: number;
  /** Elevation in meters when available; null when OSM has no `ele` tag. */
  eleMeters: number | null;
  /** Source of the record. */
  source: "osm" | "custom";
}

/* ────── Custom user-supplied layer types ────── */

export type CustomLayerKind = "geojson" | "raster";

export interface CustomLayerBase {
  id: string;
  name: string;
  visible: boolean;
  kind: CustomLayerKind;
}

export interface CustomGeoJsonLayer extends CustomLayerBase {
  kind: "geojson";
  /** Direct URL to a GeoJSON document, or an inline `data:` URL. */
  url: string;
  /** Line/stroke color (also outline for polygons / points). */
  color: string;
  /** Polygon fill color (used when the geojson has polygons). */
  fillColor: string;
  /** Stroke width in CSS pixels. */
  strokeWidth: number;
  /** Fill opacity (0-1). */
  fillOpacity: number;
}

export interface CustomRasterLayer extends CustomLayerBase {
  kind: "raster";
  /**
   * XYZ tile template, e.g.
   * `https://example.com/tiles/{z}/{x}/{y}.png`
   */
  tileUrl: string;
  /** Layer opacity (0-1). */
  opacity: number;
  /** Tile attribution to surface in the poster credits. */
  attribution?: string;
}

export type CustomLayer = CustomGeoJsonLayer | CustomRasterLayer;

/* ────── Region presets ────── */

export interface RegionPreset {
  id: string;
  label: string;
  /** [west, south, east, north] in degrees. */
  bbox: [number, number, number, number];
  defaultZoom: number;
}
