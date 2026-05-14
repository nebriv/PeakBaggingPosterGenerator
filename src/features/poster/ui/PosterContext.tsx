import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  posterReducer,
  type PosterState,
  type PosterAction,
  type PosterForm,
} from "../application/posterReducer";
import type { ResolvedTheme } from "@/features/theme/domain/types";
import { getTheme } from "@/features/theme/infrastructure/themeRepository";
import { applyThemeColorOverrides } from "@/features/theme/domain/colorPaths";
import { generateMapStyle } from "@/features/map/infrastructure/maplibreStyle";
import type { StyleSpecification } from "maplibre-gl";
import type { MapInstanceRef } from "@/features/map/domain/types";
import { createDefaultMarkerSettings } from "@/features/markers/infrastructure/helpers";
import {
  loadCustomMarkerIcons,
  saveCustomMarkerIcons,
} from "@/features/markers/infrastructure/customIconStorage";
import { createDefaultRouteSettings } from "@/features/routes/infrastructure/helpers";

/* ────── Default form (moved from appConfig) ────── */

import {
  defaultLayoutId,
  getLayoutOption,
} from "@/features/layout/infrastructure/layoutRepository";
import { defaultThemeName } from "@/features/theme/infrastructure/themeRepository";
import {
  DEFAULT_POSTER_WIDTH_CM,
  DEFAULT_POSTER_HEIGHT_CM,
  DEFAULT_DISTANCE_METERS,
  DEFAULT_LAT,
  DEFAULT_LON,
} from "@/core/config";
import { augmentMapStyle } from "@/features/topo/infrastructure/augmentStyle";
import {
  ensureDemSource,
  getCachedDemSource,
} from "@/features/topo/infrastructure/demSource";
import {
  loadUserData,
  saveUserData,
} from "@/features/peaks/infrastructure/peakStorage";

const defaultLayoutOption = getLayoutOption(defaultLayoutId);
const defaultLayoutWidthCm = Number(
  defaultLayoutOption?.widthCm ?? DEFAULT_POSTER_WIDTH_CM,
);
const defaultLayoutHeightCm = Number(
  defaultLayoutOption?.heightCm ?? DEFAULT_POSTER_HEIGHT_CM,
);
// Default region: Adirondack High Peaks (matches the original generator's
// out-of-box destination).
const DEFAULT_LOCATION_LABEL = "Adirondack High Peaks, NY, USA";
const DEFAULT_REGION_LAT = 44.1;
const DEFAULT_REGION_LON = -73.95;
const DEFAULT_REGION_DISTANCE_METERS = 35_000;

export const DEFAULT_FORM: PosterForm = {
  location: DEFAULT_LOCATION_LABEL,
  latitude: DEFAULT_REGION_LAT.toFixed(6),
  longitude: DEFAULT_REGION_LON.toFixed(6),
  distance: String(DEFAULT_REGION_DISTANCE_METERS),
  width: String(defaultLayoutWidthCm),
  height: String(defaultLayoutHeightCm),
  theme: defaultThemeName,
  layout: defaultLayoutId,
  displayCity: "Adirondack High Peaks",
  displayCountry: "New York",
  displayContinent: "North America",
  fontFamily: "",
  showPosterText: true,
  includeCredits: true,
  includeLandcover: true,
  includeBuildings: false,
  includeWater: true,
  includeParks: true,
  includeAeroway: false,
  includeRail: false,
  includeRoads: true,
  includeRoadPath: true,
  includeRoadMinorLow: false,
  includeRoadOutline: true,
  showMarkers: true,
  showRoutes: true,
  showHillshade: true,
  hillshadeStrength: 50,
  showContours: true,
  contourDensity: 60,
  contourLabels: true,
  showPeaks: true,
  showPeakLabels: true,
  showPeakElevation: true,
  // Sensible defaults so the preview doesn't open with a wall of overlapping
  // peak triangles. Users tune these in the Peaks panel.
  peakRequireName: true,
  peakRequireEle: true,
  peakElevationMin: 2000,
  peakElevationMax: 30000,
  peakElevationUnit: "ft",
  peakTopN: 50,
  showCustomLayers: true,
  exportDpi: 300,
};

