/**
 * Nordic Thingy:52 BLE GATT Service & Characteristic UUIDs
 * Base UUID: xxxxxxxx-9B35-4933-9B10-52FFA9740042
 */

const BASE_SUFFIX = import.meta.env.VITE_THINGY_BASE_SUFFIX || '9b35-4933-9b10-52ffa9740042';

// ─── Service UUIDs ────────────────────────────────────────────────────────────
export const SERVICES = {
  ENVIRONMENT: `ef680200-${BASE_SUFFIX}`,
  MOTION: `ef680400-${BASE_SUFFIX}`,
  BATTERY: '0000180f-0000-1000-8000-00805f9b34fb',
  SOUND: `ef680500-${BASE_SUFFIX}`,
};

// ─── Characteristic UUIDs ─────────────────────────────────────────────────────
export const CHARS = {
  // Environment
  TEMPERATURE: `ef680201-${BASE_SUFFIX}`,
  PRESSURE: `ef680202-${BASE_SUFFIX}`,
  HUMIDITY: `ef680203-${BASE_SUFFIX}`,
  AIR_QUALITY: `ef680204-${BASE_SUFFIX}`,
  COLOR: `ef680205-${BASE_SUFFIX}`,
  ENV_CONFIG: `ef680206-${BASE_SUFFIX}`,

  // Motion
  MOTION_CONFIG: `ef680401-${BASE_SUFFIX}`,
  ORIENTATION: `ef680403-${BASE_SUFFIX}`,
  QUATERNION: `ef680404-${BASE_SUFFIX}`,
  RAW_DATA: `ef680406-${BASE_SUFFIX}`,

  // Battery
  BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb',

  // UI / LED
  LED: `ef680301-${BASE_SUFFIX}`,
  BUTTON: `ef680302-${BASE_SUFFIX}`,

  // Sound
  SOUND_CONFIG: `ef680501-${BASE_SUFFIX}`,
  SPEAKER_DATA: `ef680502-${BASE_SUFFIX}`,
  SPEAKER_STATUS: `ef680503-${BASE_SUFFIX}`,
  MICROPHONE: `ef680504-${BASE_SUFFIX}`,
};

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Temperature: int8 integer + uint8 decimal → XX.XX °C
 */
export function parseTemperature(dataView) {
  if (!dataView || dataView.byteLength < 2) return 0;
  const integer = dataView.getInt8(0);
  const decimal = dataView.getUint8(1);
  return parseFloat(`${integer}.${decimal}`);
}

/**
 * Pressure: int32 integer + uint8 decimal → XXXXXX.X hPa
 */
export function parsePressure(dataView) {
  if (!dataView || dataView.byteLength < 5) return 0;
  const integer = dataView.getInt32(0, true);
  const decimal = dataView.getUint8(4);
  return parseFloat(`${integer}.${decimal}`);
}

/**
 * Humidity: uint8 → 0–100 %
 */
export function parseHumidity(dataView) {
  if (!dataView || dataView.byteLength < 1) return 0;
  return dataView.getUint8(0);
}

/**
 * Air Quality: uint16 eCO2 (ppm) + uint16 TVOC (ppb)
 */
export function parseAirQuality(dataView) {
  if (!dataView || dataView.byteLength < 4) return { eco2: 0, tvoc: 0 };
  return {
    eco2: dataView.getUint16(0, true),
    tvoc: dataView.getUint16(2, true),
  };
}

/**
 * Quaternion: 4 × int32, each scaled by 2^30
 * Returns { w, x, y, z }
 */
export function parseQuaternion(dataView) {
  if (!dataView || dataView.byteLength < 16) return { w: 1, x: 0, y: 0, z: 0 };
  const SCALE = 1 << 30;
  return {
    w: dataView.getInt32(0, true) / SCALE,
    x: dataView.getInt32(4, true) / SCALE,
    y: dataView.getInt32(8, true) / SCALE,
    z: dataView.getInt32(12, true) / SCALE,
  };
}

