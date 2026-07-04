import { useEffect, useRef } from 'react';

/**
 * LineChart — a rolling real-time canvas chart with no dependencies.
 *
 * Props:
 *   history   { values: number[], timestamps: number[] }
 *   color     CSS color string for the line/fill
 *   height    canvas height in px (default 60)
 *   label     optional y-axis label string
 */
export default function LineChart({ history, color = '#7c6ff7', height = 60, label }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    // Resize canvas to match display pixels
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const { values } = history;
    if (values.length < 2) {
      // Draw an empty baseline
      ctx.strokeStyle = `${color}44`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      return;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const pad = 4;
    const toY = (v) => pad + ((1 - (v - min) / range) * (h - pad * 2));
    const toX = (i) => (i / (values.length - 1)) * w;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `${color}55`);
    grad.addColorStop(1, `${color}00`);

    // Fill path
    ctx.beginPath();
    ctx.moveTo(toX(0), h);
    ctx.lineTo(toX(0), toY(values[0]));
    for (let i = 1; i < values.length; i++) {
      const x0 = toX(i - 1);
      const y0 = toY(values[i - 1]);
      const x1 = toX(i);
      const y1 = toY(values[i]);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.lineTo(toX(values.length - 1), h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(values[0]));
    for (let i = 1; i < values.length; i++) {
      const x0 = toX(i - 1);
      const y0 = toY(values[i - 1]);
      const x1 = toX(i);
      const y1 = toY(values[i]);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Latest dot
    const lastX = toX(values.length - 1);
    const lastY = toY(values[values.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

  }, [history, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
      aria-label={label ? `${label} chart` : 'Sensor data chart'}
    />
  );
}
