import * as THREE from "three";

export const CloudVertexShader = /* glsl */`
varying vec2 vUv;
varying vec3 vWorldPosition;

void main(){

    vUv = uv;

    vec4 worldPosition = modelMatrix * vec4(position,1.0);
    vWorldPosition = worldPosition.xyz;

    gl_Position =
        projectionMatrix *
        viewMatrix *
        worldPosition;
}
`;

export const CloudFragmentShader = /* glsl */`

uniform float uTime;
uniform vec3 uColor;
uniform float uDensity;
uniform float uCoverage;
uniform vec2 uWindDirection;

varying vec2 vUv;
varying vec3 vWorldPosition;

//
// Random
//

float random(vec2 st){
    return fract(
        sin(dot(st.xy,vec2(12.9898,78.233)))*
        43758.5453123
    );
}

//
// Value Noise
//

float noise(vec2 st){

    vec2 i=floor(st);
    vec2 f=fract(st);

    float a=random(i);
    float b=random(i+vec2(1.0,0.0));
    float c=random(i+vec2(0.0,1.0));
    float d=random(i+vec2(1.0,1.0));

    vec2 u=f*f*(3.0-2.0*f);

    return mix(a,b,u.x)+
           (c-a)*u.y*(1.0-u.x)+
           (d-b)*u.x*u.y;
}

//
// Fractal Brownian Motion
//

float fbm(vec2 st){

    float value=0.0;
    float amplitude=.5;

    for(int i=0;i<6;i++){

        value+=amplitude*noise(st);

        st*=2.0;

        amplitude*=0.5;
    }

    return value;
}

void main(){

    vec2 uv=vUv;

    uv+=uWindDirection*uTime*0.015;

    float n=fbm(uv*5.0);

    float large=fbm(uv*2.0);

    n=mix(large,n,0.65);

    float cloud=smoothstep(
        uCoverage,
        uCoverage+uDensity,
        n
    );

    float edge=pow(cloud,1.5);

    vec3 color=uColor;

    gl_FragColor=vec4(color,edge);
}
`;