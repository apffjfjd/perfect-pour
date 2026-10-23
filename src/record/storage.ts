import type { ScoreResult } from '../core/score';

/**
 * 개인 최고 기록 (FR-015) 및 사용자 설정 저장.
 * LocalStorage 접근이 막혀 있어도(사생활 보호 모드, 용량 초과) 예외 없이 동작한다.
 */

const PREFIX = 'perfect-pour:';
const BEST_KEY = `${PREFIX}best`;
const BEST_SCHEMA = 1;

export interface BestRecord {
  schema: number;
  savedAt: string;
  result: ScoreResult;
}

export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(PREFIX + key, value);
      return true;
    } catch {
      return false;
    }
  },
};

export function loadBest(): BestRecord | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(BEST_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as BestRecord;
    if (rec?.schema !== BEST_SCHEMA || typeof rec.result?.total !== 'number' || typeof rec.result.configVersion !== 'string') return null;
    return rec;
  } catch {
    return null;
  }
}

/** 점수가 높거나, 같으면 더 빨리 따른 기록을 최고 기록으로 본다. */
export function isBetter(a: ScoreResult, b: ScoreResult | undefined): boolean {
  if (!b) return true;
  return a.total > b.total || (a.total === b.total && a.timeSec < b.timeSec);
}

/** @returns 최고 기록이 갱신되었으면 true */
export function submitBest(result: ScoreResult): { updated: boolean; previous: BestRecord | null; saved: boolean } {
  const previous = loadBest();
  if (!isBetter(result, previous?.result)) return { updated: false, previous, saved: true };
  const rec: BestRecord = { schema: BEST_SCHEMA, savedAt: new Date().toISOString(), result };
  let saved = true;
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(rec));
  } catch {
    saved = false;
  }
  return { updated: true, previous, saved };
}
