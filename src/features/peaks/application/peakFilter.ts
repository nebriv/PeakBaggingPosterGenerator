import type { PeakItem } from "../domain/types";
import type { PosterForm } from "@/features/poster/application/posterReducer";
import { M_TO_FT } from "../domain/constants";

interface FilterOptions {
  form: Pick<
    PosterForm,
    | "peakRequireName"
    | "peakRequireEle"
    | "peakElevationMin"
    | "peakElevationMax"
    | "peakElevationUnit"
    | "peakTopN"
  >;
  excludedIds: ReadonlySet<string>;
  bbox?: [number, number, number, number];
}

export function elevationFeet(eleMeters: number | null): number | null {
  if (eleMeters == null) return null;
  return eleMeters * M_TO_FT;
}

export function displayElevation(
  peak: PeakItem,
  unit: "ft" | "m",
): string {
  if (peak.eleMeters == null) return "";
  const value = unit === "ft" ? peak.eleMeters * M_TO_FT : peak.eleMeters;
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

function pointInBbox(
  lat: number,
  lon: number,
  bbox: [number, number, number, number],
): boolean {
  const [south, west, north, east] = bbox;
  if (lat < south || lat > north) return false;
  if (west <= east) {
    return lon >= west && lon <= east;
  }
  // antimeridian
  return lon >= west || lon <= east;
}

export function applyPeakFilters(
  peaks: PeakItem[],
  customPeaks: PeakItem[],
  options: FilterOptions,
): PeakItem[] {
  const { form, excludedIds, bbox } = options;
  const unit = form.peakElevationUnit;
  const minMeters = unit === "ft" ? form.peakElevationMin / M_TO_FT : form.peakElevationMin;
  const maxMeters = unit === "ft" ? form.peakElevationMax / M_TO_FT : form.peakElevationMax;

  const all = [...customPeaks, ...peaks];
  const seen = new Set<string>();

  const filtered = all.filter((peak) => {
    if (excludedIds.has(peak.id)) return false;
    if (seen.has(peak.id)) return false;
    seen.add(peak.id);
    if (form.peakRequireName && !peak.name.trim()) return false;
    if (form.peakRequireEle && peak.eleMeters == null) return false;
    if (peak.eleMeters != null) {
      if (peak.eleMeters < minMeters) return false;
      if (peak.eleMeters > maxMeters) return false;
    } else if (form.peakElevationMin > 0) {
      return false;
    }
    if (bbox && !pointInBbox(peak.lat, peak.lon, bbox)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const ea = a.eleMeters ?? Number.NEGATIVE_INFINITY;
    const eb = b.eleMeters ?? Number.NEGATIVE_INFINITY;
    return eb - ea;
  });

  if (form.peakTopN > 0) {
    return filtered.slice(0, form.peakTopN);
  }
  return filtered;
}
