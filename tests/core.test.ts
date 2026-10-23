import { describe, expect, it } from 'vitest';
import { GameController } from '../src/core/game';
import { GlassGeometry } from '../src/core/geometry';
import { calculateScore, titleFor } from '../src/core/score';
import { cfg, play, repeat } from './helpers';
import type { Command } from '../src/core/types';

const SKILLED: Array<[number, Command]> = [
  ...repeat('raise', 9, 0), ...repeat('tilt', 4, 0.6),
  ...repeat('leverDown', 5, 1.2),
  ...repeat('untilt', 4, 3.0, 0.4),
  ...repeat('leverUp', 9, 6.7, 0.03),
  ...repeat('leverDown', 4, 11.7, 0.03),
];

describe('잔 형상', () => {
  const g = new GlassGeometry(cfg().glass);

  it('정격 용량은 원뿔대 부피(약 500ml)', () => {
    expect(g.ratedCapacity).toBeGreaterThan(480);
    expect(g.ratedCapacity).toBeLessThan(520);
  });

  it('세운 잔의 수치 적분은 해석해와 일치', () => {
    const tiny = 1e-3;
    expect(g.volumeBelow(tiny, 7)).toBeCloseTo(g.volumeBelow(0, 7), 0);
  });

  it('기울일수록 넘치지 않고 담을 수 있는 부피가 줄어든다', () => {
    const caps = [0, 15, 30, 45, 60].map((d) => g.capacity((d * Math.PI) / 180));
    for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeLessThan(caps[i - 1]);
  });

  it('levelForVolume 은 volumeBelow 의 역함수', () => {
    for (const tilt of [0, 0.3, 0.7]) {
      for (const v of [10, 100, 250]) {
        const h = g.levelForVolume(tilt, v);
        expect(g.volumeBelow(tilt, h)).toBeCloseTo(v, 1);
      }
    }
  });
});

describe('조작', () => {
  it('끝 단계에서 추가 입력은 무시된다', () => {
    const game = new GameController(cfg());
    for (let i = 0; i < 20; i++) game.enqueue('leverDown');
    game.step();
    expect(game.lever.level).toBe(game.lever.minLevel);
    expect(game.events.filter((e) => e.kind === 'ignored').length).toBe(20 - game.lever.beerFlowSteps);
  });

  it('같은 스텝에 들어온 입력도 순서대로 모두 적용된다', () => {
    const game = new GameController(cfg());
    game.enqueue('leverDown');
    game.enqueue('leverDown');
    game.enqueue('leverUp');
    game.enqueue('tilt');
    game.enqueue('raise');
    game.step();
    expect(game.lever.level).toBe(-1);
    expect(game.glass.tiltStep).toBe(1);
    expect(game.glass.heightStep).toBe(1);
  });

  it('노즐과 부딪히는 높이·기울기 조합은 무시된다', () => {
    const game = new GameController(cfg());
    for (let i = 0; i < 9; i++) game.enqueue('raise');
    for (let i = 0; i < 12; i++) game.enqueue('tilt');
    game.step();
    expect(game.glass.heightStep).toBe(9);
    expect(game.glass.tiltStep).toBeLessThan(game.glass.maxTiltStep);
    expect(game.glass.isSafe(game.glass.tiltStep, game.glass.heightStep)).toBe(true);
  });

  it('잔 회전은 즉시가 아니라 애니메이션으로 목표 각도에 도달한다', () => {
    const game = new GameController(cfg());
    for (let i = 0; i < 6; i++) game.enqueue('tilt');
    game.step();
    expect(game.glass.pose.tilt).toBeGreaterThan(0);
    expect(game.glass.pose.tilt).toBeLessThan(game.glass.targetTilt());
    for (let i = 0; i < 120; i++) game.step();
    expect(game.glass.pose.tilt).toBeCloseTo(game.glass.targetTilt(), 6);
  });
});

describe('게임 흐름', () => {
  it('최초 배출 전에는 시작하지 않는다', () => {
    const game = play([...repeat('tilt', 3, 0), ...repeat('raise', 3, 0)], { maxSec: 3 });
    expect(game.phase).toBe('ready');
    expect(game.elapsed).toBe(0);
  });

  it('레버 중립만으로 즉시 끝나지 않고 유량이 지연 감소한다', () => {
    const game = new GameController(cfg());
    for (let i = 0; i < 5; i++) game.enqueue('leverDown');
    for (let i = 0; i < 240; i++) game.step();
    for (let i = 0; i < 5; i++) game.enqueue('leverUp');
    game.step();
    expect(game.lever.level).toBe(0);
    for (let i = 0; i < 30; i++) game.step();
    expect(game.phase).toBe('pouring');
    expect(game.flow.isFlowing).toBe(true);
  });

  it('맥주 → 거품 빠른 전환은 흐름을 끊지 않는다', () => {
    const game = play([...repeat('leverDown', 5, 0), ...repeat('leverUp', 10, 3, 0.04)], { maxSec: 4 });
    expect(game.phase).toBe('pouring');
  });

  it('최초 잔 유입 이후 흐름이 끊기면 종료된다', () => {
    const game = play([[0, 'leverDown'], [1, 'leverUp']]);
    expect(game.phase).toBe('result');
    expect(game.endReason).toBe('flowBreak');
  });

  it('잔을 지나치게 기울여 흐름이 잔 밖으로 떨어지면 유출로 종료된다', () => {
    const game = play([...repeat('tilt', 12, 0), ...repeat('leverDown', 5, 1)]);
    expect(game.endReason).toBe('spill');
    expect(game.spillLiquid).toBeGreaterThan(0);
  });

  it('계속 따르면 넘쳐서 유출로 종료된다', () => {
    const game = play(repeat('leverDown', 5, 0));
    expect(game.endReason).toBe('spill');
  });

  it('종료 후 입력은 받지 않는다', () => {
    const game = play([[0, 'leverDown'], [1, 'leverUp']]);
    game.enqueue('leverDown');
    expect(game.acceptsInput).toBe(false);
  });
});

