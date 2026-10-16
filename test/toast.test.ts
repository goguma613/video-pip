import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../src/launcher';

const box = () => document.querySelector('video-pip-ui')!.shadowRoot!.querySelector<HTMLElement>('.toast')!;
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => { vi.useFakeTimers(); setHidden(false); });
afterEach(() => { vi.useRealTimers(); });

describe('알림', () => {
  it('보이고, 시간이 지나면 사라진다', () => {
    toast(document, '안녕');
    expect(box().classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(3300);
    expect(box().classList.contains('show')).toBe(false);
  });

  it('다른 탭에 있을 땐 미뤘다가 탭이 보일 때 띄우고 그때부터 시간을 잰다', () => {
    setHidden(true);
    toast(document, '나중에', { label: '가기', run: () => {} });
    vi.advanceTimersByTime(60_000); // 다른 탭에 오래 있어도
    expect(box().classList.contains('show')).toBe(false);
    setHidden(false);               // 돌아오면 그제야 보이고
    expect(box().classList.contains('show')).toBe(true);
    expect(box().textContent).toContain('나중에');
    vi.advanceTimersByTime(7100);   // 정해진 시간 뒤 사라진다(영영 남지 않음)
    expect(box().classList.contains('show')).toBe(false);
  });

  it('버튼을 누르면 실행하고 닫힌다', () => {
    const run = vi.fn();
    toast(document, '알림', { label: '실행', run });
    box().querySelector<HTMLButtonElement>('.tbtn')!.click();
    expect(run).toHaveBeenCalled();
    expect(box().classList.contains('show')).toBe(false);
  });
});
