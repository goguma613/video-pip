import { describe, expect, it, vi } from 'vitest';
import { comboOf, createKeymap, isEditable, keyLabel, type Command } from '../src/commands';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

function keymap() {
  const toggle = vi.fn(), play = vi.fn(), seek = vi.fn();
  const cmds: Command[] = [
    { id: 'pip.toggle', label: 'PIP 켜기/끄기', keys: ['Alt+KeyP'], scope: 'global', run: toggle },
    { id: 'play', label: '재생/일시정지', keys: ['Space', 'KeyK'], scope: 'player', run: play },
    { id: 'fwd5', label: '5초 앞으로', keys: ['ArrowRight'], scope: 'player', repeat: true, run: seek },
  ];
  return { km: createKeymap(cmds), toggle, play, seek };
}

describe('단축키', () => {
  it('e.code로 매칭해 한글 입력 상태에서도 동작한다', () => {
    expect(comboOf(key({ code: 'KeyK', key: 'ㅏ' }))).toBe('KeyK');
    expect(comboOf(key({ code: 'KeyP', key: 'ㅔ', altKey: true }))).toBe('Alt+KeyP');
    expect(comboOf(key({ code: 'KeyP', key: 'π', altKey: true }))).toBe('Alt+KeyP'); // macOS Option+P
  });

  it('페이지(global)에서는 전역 명령만, PiP 창(player)에서는 전부', () => {
    const { km, toggle, play } = keymap();
    expect(km.handle(key({ code: 'KeyK' }), 'global')).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(km.handle(key({ code: 'KeyP', altKey: true }), 'global')).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(km.handle(key({ code: 'KeyK' }), 'player')).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('처리한 키는 기본 동작을 막는다', () => {
    const { km } = keymap();
    const e = key({ code: 'Space' });
    km.handle(e, 'player');
    expect(e.defaultPrevented).toBe(true);
  });

  it('입력창에서는 무시한다', () => {
    const { km, toggle } = keymap();
    const input = document.createElement('input');
    document.body.append(input);
    const e = key({ code: 'KeyP', altKey: true });
    input.dispatchEvent(e);
    expect(km.handle(e, 'global')).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
    expect(isEditable(input)).toBe(true);
    const range = document.createElement('input');
    range.type = 'range';
    expect(isEditable(range)).toBe(false);
  });

  it('누르고 있을 때 반복은 허용된 명령만', () => {
    const { km, toggle, seek } = keymap();
    km.handle(key({ code: 'KeyP', altKey: true, repeat: true }), 'global');
    expect(toggle).not.toHaveBeenCalled();
    km.handle(key({ code: 'ArrowRight', repeat: true }), 'player');
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it('툴팁 문구와 키 표기', () => {
    const { km } = keymap();
    expect(km.hint('play')).toBe('재생/일시정지 (Space / K)');
    expect(keyLabel('Alt+KeyP')).toBe('Alt+P');
    expect(keyLabel('BracketLeft')).toBe('[');
    expect(keyLabel('ArrowLeft')).toBe('←');
  });
});
