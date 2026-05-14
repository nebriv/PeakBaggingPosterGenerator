import { useMemo, useState } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { useMapSync } from "@/features/map/application/useMapSync";
import { applyPeakFilters, displayElevation } from "../application/peakFilter";
import { REGION_PRESETS } from "../domain/constants";
import type { PeakItem } from "../domain/types";

function randomId(): string {
  return `custom:${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export default function PeaksSection() {
  const { state, dispatch, mapRef } = usePosterContext();
  const { flyToLocation } = useMapSync(state, dispatch, mapRef);

  const [newName, setNewName] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLon, setNewLon] = useState("");
  const [newEle, setNewEle] = useState("");
  const [error, setError] = useState("");

  const filtered = useMemo(
    () =>
      applyPeakFilters(state.peaks, state.customPeaks, {
        form: state.form,
        excludedIds: new Set(state.excludedPeakIds),
      }),
    [state.peaks, state.customPeaks, state.excludedPeakIds, state.form],
  );

  const setField = (name: keyof typeof state.form, value: string | boolean) =>
    dispatch({ type: "SET_FIELD", name, value });

  const handleAddCustomPeak = () => {
    setError("");
    const lat = Number(newLat);
    const lon = Number(newLon);
    const ele = newEle.trim() === "" ? null : Number(newEle);
    if (!newName.trim()) {
      setError("Peak name is required.");
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError("Latitude must be between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setError("Longitude must be between -180 and 180.");
      return;
    }
    if (ele != null && !Number.isFinite(ele)) {
      setError("Elevation must be a number (or blank).");
      return;
    }

    const eleMeters =
      ele == null
        ? null
        : state.form.peakElevationUnit === "ft"
          ? ele / 3.28084
          : ele;

    const peak: PeakItem = {
      id: randomId(),
      name: newName.trim(),
      lat,
      lon,
      eleMeters,
      source: "custom",
    };
    dispatch({ type: "ADD_CUSTOM_PEAK", peak });
    setNewName("");
    setNewLat("");
    setNewLon("");
    setNewEle("");
  };

  const handleUseMapCenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    setNewLat(center.lat.toFixed(6));
    setNewLon(center.lng.toFixed(6));
  };

  const isExcluded = (id: string) => state.excludedPeakIds.includes(id);

  return (
    <div className="peaks-section" style={{ display: "grid", gap: "0.75rem" }}>
      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">Regions</legend>
        <div className="pbpg-chip-row">
          {REGION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="pbpg-chip"
              onClick={() => {
                const [west, south, east, north] = preset.bbox;
                const centerLat = (south + north) / 2;
                const centerLon = (west + east) / 2;
                const widthMeters = Math.abs(east - west) * 111_000;
                dispatch({
                  type: "SET_FORM_FIELDS",
                  fields: {
                    latitude: centerLat.toFixed(6),
                    longitude: centerLon.toFixed(6),
                    distance: String(Math.round(widthMeters / 2)),
                    displayCity: preset.label,
                    displayCountry: "",
                  },
                  resetDisplayNameOverrides: true,
                });
                flyToLocation(centerLat, centerLon);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">Display</legend>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={state.form.showPeaks}
            onChange={(e) => setField("showPeaks", e.target.checked)}
          />
          <span>Show peaks on map</span>
        </label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={state.form.showPeakLegend}
            onChange={(e) => setField("showPeakLegend", e.target.checked)}
          />
          <span>Show legend (numbered list in right margin)</span>
        </label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={state.form.showPeakLabels}
            onChange={(e) => setField("showPeakLabels", e.target.checked)}
          />
          <span>Also label peaks on the map</span>
        </label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={state.form.showPeakElevation}
            onChange={(e) => setField("showPeakElevation", e.target.checked)}
          />
          <span>Include elevation on map labels</span>
        </label>
      </fieldset>

      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">Filter</legend>
        <div
          className="form-row"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.5rem",
          }}
        >
          <label className="form-field">
            <span>
              Min elevation ({state.form.peakElevationUnit})
            </span>
            <input
              type="number"
              value={state.form.peakElevationMin}
              min={0}
              onChange={(e) =>
                dispatch({
                  type: "SET_FORM_FIELDS",
                  fields: {
                    peakElevationMin: Number(e.target.value) || 0,
                  },
                })
              }
            />
          </label>
          <label className="form-field">
            <span>
              Max elevation ({state.form.peakElevationUnit})
            </span>
            <input
              type="number"
              value={state.form.peakElevationMax}
              min={0}
              onChange={(e) =>
                dispatch({
                  type: "SET_FORM_FIELDS",
                  fields: {
                    peakElevationMax: Number(e.target.value) || 0,
                  },
                })
              }
            />
          </label>
        </div>
        <div
          className="pbpg-chip-row"
          style={{ alignItems: "center" }}
        >
          <span style={{ fontSize: "0.8rem", opacity: 0.85 }}>Unit</span>
          <button
            type="button"
            className={`pbpg-chip${state.form.peakElevationUnit === "ft" ? " is-active" : ""}`}
            onClick={() =>
              dispatch({
                type: "SET_FORM_FIELDS",
                fields: { peakElevationUnit: "ft" },
              })
            }
          >
            ft
          </button>
          <button
            type="button"
            className={`pbpg-chip${state.form.peakElevationUnit === "m" ? " is-active" : ""}`}
            onClick={() =>
              dispatch({
                type: "SET_FORM_FIELDS",
                fields: { peakElevationUnit: "m" },
              })
            }
          >
            m
          </button>
        </div>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={state.form.peakRequireName}
            onChange={(e) => setField("peakRequireName", e.target.checked)}
          />
          <span>Only peaks with a name</span>
        </label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={state.form.peakRequireEle}
            onChange={(e) => setField("peakRequireEle", e.target.checked)}
          />
          <span>Only peaks with elevation</span>
        </label>
        <label className="form-field">
          <span>
            Top N{" "}
            <span style={{ opacity: 0.7 }}>
              ({state.form.peakTopN === 0 ? "all" : state.form.peakTopN})
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={state.form.peakTopN}
            onChange={(e) =>
              dispatch({
                type: "SET_FORM_FIELDS",
                fields: { peakTopN: Number(e.target.value) || 0 },
              })
            }
          />
        </label>
      </fieldset>

      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">
          Visible peaks ({filtered.length})
        </legend>
        <ul
          className="peak-list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            maxHeight: 220,
            overflow: "auto",
            display: "grid",
            gap: 2,
          }}
        >
          {filtered.map((peak) => (
            <li
              key={peak.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 4px",
                opacity: isExcluded(peak.id) ? 0.45 : 1,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {peak.name || "(unnamed peak)"}{" "}
                <small style={{ opacity: 0.7 }}>
                  {displayElevation(peak, state.form.peakElevationUnit)}
                </small>
                {peak.source === "custom" ? (
                  <small
                    style={{
                      marginLeft: 4,
                      padding: "0 4px",
                      borderRadius: 3,
                      background: "rgba(255,255,255,0.15)",
                    }}
                  >
                    custom
                  </small>
                ) : null}
              </span>
              <button
                type="button"
                className="pbpg-chip pbpg-chip--xs"
                onClick={() =>
                  dispatch({
                    type: "TOGGLE_PEAK_EXCLUDED",
                    peakId: peak.id,
                  })
                }
                title={isExcluded(peak.id) ? "Include peak" : "Exclude peak"}
              >
                {isExcluded(peak.id) ? "include" : "hide"}
              </button>
              {peak.source === "custom" ? (
                <button
                  type="button"
                  className="pbpg-chip pbpg-chip--xs"
                  onClick={() =>
                    dispatch({
                      type: "REMOVE_CUSTOM_PEAK",
                      peakId: peak.id,
                    })
                  }
                  title="Delete custom peak"
                >
                  delete
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {state.peaksStatus === "loading" ? (
          <p style={{ fontSize: 12, opacity: 0.7 }}>Fetching peaks from Overpass…</p>
        ) : null}
        {state.peaksStatus === "error" ? (
          <p style={{ fontSize: 12, color: "#c44" }}>{state.peaksError}</p>
        ) : null}
      </fieldset>

      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">Add a custom peak</legend>
        <label className="form-field">
          <span>Name</span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Cliff"
          />
        </label>
        <div
          className="form-row"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}
        >
          <label className="form-field">
            <span>Lat</span>
            <input
              type="number"
              step="0.000001"
              value={newLat}
              onChange={(e) => setNewLat(e.target.value)}
              placeholder="44.1126"
            />
          </label>
          <label className="form-field">
            <span>Lon</span>
            <input
              type="number"
              step="0.000001"
              value={newLon}
              onChange={(e) => setNewLon(e.target.value)}
              placeholder="-73.9237"
            />
          </label>
        </div>
        <label className="form-field">
          <span>Elevation ({state.form.peakElevationUnit}, optional)</span>
          <input
            type="number"
            step="1"
            value={newEle}
            onChange={(e) => setNewEle(e.target.value)}
          />
        </label>
        {error ? (
          <p style={{ fontSize: 12, color: "#c44" }}>{error}</p>
        ) : null}
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            className="pbpg-chip"
            onClick={handleUseMapCenter}
          >
            Use map center
          </button>
          <button
            type="button"
            className="pbpg-chip is-primary"
            onClick={handleAddCustomPeak}
          >
            Add peak
          </button>
        </div>
      </fieldset>
    </div>
  );
}
