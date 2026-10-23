import type { ScoreItem, ScoreResult } from '../core/score';
import { SCORE_ITEMS } from '../core/score';
import type { EndReason } from '../core/types';

/**
 * URL 기반 결과 공유 (FR-016).
 *
 * 형식: `#r=<base64url(JSON 배열)>.<FNV-1a 32bit 체크섬>`
 * - fragment 는 서버로 전송되지 않으므로 정적 호스팅에서 안전하게 동작한다.
 * - 체크섬은 링크 손상(잘림·오타) 감지용일 뿐 위변조 방지 수단이 아니다.
 * - URL 데이터는 신뢰할 수 없는 입력이므로 모든 필드를 형식·범위 검증한다.
 */

export const SHARE_VERSION = 1;
export const SHARE_PARAM = 'r';
export const NICK_MAX = 12;
const MAX_PAYLOAD = 600;

export interface SharedRecord {
  configVersion: string;
  total: number;
  items: Record<ScoreItem, number>;
  beerRatio: number;
  fill: number;
  spillBeerMl: number;
  spillFoamMl: number;
  timeSec: number;
  endReason: EndReason;
  nick: string;
}

export function toSharedRecord(r: ScoreResult, nick: string): SharedRecord {
  return {
    configVersion: r.configVersion,
    total: r.total,
    items: { ...r.items },
    beerRatio: r.beerRatio,
    fill: r.fill,
    spillBeerMl: r.spillBeerMl,
    spillFoamMl: r.spillFoamMl,
    timeSec: r.timeSec,
    endReason: r.endReason,
    nick: sanitizeNick(nick),
  };
}

export function encodeRecord(rec: SharedRecord): string {
  const arr = [
    SHARE_VERSION,
    rec.configVersion,
    Math.round(rec.total),
    ...SCORE_ITEMS.map((k) => Math.round(rec.items[k] * 10)),
    Math.round(rec.beerRatio * 1000),
    Math.round(rec.fill * 1000),
    Math.round(rec.spillBeerMl * 10),
    Math.round(rec.spillFoamMl * 10),
    Math.round(rec.timeSec * 100),
    rec.endReason === 'spill' ? 1 : 0,
    sanitizeNick(rec.nick),
  ];
  const json = JSON.stringify(arr);
  return `${toBase64Url(json)}.${fnv1a(json)}`;
}

export function buildShareUrl(base: string, rec: SharedRecord): string {
  return `${base.split('#')[0]}#${SHARE_PARAM}=${encodeRecord(rec)}`;
}

export type DecodeResult = { ok: true; record: SharedRecord } | { ok: false; error: string };

/** location.hash 에서 공유 기록을 읽는다. 공유 데이터가 없으면 null. */
export function readShareFromHash(hash: string): DecodeResult | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h) return null;
  const params = new URLSearchParams(h);
  const payload = params.get(SHARE_PARAM);
  if (payload === null) return null;
  return decodeRecord(payload);
}

export function decodeRecord(payload: string): DecodeResult {
  const fail = (error: string): DecodeResult => ({ ok: false, error });
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > MAX_PAYLOAD) return fail('길이');
  const dot = payload.lastIndexOf('.');
  if (dot <= 0) return fail('형식');
  const body = payload.slice(0, dot);
  const sum = payload.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[0-9a-f]{8}$/.test(sum)) return fail('형식');

  let json: string;
  try {
    json = fromBase64Url(body);
  } catch {
    return fail('인코딩');
  }
  if (fnv1a(json) !== sum) return fail('체크섬');

  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return fail('JSON');
  }
  if (!Array.isArray(arr) || arr.length !== 15) return fail('구조');
  const [v, cfgVer, total, t, rf, sm, vol, loss, br, fill, sb, sf, time, reason, nick] = arr as unknown[];
  if (v !== SHARE_VERSION) return fail('버전');
  if (typeof cfgVer !== 'string' || !/^[0-9A-Za-z.-]{1,16}$/.test(cfgVer)) return fail('설정 버전');
  const int = (x: unknown, lo: number, hi: number): x is number => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
  if (!int(total, 0, 1000)) return fail('총점');
  for (const x of [t, rf, sm, vol, loss]) if (!int(x, 0, 1000)) return fail('항목 점수');
  if (!int(br, 0, 1000) || !int(fill, 0, 1100)) return fail('비율');
  if (!int(sb, 0, 100000) || !int(sf, 0, 100000)) return fail('유출량');
  if (!int(time, 0, 360000)) return fail('시간');
  if (reason !== 0 && reason !== 1) return fail('종료 사유');
  if (typeof nick !== 'string' || nick.length > NICK_MAX * 2) return fail('닉네임');

  const items = [t, rf, sm, vol, loss] as number[];
  return {
    ok: true,
    record: {
      configVersion: cfgVer,
      total: total as number,
      items: Object.fromEntries(SCORE_ITEMS.map((k, i) => [k, items[i] / 10])) as Record<ScoreItem, number>,
      beerRatio: (br as number) / 1000,
      fill: (fill as number) / 1000,
      spillBeerMl: (sb as number) / 10,
      spillFoamMl: (sf as number) / 10,
      timeSec: (time as number) / 100,
      endReason: reason === 1 ? 'spill' : 'flowBreak',
      nick: sanitizeNick(nick),
    },
  };
}

/** 제어 문자를 제거하고 길이를 제한한다. 화면에는 항상 textContent 로만 표시한다. */
export function sanitizeNick(nick: string): string {
  return Array.from(nick.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim())
    .slice(0, NICK_MAX)
    .join('');
}

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
