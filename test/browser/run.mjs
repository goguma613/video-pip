// 브라우저 검증: 빌드한 video-pip.user.js를 실제 Chromium(headless)에 주입해 동작을 확인한다.
//   npm run build && npm run test:browser
// 처음 한 번: npx playwright install chromium
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'fixtures');
const SCRIPT = fs.readFileSync(path.join(HERE, '../../video-pip.user.js'), 'utf8');
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail); }
};

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript({ content: SCRIPT });
await context.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  let file = u.pathname === '/' ? 'inflow.html' : u.pathname.slice(1);
  if (u.hostname === 'www.youtube.com' && u.pathname === '/watch') {
    file = { 'live-api': 'yt-live-api.html', 'live-class': 'yt-live-class.html', nav: 'yt-nav.html' }[u.searchParams.get('v')] ?? 'yt.html';
  }
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'nf' });
  if (!file.endsWith('.webm')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(p) });
  const buf = fs.readFileSync(p);
  const range = route.request().headers()['range'];
  if (!range) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes' }, body: buf });
  const [, a, b] = /bytes=(\d+)-(\d*)/.exec(range);
  const start = +a, end = b ? +b : buf.length - 1;
  return route.fulfill({ status: 206, contentType: 'video/webm', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${buf.length}` }, body: buf.subarray(start, end + 1) });
});
// headless 창은 요청 크기를 무시하므로, 요청한 크기를 기록해 검사한다
await context.addInitScript(() => {
  const d = window.documentPictureInPicture;
  if (!d) return;
  const orig = d.requestWindow.bind(d);
  window.__req = [];
  d.requestWindow = (o) => { window.__req.push(o); return orig(o); };
});

const errors = [];
context.on('page', (p) => {
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' || (m.text().includes('[video-pip]') && !m.text().includes('[진단]'))) errors.push(`${p.url()}: ${m.text()}`); });
});

const pipEval = (page, fn, arg) => page.evaluate(([src, a]) => {
  const w = documentPictureInPicture.window;
  return w ? new Function('w', 'a', `return (${src})(w, a)`)(w, a) : null;
}, [fn.toString(), arg]);

async function waitPlaying(page, sel) {
  await page.waitForFunction((s) => { const v = document.querySelector(s); return v && v.currentTime > 0.3 && !v.paused; }, sel, { timeout: 10000 });
}
async function hoverAndClickChip(page, sel) {
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }, sel);
  await page.mouse.move((r.l + r.r) / 2, (r.t + r.b) / 2);
  await page.mouse.move((r.l + r.r) / 2 + 5, (r.t + r.b) / 2 + 5);
  await page.waitForTimeout(650);
  const cx = r.r - 8 - 15, cy = r.t + 8 + 15;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [cx, cy]);
  return { hit, click: () => page.mouse.click(cx, cy) };
}

// ── A. 일반 사이트(흐름 영상) ──
console.log('\nA. 일반 사이트');
{
  const page = await context.newPage();
  await page.goto('https://site.test/inflow.html');
  await waitPlaying(page, '#v');
  const before = await page.evaluate(() => ({ html: document.getElementById('art').innerHTML, afterTop: document.getElementById('after').offsetTop }));

  const chip = await hoverAndClickChip(page, '#v');
  check('영상 위에 마우스를 올리면 ⧉ 버튼이 보인다', chip.hit === 'VIDEO-PIP-UI', chip.hit);
  const pagesBefore = context.pages().length;
  await chip.click();
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  const st = await page.evaluate(() => {
    const w = documentPictureInPicture.window, v = document.querySelector('video') || w.document.querySelector('video');
    return {
      inPip: v.ownerDocument === w.document,
      spacer: !!document.querySelector('[data-video-pip-spacer]'),
      afterTop: document.getElementById('after').offsetTop,
      size: [window.__req.at(-1).width, window.__req.at(-1).height],
      ttl: w.document.querySelector('.ttl')?.textContent,
      style: v.getAttribute('style'),
    };
  });
  check('⧉ 클릭 → 영상이 PiP 창으로 이동', st.inPip);
  check('흐름 영상 자리에 빈 상자 → 아래 문단 위치 그대로', st.spacer && st.afterTop === before.afterTop, `${st.afterTop} vs ${before.afterTop}`);
  check('창 크기 = 영상 비율(480×270)', st.size[0] === 480 && st.size[1] === 270, st.size.join('×'));
  check('PiP 창 제목 표시', st.ttl === '일반 사이트 테스트', st.ttl);
  check('영상 style 속성을 건드리지 않음', st.style === null, st.style);

  const t0 = await pipEval(page, (w) => w.document.querySelector('video').currentTime);
  await page.waitForTimeout(700);
  const t1 = await pipEval(page, (w) => w.document.querySelector('video').currentTime);
  check('PiP 창에서 계속 재생', t1 > t0 + 0.3, `${t0} → ${t1}`);

  // PiP 창을 Playwright 페이지로 잡을 수 있으면 스크린샷
  const pipPage = context.pages().length > pagesBefore ? context.pages().at(-1) : null;
  if (pipPage) { await pipPage.setViewportSize({ width: 480, height: 270 }); await pipPage.waitForTimeout(300); await pipPage.mouse.move(200, 120); await pipPage.waitForTimeout(250); await pipPage.screenshot({ path: path.join(SHOTS, 'pip-480.png') }); }
  console.log('    (PiP 창 스크린샷:', pipPage ? '저장' : '불가', ')');

  // 단축키(PiP 창) — e.code 기준, 한글 key 값이어도 동작
  const keyRes = await pipEval(page, (w) => {
    const v = w.document.querySelector('video');
    const press = (code, key, extra = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...extra }));
    const r = {};
    press('KeyK', 'ㅏ'); r.pausedAfterK = v.paused;
    press('KeyK', 'ㅏ'); r.playingAfterK2 = !v.paused;
    const t = v.currentTime; press('KeyL', 'ㅣ'); r.seek = v.currentTime - t;
    v.volume = 0.5; press('ArrowDown', 'ArrowDown'); r.vol = v.volume;
    press('BracketRight', ']'); r.rate = v.playbackRate;
    press('Equal', '='); r.rate2 = v.playbackRate;
    press('KeyM', 'ㅡ'); r.muted = v.muted; press('KeyM', 'ㅡ');
    return r;
  });
  check('K(한글 ㅏ)로 일시정지/재생', keyRes.pausedAfterK && keyRes.playingAfterK2, JSON.stringify(keyRes));
  check('L = 10초 앞으로', Math.abs(keyRes.seek - 10) < 0.6, keyRes.seek);
  check('↓ = 볼륨 -5%', Math.abs(keyRes.vol - 0.45) < 0.001, keyRes.vol);
  check('] = 배속 +0.25, = = 1배', keyRes.rate === 1.25 && keyRes.rate2 === 1, `${keyRes.rate}, ${keyRes.rate2}`);
  check('M = 음소거', keyRes.muted === true);

  const ui = await pipEval(page, (w) => {
    const d = w.document, v = d.querySelector('video');
    const stage = d.querySelector('.stage');
    v.volume = 0.5;
    stage.dispatchEvent(new w.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    const vol = v.volume;
    stage.dispatchEvent(new w.WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }));
    const rate = v.playbackRate; v.playbackRate = 1;
    d.querySelector('.rate').click(); const cyc = v.playbackRate; v.playbackRate = 1;
    d.querySelector('.ib[aria-label="설정"]').click();
    const popOpen = !d.querySelector('.pop').hidden;
    const opts = [...d.querySelectorAll('.opt')].map((o) => [o.textContent, o.getAttribute('aria-checked')]);
    d.querySelectorAll('.opt')[1].click(); // 영상 위 버튼 표시 끄기
    const launcherOff = d.querySelectorAll('.opt')[1].getAttribute('aria-checked');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    const popClosedByEsc = d.querySelector('.pop').hidden;
    const stillOpen = !!documentPictureInPicture.window;
    d.querySelectorAll('.opt')[1].click(); // 다시 켜기
    return { vol, rate, cyc, popOpen, opts, launcherOff, popClosedByEsc, stillOpen };
  });
  check('휠 = 볼륨 +5%', Math.abs(ui.vol - 0.55) < 0.001, ui.vol);
  check('Shift+휠 = 배속 +0.25', ui.rate === 1.25, ui.rate);
  check('배속 칩 클릭 = 순환(1 → 1.25)', ui.cyc === 1.25, ui.cyc);
  check('⚙ 팝오버 열림 + 토글 3개', ui.popOpen && ui.opts.length === 3, JSON.stringify(ui.opts));
  check('토글 클릭 → 상태 반영', ui.launcherOff === 'false');
  check('Esc는 팝오버만 닫고 PiP는 유지', ui.popClosedByEsc && ui.stillOpen);

  // 시크바 클릭
  const seekOk = await pipEval(page, (w) => {
    const d = w.document, v = d.querySelector('video'), tr = d.querySelector('.track').getBoundingClientRect();
    const seek = d.querySelector('.seek');
    const x = tr.left + tr.width * 0.5, y = tr.top + tr.height / 2;
    seek.dispatchEvent(new w.PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
    seek.dispatchEvent(new w.PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
    return v.currentTime / v.duration;
  });
  check('시크바 가운데 클릭 → 50% 지점', Math.abs(seekOk - 0.5) < 0.05, seekOk);

  // 닫기 버튼
  await pipEval(page, (w) => w.document.querySelector('.ib[aria-label^="닫기"]').click());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    html: document.getElementById('art').innerHTML,
    pip: !!documentPictureInPicture.window,
    playing: !document.getElementById('v').paused,
  }));
  check('✕ → 창 닫힘', !after.pip);
  check('✕ → DOM이 처음과 완전히 같음', after.html === before.html);
  check('✕ → 재생 상태 유지', after.playing);

  // Alt+P 토글 / 연타
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  check('Alt+P → 열림', true);
  await page.bringToFront();
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !documentPictureInPicture.window, null, { timeout: 5000 }).catch(() => {});
  check('Alt+P 다시 → 닫힘', !(await page.evaluate(() => !!documentPictureInPicture.window)));
  await page.keyboard.press('Alt+KeyP');
  await page.keyboard.press('Alt+KeyP');
  await page.keyboard.press('Alt+KeyP');
  await page.waitForTimeout(800);
  const burst = await page.evaluate(() => ({
    anchors: [...document.getElementById('art').childNodes].filter((n) => n.nodeType === 8).length,
    spacers: document.querySelectorAll('[data-video-pip-spacer]').length,
    pip: !!documentPictureInPicture.window,
    inPip: documentPictureInPicture.window?.document.querySelectorAll('video').length ?? 0,
  }));
  check('Alt+P 3연타 → 상태가 일관됨(표식·빈 상자 0~1개, 영상 1개)', burst.anchors <= 1 && burst.spacers <= 1 && (burst.pip ? burst.inPip === 1 && burst.anchors === 1 : burst.anchors === 0), JSON.stringify(burst));
  if (burst.pip) await pipEval(page, (w) => w.close());
  await page.waitForTimeout(300);
  check('정리 후 DOM 원상복구', (await page.evaluate(() => document.getElementById('art').innerHTML)) === before.html);

  // 설정 저장
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => localStorage.getItem('vpip:v2'));
  check('설정은 localStorage vpip:v2에 저장', !!saved && JSON.parse(saved).hinted === true, saved);
  await page.close();
}

// ── B. 유튜브(형태를 흉내 낸 페이지를 youtube.com 주소로) ──
console.log('\nB. 유튜브형 페이지');
{
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=test');
  await waitPlaying(page, 'video');
  const style0 = await page.evaluate(() => document.querySelector('video').getAttribute('style'));
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  const st = await page.evaluate(() => {
    const w = documentPictureInPicture.window;
    return {
      ttl: w.document.querySelector('.ttl').textContent,
      spacer: !!document.querySelector('[data-video-pip-spacer]'),
      size: [w.innerWidth, w.innerHeight],
      rect: (() => { const r = w.document.querySelector('video').getBoundingClientRect(); return [r.width, r.height]; })(),
    };
  });
  check('제목에서 "(3)"·" - YouTube" 제거', st.ttl === '테스트 영상', st.ttl);
  check('absolute 영상이라 빈 상자 없음', !st.spacer);
  check('사이트 인라인 크기(854×480)를 덮어써 창에 꽉 참', Math.round(st.rect[0]) === st.size[0] && Math.round(st.rect[1]) === st.size[1], `${st.rect} in ${st.size}`);

  await page.evaluate(() => { document.title = '(4) 다음 영상 - YouTube'; });
  await page.waitForTimeout(100);
  check('사이트 제목이 바뀌면 PiP 제목도', (await pipEval(page, (w) => w.document.querySelector('.ttl').textContent)) === '다음 영상');

  await page.keyboard.press('KeyK');
  const sk = await page.evaluate(() => window.siteKeys.slice(-1)[0]);
  check('PiP 중에도 페이지의 단일키(k)는 사이트가 받음', sk === 'KeyK', sk);

  await page.click('#search');
  await page.keyboard.press('Alt+KeyP');
  await page.waitForTimeout(300);
  check('입력창에서 Alt+P는 무시', await page.evaluate(() => !!documentPictureInPicture.window));

  await page.click('#fs');
  await page.waitForTimeout(800);
  const fs1 = await page.evaluate(() => ({
    fs: !!document.fullscreenElement,
    pip: !!documentPictureInPicture.window,
    home: document.querySelector('.html5-video-container > video') !== null,
  }));
  check('전체화면 진입 → 영상이 돌아와 전체화면에 보임', fs1.fs && !fs1.pip && fs1.home, JSON.stringify(fs1));
  await page.evaluate(() => document.exitFullscreen?.()).catch(() => {});
  await page.waitForTimeout(300);
  check('복원 후 사이트 style 그대로', (await page.evaluate(() => document.querySelector('video').getAttribute('style'))) === style0);
  await page.close();
}

// ── C. SPA: 사이트가 플레이어를 지우고 새 영상을 띄움 ──
console.log('\nC. SPA 영상 교체');
{
  const page = await context.newPage();
  await page.goto('https://site.test/spa.html');
  await waitPlaying(page, '#v1');
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  await page.click('#next');
  await page.waitForFunction(() => documentPictureInPicture.window?.document.querySelector('video')?.id === 'v2', null, { timeout: 5000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const w = documentPictureInPicture.window;
    return { id: w?.document.querySelector('video')?.id, ttl: w?.document.querySelector('.ttl')?.textContent, count: w?.document.querySelectorAll('video').length };
  });
  check('새 영상으로 갈아 끼움', r.id === 'v2' && r.count === 1, JSON.stringify(r));
  check('제목도 갱신', r.ttl === 'SPA 2', r.ttl);
  await pipEval(page, (w) => w.close());
  await page.waitForTimeout(300);
  check('닫으면 새 영상이 새 자리로', await page.evaluate(() => document.getElementById('v2').parentElement.id === 'player2'));
  await page.close();
}

// ── D. 세로 영상 ──
console.log('\nD. 세로 영상');
{
  const page = await context.newPage();
  await page.goto('https://site.test/portrait.html');
  await waitPlaying(page, '#v');
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  const size = await page.evaluate(() => [window.__req.at(-1).width, window.__req.at(-1).height]);
  check('세로 창(270×480)', size[0] === 270 && size[1] === 480, size.join('×'));
  const pipPage = context.pages().at(-1);
  if (pipPage && pipPage !== page) { await pipPage.setViewportSize({ width: 270, height: 480 }); await pipPage.mouse.move(100, 200); await pipPage.waitForTimeout(250); await pipPage.screenshot({ path: path.join(SHOTS, 'pip-portrait.png') }); }
  await pipEval(page, (w) => w.close());
  await page.close();
}

// ── E. iframe 안 영상 → 기본 PiP ──
console.log('\nE. iframe');
{
  const page = await context.newPage();
  await page.goto('https://site.test/frame.html');
  const frame = page.frames().find((f) => f.url().endsWith('/inflow.html'));
  await frame.waitForFunction(() => { const v = document.querySelector('#v'); return v && v.currentTime > 0.3; });
  const box = await page.evaluate(() => { const f = document.getElementById('f').getBoundingClientRect(); return [f.left, f.top]; });
  const vr = await frame.evaluate(() => { const b = document.querySelector('#v').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; });
  const [ox, oy] = box;
  await page.mouse.move(ox + (vr[0] + vr[2]) / 2, oy + (vr[1] + vr[3]) / 2);
  await page.mouse.move(ox + (vr[0] + vr[2]) / 2 + 4, oy + (vr[1] + vr[3]) / 2 + 4);
  await page.waitForTimeout(650);
  await page.mouse.click(ox + vr[2] - 23, oy + vr[1] + 23);
  await page.waitForTimeout(800);
  const res = await frame.evaluate(() => ({ legacy: document.pictureInPictureElement?.id ?? null, pipWin: !!(window.documentPictureInPicture && documentPictureInPicture.window) }));
  check('iframe 안에서는 기본 PiP로', res.legacy === 'v' && !res.pipWin, JSON.stringify(res));
  await frame.evaluate(() => document.exitPictureInPicture().catch(() => {}));
  await page.close();
}

// ── F. controls 속성이 있는 영상 ──
console.log('\nF. controls 속성 영상');
{
  const page = await context.newPage();
  await page.goto('https://site.test/controls.html');
  await waitPlaying(page, '#v');
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  const kept = await pipEval(page, (w) => w.document.querySelector('video').hasAttribute('controls'));
  check('PiP 중에도 영상의 controls 속성은 그대로(Zero-touch)', kept === true);
  const pip = context.pages().at(-1);
  if (pip && pip !== page) {
    await pip.setViewportSize({ width: 480, height: 270 });
    await pipEval(page, (w) => w.document.querySelector('video').pause());
    await pip.waitForTimeout(300);
    await pip.screenshot({ path: path.join(SHOTS, 'pip-controls-paused.png') });
  }
  await pipEval(page, (w) => w.close());
  await page.close();
}

// ── H. 유튜브 라이브(영상 길이가 유한하게 나오는 경우) ──
console.log('\nH. 유튜브 라이브');
for (const [v, how] of [['live-api', '플레이어 API'], ['live-class', '시간 표시의 라이브 표식']]) {
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${v}`);
  await waitPlaying(page, 'video');
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  const r = await pipEval(page, (w) => {
    const d = w.document;
    return { live: !d.querySelector('button.live').hidden, time: !d.querySelector('.time').hidden };
  });
  check(`${how}로 라이브 감지 → LIVE 표시, 시간 숨김`, r.live && !r.time, JSON.stringify(r));
  if (v === 'live-api') {
    await pipEval(page, (w) => w.document.querySelector('button.live').click());
    check('LIVE 클릭 → 유튜브 방식(seekToLiveHead)으로 실시간 이동', await page.evaluate(() => window.__liveHead === true));
  }
  await pipEval(page, (w) => w.close());
  await page.close();
}

