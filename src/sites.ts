// 사이트 어댑터. v2.0은 일반 + 유튜브만 둔다.

export interface SiteAdapter {
  id: string;
  /** 사이트의 주 영상(있으면 점수 가산) */
  primaryVideo?(): HTMLVideoElement | null;
  /** PiP 창 상단에 표시할 제목 */
  title(): string;
  /** SPA 페이지 이동 알림 */
  onNavigate?(cb: () => void): void;
  /** ⧉ 버튼의 영상 상단 여백(px). 사이트 UI를 피할 때 */
  launcherInset?(v: HTMLVideoElement): number;
  /** 라이브 판정(길이가 Infinity가 아닌 라이브용). 없으면 일반 판정 */
  isLive?(v: HTMLVideoElement): boolean;
  /** 사이트 방식으로 실시간 위치로 이동했으면 true */
  toLiveEdge?(v: HTMLVideoElement): boolean;
}

const generic: SiteAdapter = {
  id: 'generic',
  title: () => document.title || location.hostname,
};

// 유튜브 플레이어 객체(@grant none이라 페이지 JS에 접근 가능). 내부 API라 언제든 바뀔 수 있어 전부 방어적으로 쓴다.
interface YtPlayer extends HTMLElement {
  getVideoData?(): { isLive?: boolean } | undefined;
  seekToLiveHead?(): void;
}
const ytPlayer = () => document.getElementById('movie_player') as YtPlayer | null;
const isShorts = () => location.pathname.startsWith('/shorts');

const youtube: SiteAdapter = {
  id: 'youtube',
  // 일반 영상과 쇼츠는 플레이어가 따로 있다
  primaryVideo: () => document.querySelector<HTMLVideoElement>(isShorts()
    ? 'ytd-reel-video-renderer[is-active] video, #shorts-player video'
    : '#movie_player video.html5-main-video'),
  // "(3) 제목 - YouTube" → "제목"
  title: () => (document.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*-\s*YouTube$/, '') || 'YouTube',
  onNavigate: (cb) => window.addEventListener('yt-navigate-finish', cb),
  // 임베드 플레이어는 상단에 제목 바가 있어 그 아래로 내린다
  launcherInset: () => (location.pathname.startsWith('/embed/') ? 56 : 8),
  // 유튜브 라이브는 영상 길이가 유한하게 나와서 플레이어 정보와 시간 표시의 라이브 표식으로 판정
  isLive(v) {
    if (v.duration === Infinity) return true;
    if (isShorts()) return false;
    try { if (ytPlayer()?.getVideoData?.()?.isLive === true) return true; } catch { /* API 변경 */ }
    return !!document.querySelector('#movie_player .ytp-time-display.ytp-live');
  },
  toLiveEdge() {
    const p = ytPlayer();
    if (typeof p?.seekToLiveHead !== 'function') return false;
    try { p.seekToLiveHead(); return true; } catch { return false; }
  },
};

export function pickAdapter(loc: Location): SiteAdapter {
  return /(^|\.)youtube(-nocookie)?\.com$/.test(loc.hostname) ? youtube : generic;
}
