import { clamp, debounce, warn } from './util';

export interface Config {
  schema: 2;
  /** 마지막 PiP 창의 긴 변(px). 짧은 변은 영상 비율로 계산 */
  pipLongEdge: number;
  /** 탭 전환 시 자동 PIP */
  autoTabPip: boolean;
  /** 영상 위 ⧉ 버튼 표시 */
  launcher: boolean;
  /** 버튼·자동 PIP를 끈 사이트 (www. · m. 제거한 호스트) */
  disabledSites: string[];
  /** PiP 창 첫 진입 힌트를 보여 줬는지 */
  hinted: boolean;
}

export const DEFAULTS: Readonly<Config> = {
  schema: 2,
  pipLongEdge: 480,
  autoTabPip: false,
  launcher: true,
  disabledSites: [],
  hinted: false,
};

export const LONG_EDGE_MIN = 240;
export const LONG_EDGE_MAX = 1920;

const KEY = 'vpip:v2';
const V1_KEY = '__videoPip_cfg';

/** 손상되거나 낯선 값은 기본값으로 바꾼다. */
export function sanitize(raw: unknown): Config {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const sites = Array.isArray(r.disabledSites)
    ? r.disabledSites.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 256)
    : [];
  return {
    schema: 2,
    pipLongEdge: Math.round(clamp(num(r.pipLongEdge, DEFAULTS.pipLongEdge), LONG_EDGE_MIN, LONG_EDGE_MAX)),
    autoTabPip: bool(r.autoTabPip, DEFAULTS.autoTabPip),
    launcher: bool(r.launcher, DEFAULTS.launcher),
    disabledSites: [...new Set(sites)].slice(0, 500),
    hinted: bool(r.hinted, DEFAULTS.hinted),
  };
}

/** v1 저장본에서 v2에 남은 기능의 값만 옮긴다. */
export function migrateV1(raw: unknown): Partial<Config> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const out: Partial<Config> = {};
  const { w, h } = r.pipSize ?? {};
  if (typeof w === 'number' && typeof h === 'number') out.pipLongEdge = Math.max(w, h);
  if (typeof r.autoPip === 'boolean') out.autoTabPip = r.autoPip;
  if (typeof r.onboarded === 'boolean') out.hinted = r.onboarded;
  return out;
}

export function siteKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^(www|m)\./, '');
}

export interface Backend {
  /** 저장본이 없으면 null */
  read(): unknown;
  write(cfg: Config): void;
}

export function gmBackend(): Backend | null {
  if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') return null;
  const get = GM_getValue, set = GM_setValue;
  return { read: () => get(KEY, null), write: (cfg) => set(KEY, cfg) };
}

export function localBackend(storage: Storage | null): Backend {
  let memory: Config | null = null;
  return {
    read() {
      if (!storage) return memory;
      const s = storage.getItem(KEY);
      if (s == null) return null;
      try { return JSON.parse(s); } catch { return {}; }
    },
    write(cfg) {
      memory = cfg;
      try { storage?.setItem(KEY, JSON.stringify(cfg)); } catch (e) { warn('설정 저장 실패', e); }
    },
  };
}

export function safeLocalStorage(): Storage | null {
  try { const s = window.localStorage; s.getItem(KEY); return s; } catch { return null; }
}

export interface ConfigStore {
  get(): Readonly<Config>;
  set(patch: Partial<Config>): void;
  siteDisabled(): boolean;
  setSiteDisabled(off: boolean): void;
  subscribe(fn: (cfg: Readonly<Config>) => void): () => void;
  flush(): void;
}

/**
 * @param host  siteKey()로 정규화한 현재 사이트
 * @param v1    v1 설정이 있던 사이트 저장소(localStorage). 있으면 1회 이관 후 지운다.
 */
export function createConfig(backend: Backend, host: string, v1: Storage | null): ConfigStore {
  let raw: unknown = null;
  try { raw = backend.read(); } catch (e) { warn('설정 읽기 실패', e); }
  let migrated = false;
  if (raw == null && v1) {
    try {
      const old = v1.getItem(V1_KEY);
      if (old) {
        raw = { ...DEFAULTS, ...migrateV1(JSON.parse(old)) };
        v1.removeItem(V1_KEY);
        migrated = true;
      }
    } catch (e) { warn('v1 설정 이관 실패', e); }
  }
  let cfg = sanitize(raw);
  const subs = new Set<(c: Readonly<Config>) => void>();
  const save = debounce(() => backend.write(cfg), 300);
  if (migrated) backend.write(cfg);

  const set = (patch: Partial<Config>) => {
    cfg = sanitize({ ...cfg, ...patch });
    save();
    subs.forEach((fn) => { try { fn(cfg); } catch (e) { warn(e); } });
  };

  return {
    get: () => cfg,
    set,
    siteDisabled: () => cfg.disabledSites.includes(host),
    setSiteDisabled(off) {
      const rest = cfg.disabledSites.filter((s) => s !== host);
      set({ disabledSites: off ? [...rest, host] : rest });
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    flush: () => save.flush(),
  };
}
