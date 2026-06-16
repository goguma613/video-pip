# 🎬 고화질 영상 PIP 툴 (브라우저용) — 설계 계획서

> 유튜브·일반 영상 사이트에서 영상을 **항상 위에 뜨는 작은 창(Picture-in-Picture)** 으로 빼내는 단일 파일 유저스크립트(Tampermonkey/Violentmonkey).
> 같은 제작자의 "브라우저 소리 증폭기" 유저스크립트의 구조·디자인 언어를 그대로 계승.

---

## 0. 목표 & 원칙

- **화질 최우선** — 다운스케일·재인코딩 없이 **원본 해상도(4K 포함) 그대로** 유지.
- **전문가용 옵션 풍부 + 초보자도 쉬움** — 기본 동선은 "버튼 한 번 / Alt+P", 전문 옵션은 `⚙️ 고급` 서랍에 격리.
- **단일 파일 유저스크립트** — 별도 확장 설치 없이 Tampermonkey에서 동작. 자동 업데이트(@updateURL).
- 기존 증폭기 관례 계승: 모듈형 IIFE, Shadow DOM 격리, 사이트별 localStorage 설정, 드래그/핀/유휴 페이드/온보딩, z-index 2147483647, 한국어 UI.

---

## 1. 핵심 기술 결정 (가장 중요)

### 주 엔진 = **Document Picture-in-Picture API** / 폴백 = 레거시 PiP

| | **Document PiP** `documentPictureInPicture.requestWindow()` | **레거시** `video.requestPictureInPicture()` |
|---|---|---|
| 옮기는 것 | **임의 DOM(실제 `<video>` 포함) 전체** | 비디오 프레임만 OS 레벨 복제 |
| 화질 | **원본 video 노드 그대로 이동 → 원본 해상도 유지** | 화질 유지되나 |
| 커스텀 컨트롤·필터 | **가능** (시크바·속도·줌·회전·밝기 전부 주입) | **불가** (브라우저 기본 OS 컨트롤만) |
| 지원 | Chrome/Edge/Opera **116+** (데스크톱) | 거의 전 브라우저(Firefox·Safari·모바일 포함) |
| 창 위치 지정 | 불가(크기 힌트만) | 불가 |

**결론:** "최상 화질 + 풍부한 옵션"을 동시에 만족하려면 **Document PiP가 정답.** 유튜브가 디코딩 중인 그 `<video>`를 통째로 새 창으로 옮기므로 화질 손실이 0이고, 그 위에 우리 컨트롤·CSS 필터·줌/회전을 자유롭게 입힐 수 있다. 레거시는 Firefox·Safari·모바일용 폴백(화질만 유지, 커스텀 컨트롤 없음).

