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
}

const generic: SiteAdapter = {
  id: 'generic',
  title: () => document.title || location.hostname,
};

const youtube: SiteAdapter = {
  id: 'youtube',
  primaryVideo: () =>
    location.pathname.startsWith('/shorts')
      ? null
      : document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video'),
  // "(3) 제목 - YouTube" → "제목"
  title: () => (document.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*-\s*YouTube$/, '') || 'YouTube',
  onNavigate: (cb) => window.addEventListener('yt-navigate-finish', cb),
  // 임베드 플레이어는 상단에 제목 바가 있어 그 아래로 내린다
  launcherInset: () => (location.pathname.startsWith('/embed/') ? 56 : 8),
};

export function pickAdapter(loc: Location): SiteAdapter {
  return /(^|\.)youtube(-nocookie)?\.com$/.test(loc.hostname) ? youtube : generic;
}
