import LineChart from './LineChart';

/**
 * SensorCard — glassmorphism card showing a metric with optional mini chart.
 *
 * Props:
 *   icon      emoji or SVG element
 *   label     sensor name
 *   value     current value (number or string)
 *   unit      unit string
 *   color     accent color
 *   history   optional { values, timestamps } for inline chart
 *   subValues optional array of { label, value, unit } for multi-value sensors
 *   loading   boolean — show skeleton animation
 */
export default function SensorCard({
  icon,
  label,
  value,
  unit,
  color = '#7c6ff7',
  history,
  subValues,
  loading = false,
  children,
}) {
  const hasSubValues = subValues && subValues.length > 0 && subValues.every(sv => sv.value !== null && sv.value !== undefined);
  const hasValue = (value !== null && value !== undefined) || hasSubValues;

  return (
    <div className="sensor-card" style={{ '--accent': color }}>
      <div className="sensor-card__header">
        <span className="sensor-card__icon" aria-hidden="true">{icon}</span>
        <span className="sensor-card__label">{label}</span>
      </div>

      <div className="sensor-card__body">
        {loading ? (
          <div className="sensor-card__skeleton" aria-label="Loading..." />
        ) : hasValue ? (
          value !== null && value !== undefined ? (
            <div className="sensor-card__value">
              <span className="sensor-card__number">{typeof value === 'number' ? value.toFixed(1) : value}</span>
              <span className="sensor-card__unit">{unit}</span>
            </div>
          ) : null
        ) : (
          <div className="sensor-card__waiting">Waiting for data…</div>
        )}

        {subValues && subValues.length > 0 && (
          <div className="sensor-card__sub-values">
            {subValues.map((sv) => (
              <div key={sv.label} className="sensor-card__sub-item">
                <span className="sensor-card__sub-label">{sv.label}</span>
                <span className="sensor-card__sub-value">
                  {typeof sv.value === 'number' ? sv.value.toFixed(2) : (sv.value ?? '—')}
                  <span className="sensor-card__sub-unit"> {sv.unit}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {children && (
        <div className="sensor-card__actions" style={{ marginTop: 'var(--space-4)' }}>
          {children}
        </div>
      )}

      {history && history.values.length > 1 && (
        <div className="sensor-card__chart">
          <LineChart history={history} color={color} height={52} label={label} />
        </div>
      )}
    </div>
  );
}
