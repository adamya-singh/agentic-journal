// The 3D side of Horizon Dawn. The flat drawing and this world are one object: the half-rings stand
// upright in the flat view, and stepping inside tips them back while the camera comes down to the spawn
// point beside the sun. Inside, the cursor looks across the half-circle ahead and scrolling travels.
import * as THREE from 'three';
import type { HorizonData, HorizonItem } from '@/lib/horizon';
import { HORIZON_RING_ZONES } from '@/lib/horizon';
import { DAWN, ZONE_NAMES, esc, starField, type PillSpot } from './dawn-svg';

const U = 10;                                     // 1 world unit = 10 SVG px
const R = DAWN.R.map((r) => r / U);
const TOP = DAWN.H / U, BOT = -DAWN.G / U;        // visible world y range at the flat pose
const D0 = 400, EYE = 3.6, SPAWN = 12, PITCH0 = -0.17, FOV1 = 62 * Math.PI / 180, YAW_MAX = 76 * Math.PI / 180, RMAX = 49;
const DOT: Record<string, number> = { ignition: 0xfff6ec, climb: 0xffffff, altitude: 0xdfe7f5, orbit: 0xb9c6dc, hold: 0xff5a1f };

type NodeKind = HorizonItem['zone'];
interface SpaceNode {
  item: HorizonItem; k: NodeKind; x2: number; y2: number; lift: number; phase: number;
  el: HTMLDivElement; dot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; world: THREE.Vector3;
}

function ease(x: number): number { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

function rgba(str: string): { c: THREE.Color; a: number } {
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) return { c: new THREE.Color(str), a: 1 };
  const p = m[1].split(',').map(parseFloat);
  return { c: new THREE.Color(p[0] / 255, p[1] / 255, p[2] / 255), a: p.length > 3 ? p[3] : 1 };
}

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}