/**
 * Raw Motion:
 *  Accelerometer: 3 × int16 (m/s² × 100)  → divide by 100
 *  Gyroscope:     3 × int32 (°/s × 65536)  → divide by 65536
 *  Compass:       3 × int16 (μT × 16)       → divide by 16
 */
export function parseRawMotion(dataView) {
  if (!dataView || dataView.byteLength < 18) {
    return {
      accel: { x: 0, y: 0, z: 0 },
      gyro: { x: 0, y: 0, z: 0 },
      compass: { x: 0, y: 0, z: 0 }
    };
  }
  const accel = {
    x: (dataView.getInt16(0, true) / 1024) * 9.80665,
    y: (dataView.getInt16(2, true) / 1024) * 9.80665,
    z: (dataView.getInt16(4, true) / 1024) * 9.80665,
  };

  const gyro = {
    x: dataView.getInt16(6, true) / 32,
    y: dataView.getInt16(8, true) / 32,
    z: dataView.getInt16(10, true) / 32,
  };

  const compass = {
    x: dataView.getInt16(12, true) / 16,
    y: dataView.getInt16(14, true) / 16,
    z: dataView.getInt16(16, true) / 16,
  };

  return { accel, gyro, compass };
}

/**
 * Battery level: uint8 → 0–100 %
 */
export function parseBattery(dataView) {
  if (!dataView || dataView.byteLength < 1) return 0;
  return dataView.getUint8(0);
}

/**
 * Color: 4 x uint16_t (Red, Green, Blue, Clear)
 * Normalization matches Nordic's ColorSensor.js decodeColorData with adjusted
 * clearAtBlack/White thresholds to work in normal indoor lighting conditions.
 *
 * Nordic's original constants (300/400) are calibrated for bright lab conditions.
 * Adjusted to (50/2000) to handle a wider real-world lighting range.
 */
export function parseColor(dataView) {
  if (!dataView || dataView.byteLength < 8) return { r: 0, g: 0, b: 0, c: 0 };

  const rRaw = dataView.getUint16(0, true);
  const gRaw = dataView.getUint16(2, true);
  const bRaw = dataView.getUint16(4, true);
  const c = dataView.getUint16(6, true);

  const sum = rRaw + gRaw + bRaw;

  // If no raw channel signal at all, return black
  if (sum === 0 && c === 0) return { r: 0, g: 0, b: 0, c };

  // If RGB channels are 0 but clear channel shows ambient light, return a dim neutral
  if (sum === 0 && c > 0) {
    const dim = Math.min(30, Math.round((c / 500) * 30));
    return { r: dim, g: dim, b: dim, c };
  }

  const rRatio = rRaw / sum;
  const gRatio = gRaw / sum;
  const bRatio = bRaw / sum;

  // Adjusted calibration range: 50 = near-dark, 2000 = bright environment
  // Allows the sensor to produce color in typical indoor lighting (c=200-600)
  const clearAtBlack = 50;
  const clearAtWhite = 2000;
  const clearDiff = clearAtWhite - clearAtBlack;
  let clearNormalized = (c - clearAtBlack) / clearDiff;
  if (clearNormalized < 0) clearNormalized = 0;
  if (clearNormalized > 1) clearNormalized = 1;

  const r = Math.min(255, Math.round(rRatio * 255.0 * 3 * clearNormalized));
  const g = Math.min(255, Math.round(gRatio * 255.0 * 3 * clearNormalized));
  const b = Math.min(255, Math.round(bRatio * 255.0 * 3 * clearNormalized));

  return { r, g, b, c };
}

/**
 * Sound pressure level: uint8_t -> dB
 */
export function parseSPL(dataView) {
  if (!dataView || dataView.byteLength < 1) return 0;
  if (dataView.byteLength === 131) {
    return calculateSplFromAdpcm(dataView);
  }
  return dataView.getUint8(0);
}

/**
 * Orientation: uint8_t -> 0: portrait, 1: landscape, 2: reverse portrait, 3: reverse landscape
 */
export function parseOrientation(dataView) {
  return dataView.getUint8(0);
}

