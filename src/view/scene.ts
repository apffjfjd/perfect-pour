import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BalanceConfig } from '../config';
import type { GameController } from '../core/game';
import type { GlassGeometry } from '../core/geometry';
import type { GlassPose, Parcel } from '../core/types';

const DEG = Math.PI / 180;
const CAP_SEGMENTS = 48;
const STREAM_POOL = 6;

export const BEER_COLOR = new THREE.Color('#c86a08');
export const FOAM_COLOR = new THREE.Color('#fbf3e2');

/**
 * Three.js 장면 렌더러 (FR-001).
 * 시뮬레이션 상태를 읽기만 하며 절대 변경하지 않는다.
 * 잔 내부는 층 모델과 같게: 잔 안쪽 원뿔대 메시를 수평 클리핑 평면으로 잘라 맥주·거품층을 그린다.
 */
export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 1, 500);

  private readonly glassGroup = new THREE.Group();
  private readonly leverGroup = new THREE.Group();
  private readonly beerPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly foamTopPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly foamBottomPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly beerBody: THREE.Mesh;
  private readonly foamBody: THREE.Mesh;
  private readonly beerCap: THREE.Mesh;
  private readonly foamCap: THREE.Mesh;
  private readonly streams: THREE.Mesh[] = [];
  private leverAngle = 0;
  private pixelRatioCap: number;
  private fpsSamples: number[] = [];
  private downgraded = false;

  constructor(
    container: HTMLElement,
    private readonly cfg: BalanceConfig,
    private readonly geom: GlassGeometry,
    lowPower: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowPower, powerPreference: 'high-performance' });
    this.pixelRatioCap = lowPower ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.background = new THREE.Color('#17110c');

    this.buildLights();
    this.buildBar();
    this.buildDispenser();

    const { beerBody, foamBody, beerCap, foamCap } = this.buildGlass();
    this.beerBody = beerBody;
    this.foamBody = foamBody;
    this.beerCap = beerCap;
    this.foamCap = foamCap;
    this.buildStreams();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const el = this.renderer.domElement.parentElement!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.renderer.setSize(w, h);
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    // 세로 화면에서는 멀리서, 하단 조작 버튼을 피하도록 장면을 위쪽에 둔다.
    const portrait = aspect < 0.9;
    const dist = portrait ? 100 + (0.9 - aspect) * 90 : 92;
    const target = new THREE.Vector3(0, portrait ? 16 : 22, 0);
    this.camera.position.set(dist * 0.42, target.y + dist * 0.12, dist);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  render(game: GameController, frameDt: number): void {
    this.trackPerformance(frameDt);
    const pose = game.glass.pose;
    this.glassGroup.position.set(0, pose.pivotY, 0);
    this.glassGroup.rotation.z = -pose.tilt;

    // 레버: 맥주(아래) 쪽이면 손잡이 끝이 내려간다.
    const targetAngle = -game.lever.level * this.cfg.lever.degPerStep * DEG;
    this.leverAngle += (targetAngle - this.leverAngle) * Math.min(1, frameDt * 18);
    this.leverGroup.rotation.x = this.leverAngle + 12 * DEG;

    const s = game.surface;
    const hasBeer = game.beer.beer > 0.05;
    const hasFoam = game.beer.foamVolume > 0.05;
    this.beerPlane.constant = s.beerY;
    this.foamBottomPlane.constant = -s.beerY;
    this.foamTopPlane.constant = s.topY;
    this.beerBody.visible = hasBeer;
    this.foamBody.visible = hasFoam;
    this.updateCap(this.beerCap, pose, s.beerY, hasBeer && !hasFoam);
    this.updateCap(this.foamCap, pose, s.topY, hasFoam);

    this.updateStreams(game);
    this.renderer.render(this.scene, this.camera);
  }

  /** 평균 프레임이 낮으면 해상도를 한 단계 낮춘다(모바일 품질 단계). */
  private trackPerformance(frameDt: number): void {
    if (this.downgraded || frameDt <= 0) return;
    this.fpsSamples.push(1 / frameDt);
    if (this.fpsSamples.length < 180) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples = [];
    if (avg < 40 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.downgraded = true;
    }
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#fff1dc', '#2a1a0e', 0.9));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(30, 70, 50);
    this.scene.add(key);
    const warm = new THREE.PointLight('#ffb35c', 600, 120, 2);
    warm.position.set(-25, 45, 20);
    this.scene.add(warm);
  }

  private buildBar(): void {
    const tray = this.cfg.dispenser.trayY;
    const wood = new THREE.MeshStandardMaterial({ color: '#4a2c17', roughness: 0.55, metalness: 0.05 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(140, 4, 40), wood);
    counter.position.set(0, tray - 2.6, -2);
    this.scene.add(counter);

    const steel = new THREE.MeshStandardMaterial({ color: '#8a8f96', roughness: 0.35, metalness: 0.9 });
    const trayMesh = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 13), steel);
    trayMesh.position.set(0, tray - 0.3, 0);
    this.scene.add(trayMesh);
    const grate = new THREE.MeshStandardMaterial({ color: '#4d5257', roughness: 0.4, metalness: 0.9 });
    for (let i = -7; i <= 7; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 12), grate);
      bar.position.set(i * 1.1, tray + 0.05, 0);
      this.scene.add(bar);
    }

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 140),
      new THREE.MeshStandardMaterial({ color: '#2b1d13', roughness: 0.9 }),
    );
    wall.position.set(0, 40, -30);
    this.scene.add(wall);
  }

  private buildDispenser(): void {
    const nozzleY = this.cfg.dispenser.nozzleY;
    const chrome = new THREE.MeshStandardMaterial({ color: '#d9dde2', roughness: 0.18, metalness: 1 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 56, 32), chrome);
    tower.position.set(0, this.cfg.dispenser.trayY + 28, -11);
    this.scene.add(tower);

    const badge = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 40),
      new THREE.MeshStandardMaterial({ map: badgeTexture(), roughness: 0.4, metalness: 0.2 }),
    );
    badge.position.set(0, nozzleY + 13.5, -7.75);
    this.scene.add(badge);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 11, 20), chrome);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, nozzleY + 6, -5.5);
    this.scene.add(arm);

    const head = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.4, 5.5, 28), chrome);
    head.position.set(0, nozzleY + 4.2, 0);
    this.scene.add(head);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 1.6, 20), chrome);
    nozzle.position.set(0, nozzleY + 0.8, 0);
    this.scene.add(nozzle);

    this.leverGroup.position.set(0, nozzleY + 5.6, 1.3);
    const black = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.45, metalness: 0.2 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 9, 20), black);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 4.7;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 14), black);
    knob.position.z = 9.3;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1, 20), chrome);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.2;
    this.leverGroup.add(handle, knob, collar);
    this.scene.add(this.leverGroup);
  }

  private buildGlass() {
    const g = this.geom;
    const gc = this.cfg.glass;
    const Hp = g.Hp;
    const wall = gc.wallThickness;
    const base = gc.baseThickness;
    const profile = [
      new THREE.Vector2(0.001, -Hp),
      new THREE.Vector2(g.r1, -Hp),
      new THREE.Vector2(g.r2, g.H - Hp),
      new THREE.Vector2(g.r2 + wall, g.H - Hp),
      new THREE.Vector2(g.r1 + wall, -Hp - base + 0.25),
      new THREE.Vector2(g.r1 + wall - 0.25, -Hp - base),
      new THREE.Vector2(0.001, -Hp - base),
    ];
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), glassMat);
    glass.renderOrder = 3;
    this.glassGroup.add(glass);

    const inset = 0.03;
    const bodyGeom = new THREE.CylinderGeometry(g.r2 - inset, g.r1 - inset, g.H - inset, 48, 1, false);
    bodyGeom.translate(0, g.H / 2 - Hp + inset / 2, 0);
    const beerMat = new THREE.MeshStandardMaterial({
      color: BEER_COLOR,
      emissive: '#6a3200',
      emissiveIntensity: 0.25,
      roughness: 0.15,
      metalness: 0,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      clippingPlanes: [this.beerPlane],
    });
    const foamMat = new THREE.MeshStandardMaterial({
      color: FOAM_COLOR,
      map: foamTexture(),
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      clippingPlanes: [this.foamTopPlane, this.foamBottomPlane],
    });
    const beerBody = new THREE.Mesh(bodyGeom, beerMat);
    const foamBody = new THREE.Mesh(bodyGeom, foamMat);
    beerBody.renderOrder = 1;
    foamBody.renderOrder = 1;
    this.glassGroup.add(beerBody, foamBody);
    this.scene.add(this.glassGroup);

    const beerCap = new THREE.Mesh(capGeometry(), new THREE.MeshStandardMaterial({ color: '#e0901f', roughness: 0.1, transparent: true, opacity: 0.94, side: THREE.DoubleSide }));
    const foamCap = new THREE.Mesh(capGeometry(), new THREE.MeshStandardMaterial({ color: FOAM_COLOR, map: foamMat.map, roughness: 1, side: THREE.DoubleSide }));
    beerCap.renderOrder = 2;
    foamCap.renderOrder = 2;
    beerCap.frustumCulled = false;
    foamCap.frustumCulled = false;
    this.scene.add(beerCap, foamCap);
    return { beerBody, foamBody, beerCap, foamCap };
  }

  /** 수평면 y = Y 와 잔 안쪽 원뿔대의 단면(타원 + 바닥 현)을 다각형으로 만든다. */
  private updateCap(mesh: THREE.Mesh, pose: GlassPose, Y: number, visible: boolean): void {
    mesh.visible = false;
    if (!visible) return;
    const g = this.geom;
    const s = Math.sin(pose.tilt);
    const c = Math.cos(pose.tilt);
    const inset = 0.04;
    const pts: Array<[number, number, number] | null> = [];
    for (let j = 0; j < CAP_SEGMENTS; j++) {
      const phi = (j / CAP_SEGMENTS) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      // 로컬 (x, y, z) → 월드: x' = x·c + y·s, y' = −x·s + y·c + pivotY
      const bx = (g.r1 - inset) * cp, by = -g.Hp, bz = (g.r1 - inset) * sp;
      const tx = (g.r2 - inset) * cp, ty = g.H - g.Hp, tz = (g.r2 - inset) * sp;
      const yb = -bx * s + by * c + pose.pivotY;
      const yt = -tx * s + ty * c + pose.pivotY;
      if ((Y - yb) * (Y - yt) > 0 || yt === yb) {
        pts.push(null);
        continue;
      }
      const t = (Y - yb) / (yt - yb);
      const lx = bx + (tx - bx) * t, ly = by + (ty - by) * t, lz = bz + (tz - bz) * t;
      pts.push([lx * c + ly * s, Y, lz]);
    }
    let start = pts.findIndex((p, i) => p && !pts[(i - 1 + CAP_SEGMENTS) % CAP_SEGMENTS]);
    if (start < 0) start = pts[0] ? 0 : -1;
    if (start < 0) return;
    const ring: Array<[number, number, number]> = [];
    for (let k = 0; k < CAP_SEGMENTS; k++) {
      const p = pts[(start + k) % CAP_SEGMENTS];
      if (!p) break;
      ring.push(p);
    }
    if (ring.length < 3) return;

    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let cx = 0, cz = 0;
    for (const p of ring) {
      cx += p[0];
      cz += p[2];
    }
    attr.setXYZ(0, cx / ring.length, Y, cz / ring.length);
    // 호(arc) 다음 정점을 첫 점으로 닫아 바닥 현까지 덮고, 남는 정점은 퇴화 삼각형으로 둔다.
    for (let i = 0; i <= CAP_SEGMENTS; i++) {
      const q = i < ring.length ? ring[i] : ring[0];
      attr.setXYZ(i + 1, q[0], q[1], q[2]);
    }
    attr.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    mesh.visible = true;
  }

  private buildStreams(): void {
    const geom = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    for (let i = 0; i < STREAM_POOL; i++) {
      const m = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: BEER_COLOR, roughness: 0.15, transparent: true, opacity: 0.85, emissive: '#3a1d00', emissiveIntensity: 0.3 }),
      );
      m.visible = false;
      this.streams.push(m);
      this.scene.add(m);
    }
  }

  /** 공중의 Parcel 을 연속 구간으로 묶어 원기둥으로 그린다. */
  private updateStreams(game: GameController): void {
    const nozzleY = this.cfg.dispenser.nozzleY;
    const trayY = this.cfg.dispenser.trayY;
    const runs: Array<{ top: number; bottom: number; parcels: Parcel[]; outside: boolean }> = [];
    for (const outside of [false, true]) {
      const list = game.flow.parcels.filter((p) => p.outside === outside).sort((a, b) => b.y - a.y);
      let cur: (typeof runs)[number] | null = null;
      for (const p of list) {
        if (cur && cur.bottom - p.y < 4) {
          cur.bottom = p.y;
          cur.parcels.push(p);
        } else {
          cur = { top: p.y, bottom: p.y, parcels: [p], outside };
          runs.push(cur);
        }
      }
    }
    const flowing = game.flow.isFlowing;
    let i = 0;
    for (const run of runs) {
      if (i >= this.streams.length) break;
      let top = run.top;
      if (flowing && !run.outside && nozzleY - top < 4) top = nozzleY;
      if (flowing && run.outside && runs.every((r) => r.outside) && nozzleY - top < 4) top = nozzleY;
      const floor = run.outside ? trayY : game.surface.surfaceY;
      const bottom = Math.max(floor, run.bottom - 2.5);
      const len = top - bottom;
      if (len <= 0.05) continue;
      let beer = 0, foam = 0, rate = 0;
      for (const p of run.parcels) {
        beer += p.beer;
        foam += p.foamLiquid + p.foamGas;
        rate += p.rate;
      }
      rate /= run.parcels.length;
      const m = this.streams[i++];
      const r = 0.1 + 0.032 * Math.sqrt(rate);
      m.scale.set(r, len, r);
      m.position.set(0, bottom + len / 2, 0);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.copy(BEER_COLOR).lerp(FOAM_COLOR, foam / Math.max(1e-9, beer + foam));
      m.visible = true;
    }
    for (; i < this.streams.length; i++) this.streams[i].visible = false;
  }
}

function capGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CAP_SEGMENTS + 2) * 3), 3));
  const uv = new Float32Array((CAP_SEGMENTS + 2) * 2);
  uv[0] = 0.5;
  uv[1] = 0.5;
  for (let i = 0; i <= CAP_SEGMENTS; i++) {
    const a = (i / CAP_SEGMENTS) * Math.PI * 2;
    uv[(i + 1) * 2] = 0.5 + 0.5 * Math.cos(a);
    uv[(i + 1) * 2 + 1] = 0.5 + 0.5 * Math.sin(a);
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const index: number[] = [];
  for (let i = 1; i <= CAP_SEGMENTS; i++) index.push(0, i, i + 1);
  geom.setIndex(index);
  geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((CAP_SEGMENTS + 2) * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  return geom;
}

/** 거품 표면용 절차적 기포 텍스처 (장식) */
function foamTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbf3e2';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * Math.random() * 7;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(210, 185, 140, ${0.25 + Math.random() * 0.3})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function badgeTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#7a1f12');
  grad.addColorStop(1, '#3d0d06');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#e9b84a';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4d27a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillText('PERFECT', size / 2, size / 2 - 6);
  ctx.fillText('POUR', size / 2, size / 2 + 42);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
