import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { KalmanFilter } from '../utils/kalmanFilter';
import { getCalibratedForces } from '../utils/calibrationUtils';
import { DEFAULT_CALIBRATION, CANDLE_CONFIG } from '../utils/constants';

// --- Particle System for Smoke ---
function SmokeParticles({ active, position }) {
  const groupRef = useRef();

  const particles = useMemo(() => {
    return Array.from({ length: CANDLE_CONFIG.particles.numSmoke }).map(() => ({
      x: (Math.random() - 0.5) * 0.2,
      y: Math.random() * 0.5,
      z: (Math.random() - 0.5) * 0.2,
      speed: 0.5 + Math.random() * 1.5,
      life: Math.random(),
      scale: 0.1 + Math.random() * 0.2,
    }));
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    groupRef.current.children.forEach((child, i) => {
      const p = particles[i];
      if (active) {
        p.life += delta * p.speed;
        if (p.life > 1) {
          p.life = 0;
          p.x = (Math.random() - 0.5) * 0.2;
          p.y = 0;
          p.z = (Math.random() - 0.5) * 0.2;
        }
        child.position.set(p.x, p.y + p.life * 2, p.z);
        child.scale.setScalar(p.scale * (1 - p.life));
        child.material.opacity = (1 - p.life) * 0.5;
        child.visible = true;
      } else {
        child.visible = false;
      }
    });
  });

  return (
    <group ref={groupRef} position={position}>
      {particles.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// --- Shader Flame ---
const flameVertexShader = `
uniform float uTime;
uniform float uWindForce;
uniform float uTiltX;
uniform float uTiltY;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 pos = position;
  
  // Height factor (0 at bottom, 1 at top)
  float h = uv.y;
  
  // Bend top of the flame
  float bend = h * h; // Quadratic curve
  
  // Wind fluttering
  float flutterX = sin(uTime * 15.0 + pos.y * 5.0) * (uWindForce * 0.2);
  float flutterZ = cos(uTime * 17.0 + pos.y * 5.0) * (uWindForce * 0.2);
  
  // Apply bend based on wind and physical tilt
  pos.x += bend * (flutterX + uTiltX * 0.5 + uWindForce * 0.5);
  pos.z += bend * (flutterZ + uTiltY * 0.5);
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const flameFragmentShader = `
uniform float uTime;
uniform float uWindForce;
varying vec2 vUv;

// Simplex noise function
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i); // Avoid truncation effects in permutation
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
		+ i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = vUv;
  
  // Teardrop shape function
  // Center is at 0.5, 0.0. Scale x so it pinches at the top
  float x = uv.x * 2.0 - 1.0;
  float y = uv.y;
  
  // Add procedural noise that moves upward faster
  float n = snoise(vec2(x * 2.0, y * 3.0 - uTime * 6.0)) * 0.15;
  
  // Base width of the flame - make it breathe and pulse
  float width = (0.4 + 0.1 * sin(uTime * 10.0)) * (1.0 - y);
  
  // Distance from center line
  float d = abs(x) - n;
  
  // Alpha falloff
  float alpha = smoothstep(width, width * 0.3, d);
  
  // Fade out at very top and very bottom. Dynamic top height makes the flame "grow"
  float topHeight = 0.7 + 0.3 * snoise(vec2(uTime * 5.0, 0.0));
  alpha *= smoothstep(1.0, topHeight, y) * smoothstep(0.0, 0.1, y);
  
  // Colors
  vec3 cBright = ${CANDLE_CONFIG.flame.coreColorGLSL}; // White/Yellow core
  vec3 cMid = ${CANDLE_CONFIG.flame.midColorGLSL};    // Orange
  vec3 cDark = ${CANDLE_CONFIG.flame.edgeColorGLSL};   // Deep red edge
  
  // Color gradient based on distance from center and height
  float colorMix = (d / width) + (y * 0.5);
  
  vec3 finalColor = mix(cBright, cMid, smoothstep(0.0, 0.5, colorMix));
  finalColor = mix(finalColor, cDark, smoothstep(0.5, 1.0, colorMix));
  
  // Dim flame when blown hard
  finalColor *= max(0.0, 1.0 - uWindForce * 0.5);
  
  gl_FragColor = vec4(finalColor, alpha);
}
`;

function ShaderFlame({ isLit, windForce, tiltX, tiltY }) {
  const materialRef = useRef();
  const lightRef = useRef();
  const meshRef = useRef();
  const scaleRef = useRef(1);

  useFrame((state) => {
    if (!materialRef.current) return;

    const time = state.clock.elapsedTime;

    // Update uniforms
    materialRef.current.uniforms.uTime.value = time;

    if (isLit) {
      materialRef.current.uniforms.uWindForce.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uWindForce.value, windForce, 0.1);
      materialRef.current.uniforms.uTiltX.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uTiltX.value, tiltX, 0.1);
      materialRef.current.uniforms.uTiltY.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uTiltY.value, tiltY, 0.1);

      const flicker = Math.sin(time * 20) * 0.05 + Math.sin(time * 33) * 0.05;
      const targetScale = Math.max(0.001, 1 - windForce * 0.5 + flicker);
      scaleRef.current = THREE.MathUtils.lerp(scaleRef.current, targetScale, 0.2);

      if (lightRef.current) {
        lightRef.current.intensity = THREE.MathUtils.lerp(lightRef.current.intensity, CANDLE_CONFIG.flame.lightIntensityBase + flicker * 2 - windForce, 0.2);
      }
    } else {
      materialRef.current.uniforms.uWindForce.value = THREE.MathUtils.lerp(materialRef.current.uniforms.uWindForce.value, 0, 0.1);
      scaleRef.current = THREE.MathUtils.lerp(scaleRef.current, 0.001, 0.2);

      if (lightRef.current) {
        lightRef.current.intensity = THREE.MathUtils.lerp(lightRef.current.intensity, 0, 0.2);
      }
    }
    
    if (meshRef.current) {
      meshRef.current.scale.set(scaleRef.current * 0.8, scaleRef.current * 1.2, 1);
    }
  });

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWindForce: { value: 0 },
    uTiltX: { value: 0 },
    uTiltY: { value: 0 },
  }), []);

  return (
    <group position={[0, 0.35, 0]}>
      <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
        <mesh ref={meshRef} scale={[0.8, 1.2, 1]}>
          <planeGeometry args={[1, 1, 16, 16]} />
          <shaderMaterial
            ref={materialRef}
            vertexShader={flameVertexShader}
            fragmentShader={flameFragmentShader}
            uniforms={uniforms}
            transparent={true}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </Billboard>
      <pointLight
        ref={lightRef}
        color={CANDLE_CONFIG.flame.lightColor}
        intensity={CANDLE_CONFIG.flame.lightIntensityBase}
        distance={10}
        decay={2}
        castShadow
      />
    </group>
  );
}

// --- Shader Wax ---
const waxVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vNormal;

// Simplex noise function
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,  0.366025403784439, -0.577350269189626,  0.024390243902439); 
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i); 
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ; m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vUv = uv;
  vNormal = normal;
  vec3 pos = position;
  
  // The cylinder height is CANDLE_CONFIG.wax.height, so y goes from -height/2 to height/2
  
  // Melted Pool (Top surface)
  if (normal.y > 0.5) {
     float dist = length(pos.xz);
     // Push down center (max radius is 0.35)
     float dip = smoothstep(0.35, 0.0, dist) * 0.15;
     pos.y -= dip;
     
     // Uneven rim
     float rimNoise = snoise(vec2(pos.x * 10.0, pos.z * 10.0)) * 0.05;
     pos.y += rimNoise * smoothstep(0.2, 0.35, dist);
  }
  
  // Drips (Sides)
  if (abs(normal.y) < 0.5) {
     // Use noise to create vertical streaks that slowly move down
     float angle = atan(pos.z, pos.x);
     float streakNoise = snoise(vec2(angle * 4.0, pos.y * 3.0 + uTime * 0.3));
     
     // Only protrude outwards
     float protrude = max(0.0, streakNoise) * 0.06;
     
     // Taper drips near the bottom (fade out below y = -0.5)
     protrude *= smoothstep(-0.5, 1.0, pos.y);
     
     pos.xz += normalize(pos.xz) * protrude;
  }
  
  vPosition = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const waxFragmentShader = `
uniform float uTime;
uniform float uIsLit;
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vNormal;

// Simplex noise (reusing logic conceptually)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439); 
  vec2 i  = floor(v + dot(v, C.yy) ); vec2 x0 = v - i + dot(i, C.xx); vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0); vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i); vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 )); vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0); m = m*m ; m = m*m ; vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h ); vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw; return 130.0 * dot(m, g);
}

