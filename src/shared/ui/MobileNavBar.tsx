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
  SettingsIcon,
} from "./Icons";

export type MobileTab =
  | "location"
  | "peaks"
  | "topo"
  | "theme"
  | "layout"
  | "style"
  | "layers"
  | "customLayers"
  | "markers"
  | "routes"
  | "export";

const tabs: {
  id: MobileTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "location", label: "Location", Icon: LocationIcon },
  { id: "peaks", label: "Peaks", Icon: PeaksIcon },
  { id: "topo", label: "Topo", Icon: TopoIcon },
  { id: "theme", label: "Theme", Icon: ThemeIcon },
  { id: "layout", label: "Layout", Icon: LayoutIcon },
  { id: "style", label: "Style", Icon: StyleIcon },
  { id: "layers", label: "Map layers", Icon: LayersIcon },
  { id: "customLayers", label: "Custom", Icon: CustomLayerIcon },
  { id: "markers", label: "Markers", Icon: MarkersIcon },
  { id: "routes", label: "Routes", Icon: RouteIcon },
  { id: "export", label: "Export", Icon: ExportIcon },
];

interface MobileNavBarProps {
  activeTab: MobileTab;
  drawerOpen: boolean;
  isLocationVisible: boolean;
  onTabChange: (tab: MobileTab) => void;
}

export default function MobileNavBar({
  activeTab,
  drawerOpen,
  isLocationVisible,
  onTabChange,
}: MobileNavBarProps) {
  return (
    <div className="mobile-nav-wrapper">
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <div className="mobile-nav-scroll-container">
          <div className="mobile-nav-tabs">
            {tabs.map(({ id, label, Icon }) => {
              const isLocationTab = id === "location";
              const isActive = isLocationTab
                ? isLocationVisible
                : drawerOpen && activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`mobile-nav-tab${isActive ? " is-active" : ""}`}
                  onClick={() => onTabChange(id)}
                  aria-current={!isLocationTab && activeTab === id ? "page" : undefined}
                  aria-pressed={isLocationTab ? isLocationVisible : undefined}
                >
                  <Icon className="mobile-nav-icon" />
                  <span className="mobile-nav-label">{label}</span>
                </button>
              );
            })}
          </div>
          <div className="mobile-nav-fade" aria-hidden="true" />
        </div>
      </nav>

      <button
        type="button"
        className="mobile-nav-settings"
        aria-label="Settings"
        disabled
      >
        <SettingsIcon className="mobile-nav-settings-icon" />
      </button>
    </div>
  );
}
