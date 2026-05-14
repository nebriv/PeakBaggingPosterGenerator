import { useExport } from "../application/useExport";
import { usePosterContext } from "@/features/poster/ui/PosterContext";

const DPI_OPTIONS = [
  { value: 96, label: "96 (screen)" },
  { value: 150, label: "150 (draft print)" },
  { value: 200, label: "200" },
  { value: 300, label: "300 (recommended)" },
  { value: 400, label: "400" },
  { value: 600, label: "600 (max)" },
];

export default function ExportSection() {
  const { state, dispatch } = usePosterContext();
  const { isExporting, handleDownloadPng, handleDownloadPdf, handleDownloadSvg } =
    useExport();

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <label className="form-field">
        <span>
          Output DPI{" "}
          <span style={{ opacity: 0.7 }}>{state.form.exportDpi} dpi</span>
        </span>
        <select
          value={state.form.exportDpi}
          onChange={(e) =>
            dispatch({
              type: "SET_FORM_FIELDS",
              fields: { exportDpi: Number(e.target.value) || 300 },
            })
          }
        >
          {DPI_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "0.4rem",
        }}
      >
        <button
          type="button"
          className="pbpg-chip is-primary"
          disabled={isExporting}
          onClick={handleDownloadPng}
        >
          {isExporting ? "Working…" : "PNG"}
        </button>
        <button
          type="button"
          className="pbpg-chip"
          disabled={isExporting}
          onClick={handleDownloadPdf}
        >
          {isExporting ? "Working…" : "PDF"}
        </button>
        <button
          type="button"
          className="pbpg-chip"
          disabled={isExporting}
          onClick={handleDownloadSvg}
        >
          {isExporting ? "Working…" : "SVG"}
        </button>
      </div>

      <p style={{ fontSize: 12, opacity: 0.7 }}>
        Export renders the map vector-crisp at the selected DPI. PNG output
        embeds a pHYs chunk with the chosen DPI so print drivers respect the
        page size. SVG export bundles per-layer vector geometry so you can
        post-process in Illustrator / Inkscape.
      </p>

      {state.error ? (
        <p style={{ fontSize: 12, color: "#c44" }}>{state.error}</p>
      ) : null}
    </div>
  );
}
