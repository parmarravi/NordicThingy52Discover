import { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Physics, RigidBody, useSphericalJoint, BallCollider } from '@react-three/rapier';
import { KalmanFilter } from '../utils/kalmanFilter';

/**
 * PendulumBulb — Dynamic rigid body representing the hanging light bulb.
 * Connected to a fixed ceiling anchor via a spherical joint.
 */
function PendulumBulb({ motion, calibration }) {
  const anchorRef = useRef();
  const bulbRef = useRef();
  const { euler, accel } = motion || {};

  // Create spherical joint between anchor and bulb.
  useSphericalJoint(anchorRef, bulbRef, [
    [0, 0, 0], // Anchor local space (ceiling point)
    [0, 2, 0], // Bulb local space (2 units up from bulb center)
  ]);

  const lastLogRef = useRef(0);

  // Kalman filter instances for Roll and Pitch axes
  const rollKalmanRef = useRef(null);
  const pitchKalmanRef = useRef(null);

  const kalmanQ = calibration?.kalmanQ ?? 0.01;
  const kalmanR = calibration?.kalmanR ?? 1.0;

  // Initialize or re-create filters when calibration tuning parameters change
  useEffect(() => {
    rollKalmanRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
    pitchKalmanRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
  }, [kalmanQ, kalmanR]);

  // Fallback first-render initialization
  if (!rollKalmanRef.current) {
    rollKalmanRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
    pitchKalmanRef.current = new KalmanFilter({ Q: kalmanQ, R: kalmanR });
  }

  // Apply continuous forces based on physical Thingy:52 9DOF and accel data
  useFrame(() => {
    if (bulbRef.current && euler && euler.roll !== undefined) {
      // Explicitly wake up the body to ensure force events are registered
      bulbRef.current.wakeUp();

      // Apply Kalman filtering
      const filteredRoll = rollKalmanRef.current.filter(euler.roll);
      const filteredPitch = pitchKalmanRef.current.filter(euler.pitch);

      // Centralized offsets and parameters
      const rOffset = calibration ? calibration.rollOffset : 0;
      const pOffset = calibration ? calibration.pitchOffset : 0;
      const rSign = calibration?.rollSign ?? 1;
      const pSign = calibration?.pitchSign ?? 1;
      const rScale = calibration?.rollScale ?? 1.0;
      const pScale = calibration?.pitchScale ?? 1.0;

      // Compute relative angles incorporating offsets, direction sign, and scale
      const relativeRoll = (filteredRoll - rOffset) * rSign * rScale;
      const relativePitch = (filteredPitch - pOffset) * pSign * pScale;

      // Physics settings
      const sens = calibration ? calibration.sensitivity : 1.2;
      const gravityVal = 9.80665;

      // Convert angles (in degrees) to gravity force vector components
      // Roll tilt maps to X-axis force, Pitch tilt maps to Z-axis force
      const radRoll = (relativeRoll * Math.PI) / 180;
      const radPitch = (relativePitch * Math.PI) / 180;

      let fx = Math.sin(radRoll) * gravityVal * sens;
      let fz = -Math.sin(radPitch) * gravityVal * sens;
      let fy = (Math.cos(radRoll) * Math.cos(radPitch) - 1.0) * gravityVal * sens;

      // Isolate raw acceleration spikes for shaking forces (high-pass filter)
      if (accel && accel.x !== null) {
        // Subtract gravity components from raw accelerometer values
        const expectedGx = -Math.sin((euler.roll * Math.PI) / 180) * gravityVal;
        const expectedGz = Math.sin((euler.pitch * Math.PI) / 180) * gravityVal;
        const expectedGy = Math.cos((euler.roll * Math.PI) / 180) * Math.cos((euler.pitch * Math.PI) / 180) * gravityVal;

        const shakeX = accel.x - expectedGx;
        const shakeZ = accel.y - expectedGz;
        const shakeY = accel.z - expectedGy;

        // Add shake components scaled down to prevent clipping
        const shakeScale = 0.4;
        fx += shakeX * shakeScale;
        fy += shakeY * shakeScale;
        fz += shakeZ * shakeScale;
      }

      // Safety Guard: Clamp forces to prevent the bulb from flying out of viewport/disappearing
      const maxForce = 2.5;
      fx = Math.max(-maxForce, Math.min(maxForce, fx));
      fy = Math.max(-maxForce, Math.min(maxForce, fy));
      fz = Math.max(-maxForce, Math.min(maxForce, fz));

      bulbRef.current.addForce({ x: fx, y: fy, z: fz }, true);

      // Throttled logging to verify physical forces are working
      const now = Date.now();
      if (now - lastLogRef.current > 1500) {
        lastLogRef.current = now;
        try {
          const trans = bulbRef.current.translation();
          console.log(`[useFrame] Roll: ${relativeRoll.toFixed(1)}°, Pitch: ${relativePitch.toFixed(1)}° | Forces: X=${fx.toFixed(2)}, Y=${fy.toFixed(2)}, Z=${fz.toFixed(2)} | Bulb Pos: X=${trans.x.toFixed(3)}, Y=${trans.y.toFixed(3)}, Z=${trans.z.toFixed(3)}`);
        } catch (err) {
          console.log('[useFrame] Could not read translation:', err.message);
        }
      }
    }
  });

  return (
    <>
      {/* Fixed Ceiling Anchor Point */}
      <RigidBody ref={anchorRef} position={[0, 4, 0]} type="fixed" colliders={false}>
        <mesh>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial color="#475569" roughness={0.3} />
        </mesh>
      </RigidBody>

      <RigidBody
        ref={bulbRef}
        position={[0, 2, 0]}
        type="dynamic"
        colliders={false}
        linearDamping={0.4}
        angularDamping={0.4}
        canSleep={false}
      >
        {/* Custom ball collider at the bulb base to define moment of inertia without touching the ceiling */}
        <BallCollider args={[0.15]} position={[0, -0.1, 0]} />

        {/* Pendulum Cord (extends up to the joint anchor at local Y = 2) */}
        <mesh position={[0, 1, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 2, 8]} />
          <meshStandardMaterial color="#111827" roughness={0.9} />
        </mesh>

        {/* Socket assembly */}
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.2, 12]} />
          <meshStandardMaterial color="#374151" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Glass Bulb */}
        <mesh position={[0, -0.1, 0]}>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial
            color="#fef08a"
            emissive="#eab308"
            emissiveIntensity={1.5}
            roughness={0.1}
          />
        </mesh>

        {/* Dynamic Warm Bulb PointLight casting moving shadows */}
        <pointLight
          position={[0, -0.1, 0]}
          color="#fef08a"
          intensity={4}
          distance={15}
          decay={1.8}
          castShadow
          shadow-mapSize-width={512}
          shadow-mapSize-height={512}
          shadow-bias={-0.001}
        />
      </RigidBody>
    </>
  );
}

