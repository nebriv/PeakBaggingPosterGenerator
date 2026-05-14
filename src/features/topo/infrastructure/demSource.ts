import maplibregl from "maplibre-gl";
import { TERRARIUM_TILE_URL } from "../domain/constants";

// `maplibre-contour` is shipped as a UMD bundle; types are not in DefinitelyTyped.
// We import it dynamically the first time it is needed so that SSR / tests
// without DOM don't blow up at import time.

interface ContourThresholdsByZoom {
  [zoom: number]: number[] | [number, number];
}

interface DemSourceInstance {
  contourProtocolUrl(options: {
    thresholds: ContourThresholdsByZoom;
    contourLayer: string;
    elevationKey: string;
    levelKey: string;
    extent: number;
    buffer: number;
  }): string;
  sharedDemProtocolUrl: string;
  setupMaplibre(map: typeof maplibregl): void;
}

interface DemSourceConstructor {
  new (options: {
    url: string;
    encoding?: "terrarium" | "mapbox";
    maxzoom?: number;
    worker?: boolean;
    cacheSize?: number;
    timeoutMs?: number;
  }): DemSourceInstance;
}

interface MaplibreContourModule {
  DemSource: DemSourceConstructor;
}

let demSourcePromise: Promise<DemSourceInstance | null> | null = null;
let cachedDemSource: DemSourceInstance | null = null;

export function getCachedDemSource(): DemSourceInstance | null {
  return cachedDemSource;
}

/**
 * Resolve a shared `DemSource` and wire it into MapLibre. Returns the same
 * instance on subsequent calls so the underlying tile cache is reused.
 */
export async function ensureDemSource(): Promise<DemSourceInstance | null> {
  if (cachedDemSource) return cachedDemSource;
  if (demSourcePromise) return demSourcePromise;
  demSourcePromise = (async () => {
    try {
      const mod = (await import("maplibre-contour")) as
        | MaplibreContourModule
        | { default: MaplibreContourModule };
      const module = "DemSource" in mod ? mod : (mod as { default: MaplibreContourModule }).default;
      if (!module?.DemSource) {
        console.warn("maplibre-contour: DemSource export not found");
        return null;
      }
      const instance = new module.DemSource({
        url: TERRARIUM_TILE_URL,
        encoding: "terrarium",
        maxzoom: 13,
        worker: true,
      });
      instance.setupMaplibre(maplibregl);
      cachedDemSource = instance;
      return instance;
    } catch (err) {
      console.warn("maplibre-contour failed to load:", err);
      return null;
    }
  })();
  return demSourcePromise;
}
