# Nordic Thingy:52 Dashboard — How It Works

This document describes the technical architecture, Web Bluetooth (BLE) interactions, and signal processing methods implemented in this application.

---

## 1. Connection & Lifecycle Management (`useBluetooth.js`)

Web Bluetooth uses the GATT (Generic Attribute Profile) client-server architecture. The browser connects to the GATT server hosted on the Nordic Thingy:52.

*   **Discovery Filtering**: The app requests the device by filtering for names prefixed with `Thingy` or `Nordy`, and specifies the base UUID configurations.
*   **Sequential Hook Execution**: To prevent flooding the Thingy:52's BLE controller (which causes instant GATT connection drops), the initialization callbacks are fired sequentially with a **300ms delay** between each service configuration.
*   **Connection Parameters Optimization**: On successful connection, the app writes custom parameters to the Configuration Service characteristic `0104` (Min connection interval = 15ms, Max = 30ms, Slave Latency = 0, Supervision Timeout = 2000ms). This speeds up the connection link and prevents queue buffer overflows, allowing high-throughput microphone decibel streaming without drops.
*   **MTU Negotiation**: To allow the microphone PDM driver to initialize and function without firmware assertions/hard crashes, the app negotiates the Maximum Transmission Unit (MTU) size by writing a `276` byte MTU request payload (`[0x01, 0x14, 0x01]`) to Configuration Service characteristic `0108`.
*   **Callback Deduplication**: Callback registration methods verify duplicates to ensure React renders don't bind duplicate listeners.
*   **Teardown & Cleanups**: Upon disconnection, all registered listeners are explicitly removed, and the active `setTimeout` timers are cleared to avoid race conditions on a dead connection.

---

## 2. Environment Sensors & On-Demand Color (`useEnvironment.js`)

Coordinates all sensors under the **Environment Service (`0200`)**.

*   **Automatic Streaming**: Temperature (`0201`), Pressure (`0202`), Humidity (`0203`), and Air Quality (`0204` eCO₂/TVOC) notifications start automatically upon connection.
*   **On-Demand Color Scanning (`0205`)**: The color sensor (BH1745) consumes significant power. To save battery and BLE bandwidth:
    1.  By default, it is inactive.
    2.  Clicking **Start Color Scanning** writes `0x03E8` (1000ms) to bytes 6–7 of the `ENV_CONFIG` characteristic (`0206`) to activate the physical color sensor.
    3.  A **300ms delay** is scheduled to allow the color sensor hardware to boot and stabilize before enabling notifications.
    4.  Clicking **Stop Color Scanning** writes `0x0000` (disabled) to the color interval config and halts notifications.
*   **UI Color Preview**: Sensed color channels (Red, Green, Blue, Clear) are dynamically scaled relative to the maximum channel value to produce a true color visualization block on the dashboard.

---

## 3. Motion, Fusion, & Compass Smoothing (`useMotion.js`)

Handles high-frequency movement coordinates under the **Motion Service (`0400`)**.

*   **MPU9250 Sensor Fusion Activation**: Quaternions require the on-board DMP (Digital Motion Processor) to run. On setup, the app reads the **Motion Config characteristic (`0401`)**. If MPU frequency is read as `0`, it writes `20 Hz` to activate the IMU and fusion engines.
*   **Orientation detection (`0403`)**: Reads a single byte indicating the physical position of the device:
    *   `0x00`: Portrait
    *   `0x01`: Landscape
    *   `0x02`: Reverse Portrait
    *   `0x03`: Reverse Landscape
*   **Compass Smoothing**: Raw magnetometer data (Compass X, Y, Z) is highly susceptible to surrounding noise and local interference. To prevent the heading dial from fluctuating wildly, an **Exponential Moving Average (EMA)** filter is applied:
    $$\text{Smoothed}_t = \alpha \cdot \text{Raw}_t + (1 - \alpha) \cdot \text{Smoothed}_{t-1}$$
    With $\alpha = 0.08$, providing a jitter-free, smooth rotating compass needle.
*   **Gravity Vector Graph**: Plots the normalized three-axis accelerometer gravity vectors on a rolling canvas, colored Red (X), Green (Y), and Blue (Z).
*   **3D Device Visualizer**: Implements a CSS 3D model styled to resemble the physical Thingy:52 rubber casing, base label, and active LED band, rotating in real-time based on Euler angles derived from the quaternion.

---

## 4. Sound & Speaker Controls (`useSound.js`)

Manages the buzzer speaker and microphone noise level under the **Sound Service (`0500`)**.

*   **On-Demand Microphone SPL (`0504`)**: Microphone listening is off by default to save bandwidth. Turning it on writes Speaker Mode = `0x01` and Mic Mode = `0x02` (Sound Pressure Level) to the **Sound Config characteristic (`0501`)**. A **300ms delay** is enforced to let the PDM driver fully transition before subscribing.
    1.  **ADPCM Decoding & SPL Calculation**: Even when requested in SPL mode, the Thingy:52 firmware streams `131`-byte ADPCM raw audio packets (consisting of a 3-byte predictor/index header and 128 data bytes). The application decodes the 256 nibble-compressed samples back to PCM using step-size predictors, computes the **Root Mean Square (RMS)** amplitude:
        $$\text{RMS} = \sqrt{\frac{1}{N} \sum_{i=1}^N x_i^2}$$
        And maps the RMS to a standard decibel scale ($\text{dB} = 20 \cdot \log_{10}(\text{RMS}) + 95$).
    2.  **React Re-render Throttling**: Because the microphone streams packets continuously at a high frequency (approx. 50 packets per second), updating the React state on every packet freezes the browser main thread and triggers BLE timeout disconnects. The event handler implements a **300ms throttle** to keep rendering fast and stable.
