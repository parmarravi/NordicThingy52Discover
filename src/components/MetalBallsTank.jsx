import { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Physics, RigidBody, BallCollider, useRapier } from '@react-three/rapier';
import { KalmanFilter } from '../utils/kalmanFilter';
import { getCalibratedForces } from '../utils/calibrationUtils';
import { METAL_BALLS_CONFIG, PHYSICS_CONSTANTS } from '../utils/constants';

/**
 * GravityController — A non-rendering component inside the canvas
 * that reads the Kalman-filtered accelerometer value and updates the Rapier simulation
 * gravity vector dynamically every frame.
 */
function GravityController({ motion, baseline, calibration, setLiveGravity }) {
  // Three independent Kalman filters — one per accelerometer axis
  const kxRef = useRef(null);
  const kyRef = useRef(null);
  const kzRef = useRef(null);

  const { world } = useRapier();
  const lastStateUpdateRef = useRef(0);

  const kalmanQ = calibration?.kalmanQ ?? 0.01;
  const kalmanR = calibration?.kalmanR ?? 1.0;

  // Recreate filters when tuning params change (from calibration panel)
  useEffect(() => {
    kxRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
    kyRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
    kzRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
  }, [kalmanQ, kalmanR]);

  // Ensure filters exist on very first render (before useEffect fires)
  if (!kxRef.current) {
    kxRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
    kyRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
    kzRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
  }

  useFrame(() => {
    if (motion?.quaternion && world) {
      // Calculate perfect relative local forces based on Quaternions
      const rawForces = getCalibratedForces(motion, calibration, baseline);
      
      // Apply Kalman filter to the final forces for ultra-smooth rendering
      const cx = kxRef.current.filter(rawForces.cx);
      const cy = kyRef.current.filter(rawForces.cy);
      
      const forces = { cx, cy, cz: 0 };

      // Map filtered coordinates to gravity with sign and scale correction
      // We scale down the forces because euler angles can generate large numbers compared to raw gravity
      const gx = forces.cx * (METAL_BALLS_CONFIG.gravityScale * 0.15);
      const gz = forces.cy * (METAL_BALLS_CONFIG.gravityScale * 0.15);
      const gy = (forces.cz - PHYSICS_CONSTANTS.GRAVITY) * METAL_BALLS_CONFIG.gravityScale;

      // Direct WebAssembly updates at 60fps (does not trigger React re-renders)
      world.gravity.x = gx;
      world.gravity.y = gy;
      world.gravity.z = gz;

      // Throttle React state updates to 5Hz to keep numbers on UI updated without locking the main thread
      const now = Date.now();
      if (now - lastStateUpdateRef.current > 200) {
        lastStateUpdateRef.current = now;
        setLiveGravity([gx, gy, gz]);
      }
    }
  });

  return null;
}

/**
 * MetalBallsTank — Main component rendering the transparent glass tank and steel balls.
 */
