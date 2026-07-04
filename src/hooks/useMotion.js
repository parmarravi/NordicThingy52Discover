import { useState, useCallback, useEffect, useRef } from 'react';
import {
  SERVICES, CHARS,
  parseQuaternion,
  parseRawMotion,
  parseOrientation,
  quaternionToEuler,
  enableNotifications,
} from '../services/thingy52';

const HISTORY_SIZE = 60;

function makeGravityHistory() {
  return { x: [], y: [], z: [], timestamps: [] };
}

function pushGravityHistory(hist, accelVal) {
  if (!accelVal || accelVal.x === null) return hist;
  return {
    x: [...hist.x.slice(-(HISTORY_SIZE - 1)), accelVal.x],
    y: [...hist.y.slice(-(HISTORY_SIZE - 1)), accelVal.y],
    z: [...hist.z.slice(-(HISTORY_SIZE - 1)), accelVal.z],
    timestamps: [...hist.timestamps.slice(-(HISTORY_SIZE - 1)), Date.now()],
  };
}

/**
 * Subscribes to Thingy:52 Motion service — Quaternion, Raw Data, and Orientation notifications.
 * Implements an Exponential Moving Average (EMA) filter on Compass data to eliminate jitter.
 */
export function useMotion({ onConnect, onDisconnect }) {
  const [quaternion, setQuaternion] = useState({ w: 1, x: 0, y: 0, z: 0 });
  const [euler, setEuler] = useState({ roll: 0, pitch: 0, yaw: 0 });
  const [accel, setAccel] = useState({ x: null, y: null, z: null });
  const [gyro, setGyro] = useState({ x: null, y: null, z: null });
  const [compass, setCompass] = useState({ x: null, y: null, z: null });
  const [orientation, setOrientation] = useState(null);
  const [gravityHistory, setGravityHistory] = useState(makeGravityHistory());

  const charsRef = useRef({});
  const smoothedCompassRef = useRef({ x: null, y: null, z: null });
  const serverRef = useRef(null);           // GATT server ref for watchdog re-setup
  const lastPacketTimeRef = useRef(null);   // Timestamp of the last received packet
  const watchdogRef = useRef(null);         // Interval handle for the watchdog timer

  const teardown = useCallback(() => {
    // Clear watchdog timer
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    Object.values(charsRef.current).forEach(char => {
      if (char && typeof char.stopNotifications === 'function') {
        try {
          char.stopNotifications().catch(err => {
            console.log('[useMotion] Silenced stopNotifications error:', err.message);
          });
        } catch (_) { }
      }
    });
    charsRef.current = {};
  }, []);

  const setup = useCallback(async (server) => {
    console.log('[useMotion] Starting motion sensors setup...');
    serverRef.current = server;  // Store for watchdog re-setup
    lastPacketTimeRef.current = Date.now();
    teardown();
    try {
      console.log('[useMotion] Getting Primary Service (Motion)...');
      const svc = await server.getPrimaryService(SERVICES.MOTION);
      console.log('[useMotion] Motion service retrieved');

      // Configure Motion sensor: set MPU frequency to 20Hz (if 0 or not set) to enable DMP fusion
      try {
        console.log('[useMotion] Discovering Motion Config characteristic...');
        const configChar = await svc.getCharacteristic(CHARS.MOTION_CONFIG);
        console.log('[useMotion] Reading Motion Config...');
        const configVal = await configChar.readValue();
        const configData = new Uint8Array(configVal.buffer, configVal.byteOffset, configVal.byteLength);
        console.log('[useMotion] Motion Config read payload:', Array.from(configData));

        // Bytes 6-7: MPU frequency (Hz)
        const mpuFreq = configData[6] | (configData[7] << 8);
        console.log('[useMotion] Current MPU frequency:', mpuFreq, 'Hz');

        if (mpuFreq === 0) {
          console.log('[useMotion] MPU frequency is 0. Writing 20 Hz to enable fusion calculations...');
          configData[6] = 80 & 0xFF;
          configData[7] = (80 >> 8) & 0xFF;
          await configChar.writeValue(configData);
          console.log('[useMotion] Motion Config written successfully');
        }
      } catch (configErr) {
        console.warn('[useMotion] Failed to configure motion settings (non-fatal):', configErr);
      }

      // Quaternion
      try {
        console.log('[useMotion] Discovering Quaternion characteristic...');
        const quatChar = await svc.getCharacteristic(CHARS.QUATERNION);
        console.log('[useMotion] Enabling Quaternion notifications...');
        await enableNotifications(quatChar);
        quatChar.addEventListener('characteristicvaluechanged', (e) => {
          lastPacketTimeRef.current = Date.now(); // Heartbeat
          const q = parseQuaternion(e.target.value);
          const eu = quaternionToEuler(q);
          setQuaternion(q);
          setEuler(eu);
        });
        charsRef.current.quat = quatChar;
        console.log('[useMotion] Quaternion notifications active');
      } catch (e) {
        console.error('[useMotion] Quaternion setup failed:', e);
      }

      // Raw Motion (accel + gyro + compass)
      try {
        console.log('[useMotion] Discovering Raw Data characteristic...');
        const rawChar = await svc.getCharacteristic(CHARS.RAW_DATA);
        console.log('[useMotion] Enabling Raw Data notifications...');
        await enableNotifications(rawChar);
        rawChar.addEventListener('characteristicvaluechanged', (e) => {
          lastPacketTimeRef.current = Date.now(); // Heartbeat
          const { accel: a, gyro: g, compass: c } = parseRawMotion(e.target.value);
          setAccel(a);
          setGyro(g);
          setGravityHistory(h => pushGravityHistory(h, a));

          // Apply Exponential Moving Average (EMA) filter to Compass to remove jitter
          const alpha = 0.08; // Filter smoothing factor (lower = smoother)
          const prev = smoothedCompassRef.current;

          if (prev.x === null || prev.x === 0) {
            smoothedCompassRef.current = { ...c };
          } else {
            smoothedCompassRef.current = {
              x: prev.x + alpha * (c.x - prev.x),
              y: prev.y + alpha * (c.y - prev.y),
              z: prev.z + alpha * (c.z - prev.z),
            };
          }
          setCompass({ ...smoothedCompassRef.current });
        });
        charsRef.current.raw = rawChar;
        console.log('[useMotion] Raw Data notifications active');
      } catch (e) {
        console.error('[useMotion] Raw Data setup failed:', e);
      }

      // Orientation (portrait/landscape state updates)
      try {
        console.log('[useMotion] Discovering Orientation characteristic...');
        const orientChar = await svc.getCharacteristic(CHARS.ORIENTATION);
        console.log('[useMotion] Enabling Orientation notifications...');
        await enableNotifications(orientChar);
        orientChar.addEventListener('characteristicvaluechanged', (e) => {
          const val = parseOrientation(e.target.value);
          console.log('[useMotion] Orientation updated:', val);
          setOrientation(val);
        });
        charsRef.current.orient = orientChar;
        console.log('[useMotion] Orientation notifications active');
      } catch (e) {
        console.warn('[useMotion] Orientation sensor setup failed (optional):', e);
      }

    } catch (err) {
      console.error('[useMotion] Main motion service setup failed:', err);
    }

    // ── Watchdog: re-subscribe if no packet received for 5 seconds ──────────
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    watchdogRef.current = setInterval(async () => {
      const silentMs = Date.now() - (lastPacketTimeRef.current || Date.now());
      if (silentMs > 5000 && serverRef.current) {
        console.warn(`[useMotion] Watchdog: no packet for ${silentMs}ms — re-subscribing...`);
        try {
          // Stop old listeners cleanly
          Object.values(charsRef.current).forEach(char => {
            if (char && typeof char.stopNotifications === 'function') {
              char.stopNotifications().catch(() => {});
            }
          });
          charsRef.current = {};
          // Re-run setup with the stored GATT server reference
          await setup(serverRef.current);
          console.log('[useMotion] Watchdog: re-subscription successful');
        } catch (e) {
          console.error('[useMotion] Watchdog: re-subscription failed:', e);
        }
      }
    }, 3000); // Check every 3 seconds
  }, [teardown]);

  const reset = useCallback(() => {
    lastPacketTimeRef.current = null;
    serverRef.current = null;
    setQuaternion({ w: 1, x: 0, y: 0, z: 0 });
    setEuler({ roll: 0, pitch: 0, yaw: 0 });
    setAccel({ x: null, y: null, z: null });
    setGyro({ x: null, y: null, z: null });
    setCompass({ x: null, y: null, z: null });
    smoothedCompassRef.current = { x: null, y: null, z: null };
    setOrientation(null);
    setGravityHistory(makeGravityHistory());
  }, []);

  useEffect(() => {
    onConnect(setup);
    onDisconnect(teardown);
    onDisconnect(reset);
  }, [onConnect, onDisconnect, setup, teardown, reset]);

  return { quaternion, euler, accel, gyro, compass, orientation, gravityHistory };
}
