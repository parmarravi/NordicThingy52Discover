import { useState, useCallback, useEffect, useRef } from 'react';
import { CHARS, enableNotifications } from '../services/thingy52';

/**
 * Manages the User Interface (UI) service on the Thingy:52.
 * Provides controls for the RGB LED (Constant color, Off) and reads the physical button.
 */
export function useUI({ onConnect, onDisconnect }) {
  const [isButtonPressed, setIsButtonPressed] = useState(false);
  const charsRef = useRef({});

  const teardown = useCallback(() => {
    if (charsRef.current.button && charsRef.current.buttonHandler) {
      try {
        charsRef.current.button.removeEventListener('characteristicvaluechanged', charsRef.current.buttonHandler);
      } catch (_) {}
    }
    charsRef.current = {};
  }, []);

  const reset = useCallback(() => {
    setIsButtonPressed(false);
  }, []);

  const setup = useCallback(async (server) => {
    teardown();
    try {
      const baseUuid = import.meta.env.VITE_THINGY_BASE_SUFFIX || '9b35-4933-9b10-52ffa9740042';
      const uiServiceUuid = `ef680300-${baseUuid}`;
      const ledCharUuid = CHARS.LED || `ef680301-${baseUuid}`;
      const buttonCharUuid = CHARS.BUTTON || `ef680302-${baseUuid}`;

      console.log('[useUI] Getting Primary Service (UI)...');
      const svc = await server.getPrimaryService(uiServiceUuid);
      console.log('[useUI] UI service retrieved');

      console.log('[useUI] Discovering LED characteristic...');
      const ledChar = await svc.getCharacteristic(ledCharUuid);
      charsRef.current.led = ledChar;
      console.log('[useUI] LED characteristic ready');

      // Setup physical button notification listener
      try {
        console.log('[useUI] Discovering Button characteristic...');
        const buttonChar = await svc.getCharacteristic(buttonCharUuid);
        console.log('[useUI] Enabling Button notifications...');
        await enableNotifications(buttonChar);

        const onButtonChange = (e) => {
          const val = e.target.value.getUint8(0);
          setIsButtonPressed(val === 0x01);
          console.log('[useUI] Physical Button state changed:', val === 0x01);
        };

        buttonChar.addEventListener('characteristicvaluechanged', onButtonChange);
        charsRef.current.button = buttonChar;
        charsRef.current.buttonHandler = onButtonChange;
        console.log('[useUI] Button notifications active');
      } catch (e) {
        console.error('[useUI] Button characteristic setup failed:', e);
      }
    } catch (err) {
      console.warn('[useUI] UI/LED/Button service setup failed (optional):', err);
    }
  }, [teardown]);

  useEffect(() => {
    onConnect(setup);
    onDisconnect(teardown);
    onDisconnect(reset);
  }, [onConnect, onDisconnect, setup, teardown, reset]);

  const isWritingRef = useRef(false);

  /** Set the LED to a constant RGB color */
  const writeLedConstant = useCallback(async (r, g, b) => {
    const led = charsRef.current.led;
    if (!led) {
      console.warn('[useUI] LED characteristic not available');
      return;
    }
    if (isWritingRef.current) {
      // Silently skip if a write is already active to prevent GATT lock errors
      return;
    }

    try {
      isWritingRef.current = true;
      console.log(`[useUI] Writing LED color: RGB(${r}, ${g}, ${b})`);
      // Mode 1: Constant color
      const payload = new Uint8Array([0x01, r, g, b]);
      await led.writeValue(payload);
    } catch (err) {
      console.error('[useUI] Failed to write LED color:', err);
    } finally {
      isWritingRef.current = false;
    }
  }, []);

  /** Turn off the LED */
  const turnLedOff = useCallback(async () => {
    const led = charsRef.current.led;
    if (!led) return;
    if (isWritingRef.current) return;

    try {
      isWritingRef.current = true;
      console.log('[useUI] Turning LED off...');
      const payload = new Uint8Array([0x00]);
      await led.writeValue(payload);
    } catch (err) {
      console.error('[useUI] Failed to turn off LED:', err);
    } finally {
      isWritingRef.current = false;
    }
  }, []);

  return { writeLedConstant, turnLedOff, isButtonPressed };
}
