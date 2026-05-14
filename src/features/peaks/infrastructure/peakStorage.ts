import type { CustomLayer, PeakItem } from "../domain/types";

const STORAGE_KEY = "pbpg.user.v1";

interface UserBlob {
  customPeaks?: PeakItem[];
  excludedPeakIds?: string[];
  customLayers?: CustomLayer[];
}

function readBlob(): UserBlob {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeBlob(next: UserBlob): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage quota or disabled — swallow.
  }
}

export function loadUserData(): Required<UserBlob> {
  const blob = readBlob();
  return {
    customPeaks: Array.isArray(blob.customPeaks) ? blob.customPeaks : [],
    excludedPeakIds: Array.isArray(blob.excludedPeakIds)
      ? blob.excludedPeakIds
      : [],
    customLayers: Array.isArray(blob.customLayers) ? blob.customLayers : [],
  };
}

export function saveUserData(data: UserBlob): void {
  const existing = readBlob();
  writeBlob({ ...existing, ...data });
}