### 지원 현황 (2025~2026 웹 검증 완료)
- Chrome/Edge/Opera 116+ 정식 지원 · **Firefox 미지원**(Bugzilla #1858562 트래킹) · **Safari 미지원** · **모바일 미지원**(→ 레거시 폴백).
- HTTPS 전용 · 탭당 PiP 창 1개 · **사용자 제스처(클릭/키) 필요** · 창 위치는 코드로 지정 불가(크기만) · `copyStyleSheets` 옵션 폐기됨(스타일 수동 복제).

### 진입 흐름 (스케치)
```js
async function enterPip(video) {
  if ('documentPictureInPicture' in window) {            // 주 경로
    const pip = await documentPictureInPicture.requestWindow({ width, height });
    insertPlaceholder(video);        // 자리표시자 주석 노드로 원위치 기억
    copyStyles(pip.document);        // styleSheets 수동 복제
    const stage = buildPipStage(pip.document);
    stage.querySelector('.video-slot').append(video);    // ★ 원본 video 이동
    pip.document.body.append(stage);
    pip.addEventListener('pagehide', () => restoreVideo(video), { once: true }); // 복원 단일 진입점
    return { mode: 'doc', win: pip };
  }
  if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
    await video.requestPictureInPicture();               // 폴백(커스텀 UI 없음)
    return { mode: 'legacy' };
  }
  toast('이 브라우저는 PIP를 지원하지 않습니다');
}
```

### YouTube 특화 주의점
1. **레이아웃 깨짐/복원** — video를 떼면 플레이어 종횡비 박스가 무너짐 → 자리표시자 주석 노드 + 인라인 `style` 스냅샷으로 정확히 복원, PiP 중 원위치에 동일 크기 `pip-spacer` 삽입.
2. **SPA 영상 전환** — `yt-navigate-finish` + MutationObserver로 video 교체 감지 → PiP 활성 중 새 video 재이동, `currentTime`/속도 이관.
3. **광고/화질변경 플레이어 재생성** — 활성 video가 `isConnected===false`면 현재 최대 면적 재생 video로 자동 재바인딩.
4. **복원 단일 진입점** — `pagehide`(X버튼·탭종료·close 모두 발생)에서만 복원.

### 한계 (명시)
- **DRM(Netflix/Disney+ 등)**: EME 보호 영상은 이동 시 검은 화면 위험 → `@exclude`로 제외.
- **교차 출처(cross-origin) iframe 영상**: 부모 스크립트가 접근 불가 → 동일 출처만 처리, 나머지는 안내 토스트.
- **창 위치 기억 불가** → 크기만 저장(위치는 브라우저가 관리).

---

## 2. 기능 세트 (🟥필수 / 🟦추천 / 🟨고급)

### 재생 제어
| 기능 | 우선 | 비고 |
|---|---|---|
| 재생/일시정지, 시크바, 볼륨 | 🟥 | 커스텀 컨트롤 |
| 재생 속도 0.25~4x (피치 보존) | 🟥 | `playbackRate` + `preservesPitch` |
| 프레임 단위 이동 | 🟦 | `currentTime ± 1/fps` |
| A-B 구간 반복 | 🟦 | A·B 마킹 + `timeupdate` 시크 |
| 빠른 점프 단위(5/10/15초) | 🟦 | |

### 화질 / 표시
| 기능 | 우선 | 비고 |
|---|---|---|
| 원본 해상도 유지 | 🟥 | Document PiP가 자동 충족 |
| 종횡비/줌/크롭 | 🟦 | `object-fit` + `transform: scale()` |
| 회전(90/180/270°), 좌우반전 | 🟦/🟨 | `transform: rotate()/scaleX(-1)` |
| 비디오 필터(밝기·대비·채도·감마) | 🟦 | CSS `filter`, `🌙 야간 보정` 원클릭 |
| 자막 트랙 유지 | 🟦 | native `<track>`은 따라옴, YT 캡션 div는 별도 이동(고급) |

### 창 동작
| 기능 | 우선 | 비고 |
|---|---|---|
| PiP 창 **크기** 기억 | 🟦 | 위치는 API상 불가 |
| 항상 위 | 🟥 | Document PiP 기본 |
| 탭 전환 시 자동 PiP | 🟦 | `visibilitychange` (제스처 제약 → 토스트 우회) |
| 영상이 뷰포트 벗어나면 자동 PiP | 🟦 | `IntersectionObserver` |

### 편의
| 기능 | 우선 | 비고 |
|---|---|---|
| 커스터마이즈 단축키 | 🟦 | capture 단계로 YT 단축키 충돌 회피 |
| 스크린샷 캡처(PNG) | 🟦 | `canvas.drawImage` (DRM은 try/catch) |
| 멀티 영상 대상 선택 | 🟦 | 최대 면적/재생 중 자동 + 수동 셀렉터 |
| 사이트별 설정 기억 | 🟥 | ConfigManager 계승 |
| 온보딩 1회 / 유휴 페이드 | 🟦 | 기존 툴 계승 |

---

## 3. UI/UX 설계 — 두 개의 표면(surface)

이 툴의 UI는 **두 곳**에 존재한다.

### ① 페이지 트리거·설정 패널 (PIP 켜기 전·후 상주, 기존 증폭기 위치/스타일)
3단 구조로 인지 부하 최소화:
- **1존(즉시 행동)**: 풀폭 `📺 PIP 켜기` 버튼(44px, `--accent`) + `🤖 자동 PIP` 토글
- **2존(상황별 프리셋)**: 2×3 원클릭 프리셋 그리드
- **3존(고급, 기본 접힘)**: `⚙️ 고급 설정 ▾` → 아코디언(🎚️화질·성능 / 🔄재생 / 🖼️화면 / 🎨필터 / 💬자막 / ⌨️단축키)

### ② PIP 창 내부 커스텀 컨트롤 오버레이 (호버 시 등장)
영상 위 그라데이션 3구역:
- **상단바**: 제목/도메인 · `[🏠 페이지 복귀] [⤢ 크기] [✕ 닫기]`
- **중앙(옅게)**: `⟲10  ⏯  10⟳`
- **하단 컨트롤바(2줄)**: 시크바(풀폭, A·B 마커) / `⏯ | 12:34 / 45:67 | 🔊볼륨 | 1.25x | 🔁A-B | 📷스냅 | ⚙️`
- `⚙️` = PiP 창 안 미니 설정 팝오버(배속·필터·회전)

### 와이어프레임
```
① 페이지 패널(고급 펼침)              ② PIP 창 오버레이(호버 시)
┌──────────────────────────┐        ┌────────────────────────────────┐
│ ⠿ 🎬 고화질 PIP [HD] ⏻● — │        │▓ 유튜브·영상 제목   🏠  ⤢  ✕ ▓│
├──────────────────────────┤        │                                │
│ ┌──────────────────────┐ │        │         ⟲10   ⏸   10⟳          │
│ │     📺  PIP 켜기       │ │        │                                │
│ └──────────────────────┘ │        │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│ 🤖 자동 PIP        [●——] │        │ ●━━━━━━━A━━━B━━━━━━━○          │
│ 상황별 프리셋             │        │ ⏸ 12:34/45:67 🔊▮▮▯ 1.25x🟠🔁🟢📷⚙️│
│ ┌────┬────┬────┐         │        └────────────────────────────────┘
│ │🎬기본│📞통화│📖논문│      │          마우스 빠지면 2.4초 후 페이드아웃
│ ├────┼────┼────┤         │
│ │🎮공략│🎧음악│🌙야간│      │
│ └────┴────┴────┘         │
│ ⚙️ 고급 설정          ▴  │
│  🎚️ 화질·성능  🔄 재생 …  │
└──────────────────────────┘
      접으면 → [ 🎬 PIP ] 알약 핀
```

### 디자인 토큰 (두 표면 공통, 증폭기 계승)
```
--bg-panel: rgba(22,26,34,.92);  --blur: blur(12px);  --radius:14px
--fg:#e9eef5  --fg-dim:#9aa6b5  --accent:#4f9dff  --danger:#ff5b5b
--success:#3ddc84(자동PIP/AB 활성)  --boost:#ffb84f(배속>1·필터)
font: 'Malgun Gothic', system-ui    z-index: 2147483647
포커스 링: box-shadow 0 0 0 3px rgba(79,157,255,.35)
```

### 원클릭 프리셋 (크기·위치·옵션 묶음, 6개)
| 버튼 | 용도 | 묶인 설정 |
|---|---|---|
| 🎬 기본 | 일반 시청 | 480×270, 우하단, 1.0x, 필터 OFF |
| 📞 화상통화 옆 | 회의 보며 | 320×180, 우상단, 방해 최소 |
| 📖 논문읽기 | 강의 들으며 | 초소형, 1.25x, 자막 ON |
| 🎮 게임공략 | 공략 보며 | 400×225, A-B 준비 |
| 🎧 음악·라디오 | 화면 거의 안 봄 | 240×135 최소 |
| 🌙 야간 | 어두운 영상 | 밝기+15·대비+10·감마보정 |
> 길게 누르면 "현재 상태로 덮어쓰기"(사용자 커스텀 저장).

### 단축키 기본 매핑
`Alt+P` 토글 · `Space/K` 재생 · `←/→` 5초 · `J/L` 10초 · `↑/↓` 볼륨 · `M` 음소거 · `[ / ]` 배속·`=`리셋 · `A→B` 구간·`C` 해제 · `S` 스냅샷 · `R` 회전 · `F` 크기토글 · `H/?` 도움말 · `Esc` 닫기
> 휠=볼륨±5%, Shift+휠=배속±0.1, Alt+휠=줌±5%.

### 인터랙션 타이밍 (확정값)
컨트롤 등장 140ms · 자동숨김 2.4초 후 페이드 320ms · 더블클릭 판정 250ms · 더블클릭=창 크기 토글.

### 접근성
- 단축키 핸들러를 **PIP 창·원본 창 양쪽 document에 등록**(PiP 창 포커스 시에도 동작).
- `role="switch"/aria-checked`, 슬라이더 `aria-valuetext`, `:focus-visible` 링, 작은 창(<300/220px)에서 컨트롤 단계 축약.
- 전체화면이면 패널을 `:fullscreen` 하위로 재부착(증폭기 방식).

---

## 4. 기술 아키텍처

### 모듈 구성 (IIFE 안, 증폭기 패턴 계승)
```
ConfigManager   사이트별 localStorage 설정 로드/저장(debounce), DEFAULTS 병합
VideoObserver   MutationObserver + yt-navigate-finish로 video 등장/교체 감지, 대상 선택
PipController   ★핵심: Document/레거시 분기, video 이동·복원, 스타일 복제, pagehide, 재바인딩
PipStage(UI)    PiP 창 내부 DOM 셸 + 컨트롤(시크/속도/볼륨/필터/AB) — 자체 <style> 주입
FilterEngine    transform/filter 상태 → video 적용(줌·회전·밝기)
HotkeyManager   키 바인딩·충돌 회피(capture), 커스텀 매핑
AutoPipManager  visibilitychange + IntersectionObserver 트리거(+토스트 우회)
UIManager       원본 페이지 Shadow DOM 플로팅 패널, 드래그/핀/페이드/전체화면/온보딩
```

### 설정 스키마 (DEFAULTS 초안)
```js
const DEFAULTS = {
  version: 1, engine: 'auto',          // auto | document | legacy
  defaultRate: 1, ratePresets: [0.5,1,1.5,2], preservePitch: true, seekStep: 5,
  abLoop: { enabled:false, a:null, b:null },
  filters: { brightness:100, contrast:100, saturate:100 },
  zoom:1, rotate:0, mirror:false, fit:'contain', keepCaptions:true,
  pipSize: { w:640, h:360 }, disallowReturnToOpener:false,
  autoOnTabBlur:false, autoOnScrollOut:false, restoreOnReturn:true,
  hotkeys: { togglePip:'Alt+P', speedUp:']', speedDown:'[', frameNext:'.', framePrev:',',
             screenshot:'Alt+S', markA:'a', markB:'b' },
  panelCollapsed:false, fadeWhenIdle:true, onboardingShown:false,
};
// 키: `vpip:${location.hostname}` (사이트별) + `vpip:global`(전역) 병행
```

### 알려진 함정 → 회피책 (요약)
스타일 미복제 → `styleSheets` 수동 복제 · video 복원 실패 → 자리표시자+인라인style 스냅샷 · SPA 교체 → yt-navigate-finish 재이동 · 플레이어 재생성 → isConnected 재바인딩 · 자동PIP 제스처 부족 → 토스트/레거시 폴백 · 단축키 충돌 → capture+stopImmediatePropagation · 스크린샷 캔버스 오염 → try/catch.

---

## 5. 구현 로드맵 (단계별)

- **1단계 (MVP / 필수)**: 메타블록 + 모듈 골격 → 페이지 패널 `PIP 켜기` 버튼 → Document/레거시 분기 진입·복원 → PiP 창 기본 컨트롤(재생/시크/볼륨/속도/닫기/복귀) → 사이트별 설정 저장 → 온보딩. **유튜브 우선 검증.**
- **2단계 (추천)**: 프리셋 6종 · 자동 PIP(탭전환/뷰포트) · 단축키 매니저 · 필터(밝기/대비/채도) · 줌/회전 · 스크린샷 · 멀티영상 셀렉터 · 유휴 페이드.
- **3단계 (고급)**: A-B 반복 · 프레임 단위 이동 · 자막 컨테이너 이동 · 미러 · 미니 설정 팝오버 · 크기 기억 · 도움말 오버레이.
- **배포**: GitHub 공개 repo + `docs/index.html` 설치 안내 + README(증폭기와 동일 포맷) + `@updateURL`/`@downloadURL` 자동 업데이트.

---

## 6. 확정 필요 사항 (사용자 결정)
1. **v1 범위** — MVP(1단계)만 먼저? / 1+2단계? / 전부?
2. **대상 사이트(@match)** — 유튜브만 / 증폭기와 동일 세트(트위치·비메오·네이버TV·카카오TV·치지직·아프리카) / 전 사이트(`*://*/*`).
3. **GitHub 사용자명/저장소명** — 자동 업데이트 URL용 (증폭기는 `goguma613`).
```
