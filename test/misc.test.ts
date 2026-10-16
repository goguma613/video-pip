import { describe, expect, it } from 'vitest';
import { seekRange } from '../src/media';
import { score, type VideoInfo } from '../src/tracker';
import { fmtTime, pipWindowSize } from '../src/util';

const base: VideoInfo = { playing: false, audible: false, visible: 1, area: 640 * 360, primary: false, tiny: false };

describe('영상 선택 점수', () => {
  it('재생 중 > 소리 남 > 화면에 보임 > 큼', () => {
    expect(score({ ...base, playing: true })).toBeGreaterThan(score({ ...base, audible: true }));
    expect(score({ ...base, audible: true })).toBeGreaterThan(score({ ...base, visible: 0 }));
    expect(score({ ...base, playing: true, audible: true, visible: 0 }))
      .toBeGreaterThan(score({ ...base, playing: true, visible: 1, area: 1920 * 1080 }));
  });
  it('너무 작은 영상은 제외', () => {
    expect(score({ ...base, playing: true, tiny: true })).toBe(-Infinity);
  });
});

describe('PiP 창 크기', () => {
  const video = (w: number, h: number) => ({ videoWidth: w, videoHeight: h }) as HTMLVideoElement;
  it('가로 영상: 긴 변 = 너비', () => {
    expect(pipWindowSize(video(1920, 1080), 480)).toEqual({ width: 480, height: 270 });
  });
  it('세로 영상(쇼츠): 긴 변 = 높이', () => {
    expect(pipWindowSize(video(1080, 1920), 480)).toEqual({ width: 270, height: 480 });
  });
  it('메타데이터가 없으면 16:9', () => {
    expect(pipWindowSize(video(0, 0), 640)).toEqual({ width: 640, height: 360 });
  });
});

describe('시간 표시', () => {
  it('분:초, 시:분:초', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(65.9)).toBe('1:05');
    expect(fmtTime(3725)).toBe('1:02:05');
    expect(fmtTime(NaN)).toBe('0:00');
  });
});

describe('탐색 구간', () => {
  const ranges = (start: number, end: number) => ({ length: 1, start: () => start, end: () => end }) as unknown as TimeRanges;
  const none = { length: 0 } as unknown as TimeRanges;
  it('브라우저가 알려 주는 seekable을 우선(라이브 DVR: 길이가 유한해도)', () => {
    expect(seekRange({ seekable: ranges(3600, 8100), duration: 8125 } as HTMLVideoElement)).toEqual({ start: 3600, end: 8100 });
  });
  it('seekable이 없으면 [0, 길이]', () => {
    expect(seekRange({ seekable: none, duration: 20 } as HTMLVideoElement)).toEqual({ start: 0, end: 20 });
  });
  it('둘 다 없으면 null', () => {
    expect(seekRange({ seekable: none, duration: NaN } as HTMLVideoElement)).toBeNull();
  });
});
