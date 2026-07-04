/**
 * CalibrationPanel — Guided 5-pose IMU calibration with live sparkline telemetry.
 *
 * Flow: READY → NEUTRAL → LEFT → RIGHT → FORWARD → BACK → COMPLETE
 *
 * At each capture step:
 *   - User holds device in directed pose
 *   - 30 samples collected over 1.5 s (50 ms interval)
 *   - Mean computed per axis (bias removal from MPU-9250 calibration approach)
 *
 * After all 5 poses:
 *   - rollOffset / pitchOffset / yawOffset set to neutral position means
 *   - rollSign / pitchSign determined from left / forward pose delta directions
 *   - rollScale / pitchScale normalise expected ~45° tilt to unit
 */
import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Step Definitions ────────────────────────────────────────────────────────
const STEPS = [
  {
    id: 'ready',
    label: 'Start',
    emoji: '🎯',
    color: '#818cf8',
    title: 'Guided Calibration',
    instruction: "Walk through 5 directed poses. The app learns your device's orientation and axis directions. Hold each pose completely still when capturing.",
    canCapture: false,
  },
  {
    id: 'neutral',
    label: '⬛ Neutral',
    emoji: '⬛',
    color: '#94a3b8',
    title: 'NEUTRAL Position',
    instruction: 'Hold the device in exactly the position you normally use it. Do NOT tilt in any direction. This becomes your zero reference.',
    canCapture: true,
  },
  {
    id: 'left',
    label: '⬅ Left',
    emoji: '⬅️',
    color: '#38bdf8',
    title: 'Tilt LEFT',
    instruction: 'From neutral, tilt the device to the LEFT about 30–45°. Hold steady — this maps the left direction to a sensor axis.',
    canCapture: true,
  },
  {
    id: 'right',
    label: 'Right ➡',
    emoji: '➡️',
    color: '#f59e0b',
    title: 'Tilt RIGHT',
    instruction: 'From neutral, tilt the device to the RIGHT about 30–45°. This confirms the roll axis polarity.',
    canCapture: true,
  },
  {
    id: 'forward',
    label: '⬆ Fwd',
    emoji: '⬆️',
    color: '#34d399',
    title: 'Tilt FORWARD',
    instruction: 'From neutral, tilt the device FORWARD (screen away from you) about 30–45°. This maps the forward/pitch direction.',
    canCapture: true,
  },
  {
    id: 'back',
    label: 'Back ⬇',
    emoji: '⬇️',
    color: '#f87171',
    title: 'Tilt BACK',
    instruction: 'From neutral, tilt the device BACK (screen toward you) about 30–45°. This confirms the pitch axis polarity.',
    canCapture: true,
  },
  {
    id: 'complete',
    label: '✅ Done',
    emoji: '✅',
    color: '#34d399',
    title: 'Calibration Complete',
    instruction: 'All 5 poses captured. Review the computed axis mappings below, then apply.',
    canCapture: false,
  },
];

const N_CAPTURE    = 30;   // samples per pose
const CAPTURE_MS   = 50;   // 50 ms × 30 = 1.5 s total
const HISTORY_SIZE = 80;   // sparkline window (4 s @ 20 Hz)

