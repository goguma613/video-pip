# 🎬 video-pip v2 — 재설계서 (근본 버전)

> **상태:** 2.0.0 구현 완료 · 실제 브라우저(Tampermonkey + 실제 사이트) 수동 확인 대기 · **작성:** 2026-10-16
> **방향:** 뺄 건 빼고 근본만. "원본 화질 그대로 작은 창에 띄우고, 편하게 조작하고, 끄면 깔끔하게 제자리로." 이 세 가지를 확실하게 하는 데 집중한다.
> v1.x(1.2.8) 코드는 참고만 하고 재사용하지 않았다. v1 코드와 `PLAN.md`는 교체·삭제했다(git 히스토리에는 남음).
> 구현하면서 설계와 달라진 점은 해당 절에 **[구현]** 으로 적었다.

---

## 0. 한 줄 요약

**Document Picture-in-Picture로 사이트의 원본 `<video>`를 통째로 옮겨 화질 손실 0. 그 위에 꼭 필요한 컨트롤만 얹고, 상태 관리와 복원을 단단하게 만든다.**

---

## 1. 왜 갈아엎나 (v1 진단 요약)

v1.0 → 1.2.8의 버그 수정은 대부분 아래 구조 문제에서 나왔다.

| 문제 | 증상 / 원인 | v2 해법 |
|---|---|---|
| **기능 과다** | 패널·프리셋·필터·자막·슬립타이머·미니플레이어 등을 1,707줄 한 파일에 담아 상호작용 버그가 늘어남 | 핵심만 남기고 나머지는 "나중 후보"로 분리 (§3) |
| **상주 패널** | 1.2.6 유튜브 메뉴 클릭 가로채기, 1.2.7 화면 이탈, 1.2.8 세로 잘림 | 상주 패널 제거. 영상 hover 런처 + `Alt+P` |
| **상태 분산** | 1.2.2~1.2.4 자동 PIP 복귀 버그 3연속. `current`가 모듈마다 따로 있음 | 상태 머신 하나 (`Session`) |
| **진입 경합** | 연타하면 `requestWindow` 2회 → 먼저 열린 창의 `pagehide`가 새 세션을 복원해 빈 창이 될 수 있음 | 전환 직렬화 + 세션 ID |
| **영상을 직접 수정** | video의 `style`에 필터·변형을 쓰고, 복원할 때 진입 시점 스냅샷으로 덮어씀 → 사이트가 그사이 바꾼 크기가 되돌려질 위험 | **Zero-touch**: 영상 요소의 속성은 건드리지 않음 |
| **한글 IME** | `e.key` 매칭이라 한글 상태에서 `k`가 `ㅏ`로 들어와 단축키 미동작 | `e.code` 매칭 |
| **성능** | 문서 전체 MutationObserver, 컨트롤이 숨겨져도 60fps DOM 갱신, 자막 300ms 폴링 | 이벤트 기반, 보일 때만 갱신 |
| **자동 PIP 오해** | "제스처가 없어 Document PiP 불가"라는 주석은 사실과 다름(Chrome 134+ 핸들러 안에서는 가능) | 탭 전환 자동 PIP도 Document PiP |

---

## 2. 원칙

1. **화질 무손실.** 원본 `<video>` 노드를 옮긴다. 캔버스 복제나 재인코딩은 하지 않는다.
2. **사이트를 망가뜨리지 않는다.** 사이트 클릭을 가로채지 않고, 사이트의 단일키 단축키를 빼앗지 않으며, PIP를 끄면 플레이어를 100% 원상복구한다.
3. **영상 요소는 건드리지 않는다(Zero-touch).** `style`·`class`·속성을 쓰지 않는다. 배치는 PiP 창의 스타일시트가 맡고, 영상이 돌아오면 그 스타일은 저절로 사라진다. 재생 상태(배속·볼륨 등)도 사용자가 조작할 때만 바꾸고, 열 때는 바꾸지 않는다.
4. **적게, 확실하게.** 기능 하나를 넣을 때마다 "이게 없으면 PIP 툴이 아닌가?"를 묻는다.

---

## 3. 범위

