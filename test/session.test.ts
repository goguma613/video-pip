import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, MSG, type MountedUI, type SessionDeps } from '../src/session';

/** 테스트용 PiP 창: pagehide 시점을 테스트가 직접 정한다. */
function fakeWindow() {
  const doc = document.implementation.createHTMLDocument('pip');
  const listeners = new Map<string, (() => void)[]>();
  const win = {
    document: doc,
    closed: false,
    addEventListener(type: string, fn: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    close: vi.fn(() => { win.closed = true; }),
    fire(type: string) { listeners.get(type)?.forEach((fn) => fn()); },
  };
  return win;
}
type FakeWin = ReturnType<typeof fakeWindow>;

function setup(over: Partial<SessionDeps> = {}) {
  const box = document.createElement('div');
  const video = document.createElement('video');
  const after = document.createElement('span');
  box.append(video, after);
  document.body.replaceChildren(box);

  const wins: FakeWin[] = [];
  const uis: (MountedUI & { setVideo: ReturnType<typeof vi.fn> })[] = [];
  const deps: SessionDeps = {
    pick: () => video,
    follow: () => null,
    title: () => '제목',
    docPip: () => true,
    requestWindow: vi.fn(async () => { const w = fakeWindow(); wins.push(w); return w as unknown as Window; }),
    mountUI: vi.fn((win: Window) => {
      const ui = { slot: win.document.body, setVideo: vi.fn(), setTitle: vi.fn(), destroy: vi.fn() };
      uis.push(ui);
      return ui;
    }),
    legacyAvailable: () => true,
    requestLegacy: vi.fn(async () => {}),
    exitLegacy: vi.fn(),
    toast: vi.fn(),
    ...over,
  };
  const session = createSession(deps);
  return { session, deps, box, video, after, wins, uis };
}

const isHome = (t: ReturnType<typeof setup>) =>
  t.video.parentNode === t.box && t.video.nextSibling === t.after && t.box.childNodes.length === 2;

beforeEach(() => { document.body.replaceChildren(); });

describe('Session', () => {
  it('열면 영상이 PiP 창으로 가고, 닫으면 정확히 제자리로 돌아온다', async () => {
    const t = setup();
    await t.session.open();
    expect(t.session.mode()).toBe('doc');
    expect(t.video.ownerDocument).toBe(t.wins[0].document);
    expect(t.box.firstChild?.nodeType).toBe(Node.COMMENT_NODE); // 원위치 표식

    await t.session.close();
    expect(t.session.mode()).toBe('idle');
    expect(isHome(t)).toBe(true);
    expect(t.wins[0].close).toHaveBeenCalled();
    expect(t.uis[0].destroy).toHaveBeenCalled();
  });

  it('PiP 창이 닫히면(pagehide) 영상을 복원한다', async () => {
    const t = setup();
    await t.session.open();
    t.wins[0].fire('pagehide');
    expect(t.session.mode()).toBe('idle');
    expect(isHome(t)).toBe(true);
  });

  it('연타해도 창은 하나만 열린다', async () => {
    const t = setup();
    const a = t.session.open();
    const b = t.session.open();
    const c = t.session.toggle();
    await Promise.all([a, b, c]);
    expect(t.deps.requestWindow).toHaveBeenCalledTimes(1);
    expect(t.session.mode()).toBe('doc');
  });

  it('이전 세션의 늦은 pagehide는 새 세션을 건드리지 않는다', async () => {
    const t = setup();
    await t.session.open();
    const v2 = document.createElement('video');
    document.body.append(v2);
    await t.session.open(v2); // 다른 영상 → 기존 세션 정리 후 새 창
    expect(t.wins).toHaveLength(2);
    expect(isHome(t)).toBe(true);

    t.wins[0].fire('pagehide'); // 첫 창의 닫힘 이벤트가 뒤늦게 도착
    expect(t.session.mode()).toBe('doc');
    expect(t.session.video()).toBe(v2);
    expect(v2.ownerDocument).toBe(t.wins[1].document);
  });

  it('toggle: 열려 있으면 닫는다', async () => {
    const t = setup();
    await t.session.toggle();
    expect(t.session.mode()).toBe('doc');
    await t.session.toggle();
    expect(t.session.mode()).toBe('idle');
    expect(isHome(t)).toBe(true);
  });

  it('창 요청이 거부되면 안내만 하고 아무것도 건드리지 않는다', async () => {
    const t = setup({ requestWindow: vi.fn(async () => { throw new DOMException('no activation', 'NotAllowedError'); }) });
    await t.session.open();
    expect(t.session.mode()).toBe('idle');
    expect(t.deps.toast).toHaveBeenCalledWith(MSG.retry);
    expect(isHome(t)).toBe(true);
  });

  it('자동 진입에서 창 요청이 거부되면 기본 PiP로 시도한다', async () => {
    const t = setup({ requestWindow: vi.fn(async () => { throw new Error('x'); }) });
    await t.session.open(null, 'auto');
    expect(t.deps.requestLegacy).toHaveBeenCalled();
    expect(t.session.mode()).toBe('legacy');
  });

  it('UI 구성이 실패하면 원상복구하고 창을 닫는다', async () => {
    const t = setup({ mountUI: vi.fn(() => { throw new Error('boom'); }) });
    await t.session.open();
    expect(t.session.mode()).toBe('idle');
    expect(isHome(t)).toBe(true);
    expect(t.wins[0].close).toHaveBeenCalled();
  });

  it('DRM 영상은 기본 PiP로 연다', async () => {
    const t = setup();
    Object.defineProperty(t.video, 'mediaKeys', { value: {} });
    await t.session.open();
    expect(t.deps.requestWindow).not.toHaveBeenCalled();
    expect(t.session.mode()).toBe('legacy');
    t.video.dispatchEvent(new Event('leavepictureinpicture'));
    expect(t.session.mode()).toBe('idle');
  });

  it('Document PiP를 못 쓰면 기본 PiP, 그것도 안 되면 안내', async () => {
    const t = setup({ docPip: () => false, legacyAvailable: () => false });
    await t.session.open();
    expect(t.deps.toast).toHaveBeenCalledWith(MSG.unsupported);
    expect(t.session.mode()).toBe('idle');
  });

  it('영상이 없으면 안내한다(자동 진입은 조용히)', async () => {
    const t = setup({ pick: () => null });
    await t.session.open(null, 'auto');
    expect(t.deps.toast).not.toHaveBeenCalled();
    await t.session.open();
    expect(t.deps.toast).toHaveBeenCalledWith(MSG.noVideo);
  });

  it('사이트가 영상의 원래 자리를 없애고 새 영상을 띄우면 새 영상으로 갈아 끼운다', async () => {
    const next = document.createElement('video');
    let current: HTMLVideoElement | null = null;
    const t = setup({ pick: () => current });
    current = t.video;
    await t.session.open();
    t.box.remove();                 // SPA가 이전 플레이어를 통째로 지움
    document.body.append(next);
    current = next;
    t.session.rebind();
    expect(t.session.video()).toBe(next);
    expect(next.ownerDocument).toBe(t.wins[0].document);
    expect(t.uis[0].setVideo).toHaveBeenCalledWith(next);
    expect(t.video.isConnected).toBe(false);
  });

  it('원래 자리가 살아 있으면 갈아 끼우지 않는다(유튜브처럼 같은 영상 요소 재사용)', async () => {
    const other = document.createElement('video');
    const t = setup();
    Object.defineProperty(t.video, 'currentSrc', { value: 'blob:https://www.youtube.com/1' });
    await t.session.open();
    document.body.append(other);
    t.deps.pick = () => other;
    t.session.rebind();
    expect(t.session.video()).toBe(t.video);
  });

  it('PiP 영상이 멈췄고 페이지에서 다른 주인공 영상이 재생되면 그 영상을 따라간다(유튜브 일반 ↔ 쇼츠)', async () => {
    const shorts = document.createElement('video');
    const fitWindow = vi.fn();
    const t = setup({ follow: () => shorts, fitWindow });
    Object.defineProperty(t.video, 'currentSrc', { value: 'blob:https://www.youtube.com/1' });
    await t.session.open();
    document.body.append(shorts);          // 쇼츠 플레이어의 영상이 재생 시작 (PiP 영상은 일시정지 상태)
    t.session.rebind();
    expect(t.session.video()).toBe(shorts);
    expect(shorts.ownerDocument).toBe(t.wins[0].document);
    expect(isHome(t)).toBe(true);           // 이전 영상은 제자리로
    expect(fitWindow).toHaveBeenCalledWith(t.wins[0], shorts);
  });

  it('PiP 영상이 재생 중이면 다른 영상이 재생돼도 바꾸지 않는다', async () => {
    const other = document.createElement('video');
    const t = setup({ follow: () => other });
    Object.defineProperty(t.video, 'currentSrc', { value: 'blob:https://www.youtube.com/1' });
    Object.defineProperty(t.video, 'paused', { value: false });
    await t.session.open();
    document.body.append(other);
    t.session.rebind();
    expect(t.session.video()).toBe(t.video);
  });

  it('원래 자리를 포함한 요소가 전체화면이 되면 영상을 돌려보낸다', async () => {
    const t = setup();
    await t.session.open();
    t.session.fullscreen(document.body);
    await t.session.close(); // 큐가 비워질 때까지
    expect(t.session.mode()).toBe('idle');
    expect(isHome(t)).toBe(true);
  });

  it('닫은 뒤 돌아간 자리와 결과를 알린다', async () => {
    const onRestored = vi.fn();
    const t = setup({ onRestored });
    await t.session.open();
    await t.session.close();
    expect(onRestored).toHaveBeenCalledTimes(1);
    const [video, result, home] = onRestored.mock.calls[0];
    expect(video).toBe(t.video);
    expect(result).toHaveProperty('hidden');
    expect(home).toBe(t.box);
  });

  it('상태 변화를 알린다', async () => {
    const t = setup();
    const seen: string[] = [];
    t.session.subscribe((m) => seen.push(m));
    await t.session.open();
    await t.session.close();
    expect(seen).toEqual(['opening', 'doc', 'idle']);
  });
});
