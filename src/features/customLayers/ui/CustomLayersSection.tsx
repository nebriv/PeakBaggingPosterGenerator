import { useState } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import type {
  CustomGeoJsonLayer,
  CustomLayer,
  CustomRasterLayer,
} from "@/features/peaks/domain/types";

function newId(): string {
  return `layer-${Math.random().toString(36).slice(2, 9)}`;
}

export default function CustomLayersSection() {
  const { state, dispatch } = usePosterContext();
  const [kind, setKind] = useState<"geojson" | "raster">("geojson");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState(state.form.theme ? "#222222" : "#000000");
  const [fillColor, setFillColor] = useState("#888888");
  const [error, setError] = useState("");

  const handleAdd = () => {
    setError("");
    if (!name.trim()) {
      setError("Layer name is required.");
      return;
    }
    if (!url.trim()) {
      setError(
        kind === "geojson"
          ? "GeoJSON URL is required."
          : "Tile URL template is required.",
      );
      return;
    }
    if (kind === "raster" && !url.includes("{z}")) {
      setError("Tile URL must include {z}/{x}/{y} placeholders.");
      return;
    }
    const layer: CustomLayer =
      kind === "geojson"
        ? ({
            id: newId(),
            name: name.trim(),
            kind: "geojson",
            visible: true,
            url: url.trim(),
            color,
            fillColor,
            strokeWidth: 1.5,
            fillOpacity: 0.35,
          } satisfies CustomGeoJsonLayer)
        : ({
            id: newId(),
            name: name.trim(),
            kind: "raster",
            visible: true,
            tileUrl: url.trim(),
            opacity: 0.85,
          } satisfies CustomRasterLayer);
    dispatch({ type: "ADD_CUSTOM_LAYER", layer });
    setName("");
    setUrl("");
  };

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <label className="form-toggle">
        <input
          type="checkbox"
          checked={state.form.showCustomLayers}
          onChange={(e) =>
            dispatch({
              type: "SET_FIELD",
              name: "showCustomLayers",
              value: e.target.checked,
            })
          }
        />
        <span>Show custom overlays</span>
      </label>

      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.4rem" }}
      >
        <legend className="form-group-legend">Active overlays</legend>
        {state.customLayers.length === 0 ? (
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            No custom layers yet. Add a GeoJSON URL or an XYZ tile template
            below.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: 4,
            }}
          >
            {state.customLayers.map((layer) => (
              <li
                key={layer.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 6px",
                  border: "1px solid rgba(0,0,0,0.1)",
                  borderRadius: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_CUSTOM_LAYER",
                      layerId: layer.id,
                      changes: { visible: e.target.checked },
                    })
                  }
                  title="Toggle layer"
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {layer.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      opacity: 0.7,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {layer.kind === "geojson" ? layer.url : layer.tileUrl}
                  </div>
                </div>
                <button
                  type="button"
                  className="theme-card"
                  style={{ padding: "1px 6px", fontSize: 11 }}
                  onClick={() =>
                    dispatch({
                      type: "REMOVE_CUSTOM_LAYER",
                      layerId: layer.id,
                    })
                  }
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">Add an overlay</legend>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button
            type="button"
            className={`theme-card${kind === "geojson" ? " is-selected" : ""}`}
            onClick={() => setKind("geojson")}
          >
            GeoJSON
          </button>
          <button
            type="button"
            className={`theme-card${kind === "raster" ? " is-selected" : ""}`}
            onClick={() => setKind("raster")}
          >
            Raster tiles
          </button>
        </div>
        <label className="form-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. AT trail GeoJSON"
          />
        </label>
        <label className="form-field">
          <span>{kind === "geojson" ? "GeoJSON URL" : "XYZ tile URL"}</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              kind === "geojson"
                ? "https://example.com/trail.geojson"
                : "https://tile.example.com/{z}/{x}/{y}.png"
            }
          />
        </label>
        {kind === "geojson" ? (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <label
              style={{
                display: "flex",
                gap: "0.3rem",
                alignItems: "center",
                fontSize: 12,
              }}
            >
              Stroke
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <label
              style={{
                display: "flex",
                gap: "0.3rem",
                alignItems: "center",
                fontSize: 12,
              }}
            >
              Fill
              <input
                type="color"
                value={fillColor}
                onChange={(e) => setFillColor(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        {error ? (
          <p style={{ fontSize: 12, color: "#c44" }}>{error}</p>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="theme-card is-selected"
            onClick={handleAdd}
          >
            Add overlay
          </button>
        </div>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          Layers persist locally. The tile/GeoJSON server must allow CORS.
        </p>
      </fieldset>
    </div>
  );
}
