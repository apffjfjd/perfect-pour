import type { BalanceConfig } from '../config';
import type { GlassPose } from './types';

const SLICES = 48;
const BISECT_ITERATIONS = 32;

/**
 * 잔 형상(원뿔대) 계산.
 *
 * 잔 로컬 좌표: 축 방향 u (바닥 0 → 입구 H), 축에 수직인 기울기 평면 방향 w.
 * 잔은 축 위 u = pivotFromBottom 지점을 잡고 회전하며, 윗부분이 +x 쪽으로 기운다.
 * 맥주·거품은 잔 안에서 항상 수평 액면을 이루는 층(layer) 모델로 근사한다.
 * 높이 h 는 "잔 바닥 중심" 기준 월드 수직 높이(cm), 부피는 ml(=cm³).
 */
export class GlassGeometry {
  readonly r1: number;
  readonly r2: number;
  readonly H: number;
  readonly Hp: number;
  /** 벽 기울기 dr/du */
  readonly k: number;
  /** 벽이 축과 이루는 각 */
  readonly wallAngle: number;
  /** 정격 용량 = 잔을 세웠을 때 입구까지 가득 찬 부피 */
  readonly ratedCapacity: number;

  private capCacheTilt = NaN;
  private capCacheValue = 0;
  private levelCache: Array<{ tilt: number; volume: number; h: number }> = [];

  constructor(glass: BalanceConfig['glass']) {
    this.r1 = glass.bottomRadius;
    this.r2 = glass.topRadius;
    this.H = glass.height;
    this.Hp = glass.pivotFromBottom;
    this.k = (this.r2 - this.r1) / this.H;
    this.wallAngle = Math.atan(this.k);
    this.ratedCapacity = this.frustumVolume(this.H);
  }

  radiusAt(u: number): number {
    return this.r1 + this.k * u;
  }

  /** 세운 잔에서 바닥부터 깊이 d 까지의 부피 */
  frustumVolume(d: number): number {
    const h = Math.min(Math.max(d, 0), this.H);
    const r = this.radiusAt(h);
    return (Math.PI * h * (this.r1 * this.r1 + this.r1 * r + r * r)) / 3;
  }

  /** 기울기 tilt 에서 바닥 중심 기준 수평면 h 아래에 있는 잔 내부 부피 */
  volumeBelow(tilt: number, h: number): number {
    const s = Math.sin(tilt);
    const c = Math.cos(tilt);
    if (s < 1e-4) return this.frustumVolume(h / c);
    const du = this.H / SLICES;
    let sum = 0;
    for (let i = 0; i < SLICES; i++) {
      const u = (i + 0.5) * du;
      const r = this.radiusAt(u);
      // 단면 원판 위 점 (u, w) 의 높이 = u·c − w·s. 수평면 아래 영역은 w ≥ w0.
      const w0 = (u * c - h) / s;
      if (w0 <= -r) sum += Math.PI * r * r;
      else if (w0 < r) sum += r * r * Math.acos(w0 / r) - w0 * Math.sqrt(r * r - w0 * w0);
    }
    return sum * du;
  }

  /** 가장 낮은 입구 지점의 높이(바닥 중심 기준). 액면이 이보다 높으면 넘친다. */
  lowestRimHeight(tilt: number): number {
    return this.H * Math.cos(tilt) - this.r2 * Math.sin(tilt);
  }

  /** 잔 내부의 가장 낮은 지점 높이(바닥 중심 기준) */
  lowestInteriorHeight(tilt: number): number {
    return -this.r1 * Math.sin(tilt);
  }

  /** 현재 기울기에서 넘치지 않고 담을 수 있는 최대 부피 */
  capacity(tilt: number): number {
    if (tilt !== this.capCacheTilt) {
      this.capCacheTilt = tilt;
      this.capCacheValue = this.volumeBelow(tilt, this.lowestRimHeight(tilt));
    }
    return this.capCacheValue;
  }

