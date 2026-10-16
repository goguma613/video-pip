// 상태 머신 — "영상이 지금 어디 있나"를 아는 유일한 곳.
//   idle → opening → doc | legacy → idle
// 불변식
//   I1 옮겨진 영상은 언제나 최대 1개
//   I2 창 닫힘 같은 콜백은 자기 세션 id일 때만 반영(이전 세션의 늦은 이벤트는 무시)
//   I3 어떤 예외 경로에서도 영상을 복원
//   I4 requestWindow는 열기의 첫 await (사용자 활성화가 만료되지 않게)
import * as dock from './dock';
import type { DockToken } from './dock';
import { warn } from './util';

export type Mode = 'idle' | 'opening' | 'doc' | 'legacy';
export type Reason = 'manual' | 'auto';

export interface MountedUI {
  /** 영상이 들어갈 자리 */
  slot: Element;
  setVideo(v: HTMLVideoElement): void;
  setTitle(title: string): void;
  destroy(): void;
}

export interface SessionDeps {
  pick(): HTMLVideoElement | null;
  /** 페이지에서 지금 재생 중인 "주인공" 영상(따라갈 대상). 없으면 null */
  follow(): HTMLVideoElement | null;
  /** 영상을 갈아 끼운 뒤 창 비율을 맞춘다(브라우저가 거부할 수 있음) */
  fitWindow?(win: Window, video: HTMLVideoElement): void;
  title(): string;
  /** Document PiP를 쓸 수 있나(지원 + 최상위 프레임) */
  docPip(): boolean;
  requestWindow(video: HTMLVideoElement): Promise<Window>;
  mountUI(win: Window, video: HTMLVideoElement): MountedUI;
  legacyAvailable(video: HTMLVideoElement): boolean;
  requestLegacy(video: HTMLVideoElement): Promise<void>;
  exitLegacy(): void;
  toast(msg: string): void;
  /** PiP를 닫고 영상을 돌려놓은 뒤(home = 돌아간 자리) */
  onRestored?(video: HTMLVideoElement, result: dock.RestoreResult, home: Node | null): void;
}

export interface Session {
  mode(): Mode;
  video(): HTMLVideoElement | null;
  open(video?: HTMLVideoElement | null, reason?: Reason): Promise<void>;
  close(): Promise<void>;
  toggle(): Promise<void>;
  /** 사이트가 영상을 바꿨을 수 있을 때 호출 → 필요하면 새 영상으로 갈아 끼움 */
  rebind(): void;
  /** 페이지가 전체화면에 들어가면 영상을 돌려보낸다 */
  fullscreen(el: Element | null): void;
  refreshTitle(): void;
  /** PiP 영상의 원래 자리(부모). PiP 중이 아니면 null */
  home(): Node | null;
  subscribe(fn: (mode: Mode) => void): () => void;
}

interface Active {
  id: number;
  kind: 'doc' | 'legacy';
  video: HTMLVideoElement;
  win?: Window;
  ui?: MountedUI;
  token?: DockToken;
  cleanup: (() => void)[];
}

export const MSG = {
  noVideo: '영상을 찾지 못했어요. 영상을 재생한 뒤 다시 시도해 주세요.',
  unsupported: '이 브라우저나 영상은 PIP를 지원하지 않아요.',
  retry: 'PIP를 열지 못했어요. 영상을 클릭하거나 Alt+P를 다시 눌러 주세요.',
};

