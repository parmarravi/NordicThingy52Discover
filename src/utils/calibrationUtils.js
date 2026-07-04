import { DEFAULT_CALIBRATION, PHYSICS_CONSTANTS } from './constants';

/**
 * Common formula for calculating calibrated forces from raw or filtered accelerometer data.
 * Extracts common constants from the calibration object with fallbacks and applies mapping.
 *
 * @param {number} fx - Filtered/Raw X axis acceleration
 * @param {number} fy - Filtered/Raw Y axis acceleration
 * @param {number} fz - Filtered/Raw Z axis acceleration (optional, defaults to 0)
 * @param {object} calibration - The calibration object containing offsets and scale settings
 */

function inverseQuaternion(q) {
  const normSq = q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z;
  if (normSq === 0) return { w: 1, x: 0, y: 0, z: 0 };
  return { w: q.w / normSq, x: -q.x / normSq, y: -q.y / normSq, z: -q.z / normSq };
}

function multiplyQuaternions(q1, q2) {
  return {
    w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
    x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
    y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
    z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w
  };
}

function quaternionToEuler({ w, x, y, z }) {
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

/**
 * Calculates forces based on quaternion relative rotation, ensuring perfect orthogonality 
 * and immunity to Gimbal Lock anywhere within 90 degrees of the neutral pose.
 */
export function getCalibratedForces(motion, calibration, baseline = null) {
  const q_current = motion?.quaternion ?? { w: 1, x: 0, y: 0, z: 0 };
  const q_neutral = {
    w: calibration?.neutralQw ?? 1,
    x: calibration?.neutralQx ?? 0,
    y: calibration?.neutralQy ?? 0,
    z: calibration?.neutralQz ?? 0
  };

  // Compute relative local rotation: q_rel = q_neutral_inverse * q_current
  const q_neutral_inv = inverseQuaternion(q_neutral);
  const q_rel = multiplyQuaternions(q_neutral_inv, q_current);

  // Convert the local relative rotation into Euler angles
  const relativeEuler = quaternionToEuler(q_rel);

  // In our local relative space:
  // Roll exactly corresponds to left/right tilt relative to neutral pose
  // Pitch exactly corresponds to forward/back tilt relative to neutral pose
  const localRoll = relativeEuler.roll;
  const localPitch = relativeEuler.pitch;

  const sens = calibration?.sensitivity ?? DEFAULT_CALIBRATION.sensitivity;

  // We map -45 degrees of local tilt to a force of -45.
  const cx = localRoll * sens;
  const cy = -localPitch * sens;

  return { cx, cy, cz: 0 };
}
