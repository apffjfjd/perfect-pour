import type { BeerState } from './beerState';
import type { GlassGeometry } from './geometry';
import type { GlassPose, SpillTotals } from './types';

/**
 * 넘침·유출 판정 (FR-012).
 * 점유 부피(맥주 + 거품 액체 + 거품 기체)가 현재 기울기에서의 수용 부피를 넘으면
 * 위층(거품 → 맥주)부터 초과분을 유출로 처리한다. 출렁임은 유효 수용 부피를 줄인다.
 */
export class OverflowDetector {
  constructor(
    private readonly geom: GlassGeometry,
    private readonly sloshCapacityFactor: number,
  ) {}

  effectiveCapacity(pose: GlassPose, state: BeerState): number {
    const cap = this.geom.capacity(pose.tilt);
    if (state.slosh <= 0) return cap;
    const area = this.geom.surfaceAreaAt(pose.tilt, this.geom.lowestRimHeight(pose.tilt));
    return Math.max(0, cap - state.slosh * area * this.sloshCapacityFactor);
  }

  /** 넘친 양을 잔에서 제거해 반환한다. 넘치지 않았으면 null. */
  resolve(pose: GlassPose, state: BeerState): SpillTotals | null {
    const excess = state.occupied - this.effectiveCapacity(pose, state);
    if (excess <= 1e-9) return null;
    const out = state.removeFromTop(excess);
    return { beerLiquid: out.beer, foamLiquid: out.foamLiquid, foamGas: out.foamGas };
  }
}
