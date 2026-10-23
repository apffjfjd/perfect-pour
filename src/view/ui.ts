import type { BalanceConfig } from '../config';
import type { GameController } from '../core/game';
import { SCORE_ITEMS, SCORE_LABELS, maxTotal, titleFor, type ScoreResult } from '../core/score';
import type { SharedRecord } from '../record/share';
import type { BestRecord } from '../record/storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** 화면에 동적으로 넣는 모든 문자열은 textContent 로만 넣는다(XSS 방지). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export interface BestInfo {
  updated: boolean;
  previous: BestRecord | null;
  saved: boolean;
}

/** HTML/CSS 오버레이 UI: HUD, 결과 화면, 도전 비교, 안내 메시지 */
export class UILayer {
  private readonly leverCells: HTMLElement[] = [];
  private toastTimer = 0;

  constructor(private readonly cfg: BalanceConfig) {
    const gauge = $('lever-gauge');
    const beerSteps = cfg.lever.beerFlow.length;
    const foamSteps = cfg.lever.foamFlow.length;
    // 왼쪽 = 레버 위(거품), 오른쪽 = 레버 아래(맥주)
    for (let lv = foamSteps; lv >= -beerSteps; lv--) {
      const i = el('i', lv > 0 ? 'foam' : lv < 0 ? 'beer' : 'mid');
      i.dataset.level = String(lv);
      gauge.appendChild(i);
      this.leverCells.push(i);
    }
    $('result-max').textContent = `/ ${maxTotal(cfg.score)}`;
  }

  updateHud(game: GameController): void {
    $('hud-time').textContent = game.elapsed.toFixed(2);
    const lv = game.lever.level;
    for (const c of this.leverCells) {
      const l = Number(c.dataset.level);
      c.classList.toggle('on', lv === 0 ? l === 0 : Math.sign(l) === Math.sign(lv) && Math.abs(l) <= Math.abs(lv));
    }
    $('hud-tilt').textContent = `${game.glass.tiltStep * this.cfg.glass.tiltStepDeg}°`;
    $('hud-height').textContent = `${game.glass.heightStep + 1}/${this.cfg.glass.heightSteps}`;

    const rated = game.geom.ratedCapacity;
    const beerPct = (game.beer.beer / rated) * 100;
    const foamPct = (game.beer.foamVolume / rated) * 100;
    const beerEl = $('fill-beer');
    const foamEl = $('fill-foam');
    beerEl.style.width = `${Math.min(100, beerPct)}%`;
    foamEl.style.left = `${Math.min(100, beerPct)}%`;
    foamEl.style.width = `${Math.max(0, Math.min(100 - beerPct, foamPct))}%`;
    $('fill-text').textContent = `${Math.round(beerPct + foamPct)}%`;

    let status = '';
    if (game.phase === 'ready') status = lv === 0 ? '레버를 내려 따르기 시작' : '배출 준비 중…';
    else if (game.phase === 'pouring') status = game.flow.isFlowing ? (lv === 0 ? '흐름 유지 중 — 곧 끊깁니다' : '따르는 중') : '흐름 끊김';
    else if (game.phase === 'ended') status = game.endReason === 'spill' ? '흘렀습니다!' : '마무리 중…';
    $('hud-status').textContent = status;
  }

  showChallengeBanner(rec: SharedRecord | null): void {
    const banner = $('challenge-banner');
    if (!rec) {
      banner.hidden = true;
      return;
    }
    const text = banner.querySelector('.challenge-text')!;
    text.textContent = `🍺 ${rec.nick || '친구'}님의 기록 ${rec.total}점(${titleFor(rec.total, this.cfg.score.titles)})에 도전!`;
    banner.hidden = false;
  }

