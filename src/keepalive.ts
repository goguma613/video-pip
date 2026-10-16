// 사이트 이동 중 PiP 영상 지키기.
// 유튜브는 PiP로 보다가 홈·검색 등으로 가면 영상을 멈추거나 아예 비운다(진단 기록으로 확인:
// 이동 약 1.3초 뒤 src 제거 + srcObject = null + load()).
//  · 멈추기만 하면 → 이어서 재생(resume)
//  · 비우면 → 같은 플레이어에 같은 영상을 보던 위치부터 다시 불러온다(revive)
// 이동 직전에 재생 중이었고, 영상 페이지가 아닌 곳으로 갔고, 사용자가 PiP 창에서 방금 조작하지 않았을 때만.
import { debugLog, traceNavigation } from './diag';
import type { Session } from './session';
import type { SiteAdapter } from './sites';

export interface KeepAlive {
  /** PiP 창 문서에 영상 이벤트·사용자 조작 감시를 붙인다 */
  attach(pipDoc: Document): void;
}

export function startKeepAlive(session: Session, adapter: SiteAdapter): KeepAlive {
  // 이동 시작을 알 수 없는 사이트(일반)는 할 일이 없다
  if (!adapter.onNavigateStart || !adapter.isVideoPage) return { attach() {} };
  const isVideoPage = adapter.isVideoPage;

  let nav = { at: 0, playing: false, toVideo: false, resumes: 0, revives: 0, id: null as string | null };
  let inputAt = 0;   // PiP 창에서 사용자가 마지막으로 조작한 시각
  let lastTime = 0;  // 비워지기 직전의 재생 위치
  let reviveTimer: ReturnType<typeof setTimeout> | undefined;

  const pipVideo = () => (session.mode() === 'doc' ? session.video() : null);
  const fresh = (ms: number) => Date.now() - nav.at < ms;
  const userJustActed = () => Date.now() - inputAt < 1000;
  const offVideoPage = () => !nav.toVideo && !isVideoPage(location.pathname);

  adapter.onNavigateStart((dest) => {
    const v = pipVideo();
    nav = {
      at: Date.now(),
      playing: !!v && !v.paused && !v.ended,
      toVideo: dest != null && isVideoPage(dest),
      resumes: 0,
      revives: 0,
      id: v ? adapter.videoId?.(session.home()) ?? null : null,
    };
    if (!v) return;
    lastTime = v.currentTime;
    traceNavigation(v, adapter.player?.() ?? null);
    debugLog('PiP 상태', { id: nav.id, playing: nav.playing, toVideo: nav.toVideo, dest });
  });

  function resume(): void {
    const v = pipVideo();
    if (!v || !nav.playing || !v.paused || v.ended || v.readyState === 0) return;
    if (!fresh(5000) || userJustActed() || nav.resumes >= 3 || !offVideoPage()) return; // 사이트와 싸우지 않게 횟수 제한
    nav.resumes++;
    v.play()?.catch(() => {});
  }

  function revive(): void {
    const v = pipVideo();
    if (!v || !nav.playing || !nav.id || v.readyState > 0) return;
    if (!fresh(10000) || userJustActed() || nav.revives >= 2 || !offVideoPage()) return;
    nav.revives++;
    const ok = adapter.reload?.(session.home(), nav.id, lastTime) ?? false;
    debugLog(ok ? `영상 다시 불러오기 ${nav.id} @${Math.floor(lastTime)}초` : '다시 불러오기 실패(플레이어 API 없음)');
  }
  const scheduleRevive = () => {
    clearTimeout(reviveTimer);
    reviveTimer = setTimeout(revive, 300);
  };

  adapter.onNavigate?.(() => {
    resume();
    scheduleRevive();
    setTimeout(resume, 600); // 이동이 끝난 뒤 조금 늦게 멈추는 경우
  });

  return {
    attach(d) {
      d.addEventListener('pause', resume, true);
      d.addEventListener('emptied', scheduleRevive, true);
      d.addEventListener('timeupdate', () => {
        const v = pipVideo();
        if (v && v.readyState > 0 && !v.seeking) lastTime = v.currentTime;
      }, true);
      for (const type of ['pointerdown', 'keydown', 'wheel']) d.addEventListener(type, () => { inputAt = Date.now(); }, true);
    },
  };
}
