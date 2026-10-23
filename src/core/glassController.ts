import type { BalanceConfig } from '../config';
import type { GlassGeometry } from './geometry';
import type { GlassPose } from './types';

const DEG = Math.PI / 180;

/**
 * 잔 기울기·높이 단계 관리 (FR-004, FR-005).
 * 단계 변경은 즉시 목표값을 바꾸고, 실제 자세는 일정 속도로 목표에 다가간다(회전·이동 애니메이션).
 * 시뮬레이션 판정도 이 보간된 자세를 사용하므로 화면과 판정이 항상 일치한다.
 */
export class GlassController {
  tiltStep = 0;
  heightStep = 0;
  readonly maxTiltStep: number;
  readonly pose: GlassPose;

  constructor(
    private readonly cfg: BalanceConfig['glass'],
    private readonly geom: GlassGeometry,
    private readonly nozzleY: number,
    private readonly trayY: number,
  ) {
    this.maxTiltStep = Math.floor(cfg.tiltMaxDeg / cfg.tiltStepDeg + 1e-9);
    this.pose = { tilt: 0, pivotY: this.pivotYFor(0) };
  }

  targetTilt(step = this.tiltStep): number {
    return step * this.cfg.tiltStepDeg * DEG;
  }

  pivotYFor(step: number): number {
    return this.cfg.basePivotY + step * this.cfg.heightStepCm;
  }

  /** 목표 자세가 노즐·드립 트레이와 겹치지 않는지 */
  isSafe(tiltStep: number, heightStep: number): boolean {
    const pose = { tilt: this.targetTilt(tiltStep), pivotY: this.pivotYFor(heightStep) };
    const top = this.geom.highestPointY(pose, this.cfg.wallThickness);
    const bottom = this.geom.lowestPointY(pose, this.cfg.wallThickness, this.cfg.baseThickness);
    return top <= this.nozzleY - this.cfg.nozzleClearance && bottom >= this.trayY + this.cfg.trayClearance;
  }

  tilt(dir: -1 | 1): boolean {
    const next = this.tiltStep + dir;
    if (next < 0 || next > this.maxTiltStep || !this.isSafe(next, this.heightStep)) return false;
    this.tiltStep = next;
    return true;
  }

  moveHeight(dir: -1 | 1): boolean {
    const next = this.heightStep + dir;
    if (next < 0 || next >= this.cfg.heightSteps || !this.isSafe(this.tiltStep, next)) return false;
    this.heightStep = next;
    return true;
  }

  /** @returns 이번 스텝의 자세 변화량(출렁임 계산용): 각도 변화(rad) + 높이 변화(cm) 를 합친 이동량 */
  update(dt: number): number {
    const before = { ...this.pose };
    this.pose.tilt = approach(this.pose.tilt, this.targetTilt(), this.cfg.tiltSpeedDegPerSec * DEG * dt);
    this.pose.pivotY = approach(this.pose.pivotY, this.pivotYFor(this.heightStep), this.cfg.heightSpeedCmPerSec * dt);
    return Math.abs(this.pose.tilt - before.tilt) * this.geom.H + Math.abs(this.pose.pivotY - before.pivotY);
  }
}

function approach(cur: number, target: number, maxDelta: number): number {
  if (Math.abs(target - cur) <= maxDelta) return target;
  return cur + Math.sign(target - cur) * maxDelta;
}
