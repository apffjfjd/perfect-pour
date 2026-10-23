import type { BalanceConfig } from '../config';
import { BeerState } from './beerState';
import { CollisionDetector, type StreamSurface } from './collision';
import { FlowSimulator } from './flow';
import { GlassGeometry } from './geometry';
import { GlassController } from './glassController';
import { LeverController } from './lever';
import { OverflowDetector } from './overflow';
import { ReactionResolver } from './reaction';
import { calculateScore, type ScoreResult } from './score';
import type { Command, EndReason, GamePhase, Parcel, SimEvent, SpillTotals } from './types';

/**
 * 게임 진행 관리 (GameController).
 * 고정 시간 간격(step)으로만 진행하며 브라우저·렌더링에 의존하지 않는다.
 * 같은 설정과 같은 스텝에 들어온 같은 명령열이면 항상 같은 결과를 낸다.
 */
export class GameController {
  readonly dt: number;
  readonly geom: GlassGeometry;
  readonly lever: LeverController;
  readonly glass: GlassController;
  readonly flow: FlowSimulator;
  readonly beer: BeerState;

  phase: GamePhase = 'ready';
  stepIndex = 0;
  endReason: EndReason | null = null;
  result: ScoreResult | null = null;
  /** 최초로 내용물이 잔에 들어갔는지 (종료 조건 2 의 전제) */
  enteredGlass = false;
  readonly spill: SpillTotals = { beerLiquid: 0, foamLiquid: 0, foamGas: 0 };
  surface: StreamSurface;
  /** 렌더러·효과·사운드가 읽고 비우는 이벤트 목록 */
  events: SimEvent[] = [];

  private readonly collision: CollisionDetector;
  private readonly reaction: ReactionResolver;
  private readonly overflow: OverflowDetector;
  private readonly queue: Command[] = [];
  private startStep = -1;
  private endStep = -1;
  private settleTime = 0;
  private emittedLiquid = 0;
  private emittedGas = 0;
  private impactGasReleased = 0;

  constructor(private readonly cfg: BalanceConfig) {
    this.dt = 1 / cfg.simulation.stepHz;
    this.geom = new GlassGeometry(cfg.glass);
    this.lever = new LeverController(cfg.lever);
    this.glass = new GlassController(cfg.glass, this.geom, cfg.dispenser.nozzleY, cfg.dispenser.trayY);
    this.flow = new FlowSimulator(cfg.flow, cfg.dispenser.nozzleY);
    this.beer = new BeerState(cfg.beer);
    this.collision = new CollisionDetector(cfg.collision, cfg.flow.maxTotalFlow, cfg.flow.streamHalfWidth, this.geom);
    this.reaction = new ReactionResolver(cfg.reaction, this.geom.ratedCapacity, cfg.beer.maxSlosh);
    this.overflow = new OverflowDetector(this.geom, cfg.beer.sloshCapacityFactor);
    this.surface = this.collision.surface(this.glass.pose, this.beer);
  }

  /** 입력은 즉시 큐에 쌓이고 다음 스텝에서 순서대로 모두 적용된다. */
  enqueue(cmd: Command): void {
    if (this.phase === 'ready' || this.phase === 'pouring') this.queue.push(cmd);
  }

  get acceptsInput(): boolean {
    return this.phase === 'ready' || this.phase === 'pouring';
  }

  /** 소요 시간(초). 최초 배출부터 종료 판정까지. */
  get elapsed(): number {
    if (this.startStep < 0) return 0;
    const end = this.endStep >= 0 ? this.endStep : this.stepIndex;
    return (end - this.startStep) * this.dt;
  }

  get spillLiquid(): number {
    return this.spill.beerLiquid + this.spill.foamLiquid;
  }

  step(): void {
    if (this.phase === 'result') return;
    const dt = this.dt;

    // 1. 입력 소비
    while (this.queue.length > 0) this.apply(this.queue.shift()!);

    // 잔 자세 보간. 내용물이 담긴 채 움직이면 출렁인다.
    const moved = this.glass.update(dt);
    if (moved > 0 && this.beer.occupied > 0) {
      const fullness = this.beer.occupied / this.geom.ratedCapacity;
      this.beer.slosh = Math.min(this.cfg.beer.maxSlosh, this.beer.slosh + moved * this.cfg.beer.sloshMoveCoef * fullness * 100);
    }

    // 2. 유량 갱신 및 배출
    const parcel = this.flow.update(dt, this.lever.targetBeerFlow(), this.lever.targetFoamFlow());
    if (parcel) {
      this.emittedLiquid += parcel.beer + parcel.foamLiquid;
      this.emittedGas += parcel.foamGas;
      // 3. 최초 배출 → 진행
      if (this.phase === 'ready') {
        this.phase = 'pouring';
        this.startStep = this.stepIndex;
        this.events.push({ kind: 'phase', phase: 'pouring' });
      }
    }

    // 4~5. 낙하·충돌·반응
    const s = this.collision.surface(this.glass.pose, this.beer);
    this.surface = s;
    this.advanceParcels(s);

    // 6. 시간 경과
    this.beer.update(dt, this.reaction.impactFineness(1));

    // 7. 넘침
    const over = this.overflow.resolve(this.glass.pose, this.beer);
    if (over) {
      this.addSpill(over);
      const p = this.geom.lowRimPoint(this.glass.pose);
      this.events.push({ kind: 'spill', x: p.x, y: p.y, volume: over.beerLiquid + over.foamLiquid + over.foamGas });
    }

    // 8. 종료 판정
    if (this.phase === 'pouring') {
      if (this.spillLiquid >= this.cfg.spill.endThresholdLiquid) this.end('spill');
      else if (this.enteredGlass && this.flow.brokenTime >= this.cfg.flow.breakGrace) this.end('flowBreak');
    } else if (this.phase === 'ended') {
      this.settleTime += dt;
      const settled = this.settleTime >= this.cfg.settle.minSeconds && this.flow.parcels.length === 0;
      if (settled || this.settleTime >= this.cfg.settle.maxSeconds) this.finish();
    }
    this.stepIndex++;
  }

