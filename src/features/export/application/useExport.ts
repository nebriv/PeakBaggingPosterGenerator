import { useCallback, useMemo } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import type { ExportFormat } from "@/features/export/domain/types";
import { captureMapAsCanvas } from "@/features/export/infrastructure/mapExporter";
import { compositeExport } from "@/features/poster/infrastructure/renderer";
import { resolveCanvasSize } from "@/features/poster/infrastructure/renderer/canvas";
import { getAllMarkerIcons } from "@/features/markers/infrastructure/iconRegistry";
import { ensureGoogleFont } from "@/core/services";
import { applyPeakFilters } from "@/features/peaks/application/peakFilter";
import {
  createPngBlob,
  createPdfBlobFromCanvas,
  createLayeredSvgBlobFromMap,
  createPosterFilename,
  triggerDownloadBlob,
} from "@/core/services";
import {
  CM_PER_INCH,
  DEFAULT_POSTER_WIDTH_CM,
  DEFAULT_POSTER_HEIGHT_CM,
} from "@/core/config";

// Legacy event names kept for any subscribers that still reference them.
// This build has no ad gating, so they are never dispatched.
export const ADBLOCK_LIMIT_EVENT = "pbpg:adblock-limit";
export const ADBLOCK_WARN_EVENT = "pbpg:adblock-warn";

export type SupportPromptVariant = "first" | "milestone" | "ad";

export interface SupportPromptState {
  posterNumber: number;
  variant: SupportPromptVariant;
}

export const SUPPORT_PROMPT_EVENT = "pbpg:support-prompt";

/**
 * Provides handlers for exporting the live poster preview as PNG, PDF, or SVG.
 *
 * Flow:
 * 1. Resize MapLibre container to full export resolution.
 * 2. Wait for tiles at new resolution.
 * 3. Snapshot the WebGL canvas.
 * 4. Composite fades + text onto the snapshot.
 * 5. Download.
 */
export function useExport() {
  const { state, dispatch, effectiveTheme, mapRef } = usePosterContext();
  const { form } = state;
  const hasVisibleMarkers = form.showMarkers && state.markers.length > 0;
  const visibleRoutes = useMemo(
    () =>
      form.showRoutes
        ? state.routes.filter((route) => route.visible)
        : [],
    [form.showRoutes, state.routes],
  );
  const visiblePeaks = useMemo(
    () =>
      form.showPeaks
        ? applyPeakFilters(state.peaks, state.customPeaks, {
            form,
            excludedIds: new Set(state.excludedPeakIds),
          })
        : [],
    [
      form,
      state.peaks,
      state.customPeaks,
      state.excludedPeakIds,
    ],
  );
  const hasVisibleOverlays =
    hasVisibleMarkers || visibleRoutes.length > 0 || visiblePeaks.length > 0;

  const exportPoster = useCallback(
    async (format: ExportFormat) => {
      const map = mapRef.current;
      if (!map) {
        dispatch({ type: "SET_ERROR", error: "Map is not ready." });
        return;
      }

      dispatch({ type: "SET_EXPORT_STATUS", exporting: true });

      try {
        if (form.showPosterText && form.fontFamily.trim()) {
          await ensureGoogleFont(form.fontFamily.trim());
        }

        const widthCm = Number(form.width) || DEFAULT_POSTER_WIDTH_CM;
        const heightCm = Number(form.height) || DEFAULT_POSTER_HEIGHT_CM;
        const dpi = Number(form.exportDpi) || 300;
        const widthInches = widthCm / CM_PER_INCH;
        const heightInches = heightCm / CM_PER_INCH;

        const size = resolveCanvasSize(widthInches, heightInches, dpi);

        const lat = Number(form.latitude) || 0;
        const lon = Number(form.longitude) || 0;

        if (format === "svg") {
          const svgBlob = await createLayeredSvgBlobFromMap({
            map,
            exportWidth: size.width,
            exportHeight: size.height,
            theme: effectiveTheme,
            center: { lat, lon },
            displayCity: form.displayCity || form.location || "",
            displayCountry: form.displayCountry || "",
            fontFamily: form.fontFamily.trim(),
            showPosterText: form.showPosterText,
            showOverlay: form.showMarkers,
            includeCredits: form.includeCredits,
            markers: hasVisibleMarkers ? state.markers : [],
            markerIcons: hasVisibleOverlays
              ? getAllMarkerIcons(state.customMarkerIcons)
              : [],
            routes: visibleRoutes,
          });
          const svgFilename = createPosterFilename(
            form.displayCity || form.location,
            form.theme,
            "svg",
          );
          await triggerDownloadBlob(svgBlob, svgFilename);
          dispatch({ type: "SET_EXPORT_STATUS", exporting: false });
          return;
        }

        const {
          canvas: mapCanvas,
          markerProjection,
          markerScaleX,
          markerScaleY,
          markerSizeScale,
        } = await captureMapAsCanvas(map, size.width, size.height);

        const { canvas } = await compositeExport(mapCanvas, {
          theme: effectiveTheme,
          center: { lat, lon },
          widthInches,
          heightInches,
          displayCity: form.displayCity || form.location || "",
          displayCountry: form.displayCountry || "",
          fontFamily: form.fontFamily.trim(),
          showPosterText: form.showPosterText,
          showOverlay: form.showMarkers,
          includeCredits: form.includeCredits,
          markers: hasVisibleMarkers ? state.markers : [],
          markerIcons: hasVisibleOverlays
            ? getAllMarkerIcons(state.customMarkerIcons)
            : [],
          markerProjection: hasVisibleOverlays ? markerProjection : undefined,
          markerScaleX: hasVisibleOverlays ? markerScaleX : undefined,
          markerScaleY: hasVisibleOverlays ? markerScaleY : undefined,
          markerSizeScale: hasVisibleOverlays ? markerSizeScale : undefined,
          routes: visibleRoutes,
          peaks: visiblePeaks,
          peakUnit: form.peakElevationUnit,
          showPeakLabels: form.showPeakLabels,
          showPeakElevation: form.showPeakElevation,
          showPeakLegend: form.showPeakLegend,
        });

        const filename = createPosterFilename(
          form.displayCity || form.location,
          form.theme,
          format,
        );

        if (format === "pdf") {
          const pdfBlob = createPdfBlobFromCanvas(canvas, {
            widthCm,
            heightCm,
          });
          await triggerDownloadBlob(pdfBlob, filename);
        } else {
          const pngBlob = await createPngBlob(canvas, dpi);
          await triggerDownloadBlob(pngBlob, filename);
        }

        dispatch({ type: "SET_EXPORT_STATUS", exporting: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Export failed.";
        dispatch({ type: "SET_EXPORT_STATUS", exporting: false, error: message });
      }
    },
    [
      mapRef,
      form,
      effectiveTheme,
      dispatch,
      hasVisibleMarkers,
      hasVisibleOverlays,
      visibleRoutes,
      state.markers,
      state.customMarkerIcons,
    ],
  );

  const handleDownloadPng = useCallback(
    () => exportPoster("png"),
    [exportPoster],
  );

  const handleDownloadPdf = useCallback(
    () => exportPoster("pdf"),
    [exportPoster],
  );

  const handleDownloadSvg = useCallback(
    () => exportPoster("svg"),
    [exportPoster],
  );

  return {
    isExporting: state.isExporting,
    exportPoster,
    handleDownloadPng,
    handleDownloadPdf,
    handleDownloadSvg,
  };
}
