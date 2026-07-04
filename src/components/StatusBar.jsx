/**
 * StatusBar — shows device name, connection status, and battery level.
 */
export default function StatusBar({ status, deviceName, battery }) {
  const statusMap = {
    disconnected: { label: 'Disconnected', cls: 'status--disconnected' },
    connecting:   { label: 'Connecting…',  cls: 'status--connecting'   },
    connected:    { label: 'Connected',    cls: 'status--connected'    },
    error:        { label: 'Error',        cls: 'status--error'        },
  };

  const { label, cls } = statusMap[status] || statusMap.disconnected;

  const batteryIcon = (pct) => {
    if (pct >= 80) return '🔋';
    if (pct >= 50) return '🔋';
    if (pct >= 20) return '🪫';
    return '🪫';
  };

  return (
    <div className={`status-bar ${cls}`}>
      <div className="status-bar__left">
        <span className="status-bar__dot" aria-hidden="true" />
        <span className="status-bar__text">{label}</span>
        {deviceName && (
          <span className="status-bar__device">— {deviceName}</span>
        )}
      </div>
      {battery !== null && battery !== undefined && (
        <div className="status-bar__battery" aria-label={`Battery: ${battery}%`}>
          <span>{batteryIcon(battery)}</span>
          <span>{battery}%</span>
          <div className="battery-bar">
            <div
              className="battery-bar__fill"
              style={{ width: `${battery}%`, background: battery > 20 ? 'var(--green)' : 'var(--red)' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
