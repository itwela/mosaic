// The Lit glass ground: one sheet of stained glass behind the whole app whose
// tiles light up one by one. Light is status. The interface says where the
// light is (panes that are working, waiting or just finished, the open
// workspace, the focused pane) and this canvas lights the tiles around it.
//
// One full-screen quad. The glass surface, bevels and lead came are pre-rendered
// layers (scripts/generate-glass-ground.py); the only thing that changes per
// frame is a 64-wide data texture holding each tile's colour and light level.
// It sits behind the interface, so nothing ever animates over terminal text.
import { useEffect, useRef } from "react";

const DIR = "/textures/glass-live/";
const DATA_W = 64;
const BASE = 0.56;   // how bright unlit glass sits; the design frames use 0.44, the generated tiles read better brighter

type RGB = [number, number, number];
const PAL: Record<string, RGB> = {
  ruby: [196, 38, 46], crimson: [224, 62, 58], rose: [214, 46, 120], magenta: [190, 40, 150],
  amber: [236, 154, 46], ember: [224, 100, 42], teal: [30, 138, 140], dteal: [22, 96, 110],
  cobalt: [40, 84, 176], indigo: [52, 58, 140], sea: [46, 160, 150], opal: [214, 210, 200],
  violet: [120, 60, 170], mint: [88, 205, 180],
};
const TINT: Record<string, string[]> = {
  amber: ["amber", "ember", "amber"], ruby: ["ruby", "crimson", "rose"], done: ["mint", "sea", "teal"],
  opal: ["opal"], teal: ["teal", "sea"], cobalt: ["cobalt", "indigo"], violet: ["violet", "magenta"],
  rose: ["rose", "magenta"], sea: ["sea", "mint"], ember: ["ember", "amber"], magenta: ["magenta", "rose"],
};

