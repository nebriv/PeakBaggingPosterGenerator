import { InfoIcon } from "@/shared/ui/Icons";

interface GeneralHeaderProps {
  onAboutOpen: () => void;
}

export default function GeneralHeader({ onAboutOpen }: GeneralHeaderProps) {
  return (
    <header className="general-header">
      <div className="desktop-brand">
        <span
          className="desktop-brand-logo brand-logo"
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.4rem",
            fontWeight: 700,
            width: "1.6em",
            height: "1.6em",
          }}
        >
          ▲
        </span>
        <div className="desktop-brand-copy brand-copy">
          <h1 className="desktop-brand-title">Peak Bagging Poster</h1>
          <p className="desktop-brand-kicker app-kicker">
            Topographic posters for any peak-bagging list
          </p>
        </div>
      </div>

      <div className="general-header-actions">
        <button
          type="button"
          className="general-header-text-btn general-header-about-text-btn"
          onClick={onAboutOpen}
          aria-label="About"
          title="About"
        >
          <span className="general-header-btn-label">About</span>
          <span className="general-header-btn-icon" aria-hidden="true">
            <InfoIcon />
          </span>
        </button>
      </div>
    </header>
  );
}
