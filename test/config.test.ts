import { describe, expect, it, vi } from 'vitest';
import { createConfig, DEFAULTS, localBackend, migrateV1, sanitize, siteKey, type Backend, type Config } from '../src/config';

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

function memoryBackend(initial: unknown = null) {
  let stored = initial;
  const write = vi.fn((c: Config) => { stored = c; });
  const backend: Backend = { read: () => stored, write };
  return { backend, write, stored: () => stored };
}

describe('설정', () => {
  it('손상된 값은 기본값으로', () => {
    expect(sanitize(null)).toEqual(DEFAULTS);
    expect(sanitize('x')).toEqual(DEFAULTS);
    const s = sanitize({ pipLongEdge: 'big', autoTabPip: 1, launcher: null, disabledSites: [1, '', 'a.com', 'a.com'] });
    expect(s).toEqual({ ...DEFAULTS, disabledSites: ['a.com'] });
  });

  it('창 크기는 범위 안으로', () => {
    expect(sanitize({ pipLongEdge: 10 }).pipLongEdge).toBe(240);
    expect(sanitize({ pipLongEdge: 99999 }).pipLongEdge).toBe(1920);
    expect(sanitize({ pipLongEdge: 640.6 }).pipLongEdge).toBe(641);
  });

  it('사이트 키는 www. · m. 를 뗀다', () => {
    expect(siteKey('www.YouTube.com')).toBe('youtube.com');
    expect(siteKey('m.youtube.com')).toBe('youtube.com');
    expect(siteKey('tv.naver.com')).toBe('tv.naver.com');
  });

  it('v1 설정은 남은 기능 값만 옮기고 v1 키를 지운다', () => {
    expect(migrateV1({ pipSize: { w: 320, h: 180 }, autoPip: true, onboarded: true, zoom: 2 }))
      .toEqual({ pipLongEdge: 320, autoTabPip: true, hinted: true });
    const v1 = memoryStorage({ __videoPip_cfg: JSON.stringify({ pipSize: { w: 900, h: 506 }, autoPip: true }) });
    const mem = memoryBackend();
    const cfg = createConfig(mem.backend, 'youtube.com', v1);
    expect(cfg.get().pipLongEdge).toBe(900);
    expect(cfg.get().autoTabPip).toBe(true);
    expect(v1.getItem('__videoPip_cfg')).toBeNull();
    expect(mem.write).toHaveBeenCalledTimes(1); // 즉시 저장(v1 키를 지웠으니)
  });

  it('v2 저장본이 있으면 v1은 무시한다', () => {
    const v1 = memoryStorage({ __videoPip_cfg: JSON.stringify({ autoPip: true }) });
    const cfg = createConfig(memoryBackend({ ...DEFAULTS, launcher: false }).backend, 'a.com', v1);
    expect(cfg.get().autoTabPip).toBe(false);
    expect(cfg.get().launcher).toBe(false);
    expect(v1.getItem('__videoPip_cfg')).not.toBeNull();
  });

  it('저장은 묶어서 한 번, flush로 즉시', () => {
    const mem = memoryBackend();
    const cfg = createConfig(mem.backend, 'a.com', null);
    cfg.set({ pipLongEdge: 500 });
    cfg.set({ pipLongEdge: 600 });
    expect(mem.write).not.toHaveBeenCalled();
    cfg.flush();
    expect(mem.write).toHaveBeenCalledTimes(1);
    expect((mem.stored() as Config).pipLongEdge).toBe(600);
  });

  it('이 사이트 끄기/켜기와 구독', () => {
    const cfg = createConfig(memoryBackend().backend, 'a.com', null);
    const seen = vi.fn();
    cfg.subscribe(seen);
    cfg.setSiteDisabled(true);
    expect(cfg.siteDisabled()).toBe(true);
    expect(cfg.get().disabledSites).toEqual(['a.com']);
    cfg.setSiteDisabled(false);
    expect(cfg.siteDisabled()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('localStorage 백엔드: 없으면 null, 깨졌으면 기본값', () => {
    const s = memoryStorage();
    const b = localBackend(s);
    expect(b.read()).toBeNull();
    s.setItem('vpip:v2', '{broken');
    expect(sanitize(b.read())).toEqual(DEFAULTS);
    b.write({ ...DEFAULTS, launcher: false });
    expect(JSON.parse(s.getItem('vpip:v2')!).launcher).toBe(false);
  });
});