### 3.1 v2.0에 넣는 것

| 영역 | 내용 |
|---|---|
| **엔진** | Document PiP(원본 video 이동). 다음 경우는 기본 PiP(`requestPictureInPicture`)로 폴백: Document PiP 미지원 브라우저, iframe 안 영상, DRM 영상(`video.mediaKeys`) |
| **PiP 창 컨트롤** | 재생/일시정지 · 시크바(버퍼 표시, 호버 시 시간) · ±10초 · 현재/전체 시간 · 볼륨/음소거 · 배속 칩(클릭으로 순환) · 닫기 · 라이브면 `LIVE` 표시 · 자동 숨김 · 휠=볼륨, `Shift`+휠=배속 |
| **진입점** | 영상 hover 시 나타나는 런처 칩 · 전역 단축키 `Alt+P` |
| **단축키** | PiP 창 안 플레이어 단축키 (§4.3), `e.code` 기준 |
| **자동 PIP** | 탭 전환 시 Document PiP 자동으로 열기 (옵션, 기본 끔) |
| **창 크기** | 마지막 크기를 기억하고, 영상 비율에 맞춰 연다(세로 영상·쇼츠 자동 대응) |
| **안정성** | 상태 머신, 전환 직렬화, 복원 보장, 유튜브 SPA 영상 교체 대응, 전체화면 인계 |
| **설정** | PiP 창 ⚙ 팝오버의 토글 3개: 자동 PIP / 런처 표시 / 이 사이트에서 끄기 |
| **사이트** | 일반(generic) + 유튜브 어댑터 |

### 3.2 빼는 것 (나중 후보)

v1에 있었거나 계획만 했던 기능이다. 지금은 넣지 않는다. 각각 필요해지면 v2.x에서 하나씩 결정한다.

| 기능 | 빼는 이유 | 다시 넣는다면 |
|---|---|---|
| 상주 설정 패널 | v1 후반 버그의 최대 원인 | — (되살리지 않음) |
| 스크롤 미니플레이어 | 드래그·스냅·재진입 감지 등 별도 표면 하나 분량. 핵심과 독립적 | 1순위 후보. Dock·PlayerUI를 그대로 재사용 가능하게 설계해 둠 |
| 자막 따라오기 | 유튜브 자막은 페이지 DOM에 그려져 PiP로 따라오지 않음(브라우저 기본 PiP와 같은 수준) | 2순위 후보 |
| 스크린샷 | 부가 기능 | 3순위 후보 |
| 프리셋/프로필 | 창 크기는 기억되고, 나머지는 바로 조작하면 됨 | — |
| 필터·줌·회전·반전·채움·디밍 | 시청의 본질이 아님. Zero-touch와도 충돌 | 필요하면 CSS 변수 방식으로 |
| 배속 기억/기본 배속 | 사이트(유튜브)가 이미 배속을 관리함. 열 때 바꾸지 않는 게 원칙 | — |
| 슬립 타이머 · A-B 반복 · 프레임 이동 · 통계 오버레이 | 전문가용 부가 기능 | 개별 결정 |
| 광고 배지/건너뛰기 · 다음/이전 영상 | 유튜브 전용 부가 기능(광고 중에도 PiP는 유지됨) | 개별 결정 |
| 도움말 오버레이 · 단축키 재지정 · 설정 시트 | 버튼 툴팁에 단축키를 표시하는 것으로 대체 | 단축키 재지정 요청이 있으면 |
| 사이트별 설정 계층 · 내보내기/가져오기 · 영어 UI | 설정이 3개뿐이라 불필요 | — |
| 다른 사이트 전용 어댑터 | 일반 어댑터로 먼저 동작 확인 | 문제가 있는 사이트만 |
| E2E 테스트 · 린트 규칙 | 규모가 작아 단위 테스트 + 수동 체크리스트로 충분 | 규모가 커지면 |

---

## 4. UX

### 4.1 사용자 흐름

```
영상에 마우스 → 우상단 ⧉ 칩 → 클릭 (또는 Alt+P)
  → 작은 창으로 영상이 빠져나옴 (첫 1회만 3초 힌트: "마우스=컨트롤 · 휠=볼륨")
  → ✕ / Esc / 브라우저의 "탭으로 돌아가기" → 영상이 제자리로, 재생 상태 그대로
```

