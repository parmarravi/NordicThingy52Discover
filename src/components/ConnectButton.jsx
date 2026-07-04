/**
 * ConnectButton — animated BLE connect / disconnect button.
 */
export default function ConnectButton({ status, onConnect, onDisconnect, error }) {
  const isConnected  = status === 'connected';
  const isConnecting = status === 'connecting';

  const handleClick = () => {
    if (isConnected) onDisconnect();
    else if (!isConnecting) onConnect();
  };

  return (
    <div className="connect-wrap">
      <button
        id="ble-connect-btn"
        className={`connect-btn connect-btn--${status}`}
        onClick={handleClick}
        disabled={isConnecting}
        aria-label={isConnected ? 'Disconnect from Thingy:52' : 'Connect to Thingy:52'}
      >
        <span className="connect-btn__ring" aria-hidden="true" />
        <span className="connect-btn__ring connect-btn__ring--2" aria-hidden="true" />
        <span className="connect-btn__inner">
          {isConnecting ? (
            <>
              <span className="connect-btn__spinner" aria-hidden="true" />
              <span>Connecting…</span>
            </>
          ) : isConnected ? (
            <>
              <span aria-hidden="true">✕</span>
              <span>Disconnect</span>
            </>
          ) : (
            <>
              <BleIcon />
              <span>Connect Thingy:52</span>
            </>
          )}
        </span>
      </button>

      {error && (
        <p className="connect-btn__error" role="alert">
          ⚠️ {error}
        </p>
      )}

      {status === 'disconnected' && !error && (
        <p className="connect-btn__hint">
          Requires Chrome or Edge with Bluetooth enabled
        </p>
      )}
    </div>
  );
}

function BleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" />
    </svg>
  );
}