  toast(message: string, ms = 3500): void {
    const t = $('toast');
    t.textContent = message;
    t.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), ms);
  }

  showResult(r: ScoreResult, best: BestInfo, challenge: SharedRecord | null): void {
    const reason = $('result-reason');
    reason.textContent = r.endReason === 'spill' ? '잔 밖으로 흘렀습니다!' : '따르기 완료';
    reason.className = `result-reason ${r.endReason}`;
    $('result-title').textContent = r.title;
    $('result-total').textContent = String(r.total);

    const bestEl = $('result-best');
    bestEl.className = 'result-best';
    if (!best.saved) bestEl.textContent = '이 브라우저에서는 기록을 저장할 수 없습니다';
    else if (best.updated) {
      bestEl.textContent = best.previous ? `🎉 최고 기록 갱신! (이전 ${best.previous.result.total}점)` : '🎉 첫 기록이 저장되었습니다';
      bestEl.classList.add('new');
    } else if (best.previous) {
      const p = best.previous.result;
      const old = p.configVersion !== r.configVersion ? ` · 이전 밸런스 v${p.configVersion} 기록` : '';
      bestEl.textContent = `개인 최고 기록 ${p.total}점${old}`;
    } else bestEl.textContent = '';

    const items = $('result-items');
    items.replaceChildren();
    for (const k of SCORE_ITEMS) {
      const row = el('div', 'item-row');
      row.appendChild(el('span', '', SCORE_LABELS[k]));
      const bar = el('div', 'item-bar');
      const fill = el('i');
      fill.style.width = `${r.items[k]}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      const score = el('span', 'item-score');
      const w = this.cfg.score.weights[k];
      score.appendChild(el('b', '', String(Math.round((r.items[k] * w) / 100))));
      score.appendChild(document.createTextNode(` / ${w}`));
      row.appendChild(score);
      items.appendChild(row);
    }

    const metrics = $('result-metrics');
    metrics.replaceChildren();
    const beerPct = Math.round(r.beerRatio * 100);
    const add = (label: string, value: string) => {
      const m = el('div', 'metric');
      m.appendChild(el('span', '', label));
      m.appendChild(el('b', '', value));
      metrics.appendChild(m);
    };
    add('맥주 : 거품', r.beerRatio + r.foamRatio > 0 ? `${beerPct} : ${100 - beerPct}` : '-');
    add('충전율', `${Math.round(r.fill * 100)}%`);
    add('유출 (맥주 / 거품)', `${fmt1(r.spillBeerMl)} / ${fmt1(r.spillFoamMl)} ml`);
    add('소요 시간', `${r.timeSec.toFixed(2)}초`);

    this.renderCompare(r, challenge);
    $('share-url').hidden = true;
    $('result').hidden = false;
  }

  hideResult(): void {
    $('result').hidden = true;
  }

  private renderCompare(r: ScoreResult, c: SharedRecord | null): void {
    const box = $('result-compare');
    box.replaceChildren();
    if (!c) {
      box.hidden = true;
      return;
    }
    const name = c.nick || '친구';
    const verdict = r.total > c.total ? '승리! 🏆' : r.total < c.total ? '패배… 다시 도전해 보세요' : '무승부';
    box.appendChild(el('h3', '', `${name}님과의 대결: ${verdict}`));
    const table = el('table');
    const head = el('tr');
    for (const h of ['', '나', name]) head.appendChild(el('th', '', h));
    table.appendChild(head);
    const row = (label: string, mine: number, theirs: number, text: (x: number) => string, higherIsBetter = true) => {
      const tr = el('tr');
      tr.appendChild(el('td', '', label));
      const better = higherIsBetter ? mine > theirs : mine < theirs;
      const worse = higherIsBetter ? mine < theirs : mine > theirs;
      tr.appendChild(el('td', better ? 'win' : '', text(mine)));
      tr.appendChild(el('td', worse ? 'win' : '', text(theirs)));
      table.appendChild(tr);
    };
    row('총점', r.total, c.total, (x) => String(x));
    for (const k of SCORE_ITEMS) row(SCORE_LABELS[k], r.items[k], c.items[k], (x) => fmt1(x));
    row('소요 시간', r.timeSec, c.timeSec, (x) => `${x.toFixed(2)}초`, false);
    box.appendChild(table);
    if (c.configVersion !== r.configVersion) {
      box.appendChild(el('p', 'note', `상대 기록은 다른 밸런스 버전(v${c.configVersion})에서 만들어져 조건이 다를 수 있습니다.`));
    }
    box.hidden = false;
  }
}