/**
 * BedroomScene — Contains the 3D meshes for the dark 90s bedroom.
 */
function BedroomScene() {
  return (
    <group>
      {/* 1. Floor (Dark wooden planks) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#2d221e" roughness={0.8} />
      </mesh>
      {/* Floor lines to simulate planks */}
      <gridHelper args={[10, 10, '#1c1917', '#3f2b23']} position={[0, 0.002, 0]} />

      {/* 2. Walls (Dark plaster, front open) */}
      {/* Back Wall with window cutout */}
      <mesh position={[0, 2.5, -5]} receiveShadow castShadow>
        <boxGeometry args={[10, 5, 0.2]} />
        <meshStandardMaterial color="#1e1e2f" roughness={0.9} />
      </mesh>

      {/* Left Wall */}
      <mesh position={[-5, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[10, 5, 0.2]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.9} />
      </mesh>

      {/* Right Wall */}
      <mesh position={[5, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[10, 5, 0.2]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.9} />
      </mesh>

      {/* Ceiling (Dark ceiling anchor point) */}
      <mesh position={[0, 5, 0]} receiveShadow>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#111827" roughness={0.95} />
      </mesh>

      {/* 3. Furniture (90s retro bedroom style) */}
      {/* Retro Bed */}
      <group position={[3, 0, -2.5]}>
        {/* Mattress & Frame */}
        <mesh position={[0, 0.4, 0]} receiveShadow castShadow>
          <boxGeometry args={[3, 0.8, 4.5]} />
          <meshStandardMaterial color="#475569" roughness={0.8} />
        </mesh>
        {/* Blanket/Quilt */}
        <mesh position={[0, 0.82, 0.3]} receiveShadow castShadow>
          <boxGeometry args={[3.04, 0.05, 3.9]} />
          <meshStandardMaterial color="#581c87" roughness={0.7} />
        </mesh>
        {/* Pillow */}
        <mesh position={[0, 0.85, -1.8]} rotation={[0.1, 0, 0]} castShadow>
          <boxGeometry args={[2.2, 0.15, 0.8]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.9} />
        </mesh>
      </group>

      {/* Bedside Table */}
      <group position={[-3.8, 0, -3.8]}>
        <mesh position={[0, 0.5, 0]} receiveShadow castShadow>
          <boxGeometry args={[1.2, 1, 1.2]} />
          <meshStandardMaterial color="#3f2b23" roughness={0.9} />
        </mesh>
        {/* Bedside table drawers divider lines */}
        <mesh position={[0, 0.5, 0.61]} castShadow>
          <boxGeometry args={[1, 0.02, 0.02]} />
          <meshStandardMaterial color="#1c1917" />
        </mesh>
      </group>

      {/* Retro CRT TV (glowing static) */}
      <group position={[-3.8, 1, -3.8]}>
        {/* TV Outer Shell */}
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[1, 0.8, 1]} />
          <meshStandardMaterial color="#1f2937" roughness={0.4} />
        </mesh>
        {/* TV Screen Face */}
        <mesh position={[0.1, 0.4, 0.51]} rotation={[0.05, 0, 0]}>
          <planeGeometry args={[0.7, 0.55]} />
          <meshStandardMaterial
            color="#22c55e"
            emissive="#15803d"
            emissiveIntensity={1.2}
            roughness={0.1}
          />
        </mesh>
        {/* TV Screen Static Light */}
        <pointLight position={[0.1, 0.4, 0.7]} color="#4ade80" intensity={0.8} distance={3} decay={2} />
      </group>

      {/* Window Frame on Back Wall */}
      <group position={[0, 2.8, -4.9]}>
        {/* Window Frame */}
        <mesh castShadow>
          <boxGeometry args={[2.5, 1.8, 0.15]} />
          <meshStandardMaterial color="#111827" roughness={0.6} />
        </mesh>
        {/* Cutout light indicator (bright night glow) */}
        <mesh position={[0, 0, -0.05]}>
          <planeGeometry args={[2.3, 1.6]} />
          <meshBasicMaterial color="#1e293b" />
        </mesh>
      </group>

      {/* Poster on Left Wall */}
      <mesh position={[-4.89, 2.5, 1]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.5, 2]} />
        <meshStandardMaterial color="#475569" roughness={0.9} />
      </mesh>
      {/* Poster design details (simulating grid layout) */}
      <mesh position={[-4.88, 2.5, 1]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.3, 1.8]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>
      {/* Glow dot in poster */}
      <mesh position={[-4.87, 2.8, 1]} rotation={[0, Math.PI / 2, 0]}>
        <circleGeometry args={[0.15, 16]} />
        <meshBasicMaterial color="#818cf8" />
      </mesh>
    </group>
  );
}

