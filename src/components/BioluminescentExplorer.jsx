import { useState, useEffect, useRef } from 'react';
import { KalmanFilter } from '../utils/kalmanFilter';
import { getCalibratedForces } from '../utils/calibrationUtils';
import { DEFAULT_CALIBRATION } from '../utils/constants';

// Bioluminescent color palettes
const PALETTES = {
  calm: {
    jelly: 'rgba(0, 240, 255, 0.45)', // Cyan
    jellyCore: '#00ffff',
    tentacle: 'rgba(56, 189, 248, 0.35)',
    particles: 'rgba(0, 255, 200, 0.6)',
  },
  alert: {
    jelly: 'rgba(239, 68, 68, 0.6)', // Red
    jellyCore: '#f87171',
    tentacle: 'rgba(248, 113, 113, 0.45)',
    particles: 'rgba(251, 146, 60, 0.7)',
  }
};

export default function BioluminescentExplorer({ motion, status, calibration, env, sound }) {
  const isConnected = status === 'connected';
  const { accel } = motion || {};
  const { spl: sensorSpl } = sound || {};

  // Interactive configurations
  const [creatureLimit, setCreatureLimit] = useState(12);
  const [soundThreshold, setSoundThreshold] = useState(65); // dB SPL. Quiet (< 65dB) = emergence, Loud (> 65dB) = scare/hide
  const [currentStrength, setCurrentStrength] = useState(1.8);
  const [alertDuration, setAlertDuration] = useState(2500); // How long creatures stay alert after being startled

  // Fallback emulated states
  const [manualNoiseLevel, setManualNoiseLevel] = useState(42); // 30 dB to 100 dB SPL
  const [manualTilt, setManualTilt] = useState({ x: 0, y: 0 });
  const [isDraggingJoystick, setIsDraggingJoystick] = useState(false);

  const soundRef = useRef(sensorSpl);
  const accelRef = useRef(accel);

  // Sync references to bypass state closure staleness inside requestAnimationFrame loop
  useEffect(() => {
    soundRef.current = sensorSpl;
  }, [sensorSpl]);

  useEffect(() => {
    accelRef.current = accel;
  }, [accel]);

  const stopListeningRef = useRef(sound?.stopListening);
  useEffect(() => {
    stopListeningRef.current = sound?.stopListening;
  }, [sound?.stopListening]);

  // Auto-start the microphone sensor when the Deep Sea Explorer is active
  useEffect(() => {
    if (isConnected && sound?.startListening) {
      console.log('[BioluminescentExplorer] Automatically starting microphone sensor...');
      sound.startListening().catch(e => console.error('[BioluminescentExplorer] Failed to auto-start microphone:', e));
    }
  }, [isConnected, sound?.startListening]);

  // Clean up microphone sensor ONLY on actual unmount
  useEffect(() => {
    return () => {
      if (stopListeningRef.current) {
        console.log('[BioluminescentExplorer] Stopping microphone sensor on unmount...');
        stopListeningRef.current().catch(e => console.warn('[BioluminescentExplorer] Failed to stop microphone:', e));
      }
    };
  }, []);

  // Core Animation References
  const canvasRef = useRef(null);
  const creaturesRef = useRef([]);
  const bubblesRef = useRef([]);
  const animationFrameRef = useRef(null);

  // Kalman filtering for accelerometer
  const kxRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));
  const kyRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));
  const kzRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));

  // Alert/flee states
  const [isAlertActive, setIsAlertActive] = useState(false);
  const lastAccelRef = useRef({ x: 0, y: 0, z: 9.8 });
  const alertTimeoutRef = useRef(null);

  // Metrics for HUD
  const [hudMetrics, setHudMetrics] = useState({
    sound: 0,
    currentX: 0,
    currentY: 0,
    accelDelta: 0,
    activeCount: 0,
  });

  // Synthesize bubbly deep sea sound on alert/shake
  const playScareSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      // Spawn 3 rapid ascending bubbly notes
      const now = ctx.currentTime;
      [110, 165, 240].forEach((freq, idx) => {
        const timeOffset = idx * 0.07;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Sine wave for bubble pop tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + timeOffset);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.8, now + timeOffset + 0.12);

        gain.gain.setValueAtTime(0.12, now + timeOffset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + timeOffset + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + timeOffset);
        osc.stop(now + timeOffset + 0.18);
      });
    } catch (_) {}
  };

  // Sync canvas bounds on mount and resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Determine microphone sound levels (dB SPL)
  const getSoundLevel = () => {
    const s = soundRef.current;
    if (isConnected && s !== null && s !== undefined) {
      return s; // decibels (dB SPL)
    }
    return manualNoiseLevel;
  };

  // Shake/Scare detection
  useEffect(() => {
    if (!isConnected || !accel || accel.x === null) return;

    // Filter accelerometer inputs
    const fx = kxRef.current.filter(accel.x);
    const fy = kyRef.current.filter(accel.y);
    const fz = kzRef.current.filter(accel.z);

    const prev = lastAccelRef.current;
    const deltaX = Math.abs(fx - prev.x);
    const deltaY = Math.abs(fy - prev.y);
    const deltaZ = Math.abs(fz - prev.z);
    const totalDelta = deltaX + deltaY + deltaZ;

    lastAccelRef.current = { x: fx, y: fy, z: fz };

    // Sudden G-Force changes scare the creatures
    if (totalDelta > 13.5 && !isAlertActiveRef.current) {
      triggerScare(totalDelta);
    }
  }, [accel, isConnected]);

  const isAlertActiveRef = useRef(false);

  const triggerScare = (magnitude = 15) => {
    isAlertActiveRef.current = true;
    setIsAlertActive(true);
    playScareSound();

    // Scare all organisms
    creaturesRef.current.forEach(c => {
      c.alert = true;
      c.alertProgress = 1.0;
      
      // Dart rapidly away in a random direction
      const angle = Math.random() * Math.PI * 2;
      const speed = 6.8 + Math.random() * 4.5;
      c.vx = Math.cos(angle) * speed;
      c.vy = Math.sin(angle) * speed;

      // Spawn extra panic bubbles
      for (let j = 0; j < 8; j++) {
        bubblesRef.current.push({
          x: c.x,
          y: c.y,
          vx: (Math.random() - 0.5) * 4.0,
          vy: -Math.random() * 2.5 - 1.0,
          radius: Math.random() * 3.5 + 1.2,
          opacity: 0.9,
          color: PALETTES.alert.particles,
        });
      }
    });

    // Clear previous timeout and schedule calm reset
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
    alertTimeoutRef.current = setTimeout(() => {
      setIsAlertActive(false);
      isAlertActiveRef.current = false;
      creaturesRef.current.forEach(c => {
        c.alert = false;
      });
    }, alertDuration);
  };

  const getCurrentVector = () => {
    const acc = accelRef.current;
    if (isConnected && acc && acc.x !== null) {
      const fx = kxRef.current.filter(acc.x);
      const fy = kyRef.current.filter(acc.y);

      // Extract calibrated and mapped forces using common formula
      const forces = getCalibratedForces(fx, fy, 0, calibration);

      // Map to 2D current forces
      const cx = forces.cx * 0.45;
      const cy = forces.cy * 0.45;

      return { x: cx * currentStrength, y: cy * currentStrength };
    }

    return { x: manualTilt.x * currentStrength * 2.2, y: manualTilt.y * currentStrength * 2.2 };
  };

  // Setup organisms array
  const initCreature = (canvasWidth, canvasHeight) => {
    const isJelly = Math.random() < 0.65;
    return {
      x: Math.random() * canvasWidth,
      y: Math.random() * canvasHeight,
      vx: (Math.random() - 0.5) * 1.2,
      vy: (Math.random() - 0.5) * 1.2,
      radius: Math.random() * 24 + 14,
      pulseSpeed: 0.02 + Math.random() * 0.025,
      pulsePhase: Math.random() * Math.PI * 2,
      isJelly,
      opacity: 0,
      alert: false,
      alertProgress: 0,
      tentaclePhase: Math.random() * 100,
    };
  };

  // Core physics & graphics loop
  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;

      // Draw dark deep-sea gradient background
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#020617'); // Dark slate/navy
      grad.addColorStop(1, '#0b1329');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Get sound level and current vector
      const soundLevel = getSoundLevel();
      const current = getCurrentVector();

      // Mappings: quietness -> creatures emerge.
      // If soundLevel < soundThreshold, creatures emerge. The quieter it is, the more visible they are.
      const quietRange = Math.max(10, soundThreshold - 30);
      const maxVisibility = soundLevel < soundThreshold
        ? Math.max(0, Math.min(1.0, (soundThreshold - soundLevel) / quietRange))
        : 0;

      // Trigger scare if sound level exceeds the threshold
      if (soundLevel >= soundThreshold && !isAlertActiveRef.current) {
        isAlertActiveRef.current = true;
        setTimeout(() => {
          triggerScare(soundLevel);
        }, 0);
      }

      // Manage creature count up to limit
      let creatures = creaturesRef.current;
      if (maxVisibility > 0.05 && creatures.length < creatureLimit) {
        if (Math.random() < 0.04) {
          creatures.push(initCreature(w, h));
        }
      }

      // ─── 1. Draw Background Ambient Plankton Sparks ───
      if (maxVisibility > 0.1) {
        ctx.save();
        for (let i = 0; i < 40; i++) {
          const px = (Math.sin(Date.now() * 0.0002 + i) * 0.5 + 0.5) * w;
          const py = ((Date.now() * 0.015 + i * 45) % h);
          const r = Math.max(0.5, (Math.sin(Date.now() * 0.002 + i) * 0.5 + 0.5) * 2.2);
          
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fillStyle = isAlertActive ? PALETTES.alert.particles : PALETTES.calm.particles;
          ctx.shadowBlur = r * 3;
          ctx.shadowColor = isAlertActive ? PALETTES.alert.jellyCore : PALETTES.calm.jellyCore;
          ctx.fill();
        }
        ctx.restore();
      }

      // ─── 2. Draw Bubbles ───
      const bubbles = bubblesRef.current;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.x += b.vx + current.x * 0.3;
        b.y += b.vy + current.y * 0.3;
        b.opacity -= 0.012;

        if (b.opacity <= 0 || b.x < 0 || b.x > w || b.y < 0) {
          bubbles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.strokeStyle = b.color || 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // ─── 3. Draw Deep Sea Bioluminescent Organisms ───
      let activeCount = 0;
      for (let i = creatures.length - 1; i >= 0; i--) {
        const c = creatures[i];

        // Decaying opacity based on light coverage
        c.opacity = c.opacity * 0.95 + maxVisibility * 0.05;

        // If light is bright and opacity drops near 0, delete it
        if (c.opacity < 0.008 && maxVisibility < 0.05) {
          creatures.splice(i, 1);
          continue;
        }

        activeCount++;

        // Smooth state transition between calm and alert alertProgress
        c.alertProgress = c.alertProgress * 0.94 + (c.alert ? 1.0 : 0.0) * 0.06;

        // Animate pulse cycle
        c.pulsePhase += c.pulseSpeed * (c.alert ? 2.5 : 1.0);
        const pulse = Math.sin(c.pulsePhase) * 0.15 + 0.85; // 0.7 to 1.0 range

        // Currents drag organisms
        c.vx = c.vx * 0.96 + current.x * 0.04;
        c.vy = c.vy * 0.96 + current.y * 0.04;

        // Organism autonomous movements
        if (!c.alert) {
          const swimAngle = c.pulsePhase * 0.5;
          // Jellyfish pulse-propel in waves
          const push = Math.max(0, Math.sin(c.pulsePhase)) * 0.45;
          c.vx += Math.cos(swimAngle) * 0.05 + push * 0.03 * current.x;
          c.vy += Math.sin(swimAngle) * 0.05 - push * 0.25; // float gently upwards
        }

        c.x += c.vx;
        c.y += c.vy;

        // Wrap-around bounds safety
        if (c.x < -c.radius * 2) c.x = w + c.radius;
        if (c.x > w + c.radius * 2) c.x = -c.radius;
        if (c.y < -c.radius * 2) c.y = h + c.radius;
        if (c.y > h + c.radius * 2) c.y = -c.radius;

        // Spawn trailing bubbles occasionally
        if (Math.random() < 0.03) {
          bubbles.push({
            x: c.x,
            y: c.y + c.radius * 0.6,
            vx: (Math.random() - 0.5) * 1.5,
            vy: Math.random() * 0.5 + 0.4,
            radius: Math.random() * 2.5 + 0.8,
            opacity: 0.8,
            color: c.alertProgress > 0.5 ? PALETTES.alert.tentacle : PALETTES.calm.tentacle,
          });
        }

        // Draw organism
        ctx.save();
        ctx.shadowBlur = c.radius * 0.8 * pulse * c.opacity;
        ctx.shadowColor = THREE.MathUtils.lerp(0.0, 1.0, c.alertProgress) > 0.5 
          ? PALETTES.alert.jellyCore 
          : PALETTES.calm.jellyCore;

        const bodyColor = `rgba(${Math.round(THREE.MathUtils.lerp(0, 239, c.alertProgress))}, ${Math.round(THREE.MathUtils.lerp(240, 68, c.alertProgress))}, ${Math.round(THREE.MathUtils.lerp(255, 68, c.alertProgress))}, ${0.5 * c.opacity})`;
        const coreColor = `rgba(${Math.round(THREE.MathUtils.lerp(0, 248, c.alertProgress))}, ${Math.round(THREE.MathUtils.lerp(255, 113, c.alertProgress))}, ${Math.round(THREE.MathUtils.lerp(255, 113, c.alertProgress))}, ${0.9 * c.opacity})`;
        const tentacleColor = `rgba(${Math.round(THREE.MathUtils.lerp(56, 248, c.alertProgress))}, ${Math.round(THREE.MathUtils.lerp(189, 113, c.alertProgress))}, ${Math.round(THREE.MathUtils.lerp(248, 113, c.alertProgress))}, ${0.3 * c.opacity})`;

        if (c.isJelly) {
          // --- Draw Jellyfish Cap ---
          ctx.beginPath();
          // Draw bell shape
          ctx.arc(c.x, c.y, c.radius * pulse, Math.PI, 0, false);
          ctx.bezierCurveTo(
            c.x + c.radius * 0.8 * pulse, c.y + c.radius * 0.3 * pulse,
            c.x - c.radius * 0.8 * pulse, c.y + c.radius * 0.3 * pulse,
            c.x - c.radius * pulse, c.y
          );
          ctx.fillStyle = bodyColor;
          ctx.fill();

          // Draw Glowing Core
          ctx.beginPath();
          ctx.arc(c.x, c.y - c.radius * 0.25 * pulse, c.radius * 0.28 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = coreColor;
          ctx.fill();

          // --- Draw Wavy Tentacles ---
          c.tentaclePhase += 0.08;
          ctx.strokeStyle = tentacleColor;
          ctx.lineWidth = 1.8 * pulse;
          ctx.lineCap = 'round';

          const tentacleCount = 4;
          for (let j = 0; j < tentacleCount; j++) {
            const tx = c.x - c.radius * 0.4 + (j * (c.radius * 0.8 / (tentacleCount - 1)));
            const ty = c.y + c.radius * 0.15;

            ctx.beginPath();
            ctx.moveTo(tx, ty);
            
            // Draw multi-segment waving curve
            const segmentCount = 3;
            let sx = tx;
            let sy = ty;
            for (let k = 1; k <= segmentCount; k++) {
              const length = c.radius * 0.7 * k;
              const angleOffset = Math.sin(c.tentaclePhase + k * 1.2 + j * 0.5) * 0.18 * pulse;
              const nex = sx + Math.sin(angleOffset) * length * 0.4;
              const ney = sy + length * 0.35;
              ctx.quadraticCurveTo(sx + Math.sin(angleOffset) * length * 0.1, sy + length * 0.18, nex, ney);
              sx = nex;
              sy = ney;
            }
            ctx.stroke();
          }
        } else {
          // --- Draw Glowing Bioluminescent Squid ---
          ctx.beginPath();
          // Draw cone body
          ctx.moveTo(c.x, c.y - c.radius * pulse);
          ctx.lineTo(c.x + c.radius * 0.45 * pulse, c.y + c.radius * 0.35 * pulse);
          ctx.lineTo(c.x - c.radius * 0.45 * pulse, c.y + c.radius * 0.35 * pulse);
          ctx.closePath();
          ctx.fillStyle = bodyColor;
          ctx.fill();

          // Draw head eyes
          ctx.beginPath();
          ctx.arc(c.x - c.radius * 0.18, c.y + c.radius * 0.18, c.radius * 0.12 * pulse, 0, Math.PI * 2);
          ctx.arc(c.x + c.radius * 0.18, c.y + c.radius * 0.18, c.radius * 0.12 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = coreColor;
          ctx.fill();

          // Draw waving squid tentacles
          c.tentaclePhase += 0.08;
          ctx.strokeStyle = tentacleColor;
          ctx.lineWidth = 2 * pulse;
          const sCount = 5;
          for (let j = 0; j < sCount; j++) {
            const tx = c.x - c.radius * 0.3 + (j * (c.radius * 0.6 / (sCount - 1)));
            const ty = c.y + c.radius * 0.35;
            const sineWave = Math.sin(c.tentaclePhase + j * 0.8) * 12 * pulse;

            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.bezierCurveTo(
              tx + sineWave * 0.5, ty + c.radius * 0.4,
              tx + sineWave, ty + c.radius * 0.8,
              tx + sineWave * 0.8, ty + c.radius * 1.3
            );
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // Throttle React state HUD updates at 6Hz
      if (Math.random() < 0.1) {
        setHudMetrics({
          sound: Math.round(soundLevel),
          currentX: current.x,
          currentY: current.y,
          accelDelta: isAlertActive ? 18.0 : 0.0,
          activeCount: activeCount,
        });
      }

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [manualNoiseLevel, manualTilt, currentStrength, creatureLimit, soundThreshold, isConnected, isAlertActive]);

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
    setManualTilt({ x: 0, y: 0 }); // Drift currents neutral on snapback
  };

  const handleClearCreatures = () => {
    creaturesRef.current = [];
  };

  const handleCalibrateQuiet = () => {
    const currentNoise = soundRef.current;
    if (isConnected && currentNoise !== null && currentNoise !== undefined) {
      const newThreshold = Math.round(currentNoise + 10);
      setSoundThreshold(newThreshold);
    } else {
      setSoundThreshold(60);
    }
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
      {/* Upper Glassmorphism Header */}
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
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: '800', margin: 0, color: '#00ffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🌊</span> Bioluminescent Deep Sea Explorer
          </h2>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
            {isConnected
              ? 'When it is quiet, bioluminescent creatures emerge. Speak, clap, or make noise to scare them away!'
              : 'Use the Noise Level slider below to simulate sounds, and drag the joystick to guide current flow!'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={() => triggerScare(20)}
            style={{
              background: 'rgba(239, 68, 68, 0.18)',
              border: '1px solid #ef4444',
              color: '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            💥 Trigger Scare (Shake)
          </button>
          
          <button
            onClick={handleClearCreatures}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--glass-border)',
              color: '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            🗑️ Reset Aquarium
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--glass-border)', background: '#020617' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        />

        {/* Alert Haze Overlay (When creatures are scared/alert) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            boxShadow: isAlertActive ? 'inset 0 0 80px rgba(239, 68, 68, 0.28)' : 'none',
            pointerEvents: 'none',
            transition: 'box-shadow 0.2s ease-out',
            zIndex: 2,
          }}
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
          {/* Joystick Emulation for Current steering */}
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
                background: isAlertActive ? '#ef4444' : '#00ffff',
                boxShadow: isAlertActive ? '0 0 10px #ef4444' : '0 0 10px #00ffff',
                transform: `translate(${manualTilt.x * 24}px, ${manualTilt.y * 24}px)`,
                transition: isDraggingJoystick ? 'none' : 'transform 0.15s ease-out',
              }}
            />
          </div>

          {/* Diagnostics Panel */}
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
              width: '190px',
              color: '#fff',
              fontSize: '10px',
            }}
          >
            <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '3px', marginBottom: '3px' }}>
              📊 ECOSYSTEM TELEMETRY
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sound Level:</span>
              <span style={{ fontFamily: 'monospace', color: hudMetrics.sound < soundThreshold ? '#39ff14' : '#ef4444', fontWeight: 'bold' }}>
                {hudMetrics.sound} dB ({hudMetrics.sound < soundThreshold ? 'QUIET' : 'NOISY'})
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Current Current:</span>
              <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>
                X:{hudMetrics.currentX.toFixed(1)} Y:{hudMetrics.currentY.toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Threat Level:</span>
              <span style={{ color: isAlertActive ? '#ef4444' : '#00ffff', fontWeight: 'bold' }}>
                {isAlertActive ? '🚨 FLEEING' : '🟢 CALM'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Creature Count:</span>
              <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>{hudMetrics.activeCount} / {creatureLimit}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Link Mode:</span>
              <span style={{ color: isConnected ? '#39ff14' : '#f97316', fontWeight: 'bold' }}>
                {isConnected ? '🔗 Nordic BLE' : '💻 Emulated'}
              </span>
            </div>
          </div>
        </div>

        {/* Floating Right HUD Settings */}
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
          {/* Ambient sound manual simulator slider (Only visible when disconnected) */}
          {!isConnected && (
            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span>🔊 Emulated Noise Level</span>
                <span style={{ color: '#00ffff', fontFamily: 'monospace', fontWeight: 'bold' }}>{manualNoiseLevel} dB</span>
              </label>
              <input
                type="range"
                min="30"
                max="100"
                value={manualNoiseLevel}
                onChange={(e) => setManualNoiseLevel(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#00ffff', cursor: 'pointer' }}
              />
            </div>
          )}

          {/* General configurations */}
          <div style={{ borderTop: !isConnected ? '1px solid rgba(255,255,255,0.08)' : 'none', paddingTop: !isConnected ? '4px' : '0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>🧬 Max Aquarium Population</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{creatureLimit} organisms</span>
              </label>
              <input
                type="range"
                min="5"
                max="25"
                step="1"
                value={creatureLimit}
                onChange={(e) => setCreatureLimit(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#a78bfa', cursor: 'pointer' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>💧 Flow Current Speed</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{currentStrength.toFixed(1)}x</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="4.0"
                step="0.1"
                value={currentStrength}
                onChange={(e) => setCurrentStrength(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#60a5fa', cursor: 'pointer' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span>🎙️ Sound Trigger Cutoff</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{soundThreshold} dB</span>
              </label>
              <input
                type="range"
                min="35"
                max="95"
                step="1"
                value={soundThreshold}
                onChange={(e) => setSoundThreshold(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#39ff14', cursor: 'pointer', marginBottom: '4px' }}
              />
              {isConnected && (
                <button
                  onClick={handleCalibrateQuiet}
                  style={{
                    width: '100%',
                    background: 'rgba(57, 255, 20, 0.12)',
                    border: '1px solid #39ff14',
                    color: '#39ff14',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '9px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    marginTop: '2px',
                    textAlign: 'center',
                  }}
                >
                  🎙️ Calibrate Quiet Baseline (Keep room quiet!)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
