/**
 * OrientationCube — CSS 3D realistic Thingy:52 model that rotates based on quaternion data.
 * Features curved edges, light grey plastic base, dark rubber cover, and a working LED strip.
 */
export default function OrientationCube({ euler, ledColor = 'rgb(0, 255, 0)' }) {
  const { roll = 0, pitch = 0, yaw = 0 } = euler || {};

  // 1. Establish the vertical baseline math
  // Your physical Pitch (88°) is pointing up. We subtract 90 to make "straight up" 0°.
  const verticalPitch = pitch + 160;

  // Your physical Roll (-149°) is tracking your left-to-right twist. 
  // We add 150° (or roughly 180° depending on how it's oriented) to flip the Nordic label to face you.
  const verticalRoll = roll + 270;

  // 2. Map them into the CSS 3D space by swapping their jobs:
  // - Tilted forward/backward now depends on your 'verticalPitch' -> rotateX
  // - Twisted left/right now depends on your 'verticalRoll' -> rotateY
  // - Spin/Lean sideways now tracks your Yaw -> rotateZ

  // 2. Adjust Z-rotation by 90 degrees to spin the logo from vertical to horizontal
  const straightenedYaw = yaw - 90;

  // Convert angles to 3D CSS rotate transforms
  const transform = `
    rotateX(${verticalPitch}deg)
    rotateY(${verticalRoll}deg)
    rotateZ(${straightenedYaw}deg)
  `;

  return (
    <div className="cube-scene" aria-label="3D orientation visualizer">
      <div className="cube" style={{ transform }}>

        {/* Top Face (Dark rubber cover with logo and button) */}
        <div className="cube__face cube__face--top">
          <div className="thingy-top-btn" />
          <div className="thingy-logo">thingy:52</div>
        </div>

        {/* Bottom Face (Light grey plastic base) */}
        <div className="cube__face cube__face--bottom">
          <div className="thingy-base-label">NORDIC</div>
        </div>

        {/* Front Face (Rubber + LED band + Plastic base) */}
        <div className="cube__face cube__face--front">
          <div className="thingy-led-strip" style={{ backgroundColor: ledColor, boxShadow: `0 0 12px ${ledColor}` }} />
          <div className="thingy-usb-slot" />
        </div>

        {/* Back Face */}
        <div className="cube__face cube__face--back">
          <div className="thingy-led-strip" style={{ backgroundColor: ledColor, boxShadow: `0 0 12px ${ledColor}` }} />
        </div>

        {/* Left Face */}
        <div className="cube__face cube__face--left">
          <div className="thingy-led-strip" style={{ backgroundColor: ledColor, boxShadow: `0 0 12px ${ledColor}` }} />
          <div className="thingy-switch" />
        </div>

        {/* Right Face */}
        <div className="cube__face cube__face--right">
          <div className="thingy-led-strip" style={{ backgroundColor: ledColor, boxShadow: `0 0 12px ${ledColor}` }} />
        </div>

      </div>
    </div>
  );
}
