// 사이트 어댑터. v2.0은 일반 + 유튜브만 둔다.
import { debugLog } from './diag';

export interface SiteAdapter {
  id: string;
  /** 사이트의 주 영상(있으면 점수 가산) */
  primaryVideo?(): HTMLVideoElement | null;
  /** PiP 창 상단에 표시할 제목 */
  title(): string;
  /** SPA 페이지 이동 알림 */
  onNavigate?(cb: () => void): void;
  /** SPA 페이지 이동 시작 알림. dest = 가려는 경로(알 수 있으면) */
  onNavigateStart?(cb: (dest: string | null) => void): void;
  /** 영상 페이지(다른 영상으로 가는 이동)인가. 아니면 이동 때문에 멈춘 PiP 영상을 이어서 재생한다 */
  isVideoPage?(path: string): boolean;
  /**
   * 페이지 이동 중 사이트가 플레이어를 정지시켜 영상 데이터를 비우는 것을 막는다(holding()일 때만).
   * 설치한 게 없으면 null — 나중에 다시 시도한다.
   */
  protectOnNavigate?(holding: () => boolean): (() => void) | null;
  /** 진단 기록용 플레이어 객체 */
  player?(): object | null;
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
  pauseVideo?(): void;
}
const ytPlayer = () => document.getElementById('movie_player') as YtPlayer | null;
const isShorts = () => location.pathname.startsWith('/shorts');

// 영상을 비우는 플레이어 명령. 홈 등으로 이동하는 중엔 "일시정지"로 바꿔 영상 데이터를 지킨다.
const TEARDOWN = ['stopVideo', 'cueVideoById', 'cueVideoByPlayerVars', 'cueVideoByUrl', 'cancelPlayback', 'clearVideo'];

// 이동할 곳: 이벤트 정보 → 방금 누른 링크 → 모름
let lastLink = { at: 0, href: '' };
function destOf(e: Event): string | null {
  const d = (e as CustomEvent).detail as Record<string, any> | null | undefined;
  const url = d?.url ?? d?.endpoint?.commandMetadata?.webCommandMetadata?.url;
  const href = typeof url === 'string' ? url : Date.now() - lastLink.at < 1500 ? lastLink.href : null;
  if (!href) return null;
  try { return new URL(href, location.href).pathname; } catch { return null; }
}

const youtube: SiteAdapter = {
  id: 'youtube',
  // 일반 영상과 쇼츠는 플레이어가 따로 있다
  primaryVideo: () => document.querySelector<HTMLVideoElement>(isShorts()
    ? 'ytd-reel-video-renderer[is-active] video, #shorts-player video'
    : '#movie_player video.html5-main-video'),
  // "(3) 제목 - YouTube" → "제목"
  title: () => (document.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*-\s*YouTube$/, '') || 'YouTube',
  onNavigate: (cb) => window.addEventListener('yt-navigate-finish', cb),
  onNavigateStart(cb) {
    document.addEventListener('click', (e) => {
      const a = e.composedPath().find((n): n is HTMLAnchorElement => (n as Element).tagName === 'A' && !!(n as HTMLAnchorElement).href);
      if (a) lastLink = { at: Date.now(), href: a.href };
    }, true);
    window.addEventListener('yt-navigate-start', (e) => cb(destOf(e)));
  },
  // 다른 영상(/watch)·쇼츠·라이브로 가는 이동은 사이트에 맡긴다. 홈·검색·채널 등은 PiP 영상을 지킨다
  isVideoPage: (path) => /^\/(watch|shorts|live|embed)(\/|$)/.test(path),
  protectOnNavigate(holding) {
    const undo: (() => void)[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#movie_player, #shorts-player')) {
      const p = el as unknown as Record<string, unknown> & YtPlayer;
      for (const name of TEARDOWN) {
        const orig = p[name];
        if (typeof orig !== 'function') continue;
        try {
          p[name] = function (this: unknown, ...args: unknown[]) {
            if (holding() && typeof p.pauseVideo === 'function') {
              debugLog(`유튜브 player.${name}() → 일시정지로 대체(PiP 영상 보호)`);
              return p.pauseVideo();
            }
            return (orig as (...a: unknown[]) => unknown).apply(this, args);
          };
          undo.push(() => { p[name] = orig; });
        } catch { /* 쓸 수 없는 속성 */ }
      }
    }
    return undo.length ? () => undo.forEach((f) => f()) : null;
  },
  player: () => ytPlayer(),
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
