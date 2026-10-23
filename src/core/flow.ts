import type { BalanceConfig } from '../config';
import type { Parcel } from './types';

/**
 * 유량 시뮬레이터 (FR-008).
 * 레버가 정한 목표 유량과 노즐의 실제 배출 유량을 분리해 지연 반응을 적용한다.
 * 실제 유량 합이 최소 유효 유량 이상일 때만 노즐에서 흐름(Parcel)이 배출된다.
 */
export class FlowSimulator {
  beerFlow = 0;
  foamFlow = 0;
  /** 노즐 흐름이 끊긴 채 지속된 시간 */
  brokenTime = 0;
  /** 공중에 떠 있는 내용물 */
  parcels: Parcel[] = [];
  private closed = false;

  constructor(
    private readonly cfg: BalanceConfig['flow'],
    private readonly nozzleY: number,
  ) {}

  get totalFlow(): number {
    return this.beerFlow + this.foamFlow;
  }

  get isFlowing(): boolean {
    return !this.closed && this.totalFlow >= this.cfg.minEffectiveFlow;
  }

  /** 게임 종료 후 노즐을 잠근다. 이미 공중에 있는 내용물은 계속 떨어진다. */
  close(): void {
    this.closed = true;
  }

  /**
   * 실제 유량을 갱신하고 이번 스텝에 배출된 Parcel 을 반환한다(없으면 null).
   */
  update(dt: number, targetBeer: number, targetFoam: number): Parcel | null {
    this.beerFlow = lag(this.beerFlow, targetBeer, dt, this.cfg.riseTime, this.cfg.decayTime);
    this.foamFlow = lag(this.foamFlow, targetFoam, dt, this.cfg.riseTime, this.cfg.decayTime);
    if (!this.isFlowing) {
      this.brokenTime += dt;
      return null;
    }
    this.brokenTime = 0;
    const foamVolume = this.foamFlow * dt;
    const foamLiquid = foamVolume * this.cfg.nozzleFoamLiquidFraction;
    const parcel: Parcel = {
      y: this.nozzleY,
      v: this.cfg.baseExitSpeed + this.cfg.exitSpeedPerFlow * this.totalFlow,
      beer: this.beerFlow * dt,
      foamLiquid,
      foamGas: foamVolume - foamLiquid,
      fineness: this.cfg.nozzleFoamFineness,
      rate: this.totalFlow,
      outside: false,
    };
    this.parcels.push(parcel);
    return parcel;
  }
}

/** 증가·감소 시간 상수가 다른 1차 지연 */
function lag(cur: number, target: number, dt: number, rise: number, decay: number): number {
  const tau = target > cur ? rise : decay;
  const next = cur + (target - cur) * (1 - Math.exp(-dt / tau));
  return next < 1e-6 && target === 0 ? 0 : next;
}
