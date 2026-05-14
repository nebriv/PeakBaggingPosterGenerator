import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import {
  CONTOUR_LABELS_LAYER_ID,
  CONTOUR_LINES_LAYER_ID,
  CONTOUR_SOURCE_ID,
  HILLSHADE_LAYER_ID,
  TERRAIN_RGB_SOURCE_ID,
  TERRARIUM_TILE_URL,
} from "../domain/constants";
import { getCachedDemSource } from "./demSource";
import type { CustomLayer } from "@/features/peaks/domain/types";

export interface TopoOptions {
  hillshade: { enabled: boolean; strength: number };
  contours: { enabled: boolean; density: number; labels: boolean };
  textColor: string;
}

const CONTOUR_LAYER_NAME = "contours";
const ELEVATION_KEY = "ele";
const LEVEL_KEY = "level";

// `contourMultiplier` controls how dense the lines are. We pre-compute three
// preset interval ladders (low / mid / high density) so the slider stays
// intuitive but tile generation only happens for these three buckets.
function densityThresholds(densityPercent: number): Record<number, number[]> {
  const density = Math.max(0, Math.min(100, densityPercent));
  // Empirically chosen meter intervals at various zooms.
  if (density < 33) {
    return {
      10: [200, 1000],
      12: [100, 500],
      14: [50, 250],
    };
  }
  if (density < 66) {
    return {
      9: [200, 1000],
      11: [100, 500],
      13: [50, 250],
      15: [25, 125],
    };
  }
  return {
    8: [200, 1000],
    10: [100, 500],
    12: [50, 250],
    14: [20, 100],
    16: [10, 50],
  };
}

function makeHillshadeLayer(strength: number): LayerSpecification {
  const exaggeration = Math.max(0, strength) / 100;
  return {
    id: HILLSHADE_LAYER_ID,
    type: "hillshade",
    source: TERRAIN_RGB_SOURCE_ID,
    paint: {
      "hillshade-exaggeration": exaggeration,
      "hillshade-shadow-color": "#3a3325",
      "hillshade-highlight-color": "#fff8e8",
      "hillshade-accent-color": "#bba673",
    },
  };
}

function makeContourLines(textColor: string): LayerSpecification {
  return {
    id: CONTOUR_LINES_LAYER_ID,
    type: "line",
    source: CONTOUR_SOURCE_ID,
    "source-layer": CONTOUR_LAYER_NAME,
    paint: {
      "line-color": textColor,
      "line-opacity": [
        "match",
        ["get", LEVEL_KEY],
        1,
        0.55,
        0.3,
      ],
      "line-width": [
        "match",
        ["get", LEVEL_KEY],
        1,
        0.8,
        0.4,
      ],
    },
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
  };
}

function makeContourLabels(textColor: string): LayerSpecification {
  return {
    id: CONTOUR_LABELS_LAYER_ID,
    type: "symbol",
    source: CONTOUR_SOURCE_ID,
    "source-layer": CONTOUR_LAYER_NAME,
    filter: [">", ["get", LEVEL_KEY], 0],
    paint: {
      "text-color": textColor,
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
    },
    layout: {
      "symbol-placement": "line",
      "text-field": ["concat", ["to-string", ["get", ELEVATION_KEY]], " m"],
      "text-size": 10,
      "text-anchor": "center",
      "text-padding": 12,
      "symbol-spacing": 240,
    },
  };
}

function makeCustomLayerSourcesAndLayers(
  customLayers: CustomLayer[],
): { sources: Record<string, SourceSpecification>; layers: LayerSpecification[] } {
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  for (const layer of customLayers) {
    if (!layer.visible) continue;
    const sourceId = `pbpg-custom-${layer.id}`;
    if (layer.kind === "raster") {
      if (!layer.tileUrl?.trim()) continue;
      sources[sourceId] = {
        type: "raster",
        tiles: [layer.tileUrl.trim()],
        tileSize: 256,
        ...(layer.attribution
          ? { attribution: layer.attribution }
          : {}),
      } as SourceSpecification;
      layers.push({
        id: `${sourceId}-layer`,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": Math.max(0, Math.min(1, layer.opacity)),
        },
      });
    } else if (layer.kind === "geojson") {
      if (!layer.url?.trim()) continue;
      sources[sourceId] = {
        type: "geojson",
        data: layer.url.trim(),
      } as SourceSpecification;
      layers.push({
        id: `${sourceId}-fill`,
        type: "fill",
        source: sourceId,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": layer.fillColor,
          "fill-opacity": Math.max(0, Math.min(1, layer.fillOpacity)),
        },
      });
      layers.push({
        id: `${sourceId}-line`,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": layer.color,
          "line-width": Math.max(0.1, layer.strokeWidth),
        },
      });
      layers.push({
        id: `${sourceId}-point`,
        type: "circle",
        source: sourceId,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": layer.color,
          "circle-radius": Math.max(1, layer.strokeWidth * 1.5),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.5,
        },
      });
    }
  }
  return { sources, layers };
}

export function augmentMapStyle(
  baseStyle: StyleSpecification,
  topo: TopoOptions,
  customLayers: CustomLayer[],
  showCustomLayers: boolean,
): StyleSpecification {
  const sources: Record<string, SourceSpecification> = { ...baseStyle.sources };
  const layers: LayerSpecification[] = [...baseStyle.layers];

  if (topo.hillshade.enabled) {
    sources[TERRAIN_RGB_SOURCE_ID] = {
      type: "raster-dem",
      tiles: [TERRARIUM_TILE_URL],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 13,
    } as SourceSpecification;
    // Insert hillshade right after the background layer so all paints render on top.
    const insertAt =
      layers.findIndex((layer) => layer.type === "background") + 1;
    const hillshadeLayer = makeHillshadeLayer(topo.hillshade.strength);
    if (insertAt > 0) {
      layers.splice(insertAt, 0, hillshadeLayer);
    } else {
      layers.unshift(hillshadeLayer);
    }
  }

  if (topo.contours.enabled) {
    const dem = getCachedDemSource();
    if (dem) {
      const contourUrl = dem.contourProtocolUrl({
        thresholds: densityThresholds(topo.contours.density),
        contourLayer: CONTOUR_LAYER_NAME,
        elevationKey: ELEVATION_KEY,
        levelKey: LEVEL_KEY,
        extent: 4096,
        buffer: 1,
      });
      sources[CONTOUR_SOURCE_ID] = {
        type: "vector",
        tiles: [contourUrl],
        maxzoom: 15,
      } as SourceSpecification;
      layers.push(makeContourLines(topo.textColor));
      if (topo.contours.labels) {
        layers.push(makeContourLabels(topo.textColor));
      }
    }
  }

  if (showCustomLayers && customLayers.length > 0) {
    const { sources: customSources, layers: customLayerSpecs } =
      makeCustomLayerSourcesAndLayers(customLayers);
    Object.assign(sources, customSources);
    layers.push(...customLayerSpecs);
  }

  return {
    ...baseStyle,
    sources,
    layers,
  };
}
