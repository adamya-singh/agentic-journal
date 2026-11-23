// Draws the experiments' 3D pictures. One WebGL renderer for the whole page, kept off screen: each picture is a
// 2D canvas that the renderer's frame is copied onto, so there can be as many as the page likes (a browser allows
// only a handful of WebGL canvases). Only pictures on screen are built and drawn. three.js loads on first use.
import { createLibrary } from './scene-library.js';

type Three = typeof import('three');
type Built = { scene: import('three').Scene; camera: import('three').PerspectiveCamera; centre: import('three').Vector3; half: import('three').Vector3; steps: ((t: number) => void)[]; az: number; el: number; sway: number };
type View = { canvas: HTMLCanvasElement; key: string; wide: boolean; sharp: number; built: Built | null; seen: boolean; dirty: boolean; turnAz: number; turnEl: number; phase: number };
type Runtime = { T: Three; renderer: import('three').WebGLRenderer; scenes: Record<string, (group: unknown, options: object, steps: ((t: number) => void)[]) => { az?: number; el?: number; sway?: number } | void> };

/** The pictures an experiment can wear, by key, as the edit form lists them. An experiment may also keep a key not listed here. */
export const PICTURES: Record<string, string> = {
  stack: 'Stacked blocks', bench: 'Arm over the bench', lift: 'Gripper lifting the cube', miss: 'Jaws beside the cube', placements: 'Cube placements on the table',
  bullseye: 'Landing scatter on a target', seeds: 'Three bars', fork: 'Two diverging curves', cosine: 'Decaying curve', fan: 'Fan of camera frames',
  shift: 'Stack of shifted frames', pi05: 'Large pretrained model', versus: 'Two networks side by side', chunk: 'Action chunk ribbon', servo: 'Soft servo',
  springs: 'Row of springs', probe: 'Cube moved mid-episode', lattice: 'Grid of runs', registers: 'Table of values', sagfan: 'Fan of arm poses', recentre: 'Paths converging on the cube',
};

const BUFFER_W = 1400, BUFFER_H = 900;
const views = new Set<View>();
let runtime: Promise<Runtime | null> | null = null;
let live: Runtime | null = null;
let watcher: IntersectionObserver | null = null;
let frame = 0, last = 0;
const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function start(): Promise<Runtime | null> {
  runtime ??= import('three').then((T) => {
    let renderer: import('three').WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return null; }
    renderer.setPixelRatio(1);
    renderer.setSize(BUFFER_W, BUFFER_H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(true);
    // The library is plain JavaScript: its scenes are read as functions of a group, options and the steps to run each frame.
    live = { T, renderer, scenes: createLibrary(T).S as unknown as Runtime['scenes'] };
    return live;
  }).catch(() => null);
  return runtime;
}

function build(view: View, { T, scenes }: Runtime) {
  const scene = new T.Scene(), group = new T.Group();
  scene.add(group);
  // The library's lights were set for three.js before its lights became physical; these match that look.
  scene.add(new T.HemisphereLight(0xffffff, 0x1a2238, 0.95 * Math.PI));
  const sun = new T.DirectionalLight(0xfff1d6, 0.9 * Math.PI);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const steps: ((t: number) => void)[] = [];
  let stand: { az?: number; el?: number; sway?: number } = {};
  try { stand = (scenes[view.key] ?? scenes['stack']!)(group, {}, steps) ?? {}; } catch (error) { console.warn(`The picture "${view.key}" could not be built:`, error); }
  scene.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(group);
  view.built = {
    scene, camera: new T.PerspectiveCamera(30, 1, 0.1, 200), centre: box.getCenter(new T.Vector3()), half: box.getSize(new T.Vector3()).multiplyScalar(0.5),
    steps, az: stand.az ?? 0.6, el: stand.el ?? 0.38, sway: stand.sway ?? 0.4,
  };
}

