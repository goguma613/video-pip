import { describe, expect, it, vi } from 'vitest';
import * as dock from '../src/dock';

function rect(w: number, h: number) {
  return () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

function page(style = '') {
  const box = document.createElement('div');
  const before = document.createElement('i');
  const video = document.createElement('video');
  const after = document.createElement('b');
  if (style) video.setAttribute('style', style);
  video.className = 'site-video';
  video.getBoundingClientRect = rect(640, 360);
  box.append(before, video, after);
  document.body.replaceChildren(box);
  const slot = document.implementation.createHTMLDocument('pip').body;
  return { box, before, video, after, slot };
}

describe('Dock', () => {
  it('흐름 안의 영상은 같은 크기의 빈 상자로 자리를 지킨다', () => {
    const p = page();
    const t = dock.detach(p.video);
    dock.moveTo(t, p.slot);
    const spacer = p.box.querySelector<HTMLElement>('[data-video-pip-spacer]');
    expect(spacer).not.toBeNull();
    expect(spacer!.style.width).toBe('640px');
    expect(spacer!.style.height).toBe('360px');
    expect(p.video.parentNode).toBe(p.slot);
  });

  it('absolute 영상은 빈 상자를 넣지 않는다', () => {
    const p = page('position:absolute;left:0;top:0;width:640px;height:360px');
    const t = dock.detach(p.video);
    expect(t.spacer).toBeNull();
  });

  it('복원하면 DOM이 처음과 똑같고, 영상의 style·class는 그대로다', () => {
    const p = page('position:absolute;width:1280px;height:720px');
    const before = p.box.innerHTML;
    const t = dock.detach(p.video);
    dock.moveTo(t, p.slot);
    dock.restore(t);
    expect(p.box.innerHTML).toBe(before);
    expect(p.video.getAttribute('style')).toBe('position:absolute;width:1280px;height:720px');
    expect(p.video.className).toBe('site-video');
  });

  it('복원은 멱등이다', () => {
    const p = page();
    const t = dock.detach(p.video);
    dock.moveTo(t, p.slot);
    dock.restore(t);
    dock.restore(t);
    expect(p.box.querySelectorAll('video')).toHaveLength(1);
  });

  it('표식이 지워졌으면 원래 부모 끝에 넣는다', () => {
    const p = page();
    const t = dock.detach(p.video);
    dock.moveTo(t, p.slot);
    t.anchor.remove();
    dock.restore(t);
    expect(p.video.parentNode).toBe(p.box);
    expect(p.box.lastChild).toBe(p.video);
  });

  it('원래 자리가 통째로 사라졌으면 영상을 놓아준다', () => {
    const p = page();
    const t = dock.detach(p.video);
    dock.moveTo(t, p.slot);
    t.anchor.remove();
    p.box.remove();
    dock.restore(t);
    expect(p.video.isConnected).toBe(false);
  });

  it('보이지 않는 자리로 돌아가면 영상을 멈추고 알린다(화면 없이 소리만 나는 것 방지)', () => {
    const p = page();
    Object.defineProperty(p.video, 'paused', { configurable: true, value: false });
    const pause = vi.fn(() => Object.defineProperty(p.video, 'paused', { configurable: true, value: true }));
    p.video.pause = pause;
    p.video.checkVisibility = () => false; // 예: 유튜브 홈에 있는 동안 숨겨진 시청 화면
    const t = dock.detach(p.video);
    dock.moveTo(t, p.slot);
    expect(dock.restore(t)).toEqual({ wasPlaying: true, hidden: true });
    expect(pause).toHaveBeenCalled();
  });

  it('보이는 자리로 돌아가면 멈추지 않는다', () => {
    const p = page();
    Object.defineProperty(p.video, 'paused', { configurable: true, value: false });
    const pause = vi.fn();
    p.video.pause = pause;
    p.video.checkVisibility = () => true;
    const t = dock.detach(p.video);
    dock.moveTo(t, p.slot);
    expect(dock.restore(t)).toEqual({ wasPlaying: true, hidden: false });
    expect(pause).not.toHaveBeenCalled();
  });

  it('붙어 있지 않은 영상은 거부한다', () => {
    expect(() => dock.detach(document.createElement('video'))).toThrow();
  });
});
