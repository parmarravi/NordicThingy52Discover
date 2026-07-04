export const PHYSICS_CONSTANTS = {
  GRAVITY: 9.80665,
};

export const DEFAULT_CALIBRATION = {
  rollOffset: 0,
  pitchOffset: 0,
  yawOffset: 0,
  accelOffsetX: 0,
  accelOffsetY: 0,
  accelOffsetZ: PHYSICS_CONSTANTS.GRAVITY,
  rollSign: 1,
  pitchSign: 1,
  rollScale: 1.0,
  pitchScale: 1.0,
  sensitivity: 1.2,
  kalmanQ: 0.01,
  kalmanR: 1.0,
  axisSwap: false, // Automatically swaps X and Y axes if held in landscape
  deadzone: 0.25,  // Deadzone (+- variation threshold) to ignore small accidental hand tremors
  isCalibrated: false,
  isCalibrating: false,
  progress: 0,
};

export const METAL_BALLS_CONFIG = {
  gravityScale: 1.5,
  numBalls: 55,
  ball: {
    radiusMin: 0.11,
    radiusVariance: 0.03,
  },
  physics: {
    linearDamping: 0.15,
    angularDamping: 0.15,
    friction: 0.08,
    restitution: 0.65,
  },
  visuals: {
    wood: {
      color: "#292524",
      roughness: 0.7,
      metalness: 0.1,
    },
    tankGlass: {
      color: "#ffffff",
      opacity: 0.25,
      roughness: 0.05,
      metalness: 0.2,
    },
    tankFloor: {
      color: "#1e293b",
      roughness: 0.8,
    },
    ball: {
      color: "#f1f5f9",
      roughness: 0.06,
      metalness: 0.96,
    }
  }
};

export const WIND_SIMULATOR_CONFIG = {
  tree: {
    numSegments: 200,
    segmentHeightBase: 0.72,
    radiusBase: 0.18,
    radiusDecay: 0.11,
    numLeaves: 100,
  },
  particles: {
    numFireflies: 12,
  },
  wind: {
    relativeForceScale: 1.5,
  }
};

export const CANDLE_CONFIG = {
  wax: {
    radius: 0.35,
    height: 3.0,
    baseColorGLSL: 'vec3(0.98, 0.90, 0.82)',
    glowColorGLSL: 'vec3(1.0, 0.5, 0.1)',
  },
  flame: {
    coreColorGLSL: 'vec3(1.0, 0.9, 0.6)',
    midColorGLSL: 'vec3(1.0, 0.4, 0.0)',
    edgeColorGLSL: 'vec3(0.8, 0.1, 0.0)',
    lightColor: '#ffcc66',
    lightIntensityBase: 3.0,
  },
  particles: {
    numSmoke: 30,
  },
  logic: {
    eco2Baseline: 450,
    eco2MaxSpike: 750, // 450 + 750 = 1200ppm for max force
    blowOutForce: 1.5,
    relightDelayMs: 5000,
  }
};