interface Light {
  l: number; t: number; r: number; b: number;
  s: number; fall: number; tint: string | null; mode: 0 | 1 | 2; // 0 steady, 1 shimmer, 2 circling beam
}
interface Ripple { x: number; y: number; t0: number; speed: number; band: number; gain: number; life: number; tint: string }

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision highp float;
uniform sampler2D uMat, uIds, uDyn, uStat;
uniform vec2 uRes, uTex, uData;
uniform float uDpr, uBase, uDim;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float k = max(1.0, max(uRes.x / uDpr / uTex.x, uRes.y / uDpr / uTex.y));
  vec2 uv = px / (uTex * k);
  vec4 id = texture2D(uIds, uv);
  float idx = floor(id.r * 255.0 + 0.5) + floor(id.g * 255.0 + 0.5) * 256.0;
  vec2 duv = vec2((mod(idx, uData.x) + 0.5) / uData.x, (floor(idx / uData.x) + 0.5) / uData.y);
  vec4 dyn = texture2D(uDyn, duv);
  float amb = texture2D(uStat, duv).r * 0.25;
  float cellL = dyn.a;
  float lum = uBase + (1.0 - uBase) * clamp(cellL + amb, 0.0, 1.0);
  vec4 m = texture2D(uMat, uv);
  float relief = m.r * 2.4;
  float litk = clamp(cellL * 1.5, 0.0, 1.0);
  vec3 c = dyn.rgb * lum;
  c *= 1.0 + 0.9 * (0.8 + 0.2 * litk) * (relief - 1.0);
  c += max(relief - 1.4, 0.0) * 0.5 * (0.3 + 0.7 * litk);
  c *= m.g;
  c += m.b * 0.275 * (0.35 + lum);
  vec3 lead = vec3(0.043, 0.039, 0.035) + id.b * vec3(0.094, 0.082, 0.067);
  c = mix(lead, c, m.a);
  gl_FragColor = vec4(c * uDim, 1.0);
}`;

function loadBitmap(src: string, maxW = 1920, maxH = 1200, quality: ResizeQuality = "high"): Promise<ImageBitmap> {
  return fetch(src)
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b, { resizeWidth: maxW, resizeHeight: maxH, resizeQuality: quality }));
}

// Ripples other parts of the app can ask for (for example the first-run screen).
type RippleRequest = { x: number; y: number; tint?: string };
const rippleListeners = new Set<(r: RippleRequest) => void>();
export function glassRipple(r: RippleRequest) { rippleListeners.forEach((fn) => fn(r)); }

export default function GlassGround() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    if (!gl) return; // the static texture set in CSS stays visible
    let disposed = false;
    let raf = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    (async () => {
      const [mat, ids, meta] = await Promise.all([
        loadBitmap(DIR + "material.webp", 1920, 1200, "medium"),
        loadBitmap(DIR + "cells.png", 1920, 1200, "pixelated"),
        fetch(DIR + "cells.json").then((r) => r.json()),
      ]);
      if (disposed) {
        mat.close();
        ids.close();
        return;
      }

      const N: number = meta.n;
      const rows = Math.ceil(N / DATA_W);
      const cx = Float32Array.from(meta.x as number[]);
      const cy = Float32Array.from(meta.y as number[]);
      const base = Float32Array.from(meta.rgb as number[]);
      const amb = Float32Array.from(meta.amb as number[]);
      const isOpal = new Uint8Array(N);
      for (const i of meta.opal as number[]) isOpal[i] = 1;

      // per-tile state
      const lum = new Float32Array(N);            // current light (0..1 above base)
      const tgt = new Float32Array(N);
      const col = Float32Array.from(base);
      const tgtCol = Float32Array.from(base);
      const rate = new Float32Array(N), ph = new Float32Array(N), wob = new Float32Array(N), r1 = new Float32Array(N);
      const heat = new Float32Array(N), angle = new Float32Array(N), delay = new Float32Array(N);
      const mode = new Uint8Array(N);
      const alt: Record<string, Float32Array> = {};
      for (let i = 0; i < N; i++) {
        rate[i] = reduce ? 1 : 0.045 + Math.random() * 0.105;
        ph[i] = Math.random() * 6.28; wob[i] = 1.1 + Math.random() * 1.5; r1[i] = Math.random();
      }
      function altFor(key: string): Float32Array {
        if (alt[key]) return alt[key];
        const names = TINT[key] ?? TINT.opal;
        const a = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          const c = PAL[names[(Math.random() * names.length) | 0]], v = 0.86 + Math.random() * 0.24;
          a[i * 3] = c[0] * v; a[i * 3 + 1] = c[1] * v; a[i * 3 + 2] = c[2] * v;
        }
        return (alt[key] = a);
      }

      // --- GL setup
      const prog = gl.createProgram()!;
      for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); return; }
        gl.attachShader(prog, sh);
      }
      gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      function tex(unit: number, filter: number) {
        const t = gl!.createTexture();
        gl!.activeTexture(gl!.TEXTURE0 + unit); gl!.bindTexture(gl!.TEXTURE_2D, t);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      }
      tex(0, gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mat);
      tex(1, gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ids);
      mat.close();
      ids.close();
      const dyn = new Uint8Array(DATA_W * rows * 4);
      tex(2, gl.NEAREST);
      const stat = new Uint8Array(DATA_W * rows * 4);
      for (let i = 0; i < N; i++) stat[i * 4] = Math.min(255, (amb[i] / 0.25) * 255);
      tex(3, gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DATA_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, stat);
      const U = (n: string) => gl.getUniformLocation(prog, n);
      gl.uniform1i(U("uMat"), 0); gl.uniform1i(U("uIds"), 1); gl.uniform1i(U("uDyn"), 2); gl.uniform1i(U("uStat"), 3);
      gl.uniform2f(U("uTex"), meta.w, meta.h); gl.uniform2f(U("uData"), DATA_W, rows);
      gl.uniform1f(U("uBase"), BASE);
      const uRes = U("uRes"), uDpr = U("uDpr"), uDim = U("uDim");

      let W = 0, H = 0, dpr = 1, cover = 1;
      function resize() {
        dpr = Math.min(1.5, window.devicePixelRatio || 1);
        W = window.innerWidth; H = window.innerHeight;
        cover = Math.max(1, W / meta.w, H / meta.h);
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        gl!.viewport(0, 0, canvas.width, canvas.height);
        gl!.uniform2f(uRes, canvas.width, canvas.height); gl!.uniform1f(uDpr, dpr);
        dirty = true;
      }

      // --- lights come from the interface
      let lights: Light[] = [];
      let ripples: Ripple[] = [];
      let dirty = true;
      let dim = 1, dimTgt = 1;
      const paneStatus = new WeakMap<Element, string>();
      const doneUntil = new WeakMap<Element, number>();
      let sig = "";

      function relight(now: number) {
        const L: Light[] = [];
        const add = (el: Element, s: number, fall: number, tint: string | null, m: 0 | 1 | 2, inset = 0) => {
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) return;
          L.push({ l: r.left + inset, t: r.top + inset, r: r.right - inset, b: r.bottom - inset, s, fall, tint, mode: m });
        };
        document.querySelectorAll<HTMLElement>("[data-glass-status]").forEach((p) => {
          const st = p.dataset.glassStatus!;
          const prev = paneStatus.get(p);
          if (prev !== st) {
            paneStatus.set(p, st);
            // an agent just finished: one wash of teal light leaves the pane, then the glass cools
            if (st === "ready" && (prev === "running" || prev === "attention")) {
              doneUntil.set(p, now + 9000);
              const r = p.getBoundingClientRect();
              ripple((r.left + r.right) / 2, (r.top + r.bottom) / 2, { tint: "done", speed: 900, band: 150, gain: 0.8, life: 1.8 });
            }
          }
          if (st === "running") add(p, 1, 46, "amber", 1, 6);
          else if (st === "attention") add(p, 1, 52, "ruby", 2, 6);
          else if (st === "ready" && (doneUntil.get(p) ?? 0) > now) add(p, Math.min(1, ((doneUntil.get(p) ?? 0) - now) / 3000), 60, "done", 0, 6);
          // focused and idle: no white wash, the tiles around the pane just brighten in their own colours
          else if (p.matches(":focus-within")) add(p, 0.5, 44, null, 0, 6);
        });
        // anything else that wants light: data-glass-light="tint strength fall [shimmer|beam]"
        document.querySelectorAll<HTMLElement>("[data-glass-light]").forEach((el) => {
          const [tint, s, fall, m] = el.dataset.glassLight!.split(" ");
          add(el, Number(s) || 0.9, Number(fall) || 26, tint === "none" ? null : tint, m === "shimmer" ? 1 : m === "beam" ? 2 : 0);
        });
        const seam = document.querySelector('.resize-handle-h:hover, .resize-handle-v:hover, [data-separator="active"], [data-separator="hover"]');
        if (seam) add(seam, 0.9, 16, "opal", 0);
        const calm = document.querySelector<HTMLElement>("[data-glass-dim]");
        dimTgt = calm ? Number(calm.dataset.glassDim) || 1 : 1;

        const key = L.map((l) => `${l.l | 0},${l.t | 0},${l.r | 0},${l.b | 0},${l.s.toFixed(2)},${l.tint},${l.mode}`).join("|") + `|${W}x${H}`;
        if (key === sig) return;
        sig = key; lights = L; dirty = true;
        for (let i = 0; i < N; i++) {
          const x = cx[i] * cover, y = cy[i] * cover;
          if (x < -60 || y < -60 || x > W + 60 || y > H + 60) { tgt[i] = 0; mode[i] = 0; continue; }
          let best = 0, bl: Light | null = null;
          for (const l of L) {
            const dx = Math.max(l.l - x, x - l.r, 0), dy = Math.max(l.t - y, y - l.b, 0), d = Math.hypot(dx, dy);
            if (d >= l.fall) continue;
            const v = l.s * Math.pow(1 - d / l.fall, 1.3);
            if (v > best) { best = v; bl = l; }
          }
          tgt[i] = Math.min(1, best);
          mode[i] = best > 0.08 && bl ? bl.mode : 0;
          const src = bl && bl.tint && !isOpal[i] && best * 1.5 > r1[i] ? altFor(bl.tint) : base;
          tgtCol[i * 3] = src[i * 3]; tgtCol[i * 3 + 1] = src[i * 3 + 1]; tgtCol[i * 3 + 2] = src[i * 3 + 2];
          if (bl) angle[i] = Math.atan2(y - (bl.t + bl.b) / 2, x - (bl.l + bl.r) / 2);
        }
      }

      function ripple(x: number, y: number, o: Partial<Ripple> = {}) {
        if (reduce) return;
        ripples.push({ x, y, t0: performance.now(), speed: 800, band: 110, gain: 0.7, life: 1.6, tint: "opal", ...o });
      }
      const onRipple = (r: RippleRequest) => ripple(r.x, r.y, { tint: r.tint ?? "opal" });
      rippleListeners.add(onRipple);

      let ptrX = -999, ptrY = -999, ptrMoved = false;
      const onPtr = (e: PointerEvent) => { ptrX = e.clientX; ptrY = e.clientY; ptrMoved = true; };
      const onLeave = () => { ptrX = ptrY = -999; };
      window.addEventListener("pointermove", onPtr, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("resize", resize);
      resize();

      // opening: the window lights from the logo outward
      const t0 = performance.now();
      if (!reduce) for (let i = 0; i < N; i++) delay[i] = t0 + Math.hypot(cx[i] - 40, cy[i] - 70) * 0.75 + Math.random() * 160;
      const openUntil = t0 + 2600;
      const opening = new Float32Array(N); // base brightness fades in during the opening
      if (reduce) opening.fill(1);

      let lastRelight = 0, lastDraw = 0;
      function frame(now: number) {
        raf = requestAnimationFrame(frame);
        if (now - lastRelight > 180) { lastRelight = now; relight(now); }
        if (now - lastDraw < 30) return; // ~30 fps is plenty for candlelight
        const t = (now - t0) / 1000;
        ripples = ripples.filter((r) => (now - r.t0) / 1000 < r.life);
        const live = ripples.length > 0 || now < openUntil || Math.abs(dim - dimTgt) > 0.004;
        let moving = live || dirty || ptrMoved;
        if (!moving) {
          for (const l of lights) if (l.mode) { moving = true; break; }
        }
        if (!moving) {
          for (let i = 0; i < N; i++) if (heat[i] > 0.004 || Math.abs(tgt[i] - lum[i]) > 0.004) { moving = true; break; }
        }
        if (!moving) return;
        lastDraw = now; dirty = false; ptrMoved = false;
        dim += (dimTgt - dim) * 0.12;

        for (let i = 0; i < N; i++) {
          const x = cx[i] * cover, y = cy[i] * cover;
          if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
          const k = rate[i], j = i * 3;
          if (now >= delay[i]) { lum[i] += (tgt[i] - lum[i]) * k; opening[i] += (1 - opening[i]) * k; }
          let r = (col[j] += (tgtCol[j] - col[j]) * k), g = (col[j + 1] += (tgtCol[j + 1] - col[j + 1]) * k), b = (col[j + 2] += (tgtCol[j + 2] - col[j + 2]) * k);
          let l = lum[i];
          if (!reduce) {
            if (mode[i] === 1) l *= 0.8 + 0.2 * Math.sin(t * wob[i] + ph[i]);                       // candle behind glass, each tile on its own clock
            else if (mode[i] === 2) l *= 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3.2 - angle[i] * 2)); // a beam circling the pane that wants you
            const d = Math.hypot(x - ptrX, y - ptrY);
            if (d < 175) heat[i] = Math.max(heat[i], Math.pow(1 - d / 175, 1.4) * 0.72);
            if (heat[i] > 0.004) { l += heat[i] * (1 - l); heat[i] *= reduce ? 0 : 0.955; }
            for (const rp of ripples) {
              const age = (now - rp.t0) / 1000, dd = Math.abs(Math.hypot(x - rp.x, y - rp.y) - age * rp.speed);
              if (dd < rp.band) {
                const q = (1 - dd / rp.band) * (1 - age / rp.life) * rp.gain;
                l += q * (1 - l);
                if (!isOpal[i]) { const a = altFor(rp.tint); r += (a[j] - r) * q; g += (a[j + 1] - g) * q; b += (a[j + 2] - b) * q; }
              }
            }
          }
          // unlit glass sits deeper and a little less saturated
          const grey = (r + g + b) / 3, sat = 0.92 + 0.22 * Math.min(1, l * 1.4), o = opening[i];
          const d4 = i * 4;
          dyn[d4] = Math.max(0, Math.min(255, (grey + (r - grey) * sat) * o));
          dyn[d4 + 1] = Math.max(0, Math.min(255, (grey + (g - grey) * sat) * o));
          dyn[d4 + 2] = Math.max(0, Math.min(255, (grey + (b - grey) * sat) * o));
          dyn[d4 + 3] = Math.max(0, Math.min(255, l * 255));
        }
        gl!.activeTexture(gl!.TEXTURE2);
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, DATA_W, rows, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, dyn);
        gl!.uniform1f(uDim, dim);
        gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
        canvas.dataset.ready = "true";
      }
      raf = requestAnimationFrame(frame);

      cleanup = () => {
        rippleListeners.delete(onRipple);
        window.removeEventListener("pointermove", onPtr);
        document.removeEventListener("pointerleave", onLeave);
        window.removeEventListener("resize", resize);
      };
    })().catch(console.error);

    let cleanup = () => {};
    return () => { disposed = true; cancelAnimationFrame(raf); cleanup(); };
  }, []);

  return <canvas ref={ref} className="glass-ground" aria-hidden="true" />;
}
