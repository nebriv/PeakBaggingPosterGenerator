import { useEffect, useRef } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { fetchPeaks } from "../infrastructure/overpassAdapter";
import { PEAK_CACHE_TTL_MS } from "../domain/constants";
import type { PeakItem } from "../domain/types";

interface CacheEntry {
  peaks: PeakItem[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Snap a lat/lon to a coarse grid so nearby viewports share one fetch. */
function bboxKey(bbox: [number, number, number, number]): string {
  return bbox.map((v) => v.toFixed(2)).join(",");
}

/**
 * Whenever lat/lon/distance change, refetch peaks for a generous bbox around
 * the current view. Caches by bbox key for 12h.
 */
export function usePeakFetch() {
  const { state, dispatch } = usePosterContext();
  const { latitude, longitude, distance } = state.form;
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const lat = Number(latitude);
    const lon = Number(longitude);
    const dist = Number(distance);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    // 0.5° padding around the map view so adjacent peaks remain available
    // when the user pans without an immediate refetch.
    const distanceDegrees = Math.min(
      2.5,
      Math.max(0.25, (Number.isFinite(dist) ? dist : 4_000) / 111_000),
    );
    const padding = Math.max(0.25, distanceDegrees);
    const bbox: [number, number, number, number] = [
      lat - padding,
      lon - padding,
      lat + padding,
      lon + padding,
    ];
    const key = bboxKey(bbox);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < PEAK_CACHE_TTL_MS) {
      dispatch({ type: "PEAKS_LOADED", peaks: cached.peaks });
      return;
    }

    dispatch({ type: "PEAKS_LOADING" });
    const seq = ++requestSeqRef.current;
    const controller = new AbortController();

    fetchPeaks(bbox, controller.signal)
      .then((peaks) => {
        if (seq !== requestSeqRef.current) return;
        cache.set(key, { peaks, fetchedAt: Date.now() });
        dispatch({ type: "PEAKS_LOADED", peaks });
      })
      .catch((err) => {
        if ((err as DOMException)?.name === "AbortError") return;
        if (seq !== requestSeqRef.current) return;
        dispatch({
          type: "PEAKS_ERROR",
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      controller.abort();
    };
  }, [latitude, longitude, distance, dispatch]);
}
