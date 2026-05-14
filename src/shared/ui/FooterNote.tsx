import { APP_VERSION } from "@/core/config";

export default function FooterNote() {
  const appVersion = APP_VERSION;

  return (
    <footer className="app-footer desktop-footer">
      <div className="desktop-footer-left">
        <p className="source-note">
          <a
            className="source-link"
            href="https://github.com/nebriv/PeakBaggingPosterGenerator"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
          {" | "}
          <a
            className="source-link"
            href="https://github.com/nebriv/terraink"
            target="_blank"
            rel="noreferrer"
          >
            Built on Terraink
          </a>
        </p>
      </div>

      <div className="desktop-footer-middle">
        <p className="made-note">
          Peak Bagging Poster Generator v{appVersion} &middot; MIT
        </p>
      </div>

      <div className="desktop-footer-right">
        <p className="source-note">
          Map data &copy;{" "}
          <a
            className="source-link"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>
          {" | Tiles "}
          <a
            className="source-link"
            href="https://openfreemap.org/"
            target="_blank"
            rel="noreferrer"
          >
            OpenFreeMap
          </a>
          {" | Peaks "}
          <a
            className="source-link"
            href="https://wiki.openstreetmap.org/wiki/Overpass_API"
            target="_blank"
            rel="noreferrer"
          >
            Overpass
          </a>
          {" | DEM "}
          <a
            className="source-link"
            href="https://registry.opendata.aws/terrain-tiles/"
            target="_blank"
            rel="noreferrer"
          >
            AWS Terrain
          </a>
        </p>
      </div>
    </footer>
  );
}
