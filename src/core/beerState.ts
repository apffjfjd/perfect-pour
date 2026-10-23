import type { BalanceConfig } from '../config';

/**
 * 잔 내부 상태 (FR-011, GlassContents).
 * 맥주는 아래, 거품은 위에 위치하는 층 모델. 거품은 액체량과 기체량을 분리해 관리한다.
 * 보존 검증을 위해 생성·방출된 기체 총량을 함께 추적한다.
 */
export class BeerState {
  beer = 0;
  foamLiquid = 0;
  foamGas = 0;
  /** 맥주 탄산 보존도 0..1 (부피 가중 평균) */
  carbonation = 1;
  /** 거품 미세도 0..1 (높을수록 촘촘하고 오래감) */
  fineness = 0.9;
  /** 충격으로 생긴 난류. 시간이 지나며 기포를 올려 거품을 키운다. */
  turbulence = 0;
  /** 액면 출렁임 진폭(cm) */
  slosh = 0;

  /** 탄산에서 새로 생성된 거품 기체 누계 */
  gasCreated = 0;
  /** 거품 소멸로 대기 중에 빠져나간 기체 누계 */
  gasReleased = 0;

  constructor(private readonly cfg: BalanceConfig['beer']) {}

  get foamVolume(): number {
    return this.foamLiquid + this.foamGas;
  }

  get occupied(): number {
    return this.beer + this.foamVolume;
  }

  get liquid(): number {
    return this.beer + this.foamLiquid;
  }

  addBeer(volume: number, carbonation: number): void {
    if (volume <= 0) return;
    const total = this.beer + volume;
    this.carbonation = (this.carbonation * this.beer + carbonation * volume) / total;
    this.beer = total;
  }

  addFoam(liquid: number, gas: number, fineness: number): void {
    const vol = liquid + gas;
    if (vol <= 0) return;
    const total = this.foamVolume + vol;
    this.fineness = (this.fineness * this.foamVolume + fineness * vol) / total;
    this.foamLiquid += liquid;
    this.foamGas += gas;
  }

  /** 맥주 일부를 거품으로 바꾼다. 기체는 탄산에서 새로 생긴다. */
  beerToFoam(liquid: number, gasPerLiquid: number, fineness: number): void {
    const l = Math.min(liquid, this.beer);
    if (l <= 0) return;
    const gas = l * gasPerLiquid * this.carbonation;
    this.beer -= l;
    this.gasCreated += gas;
    this.addFoam(l, gas, fineness);
  }

  /** 거품 부피 vol 만큼 파괴: 액체는 맥주층으로, 기체는 대기로 */
  destroyFoam(vol: number): void {
    const fv = this.foamVolume;
    if (fv <= 0 || vol <= 0) return;
    const f = Math.min(1, vol / fv);
    const l = this.foamLiquid * f;
    const g = this.foamGas * f;
    this.foamLiquid -= l;
    this.foamGas -= g;
    this.gasReleased += g;
    // 거품 속 액체는 이미 탄산을 잃은 상태로 본다.
    this.addBeer(l, this.carbonation * 0.5);
    this.cleanup();
  }

  /** 넘침으로 위에서부터 vol 만큼 잃는다. */
  removeFromTop(vol: number): { beer: number; foamLiquid: number; foamGas: number } {
    const out = { beer: 0, foamLiquid: 0, foamGas: 0 };
    const fv = this.foamVolume;
    if (fv > 0) {
      const f = Math.min(1, vol / fv);
      out.foamLiquid = this.foamLiquid * f;
      out.foamGas = this.foamGas * f;
      this.foamLiquid -= out.foamLiquid;
      this.foamGas -= out.foamGas;
      vol -= fv * f;
    }
    if (vol > 1e-12) {
      out.beer = Math.min(this.beer, vol);
      this.beer -= out.beer;
    }
    this.cleanup();
    return out;
  }

  /** 시간 경과: 거품 소멸, 난류 기포, 탄산 감소, 출렁임 감쇠 */
  update(dt: number, turbulenceFineness: number): void {
    const c = this.cfg;
    const decay = (c.foamDecayBase + c.foamDecayCoarse * (1 - this.fineness)) * dt;
    if (this.foamVolume > 0) this.destroyFoam(this.foamVolume * decay);

    if (this.turbulence > 0 && this.beer > 0) {
      const l = this.beer * Math.min(0.5, c.turbulenceFoamRate * this.turbulence * dt);
      this.beerToFoam(l, c.turbulenceGasPerLiquid, turbulenceFineness);
      this.turbulence *= Math.exp(-dt / c.turbulenceDecayTime);
      if (this.turbulence < 1e-6) this.turbulence = 0;
    }

    this.carbonation = Math.max(0, this.carbonation - c.carbonationDecay * dt);
    this.slosh *= Math.exp(-dt / c.sloshDecayTime);
  }

  private cleanup(): void {
    if (this.foamLiquid < 1e-9 && this.foamGas < 1e-9) {
      this.gasReleased += this.foamGas;
      this.beer += this.foamLiquid;
      this.foamLiquid = 0;
      this.foamGas = 0;
    }
  }
}
