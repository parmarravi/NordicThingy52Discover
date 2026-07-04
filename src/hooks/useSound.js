import { useState, useCallback, useEffect, useRef } from 'react';
import {
  SERVICES, CHARS,
  parseSPL,
  enableNotifications,
} from '../services/thingy52';

/**
 * Manages the Thingy:52 Sound Service (Speaker & Microphone SPL Mode).
 *
 * Uses a "burst-sample" strategy for the microphone:
 *   1. Enable notifications
 *   2. Collect the first valid audio frame
 *   3. Immediately stop notifications
 *   4. Wait 1 second
 *   5. Repeat from step 1
 *
 * This prevents continuous ADPCM streaming (50 packets/sec × 131 bytes)
 * from overflowing the macOS CoreBluetooth receive buffer and crashing the connection.
 */
export function useSound({ onConnect, onDisconnect }) {
  const [spl, setSpl] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const charsRef = useRef({});
  const isListeningRef = useRef(false);
  const burstTimerRef = useRef(null);

  const _clearBurstTimer = () => {
    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
  };

  const teardown = useCallback(() => {
    console.log('[useSound] Teardown triggered. Cleaning up...');
    _clearBurstTimer();
    if (charsRef.current.mic && charsRef.current.micHandler) {
      try {
        charsRef.current.mic.removeEventListener('characteristicvaluechanged', charsRef.current.micHandler);
      } catch (_) { }
    }
    Object.values(charsRef.current).forEach(char => {
      if (char && typeof char.stopNotifications === 'function') {
        try {
          char.stopNotifications().catch(err => {
            console.log('[useSound] Silenced stopNotifications error:', err.message);
          });
        } catch (_) { }
      }
    });
    charsRef.current = {};
    setIsListening(false);
    isListeningRef.current = false;
  }, []);

  const setup = useCallback(async (server) => {
    teardown();
    try {
      console.log('[useSound] Setting up Sound service (on-demand mode)...');
      const svc = await server.getPrimaryService(SERVICES.SOUND);
      charsRef.current.service = svc;

      try {
        const configChar = await svc.getCharacteristic(CHARS.SOUND_CONFIG);
        charsRef.current.config = configChar;
        console.log('[useSound] Sound Config characteristic ready');
      } catch (e) {
        console.error('[useSound] Failed to discover Sound Config:', e);
      }

      try {
        const speakerChar = await svc.getCharacteristic(CHARS.SPEAKER_DATA);
        charsRef.current.speaker = speakerChar;
        console.log('[useSound] Speaker Data characteristic ready');
      } catch (e) {
        console.error('[useSound] Failed to discover Speaker Data:', e);
      }

      try {
        const micChar = await svc.getCharacteristic(CHARS.MICROPHONE);
        charsRef.current.mic = micChar;
        console.log('[useSound] Microphone characteristic ready (waiting for user activation)');
      } catch (e) {
        console.error('[useSound] Failed to discover Microphone characteristic:', e);
      }

    } catch (err) {
      console.warn('[useSound] Sound service not available on this device:', err);
    }
  }, [teardown]);

  /**
   * Collects a single microphone burst:
   *  - Enables notifications
   *  - Waits for one frame to arrive
   *  - Immediately stops notifications again
   *  - Schedules the next burst 1000ms later
   */
  const _runBurst = useCallback(async () => {
    if (!isListeningRef.current) return;

    const config = charsRef.current.config;
    const mic = charsRef.current.mic;
    if (!config || !mic) return;

    try {
      // Set config: Speaker mode 1 (Freq), Mic mode 2 (SPL)
      await config.writeValue(new Uint8Array([0x01, 0x02]));

      // Small delay before starting notifications
      await new Promise(resolve => setTimeout(resolve, 100));

      await enableNotifications(mic);

      await new Promise((resolve) => {
        const onBurstValue = (e) => {
          try {
            const dataView = e.target.value;
            const val = parseSPL(dataView);
            console.log(`[useSound] Burst SPL sample: ${val} dB (${dataView?.byteLength} bytes)`);
            setSpl(val);
          } catch (parseErr) {
            console.error('[useSound] Failed to parse burst frame:', parseErr);
          }
          mic.removeEventListener('characteristicvaluechanged', onBurstValue);
          charsRef.current.micHandler = null;
          resolve();
        };

        // Remove any stale handler
        if (charsRef.current.micHandler) {
          mic.removeEventListener('characteristicvaluechanged', charsRef.current.micHandler);
        }

        mic.addEventListener('characteristicvaluechanged', onBurstValue);
        charsRef.current.micHandler = onBurstValue;

        // Timeout safety: resolve after 2s even if no frame arrives
        setTimeout(resolve, 2000);
      });

      // Stop notifications immediately after getting one frame
      try {
        await mic.stopNotifications();
        console.log('[useSound] Burst complete. Notifications stopped.');
      } catch (_) { }

      // Reset config back to idle (Speaker 1, Mic 1 ADPCM)
      try {
        if (config && isListeningRef.current) {
          await config.writeValue(new Uint8Array([0x01, 0x01]));
        }
      } catch (_) { }

    } catch (err) {
      console.warn('[useSound] Burst measurement failed (will retry):', err.message);
    }

    // Schedule next burst in 1000ms if still listening
    if (isListeningRef.current) {
      burstTimerRef.current = setTimeout(() => _runBurst(), 1000);
    }
  }, []);

  const startListening = useCallback(async () => {
    const config = charsRef.current.config;
    const mic = charsRef.current.mic;
    if (!config || !mic) {
      console.warn('[useSound] Cannot start listening: BLE characteristics not fully discovered');
      return;
    }

    setIsListening(true);
    isListeningRef.current = true;
    console.log('[useSound] Starting burst-sample microphone mode...');

    _clearBurstTimer();
    _runBurst();
  }, [_runBurst]);

  const stopListening = useCallback(async () => {
    console.log('[useSound] Stopping microphone burst cycle...');
    isListeningRef.current = false;
    _clearBurstTimer();

    const config = charsRef.current.config;
    const mic = charsRef.current.mic;

    try {
      if (mic) {
        if (charsRef.current.micHandler) {
          mic.removeEventListener('characteristicvaluechanged', charsRef.current.micHandler);
          charsRef.current.micHandler = null;
        }
        try { await mic.stopNotifications(); } catch (_) { }
      }

      if (config) {
        // Return config to idle
        await config.writeValue(new Uint8Array([0x01, 0x01]));
      }
    } catch (err) {
      console.error('[useSound] Error while stopping microphone listening:', err);
    } finally {
      setIsListening(false);
      setSpl(null);
      console.log('[useSound] Microphone listening stopped');
    }
  }, []);

  const reset = useCallback(() => {
    setSpl(null);
    setIsListening(false);
    isListeningRef.current = false;
    _clearBurstTimer();
  }, []);

  useEffect(() => {
    onConnect(setup);
    onDisconnect(teardown);
    onDisconnect(reset);
  }, [onConnect, onDisconnect, setup, teardown, reset]);

  /** Play a custom tone — frequency (Hz), duration (ms), volume (0-100) */
  const playTone = useCallback(async (frequency, duration, volume = 50) => {
    const spk = charsRef.current.speaker;
    const config = charsRef.current.config;
    if (!spk || !config) return;
    try {
      const micMode = isListeningRef.current ? 0x02 : 0x01;
      await config.writeValue(new Uint8Array([0x01, micMode]));
      const buffer = new ArrayBuffer(5);
      const view = new DataView(buffer);
      view.setUint16(0, frequency, true);
      view.setUint16(2, duration, true);
      view.setUint8(4, volume);

      if (typeof spk.writeValueWithoutResponse === 'function') {
        await spk.writeValueWithoutResponse(new Uint8Array(buffer));
      } else {
        await spk.writeValue(new Uint8Array(buffer));
      }
      console.log(`[useSound] played tone frequency: ${frequency}Hz, duration: ${duration}ms`);
    } catch (err) {
      console.warn('[useSound] playTone failed:', err);
    }
  }, []);

  /** Play a pre-defined sample (sampleId 0–8) */
  const playSample = useCallback(async (sampleId) => {
    const spk = charsRef.current.speaker;
    const config = charsRef.current.config;
    if (!spk || !config) return;
    try {
      const micMode = isListeningRef.current ? 0x02 : 0x01;
      await config.writeValue(new Uint8Array([0x03, micMode]));

      const payload = new Uint8Array([sampleId]);

      if (typeof spk.writeValueWithoutResponse === 'function') {
        await spk.writeValueWithoutResponse(payload);
      } else {
        await spk.writeValue(payload);
      }
      console.log(`[useSound] played sample ID: ${sampleId}`);
    } catch (err) {
      console.warn('[useSound] playSample failed:', err);
    }
  }, []);

  return { spl, isListening, startListening, stopListening, playTone, playSample };
}