function draw(view: View, { renderer }: Runtime, t: number) {
  const { canvas, built } = view;
  if (!built) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2) * view.sharp;
  const w = Math.min(BUFFER_W, Math.round(canvas.clientWidth * ratio)), h = Math.min(BUFFER_H, Math.round(canvas.clientHeight * ratio));
  if (w < 4 || h < 4) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const { camera, centre, half } = built;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const up = camera.fov * Math.PI / 360, across = Math.atan(Math.tan(up) * camera.aspect);
  const reach = view.wide ? half.x + half.z * 0.5 : Math.max(Math.hypot(half.x, half.z) * 0.82, Math.max(half.x, half.z) * 1.1);
  const rise = half.y + (view.wide ? half.z * 0.3 : reach * 0.32);
  const distance = Math.max(reach / (view.wide ? Math.tan(across) : Math.sin(across)), rise / Math.tan(up)) * (view.wide ? 0.96 : 1.02) + (view.wide ? half.z * 0.6 : 0);
  const az = built.az + Math.sin(t * 0.35 + view.phase) * built.sway + view.turnAz, el = Math.max(0.03, Math.min(1.4, built.el + view.turnEl));
  camera.position.set(centre.x + distance * Math.cos(el) * Math.sin(az), centre.y + distance * Math.sin(el), centre.z + distance * Math.cos(el) * Math.cos(az));
  camera.lookAt(centre);
  for (const step of built.steps) step(t);
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  renderer.clear();
  renderer.render(built.scene, camera);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, w, h);
  context.drawImage(renderer.domElement, 0, BUFFER_H - h, w, h, 0, 0, w, h);
  view.dirty = false;
}

function dispose(view: View) {
  views.delete(view);
  watcher?.unobserve(view.canvas);
  view.built?.scene.traverse((node) => {
    const mesh = node as { geometry?: { dispose(): void }; material?: { dispose(): void; map?: { dispose(): void } | null } | { dispose(): void; map?: { dispose(): void } | null }[] };
    mesh.geometry?.dispose();
    for (const material of mesh.material === undefined ? [] : Array.isArray(mesh.material) ? mesh.material : [mesh.material]) { material.map?.dispose(); material.dispose(); }
  });
  view.built = null;
}

function loop(ms: number) {
  frame = views.size > 0 ? requestAnimationFrame(loop) : 0;
  if (!live || ms - last < 33) return;
  last = ms;
  const t = still() ? 2 : ms / 1000;
  let built = 0;
  for (const view of [...views]) {
    // A picture whose canvas has left the page (a form the sky redrew, a card that closed) is let go.
    if (!view.canvas.isConnected) { dispose(view); continue; }
    if (!view.seen) continue;
    if (!view.built) { if (built++ > 1) continue; build(view, live); }
    if (!still() || view.dirty || view.canvas.width < 4) draw(view, live, t);
  }
}

/**
 * Draws the picture `key` on `canvas` for as long as it is in the page; the answer stops it. `wide` fits a long
 * diagram (a network) to the width; `drag` lets him turn it; `sharp` draws a small picture at more than its size.
 */
export function mountScene(canvas: HTMLCanvasElement, key: string, options: { wide?: boolean; drag?: boolean; sharp?: number } = {}): () => void {
  const view: View = { canvas, key, wide: options.wide ?? false, sharp: options.sharp ?? 1, built: null, seen: false, dirty: true, turnAz: 0, turnEl: 0, phase: Math.random() * 6 };
  const ending = new AbortController();
  if (options.drag) {
    let from: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (event) => { from = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); }, { signal: ending.signal });
    canvas.addEventListener('pointermove', (event) => {
      if (!from) return;
      view.turnAz -= (event.clientX - from.x) * 0.012;
      view.turnEl += (event.clientY - from.y) * 0.006;
      from = { x: event.clientX, y: event.clientY };
      view.dirty = true;
    }, { signal: ending.signal });
    const release = () => { from = null; };
    canvas.addEventListener('pointerup', release, { signal: ending.signal });
    canvas.addEventListener('pointercancel', release, { signal: ending.signal });
  }
  let stopped = false;
  void start().then((ready) => {
    if (!ready || stopped) return;
    watcher ??= new IntersectionObserver((entries) => {
      for (const entry of entries) for (const each of views) if (each.canvas === entry.target) { each.seen = entry.isIntersecting; each.dirty = true; }
    }, { rootMargin: '200px' });
    views.add(view);
    watcher.observe(canvas);
    if (frame === 0) frame = requestAnimationFrame(loop);
  });
  return () => { stopped = true; ending.abort(); dispose(view); };
}

const mounted = new WeakSet<HTMLCanvasElement>();
/** Starts the picture on every `canvas[data-scene]` under `root` that has none yet: the forms Sunrise draws on the sky. */
export function mountScenesIn(root: HTMLElement) {
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('canvas[data-scene]')) {
    if (mounted.has(canvas)) continue;
    mounted.add(canvas);
    mountScene(canvas, canvas.dataset['scene'] ?? 'stack', { sharp: 2 });
  }
}
