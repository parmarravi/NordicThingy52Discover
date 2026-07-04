/**
 * KalmanFilter — A scalar 1D Kalman filter for IMU sensor data smoothing.
 *
 * Separates two noise sources that the simple EMA cannot distinguish:
 *   - Measurement noise (R): electronic noise from the sensor itself
 *   - Process noise (Q): actual physical motion we want to track
 *
 * The filter adapts its trust of incoming measurements in real-time:
 * - When variance is high (shaking), it trusts the sensor more → responsive.
 * - When variance is low (still), it trusts the model more → smooth.
 *
 * Based on the discrete Kalman update equations:
 *   Prediction:   x̂⁻ = x̂;  P⁻ = P + Q
 *   Update:       K = P⁻ / (P⁻ + R);  x̂ = x̂⁻ + K * (z - x̂⁻);  P = (1 - K) * P⁻
 *
 * @param {object} options
 * @param {number} options.R  Measurement noise covariance (higher = smoother, slower)
 * @param {number} options.Q  Process noise covariance (higher = faster tracking, noisier)
 */
export class KalmanFilter {
  constructor({ R = 1.0, Q = 0.01 } = {}) {
    this.R = R; // Measurement noise (sensor electronics + vibration)
    this.Q = Q; // Process noise (real physical motion to track)

    this._x = null; // Estimated state (filtered value)
    this._P = 1.0;  // Estimate error covariance (uncertainty in our estimate)
  }

  /**
   * Feed a new measurement and return the filtered estimate.
   * @param {number} z  Raw measurement value
   * @returns {number}  Filtered value
   */
  filter(z) {
    // Initialize on first measurement
    if (this._x === null) {
      this._x = z;
      return z;
    }

    // Prediction step: project estimate and error covariance forward
    const P_pred = this._P + this.Q;

    // Update step: compute Kalman gain and correct estimate
    const K = P_pred / (P_pred + this.R);        // Kalman gain: 0 = trust model, 1 = trust measurement
    this._x = this._x + K * (z - this._x);       // Corrected estimate
    this._P = (1 - K) * P_pred;                  // Corrected error covariance

    return this._x;
  }

  /**
   * Reset the filter to a specific value (e.g., after a hard calibration reset).
   * @param {number} value  The value to seed the filter with
   */
  reset(value = null) {
    this._x = value;
    this._P = 1.0;
  }

  /** Get the current filtered value without updating. */
  get value() {
    return this._x;
  }
}

/**
 * createAxisFilter — Convenience factory for a 3-axis Kalman filter set (x, y, z).
 * @param {object} options  Passed to each KalmanFilter constructor
 * @returns {{ x: KalmanFilter, y: KalmanFilter, z: KalmanFilter }}
 */
export function createAxisFilter(options = {}) {
  return {
    x: new KalmanFilter(options),
    y: new KalmanFilter(options),
    z: new KalmanFilter(options),
  };
}