export default function MetalBallsTank({ motion, status, calibration }) {
  const isConnected = status === 'connected';
  const { accel } = motion || {};
  const [baseline, setBaseline] = useState(null);
  const [liveGravity, setLiveGravity] = useState([0, -9.81, 0]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);

  const tankWrapperRef = useRef(null);

  // Generate steel ball bearings with randomized starting offsets
  const balls = useRef(
    Array.from({ length: METAL_BALLS_CONFIG.numBalls }).map((_, i) => ({
      id: i,
      position: [
        (Math.random() - 0.5) * 2.2, // x between -1.1 and 1.1
        0.8 + Math.random() * 1.8,    // y between 0.8 and 2.6
        (Math.random() - 0.5) * 2.2, // z between -1.1 and 1.1
      ],
      radius: METAL_BALLS_CONFIG.ball.radiusMin + Math.random() * METAL_BALLS_CONFIG.ball.radiusVariance,
    }))
  );

  // Auto-calibrate baseline on the very first sensor reading that arrives
  const hasAutoCalibrated = useRef(false);
  useEffect(() => {
    if (accel && accel.x !== null && !hasAutoCalibrated.current) {
      setBaseline({ x: accel.x, y: accel.y, z: accel.z });
      hasAutoCalibrated.current = true;
      console.log('[MetalBallsTank] Auto-calibrated initial baseline:', accel);
    }
  }, [accel]);

  // Sync React state if the user exits fullscreen using the 'ESC' key natively
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === tankWrapperRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle Fullscreen Toggle
  const toggleFullscreen = () => {
    if (!tankWrapperRef.current) return;

    if (!document.fullscreenElement) {
      tankWrapperRef.current.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div
      ref={tankWrapperRef}
      className="sensor-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        // If fullscreen, span the whole device display. Otherwise, use normal height limits.
        height: isFullscreen ? '100vh' : 'calc(100vh - 200px)',
        minHeight: isFullscreen ? '100vh' : '555px',
        padding: isFullscreen ? 'var(--space-6)' : 'var(--space-4)',
        gap: 'var(--space-3)',
        position: 'relative',
        overflow: 'hidden',
        background: isFullscreen ? '#070b14' : 'transparent', // dark canvas backing if full screen
      }}
    >
      {/* Overlay header controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
          background: 'rgba(7, 11, 20, 0.8)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--glass-border)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: '#fff', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>🔮</span> Metal Balls Tank
          </h3>
          <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {isConnected
              ? 'Tilt the physical Thingy:52 to roll the metal balls, or shake it to bounce them!'
              : 'Connect your Thingy:52 to control the physics gravity vector.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {isConnected && (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  background: 'rgba(0,0,0,0.3)',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  color: '#fff',
                }}
              >
                <div><span style={{ color: '#ef4444' }}>X:</span> {liveGravity[0].toFixed(1)}</div>
                <div><span style={{ color: '#10b981' }}>Y:</span> {liveGravity[1].toFixed(1)}</div>
                <div><span style={{ color: '#3b82f6' }}>Z:</span> {liveGravity[2].toFixed(1)}</div>
              </div>
            </>
          )}

          {/* Restart App Button */}
          {isConnected && (
            <button
              onClick={() => setSceneKey(prev => prev + 1)}
              style={{
                background: 'rgba(129, 140, 248, 0.15)',
                border: '1px solid #818cf8',
                color: '#fff',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              ⚡ Restart App
            </button>
          )}

          {/* Fullscreen Button Toggle */}
          <button
            onClick={toggleFullscreen}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {isFullscreen ? ' Shrink View' : ' Full Screen'}
          </button>
        </div>
      </div>

      {/* 3D Viewport container */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#f8fafc' }}>
        <Canvas key={sceneKey} shadows camera={{ position: [0, 1.8, 2.7], fov: 60 }}>
          <ambientLight intensity={0.7} color="#ffffff" />

          <spotLight
            position={[5, 8, 5]}
            angle={0.4}
            penumbra={1}
            intensity={5}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <directionalLight position={[-5, 5, -5]} intensity={2.0} color="#e2e8f0" />

          <Physics gravity={liveGravity}>
            {/* Wooden Base Pedestal */}
            <mesh position={[0, -0.15, 0]} receiveShadow>
              <boxGeometry args={[3.0, 0.3, 3.0]} />
              <meshStandardMaterial {...METAL_BALLS_CONFIG.visuals.wood} />
            </mesh>

            {/* Wooden Top Cap */}
            <mesh position={[0, 3.15, 0]} receiveShadow>
              <boxGeometry args={[3.0, 0.3, 3.0]} />
              <meshStandardMaterial {...METAL_BALLS_CONFIG.visuals.wood} />
            </mesh>

            {/* Tank Floor */}
            <RigidBody type="fixed" colliders="cuboid" position={[0, 0.05, 0]}>
              <mesh receiveShadow>
                <boxGeometry args={[2.6, 0.1, 2.6]} />
                <meshStandardMaterial {...METAL_BALLS_CONFIG.visuals.tankFloor} />
              </mesh>
            </RigidBody>

            {/* Tank Ceiling */}
            <RigidBody type="fixed" colliders="cuboid" position={[0, 2.95, 0]}>
              <mesh>
                <boxGeometry args={[2.6, 0.1, 2.6]} />
                <meshStandardMaterial {...METAL_BALLS_CONFIG.visuals.tankFloor} />
              </mesh>
            </RigidBody>

            {/* Wall Left */}
            <RigidBody type="fixed" colliders="cuboid" position={[-1.35, 1.5, 0]}>
              <mesh receiveShadow castShadow>
                <boxGeometry args={[0.1, 2.8, 2.6]} />
                <meshStandardMaterial transparent {...METAL_BALLS_CONFIG.visuals.tankGlass} />
              </mesh>
            </RigidBody>

            {/* Wall Right */}
            <RigidBody type="fixed" colliders="cuboid" position={[1.35, 1.5, 0]}>
              <mesh receiveShadow castShadow>
                <boxGeometry args={[0.1, 2.8, 2.6]} />
                <meshStandardMaterial transparent {...METAL_BALLS_CONFIG.visuals.tankGlass} />
              </mesh>
            </RigidBody>

            {/* Wall Back */}
            <RigidBody type="fixed" colliders="cuboid" position={[0, 1.5, -1.35]}>
              <mesh receiveShadow castShadow>
                <boxGeometry args={[2.6, 2.8, 0.1]} />
                <meshStandardMaterial transparent {...METAL_BALLS_CONFIG.visuals.tankGlass} />
              </mesh>
            </RigidBody>

            {/* Wall Front */}
            <RigidBody type="fixed" colliders="cuboid" position={[0, 1.5, 1.35]}>
              <mesh receiveShadow castShadow>
                <boxGeometry args={[2.6, 2.8, 0.1]} />
                <meshStandardMaterial transparent {...METAL_BALLS_CONFIG.visuals.tankGlass} />
              </mesh>
            </RigidBody>

            {/* Steel Balls */}
            {balls.current.map((ball) => (
              <RigidBody
                key={ball.id}
                position={ball.position}
                type="dynamic"
                colliders={false}
                linearDamping={METAL_BALLS_CONFIG.physics.linearDamping}
                angularDamping={METAL_BALLS_CONFIG.physics.angularDamping}
                friction={METAL_BALLS_CONFIG.physics.friction}
                restitution={METAL_BALLS_CONFIG.physics.restitution}
                ccd={true}
              >
                <BallCollider args={[ball.radius]} />
                <mesh castShadow receiveShadow>
                  <sphereGeometry args={[ball.radius, 18, 18]} />
                  <meshStandardMaterial {...METAL_BALLS_CONFIG.visuals.ball} />
                </mesh>
              </RigidBody>
            ))}

            <GravityController
              motion={motion}
              baseline={baseline}
              calibration={calibration}
              setLiveGravity={setLiveGravity}
            />
          </Physics>

          <OrbitControls
            enablePan={false}
            minDistance={2}
            maxDistance={6}
            maxPolarAngle={Math.PI / 2 - 0.05}
          />
        </Canvas>
      </div>
    </div>
  );
}