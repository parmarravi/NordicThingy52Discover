/**
 * WindSimulator — Immersive coastal palm scene responsive to physical breath
 * (via CCS811 eCO2 sensor) and tilt orientation (via 9DOF roll).
 *
 * Physics & Modulations:
 *   - Wind Speed: Driven by eCO2 spikes relative to rolling baseline.
 *   - Wind Direction: Controlled by device roll tilt (left/right).
 *   - Dynamic Palm Trees: Segmented trunks that bend in an arc proportional to wind force.
 *   - Leaf Flutter: High-frequency rotation offset modulated by wind speed.
 *   - Blow Particles: Flowing stream of leaves/sand particles drifting across.
 *   - Wind Audio: Real-time procedural white-noise synthesizer via Web Audio API.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { KalmanFilter } from '../utils/kalmanFilter';
import { getCalibratedForces } from '../utils/calibrationUtils';
import { DEFAULT_CALIBRATION, WIND_SIMULATOR_CONFIG } from '../utils/constants';

// ─── Procedural Wind Audio Synthesizer ────────────────────────────────────────
class WindAudio {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.filter = null;
    this.gain = null;
    this.isActive = false;
  }

  start() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // Create a 2-second white noise buffer
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      this.noise = this.ctx.createBufferSource();
      this.noise.buffer = buffer;
      this.noise.loop = true;

      // Bandpass filter to create "howling" wind effect
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'bandpass';
      this.filter.Q.value = 3.0; // resonant width
      this.filter.frequency.value = 300;

      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.0;

      // Connections
      this.noise.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(this.ctx.destination);

      this.noise.start(0);
      this.isActive = true;
    } catch (e) {
      console.warn('[WindAudio] Web Audio initialization failed:', e);
    }
  }

  setIntensity(speed, dir) {
    if (!this.isActive || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    // Modulate gain (volume) based on wind speed
    const targetVolume = Math.min(0.35, speed * 0.08);
    this.gain.gain.setTargetAtTime(targetVolume, this.ctx.currentTime, 0.15);

    // Modulate center frequency (pitch shift) based on wind speed and direction gustiness
    const baseFreq = 200 + speed * 110;
    const gust = Math.sin(Date.now() * 0.005) * 40;
    this.filter.frequency.setTargetAtTime(baseFreq + gust, this.ctx.currentTime, 0.1);
  }

  stop() {
    if (this.noise) {
      try { this.noise.stop(); } catch (_) { }
    }
    if (this.ctx) {
      this.ctx.close();
    }
    this.isActive = false;
  }
}

// ─── Cloud Component ────────────────────────────────────────────────────────
function Cloud({ position, speedRef, timeOfDay }) {
  const meshRef = useRef();

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const s = speedRef.current ?? 1.0;
    // Drift cloud slowly
    meshRef.current.position.x += delta * s * 0.22;

    // Wrap around sky boundary
    if (meshRef.current.position.x > 15) {
      meshRef.current.position.x = -15;
    }
  });

  const cloudMaterial = useMemo(() => {
    let color = '#ffffff';
    let emissive = '#ffffff';
    let emissiveIntensity = 0.12;

    if (timeOfDay === 'evening') {
      color = '#382f4d'; // Dark purple-grey cloud body
      emissive = '#be185d'; // Magenta-pink sunset glow underneath
      emissiveIntensity = 0.42;
    } else if (timeOfDay === 'night') {
      color = '#111827'; // Near black
      emissive = '#1e1b4b'; // Deep blue glow
      emissiveIntensity = 0.18;
    }

    return { color, emissive, emissiveIntensity };
  }, [timeOfDay]);

  return (
    <group ref={meshRef} position={position}>
      {/* Central fluff */}
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.75, 10, 10]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
      {/* Right puff */}
      <mesh position={[0.62, -0.15, 0.1]} castShadow>
        <sphereGeometry args={[0.55, 8, 8]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
      {/* Left puff */}
      <mesh position={[-0.62, -0.1, -0.1]} castShadow>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
      {/* Top central puff */}
      <mesh position={[0.25, 0.25, -0.05]} castShadow>
        <sphereGeometry args={[0.6, 8, 8]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
      {/* Top left puff */}
      <mesh position={[-0.25, 0.22, 0.05]} castShadow>
        <sphereGeometry args={[0.48, 8, 8]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
    </group>
  );
}

// ─── Wind Particles Component (Rain, Snow, or Drifting Leaves) ────────────────
function WindParticles({ type = 'snow', count = 120, speedRef, dirRef, timeOfDay }) {
  const pointsRef = useRef();

  // Create a soft radial gradient canvas texture for snowflakes/leaves
  const snowTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
    return new THREE.CanvasTexture(canvas);
  }, []);

  // Create a vertical line canvas texture for rain drops
  const rainTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(165, 243, 252, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(4, 32);
    ctx.stroke();
    return new THREE.CanvasTexture(canvas);
  }, []);
  
  const particles = useMemo(() => {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push({
        x: (Math.random() - 0.5) * 20,
        y: Math.random() * 6.0,
        z: (Math.random() - 0.5) * 10,
        speedScale: 0.6 + Math.random() * 0.8,
      });
    }
    return data;
  }, [count]);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [count]);

  useFrame((state, delta) => {
    if (!pointsRef.current || type === 'none') return;
    const pos = pointsRef.current.geometry.attributes.position.array;
    const windSpeed = speedRef.current ?? 1.0;
    const windDir = dirRef.current ?? 0.0;

    particles.forEach((p, idx) => {
      if (type === 'rain') {
        // Rain falls much faster
        p.y -= delta * (9.0 + windSpeed * 2.2) * p.speedScale;
        p.x += delta * windSpeed * 4.5 * windDir * p.speedScale;
      } else if (type === 'leaves') {
        // Leaves drift horizontally fast, float down slowly
        p.y -= delta * (0.4 + windSpeed * 0.15) * p.speedScale;
        p.x += delta * windSpeed * 4.2 * windDir * p.speedScale;
        p.x += Math.sin(state.clock.elapsedTime * 2.2 + idx) * 0.005;
      } else {
        // Snow falls slower
        p.y -= delta * (0.8 + windSpeed * 0.3) * p.speedScale;
        p.x += delta * windSpeed * 3.5 * windDir * p.speedScale;
        p.x += Math.sin(state.clock.elapsedTime * 1.8 + idx) * 0.003;
      }

      // Reset when particle drops below ground or leaves horizontal box
      if (p.y < 0) {
        p.y = 6.0;
        p.x = (Math.random() - 0.5) * 20;
      }
      if (p.x > 10) {
        p.x = -10;
        p.y = Math.random() * 6.0;
      } else if (p.x < -10) {
        p.x = 10;
        p.y = Math.random() * 6.0;
      }

      const offset = idx * 3;
      pos[offset] = p.x;
      pos[offset + 1] = p.y;
      pos[offset + 2] = p.z;
    });

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  const pColor = useMemo(() => {
    if (type === 'rain') return '#cbd5e1';
    if (type === 'leaves') {
      return timeOfDay === 'evening' ? '#ea580c' : '#22c55e';
    }
    return '#ffffff';
  }, [type, timeOfDay]);

  if (type === 'none') return null;

  return (
    <points ref={pointsRef} geometry={geo}>
      <pointsMaterial
        map={type === 'rain' ? rainTexture : snowTexture}
        color={pColor}
        size={type === 'rain' ? 0.22 : type === 'leaves' ? 0.09 : 0.12}
        transparent
        opacity={type === 'rain' ? 0.6 : type === 'leaves' ? 0.75 : 0.8}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Procedural Curved Palm Leaflet Pair ─────────────────────────────────────
function LeafletPair({ scale, yOffset, length }) {
  return (
    <group position={[0, yOffset, 0]}>
      {/* Left Leaflet - angles outward, slightly backward, and droops down */}
      <mesh position={[-length * 0.44, 0, -length * 0.08]} rotation={[0.1, 0.28, -0.65]} castShadow>
        <boxGeometry args={[length, 0.016 * scale, 0.003]} />
        <meshStandardMaterial color="#15803d" roughness={0.7} flatShading />
      </mesh>
      {/* Right Leaflet */}
      <mesh position={[length * 0.44, 0, -length * 0.08]} rotation={[-0.1, -0.28, 0.65]} castShadow>
        <boxGeometry args={[length, 0.016 * scale, 0.003]} />
        <meshStandardMaterial color="#15803d" roughness={0.7} flatShading />
      </mesh>
    </group>
  );
}

// ─── Procedural Feathery Palm Frond (Nested bending arch) ────────────────────
function PalmFrond({ angle, scale, speedRef }) {
  const frondRef = useRef();

  useFrame((state) => {
    const s = speedRef.current ?? 1.0;
    // High-frequency flutter modulated by wind speed
    const flutter = Math.sin(state.clock.elapsedTime * (13 + s * 4) + angle) * (0.018 * s);
    // Lower frequency wind sway
    const sway = Math.sin(state.clock.elapsedTime * 2.2 + angle) * 0.035;
    if (frondRef.current) {
      // Wind action twists/wobbles the frond rib
      frondRef.current.rotation.z = flutter;
      frondRef.current.rotation.x = 0.58 + sway;
    }
  });

  const h = 0.52 * scale; // length of each branch segment

  return (
    <group rotation={[0, angle, 0]}>
      {/* Root group: angles out and up */}
      <group ref={frondRef} rotation={[0.58, 0, 0]}>
        {/* Segment 1 */}
        <mesh position={[0, h / 2, 0]} castShadow>
          <cylinderGeometry args={[0.01 * scale, 0.016 * scale, h, 5]} />
          <meshStandardMaterial color="#166534" roughness={0.7} />
        </mesh>
        <LeafletPair scale={scale} yOffset={h * 0.25} length={0.42 * scale} />
        <LeafletPair scale={scale} yOffset={h * 0.6} length={0.5 * scale} />
        <LeafletPair scale={scale} yOffset={h * 0.9} length={0.55 * scale} />

        {/* Segment 2: arching down */}
        <group position={[0, h, 0]} rotation={[0.4, 0, 0]}>
          <mesh position={[0, h / 2, 0]} castShadow>
            <cylinderGeometry args={[0.007 * scale, 0.01 * scale, h, 5]} />
            <meshStandardMaterial color="#15803d" roughness={0.7} />
          </mesh>
          <LeafletPair scale={scale} yOffset={h * 0.25} length={0.55 * scale} />
          <LeafletPair scale={scale} yOffset={h * 0.6} length={0.48 * scale} />
          <LeafletPair scale={scale} yOffset={h * 0.9} length={0.42 * scale} />

          {/* Segment 3: drooping down */}
          <group position={[0, h, 0]} rotation={[0.48, 0, 0]}>
            <mesh position={[0, h / 2, 0]} castShadow>
              <cylinderGeometry args={[0.004 * scale, 0.007 * scale, h, 5]} />
              <meshStandardMaterial color="#15803d" roughness={0.7} />
            </mesh>
            <LeafletPair scale={scale} yOffset={h * 0.25} length={0.36 * scale} />
            <LeafletPair scale={scale} yOffset={h * 0.75} length={0.22 * scale} />
          </group>
        </group>
      </group>
    </group>
  );
}

// ─── Segmented bending Palm Tree ─────────────────────────────────────────────
function PalmTree({ position, scale = 1, speedRef, dirRef }) {
  const segmentsRef = useRef([]);

  // Create trunk segments mapping structure
  const segments = useMemo(() => {
    return Array.from({ length: WIND_SIMULATOR_CONFIG.tree.numSegments }).map((_, i) => ({
      height: WIND_SIMULATOR_CONFIG.tree.segmentHeightBase * scale,
      radiusBottom: WIND_SIMULATOR_CONFIG.tree.radiusBase * (1 - i * WIND_SIMULATOR_CONFIG.tree.radiusDecay) * scale,
      radiusTop: WIND_SIMULATOR_CONFIG.tree.radiusBase * (1 - (i + 1) * WIND_SIMULATOR_CONFIG.tree.radiusDecay) * scale,
    }));
  }, [scale]);

  useFrame((state) => {
    const s = speedRef.current ?? 1.0;
    const d = dirRef.current ?? 0.0;

    // Wind modulation formula: base bend + howling frequency sway
    const targetBend = (s * d * 0.075) * (scale * 0.95);
    const swayFreq = 3.6 + s * 1.2;
    const swayAmp = 0.016 * s;
    const sway = Math.sin(state.clock.elapsedTime * swayFreq) * swayAmp;

    // Apply incremental bending angle up the trunk hierarchy
    segmentsRef.current.forEach((ref, idx) => {
      if (!ref) return;
      // Higher segments bend more
      const segmentWeight = (idx + 1) / 6;
      ref.rotation.z = targetBend * segmentWeight + sway;
    });
  });

  return (
    <group position={position}>
      {/* Segment 0 (Root) */}
      <group ref={el => segmentsRef.current[0] = el}>
        <mesh position={[0, segments[0].height / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[segments[0].radiusTop, segments[0].radiusBottom, segments[0].height, 10]} />
          <meshStandardMaterial color="#78350f" roughness={0.9} flatShading />
        </mesh>
        {/* Trunk ridges for textured look */}
        <mesh position={[0, segments[0].height * 0.3, 0]}>
          <torusGeometry args={[segments[0].radiusBottom * 1.05, 0.028 * scale, 4, 10]} />
          <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
        </mesh>
        <mesh position={[0, segments[0].height * 0.7, 0]}>
          <torusGeometry args={[segments[0].radiusTop * 1.05, 0.028 * scale, 4, 10]} />
          <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
        </mesh>

        {/* Segment 1 */}
        <group position={[0, segments[0].height, 0]} ref={el => segmentsRef.current[1] = el}>
          <mesh position={[0, segments[1].height / 2, 0]} castShadow>
            <cylinderGeometry args={[segments[1].radiusTop, segments[1].radiusBottom, segments[1].height, 10]} />
            <meshStandardMaterial color="#78350f" roughness={0.9} flatShading />
          </mesh>
          <mesh position={[0, segments[1].height * 0.3, 0]}>
            <torusGeometry args={[segments[1].radiusBottom * 1.05, 0.028 * scale, 4, 10]} />
            <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
          </mesh>
          <mesh position={[0, segments[1].height * 0.7, 0]}>
            <torusGeometry args={[segments[1].radiusTop * 1.05, 0.028 * scale, 4, 10]} />
            <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
          </mesh>

          {/* Segment 2 */}
          <group position={[0, segments[1].height, 0]} ref={el => segmentsRef.current[2] = el}>
            <mesh position={[0, segments[2].height / 2, 0]} castShadow>
              <cylinderGeometry args={[segments[2].radiusTop, segments[2].radiusBottom, segments[2].height, 10]} />
              <meshStandardMaterial color="#78350f" roughness={0.9} flatShading />
            </mesh>
            <mesh position={[0, segments[2].height * 0.3, 0]}>
              <torusGeometry args={[segments[2].radiusBottom * 1.05, 0.028 * scale, 4, 10]} />
              <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
            </mesh>
            <mesh position={[0, segments[2].height * 0.7, 0]}>
              <torusGeometry args={[segments[2].radiusTop * 1.05, 0.028 * scale, 4, 10]} />
              <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
            </mesh>

            {/* Segment 3 */}
            <group position={[0, segments[2].height, 0]} ref={el => segmentsRef.current[3] = el}>
              <mesh position={[0, segments[3].height / 2, 0]} castShadow>
                <cylinderGeometry args={[segments[3].radiusTop, segments[3].radiusBottom, segments[3].height, 10]} />
                <meshStandardMaterial color="#72330d" roughness={0.9} flatShading />
              </mesh>
              <mesh position={[0, segments[3].height * 0.3, 0]}>
                <torusGeometry args={[segments[3].radiusBottom * 1.05, 0.026 * scale, 4, 10]} />
                <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
              </mesh>
              <mesh position={[0, segments[3].height * 0.7, 0]}>
                <torusGeometry args={[segments[3].radiusTop * 1.05, 0.026 * scale, 4, 10]} />
                <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
              </mesh>

              {/* Segment 4 */}
              <group position={[0, segments[3].height, 0]} ref={el => segmentsRef.current[4] = el}>
                <mesh position={[0, segments[4].height / 2, 0]} castShadow>
                  <cylinderGeometry args={[segments[4].radiusTop, segments[4].radiusBottom, segments[4].height, 10]} />
                  <meshStandardMaterial color="#72330d" roughness={0.9} flatShading />
                </mesh>
                <mesh position={[0, segments[4].height * 0.3, 0]}>
                  <torusGeometry args={[segments[4].radiusBottom * 1.05, 0.026 * scale, 4, 10]} />
                  <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
                </mesh>
                <mesh position={[0, segments[4].height * 0.7, 0]}>
                  <torusGeometry args={[segments[4].radiusTop * 1.05, 0.026 * scale, 4, 10]} />
                  <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
                </mesh>

                {/* Segment 5 (Crown) */}
                <group position={[0, segments[4].height, 0]} ref={el => segmentsRef.current[5] = el}>
                  <mesh position={[0, segments[5].height / 2, 0]} castShadow>
                    <cylinderGeometry args={[segments[5].radiusTop, segments[5].radiusBottom, segments[5].height, 10]} />
                    <meshStandardMaterial color="#72330d" roughness={0.9} flatShading />
                  </mesh>

                  {/* Coconuts Cluster - Clustered tightly at the top underneath the leaves */}
                  <group position={[0, segments[5].height - 0.08 * scale, 0]}>
                    <mesh position={[0.06 * scale, 0, 0.04 * scale]} castShadow>
                      <sphereGeometry args={[0.085 * scale, 8, 8]} />
                      <meshStandardMaterial color="#451a03" roughness={0.95} flatShading />
                    </mesh>
                    <mesh position={[-0.07 * scale, -0.01 * scale, 0.05 * scale]} castShadow>
                      <sphereGeometry args={[0.08 * scale, 8, 8]} />
                      <meshStandardMaterial color="#3f1a04" roughness={0.95} flatShading />
                    </mesh>
                    <mesh position={[0.01 * scale, -0.01 * scale, -0.08 * scale]} castShadow>
                      <sphereGeometry args={[0.09 * scale, 8, 8]} />
                      <meshStandardMaterial color="#4a2206" roughness={0.95} flatShading />
                    </mesh>
                  </group>

                  {/* Palm Leaves (Feathery Drooping Radiants) */}
                  <group position={[0, segments[WIND_SIMULATOR_CONFIG.tree.numSegments - 1].height, 0]}>
                    {Array.from({ length: WIND_SIMULATOR_CONFIG.tree.numLeaves }).map((_, lIdx) => {
                      const angle = (lIdx / WIND_SIMULATOR_CONFIG.tree.numLeaves) * Math.PI * 2;
                      return (
                        <PalmFrond
                          key={lIdx}
                          angle={angle}
                          scale={scale}
                          speedRef={speedRef}
                        />
                      );
                    })}
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

// ─── Procedural Low-Poly Flying Bird ─────────────────────────────────────────
function Bird({ startPos, radius, speed, height, wingSpeed, scale = 0.12, speedRef }) {
  const groupRef = useRef();
  const leftWingRef = useRef();
  const rightWingRef = useRef();

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime;
    const s = speedRef.current ?? 1.0;

    // Fly in a wind-responsive circular flight path
    const angle = time * speed * 0.45 + startPos;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.75 - 2.5;
    const y = height + Math.sin(time * 1.4 + startPos) * 0.18;

    groupRef.current.position.set(x, y, z);
    
    // Rotate to face travel vector
    groupRef.current.rotation.y = -angle + Math.PI / 2;

    // Wing flapping speed is tied to wind speed (flaps faster in heavy wind)
    const currentFlapFreq = wingSpeed + s * 2.2;
    const flap = Math.sin(time * currentFlapFreq) * 0.42;

    if (leftWingRef.current) leftWingRef.current.rotation.z = flap;
    if (rightWingRef.current) rightWingRef.current.rotation.z = -flap;
  });

  return (
    <group ref={groupRef}>
      {/* Body */}
      <mesh castShadow>
        <boxGeometry args={[0.07 * scale, 0.07 * scale, 0.38 * scale]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0, 0.2 * scale]} castShadow>
        <boxGeometry args={[0.06 * scale, 0.06 * scale, 0.08 * scale]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Left Wing */}
      <group position={[-0.035 * scale, 0, 0]} ref={leftWingRef}>
        <mesh position={[-0.2 * scale, 0, 0]} castShadow>
          <boxGeometry args={[0.4 * scale, 0.01 * scale, 0.12 * scale]} />
          <meshStandardMaterial color="#475569" roughness={0.85} />
        </mesh>
      </group>
      {/* Right Wing */}
      <group position={[0.035 * scale, 0, 0]} ref={rightWingRef}>
        <mesh position={[0.2 * scale, 0, 0]} castShadow>
          <boxGeometry args={[0.4 * scale, 0.01 * scale, 0.12 * scale]} />
          <meshStandardMaterial color="#475569" roughness={0.85} />
        </mesh>
      </group>
    </group>
  );
}

function Birds({ speedRef }) {
  return (
    <group>
      <Bird startPos={0} radius={4.5} speed={0.4} height={4.0} wingSpeed={7} speedRef={speedRef} />
      <Bird startPos={Math.PI * 0.6} radius={5.8} speed={0.3} height={4.5} wingSpeed={6} speedRef={speedRef} />
      <Bird startPos={Math.PI * 1.3} radius={5.0} speed={0.35} height={3.6} wingSpeed={8} speedRef={speedRef} />
    </group>
  );
}

// ─── Dynamic Ocean Waves Component ───────────────────────────────────────────
function Ocean({ climate, speedRef }) {
  const oceanRef = useRef();

  useFrame((state) => {
    if (!oceanRef.current) return;
    const pos = oceanRef.current.geometry.attributes.position;
    const time = state.clock.elapsedTime;
    const s = speedRef.current ?? 1.0;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Multi-layered waves moving over time, accelerated by wind speed
      const wave = Math.sin(x * 0.5 - time * (1.3 + s * 0.45)) * 0.14 +
                   Math.cos(y * 0.4 - time * 0.8) * 0.09;
      pos.setZ(i, wave);
    }
    pos.needsUpdate = true;
    oceanRef.current.geometry.computeVertexNormals();
  });

  return (
    <mesh ref={oceanRef} position={[0, -0.05, -5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 12, 24, 12]} />
      <meshPhysicalMaterial
        color={climate === 'monsoon' ? '#1e293b' : '#0284c7'}
        roughness={0.06}
        metalness={0.1}
        transmission={0.55} // Translucent water showing sand slope underneath
        thickness={0.8}     // Refraction thickness
        ior={1.333}         // Index of refraction of water
        clearcoat={1.0}     // Glossy reflection clearcoat
        clearcoatRoughness={0.05}
      />
    </mesh>
  );
}

// ─── Sand Dunes & Ground Details ─────────────────────────────────────────────
function SandDunes({ climate }) {
  // Generate a non-flat dune geometry with a slope towards the ocean (+y is the back)
  const duneGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(24, 20, 20, 16);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Dune ripples + steady slope down to submerge in the ocean at the back (positive y)
      const slope = -(y + 1) * 0.075;
      const height = Math.sin(x * 0.28) * Math.cos(y * 0.28) * 0.15 + slope;
      pos.setZ(i, height);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group>
      {/* Textured sand ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={duneGeo} receiveShadow>
        <meshStandardMaterial
          color={climate === 'snowy' ? '#f1f5f9' : '#fed7aa'}
          roughness={0.96}
        />
      </mesh>

      {/* Decorative low-poly rocks */}
      <mesh position={[-2.4, 0.05, 0.6]} rotation={[0.2, 0.5, 0.1]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color="#64748b" roughness={0.8} />
      </mesh>
      <mesh position={[2.1, 0.02, 0.9]} rotation={[0.4, -0.3, 0.2]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#475569" roughness={0.85} />
      </mesh>
      <mesh position={[-0.8, -0.02, 1.8]} rotation={[0.1, 0.8, 0.4]} castShadow>
        <dodecahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial color="#57534e" roughness={0.9} />
      </mesh>

      {/* Decorative beach shells */}
      <mesh position={[1.3, 0.01, 1.4]} rotation={[0.5, 0.2, -0.4]}>
        <coneGeometry args={[0.06, 0.14, 5]} />
        <meshStandardMaterial color="#fda4af" roughness={0.65} />
      </mesh>
      <mesh position={[-1.7, 0.01, 1.9]} rotation={[-0.3, 0.6, 0.5]}>
        <coneGeometry args={[0.05, 0.12, 5]} />
        <meshStandardMaterial color="#fed7aa" roughness={0.7} />
      </mesh>

      {/* Small green grass shoots nestled near tree roots */}
      <group position={[-1.5, 0.05, -0.8]}>
        <mesh rotation={[0.1, 0, -0.15]}>
          <coneGeometry args={[0.015, 0.18, 4]} />
          <meshStandardMaterial color="#16a34a" roughness={0.8} />
        </mesh>
        <mesh position={[0.06, -0.01, 0.04]} rotation={[-0.08, 0.1, 0.12]}>
          <coneGeometry args={[0.012, 0.14, 4]} />
          <meshStandardMaterial color="#15803d" roughness={0.8} />
        </mesh>
      </group>

      <group position={[0.2, 0.02, -2.1]}>
        <mesh rotation={[0.05, 0.05, 0.1]}>
          <coneGeometry args={[0.016, 0.2, 4]} />
          <meshStandardMaterial color="#16a34a" roughness={0.8} />
        </mesh>
        <mesh position={[-0.05, 0, -0.05]} rotation={[-0.05, -0.05, -0.1]}>
          <coneGeometry args={[0.012, 0.15, 4]} />
          <meshStandardMaterial color="#15803d" roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

// ─── Celestial Object (Sun / Moon) ──────────────────────────────────────────
function CelestialObject({ timeOfDay, climate }) {
  const meshRef = useRef();

  useFrame((state) => {
    if (!meshRef.current) return;
    // Breathing scale animation
    const s = 1 + Math.sin(state.clock.elapsedTime * 0.7) * 0.04;
    meshRef.current.scale.set(s, s, s);
  });

  if (climate === 'monsoon') return null; // Covered by overcast clouds

  const isSun = timeOfDay === 'day' || timeOfDay === 'evening';
  const color = timeOfDay === 'evening' ? '#ea580c' : isSun ? '#fef08a' : '#f8fafc';
  const size = isSun ? 0.55 : 0.38;
  const posY = timeOfDay === 'evening' ? 0.7 : 4.2;
  const posZ = timeOfDay === 'evening' ? -6.5 : -8.5;

  return (
    <mesh ref={meshRef} position={[0, posY, posZ]}>
      <sphereGeometry args={[size, 16, 16]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

// ─── Shore Foam Component (Washing up on beach) ──────────────────────────────
function ShoreFoam({ speedRef }) {
  const meshRef = useRef();

  useFrame((state) => {
    if (!meshRef.current) return;
    const s = speedRef.current ?? 1.0;
    // Wave lapping movement: slides back and forth on Z axis where sand meets water
    const t = state.clock.elapsedTime;
    const slide = Math.sin(t * (1.1 + s * 0.18)) * 0.16 - 0.3;
    meshRef.current.position.z = slide;
    // Pulse opacity subtly
    meshRef.current.material.opacity = 0.22 + Math.sin(t * 2.2) * 0.08;
  });

  return (
    <mesh ref={meshRef} position={[0, 0.006, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[22, 0.35]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} />
    </mesh>
  );
}

// ─── Fireflies Component (Night Ambience) ────────────────────────────────────
function Firefly({ startPos, speed }) {
  const meshRef = useRef();
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const x = startPos[0] + Math.sin(t * speed + startPos[3]) * 0.5;
    const y = startPos[1] + Math.cos(t * speed * 0.8) * 0.35;
    const z = startPos[2] + Math.sin(t * speed * 1.2) * 0.5;
    meshRef.current.position.set(x, y, z);
    // Organic glow pulsing
    meshRef.current.material.opacity = (Math.sin(t * 3.5 + startPos[3]) + 1.0) * 0.45;
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.024, 4, 4]} />
      <meshBasicMaterial color="#bef264" transparent opacity={0.9} />
    </mesh>
  );
}

function Fireflies({ active }) {
  const list = useMemo(() => {
    return Array.from({ length: WIND_SIMULATOR_CONFIG.particles.numFireflies }).map(() => [
      (Math.random() - 0.5) * 5.0, // x
      0.2 + Math.random() * 1.8,   // y
      (Math.random() - 0.5) * 3.5 - 0.8, // z
      Math.random() * Math.PI * 2 // offset
    ]);
  }, []);

  if (!active) return null;

  return (
    <group>
      {list.map((pos, i) => (
        <Firefly key={i} startPos={pos} speed={0.35 + Math.random() * 0.35} />
      ))}
    </group>
  );
}

// ─── Main Wind Simulator App ────────────────────────────────────────────────
export default function WindSimulator({ motion, env, status, calibration }) {
  const isConnected = status === 'connected';
  const { euler, accel } = motion || {};
  const { airQuality } = env || {};

  // Interactive local states
  const [sceneKey, setSceneKey] = useState(0);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [manualCO2, setManualCO2] = useState(550); // Fallback slider eCO2 level
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Climate and time control states
  const [climate, setClimate] = useState('sunny'); // 'sunny', 'monsoon', 'snowy'
  const [timeOfDay, setTimeOfDay] = useState('day'); // 'day', 'evening', 'night'

  const windWrapperRef = useRef(null);

  // Audio object instance
  const audioInstance = useMemo(() => new WindAudio(), []);

  // Baseline tracker
  const [baselineCO2, setBaselineCO2] = useState(500);
  const co2HistoryRef = useRef([]);

  // Read current active CO2 value (sensor or manual slider)
  const currentCO2 = isConnected && airQuality?.eco2 ? airQuality.eco2 : manualCO2;

  // Dynamic sky background color mapper
  const skyColor = useMemo(() => {
    if (timeOfDay === 'day') {
      if (climate === 'sunny') return '#38bdf8';
      if (climate === 'monsoon') return '#475569';
      if (climate === 'snowy') return '#cbd5e1';
    }
    if (timeOfDay === 'evening') {
      if (climate === 'sunny') return '#701a75'; // Rich deep violet-purple fog color to match upper sunset sky!
      if (climate === 'monsoon') return '#431407';
      if (climate === 'snowy') return '#fdba74';
    }
    if (timeOfDay === 'night') {
      if (climate === 'sunny') return '#020617';
      if (climate === 'monsoon') return '#090d16';
      if (climate === 'snowy') return '#0f172a';
    }
    return '#38bdf8';
  }, [climate, timeOfDay]);

  // Ambient light colors matching the atmospheric bounce of the environment
  const ambientColor = useMemo(() => {
    if (timeOfDay === 'day') return '#bae6fd';
    if (timeOfDay === 'evening') return '#701a75'; // Purple ambient light reflection!
    if (timeOfDay === 'night') return '#1e1b4b';
    return '#bae6fd';
  }, [timeOfDay]);

  // Procedural gradient canvas texture matching sunset photo
  const eveningGradientTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    // Indigo at top -> violet -> pink-magenta -> orange -> yellow at horizon
    grad.addColorStop(0.0, '#1e1b4b');
    grad.addColorStop(0.35, '#4c1d95');
    grad.addColorStop(0.62, '#db2777');
    grad.addColorStop(0.85, '#ea580c');
    grad.addColorStop(1.0, '#facc15');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, 256);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  // Specular reflection sun angles on physical water
  const directLightPosition = useMemo(() => {
    if (timeOfDay === 'evening') return [0, 0.9, -7.0]; // Shines forward from low behind the horizon tree
    if (timeOfDay === 'night') return [0, 4.0, -8.0];   // Moonlit angle
    return [5, 10, 3];                                 // Bright sunny noon angle
  }, [timeOfDay]);

  // Dynamic light colors and intensities
  const lightConfig = useMemo(() => {
    let ambientIntensity = 0.9;
    let directIntensity = 2.5;
    let directColor = '#fffbeb';

    if (timeOfDay === 'day') {
      ambientIntensity = 0.9;
      directIntensity = 2.5;
      directColor = '#fffbeb';
    } else if (timeOfDay === 'evening') {
      ambientIntensity = 0.65;
      directIntensity = 1.7;
      directColor = '#f97316';
    } else if (timeOfDay === 'night') {
      ambientIntensity = 0.25;
      directIntensity = 0.7;
      directColor = '#93c5fd';
    }

    if (climate === 'monsoon') {
      ambientIntensity *= 0.55;
      directIntensity *= 0.35;
    } else if (climate === 'snowy') {
      ambientIntensity *= 0.95;
      directIntensity *= 0.75;
      directColor = '#f1f5f9';
    }

    return { ambientIntensity, directIntensity, directColor };
  }, [climate, timeOfDay]);

  // Adapt baseline automatically to minimum clean air reference seen over time
  useEffect(() => {
    if (isConnected && airQuality?.eco2) {
      const v = airQuality.eco2;
      co2HistoryRef.current.push(v);
      if (co2HistoryRef.current.length > 30) {
        co2HistoryRef.current.shift();
      }
      const localMin = Math.min(...co2HistoryRef.current);
      setBaselineCO2(localMin);
    }
  }, [airQuality?.eco2, isConnected]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => audioInstance.stop();
  }, [audioInstance]);

  // Sync fullscreen state with native ESC exits
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === windWrapperRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!windWrapperRef.current) return;
    if (!document.fullscreenElement) {
      windWrapperRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Handle toggling Wind sound synthesizer
  const toggleAudio = () => {
    if (isAudioEnabled) {
      audioInstance.stop();
      setIsAudioEnabled(false);
    } else {
      audioInstance.start();
      setIsAudioEnabled(true);
    }
  };

  // Kalman filter instance for horizontal tilt (accel.x)
  const kDirRef = useRef(null);
  if (!kDirRef.current) {
    kDirRef.current = new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR });
  }

  // Compute live wind parameters (base breeze of 0.8x so environment is always alive)
  const rawWindSpeed = 0.8 + Math.max(0.0, (currentCO2 - baselineCO2) / 100);
  const windSpeed = parseFloat(Math.min(6.5, rawWindSpeed).toFixed(2));

  // Determine wind direction left/right using Kalman-filtered accel.x
  const fx = accel && accel.x !== null && accel.x !== undefined ? kDirRef.current.filter(accel.x) : 0;
  const forces = getCalibratedForces(fx, 0, 0, calibration);

  const relativeX = forces.cx * WIND_SIMULATOR_CONFIG.wind.relativeForceScale;
  // Map relativeX (range ~ -10 to +10) to wind direction (range -1.5 to +1.5)
  const windDirection = parseFloat(Math.max(-1.5, Math.min(1.5, relativeX / 8.5)).toFixed(2));

  // Shared mutable refs to feed values into three-fiber frame loop without React lag
  const speedRef = useRef(windSpeed);
  const dirRef = useRef(windDirection);

  useEffect(() => {
    speedRef.current = windSpeed;
    dirRef.current = windDirection;
    if (isAudioEnabled) {
      audioInstance.setIntensity(windSpeed, windDirection);
    }
  }, [windSpeed, windDirection, isAudioEnabled, audioInstance]);

  // Trigger app canvas remount
  const handleRestart = () => {
    setSceneKey(prev => prev + 1);
  };

  return (
    <div
      ref={windWrapperRef}
      className="sensor-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: isFullscreen ? '100vh' : 'calc(100vh - 200px)',
        minHeight: isFullscreen ? '100vh' : '555px',
        padding: isFullscreen ? 'var(--space-6)' : 'var(--space-4)',
        gap: 'var(--space-3)',
        position: 'relative',
        overflow: 'hidden',
        background: isFullscreen ? '#070b14' : '#080d17',
      }}
    >
      {/* Controls Overlay Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
          background: 'rgba(7, 11, 20, 0.75)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--glass-border)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: '#fff', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>🌬️</span> Coastal Wind Simulator
          </h3>
          <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {isConnected
              ? 'Breathe rapidly onto the sensor to generate heavy wind! Tilt left/right to steer direction.'
              : 'Interact using the manual controls below or connect your Thingy:52.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={toggleAudio}
            className="btn-action"
            style={{
              background: isAudioEnabled ? 'rgba(52, 211, 153, 0.2)' : 'rgba(255,255,255,0.03)',
              border: isAudioEnabled ? '1px solid #34d399' : '1px solid var(--glass-border)',
              color: isAudioEnabled ? '#34d399' : '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            {isAudioEnabled ? '🔊 Sound: On' : '🔇 Sound: Muted'}
          </button>

          <button
            onClick={handleRestart}
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
            }}
          >
            ⚡ Restart App
          </button>

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
            {isFullscreen ? '📺 Shrink View' : '📺 Full Screen'}
          </button>
        </div>
      </div>

      {/* Main 3D Canvas */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <Canvas key={sceneKey} shadows camera={{ position: [0, 1.2, 4.0], fov: 45 }}>
          {/* Dynamic lighting config */}
          <ambientLight color={ambientColor} intensity={lightConfig.ambientIntensity} />
          <directionalLight
            position={directLightPosition}
            intensity={lightConfig.directIntensity}
            color={lightConfig.directColor}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          {/* Horizon Atmospheric Fog */}
          <fog attach="fog" args={[skyColor, 6, 20]} />

          {/* Dynamic Sky Dome (or Night Starfield) */}
          {timeOfDay === 'night' ? (
            <>
              <color attach="background" args={['#020617']} />
              <Stars radius={100} depth={50} count={3000} factor={4} saturation={0.5} fade speed={1.2} />
            </>
          ) : timeOfDay === 'evening' && climate === 'sunny' ? (
            <primitive attach="background" object={eveningGradientTexture} />
          ) : (
            <>
              <Sky
                distance={450000}
                sunPosition={timeOfDay === 'evening' ? [0, 0.2, -8] : [5, 6, 3]}
                turbidity={timeOfDay === 'evening' ? 8 : 3}
                rayleigh={timeOfDay === 'evening' ? 4 : 1}
                mieCoefficient={0.005}
                mieDirectionalG={0.8}
              />
              <color attach="background" args={[skyColor]} />
            </>
          )}

          {/* Celestial Sun/Moon */}
          <CelestialObject timeOfDay={timeOfDay} climate={climate} />

          {/* Dynamic flying birds */}
          <Birds speedRef={speedRef} />

          {/* Tropical Palm Island elements */}
          <group position={[0, -0.4, 0]}>
            {/* Dynamic dunes and sand details */}
            <SandDunes climate={climate} />

            {/* Ocean horizon with moving waves */}
            <Ocean climate={climate} speedRef={speedRef} />

            {/* Shore Foam wave lapping line */}
            <ShoreFoam speedRef={speedRef} />

            {/* Dynamic Palms */}
            <PalmTree position={[-1.8, 0, -1.0]} scale={1.2} speedRef={speedRef} dirRef={dirRef} />
            <PalmTree position={[0.0, 0, -2.5]} scale={1.4} speedRef={speedRef} dirRef={dirRef} />
            <PalmTree position={[1.8, 0, -1.5]} scale={1.0} speedRef={speedRef} dirRef={dirRef} />
          </group>

          {/* Magical fireflies around the grove at night */}
          <Fireflies active={timeOfDay === 'night'} />

          {/* Drifting Clouds & Precipitation Particles */}
          <Cloud position={[-6, 4.2, -4]} speedRef={speedRef} timeOfDay={timeOfDay} />
          <Cloud position={[3, 4.8, -5]} speedRef={speedRef} timeOfDay={timeOfDay} />
          <WindParticles
            type={
              climate === 'monsoon'
                ? 'rain'
                : climate === 'snowy'
                ? 'snow'
                : climate === 'sunny'
                ? 'leaves' // Show drifting palm leaves during sunny day/evening!
                : 'none'
            }
            speedRef={speedRef}
            dirRef={dirRef}
            timeOfDay={timeOfDay}
          />

          <OrbitControls
            enablePan={false}
            minDistance={2}
            maxDistance={9}
            target={[0, 1.6, -1.2]}
            maxPolarAngle={Math.PI / 2 - 0.08}
          />
        </Canvas>

        {/* Live Telemetry Display HUD overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            background: 'rgba(7, 11, 20, 0.85)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            color: '#fff',
            fontFamily: 'var(--font-base)',
            zIndex: 10,
            width: '240px',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>
            SIMULATION TELEMETRY
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '4px 0' }}>
            <span style={{ color: 'var(--text-secondary)' }}>eCO2 Sensor:</span>
            <strong style={{ color: '#34d399' }}>{currentCO2} ppm</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '4px 0' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Baseline:</span>
            <span style={{ color: 'var(--text-muted)' }}>{baselineCO2} ppm</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '4px 0' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Wind Speed:</span>
            <strong style={{ color: '#818cf8' }}>{windSpeed}x</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '4px 0' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Wind Direction:</span>
            <strong style={{ color: '#fb923c' }}>
              {windDirection === 0 ? 'Calm' : windDirection > 0 ? `Right (${windDirection}x)` : `Left (${Math.abs(windDirection)}x)`}
            </strong>
          </div>

          {/* Fallback Simulator Slider (used when BLE is disconnected or to test) */}
          {!isConnected && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '8px', paddingTop: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                <span>Simulate Breath:</span>
                <strong>{manualCO2} ppm</strong>
              </div>
              <input
                type="range"
                min="450"
                max="1200"
                step="10"
                value={manualCO2}
                onChange={e => setManualCO2(parseInt(e.target.value))}
                style={{ width: '100%', height: '3px', cursor: 'pointer' }}
              />
              <button
                className="cal-text-btn"
                onClick={() => setManualCO2(500)}
                style={{ width: '100%', textAlign: 'center', marginTop: '4px', padding: '2px 0' }}
              >
                Reset Slider
              </button>
            </div>
          )}
        </div>

        {/* Climate & Time Control Panel overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            background: 'rgba(7, 11, 20, 0.85)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            color: '#fff',
            fontFamily: 'var(--font-base)',
            zIndex: 10,
            width: '280px',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>
            CLIMATE & ENVIRONMENT
          </div>

          {/* Climate Toggle Button Row */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Weather Mode:</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {['sunny', 'monsoon', 'snowy'].map(mode => (
                <button
                  key={mode}
                  onClick={() => setClimate(mode)}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '10px',
                    fontWeight: '600',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    borderColor: climate === mode ? '#818cf8' : 'rgba(255,255,255,0.08)',
                    background: climate === mode ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.03)',
                    color: climate === mode ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {mode === 'sunny' ? '☀️ Sun' : mode === 'monsoon' ? '🌧️ Rain' : '❄️ Snow'}
                </button>
              ))}
            </div>
          </div>

          {/* Time of Day Row */}
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Time of Day:</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {['day', 'evening', 'night'].map(time => (
                <button
                  key={time}
                  onClick={() => setTimeOfDay(time)}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '10px',
                    fontWeight: '600',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    borderColor: timeOfDay === time ? '#818cf8' : 'rgba(255,255,255,0.08)',
                    background: timeOfDay === time ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.03)',
                    color: timeOfDay === time ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {time === 'day' ? '☀️ Day' : time === 'evening' ? '🌅 Eve' : '🌙 Night'}
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
