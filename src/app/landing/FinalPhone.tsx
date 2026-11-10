"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";

// The closing section's 3D phone: the hero's phone (metal frame, glass front) showing the settled game, set behind
// the copy and rising out of the top of the section. It turns as the section scrolls into view and leans toward the
// pointer. There is no idle animation, so nothing moves on its own; reduced motion holds it at its resting angle.
// three.js loads only when the section is near the screen. Without WebGL nothing is drawn.

const SW = 780, SH = 1760, SR = 104; // screen canvas, in px, as in the hero

export default function FinalPhone() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = ref.current!;
    let stop = () => {};
    let dead = false;
    const near = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      near.disconnect();
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;
      const T = await import("three");
      if (dead) return;
      try {
        stop = start(T, canvas, () => setReady(true));
      } catch {
        /* no phone, the section still reads fine */
      }
    }, { rootMargin: "600px 0px" });
    near.observe(canvas);
    return () => { dead = true; near.disconnect(); stop(); };
  }, []);

  return <canvas ref={ref} className="lp-final-gl" aria-hidden="true" data-ready={ready ? "" : undefined} />;
}

function start(T: typeof THREE_NS, canvas: HTMLCanvasElement, onReady: () => void): () => void {
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const section = canvas.parentElement as HTMLElement;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const rr = (x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) => {
    x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath();
  };
  const canvasTex = (w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t;
  };
  const slab = (w: number, h: number, r: number, d: number, b: number, mats: THREE_NS.Material[]) => {
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 5, curveSegments: 16 });
    g.translate(0, 0, -d / 2); return new T.Mesh(g, mats);
  };

  /* screen: the settled game, with a status bar like the hero's */
  const screenCanvas = document.createElement("canvas"); screenCanvas.width = SW; screenCanvas.height = SH;
  const screenTex = new T.CanvasTexture(screenCanvas); screenTex.encoding = T.sRGBEncoding; screenTex.anisotropy = 8;
  const paint = (im?: HTMLImageElement) => {
    const sx = screenCanvas.getContext("2d")!;
    sx.clearRect(0, 0, SW, SH); sx.save(); rr(sx, 0, 0, SW, SH, SR); sx.clip();
    const g = sx.createLinearGradient(0, 0, SW, 0); g.addColorStop(0, "#114C5D"); g.addColorStop(0.5, "#2B3970"); g.addColorStop(1, "#3B2F7A");
    sx.fillStyle = g; sx.fillRect(0, 0, SW, SH);
    if (im) sx.drawImage(im, 0, 110, SW, (SW * im.height) / im.width);
    sx.fillStyle = "#fff"; sx.font = "600 38px Figtree, system-ui, sans-serif"; sx.textBaseline = "middle"; sx.fillText("9:41", 74, 58);
    [[620, 46, 22], [632, 40, 28], [644, 34, 34], [656, 28, 40]].forEach(([x, y, h]) => { rr(sx, x, y, 8, h, 2); sx.fill(); });
    rr(sx, 676, 38, 52, 26, 8); sx.lineWidth = 3; sx.strokeStyle = "#fff"; sx.stroke(); rr(sx, 680, 42, 38, 18, 5); sx.fill();
    sx.fillStyle = "#000"; rr(sx, SW / 2 - 118, 22, 236, 70, 35); sx.fill();
    sx.restore(); screenTex.needsUpdate = true;
  };
  paint();
  const shot = new Image(); shot.onload = () => paint(shot); shot.src = "/shots/settled.webp";

  /* scene */
  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.1, 100); cam.position.set(0, 0, 16);
  const pm = new T.PMREMGenerator(r);
  const envTex = canvasTex(512, 256, (x) => {
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, "#e9e4ff"); g.addColorStop(0.45, "#5a4a9a"); g.addColorStop(0.55, "#1a1430"); g.addColorStop(1, "#0a0814");
    x.fillStyle = g; x.fillRect(0, 0, 512, 256); x.fillStyle = "rgba(255,201,168,.9)"; x.fillRect(92, 51, 41, 56); x.fillStyle = "rgba(120,220,235,.8)"; x.fillRect(338, 61, 31, 46);
  });
  envTex.mapping = T.EquirectangularReflectionMapping; scene.environment = pm.fromEquirectangular(envTex).texture; pm.dispose(); envTex.dispose();
  scene.add(new T.AmbientLight(0x8a7ac0, 0.6));
  const l1 = new T.PointLight(0xffc9a8, 1.6, 40); l1.position.set(5, 4, 8); scene.add(l1);
  const l2 = new T.PointLight(0x5fd0e0, 1.3, 40); l2.position.set(-6, -2, 6); scene.add(l2);

  const phone = new T.Group(), tilt = new T.Group(); phone.add(tilt); scene.add(phone);
  const frameMat = new T.MeshStandardMaterial({ color: 0x3a3352, metalness: 0.9, roughness: 0.26, envMapIntensity: 1.2 });
  const glassMat = new T.MeshStandardMaterial({ color: 0x07060c, metalness: 0.2, roughness: 0.08, envMapIntensity: 0.9 });
  tilt.add(slab(2.62, 5.58, 0.44, 0.2, 0.05, [glassMat, frameMat]));
  ([[1.3, 0.55, 1], [1.55, 0.3, -1], [0.95, 0.5, -1], [0.35, 0.5, -1]] as const).forEach(([y, h, side]) => {
    const b = new T.Mesh(new T.BoxGeometry(0.05, h, 0.1), frameMat); b.position.set(side * 1.345, y, 0); tilt.add(b);
  });
  const mask = canvasTex(SW / 4, SH / 4, (x) => { x.fillStyle = "#000"; x.fillRect(0, 0, SW / 4, SH / 4); x.fillStyle = "#fff"; rr(x, 0, 0, SW / 4, SH / 4, SR / 4); x.fill(); });
  const screen = new T.Mesh(new T.PlaneGeometry(2.44, (2.44 * SH) / SW), new T.MeshBasicMaterial({ map: screenTex, alphaMap: mask, transparent: true, toneMapped: false }));
  screen.position.z = 0.156; tilt.add(screen);

  /* layout: the phone fills the canvas height; the canvas itself is placed by CSS */
  const L = { W: 0, H: 0 };
  const layout = () => {
    const W = canvas.clientWidth, H = canvas.clientHeight; if (!W || !H) return;
    r.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix(); Object.assign(L, { W, H });
    const vh = 2 * cam.position.z * Math.tan((cam.fov * Math.PI) / 360);
    phone.scale.setScalar((vh * 0.8) / 5.6);
  };
  const ro = new ResizeObserver(layout); ro.observe(canvas); layout();

  /* motion: scroll turns it, the pointer leans it */
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e: PointerEvent) => { const b = section.getBoundingClientRect(); ptr.tx = ((e.clientX - b.left) / b.width) * 2 - 1; ptr.ty = ((e.clientY - b.top) / b.height) * 2 - 1; };
  const onLeave = () => { ptr.tx = 0; ptr.ty = 0; };
  if (!RM) { section.addEventListener("pointermove", onMove); section.addEventListener("pointerleave", onLeave); }
  let visible = true, raf = 0, sp = RM ? 1 : 0, first = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(canvas);
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    // 0 while the section's top is at the bottom of the screen, 1 once it reaches the upper third
    const b = section.getBoundingClientRect(), vh = innerHeight;
    const target = RM ? 1 : clamp((vh - b.top) / (vh * 0.7));
    sp += (target - sp) * 0.08;
    ptr.x += (ptr.tx - ptr.x) * 0.06; ptr.y += (ptr.ty - ptr.y) * 0.06;
    tilt.rotation.set(0.12 - 0.3 * (1 - sp) + ptr.y * 0.12, -0.42 - 0.7 * (1 - sp) + ptr.x * 0.25, 0.1 * (1 - sp) + 0.06);
    phone.position.y = -0.8 * (1 - sp);
    r.render(scene, cam);
    if (first) { first = false; onReady(); }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    section.removeEventListener("pointermove", onMove); section.removeEventListener("pointerleave", onLeave);
    scene.traverse((o) => { const m = o as THREE_NS.Mesh; if (m.geometry) m.geometry.dispose(); const mats = m.material ? ([] as THREE_NS.Material[]).concat(m.material) : []; mats.forEach((mt) => { const mm = mt as THREE_NS.MeshBasicMaterial; mm.map?.dispose(); mm.dispose(); }); });
    screenTex.dispose(); mask.dispose(); r.dispose();
  };
}
