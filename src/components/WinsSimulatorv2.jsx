import { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { KalmanFilter } from '../utils/kalmanFilter';
import { getCalibratedForces } from '../utils/calibrationUtils';
import { DEFAULT_CALIBRATION, WIND_SIMULATOR_CONFIG } from '../utils/constants';
import thunderSoundUrl from '../assets/thunder.mp3';

// ─── Wind & Thunder Audio Engine ─────────────────────────────────────────────
class ImmersiveAudio {
  constructor() {
    this.ctx = null;
    this.windNoise = null;
    this.windFilter = null;
    this.windGain = null;
    this.isActive = false;
    try {
      this.thunderAudio = new Audio(thunderSoundUrl);
      this.thunderAudio.volume = 0.75;
      this.thunderAudio.load();
    } catch (e) {
      console.warn('[ImmersiveAudio] Failed to pre-create Audio in constructor:', e);
    }
  }

  unlock() {
    if (this.thunderAudio) {
      // Play silently/briefly and pause to unlock audio capability on this tab
      this.thunderAudio.play()
        .then(() => {
          this.thunderAudio.pause();
          this.thunderAudio.currentTime = 0;
          console.log('[ImmersiveAudio] Thunder Audio unlocked successfully');
        })
        .catch(e => {
          console.log('[ImmersiveAudio] Pre-unlock note (normal before interaction):', e.message);
        });
    }
  }

  start() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // Make sure it is unlocked
      this.unlock();

      // Wind Generator
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.windNoise = this.ctx.createBufferSource();
      this.windNoise.buffer = noiseBuffer;
      this.windNoise.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.Q.value = 3.0; // Resonant whistle sound
      this.windFilter.frequency.value = 300;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.05;

      this.windNoise.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.ctx.destination);

      this.windNoise.start(0);
      this.isActive = true;
      console.log('[ImmersiveAudio] Synthesizer initialized successfully');
    } catch (e) {
      console.error('[ImmersiveAudio] Failed to initialize AudioContext:', e);
    }
  }

  setIntensity(speed, direction) {
    if (!this.isActive || !this.ctx) return;
    try {
      // Wind frequency whistle shifts based on direction and speed
      const baseFreq = 260 + speed * 135 + Math.abs(direction) * 85;
      const randomWhistle = Math.sin(Date.now() * 0.005) * 45;
      this.windFilter.frequency.setValueAtTime(
        Math.max(120, baseFreq + randomWhistle),
        this.ctx.currentTime
      );

      // Volume increases with gusts
      const targetVolume = Math.min(0.38, 0.03 + (speed * speed) * 0.007);
      this.windGain.gain.linearRampToValueAtTime(targetVolume, this.ctx.currentTime + 0.12);
    } catch (_) {}
  }

  playThunder() {
    try {
      if (this.thunderAudio) {
        this.thunderAudio.currentTime = 0;
        this.thunderAudio.volume = 0.75;
        const p = this.thunderAudio.play();
        if (p !== undefined) {
          p.catch(e => {
            console.warn('[ImmersiveAudio] Preloaded play failed, attempting fresh play:', e.message);
            const fallback = new Audio(thunderSoundUrl);
            fallback.volume = 0.75;
            fallback.play().catch(fe => console.log('[ImmersiveAudio] Fallback play failed:', fe.message));
          });
        }
      } else {
        const audio = new Audio(thunderSoundUrl);
        audio.volume = 0.75;
        audio.play().catch(e => console.log('[ImmersiveAudio] Play failed:', e.message));
      }
    } catch (err) {
      console.error('[ImmersiveAudio] Failed playing thunder sound:', err);
    }
  }

  stop() {
    this.isActive = false;
    try {
      if (this.windNoise) {
        this.windNoise.stop();
        this.windNoise.disconnect();
      }
      if (this.ctx) {
        this.ctx.close();
      }
    } catch (_) {}
    this.windNoise = null;
    this.ctx = null;
  }
}

