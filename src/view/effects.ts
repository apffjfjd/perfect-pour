import * as THREE from 'three';
import type { GameController } from '../core/game';
import { CollisionType, type SimEvent } from '../core/types';
import { BEER_COLOR, FOAM_COLOR } from './scene';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  bubble: boolean;
}

/**
 * 장식용 입자 (튀김·유출 물방울·탄산 기포).
 * 판정에는 전혀 관여하지 않는다. 판정은 시뮬레이션 코어에서만 이루어진다.
 * 무작위 값은 화면 연출에만 쓰이므로 결정성에 영향이 없다.
 */
export class VisualEffects {
  private readonly particles: Particle[] = [];
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private bubbleAcc = 0;

  constructor(scene: THREE.Scene, private readonly max: number) {
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geom,
      new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  clear(): void {
    this.particles.length = 0;
  }

  update(dt: number, events: SimEvent[], game: GameController): void {
    for (const e of events) {
      if (e.kind === 'collision' && e.intensity > 0.75) {
        const foam = e.type >= CollisionType.FoamGlass;
        const n = Math.min(10, Math.ceil(e.volume * (e.intensity - 0.6) * 6));
        for (let i = 0; i < n; i++) this.spawnSplash(0, e.y, e.intensity, foam);
      } else if (e.kind === 'spill') {
        const n = Math.min(8, Math.ceil(e.volume * 4));
        for (let i = 0; i < n; i++) this.spawnSplash(e.x, e.y, 0.8, false);
      }
    }
    this.spawnBubbles(dt, game);

    const g = 981;
    const beerY = game.surface.beerY;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.bubble) {
        p.y += p.vy * dt;
        p.x += Math.sin(p.life * 20 + p.z) * 0.02;
        if (p.y >= beerY - 0.05) p.life = 0;
      } else {
        p.vy -= g * 0.35 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    const n = Math.min(this.particles.length, this.max);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      this.positions.set([p.x, p.y, p.z], i * 3);
      const c = p.bubble ? FOAM_COLOR : BEER_COLOR;
      this.colors.set([c.r, c.g, c.b], i * 3);
    }
    const geom = this.points.geometry;
    geom.setDrawRange(0, n);
    geom.getAttribute('position').needsUpdate = true;
    geom.getAttribute('color').needsUpdate = true;
  }

  private spawnSplash(x: number, y: number, intensity: number, foam: boolean): void {
    if (this.particles.length >= this.max) return;
    const a = Math.random() * Math.PI * 2;
    const sp = (2 + Math.random() * 7) * intensity;
    this.particles.push({
      x, y, z: 0,
      vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
      vy: (10 + Math.random() * 22) * intensity * (foam ? 0.4 : 1),
      life: 0.15 + Math.random() * 0.2,
      bubble: false,
    });
  }

  /** 맥주층 안에서 올라오는 탄산 기포 */
  private spawnBubbles(dt: number, game: GameController): void {
    const beer = game.beer.beer;
    if (beer < 5) return;
    this.bubbleAcc += dt * Math.min(40, beer * 0.08) * game.beer.carbonation;
    const pose = game.glass.pose;
    const geom = game.geom;
    const s = Math.sin(pose.tilt);
    const c = Math.cos(pose.tilt);
    while (this.bubbleAcc >= 1 && this.particles.length < this.max) {
      this.bubbleAcc -= 1;
      const u = Math.random() * geom.H * 0.5;
      const r = geom.radiusAt(u) * 0.85 * Math.sqrt(Math.random());
      const phi = Math.random() * Math.PI * 2;
      const lx = r * Math.cos(phi), ly = u - geom.Hp, lz = r * Math.sin(phi);
      const y = -lx * s + ly * c + pose.pivotY;
      if (y >= game.surface.beerY - 0.2) continue;
      this.particles.push({ x: lx * c + ly * s, y, z: lz, vx: 0, vy: 3 + Math.random() * 4, vz: 0, life: 4, bubble: true });
    }
    if (this.bubbleAcc > 1) this.bubbleAcc = 0;
  }
}