  /** 부피 V 를 담았을 때 수평 액면의 높이(바닥 중심 기준) */
  levelForVolume(tilt: number, volume: number): number {
    for (const e of this.levelCache) {
      if (e.tilt === tilt && e.volume === volume) return e.h;
    }
    let lo = this.lowestInteriorHeight(tilt);
    let hi = this.lowestRimHeight(tilt);
    let h: number;
    if (volume <= 0) h = lo;
    else if (volume >= this.capacity(tilt)) h = hi;
    else {
      for (let i = 0; i < BISECT_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        if (this.volumeBelow(tilt, mid) < volume) lo = mid;
        else hi = mid;
      }
      h = (lo + hi) / 2;
    }
    this.levelCache.push({ tilt, volume, h });
    if (this.levelCache.length > 4) this.levelCache.shift();
    return h;
  }

  /** 수평면 h 에서 액면의 대략적 면적(출렁임에 따른 유효 용량 감소 계산용) */
  surfaceAreaAt(tilt: number, h: number): number {
    const u = Math.min(Math.max(h / Math.cos(tilt), 0), this.H);
    const r = this.radiusAt(u);
    return (Math.PI * r * r) / Math.cos(tilt);
  }

  bottomCenterY(pose: GlassPose): number {
    return pose.pivotY - this.Hp * Math.cos(pose.tilt);
  }

  /** 잔 외곽에서 가장 높은 지점(노즐 충돌 검사용, 보수적 근사) */
  highestPointY(pose: GlassPose, wall: number): number {
    return pose.pivotY + (this.H - this.Hp) * Math.cos(pose.tilt) + (this.r2 + wall) * Math.sin(pose.tilt);
  }

  /** 잔 외곽에서 가장 낮은 지점(드립 트레이 충돌 검사용) */
  lowestPointY(pose: GlassPose, wall: number, base: number): number {
    return pose.pivotY - (this.Hp + base) * Math.cos(pose.tilt) - (this.r1 + wall) * Math.sin(pose.tilt);
  }

  /** 가장 낮은 입구 지점의 월드 좌표(넘침 위치 표시용) */
  lowRimPoint(pose: GlassPose): { x: number; y: number } {
    const s = Math.sin(pose.tilt);
    const c = Math.cos(pose.tilt);
    const above = this.H - this.Hp;
    return { x: above * s + this.r2 * c, y: pose.pivotY + above * c - this.r2 * s };
  }

  /**
   * 노즐(x = 0)에서 수직으로 떨어지는 흐름과 잔의 관계.
   * 회전축이 x = 0 에 있으므로 흐름은 축 위 pivot 지점을 지나 낮은 쪽 벽(+w)에 닿는다.
   */
  streamTarget(pose: GlassPose, streamHalfWidth: number): StreamTarget {
    const s = Math.sin(pose.tilt);
    const c = Math.cos(pose.tilt);
    const above = this.H - this.Hp;
    const rimCrossY = pose.pivotY + above / c;
    // 입구 평면에서 흐름 중심의 축으로부터의 거리와, 기울어진 평면에 투영된 흐름 반폭
    const wc = above * (s / c);
    const half = streamHalfWidth / c;
    const outsideFraction = clamp01((wc + half - this.r2) / (2 * half));

    const dBottom = this.Hp / c;
    const denom = s + this.k * c;
    const dWall = denom > 1e-9 ? (this.r1 + this.k * this.Hp) / denom : Infinity;
    const hitsWall = dWall < dBottom;
    const d = hitsWall ? dWall : dBottom;
    return {
      rimCrossY,
      outsideFraction,
      glassHitY: pose.pivotY - d,
      hitsWall,
      // 수직 흐름 속도 중 표면 법선 성분의 비율
      glassNormalFactor: hitsWall ? Math.sin(pose.tilt + this.wallAngle) : c,
    };
  }
}

export interface StreamTarget {
  rimCrossY: number;
  outsideFraction: number;
  glassHitY: number;
  hitsWall: boolean;
  glassNormalFactor: number;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