void main() {
  // Base wax color
  vec3 baseColor = ${CANDLE_CONFIG.wax.baseColorGLSL};
  
  // Add subtle texture noise
  float texNoise = snoise(vec2(vPosition.x * 5.0, vPosition.y * 5.0)) * 0.03;
  vec3 color = baseColor + texNoise;
  
  // Fake Sub-Surface Scattering (SSS) Glow
  // The top of the cylinder is at y = height/2
  float distFromTop = ${CANDLE_CONFIG.wax.height / 2.0} - vPosition.y;
  
  // Glow is strongest at the top and decays exponentially
  float glowIntensity = exp(-distFromTop * 3.5) * uIsLit;
  
  vec3 glowColor = ${CANDLE_CONFIG.wax.glowColorGLSL};
  
  // Add glow to base color
  color += glowColor * glowIntensity * 1.5;
  
  // Basic fake lighting (diffuse + ambient)
  // Light from the flame (above) + slight ambient room light
  vec3 flameLightDir = normalize(vec3(0.0, 1.0, 0.0));
  vec3 roomLightDir = normalize(vec3(0.5, 0.2, 0.5));
  
  float diffFlame = max(0.0, dot(normalize(vNormal), flameLightDir)) * uIsLit * 0.8;
  float diffRoom = max(0.0, dot(normalize(vNormal), roomLightDir)) * 0.2;
  
  vec3 ambient = vec3(0.05, 0.05, 0.08); // Dark blueish ambient
  
  // Mix diffuse with SSS
  // SSS acts as self-illumination, so we add it to the lit color
  vec3 finalColor = color * (ambient + vec3(diffFlame + diffRoom) + glowIntensity);
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

function ShaderWax({ isLit }) {
  const materialRef = useRef();
  const litStrength = useRef(isLit ? 1.0 : 0.0);

  useFrame((state) => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;

    // Smoothly transition glow based on isLit
    const target = isLit ? 1.0 : 0.0;
    litStrength.current = THREE.MathUtils.lerp(litStrength.current, target, 0.1);
    materialRef.current.uniforms.uIsLit.value = litStrength.current;
  });

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIsLit: { value: isLit ? 1.0 : 0.0 },
  }), []);

  return (
    <mesh position={[0, CANDLE_CONFIG.wax.height / 2, 0]} castShadow receiveShadow>
      {/* High segment count for vertex displacement (radial, height) */}
      <cylinderGeometry args={[CANDLE_CONFIG.wax.radius, CANDLE_CONFIG.wax.radius, CANDLE_CONFIG.wax.height, 64, 64]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={waxVertexShader}
        fragmentShader={waxFragmentShader}
        uniforms={uniforms}
      // Need to wireframe: false, but standard shaderMaterial handles it
      />
    </mesh>
  );
}

