import type { PeakItem } from "../domain/types";
import { projectMarkerToCanvas } from "@/features/markers/infrastructure/projection";
import type { MarkerProjectionInput } from "@/features/markers/domain/types";
import { displayElevation } from "../application/peakFilter";

interface DrawPeaksOptions {
  peaks: PeakItem[];
  projection: MarkerProjectionInput;
  scaleX: number;
  scaleY: number;
  sizeScale: number;
  textColor: string;
  haloColor: string;
  showNumbers: boolean;
  showInlineName: boolean;
  showInlineElevation: boolean;
  unit: "ft" | "m";
  fontFamily?: string;
}

/**
 * Renders peak triangles (with optional number badges and per-peak labels)
 * onto an export-context canvas. Mirrors the positioning logic of the live
 * PeakOverlay so previews and exports match.
 */
export function drawPeaksOnCanvas(
  ctx: CanvasRenderingContext2D,
  options: DrawPeaksOptions,
): void {
  const {
    peaks,
    projection,
    scaleX,
    scaleY,
    sizeScale,
    textColor,
    haloColor,
    showNumbers,
    showInlineName,
    showInlineElevation,
    unit,
    fontFamily,
  } = options;

  const triangleHalfWidth = 6 * sizeScale;
  const triangleHeight = 10 * sizeScale;
  const labelFontSize = 10 * sizeScale;
  const badgeFontSize = 8 * sizeScale;
  const badgePaddingX = 3 * sizeScale;
  const badgePaddingY = 1.6 * sizeScale;
  const badgeRadius = 1.6 * sizeScale;

  const titleFamily = fontFamily
    ? `"${fontFamily}", "Space Grotesk", sans-serif`
    : '"Space Grotesk", sans-serif';

  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i];
    const number = i + 1;
    const projected = projectMarkerToCanvas(peak.lat, peak.lon, projection);
    const x = projected.x * scaleX;
    const y = projected.y * scaleY;

    if (
      x < -100 ||
      y < -100 ||
      x > projection.canvasWidth * scaleX + 100 ||
      y > projection.canvasHeight * scaleY + 100
    ) {
      continue;
    }

    ctx.save();
    ctx.translate(x, y);

    // Triangle (anchored so the tip sits on the peak coordinate).
    ctx.beginPath();
    ctx.moveTo(0, -triangleHeight);
    ctx.lineTo(triangleHalfWidth, 0);
    ctx.lineTo(-triangleHalfWidth, 0);
    ctx.closePath();
    ctx.fillStyle = textColor;
    ctx.strokeStyle = haloColor;
    ctx.lineWidth = Math.max(1, sizeScale);
    ctx.fill();
    ctx.stroke();

    // Number badge to the right of the triangle.
    if (showNumbers) {
      ctx.font = `700 ${badgeFontSize}px ${titleFamily}`;
      const label = String(number);
      const metrics = ctx.measureText(label);
      const badgeWidth = metrics.width + badgePaddingX * 2;
      const badgeHeight = badgeFontSize + badgePaddingY * 2;
      const badgeX = triangleHalfWidth + 2 * sizeScale;
      const badgeY = -triangleHeight;

      ctx.fillStyle = textColor;
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = Math.max(0.8, sizeScale * 0.8);
      ctx.beginPath();
      if (typeof (ctx as CanvasRenderingContext2D).roundRect === "function") {
        (ctx as CanvasRenderingContext2D & {
          roundRect: (
            x: number,
            y: number,
            w: number,
            h: number,
            r: number,
          ) => void;
        }).roundRect(badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius);
      } else {
        ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = haloColor;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, badgeX + badgePaddingX, badgeY + badgeHeight / 2);
    }

    // Optional inline name/elevation (off by default in legend mode).
    if (showInlineName && peak.name) {
      const eleText =
        showInlineElevation && peak.eleMeters != null
          ? `  ${displayElevation(peak, unit)}`
          : "";
      const text = `${peak.name}${eleText}`;
      ctx.font = `600 ${labelFontSize}px ${titleFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = Math.max(3, sizeScale * 3);
      ctx.strokeStyle = haloColor;
      ctx.strokeText(text, 0, -triangleHeight - 6);
      ctx.fillStyle = textColor;
      ctx.fillText(text, 0, -triangleHeight - 6);
    }

    ctx.restore();
  }
}

interface DrawPeakLegendOptions {
  peaks: PeakItem[];
  canvasWidth: number;
  canvasHeight: number;
  textColor: string;
  paperColor: string;
  unit: "ft" | "m";
  fontFamily?: string;
}

/**
 * Draws the right-margin legend block to the export canvas. The placement
 * mirrors the PeakLegendOverlay React component (top 23%, right 3.5%,
 * bottom 3.5%, width 30%).
 */
export function drawPeakLegendOnCanvas(
  ctx: CanvasRenderingContext2D,
  options: DrawPeakLegendOptions,
): void {
  const {
    peaks,
    canvasWidth,
    canvasHeight,
    textColor,
    paperColor,
    unit,
    fontFamily,
  } = options;
  if (peaks.length === 0) return;

  const titleFamily = fontFamily
    ? `"${fontFamily}", "Space Grotesk", sans-serif`
    : '"Space Grotesk", sans-serif';

  const panelX = canvasWidth * 0.665;
  const panelY = canvasHeight * 0.23;
  const panelW = canvasWidth * 0.30;
  const panelH = canvasHeight * 0.735;
  const padX = canvasWidth * 0.012;
  const padY = canvasHeight * 0.012;
  const dim = Math.min(canvasWidth, canvasHeight);
  const headerSize = dim * 0.024;
  const rowSize = dim * 0.0155;
  const rowLineHeight = rowSize * 1.45;

  ctx.save();
  // Panel background + frame.
  ctx.fillStyle = paperColor;
  ctx.strokeStyle = textColor;
  ctx.lineWidth = Math.max(0.6, dim * 0.0008);
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  // Header.
  ctx.fillStyle = textColor;
  ctx.font = `700 ${headerSize}px ${titleFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    "PEAKS",
    panelX + panelW / 2,
    panelY + padY + headerSize,
  );

  // Divider under header.
  const dividerY = panelY + padY + headerSize + headerSize * 0.45;
  ctx.beginPath();
  ctx.moveTo(panelX + padX, dividerY);
  ctx.lineTo(panelX + panelW - padX, dividerY);
  ctx.stroke();

  // List rows. Switch to two columns when the visible peak count exceeds
  // what fits in a single column at the current row height.
  const innerX = panelX + padX;
  const innerY = dividerY + rowLineHeight * 0.6;
  const innerW = panelW - padX * 2;
  const innerH = panelY + panelH - padY - innerY;
  const rowsPerColumn = Math.max(1, Math.floor(innerH / rowLineHeight));
  const useTwoColumns = peaks.length > rowsPerColumn;
  const columns = useTwoColumns ? 2 : 1;
  const columnGap = padX;
  const columnWidth = (innerW - columnGap * (columns - 1)) / columns;
  const maxRows = rowsPerColumn * columns;
  const renderable = peaks.slice(0, maxRows);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  renderable.forEach((peak, index) => {
    const column = useTwoColumns ? Math.floor(index / rowsPerColumn) : 0;
    const rowInColumn = useTwoColumns ? index % rowsPerColumn : index;
    const baselineY = innerY + (rowInColumn + 1) * rowLineHeight - rowLineHeight * 0.25;
    const colX = innerX + column * (columnWidth + columnGap);
    const number = String(index + 1) + ".";
    const numberWidth = columnWidth * 0.16;
    const eleString =
      peak.eleMeters != null ? displayElevation(peak, unit) : "";
    const eleWidth = columnWidth * 0.34;
    const nameMaxWidth = columnWidth - numberWidth - eleWidth - dim * 0.005;

    // Number.
    ctx.font = `700 ${rowSize}px ${titleFamily}`;
    ctx.fillStyle = textColor;
    ctx.fillText(number, colX, baselineY);

    // Name (truncated to fit).
    ctx.font = `500 ${rowSize}px ${titleFamily}`;
    const name = truncate(ctx, peak.name || "—", nameMaxWidth);
    ctx.fillText(name, colX + numberWidth, baselineY);

    // Elevation right-aligned within the column.
    if (eleString) {
      ctx.font = `400 ${rowSize}px ${titleFamily}`;
      ctx.textAlign = "right";
      ctx.globalAlpha = 0.75;
      ctx.fillText(eleString, colX + columnWidth, baselineY);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
  });

  ctx.restore();
}

function truncate(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + ellipsis;
}
