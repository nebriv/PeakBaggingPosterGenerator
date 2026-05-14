import { useState } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { useFormHandlers } from "@/features/poster/application/useFormHandlers";
import { useLocationAutocomplete } from "@/features/location/application/useLocationAutocomplete";
import { useCurrentLocation } from "@/features/location/application/useCurrentLocation";
import { useMapSync } from "@/features/map/application/useMapSync";
import type { MobileTab } from "@/shared/ui/MobileNavBar";

import LocationSection from "@/features/location/ui/LocationSection";
import MapSettingsSection from "@/features/map/ui/MapSettingsSection";
import LayersSection from "@/features/map/ui/LayersSection";
import MarkersSection from "@/features/markers/ui/MarkersSection";
import RoutesSection from "@/features/routes/ui/RoutesSection";
import TypographySection from "@/features/poster/ui/TypographySection";
import PeaksSection from "@/features/peaks/ui/PeaksSection";
import TopoSection from "@/features/topo/ui/TopoSection";
import CustomLayersSection from "@/features/customLayers/ui/CustomLayersSection";
import ExportSection from "@/features/export/ui/ExportSection";
import {
  LocationIcon,
  ThemeIcon,
  LayoutIcon,
  LayersIcon,
  MarkersIcon,
  RouteIcon,
  StyleIcon,
  PeaksIcon,
  TopoIcon,
  CustomLayerIcon,
  ExportIcon,
  ChevronDownIcon,
} from "@/shared/ui/Icons";

import { themeOptions } from "@/features/theme/infrastructure/themeRepository";
import { layoutGroups } from "@/features/layout/infrastructure/layoutRepository";
import {
  MIN_POSTER_CM,
  MAX_POSTER_CM,
  FONT_OPTIONS,
} from "@/core/config";
import type { SearchResult } from "@/features/location/domain/types";

type SectionId =
  | "location"
  | "peaks"
  | "topo"
  | "theme"
  | "layout"
  | "layers"
  | "customLayers"
  | "markers"
  | "routes"
  | "style"
  | "export";

const accordionSections: {
  id: SectionId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "location", label: "Location", Icon: LocationIcon },
  { id: "peaks", label: "Peaks", Icon: PeaksIcon },
  { id: "topo", label: "Hillshade & contours", Icon: TopoIcon },
  { id: "theme", label: "Theme", Icon: ThemeIcon },
  { id: "layout", label: "Layout", Icon: LayoutIcon },
  { id: "layers", label: "Map layers", Icon: LayersIcon },
  { id: "customLayers", label: "Custom layers", Icon: CustomLayerIcon },
  { id: "markers", label: "Markers", Icon: MarkersIcon },
  { id: "routes", label: "Routes", Icon: RouteIcon },
  { id: "style", label: "Typography", Icon: StyleIcon },
  { id: "export", label: "Export", Icon: ExportIcon },
];