// --- Shader Background ---
const bgVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const bgFragmentShader = `
uniform float uTime;
uniform float uIsLit;
varying vec2 vUv;

// Simplex noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439); 
  vec2 i  = floor(v + dot(v, C.yy) ); vec2 x0 = v - i + dot(i, C.xx); vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0); vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i); vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 )); vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0); m = m*m ; m = m*m ; vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h ); vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw; return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = vUv;
  
  // Center is at 0.5, 0.5
  float dist = distance(uv, vec2(0.5, 0.5));
  
  // Subtle flicker using noise and time
  float flicker = snoise(vec2(uTime * 2.0, 0.0)) * 0.03;
  
  // Radial vignette intensity
  float intensity = smoothstep(0.8, 0.0, dist + flicker) * uIsLit;
  
  // Add some film grain/noise to the background wall
  float grain = snoise(uv * 100.0) * 0.03;
  intensity += grain * uIsLit * smoothstep(0.8, 0.2, dist);
  
  // Warm yellow glow color
  vec3 glowColor = vec3(0.8, 0.5, 0.1);
  vec3 darkColor = vec3(0.0, 0.0, 0.0);
  
  // Final color
  vec3 color = mix(darkColor, glowColor, intensity);
  
  // Fade to pitch black when not lit
  color *= uIsLit;
  
  gl_FragColor = vec4(color, 1.0);
}
`;

