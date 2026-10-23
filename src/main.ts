import './style.css';
import { loadConfig } from './config';
import { GameController } from './core/game';
import type { Command } from './core/types';
import { InputAdapter } from './input/inputAdapter';
import { buildShareUrl, readShareFromHash, sanitizeNick, toSharedRecord, type SharedRecord } from './record/share';
import { safeStorage, submitBest } from './record/storage';
import { AudioEngine } from './view/audio';
import { VisualEffects } from './view/effects';
import { SceneRenderer } from './view/scene';
import { UILayer } from './view/ui';

const cfg = loadConfig();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const lowPower = window.matchMedia('(pointer: coarse)').matches;

let game = new GameController(cfg);
const renderer = new SceneRenderer($('stage'), cfg, game.geom, lowPower);
const effects = new VisualEffects(renderer.scene, lowPower ? 160 : 320);
const audio = new AudioEngine(safeStorage.get('muted') === '1', cfg.dispenser.nozzleY);
const ui = new UILayer(cfg);

let challenge: SharedRecord | null = null;
let resultShown = false;
let paused = false;

// ---- 공유 링크 / 도전 모드 ----
function readChallenge(): void {
  const r = readShareFromHash(location.hash);
  if (r === null) {
    challenge = null;
  } else if (r.ok) {
    challenge = r.record;
  } else {
    challenge = null;
    clearHash();
    ui.toast('공유 링크가 손상되었거나 올바르지 않습니다. 일반 모드로 시작합니다.');
  }
  ui.showChallengeBanner(challenge);
}

function clearHash(): void {
  history.replaceState(null, '', location.pathname + location.search);
}

$('btn-challenge-exit').addEventListener('click', () => {
  challenge = null;
  clearHash();
  ui.showChallengeBanner(null);
});
window.addEventListener('hashchange', () => {
  readChallenge();
  restart();
});

// ---- 게임 진행 ----
function restart(): void {
  game = new GameController(cfg);
  effects.clear();
  resultShown = false;
  ui.hideResult();
}

function modalOpen(): boolean {
  return !$('help').hidden;
}

function handleCommand(cmd: Command): void {
  if (paused) {
    resume();
    return;
  }
  if (modalOpen()) return;
  game.enqueue(cmd);
}

function handleRestartKey(): void {
  if (paused) return resume();
  if (modalOpen()) return closeHelp();
  if (game.phase === 'result' && resultShown) restart();
}

const input = new InputAdapter(cfg.controls, handleCommand, handleRestartKey, () => audio.unlock());
document.querySelectorAll<HTMLButtonElement>('#controls [data-cmd]').forEach((b) => input.bindButton(b, b.dataset.cmd as Command));

// ---- 도움말 / 일시정지 / 소리 ----
function openHelp(): void {
  $('help').hidden = false;
}
function closeHelp(): void {
  $('help').hidden = true;
  safeStorage.set('seenHelp', '1');
  audio.unlock();
}
$('btn-help').addEventListener('click', openHelp);
$('btn-help-close').addEventListener('click', closeHelp);
if (safeStorage.get('seenHelp') !== '1') openHelp();

function resume(): void {
  paused = false;
  $('pause').hidden = true;
  lastTime = performance.now();
}
$('btn-resume').addEventListener('click', resume);
document.addEventListener('visibilitychange', () => {
  // 탭이 가려지면 시뮬레이션과 시간 측정을 멈춘다. 복귀 후 누적 시간이 한꺼번에 계산되지 않는다.
  if (document.hidden && (game.phase === 'pouring' || game.phase === 'ended')) {
    paused = true;
    $('pause').hidden = false;
  }
});

const soundBtn = $('btn-sound');
const renderSound = () => (soundBtn.textContent = audio.muted ? '🔇' : '🔊');
renderSound();
soundBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  safeStorage.set('muted', audio.muted ? '1' : '0');
  renderSound();
});

// ---- 결과 / 공유 ----
const nickInput = $<HTMLInputElement>('nick-input');
nickInput.value = safeStorage.get('nick') ?? '';
nickInput.addEventListener('change', () => {
  nickInput.value = sanitizeNick(nickInput.value);
  safeStorage.set('nick', nickInput.value);
});

$('btn-retry').addEventListener('click', restart);
$('btn-share').addEventListener('click', async () => {
  if (!game.result) return;
  const nick = sanitizeNick(nickInput.value);
  safeStorage.set('nick', nick);
  const url = buildShareUrl(location.href, toSharedRecord(game.result, nick));
  const text = `🍺 Perfect Pour에서 ${game.result.total}점(${game.result.title})을 받았어요! 도전해 보세요.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Perfect Pour', text, url });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    ui.toast('공유 링크를 복사했습니다.');
  } catch {
    const field = $<HTMLInputElement>('share-url');
    field.value = url;
    field.hidden = false;
    field.focus();
    field.select();
    ui.toast('링크를 복사해 친구에게 보내세요.');
  }
});

function onResult(): void {
  const r = game.result!;
  const best = submitBest(r);
  ui.showResult(r, best, challenge);
  resultShown = true;
}

// ---- 메인 루프: 고정 시간 간격 시뮬레이션 + 화면 주사율 렌더링 ----
const fpsEl = $('fps');
const showFps = new URLSearchParams(location.search).has('fps');
fpsEl.hidden = !showFps;
let lastTime = performance.now();
let acc = 0;
let fpsFrames = 0;
let fpsTime = 0;

function frame(now: number): void {
  const frameDt = Math.min(0.25, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const running = !paused && !modalOpen();
  if (running) {
    acc += frameDt;
    let steps = 0;
    while (acc >= game.dt && steps < cfg.simulation.maxStepsPerFrame) {
      game.step();
      acc -= game.dt;
      steps++;
    }
    // 기기가 너무 느리면 밀린 시간을 버린다(시뮬레이션 시간 기준이므로 결과에는 영향 없음).
    if (steps >= cfg.simulation.maxStepsPerFrame) acc = 0;
  }
  const events = game.events.splice(0);
  effects.update(running ? frameDt : 0, events, game);
  audio.update(game, events);
  ui.updateHud(game);
  renderer.render(game, frameDt);
  if (game.phase === 'result' && !resultShown) onResult();

  if (showFps) {
    fpsFrames++;
    fpsTime += frameDt;
    if (fpsTime >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  }
  requestAnimationFrame(frame);
}

readChallenge();
requestAnimationFrame(frame);