/**
 * Convert quaternion { w, x, y, z } to Euler angles in degrees { roll, pitch, yaw }
 */
export function quaternionToEuler({ w, x, y, z }) {
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp) * (180 / Math.PI);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1
    ? Math.sign(sinp) * 90
    : Math.asin(sinp) * (180 / Math.PI);

  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp) * (180 / Math.PI);

  return { roll, pitch, yaw };
}

// ─── Connection helpers ───────────────────────────────────────────────────────

/** Enable notifications on a characteristic */
export async function enableNotifications(char) {
  await char.startNotifications();
  return char;
}

/** Request the Thingy:52 device via Web Bluetooth */
export async function requestThingyDevice() {
  const configServiceUuid = `ef680100-${BASE_SUFFIX}`;
  const uiServiceUuid = `ef680300-${BASE_SUFFIX}`;
  const soundServiceUuid = `ef680500-${BASE_SUFFIX}`;

  const optionalServices = [
    ...Object.values(SERVICES),
    configServiceUuid,
    uiServiceUuid,
    soundServiceUuid,
  ];

  return navigator.bluetooth.requestDevice({
    filters: [
      { namePrefix: 'Thingy' },
      { namePrefix: 'thingy' },
      { namePrefix: 'Nordy' }, // Some custom firmware names
      { services: [configServiceUuid] }
    ],
    optionalServices,
  });
}

// ADPCM decoding lookup tables
const STEP_SIZE_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 278, 306, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767
];

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

/**
 * Decodes a 131-byte raw ADPCM frame from the Thingy:52 digital microphone,
 * calculates the Root Mean Square (RMS) amplitude, and returns it as a decibel value (dB SPL).
 */
export function calculateSplFromAdpcm(dataView) {
  if (!dataView || dataView.byteLength < 3) return 0;

  try {
    const littleEndian = true;

    // Read the ADPCM predictor header (first 2 bytes, Big Endian)
    let valuePredicted = dataView.getInt16(0, false);
    // Read the predictor index (3rd byte)
    let index = dataView.getInt8(2);
    if (index < 0) index = 0;
    if (index > 88) index = 88;

    let step = STEP_SIZE_TABLE[index];
    const audioDataLength = dataView.byteLength - 3;
    const dataBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + 3, audioDataLength);

    let sumSquares = 0;
    let sampleCount = 0;
    let bufferStep = false;
    let inputBuffer = 0;

    for (let i = 0; i < audioDataLength;) {
      let delta = 0;
      if (bufferStep) {
        delta = inputBuffer & 0x0F;
        i++;
      } else {
        inputBuffer = dataBytes[i];
        delta = (inputBuffer >> 4) & 0x0F;
      }
      bufferStep = !bufferStep;

      index += INDEX_TABLE[delta];
      if (index < 0) index = 0;
      if (index > 88) index = 88;

      const sign = delta & 8;
      delta = delta & 7;

      let diff = step >> 3;
      if ((delta & 4) > 0) diff += step;
      if ((delta & 2) > 0) diff += step >> 1;
      if ((delta & 1) > 0) diff += step >> 2;

      if (sign > 0) {
        valuePredicted -= diff;
      } else {
        valuePredicted += diff;
      }

      if (valuePredicted > 32767) valuePredicted = 32767;
      else if (valuePredicted < -32768) valuePredicted = -32768;

      step = STEP_SIZE_TABLE[index];

      // Accumulate normalized sample (-1.0 to 1.0)
      const normalizedSample = valuePredicted / 32768.0;
      sumSquares += normalizedSample * normalizedSample;
      sampleCount++;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    // Map RMS to decibels: 20 * log10(rms) + reference offset (95dB reference offset)
    const db = rms > 0 ? Math.round(20 * Math.log10(rms) + 95) : 30;

    // Clamp between 30 (quiet room) and 120 (loud noise) dB SPL
    return Math.max(30, Math.min(120, db));
  } catch (err) {
    console.error('[calculateSplFromAdpcm] Error decoding ADPCM frame:', err);
    return 0;
  }
}