export class DawnSpace {
  private sky: HTMLElement;
  private svg: SVGSVGElement;
  private abort = new AbortController();
  private reduced: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(10, 1, 0.1, 3000);
  private above = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02)];
  private ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private disk = new THREE.Group();
  private bandMats: THREE.MeshBasicMaterial[] = [];
  private ringMats: (THREE.LineBasicMaterial | THREE.LineDashedMaterial)[] = [];
  private ringCol = rgba(DAWN.ring);
  private sun: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private haze: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private stemGeo = new THREE.BufferGeometry();
  private stems: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private skyLow = new THREE.Color(0x5b7aa6);
  private light = new THREE.Color(0xf3efe7);
  private wrap: HTMLDivElement;
  private bgBox: HTMLDivElement;
  private belowSky: SVGGElement;
  private labEl: HTMLDivElement;
  private hud: HTMLDivElement;
  private whereEl: HTMLDivElement;
  private barEl: HTMLElement;
  private nodes: SpaceNode[] = [];
  private zoneLabs: { el: HTMLDivElement; mid: number }[] = [];
  private youEl: HTMLDivElement | null = null;
  private spots: PillSpot[] = [];
  private holds: HorizonItem[] = [];
  private mode: 'flat' | 'live' = 'flat';
  private t = 0;
  private tTarget = 0;
  private settled = false;
  private nav = { x: 0, z: SPAWN, yaw: 0, pitch: PITCH0, vel: 0 };
  private look = { yaw: 0, pitch: PITCH0 };
  private fly: { x0: number; z0: number; x1: number; z1: number; t: number } | null = null;
  private lookLock = 0;
  private backPush = 0;
  private touch: { x: number; y: number; yaw: number } | null = null;
  private W = 1;
  private H = 1;
  private last = 0;
  private raf = 0;
  private tmp = new THREE.Vector3();
  private lastWhere = '';
  private resizeObs: ResizeObserver | null = null;

  constructor(sky: HTMLElement, svg: SVGSVGElement) {
    this.sky = sky;
    this.svg = svg;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    THREE.ColorManagement.enabled = false;

    // DOM layers: backdrop sky, WebGL canvas, projected labels, entry hint, HUD.
    this.wrap = document.createElement('div');
    this.wrap.className = 'hz3d';
    this.wrap.innerHTML = '<div class="hz3d-bg"><svg preserveAspectRatio="none"></svg></div><canvas></canvas><div class="hz3d-lab"></div>';
    sky.insertBefore(this.wrap, svg);
    const enter = document.createElement('div');
    enter.className = 'hz3d-enter';
    enter.innerHTML = '<i></i>Click to step inside · explore in 3D';
    sky.appendChild(enter);
    this.hud = document.createElement('div');
    this.hud.className = 'hz3d-hud';
    this.hud.innerHTML = '<div class="hz3d-where"><div class="k">You are in</div><div class="v"></div><div class="bar"><i></i></div></div>' +
      '<div class="hz3d-hint">Move to look · scroll to travel · click a task to fly there · Esc to leave</div>' +
      '<div class="hz3d-btns"><button type="button" data-act="pad">Back to pad</button><button type="button" data-act="exit">Back to Dawn</button></div>';
    sky.appendChild(this.hud);
    this.whereEl = this.hud.querySelector('.hz3d-where .v') as HTMLDivElement;
    this.barEl = this.hud.querySelector('.hz3d-where .bar i') as HTMLElement;
    this.labEl = this.wrap.querySelector('.hz3d-lab') as HTMLDivElement;
    this.bgBox = this.wrap.querySelector('.hz3d-bg') as HTMLDivElement;
    this.belowSky = this.buildBackdrop(this.bgBox.querySelector('svg') as SVGSVGElement);

    // three.js world.
    const canvas = this.wrap.querySelector('canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.camera.rotation.order = 'YXZ';
    this.scene.fog = new THREE.Fog(0xe39a5f, 800, 2000);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0xc7a07a, transparent: true, opacity: 1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.01; this.scene.add(this.ground);

    this.scene.add(this.disk);
    let order = 0;
    for (let i = 3; i >= 0; i -= 1) {
      const col = rgba(DAWN.bands[i]);
      const m = new THREE.Mesh(new THREE.CircleGeometry(R[i + 1], 160, 0, Math.PI),
        new THREE.MeshBasicMaterial({ color: col.c, transparent: true, opacity: col.a, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: this.above, fog: false }));
      m.renderOrder = order++; this.disk.add(m); this.bandMats.push(m.material);
    }
    HORIZON_RING_ZONES.forEach((k, i) => {
      const r = R[i + 1], pts: THREE.Vector3[] = [];
      for (let a = 0; a <= 180; a += 1) { const t = a * Math.PI / 180; pts.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0)); }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const opts = { color: this.ringCol.c, transparent: true, opacity: this.ringCol.a * 1.6, fog: false };
      const mat = k === 'orbit' ? new THREE.LineDashedMaterial({ ...opts, dashSize: 0.2, gapSize: 0.6 }) : new THREE.LineBasicMaterial(opts);
      const line = new THREE.Line(geo, mat);
      if (k === 'orbit') line.computeLineDistances();
      line.renderOrder = order++; this.disk.add(line); this.ringMats.push(mat);
    });

    const sunTex = radialTexture([[0, DAWN.sun[0]], [0.55, DAWN.sun[1]], [0.85, DAWN.sun[2]], [1, DAWN.sun[3]]]);
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(R[0], 96), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, clippingPlanes: this.above, fog: false, depthWrite: false }));
    const hazeTex = radialTexture([[0, 'rgba(255,194,107,.5)'], [0.5, 'rgba(255,194,107,.15)'], [1, 'rgba(255,194,107,0)']]);
    this.haze = new THREE.Mesh(new THREE.CircleGeometry(R[2], 96), new THREE.MeshBasicMaterial({ map: hazeTex, transparent: true, clippingPlanes: this.above, fog: false, depthWrite: false }));
    this.haze.renderOrder = order++; this.sun.renderOrder = order++;
    this.scene.add(this.haze); this.scene.add(this.sun);

    this.stems = new THREE.LineSegments(this.stemGeo, new THREE.LineBasicMaterial({ color: 0xe6ecf4, transparent: true, opacity: 0, fog: false }));
    this.scene.add(this.stems);

    this.bindInput();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(sky);
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** New data or a redraw of the flat view: keep the pill positions for the next time we step inside. */
  setLayout(spots: PillSpot[], data: HorizonData) {
    this.spots = spots;
    this.holds = data.holds;
    if (this.mode === 'live') this.buildNodes();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.resizeObs?.disconnect();
    this.clearNodes();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => {
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      });
    });
    this.renderer.dispose();
    this.wrap.remove();
    this.hud.remove();
    this.sky.querySelector('.hz3d-enter')?.remove();
    this.svg.style.opacity = '';
    this.sky.classList.remove('hz-on3d', 'hz-live', 'hz-settled');
  }

  private buildBackdrop(b: SVGSVGElement): SVGGElement {
    const { W, H, G } = DAWN;
    b.setAttribute('viewBox', `-${W} 0 ${W * 3} ${H + G}`);
    const stops = DAWN.sky.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
    b.innerHTML = `<defs><linearGradient id="hz3-sky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>` +
      `<linearGradient id="hz3-gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${DAWN.groundBand[0]}"/><stop offset="1" stop-color="${DAWN.groundBand[1]}"/></linearGradient>` +
      '<linearGradient id="hz3-down" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7b8fb4"/><stop offset=".1" stop-color="#5b7aa6"/><stop offset=".35" stop-color="#1b3f6e"/><stop offset=".7" stop-color="#0b1730"/><stop offset="1" stop-color="#05070d"/></linearGradient></defs>' +
      `<rect x="-${W}" y="-1400" width="${W * 3}" height="1400" fill="${DAWN.sky[0][1]}"/>` +
      `<rect x="-${W}" y="0" width="${W * 3}" height="${H}" fill="url(#hz3-sky)"/>` +
      `<rect x="-${W}" y="${H}" width="${W * 3}" height="${G}" fill="url(#hz3-gr)"/>` +
      `<rect x="-${W}" y="${H + G}" width="${W * 3}" height="1400" fill="${DAWN.groundBand[1]}"/>` +
      `<g class="hz3-below" style="opacity:0"><rect x="-${W}" y="${H}" width="${W * 3}" height="420" fill="url(#hz3-down)"/><rect x="-${W}" y="${H + 420}" width="${W * 3}" height="1400" fill="#05070d"/></g>` +
      [-W, 0, W].map((dx) => `<g transform="translate(${dx} 0)">${starField(W, H * 0.6, DAWN.stars)}</g>`).join('');
    return b.querySelector('.hz3-below') as SVGGElement;
  }

  private clearNodes() {
    this.nodes.forEach((n) => { this.scene.remove(n.dot); n.dot.geometry.dispose(); n.dot.material.dispose(); });
    this.nodes = [];
    this.zoneLabs = [];
    this.labEl.innerHTML = '';
  }

  private buildNodes() {
    this.clearNodes();
    const add = (item: HorizonItem, k: NodeKind, x2: number, y2: number) => {
      const el = document.createElement('div');
      el.className = `hz3d-tg ${k}${item.weight >= 4 ? ' big' : ''}`;
      el.innerHTML = `<span class="p">${esc(k === 'hold' ? `HOLD · ${item.short} · ${item.left}` : item.short)}</span>${k === 'hold' ? '' : `<span class="d">${esc(item.day)}</span>`}`;
      el.title = item.title;
      this.labEl.appendChild(el);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(k === 'hold' ? 0.09 : 0.08 + item.weight * 0.025, 16, 12), new THREE.MeshBasicMaterial({ color: DOT[k], transparent: true, opacity: 0 }));
      this.scene.add(dot);
      const n: SpaceNode = { item, k, x2, y2, lift: k === 'hold' ? 0.45 : 0.6 + y2 * 0.22, phase: Math.random() * 6.28, el, dot, world: new THREE.Vector3() };
      el.addEventListener('click', (e) => { e.stopPropagation(); if (this.mode === 'live') this.flyTo(n); });
      this.nodes.push(n);
    };
    this.spots.forEach((sp) => add(sp.item, sp.item.zone, (sp.x - DAWN.X) / U, (DAWN.H - sp.y) / U));
    this.holds.forEach((it, j, a) => {
      const deg = (150 - 120 * j / Math.max(1, a.length - 1)) * Math.PI / 180;
      add(it, 'hold', Math.cos(deg) * 5.4, Math.sin(deg) * 5.4);
    });
    this.stemGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, this.nodes.length) * 6), 3));
    HORIZON_RING_ZONES.forEach((k, i) => {
      const el = document.createElement('div');
      el.className = 'hz3d-zl';
      el.innerHTML = `<b>${ZONE_NAMES[k][0]}</b><small>${ZONE_NAMES[k][1].toUpperCase()}</small>`;
      this.labEl.appendChild(el);
      this.zoneLabs.push({ el, mid: (R[i] + R[i + 1]) / 2 });
    });
    this.youEl = document.createElement('div');
    this.youEl.className = 'hz3d-you';
    this.youEl.textContent = 'YOU';
    this.labEl.appendChild(this.youEl);
  }

  private setMode(m: 'flat' | 'live') {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'live') {
      this.buildNodes();
      this.sky.classList.add('hz-on3d', 'hz-live');
      this.svg.style.opacity = '0';
      this.tTarget = 1; this.settled = false; this.nav.vel = 0;
      this.sky.focus({ preventScroll: true });
    } else {
      this.sky.classList.remove('hz-live', 'hz-settled');
      this.tTarget = 0; this.fly = null; this.nav.vel = 0;
    }
    if (this.reduced) this.t = this.tTarget;
  }

  private bindInput() {
    const sig = { signal: this.abort.signal };
    const sky = this.sky;
    sky.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (this.mode === 'flat' && !target.closest('.hz-nointeract,.hz3d-btns')) this.setMode('live');
    }, sig);
    sky.addEventListener('keydown', (e) => {
      if (e.target !== sky) return;
      if (this.mode === 'flat') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setMode('live'); } return; }
      if (e.key === 'Escape') { this.setMode('flat'); return; }
      if (e.key === 'ArrowLeft') { this.look.yaw = Math.min(YAW_MAX, this.look.yaw + 0.15); this.lookLock = performance.now() + 1500; }
      else if (e.key === 'ArrowRight') { this.look.yaw = Math.max(-YAW_MAX, this.look.yaw - 0.15); this.lookLock = performance.now() + 1500; }
      else if (e.key === 'ArrowUp') this.nav.vel += 0.55;
      else if (e.key === 'ArrowDown') this.nav.vel -= 0.55;
      else return;
      e.preventDefault(); this.fly = null;
    }, sig);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.mode === 'live') this.setMode('flat'); }, sig);
    document.addEventListener('pointerdown', (e) => { if (this.mode === 'live' && !sky.contains(e.target as Node)) this.setMode('flat'); }, sig);
    sky.addEventListener('pointermove', (e) => {
      if (this.touch && e.pointerType === 'touch') {
        const b = sky.getBoundingClientRect();
        this.look.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, this.touch.yaw + (e.clientX - this.touch.x) / b.width * 2.4));
        this.nav.vel += (this.touch.y - e.clientY) * 0.004; this.touch.y = e.clientY; this.fly = null;
        return;
      }
      if (this.mode !== 'live' || e.pointerType === 'touch' || performance.now() < this.lookLock) return;
      const b = sky.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height) * 2 - 1));
      this.look.yaw = -nx * YAW_MAX; this.look.pitch = PITCH0 - ny * 0.14;
    }, sig);
    sky.addEventListener('pointerdown', (e) => {
      if (this.mode === 'live' && e.pointerType === 'touch') this.touch = { x: e.clientX, y: e.clientY, yaw: this.look.yaw };
    }, sig);
    window.addEventListener('pointerup', () => { this.touch = null; }, sig);
    sky.addEventListener('wheel', (e) => {
      if (this.mode !== 'live') return;           // flat: the page scrolls normally
      e.preventDefault(); this.fly = null;
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const r = Math.hypot(this.nav.x, Math.min(0, this.nav.z - SPAWN));
      if (px < 0 && r < 0.8) { this.backPush += -px; if (this.backPush > 380) { this.backPush = 0; this.setMode('flat'); } return; }
      this.backPush = 0;
      this.nav.vel += Math.max(-60, Math.min(60, px)) * 0.0028;
    }, { passive: false, signal: this.abort.signal });
    this.hud.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (!act) return;
      e.stopPropagation();
      if (act === 'exit') this.setMode('flat');
      if (act === 'pad') {
        this.fly = { x0: this.nav.x, z0: this.nav.z, x1: 0, z1: SPAWN, t: 0 };
        this.look.yaw = 0; this.look.pitch = PITCH0; this.lookLock = performance.now() + 1800; this.nav.vel = 0;
      }
    }, sig);
  }

  private nodeWorld(n: SpaceNode, a: number, out: THREE.Vector3): THREE.Vector3 {
    if (n.k === 'hold') return out.set(n.x2, a * n.lift, n.y2 * a);   // between you and the sun
    const phi = a * Math.PI / 2;
    return out.set(n.x2, n.y2 * Math.cos(phi) + a * n.lift, -n.y2 * Math.sin(phi));
  }

  private flyTo(n: SpaceNode) {
    const p = this.nodeWorld(n, 1, this.tmp);
    const dx = p.x - this.nav.x, dz = p.z - this.nav.z, d = Math.hypot(dx, dz) || 1, stop = Math.max(0, d - 4.5);
    this.fly = { x0: this.nav.x, z0: this.nav.z, x1: this.nav.x + dx / d * stop, z1: this.nav.z + dz / d * stop, t: 0 };
    this.look.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, Math.atan2(-dx, -dz))); this.look.pitch = PITCH0 + 0.06;
    this.lookLock = performance.now() + 2400; this.nav.vel = 0;
  }

  private resize() {
    this.W = this.sky.clientWidth || 1; this.H = this.sky.clientHeight || 1;
    this.renderer.setSize(this.W, this.H, false);
  }

  // One continuous camera move from the flat pose (far away, at horizon height, framing the drawing)
  // to the live pose (eye height at the spawn point, normal field of view).
  private placeCamera(e: number) {
    const z = SPAWN * Math.pow(D0 / SPAWN, 1 - e);
    const px = this.nav.x * e, pz = e === 1 ? this.nav.z : z + (this.nav.z - SPAWN) * e;
    this.camera.position.set(px, EYE * e, pz);
    this.camera.rotation.set(this.nav.pitch * e, this.nav.yaw * e, 0);
    const aspect = this.W / this.H, near = this.camera.near;
    const top0 = TOP / D0, bot0 = BOT / D0, half1 = Math.tan(FOV1 / 2);
    const tt = top0 + (half1 - top0) * e, tb = bot0 + (-half1 - bot0) * e;
    const hw = (tt - tb) / 2 * aspect;
    this.camera.projectionMatrix.makePerspective(-near * hw, near * hw, near * tt, near * tb, near, this.camera.far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (!this.sky.classList.contains('hz-on3d')) return;

    if (this.t !== this.tTarget) {
      this.t = Math.max(0, Math.min(1, this.t + (this.tTarget > this.t ? 1 : -1) * dt / 1.6));
      if (this.reduced) this.t = this.tTarget;
      if (this.t === 1 && this.mode === 'live') { this.settled = true; this.sky.classList.add('hz-settled'); }
      if (this.t === 0 && this.mode === 'flat') {
        this.svg.style.opacity = '';
        window.setTimeout(() => { if (this.mode === 'flat' && this.t === 0) this.sky.classList.remove('hz-on3d'); }, 300);
      }
    }
    // Two overlapping phases: a = the rings tip back; e = the camera comes down to the spawn point.
    const a = ease(Math.min(1, this.t / 0.55)), e = ease(Math.max(0, Math.min(1, (this.t - 0.3) / 0.7)));
    const nav = this.nav, look = this.look;
    const k = this.reduced ? 1 : 1 - Math.pow(1e-6, dt);
    if (this.mode === 'live' && this.settled) {
      if (this.fly) {
        const f = this.fly; f.t = Math.min(1, f.t + dt / 1.4); const q = ease(f.t);
        nav.x = f.x0 + (f.x1 - f.x0) * q; nav.z = f.z0 + (f.z1 - f.z0) * q;
        if (f.t >= 1) this.fly = null;
      } else {
        nav.x += -Math.sin(nav.yaw) * nav.vel; nav.z += -Math.cos(nav.yaw) * nav.vel;
        nav.vel *= this.reduced ? 0 : Math.pow(0.03, dt);
        if (Math.abs(nav.vel) < 0.0004) nav.vel = 0;
        if (nav.z > SPAWN) nav.z = SPAWN;
        const rr = Math.hypot(nav.x, nav.z);
        if (rr > RMAX) { nav.x *= RMAX / rr; nav.z *= RMAX / rr; nav.vel = Math.min(nav.vel, 0); }
      }
      nav.yaw += (look.yaw - nav.yaw) * k; nav.pitch += (look.pitch - nav.pitch) * k;
    } else if (this.mode === 'flat') {
      const kk = this.reduced ? 1 : 1 - Math.pow(0.02, dt);
      nav.x += -nav.x * kk; nav.z += (SPAWN - nav.z) * kk; nav.yaw += -nav.yaw * kk;
      nav.pitch += (PITCH0 - nav.pitch) * kk; look.pitch = nav.pitch; look.yaw = nav.yaw;
    } else {
      nav.pitch = look.pitch;
    }

    this.disk.rotation.x = -a * Math.PI / 2;
    this.placeCamera(e);
    this.ringMats.forEach((m) => { m.color.copy(this.ringCol.c).lerp(this.light, a); m.opacity = this.ringCol.a * 1.6 + e * 0.22; });
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(0xe39a5f).lerp(this.skyLow, e);
    fog.near = 30 + (1 - e) * 900; fog.far = 170 + (1 - e) * 1800;
    this.stems.material.opacity = a * 0.32;
    this.bandMats.forEach((m, i) => { m.opacity = rgba(DAWN.bands[3 - i]).a * (1 - e * 0.85); });
    this.ground.material.opacity = 1 - e; this.ground.visible = e < 0.999;
    this.ground.material.color.setHex(0xc7a07a).lerp(this.skyLow, Math.min(1, e * 1.6));
    this.belowSky.style.opacity = e.toFixed(3);

    const sp = this.stemGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
    this.nodes.forEach((n, i) => {
      const p = this.nodeWorld(n, a, n.world);
      if (!this.reduced) p.y += e * Math.sin(now / 900 + n.phase) * 0.05;
      n.dot.position.copy(p); n.dot.material.opacity = a;
      if (sp) {
        const arr = sp.array as Float32Array;
        arr.set([p.x, 0, p.z, p.x, p.y, p.z], i * 6);
      }
    });
    if (sp) sp.needsUpdate = true;

    // The sun stays at the spawn point, the hub of the rings: it shrinks to a small round sun facing you.
    this.sun.position.set(0, e * 0.6, 0); this.sun.scale.setScalar(1 - e * 0.84);
    this.haze.position.set(0, e * 0.6, -0.05); this.haze.scale.setScalar(1 - e * 0.7);
    this.above[0].constant = 0.02 + e * e * 40;
    if (e > 0) { this.sun.quaternion.copy(this.camera.quaternion); this.haze.quaternion.copy(this.camera.quaternion); }
    else { this.sun.rotation.set(0, 0, 0); this.haze.rotation.set(0, 0, 0); }
    this.camera.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);

    const W = this.W, H = this.H, tmp = this.tmp;
    tmp.set(-Math.sin(nav.yaw * e), 0, -Math.cos(nav.yaw * e)).multiplyScalar(1e5).add(this.camera.position).project(this.camera);
    const hy = (-tmp.y * 0.5 + 0.5) * H, flatHy = DAWN.H / (DAWN.H + DAWN.G) * H;
    this.bgBox.style.transform = `translate(${(nav.yaw * e * W * 0.9).toFixed(1)}px,${(hy - flatHy).toFixed(1)}px)`;

    const kFlat = W / DAWN.W;
    this.nodes.forEach((n) => {
      tmp.copy(n.world);
      const dist = this.camera.position.distanceTo(tmp);
      tmp.project(this.camera);
      const vis = n.k === 'hold' ? e : 1;
      if (tmp.z > 1 || Math.abs(tmp.x) > 1.25 || Math.abs(tmp.y) > 1.25 || vis < 0.02) { n.el.style.opacity = '0'; n.el.classList.remove('hit'); return; }
      const sx = (tmp.x * 0.5 + 0.5) * W, sy = (-tmp.y * 0.5 + 0.5) * H;
      const s = kFlat * (1 - e) + Math.max(0.7, Math.min(1.15, 16 / dist)) * e;
      const near3 = Math.max(0, Math.min(1, (110 - dist) / 50)) * (dist < 2 ? Math.max(0, (dist - 0.8) / 1.2) : 1);
      const op = vis * (1 - e + e * near3);
      n.el.style.transform = `translate(${sx.toFixed(1)}px,${(sy - e * 14 * s).toFixed(1)}px) translate(-50%,-50%) scale(${s.toFixed(3)})`;
      n.el.style.opacity = op.toFixed(3);
      n.el.style.zIndex = String(1000 - Math.round(dist * 4));
      n.el.classList.toggle('hit', op > 0.3);
    });
    this.zoneLabs.forEach((z) => {
      const ang = (180 - 44 * e) * Math.PI / 180;
      tmp.set(Math.cos(ang) * z.mid, -3 * (1 - e) + 0.05 * e, -Math.sin(ang) * z.mid * e);
      const dist = this.camera.position.distanceTo(tmp); tmp.project(this.camera);
      if (tmp.z > 1) { z.el.style.opacity = '0'; return; }
      const s = kFlat * (1 - e) + Math.max(0.6, Math.min(1.1, 20 / dist)) * e;
      z.el.style.transform = `translate(${((tmp.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-tmp.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%,-62%) scale(${s.toFixed(3)})`;
      z.el.style.opacity = Math.max(0, Math.min(1, (1 - e) + e * (60 - dist) / 25)).toFixed(2);
      z.el.style.color = e > 0.5 ? '#e6ecf4' : DAWN.groundInk;
    });
    if (this.youEl) {
      tmp.set(0, 2, 0).applyMatrix4(this.sun.matrixWorld).project(this.camera);
      this.youEl.style.transform = `translate(${((tmp.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-tmp.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%,-50%) scale(${kFlat.toFixed(3)})`;
      this.youEl.style.opacity = Math.max(0, 1 - e * 2.5).toFixed(2);
    }
    if (this.mode === 'live') {
      const r = Math.hypot(nav.x, Math.min(0, nav.z));
      const zones: [string, string, number][] = [['Pad', 'clear these first', 0], ['Ignition', 'next 48 hours', R[0]], ['Climb', 'this week', R[1]], ['Altitude', 'next week', R[2]], ['Orbit', 'later', R[3]]];
      let z = zones[0];
      zones.forEach((q) => { if (r >= q[2] + (q[2] ? -0.5 : 0)) z = q; });
      const deg = Math.round(-nav.yaw * 180 / Math.PI);
      const txt = `${z[0]}<span>${z[1]}${Math.abs(deg) > 2 ? ` · ${Math.abs(deg)}° ${deg > 0 ? 'R' : 'L'}` : ''}</span>`;
      if (txt !== this.lastWhere) { this.whereEl.innerHTML = txt; this.lastWhere = txt; }
      this.barEl.style.width = `${Math.min(100, r / RMAX * 100).toFixed(1)}%`;
    }
  };
}
