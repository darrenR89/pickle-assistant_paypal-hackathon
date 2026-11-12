"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";

// The hero's 3D phone. A WebGL phone (metal frame, glass front) shows the live game page, tilts with the
// pointer, and has chat lines from a real game drifting around it. Play keeps the phone upright, moves it
// aside and plays the demo on its screen while a chapter rail explains each step.
//
// With NEXT_PUBLIC_DEMO_VERTICAL_SRC set (a vertical MP4 of the phone screen recording) the video plays on
// the phone's screen and the chapters follow its time. Without it, the screen steps through the app screens
// chapter by chapter. three.js loads after the page paints; without WebGL a still phone image is shown.

export type Chapter = { t: number; shot: string; title: string; body: string };
type Props = { chapters: Chapter[]; duration: number; videoSrc?: string; youtubeId?: string };

const SW = 780, SH = 1760, SR = 104; // screen canvas, in px (status bar band + 780 x 1688 screenshot)
const LIGHT_TOP = new Set(["chat", "dm"]);
// Matches the stacked hero in globals.css: phones and tablets in portrait. Tablets get a taller phone.
const NARROW_MQ = "(max-width: 900px)", TABLET_MQ = "(min-width: 641px)";
const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const CHAT: Array<[string, string, 0 | 1 | 2 | 3]> = [
  ["Sam", "yeah I’m down", 0],
  ["Assistant", "4 of 8 in · 4 spots left", 1],
  ["Priya", "count me in!", 0],
  ["", "$8 held, not charged", 2],
  ["Mei", "in", 0],
  ["", "Settled · $8 each", 3],
  ["Lee", "can someone take my spot?", 0],
  ["Assistant", "Thu 6pm · Courts 3–4", 1],
];

const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';

