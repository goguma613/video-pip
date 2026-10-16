// 명령 표 — 버튼·단축키·툴팁이 모두 여기를 참조한다.
// 키는 e.code 기준("KeyK")이라 한/영 상태나 키보드 배열과 무관하다.
import * as media from './media';
import type { Session } from './session';

export type Scope = 'global' | 'player';

export interface Command {
  id: CommandId;
  label: string;
  keys: string[];
  /** global = 페이지에서도 동작(수정키 조합만), player = PiP 창 안에서만 */
  scope: Scope;
  /** 키를 누르고 있을 때 반복 실행 */
  repeat?: boolean;
  run(): void;
}

export type CommandId =
  | 'pip.toggle' | 'close' | 'play' | 'back5' | 'fwd5' | 'back10' | 'fwd10'
  | 'volUp' | 'volDown' | 'mute' | 'rateDown' | 'rateUp' | 'rateReset' | 'rateCycle';

export function buildCommands(session: Session): Command[] {
  const on = (fn: (v: HTMLVideoElement) => void) => () => {
    const v = session.video();
    if (v) fn(v);
  };
  return [
    { id: 'pip.toggle', label: 'PIP 켜기/끄기', keys: ['Alt+KeyP'], scope: 'global', run: () => void session.toggle() },
    { id: 'close', label: '닫기', keys: ['Escape'], scope: 'player', run: () => void session.close() },
    { id: 'play', label: '재생/일시정지', keys: ['Space', 'KeyK'], scope: 'player', run: on(media.togglePlay) },
    { id: 'back5', label: '5초 뒤로', keys: ['ArrowLeft'], scope: 'player', repeat: true, run: on((v) => media.seekBy(v, -5)) },
    { id: 'fwd5', label: '5초 앞으로', keys: ['ArrowRight'], scope: 'player', repeat: true, run: on((v) => media.seekBy(v, 5)) },
    { id: 'back10', label: '10초 뒤로', keys: ['KeyJ'], scope: 'player', repeat: true, run: on((v) => media.seekBy(v, -10)) },
    { id: 'fwd10', label: '10초 앞으로', keys: ['KeyL'], scope: 'player', repeat: true, run: on((v) => media.seekBy(v, 10)) },
    { id: 'volUp', label: '볼륨 올리기', keys: ['ArrowUp'], scope: 'player', repeat: true, run: on((v) => media.changeVolume(v, 0.05)) },
    { id: 'volDown', label: '볼륨 내리기', keys: ['ArrowDown'], scope: 'player', repeat: true, run: on((v) => media.changeVolume(v, -0.05)) },
    { id: 'mute', label: '음소거', keys: ['KeyM'], scope: 'player', run: on(media.toggleMute) },
    { id: 'rateDown', label: '배속 낮추기', keys: ['BracketLeft'], scope: 'player', repeat: true, run: on((v) => media.nudgeRate(v, -0.25)) },
    { id: 'rateUp', label: '배속 높이기', keys: ['BracketRight'], scope: 'player', repeat: true, run: on((v) => media.nudgeRate(v, 0.25)) },
    { id: 'rateReset', label: '배속 1배로', keys: ['Equal'], scope: 'player', run: on((v) => { v.playbackRate = 1; }) },
    { id: 'rateCycle', label: '배속 바꾸기', keys: [], scope: 'player', run: on(media.cycleRate) },
  ];
}

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.code || e.key);
  return parts.join('+');
}

const LABELS: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  BracketLeft: '[', BracketRight: ']', Equal: '=', Escape: 'Esc',
};

/** "Alt+KeyP" → "Alt+P" */
export function keyLabel(combo: string): string {
  return combo.split('+').map((p) => LABELS[p] ?? p.replace(/^(Key|Digit)/, '')).join('+');
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);

export function isEditable(t: EventTarget | null | undefined): boolean {
  const el = t as HTMLElement | null | undefined;
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && TEXT_INPUTS.has((el as HTMLInputElement).type);
}

export interface Keymap {
  /** 처리했으면 true */
  handle(e: KeyboardEvent, scope: Scope): boolean;
  run(id: CommandId): void;
  /** 툴팁용: "재생/일시정지 (Space)" */
  hint(id: CommandId): string;
}

export function createKeymap(commands: Command[]): Keymap {
  const byKey = new Map<string, Command>();
  const byId = new Map<CommandId, Command>();
  for (const c of commands) {
    byId.set(c.id, c);
    for (const k of c.keys) byKey.set(k, c);
  }
  return {
    handle(e, scope) {
      if (e.isComposing || isEditable(e.composedPath?.()[0] ?? e.target)) return false;
      const c = byKey.get(comboOf(e));
      if (!c || (scope === 'global' && c.scope !== 'global')) return false;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat || c.repeat) c.run();
      return true;
    },
    run(id) {
      byId.get(id)?.run();
    },
    hint(id) {
      const c = byId.get(id);
      if (!c) return '';
      return c.keys.length ? `${c.label} (${c.keys.map(keyLabel).join(' / ')})` : c.label;
    },
  };
}
