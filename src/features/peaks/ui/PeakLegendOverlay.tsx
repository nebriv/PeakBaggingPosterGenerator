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
  // CSS multi-column lays the rows out automatically; each row is its own
  // flex line that the browser won't break mid-content thanks to
  // break-inside: avoid.
  const useTwoColumns = filtered.length > 24;

  const panelStyle: CSSProperties = {
    position: "absolute",
    top: "23%",
    right: "3.5%",
    bottom: "3.5%",
    width: useTwoColumns ? "38%" : "30%",
    background: paperColor,
    color: textColor,
    border: `1px solid ${lineColor}`,
    padding: "3cqmin 3cqmin",
    fontFamily: '"Space Grotesk", "Inter", sans-serif',
    lineHeight: 1.2,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: 3,
  };

  const headerStyle: CSSProperties = {
    margin: 0,
    fontFamily: '"Space Grotesk", "Inter", sans-serif',
    fontWeight: 700,
    fontSize: "2.4cqmin",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    textAlign: "center",
    paddingBottom: "1.4cqmin",
    borderBottom: `1px solid ${lineColor}`,
    marginBottom: "1.4cqmin",
  };

  const columnsStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    columnCount: useTwoColumns ? 2 : 1,
    columnGap: "2cqmin",
    columnRule: useTwoColumns
      ? `1px solid color-mix(in srgb, ${lineColor} 35%, transparent)`
      : "none",
    fontSize: "1.55cqmin",
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    gap: "0.45em",
    padding: "0.18em 0",
    breakInside: "avoid",
    pageBreakInside: "avoid",
  };

  const numberStyle: CSSProperties = {
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
    minWidth: "1.6em",
    textAlign: "right",
    opacity: 0.85,
  };

  const nameStyle: CSSProperties = {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
  };

  const eleStyle: CSSProperties = {
    flexShrink: 0,
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
    opacity: 0.75,
    whiteSpace: "nowrap",
  };

  return (
    <aside
      className="poster-peak-legend"
      style={panelStyle}
      aria-label="Peak legend"
    >
      <h2 style={headerStyle}>Peaks</h2>
      <div style={columnsStyle}>
        {filtered.map((peak, index) => (
          <div key={peak.id} style={rowStyle}>
            <span style={numberStyle}>{index + 1}.</span>
            <span style={nameStyle}>{peak.name || "—"}</span>
            {peak.eleMeters != null ? (
              <span style={eleStyle}>
                {displayElevation(peak, state.form.peakElevationUnit)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