### 4.2 PiP 창

```
기본 (너비 ≥ 360)
┌──────────────────────────────────────────────┐
│ Video title ...........................  ⚙  ✕ │ ← 상단
│                                              │
│              <<10     > ||     10>>          │ ← 중앙
│                                              │
│ ●━━━━━━━━━━━━━━━━━━━━━○───────────────────── │ ← 시크(버퍼·호버 시간)
│ > ||  12:34 / 45:67          🔊 ━━━   1.25x   │ ← 하단
└──────────────────────────────────────────────┘

좁음 (너비 < 360): 중앙 = 재생 버튼만 / 하단 = 재생 · 시간 · 배속
```

- 빈 영역 클릭 = 재생/일시정지(더블클릭 동작이 없어 지연 없음).
- 컨트롤은 2.4초 뒤 숨김. 일시정지 중·hover 중·시크 중·팝오버 열림 중에는 유지.
- 배속 칩: 클릭할 때마다 `0.5 → 1 → 1.25 → 1.5 → 2` 순환.
- 🏠 버튼은 없다. 브라우저가 PiP 창에 "탭으로 돌아가기"를 기본 제공한다.
- ⚙ 팝오버: `자동 PIP(탭 전환 시)` · `런처 표시` · `이 사이트에서 끄기` 토글 3개.
- 반응형은 CSS 컨테이너 쿼리로 처리한다(resize 리스너 불필요).

### 4.3 단축키

**규칙:** 페이지에서는 `Alt+P`만 가로챈다. 단일키는 PiP 창 안에서만 동작하므로 사이트 단축키는 그대로 산다. 입력창 포커스 시에는 무시한다. 매칭은 `e.code` 기준이라 한/영 상태와 무관하다.

| 키 | 동작 | 범위 |
|---|---|---|
| `Alt+P` | PIP 켜기/끄기 | 전역 |
| `Space` / `K` | 재생·일시정지 | PiP 창 |
| `←` / `→` | 5초 이동 | PiP 창 |
| `J` / `L` | 10초 이동 | PiP 창 |
| `↑` / `↓` | 볼륨 ±5% | PiP 창 |
| `M` | 음소거 | PiP 창 |
| `[` / `]` / `=` | 배속 −0.25 / +0.25 / 1.0 | PiP 창 |
| `Esc` | 팝오버 닫기, 없으면 PiP 닫기 | PiP 창 |

버튼 툴팁에 단축키를 같이 적는다(예: `재생 (K)`). 키 정의는 한 곳(명령 표)에만 두고 버튼·단축키·README가 모두 그것을 참조한다.

### 4.4 런처 칩

- 영상 사각형 안쪽 우상단에 28×28 칩, hover하면 `⧉ PIP`로 확장된다.
- 표시 조건: 영상이 200×112 이상이고 메타데이터가 있으며, 포인터가 영상 위에 400ms 머묾. 전체화면 중에는 숨긴다.
- 사이트 오버레이가 영상을 덮는 경우가 많아, 문서 단위 `pointermove`(passive, rAF 스로틀)로 영상 사각형을 hit-test한다.
- 칩만 포인터를 받는다. 칩을 감싼 레이어는 `pointer-events:none`이므로 사이트 클릭을 가로채지 않는다.
- 어댑터가 위치를 보정할 수 있다(예: 유튜브 임베드 상단바를 피해 아래로).

---

## 5. 아키텍처

### 5.1 모듈 (목표 1,000~1,200줄)

**[구현]** 실제 구성(소스 약 1,500줄, CSS 포함). `pip-window.ts`는 따로 둘 만큼 크지 않아 창 열기는 `main.ts`, 창 크기 계산은 `util.ts`로 합쳤고, 메타블록은 빌드 스크립트 쪽(`scripts/meta.mjs`)으로 옮겼다. 영상 조작 함수는 버튼과 단축키가 함께 쓰므로 `media.ts`로 분리했다.