// ─── Procedural Curved Palm Leaflet Pair ─────────────────────────────────────
function LeafletPair({ scale, yOffset, length }) {
  return (
    <group position={[0, yOffset, 0]}>
      <mesh position={[-length * 0.44, 0, -length * 0.08]} rotation={[0.1, 0.28, -0.65]} castShadow>
        <boxGeometry args={[length, 0.016 * scale, 0.003]} />
        <meshStandardMaterial color="#15803d" roughness={0.7} flatShading />
      </mesh>
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
    const flutter = Math.sin(state.clock.elapsedTime * (13 + s * 4) + angle) * (0.018 * s);
    const sway = Math.sin(state.clock.elapsedTime * 2.2 + angle) * 0.035;
    if (frondRef.current) {
      frondRef.current.rotation.z = flutter;
      frondRef.current.rotation.x = 0.58 + sway;
    }
  });

  const h = 0.52 * scale; // length of each branch segment

  return (
    <group rotation={[0, angle, 0]}>
      <group ref={frondRef} rotation={[0.58, 0, 0]}>
        {/* Segment 1 */}
        <mesh position={[0, h / 2, 0]} castShadow>
          <cylinderGeometry args={[0.01 * scale, 0.016 * scale, h, 5]} />
          <meshStandardMaterial color="#166534" roughness={0.7} />
        </mesh>
        <LeafletPair scale={scale} yOffset={h * 0.25} length={0.42 * scale} />
        <LeafletPair scale={scale} yOffset={h * 0.6} length={0.5 * scale} />
        <LeafletPair scale={scale} yOffset={h * 0.9} length={0.55 * scale} />

        {/* Segment 2 */}
        <group position={[0, h, 0]} rotation={[0.4, 0, 0]}>
          <mesh position={[0, h / 2, 0]} castShadow>
            <cylinderGeometry args={[0.007 * scale, 0.01 * scale, h, 5]} />
            <meshStandardMaterial color="#15803d" roughness={0.7} />
          </mesh>
          <LeafletPair scale={scale} yOffset={h * 0.25} length={0.55 * scale} />
          <LeafletPair scale={scale} yOffset={h * 0.6} length={0.48 * scale} />
          <LeafletPair scale={scale} yOffset={h * 0.9} length={0.42 * scale} />

          {/* Segment 3 */}
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

    const targetBend = (s * d * 0.075) * (scale * 0.95);
    const swayFreq = 3.6 + s * 1.2;
    const swayAmp = 0.016 * s;
    const sway = Math.sin(state.clock.elapsedTime * swayFreq) * swayAmp;

    segmentsRef.current.forEach((ref, idx) => {
      if (!ref) return;
      const segmentWeight = (idx + 1) / 6;
      ref.rotation.z = targetBend * segmentWeight + sway;
    });
  });

  return (
    <group position={position}>
      <group ref={el => segmentsRef.current[0] = el}>
        <mesh position={[0, segments[0].height / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[segments[0].radiusTop, segments[0].radiusBottom, segments[0].height, 10]} />
          <meshStandardMaterial color="#78350f" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, segments[0].height * 0.3, 0]}>
          <torusGeometry args={[segments[0].radiusBottom * 1.05, 0.028 * scale, 4, 10]} />
          <meshStandardMaterial color="#5c2e0b" roughness={0.9} />
        </mesh>

        <group position={[0, segments[0].height, 0]} ref={el => segmentsRef.current[1] = el}>
          <mesh position={[0, segments[1].height / 2, 0]} castShadow>
            <cylinderGeometry args={[segments[1].radiusTop, segments[1].radiusBottom, segments[1].height, 10]} />
            <meshStandardMaterial color="#78350f" roughness={0.9} flatShading />
          </mesh>

          <group position={[0, segments[1].height, 0]} ref={el => segmentsRef.current[2] = el}>
            <mesh position={[0, segments[2].height / 2, 0]} castShadow>
              <cylinderGeometry args={[segments[2].radiusTop, segments[2].radiusBottom, segments[2].height, 10]} />
              <meshStandardMaterial color="#78350f" roughness={0.9} flatShading />
            </mesh>

            <group position={[0, segments[2].height, 0]} ref={el => segmentsRef.current[3] = el}>
              <mesh position={[0, segments[3].height / 2, 0]} castShadow>
                <cylinderGeometry args={[segments[3].radiusTop, segments[3].radiusBottom, segments[3].height, 10]} />
                <meshStandardMaterial color="#72330d" roughness={0.9} flatShading />
              </mesh>

              <group position={[0, segments[3].height, 0]} ref={el => segmentsRef.current[4] = el}>
                <mesh position={[0, segments[4].height / 2, 0]} castShadow>
                  <cylinderGeometry args={[segments[4].radiusTop, segments[4].radiusBottom, segments[4].height, 10]} />
                  <meshStandardMaterial color="#72330d" roughness={0.9} flatShading />
                </mesh>

                <group position={[0, segments[4].height, 0]} ref={el => segmentsRef.current[5] = el}>
                  <mesh position={[0, segments[5].height / 2, 0]} castShadow>
                    <cylinderGeometry args={[segments[5].radiusTop, segments[5].radiusBottom, segments[5].height, 10]} />
                    <meshStandardMaterial color="#72330d" roughness={0.9} flatShading />
                  </mesh>

                  {/* Coconuts */}
                  <group position={[0, segments[5].height - 0.08 * scale, 0]}>
                    <mesh position={[0.06 * scale, 0, 0.04 * scale]} castShadow>
                      <sphereGeometry args={[0.085 * scale, 8, 8]} />
                      <meshStandardMaterial color="#451a03" roughness={0.95} flatShading />
                    </mesh>
                    <mesh position={[-0.07 * scale, -0.01 * scale, 0.05 * scale]} castShadow>
                      <sphereGeometry args={[0.08 * scale, 8, 8]} />
                      <meshStandardMaterial color="#3f1a04" roughness={0.95} flatShading />
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