*   **Speaker Tone Generation (`0502`)**: Frequency mode plays custom beeps by writing a 5-byte payload:
    *   `Bytes 0–1 (uint16_t)`: Frequency (Hz)
    *   `Bytes 2–3 (uint16_t)`: Duration (ms)
    *   `Byte 4 (uint8_t)`: Volume (%)
*   **Sound Effects / Predefined Samples**: Sample mode writes a **strict 1-byte** payload representing the chosen Sample ID (`0x00`–`0x08`) to the speaker data characteristic.
*   **GATT Safety Measures**: 
    *   Never writes `0x00` as the microphone mode to Sound Config (defaulting to the valid `0x01` idle ADPCM mode instead) to avoid firmware validation failures.
    *   Triggers `writeValueWithoutResponse()` for speaker commands to match the write-without-response GATT parameter.

---

## 5. UI LED Controller & Sync (`useUI.js`)

Interacts with the **User Interface Service (`0300`)** to drive the RGB LED.

*   **LED Writes (`0301`)**: Writes `[0x01, R, G, B]` (Mode 1 Constant) to light up the physical LED, and `[0x00]` (Mode 0 Off) to turn it off.
*   **Sensed Color Sync**: When **Sync with Sensed Color** is checked, color notifications received from the environment sensor are dynamically normalized and written to the physical LED, making the device's LED match the color it is currently looking at.

---

## 6. Moonlight Ambient 3D View (`MoonlightAmbient.jsx`)

Provides an alternative interactive 3D application inside the app layout.

*   **Three.js Canvas & Scene**: Renders a dark 90s bedroom box (floor, walls, bed, bedside table, CRT TV glowing with static) under custom starry sky (`<Stars />`).
*   **Moonlight & Spotlight**: A directional sky light mimics moonlight shining diagonally through a back window cutout casting shadows. A warm point light sits inside a ceiling-hung bulb.
*   **Pendulum Physics (`@react-three/rapier`)**: The bulb body is connected to a fixed ceiling anchor point via a `useSphericalJoint` constraint.
*   **Accelerometer Integration**: Continuous forces are added to the bulb rigid body inside a `useFrame` hook based on the active Thingy:52 accelerometer vector values (offsetting the resting Z gravity component):
    ```javascript
    const fx = -accel.x * forceScale;
    const fz = accel.y * forceScale;
    const fy = (accel.z - 9.8) * forceScale;
    Shaking or tilting the physical device simulates an altered gravity vector, causing the lightbulb to swing and cast moving shadows dynamically in the 3D room.

---

## 7. Metal Balls Tank 3D View (`MetalBallsTank.jsx`)

An interactive physical simulator displaying steel ball bearings inside a glass enclosure.

*   **Glass Enclosure**: Rendered as a transparent blue glass container (`metalness=0.2`, `opacity=0.25`, `transparent`) bounded by six rigid walls to lock the balls inside, set against a clean studio white background (`#f8fafc`).
*   **Bouncy Steel Ball Bearings**: Renders 55 dynamic spheres with shiny silver properties (`metalness=0.96`, `roughness=0.06`, color `#f1f5f9`) that collide with each other and bounce off the glass walls.
*   **Dynamic Gravity Mapping**: Uses `accel` values from the `MPU9250` IMU sensor on the Thingy:52 to dynamically drive the global gravity vector of the physics engine:
    ```javascript
    const gx = -(accel.x - bx) * 1.5;
    const gz = (accel.y - by) * 1.5;
    const gy = -(accel.z - bz + 9.80665) * 1.5;
    ```
    *   **Tilting**: Gravity shifts sideways/forward, making the balls roll and pile up along the tank walls.
    *   **Shaking**: Rapid changes in gravity launch the balls into the air, bouncing off the ceiling and floor (using `restitution=0.65`).
*   **Auto-Calibration & Reference Reset**: Automatically calibrates the baseline resting position on the very first incoming packet. The **🔄 Reset / Calibrate Current Position** button sets the current physical orientation as the baseline gravity reference, causing the balls to fall flat to the bottom of the glass tank in your current pose.
*   **Jitter Low-Pass Filter**: The acceleration vector is smoothed using an Exponential Moving Average (EMA, $\alpha=0.06$) to keep the rolling animation clean, responsive, and completely jitter-free.

---

## 8. Calibration & Normalization (`calibrationUtils.js`)

To ensure consistent behavior across all 3D components and visualizations, sensor calibration values are standardized using a common calibration function.

*   **Default Constants**: `DEFAULT_CALIBRATION` (in `constants.js`) defines the baseline state for offsets, polarities (`rollSign`, `pitchSign`), scaling factors, and Kalman filter tuning parameters.
*   **Common Formula**: `getCalibratedForces()` centralizes the math used to compute relative forces based on raw or filtered accelerometer inputs. By applying baseline offsets and configured polarities/scales centrally, the different components (e.g., `PaintDripCanvas`, `MetalBallsTank`) behave predictably and remain easy to tune globally.
