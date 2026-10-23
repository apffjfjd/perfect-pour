/** 입력 장치와 무관한 6종 조작 명령 (ControlCommand). */
export type Command = 'leverDown' | 'leverUp' | 'tilt' | 'untilt' | 'raise' | 'lower';

export const COMMANDS: readonly Command[] = ['leverDown', 'leverUp', 'tilt', 'untilt', 'raise', 'lower'];

/** GameSession 상태. Ended 는 공중 잔여분·거품 팽창 정산 구간. */
export type GamePhase = 'ready' | 'pouring' | 'ended' | 'result';

export type EndReason = 'spill' | 'flowBreak';

/** FR-009 충돌 유형 6종. */
export enum CollisionType {
  BeerGlass = 1,
  BeerBeer = 2,
  BeerFoam = 3,
  FoamGlass = 4,
  FoamBeer = 5,
  FoamFoam = 6,
}

/** 노즐에서 배출되어 아직 충돌 전인 내용물 묶음 (Stream). 단위: cm, cm/s, ml. */
export interface Parcel {
  y: number;
  v: number;
  beer: number;
  foamLiquid: number;
  foamGas: number;
  fineness: number;
  /** 배출 당시 총 유량(ml/s). 충돌 강도의 "현재 유량" 요소. */
  rate: number;
  outside: boolean;
}

/** 잔 자세. tilt 는 라디안, pivotY 는 잔을 잡은 회전축의 월드 높이. */
export interface GlassPose {
  tilt: number;
  pivotY: number;
}

export interface SpillTotals {
  beerLiquid: number;
  foamLiquid: number;
  foamGas: number;
}

export type SimEvent =
  | { kind: 'collision'; type: CollisionType; intensity: number; y: number; volume: number }
  | { kind: 'spill'; y: number; x: number; volume: number }
  | { kind: 'phase'; phase: GamePhase }
  | { kind: 'ignored'; command: Command };
