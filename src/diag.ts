// 진단 기록 — 사이트가 페이지 이동 때 영상/플레이어에 무엇을 하는지 콘솔에 남긴다.
// 켜기: 해당 사이트에서 개발자 도구 콘솔에 localStorage.setItem('vpip:debug', '1') 입력 후 새로고침
// 끄기: localStorage.removeItem('vpip:debug')

const enabled = (() => {
  try { return localStorage.getItem('vpip:debug') === '1'; } catch { return false; }
})();

let t0 = Date.now();
let tracing = false; // 기록 중에 또 이동하면 겹쳐 감싸지 않는다

export function debugLog(...args: unknown[]): void {
  if (enabled) console.log('[video-pip][진단]', `+${Date.now() - t0}ms`, ...args);
}

const short = (x: unknown): unknown => {
  if (typeof x === 'string') return x.length > 80 ? `${x.slice(0, 80)}…` : x;
  if (x && typeof x === 'object') return Object.prototype.toString.call(x);
  return x;
};

/** 페이지 이동 직후 ms 동안 영상 요소와 사이트 플레이어 객체에 대한 호출을 기록한다. */
export function traceNavigation(video: HTMLVideoElement | null, player: object | null, ms = 6000): void {
  if (!enabled) return;
  if (tracing) { debugLog('페이지 이동(기록 중)', location.href); return; }
  tracing = true;
  t0 = Date.now();
  debugLog('페이지 이동 시작', location.href, video
    ? { paused: video.paused, readyState: video.readyState, src: short(video.currentSrc) }
    : 'PiP 영상 없음');
  const undo: (() => void)[] = [];
  if (video) {
    const state = () => ({ paused: video.paused, readyState: video.readyState, src: short(video.currentSrc) });
    for (const type of ['pause', 'play', 'emptied', 'abort', 'loadstart', 'error', 'ended', 'waiting']) {
      const fn = () => debugLog(`영상 이벤트 ${type}`, state());
      video.addEventListener(type, fn);
      undo.push(() => video.removeEventListener(type, fn));
    }
    const v = video as unknown as Record<string, unknown>;
    for (const name of ['pause', 'play', 'load', 'removeAttribute', 'setAttribute']) {
      const orig = v[name] as (...a: unknown[]) => unknown;
      v[name] = function (this: unknown, ...a: unknown[]) {
        debugLog(`video.${name}(`, ...a.map(short), ')');
        return orig.apply(this, a);
      };
      undo.push(() => { delete v[name]; });
    }
    for (const prop of ['src', 'srcObject'] as const) {
      const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, prop);
      if (!d?.get || !d.set) continue;
      Object.defineProperty(video, prop, {
        configurable: true,
        get() { return d.get!.call(this); },
        set(x) { debugLog(`video.${prop} =`, short(x)); d.set!.call(this, x); },
      });
      undo.push(() => { delete v[prop]; });
    }
  }
  if (player) {
    const p = player as Record<string, unknown>;
    for (const k of Object.getOwnPropertyNames(p)) {
      const fn = p[k];
      if (typeof fn !== 'function' || /^(get|is|has|add|remove|dispatch)/.test(k)) continue;
      try {
        p[k] = function (this: unknown, ...a: unknown[]) {
          debugLog(`player.${k}(`, ...a.map(short), ')');
          return (fn as (...x: unknown[]) => unknown).apply(this, a);
        };
        undo.push(() => { p[k] = fn; });
      } catch { /* 쓸 수 없는 속성 */ }
    }
  }
  setTimeout(() => {
    undo.forEach((f) => f());
    tracing = false;
    debugLog('진단 끝 — 위의 [video-pip][진단] 줄들을 복사해서 보내 주세요');
  }, ms);
}
