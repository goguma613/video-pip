import { describe, expect, it, vi } from 'vitest';
import { createConfig, sanitize, type Backend, type Config } from '../src/config';
import { createQuality, resolutionLabel } from '../src/quality';
import type { QualityLevel, SiteAdapter } from '../src/sites';

describe('해상도 이름', () => {
  it.each([
    [1920, 1080, '1080p'], [3840, 2160, '4K'], [7680, 4320, '8K'], [2560, 1440, '1440p'],
    [1280, 720, '720p'], [854, 480, '480p'], [640, 360, '360p'], [426, 240, '240p'],
    [1080, 1920, '1080p'],  // 세로(쇼츠)
    [1920, 800, '1080p'],   // 시네마 비율
    [1916, 1076, '1080p'],  // 살짝 모자란 크기
    [320, 180, '180p'],
    [0, 0, ''],
  ])('%i×%i → %s', (w, h, label) => {
    expect(resolutionLabel(w, h)).toBe(label);
  });
});

function setup(opts: { levels?: QualityLevel[]; supported?: boolean } = {}) {
  let stored: unknown = null;
  const backend: Backend = { read: () => stored, write: (c: Config) => { stored = c; } };
  const config = createConfig(backend, 'youtube.com', null);
  let levels = opts.levels ?? [{ id: 'hd2160', label: '2160p' }, { id: 'hd1080', label: '1080p' }, { id: 'hd720', label: '720p' }];
  const setQuality = vi.fn(() => true);
  const adapter: SiteAdapter = opts.supported === false
    ? { id: 'generic', title: () => '' }
    : { id: 'youtube', title: () => '', qualityLevels: () => levels, setQuality };
  let key = 'video-1';
  const q = createQuality(adapter, config, () => null, () => key);
  return {
    q, config, setQuality,
    setLevels: (l: QualityLevel[]) => { levels = l; },
    nextVideo: (k: string) => { key = k; },
  };
}

describe('화질 고르기', () => {
  it('화질을 바꿀 수 없는 사이트에선 아무것도 하지 않는다', () => {
    const t = setup({ supported: false });
    expect(t.q.supported()).toBe(false);
    expect(t.q.levels()).toEqual([]);
    t.q.choose('max');
    expect(t.config.get().quality).toBe('auto');
  });

  it('"최고 화질"은 지금 영상의 가장 높은 화질로 바꾸고 선호로 기억한다', () => {
    const t = setup();
    t.q.choose('max');
    expect(t.setQuality).toHaveBeenLastCalledWith(null, 'hd2160');
    expect(t.config.get().quality).toBe('max');
    expect(t.q.choice()).toBe('max');
  });

  it('특정 화질은 지금 영상에만 적용되고, 다음 영상부턴 선호(최고 화질)로 돌아간다', () => {
    const t = setup();
    t.q.choose('max');
    t.q.choose('hd720');
    expect(t.setQuality).toHaveBeenLastCalledWith(null, 'hd720');
    expect(t.q.choice()).toBe('hd720');
    expect(t.config.get().quality).toBe('max');
    t.q.ensure(); // 같은 영상 — 고른 화질을 덮어쓰지 않음
    expect(t.setQuality).toHaveBeenLastCalledWith(null, 'hd720');
    t.nextVideo('video-2');
    t.q.loaded();
    expect(t.q.choice()).toBe('max');
    t.q.ensure();
    expect(t.setQuality).toHaveBeenLastCalledWith(null, 'hd2160');
  });

  it('"항상 최고 화질"은 화질 목록이 준비되면 불러올 때마다 한 번 적용한다', () => {
    const t = setup({ levels: [] });
    t.config.set({ quality: 'max' });
    t.q.loaded();
    t.q.ensure();
    expect(t.setQuality).not.toHaveBeenCalled(); // 목록이 아직 없음
    t.setLevels([{ id: 'hd1080', label: '1080p60' }, { id: 'hd720', label: '720p' }]);
    t.q.ensure();
    t.q.ensure();
    expect(t.setQuality).toHaveBeenCalledTimes(1);
    expect(t.setQuality).toHaveBeenLastCalledWith(null, 'hd1080');
  });

  it('같은 영상을 다시 불러오면(유튜브 홈 이동 후 다시 불러오기) 고른 화질을 다시 맞춘다', () => {
    const t = setup();
    t.q.choose('hd720');
    t.q.loaded();       // 사이트가 다시 불러오며 "자동"으로 되돌림
    t.q.ensure();
    expect(t.setQuality).toHaveBeenCalledTimes(2);
    expect(t.setQuality).toHaveBeenLastCalledWith(null, 'hd720');
  });

  it('사이트가 계속 되돌려도 영상 하나에 3번까지만 다시 맞춘다', () => {
    const t = setup();
    t.config.set({ quality: 'max' });
    for (let i = 0; i < 10; i++) { t.q.loaded(); t.q.ensure(); }
    expect(t.setQuality).toHaveBeenCalledTimes(3);
    t.q.loaded(true); // PiP를 새로 열면 다시 맞출 수 있다
    t.q.ensure();
    expect(t.setQuality).toHaveBeenCalledTimes(4);
  });

  it('"자동"이면 사이트에 맡긴다', () => {
    const t = setup();
    t.q.choose('max');
    t.q.choose('auto');
    expect(t.setQuality).toHaveBeenLastCalledWith(null, 'auto');
    expect(t.config.get().quality).toBe('auto');
    t.nextVideo('video-2');
    t.q.loaded();
    t.q.ensure();
    expect(t.setQuality).toHaveBeenCalledTimes(2); // 자동일 땐 영상이 바뀌어도 건드리지 않음
  });

  it('설정값 검증', () => {
    expect(sanitize({ quality: 'max' }).quality).toBe('max');
    expect(sanitize({ quality: 'hd1080' }).quality).toBe('auto');
  });
});
