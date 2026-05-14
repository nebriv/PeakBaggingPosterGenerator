import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { applyPeakFilters, displayElevation } from "../application/peakFilter";
import type { PeakItem } from "../domain/types";

interface ProjectedPeak {
  peak: PeakItem;
  x: number;
  y: number;
}

interface PeakOverlayProps {
  overzoomScale: number;
}

export default function PeakOverlay({ overzoomScale }: PeakOverlayProps) {
  const { state, mapRef, effectiveTheme } = usePosterContext();
  const [renderTick, setRenderTick] = useState(0);

  const filtered = useMemo(
    () =>
      applyPeakFilters(state.peaks, state.customPeaks, {
        form: state.form,
        excludedIds: new Set(state.excludedPeakIds),
      }),
    [
      state.peaks,
      state.customPeaks,
      state.excludedPeakIds,
      state.form,
    ],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => setRenderTick((value) => value + 1);
    map.on("move", sync);
    map.on("moveend", sync);
    map.on("rotate", sync);
    map.on("resize", sync);
    map.on("load", sync);
    return () => {
      map.off("move", sync);
      map.off("moveend", sync);
      map.off("rotate", sync);
      map.off("resize", sync);
      map.off("load", sync);
    };
  }, [mapRef]);

  const projected: ProjectedPeak[] = useMemo(() => {
    const map = mapRef.current;
    if (!map) return [];
    return filtered.flatMap((peak) => {
      try {
        const point = map.project([peak.lon, peak.lat]);
        return [
          {
            peak,
            x: point.x / overzoomScale,
            y: point.y / overzoomScale,
          },
        ];
      } catch {
        return [];
      }
    });
    // renderTick drives recomputation when the map view changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, filtered, overzoomScale, renderTick]);

  if (!state.form.showPeaks || projected.length === 0) return null;

  const labelColor = effectiveTheme.ui.text;
  const haloColor = effectiveTheme.ui.bg;

  return (
    <div
      className="poster-peak-overlay"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      {projected.map(({ peak, x, y }) => (
        <PeakGlyph
          key={peak.id}
          peak={peak}
          x={x}
          y={y}
          labelColor={labelColor}
          haloColor={haloColor}
          showLabel={state.form.showPeakLabels}
          showElevation={state.form.showPeakElevation}
          unit={state.form.peakElevationUnit}
        />
      ))}
    </div>
  );
}

interface PeakGlyphProps {
  peak: PeakItem;
  x: number;
  y: number;
  labelColor: string;
  haloColor: string;
  showLabel: boolean;
  showElevation: boolean;
  unit: "ft" | "m";
}

function PeakGlyph({
  peak,
  x,
  y,
  labelColor,
  haloColor,
  showLabel,
  showElevation,
  unit,
}: PeakGlyphProps) {
  const wrapperStyle: CSSProperties = {
    position: "absolute",
    left: `${x}px`,
    top: `${y}px`,
    transform: "translate(-50%, -100%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    fontFamily: "var(--peak-font-family, inherit)",
  };

  const labelStyle: CSSProperties = {
    color: labelColor,
    fontSize: "10px",
    lineHeight: 1.2,
    fontWeight: 600,
    letterSpacing: "0.02em",
    textShadow: `0 0 3px ${haloColor}, 0 0 3px ${haloColor}, 0 0 6px ${haloColor}`,
    whiteSpace: "nowrap",
    textAlign: "center",
    maxWidth: 140,
  };

  return (
    <div style={wrapperStyle}>
      {showLabel && (peak.name || (showElevation && peak.eleMeters != null)) ? (
        <div style={labelStyle}>
          {peak.name ? <div>{peak.name}</div> : null}
          {showElevation && peak.eleMeters != null ? (
            <div style={{ opacity: 0.8 }}>{displayElevation(peak, unit)}</div>
          ) : null}
        </div>
      ) : null}
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <polygon
          points="7,1 13,12 1,12"
          fill={labelColor}
          stroke={haloColor}
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
