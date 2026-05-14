import type { CSSProperties } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { applyPeakFilters, displayElevation } from "../application/peakFilter";

export default function PeakLegendOverlay() {
  const { state, effectiveTheme } = usePosterContext();
  if (!state.form.showPeaks || !state.form.showPeakLegend) return null;

  const filtered = applyPeakFilters(state.peaks, state.customPeaks, {
    form: state.form,
    excludedIds: new Set(state.excludedPeakIds),
  });
  if (filtered.length === 0) return null;

  const textColor = effectiveTheme.ui.text;
  const paperColor = effectiveTheme.ui.bg;
  const lineColor = effectiveTheme.ui.text;
  const useTwoColumns = filtered.length > 24;

  // Reserve top space for the city/country/coords text overlay so the legend
  // doesn't collide with it. The text overlay lives in roughly the top ~22%
  // of the poster.
  const panelStyle: CSSProperties = {
    position: "absolute",
    top: "23%",
    right: "3.5%",
    bottom: "3.5%",
    width: "30%",
    background: paperColor,
    color: textColor,
    border: `1px solid ${lineColor}`,
    padding: "3.5cqmin 3cqmin",
    fontFamily: '"Space Grotesk", "Inter", sans-serif',
    fontSize: "1.6cqmin",
    lineHeight: 1.2,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: 3,
    boxShadow: "0 0 0 0.4cqmin rgba(0,0,0,0.04)",
  };

  const headerStyle: CSSProperties = {
    margin: 0,
    fontFamily: '"Space Grotesk", "Inter", sans-serif',
    fontWeight: 700,
    fontSize: "2.4cqmin",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    textAlign: "center",
    paddingBottom: "1.6cqmin",
    borderBottom: `1px solid ${lineColor}`,
    marginBottom: "1.6cqmin",
  };

  const gridStyle: CSSProperties = {
    flex: 1,
    display: "grid",
    gridTemplateColumns: useTwoColumns ? "1fr 1fr" : "1fr",
    columnGap: "2cqmin",
    rowGap: "0.6cqmin",
    overflow: "hidden",
  };

  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1.6em 1fr auto",
    alignItems: "baseline",
    columnGap: "0.6em",
    minWidth: 0,
  };

  const nameStyle: CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
  };

  const eleStyle: CSSProperties = {
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
    opacity: 0.75,
  };

  const numberStyle: CSSProperties = {
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    opacity: 0.85,
  };

  return (
    <aside
      className="poster-peak-legend"
      style={panelStyle}
      aria-label="Peak legend"
    >
      <h2 style={headerStyle}>Peaks</h2>
      <div style={gridStyle}>
        {filtered.map((peak, index) => (
          <div key={peak.id} style={rowStyle}>
            <span style={numberStyle}>{index + 1}.</span>
            <span style={nameStyle}>{peak.name || "—"}</span>
            <span style={eleStyle}>
              {peak.eleMeters != null
                ? displayElevation(peak, state.form.peakElevationUnit)
                : ""}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