export function createSession(deps: SessionDeps): Session {
  let seq = 0;
  let active: Active | null = null;
  let opening = false;
  let queue: Promise<void> = Promise.resolve();
  let pendingOpen: Promise<void> | null = null;
  const subs = new Set<(m: Mode) => void>();

  const mode = (): Mode => (opening ? 'opening' : active ? active.kind : 'idle');
  const emit = () => {
    const m = mode();
    subs.forEach((fn) => { try { fn(m); } catch (e) { warn(e); } });
  };
  const enqueue = (fn: () => Promise<void> | void): Promise<void> =>
    (queue = queue.then(fn).catch((e) => warn('전환 실패', e)));

  /** 동기 해제. pagehide 같은 외부 이벤트에서도 바로 호출된다. */
  function teardown(id: number): void {
    const a = active;
    if (!a || a.id !== id) return; // I2
    active = null;
    for (const fn of a.cleanup) { try { fn(); } catch (e) { warn(e); } }
    try { a.ui?.destroy(); } catch (e) { warn(e); }
    if (a.token) {
      const home = a.token.anchor.parentNode ?? a.token.parent;
      const result = dock.restore(a.token);
      window.dispatchEvent(new Event('resize')); // 사이트 플레이어가 크기를 다시 계산하게
      try { deps.onRestored?.(a.video, result, home); } catch (e) { warn(e); }
    }
    emit();
  }

  /** 현재 세션을 동기로 닫는다. 영상을 먼저 돌려놓고 창을 닫는다. */
  function closeActive(): void {
    const a = active;
    if (!a) return;
    teardown(a.id);
    if (a.kind === 'doc') { try { a.win?.close(); } catch { /* 이미 닫힘 */ } }
    else deps.exitLegacy();
  }

  async function openDoc(video: HTMLVideoElement, reason: Reason): Promise<void> {
    let win: Window;
    try {
      win = await deps.requestWindow(video); // I4
    } catch (e) {
      warn('Document PiP 실패', e);
      if (reason === 'auto' && deps.legacyAvailable(video)) return openLegacy(video);
      deps.toast(MSG.retry);
      return;
    }
    const a: Active = { id: ++seq, kind: 'doc', video, win, cleanup: [] };
    try {
      a.ui = deps.mountUI(win, video);
      a.token = dock.detach(video);
      dock.moveTo(a.token, a.ui.slot);
      active = a;
      const id = a.id;
      win.addEventListener('pagehide', () => teardown(id), { once: true });
    } catch (e) {
      // I3: 구성 중 실패 → 원상복구
      if (a.token) dock.restore(a.token);
      try { a.ui?.destroy(); } catch { /* 무시 */ }
      try { win.close(); } catch { /* 무시 */ }
      throw e;
    }
  }

  async function openLegacy(video: HTMLVideoElement): Promise<void> {
    if (!deps.legacyAvailable(video)) { deps.toast(MSG.unsupported); return; }
    try {
      await deps.requestLegacy(video);
    } catch (e) {
      warn('PiP 실패', e);
      deps.toast(MSG.retry);
      return;
    }
    const a: Active = { id: ++seq, kind: 'legacy', video, cleanup: [] };
    const id = a.id;
    const onLeave = () => teardown(id);
    video.addEventListener('leavepictureinpicture', onLeave, { once: true });
    a.cleanup.push(() => video.removeEventListener('leavepictureinpicture', onLeave));
    active = a;
  }

  async function openNow(video: HTMLVideoElement | null | undefined, reason: Reason): Promise<void> {
    const v = video ?? deps.pick();
    if (!v) { if (reason === 'manual') deps.toast(MSG.noVideo); return; }
    if (active) {
      if (active.video === v) return;
      closeActive(); // 다른 영상 → 기존 세션을 동기로 정리(I1). await가 없어 활성화 유지
    }
    opening = true;
    emit();
    try {
      // DRM 영상(mediaKeys)은 옮기면 검은 화면이 될 수 있어 기본 PiP로
      if (deps.docPip() && !v.mediaKeys) await openDoc(v, reason);
      else await openLegacy(v);
    } finally {
      opening = false;
      emit();
    }
  }

  const session: Session = {
    mode,
    video: () => active?.video ?? null,

    open(video, reason = 'manual') {
      if (pendingOpen) return pendingOpen; // 연타 → 한 번만
      const p: Promise<void> = enqueue(() => openNow(video, reason)).finally(() => {
        if (pendingOpen === p) pendingOpen = null;
      });
      pendingOpen = p;
      return p;
    },

    close: () => enqueue(closeActive),

    toggle() {
      if (pendingOpen) return pendingOpen;
      return active ? session.close() : session.open();
    },

    rebind() {
      const a = active;
      if (!a || a.kind !== 'doc' || !a.token || !a.ui) return;
      const cur = a.video;
      const homeGone = !a.token.anchor.isConnected;
      const sourceGone = cur.readyState === 0 && !cur.currentSrc && !cur.srcObject;
      let next: HTMLVideoElement | null = null;
      // ① 사이트가 원래 자리나 영상 소스를 없앴다(SPA) → 가장 알맞은 영상으로
      if (homeGone || sourceGone) next = deps.pick();
      // ② 사이트가 PiP 영상을 멈추고 다른 영상을 틀었다(유튜브 일반 ↔ 쇼츠는 플레이어가 따로) → 그 영상을 따라감
      //    PiP 영상을 보는 중(재생 중)이면 절대 바꾸지 않는다. 같은 요소를 재사용하는 경우(유튜브 다음 영상)는 해당 없음
      else if (cur.paused || cur.ended) next = deps.follow();
      if (!next || next === cur) return;
      dock.restore(a.token);
      a.token = dock.detach(next);
      dock.moveTo(a.token, a.ui.slot);
      a.video = next;
      a.ui.setVideo(next);
      a.ui.setTitle(deps.title());
      if (a.win) deps.fitWindow?.(a.win, next);
    },

    fullscreen(el) {
      const home = active?.kind === 'doc' ? active.token?.anchor.parentNode : null;
      if (el && home && el.contains(home)) void session.close();
    },

    refreshTitle() {
      active?.ui?.setTitle(deps.title());
    },

    home: () => active?.token?.anchor.parentNode ?? null,

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  return session;
}