```
src/
├─ main.ts          부트스트랩: 모듈 연결, 창 열기, 자동 PIP 핸들러
├─ config.ts        기본값 · 검증 · 저장(GM 또는 localStorage) · v1 이관
├─ tracker.ts       영상 탐지 · 대상 선택
├─ dock.ts          영상 이동 / 복원 (영상을 옮기는 유일한 곳)
├─ session.ts       상태 머신 (idle · opening · doc · legacy)
├─ player-ui.ts     PiP 창 컨트롤 + ⚙ 팝오버
├─ launcher.ts      hover 칩 + 알림(토스트)
├─ commands.ts      명령 표(id · 키 · 실행) + 키 매칭
├─ media.ts         재생·시크·볼륨·배속 조작
├─ sites.ts         generic + youtube 어댑터
├─ dom.ts           h() 헬퍼 · 스타일 주입 · 아이콘 (innerHTML 금지)
├─ util.ts          clamp · 시간 표시 · debounce · 창 크기 계산
└─ styles/          player.css · page.css
scripts/meta.mjs    유저스크립트 메타블록
scripts/build.mjs   빌드 / 개발 서버
```

**규칙:** 모듈끼리 서로 호출하지 않고 `session`(상태 + 이벤트)과 `commands`를 통해서만 연결한다. 이렇게 해서 v1의 순환 참조(PipController ↔ MiniPlayer ↔ HotkeyManager)를 없앤다.

```
입력(칩 클릭 · 단축키 · 버튼 · MediaSession)
  → commands.run(id)
     → session.open/close   → dock + pip-window → player-ui 마운트
     → 미디어 조작(재생·시크·볼륨·배속) → video
  → session 상태 변경 이벤트 → launcher · player-ui 반응
```

### 5.2 Session — 상태 머신

상태: `idle` · `opening` · `doc` · `legacy`

| 현재 | 이벤트 | 다음 | 동작 |
|---|---|---|---|
| idle | 열기 (Document PiP 가능) | doc | `requestWindow` → `dock.detach` → 창에 이동 → UI 마운트 |
| idle | 열기 (미지원 · iframe · DRM) | legacy | `video.requestPictureInPicture()` |
| idle | 탭 전환 (자동 PIP 켜짐) | doc | MediaSession `enterpictureinpicture` 핸들러에서 위와 같이 |
| doc | 창 닫힘(`pagehide`) | idle | `dock.restore` |
| doc | 유튜브 다음 영상 · 플레이어 재생성으로 video 교체 | doc | 이전 영상 복원 → 새 영상 이동 |
| doc | **[구현 2.0.1]** PiP 영상이 멈췄고, 페이지에서 다른 "주인공" 영상(재생 중 · 화면 20% 이상 · 소리 남 또는 사이트 주 영상)이 재생됨 — 유튜브 일반 ↔ 쇼츠는 플레이어가 따로라 이 경우 | doc | 이전 영상 복원 → 새 영상 이동 → 창 비율 맞춤(가능하면) |
| doc | 페이지 전체화면 진입(영상 원래 자리를 포함) | idle | 창을 닫고 영상을 돌려보내 전체화면에서 보이게 |
| legacy | `leavepictureinpicture` | idle | — |
| opening | 새 요청 | (대기) | 직렬화. 같은 요청이 대기 중이면 하나로 합침 |

**불변식**
- **I1** 옮겨진 영상은 언제나 최대 1개.
- **I2** 창 닫힘 같은 콜백은 자기 세션 ID일 때만 반영한다(이전 세션의 늦은 이벤트는 무시 → 연타 경합 해결).
- **I3** 어떤 예외 경로에서도 `finally`에서 복원한다.
- **I4** `requestWindow`는 열기 함수의 첫 `await`다. 그 앞에 다른 비동기 작업을 두지 않아 사용자 활성화가 만료되지 않게 한다.

```ts
// 스케치
let queue = Promise.resolve();
let seq = 0;
function request(kind: 'open' | 'close', fn: (id: number) => Promise<void>) {
  if (pending?.kind === kind) return pending.p;          // 중복 합치기
  const id = ++seq;
  const p = (queue = queue.then(() => fn(id)).catch(recover));
  pending = { kind, p };
  return p;
}
```

