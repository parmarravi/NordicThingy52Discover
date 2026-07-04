export const noiseFunctions = `
// Simplex noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439); 
  vec2 i  = floor(v + dot(v, C.yy) ); vec2 x0 = v - i + dot(i, C.xx); vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0); vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i); vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 )); vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0); m = m*m ; m = m*m ; vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h ); vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw; return 130.0 * dot(m, g);
}
`;

export const sandVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vPos;
${noiseFunctions}
void main() {
  vUv = uv;
  vec3 pos = position;
  float slope = -(pos.y + 10.0) * 0.075;
  pos.z = sin(pos.x * 0.28) * cos(pos.y * 0.28) * 1.5 + slope;
  vPos = pos;
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const sandFragmentShader = `
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vPos;
${noiseFunctions}
void main() {
  // Grainy noise
  float grain = snoise(vUv * 300.0) * 0.05;
  // Darken troughs
  float depth = smoothstep(0.0, -2.0, vPos.z);
  vec3 finalColor = uColor - vec3(0.1) * depth + grain;
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export const oceanVertexShader = `
uniform float uTime;
uniform float uWindSpeed;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec3 pos = position;
  float wave = sin(pos.x * 0.5 - uTime * (1.3 + uWindSpeed * 0.45)) * 0.14 +
               cos(pos.y * 0.4 - uTime * 0.8) * 0.09;
  pos.z = wave;
  vPos = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const oceanFragmentShader = `
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vec3 baseColor = uColor;
  // Foam at peaks
  float foam = smoothstep(0.05, 0.15, vPos.z);
  vec3 finalColor = mix(baseColor, vec3(0.9, 0.95, 1.0), foam * 0.5);
  
  gl_FragColor = vec4(finalColor, 0.85); // slight transparency
}
`;

export const trunkVertexShader = `
uniform float uTime;
uniform float uWindSpeed;
uniform float uWindDir;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 pos = position;
  
  // Bend calculation based on height (pos.y)
  float h = max(0.0, pos.y);
  float bendFactor = (h * h) * 0.015;
  
  float targetBend = (uWindSpeed * uWindDir * 0.075);
  float sway = sin(uTime * (3.6 + uWindSpeed * 1.2)) * (0.016 * uWindSpeed);
  
  pos.x += bendFactor * (targetBend + sway) * 5.0; // amplify bend slightly
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const trunkFragmentShader = `
varying vec2 vUv;
${noiseFunctions}
void main() {
  // Bark texture
  float n = snoise(vec2(vUv.x * 20.0, vUv.y * 5.0)) * 0.1;
  vec3 color = vec3(0.47, 0.21, 0.06) + n; // #78350f equivalent
  gl_FragColor = vec4(color, 1.0);
}
`;

export const frondVertexShader = `
uniform float uTime;
uniform float uWindSpeed;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 pos = position;
  
  // Flutter along the length of the frond (x axis)
  float flutter = sin(uTime * (13.0 + uWindSpeed * 4.0) + pos.x * 5.0) * (0.018 * uWindSpeed);
  pos.y += flutter * pos.x;
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const frondFragmentShader = `
varying vec2 vUv;
void main() {
  vec2 uv = vUv; // 0 to 1
  // Draw a leaf shape using SDF
  // Center is y=0.5
  float distToCenter = abs(uv.y - 0.5);
  
  // Taper at ends
  float width = 0.5 * sin(uv.x * 3.14159);
  
  if (distToCenter > width) {
    discard;
  }
  
  // Add some ribs
  float ribs = abs(sin(uv.x * 50.0)) * 0.1;
  vec3 color = vec3(0.08, 0.4, 0.15) - ribs; // #15803d
  
  gl_FragColor = vec4(color, 1.0);
}
`;
