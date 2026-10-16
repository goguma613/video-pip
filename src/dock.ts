// 영상 이동/복원 — 영상을 옮기는 유일한 곳.
// Zero-touch: 영상 요소의 style·class·속성은 건드리지 않는다. 복원은 "제자리에 넣기"로 끝난다.

export interface DockToken {
  video: HTMLVideoElement;
  /** 원위치 표식(영상 바로 앞의 주석 노드) */
  anchor: Comment;
  /** 흐름 레이아웃 보존용 빈 상자(필요할 때만) */
  spacer: HTMLElement | null;
  parent: Node;
  done: boolean;
}

const IN_FLOW = new Set(['static', 'relative', 'sticky']);

/** 원위치에 표식을 남긴다. 영상은 아직 움직이지 않는다. */
export function detach(video: HTMLVideoElement): DockToken {
  const parent = video.parentNode;
  if (!parent) throw new Error('영상이 문서에 붙어 있지 않습니다');
  const doc = video.ownerDocument;
  const anchor = doc.createComment('video-pip');
  parent.insertBefore(anchor, video);

  // 흐름 안에 있는 영상만 같은 크기의 상자로 자리를 지킨다(absolute 영상은 빠져도 레이아웃이 안 무너짐)
  let spacer: HTMLElement | null = null;
  const cs = doc.defaultView?.getComputedStyle(video);
  const rect = video.getBoundingClientRect();
  if (cs && IN_FLOW.has(cs.position || 'static') && cs.display !== 'none' && rect.width > 0 && rect.height > 0) {
    spacer = doc.createElement('div');
    spacer.setAttribute('data-video-pip-spacer', '');
    const s = spacer.style;
    s.display = cs.display.startsWith('inline') ? 'inline-block' : 'block';
    s.boxSizing = 'border-box';
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
    s.margin = `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`;
    s.verticalAlign = cs.verticalAlign;
    s.flex = 'none';
    s.background = '#000';
    parent.insertBefore(spacer, video);
  }
  return { video, anchor, spacer, parent, done: false };
}

export function moveTo(token: DockToken, slot: Element): void {
  slot.append(token.video);
}

export interface RestoreResult {
  /** 돌려놓기 직전에 재생 중이었나 */
  wasPlaying: boolean;
  /** 돌아간 자리가 화면에 그려지지 않는 곳인가(숨겨진 페이지 등) → 이 경우 영상을 멈췄다 */
  hidden: boolean;
}

/** 화면에 그려지지 않는 곳(display:none 조상 등)에 있나. 스크롤로 화면 밖에 있는 건 보이는 것으로 친다 */
export function isHidden(el: Element): boolean {
  if (!el.isConnected) return true;
  if (typeof el.checkVisibility === 'function') return !el.checkVisibility();
  return el.getClientRects().length === 0;
}

/**
 * 멱등. 표식 앞 → 원래 부모 → (집이 사라졌으면) 영상을 놓아준다.
 * 보이지 않는 자리로 돌아가면 영상을 멈춘다 — 화면은 없는데 소리만 나는 상황을 막는다.
 */
export function restore(token: DockToken): RestoreResult {
  if (token.done) return { wasPlaying: false, hidden: false };
  token.done = true;
  const { video, anchor, spacer, parent } = token;
  const wasPlaying = !video.paused && !video.ended;
  if (anchor.parentNode) anchor.parentNode.insertBefore(video, anchor);
  else if (parent.isConnected) parent.appendChild(video);
  else video.remove();
  anchor.remove();
  spacer?.remove();
  const hidden = isHidden(video);
  if (hidden) {
    if (!video.paused) video.pause();
  } else if (wasPlaying) {
    // 문서 간 이동으로 멈췄다면 한 번 다시 재생(보이는 자리일 때만)
    setTimeout(() => { if (video.paused && !video.ended && !isHidden(video)) video.play()?.catch(() => {}); }, 200);
  }
  return { wasPlaying, hidden };
}
