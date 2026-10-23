import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodeRecord, encodeRecord, readShareFromHash, sanitizeNick, type SharedRecord } from '../src/record/share';

const rec: SharedRecord = {
  configVersion: '1.0.0',
  total: 873,
  items: { temperature: 100, refreshment: 66.3, smoothness: 99.9, volume: 82.1, loss: 91.5 },
  beerRatio: 0.703,
  fill: 0.894,
  spillBeerMl: 0.4,
  spillFoamMl: 1.2,
  timeSec: 9.87,
  endReason: 'flowBreak',
  nick: '맥주왕',
};

describe('공유 URL', () => {
  it('인코딩 → 디코딩 왕복', () => {
    const r = decodeRecord(encodeRecord(rec));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record).toEqual(rec);
  });

  it('fragment 에서 읽는다', () => {
    const url = buildShareUrl('https://example.github.io/perfect-pour/#old', rec);
    expect(url.startsWith('https://example.github.io/perfect-pour/#r=')).toBe(true);
    const r = readShareFromHash(new URL(url).hash);
    expect(r?.ok).toBe(true);
    expect(readShareFromHash('')).toBeNull();
  });

  it('손상·변조된 데이터는 거부한다', () => {
    const p = encodeRecord(rec);
    expect(decodeRecord(p.slice(0, -1)).ok).toBe(false);
    expect(decodeRecord('A' + p).ok).toBe(false);
    expect(decodeRecord('garbage').ok).toBe(false);
    expect(decodeRecord('').ok).toBe(false);
    expect(decodeRecord('x'.repeat(5000)).ok).toBe(false);
  });

  it('체크섬이 맞아도 범위 밖 값은 거부한다', () => {
    const bad = encodeRecord({ ...rec, total: 5000 });
    expect(decodeRecord(bad).ok).toBe(false);
  });

  it('닉네임의 제어 문자를 제거하고 길이를 제한한다', () => {
    expect(sanitizeNick('  a\u0000b\u202ec  ')).toBe('abc');
    expect(sanitizeNick('가'.repeat(30)).length).toBe(12);
  });
});
