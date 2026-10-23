import type { BalanceConfig } from '../config';

/**
 * 디스펜서 레버 (FR-003).
 * level < 0 : 맥주(아래), 0 : 중립(차단), level > 0 : 거품(위).
 * J/K 는 레버를 아래/위로 1단계 이동시킨다. 맥주 쪽에서 K 를 누르면 중립 방향으로 복귀한다.
 */
export class LeverController {
  level = 0;
  readonly minLevel: number;
  readonly maxLevel: number;

  get beerFlowSteps(): number {
    return this.cfg.beerFlow.length;
  }

  constructor(private readonly cfg: BalanceConfig['lever']) {
    this.minLevel = -cfg.beerFlow.length;
    this.maxLevel = cfg.foamFlow.length;
  }

  /** @returns 입력이 적용되었으면 true, 끝 단계라 무시되었으면 false */
  move(dir: -1 | 1): boolean {
    const next = this.level + dir;
    if (next < this.minLevel || next > this.maxLevel) return false;
    this.level = next;
    return true;
  }

  /** 목표 맥주 유량(ml/s) */
  targetBeerFlow(): number {
    return this.level < 0 ? this.cfg.beerFlow[-this.level - 1] : 0;
  }

  /** 목표 거품 유량(기체 포함 부피, ml/s) */
  targetFoamFlow(): number {
    return this.level > 0 ? this.cfg.foamFlow[this.level - 1] : 0;
  }
}