// ─── Instanced Swaying Grass Field Component ─────────────────────────────────
function InstancedGrass({ count = 280, speedRef, dirRef }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Spatial distribution on the sloped dunes
  const positions = useMemo(() => {
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: (Math.random() - 0.5) * 7.5,
        z: (Math.random() - 0.5) * 4.5 - 0.8,
        scaleY: 0.16 + Math.random() * 0.22,
        rotY: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return list;
  }, [count]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const s = speedRef.current ?? 1.0;
    const d = dirRef.current ?? 0.0;
    const t = state.clock.elapsedTime;

    positions.forEach((pos, i) => {
      dummy.position.set(pos.x, 0.012, pos.z);
      dummy.rotation.set(0, pos.rotY, 0);

      // Sway dynamically according to the wind direction/speed vectors
      const sway = Math.sin(t * (2.6 + s * 0.8) + pos.phase) * (0.045 * s);
      const push = (s * d * 0.065);

      dummy.rotation.x = sway + push;
      dummy.rotation.z = -sway + push * 0.5;
      dummy.scale.set(0.04, pos.scaleY, 0.04);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]} castShadow receiveShadow>
      <coneGeometry args={[0.3, 1, 4]} />
      <meshStandardMaterial color="#16a34a" roughness={0.9} flatShading />
    </instancedMesh>
  );
}

// ─── Cloud Component ────────────────────────────────────────────────────────
function Cloud({ position, speedRef, timeOfDay }) {
  const meshRef = useRef();

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const s = speedRef.current ?? 1.0;
    meshRef.current.position.x += delta * s * 0.22;
    if (meshRef.current.position.x > 15) {
      meshRef.current.position.x = -15;
    }
  });

  const cloudMaterial = useMemo(() => {
    let color = '#ffffff';
    let emissive = '#ffffff';
    let emissiveIntensity = 0.12;

    if (timeOfDay === 'evening') {
      color = '#382f4d';
      emissive = '#be185d';
      emissiveIntensity = 0.42;
    } else if (timeOfDay === 'night') {
      color = '#111827';
      emissive = '#1e1b4b';
      emissiveIntensity = 0.18;
    }
    return { color, emissive, emissiveIntensity };
  }, [timeOfDay]);

  return (
    <group ref={meshRef} position={position}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.75, 10, 10]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
      <mesh position={[0.62, -0.15, 0.1]} castShadow>
        <sphereGeometry args={[0.55, 8, 8]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
      <mesh position={[-0.62, -0.1, -0.1]} castShadow>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshStandardMaterial color={cloudMaterial.color} roughness={0.9} emissive={cloudMaterial.emissive} emissiveIntensity={cloudMaterial.emissiveIntensity} flatShading />
      </mesh>
    </group>
  );
}

// ─── Wind Particles Component (Rain, Snow, or Drifting Leaves) ────────────────
function WindParticles({ type = 'snow', count = 120, speedRef, dirRef, timeOfDay }) {
  const pointsRef = useRef();

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
        p.y -= delta * (9.0 + windSpeed * 2.2) * p.speedScale;
        p.x += delta * windSpeed * 4.5 * windDir * p.speedScale;
      } else if (type === 'leaves') {
        p.y -= delta * (0.4 + windSpeed * 0.15) * p.speedScale;
        p.x += delta * windSpeed * 4.2 * windDir * p.speedScale;
        p.x += Math.sin(state.clock.elapsedTime * 2.2 + idx) * 0.005;
      } else {
        p.y -= delta * (0.8 + windSpeed * 0.3) * p.speedScale;
        p.x += delta * windSpeed * 3.5 * windDir * p.speedScale;
        p.x += Math.sin(state.clock.elapsedTime * 1.8 + idx) * 0.003;
      }

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

