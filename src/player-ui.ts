// PiP 창 안의 플레이어 UI.
import css from './styles/player.css';
import type { CommandId } from './commands';
import type { ConfigStore } from './config';
import { adoptCss, h, icon } from './dom';
import * as media from './media';
import type { MountedUI } from './session';
import { clamp, fmtTime } from './util';

export interface PlayerDeps {
  title: string;
  run(id: CommandId): void;
  hint(id: CommandId): string;
  /** 단축키 처리(키맵) */
  onKey(e: KeyboardEvent): void;
  config: ConfigStore;
}

const HIDE_MS = 2400;

export function mountPlayerUI(win: Window, first: HTMLVideoElement, deps: PlayerDeps): MountedUI {
  const doc = win.document;
  doc.documentElement.lang = 'ko';
  doc.title = deps.title;
  adoptCss(doc, css);

  let video = first;
  const btn = (cls: string, id: CommandId, name: Parameters<typeof icon>[1]) => {
    const label = deps.hint(id);
    return h(doc, 'button', { class: cls, type: 'button', title: label, 'aria-label': label, onclick: () => deps.run(id) }, icon(doc, name));
  };

  // ── 구성 ──
  const slot = h(doc, 'div', { class: 'slot' });
  const ttl = h(doc, 'div', { class: 'ttl', text: deps.title });
  const gear = h(doc, 'button', { class: 'ib', type: 'button', title: '설정', 'aria-label': '설정', 'aria-expanded': 'false' }, icon(doc, 'tune'));
  const closeB = btn('ib', 'close', 'close');
  const top = h(doc, 'div', { class: 'top' }, ttl, gear, closeB);

  const playC = btn('cb big', 'play', 'pause');
  const mid = h(doc, 'div', { class: 'mid' }, btn('cb side', 'back10', 'back10'), playC, btn('cb side', 'fwd10', 'fwd10'));

  const buf = h(doc, 'div', { class: 'buf' });
  const played = h(doc, 'div', { class: 'played' });
  const thumb = h(doc, 'div', { class: 'thumb' });
  const track = h(doc, 'div', { class: 'track' }, buf, played, thumb);
  const tip = h(doc, 'div', { class: 'tip' });
  const seek = h(doc, 'div', { class: 'seek', role: 'slider', 'aria-label': '재생 위치', tabindex: '-1' }, track, tip);

  const playB = btn('ib', 'play', 'pause');
  const time = h(doc, 'span', { class: 'time' });
  const live = h(doc, 'button', { class: 'live', type: 'button', title: '실시간으로', text: 'LIVE', onclick: () => media.toLiveEdge(video) });
  const muteB = btn('ib mute', 'mute', 'volume');
  const vol = h(doc, 'input', { class: 'vol', type: 'range', min: '0', max: '100', step: '1', 'aria-label': '볼륨' });
  const rate = h(doc, 'button', { class: 'rate', type: 'button', title: '배속 (클릭: 바꾸기 · [ / ] / =)', 'aria-label': '배속', onclick: () => deps.run('rateCycle') });
  const row = h(doc, 'div', { class: 'row' }, playB, time, live, h(doc, 'span', { class: 'grow' }), muteB, vol, rate);
  const bot = h(doc, 'div', { class: 'bot' }, seek, row);

  const ov = h(doc, 'div', { class: 'ov' }, top, mid, bot);
  const pop = buildPopover(doc, deps.config);
  const stage = h(doc, 'div', { class: 'stage' }, slot, ov, pop.root);
  doc.body.append(stage);

  // ── 표시 갱신 ──
  let visible = true;
  let dragging = false;

  const setIcon = (b: HTMLButtonElement, name: Parameters<typeof icon>[1]) => b.replaceChildren(icon(doc, name));

  function renderProgress(): void {
    const isLive = media.isLive(video);
    const r = media.seekRange(video);
    time.hidden = isLive;
    live.hidden = !isLive;
    seek.classList.toggle('live', isLive);
    if (isLive) {
      live.classList.toggle('edge', !r || r.end - video.currentTime < 15);
    } else {
      time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    }
    const span = r ? r.end - r.start : 0;
    const p = span > 0 ? clamp((video.currentTime - r!.start) / span, 0, 1) : isLive ? 1 : 0;
    played.style.width = `${p * 100}%`;
    thumb.style.left = `${p * 100}%`;
    const b = video.buffered;
    buf.style.width = span > 0 && b.length ? `${clamp((b.end(b.length - 1) - r!.start) / span, 0, 1) * 100}%` : '0';
    seek.setAttribute('aria-valuetext', isLive ? '실시간' : time.textContent ?? '');
  }
  function renderPlay(): void {
    const paused = video.paused || video.ended;
    const name = paused ? 'play' : 'pause';
    setIcon(playC, name);
    setIcon(playB, name);
    if (paused) show();
    else armHide();
  }
  function renderVolume(): void {
    const off = video.muted || video.volume === 0;
    setIcon(muteB, off ? 'muted' : 'volume');
    vol.value = String(Math.round((video.muted ? 0 : video.volume) * 100));
    vol.setAttribute('aria-valuetext', `${vol.value}%`);
  }
  function renderRate(): void {
    const r = video.playbackRate;
    rate.textContent = `${Number(r.toFixed(2))}x`;
    rate.classList.toggle('on', r !== 1);
  }
  const renderAll = () => { renderProgress(); renderPlay(); renderVolume(); renderRate(); };

  // ── 영상 이벤트 ──
  let unbind: () => void = () => {};
  function bind(v: HTMLVideoElement): void {
    unbind();
    const on: [string, () => void][] = [
      ['play', renderPlay], ['pause', renderPlay], ['ended', renderPlay],
      ['timeupdate', () => visible && !dragging && renderProgress()], // 숨김 상태에선 DOM 쓰기 0
      ['progress', () => visible && renderProgress()],
      ['durationchange', renderProgress], ['loadedmetadata', renderProgress], ['emptied', renderProgress],
      ['volumechange', renderVolume], ['ratechange', renderRate],
    ];
    on.forEach(([t, fn]) => v.addEventListener(t, fn));
    unbind = () => on.forEach(([t, fn]) => v.removeEventListener(t, fn));
    video = v;
    renderAll();
  }

  // ── 보이기 / 숨기기 ──
  let hideTimer = 0;
  function show(): void {
    if (!visible) { visible = true; ov.classList.remove('idle'); renderProgress(); }
    armHide();
  }
  function armHide(): void {
    win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => {
      const keyboard = doc.activeElement?.matches(':focus-visible') && doc.activeElement !== doc.body;
      if (video.paused || dragging || pop.isOpen() || keyboard) return;
      visible = false;
      ov.classList.add('idle');
    }, HIDE_MS);
  }
  stage.addEventListener('pointermove', show);
  stage.addEventListener('pointerdown', show);
  doc.addEventListener('focusin', show);
  doc.addEventListener('mouseout', (e) => { // 포인터가 창 밖으로 나가면 바로 숨김
    if (e.relatedTarget || video.paused || dragging || pop.isOpen()) return;
    win.clearTimeout(hideTimer);
    visible = false;
    ov.classList.add('idle');
  });

  // 빈 곳 클릭 = 재생/일시정지 (팝오버가 열려 있으면 닫기만)
  ov.addEventListener('click', (e) => {
    if (e.target !== ov && e.target !== mid) return;
    if (pop.isOpen()) closePop();
    else deps.run('play');
  });

  // 휠 = 볼륨, Shift+휠 = 배속 (Windows는 Shift+휠이 가로 스크롤로 와서 deltaX도 본다)
  stage.addEventListener('wheel', (e) => {
    if (pop.root.contains(e.target as Node)) return;
    const d = e.deltaY || e.deltaX;
    if (!d) return;
    e.preventDefault();
    if (e.shiftKey) media.nudgeRate(video, d < 0 ? 0.25 : -0.25);
    else media.changeVolume(video, d < 0 ? 0.05 : -0.05);
    show();
  }, { passive: false });

  vol.addEventListener('input', () => {
    video.volume = Number(vol.value) / 100;
    video.muted = video.volume === 0;
  });

  // ── 시크 ──
  const ratioAt = (x: number) => {
    const r = track.getBoundingClientRect();
    return r.width > 0 ? clamp((x - r.left) / r.width, 0, 1) : 0;
  };
  const showTip = (x: number) => {
    const ratio = ratioAt(x);
    const r = media.seekRange(video);
    tip.style.left = `${ratio * 100}%`;
    if (!r) { tip.textContent = ''; return; }
    const t = r.start + ratio * (r.end - r.start);
    tip.textContent = media.isLive(video) ? `-${fmtTime(r.end - t)}` : fmtTime(t);
  };
  seek.addEventListener('pointerdown', (e) => {
    dragging = true;
    seek.classList.add('drag');
    try { seek.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    media.seekToRatio(video, ratioAt(e.clientX));
    showTip(e.clientX);
    renderProgress();
  });
  seek.addEventListener('pointermove', (e) => {
    showTip(e.clientX);
    if (dragging) { media.seekToRatio(video, ratioAt(e.clientX)); renderProgress(); }
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    seek.classList.remove('drag');
    armHide();
  };
  seek.addEventListener('pointerup', endDrag);
  seek.addEventListener('pointercancel', endDrag);
  seek.addEventListener('lostpointercapture', endDrag);

  // ── 팝오버 ──
  function closePop(): void {
    pop.close();
    gear.setAttribute('aria-expanded', 'false');
  }
  gear.addEventListener('click', () => {
    pop.toggle();
    gear.setAttribute('aria-expanded', String(pop.isOpen()));
    show();
  });

  // ── 단축키 ──
  doc.addEventListener('keydown', (e) => {
    show();
    if (e.code === 'Escape' && pop.isOpen()) {
      e.preventDefault();
      closePop();
      return;
    }
    deps.onKey(e);
  }, true);

  // ── 첫 진입 힌트(1회) ──
  if (!deps.config.get().hinted) {
    const hint = h(doc, 'div', { class: 'hint', text: '마우스를 올리면 컨트롤 · 휠 = 볼륨 · Shift+휠 = 배속' });
    stage.append(hint);
    win.setTimeout(() => hint.classList.add('out'), 3600);
    win.setTimeout(() => hint.remove(), 4100);
    deps.config.set({ hinted: true });
  }

  bind(first);
  show();

  return {
    slot,
    setVideo: bind,
    setTitle(t) { ttl.textContent = t; doc.title = t; },
    destroy() {
      unbind();
      pop.destroy();
      win.clearTimeout(hideTimer);
    },
  };
}

function buildPopover(doc: Document, config: ConfigStore) {
  const opts: { el: HTMLButtonElement; get(): boolean }[] = [];
  const option = (label: string, sub: string, get: () => boolean, set: (on: boolean) => void) => {
    const el = h(doc, 'button', { class: 'opt', type: 'button', role: 'switch' },
      h(doc, 'span', { class: 'lbl' }, label, h(doc, 'span', { class: 'sub', text: sub })),
      h(doc, 'span', { class: 'sw', 'aria-hidden': 'true' }));
    el.addEventListener('click', () => set(!get()));
    opts.push({ el, get });
    return el;
  };
  const root = h(doc, 'div', { class: 'pop', role: 'dialog', 'aria-label': '설정', hidden: true },
    option('탭 전환 시 자동 PIP', 'Chrome 134+ · 소리 나는 영상을 재생 중일 때',
      () => config.get().autoTabPip, (on) => config.set({ autoTabPip: on })),
    option('영상 위 ⧉ 버튼 표시', '꺼도 Alt+P로 열 수 있어요',
      () => config.get().launcher, (on) => config.set({ launcher: on })),
    option('이 사이트에서는 버튼·자동 PIP 끄기', location.hostname,
      () => config.siteDisabled(), (off) => config.setSiteDisabled(off)),
    h(doc, 'div', { class: 'ver', text: `v${__VERSION__} · Alt+P로 언제든 켜고 끌 수 있어요` }));
  const sync = () => opts.forEach((o) => o.el.setAttribute('aria-checked', String(o.get())));
  sync();
  const unsub = config.subscribe(sync);
  return {
    root,
    isOpen: () => !root.hidden,
    toggle() { root.hidden = !root.hidden; },
    close() { root.hidden = true; },
    destroy: unsub,
  };
}
