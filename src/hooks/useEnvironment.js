import { useState, useCallback, useEffect, useRef } from 'react';
import {
  SERVICES, CHARS,
  parseTemperature,
  parsePressure,
  parseHumidity,
  parseAirQuality,
  parseColor,
  enableNotifications,
} from '../services/thingy52';

const HISTORY_SIZE = 60; // 60 data points per sensor

function makeHistory() {
  return { values: [], timestamps: [] };
}

function pushHistory(hist, value) {
  const next = {
    values: [...hist.values.slice(-(HISTORY_SIZE - 1)), value],
    timestamps: [...hist.timestamps.slice(-(HISTORY_SIZE - 1)), Date.now()],
  };
  return next;
}

/**
 * Subscribes to environment sensors on the Thingy:52.
 * Temperature, pressure, humidity, air quality run automatically.
 * Color sensor scanning is on-demand to optimize BLE bandwidth.
 */
export function useEnvironment({ onConnect, onDisconnect }) {
  const [temperature, setTemperature] = useState(null);
  const [pressure, setPressure] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [airQuality, setAirQuality] = useState(null);
  const [color, setColor] = useState(null); // { r, g, b, c }
  const [isColorActive, setIsColorActive] = useState(false);

  const [tempHistory, setTempHistory]     = useState(makeHistory());
  const [pressHistory, setPressHistory]   = useState(makeHistory());
  const [humHistory, setHumHistory]       = useState(makeHistory());
  const [eco2History, setEco2History]     = useState(makeHistory());
  const [tvocHistory, setTvocHistory]     = useState(makeHistory());

  const charsRef = useRef({});

  const teardown = useCallback(() => {
    console.log('[useEnvironment] Teardown triggered. Cleaning up...');
    if (charsRef.current.color && charsRef.current.colorHandler) {
      try {
        charsRef.current.color.removeEventListener('characteristicvaluechanged', charsRef.current.colorHandler);
      } catch (_) {}
    }
    Object.values(charsRef.current).forEach(char => {
      if (char && typeof char.stopNotifications === 'function') {
        try { 
          char.stopNotifications().catch(err => {
            console.log('[useEnvironment] Silenced stopNotifications error:', err.message);
          });
        } catch (_) {}
      }
    });
    charsRef.current = {};
    setIsColorActive(false);
  }, []);

  const setup = useCallback(async (server) => {
    console.log('[useEnvironment] Starting environment sensors setup...');
    teardown();
    try {
      console.log('[useEnvironment] Getting Primary Service (Environment)...');
      const svc = await server.getPrimaryService(SERVICES.ENVIRONMENT);
      console.log('[useEnvironment] Environment service retrieved');

      // Temperature
      try {
        console.log('[useEnvironment] Discovering Temperature characteristic...');
        const tempChar = await svc.getCharacteristic(CHARS.TEMPERATURE);
        console.log('[useEnvironment] Enabling Temperature notifications...');
        await enableNotifications(tempChar);
        tempChar.addEventListener('characteristicvaluechanged', (e) => {
          const val = parseTemperature(e.target.value);
          setTemperature(val);
          setTempHistory(h => pushHistory(h, val));
        });
        charsRef.current.temp = tempChar;
        console.log('[useEnvironment] Temperature notifications active');
      } catch (e) { console.error('[useEnvironment] Temperature setup failed:', e); }

      // Pressure
      try {
        console.log('[useEnvironment] Discovering Pressure characteristic...');
        const pressChar = await svc.getCharacteristic(CHARS.PRESSURE);
        console.log('[useEnvironment] Enabling Pressure notifications...');
        await enableNotifications(pressChar);
        pressChar.addEventListener('characteristicvaluechanged', (e) => {
          const val = parsePressure(e.target.value);
          setPressure(val);
          setPressHistory(h => pushHistory(h, val));
        });
        charsRef.current.press = pressChar;
        console.log('[useEnvironment] Pressure notifications active');
      } catch (e) { console.error('[useEnvironment] Pressure setup failed:', e); }

      // Humidity
      try {
        console.log('[useEnvironment] Discovering Humidity characteristic...');
        const humChar = await svc.getCharacteristic(CHARS.HUMIDITY);
        console.log('[useEnvironment] Enabling Humidity notifications...');
        await enableNotifications(humChar);
        humChar.addEventListener('characteristicvaluechanged', (e) => {
          const val = parseHumidity(e.target.value);
          setHumidity(val);
          setHumHistory(h => pushHistory(h, val));
        });
        charsRef.current.hum = humChar;
        console.log('[useEnvironment] Humidity notifications active');
      } catch (e) { console.error('[useEnvironment] Humidity setup failed:', e); }

      // Air quality
      try {
        console.log('[useEnvironment] Discovering Air Quality characteristic...');
        const aqChar = await svc.getCharacteristic(CHARS.AIR_QUALITY);
        console.log('[useEnvironment] Enabling Air Quality notifications...');
        await enableNotifications(aqChar);
        aqChar.addEventListener('characteristicvaluechanged', (e) => {
          const val = parseAirQuality(e.target.value);
          setAirQuality(val);
          setEco2History(h => pushHistory(h, val.eco2));
          setTvocHistory(h => pushHistory(h, val.tvoc));
        });
        charsRef.current.aq = aqChar;
        console.log('[useEnvironment] Air Quality notifications active');
      } catch (e) { console.error('[useEnvironment] Air Quality setup failed:', e); }

      // Color characteristic (waiting for user toggle activation)
      try {
        console.log('[useEnvironment] Discovering Color characteristic...');
        const colorChar = await svc.getCharacteristic(CHARS.COLOR);
        charsRef.current.color = colorChar;
        console.log('[useEnvironment] Color characteristic ready');
      } catch (e) { 
        console.warn('[useEnvironment] Color characteristic discovery failed:', e);
      }

      // Env Config characteristic
      try {
        console.log('[useEnvironment] Discovering Env Config characteristic...');
        const configChar = await svc.getCharacteristic(CHARS.ENV_CONFIG);
        charsRef.current.config = configChar;
        console.log('[useEnvironment] Env Config characteristic ready');
      } catch (e) {
        console.warn('[useEnvironment] Env Config discovery failed:', e);
      }

    } catch (err) {
      console.error('[useEnvironment] Main environment service setup failed:', err);
    }
  }, [teardown]);

  const startColor = useCallback(async () => {
    const colorChar = charsRef.current.color;
    const configChar = charsRef.current.config;
    if (!colorChar || !configChar) {
      console.warn('[useEnvironment] Cannot start color scanning: characteristics not discovered');
      return;
    }

    try {
      console.log('[useEnvironment] Reading current Env Config before enabling color sensor...');
      const configVal = await configChar.readValue();

      // IMPORTANT: Copy into a fresh writable buffer — never mutate configVal.buffer directly
      const configData = new Uint8Array(12);
      for (let i = 0; i < Math.min(12, configVal.byteLength); i++) {
        configData[i] = configVal.getUint8(i);
      }

      // Bytes 6-7: Color interval (ms) — set to 1000ms (0x03E8) little-endian
      configData[6] = 0xE8;
      configData[7] = 0x03;
      await configChar.writeValue(configData);
      console.log('[useEnvironment] Environment Config written: color interval=1000ms');

      console.log('[useEnvironment] Pausing 300ms to allow BH1745 color sensor initialization...');
      await new Promise(resolve => setTimeout(resolve, 300));

      console.log('[useEnvironment] Enabling Color notifications...');
      await enableNotifications(colorChar);

      const onColorValue = (e) => {
        const val = parseColor(e.target.value);
        console.log('[useEnvironment] Color reading:', val);
        setColor(val);
      };

      if (charsRef.current.colorHandler) {
        colorChar.removeEventListener('characteristicvaluechanged', charsRef.current.colorHandler);
      }
      colorChar.addEventListener('characteristicvaluechanged', onColorValue);
      charsRef.current.colorHandler = onColorValue;

      setIsColorActive(true);
      console.log('[useEnvironment] Color sensor scanning active');
    } catch (err) {
      console.error('[useEnvironment] Failed to start color sensor:', err);
    }
  }, []);

  const stopColor = useCallback(async () => {
    const colorChar = charsRef.current.color;
    const configChar = charsRef.current.config;

    try {
      if (colorChar) {
        console.log('[useEnvironment] Stopping Color notifications...');
        if (charsRef.current.colorHandler) {
          colorChar.removeEventListener('characteristicvaluechanged', charsRef.current.colorHandler);
          charsRef.current.colorHandler = null;
        }
        try { await colorChar.stopNotifications(); } catch (_) {}
      }

      // Restore color interval to a safe idle value (5000ms = 0x1388) instead of 0
      // Setting 0 is below the 200ms minimum and can crash the environment service
      if (configChar) {
        console.log('[useEnvironment] Restoring color interval to idle (5000ms)...');
        const configVal = await configChar.readValue();
        const configData = new Uint8Array(12);
        for (let i = 0; i < Math.min(12, configVal.byteLength); i++) {
          configData[i] = configVal.getUint8(i);
        }
        // 5000ms = 0x1388 little-endian
        configData[6] = 0x88;
        configData[7] = 0x13;
        await configChar.writeValue(configData);
        console.log('[useEnvironment] Color interval reset to 5000ms idle');
      }
    } catch (err) {
      console.error('[useEnvironment] Error stopping color sensor:', err);
    } finally {
      setIsColorActive(false);
      setColor(null);
      console.log('[useEnvironment] Color sensor scanning stopped');
    }
  }, []);

  const reset = useCallback(() => {
    setTemperature(null);
    setPressure(null);
    setHumidity(null);
    setAirQuality(null);
    setColor(null);
    setIsColorActive(false);
    setTempHistory(makeHistory());
    setPressHistory(makeHistory());
    setHumHistory(makeHistory());
    setEco2History(makeHistory());
    setTvocHistory(makeHistory());
  }, []);

  useEffect(() => {
    onConnect(setup);
    onDisconnect(teardown);
    onDisconnect(reset);
  }, [onConnect, onDisconnect, setup, teardown, reset]);

  return {
    temperature, tempHistory,
    pressure, pressHistory,
    humidity, humHistory,
    airQuality, eco2History, tvocHistory,
    color, isColorActive, startColor, stopColor,
  };
}