  private apply(cmd: Command): void {
    let ok: boolean;
    switch (cmd) {
      case 'leverDown': ok = this.lever.move(-1); break;
      case 'leverUp': ok = this.lever.move(1); break;
      case 'tilt': ok = this.glass.tilt(1); break;
      case 'untilt': ok = this.glass.tilt(-1); break;
      case 'raise': ok = this.glass.moveHeight(1); break;
      case 'lower': ok = this.glass.moveHeight(-1); break;
    }
    if (!ok) this.events.push({ kind: 'ignored', command: cmd });
  }

  private advanceParcels(s: StreamSurface): void {
    const g = this.cfg.simulation.gravity;
    const dt = this.dt;
    const trayY = this.cfg.dispenser.trayY;
    const rimDepth = this.geom.bottomCenterY(this.glass.pose) + this.geom.lowestRimHeight(this.glass.pose.tilt) - s.surfaceY;
    const next: Parcel[] = [];
    for (const p of this.flow.parcels) {
      const prevY = p.y;
      p.v += g * dt;
      p.y -= p.v * dt;

      // 잔 입구를 지나는 순간, 입구 가장자리에 걸치거나 벗어난 부분을 분리한다.
      if (!p.outside && prevY > s.rimCrossY && p.y <= s.rimCrossY && s.outsideFraction > 0) {
        if (s.outsideFraction >= 1) p.outside = true;
        else {
          const f = s.outsideFraction;
          next.push(scaleParcel(p, f, true));
          Object.assign(p, scaleParcel(p, 1 - f, false));
        }
      }

      if (p.outside) {
        if (p.y <= trayY) {
          this.addSpill({ beerLiquid: p.beer, foamLiquid: p.foamLiquid, foamGas: p.foamGas });
          this.events.push({ kind: 'spill', x: 0, y: trayY, volume: p.beer + p.foamLiquid + p.foamGas });
        } else next.push(p);
        continue;
      }

      if (p.y <= s.surfaceY) {
        const hit = this.collision.classify(p, s);
        const r = this.reaction.resolve(p, s, hit.intensity, this.beer, rimDepth);
        this.impactGasReleased += r.gasReleased;
        const so = r.splashOut;
        if (so.beer + so.foamLiquid + so.foamGas > 0) {
          this.addSpill({ beerLiquid: so.beer, foamLiquid: so.foamLiquid, foamGas: so.foamGas });
        }
        for (const h of r.hits) {
          this.events.push({ kind: 'collision', type: h.type, intensity: hit.intensity, y: s.surfaceY, volume: h.volume });
        }
        this.enteredGlass = true;
        continue;
      }
      next.push(p);
    }
    this.flow.parcels = next;
  }

  private addSpill(t: SpillTotals): void {
    this.spill.beerLiquid += t.beerLiquid;
    this.spill.foamLiquid += t.foamLiquid;
    this.spill.foamGas += t.foamGas;
  }

  private end(reason: EndReason): void {
    this.phase = 'ended';
    this.endReason = reason;
    this.endStep = this.stepIndex;
    this.queue.length = 0;
    this.flow.close();
    this.events.push({ kind: 'phase', phase: 'ended' });
  }

  private finish(): void {
    const b = this.beer;
    this.result = calculateScore(
      {
        beer: b.beer,
        foamLiquid: b.foamLiquid,
        foamGas: b.foamGas,
        carbonation: b.carbonation,
        spillBeerLiquid: this.spill.beerLiquid,
        spillFoamLiquid: this.spill.foamLiquid,
        spillFoamGas: this.spill.foamGas,
        timeSec: this.elapsed,
        ratedCapacity: this.geom.ratedCapacity,
        endReason: this.endReason ?? 'flowBreak',
      },
      this.cfg.score,
      this.cfg.version,
    );
    this.phase = 'result';
    this.events.push({ kind: 'phase', phase: 'result' });
  }

  /** 부피 보존 검증: 배출량 = 잔 + 유출 + 공중(+ 기체는 생성·방출 반영). 0 에 가까워야 한다. */
  conservationError(): { liquid: number; gas: number } {
    let airLiquid = 0;
    let airGas = 0;
    for (const p of this.flow.parcels) {
      airLiquid += p.beer + p.foamLiquid;
      airGas += p.foamGas;
    }
    const b = this.beer;
    return {
      liquid: this.emittedLiquid - (b.liquid + this.spillLiquid + airLiquid),
      gas: this.emittedGas + b.gasCreated - b.gasReleased - this.impactGasReleased - this.spill.foamGas - airGas - b.foamGas,
    };
  }
}

function scaleParcel(p: Parcel, f: number, outside: boolean): Parcel {
  return { ...p, beer: p.beer * f, foamLiquid: p.foamLiquid * f, foamGas: p.foamGas * f, outside };
}
