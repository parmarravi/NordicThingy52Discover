import { useState, useCallback, useRef } from 'react';
import {
  SERVICES, CHARS,
  requestThingyDevice,
  parseBattery,
  enableNotifications,
} from '../services/thingy52';

/**
 * Manages the full BLE connection lifecycle for the Thingy:52.
 * Returns connection state and a connect/disconnect function,
 * plus references to the GATT server for use by sensor hooks.
 */
export function useBluetooth() {
  const [status, setStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [deviceName, setDeviceName] = useState(null);
  const [battery, setBattery] = useState(null);
  const [error, setError] = useState(null);

  // Exposed so sensor hooks can use them
  const serverRef = useRef(null);
  const deviceRef = useRef(null);

  // Callbacks registered by sensor hooks
  const onConnectCallbacks = useRef([]);
  const onDisconnectCallbacks = useRef([]);

  /** Register a callback to be called when BLE connects (receives GATT server) */
  const onConnect = useCallback((cb) => {
    if (!onConnectCallbacks.current.includes(cb)) {
      onConnectCallbacks.current.push(cb);
    }
  }, []);

  /** Register a callback to be called on disconnect */
  const onDisconnect = useCallback((cb) => {
    if (!onDisconnectCallbacks.current.includes(cb)) {
      onDisconnectCallbacks.current.push(cb);
    }
  }, []);

  const handleDisconnect = useCallback((event) => {
    console.warn('[BLE] GATT server disconnected event received. Target:', event?.target?.name || 'unknown device');
    setStatus('disconnected');
    setDeviceName(null);
    setBattery(null);
    serverRef.current = null;
    
    console.log('[BLE] Triggering onDisconnect callbacks...');
    onDisconnectCallbacks.current.forEach((cb, idx) => {
      try {
        cb();
      } catch (err) {
        console.error(`[BLE] Error in onDisconnect callback #${idx}:`, err);
      }
    });
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setError('Web Bluetooth is not supported in this browser. Please use Chrome or Edge.');
      setStatus('error');
      return;
    }

    try {
      console.log('[BLE] Requesting Thingy:52 device...');
      setStatus('connecting');
      setError(null);

      const device = await requestThingyDevice();
      console.log('[BLE] Device selected:', device.name, 'ID:', device.id);
      deviceRef.current = device;
      setDeviceName(device.name || 'Thingy:52');

      // Clear event listener to avoid duplicate bindings
      device.removeEventListener('gattserverdisconnected', handleDisconnect);
      device.addEventListener('gattserverdisconnected', handleDisconnect);

      console.log('[BLE] Connecting to GATT server...');
      const server = await device.gatt.connect();
      serverRef.current = server;
      console.log('[BLE] GATT server connected successfully');

      // Scan and log all primary services and their characteristics for diagnostic tracing
      try {
        console.log('[BLE] Scanning GATT tree. Fetching primary services...');
        const services = await server.getPrimaryServices();
        console.log(`[BLE] Found ${services.length} primary services:`);
        for (const service of services) {
          console.log(`  [Service] UUID: ${service.uuid}`);
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              const props = [];
              if (char.properties.read) props.push('READ');
              if (char.properties.write) props.push('WRITE');
              if (char.properties.writeWithoutResponse) props.push('WRITE_WITHOUT_RESPONSE');
              if (char.properties.notify) props.push('NOTIFY');
              if (char.properties.indicate) props.push('INDICATE');
              console.log(`     └─ [Characteristic] UUID: ${char.uuid} [${props.join(', ')}]`);
            }
          } catch (charErr) {
            console.log(`     └─ Failed to fetch characteristics:`, charErr.message);
          }
        }
      } catch (scanErr) {
        console.warn('[BLE] Could not scan GATT tree:', scanErr.message);
      }

      // Configure BLE connection parameters (Service 0100, Char 0104) and MTU (Char 0108) to prevent audio/sensor disconnections
      try {
        const baseUuid = import.meta.env.VITE_THINGY_BASE_SUFFIX || '9b35-4933-9b10-52ffa9740042';
        const configSvcUuid = `ef680100-${baseUuid}`;
        const connParamsUuid = `ef680104-${baseUuid}`;
        const mtuRequestUuid = `ef680108-${baseUuid}`;
        
        console.log('[BLE] Retrieving Configuration Service (0100)...');
        const configSvc = await server.getPrimaryService(configSvcUuid);
        
        console.log('[BLE] Retrieving Connection Parameters characteristic (0104)...');
        const connParamsChar = await configSvc.getCharacteristic(connParamsUuid);
        console.log('[BLE] Writing fast connection parameters (15ms-30ms) to support mic streaming...');
        const paramsPayload = new Uint8Array([0x0C, 0x00, 0x18, 0x00, 0x00, 0x00, 0xC8, 0x00]);
        await connParamsChar.writeValue(paramsPayload);
        console.log('[BLE] Connection parameters updated successfully');

        console.log('[BLE] Retrieving MTU Request characteristic (0108)...');
        const mtuChar = await configSvc.getCharacteristic(mtuRequestUuid);
        console.log('[BLE] Writing MTU size request of 276 bytes to support microphone...');
        // MTU 276 = 0x0114 -> little endian: [0x14, 0x01]
        // Peripheral request = true (0x01)
        const mtuPayload = new Uint8Array([0x01, 0x14, 0x01]);
        await mtuChar.writeValue(mtuPayload);
        console.log('[BLE] MTU size requested successfully');
      } catch (paramErr) {
        console.warn('[BLE] Could not set connection parameters or MTU (non-fatal):', paramErr);
      }

      // Read battery level
      try {
        console.log('[BLE] Retrieving Battery Service...');
        const batterySvc = await server.getPrimaryService(SERVICES.BATTERY);
        console.log('[BLE] Retrieving Battery Level Characteristic...');
        const batteryChar = await batterySvc.getCharacteristic(CHARS.BATTERY_LEVEL);
        const batteryVal = await batteryChar.readValue();
        const batteryPct = parseBattery(batteryVal);
        console.log('[BLE] Battery Level parsed:', batteryPct, '%');
        setBattery(batteryPct);

        // Also subscribe to battery notifications
        console.log('[BLE] Enabling Battery notifications...');
        await enableNotifications(batteryChar);
        batteryChar.addEventListener('characteristicvaluechanged', (e) => {
          const val = parseBattery(e.target.value);
          console.log('[BLE] Battery updated notification:', val, '%');
          setBattery(val);
        });
      } catch (batErr) {
        console.warn('[BLE] Battery service setup failed (non-fatal):', batErr);
      }

      setStatus('connected');

      // Notify sensor hooks one at a time (sequential GATT ops prevent BLE overload)
      console.log('[BLE] Starting sequential setup of sensor hooks. Registered hooks count:', onConnectCallbacks.current.length);
      for (let i = 0; i < onConnectCallbacks.current.length; i++) {
        const cb = onConnectCallbacks.current[i];
        console.log(`[BLE] Running hook setup #${i + 1}...`);
        try {
          await cb(server);
          console.log(`[BLE] Hook setup #${i + 1} completed successfully`);
        } catch (err) {
          console.error(`[BLE] Hook setup #${i + 1} failed (non-fatal):`, err);
        }
        // Small breathing room between hooks for the BLE stack
        console.log('[BLE] Pausing 300ms before next setup...');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      console.log('[BLE] All sensor hook setups finished');
    } catch (err) {
      console.error('[BLE] Connection process failed:', err);
      if (err.name === 'NotFoundError') {
        // User cancelled the picker
        setStatus('disconnected');
      } else {
        setError(err.message || 'Failed to connect');
        setStatus('error');
      }
    }
  }, [handleDisconnect]);

  const disconnect = useCallback(() => {
    if (deviceRef.current) {
      console.log('[BLE] Manual disconnect requested. Connected status:', deviceRef.current.gatt.connected);
      if (deviceRef.current.gatt.connected) {
        deviceRef.current.gatt.disconnect();
      }
    }
  }, []);

  return {
    status,
    deviceName,
    battery,
    error,
    serverRef,
    connect,
    disconnect,
    onConnect,
    onDisconnect,
  };
}
