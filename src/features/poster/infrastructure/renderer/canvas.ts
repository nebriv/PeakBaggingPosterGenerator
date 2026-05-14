import { MAX_PIXELS, MAX_SIDE, OUTPUT_DPI } from "./constants";
import type { CanvasSize } from "../../domain/types";

export function resolveCanvasSize(
  widthInches: number,
  heightInches: number,
  dpi: number = OUTPUT_DPI,
): CanvasSize {
  const effectiveDpi = Number.isFinite(dpi) && dpi > 0 ? dpi : OUTPUT_DPI;
  const requestedWidth = Math.max(600, Math.round(widthInches * effectiveDpi));
  const requestedHeight = Math.max(600, Math.round(heightInches * effectiveDpi));
  const totalPixels = requestedWidth * requestedHeight;

  const areaFactor =
    totalPixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / totalPixels) : 1;
  const sideFactor =
    Math.max(requestedWidth, requestedHeight) > MAX_SIDE
      ? MAX_SIDE / Math.max(requestedWidth, requestedHeight)
      : 1;

  const factor = Math.min(areaFactor, sideFactor, 1);
  const width = Math.max(600, Math.round(requestedWidth * factor));
  const height = Math.max(600, Math.round(requestedHeight * factor));

  return {
    width,
    height,
    requestedWidth,
    requestedHeight,
    downscaleFactor: factor,
  };
}