### 5.3 Dock — 영상 이동/복원

```ts
detach(video): Token   // 영상 바로 앞에 주석 앵커 삽입(+ 필요 시 spacer)
moveTo(token, slot)    // PiP 창 문서의 슬롯으로 이동
restore(token)         // 멱등: 앵커 앞 → 원래 부모 → 포기 순으로 시도
```

- **Zero-touch.** 영상의 `style`·`class`·속성은 그대로 둔다. PiP 창 안에서의 크기·배치는 PiP 문서의 스타일시트(`.slot > video { width:100% !important; … }`)가 맡는다. 사이트가 넣은 인라인 크기는 `!important` 규칙으로 덮을 뿐 지우지 않는다. 그래서 복원 = 제자리에 넣기, 끝.
- **Spacer.** 영상이 흐름 레이아웃(`position: static/relative`)일 때만 같은 크기의 빈 상자를 끼워 페이지가 무너지지 않게 한다. `absolute`(유튜브 등)면 넣지 않는다.
- **복원 후 보정.** `resize` 이벤트를 1회 보내 사이트 플레이어가 크기를 다시 계산하게 한다. 떼어낼 때 재생 중이었는데 복원 후 멈춰 있으면 `play()`를 1회 시도한다.

### 5.4 Tracker — 영상 탐지

- `document` 캡처 단계에서 `loadedmetadata` · `play` · `emptied`를 받는다(미디어 이벤트는 버블링하지 않지만 캡처로는 잡힘).
- 유튜브는 `yt-navigate-finish`로 영상 교체를 감지한다.
- 필요할 때만 `document.getElementsByTagName('video')`를 훑는다. **전역 MutationObserver는 쓰지 않는다.**
- 대상 선택: 런처로 고른 영상 → 재생 중이면서 소리 나는 것 → 화면에 가장 크게 보이는 것. 120px 미만은 제외한다.

### 5.5 PiP 창과 플레이어 UI

- 스타일은 `new pipWin.CSSStyleSheet()` + `adoptedStyleSheets`로 주입한다(사이트 CSP·유튜브 Trusted Types에 안전).
- DOM은 `h(doc)`로 PiP 창 문서에서 직접 만든다. `innerHTML`은 쓰지 않는다.
- 진행 표시는 `timeupdate`(약 4Hz)로 갱신하고, rAF는 시크 드래그 중에만 쓴다. **컨트롤이 숨겨져 있으면 DOM 쓰기 0.**
- 창 크기: 저장된 긴 변(기본 480px)을 쓰고 짧은 변은 영상 비율로 계산한다. 세로 영상이면 자동으로 세로 창이 된다. 사용자가 창 크기를 바꾸면 긴 변을 저장한다(debounce).

### 5.6 사이트 어댑터

```ts
interface SiteAdapter {
  match(loc: Location): boolean;
  primaryVideo?(): HTMLVideoElement | null;   // 유튜브: #movie_player .html5-main-video
  title?(): string;
  onNavigate?(cb: () => void): () => void;    // 유튜브: yt-navigate-finish
  launcherOffset?(v: HTMLVideoElement): { top: number; right: number };
  afterRestore?(v: HTMLVideoElement): void;   // 유튜브: resize 이벤트
}
```
v2.0은 `generic`과 `youtube` 두 개만 둔다.

**[구현]** 복원 후 `resize` 이벤트는 어느 사이트든 Session이 보내므로 `afterRestore`는 빼고, 위치 보정은 상단 여백 하나(`launcherInset`)로 줄였다.

**[구현 2.0.1]** 유튜브 라이브는 `duration`이 `Infinity`가 아니라 유한하게 나온다(사용자 제보). 그래서 `isLive(v)`(플레이어 `getVideoData().isLive` 또는 `.ytp-time-display.ytp-live`)와 `toLiveEdge()`(`seekToLiveHead()`)를 어댑터에 추가했다. 둘 다 유튜브 내부 API라 없으면 일반 방식으로 돌아간다. 쇼츠의 주 영상은 `ytd-reel-video-renderer[is-active] video, #shorts-player video`로 찾는다.