// ── I. 유튜브 일반 영상 ↔ 쇼츠 이동(플레이어가 따로 있음) ──
console.log('\nI. 유튜브 일반 ↔ 쇼츠');
{
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=nav');
  await waitPlaying(page, 'video');
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  await page.evaluate(() => window.toShorts());
  await page.waitForFunction(() => documentPictureInPicture.window?.document.querySelector('video') === window.shortsVideo, null, { timeout: 5000 }).catch(() => {});
  const a = await page.evaluate(() => {
    const w = documentPictureInPicture.window;
    return {
      shortsInPip: w?.document.querySelector('video') === window.shortsVideo,
      watchHome: window.watchVideo.parentElement?.classList.contains('html5-video-container'),
      ttl: w?.document.querySelector('.ttl')?.textContent,
      count: w?.document.querySelectorAll('video').length,
    };
  });
  check('일반 → 쇼츠: PiP가 쇼츠 영상으로 바뀜', a.shortsInPip && a.count === 1, JSON.stringify(a));
  check('일반 → 쇼츠: 이전 영상은 제자리로', a.watchHome === true);
  check('일반 → 쇼츠: 제목 갱신', a.ttl === '쇼츠 영상', a.ttl);
  await page.evaluate(() => window.toWatch());
  await page.waitForFunction(() => documentPictureInPicture.window?.document.querySelector('video') === window.watchVideo, null, { timeout: 5000 }).catch(() => {});
  const b = await page.evaluate(() => {
    const w = documentPictureInPicture.window;
    return {
      watchInPip: w?.document.querySelector('video') === window.watchVideo,
      shortsHome: window.shortsVideo.parentElement?.id === 'shorts-player',
      ttl: w?.document.querySelector('.ttl')?.textContent,
      playing: !window.watchVideo.paused,
    };
  });
  check('쇼츠 → 일반: PiP가 일반 영상으로 바뀌고 재생 중', b.watchInPip && b.playing, JSON.stringify(b));
  check('쇼츠 → 일반: 쇼츠 영상은 제자리로', b.shortsHome === true);
  check('쇼츠 → 일반: 제목 갱신', b.ttl === '두번째 영상', b.ttl);
  // PiP 영상을 보는 중(재생 중)이면 페이지의 다른 영상이 재생돼도 따라가지 않음
  await page.evaluate(() => { window.shortsVideo.muted = false; window.shortsVideo.play(); });
  await page.waitForTimeout(400);
  check('PiP 영상 재생 중에는 바꾸지 않음', await page.evaluate(() => documentPictureInPicture.window?.document.querySelector('video') === window.watchVideo));
  await pipEval(page, (w) => w.close());
  await page.close();
}

