// 화질 — 지금 실제로 재생 중인 해상도 표시 + (지원하는 사이트에서) 화질 바꾸기 · "항상 최고 화질".
// PiP는 영상 요소를 그대로 옮기므로 화질을 깎지 않는다. 다만 사이트가 "자동" 화질일 때
// 페이지 안 플레이어 크기·네트워크에 맞춰 화질을 낮출 수 있어서(예: 유튜브 홈으로 가 플레이어가 숨겨질 때) 이 기능이 있다.
import type { ConfigStore } from './config';
import type { QualityLevel, SiteAdapter } from './sites';

/** 실제 해상도 → 흔히 쓰는 이름(1920×1080 → 1080p, 3840×2160 → 4K). 세로 영상·시네마 비율도 긴 변/짧은 변으로 판단 */
export function resolutionLabel(w: number, h: number): string {
  if (!(w > 0 && h > 0)) return '';
  const long = Math.max(w, h), short = Math.min(w, h);
  const tiers: [number, number, string][] = [
    [7680, 4320, '8K'], [3840, 2160, '4K'], [2560, 1440, '1440p'], [1920, 1080, '1080p'],
    [1280, 720, '720p'], [854, 480, '480p'], [640, 360, '360p'], [426, 240, '240p'],
  ];
  for (const [l, s, name] of tiers) if (long >= l * 0.9 || short >= s * 0.9) return name;
  return `${short}p`;
}

export type QualityChoice = 'auto' | 'max' | string;

export interface QualityControl {
  /** 이 사이트에서 화질을 바꿀 수 있나 */
  supported(): boolean;
  /** 고를 수 있는 화질(높은 순). 아직 모르면 빈 배열 */
  levels(): QualityLevel[];
  /** 지금 선택: 'max'(항상 최고) · 'auto'(사이트에 맡김) · 이 영상에만 고른 화질 id */
  choice(): QualityChoice;
  /** 고르기. 'max'·'auto'는 이후 영상에도 적용되는 선호, 화질 id는 지금 영상에만 */
  choose(c: QualityChoice): void;
  /**
   * 영상을 새로 불러오기 시작했다(다음 영상, 유튜브 홈 이동 후 다시 불러오기 등) — 사이트가 화질을 "자동"으로 되돌릴 수 있다.
   * newSession = PiP를 새로 열었을 때(다시 맞추는 횟수 제한도 처음부터)
   */
  loaded(newSession?: boolean): void;
  /** 불러온 영상에 고른 화질 · "항상 최고 화질"을 맞춘다(화질 목록이 준비될 때까지 이벤트마다 다시 시도) */
  ensure(): void;
}

const MAX_TRIES = 3; // 영상 하나에 다시 적용하는 최대 횟수 — 사이트와 싸우지 않게

export function createQuality(
  adapter: SiteAdapter,
  config: ConfigStore,
  home: () => Node | null,
  videoKey: () => string | null,
): QualityControl {
  let manual: { key: string | null; id: string } | null = null; // 이 영상에만 고른 화질
  let loadSeq = 0;      // 불러오기 횟수
  let appliedSeq = -1;  // 마지막으로 맞춘 불러오기
  let tries = { key: null as string | null, n: 0 };

  const supported = () => typeof adapter.qualityLevels === 'function' && typeof adapter.setQuality === 'function';
  const levels = () => (supported() ? adapter.qualityLevels!(home()) : []);
  const set = (id: string) => adapter.setQuality?.(home(), id) ?? false;
  const manualHere = () => manual !== null && manual.key === videoKey();

  return {
    supported,
    levels,
    choice: () => (manualHere() ? manual!.id : config.get().quality),
    choose(c) {
      if (!supported()) return;
      if (c === 'max' || c === 'auto') {
        manual = null;
        config.set({ quality: c });
        const target = c === 'max' ? levels()[0]?.id : 'auto';
        if (target && set(target)) appliedSeq = loadSeq;
      } else {
        manual = { key: videoKey(), id: c };
        if (set(c)) appliedSeq = loadSeq;
      }
    },
    loaded(newSession = false) {
      loadSeq++;
      if (newSession) tries = { key: null, n: 0 };
    },
    ensure() {
      if (!supported() || appliedSeq === loadSeq) return;
      const pref = config.get().quality;
      if (!manualHere() && pref !== 'max') { appliedSeq = loadSeq; return; } // 자동: 사이트에 맡김
      const key = videoKey();
      if (tries.key !== key) tries = { key, n: 0 };
      if (tries.n >= MAX_TRIES) return;
      const target = manualHere() ? manual!.id : levels()[0]?.id;
      if (!target) return; // 화질 목록이 아직 없음 → 다음 이벤트에 다시
      if (set(target)) { appliedSeq = loadSeq; tries.n++; }
    },
  };
}
