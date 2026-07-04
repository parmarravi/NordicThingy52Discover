import { useState, useEffect } from 'react';
import SensorCard from './SensorCard';
import OrientationCube from './OrientationCube';
import SpeakerControl from './SpeakerControl';
import GravityGraph from './GravityGraph';
import MicGraph, { pushMicHistory } from './MicGraph';

/**
 * Dashboard — responsive grid of all sensor cards + orientation visualiser.
 */
export default function Dashboard({ env, motion, sound, ui, status }) {
  const isConnected = status === 'connected';
  const loading = status === 'connecting';

  const {
    temperature, tempHistory,
    pressure, pressHistory,
    humidity, humHistory,
    airQuality, eco2History, tvocHistory,
    color, isColorActive, startColor, stopColor,
  } = env;

  const { euler, accel, gyro, compass, orientation, gravityHistory } = motion;
  const { spl, isListening, startListening, stopListening, playTone, playSample } = sound || {};

  const [syncLed, setSyncLed] = useState(false);
  const [activeLedColor, setActiveLedColor] = useState('rgb(0, 240, 240)');
  const [splHistory, setSplHistory] = useState([]);
  const [lightHistory, setLightHistory] = useState([]);

  // Auto-push new light intensity (Clear channel) values into history
  useEffect(() => {
    if (color && color.c !== undefined && isColorActive) {
      setLightHistory(prev => {
        const next = [...prev, color.c];
        if (next.length > 20) next.shift();
        return next;
      });
    } else if (!isColorActive) {
      setLightHistory([]);
    }
  }, [color, isColorActive]);

  // Auto-push new SPL readings into rolling history when mic is active
  useEffect(() => {
    if (spl !== null && spl !== undefined && isListening) {
      setSplHistory(prev => pushMicHistory(prev, spl));
    }
    if (!isListening) {
      setSplHistory([]);
    }
  }, [spl, isListening]);


  // parseColor now returns normalized 0-255 values, so use r/g/b directly
  const getRgbString = (cVal) => {
    if (!cVal) return 'rgba(255, 255, 255, 0.1)';
    return `rgb(${cVal.r}, ${cVal.g}, ${cVal.b})`;
  };


  // Sync physical LED with color sensor readings when enabled
  useEffect(() => {
    if (color) {
      setActiveLedColor(getRgbString(color));
      if (syncLed && ui?.writeLedConstant) {
        ui.writeLedConstant(color.r, color.g, color.b);
      }
    }
  }, [color, syncLed, ui]);


  // Calculate normalized compass heading
  const headingRaw = compass?.x !== null ? Math.atan2(compass.y, compass.x) * (180 / Math.PI) : 0;
  const heading = headingRaw < 0 ? Math.round(headingRaw + 360) : Math.round(headingRaw);
  
  const getDirectionLabel = (h) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(h / 45) % 8;
    return dirs[index];
  };
  const direction = getDirectionLabel(heading);

  const getOrientationText = (code) => {
    if (code === 0) return 'Portrait';
    if (code === 1) return 'Landscape';
    if (code === 2) return 'Reverse Portrait';
    if (code === 3) return 'Reverse Landscape';
    return 'Waiting...';
  };

  const colorIcon = color ? (
    <span
      className="color-preview-bubble"
      style={{
        display: 'inline-block',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        backgroundColor: getRgbString(color),
        border: '2px solid rgba(255, 255, 255, 0.3)',
        boxShadow: `0 0 8px ${getRgbString(color)}`,
        verticalAlign: 'middle',
      }}
    />
  ) : '🎨';

  return (
    <div className="dashboard">

      {/* ── Environment ─────────────────────────────────────── */}
      <section className="dashboard__section" aria-labelledby="env-heading">
        <h2 id="env-heading" className="dashboard__section-title">
          <span aria-hidden="true">🌡️</span> Environment
        </h2>
        <div className="dashboard__grid">

          <SensorCard
            icon="🌡️"
            label="Temperature"
            value={temperature}
            unit="°C"
            color="#ff6b6b"
            history={tempHistory}
            loading={loading}
          />

          <SensorCard
            icon="💧"
            label="Humidity"
            value={humidity}
            unit="%"
            color="#4dadf7"
            history={humHistory}
            loading={loading}
          />

          <SensorCard
            icon="🌬️"
            label="Pressure"
            value={pressure}
            unit="hPa"
            color="#a78bfa"
            history={pressHistory}
            loading={loading}
          />

          <SensorCard
            icon="💨"
            label="Air Quality"
            value={airQuality?.eco2 ?? null}
            unit="ppm eCO₂"
            color="#f59e0b"
            history={eco2History}
            loading={loading}
            subValues={[
              { label: 'eCO₂', value: airQuality?.eco2,  unit: 'ppm' },
              { label: 'TVOC', value: airQuality?.tvoc, unit: 'ppb' },
            ]}
          />
          <SensorCard
            icon="💡"
            label="Light Intensity"
            value={isColorActive ? (color ? color.c : 'Waiting...') : 'Sensor Disabled'}
            unit=" Clear"
            color="#fbbf24"
            history={lightHistory}
            loading={loading}
          >
            {isConnected && (
              <button
                className={`btn-action ${isColorActive ? 'btn-action--active' : ''}`}
                onClick={isColorActive ? stopColor : startColor}
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: isColorActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(251, 191, 36, 0.2)',
                  border: `1px solid ${isColorActive ? 'rgb(239, 68, 68)' : 'rgb(251, 191, 36)'}`,
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: '600',
                  transition: 'all 0.2s',
                  fontSize: 'var(--text-xs)',
                }}
              >
                {isColorActive ? '🛑 Stop Light Sensor' : '💡 Start Light Sensor'}
              </button>
            )}
          </SensorCard>

          <SensorCard
            icon={colorIcon}
            label="Color Sensor"
            value={isColorActive ? (color ? `RGB(${color.r}, ${color.g}, ${color.b})` : 'Waiting...') : 'Sensor Disabled'}
            unit=""
            color={color ? getRgbString(color) : '#10b981'}
            loading={loading}
            subValues={[
              { label: 'Red', value: color?.r, unit: '' },
              { label: 'Green', value: color?.g, unit: '' },
              { label: 'Blue', value: color?.b, unit: '' },
              { label: 'Clear', value: color?.c, unit: '' },
            ]}
          >
            {isConnected && (
              <button
                id="toggle-color-btn"
                className={`btn-action ${isColorActive ? 'btn-action--active' : ''}`}
                onClick={isColorActive ? stopColor : startColor}
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: isColorActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                  border: `1px solid ${isColorActive ? 'rgb(239, 68, 68)' : 'rgb(16, 185, 129)'}`,
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: '600',
                  transition: 'all 0.2s',
                  fontSize: 'var(--text-xs)',
                }}
              >
                {isColorActive ? '🛑 Stop Color Scanning' : '🎨 Start Color Scanning'}
              </button>
            )}
          </SensorCard>

          <SensorCard
            icon="💡"
            label="LED Controller"
            value={isConnected ? 'LED Connected' : 'Sensor Disabled'}
            unit=""
            color="#ec4899"
            loading={loading}
          >
            {isConnected && (
              <div className="led-controls" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
                {/* Preset colors */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {[
                    { name: 'Off', color: '#1e293b', r: 0, g: 0, b: 0 },
                    { name: 'Red', color: '#ef4444', r: 255, g: 0, b: 0 },
                    { name: 'Green', color: '#10b981', r: 0, g: 255, b: 0 },
                    { name: 'Blue', color: '#3b82f6', r: 0, g: 0, b: 255 },
                    { name: 'Purple', color: '#8b5cf6', r: 139, g: 92, b: 246 },
                    { name: 'Yellow', color: '#eab308', r: 255, g: 255, b: 0 },
                    { name: 'Cyan', color: '#06b6d4', r: 0, g: 255, b: 255 },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => {
                        setSyncLed(false); // Disable auto-sync on manual override
                        if (preset.r === 0 && preset.g === 0 && preset.b === 0) {
                          ui?.turnLedOff();
                          setActiveLedColor('rgba(255, 255, 255, 0.1)');
                        } else {
                          ui?.writeLedConstant(preset.r, preset.g, preset.b);
                          setActiveLedColor(preset.color);
                        }
                      }}
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: preset.color === '#1e293b' ? 'transparent' : preset.color,
                        border: '1.5px solid rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={preset.name}
                      aria-label={`Set LED to ${preset.name}`}
                    >
                      {preset.name === 'Off' && <span style={{ fontSize: '10px', color: '#fff' }}>✕</span>}
                    </button>
                  ))}
                </div>

                {/* Custom Color Picker */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                  <label htmlFor="custom-led-picker" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Custom:</label>
                  <input
                    id="custom-led-picker"
                    type="color"
                    defaultValue="#ec4899"
                    onChange={(e) => {
                      setSyncLed(false);
                      const hex = e.target.value;
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      ui?.writeLedConstant(r, g, b);
                      setActiveLedColor(hex);
                    }}
                    style={{
                      border: 'none',
                      width: '44px',
                      height: '24px',
                      background: 'none',
                      cursor: 'pointer',
                    }}
                  />
                </div>

                {/* Sync Checkbox */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', cursor: 'pointer', marginTop: 'var(--space-1)', color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={syncLed}
                    onChange={(e) => setSyncLed(e.target.checked)}
                  />
                  <span>Sync with Sensed Color</span>
                </label>
              </div>
            )}
          </SensorCard>

        </div>
      </section>

      {/* ── Motion & Orientation ──────────────────────────────── */}
      <section className="dashboard__section" aria-labelledby="motion-heading">
        <h2 id="motion-heading" className="dashboard__section-title">
          <span aria-hidden="true">🏃</span> Motion & Orientation
        </h2>
        <div className="dashboard__grid dashboard__grid--motion">

          {/* 3D Visualizer (interacts with physical Thingy:52) */}
          <div className="sensor-card sensor-card--span-2" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h3 className="control-title" style={{ marginBottom: 'var(--space-4)' }}>3D View (Live Device Visualizer)</h3>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
              <OrientationCube euler={euler} ledColor={activeLedColor} />
            </div>
            <div className="euler-readout" style={{ marginTop: 'var(--space-4)' }}>
              <div className="euler-item">
                <span className="euler-label">Roll</span>
                <span className="euler-value">{euler?.roll?.toFixed(0)}°</span>
              </div>
              <div className="euler-item">
                <span className="euler-label">Pitch</span>
                <span className="euler-value">{euler?.pitch?.toFixed(0)}°</span>
              </div>
              <div className="euler-item">
                <span className="euler-label">Yaw</span>
                <span className="euler-value">{euler?.yaw?.toFixed(0)}°</span>
              </div>
            </div>
          </div>

          {/* Motion View (Direction, Orientation, Heading) */}
          <SensorCard
            icon="🧭"
            label="Motion View"
            value={isConnected ? `${heading}° ${direction}` : 'Sensor Disabled'}
            unit=""
            color="#38bdf8"
            loading={loading}
          >
            {isConnected && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', width: '100%' }}>
                {/* Rotating Compass Needle Dial */}
                <div style={{
                  position: 'relative',
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.2)',
                }}>
                  {/* Compass needle pointer */}
                  <div style={{
                    position: 'absolute',
                    width: '4px',
                    height: '56px',
                    background: 'linear-gradient(to bottom, #ef4444 50%, #cbd5e1 50%)',
                    borderRadius: '2px',
                    transform: `rotate(${-heading}deg)`,
                    transition: 'transform 80ms linear',
                  }} />
                  <span style={{ position: 'absolute', top: '4px', fontSize: '9px', fontWeight: 'bold', color: '#ef4444' }}>N</span>
                  <span style={{ position: 'absolute', bottom: '4px', fontSize: '9px', fontWeight: 'bold', color: '#94a3b8' }}>S</span>
                  <span style={{ position: 'absolute', right: '6px', fontSize: '9px', fontWeight: 'bold', color: '#94a3b8' }}>E</span>
                  <span style={{ position: 'absolute', left: '6px', fontSize: '9px', fontWeight: 'bold', color: '#94a3b8' }}>W</span>
                </div>
                
                {/* Orientation readouts */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', borderTop: '1px solid var(--glass-border)', paddingTop: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Orientation:</span>
                    <span style={{ fontWeight: '700', color: '#38bdf8' }}>{getOrientationText(orientation)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Heading Direction:</span>
                    <span style={{ fontWeight: '700', color: '#38bdf8' }}>{direction} ({heading}°)</span>
                  </div>
                </div>
              </div>
            )}
          </SensorCard>

          {/* Gravity Vector Graph (Rolling plot of acceleration) */}
          <div className="sensor-card sensor-card--span-2" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="sensor-card__header">
              <span className="sensor-card__icon" aria-hidden="true">📊</span>
              <span className="sensor-card__label">Gravity Vector Graph</span>
            </div>
            <div className="sensor-card__body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {loading ? (
                <div className="sensor-card__skeleton" style={{ height: '120px' }} />
              ) : isConnected ? (
                <>
                  <GravityGraph history={gravityHistory} height={120} />
                  {/* Legend/Vector readouts */}
                  <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 'var(--text-xs)', borderTop: '1px solid var(--glass-border)', paddingTop: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                    <span style={{ color: '#ef4444', fontWeight: '600' }}>X (Roll): {accel?.x !== null ? accel.x.toFixed(2) : '—'} m/s²</span>
                    <span style={{ color: '#10b981', fontWeight: '600' }}>Y (Pitch): {accel?.y !== null ? accel.y.toFixed(2) : '—'} m/s²</span>
                    <span style={{ color: '#3b82f6', fontWeight: '600' }}>Z (Yaw): {accel?.z !== null ? accel.z.toFixed(2) : '—'} m/s²</span>
                  </div>
                </>
              ) : (
                <div className="sensor-card__waiting">Waiting for connection...</div>
              )}
            </div>
          </div>

          <SensorCard
            icon="📈"
            label="Accelerometer"
            value={accel?.x !== null ? Math.sqrt(accel.x*accel.x + accel.y*accel.y + accel.z*accel.z) : null}
            unit="m/s²"
            color="#34d399"
            loading={loading}
            subValues={[
              { label: 'X Axis', value: accel?.x, unit: '' },
              { label: 'Y Axis', value: accel?.y, unit: '' },
              { label: 'Z Axis', value: accel?.z, unit: '' },
            ]}
          />

          <SensorCard
            icon="🔄"
            label="Gyroscope"
            value={gyro?.x !== null ? Math.sqrt(gyro.x*gyro.x + gyro.y*gyro.y + gyro.z*gyro.z) : null}
            unit="°/s"
            color="#60a5fa"
            loading={loading}
            subValues={[
              { label: 'X Axis', value: gyro?.x, unit: '' },
              { label: 'Y Axis', value: gyro?.y, unit: '' },
              { label: 'Z Axis', value: gyro?.z, unit: '' },
            ]}
          />

          <SensorCard
            icon="🧭"
            label="Compass"
            value={compass?.x !== null ? Math.sqrt(compass.x*compass.x + compass.y*compass.y + compass.z*compass.z) : null}
            unit="μT"
            color="#f472b6"
            loading={loading}
            subValues={[
              { label: 'X Axis', value: compass?.x, unit: '' },
              { label: 'Y Axis', value: compass?.y, unit: '' },
              { label: 'Z Axis', value: compass?.z, unit: '' },
            ]}
          />

        </div>
      </section>

      {/* ── Audio & Speaker ─────────────────────────────────── */}
      <section className="dashboard__section" aria-labelledby="audio-heading">
        <h2 id="audio-heading" className="dashboard__section-title">
          <span aria-hidden="true">🔊</span> Audio Control & Microphone
        </h2>
        <div className="dashboard__grid dashboard__grid--audio">
          
          {/* Microphone SPL */}
          <SensorCard
            icon="🎙️"
            label="Microphone Noise"
            value={isListening ? (spl !== null ? spl : 'Starting...') : 'Sensor Disabled'}
            unit={isListening && spl !== null ? 'dB' : ''}
            color="#f43f5e"
            loading={loading}
          >
            {isConnected && (
              <button
                id="toggle-mic-btn"
                className={`btn-action ${isListening ? 'btn-action--active' : ''}`}
                onClick={isListening ? stopListening : startListening}
                style={{
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background: isListening ? 'rgba(239, 68, 68, 0.2)' : 'rgba(244, 63, 94, 0.2)',
                  border: `1px solid ${isListening ? 'rgb(239, 68, 68)' : 'rgb(244, 63, 94)'}`,
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: '600',
                  transition: 'all 0.2s',
                  fontSize: 'var(--text-xs)',
                }}
              >
                {isListening ? '🛑 Stop Mic Listening' : '🎙️ Start Mic Listening'}
              </button>
            )}
          </SensorCard>

          {/* Speaker Control */}
          <SpeakerControl
            playTone={playTone}
            playSample={playSample}
            disabled={!isConnected}
          />

        </div>

        {/* Mic SPL History Graph */}
        {isListening && (
          <div style={{ marginTop: 'var(--space-3)', padding: '0 var(--space-1)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f43f5e', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite' }} />
              SPL History — last {splHistory.length} burst samples (1 per second)
            </div>
            <MicGraph history={splHistory} height={140} />
          </div>
        )}
      </section>

      {/* Idle state */}
      {!isConnected && !loading && (
        <div className="dashboard__idle" role="status">
          <div className="idle-icon" aria-hidden="true">📡</div>
          <p>Connect your Thingy:52 to start streaming sensor data</p>
        </div>
      )}
    </div>
  );
}