### 5.7 프레임

- 최상위 프레임: 전체 기능.
- iframe 안(블로그에 임베드된 유튜브 등): 런처 + 기본 PiP만. Document PiP는 최상위 프레임에서만 열 수 있기 때문이다.

---

## 6. 설정

```ts
interface Config {
  schema: 2;
  pipLongEdge: number;       // 마지막 PiP 창의 긴 변(px), 기본 480
  autoTabPip: boolean;       // 탭 전환 시 자동 PIP, 기본 false
  launcher: boolean;         // 런처 칩 표시, 기본 true
  disabledSites: string[];   // "이 사이트에서 끄기" 목록 (www. · m. 제거한 호스트)
  hinted: boolean;           // [구현] PiP 창 첫 진입 힌트를 보여 줬는지
}
```
- 값마다 범위와 타입을 검사하고, 잘못된 값은 기본값으로 바꾼다.
- 저장은 300ms debounce, `pagehide`에서 즉시 저장한다.
- **저장소(S1 결과로 확정):** GM 저장소가 되면 모든 사이트 공통. 안 되면 사이트별 `localStorage['vpip:v2']`.
  - **[구현]** S1은 이 개발 환경에서 확인할 수 없어(Tampermonkey 없음), v1에서 검증된 `@grant none` + 사이트별 localStorage로 출시한다. GM 저장소 코드는 들어 있어서, S1 확인 후 메타블록에 `@grant GM_getValue` / `GM_setValue`만 추가하면 자동으로 GM 저장소를 쓴다.
- **v1 이관:** `localStorage.__videoPip_cfg`가 있으면 `pipSize`의 긴 변 → `pipLongEdge`, `autoPip` → `autoTabPip`만 옮긴다. 성공하면 v1 키를 지운다. 나머지 v1 설정은 해당 기능이 빠졌으므로 버린다.

---

## 7. 플랫폼 사실관계와 검증

### 7.1 확인된 사실 (2026-10 기준)

| 항목 | 사실 | 설계 영향 |
|---|---|---|
| Document PiP | Chromium(Chrome·Edge·Whale·Opera) 116+, **Firefox 151+(2026-05)** 데스크톱. Safari·모바일 미지원 | 주 엔진. Firefox도 대상 (S5) |
| 제약 | 최상위 프레임 전용, 탭당 1창, 사용자 활성화 필요, 창 위치 지정 불가 | iframe은 기본 PiP, 전환 직렬화(I4) |
| 자동 PiP(미디어 재생) | Chrome 134+. 조건: Safe Browsing 통과, 최상위 프레임 미디어, 최근 2초 내 소리, 오디오 포커스·재생 중, `enterpictureinpicture` 핸들러 등록, 미디어 참여 지수 충족(사용자가 사이트에 명시 허용하면 면제). 이 경로에서 Document PiP 사용 가능 | 탭 전환 자동 PIP = Document PiP (S2) |
| Tampermonkey 실행 세계 | `@sandbox` 생략 시 `raw`(페이지 컨텍스트)가 기본 | GM 저장소와 함께 쓸 수 있는지 S1 |