export default function SettingsPanel({
  mobileTab,
}: {
  mobileTab?: MobileTab;
}) {
  const { state, dispatch, mapRef, selectedTheme } = usePosterContext();
  const {
    handleChange,
    handleNumericFieldBlur,
    handleThemeChange,
    handleLayoutChange,
    handleColorChange,
    handleResetColors,
    handleLocationSelect,
    handleClearLocation,
    setLocationFocused,
  } = useFormHandlers();
  const { locationSuggestions, isLocationSearching, searchNow } = useLocationAutocomplete(
    state.form.location,
    state.isLocationFocused,
  );
  const { flyToLocation } = useMapSync(state, dispatch, mapRef);
  const { handleUseCurrentLocation, isLocatingUser, locationPermissionMessage } =
    useCurrentLocation(flyToLocation);

  const [isColorEditorActive, setIsColorEditorActive] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(["location", "peaks", "topo", "export"]),
  );

  const isAuxEditorActive = isColorEditorActive;
  const showLocationSuggestions =
    state.isLocationFocused && locationSuggestions.length > 0;

  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const onLocationSelect = (location: SearchResult) => {
    handleLocationSelect(location);
    flyToLocation(location.lat, location.lon);
  };

  const renderSection = (id: SectionId) => {
    if (isColorEditorActive && id !== "theme" && id !== "layout") return null;
    if (
      isAuxEditorActive &&
      (id === "layers" || id === "style" || id === "customLayers" || id === "export")
    ) {
      return null;
    }
    switch (id) {
      case "location":
        return (
          <LocationSection
            form={state.form}
            onChange={handleChange}
            onLocationFocus={() => setLocationFocused(true)}
            onLocationBlur={() => setLocationFocused(false)}
            searchNow={searchNow}
            showLocationSuggestions={showLocationSuggestions}
            locationSuggestions={locationSuggestions}
            isLocationSearching={isLocationSearching}
            onLocationSelect={onLocationSelect}
            onClearLocation={handleClearLocation}
            onUseCurrentLocation={handleUseCurrentLocation}
            isLocatingUser={isLocatingUser}
            locationPermissionMessage={locationPermissionMessage}
          />
        );
      case "peaks":
        return <PeaksSection />;
      case "topo":
        return <TopoSection />;
      case "theme":
      case "layout":
        return (
          <MapSettingsSection
            activeMobileTab={mobileTab}
            form={state.form}
            onChange={handleChange}
            onNumericFieldBlur={handleNumericFieldBlur}
            onThemeChange={handleThemeChange}
            onLayoutChange={handleLayoutChange}
            selectedTheme={selectedTheme}
            themeOptions={themeOptions}
            layoutGroups={layoutGroups}
            minPosterCm={MIN_POSTER_CM}
            maxPosterCm={MAX_POSTER_CM}
            customColors={state.customColors}
            onColorChange={handleColorChange}
            onResetColors={handleResetColors}
            onColorEditorActiveChange={setIsColorEditorActive}
          />
        );
      case "layers":
        return (
          <LayersSection
            form={state.form}
            onChange={handleChange}
            minPosterCm={MIN_POSTER_CM}
            maxPosterCm={MAX_POSTER_CM}
            onNumericFieldBlur={handleNumericFieldBlur}
          />
        );
      case "customLayers":
        return <CustomLayersSection />;
      case "markers":
        return <MarkersSection />;
      case "routes":
        return <RoutesSection />;
      case "style":
        return (
          <TypographySection
            form={state.form}
            onChange={handleChange}
            fontOptions={FONT_OPTIONS}
          />
        );
      case "export":
        return <ExportSection />;
      default:
        return null;
    }
  };

  return (
    <form className="settings-panel" onSubmit={(e) => e.preventDefault()}>
      {accordionSections.map(({ id, label, Icon }) => (
        <div
          key={id}
          className={`mobile-section mobile-section--${id} accordion-item${openSections.has(id) ? " accordion-item--open" : ""}`}
        >
          <AccordionHeader
            sectionId={id}
            label={label}
            Icon={Icon}
            isOpen={openSections.has(id)}
            onToggle={toggleSection}
          />
          <div
            className={`accordion-body${openSections.has(id) ? " is-open" : ""}`}
          >
            <div className="accordion-body-inner">{renderSection(id)}</div>
          </div>
        </div>
      ))}

      {!isAuxEditorActive && state.error ? (
        <p className="error">{state.error}</p>
      ) : null}
    </form>
  );
}

function AccordionHeader({
  sectionId,
  label,
  Icon,
  isOpen,
  onToggle,
}: {
  sectionId: SectionId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  isOpen: boolean;
  onToggle: (id: SectionId) => void;
}) {
  return (
    <button
      type="button"
      className={`accordion-header${isOpen ? " is-open" : ""}`}
      onClick={() => onToggle(sectionId)}
      aria-expanded={isOpen}
    >
      <Icon className="accordion-icon" />
      <span className="accordion-label">{label}</span>
      <ChevronDownIcon className="accordion-chevron" />
    </button>
  );
}
