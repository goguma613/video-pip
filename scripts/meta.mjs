// 유저스크립트 메타블록. @name / @namespace는 v1과 같아야 기존 설치가 같은 스크립트로 인식되어 자동 업데이트된다.
const RAW = 'https://raw.githubusercontent.com/goguma613/video-pip/main/video-pip.user.js';
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234f9dff'%3E%3Cpath d='M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z'/%3E%3C/svg%3E";

export function banner(version) {
  const meta = [
    ['name', '🎬 고화질 영상 PIP (Picture-in-Picture)'],
    ['name:en', 'HD Video Picture-in-Picture'],
    ['namespace', 'https://github.com/goguma613/video-pip'],
    ['version', version],
    ['description', '영상을 원본 화질 그대로 항상 위에 뜨는 작은 창으로. 영상 위 ⧉ 버튼 또는 Alt+P 한 번이면 끝.'],
    ['description:en', 'Pop any video into an always-on-top window at original quality (Document Picture-in-Picture). Hover button or Alt+P.'],
    ['author', 'goguma613'],
    ['match', '*://*/*'],
    ['exclude', '*://*.netflix.com/*'],
    ['exclude', '*://*.disneyplus.com/*'],
    ['grant', 'none'],
    ['run-at', 'document-start'],
    ['updateURL', RAW],
    ['downloadURL', RAW],
    ['homepageURL', 'https://github.com/goguma613/video-pip'],
    ['supportURL', 'https://github.com/goguma613/video-pip/issues'],
    ['icon', ICON],
  ];
  const lines = meta.map(([k, v]) => `// @${k.padEnd(14)} ${v}`);
  return ['// ==UserScript==', ...lines, '// ==/UserScript==', '', '// 이 파일은 빌드 결과물입니다. 소스: https://github.com/goguma613/video-pip/tree/main/src', ''].join('\n');
}
