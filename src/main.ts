// 부트스트랩: 모듈을 연결만 한다.
import { buildCommands, createKeymap } from './commands';
import { createConfig, gmBackend, localBackend, safeLocalStorage, siteKey } from './config';
import { debugLog, traceNavigation } from './diag';
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
      win.document.addEventListener('emptied', scheduleRevive, true);
      win.document.addEventListener('timeupdate', () => {
        const v = session.video();
        if (v && v.readyState > 0 && !v.seeking) lastTime = v.currentTime; // 비워지기 직전 위치를 기억
      }, true);
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
    scheduleRevive();
    setTimeout(keepAlive, 600); // 이동이 끝난 뒤 조금 늦게 멈추는 경우
  });

  // 영상을 PiP로 보다가 홈·검색 등으로 가면 유튜브가 영상을 멈추거나 아예 비운다(진단 기록으로 확인:
  // 이동 약 1.3초 뒤 src 제거 + srcObject = null + load()).
  //  · 멈추기만 하면 → 이어서 재생(keepAlive)
  //  · 비우면 → 같은 플레이어에 같은 영상을 보던 위치부터 다시 불러온다(revive)
  // 이동 직전에 재생 중이었고, 영상 페이지가 아닌 곳으로 갔고, 사용자가 PiP 창에서 직접 멈춘 게 아닐 때만.
  let nav = { at: 0, playing: false, toVideo: false, resumes: 0, revives: 0, id: null as string | null };
  let pipInputAt = 0;
  let lastTime = 0;
  const fresh = (ms: number) => Date.now() - nav.at < ms;
  const offVideoPage = () => !nav.toVideo && adapter.isVideoPage?.(location.pathname) === false;
  adapter.onNavigateStart?.((dest) => {
    const v = session.video();
    const doc = session.mode() === 'doc';
    nav = {
      at: Date.now(),
      playing: doc && !!v && !v.paused && !v.ended,
      toVideo: dest != null && !!adapter.isVideoPage?.(dest),
      resumes: 0,
      revives: 0,
      id: doc ? adapter.videoId?.(session.home()) ?? null : null,
    };
    if (!doc) return;
    if (v) lastTime = v.currentTime;
    traceNavigation(v, adapter.player?.() ?? null);
    debugLog('PiP 상태', { id: nav.id, playing: nav.playing, toVideo: nav.toVideo, dest });
  });
  function keepAlive(): void {
    const v = session.video();
    if (!v || session.mode() !== 'doc' || !nav.playing || !v.paused || v.ended || v.readyState === 0) return;
    if (!fresh(5000) || Date.now() - pipInputAt < 1000 || nav.resumes >= 3 || !offVideoPage()) return; // 사이트와 싸우지 않게 횟수 제한
    nav.resumes++;
    v.play()?.catch(() => {});
  }
  let reviveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRevive(): void {
    clearTimeout(reviveTimer);
    reviveTimer = setTimeout(revive, 300);
  }
  function revive(): void {
    const v = session.video();
    if (!v || session.mode() !== 'doc' || !nav.playing || !nav.id || v.readyState > 0) return;
    if (!fresh(10000) || Date.now() - pipInputAt < 1000 || nav.revives >= 2 || !offVideoPage()) return;
    nav.revives++;
    const ok = adapter.reload?.(session.home(), nav.id, lastTime) ?? false;
    debugLog(ok ? `영상 다시 불러오기 ${nav.id} @${Math.floor(lastTime)}초` : '다시 불러오기 실패(플레이어 API 없음)');
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
