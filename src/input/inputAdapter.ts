import type { BalanceConfig } from '../config';
import type { Command } from '../core/types';

/**
 * 키보드·모바일 버튼 입력을 동일한 Command 로 변환한다 (FR-002).
 * - 키 반복(auto-repeat) 이벤트는 무시한다.
 * - 한글 IME 상태에서도 동작하도록 event.key 가 아닌 event.code 로 매핑한다.
 * - 이벤트 발생 즉시 콜백으로 넘겨 게임 큐에 순서대로 적재한다.
 */
export class InputAdapter {
  private readonly keyMap = new Map<string, Command>();
  private readonly restartKeys: Set<string>;

  constructor(
    controls: BalanceConfig['controls'],
    private readonly onCommand: (cmd: Command) => void,
    private readonly onRestartKey: () => void,
    private readonly onAnyInput: () => void,
  ) {
    for (const [cmd, codes] of Object.entries(controls.keys) as Array<[Command, string[]]>) {
      for (const code of codes) this.keyMap.set(code, cmd);
    }
    this.restartKeys = new Set(controls.restartKeys);
    window.addEventListener('keydown', this.onKeyDown);
  }

  keyFor(cmd: Command): string {
    for (const [code, c] of this.keyMap) if (c === cmd) return code.replace(/^Key/, '');
    return '';
  }

  /** 화면 버튼 연결. pointerdown 1회 = 1단계, 누르고 있어도 반복되지 않는다. */
  bindButton(el: HTMLElement, cmd: Command): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('pressed');
      this.onAnyInput();
      this.onCommand(cmd);
    });
    const release = () => el.classList.remove('pressed');
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cmd = this.keyMap.get(e.code);
    const isRestart = this.restartKeys.has(e.code);
    if (!cmd && !isRestart) return;
    e.preventDefault();
    if (e.repeat) return;
    this.onAnyInput();
    if (cmd) this.onCommand(cmd);
    if (isRestart) this.onRestartKey();
  };
}
