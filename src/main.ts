// 부트스트랩: 모듈을 연결만 한다.
import { buildCommands, createKeymap } from './commands';
import { createConfig, gmBackend, localBackend, safeLocalStorage, siteKey } from './config';
import { startLauncher, toast } from './launcher';
import * as media from './media';
import { mountPlayerUI } from './player-ui';
import { createSession } from './session';
import { pickAdapter } from './sites';
import { createTracker } from './tracker';
import { debounce, isTopFrame, pipWindowSize, warn } from './util';

function boot(): void {
  const w = window as Window & { __videoPip?: string };
  if (w.__videoPip) return; // 중복 실행 방지
  w.__videoPip = __VERSION__;

  const top = isTopFrame();
  const adapter = pickAdapter(location);
  const local = safeLocalStorage();
  const config = createConfig(gmBackend() ?? localBackend(local), siteKey(location.hostname), local);
  const tracker = createTracker(document, adapter);

  const session = createSession({
    pick: () => tracker.pick(),
    follow: () => {
      const v = tracker.pick();
      return v && tracker.prominent(v) ? v : null;
    },
    fitWindow(win, v) {
      const fit = () => {
        const { width, height } = pipWindowSize(v, Math.max(win.innerWidth, win.innerHeight));
        if (Math.abs(width / height - win.innerWidth / win.innerHeight) < 0.05) return;
        // Document PiP의 resizeTo는 사용자 활성화가 필요할 수 있다 → 거부되면 레터박스로 둔다
        try { win.resizeTo(width + win.outerWidth - win.innerWidth, height + win.outerHeight - win.innerHeight); } catch { /* 무시 */ }
      };
      if (v.videoWidth) fit();
      else v.addEventListener('loadedmetadata', fit, { once: true });
    },
    title: () => adapter.title(),
    docPip: () => top && !!window.documentPictureInPicture,
    requestWindow: (v) => window.documentPictureInPicture!.requestWindow(pipWindowSize(v, config.get().pipLongEdge)),
    mountUI(win, v) {
      const ui = mountPlayerUI(win, v, {
        title: adapter.title(),
        run: (id) => keymap.run(id),
        hint: (id) => keymap.hint(id),
        onKey: (e) => keymap.handle(e, 'player'),
        config,
        isLive: (x) => adapter.isLive?.(x) ?? media.isLive(x),
        toLiveEdge: (x) => { if (!adapter.toLiveEdge?.(x)) media.toLiveEdge(x); },
      });
      // 창 크기 기억
      win.addEventListener('resize', debounce(() => {
        config.set({ pipLongEdge: Math.max(win.innerWidth, win.innerHeight) });
      }, 500));
      // 사이트 제목이 바뀌면(SPA 다음 영상) PiP 창 제목도
      const titleEl = document.querySelector('head > title');
      if (titleEl) {
        const mo = new MutationObserver(() => session.refreshTitle());
        mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
        win.addEventListener('pagehide', () => mo.disconnect(), { once: true });
      }
      // PiP 창 안의 영상이 비워지거나 멈추면(사이트가 다른 영상으로 갈아탐) 재연결 검사
      for (const type of ['emptied', 'pause', 'ended']) win.document.addEventListener(type, scheduleRebind, true);
      win.document.addEventListener('pause', keepAlive, true);
      // PiP 창에서 직접 조작한 시각(이때 멈춘 건 사용자가 멈춘 것)
      for (const type of ['pointerdown', 'keydown', 'wheel']) win.document.addEventListener(type, () => { pipInputAt = Date.now(); }, true);
      return ui;
    },
    legacyAvailable: (v) => document.pictureInPictureEnabled && !v.disablePictureInPicture,
    requestLegacy: (v) => v.requestPictureInPicture().then(() => undefined),
    exitLegacy: () => { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); },
    toast: (msg) => toast(document, msg),
  });
  const keymap = createKeymap(buildCommands(session));

  // 페이지에선 전역 명령(Alt+P)만 가로챈다 → 사이트 단축키는 그대로
  window.addEventListener('keydown', (e) => keymap.handle(e, 'global'), true);

  // 영상 교체 감지 → 재연결(묶어서 1회)
  let rebindTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRebind(): void {
    clearTimeout(rebindTimer);
    rebindTimer = setTimeout(() => session.rebind(), 50);
  }
  for (const type of ['loadedmetadata', 'play', 'playing', 'emptied']) document.addEventListener(type, scheduleRebind, true);
  adapter.onNavigate?.(() => {
    scheduleRebind();
    syncAutoPip();
    keepAlive();
    setTimeout(keepAlive, 600); // 이동이 끝난 뒤 조금 늦게 멈추는 경우
  });

  // 영상을 PiP로 보다가 홈·검색 등으로 가면 사이트(유튜브)가 영상을 멈춘다 → 이어서 재생한다.
  // 이동 직전에 재생 중이었고, 사용자가 PiP 창에서 직접 멈춘 게 아니고, 영상 페이지가 아닌 곳으로 갔을 때만.
  let nav = { at: 0, playing: false, resumes: 0 };
  let pipInputAt = 0;
  adapter.onNavigateStart?.(() => {
    const v = session.video();
    nav = { at: Date.now(), playing: session.mode() === 'doc' && !!v && !v.paused && !v.ended, resumes: 0 };
  });
  function keepAlive(): void {
    const v = session.video();
    if (!v || session.mode() !== 'doc' || !nav.playing || !v.paused || v.ended) return;
    const now = Date.now();
    if (now - nav.at > 5000 || now - pipInputAt < 1000 || nav.resumes >= 3) return; // 사이트와 싸우지 않게 횟수 제한
    if (!adapter.offVideoPage?.()) return;
    nav.resumes++;
    v.play()?.catch(() => {});
  }

  // 페이지 전체화면 → 영상을 돌려보내 전체화면에서 보이게
  document.addEventListener('fullscreenchange', () => session.fullscreen(document.fullscreenElement));

  window.addEventListener('pagehide', () => config.flush());

  // 탭 전환 자동 PIP (Chrome 134+ MediaSession). 켜져 있을 때만 핸들러를 등록한다.
  let autoRegistered = false;
  function syncAutoPip(): void {
    if (!top || !('mediaSession' in navigator)) return;
    const on = config.get().autoTabPip && !config.siteDisabled();
    if (!on && !autoRegistered) return; // 등록한 적 없으면 사이트 핸들러를 건드리지 않음
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture' as MediaSessionAction,
        on ? () => { if (session.mode() === 'idle') void session.open(null, 'auto'); } : null);
      autoRegistered = on;
    } catch { /* 이 브라우저는 자동 PiP 미지원 */ }
  }
  syncAutoPip();
  config.subscribe(syncAutoPip);

  startLauncher(document, {
    tracker,
    enabled: () => config.get().launcher && !config.siteDisabled(),
    busy: () => session.mode() === 'opening',
    open: (v) => void session.open(v),
    inset: (v) => adapter.launcherInset?.(v) ?? 8,
  });
}

try { boot(); } catch (e) { warn('시작 실패', e); }