// ─── Animated Seagulls ────────────────────────────────────────────────────────
function Bird({ startPos, radius, speed, height, wingSpeed, speedRef }) {
  const groupRef = useRef();
  const leftWingRef = useRef();
  const rightWingRef = useRef();

  useFrame((state) => {
    if (!groupRef.current) return;
    const s = speedRef.current ?? 1.0;
    const t = state.clock.elapsedTime;

    const angle = t * speed + startPos;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    groupRef.current.position.set(x, height, z);
    groupRef.current.rotation.y = angle + Math.PI / 2;

    const flap = Math.sin(t * (wingSpeed + s * 1.5)) * 0.45;
    if (leftWingRef.current) leftWingRef.current.rotation.z = flap;
    if (rightWingRef.current) rightWingRef.current.rotation.z = -flap;
  });

  const scale = 0.55;

  return (
    <group ref={groupRef}>
      <mesh castShadow>
        <boxGeometry args={[0.07 * scale, 0.07 * scale, 0.3 * scale]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.8} />
      </mesh>
      <group position={[-0.035 * scale, 0, 0]} ref={leftWingRef}>
        <mesh position={[-0.2 * scale, 0, 0]} castShadow>
          <boxGeometry args={[0.4 * scale, 0.01 * scale, 0.12 * scale]} />
          <meshStandardMaterial color="#475569" roughness={0.85} />
        </mesh>
      </group>
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
        transmission={0.55}
        thickness={0.8}
        ior={1.333}
        clearcoat={1.0}
        clearcoatRoughness={0.05}
      />
    </mesh>
  );
}

// ─── Sand Dunes & Ground Details ─────────────────────────────────────────────
function SandDunes({ climate, speedRef, dirRef }) {
  const duneGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(24, 20, 20, 16);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const slope = -(y + 1) * 0.075;
      const height = Math.sin(x * 0.28) * Math.cos(y * 0.28) * 0.15 + slope;
      pos.setZ(i, height);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={duneGeo} receiveShadow>
        <meshStandardMaterial
          color={climate === 'snowy' ? '#f1f5f9' : '#fed7aa'}
          roughness={0.96}
        />
      </mesh>

      {/* Decorative rocks */}
      <mesh position={[-2.4, 0.05, 0.6]} rotation={[0.2, 0.5, 0.1]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color="#64748b" roughness={0.8} />
      </mesh>
      <mesh position={[2.1, 0.02, 0.9]} rotation={[0.4, -0.3, 0.2]} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#475569" roughness={0.85} />
      </mesh>

      {/* Swaying grass tufts field */}
      <InstancedGrass count={240} speedRef={speedRef} dirRef={dirRef} />
    </group>
  );
}

// ─── Celestial Object (Sun / Moon) ──────────────────────────────────────────
function CelestialObject({ timeOfDay, climate }) {
  const meshRef = useRef();

  useFrame((state) => {
    if (!meshRef.current) return;
    const s = 1 + Math.sin(state.clock.elapsedTime * 0.7) * 0.04;
    meshRef.current.scale.set(s, s, s);
  });

  if (climate === 'monsoon') return null;

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

// ─── Shore Foam Component ────────────────────────────────────────────────────
function ShoreFoam({ speedRef }) {
  const meshRef = useRef();

  useFrame((state) => {
    if (!meshRef.current) return;
    const s = speedRef.current ?? 1.0;
    const t = state.clock.elapsedTime;
    const slide = Math.sin(t * (1.1 + s * 0.18)) * 0.16 - 0.3;
    meshRef.current.position.z = slide;
    meshRef.current.material.opacity = 0.22 + Math.sin(t * 2.2) * 0.08;
  });

  return (
    <mesh ref={meshRef} position={[0, 0.006, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[22, 0.35]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} />
    </mesh>
  );
}

// ─── Fireflies Component ─────────────────────────────────────────────────────
function Firefly({ startPos, speed }) {
  const meshRef = useRef();
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const x = startPos[0] + Math.sin(t * speed + startPos[3]) * 0.5;
    const y = startPos[1] + Math.cos(t * speed * 0.8) * 0.35;
    const z = startPos[2] + Math.sin(t * speed * 1.2) * 0.5;
    meshRef.current.position.set(x, y, z);
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
      (Math.random() - 0.5) * 5.0,
      0.2 + Math.random() * 1.8,
      (Math.random() - 0.5) * 3.5 - 0.8,
      Math.random() * Math.PI * 2
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

// ─── Cinematic Dynamic Camera Controller ─────────────────────────────────────
function CinematicCamera({ speedRef, motion, cameraDistance }) {
  const { gyro } = motion || {};
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const windSpeed = speedRef.current ?? 1.0;

    const idleX = Math.sin(t * 0.22) * 0.28;
    const idleY = Math.cos(t * 0.18) * 0.12;

    const gyroX = gyro?.x ? (gyro.x / 450) : 0;
    const gyroY = gyro?.y ? (gyro.y / 450) : 0;

    const shakeScale = Math.min(1.0, windSpeed / 6.0);
    const shakeX = Math.sin(t * 44) * (shakeScale * 0.008);
    const shakeY = Math.cos(t * 40) * (shakeScale * 0.008);

    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, idleX + gyroY * 0.8 + shakeX, 0.05);
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, 1.25 + idleY - gyroX * 0.8 + shakeY, 0.05);
    state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, cameraDistance + (windSpeed * 0.03), 0.05);

    state.camera.lookAt(0, 1.45, -1.2);
  });
  return null;
}

