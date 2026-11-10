// A celebration burst for canvas: pickleballs with motion trails and confetti, thrown up from one point and falling
// with gravity. Every position is worked out from time, so a frame can be drawn at any moment (or frozen for reduced
// motion). Used by the landing page's 3D phone and the game page's "game complete" recap. Browser only.

export const BURST_SECONDS = 3.6;

type Piece = { x: number; y: number; vx: number; vy: number; d: number; spin: number };
const COLORS = ["#FFC9A8", "#CFC6F2", "#B6DDE4", "#ffffff", "#E9C2E2"];

export function makeBurst(cx: number, cy: number, scale = 1, seed = 11) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const G = 1500 * scale;
  const balls = Array.from({ length: 13 }, () => ({ x: cx + (rnd() - 0.5) * 160 * scale, y: cy, vx: (rnd() - 0.5) * 900 * scale, vy: (-900 - rnd() * 700) * scale, r: (24 + rnd() * 16) * scale, d: rnd() * 0.25, spin: (rnd() - 0.5) * 8 }));
  const bits = Array.from({ length: 46 }, (_, i) => ({ x: cx + (rnd() - 0.5) * 240 * scale, y: cy, vx: (rnd() - 0.5) * 1100 * scale, vy: (-700 - rnd() * 900) * scale, w: (12 + rnd() * 12) * scale, h: (22 + rnd() * 14) * scale, c: COLORS[i % COLORS.length], d: rnd() * 0.3, spin: (rnd() - 0.5) * 14 }));
  const at = (p: Piece, t: number, drag: number) => {
    const u = Math.max(0, t - p.d);
    return [p.x + p.vx * u * drag, p.y + p.vy * u + 0.5 * G * u * u] as const;
  };
  const ball = (x: CanvasRenderingContext2D, X: number, Y: number, R: number, a: number, rot: number) => {
    x.save(); x.globalAlpha = a; x.translate(X, Y); x.rotate(rot);
    const g = x.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R); g.addColorStop(0, "#FFE3D2"); g.addColorStop(0.55, "#FFC9A8"); g.addColorStop(1, "#E89B72");
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();
    x.fillStyle = "rgba(150,80,50,.45)";
    [[0, 0], [0.5, 0.15], [-0.45, 0.25], [0.1, -0.52], [-0.2, 0.58], [0.48, -0.42]].forEach(([hx, hy]) => { x.beginPath(); x.arc(hx * R, hy * R, R * 0.11, 0, Math.PI * 2); x.fill(); });
    x.restore();
  };
  // Draws the burst at time t (seconds). Nothing is drawn before 0 or after BURST_SECONDS.
  return (x: CanvasRenderingContext2D, t: number) => {
    if (t <= 0 || t >= BURST_SECONDS) return;
    const fade = Math.max(0, Math.min(1, (BURST_SECONDS - t) / 0.8));
    bits.forEach((b) => {
      if (t < b.d) return;
      const [X, Y] = at(b, t, 0.75), u = t - b.d;
      x.save(); x.globalAlpha = fade; x.translate(X, Y); x.rotate(b.spin * u); x.scale(1, Math.cos(u * 9 + b.spin)); x.fillStyle = b.c; x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); x.restore();
    });
    balls.forEach((b) => {
      if (t < b.d) return;
      for (let k = 6; k >= 1; k--) {
        const tk = t - k * 0.035;
        if (tk > b.d) { const [X, Y] = at(b, tk, 1); ball(x, X, Y, b.r * (1 - k * 0.07), (0.32 - k * 0.045) * fade, 0); }
      }
      const [X, Y] = at(b, t, 1);
      ball(x, X, Y, b.r, fade, b.spin * (t - b.d));
    });
  };
}
