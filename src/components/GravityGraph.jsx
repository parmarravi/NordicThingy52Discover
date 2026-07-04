import { useEffect, useRef } from 'react';

/**
 * GravityGraph — a real-time 3-axis canvas line graph for X, Y, Z gravity vector coordinates.
 */
export default function GravityGraph({ history, height = 120 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const { x, y, z } = history || { x: [], y: [], z: [] };
    const pointsCount = x.length;

    // Draw baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (pointsCount < 2) {
      return;
    }

    // Find min and max across all three channels to scale them relative to each other
    const allValues = [...x, ...y, ...z];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    const range = maxVal - minVal || 1;

    const pad = 10;
    const toY = (v) => pad + ((1 - (v - minVal) / range) * (h - pad * 2));
    const toX = (i) => (i / (pointsCount - 1)) * w;

    const drawLine = (values, color) => {
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
    };

    // Draw X component (Red)
    drawLine(x, '#ef4444');
    // Draw Y component (Green)
    drawLine(y, '#10b981');
    // Draw Z component (Blue)
    drawLine(z, '#3b82f6');

  }, [history]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: `${height}px`, display: 'block', background: 'rgba(0, 0, 0, 0.15)', borderRadius: 'var(--radius-md)' }}
      />
    </div>
  );
}