describe('보존·결정성', () => {
  it('액체량·기체량이 전 과정에서 보존된다', () => {
    const game = new GameController(cfg());
    const script = [...SKILLED].sort((a, b) => a[0] - b[0]);
    let i = 0;
    for (let n = 0; n < 30 * 120 && game.phase !== 'result'; n++) {
      while (i < script.length && script[i][0] <= n * game.dt + 1e-9) game.enqueue(script[i++][1]);
      game.step();
      const err = game.conservationError();
      expect(Math.abs(err.liquid)).toBeLessThan(1e-6);
      expect(Math.abs(err.gas)).toBeLessThan(1e-6);
    }
  });

  it('같은 조작이면 같은 결과', () => {
    const a = play(SKILLED).result;
    const b = play(SKILLED).result;
    expect(a).toEqual(b);
  });

  it('숙련된 따르기가 단순히 붓기만 하는 것보다 점수가 높다', () => {
    const skilled = play(SKILLED).result!;
    const naive = play(repeat('leverDown', 5, 0)).result!;
    expect(skilled.total).toBeGreaterThan(850);
    expect(skilled.total).toBeGreaterThan(naive.total + 100);
  });

  it('높은 곳에서 세운 잔에 부으면 거품이 많이 생긴다', () => {
    const low = play([...repeat('leverDown', 5, 0), ...repeat('leverUp', 5, 4, 0.03)]).result!;
    const high = play([...repeat('raise', 9, 0), ...repeat('leverDown', 5, 1), ...repeat('leverUp', 5, 5, 0.03)]).result!;
    expect(low.foamRatio).toBeGreaterThan(high.foamRatio * 2);
  });
});

describe('점수', () => {
  const c = cfg();
  const base = {
    beer: 340, foamLiquid: 30, foamGas: 115, carbonation: 1,
    spillBeerLiquid: 0, spillFoamLiquid: 0, spillFoamGas: 0,
    timeSec: 8, ratedCapacity: 496.6, endReason: 'flowBreak' as const,
  };

  it('로스 점수 = 100 × max(0, 1 - 로스율 / 최대 로스율)', () => {
    const spill = base.ratedCapacity * c.score.maxLossRate * 0.25;
    const r = calculateScore({ ...base, spillBeerLiquid: spill }, c.score, c.version);
    expect(r.items.loss).toBeCloseTo(75, 0);
    const r2 = calculateScore({ ...base, spillBeerLiquid: spill * 10 }, c.score, c.version);
    expect(r2.items.loss).toBe(0);
  });

  it('거품 생성 자체는 로스가 아니다', () => {
    const r = calculateScore({ ...base, foamGas: 300 }, c.score, c.version);
    expect(r.items.loss).toBe(100);
  });

  it('최적 비율에서 청량감·부드러움이 최고, 과다·과소면 감점', () => {
    const best = calculateScore(base, c.score, c.version);
    const tooMuchFoam = calculateScore({ ...base, beer: 200, foamLiquid: 60, foamGas: 230 }, c.score, c.version);
    const noFoam = calculateScore({ ...base, beer: 480, foamLiquid: 0, foamGas: 0 }, c.score, c.version);
    expect(best.items.smoothness).toBeGreaterThan(95);
    expect(tooMuchFoam.items.smoothness).toBeLessThan(best.items.smoothness);
    expect(noFoam.items.smoothness).toBe(0);
    expect(tooMuchFoam.items.refreshment).toBeLessThan(best.items.refreshment);
  });

  it('빈 잔에 가까우면 온도감·로스 만점을 얻을 수 없다', () => {
    const r = calculateScore({ ...base, beer: 10, foamLiquid: 1, foamGas: 3 }, c.score, c.version);
    expect(r.items.temperature).toBeLessThan(10);
    expect(r.items.loss).toBeLessThan(10);
  });

  it('총점은 1000점 만점이고 칭호가 부여된다', () => {
    const r = calculateScore(base, c.score, c.version);
    expect(r.total).toBeLessThanOrEqual(1000);
    expect(titleFor(1000, c.score.titles)).toBe('전설의 비어 마스터');
    expect(titleFor(0, c.score.titles)).toBe('맥주 테러리스트');
  });
});