// Silence the unused-import warnings for these still-imported constants when
// nothing else in this file references them directly.
void DEFAULT_DISTANCE_METERS;
void DEFAULT_LAT;
void DEFAULT_LON;

const INITIAL_STATE: PosterState = {
  form: DEFAULT_FORM,
  customColors: {},
  markers: [],
  customMarkerIcons: [],
  markerDefaults: {
    ...createDefaultMarkerSettings(),
    color: getTheme(defaultThemeName).ui.text,
  },
  isMarkerEditorActive: false,
  activeMarkerId: null,
  routes: [],
  routeDefaults: {
    ...createDefaultRouteSettings(),
    color: getTheme(defaultThemeName).ui.text,
  },
  error: "",
  isExporting: false,
  isLocationFocused: false,
  selectedLocation: null,
  userLocation: null,
  displayNameOverrides: {
    city: false,
    country: false,
  },
  peaks: [],
  peaksStatus: "idle",
  peaksError: "",
  customPeaks: [],
  excludedPeakIds: [],
  customLayers: [],
};

/* ────── Context shapes ────── */

interface PosterDispatchContextValue {
  dispatch: React.Dispatch<PosterAction>;
}

const PosterDispatchContext = createContext<PosterDispatchContextValue | null>(null);

interface PosterContextValue {
  state: PosterState;
  dispatch: React.Dispatch<PosterAction>;
  selectedTheme: ResolvedTheme;
  effectiveTheme: ResolvedTheme;
  mapStyle: StyleSpecification;
  mapRef: MapInstanceRef;
}

const PosterContext = createContext<PosterContextValue | null>(null);

/* ────── Provider ────── */

