import type { GameController } from '../core/game';
import type { SimEvent } from '../core/types';

/**
 * 효과음 (Web Audio 합성, 외부 음원 파일 없음).
 * - 따르는 소리: 필터링한 잡음. 유량이 클수록 크고, 잔이 찰수록(낙하 거리가 짧을수록) 음이 높아진다.
 * - 결과 효과음: 완료 차임 / 유출 경고음.
 * 브라우저 자동재생 정책 때문에 첫 사용자 입력 시점에 초기화한다.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private pourGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  muted: boolean;

  constructor(muted: boolean, private readonly nozzleY: number) {
    this.muted = muted;
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.8;
      master.connect(ctx.destination);

      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = 0.97 * last + 0.03 * (Math.random() * 2 - 1);
        data[i] = last * 6;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.4;
      filter.frequency.value = 500;
      const pourGain = ctx.createGain();
      pourGain.gain.value = 0;
      src.connect(filter).connect(pourGain).connect(master);
      src.start();

      this.ctx = ctx;
      this.master = master;
      this.filter = filter;
      this.pourGain = pourGain;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  update(game: GameController, events: SimEvent[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.pourGain || !this.filter) return;
    const flowing = game.flow.parcels.length > 0 && game.flow.isFlowing;
    const vol = flowing ? Math.min(0.5, 0.08 + game.flow.totalFlow / 120) : 0;
    this.pourGain.gain.setTargetAtTime(vol, ctx.currentTime, 0.06);
    const drop = Math.max(0, this.nozzleY - game.surface.surfaceY);
    this.filter.frequency.setTargetAtTime(350 + 2200 * Math.max(0, 1 - drop / this.nozzleY), ctx.currentTime, 0.1);

    for (const e of events) {
      if (e.kind === 'phase' && e.phase === 'result') {
        if (game.endReason === 'spill') this.tone([220, 165], 0.18, 'sawtooth');
        else this.tone([660, 880, 1320], 0.12, 'sine');
      }
      if (e.kind === 'ignored') this.tone([140], 0.05, 'square', 0.05);
    }
  }

  private tone(freqs: number[], dur: number, type: OscillatorType, gain = 0.15): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    freqs.forEach((f, i) => {
      const t0 = ctx.currentTime + i * dur * 0.9;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 1.6);
      osc.connect(g).connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + dur * 1.7);
    });
  }
}
