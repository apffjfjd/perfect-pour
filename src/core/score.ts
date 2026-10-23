import type { BalanceConfig } from '../config';
import { clamp01 } from './geometry';
import type { EndReason } from './types';

export type ScoreItem = 'temperature' | 'refreshment' | 'smoothness' | 'volume' | 'loss';

export const SCORE_ITEMS: readonly ScoreItem[] = ['temperature', 'refreshment', 'smoothness', 'volume', 'loss'];

export const SCORE_LABELS: Record<ScoreItem, string> = {
  temperature: '온도감',
  refreshment: '청량감',
  smoothness: '부드러움',
  volume: '양',
  loss: '로스',
};

export interface ScoreInput {
  beer: number;
  foamLiquid: number;
  foamGas: number;
  carbonation: number;
  spillBeerLiquid: number;
  spillFoamLiquid: number;
  spillFoamGas: number;
  timeSec: number;
  ratedCapacity: number;
  endReason: EndReason;
}

export interface ScoreResult {
  configVersion: string;
  total: number;
  /** 항목별 0..100 점 */
  items: Record<ScoreItem, number>;
  beerRatio: number;
  foamRatio: number;
  fill: number;
  carbonation: number;
  spillBeerMl: number;
  spillFoamMl: number;
  lossRate: number;
  timeSec: number;
  endReason: EndReason;
  title: string;
}

/**
 * 점수 계산 (FR-013).
 * 각 항목을 0..100 으로 계산한 뒤 balance.json 의 배점(기본 각 200, 총 1,000점)으로 환산한다.
 * 거의 빈 잔으로 온도감·로스 만점을 얻는 악용을 막기 위해, 충전율이 fillGate 미만이면
 * 양 외 항목에 충전율 비례 계수를 곱한다.
 */
export function calculateScore(input: ScoreInput, cfg: BalanceConfig['score'], configVersion: string): ScoreResult {
  const foam = input.foamLiquid + input.foamGas;
  const occupied = input.beer + foam;
  const beerRatio = occupied > 0 ? input.beer / occupied : 0;
  const foamRatio = occupied > 0 ? foam / occupied : 0;
  const fill = occupied / input.ratedCapacity;
  const lossRate = (input.spillBeerLiquid + input.spillFoamLiquid) / input.ratedCapacity;

  const t = cfg.temperature;
  const temperature = 1 - clamp01((input.timeSec - t.fullUntil) / (t.zeroAt - t.fullUntil));

  const r = cfg.refreshment;
  const ratioScore = occupied > 0 ? clamp01(1 - Math.pow(Math.abs(beerRatio - r.optimalBeerRatio) / r.ratioTolerance, 1.5)) : 0;
  const carbScore = clamp01((input.carbonation - r.carbonationFloor) / (1 - r.carbonationFloor));
  const refreshment = (1 - r.carbonationWeight) * ratioScore + r.carbonationWeight * carbScore * (occupied > 0 ? 1 : 0);

  const sm = cfg.smoothness;
  const dev = foamRatio - sm.optimalFoamRatio;
  const tol = dev < 0 ? sm.toleranceBelow : sm.toleranceAbove;
  const smoothness = occupied > 0 ? clamp01(1 - (dev / tol) * (dev / tol)) : 0;

  const v = cfg.volume;
  const volume = Math.pow(clamp01((fill - v.minFill) / (v.fullFill - v.minFill)), v.exponent);

  const loss = Math.max(0, 1 - lossRate / cfg.maxLossRate);

  const gate = clamp01(fill / cfg.fillGate);
  const items: Record<ScoreItem, number> = {
    temperature: round1(100 * temperature * gate),
    refreshment: round1(100 * refreshment * gate),
    smoothness: round1(100 * smoothness * gate),
    volume: round1(100 * volume),
    loss: round1(100 * loss * gate),
  };
  let total = 0;
  for (const k of SCORE_ITEMS) total += (items[k] * cfg.weights[k]) / 100;
  total = Math.round(total);

  return {
    configVersion,
    total,
    items,
    beerRatio,
    foamRatio,
    fill,
    carbonation: input.carbonation,
    spillBeerMl: input.spillBeerLiquid,
    spillFoamMl: input.spillFoamLiquid + input.spillFoamGas,
    lossRate,
    timeSec: input.timeSec,
    endReason: input.endReason,
    title: titleFor(total, cfg.titles),
  };
}

export function maxTotal(cfg: BalanceConfig['score']): number {
  return SCORE_ITEMS.reduce((s, k) => s + cfg.weights[k], 0);
}

export function titleFor(total: number, titles: BalanceConfig['score']['titles']): string {
  const sorted = [...titles].sort((a, b) => b.min - a.min);
  return (sorted.find((t) => total >= t.min) ?? sorted[sorted.length - 1]).name;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
