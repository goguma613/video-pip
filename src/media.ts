// 영상 조작. 사용자가 명령했을 때만 호출된다(열 때 배속·볼륨을 바꾸지 않는다).
import { clamp } from './util';

export const RATE_CYCLE = [0.5, 1, 1.25, 1.5, 2];
const RATE_MIN = 0.25, RATE_MAX = 4;

/** 일반 판정. 유튜브 라이브처럼 길이가 유한하게 나오는 라이브는 사이트 어댑터가 판정한다. */
export const isLive = (v: HTMLVideoElement): boolean => v.duration === Infinity;

/** 탐색 가능한 구간. 브라우저가 알려 주는 seekable 범위를 우선(라이브 DVR 포함), 없으면 [0, 길이] */
export function seekRange(v: HTMLVideoElement): { start: number; end: number } | null {
  const s = v.seekable;
  if (s && s.length) {
    const start = s.start(0), end = s.end(s.length - 1);
    if (Number.isFinite(end) && end > start) return { start, end };
  }
  if (Number.isFinite(v.duration) && v.duration > 0) return { start: 0, end: v.duration };
  return null;
}

export function togglePlay(v: HTMLVideoElement): void {
  if (v.paused || v.ended) v.play()?.catch(() => {});
  else v.pause();
}

export function seekBy(v: HTMLVideoElement, sec: number): void {
  const r = seekRange(v);
  if (r) v.currentTime = clamp(v.currentTime + sec, r.start, r.end);
}

export function seekToRatio(v: HTMLVideoElement, ratio: number): void {
  const r = seekRange(v);
  if (r) v.currentTime = r.start + clamp(ratio, 0, 1) * (r.end - r.start);
}

export function toLiveEdge(v: HTMLVideoElement): void {
  const r = seekRange(v);
  if (r) v.currentTime = Math.max(r.start, r.end - 1);
}

export function changeVolume(v: HTMLVideoElement, delta: number): void {
  v.volume = clamp(Math.round((v.volume + delta) * 100) / 100, 0, 1);
  if (delta > 0) v.muted = false;
}

export function toggleMute(v: HTMLVideoElement): void {
  v.muted = !v.muted;
  if (!v.muted && v.volume === 0) v.volume = 0.5;
}

export function cycleRate(v: HTMLVideoElement): void {
  v.playbackRate = RATE_CYCLE.find((r) => r > v.playbackRate + 1e-3) ?? RATE_CYCLE[0];
}

export function nudgeRate(v: HTMLVideoElement, delta: number): void {
  v.playbackRate = clamp(Math.round((v.playbackRate + delta) * 100) / 100, RATE_MIN, RATE_MAX);
}
