import { usePosterContext } from "@/features/poster/ui/PosterContext";

export default function TopoSection() {
  const { state, dispatch } = usePosterContext();
  const { form } = state;

  const setField = (name: keyof typeof form, value: string | boolean) =>
    dispatch({ type: "SET_FIELD", name, value });

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">Hillshade</legend>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={form.showHillshade}
            onChange={(e) => setField("showHillshade", e.target.checked)}
          />
          <span>Show DEM hillshade</span>
        </label>
        <label className="form-field">
          <span>
            Strength{" "}
            <span style={{ opacity: 0.7 }}>{form.hillshadeStrength}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={form.hillshadeStrength}
            onChange={(e) =>
              dispatch({
                type: "SET_FORM_FIELDS",
                fields: { hillshadeStrength: Number(e.target.value) || 0 },
              })
            }
          />
        </label>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          Renders from AWS open DEM tiles, terrarium-encoded.
        </p>
      </fieldset>

      <fieldset
        className="form-group"
        style={{ border: 0, padding: 0, display: "grid", gap: "0.5rem" }}
      >
        <legend className="form-group-legend">Contour lines</legend>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={form.showContours}
            onChange={(e) => setField("showContours", e.target.checked)}
          />
          <span>Show contour lines</span>
        </label>
        <label className="form-field">
          <span>
            Density{" "}
            <span style={{ opacity: 0.7 }}>{form.contourDensity}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={form.contourDensity}
            onChange={(e) =>
              dispatch({
                type: "SET_FORM_FIELDS",
                fields: { contourDensity: Number(e.target.value) || 0 },
              })
            }
          />
        </label>
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={form.contourLabels}
            onChange={(e) => setField("contourLabels", e.target.checked)}
          />
          <span>Label major contours</span>
        </label>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          Generated client-side from the same DEM source. Intervals scale with
          zoom.
        </p>
      </fieldset>
    </div>
  );
}