/**
 * MoonlightAmbient — Main App view component rendering the 3D room.
 */
export default function MoonlightAmbient({ motion, status, calibration }) {
  const isConnected = status === 'connected';
  const [sceneKey, setSceneKey] = useState(0);

  const restartPhysicsApp = () => {
    setSceneKey(prev => prev + 1);
    console.log('[MoonlightAmbient] Restarted 3D scene and physics simulation.');
  };

  return (
    <div
      className="sensor-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 200px)',
        minHeight: '550px',
        padding: 'var(--space-4)',
        gap: 'var(--space-3)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Controls / Info overlay */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
          background: 'rgba(7, 11, 20, 0.6)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--glass-border)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: '#fff', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>🌙</span> Moonlight Ambient
          </h3>
          <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {isConnected
              ? 'Move, shake, or tilt the physical Thingy:52 to swing the hanging bulb!'
              : 'Connect your Thingy:52 to swing the hanging light bulb.'}
          </p>
        </div>

        {isConnected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              onClick={restartPhysicsApp}
              className="btn-action"
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
          </div>
        )}
      </div>

      {/* 3D Viewport */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#090d16' }}>
        <Canvas key={sceneKey} shadows camera={{ position: [0, 2.5, 6], fov: 50 }}>
          {/* Faint blue ambient moonlight */}
          <ambientLight color="#1e293b" intensity={0.5} />

          {/* Moonlight directional source shining diagonal through the window */}
          <directionalLight
            color="#38bdf8"
            intensity={2.5}
            position={[4, 5, -8]}
            target-position={[0, 1.5, 0]}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
            shadow-bias={-0.001}
          />

          <Stars radius={100} depth={50} count={300} factor={4} saturation={0.5} fade speed={1} />

          {/* Physics engine simulation */}
          <Physics gravity={[0, -9.81, 0]}>
            {/* Bedroom furniture & walls */}
            <BedroomScene />

            {/* Hanging Bulb reacting to Thingy:52 motion */}
            <PendulumBulb motion={motion} calibration={calibration} />
          </Physics>

          <OrbitControls
            enablePan={false}
            minDistance={3}
            maxDistance={9}
            maxPolarAngle={Math.PI / 2 - 0.05} // don't look under the floor
          />
        </Canvas>
      </div>
    </div>
  );
}
