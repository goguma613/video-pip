// DOM 헬퍼. innerHTML을 쓰지 않는다(유튜브 Trusted Types 대응). 요소는 항상 "대상 문서"에서 만든다.

type AttrValue = string | number | boolean | undefined | ((e: Event) => void);
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs?: Record<string, AttrValue> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
      else if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

/** 문서나 Shadow Root에 스타일시트를 붙인다. constructable stylesheet → 실패 시 <style>. */
export function adoptCss(root: Document | ShadowRoot, css: string): void {
  const doc = root.nodeType === 9 ? (root as Document) : (root as ShadowRoot).ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  try {
    const sheet = new win!.CSSStyleSheet(); // 시트는 그 문서의 창(realm)에서 만들어야 adopt 가능
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    const style = doc.createElement('style');
    style.textContent = css;
    (root.nodeType === 9 ? doc.head || doc.documentElement : root).append(style);
  }
}

// 아이콘 경로: Material Icons (Apache License 2.0)
const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  replay: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  muted: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
};
export type IconName = keyof typeof ICONS | 'back10' | 'fwd10';

const SVG = 'http://www.w3.org/2000/svg';

export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG, 'path');
  const seek = name === 'back10' || name === 'fwd10';
  path.setAttribute('d', ICONS[seek ? 'replay' : (name as keyof typeof ICONS)]);
  if (name === 'fwd10') path.setAttribute('transform', 'matrix(-1 0 0 1 24 0)');
  svg.append(path);
  if (seek) {
    const t = doc.createElementNS(SVG, 'text');
    t.setAttribute('x', '12');
    t.setAttribute('y', '15.6');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '6.5');
    t.setAttribute('font-weight', '700');
    t.setAttribute('font-family', 'system-ui, sans-serif');
    t.textContent = '10';
    svg.append(t);
  }
  return svg;
}