// ─── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ data, width = 80, height = 28, color = '#818cf8' }) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2}
          stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      </svg>
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = (max - min) || 0.0001;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = 2 + ((max - v) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'hidden' }}>
      <defs>
        <linearGradient id={`sg-${color.replace('#','')}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
      </defs>
      <polyline
        points={pts}
        fill="none"
        stroke={`url(#sg-${color.replace('#','')})`}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Sensor Row ───────────────────────────────────────────────────────────────
function SensorRow({ label, value, unit, sparkData, color }) {
  const fmt = value !== null && value !== undefined
    ? Number(value).toFixed(2)
    : '---';
  return (
    <div className="sensor-row">
      <span className="sensor-row__label">{label}</span>
      <span className="sensor-row__value" style={{ color }}>
        {fmt}<em className="sensor-row__unit">{unit}</em>
      </span>
      <div className="sensor-row__spark">
        <Sparkline data={sparkData} color={color} width={78} height={26} />
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const m = (hex || '#818cf8').replace('#', '').match(/.{2}/g);
  if (!m) return '129,140,248';
  return m.map(x => parseInt(x, 16)).join(',');
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CalibrationPanel({ motion, calibration, onApply, onClose }) {
  const [step, setStep] = useState(0);
  const [capturedPoses, setCapturedPoses] = useState({});
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);

  // Always-fresh motion ref for use inside setInterval closures
  const motionRef         = useRef(motion);
  const captureIntervalRef = useRef(null);

  useEffect(() => { motionRef.current = motion; }, [motion]);

  // Append each new sensor reading to rolling history for sparklines
  useEffect(() => {
    if (!motion?.euler) return;
    setHistory(prev => [
      ...prev.slice(-(HISTORY_SIZE - 1)),
      {
        roll:  motion.euler.roll  ?? 0,
        pitch: motion.euler.pitch ?? 0,
        yaw:   motion.euler.yaw   ?? 0,
        ax:    motion.accel?.x    ?? 0,
        ay:    motion.accel?.y    ?? 0,
        az:    motion.accel?.z    ?? 0,
        gx:    motion.gyro?.x     ?? 0,
        gy:    motion.gyro?.y     ?? 0,
        gz:    motion.gyro?.z     ?? 0,
      },
    ]);
  }, [motion]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
  }, []);

  const hist = key => history.map(h => h[key]);

  // ─── Compute calibration from 5 captured poses ──────────────────────────
  const computeResult = useCallback((poses) => {
    const { neutral, left, forward } = poses;
    if (!neutral) return null;

    const rollOffset  = neutral.roll;
    const pitchOffset = neutral.pitch;
    const yawOffset   = neutral.yaw;

    // Determine if axes are swapped (landscape mode) based on LEFT pose
    const leftRollDelta  = left ? left.roll  - neutral.roll  : 0;
    const leftPitchDelta = left ? left.pitch - neutral.pitch : 0;
    
    // If pitch changed more than roll during a LEFT tilt, the axes are swapped physically
    const axisSwap = Math.abs(leftPitchDelta) > Math.abs(leftRollDelta);

    const rollSign = axisSwap
      ? (leftPitchDelta < 0 ? 1 : -1)
      : (leftRollDelta  < 0 ? 1 : -1);

    // Determine pitch axis polarity from FORWARD pose
    const fwdRollDelta  = forward ? forward.roll  - neutral.roll  : 0;
    const fwdPitchDelta = forward ? forward.pitch - neutral.pitch : 0;
    
    const pitchSign = axisSwap
      ? (fwdRollDelta > 0 ? 1 : -1)
      : (fwdPitchDelta > 0 ? 1 : -1);

    // Scale factors (normalise expected ~45° tilt)
    const leftMag  = Math.max(Math.abs(leftRollDelta), Math.abs(leftPitchDelta));
    const fwdMag   = Math.max(Math.abs(fwdRollDelta),  Math.abs(fwdPitchDelta));
    const rollScale  = leftMag  > 5 ? parseFloat((45 / leftMag).toFixed(3))  : 1.0;
    const pitchScale = fwdMag   > 5 ? parseFloat((45 / fwdMag).toFixed(3))   : 1.0;

    // --- NEW: True 3D Gravity Vector calibration ---
    // Instead of Euler angles (which suffer from Gimbal Lock near 90° pitch),
    // we capture the 3D delta between the neutral gravity vector and the left/forward gravity vectors.
    const vectorLeft = {
      x: left ? left.ax - neutral.ax : 1, // Fallbacks
      y: left ? left.ay - neutral.ay : 0,
      z: left ? left.az - neutral.az : 0
    };
    const vectorForward = {
      x: forward ? forward.ax - neutral.ax : 0,
      y: forward ? forward.ay - neutral.ay : 1,
      z: forward ? forward.az - neutral.az : 0
    };

    return {
      rollOffset,
      pitchOffset,
      yawOffset,
      rollSign,
      pitchSign,
      rollScale,
      pitchScale,
      accelOffsetX: neutral.ax,
      accelOffsetY: neutral.ay,
      accelOffsetZ: neutral.az,
      neutralQw: neutral.qw,
      neutralQx: neutral.qx,
      neutralQy: neutral.qy,
      neutralQz: neutral.qz,
      vectorLeft,
      vectorForward,
      sensitivity:  calibration?.sensitivity ?? 1.2,
      kalmanQ:      calibration?.kalmanQ     ?? 0.01,
      kalmanR:      calibration?.kalmanR     ?? 1.0,
      axisSwap,
      deadzone:     calibration?.deadzone    ?? 0.25,
      isCalibrated: true,
      isCalibrating: false,
      progress:     100,
    };
  }, [calibration]);

  // ─── Capture current pose ────────────────────────────────────────────────
  const startCapture = useCallback(() => {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);

    const samples = [];
    setIsCapturing(true);
    setCaptureProgress(0);

    captureIntervalRef.current = setInterval(() => {
      const m = motionRef.current;
      if (!m?.euler) return;

      samples.push({
        roll:  m.euler.roll  ?? 0,
        pitch: m.euler.pitch ?? 0,
        yaw:   m.euler.yaw   ?? 0,
        ax:    m.accel?.x    ?? 0,
        ay:    m.accel?.y    ?? 0,
        az:    m.accel?.z    ?? 0,
        qw:    m.quaternion?.w ?? 1,
        qx:    m.quaternion?.x ?? 0,
        qy:    m.quaternion?.y ?? 0,
        qz:    m.quaternion?.z ?? 0,
      });

      setCaptureProgress(Math.round((samples.length / N_CAPTURE) * 100));

      if (samples.length >= N_CAPTURE) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;

        const n   = samples.length;
        const mean = {
          roll:  samples.reduce((s, v) => s + v.roll,  0) / n,
          pitch: samples.reduce((s, v) => s + v.pitch, 0) / n,
          yaw:   samples.reduce((s, v) => s + v.yaw,   0) / n,
          ax:    samples.reduce((s, v) => s + v.ax,    0) / n,
          ay:    samples.reduce((s, v) => s + v.ay,    0) / n,
          az:    samples.reduce((s, v) => s + v.az,    0) / n,
          qw:    samples.reduce((s, v) => s + v.qw,    0) / n,
          qx:    samples.reduce((s, v) => s + v.qx,    0) / n,
          qy:    samples.reduce((s, v) => s + v.qy,    0) / n,
          qz:    samples.reduce((s, v) => s + v.qz,    0) / n,
        };

        // Normalize the averaged quaternion to ensure it remains a valid rotation
        const qNorm = Math.sqrt(mean.qw**2 + mean.qx**2 + mean.qy**2 + mean.qz**2) || 1;
        mean.qw /= qNorm;
        mean.qx /= qNorm;
        mean.qy /= qNorm;
        mean.qz /= qNorm;

        const poseId = STEPS[step].id;

        setCapturedPoses(prev => {
          const updated = { ...prev, [poseId]: mean };

          // After step 5 (back), compute full result
          if (step === 5) {
            const r = computeResult({ ...updated, back: mean });
            setResult(r);
            setStep(6);
          } else {
            setStep(s => s + 1);
          }
          return updated;
        });

        setIsCapturing(false);
        setCaptureProgress(100);
      }
    }, CAPTURE_MS);
  }, [step, computeResult]);

  const handleApply = () => {
    if (result) onApply(result);
  };

  const handleReset = () => {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    setStep(0);
    setCapturedPoses({});
    setIsCapturing(false);
    setCaptureProgress(0);
    setResult(null);
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  const currentStep   = STEPS[step];
  const capturedCount = Object.keys(capturedPoses).length;
  const live = {
    roll:  motion?.euler?.roll  ?? null,
    pitch: motion?.euler?.pitch ?? null,
    yaw:   motion?.euler?.yaw   ?? null,
    ax:    motion?.accel?.x     ?? null,
    ay:    motion?.accel?.y     ?? null,
    az:    motion?.accel?.z     ?? null,
    gx:    motion?.gyro?.x      ?? null,
    gy:    motion?.gyro?.y      ?? null,
    gz:    motion?.gyro?.z      ?? null,
  };

  return (
    <div className="cal-panel">

      {/* ── Header ── */}
      <div className="cal-panel__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#e2e8f0', flexShrink: 0 }}>
            ⚙️ Calibration
          </h3>
          {result ? (
            <span className="cal-status-badge cal-status-badge--ok">✓ Calibrated</span>
          ) : capturedCount > 0 ? (
            <span className="cal-status-badge cal-status-badge--warn">Step {capturedCount} / 5</span>
          ) : (
            <span className="cal-status-badge cal-status-badge--warn">⚠ Not Calibrated</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {step > 0 && (
            <button className="cal-text-btn" onClick={handleReset}>↺ Restart</button>
          )}
          <button className="cal-panel__close" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="cal-panel__content">

        {/* ── Step Guide Card ── */}
        <div
          className="cal-section cal-guide-section"
          style={{
            background: `rgba(${hexToRgb(currentStep.color)}, 0.07)`,
            borderColor: `rgba(${hexToRgb(currentStep.color)}, 0.25)`,
          }}
        >
          {/* Stepper dots (steps 1-5 only) */}
          {step >= 1 && step <= 6 && (
            <div className="cal-stepper">
              {STEPS.slice(1, 6).map((s, i) => {
                const idx = i + 1;
                const isDone   = capturedPoses[s.id] !== undefined;
                const isActive = idx === step;
                return (
                  <div
                    key={s.id}
                    className={`cal-stepper__dot ${isDone ? 'cal-stepper__dot--done' : isActive ? 'cal-stepper__dot--active' : 'cal-stepper__dot--idle'}`}
                    title={s.label}
                  >
                    {isDone ? '✓' : idx}
                  </div>
                );
              })}
              <div style={{ fontSize: '9px', color: '#475569', alignSelf: 'center', marginLeft: '4px' }}>
                {capturedCount} / 5
              </div>
            </div>
          )}

          {/* Direction Graphic */}
          <div className="cal-guide-graphic">
            <div className="cal-guide-graphic__emoji">{currentStep.emoji}</div>
            <div>
              <div style={{ color: currentStep.color, fontWeight: 700, fontSize: '13px', lineHeight: 1.2 }}>
                {currentStep.title}
              </div>
              {step >= 1 && step <= 5 && (
                <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>
                  Step {step} of 5
                </div>
              )}
            </div>
          </div>

          <p style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.55, margin: '8px 0 10px' }}>
            {currentStep.instruction}
          </p>

          {/* Action area */}
          {step === 0 && (
            <button
              className="cal-capture-btn"
              onClick={() => setStep(1)}
              style={{ borderColor: '#818cf8', background: 'rgba(129,140,248,0.2)', color: '#fff' }}
            >
              🚀 Start Guided Calibration
            </button>
          )}

          {step >= 1 && step <= 5 && (
            isCapturing ? (
              <div className="cal-progress-wrap" style={{ margin: 0 }}>
                <div
                  className="cal-progress-bar"
                  style={{
                    width: `${captureProgress}%`,
                    background: `linear-gradient(90deg, ${currentStep.color}, #06b6d4)`,
                  }}
                />
                <span className="cal-progress-label">Sampling… {captureProgress}%</span>
              </div>
            ) : (
              <button
                className="cal-capture-btn"
                onClick={startCapture}
                style={{
                  borderColor: currentStep.color,
                  background: `rgba(${hexToRgb(currentStep.color)}, 0.2)`,
                  color: '#fff',
                }}
              >
                📍 Capture — {currentStep.label}
              </button>
            )
          )}

          {step === 6 && result && (
            <button
              className="cal-capture-btn"
              onClick={handleApply}
              style={{ borderColor: '#34d399', background: 'rgba(52,211,153,0.2)', color: '#34d399', fontWeight: 700 }}
            >
              ✅ Apply Calibration to Apps
            </button>
          )}
        </div>

        {/* ── Live Sensor Telemetry with Sparklines ── */}
        <div className="cal-section">
          <h4>Live Telemetry</h4>

          <div className="sensor-group-label">EULER ANGLES</div>
          <SensorRow label="Roll"  value={live.roll}  unit="°" sparkData={hist('roll')}  color="#818cf8" />
          <SensorRow label="Pitch" value={live.pitch} unit="°" sparkData={hist('pitch')} color="#38bdf8" />
          <SensorRow label="Yaw"   value={live.yaw}   unit="°" sparkData={hist('yaw')}   color="#06b6d4" />

          <div className="sensor-group-label" style={{ marginTop: '10px' }}>ACCELEROMETER (g)</div>
          <SensorRow label="X" value={live.ax} unit="" sparkData={hist('ax')} color="#34d399" />
          <SensorRow label="Y" value={live.ay} unit="" sparkData={hist('ay')} color="#a3e635" />
          <SensorRow label="Z" value={live.az} unit="" sparkData={hist('az')} color="#4ade80" />

          <div className="sensor-group-label" style={{ marginTop: '10px' }}>GYROSCOPE (°/s)</div>
          <SensorRow label="X" value={live.gx} unit="" sparkData={hist('gx')} color="#fb923c" />
          <SensorRow label="Y" value={live.gy} unit="" sparkData={hist('gy')} color="#fbbf24" />
          <SensorRow label="Z" value={live.gz} unit="" sparkData={hist('gz')} color="#f59e0b" />
        </div>

        {/* ── Results Card (step 6 only) ── */}
        {step === 6 && result && (
          <div className="cal-section">
            <h4>Computed Axis Mapping</h4>

            <div className="cal-result-grid">
              <div className="cal-result-chip">
                <span>Roll Offset</span>
                <strong>{result.rollOffset.toFixed(1)}°</strong>
              </div>
              <div className="cal-result-chip">
                <span>Pitch Offset</span>
                <strong>{result.pitchOffset.toFixed(1)}°</strong>
              </div>
              <div className="cal-result-chip">
                <span>Yaw Offset</span>
                <strong>{result.yawOffset.toFixed(1)}°</strong>
              </div>
              <div className="cal-result-chip" style={{ borderColor: 'rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.06)' }}>
                <span>← Roll Sign</span>
                <strong style={{ color: '#38bdf8' }}>{result.rollSign > 0 ? '+1' : '−1'}</strong>
              </div>
              <div className="cal-result-chip" style={{ borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.06)' }}>
                <span>↕ Pitch Sign</span>
                <strong style={{ color: '#34d399' }}>{result.pitchSign > 0 ? '+1' : '−1'}</strong>
              </div>
              <div className="cal-result-chip" style={{ borderColor: 'rgba(251,146,60,0.3)', background: 'rgba(251,146,60,0.06)' }}>
                <span>Roll Scale</span>
                <strong style={{ color: '#fb923c' }}>{result.rollScale}×</strong>
              </div>
            </div>

            {/* Captured pose summary table */}
            <div className="cal-pose-table">
              <div className="cal-pose-table__header">
                <span>Pose</span><span>Roll</span><span>Pitch</span><span>Yaw</span>
              </div>
              {STEPS.slice(1, 6).map(s => {
                const pose = capturedPoses[s.id];
                return (
                  <div key={s.id} className="cal-pose-table__row" style={{ borderColor: `rgba(${hexToRgb(s.color)}, 0.15)` }}>
                    <span style={{ color: s.color }}>{s.emoji} {s.id}</span>
                    <span>{pose ? pose.roll.toFixed(1) + '°'  : '—'}</span>
                    <span>{pose ? pose.pitch.toFixed(1) + '°' : '—'}</span>
                    <span>{pose ? pose.yaw.toFixed(1) + '°'   : '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Kalman Filter Tuning — always visible ── */}
        <div className="cal-section">
          <h4>Kalman Filter</h4>
          <div className="cal-control">
            <label>
              <span>Process Noise Q <em>(↓ smoother)</em></span>
              <strong>{(calibration?.kalmanQ ?? 0.01).toFixed(3)}</strong>
            </label>
            <input
              type="range" min="0.001" max="0.1" step="0.001"
              value={calibration?.kalmanQ ?? 0.01}
              onChange={e => onApply({ ...(calibration ?? {}), kalmanQ: parseFloat(e.target.value) })}
            />
          </div>
          <div className="cal-control">
            <label>
              <span>Measurement Noise R <em>(↑ smoother)</em></span>
              <strong>{(calibration?.kalmanR ?? 1.0).toFixed(1)}</strong>
            </label>
            <input
              type="range" min="0.1" max="10" step="0.1"
              value={calibration?.kalmanR ?? 1.0}
              onChange={e => onApply({ ...(calibration ?? {}), kalmanR: parseFloat(e.target.value) })}
            />
          </div>
          <div className="cal-control">
            <label>
              <span>Sensitivity</span>
              <strong>{(calibration?.sensitivity ?? 1.2).toFixed(2)}×</strong>
            </label>
            <input
              type="range" min="0.2" max="3.0" step="0.1"
              value={calibration?.sensitivity ?? 1.2}
              onChange={e => onApply({ ...(calibration ?? {}), sensitivity: parseFloat(e.target.value) })}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
