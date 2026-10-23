import { loadConfig, type BalanceConfig } from '../src/config';
import { GameController } from '../src/core/game';
import type { Command } from '../src/core/types';

export function cfg(mutate?: (c: BalanceConfig) => void): BalanceConfig {
  const c = structuredClone(loadConfig());
  mutate?.(c);
  return c;
}

/** [시각(초), 명령] 목록을 스텝 단위로 재생한다. */
export function play(script: Array<[number, Command]>, opts: { config?: BalanceConfig; maxSec?: number } = {}): GameController {
  const game = new GameController(opts.config ?? cfg());
  const items = [...script].sort((a, b) => a[0] - b[0]);
  const maxSteps = Math.round((opts.maxSec ?? 60) / game.dt);
  let i = 0;
  for (let n = 0; n < maxSteps && game.phase !== 'result'; n++) {
    const t = n * game.dt;
    while (i < items.length && items[i][0] <= t + 1e-9) game.enqueue(items[i++][1]);
    game.step();
    game.events.length = 0;
  }
  return game;
}

export function repeat(cmd: Command, times: number, at: number, gap = 0.05): Array<[number, Command]> {
  return Array.from({ length: times }, (_, k) => [at + k * gap, cmd] as [number, Command]);
}