출처: [Chrome — Enter picture-in-picture automatically when playing media](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback) · [Chrome — Browser-initiated automatic PiP](https://developer.chrome.com/blog/automatic-picture-in-picture-initiated-by-the-browser) · [MDN — Firefox 151 for developers](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/151) · [Tampermonkey — @sandbox](https://www.tampermonkey.net/documentation.php?q=sandbox)

### 7.2 스파이크 (구현 전에 확인, 반나절 분량)

| ID | 확인할 것 | 실패 시 |
|---|---|---|
| **S1** | TM·VM에서 `@grant GM.getValue/GM.setValue`를 쓸 때 Document PiP · `yt-navigate-finish` · MediaSession 핸들러가 모두 동작하는가 | `@grant none` + 사이트별 localStorage |
| **S2** | 유튜브에서 탭 전환 → `enterpictureinpicture` 핸들러 → Document PiP가 열리는가 | 자동 PIP는 기본 PiP로 |
| **S3** | 유튜브(일반·라이브·광고·쇼츠)와 일반 사이트 1~2곳에서 영상 이동/복원 시 끊김·레이아웃 문제가 없는가 | 문제 사이트는 기본 PiP로 강제 |
| **S4** | 창 크기 지정과 브라우저의 크기 기억이 어떻게 상호작용하는가(`preferInitialWindowPlacement`) | 직접 저장한 크기를 매번 지정 |
| **S5** | Firefox 151에서 같은 코드가 동작하는가 | Firefox는 기본 PiP만 |

**[구현] 스파이크 결과 (2026-10-16, Playwright Chromium 141 headless)**

| ID | 결과 |
|---|---|
| S1 | ⏸ 이 환경에 Tampermonkey가 없어 확인 불가 → `@grant none`으로 출시(§6) |
| S2 | ⏸ headless에서 탭 전환 자동 PiP를 일으킬 수 없음 → 코드만 반영, 실제 Chrome에서 확인 필요 |
| S3 | 🔸 유튜브 구조를 흉내 낸 페이지(유튜브 주소로 띄움)와 일반 페이지에서 이동·재생 유지·복원·SPA 교체·전체화면 인계 모두 정상. 실제 유튜브·다른 사이트는 수동 확인 필요 |
| S4 | ✅ 요청 크기는 정확히 전달됨(가로 480×270, 세로 270×480). headless 창은 요청 크기를 무시하므로 테스트는 요청 값을 검사 |
| S5 | ⏸ Firefox 미설치 → 수동 확인 필요 |
| 추가 | ✅ headless Chromium에서 Document PiP 창 열기·조작·닫기가 실제로 동작함 → 자동 브라우저 검증 가능(§9) |

---

## 8. 엣지 케이스 체크리스트

★ = v1에서 실제로 터졌던 것. 릴리스 전 수동 체크리스트(`docs/QA.md`)로 전부 확인한다.

| # | 상황 | 기대 동작 |
|---|---|---|
| 1 | 칩·`Alt+P` 연타 | 창 1개, 영상 1회 이동 |
| 2 | PiP 중 유튜브 다음 영상 | PiP 유지, 새 영상 재생, 제목 갱신 |
| 3 | 광고 시작/종료 · 화질 변경 · 플레이어 재생성 | PiP 유지(필요하면 자동 재연결) |
| 4 | PiP 중 유튜브 전체화면 버튼 | 영상이 돌아와 전체화면에 보임 |
| 5 | ✕ / Esc / "탭으로 돌아가기" | 영상 제자리, 재생 상태 유지, 레이아웃 원상복구 |
| 6 | PiP 중 원본 탭 새로고침/닫기 | 창이 닫히고 오류 없음 |
| 7 ★ | 자동 PIP 후 다른 탭을 닫고 복귀 (1.2.3~1.2.4) | PiP 유지 |
| 8 ★ | 유튜브 설정·화질·계정 메뉴 클릭 (1.2.6) | 우리 UI가 가로채지 않음 |
| 9 | 한글 입력 상태에서 단축키 | 동작 |
| 10 | 댓글창 등 입력 포커스 | 단축키 무시 |
| 11 | 영상 없는 페이지 | 아무것도 안 뜨고 오류 없음 |
| 12 | iframe 임베드 영상 · DRM 영상 | 기본 PiP로 동작 |
| 13 | 쇼츠·세로 영상 | 세로 창 |
| 14 | 손상된 설정값 | 기본값으로 복구 |
| 15 | 1.2.8 → 2.0.0 자동 업데이트 | 같은 스크립트로 인식되어 덮어쓰기 |

---

## 9. 빌드 · 배포

- **도구는 최소한으로:** `esbuild`(번들) + `typescript`(타입 체크) + `vitest` + `happy-dom`(단위 테스트). 이것뿐이다.
- 결과물은 **루트의 `video-pip.user.js` 한 파일**(커밋). 경로가 같아 기존 설치의 자동 업데이트가 그대로 이어진다.
- **`@name` · `@namespace`는 v1과 똑같이 유지**한다(Tampermonkey는 이 둘로 같은 스크립트인지 판단). 버전은 `2.0.0`.
- 압축·난독화하지 않는다. 설치하는 사람이 코드를 읽을 수 있어야 한다.
- `@match`: §11 D2 결정에 따름. `@exclude`는 Netflix·Disney+ 유지.
- 명령: `npm run dev`(watch + 로컬 서버에서 설치용 URL 제공) · `build` · `typecheck` · `test`.
- CI(GitHub Actions) 한 개: typecheck → test → build → 커밋된 `video-pip.user.js`가 빌드 결과와 같은지 확인.
- **[구현] 브라우저 검증 추가.** §3.2에서 E2E를 뺐지만, headless Chromium에서 Document PiP가 실제로 동작해서 `npm run test:browser`(Playwright)를 넣었다. 빌드 결과물을 실제 브라우저에 주입해 §8 항목 대부분을 자동으로 확인한다. 이 검증이 구현 중에 "document-start 시점에 `<html>`이 없어 시작 실패" 버그를 잡아 넣을 가치를 증명했다. CI에서도 실행한다.
- 배포: PR → `main` 머지 = 배포(raw URL이 곧 업데이트 채널). `CHANGELOG.md` 갱신.

```
video-pip/
├─ src/ (§5.1)
├─ test/          session · dock · commands · config 단위 테스트
├─ scripts/       build.mjs · dev-server.mjs
├─ docs/          DESIGN.md · QA.md
├─ video-pip.user.js   ← 빌드 결과물
├─ package.json · tsconfig.json
├─ README.md · CHANGELOG.md
└─ .github/workflows/ci.yml
```

---

## 10. 로드맵

| 단계 | 내용 | 완료 조건 |
|---|---|---|
| **M0 스파이크** | S1~S5 | 결과를 §7에 반영, §11 확정 |
| **M1 뼈대** | 빌드, config, dom, tracker, dock, session, pip-window, 최소 UI(재생·시크·닫기), `Alt+P`. v1 코드·`PLAN.md` 교체 | 유튜브에서 `Alt+P` → 원본 화질 PiP → 닫으면 정확히 복원. 연타·복원 단위 테스트 통과 |
| **M2 완성** | 전체 컨트롤(시간·볼륨·배속·±10초·LIVE·좁은 창·휠), 단축키, 런처 칩, 자동 PIP(탭 전환), ⚙ 팝오버, 유튜브 어댑터, 전체화면 인계, v1 이관 | §8 체크리스트 전부 통과 |
| **M3 출시** | README 재작성, CHANGELOG, 2.0.0 머지 | 1.2.8 → 2.0.0 자동 업데이트 확인 |

출시 후 필요하면 §3.2 후보(미니플레이어 → 자막 → 스크린샷 순)를 하나씩 결정해 추가한다.

**[구현] 진행 현황:** M0(가능한 범위) · M1 · M2 완료. 단위 테스트 42개, 브라우저 검증 42개 통과. M3는 `docs/QA.md` 수동 확인 → `main` 머지만 남음.

---

## 11. 결정 사항

**[구현]** 아래 추천안대로 확정했다. D4만 S1 확인 전까지 플랜 B(사이트별 localStorage)로 출시한다.

| # | 질문 | 추천 | 이유 |
|---|---|---|---|
| D1 | 스크롤 미니플레이어를 v2.0에서 빼도 되나? | **뺀다** (1순위 후보로 보류) | 별도 표면 하나 분량이고 핵심과 독립적. 구조는 나중에 붙일 수 있게 해 둠 |
| D2 | 대상 사이트(`@match`) | **전 사이트** (`*://*/*`) | 일반 어댑터가 핵심이라 사이트 목록을 관리할 필요가 없음. 영상 없는 페이지 비용은 거의 0이고, ⚙에서 사이트별로 끌 수 있음 |
| D3 | 빌드 단계(TypeScript + esbuild) 도입 | **도입** | 모듈 분리와 단위 테스트의 전제. 설치 파일 경로·이름은 그대로 |
| D4 | 설정 저장소 | **GM 저장소** (S1 통과 시) | 모든 사이트 공통, 사이트 저장소를 건드리지 않음 |