export function PosterProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(posterReducer, INITIAL_STATE);
  const mapRef = useRef(null) as MapInstanceRef;
  const lastSyncedMarkerThemeColorRef = useRef<string | null>(null);
  const lastSyncedRouteThemeColorRef = useRef<string | null>(null);
  const hasLoadedCustomIconsRef = useRef(false);
  const hasHydratedFromStorageRef = useRef(false);
  const [demReady, setDemReady] = useState(() => Boolean(getCachedDemSource()));

  // Hydrate custom peaks / excluded peaks / custom layers from localStorage.
  useEffect(() => {
    if (hasHydratedFromStorageRef.current) return;
    const data = loadUserData();
    if (data.customPeaks.length > 0) {
      for (const peak of data.customPeaks) {
        dispatch({ type: "ADD_CUSTOM_PEAK", peak });
      }
    }
    if (data.excludedPeakIds.length > 0) {
      dispatch({ type: "SET_EXCLUDED_PEAKS", peakIds: data.excludedPeakIds });
    }
    if (data.customLayers.length > 0) {
      dispatch({ type: "SET_CUSTOM_LAYERS", layers: data.customLayers });
    }
    hasHydratedFromStorageRef.current = true;
  }, []);

  // Persist user-managed peak/layer data.
  useEffect(() => {
    if (!hasHydratedFromStorageRef.current) return;
    saveUserData({
      customPeaks: state.customPeaks,
      excludedPeakIds: state.excludedPeakIds,
      customLayers: state.customLayers,
    });
  }, [state.customPeaks, state.excludedPeakIds, state.customLayers]);

  // Wire the maplibre-contour DEM protocol into MapLibre once.
  useEffect(() => {
    let active = true;
    void ensureDemSource().then((dem) => {
      if (active && dem) setDemReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const selectedTheme = useMemo(
    () => getTheme(state.form.theme),
    [state.form.theme],
  );

  const effectiveTheme = useMemo(() => {
    if (Object.keys(state.customColors).length === 0) {
      return selectedTheme;
    }
    return applyThemeColorOverrides(selectedTheme, state.customColors);
  }, [selectedTheme, state.customColors]);

  useEffect(() => {
    const markerThemeColor = effectiveTheme.ui.text;
    const previouslySynced = lastSyncedMarkerThemeColorRef.current;

    if (previouslySynced === markerThemeColor) {
      return;
    }

    lastSyncedMarkerThemeColorRef.current = markerThemeColor;
    dispatch({
      type: "SET_MARKER_DEFAULTS",
      defaults: { color: markerThemeColor },
      applyToMarkers: true,
    });
  }, [dispatch, effectiveTheme.ui.text]);

  useEffect(() => {
    const routeThemeColor = effectiveTheme.ui.text;
    if (lastSyncedRouteThemeColorRef.current === routeThemeColor) {
      return;
    }
    lastSyncedRouteThemeColorRef.current = routeThemeColor;
    dispatch({
      type: "SET_ROUTE_DEFAULTS",
      defaults: { color: routeThemeColor },
      applyToRoutes: true,
    });
  }, [dispatch, effectiveTheme.ui.text]);

  useEffect(() => {
    let isCancelled = false;

    void loadCustomMarkerIcons()
      .then((icons) => {
        if (isCancelled) {
          return;
        }
        hasLoadedCustomIconsRef.current = true;
        dispatch({ type: "SET_CUSTOM_MARKER_ICONS", icons });
      })
      .catch(() => {
        hasLoadedCustomIconsRef.current = true;
        // Ignore storage read failures.
      });

    return () => {
      isCancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!hasLoadedCustomIconsRef.current) {
      return;
    }
    void saveCustomMarkerIcons(state.customMarkerIcons).catch(() => {
      // Ignore storage write failures.
    });
  }, [state.customMarkerIcons]);

  const mapStyle = useMemo(
    () => {
      const base = generateMapStyle(effectiveTheme, {
        includeLandcover: state.form.includeLandcover,
        includeBuildings: state.form.includeBuildings,
        includeWater: state.form.includeWater,
        includeParks: state.form.includeParks,
        includeAeroway: state.form.includeAeroway,
        includeRail: state.form.includeRail,
        includeRoads: state.form.includeRoads,
        includeRoadPath: state.form.includeRoadPath,
        includeRoadMinorLow: state.form.includeRoadMinorLow,
        includeRoadOutline: state.form.includeRoadOutline,
        distanceMeters: Number(state.form.distance),
      });
      return augmentMapStyle(
        base,
        {
          hillshade: {
            enabled: state.form.showHillshade,
            strength: state.form.hillshadeStrength,
          },
          contours: {
            enabled: state.form.showContours && demReady,
            density: state.form.contourDensity,
            labels: state.form.contourLabels,
          },
          textColor: effectiveTheme.ui.text,
        },
        state.customLayers,
        state.form.showCustomLayers,
      );
    },
    [
      effectiveTheme,
      state.form.includeLandcover,
      state.form.includeBuildings,
      state.form.includeWater,
      state.form.includeParks,
      state.form.includeAeroway,
      state.form.includeRail,
      state.form.includeRoads,
      state.form.includeRoadPath,
      state.form.includeRoadMinorLow,
      state.form.includeRoadOutline,
      state.form.distance,
      state.form.showHillshade,
      state.form.hillshadeStrength,
      state.form.showContours,
      state.form.contourDensity,
      state.form.contourLabels,
      state.form.showCustomLayers,
      state.customLayers,
      demReady,
    ],
  );

  const dispatchValue = useMemo<PosterDispatchContextValue>(
    () => ({ dispatch }),
    [dispatch],
  );

  const value = useMemo<PosterContextValue>(
    () => ({
      state,
      dispatch,
      selectedTheme,
      effectiveTheme,
      mapStyle,
      mapRef,
    }),
    [state, selectedTheme, effectiveTheme, mapStyle],
  );

  return (
    <PosterDispatchContext.Provider value={dispatchValue}>
      <PosterContext.Provider value={value}>{children}</PosterContext.Provider>
    </PosterDispatchContext.Provider>
  );
}

/* ────── Hook ────── */

export function usePosterContext(): PosterContextValue {
  const ctx = useContext(PosterContext);
  if (!ctx) {
    throw new Error("usePosterContext must be used within a PosterProvider");
  }
  return ctx;
}

export function usePosterDispatch(): PosterDispatchContextValue {
  const ctx = useContext(PosterDispatchContext);
  if (!ctx) {
    throw new Error("usePosterDispatch must be used within a PosterProvider");
  }
  return ctx;
}
