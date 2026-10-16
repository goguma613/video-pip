// 영상 탐지·대상 선택. 전역 MutationObserver 없이, 필요할 때만 문서의 <video>를 훑는다.
import type { SiteAdapter } from './sites';

export interface VideoInfo {
  playing: boolean;
  audible: boolean;
  /** 화면에 보이는 비율 0~1 */
  visible: number;
  /** 화면상 면적(px²) */
  area: number;
  primary: boolean;
  tiny: boolean;
}

export function score(i: VideoInfo): number {
  if (i.tiny) return -Infinity;
  return (i.playing ? 1000 : 0) + (i.audible ? 300 : 0) + 200 * i.visible
    + Math.min(i.area / 1000, 150) + (i.primary ? 100 : 0);
}

export interface Tracker {
  /** PIP 대상으로 가장 알맞은 영상 */
  pick(): HTMLVideoElement | null;
  /** 화면 좌표 아래의 영상(⧉ 버튼 대상, 200×112 이상) */
  at(x: number, y: number): HTMLVideoElement | null;
  /** 사용자가 직접 고른 영상을 우선 */
  setManual(v: HTMLVideoElement | null): void;
  videos(): HTMLCollectionOf<HTMLVideoElement>;
}

const usable = (v: HTMLVideoElement) => v.isConnected && (v.readyState >= 1 || !!v.currentSrc || !!v.srcObject);

export function createTracker(doc: Document, adapter: SiteAdapter): Tracker {
  const all = doc.getElementsByTagName('video'); // 라이브 컬렉션 — 매번 새로 찾지 않음
  let manual: HTMLVideoElement | null = null;

  function info(v: HTMLVideoElement, primary: HTMLVideoElement | null): VideoInfo {
    const r = v.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth || innerWidth;
    const vh = doc.documentElement.clientHeight || innerHeight;
    const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const area = r.width * r.height;
    return {
      playing: !v.paused && !v.ended,
      audible: !v.muted && v.volume > 0,
      visible: area > 0 ? (ix * iy) / area : 0,
      area,
      primary: v === primary,
      tiny: r.width < 120 || r.height < 68,
    };
  }

  function best(cands: HTMLVideoElement[]): HTMLVideoElement | null {
    const primary = adapter.primaryVideo?.() ?? null;
    let top: HTMLVideoElement | null = null, topScore = -Infinity;
    for (const v of cands) {
      const s = score(info(v, primary));
      if (s > topScore) { top = v; topScore = s; }
    }
    return top;
  }

  return {
    pick() {
      if (manual && usable(manual) && manual.ownerDocument === doc) return manual;
      manual = null;
      return best(Array.from(all).filter(usable));
    },
    at(x, y) {
      const hits: HTMLVideoElement[] = [];
      for (const v of Array.from(all)) {
        if (!usable(v)) continue;
        const r = v.getBoundingClientRect();
        if (r.width >= 200 && r.height >= 112 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hits.push(v);
      }
      return hits.length > 1 ? best(hits) : hits[0] ?? null;
    },
    setManual(v) { manual = v; },
    videos: () => all,
  };
}
