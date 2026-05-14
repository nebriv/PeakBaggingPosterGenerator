import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { applyPeakFilters, displayElevation } from "../application/peakFilter";
import type { PeakItem } from "../domain/types";

interface ProjectedPeak {
  peak: PeakItem;
  index: number;
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
    return filtered.flatMap((peak, index) => {
      try {
        const point = map.project([peak.lon, peak.lat]);
        return [
          {
            peak,
            index: index + 1,
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
  const showNumberBadge = state.form.showPeakLegend;
  const showInlineName = state.form.showPeakLabels;
  const showInlineElevation = state.form.showPeakElevation;

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
      {projected.map(({ peak, index, x, y }) => (
        <PeakGlyph
          key={peak.id}
          peak={peak}
          index={index}
          x={x}
          y={y}
          labelColor={labelColor}
          haloColor={haloColor}
          showNumberBadge={showNumberBadge}
          showInlineName={showInlineName}
          showInlineElevation={showInlineElevation}
          unit={state.form.peakElevationUnit}
        />
      ))}
    </div>
  );
}

interface PeakGlyphProps {
  peak: PeakItem;
  index: number;
  x: number;
  y: number;
  labelColor: string;
  haloColor: string;
  showNumberBadge: boolean;
  showInlineName: boolean;
  showInlineElevation: boolean;
  unit: "ft" | "m";
}

function PeakGlyph({
  peak,
  index,
  x,
  y,
  labelColor,
  haloColor,
  showNumberBadge,
  showInlineName,
  showInlineElevation,
  unit,
}: PeakGlyphProps) {
  const wrapperStyle: CSSProperties = {
    position: "absolute",
    left: `${x}px`,
    top: `${y}px`,
    transform: "translate(-50%, -100%)",
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
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
  };

  const badgeStyle: CSSProperties = {
    fontFamily: '"Space Grotesk", "Inter", sans-serif',
    fontWeight: 700,
    fontSize: "9px",
    lineHeight: 1,
    padding: "2px 4px",
    borderRadius: "2px",
    background: labelColor,
    color: haloColor,
    boxShadow: `0 0 0 1px ${haloColor}`,
  };

  return (
    <div style={wrapperStyle}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 14 14"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <polygon
          points="7,1 13,12 1,12"
          fill={labelColor}
          stroke={haloColor}
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      {showNumberBadge ? <span style={badgeStyle}>{index}</span> : null}
      {showInlineName && peak.name ? (
        <span style={labelStyle}>
          {peak.name}
          {showInlineElevation && peak.eleMeters != null ? (
            <span style={{ opacity: 0.8 }}>
              {" "}
              {displayElevation(peak, unit)}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
