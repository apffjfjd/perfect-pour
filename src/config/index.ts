import balance from './balance.json';

/** 밸런스 설정값 묶음. balance.json 구조가 곧 타입이다. */
export type BalanceConfig = typeof balance;

export function loadConfig(): BalanceConfig {
  validateConfig(balance);
  return balance;
}

/** 설정 파일 오류를 개발 단계에서 바로 드러내기 위한 최소 검증. */
export function validateConfig(cfg: BalanceConfig): void {
  const fail = (msg: string) => {
    throw new Error(`[balance.json] ${msg}`);
  };
  if (!/^[0-9A-Za-z.-]{1,16}$/.test(cfg.version)) fail('version 형식 오류');
  if (cfg.simulation.stepHz < 30 || cfg.simulation.stepHz > 1000) fail('stepHz 범위 오류');
  if (cfg.lever.beerFlow.length < 1 || cfg.lever.foamFlow.length < 1) fail('레버 단계가 비어 있음');
  if (cfg.glass.topRadius <= 0 || cfg.glass.bottomRadius <= 0 || cfg.glass.height <= 0) fail('잔 형상 오류');
  if (cfg.glass.pivotFromBottom <= 0 || cfg.glass.pivotFromBottom >= cfg.glass.height) fail('pivotFromBottom 범위 오류');
  if (cfg.glass.tiltStepDeg <= 0 || cfg.glass.tiltMaxDeg >= 89) fail('기울기 설정 오류');
  if (cfg.glass.heightSteps < 1) fail('heightSteps 오류');
  if (cfg.score.titles.length === 0) fail('칭호가 비어 있음');
}
