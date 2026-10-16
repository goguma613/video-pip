export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: A | null = null;
  const run = () => {
    clearTimeout(timer);
    timer = undefined;
    if (last) { const a = last; last = null; fn(...a); }
  };
  const d = ((...args: A) => {
    last = args;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;
  d.flush = run;
  return d;
}

export function warn(...args: unknown[]): void {
  console.warn('[video-pip]', ...args);
}

export function isTopFrame(): boolean {
  try { return window.top === window; } catch { return false; }
}

/** 긴 변 = 기억한 크기, 짧은 변 = 영상 비율. 화면의 90%를 넘지 않게. */
export function pipWindowSize(v: HTMLVideoElement, longEdge: number): { width: number; height: number } {
  const ar = v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
  let w = ar >= 1 ? longEdge : longEdge * ar;
  let h = ar >= 1 ? longEdge / ar : longEdge;
  const k = Math.min(1, (screen.availWidth * 0.9) / w, (screen.availHeight * 0.9) / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}