// ─── Main Wind Simulator V2 Component ────────────────────────────────────────
export default function WinsSimulatorv2({ motion, env, ui, status, calibration }) {
  const isConnected = status === 'connected';
  const { euler, accel, gyro } = motion || {};
  const { airQuality, temperature, humidity, pressure } = env || {};
  const { isButtonPressed } = ui || {};

  const [sceneKey, setSceneKey] = useState(0);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [manualCO2, setManualCO2] = useState(550);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [cameraDistance, setCameraDistance] = useState(3.8);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);

  const [climate, setClimate] = useState('sunny');
  const [timeOfDay, setTimeOfDay] = useState('day');
  const [isAutoSensors, setIsAutoSensors] = useState(true);

  // Lightning state
  const [lightningFlash, setLightningFlash] = useState(0);
  const prevButtonPressedRef = useRef(false);

  const windWrapperRef = useRef(null);
  const audioInstance = useMemo(() => new ImmersiveAudio(), []);

  const [baselineCO2, setBaselineCO2] = useState(500);
  const co2HistoryRef = useRef([]);

  const currentCO2 = isConnected && airQuality?.eco2 ? airQuality.eco2 : manualCO2;

  // Register document-level click listener to unlock thunder audio
  useEffect(() => {
    const handleUnlock = () => {
      audioInstance.unlock();
      window.removeEventListener('click', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
    };
    window.addEventListener('click', handleUnlock);
    window.addEventListener('touchstart', handleUnlock);
    return () => {
      window.removeEventListener('click', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
    };
  }, [audioInstance]);

  // Process physical button press → trigger lightning flash & thunder sound
  useEffect(() => {
    if (isConnected && isButtonPressed && !prevButtonPressedRef.current) {
      setLightningFlash(3.2);
      audioInstance.playThunder();
    }
    prevButtonPressedRef.current = !!isButtonPressed;
  }, [isButtonPressed, isConnected, audioInstance]);

  // Decay lightning flash back to 0
  useEffect(() => {
    let animId;
    const decay = () => {
      setLightningFlash(f => {
        if (f <= 0) return 0;
        animId = requestAnimationFrame(decay);
        return Math.max(0, f - 0.14);
      });
    };
    if (lightningFlash > 0) {
      animId = requestAnimationFrame(decay);
    }
    return () => cancelAnimationFrame(animId);
  }, [lightningFlash]);

  // Automatically update climate from temperature and humidity
  useEffect(() => {
    if (isConnected && isAutoSensors) {
      if (temperature !== null) {
        if (temperature < 21) {
          setClimate('snowy');
        } else if (temperature >= 21 && humidity !== null && humidity > 68) {
          setClimate('monsoon');
        } else {
          setClimate('sunny');
        }
      }
    }
  }, [temperature, humidity, isConnected, isAutoSensors]);

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
    if (timeOfDay === 'evening') return '#701a75';
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
    if (timeOfDay === 'evening') return [0, 0.9, -7.0];
    if (timeOfDay === 'night') return [0, 4.0, -8.0];
    return [5, 10, 3];
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

  // Fog density mapped to physical sensor humidity
  const dynamicFogDensity = useMemo(() => {
    if (isConnected && humidity !== null) {
      return 0.005 + (humidity / 100.0) * 0.04;
    }
    return climate === 'monsoon' ? 0.035 : climate === 'snowy' ? 0.026 : 0.008;
  }, [climate, humidity, isConnected]);

  // CO2 Baseline Tracking
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

  useEffect(() => {
    return () => audioInstance.stop();
  }, [audioInstance]);

  // Sync fullscreen state
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

  const toggleAudio = () => {
    if (isAudioEnabled) {
      audioInstance.stop();
      setIsAudioEnabled(false);
    } else {
      audioInstance.start();
      setIsAudioEnabled(true);
    }
  };

  // Compute live wind parameters
  const rawWindSpeed = 0.8 + Math.max(0.0, (currentCO2 - baselineCO2) / 100);
  const windSpeed = parseFloat(Math.min(6.5, rawWindSpeed).toFixed(2));

  // Determine wind direction left/right using Kalman-filtered relative rotation
  const kxRef = useRef(null);
  if (!kxRef.current) {
    kxRef.current = new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR });
  }
  
  const rawForces = getCalibratedForces(motion, calibration);
  const cx = kxRef.current.filter(rawForces.cx);
  const forces = { cx, cy: 0, cz: 0 };

  // Divide by ~30 instead of 8.5 because calibrated Euler forces are scaled to ~45 at the limit
  const relativeX = forces.cx * WIND_SIMULATOR_CONFIG.wind.relativeForceScale;
  const windDirection = parseFloat(Math.max(-1.5, Math.min(1.5, relativeX / 30.0)).toFixed(2));

  const speedRef = useRef(windSpeed);
  const dirRef = useRef(windDirection);

  useEffect(() => {
    speedRef.current = windSpeed;
    dirRef.current = windDirection;
    if (isAudioEnabled) {
      audioInstance.setIntensity(windSpeed, windDirection);
    }
  }, [windSpeed, windDirection, isAudioEnabled, audioInstance]);

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
            <span>🌬️</span> Coastal Wind Simulator v2
          </h3>
          <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {isConnected
              ? 'Breathe rapidly onto sensor to generate heavy wind! Press physical Button to trigger lightning.'
              : 'Interact using the manual controls below or connect your Thingy:52.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={() => setIsAutoSensors(prev => !prev)}
            className="btn-action"
            style={{
              background: isAutoSensors ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255,255,255,0.03)',
              border: isAutoSensors ? '1px solid #38bdf8' : '1px solid var(--glass-border)',
              color: isAutoSensors ? '#38bdf8' : '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            {isAutoSensors ? '🤖 Auto Climate: On' : '🛠️ Manual Climate'}
          </button>

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
            onClick={() => {
              setLightningFlash(3.2);
              audioInstance.playThunder();
            }}
            className="btn-action"
            style={{
              background: 'rgba(250, 204, 21, 0.15)',
              border: '1px solid #facc15',
              color: '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            ⚡ Test Lightning
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
            }}
          >
            {isFullscreen ? '📺 Shrink' : '📺 Full Screen'}
          </button>
        </div>
      </div>

      {/* Main 3D Canvas */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {/* Floating Help Modal Overlay */}
        {isHowItWorksOpen && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              right: '12px',
              bottom: '12px',
              background: 'rgba(7, 11, 20, 0.95)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              color: '#fff',
              zIndex: 100,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              backdropFilter: 'blur(15px)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px' }}>
              <h4 style={{ margin: 0, fontSize: 'var(--text-sm)', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⚙️</span> Telemetry Engine Mappings (Manual vs Auto)
              </h4>
              <button
                onClick={() => setIsHowItWorksOpen(false)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '18px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: '11px', lineHeight: '1.6', display: 'flex', flexDirection: 'column', gap: '10px', color: '#94a3b8' }}>
              <p style={{ margin: 0 }}>
                Wind Simulator V2 features a dual-mode telemetry controller. Connect your Thingy:52 to enable <strong>Auto Mode</strong>, or switch to <strong>Manual Mode</strong> to override the environment.
              </p>
              
              <div>
                <strong style={{ color: '#f8fafc', display: 'block', marginBottom: '2px' }}>🤖 AUTO MODE (Thingy:52 Active):</strong>
                <div style={{ paddingLeft: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>• <strong>Wind Gusts (eCO2):</strong> Blowing on the sensor spikes eCO2 levels, simulating heavy winds and whistling sound pitches.</span>
                  <span>• <strong>Wind Steering (Accel):</strong> Tilting the device left/right uses raw accelerometer math to steer wind direction.</span>
                  <span>• <strong>Seasonal Climate (Temp):</strong> Switches automatically to <strong>❄️ Snowy</strong> if Temp &lt; 21.0°C; switches to <strong>🌧️ Rain</strong> if Temp &ge; 21.0°C and Humidity &gt; 68%; otherwise displays <strong>☀️ Sunny</strong>.</span>
                  <span>• <strong>Storm Trigger (Button):</strong> Clicking the physical button on the Thingy:52 triggers a lightning flash and plays an authentic thunder sound file.</span>
                  <span>• <strong>Atmosphere (Humidity & Pressure):</strong> Humidity controls 3D fog density; barometric pressure scales cloud speeds.</span>
                </div>
              </div>

              <div>
                <strong style={{ color: '#f8fafc', display: 'block', marginBottom: '2px' }}>🛠️ MANUAL MODE:</strong>
                <div style={{ paddingLeft: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>• Use the Climate selector (☀️, 🌧️, ❄️) to override the weather.</span>
                  <span>• Adjust time of day (Day, Sunset Eve, Night Starfield) manually.</span>
                  <span>• Drag the eCO2 slider at the bottom to simulate blowing breath intensity.</span>
                  <span>• Use the Camera Distance slider to zoom in or out.</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsHowItWorksOpen(false)}
              style={{
                marginTop: 'auto',
                background: '#38bdf8',
                color: '#070b14',
                border: 'none',
                padding: '8px',
                borderRadius: '4px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '11px',
                transition: 'background 0.2s',
              }}
            >
              Got it, let's explore!
            </button>
          </div>
        )}

        <Canvas key={sceneKey} shadows camera={{ position: [0, 1.25, 3.8], fov: 45 }}>
          {/* Dynamic lighting config */}
          <ambientLight color={ambientColor} intensity={lightConfig.ambientIntensity + lightningFlash * 1.5} />
          <directionalLight
            position={directLightPosition}
            intensity={lightConfig.directIntensity + lightningFlash * 3.5}
            color={lightningFlash > 0 ? '#ffffff' : lightConfig.directColor}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          {/* Horizon Atmospheric Fog */}
          <fog attach="fog" args={[skyColor, 6, 20]} />

          {/* Cinematic Dynamic Camera Control */}
          <CinematicCamera speedRef={speedRef} motion={motion} cameraDistance={cameraDistance} />

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
            <SandDunes climate={climate} speedRef={speedRef} dirRef={dirRef} />
            <Ocean climate={climate} speedRef={speedRef} />
            <ShoreFoam speedRef={speedRef} />

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
                ? 'leaves'
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
            target={[0, 1.45, -1.2]}
            maxPolarAngle={Math.PI / 2 - 0.08}
          />
        </Canvas>

        {/* Live Telemetry Display HUD overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            right: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {/* Diagnostics Panel */}
          <div
            style={{
              background: 'rgba(7, 11, 20, 0.78)',
              border: '1px solid var(--glass-border)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              backdropFilter: 'blur(10px)',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              width: '270px',
            }}
          >
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'bold', color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '4px' }}>
              📊 TELEMETRY ENGINE
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Wind Speed:</span>
                <span style={{ fontFamily: 'monospace', color: '#34d399' }}>{windSpeed}x (Gusting)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Wind Direction:</span>
                <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{windDirection > 0 ? `Right (${windDirection})` : windDirection < 0 ? `Left (${windDirection})` : 'Neutral'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Temperature:</span>
                <span style={{ fontFamily: 'monospace', color: '#fb923c' }}>{temperature !== null ? `${temperature.toFixed(1)} °C` : 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Humidity / Fog:</span>
                <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{humidity !== null ? `${humidity.toFixed(0)}% (Fog: ${(dynamicFogDensity * 100).toFixed(1)}%)` : 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Pressure:</span>
                <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>{pressure !== null ? `${pressure.toFixed(1)} hPa` : 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Physical Button:</span>
                <span style={{ fontFamily: 'monospace', color: isButtonPressed ? '#ef4444' : '#9ca3af', fontWeight: isButtonPressed ? 'bold' : 'normal' }}>
                  {isButtonPressed ? '🔴 Pressed (Lightning!)' : '⚪ Released'}
                </span>
              </div>
            </div>
          </div>

          {/* Local fallback controls card */}
          <div
            style={{
              background: 'rgba(7, 11, 20, 0.78)',
              border: '1px solid var(--glass-border)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              backdropFilter: 'blur(10px)',
              pointerEvents: 'auto',
              width: '280px',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#fff', fontWeight: '600' }}>Climate Control</span>
              <button
                onClick={() => setIsHowItWorksOpen(prev => !prev)}
                style={{
                  background: isHowItWorksOpen ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--glass-border)',
                  color: '#38bdf8',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                ❓ Help
              </button>
            </div>

            {/* Pill selector for Auto vs Manual */}
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.22)', padding: '2px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)', gap: '2px' }}>
              <button
                onClick={() => setIsAutoSensors(true)}
                style={{
                  flex: 1,
                  background: isAutoSensors ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  border: isAutoSensors ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                  color: isAutoSensors ? '#38bdf8' : '#94a3b8',
                  borderRadius: '3px',
                  padding: '2px 0',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                🤖 Auto {isConnected ? 'Active' : ''}
              </button>
              <button
                onClick={() => setIsAutoSensors(false)}
                style={{
                  flex: 1,
                  background: !isAutoSensors ? 'rgba(255,255,255,0.1)' : 'transparent',
                  border: !isAutoSensors ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent',
                  color: !isAutoSensors ? '#ffffff' : '#94a3b8',
                  borderRadius: '3px',
                  padding: '2px 0',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                🛠️ Manual
              </button>
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                disabled={isAutoSensors && isConnected}
                onClick={() => setClimate('sunny')}
                style={{
                  flex: 1,
                  background: climate === 'sunny' ? 'rgba(250, 204, 21, 0.2)' : 'rgba(255,255,255,0.03)',
                  border: climate === 'sunny' ? '1px solid #facc15' : '1px solid var(--glass-border)',
                  color: climate === 'sunny' ? '#facc15' : '#fff',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '10px',
                  cursor: (isAutoSensors && isConnected) ? 'not-allowed' : 'pointer',
                  opacity: (isAutoSensors && isConnected) ? 0.4 : 1,
                }}
              >
                ☀️ Sunny
              </button>
              <button
                disabled={isAutoSensors && isConnected}
                onClick={() => setClimate('monsoon')}
                style={{
                  flex: 1,
                  background: climate === 'monsoon' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.03)',
                  border: climate === 'monsoon' ? '1px solid #38bdf8' : '1px solid var(--glass-border)',
                  color: climate === 'monsoon' ? '#38bdf8' : '#fff',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '10px',
                  cursor: (isAutoSensors && isConnected) ? 'not-allowed' : 'pointer',
                  opacity: (isAutoSensors && isConnected) ? 0.4 : 1,
                }}
              >
                🌧️ Rain
              </button>
              <button
                disabled={isAutoSensors && isConnected}
                onClick={() => setClimate('snowy')}
                style={{
                  flex: 1,
                  background: climate === 'snowy' ? 'rgba(241, 245, 249, 0.2)' : 'rgba(255,255,255,0.03)',
                  border: climate === 'snowy' ? '1px solid #cbd5e1' : '1px solid var(--glass-border)',
                  color: climate === 'snowy' ? '#cbd5e1' : '#fff',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '10px',
                  cursor: (isAutoSensors && isConnected) ? 'not-allowed' : 'pointer',
                  opacity: (isAutoSensors && isConnected) ? 0.4 : 1,
                }}
              >
                ❄️ Snowy
              </button>
            </div>

            <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
              <button
                onClick={() => setTimeOfDay('day')}
                style={{
                  flex: 1,
                  background: timeOfDay === 'day' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                  border: timeOfDay === 'day' ? '1px solid #fff' : '1px solid var(--glass-border)',
                  color: '#fff',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                ☀️ Day
              </button>
              <button
                onClick={() => setTimeOfDay('evening')}
                style={{
                  flex: 1,
                  background: timeOfDay === 'evening' ? 'rgba(249, 115, 22, 0.2)' : 'rgba(255,255,255,0.03)',
                  border: timeOfDay === 'evening' ? '1px solid #f97316' : '1px solid var(--glass-border)',
                  color: '#f97316',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                🌇 Eve
              </button>
              <button
                onClick={() => setTimeOfDay('night')}
                style={{
                  flex: 1,
                  background: timeOfDay === 'night' ? 'rgba(129, 140, 248, 0.2)' : 'rgba(255,255,255,0.03)',
                  border: timeOfDay === 'night' ? '1px solid #818cf8' : '1px solid var(--glass-border)',
                  color: '#818cf8',
                  borderRadius: '4px',
                  padding: '4px 0',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                🌑 Night
              </button>
            </div>

            {/* Camera distance slider */}
            <div style={{ marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '4px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span>📸 Camera Distance</span>
                <span style={{ color: '#fff', fontFamily: 'monospace' }}>{cameraDistance.toFixed(1)}m</span>
              </label>
              <input
                type="range"
                min="2.0"
                max="7.5"
                step="0.1"
                value={cameraDistance}
                onChange={(e) => setCameraDistance(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#818cf8', cursor: 'pointer' }}
              />
            </div>

            {!isConnected && (
              <div style={{ marginTop: 'var(--space-2)', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 'var(--space-2)' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>Blow Breath (eCO2 Simulator)</span>
                  <span style={{ color: '#fff', fontFamily: 'monospace' }}>{manualCO2} ppm</span>
                </label>
                <input
                  type="range"
                  min="400"
                  max="1400"
                  value={manualCO2}
                  onChange={(e) => setManualCO2(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#34d399', cursor: 'pointer' }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
