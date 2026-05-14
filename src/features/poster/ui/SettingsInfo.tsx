interface SettingsInfoProps {
  location: string;
  theme: string;
  layout: string;
  posterSize: string;
  markers: string;
  coordinates: string;
}

export default function SettingsInfo({
  location,
  theme,
  layout,
  posterSize,
  markers,
  coordinates,
}: SettingsInfoProps) {
  const rows = [
    { label: "Location", value: location },
    { label: "Theme", value: theme },
    { label: "Layout", value: layout },
    { label: "Poster Size", value: posterSize },
    { label: "Markers", value: markers },
    { label: "Coordinates", value: coordinates },
  ];

  return (
    <section className="settings-info-card" aria-label="Current settings">
      <h3 className="settings-info-title">Current Settings</h3>
      <dl className="settings-info-list">
        {rows.map((row) => (
          <div key={row.label} className="settings-info-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
