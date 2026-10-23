import type { BalanceConfig } from '../config';
import type { BeerState } from './beerState';
import type { StreamSurface } from './collision';
import { clamp } from './geometry';
import { CollisionType, type Parcel } from './types';

export interface ReactionOutcome {
  /** 충돌 튀김으로 잔 밖으로 나간 실제 유출 */
  splashOut: { beer: number; foamLiquid: number; foamGas: number };
  /** 유입된 거품 중 충돌로 즉시 파괴되어 대기로 빠진 기체 */
  gasReleased: number;
  hits: Array<{ type: CollisionType; volume: number }>;
}

const BEER_TYPE = { glass: CollisionType.BeerGlass, beer: CollisionType.BeerBeer, foam: CollisionType.BeerFoam } as const;
const FOAM_TYPE = { glass: CollisionType.FoamGlass, beer: CollisionType.FoamBeer, foam: CollisionType.FoamFoam } as const;

/**
 * 충돌 반응 계산 (FR-010).
 * Parcel 의 맥주 성분과 거품 성분을 각각 해당 충돌 유형의 규칙으로 처리한다.
 * 모든 계수는 balance.json 의 reaction 항목에서 조정한다.
 */
export class ReactionResolver {
  constructor(
    private readonly cfg: BalanceConfig['reaction'],
    private readonly ratedCapacity: number,
    private readonly maxSlosh: number,
  ) {}

  impactFineness(intensity: number): number {
    return clamp(this.cfg.impactFoamFinenessBase - this.cfg.impactFoamFinenessSlope * intensity, 0.2, 0.8);
  }

  /**
   * @param rimDepth 충돌 지점이 가장 낮은 잔 입구보다 얼마나 아래인지(cm). 얕을수록 튀김이 밖으로 나가기 쉽다.
   */
  resolve(parcel: Parcel, s: StreamSurface, intensity: number, state: BeerState, rimDepth: number): ReactionOutcome {
    const c = this.cfg;
    const out: ReactionOutcome = { splashOut: { beer: 0, foamLiquid: 0, foamGas: 0 }, gasReleased: 0, hits: [] };
    const excess = Math.max(0, intensity - c.foamThresholdIntensity);
    const fineness = this.impactFineness(intensity);

    let beer = parcel.beer;
    if (beer > 0) {
      const type = BEER_TYPE[s.surface];
      out.hits.push({ type, volume: beer });

      if (intensity > c.splashThresholdIntensity) {
        const f = Math.min(0.3, c.splashOutCoef * (intensity - c.splashThresholdIntensity) * Math.exp(-Math.max(0, rimDepth) / c.splashOutDepth));
        out.splashOut.beer = beer * f;
        beer -= out.splashOut.beer;
      }

      const carbonation = 1 - Math.min(c.maxCarbonationLoss, c.carbonationLossCoef * intensity * intensity);
      let effExcess = excess;
      let gen = 0;
      if (type === CollisionType.BeerGlass) gen = c.foamGenBeerGlass;
      else if (type === CollisionType.BeerBeer) gen = c.foamGenBeerBeer;
      else {
        // 맥주 → 거품: 기존 거품을 부수며 침투하고, 거품층이 두꺼울수록 액면 충격이 완화된다.
        state.destroyFoam(beer * c.foamDestroyPerBeer * intensity);
        const eff = intensity * Math.exp(-s.foamThickness / c.foamCushionDepth);
        effExcess = Math.max(0, eff - c.foamThresholdIntensity);
        gen = c.foamGenBeerFoam;
      }
      state.addBeer(beer, carbonation);
      state.beerToFoam(beer * Math.min(c.maxFoamConversion, gen * Math.pow(effExcess, c.foamGenExponent)), c.gasPerFoamLiquid, fineness);
      state.turbulence += (c.turbulenceCoef * beer * effExcess * effExcess) / this.ratedCapacity * 100;
      state.slosh = Math.min(this.maxSlosh, state.slosh + (c.sloshCoef * beer * intensity) / this.ratedCapacity);
    }

    const foamVol = parcel.foamLiquid + parcel.foamGas;
    if (foamVol > 0) {
      const type = FOAM_TYPE[s.surface];
      out.hits.push({ type, volume: foamVol });
      const coef = type === CollisionType.FoamGlass ? c.foamGlassDestroy : type === CollisionType.FoamBeer ? c.foamBeerDestroy : c.foamFoamDestroy;
      const destroyed = Math.min(0.5, coef * intensity);
      const keep = 1 - destroyed;
      if (type === CollisionType.FoamFoam && state.foamVolume > 0) {
        // 거품 → 거품: 병합·압축으로 기존 거품이 거칠어진다.
        state.fineness = Math.max(0.2, state.fineness - (c.foamFoamCoarsen * intensity * foamVol) / state.foamVolume);
      }
      state.addBeer(parcel.foamLiquid * destroyed, state.carbonation * 0.5);
      out.gasReleased += parcel.foamGas * destroyed;
      state.addFoam(parcel.foamLiquid * keep, parcel.foamGas * keep, parcel.fineness);
    }
    return out;
  }
}
