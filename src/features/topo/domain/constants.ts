export const TERRAIN_RGB_SOURCE_ID = "pbpg-terrain-rgb";
export const HILLSHADE_LAYER_ID = "pbpg-hillshade";
export const CONTOUR_SOURCE_ID = "pbpg-contours";
export const CONTOUR_LINES_LAYER_ID = "pbpg-contour-lines";
export const CONTOUR_LABELS_LAYER_ID = "pbpg-contour-labels";

/**
 * AWS Open Data terrarium-encoded DEM tiles. Free, no auth, world coverage.
 *
 * https://registry.opendata.aws/terrain-tiles/
 */
export const TERRARIUM_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const TERRAIN_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain Tiles</a>';