// ── J. 유튜브: PiP로 보다가 홈으로 이동 ──
console.log('\nJ. 유튜브 홈 이동');
const diagLines = [];
const openNav = async (debug = false) => {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.text().includes('[진단]')) diagLines.push(m.text()); });
  await page.goto('https://www.youtube.com/watch?v=nav');
  if (debug) { await page.evaluate(() => localStorage.setItem('vpip:debug', '1')); await page.reload(); }
  await waitPlaying(page, 'video');
  await page.mouse.click(1000, 700);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForFunction(() => !!documentPictureInPicture.window?.document.querySelector('.stage video'), null, { timeout: 5000 });
  return page;
};
const navState = (page) => page.evaluate(() => ({
  pip: !!documentPictureInPicture.window,
  same: documentPictureInPicture.window?.document.querySelector('video') === window.watchVideo,
  playing: !window.watchVideo.paused,
  hasSrc: window.watchVideo.getAttribute('src') !== null && window.watchVideo.readyState > 0, // 크롬은 비운 뒤에도 currentSrc를 남긴다
  path: location.pathname,
}));
for (const [name, opts, userPaused, debug] of [
  ['홈으로 가며 유튜브가 영상을 멈춰도 계속 재생', {}, false, false],
  ['이동이 끝난 뒤 늦게 멈춰도 계속 재생', { late: 300 }, false, false],
  ['유튜브가 플레이어를 정지(영상 비움)시켜도 영상이 살아 있고 계속 재생', { stop: true }, false, true],
  ['이동할 곳 정보가 없어도 정지를 막고 계속 재생', { stop: true, detail: false }, false, false],
  ['늦게 정지시켜도 계속 재생', { stop: true, late: 300 }, false, false],
  ['사용자가 멈춘 영상은 그대로 멈춤', {}, true, false],
]) {
  const page = await openNav(debug);
  if (userPaused) {
    await pipEval(page, (w) => {
      const b = w.document.querySelector('.cb.big');
      b.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true }));
      b.click();
    });
  }
  await page.evaluate((o) => window.toHome(o), opts);
  await page.waitForTimeout((opts.late ?? 0) + 1000);
  const r = await navState(page);
  check(name, r.pip && r.same && r.hasSrc && r.path === '/' && r.playing === !userPaused, JSON.stringify(r));
  await pipEval(page, (w) => w.close());
  await page.close();
}
{
  const page = await openNav();
  await page.evaluate(() => window.stopTowardWatch());
  await page.waitForTimeout(300);
  check('다른 영상으로 가며 정지시키는 건 막지 않음', !(await navState(page)).hasSrc);
  await pipEval(page, (w) => w.close());
  await page.close();
}
check('진단 모드: 유튜브가 보낸 명령이 콘솔에 기록됨', diagLines.some((l) => l.includes('일시정지로 대체')) && diagLines.some((l) => l.includes('페이지 이동 시작')), diagLines.slice(0, 5).join(' | '));

// ── G. 영상 없는 페이지 ──
console.log('\nG. 영상 없는 페이지');
{
  const page = await context.newPage();
  await page.goto('https://site.test/novideo.html');
  await page.mouse.move(300, 300);
  await page.mouse.move(320, 320);
  await page.waitForTimeout(500);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ host: !!document.querySelector('video-pip-ui'), pip: !!documentPictureInPicture.window }));
  check('마우스만으론 아무것도 안 생김, Alt+P는 안내만', !r.pip, JSON.stringify(r));
  await page.close();
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
if (errors.length) console.log('콘솔/페이지 오류:\n ' + errors.join('\n '));
await browser.close();
process.exit(fail ? 1 : 0);
