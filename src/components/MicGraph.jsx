import { useEffect, useRef } from 'react';

const MAX_POINTS = 60;
const DB_MIN = 30;
const DB_MAX = 100;

/**
 * MicGraph — a real-time SPL (decibel) rolling line graph for the microphone.
 * Plots values from DB_MIN (30 dB) to DB_MAX (100 dB).
 * Includes horizontal reference lines at 40, 60, 80 dB.
 */
export default function MicGraph({ history, height = 140 }) {
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

    const pad = { top: 8, right: 8, bottom: 20, left: 36 };
    const graphW = w - pad.left - pad.right;
    const graphH = h - pad.top - pad.bottom;

    const toY = (db) => pad.top + ((1 - (db - DB_MIN) / (DB_MAX - DB_MIN)) * graphH);
    const toX = (i, total) => pad.left + (i / Math.max(total - 1, 1)) * graphW;

    // Draw background grid lines
    const gridLevels = [40, 60, 80];
    gridLevels.forEach((db) => {
      const y = toY(db);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(db + '', pad.left - 4, y + 3.5);
    });

    // Draw Y-axis label
    ctx.save();
    ctx.translate(10, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('dB SPL', 0, 0);
    ctx.restore();

    const points = history || [];
    if (points.length < 2) {
      ctx.fillStyle = 'rgba(244, 63, 94, 0.25)';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for mic data\u2026', pad.left + graphW / 2, pad.top + graphH / 2);
      return;
    }

    // Gradient fill under curve
    const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    gradient.addColorStop(0, 'rgba(244, 63, 94, 0.35)');
    gradient.addColorStop(1, 'rgba(244, 63, 94, 0.02)');

    ctx.beginPath();
    ctx.moveTo(toX(0, points.length), toY(points[0]));
    for (let i = 1; i < points.length; i++) {
      const x0 = toX(i - 1, points.length);
      const y0 = toY(points[i - 1]);
      const x1 = toX(i, points.length);
      const y1 = toY(points[i]);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.lineTo(toX(points.length - 1, points.length), h - pad.bottom);
    ctx.lineTo(toX(0, points.length), h - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke line
    ctx.beginPath();
    ctx.moveTo(toX(0, points.length), toY(points[0]));
    for (let i = 1; i < points.length; i++) {
      const x0 = toX(i - 1, points.length);
      const y0 = toY(points[i - 1]);
      const x1 = toX(i, points.length);
      const y1 = toY(points[i]);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Latest value dot
    const lastX = toX(points.length - 1, points.length);
    const lastY = toY(points[points.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f43f5e';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Current dB label
    ctx.fillStyle = '#f43f5e';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(points[points.length - 1] + ' dB', lastX + 6, lastY - 4);

  }, [history]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: height + 'px',
          display: 'block',
          background: 'rgba(0, 0, 0, 0.15)',
          borderRadius: 'var(--radius-md)',
        }}
      />
    </div>
  );
}

/**
 * Pushes a new dB value into the rolling history array (max MAX_POINTS entries).
 */
export function pushMicHistory(prev, value) {
  const next = [...prev, value];
  if (next.length > MAX_POINTS) next.shift();
  return next;
}
