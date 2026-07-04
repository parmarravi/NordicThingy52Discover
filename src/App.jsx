import { useState, useEffect, useRef } from 'react';
import { useBluetooth } from './hooks/useBluetooth';
import { useEnvironment } from './hooks/useEnvironment';
import { useMotion } from './hooks/useMotion';
import { useSound } from './hooks/useSound';
import { useUI } from './hooks/useUI';
import ConnectButton from './components/ConnectButton';
import StatusBar from './components/StatusBar';
import Dashboard from './components/Dashboard';
import MoonlightAmbient from './components/MoonlightAmbient';
import MetalBallsTank from './components/MetalBallsTank';
import CalibrationPanel from './components/CalibrationPanel';
import WinsSimulatorv2 from './components/WinsSimulatorv2';
import WindSimulator from './components/WindSimulator';
import PaintDripCanvas from './components/PaintDripCanvas';
import BioluminescentExplorer from './components/BioluminescentExplorer';
import CandleSimulator from './components/CandleSimulator';
import { DEFAULT_CALIBRATION } from './utils/constants';

export default function App() {
  const ble = useBluetooth();

  const env = useEnvironment({
    onConnect: ble.onConnect,
    onDisconnect: ble.onDisconnect,
  });

  const motion = useMotion({
    onConnect: ble.onConnect,
    onDisconnect: ble.onDisconnect,
  });

  const sound = useSound({
    onConnect: ble.onConnect,
    onDisconnect: ble.onDisconnect,
  });

  const ui = useUI({
    onConnect: ble.onConnect,
    onDisconnect: ble.onDisconnect,
  });

  const [currentApp, setCurrentApp] = useState('dashboard');
  const [isCalibrateOpen, setIsCalibrateOpen] = useState(false);
  const [calibration, setCalibration] = useState(DEFAULT_CALIBRATION);

  const hasAutoCalibratedRef = useRef(false);

  // Reset auto-calibration flag on disconnect
  useEffect(() => {
    if (ble.status !== 'connected') {
      hasAutoCalibratedRef.current = false;
      setCalibration(prev => ({ ...prev, isCalibrating: false, progress: 0 }));
    }
  }, [ble.status]);

  // Auto-calibrate baseline on the first valid Euler angle packet
  useEffect(() => {
    if (
      motion.euler &&
      (motion.euler.roll !== 0 || motion.euler.pitch !== 0) &&
      !hasAutoCalibratedRef.current &&
      ble.status === 'connected'
    ) {
      setCalibration(prev => ({
        ...prev,
        rollOffset: motion.euler.roll || 0,
        pitchOffset: motion.euler.pitch || 0,
        yawOffset: motion.euler.yaw || 0,
        isCalibrated: true,
      }));
      hasAutoCalibratedRef.current = true;
      console.log('[App] Auto-calibrated initial baseline to:', motion.euler);
    }
  }, [motion.euler, ble.status]);

  /**
   * onCalibrationApply — called by CalibrationPanel with the full computed
   * calibration object (offsets, signs, scales, Kalman params, etc.)
   */
  const onCalibrationApply = (newCalibration) => {
    setCalibration(prev => ({ ...prev, ...newCalibration }));
    console.log('[App] Calibration applied:', newCalibration);
  };


  return (
    <div className="app">
      {/* ── Header ─────────────────────────── */}
      <header className="app-header">
        <div className="app-header__brand">
          <div className="brand-logo" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="url(#lg)" strokeWidth="2.5" />
              <circle cx="16" cy="16" r="7" fill="url(#lg)" opacity=".9" />
              <circle cx="16" cy="9" r="2" fill="#fff" opacity=".6" />
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <h1 className="app-header__title">Thingy:52 Live</h1>
            <p className="app-header__subtitle">BLE Sensor Dashboard</p>
          </div>
        </div>

        <StatusBar
          status={ble.status}
          deviceName={ble.deviceName}
          battery={ble.battery}
        />
      </header>

      {/* ── Hero connect area ───────────────── */}
      {ble.status !== 'connected' && (
        <div className="hero-connect">
          <ConnectButton
            status={ble.status}
            onConnect={ble.connect}
            onDisconnect={ble.disconnect}
            error={ble.error}
          />
        </div>
      )}

      {/* ── Connected action bar ───────────── */}
      {ble.status === 'connected' && (
        <div className="action-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className={`btn-app-switch ${currentApp === 'dashboard' ? 'active' : ''}`}
              onClick={() => setCurrentApp('dashboard')}
            >
              📊 Sensor Dashboard
            </button>
            <button
              className={`btn-app-switch ${currentApp === 'moonlight' ? 'active' : ''}`}
              onClick={() => setCurrentApp('moonlight')}
            >
              🌙 Moonlight Ambient
            </button>
            <button
              className={`btn-app-switch ${currentApp === 'balls' ? 'active' : ''}`}
              onClick={() => setCurrentApp('balls')}
            >
              🔮 Metal Balls Tank
            </button>
            <button
              className={`btn-app-switch ${currentApp === 'wind' ? 'active' : ''}`}
              onClick={() => setCurrentApp('wind')}
            >
              🌬️ Wind Simulator
            </button>

            <button
              className={`btn-app-switch ${currentApp === 'windv2' ? 'active' : ''}`}
              onClick={() => setCurrentApp('windv2')}
            >
              🌬️ Wind Simulator v2
            </button>

            <button
              className={`btn-app-switch ${currentApp === 'paint' ? 'active' : ''}`}
              onClick={() => setCurrentApp('paint')}
            >
              🎨 Paint Canvas
            </button>

            <button
              className={`btn-app-switch ${currentApp === 'deepsea' ? 'active' : ''}`}
              onClick={() => setCurrentApp('deepsea')}
            >
              🌊 Deep Sea Explorer
            </button>
            <button
              className={`btn-app-switch ${currentApp === 'candle' ? 'active' : ''}`}
              onClick={() => setCurrentApp('candle')}
            >
              🕯️ Candle Blow
            </button>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(currentApp === 'moonlight' || currentApp === 'balls' || currentApp === 'wind' || currentApp === 'windv2' || currentApp === 'paint' || currentApp === 'deepsea' || currentApp === 'candle') && (
              <button
                className={`btn-app-switch ${isCalibrateOpen ? 'active' : ''}`}
                onClick={() => setIsCalibrateOpen(!isCalibrateOpen)}
                style={{
                  background: isCalibrateOpen ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.03)',
                  border: isCalibrateOpen ? '1px solid #818cf8' : '1px solid var(--glass-border)',
                }}
              >
                ⚙️ Calibration Settings
              </button>
            )}

            <ConnectButton
              status={ble.status}
              onConnect={ble.connect}
              onDisconnect={ble.disconnect}
              error={ble.error}
            />
          </div>
        </div>
      )}

      <main id="main-content" className="app-main">
        {currentApp === 'dashboard' && (
          <Dashboard
            env={env}
            motion={motion}
            sound={sound}
            ui={ui}
            status={ble.status}
          />
        )}
        {currentApp === 'moonlight' && (
          <MoonlightAmbient
            motion={motion}
            status={ble.status}
            calibration={calibration}
          />
        )}
        {currentApp === 'balls' && (
          <MetalBallsTank
            motion={motion}
            status={ble.status}
            calibration={calibration}
          />
        )}

        {currentApp === 'wind' && (
          <WindSimulator
            motion={motion}
            env={env}
            ui={ui}
            status={ble.status}
            calibration={calibration}
          />
        )}
        {currentApp === 'windv2' && (
          <WinsSimulatorv2
            motion={motion}
            env={env}
            ui={ui}
            status={ble.status}
            calibration={calibration}
          />
        )}
        {currentApp === 'paint' && (
          <PaintDripCanvas
            motion={motion}
            status={ble.status}
            calibration={calibration}
          />
        )}
        {currentApp === 'deepsea' && (
          <BioluminescentExplorer
            motion={motion}
            status={ble.status}
            calibration={calibration}
            env={env}
            sound={sound}
          />
        )}
        {currentApp === 'candle' && (
          <CandleSimulator
            motion={motion}
            env={env}
            status={ble.status}
            calibration={calibration}
          />
        )}
      </main>

      {/* ── Calibration Slide-Out Panel (CalibrationPanel component) ── */}
      {isCalibrateOpen && ble.status === 'connected' && (currentApp === 'moonlight' || currentApp === 'balls' || currentApp === 'wind' || currentApp === 'windv2' || currentApp === 'paint' || currentApp === 'deepsea' || currentApp === 'candle') && (
        <CalibrationPanel
          motion={motion}
          calibration={calibration}
          onApply={onCalibrationApply}
          onClose={() => setIsCalibrateOpen(false)}
        />
      )}

      {/* ── Footer ─────────────────────────── */}
      <footer className="app-footer">
        <p>Nordic Thingy:52 · Web Bluetooth API · Chrome / Edge only</p>
      </footer>
    </div>
  );
}
