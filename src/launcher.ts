// 원본 페이지의 ⧉ 버튼과 알림.
// 칩만 포인터를 받는다(레이어는 pointer-events:none) → 사이트 클릭을 가로채지 않는다.
import css from './styles/page.css';
import { adoptCss, h, icon } from './dom';
import type { Tracker } from './tracker';

const DWELL_MS = 400;

let root: ShadowRoot | null = null;
let host: HTMLElement | null = null;

function layer(doc: Document): ShadowRoot {
  if (!root || !host) {
    host = doc.createElement('video-pip-ui');
    root = host.attachShadow({ mode: 'closed' });
    adoptCss(root, css);
  }
  if (!host.isConnected) doc.documentElement.append(host);
  return root;
}

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(doc: Document, msg: string): void {
  const r = layer(doc);
  if (!toastEl) {
    toastEl = h(doc, 'div', { class: 'toast', role: 'status' });
    r.append(toastEl);
  }
  const el = toastEl;
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export interface LauncherDeps {
  tracker: Tracker;
  enabled(): boolean;
  busy(): boolean;
  open(v: HTMLVideoElement): void;
  inset(v: HTMLVideoElement): number;
}

export function startLauncher(doc: Document, deps: LauncherDeps): void {
  let chip: HTMLButtonElement | null = null;
  let target: HTMLVideoElement | null = null;
  let shown = false;
  let dwell: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  let x = 0, y = 0;

  function ensure(): HTMLButtonElement {
    if (!chip) {
      chip = h(doc, 'button', { class: 'chip', type: 'button', title: 'PIP로 보기 (Alt+P)', 'aria-label': 'PIP로 보기 (Alt+P)' },
        icon(doc, 'pip'), h(doc, 'span', { class: 'lbl', text: 'PIP' }));
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const v = target;
        hide();
        if (v) { deps.tracker.setManual(v); deps.open(v); }
      });
    }
    const r = layer(doc);
    if (chip.parentNode !== r) r.append(chip);
    return chip;
  }

  function place(v: HTMLVideoElement): void {
    const c = ensure();
    const r = v.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth || innerWidth;
    c.style.top = `${Math.max(r.top + deps.inset(v), 8)}px`;
    c.style.right = `${Math.max(vw - r.right + 8, 8)}px`;
    if (!shown) { shown = true; c.classList.add('show'); }
  }

  function hide(): void {
    clearTimeout(dwell);
    target = null;
    if (shown && chip) chip.classList.remove('show');
    shown = false;
  }

  function update(): void {
    raf = 0;
    if (!deps.tracker.videos().length) return hide(); // 영상 없는 페이지는 여기서 끝(비용 ~0)
    if (!deps.enabled() || deps.busy() || doc.fullscreenElement) return hide();
    const v = deps.tracker.at(x, y);
    if (!v) return hide();
    if (v !== target) {
      hide();
      target = v;
      dwell = setTimeout(() => { if (target === v) place(v); }, DWELL_MS);
    } else if (shown) {
      place(v);
    }
  }

  doc.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    x = e.clientX;
    y = e.clientY;
    if (!raf) raf = requestAnimationFrame(update);
  }, { capture: true, passive: true });
  const quietHide = () => { if (target) hide(); };
  window.addEventListener('scroll', quietHide, { capture: true, passive: true });
  window.addEventListener('resize', quietHide, { passive: true });
  window.addEventListener('blur', quietHide);
  doc.addEventListener('fullscreenchange', quietHide);
  // 포인터가 창 밖으로 나감 (document-start 시점엔 <html>이 없을 수 있어 document에서 감지)
  doc.addEventListener('mouseout', (e) => { if (!e.relatedTarget) quietHide(); });
}