export default function HeroStage({ chapters, duration, videoSrc, youtubeId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"pending" | "gl" | "still">("pending");

  useEffect(() => {
    let dead = false;
    let stop = () => {};
    (async () => {
      const canvas = canvasRef.current!;
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return setMode("still");
      const T = await import("three");
      if (dead) return;
      try {
        stop = start(T, {
          canvas,
          hero: canvas.parentElement as HTMLElement,
          play: playRef.current!,
          close: closeRef.current!,
          rail: railRef.current!,
          motion: motionRef.current!,
          video: videoRef.current,
          chapters,
          duration,
        });
        setMode("gl");
      } catch {
        setMode("still");
      }
    })();
    return () => {
      dead = true;
      stop();
    };
  }, [chapters, duration]);

  return (
    <>
      <canvas ref={canvasRef} className="lp-gl" aria-hidden="true" data-ready={mode === "gl" ? "" : undefined} />
      {mode === "still" && (
        <span className="lp-still" aria-hidden="true">
          <img src="/shots/game.webp" alt="" width={390} height={844} />
        </span>
      )}
      {videoSrc && <video ref={videoRef} src={videoSrc} playsInline preload="metadata" hidden />}
      <button ref={playRef} type="button" className="lp-play" hidden={mode !== "gl"}>
        <span className="lp-play-ring" />
        <span className="lp-play-disc">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v17l14-8.5z" /></svg>
        </span>
        <span className="lp-play-label">Play demo</span>
      </button>
      <button ref={closeRef} type="button" className="lp-close" inert>Close demo</button>
      <button ref={motionRef} type="button" className="lp-motion" aria-pressed="false" hidden={mode !== "gl"}>
        <span dangerouslySetInnerHTML={{ __html: PAUSE_ICON }} />
        <span className="lp-motion-label">Pause motion</span>
      </button>
      <div ref={railRef} className="lp-rail" role="group" aria-label="Demo chapters" inert>
        <div className="lp-rail-head">
          <button type="button" className="lp-rail-pp" aria-label="Pause" dangerouslySetInnerHTML={{ __html: PAUSE_ICON }} />
          <div>
            <p className="lp-rail-title">{videoSrc ? "The demo video" : "How a game plays out"}</p>
            <span className="lp-rail-time">0:00 / {fmt(duration)}</span>
          </div>
        </div>
        <div className="lp-rail-seg" aria-hidden="true">
          {chapters.map((c) => <i key={c.t}><b /></i>)}
        </div>
        <ol className="lp-rail-ch">
          {chapters.map((c) => (
            <li key={c.t}>
              <button type="button">
                <time>{fmt(c.t)}</time>
                <b>{c.title}</b>
                <span>{c.body}</span>
                <i />
              </button>
            </li>
          ))}
        </ol>
        {youtubeId && (
          <a className="lp-rail-yt" href={`https://www.youtube.com/watch?v=${youtubeId}`}>Watch the full video on YouTube</a>
        )}
      </div>
    </>
  );
}

type Env = {
  canvas: HTMLCanvasElement;
  hero: HTMLElement;
  play: HTMLButtonElement;
  close: HTMLButtonElement;
  rail: HTMLDivElement;
  motion: HTMLButtonElement;
  video: HTMLVideoElement | null;
  chapters: Chapter[];
  duration: number;
};

function start(T: typeof THREE_NS, env: Env): () => void {
  const { canvas, hero, play, close, rail, motion, video, chapters } = env;
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // WCAG 2.2.2: the idle float and drifting chat cards run forever, so the viewer can stop them. Reduced motion
  // starts with them stopped; CSS hides the button then because there is nothing to pause.
  let still = RM, clock = 0;
  const onMotion = () => {
    still = !still;
    motion.setAttribute("aria-pressed", String(still));
    motion.firstElementChild!.innerHTML = still ? PLAY_ICON : PAUSE_ICON;
    motion.lastElementChild!.textContent = still ? "Play motion" : "Pause motion";
  };
  motion.addEventListener("click", onMotion);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* ---------- helpers ---------- */
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

  /* ---------- screen painting ---------- */
  const imgs: Record<string, HTMLImageElement> = {};
  const screenCanvas = document.createElement("canvas"); screenCanvas.width = SW; screenCanvas.height = SH;
  const sx = screenCanvas.getContext("2d")!;
  const screenTex = new T.CanvasTexture(screenCanvas); screenTex.encoding = T.sRGBEncoding; screenTex.anisotropy = 8;
  let painted = "";
  const paintScreen = (key: string) => {
    if (painted === key && imgs[key]) return;
    const light = LIGHT_TOP.has(key);
    sx.clearRect(0, 0, SW, SH); sx.save(); rr(sx, 0, 0, SW, SH, SR); sx.clip();
    const g = sx.createLinearGradient(0, 0, SW, 0); g.addColorStop(0, light ? "#fff" : "#114C5D"); g.addColorStop(0.5, light ? "#fff" : "#2B3970"); g.addColorStop(1, light ? "#fff" : "#3B2F7A");
    sx.fillStyle = g; sx.fillRect(0, 0, SW, 130);
    const im = imgs[key]; if (im) sx.drawImage(im, 0, 110, SW, (SW * im.height) / im.width);
    sx.fillStyle = light ? "#000" : "#fff"; sx.font = "600 38px Figtree, system-ui, sans-serif"; sx.textBaseline = "middle"; sx.fillText("9:41", 74, 58);
    [[620, 46, 22], [632, 40, 28], [644, 34, 34], [656, 28, 40]].forEach(([x, y, h]) => { rr(sx, x, y, 8, h, 2); sx.fill(); });
    rr(sx, 676, 38, 52, 26, 8); sx.lineWidth = 3; sx.strokeStyle = sx.fillStyle; sx.stroke(); rr(sx, 680, 42, 38, 18, 5); sx.fill();
    sx.fillStyle = "#000"; rr(sx, SW / 2 - 118, 22, 236, 70, 35); sx.fill();
    sx.restore(); screenTex.needsUpdate = true; painted = im ? key : "";
  };
  const shots = Array.from(new Set(["game", ...chapters.map((c) => c.shot)]));
  shots.forEach((k) => { const i = new Image(); i.onload = () => { imgs[k] = i; }; i.src = `/shots/${k}.webp`; });

  /* ---------- scene ---------- */
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
  const screenMat = new T.MeshBasicMaterial({ map: screenTex, alphaMap: mask, transparent: true, toneMapped: false });
  const screen = new T.Mesh(new T.PlaneGeometry(2.44, (2.44 * SH) / SW), screenMat); screen.position.z = 0.156; tilt.add(screen);

  let videoTex: THREE_NS.VideoTexture | null = null;
  if (video) {
    videoTex = new T.VideoTexture(video); videoTex.encoding = T.sRGBEncoding;
    const fit = () => {
      if (!videoTex || !video.videoWidth) return;
      const va = video.videoWidth / video.videoHeight, pa = SW / SH;
      if (va > pa) { videoTex.repeat.set(pa / va, 1); videoTex.offset.set((1 - pa / va) / 2, 0); } else { videoTex.repeat.set(1, va / pa); videoTex.offset.set(0, (1 - va / pa) / 2); }
    };
    video.addEventListener("loadedmetadata", fit); fit();
  }

  /* chat lines: small, see-through, kept off the copy and off the phone's screen */
  const ring = new T.Group(); scene.add(ring);
  const cards = CHAT.map(([who, msg, kind], i) => {
    const w = 520, h = who ? 132 : 100;
    const tex = canvasTex(w, h, (x) => {
      const fill = kind === 2 ? "rgba(255,201,168,.3)" : kind === 3 ? "rgba(170,235,200,.26)" : kind === 1 ? "rgba(20,14,50,.5)" : "rgba(255,255,255,.24)";
      const edge = kind === 2 ? "rgba(255,201,168,.9)" : kind === 3 ? "rgba(170,235,200,.8)" : "rgba(255,255,255,.5)";
      const ink = kind === 2 ? "#FFC9A8" : kind === 3 ? "#bdf0d4" : "rgba(255,255,255,.92)";
      x.font = "600 34px Figtree, system-ui, sans-serif";
      rr(x, 4, h - 84, Math.min(w - 12, x.measureText(msg).width + 52), 78, 34); x.fillStyle = fill; x.fill(); x.strokeStyle = edge; x.lineWidth = 2.5; x.stroke();
      x.fillStyle = ink; x.textBaseline = "middle"; x.fillText(msg, 30, h - 45);
      if (who) { x.fillStyle = "rgba(255,255,255,.6)"; x.font = "600 24px Figtree, system-ui, sans-serif"; x.fillText(who, 16, 20); }
    });
    const m = new T.Mesh(new T.PlaneGeometry(w / 200, h / 200), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: T.DoubleSide }));
    m.userData = { a: (i / CHAT.length) * Math.PI * 2, y: (((i * 5) % 8) - 3.5) * 0.6, w: w / 200, h: h / 200 };
    ring.add(m); return m;
  });

  /* ---------- layout ---------- */
  const L = { W: 0, H: 0, s: 1, vh: 1, vw: 1, base: new T.Vector3(), vertS: 1, vertP: new T.Vector3(), copyR: 0, copyB: 0, narrow: false };
  const layout = () => {
    const W = hero.clientWidth, H = hero.clientHeight; if (!W || !H) return;
    r.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
    const vh = 2 * cam.position.z * Math.tan((cam.fov * Math.PI) / 360), vw = (vh * W) / H, wpp = vh / H, narrow = matchMedia(NARROW_MQ).matches;
    Object.assign(L, { W, H, vh, vw, narrow });
    if (narrow) { const ph = matchMedia(TABLET_MQ).matches ? 460 : 380; L.s = (ph * wpp) / 5.6; L.base.set(0, (H / 2 - (H - ph / 2 - 60)) * wpp, 0); L.vertS = Math.min(L.s * 1.3, ((H - 330) * wpp) / 5.7); L.vertP.set(0, (H / 2 - (300 + (H - 300) / 2)) * wpp, 0); }
    else { L.s = Math.min(1, (vh * 0.74) / 5.6); L.base.set(Math.min(vw * 0.24, vw / 2 - 2.4), -0.1, 0); L.vertS = Math.min(1.08, (vh * 0.86) / 5.6); L.vertP.set(Math.max(-vw * 0.2, -vw / 2 + 2.2), 0, 0); }
    const hb = hero.getBoundingClientRect(); L.copyR = 0; L.copyB = 0;
    hero.querySelectorAll(".lp-hero-copy > *").forEach((el) => { const b = el.getBoundingClientRect(); L.copyR = Math.max(L.copyR, b.right - hb.left); L.copyB = Math.max(L.copyB, b.bottom - hb.top); });
  };
  const ro = new ResizeObserver(layout); ro.observe(hero); layout();

  /* ---------- player state + rail ---------- */
  const lis = Array.from(rail.querySelectorAll<HTMLLIElement>(".lp-rail-ch li"));
  const bars = lis.map((li) => li.querySelector("i") as HTMLElement);
  const segs = Array.from(rail.querySelectorAll<HTMLElement>(".lp-rail-seg b"));
  const timeEl = rail.querySelector(".lp-rail-time") as HTMLElement;
  const pp = rail.querySelector(".lp-rail-pp") as HTMLButtonElement;
  const S = { playing: false, p: 0, sec: 0, paused: false, chi: -1 };
  const dur = () => (video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : env.duration);
  const now = () => (video ? video.currentTime : S.sec);
  const setPaused = (v: boolean) => { S.paused = v; if (video) { if (v) video.pause(); else void video.play().catch(() => { S.paused = true; }); } };
  const seek = (t: number) => { if (video) video.currentTime = t; else S.sec = t; setPaused(false); };
  lis.forEach((li, i) => li.querySelector("button")!.addEventListener("click", () => seek(chapters[i].t)));
  pp.addEventListener("click", () => { if (now() >= dur() - 0.05) seek(0); else setPaused(!S.paused); });
  // While the demo fills the screen, everything outside the hero (and the hidden play button) is taken out of
  // the tab order and the screen reader's view, so focus stays with the player's controls.
  const outside = (off: boolean) => {
    play.inert = off;
    for (let el: HTMLElement | null = hero; el && el !== document.body; el = el.parentElement)
      for (const sib of Array.from(el.parentElement?.children ?? [])) if (sib !== el && sib instanceof HTMLElement) sib.inert = off;
  };
  const open = (e?: Event) => {
    e?.preventDefault(); if (S.playing) return;
    window.scrollTo(0, 0);
    S.playing = true; S.sec = 0; S.chi = -1; hero.classList.add("playing"); rail.inert = false; close.inert = false; outside(true);
    if (video) { video.currentTime = 0; } setPaused(false);
    close.focus({ preventScroll: true });
  };
  const shut = () => { if (!S.playing) return; S.playing = false; if (video) video.pause(); hero.classList.remove("playing"); rail.inert = true; close.inert = true; outside(false); play.focus({ preventScroll: true }); };
  const triggers = [play, ...Array.from(document.querySelectorAll<HTMLElement>("[data-play-demo]"))];
  triggers.forEach((b) => b.addEventListener("click", open));
  close.addEventListener("click", shut);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") shut(); };
  hero.addEventListener("keydown", onKey);
  const syncRail = () => {
    const sec = now(), D = dur(), i = chapters.reduce((a, c, k) => (sec >= c.t ? k : a), 0);
    if (i !== S.chi) { lis.forEach((li, k) => li.classList.toggle("on", k === i)); S.chi = i; }
    chapters.forEach((c, k) => { const end = chapters[k + 1] ? chapters[k + 1].t : D, f = clamp((sec - c.t) / (end - c.t)); bars[k].style.width = k === i ? `${f * 100}%` : "0"; segs[k].style.width = `${f * 100}%`; });
    const tx = `${fmt(sec)} / ${fmt(D)}`; if (timeEl.textContent !== tx) timeEl.textContent = tx;
    const lab = S.paused ? "Play" : "Pause"; if (pp.getAttribute("aria-label") !== lab) { pp.setAttribute("aria-label", lab); pp.innerHTML = S.paused ? PLAY_ICON : PAUSE_ICON; }
    return chapters[i];
  };
  if (video) video.addEventListener("ended", () => { S.paused = true; });

  /* ---------- pointer ---------- */
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e: PointerEvent) => { const b = hero.getBoundingClientRect(); ptr.tx = ((e.clientX - b.left) / b.width) * 2 - 1; ptr.ty = ((e.clientY - b.top) / b.height) * 2 - 1; };
  const onLeave = () => { ptr.tx = 0; ptr.ty = 0; };
  hero.addEventListener("pointermove", onMove); hero.addEventListener("pointerleave", onLeave);

  /* ---------- loop ---------- */
  let visible = true, raf = 0, prev = performance.now();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(hero);
  const v3 = new T.Vector3(), wv = new T.Vector3(), tf = Math.tan((cam.fov * Math.PI) / 360);
  const frame = (ms: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ms - prev) / 1000); prev = ms;
    if (!visible || document.hidden) return;
    if (!still) clock += dt;
    const t = clock;
    ptr.x += (ptr.tx - ptr.x) * 0.06; ptr.y += (ptr.ty - ptr.y) * 0.06;
    const target = S.playing ? 1 : 0; S.p += (target - S.p) * (RM ? 1 : Math.min(1, dt * 3.2)); if (Math.abs(target - S.p) < 0.001) S.p = target;
    const p = ease(S.p);

    /* screen: the game page at rest; while playing, the video or the chapter's screen */
    if (p > 0.25 && S.playing) {
      if (!video && !S.paused) { S.sec = Math.min(dur(), S.sec + dt); if (S.sec >= dur()) S.paused = true; }
      const ch = syncRail();
      if (videoTex) { if (screenMat.map !== videoTex) { screenMat.map = videoTex; screenMat.needsUpdate = true; } }
      else paintScreen(ch.shot);
    } else if (p < 0.25) {
      if (screenMat.map !== screenTex) { screenMat.map = screenTex; screenMat.needsUpdate = true; }
      paintScreen("game");
    }

    const s = L.s + (L.vertS - L.s) * p;
    phone.position.set(L.base.x + (L.vertP.x - L.base.x) * p, L.base.y + (L.vertP.y - L.base.y) * p + (RM ? 0 : Math.sin(t * 1.1) * 0.08 * (1 - p)), 0);
    phone.scale.setScalar(s);
    const idleY = -0.38 + ptr.x * 0.32 + (RM ? 0 : Math.sin(t * 0.5) * 0.05);
    tilt.rotation.set((0.06 + ptr.y * 0.16) * (1 - p), idleY + (0.22 + ptr.x * 0.06 - idleY) * p, 0);

    ring.position.copy(phone.position);
    cards.forEach((c) => {
      const u = c.userData as { a: number; y: number; w: number; h: number }, a = u.a + t * 0.12, R = 3.2 * L.s;
      c.position.set(Math.cos(a) * R * 1.05, u.y * L.s, Math.sin(a) * R - 0.5 * L.s); c.scale.setScalar(L.s * 0.9);
      c.lookAt(ring.position.x + c.position.x * 2, ring.position.y + c.position.y, 40);
      wv.copy(c.position).add(ring.position);
      const wpp = (2 * (cam.position.z - wv.z) * tf) / L.H, hw = (u.w * c.scale.x) / 2 / wpp, hh = (u.h * c.scale.x) / 2 / wpp;
      wv.project(cam); const px = (wv.x * 0.5 + 0.5) * L.W, py = (-wv.y * 0.5 + 0.5) * L.H;
      const clear = L.narrow ? clamp((py - hh - L.copyB - 12) / 50) : clamp((px - hw - L.copyR - 28) / 70);
      const offScreen = c.position.z > 0 ? clamp((Math.abs(c.position.x) - 1.1 * L.s) / (1.2 * L.s)) : 1;
      const mat = c.material as THREE_NS.MeshBasicMaterial;
      mat.opacity = (0.42 + 0.5 * (Math.sin(a) * 0.5 + 0.5)) * clear * (0.15 + 0.85 * offScreen) * (1 - p);
      c.visible = mat.opacity > 0.01;
    });

    r.render(scene, cam);
    v3.set(0, -0.6, 0.2); tilt.localToWorld(v3); v3.project(cam);
    play.style.left = `${(v3.x * 0.5 + 0.5) * L.W}px`; play.style.top = `${(-v3.y * 0.5 + 0.5) * L.H}px`;
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    triggers.forEach((b) => b.removeEventListener("click", open)); close.removeEventListener("click", shut);
    outside(false); hero.removeEventListener("keydown", onKey); motion.removeEventListener("click", onMotion); hero.removeEventListener("pointermove", onMove); hero.removeEventListener("pointerleave", onLeave);
    hero.classList.remove("playing");
    scene.traverse((o) => { const m = o as THREE_NS.Mesh; if (m.geometry) m.geometry.dispose(); const mats = m.material ? ([] as THREE_NS.Material[]).concat(m.material) : []; mats.forEach((mt) => { const mm = mt as THREE_NS.MeshBasicMaterial; mm.map?.dispose(); mm.dispose(); }); });
    screenTex.dispose(); mask.dispose(); videoTex?.dispose(); r.dispose();
  };
}
