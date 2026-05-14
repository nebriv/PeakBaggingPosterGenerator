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
  showLabels: boolean;
  showElevation: boolean;
  unit: "ft" | "m";
  fontFamily?: string;
}

/**
 * Renders peak markers + labels onto an export-context canvas. Mirrors the
 * positioning logic of the live PeakOverlay so previews and exports match.
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
    showLabels,
    showElevation,
    unit,
    fontFamily,
  } = options;

  const triangleHalfWidth = 7 * sizeScale;
  const triangleHeight = 11 * sizeScale;
  const fontSize = 11 * sizeScale;
  const labelFamily = fontFamily
    ? `"${fontFamily}", "Space Grotesk", sans-serif`
    : '"Space Grotesk", sans-serif';

  for (const peak of peaks) {
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

    // Triangle.
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

    if (showLabels) {
      const lines: string[] = [];
      if (peak.name) lines.push(peak.name);
      if (showElevation && peak.eleMeters != null) {
        lines.push(displayElevation(peak, unit));
      }
      if (lines.length > 0) {
        ctx.font = `600 ${fontSize}px ${labelFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const lineHeight = fontSize * 1.15;
        for (let i = 0; i < lines.length; i++) {
          const lineY = -triangleHeight - (lines.length - 1 - i) * lineHeight - 4;
          ctx.lineWidth = Math.max(3, sizeScale * 3);
          ctx.strokeStyle = haloColor;
          ctx.strokeText(lines[i], 0, lineY);
          ctx.fillStyle = textColor;
          ctx.fillText(lines[i], 0, lineY);
        }
      }
    }

    ctx.restore();
  }
}
