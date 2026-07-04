import { useState, useEffect, useRef, useMemo } from 'react';
import { KalmanFilter } from '../utils/kalmanFilter';
import { getCalibratedForces } from '../utils/calibrationUtils';
import { DEFAULT_CALIBRATION } from '../utils/constants';

// Neon paint colors
const PAINT_COLORS = [
  { name: 'Cyber Pink', hex: '#ff007f' },
  { name: 'Acid Green', hex: '#39ff14' },
  { name: 'Laser Blue', hex: '#00f0ff' },
  { name: 'Neon Purple', hex: '#9d00ff' },
  { name: 'Solar Yellow', hex: '#ffff00' },
  { name: 'Sunset Orange', hex: '#ff5f00' },
  { name: 'Ghost White', hex: '#f8fafc' },
  { name: 'Eraser', hex: 'erase' }
];

export default function PaintDripCanvas({ motion, status, calibration }) {
  const isConnected = status === 'connected';
  const { accel, gyro } = motion || {};

  // Component States
  const [activeColor, setActiveColor] = useState('#ff007f');
  const [viscosity, setViscosity] = useState(0.4); // 0 = runs fast, 1 = solid
  const [dripWidth, setDripWidth] = useState(8);
  const [gravityScale, setGravityScale] = useState(2.2);
  const [shakeSensitivity, setShakeSensitivity] = useState(14.0); // Threshold for G-force delta
  const [isAutoPour, setIsAutoPour] = useState(true);
  const [isSplatterEnabled, setIsSplatterEnabled] = useState(true);

  // Manual tilt controls (joystick mouse simulation)
  const [manualTilt, setManualTilt] = useState({ x: 0, y: 1.0 }); // Default gravity pulls down
  const [isDraggingJoystick, setIsDraggingJoystick] = useState(false);

  // Canvas References
  const canvasRef = useRef(null);
  const paintCanvasRef = useRef(null); // Offscreen persistent painting buffer
  const dripsRef = useRef([]);
  const animationFrameRef = useRef(null);

  // Kalman Filter setup for accelerometer
  const kxRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));
  const kyRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));
  const kzRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));

  // Accel tracking for shake detection
  const lastAccelRef = useRef({ x: 0, y: 0, z: 9.8 });
  const lastShakeTimeRef = useRef(0);
  const [liveMetrics, setLiveMetrics] = useState({
    gravityX: 0,
    gravityY: 0,
    shakeDelta: 0,
    activeDrips: 0,
  });

  // Synthesize wet splat sound for splatters
  const playSplatSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const duration = 0.12 + Math.random() * 0.08;
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      // Low frequency rumble noise with filter sweep
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        // Low-pass filter noise
        data[i] = 0.88 * lastOut + 0.12 * white;
        lastOut = data[i];

        // Splat popping sounds
        if (Math.random() < 0.008) {
          data[i] += (Math.random() * 2 - 1) * 0.45;
        }
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(600, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + duration);
      filter.Q.value = 1.8;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.002, ctx.currentTime + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start();
    } catch (_) {}
  };

  // Sync canvas size on mount / resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;

      // Offscreen canvas setup
      if (!paintCanvasRef.current) {
        paintCanvasRef.current = document.createElement('canvas');
      }
      const pCanvas = paintCanvasRef.current;
      const pCtx = pCanvas.getContext('2d');
      
      // Save current artwork
      const tempImg = pCtx.getImageData(0, 0, pCanvas.width, pCanvas.height);
      pCanvas.width = rect.width;
      pCanvas.height = rect.height;
      
      // Clear persistent canvas to dark background
      pCtx.fillStyle = '#0f172a';
      pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);
      pCtx.putImageData(tempImg, 0, 0);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Shake gesture detection
  useEffect(() => {
    if (!isConnected || !accel || accel.x === null) return;

    // Filter accelerometer axes
    const fx = kxRef.current.filter(accel.x);
    const fy = kyRef.current.filter(accel.y);
    const fz = kzRef.current.filter(accel.z);

    const prev = lastAccelRef.current;
    const deltaX = Math.abs(fx - prev.x);
    const deltaY = Math.abs(fy - prev.y);
    const deltaZ = Math.abs(fz - prev.z);
    const totalDelta = deltaX + deltaY + deltaZ;

    lastAccelRef.current = { x: fx, y: fy, z: fz };

    // Vigorously shaking triggers splatter
    if (totalDelta > shakeSensitivity && isSplatterEnabled) {
      const now = Date.now();
      if (now - lastShakeTimeRef.current > 380) { // Throttle splatters
        lastShakeTimeRef.current = now;
        triggerSplatter(totalDelta);
      }
    }
  }, [accel, isConnected, shakeSensitivity, isSplatterEnabled]);

  // Trigger Splatter particles
  const triggerSplatter = (magnitude) => {
    playSplatSound();

    const pCanvas = paintCanvasRef.current;
    if (!pCanvas) return;
    const pCtx = pCanvas.getContext('2d');

    const sprayCount = Math.floor(magnitude * 2.8) + 12;
    const activeDrips = dripsRef.current.filter(d => d.active);

    for (let i = 0; i < sprayCount; i++) {
      // Direct splatters around active paint streams or randomly on canvas
      let cx = Math.random() * pCanvas.width;
      let cy = Math.random() * pCanvas.height;

      if (activeDrips.length > 0 && Math.random() < 0.85) {
        const source = activeDrips[Math.floor(Math.random() * activeDrips.length)];
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (magnitude * 15.0);
        cx = source.x + Math.cos(angle) * radius;
        cy = source.y + Math.sin(angle) * radius;
      }

      const radius = Math.random() * 4.5 + 1.2;
      const splatterColor = activeColor === 'erase' ? '#0f172a' : activeColor;

      // Draw shiny droplet head on offscreen buffer
      pCtx.beginPath();
      pCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      pCtx.fillStyle = splatterColor;
      pCtx.fill();

      // Soft reflection shine
      if (activeColor !== 'erase') {
        const gradient = pCtx.createRadialGradient(
          cx - radius / 3, cy - radius / 3, radius * 0.1,
          cx, cy, radius
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
        gradient.addColorStop(0.3, splatterColor);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
        pCtx.fillStyle = gradient;
        pCtx.beginPath();
        pCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        pCtx.fill();
      }
    }
  };

  // Add paint drip node
  const addDrip = (x, y, forcedColor = null) => {
    const widthVal = Math.random() * (dripWidth * 0.6) + (dripWidth * 0.4) + 2.5;
    const colorVal = forcedColor || activeColor;

    dripsRef.current.push({
      x,
      y,
      vx: 0,
      vy: 0,
      color: colorVal,
      width: widthVal,
      active: true,
      viscosity: Math.random() * (viscosity * 0.3) + (viscosity * 0.7),
      length: 0,
    });
  };

  // Canvas Mouse / Touch drawing pour trigger
  const handleCanvasInteraction = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    // Support mouse drag / click and touch
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    addDrip(x, y);
  };

  // Auto-pour drips generator
  const triggerAutoPour = () => {
    const canvas = canvasRef.current;
    if (!canvas || !isAutoPour) return;

    // Spawns drips randomly along edges based on gravity tilt direction
    const rate = 0.08;
    if (Math.random() < rate) {
      const g = getGravityVector();
      let rx = Math.random() * canvas.width;
      let ry = Math.random() * canvas.height;

      // Determine starting edge based on gravity slant
      if (Math.abs(g.y) > Math.abs(g.x)) {
        ry = g.y >= 0 ? 0 : canvas.height; // Pour from top if tilting down
      } else {
        rx = g.x >= 0 ? 0 : canvas.width;  // Pour from left if tilting right
      }

      // Pick a random vibrant neon color from palette (except erase)
      const nonEraseColors = PAINT_COLORS.filter(c => c.hex !== 'erase');
      const randomColor = nonEraseColors[Math.floor(Math.random() * nonEraseColors.length)].hex;
      addDrip(rx, ry, randomColor);
    }
  };

  // Obtain current gravity steering direction (BLE sensors or manual joystick)
  const getGravityVector = () => {
    if (isConnected && accel && accel.x !== null) {
      const fx = kxRef.current.filter(accel.x);
      const fy = kyRef.current.filter(accel.y);

      // Extract calibrated and mapped forces using common formula
      const forces = getCalibratedForces(fx, fy, 0, calibration);

      // Map to 2D vector coordinates
      const gx = forces.cx * 0.9;
      const gy = forces.cy * 0.9;

      return { x: gx * gravityScale, y: gy * gravityScale };
    }

    // Emulated manual joystick vector
    return { x: manualTilt.x * gravityScale * 1.5, y: manualTilt.y * gravityScale * 1.5 };
  };

  // Main physics loop (runs on requestAnimationFrame)
  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current;
      const pCanvas = paintCanvasRef.current;
      if (!canvas || !pCanvas) {
        animationFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      const ctx = canvas.getContext('2d');
      const pCtx = pCanvas.getContext('2d');

      // Clear visible canvas overlay
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Step 1: Draw persistent trails offscreen background
      ctx.drawImage(pCanvas, 0, 0);

      // Get gravity force
      const g = getGravityVector();

      // Gyro swirl factor
      const rollRate = isConnected && gyro?.z ? (gyro.z * 0.001) : 0;

      // Auto-pour spawn helper
      triggerAutoPour();

      // Update drips physics and draw trails
      const drips = dripsRef.current;
      let activeCount = 0;

      for (let i = 0; i < drips.length; i++) {
        const drip = drips[i];
        if (!drip.active) continue;

        activeCount++;

        // Save old position
        const oldX = drip.x;
        const oldY = drip.y;

        // Gravity pulls on fluid, slowed down by viscosity
        const flowFactor = (1.0 - drip.viscosity) * 0.85;
        drip.vx = drip.vx * 0.9 + g.x * flowFactor;
        drip.vy = drip.vy * 0.9 + g.y * flowFactor;

        // Gyroscopic rotation swerve rate
        if (rollRate !== 0) {
          const rx = -drip.vy * rollRate * 1.5;
          const ry = drip.vx * rollRate * 1.5;
          drip.vx += rx;
          drip.vy += ry;
        }

        // Wobble random walk to make paint look natural
        const wobbleX = (Math.random() - 0.5) * (0.6 + (1 - viscosity) * 0.9);
        const wobbleY = (Math.random() - 0.5) * (0.6 + (1 - viscosity) * 0.9);

        drip.x += drip.vx + wobbleX;
        drip.y += drip.vy + wobbleY;
        drip.length += Math.sqrt(drip.vx * drip.vx + drip.vy * drip.vy);

        // Dry out slowly as paint trails down
        drip.width *= 0.995 - (drip.viscosity * 0.002);
        if (drip.width < 0.6 || drip.length > 1200) {
          drip.active = false;
        }

        // Bounds safety
        if (drip.x < -20 || drip.x > canvas.width + 20 || drip.y < -20 || drip.y > canvas.height + 20) {
          drip.active = false;
        }

        // Draw permanent trail on offscreen buffer
        pCtx.strokeStyle = drip.color === 'erase' ? '#0f172a' : drip.color;
        pCtx.lineWidth = drip.width;
        pCtx.lineCap = 'round';
        pCtx.lineJoin = 'round';
        pCtx.beginPath();
        pCtx.moveTo(oldX, oldY);
        pCtx.lineTo(drip.x, drip.y);
        pCtx.stroke();

        // Draw the wet glossy liquid droplet head at current position
        if (drip.color !== 'erase') {
          const r = drip.width * 0.9 + 2.0;
          ctx.beginPath();
          ctx.arc(drip.x, drip.y, r, 0, Math.PI * 2);
          ctx.fillStyle = drip.color;
          ctx.fill();

          // Shiny highlights
          const radial = ctx.createRadialGradient(
            drip.x - r / 3.2, drip.y - r / 3.2, r * 0.08,
            drip.x, drip.y, r
          );
          radial.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
          radial.addColorStop(0.3, drip.color);
          radial.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
          ctx.fillStyle = radial;
          ctx.beginPath();
          ctx.arc(drip.x, drip.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Update HUD metrics at 5Hz to avoid locking thread
      if (Math.random() < 0.12) {
        setLiveMetrics({
          gravityX: g.x,
          gravityY: g.y,
          activeDrips: activeCount,
          shakeDelta: Math.abs(g.x) + Math.abs(g.y),
        });
      }

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [manualTilt, gravityScale, viscosity, dripWidth, isAutoPour, activeColor, isConnected]);

  // Clear Canvas and active streams
  const handleClear = () => {
    dripsRef.current = [];
    const pCanvas = paintCanvasRef.current;
    if (pCanvas) {
      const pCtx = pCanvas.getContext('2d');
      pCtx.fillStyle = '#0f172a';
      pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);
    }
  };

  // Export Paint Art to PNG Download
  const handleExport = () => {
    const pCanvas = paintCanvasRef.current;
    if (!pCanvas) return;
    const dataUrl = pCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'thingy52-drip-art.png';
    link.href = dataUrl;
    link.click();
  };

  // Emulated Joystick logic
  const handleJoystickStart = (e) => {
    setIsDraggingJoystick(true);
    handleJoystickMove(e);
  };

  const handleJoystickMove = (e) => {
    if (!isDraggingJoystick && e.type !== 'touchstart' && e.type !== 'mousedown') return;
    const element = e.currentTarget;
    const rect = element.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const jCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const dx = clientX - jCenter.x;
    const dy = clientY - jCenter.y;
    const distance = Math.min(rect.width / 2, Math.sqrt(dx * dx + dy * dy));
    const angle = Math.atan2(dy, dx);

    const normX = (Math.cos(angle) * distance) / (rect.width / 2);
    const normY = (Math.sin(angle) * distance) / (rect.height / 2);

    setManualTilt({ x: normX, y: normY });
  };

  const handleJoystickEnd = () => {
    setIsDraggingJoystick(false);
    // Snap back gravity to pulling down slightly
    setManualTilt({ x: 0, y: 1.0 });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        gap: 'var(--space-3)',
      }}
    >
      {/* Upper Status Banner */}
      <div
        className="glass-card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(15, 23, 42, 0.65)',
        }}
      >
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: '800', margin: 0, color: '#ff007f', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🎨</span> Virtual Paint Drip Canvas
          </h2>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
            {isConnected
              ? 'Tilt your Thingy:52 to guide paint drips. Vigorously shake the sensor to spray paint splatters!'
              : 'Click & drag the canvas to pour paint. Use the bottom-left joystick to steer gravity tilt!'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={() => setIsAutoPour(prev => !prev)}
            style={{
              background: isAutoPour ? 'rgba(57, 255, 20, 0.15)' : 'rgba(255,255,255,0.03)',
              border: isAutoPour ? '1px solid #39ff14' : '1px solid var(--glass-border)',
              color: isAutoPour ? '#39ff14' : '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            {isAutoPour ? '🌧️ Auto-Pour: On' : '🛑 Auto-Pour: Off'}
          </button>

          <button
            onClick={handleClear}
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              color: '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            🗑️ Clear Canvas
          </button>

          <button
            onClick={handleExport}
            style={{
              background: 'rgba(14, 165, 233, 0.15)',
              border: '1px solid #0ea5e9',
              color: '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            📥 Export PNG
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--glass-border)', background: '#0f172a' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasInteraction}
          onMouseMove={(e) => e.buttons === 1 && handleCanvasInteraction(e)}
          onTouchStart={handleCanvasInteraction}
          onTouchMove={handleCanvasInteraction}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair', touchAction: 'none' }}
        />

        {/* Overlay Telemetry HUD (Bottom-Left) */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {/* Joystick Emulation (Only active when dragging or sensor disconnected) */}
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid var(--glass-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
              cursor: 'grab',
              touchAction: 'none',
            }}
            onMouseDown={handleJoystickStart}
            onMouseMove={handleJoystickMove}
            onMouseUp={handleJoystickEnd}
            onMouseLeave={handleJoystickEnd}
            onTouchStart={handleJoystickStart}
            onTouchMove={handleJoystickMove}
            onTouchEnd={handleJoystickEnd}
          >
            {/* Inner joystick knob */}
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: isConnected ? '#39ff14' : '#ff007f',
                boxShadow: isConnected ? '0 0 10px #39ff14' : '0 0 10px #ff007f',
                transform: `translate(${manualTilt.x * 24}px, ${manualTilt.y * 24}px)`,
                transition: isDraggingJoystick ? 'none' : 'transform 0.15s ease-out',
              }}
            />
          </div>

          {/* Core HUD diagnostics */}
          <div
            style={{
              background: 'rgba(7, 11, 20, 0.85)',
              border: '1px solid var(--glass-border)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              width: '180px',
              color: '#fff',
              fontSize: '10px',
            }}
          >
            <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '3px', marginBottom: '3px' }}>
              📊 TELEMETRY WIDGET
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Drip Count:</span>
              <span style={{ fontFamily: 'monospace', color: '#ff007f', fontWeight: 'bold' }}>{liveMetrics.activeDrips}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Gravity Tilt:</span>
              <span style={{ fontFamily: 'monospace', color: '#39ff14' }}>
                X:{liveMetrics.gravityX.toFixed(1)} Y:{liveMetrics.gravityY.toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sensor Link:</span>
              <span style={{ color: isConnected ? '#39ff14' : '#f97316', fontWeight: 'bold' }}>
                {isConnected ? '🔗 Nordic BLE' : '💻 Emulated'}
              </span>
            </div>
            {/* Shaking splatter preview simulation trigger */}
            <button
              onClick={() => triggerSplatter(18)}
              style={{
                pointerEvents: 'auto',
                marginTop: '4px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--glass-border)',
                color: '#fff',
                padding: '2px',
                borderRadius: '3px',
                fontSize: '9px',
                cursor: 'pointer',
              }}
            >
              💥 Trigger Splatter (Shake)
            </button>
          </div>
        </div>

        {/* Floating Right HUD controls */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            background: 'rgba(7, 11, 20, 0.85)',
            border: '1px solid var(--glass-border)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'auto',
            width: '280px',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            zIndex: 10,
            color: '#fff',
          }}
        >
          {/* Neon Palette Picking Grid */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>🌈 CHOOSE PAINT COLOR</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
              {PAINT_COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setActiveColor(c.hex)}
                  style={{
                    background: c.hex === 'erase' ? 'repeating-conic-gradient(#555 0% 25%, #222 0% 50%) 50% / 8px 8px' : c.hex,
                    border: activeColor === c.hex ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px',
                    height: '24px',
                    cursor: 'pointer',
                    outline: activeColor === c.hex ? '2px solid #ff007f' : 'none',
                    title: c.name,
                  }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Drip settings sliders */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>💧 Fluid Viscosity (Stickiness)</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{(viscosity * 100).toFixed(0)}%</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={viscosity}
                onChange={(e) => setViscosity(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#ff007f', cursor: 'pointer' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>📏 Paint Stream Thickness</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{dripWidth}px</span>
              </label>
              <input
                type="range"
                min="3"
                max="24"
                step="1"
                value={dripWidth}
                onChange={(e) => setDripWidth(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#39ff14', cursor: 'pointer' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>🌌 Gravity Pull Scale</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{gravityScale.toFixed(1)}x</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.1"
                value={gravityScale}
                onChange={(e) => setGravityScale(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#0ea5e9', cursor: 'pointer' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>💥 Shake Splatter G-Force</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{shakeSensitivity.toFixed(1)}G</span>
              </label>
              <input
                type="range"
                min="6.0"
                max="25.0"
                step="0.5"
                value={shakeSensitivity}
                onChange={(e) => setShakeSensitivity(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#e11d48', cursor: 'pointer' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