function ShaderBackground({ isLit }) {
  const materialRef = useRef();
  const litStrength = useRef(isLit ? 1.0 : 0.0);

  useFrame((state) => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    
    const target = isLit ? 1.0 : 0.0;
    litStrength.current = THREE.MathUtils.lerp(litStrength.current, target, 0.1);
    materialRef.current.uniforms.uIsLit.value = litStrength.current;
  });

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIsLit: { value: isLit ? 1.0 : 0.0 },
  }), []);

  return (
    <Billboard follow={true} lockX={false} lockY={false} lockZ={false} position={[0, 1.5, -10]}>
      <mesh scale={[30, 20, 1]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={bgVertexShader}
          fragmentShader={bgFragmentShader}
          uniforms={uniforms}
          depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}

function RoomEnvironment({ isLit }) {
  const ambientRef = useRef();
  const bgRef = useRef();

  useFrame(() => {
    if (!ambientRef.current || !bgRef.current) return;
    
    // When lit, ambient is a slight warm yellow. When out, it's pitch black.
    const targetAmbient = isLit ? 0.2 : 0.0;
    ambientRef.current.intensity = THREE.MathUtils.lerp(ambientRef.current.intensity, targetAmbient, 0.1);

    // Background color lerp
    const targetBg = isLit ? new THREE.Color('#1c150c') : new THREE.Color('#000000');
    bgRef.current.lerp(targetBg, 0.1);
  });

  return (
    <>
      <color ref={bgRef} attach="background" args={['#000000']} />
      <ambientLight ref={ambientRef} color="#ffcc66" intensity={0} />
      
      {/* Procedural Background replaces rigid walls */}
      <ShaderBackground isLit={isLit} />

      {/* Table */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[2, 2, 0.2, 32]} />
        <meshStandardMaterial color="#52525b" roughness={0.8} />
      </mesh>
    </>
  );
}

// --- Main Scene ---
export default function CandleSimulator({ motion, env, status, calibration }) {
  const isConnected = status === 'connected';
  const { accel } = motion || {};
  const { airQuality } = env || {};

  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  // States
  const [isLit, setIsLit] = useState(true);
  const [windForce, setWindForce] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const relightTimeoutRef = useRef(null);

  // Kalman filters for physical tilt
  const kxRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));
  const kyRef = useRef(new KalmanFilter({ Q: DEFAULT_CALIBRATION.kalmanQ, R: DEFAULT_CALIBRATION.kalmanR }));

  // Handle Fullscreen Toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Frame Loop for logic
  useEffect(() => {
    let animationFrame;

    const loop = () => {
      // 1. Process Breath (eCO2)
      let currentForce = 0;
      if (isConnected && airQuality && airQuality.eco2) {
        const eco2 = airQuality.eco2;
        if (eco2 > CANDLE_CONFIG.logic.eco2Baseline) {
          // Map baseline -> maxSpike to a force of 0.0 -> 2.0
          currentForce = Math.min((eco2 - CANDLE_CONFIG.logic.eco2Baseline) / CANDLE_CONFIG.logic.eco2MaxSpike, 2.0);
        }
      }

      // Introduce a tiny bit of random ambient breeze if lit
      if (isLit && currentForce < 0.1) {
        currentForce += Math.sin(Date.now() * 0.001) * 0.05 + 0.05;
      }

      setWindForce(currentForce);

      // Check for blow out
      if (isLit && currentForce > CANDLE_CONFIG.logic.blowOutForce) {
        setIsLit(false);
        // Auto relight
        if (relightTimeoutRef.current) clearTimeout(relightTimeoutRef.current);
        relightTimeoutRef.current = setTimeout(() => {
          setIsLit(true);
        }, CANDLE_CONFIG.logic.relightDelayMs);
      }

      // 2. Process Physical Tilt
      if (isConnected && accel && accel.x !== null) {
        const fx = kxRef.current.filter(accel.x);
        const fy = kyRef.current.filter(accel.y);

        const forces = getCalibratedForces(fx, fy, 0, calibration);
        // Map cx/cy to tilt radians (very roughly)
        setTilt({ x: forces.cx * 0.2, y: forces.cy * 0.2 });
      }

      animationFrame = requestAnimationFrame(loop);
    };

    loop();
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [isConnected, airQuality, accel, calibration, isLit]);

  // Cleanup timeout
  useEffect(() => {
    return () => {
      if (relightTimeoutRef.current) clearTimeout(relightTimeoutRef.current);
    }
  }, []);

  return (
    <div
      ref={containerRef}
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
        background: isFullscreen ? '#020617' : 'transparent',
      }}
    >
      {/* UI Overlay */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
          background: 'rgba(15, 23, 42, 0.8)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: '#fff', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>🕯️</span> Candle Blow
          </h3>
          <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-xs)', color: '#94a3b8' }}>
            {isConnected
              ? 'Breathe directly on the Thingy:52 to blow out the candle!'
              : 'Connect your Thingy:52 to interact.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {isConnected && (
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
              <div><span style={{ color: '#a855f7' }}>eCO₂:</span> {airQuality?.eco2 || 400} ppm</div>
              <div><span style={{ color: '#ef4444' }}>Status:</span> {isLit ? 'Lit' : 'Out'}</div>
            </div>
          )}

          {!isLit && (
            <button
              onClick={() => {
                setIsLit(true);
                if (relightTimeoutRef.current) clearTimeout(relightTimeoutRef.current);
              }}
              style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid #ef4444',
                color: '#fff',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
              }}
            >
              🔥 Relight Now
            </button>
          )}

          <button
            onClick={toggleFullscreen}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
            }}
          >
            {isFullscreen ? ' Shrink View' : ' Full Screen'}
          </button>
        </div>
      </div>

      {/* 3D Canvas */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#000000' }}>
        <Canvas shadows camera={{ position: [0, 4.0, 6], fov: 45 }}>
          <RoomEnvironment isLit={isLit} />

          <OrbitControls
            enablePan={false}
            minDistance={2}
            maxDistance={8}
            maxPolarAngle={Math.PI / 2 + 0.1}
            target={[0, 1.5, 0]}
          />

          {/* Realistic Candle (20cm) */}
          <group position={[0, 0, 0]}>
            {/* Procedural Shader Wax Body */}
            <ShaderWax isLit={isLit} />

            {/* Wick */}
            <mesh position={[0, CANDLE_CONFIG.wax.height - 0.1, 0]} castShadow>
              <cylinderGeometry args={[0.015, 0.015, 0.2]} />
              <meshStandardMaterial color="#1a0f00" roughness={0.9} />
            </mesh>
            <mesh position={[0, CANDLE_CONFIG.wax.height - 0.03, 0]} castShadow>
               <sphereGeometry args={[0.02]} />
               <meshStandardMaterial color="#000000" emissive="#ff3300" emissiveIntensity={isLit ? 1 : 0} />
            </mesh>
            
            {/* Flame and Smoke */}
            <group position={[0, CANDLE_CONFIG.wax.height - 0.05, 0]}>
              <ShaderFlame isLit={isLit} windForce={windForce} tiltX={tilt.x} tiltY={tilt.y} />
              <SmokeParticles active={!isLit} position={[0, 0.2, 0]} />
            </group>
          </group>

        </Canvas>
      </div>
    </div>
  );
}
