import type { PeakItem } from "../domain/types";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function parseElevation(tags: Record<string, string> | undefined): number | null {
  if (!tags) return null;
  const raw = tags["ele"] ?? tags["height"];
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

function pointFromElement(el: OverpassElement): [number, number] | null {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return [el.lat, el.lon];
  }
  if (el.center) return [el.center.lat, el.center.lon];
  return null;
}

function buildQuery(bbox: [number, number, number, number]): string {
  const [south, west, north, east] = bbox;
  return `[out:json][timeout:25];
(
  node["natural"="peak"](${south},${west},${north},${east});
  way["natural"="peak"](${south},${west},${north},${east});
);
out tags center;`;
}

async function postToEndpoint(
  endpoint: string,
  query: string,
  signal?: AbortSignal,
): Promise<OverpassResponse> {
  const body = new URLSearchParams({ data: query }).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    body,
    signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!response.ok) {
    throw new Error(`Overpass ${endpoint} responded ${response.status}`);
  }
  return (await response.json()) as OverpassResponse;
}

/**
 * Fetches OSM peaks within `bbox` ([south, west, north, east]). Tries the
 * primary Overpass endpoint and falls back to mirrors on failure.
 */
export async function fetchPeaks(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<PeakItem[]> {
  const query = buildQuery(bbox);
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const json = await postToEndpoint(endpoint, query, signal);
      const elements = json.elements ?? [];
      const peaks: PeakItem[] = [];
      for (const el of elements) {
        const point = pointFromElement(el);
        if (!point) continue;
        const tags = el.tags ?? {};
        peaks.push({
          id: `osm:${el.type}:${el.id}`,
          name: tags["name"] ?? "",
          lat: point[0],
          lon: point[1],
          eleMeters: parseElevation(tags),
          source: "osm",
        });
      }
      return peaks;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All Overpass endpoints failed");
}
