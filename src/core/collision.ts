import type { BalanceConfig } from '../config';
import type { GlassGeometry, StreamTarget } from './geometry';
import type { BeerState } from './beerState';
import { CollisionType, type GlassPose, type Parcel } from './types';

/** 이번 스텝에서 노즐 흐름이 처음 만나는 표면 */
export interface StreamSurface extends StreamTarget {
  /** 첫 충돌 표면의 월드 높이 */
  surfaceY: number;
  surface: 'glass' | 'beer' | 'foam';
  /** 수평 액면 높이(월드). 내용물이 없으면 잔 내부 최저점 */
  beerY: number;
  topY: number;
  foamThickness: number;
}

export interface CollisionResult {
  type: CollisionType;
  intensity: number;
}

/**
 * 충돌 판정 (FR-009).
 * 낙하 높이는 노즐 → 실제 첫 충돌 표면(잔 바닥·벽, 액면, 거품층 상단) 거리이며,
 * Parcel 이 실제로 낙하하며 얻은 속도로 반영된다.
 */
export class CollisionDetector {
  constructor(
    private readonly cfg: BalanceConfig['collision'],
    private readonly maxTotalFlow: number,
    private readonly streamHalfWidth: number,
    private readonly geom: GlassGeometry,
  ) {}

  surface(pose: GlassPose, contents: BeerState): StreamSurface {
    const t = this.geom.streamTarget(pose, this.streamHalfWidth);
    const base = this.geom.bottomCenterY(pose);
    const beerY = base + this.geom.levelForVolume(pose.tilt, contents.beer);
    const topY = base + this.geom.levelForVolume(pose.tilt, contents.occupied);
    const foamThickness = Math.max(0, topY - beerY);
    let surface: StreamSurface['surface'] = 'glass';
    let surfaceY = t.glassHitY;
    if (contents.occupied > 1e-6 && topY >= t.glassHitY) {
      surfaceY = topY;
      surface = foamThickness > this.cfg.minFoamThickness ? 'foam' : 'beer';
    }
    return { ...t, surfaceY, surface, beerY, topY, foamThickness };
  }

  /**
   * 충돌 강도 = (표면 법선 방향 충돌 속도 / 기준 속도) × 유량 보정.
   * 액면은 수평이므로 정면 충돌, 잔 벽은 기울기에 따라 비스듬히 부딪혀 약해진다.
   */
  classify(parcel: Parcel, s: StreamSurface): CollisionResult {
    const isBeer = parcel.beer >= parcel.foamLiquid + parcel.foamGas;
    const normal = s.surface === 'glass' ? s.glassNormalFactor : 1;
    const flowFactor = 1 - this.cfg.flowInfluence / 2 + this.cfg.flowInfluence * Math.min(1, parcel.rate / this.maxTotalFlow);
    const intensity = ((parcel.v * normal) / this.cfg.referenceSpeed) * flowFactor;
    const table = isBeer
      ? { glass: CollisionType.BeerGlass, beer: CollisionType.BeerBeer, foam: CollisionType.BeerFoam }
      : { glass: CollisionType.FoamGlass, beer: CollisionType.FoamBeer, foam: CollisionType.FoamFoam };
    return { type: table[s.surface], intensity };
  }
}
